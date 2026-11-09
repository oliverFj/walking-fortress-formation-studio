/** Live pike styling; independent of exported frames and simulation state. */
export const DEFAULT_PIKE_APPEARANCE = Object.freeze({darkness:0,opacity:1,widthScale:1});
const bounded = (value, minimum, maximum, fallback) => Number.isFinite(value)
  ? Math.max(minimum,Math.min(maximum,value)) : fallback;

export function normalizePikeAppearance(raw) {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    darkness:bounded(data.darkness,0,1,DEFAULT_PIKE_APPEARANCE.darkness),
    opacity:bounded(data.opacity,0,2,DEFAULT_PIKE_APPEARANCE.opacity),
    widthScale:bounded(data.widthScale,.5,3,DEFAULT_PIKE_APPEARANCE.widthScale),
  };
}

/** Keep each end's midpoint fixed, preserving the pike axis, length and grip. */
export function scalePikeCorners(corners,widthScale=1) {
  const scale=normalizePikeAppearance({widthScale}).widthScale;
  const centers=[
    [(corners[0][0]+corners[1][0])*.5,(corners[0][1]+corners[1][1])*.5],
    [(corners[2][0]+corners[3][0])*.5,(corners[2][1]+corners[3][1])*.5],
  ];
  return corners.map((point,index)=> {
    const center=centers[index<2 ? 0 : 1];
    return point.map((value,axis)=>center[axis]+(value-center[axis])*scale);
  });
}
