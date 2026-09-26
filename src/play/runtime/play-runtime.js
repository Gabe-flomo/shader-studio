/*
 * play-runtime.js — the standalone Shader Studio player, inlined into web
 * exports (a full HTML page or a paste-in embed snippet). Plain ES2020, no
 * imports, no framework.
 *
 *   ShaderStudioPlay.mount(element, bundle, options) → { destroy() }
 *
 * bundle:  { title, fragmentShader, uniforms, paramBindings, play, aspect, passes?, media? }
 *   passes: { stateful, echo: { copies, delay } | null, particles: [{ vertexShader, fragmentShader, count, shape }] }
 *   media:  { textures: { uniform: { src } }, videos: { uniform: { src, loop, speed } },
 *             audio: [{ id, src, uniforms, bands, range, mode }] }   (src: a data URL, or null)
 * options: {
 *   mode: 'player' | 'background',   player shows the controls; background is the picture only
 *   fit: 'contain' | 'cover',        contain keeps the exported shape (letterbox); cover fills the box
 *   followPage: boolean,             background: the mouse is tracked over the whole page
 *   markers: boolean,                show null markers (player default true, background false)
 *   stillForReducedMotion: boolean,  honour prefers-reduced-motion with a still frame (default true)
 *   maxDpr: number,                  cap on device pixels per CSS pixel (default 2, background 1.5, feedback or echo 1)
 * }
 *
 * It runs the compiled fragment shader on a WebGL quad, draws the controls,
 * runs the mapping engine (mouse, keys, triggers with envelopes, another
 * control, nulls, LFO, noise, clock, tilt, gamepad, OSC via the bridge, Web
 * MIDI) and paints the layers (nulls, text, images, particles). Background
 * embeds never capture keys or clicks from the host page and pause while
 * off-screen or in a hidden tab.
 *
 * Around the fragment shader it runs what ShaderCanvas runs: previous-frame
 * feedback (ping-pong targets on u_prevFrame), echo (a ring of copies on
 * u_echo0…), GPU particle systems (points drawn additively with the app's
 * camera), images and videos on their samplers, and Audio Input nodes' bands
 * from their embedded song or the live input. A MIDI Input node's outputs
 * stay at rest.
 *
 * The trigger, noise and envelope maths mirror src/play/triggers.ts.
 */
(function () {
  'use strict';
  if (window.ShaderStudioPlay && window.ShaderStudioPlay.version >= 3) return;

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
    switch (t.on) { case 'key': return 'key:' + t.code; case 'note': return 'note:' + t.channel + ':' + (t.note < 0 ? '*' : t.note); case 'mouse': return 'mouse'; case 'osc': return 'osc:' + t.address; case 'beat': return 'beat:' + t.bpm + ':' + t.beats; case 'audio': return 'audio:' + t.band + ':' + t.threshold; case 'zone': return t.event === 'fill' ? 'zone:' + t.layerId + ':fill:' + t.threshold : 'zone:' + t.layerId + ':' + t.event; }
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
  // An action control (a button): `act:<layerId>::<action>`.
  function actTarget(t) { if (!t.startsWith('act:')) return null; const r = t.slice(4); const i = r.lastIndexOf('::'); return i > 0 ? { layerId: r.slice(0, i), do: r.slice(i + 2) } : null; }
  function bindingKey(t) { return t.split('::').slice(-2).join('::'); }
  function isTyping(t) { return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t && t.isContentEditable); }

  // ── GPU helpers (mirror components/ShaderCanvas.tsx and what Three.js adds) ──
  // GLSL 1 source as WebGL2 runs it: the defines Three.js puts ahead of a ShaderMaterial.
  const VERT3 = '#version 300 es\n#define attribute in\n#define varying out\n#define texture2D texture\n';
  const FRAG3 = '#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define gl_FragDepthEXT gl_FragDepth\n#define texture2D texture\n#define textureCube texture\n#define texture2DProj textureProj\n#define texture2DLodEXT textureLod\n#define texture2DProjLodEXT textureProjLod\n#define textureCubeLodEXT textureLod\n#define texture2DGradEXT textureGrad\n#define texture2DProjGradEXT textureProjGrad\n#define textureCubeGradEXT textureGrad\n';
  function toGlsl(src, vertex, webgl2, derivatives) {
    if (webgl2) return (vertex ? VERT3 : FRAG3) + src.replace(/^[ \t]*#extension[^\n]*$/gm, '');
    // WebGL1: fwidth and friends are an extension there.
    if (!vertex && /\b(dFdx|dFdy|fwidth)\b/.test(src) && !/#extension\s+GL_OES_standard_derivatives/.test(src) && derivatives()) return '#extension GL_OES_standard_derivatives : enable\n' + src;
    return src;
  }
  // The app's dithering blit (ShaderCanvas BLIT_FRAG): a float target to 8 bits without banding.
  const BLIT_FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D tInput;
uniform float u_seed;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec4 c = texture2D(tInput, vUv);
  vec2 px = gl_FragCoord.xy + fract(u_seed * vec2(0.7548777, 0.5698403)) * 512.0;
  float d = (hash(px) + hash(px + vec2(0.37, 0.71)) - 1.0) / 255.0;
  vec3 amp = clamp(min(c.rgb, 1.0 - c.rgb) * 255.0, 0.0, 1.0);
  gl_FragColor = vec4(clamp(c.rgb + d * amp, 0.0, 1.0), c.a);
}`;
  const ditherSeed = n => (n % 4096) + 0.5;
  // A particle chain's vertex shader with what Three.js declares for it, and its point size scaled to CSS pixels.
  function particleVertex(src) {
    return 'uniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\nattribute vec3 position;\n' +
      src.replace(/void\s+main\s*\(\s*\)/, 'void ssp_main()') +
      '\nuniform float ssp_pointScale;\nvoid main() { ssp_main(); gl_PointSize *= ssp_pointScale; }\n';
  }
  // Mirrors buildParticleGeometry in ShaderCanvas: 0 sphere, 1 ball, 2 box, 3 disk, 4 ring, 5 spiral.
  function particleGeometry(count, shape) {
    const positions = new Float32Array(count * 3), normDists = new Float32Array(count), R = Math.random;
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, z = 0, nd = 1;
      if (shape === 0 || shape === 1) {
        const th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1), r = shape === 1 ? Math.cbrt(R()) : 1;
        x = r * Math.sin(ph) * Math.cos(th); y = r * Math.sin(ph) * Math.sin(th); z = r * Math.cos(ph); nd = r;
      } else if (shape === 2) {
        x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; nd = Math.min(1, Math.sqrt(x * x + y * y + z * z) / Math.sqrt(3));
      } else if (shape === 3) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()); x = r * Math.cos(a); z = r * Math.sin(a); nd = r;
      } else if (shape === 4) {
        const a = R() * Math.PI * 2, r = 0.85 + R() * 0.3; x = r * Math.cos(a); z = r * Math.sin(a); y = (R() - 0.5) * 0.1; nd = Math.min(r, 1);
      } else if (shape === 5) {
        const t = i / count, a = t * Math.PI * 8; x = t * Math.cos(a); z = t * Math.sin(a); y = (t - 0.5) * 0.3; nd = t;
      }
      positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z; normDists[i] = nd;
    }
    return { positions, normDists };
  }
  // THREE.PerspectiveCamera's projection (column-major).
  function perspective(fovDeg, aspect, near, far) {
    const f = 1 / Math.tan(fovDeg * Math.PI / 360), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  // The app's font atlas (ShaderCanvas buildFontTexture): 16×16 ASCII cells of 64 px.
  let atlas = null;
  function fontAtlas() {
    if (atlas) return atlas;
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 1024);
    x.fillStyle = '#fff'; x.font = 'bold 52px monospace'; x.textBaseline = 'top';
    for (let code = 32; code < 127; code++) x.fillText(String.fromCharCode(code), (code % 16) * 64 + 6, Math.floor(code / 16) * 64 + 6);
    return (atlas = c);
  }
  const isPow2 = n => (n & (n - 1)) === 0;
  function dataBytes(src) {
    const i = src.indexOf(','), bin = atob(src.slice(i + 1)), out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  }
  // A data: URL as a blob URL (media elements seek and loop far better from one).
  function dataToBlobUrl(src) {
    if (!/^data:[^;,]+;base64,/.test(src) || typeof URL.createObjectURL !== 'function') return src;
    try { return URL.createObjectURL(new Blob([dataBytes(src)], { type: src.slice(5, src.indexOf(';')) })); } catch (e) { return src; }
  }
  // One band of an Audio Input node, as audioEngine.computeBandAmplitude: mean dB over centre ± range, −100..0 dB → 0..1.
  function bandAmplitude(freq, sampleRate, fftSize, center, range) {
    const n = freq.length, hz = sampleRate / fftSize;
    let lo, hi;
    if (range <= 0) { lo = 0; hi = n - 1; }
    else { lo = Math.max(0, Math.round((center - range) / hz)); hi = Math.min(n - 1, Math.round((center + range) / hz)); }
    if (lo > hi) lo = hi;
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += freq[i];
    return Math.max(0, Math.min(1, (sum / (hi - lo + 1) + 100) / 100));
  }

  // ── Shared inputs (one set of listeners for every embed on the page) ──────
  const shared = {
    keysHeld: new Set(),
    presses: new Map(), held: new Map(), velocities: new Map(),
    midi: Array.from({ length: 17 }, () => ({ note: 60, vel: 0, held: new Set(), bend: 0, cc: new Float32Array(128), seenNote: false, seenBend: false, seenCc: new Uint8Array(128) })),
    tilt: { got: false, alpha: 0, beta: 0, gamma: 0 },
    osc: new Map(), oscHeld: new Set(), oscWs: null, oscStatus: 'off',
    pageX: 0, pageY: 0,
    live: { status: 'off', ctx: null, source: null, analyser: null, freq: null, wave: null, sr: 48000, frame: -1, v: { level: 0, bass: 0, lowmid: 0, highmid: 0, treble: 0 }, gates: new Set(), clock: 0 },
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
      const src = ctx.createMediaStreamSource(stream);
      src.connect(an);
      // Audio Input nodes with no song listen here too, through their own analysers (see mount).
      L.ctx = ctx; L.source = src;
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
    // Feedback and echo work per pixel, and the app draws them at one device pixel per CSS pixel: so does the page.
    const perPixel = !!(B.passes && (B.passes.stateful || B.passes.echo));
    const maxDpr = opts.maxDpr || (perPixel ? 1 : bg ? 1.5 : 2);
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

    // WebGL. WebGL2 when there is one, like the app's Three.js renderer: the
    // compiled GLSL 1 source runs as GLSL 3 through the same defines Three
    // adds, feedback gets half-float targets, and images of any size get mipmaps.
    const ctxOpts = { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false };
    let gl = glCanvas.getContext('webgl2', ctxOpts);
    const gl2 = !!gl;
    if (!gl) gl = glCanvas.getContext('webgl', ctxOpts);
    if (!gl) { stage.append(el('div', 'ssp-error', 'WebGL is not available in this browser.')); return { destroy() {} }; }
    const passes = B.passes || {};
    const media = B.media || {};
    const stateful = !!passes.stateful;
    const echoCfg = passes.echo && passes.echo.copies > 0 ? passes.echo : null;
    const particleDefs = passes.particles || [];
    const VS = 'attribute vec2 position; varying vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }';
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, toGlsl(src, type === gl.VERTEX_SHADER, gl2, () => gl.getExtension('OES_standard_derivatives'))); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed'); return s; };
    // Attributes at fixed slots so every program shares one layout: 0 position, 1 a_normDist.
    const link = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'position');
      gl.bindAttribLocation(p, 1, 'a_normDist');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
      return p;
    };
    let program, blitProgram = null;
    const particles = [];
    try {
      program = link(VS, B.fragmentShader);
      if (stateful || echoCfg) blitProgram = link(VS, BLIT_FRAG);
      for (const ps of particleDefs) particles.push(Object.assign({ program: link(particleVertex(ps.vertexShader), ps.fragmentShader) }, ps));
    } catch (e) { stage.append(el('div', 'ssp-error', 'The shader did not compile here: ' + e.message)); return { destroy() {} }; }
    gl.useProgram(program);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const drawQuad = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const texture = (filter, pixel) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      if (pixel) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixel));
      return t;
    };
    const white = texture(gl.LINEAR, [255, 255, 255, 255]);
    // What an empty sampler reads in the app (Three binds a blank texture): an image input with no image, echoes before their first copy.
    const blank = texture(gl.LINEAR, [0, 0, 0, 0]);
    // Upload a canvas or video the way Three does: flipped, colours as they are.
    const upload = (t, src, mips) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (e) { /* not decodable yet */ }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      if (mips) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    };
    const locs = new Map();
    const loc = n => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(program, n)); return locs.get(n); };
    const uniformValues = Object.assign({}, B.uniforms || {});
    const setUniformAt = (l, v) => { if (!l) return; if (typeof v === 'number') gl.uniform1f(l, v); else if (Array.isArray(v)) { if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else if (v.length === 4) gl.uniform4fv(l, v); } };
    const setUniform = (n, v) => setUniformAt(loc(n), v);
    // Samplers: unit 0 the font, 1–2 the Layers node, then one unit each in the order they are first bound.
    const units = new Map([['u_fontTexture', 0], ['u_layers', 1], ['u_layersField', 2]]);
    const bindSampler = (name, tex) => {
      const l = loc(name); if (!l) return;
      let u = units.get(name);
      if (u === undefined) { u = units.size; units.set(name, u); }
      gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(l, u);
    };
    // Text nodes read the same 16×16 ASCII atlas the app builds (only drawn when the shader reads it).
    const fontTex = (B.fragmentShader.match(/\bu_fontTexture\b/g) || []).length > 1 ? texture(gl.LINEAR) : white;
    if (fontTex !== white) upload(fontTex, fontAtlas(), false);

    // Render targets for feedback and echo: half float where the GPU can draw into it (as the app), else 8 bit.
    let rtFormat = gl.RGBA, rtType = gl.UNSIGNED_BYTE, rtFilter = gl.LINEAR;
    if (stateful || echoCfg) {
      if (gl2 && gl.getExtension('EXT_color_buffer_float')) { rtFormat = gl.RGBA16F; rtType = gl.HALF_FLOAT; }
      else if (!gl2) { const h = gl.getExtension('OES_texture_half_float'); if (h && gl.getExtension('EXT_color_buffer_half_float')) { rtType = h.HALF_FLOAT_OES; if (!gl.getExtension('OES_texture_half_float_linear')) rtFilter = gl.NEAREST; } }
    }
    const makeTarget = (w, h) => {
      const tex = texture(rtType === gl.UNSIGNED_BYTE ? gl.LINEAR : rtFilter);
      gl.texImage2D(gl.TEXTURE_2D, 0, rtFormat, w, h, 0, gl.RGBA, rtType, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && rtType !== gl.UNSIGNED_BYTE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
        rtFormat = gl.RGBA; rtType = gl.UNSIGNED_BYTE;
        return makeTarget(w, h);
      }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    };
    const dropTarget = t => { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); };
    let pingPong = null, pingIdx = 0, sceneTarget = null, echoRing = [], echoFrame = 0;
    const dropTargets = () => { if (pingPong) pingPong.forEach(dropTarget); if (sceneTarget) dropTarget(sceneTarget); echoRing.forEach(dropTarget); pingPong = null; sceneTarget = null; echoRing = []; echoFrame = 0; pingIdx = 0; };
    const blitLocs = blitProgram ? { input: gl.getUniformLocation(blitProgram, 'tInput'), seed: gl.getUniformLocation(blitProgram, 'u_seed') } : null;
    // Copy a target to the screen (fb null) or into another target, with the app's dither.
    const blit = (tex, fb, w, h, seed) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, w, h);
      gl.useProgram(blitProgram);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(blitLocs.input, 0); gl.uniform1f(blitLocs.seed, seed);
      drawQuad();
    };
    // `echoRing[i]` holds the picture (i + 1) × delay frames ago, as in ShaderCanvas: every `delay`
    // frames the oldest slot becomes the newest and the frame just drawn is copied into it.
    const captureEcho = src => {
      echoFrame++;
      if (echoFrame % Math.max(1, echoCfg.delay) !== 0) return;
      echoRing.unshift(echoRing.pop());
      blit(src.tex, echoRing[0].fb, src.w, src.h, 0);
    };

    // Images: decoded onto a canvas and uploaded from there, as loadImageTexture.ts does; mipmapped, clamped.
    const blobUrls = [];
    const imageTex = new Map();
    for (const name in media.textures || {}) {
      const m = media.textures[name];
      const t = texture(gl.LINEAR, [0, 0, 0, 0]);
      imageTex.set(name, t);
      if (!m || !m.src) continue;
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d').drawImage(im, 0, 0);
        upload(t, c, gl2 || (isPow2(c.width) && isPow2(c.height)));
        needsDraw = true;
      };
      im.src = m.src;
    }
    // Videos: muted, looping, inline; uploaded whenever a new frame shows.
    const videos = [];
    for (const name in media.videos || {}) {
      const m = media.videos[name];
      const v = { name, tex: texture(gl.LINEAR, [0, 0, 0, 0]), el: null, shown: -1 };
      videos.push(v);
      if (!m || !m.src) continue;
      const e = document.createElement('video');
      e.muted = true; e.loop = m.loop !== false; e.playsInline = true; e.preload = 'auto';
      e.setAttribute('playsinline', ''); e.setAttribute('muted', '');
      const url = dataToBlobUrl(m.src); if (url !== m.src) blobUrls.push(url);
      e.src = url;
      e.addEventListener('loadedmetadata', () => { e.playbackRate = m.speed > 0 ? m.speed : 1; });
      e.addEventListener('loadeddata', () => { needsDraw = true; });
      e.addEventListener('seeked', () => { needsDraw = true; });
      v.el = e;
    }
    const uploadVideos = () => {
      for (const v of videos) {
        const e = v.el;
        if (!e || e.readyState < 2 || e.currentTime === v.shown) continue;
        v.shown = e.currentTime;
        upload(v.tex, e, false);
      }
    };
    // GPU particle systems: the app's THREE.Points, drawn additively over the picture with its camera.
    for (const p of particles) {
      const g = particleGeometry(p.count, p.shape);
      p.pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, p.pos); gl.bufferData(gl.ARRAY_BUFFER, g.positions, gl.STATIC_DRAW);
      p.dist = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, p.dist); gl.bufferData(gl.ARRAY_BUFFER, g.normDists, gl.STATIC_DRAW);
      p.locs = new Map();
    }
    const drawParticles = () => {
      const w = glCanvas.width, h = glCanvas.height;
      const proj = perspective(60, w / Math.max(1, h), 0.01, 100);
      const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3, 1]);
      // The app draws at one device pixel per CSS pixel; keep the points the same size on screen.
      const pointScale = w / Math.max(1, fitBox.clientWidth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      for (const p of particles) {
        gl.useProgram(p.program);
        const pl = n => { if (!p.locs.has(n)) p.locs.set(n, gl.getUniformLocation(p.program, n)); return p.locs.get(n); };
        gl.uniformMatrix4fv(pl('projectionMatrix'), false, proj);
        gl.uniformMatrix4fv(pl('modelViewMatrix'), false, view);
        setUniformAt(pl('ssp_pointScale'), pointScale);
        setUniformAt(pl('u_time'), time);
        for (const k in uniformValues) setUniformAt(pl(k), uniformValues[k]);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.dist); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, p.count);
      }
      gl.disable(gl.BLEND);
      gl.disableVertexAttribArray(1);
    };
    // The graph's Layers node: the layers' colour and distance field, uploaded after each frame's layers are drawn.
    const usesLayersNode = /\bu_layers(Field)?\b/.test(B.fragmentShader);
    let layersTap = null, layersColourTex = null, layersFieldTex = null, layersFieldSize = [0, 0];
    if (usesLayersNode) {
      const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0])); return t; };
      gl.activeTexture(gl.TEXTURE1);
      layersColourTex = mk(); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.activeTexture(gl.TEXTURE2);
      layersFieldTex = mk(); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.activeTexture(gl.TEXTURE0);
      // Units 1 and 2 are the Layers node's own; unit 0 keeps the font texture.
      layersTap = tap => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, layersColourTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tap.color); } catch (e) { /* tainted */ }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, layersFieldTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tap.gw, tap.gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, tap.field);
        gl.activeTexture(gl.TEXTURE0);
        layersFieldSize = [tap.gw, tap.gh];
      };
    }

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
      if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; ovCanvas.width = W; ovCanvas.height = H; needsDraw = true; dropTargets(); }
    };
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    layout();

    // Mapping engine
    const controls = new Map(play.controls.map(c => [c.id, c]));
    const layersById = new Map(play.layers.map(l => [l.id, l]));
    const base = new Map(), live = new Map(), layerLive = new Map(), smooth = new Map(), trig = new Map(), actLevel = new Map();
    const mouse = { x: 0.5, y: 0.5, down: 0, over: false };
    let time = 0, playing = true, lastNow = 0, frame = 0;
    const bindings = B.paramBindings || {};
    const uniformFor = c => bindings[bindingKey(c.target)];
    for (const c of play.controls) {
      const lt = layerTarget(c.target);
      if (lt) { const l = layersById.get(lt.layerId); if (l && typeof l[lt.key] === 'number') base.set(c.id, l[lt.key]); }
      else { const u = uniformFor(c); if (u && uniformValues[u] !== undefined) base.set(c.id, Array.isArray(uniformValues[u]) ? uniformValues[u].slice() : uniformValues[u]); }
    }
    // Layers talk back: sensors (zone fill, speed…) and where following nulls are. The layer kit (inlined ahead of this file) draws them.
    const sensors = new Map(), overrides = new Map();
    const K = typeof SSKit !== 'undefined' ? SSKit.createLayerKit() : null;
    const layerValue = (id, key, fb) => { const k = id + '::' + key; let v = overrides.get(k); if (v === undefined) v = layerLive.get(k); return v === undefined ? fb : v; };
    const value = (l, k) => layerValue(l.id, k, l[k]);
    const actions = (play.actions || []).filter(a => a.enabled);
    const allTriggers = play.mappings.filter(m => m.enabled && m.source.kind === 'trigger').map(m => m.source.trigger).concat(actions.map(a => a.trigger));
    const gamepad = i => (navigator.getGamepads ? navigator.getGamepads()[i] : null);
    const keysUsed = new Set();
    for (const m of play.mappings) {
      if (!m.enabled) continue;
      if (m.source.kind === 'key') keysUsed.add(m.source.code);
      if (m.source.kind === 'trigger' && m.source.trigger.on === 'key') keysUsed.add(m.source.trigger.code);
    }
    for (const a of actions) if (a.trigger.on === 'key') keysUsed.add(a.trigger.code);
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
        case 'audio': { const a = audioById.get(s.nodeId); if (!a || !a.an) return null; const v = a.levels[s.band]; return v === undefined ? null : v; }
        case 'live': { if (shared.live.status !== 'on') return null; updateLive(); return Math.max(0, Math.min(1, shared.live.v[s.band] * s.gain)); }
        case 'osc': { const a = shared.osc.get(s.address); if (!a) return null; const raw = a[s.arg]; const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : null; return v === null ? null : Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min))); }
        case 'null': { const l = layersById.get(s.layerId); if (!l) return null; return Math.max(0, Math.min(1, layerValue(l.id, s.axis, l[s.axis]))); }
        case 'sensor': {
          if (s.read === 'distance') {
            const a = layersById.get(s.layerId), b = layersById.get(s.otherId);
            if (!a || !b) return null;
            return Math.min(1, Math.hypot((value(a, 'x') - value(b, 'x')) * glCanvas.width / Math.max(1, glCanvas.height), value(a, 'y') - value(b, 'y')));
          }
          const v = sensors.get(s.layerId + '::' + s.read);
          return v === undefined ? null : v;
        }
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
    // Shape enter / fill triggers: a sensor crossing its threshold is a press (80% hysteresis).
    const zoneGates = new Set(), actionSeen = new Map();
    function tickZoneTriggers() {
      for (const t of allTriggers) {
        if (t.on !== 'zone' || t.event === 'click') continue;
        const k = triggerKey(t), v = sensors.get(t.layerId + '::' + (t.event === 'enter' ? 'hover' : 'fill')) || 0, th = t.event === 'enter' ? 0.5 : t.threshold, open = zoneGates.has(k);
        if (!open && v >= th) { zoneGates.add(k); press(k); }
        else if (open && v < th * 0.8) { zoneGates.delete(k); release(k); }
      }
    }
    // Actions (burst, next line, drop…): once per new press of their trigger.
    function tickActions() {
      for (const a of actions) {
        const presses = a.trigger.on === 'beat' ? beatAt(a.trigger.bpm, a.trigger.beats, time).count : shared.presses.get(triggerKey(a.trigger)) || 0;
        const seen = actionSeen.get(a.id);
        actionSeen.set(a.id, presses);
        if (seen === undefined || presses <= seen || !K) continue;
        for (let i = 0; i < Math.min(4, presses - seen); i++) K.act(a);
      }
    }
    function tickMappings(dt) {
      tickAudioTriggers();
      tickZoneTriggers();
      tickActions();
      const driven = new Set();
      let moved = false;
      for (const m of play.mappings) {
        if (!m.enabled) continue;
        const c = controls.get(m.controlId); if (!c) continue;
        const u = m.source.kind === 'trigger' ? readTrigger(m, dt) : readSource(m.source);
        if (u === null) continue;
        const target = m.outMin + (m.outMax - m.outMin) * curve(u, m);
        let v = smooth.get(m.id);
        if (m.smoothMs <= 0 || v === undefined) v = target;
        else { const a = 1 - Math.exp(-(dt * 1000) / m.smoothMs); v = v + (target - v) * a; if (Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(m.outMax - m.outMin))) v = target; }
        if (smooth.get(m.id) !== v) moved = true;
        smooth.set(m.id, v);
        const at = actTarget(c.target);
        if (at) {
          // Fires once each time its mapping rises through the middle (a key down, a click, a beat).
          const was = actLevel.get(c.id) || 0;
          actLevel.set(c.id, v);
          if (v >= 0.5 && was < 0.5 && K) { K.act({ do: at.do, layerId: at.layerId, amount: c.amount || 1 }); needsDraw = true; }
          live.set(c.id, v); driven.add(c.id); continue;
        }
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
        moved = true;
        actLevel.delete(id);
        const c = controls.get(id); const lt = c && layerTarget(c.target);
        if (lt) layerLive.delete(lt.layerId + '::' + lt.key); else if (c) { const un = uniformFor(c); if (un && base.has(id)) uniformValues[un] = base.get(id); }
        live.delete(id);
      }
      return moved;
    }

    // Audio Input nodes: the embedded song, or with none, the live input once the visitor enables it.
    // Browsers start sound only after a gesture: the player has a button, a background listens (silently) from the first click or key on the page.
    const audioNodes = (media.audio || []).map(a => Object.assign({ an: null, freq: null, levels: [], via: null }, a));
    const audioById = new Map(audioNodes.map(a => [a.id, a]));
    const songs = audioNodes.filter(a => a.src);
    const song = { ctx: null, out: null, started: false };
    function startSongs(audible) {
      if (!songs.length) return;
      if (!song.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        song.ctx = new AC(); song.out = song.ctx.createGain(); song.out.connect(song.ctx.destination);
      }
      song.out.gain.value = audible ? 0.7 : 0;
      if (song.ctx.state === 'suspended' && playing) song.ctx.resume();
      if (song.started) return;
      song.started = true;
      for (const a of songs) {
        song.ctx.decodeAudioData(dataBytes(a.src).buffer).then(buf => {
          if (!alive) return;
          const src = song.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
          const an = song.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
          src.connect(an); an.connect(song.out); src.start();
          a.an = an; a.freq = new Float32Array(an.frequencyBinCount); a.via = song.ctx;
        }, () => { /* not decodable in this browser */ });
      }
    }
    // Band amplitudes into the shader, as ShaderCanvas does with audioEngine.tick().
    function tickAudioNodes() {
      const L = shared.live;
      for (const a of audioNodes) {
        if (!a.src && L.status === 'on' && L.source && a.via !== L.source) {
          const an = L.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
          L.source.connect(an);
          a.an = an; a.freq = new Float32Array(an.frequencyBinCount); a.via = L.source;
        }
        if (!a.an) continue;
        a.an.getFloatFrequencyData(a.freq);
        const sr = a.an.context.sampleRate;
        if (a.mode === 'full') { a.levels.length = 1; a.levels[0] = bandAmplitude(a.freq, sr, a.an.fftSize, 0, 0); }
        else for (let i = 0; i < a.bands.length; i++) a.levels[i] = bandAmplitude(a.freq, sr, a.an.fftSize, a.bands[i], a.range);
        for (let i = 0; i < a.uniforms.length; i++) if (a.uniforms[i] && a.levels[i] !== undefined) uniformValues[a.uniforms[i]] = a.levels[i];
      }
    }
    const setPlaying = on => {
      playing = on;
      if (song.ctx) { if (on) song.ctx.resume(); else song.ctx.suspend(); }
      needsDraw = true;
    };

    // Pointer. Player: on the picture (drag nulls, clicks are the mouse trigger). Background: the whole page, never captured.
    let drag = null, pictureDown = false, pressedZone = null;
    const zoneAt = u => K ? K.shapeAt(play, u.x, u.y, u.w / Math.max(1, u.h), value) : null;
    const pressZoneAt = u => { const id = zoneAt(u); if (id) { pressedZone = id; press('zone:' + id + ':click'); } };
    const releaseZone = () => { if (pressedZone) { release('zone:' + pressedZone + ':click'); pressedZone = null; } };
    const toUnit = (cx, cy) => { const r = fitBox.getBoundingClientRect(); return { x: (cx - r.left) / Math.max(1, r.width), y: 1 - (cy - r.top) / Math.max(1, r.height), w: r.width, h: r.height }; };
    const clampedMouse = (cx, cy) => { const u = toUnit(cx, cy); mouse.x = Math.max(0, Math.min(1, u.x)); mouse.y = Math.max(0, Math.min(1, u.y)); mouse.over = u.x >= 0 && u.x <= 1 && u.y >= 0 && u.y <= 1; return u; };
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
        pressZoneAt(u);
        press('mouse'); pictureDown = true;
      });
      const up = () => { mouse.down = 0; drag = null; releaseZone(); if (pictureDown) { pictureDown = false; release('mouse'); } };
      on(stage, 'pointerup', up); on(stage, 'pointercancel', up);
      on(stage, 'pointerleave', () => { mouse.over = false; });
    } else {
      on(window, 'pointerdown', e => {
        const u = toUnit(e.clientX, e.clientY);
        mouse.down = 1;
        if (u.x >= 0 && u.x <= 1 && u.y >= 0 && u.y <= 1) { pressZoneAt(u); press('mouse'); pictureDown = true; }
      }, { passive: true });
      on(window, 'pointerup', () => { mouse.down = 0; releaseZone(); if (pictureDown) { pictureDown = false; release('mouse'); } }, { passive: true });
      if (songs.length) { const go = () => startSongs(false); on(window, 'pointerdown', go, { passive: true }); on(window, 'keydown', go); }
    }

    // Panel (player only)
    const readouts = new Map();
    const usesMidi = play.mappings.some(m => m.source.kind === 'midi' || (m.source.kind === 'trigger' && m.source.trigger.on === 'note'));
    const usesOsc = play.mappings.some(m => m.source.kind === 'osc' || (m.source.kind === 'trigger' && m.source.trigger.on === 'osc'));
    const usesTilt = play.mappings.some(m => m.source.kind === 'tilt');
    const usesLive = play.mappings.some(m => m.source.kind === 'live' || (m.source.kind === 'trigger' && m.source.trigger.on === 'audio'))
      || actions.some(a => a.trigger.on === 'audio') || play.layers.some(l => l.kind === 'audio' && l.visible) || audioNodes.some(a => !a.src);
    const usesCamera = play.layers.some(l => l.visible && (l.kind === 'camera' || ((l.kind === 'particles' || l.kind === 'glyphs' || l.kind === 'contours') && l.readFrom === 'camera')));
    let camVideo = null;
    const fmt = (v, step) => { const d = step && step >= 1 ? 0 : step && step >= 0.1 ? 1 : step && step >= 0.01 ? 2 : 3; return Number(v).toFixed(d); };
    const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
    if (!bg) {
      const head = el('div', 'ssp-head');
      head.append(el('b', null, B.title || 'Shader Studio'));
      const tools = el('div', 'ssp-tools');
      const pp = el('button', 'ssp-btn', 'Pause');
      pp.onclick = () => { setPlaying(!playing); pp.textContent = playing ? 'Pause' : 'Play'; };
      tools.append(pp);
      if (songs.length) {
        const b = el('button', 'ssp-btn', 'Play sound');
        b.title = songs.length === 1 ? 'Plays the song the picture reacts to' : 'Plays the songs the picture reacts to';
        let audible = false;
        b.onclick = () => { audible = !audible; startSongs(audible); b.textContent = audible ? 'Mute' : 'Unmute'; };
        tools.append(b);
      }
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
      if (usesCamera && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const b = el('button', 'ssp-btn', 'Enable camera');
        b.onclick = () => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(stream => {
          const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = stream;
          v.play().catch(() => {});
          camVideo = v; b.textContent = 'Camera on'; b.disabled = true;
          listeners.push(() => stream.getTracks().forEach(t => t.stop()));
        }, () => { b.textContent = 'Camera blocked'; });
        tools.append(b);
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
        const at = actTarget(c.target);
        if (at) {
          // A button: press it to fire the action.
          const b = el('button', 'ssp-btn', c.label);
          b.onclick = () => { if (K) { K.act({ do: at.do, layerId: at.layerId, amount: c.amount || 1 }); needsDraw = true; } };
          row.replaceChildren(b);
          panel.append(row);
          continue;
        }
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
        r.input.parentElement.classList.toggle('ssp-driven', driven);
        // A driven colour stays editable: mappings scale it or set one channel, starting from what the picker says.
        if (r.kind === 'color') { r.out.textContent = driven ? hex(v) : ''; continue; }
        r.input.disabled = driven;
        if (driven) { r.input.value = v; r.out.textContent = fmt(v, r.step); }
      }
    };

    // Layers: the layer kit draws them all (the same code as the app).
    const octx = ovCanvas.getContext('2d');
    const images = new Map();
    const img = src => { if (!src) return null; let i = images.get(src); if (!i) { i = new Image(); i.onload = () => { needsDraw = true; }; i.src = src; images.set(src, i); } return i.complete && i.naturalWidth ? i : null; };
    const hidden = !!(play.display && play.display.picture === false);
    const audioLayer = play.layers.some(l => l.kind === 'audio' && l.visible);
    const pointer = { x: 0.5, y: 0.5, over: false, down: false };
    function drawLayers(dt) {
      if (!K) return;
      const W = ovCanvas.width, H = ovCanvas.height, dpr = W / Math.max(1, fitBox.clientWidth);
      const L = shared.live;
      if (audioLayer && L.status === 'on') updateLive();
      pointer.x = mouse.x; pointer.y = mouse.y; pointer.over = mouse.over; pointer.down = !!mouse.down;
      K.frame(octx, play, {
        gl: glCanvas, W, H, dpr, time, dt, value, pointer, markers, editing: false, hidden,
        backdrop: play.display ? play.display.backdrop : [0, 0, 0],
        audio: L.status === 'on' ? { wave: L.wave, freq: L.freq, sampleRate: L.sr } : null,
        camera: camVideo, image: img,
        sensor: (k, v) => sensors.set(k, v),
        override: (id, k, v) => { if (v === null) overrides.delete(id + '::' + k); else overrides.set(id + '::' + k, v); },
        shaderTap: layersTap || undefined,
      });
    }

    // Visibility: a background pauses off-screen and in hidden tabs; reduced motion gets a still frame.
    let onScreen = true;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); if (onScreen) needsDraw = true; }) : null;
    if (io) io.observe(root);
    const reduced = stillForReducedMotion && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const inst = { mode, claimsKey: code => keysUsed.has(code) };
    shared.instances.add(inst);

    let raf = 0, alive = true;
    let videosRunning = null;
    const runVideos = run => {
      if (run === videosRunning) return;
      videosRunning = run;
      for (const v of videos) if (v.el) { if (run) { const p = v.el.play(); if (p && p.catch) p.catch(() => {}); } else v.el.pause(); }
    };
    // The graph's picture: straight to the screen, or (feedback, echo) into a half-float target, then dithered to the screen as ShaderCanvas does.
    function drawPicture() {
      const W = glCanvas.width, H = glCanvas.height;
      let target = null;
      if (stateful || echoCfg) {
        if (stateful && !pingPong) pingPong = [makeTarget(W, H), makeTarget(W, H)];
        if (!stateful && !sceneTarget) sceneTarget = makeTarget(W, H);
        if (echoCfg && echoRing.length !== echoCfg.copies) { echoRing.forEach(dropTarget); echoRing = []; for (let i = 0; i < echoCfg.copies; i++) echoRing.push(makeTarget(W, H)); }
        target = stateful ? pingPong[1 - pingIdx] : sceneTarget;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(program);
      setUniform('u_time', time);
      setUniform('u_resolution', [W, H]);
      setUniform('u_mouse', [mouse.x * W, mouse.y * H]);
      for (const k in uniformValues) setUniform(k, uniformValues[k]);
      bindSampler('u_fontTexture', fontTex);
      if (usesLayersNode) {
        bindSampler('u_layers', layersColourTex); bindSampler('u_layersField', layersFieldTex);
        const ls = loc('u_layersFieldSize'); if (ls) gl.uniform2fv(ls, layersFieldSize);
      }
      if (stateful) bindSampler('u_prevFrame', pingPong[pingIdx].tex);
      if (echoCfg) for (let i = 0; i < 6; i++) bindSampler('u_echo' + i, echoRing[i] ? echoRing[i].tex : blank);
      for (const [n, t] of imageTex) bindSampler(n, t);
      for (const v of videos) bindSampler(v.name, v.tex);
      drawQuad();
      if (target) {
        if (echoCfg) captureEcho(target);
        blit(target.tex, null, W, H, ditherSeed(frame));
        if (stateful) pingIdx = 1 - pingIdx;
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    function tick(now) {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      runVideos(playing && !reduced && !document.hidden && !(bg && !onScreen));
      if ((bg && !onScreen) || document.hidden) return;
      if (reduced && !needsDraw && frame > 0) return;
      if (playing && !reduced) time += dt;
      frame++;
      shared.live.clock++;
      if (bg && followPage) clampedMouse(shared.pageX, shared.pageY);
      tickAudioNodes();
      const moved = tickMappings(dt);
      // Feedback and echo change with every frame drawn, so while paused they draw only when something changes (as in the app).
      if (!playing && (stateful || echoCfg) && !needsDraw && !moved && frame > 1) { refreshPanel(now); return; }
      needsDraw = false;
      uploadVideos();
      // Reduced motion's still frame of a feedback graph is the picture after its first 1.5 s
      // (90 frames at 60 fps), which is what the feedback looks like once it has built up.
      if (reduced && stateful && frame === 1) for (let i = 0; i < 89; i++) { drawPicture(); time += 1 / 60; }
      drawPicture();
      if (particles.length) drawParticles();
      if (play.layers.length || hidden || usesLayersNode) drawLayers(dt);
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
        for (const v of videos) if (v.el) { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); }
        for (const u of blobUrls) URL.revokeObjectURL(u);
        if (song.ctx) song.ctx.close();
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        root.innerHTML = '';
        root.classList.remove('ssp', 'ssp-bg');
      },
      pause() { setPlaying(false); },
      play() { setPlaying(true); },
    };
  }

  // internals: the pure GPU and audio helpers, for tests.
  window.ShaderStudioPlay = { version: 3, mount, internals: { toGlsl, particleGeometry, perspective, bandAmplitude, particleVertex } };

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
