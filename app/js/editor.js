// Note editor: page views, Apple Pencil input, tools, undo, audio recording/playback sync.
import { drawStroke, drawStrokes, drawPenRange, hitStroke, bbox, cutStroke } from "./ink.js";
import { drawBackground, exportPdf, makeThumb, pageImage } from "./render.js";
import { Recorder, Player, fmtTime } from "./audio.js";
import { getBlob, putDoc, putNote, deleteBlob, uid } from "./db.js";
import { newPage, noteMeta } from "./model.js";
import { icon } from "./icons.js";
import { itemElement, positionItem, hitItem, makeImageItem, makeFileItem, openItem } from "./items.js";
import { isDark, darkPdf, darkInk, cycleTheme, toggleDarkPdf, getTheme, THEME_LABEL, onThemeChange } from "./theme.js";

const COLORS = ["#000000", "#5f6368", "#0a63d8", "#d93025", "#1e8e3e", "#f29900", "#8e44ad"];
const COLOR_NAMES = { "#000000": "검정", "#5f6368": "회색", "#0a63d8": "파랑", "#d93025": "빨강", "#1e8e3e": "초록", "#f29900": "주황", "#8e44ad": "보라" };
const HL_COLORS = ["#ffe03d", "#7ce38b", "#7cc6ff", "#ff8fc7"];
const PEN_SIZES = [1.6, 2.6, 4.2];
const HL_SIZES = [12, 20, 30];
const MAX_CANVAS_PX = 3.5e6; // per canvas; iPad Safari has a tight total canvas memory budget
const ERASER_SIZES = [5, 11, 22];

const prefs = {
  get(k, d) {
    try {
      const v = localStorage.getItem("penote." + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("penote." + k, JSON.stringify(v));
    } catch {}
  },
};

export class Editor {
  // opts: { onExit, onSplit, isSplit } — onSplit opens/closes the second pane (app.js).
  constructor(root, doc, { onExit, onSplit = null, isSplit = () => false }) {
    this.root = root;
    this.doc = doc;
    this.onExit = onExit;
    this.onSplit = onSplit;
    this.isSplit = isSplit;
    Editor.focused = this;
    this.tool = prefs.get("tool", "pen");
    this.penColor = prefs.get("penColor", COLORS[0]);
    this.hlColor = prefs.get("hlColor", HL_COLORS[0]);
    this.penSize = prefs.get("penSize", 1);
    this.hlSize = prefs.get("hlSize", 1);
    this.eraserMode = prefs.get("eraserMode", "partial");
    this.eraserSize = prefs.get("eraserSize", 1);
    this.sidebarOpen = prefs.get("sidebar", window.innerWidth >= 700);
    this.pencilOnly = prefs.get("pencilOnly", true);
    this.zoom = 1;
    this.undoStack = [];
    this.redoStack = [];
    doc.items ||= [];
    this.byPage = new Map(doc.pages.map((p) => [p.id, []]));
    this.urls = new Map();
    this.selected = null;
    for (const s of doc.strokes) this.byPage.get(s.page)?.push(s);
    this.recorder = new Recorder();
    this.player = new Player();
    this.replay = true;
    this.thumbs = new Map(); // page id -> { url, stale }
    if (doc.view?.zoom) this.zoom = doc.view.zoom;
    this.build();
    this.root.querySelector(".body").classList.toggle("sidebar-open", this.sidebarOpen);
    this.layout();
    this.buildSidebar();
    this.restoreView();
    this.bindInput();
    this.saveTimer = null;
  }

  // ---------- DOM ----------
  build() {
    this.root.innerHTML = `
      <header class="toolbar">
        <div class="tb-group tb-left">
          <button class="icon-btn" data-act="back" title="라이브러리">${icon("back")}</button>
          <div class="undo-group" role="group" aria-label="실행 취소">
            <button class="icon-btn" data-act="undo" title="실행 취소 (두 손가락 탭)">${icon("undo")}</button>
            <button class="icon-btn" data-act="redo" title="다시 실행 (세 손가락 탭)">${icon("redo")}</button>
          </div>
          <button class="icon-btn hide-narrow" data-act="sidebar" title="페이지 미리보기">${icon("pages")}</button>
          <input class="title-input" value="" aria-label="노트 제목" />
        </div>
        <div class="tb-group tools">
          <button class="icon-btn tool" data-tool="pen" title="펜">${icon("pen")}</button>
          <button class="icon-btn tool" data-tool="hl" title="형광펜">${icon("hl")}</button>
          <button class="icon-btn tool" data-tool="eraser" title="지우개">${icon("eraser")}</button>
          <button class="icon-btn tool" data-tool="select" title="선택·이동 (첨부 옮기기)">${icon("select")}</button>
          <span class="sep"></span>
          <span class="swatches"></span>
          <span class="sizes"></span>
        </div>
        <div class="tb-group tb-right">
          <button class="icon-btn" data-act="add" title="추가 (사진, PDF, 파일, 페이지)">${icon("plus")}</button>
          <button class="icon-btn" data-act="record" title="녹음 시작">${icon("mic")}</button>
          <button class="icon-btn" data-act="player" title="녹음 듣기">${icon("play")}</button>
          <button class="icon-btn hide-narrow" data-act="split" title="화면 분할">${icon("split")}</button>
          <button class="icon-btn" data-act="more" title="더보기">${icon("more")}</button>
        </div>
      </header>
      <div class="menu hidden" role="menu">
        <button data-act="pencil"></button>
        <button data-act="split-menu"></button>
        <button data-act="theme"></button>
        <button data-act="dark-pdf"></button>
        <button data-act="zoom-in">확대</button>
        <button data-act="zoom-out">축소</button>
        <button data-act="export">PDF로 내보내기</button>
      </div>
      <div class="menu addmenu hidden" role="menu">
        <button data-act="pick-image">${icon("image")}<span>사진 / 이미지</span></button>
        <button data-act="pick-pdf">${icon("doc")}<span>PDF 페이지 삽입</span></button>
        <button data-act="pick-file">${icon("clip")}<span>파일 첨부</span></button>
        <span class="menu-sep"></span>
        <button data-act="add-lined">${icon("lined")}<span>줄 페이지 추가</span></button>
        <button data-act="add-grid">${icon("grid")}<span>모눈 페이지 추가</span></button>
        <button data-act="add-blank">${icon("blank")}<span>무지 페이지 추가</span></button>
      </div>
      <input type="file" class="pick pick-image" accept="image/*" multiple hidden />
      <input type="file" class="pick pick-pdf" accept="application/pdf,.pdf" multiple hidden />
      <input type="file" class="pick pick-file" multiple hidden />
      <div class="recbar hidden">
        <span class="rec-dot"></span>
        <span class="rec-label">녹음 중</span>
        <span class="rec-clock">0:00</span>
        <span class="grow"></span>
        <button class="pill" data-act="rec-pause">${icon("pause")}<span>일시정지</span></button>
        <button class="pill stop" data-act="rec-stop">${icon("stop")}<span>정지</span></button>
      </div>
      <div class="playerbar hidden">
        <select class="rec-select" aria-label="녹음 선택"></select>
        <button class="icon-btn" data-act="toggle-play">${icon("play")}</button>
        <span class="time">0:00</span>
        <input class="seek" type="range" min="0" max="1000" value="0" aria-label="재생 위치" />
        <span class="dur">0:00</span>
        <button class="chip" data-act="speed">1x</button>
        <button class="chip on" data-act="replay" title="재생 위치 이후 필기를 흐리게 표시">리플레이</button>
        <button class="icon-btn danger" data-act="rec-delete" title="이 녹음 삭제">${icon("trash")}</button>
        <button class="icon-btn" data-act="close-player" title="닫기">${icon("close")}</button>
      </div>
      <div class="body">
        <nav class="sidebar" aria-label="페이지 미리보기"></nav>
        <div class="scroller"><div class="pages"></div></div>
        <button class="page-indicator" data-act="sidebar" title="페이지 미리보기"></button>
      </div>
      <div class="toast hidden"></div>`;
    const $ = (s) => this.root.querySelector(s);
    this.$ = $;
    this.scroller = $(".scroller");
    this.pagesEl = $(".pages");
    this.titleInput = $(".title-input");
    this.titleInput.value = this.doc.title;
    this.titleInput.addEventListener("change", () => {
      this.doc.title = this.titleInput.value.trim() || "제목 없음";
      this.dirty();
    });
    this.live = document.createElement("canvas");
    this.live.className = "live";

    this.root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tool) this.setTool(b.dataset.tool);
      else if (b.dataset.color) this.setColor(b.dataset.color);
      else if (b.dataset.size) this.setSize(Number(b.dataset.size));
      else if (b.dataset.act) this.action(b.dataset.act, b);
    });
    document.addEventListener("pointerdown", (this._menuCloser = (e) => {
      if (e.target.closest(".menu") || e.target.closest('[data-act="more"],[data-act="add"]')) return;
      this.root.querySelectorAll(".menu").forEach((m) => m.classList.add("hidden"));
    }));
    for (const kind of ["image", "pdf", "file"]) {
      const input = $(".pick-" + kind);
      input.addEventListener("change", () => {
        const files = [...input.files];
        input.value = "";
        if (files.length) this.insertFiles(kind, files);
      });
    }
    this.renderToolbar();

    this.pageViews = this.doc.pages.map((p) => this.makePageView(p));
    this.pageViews.forEach((pv) => this.pagesEl.appendChild(pv.el));

    // Player wiring.
    const a = this.player.audio;
    const seek = $(".seek");
    a.addEventListener("timeupdate", () => this.onTime());
    a.addEventListener("play", () => ($('[data-act="toggle-play"]').innerHTML = icon("pause")));
    a.addEventListener("pause", () => ($('[data-act="toggle-play"]').innerHTML = icon("play")));
    a.addEventListener("loadedmetadata", () => ($(".dur").textContent = fmtTime(this.player.duration)));
    seek.addEventListener("input", () => {
      this.player.seek((seek.value / 1000) * this.player.duration, !a.paused);
    });
    $(".rec-select").addEventListener("change", (e) => this.openPlayer(Number(e.target.value)));

    let lastW = 0;
    this._ro = new ResizeObserver(() => {
      const w = this.scroller.clientWidth;
      if (!w || Math.abs(w - lastW) < 2) return;
      lastW = w;
      clearTimeout(this._roT);
      this._roT = setTimeout(() => this.relayout(), 90);
    });
    this._ro.observe(this.scroller);
    this.root.addEventListener("pointerdown", () => (Editor.focused = this), true);
    this._offTheme = onThemeChange(() => {
      this.renderToolbar();
      this.pageViews.forEach((pv) => this.release(pv));
      this.updateVisible();
    });
    this._visibility = () => {
      if (!document.hidden) return;
      this.doc.view = this.currentView();
      this.saveNow();
    };
    document.addEventListener("visibilitychange", this._visibility);
  }

  renderToolbar() {
    const $ = this.$;
    this.root.querySelectorAll(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === this.tool));
    const sw = $(".swatches");
    const sz = $(".sizes");
    this.scroller?.classList.toggle("select-mode", this.tool === "select");
    if (this.tool !== "select") this.select(null);
    if (this.tool === "select") {
      sw.innerHTML = sz.innerHTML = "";
    } else if (this.tool === "eraser") {
      sw.innerHTML = [["partial", "부분 지우개"], ["stroke", "획 지우개"]]
        .map(([m, label]) => `<button class="chip${m === this.eraserMode ? " on" : ""}" data-act="eraser-mode" data-mode="${m}">${label}</button>`)
        .join("");
      sz.innerHTML = [0, 1, 2]
        .map((i) => `<button class="size${i === this.eraserSize ? " on" : ""}" data-act="eraser-size" data-n="${i}" aria-label="지우개 크기 ${i + 1}"><i style="--s:${5 + i * 6}px"></i></button>`)
        .join("");
    } else {
      const hl = this.tool === "hl";
      const cur = hl ? this.hlColor : this.penColor;
      sw.innerHTML = (hl ? HL_COLORS : COLORS)
        .map((c) => `<button class="swatch${c === cur ? " on" : ""}" data-color="${c}" style="--c:${c}" title="${COLOR_NAMES[c] || c}" aria-label="${COLOR_NAMES[c] || c}"></button>`)
        .join("");
      const curSize = hl ? this.hlSize : this.penSize;
      sz.innerHTML = [0, 1, 2]
        .map((i) => `<button class="size${i === curSize ? " on" : ""}" data-size="${i}" aria-label="굵기 ${i + 1}"><i style="--s:${4 + i * 4}px"></i></button>`)
        .join("");
    }
    $('[data-act="pencil"]').textContent = this.pencilOnly ? "✓ Apple Pencil로만 쓰기 (손가락은 스크롤)" : "Apple Pencil로만 쓰기 (꺼짐: 손가락으로도 필기)";
    this.scroller?.classList.toggle("finger-draw", !this.pencilOnly);
    $('[data-act="theme"]').textContent = `테마: ${THEME_LABEL[getTheme()]}`;
    $('[data-act="split-menu"]').textContent = this.isSplit() ? "분할 화면 닫기" : "화면 분할 (노트 2개 같이 보기)";
    $('[data-act="split"]').classList.toggle("on", this.isSplit());
    $('[data-act="dark-pdf"]').textContent = (darkPdf() ? "✓ " : "") + "다크 모드에서 PDF도 어둡게";
  }

  setTool(t) {
    this.tool = t;
    prefs.set("tool", t);
    this.renderToolbar();
  }
  setColor(c) {
    if (this.tool === "hl") prefs.set("hlColor", (this.hlColor = c));
    else prefs.set("penColor", (this.penColor = c));
    this.renderToolbar();
  }
  setSize(i) {
    if (this.tool === "hl") prefs.set("hlSize", (this.hlSize = i));
    else prefs.set("penSize", (this.penSize = i));
    this.renderToolbar();
  }

  async action(act, btn) {
    const menu = this.$(".menu:not(.addmenu)");
    const addMenu = this.$(".addmenu");
    switch (act) {
      case "back":
        await this.close();
        this.onExit();
        break;
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
      case "more":
        addMenu.classList.add("hidden");
        menu.classList.toggle("hidden");
        break;
      case "add":
        menu.classList.add("hidden");
        addMenu.classList.toggle("hidden");
        break;
      case "eraser-mode":
        prefs.set("eraserMode", (this.eraserMode = btn.dataset.mode));
        this.renderToolbar();
        break;
      case "eraser-size":
        prefs.set("eraserSize", (this.eraserSize = Number(btn.dataset.n)));
        this.renderToolbar();
        break;
      case "sidebar":
        this.toggleSidebar();
        break;
      case "split":
      case "split-menu":
        menu.classList.add("hidden");
        this.onSplit?.(this);
        break;
      case "goto-page": {
        const pv = this.pageViews[Number(btn.dataset.idx)];
        this.goToPage(Number(btn.dataset.idx));
        pv?.el.classList.remove("flash");
        void pv?.el.offsetWidth;
        pv?.el.classList.add("flash");
        if (this.root.clientWidth < 560) this.toggleSidebar(false);
        break;
      }
      case "rec-pause":
        this.toggleRecPause();
        break;
      case "rec-stop":
        this.stopRecording();
        break;
      case "pick-image":
      case "pick-pdf":
      case "pick-file":
        addMenu.classList.add("hidden");
        this.$("." + act).click();
        break;
      case "item-open":
        if (this.selected) openItem(this.selected).catch((err) => this.toast(err.message || String(err)));
        break;
      case "item-delete":
        if (this.selected) {
          const it = this.selected;
          this.removeItem(it);
          this.pushUndo({ type: "item-del", item: it });
        }
        break;
      case "pencil":
        this.pencilOnly = !this.pencilOnly;
        prefs.set("pencilOnly", this.pencilOnly);
        this.renderToolbar();
        break;
      case "add-lined":
      case "add-grid":
      case "add-blank":
        addMenu.classList.add("hidden");
        this.addPage(act.slice(4));
        break;
      case "theme":
        cycleTheme();
        break;
      case "dark-pdf":
        toggleDarkPdf();
        break;
      case "zoom-in":
        this.setZoom(this.zoom * 1.25);
        break;
      case "zoom-out":
        this.setZoom(this.zoom / 1.25);
        break;
      case "export":
        menu.classList.add("hidden");
        this.exportPdf();
        break;
      case "record":
        if (this.recorder.active) this.toggleRecPause();
        else this.startRecording();
        break;
      case "player":
        if (!this.doc.recordings.length) this.toast("녹음이 없어요. 마이크 버튼으로 녹음을 시작하세요.");
        else this.openPlayer(this.player.recording?.id ?? this.doc.recordings[this.doc.recordings.length - 1].id);
        break;
      case "toggle-play":
        if (this.player.audio.paused) this.player.audio.play().catch(() => {});
        else this.player.audio.pause();
        break;
      case "speed": {
        const rates = [1, 1.25, 1.5, 2, 0.75];
        const r = rates[(rates.indexOf(this.player.audio.playbackRate) + 1) % rates.length];
        this.player.audio.playbackRate = r;
        btn.textContent = r + "x";
        break;
      }
      case "replay":
        this.replay = !this.replay;
        btn.classList.toggle("on", this.replay);
        this.redrawVisible();
        break;
      case "rec-delete":
        this.deleteRecording();
        break;
      case "close-player":
        this.closePlayer();
        break;
    }
  }

  toast(msg, ms = 2600) {
    const t = this.$(".toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(this._toastT);
    if (ms) this._toastT = setTimeout(() => t.classList.add("hidden"), ms);
  }

  // ---------- pages & rendering ----------
  makePageView(page) {
    const el = document.createElement("div");
    el.className = "page";
    const bg = document.createElement("canvas");
    const ink = document.createElement("canvas");
    bg.className = "bg";
    ink.className = "ink";
    const items = document.createElement("div");
    items.className = "items";
    el.append(bg, items, ink);
    const pv = { page, el, bg, ink, items, rendered: false, pr: 1 };
    el._pv = pv;
    for (const it of this.doc.items) if (it.page === page.id) items.append(itemElement(it, page, this.urlFor));
    return pv;
  }

  urlFor = (key) => {
    if (!this.urls.has(key)) this.urls.set(key, getBlob(key).then((b) => (b ? URL.createObjectURL(b) : "")));
    return this.urls.get(key);
  };

  baseWidth() {
    return Math.min(this.scroller.clientWidth - 24, 1100);
  }

  layout() {
    const cssW = Math.round(this.baseWidth() * this.zoom);
    this.cssW = cssW;
    for (const pv of this.pageViews) {
      pv.cssW = cssW;
      pv.cssH = Math.round((cssW * pv.page.h) / pv.page.w);
      pv.el.style.width = cssW + "px";
      pv.el.style.height = pv.cssH + "px";
      this.release(pv);
    }
    this.updateVisible();
  }

  setZoom(z, focus) {
    z = Math.min(3, Math.max(0.6, z));
    const sc = this.scroller;
    const fx = focus ? focus.x : sc.clientWidth / 2;
    const fy = focus ? focus.y : sc.clientHeight / 2;
    const cx = (sc.scrollLeft + fx) / this.zoom, cy = (sc.scrollTop + fy) / this.zoom;
    this.zoom = z;
    this.layout();
    sc.scrollLeft = cx * z - fx;
    sc.scrollTop = cy * z - fy;
    this.updateVisible();
  }

  visiblePages(margin) {
    const sc = this.scroller;
    const top = sc.scrollTop - margin, bottom = sc.scrollTop + sc.clientHeight + margin;
    return this.pageViews.filter((pv) => pv.el.offsetTop + pv.cssH > top && pv.el.offsetTop < bottom);
  }

  updateVisible() {
    const h = this.scroller.clientHeight;
    const near = new Set(this.visiblePages(h));
    const keep = new Set(this.visiblePages(h * 2.5));
    for (const pv of this.pageViews) {
      if (near.has(pv)) {
        if (!pv.rendered) this.renderPage(pv);
      } else if (pv.rendered && !keep.has(pv)) this.release(pv);
    }
    this.updateIndicator();
  }

  // ---------- page sidebar, indicator, last position ----------
  buildSidebar() {
    const bar = this.$(".sidebar");
    this._thumbObs?.disconnect();
    bar.innerHTML = this.pageViews
      .map(
        (pv, i) => `<button class="thumb-item" data-act="goto-page" data-idx="${i}">
          <span class="thumb-box" style="aspect-ratio:${pv.page.w}/${pv.page.h}"><img alt="" /></span>
          <span class="thumb-num">${i + 1}</span></button>`
      )
      .join("");
    this._thumbVisible = new Set();
    this._thumbObs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const pv = this.pageViews[Number(e.target.dataset.idx)];
          if (!pv) continue;
          if (e.isIntersecting) {
            this._thumbVisible.add(pv.page.id);
            this.showThumb(pv, e.target);
          } else this._thumbVisible.delete(pv.page.id);
        }
      },
      { root: bar, rootMargin: "300px 0px" }
    );
    bar.querySelectorAll(".thumb-item").forEach((el) => this._thumbObs.observe(el));
    this._activeIdx = -1;
    this.updateIndicator();
  }

  thumbEl(pageId) {
    const i = this.pageViews.findIndex((pv) => pv.page.id === pageId);
    return i < 0 ? null : this.$(`.thumb-item[data-idx="${i}"]`);
  }

  // Renders thumbnails one at a time so PDF pages do not pile up in memory.
  showThumb(pv, el) {
    const t = this.thumbs.get(pv.page.id);
    if (t && !t.stale) {
      el.querySelector("img").src = t.url;
      return;
    }
    if (t?.pending) return;
    this.thumbs.set(pv.page.id, { ...t, pending: true });
    this._thumbQ = (this._thumbQ || Promise.resolve()).then(async () => {
      while (this.active || this.exporting) await new Promise((r) => setTimeout(r, 400));
      try {
        const c = await pageImage(this.doc, pv.page, 220);
        const url = c.toDataURL("image/jpeg", 0.7);
        c.width = c.height = 0;
        this.thumbs.set(pv.page.id, { url, stale: false });
        const img = this.thumbEl(pv.page.id)?.querySelector("img");
        if (img) img.src = url;
      } catch (e) {
        this.thumbs.delete(pv.page.id);
      }
    });
  }

  staleThumb(pageId) {
    const t = this.thumbs.get(pageId);
    if (t) t.stale = true;
    clearTimeout(this._thumbT);
    this._thumbT = setTimeout(() => {
      for (const id of this._thumbVisible || []) {
        if (this.thumbs.get(id)?.stale) {
          const el = this.thumbEl(id);
          if (el) this.showThumb(this.pvOf(id), el);
        }
      }
    }, 1200);
  }

  updateIndicator() {
    if (!this.pageViews.length || !this.$(".sidebar")) return;
    const i = this.pageViews.indexOf(this.currentPage().pv);
    this.$(".page-indicator").textContent = `${i + 1} / ${this.pageViews.length}`;
    if (i === this._activeIdx) return;
    this.$(".thumb-item.active")?.classList.remove("active");
    const el = this.$(`.thumb-item[data-idx="${i}"]`);
    el?.classList.add("active");
    if (el && this.sidebarOpen) el.scrollIntoView({ block: "nearest" });
    this._activeIdx = i;
  }

  goToPage(i, frac = 0) {
    const pv = this.pageViews[Math.min(Math.max(0, i), this.pageViews.length - 1)];
    if (!pv) return;
    this.scroller.scrollTop = pv.el.offsetTop - 12 + frac * pv.cssH;
    this.updateVisible();
  }

  // Re-lays out pages after a width change without losing the reading position.
  relayout() {
    if (!this.pageViews.length) return this.layout();
    const v = this.currentView();
    this.layout();
    this.goToPage(v.page, v.frac);
  }

  toggleSidebar(open = !this.sidebarOpen) {
    if (open === this.sidebarOpen) return;
    this.sidebarOpen = open;
    prefs.set("sidebar", open);
    this.$(".body").classList.toggle("sidebar-open", open);
    this.relayout();
    this._activeIdx = -1;
    this.updateIndicator();
  }

  currentView() {
    const { pv } = this.currentPage();
    return {
      page: this.pageViews.indexOf(pv),
      frac: Math.round(((this.scroller.scrollTop - pv.el.offsetTop + 12) / pv.cssH) * 1000) / 1000,
      zoom: this.zoom,
    };
  }

  restoreView() {
    const v = this.doc.view;
    if (v && this.pageViews[v.page]) this.goToPage(v.page, v.frac || 0);
  }

  // Remembers where you were; saved without touching the note's modified date.
  saveView() {
    clearTimeout(this._viewT);
    if (!this.pageViews.length) return;
    this.doc.view = this.currentView();
    putDoc(this.doc).catch(() => {});
  }

  release(pv) {
    pv.rendered = false;
    pv.bg.width = pv.bg.height = pv.ink.width = pv.ink.height = 0;
  }

  async renderPage(pv) {
    pv.rendered = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pr = Math.min(dpr, Math.sqrt(MAX_CANVAS_PX / (pv.cssW * pv.cssH)));
    pv.pr = pr;
    for (const c of [pv.bg, pv.ink]) {
      c.width = Math.round(pv.cssW * pr);
      c.height = Math.round(pv.cssH * pr);
    }
    const isPdf = pv.page.bg.type === "pdf";
    pv.bg.classList.toggle("inverted", isPdf && isDark() && darkPdf());
    pv.el.classList.toggle("dark", this.pageDark(pv));
    this.redrawInk(pv);
    await drawBackground(pv.bg, pv.page, isDark());
  }

  fadedFn() {
    const rec = this.player.recording;
    if (!rec || !this.replay) return undefined;
    const t = this.player.audio.currentTime;
    return (s) => s.audio && s.audio.rec === rec.id && s.audio.t > t;
  }

  // Dark paper: generated pages in dark mode, PDFs only when "PDF도 어둡게" is on.
  pageDark(pv) {
    return isDark() && (pv.page.bg.type !== "pdf" || darkPdf());
  }

  redrawInk(pv) {
    if (!pv.rendered) return;
    const ctx = pv.ink.getContext("2d");
    ctx.clearRect(0, 0, pv.ink.width, pv.ink.height);
    drawStrokes(ctx, this.byPage.get(pv.page.id) || [], pv.ink.width / pv.page.w, this.fadedFn(), this.pageDark(pv) ? darkInk : null);
  }

  redrawVisible() {
    for (const pv of this.pageViews) if (pv.rendered) this.redrawInk(pv);
  }

  pvOf(pageId) {
    return this.pageViews.find((pv) => pv.page.id === pageId);
  }

  addPage(type) {
    const page = newPage(type);
    this.doc.pages.push(page);
    this.byPage.set(page.id, []);
    const pv = this.makePageView(page);
    this.pageViews.push(pv);
    this.pagesEl.appendChild(pv.el);
    this.layout();
    this.buildSidebar();
    this.scroller.scrollTo({ top: pv.el.offsetTop - 12, behavior: "smooth" });
    this.dirty();
  }

  // ---------- strokes, undo ----------
  addStrokes(strokes, redraw = true) {
    for (const s of strokes) {
      this.doc.strokes.push(s);
      this.byPage.get(s.page).push(s);
    }
    if (redraw) this.afterChange(strokes);
  }
  removeStrokes(strokes, redraw = true) {
    const set = new Set(strokes);
    this.doc.strokes = this.doc.strokes.filter((s) => !set.has(s));
    for (const s of strokes) {
      const arr = this.byPage.get(s.page);
      arr.splice(arr.indexOf(s), 1);
    }
    if (redraw) this.afterChange(strokes);
  }
  afterChange(strokes) {
    for (const id of new Set(strokes.map((s) => s.page))) {
      this.scheduleRedraw(id);
      this.staleThumb(id);
    }
    this.dirty();
  }

  // Coalesces ink redraws to one per page per animation frame.
  scheduleRedraw(pageId) {
    (this._redraw ||= new Set()).add(pageId);
    if (this._redrawRaf) return;
    this._redrawRaf = requestAnimationFrame(() => {
      this._redrawRaf = 0;
      for (const id of this._redraw) {
        const pv = this.pvOf(id);
        if (pv) this.redrawInk(pv);
      }
      this._redraw.clear();
    });
  }
  pushUndo(op) {
    this.undoStack.push(op);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }
  applyOp(op, reverse) {
    switch (op.type) {
      case "add":
      case "remove":
        (op.type === "add") !== reverse ? this.addStrokes(op.strokes) : this.removeStrokes(op.strokes);
        break;
      case "replace":
        if (reverse) {
          this.removeStrokes(op.added);
          this.addStrokes(op.removed);
        } else {
          this.removeStrokes(op.removed);
          this.addStrokes(op.added);
        }
        break;
      case "item-add":
      case "item-del":
        (op.type === "item-add") !== reverse ? this.addItem(op.item) : this.removeItem(op.item);
        break;
      case "item-move":
        Object.assign(op.item, reverse ? op.from : op.to);
        this.refreshItem(op.item);
        this.dirty();
        break;
    }
  }
  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    this.applyOp(op, true);
    this.redoStack.push(op);
  }
  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    this.applyOp(op, false);
    this.undoStack.push(op);
  }

  // ---------- attachments ----------
  itemEl(item) {
    return this.pvOf(item.page)?.items.querySelector(`[data-id="${item.id}"]`);
  }
  addItem(item) {
    if (!this.doc.items.includes(item)) this.doc.items.push(item);
    const pv = this.pvOf(item.page);
    pv?.items.append(itemElement(item, pv.page, this.urlFor));
    this.staleThumb(item.page);
    this.dirty();
  }
  removeItem(item) {
    if (this.selected === item) this.select(null);
    this.doc.items = this.doc.items.filter((i) => i !== item);
    this.itemEl(item)?.remove();
    this.staleThumb(item.page);
    this.dirty();
  }
  refreshItem(item) {
    const el = this.itemEl(item);
    if (el) positionItem(el, item, this.pvOf(item.page).page);
    this.staleThumb(item.page);
  }
  select(item) {
    this.selected = item;
    this.root.querySelectorAll(".item.selected").forEach((e) => e.classList.remove("selected"));
    if (item) this.itemEl(item)?.classList.add("selected");
  }

  // The page nearest the middle of the screen, and the visible centre point on it.
  currentPage() {
    const sc = this.scroller;
    const mid = sc.scrollTop + sc.clientHeight / 2;
    let best = this.pageViews[0], bestD = Infinity;
    for (const pv of this.pageViews) {
      const t = pv.el.offsetTop, b = t + pv.cssH;
      const d = mid < t ? t - mid : mid > b ? mid - b : 0;
      if (d < bestD) (bestD = d), (best = pv);
    }
    const top = Math.max(best.el.offsetTop, sc.scrollTop);
    const bottom = Math.min(best.el.offsetTop + best.cssH, sc.scrollTop + sc.clientHeight);
    const cy = (((top + bottom) / 2 - best.el.offsetTop) / best.cssH) * best.page.h;
    return { pv: best, center: [best.page.w / 2, Math.min(Math.max(cy, 80), best.page.h - 80)] };
  }

  async insertFiles(kind, files) {
    if (!this.pageViews.length) this.addPage("lined");
    const { pv, center } = this.currentPage();
    let added = 0;
    for (const [i, f] of files.entries()) {
      try {
        this.toast(`추가하는 중… ${i + 1}/${files.length}`, 0);
        const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
        if (kind === "pdf" || (kind === "file" && isPdf && files.length === 1 && confirm(`"${f.name}"을(를) 필기할 수 있는 페이지로 넣을까요?\n취소를 누르면 파일로 첨부돼요.`))) {
          await this.insertPdfPages(f, pv);
        } else {
          const c = [center[0] + i * 24, center[1] + i * 24];
          const isImage = kind === "image" || (/^image\//.test(f.type) && kind !== "file");
          const item = isImage ? await makeImageItem(f, pv.page, c) : await makeFileItem(f, pv.page, c);
          this.addItem(item);
          this.pushUndo({ type: "item-add", item });
          if (kind !== "image" && !isImage) this.setTool("select");
          this.select(this.tool === "select" ? item : null);
        }
        added++;
      } catch (err) {
        console.error(err);
        this.toast(`${f.name} 추가 실패: ${err.message || err}`, 4000);
        return;
      }
    }
    this.toast(kind === "pdf" ? "PDF 페이지를 넣었어요." : `${added}개 첨부했어요. 선택 도구(화살표)로 옮기거나 크기를 바꿀 수 있어요.`);
  }

  async insertPdfPages(file, afterPv) {
    const { pdfPages } = await import("./import.js");
    const pages = await pdfPages(file);
    const at = this.pageViews.indexOf(afterPv) + 1;
    this.doc.pages.splice(at, 0, ...pages);
    const views = pages.map((p) => {
      this.byPage.set(p.id, []);
      return this.makePageView(p);
    });
    this.pageViews.splice(at, 0, ...views);
    const ref = this.pageViews[at + views.length]?.el || null;
    views.forEach((v) => this.pagesEl.insertBefore(v.el, ref));
    this.layout();
    this.buildSidebar();
    this.scroller.scrollTo({ top: views[0].el.offsetTop - 12, behavior: "smooth" });
    this.dirty();
  }

  // Select tool: drag items to move, drag the corner handle to resize.
  onItemDown(e, pv) {
    const el = e.target.closest(".item");
    if (e.target.closest(".item-bar")) return true; // buttons handle themselves
    if (!el) {
      this.select(null);
      return false;
    }
    const item = this.doc.items.find((i) => i.id === el.dataset.id);
    if (!item) return false;
    e.preventDefault();
    this.select(item);
    try {
      pv.el.setPointerCapture?.(e.pointerId);
    } catch {}
    this.active = {
      id: e.pointerId, pv, t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: false,
      item, mode: e.target.dataset.handle === "resize" ? "resize" : "move",
      start: this.pagePoint(pv, e), from: { x: item.x, y: item.y, w: item.w, h: item.h },
    };
    return true;
  }

  onItemMove(e) {
    const a = this.active;
    const [x, y] = this.pagePoint(a.pv, e);
    const dx = x - a.start[0], dy = y - a.start[1];
    const it = a.item, f = a.from, page = a.pv.page;
    if (a.mode === "move") {
      it.x = Math.min(Math.max(f.x + dx, -f.w * 0.8), page.w - f.w * 0.2);
      it.y = Math.min(Math.max(f.y + dy, -f.h * 0.8), page.h - f.h * 0.2);
    } else if (it.type === "image") {
      const w = Math.max(40, f.w + dx);
      it.w = w;
      it.h = (w * f.h) / f.w;
    } else {
      it.w = Math.max(160, f.w + dx);
    }
    this.refreshItem(it);
  }

  onItemUp(a) {
    const it = a.item;
    const to = { x: it.x, y: it.y, w: it.w, h: it.h };
    if (a.moved && JSON.stringify(to) !== JSON.stringify(a.from)) {
      this.pushUndo({ type: "item-move", item: it, from: a.from, to });
      this.dirty();
    }
  }


  // ---------- input ----------
  bindInput() {
    const sc = this.scroller;
    // Stop the Pencil from scrolling the page while fingers still scroll natively.
    const stylusGuard = (e) => {
      if (this.pencilOnly && [...e.touches].some((t) => t.touchType === "stylus")) e.preventDefault();
    };
    sc.addEventListener("touchstart", stylusGuard, { passive: false });
    sc.addEventListener("touchmove", stylusGuard, { passive: false });

    let raf = 0;
    sc.addEventListener("scroll", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), this.updateVisible()));
      clearTimeout(this._viewT);
      this._viewT = setTimeout(() => this.saveView(), 1000);
    });

    this.pagesEl.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (this._move = (e) => this.onMove(e)));
    window.addEventListener("pointerup", (this._up = (e) => this.onUp(e)));
    window.addEventListener("pointercancel", (this._cancel = (e) => this.onUp(e, true)));

    // Finger gestures: two-finger tap = undo, three-finger tap = redo,
    // swipe right from the left edge = open page sidebar, swipe left on it = close.
    let g = null;
    const fingers = (e) => [...e.touches].filter((t) => t.touchType !== "stylus");
    this.$(".body").addEventListener("touchstart", (e) => {
      const f = fingers(e);
      if (!f.length) return;
      if (!g) {
        const r = this.$(".body").getBoundingClientRect();
        g = { t0: performance.now(), n: 0, moved: false, x0: f[0].clientX, y0: f[0].clientY, edge: f[0].clientX - r.left - (this.sidebarOpen ? 132 : 0) < 28 };
      }
      g.n = Math.max(g.n, f.length);
    }, { passive: true });
    this.$(".body").addEventListener("touchmove", (e) => {
      if (!g) return;
      const t = fingers(e)[0];
      if (!t) return;
      const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
      if (Math.hypot(dx, dy) > 12) g.moved = true;
      if (g.n === 1 && Math.abs(dx) > 70 && Math.abs(dy) < 40) {
        if (dx > 0 && g.edge && !this.sidebarOpen) this.toggleSidebar(true), (g.n = 9);
        else if (dx < 0 && this.sidebarOpen && e.target.closest(".sidebar")) this.toggleSidebar(false), (g.n = 9);
      }
    }, { passive: true });
    this.$(".body").addEventListener("touchend", (e) => {
      if (!g || e.touches.length) return;
      const tap = !g.moved && performance.now() - g.t0 < 320;
      if (tap && g.n === 2) (this.undo(), this.toast("실행 취소", 900));
      else if (tap && g.n === 3) (this.redo(), this.toast("다시 실행", 900));
      g = null;
    });
    this.$(".body").addEventListener("touchcancel", () => (g = null));

    // Pinch zoom with two fingers.
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    sc.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2 && ![...e.touches].some((t) => t.touchType === "stylus")) {
        this.cancelStroke();
        const r = sc.getBoundingClientRect();
        pinch = {
          d: dist(e.touches),
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
          k: 1,
        };
        this.pagesEl.style.transformOrigin = `${sc.scrollLeft + pinch.x}px ${sc.scrollTop + pinch.y}px`;
      }
    });
    sc.addEventListener("touchmove", (e) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        pinch.k = dist(e.touches) / pinch.d;
        this.pagesEl.style.transform = `scale(${pinch.k})`;
      }
    }, { passive: false });
    const endPinch = () => {
      if (!pinch) return;
      const p = pinch;
      pinch = null;
      this.pagesEl.style.transform = "";
      if (Math.abs(p.k - 1) > 0.03) this.setZoom(this.zoom * p.k, p);
    };
    sc.addEventListener("touchend", (e) => e.touches.length < 2 && endPinch());
    sc.addEventListener("touchcancel", endPinch);
    // Trackpad / ctrl+wheel zoom.
    sc.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      this.setZoom(this.zoom * Math.exp(-e.deltaY / 200), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });

    window.addEventListener("keydown", (this._key = (e) => {
      if (Editor.focused !== this || e.target.matches?.("input, select, textarea")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
      }
    }));
  }

  canDraw(e) {
    if (e.pointerType === "pen" || e.pointerType === "mouse") return true;
    return !this.pencilOnly;
  }

  pagePoint(pv, e) {
    const r = pv.el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * pv.page.w, ((e.clientY - r.top) / r.height) * pv.page.h];
  }

  onDown(e) {
    const pageEl = e.target.closest(".page");
    if (!pageEl || this.active) return;
    const pv = pageEl._pv;
    if (this.tool === "select" && e.button === 0) {
      if (this.onItemDown(e, pv)) return;
      if (e.pointerType === "touch") return; // finger on empty space: scroll
    }
    const draw = this.canDraw(e) && e.button === 0 && this.tool !== "select";
    this.active = { id: e.pointerId, pv, t0: performance.now(), x0: e.clientX, y0: e.clientY, draw, moved: false };
    if (!draw) return; // finger: maybe a tap on ink while playing back
    e.preventDefault();
    try {
      pageEl.setPointerCapture?.(e.pointerId);
    } catch {}
    if (this.tool === "eraser") {
      this.active.erase = { removed: [], added: new Set() };
      this.live.width = pv.ink.width;
      this.live.height = pv.ink.height;
      pv.el.appendChild(this.live);
      this.eraseAt(pv, this.pagePoint(pv, e));
      return;
    }
    const hl = this.tool === "hl";
    const s = {
      id: uid(),
      page: pv.page.id,
      tool: hl ? "hl" : "pen",
      color: hl ? this.hlColor : this.penColor,
      width: hl ? HL_SIZES[this.hlSize] : PEN_SIZES[this.penSize],
      pts: [],
      audio: this.recorder.active && !this.recorder.paused ? { rec: this.recorder.id, t: Math.round(this.recorder.now() * 100) / 100 } : null,
    };
    this.active.stroke = s;
    this.addPoint(pv, e);
    this.live.width = pv.ink.width;
    this.live.height = pv.ink.height;
    pv.el.appendChild(this.live);
    this.drawLive();
  }

  addPoint(pv, e) {
    const s = this.active.stroke;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = this.pagePoint(pv, ev);
      const n = s.pts.length;
      if (n && Math.hypot(s.pts[n - 3] - x, s.pts[n - 2] - y) < 0.4) continue;
      let p = ev.pointerType === "pen" ? ev.pressure : 0.5;
      if (!p) p = 0.5;
      s.pts.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(p * 100) / 100);
    }
  }

  drawLive() {
    if (this._liveRaf) return;
    this._liveRaf = requestAnimationFrame(() => {
      this._liveRaf = 0;
      const a = this.active;
      if (!a?.stroke) return;
      const ctx = this.live.getContext("2d");
      const s = a.stroke;
      const scale = this.live.width / a.pv.page.w;
      const color = this.pageDark(a.pv) ? darkInk : null;
      const n = s.pts.length / 3;
      if (s.tool === "hl" || n < 3) {
        // Highlighter is translucent, so it is redrawn as one path.
        ctx.clearRect(0, 0, this.live.width, this.live.height);
        drawStroke(ctx, s, scale, false, color);
        a.liveDone = 0;
        return;
      }
      // Pen: only draw segments that became final since the last frame.
      if (!a.liveDone) ctx.clearRect(0, 0, this.live.width, this.live.height);
      ctx.save();
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = color ? color(s.color) : s.color;
      drawPenRange(ctx, s, scale, (a.liveDone || 0) + 1, n - 2);
      ctx.restore();
      a.liveDone = n - 2;
    });
  }

  // Erases at a page point. Partial mode cuts strokes; stroke mode removes whole strokes.
  // Tracks what this drag removed/added so it undoes as one step.
  eraseAt(pv, [x, y]) {
    const er = this.active.erase;
    const r = ERASER_SIZES[this.eraserSize];
    this.drawEraserCursor(pv, x, y, r);
    const strokes = this.byPage.get(pv.page.id) || [];
    const removed = [], added = [];
    for (const s of strokes) {
      if (this.eraserMode === "stroke") {
        if (hitStroke(s, x, y, r)) removed.push(s);
        continue;
      }
      const pieces = cutStroke(s, x, y, r);
      if (!pieces) continue;
      removed.push(s);
      for (const pts of pieces) added.push({ ...s, id: uid(), pts });
    }
    if (!removed.length) return;
    this.removeStrokes(removed, false);
    if (added.length) this.addStrokes(added, false);
    for (const s of removed) er.added.has(s) ? er.added.delete(s) : er.removed.push(s);
    for (const s of added) er.added.add(s);
    this.afterChange([...removed, ...added]);
  }

  drawEraserCursor(pv, x, y, r) {
    const ctx = this.live.getContext("2d");
    const k = this.live.width / pv.page.w;
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    ctx.beginPath();
    ctx.arc(x * k, y * k, r * k, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(120,120,120,0.12)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, k);
    ctx.strokeStyle = "rgba(90,90,90,0.7)";
    ctx.stroke();
  }

  onMove(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 8) a.moved = true;
    if (a.item) {
      e.preventDefault();
      if (a.moved) this.onItemMove(e);
      return;
    }
    if (!a.draw) return;
    e.preventDefault();
    if (this.tool === "eraser" && a.erase) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) this.eraseAt(a.pv, this.pagePoint(a.pv, ev));
    } else if (a.stroke) {
      this.addPoint(a.pv, e);
      this.drawLive();
    }
  }

  onUp(e, cancelled = false) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    this.live.remove();
    const quickTap = !a.moved && performance.now() - a.t0 < 350;
    if (a.item) {
      if (cancelled) {
        Object.assign(a.item, a.from);
        this.refreshItem(a.item);
      } else this.onItemUp(a);
      return;
    }
    if (!cancelled && quickTap && this.player.recording && this.seekToInk(a.pv, this.pagePoint(a.pv, e))) return;
    // Finger tap on an attached file opens it.
    if (!cancelled && quickTap && !a.draw) {
      const [x, y] = this.pagePoint(a.pv, e);
      const it = this.doc.items.findLast?.((i) => i.page === a.pv.page.id && i.type === "file" && hitItem(i, x, y));
      if (it) {
        openItem(it).catch((err) => this.toast(err.message || String(err)));
        return;
      }
    }
    if (cancelled) return;
    if (a.erase && (a.erase.removed.length || a.erase.added.size)) {
      this.pushUndo({ type: "replace", removed: a.erase.removed, added: [...a.erase.added] });
    }
    if (a.stroke && a.stroke.pts.length) {
      const s = a.stroke;
      this.addStrokes([s], false);
      if (s.tool === "pen" && a.pv.rendered && !this.fadedFn()?.(s)) {
        drawStroke(a.pv.ink.getContext("2d"), s, a.pv.ink.width / a.pv.page.w, false, this.pageDark(a.pv) ? darkInk : null);
      } else this.scheduleRedraw(s.page);
      this.staleThumb(s.page);
      this.dirty();
      this.pushUndo({ type: "add", strokes: [s] });
    }
  }

  cancelStroke() {
    if (this.active?.stroke) {
      this.live.remove();
      this.active = null;
    }
  }

  // ---------- audio ----------
  async startRecording() {
    try {
      if (this.player.recording) this.player.audio.pause();
      const id = this.doc.nextRec++;
      await this.recorder.start(id);
      this.$(".recbar").classList.remove("hidden");
      this.updateRecUI();
      this._recTimer = setInterval(() => this.updateRecUI(), 500);
      this.toast("녹음 중이에요. 지금 쓰는 필기가 녹음 시점과 연결돼요.");
    } catch (err) {
      this.doc.nextRec--;
      this.toast("마이크를 사용할 수 없어요: " + (err.message || err), 4000);
    }
  }

  toggleRecPause() {
    if (!this.recorder.active) return;
    this.recorder.paused ? this.recorder.resume() : this.recorder.pause();
    this.updateRecUI();
  }

  async stopRecording() {
    if (!this.recorder.active) return;
    clearInterval(this._recTimer);
    this.$(".recbar").classList.add("hidden");
    this.$('[data-act="record"]').classList.remove("recording");
    const entry = await this.recorder.stop();
    if (entry) {
      this.doc.recordings.push(entry);
      this.dirty();
      this.toast(`${entry.name} 저장됨 (${fmtTime(entry.duration)}). ▶ 버튼으로 들을 수 있어요.`);
    }
  }

  updateRecUI() {
    const paused = this.recorder.paused;
    const bar = this.$(".recbar");
    bar.classList.toggle("paused", paused);
    bar.querySelector(".rec-label").textContent = paused ? "일시정지됨" : "녹음 중";
    bar.querySelector(".rec-clock").textContent = fmtTime(this.recorder.now());
    bar.querySelector('[data-act="rec-pause"]').innerHTML = paused
      ? `${icon("rec")}<span>계속 녹음</span>`
      : `${icon("pause")}<span>일시정지</span>`;
    const mic = this.$('[data-act="record"]');
    mic.classList.toggle("recording", !paused);
    mic.title = paused ? "녹음 계속" : "녹음 일시정지";
  }

  async openPlayer(recId) {
    const rec = this.doc.recordings.find((r) => r.id === recId);
    if (!rec) return;
    const bar = this.$(".playerbar");
    const sel = this.$(".rec-select");
    sel.innerHTML = this.doc.recordings
      .map((r) => `<option value="${r.id}"${r.id === recId ? " selected" : ""}>${r.name} (${fmtTime(r.duration)})</option>`)
      .join("");
    bar.classList.remove("hidden");

    await this.player.load(rec);
    this.$(".dur").textContent = fmtTime(this.player.duration);
    this.onTime();
    this.toast("필기를 탭하면 그때 녹음된 부분부터 재생돼요.");
  }

  async deleteRecording() {
    const rec = this.player.recording;
    if (!rec) return;
    const linked = this.doc.strokes.filter((s) => s.audio?.rec === rec.id).length;
    const msg = `"${rec.name}" (${fmtTime(rec.duration)}) 녹음을 삭제할까요?` +
      (linked ? `\n필기 ${linked}개는 그대로 남고, 녹음 연결만 사라져요.` : "") + "\n되돌릴 수 없어요.";
    if (!confirm(msg)) return;
    this.closePlayer();
    this.doc.recordings = this.doc.recordings.filter((r) => r !== rec);
    for (const s of this.doc.strokes) if (s.audio?.rec === rec.id) s.audio = null;
    for (const op of [...this.undoStack, ...this.redoStack]) {
      for (const s of [...(op.strokes || []), ...(op.added || []), ...(op.removed || [])]) if (s.audio?.rec === rec.id) s.audio = null;
    }
    await deleteBlob(rec.blob).catch(() => {});
    this.dirty();
    this.toast(`"${rec.name}" 삭제됨`);
  }

  closePlayer() {
    this.player.close();
    this.$(".playerbar").classList.add("hidden");

    this.redrawVisible();
  }

  onTime() {
    const a = this.player.audio;
    const d = this.player.duration;
    this.$(".time").textContent = fmtTime(a.currentTime);
    this.$(".seek").value = d ? Math.round((a.currentTime / d) * 1000) : 0;
    if (this.replay) {
      const now = performance.now();
      if (now - (this._lastReplay || 0) > 200) {
        this._lastReplay = now;
        this.redrawVisible();
      }
    }
  }

  // Tap on ink while the player is open: jump to when it was written.
  seekToInk(pv, [x, y]) {
    const r = 14 / Math.max(1, this.zoom);
    const hits = (this.byPage.get(pv.page.id) || []).filter((s) => s.audio && hitStroke(s, x, y, r));
    if (!hits.length) return false;
    const s = hits.reduce((best, h) => {
      const [x0, y0, x1, y1] = bbox(h);
      const d = Math.hypot((x0 + x1) / 2 - x, (y0 + y1) / 2 - y);
      return d < best.d ? { s: h, d } : best;
    }, { s: null, d: Infinity }).s;
    const go = async () => {
      if (this.player.recording?.id !== s.audio.rec) await this.openPlayer(s.audio.rec);
      this.player.seek(Math.max(0, s.audio.t - 1.5));
    };
    go();
    return true;
  }

  // ---------- persistence ----------
  dirty() {
    this.doc.modified = Date.now();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => (this.active ? this.dirty() : this.saveNow()), 1500);
  }

  async saveNow(withThumb = false) {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await putDoc(this.doc);
    const thumb = withThumb ? await makeThumb(this.doc) : this._thumb;
    this._thumb = thumb;
    await putNote(noteMeta(this.doc, thumb));
  }

  async exportPdf() {
    try {
      this.exporting = true;
      this.toast("PDF 만드는 중…", 0);
      const blob = await exportPdf(this.doc, (i, n) => this.toast(`PDF 만드는 중… ${i}/${n}`, 0));
      const name = (this.doc.title || "note").replace(/[\\/:*?"<>|]/g, "_") + ".pdf";
      const file = new File([blob], name, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        this.toast("공유 시트에서 저장 위치를 고르세요.");
        await navigator.share({ files: [file], title: name }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        this.toast("PDF를 저장했어요.");
      }
    } catch (err) {
      this.toast("내보내기 실패: " + (err.message || err), 4000);
    } finally {
      this.exporting = false;
    }
  }

  async close() {
    await this.stopRecording();
    this.saveView();
    this.player.close();
    await this.saveNow(true);
    this._ro.disconnect();
    clearTimeout(this._roT);
    window.removeEventListener("pointermove", this._move);
    window.removeEventListener("pointerup", this._up);
    window.removeEventListener("pointercancel", this._cancel);
    window.removeEventListener("keydown", this._key);
    document.removeEventListener("pointerdown", this._menuCloser);
    document.removeEventListener("visibilitychange", this._visibility);
    this._offTheme();
    this._thumbObs?.disconnect();
    this.pageViews.forEach((pv) => this.release(pv));
    for (const p of this.urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
  }
}
