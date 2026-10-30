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

// Pen stroke as one filled outline: light smoothing, a pressure-dependent width per point,
// offset curves on both sides joined by round caps. One fill gives clean anti-aliased edges
// (no beads where segments overlap) and stays sharp at any zoom when drawn as SVG.
export function penPath(s) {
  const raw = s.pts;
  // Drop points that are closer than ~0.3 units; they only add noise.
  const P = [];
  for (let i = 0; i < raw.length; i += 3) {
    const n = P.length;
    if (n && Math.abs(P[n - 3] - raw[i]) + Math.abs(P[n - 2] - raw[i + 1]) < 0.3 && i < raw.length - 3) continue;
    P.push(raw[i], raw[i + 1], raw[i + 2]);
  }
  const n = P.length / 3;
  if (n === 1) {
    const r = penWidth(s, P[2]) / 2;
    return `M${f(P[0] - r)} ${f(P[1])}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }
  // 1-2-1 smoothing of positions and pressure (endpoints kept).
  const X = new Float64Array(n), Y = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1) * 3, b = i * 3, c = Math.min(n - 1, i + 1) * 3;
    const end = i === 0 || i === n - 1;
    X[i] = end ? P[b] : (P[a] + 2 * P[b] + P[c]) / 4;
    Y[i] = end ? P[b + 1] : (P[a + 1] + 2 * P[b + 1] + P[c + 1]) / 4;
    R[i] = penWidth(s, (P[a + 2] + 2 * P[b + 2] + P[c + 2]) / 4) / 2;
  }
  const L = [], Rt = [];
  for (let i = 0; i < n; i++) {
    let tx = X[Math.min(n - 1, i + 1)] - X[Math.max(0, i - 1)];
    let ty = Y[Math.min(n - 1, i + 1)] - Y[Math.max(0, i - 1)];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty * R[i], ny = tx * R[i];
    L.push(X[i] + nx, Y[i] + ny);
    Rt.push(X[i] - nx, Y[i] - ny);
  }
  // Quadratic curves through midpoints of each side.
  const side = (A, rev) => {
    const m = A.length / 2;
    const at = (k) => (rev ? m - 1 - k : k);
    let d = "";
    for (let k = 1; k < m - 1; k++) {
      const i = at(k) * 2, j = at(k + 1) * 2;
      d += `Q${f(A[i])} ${f(A[i + 1])} ${f((A[i] + A[j]) / 2)} ${f((A[i + 1] + A[j + 1]) / 2)}`;
    }
    const last = at(m - 1) * 2;
    return d + `L${f(A[last])} ${f(A[last + 1])}`;
  };
  const re = R[n - 1], rs = R[0];
  return (
    `M${f(L[0])} ${f(L[1])}` +
    side(L, false) +
    `A${f(re)} ${f(re)} 0 0 0 ${f(Rt[(n - 1) * 2])} ${f(Rt[(n - 1) * 2 + 1])}` +
    side(Rt, true) +
    `A${f(rs)} ${f(rs)} 0 0 0 ${f(L[0])} ${f(L[1])}Z`
  );
}

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
    ctx.fillStyle = c;
    ctx.fill(new Path2D(penPath(s)));
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
