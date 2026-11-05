#!/usr/bin/env node
// Render a lesson's student cards (phone-sized PNGs) from a lesson JSON file.
//
//   node tools/render-cards.js <lesson.json> <out-dir>
//
// Reads `date` and `studentCards` from the lesson file, writes <out-dir>/cards.html
// and <out-dir>/card-1.png … card-N.png (420 CSS px wide at 3x = 1260 px).
// Card types: words, phrases, grammar, fixes, pron. See CLAUDE.md for the shape.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [, , lessonPath, outDir] = process.argv;
if (!lessonPath || !outDir) {
  console.error('usage: node tools/render-cards.js <lesson.json> <out-dir>');
  process.exit(1);
}
const lesson = JSON.parse(fs.readFileSync(lessonPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// [text] in a string marks a highlighted span.
const mark = (s = '') => esc(s).replace(/\[([^\]]+)\]/g, '<span class="hl">$1</span>');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const [y, m, d] = lesson.date.split('-').map(Number);
const dateLabel = `${MONTHS[m - 1]} ${d}`;

const cards = lesson.studentCards || [];
const total = cards.length;

function header(c, i) {
  return `
  <div class="top"><span>Lesson notes · ${dateLabel}</span><span class="pager">${i + 1}/${total}</span></div>
  <div class="kicker">${esc(c.kicker || '')}</div>
  <h1>${esc(c.title)}</h1>
  ${c.sub ? `<p class="sub">${esc(c.sub)}</p>` : ''}`;
}

const body = {
  words: (c) => `<ol class="words">${c.items.map((w) => `
    <li><span class="ua">${esc(w.ua)}</span>
      <span class="en"><span class="hl">${esc(w.en)}</span></span>
      ${w.ex ? `<span class="ex">${esc(w.ex)}</span>` : ''}</li>`).join('')}</ol>`,

  phrases: (c) => `<ol class="phrases">${c.items.map((p) => `
    <li><span class="ph">${esc(p.en)}</span>${p.note ? `<span class="note">${esc(p.note)}</span>` : ''}</li>`).join('')}</ol>`,

  grammar: (c) => `
    <div class="rule"><span class="hl">${esc(c.rule)}</span><span class="rule-ua">= ${esc(c.ruleUa)}</span></div>
    <ol class="examples">${c.examples.map((e) => `
      <li><span>${mark(e.text)}</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}</li>`).join('')}</ol>
    ${c.forms ? `<div class="forms">${c.forms.map((f) => `
      <div><span class="flabel">${esc(f.label)}</span>${mark(f.text)}</div>`).join('')}</div>` : ''}
    ${c.tip ? `<p class="tip">${esc(c.tip)}</p>` : ''}`,

  fixes: (c) => `<ol class="fixes">${c.items.map((f, n) => `
    <li><span class="num">${n + 1}</span>
      <div class="fx">
        <span class="wrong">${esc(f.wrong)}</span>
        <span class="right">${esc(f.right)}</span>
        ${f.why ? `<span class="why">${esc(f.why)}</span>` : ''}
      </div></li>`).join('')}</ol>`,

  pron: (c) => `
    <div class="pairs">${c.pairs.map((p) => `
      <div class="pair"><div class="pw">${esc(p.word)}</div><div class="ipa">${esc(p.ipa)}</div>
        <div class="ptip">${esc(p.tip)}</div></div>`).join('')}</div>
    ${c.family ? `<p class="family">${esc(c.family)}</p>` : ''}
    ${c.practice ? `<div class="practice"><div class="flabel">Say each one 5 times</div>
      ${c.practice.map((s) => `<div class="say">${esc(s)}</div>`).join('')}</div>` : ''}`,
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Lesson Cards</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800&display=swap">
<style>
  :root{
    --paper:#F4F6FB; --ink:#141E36; --muted:#56607A; --line:#DCE2EE;
    --hl:#FFE14D; --red:#B8322A; --green:#11764A; --blue:#2742C4; --tile:#FFFFFF;
    --sans:"Golos Text","Inter","DejaVu Sans",sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--paper);font-family:var(--sans);color:var(--ink);-webkit-font-smoothing:antialiased}
  .card{width:420px;background:var(--paper);padding:26px 24px 30px;margin:0 auto 20px}
  .top{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;
       color:var(--muted);letter-spacing:.02em}
  .pager{font-variant-numeric:tabular-nums;border:1.5px solid var(--line);border-radius:99px;padding:2px 9px;color:var(--muted)}
  .kicker{margin-top:22px;font-size:13px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--blue)}
  h1{font-size:31px;line-height:1.1;font-weight:800;letter-spacing:-.02em;margin-top:6px;text-wrap:balance}
  .sub{font-size:16.5px;line-height:1.4;color:var(--muted);margin-top:8px}
  .hl{background:linear-gradient(transparent 52%, var(--hl) 52%, var(--hl) 92%, transparent 92%);padding:0 2px;
      -webkit-box-decoration-break:clone;box-decoration-break:clone}
  ol{list-style:none}

  .words{margin-top:16px;border-top:1.5px solid var(--line)}
  .words li{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-bottom:1.5px solid var(--line)}
  .ua{font-size:15.5px;color:var(--muted)}
  .en{font-size:22px;font-weight:700;line-height:1.25}
  .ex{font-size:16px;line-height:1.35;color:var(--ink);opacity:.78;font-style:italic}

  .phrases{margin-top:16px;border-top:1.5px solid var(--line)}
  .phrases li{padding:12px 0;border-bottom:1.5px solid var(--line);display:flex;flex-direction:column;gap:3px}
  .ph{font-size:19.5px;font-weight:650;line-height:1.3}
  .note{font-size:15px;color:var(--muted);font-weight:400;line-height:1.35}

  .rule{margin-top:18px;background:var(--tile);border-radius:16px;padding:16px 16px;display:flex;flex-direction:column;gap:4px}
  .rule .hl{font-size:26px;font-weight:800;align-self:flex-start}
  .rule-ua{font-size:17px;color:var(--muted)}
  .examples{margin-top:14px}
  .examples li{font-size:20px;line-height:1.35;padding:11px 0;border-bottom:1.5px solid var(--line);display:flex;flex-direction:column;gap:2px}
  .examples li:first-child{border-top:1.5px solid var(--line)}
  .examples .hl{font-weight:700}
  .forms{margin-top:14px;display:grid;gap:8px}
  .forms > div{background:var(--tile);border-radius:12px;padding:11px 14px;font-size:18.5px;line-height:1.3}
  .flabel{display:block;font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin-bottom:3px}
  .tip{margin-top:14px;font-size:16.5px;line-height:1.4;color:var(--muted)}

  .fixes{margin-top:18px;display:grid;gap:12px}
  .fixes li{display:flex;gap:14px;background:var(--tile);border-radius:16px;padding:16px 16px 16px 14px}
  .num{flex:none;width:34px;height:34px;border-radius:50%;background:var(--ink);color:var(--paper);display:grid;place-items:center;
       font-weight:800;font-size:17px}
  .fx{display:flex;flex-direction:column;gap:5px;min-width:0}
  .wrong{font-size:16.5px;color:var(--red);text-decoration:line-through;text-decoration-thickness:1.5px}
  .wrong::before{content:"✗  ";text-decoration:none;display:inline-block;margin-right:4px}
  .right{font-size:21px;font-weight:750;color:var(--green);line-height:1.25}
  .right::before{content:"✓ ";}
  .why{font-size:15.5px;color:var(--muted);line-height:1.35}

  .pairs{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .pair{background:var(--tile);border-radius:16px;padding:16px 14px}
  .pw{font-size:40px;font-weight:800;letter-spacing:-.02em;line-height:1}
  .pair:first-child .pw{color:var(--blue)}
  .ipa{font-family:"DejaVu Sans",sans-serif;font-size:18px;color:var(--muted);margin-top:6px}
  .ptip{font-size:16px;line-height:1.35;margin-top:8px}
  .family{margin-top:14px;font-size:16.5px;line-height:1.45}
  .practice{margin-top:16px;border-top:1.5px solid var(--line);padding-top:14px}
  .say{font-size:22px;font-weight:700;padding:7px 0}
</style></head><body>
${cards.map((c, i) => `<section class="card" id="card-${i + 1}">${header(c, i)}${body[c.type](c)}</section>`).join('\n')}
</body></html>`;

const htmlPath = path.resolve(outDir, 'cards.html');
fs.writeFileSync(htmlPath, html);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 3 });
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const golos = await page.evaluate(() => document.fonts.check('700 20px "Golos Text"'));
  if (!golos) console.warn('warning: Golos Text did not load; cards use the fallback font');
  for (let i = 1; i <= total; i++) {
    const el = await page.$(`#card-${i}`);
    const box = await el.boundingBox();
    const out = path.resolve(outDir, `card-${i}.png`);
    await el.screenshot({ path: out });
    console.log(`card-${i}.png  ${Math.round(box.width)}x${Math.round(box.height)} css px  (${cards[i - 1].type})`);
  }
  await browser.close();
})();
