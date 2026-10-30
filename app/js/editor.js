// Note editor: page views, Apple Pencil input, tools, undo, audio recording/playback sync.
import { drawStroke, drawStrokes, hitStroke, bbox } from "./ink.js";
import { drawBackground, exportPdf, makeThumb } from "./render.js";
import { Recorder, Player, fmtTime } from "./audio.js";
import { putDoc, putNote, uid } from "./db.js";
import { newPage, noteMeta } from "./model.js";
import { icon } from "./icons.js";

const COLORS = ["#1c1c1e", "#0a63d8", "#d93025", "#1e8e3e", "#f29900"];
const HL_COLORS = ["#ffe03d", "#7ce38b", "#7cc6ff", "#ff8fc7"];
const PEN_SIZES = [1.6, 2.6, 4.2];
const HL_SIZES = [12, 20, 30];
const MAX_CANVAS_PX = 3.5e6; // per canvas; iPad Safari has a tight total canvas memory budget
const ERASER_R = 10;

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
  constructor(root, doc, { onExit }) {
    this.root = root;
    this.doc = doc;
    this.onExit = onExit;
    this.tool = prefs.get("tool", "pen");
    this.penColor = prefs.get("penColor", COLORS[0]);
    this.hlColor = prefs.get("hlColor", HL_COLORS[0]);
    this.penSize = prefs.get("penSize", 1);
    this.hlSize = prefs.get("hlSize", 1);
    this.pencilOnly = prefs.get("pencilOnly", true);
    this.zoom = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.byPage = new Map(doc.pages.map((p) => [p.id, []]));
    for (const s of doc.strokes) this.byPage.get(s.page)?.push(s);
    this.recorder = new Recorder();
    this.player = new Player();
    this.replay = true;
    this.build();
    this.layout();
    this.bindInput();
    this.saveTimer = null;
  }

  // ---------- DOM ----------
  build() {
    this.root.innerHTML = `
      <header class="toolbar">
        <div class="tb-group">
          <button class="icon-btn" data-act="back" title="라이브러리">${icon("back")}</button>
          <input class="title-input" value="" aria-label="노트 제목" />
        </div>
        <div class="tb-group tools">
          <button class="icon-btn tool" data-tool="pen" title="펜">${icon("pen")}</button>
          <button class="icon-btn tool" data-tool="hl" title="형광펜">${icon("hl")}</button>
          <button class="icon-btn tool" data-tool="eraser" title="지우개">${icon("eraser")}</button>
          <span class="sep"></span>
          <span class="swatches"></span>
          <span class="sizes"></span>
        </div>
        <div class="tb-group">
          <button class="icon-btn" data-act="undo" title="실행 취소">${icon("undo")}</button>
          <button class="icon-btn" data-act="redo" title="다시 실행">${icon("redo")}</button>
          <button class="icon-btn" data-act="record" title="녹음">${icon("mic")}<span class="rec-time"></span></button>
          <button class="icon-btn" data-act="player" title="녹음 듣기">${icon("play")}</button>
          <button class="icon-btn" data-act="more" title="더보기">${icon("more")}</button>
        </div>
      </header>
      <div class="menu hidden" role="menu">
        <button data-act="pencil"></button>
        <button data-act="add-lined">줄 페이지 추가</button>
        <button data-act="add-grid">모눈 페이지 추가</button>
        <button data-act="add-blank">무지 페이지 추가</button>
        <button data-act="zoom-in">확대</button>
        <button data-act="zoom-out">축소</button>
        <button data-act="export">PDF로 내보내기</button>
      </div>
      <div class="scroller"><div class="pages"></div></div>
      <div class="playerbar hidden">
        <select class="rec-select" aria-label="녹음 선택"></select>
        <button class="icon-btn" data-act="toggle-play">${icon("play")}</button>
        <span class="time">0:00</span>
        <input class="seek" type="range" min="0" max="1000" value="0" aria-label="재생 위치" />
        <span class="dur">0:00</span>
        <button class="chip" data-act="speed">1x</button>
        <button class="chip on" data-act="replay" title="재생 위치 이후 필기를 흐리게 표시">리플레이</button>
        <button class="icon-btn" data-act="close-player" title="닫기">${icon("close")}</button>
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
      if (!e.target.closest(".menu") && !e.target.closest('[data-act="more"]')) $(".menu").classList.add("hidden");
    }));
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

    this._resize = () => this.layout();
    window.addEventListener("resize", this._resize);
    this._visibility = () => document.hidden && this.saveNow();
    document.addEventListener("visibilitychange", this._visibility);
  }

  renderToolbar() {
    const $ = this.$;
    this.root.querySelectorAll(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === this.tool));
    const sw = $(".swatches");
    const sz = $(".sizes");
    if (this.tool === "eraser") {
      sw.innerHTML = sz.innerHTML = "";
    } else {
      const hl = this.tool === "hl";
      const cur = hl ? this.hlColor : this.penColor;
      sw.innerHTML = (hl ? HL_COLORS : COLORS)
        .map((c) => `<button class="swatch${c === cur ? " on" : ""}" data-color="${c}" style="--c:${c}" aria-label="색 ${c}"></button>`)
        .join("");
      const curSize = hl ? this.hlSize : this.penSize;
      sz.innerHTML = [0, 1, 2]
        .map((i) => `<button class="size${i === curSize ? " on" : ""}" data-size="${i}" aria-label="굵기 ${i + 1}"><i style="--s:${4 + i * 4}px"></i></button>`)
        .join("");
    }
    $('[data-act="pencil"]').textContent = this.pencilOnly ? "✓ Apple Pencil로만 쓰기 (손가락은 스크롤)" : "Apple Pencil로만 쓰기 (꺼짐: 손가락으로도 필기)";
    this.scroller?.classList.toggle("finger-draw", !this.pencilOnly);
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
    const menu = this.$(".menu");
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
        menu.classList.toggle("hidden");
        break;
      case "pencil":
        this.pencilOnly = !this.pencilOnly;
        prefs.set("pencilOnly", this.pencilOnly);
        this.renderToolbar();
        break;
      case "add-lined":
      case "add-grid":
      case "add-blank":
        menu.classList.add("hidden");
        this.addPage(act.slice(4));
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
        this.toggleRecord(btn);
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
    el.append(bg, ink);
    const pv = { page, el, bg, ink, rendered: false, pr: 1 };
    el._pv = pv;
    return pv;
  }

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
    const near = new Set(this.visiblePages(this.scroller.clientHeight * 0.75));
    for (const pv of this.pageViews) {
      if (near.has(pv)) {
        if (!pv.rendered) this.renderPage(pv);
      } else if (pv.rendered) this.release(pv);
    }
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
    this.redrawInk(pv);
    await drawBackground(pv.bg, pv.page);
  }

  fadedFn() {
    const rec = this.player.recording;
    if (!rec || !this.replay) return undefined;
    const t = this.player.audio.currentTime;
    return (s) => s.audio && s.audio.rec === rec.id && s.audio.t > t;
  }

  redrawInk(pv) {
    if (!pv.rendered) return;
    const ctx = pv.ink.getContext("2d");
    ctx.clearRect(0, 0, pv.ink.width, pv.ink.height);
    drawStrokes(ctx, this.byPage.get(pv.page.id) || [], pv.ink.width / pv.page.w, this.fadedFn());
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
    this.scroller.scrollTo({ top: pv.el.offsetTop - 12, behavior: "smooth" });
    this.dirty();
  }

  // ---------- strokes, undo ----------
  addStrokes(strokes) {
    for (const s of strokes) {
      this.doc.strokes.push(s);
      this.byPage.get(s.page).push(s);
    }
    this.afterChange(strokes);
  }
  removeStrokes(strokes) {
    const set = new Set(strokes);
    this.doc.strokes = this.doc.strokes.filter((s) => !set.has(s));
    for (const s of strokes) {
      const arr = this.byPage.get(s.page);
      arr.splice(arr.indexOf(s), 1);
    }
    this.afterChange(strokes);
  }
  afterChange(strokes) {
    for (const id of new Set(strokes.map((s) => s.page))) {
      const pv = this.pvOf(id);
      if (pv) this.redrawInk(pv);
    }
    this.dirty();
  }
  pushUndo(op) {
    this.undoStack.push(op);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    op.type === "add" ? this.removeStrokes(op.strokes) : this.addStrokes(op.strokes);
    this.redoStack.push(op);
  }
  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    op.type === "add" ? this.addStrokes(op.strokes) : this.removeStrokes(op.strokes);
    this.undoStack.push(op);
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
    });

    this.pagesEl.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (this._move = (e) => this.onMove(e)));
    window.addEventListener("pointerup", (this._up = (e) => this.onUp(e)));
    window.addEventListener("pointercancel", (this._cancel = (e) => this.onUp(e, true)));

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
    const draw = this.canDraw(e) && e.button === 0;
    this.active = { id: e.pointerId, pv, t0: performance.now(), x0: e.clientX, y0: e.clientY, draw, moved: false };
    if (!draw) return; // finger: maybe a tap on ink while playing back
    e.preventDefault();
    try {
      pageEl.setPointerCapture?.(e.pointerId);
    } catch {}
    if (this.tool === "eraser") {
      this.active.erased = [];
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
      audio: this.recorder.active ? { rec: this.recorder.id, t: Math.round(this.recorder.now() * 100) / 100 } : null,
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
      ctx.clearRect(0, 0, this.live.width, this.live.height);
      drawStroke(ctx, a.stroke, this.live.width / a.pv.page.w);
    });
  }

  eraseAt(pv, [x, y]) {
    const r = ERASER_R / Math.max(1, this.zoom);
    const hits = (this.byPage.get(pv.page.id) || []).filter((s) => hitStroke(s, x, y, r));
    if (hits.length) {
      this.active.erased.push(...hits);
      this.removeStrokes(hits);
    }
  }

  onMove(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 8) a.moved = true;
    if (!a.draw) return;
    e.preventDefault();
    if (this.tool === "eraser" && a.erased) {
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
    if (!cancelled && quickTap && this.player.recording && this.seekToInk(a.pv, this.pagePoint(a.pv, e))) return;
    if (cancelled) return;
    if (a.erased?.length) this.pushUndo({ type: "remove", strokes: a.erased });
    if (a.stroke && a.stroke.pts.length) {
      this.addStrokes([a.stroke]);
      this.pushUndo({ type: "add", strokes: [a.stroke] });
    }
  }

  cancelStroke() {
    if (this.active?.stroke) {
      this.live.remove();
      this.active = null;
    }
  }

  // ---------- audio ----------
  async toggleRecord(btn) {
    if (this.recorder.active) {
      clearInterval(this._recTimer);
      btn.classList.remove("recording");
      btn.querySelector(".rec-time").textContent = "";
      const entry = await this.recorder.stop();
      if (entry) {
        this.doc.recordings.push(entry);
        this.dirty();
        this.toast(`${entry.name} 저장됨 (${fmtTime(entry.duration)})`);
      }
      return;
    }
    try {
      if (this.player.recording) this.player.audio.pause();
      const id = this.doc.nextRec++;
      await this.recorder.start(id);
      btn.classList.add("recording");
      const label = btn.querySelector(".rec-time");
      label.textContent = "0:00";
      this._recTimer = setInterval(() => (label.textContent = fmtTime(this.recorder.now())), 500);
      this.toast("녹음 중이에요. 지금 쓰는 필기가 녹음 시점과 연결돼요.");
    } catch (err) {
      this.doc.nextRec--;
      this.toast("마이크를 사용할 수 없어요: " + (err.message || err), 4000);
    }
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
    this.root.classList.add("with-player");
    await this.player.load(rec);
    this.$(".dur").textContent = fmtTime(this.player.duration);
    this.onTime();
    this.toast("필기를 탭하면 그때 녹음된 부분부터 재생돼요.");
  }

  closePlayer() {
    this.player.close();
    this.$(".playerbar").classList.add("hidden");
    this.root.classList.remove("with-player");
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
    this.saveTimer = setTimeout(() => this.saveNow(), 800);
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
    }
  }

  async close() {
    if (this.recorder.active) await this.toggleRecord(this.$('[data-act="record"]'));
    this.player.close();
    await this.saveNow(true);
    window.removeEventListener("resize", this._resize);
    window.removeEventListener("pointermove", this._move);
    window.removeEventListener("pointerup", this._up);
    window.removeEventListener("pointercancel", this._cancel);
    window.removeEventListener("keydown", this._key);
    document.removeEventListener("pointerdown", this._menuCloser);
    document.removeEventListener("visibilitychange", this._visibility);
    this.pageViews.forEach((pv) => this.release(pv));
  }
}
