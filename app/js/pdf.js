// pdf.js wrapper: loads PDFs from blobs and renders pages into canvases.
import * as pdfjs from "../vendor/pdf.min.mjs";
import { getBlob } from "./db.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;

const docs = new Map();

// Outside Chrome (i.e. Safari) pdf.js would decode scanned pages with the experimental
// ImageDecoder API, which crashes WebKit's renderer; its own JPEG decoder in the worker is safe.
const OPTS = globalThis.chrome ? {} : { isImageDecoderSupported: false };

export function openPdfData(data) {
  return pdfjs.getDocument({ data, isEvalSupported: false, ...OPTS }).promise;
}

// pdf.js keeps a page's decoded images (a scanned page holds a full-size photo, tens of MB) until
// the page is cleaned up. Only the few pages most recently drawn on screen keep theirs; thumbnail
// and export renders let go right away. Without this, memory grew with every page ever shown and
// iPad Safari stalled for long garbage collections.
const HOT = 4;
const hot = new Map(); // "key:page" -> PDFPageProxy
function keepHot(key, pageNo, page) {
  const k = `${key}:${pageNo}`;
  hot.delete(k);
  hot.set(k, page);
  while (hot.size > HOT) {
    const [old, p] = hot.entries().next().value;
    hot.delete(old);
    p.cleanup(); // deferred by pdf.js until the page's pending renders finish
  }
}
function letGo(key, pageNo, page) {
  if (!hot.has(`${key}:${pageNo}`)) page.cleanup();
}

export function loadPdf(key) {
  if (!docs.has(key)) {
    docs.set(
      key,
      getBlob(key).then(async (blob) => openPdfData(new Uint8Array(await blob.arrayBuffer())))
    );
  }
  return docs.get(key);
}

export async function pageSizes(pdf) {
  const sizes = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
    sizes.push([vp.width, vp.height]);
  }
  return sizes;
}

// Renders `pageNo` (1-based) to fill `canvas`; cancels any previous render on the same canvas.
const tasks = new WeakMap();
// `keep`: the page is on screen and will be drawn again soon (keep its decoded images).
export async function renderPage(key, pageNo, canvas, keep = false) {
  tasks.get(canvas)?.cancel();
  const pdf = await loadPdf(key);
  const page = await pdf.getPage(pageNo);
  if (keep) keepHot(key, pageNo, page);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: canvas.width / base.width });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, viewport: vp });
  tasks.set(canvas, task);
  try {
    await task.promise;
  } catch (e) {
    if (e?.name !== "RenderingCancelledException") throw e;
  } finally {
    if (!keep) letGo(key, pageNo, page);
  }
}

// Renders part of a page: the page is laid out `fullWidth` pixels wide and the region starting
// at (x, y) pixels is drawn into `canvas`. Returns { promise, cancel }.
export function renderRegion(key, pageNo, canvas, fullWidth, x, y) {
  let task = null;
  let cancelled = false;
  const promise = (async () => {
    const pdf = await loadPdf(key);
    const page = await pdf.getPage(pageNo);
    if (cancelled) return false;
    keepHot(key, pageNo, page);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: fullWidth / base.width });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    task = page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x, -y] });
    try {
      await task.promise;
      return !cancelled;
    } catch (e) {
      if (e?.name === "RenderingCancelledException") return false;
      throw e;
    }
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}
