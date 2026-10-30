// App shell: note library and navigation into the editor.
import { listNotes, getDoc, putDoc, putNote, deleteNote, requestPersistence } from "./db.js";
import { newDoc, newPage, noteMeta } from "./model.js";
import { makeThumb } from "./render.js";
import { Editor } from "./editor.js";
import { icon } from "./icons.js";
import { cycleTheme, getTheme, THEME_LABEL } from "./theme.js";

const root = document.getElementById("app");
let editor = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (t) =>
  new Date(t).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const themeIcon = () => ({ system: "auto", light: "sun", dark: "moon" })[getTheme()];

async function showLibrary() {
  editor = null;
  root.className = "library";
  const notes = await listNotes();
  root.innerHTML = `
    <header class="lib-head">
      <h1>Penote</h1>
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
                (n) => `
        <article class="card" data-id="${n.id}">
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
  if (root.className !== "library") return;
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
  root.className = "editor";
  root.innerHTML = "";
  const host = document.createElement("div");
  host.className = "editor-host";
  root.append(host);
  editor = new Editor(host, doc, { onExit: () => showLibrary() });
  window.__editor = editor;
}

root.addEventListener("click", onLibraryClick);
requestPersistence();
showLibrary();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
}
