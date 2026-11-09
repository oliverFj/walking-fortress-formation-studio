"""Local, persistent background Blender jobs and versioned animation library.

Importing this module uses only Python's standard library. Blender and image
packages are used only by explicit inspect/render requests.
"""
from __future__ import annotations
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import threading
import uuid

SCHEMA='walking-fortress-animation-library-v1'
TERMINAL={'complete','failed','canceled'}
DEFAULT_BLENDER=Path('E:/Blender 5.2/blender.exe')
BUNDLED_PYTHON=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
BUNDLED_NODE=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def atomic_json(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temporary.replace(path)


def digest(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for data in iter(lambda:stream.read(1024*1024),b''):
            result.update(data)
    return result.hexdigest()


def character_id(value):
    value=re.sub(r'[^a-z0-9_-]+','-',str(value).lower()).strip('-')
    if not value:
        raise ValueError('Angiv et figurnavn med bogstaver eller tal.')
    return value[:64]


def source_path(value):
    if not isinstance(value,str) or not value.strip():
        raise ValueError('Vælg en gemt .blend-fil.')
    path=Path(value.strip().strip('"')).resolve()
    if path.suffix.lower()!='.blend' or not path.is_file():
        raise ValueError('Kildefilen skal være en eksisterende .blend-fil.')
    return path


class LibraryJobs:
    def __init__(self,root=None,*,state_root=None,library_root=None):
        self.root=Path(root or Path(__file__).resolve().parent).resolve()
        self.state=Path(state_root).resolve() if state_root else self.root/'.library-jobs'
        self.assets=Path(library_root).resolve() if library_root else self.root/'assets/library'
        if not self.state.is_relative_to(self.root) or not self.assets.is_relative_to(self.root):
            raise ValueError('Job- og bibliotekmapper skal ligge i formationsstudioet.')
        self.index_path=self.assets/'index.json'
        self.lock=threading.RLock()
        self.inspection_lock=threading.Lock()
        self.jobs={}; self.processes={}; self.queue=queue.Queue(); self.closed=False
        self.state.mkdir(parents=True,exist_ok=True)
        for file in self.state.glob('*/job.json'):
            try:
                job=json.loads(file.read_text(encoding='utf-8'))
                if job['status'] not in TERMINAL:
                    job.update(status='failed',phase='interrupted',error='Eksporten blev afbrudt, da tjenesten lukkede. Start en ny version.',message='Afbrudt eksport')
                    atomic_json(file,job)
                self.jobs[job['id']]=job
            except (ValueError,KeyError,OSError):
                continue
        self.worker=threading.Thread(target=self._worker,name='formation-library',daemon=True)
        self.worker.start()

    def capabilities(self):
        blender=self._blender(required=False)
        python=self._python(required=False)
        node=self._node(required=False)
        return {'blender':str(blender) if blender else None,'python':str(python) if python else None,'node':str(node) if node else None,'renderAvailable':bool(blender and python and node)}

    def _blender(self,requested=None,required=True):
        candidates=[requested,os.environ.get('FORMATION_BLENDER'),DEFAULT_BLENDER,shutil.which('blender')]
        for base in (Path('C:/Program Files/Blender Foundation'),Path('E:/Program Files/Blender Foundation')):
            if base.exists():
                candidates.extend(p/'blender.exe' for p in sorted(base.glob('Blender 5.*'),reverse=True))
        found=next((Path(p).resolve() for p in candidates if p and Path(p).is_file()),None)
        if required and not found:
            raise ValueError('Blender 5.2 eller nyere blev ikke fundet. Angiv Blender-programmets sti.')
        return found

    def _python(self,requested=None,required=True):
        for candidate in dict.fromkeys(str(p) for p in (requested,os.environ.get('FORMATION_RENDER_PYTHON'),BUNDLED_PYTHON,sys.executable) if p):
            if not Path(candidate).is_file():
                continue
            try:
                result=subprocess.run([candidate,'-c','import PIL, numpy'],capture_output=True,timeout=10)
                if result.returncode==0:
                    return Path(candidate).resolve()
            except (OSError,subprocess.TimeoutExpired):
                continue
        if required:
            raise ValueError('Eksport kræver en lokal Python med Pillow og NumPy. Angiv dens sti; normal brug af studiet kræver dem ikke.')
        return None

    def _node(self,requested=None,required=True):
        found=next((Path(p).resolve() for p in (requested,os.environ.get('FORMATION_NODE'),BUNDLED_NODE,shutil.which('node')) if p and Path(p).is_file()),None)
        if required and not found:
            raise ValueError('Node.js til den lokale pikepakning blev ikke fundet.')
        return found

    def inspect(self,path,blender=None):
        path=source_path(path); executable=self._blender(blender)
        source_hash=digest(path)
        worker_hash=digest(self.root/'tools/library_blender.py')[:12]
        cache=self.state/'inspections'/f'{source_hash}_{worker_hash}.json'
        with self.inspection_lock:
            if cache.is_file():
                result=json.loads(cache.read_text(encoding='utf-8'))
                # A copied source has the same actions but a different path.
                result['path']=str(path); result['blend_path']=str(path)
                return result
            cache.parent.mkdir(parents=True,exist_ok=True)
            command=self._blender_command(executable,path,'inspect',cache)
            kwargs={'creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)} if os.name=='nt' else {}
            try:
                result=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120,**kwargs)
            except subprocess.TimeoutExpired:
                raise ValueError('Blender kunne ikke undersøge figuren inden for to minutter.') from None
            if result.returncode or not cache.is_file():
                lines=(result.stdout+'\n'+result.stderr).splitlines()
                detail=next((line for line in reversed(lines) if 'Error:' in line or line.startswith(('ValueError:','RuntimeError:'))), '\n'.join(lines[-6:]))
                raise ValueError('Figuren kunne ikke undersøges. '+detail)
            if digest(path)!=source_hash:
                cache.unlink(missing_ok=True)
                raise ValueError('Kildefilen ændrede sig under undersøgelsen. Gem figuren og prøv igen.')
            return json.loads(cache.read_text(encoding='utf-8'))

    def _blender_command(self,blender,path,mode,output,config=None):
        result=[str(blender),'--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--threads','2',str(path),'--python',str(self.root/'tools/library_blender.py'),'--','--mode',mode,'--output',str(output)]
        if config:
            result.extend(['--config',str(config)])
        return result

    def _config(self,data,inspection):
        if not isinstance(data,dict):
            raise ValueError('Eksportindstillinger skal være et objekt.')
        settings=copy.deepcopy(data.get('settings') or inspection['settings'])
        if 'actions' in data:
            if not isinstance(data['actions'],list) or not data['actions']:
                raise ValueError('Vælg mindst én animation.')
            byid={a['id']:a for a in inspection['actions']}
            clips=[]
            for item in data['actions']:
                identifier=item.get('id') if isinstance(item,dict) else item
                if identifier not in byid:
                    raise ValueError('Ukendt animation: '+str(identifier))
                source=byid[identifier]
                clip={key:source[key] for key in ('action','slot','start','end','loop','kind','gait','nominalSpeed') if key in source}
                clip['name']=identifier
                if isinstance(item,dict):
                    clip.update({key:item[key] for key in ('name','start','end','loop','kind','gait','nominalSpeed','label') if key in item})
                clips.append(clip)
            settings['clips']=clips
        options=data.get('options') or {}
        for key in ('pixels','animation_fps','directions','elevation','azimuth','margin','remove_root_motion','root_motion_bone'):
            if key in options:
                settings[key]=options[key]
        if 'fps' in options:
            settings['animation_fps']=options['fps']
        if 'pike' in data:
            if data['pike'] is None or data['pike'] is False:
                settings.pop('pike',None)
            else:
                settings['pike']=copy.deepcopy(data['pike'])
        sys.path.insert(0,str(self.root/'tools/library_support'))
        from studio_blender import normalized_settings, sample_animation
        normalized=normalized_settings(settings)
        # Retain semantic metadata omitted by the shared Blender validator.
        for target,source in zip(normalized['clips'],settings['clips']):
            for key in ('kind','gait','nominalSpeed','label','tags'):
                if key in source:
                    target[key]=copy.deepcopy(source[key])
        if normalized['pixels']<64:
            raise ValueError('Renderstørrelse skal være mindst 64 pixel.')
        objects={o['name']:o for o in inspection['objects']}
        if normalized['rig']!=inspection['rig']:
            raise ValueError('Skelettet skal være det undersøgte karakterskelet.')
        if any(name not in objects or objects[name]['type']!='MESH' for name in normalized['meshes']):
            raise ValueError('En valgt kropsmesh findes ikke i figuren.')
        if normalized.get('pike') and normalized['pike']['object'] not in objects:
            raise ValueError('Det valgte pikeobjekt findes ikke i figuren.')
        actions={a['action']:a for a in inspection['actions']}
        total=0
        for clip in normalized['clips']:
            if clip['action'] not in actions:
                raise ValueError('Animationen er ikke knyttet til figuren: '+clip['action'])
            action=actions[clip['action']]
            if clip['slot']!=action['slot']:
                raise ValueError('Animationens slot passer ikke til figuren.')
            raw=next(a for a in inspection['actions'] if a['action']==clip['action'])
            # Exported defaults can exclude a loop closing pose; original raw
            # action bounds remain authoritative for edited frame ranges.
            full=next(a for a in inspection.get('sourceActions',[]) if a['name']==clip['action']) if inspection.get('sourceActions') else None
            lo,hi=(full['frame_range'] if full else (raw['start'],raw['end']+1 if raw['loop'] else raw['end']))
            start=clip.get('start',lo); end=clip.get('end',hi)
            if start<lo or end>hi:
                raise ValueError('Animationsudsnittet ligger uden for actionens frames.')
            total+=sample_animation(start,end,inspection['sourceFps'],normalized['animation_fps'],clip['loop'])['sample_count']*normalized['directions']
        if total>50000:
            raise ValueError('Eksporten overstiger 50.000 billeder. Vælg færre animationer eller lavere billedfrekvens.')
        style=copy.deepcopy(data.get('pikeStyle',settings.get('pikeStyle',inspection.get('pikeStyle',{}))))
        if style is None:
            style={}
        if not isinstance(style,dict):
            raise ValueError('Pikestilen skal være et objekt.')
        for key in ('stroke_width','head_length','head_width','head_stroke_width'):
            value=style.get(key)
            if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not 0<=value<=1000):
                raise ValueError('Pikens '+key+' skal være en positiv afstand i meter.')
        for key in ('ink','paper'):
            if key in style and not re.fullmatch(r'#[0-9a-fA-F]{6}',str(style[key])):
                raise ValueError('Pikens farve skal være #RRGGBB.')
        size=options.get('size',options.get('atlasSize',data.get('size',100)))
        if isinstance(size,bool) or not isinstance(size,(int,float)) or size!=int(size) or not 32<=size<=1024:
            raise ValueError('Atlasmålestok skal være 32–1024 pixel.')
        return {'settings':normalized,'pikeStyle':style,'size':int(size),'totalPairs':total}

    def submit(self,data):
        if self.closed:
            raise ValueError('Bibliotekstjenesten er lukket.')
        if not isinstance(data,dict):
            raise ValueError('Eksportindstillinger skal være et objekt.')
        path=source_path(data.get('path'))
        blender=self._blender(data.get('blender')); python=self._python(data.get('python')); node=self._node(data.get('node'))
        inspection=self.inspect(str(path),blender)
        config=self._config(data,inspection)
        label=str(data.get('label') or inspection['label']).strip()[:120]
        cid=character_id(data.get('characterId') or label)
        jid=datetime.now().strftime('%Y%m%d_%H%M%S')+'_'+uuid.uuid4().hex[:8]
        job={'id':jid,'status':'queued','phase':'queued','message':'Eksporten står i kø','progress':{'done':0,'total':config['totalPairs']},'createdAt':now(),'label':label,'characterId':cid,'path':str(path),'sourceHash':inspection['sourceHash'],'log':[], 'config':config,'executables':{'blender':str(blender),'python':str(python),'node':str(node)}}
        with self.lock:
            self.jobs[jid]=job; self._save(job)
        self.queue.put(jid)
        return self.status(jid)

    def _save(self,job):
        atomic_json(self.state/job['id']/'job.json',job)

    def status(self,jid):
        with self.lock:
            if jid not in self.jobs:
                raise KeyError('Eksportjobbet findes ikke.')
            result=copy.deepcopy(self.jobs[jid])
            result.pop('executables',None); result.pop('config',None)
            return result

    def list_jobs(self):
        with self.lock:
            return [self.status(jid) for jid in sorted(self.jobs,reverse=True)]

    def cancel(self,jid):
        with self.lock:
            if jid not in self.jobs:
                raise KeyError('Eksportjobbet findes ikke.')
            job=self.jobs[jid]
            if job['status'] in TERMINAL:
                return self.status(jid)
            job.update(status='canceled',phase='canceled',message='Eksporten er aflyst',finishedAt=now())
            self._save(job)
            process=self.processes.get(jid)
            if process and process.poll() is None:
                process.terminate()
        return self.status(jid)

    def _run(self,jid,command,phase):
        with self.lock:
            job=self.jobs[jid]
            if job['status']=='canceled':
                return False
            job.update(status='packing' if phase=='packing' else 'running',phase=phase,message='Pakker billedbibliotek' if phase=='packing' else 'Renderer figuren')
            self._save(job)
        kwargs={'creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)} if os.name=='nt' else {}
        process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',**kwargs)
        with self.lock:
            self.processes[jid]=process
            if self.jobs[jid]['status']=='canceled':
                process.terminate()
        logpath=self.state/jid/'render.log'
        with logpath.open('a',encoding='utf-8') as log:
            for line in process.stdout:
                line=line.rstrip(); log.write(line+'\n'); log.flush()
                with self.lock:
                    job=self.jobs[jid]
                    if job['status']=='canceled':
                        continue
                    job['log']=(job['log']+[line])[-32:]
                    match=re.match(r'WF_RELIGHT_PROGRESS (\d+)/(\d+)',line)
                    if match:
                        job['progress']={'done':int(match[1]),'total':int(match[2])}
                        job['message']=f'Renderet {match[1]} af {match[2]} billedpar'
                    elif line.startswith(('LIBRARY_FRAMED ','LIBRARY_PREPARED ')):
                        job['message']='Forbereder '+line.split(' ',1)[1]
                    if match or line.startswith(('LIBRARY_FRAMED ','LIBRARY_PREPARED ','ValueError:','RuntimeError:','ImportError:')):
                        self._save(job)
        result=process.wait()
        with self.lock:
            self.processes.pop(jid,None)
            if self.jobs[jid]['status']=='canceled':
                return False
        if result:
            raise RuntimeError('Blender-eksport fejlede' if phase=='render' else 'Atlaspakning fejlede')
        return True

    def _worker(self):
        while True:
            jid=self.queue.get()
            if jid is None:
                return
            try:
                self._execute(jid)
            except Exception as exc:
                with self.lock:
                    job=self.jobs[jid]
                    if job['status']!='canceled':
                        details=next((line for line in reversed(job['log']) if line.startswith(('ValueError:','RuntimeError:','ImportError:','Error:','Atlas er'))),str(exc))
                        job.update(status='failed',phase='failed',message='Eksporten mislykkedes',error=details,finishedAt=now()); self._save(job)
            finally:
                self.queue.task_done()

    def _execute(self,jid):
        with self.lock:
            job=copy.deepcopy(self.jobs[jid])
        if job['status']=='canceled':
            return
        source=Path(job['path'])
        if digest(source)!=job['sourceHash']:
            raise ValueError('Kildefilen er ændret siden valget. Undersøg og start en ny eksport.')
        folder=self.state/jid; configpath=folder/'config.json'; atomic_json(configpath,job['config'])
        raw=folder/'raw'; version_dir=self.assets/job['characterId']/jid
        ex=job['executables']
        if not self._run(jid,self._blender_command(ex['blender'],source,'render',raw,configpath),'render'):
            return
        command=[ex['python'],str(self.root/'library_packer.py'),'--source',str(raw),'--out',str(version_dir),'--size',str(job['config']['size']),'--node',ex['node'],'--id',job['characterId'],'--label',job['label']]
        if not self._run(jid,command,'packing'):
            return
        if digest(source)!=job['sourceHash']:
            raise ValueError('Kildefilen blev ændret under eksporten; versionen er ikke registreret.')
        data=json.loads((version_dir/'character.json').read_text(encoding='utf-8'))
        clips=[{'id':name,'name':name,**{key:clip[key] for key in ('action','kind','gait','nominalSpeed','duration','frameCount','loop') if key in clip}} for name,clip in data['clips'].items()]
        version={'id':jid,'createdAt':now(),'characterUrl':self._url(version_dir/'character.json'),'previewUrl':self._url(version_dir/'preview.png'),'sourcePath':job['path'],'sourceHash':job['sourceHash'],'clips':clips,'directionCount':data['directionCount'],'pageCount':len(data.get('pages') or [None]),'activeRoles':[],'settings':job['config']['settings'],'pikeStyle':job['config'].get('pikeStyle',{})}
        with self.lock:
            if self.jobs[jid]['status']=='canceled':
                return
            index=self._read_index()
            character=next((c for c in index['characters'] if c['id']==job['characterId']),None)
            if not character:
                character={'id':job['characterId'],'label':job['label'],'versions':[]}; index['characters'].append(character)
            character['label']=job['label']; character['versions'].append(version)
            atomic_json(version_dir/'version.json',version); atomic_json(self.index_path,index)
            self.jobs[jid].update(status='complete',phase='complete',message='Alle animationer er tilføjet biblioteket',progress={'done':job['config']['totalPairs'],'total':job['config']['totalPairs']},finishedAt=now(),version=version)
            self._save(self.jobs[jid])

    def _url(self,path):
        return str(Path(path).resolve().relative_to(self.root)).replace('\\','/')

    def _read_index(self):
        if self.index_path.is_file():
            result=json.loads(self.index_path.read_text(encoding='utf-8'))
            if result.get('schema')!=SCHEMA:
                raise ValueError('Figurbibliotekets format er ukendt.')
            return result
        return {'schema':SCHEMA,'characters':[]}

    def library(self):
        with self.lock:
            result=self._read_index()
        registry_path=self.root/'assets/characters.json'
        registry=json.loads(registry_path.read_text(encoding='utf-8')) if registry_path.is_file() else {'characters':{},'roles':{}}
        entries=registry.get('characters',{})
        if isinstance(entries,list):
            entries={entry['id']:entry for entry in entries}
        roles=registry.get('roles',{})
        seeds={cid:{'manifest':f'{cid}/character.json','label':label} for cid,label in (('pikeman','Pikener'),('musketeer','Musketer')) if (registry_path.parent/cid/'character.json').is_file()}
        candidates=[*seeds.items(),*entries.items()]
        for cid,entry in candidates:
            # Existing shipped figures appear immediately without copying them.
            url=entry.get('manifest') or entry.get('metadata') or entry.get('url') or entry.get('character')
            if not url:
                continue
            path=(registry_path.parent/url).resolve()
            if not path.is_relative_to(self.root) or not path.is_file():
                continue
            character=next((c for c in result['characters'] if c['id']==cid),None)
            if not character:
                character={'id':cid,'label':entry.get('label',cid),'versions':[]}; result['characters'].append(character)
            target=self._url(path)
            if not any(v['characterUrl']==target for v in character['versions']):
                data=json.loads(path.read_text(encoding='utf-8'))
                character['versions'].insert(0,{'id':'bundled','createdAt':None,'characterUrl':target,'previewUrl':self._url(path.parent/'preview.png'),'sourcePath':self._bundled_source(cid,path),'clips':[{'id':name,'name':name,**{key:clip[key] for key in ('action','kind','gait','nominalSpeed','duration','frameCount') if key in clip}} for name,clip in data['clips'].items()],'directionCount':data['directionCount'],'activeRoles':[]})
        for character in result['characters']:
            for version in character['versions']:
                version['activeRoles']=[role for role,cid in roles.items() if cid==character['id'] and cid in entries and self._url((registry_path.parent/(entries[cid].get('manifest') or entries[cid].get('metadata') or entries[cid].get('url') or entries[cid].get('character'))).resolve())==version['characterUrl']]
        result['jobs']=self.list_jobs()
        return result

    def _bundled_source(self,cid,path):
        report=path.parent/'build_report.json'
        if report.is_file():
            try:
                folder=Path(json.loads(report.read_text(encoding='utf-8'))['sourceFolder'])
                raw=folder/'sprites.json'
                if raw.is_file():
                    source=Path(json.loads(raw.read_text(encoding='utf-8'))['source_blend'])
                    if source.is_file():
                        return str(source.resolve())
            except (OSError,ValueError,KeyError):
                pass
        name={'pikeman':'Pikeman','musketeer':'Musketeer'}.get(cid)
        source=self.root.parent/'assets/musketeer/v2models'/f'{name}.blend'
        return str(source.resolve()) if name and source.is_file() else None

    def close(self):
        self.closed=True
        with self.lock:
            for jid,job in list(self.jobs.items()):
                if job['status'] not in TERMINAL:
                    self.cancel(jid)
        self.queue.put(None)
