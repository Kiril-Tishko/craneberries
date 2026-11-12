// Check a built lesson page on every screen, at phone and laptop size:
//   node tools/lesson-page/qa.js <work-dir>        (the folder prep.py filled: page.html + audio/)
// Reports: scrolling, sideways overflow, JS errors, anything that moves when a button is tapped (the page
// must never jump), and lines without a recording. Exit code 1 when something is wrong.
// Needs Playwright (preinstalled in Claude cloud sessions).
const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2]);
fs.writeFileSync(dir + '/qa.html', `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${fs.readFileSync(dir + '/page.html', 'utf8')}</body></html>`);
(async () => {
  const b = await chromium.launch();
  const bad = []; const done = [];
  for (const [name, vp] of [['phone', { width: 390, height: 740 }], ['laptop', { width: 1280, height: 680 }]]) {
    const p = await b.newPage({ viewport: vp });
    p.on('pageerror', (e) => bad.push(`${name}: JS error ${e.message}`));
    await p.goto('file://' + dir + '/qa.html'); await p.waitForTimeout(700);
    let n = 0, taps = 0, clips = 0;
    const where = () => p.evaluate(() => document.getElementById('card').innerText.slice(0, 50).replace(/\n/g, ' | '));
    const over = async (what) => {
      const v = await p.evaluate(() => { const c = document.getElementById('card'), d = document.documentElement; return [c.scrollHeight - c.clientHeight, d.scrollWidth - d.clientWidth]; });
      if (v[0] > 2) bad.push(`${name}: scrolls ${v[0]}px ${what} on "${await where()}"`);
      if (v[1] > 2) bad.push(`${name}: sideways scroll ${v[1]}px on "${await where()}"`);
    };
    // Where things are: the card, its first line and its last row of buttons.
    const box = () => p.evaluate(() => {
      const r = (x) => x ? Math.round(x.getBoundingClientRect().top) : 0;
      const c = document.getElementById('card'); const rows = c.querySelectorAll('.row');
      return [r(c), Math.round(c.getBoundingClientRect().height), r(c.firstElementChild), r(rows[rows.length - 1])].join(',');
    });
    for (let g = 0; g < 200; g++) {
      n++;
      await over('');
      const before = await box(), title = await where();
      for (let k = 0; k < 4; k++) {            // tap every reveal button (hints take up to three taps)
        let did = false;
        for (const x of await p.$$('#card [data-show], #card [data-hint]')) {
          if (await x.isVisible()) { try { await x.click({ timeout: 300 }); did = true; taps++; } catch (e) {} }
        }
        if (!did) break;
        const after = await box();
        if (after !== before) { bad.push(`${name}: JUMPS on "${title}" (${before} -> ${after})`); break; }
      }
      await over('after a tap');
      if (name === 'laptop') {
        for (const t of await p.$$eval('#card [data-say]', (xs) => xs.map((x) => x.dataset.say))) {
          const r = await p.evaluate(async (t) => {
            if (!AUDIO[t]) return 'no recording';
            const a = new Audio(AUDIO[t]);
            return await new Promise((res) => { a.oncanplaythrough = () => res('ok'); a.onerror = () => res('file does not load'); setTimeout(() => res('timeout'), 3000); });
          }, t);
          if (r === 'ok') clips++; else bad.push(`${r}: ${t}`);
        }
      }
      if (await p.evaluate(() => document.getElementById('next').disabled)) break;
      await p.click('#next'); await p.waitForTimeout(450);   // let the entry animation finish before measuring
    }
    done.push(`${name}: ${n} screens, ${taps} taps` + (name === 'laptop' ? `, ${clips} clips play` : ''));
    await p.close();
  }
  await b.close();
  const issues = [...new Set(bad)];
  console.log(done.join('\n')); console.log(issues.length ? issues.join('\n') : 'no problems');
  process.exit(issues.length ? 1 : 0);
})();
