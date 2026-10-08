/** One world-space sun for terrain and actor-space normal maps.
 * Heading/azimuth 0 points toward -Z; 90 degrees points toward +X.
 * Blender actor axes X,Y,Z map to terrain axes X,Z,Y before heading rotation.
 */
const DEG = Math.PI / 180;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
export const DEFAULT_LIGHTING = Object.freeze({
  enabled: true, azimuth: 315, elevation: 45, strength: 0.85,
  threshold: 0.52, softness: 0, inkColor: '#29271f',
  style: 'hatch', hatchSpacing: 0.12, hatchWidth: 0.018,
  hatchAngle: 45, crossStart: 0.22,
});
export function normalizeLighting(options = {}) {
  const v = options && typeof options === 'object' ? options : {};
  return {
    enabled: v.enabled !== false,
    style: v.style === 'solid' ? 'solid' : 'hatch',
    hatchSpacing: clamp(finite(v.hatchSpacing, DEFAULT_LIGHTING.hatchSpacing), 0.005, 0.5),
    hatchWidth: clamp(finite(v.hatchWidth, DEFAULT_LIGHTING.hatchWidth), 0.0005, 0.055),
    hatchAngle: clamp(finite(v.hatchAngle, DEFAULT_LIGHTING.hatchAngle), 0, 180),
    crossStart: clamp(finite(v.crossStart, DEFAULT_LIGHTING.crossStart), 0.05, 0.9),
    azimuth: ((finite(v.azimuth, DEFAULT_LIGHTING.azimuth) % 360) + 360) % 360,
    elevation: clamp(finite(v.elevation, DEFAULT_LIGHTING.elevation), 0, 90),
    strength: clamp(finite(v.strength, DEFAULT_LIGHTING.strength), 0, 1),
    threshold: clamp(finite(v.threshold, DEFAULT_LIGHTING.threshold), 0, 1),
    softness: clamp(finite(v.softness, DEFAULT_LIGHTING.softness), 0, 0.5),
    inkColor: typeof v.inkColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.inkColor)
      ? v.inkColor : DEFAULT_LIGHTING.inkColor,
  };
}
export function lightDirection(options = DEFAULT_LIGHTING) {
  const {azimuth, elevation} = normalizeLighting(options);
  const azimuthRadians = azimuth * DEG, elevationRadians = elevation * DEG;
  const horizontal = Math.cos(elevationRadians);
  return [Math.sin(azimuthRadians) * horizontal, Math.sin(elevationRadians),
    -Math.cos(azimuthRadians) * horizontal];
}
export function actorNormalToWorld(blenderNormal, heading = 0) {
  const [x, z, y] = blenderNormal;
  const c = Math.cos(heading), s = Math.sin(heading);
  const normal = [x * c - z * s, y, x * s + z * c];
  const length = Math.hypot(...normal);
  return length > 1e-8 ? normal.map(value => value / length) : [0, 1, 0];
}
/** Reference hard/soft shadow mask before solid fill or hatch strokes are applied.
 * Style does not change the world sun or this mask; hatching controls coverage.
 */
export function inkShadowAmount(worldNormal, lighting = DEFAULT_LIGHTING) {
  const options = normalizeLighting(lighting);
  if (!options.enabled) return 0;
  const sun = lightDirection(options), length = Math.hypot(...worldNormal);
  if (length < 1e-8) return 0;
  const brightness = clamp(0.5 + 0.5 * worldNormal.reduce((sum, value, i) =>
    sum + value * sun[i] / length, 0), 0, 1);
  let mask;
  if (options.softness <= 0.00001) mask = brightness < options.threshold ? 1 : 0;
  else {
    const lo = options.threshold - options.softness, hi = options.threshold + options.softness;
    const t = clamp((brightness - lo) / (hi - lo), 0, 1);
    mask = 1 - t * t * (3 - 2 * t);
  }
  return mask * options.strength;
}
