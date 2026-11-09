"""Prepare all v2 poses and render paired sprites without saving source models.

Run in Blender 5.2 with --background --factory-startup --disable-autoexec MODEL
--python tools/export_v2_models.py -- --output DIR [--smoke].
"""
import argparse
import json
import math
from pathlib import Path
import re
import sys
from types import SimpleNamespace

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'sprite-studio/blender'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_sprites import (activate_action, animation_specs, axes_for_direction,
                            pike_attachment, root_delta, root_position, set_frame, world_corners)
from studio_blender import file_digest, framing_frames, normalized_settings
from ink_render import saved_ink_setup, style_pike, pike_depth_mask
import export_relightable


def prepare(output):
    source = Path(bpy.data.filepath).resolve()
    source_hash = file_digest(source)
    pikeman = source.stem == 'Pikeman'
    scene = bpy.context.scene
    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    sys.path.insert(0, str(ROOT / 'tools/blender'))
    import wf_ink_sprite
    if not hasattr(bpy.types.Scene, 'wf_ink'):
        wf_ink_sprite.register()
    meshes = [bpy.data.objects['Soldat']]
    if not pikeman:
        meshes.append(bpy.data.objects['Musket'])
    if not scene.wf_ink.studio_collection:
        # The source has dangling object material slots; isolate clean render data.
        for mesh in meshes:
            mesh.data = mesh.data.copy()
            mesh.data.materials.clear()
            mesh.data.materials.append(bpy.data.materials.new('__WF_V2_RENDER_BASE__'))
        bpy.ops.object.select_all(action='DESELECT')
        for mesh in meshes:
            mesh.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        assert bpy.ops.wf_ink.setup() == {'FINISHED'}
        # Match the saved Pikeman ink width in world units at a 512px reference.
        ink = scene.wf_ink
        ink.resolution = 512
        ink.ortho_scale = 2.401472330093384
        ink.outline_px = 8.0
        ink.detail_px = 7.760000228881836
        ink.base_color = (0.82, 0.76, 0.62, 1.0)
        ink.ink_color = (0, 0, 0, 1)
        ink.shadow_strength = 1.0
        ink.shadow_threshold = 0.5
        ink.shadow_softness = 0.0
        wf_ink_sprite._apply_settings(scene)
    ink = saved_ink_setup(scene, meshes)
    if hasattr(scene, 'eevee'):
        scene.eevee.taa_render_samples = 16
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    reference = output/'reference.json'
    if reference.exists():
        previous = json.loads(reference.read_text(encoding='utf-8'))
        paired = output/'sprites.json'
        known_hash = previous.get('source_sha256')
        if known_hash is None and paired.exists():
            known_hash = json.loads(paired.read_text(encoding='utf-8')).get('source_sha256')
        if known_hash != source_hash or previous.get('preparation_version', 1) != 1:
            raise ValueError('Existing export reference belongs to another model or configuration.')
        return reference
    clips = []
    metadata = {}
    for action in sorted(bpy.data.actions, key=lambda a: a.name):
        name = action.name
        if name.lower().startswith(('idle', 'ilde')):
            if pikeman and not name.startswith('Ilde'):
                continue
            exported = 'idle' + name[-1]
            kind, nominal, gait = 'idle', None, None
            first, last = 0, 95
        else:
            match = re.fullmatch(r'(Walk|Run)_([0-9.]+)m([0-9]+)', name)
            if not match:
                continue
            exported = name.lower().replace('.', '_')
            kind, nominal, gait = 'walk', float(match[2]), match[1].lower()
            first, last = 0, 47
        clips.append({'name': exported, 'action': name, 'slot': 'OBrig',
                      'start': first, 'end': last, 'loop': True})
        metadata[exported] = {'kind': kind, 'sourceAction': name}
        if nominal is not None:
            metadata[exported].update(nominalSpeed=nominal, gait=gait)
    settings = normalized_settings({'rig': 'rig', 'meshes': [o.name for o in meshes],
        'anchor_mesh': 'Soldat', 'clips': clips, 'pixels': 256, 'animation_fps': 6,
        'directions': 16, 'elevation': 30.049999237060547, 'azimuth': 45,
        'root_motion_bone': 'root', 'remove_root_motion': True, 'margin': 0.08,
        'render_style': 'INK'})
    rig = bpy.data.objects['rig']
    data = rig.animation_data_create()
    data.use_nla = False
    data.action_blend_type = 'REPLACE'
    data.action_influence = 1
    data.action_extrapolation = 'HOLD'
    fps = scene.render.fps / scene.render.fps_base
    specs = animation_specs(settings, rig, fps)
    axes = [axes_for_direction(i, settings) for i in range(16)]
    activate_action(rig, specs[0])
    set_frame(scene, 0)
    dg = bpy.context.evaluated_depsgraph_get()
    corners = world_corners([meshes[0]], dg)
    lower = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
    upper = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    anchor = Vector(((lower.x+upper.x)/2, (lower.y+upper.y)/2, lower.z))
    xmin, xmax, ymin, ymax = math.inf, -math.inf, math.inf, -math.inf
    for spec in specs:
        activate_action(rig, spec)
        set_frame(scene, spec['first'])
        dg = bpy.context.evaluated_depsgraph_get()
        spec['root_reference'] = root_position(rig, dg, 'root')
        for frame in framing_frames(spec['first'], spec['last'], spec['frames']):
            set_frame(scene, frame)
            dg = bpy.context.evaluated_depsgraph_get()
            delta = root_delta(rig, spec, dg, settings)
            for point in world_corners(meshes, dg):
                relative = point - delta - anchor
                for _, _, right, up in axes:
                    x, y = relative.dot(right), relative.dot(up)
                    xmin, xmax = min(xmin, x), max(xmax, x)
                    ymin, ymax = min(ymin, y), max(ymax, y)
        print('V2_FRAMED '+spec['name'], flush=True)
    center_x, center_y = (xmin+xmax)/2, (ymin+ymax)/2
    scale = max(xmax-xmin, ymax-ymin)*1.16
    ppu = 256/scale
    pivot = [256*(0.5-center_x/scale), 256*(0.5+center_y/scale)]
    manifest = {'schema': 'walking-fortress-sprites-v1', 'source_blend': str(source),
        'source_sha256': source_hash, 'preparation_version': 1, 'source_fps': fps, 'tile_size': [256,256], 'ortho_scale': scale,
        'feet_anchor_world': list(anchor), 'pivot_pixels': pivot,
        'pixels_per_world_unit': ppu, 'source_objects': [o.name for o in meshes],
        'source_rig': rig.name, 'source_settings': settings,
        'elevation_degrees': settings['elevation'], 'first_azimuth_degrees': 45,
        'azimuth_step_degrees': 22.5, 'normal_space': 'actor-blender-world',
        'body_scale_reference': {'pixels_per_world_unit':ppu,'body_height_world':upper.z-lower.z},
        'ink_style': {'strokes': [], 'setup_policy': 'saved Pikeman style; equivalent in-memory Musketeer setup'},
        'framing': {'source_and_sample_frames': True, 'shared_across_all_clips_and_directions': True},
        'clips': []}
    pike = bpy.data.objects.get('Pike') if pikeman else None
    if pike:
        zmin = min(v.co.z for v in pike.data.vertices)
        zmax = max(v.co.z for v in pike.data.vertices)
        settings['pike'] = {'object':pike.name, 'butt':[0,0,zmin], 'tip':[0,0,zmax],
            'grip':[0,0,(zmax-zmin)*0.18+zmin], 'width_world':pike.dimensions.x, 'layer':'front'}
        manifest['pike_occlusion'] = 'body_depth_erase_operations_v1'
    distance = max(10, scale*8)
    for spec in specs:
        activate_action(rig, spec)
        clip = {'name':spec['name'], 'action':spec['action'].name, 'source_slot':'OBrig',
            'source_start':spec['first'], 'source_end':spec['last'], 'loop':True,
            'duration_seconds':spec['duration_seconds'], 'sample_count':spec['sample_count'],
            'playback_fps':spec['playback_fps'], **metadata[spec['name']], 'directions':[]}
        # Evaluate each pose once; projecting and masking is camera dependent.
        for i, (outward, _, right, up) in enumerate(axes):
            frames = []
            for index, frame in enumerate(spec['frames']):
                set_frame(scene, frame)
                dg = bpy.context.evaluated_depsgraph_get()
                delta = root_delta(rig, spec, dg, settings)
                entry = {'index':index, 'source_frame':frame, 'root_offset_world':list(delta),
                         'pivot_pixels':list(pivot), 'duration_seconds':spec['frame_duration_seconds']}
                if pike:
                    attachment = pike_attachment(pike,dg,settings['pike'],anchor+delta,right,up,ppu,pivot)
                    attachment = style_pike(attachment,ink)
                    attachment = pike_depth_mask(attachment,pike,dg,settings['pike'],meshes,outward,distance)
                    entry['attachments'] = {'pike':attachment}
                frames.append(entry)
            clip['directions'].append({'index':i,'frames':frames})
        manifest['clips'].append(clip)
        print('V2_PREPARED '+spec['name'],flush=True)
    assert file_digest(source) == source_hash
    output.mkdir(parents=True, exist_ok=True)
    reference = output/'reference.json'
    export_relightable.write_json(reference,manifest)
    return reference


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--smoke',action='store_true')
    parser.add_argument('--shard-count',type=int,default=1)
    parser.add_argument('--shard-index',type=int,default=0)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    reference = prepare(args.output.resolve())
    export_relightable.main(SimpleNamespace(manifest=reference,output=args.output,pixels=256,smoke=args.smoke,
                                           shard_count=args.shard_count,shard_index=args.shard_index))



