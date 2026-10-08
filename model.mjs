import {heightAt,terrainNames,terrainBounds,terrainContainsFootprint,polygonsOverlap} from './terrain.mjs';
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
function sanitize(raw,id,name) {
  const strength=Math.round(clamp(finite(raw.strength,216),0,20000));
  const x=clamp(finite(raw.x,0),-65,65),z=clamp(finite(raw.z,29),-65,65),heading=angle(finite(raw.heading,0));
  return {id,name:String(raw.name??name).slice(0,80),x,z,heading,target:{x,z,heading},strength,
    frontFiles:Math.round(clamp(finite(raw.frontFiles,12),1,100)),spacing:clamp(finite(raw.spacing,0.9),0.35,3),rankSpacing:clamp(finite(raw.rankSpacing,0.95),0.35,3),
    speed:clamp(finite(raw.speed,2.1),0.1,10),turnRate:clamp(finite(raw.turnRate,0.65),0.05,3),
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
const layoutsDiffer=(a,b)=>a.length!==b.length||a.some(field=>{const other=b.find(f=>f.key===field.key);return !other||['x','z','width','depth'].some(k=>Math.abs(field[k]-other[k])>0.02);});
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
    f.target={x:f.x,z:f.z,heading:f.heading};f.status='Holder stilling';
    this.nextId++;this.formations.push(f);this.selectedId=id;return f;
  }
  removeFormation(id){this.formations=this.formations.filter(f=>f.id!==id);if(this.selectedId===id)this.selectedId=this.formations[0]?.id??null;}
  updateFormation(id,patch={}) {
    const f=this.formations.find(f=>f.id===id);if(!f)return null;
    const previous=f.strength,validated=sanitize({...f,...patch},f.id,f.name);
    const keys=['name','frontFiles','spacing','rankSpacing','speed','turnRate','shape','composition','strength'];
    for(const key of keys)if(Object.hasOwn(patch,key))f[key]=validated[key];
    if(Object.hasOwn(patch,'strength')){f.footprintCount=Math.max(f.footprintCount,f.strength);if(f.strength>previous)f.lossMode='ranks';}
    if(Object.hasOwn(patch,'heading'))f.target.heading=validated.heading;
    if(Object.hasOwn(patch,'x')||Object.hasOwn(patch,'z')){f.target.x=validated.x;f.target.z=validated.z;}
    f.status='Omformer';return f;
  }
  order(id,{x,z,heading}={}) {
    const f=this.formations.find(f=>f.id===id);if(!f)return false;
    if(!Number.isFinite(x)||!Number.isFinite(z))return false;
    const tx=clamp(x,-65,65),tz=clamp(z,-65,65),dx=tx-f.x,dz=tz-f.z;
    f.target={x:tx,z:tz,heading:Number.isFinite(heading)?angle(heading):(Math.hypot(dx,dz)>0.02?Math.atan2(dx,-dz):f.heading)};
    f.orderExplicitHeading=Number.isFinite(heading);f.status='Marcherer';return true;
  }
  applyLosses(id,fraction,mode='ranks') {
    const f=this.formations.find(f=>f.id===id);if(!f)return 0;
    const before=f.strength,after=Math.max(0,before-Math.round(before*clamp(finite(fraction,0),0,1)));
    if(!['holes','narrow','ranks'].includes(mode))mode='ranks';
    if(mode==='narrow'&&before>0)f.frontFiles=Math.max(f.composition==='mixed'?3:1,Math.round(f.frontFiles*after/before));
    if(mode!=='holes')f.footprintCount=after;else f.footprintCount=Math.max(f.footprintCount,before);
    f.strength=after;f.lossMode=mode;f.status=after?'Omformer':'Opløst';return before-after;
  }
  setTerrain(name) {
    if(!terrainNames.includes(name))throw new Error('Ukendt terræn.');
    if(name===this.terrain)return [];
    const previousTerrain=this.terrain,previous=this.formations.map(f=>({f,x:f.x,z:f.z,target:{...f.target},status:f.status}));
    this.terrain=name;const relocated=[];
    try {
      for(const f of this.formations)if(!terrainContainsFootprint(name,fieldsOf(f).map(field=>field.polygon))) {
        const position=findPlacement(this,f);
        if(!position)throw new Error('Der er ikke plads til alle fænnikeformationerne på dette terræn.');
        f.x=position.x;f.z=position.z;f.target={x:f.x,z:f.z,heading:f.heading};f.status=f.strength?'Holder stilling':'Opløst';relocated.push(f.id);
      }
    }catch(error){this.terrain=previousTerrain;for(const item of previous){item.f.x=item.x;item.f.z=item.z;item.f.target=item.target;item.f.status=item.status;}throw error;}
    return relocated;
  }
  step(dt) {
    if(!Number.isFinite(dt)||dt<=0)return;
    const duration=Math.min(dt,0.5),substeps=Math.ceil(duration/0.05),slice=duration/substeps;
    for(let i=0;i<substeps;i++){this.time+=slice;for(const f of this.formations)this.stepFormation(f,slice);}
  }
  stepFormation(f,dt) {
    if(!f.strength){f.layout=interpolatedLayout(f,dt);f.status='Opløst';return;}
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
    const dx=f.target.x-f.x,dz=f.target.z-f.z,distance=Math.hypot(dx,dz);
    const travelHeading=distance>0.08?Math.atan2(dx,-dz):f.target.heading;
    const delta=angle(travelHeading-f.heading),maxTurn=f.turnRate*dt;
    const heading=angle(f.heading+clamp(delta,-maxTurn,maxTurn));
    const alignment=clamp(1-Math.abs(delta)/(Math.PI*0.7),0.05,1);
    const rise=heightAt(this.terrain,f.x+Math.sin(travelHeading),f.z-Math.cos(travelHeading))-heightAt(this.terrain,f.x,f.z);
    const terrainFactor=clamp(1-Math.max(0,rise)*1.8,0.45,1);
    const speed=f.speed*(f.shape==='column'?1.12:1)*alignment*terrainFactor;
    const move=distance>0.08?Math.min(distance,speed*dt):0;
    const nx=f.x+(distance?dx/distance*move:0),nz=f.z+(distance?dz/distance*move:0);
    let candidate={...f,x:nx,z:nz,heading},blocked=collisionReason(this,candidate,f.id);
    if(blocked) {
      // Attempt rotation in place first. If it is blocked, hold orientation and move.
      const rotate={...f,heading};
      if(!collisionReason(this,rotate,f.id))f.heading=heading;
      candidate={...f,x:nx,z:nz};
      if(!collisionReason(this,candidate,f.id)){f.x=nx;f.z=nz;blocked='';}
    }else {f.x=nx;f.z=nz;f.heading=heading;}
    const remaining=Math.hypot(f.target.x-f.x,f.target.z-f.z),turnRemaining=Math.abs(angle(f.target.heading-f.heading));
    if(blocked)f.status=blocked;
    else if(reformBlocked)f.status=`Omformning blokeret: ${reformBlocked.toLowerCase()}`;
    else if(remaining>0.08)f.status='Marcherer';
    else if(turnRemaining>0.015)f.status='Vender';
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
          const [x,z]=toWorld(f,lx,lz);
          soldiers.push({x,z,heading:f.heading,moving:['Marcherer','Vender','Omformer'].includes(f.status),phase:hash(slot,f.seed+17),role:field.role,formationId:f.id});
        }
      }
      const targetF={...f,x:f.target.x,z:f.target.z,heading:f.target.heading};
      return {id:f.id,name:f.name,x:f.x,z:f.z,heading:f.heading,target:{...f.target},strength:f.strength,status:f.status,
        frontFiles:f.frontFiles,spacing:f.spacing,rankSpacing:f.rankSpacing,speed:f.speed,turnRate:f.turnRate,shape:f.shape,composition:f.composition,
        fields:fieldsOf(f),targetFields:fieldsOf(targetF,desiredLayout(f)),visualCount};
    });
    return {time:this.time,terrain:this.terrain,formations,soldiers,visualCount:soldiers.length,strength:this.formations.reduce((sum,f)=>sum+f.strength,0)};
  }
  exportScene(){return {schema:'walking-fortress-formations-v1',terrain:this.terrain,time:this.time,nextId:this.nextId,selectedId:this.selectedId,formations:clone(this.formations)};}
  importScene(data) {
    if(!data||typeof data!=='object'||data.schema!=='walking-fortress-formations-v1'||!Array.isArray(data.formations)||data.formations.length>24)throw new Error('Filen er ikke en gyldig formationstest.');
    if(!terrainNames.includes(data.terrain))throw new Error('Ukendt terræn i filen.');
    const ids=new Set(),formations=data.formations.map((raw,index)=>{
      if(!raw||typeof raw!=='object'||!Number.isInteger(raw.id)||raw.id<1||ids.has(raw.id))throw new Error('Formationerne har ugyldige numre.');
      ids.add(raw.id);const f=sanitize(raw,raw.id,`Fænnike ${index+1}`);
      f.target={x:clamp(finite(raw.target?.x,f.x),-65,65),z:clamp(finite(raw.target?.z,f.z),-65,65),heading:angle(finite(raw.target?.heading,f.heading))};
      f.footprintCount=Math.round(clamp(finite(raw.footprintCount,f.strength),f.strength,20000));f.orderExplicitHeading=!!raw.orderExplicitHeading;
      const layout=Array.isArray(raw.layout)?raw.layout:null;
      f.layout=layout&&layout.length<=3&&layout.every(item=>item&&roleKeys.includes(item.key)&&['pike','shot'].includes(item.role)&&['x','z','width','depth','count','files'].every(k=>Number.isFinite(item[k]))&&item.width>=0&&item.depth>=0&&item.width<=300&&item.depth<=300&&item.count>=0&&item.count<=20000&&item.files>=1&&item.files<=100)?clone(layout):desiredLayout(f);
      f.status=String(raw.status??'Holder stilling').slice(0,120);return f;
    });
    this.formations=formations;this.terrain=data.terrain;this.time=Math.max(0,finite(data.time,0));this.nextId=Math.max(1,...formations.map(f=>f.id+1));this.selectedId=ids.has(data.selectedId)?data.selectedId:(formations[0]?.id??null);return this;
  }
}
