import {StudioModel} from './model.mjs';
import {MarchAudio} from './audio.mjs';
import {Renderer} from './renderer.mjs';
import {DEFAULT_LIGHTING,normalizeLighting} from './lighting.mjs';

const $ = id => document.getElementById(id);
const canvas = $('battlefield');
const model = new StudioModel();
const audio = new MarchAudio();
let renderer;
let running = true, rate = 1, latest, ready = false, last = 0, accumulator = 0, uiTime = 0;
let toastTimer;
const defaultLighting = {...DEFAULT_LIGHTING,softness:0};
let assetLighting = {...defaultLighting};
const view = {display:'both',showTargets:true,showPikes:true,visualBudget:600,lighting:{...defaultLighting}};
const names = {flat:'Fladt land',slope:'Hældning',ridge:'Bakkekam',passage:'Smal passage'};
const defaults = {yaw:Math.PI/4,zoom:54,centerX:0,centerZ:17};

function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {$('toast').hidden = true;}, 4500);
}
function dirty() {$('save-state').textContent = 'Ændret siden gemning';}
function selected() {return model.formations.find(f => f.id === model.selectedId);}
function mutate(fn) {
  try {fn(); dirty(); renderControls(); draw();}
  catch(error) {notify(error.message || 'Ændringen kunne ikke gennemføres.');}
}
function degrees(angle) {return ((angle * 180 / Math.PI) % 360 + 360) % 360;}
function cameraLabels() {
  if (!renderer) return;
  const yaw = Math.round(degrees(renderer.camera.yaw));
  $('camera-yaw').value = yaw;
  $('camera-label').value = `${yaw}°`;
  $('compass-arrow').style.transform = `rotate(${-yaw}deg)`;
}

function cleanLighting(raw = {}, base = assetLighting) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const result=normalizeLighting({...base,...raw,softness:0});
  result.elevation=Math.max(5,Math.min(85,result.elevation));
  result.threshold=Math.max(.05,Math.min(.95,result.threshold));
  return result;
}
function lightLabels() {
  const l=view.lighting, compass=['N','NØ','Ø','SØ','S','SV','V','NV'];
  $('light-enabled').checked=l.enabled;
  for(const key of ['azimuth','elevation','strength','threshold','hatchSpacing','hatchWidth','hatchAngle','crossStart']) $('light-'+key).value=l[key];
  $('light-azimuth-label').value=`${Math.round(l.azimuth)}° · ${compass[Math.round(l.azimuth/45)%8]}`;
  $('light-elevation-label').value=`${Math.round(l.elevation)}°`;
  $('light-strength-label').value=`${Math.round(l.strength*100)} %`;
  $('light-threshold-label').value=`${Math.round(l.threshold*100)} %`;
  $('light-ink').value=l.inkColor;
  $('light-style').value=l.style;
  $('hatch-controls').hidden=l.style!=='hatch';
  $('light-hatchSpacing-label').value=`${(l.hatchSpacing*100).toLocaleString('da-DK',{maximumFractionDigits:1})} cm`;
  $('light-hatchWidth-label').value=`${(l.hatchWidth*100).toLocaleString('da-DK',{maximumFractionDigits:2})} cm`;
  $('light-hatchAngle-label').value=`${Math.round(l.hatchAngle)}°`;
  $('light-crossStart-label').value=`${Math.round(l.crossStart*100)} %`;
}

function renderControls() {
  const f = selected();
  $('unit-list').replaceChildren(...model.formations.map(unit => {
    const button = document.createElement('button');
    button.textContent = unit.name;
    button.className = unit.id === f?.id ? 'active' : '';
    button.dataset.unitId = unit.id;
    button.addEventListener('click', () => {model.selectedId = unit.id; dirty(); renderControls(); draw();});
    return button;
  }));
  const fields = ['unit-name','strength','front-files','spacing','rank-spacing','shape','composition','speed','turn-rate','turn-anchor','target-heading'];
  for (const id of fields) $(id).disabled = !f;
  for (const id of ['turn-unit','halt-unit','loss-10','loss-25','remove-formation','passage-order']) $(id).disabled = !f;
  $('add-formation').disabled = model.formations.length >= 6;
  if (f) {
    $('unit-name').value = f.name;
    $('strength').value = f.strength;
    $('front-files').value = f.frontFiles;
    $('spacing').value = f.spacing;
    $('rank-spacing').value = f.rankSpacing;
    $('shape').value = f.shape;
    $('composition').value = f.composition;
    $('speed').value = f.speed;
    $('turn-rate').value = Math.round(f.turnRate * 180 / Math.PI);
    $('turn-anchor').value = f.turnAnchor ?? 'auto';
    $('target-heading').value = Math.round(degrees(f.target?.heading ?? f.heading));
  }
  for (const button of document.querySelectorAll('[data-terrain]')) button.classList.toggle('active', button.dataset.terrain === model.terrain);
  $('terrain-name').textContent = names[model.terrain] ?? model.terrain;
  $('passage-order').hidden = model.terrain !== 'passage';
  $('terrain-note').textContent = model.terrain === 'passage'
    ? 'Passagen ligger ved x = 0 og er 8 m bred. Kolonnen skal være smal nok til at komme igennem.'
    : 'Klik et mål på den anden side af terrænet, og følg både felt og figurer.';
  $('display-mode').value = view.display;
  $('show-targets').checked = view.showTargets;
  $('show-pikes').checked = view.showPikes;
  $('visual-budget').value = view.visualBudget;
  $('budget-label').value = view.visualBudget;
  cameraLabels();
  lightLabels();
  updateStats();
}
function updateStats() {
  if (!latest) return;
  const f = latest.formations.find(unit => unit.id === model.selectedId);
  $('selected-label').textContent = f?.name ?? 'Ingen valgt';
  $('unit-status').textContent = f?.status ?? '—';
  $('troop-count').textContent = f ? `${f.strength.toLocaleString('da-DK')} mand` : '—';
  const allStrength = latest.strength ?? latest.formations.reduce((sum,unit) => sum + unit.strength,0);
  $('draw-count').textContent = `${latest.visualCount ?? latest.soldiers.length} / ${allStrength.toLocaleString('da-DK')}`;
  const seconds = Math.floor(latest.time ?? 0);
  $('sim-clock').textContent = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  $('view-summary').textContent = `${latest.formations.length} fænnicker · ${allStrength.toLocaleString('da-DK')} mand`;
  if (f?.fields?.length) {
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    const points = f.fields.flatMap(field => field.polygon).map(([x,z]) => [(x-f.x)*c+(z-f.z)*s,-(x-f.x)*s+(z-f.z)*c]);
    const width = Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]));
    const depth = Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]));
    $('footprint-size').textContent = `${width.toFixed(1)} × ${depth.toFixed(1)} m`;
  } else $('footprint-size').textContent = '—';
}
function draw() {
  if (!ready) return;
  latest = model.snapshot({visualBudget:view.visualBudget,showSoldiers:view.display !== 'fields'});
  renderer.draw(latest, {
    showFields:view.display !== 'soldiers',showSoldiers:view.display !== 'fields',
    showTargets:view.showTargets,showPikes:view.showPikes,selectedId:model.selectedId,lighting:view.lighting,
  });
}
function frame(now) {
  const elapsed = last ? Math.min((now-last)/1000,0.08) : 0;
  last = now;
  if (running) {
    if (elapsed > 0 && model.formations.some(f => !["Holder stilling","Opløst"].includes(f.status))) dirty();
    accumulator += elapsed * rate;
    while (accumulator >= 1/60) {model.step(1/60); accumulator -= 1/60;}
  }
  try {draw();}
  catch(error) {fail(error); return;}
  audio.update(model.formations,{running,visible:!document.hidden,rate,camera:audioView(),selectedId:model.selectedId});
  uiTime += elapsed;
  if (uiTime >= 0.15) {updateStats();uiTime=0;}
  requestAnimationFrame(frame);
}
function togglePlay(value = !running) {
  running = value;
  accumulator = 0;
  $('play-pause').textContent = running ? 'Ⅱ Pause' : '▶ Afspil';
  $('play-pause').setAttribute('aria-pressed', String(running));
  audio.update(model.formations,{running,visible:!document.hidden,rate,camera:audioView(),selectedId:model.selectedId});
}
function fail(error) {
  ready = false;audio.mute();
  $('loading').hidden = false;
  $('loading').querySelector('p').textContent = `Studiet kunne ikke starte: ${error.message}. Prøv at åbne det i en opdateret Chrome eller Edge.`;
  console.error(error);
}

const patches = {
  'unit-name':['name',false],'strength':['strength',true],'front-files':['frontFiles',true],
  'spacing':['spacing',true],'rank-spacing':['rankSpacing',true],'shape':['shape',false],
  'composition':['composition',false],'speed':['speed',true],'turn-rate':['turnRate',true],'turn-anchor':['turnAnchor',false],
};
for (const [id,[property,numeric]] of Object.entries(patches)) {
  $(id).addEventListener('change', () => {
    const f = selected(); if (!f) return;
    let value = numeric ? Number($(id).value) : $(id).value.trim();
    if (numeric && (!Number.isFinite(value) || !$(id).checkValidity())) {notify('Vælg en værdi inden for det angivne interval.');renderControls();return;}
    if (property === 'turnRate') value *= Math.PI / 180;
    mutate(() => model.updateFormation(f.id, {[property]:value}));
  });
}
$('add-formation').addEventListener('click', () => mutate(() => {
  const index = model.formations.length;
  const unit = model.addFormation({name:`Fænnike ${index+1}`,heading:0,strength:180,frontFiles:12});
  if (unit?.id) model.selectedId = unit.id;
}));
$('remove-formation').addEventListener('click', () => {const f=selected();if(f)mutate(()=>model.removeFormation(f.id));});
$('turn-unit').addEventListener('click', () => {
  const f=selected(), degreesValue=Number($('target-heading').value);
  if (f && Number.isFinite(degreesValue)) mutate(()=>model.turn(f.id,degreesValue*Math.PI/180));
});
$('halt-unit').addEventListener('click', () => {const f=selected();if(f)mutate(()=>model.halt(f.id));});
for (const percent of [10,25]) $('loss-'+percent).addEventListener('click',()=>{
  const f=selected();if(f)mutate(()=>model.applyLosses(f.id,percent/100,$('loss-mode').value));
});
for (const button of document.querySelectorAll('[data-terrain]')) button.addEventListener('click',()=>mutate(()=>{const moved=model.setTerrain(button.dataset.terrain);if(moved.length)notify(`${moved.length} fænnike(r) er flyttet til fri plads i det nye terræn.`);}));
$('passage-order').addEventListener('click',()=>{
  const f=selected();if(f)mutate(()=>model.order(f.id,{x:0,z:f.z>0 ? -32 : 32,heading:f.z>0 ? 0 : Math.PI}));
});
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click',()=>{
  for (const tab of document.querySelectorAll('[data-tab]')) {const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));}
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden=panel.id !== `panel-${button.dataset.tab}`;
});
$('display-mode').addEventListener('change',()=>{view.display=$('display-mode').value;dirty();draw();updateStats();});
$('show-targets').addEventListener('change',()=>{view.showTargets=$('show-targets').checked;dirty();draw();});
$('show-pikes').addEventListener('change',()=>{view.showPikes=$('show-pikes').checked;dirty();draw();});
$('visual-budget').addEventListener('input',()=>{view.visualBudget=Number($('visual-budget').value);$('budget-label').value=view.visualBudget;dirty();draw();updateStats();});
$('camera-yaw').addEventListener('input',()=>{renderer?.setCamera({yaw:Number($('camera-yaw').value)*Math.PI/180});cameraLabels();draw();});
$('home-camera').addEventListener('click',()=>{renderer?.setCamera(defaults);dirty();cameraLabels();draw();});

for (const key of ['azimuth','elevation','strength','threshold','hatchSpacing','hatchWidth','hatchAngle','crossStart']) $('light-'+key).addEventListener('input',()=>{
  view.lighting=cleanLighting({...view.lighting,[key]:Number($('light-'+key).value)});lightLabels();dirty();draw();
});
$('light-style').addEventListener('change',()=>{view.lighting=cleanLighting({...view.lighting,style:$('light-style').value});lightLabels();dirty();draw();});
$('light-enabled').addEventListener('change',()=>{view.lighting.enabled=$('light-enabled').checked;dirty();draw();});
$('light-ink').addEventListener('input',()=>{view.lighting=cleanLighting({...view.lighting,inkColor:$('light-ink').value});dirty();draw();});
$('reset-light').addEventListener('click',()=>{view.lighting={...assetLighting};lightLabels();dirty();draw();});

function audioView(){return renderer?{...renderer.camera,pitch:renderer.pitch,aspect:canvas.clientWidth/Math.max(1,canvas.clientHeight)}:undefined;}
function audioLabels(){
  $('march-sound').textContent=audio.enabled?'Lyd: til':'Lyd: fra';
  $('march-sound').setAttribute('aria-pressed',String(audio.enabled));
  $('march-sound').setAttribute('aria-label',audio.enabled?'Slå marchlyd fra':'Slå marchlyd til');
  $('march-volume-label').value=`${Math.round(audio.volume*100)} %`;
  $('drum-volume-label').value=`${Math.round(audio.drumVolume*100)} %`;
}
$('march-sound').addEventListener('click',async()=>{
  if(audio.enabled)audio.mute();
  else if(!await audio.enable())notify('Marchlyden kunne ikke startes i denne browser.');
  audioLabels();
});
$('march-volume').addEventListener('input',()=>{audio.setVolume(Number($('march-volume').value)/100);audioLabels();});
$('drum-volume').addEventListener('input',()=>{audio.setDrumVolume(Number($('drum-volume').value)/100);audioLabels();});
document.addEventListener('visibilitychange',()=>audio.update(model.formations,{running,visible:!document.hidden,rate,camera:audioView(),selectedId:model.selectedId}));
window.addEventListener('pagehide',()=>audio.mute());
$('play-pause').addEventListener('click',()=>togglePlay());
$('step-time').addEventListener('click',()=>{togglePlay(false);for(let i=0;i<30;i++)model.step(1/60);dirty();draw();updateStats();});
$('time-speed').addEventListener('change',()=>{rate=Number($('time-speed').value);});
$('reset-scene').addEventListener('click',()=>{model.reset();view.lighting={...assetLighting};renderer?.setCamera(defaults);togglePlay(true);dirty();renderControls();draw();notify('Et nyt forsøg er klar.');});

function pointInPolygon(x,z,polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if(((a[1]>z)!==(b[1]>z)) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
let pointer=null;
function handleAt(x,y){
  if(!view.showTargets||!model.selectedId||!latest)return null;
  return renderer.waypointHandles(latest,model.selectedId)
    .map(handle=>({...handle,distance:Math.hypot(handle.screen.x-x,handle.screen.y-y)}))
    .filter(handle=>handle.distance<=12).sort((a,b)=>a.distance-b.distance)[0]??null;
}
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{
  if(!ready||pointer)return;
  const handle=event.button===0&&!event.altKey?handleAt(event.offsetX,event.offsetY):null;
  pointer={id:event.pointerId,button:event.button,x:event.offsetX,y:event.offsetY,startX:event.offsetX,startY:event.offsetY,alt:event.altKey,shift:event.shiftKey,drag:false,handle:null};
  if(handle){
    const point=latest.formations.find(f=>f.id===handle.formationId)?.waypoints.find(point=>point.id===handle.waypointId);
    if(point)pointer.handle={...handle,centre:{x:point.x,z:point.z},heading:point.heading,
      cornerAngle:Math.atan2(handle.world[0]-point.x,-(handle.world[1]-point.z))};
  }
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
  if(!renderer)return;
  if(!pointer){canvas.style.cursor=handleAt(event.offsetX,event.offsetY)?'grab':'';return;}
  if(pointer.id!==event.pointerId)return;
  const dx=event.offsetX-pointer.x,dy=event.offsetY-pointer.y;
  if(Math.hypot(event.offsetX-pointer.startX,event.offsetY-pointer.startY)>4)pointer.drag=true;
  if(pointer.handle&&pointer.drag){
    const handle=pointer.handle,ground=renderer.screenToGround(event.offsetX,event.offsetY);
    if(ground&&Math.hypot(ground.x-handle.centre.x,ground.z-handle.centre.z)>.25){
      const heading=handle.heading+Math.atan2(ground.x-handle.centre.x,-(ground.z-handle.centre.z))-handle.cornerAngle;
      if(model.rotateWaypoint(handle.formationId,handle.waypointId,heading)){dirty();renderControls();}
    }
    canvas.style.cursor='grabbing';
  }else if(pointer.button===2&&pointer.drag){
    renderer.setCamera({yaw:renderer.camera.yaw+dx*0.006});cameraLabels();dirty();
  }else if((pointer.button===1||pointer.alt)&&pointer.drag){
    const previous=renderer.screenToGround(pointer.x,pointer.y),next=renderer.screenToGround(event.offsetX,event.offsetY);
    if(previous&&next)renderer.setCamera({centerX:renderer.camera.centerX+previous.x-next.x,centerZ:renderer.camera.centerZ+previous.z-next.z});
    dirty();
  }
  pointer.x=event.offsetX;pointer.y=event.offsetY;draw();
});
canvas.addEventListener('pointerup',event=>{
  if(!pointer||pointer.id!==event.pointerId)return;
  const gesture=pointer;pointer=null;canvas.style.cursor='';
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(gesture.button===2&&!gesture.drag){model.selectedId=null;dirty();renderControls();draw();return;}
  if(gesture.button!==0||gesture.alt||gesture.drag||gesture.handle||!renderer)return;
  const ground=renderer.screenToGround(event.offsetX,event.offsetY);if(!ground)return;
  const f=selected();
  const hit=latest?.formations.find(unit=>unit.fields.some(field=>pointInPolygon(ground.x,ground.z,field.polygon)));
  if(hit&&!(gesture.shift&&f)){model.selectedId=hit.id;dirty();renderControls();draw();return;}
  if(f){mutate(()=>model.setWaypoint(f.id,{x:ground.x,z:ground.z},gesture.shift));
    notify(gesture.shift?`Rutepunkt tilføjet for ${f.name}.`:`Ny rute til ${f.name}.`);}
});
canvas.addEventListener('pointercancel',()=>{pointer=null;canvas.style.cursor='';});
canvas.addEventListener('wheel',event=>{
  event.preventDefault();
  renderer?.setCamera({zoom:Math.max(10,Math.min(110,renderer.camera.zoom*Math.exp(event.deltaY*0.001)))});
  draw();
},{passive:false});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fail(new Error('Grafikken blev afbrudt. Genindlæs siden'));});
window.addEventListener('keydown',event=>{
  if(/INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;
  if(event.code==='Space') {event.preventDefault();togglePlay();}
  if(event.key==='Home') {renderer?.setCamera(defaults);dirty();cameraLabels();draw();}
});
window.addEventListener('resize',()=>{renderer?.resize();draw();});

function sceneDocument() {
  return {schema:'walking-fortress-formation-study-v1',model:model.exportScene(),view:{...view,camera:renderer?.camera},lossMode:$('loss-mode').value};
}
function openScene(document) {
  if(!document || document.schema!=='walking-fortress-formation-study-v1' || !document.model)throw new Error('Filen er ikke et formationsstudie.');
  model.importScene(document.model);
  if(['both','fields','soldiers'].includes(document.view?.display))view.display=document.view.display;
  view.visualBudget=Math.max(60,Math.min(2400,Number(document.view?.visualBudget)||600));
  view.showTargets=document.view?.showTargets!==false;
  view.showPikes=document.view?.showPikes!==false;
  view.lighting=cleanLighting(document.view?.lighting);
  if(document.view?.camera) {
    const camera=document.view.camera;
    renderer?.setCamera({yaw:Number.isFinite(camera.yaw)?camera.yaw:defaults.yaw,zoom:Math.max(10,Math.min(110,Number(camera.zoom)||54)),centerX:Math.max(-70,Math.min(70,Number(camera.centerX)||0)),centerZ:Math.max(-70,Math.min(70,Number(camera.centerZ)||0))});
  }
  if(['holes','narrow','ranks'].includes(document.lossMode))$('loss-mode').value=document.lossMode;
  togglePlay(false);renderControls();draw();updateStats();
}
$('save-scene').addEventListener('click',()=>{
  const content=JSON.stringify(sceneDocument(),null,2);
  try {localStorage.setItem('wf-formation-study',content);} catch {/* Download still works if local storage is unavailable. */}
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`Formationsstudie_${new Date().toISOString().slice(0,10)}.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('save-state').textContent='Studie gemt';notify('Studiet er gemt som fil og i denne browser.');
});
$('load-scene').addEventListener('click',()=>$('scene-file').click());
$('scene-file').addEventListener('change',async()=>{
  const file=$('scene-file').files[0];if(!file)return;
  try {
    if(file.size>2*1024*1024)throw new Error('Studiefilen er for stor.');
    openScene(JSON.parse(await file.text()));$('save-state').textContent='Studie åbnet';notify('Studiet er åbnet og sat på pause.');
  } catch(error) {notify(error.message || 'Studiet kunne ikke åbnes.');}
  $('scene-file').value='';
});

let refreshingLibrary = false;
let libraryRefreshPending = false;
async function refreshLibraryFigures() {
  if (!ready) return;
  libraryRefreshPending = true;
  if (refreshingLibrary) return;
  refreshingLibrary = true;
  try {
    while (libraryRefreshPending) {
      libraryRefreshPending = false;
      const character = await renderer.loadAssets('assets/characters.json');
      assetLighting = cleanLighting({azimuth:character.lighting?.azimuth??defaultLighting.azimuth,elevation:character.lighting?.elevation??defaultLighting.elevation},defaultLighting);
      const registry = renderer.assets.registry;
      $('asset-status').textContent = registry ? [...new Set(Object.values(registry.roles))].map(id=>registry.characters[id]?.label || id).join(' + ') : character.label || 'Figurer indlæst';
      draw();
    }
    notify('Figurerne fra biblioteket er klar i formationerne.');
  } catch (error) { notify(error.message || 'Figurerne kunne ikke indlæses fra biblioteket.'); }
  finally { refreshingLibrary = false; }
}
if (typeof BroadcastChannel !== 'undefined') {
  const libraryChannel = new BroadcastChannel('wf-animation-library');
  libraryChannel.onmessage = event => { if (event.data?.type === 'activated') refreshLibraryFigures(); };
}
window.addEventListener('storage', event => { if (event.key === 'wf-animation-library-changed') refreshLibraryFigures(); });

async function start() {
  try {
    renderer=new Renderer(canvas);
    renderer.setCamera(defaults);
    const character=await renderer.loadAssets('assets/characters.json');
    assetLighting=cleanLighting({azimuth:character.lighting?.azimuth??defaultLighting.azimuth,elevation:character.lighting?.elevation??defaultLighting.elevation},defaultLighting);
    view.lighting={...assetLighting};
    ready=true;
    let saved;
    try {saved=localStorage.getItem('wf-formation-study');} catch {}
    if(saved)try {openScene(JSON.parse(saved));$('save-state').textContent='Senest gemte studie';} catch {notify('Det gemte studie kunne ikke læses. Et nyt forsøg er klar.');}
    $('loading').hidden=true;
    $('asset-status').textContent=renderer.assets.registry ? [...new Set(Object.values(renderer.assets.registry.roles))].map(id=>renderer.assets.registry.characters[id]?.label || id).join(' + ') + ' · gang, løb og stilstand' : character.label || 'Figurer indlæst';
    renderControls();draw();updateStats();requestAnimationFrame(frame);
    // Small read-only entry point for integration checks and future separate studies.
    window.formationStudio={model,renderer,view,audio,get snapshot(){return latest;},openScene,sceneDocument,pause:()=>togglePlay(false)};
  } catch(error) {fail(error);}
}
start();
