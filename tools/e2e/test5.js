const { chromium } = require('playwright');
(async () => {
  const [S, NOTE] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.5, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const out = {};
  await p.goto('http://localhost:8765/'); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', NOTE); await p.waitForSelector('.card', { timeout: 60000 });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.thumb-item img[src]', { timeout: 30000 });
  await p.waitForTimeout(800);
  out.sidebar = await p.evaluate(() => ({ open: document.querySelector('.body').classList.contains('sidebar-open'), thumbs: document.querySelectorAll('.thumb-item').length, ind: document.querySelector('.page-indicator').textContent }));
  // jump to page 15 via sidebar
  await p.evaluate(() => document.querySelector('.sidebar').scrollTop = 99999);
  await p.waitForTimeout(400);
  await p.click('.thumb-item[data-idx="14"]'); await p.waitForTimeout(900);
  out.afterJump = await p.evaluate(() => document.querySelector('.page-indicator').textContent);
  await p.screenshot({ path: S + '/e1-sidebar.png' });
  // colors
  out.colors = await p.$$eval('.swatch', els => els.map(e => e.title));
  // record: start, pause, resume, stop
  await p.click('[data-act="record"]'); await p.waitForSelector('.recbar:not(.hidden)');
  await p.waitForTimeout(1300);
  await p.screenshot({ path: S + '/e2-recbar.png' });
  await p.click('[data-act="rec-pause"]'); await p.waitForTimeout(300);
  const pausedLabel = await p.textContent('.rec-label'); const c1 = await p.textContent('.rec-clock');
  await p.waitForTimeout(1200); const c2 = await p.textContent('.rec-clock');
  // draw while paused -> no audio link
  const pg = await p.locator('.page').nth(14).boundingBox();
  await p.mouse.move(pg.x + 100, pg.y + 470); await p.mouse.down(); await p.mouse.move(pg.x + 400, pg.y + 470, { steps: 12 }); await p.mouse.up();
  await p.click('[data-act="rec-pause"]'); await p.waitForTimeout(300);
  await p.mouse.move(pg.x + 100, pg.y + 500); await p.mouse.down(); await p.mouse.move(pg.x + 400, pg.y + 500, { steps: 12 }); await p.mouse.up();
  await p.click('[data-act="rec-stop"]'); await p.waitForTimeout(800);
  out.rec = await p.evaluate(() => { const d = window.__editor.doc; const s = d.strokes.slice(-2); return { recs: d.recordings.length, pausedStroke: s[0].audio, liveStroke: s[1].audio, barHidden: document.querySelector('.recbar').classList.contains('hidden') }; });
  out.rec.pausedLabel = pausedLabel; out.rec.clockFrozen = c1 === c2;
  // partial eraser across the two lines
  const before = await p.evaluate(() => window.__editor.doc.strokes.length);
  await p.click('[data-tool="eraser"]');
  await p.mouse.move(pg.x + 250, pg.y + 440); await p.mouse.down(); await p.mouse.move(pg.x + 250, pg.y + 530, { steps: 10 }); await p.mouse.up();
  const after = await p.evaluate(() => window.__editor.doc.strokes.length);
  await p.screenshot({ path: S + '/e3-erase.png', clip: { x: pg.x, y: pg.y + 380, width: 600, height: 200 } });
  await p.click('[data-act="undo"]');
  const undone = await p.evaluate(() => window.__editor.doc.strokes.length);
  out.eraser = { before, after, undone };
  // player bar on top
  await p.click('[data-act="player"]'); await p.waitForSelector('.playerbar:not(.hidden)');
  out.playerTop = await p.evaluate(() => document.querySelector('.playerbar').getBoundingClientRect().top < document.querySelector('.scroller').getBoundingClientRect().top);
  await p.click('[data-act="close-player"]');
  // restore last page after leaving
  await p.click('[data-tool="pen"]');
  await p.click('[data-act="back"]'); await p.waitForSelector('.card');
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.page svg.ink'); await p.waitForTimeout(800);
  out.restored = await p.textContent('.page-indicator');
  // split view
  await p.click('[data-act="split"]'); await p.waitForSelector('.picker');
  await p.screenshot({ path: S + '/e4-picker.png' });
  await p.click('.picker [data-id="__new"]'); await p.waitForFunction(() => document.querySelectorAll('.pane').length === 2);
  await p.waitForTimeout(900);
  await p.screenshot({ path: S + '/e5-split.png' });
  const dv = await p.locator('.divider').boundingBox();
  await p.mouse.move(dv.x + 7, dv.y + 300); await p.mouse.down(); await p.mouse.move(dv.x - 200, dv.y + 300, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(500);
  out.splitWidths = await p.$$eval('.pane', els => els.map(e => Math.round(e.getBoundingClientRect().width)));
  await p.screenshot({ path: S + '/e6-split-resized.png' });
  // draw in right pane
  const rp = await p.locator('.pane').nth(1).locator('.page').first().boundingBox();
  await p.mouse.move(rp.x + 60, rp.y + 80); await p.mouse.down(); await p.mouse.move(rp.x + 300, rp.y + 120, { steps: 10 }); await p.mouse.up();
  out.rightStrokes = await p.evaluate(() => window.__panes[1].editor.doc.strokes.length);
  // drag divider to right edge closes right pane
  const dv2 = await p.locator('.divider').boundingBox();
  await p.mouse.move(dv2.x + 7, dv2.y + 300); await p.mouse.down(); await p.mouse.move(1170, dv2.y + 300, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(700);
  out.panesAfterClose = await p.$$eval('.pane', els => els.length);
  // portrait
  await p.setViewportSize({ width: 820, height: 1180 }); await p.waitForTimeout(800);
  await p.screenshot({ path: S + '/e7-portrait.png' });
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
