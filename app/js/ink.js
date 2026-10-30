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

const penWidth = (s, p) => s.width * (0.35 + 0.9 * p);

export function drawStroke(ctx, s, scale, faded = false) {
  const pts = s.pts;
  const n = pts.length / 3;
  if (!n) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ctx.fillStyle = faded ? "#9aa3ad" : s.color;
  if (s.tool === "hl") {
    ctx.globalAlpha = faded ? 0.15 : HL_ALPHA;
    ctx.lineWidth = s.width * scale;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(pts[0] * scale, pts[1] * scale);
    for (let i = 3; i < pts.length; i += 3) ctx.lineTo(pts[i] * scale, pts[i + 1] * scale);
    if (n === 1) ctx.lineTo(pts[0] * scale + 0.1, pts[1] * scale);
    ctx.stroke();
  } else {
    if (faded) ctx.globalAlpha = 0.45;
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(pts[0] * scale, pts[1] * scale, (penWidth(s, pts[2]) * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Variable-width polyline: one segment per lineWidth, smoothed through midpoints.
      let px = pts[0], py = pts[1];
      for (let i = 3; i < pts.length; i += 3) {
        const x = pts[i], y = pts[i + 1];
        const mx = i + 3 < pts.length ? (x + pts[i + 3]) / 2 : x;
        const my = i + 3 < pts.length ? (y + pts[i + 4]) / 2 : y;
        ctx.lineWidth = Math.max(0.6, penWidth(s, pts[i + 2]) * scale);
        ctx.beginPath();
        ctx.moveTo(px * scale, py * scale);
        ctx.quadraticCurveTo(x * scale, y * scale, mx * scale, my * scale);
        ctx.stroke();
        px = mx;
        py = my;
      }
    }
  }
  ctx.restore();
}

// Highlighters render under pen ink, like on paper.
export function drawStrokes(ctx, strokes, scale, isFaded = () => false) {
  for (const s of strokes) if (s.tool === "hl") drawStroke(ctx, s, scale, isFaded(s));
  for (const s of strokes) if (s.tool !== "hl") drawStroke(ctx, s, scale, isFaded(s));
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
