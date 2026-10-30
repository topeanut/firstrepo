// Page backgrounds, offscreen page rendering, thumbnails and PDF export.
import { renderPage } from "./pdf.js";
import { drawStrokes } from "./ink.js";
import { drawItems } from "./items.js";

const PAPER = {
  light: { paper: "#fff", lined: "#cfe0f1", grid: "#e3e8ee" },
  dark: { paper: "#202124", lined: "#2f3b4a", grid: "#33363b" },
};

export function drawPaper(ctx, bg, w, h, scale, dark = false) {
  const pal = dark ? PAPER.dark : PAPER.light;
  ctx.fillStyle = pal.paper;
  ctx.fillRect(0, 0, w, h);
  const step = 32 * scale;
  ctx.lineWidth = Math.max(1, scale);
  if (bg.type === "lined") {
    ctx.strokeStyle = pal.lined;
    ctx.beginPath();
    for (let y = step * 3; y < h - step; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  } else if (bg.type === "grid") {
    ctx.strokeStyle = pal.grid;
    ctx.beginPath();
    for (let y = step; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    for (let x = step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
  }
}

// `dark` only affects generated paper; PDFs are darkened with a CSS filter on screen.
export async function drawBackground(canvas, page, dark = false) {
  const ctx = canvas.getContext("2d");
  if (page.bg.type === "pdf") {
    try {
      await renderPage(page.bg.pdf, page.bg.page, canvas);
      return;
    } catch (e) {
      console.warn("PDF render failed", e);
    }
  }
  drawPaper(ctx, page.bg, canvas.width, canvas.height, canvas.width / page.w, dark);
}

// Renders a whole page (background + ink) into a new canvas `width` pixels wide.
export async function pageImage(doc, page, width) {
  const c = document.createElement("canvas");
  c.width = Math.round(width);
  c.height = Math.round((width * page.h) / page.w);
  await drawBackground(c, page);
  await drawItems(c.getContext("2d"), (doc.items || []).filter((i) => i.page === page.id), c.width / page.w);
  const ink = doc.strokes.filter((s) => s.page === page.id);
  drawStrokes(c.getContext("2d"), ink, c.width / page.w);
  return c;
}

export async function makeThumb(doc) {
  if (!doc.pages.length) return null;
  const c = await pageImage(doc, doc.pages[0], 360);
  const url = c.toDataURL("image/jpeg", 0.75);
  c.width = c.height = 0;
  return url;
}

// Minimal PDF writer: one JPEG image per page.
export async function exportPdf(doc, onProgress) {
  const enc = new TextEncoder();
  const parts = [];
  let size = 0;
  const offsets = [];
  const push = (data) => {
    const b = typeof data === "string" ? enc.encode(data) : data;
    parts.push(b);
    size += b.length;
  };
  const n = doc.pages.length;
  // Object ids: 1 catalog, 2 pages, then per page: page, content, image.
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const obj = (id, body) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const b of [].concat(body)) push(b);
    push("\nendobj\n");
  };
  const kids = doc.pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const page = doc.pages[i];
    const W = 612, H = (612 * page.h) / page.w;
    const c = await pageImage(doc, page, 1600);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    const jpg = new Uint8Array(await blob.arrayBuffer());
    const [pid, cid, iid] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H.toFixed(2)}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
    const content = `q ${W} 0 0 ${H.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(cid, [`<< /Length ${content.length} >>\nstream\n`, content, "\nendstream"]);
    obj(iid, [
      `<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`,
      jpg,
      "\nendstream",
    ]);
    c.width = c.height = 0;
    onProgress?.(i + 1, n);
  }
  const xref = size;
  const count = 3 + n * 3;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
