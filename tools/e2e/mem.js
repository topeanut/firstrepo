// Scroll through every page of the scanned PDF (sidebar open), then report heap size.
// Safari's pdf.js path is emulated by hiding window.chrome / ImageDecoder.
const { chromium } = require('playwright');
(async () => {
  const [S, PORT] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { delete window.chrome; delete window.ImageDecoder; });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/`); await p.waitForSelector('.lib-head');
  await p.setInputFiles('.file', S + '/scan60.pdf'); await p.waitForSelector('.card', { timeout: 120000 });
  await p.click('.card [data-act="open"]'); await p.waitForSelector('.page canvas.bg'); await p.waitForTimeout(3000);
  if (!(await p.evaluate(() => window.__editor.sidebarOpen))) await p.evaluate(() => window.__editor.toggleSidebar());
  const { execSync } = require('child_process');
  const rss = () => Math.round(+execSync(`ps -eo rss,args | grep -E 'chrom(e|ium)' | grep -v grep | awk '{s+=$1} END {print s}'`).toString() / 1024);
  const trail = [rss()];
  for (let i = 0; i < 60; i += 2) { await p.evaluate((i) => window.__editor.goToPage(i), i); await p.waitForTimeout(700); if (i % 20 === 18) trail.push(rss()); }
  await p.waitForTimeout(3000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('HeapProfiler.collectGarbage');
  const r = await p.evaluate(() => ({ heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6), canvasMP: Math.round([...document.querySelectorAll('canvas')].reduce((a, c) => a + c.width * c.height, 0) / 1e6) }));
  trail.push(rss()); r.rssTrail = trail.join(' > ');
  console.log(PORT, JSON.stringify(r));
  await b.close();
})();
