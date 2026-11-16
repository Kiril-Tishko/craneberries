// ↻ "Make again", in edit mode only (song pages and the clips page): Claude writes another version of a translation,
// an example, a note or a line's meaning. The one there now and the new ones are listed together; ↻ Another adds one
// more; a tap on any of them keeps it (Ctrl+Z still undoes it).
// What goes to Claude: only the short request built in promptFor() below (the word, its Ukrainian, the line it's in
// and the lines around it, the song's title, what to write, and the versions to avoid). Nothing else: no chat,
// no student, no names. It uses her own Anthropic API key, kept only in this browser and sent only to Anthropic.
(() => {
'use strict';
const KEY = 'claude-api-key';
const SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MODEL = 'claude-opus-5-5';
let key = '';
try { key = localStorage.getItem(KEY) || ''; } catch (e) {}
let client = null;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
// Examples may mark the word with <em>; everything else shows as plain text.
const show = (t) => esc(t).replace(/&lt;(\/?)em&gt;/g, '<$1em>');

async function getClient(){
  if (!client) {
    const {default: Anthropic} = await import(SDK);
    client = new Anthropic({apiKey: key, dangerouslyAllowBrowser: true});
  }
  return client;
}
const SYSTEM = 'You help an English teacher make learning material for adult Ukrainian speakers at level A2 '
  + '(pre-intermediate). American English. Easy, everyday words; keep it short. Reply with only the new text: '
  + 'no quotes, no labels, no explanation.';
function promptFor(x){
  const where = x.page === 'clip' ? 'in a short clip from a real video' : `in the song or video “${x.title}”`;
  const lines = [
    `The word or phrase: “${x.en}”${x.ua ? ` (Ukrainian: ${x.ua})` : ''}, ${where}.`,
    x.line ? `The line it is in: “${x.line}”` : '',
    x.around ? `The lines around it: ${x.around}` : ''
  ].filter(Boolean);
  const task = {
    ua: 'Give its Ukrainian translation as it is used in this line: one to four words, natural Ukrainian (never Russian).',
    example: `Write one new short everyday example sentence (at most 12 words) that uses “${x.en}” in the same meaning. `
      + 'Put <em> and </em> around the word or phrase in your sentence.',
    note: x.page === 'clip'
      ? `Write a short note for the student${x.lang === 'ua' ? ' in simple Ukrainian' : ' in very simple English'}: `
        + 'one or two short sentences saying what is happening in the clip and why the word fits.'
      : 'Write a short note in very simple English: one or two short sentences about something in this line that is '
        + 'easy to miss (a form, a sound, or the meaning here). Not a translation.',
    meaning: 'In one simple English sentence, say what this line means in the song. Not a translation, not deep.'
  }[x.kind];
  const avoid = x.options.filter(Boolean);
  return `${lines.join('\n')}\n\n${task}${avoid.length ? `\nMake it different from these:\n${avoid.map((o) => `- ${o}`).join('\n')}` : ''}`;
}
async function ask(x){
  const c = await getClient();
  const r = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // If Claude declines (rare), the request is quietly run again on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {effort: 'low'},
    system: SYSTEM,
    messages: [{role: 'user', content: promptFor(x)}]
  });
  if (r.stop_reason === 'refusal') throw new Error('Claude didn’t write one this time. Try ↻ Another.');
  const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().replace(/^["“]|["”]$/g, '');
  if (!t) throw new Error('Nothing came back. Try ↻ Another.');
  return t;
}

/* ---------- the little window ---------- */
const CSS = `.rmk{position:fixed;z-index:60;width:min(380px,94vw);display:grid;gap:8px;padding:12px;border-radius:12px;
  background:var(--surface);color:var(--ink);border:2px solid var(--accent);box-shadow:0 10px 30px rgba(0,0,0,.28);font-family:inherit}
.rmk h4{margin:0;font-size:14px;color:var(--muted)}
.rmk-opt{display:block;width:100%;text-align:left;font-family:inherit;font-size:15px;font-weight:500;line-height:1.4;padding:8px 10px;border-radius:10px;border:1px solid var(--line);
  background:var(--bg);color:var(--ink);cursor:pointer}
.rmk-opt:hover{border-color:var(--accent)}
.rmk-opt small{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.rmk-opt em{font-style:normal;font-weight:700}
.rmk-row{display:flex;gap:6px;flex-wrap:wrap}
.rmk-row button{font-family:inherit;font-size:14px;font-weight:600;padding:6px 12px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.rmk-row .go{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.rmk-row input{flex:1 1 180px;font-family:inherit;font-size:14px;font-weight:500;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.rmk-msg{font-size:13px;color:var(--muted)}
.rmk-msg.bad{color:var(--accent);font-weight:600}
.rmk-btn{font-family:inherit;font-size:14px;font-weight:700;width:28px;height:28px;padding:0;border-radius:8px;border:1px dashed var(--line);background:transparent;color:var(--muted);cursor:pointer;align-self:center}
.rmk-btn:hover{color:var(--accent);border-color:var(--accent)}`;
let styled = false, box = null, cur = null;
function close(){ if (box) box.remove(); box = null; cur = null; }
function place(anchor){
  const r = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  box.style.top = `${r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 8 - h)}px`;
}
function draw(){
  if (!box || !cur) return;
  const {x, opts, busy, msg, bad} = cur;
  box.innerHTML = `<h4>↻ ${esc(x.label)} — tap the one to keep</h4>
    ${opts.map((o, i) => `<button class="rmk-opt" data-i="${i}">${i === 0 ? '<small>now</small>' : ''}${o ? show(o) : '<i>(empty)</i>'}</button>`).join('')}
    ${key ? '' : `<div class="rmk-row"><input id="rmk-key" type="password" autocomplete="off" placeholder="Anthropic API key (sk-ant-…)">
      <button class="go" id="rmk-keep">Keep it</button></div>
      <div class="rmk-msg">Needed once on this computer. Make one at
      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</div>`}
    <div class="rmk-row"><button class="go" id="rmk-more" ${busy || !key ? 'disabled' : ''}>${busy ? 'Claude is writing…' : '↻ Another'}</button>
      <button id="rmk-close">✕ Close</button></div>
    <div class="rmk-msg${bad ? ' bad' : ''}">${esc(msg || '')}</div>`;
}
async function more(){
  if (!cur || cur.busy || !key) return;
  const c = cur;
  c.busy = true; c.msg = ''; c.bad = false; draw();
  try {
    const t = await ask({...c.x, options: [...c.opts, ...c.avoid]});
    if (cur !== c) return;
    c.opts.push(t);
  } catch (e) {
    if (cur !== c) return;
    const s = e && e.status;
    c.msg = s === 401 ? 'The Anthropic key doesn’t work: check it, or make a new one.'
      : s === 429 ? 'Too many at once: wait a moment and tap ↻ Another.'
      : (e && e.message) || 'It didn’t work. Try again.';
    c.bad = true;
    if (s === 401) { key = ''; client = null; try { localStorage.removeItem(KEY); } catch (err) {} }
  }
  c.busy = false; draw();
}
document.addEventListener('click', (e) => {
  if (!box) return;
  if (!box.contains(e.target)) { if (!e.target.closest('.rmk-btn')) close(); return; }
  const b = e.target.closest('button'); if (!b) return;
  e.stopPropagation();
  if (b.id === 'rmk-close') close();
  else if (b.id === 'rmk-more') more();
  else if (b.id === 'rmk-keep') {
    key = box.querySelector('#rmk-key').value.trim(); client = null;
    try { localStorage.setItem(KEY, key); } catch (err) {}
    draw(); more();
  } else if (b.dataset.i != null) {
    const t = cur.opts[+b.dataset.i], pick = cur.pick;
    close();
    if (+b.dataset.i > 0) pick(t);
  }
}, true);
document.addEventListener('keydown', (e) => { if (box && e.key === 'Escape') close(); });

// x: {page: 'song'|'clip', kind: 'ua'|'example'|'note'|'meaning', label, en, ua, line, around, title, lang,
//     now: the text there now, avoid: other texts not to repeat}. pick(text) is called with the one she keeps.
window.Remake = {
  open(anchor, x, pick){
    if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
    close();
    box = document.createElement('div'); box.className = 'rmk'; box.setAttribute('role', 'dialog');
    document.body.appendChild(box);
    // The other texts on the card (say, the word's other examples) are avoided too, but not offered.
    cur = {x, opts: [x.now || ''], avoid: (x.avoid || []).filter(Boolean), pick, busy: false, msg: '', bad: false};
    draw(); place(anchor);
    if (key) more();
  },
  close
};
})();
