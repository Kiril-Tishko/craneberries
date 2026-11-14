// Shared player for song and video lessons. A lesson page sets window.LESSON and loads this file:
//   id        short name, used for what this browser remembers (My words, captions, the video file)
//   title, sub
//   video     {type:'youtube', id} or {type:'file', duration}: a file she opens from her device (never put in the repo)
//   captions  {type:'lrc', url}: timed lyrics loaded live (lrclib.net), never stored in the repo
//             {type:'link'}: captions arrive in the page link (#c=…), compressed, and stay in her browser
//   parts     [{name, start, end, lines:[{words:[[en, ua, example]], hl:[exact phrases in the captions], note?, start, end}]}]
//             the example marks the word with <em> (it becomes the gap in My words); hl[k] is how words[k] is sung
//             ("making you cry" for "make you cry"), and a tap on it gives its Ukrainian in every part
//   gloss     {word: Ukrainian}: tap any word in the captions (lowercase, ’ for apostrophes)
//   later     [[phrase, Ukrainian]]: words left for a later lesson; tapping one says so
// Steps: every line of a part (its key words first, then just that line plays), then the whole part, "All together".
// At the end, My words: the words she added with +, as gap sentences.
// The player follows docs/real-video: our own panel, no YouTube UI, steady layout, presses count even while loading.
(function(){
'use strict';
const L = window.LESSON, YTV = L.video.type === 'youtube';
const tall = !YTV && L.video.tall !== false;
const STEP = 1;                                   // ← → and double-tap move this many seconds
const MUTE = /[?&]mute\b/.test(location.search);  // …?mute plays without sound (for testing)
const LATER_TEXT = L.laterText || 'вивчимо пізніше';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
document.title = L.title;
document.body.innerHTML = `<svg hidden xmlns="http://www.w3.org/2000/svg">
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><rect x="5.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="14" y="4" width="4.5" height="16" rx="1.2"/></symbol>
  <symbol id="i-again" viewBox="0 0 24 24"><path d="M12 5V2L7.5 6.5 12 11V8a5 5 0 1 1-5 5H4.5A7.5 7.5 0 1 0 12 5z"/></symbol>
  <symbol id="i-prev" viewBox="0 0 24 24"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></symbol>
  <symbol id="i-next" viewBox="0 0 24 24"><path d="m8.6 5.4 6.6 6.6-6.6 6.6L10 20l8-8-8-8z"/></symbol>
</svg>
<div class="app">
  <header>
    <h1>${esc(L.title)}${L.sub ? ` <span>${esc(L.sub)}</span>` : ''}</h1>
    <div class="where"><span id="warn" class="warn"></span><span id="mywords"></span><span id="where"></span></div>
  </header>
  <main class="${tall ? 'tall' : 'wide'}">
    <section class="player" aria-label="Video">
      <div class="video">${YTV ? '<div id="yt"></div>' : '<video id="vid" playsinline preload="auto"></video><input type="file" id="file" accept="video/*" hidden>'}
        <button class="cover" id="cover" tabindex="-1" aria-label="Play"><span class="big" id="big"><svg><use id="bigicon" href="#i-play"/></svg></span><span class="open" id="open" hidden>📂 Open the video</span></button>
        <div class="flash l" id="flashl">− 1 s</div><div class="flash r" id="flashr">+ 1 s</div>
      </div>
      <div class="bar">
        <button class="pp" id="pp" aria-label="Play"><svg><use id="ppicon" href="#i-play"/></svg></button>
        <div class="tlhit" id="tlhit"><div class="tl" id="tl"><div class="tl-fill" id="tlfill"></div><div class="tl-dot" id="tldot"></div></div></div>
        <span class="tltime" id="tltime"></span>
      </div>
      <div class="capbar" id="capbar"></div>
      <div class="tools">
        <div class="seg" id="speed"><button data-r="1" aria-pressed="true">1×</button><button data-r="0.75" aria-pressed="false">0.75×</button><button data-r="0.5" aria-pressed="false">0.5×</button></div>
        <span class="count" id="count"></span>
        <div class="nav">
          <button class="btn back" id="prev" aria-label="Back"><svg><use href="#i-prev"/></svg></button>
          <button class="btn primary" id="next"><span id="nextlabel">Next</span><svg><use href="#i-next"/></svg></button>
        </div>
      </div>
    </section>
    <section class="card" id="card" aria-live="polite"></section>
  </main>
  <!-- The YouTube player's rules want links to YouTube's Terms and Google's Privacy Policy: they stay, behind a quiet ⓘ. -->
  <footer class="foot"><button id="about" aria-expanded="false" aria-label="About" title="About">ⓘ</button>
    <span id="credits" hidden>${YTV ? 'Video from YouTube (<a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>).' : ''}${L.captions.type === 'lrc' ? ' Lyrics from <a href="https://lrclib.net" target="_blank" rel="noopener">lrclib.net</a>.' : ''}${YTV ? '' : '<button class="btn" id="change">📂 Change video</button>'}</span></footer>
</div>
<div class="pop" id="pop" hidden></div>`;

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const store = {
  get(k, d){ try { const v = localStorage.getItem(`${L.id}-${k}`); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v){ try { localStorage.setItem(`${L.id}-${k}`, JSON.stringify(v)); return true; } catch (e) { return false; } }
};

const PARTS = L.parts, GLOSS = L.gloss || {}, LATER = (L.later || []).map(([p, ua]) => ({p, ua}));
const STEPS = [];
PARTS.forEach((p, pn) => {
  p.lines.forEach((l, ln) => STEPS.push(Object.assign({kind: 'line', pn, ln}, l)));
  STEPS.push({kind: 'all', pn, start: p.start, end: p.end});
});
STEPS.push({kind: 'practice'});

let i = 0, range = null, rate = 1, wantPlay = null;
let started = false, ended = false, endedAt = 0, loadedAt = 0, dragging = false;
// `moved`: the video has really moved in this step. Until then the cover stays dark, so YouTube's loading circle
// doesn't show through.
let moved = false;
// `intent` is what she last asked for (play or pause). The buttons follow it, not the player's state, so a press
// counts even while the video is still loading.
let intent = false;
const heard = STEPS.map(() => false);
let LINES = [], capsNote = '', capSig = '';
let dict = store.get('dict', []), pr = {n: 0, show: false};
if (!Array.isArray(dict)) dict = [];
const saveDict = () => store.set('dict', dict);

/* ---------- Media: one small interface for YouTube and for a file from her device ---------- */
const media = YTV ? youTube() : localFile();

// One YouTube player: every step is a part of the same video. On load it is "warmed": loaded muted and stopped on the
// first step's first frame, so the first ▶ starts at once. Later steps are a jump in the loaded video, never a reload.
function youTube(){
  const m = {p: null, ok: false, loaded: false, warming: false, warmFrom: 0};
  const show = () => m.p.getIframe().classList.add('on');
  const load = (from) => m.p.loadVideoById({videoId: L.video.id, startSeconds: from});
  window.onYouTubeIframeAPIReady = () => {
    m.p = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: {controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, cc_load_policy: 0, modestbranding: 1},
      events: {
        onReady: () => {
          m.ok = true;
          if (wantPlay) { const w = wantPlay; wantPlay = null; playRange(w.at); }
          else if (range) m.prepare(range.from);
        },
        onStateChange: (e) => {
          const PLAYING = YT.PlayerState.PLAYING;
          if (m.warming && e.data === PLAYING) {
            m.warming = false; m.loaded = true; m.p.pauseVideo(); m.p.seekTo(m.warmFrom, true); show(); return;
          }
          if (e.data === PLAYING) { m.loaded = true; show(); if (isPlaying()) moved = true; }
          // It started although she pressed pause while it was loading: pause it now.
          if (e.data === PLAYING && !isPlaying()) m.p.pauseVideo();
          if (e.data === PLAYING && m.p.getPlaybackRate() !== rate) m.p.setPlaybackRate(rate);
          setCover();
        },
        onError: () => { capsNote = 'The video didn’t load. Reload the page.'; drawCaption(true); }
      }
    });
  };
  Object.assign(m, {
    ready: () => m.ok,
    canSeek: () => m.ok && m.loaded,
    time: () => m.p.getCurrentTime(),
    playing: () => m.p.getPlayerState() === YT.PlayerState.PLAYING,
    // While the video is still loading, YouTube ignores a jump and may start from 0:00: then it is loaded again at
    // the right second instead.
    play(from){
      m.warming = false; if (!MUTE) m.p.unMute();
      if (m.loaded) { m.p.seekTo(from, true); m.p.playVideo(); } else load(from);
      m.p.setPlaybackRate(rate);
    },
    resume: () => m.p.playVideo(),
    pause: () => m.p.pauseVideo(),
    seek: (t) => m.p.seekTo(t, true),
    rate: (r) => m.p.setPlaybackRate(r),
    // Stand ready (stopped) where the next step starts.
    prepare(from){
      if (!m.ok) return;
      if (m.loaded) { m.p.seekTo(from, true); return; }
      m.warmFrom = from;
      if (!m.warming) { m.warming = true; m.p.mute(); load(from); }
    }
  });
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
  return m;
}

// A file from her device: the page keeps it in this browser (IndexedDB), so she opens it only once.
function localFile(){
  const v = $('vid');
  v.muted = MUTE;
  const m = {
    ready: () => v.readyState >= 1 && !!v.currentSrc,
    canSeek: () => v.readyState >= 1 && !!v.currentSrc,
    time: () => v.currentTime,
    playing: () => !v.paused && !v.ended,
    play(from){ v.playbackRate = rate; v.currentTime = from; v.play().catch(() => {}); },
    resume: () => { v.play().catch(() => {}); },
    pause: () => v.pause(),
    seek: (t) => { v.currentTime = t; },
    rate: (r) => { v.playbackRate = r; },
    prepare(from){ if (m.ready()) v.currentTime = from; },
    open: () => $('file').click()
  };
  v.addEventListener('play', () => { if (!isPlaying()) v.pause(); setCover(); });
  v.addEventListener('playing', () => { if (isPlaying()) moved = true; setCover(); });
  v.addEventListener('pause', setCover);
  v.addEventListener('ended', () => { if (range && started && !ended) finish(); });   // a part that runs to the very end
  const db = () => new Promise((res, rej) => {
    const r = indexedDB.open('video-lessons', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const dbDo = (mode, fn) => db().then((d) => new Promise((res, rej) => {
    const q = fn(d.transaction('files', mode).objectStore('files')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  }));
  const use = (blob) => {
    v.src = URL.createObjectURL(blob);
    v.onloadedmetadata = () => {
      const want = L.video.duration;
      $('warn').textContent = want && Math.abs(v.duration - want) > 2 ? '⚠ A different video?' : '';
      if (range && !started) v.currentTime = range.from;
      setCover();
    };
  };
  $('file').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    started = false; ended = false; intent = false;
    use(f);
    dbDo('readwrite', (s) => s.put(f, L.id)).catch(() => {});
  });
  $('change').addEventListener('click', () => m.open());
  dbDo('readonly', (s) => s.get(L.id)).then((f) => { if (f) use(f); }).catch(() => {});
  return m;
}

/* ---------- Captions ---------- */
function setLines(arr){                   // arr: [[start, end, text], …]
  LINES = arr.map(([t, end, text]) => ({t, end, text})).filter((l) => l.text);
  sizeCaption(); drawCaption(true);
}
function linesIn(a, b){ return LINES.filter((l) => l.t >= a - 0.3 && l.t < b - 0.3); }
function loadCaptions(){                  // called at the very end, when everything is defined
if (L.captions.type === 'lrc') {
  fetch(L.captions.url).then((r) => r.json()).then((d) => {
    const ls = (d.syncedLyrics || '').split('\n').map((l) => {
      const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      return m ? [+m[1] * 60 + +m[2], 0, m[3].replace(/'/g, '’')] : null;
    }).filter(Boolean);
    ls.forEach((l, n) => { l[1] = ls[n + 1] ? ls[n + 1][0] : l[0] + 5; });
    setLines(ls);
  }).catch(() => { capsNote = 'The lyrics didn’t load. Reload the page.'; drawCaption(true); });
} else {
  const m = location.hash.match(/[#&]c=([\w-]+)/);
  if (m) {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text().then((t) => {
      const arr = JSON.parse(t);
      // Saved in this browser, so the link is needed only once; then the long part leaves the address bar.
      if (store.set('caps', arr)) history.replaceState(null, '', location.pathname + location.search);
      setLines(arr);
    }).catch(() => { capsNote = 'The subtitles in this link didn’t work. Open the link from the chat again.'; drawCaption(true); });
  } else {
    const saved = store.get('caps', null);
    if (saved) setLines(saved);
    else capsNote = 'No subtitles yet: open this page from the link in the chat.';
  }
}
}

/* ---------- Words: key words in yellow, every word tappable ---------- */
function hlFor(s){
  if (s.kind === 'line') return s.hl;
  if (s.kind === 'all') return PARTS[s.pn].lines.flatMap((l) => l.hl);
  return (dict[pr.n] || {}).hl || [];
}
function find(text, phrases){              // → [[from, to, index]] where each phrase is in the text (whole words only)
  const out = [];
  phrases.forEach((w, k) => {
    const pat = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, '[’\']').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|[^\\w’'])(${pat})(?![\\w’'])`, 'gi');
    let m; while ((m = re.exec(text))) { const a = m.index + m[1].length; out.push([a, a + m[2].length, k]); }
  });
  return out;
}
// Each tappable word may sit in a key phrase from another part (data-key) or in a phrase for later (data-later).
function marked(text, hls){
  const n = text.length, mk = new Array(n).fill(false), kk = new Array(n).fill(-1), lt = new Array(n).fill(-1);
  find(text, hls).forEach(([a, b]) => { for (let c = a; c < b; c++) mk[c] = true; });
  find(text, KEYS.map((x) => x.p)).forEach(([a, b, k]) => { for (let c = a; c < b; c++) if (kk[c] < 0) kk[c] = k; });
  find(text, LATER.map((x) => x.p)).forEach(([a, b, k]) => { for (let c = a; c < b; c++) if (lt[c] < 0) lt[c] = k; });
  const re = /[A-Za-z0-9’']+|[^A-Za-z0-9’']+/g;
  let h = '', open = false, m;
  while ((m = re.exec(text))) {
    const a = m.index, t = m[0], word = /[A-Za-z0-9]/.test(t);
    if (mk[a] !== open) { h += open ? '</mark>' : '<mark>'; open = mk[a]; }
    const tag = mk[a] ? '' : kk[a] >= 0 ? ` data-key="${kk[a]}"` : lt[a] >= 0 ? ` data-later="${lt[a]}"` : '';
    h += word ? `<span class="tw"${tag}>${esc(t)}</span>` : esc(t);
  }
  return h + (open ? '</mark>' : '');
}
const base = (t) => t.toLowerCase().replace(/'/g, '’').replace(/\(.*?\)|…/g, '').replace(/\s+/g, ' ').trim();
// Every key phrase of the lesson as it is sung (hl[k] belongs to words[k]), so a tap gives the phrase's Ukrainian
// in any part, also where it isn't yellow.
const KEYS = [];
PARTS.forEach((p) => p.lines.forEach((l) => (l.hl || []).forEach((h, k) => {
  const w = l.words[k] || l.words[0];
  if (w && w[1] && !KEYS.some((x) => base(x.p) === base(h))) KEYS.push({p: h, ua: w[1]});
})));
function learnWords(){
  const s = STEPS[i];
  if (s.kind === 'line') return s.words;
  if (s.kind === 'all') return PARTS[s.pn].lines.flatMap((l) => l.words);
  const d = dict[pr.n]; return d ? [[d.en, d.ua || '']] : [];
}
function lookup(w){
  const k = base(w).replace(/^’+|’+$/g, '');
  return GLOSS[k] || GLOSS[k.replace(/’s$/, '')] || '';
}
// A tapped word: inside a key phrase → that phrase; inside a "later" phrase → it, marked for later; else the word.
function glossOf(el){
  const mk = el.closest('mark');
  if (mk) {
    const p = base(mk.textContent), ws = learnWords();
    const w = ws.find((x) => base(x[0]) === p) || ws.find((x) => p.includes(base(x[0])) || base(x[0]).includes(p));
    if (w && w[1]) return {en: mk.textContent, ua: w[1]};
    const key = KEYS.find((x) => base(x.p) === p);
    if (key) return {en: mk.textContent, ua: key.ua};
  }
  const phrase = (x, later) => {
    const line = el.parentNode.textContent, hit = find(line, [x.p])[0];
    return {en: hit ? line.slice(hit[0], hit[1]) : x.p, ua: x.ua, later};
  };
  if (el.dataset.key != null) return phrase(KEYS[+el.dataset.key], false);
  if (el.dataset.later != null) return phrase(LATER[+el.dataset.later], true);
  const ua = lookup(el.textContent);
  return ua ? {en: el.textContent, ua} : null;
}
function hidePop(){ $('pop').hidden = true; document.querySelectorAll('.tw.on').forEach((x) => x.classList.remove('on')); }
function showPop(el){
  const g = glossOf(el);
  hidePop();
  if (!g) return;
  const r = el.getBoundingClientRect(), p = $('pop');
  p.innerHTML = `<b>${esc(g.en)}</b><span class="pua">${esc(g.ua)}</span>${g.later ? `<small>${esc(LATER_TEXT)}</small>` : ''}`;
  p.hidden = false;
  const half = p.offsetWidth / 2 + 8;
  p.style.left = `${Math.min(innerWidth - half, Math.max(half, r.left + r.width / 2))}px`;
  p.style.top = `${r.top - 8}px`;
  el.classList.add('on');
}

/* ---------- Drawing ---------- */
function stepRange(){
  const s = STEPS[i];
  if (s.kind !== 'practice') return {from: s.start, to: s.end, hl: hlFor(s)};
  const d = dict[pr.n];
  return d && pr.n < dict.length ? {from: d.start, to: d.end, hl: d.hl || []} : null;
}
const captionShown = () => {
  const s = STEPS[i];
  return s.kind === 'line' ? heard[i] : s.kind === 'all' ? started : pr.show;
};
// A line step shows all its lines (the one being sung in full colour); "All together" shows the line being sung.
function drawCaption(force){
  const bar = $('capbar'), s = STEPS[i];
  if (capsNote) {
    if (capSig !== 'note') { bar.innerHTML = `<p class="cap note">${esc(capsNote)}</p>`; capSig = 'note'; hidePop(); }
    return;
  }
  if (!range || !LINES.length) { if (capSig !== 'empty') { bar.innerHTML = ''; capSig = 'empty'; hidePop(); } return; }
  const lines = linesIn(range.from, range.to), show = captionShown();
  const t = started && media.canSeek() ? media.time() : range.from - 1;
  let cur = -1; lines.forEach((l, n) => { if (t >= l.t - 0.15) cur = n; });
  if (s.kind === 'all') {
    const sig = `${i}|all|${show}|${cur}`;
    if (!force && sig === capSig) return;
    capSig = sig; hidePop();
    const l = lines[Math.max(0, cur)];
    bar.innerHTML = `<p class="cap${show ? '' : ' off'}">${l ? marked(l.text, range.hl) : ''}</p>`;
    return;
  }
  const sig = `${i}|${pr.n}|${range.from}|${range.to}`;
  if (force || sig !== capSig) {
    capSig = sig; hidePop();
    bar.innerHTML = lines.map((l) => `<p class="cap">${marked(l.text, range.hl)}</p>`).join('');
  }
  const live = started && !ended;
  bar.querySelectorAll('.cap').forEach((p, n) => {
    p.classList.toggle('off', !show);
    p.classList.toggle('dim', show && live && lines.length > 1 && n !== Math.max(0, cur));
  });
}
// The caption bar keeps the height of the longest step, so nothing under it moves from step to step.
function sizeCaption(){
  if (!LINES.length) return;
  const bar = $('capbar'), probe = bar.cloneNode(false);
  probe.removeAttribute('id');
  probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;width:${bar.clientWidth}px;min-height:0`;
  document.body.appendChild(probe);
  let h = 0;
  STEPS.forEach((s) => {
    if (s.kind === 'practice') return;
    const ls = linesIn(s.start, s.end), hl = hlFor(s);
    (s.kind === 'all' ? ls.map((l) => [l]) : [ls]).forEach((set) => {
      probe.innerHTML = set.map((l) => `<p class="cap">${marked(l.text, hl)}</p>`).join('');
      h = Math.max(h, probe.getBoundingClientRect().height);
    });
  });
  probe.remove();
  if (h) bar.style.minHeight = `${Math.ceil(h)}px`;
}
function drawTimeline(t){
  if (!range) { $('tlfill').style.width = '0'; $('tldot').style.left = '0'; $('tltime').textContent = ' '; return; }
  const len = range.to - range.from, f = Math.min(1, Math.max(0, (t - range.from) / len));
  $('tlfill').style.width = `${f * 100}%`; $('tldot').style.left = `${f * 100}%`;
  $('tltime').textContent = `${(f * len).toFixed(1)} / ${len.toFixed(1)} s`;
}
function isPlaying(){ return started && !ended && intent; }
// ▶ before it starts or while paused, ❚❚ while playing, ↻ when it has ended.
function setCover(){
  const playing = isPlaying(), none = !range, needFile = !!media.open && !media.ready();
  const c = $('cover');
  c.classList.toggle('playing', playing && moved);
  c.classList.toggle('wait', playing && !moved);
  c.classList.toggle('dim', !playing && started && moved);
  c.classList.toggle('none', none && !needFile);
  $('big').hidden = none || needFile;
  $('big').classList.toggle('again', ended);
  $('open').hidden = !needFile;
  const label = playing ? 'Pause' : ended ? 'Play again' : 'Play';
  c.setAttribute('aria-label', needFile ? 'Open the video' : label);
  $('bigicon').setAttribute('href', `#i-${ended ? 'again' : 'play'}`);
  $('ppicon').setAttribute('href', `#i-${playing ? 'pause' : ended ? 'again' : 'play'}`);
  $('pp').setAttribute('aria-label', label);
  $('pp').disabled = none;
}
function drawNav(){
  const s = STEPS[i], nx = STEPS[i + 1];
  let label = 'Next line', can = true;
  if (s.kind === 'line') label = nx.kind === 'all' ? 'All together' : 'Next line';
  else if (s.kind === 'all') label = nx.kind === 'practice' ? 'My words' : PARTS[s.pn + 1].name;
  else { label = 'Next word'; can = pr.n < dict.length; }
  $('nextlabel').textContent = label;
  $('next').disabled = !can;
  $('prev').classList.toggle('off', i === 0);
  const p = PARTS[s.pn];
  $('count').textContent = s.kind === 'practice' ? ' ' : `${s.kind === 'all' ? p.lines.length + 1 : s.ln + 1} / ${p.lines.length + 1}`;
  $('where').textContent = s.kind === 'practice' ? 'My words' : p.name;
  $('mywords').textContent = dict.length ? `📒 ${dict.length}` : '';
}
function wordRow([en, ua, ex]){
  const on = dict.some((d) => d.en === en);
  return `<div class="w"><b class="en">${esc(en)}</b><button class="add" data-en="${esc(en)}" aria-pressed="${on}" aria-label="${on ? 'Remove from My words' : 'Add to My words'}">${on ? '✓' : '+'}</button><span class="ua">${esc(ua)}</span>${ex ? `<p class="ex">${ex}</p>` : ''}</div>`;
}
function renderCard(){
  const s = STEPS[i];
  let h = '';
  if (s.kind === 'line') {
    h = `<div class="words">${s.words.map(wordRow).join('')}</div>`;
    if (s.note) h += `<div class="tip"><button class="btn" id="tipbtn" aria-expanded="false">💡 Note</button><p class="note off" id="note">${esc(s.note)}</p></div>`;
  } else if (s.kind === 'all') {
    const seen = new Set(), ws = PARTS[s.pn].lines.flatMap((l) => l.words).filter((w) => !seen.has(w[0]) && seen.add(w[0]));
    h = `<p class="big">All together 🎧</p><div class="chips">${ws.map(([en, ua]) => `<span class="chip"><b>${esc(en)}</b>${esc(ua)}</span>`).join('')}</div>`;
  } else if (!dict.length) {
    h = '<p class="big">That’s all 🎉</p><p class="ex">Tap + next to a word to practice it here.</p>';
  } else if (pr.n >= dict.length) {
    h = `<p class="big">You practiced ${dict.length} word${dict.length > 1 ? 's' : ''} 🎉</p><button class="btn" id="restart">↻ Once more</button>`;
  } else {
    // The answer appears where it was asked: the gap sentence becomes the whole sentence.
    const d = dict[pr.n], ex = d.ex || '';
    const gap = ex ? ex.replace(/<em>(.*?)<\/em>/, (m, w) => w.split(' ').map((x) => x.length < 2 ? x : `${x[0]}${'_'.repeat(Math.max(2, x.length - 1))}`).join(' ')) : '';
    const full = ex ? ex.replace(/<em>(.*?)<\/em>/, '<mark>$1</mark>') : `<mark>${esc(d.en)}</mark>`;
    h = `<p class="kicker">📒 ${pr.n + 1} / ${dict.length}</p>
      ${d.ua ? `<span class="uahint">${esc(d.ua)}</span>` : ''}
      <p class="big">${pr.show ? full : (gap || '?')}</p>
      <button class="btn primary${pr.show ? ' off' : ''}" id="reveal">Answer</button>`;
  }
  $('card').innerHTML = h;
}

/* ---------- Steps ---------- */
// The player stands ready at the new step's start a moment later, so quick taps on Next / Back don't pile up jumps
// (YouTube can apply them late, while the next line is already playing).
let prepT = null;
function newRange(){
  started = false; ended = false; intent = false; wantPlay = null; moved = false;
  range = stepRange();
  drawTimeline(range ? range.from : 0); drawCaption(true); setCover(); drawNav();
  clearTimeout(prepT);
  const r = range;
  if (r) prepT = setTimeout(() => { if (range === r && !started && media.ready()) media.prepare(r.from); }, 250);
}
function go(n){
  hidePop();
  if (media.ready() && (intent || media.playing())) media.pause();
  i = Math.min(STEPS.length - 1, Math.max(0, n));
  if (STEPS[i].kind === 'practice') pr = {n: 0, show: false};
  renderCard(); newRange();
}
function nextWord(d){
  hidePop();
  if (media.ready() && (intent || media.playing())) media.pause();
  pr = {n: Math.max(0, Math.min(dict.length, pr.n + d)), show: false};
  renderCard(); newRange();
}

/* ---------- Playing ---------- */
// Play the step from its start (or from `at`). If the video is already loaded, it just jumps there: no reload.
function playRange(at){
  if (!range) return;
  if (!media.ready()) {
    if (media.open) { media.open(); return; }
    wantPlay = {at}; return;
  }
  started = true; ended = false; intent = true; loadedAt = now(); heard[i] = true;
  clearTimeout(prepT);
  media.play(at ?? range.from);
  drawTimeline(at ?? range.from); drawCaption(); setCover();
}
// Play/pause: a paused step goes on from where it stopped; a finished one plays again.
// A press that comes just as it ends was meant as "pause": it stays stopped instead of starting over.
function toggle(){
  if (!range) return;
  if (!media.ready()) {
    if (media.open) media.open(); else wantPlay = wantPlay ? null : {};
    return;
  }
  if (isPlaying()) { intent = false; media.pause(); }
  else if (started && !ended) { intent = true; media.resume(); }
  else if (!(ended && now() - endedAt < 700)) playRange();
  setCover(); drawCaption();
}
// 1 second back or forward, inside the step. A paused step stays paused.
function seekBy(d){
  if (!range || !started || !media.canSeek() || now() - loadedAt < 400) return;
  const t = Math.min(range.to - 0.05, Math.max(range.from, media.time() + d));
  if (t < range.to - 0.1) ended = false;
  media.seek(t); drawTimeline(t); setCover(); drawCaption();
  flash(d < 0 ? 'flashl' : 'flashr');
}
function flash(id){
  const f = $(id); f.classList.add('on'); clearTimeout(f.t); f.t = setTimeout(() => f.classList.remove('on'), 350);
}
function finish(){
  media.pause(); ended = true; intent = false; endedAt = now();
  drawTimeline(range.to); setCover(); drawCaption();
}
// One clock for everything: stop at the end, move the timeline, follow the lines.
setInterval(() => {
  // Right after a jump the player can still report the old time for a moment: wait for the new one.
  if (!range || !started || !media.canSeek() || now() - loadedAt < 300) return;
  const playing = media.playing(), t = media.time();
  // Ended: it stays stopped where it ended (a late "pause" is sent again; it never jumps back to the start).
  if (ended) { if (playing) media.pause(); return; }
  // Safety net: if the video ever plays outside the step (YouTube started it somewhere else), bring it back.
  if (playing && (t < range.from - 0.5 || t > range.to + 0.5)) { media.seek(range.from); loadedAt = now(); return; }
  if (playing && t >= range.to - 0.06) { finish(); return; }
  if (!ended && !dragging) drawTimeline(t);
  drawCaption();
}, 50);

/* ---------- Controls ---------- */
// Tap the video = play/pause, at once. Double-tap the left or right half = 1 s back or forward (more taps = more
// seconds): the second tap undoes the first tap's play/pause, then moves.
let lastTap = 0, seeking = 0, tapWas = null;
$('cover').onclick = (e) => {
  if (media.open && !media.ready()) { media.open(); return; }
  const t = now(), box = $('cover').getBoundingClientRect();
  const dir = e.clientX - box.left < box.width / 2 ? -1 : 1;
  if (started && (t - seeking < 500 || t - lastTap < 300)) {
    if (tapWas === 'playing') { intent = true; media.resume(); } else if (tapWas === 'paused') { intent = false; media.pause(); }
    tapWas = null; lastTap = 0; seeking = t; seekBy(dir * STEP); return;
  }
  lastTap = t;
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
  if (!range || !media.ready()) return;
  dragging = true; $('tlhit').setPointerCapture(e.pointerId); drawTimeline(pointT(e));
};
$('tlhit').onpointermove = (e) => { if (dragging) drawTimeline(pointT(e)); };
$('tlhit').onpointerup = (e) => {
  if (!dragging) return;
  dragging = false; const t = pointT(e);
  if (!started || !media.canSeek()) { playRange(t); return; }
  ended = false; intent = true; loadedAt = now() - 150;
  media.seek(t); media.resume(); drawTimeline(t); setCover(); drawCaption();
};
$('tlhit').onpointercancel = () => { dragging = false; };
$('speed').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  rate = +b.dataset.r;
  $('speed').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  if (media.ready()) media.rate(rate);
};
$('next').onclick = () => { if (STEPS[i].kind === 'practice') nextWord(1); else go(i + 1); };
$('prev').onclick = () => { if (STEPS[i].kind === 'practice' && pr.n > 0) nextWord(-1); else go(i - 1); };
$('about').onclick = () => { $('credits').hidden = !$('credits').hidden; $('about').setAttribute('aria-expanded', !$('credits').hidden); };
document.addEventListener('click', (e) => {
  const w = e.target.closest('.tw');
  if (w) { if (w.classList.contains('on')) hidePop(); else showPop(w); return; }
  hidePop();
  const b = e.target.closest('button');
  if (b && e.detail > 0) b.blur();      // a mouse click or tap doesn't leave a ring around the button
  if (!b) return;
  if (b.classList.contains('add')) {
    const s = STEPS[i], en = b.dataset.en, k = dict.findIndex((d) => d.en === en);
    if (k > -1) dict.splice(k, 1);
    else { const w = s.words.find((x) => x[0] === en); dict.push({en, ua: w[1], ex: w[2] || '', hl: s.hl, start: s.start, end: s.end}); }
    saveDict();
    const on = k < 0;
    b.setAttribute('aria-pressed', on); b.textContent = on ? '✓' : '+';
    b.setAttribute('aria-label', on ? 'Remove from My words' : 'Add to My words');
    drawNav();
  }
  if (b.id === 'tipbtn') { const open = $('note').classList.toggle('off') === false; b.setAttribute('aria-expanded', open); }
  if (b.id === 'reveal') { pr.show = true; renderCard(); drawCaption(true); }
  if (b.id === 'restart') { pr = {n: -1}; nextWord(1); }
});
addEventListener('scroll', hidePop, {passive: true});
let resizeT = null;
addEventListener('resize', () => { hidePop(); clearTimeout(resizeT); resizeT = setTimeout(sizeCaption, 150); });
if (document.fonts) document.fonts.ready.then(sizeCaption);
// Keys work wherever the focus is (but not while typing): Space = play/pause (never "clicks" the last button),
// ← → = 1 second.
const typing = (e) => { const t = e.target; return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
  if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (!e.repeat) toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-STEP); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(STEP); }
  else if (e.key === 'Escape') hidePop();
}, true);
document.addEventListener('keyup', (e) => { if (!typing(e) && (e.code === 'Space' || e.key === ' ')) e.preventDefault(); }, true);

renderCard(); newRange(); loadCaptions();
})();
