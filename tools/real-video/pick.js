// Lists YouGlish's US-English clips for a word so Claude can pick the good ones before a lesson.
//   cd tools/real-video && python3 -m http.server 8766   (in another shell)
//   node pick.js "<word or phrase>|<another phrase>|…" <out.txt> [how many per phrase, default 45]
// Phrases give context ("a rip-off|such a rip-off" finds the noun, not "rip off the tape").
// Writes "phrase <tab> clip id <tab> the line" for each clip. Keep the output in the scratchpad, never in
// the repo: only the chosen clip ids go into docs/real-video/index.html (WORDS[].clips).
// Then check the ids: node pick.js --check "<word>" id1,id2,…  (each id must open its own line),
// and get the rows for the page: node pick.js --meta "<word>" id1,id2,…
//   → ['YouTube id', start, end, 'the line'], ready for WORDS[].clips in docs/real-video/index.html.
const {chromium} = require('playwright');
const fs = require('fs');
const URL = 'http://localhost:8766/harvest.html';

async function open(b, stub){
  const p = await b.newPage({viewport: {width: 800, height: 1000}});
  // YouTube refuses to play here. For --check, a stub keeps its error from making YouGlish jump to another
  // clip; for listing, the error is what lets it move on quickly.
  if (stub) await p.route(/youtube\.com\/embed/, r => r.fulfill({status: 200, contentType: 'text/html', body: '<html></html>'}));
  await p.goto(URL); await p.waitForFunction(() => window.READY, null, {timeout: 20000});
  return p;
}
const clean = (t) => t.replace(/\[\[\[|\]\]\]/g, '');

(async () => {
  const b = await chromium.launch();
  if (process.argv[2] === '--meta') {
    const ctx = await b.newContext();
    for (const id of process.argv[4].split(',')) {
      const url = `https://youglish.com/getbyid/${id}/${encodeURIComponent(process.argv[3])}/english/us/emb=1&e_id=w&e_comp=8`;
      const t = (await (await ctx.request.get(url)).text()).replace(/\\(["'\\])/g, '$1');
      const m = t.match(/"cid_track":\{"display":"((?:[^"\\]|\\.)*)".*?"vid":"([\w-]+)","start":"(\d+)","end":"(\d+)"/);
      if (!m) { console.log(id, 'not found'); continue; }
      const line = m[1].replace(/\\"/g, '"').replace(/^"/, '“').replace(/'/g, '’');
      console.log(`    ['${m[2]}', ${m[3]}, ${m[4]}, '${line}'],`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  } else if (process.argv[2] === '--check') {
    const q = process.argv[3];
    for (const id of process.argv[4].split(',')) {
      const p = await open(b, true);
      await p.evaluate(([q, id]) => W.fetch(q, 'english', 'us', id), [q, id]); await p.waitForTimeout(4500);
      const c = (await p.evaluate(() => LOG)).find(l => l[0] === 'cap');
      console.log(id, c && c[1] === id ? 'OK ' : 'WRONG', c ? clean(c[2]) : '(nothing)');
      await p.close();
    }
  } else {
    const [qs, out, n = 45] = process.argv.slice(2);
    const rows = [];
    await Promise.all(qs.split('|').map(async (q) => {
      const p = await open(b, false);
      await p.evaluate((q) => W.fetch(q, 'english', 'us'), q); await p.waitForTimeout(4000);
      for (let k = 1; k < +n; k++) { await p.evaluate(() => W.next()); await p.waitForTimeout(1800); }
      for (const l of await p.evaluate(() => LOG)) if (l[0] === 'cap') rows.push(`${q}\t${l[1]}\t${clean(l[2])}`);
      await p.close();
    }));
    fs.writeFileSync(out, rows.join('\n') + '\n');
    console.log(`${rows.length} clips → ${out}`);
  }
  await b.close();
})();
