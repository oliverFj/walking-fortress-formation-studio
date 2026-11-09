import {heightAt,terrainNames,terrainBounds,terrainContainsFootprint,polygonsOverlap} from './terrain.mjs';
import {turnAnchor,wheelPose,wheelStep,departure,wheelRadius,MAX_WHEEL_SPEED,MARCH_CYCLES_PER_SECOND,marchPhaseAt,nextMarchBeat} from './march.mjs';
import {signalDurationCycles} from './drum-signals.mjs';
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback;
const angle=v=>v>=-Math.PI&&v<Math.PI?v:((v+Math.PI)%TAU+TAU)%TAU-Math.PI;
const approach=(value,target,amount)=>value+clamp(target-value,-amount,amount);
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=(index,seed)=>{let x=(Math.imul(index+1,2654435761)^Math.imul(seed+1,1597334677))>>>0;x^=x>>>16;x=Math.imul(x,2246822507);x^=x>>>13;return (x>>>0)/4294967296;};
const roleKeys=['pike','shot-left','shot-right'];
function desiredLayout(f) {
  const count=f.lossMode==='holes'?Math.max(f.strength,f.footprintCount):f.strength;
  if(count===0)return [];
  const files=Math.max(f.composition==='mixed'?3:1,Math.round(f.shape==='column'?Math.min(4,f.frontFiles):f.frontFiles));
  if(f.composition==='pikes')return [{key:'pike',role:'pike',x:0,z:0,width:files*f.spacing,depth:Math.ceil(count/files)*f.rankSpacing,count,files}];
  const shotFiles=Math.max(1,Math.round(files*0.18)),pikeFiles=Math.max(1,files-2*shotFiles);
  const shotCount=Math.floor(count*0.18),pikeCount=count-2*shotCount;
  if(f.shape==='column') {
    const gap=f.rankSpacing*0.5,pd=Math.ceil(pikeCount/files)*f.rankSpacing,sd=Math.ceil(shotCount/files)*f.rankSpacing,totalDepth=pd+2*sd+2*gap;
    return [
      {key:'pike',role:'pike',x:0,z:-totalDepth/2+pd/2,width:files*f.spacing,depth:pd,count:pikeCount,files},
      {key:'shot-left',role:'shot',x:0,z:-totalDepth/2+pd+gap+sd/2,width:files*f.spacing,depth:sd,count:shotCount,files},
      {key:'shot-right',role:'shot',x:0,z:totalDepth/2-sd/2,width:files*f.spacing,depth:sd,count:shotCount,files}
    ].filter(field=>field.count>0);
  }
  const pw=pikeFiles*f.spacing,sw=shotFiles*f.spacing,gap=f.spacing*0.65;
  return [
    {key:'pike',role:'pike',x:0,z:0,width:pw,depth:Math.max(1,Math.ceil(pikeCount/pikeFiles))*f.rankSpacing,count:pikeCount,files:pikeFiles},
    {key:'shot-left',role:'shot',x:-(pw+sw)/2-gap,z:0,width:sw,depth:Math.max(1,Math.ceil(shotCount/shotFiles))*f.rankSpacing,count:shotCount,files:shotFiles},
    {key:'shot-right',role:'shot',x:(pw+sw)/2+gap,z:0,width:sw,depth:Math.max(1,Math.ceil(shotCount/shotFiles))*f.rankSpacing,count:shotCount,files:shotFiles}
  ].filter(field=>field.count>0);
}
function toWorld(f,x,z) {
  const c=Math.cos(f.heading),s=Math.sin(f.heading);
  return [f.x+x*c-z*s,f.z+x*s+z*c];
}
function fieldsOf(f,layout=f.layout) {
  return layout.filter(field=>field.width>0.01&&field.depth>0.01).map(field=>({
    role:field.role,
    polygon:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz])=>toWorld(f,field.x+sx*field.width/2,field.z+sz*field.depth/2))
  }));
}
function waypointCorners(f,layout=desiredLayout(f)) {
  if(!layout.length)return [];
  const minX=Math.min(...layout.map(field=>field.x-field.width/2)),maxX=Math.max(...layout.map(field=>field.x+field.width/2));
  const minZ=Math.min(...layout.map(field=>field.z-field.depth/2)),maxZ=Math.max(...layout.map(field=>field.z+field.depth/2));
  return [[minX,minZ],[maxX,minZ],[maxX,maxZ],[minX,maxZ]].map(([x,z])=>toWorld(f,x,z));
}
function sanitize(raw,id,name) {
  const strength=Math.round(clamp(finite(raw.strength,216),0,20000));
  const x=clamp(finite(raw.x,0),-65,65),z=clamp(finite(raw.z,29),-65,65),heading=angle(finite(raw.heading,0));
  return {id,name:String(raw.name??name).slice(0,80),x,z,heading,target:{x,z,heading},strength,
    frontFiles:Math.round(clamp(finite(raw.frontFiles,12),1,100)),spacing:clamp(finite(raw.spacing,0.9),0.35,3),rankSpacing:clamp(finite(raw.rankSpacing,0.95),0.35,3),
    speed:clamp(finite(raw.speed,2.1),0.1,10),turnRate:clamp(finite(raw.turnRate,0.65),0.05,3),
    turnAnchor:['auto','center','left','right'].includes(raw.turnAnchor)?raw.turnAnchor:'auto',marchPhase:0,cadenceRate:MARCH_CYCLES_PER_SECOND,cadenceProgress:0,marchActive:false,marchStartTime:null,drumSignal:null,nextDrumSignalId:1,maneuver:null,motion:null,waypoints:[],nextWaypointId:1,
    shape:raw.shape==='column'?'column':'battle',composition:raw.composition==='mixed'?'mixed':'pikes',
    status:'Holder stilling',lossMode:['holes','narrow','ranks'].includes(raw.lossMode)?raw.lossMode:'ranks',footprintCount:strength,seed:Math.round(finite(raw.seed,id*73)),layout:[],orderExplicitHeading:false};
}
function interpolatedLayout(f,dt) {
  const desired=desiredLayout(f),next=[];
  for(const target of desired) {
    const current=f.layout.find(field=>field.key===target.key);
    if(!current) {next.push({...target,width:Math.min(target.width,0.9*dt),depth:Math.min(target.depth,1.5*dt)});continue;}
    const value={...target};
    for(const key of ['x','z','width','depth'])value[key]=approach(current[key],target[key],(key==='depth'?1.5:0.9)*dt);
    next.push(value);
  }
  for(const current of f.layout)if(!desired.some(field=>field.key===current.key)) {
    const width=approach(current.width,0,0.9*dt),depth=approach(current.depth,0,1.5*dt);
    if(width>0.01&&depth>0.01)next.push({...current,width,depth,count:0});
  }
  return next;
}
const needsMovement=f=>f.strength>0&&(!!f.maneuver||f.waypoints.length>0||layoutsDiffer(f.layout,desiredLayout(f),1e-8)||Math.hypot(f.target.x-f.x,f.target.z-f.z)>0.08||Math.abs(angle(f.target.heading-f.heading))>0.00001);
const layoutsDiffer=(a,b,tolerance=0.02)=>a.length!==b.length||a.some(field=>{const other=b.find(f=>f.key===field.key);return !other||['x','z','width','depth'].some(k=>Math.abs(field[k]-other[k])>tolerance);});
function collisionReason(model,candidate,id) {
  const polygons=fieldsOf(candidate).map(field=>field.polygon);
  if(!terrainContainsFootprint(model.terrain,polygons)) {
    const outside=polygons.some(poly=>poly.some(([x,z])=>x<terrainBounds.minX||x>terrainBounds.maxX||z<terrainBounds.minZ||z>terrainBounds.maxZ));
    return outside?'Kortgrænse':'Passagen er for smal';
  }
  for(const other of model.formations)if(other.id!==id&&other.strength>0) {
    const otherFields=fieldsOf(other);
    if(polygons.some(poly=>otherFields.some(field=>polygonsOverlap(poly,field.polygon,0.12))))return 'Venter på anden fænnike';
  }
  return '';
}
function findPlacement(model,f,automatic=false) {
  const candidates=automatic?[]:[[f.x,f.z]];
  if(automatic)for(const z of [29,49,-29,-49])for(const x of [-20,0,20,-42,42])candidates.push([x,z]);
  const grid=[[0,0]];
  for(let z=-65;z<=65;z+=2)for(let x=-65;x<=65;x+=2)grid.push([x,z]);
  grid.sort((a,b)=>(a[0]-f.x)**2+(a[1]-f.z)**2-(b[0]-f.x)**2-(b[1]-f.z)**2);
  candidates.push(...grid);
  for(const [x,z]of candidates)if(!collisionReason(model,{...f,x,z},f.id))return {x,z};
  return null;
}
function countsForBudget(formations,budget) {
  const total=formations.reduce((sum,f)=>sum+f.strength,0);
  if(!total||!budget)return formations.map(()=>0);
  const count=Math.min(total,budget),raw=formations.map(f=>f.strength*count/total),result=raw.map(Math.floor);
  let remaining=count-result.reduce((a,b)=>a+b,0);
  const order=raw.map((v,i)=>({i,rest:v-result[i]})).sort((a,b)=>b.rest-a.rest||a.i-b.i);
  for(let i=0;i<remaining;i++)result[order[i].i]++;
  return result;
}
export class StudioModel {
  constructor(){this.formations=[];this.selectedId=null;this.terrain='flat';this.time=0;this.nextId=1;this.reset();}
  reset(){this.formations=[];this.nextId=1;this.time=0;this.terrain='flat';this.addFormation({name:'Rød fænnike',x:-20,z:29,strength:216});this.addFormation({name:'Blå fænnike',x:0,z:29,strength:240,composition:'mixed'});this.addFormation({name:'Grøn fænnike',x:20,z:29,strength:180});this.selectedId=this.formations[0].id;return this;}
  addFormation(overrides={}) {
    const id=this.nextId,f=sanitize(overrides,id,`Fænnike ${id}`);
    f.layout=desiredLayout(f);
    if(overrides.x===undefined&&overrides.z===undefined) {
      const position=findPlacement(this,f,true);
      if(!position)throw new Error('Der er ikke plads til en ny fænnike på kortet.');
      f.x=position.x;f.z=position.z;
    }else if(collisionReason(this,f,id))throw new Error('Der er ikke fri plads til fænnikeformationen her.');
    f.target={x:f.x,z:f.z,heading:f.heading};this.syncMarchClock(f);f.status='Holder stilling';
    this.nextId++;this.formations.push(f);this.selectedId=id;return f;
  }
  removeFormation(id){this.formations=this.formations.filter(f=>f.id!==id);if(this.selectedId===id)this.selectedId=this.formations[0]?.id??null;}
  updateFormation(id,patch={}) {
    const f=this.formations.find(f=>f.id===id);if(!f)return null;
    const previous=f.strength,validated=sanitize({...f,...patch},f.id,f.name);
    const keys=['name','frontFiles','spacing','rankSpacing','speed','turnRate','turnAnchor','shape','composition','strength'];
    for(const key of keys)if(Object.hasOwn(patch,key))f[key]=validated[key];
    if(Object.hasOwn(patch,'strength')){f.footprintCount=Math.max(f.footprintCount,f.strength);if(f.strength>previous)f.lossMode='ranks';}
    if(!f.strength){this.halt(id);return f;}
    if(Object.hasOwn(patch,'heading'))this.turn(id,validated.heading);
    if(Object.hasOwn(patch,'x')||Object.hasOwn(patch,'z'))this.order(id,{x:validated.x,z:validated.z});
    else if(f.maneuver?.kind==='march'&&['frontFiles','spacing','rankSpacing','shape','composition','turnAnchor'].some(key=>Object.hasOwn(patch,key))){this.planWaypoint(f,f.waypoints[0]??{...f.target,explicitHeading:f.orderExplicitHeading});this.refreshWaypointHeadings(f);}
    else if(f.maneuver?.kind==='turn'&&Object.hasOwn(patch,'turnAnchor'))this.turn(id,f.target.heading);
    this.prepareMarch(f);f.status='Omformer';return f;
  }
  order(id,point={}) {
    const f=this.formations.find(f=>f.id===id);if(!f||!Number.isFinite(point.x)||!Number.isFinite(point.z))return false;
    if(Math.hypot(clamp(point.x,-65,65)-f.x,clamp(point.z,-65,65)-f.z)<=0.08)return Number.isFinite(point.heading)?this.turn(id,point.heading):this.halt(id);
    return this.setWaypoint(id,point,false);
  }
  setWaypoint(id,{x,z,heading}={},append=false) {
    const f=this.formations.find(f=>f.id===id);if(!f||!f.strength||!Number.isFinite(x)||!Number.isFinite(z))return false;
    if(append&&f.waypoints.length>=64)return false;
    const wasActive=f.marchActive,pendingStart=f.drumSignal?.key==='start'&&f.marchStartTime!==null&&this.time<=f.marchStartTime;
    if(f.drumSignal?.key==='stop')f.drumSignal=null;
    const point={id:f.nextWaypointId++,x:clamp(x,-65,65),z:clamp(z,-65,65),heading:Number.isFinite(heading)?angle(heading):f.heading,explicitHeading:Number.isFinite(heading)};
    if(append)f.waypoints.push(point);else f.waypoints=[point];
    this.refreshWaypointHeadings(f);
    if(!append||f.waypoints.length===1){
      this.planWaypoint(f,point);
      if(!wasActive&&!pendingStart&&Math.hypot(point.x-f.x,point.z-f.z)>0.08)this.startDrumSignal(f,'start');
    }
    return true;
  }
  rotateWaypoint(id,waypointId,heading) {
    const f=this.formations.find(f=>f.id===id);if(!f||!Number.isFinite(heading))return false;
    const point=f.waypoints.find(item=>item.id===waypointId);if(!point)return false;
    if(f.drumSignal?.key==='stop')f.drumSignal=null;
    point.heading=angle(heading);point.explicitHeading=true;
    if(point===f.waypoints[0])this.planWaypoint(f,point);
    this.refreshWaypointHeadings(f);return true;
  }
  refreshWaypointHeadings(f) {
    let pose={...f};
    for(const point of f.waypoints) {
      if(!point.explicitHeading)point.heading=Math.hypot(point.x-pose.x,point.z-pose.z)<=0.08?pose.heading:departure(pose,point).heading;
      pose={...f,x:point.x,z:point.z,heading:point.heading,layout:desiredLayout(f)};
    }
  }
  planWaypoint(f,point) {
    const distance=Math.hypot(point.x-f.x,point.z-f.z),plan=distance<=0.08?{heading:f.heading,anchor:{x:0,z:0}}:departure(f,point);
    if(!point.explicitHeading)point.heading=plan.heading;
    f.target={x:point.x,z:point.z,heading:point.heading};f.orderExplicitHeading=!!point.explicitHeading;f.motion=null;
    // A waypoint's requested position is its center, including its final turn.
    // Standalone turn() retains the chosen flank pivot.
    if(distance<=0.08) {
      f.maneuver=Math.abs(angle(point.heading-f.heading))>0.00001?{kind:'march',stage:'arrival',heading:point.heading,anchor:{x:0,z:0}}:null;
    }else f.maneuver={kind:'march',stage:'wheel',...plan};
    this.prepareMarch(f);f.status=f.maneuver?'Marcherer':'Holder stilling';
  }
  turn(id,heading) {
    const f=this.formations.find(f=>f.id===id);if(!f||!Number.isFinite(heading))return false;
    f.waypoints=[];f.drumSignal=null;if(!f.marchActive)f.marchStartTime=null;
    const desired=angle(heading),delta=angle(desired-f.heading);
    if(Math.abs(delta)<0.00001)return this.halt(id);
    const anchor=turnAnchor(f,delta),pose=wheelPose(f,anchor,desired);
    f.target={x:pose.x,z:pose.z,heading:desired};f.orderExplicitHeading=true;
    f.maneuver={kind:'turn',stage:'wheel',heading:desired,anchor};f.motion=null;this.prepareMarch(f);f.status='Vender';return true;
  }
  halt(id) {
    const f=this.formations.find(f=>f.id===id);if(!f)return false;
    f.target={x:f.x,z:f.z,heading:f.heading};f.maneuver=null;f.motion=null;f.marchActive=false;f.marchStartTime=null;f.drumSignal=null;f.orderExplicitHeading=false;f.waypoints=[];
    f.status=f.strength?'Holder stilling':'Opløst';return true;
  }
  applyLosses(id,fraction,mode='ranks') {
    const f=this.formations.find(f=>f.id===id);if(!f)return 0;
    const before=f.strength,after=Math.max(0,before-Math.round(before*clamp(finite(fraction,0),0,1)));
    if(!['holes','narrow','ranks'].includes(mode))mode='ranks';
    if(mode==='narrow'&&before>0)f.frontFiles=Math.max(f.composition==='mixed'?3:1,Math.round(f.frontFiles*after/before));
    if(mode!=='holes')f.footprintCount=after;else f.footprintCount=Math.max(f.footprintCount,before);
    f.strength=after;f.lossMode=mode;if(!after)this.halt(id);else {this.prepareMarch(f);f.status='Omformer';}return before-after;
  }
  setTerrain(name) {
    if(!terrainNames.includes(name))throw new Error('Ukendt terræn.');
    if(name===this.terrain)return [];
    const previousTerrain=this.terrain,previous=this.formations.map(f=>({f,x:f.x,z:f.z,target:{...f.target},status:f.status,maneuver:clone(f.maneuver),motion:clone(f.motion),marchActive:f.marchActive,marchStartTime:f.marchStartTime,drumSignal:clone(f.drumSignal),waypoints:clone(f.waypoints),orderExplicitHeading:f.orderExplicitHeading}));
    this.terrain=name;const relocated=[];
    try {
      for(const f of this.formations)if(!terrainContainsFootprint(name,fieldsOf(f).map(field=>field.polygon))) {
        const position=findPlacement(this,f);
        if(!position)throw new Error('Der er ikke plads til alle fænnikeformationerne på dette terræn.');
        f.x=position.x;f.z=position.z;this.halt(f.id);relocated.push(f.id);
      }
    }catch(error){this.terrain=previousTerrain;for(const item of previous){item.f.x=item.x;item.f.z=item.z;item.f.target=item.target;item.f.status=item.status;item.f.maneuver=item.maneuver;item.f.motion=item.motion;item.f.marchActive=item.marchActive;item.f.marchStartTime=item.marchStartTime;item.f.drumSignal=item.drumSignal;item.f.waypoints=item.waypoints;item.f.orderExplicitHeading=item.orderExplicitHeading;}throw error;}
    return relocated;
  }
  syncMarchClock(f) {
    f.cadenceRate=MARCH_CYCLES_PER_SECOND;f.cadenceProgress=this.time*MARCH_CYCLES_PER_SECOND;f.marchPhase=marchPhaseAt(this.time);
  }
  prepareMarch(f) {
    this.syncMarchClock(f);
    if(!f.marchActive&&f.marchStartTime===null&&needsMovement(f))f.marchStartTime=nextMarchBeat(this.time);
  }
  startDrumSignal(f,key) {
    const startProgress=nextMarchBeat(this.time)*MARCH_CYCLES_PER_SECOND;
    f.drumSignal={id:f.nextDrumSignalId++,key,startProgress,endProgress:startProgress+signalDurationCycles(key)};
    if(key==='start')f.marchStartTime=nextMarchBeat(f.drumSignal.endProgress/MARCH_CYCLES_PER_SECOND);
    return f.drumSignal;
  }
  marchTravelSpeed(f,x=f.x,z=f.z,heading=f.heading) {
    const rise=heightAt(this.terrain,x+Math.sin(heading),z-Math.cos(heading))-heightAt(this.terrain,x,z);
    return f.speed*(f.shape==='column'?1.12:1)*clamp(1-Math.max(0,rise)*1.8,0.45,1);
  }
  remainingMarchTime(f) {
    const plan=f.maneuver;if(!plan||plan.kind!=='march')return Infinity;
    const turnTime=(pose,anchor,heading)=>Math.abs(angle(heading-pose.heading))/Math.min(f.turnRate,MAX_WHEEL_SPEED/Math.max(wheelRadius(pose,anchor),0.01));
    if(plan.stage==='arrival')return turnTime(f,plan.anchor,plan.heading);
    const pose=plan.stage==='wheel'?{...f,...wheelPose(f,plan.anchor,plan.heading)}:f;
    const wheel=plan.stage==='wheel'?turnTime(f,plan.anchor,plan.heading):0;
    const distance=Math.hypot(f.target.x-pose.x,f.target.z-pose.z),heading=distance>0.00001?Math.atan2(f.target.x-pose.x,-(f.target.z-pose.z)):pose.heading;
    const arrival=f.orderExplicitHeading?turnTime(pose,{x:0,z:0},f.target.heading):0;
    return wheel+distance/this.marchTravelSpeed(f,pose.x,pose.z,heading)+arrival;
  }
  step(dt) {
    if(!Number.isFinite(dt)||dt<=0)return;
    const duration=Math.min(dt,0.5),substeps=Math.ceil(duration/0.05),slice=duration/substeps;
    for(let i=0;i<substeps;i++){this.time+=slice;for(const f of this.formations)this.stepFormation(f,slice);}
  }
  stepFormation(f,dt) {
    this.syncMarchClock(f);
    if(!f.strength){f.layout=interpolatedLayout(f,dt);this.halt(f.id);return;}
    const previous={dt,x:f.x,z:f.z,heading:f.heading,layout:clone(f.layout)};
    if(!f.marchActive&&needsMovement(f)) {
      if(f.marchStartTime===null)f.marchStartTime=nextMarchBeat(this.time-dt);
      if(this.time<=f.marchStartTime+1e-10) {
        f.motion=previous;
        if(!['Kortgrænse','Passagen er for smal','Venter på anden fænnike'].includes(f.status)&&!f.status.startsWith('Omformning blokeret:'))f.status='Afventer fælles takt';
        return;
      }
      // Only the part of this slice after the common beat may move.
      dt=Math.min(dt,this.time-f.marchStartTime);f.marchActive=true;
    }
    const newLayout=interpolatedLayout(f,dt);let reformBlocked='';
    if(layoutsDiffer(newLayout,f.layout))reformBlocked=collisionReason(this,{...f,layout:newLayout},f.id);
    if(!reformBlocked)f.layout=newLayout;
    else {
      // Narrowing or drawing the sleeves inward can create room before lengthening.
      const partial=f.layout.map(field=>({...field}));let progress=false;
      for(const key of ['width','x','depth','z'])for(let i=0;i<partial.length;i++) {
        const target=newLayout.find(field=>field.key===partial[i].key);if(!target)continue;
        const previous=partial[i][key];partial[i][key]=target[key];
        if(collisionReason(this,{...f,layout:partial},f.id))partial[i][key]=previous;
        else if(Math.abs(previous-partial[i][key])>1e-7)progress=true;
      }
      f.layout=partial;if(progress)reformBlocked='';
    }
    // Old scenes can resume their target without a stored maneuver.
    if(!f.maneuver) {
      if(f.waypoints.length)this.planWaypoint(f,f.waypoints[0]);
      else if(Math.hypot(f.target.x-f.x,f.target.z-f.z)>0.08)this.planWaypoint(f,{...f.target,explicitHeading:f.orderExplicitHeading});
      else if(Math.abs(angle(f.target.heading-f.heading))>0.00001)this.turn(f.id,f.target.heading);
    }
    const reforming=layoutsDiffer(f.layout,desiredLayout(f),1e-8)||layoutsDiffer(previous.layout,f.layout,1e-8);
    if(reforming&&f.maneuver)f.maneuver.reformPending=true;
    if(!reforming&&f.maneuver?.reformPending) {
      if(f.maneuver.kind==='march'){this.planWaypoint(f,f.waypoints[0]??{...f.target,explicitHeading:f.orderExplicitHeading});this.refreshWaypointHeadings(f);}
      else this.turn(f.id,f.target.heading);
    }
    let blocked='';
    let movementDt=dt;
    if(f.maneuver?.kind==='march'&&!reforming&&f.waypoints.length<=1) {
      const remaining=this.remainingMarchTime(f);
      const hasStop=f.drumSignal?.key==='stop';
      const duration=signalDurationCycles('stop')/MARCH_CYCLES_PER_SECOND;
      const nextRelease=nextMarchBeat(nextMarchBeat(this.time)+duration);
      if(!hasStop&&remaining<=duration+0.5/MARCH_CYCLES_PER_SECOND&&this.time+remaining<=nextRelease+1e-9)this.startDrumSignal(f,'stop');
      if(f.drumSignal?.key==='stop') {
        // Let the last stretch reach its pose only after the entire command,
        // including its ringing tail, on a shared footfall.
        const release=nextMarchBeat(f.drumSignal.endProgress/MARCH_CYCLES_PER_SECOND);
        const available=release-(this.time-dt);
        if(available>dt&&remaining<available)movementDt=dt*remaining/available;
      }
    }
    // Finish the shape change before wheeling: deformation and rotation must
    // not add up to a pace beyond the outer file's capacity.
    if(f.maneuver&&!reforming) {
      const plan=f.maneuver;
      if(plan.kind==='march'&&plan.stage==='wheel'&&Math.abs(angle(plan.heading-f.heading))<0.00001)plan.stage='march';
      if(plan.stage==='wheel'||plan.stage==='arrival') {
        const pose=wheelStep(f,plan,movementDt);
        blocked=collisionReason(this,{...f,...pose},f.id);
        if(!blocked){f.x=pose.x;f.z=pose.z;f.heading=pose.heading;}
        if(!blocked&&Math.abs(angle(plan.heading-f.heading))<0.00001) {
          if(plan.kind==='turn'||plan.stage==='arrival')f.maneuver=null;
          else plan.stage='march';
        }
      }else {
        const dx=f.target.x-f.x,dz=f.target.z-f.z,distance=Math.hypot(dx,dz);
        const h=distance>0.00001?Math.atan2(dx,-dz):f.heading;
        const speed=this.marchTravelSpeed(f,f.x,f.z,h);
        const move=Math.min(distance,speed*movementDt);
        const pose={x:f.x+(distance?dx/distance*move:0),z:f.z+(distance?dz/distance*move:0),heading:f.heading};
        blocked=collisionReason(this,{...f,...pose},f.id);
        if(!blocked){f.x=pose.x;f.z=pose.z;}
        if(!blocked&&distance-move<0.00001) {
          if(f.orderExplicitHeading&&Math.abs(angle(f.target.heading-f.heading))>0.00001) {
            f.maneuver={kind:'march',stage:'arrival',heading:f.target.heading,anchor:{x:0,z:0}};
          }else f.maneuver=null;
        }
      }
    }
    if(!f.maneuver&&!reforming&&f.waypoints.length&&Math.hypot(f.x-f.target.x,f.z-f.target.z)<=0.08&&Math.abs(angle(f.heading-f.target.heading))<0.00001) {
      f.waypoints.shift();
      if(f.waypoints.length){this.planWaypoint(f,f.waypoints[0]);this.refreshWaypointHeadings(f);}
    }
    f.motion=previous;
    const changed=Math.hypot(f.x-previous.x,f.z-previous.z)>1e-8||Math.abs(angle(f.heading-previous.heading))>1e-8||f.layout.some(field=>{const prior=previous.layout.find(item=>item.key===field.key);return !prior||['x','z','width','depth'].some(key=>Math.abs(field[key]-prior[key])>1e-8);});
    // Accepted movement stays on the shared clock; stopped troops must rejoin
    // at a future beat. Zero-distance stage transitions keep their permission.
    if(changed)f.marchActive=true;
    else if(blocked||reformBlocked||!needsMovement(f)){f.marchActive=false;f.marchStartTime=null;}
    if(blocked)f.status=blocked;
    else if(reformBlocked)f.status=`Omformning blokeret: ${reformBlocked.toLowerCase()}`;
    else if(reforming)f.status='Omformer';
    else if(f.maneuver)f.status=f.maneuver.stage==='march'?'Marcherer':'Vender';
    else if(layoutsDiffer(f.layout,desiredLayout(f)))f.status='Omformer';
    else f.status='Holder stilling';
  }

  snapshot({visualBudget=600,showSoldiers=true}={}) {
    const budget=Math.floor(clamp(finite(visualBudget,600),0,20000)),counts=countsForBudget(this.formations,showSoldiers?budget:0),soldiers=[];
    const formations=this.formations.map((f,index)=>{
      const visualCount=counts[index];
      if(visualCount&&f.strength) {
        const desired=desiredLayout(f),capacity=desired.reduce((sum,field)=>sum+field.count,0);
        // A deterministic ranking gives permanent casualty holes and stable decoration slots.
        const alive=[];for(let i=0;i<capacity;i++)alive.push({i,rank:hash(i,f.seed)});
        alive.sort((a,b)=>a.rank-b.rank||a.i-b.i);alive.length=Math.min(f.strength,alive.length);alive.sort((a,b)=>a.i-b.i);
        for(let n=0;n<visualCount;n++) {
          const slot=alive[Math.min(alive.length-1,Math.floor((n+0.5)*alive.length/visualCount))]?.i;if(slot===undefined)continue;
          let offset=0,field;
          for(const item of desired){if(slot<offset+item.count){field=item;break;}offset+=item.count;}
          if(!field)continue;
          const actual=f.layout.find(item=>item.key===field.key);if(!actual||actual.width<0.01||actual.depth<0.01)continue;
          const local=slot-offset,col=local%field.files,row=Math.floor(local/field.files),rows=Math.max(1,Math.ceil(field.count/field.files));
          const lx=actual.x+((col+0.5)/field.files-0.5)*actual.width,lz=actual.z+((row+0.5)/rows-0.5)*actual.depth;
          const [x,z]=toWorld(f,lx,lz),prior=f.motion?.layout.find(item=>item.key===field.key);
          let speed=0,heading=f.heading;
          if(prior&&f.motion.dt>0) {
            const px=prior.x+((col+0.5)/field.files-0.5)*prior.width,pz=prior.z+((row+0.5)/rows-0.5)*prior.depth;
            const [ox,oz]=toWorld(f.motion,px,pz),vx=(x-ox)/f.motion.dt,vz=(z-oz)/f.motion.dt;
            speed=Math.hypot(vx,vz);
            if(speed>0.025)heading=Math.atan2(vx,-vz);
          }
          soldiers.push({x,z,heading,moving:speed>0.025,phase:hash(slot,f.seed+17),animationSeed:hash(slot,f.seed+31),speed,cadenceSpeed:f.speed,cadenceRate:f.cadenceRate,movementPhase:f.marchPhase,role:field.role,formationId:f.id});
        }
      }
      const targetF={...f,x:f.target.x,z:f.target.z,heading:f.target.heading};
      return {id:f.id,name:f.name,x:f.x,z:f.z,heading:f.heading,target:{...f.target},strength:f.strength,status:f.status,
        frontFiles:f.frontFiles,spacing:f.spacing,rankSpacing:f.rankSpacing,speed:f.speed,turnRate:f.turnRate,turnAnchor:f.turnAnchor,shape:f.shape,composition:f.composition,
        marchPhase:f.marchPhase,cadenceRate:f.cadenceRate,cadenceProgress:f.cadenceProgress,marchActive:f.marchActive,marchStartTime:f.marchStartTime,drumSignal:clone(f.drumSignal),maneuver:clone(f.maneuver),anchor:f.maneuver&&f.maneuver.stage!=='march'?toWorld(f,f.maneuver.anchor.x,f.maneuver.anchor.z):null,
        fields:fieldsOf(f),targetFields:fieldsOf(targetF,desiredLayout(f)),visualCount,
        waypoints:f.waypoints.map((point,index)=>{const pose={...f,x:point.x,z:point.z,heading:point.heading};return {id:point.id,x:point.x,z:point.z,heading:point.heading,active:index===0,fields:fieldsOf(pose,desiredLayout(f)),corners:waypointCorners(pose)};})};
    });
    return {time:this.time,terrain:this.terrain,formations,soldiers,visualCount:soldiers.length,strength:this.formations.reduce((sum,f)=>sum+f.strength,0)};
  }
  exportScene(){return {schema:'walking-fortress-formations-v1',terrain:this.terrain,time:this.time,nextId:this.nextId,selectedId:this.selectedId,formations:clone(this.formations)};}
  importScene(data) {
    if(!data||typeof data!=='object'||data.schema!=='walking-fortress-formations-v1'||!Array.isArray(data.formations)||data.formations.length>24)throw new Error('Filen er ikke en gyldig formationstest.');
    if(!terrainNames.includes(data.terrain))throw new Error('Ukendt terræn i filen.');
    const sceneTime=clamp(finite(data.time,0),0,1e7);
    const ids=new Set(),formations=data.formations.map((raw,index)=>{
      if(!raw||typeof raw!=='object'||!Number.isInteger(raw.id)||raw.id<1||ids.has(raw.id))throw new Error('Formationerne har ugyldige numre.');
      ids.add(raw.id);const f=sanitize(raw,raw.id,`Fænnike ${index+1}`);
      // Wheel centers may legally move beyond the command-click margin.
      f.x=clamp(finite(raw.x,f.x),terrainBounds.minX,terrainBounds.maxX);f.z=clamp(finite(raw.z,f.z),terrainBounds.minZ,terrainBounds.maxZ);
      const targetLimit=Object.hasOwn(raw,'turnAnchor')?300:65;
      f.target={x:clamp(finite(raw.target?.x,f.x),-targetLimit,targetLimit),z:clamp(finite(raw.target?.z,f.z),-targetLimit,targetLimit),heading:angle(finite(raw.target?.heading,f.heading))};
      f.footprintCount=Math.round(clamp(finite(raw.footprintCount,f.strength),f.strength,20000));f.orderExplicitHeading=!!raw.orderExplicitHeading;
      const layout=Array.isArray(raw.layout)?raw.layout:null;
      f.layout=layout&&layout.length<=3&&layout.every(item=>item&&roleKeys.includes(item.key)&&['pike','shot'].includes(item.role)&&['x','z','width','depth','count','files'].every(k=>Number.isFinite(item[k]))&&item.width>=0&&item.depth>=0&&item.width<=300&&item.depth<=300&&item.count>=0&&item.count<=20000&&item.files>=1&&item.files<=100)?clone(layout):desiredLayout(f);
      if(Object.hasOwn(raw,'waypoints')) {
        const pointIds=new Set();
        if(!Array.isArray(raw.waypoints)||raw.waypoints.length>64)throw new Error('Ruten har for mange eller ugyldige rutepunkter.');
        f.waypoints=raw.waypoints.map(point=>{
          if(!point||!Number.isSafeInteger(point.id)||point.id<1||pointIds.has(point.id)||!['x','z','heading'].every(key=>Number.isFinite(point[key]))||Math.abs(point.x)>65||Math.abs(point.z)>65)throw new Error('Ruten har ugyldige rutepunkter.');
          pointIds.add(point.id);return {id:point.id,x:point.x,z:point.z,heading:angle(point.heading),explicitHeading:point.explicitHeading!==false};
        });
      }
      f.nextWaypointId=Math.max(1,...f.waypoints.map(point=>point.id+1),Number.isSafeInteger(raw.nextWaypointId)&&raw.nextWaypointId>0?raw.nextWaypointId:1);
      f.marchPhase=marchPhaseAt(sceneTime);f.cadenceProgress=sceneTime*MARCH_CYCLES_PER_SECOND;
      const signal=raw.drumSignal;
      if(signal&&Number.isSafeInteger(signal.id)&&signal.id>0&&['start','stop'].includes(signal.key)&&Number.isFinite(signal.startProgress)&&signal.startProgress>=0&&signal.startProgress<=sceneTime*MARCH_CYCLES_PER_SECOND+0.5+1e-8&&Number.isFinite(signal.endProgress)&&Math.abs(signal.endProgress-signal.startProgress-signalDurationCycles(signal.key))<1e-8) {
        const beat=(signal.startProgress-0.125)/0.5;
        if(Math.abs(beat-Math.round(beat))<1e-8)f.drumSignal={id:signal.id,key:signal.key,startProgress:signal.startProgress,endProgress:signal.endProgress};
      }
      f.nextDrumSignalId=Math.max(1,(f.drumSignal?.id??0)+1,Number.isSafeInteger(raw.nextDrumSignalId)&&raw.nextDrumSignalId>0?raw.nextDrumSignalId:1);
      f.marchActive=raw.marchActive===true;
      const gateLimit=f.drumSignal?.key==='start'?nextMarchBeat(f.drumSignal.endProgress/MARCH_CYCLES_PER_SECOND):sceneTime+1/MARCH_CYCLES_PER_SECOND;
      f.marchStartTime=Number.isFinite(raw.marchStartTime)&&raw.marchStartTime>=0&&raw.marchStartTime<=Math.max(sceneTime,gateLimit)+1e-8?raw.marchStartTime:null;
      if(!f.marchActive&&f.drumSignal?.key==='start'&&sceneTime*MARCH_CYCLES_PER_SECOND<f.drumSignal.endProgress)f.marchStartTime=nextMarchBeat(f.drumSignal.endProgress/MARCH_CYCLES_PER_SECOND);
      if(f.marchActive&&(f.marchStartTime===null||f.marchStartTime>sceneTime))f.marchActive=false;
      const plan=raw.maneuver;
      if(plan&&['march','turn'].includes(plan.kind)&&['wheel','march','arrival'].includes(plan.stage)&&Number.isFinite(plan.heading)&&Number.isFinite(plan.anchor?.x)&&Number.isFinite(plan.anchor?.z)&&Math.abs(plan.anchor.x)<=300&&Math.abs(plan.anchor.z)<=300)f.maneuver={kind:plan.kind,stage:plan.stage,heading:angle(plan.heading),anchor:{x:plan.anchor.x,z:plan.anchor.z}};
      if(f.maneuver&&plan.reformPending===true)f.maneuver.reformPending=true;
      const motion=raw.motion;
      if(motion&&Number.isFinite(motion.dt)&&motion.dt>0&&motion.dt<=0.5&&['x','z','heading'].every(key=>Number.isFinite(motion[key])&&Math.abs(motion[key])<=300)&&Array.isArray(motion.layout)&&motion.layout.length<=3&&motion.layout.every(item=>item&&roleKeys.includes(item.key)&&['x','z','width','depth'].every(key=>Number.isFinite(item[key])&&Math.abs(item[key])<=300)&&item.width>=0&&item.depth>=0&&item.width<=300&&item.depth<=300))f.motion=clone(motion);
      if(!f.strength){f.waypoints=[];f.maneuver=null;f.motion=null;f.marchActive=false;f.marchStartTime=null;f.drumSignal=null;f.target={x:f.x,z:f.z,heading:f.heading};f.orderExplicitHeading=false;}
      f.status=String(raw.status??'Holder stilling').slice(0,120);return f;
    });
    this.formations=formations;this.terrain=data.terrain;this.time=sceneTime;this.nextId=Math.max(1,...formations.map(f=>f.id+1));this.selectedId=data.selectedId===null?null:ids.has(data.selectedId)?data.selectedId:(formations[0]?.id??null);return this;
  }
}
