// IndexedDB storage: note list metadata, note documents, folders, and binary blobs (PDFs, audio).
const DB_NAME = "penote";
const DB_VERSION = 3;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore("notes", { keyPath: "id" });
          db.createObjectStore("docs", { keyPath: "id" });
          db.createObjectStore("blobs");
        }
        // v2: folders = { id, name, parent (folder id or null), created }
        if (e.oldVersion < 2) db.createObjectStore("folders", { keyPath: "id" });
        // v3: strokes = { ...stroke, note }, indexed by note. Docs flagged strokeStore keep their
        // ink here, so saving writes only the strokes that changed instead of the whole note.
        if (e.oldVersion < 3) db.createObjectStore("strokes", { keyPath: "id" }).createIndex("note", "note");
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
// The doc record alone (for renames/moves): without strokes kept in the strokes store.
export const getDocRecord = (id) => tx("docs", "readonly", (s) => s.get(id));
export async function getDoc(id) {
  const doc = await getDocRecord(id);
  if (doc?.strokeStore) {
    const rows = await tx("strokes", "readonly", (s) => s.index("note").getAll(id));
    rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    doc.strokes = rows.map(({ note, ...st }) => st);
  }
  return doc;
}
export const putDoc = (doc) => tx("docs", "readwrite", (s) => s.put(doc.strokeStore ? { ...doc, strokes: undefined } : doc));
// Writes changed strokes (Map id -> stroke, or null to delete) in one transaction.
export const saveStrokes = (noteId, changes) =>
  tx("strokes", "readwrite", (s) => {
    for (const [id, st] of changes) st ? s.put({ ...st, note: noteId }) : s.delete(id);
  });
export const getBlob = (key) => tx("blobs", "readonly", (s) => s.get(key));
export const putBlob = (key, blob) => tx("blobs", "readwrite", (s) => s.put(blob, key));
export const deleteBlob = (key) => tx("blobs", "readwrite", (s) => s.delete(key));

export const listFolders = async () =>
  (await tx("folders", "readonly", (s) => s.getAll())).sort((a, b) => a.name.localeCompare(b.name, "ko"));
export const putFolder = (f) => tx("folders", "readwrite", (s) => s.put(f));
export const deleteFolderRecord = (id) => tx("folders", "readwrite", (s) => s.delete(id));

// Moves a note into a folder (null = top level); the folder lives on both the doc and its metadata.
export async function moveNote(id, folder) {
  const [doc, note] = await Promise.all([getDocRecord(id), getNote(id)]);
  if (doc) await putDoc({ ...doc, folder });
  if (note) await putNote({ ...note, folder });
}

export async function deleteNote(id) {
  const doc = await getDocRecord(id);
  if (doc?.strokeStore) {
    const keys = await tx("strokes", "readonly", (s) => s.index("note").getAllKeys(id));
    await tx("strokes", "readwrite", (s) => keys.forEach((k) => s.delete(k)));
  }
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
