// IndexedDB storage: note list metadata, note documents, and binary blobs (PDFs, audio).
const DB_NAME = "penote";
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("notes", { keyPath: "id" });
        db.createObjectStore("docs", { keyPath: "id" });
        db.createObjectStore("blobs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && "result" in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const listNotes = async () =>
  (await tx("notes", "readonly", (s) => s.getAll())).sort((a, b) => b.modified - a.modified);
export const getNote = (id) => tx("notes", "readonly", (s) => s.get(id));
export const putNote = (note) => tx("notes", "readwrite", (s) => s.put(note));
export const getDoc = (id) => tx("docs", "readonly", (s) => s.get(id));
export const putDoc = (doc) => tx("docs", "readwrite", (s) => s.put(doc));
export const getBlob = (key) => tx("blobs", "readonly", (s) => s.get(key));
export const putBlob = (key, blob) => tx("blobs", "readwrite", (s) => s.put(blob, key));

export async function deleteNote(id) {
  const doc = await getDoc(id);
  const keys = new Set();
  if (doc) {
    for (const p of doc.pages) if (p.bg.pdf) keys.add(p.bg.pdf);
    for (const r of doc.recordings) keys.add(r.blob);
    for (const i of doc.items || []) keys.add(i.blob);
  }
  await tx("blobs", "readwrite", (s) => keys.forEach((k) => s.delete(k)));
  await tx("docs", "readwrite", (s) => s.delete(id));
  await tx("notes", "readwrite", (s) => s.delete(id));
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {}
}
