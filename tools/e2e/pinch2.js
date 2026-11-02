const { chromium } = require('playwright');
(async () => {
  const [S, NOTE] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', NOTE); await p.waitForSelector('.card', { timeout: 60000 });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.page svg.ink path'); await p.waitForTimeout(1200);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i, radiusX: 5, radiusY: 5 })) });
  // Rects of all visible pages (screen coords) — compare the last preview frame with the committed layout.
  const rects = () => p.evaluate(() => [...document.querySelectorAll('.page')].map((el, i) => { const r = el.getBoundingClientRect(); return [i, Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }).filter(r => r[2] < innerHeight && r[2] + 2000 > 0).slice(0, 4));
  await p.evaluate(() => { window.__blank = 0; const tick = () => { for (const pg of document.querySelectorAll('.page.paper-pdf')) { const r = pg.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue; const bg = pg.querySelector('canvas.bg'); if (!bg || bg.width === 0) window.__blank++; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const run = async (name, cx, cy, spreadFrom, spreadTo, dy) => {
    await touch('touchStart', [[cx - spreadFrom, cy], [cx + spreadFrom, cy]]);
    const steps = 10;
    for (let i = 1; i <= steps; i++) { const s = spreadFrom + (spreadTo - spreadFrom) * i / steps; await touch('touchMove', [[cx - s, cy + dy * i / steps], [cx + s, cy + dy * i / steps]]); await p.waitForTimeout(20); }
    await p.waitForTimeout(50);
    const preview = await rects();
    await touch('touchEnd', []);
    const committed = await rects();
    await p.waitForTimeout(700);
    const settled = await rects();
    const diff = Math.max(...preview.map((r, j) => Math.max(...r.slice(1).map((v, k) => Math.abs(v - (committed[j]?.[k + 1] ?? 1e9))))));
    const diff2 = Math.max(...committed.map((r, j) => Math.max(...r.slice(1).map((v, k) => Math.abs(v - (settled[j]?.[k + 1] ?? 1e9))))));
    return { name, zoom: await p.evaluate(() => window.__editor.zoom.toFixed(2)), previewVsCommit: diff, commitVsSettled: diff2 };
  };
  const out = [];
  out.push(await run('zoom in', 700, 420, 60, 140, 20));
  out.push(await run('zoom out (narrower than screen)', 600, 400, 160, 40, -10));
  out.push(await run('zoom in again', 500, 300, 50, 120, 0));
  await p.evaluate(() => { window.__editor.scroller.scrollTop = 0; }); await p.waitForTimeout(300);
  out.push(await run('zoom out at top edge (clamped)', 700, 200, 150, 60, 80));
  console.log(JSON.stringify({ out, blankFrames: await p.evaluate(() => window.__blank), errs }, null, 1));
  await b.close();
})();
