// Document model.
// doc = { id, title, created, modified, pages: [{ id, w, h, bg }], strokes: [stroke], recordings: [{ id, blob, duration, name, created }], nextRec }
// bg = { type: "blank" | "lined" | "grid" } | { type: "pdf", pdf: blobKey, page: n }
import { uid } from "./db.js";

export const PAGE_W = 800;
export const PAPER_RATIO = 11 / 8.5;

export function newPage(type = "lined") {
  return { id: uid(), w: PAGE_W, h: PAGE_W * PAPER_RATIO, bg: { type } };
}

export function newDoc(title = "새 노트") {
  const now = Date.now();
  return { id: uid(), title, created: now, modified: now, pages: [], strokes: [], recordings: [], nextRec: 1 };
}

export function noteMeta(doc, thumb) {
  return {
    id: doc.id,
    title: doc.title,
    created: doc.created,
    modified: doc.modified,
    pageCount: doc.pages.length,
    hasAudio: doc.recordings.length > 0,
    thumb,
  };
}
