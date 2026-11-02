const { chromium } = require('playwright');
(async () => {
  const [S, NOTE] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.5 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('response', r => r.status() >= 400 && errs.push('URL ' + r.url())); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const out = {};
  const typeIn = async (text) => { await p.waitForSelector('.prompt-input'); await p.fill('.prompt-input', text); await p.click('.prompt [data-key="ok"]'); await p.waitForTimeout(250); };
  await p.goto('http://localhost:8765/'); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', NOTE); await p.waitForSelector('.note-card', { timeout: 60000 });
  for (const t of ['A', 'B']) { await p.click('[data-act="new"]'); await p.waitForSelector('.page svg.ink'); await p.waitForTimeout(300); await p.click('[data-act="back"]'); await p.waitForSelector('.note-card >> nth=1'); await p.waitForTimeout(500); }
  // folders
  await p.click('.lib-actions [data-act="new-folder"]'); await typeIn('데이터베이스');
  await p.click('.lib-actions [data-act="new-folder"]'); await typeIn('운영체제');
  out.folders = await p.$$eval('.folder-card .card-title', e => e.map(x => x.textContent));
  out.side = await p.$$eval('.side-folder span:not(.side-dot)', e => e.map(x => x.textContent));
  // move the imported note via menu
  await p.click('.note-card:has-text("Ch21") [data-act="note-menu"]'); await p.click('.sheet [data-key="move"]');
  await p.click('.folder-pick .sheet-item:has-text("데이터베이스")'); await p.waitForTimeout(400);
  out.rootNotesAfterMove = await p.$$eval('.note-card .card-title', e => e.map(x => x.textContent));
  // drag a note onto the 운영체제 folder (mouse drag)
  const src = await p.locator('.note-card').first().locator('.thumb').boundingBox();
  const dst = await p.locator('.folder-card:has-text("운영체제") .folder-tile').boundingBox();
  await p.mouse.move(src.x + 40, src.y + 40); await p.mouse.down();
  await p.mouse.move(src.x + 80, src.y + 60, { steps: 4 });
  await p.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
  await p.screenshot({ path: S + '/f-drag.png' });
  await p.mouse.up(); await p.waitForTimeout(500);
  out.afterDrag = await p.$$eval('.folder-card .card-sub', e => e.map(x => x.textContent));
  await p.screenshot({ path: S + '/f-lib.png' });
  // enter folder, check crumbs & history back
  await p.click('.folder-card:has-text("데이터베이스") .folder-tile'); await p.waitForTimeout(500);
  out.inFolder = { title: await p.textContent('.h1-text'), notes: await p.$$eval('.note-card .card-title', e => e.map(x => x.textContent)) };
  // subfolder + group via selection
  await p.click('.lib-actions [data-act="new-folder"]'); await typeIn('중간고사');
  await p.click('[data-act="select"]'); await p.click('.note-card .thumb');
  await p.screenshot({ path: S + '/f-select.png' });
  await p.click('[data-act="sel-group"]'); await typeIn('보안 단원');
  out.afterGroup = await p.$$eval('.folder-card .card-title', e => e.map(x => x.textContent));
  await p.goBack(); await p.waitForTimeout(500);
  out.afterBack = await p.textContent('.h1-text');
  await p.goForward(); await p.waitForTimeout(500);
  out.afterForward = await p.textContent('.h1-text');
  // open note in subfolder with page-open animation, then back gesture (history)
  await p.click('.folder-card:has-text("보안 단원") .folder-tile'); await p.waitForTimeout(400);
  await p.click('.note-card .thumb');
  await p.waitForTimeout(180); await p.screenshot({ path: S + '/f-open-mid.png' });
  await p.waitForSelector('.page svg.ink path'); await p.waitForTimeout(900);
  out.undoDisabled = await p.$eval('[data-act="undo"]', b => b.disabled);
  await p.click('[data-act="add"]'); await p.click('[data-act="add-grid"]'); await p.waitForTimeout(300);
  const pc1 = await p.evaluate(() => window.__editor.doc.pages.length);
  await p.click('[data-act="undo"]'); await p.waitForTimeout(300);
  const pc2 = await p.evaluate(() => window.__editor.doc.pages.length);
  await p.click('[data-act="redo"]'); await p.waitForTimeout(300);
  out.pagesUndo = [pc1, pc2, await p.evaluate(() => window.__editor.doc.pages.length)];
  await p.screenshot({ path: S + '/f-editor.png' });
  await p.goBack(); await p.waitForSelector('.lib-head'); await p.waitForTimeout(800);
  out.backFromNote = await p.textContent('.h1-text');
  // search across folders
  await p.click('.crumb[data-folder=""]'); await p.waitForTimeout(400);
  await p.fill('.search-input', 'ch21'); await p.waitForTimeout(300);
  out.search = await p.$$eval('.note-card .card-title', e => e.map(x => x.textContent));
  await p.fill('.search-input', ''); await p.waitForTimeout(200);
  // folder colour
  await p.click('.folder-card:has-text("운영체제") [data-act="folder-menu"]'); await p.click('.sheet [data-key="color"]'); await p.click('.color-dot >> nth=3'); await p.waitForTimeout(300);
  out.color = await p.$eval('.folder-card:has-text("운영체제")', e => e.style.getPropertyValue('--fc'));
  // unwrap folder keeps notes
  await p.click('.folder-card:has-text("운영체제") [data-act="folder-menu"]'); await p.click('.sheet [data-key="unwrap"]'); await p.waitForTimeout(400);
  out.afterUnwrap = { folders: await p.$$eval('.folder-card .card-title', e => e.map(x => x.textContent)), notes: await p.$$eval('.note-card .card-title', e => e.map(x => x.textContent)) };
  await p.screenshot({ path: S + '/f-final.png' });
  await p.setViewportSize({ width: 820, height: 1180 }); await p.waitForTimeout(500);
  await p.screenshot({ path: S + '/f-portrait.png', clip: { x: 0, y: 0, width: 820, height: 600 } });
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
