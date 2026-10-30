// Importers: PDF files and Notability .note archives -> Penote documents.
import { unzipSync } from "../vendor/fflate.mjs";
import { parsePlist, KeyedArchive } from "./plist.js";
import { openPdfData, pageSizes } from "./pdf.js";
import { putBlob, uid } from "./db.js";
import { PAGE_W, newDoc } from "./model.js";

// Stores a PDF and returns one page per PDF page.
export async function pdfPages(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await openPdfData(bytes.slice());
  const key = "pdf-" + uid();
  await putBlob(key, new Blob([bytes], { type: "application/pdf" }));
  return (await pageSizes(pdf)).map(([w, h], i) => ({
    id: uid(),
    w: PAGE_W,
    h: (PAGE_W * h) / w,
    bg: { type: "pdf", pdf: key, page: i + 1 },
  }));
}

export async function importPdf(file) {
  const doc = newDoc(file.name.replace(/\.pdf$/i, ""));
  doc.pages = await pdfPages(file);
  return doc;
}

// Where Notability places an imported PDF page inside its paper page, as fractions of the paper
// page. Fitted against Notability's own PDF export (see notability/FORMAT.md).
const INSET = { x: -10.3 / 716.8, y: 8.8 / 537.6, w: 708.5 / 716.8, h: 529.4 / 537.6 };

const f32 = (u8) => new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + (u8.byteLength & ~3)));
const u32 = (u8) => new Uint32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + (u8.byteLength & ~3)));
const hex = (u8, i) => Array.from(u8.subarray(i * 16, i * 16 + 16), (b) => b.toString(16).padStart(2, "0")).join("");

export async function importNote(file) {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const names = Object.keys(files);
  const find = (suffix) => names.find((n) => n.endsWith(suffix) && files[n].length);
  const sessionName = find("/Session.plist");
  if (!sessionName) throw new Error("Session.plist가 없는 .note 파일이에요.");
  const prefix = sessionName.slice(0, -"Session.plist".length);

  const arc = new KeyedArchive(parsePlist(files[sessionName]));
  const session = arc.root();
  const rich = arc.get(session, "richText");
  const doc = newDoc(arc.deref(session.name) || file.name.replace(/\.note$/i, ""));

  // Paper geometry.
  const layout = arc.get(session, "NBNoteTakingSessionDocumentPaperLayoutModelKey");
  const paper = arc.plain(arc.get(layout, "documentPaperAttributes")) || {};
  const paperW = parseFloat(String(paper.paperSizingBehavior || "").split(":")[1]) || 716.8;

  // PDFs referenced by the page layout.
  const pdfs = {};
  for (const n of names) {
    const m = n.match(/\/PDFs\/([^/]+\.pdf)$/i);
    if (!m || !files[n].length) continue;
    const key = "pdf-" + uid();
    await putBlob(key, new Blob([files[n]], { type: "application/pdf" }));
    const pdf = await openPdfData(files[n].slice());
    pdfs[m[1]] = { key, sizes: await pageSizes(pdf) };
  }

  // Pages in paper units, stacked vertically.
  const layoutPages = (arc.plain(arc.get(rich, "pageLayoutArray")) || []).filter(Boolean);
  const paperPages = [];
  let top = 0;
  for (const lp of layoutPages) {
    const pdf = pdfs[lp.kPageLayoutPDFFileNameKey];
    const size = pdf?.sizes[(lp.kPageLayoutPDFPageNumberKey || 1) - 1];
    if (pdf && size) {
      const h = (paperW * size[1]) / size[0];
      paperPages.push({ top, h, pdf: pdf.key, page: lp.kPageLayoutPDFPageNumberKey, aspect: size[1] / size[0] });
      top += h;
    } else {
      paperPages.push({ top, h: paperW * (11 / 8.5) });
      top += paperW * (11 / 8.5);
    }
  }

  // Ink buffers (struct of arrays).
  const hash = arc.get(arc.get(rich, "Handwriting Overlay"), "SpatialHash");
  const strokes = [];
  if (hash) {
    const n = arc.deref(hash.numcurves) || 0;
    const counts = u32(arc.get(hash, "curvesnumpoints"));
    const pts = f32(arc.get(hash, "curvespoints"));
    const forces = arc.get(hash, "curvesforces") ? f32(arc.get(hash, "curvesforces")) : null;
    const colors = arc.get(hash, "curvescolors");
    const widths = f32(arc.get(hash, "curveswidth"));
    const uuids = arc.get(hash, "curveUUIDs");

    // Audio sync table: curve UUID -> recording + time.
    const sync = new Map();
    const ev = arc.get(session, "contentPlaybackEventManager");
    if (ev) {
      const ne = arc.deref(ev.NBCPTimeManagerSOANumEventsKey) || 0;
      const eu = arc.get(ev, "NBCPTimeManagerSOAEventUUIDsKey");
      const ts = f32(arc.get(ev, "NBCPTimeManagerSOATimestampsKey"));
      const rid = u32(arc.get(ev, "NBCPTimeManagerSOARecordingIDsKey"));
      for (let i = 0; i < ne; i++) sync.set(hex(eu, i), { rec: rid[i], t: ts[i] });
    }

    // Grow blank pages to cover ink beyond the last laid-out page.
    let maxY = 0;
    for (let i = 1; i < pts.length; i += 2) maxY = Math.max(maxY, pts[i]);
    while (top < maxY || !paperPages.length) {
      paperPages.push({ top, h: paperW * (11 / 8.5) });
      top += paperW * (11 / 8.5);
    }

    let off = 0;
    for (let i = 0; i < n; i++) {
      const cnt = counts[i];
      const x0 = pts[off * 2], y0 = pts[off * 2 + 1];
      let pi = paperPages.findIndex((p) => y0 >= p.top && y0 < p.top + p.h);
      if (pi < 0) pi = y0 < 0 ? 0 : paperPages.length - 1;
      const pp = paperPages[pi];
      // Paper units -> page units for this page.
      let sx, ox, sy, oy;
      if (pp.pdf) {
        sx = PAGE_W / (INSET.w * paperW);
        ox = INSET.x * paperW;
        const pageH = PAGE_W * pp.aspect;
        sy = pageH / (INSET.h * pp.h);
        oy = pp.top + INSET.y * pp.h;
      } else {
        sx = sy = PAGE_W / paperW;
        ox = 0;
        oy = pp.top;
      }
      const out = new Array(cnt * 3);
      for (let j = 0; j < cnt; j++) {
        const k = off + j;
        out[j * 3] = Math.round((pts[k * 2] - ox) * sx * 100) / 100;
        out[j * 3 + 1] = Math.round((pts[k * 2 + 1] - oy) * sy * 100) / 100;
        out[j * 3 + 2] = forces ? Math.round(Math.min(1, Math.max(0.05, forces[k])) * 100) / 100 : 0.7;
      }
      off += cnt;
      const r = colors[i * 4], g = colors[i * 4 + 1], b = colors[i * 4 + 2], a = colors[i * 4 + 3];
      const isHl = a < 200;
      strokes.push({
        id: uid(),
        page: pi,
        tool: isHl ? "hl" : "pen",
        color: "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
        width: Math.max(0.5, (widths[i] || 1) * sx * (isHl ? 1 : 1.2)),
        pts: out,
        audio: sync.get(hex(uuids, i)) || null,
      });
    }
  }

  doc.pages = paperPages.map((p) => ({
    id: uid(),
    w: PAGE_W,
    h: p.pdf ? PAGE_W * p.aspect : (PAGE_W * p.h) / paperW,
    bg: p.pdf ? { type: "pdf", pdf: p.pdf, page: p.page } : { type: "blank" },
  }));
  // Page index -> page id.
  for (const s of strokes) s.page = doc.pages[s.page].id;
  doc.strokes = strokes;

  // Recordings.
  const libName = find("/Recordings/library.plist");
  if (libName) {
    const lib = parsePlist(files[libName]).recordings || {};
    for (const [id, r] of Object.entries(lib)) {
      const data = files[prefix + "Recordings/" + r.filepath];
      if (!data) continue;
      const key = "audio-" + uid();
      await putBlob(key, new Blob([data], { type: "audio/mp4" }));
      doc.recordings.push({
        id: Number(id),
        blob: key,
        duration: r.duration || 0,
        name: r.userFacingName || r.name || "녹음 " + id,
        created: r.createddate ? new Date(r.createddate).getTime() : Date.now(),
      });
    }
    doc.recordings.sort((a, b) => a.id - b.id);
    doc.nextRec = Math.max(0, ...doc.recordings.map((r) => r.id)) + 1;
  }
  return doc;
}
