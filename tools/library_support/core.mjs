// Shared image composition and placement for editor, playback and export.
export const STAGE = {width: 512, height: 512, pivot: [256, 410.62781438074285]};
export const frameKey = (clip, direction, frame) => `${clip}/${direction}/${frame}`;
export const emptyEdit = () => ({dx: 0, dy: 0, scale: 1, auto: true, pivot: null, operations: []});
export function editFor(edits, key) {return {...emptyEdit(), ...edits[key]};}
export function placement(frame, aligned, edit, corrections = true) {
  const e = corrections ? edit : {...emptyEdit(), auto: edit.auto};
  const automatic = e.auto && aligned;
  const pivot = e.pivot || (automatic ? aligned.pivot : frame.pivot_pixels);
  const scale = STAGE.width / frame.rect.w * (automatic ? aligned.scale : 1) * e.scale;
  return {x: STAGE.pivot[0] + e.dx - pivot[0] * scale,
          y: STAGE.pivot[1] + e.dy - pivot[1] * scale, scale};
}
export function sourcePoint(point, transform) {
  return [(point[0] - transform.x) / transform.scale, (point[1] - transform.y) / transform.scale];
}
export function paintOperation(ctx, op) {
  if (!op.points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = op.tool === "erase" ? "destination-out" : "source-over";
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.width;
  ctx.lineCap = ctx.lineJoin = "round";
  if (op.points.length === 1) {
    ctx.beginPath(); ctx.arc(...op.points[0], op.width / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(...op.points[0]);
    for (const p of op.points.slice(1)) ctx.lineTo(...p);
    ctx.stroke();
  }
  ctx.restore();
}
export function compose(canvas, image, frame, operations) {
  const r = frame.rect;
  canvas.width = Math.ceil(r.w); canvas.height = Math.ceil(r.h);
  const ctx = canvas.getContext("2d", {willReadFrequently: true});
  ctx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  for (const op of operations) paintOperation(ctx, op);
  return canvas;
}
export function drawPlaced(ctx, canvas, transform) {
  ctx.drawImage(canvas, transform.x, transform.y,
    canvas.width * transform.scale, canvas.height * transform.scale);
}
export function frameAt(clip, elapsed) {
  const time = clip.loop ? ((elapsed % clip.duration_seconds) + clip.duration_seconds) % clip.duration_seconds
                         : Math.min(Math.max(0, elapsed), clip.duration_seconds);
  const frames = clip.directions[0].frames;
  const found = frames.findIndex(f => time < f.time_seconds + f.duration_seconds - 1e-9);
  return found < 0 ? frames.length - 1 : found;
}
export class History {
  constructor(edits, onChange) {this.edits = edits; this.onChange = onChange; this.past = []; this.future = [];}
  commit(changes) {
    const before = {}, after = {};
    for (const [key, value] of Object.entries(changes)) {
      before[key] = this.edits[key] === undefined ? null : structuredClone(this.edits[key]);
      after[key] = value === null ? null : structuredClone(value);
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.past.push({before, after}); if (this.past.length > 100) this.past.shift();
    this.future = []; this.apply(after);
  }
  apply(values) {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) delete this.edits[key]; else this.edits[key] = structuredClone(value);
    }
    this.onChange(Object.keys(values));
  }
  undo() {const item = this.past.pop(); if (item) {this.future.push(item); this.apply(item.before);}}
  redo() {const item = this.future.pop(); if (item) {this.past.push(item); this.apply(item.after);}}
}
export function exportLayout(items, outputSize) {
  let left = 0, top = 0, right = STAGE.width, bottom = STAGE.height;
  for (const {canvas, transform: t} of items) {
    left = Math.min(left, t.x); top = Math.min(top, t.y);
    right = Math.max(right, t.x + canvas.width * t.scale);
    bottom = Math.max(bottom, t.y + canvas.height * t.scale);
  }
  const ratio = outputSize / STAGE.width;
  left = Math.floor(left); top = Math.floor(top);
  const width = Math.ceil((Math.ceil(right) - left) * ratio);
  const height = Math.ceil((Math.ceil(bottom) - top) * ratio);
  return {left, top, width, height, ratio, pivot: [(STAGE.pivot[0] - left) * ratio, (STAGE.pivot[1] - top) * ratio]};
}

