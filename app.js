(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const bar = document.querySelector('.progress span');
  const counter = document.getElementById('counter');
  const index = document.getElementById('index');
  const indexList = index.querySelector('ol');
  let current = 0;

  /* ---------- storage (optional; the page works without it) ---------- */

  const store = {
    get(k) { try { return localStorage.getItem('pvmv:' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('pvmv:' + k, v); } catch (e) {} },
  };

  /* ---------- navigation ---------- */

  function go(n) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, i) => {
      const on = i === n;
      s.classList.toggle('active', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
      s.inert = !on;
    });
    current = n;
    slides[n].scrollTop = 0;
    bar.style.width = ((n + 1) / slides.length) * 100 + '%';
    counter.textContent = `${n + 1} / ${slides.length}`;
    try { history.replaceState(null, '', '#' + (n + 1)); } catch (e) {}
    document.title = (slides[n].dataset.title || 'Slide ' + (n + 1)) + ' · Passive + Modals';
  }

  const next = () => go(current + 1);
  const prev = () => go(current - 1);

  function fromHash() {
    const n = parseInt(location.hash.slice(1), 10);
    return Number.isFinite(n) ? n - 1 : 0;
  }

  document.getElementById('next').addEventListener('click', next);
  document.getElementById('prev').addEventListener('click', prev);
  window.addEventListener('hashchange', () => go(fromHash()));

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.matches('input, textarea')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (!index.hidden) {
      if (e.key === 'Escape') closeIndex();
      return;
    }

    const onControl = t.matches('button, summary, a');
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault(); next(); break;
      case ' ':
        if (onControl) return;
        e.preventDefault(); e.shiftKey ? prev() : next(); break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault(); prev(); break;
      case 'Home':
        e.preventDefault(); go(0); break;
      case 'End':
        e.preventDefault(); go(slides.length - 1); break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
        break;
    }
  });

  // swipe
  let x0 = null, y0 = null;
  document.getElementById('deck').addEventListener('touchstart', (e) => {
    if (e.target.closest('input, textarea') || e.touches.length > 1) { x0 = null; return; }
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });

  document.getElementById('deck').addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
  }, { passive: true });

  /* ---------- slide index ---------- */

  slides.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.dataset.title || 'Slide ' + (i + 1);
    b.addEventListener('click', () => { closeIndex(); go(i); });
    li.appendChild(b);
    indexList.appendChild(li);
  });

  function openIndex() {
    [...indexList.querySelectorAll('button')].forEach((b, i) =>
      b.setAttribute('aria-current', i === current ? 'true' : 'false'));
    index.hidden = false;
    indexList.querySelectorAll('button')[current].focus();
  }

  function closeIndex() {
    index.hidden = true;
    counter.focus();
  }

  counter.addEventListener('click', () => (index.hidden ? openIndex() : closeIndex()));
  index.addEventListener('click', (e) => { if (e.target === index) closeIndex(); });

  /* ---------- theme ---------- */

  document.getElementById('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
  });

  /* ---------- typed exercises ---------- */

  const norm = (s) => s
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\bcan not\b/g, 'cannot')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/\b(\w+)n't\b/g, '$1 not')
    .replace(/[.,!?;:"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const answersOf = (input) => input.dataset.answer.split('|');
  const isRight = (input) => answersOf(input).some((a) => norm(a) === norm(input.value));

  function mark(input) {
    const filled = input.value.trim() !== '';
    const ok = filled && isRight(input);
    input.classList.toggle('is-ok', ok);
    input.classList.toggle('is-bad', filled && !ok);
    return ok;
  }

  document.querySelectorAll('[data-ex]').forEach((ex) => {
    const slide = ex.closest('.slide');
    const inputs = [...ex.querySelectorAll('input')];
    const checkBtn = slide.querySelector('[data-check]');
    const revealBtn = slide.querySelector('[data-reveal]');
    const actions = slide.querySelector('.actions');
    const score = document.createElement('span');
    score.className = 'score';
    score.setAttribute('aria-live', 'polite');
    actions.appendChild(score);

    inputs.forEach((input, i) => {
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'off');
      if (!ex.classList.contains('rewrite')) {
        input.style.width = Math.max(7, answersOf(input)[0].length + 1) + 'ch';
      }

      const ans = document.createElement('span');
      ans.className = 'answer';
      ans.textContent = answersOf(input)[0];
      input.closest('li').appendChild(ans);

      input.addEventListener('input', () => {
        input.classList.remove('is-ok', 'is-bad');
        score.textContent = '';
      });

      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        mark(input);
        const nextInput = inputs[i + 1];
        if (nextInput) nextInput.focus();
        else checkAll();
      });
    });

    function checkAll() {
      const right = inputs.filter(mark).length;
      score.textContent = `${right} / ${inputs.length}`;
    }

    checkBtn.addEventListener('click', checkAll);

    revealBtn.addEventListener('click', () => {
      const on = slide.classList.toggle('revealed');
      revealBtn.textContent = on ? 'Hide answers' : 'Show answers';
    });
  });

  /* ---------- multiple choice ---------- */

  document.querySelectorAll('.mc').forEach((mc) => {
    const gap = mc.querySelector('.gap');
    const buttons = [...mc.querySelectorAll('.opts button')];
    buttons.forEach((b) => b.addEventListener('click', () => {
      if (b.hasAttribute('data-ok')) {
        b.classList.add('right');
        gap.textContent = b.textContent;
        mc.classList.add('done');
        buttons.forEach((x) => { x.disabled = true; });
      } else {
        b.classList.add('wrong');
        b.disabled = true;
      }
    }));
  });

  /* ---------- notes & sentence starters ---------- */

  function grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  document.querySelectorAll('textarea.notes').forEach((ta) => {
    const key = 'note:' + ta.dataset.key;
    const saved = store.get(key);
    if (saved) ta.value = saved;
    ta.addEventListener('input', () => { store.set(key, ta.value); grow(ta); });
    requestAnimationFrame(() => grow(ta));
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const ta = chip.closest('.slide').querySelector('textarea.notes');
      if (!ta) return;
      const text = chip.textContent.trim();
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? start;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const pad = before && !/\s$/.test(before) ? ' ' : '';
      ta.value = before + pad + text + ' ' + after;
      const caret = (before + pad + text + ' ').length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event('input'));
    });
  });

  /* ---------- start ---------- */

  go(fromHash());
  window.addEventListener('resize', () => document.querySelectorAll('textarea.notes').forEach(grow));
})();
