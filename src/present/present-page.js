/*
 * present-page.js — the exported Present page's own script (after the web
 * player, which it uses). Plain ES2020, no imports.
 *
 *   window.PP_SOURCES  source id → the player's bundle
 *   window.PP_LAYOUT   'slides' | 'scroll'
 *
 * Canvases (.pp-canvas[data-source]) run while they're on the current slide
 * or on screen, at most CAP at once; the others show their last frame.
 * Interactive blocks (.pp-inter) wire their sliders to the canvas's controls
 * and their chips to the sliders. Slides: ← / →, Space, Home, End, the
 * progress bar. Scroll: ← / → jump between steps.
 */
(function () {
  'use strict';
  var P = window.ShaderStudioPlay;
  var SOURCES = window.PP_SOURCES || {};
  var LAYOUT = window.PP_LAYOUT === 'scroll' ? 'scroll' : 'slides';
  var CAP = window.matchMedia && window.matchMedia('(max-width: 767px)').matches ? 3 : 6;
  var steps = Array.prototype.slice.call(document.querySelectorAll('.pp-step'));
  var current = 0;

  // ── Canvases ──────────────────────────────────────────────────────────────
  var canvases = Array.prototype.slice.call(document.querySelectorAll('.pp-canvas[data-source]'));
  var state = new Map(); // el → { want, mount, still, inter }
  function wanted(el) {
    var s = state.get(el);
    if (!s.onScreen) return false;
    if (LAYOUT === 'slides') return el.closest('.pp-step') === steps[current];
    return true;
  }
  function start(el) {
    var s = state.get(el);
    if (s.mount || !P) return;
    var host = el.querySelector('.pp-host');
    host.style.backgroundImage = '';
    s.mount = P.mount(host, SOURCES[el.getAttribute('data-source')], {
      mode: 'player', panel: false, fit: 'cover', pauseOffscreen: true,
      pointer: el.getAttribute('data-pointer') === '1', markers: el.getAttribute('data-pointer') === '1',
      startTime: parseFloat(el.getAttribute('data-start') || '0') || 0, paused: el.getAttribute('data-paused') === '1',
    });
    if (s.inter) s.inter.attach(s.mount);
  }
  function stop(el) {
    var s = state.get(el);
    if (!s.mount) return;
    var png = s.mount.still ? s.mount.still() : null;
    if (s.inter) s.inter.attach(null);
    s.mount.destroy();
    s.mount = null;
    var host = el.querySelector('.pp-host');
    host.innerHTML = '';
    host.className = 'pp-host';
    if (png) host.style.backgroundImage = 'url(' + png + ')';
  }
  function schedule() {
    var running = 0;
    canvases.forEach(function (el) {
      var s = state.get(el);
      var go = el.getAttribute('data-still') !== '1' && wanted(el) && running < CAP;
      if (go) { running++; start(el); } else stop(el);
      el.classList.toggle('pp-waiting', !go && wanted(el) && el.getAttribute('data-still') !== '1');
    });
  }
  var io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { state.get(e.target).onScreen = e.isIntersecting; });
    schedule();
  }, { rootMargin: '160px 0px' }) : null;
  canvases.forEach(function (el) {
    state.set(el, { onScreen: !io, mount: null, inter: null });
    if (io) io.observe(el);
  });

  // ── Interactive blocks ────────────────────────────────────────────────────
  function fmt(v, step) { var d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3; return Number(v).toFixed(d); }
  function hex(c) { return '#' + c.map(function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); }).join(''); }
  function rgb(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }
  Array.prototype.forEach.call(document.querySelectorAll('.pp-inter'), function (block) {
    var canvas = block.querySelector('.pp-canvas');
    var mount = null;
    var set = {};
    var rows = {};
    Array.prototype.forEach.call(block.querySelectorAll('.pp-control'), function (row) {
      var id = row.getAttribute('data-control');
      var input = row.querySelector('input');
      var out = row.querySelector('.pp-value');
      var btn = row.querySelector('button.pp-act');
      rows[id] = row;
      if (btn) btn.onclick = function () { if (mount && mount.fire) mount.fire(id); };
      if (!input) return;
      input.oninput = function () {
        var v = input.type === 'color' ? rgb(input.value) : parseFloat(input.value);
        set[id] = v;
        if (out && typeof v === 'number') out.textContent = fmt(v, parseFloat(input.step));
        if (mount && mount.set) mount.set(id, v);
      };
    });
    function light(id, on) { if (rows[id]) rows[id].classList.toggle('pp-hot', on); Array.prototype.forEach.call(block.querySelectorAll('.pp-chip[data-control="' + id + '"]'), function (c) { c.classList.toggle('pp-on', on); }); }
    Array.prototype.forEach.call(block.querySelectorAll('.pp-chip[data-control]'), function (chip) {
      var id = chip.getAttribute('data-control');
      chip.onmouseenter = function () { light(id, true); };
      chip.onmouseleave = function () { light(id, false); };
      chip.onclick = function () {
        var row = rows[id]; if (!row) return;
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        light(id, true); setTimeout(function () { light(id, false); }, 1100);
        var input = row.querySelector('input[type=range]');
        if (!input || input.disabled) return;
        var v0 = parseFloat(input.value), lo = parseFloat(input.min), hi = parseFloat(input.max), amp = (hi - lo) * 0.18, dir = v0 + amp > hi ? -1 : 1, t0 = performance.now();
        (function tick(now) {
          var u = Math.min(1, (now - t0) / 900), v = u >= 1 ? v0 : v0 + dir * amp * Math.sin(u * Math.PI);
          input.value = v; input.oninput();
          if (u < 1) requestAnimationFrame(tick);
        })(t0);
      };
    });
    var poll = null;
    var inter = {
      attach: function (m) {
        mount = m;
        if (poll) { clearInterval(poll); poll = null; }
        if (!m) return;
        for (var id in set) if (m.set) m.set(id, set[id]);
        poll = setInterval(function () {
          for (var id in rows) {
            var g = m.get ? m.get(id) : null, row = rows[id], input = row.querySelector('input');
            var driven = !!(g && g.driven);
            row.classList.toggle('pp-driven', driven);
            if (!input || !driven) { if (input && input.type === 'range') input.disabled = false; continue; }
            if (input.type === 'range') { input.disabled = true; input.value = g.value; var out = row.querySelector('.pp-value'); if (out) out.textContent = fmt(g.value, parseFloat(input.step)); }
          }
        }, 90);
      },
    };
    if (canvas) state.get(canvas).inter = inter;
  });
  var midiBtn = document.querySelectorAll('.pp-enable-midi');
  Array.prototype.forEach.call(midiBtn, function (b) { b.onclick = function () { P.enableMidi().then(function (ok) { b.textContent = ok ? 'MIDI on' : 'MIDI refused'; b.disabled = ok; }); }; });
  Array.prototype.forEach.call(document.querySelectorAll('.pp-listen'), function (b) { b.onclick = function () { P.listen().then(function (s) { b.textContent = s === 'on' ? 'Listening' : s === 'denied' ? 'Audio blocked' : 'No audio input'; b.disabled = s === 'on'; }); }; });

  // ── Navigation ────────────────────────────────────────────────────────────
  var bar = document.querySelectorAll('.pp-progress button');
  var count = document.querySelector('.pp-count');
  function show(i) {
    current = Math.max(0, Math.min(steps.length - 1, i));
    if (LAYOUT === 'slides') {
      steps.forEach(function (s, k) { s.hidden = k !== current; });
      document.querySelector('.pp-stage').scrollTop = 0;
      try { history.replaceState(null, '', '#' + (current + 1)); } catch (e) { /* a page in a frame without its own address */ }
    } else {
      steps[current].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    Array.prototype.forEach.call(bar, function (b, k) { b.className = k < current ? 'pp-done' : k === current ? 'pp-now' : ''; });
    if (count) count.textContent = (current + 1) + ' / ' + steps.length;
    var prev = document.querySelector('.pp-prev'), next = document.querySelector('.pp-next');
    if (prev) prev.disabled = current <= 0;
    if (next) next.disabled = current >= steps.length - 1;
    schedule();
  }
  Array.prototype.forEach.call(bar, function (b, k) { b.onclick = function () { show(k); }; });
  var prevBtn = document.querySelector('.pp-prev'), nextBtn = document.querySelector('.pp-next');
  if (prevBtn) prevBtn.onclick = function () { show(current - 1); };
  if (nextBtn) nextBtn.onclick = function () { show(current + 1); };
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey && LAYOUT === 'slides')) { e.preventDefault(); show(current + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey && LAYOUT === 'slides')) { e.preventDefault(); show(current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(steps.length - 1); }
  });
  if (LAYOUT === 'scroll') {
    var fill = document.querySelector('.pp-scrollbar i');
    window.addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - innerHeight;
      if (fill) fill.style.width = (h > 0 ? scrollY / h * 100 : 100) + '%';
      var c = 0;
      steps.forEach(function (s, k) { if (s.getBoundingClientRect().top < innerHeight * 0.35) c = k; });
      if (c !== current) { current = c; if (count) count.textContent = (current + 1) + ' / ' + steps.length; }
    }, { passive: true });
  }
  var start0 = LAYOUT === 'slides' ? (parseInt(location.hash.slice(1), 10) || 1) - 1 : 0;
  if (LAYOUT === 'slides') show(start0); else schedule();
})();
