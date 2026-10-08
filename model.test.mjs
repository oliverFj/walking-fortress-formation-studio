import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioModel} from './model.mjs';
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
  assert.equal(model.formations[0].status,'Vender');assert.ok(model.snapshot().soldiers.every(s=>s.moving));
  model.formations[0].target.heading=model.formations[0].heading;model.updateFormation(1,{frontFiles:14});model.step(0.05);
  assert.equal(model.formations[0].status,'Omformer');assert.ok(model.snapshot().soldiers.every(s=>s.moving));
});