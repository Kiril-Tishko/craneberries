// The caption editor for one clip (his wish, Nov 21): fix a line's words, move words to the line before or after
// (the cut was in the wrong place), start a new line at a word, join a line with the one above or below, and choose
// which line is the clip's own (★). Used by the caption index page on his PC (tools/real-video/index/site.html,
// served by site.pl) and by the picks page here (index.html).
//
//   const ed = CapsEdit.create(box, {onChange(r), onPlay(at, own), onReset()});
//   ed.set(screens, clip, hl)   screens = [{s, e, t, w?}, …] in time order (w = each word's start, seconds),
//                               clip = the index of the clip's own line, hl = RegExps of the searched words
//   onChange gets {screens, clip, line, around, s, e}: what the player needs (around = [[s, e, text], …]).
//
// Times: a moved word keeps its own time (from the auto-captions), else one spread by letters over its line, so a
// line's new start or end lands where its first word is said.
'use strict';
(function () {
  const CSS = `
.ce { font-size: 14px; color: var(--ink); }
.ce-bar { padding: 8px 10px 6px; border-bottom: 1px solid var(--line); display: grid; gap: 6px; }
.ce-ops { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.ce-ops .ce-b { padding: 5px 4px; }
.ce-tools { display: flex; gap: 6px; align-items: center; height: 26px; }
.ce-hint { color: var(--faint); font-size: 12.5px; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ce button { font: inherit; color: inherit; }
.ce-b { font-size: 12.5px; padding: 5px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); cursor: pointer; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ce-b:disabled { opacity: .35; cursor: default; }
.ce-tools .ce-b { padding: 3px 8px; }
.ce-ops .ce-b:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ce-lines { list-style: none; margin: 0; padding: 6px 6px 12px; }
.ce-line { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px 8px; align-items: start; padding: 7px 8px; border-radius: 10px; border-left: 3px solid transparent; }
.ce-line + .ce-line { margin-top: 2px; }
.ce-line.star { background: var(--now); border-left-color: var(--accent); }
.ce-t { border: 0; background: none; padding: 2px 4px; margin: 0; border-radius: 6px; color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; cursor: pointer; line-height: 1.5; }
.ce-t:hover { background: var(--chip); color: var(--ink); }
.ce-x { line-height: 1.55; overflow-wrap: anywhere; }
.ce-x .w { cursor: pointer; border-radius: 4px; padding: 1px 1px; }
.ce-x .w:hover { background: var(--chip); }
.ce-x .w.hit { background: var(--hit); color: var(--hit-ink); }
.ce-x .w.take { background: var(--chip); box-shadow: inset 0 -2px 0 var(--accent); }
.ce-x .w.sel { background: var(--accent); color: var(--accent-ink); }
.ce-in { width: 100%; font: inherit; line-height: 1.5; padding: 2px 6px; border-radius: 7px; border: 1px solid var(--accent); background: var(--bg); color: var(--ink); resize: none; overflow: hidden; display: block; }
.ce-acts { display: flex; gap: 2px; }
.ce-a { border: 0; background: none; color: var(--faint); cursor: pointer; padding: 2px 5px; border-radius: 6px; font-size: 13px; line-height: 1.5; }
.ce-a:hover:not(:disabled) { background: var(--chip); color: var(--ink); }
.ce-a:disabled { opacity: .25; cursor: default; }
.ce-a.on { color: var(--accent); }
`;
  let styled = false;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const r2 = x => Math.round(x * 100) / 100;
  const tenth = sec => { sec = Math.max(0, sec || 0); const m = Math.floor(sec / 60), x = sec - m * 60; return m + ':' + x.toFixed(1).padStart(4, '0'); };
  const tokens = t => { const out = [], re = /\S+/g; let m; while ((m = re.exec(t || ''))) out.push([m[0], m.index]); return out; };
  // A line as words with times: its own word times where the captions had them, else spread by letters.
  function toLine(sc) {
    const t = String(sc.t || ''), s = +sc.s || 0, e = Math.max(+sc.e || 0, s + 0.1), tk = tokens(t), len = Math.max(1, t.length);
    const w = Array.isArray(sc.w) && sc.w.length === tk.length ? sc.w : null;
    return {s, e, words: tk.map(([x, at], j) => ({x, at: w ? +w[j] : s + (e - s) * at / len}))};
  }
  const textOf = l => l.words.map(w => w.x).join(' ');

  function create(box, opt = {}) {
    if (!styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); styled = true; }
    let L = [], star = 0, hl = [], sel = null, typing = -1, undo = [], redo = [];
    const snap = () => JSON.stringify({L, star});
    const load = s => { const o = JSON.parse(s); L = o.L; star = o.star; };

    // ---- the changes ----
    function change(fn) {
      const before = snap();
      fn();
      if (snap() === before) return;
      undo.push(before); if (undo.length > 100) undo.shift(); redo = [];
      sel = null; emit(); draw();
    }
    const fix = l => { l.s = r2(l.s); l.e = r2(Math.max(l.e, l.s + 0.1)); };
    const gone = i => { L.splice(i, 1); if (star > i) star--; };
    // Words 0..j of line i go to the end of the line above.
    function up(i, j) {
      const a = L[i - 1], b = L[i]; if (!a || !b) return;
      a.words.push(...b.words.splice(0, j + 1));
      if (!b.words.length) { a.e = Math.max(a.e, b.e); if (star === i) star = i - 1; gone(i); }
      else { const t = b.words[0].at; a.e = Math.max(a.e, Math.min(t, b.e - 0.1)); b.s = Math.max(b.s, Math.min(t, b.e - 0.1)); fix(b); }
      fix(a);
    }
    // Words j..end of line i go to the start of the line below.
    function down(i, j) {
      const a = L[i], b = L[i + 1]; if (!a || !b) return;
      const moved = a.words.splice(j);
      b.words.unshift(...moved);
      if (!a.words.length) { b.s = Math.min(b.s, a.s); if (star === i) star = i + 1; gone(i); }
      else { const t = moved[0].at; b.s = Math.min(b.s, Math.max(t, a.s + 0.1)); a.e = Math.max(a.s + 0.1, Math.min(a.e, t)); fix(a); }
      fix(b);
    }
    const hits = l => hl.some(re => { re.lastIndex = 0; return re.test(textOf(l)); });
    // A new line from word j on (the clip's own stays with the part that has the searched words).
    function split(i, j) {
      const a = L[i]; if (!a || j < 1 || j >= a.words.length) return;
      const rest = a.words.splice(j), t = Math.min(Math.max(rest[0].at, a.s + 0.1), a.e - 0.1);
      const b = {s: t, e: a.e, words: rest}; a.e = t; fix(a); fix(b);
      L.splice(i + 1, 0, b);
      if (star > i) star++;
      else if (star === i && hits(b) && !hits(a)) star = i + 1;
    }
    // Typed text: the same number of words keeps their times, else they are spread over the line again.
    function type(i, text) {
      const l = L[i], tk = tokens(text);
      if (!tk.length) { if (i !== star && L.length > 1) gone(i); return; }
      if (tk.length === l.words.length) l.words = tk.map(([x], j) => ({x, at: l.words[j].at}));
      else { const len = Math.max(1, text.length); l.words = tk.map(([x, at]) => ({x, at: l.s + (l.e - l.s) * at / len})); }
    }

    // ---- what the page gets ----
    function result() {
      const screens = L.map(l => ({s: r2(l.s), e: r2(l.e), t: textOf(l), w: l.words.map(w => r2(w.at))}));
      const own = screens[star];
      return {screens, clip: star, line: own.t, s: own.s, e: own.e,
        around: screens.filter((x, k) => k !== star).map(x => [x.s, x.e, x.t])};
    }
    const emit = () => { if (opt.onChange) opt.onChange(result()); };

    // ---- drawing ----
    function wordsHtml(l, i) {
      const text = textOf(l), on = [];
      if (i === star) for (const re of hl) { re.lastIndex = 0; let m; while ((m = re.exec(text))) { if (!m[0]) { re.lastIndex++; continue; } on.push([m.index, m.index + m[0].length]); } }
      let at = 0;
      return l.words.map((w, j) => {
        const a = at, b = at + w.x.length; at = b + 1;
        const cls = ['w'];
        if (on.some(([x, y]) => a < y && b > x)) cls.push('hit');
        if (sel && sel.i === i && sel.j === j) cls.push('sel');
        return `<span class="${cls.join(' ')}" data-j="${j}">${esc(w.x)}</span>`;
      }).join(' ');
    }
    function draw() {
      const s = sel && L[sel.i] ? sel : null, l = s ? L[s.i] : null;
      const quote = (a, b) => '“' + l.words.slice(a, b).map(w => w.x).join(' ') + '”';
      // Two rows that never change size: the moves (ready once a word is tapped), then a hint and undo / redo.
      const ops = `<div class="ce-ops">
          <button type="button" class="ce-b" data-a="up" ${s && s.i > 0 ? '' : 'disabled'} title="${s ? `Move ${esc(quote(0, s.j + 1))} to the end of the line above` : 'Tap a word first'}">‹ Line above</button>
          <button type="button" class="ce-b" data-a="split" ${s && s.j > 0 ? '' : 'disabled'} title="${s ? `Start a new line at ${esc(quote(s.j, s.j + 1))}` : 'Tap a word first'}">✂ New line</button>
          <button type="button" class="ce-b" data-a="down" ${s && s.i < L.length - 1 ? '' : 'disabled'} title="${s ? `Move ${esc(quote(s.j))} to the start of the line below` : 'Tap a word first'}">Line below ›</button></div>`;
      const hint = s ? `Selected: ${esc(quote(s.j, s.j + 1))}` : 'Tap a word to move it to another line.';
      box.innerHTML = `<div class="ce">
        <div class="ce-bar">${ops}<div class="ce-tools"><span class="ce-hint">${hint}</span>
          <button type="button" class="ce-b" data-a="undo" ${undo.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">↶</button>
          <button type="button" class="ce-b" data-a="redo" ${redo.length ? '' : 'disabled'} title="Redo (Ctrl+Y)">↷</button>
          ${opt.onReset ? `<button type="button" class="ce-b" data-a="reset" ${opt.edited && opt.edited() ? '' : 'disabled'} title="Back to the captions as they were">↺ Original</button>` : ''}
        </div></div>
        <ol class="ce-lines">${L.map((l, i) => `<li class="ce-line${i === star ? ' star' : ''}" data-i="${i}">
          <button type="button" class="ce-t" data-a="play" title="Play from here">${tenth(l.s)}</button>
          <div class="ce-x">${i === typing ? `<textarea class="ce-in" rows="1" aria-label="The line's words">${esc(textOf(l))}</textarea>` : wordsHtml(l, i)}</div>
          <span class="ce-acts">
            <button type="button" class="ce-a" data-a="joinup" ${i > 0 ? '' : 'disabled'} title="Join with the line above">⤒</button>
            <button type="button" class="ce-a" data-a="joindown" ${i < L.length - 1 ? '' : 'disabled'} title="Join with the line below">⤓</button>
            <button type="button" class="ce-a" data-a="type" title="Type this line">✎</button>
            <button type="button" class="ce-a${i === star ? ' on' : ''}" data-a="star" title="${i === star ? 'The clip’s own line' : 'Make this the clip’s own line'}">${i === star ? '★' : '☆'}</button>
          </span></li>`).join('')}</ol></div>`;
      const ta = box.querySelector('.ce-in');
      if (ta) { const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; fit(); ta.addEventListener('input', fit); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
    // Hovering a move button shows which words would go.
    function preview(a) {
      box.querySelectorAll('.w.take').forEach(x => x.classList.remove('take'));
      if (!a || !sel) return;
      const li = box.querySelector(`.ce-line[data-i="${sel.i}"]`); if (!li) return;
      li.querySelectorAll('.w').forEach(x => { const j = +x.dataset.j; if (a === 'up' ? j <= sel.j : j >= sel.j) x.classList.add('take'); });
    }

    // ---- taps and keys ----
    function commitTyping(keep) {
      if (typing < 0) return;
      const ta = box.querySelector('.ce-in'), i = typing; typing = -1;
      if (keep && ta && ta.value.trim() !== textOf(L[i])) change(() => type(i, ta.value)); else draw();
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('button'), li = e.target.closest('.ce-line'), i = li ? +li.dataset.i : -1;
      if (e.target.closest('.ce-in')) return;
      // A tap outside the line being typed only finishes it (the lines may have changed under the tap).
      if (typing >= 0) { commitTyping(true); return; }
      if (b) {
        const a = b.dataset.a;
        if (a === 'up' && sel) return change(() => up(sel.i, sel.j));
        if (a === 'down' && sel) return change(() => down(sel.i, sel.j));
        if (a === 'split' && sel) return change(() => split(sel.i, sel.j));
        if (a === 'undo') { if (undo.length) { redo.push(snap()); load(undo.pop()); sel = null; emit(); draw(); } return; }
        if (a === 'redo') { if (redo.length) { undo.push(snap()); load(redo.pop()); sel = null; emit(); draw(); } return; }
        if (a === 'reset') { if (opt.onReset) opt.onReset(); return; }
        if (i < 0) return;
        if (a === 'play') return opt.onPlay && opt.onPlay(L[i].s, i === star);
        if (a === 'joinup') return change(() => up(i, L[i].words.length - 1));
        if (a === 'joindown') return change(() => down(i, 0));
        if (a === 'star') return change(() => { star = i; });
        if (a === 'type') { sel = null; typing = typing === i ? -1 : i; draw(); return; }
        return;
      }
      const w = e.target.closest('.w');
      if (w && li) { const j = +w.dataset.j; sel = sel && sel.i === i && sel.j === j ? null : {i, j}; draw(); return; }
      if (sel) { sel = null; draw(); }
    });
    // After a tap the editor keeps the keyboard (Ctrl+Z / Ctrl+Y, Esc), unless a line is being typed.
    box.addEventListener('click', () => { if (typing < 0 && !box.contains(document.activeElement)) box.focus({preventScroll: true}); });
    box.addEventListener('dblclick', e => {
      const li = e.target.closest('.ce-line'); if (!li || e.target.closest('button, .ce-in')) return;
      sel = null; typing = +li.dataset.i; draw();
    });
    box.addEventListener('mouseover', e => { const b = e.target.closest('button[data-a="up"], button[data-a="down"], button[data-a="split"]'); preview(b ? (b.dataset.a === 'up' ? 'up' : 'down') : null); });
    box.addEventListener('mouseleave', () => preview(null));
    box.addEventListener('keydown', e => {
      const ta = e.target.closest('.ce-in');
      if (ta) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTyping(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commitTyping(false); }
        e.stopPropagation(); return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); box.querySelector('[data-a="undo"]')?.click(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); box.querySelector('[data-a="redo"]')?.click(); }
      else if (e.key === 'Escape' && sel) { sel = null; draw(); }
    });
    box.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('.ce-in') && !box.contains(e.relatedTarget)) commitTyping(true); });
    box.tabIndex = -1; box.style.outline = 'none';

    return {
      set(screens, clip, words) {
        typing = -1; sel = null; undo = []; redo = [];
        L = (screens || []).map(toLine); star = Math.min(Math.max(0, clip | 0), Math.max(0, L.length - 1));
        hl = (words || []).map(re => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
        draw();
      },
      get: () => (L.length ? result() : null),
      draw,
    };
  }
  window.CapsEdit = {create, tenth};
})();
