'use strict';
/* CareCircle motion layer — vanilla JS, no dependencies.
   Provides: cinematic intro, Blur/Split text, Count Up, Spotlight cards, Scroll Reveal,
   Magnetic buttons, nav indicators and modal/toast transitions.
   Every observer/listener is tracked and released on the next scan (see `cleanups`). */
(function () {
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => mq.matches;
  const finePointer = () => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;
  let cleanups = [], lastKey = null, introActive = false;
  const pending = [];                      // work waiting for the intro to finish
  const whenReady = fn => (introActive ? pending.push(fn) : fn());
  const release = () => { cleanups.forEach(fn => { try { fn(); } catch (e) { /* noop */ } }); cleanups = []; };

  /* ── Blur Text / Split Text: words (or chars) rise out of a blur, staggered ── */
  function splitText(el, by) {
    if (el.dataset.split) return;
    el.dataset.split = '1';
    const text = el.textContent, label = text.trim();
    el.setAttribute('aria-label', label);
    el.textContent = '';
    let i = 0;
    const mk = (t, cls) => { const s = document.createElement('span'); s.className = cls; s.setAttribute('aria-hidden', 'true'); s.style.setProperty('--i', i++); s.textContent = t; return s; };
    label.split(/\s+/).forEach((w, wi, arr) => {
      const word = document.createElement('span'); word.className = 'sw'; word.setAttribute('aria-hidden', 'true');
      if (by === 'chars') [...w].forEach(c => word.appendChild(mk(c, 'sc')));
      else word.appendChild(mk(w, 'sc'));
      el.appendChild(word); if (wi < arr.length - 1) el.appendChild(document.createTextNode(' '));
    });
  }
  function textEffects(scope, instant) {
    scope.querySelectorAll('[data-blur-text], [data-split-text]').forEach(el => {
      if (reduced()) return;
      splitText(el, el.hasAttribute('data-split-text') ? 'chars' : 'words');
      if (instant) { el.classList.add('text-in'); el.style.setProperty('--text-delay', '0ms'); return; }
      whenReady(() => requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('text-in'))));
    });
  }

  /* ── Count Up: eased, runs once per element when it scrolls into view ── */
  function countUp(el) {
    const target = parseFloat(el.dataset.count); if (!isFinite(target) || el.dataset.counted) return;
    el.dataset.counted = '1';
    const suffix = el.dataset.suffix || '', dur = 900, t0 = performance.now(), dec = (String(target).split('.')[1] || '').length;
    const tick = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 4);
      el.textContent = (target * e).toFixed(dec) + suffix;
      if (t < 1) requestAnimationFrame(tick); else el.textContent = target.toFixed(dec) + suffix;
    };
    requestAnimationFrame(tick);
  }

  /* ── Scroll Reveal + Count Up trigger via one IntersectionObserver ── */
  function observe(scope, animate) {
    const nodes = scope.querySelectorAll('.wrap .card, .wrap .dose, .wrap .banner, .wrap .hello, .wrap > h1, .wrap > h2, .wrap > section, .auth-card, .auth-feature');
    const counters = scope.querySelectorAll('[data-count]');
    if (!animate || reduced() || !('IntersectionObserver' in window)) {
      nodes.forEach(n => n.classList.add('is-visible'));
      counters.forEach(c => { c.textContent = (+c.dataset.count) + (c.dataset.suffix || ''); c.dataset.counted = '1'; });
      return;
    }
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      whenReady(() => { en.target.classList.add('is-visible'); if (en.target.hasAttribute('data-count')) countUp(en.target); });
      io.unobserve(en.target);
    }), { threshold: .12, rootMargin: '0px 0px -30px 0px' });
    let n = 0;
    nodes.forEach(node => { node.classList.add('reveal-item'); node.style.setProperty('--reveal-delay', Math.min(n++ % 6, 5) * 60 + 'ms'); io.observe(node); });
    counters.forEach(c => { c.textContent = '0' + (c.dataset.suffix || ''); io.observe(c); });
    cleanups.push(() => io.disconnect());
  }

  /* ── Spotlight Cards + Magnetic Buttons: delegated, one listener each, attached once ── */
  let delegated = false;
  function delegates() {
    if (delegated) return; delegated = true;
    let raf = 0;
    document.addEventListener('pointermove', ev => {
      if (reduced() || ev.pointerType === 'touch') return;
      const t = ev.target.closest ? ev.target : null; if (!t) return;
      const card = t.closest('.card, .dose, .auth-feature');
      const mag = t.closest('.magnetic');
      if (!card && !mag) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', (ev.clientX - r.left) + 'px'); card.style.setProperty('--my', (ev.clientY - r.top) + 'px'); }
        if (mag) { const r = mag.getBoundingClientRect(); mag.style.setProperty('--tx', ((ev.clientX - (r.left + r.width / 2)) * .22).toFixed(1) + 'px'); mag.style.setProperty('--ty', ((ev.clientY - (r.top + r.height / 2)) * .3).toFixed(1) + 'px'); }
      });
    }, { passive: true });
    document.addEventListener('pointerout', ev => {
      const mag = ev.target.closest && ev.target.closest('.magnetic');
      if (mag && !(ev.relatedTarget && mag.contains(ev.relatedTarget))) { mag.style.removeProperty('--tx'); mag.style.removeProperty('--ty'); }
    });
    /* button press ripple origin */
    document.addEventListener('pointerdown', ev => {
      const b = ev.target.closest && ev.target.closest('button.primary'); if (!b || reduced()) return;
      const r = b.getBoundingClientRect(); b.style.setProperty('--rx0', (ev.clientX - r.left) + 'px'); b.style.setProperty('--ry0', (ev.clientY - r.top) + 'px');
      b.classList.remove('rip'); void b.offsetWidth; b.classList.add('rip');
    });
    /* dialog: animate out before closing; backdrop click closes */
    const dlg = document.getElementById('dlg');
    if (dlg) {
      dlg.addEventListener('click', ev => { if (ev.target === dlg && dlg.open) dlg.close(); });
      dlg.addEventListener('cancel', ev => {
        if (reduced()) return; ev.preventDefault(); dlg.classList.add('closing');
        setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 170);
      });
    }
  }

  /* ── Animated nav indicators (sidebar pill + mobile tab-bar line) ──
     Positions are written synchronously on creation (no flash from 0); when the page key changed,
     the pill starts at the previous tab's box and glides to the new one. */
  const lastBox = {};
  function navIndicators(animate) {
    document.querySelectorAll('.side nav, .tabs').forEach(nav => {
      const cur = nav.querySelector('[aria-current="page"]'); if (!cur) return;
      const kind = nav.classList.contains('tabs') ? 'tabs' : 'side';
      const ind = document.createElement('span'); ind.className = 'nav-ind no-tr'; ind.setAttribute('aria-hidden', 'true'); nav.prepend(ind);
      const put = b => { ind.style.setProperty('--ind-x', b.x + 'px'); ind.style.setProperty('--ind-y', b.y + 'px'); ind.style.setProperty('--ind-w', b.w + 'px'); ind.style.setProperty('--ind-h', b.h + 'px'); };
      const box = () => ({ x: cur.offsetLeft, y: cur.offsetTop, w: cur.offsetWidth, h: cur.offsetHeight });
      const now = box(), prev = lastBox[kind];
      put(animate && prev && !reduced() ? prev : now); void ind.offsetWidth; ind.classList.remove('no-tr');
      if (animate && prev && !reduced()) requestAnimationFrame(() => requestAnimationFrame(() => put(box())));
      lastBox[kind] = now;
      if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => { ind.classList.add('no-tr'); put(box()); lastBox[kind] = box(); }); ro.observe(nav); cleanups.push(() => ro.disconnect()); }
    });
  }

  /* ── Hero parallax (login screen only): slow drift of decorative layers on scroll/pointer ── */
  function parallax() {
    const side = document.querySelector('.auth-side'); if (!side || reduced() || !finePointer()) return;
    const onMove = ev => { const r = side.getBoundingClientRect(); side.style.setProperty('--px', (((ev.clientX - r.left) / r.width) - .5).toFixed(3)); side.style.setProperty('--py', (((ev.clientY - r.top) / r.height) - .5).toFixed(3)); };
    side.addEventListener('pointermove', onMove, { passive: true });
    cleanups.push(() => side.removeEventListener('pointermove', onMove));
  }

  /* ── Public: called after every render() ──
     key identifies the "page"; only a changed key animates, so 30-second data polls never flicker. */
  function scan(key) {
    release();
    const animate = key !== lastKey; lastKey = key;
    const main = document.getElementById('main');
    if (main && animate && !reduced()) { main.classList.remove('view-enter'); void main.offsetWidth; main.classList.add('view-enter'); }
    document.body.dataset.fresh = animate ? '1' : '0';
    delegates();
    textEffects(document, !animate);
    observe(document, animate);
    navIndicators(animate);
    parallax();
  }

  /* ── Cinematic opening ──
     A health report (two halves) is shown on warm paper, then the halves swing open on a real
     3D hinge, revealing the live page, which animates in underneath. ~3.1s total. */
  const LOGO = c => `<svg class="logo" viewBox="0 0 28 28" aria-hidden="true" style="color:${c}"><rect width="28" height="28" rx="8" fill="currentColor" opacity=".14"/><path d="M14 21.5s-6.6-4.1-6.6-8.5a3.4 3.4 0 0 1 6.6-1.1 3.4 3.4 0 0 1 6.6 1.1c0 4.4-6.6 8.5-6.6 8.5z" fill="currentColor"/></svg>`;
  const pulse = '<svg class="r-pulse" viewBox="0 0 200 40" aria-hidden="true"><path pathLength="1" d="M0 22h46l8-16 14 32 10-24 8 8h114" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function intro() {
    if (document.getElementById('care-intro')) return;
    let seen = false; try { seen = sessionStorage.getItem('cc_intro_seen') === '1'; } catch (e) { /* blocked */ }
    if (seen || reduced()) { root.classList.add('intro-done'); return; }
    introActive = true; root.classList.add('intro-running');
    const g = '#477b65', el = document.createElement('div');
    el.id = 'care-intro'; el.className = 'care-intro'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Welcome to CareCircle');
    const bars = [34, 52, 44, 74, 40, 62, 48].map((h, i) => `<i style="--h:${h}%;--d:${i * 70}ms"></i>`).join('');
    const left = `
      <div class="r-brand">${LOGO(g)}<span>CareCircle</span></div>
      <div class="r-title"><small>HEALTH REPORT</small><b>Care Circle<br>Overview</b></div>
      <div class="r-meta"><span><i>Reference</i>CC-2026-0142</span><span><i>Prepared for</i>The whole family</span></div>
      ${pulse}
      <div class="r-lines"><i></i><i></i><i></i></div>
      <div class="r-foot"><span>Confidential</span><span>01</span></div>`;
    const right = `
      <div class="r-stat"><i>Adherence this week</i><b>96<em>%</em></b></div>
      <div class="r-chart">${bars}</div>
      <div class="r-rows"><span><u></u>Medicines on schedule</span><span><u></u>Appointments shared</span><span><u></u>Family kept informed</span></div>
      <div class="r-seal">${LOGO(g)}</div>
      <div class="r-foot"><span>Shared with care</span><span>02</span></div>`;
    el.innerHTML = `
      <div class="i-bg"></div>
      <div class="i-stage" aria-hidden="true">
        <div class="i-halo"></div>
        <div class="i-book">
          <div class="i-half i-left"><div class="i-face">${left}</div><div class="i-back"></div></div>
          <div class="i-half i-right"><div class="i-face">${right}</div><div class="i-back"></div></div>
          <div class="i-shadow"></div>
        </div>
      </div>
      <div class="i-bar"><i></i></div>
      <button class="intro-skip" type="button">Skip intro</button>`;
    document.body.appendChild(el);
    const skip = el.querySelector('.intro-skip'); skip.focus({ preventScroll: true });
    let done = false, t1, t2;
    const finish = fast => {
      if (done) return; done = true; clearTimeout(t1); clearTimeout(t2);
      try { sessionStorage.setItem('cc_intro_seen', '1'); } catch (e) { /* blocked */ }
      document.removeEventListener('keydown', onKey);
      el.classList.add(fast ? 'is-skipping' : 'is-leaving');
      introActive = false; root.classList.remove('intro-running'); root.classList.add('intro-done');
      while (pending.length) pending.shift()();
      setTimeout(() => el.remove(), 600);
    };
    const onKey = ev => { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); finish(true); } };
    document.addEventListener('keydown', onKey);
    skip.addEventListener('click', () => finish(true));
    t1 = setTimeout(() => el.classList.add('is-opening'), 1050);   // halves swing open
    t2 = setTimeout(() => finish(false), 2750);                     // page content begins revealing here
  }

  window.CCMotion = { scan, intro, reduced };
})();
