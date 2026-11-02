const { chromium } = require('playwright');
(async () => {
  const S = process.argv[2];
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.5, colorScheme: 'dark', acceptDownloads: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8765/');
  await p.waitForSelector('.lib-head');
  const theme = await p.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  await p.click('[data-act="new"]'); await p.waitForSelector('.page svg.ink'); await p.waitForTimeout(300);
  await p.click('[data-act="add"]'); await p.waitForTimeout(200);
  await p.screenshot({ path: S + '/a1-menu.png' });
  await p.setInputFiles('.pick-image', S + '/photo.jpg'); await p.waitForSelector('.item-image img[src^="blob:"]');
  await p.setInputFiles('.pick-file', [S + '/lecture-notes.txt']); await p.waitForSelector('.item-file');
  await p.setInputFiles('.pick-pdf', S + '/out/081561BB-7EF3-4CEE-B988-CE7BA4B660D4.pdf');
  await p.waitForFunction(() => window.__editor.doc.pages.length === 26, null, { timeout: 30000 });
  await p.evaluate(() => window.__editor.scroller.scrollTo({ top: 0 })); await p.waitForTimeout(600);
  // select tool: move file card, resize image
  await p.click('[data-tool="select"]');
  const fb = await p.locator('.item-file').boundingBox();
  await p.mouse.move(fb.x + 40, fb.y + 20); await p.mouse.down(); await p.mouse.move(fb.x + 40, fb.y + 260, { steps: 8 }); await p.mouse.up();
  const ib = await p.locator('.item-image').boundingBox();
  await p.mouse.click(ib.x + 50, ib.y + 50);
  const hb = await p.locator('.item-image .item-handle').boundingBox();
  await p.mouse.move(hb.x + 14, hb.y + 14); await p.mouse.down(); await p.mouse.move(hb.x - 150, hb.y - 90, { steps: 8 }); await p.mouse.up();
  const state1 = await p.evaluate(() => window.__editor.doc.items.map(i => [i.type, Math.round(i.x), Math.round(i.y), Math.round(i.w), Math.round(i.h)]));
  await p.screenshot({ path: S + '/a2-items.png' });
  await p.click('[data-act="undo"]');
  const afterUndo = await p.evaluate(() => window.__editor.doc.items.map(i => Math.round(i.w)));
  await p.click('[data-act="redo"]');
  // draw over image with pen
  await p.click('[data-tool="pen"]');
  const ib2 = await p.locator('.item-image').boundingBox();
  await p.mouse.move(ib2.x + 20, ib2.y + 40); await p.mouse.down(); await p.mouse.move(ib2.x + 200, ib2.y + 60, { steps: 10 }); await p.mouse.up();
  // delete via select
  await p.click('[data-tool="select"]');
  await p.mouse.click(fb.x + 40, fb.y + 260);
  const barVisible = await p.isVisible('.item-file.selected .item-bar');
  await p.click('.item-file.selected [data-act="item-delete"]');
  const nItems = await p.evaluate(() => window.__editor.doc.items.length);
  await p.click('[data-act="undo"]');
  const nItems2 = await p.evaluate(() => window.__editor.doc.items.length);
  // persistence
  await p.click('[data-act="back"]'); await p.waitForSelector('.card');
  await p.screenshot({ path: S + '/a3-lib.png' });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.item-image img[src^="blob:"]');
  const reopened = await p.evaluate(() => ({ items: window.__editor.doc.items.length, pages: window.__editor.doc.pages.length, strokes: window.__editor.doc.strokes.length }));
  await p.click('[data-act="more"]');
  const tE = Date.now(); const dl = p.waitForEvent('download', { timeout: 180000 });
  await p.click('[data-act="export"]'); const d = await dl; await d.saveAs(S + '/export2.pdf'); errs.push('exportMs=' + (Date.now() - tE));
  console.log(JSON.stringify({ theme, state1, afterUndo, barVisible, nItems, nItems2, reopened, errs }));
  await b.close();
})();
