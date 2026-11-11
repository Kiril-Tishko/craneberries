// Shared player for video lessons. A lesson page sets window.LESSON and loads this file:
//   id        short name, used for what this browser remembers (My words, captions, the video file)
//   title, sub
//   video     {type:'youtube', id} or {type:'file', duration}: a file she opens from her device (never put in the repo)
//   captions  {type:'lrc', url}: timed lyrics loaded live (lrclib.net)
//             {type:'link'}: captions arrive in the page link (#c=…), compressed, and stay in her browser
//   gloss     {word: Ukrainian}: tap any word in the subtitles to see it (lowercase, ’ for apostrophes)
//   parts     [{name, start, end, lines:[{words:[[en, ua, gap example?]], hl:[exact phrases], ex, note?, start, end}]}]
//             (the gap example is for My words practice; <em> marks the word that becomes the gap)
(function(){
const L = window.LESSON;
const tall = L.video.type === 'file' && L.video.tall !== false;
document.title = L.title;
document.body.innerHTML = `<div class="app">
  <header>
    <h1>${L.title} ${L.sub ? `<span>${L.sub}</span>` : ''}</h1>
    <div class="where"><span id="warn" class="warn"></span><button id="change" class="tiny" hidden>📂 Change video</button><span id="mywords"></span><span id="where"></span></div>
  </header>
  <main class="${tall ? 'tall' : 'wide'}">
    <div class="vwrap">
      <div class="video">${L.video.type === 'youtube' ? '<div id="player"></div>' : '<video id="vid" playsinline preload="auto"></video><input type="file" id="file" accept="video/*" hidden>'}
        <button class="cover" id="cover" aria-label="Play or pause"><span id="coverIcon">▶</span></button></div>
      <div class="clip"><div class="bar"><i id="fill"></i></div><span id="cliptime"></span></div>
    </div>
    <div class="subs" id="subs" aria-live="polite"></div>
    <div class="controls">
      <button id="back" class="tiny">← Back</button>
      <button id="listen" class="primary">▶ Listen</button>
      <button id="slow" aria-pressed="false" title="Play slower">🐢 Slower</button>
      <span></span>
      <button id="next" class="primary ghost">Next →</button>
    </div>
    <section class="card" id="card" aria-live="polite"></section>
  </main>
</div>
<div class="pop" id="pop" hidden></div>`;

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store = {
  get(k, d){ try { const v = localStorage.getItem(`${L.id}-${k}`); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v){ try { localStorage.setItem(`${L.id}-${k}`, JSON.stringify(v)); return true; } catch (e) { return false; } }
};

const PARTS = L.parts, GLOSS = L.gloss || {};
// Each part: listen without stopping → break it down line by line → the whole part again. Then My words.
const STEPS = [];
PARTS.forEach((p, pn) => {
  STEPS.push({kind:'first', pn, start:p.start, end:p.end});
  p.lines.forEach((l, ln) => STEPS.push(Object.assign({kind:'line', pn, ln}, l)));
  STEPS.push({kind:'again', pn, start:p.start, end:p.end});
});
STEPS.push({kind:'practice'});

let i = 0, timer = null, off = store.get('offset', 0) || 0;
let state = 'idle';            // idle · playing · paused · ended
let clip = null;               // {start, end} of the clip in use
let slow = false, slowRate = 0.75;
const heard = STEPS.map(() => false);
let LINES = [], capsNote = '';
let dict = store.get('dict', []), pr = {n: 0, show: false};
if (!Array.isArray(dict)) dict = [];
const saveDict = () => store.set('dict', dict);

/* ---------- Media: one small interface for YouTube and for a file from her device ---------- */
const media = {ready: false, time: () => 0, seek(){}, play(){}, pause(){}, rate(){}};
if (L.video.type === 'youtube'){
  let yt = null;
  window.onYouTubeIframeAPIReady = () => {
    yt = new YT.Player('player', {videoId: L.video.id,
      playerVars: {controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, cc_load_policy: 0, modestbranding: 1},
      events: {
        onReady: () => { media.ready = true; },
        onStateChange: (e) => {
          if (e.data !== 1) return;
          // Speed can only be set while the video plays; hide the button if this video has no slower speed.
          const rates = yt.getAvailablePlaybackRates ? yt.getAvailablePlaybackRates() : [1];
          slowRate = rates.includes(0.75) ? 0.75 : (rates.includes(0.5) ? 0.5 : 1);
          if (slowRate === 1){ slow = false; $('slow').classList.add('ghost'); }
          yt.setPlaybackRate(slow ? slowRate : 1);
        }
      }});
  };
  Object.assign(media, {
    time: () => yt.getCurrentTime(), seek: (t) => yt.seekTo(t, true), play: () => yt.playVideo(),
    pause: () => yt && yt.pauseVideo(), rate: (r) => yt.setPlaybackRate(r)
  });
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.body.appendChild(s);
} else {
  // The file stays on her device: the page keeps it in this browser (IndexedDB) so she opens it only once.
  const v = $('vid');
  Object.assign(media, {
    time: () => v.currentTime, seek: (t) => { v.currentTime = t; }, play: () => v.play().catch(() => {}),
    pause: () => v.pause(), rate: (r) => { v.playbackRate = r; }
  });
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
      media.ready = true; $('change').hidden = false;
      const want = L.video.duration;
      $('warn').textContent = want && Math.abs(v.duration - want) > 2 ? '⚠ This looks like a different video' : '';
      render();
    };
  };
  media.open = () => $('file').click();
  $('file').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    use(f);
    dbDo('readwrite', (s) => s.put(f, L.id)).catch(() => {});
  });
  $('change').addEventListener('click', () => media.open());
  dbDo('readonly', (s) => s.get(L.id)).then((f) => { if (f) use(f); }).catch(() => {});
}

/* ---------- Captions ---------- */
function setLines(arr){                   // arr: [[start, end, text], …]
  LINES = arr.map(([t, end, text]) => ({t, end, text})).filter((l) => l.text);
  drawSubs();
}
if (L.captions.type === 'lrc'){
  fetch(L.captions.url).then((r) => r.json()).then((d) => {
    const ls = (d.syncedLyrics || '').split('\n').map((l) => {
      const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      return m ? [+m[1] * 60 + +m[2], 0, m[3]] : null;
    }).filter(Boolean);
    ls.forEach((l, n) => { l[1] = ls[n + 1] ? ls[n + 1][0] : l[0] + 5; });
    setLines(ls);
  }).catch(() => { capsNote = 'The subtitles didn’t load. Reload the page.'; drawSubs(); });
} else {
  const m = location.hash.match(/[#&]c=([\w-]+)/);
  if (m){
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text().then((t) => {
      const arr = JSON.parse(t);
      // Saved in this browser, so the link is needed only once; then the long part leaves the address bar.
      if (store.set('caps', arr)) history.replaceState(null, '', location.pathname + location.search);
      setLines(arr);
    }).catch(() => { capsNote = 'The subtitles in this link didn’t work. Open the link from the chat again.'; drawSubs(); });
  } else {
    const saved = store.get('caps', null);
    if (saved) setLines(saved);
    else capsNote = 'No subtitles yet: open this page from the link in the chat.';
  }
}

/* ---------- Drawing ---------- */
function hlFor(s){
  if (s.kind === 'line') return s.hl;
  if (s.kind === 'first' || s.kind === 'again') return PARTS[s.pn].lines.flatMap((l) => l.hl);
  return (dict[pr.n] || {}).hl || [];
}
// Every word is a tappable span; the key phrases (exact matches only) sit inside <mark>.
const words = (t) => t.split(/([A-Za-z0-9’']+)/).map((x, n) => (n % 2 ? `<span class="tw">${esc(x)}</span>` : esc(x))).join('');
function marked(text, hls){
  const ranges = [];
  hls.forEach((w) => {
    const pat = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, "[’']");
    const re = new RegExp(`(^|[^\\w’'])(${pat})(?![\\w’'])`, 'gi');
    let m; while ((m = re.exec(text))){ const a = m.index + m[1].length; ranges.push([a, a + m[2].length]); }
  });
  ranges.sort((a, b) => a[0] - b[0]);
  let h = '', at = 0;
  ranges.forEach(([a, b]) => {
    if (a < at) return;
    h += words(text.slice(at, a)) + `<mark>${words(text.slice(a, b))}</mark>`; at = b;
  });
  return h + words(text.slice(at));
}
function fit(box){
  const ps = [...box.querySelectorAll('p')]; if (!ps.length) return;
  ps.forEach((p) => { p.style.fontSize = ''; });
  let size = parseFloat(getComputedStyle(ps[0]).fontSize);
  while (size > 11 && (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1)){
    size -= 1; ps.forEach((p) => { p.style.fontSize = `${size}px`; });
  }
}
const linesIn = (a, b) => LINES.filter((l) => l.t >= a - .3 && l.t < b - .3);
const nowT = () => (media.ready ? media.time() - off : (clip ? clip.start : 0));

// Subtitles box: fixed height. Every line of a short clip is laid out from the start and fades in when it is said,
// so nothing moves. In a whole part, only the current line shows while it plays; when it stops, the whole part stays.
function drawSubs(){
  const box = $('subs'), s = STEPS[i];
  box.className = 'subs';
  const keep = box.dataset.sig; box.dataset.sig = '';
  if (capsNote){ box.innerHTML = `<p class="note">${esc(capsNote)}</p>`; return; }
  const range = s.kind === 'practice' ? clip : s;
  if (!range || !LINES.length || (s.kind !== 'practice' && !heard[i])){ box.innerHTML = '<p class="note">🎧</p>'; return; }
  const hls = hlFor(s), lines = linesIn(range.start, range.end), t = nowT();
  const live = state === 'playing' || state === 'paused';
  if (s.kind === 'first' || s.kind === 'again'){
    if (live){
      const cur = LINES.filter((l) => l.t <= t + .15).pop();
      const key = cur ? cur.t : -1;
      if (box.dataset.key === String(key)) return;        // same line: keep it (and any open translation)
      box.dataset.key = key;
      box.innerHTML = `<p>${cur && cur.t >= range.start - .3 ? marked(cur.text, hls) : '…'}</p>`;
      fit(box); return;
    }
    box.dataset.key = '';
    if (lines.length > 3) box.classList.add('cols');
    box.innerHTML = lines.map((l) => `<p>${marked(l.text, hls)}</p>`).join('');
    fit(box); return;
  }
  box.dataset.key = ''; box.dataset.sig = keep;
  const wait = (l) => live && l.t > t + .15 && l !== lines[0];
  const sig = `${i}|${range.start}|${range.end}|${hls.join('/')}`;
  if (lines.length && box.dataset.sig === sig){
    // Same lines: only the fade changes, in place, so the words under her finger stay put.
    box.querySelectorAll('p').forEach((p, n) => p.classList.toggle('wait', wait(lines[n])));
    return;
  }
  box.dataset.sig = lines.length ? sig : '';
  box.innerHTML = lines.map((l) => `<p class="${wait(l) ? 'wait' : ''}">${marked(l.text, hls)}</p>`).join('') || '<p class="note">🎧</p>';
  fit(box);
}
function drawClip(){
  if (!clip){ $('fill').style.width = '0'; $('cliptime').textContent = ''; return; }
  const len = clip.end - clip.start;
  const done = state === 'ended' ? len : Math.min(len, Math.max(0, nowT() - clip.start));
  $('fill').style.width = `${(done / len) * 100}%`;
  $('cliptime').textContent = `${Math.round(done)} / ${Math.round(len)} s`;
}
function drawPlayer(){
  const s = STEPS[i], practice = s.kind === 'practice';
  const noClip = practice && !(pr.show && dict[pr.n]);
  const needFile = media.open && !media.ready;
  $('cover').classList.toggle('playing', state === 'playing');
  const icon = $('coverIcon');
  icon.textContent = needFile ? '📂 Open the video' : (state === 'ended' ? '↺' : '▶');
  icon.className = needFile ? 'open' : '';
  icon.hidden = noClip && !needFile;
  $('cover').style.cursor = noClip && !needFile ? 'default' : 'pointer';
  const B = $('listen');
  B.textContent = practice ? '▶ Hear it' : (heard[i] ? '↺ Listen again' : '▶ Listen');
  B.className = practice || heard[i] ? '' : 'primary';
  B.classList.toggle('ghost', practice && noClip);
  $('back').classList.toggle('ghost', i === 0);
  const N = $('next');
  let label = 'Next →', show = heard[i];
  if (s.kind === 'first') label = 'Break it down →';
  if (s.kind === 'again') label = s.pn + 1 < PARTS.length ? `${PARTS[s.pn + 1].name} →` : 'My words →';
  if (practice){ label = 'Next word →'; show = pr.show && pr.n < dict.length; }
  N.textContent = label;
  N.classList.toggle('ghost', !show);
}
function where(){
  const s = STEPS[i];
  if (s.kind === 'practice') return 'My words';
  const p = PARTS[s.pn];
  if (s.kind === 'line') return `${p.name} · line ${s.ln + 1} of ${p.lines.length}`;
  return p.name;
}

function render(){
  hidePop(); $('subs').dataset.key = ''; $('subs').dataset.sig = '';
  const s = STEPS[i], h = heard[i];
  $('mywords').textContent = dict.length ? `📒 ${dict.length}` : '';
  $('where').textContent = where();
  let html = '';
  if (s.kind === 'first'){
    const nextPart = STEPS.findIndex((x, n) => n > i && x.kind === 'first');
    html = `<p class="big">Listen to ${PARTS[s.pn].name.toLowerCase()} without stopping 🎧</p>
      <p class="ex">Then we break it down line by line.</p>
      <button class="tiny skip ${h ? '' : 'ghost'}" id="skip" data-to="${nextPart > -1 ? nextPart : STEPS.length - 1}">Skip to ${nextPart > -1 ? PARTS[s.pn + 1].name : 'My words'} →</button>`;
  } else if (s.kind === 'line'){
    html = `<div class="words">${s.words.map(([en, ua]) => {
        const on = dict.some((d) => d.en === en);
        return `<div class="w"><b>${esc(en)}</b><button class="add" data-en="${esc(en)}" aria-pressed="${on}" aria-label="${on ? 'Remove from my words' : 'Add to my words'}">${on ? '✓' : '+'}</button><span class="ua">${esc(ua)}</span></div>`;
      }).join('')}</div>
      <p class="ex">${s.ex}</p>
      ${s.note ? `<div class="notewrap"><button class="tiny" id="noteBtn" aria-expanded="false">💡 Note</button><p class="tip" id="noteText" hidden>${esc(s.note)}</p></div>` : ''}`;
  } else if (s.kind === 'again'){
    html = `<p class="big">Now ${PARTS[s.pn].name.toLowerCase()} again, without stopping</p>
      <p class="ex">Can you catch every word now?</p>`;
  } else if (!dict.length){
    html = `<p class="big">That’s all for now 🎉</p><p class="ex">Tap + next to a word to practice it here.</p>`;
  } else if (pr.n >= dict.length){
    html = `<p class="big">You practiced ${dict.length} word${dict.length > 1 ? 's' : ''} 🎉</p>
      <button id="restart" class="primary" style="align-self:flex-start">↺ Once more</button>`;
  } else {
    const d = dict[pr.n];
    html = `<p class="kicker">📒 ${pr.n + 1} of ${dict.length}</p>
      <p class="big">${d.ex ? d.ex.replace(/<em>.*?<\/em>/, '_____') : esc(d.ua || '')}</p>
      <p class="ex ${pr.show ? 'ghost' : ''}">${d.ex ? 'Which word goes in the gap?' : 'How do you say it in English?'}</p>
      <p class="answer ${pr.show ? '' : 'ghost'}">${esc(d.en)}</p>
      <button id="reveal" class="primary ${pr.show ? 'ghost' : ''}" style="align-self:flex-start">Show the answer</button>`;
  }
  $('card').innerHTML = html;
  drawPlayer(); drawSubs(); drawClip();
}

/* ---------- Playing ---------- */
function tick(){
  drawSubs(); drawClip();
  if (state === 'playing' && media.time() >= clip.end + off) finish();
}
function finish(){ clearInterval(timer); state = 'ended'; if (media.ready) media.pause(); drawPlayer(); drawSubs(); drawClip(); }
function startClip(c){
  if (!media.ready){ if (media.open) media.open(); return; }
  clip = c; state = 'playing';
  clearInterval(timer);
  media.seek(Math.max(0, c.start + off));
  media.rate(slow ? slowRate : 1);
  media.play();
  timer = setInterval(tick, 120);
  drawPlayer(); drawSubs(); drawClip();
}
function pause(){ clearInterval(timer); if (media.ready) media.pause(); state = 'paused'; drawPlayer(); }
function resume(){ if (!media.ready) return; media.play(); state = 'playing'; timer = setInterval(tick, 120); drawPlayer(); }
function stepClip(){
  const s = STEPS[i];
  if (s.kind !== 'practice') return {start: s.start, end: s.end};
  const d = dict[pr.n]; return d && pr.show ? {start: d.start, end: d.end} : null;
}
function listen(){            // side button: always plays the clip from its start
  if (!media.ready && media.open) return media.open();
  const c = stepClip(); if (!c) return;
  if (STEPS[i].kind !== 'practice' && !heard[i]){ heard[i] = true; render(); }
  startClip(c);
}
function videoClick(){        // the video: pause / continue; after the end, play again
  if (!media.ready && media.open) return media.open();
  if (state === 'playing') return pause();
  if (state === 'paused') return resume();
  listen();
}
function go(n){
  clearInterval(timer); if (media.ready) media.pause();
  state = 'idle'; clip = null;
  i = Math.min(STEPS.length - 1, Math.max(0, n));
  if (STEPS[i].kind === 'practice') pr = {n: 0, show: false};
  render();
}

/* ---------- Tap a word: its Ukrainian translation ---------- */
function lookup(w){
  const k = w.toLowerCase().replace(/'/g, '’');
  return GLOSS[k] || GLOSS[k.replace(/’s$/, '')] || '';
}
function hidePop(){ $('pop').hidden = true; document.querySelectorAll('.tw.on').forEach((x) => x.classList.remove('on')); }
function showPop(el){
  const ua = lookup(el.textContent);
  hidePop();
  if (!ua) return;
  const r = el.getBoundingClientRect(), p = $('pop');
  p.innerHTML = `<b>${esc(el.textContent)}</b><span>${esc(ua)}</span>`;
  p.hidden = false;
  const half = p.offsetWidth / 2 + 8;
  p.style.left = `${Math.min(innerWidth - half, Math.max(half, r.left + r.width / 2))}px`;
  p.style.top = `${r.top - 8}px`;
  el.classList.add('on');
}

document.addEventListener('click', (e) => {
  const w = e.target.closest('.tw');
  if (w){ if (w.classList.contains('on')) hidePop(); else showPop(w); return; }
  hidePop();
  const b = e.target.closest('button'); if (!b || b.classList.contains('ghost')) return;
  if (b.id === 'listen') listen();
  if (b.id === 'cover') videoClick();
  if (b.id === 'slow'){ slow = !slow; b.setAttribute('aria-pressed', slow); if (media.ready && state === 'playing') media.rate(slow ? slowRate : 1); }
  if (b.id === 'back') go(i - 1);
  if (b.id === 'skip') go(+b.dataset.to);
  if (b.id === 'next'){
    if (STEPS[i].kind === 'practice'){ clearInterval(timer); if (media.ready) media.pause(); state = 'idle'; clip = null; pr = {n: pr.n + 1, show: false}; render(); }
    else go(i + 1);
  }
  if (b.classList.contains('add')){
    const s = STEPS[i], en = b.dataset.en, k = dict.findIndex((d) => d.en === en);
    if (k > -1) dict.splice(k, 1);
    else {
      const w = s.words.find((x) => x[0] === en), em = (s.ex.match(/<em>(.*?)<\/em>/) || [])[1] || '';
      const base = (t) => t.toLowerCase().replace(/[(…].*$/, '').replace(/’/g, "'").trim();
      const ex = w[2] || (em && (base(em).includes(base(en)) || base(en).includes(base(em))) ? s.ex : '');
      dict.push({en, ua: w[1], ex, hl: s.hl, start: s.start, end: s.end});
    }
    saveDict(); render();
  }
  if (b.id === 'reveal'){ pr.show = true; render(); }
  if (b.id === 'noteBtn'){ const t = $('noteText'); t.hidden = !t.hidden; b.setAttribute('aria-expanded', String(!t.hidden)); }
  if (b.id === 'restart'){ pr = {n: 0, show: false}; render(); }
});
addEventListener('scroll', hidePop, {passive: true});
addEventListener('resize', hidePop);
document.addEventListener('keydown', (e) => {
  if (e.key === ' '){ e.preventDefault(); videoClick(); }
  if (e.key === 'ArrowRight' && !$('next').classList.contains('ghost')) $('next').click();
  if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
  if (e.key === 'Escape') hidePop();
  // Subtitles out of time with the video? [ and ] move them by half a second (remembered in this browser).
  if (e.key === '[' || e.key === ']'){
    off = Math.round((off + (e.key === ']' ? .5 : -.5)) * 10) / 10;
    store.set('offset', off);
  }
});
render();
})();
