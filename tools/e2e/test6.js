const { chromium } = require('playwright');
(async () => {
  const [S, NOTE] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.5, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  const out = {};
  // overlap checker: any two visible toolbar controls whose rects intersect
  const overlaps = () => p.evaluate(() => {
    const res = [];
    for (const tb of document.querySelectorAll('.toolbar')) {
      const els = [...tb.querySelectorAll('button, input')].filter(e => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && st.display !== 'none' && st.visibility !== 'hidden'; });
      const tbr = tb.getBoundingClientRect();
      for (let i = 0; i < els.length; i++) {
        const a = els[i].getBoundingClientRect();
        // clipped by the scrollable tools row: only check what is inside the toolbar box
        if (a.right > tbr.right + 1 && !els[i].closest('.tools')) res.push('outside:' + (els[i].dataset.act || els[i].className));
        for (let j = i + 1; j < els.length; j++) {
          const c = els[j].getBoundingClientRect();
          if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) res.push((els[i].dataset.act || els[i].dataset.tool || els[i].className) + '×' + (els[j].dataset.act || els[j].dataset.tool || els[j].className));
        }
      }
    }
    return res;
  });
  await p.goto('http://localhost:8765/'); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', NOTE); await p.waitForSelector('.card', { timeout: 60000 });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.page svg.ink'); await p.waitForTimeout(800);
  for (const [w, h] of [[1366, 1024], [1180, 820], [1024, 768], [820, 1180], [744, 1133], [390, 844]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500);
    out['w' + w] = await overlaps();
    await p.screenshot({ path: `${S}/tb-${w}.png`, clip: { x: 0, y: 0, width: w, height: 130 } });
  }
  await p.setViewportSize({ width: 1180, height: 820 }); await p.waitForTimeout(400);
  // split -> narrow panes
  await p.click('[data-act="split"]'); await p.click('.picker [data-id="__new"]');
  await p.waitForFunction(() => document.querySelectorAll('.pane').length === 2); await p.waitForTimeout(700);
  out.split = await overlaps();
  await p.screenshot({ path: `${S}/tb-split.png`, clip: { x: 0, y: 0, width: 1180, height: 130 } });
  await p.setViewportSize({ width: 820, height: 1180 }); await p.waitForTimeout(600);
  out.splitPortrait = await overlaps();
  await p.screenshot({ path: `${S}/tb-split-portrait.png`, clip: { x: 0, y: 0, width: 820, height: 130 } });
  // close split via right pane menu
  await p.locator('.pane').nth(1).locator('[data-act="more"]').click();
  await p.locator('.pane').nth(1).locator('[data-act="split-menu"]').click();
  await p.waitForFunction(() => document.querySelectorAll('.pane').length === 1); await p.setViewportSize({ width: 1180, height: 820 }); await p.waitForTimeout(500);
  // record then delete recording
  await p.click('[data-act="record"]'); await p.waitForSelector('.recbar:not(.hidden)'); await p.waitForTimeout(1200);
  const pg = await p.locator('.page').first().boundingBox();
  await p.mouse.move(pg.x + 120, pg.y + 300); await p.mouse.down(); await p.mouse.move(pg.x + 420, pg.y + 320, { steps: 15 }); await p.mouse.up();
  await p.click('[data-act="rec-stop"]'); await p.waitForTimeout(800);
  const before = await p.evaluate(() => ({ recs: window.__editor.doc.recordings.length, linked: window.__editor.doc.strokes.filter(s => s.audio?.rec === window.__editor.doc.recordings.at(-1).id).length, lastId: window.__editor.doc.recordings.at(-1).id }));
  await p.click('[data-act="player"]'); await p.waitForSelector('.playerbar:not(.hidden)');
  out.options = await p.$$eval('.rec-select option', o => o.map(x => x.value)); await p.selectOption('.rec-select', out.options.at(-1)); await p.waitForTimeout(300);
  await p.screenshot({ path: `${S}/player.png`, clip: { x: 0, y: 0, width: 1180, height: 140 } });
  await p.click('[data-act="rec-delete"]'); await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({ recs: window.__editor.doc.recordings.map(r => r.id), linked: window.__editor.doc.strokes.filter(s => s.audio && !window.__editor.doc.recordings.some(r => r.id === s.audio.rec)).length, playerHidden: document.querySelector('.playerbar').classList.contains('hidden') }));
  out.recDelete = { before, after };
  // perf: time to draw a long stroke (frames) & live incremental correctness
  const t0 = Date.now();
  await p.mouse.move(pg.x + 100, pg.y + 400); await p.mouse.down();
  for (let i = 0; i < 300; i++) await p.mouse.move(pg.x + 100 + i * 2, pg.y + 400 + Math.sin(i / 8) * 40);
  await p.mouse.up();
  out.longStrokeMs = Date.now() - t0;
  out.lastStrokePts = await p.evaluate(() => window.__editor.doc.strokes.at(-1).pts.length / 3);
  await p.screenshot({ path: `${S}/longstroke.png`, clip: { x: pg.x, y: pg.y + 330, width: 800, height: 150 } });
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
