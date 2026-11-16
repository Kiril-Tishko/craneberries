// ↻ "Make again", in edit mode only (song pages and the clips page): shows the text there now together with the
// ready-made versions written for it, and a tap keeps one (Ctrl+Z still undoes it). No key and no internet call: the
// versions are written beforehand by Claude in a chat and stored with the lesson ("versions" in lesson.json, or in the
// clip word's file), as groups of texts that can replace each other: [text, version, version, version].
// A text she typed herself, or a word she added, has none until a chat writes them ("write ↻ versions for …").
(() => {
'use strict';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
// Examples may mark the word with <em>; everything else shows as plain text.
const show = (t) => esc(t).replace(/&lt;(\/?)em&gt;/g, '<$1em>');
const same = (a, b) => String(a || '').trim() === String(b || '').trim();
// The group a text belongs to: any of its versions can be the one there now.
const groupOf = (groups, now) => (groups || []).find((g) => Array.isArray(g) && g.some((v) => same(v, now))) || null;

const CSS = `.rmk{position:fixed;z-index:60;width:min(380px,94vw);display:grid;gap:8px;padding:12px;border-radius:12px;
  background:var(--surface);color:var(--ink);border:2px solid var(--accent);box-shadow:0 10px 30px rgba(0,0,0,.28);font-family:inherit}
.rmk h4{margin:0;font-size:14px;color:var(--muted)}
.rmk-opt{display:block;width:100%;text-align:left;font-family:inherit;font-size:15px;font-weight:500;line-height:1.4;padding:8px 10px;
  border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer}
.rmk-opt:hover{border-color:var(--accent)}
.rmk-opt small{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.rmk-opt em{font-style:normal;font-weight:700}
.rmk-row{display:flex;gap:6px;flex-wrap:wrap}
.rmk-row button{font-family:inherit;font-size:14px;font-weight:600;padding:6px 12px;border-radius:9px;border:1px solid var(--line);
  background:var(--surface);color:var(--ink);cursor:pointer}
.rmk-msg{font-size:13px;color:var(--muted)}`;
let styled = false, box = null, cur = null;
function close(){ if (box) box.remove(); box = null; cur = null; }
function place(anchor){
  const r = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  box.style.top = `${r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 8 - h)}px`;
}
function draw(){
  const {x, opts} = cur;
  box.innerHTML = `<h4>↻ ${esc(x.label)}${opts.length > 1 ? ' — tap the one to keep' : ''}</h4>
    ${opts.map((o, i) => `<button class="rmk-opt" data-i="${i}">${i === 0 ? '<small>now</small>' : ''}${o ? show(o) : '<i>(empty)</i>'}</button>`).join('')}
    ${opts.length < 2 ? '<div class="rmk-msg">No other versions of this one yet. Ask the lesson chat to write ↻ versions for it.</div>' : ''}
    <div class="rmk-row"><button id="rmk-close">✕ Close</button></div>`;
}
document.addEventListener('click', (e) => {
  if (!box) return;
  if (!box.contains(e.target)) { if (!e.target.closest('.rmk-btn')) close(); return; }
  const b = e.target.closest('button'); if (!b) return;
  e.stopPropagation();
  if (b.id === 'rmk-close') close();
  else if (b.dataset.i != null) {
    const i = +b.dataset.i, t = cur.opts[i], pick = cur.pick;
    close();
    if (i > 0) pick(t);
  }
}, true);
document.addEventListener('keydown', (e) => { if (box && e.key === 'Escape') close(); });

// x: {label, now: the text there now, groups: the stored version groups}. pick(text) gets the one she keeps.
window.Remake = {
  open(anchor, x, pick){
    if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
    close();
    const g = groupOf(x.groups, x.now);
    cur = {x, opts: [x.now || '', ...(g ? g.filter((v) => !same(v, x.now)) : [])], pick};
    box = document.createElement('div'); box.className = 'rmk'; box.setAttribute('role', 'dialog');
    document.body.appendChild(box);
    draw(); place(anchor);
  },
  close, groupOf
};
})();
