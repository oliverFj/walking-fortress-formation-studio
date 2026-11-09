"""Inspect a saved character or render its actions; never save the source .blend."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from types import SimpleNamespace

import bpy
from mathutils import Vector
SUPPORT = Path(__file__).resolve().parent / 'library_support'
sys.path.insert(0, str(SUPPORT))
from inspect_model import inspect_model
from studio_blender import file_digest, framing_frames, normalized_settings, sample_animation, write_json
from render_sprites import activate_action, animation_specs, axes_for_direction, pike_attachment, root_delta, root_position, set_frame, world_corners
from ink_render import saved_ink_setup, style_pike, pike_depth_mask
import relightable


def slug(value):
    value = re.sub(r'[^a-zA-Z0-9_-]+', '_', value).strip('_')
    return (value or 'animation')[:54]


def related_to(obj, rig):
    if any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers):
        return True
    parent = obj.parent
    while parent:
        if parent == rig:
            return True
        parent = parent.parent
    return False


def inspect_character():
    raw = inspect_model()
    rigs = [bpy.data.objects[r['name']] for r in raw['rigs']]
    if not rigs:
        raise ValueError('Figuren har intet animationsskelet.')
    candidates = [m for m in raw['meshes'] if not m['is_rig_widget']]
    scored = sorted(((sum(related_to(bpy.data.objects[m['name']], rig) for m in candidates), rig.name) for rig in rigs), reverse=True)
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        raise ValueError('Flere lige sandsynlige skeletter. Gem en figur med ét tydeligt karakterskelet.')
    rig = bpy.data.objects[scored[0][1]]
    names = [m['name'] for m in candidates if related_to(bpy.data.objects[m['name']], rig)]
    saved = raw.get('ink_style', {})
    if saved.get('available'):
        names = [n for n in saved['source_meshes'] if n in names] or saved['source_meshes']
    if not names:
        raise ValueError('Ingen kropsmeshes er knyttet til skelet ' + rig.name)
    pikes = [m for m in candidates if m['name'].lower() in ('pike','piken','pike_mesh','spear') and related_to(bpy.data.objects[m['name']],rig)]
    pike = None
    if len(pikes) == 1:
        obj = bpy.data.objects[pikes[0]['name']]
        low = min(v.co.z for v in obj.data.vertices)
        high = max(v.co.z for v in obj.data.vertices)
        pike = {'object':obj.name,'butt':[0,0,low],'tip':[0,0,high], 'grip':[0,0,low+(high-low)*.18], 'width_world':max(.000001,float(obj.dimensions.x)), 'layer':'front'}
        names = [n for n in names if n != obj.name]
    if not names:
        raise ValueError('Der skal være en krop ud over piken.')
    fps = raw['source_fps']
    actions, clips, warnings = [], [], []
    used = set()
    for action in raw['actions']:
        compatible = [s for s in action['slots'] if rig.name in s['compatible_rigs']]
        if action['slots'] and len(compatible) != 1:
            warnings.append('Udeladt action uden entydig skeletslot: ' + action['name'])
            continue
        slot = compatible[0]['identifier'] if compatible else None
        name = action['name']; lower = name.lower()
        idle = lower.startswith(('idle','ilde','stand'))
        move = lower.startswith(('walk','run','march','jog'))
        kind = 'idle' if idle else 'walk' if move else 'action'
        gait = 'run' if lower.startswith(('run','jog')) else 'walk' if move else None
        match = re.search(r'([0-9]+(?:\.[0-9]+)?)m',lower)
        nominal = float(match[1]) if match and move else (3.0 if gait=='run' else 1.5 if move else None)
        first,last = action['frame_range']
        # Only the documented v2 actions store closing poses at frame48/96.
        # Other models retain their complete saved action range.
        v2 = Path(bpy.data.filepath).stem in ('Musketeer','Pikeman') and rig.name == 'rig' and 'Soldat' in names
        if v2 and (idle or move) and first == 0 and last in (48,96):
            last -= 1
        clipname = slug(name).lower()
        if clipname in used:
            clipname += '_' + hashlib.sha256(name.encode()).hexdigest()[:6]
        used.add(clipname)
        selected = not (Path(bpy.data.filepath).stem.lower() == 'pikeman' and name.startswith('Idle') and any(a['name'].startswith('Ilde') for a in raw['actions']))
        sampling = sample_animation(first,last,fps,6,idle or move)
        clip = {'name':clipname,'action':name,'slot':slot,'start':first,'end':last,'loop':idle or move,'kind':kind}
        if move:
            clip.update(gait=gait,nominalSpeed=nominal)
        info = {'id':clipname,'name':name,**clip,'duration':sampling['duration_seconds'],'frameCount':sampling['sample_count'],'selected':selected}
        # Display the original Blender name, retaining a separate safe clip id.
        info['name'] = name
        actions.append(info)
        if selected:
            clips.append(clip)
    if not clips:
        raise ValueError('Ingen animationer er entydigt knyttet til skelet ' + rig.name)
    if any(not a['selected'] for a in actions):
        warnings.append('Pikemans arvede musketer-stilstandsposer er fravalgt; alle actions vises og kan vælges.')
    width = pike['width_world'] if pike else .03
    pike_style = {'units':'world','ink':'#000000','paper':'#eadccb','stroke_width':width/4,'head_length':width*7,'head_width':width*3.5,'head_stroke_width':width/4}
    try:
        ink = saved_ink_setup(bpy.context.scene)
        from ink_render import _srgb_hex
        pike_style.update(ink=_srgb_hex(ink.ink_color),paper=_srgb_hex(ink.base_color))
    except ValueError:
        warnings.append('Stregstil oprettes i hukommelsen under eksport; kildefilen gemmes ikke.')
    bones = {b.name for b in rig.data.bones}
    settings = {'rig':rig.name,'meshes':names,'anchor_mesh':max(names,key=lambda n:float(bpy.data.objects[n].dimensions.z)), 'clips':clips,'pixels':256,'animation_fps':6,'directions':16,'azimuth':45,'elevation':30.049999237060547,'root_motion_bone':'root' if 'root' in bones else None,'remove_root_motion':True,'margin':.08,'render_style':'INK'}
    if pike:
        settings['pike'] = pike
    return {**raw,'path':raw['blend_path'],'label':Path(raw['blend_path']).stem,'sourceHash':file_digest(raw['blend_path']),'sourceFps':fps,'rig':rig.name,'bodyObjects':names,'sourceActions':raw['actions'],'actions':actions,'pike':pike,'pikeStyle':pike_style,'settings':settings,'warnings':warnings}


def ensure_ink(meshes):
    scene = bpy.context.scene
    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    import wf_ink_sprite
    if not hasattr(bpy.types.Scene,'wf_ink'):
        wf_ink_sprite.register()
    try:
        return saved_ink_setup(scene,meshes)
    except ValueError:
        # Match the saved v2 style on copied material/mesh data only.
        for mesh in meshes:
            mesh.data = mesh.data.copy()
            mesh.data.materials.clear()
            mesh.data.materials.append(bpy.data.materials.new('__WF_LIBRARY_RENDER_BASE__'))
        bpy.ops.object.select_all(action='DESELECT')
        for mesh in meshes:
            mesh.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if bpy.ops.wf_ink.setup() != {'FINISHED'}:
            raise ValueError('Stregstil kunne ikke oprettes for figuren.')
        ink = scene.wf_ink
        ink.resolution=512; ink.ortho_scale=2.401472330093384
        ink.outline_px=8.0; ink.detail_px=7.760000228881836
        ink.base_color=(.82,.76,.62,1); ink.ink_color=(0,0,0,1)
        ink.shadow_strength=1; ink.shadow_threshold=.5; ink.shadow_softness=0
        wf_ink_sprite._apply_settings(scene)
        return saved_ink_setup(scene,meshes)


def prepare(config,output):
    source = Path(bpy.data.filepath).resolve(); source_hash=file_digest(source)
    source_settings=config['settings']
    metadata={c['name']:{key:c[key] for key in ('kind','gait','nominalSpeed','label','tags') if key in c} for c in source_settings['clips']}
    settings=normalized_settings(source_settings)
    pixels=settings['pixels']; scene=bpy.context.scene
    meshes=[bpy.data.objects[n] for n in settings['meshes']]
    rig=bpy.data.objects[settings['rig']]
    ink=ensure_ink(meshes)
    if hasattr(scene,'eevee'):
        scene.eevee.taa_render_samples=16
    scene.view_settings.view_transform='Standard'; scene.view_settings.look='None'; scene.view_settings.exposure=0; scene.view_settings.gamma=1
    data=rig.animation_data_create(); data.use_nla=False; data.action_blend_type='REPLACE'; data.action_influence=1; data.action_extrapolation='HOLD'
    fps=scene.render.fps/scene.render.fps_base
    specs=animation_specs(settings,rig,fps)
    axes=[axes_for_direction(i,settings) for i in range(settings['directions'])]
    activate_action(rig,specs[0]); set_frame(scene,specs[0]['first']); dg=bpy.context.evaluated_depsgraph_get()
    anchor_mesh=bpy.data.objects[settings['anchor_mesh']]
    corners=world_corners([anchor_mesh],dg)
    lower=Vector(tuple(min(p[i] for p in corners) for i in range(3))); upper=Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    anchor=Vector(((lower.x+upper.x)/2,(lower.y+upper.y)/2,lower.z))
    xmin,xmax,ymin,ymax=math.inf,-math.inf,math.inf,-math.inf
    for spec in specs:
        activate_action(rig,spec); set_frame(scene,spec['first']); dg=bpy.context.evaluated_depsgraph_get(); spec['root_reference']=root_position(rig,dg,settings['root_motion_bone'])
        for frame in framing_frames(spec['first'],spec['last'],spec['frames']):
            set_frame(scene,frame); dg=bpy.context.evaluated_depsgraph_get(); delta=root_delta(rig,spec,dg,settings)
            for point in world_corners(meshes,dg):
                relative=point-delta-anchor
                for _,_,right,up in axes:
                    x,y=relative.dot(right),relative.dot(up)
                    xmin,xmax=min(xmin,x),max(xmax,x); ymin,ymax=min(ymin,y),max(ymax,y)
        print('LIBRARY_FRAMED '+spec['name'],flush=True)
    center_x,center_y=(xmin+xmax)/2,(ymin+ymax)/2
    scale=max(xmax-xmin,ymax-ymin)*(1+2*settings['margin'])
    if not math.isfinite(scale) or scale<=0:
        raise ValueError('Figurens kameraramme er tom eller ugyldig.')
    ppu=pixels/scale; pivot=[pixels*(.5-center_x/scale),pixels*(.5+center_y/scale)]
    manifest={'schema':'walking-fortress-sprites-v1','source_blend':str(source),'source_sha256':source_hash,'preparation_version':1,'source_fps':fps,'tile_size':[pixels,pixels],'ortho_scale':scale,'feet_anchor_world':list(anchor),'pivot_pixels':pivot,'pixels_per_world_unit':ppu,'source_objects':settings['meshes'],'source_rig':rig.name,'source_settings':settings,'elevation_degrees':settings['elevation'],'first_azimuth_degrees':settings['azimuth'],'azimuth_step_degrees':360/settings['directions'],'normal_space':'actor-blender-world','body_scale_reference':{'pixels_per_world_unit':ppu,'body_height_world':upper.z-lower.z},'ink_style':{'strokes':[],'setup_policy':'saved style or equivalent copied in-memory setup'},'framing':{'source_and_sample_frames':True,'shared_across_all_clips_and_directions':True},'clips':[]}
    pike_settings=settings.get('pike'); pike=bpy.data.objects[pike_settings['object']] if pike_settings else None
    if pike:
        manifest['pike_occlusion']='body_depth_erase_operations_v1'
    style=config.get('pikeStyle') or {}
    distance=max(10,scale*8)
    for spec in specs:
        activate_action(rig,spec)
        clip={'name':spec['name'],'action':spec['action'].name,'source_slot':spec['slot'].identifier if spec['slot'] else None,'source_start':spec['first'],'source_end':spec['last'],'loop':spec['loop'],'duration_seconds':spec['duration_seconds'],'sample_count':spec['sample_count'],'playback_fps':spec['playback_fps'],**metadata[spec['name']],'directions':[]}
        for i,(outward,_,right,up) in enumerate(axes):
            frames=[]
            for index,frame in enumerate(spec['frames']):
                set_frame(scene,frame); dg=bpy.context.evaluated_depsgraph_get(); delta=root_delta(rig,spec,dg,settings)
                entry={'index':index,'source_frame':frame,'root_offset_world':list(delta),'pivot_pixels':list(pivot),'duration_seconds':spec['frame_duration_seconds']}
                if pike:
                    attachment=pike_attachment(pike,dg,pike_settings,anchor+delta,right,up,ppu,pivot)
                    attachment=style_pike(attachment,ink)
                    for key in ('stroke_width','head_length','head_width','head_stroke_width'):
                        if key in style:
                            attachment[key]=style[key]*ppu
                    for key in ('ink','paper'):
                        if key in style:
                            attachment[key]=style[key]
                    attachment=pike_depth_mask(attachment,pike,dg,pike_settings,meshes,outward,distance)
                    entry['attachments']={'pike':attachment}
                frames.append(entry)
            clip['directions'].append({'index':i,'frames':frames})
        manifest['clips'].append(clip)
        print('LIBRARY_PREPARED '+spec['name'],flush=True)
    if file_digest(source)!=source_hash:
        raise RuntimeError('Kildefilen blev ændret under eksport.')
    reference=output/'reference.json'; write_json(reference,manifest)
    return reference


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',choices=('inspect','render'),required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--config',type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    if args.mode=='inspect':
        write_json(args.output,inspect_character()); return
    config=json.loads(args.config.read_text(encoding='utf-8'))
    args.output.mkdir(parents=True,exist_ok=True)
    reference=prepare(config,args.output)
    relightable.main(SimpleNamespace(manifest=reference,output=args.output,pixels=config['settings']['pixels'],smoke=False,shard_count=1,shard_index=0))

if __name__=='__main__':
    main()
