/*
 * play-runtime.js — the standalone Shader Studio player, inlined into web
 * exports (a full HTML page or a paste-in embed snippet). Plain ES2020, no
 * imports, no framework.
 *
 *   ShaderStudioPlay.mount(element, bundle, options) → { destroy() }
 *
 * bundle:  { title, fragmentShader, uniforms, paramBindings, play, aspect }
 * options: {
 *   mode: 'player' | 'background',   player shows the controls; background is the picture only
 *   fit: 'contain' | 'cover',        contain keeps the exported shape (letterbox); cover fills the box
 *   followPage: boolean,             background: the mouse is tracked over the whole page
 *   markers: boolean,                show null markers (player default true, background false)
 *   stillForReducedMotion: boolean,  honour prefers-reduced-motion with a still frame (default true)
 *   maxDpr: number,                  cap on device pixels per CSS pixel (default 2, background 1.5)
 * }
 *
 * It runs the compiled fragment shader on a WebGL quad, draws the controls,
 * runs the mapping engine (mouse, keys, triggers with envelopes, another
 * control, nulls, LFO, noise, clock, tilt, gamepad, OSC via the bridge, Web
 * MIDI) and paints the layers (nulls, text, images, particles). Background
 * embeds never capture keys or clicks from the host page and pause while
 * off-screen or in a hidden tab. Audio-band sources need the studio's audio
 * nodes and stay idle here.
 *
 * The trigger, noise and envelope maths mirror src/play/triggers.ts.
 */
(function () {
  'use strict';
  if (window.ShaderStudioPlay && window.ShaderStudioPlay.version >= 2) return;

  const CSS = `
.ssp{display:flex;width:100%;height:100%;min-height:0;box-sizing:border-box;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6e7ec}
.ssp *{box-sizing:border-box}
.ssp-stage{flex:1;min-width:0;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;touch-action:none}
.ssp-bg .ssp-stage{background:transparent;touch-action:auto}
.ssp-fit{position:relative;width:100%;height:100%;flex-shrink:0}
.ssp-gl,.ssp-overlay{position:absolute;inset:0;width:100%;height:100%;display:block}
.ssp-overlay{pointer-events:none}
.ssp-panel{width:300px;flex-shrink:0;overflow:auto;background:#15161c;border-left:1px solid #26272f;padding:10px 12px 16px}
.ssp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0 10px}
.ssp-head b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssp-tools{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.ssp-btn{border:1px solid #33353f;background:#1e2028;color:#e6e7ec;border-radius:7px;padding:5px 10px;font:12px system-ui,sans-serif;cursor:pointer}
.ssp-btn:hover{background:#262833}
.ssp-btn:disabled{opacity:.6;cursor:default}
.ssp-control{padding:9px 10px;margin-top:8px;border-radius:10px;background:#1b1c23;box-shadow:inset 0 0 0 1px #2a2c36}
.ssp-control.ssp-driven{box-shadow:inset 0 0 0 1px #4d7cff}
.ssp-row{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}
.ssp-label{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssp-value{font-family:ui-monospace,Menlo,Consolas,monospace;color:#9a9da8;font-size:12px}
.ssp-range{width:100%;accent-color:#4d7cff}
.ssp-range:disabled{opacity:.7}
.ssp-colour{width:100%;height:30px;border:0;padding:0;background:none;border-radius:6px;cursor:pointer}
.ssp-empty{color:#9a9da8;margin-top:10px}
.ssp-error{position:absolute;inset:auto 12px 12px 12px;padding:10px 12px;border-radius:8px;background:#3a1216;color:#ffb4b4;font-size:12px}
@media (max-width:720px){.ssp:not(.ssp-bg){flex-direction:column}.ssp:not(.ssp-bg) .ssp-stage{flex:0 0 56%}.ssp-panel{width:auto;flex:1;border-left:0;border-top:1px solid #26272f}}
`;

  function injectCss() {
    if (document.getElementById('ssp-style')) return;
    const s = document.createElement('style');
    s.id = 'ssp-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ── Pure helpers (mirror src/play/triggers.ts and lib/playEngine.ts) ──────
  function hash01(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }
  function hashNoise(i, seed) { const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); }
  function smoothAt(t, seed) { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return hashNoise(i, seed) + (hashNoise(i + 1, seed) - hashNoise(i, seed)) * u; }
  function noiseAt(type, time, rate, seed, steps, frame) {
    const t = time * Math.max(0.01, rate);
    if (type === 'smooth') return smoothAt(t, seed);
    if (type === 'drift') return Math.max(0, Math.min(1, smoothAt(t, seed) * 0.57 + smoothAt(t * 2.03, seed + 17) * 0.29 + smoothAt(t * 4.11, seed + 41) * 0.14));
    if (type === 'random') return hashNoise(frame, seed + 7);
    const v = hashNoise(Math.floor(t), seed + 3);
    return steps < 2 ? v : Math.round(v * (steps - 1)) / (steps - 1);
  }
  function lfo(shape, t) {
    const c = Math.floor(t), p = t - c;
    switch (shape) { case 'sine': return 0.5 - 0.5 * Math.cos(p * Math.PI * 2); case 'triangle': return 1 - Math.abs(2 * p - 1); case 'saw': return p; case 'square': return p < 0.5 ? 1 : 0; case 'random': return hash01(c); }
    return p;
  }
  function curve(u, m) {
    const x = u < 0 ? 0 : u > 1 ? 1 : u;
    if (m.curve === 'exp') return x * x;
    if (m.curve === 'log') return Math.sqrt(x);
    if (m.curve === 'custom' && m.curveY && m.curveY.length > 1) { const pos = x * (m.curveY.length - 1); const i = Math.min(m.curveY.length - 2, Math.floor(pos)); return m.curveY[i] + (m.curveY[i + 1] - m.curveY[i]) * (pos - i); }
    return x;
  }
  function triggerKey(t) {
    switch (t.on) { case 'key': return 'key:' + t.code; case 'note': return 'note:' + t.channel + ':' + (t.note < 0 ? '*' : t.note); case 'mouse': return 'mouse'; case 'osc': return 'osc:' + t.address; case 'beat': return 'beat:' + t.bpm + ':' + t.beats; case 'audio': return 'audio:' + t.band + ':' + t.threshold; }
    return '';
  }
  function beatAt(bpm, beats, time) {
    const period = (60 / Math.max(1, bpm)) * Math.max(0.0625, beats);
    const count = Math.floor(time / period) + 1;
    return { count, gate: time - (count - 1) * period < Math.min(0.12, period / 4) };
  }
  const EPS = 1e-6;
  function stepTrigger(st, p, presses, gate, dt, velocity) {
    const fresh = presses > st.seen;
    st.seen = presses;
    if (p.mode === 'toggle') { if (fresh) st.value = st.value >= 0.5 ? 0 : 1; return st.value; }
    if (p.mode === 'step') { if (fresh) { const n = Math.max(2, p.steps); st.index = (st.index + 1) % n; st.value = st.index / (n - 1); } return st.value; }
    if (p.mode === 'random') { if (fresh) st.value = Math.random(); return st.value; }
    const ms = dt * 1000;
    if (fresh) { st.stage = 'attack'; st.peak = Math.max(0, Math.min(1, velocity)); }
    const level = p.sustain * st.peak;
    if (st.stage === 'attack') { st.value = p.attack <= 0 ? st.peak : Math.min(st.peak, st.value + (ms / p.attack) * st.peak); if (st.value >= st.peak - EPS) { st.value = st.peak; st.stage = 'decay'; } }
    else if (st.stage === 'decay') { st.value = p.decay <= 0 ? level : Math.max(level, st.value - (ms / p.decay) * (st.peak - level || st.peak)); if (st.value <= level + EPS) { st.value = level; st.stage = 'sustain'; } }
    else if (st.stage === 'sustain') st.value = level;
    else if (st.stage === 'release') { st.value = p.release <= 0 ? 0 : Math.max(0, st.value - (ms / p.release) * Math.max(st.peak, 1e-3)); if (st.value <= EPS) { st.value = 0; st.stage = 'idle'; } }
    else st.value = 0;
    if (!gate && (st.stage === 'decay' || st.stage === 'sustain')) st.stage = level > 0 || st.stage === 'sustain' ? 'release' : st.stage;
    if (st.stage === 'sustain' && level === 0) st.stage = 'idle';
    return st.value;
  }
  function layerTarget(t) { if (!t.startsWith('layer:')) return null; const r = t.slice(6); const i = r.lastIndexOf('::'); return i > 0 ? { layerId: r.slice(0, i), key: r.slice(i + 2) } : null; }
  function bindingKey(t) { return t.split('::').slice(-2).join('::'); }
  function isTyping(t) { return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t && t.isContentEditable); }

  // ── Shared inputs (one set of listeners for every embed on the page) ──────
  const shared = {
    keysHeld: new Set(),
    presses: new Map(), held: new Map(), velocities: new Map(),
    midi: Array.from({ length: 17 }, () => ({ note: 60, vel: 0, held: new Set(), bend: 0, cc: new Float32Array(128), seenNote: false, seenBend: false, seenCc: new Uint8Array(128) })),
    tilt: { got: false, alpha: 0, beta: 0, gamma: 0 },
    osc: new Map(), oscHeld: new Set(), oscWs: null, oscStatus: 'off',
    pageX: 0, pageY: 0,
    live: { status: 'off', analyser: null, freq: null, wave: null, sr: 48000, frame: -1, v: { level: 0, bass: 0, lowmid: 0, highmid: 0, treble: 0 }, gates: new Set(), clock: 0 },
    instances: new Set(),
    listening: false,
  };
  function press(key, vel) { shared.presses.set(key, (shared.presses.get(key) || 0) + 1); shared.held.set(key, (shared.held.get(key) || 0) + 1); shared.velocities.set(key, vel == null ? 1 : vel); }
  function release(key) { const n = (shared.held.get(key) || 0) - 1; if (n > 0) shared.held.set(key, n); else shared.held.delete(key); }
  function onMidi(data) {
    const type = data[0] & 0xf0, chn = (data[0] & 0x0f) + 1;
    const noteOn = type === 0x90 && data[2] > 0, noteOff = type === 0x80 || (type === 0x90 && data[2] === 0);
    for (const ch of [shared.midi[0], shared.midi[chn]]) {
      if (noteOn) { ch.note = data[1]; ch.vel = data[2]; ch.held.add(data[1]); ch.seenNote = true; }
      else if (noteOff) ch.held.delete(data[1]);
      else if (type === 0xb0) { ch.cc[data[1] & 127] = data[2]; ch.seenCc[data[1] & 127] = 1; }
      else if (type === 0xe0) { ch.bend = Math.max(-1, Math.min(1, (((data[2] << 7) | data[1]) - 8192) / 8192)); ch.seenBend = true; }
    }
    if (noteOn || noteOff) for (const k of ['note:0:*', 'note:0:' + data[1], 'note:' + chn + ':*', 'note:' + chn + ':' + data[1]]) { if (noteOn) press(k, data[2] / 127); else release(k); }
  }
  function onOscMessage(address, args) {
    shared.osc.set(address, args);
    const v = typeof args[0] === 'number' ? args[0] : typeof args[0] === 'boolean' ? (args[0] ? 1 : 0) : null;
    const key = 'osc:' + address;
    if (v === null) { press(key); release(key); }
    else if (v > 0.5 && !shared.oscHeld.has(key)) { shared.oscHeld.add(key); press(key); }
    else if (v <= 0.5 && shared.oscHeld.has(key)) { shared.oscHeld.delete(key); release(key); }
  }
  function connectOsc(port, onStatus) {
    if (shared.oscWs) return;
    const open = () => {
      let ws;
      try { ws = new WebSocket('ws://127.0.0.1:' + port); } catch (e) { onStatus('error'); return; }
      shared.oscWs = ws; onStatus('connecting');
      ws.onopen = () => onStatus('connected');
      ws.onmessage = e => { try { const d = JSON.parse(e.data); if (typeof d.a === 'string') onOscMessage(d.a, Array.isArray(d.v) ? d.v : []); } catch (err) { /* not ours */ } };
      ws.onclose = () => { shared.oscWs = null; onStatus('error'); setTimeout(open, 3000); };
    };
    open();
  }
  // Live audio in (a mic, an interface, or a virtual cable carrying a DAW's output). Mirrors src/lib/liveAudio.ts.
  const LIVE = { bass: [25, 150], lowmid: [150, 600], highmid: [600, 3000], treble: [3000, 12000] };
  const dbUnit = db => Math.max(0, Math.min(1, (db + 80) / 70));
  function startLive(deviceId) {
    const L = shared.live;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { L.status = 'unsupported'; return Promise.resolve(L.status); }
    L.status = 'requesting';
    return navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(stream => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.55;
      ctx.createMediaStreamSource(stream).connect(an);
      L.analyser = an; L.freq = new Float32Array(an.frequencyBinCount); L.wave = new Float32Array(an.fftSize); L.sr = ctx.sampleRate; L.status = 'on';
      return 'on';
    }, () => { L.status = 'denied'; return 'denied'; });
  }
  function updateLive() {
    const L = shared.live;
    if (L.status !== 'on' || L.frame === L.clock) return;
    L.frame = L.clock;
    L.analyser.getFloatFrequencyData(L.freq); L.analyser.getFloatTimeDomainData(L.wave);
    let s = 0; for (let i = 0; i < L.wave.length; i++) s += L.wave[i] * L.wave[i];
    L.v.level = dbUnit(20 * Math.log10(Math.max(1e-6, Math.sqrt(s / L.wave.length))));
    const binHz = L.sr / 2 / L.freq.length;
    for (const b in LIVE) { const a = Math.max(1, Math.floor(LIVE[b][0] / binHz)), z = Math.min(L.freq.length - 1, Math.ceil(LIVE[b][1] / binHz)); let sum = 0; for (let i = a; i <= z; i++) sum += Math.max(-100, L.freq[i]); L.v[b] = dbUnit(sum / (z - a + 1)); }
  }

  function listen() {
    if (shared.listening) return;
    shared.listening = true;
    window.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || e.repeat) return;
      let claimed = false;
      for (const inst of shared.instances) if (inst.claimsKey(e.code)) claimed = true;
      if (!claimed) return;
      // Only a player embed may take the key from the page; a background never does.
      for (const inst of shared.instances) if (inst.mode === 'player' && inst.claimsKey(e.code)) { e.preventDefault(); break; }
      shared.keysHeld.add(e.code); press('key:' + e.code);
    });
    window.addEventListener('keyup', e => { if (shared.keysHeld.delete(e.code)) release('key:' + e.code); });
    window.addEventListener('blur', () => { for (const c of shared.keysHeld) release('key:' + c); shared.keysHeld.clear(); });
    window.addEventListener('pointermove', e => { shared.pageX = e.clientX; shared.pageY = e.clientY; }, { passive: true });
    window.addEventListener('deviceorientation', e => { shared.tilt.got = true; shared.tilt.alpha = e.alpha || 0; shared.tilt.beta = e.beta || 0; shared.tilt.gamma = e.gamma || 0; });
  }

  // ── mount ────────────────────────────────────────────────────────────────
  function mount(root, B, opts) {
    opts = opts || {};
    const mode = opts.mode === 'background' ? 'background' : 'player';
    const bg = mode === 'background';
    const fit = opts.fit || (bg ? 'cover' : 'contain');
    const followPage = opts.followPage !== false;
    const markers = opts.markers == null ? !bg : !!opts.markers;
    const stillForReducedMotion = opts.stillForReducedMotion !== false;
    const maxDpr = opts.maxDpr || (bg ? 1.5 : 2);
    const play = B.play || { controls: [], mappings: [], layers: [] };
    injectCss();
    listen();

    root.classList.add('ssp');
    if (bg) root.classList.add('ssp-bg');
    root.innerHTML = '';
    const stage = el('div', 'ssp-stage');
    const glCanvas = el('canvas', 'ssp-gl');
    const ovCanvas = el('canvas', 'ssp-overlay');
    const fitBox = el('div', 'ssp-fit');
    fitBox.append(glCanvas, ovCanvas);
    stage.append(fitBox);
    root.append(stage);
    const panel = el('div', 'ssp-panel');
    if (!bg) root.append(panel);
    if (bg) { root.style.pointerEvents = 'none'; glCanvas.setAttribute('aria-hidden', 'true'); }

    // WebGL
    const gl = glCanvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) { stage.append(el('div', 'ssp-error', 'WebGL is not available in this browser.')); return { destroy() {} }; }
    const VS = 'attribute vec2 position; varying vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }';
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed'); return s; };
    let program;
    try {
      program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, B.fragmentShader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link failed');
    } catch (e) { stage.append(el('div', 'ssp-error', 'The shader did not compile here: ' + e.message)); return { destroy() {} }; }
    gl.useProgram(program);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    const white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    const locs = new Map();
    const loc = n => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(program, n)); return locs.get(n); };
    const uniformValues = Object.assign({}, B.uniforms || {});
    const setUniform = (n, v) => { const l = loc(n); if (!l) return; if (typeof v === 'number') gl.uniform1f(l, v); else if (Array.isArray(v)) { if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else if (v.length === 4) gl.uniform4fv(l, v); } };
    const fontLoc = loc('u_fontTexture');
    if (fontLoc) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, white); gl.uniform1i(fontLoc, 0); }

    // Size: contain letterboxes to the exported shape; cover fills the box.
    const ratio = fit === 'contain' && B.aspect && B.aspect.ratio ? B.aspect.ratio : null;
    let needsDraw = true;
    const layout = () => {
      const r = stage.getBoundingClientRect();
      let w = r.width, h = r.height;
      if (ratio && w > 0 && h > 0) { if (w / h > ratio) w = h * ratio; else h = w / ratio; }
      fitBox.style.width = w + 'px'; fitBox.style.height = h + 'px';
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; ovCanvas.width = W; ovCanvas.height = H; needsDraw = true; }
    };
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    layout();

    // Mapping engine
    const controls = new Map(play.controls.map(c => [c.id, c]));
    const layersById = new Map(play.layers.map(l => [l.id, l]));
    const base = new Map(), live = new Map(), layerLive = new Map(), smooth = new Map(), trig = new Map();
    const mouse = { x: 0.5, y: 0.5, down: 0 };
    let time = 0, playing = true, lastNow = 0, frame = 0;
    const bindings = B.paramBindings || {};
    const uniformFor = c => bindings[bindingKey(c.target)];
    for (const c of play.controls) {
      const lt = layerTarget(c.target);
      if (lt) { const l = layersById.get(lt.layerId); if (l && typeof l[lt.key] === 'number') base.set(c.id, l[lt.key]); }
      else { const u = uniformFor(c); if (u && uniformValues[u] !== undefined) base.set(c.id, Array.isArray(uniformValues[u]) ? uniformValues[u].slice() : uniformValues[u]); }
    }
    const layerValue = (id, key, fb) => { const v = layerLive.get(id + '::' + key); return v === undefined ? fb : v; };
    const gamepad = i => (navigator.getGamepads ? navigator.getGamepads()[i] : null);
    const keysUsed = new Set();
    for (const m of play.mappings) {
      if (!m.enabled) continue;
      if (m.source.kind === 'key') keysUsed.add(m.source.code);
      if (m.source.kind === 'trigger' && m.source.trigger.on === 'key') keysUsed.add(m.source.trigger.code);
    }
    function readSource(s) {
      switch (s.kind) {
        case 'mouse': return s.axis === 'x' ? mouse.x : s.axis === 'y' ? mouse.y : mouse.down;
        case 'key': return shared.keysHeld.has(s.code) ? 1 : 0;
        case 'lfo': return lfo(s.shape, time * s.rate + s.phase);
        case 'noise': return noiseAt(s.type, time, s.rate, s.seed, s.steps, frame);
        case 'clock': return lfo(s.shape, time * (s.bpm / 60 / Math.max(0.0625, s.beats)));
        case 'tilt': { const t = shared.tilt; if (!t.got) return null; if (s.axis === 'alpha') return ((t.alpha % 360) + 360) % 360 / 360; const v = Math.max(-90, Math.min(90, s.axis === 'beta' ? t.beta : t.gamma)); return (v + 90) / 180; }
        case 'gamepad': { const p = gamepad(s.pad); if (!p) return null; if (s.control === 'axis') { const a = p.axes[s.index]; return a === undefined ? null : Math.max(0, Math.min(1, (a + 1) / 2)); } const b = p.buttons[s.index]; return b ? b.value : null; }
        case 'midi': { const ch = shared.midi[Math.max(0, Math.min(16, s.channel))]; switch (s.signal) { case 'note': return ch.seenNote ? ch.note / 127 : null; case 'velocity': return ch.seenNote ? ch.vel / 127 : null; case 'gate': return ch.seenNote ? (ch.held.size ? 1 : 0) : null; case 'bend': return ch.seenBend ? (ch.bend + 1) / 2 : null; case 'cc': { const n = (s.cc || 1) & 127; return ch.seenCc[n] ? ch.cc[n] / 127 : null; } } return null; }
        case 'live': { if (shared.live.status !== 'on') return null; updateLive(); return Math.max(0, Math.min(1, shared.live.v[s.band] * s.gain)); }
        case 'osc': { const a = shared.osc.get(s.address); if (!a) return null; const raw = a[s.arg]; const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : null; return v === null ? null : Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min))); }
        case 'null': { const l = layersById.get(s.layerId); if (!l) return null; return Math.max(0, Math.min(1, layerValue(l.id, s.axis, l[s.axis]))); }
        case 'control': { const c = controls.get(s.controlId); if (!c) return null; const v = live.has(c.id) ? live.get(c.id) : base.get(c.id); if (v === undefined) return null; if (Array.isArray(v)) return (v[0] + v[1] + v[2]) / 3; const span = c.max - c.min; return span > 0 ? Math.max(0, Math.min(1, (v - c.min) / span)) : 0; }
        default: return null;
      }
    }
    function readTrigger(m, dt) {
      const s = m.source, t = s.trigger;
      let presses, gate, vel = 1;
      if (t.on === 'beat') { const b = beatAt(t.bpm, t.beats, time); presses = b.count; gate = b.gate; }
      else { const k = triggerKey(t); presses = shared.presses.get(k) || 0; gate = (shared.held.get(k) || 0) > 0; if (s.velocity) vel = shared.velocities.get(k) || 1; }
      let st = trig.get(m.id);
      if (!st) { st = { seen: presses, value: 0, stage: 'idle', peak: 1, index: -1 }; trig.set(m.id, st); }
      return stepTrigger(st, s, presses, gate, dt, vel);
    }
    const colourBuf = new Map();
    function tickAudioTriggers() {
      if (shared.live.status !== 'on') return;
      updateLive();
      for (const m of play.mappings) {
        if (!m.enabled || m.source.kind !== 'trigger' || m.source.trigger.on !== 'audio') continue;
        const t = m.source.trigger, k = triggerKey(t), v = shared.live.v[t.band] || 0, open = shared.live.gates.has(k);
        if (!open && v >= t.threshold) { shared.live.gates.add(k); press(k, v); }
        else if (open && v < t.threshold * 0.8) { shared.live.gates.delete(k); release(k); }
      }
    }
    function tickMappings(dt) {
      tickAudioTriggers();
      const driven = new Set();
      for (const m of play.mappings) {
        if (!m.enabled) continue;
        const c = controls.get(m.controlId); if (!c) continue;
        const u = m.source.kind === 'trigger' ? readTrigger(m, dt) : readSource(m.source);
        if (u === null) continue;
        const target = m.outMin + (m.outMax - m.outMin) * curve(u, m);
        let v = smooth.get(m.id);
        if (m.smoothMs <= 0 || v === undefined) v = target;
        else { const a = 1 - Math.exp(-(dt * 1000) / m.smoothMs); v = v + (target - v) * a; if (Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(m.outMax - m.outMin))) v = target; }
        smooth.set(m.id, v);
        const lt = layerTarget(c.target);
        if (lt) { layerLive.set(lt.layerId + '::' + lt.key, v); live.set(c.id, v); driven.add(c.id); continue; }
        const un = uniformFor(c); if (!un) continue;
        if (c.kind === 'color') {
          const b = base.get(c.id) || [0, 0, 0];
          let buf = colourBuf.get(c.id);
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

    // Pointer. Player: on the picture (drag nulls, clicks are the mouse trigger). Background: the whole page, never captured.
    let drag = null, pictureDown = false;
    const toUnit = (cx, cy) => { const r = fitBox.getBoundingClientRect(); return { x: (cx - r.left) / Math.max(1, r.width), y: 1 - (cy - r.top) / Math.max(1, r.height), w: r.width, h: r.height }; };
    const clampedMouse = (cx, cy) => { const u = toUnit(cx, cy); mouse.x = Math.max(0, Math.min(1, u.x)); mouse.y = Math.max(0, Math.min(1, u.y)); return u; };
    const listeners = [];
    const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); listeners.push(() => target.removeEventListener(type, fn, o)); };
    if (!bg) {
      on(stage, 'pointermove', e => {
        const u = clampedMouse(e.clientX, e.clientY);
        if (drag) { const l = layersById.get(drag.id); if (l) { l.x = Math.max(0, Math.min(1, u.x + drag.dx)); l.y = Math.max(0, Math.min(1, u.y + drag.dy)); } }
      });
      on(stage, 'pointerdown', e => {
        mouse.down = 1;
        const u = toUnit(e.clientX, e.clientY);
        if (markers) for (const l of play.layers) {
          if (l.kind !== 'null' || !l.visible) continue;
          const d = Math.hypot((u.x - layerValue(l.id, 'x', l.x)) * u.w, (u.y - layerValue(l.id, 'y', l.y)) * u.h);
          if (d <= Math.max(l.size, 10) + 6) { drag = { id: l.id, dx: l.x - u.x, dy: l.y - u.y }; stage.setPointerCapture(e.pointerId); return; }
        }
        press('mouse'); pictureDown = true;
      });
      const up = () => { mouse.down = 0; drag = null; if (pictureDown) { pictureDown = false; release('mouse'); } };
      on(stage, 'pointerup', up); on(stage, 'pointercancel', up);
    } else {
      on(window, 'pointerdown', e => {
        const u = toUnit(e.clientX, e.clientY);
        mouse.down = 1;
        if (u.x >= 0 && u.x <= 1 && u.y >= 0 && u.y <= 1) { press('mouse'); pictureDown = true; }
      }, { passive: true });
      on(window, 'pointerup', () => { mouse.down = 0; if (pictureDown) { pictureDown = false; release('mouse'); } }, { passive: true });
    }

    // Panel (player only)
    const readouts = new Map();
    const usesMidi = play.mappings.some(m => m.source.kind === 'midi' || (m.source.kind === 'trigger' && m.source.trigger.on === 'note'));
    const usesOsc = play.mappings.some(m => m.source.kind === 'osc' || (m.source.kind === 'trigger' && m.source.trigger.on === 'osc'));
    const usesTilt = play.mappings.some(m => m.source.kind === 'tilt');
    const usesLive = play.mappings.some(m => m.source.kind === 'live' || (m.source.kind === 'trigger' && m.source.trigger.on === 'audio'));
    const fmt = (v, step) => { const d = step && step >= 1 ? 0 : step && step >= 0.1 ? 1 : step && step >= 0.01 ? 2 : 3; return Number(v).toFixed(d); };
    const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
    if (!bg) {
      const head = el('div', 'ssp-head');
      head.append(el('b', null, B.title || 'Shader Studio'));
      const tools = el('div', 'ssp-tools');
      const pp = el('button', 'ssp-btn', 'Pause');
      pp.onclick = () => { playing = !playing; pp.textContent = playing ? 'Pause' : 'Play'; };
      tools.append(pp);
      if (usesMidi && navigator.requestMIDIAccess) {
        const b = el('button', 'ssp-btn', 'Enable MIDI');
        b.onclick = () => navigator.requestMIDIAccess().then(a => { a.inputs.forEach(i => { i.onmidimessage = e => onMidi(e.data); }); b.textContent = 'MIDI on'; b.disabled = true; }, () => { b.textContent = 'MIDI refused'; });
        tools.append(b);
      }
      if (usesOsc) {
        const b = el('button', 'ssp-btn', 'Connect OSC');
        b.title = 'Needs the Shader Studio OSC bridge running on this computer (npm run osc-bridge).';
        b.onclick = () => connectOsc(opts.oscPort || 9001, s => { b.textContent = s === 'connected' ? 'OSC on' : s === 'connecting' ? 'Connecting…' : 'No OSC bridge'; b.disabled = s === 'connected'; });
        tools.append(b);
      }
      if (usesLive) {
        const b = el('button', 'ssp-btn', 'Listen to audio');
        b.title = 'Uses your microphone, or pick a virtual cable carrying your DAW\'s sound';
        const pick = el('select', 'ssp-btn'); pick.style.display = 'none';
        b.onclick = () => startLive(pick.value).then(st => {
          b.textContent = st === 'on' ? 'Listening' : st === 'denied' ? 'Audio blocked' : 'No audio input';
          if (st === 'on' && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(ds => {
            const ins = ds.filter(d => d.kind === 'audioinput');
            if (ins.length < 2) return;
            pick.innerHTML = ''; for (const d of ins) { const o = el('option', null, d.label || 'Input'); o.value = d.deviceId; pick.append(o); }
            pick.style.display = ''; pick.onchange = () => startLive(pick.value);
          });
        });
        tools.append(b, pick);
      }
      if (usesTilt && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const b = el('button', 'ssp-btn', 'Enable motion');
        b.onclick = () => DeviceOrientationEvent.requestPermission().then(() => b.remove());
        tools.append(b);
      }
      head.append(tools);
      panel.append(head);
      if (!play.controls.length) panel.append(el('div', 'ssp-empty', 'No controls in this play file.'));
      for (const c of play.controls) {
        const row = el('div', 'ssp-control');
        const top = el('div', 'ssp-row');
        top.append(el('span', 'ssp-label', c.label));
        const out = el('span', 'ssp-value', '');
        top.append(out);
        row.append(top);
        if (c.kind === 'color') {
          const input = el('input'); input.type = 'color'; input.className = 'ssp-colour';
          const b = base.get(c.id); if (Array.isArray(b)) input.value = hex(b);
          input.oninput = () => { const h = input.value; const rgb = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; base.set(c.id, rgb); const u = uniformFor(c); if (u && !live.has(c.id)) uniformValues[u] = rgb; needsDraw = true; };
          row.append(input);
          readouts.set(c.id, { out, input, kind: 'color' });
        } else {
          const input = el('input'); input.type = 'range'; input.className = 'ssp-range';
          input.min = c.min; input.max = c.max; input.step = c.step || (c.max - c.min) / 400;
          const b = base.get(c.id); if (typeof b === 'number') input.value = b;
          input.oninput = () => { const v = parseFloat(input.value); base.set(c.id, v); const lt = layerTarget(c.target); if (lt) { const l = layersById.get(lt.layerId); if (l) l[lt.key] = v; } else { const u = uniformFor(c); if (u && !live.has(c.id)) uniformValues[u] = v; } out.textContent = fmt(v, c.step); needsDraw = true; };
          out.textContent = typeof b === 'number' ? fmt(b, c.step) : '';
          row.append(input);
          readouts.set(c.id, { out, input, kind: 'float', step: c.step });
        }
        panel.append(row);
      }
    } else if (usesOsc && opts.osc) {
      connectOsc(opts.oscPort || 9001, () => {});
    }
    let lastPanel = 0;
    const refreshPanel = now => {
      if (bg || now - lastPanel < 66) return;
      lastPanel = now;
      for (const [id, r] of readouts) {
        const v = live.get(id), driven = v !== undefined;
        r.input.disabled = driven;
        r.input.parentElement.classList.toggle('ssp-driven', driven);
        if (driven) { if (r.kind === 'color') r.input.value = hex(v); else { r.input.value = v; r.out.textContent = fmt(v, r.step); } }
      }
    };

    // Layers
    const octx = ovCanvas.getContext('2d');
    const BLEND = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', lighten: 'lighten', darken: 'darken', difference: 'difference', exclusion: 'exclusion', add: 'lighter' };
    const FONT = { sans: 'Inter, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'Menlo, Consolas, monospace' };
    const css = (c, a) => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')';
    const scratch = document.createElement('canvas'), sctx = scratch.getContext('2d');
    const luma = document.createElement('canvas'); luma.width = 320; luma.height = 180; const lctx = luma.getContext('2d', { willReadFrequently: true });
    const samp = document.createElement('canvas'); samp.width = 64; samp.height = 36; const pctx = samp.getContext('2d', { willReadFrequently: true });
    const images = new Map(), particles = new Map();
    let sample = null;
    const img = src => { if (!src) return null; let i = images.get(src); if (!i) { i = new Image(); i.onload = () => { needsDraw = true; }; i.src = src; images.set(src, i); } return i.complete && i.naturalWidth ? i : null; };
    const num = (l, k) => layerValue(l.id, k, l[k]);
    function drawLayers(dt) {
      const W = ovCanvas.width, H = ovCanvas.height, dpr = W / Math.max(1, fitBox.clientWidth);
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, W, H);
      let sampled = false, lumaReady = false;
      for (const l of play.layers) {
        if (!l.visible) continue;
        octx.save();
        if (l.kind === 'null') {
          if (markers) {
            const x = num(l, 'x') * W, y = (1 - num(l, 'y')) * H, r = num(l, 'size') * dpr;
            if (r > 0) { octx.beginPath(); octx.arc(x, y, r, 0, 7); octx.fillStyle = l.color; octx.fill(); octx.lineWidth = 2 * dpr; octx.strokeStyle = 'rgba(255,255,255,0.9)'; octx.stroke(); }
          }
        } else if (l.kind === 'text' || l.kind === 'image') {
          const op = num(l, 'opacity');
          if (op > 0) {
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
          }
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
            if (l.mode === 'flow') { const a = b * turns * Math.PI * 2; vx = Math.cos(a); vy = Math.sin(a); } else { const mm = Math.hypot(gx, gy) || 1e-6; const sg = l.mode === 'climb' ? 1 : -1; vx = sg * gx / mm; vy = sg * gy / mm; }
            x += vx * step; y += vy * step; if (x < 0) x += 1; else if (x > 1) x -= 1; if (y < 0) y += 1; else if (y > 1) y -= 1;
            st.x[i] = x; st.y[i] = y;
            t.fillStyle = col; t.beginPath(); t.arc(x * W, (1 - y) * H, size, 0, 7); t.fill();
          }
          if (trail > 0) { octx.globalAlpha = op; octx.globalCompositeOperation = BLEND[l.blend] || 'source-over'; octx.drawImage(st.trail, 0, 0); }
        }
        octx.restore();
      }
    }

    // Visibility: a background pauses off-screen and in hidden tabs; reduced motion gets a still frame.
    let onScreen = true;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); if (onScreen) needsDraw = true; }) : null;
    if (io) io.observe(root);
    const reduced = stillForReducedMotion && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const inst = { mode, claimsKey: code => keysUsed.has(code) };
    shared.instances.add(inst);

    let raf = 0, alive = true;
    function tick(now) {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      if ((bg && !onScreen) || document.hidden) return;
      if (reduced && !needsDraw && frame > 0) return;
      if (playing && !reduced) time += dt;
      frame++;
      shared.live.clock++;
      if (bg && followPage) clampedMouse(shared.pageX, shared.pageY);
      tickMappings(dt);
      needsDraw = false;
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
    raf = requestAnimationFrame(tick);

    return {
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        if (io) io.disconnect();
        for (const off of listeners) off();
        shared.instances.delete(inst);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        root.innerHTML = '';
        root.classList.remove('ssp', 'ssp-bg');
      },
      pause() { playing = false; },
      play() { playing = true; },
    };
  }

  window.ShaderStudioPlay = { version: 2, mount };

  // A full-page export: mount on #play with the page's options (URL params can override).
  if (window.PLAY_BUNDLE && document.getElementById('play')) {
    const q = new URLSearchParams(location.search);
    const o = Object.assign({}, window.PLAY_OPTIONS || {});
    if (q.get('panel') === '0' || q.get('mode') === 'background') o.mode = 'background';
    if (q.get('mode') === 'player') o.mode = 'player';
    if (q.get('fit') === 'cover' || q.get('fit') === 'contain') o.fit = q.get('fit');
    mount(document.getElementById('play'), window.PLAY_BUNDLE, o);
  }
})();
