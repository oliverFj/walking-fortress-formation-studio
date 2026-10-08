"""Export relightable paired sprites without saving or changing the source .blend.

Run with Blender 5.2 in background; --manifest references the prior framing and
animation metadata. A matching interrupted export can be resumed in place.
"""
import argparse
import copy
import hashlib
import json
import math
import struct
from pathlib import Path
import sys
import time

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'sprite-studio' / 'blender'))
from render_sprites import activate_action, axes_for_direction, set_frame
from ink_render import saved_ink_setup, configure_ink_render, InkSceneLines, _srgb_hex
from studio_blender import file_digest


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def scale_attachment(pike, scale):
    result = copy.deepcopy(pike)
    for name in ('grip', 'butt', 'tip'):
        if name in result:
            result[name] = [float(v) * scale for v in result[name]]
    for name in ('width', 'stroke_width', 'head_length', 'head_width', 'head_stroke_width'):
        if name in result:
            result[name] *= scale
    for op in result.get('operations', []):
        op['points'] = [[v * scale for v in point] for point in op.get('points', [])]
        op['width'] *= scale
    return result


def export_manifest(source, pixels, source_hash, reference_hash):
    result = copy.deepcopy(source)
    old_pixels = source['tile_size'][0]
    scale = pixels / old_pixels
    result.update(schema='walking-fortress-relightable-source-v1', tile_size=[pixels, pixels],
                  normal_space='actor-blender-world', normal_encoding='RGB8-linear-signed',
                  normal_channels='RGB = 0.5 * unit normal + 0.5; A = mesh coverage',
                  normal_axes={'x': 'actor right', 'y': 'actor south', 'z': 'up'},
                  source_sha256=source_hash, reference_manifest_sha256=reference_hash,
                  albedo_policy='saved base colour and texture, GP contour/folds, WF Shadow Strength disabled on copied material',
                  normal_policy='evaluated smooth world normals, unlit emission, Raw view, no transfer function, no GP ink',
                  pixels_per_world_unit=pixels/source['ortho_scale'],
                  pivot_pixels=[v*scale for v in source['pivot_pixels']])
    result['source_settings']['pixels'] = pixels
    result['body_scale_reference']['pixels_per_world_unit'] *= scale
    result.pop('render_summary', None)
    for stroke in result.get('ink_style', {}).get('strokes', []):
        stroke['width_pixels'] *= scale
    if result.get('ink_style'):
        result['ink_style']['material_graphs'] = 'copied material graphs; WF Shadow Strength zeroed only'
    for clip in result['clips']:
        for direction in clip['directions']:
            direction.pop('sheet', None)
            direction.pop('sheet_size', None)
            for frame in direction['frames']:
                filename = f"{clip['name']}_d{direction['index']:02d}_f{frame['index']:04d}.png"
                frame['albedo'] = 'albedo/' + filename
                frame['image'] = frame['albedo']
                frame['normal'] = 'normals/' + filename
                frame.pop('rect', None)
                frame['pivot_pixels'] = [v*scale for v in frame['pivot_pixels']]
                if frame.get('attachments', {}).get('pike'):
                    frame['attachments']['pike'] = scale_attachment(frame['attachments']['pike'], scale)
    return result


def strip_normal_png_tags(path):
    """Retain pixel data verbatim and remove colour-transfer declarations.

    Blender writes an sRGB tag even with its Raw view. Normals are data, so the
    encoded RGB must never be interpreted through a colour transfer function.
    """
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('The rendered normal map is not a PNG.')
    parts, offset, changed = [data[:8]], 8, False
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        end = offset+length+12
        if kind in (b'sRGB', b'gAMA', b'cHRM', b'iCCP'):
            changed = True
        else:
            parts.append(data[offset:end])
        offset = end
    if changed:
        temporary = path.with_suffix('.linear.tmp')
        temporary.write_bytes(b''.join(parts))
        temporary.replace(path)
    return changed

def normal_material():
    material = bpy.data.materials.new('__WF_RELIGHT_NORMAL__')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    links = material.node_tree.links
    normal = nodes.new('ShaderNodeNewGeometry')
    encode = nodes.new('ShaderNodeVectorMath')
    encode.operation = 'MULTIPLY_ADD'
    encode.inputs[1].default_value = (0.5, 0.5, 0.5)
    encode.inputs[2].default_value = (0.5, 0.5, 0.5)
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Strength'].default_value = 1.0
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(normal.outputs['Normal'], encode.inputs[0])
    links.new(encode.outputs['Vector'], emission.inputs['Color'])
    links.new(emission.outputs['Emission'], output.inputs['Surface'])
    return material


def valid_pair_record(path, record, pixels):
    if not record or not path.is_file() or path.stat().st_size != record.get('size'):
        return False
    return file_digest(path) == record.get('sha256')


def main(options):
    source = json.loads(options.manifest.read_text(encoding='utf-8-sig'))
    source_path = Path(bpy.data.filepath).resolve()
    expected = Path(source['source_blend']).resolve()
    if source_path != expected:
        raise ValueError('The opened model is not the source model named by the reference manifest.')
    if bpy.app.version < (5, 2, 0):
        raise ValueError('Blender 5.2 or newer is required.')
    pixels = options.pixels
    if pixels < 64 or pixels > 2048:
        raise ValueError('pixels must be between64 and2048.')
    output = options.output.resolve()
    if output == source_path.parent or output == source_path:
        raise ValueError('Use a separate export directory.')
    output.mkdir(parents=True, exist_ok=True)
    for directory in ('albedo', 'normals'):
        (output/directory).mkdir(exist_ok=True)
    source_hash = file_digest(source_path)
    signature = hashlib.sha256((source_hash+file_digest(options.manifest)+str(pixels)+'normal-export-v1').encode()).hexdigest()
    state_path = output/'render_state.json'
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding='utf-8'))
        if state.get('signature') != signature:
            raise ValueError('Resume output belongs to another model or rendering configuration.')
    else:
        state = {'schema': 'walking-fortress-relight-state-v1', 'signature': signature, 'completed': {}}
    source_scene = bpy.context.scene
    meshes = [bpy.data.objects[name] for name in source['source_objects']]
    rig = bpy.data.objects[source['source_rig']]
    ink = saved_ink_setup(source_scene, meshes)
    manifest = export_manifest(source, pixels, source_hash, file_digest(options.manifest))
    manifest['ink_style'].update({
        'shadow_mode': 'runtime-solid', 'shadow_strength': ink.shadow_strength,
        'shadow_threshold': ink.shadow_threshold, 'shadow_softness': ink.shadow_softness,
        'shadow_azimuth_degrees': ink.shadow_azimuth, 'shadow_elevation_degrees': ink.shadow_elevation,
        'ink_srgb': _srgb_hex(ink.ink_color), 'base_srgb': _srgb_hex(ink.base_color),
        'source_shadow_mode': ink.shadow_mode,
    })
    write_json(output/'sprites.json', manifest)
    write_json(state_path, state)
    pairs = [(clip, direction, frame) for clip in manifest['clips'] for direction in clip['directions'] for frame in direction['frames']]
    if options.smoke:
        pairs = [p for p in pairs if p[0]['name']=='walk' and p[1]['index'] in (0,4,8,12) and p[2]['index']==0]
    total = len(pairs)
    scene = bpy.data.scenes.new('__WF_RELIGHT_EXPORT__')
    camera = camera_data = lines = normal = None
    visibility = []
    material_slots, copied_materials = [], []
    data = rig.animation_data_create()
    original_action = data.action
    original_slot = getattr(data, 'action_slot', None)
    saved_animation = {name: getattr(data, name) for name in ('use_nla','action_blend_type','action_influence','action_extrapolation')}
    source_frame = (source_scene.frame_current, source_scene.frame_subframe)
    start = time.monotonic()
    try:
        linked = set()
        selected = {rig, *meshes}
        for obj in [rig, *meshes]:
            chain = obj
            while chain:
                if chain not in linked:
                    scene.collection.objects.link(chain)
                    linked.add(chain)
                    visibility.append((chain, chain.hide_render))
                    chain.hide_render = chain not in selected
                chain = chain.parent
        configure_ink_render(scene, source_scene, pixels)
        scene.render.fps, scene.render.fps_base = source_scene.render.fps, source_scene.render.fps_base
        scene.frame_start = int(min(c['source_start'] for c in manifest['clips']))
        scene.frame_end = int(max(c['source_end'] for c in manifest['clips']))
        # All material changes are isolated copies and are restored in finally.
        cache = {}
        shadow_material_count = 0
        for obj in meshes:
            for slot in obj.material_slots:
                original = slot.material
                if original is None:
                    continue
                material_slots.append((slot, original))
                if original not in cache:
                    copied = original.copy()
                    copied.name = '__WF_RELIGHT_ALBEDO_' + original.name
                    cache[original] = copied
                    copied_materials.append(copied)
                    if copied.use_nodes:
                        strength = copied.node_tree.nodes.get('WF Shadow Strength')
                        if strength:
                            strength.inputs[1].default_value = 0.0
                            shadow_material_count += 1
                slot.material = cache[original]
        if shadow_material_count == 0:
            raise ValueError('No saved WF Shadow Strength node found; cannot guarantee unshadowed albedo.')
        camera_data = bpy.data.cameras.new('__WF_RELIGHT_CAMERA__')
        camera = bpy.data.objects.new('__WF_RELIGHT_CAMERA__', camera_data)
        scene.collection.objects.link(camera)
        scene.camera = camera
        camera_data.type = 'ORTHO'
        camera_data.ortho_scale = manifest['ortho_scale']
        camera_data.clip_start, camera_data.clip_end = 0.01, 10000.0
        lines = InkSceneLines(scene, ink, meshes, camera, pixels, manifest['ortho_scale'], scene.frame_start)
        normal = normal_material()
        data.use_nla=False
        data.action_blend_type='REPLACE'
        data.action_influence=1.0
        data.action_extrapolation='HOLD'
        settings = source['source_settings']
        axes = [axes_for_direction(i, settings) for i in range(settings['directions'])]
        anchor = Vector(source['feet_anchor_world'])
        scale = source['ortho_scale']
        pivot = source['pivot_pixels']
        reference_pixels = source['tile_size'][0]
        center_x = (0.5 - pivot[0]/reference_pixels)*scale
        center_y = (pivot[1]/reference_pixels - 0.5)*scale
        distance = max(10.0, scale*8.0)
        original_view = {name: getattr(scene.view_settings, name) for name in ('view_transform','look','exposure','gamma')}
        last_clip = None
        with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
            for i, (clip, direction, frame) in enumerate(pairs):
                if clip['name'] != last_clip:
                    action = bpy.data.actions[clip['action']]
                    slot = next((s for s in action.slots if s.identifier==clip['source_slot']), None)
                    activate_action(rig, {'action':action, 'slot':slot})
                    last_clip = clip['name']
                set_frame(scene, frame['source_frame'])
                outward, rotation, right, up = axes[direction['index']]
                camera.rotation_euler = rotation.to_euler()
                camera.location = anchor + Vector(frame['root_offset_world']) + outward*distance + right*center_x + up*center_y
                scene.view_layers[0].update()
                for pass_name in ('albedo','normal'):
                    relative = frame[pass_name]
                    path = output/relative
                    if valid_pair_record(path, state['completed'].get(relative), pixels):
                        if pass_name == 'normal' and strip_normal_png_tags(path):
                            state['completed'][relative] = {'size':path.stat().st_size,'sha256':file_digest(path)}
                            write_json(state_path,state)
                        continue
                    if pass_name == 'albedo':
                        lines.object.hide_render=False
                        scene.view_layers[0].material_override=None
                        for name,value in original_view.items():
                            setattr(scene.view_settings,name,value)
                    else:
                        lines.object.hide_render=True
                        scene.view_layers[0].material_override=normal
                        scene.view_settings.view_transform='Raw'
                        scene.view_settings.look='None'
                        scene.view_settings.exposure=0.0
                        scene.view_settings.gamma=1.0
                    scene.view_layers[0].update()
                    temporary = path.with_name(path.stem+'.part.png')
                    scene.render.filepath = str(temporary)
                    bpy.ops.render.render(write_still=True, scene=scene.name)
                    if pass_name == 'normal':
                        strip_normal_png_tags(temporary)
                    temporary.replace(path)
                    state['completed'][relative]={'size':path.stat().st_size,'sha256':file_digest(path)}
                    write_json(state_path,state)
                elapsed=time.monotonic()-start
                print(f'WF_RELIGHT_PROGRESS {i+1}/{total} {clip["name"]} direction{direction["index"]} frame{frame["index"]} elapsed={elapsed:.1f}s', flush=True)
                write_json(output/'progress.json', {'completed_pairs':i+1,'total_pairs':total,'elapsed_seconds':elapsed,'smoke':options.smoke})
        manifest['render_summary']={'frames':total,'passes':2,'smoke':options.smoke,'seconds':time.monotonic()-start}
        write_json(output/'sprites.json',manifest)
        if not options.smoke:
            (output/'READY').write_text('Paired albedo and actor-space normal frames complete.\n',encoding='utf-8')
        print('WF_RELIGHT_COMPLETE '+str(output),flush=True)
    finally:
        scene.view_layers[0].material_override=None
        data.action=original_action
        if original_slot is not None:
            data.action_slot=original_slot
        for name,value in saved_animation.items():
            setattr(data,name,value)
        for slot,material in material_slots:
            slot.material=material
        for obj,hidden in visibility:
            obj.hide_render=hidden
        if lines:
            lines.close()
        if camera:
            bpy.data.objects.remove(camera,do_unlink=True)
        if camera_data:
            bpy.data.cameras.remove(camera_data)
        bpy.data.scenes.remove(scene)
        if normal:
            bpy.data.materials.remove(normal)
        for material in copied_materials:
            bpy.data.materials.remove(material)
        source_scene.frame_set(source_frame[0], subframe=source_frame[1])
        if file_digest(source_path)!=source_hash:
            raise RuntimeError('Source model changed during export.')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--pixels',type=int,default=256)
    parser.add_argument('--smoke',action='store_true')
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    OPTIONS=parser.parse_args(argv)
    main(OPTIONS)