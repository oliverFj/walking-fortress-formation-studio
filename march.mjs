const TAU = 2 * Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const normalizeAngle = value => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const MAX_WHEEL_SPEED = 3;

export function worldPoint(pose, x, z) {
  const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  return [pose.x + x * c - z * s, pose.z + x * s + z * c];
}

export function turnAnchor(formation, delta, mode = formation.turnAnchor) {
  if (mode === 'center' || !formation.layout.length) return {x:0,z:0};
  const left = mode === 'left' || (mode !== 'right' && delta < 0);
  return {
    x: left ? Math.min(...formation.layout.map(field => field.x - field.width / 2)) : Math.max(...formation.layout.map(field => field.x + field.width / 2)),
    z: Math.min(...formation.layout.map(field => field.z - field.depth / 2)),
  };
}

export function wheelPose(formation, anchor, heading) {
  const [px,pz] = worldPoint(formation, anchor.x, anchor.z);
  const [rx,rz] = worldPoint({x:0,z:0,heading}, anchor.x, anchor.z);
  return {x:px-rx,z:pz-rz,heading:normalizeAngle(heading)};
}

export function wheelRadius(formation, anchor) {
  let radius = 0;
  for (const field of formation.layout) for (const sx of [-1,1]) for (const sz of [-1,1]) {
    radius = Math.max(radius, Math.hypot(field.x + sx * field.width / 2 - anchor.x, field.z + sz * field.depth / 2 - anchor.z));
  }
  return radius;
}

export function wheelStep(formation, maneuver, dt) {
  const delta = normalizeAngle(maneuver.heading - formation.heading);
  const radius = wheelRadius(formation, maneuver.anchor);
  const rate = Math.min(formation.turnRate, MAX_WHEEL_SPEED / Math.max(radius,0.01));
  return wheelPose(formation, maneuver.anchor, formation.heading + clamp(delta, -rate * dt, rate * dt));
}

// Solve a straight departure after a fixed-pivot wheel: the destination lies
// ahead of the rotated center, on its forward axis. Nearby targets may require
// a center pivot when the requested flank cannot produce a forward tangent.
export function departure(formation, target) {
  const bearing = Math.atan2(target.x-formation.x, -(target.z-formation.z));
  let anchor = turnAnchor(formation, normalizeAngle(bearing-formation.heading));
  if (Math.hypot(target.x-formation.x,target.z-formation.z) < Math.hypot(anchor.x,anchor.z)+1) return {heading:bearing,anchor:{x:0,z:0}};
  const [px,pz] = worldPoint(formation, anchor.x, anchor.z);
  const qx=target.x-px, qz=target.z-pz, distance=Math.hypot(qx,qz);
  let candidates=[];
  if (distance > Math.abs(anchor.x) + 1e-8) {
    const base=Math.atan2(qz,qx), offset=Math.acos(clamp(-anchor.x/distance,-1,1));
    candidates=[base+offset,base-offset].map(normalizeAngle).filter(heading => -qx*Math.sin(heading)+qz*Math.cos(heading)+anchor.z < -0.08);
  }
  if (!candidates.length) {anchor={x:0,z:0};return {heading:bearing,anchor};}
  candidates.sort((a,b)=>Math.abs(normalizeAngle(a-formation.heading))-Math.abs(normalizeAngle(b-formation.heading)));
  return {heading:candidates[0],anchor};
}

export function cadenceReference(speed) {
  return [0.5,1.5,3].reduce((best,value)=>Math.abs(value-speed)<Math.abs(best-speed)?value:best,0.5);
}

export function advanceMarchPhase(phase, speed, dt) {
  return (phase + dt * clamp(speed/cadenceReference(speed),0.15,5)/2) % 1;
}
// One landscape-wide clock; preserve the former default 2.1 m/s march tempo.
export const MARCH_CYCLES_PER_SECOND = 0.7;
export const MARCH_CONTACT_PHASES = Object.freeze([6/48,30/48]);
export const marchPhaseAt = time => ((time * MARCH_CYCLES_PER_SECOND % 1) + 1) % 1;
export function nextMarchBeat(time) {
  const progress=time*MARCH_CYCLES_PER_SECOND,first=MARCH_CONTACT_PHASES[0];
  const beat=Math.floor((progress-first)/0.5+1e-9)+1;
  return (first+beat*0.5)/MARCH_CYCLES_PER_SECOND;
}
