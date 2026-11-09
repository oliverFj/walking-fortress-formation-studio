import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioModel} from './model.mjs';
import {MARCH_CYCLES_PER_SECOND,nextMarchBeat} from './march.mjs';
import {signalDurationCycles} from './drum-signals.mjs';
import {heightAt,terrainContainsFootprint,polygonsOverlap} from './terrain.mjs';
const alone=(options={})=>{const model=new StudioModel();model.formations=[];model.nextId=1;model.addFormation(options);return model;};
const advance=(model,seconds)=>{for(let t=0;t<seconds;t+=0.05)model.step(0.05);};
const points=soldiers=>new Set(soldiers.map(s=>`${s.x.toFixed(5)},${s.z.toFixed(5)}`));
test('drawing budgets and snapshots cannot change formation simulation',()=>{
  const first=new StudioModel(),second=new StudioModel();second.importScene(first.exportScene());
  first.order(1,{x:-25,z:-10});second.order(1,{x:-25,z:-10});
  for(let i=0;i<200;i++){first.snapshot({visualBudget:0,showSoldiers:false});second.snapshot({visualBudget:5000});first.step(0.05);second.step(0.05);}
  assert.deepEqual(first.exportScene(),second.exportScene());
  assert.equal(first.snapshot({visualBudget:37}).visualCount,37);
  assert.equal(first.snapshot({showSoldiers:false}).strength,636);
  assert.equal(first.snapshot({showSoldiers:false}).visualCount,0);
});
test('terrain is finite and field collision uses the actual subfields',()=>{
  for(const name of ['flat','slope','ridge','passage'])for(const x of [-70,0,70])for(const z of [-70,0,70])assert.ok(Number.isFinite(heightAt(name,x,z)));
  assert.equal(terrainContainsFootprint('passage',[[[-3,-4],[3,-4],[3,4],[-3,4]]]),true);
  assert.equal(terrainContainsFootprint('passage',[[[-5,-4],[5,-4],[5,4],[-5,4]]]),false);
  const model=new StudioModel();assert.equal(model.snapshot().formations[1].fields.length,3);
  for(const f of model.snapshot().formations)for(const field of f.fields)for(const p of field.polygon)assert.ok(p.every(Number.isFinite));
});
test('battle frontage stops at a narrow passage and can reform to pass',()=>{
  const model=alone({x:0,z:29,strength:216,frontFiles:12});model.setTerrain('passage');model.order(1,{x:0,z:-29});advance(model,28);
  const f=model.formations[0];assert.ok(f.z>10);assert.match(f.status,/Passagen/);
  model.updateFormation(1,{shape:'column'});advance(model,62);
  assert.ok(f.z<-25,`column stopped at z=${f.z}, ${f.status}`);
  assert.ok(terrainContainsFootprint('passage',model.snapshot().formations[0].fields.map(field=>field.polygon)));
});
test('opposing formations wait without their footprints overlapping',()=>{
  const model=alone({x:-14,z:0,strength:48,frontFiles:6});model.addFormation({x:14,z:0,strength:48,frontFiles:6});
  model.order(1,{x:10,z:0});model.order(2,{x:-10,z:0});
  for(let i=0;i<700;i++){
    model.step(0.05);const fs=model.snapshot({showSoldiers:false}).formations;
    for(const a of fs[0].fields)for(const b of fs[1].fields)assert.equal(polygonsOverlap(a.polygon,b.polygon,0.119),false);
  }
  assert.ok(model.formations.some(f=>/anden fænnike/.test(f.status)));
});
test('casualty policies preserve strength and distinguish holes/front/ranks',()=>{
  const holes=alone({strength:120,frontFiles:12});const before=points(holes.snapshot({visualBudget:1000}).soldiers);assert.equal(holes.applyLosses(1,0.25,'holes'),30);
  const after=holes.snapshot({visualBudget:1000});assert.equal(after.strength,90);assert.equal(after.visualCount,90);for(const point of points(after.soldiers))assert.ok(before.has(point));
  assert.deepEqual(after.formations[0].fields,holes.snapshot({visualBudget:0}).formations[0].targetFields);
  const narrow=alone({strength:120,frontFiles:12}),ranks=alone({strength:120,frontFiles:12});
  narrow.applyLosses(1,0.25,'narrow');ranks.applyLosses(1,0.25,'ranks');
  assert.equal(narrow.formations[0].frontFiles,9);assert.equal(ranks.formations[0].frontFiles,12);
  assert.equal(narrow.snapshot().strength,ranks.snapshot().strength);
});
test('scene round trip preserves the current deformation and target',()=>{
  const first=new StudioModel();first.formations[0].heading=1.0775407948580606;first.formations[0].target.heading=1.0775407948580606;first.setTerrain('ridge');first.updateFormation(2,{frontFiles:18,spacing:1.1});first.order(2,{x:10,z:-20,heading:1.3});advance(first,2.1);
  const data=first.exportScene(),second=new StudioModel();second.importScene(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(second.exportScene(),data);assert.deepEqual(second.snapshot({visualBudget:49}),first.snapshot({visualBudget:49}));
  assert.throws(()=>second.importScene({schema:'invalid',formations:[]}));
  const duplicate=JSON.parse(JSON.stringify(data));duplicate.formations[1].id=duplicate.formations[0].id;assert.throws(()=>second.importScene(duplicate));
});

test('switching terrain relocates invalid footprints and preserves valid ones',()=>{
  const model=alone({x:20,z:0,strength:120,heading:0.2});model.addFormation({x:0,z:45,strength:120});
  model.order(1,{x:20,z:-30});model.order(2,{x:0,z:50});
  const settings={...model.formations[0]},layout=JSON.parse(JSON.stringify(settings.layout)),validPosition={x:model.formations[1].x,z:model.formations[1].z,target:{...model.formations[1].target}};
  assert.deepEqual(model.setTerrain('passage'),[1]);
  const f=model.formations[0];assert.equal(f.strength,settings.strength);assert.equal(f.heading,settings.heading);assert.deepEqual(f.layout,layout);
  assert.deepEqual(f.target,{x:f.x,z:f.z,heading:f.heading});assert.deepEqual({x:model.formations[1].x,z:model.formations[1].z,target:model.formations[1].target},validPosition);
  const fs=model.snapshot({showSoldiers:false}).formations;
  for(const formation of fs)assert.ok(terrainContainsFootprint('passage',formation.fields.map(field=>field.polygon)));
  for(const a of fs[0].fields)for(const b of fs[1].fields)assert.equal(polygonsOverlap(a.polygon,b.polygon,0.119),false);
  const relocatedZ=f.z;model.order(1,{x:f.x,z:f.z+Math.sign(f.z)*2});advance(model,8);assert.ok(Math.abs(model.formations[0].z)>Math.abs(relocatedZ)+1);
});
test('adding without free space rejects insertion and terrain-switch failure rolls back',()=>{
  const model=alone({x:0,z:0,strength:20000,frontFiles:100,spacing:1.3,rankSpacing:0.65});
  const before=model.exportScene();assert.throws(()=>model.addFormation(),/ikke plads/);assert.deepEqual(model.exportScene(),before);
  assert.throws(()=>model.setTerrain('passage'),/ikke plads/);assert.deepEqual(model.exportScene(),before);
});
test('decorative soldiers walk while turning and reforming',()=>{
  const model=alone({x:0,z:29,strength:120});model.order(1,{x:0,z:29,heading:0.8});model.step(0.05);
  assert.ok(model.snapshot().soldiers.every(s=>!s.moving));assert.equal(model.formations[0].heading,0);
  advance(model,model.formations[0].marchStartTime-model.time+.05);
  assert.equal(model.formations[0].status,'Vender');assert.ok(model.snapshot().soldiers.every(s=>s.moving));
  model.halt(1);model.updateFormation(1,{frontFiles:14});model.step(0.05);
  assert.ok(model.snapshot().soldiers.every(s=>!s.moving));
  advance(model,model.formations[0].marchStartTime-model.time+.05);
  assert.equal(model.formations[0].status,'Omformer');assert.ok(model.snapshot().soldiers.every(s=>s.moving));
});

test('animation seeds and pace are decorative and stable across visual budgets',()=>{
  const model=alone({strength:120,composition:'mixed',speed:1.35});
  const before=model.exportScene(),full=model.snapshot({visualBudget:120}).soldiers;
  const reduced=model.snapshot({visualBudget:30}).soldiers;
  assert.deepEqual(model.exportScene(),before);
  for(const soldier of reduced) {
    const original=full.find(value=>value.x===soldier.x&&value.z===soldier.z);
    assert.ok(original);
    assert.equal(soldier.animationSeed,original.animationSeed);
    assert.equal(soldier.phase,original.phase);
    assert.equal(soldier.cadenceSpeed,1.35);
    assert.equal(soldier.speed,0);
    assert.equal(soldier.movementPhase,original.movementPhase);
  }
  assert.ok(full.some(soldier=>soldier.role==='pike'));
  assert.ok(full.some(soldier=>soldier.role==='shot'));
  model.updateFormation(1,{speed:3.4});
  assert.ok(model.snapshot().soldiers.every(soldier=>soldier.speed===0&&soldier.cadenceSpeed===3.4));
});


test('waypoint previews include each desired field and four rotated formation corners',()=>{
  const model=alone({x:0,z:20,strength:96,composition:'mixed'}),f=model.formations[0];
  assert.equal(model.setWaypoint(f.id,{x:15,z:0,heading:Math.PI/2}),true);
  assert.equal(model.setWaypoint(f.id,{x:-10,z:-20},true),true);
  const preview=model.snapshot({showSoldiers:false}).formations[0].waypoints;
  assert.equal(preview.length,2);assert.equal(preview[0].active,true);assert.equal(preview[1].active,false);
  assert.notEqual(preview[0].id,preview[1].id);assert.equal(preview[0].fields.length,3);
  for(const point of preview){assert.equal(point.corners.length,4);assert.ok(point.corners.flat().every(Number.isFinite));assert.ok(Number.isFinite(point.heading));}
  const distances=preview[0].corners.map(([x,z])=>Math.hypot(x-15,z));
  assert.ok(distances.every(value=>Math.abs(value-distances[0])<1e-9),'combined centered footprint has four equally distant corners');
  const queuedId=preview[1].id;
  assert.equal(model.rotateWaypoint(f.id,preview[0].id,0.3),true);
  assert.equal(f.waypoints[0].heading,0.3);assert.equal(f.waypoints[1].id,queuedId);
  assert.notEqual(f.waypoints[1].heading,preview[1].heading,'unrotated next preview follows the previous desired heading');
  assert.equal(model.rotateWaypoint(f.id,999,0),false);
});

test('a route starts automatically and finishes its desired heading before the next waypoint',()=>{
  const model=alone({x:0,z:20,strength:24,frontFiles:6,speed:3,turnRate:3}),f=model.formations[0];
  model.setWaypoint(f.id,{x:0,z:5,heading:Math.PI/2});
  model.setWaypoint(f.id,{x:20,z:5,heading:-0.3},true);
  const firstId=f.waypoints[0].id,secondId=f.waypoints[1].id,startTime=f.marchStartTime;let sawArrival=false,sawNext=false;
  for(let i=0;i<2500&&f.waypoints.length;i++){
    model.step(0.05);
    if(f.waypoints[0]?.id===firstId&&f.maneuver?.stage==='arrival'){
      sawArrival=true;assert.equal(f.waypoints.length,2);assert.ok(Math.hypot(f.x,f.z-5)<1e-8);
    }
    if(!sawNext&&f.waypoints[0]?.id===secondId){
      sawNext=true;assert.ok(Math.hypot(f.x,f.z-5)<1e-8);assert.ok(Math.abs(f.heading-Math.PI/2)<1e-8);
      assert.equal(f.marchActive,true);assert.equal(f.marchStartTime,startTime,'continuous waypoint transitions retain their original march start');
    }
  }
  assert.ok(sawArrival);assert.ok(sawNext);assert.equal(f.waypoints.length,0);
  assert.ok(Math.hypot(f.x-20,f.z-5)<1e-8);assert.ok(Math.abs(f.heading+0.3)<1e-8);assert.equal(f.status,'Holder stilling');
});

test('reforming preserves the queued route while a new order, turn or halt replaces it',()=>{
  const model=alone({x:0,z:25,strength:48,frontFiles:6}),f=model.formations[0];
  model.setWaypoint(f.id,{x:0,z:0});model.setWaypoint(f.id,{x:15,z:-20,heading:1},true);
  const ids=f.waypoints.map(point=>point.id);
  model.updateFormation(f.id,{frontFiles:8,spacing:1.1});advance(model,3);
  assert.deepEqual(f.waypoints.map(point=>point.id),ids);
  model.order(f.id,{x:0,z:-15});assert.equal(f.waypoints.length,1);assert.ok(!ids.includes(f.waypoints[0].id));
  model.order(f.id,{x:f.x,z:f.z,heading:0.6});assert.equal(f.waypoints.length,0);assert.equal(f.maneuver.kind,'turn');
  model.setWaypoint(f.id,{x:0,z:-20});model.halt(f.id);assert.equal(f.waypoints.length,0);
  model.setWaypoint(f.id,{x:0,z:-20});model.updateFormation(f.id,{strength:0});assert.equal(f.waypoints.length,0);assert.equal(f.maneuver,null);
});

test('scene restore preserves queued point IDs, resumed motion and an explicitly cleared selection',()=>{
  const first=alone({x:0,z:20,strength:24,frontFiles:6});
  first.setWaypoint(1,{x:10,z:0,heading:0.5});first.setWaypoint(1,{x:-10,z:-10},true);advance(first,0.7);first.selectedId=null;
  const data=first.exportScene(),second=new StudioModel();second.importScene(JSON.parse(JSON.stringify(data)));
  assert.equal(second.selectedId,null);assert.deepEqual(second.exportScene(),data);assert.deepEqual(second.snapshot(),first.snapshot());
  for(let i=0;i<150;i++){first.step(0.05);second.step(0.05);}
  assert.deepEqual(second.exportScene(),first.exportScene());
  for(const mutate of [
    point=>point.x=Infinity,
    point=>point.heading=NaN,
    (_,formation)=>formation.waypoints[1].id=formation.waypoints[0].id,
    (_,formation)=>formation.waypoints=Array.from({length:65},(_,index)=>({id:index+1,x:0,z:0,heading:0}))
  ]){
    const invalid=structuredClone(data);mutate(invalid.formations[0].waypoints[0],invalid.formations[0]);assert.throws(()=>second.importScene(invalid),/rutepunkter/);
  }
  const one=alone();for(let i=0;i<64;i++)assert.equal(one.setWaypoint(1,{x:0,z:0},i>0),true);
  assert.equal(one.setWaypoint(1,{x:0,z:0},true),false);assert.equal(one.formations[0].waypoints.length,64);
});

test('a failed terrain relocation restores the route and complete zero-strength losses clear it',()=>{
  const model=alone({x:0,z:0,strength:20000,frontFiles:100,spacing:1.3,rankSpacing:0.65});
  model.setWaypoint(1,{x:0,z:-20,heading:0.3});model.setWaypoint(1,{x:10,z:-30},true);
  const data=model.exportScene();assert.throws(()=>model.setTerrain('passage'),/ikke plads/);assert.deepEqual(model.exportScene(),data);
  model.applyLosses(1,1);assert.equal(model.formations[0].waypoints.length,0);assert.equal(model.formations[0].maneuver,null);
});


const advanceExact=(model,seconds)=>{
  while(seconds>0.05+1e-9){model.step(.05);seconds-=.05;}
  if(seconds>1e-9)model.step(seconds);
};
const assertSignalBeat=signal=>assert.ok(Math.abs((signal.startProgress-.125)/.5-Math.round((signal.startProgress-.125)/.5))<1e-9);

test('a new move emits one start command and waits for its tail and the next common footfall',()=>{
  const model=alone({x:0,z:20,strength:12,frontFiles:3}),f=model.formations[0];
  advanceExact(model,.43);model.order(1,{x:0,z:-20});
  const signal=structuredClone(f.drumSignal),start={x:f.x,z:f.z,heading:f.heading};
  assert.equal(signal.key,'start');assertSignalBeat(signal);
  assert.ok(Math.abs(signal.endProgress-signal.startProgress-signalDurationCycles('start'))<1e-9);
  const release=nextMarchBeat(signal.endProgress/MARCH_CYCLES_PER_SECOND);
  assert.equal(f.marchStartTime,release);
  model.rotateWaypoint(1,f.waypoints[0].id,.2);model.setWaypoint(1,{x:20,z:-20},true);model.updateFormation(1,{speed:3});
  assert.deepEqual(f.drumSignal,signal,'editing or appending the route does not restart its pending command');
  advanceExact(model,release-model.time-.002);
  assert.deepEqual({x:f.x,z:f.z,heading:f.heading},start);assert.equal(f.marchActive,false);
  assert.ok(model.snapshot().soldiers.every(s=>!s.moving));
  model.order(1,{x:0,z:-22});assert.deepEqual(f.drumSignal,signal,'a new destination in the gap after the phrase keeps the pending common start');assert.equal(f.marchStartTime,release);
  model.step(.02);assert.ok(f.z<start.z);assert.equal(f.marchActive,true);assert.deepEqual(f.drumSignal,signal);
});

test('only the final route point emits a stop command, before arrival, and short travel waits for its end',()=>{
  for(const route of [[{x:0,z:19.75}], [{x:0,z:15},{x:0,z:8,heading:.5}]]) {
    const model=alone({x:0,z:20,strength:12,frontFiles:3,speed:3,turnRate:3}),f=model.formations[0];
    route.forEach((point,index)=>model.setWaypoint(1,point,index>0));
    const startId=f.drumSignal.id;let stop=null,firstStopTime=null,completedTime=null;
    for(let i=0;i<1000;i++) {
      model.step(.01);
      if(f.drumSignal?.key==='stop') {
        assert.equal(f.waypoints.length<=1,true);
        if(!stop){stop=structuredClone(f.drumSignal);firstStopTime=model.time;assert.ok(f.maneuver);assert.equal(f.waypoints.length,1);}
        else assert.deepEqual(f.drumSignal,stop,'the approaching regiment gets exactly one stop command');
      }
      if(!f.waypoints.length){completedTime=model.time;break;}
    }
    assert.ok(stop);assert.equal(stop.id,startId+1);assertSignalBeat(stop);
    assert.ok(firstStopTime<completedTime);
    const release=nextMarchBeat(stop.endProgress/MARCH_CYCLES_PER_SECOND);
    assert.ok(completedTime>=release-1e-8,`arrived ${completedTime} before stop command release ${release}`);
    assert.ok(completedTime<release+.04,'the last stretch ends at its common release footfall');
    const target=route.at(-1);assert.ok(Math.hypot(f.x-target.x,f.z-target.z)<1e-8);
    if(target.heading!==undefined)assert.ok(Math.abs(f.heading-target.heading)<1e-8);
    const id=f.drumSignal.id;advanceExact(model,2);assert.equal(f.drumSignal.id,id);
  }
});

test('signal state survives save/open before startup and during the last stretch, while cancellation clears it',()=>{
  const first=alone({x:0,z:20,strength:12,frontFiles:3,speed:3});first.order(1,{x:0,z:18});
  for(const stage of ['start','stop']) {
    while(first.formations[0].drumSignal?.key!==stage)first.step(.05);
    const data=first.exportScene(),second=new StudioModel();second.importScene(structuredClone(data));
    assert.deepEqual(second.exportScene(),data);assert.deepEqual(second.snapshot({showSoldiers:false}),first.snapshot({showSoldiers:false}));
    for(let i=0;i<5;i++){first.step(.05);second.step(.05);}
    assert.deepEqual(second.exportScene(),first.exportScene());
  }
  first.halt(1);assert.equal(first.formations[0].drumSignal,null);assert.equal(first.formations[0].marchStartTime,null);
  first.order(1,{x:0,z:-20});assert.equal(first.formations[0].drumSignal.key,'start');
  first.updateFormation(1,{strength:0});assert.equal(first.formations[0].drumSignal,null);
  const turn=alone();turn.turn(1,.5);assert.equal(turn.formations[0].drumSignal,null);
  const reform=alone();reform.updateFormation(1,{frontFiles:14});assert.equal(reform.formations[0].drumSignal,null);
});
