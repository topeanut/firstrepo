/* Paper — 광고 없는 모바일 PDF 뷰어 & 에디터
 * 모든 처리는 브라우저 안에서만 이루어집니다. (서버 전송 없음)
 * 렌더링: PDF.js / 편집·저장: pdf-lib
 */
(function () {
  'use strict';

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  var ANNO = 2;          // 주석 캔버스 해상도 배율(페이지 포인트 기준)
  var MAX_W = 1100;      // 100%(폭 맞춤) 기준 최대 폭
  var PAD = 10;

  // ---- 상태 ----
  var S = {
    fileName: 'document.pdf',
    srcBytes: null,
    doc: null,            // pdf.js 문서
    pages: [],            // 표시 순서의 PageModel 배열
    zoom: 1,
    tool: 'pan',
    color: '#111418',
    size: 4,
    night: false,
    activePage: null,     // 마지막으로 그린 페이지(실행취소 대상)
    dirty: false,
  };

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var viewer = $('viewer'), pagesEl = $('pages'), thumbsEl = $('thumbs');
  var fileInput = $('fileInput'), toolbar = $('toolbar'), drawer = $('drawer'), scrim = $('scrim');

  // ---- 유틸 ----
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2200);
  }
  function spin(on, text) {
    var s = $('spinner'); if (text) $('spinnerText').textContent = text; s.hidden = !on;
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function targetW() { return Math.min(viewer.clientWidth - PAD * 2, MAX_W) * S.zoom; }

  // ---- 테마 ----
  function initTheme() {
    var saved = lsGet('paper.theme', 'auto');
    document.body.setAttribute('data-theme', saved === 'auto' ? 'auto' : saved);
    document.documentElement.removeAttribute('data-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
    S.night = lsGet('paper.night', '0') === '1';
    document.body.classList.toggle('night', S.night);
    S.color = lsGet('paper.color', S.color);
    S.size = parseInt(lsGet('paper.size', S.size), 10) || S.size;
  }

  // =====================================================================
  //  파일 열기
  // =====================================================================
  function openFile(file) {
    if (!file) return;
    if (file.type && file.type.indexOf('pdf') === -1 && !/\.pdf$/i.test(file.name)) {
      toast('PDF 파일만 열 수 있어요.'); return;
    }
    S.fileName = file.name || 'document.pdf';
    spin(true, '여는 중…');
    var reader = new FileReader();
    reader.onerror = function () { spin(false); toast('파일을 읽지 못했어요.'); };
    reader.onload = function () { loadBytes(new Uint8Array(reader.result)); };
    reader.readAsArrayBuffer(file);
  }

  function loadBytes(bytes) {
    S.srcBytes = bytes;
    var task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    task.promise.then(function (doc) {
      S.doc = doc;
      S.pages = [];
      for (var i = 0; i < doc.numPages; i++) {
        S.pages.push({ id: 'p' + i + '_' + Date.now(), src: i, rot: 0, strokes: [],
          page: null, w: 0, h: 0, box: null, inner: null, pdf: null, anno: null, rendered: false, renderTask: null });
      }
      return measureAll();
    }).then(function () {
      document.body.classList.add('has-doc');
      $('docTitle').textContent = S.fileName.replace(/\.pdf$/i, '');
      ['btnZoomIn', 'btnZoomOut', 'btnNight', 'btnSave'].forEach(function (id) { $(id).disabled = false; });
      S.dirty = false;
      buildPages();
      buildThumbs();
      spin(false);
      toast(S.doc.numPages + '쪽 · 편집 내용은 저장(내보내기) 시 반영됩니다.');
    }).catch(function (err) {
      console.error(err); spin(false); toast('PDF를 열지 못했어요. 손상되었거나 암호가 걸려 있을 수 있어요.');
    });
  }

  function measureAll() {
    // 각 페이지의 기본(배율 1) 크기를 미리 구해 레이아웃 높이를 확보
    var seq = Promise.resolve();
    S.pages.forEach(function (p) {
      seq = seq.then(function () {
        return S.doc.getPage(p.src + 1).then(function (pg) {
          p.page = pg;
          var vp = pg.getViewport({ scale: 1 });
          p.w = vp.width; p.h = vp.height;
        });
      });
    });
    return seq;
  }

  // =====================================================================
  //  본문 렌더링
  // =====================================================================
  var io = null;
  function setupObserver() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var p = e.target.__p;
        if (!p) return;
        if (e.isIntersecting) ensureRendered(p);
        else dropRender(p);
      });
    }, { root: viewer, rootMargin: '600px 0px 600px 0px', threshold: 0 });
  }

  function sizeBox(p) {
    var scale = targetW() / p.w;
    var cssW = targetW(), cssH = p.h * scale;
    var rot = ((p.rot % 360) + 360) % 360;
    var swap = (rot === 90 || rot === 270);
    p.box.style.width = (swap ? cssH : cssW) + 'px';
    p.box.style.height = (swap ? cssW : cssH) + 'px';
    p.inner.style.width = cssW + 'px';
    p.inner.style.height = cssH + 'px';
    p.inner.style.position = 'absolute';
    p.inner.style.left = '50%'; p.inner.style.top = '50%';
    p.inner.style.transform = 'translate(-50%,-50%) rotate(' + rot + 'deg)';
    p.pdf.style.width = cssW + 'px'; p.pdf.style.height = cssH + 'px';
    p.anno.style.width = cssW + 'px'; p.anno.style.height = cssH + 'px';
    p._cssW = cssW; p._cssH = cssH;
  }

  function buildPages() {
    setupObserver();
    pagesEl.innerHTML = '';
    S.pages.forEach(function (p, idx) {
      var box = document.createElement('div'); box.className = 'page-box'; box.__p = p;
      var inner = document.createElement('div'); inner.className = 'page-inner';
      var pdf = document.createElement('canvas');
      var anno = document.createElement('canvas'); anno.className = 'anno';
      anno.width = Math.max(1, Math.round(p.w * ANNO));
      anno.height = Math.max(1, Math.round(p.h * ANNO));
      var no = document.createElement('div'); no.className = 'page-no'; no.textContent = (idx + 1);
      inner.appendChild(pdf); inner.appendChild(anno);
      box.appendChild(inner); box.appendChild(no);
      pagesEl.appendChild(box);
      p.box = box; p.inner = inner; p.pdf = pdf; p.anno = anno; p.rendered = false;
      sizeBox(p);
      redrawAnno(p);
      bindDraw(p);
      io.observe(box);
    });
    updateToolUI();
  }

  function ensureRendered(p) {
    if (p.rendered || p._rendering) return;
    p._rendering = true;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var scale = (targetW() / p.w) * dpr;
    var vp = p.page.getViewport({ scale: scale });
    p.pdf.width = Math.ceil(vp.width); p.pdf.height = Math.ceil(vp.height);
    var ctx = p.pdf.getContext('2d', { alpha: false });
    if (p.renderTask) { try { p.renderTask.cancel(); } catch (e) {} }
    p.renderTask = p.page.render({ canvasContext: ctx, viewport: vp });
    p.renderTask.promise.then(function () {
      p.rendered = true; p.renderTask = null; p._rendering = false;
    }).catch(function (e) {
      p._rendering = false; p.renderTask = null;
      if (!e || e.name !== 'RenderingCancelledException') console.error(e);
    });
  }
  function dropRender(p) {
    if (p.renderTask) { try { p.renderTask.cancel(); } catch (e) {} p.renderTask = null; }
    if (p.rendered) { p.pdf.width = 0; p.pdf.height = 0; p.rendered = false; }
    p._rendering = false;
  }

  // ---- 확대/축소 ----
  function applyZoom() {
    var anchor = currentPageIndex();
    S.pages.forEach(function (p) {
      if (!p.box) return;
      sizeBox(p);
      if (p.rendered || p._rendering) { dropRender(p); ensureRendered(p); }
    });
    $('zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
    if (anchor >= 0 && S.pages[anchor] && S.pages[anchor].box) {
      S.pages[anchor].box.scrollIntoView({ block: 'start' });
    }
  }
  function setZoom(z) { S.zoom = Math.max(0.4, Math.min(5, z)); applyZoom(); }

  function currentPageIndex() {
    var mid = viewer.scrollTop + viewer.clientHeight / 2;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < S.pages.length; i++) {
      var b = S.pages[i].box; if (!b) continue;
      var c = b.offsetTop + b.offsetHeight / 2;
      var d = Math.abs(c - mid);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // =====================================================================
  //  주석 (펜 / 형광펜 / 지우개)
  // =====================================================================
  function strokeStyleFor(ctx, s) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = (s.tool === 'eraser') ? 'destination-out' : 'source-over';
    ctx.globalAlpha = (s.tool === 'highlighter') ? 0.32 : 1;
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.size;
  }
  function drawStroke(ctx, s) {
    strokeStyleFor(ctx, s);
    var pts = s.pts;
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, Math.max(0.6, s.size / 2), 0, 7); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function redrawAnno(p) {
    if (!p.anno) return;
    var ctx = p.anno.getContext('2d');
    ctx.clearRect(0, 0, p.anno.width, p.anno.height);
    for (var i = 0; i < p.strokes.length; i++) drawStroke(ctx, p.strokes[i]);
  }
  function sizeForTool(tool) {
    if (tool === 'highlighter') return S.size * 3.5;
    if (tool === 'eraser') return S.size * 2.6 + 4;
    return S.size;
  }

  function bindDraw(p) {
    var anno = p.anno;
    var cur = null, ctx = anno.getContext('2d');
    function xy(e) {
      var sx = anno.width / anno.clientWidth, sy = anno.height / anno.clientHeight;
      var ox = e.offsetX, oy = e.offsetY;
      if (ox == null) { var r = anno.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; }
      return { x: ox * sx, y: oy * sy };
    }
    anno.addEventListener('pointerdown', function (e) {
      if (S.tool === 'pan') return;
      e.preventDefault();
      try { anno.setPointerCapture(e.pointerId); } catch (_) {}
      cur = { tool: S.tool, color: S.color, size: sizeForTool(S.tool), pts: [xy(e)] };
      S.activePage = p;
    });
    anno.addEventListener('pointermove', function (e) {
      if (!cur) return;
      var pt = xy(e), prev = cur.pts[cur.pts.length - 1];
      cur.pts.push(pt);
      // 라이브 표시(마지막 선분만)
      strokeStyleFor(ctx, cur);
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    });
    function end() {
      if (!cur) return;
      p.strokes.push(cur); cur = null;
      redrawAnno(p);                 // 형광펜 균일 농도로 재합성
      S.dirty = true; updateUndo();
    }
    anno.addEventListener('pointerup', end);
    anno.addEventListener('pointercancel', end);
    anno.addEventListener('pointerleave', function (e) { if (cur && e.buttons === 0) end(); });
  }

  function undo() {
    var p = S.activePage || S.pages[currentPageIndex()];
    if (!p || !p.strokes.length) return;
    p.strokes.pop(); redrawAnno(p); updateUndo();
  }
  function updateUndo() {
    var p = S.activePage || (S.pages[currentPageIndex()] || {});
    $('btnUndo').disabled = !(p && p.strokes && p.strokes.length);
  }

  function setTool(tool) {
    S.tool = tool;
    var drawing = (tool !== 'pan');
    S.pages.forEach(function (p) {
      if (p.anno) { p.anno.style.pointerEvents = drawing ? 'auto' : 'none'; p.anno.style.touchAction = drawing ? 'none' : 'auto'; }
    });
    updateToolUI();
  }
  function updateToolUI() {
    document.querySelectorAll('.tool[data-tool]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === S.tool);
    });
    document.querySelectorAll('.swatch').forEach(function (s) {
      s.classList.toggle('active', s.getAttribute('data-color') === S.color);
    });
    $('sizeRange').value = S.size;
    updateUndo();
  }

  // =====================================================================
  //  썸네일 + 페이지 편집(회전/삭제/순서)
  // =====================================================================
  function buildThumbs() {
    thumbsEl.innerHTML = '';
    S.pages.forEach(function (p, idx) {
      var t = document.createElement('div'); t.className = 'thumb'; t.__p = p;
      var c = document.createElement('canvas');
      var no = document.createElement('div'); no.className = 'tn'; no.textContent = (idx + 1);
      var acts = document.createElement('div'); acts.className = 'acts';
      var rot = document.createElement('button'); rot.className = 'rot'; rot.title = '회전';
      rot.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 6V3L8 7l4 4V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6z"/></svg>';
      var del = document.createElement('button'); del.className = 'del'; del.title = '삭제';
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7zM9 4h6l1 2H8zM4 6h16v2H4z"/></svg>';
      acts.appendChild(rot); acts.appendChild(del);
      t.appendChild(c); t.appendChild(no); t.appendChild(acts);
      thumbsEl.appendChild(t);
      p.thumb = t; p.thumbCanvas = c;
      renderThumb(p);

      rot.addEventListener('click', function (e) { e.stopPropagation(); rotatePage(p); });
      del.addEventListener('click', function (e) { e.stopPropagation(); deletePage(p); });
      t.addEventListener('click', function () { gotoPage(p); });
      bindThumbDrag(t, p);
    });
    highlightThumb();
  }

  function renderThumb(p) {
    var W = 230, scale = W / p.w;
    var rot = ((p.rot % 360) + 360) % 360, swap = (rot === 90 || rot === 270);
    var vp = p.page.getViewport({ scale: scale });
    var tmp = document.createElement('canvas');
    tmp.width = Math.ceil(vp.width); tmp.height = Math.ceil(vp.height);
    p.page.render({ canvasContext: tmp.getContext('2d'), viewport: vp }).promise.then(function () {
      // 주석 합성
      if (p.strokes.length) {
        var actx = tmp.getContext('2d'); actx.save();
        actx.scale(tmp.width / p.anno.width, tmp.height / p.anno.height);
        actx.drawImage(p.anno, 0, 0); actx.restore();
      }
      var c = p.thumbCanvas;
      if (swap) { c.width = tmp.height; c.height = tmp.width; } else { c.width = tmp.width; c.height = tmp.height; }
      var ctx = c.getContext('2d');
      ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rot * Math.PI / 180);
      ctx.drawImage(tmp, -tmp.width / 2, -tmp.height / 2); ctx.restore();
    });
  }

  function renumber() {
    S.pages.forEach(function (p, i) {
      if (p.box) { var no = p.box.querySelector('.page-no'); if (no) no.textContent = (i + 1); }
      if (p.thumb) { var tn = p.thumb.querySelector('.tn'); if (tn) tn.textContent = (i + 1); }
    });
  }
  function gotoPage(p) {
    if (p.box) p.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.innerWidth < 820) closeDrawer();
    highlightThumb(p);
  }
  function highlightThumb(p) {
    var idx = p ? S.pages.indexOf(p) : currentPageIndex();
    S.pages.forEach(function (q, i) { if (q.thumb) q.thumb.classList.toggle('current', i === idx); });
  }

  function rotatePage(p) {
    p.rot = (p.rot + 90) % 360;
    if (p.box) sizeBox(p);
    renderThumb(p);
    S.dirty = true;
    toast('회전됨 · ' + (S.pages.indexOf(p) + 1) + '쪽');
  }
  function deletePage(p) {
    if (S.pages.length <= 1) { toast('마지막 한 쪽은 삭제할 수 없어요.'); return; }
    var i = S.pages.indexOf(p); if (i < 0) return;
    S.pages.splice(i, 1);
    if (p.box && p.box.parentNode) p.box.parentNode.removeChild(p.box);
    S.dirty = true;
    buildThumbs(); renumber();
    toast('삭제됨 · ' + (i + 1) + '쪽');
  }

  // 길게 눌러 드래그 → 순서 변경
  function bindThumbDrag(t, p) {
    var timer = null, dragging = false, startY = 0, ghostIdx = -1;
    function cleanup() {
      dragging = false; t.classList.remove('dragging');
      S.pages.forEach(function (q) { if (q.thumb) q.thumb.classList.remove('drop-target'); });
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    }
    function move(e) {
      if (!dragging) {
        if (Math.abs(e.clientY - startY) > 10) { clearTimeout(timer); cleanup(); }
        return;
      }
      e.preventDefault();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var over = el && el.closest ? el.closest('.thumb') : null;
      S.pages.forEach(function (q) { if (q.thumb) q.thumb.classList.toggle('drop-target', q.thumb === over && over !== t); });
    }
    function up(e) {
      if (dragging) {
        var el = document.elementFromPoint(e.clientX, e.clientY);
        var over = el && el.closest ? el.closest('.thumb') : null;
        if (over && over.__p && over.__p !== p) reorder(p, over.__p);
      }
      clearTimeout(timer); cleanup();
    }
    t.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.acts')) return;
      startY = e.clientY;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      timer = setTimeout(function () { dragging = true; t.classList.add('dragging'); }, 200);
    });
  }
  function reorder(from, to) {
    var fi = S.pages.indexOf(from), ti = S.pages.indexOf(to);
    if (fi < 0 || ti < 0) return;
    S.pages.splice(fi, 1);
    S.pages.splice(S.pages.indexOf(to) + (ti > fi ? 1 : 0), 0, from);
    S.dirty = true;
    buildPages(); buildThumbs(); renumber();
    toast('순서 변경됨');
  }

  // =====================================================================
  //  저장 / 내보내기 (pdf-lib)
  // =====================================================================
  function dataURLtoBytes(url) {
    var b = atob(url.split(',')[1]); var a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a;
  }
  function exportPdf() {
    if (!S.srcBytes) return;
    spin(true, '저장 준비 중…');
    var PDFLib = window.PDFLib;
    PDFLib.PDFDocument.load(S.srcBytes).then(function (src) {
      return PDFLib.PDFDocument.create().then(function (out) {
        var order = S.pages.map(function (p) { return p.src; });
        return out.copyPages(src, order).then(function (copied) {
          var chain = Promise.resolve();
          copied.forEach(function (page, i) {
            var p = S.pages[i];
            out.addPage(page);
            var base = page.getRotation().angle || 0;
            page.setRotation(PDFLib.degrees(((base + p.rot) % 360 + 360) % 360));
            if (p.strokes.length) {
              chain = chain.then(function () {
                var c = document.createElement('canvas');
                c.width = p.anno.width; c.height = p.anno.height;
                c.getContext('2d').drawImage(p.anno, 0, 0);
                return out.embedPng(c.toDataURL('image/png')).then(function (png) {
                  page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
                });
              });
            }
          });
          return chain.then(function () { return out.save(); });
        });
      });
    }).then(function (bytes) {
      spin(false);
      var name = S.fileName.replace(/\.pdf$/i, '') + (S.dirty ? '-편집본' : '') + '.pdf';
      download(bytes, name);
      toast('저장 완료 · ' + name);
    }).catch(function (err) {
      console.error(err); spin(false); toast('저장 중 오류가 발생했어요.');
    });
  }
  function download(bytes, name) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // =====================================================================
  //  서랍 열고 닫기
  // =====================================================================
  function openDrawer() { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); if (window.innerWidth < 820) scrim.hidden = false; }
  function closeDrawer() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); scrim.hidden = true; }

  // =====================================================================
  //  이벤트 연결
  // =====================================================================
  function wire() {
    $('btnOpen').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) { if (e.target.files[0]) openFile(e.target.files[0]); fileInput.value = ''; });

    $('btnZoomIn').addEventListener('click', function () { setZoom(S.zoom + 0.2); });
    $('btnZoomOut').addEventListener('click', function () { setZoom(S.zoom - 0.2); });
    $('btnSave').addEventListener('click', exportPdf);
    $('btnNight').addEventListener('click', function () {
      S.night = !S.night; document.body.classList.toggle('night', S.night);
      $('btnNight').classList.toggle('on', S.night); lsSet('paper.night', S.night ? '1' : '0');
    });

    $('btnThumbs').addEventListener('click', function () { drawer.classList.contains('open') ? closeDrawer() : openDrawer(); });
    $('btnCloseDrawer').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);

    document.querySelectorAll('.tool[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () { setTool(b.getAttribute('data-tool')); });
    });
    document.querySelectorAll('.swatch').forEach(function (s) {
      s.addEventListener('click', function () {
        S.color = s.getAttribute('data-color'); lsSet('paper.color', S.color);
        if (S.tool === 'pan') setTool('pen'); updateToolUI();
      });
    });
    $('sizeRange').addEventListener('input', function (e) { S.size = parseInt(e.target.value, 10); lsSet('paper.size', S.size); });
    $('btnUndo').addEventListener('click', undo);

    // 드래그 앤 드롭
    ['dragover', 'dragenter'].forEach(function (ev) {
      viewer.addEventListener(ev, function (e) { e.preventDefault(); viewer.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      viewer.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'dragleave' && e.target !== viewer) return; viewer.classList.remove('dragover'); });
    });
    viewer.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) openFile(f); });

    // 스크롤 → 현재 페이지 표시
    var raf = 0;
    viewer.addEventListener('scroll', function () {
      if (raf) return; raf = requestAnimationFrame(function () { raf = 0; highlightThumb(); updateUndo(); });
    });

    // 리사이즈 → 재배치
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (S.doc) applyZoom(); }, 150); });

    // 떠날 때 경고
    window.addEventListener('beforeunload', function (e) {
      if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ---- 시작 ----
  initTheme();
  wire();
  updateToolUI();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
