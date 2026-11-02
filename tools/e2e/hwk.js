const { webkit } = require('playwright');
(async () => {
  const [S, PORT, ZOOM = '1', SIDEBAR = '1'] = process.argv.slice(2);
  require('fs').rmSync(S + '/wkprof', { recursive: true, force: true });
  const b = await webkit.launchPersistentContext(S + '/wkprof', { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', S + '/scan60.pdf'); await p.waitForSelector('.card', { timeout: 180000 });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.page canvas.bg'); await p.waitForTimeout(5000);
  if (ZOOM !== '1') { await p.evaluate((z) => window.__editor.setZoom(+z, { x: 400, y: 300 }), ZOOM); await p.waitForTimeout(5000); }
  const open = await p.evaluate(() => window.__editor.sidebarOpen);
  if ((SIDEBAR === '1') !== !!open) { await p.evaluate(() => window.__editor.toggleSidebar()); await p.waitForTimeout(5000); }
  await p.evaluate(() => {
    const E = window.__editor, P = Object.getPrototypeOf(E); window.__log = [];
    for (const k of ['onDown', 'onMove', 'onUp', 'drawLive', 'saveNow', 'thumbCanvas', 'showThumb', 'renderPage', 'updateDetail', 'updateVisible', 'staleThumb', 'buildInk', 'setInk', 'addStrokes', 'pushUndo', 'dirty']) {
      const f = P[k]; P[k] = function (...a) { const t = performance.now(); const r = f.apply(this, a); const d = performance.now() - t; if (d > 4) window.__log.push([Math.round(t), k, Math.round(d)]); return r; };
    }
    const raf = window.requestAnimationFrame.bind(window);
    window.__f = []; let last = performance.now(); const tick = (t) => { const now = performance.now(); if (now - last > 50) window.__f.push([Math.round(last), Math.round(now - last)]); last = now; if (!window.__stop) raf(tick); }; raf(tick);
  });
  let x0 = 300, y0 = 250;
  const t0 = Date.now();
  for (let line = 0; line < 4; line++) {
    for (let w = 0; w < 4; w++) {
      for (let s = 0; s < 5; s++) {
        const x = x0 + w * 110 + s * 18, y = y0 + line * 60;
        await p.mouse.move(x, y); await p.mouse.down();
        for (let i = 0; i < 10; i++) await p.mouse.move(x + i * 1.5, y + Math.sin(i * 0.9) * 10);
        await p.mouse.up();
        await p.waitForTimeout(60);
      }
      await p.waitForTimeout(400);
    }
    await p.waitForTimeout(1800);
  }
  const r = await p.evaluate(() => { window.__stop = true; return { gaps: window.__f, log: window.__log }; });
  console.log('wall', Date.now() - t0, 'errs', errs);
  console.log('gaps', JSON.stringify(r.gaps));
  console.log('slow calls', JSON.stringify(r.log));
  await b.close();
})();
