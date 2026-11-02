const { chromium } = require('playwright');
(async () => {
  const [S, PORT] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { delete window.chrome; delete window.ImageDecoder; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', S + '/scan60.pdf'); await p.waitForSelector('.card', { timeout: 120000 });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.page canvas.bg'); await p.waitForTimeout(4000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.evaluate(() => { window.__lt = []; window.__f = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask' }); });
  // scroll through 8 pages with stops, writing on each page with pauses
  for (let k = 0; k < 14; k++) {
    await p.mouse.move(700, 450); await p.mouse.wheel(0, 700); await p.waitForTimeout(700);
    for (let s = 0; s < 3; s++) {
      await p.mouse.move(400 + s * 40, 400); await p.mouse.down();
      for (let i = 0; i < 10; i++) await p.mouse.move(400 + s * 40 + i * 2, 400 + Math.sin(i) * 8);
      await p.mouse.up();
    }
    await p.waitForTimeout(1500);
  }
  const r = await p.evaluate(() => { window.__stop = true; const f = window.__f.slice(2); return { frames: f.length, over100: f.filter((x) => x > 100).length, max: Math.round(Math.max(...f)), longtasks: window.__lt.length, ltTotal: window.__lt.reduce((a, b) => a + b, 0), ltMax: Math.max(0, ...window.__lt) }; });
  r.errs = errs;
  console.log(JSON.stringify(r));
  await b.close();
})();
