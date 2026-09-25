/*
 * play-runtime.js — the standalone player inlined into a Shader Studio HTML
 * export. Plain ES2020, no imports, no framework: it runs the compiled
 * fragment shader on a WebGL quad, draws the Play controls, runs the mapping
 * engine (mouse, keys, another control, nulls, LFO, clock, tilt, gamepad, MIDI)
 * and paints the layers (nulls, text, images, particles) over the picture.
 *
 * Expects `window.PLAY_BUNDLE = { title, fragmentShader, uniforms, play, aspect }`
 * and an element with id "play". Audio-band sources are not available here
 * (they need the studio's audio nodes); such mappings stay idle.
 */
(function () {
  'use strict';
  const B = window.PLAY_BUNDLE;
  if (!B) return;
  const root = document.getElementById('play') || document.body;
  const play = B.play || { controls: [], mappings: [], layers: [] };
  const params = new URLSearchParams(location.search);
  const showPanel = params.get('panel') !== '0' && root.dataset.panel !== 'off';

  // ── DOM ─────────────────────────────────────────────────────────────────
  root.classList.add('ssp');
  root.innerHTML = '';
  const stage = el('div', 'ssp-stage');
  const glCanvas = el('canvas', 'ssp-gl');
  const ovCanvas = el('canvas', 'ssp-overlay');
  const fitBox = el('div', 'ssp-fit');
  fitBox.append(glCanvas, ovCanvas);
  stage.append(fitBox);
  const panel = el('div', 'ssp-panel');
  root.append(stage);
  if (showPanel) root.append(panel);

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ── WebGL ───────────────────────────────────────────────────────────────
  const gl = glCanvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) { stage.append(el('div', 'ssp-error', 'WebGL is not available in this browser.')); return; }
  const VS = 'attribute vec2 position; varying vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }';
  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { throw new Error(gl.getShaderInfoLog(s) || 'shader failed'); }
    return s;
  }
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, B.fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link failed');
  } catch (e) {
    stage.append(el('div', 'ssp-error', 'The shader did not compile here: ' + e.message));
    return;
  }
  gl.useProgram(program);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  // A white 1×1 texture keeps any sampler (font texture) defined.
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  const locs = new Map();
  const loc = name => { if (!locs.has(name)) locs.set(name, gl.getUniformLocation(program, name)); return locs.get(name); };
  const uniformValues = Object.assign({}, B.uniforms || {});
  function setUniform(name, v) {
    const l = loc(name); if (!l) return;
    if (typeof v === 'number') gl.uniform1f(l, v);
    else if (Array.isArray(v)) { if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else if (v.length === 4) gl.uniform4fv(l, v); }
  }
  const fontLoc = loc('u_fontTexture');
  if (fontLoc) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, white); gl.uniform1i(fontLoc, 0); }

  // ── Aspect / size ───────────────────────────────────────────────────────
  const ratio = B.aspect && B.aspect.ratio ? B.aspect.ratio : null;
  function layout() {
    const r = stage.getBoundingClientRect();
    let w = r.width, h = r.height;
    if (ratio) { if (w / h > ratio) w = h * ratio; else h = w / ratio; }
    fitBox.style.width = w + 'px'; fitBox.style.height = h + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; ovCanvas.width = W; ovCanvas.height = H; }
  }
  new ResizeObserver(layout).observe(stage);
  layout();

  // ── Mapping engine ──────────────────────────────────────────────────────
  const controls = new Map(play.controls.map(c => [c.id, c]));
  const layersById = new Map(play.layers.map(l => [l.id, l]));
  const base = new Map();            // control id → value (slider position)
  const live = new Map();            // control id → driven value
  const layerLive = new Map();       // `${layerId}::${key}` → value
  const smooth = new Map();          // mapping id → smoothed value
  const mouse = { x: 0.5, y: 0.5, down: 0 };
  const keys = new Set();
  const tilt = { got: false, alpha: 0, beta: 0, gamma: 0 };
  const midi = { ch: Array.from({ length: 17 }, () => ({ note: 60, vel: 0, held: new Set(), bend: 0, cc: new Float32Array(128), seenNote: false, seenBend: false, seenCc: new Uint8Array(128) })) };
  let time = 0, playing = true, lastNow = 0;

  function layerTarget(t) { if (!t.startsWith('layer:')) return null; const r = t.slice(6); const i = r.lastIndexOf('::'); return i > 0 ? { layerId: r.slice(0, i), key: r.slice(i + 2) } : null; }
  function bindingKey(t) { const p = t.split('::'); return p.slice(-2).join('::'); }
  const bindings = B.paramBindings || {};
  function uniformFor(control) { return bindings[bindingKey(control.target)]; }
  for (const c of play.controls) {
    const lt = layerTarget(c.target);
    if (lt) { const l = layersById.get(lt.layerId); if (l && typeof l[lt.key] === 'number') base.set(c.id, l[lt.key]); }
    else { const u = uniformFor(c); if (u && uniformValues[u] !== undefined) base.set(c.id, Array.isArray(uniformValues[u]) ? uniformValues[u].slice() : uniformValues[u]); }
  }
  function layerValue(id, key, fallback) { const v = layerLive.get(id + '::' + key); return v === undefined ? fallback : v; }
  function curve(u, m) {
    const x = u < 0 ? 0 : u > 1 ? 1 : u;
    if (m.curve === 'exp') return x * x;
    if (m.curve === 'log') return Math.sqrt(x);
    if (m.curve === 'custom' && m.curveY && m.curveY.length > 1) { const pos = x * (m.curveY.length - 1); const i = Math.min(m.curveY.length - 2, Math.floor(pos)); return m.curveY[i] + (m.curveY[i + 1] - m.curveY[i]) * (pos - i); }
    return x;
  }
  function hash01(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }
  function lfo(shape, t) {
    const c = Math.floor(t), p = t - c;
    switch (shape) { case 'sine': return 0.5 - 0.5 * Math.cos(p * Math.PI * 2); case 'triangle': return 1 - Math.abs(2 * p - 1); case 'saw': return p; case 'square': return p < 0.5 ? 1 : 0; case 'random': return hash01(c); }
    return p;
  }
  function gamepad(i) { return navigator.getGamepads ? navigator.getGamepads()[i] : null; }
  function readSource(s) {
    switch (s.kind) {
      case 'mouse': return s.axis === 'x' ? mouse.x : s.axis === 'y' ? mouse.y : mouse.down;
      case 'key': return keys.has(s.code) ? 1 : 0;
      case 'lfo': return lfo(s.shape, time * s.rate + s.phase);
      case 'clock': return lfo(s.shape, time * (s.bpm / 60 / Math.max(0.0625, s.beats)));
      case 'tilt': { if (!tilt.got) return null; if (s.axis === 'alpha') return ((tilt.alpha % 360) + 360) % 360 / 360; const v = Math.max(-90, Math.min(90, s.axis === 'beta' ? tilt.beta : tilt.gamma)); return (v + 90) / 180; }
      case 'gamepad': { const p = gamepad(s.pad); if (!p) return null; if (s.control === 'axis') { const a = p.axes[s.index]; return a === undefined ? null : Math.max(0, Math.min(1, (a + 1) / 2)); } const b = p.buttons[s.index]; return b ? b.value : null; }
      case 'midi': { const ch = midi.ch[Math.max(0, Math.min(16, s.channel))]; switch (s.signal) { case 'note': return ch.seenNote ? ch.note / 127 : null; case 'velocity': return ch.seenNote ? ch.vel / 127 : null; case 'gate': return ch.seenNote ? (ch.held.size ? 1 : 0) : null; case 'bend': return ch.seenBend ? (ch.bend + 1) / 2 : null; case 'cc': { const n = (s.cc || 1) & 127; return ch.seenCc[n] ? ch.cc[n] / 127 : null; } } return null; }
      case 'null': { const l = layersById.get(s.layerId); if (!l) return null; return Math.max(0, Math.min(1, layerValue(l.id, s.axis, l[s.axis]))); }
      case 'control': { const c = controls.get(s.controlId); if (!c) return null; let v = live.has(c.id) ? live.get(c.id) : base.get(c.id); if (v === undefined) return null; if (Array.isArray(v)) return (v[0] + v[1] + v[2]) / 3; const span = c.max - c.min; return span > 0 ? Math.max(0, Math.min(1, (v - c.min) / span)) : 0; }
      default: return null;
    }
  }
  const colourBuf = new Map();
  function tickMappings(dt) {
    const driven = new Set();
    for (const m of play.mappings) {
      if (!m.enabled) continue;
      const c = controls.get(m.controlId); if (!c) continue;
      const u = readSource(m.source); if (u === null) continue;
      const target = m.outMin + (m.outMax - m.outMin) * curve(u, m);
      let v = smooth.get(m.id);
      if (m.smoothMs <= 0 || v === undefined) v = target;
      else { const a = 1 - Math.exp(-(dt * 1000) / m.smoothMs); v = v + (target - v) * a; if (Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(m.outMax - m.outMin))) v = target; }
      smooth.set(m.id, v);
      const lt = layerTarget(c.target);
      if (lt) { layerLive.set(lt.layerId + '::' + lt.key, v); live.set(c.id, v); driven.add(c.id); continue; }
      const un = uniformFor(c); if (!un) continue;
      if (c.kind === 'color') {
        let buf = colourBuf.get(c.id);
        const b = base.get(c.id) || [0, 0, 0];
        if (!buf || !driven.has(c.id)) { buf = [b[0], b[1], b[2]]; colourBuf.set(c.id, buf); }
        if (m.channel === undefined || m.channel === null) { buf[0] = b[0] * v; buf[1] = b[1] * v; buf[2] = b[2] * v; } else buf[m.channel] = v;
        uniformValues[un] = buf; live.set(c.id, buf);
      } else { uniformValues[un] = v; live.set(c.id, v); }
      driven.add(c.id);
    }
    for (const id of [...live.keys()]) if (!driven.has(id)) {
      const c = controls.get(id); const lt = c && layerTarget(c.target);
      if (lt) layerLive.delete(lt.layerId + '::' + lt.key); else if (c) { const un = uniformFor(c); if (un && base.has(id)) uniformValues[un] = base.get(id); }
      live.delete(id);
    }
  }

  // ── Inputs ──────────────────────────────────────────────────────────────
  const pointerTarget = stage;
  pointerTarget.addEventListener('pointermove', e => {
    const r = fitBox.getBoundingClientRect();
    mouse.x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    mouse.y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height)));
    if (drag) { const l = layersById.get(drag.id); if (l) { l.x = Math.max(0, Math.min(1, mouse.x + drag.dx)); l.y = Math.max(0, Math.min(1, mouse.y + drag.dy)); } }
  });
  let drag = null;
  pointerTarget.addEventListener('pointerdown', e => {
    mouse.down = 1;
    const r = fitBox.getBoundingClientRect();
    const ux = (e.clientX - r.left) / r.width, uy = 1 - (e.clientY - r.top) / r.height;
    for (const l of play.layers) {
      if (l.kind !== 'null' || !l.visible) continue;
      const d = Math.hypot((ux - layerValue(l.id, 'x', l.x)) * r.width, (uy - layerValue(l.id, 'y', l.y)) * r.height);
      if (d <= Math.max(l.size, 10) + 6) { drag = { id: l.id, dx: l.x - ux, dy: l.y - uy }; pointerTarget.setPointerCapture(e.pointerId); break; }
    }
  });
  const up = () => { mouse.down = 0; drag = null; };
  pointerTarget.addEventListener('pointerup', up); pointerTarget.addEventListener('pointercancel', up);
  window.addEventListener('keydown', e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; keys.add(e.code); if (e.code === 'Space') { playing = !playing; e.preventDefault(); } });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('deviceorientation', e => { tilt.got = true; tilt.alpha = e.alpha || 0; tilt.beta = e.beta || 0; tilt.gamma = e.gamma || 0; });
  function onMidi(data) {
    const type = data[0] & 0xf0, chn = (data[0] & 0x0f) + 1;
    for (const ch of [midi.ch[0], midi.ch[chn]]) {
      if (type === 0x90 && data[2] > 0) { ch.note = data[1]; ch.vel = data[2]; ch.held.add(data[1]); ch.seenNote = true; }
      else if (type === 0x80 || (type === 0x90 && data[2] === 0)) ch.held.delete(data[1]);
      else if (type === 0xb0) { ch.cc[data[1] & 127] = data[2]; ch.seenCc[data[1] & 127] = 1; }
      else if (type === 0xe0) { ch.bend = Math.max(-1, Math.min(1, (((data[2] << 7) | data[1]) - 8192) / 8192)); ch.seenBend = true; }
    }
  }
  const usesMidi = play.mappings.some(m => m.source.kind === 'midi');
  const usesTilt = play.mappings.some(m => m.source.kind === 'tilt');

  // ── Panel ───────────────────────────────────────────────────────────────
  const readouts = new Map();
  function fmt(v, step) { const d = step && step >= 1 ? 0 : step && step >= 0.1 ? 1 : step && step >= 0.01 ? 2 : 3; return Number(v).toFixed(d); }
  function hex(c) { return '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join(''); }
  function buildPanel() {
    panel.innerHTML = '';
    const head = el('div', 'ssp-head');
    head.append(el('b', null, B.title || 'Shader Studio'));
    const tools = el('div', 'ssp-tools');
    const pp = el('button', 'ssp-btn', 'Pause'); pp.onclick = () => { playing = !playing; pp.textContent = playing ? 'Pause' : 'Play'; }; tools.append(pp);
    if (usesMidi && navigator.requestMIDIAccess) { const b = el('button', 'ssp-btn', 'Enable MIDI'); b.onclick = () => navigator.requestMIDIAccess().then(a => { a.inputs.forEach(i => { i.onmidimessage = e => onMidi(e.data); }); b.textContent = 'MIDI on'; b.disabled = true; }, () => { b.textContent = 'MIDI refused'; }); tools.append(b); }
    if (usesTilt && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { const b = el('button', 'ssp-btn', 'Enable motion'); b.onclick = () => DeviceOrientationEvent.requestPermission().then(() => b.remove()); tools.append(b); }
    head.append(tools);
    panel.append(head);
    if (!play.controls.length) { panel.append(el('div', 'ssp-empty', 'No controls in this play file.')); return; }
    for (const c of play.controls) {
      const row = el('div', 'ssp-control');
      const top = el('div', 'ssp-row');
      top.append(el('span', 'ssp-label', c.label));
      const out = el('span', 'ssp-value', ''); top.append(out);
      row.append(top);
      if (c.kind === 'color') {
        const input = el('input'); input.type = 'color'; input.className = 'ssp-colour';
        const b = base.get(c.id); if (Array.isArray(b)) input.value = hex(b);
        input.oninput = () => { const h = input.value; const rgb = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; base.set(c.id, rgb); const u = uniformFor(c); if (u && !live.has(c.id)) uniformValues[u] = rgb; };
        row.append(input);
        readouts.set(c.id, { out, input, kind: 'color' });
      } else {
        const input = el('input'); input.type = 'range'; input.className = 'ssp-range';
        input.min = c.min; input.max = c.max; input.step = c.step || (c.max - c.min) / 400;
        const b = base.get(c.id); if (typeof b === 'number') input.value = b;
        input.oninput = () => { const v = parseFloat(input.value); base.set(c.id, v); const lt = layerTarget(c.target); if (lt) { const l = layersById.get(lt.layerId); if (l) l[lt.key] = v; } else { const u = uniformFor(c); if (u && !live.has(c.id)) uniformValues[u] = v; } out.textContent = fmt(v, c.step); };
        out.textContent = typeof b === 'number' ? fmt(b, c.step) : '';
        row.append(input);
        readouts.set(c.id, { out, input, kind: 'float', step: c.step });
      }
      panel.append(row);
    }
  }
  if (showPanel) buildPanel();
  let lastPanel = 0;
  function refreshPanel(now) {
    if (!showPanel || now - lastPanel < 66) return;
    lastPanel = now;
    for (const [id, r] of readouts) {
      const v = live.get(id);
      const driven = v !== undefined;
      r.input.disabled = driven;
      r.input.parentElement.classList.toggle('ssp-driven', driven);
      if (driven) { if (r.kind === 'color') r.input.value = hex(v); else { r.input.value = v; r.out.textContent = fmt(v, r.step); } }
    }
  }

  // ── Layers ──────────────────────────────────────────────────────────────
  const octx = ovCanvas.getContext('2d');
  const BLEND = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', lighten: 'lighten', darken: 'darken', difference: 'difference', exclusion: 'exclusion', add: 'lighter' };
  const FONT = { sans: 'Inter, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'Menlo, Consolas, monospace' };
  const css = (c, a) => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')';
  const scratch = document.createElement('canvas'), sctx = scratch.getContext('2d');
  const luma = document.createElement('canvas'); luma.width = 320; luma.height = 180; const lctx = luma.getContext('2d', { willReadFrequently: true });
  const samp = document.createElement('canvas'); samp.width = 64; samp.height = 36; const pctx = samp.getContext('2d', { willReadFrequently: true });
  const images = new Map(), particles = new Map();
  let sample = null;
  function img(src) { if (!src) return null; let i = images.get(src); if (!i) { i = new Image(); i.src = src; images.set(src, i); } return i.complete && i.naturalWidth ? i : null; }
  function num(l, k) { return layerValue(l.id, k, l[k]); }
  function drawLayers(dt) {
    const W = ovCanvas.width, H = ovCanvas.height, dpr = W / Math.max(1, fitBox.clientWidth);
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, W, H);
    let sampled = false, lumaReady = false;
    for (const l of play.layers) {
      if (!l.visible) continue;
      octx.save();
      if (l.kind === 'null') {
        const x = num(l, 'x') * W, y = (1 - num(l, 'y')) * H, r = num(l, 'size') * dpr;
        if (r > 0) { octx.beginPath(); octx.arc(x, y, r, 0, 7); octx.fillStyle = l.color; octx.fill(); octx.lineWidth = 2 * dpr; octx.strokeStyle = 'rgba(255,255,255,0.9)'; octx.stroke(); }
      } else if (l.kind === 'text' || l.kind === 'image') {
        const op = num(l, 'opacity'); if (op <= 0) { octx.restore(); continue; }
        if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
        sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, W, H); sctx.globalCompositeOperation = 'source-over';
        sctx.save(); sctx.translate(num(l, 'x') * W, (1 - num(l, 'y')) * H); sctx.rotate(num(l, 'rotation') * Math.PI / 180);
        if (l.kind === 'text') {
          const size = num(l, 'size') * H;
          sctx.font = l.weight + ' ' + Math.max(1, size) + 'px ' + FONT[l.font]; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
          sctx.fillStyle = l.matte === 'over' ? css(l.color) : '#fff';
          const lines = String(l.text).split('\n'); lines.forEach((t, i) => sctx.fillText(t, 0, (i - (lines.length - 1) / 2) * size * 1.15));
        } else { const im = img(l.src); if (im) { const h = num(l, 'scale') * H, w = h * im.naturalWidth / im.naturalHeight; sctx.drawImage(im, -w / 2, -h / 2, w, h); } }
        sctx.restore();
        if (l.matte === 'reveal') { sctx.globalCompositeOperation = 'source-out'; sctx.fillStyle = css(l.color); sctx.fillRect(0, 0, W, H); }
        else if (l.matte === 'luma') {
          if (!lumaReady) { try { lctx.globalCompositeOperation = 'source-over'; lctx.drawImage(glCanvas, 0, 0, 320, 180); const d = lctx.getImageData(0, 0, 320, 180); const p = d.data; for (let i = 0; i < p.length; i += 4) { p[i + 3] = Math.round(p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114); p[i] = p[i + 1] = p[i + 2] = 255; } lctx.putImageData(d, 0, 0); lumaReady = true; } catch (e) { /* unmatted */ } }
          if (lumaReady) { sctx.globalCompositeOperation = 'destination-in'; sctx.drawImage(luma, 0, 0, W, H); }
        }
        octx.globalAlpha = op; octx.globalCompositeOperation = l.matte === 'over' ? BLEND[l.blend] || 'source-over' : 'source-over';
        octx.drawImage(scratch, 0, 0);
      } else if (l.kind === 'particles') {
        if (!sampled) { try { pctx.drawImage(glCanvas, 0, 0, 64, 36); sample = pctx.getImageData(0, 0, 64, 36).data; } catch (e) { sample = null; } sampled = true; }
        let st = particles.get(l.id);
        if (!st || st.count !== l.count) { st = { count: l.count, x: new Float32Array(l.count), y: new Float32Array(l.count), trail: st ? st.trail : null }; for (let i = 0; i < l.count; i++) { st.x[i] = Math.random(); st.y[i] = Math.random(); } particles.set(l.id, st); }
        const speed = num(l, 'speed'), size = num(l, 'size') * dpr, op = num(l, 'opacity'), turns = num(l, 'turns'), trail = num(l, 'trail');
        const step = Math.min(0.1, dt) * speed * 0.18;
        let t = octx;
        if (trail > 0) {
          if (!st.trail) st.trail = document.createElement('canvas');
          if (st.trail.width !== W || st.trail.height !== H) { st.trail.width = W; st.trail.height = H; }
          t = st.trail.getContext('2d'); t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'destination-out'; t.globalAlpha = 1;
          t.fillStyle = 'rgba(0,0,0,' + Math.max(0.02, 1 - Math.pow(trail, 0.6)) + ')'; t.fillRect(0, 0, W, H); t.globalCompositeOperation = 'source-over';
        } else { octx.globalCompositeOperation = BLEND[l.blend] || 'source-over'; octx.globalAlpha = op; }
        const at = (px, py) => { const k = (Math.min(35, Math.max(0, py)) * 64 + Math.min(63, Math.max(0, px))) * 4; return (sample[k] * 0.299 + sample[k + 1] * 0.587 + sample[k + 2] * 0.114) / 255; };
        const fixed = css(l.color);
        for (let i = 0; i < st.count; i++) {
          let x = st.x[i], y = st.y[i], b = 0.5, gx = 0, gy = 0, col = fixed;
          if (sample) {
            const cx = Math.min(63, Math.max(0, Math.floor(x * 64))), cy = Math.min(35, Math.max(0, Math.floor((1 - y) * 36)));
            b = at(cx, cy); gx = at(cx + 1, cy) - at(cx - 1, cy); gy = at(cx, cy - 1) - at(cx, cy + 1);
            if (l.colorFromPicture) { const k = (cy * 64 + cx) * 4; col = 'rgb(' + sample[k] + ',' + sample[k + 1] + ',' + sample[k + 2] + ')'; }
          }
          let vx, vy;
          if (l.mode === 'flow') { const a = b * turns * Math.PI * 2; vx = Math.cos(a); vy = Math.sin(a); } else { const m = Math.hypot(gx, gy) || 1e-6; const s = l.mode === 'climb' ? 1 : -1; vx = s * gx / m; vy = s * gy / m; }
          x += vx * step; y += vy * step; if (x < 0) x += 1; else if (x > 1) x -= 1; if (y < 0) y += 1; else if (y > 1) y -= 1;
          st.x[i] = x; st.y[i] = y;
          t.fillStyle = col; t.beginPath(); t.arc(x * W, (1 - y) * H, size, 0, 7); t.fill();
        }
        if (trail > 0) { octx.globalAlpha = op; octx.globalCompositeOperation = BLEND[l.blend] || 'source-over'; octx.drawImage(st.trail, 0, 0); }
      }
      octx.restore();
    }
  }

  // ── Frame loop ──────────────────────────────────────────────────────────
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (playing) time += dt;
    tickMappings(dt);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(program);
    setUniform('u_time', time);
    setUniform('u_resolution', [glCanvas.width, glCanvas.height]);
    setUniform('u_mouse', [mouse.x * glCanvas.width, mouse.y * glCanvas.height]);
    for (const k in uniformValues) setUniform(k, uniformValues[k]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (play.layers.length) drawLayers(dt);
    refreshPanel(now);
  }
  requestAnimationFrame(frame);
})();
