const { chromium } = require('playwright');
(async () => {
  const [S, PORT, TAG] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`); await p.waitForSelector('.lib-head');
  await p.click('[data-act="new"]'); await p.waitForSelector('.page svg.ink'); await p.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(p);
  const pen = (type, x, y, force = 0.5) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'pen', force, clickCount: 1 });
  const stroke = async (pts) => { await pen('mousePressed', ...pts[0]); for (const q of pts.slice(1)) await pen('mouseMoved', ...q); await pen('mouseReleased', ...pts[pts.length - 1]); };
  const out = {};
  // 1) fast handwriting: 12 tiny strokes (2-5px) in quick succession, close together
  const n0 = await p.evaluate(() => window.__editor.doc.strokes.length);
  for (let i = 0; i < 12; i++) {
    const x = 300 + (i % 6) * 6, y = 300 + Math.floor(i / 6) * 6;
    await stroke([[x, y, 0.5], [x + 2, y + 1, 0.6], [x + 3, y + 3, 0.6]]);
  }
  out.fastTiny = { kept: (await p.evaluate(() => window.__editor.doc.strokes.length)) - n0, tool: await p.evaluate(() => window.__editor.tool) };
  // 2) genuine double tap still toggles
  await p.waitForTimeout(400);
  for (let i = 0; i < 2; i++) { await pen('mousePressed', 700, 500); await pen('mouseReleased', 700, 500); await p.waitForTimeout(80); }
  out.doubleTap = await p.evaluate(() => window.__editor.tool);
  await p.click('[data-tool="pen"]');
  // 3) handwriting-like glyphs with sharp turns, varying pressure: ㄹ, ㄱ, 가 strokes
  const glyph = async (ox, oy, k) => {
    await stroke([[ox, oy, .4], [ox + 12 * k, oy, .6], [ox + 12 * k, oy + 7 * k, .7], [ox, oy + 7 * k, .7], [ox, oy + 14 * k, .6], [ox + 13 * k, oy + 14 * k, .4]]);
    await stroke([[ox + 20 * k, oy, .5], [ox + 30 * k, oy, .7], [ox + 27 * k, oy + 14 * k, .5]]);
    await stroke([[ox + 38 * k, oy - 2 * k, .3], [ox + 38 * k, oy + 8 * k, .8], [ox + 38 * k, oy + 16 * k, .5]]);
    await stroke([[ox + 38 * k, oy + 7 * k, .5], [ox + 44 * k, oy + 7 * k, .6]]);
  };
  await glyph(200, 420, 1); await glyph(320, 420, 2);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${S}/glyph-${TAG}.png`, clip: { x: 190, y: 405, width: 260, height: 60 } });
  await p.evaluate(() => window.__editor.setZoom(3, { x: 250, y: 380 })); await p.waitForTimeout(900);
  const r = await p.evaluate(() => { const pv = window.__editor.pageViews[0]; const s = window.__editor.doc.strokes.at(-8); const box = pv.el.getBoundingClientRect(); return { x: box.left + s.pts[0] / pv.page.w * box.width - 30, y: box.top + s.pts[1] / pv.page.h * box.height - 30 }; });
  await p.screenshot({ path: `${S}/glyph3x-${TAG}.png`, clip: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: 420, height: 160 } });
  out.errs = errs;
  console.log(JSON.stringify(out));
  await b.close();
})();
