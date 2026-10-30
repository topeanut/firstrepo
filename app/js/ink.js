// Stroke model, rendering and hit testing.
// A stroke: { id, page, tool: "pen" | "hl", color: "#rrggbb", width, pts: [x, y, pressure, ...], audio: {rec, t} | null }
// Coordinates are in page units (see editor.js PAGE_W).

export const HL_ALPHA = 0.35;

const bbCache = new WeakMap();

export function bbox(s) {
  const cached = bbCache.get(s);
  if (cached) return cached;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) {
    const x = s.pts[i], y = s.pts[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const pad = s.width;
  const bb = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  bbCache.set(s, bb);
  return bb;
}

// Pressure may be missing/NaN in notes imported by older versions; fall back to a mid value.
const penWidth = (s, p) => s.width * (0.35 + 0.9 * (Number.isFinite(p) ? p : 0.7));
const f = (v) => Math.round(v * 100) / 100;

// Pen stroke drawn along its centreline with a round nib (round caps and joins), smoothed by
// quadratic curves through segment midpoints. Pressure is kept by splitting the stroke into
// runs of similar width; runs share their end points, so the seams are invisible.
// (An offset-outline fill was tried first: on tight turns in small handwriting its two sides
// cross and leave blobs, which looked smudged.)
export function penChunks(s) {
  const p = s.pts;
  const n = p.length / 3;
  if (n === 1) return [{ d: `M${f(p[0])} ${f(p[1])}l0.01 0`, w: penWidth(s, p[2]) }];
  // Width per point from lightly smoothed pressure; positions are used as recorded.
  const W = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1) * 3 + 2, b = i * 3 + 2, c = Math.min(n - 1, i + 1) * 3 + 2;
    W[i] = penWidth(s, (p[a] + 2 * p[b] + p[c]) / 4);
  }
  const mid = (k) => [(p[(k - 1) * 3] + p[k * 3]) / 2, (p[(k - 1) * 3 + 1] + p[k * 3 + 1]) / 2];
  const chunks = [];
  let d = "", sum = 0, cnt = 0;
  for (let k = 1; k < n; k++) {
    const w = W[k];
    if (cnt && Math.abs(w - sum / cnt) > 0.05 * (sum / cnt)) {
      chunks.push({ d, w: sum / cnt });
      d = "";
      sum = cnt = 0;
    }
    if (!d) {
      const [sx, sy] = k === 1 ? [p[0], p[1]] : mid(k);
      d = `M${f(sx)} ${f(sy)}`;
    }
    const x = p[k * 3], y = p[k * 3 + 1];
    if (k === n - 1) d += `L${f(x)} ${f(y)}`;
    else {
      const [ex, ey] = mid(k + 1);
      d += `Q${f(x)} ${f(y)} ${f(ex)} ${f(ey)}`;
    }
    sum += w;
    cnt++;
  }
  if (d) chunks.push({ d, w: sum / cnt });
  return chunks;
}

// The whole stroke as one path at its average width (used while the stroke is being drawn).
export function penLine(s) {
  const p = s.pts;
  const n = p.length / 3;
  let w = 0;
  for (let i = 2; i < p.length; i += 3) w += penWidth(s, p[i]);
  w /= n;
  if (n === 1) return { d: `M${f(p[0])} ${f(p[1])}l0.01 0`, w: f(w) };
  let d = `M${f(p[0])} ${f(p[1])}`;
  for (let k = 1; k < n - 1; k++) {
    const x = p[k * 3], y = p[k * 3 + 1];
    d += `Q${f(x)} ${f(y)} ${f((x + p[k * 3 + 3]) / 2)} ${f((y + p[k * 3 + 4]) / 2)}`;
  }
  return { d: d + `L${f(p[(n - 1) * 3])} ${f(p[(n - 1) * 3 + 1])}`, w: f(w) };
}

export const penSvg = (s) => penChunks(s).map((c) => `<path d="${c.d}" stroke-width="${f(c.w)}"/>`).join("");

// Highlighter: a plain polyline stroked at constant width.
export function hlPath(s) {
  const p = s.pts;
  let d = `M${f(p[0])} ${f(p[1])}`;
  for (let i = 3; i < p.length; i += 3) d += `L${f(p[i])} ${f(p[i + 1])}`;
  if (p.length === 3) d += `l0.1 0`;
  return d;
}

// Canvas version (thumbnails, PDF export): same geometry as the SVG paths.
// `color` maps the stored colour to the displayed one (e.g. for dark paper).
export function drawStroke(ctx, s, scale, faded = false, color = null) {
  if (!s.pts.length) return;
  ctx.save();
  ctx.scale(scale, scale);
  const c = faded ? "#9aa3ad" : color ? color(s.color) : s.color;
  if (s.tool === "hl") {
    ctx.globalAlpha = faded ? 0.15 : HL_ALPHA;
    ctx.strokeStyle = c;
    ctx.lineWidth = s.width;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.stroke(new Path2D(hlPath(s)));
  } else {
    if (faded) ctx.globalAlpha = 0.45;
    ctx.strokeStyle = c;
    ctx.lineCap = ctx.lineJoin = "round";
    for (const ch of penChunks(s)) {
      ctx.lineWidth = ch.w;
      ctx.stroke(new Path2D(ch.d));
    }
  }
  ctx.restore();
}

// Highlighters render under pen ink, like on paper.
export function drawStrokes(ctx, strokes, scale, isFaded = () => false, color = null) {
  for (const s of strokes) if (s.tool === "hl") drawStroke(ctx, s, scale, isFaded(s), color);
  for (const s of strokes) if (s.tool !== "hl") drawStroke(ctx, s, scale, isFaded(s), color);
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

export function hitStroke(s, x, y, r) {
  const [x0, y0, x1, y1] = bbox(s);
  if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) return false;
  const rr = r + s.width / 2;
  const pts = s.pts;
  if (pts.length === 3) return (pts[0] - x) ** 2 + (pts[1] - y) ** 2 <= rr * rr;
  for (let i = 3; i < pts.length; i += 3) {
    if (segDist2(x, y, pts[i - 3], pts[i - 2], pts[i], pts[i + 1]) <= rr * rr) return true;
  }
  return false;
}

// Partial eraser: cuts the parts of a stroke within `r` of (x, y).
// Returns null when the stroke is untouched, otherwise the remaining pieces as pts arrays.
export function cutStroke(s, x, y, r) {
  const [x0, y0, x1, y1] = bbox(s);
  if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) return null;
  const pts = s.pts;
  const rr = (r + (s.tool === "hl" ? s.width / 2 : s.width * 0.4)) ** 2;
  // Densify long segments so the cut lands close to the eraser edge.
  const step = Math.max(0.5, r / 3);
  const dense = [];
  for (let i = 0; i < pts.length; i += 3) {
    if (i) {
      const ax = pts[i - 3], ay = pts[i - 2], ap = pts[i - 1];
      const len = Math.hypot(pts[i] - ax, pts[i + 1] - ay);
      for (let k = 1; k * step < len; k++) {
        const t = (k * step) / len;
        dense.push(ax + (pts[i] - ax) * t, ay + (pts[i + 1] - ay) * t, ap + (pts[i + 2] - ap) * t);
      }
    }
    dense.push(pts[i], pts[i + 1], pts[i + 2]);
  }
  const pieces = [];
  let cur = [];
  let cut = false;
  for (let i = 0; i < dense.length; i += 3) {
    if ((dense[i] - x) ** 2 + (dense[i + 1] - y) ** 2 <= rr) {
      cut = true;
      if (cur.length) pieces.push(cur);
      cur = [];
    } else cur.push(Math.round(dense[i] * 100) / 100, Math.round(dense[i + 1] * 100) / 100, Math.round(dense[i + 2] * 100) / 100);
  }
  if (cur.length) pieces.push(cur);
  if (!cut) return null;
  // Drop crumbs left at the eraser edge.
  return pieces.filter((p) => p.length >= 6 || pts.length === 3);
}
