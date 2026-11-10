// List every English line a lesson page can speak, with the voice to use (me = learner, them = other person).
const fs = require('fs');
const SECTIONS = eval(fs.readFileSync(process.argv[2], 'utf8') + ';SECTIONS');
const out = new Map();
const add = (t, v) => { if (!t || /\(/.test(t)) return; t = t.trim(); if (t && !out.has(t)) out.set(t, v); };
for (const sec of SECTIONS) for (const s of sec.slides) {
  if (s.t === 'phrase') add(s.en, s.who === 'hear' || s.who === 'read' ? 'them' : 'me');
  if (s.t === 'recall') add(s.en, 'me');
  if (s.t === 'flip') add(s.ans.replace(/[\[\]]/g, ''), 'me');
  if (s.t === 'swap') s.opts.forEach((o) => add(s.pre + o + s.post, 'me'));
  if (s.t === 'all') s.items.forEach(([en, , h]) => add(en, h ? 'them' : 'me'));
  if (s.t === 'turn') { add(s.them, 'them'); add(s.ans, 'me'); add(s.after, 'them'); }
  if (s.t === 'email') s.lines.forEach((t) => add(t, 'me'));
  if (s.t === 'convo') s.lines.forEach(([w, t]) => add(t, w === 'me' ? 'me' : 'them'));
  if (s.t === 'sound') { add(s.say, 'me'); s.words.forEach(([w]) => add(w, 'me')); }
  if (s.t === 'pair') { add(s.a.w, 'me'); add(s.b.w, 'me'); }
  if (s.t === 'game') s.words.forEach(([w]) => add(w, 'me'));
}
console.log(JSON.stringify([...out.entries()]));
