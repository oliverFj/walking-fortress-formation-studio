import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioModel} from './model.mjs';
import {polygonsOverlap} from './terrain.mjs';
import {MARCH_CYCLES_PER_SECOND,MARCH_CONTACT_PHASES,nextMarchBeat} from './march.mjs';

const alone=(options={})=>{const model=new StudioModel();model.formations=[];model.nextId=1;model.addFormation({x:0,z:0,...options});return model;};
const advance=(model,seconds)=>{for(let i=0;i<Math.round(seconds/0.05);i++)model.step(0.05);};
const angle=value=>Math.atan2(Math.sin(value),Math.cos(value));
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const world=(f,x,z)=>({x:f.x+x*Math.cos(f.heading)-z*Math.sin(f.heading),z:f.z+x*Math.sin(f.heading)+z*Math.cos(f.heading)});
const frontAnchor=(f,side)=>({
  x:side==='left'?Math.min(...f.layout.map(field=>field.x-field.width/2)):Math.max(...f.layout.map(field=>field.x+field.width/2)),
  z:Math.min(...f.layout.map(field=>field.z-field.depth/2))
});

test('a fixed front-flank wheel keeps its chosen ground anchor, while center turn keeps the center',()=>{
  for(const side of ['left','right','center']) {
    const model=alone({strength:96,frontFiles:12});
    model.updateFormation(1,{turnAnchor:side});
    const f=model.formations[0],local=side==='center'?{x:0,z:0}:frontAnchor(f,side),anchor=world(f,local.x,local.z);
    const target=side==='left'?-Math.PI/2:Math.PI/2;
    model.turn(1,target);
    for(let i=0;i<400;i++) {
      model.step(0.05);
      const current=world(f,local.x,local.z);
      near(current.x,anchor.x);near(current.z,anchor.z);
    }
    near(angle(f.heading-target),0,0.015);
    if(side!=='center')assert.ok(Math.hypot(f.x,f.z)>1,'flank wheel should move the formation center around its anchor');
  }
});

test('wide lines and long columns cap every moving slot at the outer 3 m/s capacity',()=>{
  for(const options of [{strength:96,frontFiles:12},{strength:240,frontFiles:4,shape:'column'}]) {
    const model=alone({...options,speed:3,turnRate:3});
    model.updateFormation(1,{turnAnchor:'left'});model.turn(1,-Math.PI/2);
    let previous=new Map(model.snapshot({visualBudget:1000}).soldiers.map(s=>[s.animationSeed,s]));
    let fastest=0,slowest=Infinity;
    for(let i=0;i<100;i++) {
      model.step(0.05);
      const f=model.formations[0],snapshot=model.snapshot({visualBudget:1000});
      for(const soldier of snapshot.soldiers) {
        const old=previous.get(soldier.animationSeed),actual=Math.hypot(soldier.x-old.x,soldier.z-old.z)/0.05;
        assert.ok(actual<=3+1e-6,`slot exceeded outer capacity: ${actual} m/s`);
        near(soldier.speed,actual,1e-6);
        near(soldier.movementPhase,f.marchPhase);
        fastest=Math.max(fastest,soldier.speed);slowest=Math.min(slowest,soldier.speed);
      }
      previous=new Map(snapshot.soldiers.map(s=>[s.animationSeed,s]));
    }
    assert.ok(fastest>2.5,'outer slots should use the fast gait');
    assert.ok(slowest<0.6,'inner slots should take short steps');
    assert.ok(fastest-slowest>1.8,'outer and inner travel speeds should differ');
  }
});

test('a march order wheels first, then advances facing its actual line of travel to the clicked center',()=>{
  const model=alone({strength:96,frontFiles:12,speed:1.5}),f=model.formations[0],target={x:25,z:-20};
  model.order(1,target);const stages=new Set();
  for(let i=0;i<1600;i++) {
    const previous={x:f.x,z:f.z,stage:f.maneuver?.stage};
    model.step(0.05);if(f.maneuver)stages.add(f.maneuver.stage);
    if(previous.stage==='march'&&f.maneuver?.stage==='march'&&Math.hypot(f.x-previous.x,f.z-previous.z)>1e-7) {
      const travel=Math.atan2(f.x-previous.x,-(f.z-previous.z));
      near(angle(travel-f.heading),0,0.015);
      near(angle(Math.atan2(target.x-f.x,-(target.z-f.z))-f.heading),0,0.015);
    }
  }
  assert.ok(stages.has('wheel'));assert.ok(stages.has('march'));
  assert.ok(Math.hypot(f.x-target.x,f.z-target.z)<=0.08,'march should place the center at the ordered destination');
  assert.equal(f.status,'Holder stilling');
});

test('a blocked wheel holds before intersecting another formation footprint',()=>{
  const model=alone({strength:96,frontFiles:12});
  model.addFormation({x:-4,z:-9,strength:12,frontFiles:3});
  model.updateFormation(1,{turnAnchor:'right'});model.turn(1,Math.PI/2);
  let sawBlocked=false;
  for(let i=0;i<500;i++) {
    model.step(0.05);const snapshot=model.snapshot({showSoldiers:false});
    for(const a of snapshot.formations[0].fields)for(const b of snapshot.formations[1].fields)assert.equal(polygonsOverlap(a.polygon,b.polygon,0.119),false);
    sawBlocked ||= /Venter|blokeret/i.test(snapshot.formations[0].status);
  }
  assert.ok(sawBlocked,'wheel should report the formation obstructing its arc');
  assert.ok(Math.abs(angle(model.formations[0].heading-Math.PI/2))>0.1);
  assert.ok(model.formations[0].maneuver,'blocked order should remain available to resume');
});

test('halting cancels a wheel and stops its decorative movement',()=>{
  const model=alone({strength:96});model.turn(1,Math.PI/2);advance(model,1);
  model.halt(1);const f=model.formations[0],pose={x:f.x,z:f.z,heading:f.heading};advance(model,3);
  assert.deepEqual({x:f.x,z:f.z,heading:f.heading},pose);assert.equal(f.maneuver,null);
  assert.ok(model.snapshot().soldiers.every(s=>!s.moving&&s.speed===0));
});

test('saving during a wheel preserves the maneuver, measured slot motion and cadence on resume',()=>{
  const first=alone({strength:96,composition:'mixed'});first.updateFormation(1,{turnAnchor:'right'});first.turn(1,1.4);advance(first,0.8);
  const data=first.exportScene(),second=new StudioModel();second.importScene(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(second.exportScene(),data);
  assert.deepEqual(second.snapshot({visualBudget:96}),first.snapshot({visualBudget:96}));
  for(let i=0;i<40;i++){first.step(0.05);second.step(0.05);}
  assert.deepEqual(second.exportScene(),first.exportScene());
});

test('older saved scenes receive safe march defaults without changing their layout',()=>{
  const original=alone({strength:96,heading:0.25}),data=original.exportScene(),layout=data.formations[0].layout;
  for(const f of data.formations)for(const key of ['turnAnchor','maneuver','motion','marchPhase','marchActive','marchStartTime'])delete f[key];
  const restored=new StudioModel();restored.importScene(data);const f=restored.formations[0];
  assert.equal(f.turnAnchor,'auto');assert.equal(f.maneuver,null);assert.ok(Number.isFinite(f.marchPhase));
  assert.deepEqual(f.layout,layout);near(f.heading,0.25);near(f.x,0);near(f.z,0);
  restored.step(0.05);assert.ok(restored.snapshot().soldiers.every(s=>!s.moving));
});


test('a legal wheel outside the click margin survives save and restore',()=>{
  const first=new StudioModel();first.formations=[];first.nextId=1;
  first.addFormation({x:64,z:0,strength:12,frontFiles:2,turnAnchor:'left'});
  first.turn(1,-Math.PI/2);for(let i=0;i<200;i++)first.step(.05);
  assert.ok(first.formations[0].x>65);
  const second=new StudioModel();second.importScene(first.exportScene());
  assert.deepEqual(second.exportScene(),first.exportScene());
});

test('reformation finishes before the wheel, including its final small adjustments',()=>{
  const model=new StudioModel();model.formations=[];model.nextId=1;
  model.addFormation({x:0,z:0,strength:96,frontFiles:12,speed:3,turnRate:3,turnAnchor:'left'});
  model.updateFormation(1,{spacing:1.2});model.turn(1,-Math.PI/2);
  for(let i=0;i<550;i++) {
    model.step(1/60);
    const f=model.formations[0],snapshot=model.snapshot({visualBudget:96});
    assert.ok(snapshot.soldiers.every(soldier=>soldier.speed<=3+1e-8));
    if(Math.abs(f.heading)>1e-8)assert.ok(Math.abs(f.layout[0].width-14.4)<1e-8);
  }
});

test('changing the march speed preserves the shared clock phase',()=>{
  const model=new StudioModel();model.formations=[];model.nextId=1;
  model.addFormation({x:0,z:20,strength:24,frontFiles:6,speed:1.5});model.order(1,{x:0,z:-20});
  for(let i=0;i<20;i++)model.step(.05);
  const phase=model.formations[0].marchPhase;
  model.updateFormation(1,{speed:3});assert.equal(model.formations[0].marchPhase,phase);
  model.step(.05);near(model.formations[0].marchPhase,(phase+.05*MARCH_CYCLES_PER_SECOND)%1,1e-10);
  near(model.formations[0].marchPhase,(model.time*MARCH_CYCLES_PER_SECOND)%1,1e-10);
});


const advanceExact=(model,seconds)=>{
  while(seconds>0.05+1e-9){model.step(.05);seconds-=.05;}
  if(seconds>1e-9)model.step(seconds);
};
const pose=f=>({x:f.x,z:f.z,heading:f.heading});
const nextContact=time=>{
  const cycle=time*MARCH_CYCLES_PER_SECOND,whole=Math.floor(cycle),phase=cycle-whole;
  const upcoming=MARCH_CONTACT_PHASES.find(contact=>contact>phase+1e-9);
  return (whole+(upcoming??1+MARCH_CONTACT_PHASES[0]))/MARCH_CYCLES_PER_SECOND;
};
const assertShared=model=>{
  const expected=(model.time*MARCH_CYCLES_PER_SECOND)%1,snapshot=model.snapshot({visualBudget:1000});
  for(const f of snapshot.formations){near(f.marchPhase,expected,1e-9);assert.equal(f.cadenceRate,MARCH_CYCLES_PER_SECOND);}
  for(const soldier of snapshot.soldiers)near(soldier.movementPhase,expected,1e-9);
};

test('idle formations follow the shared clock and wait for its next footfall',()=>{
  const model=alone({strength:12,frontFiles:3,speed:1.5}),f=model.formations[0];
  advanceExact(model,.43);assertShared(model);
  const start=pose(f);
  model.order(f.id,{x:f.x,z:f.z-30,heading:0});const deadline=nextMarchBeat(f.drumSignal.endProgress/MARCH_CYCLES_PER_SECOND);
  near(f.marchStartTime,deadline);assert.equal(f.marchActive,false);
  advanceExact(model,deadline-model.time-.005);
  assert.deepEqual(pose(f),start);assert.ok(model.snapshot().soldiers.every(s=>!s.moving));assertShared(model);
  model.step(.025);assert.equal(f.marchActive,true);near(f.marchStartTime,deadline);assert.ok(f.z<start.z);assertShared(model);
});

test('staggered orders at different travel speeds join the same march beat',()=>{
  const model=new StudioModel();model.formations=[];model.nextId=1;
  for(const [x,speed] of [[-20,.5],[0,1.5],[20,3]])model.addFormation({x,z:20,strength:12,frontFiles:3,speed});
  model.order(1,{x:-20,z:-25,heading:0});advanceExact(model,2);
  assert.equal(model.formations[0].marchActive,true);
  model.order(2,{x:0,z:-25,heading:0});advanceExact(model,.2);
  model.order(3,{x:20,z:-25,heading:0});
  const late=model.formations.slice(1),deadline=nextMarchBeat(late[0].drumSignal.endProgress/MARCH_CYCLES_PER_SECOND),starts=late.map(pose);
  for(const f of late){near(f.marchStartTime,deadline);assert.equal(f.marchActive,false);}
  advanceExact(model,deadline-model.time-.005);
  late.forEach((f,index)=>assert.deepEqual(pose(f),starts[index]));assertShared(model);
  model.step(.025);assert.ok(model.formations.every(f=>f.marchActive));assertShared(model);
  const positions=model.formations.map(f=>f.z);advanceExact(model,.5);
  model.formations.forEach((f,index)=>near(positions[index]-f.z,[.25,.75,1.5][index],1e-8));assertShared(model);
});

test('hold and restart rejoin a future shared contact without resetting the clock',()=>{
  const model=alone({strength:12,frontFiles:3}),f=model.formations[0];model.order(1,{x:0,z:-30,heading:0});advanceExact(model,2);
  assert.equal(f.marchActive,true);model.halt(1);assert.equal(f.marchActive,false);assert.equal(f.marchStartTime,null);
  const start=pose(f);advanceExact(model,.14);assert.deepEqual(pose(f),start);assertShared(model);
  model.order(1,{x:0,z:-30,heading:0});const deadline=nextMarchBeat(f.drumSignal.endProgress/MARCH_CYCLES_PER_SECOND);near(f.marchStartTime,deadline);
  advanceExact(model,deadline-model.time-.005);assert.deepEqual(pose(f),start);
  model.step(.025);assert.ok(f.z<start.z);assertShared(model);
});

test('saving before the shared start preserves its deadline and old scenes join the same clock',()=>{
  const first=alone({strength:12,frontFiles:3});advanceExact(first,.43);first.order(1,{x:0,z:-30,heading:0});
  const data=first.exportScene(),second=new StudioModel();second.importScene(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(second.exportScene(),data);assert.equal(second.formations[0].marchActive,false);
  near(second.formations[0].marchStartTime,nextMarchBeat(first.formations[0].drumSignal.endProgress/MARCH_CYCLES_PER_SECOND));
  for(let i=0;i<20;i++){first.step(.05);second.step(.05);}
  assert.deepEqual(second.exportScene(),first.exportScene());assertShared(second);
  const legacy=JSON.parse(JSON.stringify(data));
  for(const f of legacy.formations)for(const key of ['marchPhase','marchActive','marchStartTime','drumSignal','nextDrumSignalId'])delete f[key];
  const restored=new StudioModel();restored.importScene(legacy);const start=pose(restored.formations[0]);assertShared(restored);
  const deadline=nextContact(restored.time);advanceExact(restored,deadline-restored.time-.005);
  assert.deepEqual(pose(restored.formations[0]),start);restored.step(.025);
  assert.ok(restored.formations[0].z<start.z);assertShared(restored);
});
