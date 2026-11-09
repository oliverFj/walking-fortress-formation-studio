import test from 'node:test';
import assert from 'node:assert/strict';
import {animationClips,soldierAnimation} from './animation.mjs';

const clip=(kind,duration=2)=>({kind,duration,directions:[[{},{}],[{},{}]]});
const data={clips:{rest_a:clip('idle'),rest_b:clip('idle',3),march_a:clip('walk'),march_b:clip('walk',1.8),fire:clip('fire')}};

test('different slots use every idle and walking variant with stable choices',()=>{
  for (const moving of [false,true]) {
    const soldiers=Array.from({length:60},(_,index)=>({moving,animationSeed:index/60,phase:(index*0.37)%1,speed:2.1}));
    const selected=soldiers.map(soldier=>soldierAnimation(data,soldier,3));
    assert.equal(new Set(selected.map(animation=>animation.name)).size,2);
    if (moving) assert.ok(selected.every(animation=>Math.abs(animation.rate/animation.clip.duration-selected[0].rate/selected[0].clip.duration)<1e-12));
    else assert.ok(new Set(selected.map(animation=>animation.rate)).size>10);
    soldiers.forEach((soldier,index)=>{
      const later=soldierAnimation(data,soldier,5);
      assert.equal(later.name,selected[index].name);
      assert.equal(later.rate,selected[index].rate);
      assert.deepEqual(soldierAnimation(data,soldier,3),selected[index]);
      assert.ok(later.phase>=0&&later.phase<1);
    });
    assert.ok(selected.every(animation=>animation.name!=='fire'));
  }
});

test('walking pace follows formation speed while idle pace stays independent',()=>{
  const soldier={moving:true,speed:1.05,phase:0.12,animationSeed:0.83};
  const slow=soldierAnimation(data,soldier,4),fast=soldierAnimation(data,{...soldier,speed:2.1},4);
  assert.equal(fast.name,slow.name);
  assert.equal(fast.rate,slow.rate*2);
  assert.equal(soldierAnimation(data,{...soldier,moving:false,speed:1},4).rate,soldierAnimation(data,{...soldier,moving:false,speed:7},4).rate);
  const calibrated={clips:{idle:clip('idle'),walk:{...clip('walk'),referenceSpeed:1}}};
  assert.equal(soldierAnimation(calibrated,{moving:true,speed:1},0).rate,1);
});

test('legacy character clips and phase-only soldiers remain supported',()=>{
  const legacy={clips:{idle:{duration:2.5,directions:[[{}]]},walk:{duration:2,directions:[[{}]]}}};
  assert.equal(animationClips(legacy,'idle').length,1);
  assert.equal(soldierAnimation(legacy,{moving:false,phase:0.4},0).name,'idle');
  const walking=soldierAnimation(legacy,{moving:true,phase:0.4},0);
  assert.equal(walking.name,'walk');
  assert.ok(Math.abs(walking.phase-0.992)<1e-12);
  assert.ok(Number.isFinite(walking.rate));
  assert.equal(soldierAnimation({clips:{}},{moving:true}),null);
});

test('the nearest recorded walking or running speed provides the variants',()=>{
  const speeds={clips:{idle:clip('idle'),slow:{...clip('walk'),nominalSpeed:0.5},walk_a:{...clip('walk'),nominalSpeed:1.5},walk_b:{...clip('walk'),nominalSpeed:1.5},run:{...clip('walk'),gait:'run',nominalSpeed:3}}};
  for (const [speed,names] of [[0.5,['slow']],[1.5,['walk_a','walk_b']],[2.1,['walk_a','walk_b']],[3,['run']]]) {
    const selected=Array.from({length:40},(_,index)=>soldierAnimation(speeds,{moving:true,speed,animationSeed:index/40},2));
    assert.deepEqual([...new Set(selected.map(animation=>animation.name))].sort(),names);
    assert.ok(selected.every(animation=>animation.rate===speed/animation.clip.nominalSpeed));
  }
});

test('marchers retain a small cycle offset without drifting over time',()=>{
  const soldiers=Array.from({length:60},(_,index)=>({moving:true,speed:2.1,animationSeed:index/60,phase:index/60}));
  const delta=(a,b)=>((a-b+1.5)%1)-0.5;
  for (const time of [0,3,100,600]) {
    const selected=soldiers.map(soldier=>soldierAnimation(data,soldier,time));
    const sharedPhase=(time/data.clips.march_a.duration)%1;
    selected.forEach((animation,index)=>{
      const expectedOffset=(soldiers[index].phase-0.5)*0.08;
      assert.ok(Math.abs(delta(animation.phase,sharedPhase)-expectedOffset)<1e-10);
      assert.ok(Math.abs(delta(animation.phase,sharedPhase))<=0.04+1e-10);
    });
  }
});

test('actual slot speed selects gait while integrated formation phase keeps slow and running files in step',()=>{
  const speeds={clips:{idle:clip('idle'),slow:{...clip('walk'),nominalSpeed:0.5},walk:{...clip('walk'),nominalSpeed:1.5},run:{...clip('walk'),nominalSpeed:3}}};
  for (const movementPhase of [0.01,0.48,0.99]) {
    const selected=[0.4,1.5,2.8].map(speed=>soldierAnimation(speeds,{moving:true,speed,cadenceSpeed:1.5,movementPhase,phase:0.7},600));
    assert.deepEqual(selected.map(animation=>animation.name),['slow','walk','run']);
    assert.ok(selected.every(animation=>Math.abs(animation.phase-selected[0].phase)<1e-12));
    assert.equal(soldierAnimation(speeds,{moving:true,speed:2.8,cadenceSpeed:3,movementPhase,phase:0.7},999).phase,selected[0].phase);
  }
});


test('the global cadence controls every gait duration while each slot retains its small phase offset',()=>{
  const speeds={clips:{idle:clip('idle'),slow:{...clip('walk',2.4),nominalSpeed:.5},walk_a:{...clip('walk',2),nominalSpeed:1.5},walk_b:{...clip('walk',1.8),nominalSpeed:1.5},run:{...clip('walk',1.2),nominalSpeed:3}}};
  const wrap=value=>((value%1)+1)%1;
  for(const speed of [.4,1.5,2.8])for(const phase of [0,.5,.999])for(const seed of [.05,.75]){
    const soldier={moving:true,speed,cadenceSpeed:speed,cadenceRate:.7,movementPhase:.92,phase,animationSeed:seed};
    const animation=soldierAnimation(speeds,soldier,600),later=soldierAnimation(speeds,soldier,999);
    assert.ok(Math.abs(animation.rate-animation.clip.duration*.7)<1e-12);
    assert.ok(Math.abs(animation.phase-wrap(.92+(phase-.5)*.08))<1e-12);
    assert.equal(later.phase,animation.phase);assert.equal(later.rate,animation.rate);
  }
});
