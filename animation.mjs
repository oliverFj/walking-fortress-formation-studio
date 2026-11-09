const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, period) => ((value % period) + period) % period;

export function clipKind(name, clip) {
  if (clip.kind === 'idle' || clip.kind === 'walk') return clip.kind;
  if (/^(idle|stand)(?:$|[_ .-])/i.test(name)) return 'idle';
  if (/^(walk|march)(?:$|[_ .-])/i.test(name)) return 'walk';
  return null;
}

export function animationClips(data, kind) {
  return Object.entries(data.clips || {}).filter(([name, clip]) =>
    clip && clipKind(name, clip) === kind && Number.isFinite(clip.duration) && clip.duration > 0 &&
    Array.isArray(clip.directions) && clip.directions.length && clip.directions.every(frames => Array.isArray(frames) && frames.length));
}

// A stable seed comes from the decorative slot, so changing drawing density does
// not assign new variants or cycle offsets to a soldier that remains visible.
export function soldierAnimation(data, soldier, time = 0) {
  const kind = soldier.moving ? 'walk' : 'idle';
  let clips = animationClips(data, kind);
  if (!clips.length) return null;
  const speed = Number.isFinite(soldier.speed) ? Math.max(0, soldier.speed) : data.walkReferenceSpeed > 0 ? data.walkReferenceSpeed : 2.1;
  if (kind === 'walk') {
    const calibrated = clips.filter(([, clip]) => Number.isFinite(clip.nominalSpeed) && clip.nominalSpeed > 0);
    if (calibrated.length) {
      const closest = calibrated.reduce((best, [, clip]) => Math.abs(clip.nominalSpeed - speed) < Math.abs(best - speed) ? clip.nominalSpeed : best, calibrated[0][1].nominalSpeed);
      clips = calibrated.filter(([, clip]) => clip.nominalSpeed === closest);
    }
  }
  const phase = Number.isFinite(soldier.phase) ? mod(soldier.phase, 1) : 0;
  const seed = Number.isFinite(soldier.animationSeed) ? mod(soldier.animationSeed, 1) : mod(phase * 2.61803398875, 1);
  const [name, clip] = clips[Math.min(clips.length - 1, Math.floor(seed * clips.length))];
  const variation = 0.9 + mod(seed * 7.38196601125 + phase, 1) * 0.2;
  const referenceClip = clips[0][1];
  const reference = referenceClip.nominalSpeed > 0 ? referenceClip.nominalSpeed : referenceClip.referenceSpeed > 0 ? referenceClip.referenceSpeed : data.walkReferenceSpeed > 0 ? data.walkReferenceSpeed : 2.1;
  const playbackSpeed = Number.isFinite(soldier.cadenceSpeed) ? Math.max(0,soldier.cadenceSpeed) : Number.isFinite(soldier.speed) ? speed : reference;
  // Marchers share a cadence, even when variants have different durations.
  // A fixed ±4% cycle offset keeps slight variation without drifting apart.
  const rate = kind === 'walk' ? Number.isFinite(soldier.cadenceRate) && soldier.cadenceRate > 0 ? soldier.cadenceRate * clip.duration : clamp(playbackSpeed / reference, 0.15, 5) * clip.duration / referenceClip.duration : variation;
  const offset = kind === 'walk' ? (phase - 0.5) * 0.08 : phase;
  const sharedPhase = kind === 'walk' && Number.isFinite(soldier.movementPhase) ? soldier.movementPhase : (Number.isFinite(time) ? time : 0) * rate / clip.duration;
  return {name, clip, rate, phase: mod(sharedPhase + offset, 1)};
}
