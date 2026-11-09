// The Sprite Studio pike geometry is kept locally for library builds.
import {readFileSync} from 'node:fs';
import {pikeGeometry} from './pike.mjs';
const records = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(records.map(({key,pike})=>({key,polygons:pikeGeometry(pike,{x:0,y:0,scale:1})}))));
