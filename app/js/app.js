// App shell: note library and navigation into the editor.
import { listNotes, getDoc, putDoc, putNote, deleteNote, requestPersistence } from "./db.js";
import { newDoc, newPage, noteMeta } from "./model.js";
import { makeThumb } from "./render.js";
import { Editor } from "./editor.js";
import { icon } from "./icons.js";
import { cycleTheme, getTheme, THEME_LABEL } from "./theme.js";

const root = document.getElementById("app");
// Open editors, one per pane (two in split view).
const panes = [];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (t) =>
  new Date(t).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const themeIcon = () => ({ system: "auto", light: "sun", dark: "moon" })[getTheme()];

async function showLibrary() {
  panes.length = 0;
  root.className = "library screen-in";
  const notes = await listNotes();
  root.innerHTML = `
    <header class="lib-head">
      <div>
        <div class="brand">Penote</div>
        <h1>노트<span class="lib-count">${notes.length ? notes.length + "개" : ""}</span></h1>
      </div>
      <div class="lib-actions">
        <button class="btn" data-act="theme" title="테마">${icon(themeIcon())}<span>${THEME_LABEL[getTheme()]}</span></button>
        <button class="btn" data-act="import">${icon("import")}<span>가져오기</span></button>
        <button class="btn primary" data-act="new">${icon("plus")}<span>새 노트</span></button>
      </div>
      <input type="file" class="file" multiple hidden />
    </header>
    <main class="grid">
      ${
        notes.length
          ? notes
              .map(
                (n, i) => `
        <article class="card" data-id="${n.id}" style="--i:${Math.min(i, 20)}">
          <button class="thumb" data-act="open">${n.thumb ? `<img src="${n.thumb}" alt="" />` : ""}</button>
          <div class="card-meta">
            <div class="card-title">${esc(n.title)}</div>
            <div class="card-sub">${fmtDate(n.modified)} · ${n.pageCount}쪽${n.hasAudio ? " · 녹음" : ""}</div>
          </div>
          <button class="icon-btn card-more" data-act="note-menu" title="메뉴">${icon("more")}</button>
        </article>`
              )
              .join("")
          : `<div class="empty">
              <p>아직 노트가 없어요.</p>
              <p class="hint"><b>새 노트</b>로 필기를 시작하거나, <b>가져오기</b>로 PDF나 Notability <code>.note</code> 파일을 불러오세요.</p>
            </div>`
      }
    </main>
    <div class="toast hidden"></div>`;

  const fileInput = root.querySelector(".file");
  fileInput.addEventListener("change", () => importFiles([...fileInput.files]));
}

function toast(msg, ms = 3000) {
  const t = root.querySelector(".toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => t.classList.add("hidden"), ms);
}

async function onLibraryClick(e) {
  if (!root.classList.contains("library")) return;
  const b = e.target.closest("button");
  if (!b) return;
  const id = b.closest(".card")?.dataset.id;
  switch (b.dataset.act) {
    case "new": {
      const doc = newDoc();
      doc.pages.push(newPage("lined"));
      await putDoc(doc);
      await putNote(noteMeta(doc, null));
      openNote(doc.id);
      break;
    }
    case "theme":
      cycleTheme();
      b.innerHTML = `${icon(themeIcon())}<span>${THEME_LABEL[getTheme()]}</span>`;
      break;
    case "import":
      root.querySelector(".file").click();
      break;
    case "open":
      openNote(id);
      break;
    case "note-menu": {
      const note = (await listNotes()).find((n) => n.id === id);
      const choice = prompt(`"${note.title}"\n새 이름을 입력하거나, 삭제하려면 "삭제"를 입력하세요.`, note.title);
      if (choice === null) return;
      if (choice.trim() === "삭제") {
        if (confirm(`"${note.title}"을(를) 삭제할까요? 되돌릴 수 없어요.`)) await deleteNote(id);
      } else if (choice.trim()) {
        const doc = await getDoc(id);
        doc.title = choice.trim();
        await putDoc(doc);
        await putNote({ ...note, title: doc.title });
      }
      showLibrary();
      break;
    }
  }
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

async function openNote(id) {
  const doc = await getDoc(id);
  if (!doc) return showLibrary();
  root.className = "editor screen-in";
  root.innerHTML = `<div class="panes"></div>`;
  panes.length = 0;
  addPane(doc);
}

function addPane(doc, animate = false) {
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
  });
  window.__editor = pane.editor;
  window.__panes = panes;
  panes.forEach((p) => p.editor.renderToolbar());
  return pane;
}

// Removes a pane whose editor has already saved and closed.
async function closePane(pane) {
  if (panes.length <= 1) return showLibrary();
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
