// App shell: note library (folders, selection, drag to group) and navigation into the editor.
import {
  listNotes, getDoc, putDoc, putNote, deleteNote, requestPersistence,
  listFolders, putFolder, deleteFolderRecord, moveNote, uid, getDocRecord,
} from "./db.js";
import { newDoc, newPage, noteMeta } from "./model.js";
import { makeThumb } from "./render.js";
import { Editor } from "./editor.js";
import { icon } from "./icons.js";
import { cycleTheme, getTheme, THEME_LABEL } from "./theme.js";

const root = document.getElementById("app");
// Open editors, one per pane (two in split view).
const panes = [];
// Library state: the folder being shown (null = top level) and multi-selection.
let folder = null;
let selecting = false;
const selected = new Set(); // "n:<noteId>" / "f:<folderId>"

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (t) =>
  new Date(t).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const themeIcon = () => ({ system: "auto", light: "sun", dark: "moon" })[getTheme()];

// ---------- folder helpers ----------
const pathTo = (folders, id) => {
  const out = [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (let f = byId.get(id); f && out.length < 50; f = byId.get(f.parent)) out.unshift(f);
  return out;
};
const descendants = (folders, id) => {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parent && out.has(f.parent) && !out.has(f.id)) out.add(f.id), (grew = true);
  }
  return out;
};

export const FOLDER_COLORS = ["#5b7cff", "#22a06b", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#14b8a6", "#64748b"];
const folderColor = (f) => f.color || FOLDER_COLORS[[...f.id].reduce((h, c) => h + c.charCodeAt(0), 0) % FOLDER_COLORS.length];
let query = "";
let libData = { notes: [], folders: [] };

async function showLibrary(folderId = folder) {
  panes.length = 0;
  const [notes, folders] = await Promise.all([listNotes(), listFolders()]);
  libData = { notes, folders };
  if (folderId && !folders.some((f) => f.id === folderId)) folderId = null;
  if (folderId !== folder) {
    selected.clear();
    query = "";
  }
  folder = folderId;
  root.className = "library" + (selecting ? " selecting" : "");
  const path = pathTo(folders, folder);
  const current = path[path.length - 1];
  root.innerHTML = `
    <div class="lib">
      <aside class="lib-side" aria-label="폴더">
        <div class="side-brand"><span class="logo">${icon("pen")}</span>Penote</div>
        <nav class="side-nav">
          <button class="side-folder${folder ? "" : " current"}" data-act="goto-folder" data-folder="">${icon("home")}<span>모든 노트</span><em>${notes.length}</em></button>
          <div class="side-label">폴더<button class="side-add" data-act="new-folder" title="새 폴더">${icon("plus")}</button></div>
          ${sideTree(folders, notes, null, 0)}
        </nav>
      </aside>
      <section class="lib-main">
        <header class="lib-head">
          <div class="lib-title">
            ${
              path.length
                ? `<nav class="crumbs" aria-label="폴더 경로">
                     <button class="crumb" data-act="goto-folder" data-folder="">노트</button>
                     ${path.slice(0, -1).map((f) => `<span class="crumb-sep">›</span><button class="crumb" data-act="goto-folder" data-folder="${f.id}">${esc(f.name)}</button>`).join("")}
                   </nav>`
                : `<div class="brand">Penote</div>`
            }
            <h1>${path.length ? `<button class="icon-btn up-btn" data-act="up" title="상위 폴더">${icon("back")}</button>` : ""}${current ? `<span class="title-dot" style="--fc:${folderColor(current)}"></span>` : ""}<span class="h1-text">${esc(current ? current.name : "모든 노트")}</span></h1>
          </div>
          <div class="lib-actions">
            <label class="search">${icon("search")}<input class="search-input" type="search" placeholder="노트 검색" value="${esc(query)}" aria-label="노트 검색" /></label>
            <button class="btn icon-only" data-act="theme" title="테마: ${THEME_LABEL[getTheme()]}">${icon(themeIcon())}</button>
            <button class="btn${selecting ? " on" : ""}" data-act="select" title="여러 개 선택">${icon("check")}<span>${selecting ? "완료" : "선택"}</span></button>
            <button class="btn" data-act="new-folder" title="새 폴더">${icon("folderPlus")}<span>새 폴더</span></button>
            <button class="btn" data-act="import">${icon("import")}<span>가져오기</span></button>
            <button class="btn primary" data-act="new">${icon("plus")}<span>새 노트</span></button>
          </div>
          <input type="file" class="file" multiple hidden />
        </header>
        <main class="grid-wrap"></main>
      </section>
    </div>
    ${
      selecting
        ? `<div class="selbar">
            <span class="sel-count">${selected.size ? `${selected.size}개 선택됨` : "항목을 탭해서 선택하세요"}</span>
            <button class="btn" data-act="sel-move"${selected.size ? "" : " disabled"}>${icon("folder")}<span>폴더로 이동</span></button>
            <button class="btn" data-act="sel-group"${selected.size ? "" : " disabled"}>${icon("folderPlus")}<span>새 폴더로 묶기</span></button>
            <button class="btn danger" data-act="sel-delete"${selected.size ? "" : " disabled"}>${icon("trash")}<span>삭제</span></button>
          </div>`
        : ""
    }
    <div class="toast hidden"></div>`;
  renderGrid();
  runFlyBack();
  const fileInput = root.querySelector(".file");
  fileInput.addEventListener("change", () => importFiles([...fileInput.files]));
  const search = root.querySelector(".search-input");
  search.addEventListener("input", () => {
    query = search.value.trim();
    renderGrid();
  });
}

function sideTree(folders, notes, parent, depth) {
  return folders
    .filter((f) => (f.parent || null) === parent)
    .map(
      (f) => `<button class="side-folder${f.id === folder ? " current" : ""}" data-act="goto-folder" data-folder="${f.id}" style="--d:${depth};--fc:${folderColor(f)}">
          <span class="side-dot"></span><span>${esc(f.name)}</span><em>${notes.filter((n) => n.folder === f.id).length || ""}</em></button>
        ${sideTree(folders, notes, f.id, depth + 1)}`
    )
    .join("");
}

// Folders and notes of the current folder, or search results across everything.
function renderGrid() {
  const { notes, folders } = libData;
  const wrap = root.querySelector(".grid-wrap");
  if (!wrap) return;
  const here = (x) => (x || null) === folder;
  const q = query.toLowerCase();
  const subFolders = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders.filter((f) => here(f.parent));
  const shownNotes = q ? notes.filter((n) => n.title.toLowerCase().includes(q)) : notes.filter((n) => here(n.folder));
  const nameOf = (fid) => folders.find((f) => f.id === fid)?.name;
  const countIn = (fid) => notes.filter((n) => n.folder === fid).length + folders.filter((f) => f.parent === fid).length;
  const thumbsIn = (fid) => notes.filter((n) => n.folder === fid && n.thumb).slice(0, 3);
  let i = 0;
  const folderCards = subFolders
    .map(
      (f) => `
      <article class="card folder-card${selected.has("f:" + f.id) ? " selected" : ""}" data-folder="${f.id}" style="--i:${Math.min(i++, 20)};--fc:${folderColor(f)}">
        <button class="folder-tile" data-act="open-folder" aria-label="${esc(f.name)} 열기">
          <span class="folder-back"></span>
          <span class="folder-papers">${thumbsIn(f.id).map((n) => `<img src="${n.thumb}" alt="" draggable="false" />`).join("") || "<i></i><i></i>"}</span>
          <span class="folder-front"><span class="folder-count">${countIn(f.id) || ""}</span></span>
          <span class="check">${icon("check")}</span>
        </button>
        <div class="card-meta">
          <div class="card-title">${esc(f.name)}</div>
          <div class="card-sub">${countIn(f.id) ? `항목 ${countIn(f.id)}개` : "비어 있음"}</div>
        </div>
        <button class="icon-btn card-more" data-act="folder-menu" title="폴더 메뉴">${icon("more")}</button>
      </article>`
    )
    .join("");
  const noteCards = shownNotes
    .map(
      (n) => `
      <article class="card note-card${selected.has("n:" + n.id) ? " selected" : ""}${n.pageCount > 1 ? " stack" : ""}" data-id="${n.id}" style="--i:${Math.min(i++, 20)}">
        <button class="thumb" data-act="open">${n.thumb ? `<img src="${n.thumb}" alt="" draggable="false" />` : ""}<span class="check">${icon("check")}</span></button>
        <div class="card-meta">
          <div class="card-title">${esc(n.title)}</div>
          <div class="card-sub">${q && n.folder ? `${esc(nameOf(n.folder) || "")} · ` : ""}${fmtDate(n.modified)}</div>
          <div class="badges"><span>${icon("doc")}${n.pageCount}</span>${n.hasAudio ? `<span class="audio">${icon("wave")}</span>` : ""}</div>
        </div>
        <button class="icon-btn card-more" data-act="note-menu" title="메뉴">${icon("more")}</button>
      </article>`
    )
    .join("");
  const empty = q
    ? `<div class="empty"><p>"${esc(query)}"에 맞는 노트가 없어요.</p></div>`
    : folder
      ? `<div class="empty">${emptyArt()}<p>이 폴더는 비어 있어요.</p><p class="hint">여기서 <b>새 노트</b>를 만들거나, 다른 노트를 길게 눌러 이 폴더로 끌어 놓으세요.</p></div>`
      : `<div class="empty">${emptyArt()}<p>첫 노트를 만들어 보세요.</p><p class="hint"><b>새 노트</b>로 필기를 시작하거나, <b>가져오기</b>로 PDF나 Notability <code>.note</code> 파일을 불러오세요. <b>새 폴더</b>로 과목별 정리도 할 수 있어요.</p></div>`;
  wrap.innerHTML = `
    ${folderCards ? `<h2 class="section-label">폴더</h2><div class="grid">${folderCards}</div>` : ""}
    ${noteCards ? `${folderCards ? `<h2 class="section-label">노트</h2>` : ""}<div class="grid">${noteCards}</div>` : ""}
    ${!folderCards && !noteCards ? empty : ""}`;
}

const emptyArt = () => `<svg class="empty-art" viewBox="0 0 160 120" aria-hidden="true">
  <rect x="38" y="14" width="76" height="96" rx="8" fill="var(--panel-solid)" stroke="var(--line)"/>
  <rect x="46" y="8" width="76" height="96" rx="8" fill="var(--panel-solid)" stroke="var(--line)"/>
  <path d="M58 40h52M58 54h52M58 68h36" stroke="var(--fill-2)" stroke-width="4" stroke-linecap="round"/>
  <path class="empty-ink" d="M58 84c8-10 14 6 22-2s12-10 20 0" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
  <g class="empty-pen"><path d="M118 70l18-30 8 5-18 30-10 4z" fill="var(--accent)"/><path d="M116 79l2-9 8 5z" fill="var(--ink)"/></g>
</svg>`;

function toast(msg, ms = 3000) {
  const t = root.querySelector(".toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => t.classList.add("hidden"), ms);
}

// ---------- navigation (browser back/forward = library history) ----------
function goFolder(id) {
  selected.clear();
  history.pushState({ view: "lib", folder: id || null }, "");
  showLibrary(id || null);
}

let popping = false;
window.addEventListener("popstate", async (e) => {
  if (popping) return;
  popping = true;
  try {
    const st = e.state || { view: "lib", folder: null };
    if (panes.length) {
      for (const p of [...panes]) await p.editor.close();
      panes.length = 0;
    }
    if (st.view === "note") await openNote(st.id, false);
    else await showLibrary(st.folder ?? null);
  } finally {
    popping = false;
  }
});

// ---------- modals ----------
function modal(html, onClick) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "picker-backdrop";
    back.innerHTML = html;
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener("click", (e) => (e.target === back ? done(null) : onClick(e, done, back)));
    document.body.append(back);
    back.querySelector("input")?.focus();
  });
}

// Action sheet: resolves to the chosen key or null.
const sheet = (title, items) =>
  modal(
    `<div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-title">${esc(title)}</div>
      ${items.map((it) => `<button class="sheet-item${it.danger ? " danger" : ""}" data-key="${it.key}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join("")}
      <button class="sheet-item cancel" data-key="">취소</button>
    </div>`,
    (e, done) => {
      const b = e.target.closest("[data-key]");
      if (b) done(b.dataset.key || null);
    }
  );

// Text prompt: resolves to the trimmed text or null.
const askText = (title, value = "", ok = "확인") =>
  modal(
    `<form class="sheet prompt" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-title">${esc(title)}</div>
      <input class="prompt-input" value="${esc(value)}" maxlength="80" />
      <div class="prompt-actions"><button type="button" class="btn" data-key="">취소</button><button class="btn primary" data-key="ok">${esc(ok)}</button></div>
    </form>`,
    (e, done, back) => {
      const b = e.target.closest("[data-key]");
      if (!b) return;
      e.preventDefault();
      done(b.dataset.key ? back.querySelector("input").value.trim() || null : null);
    }
  ).then((v) => v);

// Folder picker: resolves to a folder id, "" for top level, or null when cancelled.
async function pickFolder(title, exclude = new Set()) {
  const folders = await listFolders();
  const rows = [];
  const walk = (parent, depth) => {
    for (const f of folders.filter((x) => (x.parent || null) === parent)) {
      if (exclude.has(f.id)) continue;
      rows.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  const choice = await modal(
    `<div class="sheet folder-pick" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-title">${esc(title)}</div>
      <button class="sheet-item" data-key="root">${icon("home")}<span>노트 (맨 위)</span></button>
      ${rows.map(({ f, depth }) => `<button class="sheet-item" data-key="${f.id}" style="padding-left:${12 + depth * 18}px">${icon("folder")}<span>${esc(f.name)}</span></button>`).join("")}
      <button class="sheet-item accent" data-key="new">${icon("folderPlus")}<span>새 폴더 만들기…</span></button>
      <button class="sheet-item cancel" data-key="">취소</button>
    </div>`,
    (e, done) => {
      const b = e.target.closest("[data-key]");
      if (b) done(b.dataset.key || null);
    }
  );
  if (choice === "root") return "";
  if (choice === "new") {
    const f = await createFolder(folder);
    return f ? f.id : null;
  }
  return choice;
}

const pickColor = (cur) =>
  modal(
    `<div class="sheet" role="dialog" aria-label="폴더 색상">
      <div class="sheet-title">폴더 색상</div>
      <div class="color-row">${FOLDER_COLORS.map((c) => `<button class="color-dot${c === cur ? " on" : ""}" data-key="${c}" style="--c:${c}" aria-label="${c}"></button>`).join("")}</div>
      <button class="sheet-item cancel" data-key="">취소</button>
    </div>`,
    (e, done) => {
      const b = e.target.closest("[data-key]");
      if (b) done(b.dataset.key || null);
    }
  );

async function createFolder(parent, name) {
  name ??= await askText("새 폴더 이름", "새 폴더", "만들기");
  if (!name) return null;
  const f = { id: uid(), name, parent: parent || null, created: Date.now() };
  await putFolder(f);
  return f;
}

// Moves notes ("n:id") and folders ("f:id") into `target` ("" or null = top level).
async function moveItems(keys, target) {
  target = target || null;
  const folders = await listFolders();
  let skipped = 0;
  for (const k of keys) {
    const id = k.slice(2);
    if (k[0] === "n") await moveNote(id, target);
    else {
      if (target && descendants(folders, id).has(target)) {
        skipped++;
        continue;
      }
      const f = folders.find((x) => x.id === id);
      if (f) await putFolder({ ...f, parent: target });
    }
  }
  return skipped;
}

async function deleteFolderTree(id, withContents) {
  const [folders, notes] = await Promise.all([listFolders(), listNotes()]);
  const f = folders.find((x) => x.id === id);
  if (!f) return;
  if (withContents) {
    const ids = descendants(folders, id);
    for (const n of notes) if (ids.has(n.folder)) await deleteNote(n.id);
    for (const fid of ids) await deleteFolderRecord(fid);
  } else {
    // Keep the contents: move them up to the folder's parent.
    for (const n of notes) if (n.folder === id) await moveNote(n.id, f.parent || null);
    for (const c of folders) if (c.parent === id) await putFolder({ ...c, parent: f.parent || null });
    await deleteFolderRecord(id);
  }
}

// ---------- library actions ----------
let suppressClick = false;

async function onLibraryClick(e) {
  if (!root.classList.contains("library")) return;
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  const card = b.closest(".card");
  const id = card?.dataset.id;
  const fid = card?.dataset.folder;
  // Selection mode: tapping a card toggles it.
  if (selecting && card && !b.classList.contains("card-more")) {
    const key = id ? "n:" + id : "f:" + fid;
    selected.has(key) ? selected.delete(key) : selected.add(key);
    card.classList.toggle("selected", selected.has(key));
    const bar = root.querySelector(".selbar");
    bar.querySelector(".sel-count").textContent = selected.size ? `${selected.size}개 선택됨` : "항목을 탭해서 선택하세요";
    bar.querySelectorAll("button").forEach((x) => (x.disabled = !selected.size));
    return;
  }
  switch (b.dataset.act) {
    case "new": {
      const doc = newDoc("새 노트", folder);
      doc.pages.push(newPage("lined"));
      await putDoc(doc);
      await putNote(noteMeta(doc, null));
      openNote(doc.id);
      break;
    }
    case "new-folder":
      if (await createFolder(folder)) showLibrary();
      break;
    case "theme":
      cycleTheme();
      b.innerHTML = icon(themeIcon());
      b.title = "테마: " + THEME_LABEL[getTheme()];
      toast("테마: " + THEME_LABEL[getTheme()], 1200);
      break;
    case "import":
      root.querySelector(".file").click();
      break;
    case "select":
      selecting = !selecting;
      selected.clear();
      showLibrary();
      break;
    case "open":
      openNote(id, true, card.querySelector(".thumb"));
      break;
    case "open-folder":
      goFolder(fid);
      break;
    case "goto-folder":
      goFolder(b.dataset.folder || null);
      break;
    case "up": {
      const path = pathTo(await listFolders(), folder);
      goFolder(path.length > 1 ? path[path.length - 2].id : null);
      break;
    }
    case "note-menu": {
      const note = (await listNotes()).find((n) => n.id === id);
      const k = await sheet(note.title, [
        { key: "rename", label: "이름 변경", icon: "pen" },
        { key: "move", label: "폴더로 이동", icon: "folder" },
        { key: "delete", label: "삭제", icon: "trash", danger: true },
      ]);
      if (k === "rename") {
        const name = await askText("노트 이름", note.title, "변경");
        if (name) {
          const doc = await getDocRecord(id);
          await putDoc({ ...doc, title: name });
          await putNote({ ...note, title: name });
        }
      } else if (k === "move") {
        const t = await pickFolder(`"${note.title}" 이동`);
        if (t !== null) {
          await moveItems(["n:" + id], t);
          toast("이동했어요");
        }
      } else if (k === "delete") {
        if (confirm(`"${note.title}"을(를) 삭제할까요? 되돌릴 수 없어요.`)) await deleteNote(id);
      }
      showLibrary();
      break;
    }
    case "folder-menu": {
      const folders = await listFolders();
      const f = folders.find((x) => x.id === fid);
      const k = await sheet(f.name, [
        { key: "rename", label: "이름 변경", icon: "pen" },
        { key: "color", label: "색상 변경", icon: "palette" },
        { key: "move", label: "다른 폴더로 이동", icon: "folder" },
        { key: "unwrap", label: "폴더만 삭제 (내용은 밖으로 꺼내기)", icon: "folder" },
        { key: "delete", label: "폴더와 안의 노트 모두 삭제", icon: "trash", danger: true },
      ]);
      if (k === "rename") {
        const name = await askText("폴더 이름", f.name, "변경");
        if (name) await putFolder({ ...f, name });
      } else if (k === "color") {
        const c = await pickColor(folderColor(f));
        if (c) await putFolder({ ...f, color: c });
      } else if (k === "move") {
        const t = await pickFolder(`"${f.name}" 이동`, descendants(folders, fid));
        if (t !== null) await moveItems(["f:" + fid], t);
      } else if (k === "unwrap") {
        await deleteFolderTree(fid, false);
      } else if (k === "delete") {
        if (confirm(`"${f.name}" 폴더와 그 안의 모든 노트를 삭제할까요? 되돌릴 수 없어요.`)) await deleteFolderTree(fid, true);
      }
      showLibrary();
      break;
    }
    case "sel-move": {
      const folders = await listFolders();
      const ex = new Set();
      for (const k of selected) if (k[0] === "f") descendants(folders, k.slice(2)).forEach((x) => ex.add(x));
      const t = await pickFolder(`${selected.size}개 이동`, ex);
      if (t === null) return;
      const skipped = await moveItems([...selected], t);
      toast(skipped ? `${selected.size - skipped}개 이동 (폴더를 자기 안으로는 옮길 수 없어요)` : `${selected.size}개 이동했어요`);
      selected.clear();
      selecting = false;
      showLibrary();
      break;
    }
    case "sel-group": {
      const f = await createFolder(folder);
      if (!f) return;
      await moveItems([...selected].filter((k) => k !== "f:" + f.id), f.id);
      toast(`"${f.name}" 폴더로 묶었어요`);
      selected.clear();
      selecting = false;
      showLibrary();
      break;
    }
    case "sel-delete": {
      const nNotes = [...selected].filter((k) => k[0] === "n").length;
      const nFolders = selected.size - nNotes;
      if (!confirm(`노트 ${nNotes}개${nFolders ? `, 폴더 ${nFolders}개(안의 노트 포함)` : ""}를 삭제할까요? 되돌릴 수 없어요.`)) return;
      for (const k of selected) k[0] === "n" ? await deleteNote(k.slice(2)) : await deleteFolderTree(k.slice(2), true);
      selected.clear();
      selecting = false;
      showLibrary();
      break;
    }
  }
}

// ---------- drag to group: long-press a card, drop it on a folder or a path crumb ----------
function bindLibraryDrag() {
  let pending = null, drag = null;
  const clear = () => {
    clearTimeout(pending?.timer);
    pending = null;
  };
  const targetAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const t = el?.closest(".folder-card, .crumb, .up-btn, .side-folder");
    if (!t || t === drag?.card) return null;
    if (t.classList.contains("folder-card")) return { el: t, folder: t.dataset.folder };
    if (t.classList.contains("up-btn")) return { el: t, folder: "__up" };
    return { el: t, folder: t.dataset.folder || "" };
  };
  const start = (p) => {
    const card = p.card;
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = r.width + "px";
    ghost.style.left = r.left + "px";
    ghost.style.top = r.top + "px";
    document.body.append(ghost);
    card.classList.add("drag-src");
    drag = { card, ghost, dx: p.x - r.left, dy: p.y - r.top, key: card.dataset.id ? "n:" + card.dataset.id : "f:" + card.dataset.folder, over: null };
  };
  root.addEventListener("pointerdown", (e) => {
    if (!root.classList.contains("library") || selecting || e.button !== 0) return;
    const card = e.target.closest(".card");
    if (!card || e.target.closest(".card-more")) return;
    pending = { card, x: e.clientX, y: e.clientY, id: e.pointerId, mouse: e.pointerType === "mouse" };
    if (!pending.mouse) pending.timer = setTimeout(() => pending && start(pending), 380);
  });
  window.addEventListener("pointermove", (e) => {
    if (pending && !drag) {
      const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (pending.mouse && moved > 6) start(pending);
      else if (!pending.mouse && moved > 10) return clear(); // a scroll, not a long press
    }
    if (!drag) return;
    drag.ghost.style.left = e.clientX - drag.dx + "px";
    drag.ghost.style.top = e.clientY - drag.dy + "px";
    const t = targetAt(e.clientX, e.clientY);
    if (drag.over?.el !== t?.el) {
      drag.over?.el.classList.remove("drop-target");
      t?.el.classList.add("drop-target");
      drag.over = t;
    }
  });
  const finish = async () => {
    clear();
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.remove();
    d.card.classList.remove("drag-src");
    d.over?.el.classList.remove("drop-target");
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    if (!d.over) return;
    let target = d.over.folder;
    if (target === "__up") {
      const path = pathTo(await listFolders(), folder);
      target = path.length > 1 ? path[path.length - 2].id : "";
    }
    const skipped = await moveItems([d.key], target);
    toast(skipped ? "폴더를 자기 안으로는 옮길 수 없어요" : "이동했어요");
    showLibrary();
  };
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  // While dragging, the page must not scroll under the finger.
  root.addEventListener("touchmove", (e) => drag && e.preventDefault(), { passive: false });
  root.addEventListener("contextmenu", (e) => root.classList.contains("library") && e.preventDefault());
}

async function importFiles(files) {
  const { importPdf, importNote } = await import("./import.js");
  let last = null;
  for (const f of files) {
    try {
      toast(`가져오는 중: ${f.name}`, 0);
      const isNote = /\.note$/i.test(f.name) || f.type === "application/zip";
      const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
      if (!isNote && !isPdf) throw new Error("PDF 또는 .note 파일만 가져올 수 있어요.");
      const doc = isNote ? await importNote(f) : await importPdf(f);
      doc.folder = folder;
      await putDoc(doc);
      await putNote(noteMeta(doc, await makeThumb(doc)));
      last = doc;
    } catch (err) {
      console.error(err);
      alert(`${f.name} 가져오기 실패: ${err.message || err}`);
    }
  }
  await showLibrary();
  if (last) toast(`"${last.title}" 가져오기 완료`);
}

// ---------- page open / close transition ----------
// Opening a note grows its card into the page, like a sheet of paper being picked up;
// leaving shrinks the page back into its card.
let flyBack = null;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function fly(from, to, img, { duration = 460, tilt = true } = {}) {
  const el = document.createElement("div");
  el.className = "page-fly";
  if (img) el.style.backgroundImage = `url("${img}")`;
  Object.assign(el.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px" });
  document.body.append(el);
  const sx = from.width / to.width, sy = from.height / to.height;
  const dx = from.left - to.left, dy = from.top - to.top;
  // Transform only (GPU-composited); animating shadows or radii repaints every frame.
  const anim = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})${tilt ? " perspective(1200px) rotateX(10deg)" : ""}` },
      { transform: "none" },
    ],
    { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }
  );
  return anim.finished.then(() => el);
}

async function openNote(id, push = true, fromEl = null) {
  const doc = await getDoc(id);
  if (!doc) return showLibrary();
  if (push) history.pushState({ view: "note", id, folder }, "");
  selecting = false;
  const from = fromEl && !reduceMotion() ? fromEl.getBoundingClientRect() : null;
  const img = fromEl?.querySelector("img")?.src;
  root.className = "editor" + (from ? " note-enter" : " screen-in");
  root.innerHTML = `<div class="panes"></div>`;
  panes.length = 0;
  const pane = addPane(doc, false, !!from);
  if (!from) return;
  await new Promise((r) => requestAnimationFrame(r));
  const target = pane.editor.currentPage?.().pv?.el.getBoundingClientRect();
  if (!target) return root.classList.remove("note-enter");
  const el = await fly(from, target, img);
  root.classList.remove("note-enter");
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished.then(() => el.remove());
}

// After the library re-renders, shrink the closed page back into its card.
async function runFlyBack() {
  const fb = flyBack;
  flyBack = null;
  if (!fb || reduceMotion()) return;
  const thumb = root.querySelector(`.note-card[data-id="${fb.id}"] .thumb`);
  if (!thumb) return;
  const to = thumb.getBoundingClientRect();
  const img = libData.notes.find((n) => n.id === fb.id)?.thumb;
  thumb.style.visibility = "hidden";
  const el = document.createElement("div");
  el.className = "page-fly";
  if (img) el.style.backgroundImage = `url("${img}")`;
  Object.assign(el.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px" });
  document.body.append(el);
  const sx = fb.rect.width / to.width, sy = fb.rect.height / to.height;
  await el.animate(
    [{ transform: `translate(${fb.rect.left - to.left}px, ${fb.rect.top - to.top}px) scale(${sx}, ${sy})` }, { transform: "none" }],
    { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }
  ).finished;
  thumb.style.visibility = "";
  el.remove();
}

function addPane(doc, animate = false, deferRender = false) {
  const panesEl = root.querySelector(".panes");
  const el = document.createElement("div");
  el.className = "pane" + (animate ? " opening" : "");
  const host = document.createElement("div");
  host.className = "editor-host";
  el.append(host);
  if (panes.length) {
    const divider = document.createElement("div");
    divider.className = "divider";
    divider.title = "끌어서 크기 조절 · 두 번 탭하면 반반 · 끝까지 밀면 닫기";
    panesEl.append(divider);
    bindDivider(divider);
  }
  panesEl.append(el);
  const pane = { el, host, editor: null };
  panes.push(pane);
  pane.editor = new Editor(host, doc, {
    onExit: () => closePane(pane),
    onSplit: (ed) => toggleSplit(ed),
    isSplit: () => panes.length > 1,
    deferRender,
  });
  window.__editor = pane.editor;
  window.__panes = panes;
  panes.forEach((p) => p.editor.renderToolbar());
  return pane;
}

// Removes a pane whose editor has already saved and closed. Closing the last pane goes back
// to the library through history, so the back gesture and the back button agree.
async function closePane(pane) {
  if (panes.length <= 1) {
    const rect = pane.editor.currentPage?.().pv?.el.getBoundingClientRect();
    if (rect && rect.width) flyBack = { id: pane.editor.doc.id, rect };
    panes.length = 0;
    if (history.state?.view === "note") history.back();
    else showLibrary();
    return;
  }
  pane.el.classList.add("closing");
  await new Promise((r) => setTimeout(r, 200));
  root.querySelector(".divider")?.remove();
  pane.el.remove();
  panes.splice(panes.indexOf(pane), 1);
  panes[0].el.style.flex = "";
  window.__editor = panes[0].editor;
  panes[0].editor.renderToolbar();
}

async function toggleSplit(fromEditor) {
  if (panes.length > 1) {
    const other = panes.find((p) => p.editor !== fromEditor);
    await other.editor.close();
    return closePane(other);
  }
  const id = await pickNote(panes.map((p) => p.editor.doc.id));
  if (!id) return;
  let doc;
  if (id === "__new") {
    doc = newDoc();
    doc.pages.push(newPage("lined"));
    await putDoc(doc);
    await putNote(noteMeta(doc, null));
  } else doc = await getDoc(id);
  if (doc) addPane(doc, true);
}

// Modal note picker for the second pane; resolves to a note id, "__new", or null.
async function pickNote(excludeIds) {
  const notes = (await listNotes()).filter((n) => !excludeIds.includes(n.id));
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "picker-backdrop";
    back.innerHTML = `
      <div class="picker" role="dialog" aria-label="같이 볼 노트 선택">
        <h2>화면 분할</h2>
        <p>오른쪽에 같이 띄울 노트를 고르세요.</p>
        <div class="picker-grid">
          <button data-id="__new"><span class="thumb new-thumb">${icon("plus")}</span><span>새 노트</span></button>
          ${notes
            .map((n) => `<button data-id="${n.id}"><span class="thumb">${n.thumb ? `<img src="${n.thumb}" alt="" />` : ""}</span><span>${esc(n.title)}</span></button>`)
            .join("")}
        </div>
      </div>`;
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) done(b.dataset.id);
      else if (e.target === back) done(null);
    });
    document.body.append(back);
  });
}

// Divider: drag to resize, double tap for 50/50, drag past the edge to close that side.
function bindDivider(divider) {
  let lastTap = 0;
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastTap < 320) {
      panes[0].el.style.flex = "";
      lastTap = 0;
      return;
    }
    lastTap = now;
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("dragging");
    const box = root.querySelector(".panes").getBoundingClientRect();
    let ratio = 0.5;
    const move = (ev) => {
      ratio = (ev.clientX - box.left) / box.width;
      const shown = Math.min(0.88, Math.max(0.12, ratio));
      panes[0].el.style.flex = `0 0 ${shown * 100}%`;
      panes[0].el.style.opacity = ratio < 0.15 ? 0.5 : "";
      panes[1].el.style.opacity = ratio > 0.85 ? 0.5 : "";
    };
    const up = async () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up);
      divider.classList.remove("dragging");
      panes.forEach((p) => (p.el.style.opacity = ""));
      const victim = ratio < 0.15 ? panes[0] : ratio > 0.85 ? panes[1] : null;
      if (victim) {
        await victim.editor.close();
        closePane(victim);
      }
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
    divider.addEventListener("pointercancel", up);
  });
}

root.addEventListener("click", onLibraryClick);
bindLibraryDrag();
history.replaceState({ view: "lib", folder: null }, "");
// iPad Safari has its own page-level pinch zoom (it ignores user-scalable=no); stop it so it
// never fights the app's zoom.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
requestPersistence();
showLibrary();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
}
