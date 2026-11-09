"""Render explicitly selected model actions without saving the source .blend.

blender --background --factory-startup --disable-autoexec SOURCE.blend
--python render_sprites.py -- --config settings.json --output JOB/results
Completed frame PNGs are reused only for an identical source and configuration.
"""

import argparse
from array import array
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_model import action_slot_info
from studio_blender import (
    file_digest, framing_frames, normalized_settings, progress, render_signature,
    project_attachment_point, sample_animation, sheet_layout, validate_slot_info, write_json,
)

PADDING_PIXELS = 2


def set_frame(scene, value):
    integer = math.floor(value)
    scene.frame_set(integer, subframe=value - integer)
    scene.view_layers[0].update()


def activate_action(rig, spec):
    data = rig.animation_data
    data.action = spec['action']
    if spec['slot'] is not None:
        data.action_slot = spec['slot']
        if data.action_slot != spec['slot']:
            raise RuntimeError('Blender did not accept the explicitly chosen action slot.')


def world_corners(meshes, depsgraph):
    return [obj.evaluated_get(depsgraph).matrix_world @ Vector(corner)
            for obj in meshes
            for corner in obj.evaluated_get(depsgraph).bound_box]


def pike_attachment(obj, depsgraph, settings, origin, right, up, pixels_per_world_unit, pivot):
    """Use evaluated bone parenting while excluding the weapon from the image."""
    matrix = obj.evaluated_get(depsgraph).matrix_world
    result = {"enabled": True, "width": settings["width_world"] * pixels_per_world_unit,
              "layer": settings["layer"]}
    for name in ("grip", "butt", "tip"):
        point = matrix @ Vector(settings[name])
        result[name] = project_attachment_point(point, origin, right, up, pixels_per_world_unit, pivot)
    return result


def root_position(rig, depsgraph, bone_name):
    evaluated = rig.evaluated_get(depsgraph)
    if bone_name:
        return evaluated.matrix_world @ evaluated.pose.bones[bone_name].head
    return evaluated.matrix_world.translation.copy()


def root_delta(rig, spec, depsgraph, settings):
    if not settings['remove_root_motion']:
        return Vector((0, 0, 0))
    delta = root_position(rig, depsgraph, settings['root_motion_bone']) - spec['root_reference']
    delta.z = 0
    return delta


def axes_for_direction(index, settings):
    azimuth = math.radians(settings['azimuth'] + index * 360 / settings['directions'])
    elevation = math.radians(settings['elevation'])
    outward = Vector((math.sin(azimuth) * math.cos(elevation),
                      -math.cos(azimuth) * math.cos(elevation), math.sin(elevation)))
    rotation = (-outward).to_track_quat('-Z', 'Y')
    return outward, rotation, rotation @ Vector((1, 0, 0)), rotation @ Vector((0, 1, 0))


def configure_render(scene, pixels):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = pixels
    scene.render.resolution_y = pixels
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 30
    scene.display.render_aa = '16'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'MATERIAL'
    shading.show_shadows = False
    shading.show_cavity = True
    shading.cavity_type = 'BOTH'
    shading.cavity_ridge_factor = 0.8
    shading.cavity_valley_factor = 0.8
    shading.curvature_ridge_factor = 0.8
    shading.curvature_valley_factor = 0.8
    shading.show_object_outline = False
    shading.show_specular_highlight = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1


def pack_sheet(paths, destination, tile_size):
    """Use the accepted Blender pixel packing with top-left image rectangles."""
    columns, rows, width, height = sheet_layout(len(paths), tile_size, padding=PADDING_PIXELS)
    stride = tile_size + 2 * PADDING_PIXELS
    pixels = array('f', [0.0]) * (width * height * 4)
    rectangles = []
    for index, path in enumerate(paths):
        source = bpy.data.images.load(str(path), check_existing=False)
        try:
            if tuple(source.size) != (tile_size, tile_size):
                raise RuntimeError(f'Frame {path.name} has unexpected dimensions.')
            values = array('f', [0.0]) * (tile_size * tile_size * 4)
            source.pixels.foreach_get(values)
            x = (index % columns) * stride + PADDING_PIXELS
            y_top = (index // columns) * stride + PADDING_PIXELS
            y_bottom = height - y_top - tile_size
            for row in range(tile_size):
                start = ((y_bottom + row) * width + x) * 4
                source_start = row * tile_size * 4
                pixels[start:start + tile_size * 4] = values[source_start:source_start + tile_size * 4]
            rectangles.append({'x': x, 'y': y_top, 'w': tile_size, 'h': tile_size})
        finally:
            bpy.data.images.remove(source)
    atlas = bpy.data.images.new('__WF_STUDIO_SHEET__', width=width, height=height, alpha=True)
    try:
        atlas.alpha_mode = 'STRAIGHT'
        atlas.colorspace_settings.name = 'sRGB'
        atlas.pixels.foreach_set(pixels)
        atlas.filepath_raw = str(destination)
        atlas.file_format = 'PNG'
        atlas.save()
    finally:
        bpy.data.images.remove(atlas)
    return width, height, rectangles


def completed_frame(path, record, pixels):
    if not isinstance(record, dict) or not path.is_file():
        return False
    if path.stat().st_size != record.get('size') or file_digest(path) != record.get('sha256'):
        return False
    source = None
    try:
        source = bpy.data.images.load(str(path), check_existing=False)
        return tuple(source.size) == (pixels, pixels)
    except (OSError, RuntimeError):
        return False
    finally:
        if source is not None:
            bpy.data.images.remove(source)


def animation_specs(settings, rig, fps):
    specs = []
    for clip in settings['clips']:
        action = bpy.data.actions.get(clip['action'])
        if action is None:
            raise ValueError(f"Action {clip['action']!r} was not found.")
        slots = list(getattr(action, 'slots', ()))
        slot_infos = [action_slot_info(action, slot) for slot in slots]
        chosen = validate_slot_info(slot_infos, rig.name, clip['slot'])
        slot = next((slot for slot in slots if chosen and slot.identifier == chosen['identifier']), None)
        start = clip.get('start', float(action.frame_range[0]))
        end = clip.get('end', float(action.frame_range[1]))
        source_start, source_end = (float(value) for value in action.frame_range)
        if start < source_start or end > source_end:
            raise ValueError(f"Clip {clip['name']!r} extends outside its action frame range.")
        sampling = sample_animation(start, end, fps, settings['animation_fps'], clip['loop'])
        # Fail before producing frames when atlas packing would exhaust memory.
        sheet_layout(sampling['sample_count'], settings['pixels'])
        specs.append({**sampling, 'name': clip['name'], 'action': action, 'slot': slot,
                      'first': start, 'last': end, 'loop': clip['loop']})
    return specs


def prepare_state(out, settings, blend_path):
    signature = render_signature(settings, blend_path)
    state_path = out / 'render_state.json'
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding='utf-8'))
        if state.get('signature') != signature:
            raise ValueError('This result folder belongs to a different source or settings. Start a new render job.')
    else:
        if any((out / name).exists() for name in ('frames', 'sheets', 'sprites.json', 'READY')):
            raise ValueError('This result folder contains files without matching resume metadata. Start a new job.')
        state = {'schema': 'walking-fortress-render-state-v1', 'signature': signature,
                 'source_blend': str(blend_path), 'settings': settings, 'completed_frames': {}}
        write_json(state_path, state)
    if not isinstance(state.get('completed_frames'), dict):
        raise ValueError('The render resume metadata is invalid.')
    # Completion is only published again after every frame and sheet is checked.
    ready = out / 'READY'
    if ready.exists():
        ready.unlink()
    return state_path, state


def export(settings, output):
    if not bpy.data.filepath:
        raise RuntimeError('Open a saved animated .blend file first.')
    if bpy.context.mode.startswith('EDIT_'):
        raise RuntimeError('Leave Edit Mode and save the model before rendering.')
    original_scene = bpy.context.scene
    fps = original_scene.render.fps / original_scene.render.fps_base
    rig = bpy.data.objects.get(settings['rig'])
    if rig is None or rig.type != 'ARMATURE':
        raise ValueError('The chosen rig was not found or is not an armature.')
    meshes = [bpy.data.objects.get(name) for name in settings['meshes']]
    if any(obj is None or obj.type != 'MESH' for obj in meshes):
        raise ValueError('One or more selected mesh objects could not be found.')
    if settings['remove_root_motion'] and settings['root_motion_bone'] and (
        settings['root_motion_bone'] not in rig.pose.bones
    ):
        raise ValueError('The root motion bone was not found on the chosen rig.')
    pike_settings = settings.get('pike')
    pike = bpy.data.objects.get(pike_settings['object']) if pike_settings else None
    if pike_settings:
        if pike is None or pike.type != 'MESH':
            raise ValueError('The separate pike mesh object was not found.')
        if any(modifier.type == 'ARMATURE' for modifier in pike.modifiers):
            raise ValueError('The separate pike must be a rigid mesh parented to a bone, without an Armature modifier.')
    ink_settings = None
    if settings.get('render_style') == 'INK':
        from ink_render import saved_ink_setup
        ink_settings = saved_ink_setup(original_scene, meshes)
    specs = animation_specs(settings, rig, fps)
    for clip, spec in zip(settings['clips'], specs):
        clip['start'], clip['end'] = spec['first'], spec['last']
    out = Path(output).resolve()
    blend_path = Path(bpy.data.filepath).resolve()
    if out == blend_path.parent or out == blend_path:
        raise ValueError('Render into a separate results folder, away from the source model.')
    out.mkdir(parents=True, exist_ok=True)
    state_path, state = prepare_state(out, settings, blend_path)
    (out / 'frames').mkdir(exist_ok=True)
    (out / 'sheets').mkdir(exist_ok=True)
    had_animation_data = rig.animation_data is not None
    data = rig.animation_data_create()
    if data.use_tweak_mode:
        raise RuntimeError('Leave NLA Tweak Mode and save the model before rendering.')
    original_action = data.action
    original_slot = getattr(data, 'action_slot', None)
    saved_settings = {name: getattr(data, name) for name in (
        'use_nla', 'action_blend_type', 'action_influence', 'action_extrapolation')}
    original_frame, original_subframe = original_scene.frame_current, original_scene.frame_subframe
    scene = bpy.data.scenes.new('__WF_SPRITE_STUDIO__')
    camera = camera_data = ink_lines = None
    visibility = []
    try:
        linked = set()
        selected = set([rig] + meshes)
        for obj in [rig] + meshes + ([pike] if pike is not None else []):
            chain = obj
            while chain is not None:
                if chain not in linked:
                    scene.collection.objects.link(chain)
                    linked.add(chain)
                    visibility.append((chain, chain.hide_render))
                    chain.hide_render = chain not in selected
                chain = chain.parent
        scene.render.fps = original_scene.render.fps
        scene.render.fps_base = original_scene.render.fps_base
        scene.frame_start = math.floor(min(spec['first'] for spec in specs))
        scene.frame_end = math.ceil(max(spec['last'] for spec in specs))
        if ink_settings:
            from ink_render import configure_ink_render
            configure_ink_render(scene, original_scene, settings['pixels'])
        else:
            configure_render(scene, settings['pixels'])
        camera_data = bpy.data.cameras.new('__WF_STUDIO_CAMERA__')
        camera = bpy.data.objects.new('__WF_STUDIO_CAMERA__', camera_data)
        scene.collection.objects.link(camera)
        scene.camera = camera
        camera_data.type = 'ORTHO'
        camera_data.clip_start = 0.01
        camera_data.clip_end = 10000
        data.use_nla = False
        data.action_blend_type = 'REPLACE'
        data.action_influence = 1
        data.action_extrapolation = 'HOLD'
        axes = [axes_for_direction(index, settings) for index in range(settings['directions'])]
        with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
            activate_action(rig, specs[0])
            set_frame(scene, specs[0]['first'])
            depsgraph = bpy.context.evaluated_depsgraph_get()
            anchor_corners = world_corners([bpy.data.objects[settings['anchor_mesh']]], depsgraph)
            minimum = Vector(tuple(min(point[index] for point in anchor_corners) for index in range(3)))
            maximum = Vector(tuple(max(point[index] for point in anchor_corners) for index in range(3)))
            anchor = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
            xmin, xmax, ymin, ymax = math.inf, -math.inf, math.inf, -math.inf
            for spec in specs:
                spec['scan'] = framing_frames(spec['first'], spec['last'], spec['frames'])
            framing_total = sum(len(spec['scan']) for spec in specs)
            framed = 0
            progress('framing', 0, framing_total, 'Finding one common fit across all source poses and directions')
            for spec in specs:
                activate_action(rig, spec)
                set_frame(scene, spec['first'])
                depsgraph = bpy.context.evaluated_depsgraph_get()
                spec['root_reference'] = root_position(rig, depsgraph, settings['root_motion_bone']) if (
                    settings['remove_root_motion']) else Vector((0, 0, 0))
                for frame in spec['scan']:
                    set_frame(scene, frame)
                    depsgraph = bpy.context.evaluated_depsgraph_get()
                    delta = root_delta(rig, spec, depsgraph, settings)
                    for point in world_corners(meshes, depsgraph):
                        relative = point - delta - anchor
                        for outward, rotation, right, up in axes:
                            x, y = relative.dot(right), relative.dot(up)
                            xmin, xmax = min(xmin, x), max(xmax, x)
                            ymin, ymax = min(ymin, y), max(ymax, y)
                    framed += 1
                    if framed % 10 == 0 or framed == framing_total:
                        progress('framing', framed, framing_total, f"Checking {spec['name']} source poses")
            center_x, center_y = (xmin + xmax) / 2, (ymin + ymax) / 2
            fitted_scale = max(xmax - xmin, ymax - ymin) * (1 + 2 * settings['margin'])
            ortho_scale = settings.get('ortho_scale', fitted_scale)
            if ortho_scale < max(xmax - xmin, ymax - ymin):
                raise ValueError('The fixed ortho_scale is too small for the body poses; increase it to avoid clipping.')
            if not math.isfinite(ortho_scale) or ortho_scale <= 0:
                raise RuntimeError('The selected animated model has no usable bounds.')
            camera_data.ortho_scale = ortho_scale
            if ink_settings:
                from ink_render import InkSceneLines
                ink_lines = InkSceneLines(scene, ink_settings, meshes, camera,
                                          settings['pixels'], ortho_scale, scene.frame_start)
                scene.view_layers[0].update()
            distance = max(10.0, ortho_scale * 8)
            pixels = settings['pixels']
            pixels_per_world_unit = pixels / ortho_scale
            pivot = [pixels * (0.5 - center_x / ortho_scale), pixels * (0.5 + center_y / ortho_scale)]
            manifest = {
                'schema': 'walking-fortress-sprites-v1',
                'source_blend': str(blend_path), 'renderer': scene.render.engine,
                'source_fps': fps, 'tile_size': [pixels, pixels],
                'projection': 'orthographic', 'elevation_degrees': settings['elevation'],
                'first_azimuth_degrees': settings['azimuth'],
                'azimuth_step_degrees': 360 / settings['directions'],
                'direction_convention': 'camera position rotates from -Y toward +X around world Z',
                'origin_convention': 'image rectangles and pivots use top-left pixels',
                'ortho_scale': ortho_scale, 'feet_anchor_world': list(anchor),
                'pixels_per_world_unit': pixels_per_world_unit,
                'body_scale_reference': {
                    'mode': 'fixed_ortho_scale' if 'ortho_scale' in settings else 'body_bounds',
                    'ortho_scale': ortho_scale, 'pixels_per_world_unit': pixels_per_world_unit,
                    'body_height_world': maximum.z - minimum.z,
                    'body_objects': list(settings['meshes']),
                },
                'pivot_pixels': pivot, 'root_motion_bone': settings['root_motion_bone'],
                'root_motion': ('horizontal root travel removed by camera tracking' if
                                settings['remove_root_motion'] else 'source root travel preserved'),
                'source_objects': settings['meshes'], 'source_rig': rig.name,
                'source_settings': settings, 'animation_fps_requested': settings['animation_fps'],
                'blender_version': bpy.app.version_string,
                'sheet_padding_pixels': PADDING_PIXELS,
                'framing': {'source_and_sample_frames': True, 'shared_across_all_clips_and_directions': True},
                'clips': [],
            }
            if ink_settings:
                manifest['render_style'] = 'INK'
                manifest['ink_style'] = ink_lines.metadata()
            if pike_settings:
                manifest['attachment_convention'] = 'frame-local top-left pixels; points may be outside the body tile'
                manifest['separate_pike_object'] = pike.name
                if ink_settings:
                    manifest['pike_occlusion'] = 'body_depth_erase_operations_v1'
            render_total = sum(spec['sample_count'] for spec in specs) * settings['directions']
            sheet_total = len(specs) * settings['directions']
            rendered = sheet_count = reused = 0
            progress('render', 0, render_total, 'Rendering source poses')
            for spec in specs:
                activate_action(rig, spec)
                clip_info = {
                    'name': spec['name'], 'action': spec['action'].name,
                    'source_slot': spec['slot'].identifier if spec['slot'] is not None else None,
                    'source_start': spec['first'], 'source_end': spec['last'],
                    'loop': spec['loop'], 'duration_seconds': spec['duration_seconds'],
                    'sample_count': spec['sample_count'], 'playback_fps': spec['playback_fps'],
                    'animation_fps_requested': settings['animation_fps'], 'directions': [],
                }
                for direction_index, (outward, rotation, right, up) in enumerate(axes):
                    paths, entries = [], []
                    camera.rotation_euler = rotation.to_euler()
                    for sample_index, frame in enumerate(spec['frames']):
                        set_frame(scene, frame)
                        depsgraph = bpy.context.evaluated_depsgraph_get()
                        delta = root_delta(rig, spec, depsgraph, settings)
                        camera.location = anchor + delta + outward * distance + right * center_x + up * center_y
                        path = out / 'frames' / f"{spec['name']}_d{direction_index:02d}_f{sample_index:04d}.png"
                        relative_path = path.relative_to(out).as_posix()
                        record = state['completed_frames'].get(relative_path)
                        was_reused = completed_frame(path, record, pixels)
                        if was_reused:
                            reused += 1
                        else:
                            temporary = path.with_name(path.stem + '.part.png')
                            scene.render.filepath = str(temporary)
                            bpy.ops.render.render(write_still=True, scene=scene.name)
                            temporary.replace(path)
                            state['completed_frames'][relative_path] = {
                                'size': path.stat().st_size, 'sha256': file_digest(path),
                            }
                            write_json(state_path, state)
                        paths.append(path)
                        entries.append({
                            'index': sample_index, 'source_frame': frame,
                            'time_seconds': sample_index * spec['frame_duration_seconds'],
                            'duration_seconds': spec['frame_duration_seconds'],
                            'image': relative_path, 'root_offset_world': list(delta),
                        })
                        if pike_settings:
                            attachment = pike_attachment(
                                pike, depsgraph, pike_settings, anchor + delta, right, up,
                                pixels_per_world_unit, pivot,
                            )
                            if ink_settings:
                                from ink_render import style_pike, pike_depth_mask
                                attachment = style_pike(attachment, ink_settings)
                                attachment = pike_depth_mask(attachment, pike, depsgraph,
                                                             pike_settings, meshes, outward, distance)
                            entries[-1]['attachments'] = {'pike': attachment}
                        rendered += 1
                        progress('render', rendered, render_total,
                                 f"{'Reused' if was_reused else 'Rendered'} {spec['name']}, direction {direction_index + 1}, image {sample_index + 1}")
                    sheet = out / 'sheets' / f"{spec['name']}_d{direction_index:02d}.png"
                    width, height, rectangles = pack_sheet(paths, sheet, pixels)
                    for entry, rectangle in zip(entries, rectangles):
                        entry['rect'], entry['pivot_pixels'] = rectangle, list(pivot)
                    clip_info['directions'].append({
                        'index': direction_index,
                        'camera_azimuth_degrees': settings['azimuth'] + direction_index * 360 / settings['directions'],
                        'sheet': sheet.relative_to(out).as_posix(),
                        'sheet_size': [width, height], 'frames': entries,
                    })
                    sheet_count += 1
                    progress('sheets', sheet_count, sheet_total, f"Packed {spec['name']}, direction {direction_index + 1}")
                manifest['clips'].append(clip_info)
            manifest['render_summary'] = {'frames': rendered, 'reused_frames': reused, 'sheets': sheet_count}
            write_json(out / 'sprites.json', manifest)
            (out / 'READY').write_text('Export complete. Timing and sheet rectangles are in sprites.json.\n', encoding='utf-8')
            progress('complete', render_total, render_total, 'Sprite rendering complete')
    finally:
        data.action = original_action
        if original_slot is not None:
            data.action_slot = original_slot
        for name, value in saved_settings.items():
            setattr(data, name, value)
        if not had_animation_data:
            rig.animation_data_clear()
        for obj, hidden in visibility:
            obj.hide_render = hidden
        if ink_lines is not None:
            ink_lines.close()
        if camera is not None:
            bpy.data.objects.remove(camera, do_unlink=True)
        if camera_data is not None:
            bpy.data.cameras.remove(camera_data)
        bpy.data.scenes.remove(scene)
        original_scene.frame_set(original_frame, subframe=original_subframe)
    return out


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args(args)
    settings = normalized_settings(json.loads(options.config.read_text(encoding='utf-8-sig')))
    export(settings, options.output)


if __name__ == '__main__':
    main()
