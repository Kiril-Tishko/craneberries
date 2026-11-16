// node tools/lesson-page/qa-play.js <work-dir>: after qa.js, for pages with moving pictures or games.
// Watches every moving picture for 2.5 s (no scrolling) and taps quiz / game answers (shake, stars, no jumping).
const { chromium } = require('playwright'); const D = process.argv[2];
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const [name, vp] of [['phone', { width: 390, height: 740 }], ['laptop', { width: 1280, height: 680 }]]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', (e) => out.push(name + ' JS ' + e.message));
    await p.goto('file://' + D + '/qa.html'); await p.waitForTimeout(600);
    let n = 0, animScreens = 0, quiz = 0, games = 0;
    for (let g = 0; g < 120; g++) {
      n++;
      if (await p.$('#card .anim')) {
        animScreens++;
        let worst = 0, side = 0;
        for (let k = 0; k < 12; k++) {
          const v = await p.evaluate(() => { const c = document.getElementById('card'), d = document.documentElement; return [c.scrollHeight - c.clientHeight, d.scrollWidth - d.clientWidth, c.scrollWidth - c.clientWidth]; });
          worst = Math.max(worst, v[0]); side = Math.max(side, v[1], v[2]); await p.waitForTimeout(210);
        }
        if (worst > 2 || side > 2) out.push(`${name}: moving picture makes the card scroll (${worst}px down, ${side}px sideways) on screen ${n}`);
      }
      const qz = await p.$$('#card [data-quiz]');
      if (qz.length) {
        quiz++;
        const before = await p.evaluate(() => document.getElementById('card').getBoundingClientRect().height);
        const right = await p.evaluate(() => SECTIONS[sec].slides[idx].ans);
        await qz[1 - right].click(); await p.waitForTimeout(100);
        if (!(await p.$('#card .word.wrong.shake'))) out.push(`${name}: wrong answer did not shake on screen ${n}`);
        await qz[right].click(); await p.waitForTimeout(150);
        const bursts = await p.$$eval('.burst', (x) => x.length);
        if (!(await p.$('#card .word.right')) || bursts < 1) out.push(`${name}: right answer gave no stars on screen ${n}`);
        const after = await p.evaluate(() => document.getElementById('card').getBoundingClientRect().height);
        if (before !== after) out.push(`${name}: card height changed after a tap on screen ${n}`);
        await p.waitForTimeout(1300);
        if (await p.$$eval('.burst', (x) => x.length)) out.push(`${name}: stars stayed on screen ${n}`);
      }
      if (await p.$('#card [data-gplay]')) {
        games++;
        await p.click('[data-gplay]');
        const cur = await p.evaluate(() => G.cur);
        await p.click(`[data-gans="${cur}"]`); await p.waitForTimeout(150);
        if (!(await p.$$eval('.burst', (x) => x.length))) out.push(`${name}: game right answer gave no stars on screen ${n}`);
      }
      if (await p.evaluate(() => document.getElementById('next').disabled)) break;
      await p.click('#next'); await p.waitForTimeout(300);
    }
    out.push(`${name}: ${n} screens, ${animScreens} with moving pictures, ${quiz} quiz, ${games} game`);
    await p.close();
  }
  await b.close(); console.log(out.join('\n'));
})();
