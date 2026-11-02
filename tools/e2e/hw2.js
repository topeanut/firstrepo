// Open a scanned PDF and start writing right away (sidebar open), like a user taking notes.
const { chromium } = require('playwright');
(async () => {
  const [S, PORT, ZOOM = '1'] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { delete window.chrome; delete window.ImageDecoder; try { localStorage.setItem('penote.sidebar', 'true'); } catch {} });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/`); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', S + '/scan60.pdf'); await p.waitForSelector('.card', { timeout: 120000 });
  // let import-time work settle, then measure from the moment the note opens
  await p.waitForTimeout(2000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.evaluate(() => { window.__lt = []; window.__f = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask' }); });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.page canvas.bg');
  if (!(await p.evaluate(() => window.__editor.sidebarOpen))) await p.evaluate(() => window.__editor.toggleSidebar());
  if (ZOOM !== '1') await p.evaluate((z) => window.__editor.setZoom(+z, { x: 400, y: 300 }), ZOOM);
  await p.waitForTimeout(1200);
  const w0 = await p.evaluate(() => performance.now());
  for (let line = 0; line < 3; line++) {
    for (let w = 0; w < 4; w++) {
      for (let s = 0; s < 5; s++) {
        const x = 300 + w * 110 + s * 18, y = 250 + line * 60;
        await p.mouse.move(x, y); await p.mouse.down();
        for (let i = 0; i < 10; i++) await p.mouse.move(x + i * 1.5, y + Math.sin(i * 0.9) * 10);
        await p.mouse.up();
        await p.waitForTimeout(60);
      }
      await p.waitForTimeout(350);
    }
    await p.waitForTimeout(900);
  }
  const w1 = await p.evaluate(() => performance.now());
  await p.waitForTimeout(6000); // background work catches up after writing stops
  const r = await p.evaluate(([w0, w1]) => { window.__stop = true; const lt = window.__lt; const during = lt.filter(([s]) => s >= w0 && s <= w1); const after = lt.filter(([s]) => s > w1);
    return { whileWriting: { n: during.length, total: during.reduce((a, [, d]) => a + d, 0), max: Math.max(0, ...during.map(([, d]) => d)) }, afterPause: { n: after.length, total: after.reduce((a, [, d]) => a + d, 0), max: Math.max(0, ...after.map(([, d]) => d)) }, thumbs: document.querySelectorAll('.thumb-item img[src^="data"]').length, strokes: window.__editor.doc.strokes.length }; }, [w0, w1]);
  console.log(PORT, 'zoom', ZOOM, JSON.stringify(r));
  await b.close();
})();
