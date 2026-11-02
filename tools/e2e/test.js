const { chromium } = require('playwright');
(async () => {
  const S = process.argv[2];
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text()));
  await p.goto('http://localhost:8765/');
  await p.waitForSelector('.lib-head');
  await p.screenshot({ path: S + '/s1-empty.png' });
  // new note + draw
  await p.click('[data-act="new"]');
  await p.waitForSelector('.page svg.ink');
  await p.waitForTimeout(300);
  const box = await p.locator('.page').first().boundingBox();
  await p.mouse.move(box.x + 100, box.y + 150); await p.mouse.down();
  for (let i = 0; i < 40; i++) await p.mouse.move(box.x + 100 + i * 8, box.y + 150 + Math.sin(i / 3) * 30);
  await p.mouse.up();
  await p.click('[data-tool="hl"]');
  await p.mouse.move(box.x + 100, box.y + 260); await p.mouse.down();
  await p.mouse.move(box.x + 400, box.y + 262, { steps: 10 }); await p.mouse.up();
  const n1 = await p.evaluate(() => window.__editor.doc.strokes.length);
  await p.click('[data-act="undo"]');
  const n2 = await p.evaluate(() => window.__editor.doc.strokes.length);
  await p.click('[data-act="redo"]');
  await p.click('[data-tool="pen"]');
  await p.screenshot({ path: S + '/s2-draw.png' });
  await p.click('[data-act="back"]');
  await p.waitForSelector('.card');
  // import .note
  await p.setInputFiles('.file', process.argv[3]);
  await p.waitForSelector('.card >> nth=1', { timeout: 60000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: S + '/s3-library.png' });
  const cards = await p.$$eval('.card-title', e => e.map(x => x.textContent));
  await p.click('.card:has-text("Ch21") [data-act="open"]');
  await p.waitForSelector('.page svg.ink');
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => { const d = window.__editor.doc; return { pages: d.pages.length, strokes: d.strokes.length, linked: d.strokes.filter(s => s.audio).length, recs: d.recordings.map(r => [r.id, Math.round(r.duration)]) }; });
  await p.screenshot({ path: S + '/s4-note.png' });
  // scroll to page 15
  await p.evaluate(() => { const e = window.__editor; e.scroller.scrollTop = e.pageViews[14].el.offsetTop - 10; });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: S + '/s5-p15.png' });
  // open player & tap a stroke on page 15
  await p.click('[data-act="player"]');
  await p.waitForTimeout(500);
  const target = await p.evaluate(() => { const e = window.__editor; const pv = e.pageViews[14]; const s = e.byPage.get(pv.page.id).find(s => s.audio && s.pts.length > 30); const r = pv.el.getBoundingClientRect(); return { x: r.left + s.pts[0] / pv.page.w * r.width, y: r.top + s.pts[1] / pv.page.h * r.height, t: s.audio.t, rec: s.audio.rec }; });
  await p.mouse.click(target.x, target.y);
  await p.waitForTimeout(1500);
  const playback = await p.evaluate(() => ({ rec: window.__editor.player.recording?.id, t: window.__editor.player.audio.currentTime, strokes: window.__editor.doc.strokes.length }));
  await p.screenshot({ path: S + '/s6-player.png' });
  console.log(JSON.stringify({ n1, n2, cards, info, target, playback, errs }, null, 1));
  await b.close();
})();
