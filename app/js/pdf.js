// pdf.js wrapper: loads PDFs from blobs and renders pages into canvases.
import * as pdfjs from "../vendor/pdf.min.mjs";
import { getBlob } from "./db.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;

const docs = new Map();

export function openPdfData(data) {
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
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
export async function renderPage(key, pageNo, canvas) {
  tasks.get(canvas)?.cancel();
  const pdf = await loadPdf(key);
  const page = await pdf.getPage(pageNo);
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
  }
}
