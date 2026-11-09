"""Inspect a saved .blend without executing embedded scripts or saving it.

blender --background --factory-startup --disable-autoexec SOURCE.blend
--python inspect_model.py -- --output inspection.json
"""

import argparse
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from studio_blender import progress, write_json


def action_slot_info(action, slot, rigs=None):
    rigs = rigs if rigs is not None else [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']
    try:
        users = list(slot.users())
    except (AttributeError, TypeError, RuntimeError):
        users = []
    # Current assignment is also evidence on Blender versions without users().
    for obj in bpy.data.objects:
        data = obj.animation_data
        if data is not None and data.action == action and getattr(data, 'action_slot', None) == slot:
            if obj not in users:
                users.append(obj)
    target = getattr(slot, 'target_id_type', None)
    compatible = []
    if target == 'OBJECT':
        object_users = [obj for obj in users if isinstance(obj, bpy.types.Object)]
        if object_users:
            compatible = [rig.name for rig in rigs if rig in object_users]
        else:
            # Unassigned slots with known rig identifiers are safe. Unidentified
            # slots stay unselectable; the worker never guesses from slot order.
            compatible = [rig.name for rig in rigs if slot.identifier == 'OB' + rig.name]
    return {
        'identifier': slot.identifier,
        'target_id_type': target,
        'handle': getattr(slot, 'handle', None),
        'name_display': getattr(slot, 'name_display', slot.identifier),
        'users': [obj.name for obj in users],
        'compatible_rigs': compatible,
    }


def action_info(action, rigs):
    start, end = (float(value) for value in action.frame_range)
    return {
        'name': action.name, 'start': start, 'end': end,
        'frame_range': [start, end],
        'slots': [action_slot_info(action, slot, rigs) for slot in getattr(action, 'slots', ())],
        'is_legacy': bool(getattr(action, 'is_action_legacy', not getattr(action, 'slots', ()))),
    }


def nla_info(data):
    if data is None:
        return []
    tracks = []
    for track in data.nla_tracks:
        strips = []
        for strip in track.strips:
            action = getattr(strip, 'action', None)
            slot = getattr(strip, 'action_slot', None)
            strips.append({
                'name': strip.name, 'type': strip.type,
                'start': float(strip.frame_start), 'end': float(strip.frame_end),
                'action': action.name if action is not None else None,
                'slot': slot.identifier if slot is not None else None,
                'action_start': float(getattr(strip, 'action_frame_start', 0)),
                'action_end': float(getattr(strip, 'action_frame_end', 0)),
                'repeat': float(getattr(strip, 'repeat', 1)),
                'scale': float(getattr(strip, 'scale', 1)),
                'blend_type': getattr(strip, 'blend_type', None),
                'influence': float(getattr(strip, 'influence', 1)),
            })
        tracks.append({'name': track.name, 'mute': bool(track.mute),
                       'is_solo': bool(track.is_solo), 'strips': strips})
    return tracks



def saved_ink_info(scene):
    """Read the saved add-on via its registered properties, never model scripts."""
    if not any(obj.type == 'GREASEPENCIL' and obj.get('wf_ink_role') == 'lines'
               for obj in scene.objects):
        return {'available': False}
    from ink_render import saved_ink_setup
    try:
        settings = saved_ink_setup(scene)
    except (ValueError, RuntimeError):
        return {'available': False}
    meshes = [obj.name for obj in settings.source_collection.objects
              if obj.type == 'MESH' and obj.name in scene.objects]
    return {
        'available': bool(meshes), 'source_meshes': meshes,
        'resolution': settings.resolution,
        'azimuth': settings.azimuth, 'elevation': settings.elevation,
        'ortho_scale': settings.camera.data.ortho_scale,
    }


def inspect_model():
    if not bpy.data.filepath:
        raise RuntimeError('Open a saved .blend file before inspecting it.')
    scene = bpy.context.scene
    if scene.render.fps_base <= 0:
        raise RuntimeError('The source scene has an invalid fps base.')
    rigs = sorted((obj for obj in bpy.data.objects if obj.type == 'ARMATURE'), key=lambda obj: obj.name)
    custom_shapes = {
        bone.custom_shape for rig in rigs for bone in rig.pose.bones
        if bone.custom_shape is not None
    }
    objects = []
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        armature_modifiers = [modifier.object.name for modifier in obj.modifiers
                              if modifier.type == 'ARMATURE' and modifier.object is not None]
        widget = obj in custom_shapes or obj.name.lower().startswith(('wgt-', 'wgt_', 'wgts'))
        rig_parent = obj.parent is not None and obj.parent.type == 'ARMATURE'
        objects.append({
            'name': obj.name, 'type': obj.type,
            'parent': obj.parent.name if obj.parent is not None else None,
            'hide_render': bool(obj.hide_render),
            'dimensions': [float(value) for value in obj.dimensions],
            'collections': [collection.name for collection in obj.users_collection],
            'armature_modifiers': armature_modifiers,
            'modifiers': [{'name': modifier.name, 'type': modifier.type,
                           'object': getattr(getattr(modifier, 'object', None), 'name', None)}
                          for modifier in obj.modifiers],
            'is_rig_widget': widget,
            'default_selected': obj.type == 'MESH' and not widget and (
                bool(armature_modifiers) or rig_parent or not obj.hide_render),
        })
    rig_entries = []
    for rig in rigs:
        data = rig.animation_data
        action = data.action if data is not None else None
        slot = getattr(data, 'action_slot', None) if data is not None else None
        rig_entries.append({
            'name': rig.name, 'bones': [bone.name for bone in rig.data.bones],
            'bone_count': len(rig.data.bones),
            'active_action': action.name if action is not None else None,
            'active_slot': slot.identifier if slot is not None else None,
            'use_nla': bool(data.use_nla) if data is not None else False,
            'use_tweak_mode': bool(data.use_tweak_mode) if data is not None else False,
            'nla_tracks': nla_info(data),
        })
    return {
        'schema': 'walking-fortress-model-inspection-v1',
        'blend_path': str(Path(bpy.data.filepath).resolve()),
        'source_fps': scene.render.fps / scene.render.fps_base,
        'source_fps_numerator': scene.render.fps,
        'source_fps_base': scene.render.fps_base,
        'scene': scene.name,
        'scene_start': scene.frame_start, 'scene_end': scene.frame_end,
        'blender_version': bpy.app.version_string,
        'ink_style': saved_ink_info(scene),
        'objects': objects,
        'meshes': [obj for obj in objects if obj['type'] == 'MESH'],
        'rigs': rig_entries,
        'actions': [action_info(action, rigs) for action in sorted(bpy.data.actions, key=lambda item: item.name)],
        'animation_mode': 'standalone_actions',
        'nla_note': 'NLA tracks are listed separately; sprite rendering uses explicitly selected standalone actions.',
    }


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    options = parser.parse_args(args)
    progress('inspect', 0, 1, 'Inspecting model, rigs, actions and NLA tracks')
    write_json(options.output, inspect_model())
    progress('inspect', 1, 1, 'Model inspection complete')


if __name__ == '__main__':
    main()
