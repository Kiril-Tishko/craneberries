// Edit mode (5 quick taps in the top-left corner): change words and clips right on the page, then save them to the
// shared library on GitHub (docs/real-video/words/*.json), so every lesson and the lesson chat see the change.
// Saving needs a GitHub fine-grained token for this one repository (Contents: Read and write). It is kept only in
// this browser and sent only to api.github.com.
(() => {
'use strict';
const REPO = 'kiril-tishko/craneberries', BRANCH = 'claude/vigilant-ptolemy-ltawsa', DIR = 'docs/real-video/words';
const KEY = 'rv-github-token';
const $ = (id) => document.getElementById(id), esc = App.esc;
let token = '';
try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
const dirty = new Set();
let msg = '', bad = false, sureT = 0;

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
  if (!token) { say('Add the GitHub key first (below).', true); return; }
  if (!dirty.size) { say('Nothing to save.'); return; }
  say('Saving…');
  try {
    const index = await readJSON(`${DIR}/index.json`).catch(() => App.INDEX.slice());
    for (const slug of [...dirty]) {
      const w = App.WORDS[slug];
      await put(`${DIR}/${slug}.json`, wordText(w), `Real video clips: ${w.en || slug} (edited on the page)`);
      const entry = {slug, en: w.en || slug, ua: w.ua || '', pic: w.pic || '', n: w.clips.filter((c) => !c.hidden).length};
      const i = index.findIndex((x) => x.slug === slug);
      if (i < 0) index.push(entry); else index[i] = entry;
      dirty.delete(slug);
    }
    index.sort((a, b) => a.en.localeCompare(b.en));
    await put(`${DIR}/index.json`, indexText(index), 'Real video clips: word list (edited on the page)');
    App.INDEX.splice(0, App.INDEX.length, ...index);
    say('Saved to the library. The live page shows it within a minute or two.');
  } catch (e) {
    say(`Not saved: ${e.message || e}`, true);
  }
  render();
}

/* ---------- turning edit mode on and off ---------- */
App.toggleEdit = async () => {
  const keep = App.clip();
  App.editing = !App.editing;
  document.body.classList.toggle('editing', App.editing);
  $('edit').hidden = !App.editing;
  if (App.editing && token) {
    // Edit the newest version (the live page can be a minute behind), unless there are unsaved changes.
    App.getJSON = (path) => readJSON(`${DIR}/${path}`);
    const w = App.word;
    if (w && !dirty.has(w.slug)) {
      try { App.WORDS[w.slug] = App.norm(await readJSON(`${DIR}/${w.slug}.json`), w.slug); await App.pick(w.slug, false); return; } catch (e) {}
    }
  }
  if (App.word) {
    const i = App.list().indexOf(keep);
    App.clipN = i < 0 ? 0 : i;
    App.showClip(false);
  }
  render();
};
window.addEventListener('beforeunload', (e) => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- the panel ---------- */
function say(text, isBad){ msg = text; bad = !!isBad; const m = $('e-msg'); if (m) { m.textContent = msg; m.className = `msg${bad ? ' bad' : ''}`; } }
function touch(){
  if (App.word) dirty.add(App.word.slug);
  const b = $('e-save'); if (b) b.textContent = `Save to the library (${dirty.size})`;
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

function render(){
  if (!App.editing) return;
  const w = App.word, L = App.list(), c = App.clip();
  $('edit').innerHTML = `
    <h3>✏️ Edit mode
      <button class="btn primary" id="e-save">Save to the library (${dirty.size})</button>
      <button class="btn" id="e-exit">Close</button></h3>
    <div class="msg${bad ? ' bad' : ''}" id="e-msg">${esc(msg)}</div>
    ${token ? '' : `
    <div class="row"><label>GitHub key, needed once on this computer to save
      <input id="e-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <button class="btn" id="e-token-save">Keep it</button></div>
    <div class="msg">Make one at <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens</a>:
      repository <b>craneberries</b> only, permission <b>Contents: Read and write</b>.</div>`}
    ${w ? `
    <div class="row">
      <label>Word or phrase<input data-w="en" value="${esc(w.en || '')}"></label>
      <label>Ukrainian<input data-w="ua" value="${esc(w.ua || '')}"></label>
      <label class="num">Emoji<input data-w="pic" value="${esc(w.pic || '')}"></label>
      <label>Highlight (other forms, e.g. rip[- ]?off)<input data-w="hl" value="${esc(w.hl || '')}"></label>
    </div>` : ''}
    ${c ? `
    <h3>Clip ${App.clipN + 1} / ${L.length} ${c.hidden ? '<span class="hidden-tag">hidden from students</span>' : ''}
      <button class="btn" data-act="up" ${App.clipN ? '' : 'disabled'}>◀ Move</button>
      <button class="btn" data-act="down" ${App.clipN < L.length - 1 ? '' : 'disabled'}>Move ▶</button>
      <button class="btn" data-act="hide">${c.hidden ? 'Show to students' : 'Hide'}</button>
      <button class="btn" data-act="del">Delete</button>
      <a class="btn" href="https://www.youtube.com/watch?v=${esc(c.v)}&t=${Math.floor(c.s)}s" target="_blank" rel="noopener">Open on YouTube ↗</a></h3>
    <div class="row"><label>The line (as it is said)<input data-c="line" value="${esc(c.line || '')}"></label></div>
    <div class="row">
      <label class="num">Starts (s)<input type="number" step="0.01" data-c="s" value="${c.s}"></label>
      <button class="btn" data-now="s">⏱ Now</button><button class="btn" data-nudge="s:-0.1">−0.1</button><button class="btn" data-nudge="s:0.1">+0.1</button>
      <label class="num">Ends (s)<input type="number" step="0.01" data-c="e" value="${c.e}"></label>
      <button class="btn" data-now="e">⏱ Now</button><button class="btn" data-nudge="e:-0.1">−0.1</button><button class="btn" data-nudge="e:0.1">+0.1</button>
    </div>
    <div class="row">
      <label>💡 Note in English<textarea data-c="note">${esc(c.note || '')}</textarea></label>
      <label>💡 Note in Ukrainian (used with &amp;notes=ua)<textarea data-c="noteUa">${esc(c.noteUa || '')}</textarea></label>
    </div>
    <div class="row"><label>Lines around it, for “With context” (one per line: start | end | text)<textarea data-c="around">${esc(aroundText(c.around))}</textarea></label></div>` : ''}
    ${w ? `
    <div class="row"><label>Add a clip: paste a YouTube link with the time (…?t=83)<input id="e-link" placeholder="https://youtu.be/…?t=83"></label>
      <button class="btn" id="e-add">Add clip</button></div>` : ''}
    ${token ? '<div class="row"><button class="btn" id="e-forget">Forget the GitHub key on this computer</button></div>' : ''}`;
}
App.onClip = render;
App.newWord = (text) => {
  const slug = App.slugify(text);
  if (!slug) return;
  if (App.INDEX.some((x) => x.slug === slug) || App.WORDS[slug]) { App.pick(slug, false); return; }
  App.WORDS[slug] = App.norm({en: text, ua: '', pic: '', clips: []}, slug);
  dirty.add(slug);
  say(`New word “${text}”: add its Ukrainian, an emoji and clips, then save.`);
  App.pick(slug, false);
};
App.missing = (slug) => {
  say(`“${slug.replace(/-/g, ' ')}” isn’t in the library yet.`);
  const m = $('e-msg');
  if (m) m.insertAdjacentHTML('beforeend', ` <button class="btn" id="e-create" data-slug="${esc(slug)}">Create it</button>`);
};

$('edit').addEventListener('input', (e) => {
  const t = e.target, w = App.word, c = App.clip();
  if (t.dataset.w && w) {
    w[t.dataset.w] = t.value.trim() ? t.value : '';
    App.norm(w, w.slug); App.renderCard(); App.renderChips(); App.refresh(); touch();
  } else if (t.dataset.c && c) {
    const f = t.dataset.c;
    if (f === 's' || f === 'e') { const v = parseFloat(t.value); if (!isNaN(v)) c[f] = v; }
    else if (f === 'around') c.around = parseAround(t.value);
    else c[f] = t.value;
    App.refresh(); touch();
  }
});
$('edit').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const w = App.word, c = App.clip();
  if (b.id === 'e-save') save();
  else if (b.id === 'e-exit') App.toggleEdit();
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
    const nc = {v: p.v, s: p.s, e: r2(p.s + 2), line: '', note: ''};
    const i = c ? w.clips.indexOf(c) + 1 : w.clips.length;
    w.clips.splice(i, 0, nc); App.clipN = App.list().indexOf(nc);
    touch(); say('Clip added. Play it, set where the line starts and ends (⏱ Now), type the line, then save.');
    App.showClip(false);
  } else if (b.dataset.act && c) {
    const i = w.clips.indexOf(c);
    if (b.dataset.act === 'up' || b.dataset.act === 'down') {
      const j = i + (b.dataset.act === 'up' ? -1 : 1);
      if (j < 0 || j >= w.clips.length) return;
      [w.clips[i], w.clips[j]] = [w.clips[j], w.clips[i]];
      App.clipN = App.list().indexOf(c); touch(); App.showClip(false);
    } else if (b.dataset.act === 'hide') { c.hidden = !c.hidden; touch(); render(); }
    else if (b.dataset.act === 'del') {
      if (Date.now() - sureT > 3000) { sureT = Date.now(); b.textContent = 'Sure? Tap again'; return; }
      w.clips.splice(i, 1); App.clipN = Math.max(0, i - 1); touch(); say('Clip deleted (save to keep it that way).');
      App.showClip(false);
    }
  } else if (b.dataset.now && c) {
    c[b.dataset.now] = r2(App.now()); touch(); App.refresh(); render();
  } else if (b.dataset.nudge && c) {
    const [f, d] = b.dataset.nudge.split(':'); c[f] = r2(c[f] + parseFloat(d)); touch(); App.refresh();
    const inp = $('edit').querySelector(`[data-c="${f}"]`); if (inp) inp.value = c[f];
  }
});
})();
