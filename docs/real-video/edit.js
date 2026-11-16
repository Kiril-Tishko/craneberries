// Edit mode (5 quick taps in the top-left corner): change things right where they are, then Save.
//   - Click the caption under the video, the word, its Ukrainian, its emoji or the 💡 note (all dashed) and type.
//     With context, the caption you click is the line shown at that moment (pause there first).
//   - The small bar under the video: where the line starts and ends (− / + = 0.1 s, then it plays that bit again;
//     ⏱ = where the video is now), hide the clip from students, Save.
//   - ⋯ opens the rest: move or delete the clip, add a clip from a YouTube link, the lines around it with their times,
//     the note in the other language, other forms of the word to highlight, the GitHub key.
// Saving writes to the shared library on GitHub (docs/real-video/words/*.json), so every lesson and the lesson chat
// see the change. It needs a GitHub fine-grained token for this one repository (Contents: Read and write), kept only
// in this browser and sent only to api.github.com.
(() => {
'use strict';
const REPO = 'kiril-tishko/craneberries', BRANCH = 'claude/vigilant-ptolemy-ltawsa', DIR = 'docs/real-video/words';
const KEY = 'rv-github-token';
const $ = (id) => document.getElementById(id), esc = App.esc;
let token = '';
try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
// Each word as it was when it was loaded or last saved: Save counts only the words that really differ from it.
const base = {};
const changed = () => Object.keys(base).filter((s) => App.WORDS[s] && wordText(App.WORDS[s]) !== base[s]);
// Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo every change. While typing in a field, Ctrl+Z there first takes
// back the letters, like anywhere else.
const undo = [], redo = [];
// 🔇 in the bar: no sound while editing (remembered in this browser; students always have sound).
const SILENT = 'rv-edit-mute';
let silent = false;
try { silent = localStorage.getItem(SILENT) === '1'; } catch (e) {}
let msg = '', bad = false, sureT = 0, more = false, leaving = false;

/* ---------- GitHub ---------- */
const b64 = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
function api(path, opts = {}){
  const url = `https://api.github.com/repos/${REPO}/contents/${path}${opts.method ? '' : `?ref=${encodeURIComponent(BRANCH)}`}`;
  const headers = {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`};
  if (opts.body) headers['Content-Type'] = 'application/json';
  return fetch(url, {...opts, headers, cache: 'no-store'});
}
async function readJSON(path){
  const r = await api(path);
  if (!r.ok) throw r.status;
  return JSON.parse(unb64((await r.json()).content));
}
async function put(path, text, message){
  const g = await api(path);
  if (g.status === 401 || g.status === 403) throw new Error('the GitHub key doesn’t work (check it and its permissions)');
  const old = g.ok ? await g.json() : null;
  if (old && unb64(old.content) === text) return false; // nothing changed
  const r = await api(path, {method: 'PUT', body: JSON.stringify({message, content: b64(text), branch: BRANCH, ...(old ? {sha: old.sha} : {})})});
  if (r.status === 409) throw new Error('it was changed somewhere else a moment ago; reload the page and try again');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return true;
}
// The files stay easy to read: one clip per line.
function wordText(w){
  const head = {en: w.en || '', ua: w.ua || '', pic: w.pic || ''};
  if (w.hl) head.hl = w.hl;
  const clips = w.clips.map((c) => {
    const o = {v: c.v, s: c.s, e: c.e, line: c.line || ''};
    if (c.note) o.note = c.note;
    if (c.noteUa) o.noteUa = c.noteUa;
    if (c.around && c.around.length) o.around = c.around;
    if (c.hidden) o.hidden = true;
    return `    ${JSON.stringify(o)}`;
  });
  return `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "clips": [${clips.length ? `\n${clips.join(',\n')}\n  ` : ''}]\n}\n`;
}
const indexText = (list) => `[\n${list.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n]\n`;

async function save(){
  if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
  if (!token) { more = true; say('Add the GitHub key first (it’s asked only once on this computer).', true); render(); return; }
  const todo = changed();
  if (!todo.length) { say('Nothing to save: nothing has changed.'); return; }
  say('Saving…');
  try {
    const index = await readJSON(`${DIR}/index.json`).catch(() => App.INDEX.slice());
    for (const slug of todo) {
      const w = App.WORDS[slug], text = wordText(w);
      await put(`${DIR}/${slug}.json`, text, `Real video clips: ${w.en || slug} (edited on the page)`);
      const entry = {slug, en: w.en || slug, ua: w.ua || '', pic: w.pic || '', n: w.clips.filter((c) => !c.hidden).length};
      const i = index.findIndex((x) => x.slug === slug);
      if (i < 0) index.push(entry); else index[i] = entry;
      base[slug] = text;
    }
    index.sort((a, b) => a.en.localeCompare(b.en));
    await put(`${DIR}/index.json`, indexText(index), 'Real video clips: word list (edited on the page)');
    App.INDEX.splice(0, App.INDEX.length, ...index);
    say('Saved ✓ The live page shows it within a minute or two.');
  } catch (e) {
    say(`Not saved: ${e.message || e}`, true);
  }
  render();
}

/* ---------- ↻ make again (../video/remake.js, loaded the first time) ---------- */
const rmkBtn = (kind) => `<button class="rmk-btn" data-rmk="${kind}" title="Make again with Claude" aria-label="Make again with Claude">↻</button>`;
const remake = () => (window.Remake ? Promise.resolve(window.Remake) : new Promise((res, rej) => {
  const sc = document.createElement('script'); sc.src = '../video/remake.js?v=1';
  sc.onload = () => res(window.Remake); sc.onerror = () => rej(new Error('load')); document.head.appendChild(sc);
}));
function openRemake(b){
  const w = App.word, c = App.clip(), kind = b.dataset.rmk, nf = App.NOTES === 'ua' ? 'noteUa' : 'note';
  if (!w || (kind === 'note' && !c)) return;
  remake().then((R) => R.open(b, {
    page: 'clip', kind, lang: App.NOTES, label: kind === 'ua' ? 'Ukrainian' : 'Note',
    en: w.en || '', ua: w.ua || '', line: c ? c.line || '' : '',
    around: c && c.around ? c.around.map((l) => l[2]).join(' / ') : '',
    now: kind === 'ua' ? w.ua || '' : c[nf] || ''
  }, (t) => {
    remember(null);
    if (kind === 'ua') { w.ua = t; App.renderCard(); App.renderChips(); } else { c[nf] = t; App.refresh(); }
    touch(); say('Changed. Ctrl+Z brings the old one back.');
  })).catch(() => say('The ↻ tool didn’t load. Reload the page.', true));
}
// Throw away what isn't saved: every changed word goes back to how it was loaded or last saved.
function discard(){
  for (const slug of changed()) {
    const w = App.WORDS[slug];
    if (!base[slug]) { delete App.WORDS[slug]; delete base[slug]; continue; }
    const o = JSON.parse(base[slug]);
    for (const k of Object.keys(w)) if (k !== 'slug' && k !== 're') delete w[k];
    Object.assign(w, o); App.norm(w, slug);
  }
  undo.length = 0; redo.length = 0;
}

/* ---------- turning edit mode on and off ---------- */
const FIELDS = ['en', 'ua', 'pic', 'note'];   // the card's text you can click and type in
function setEditable(on){
  // ↻ make again (Claude writes another version) beside the Ukrainian and the note.
  document.querySelectorAll('.card .rmk-btn').forEach((x) => x.remove());
  if (on) { $('ua').insertAdjacentHTML('afterend', rmkBtn('ua')); $('note').insertAdjacentHTML('afterend', rmkBtn('note')); }
  for (const id of FIELDS) {
    const el = $(id);
    if (!on) { el.removeAttribute('contenteditable'); continue; }
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = false;
  }
}
App.toggleEdit = async () => {
  const keep = App.clip();
  App.editing = !App.editing; more = false;
  document.body.classList.toggle('editing', App.editing);
  $('etools').hidden = !App.editing; $('edit').hidden = true;
  setEditable(App.editing);
  App.setSilent(App.editing && silent);
  if (App.editing && token) {
    // Edit the newest version (the live page can be a minute behind), unless there are unsaved changes.
    App.getJSON = (path) => readJSON(`${DIR}/${path}`);
    const w = App.word;
    if (w && !changed().includes(w.slug)) {
      try {
        App.WORDS[w.slug] = App.norm(await readJSON(`${DIR}/${w.slug}.json`), w.slug); delete base[w.slug];
        await App.pick(w.slug, false);
        // Stay on the clip that was open (picking the word again starts at its first clip).
        const L = App.list(), i = keep ? L.findIndex((c) => c.v === keep.v && Math.abs(c.s - keep.s) < 0.05) : -1;
        if (i > 0) { App.clipN = i; App.showClip(false); }
        render(); return;
      } catch (e) {}
    }
  }
  if (App.word) {
    const i = App.list().indexOf(keep);
    App.clipN = i < 0 ? 0 : i;
    App.renderCard(); App.showClip(false);
  }
  render();
};
window.addEventListener('beforeunload', (e) => { if (changed().length) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- undo and redo ---------- */
// Called just before a change. Quick repeats of the same thing (typing in one field, several + taps) are one step.
function remember(key){
  const w = App.word; if (!w) return;
  const now = Date.now(), last = undo[undo.length - 1];
  if (key && last && last.key === key && last.slug === w.slug && now - last.t < 1500) { last.t = now; return; }
  keep({slug: w.slug, text: wordText(w), clipN: App.clipN, key, t: now});
}
function keep(s){
  if (!(s.slug in base)) base[s.slug] = s.text;
  undo.push(s); if (undo.length > 300) undo.shift();
  redo.length = 0;
}
// Typing: the word is noted when she clicks into a text, and kept as one undo step once she really types there.
let focusN = 0, before = null;
document.addEventListener('focusin', () => {
  focusN++; const w = App.word;
  before = App.editing && w ? {slug: w.slug, text: wordText(w), clipN: App.clipN, key: null, t: 0} : null;
});
function typed(){ if (before) { const s = before; before = null; keep(s); } }
async function restore(s){
  const w = App.WORDS[s.slug]; if (!w) return;
  const o = JSON.parse(s.text);
  for (const k of ['en', 'ua', 'pic', 'hl']) { if (k in o) w[k] = o[k]; else delete w[k]; }
  w.clips = o.clips; App.norm(w, s.slug);
  if (App.word !== w) await App.pick(s.slug, false);
  App.clipN = Math.max(0, Math.min(s.clipN, App.list().length - 1));
  App.renderCard(); App.renderChips(); App.sizeCaption(); App.showClip(false);
  render();
}
function step(from, to, done){
  const s = from.pop();
  if (!s) { say(from === undo ? 'Nothing to undo.' : 'Nothing to redo.'); return; }
  const w = App.WORDS[s.slug];
  if (w) to.push({slug: s.slug, text: wordText(w), clipN: App.word === w ? App.clipN : s.clipN, key: null, t: 0});
  say(done); restore(s);
}
document.addEventListener('keydown', (e) => {
  if (!App.editing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  // The key itself (KeyZ), not the letter: with the Ukrainian layout on, Ctrl+Z gives "я".
  const k = e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : '';
  if (!k) return;
  // In a field, Ctrl+Z first takes back the typing there, the usual way.
  const t = e.target;
  if (t.isContentEditable || (t.closest && t.closest('input, textarea'))) return;
  e.preventDefault();
  if (k === 'z' && !e.shiftKey) step(undo, redo, 'Undone ↶ (Ctrl+Y brings it back)');
  else step(redo, undo, 'Back again ↷');
});

/* ---------- the bar under the video, and ⋯ ---------- */
function say(text, isBad){ msg = text; bad = !!isBad; const m = $('e-msg'); if (m) { m.textContent = msg; m.className = `msg${bad ? ' bad' : ''}`; } }
const saveLabel = (n) => (n ? `Save (${n} word${n > 1 ? 's' : ''})` : 'Save');
function touch(){
  const b = $('e-save'), n = changed();
  if (b) { b.textContent = saveLabel(n.length); b.title = n.length ? `Not saved yet: ${n.map((s) => App.WORDS[s].en || s).join(', ')}` : 'Nothing to save'; }
}
const r2 = (x) => Math.round(x * 100) / 100;
const aroundText = (a) => (a || []).map((l) => `${l[0]} | ${l[1]} | ${l[2]}`).join('\n');
const parseAround = (t) => t.split('\n').map((l) => l.split('|').map((x) => x.trim()))
  .filter((p) => p.length >= 3 && !isNaN(parseFloat(p[0])) && !isNaN(parseFloat(p[1])))
  .map((p) => [parseFloat(p[0]), parseFloat(p[1]), p.slice(2).join(' | ')]);
// A YouTube link with a time: youtu.be/ID?t=83, watch?v=ID&t=1m23s, /shorts/ID, /embed/ID?start=83.
function parseLink(text){
  let u;
  try { u = new URL(text.trim()); } catch (e) { return null; }
  let v = u.searchParams.get('v');
  if (!v && /youtu\.be$/.test(u.hostname)) v = u.pathname.slice(1);
  if (!v) { const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/); if (m) v = m[1]; }
  if (!v || !/^[\w-]{11}$/.test(v)) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([\dhms]+)/) || [])[1] || '0';
  let s = 0;
  if (/^\d+(\.\d+)?$/.test(t)) s = parseFloat(t);
  else { const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/); s = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); }
  return {v, s};
}

// Times show like on YouTube, minutes:seconds to a tenth (48:54.3); she can type them that way too (or in seconds).
const fmt = (t) => { const x = Math.round(t * 10) / 10, m = Math.floor(x / 60); return `${m}:${(x - m * 60).toFixed(1).padStart(4, '0')}`; };
const parseT = (v) => {
  const p = String(v).trim().replace(',', '.').split(':').map((x) => (x.trim() === '' ? NaN : Number(x)));
  return p.some(isNaN) ? NaN : p.reduce((a, x) => a * 60 + x, 0);
};
const timeBox = (f, name, c) => `<span class="etime"><span class="lbl">${name}</span>
  <button data-nudge="${f}:-0.1" aria-label="${name} 0.1 s earlier">−</button><input type="text" inputmode="decimal" data-t="${f}" value="${fmt(c[f])}" aria-label="${name} (minutes:seconds)"><button data-nudge="${f}:0.1" aria-label="${name} 0.1 s later">+</button><button data-now="${f}" title="Where the video is now" aria-label="${name} where the video is now">⏱</button></span>`;
function render(){
  if (!App.editing) return;
  const w = App.word, L = App.list(), c = App.clip();
  const other = App.NOTES === 'ua' ? 'note' : 'noteUa';
  $('etools').innerHTML = `
    ${c ? `${timeBox('s', 'Start', c)}${timeBox('e', 'End', c)}
    <button class="btn" data-act="hide" aria-pressed="${!!c.hidden}">${c.hidden ? '🙈 Hidden' : '🙈 Hide'}</button>` : ''}
    <span class="right">
      <button class="btn" id="e-mute" aria-pressed="${silent}" aria-label="${silent ? 'Sound off while editing' : 'Sound on'}" title="${silent ? 'Sound off while editing' : 'Sound on'}">${silent ? '🔇' : '🔊'}</button>
      <button class="btn primary" id="e-save">${saveLabel(changed().length)}</button>
      <button class="btn" id="e-more" aria-expanded="${more}" aria-label="More" title="More">⋯</button>
      <button class="btn" id="e-exit" aria-label="Leave edit mode" title="Leave edit mode">✕</button>
    </span>
    ${leaving ? `<div class="msg"><b>Not saved yet.</b> <button class="btn primary" id="e-leave-save">Save and leave</button>
      <button class="btn" id="e-leave-drop">Throw the changes away</button> <button class="btn" id="e-leave-stay">Keep editing</button></div>` : ''}
    <div class="msg${bad ? ' bad' : ''}" id="e-msg">${esc(msg)}</div>`;
  $('edit').hidden = !more;
  if (!more) { $('edit').innerHTML = ''; return; }
  $('edit').innerHTML = `
    ${token ? '' : `
    <div class="row"><label>GitHub key, needed once on this computer to save
      <input id="e-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn" id="e-token-save">Keep it</button></div>
    <div class="msg">Make one at <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens</a>:
      repository <b>craneberries</b> only, permission <b>Contents: Read and write</b>.</div>`}
    ${c ? `
    <h3>Clip ${App.clipN + 1} / ${L.length}
      <button class="btn" data-act="up" ${App.clipN ? '' : 'disabled'}>◀ Move</button>
      <button class="btn" data-act="down" ${App.clipN < L.length - 1 ? '' : 'disabled'}>Move ▶</button>
      <button class="btn" data-act="del">Delete</button>
      <a class="btn" href="https://www.youtube.com/watch?v=${esc(c.v)}&t=${Math.floor(c.s)}s" target="_blank" rel="noopener">Open on YouTube ↗</a></h3>
    <div class="row"><label>Lines around it, for “With context” (one per line: start | end | text)<textarea data-c="around">${esc(aroundText(c.around))}</textarea></label></div>
    <div class="row"><label>💡 Note in ${other === 'noteUa' ? 'Ukrainian (used with &amp;notes=ua)' : 'English'}<textarea data-c="${other}">${esc(c[other] || '')}</textarea></label></div>` : ''}
    ${w ? `
    <div class="row"><label>Add a clip: paste a YouTube link with the time (…?t=83)<input id="e-link" placeholder="https://youtu.be/…?t=83"></label>
      <button class="btn" id="e-add">Add clip</button></div>
    <div class="row"><label>Other forms of the word to highlight (e.g. rip[- ]?off)<input data-w="hl" value="${esc(w.hl || '')}"></label></div>` : ''}
    ${token ? '<div class="row"><button class="btn" id="e-forget">Forget the GitHub key on this computer</button></div>' : ''}`;
}
App.onClip = render;
App.newWord = (text) => {
  const slug = App.slugify(text);
  if (!slug) return;
  if (App.INDEX.some((x) => x.slug === slug) || App.WORDS[slug]) { App.pick(slug, false); return; }
  App.WORDS[slug] = App.norm({en: text, ua: '', pic: '', clips: []}, slug);
  base[slug] = '';   // new: counts as changed until it is saved
  say(`New word “${text}”: type its Ukrainian and an emoji on the card, add clips (⋯), then save.`);
  App.pick(slug, false);
};
App.missing = (slug) => {
  say(`“${slug.replace(/-/g, ' ')}” isn’t in the library yet.`);
  const m = $('e-msg');
  if (m) m.insertAdjacentHTML('beforeend', ` <button class="btn" id="e-create" data-slug="${esc(slug)}">Create it</button>`);
};

/* ---------- typing right on the page ---------- */
const inCap = (t) => t.closest && t.closest('#capbar');
document.addEventListener('focusin', (e) => { if (App.editing && inCap(e.target)) App.pause(); });
document.addEventListener('input', (e) => {
  if (!App.editing) return;
  const t = e.target, w = App.word, c = App.clip();
  if (inCap(t) && t.isContentEditable) { if (c) { typed(); App.setShownLine(t.textContent.replace(/\s+/g, ' ').trim()); touch(); } return; }
  if (!t.isContentEditable || !FIELDS.includes(t.id) || !w) return;
  typed();
  const v = t.textContent.replace(/\s+/g, ' ').trim();
  if (t.id === 'note') { if (c) { c[App.NOTES === 'ua' ? 'noteUa' : 'note'] = v; touch(); } return; }
  w[t.id] = v; App.norm(w, w.slug); App.renderChips(); touch();
});
// Done typing (click elsewhere, Enter or Esc): show it the way students see it, with the word in yellow.
document.addEventListener('focusout', (e) => {
  if (!App.editing || !e.target.isContentEditable) return;
  if (inCap(e.target) || e.target.id === 'en') { App.refresh(); App.sizeCaption(); }
});
document.addEventListener('keydown', (e) => {
  if (App.editing && e.target.isContentEditable && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); e.target.blur(); }
});
// Pasted text arrives as plain text.
document.addEventListener('paste', (e) => {
  if (!App.editing || !e.target.closest || !e.target.closest('[contenteditable]')) return;
  e.preventDefault();
  document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '));
});

/* ---------- the bar's and ⋯'s fields and buttons ---------- */
let replayT = 0;
// After a − / + on a time: play that bit again (from the new start, or the last second and a half before the end).
function replay(f){
  clearTimeout(replayT);
  replayT = setTimeout(() => { const c = App.clip(); if (c) App.playClip(f === 'e' ? Math.max(c.s - 0.1, c.e - 1.5) : undefined); }, 350);
}
const zone = (t) => t.closest && t.closest('#etools, #edit');
document.addEventListener('input', (e) => {
  const t = e.target; if (!App.editing || !zone(t)) return;
  const w = App.word, c = App.clip();
  if ((t.dataset.w && w) || (t.dataset.c && c)) typed();
  if (t.dataset.w && w) {
    w[t.dataset.w] = t.value.trim() ? t.value : '';
    App.norm(w, w.slug); App.renderChips(); App.refresh(); touch();
  } else if (t.dataset.c && c) {
    const f = t.dataset.c;
    if (f === 'around') c.around = parseAround(t.value);
    else c[f] = t.value;
    App.refresh(); touch();
  }
});
// Start must stay before End, and a clip is at most 30 s long: anything else is refused (and says why).
function badTime(c, f, v){
  const s = f === 's' ? v : c.s, e = f === 'e' ? v : c.e;
  if (isNaN(v) || v < 0) return 'Type the time like 21:58.3 (or just 58.3 for :58.3 in the same minute).';
  if (e <= s) return `End has to be after Start (${fmt(c.s)}).`;
  if (e - s > 30) return 'That makes the clip longer than 30 seconds: check the minutes.';
  return '';
}
// A typed time counts when she leaves the box or presses Enter: 21:58.3, or just 58.3 = :58.3 in the same minute.
document.addEventListener('change', (e) => {
  const t = e.target, c = App.clip(); if (!App.editing || !t.dataset || !t.dataset.t || !c) return;
  const f = t.dataset.t, raw = t.value.trim();
  let v = parseT(raw);
  if (!isNaN(v) && !raw.includes(':')) v += Math.floor(c[f] / 60) * 60;
  const why = badTime(c, f, v);
  if (why) { say(why, true); t.value = fmt(c[f]); return; }
  remember(null); c[f] = r2(v); t.value = fmt(c[f]); touch(); say(''); App.refresh(); replay(f);
});
document.addEventListener('keydown', (e) => { if (App.editing && e.key === 'Enter' && e.target.dataset && e.target.dataset.t) e.target.blur(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button'); if (!b || !App.editing) return;
  if (b.dataset.rmk) { openRemake(b); return; }
  if (!zone(b)) return;
  const w = App.word, c = App.clip();
  if (b.id === 'e-save') save();
  // Leaving with changes that aren't saved asks first: save them, throw them away, or stay.
  else if (b.id === 'e-exit') { if (changed().length) { leaving = true; render(); } else App.toggleEdit(); }
  else if (b.id === 'e-leave-stay') { leaving = false; render(); }
  else if (b.id === 'e-leave-save') { leaving = false; save().then(() => { if (!changed().length) App.toggleEdit(); else render(); }); }
  else if (b.id === 'e-leave-drop') {
    leaving = false; discard(); say('');
    if (App.word && !App.WORDS[App.word.slug] && App.INDEX[0]) App.pick(App.INDEX[0].slug, false);
    App.toggleEdit();
  }
  else if (b.id === 'e-mute') {
    silent = !silent; try { localStorage.setItem(SILENT, silent ? '1' : '0'); } catch (err) {}
    App.setSilent(silent); render();
  }
  else if (b.id === 'e-more') { more = !more; render(); }
  else if (b.id === 'e-token-save') {
    token = $('e-token').value.trim();
    try { localStorage.setItem(KEY, token); } catch (err) {}
    App.getJSON = (path) => readJSON(`${DIR}/${path}`);
    say(token ? 'Key kept on this computer.' : ''); render();
  } else if (b.id === 'e-forget') {
    token = ''; try { localStorage.removeItem(KEY); } catch (err) {}
    say('The key is forgotten on this computer.'); render();
  } else if (b.id === 'e-create') App.newWord(b.dataset.slug.replace(/-/g, ' '));
  else if (b.id === 'e-add') {
    const p = parseLink($('e-link').value);
    if (!p) { say('That doesn’t look like a YouTube link.', true); return; }
    remember(null);
    const nc = {v: p.v, s: p.s, e: r2(p.s + 2), line: '', note: ''};
    const i = c ? w.clips.indexOf(c) + 1 : w.clips.length;
    w.clips.splice(i, 0, nc); App.clipN = App.list().indexOf(nc);
    touch(); say('Clip added. Play it, set Start and End (⏱ or − / +), click the caption to type the line, then save.');
    App.showClip(false);
  } else if (b.dataset.act && c) {
    const i = w.clips.indexOf(c);
    if (b.dataset.act === 'up' || b.dataset.act === 'down') {
      const j = i + (b.dataset.act === 'up' ? -1 : 1);
      if (j < 0 || j >= w.clips.length) return;
      remember(null);
      [w.clips[i], w.clips[j]] = [w.clips[j], w.clips[i]];
      App.clipN = App.list().indexOf(c); touch(); App.showClip(false);
    } else if (b.dataset.act === 'hide') {
      remember(null);
      c.hidden = !c.hidden; touch();
      say(c.hidden ? 'Hidden: students won’t see this clip (after you save).' : 'Shown to students again (after you save).');
      render();
    } else if (b.dataset.act === 'del') {
      if (Date.now() - sureT > 3000) { sureT = Date.now(); b.textContent = 'Sure? Tap again'; return; }
      remember(null);
      w.clips.splice(i, 1); App.clipN = Math.max(0, i - 1); touch(); say('Clip deleted (Ctrl+Z brings it back; save to keep it that way).');
      App.showClip(false);
    }
  } else if (b.dataset.now && c) {
    const f = b.dataset.now, v = r2(App.now()), why = badTime(c, f, v);
    if (why) { say(why, true); return; }
    remember(null);
    c[f] = v; touch(); App.refresh(); render();
  } else if (b.dataset.nudge && c) {
    const [f, d] = b.dataset.nudge.split(':'), v = r2(c[f] + parseFloat(d)), why = badTime(c, f, v);
    if (why) { say(why, true); return; }
    remember(`nudge-${f}`);
    c[f] = v; touch(); App.refresh();
    const inp = $('etools').querySelector(`[data-t="${f}"]`); if (inp) inp.value = fmt(c[f]);
    replay(f);
  }
});
})();
