// Edit mode for song and video lessons (5 quick taps in the top-left corner): change the lesson right where it is,
// then Save writes lesson.json to GitHub (the same GitHub key as the clips page, kept only in this browser).
//   - Tap a word in the lyrics, or drag across a phrase: its Ukrainian, and ⭐ Learn (yellow, its own screen, My words),
//     Later (tapping it says "вивчимо пізніше") or — (a plain word).
//   - On a line's card: click the word, its Ukrainian, an example (select the word and press Ctrl+B: it becomes the gap
//     in My words), the 💡 note or the line's meaning, and type. ✕ takes a word off (no words left: the screen goes);
//     + Example adds one.
//   - The bar under the video: this line's (or part's) Start / End (− / + 0.1 s, then that bit plays; ⏱ = where the
//     video is now), 🗑 the screen, 🔊/🔇 (no sound while editing), Save, ✕ to leave. Ctrl+Z / Ctrl+Y undo and redo.
// The lyrics themselves can't be changed here: they load live from lrclib.net and are never stored.
(() => {
'use strict';
const P = window.Player, L = P.L, esc = P.esc;
const REPO = 'kiril-tishko/craneberries', BRANCH = 'claude/vigilant-ptolemy-ltawsa', KEY = 'rv-github-token';
const FOLDER = location.pathname.split('/').filter((x) => x && x !== 'index.html').pop();
const PATH = `docs/${FOLDER}/lesson.json`;
const $ = (id) => document.getElementById(id);
let token = '';
try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
const SILENT = 'song-edit-mute';
let silent = false;
try { silent = localStorage.getItem(SILENT) === '1'; } catch (e) {}
let msg = '', bad = false, askKey = false, sureT = 0, pop = null, selAt = 0;
const r2 = (x) => Math.round(x * 100) / 100;
const clean = (t) => t.replace(/\s+/g, ' ').trim();

/* ---------- lesson.json ---------- */
// Easy to read in GitHub: one line per screen, one translation per line. Empty examples are left out.
function lessonText(o){
  const j = (x) => JSON.stringify(x), out = ['{'];
  Object.keys(o).filter((k) => !['parts', 'later', 'gloss'].includes(k)).forEach((k) => out.push(`  ${j(k)}: ${j(o[k])},`));
  out.push('  "parts": [');
  o.parts.forEach((p, pi) => {
    const head = {...p}; delete head.lines;
    out.push(`    ${j(head).slice(0, -1)}, "lines": [`);
    p.lines.forEach((l, li) => {
      const x = {...l, words: (l.words || []).map((w) => w.filter((v, n) => n < 2 || clean(String(v).replace(/<[^>]*>/g, ''))))};
      out.push(`      ${j(x)}${li < p.lines.length - 1 ? ',' : ''}`);
    });
    out.push(`    ]}${pi < o.parts.length - 1 ? ',' : ''}`);
  });
  out.push('  ],');
  out.push(`  "later": [${(o.later || []).map(j).join(', ')}],`);
  const g = Object.entries(o.gloss || {});
  out.push('  "gloss": {');
  g.forEach(([k, v], n) => out.push(`    ${j(k)}: ${j(v)}${n < g.length - 1 ? ',' : ''}`));
  out.push('  }', '}');
  return out.join('\n') + '\n';
}
let saved = lessonText(L);
const changed = () => lessonText(L) !== saved;
// Put a whole lesson in place of the one on the page (undo, redo, or the newest saved version).
function load(o){ for (const k of Object.keys(L)) delete L[k]; Object.assign(L, o); }

/* ---------- GitHub ---------- */
const b64 = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
function api(path, opts = {}){
  const url = `https://api.github.com/repos/${REPO}/contents/${path}${opts.method ? '' : `?ref=${encodeURIComponent(BRANCH)}`}`;
  const headers = {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`};
  if (opts.body) headers['Content-Type'] = 'application/json';
  return fetch(url, {...opts, headers, cache: 'no-store'});
}
async function put(path, text, message){
  const g = await api(path);
  if (g.status === 401 || g.status === 403) throw new Error('the GitHub key doesn’t work (check it and its permissions)');
  const old = g.ok ? await g.json() : null;
  if (old && unb64(old.content) === text) return false;
  const r = await api(path, {method: 'PUT', body: JSON.stringify({message, content: b64(text), branch: BRANCH, ...(old ? {sha: old.sha} : {})})});
  if (r.status === 409) throw new Error('it was changed somewhere else a moment ago; reload the page and try again');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return true;
}
async function save(){
  if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
  if (!token) { askKey = true; say('Add the GitHub key once (the same one as on the clips page).', true); render(); return; }
  if (!changed()) { say('Nothing to save: nothing has changed.'); return; }
  say('Saving…');
  try {
    const text = lessonText(L);
    await put(PATH, text, `Song page: ${L.title} (edited on the page)`);
    saved = text;
    say('Saved ✓ The live page shows it within a minute or two.');
  } catch (e) { say(`Not saved: ${e.message || e}`, true); }
  render();
}
window.addEventListener('beforeunload', (e) => { if (changed()) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- on and off ---------- */
P.toggleEdit = async () => {
  P.editing = !P.editing;
  document.body.classList.toggle('editing', P.editing);
  $('etools').hidden = !P.editing;
  closePop(); P.pause();
  P.setSilent(P.editing && silent);
  P.onCard = P.editing ? decorate : null;
  if (P.editing && token && !changed()) {
    // The newest saved version (the live page can be a minute behind).
    try {
      const r = await api(PATH);
      if (r.ok) { const o = JSON.parse(unb64((await r.json()).content)); if (lessonText(o) !== lessonText(L)) { load(o); P.rebuild(); } saved = lessonText(L); }
    } catch (e) {}
  }
  P.redraw(); P.sizeCaption();
  if (!P.editing) $('etools').innerHTML = '';
};

/* ---------- undo and redo ---------- */
const undo = [], redo = [];
const snap = () => JSON.stringify(L);
function keep(s){ undo.push(s); if (undo.length > 300) undo.shift(); redo.length = 0; }
function remember(key){
  const now = Date.now(), last = undo[undo.length - 1];
  if (key && last && last.key === key && now - last.t < 1500) { last.t = now; return; }
  keep({text: snap(), key, t: now});
}
// Typing: the lesson is noted when she clicks into a text, and kept as one undo step once she really types there.
let before = null;
document.addEventListener('focusin', (e) => { before = P.editing && e.target.closest && e.target.closest('#card') ? {text: snap(), key: null, t: 0} : null; });
function typed(){ if (before) { const s = before; before = null; keep(s); } }
function step(from, to, done){
  const s = from.pop();
  if (!s) { say(from === undo ? 'Nothing to undo.' : 'Nothing to redo.'); return; }
  to.push({text: snap(), key: null, t: 0});
  closePop(); load(JSON.parse(s.text)); P.rebuild(); touch(); say(done);
}
document.addEventListener('keydown', (e) => {
  if (!P.editing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : '';   // the key, not the letter: any keyboard layout
  if (!k) return;
  const t = e.target;
  if (t.isContentEditable || (t.closest && t.closest('input, textarea'))) return;   // a field undoes its own typing first
  e.preventDefault();
  if (k === 'z' && !e.shiftKey) step(undo, redo, 'Undone ↶ (Ctrl+Y brings it back)'); else step(redo, undo, 'Back again ↷');
});

/* ---------- the bar under the video ---------- */
function say(text, isBad){ msg = text; bad = !!isBad; const m = $('e-msg'); if (m) { m.textContent = msg; m.className = `msg${bad ? ' bad' : ''}`; } }
function touch(){ const b = $('e-save'); if (b) b.textContent = changed() ? 'Save' : 'Saved ✓'; }
// Times like on YouTube: minutes:seconds to a tenth. Typing "58.3" keeps the minute.
const fmt = (t) => { const x = Math.round(t * 10) / 10, m = Math.floor(x / 60); return `${m}:${(x - m * 60).toFixed(1).padStart(4, '0')}`; };
const parseT = (v) => {
  const p = String(v).trim().replace(',', '.').split(':').map((x) => (x.trim() === '' ? NaN : Number(x)));
  return p.some(isNaN) ? NaN : p.reduce((a, x) => a * 60 + x, 0);
};
const timeBox = (f, name, o) => `<span class="etime"><span class="lbl">${name}</span>
  <button data-nudge="${f}:-0.1" aria-label="${name} 0.1 s earlier">−</button><input type="text" inputmode="decimal" data-t="${f}" value="${fmt(o[f])}" aria-label="${name} (minutes:seconds)"><button data-nudge="${f}:0.1" aria-label="${name} 0.1 s later">+</button><button data-now="${f}" title="Where the video is now" aria-label="${name} where the video is now">⏱</button></span>`;
function render(){
  if (!P.editing) return;
  const s = P.step(), o = P.objOf(s);
  const what = s.kind === 'line' ? 'This line' : s.kind === 'all' ? `${P.parts()[s.pn].name}, all together` : 'My words';
  $('etools').innerHTML = `<span class="what">${esc(what)}</span>
    ${o ? `${timeBox('start', 'Start', o)}${timeBox('end', 'End', o)}` : ''}
    ${s.kind === 'line' ? '<button class="btn" id="e-del">🗑 Screen</button>' : ''}
    <span class="right">
      <button class="btn" id="e-mute" aria-pressed="${silent}" aria-label="${silent ? 'Sound off while editing' : 'Sound on'}" title="${silent ? 'Sound off while editing' : 'Sound on'}">${silent ? '🔇' : '🔊'}</button>
      <button class="btn primary" id="e-save">${changed() ? 'Save' : 'Saved ✓'}</button>
      <button class="btn" id="e-exit" aria-label="Leave edit mode" title="Leave edit mode">✕</button>
    </span>
    ${askKey && !token ? `<div class="keyrow"><input id="e-token" type="password" autocomplete="off" placeholder="GitHub key (github_pat_…)">
      <button class="btn" id="e-token-save">Keep it</button></div>` : ''}
    <div class="msg${bad ? ' bad' : ''}" id="e-msg">${esc(msg)}</div>`;
}
// A line is at most 30 s and a part 3 minutes; Start stays before End. Anything else is refused, with the reason.
function badTime(s, o, f, v){
  const a = f === 'start' ? v : o.start, b = f === 'end' ? v : o.end, max = s.kind === 'line' ? 30 : 180;
  if (isNaN(v) || v < 0) return 'Type the time like 1:04.3 (or just 4.3 for :04.3 in the same minute).';
  if (b <= a) return `End has to be after Start (${fmt(o.start)}).`;
  if (b - a > max) return `That makes it longer than ${max === 30 ? '30 seconds' : '3 minutes'}: check the minutes.`;
  return '';
}
let replayT = 0;
// After a time change: play that bit again (from the new start, or the last 2 seconds before the new end).
function replay(f){
  clearTimeout(replayT);
  replayT = setTimeout(() => { const o = P.objOf(P.step()); if (o) P.play(f === 'end' ? Math.max(o.start, o.end - 2) : undefined); }, 350);
}
// A new time for this line (or part): checked first, then kept for undo, then set; then that bit plays.
function setTime(f, v, key){
  const s = P.step(), o = P.objOf(s); if (!o) return;
  const why = badTime(s, o, f, v);
  if (why) { say(why, true); render(); return; }
  remember(key);
  o[f] = r2(v); P.rebuild(o); touch(); say(''); replay(f);
}
document.addEventListener('change', (e) => {
  const t = e.target; if (!P.editing || !t.dataset || !t.dataset.t) return;
  const o = P.objOf(P.step()); if (!o) return;
  const f = t.dataset.t, raw = t.value.trim();
  let v = parseT(raw);
  if (!isNaN(v) && !raw.includes(':')) v += Math.floor(o[f] / 60) * 60;
  setTime(f, v, null);
});
document.addEventListener('keydown', (e) => { if (P.editing && e.key === 'Enter' && e.target.dataset && (e.target.dataset.t || e.target.id === 'ep-ua')) e.target.blur(); });

/* ---------- the card: type right in it ---------- */
const ed = (el, ph, plain) => {
  el.contentEditable = plain ? 'plaintext-only' : 'true';
  if (plain && el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.spellcheck = false; if (ph) el.dataset.ph = ph;
};
function decorate(s){
  render();
  if (s.kind !== 'line') return;
  const line = P.objOf(s), card = $('card');
  card.querySelectorAll('.w').forEach((row, k) => {
    const w = line.words[k]; if (!w) return;
    const en = row.querySelector('.en'), ua = row.querySelector('.ua');
    Object.assign(en.dataset, {f: 'en', k}); ed(en, 'word', true);
    Object.assign(ua.dataset, {f: 'ua', k}); ed(ua, 'Українською', true);
    row.querySelectorAll('.ex').forEach((p) => p.remove());
    w.slice(2).forEach((x, j) => row.insertAdjacentHTML('beforeend', `<p class="ex" data-f="ex" data-k="${k}" data-j="${j}">${x}</p>`));
    row.querySelectorAll('.ex').forEach((p) => ed(p, 'An example: select the word, then Ctrl+B', false));
    row.insertAdjacentHTML('beforeend', `<div class="wtools"><button data-wadd="${k}">+ Example</button><button data-wdel="${k}">✕ Don’t learn</button></div>`);
  });
  card.querySelectorAll('.tip').forEach((x) => x.remove());
  card.insertAdjacentHTML('beforeend', `<div class="tip"><div class="note" id="note"><p data-f="note">${esc(line.note || '')}</p><p class="meaning" data-f="meaning">${esc(line.meaning || '')}</p></div></div>`);
  ed(card.querySelector('[data-f="note"]'), '💡 Note: something easy to miss (optional)', true);
  ed(card.querySelector('[data-f="meaning"]'), 'What the line means (optional)', true);
}
// Only <em> stays in an example (Ctrl+B or Ctrl+I mark the word); everything else becomes plain text.
function cleanEx(el){
  return el.innerHTML.replace(/<(\/?)(b|strong|i)\b[^>]*>/gi, '<$1em>').replace(/<(?!\/?em>)[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/<em>\s*<\/em>/g, '').replace(/<\/em>(\s*)<em>/g, '$1').trim();
}
document.addEventListener('input', (e) => {
  const t = e.target; if (!P.editing || !t.closest || !t.closest('#card') || !t.dataset.f) return;
  const s = P.step(), line = P.objOf(s); if (!line || s.kind !== 'line') return;
  typed();
  const f = t.dataset.f, k = +t.dataset.k;
  if (f === 'en' || f === 'ua') line.words[k][f === 'en' ? 0 : 1] = clean(t.textContent);
  else if (f === 'ex') line.words[k][2 + +t.dataset.j] = cleanEx(t);
  else { const v = clean(t.textContent); if (v) line[f] = v; else delete line[f]; }
  P.quiet(); touch();
});
document.addEventListener('focusin', (e) => { if (P.editing && e.target.dataset && e.target.dataset.f === 'ex') say('Select the word in the example and press Ctrl+B: it becomes the gap in My words.'); });
document.addEventListener('paste', (e) => {
  if (!P.editing || !e.target.closest || !e.target.closest('#card [contenteditable]')) return;
  e.preventDefault();
  document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '));
});
document.addEventListener('keydown', (e) => {
  if (P.editing && e.target.closest && e.target.closest('#card [contenteditable]') && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); e.target.blur(); }
});

/* ---------- learn, later or plain: tap a word, or drag across a phrase, in the lyrics ---------- */
const base = (t) => P.base(t);
const enOf = (ph) => (/^I(\b|’)/.test(ph) ? ph : ph[0].toLowerCase() + ph.slice(1));
const partAt = (T) => P.parts().find((p) => T >= p.start - 0.3 && T < p.end - 0.1);
function stateOf(ph){
  const b = base(ph);
  for (const p of P.parts()) for (const l of p.lines) {
    const k = (l.hl || []).findIndex((h) => base(h) === b);
    if (k > -1) return {state: 'learn', ua: (l.words[k] || [])[1] || ''};
  }
  const lt = (L.later || []).find(([x]) => base(x) === b);
  if (lt) return {state: 'later', ua: lt[1]};
  return {state: 'none', ua: /\s/.test(ph) ? '' : P.lookup(ph)};
}
function closePop(){ const x = $('epop'); if (x) x.remove(); pop = null; }
function openPop(phrase, T, rect){
  closePop();
  if (!phrase) return;
  const st = stateOf(phrase);
  pop = {phrase, T, ...st};
  const hint = {learn: 'Learned: yellow, with its own screen and in My words.', later: 'Tapping it says “вивчимо пізніше”.', none: 'A plain word: a tap shows the Ukrainian above.'}[st.state];
  document.body.insertAdjacentHTML('beforeend', `<div class="epop" id="epop" role="dialog" aria-label="${esc(phrase)}">
    <b>${esc(phrase)}</b>
    <input id="ep-ua" value="${esc(st.ua)}" placeholder="Українською" spellcheck="false" autocomplete="off">
    <div class="seg" id="ep-state">${[['learn', '⭐ Learn'], ['later', 'Later'], ['none', '—']].map(([v, t]) => `<button data-st="${v}" aria-pressed="${st.state === v}">${t}</button>`).join('')}</div>
    <small>${hint}</small></div>`);
  const el = $('epop'), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.min(innerWidth - w / 2 - 8, Math.max(w / 2 + 8, rect.left + rect.width / 2))}px`;
  el.style.top = `${rect.top - 10 < h + 8 ? rect.bottom + 10 + h : rect.top - 10}px`;
  P.pause();
}
// The words of a lyric line that a drag went across, whole words only.
function dragged(cap, sel){
  const r = sel.getRangeAt(0), text = cap.textContent, pre = document.createRange();
  pre.selectNodeContents(cap); pre.setEnd(r.startContainer, r.startOffset);
  let a = pre.toString().length, b = a + r.toString().length;
  const wc = /[A-Za-z0-9’']/;
  while (a > 0 && wc.test(text[a - 1])) a--;
  while (b < text.length && wc.test(text[b])) b++;
  while (a < b && !wc.test(text[a])) a++;
  while (b > a && !wc.test(text[b - 1])) b--;
  return text.slice(a, b);
}
document.addEventListener('mouseup', () => {
  if (!P.editing) return;
  const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const at = (n) => n && (n.nodeType === 1 ? n : n.parentElement) && (n.nodeType === 1 ? n : n.parentElement).closest('#capbar .cap');
  const cap = at(sel.anchorNode); if (!cap || cap !== at(sel.focusNode)) return;
  const ph = dragged(cap, sel); if (!ph) return;
  selAt = Date.now();
  openPop(ph, +cap.dataset.t, sel.getRangeAt(0).getBoundingClientRect());
  sel.removeAllRanges();
});
document.addEventListener('click', (e) => {
  if (!P.editing) return;
  const w = e.target.closest && e.target.closest('#capbar .tw');
  if (!w) return;
  e.stopPropagation(); e.preventDefault();
  if (Date.now() - selAt < 400) return;   // the end of a drag across a phrase
  const box = w.closest('mark') || w.closest('.ph') || w, cap = w.closest('.cap');
  openPop(clean(box.textContent), +cap.dataset.t, box.getBoundingClientRect());
}, true);
document.addEventListener('click', (e) => {
  if (!P.editing || !pop || Date.now() - selAt < 400) return;
  if (!e.target.closest('#epop')) closePop();
});
function removeLearn(b){
  P.parts().forEach((p) => {
    p.lines = p.lines.filter((l) => {
      const hl = l.hl || [];
      for (let k = hl.length - 1; k >= 0; k--) if (base(hl[k]) === b) { hl.splice(k, 1); l.words.splice(k, 1); }
      return l.words.length > 0;
    });
  });
}
function addLearn(phrase, T, ua){
  const part = partAt(T);
  let line = part.lines.find((l) => T >= l.start - 0.3 && T < l.end - 0.3), made = false;
  if (!line) {
    const next = P.lines().find((x) => x.t > T + 0.05);
    line = {words: [], hl: [], start: r2(Math.max(part.start, T - 0.15)), end: r2(Math.min(part.end, next ? next.t - 0.15 : part.end))};
    part.lines.push(line); part.lines.sort((x, y) => x.start - y.start); made = true;
  }
  line.words = line.words || []; line.hl = line.hl || [];
  line.words.push([enOf(phrase), ua]); line.hl.push(phrase);
  return {part, made};
}
function setState(ns){
  if (!pop || ns === pop.state) return;
  const {phrase, T} = pop, ua = clean($('ep-ua').value) || pop.ua || '', b = base(phrase);
  if (ns === 'learn' && !partAt(T)) { say('This line isn’t in any part, so it can’t have a screen.', true); return; }
  remember(null);
  const here = P.objOf(P.step());
  removeLearn(b);
  L.later = (L.later || []).filter(([x]) => base(x) !== b);
  if (ns === 'learn') {
    const r = addLearn(phrase, T, ua);
    say(`⭐ “${phrase}” is a learn word now${r.made ? `, with a new screen in ${r.part.name}` : ''}. Add an example on its card.`);
  } else if (ns === 'later') { L.later.push([enOf(phrase), ua]); say(`“${phrase}”: later. Tapping it says “вивчимо пізніше”.`); }
  else say(`“${phrase}” is a plain word now.`);
  closePop(); P.rebuild(here); touch();
}
function setUa(v){
  if (!pop) return;
  const b = base(pop.phrase);
  remember(null);
  if (pop.state === 'learn') P.parts().forEach((p) => p.lines.forEach((l) => (l.hl || []).forEach((h, k) => { if (base(h) === b && l.words[k]) l.words[k][1] = v; })));
  else if (pop.state === 'later') (L.later || []).forEach((x) => { if (base(x[0]) === b) x[1] = v; });
  else if (!/\s/.test(pop.phrase)) { const key = b.replace(/^’+|’+$/g, ''); if (v) L.gloss[key] = v; else delete L.gloss[key]; }
  else { undo.pop(); pop.ua = v; return; }   // a plain phrase has no Ukrainian of its own: it's kept for Learn / Later
  pop.ua = v; P.quiet(); P.redraw(); touch(); say('Ukrainian changed.');
}
document.addEventListener('change', (e) => { if (P.editing && e.target.id === 'ep-ua') setUa(clean(e.target.value)); });

/* ---------- buttons ---------- */
document.addEventListener('click', (e) => {
  if (!P.editing) return;
  const b = e.target.closest && e.target.closest('button'); if (!b) return;
  const s = P.step(), o = P.objOf(s);
  if (b.dataset.st) { const v = $('ep-ua'); if (v && pop && clean(v.value) !== pop.ua && pop.state !== 'none') setUa(clean(v.value)); setState(b.dataset.st); return; }
  if (!b.closest('#etools, #card')) return;
  if (b.id === 'e-save') save();
  else if (b.id === 'e-exit') P.toggleEdit();
  else if (b.id === 'e-mute') {
    silent = !silent; try { localStorage.setItem(SILENT, silent ? '1' : '0'); } catch (err) {}
    P.setSilent(silent); render();
  } else if (b.id === 'e-token-save') {
    token = clean($('e-token').value); try { localStorage.setItem(KEY, token); } catch (err) {}
    askKey = false; say(token ? 'Key kept on this computer. Press Save.' : ''); render();
  } else if (b.id === 'e-del' && s.kind === 'line') {
    if (Date.now() - sureT > 3000) { sureT = Date.now(); b.textContent = 'Sure? Tap again'; return; }
    remember(null);
    const part = P.parts()[s.pn]; part.lines = part.lines.filter((l) => l !== o);
    P.rebuild(); touch(); say('Screen removed (its line still plays in All together). Ctrl+Z brings it back.');
  } else if (b.dataset.now && o) {
    setTime(b.dataset.now, r2(P.time()), null);
  } else if (b.dataset.nudge && o) {
    const [f, d] = b.dataset.nudge.split(':');
    setTime(f, r2(o[f] + parseFloat(d)), `nudge-${f}`);
  } else if (b.dataset.wadd != null && s.kind === 'line') {
    const w = o.words[+b.dataset.wadd]; if (!w) return;
    remember(null); while (w.length < 2) w.push(''); w.push('');
    P.quiet(); P.redraw();
    const exs = $('card').querySelectorAll(`.ex[data-k="${b.dataset.wadd}"]`); const last = exs[exs.length - 1]; if (last) last.focus();
  } else if (b.dataset.wdel != null && s.kind === 'line') {
    const k = +b.dataset.wdel, w = o.words[k]; if (!w) return;
    remember(null);
    o.words.splice(k, 1); (o.hl || []).splice(k, 1);
    const gone = !o.words.length;
    if (gone) { const part = P.parts()[s.pn]; part.lines = part.lines.filter((l) => l !== o); }
    P.rebuild(gone ? null : o); touch();
    say(`“${w[0]}” isn’t a learn word now${gone ? ', and its screen is gone (nothing left to learn there)' : ''}. Ctrl+Z brings it back.`);
  }
});
})();
