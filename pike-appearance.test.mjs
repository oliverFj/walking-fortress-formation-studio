import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PIKE_APPEARANCE,normalizePikeAppearance,scalePikeCorners} from './pike-appearance.mjs';

test('missing or invalid pike settings preserve exported appearance',()=>{
  for (const raw of [undefined,null,42,[],{darkness:NaN,opacity:'2',widthScale:Infinity}]) {
    assert.deepEqual(normalizePikeAppearance(raw),DEFAULT_PIKE_APPEARANCE);
  }
  assert.deepEqual(normalizePikeAppearance({darkness:9,opacity:-2,widthScale:10}),{darkness:1,opacity:0,widthScale:3});
  const custom={darkness:.6,opacity:1.5,widthScale:2};
  assert.deepEqual(normalizePikeAppearance(JSON.parse(JSON.stringify(custom))),custom);
});

test('pike width changes preserve its inclined axis, endpoints and original frame',()=>{
  const corners=[[1,8],[3,10],[12,1],[10,-1]];
  const before=structuredClone(corners);
  const scaled=scalePikeCorners(corners,2);
  assert.deepEqual(scaled,[[0,7],[4,11],[13,2],[9,-2]]);
  const ends=value=>[[0,1],[2,3]].map(([a,b])=>value[a].map((v,i)=>(v+value[b][i])*.5));
  assert.deepEqual(ends(scaled),ends(corners));
  assert.deepEqual(corners,before);
  assert.deepEqual(scalePikeCorners(corners),corners);
});
