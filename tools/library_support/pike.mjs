// Stored weapons use a fixed working field; drawing/export resolve them to body-local pixels.
import {emptyEdit, placement, sourcePoint, paintOperation} from './core.mjs';
const names = ['grip', 'butt', 'tip'];
const defaults = {enabled: true, width: 3, layer: 'front', ink: '#30251b', paper: '#e8d7ad'};
export const placedPoint = (p, t) => [t.x + p[0] * t.scale, t.y + p[1] * t.scale];
function styledPike(pike) {
  const result = {...defaults, ...structuredClone(pike)};
  result.stroke_width ??= result.width / 4;
  const length = Math.hypot(result.tip[0] - result.butt[0], result.tip[1] - result.butt[1]);
  result.head_length ??= Math.min(result.width * 7, length * .12);
  result.head_width ??= result.width * 3.5;
  result.head_stroke_width ??= result.stroke_width;
  return result;
}
function mapPike(pike, transform, toStage) {
  const result = styledPike(pike);
  for (const name of names) result[name] = toStage ? placedPoint(pike[name], transform) : sourcePoint(pike[name], transform);
  const ratio = toStage ? transform.scale : 1 / transform.scale;
  for (const key of ['width', 'stroke_width', 'head_length', 'head_width', 'head_stroke_width']) result[key] *= ratio;
  if (result.operations) for (const op of result.operations) {
    op.width *= ratio;
    op.points = op.points.map(point => toStage ? placedPoint(point, transform) : sourcePoint(point, transform));
  }
  if (toStage) result.space = 'stage'; else delete result.space;
  return result;
}
function validPikeOperations(operations) {
  return Array.isArray(operations) && operations.length <= 10000 &&
    operations.reduce((count, op) => count + (op.points?.length || 0), 0) <= 1000000 &&
    operations.every(op => ['pen', 'cover', 'erase'].includes(op.tool) && /^#[a-fA-F0-9]{6}$/.test(op.color) &&
      Number.isFinite(op.width) && op.width > 0 && op.width <= 1000 && Array.isArray(op.points) && op.points.length &&
      op.points.every(point => Array.isArray(point) && point.length === 2 && point.every(v => Number.isFinite(v) && Math.abs(v) <= 100000)));
}
export function stagePike(pike, transform, {validate = true} = {}) {
  if (!pike) return null;
  const result = mapPike(pike, transform, true);
  if (!validate) return result;
  if (!(result.width > 0 && result.width <= 1000) || !Number.isFinite(result.width) ||
      !(result.stroke_width >= 0 && result.stroke_width <= 1000) || !Number.isFinite(result.stroke_width) ||
      !['head_length', 'head_width', 'head_stroke_width'].every(key => Number.isFinite(result[key]) && result[key] >= 0 && result[key] <= 1000) ||
      !names.every(name => result[name].every(value => Number.isFinite(value) && Math.abs(value) <= 100000)) ||
      (result.operations && !validPikeOperations(result.operations)))
    throw new Error('Pikens punkter og tykkelser ligger uden for arbejdsfeltets grænser.');
  return result;
}
export function localPike(pike, transform) {
  return pike ? mapPike(pike, transform, false) : null;
}

export function defaultPike(frame) {
  const {w, h} = frame.rect, p = frame.pivot_pixels || [w / 2, h * .8];
  const grip = [p[0] + w * .12, p[1] - h * .45];
  return {...defaults, width: w * .006, grip,
    butt: [grip[0] - w * .1, grip[1] + h * .38],
    tip: [grip[0] + w * .38, grip[1] - h * 1.48]};
}
export function pikeFor(info, edit = emptyEdit(), corrections = true, transformOverride = null) {
  const to = transformOverride || placement(info.frame, info.aligned, edit, corrections);
  if (corrections && Object.hasOwn(edit, 'pike')) {
    if (edit.pike == null) return null;
    // Legacy manual points are local to the saved body placement. Resolve without
    // rewriting them; the next edit stores their visible position in the fixed field.
    const fixed = edit.pike.space === 'stage' ? structuredClone(edit.pike) :
      mapPike(edit.pike, placement(info.frame, info.aligned, edit), true);
    // Older manual edits may already have a thick shaft. Seed the missing head
    // dimensions from the unedited render instead of turning it into a huge head.
    const original = info.sourceFrame?.attachments?.pike;
    const baseline = original ? mapPike(original, placement(info.sourceFrame, null, emptyEdit()), true) :
      mapPike(defaultPike(info.frame), placement(info.frame, info.aligned, emptyEdit()), true);
    for (const key of ['head_length', 'head_width', 'head_stroke_width'])
      if (!Object.hasOwn(edit.pike, key)) fixed[key] = baseline[key];
    return localPike(fixed, to);
  }
  const original = info.sourceFrame?.attachments?.pike;
  if (!original) return null;
  const from = placement(info.sourceFrame, null, emptyEdit());
  return localPike(mapPike(original, from, true), to);
}
export function movePikePoint(pike, name, point) {
  const changed = structuredClone(pike);
  if (name === 'grip') {
    const delta = [point[0] - changed.grip[0], point[1] - changed.grip[1]];
    for (const key of names) changed[key] = changed[key].map((v, i) => v + delta[i]);
  } else if (names.includes(name)) changed[name] = [...point];
  if (changed.operations?.length) {
    const unit = weapon => {
      const d = weapon.tip.map((value, i) => value - weapon.butt[i]), length = Math.hypot(...d);
      return length > 1e-6 ? d.map(value => value / length) : [1, 0];
    };
    const a = unit(pike), b = unit(changed);
    for (const op of changed.operations) op.points = op.points.map(point => {
      const delta = point.map((value, i) => value - pike.grip[i]);
      const along = delta[0] * a[0] + delta[1] * a[1], across = -delta[0] * a[1] + delta[1] * a[0];
      return [changed.grip[0] + along * b[0] - across * b[1], changed.grip[1] + along * b[1] + across * b[0]];
    });
  }
  return changed;
}
export function exportPike(pike, transform, layout) {
  if (!pike) return null;
  const result = styledPike(pike);
  delete result.space;
  for (const name of names) {
    const point = placedPoint(pike[name], transform);
    result[name] = [(point[0] - layout.left) * layout.ratio, (point[1] - layout.top) * layout.ratio];
  }
  for (const key of ['width', 'stroke_width', 'head_length', 'head_width', 'head_stroke_width'])
    result[key] *= transform.scale * layout.ratio;
  if (result.operations) for (const op of result.operations) {
    op.width *= transform.scale * layout.ratio;
    op.points = op.points.map(point => {
      const placed = placedPoint(point, transform);
      return [(placed[0] - layout.left) * layout.ratio, (placed[1] - layout.top) * layout.ratio];
    });
  }
  return result;
}
function insetTriangle(points, inset) {
  if (inset === 0) return points.map(p => [...p]);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const edges = points.map((p, i) => points[(i + 1) % 3].map((v, j) => v - p[j]));
  const area = cross(edges[0], points[2].map((v, i) => v - points[0][i]));
  const lengths = edges.map(e => Math.hypot(...e));
  if (Math.abs(area) / lengths.reduce((a, b) => a + b) <= inset) return null;
  const sign = Math.sign(area);
  const starts = points.map((p, i) => [p[0] - sign * edges[i][1] / lengths[i] * inset,
    p[1] + sign * edges[i][0] / lengths[i] * inset]);
  return starts.map((p, i) => {
    const j = (i + 2) % 3, previous = starts[j], edge = edges[j];
    const t = cross(p.map((v, k) => v - previous[k]), edges[i]) / cross(edge, edges[i]);
    return previous.map((v, k) => v + edge[k] * t);
  });
}
export function pikeGeometry(pike, transform) {
  if (!pike?.enabled) return [];
  const a = placedPoint(pike.butt, transform), b = placedPoint(pike.tip, transform);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), width = pike.width * transform.scale;
  if (!(length > 1e-6 && width > 0)) return [];
  const style = styledPike(pike);
  const stroke = Math.max(0, style.stroke_width * transform.scale);
  const headStroke = Math.max(0, style.head_stroke_width * transform.scale);
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], n = [-u[1], u[0]];
  const at = (p, along, across) => [p[0] + u[0] * along + n[0] * across, p[1] + u[1] * along + n[1] * across];
  const headWidth = style.head_width * transform.scale;
  const head = headWidth > 0 ? Math.min(style.head_length * transform.scale, length * .95) : 0;
  const base = at(b, -head, 0);
  const quad = (r, start = a) => [at(start, 0, r), at(base, 0, r), at(base, 0, -r), at(start, 0, -r)];
  const polygons = [{points: quad(width / 2), color: stroke === 0 ? pike.paper : pike.ink}];
  if (stroke > 0 && width > stroke * 2 && length - head > stroke)
    polygons.push({points: quad(width / 2 - stroke, at(a, stroke, 0)), color: pike.paper});
  if (head > 0) {
    const triangle = [at(base, 0, headWidth / 2), b, at(base, 0, -headWidth / 2)];
    polygons.push({points: triangle, color: headStroke === 0 ? pike.paper : pike.ink});
    const inner = headStroke > 0 ? insetTriangle(triangle, headStroke) : null;
    if (inner) polygons.push({points: inner, color: pike.paper});
  }
  return polygons;
}
export function pikeBounds(pike, transform) {
  const points = pikeGeometry(pike, transform).flatMap(p => p.points);
  if (!points.length) return null;
  return {left: Math.min(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])),
    right: Math.max(...points.map(p => p[0])), bottom: Math.max(...points.map(p => p[1]))};
}
function drawPikeGeometry(ctx, pike, transform) {
  ctx.save();
  for (const polygon of pikeGeometry(pike, transform)) {
    ctx.fillStyle = polygon.color; ctx.beginPath(); ctx.moveTo(...polygon.points[0]);
    for (const point of polygon.points.slice(1)) ctx.lineTo(...point);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
// Edited weapons are rendered into a narrow strip along the shaft, not a large
// transparent body-sized rectangle. The unedited path remains vector geometry.
let canvasFactory = () => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
const spriteCache = new Map(); let spritePixels = 0;
export function setPikeCanvasFactory(factory) {canvasFactory = factory; clearPikeSpriteCache();}
export function clearPikeSpriteCache() {spriteCache.clear(); spritePixels = 0;}
export function pikeSprite(pike, transform) {
  if (!pike?.enabled) return null;
  const fixed = stagePike(pike, transform, {validate: false});
  const key = JSON.stringify(fixed);
  if (spriteCache.has(key)) {
    const cached = spriteCache.get(key); spriteCache.delete(key); spriteCache.set(key, cached); return cached;
  }
  const delta = fixed.tip.map((value, i) => value - fixed.butt[i]), length = Math.hypot(...delta);
  if (!(length > 1e-6)) return null;
  const u = delta.map(value => value / length), n = [-u[1], u[0]];
  const toAxis = point => {
    const d = point.map((value, i) => value - fixed.butt[i]);
    return [d[0] * u[0] + d[1] * u[1], d[0] * n[0] + d[1] * n[1]];
  };
  const raw = pikeGeometry(fixed, {x: 0, y: 0, scale: 1});
  const points = raw.flatMap(polygon => polygon.points.map(toAxis));
  const left = Math.min(...points.map(p => p[0])) - 2, top = Math.min(...points.map(p => p[1])) - 2;
  const width = Math.max(...points.map(p => p[0])) - left + 2, height = Math.max(...points.map(p => p[1])) - top + 2;
  const density = Math.min(2, 4096 / width, 4096 / height, Math.sqrt(4000000 / (width * height)));
  const canvas = canvasFactory(); canvas.width = Math.max(1, Math.ceil(width * density)); canvas.height = Math.max(1, Math.ceil(height * density));
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const axisPike = structuredClone(fixed); delete axisPike.space;
  for (const name of names) axisPike[name] = toAxis(fixed[name]);
  ctx.save(); ctx.scale(density, density); ctx.translate(-left, -top);
  drawPikeGeometry(ctx, axisPike, {x: 0, y: 0, scale: 1});
  if (fixed.operations?.length) {
    // Clip paint to the original weapon silhouette. Erasure affects only this layer;
    // later paint can restore erased parts without adding patches outside the pike.
    ctx.beginPath();
    for (const polygon of raw) {
      const projected = polygon.points.map(toAxis); ctx.moveTo(...projected[0]);
      for (const point of projected.slice(1)) ctx.lineTo(...point); ctx.closePath();
    }
    ctx.clip();
    for (const op of fixed.operations) paintOperation(ctx, {...op, points: op.points.map(toAxis)});
  }
  ctx.restore();
  const origin = [fixed.butt[0] + left * u[0] + top * n[0], fixed.butt[1] + left * u[1] + top * n[1]];
  const xAxis = u.map(value => value / density), yAxis = n.map(value => value / density);
  const point = (x, y) => origin.map((value, i) => value + x * xAxis[i] + y * yAxis[i]);
  const result = {canvas, origin, xAxis, yAxis, corners: [point(0,0),point(canvas.width,0),point(canvas.width,canvas.height),point(0,canvas.height)],
    pointInCanvas(point) {const p=toAxis(point); return [(p[0]-left)*density,(p[1]-top)*density];}};
  const pixels = canvas.width * canvas.height;
  while (spriteCache.size && (spriteCache.size >= 32 || spritePixels + pixels > 8000000)) {
    const oldest = spriteCache.keys().next().value, entry = spriteCache.get(oldest);
    spritePixels -= entry.canvas.width * entry.canvas.height; spriteCache.delete(oldest);
  }
  spriteCache.set(key, result); spritePixels += pixels; return result;
}
export function drawPike(ctx, pike, transform) {
  if (!pike?.operations?.length) {drawPikeGeometry(ctx, pike, transform); return;}
  const sprite = pikeSprite(pike, transform); if (!sprite) return;
  ctx.save(); ctx.transform(...sprite.xAxis, ...sprite.yAxis, ...sprite.origin);
  ctx.drawImage(sprite.canvas, 0, 0); ctx.restore();
}
export function drawFigure(ctx, canvas, transform, pike) {
  if (pike?.layer === 'back') drawPike(ctx, pike, transform);
  ctx.drawImage(canvas, transform.x, transform.y, canvas.width * transform.scale, canvas.height * transform.scale);
  if (pike?.layer !== 'back') drawPike(ctx, pike, transform);
}
export function drawPikeHandles(ctx, pike, transform, viewScale, selected = 'grip') {
  if (!pike) return;
  const labels = {grip: 'Greb', butt: 'Bagende', tip: 'Spids'};
  ctx.save(); ctx.font = `${11 / viewScale}px Segoe UI`; ctx.lineWidth = 1.5 / viewScale;
  for (const name of names) {
    const point = placedPoint(pike[name], transform);
    ctx.fillStyle = name === selected ? '#526348' : '#faf8f1'; ctx.strokeStyle = '#526348';
    ctx.beginPath(); ctx.arc(...point, 5 / viewScale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#30251b'; ctx.fillText(labels[name], point[0] + 9 / viewScale, point[1] - 7 / viewScale);
  }
  ctx.restore();
}
