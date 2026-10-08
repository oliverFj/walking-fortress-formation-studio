import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LIGHTING,normalizeLighting,lightDirection,actorNormalToWorld,inkShadowAmount} from './lighting.mjs';
const close = (actual,expected) => actual.forEach((v,i) => assert.ok(Math.abs(v-expected[i]) < 1e-7,`${actual} != ${expected}`));
test('the common sun is a unit world vector with terrain heading convention', () => {
  close(lightDirection({azimuth:0,elevation:0}),[0,0,-1]);
  close(lightDirection({azimuth:90,elevation:0}),[1,0,0]);
  close(lightDirection({azimuth:285,elevation:90}),[0,1,0]);
  assert.ok(Math.abs(Math.hypot(...lightDirection({azimuth:317,elevation:51}))-1)<1e-8);
});
test('Blender actor axes map to the terrain and rotate with soldier heading', () => {
  close(actorNormalToWorld([0,-1,0],0),[0,0,-1]);
  close(actorNormalToWorld([0,-1,0],Math.PI/2),[1,0,0]);
  close(actorNormalToWorld([1,0,0],Math.PI/2),[0,0,1]);
  close(actorNormalToWorld([0,0,1],Math.PI),[0,1,0]);
});
test('turning a soldier changes its lit side under one fixed landscape sun', () => {
  const sun={azimuth:0,elevation:0,strength:1,threshold:0.5,softness:0};
  assert.equal(inkShadowAmount(actorNormalToWorld([0,-1,0],0),sun),0);
  assert.equal(inkShadowAmount(actorNormalToWorld([0,-1,0],Math.PI),sun),1);
  const landscapeSun=lightDirection(sun);
  for (const cameraYaw of [0,0.7,2.2,5.3]) {
    const actorHeading=0.43;
    const differentSpriteDirection=cameraYaw-actorHeading;
    assert.ok(Number.isFinite(differentSpriteDirection));
    close(lightDirection(sun),landscapeSun);
    assert.equal(inkShadowAmount(actorNormalToWorld([0,-1,0],actorHeading),sun),0);
  }
});
test('zero softness has only two constant ink strengths', () => {
  const lighting={azimuth:20,elevation:45,strength:0.8,threshold:0.55,softness:0};
  const amounts=new Set();
  for (let angle=0;angle<Math.PI*2;angle+=0.01) amounts.add(inkShadowAmount([Math.sin(angle),0,Math.cos(angle)],lighting));
  assert.deepEqual([...amounts].sort(),[0,0.8]);
  assert.equal(inkShadowAmount([0,0,0],lighting),0);
  assert.equal(inkShadowAmount([0,0,-1],{...lighting,enabled:false}),0);
});
test('invalid saved settings normalize to finite bounded values', () => {
  const lighting=normalizeLighting({azimuth:Infinity,elevation:900,strength:-2,threshold:5,softness:-1,inkColor:'red'});
  assert.equal(lighting.azimuth,315);assert.equal(lighting.elevation,90);
  assert.equal(lighting.strength,0);assert.equal(lighting.threshold,1);assert.equal(lighting.softness,0);
  assert.equal(lighting.inkColor,'#29271f');
});

test('old saved lighting adopts hatching while explicitly chosen solid fill survives a round trip', () => {
  const oldSaved={enabled:false,azimuth:217,elevation:34,strength:0.62,threshold:0.43,softness:0.04,inkColor:'#343126'};
  const migrated=normalizeLighting(JSON.parse(JSON.stringify(oldSaved)));
  assert.equal(migrated.style,'hatch');
  for (const [key,value] of Object.entries(oldSaved)) assert.equal(migrated[key],value);
  const chosen={...migrated,enabled:true,style:'solid',hatchSpacing:0.27,hatchWidth:0.021,hatchAngle:62,crossStart:0.48};
  assert.deepEqual(normalizeLighting(JSON.parse(JSON.stringify(chosen))),chosen);
  assert.deepEqual(normalizeLighting(normalizeLighting(chosen)),chosen);
});
test('malformed nullable hatch settings yield renderable finite settings', () => {
  for (const raw of [null,undefined,[],false,42,'hatch',
    {style:null,hatchSpacing:null,hatchWidth:'0.02',hatchAngle:NaN,crossStart:Infinity}]) {
    const normalized=normalizeLighting(raw);
    for (const key of ['hatchSpacing','hatchWidth','hatchAngle','crossStart']) {
      assert.equal(normalized[key],DEFAULT_LIGHTING[key]);
      assert.ok(Number.isFinite(normalized[key]));
    }
    assert.equal(normalized.style,'hatch');
  }
  const extremes=normalizeLighting({style:'cross',hatchSpacing:9,hatchWidth:-4,hatchAngle:900,crossStart:-1});
  assert.equal(extremes.style,'hatch');
  assert.equal(extremes.hatchSpacing,0.5);assert.equal(extremes.hatchWidth,0.0005);
  assert.equal(extremes.hatchAngle,180);assert.equal(extremes.crossStart,0.05);
});
test('changing stroke treatment preserves landscape light and the calibrated shadow mask', () => {
  const lighting={azimuth:132,elevation:29,threshold:0.56,softness:0.08,strength:0.77};
  const solid={...lighting,style:'solid'};
  const hatch={...lighting,style:'hatch',hatchSpacing:0.09,hatchWidth:0.011,hatchAngle:138,crossStart:0.24};
  close(lightDirection(solid),lightDirection(hatch));
  for (let angle=0;angle<Math.PI*2;angle+=0.07) {
    const normal=actorNormalToWorld([Math.cos(angle),Math.sin(angle),0.4],angle/2);
    assert.equal(inkShadowAmount(normal,solid),inkShadowAmount(normal,hatch));
  }
  assert.equal(inkShadowAmount([1,0,0],{...hatch,enabled:false}),0);
});
