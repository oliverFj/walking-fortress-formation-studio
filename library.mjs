import {Renderer} from './renderer.mjs';
import {normalizeLighting} from './lighting.mjs';
import {animationClips} from './animation.mjs';
import {normalizePikeAppearance,scalePikeCorners} from './pike-appearance.mjs';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const LIVE_JOBS = new Set(['queued','running','packing','canceling']);
const states = {queued:'I kø',running:'Renderer',packing:'Pakker bibliotek',complete:'Færdig',failed:'Fejlet',canceled:'Afbrudt',cancelled:'Afbrudt',canceling:'Afbryder'};
let library = {characters:[]}, jobs = [], inspection = null, clipChoices = [], sourceBusy = false;
let selected = null, renderer = null, originalData = null, previewClip = null, previewTime = 0, playing = true, lastTick = 0, previewToken = 0;
let refreshing = false, toastTimer, pollTimer;
let pikeAppearance = normalizePikeAppearance(), savedPikeAppearance = normalizePikeAppearance(), pikeAppearanceReady = false, appearanceSaving = false;
const appearanceFields = [['darkness','preview-pike-darkness'],['opacity','preview-pike-opacity'],['widthScale','preview-pike-width']];
const pikeState = {grip:[0,0,0],butt:[0,0,0],tip:[0,0,1]};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function message(text, error = false) {
  $('toast').textContent = text; $('toast').hidden = false;
  $('toast').classList.toggle('error-message', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('toast').hidden = true;}, 5500);
}
async function api(path, body) {
  const response = await fetch('/api/library' + path, body === undefined ? {cache:'no-store'} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  });
  let result;
  try {result = await response.json();} catch {throw new Error('Tjenesten svarede ikke med biblioteksdata. Genstart formationsstudioets tjeneste, hvis den kørte før biblioteket blev tilføjet.');}
  if (!response.ok || result.error) throw new Error(typeof result.error === 'string' ? result.error : result.message || 'Handlingen kunne ikke udføres.');
  return result;
}
const characters = () => Array.isArray(library.characters) ? library.characters : Object.entries(library.characters || {}).map(([id, value]) => ({id,...value}));
const versions = character => Array.isArray(character.versions) ? character.versions : Object.entries(character.versions || {}).map(([id, value]) => ({id,...value}));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clipName = clip => clip.name || clip.id || clip.action;
const dateLabel = date => date ? new Date(date).toLocaleString('da-DK', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Medfølgende version';
const clipList = version => Array.isArray(version.clips) ? version.clips : Object.values(version.clips || {});
function activeRoles(version) {return version.activeRoles || version.roles || [];}
function setSourceBusy(value) {
  sourceBusy = value;
  for (const id of ['blend-path','inspect-blend','pick-blend']) $(id).disabled = value;
  $('render-all').disabled = value || !clipChoices.some(clip => clip.selected);
}

function drawLibrary() {
  const container = $('character-library'); container.replaceChildren();
  const items = characters();
  if (!items.length) container.append(el('p','empty-message','Biblioteket er klar til din første figur. Vælg en .blend-fil til venstre.'));
  for (const character of items) {
    const section = el('section','catalog-character'); section.append(el('h3',null,character.label || character.id));
    const source=[...versions(character)].reverse().find(version=>version.sourcePath);
    if(source) {const again=el('button','small quiet','Render igen');again.type='button';again.dataset.rerender=character.id;again.onclick=()=>renderAgain(character,source).catch(error=>message(error.message,true));section.append(again);}
    for (const version of [...versions(character)].reverse()) {
      const button = el('button','catalog-version'); button.type = 'button'; button.dataset.character = character.id; button.dataset.version = version.id;
      const isSelected = selected?.character.id === character.id && selected?.version.id === version.id;
      button.classList.toggle('active',isSelected); button.setAttribute('aria-pressed',String(isSelected));
      const previewUrl = version.previewUrl || version.preview;
      if (previewUrl) {const image=el('img'); image.src=previewUrl; image.alt=''; image.loading='lazy'; button.append(image);}
      const desc = el('span','version-description'); desc.append(el('strong',null,dateLabel(version.createdAt)));
      const clips = clipList(version); desc.append(el('small',null,clips.length ? `${clips.length} animationer` : 'Figur & animationer'));
      const roles = activeRoles(version);
      if (roles.length) desc.append(el('small','active-role',roles.map(role => role === 'pike' ? 'Pikener i studiet' : role === 'shot' ? 'Musketer i studiet' : role).join(' · ')));
      button.append(desc); button.onclick=() => selectVersion(character,version).catch(error => message(error.message,true)); section.append(button);
    }
    container.append(section);
  }
  const chosen = $('character-choice').value;
  $('character-choice').replaceChildren(new Option('Ny figur',''));
  for (const character of items) $('character-choice').append(new Option(character.label || character.id,character.id));
  if (items.some(character => character.id === chosen)) $('character-choice').value = chosen;
}
async function renderAgain(character,version) {
  if(sourceBusy) return;
  $('blend-path').value=version.sourcePath;
  await inspectSource();
  if(!inspection) return;
  $('character-choice').value=character.id;$('character-label').value=character.label || character.id;
  if(version.settings) {
    const pike=version.settings.pike || null;
    const meshes=(inspection.meshes || []).map(object=>typeof object==='string'?object:object.name);
    if(!pike || meshes.includes(pike.object)) {
      inspection.pike=structuredClone(pike);inspection.settings.pike=structuredClone(pike);
      inspection.pikeStyle=structuredClone(version.pikeStyle || version.settings.pikeStyle || inspection.pikeStyle || {});
      populatePike();
    } else $('source-status').textContent+=' Den tidligere pike findes ikke i denne fil; filens nye pikeindstillinger bruges.';
  }
  $('source-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function drawJobs() {
  const container = $('render-jobs'), focused = document.activeElement?.dataset.jobId;
  const expanded = new Set([...container.querySelectorAll('details[open]')].map(node => node.dataset.jobId));
  container.replaceChildren();
  if (!jobs.length) {container.append(el('p','hint','Ingen renderinger endnu.')); return;}
  for (const job of [...jobs].reverse()) {
    const card = el('article','job'); card.dataset.id = job.id; card.classList.toggle('failed',job.status === 'failed');
    const heading = el('div','job-heading'); heading.append(el('strong',null,job.label || 'Figur'),el('span',null,states[job.status] || job.status)); card.append(heading);
    card.append(el('p',null,job.error || job.message || job.phase || 'Forbereder rendering…'));
    if (LIVE_JOBS.has(job.status)) {
      const progress = el('progress');
      const done = number(job.progress?.done), total = number(job.progress?.total);
      if (total > 0) {progress.max=total; progress.value=done; progress.setAttribute('aria-label',`${done} af ${total} billeder`); card.append(el('p',null,`${done.toLocaleString('da-DK')} / ${total.toLocaleString('da-DK')}`));}
      else progress.setAttribute('aria-label','Rendering i gang');
      card.append(progress);
      const cancel = el('button','quiet','Afbryd'); cancel.type='button'; cancel.dataset.jobId=job.id;
      cancel.onclick=async () => {cancel.disabled=true;try {await api('/jobs/'+encodeURIComponent(job.id)+'/cancel',{}); await refreshLibrary();} catch(error) {message(error.message,true);cancel.disabled=false;}}; card.append(cancel);
    }
    if (job.status === 'complete') {
      const open=el('button',null,'Se version'); open.type='button';
      open.onclick=() => {
        const found=characters().flatMap(character => versions(character).map(version => ({character,version}))).find(item => item.version.id === (job.version?.id || job.versionId));
        if(found) selectVersion(found.character,found.version).catch(error=>message(error.message,true)); else message('Versionen vises i biblioteket til højre.');
      };card.append(open);
    }
    if (job.log?.length) {const detail=el('details');detail.dataset.jobId=job.id;detail.open=expanded.has(job.id);detail.append(el('summary',null,'Detaljer'),el('pre',null,job.log.slice(-15).join('\n')));card.append(detail);}
    container.append(card);
  }
  if (focused) [...container.querySelectorAll('button')].find(button=>button.dataset.jobId===focused)?.focus();
}
async function refreshLibrary() {
  if (refreshing) return;
  refreshing = true;
  try {
    const result = await api(''); library = result.library || result; jobs = result.jobs || library.jobs || [];
    drawLibrary(); drawJobs();
    $('library-status').textContent=''; $('library-status').classList.remove('error-message');
    if (result.capabilities?.filePicker === false) {$('pick-blend').disabled=true; $('pick-blend').title='Indsæt filens fulde sti i feltet.';}
    if (!selected) {
      const first=characters().flatMap(character=>versions(character).map(version=>({character,version}))).find(item=>activeRoles(item.version).includes('pike')) || characters().flatMap(character=>versions(character).map(version=>({character,version})))[0];
      if(first) await selectVersion(first.character,first.version);
    } else {
      const character=characters().find(item=>item.id===selected.character.id), version=character&&versions(character).find(item=>item.id===selected.version.id);
      if(version) {
        selected={character,version}; updateActivation();
        if(pikeAppearanceReady&&!appearanceSaving&&!appearanceChanged()) restorePikeAppearance();
      }
    }
  } catch(error) {$('library-status').textContent=error.message;$('library-status').classList.add('error-message');}
  finally {
    refreshing=false; clearTimeout(pollTimer);
    if(jobs.some(job=>LIVE_JOBS.has(job.status))) pollTimer=setTimeout(refreshLibrary,2500);
  }
}

function chosenClips() {return clipChoices.filter(clip=>clip.selected).map(({selected,frameCount,duration,id,...clip})=>clip);}
function updateRenderCount() {
  const selectedClips=clipChoices.filter(clip=>clip.selected), frames=selectedClips.reduce((total,clip)=>total+Math.max(1,number(clip.frameCount,Math.ceil(number(clip.duration)*6))),0);
  $('render-count').textContent=`${selectedClips.length} animationer · ${(frames*16).toLocaleString('da-DK')} billedpar`;
  $('render-all').disabled=sourceBusy || !selectedClips.length;
  $('select-all').textContent=clipChoices.length&&clipChoices.every(clip=>clip.selected)?'Fravælg alle':'Vælg alle';
}
function drawClips() {
  const container=$('clip-list');container.replaceChildren();
  for(const clip of clipChoices) {
    const card=el('div','clip-card'), label=el('label','clip-name'), check=el('input');check.type='checkbox';check.checked=clip.selected;check.dataset.action=clip.action;
    check.onchange=()=>{clip.selected=check.checked;updateRenderCount();};label.append(check,el('span',null,clip.name || clip.action));card.append(label);
    const detail=el('div','clip-detail');detail.append(el('span',null,`${number(clip.duration).toLocaleString('da-DK',{maximumFractionDigits:2})} s`),el('span',null,`${clip.frameCount} billeder / vinkel`),el('span',null,`${clip.start}–${clip.end} i Blender`));card.append(detail);
    const typeRow=el('div','clip-kind'),type=el('select');type.setAttribute('aria-label','Type for '+(clip.name||clip.action));
    for(const [value,text] of [['idle','Stilstand'],['walk','Gang'],['run','Løb'],['action','Anden animation']]) type.append(new Option(text,value));
    type.value=clip.kind==='walk'?(clip.gait==='run'?'run':'walk'):clip.kind==='idle'?'idle':'action';
    const speedLabel=el('label',null,'m/s'), speed=el('input');speed.type='number';speed.min='.01';speed.max='20';speed.step='.1';speed.value=number(clip.nominalSpeed,1.5);speed.setAttribute('aria-label','Ganghastighed for '+(clip.name||clip.action));speedLabel.append(speed);
    const syncType=()=>{const moving=['walk','run'].includes(type.value);speedLabel.hidden=!moving;};syncType();
    type.onchange=()=>{clip.kind=['walk','run'].includes(type.value)?'walk':type.value; if(clip.kind==='walk'){clip.gait=type.value;clip.nominalSpeed=number(speed.value,1.5);} else {delete clip.gait;delete clip.nominalSpeed;}syncType();};
    speed.onchange=()=>{clip.nominalSpeed=number(speed.value,1.5);};typeRow.append(type,speedLabel);card.append(typeRow);
    const rangeRow=el('div','clip-range');
    const updateRange=()=>{clip.duration=Math.max(1,clip.end-clip.start+1)/number(inspection.sourceFps,24);clip.frameCount=Math.max(1,Math.ceil(clip.duration*6-1e-8));detail.replaceChildren(el('span',null,`${clip.duration.toLocaleString('da-DK',{maximumFractionDigits:2})} s`),el('span',null,`${clip.frameCount} billeder / vinkel`),el('span',null,`${clip.start}–${clip.end} i Blender`));updateRenderCount();};
    for(const [key,text] of [['start','Fra'],['end','Til']]){const field=el('label',null,text),input=el('input');input.type='number';input.step='1';input.value=clip[key];input.setAttribute('aria-label',text+' frame for '+(clip.name||clip.action));input.onchange=()=>{const value=input.valueAsNumber;if(!Number.isFinite(value)||Math.abs(value)>100000){input.value=clip[key];return;}clip[key]=value;if(clip.end<clip.start){clip.end=clip.start;rangeRow.querySelector('[data-range=end]').value=clip.end;}updateRange();};input.dataset.range=key;field.append(input);rangeRow.append(field);}
    const loopLabel=el('label','loop-choice'),loop=el('input');loop.type='checkbox';loop.checked=clip.loop!==false;loop.onchange=()=>{clip.loop=loop.checked;updateRange();};loopLabel.append(loop,document.createTextNode('Løkke'));rangeRow.append(loopLabel);card.append(rangeRow);container.append(card);
  }
  updateRenderCount();
}
function populatePike() {
  const pike=inspection.pike || inspection.settings?.pike, style=inspection.pikeStyle || inspection.settings?.pikeStyle || {};
  $('pike-enabled').checked=!!pike;
  const meshes=inspection.meshes || inspection.bodyObjects || [];
  $('pike-object').replaceChildren(new Option('Vælg pikeobjekt',''));
  for(const object of meshes) {const name=typeof object==='string'?object:object.name;if(name) $('pike-object').append(new Option(name,name));}
  if(pike?.object && ![...$('pike-object').options].some(option=>option.value===pike.object)) $('pike-object').append(new Option(pike.object,pike.object));
  $('pike-object').value=pike?.object || '';
  for(const name of ['grip','butt','tip']) {
    pikeState[name]=[...(pike?.[name] || (name==='tip'?[0,0,1]:[0,0,0]))];
    for(const [index,axis] of ['x','y','z'].entries()) $('pike-'+name+'-'+axis).value=pikeState[name][index];
  }
  const width=number(pike?.width_world,.02);
  for(const [id,value] of [['pike-width',width],['pike-stroke',style.stroke_width ?? width/4],['pike-head-length',style.head_length ?? width*7],['pike-head-width',style.head_width ?? width*3.5],['pike-head-stroke',style.head_stroke_width ?? width/4]]) $(id).value=Math.round(value*1000000)/10000;
  $('pike-layer').value=pike?.layer || 'front';$('pike-ink').value=style.ink || '#000000';$('pike-paper').value=style.paper || '#eadccb';
  $('pike-details').open=false; syncPikeEnabled();
}
function syncPikeEnabled() {
  for(const input of $('pike-details').querySelectorAll('input,select')) if(input.id!=='pike-enabled') input.disabled=!$('pike-enabled').checked;
}
function pikeSettings() {
  if(!$('pike-enabled').checked) return {pike:null,pikeStyle:null};
  if(!$('pike-object').value) throw new Error('Vælg pikeobjektet, eller slå den separate pike fra.');
  const pike={object:$('pike-object').value,layer:$('pike-layer').value,width_world:$('pike-width').valueAsNumber/100};
  for(const name of ['grip','butt','tip']) {pike[name]=['x','y','z'].map(axis=>$('pike-'+name+'-'+axis).valueAsNumber);if(!pike[name].every(Number.isFinite)) throw new Error('Pikens punkter skal have tal i X, Y og Z.');}
  if(!(pike.width_world>0) || Math.hypot(...pike.tip.map((value,index)=>value-pike.butt[index]))<.001) throw new Error('Piken skal have en bredde, og bagende og spids skal være forskellige punkter.');
  const pikeStyle={units:'world',ink:$('pike-ink').value,paper:$('pike-paper').value};
  for(const [id,key] of [['pike-stroke','stroke_width'],['pike-head-length','head_length'],['pike-head-width','head_width'],['pike-head-stroke','head_stroke_width']]) {pikeStyle[key]=$(id).valueAsNumber/100;if(!Number.isFinite(pikeStyle[key])||pikeStyle[key]<0) throw new Error('Pikens tykkelser og spidsmål skal være positive tal eller nul.');}
  return {pike,pikeStyle};
}
async function inspectSource(event) {
  event?.preventDefault();if(sourceBusy) return;
  const path=$('blend-path').value.trim();if(!path.toLowerCase().endsWith('.blend')) return message('Vælg en .blend-fil.',true);
  inspection=null;$('source-details').hidden=true;
  setSourceBusy(true);$('source-status').textContent='Finder figur, tilknyttede animationer og gemt pike…';$('source-status').classList.remove('error-message');
  try {
    inspection=await api('/inspect',{path});
    const specs=inspection.settings?.clips || [], actions=inspection.actions || specs;
    clipChoices=actions.map(action=>{
      const spec=specs.find(spec=>spec.action===(action.action||action.name)&&(!spec.slot||spec.slot===action.slot));
      const merged={...action,...spec};merged.action ||= action.name;merged.name ||= action.id || action.name || merged.action;merged.start ??= 1;merged.end ??= merged.start+48;
      merged.duration=number(action.duration,(merged.end-merged.start)/number(inspection.sourceFps,24));merged.frameCount=Math.max(1,number(action.frameCount,Math.ceil(merged.duration*6)));
      merged.selected=action.selected ?? !!spec;merged.kind ||= 'action';return merged;
    });
    if(!clipChoices.length) throw new Error('Filen indeholder ingen animationer, der er knyttet til figuren.');
    $('blend-path').value=inspection.path || path;$('character-label').value=inspection.label || path.split(/[\\/]/).pop().replace(/\.blend$/i,'');
    const existing=characters().find(character=>(character.label||'').toLowerCase()===$('character-label').value.toLowerCase()||versions(character).some(version=>(version.sourcePath||'')===(inspection.path||path)));
    $('character-choice').value=existing?.id || '';
    const rig=inspection.rig || inspection.settings?.rig || 'figuren', bodies=inspection.bodyObjects || inspection.settings?.meshes || [];
    $('model-summary').textContent=`${rig} · ${bodies.length} kropsdele · ${inspection.sourceFps || 24} billeder/s i Blender`;
    $('source-status').textContent=(inspection.warnings || []).join(' ') || 'Animationerne er fundet. Vælg dem, du vil gemme.';
    $('source-details').hidden=false;drawClips();populatePike();
    try {localStorage.setItem('wf-library-blend-path',$('blend-path').value);} catch {}
  } catch(error) {$('source-status').textContent=error.message;$('source-status').classList.add('error-message');message(error.message,true);}
  finally {setSourceBusy(false);}
}
async function startRender() {
  if(!inspection || sourceBusy) return;
  try {
    const label=$('character-label').value.trim();if(!label) throw new Error('Giv figuren et navn i biblioteket.');
    const selectedPike=pikeSettings();
    const settings={...structuredClone(inspection.settings || {}),clips:chosenClips(),directions:16,animation_fps:6,pixels:256,...selectedPike};
    if(!settings.clips.length) throw new Error('Vælg mindst én animation.');
    const baseMeshes=settings.meshes || settings.body_meshes || inspection.bodyObjects || [];
    settings.meshes=baseMeshes.filter(name=>name!==settings.pike?.object);
    const body={path:inspection.path || $('blend-path').value.trim(),label,settings,pike:selectedPike.pike,pikeStyle:selectedPike.pikeStyle};if($('character-choice').value) body.characterId=$('character-choice').value;
    setSourceBusy(true);await api('/render',body);message('Renderingen er startet. Følg arbejdet under forhåndsvisningen.');await refreshLibrary();
  } catch(error) {message(error.message,true);}
  finally {setSourceBusy(false);}
}

function choosePreviewClip() {
  const name=$('preview-clip').value, clip=originalData?.clips?.[name];if(!clip||!renderer?.assets) return;
  previewClip={name,clip};previewTime=0;
  renderer.assets.data.clips={previewIdle:{...clip,kind:'idle'},previewWalk:{...clip,kind:'walk',gait:'walk',nominalSpeed:1}};
  $('preview-direction').replaceChildren();
  for(let direction=0;direction<clip.directions.length;direction++) {const azimuth=((number(originalData.firstAzimuth)+direction*number(originalData.azimuthStep,360/clip.directions.length))%360+360)%360;$('preview-direction').append(new Option(`${Math.round(azimuth*100)/100}°`,String(direction)));}
  $('preview-direction').value='0';updatePreviewDirection();
  $('clip-meta').textContent=`${number(clip.duration).toLocaleString('da-DK',{maximumFractionDigits:2})} s · ${clip.directions.length} vinkler${clip.action ? ' · '+clip.action : ''}`;
}
function updatePreviewDirection() {
  if(!previewClip||!renderer) return;
  const direction=number($('preview-direction').value),frames=previewClip.clip.directions[direction];
  $('preview-frame').max=Math.max(0,frames.length-1);$('preview-frame').value='0';previewTime=0;
  renderer.camera.yaw=(number(originalData.firstAzimuth)+direction*number(originalData.azimuthStep,360/previewClip.clip.directions.length))*DEG;
  fitPreview();drawPreview();
}
function fitPreview() {
  if(!renderer||!previewClip) return;
  const ppu=originalData.pixelsPerUnit;let left=0,right=0,bottom=0,top=0;
  for(const frames of previewClip.clip.directions) for(const frame of frames) {
    const pivot=frame.body.pivot,rect=frame.body.rect;
    const points=[[-pivot[0]/ppu,pivot[1]/ppu],[(rect[2]-pivot[0])/ppu,(pivot[1]-rect[3])/ppu]];
    if($('preview-pikes').checked&&frame.pike) points.push(...scalePikeCorners(frame.pike.corners,3).map(point=>[(point[0]-pivot[0])/ppu,(pivot[1]-point[1])/ppu]));
    for(const [x,y] of points) {left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y);}
  }
  const ratio=Math.max(.5,$('character-preview').clientWidth/Math.max(1,$('character-preview').clientHeight)),center=(top+bottom)/2;
  renderer.camera.zoom=Math.max(2.6,top-bottom,(right-left)/ratio)*1.28;
  const scale=center/Math.sin(renderer.pitch);renderer.camera.centerX=-Math.sin(renderer.camera.yaw)*scale;renderer.camera.centerZ=Math.cos(renderer.camera.yaw)*scale;
}
function drawPreview() {
  if(!renderer||!previewClip) return;
  const clip=previewClip.clip,frames=clip.directions[number($('preview-direction').value)],phase=clip.loop===false?Math.min(.999999,Math.max(0,previewTime/clip.duration)):((previewTime/clip.duration)%1+1)%1;
  const frame=Math.min(frames.length-1,Math.floor(phase*frames.length));
  $('preview-frame').value=frame;$('frame-label').textContent=`${frame+1} / ${frames.length}`;
  renderer.draw({terrain:'flat',time:0,formations:[],soldiers:[{x:0,z:0,heading:0,role:'pike',moving:true,phase:.5,movementPhase:(frame+.5)/frames.length,cadenceRate:1/clip.duration}]},{displayMode:'soldiers',showTargets:false,showPikes:$('preview-pikes').checked,lighting:normalizeLighting()});
}
async function selectVersion(character,version) {
  const token=++previewToken;selected={character,version};pikeAppearanceReady=false;$('pike-appearance').hidden=true;drawLibrary();$('preview-title').textContent=character.label || character.id;
  $('preview-loading').hidden=false;
  const url=version.characterUrl || version.url || version.character;
  try {
    if(typeof url!=='string') throw new Error('Versionen mangler sine billeddata.');
    const absolute=new URL(url,document.baseURI),response=await fetch(absolute,{cache:'no-store'});if(!response.ok) throw new Error('Figurens animationer kunne ikke indlæses.');
    const data=await response.json(),entries=Object.entries(data.clips || {}).filter(([,clip])=>Array.isArray(clip.directions)&&clip.directions.length&&clip.directions.every(frames=>frames.length));
    if(!entries.length) throw new Error('Versionen indeholder ingen færdige animationer.');
    if(!renderer) renderer=new Renderer($('character-preview'));
    const first=entries[0][1],previewData={...data,pikeAppearance:normalizePikeAppearance(version.pikeAppearance ?? data.pikeAppearance),clips:{previewIdle:{...first,kind:'idle'},previewWalk:{...first,kind:'walk'}}};
    const assets=await renderer.loadCharacter(previewData,absolute);
    if(token!==previewToken) {renderer.deleteCharacter(assets);return;}
    renderer.deleteAssets();renderer.assets=assets;renderer.pitch=number(data.elevation,30.05)*DEG;originalData=data;
    $('preview-clip').replaceChildren(...entries.map(([name,clip])=>new Option(name+(clip.gait==='run'?' · løb':clip.kind==='walk'?' · gang':clip.kind==='idle'?' · stilstand':''),name)));
    $('preview-empty').hidden=true;$('preview-controls').hidden=false;$('version-badge').hidden=false;$('version-badge').textContent=dateLabel(version.createdAt);
    choosePreviewClip();updateActivation();pikeAppearanceReady=true;restorePikeAppearance();
  } catch(error) {if(token===previewToken){$('preview-empty').hidden=false;$('preview-controls').hidden=true;throw error;}}
  finally {if(token===previewToken) $('preview-loading').hidden=true;}
}
function appearanceChanged() {
  return appearanceFields.some(([key])=>pikeAppearance[key]!==savedPikeAppearance[key]);
}
function hasSeparatePike() {
  return !!originalData&&Object.values(originalData.clips || {}).some(clip=>clip.directions?.some(frames=>frames.some(frame=>frame.pike?.corners)));
}
function updatePikeAppearanceControls() {
  const hasPike=pikeAppearanceReady&&hasSeparatePike();
  $('pike-appearance').hidden=!hasPike;
  for(const [key,id] of appearanceFields) {
    const percent=Math.round(pikeAppearance[key]*100);
    $(id).value=percent; $(id+'-value').value=percent+' %'; $(id).disabled=appearanceSaving||!hasPike;
  }
  $('save-pike-appearance').disabled=appearanceSaving||!hasPike||!appearanceChanged();
  $('save-pike-appearance').textContent=appearanceSaving?'Gemmer…':'Gem pikeudseende';
}
function restorePikeAppearance() {
  pikeAppearance=normalizePikeAppearance(selected?.version.pikeAppearance ?? originalData?.pikeAppearance);
  savedPikeAppearance={...pikeAppearance};
  if(renderer?.assets) renderer.assets.data.pikeAppearance={...pikeAppearance};
  updatePikeAppearanceControls();
  $('pike-appearance-note').textContent='';
}
function previewPikeAppearance() {
  if(!pikeAppearanceReady||!renderer?.assets) return;
  pikeAppearance=normalizePikeAppearance(Object.fromEntries(appearanceFields.map(([key,id])=>[key,$(id).valueAsNumber/100])));
  renderer.assets.data.pikeAppearance={...pikeAppearance};
  updatePikeAppearanceControls();
  $('pike-appearance-note').classList.remove('error-message');
  $('pike-appearance-note').textContent=appearanceChanged()?'Ændringerne vises her. Gem dem for at bruge dem i formationerne.':'';
  drawPreview();
}
function announceLibraryChange() {
  try {const channel=new BroadcastChannel('wf-animation-library');channel.postMessage({type:'activated'});channel.close();} catch {}
  try {localStorage.setItem('wf-animation-library-changed',String(Date.now()));} catch {}
}
async function savePikeAppearance() {
  if(!selected||!pikeAppearanceReady||!hasSeparatePike()||appearanceSaving||!appearanceChanged()) return;
  const characterId=selected.character.id,versionId=selected.version.id,appearance={...pikeAppearance};
  appearanceSaving=true;updatePikeAppearanceControls();
  $('pike-appearance-note').classList.remove('error-message');$('pike-appearance-note').textContent='Gemmer pikens udseende…';
  try {
    const result=await api('/appearance',{characterId,versionId,pikeAppearance:appearance});
    const saved=normalizePikeAppearance(result.pikeAppearance ?? appearance);
    const active=typeof result.active==='boolean'?result.active:!!(result.activeRoles?.length || (selected.character.id===characterId&&selected.version.id===versionId&&activeRoles(selected.version).length));
    if(active) announceLibraryChange();
    if(selected.character.id===characterId&&selected.version.id===versionId) {
      selected.version.pikeAppearance={...saved};savedPikeAppearance={...saved};
      $('pike-appearance-note').textContent=active?'Gemt. Pikens udseende er opdateret i formationsstudioet.':'Gemt til denne version af figuren.';
    }
    message(active?'Pikeudseendet er gemt og opdateret i formationsstudioet.':'Pikeudseendet er gemt til denne version.');
  } catch(error) {
    if(selected.character.id===characterId&&selected.version.id===versionId) {$('pike-appearance-note').textContent=error.message;$('pike-appearance-note').classList.add('error-message');}
    message(error.message,true);
  } finally {appearanceSaving=false;updatePikeAppearanceControls();}
}
function updateActivation() {
  if(!selected) return;
  const compatible=!!originalData&&animationClips(originalData,'idle').length>0&&animationClips(originalData,'walk').length>0;
  for(const role of ['pike','shot']) {$('activate-'+role).disabled=!compatible;$('activate-'+role).classList.toggle('active',activeRoles(selected.version).includes(role));}
  $('activation-note').textContent=compatible?'Et skift opdaterer formationsstudioet med det samme.':'For at marchere i formationerne skal denne version have både stilstand og gang. Alle animationerne kan ses her i biblioteket.';
}
async function activate(role) {
  if(!selected) return;
  const button=$('activate-'+role);button.disabled=true;
  try {
    await api('/activate',{characterId:selected.character.id,versionId:selected.version.id,role});
    announceLibraryChange();
    message(`${selected.character.label || selected.character.id} bruges nu som ${role==='pike'?'pikener':'musketer'}.`);await refreshLibrary();
  } catch(error) {message(error.message,true);}
  finally {updateActivation();}
}
function animate(now) {
  if(lastTick&&playing&&!document.hidden&&previewClip) {previewTime+=Math.min(.2,(now-lastTick)/1000);if(previewClip.clip.loop===false&&previewTime>=previewClip.clip.duration){previewTime=previewClip.clip.duration;playing=false;$('preview-play').textContent='Afspil';$('preview-play').setAttribute('aria-pressed','false');}}
  lastTick=now;if(!document.hidden) drawPreview();requestAnimationFrame(animate);
}

$('source-form').onsubmit=inspectSource;
$('blend-path').oninput=()=>{inspection=null;$('source-details').hidden=true;$('source-status').textContent='Find animationerne i denne fil, før den renderes.';};
$('pick-blend').onclick=async()=>{if(sourceBusy)return;setSourceBusy(true);try{const result=await api('/pick',{});if(result.path){$('blend-path').value=result.path;setSourceBusy(false);await inspectSource();}}catch(error){message(error.message,true);}finally{setSourceBusy(false);}};
$('render-all').onclick=startRender;
$('select-all').onclick=()=>{const all=clipChoices.every(clip=>clip.selected);for(const clip of clipChoices)clip.selected=!all;drawClips();};
$('pike-enabled').onchange=syncPikeEnabled;
for(const name of ['grip','butt','tip']) for(const [index,axis] of ['x','y','z'].entries()) $('pike-'+name+'-'+axis).onchange=()=>{
  const value=$('pike-'+name+'-'+axis).valueAsNumber;if(!Number.isFinite(value))return;
  if(name==='grip'){const delta=value-pikeState.grip[index];for(const key of ['grip','butt','tip']){pikeState[key][index]+=delta;$('pike-'+key+'-'+axis).value=Math.round(pikeState[key][index]*1000000)/1000000;}}
  else pikeState[name][index]=value;
};
$('preview-clip').onchange=choosePreviewClip;$('preview-direction').onchange=updatePreviewDirection;
$('preview-play').onclick=()=>{if(!playing&&previewClip?.clip.loop===false&&previewTime>=previewClip.clip.duration)previewTime=0;playing=!playing;$('preview-play').textContent=playing?'Pause':'Afspil';$('preview-play').setAttribute('aria-pressed',String(playing));};
$('preview-frame').oninput=()=>{if(!previewClip)return;playing=false;$('preview-play').textContent='Afspil';$('preview-play').setAttribute('aria-pressed','false');const frames=previewClip.clip.directions[number($('preview-direction').value)];previewTime=(number($('preview-frame').value)+.01)/frames.length*previewClip.clip.duration;drawPreview();};
$('preview-pikes').onchange=()=>{fitPreview();drawPreview();};
for(const [,id] of appearanceFields) $(id).oninput=previewPikeAppearance;
$('save-pike-appearance').onclick=savePikeAppearance;
$('activate-pike').onclick=()=>activate('pike');$('activate-shot').onclick=()=>activate('shot');$('refresh-library').onclick=refreshLibrary;
window.addEventListener('resize',()=>{fitPreview();drawPreview();});
try {$('blend-path').value=localStorage.getItem('wf-library-blend-path') || '';} catch {}
await refreshLibrary();requestAnimationFrame(animate);
window.__animationLibrary={get library(){return library;},get jobs(){return jobs;},get inspection(){return inspection;},get renderer(){return renderer;},refresh:refreshLibrary};
