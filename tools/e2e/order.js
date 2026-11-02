const { chromium } = require('playwright');
(async () => {
  const [S, PORT] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1180, height: 820 } });
  await p.goto(`http://localhost:${PORT}/`); await p.waitForSelector('.lib-head');
  await p.click('[data-act="new"]'); await p.waitForSelector('.page svg.ink'); await p.waitForTimeout(600);
  const res = await p.evaluate(() => {
    const ed = window.__editor;
    const pv = ed.pageViews[0];
    const r = pv.el.getBoundingClientRect();
    const target = pv.svg;
    const ev = (y, t, coalesced) => ({ clientX: r.left + 300, clientY: r.top + y, pointerType: 'pen', pressure: 0.5, timeStamp: t, pointerId: 7, button: 0, target, preventDefault() {}, getCoalescedEvents: coalesced ? () => coalesced : undefined });
    const sample = (y, t) => ({ clientX: r.left + 300, clientY: r.top + y, pointerType: 'pen', pressure: 0.5, timeStamp: t });
    // Real path: y = 100 → 300 over 200ms. Safari: pointerdown delivered late at y=140 (t=40),
    // then the first move replays samples from t=0 (y=100) onward.
    ed.onDown(ev(140, 40));
    ed.onMove(ev(150, 50, [0, 10, 20, 30, 40, 50].map((t) => sample(100 + t, t))));
    for (let t = 60; t <= 200; t += 10) ed.onMove(ev(100 + t, t, [sample(100 + t - 5, t - 5), sample(100 + t, t)]));
    ed.onUp(ev(300, 200));
    const s = ed.doc.strokes.at(-1);
    const ys = []; for (let i = 1; i < s.pts.length; i += 3) ys.push(Math.round(s.pts[i]));
    let backtracks = 0; for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i - 1] - 0.5) backtracks++;
    return { first: ys.slice(0, 6), backtracks };
  });
  console.log(JSON.stringify(res));
  await b.close();
})();
