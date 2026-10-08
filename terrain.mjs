const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
export const terrainNames = Object.freeze(['flat','slope','ridge','passage']);
export const terrainBounds = Object.freeze({minX:-70,maxX:70,minZ:-70,maxZ:70});
export const passageBounds = Object.freeze({minX:-4,maxX:4,minZ:-10,maxZ:10});
export function heightAt(name, x, z) {
  if (name === 'slope') return 0.07*x + 0.018*z;
  if (name === 'ridge') return 5*Math.exp(-Math.pow((z+5)/12,2))*(0.86+0.14*Math.cos(x/24));
  if (name === 'passage') return 5*smooth(4,15,Math.abs(x))*(1-smooth(10,21,Math.abs(z)));
  return 0;
}
const rectangle = (x0,z0,x1,z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
export function terrainObstacles(name) {
  return name === 'passage' ? [rectangle(-70,-10,-4,10),rectangle(4,-10,70,10)] : [];
}
// Separating axes work for the convex field rectangles and passage obstacles.
export function polygonsOverlap(a,b,padding=0) {
  for (const poly of [a,b]) for (let i=0;i<poly.length;i++) {
    const p=poly[i],q=poly[(i+1)%poly.length],dx=q[0]-p[0],dz=q[1]-p[1];
    const len=Math.hypot(dx,dz); if (len<1e-10) continue;
    const nx=-dz/len,nz=dx/len;
    let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
    for (const v of a) {const d=v[0]*nx+v[1]*nz;amin=Math.min(amin,d);amax=Math.max(amax,d);}
    for (const v of b) {const d=v[0]*nx+v[1]*nz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
    if (amax+padding<=bmin || bmax+padding<=amin) return false;
  }
  return true;
}
export function terrainContainsFootprint(name, polygons) {
  for (const polygon of polygons) {
    for (const [x,z] of polygon) if (!Number.isFinite(x)||!Number.isFinite(z)||x<terrainBounds.minX||x>terrainBounds.maxX||z<terrainBounds.minZ||z>terrainBounds.maxZ) return false;
    for (const obstacle of terrainObstacles(name)) if (polygonsOverlap(polygon,obstacle)) return false;
  }
  return true;
}
