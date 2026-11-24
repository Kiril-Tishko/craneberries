// Real video clips: native speakers say the word in short YouTube clips, played in our own player.
// The clips live in a shared library, one file per word: words/<slug>.json (words/index.json lists them all).
//   …/real-video/                          the whole library
//   …/real-video/?words=rip-off,excuse     a lesson's words, in this order
//     &title=At the shop                   the lesson's name at the top
//     &notes=ua                            💡 notes in Ukrainian where a clip has one (otherwise English)
//     &from=lesson                         a "← Lesson" button that closes this tab, back to the lesson page
//   #w=excuse                              open this word first
//   ?mute                                  plays without sound (for testing)
//   &listen                                listen first: each clip plays with its caption hidden (blurred), which
//                                          shows only on a tap on it (not at the clip's end: his rule, Nov 21)
//   &embed                                 inside a lesson screen (below)
// CC beside the timeline hides the subtitles (blurred) everywhere: every clip, every lesson, after a reload too, until
// CC is tapped again (kept in this browser). A tap on the blurred line shows just that one.
// Tapping the top-left corner 5 times opens edit mode (edit.js): click the text on the page and type, times and Save
// in a small bar under the video.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slugify = (t) => String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const Q = new URLSearchParams(location.search);
// ?embed: inside a lesson slide (the student site): no heading (one word) or just the row of words, then the video
// and its controls (index.html CSS).
const EMBED = Q.has('embed');
if (EMBED) document.body.classList.add('embed');
// ?embed: the video is as big as the screen's height allows once the timeline, the caption and the buttons have their
// room. Those keep the slide's whole width, so their height doesn't change with the video's width: one measure fits.
// A low, wide screen (a phone on its side) puts the caption and the buttons beside the video instead ('short').
function fitEmbed(){
  if (!EMBED) return;
  const app = document.querySelector('.app'), video = document.querySelector('.video'), B = document.body.classList;
  const W = document.documentElement.clientWidth, H = innerHeight, short = H < 340 && W > H * 1.6;
  B.toggle('short', short);
  // The clip arrows: beside the video when there is room, otherwise on its edges ('ovl').
  B.toggle('ovl', short || W < 560);
  for (let k = 0; k < 3; k++) {
    const others = app.getBoundingClientRect().height - video.getBoundingClientRect().height;
    const side = !B.contains('ovl') && !B.contains('single') ? 2 * (46 + 8) : 0;
    const w = Math.max(160, Math.min(short ? Math.floor(W * 0.58) : W - side, 1100, Math.floor((H - others - 4) * 16 / 9)));
    if (app.style.getPropertyValue('--vw') === `${w}px`) break;
    app.style.setProperty('--vw', `${w}px`);
  }
}
if (EMBED) { addEventListener('resize', fitEmbed); if (document.fonts) document.fonts.ready.then(fitEmbed); }
const NOTES = Q.get('notes') === 'ua' ? 'ua' : 'en';
const MUTE = Q.has('mute');   // …?mute plays without sound (for testing)
// Hidden subtitles: the caption is blurred (it keeps its place, so nothing moves); a tap on it shows it at once.
// ?listen: every clip starts hidden and its caption stays hidden at the end too, until it is tapped (Nov 21).
// CC: hides them for this clip and the next ones (they stay hidden at the end), until CC is tapped again.
// capHidden = the caption shown now is blurred; subsOff = CC is on, so each new clip starts blurred. Edit mode always shows it.
const LISTEN = Q.has('listen');
const SUBS = 'clips-subs-off';
const subsSaved = () => { try { return localStorage.getItem(SUBS) === '1'; } catch (e) { return false; } };
let capHidden = false, subsOff = subsSaved();
function saveSubs(){ try { if (subsOff) localStorage.setItem(SUBS, '1'); else localStorage.removeItem(SUBS); } catch (e) {} }
// The page's base: here, or this folder when the student site (kiril-tishko/lessons site/clips/) shows this page.
const LIB = new URL('words/', document.baseURI);

// Exact times (with decimals, from Caption Search or set in edit mode): start just before the line and stop when it
// ends, before the next line. Whole-second times (YouGlish): start a bit early, stop about a second later (or at the
// next line).
const EXACT_BEFORE = 0.1, EXACT_AFTER = 0.12, PAD_BEFORE = 0.4, PAD_AFTER = 1.2, LONGER_BEFORE = 6, LONGER_AFTER = 4;
const STEP = 1; // ← → and double-tap move this many seconds

let INDEX = [], ORDER = [], cur = '', word = null;
// The whole library (no ?words, not in a lesson): its words come in topics, words/groups.json = [{name, pic, words}].
const SHELF = !Q.get('words') && !Q.has('embed');
let GROUPS = [], shelf = '', shelfFor = null;
const WORDS = {};
// Words under the video that are slang, rude or just too hard to learn now say so in their tap bubble: a dot and a
// short, small note under the translation, the dot bigger the stronger the slang (his wish, Nov 24: nothing in the
// captions themselves, only "when you hit on that word"). words/tags.json = {slang: [...], vslang: [...], rude: [...],
// hard: [...]} for the whole library (words and `together` phrases, written like gloss keys); a word file's own
// "tags": {"word": "slang" | "vslang" | "rude" | "hard" | ""} wins for its clips ("" = nothing there).
let TAGS = new Map();
const TAG_SAY = {
  slang: 'сленг · можна не вчити',
  vslang: 'дуже сленгове · не вчити',
  rude: 'грубе слово · не вживати',
  hard: 'складне · можна не вчити',
};
function tagMap(t){
  const m = new Map();
  if (t && typeof t === 'object') for (const kind of Object.keys(TAG_SAY)) for (const k of t[kind] || []) m.set(wbase(String(k)), kind);
  return m;
}
function tagOf(key){
  const own = word && word.tags;
  const k = wbase(key).replace(/^’+|’+$/g, '');
  for (const x of [k, k.replace(/’s$/, '')]) {
    if (own && Object.prototype.hasOwnProperty.call(own, x)) return TAG_SAY[own[x]] ? own[x] : '';
    if (TAGS.has(x)) return TAGS.get(x);
  }
  return '';
}
const tagAttr = (kind) => (kind ? `" data-tag="${kind}` : '');   // nothing shows in the caption: the bubble reads it
let clipN = 0, rate = 1, wantPlay = null, longerMode = false;
// "With context" is for this clip only; press and hold it, and it stays on for the next clips too.
let contextHeld = false;
// The line now in the caption bar: null = the clip's own line, else one of its lines around (with context).
let lineRef = null;
let range = null, started = false, ended = false, endedAt = 0, shown = null, loadedAt = 0, dragging = false;
// `intent` is what you last asked for (play or pause). Play/pause buttons follow it, not the player's state, so a
// press counts even while a clip is still loading.
let intent = false;

// Shared with edit.js.
const App = {
  editing: false, WORDS, slugify, esc, NOTES,
  get INDEX(){ return INDEX; }, get ORDER(){ return ORDER; }, get word(){ return word; },
  get clipN(){ return clipN; }, set clipN(n){ clipN = n; },
  list: () => list(), clip: () => clip(), now: () => (ready() ? P().getCurrentTime() : 0),
  getJSON: (path) => fetch(new URL(path, LIB), {cache: 'no-cache'}).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
};

/* ---------- the library ---------- */
function norm(w, slug){
  w.slug = slug; w.clips = Array.isArray(w.clips) ? w.clips : [];
  try { w.re = new RegExp(w.hl || escRe(w.en || slug), 'gi'); } catch (e) { w.re = new RegExp(escRe(w.en || slug), 'gi'); }
  return w;
}
App.norm = norm;
// Hidden clips are skipped, except in edit mode.
const list = () => (!word ? [] : App.editing ? word.clips : word.clips.filter((c) => !c.hidden));
const clip = () => list()[clipN];
const label = (slug) => {
  const w = WORDS[slug] || INDEX.find((x) => x.slug === slug);
  return w ? `${w.pic ? w.pic + ' ' : ''}${w.en}` : slug.replace(/-/g, ' ');
};

async function init(){
  INDEX = await App.getJSON('index.json').catch(() => []);
  if (!Array.isArray(INDEX)) INDEX = [];
  if (SHELF) { GROUPS = await App.getJSON('groups.json').catch(() => []); if (!Array.isArray(GROUPS)) GROUPS = []; }
  TAGS = tagMap(await App.getJSON('tags.json').catch(() => null));
  const want = Q.get('words');
  ORDER = want ? want.split(',').map(slugify).filter(Boolean) : INDEX.map((x) => x.slug);
  if (Q.get('title')) { $('ltitle').textContent = `🎬 ${Q.get('title')}`; $('ltitle').hidden = false; }
  if (Q.get('from') === 'lesson') $('back').hidden = false;
  renderChips();
  const h = slugify(decodeURIComponent(location.hash.replace(/^#w=/, '')));
  // The whole library opens on the first topic's first word.
  const first = SHELF && GROUPS.length ? GROUPS.flatMap((g) => g.words || []).find((s) => ORDER.includes(s)) || ORDER[0] : ORDER[0];
  if (ORDER.length) await pick(ORDER.includes(h) ? h : first, false);
  else showLine('', 'No words yet.');
  // Inside a lesson screen: tell the lesson the clips are laid out, so it swaps its grey placeholders for them.
  if (EMBED && parent !== window) setTimeout(() => parent.postMessage({clipsReady: true}, '*'), 150);
}
function renderChips(){
  // In a lesson screen (?embed) with one word: no heading at all (the lesson's screen before it shows the word), so
  // the video gets that room.
  if (EMBED && ORDER.length === 1) { document.body.classList.add('one'); $('words').innerHTML = ''; fitEmbed(); return; }
  const chip = (s) => `<button data-w="${esc(s)}" aria-current="${s === cur}">${esc(label(s))}</button>`;
  if (!SHELF || !GROUPS.length) { $('words').innerHTML = ORDER.map(chip).join(''); return; }
  // The whole library: a row of topics, and under it the words of one topic (the current word's, until another
  // topic is tapped). Words in no topic yet (a new one, say) go under "More".
  const shelves = GROUPS.map((g) => ({name: g.name, pic: g.pic, words: (g.words || []).filter((s) => ORDER.includes(s))}));
  const more = ORDER.filter((s) => !shelves.some((g) => g.words.includes(s)));
  if (more.length) shelves.push({name: 'More', pic: '✨', words: more});
  const list = shelves.filter((g) => g.words.length);
  if (cur !== shelfFor) { shelfFor = cur; shelf = (list.find((g) => g.words.includes(cur)) || list[0] || {}).name; }
  const open = list.find((g) => g.name === shelf) || list[0];
  $('words').classList.add('shelf');
  $('words').innerHTML = `<div class="gtabs" role="tablist" aria-label="Topics">${list.map((g) => `<button role="tab" data-g="${esc(g.name)}"
    aria-selected="${g === open}"><span aria-hidden="true">${esc(g.pic || '')}</span>${esc(g.name)}<small>${g.words.length}</small></button>`).join('')}</div>
    <div class="gwords" role="tabpanel">${open.words.map(chip).join('')}</div>`;
  // Where a row scrolls sideways (a phone), the open topic and the current word are brought into view (sideways only:
  // the page itself never jumps).
  const show = (row, el) => { if (row && el && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, el.offsetLeft - row.offsetLeft - 40); };
  show($('words').querySelector('.gtabs'), $('words').querySelector('[aria-selected="true"]'));
  show($('words').querySelector('.gwords'), $('words').querySelector('.gwords [aria-current="true"]'));
}
App.renderChips = renderChips;
$('words').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.g) { shelf = b.dataset.g; renderChips(); return; }
  pick(b.dataset.w, true);
};

let pickSeq = 0;
async function pick(slug, play){
  const seq = ++pickSeq;
  let w = WORDS[slug];
  if (!w) {
    try { w = norm(await App.getJSON(`${slug}.json`), slug); } catch (e) { w = null; }
    if (seq !== pickSeq) return;
    if (!w) {
      // Not in the library: say so, with an empty card and player (edit mode offers to create it).
      cur = slug; word = null; range = null; started = ended = intent = false;
      if (S().ready) P().pauseVideo();
      renderChips(); $('pic').textContent = ''; $('en').textContent = slug.replace(/-/g, ' '); $('ua').hidden = true;
      setNote(''); drawTimeline(0); setCover(); drawCount(0, 0);
      showLine('', `“${slug.replace(/-/g, ' ')}” isn’t in the library yet.`);
      if (App.editing && App.missing) App.missing(slug);
      return;
    }
    WORDS[slug] = w;
  }
  cur = slug; word = w; clipN = 0; resetContext();
  if (!ORDER.includes(slug)) ORDER.push(slug); // a word found with the search joins the row
  renderChips(); renderCard(); sizeCaption(); fitEmbed();
  const u = new URL(location.href); u.hash = `w=${slug}`; history.replaceState(null, '', u.href);
  showClip(play);
}
App.pick = pick;
function renderCard(){
  $('pic').textContent = word.pic || ''; $('en').textContent = word.en || ''; $('ua').textContent = word.ua || '';
  $('ua').hidden = !word.ua && !App.editing;
}
App.renderCard = renderCard;

/* ---------- one clip ---------- */
// Which clip of how many: "2 / 4", and inside a lesson the lesson's own progress dots instead.
function drawCount(n, i){
  $('count').textContent = n ? `${i + 1} / ${n}` : '0 / 0';
  $('cdots').innerHTML = n > 1 ? Array.from({length: n}, (_, k) => `<i class="${k === i ? 'on' : ''}" data-k="${k}"></i>`).join('') : '';
  // Inside a lesson: the arrows beside the video (none back on the first clip, none forward on the last).
  $('sprev').disabled = i <= 0; $('snext').disabled = i >= n - 1;
  if (EMBED && document.body.classList.toggle('single', n < 2) !== single) { single = !single; fitEmbed(); }
}
let single = false;
function showClip(play){
  const L = list();
  drawCount(L.length, clipN);
  started = false; ended = false; intent = false;
  if (!L.length) {
    range = null; showLine('', 'No clips for this word yet.'); setNote(''); drawTimeline(0); setCover();
    if (App.onClip) App.onClip();
    return;
  }
  clipN = Math.min(Math.max(clipN, 0), L.length - 1);
  const c = L[clipN];
  setNote(NOTES === 'ua' && c.noteUa ? c.noteUa : c.note || '');
  capHidden = (LISTEN || subsOff) && !App.editing; drawCC();
  document.querySelector('.video').classList.toggle('tall', !!c.tall);   // a YouTube Short: index.html moves the crop up
  loadSong(c);
  showLine(lineOf(c));
  range = rangeOf(c, longerMode); drawTimeline(range.from);
  // The next clip may already be waiting in the hidden player: then it simply comes to the front.
  const other = slots[1 - act];
  if (other.ready && other.vid === c.v) {
    if (S().ready) { P().pauseVideo(); P().mute(); }
    act = 1 - act;
    slots.forEach((s, i) => s.p && s.p.getIframe().classList.toggle('on', i === act));
  }
  if (play) playClip(); else warm(S(), c, range.from);
  setCover();
  if (L.length > 1) { const n = L[(clipN + 1) % L.length]; loadSong(n); warm(slots[1 - act], n, rangeOf(n, longerMode).from); }
  if (App.onClip) App.onClip();
}
App.showClip = showClip;
// After an edit: show the clip's new text and times without reloading the video.
App.refresh = () => {
  const c = clip(); if (!c) { showClip(false); return; }
  range = rangeOf(c, longerMode); shown = null;
  if (!started) drawTimeline(range.from);
  showLine(lineOf(c)); setNote(NOTES === 'ua' && c.noteUa ? c.noteUa : c.note || ''); sizeCaption();
  drawCount(list().length, clipN);
};
// In edit mode the note is always open, so it can be clicked and typed in.
function setNote(text){
  // Inside a lesson: 💡 opens the note over the video (closed again for every clip).
  $('tipnote').textContent = text; $('tipnote').hidden = true; $('tipe').setAttribute('aria-pressed', 'false');
  $('tipe').style.visibility = text ? 'visible' : 'hidden';
  $('note').textContent = text; $('note').classList.toggle('off', !App.editing);
  $('tipbtn').setAttribute('aria-expanded', String(App.editing));
  $('tip').style.visibility = text || App.editing ? 'visible' : 'hidden';
}
function showLine(text, plain, ref){
  lineRef = ref || null; hidePop();
  const cens = capHidden && !plain && !App.editing && !!word;
  $('capbar').classList.toggle('cens', cens);
  if (cens) {
    $('capbar').innerHTML = `<span aria-hidden="true">${tapLine(text)}</span>`
      + '<button class="peek" aria-label="Show the subtitles" title="Show the subtitles"><svg><use href="#i-eye"/></svg></button>';
    return;
  }
  const ed = App.editing && !plain ? ' contenteditable="plaintext-only" spellcheck="false"' : '';
  $('capbar').innerHTML = plain
    ? `<span class="err">${esc(plain)}</span>`
    : App.editing ? `<span${ed}>${esc(text).replace(word.re, (m) => `<mark>${m}</mark>`)}</span>`
    : `<span>${tapLine(text)}</span>`;
}

/* ---------- Tap a word under the video: its Ukrainian, or why a grammar word is there ---------- */
// Each word file has its own small dictionary: gloss = {word: Ukrainian, or {"*": usual, "<words around it in a
// line>": for that line}}, together = {"phrasal verb or set phrase": Ukrainian} (a tap on any of its words takes the
// whole phrase). The lesson word itself (yellow) is always taken whole, with the word's Ukrainian.
const wbase = (t) => t.toLowerCase().replace(/'/g, '’').replace(/\s+/g, ' ').trim();
function findIn(text, phrases){              // → [[from, to, index]] where each phrase is in the text (whole words only)
  const out = [];
  phrases.forEach((w, k) => {
    const pat = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, '[’\']').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|[^\\w’'])(${pat})(?![\\w’'])`, 'gi');
    let m; while ((m = re.exec(text))) { const a = m.index + m[1].length; out.push([a, a + m[2].length, k]); }
  });
  return out;
}
function glossFor(w, line, at){
  const G = (word && word.gloss) || {};
  let key = wbase(w).replace(/^’+|’+$/g, '');
  if (G[key] == null && G[key.replace(/’s$/, '')] != null) key = key.replace(/’s$/, '');
  const v = G[key];
  if (v == null || typeof v === 'string') return v || '';
  for (const [ctx, t] of Object.entries(v)) if (ctx !== '*' && findIn(line, [ctx]).some(([a, b]) => at >= a && at < b)) return t;
  return v['*'] || '';
}
let phraseN = 0;
function tapLine(text){
  const n = text.length, mk = new Array(n).fill(false), gp = new Array(n).fill(0), gtag = {};
  text.replace(word.re, (m, ...r) => { const a = r[r.length - 2]; for (let c = a; c < a + m.length; c++) mk[c] = true; return m; });
  const tk = Object.keys(word.together || {});
  findIn(text, tk).forEach(([a, b, k]) => {
    for (let c = a; c < b; c++) if (mk[c] || gp[c]) return;   // never inside the yellow word or another phrase
    const g = ++phraseN; for (let c = a; c < b; c++) gp[c] = g;
    gtag[g] = tagOf(tk[k]);   // a slang / hard phrase gets one dot, at its end
  });
  const re = /[A-Za-z0-9’']+|[^A-Za-z0-9’']+/g;
  let h = '', open = false, og = 0, m;
  while ((m = re.exec(text))) {
    const a = m.index, t = m[0], g = gp[a];
    if (og && g !== og) { h += '</span>'; og = 0; }
    if (mk[a] !== open) { h += open ? '</mark>' : '<mark>'; open = mk[a]; }
    if (g && g !== og) { h += `<span class="ph${tagAttr(gtag[g])}">`; og = g; }
    // A word on its own (not the yellow word, not inside a phrase) can carry a dot too.
    const tw = !g && !mk[a] && /[A-Za-z]/.test(t) ? tagAttr(tagOf(t)) : '';
    h += /[A-Za-z0-9]/.test(t) ? `<span class="tw${tw}">${esc(t)}</span>` : esc(t);
  }
  return h + (og ? '</span>' : '') + (open ? '</mark>' : '');
}
function tapGloss(el){
  const mk = el.closest('mark');
  if (mk) return word.ua ? {en: mk.textContent, ua: word.ua, box: mk} : null;
  const ph = el.closest('.ph');
  if (ph) {
    const k = Object.keys(word.together || {}).find((x) => wbase(x) === wbase(ph.textContent));
    if (k && word.together[k]) return {en: ph.textContent, ua: word.together[k], box: ph};
  }
  const cap = el.closest('#capbar > span'), r = document.createRange();
  r.selectNodeContents(cap); r.setEndBefore(el);
  const ua = glossFor(el.textContent, cap.textContent, r.toString().length);
  return ua ? {en: el.textContent, ua, box: el} : null;
}
// Hidden subtitles: show (or blur again) the caption that belongs to this moment (with context, the line being said).
function redrawLine(){
  const l = range && range.lines && started && !ended ? shown : null;
  if (l) showLine(l[2], null, l); else if (clip()) showLine(lineOf(clip()));
}
function showCaption(){
  if (!capHidden) return;
  capHidden = false; drawCC(); redrawLine();
}
// The button shows what is on the screen now: a caption tapped open shows CC on, so one press hides it again
// (Nov 24: it used to stay "off", and the first press only switched CC back on with nothing to see).
function drawCC(){
  const off = capHidden && !App.editing;
  $('cc').setAttribute('aria-pressed', String(off));
  $('ccicon').setAttribute('href', off ? '#i-ccoff' : '#i-cc');
  const t = off ? 'Show subtitles' : 'Hide subtitles';
  $('cc').setAttribute('aria-label', t); $('cc').title = t;
}
function setSubs(off){
  subsOff = off; capHidden = off && !App.editing; drawCC(); if (clip()) redrawLine();
}
$('cc').onclick = () => { setSubs(App.editing ? !subsOff : !capHidden); saveSubs(); };
// CC changed in another clip page (another screen of the lesson, already loaded): this one follows.
addEventListener('storage', (e) => { if (e.key === SUBS && (e.newValue === '1') !== subsOff) setSubs(e.newValue === '1'); });
// The lesson moved on to another screen: a clip left playing here stops.
addEventListener('message', (e) => { if (e.data && e.data.clipsPause) App.pause(); });
function hidePop(){ const p = $('pop'); if (p) p.hidden = true; document.querySelectorAll('#capbar .on').forEach((x) => x.classList.remove('on')); }
function showPop(el){
  const g = tapGloss(el);
  hidePop();
  if (!g) return;
  const p = $('pop'), r = el.getBoundingClientRect(), why = g.ua.length > 32;
  // A short translation sits beside the word; a longer explanation (why a grammar word is there) goes under it.
  const kind = g.box.dataset.tag;   // slang / rude / hard: said under the translation
  p.innerHTML = `<b>${esc(g.en)}</b><span class="${why ? 'why' : 'pua'}">${esc(g.ua)}</span>`
    + (TAG_SAY[kind] ? `<span class="tagl tg-${kind}">${TAG_SAY[kind]}</span>` : '');
  p.classList.toggle('long', why); p.hidden = false;
  const half = p.offsetWidth / 2 + 8;
  p.style.left = `${Math.min(innerWidth - half, Math.max(half, r.left + r.width / 2))}px`;
  p.style.top = `${r.top - 8}px`;
  g.box.classList.add('on');
}
// The bubble is solid: a click (or selecting its text) inside it keeps it open; tapping the same word again closes it.
document.addEventListener('click', (e) => {
  if (e.target.closest('#pop')) return;
  if (capHidden && e.target.closest('#capbar')) { showCaption(); return; }
  const w = !App.editing && e.target.closest('#capbar .tw');
  if (w) { if (w.classList.contains('on') || w.closest('#capbar .on')) hidePop(); else showPop(w); return; }
  hidePop();
});
addEventListener('scroll', hidePop, {passive: true});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hidePop();
  if (e.key === 'Enter' && capHidden && e.target.closest && e.target.closest('#capbar')) showCaption();
});
// Edit mode: what is typed in the caption bar goes to the line that is shown there.
App.setShownLine = (text) => {
  const c = clip(); if (!c) return;
  if (lineRef && (c.around || []).includes(lineRef)) lineRef[2] = text; else c.line = text;
};
const capFocus = () => $('capbar').contains(document.activeElement);
// The caption bar keeps the height of this word's longest line, so nothing below it moves from clip to clip.
function sizeCaption(){
  if (!word) return;
  const bar = $('capbar'), probe = bar.cloneNode(false);
  probe.removeAttribute('id');
  probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;width:${bar.clientWidth}px;min-height:0`;
  document.body.appendChild(probe);
  let h = 0;
  for (const c of word.clips) for (const t of [c.line || '', ...(c.around || []).map((l) => l[2]), ...(c.near || []).map((l) => l[2])]) {
    probe.innerHTML = `<span>${esc(t).replace(word.re, (m) => `<mark>${m}</mark>`)}</span>`;
    h = Math.max(h, probe.getBoundingClientRect().height);
  }
  probe.remove(); bar.style.minHeight = `${Math.ceil(h)}px`;
  fitEmbed();
}
App.sizeCaption = sizeCaption;
/* ---------- Song clips: the words come live from lrclib.net, like the song pages (lyrics never go in the repo) ---------- */
// A clip from a song has song = {lrclib: <lrclib.net id>, shift: <seconds the video is later than the lyrics>} and the
// line "♪". When it is shown, its sung lines are loaded and kept on the clip in this page only (c.sung, never saved);
// the caption bar then follows the line being sung, and every word taps like any other (the word file's gloss).
// Edit mode shows "♪", so nothing typed there can put lyrics in the file.
const lyricsCache = new Map();
function lyricsOf(id){
  if (!lyricsCache.has(id)) {
    lyricsCache.set(id, fetch(`https://lrclib.net/api/get/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const ls = ((d && d.syncedLyrics) || '').split('\n').map((l) => {
        const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        return m ? [+m[1] * 60 + +m[2], 0, m[3].replace(/'/g, '’')] : null;
      }).filter(Boolean);
      ls.forEach((l, n) => { l[1] = ls[n + 1] ? ls[n + 1][0] : l[0] + 5; });
      return ls.filter((l) => l[2].trim());
    }).catch(() => []));
  }
  return lyricsCache.get(id);
}
function loadSong(c){
  if (!c || !c.song || c.allSung || c.songLoading) return;
  c.songLoading = true;
  lyricsOf(c.song.lrclib).then((ls) => {
    const sh = +c.song.shift || 0;
    c.allSung = ls.map((l) => [l[0] + sh, l[1] + sh, l[2]]);
    c.sung = c.allSung.filter((l) => l[1] > c.s + 0.2 && l[0] < c.e - 0.2);
    c.near = c.allSung.filter((l) => l[1] > c.s - LONGER_BEFORE + 0.2 && l[0] < c.e + LONGER_AFTER - 0.2);   // with context too: the caption bar fits them all
    c.songLoading = false;
    if (word && word.clips.includes(c)) sizeCaption();
    if (clip() === c && !started) App.refresh();
  });
}
// The line a clip shows when it isn't playing: its own, or for a song the sung line with the word in it.
function lineOf(c){
  if (!c.sung || !c.sung.length || App.editing) return c.line;
  return (c.sung.find((l) => l[2].search(word.re) >= 0) || c.sung[0])[2];
}
// What a play covers: just the line, or with context the lines around it too.
// "With context" plays from … to …: the clip's own `ctx: [start, end]` when he set it in edit mode (Nov 24: "how long
// the with context clip is, to adjust it a little bit"), else the lines around it, else 6 s before and 4 s after.
function ctxOf(c){
  if (Array.isArray(c.ctx) && c.ctx.length === 2 && c.ctx[0] < c.ctx[1]) return [Math.min(c.ctx[0], c.s), Math.max(c.ctx[1], c.e)];
  const around = c.around || [];
  if (around.length && !c.song) {
    const lines = [...around.filter((l) => l[0] < c.s), [c.s, c.e], ...around.filter((l) => l[0] > c.s)];
    return [lines[0][0], lines[lines.length - 1][1]];
  }
  return [Math.max(0, c.s - LONGER_BEFORE), c.e + LONGER_AFTER];
}
App.ctxOf = ctxOf;
function rangeOf(c, longer){
  const own = longer && Array.isArray(c.ctx) && c.ctx.length === 2 && c.ctx[0] < c.ctx[1];
  if (own) {
    // His own range: exactly from his start to his end. The caption follows the lines inside it (the first and last
    // stretch to its edges, so a line always shows).
    const [from, to] = ctxOf(c);   // never shorter than the clip itself
    const src = c.sung && c.sung.length && !App.editing ? c.allSung
      : [...(c.around || []).filter((l) => l[0] < c.s), [c.s, c.e, c.line], ...(c.around || []).filter((l) => l[0] > c.s)];
    const lines = src.filter((l) => l[1] > from + 0.05 && l[0] < to - 0.05).map((l) => [l[0], l[1], l[2]]);
    if (lines.length) { lines[0][0] = Math.min(lines[0][0], from); lines[lines.length - 1][1] = Math.max(lines[lines.length - 1][1], to); }
    return {from: Math.max(0, from), to, lines: lines.length > 1 ? lines : null, c, longer};
  }
  if (c.sung && c.sung.length && !App.editing) {
    const from = longer ? c.s - LONGER_BEFORE : c.s, to = longer ? c.e + LONGER_AFTER : c.e;
    const lines = c.allSung.filter((l) => l[1] > from + 0.2 && l[0] < to - 0.2).map((l) => [Math.max(l[0], from), l[1], l[2]]);
    return {from: Math.max(0, from - EXACT_BEFORE), to: to + 0.1, lines: lines.length ? lines : null, c, longer};
  }
  const around = c.around || [], exact = !Number.isInteger(c.s);
  const before = around.filter((l) => l[0] < c.s), after = around.filter((l) => l[0] > c.s);
  if (longer && around.length) {
    const lines = [...before, [c.s, c.e, c.line], ...after];
    return {from: Math.max(0, lines[0][0] - EXACT_BEFORE), to: lines[lines.length - 1][1] + 0.1, lines, c, longer};
  }
  if (longer) return {from: Math.max(0, c.s - LONGER_BEFORE), to: c.e + LONGER_AFTER, lines: null, c, longer};
  let to = c.e + (exact ? EXACT_AFTER : PAD_AFTER);
  // Stop before the next line starts, unless the clip's end was set past it on purpose (edit mode).
  if (after.length && c.e <= after[0][0]) to = Math.min(to, after[0][0]);
  return {from: Math.max(0, c.s - (exact ? EXACT_BEFORE : PAD_BEFORE)), to: Math.max(to, c.s + 0.3), lines: null, c, longer};
}

/* ---------- two YouTube players ---------- */
// Two players on top of each other: the one you see, and a hidden one that already loads the next clip, so
// "Next clip" starts at once. A clip is "warmed": loaded muted and stopped on its first frame.
const slots = [{el: 'yt0'}, {el: 'yt1'}];
let act = 0;
const S = () => slots[act];
const P = () => slots[act].p;
const ready = () => !!slots[act].ready;
// `loaded`: the slot's video has really started once, so jumping in it is safe. While a video is still loading,
// YouTube ignores a jump and may start from 0:00, so then the clip is loaded again at the right second instead.
function warm(s, c, from){
  if (!s.ready) { s.pending = {c, from}; return; }
  if (s.vid === c.v) {
    if (!s.loaded) s.warmFrom = from;
    else if (s !== S() || !started) s.p.seekTo(from, true);
    return;
  }
  s.vid = c.v; s.loaded = false; s.warming = true; s.warmFrom = from;
  s.p.mute(); s.p.loadVideoById({videoId: c.v, startSeconds: from});
}
// Play the clip from its start (or from `at`). If its video is already loaded, it just jumps there: no reload.
function playClip(at){
  const c = clip(), s = S();
  if (!c) return;
  range = rangeOf(c, longerMode); shown = null;
  if (!s.ready) { wantPlay = {at}; return; }
  started = true; ended = false; intent = true; loadedAt = performance.now();
  showLine(lineOf(c));
  const from = at ?? range.from;
  s.warming = false; if (MUTE || App.silent) s.p.mute(); else s.p.unMute();
  if (s.vid === c.v && s.loaded) { s.p.seekTo(from, true); s.p.playVideo(); loadedAt -= 150; }
  else { s.vid = c.v; s.loaded = false; s.p.loadVideoById({videoId: c.v, startSeconds: from}); }
  s.p.setPlaybackRate(rate);
  setCover();
}
App.playClip = playClip;
const isPlaying = () => started && !ended && intent;
App.pause = () => { wantPlay = null; if (isPlaying()) { intent = false; P().pauseVideo(); setCover(); } };
// Edit mode's 🔇: no sound while she edits (students always have sound).
App.silent = false;
App.setSilent = (on) => {
  App.silent = on;
  if (ready() && started) { if (on || MUTE) P().mute(); else P().unMute(); }
};
// Play/pause: a paused clip goes on from where it stopped; a finished one plays again.
// A press that comes just as the clip ends was meant as "pause": it stays stopped instead of starting over.
function toggle(){
  if (!ready() || !range) return;
  if (isPlaying()) { intent = false; P().pauseVideo(); }
  else if (started && !ended) { intent = true; P().playVideo(); }
  else if (!(ended && performance.now() - endedAt < 700)) playClip();
  setCover();
}
// 1 second back or forward, inside the clip. A paused clip stays paused.
function seekBy(d){
  if (!ready() || !started || performance.now() - loadedAt < 400) return;
  const t = Math.min(range.to - 0.05, Math.max(range.from, P().getCurrentTime() + d));
  if (t < range.to - 0.1) ended = false;
  shown = null; P().seekTo(t, true); drawTimeline(t); setCover();
  flash(d < 0 ? 'flashl' : 'flashr');
}
function flash(id){
  const f = $(id); f.classList.add('on'); clearTimeout(f.t); f.t = setTimeout(() => f.classList.remove('on'), 350);
}
// A clip that should be playing but hangs while loading (YouTube sometimes stalls after a jump, mostly with context):
// after 2.5 s it gets the nudge a ← → gives (a jump to where it is), and after two nudges it loads again from there.
let stallSince = 0, nudges = 0;
function nudge(t){
  const s = S(), c = range.c, from = Math.min(range.to - 0.2, Math.max(range.from, t || range.from));
  if (++nudges <= 2) { s.p.seekTo(from, true); s.p.playVideo(); }
  else { nudges = 0; s.vid = c.v; s.loaded = false; s.p.loadVideoById({videoId: c.v, startSeconds: from}); }
  s.p.setPlaybackRate(rate);
}
// One clock for everything: stop at the end, move the timeline, and with context follow the lines.
setInterval(() => {
  // Right after a load the player can still report the old clip's time for a moment: wait for the new one.
  if (!ready() || !range || !started || performance.now() - loadedAt < 300) return;
  const playing = P().getPlayerState() === YT.PlayerState.PLAYING, t = P().getCurrentTime();
  if (intent && !ended && !playing && !dragging) {
    const now = performance.now();
    if (!stallSince) stallSince = now;
    else if (now - stallSince > 2500) { stallSince = now; nudge(t); return; }
  } else { stallSince = 0; if (playing) nudges = 0; }
  // Safety net: if the video ever plays outside the clip (YouTube started it somewhere else), bring it back.
  if (playing && (t < range.from - 0.5 || t > range.to + 0.5)) { P().seekTo(range.from, true); return; }
  if (playing && t >= range.to - 0.06) {
    P().pauseVideo(); ended = true; intent = false; endedAt = performance.now();
    // Listen first: the caption stays hidden at the end too; only a tap on it shows it (his rule, Nov 21).
    if (range.lines) { showLine(lineOf(range.c)); shown = null; }
    drawTimeline(range.to); setCover(); return;
  }
  if (!ended && !dragging) drawTimeline(t);
  if (range.lines && !ended && !capFocus()) {
    const l = range.lines.reduce((on, x) => (t >= x[0] - 0.1 ? x : on), range.lines[0]);
    if (l !== shown) { shown = l; showLine(l[2], null, l); }
  }
}, 50);
function drawTimeline(t){
  const r = range;
  if (!r) { $('tlfill').style.width = '0%'; $('tldot').style.left = '0%'; $('tlword').hidden = true; $('tltime').textContent = ''; return; }
  const len = r.to - r.from, f = Math.min(1, Math.max(0, (t - r.from) / len));
  $('tlfill').style.width = `${f * 100}%`; $('tldot').style.left = `${f * 100}%`;
  // The yellow part (the word's line) shows only with context, where it is a part of the whole.
  const ws = Math.max(0, (r.c.s - r.from) / len), we = Math.min(1, (r.c.e - r.from) / len);
  $('tlword').hidden = !r.longer;
  $('tlword').style.left = `${ws * 100}%`; $('tlword').style.width = `${Math.max(0, we - ws) * 100}%`;
  $('tltime').textContent = `${(f * len).toFixed(1)} / ${len.toFixed(1)} s`;
}
// ▶ before it starts or while paused, ❚❚ while playing, ↻ when it has ended.
function setCover(){
  const playing = isPlaying(), icon = playing ? 'pause' : ended ? 'again' : 'play';
  $('cover').classList.toggle('playing', playing);
  $('cover').classList.toggle('dim', !playing && started);
  $('cover').setAttribute('aria-label', playing ? 'Pause' : ended ? 'Play again' : 'Play');
  $('bigicon').setAttribute('href', `#i-${ended ? 'again' : 'play'}`);
  $('ppicon').setAttribute('href', `#i-${icon}`);
  $('pp').setAttribute('aria-label', playing ? 'Pause' : ended ? 'Play again' : 'Play');
}
function setMode(longer){
  longerMode = longer; if (!longer) contextHeld = false;
  $('longer').setAttribute('aria-pressed', longer);
  $('longer').classList.toggle('held', longer && contextHeld);
  if (App.onMode) App.onMode();   // edit mode shows the context's Start / End while it is on
}
Object.defineProperty(App, 'longer', {get: () => longerMode});
// Another clip or word: "With context" goes off again, unless it was pressed and held.
function resetContext(){ if (longerMode && !contextHeld) setMode(false); }

window.onYouTubeIframeAPIReady = () => {
  slots.forEach((s, i) => {
    s.p = new YT.Player(s.el, {
      width: '100%', height: '100%',
      playerVars: {controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, cc_load_policy: 0, modestbranding: 1},
      events: {
        onReady: () => {
          s.ready = true; s.p.getIframe().classList.toggle('on', i === act);
          if (s === S() && wantPlay) { const w = wantPlay; wantPlay = null; playClip(w.at); }
          else if (s.pending) { const q = s.pending; s.pending = null; warm(s, q.c, q.from); }
        },
        onStateChange: (e) => {
          // A clip being warmed stops on its first frame as soon as it starts.
          if (s.warming && e.data === YT.PlayerState.PLAYING) {
            s.warming = false; s.loaded = true; s.p.pauseVideo(); s.p.seekTo(s.warmFrom, true); return;
          }
          if (e.data === YT.PlayerState.PLAYING) s.loaded = true;
          if (s !== S()) return;
          // It started although you pressed pause while it was loading: pause it now.
          if (e.data === YT.PlayerState.PLAYING && !isPlaying()) s.p.pauseVideo();
          setCover();
          if (e.data === YT.PlayerState.PLAYING && s.p.getPlaybackRate() !== rate) s.p.setPlaybackRate(rate);
        },
        onError: () => {
          if (s !== S()) { s.vid = null; s.warming = false; return; }
          showLine('', 'This clip didn’t load. Try the next one →');
        }
      }
    });
  });
};

/* ---------- controls ---------- */
// Tap the video = play/pause, at once. Double-tap the left or right half = 1 s back or forward (more taps = more
// seconds): the second tap undoes the first tap's play/pause, then moves.
let lastTap = 0, seeking = 0, tapWas = null;
$('cover').onclick = (e) => {
  const now = performance.now(), box = $('cover').getBoundingClientRect();
  const dir = e.clientX - box.left < box.width / 2 ? -1 : 1;
  if (started && (now - seeking < 500 || now - lastTap < 300)) {
    if (tapWas === 'playing') { intent = true; P().playVideo(); } else if (tapWas === 'paused') { intent = false; P().pauseVideo(); }
    tapWas = null; lastTap = 0; seeking = now; seekBy(dir * STEP); return;
  }
  lastTap = now;
  tapWas = isPlaying() ? 'playing' : started && !ended ? 'paused' : null;
  toggle();
};
$('pp').onclick = toggle;
// The timeline: tap or drag to move; letting go plays from there.
const pointT = (e) => {
  const box = $('tl').getBoundingClientRect();
  return range.from + Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (range.to - range.from);
};
$('tlhit').onpointerdown = (e) => {
  if (!ready() || !range) return;
  dragging = true; $('tlhit').setPointerCapture(e.pointerId); drawTimeline(pointT(e));
};
$('tlhit').onpointermove = (e) => { if (dragging) drawTimeline(pointT(e)); };
$('tlhit').onpointerup = (e) => {
  if (!dragging) return;
  dragging = false; const t = pointT(e);
  if (!started) { playClip(t); return; }
  ended = false; intent = true; shown = null; drawTimeline(t);
  P().seekTo(t, true); P().playVideo(); setCover();
};
$('tlhit').onpointercancel = () => { dragging = false; };
// "With context": a tap turns it on or off for this clip and plays the clip again the new way. Press and hold: it
// stays on for the next clips too (a small dot on the button) until it is tapped off.
let holdT = 0, held = false;
const stopHold = () => clearTimeout(holdT);
$('longer').onpointerdown = (e) => {
  if (e.button) return;
  held = false; stopHold();
  holdT = setTimeout(() => {
    held = true; contextHeld = true;
    if (longerMode) setMode(true); else { setMode(true); playClip(); }
  }, 550);
};
$('longer').onpointerup = stopHold;
$('longer').onpointerleave = stopHold;
$('longer').onpointercancel = stopHold;
$('longer').oncontextmenu = (e) => e.preventDefault();
$('longer').onclick = () => {
  if (held) { held = false; return; }
  contextHeld = false; setMode(!longerMode); playClip();
};
const step = (d) => { const n = list().length; if (!n) return; clipN = (clipN + d + n) % n; resetContext(); showClip(true); };
$('next').onclick = () => step(1);
$('prev').onclick = () => step(-1);
// The arrows beside the video and the dots (inside a lesson) go to a clip without going round.
const goClip = (k) => { const n = list().length; if (k < 0 || k >= n || k === clipN) return; clipN = k; resetContext(); showClip(true); };
$('snext').onclick = () => goClip(clipN + 1);
$('sprev').onclick = () => goClip(clipN - 1);
$('cdots').onclick = (e) => { const d = e.target.closest('[data-k]'); if (d) goClip(+d.dataset.k); };
$('speed').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  rate = +b.dataset.r;
  $('speed').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  if (ready()) P().setPlaybackRate(rate);
};
$('about').onclick = () => {
  $('credits').hidden = !$('credits').hidden; $('about').setAttribute('aria-expanded', !$('credits').hidden);
};
$('tipe').onclick = () => {
  const open = $('tipnote').hidden && !!$('tipnote').textContent;
  $('tipnote').hidden = !open; $('tipe').setAttribute('aria-pressed', String(open));
};
$('tipnote').onclick = () => { $('tipnote').hidden = true; $('tipe').setAttribute('aria-pressed', 'false'); };
$('tipbtn').onclick = () => {
  const open = $('note').classList.toggle('off') === false;
  $('tipbtn').setAttribute('aria-expanded', open);
};
// Back to the lesson: this tab was opened from the lesson page, so closing it shows the lesson again.
$('back').onclick = () => { window.close(); setTimeout(() => history.back(), 300); };

/* ---------- search ---------- */
let hits = [];
function suggest(){
  const q = $('q').value.trim().toLowerCase();
  if (!q) { $('sugg').hidden = true; return; }
  hits = INDEX.filter((x) => `${x.en} ${x.ua || ''}`.toLowerCase().includes(q)).slice(0, 8);
  let html = hits.map((x, i) => `<li><button data-i="${i}">${esc(x.pic || '')} <b>${esc(x.en)}</b> <span>${esc(x.ua || '')}</span></button></li>`).join('');
  if (App.editing && !INDEX.some((x) => x.en.toLowerCase() === q)) html += `<li><button data-new>➕ New word “${esc($('q').value.trim())}”</button></li>`;
  if (!html) html = '<li class="none">Not in the library yet</li>';
  $('sugg').innerHTML = html; $('sugg').hidden = false;
}
function choose(i){
  const x = hits[i]; if (!x) return;
  $('q').value = ''; $('sugg').hidden = true; $('q').blur();
  pick(x.slug, true);
}
$('q').oninput = suggest;
$('q').onfocus = suggest;
$('q').onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (hits.length) choose(0); else if (App.editing && App.newWord) App.newWord($('q').value.trim()); }
  if (e.key === 'Escape') { $('q').value = ''; $('sugg').hidden = true; $('q').blur(); }
};
$('sugg').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-new')) { const t = $('q').value.trim(); $('q').value = ''; $('sugg').hidden = true; App.newWord(t); }
  else choose(+b.dataset.i);
};
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) $('sugg').hidden = true; });

/* ---------- keys and edit mode ---------- */
// Keys work wherever the focus is (except while typing): Space = play/pause (never "clicks" the last button),
// ← → = 1 second.
const typing = (e) => e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
  if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (!e.repeat) toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-STEP); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(STEP); }
}, true);
document.addEventListener('keyup', (e) => { if (!typing(e) && (e.code === 'Space' || e.key === ' ')) e.preventDefault(); }, true);
// A mouse click or tap doesn't leave the button focused (no ring around it afterwards).
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && e.detail > 0) b.blur(); });
// 5 quick taps in the top-left corner: edit mode on or off.
let corner = [];
$('corner').onclick = () => {
  const now = Date.now(); corner = corner.filter((t) => now - t < 3000); corner.push(now);
  if (corner.length < 5) return;
  corner = [];
  if (App.toggleEdit) { App.toggleEdit(); return; }
  const s = document.createElement('script'); s.src = 'edit.js?v=8'; s.onload = () => App.toggleEdit(); document.head.appendChild(s);
};
let resizeT = null;
window.addEventListener('resize', () => { hidePop(); clearTimeout(resizeT); resizeT = setTimeout(sizeCaption, 150); });
if (document.fonts) document.fonts.ready.then(sizeCaption);

const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(tag);
init();
