/*
 * play-runtime.js — the standalone Shader Studio player, inlined into web
 * exports (a full HTML page or a paste-in embed snippet). Plain ES2020, no
 * imports, no framework.
 *
 *   ShaderStudioPlay.mount(element, bundle, options) → { destroy(), pause(), play(), get(id), set(id, v), fire(id), still(), renderAt(t, o) }
 *
 * bundle:  { title, fragmentShader, uniforms, paramBindings, play, aspect, passes?, media? }
 *   passes: { stateful, echo: { copies, delay } | null, particles: [{ vertexShader, fragmentShader, count, shape }] }
 *   datasets: { [id]: { name, result, stream? } }  each dataset's frozen result; `stream`
 *             ({ transport: 'poll' | 'websocket' | 'sse', address, interval, mode, window, format?,
 *             normalize }) makes the page reconnect to a live feed and add its rows (needs the network)
 *   media:  { textures: { uniform: { src } }, videos: { uniform: { src, loop, speed } },
 *             audio: [{ id, src, uniforms, bands, range, mode }] }   (src: a data URL, or null)
 *   play.display.source 'image' | 'video' | 'colour': that background (display.image,
 *             display.video, display.backdrop) in place of the shader, which then never
 *             compiles or draws; the layers read the background as the picture
 *   play.layers[0] a Background layer: its queue decides instead (the layer kit's queue.js
 *             says what shows); the page's own shader runs only while "this graph" shows
 *   play.layers[i] a Video layer carries its file as `src` (a data URL, or '' when it stayed out);
 *             its sound joins the audio readers (`audioReaders.input` 'video:<id>') after a first click
 *   backgroundGraphs: { [sourceId]: { fragmentShader, uniforms } }  the queue's other
 *             graphs, each linked on first show and drawn only while it shows
 * options: {
 *   mode: 'player' | 'background',   player shows the controls; background is the picture only
 *   fit: 'contain' | 'cover',        contain keeps the exported shape (letterbox); cover fills the box
 *   followPage: boolean,             background: the mouse is tracked over the whole page
 *   markers: boolean,                show null markers (player default true, background false)
 *   stillForReducedMotion: boolean,  honour prefers-reduced-motion with a still frame (default true)
 *   maxDpr: number,                  cap on device pixels per CSS pixel (default 2, background 1.5, feedback or echo 1)
 *   panel: boolean,                  player: draw the controls panel (default true); the host can draw its own with get/set/fire
 *   pointer: boolean,                player: the pointer reaches the picture (default true); off, the page scrolls over it
 *   startTime: number,               seconds on the clock at the start
 *   paused: boolean,                 start with the clock stopped (a still at startTime)
 *   pauseOffscreen: boolean,         player: stop drawing while off-screen (a background always does)
 *   pixelSize: { w, h },             draw exactly this many pixels, however big the box is on screen
 *                                    (the capture window: 1920 × 1080 shown scaled down)
 * }
 *
 * The control API (for a host drawing its own panel): get(id) → { value, driven }
 * (the value a mapping gives it while one drives it), set(id, value) as if its
 * slider or colour moved, fire(id) presses an action control, still() → a PNG
 * data URL of the picture with its layers; hasSound / sound(on) play the graph's
 * songs (what the panel's Play sound button does); usesCamera says whether a
 * layer reads the camera (ShaderStudioPlay.enableCamera() lights it for every
 * mount on the page); setScript(layerId, code) replaces one Script layer's
 * code in this mount only (it re-runs on the next frame), and the
 * onScript(layerId, error) option hears whether each Script layer compiled
 * and ran (error null) or what broke.
 *
 * A full-page export built with the option host: true also takes
 * { ssp: 'script', layerId, code } messages from the page that framed it and
 * posts { ssp: 'scriptStatus', layerId, error } back, so a host can live-edit
 * a Script layer across a sandboxed frame.
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
 * Hand tracking runs only in pages exported with "Include hand tracking": the
 * bundle's `hands` then carries MediaPipe and the hand model (gzipped), which
 * the first Enable hands click unpacks into a worker (ShaderStudioPlay.
 * enableHands() does the same for a host's own button). The landmarks are
 * read by the kit's hands.js, the same code the app runs.
 *
 * The trigger, noise and envelope maths mirror src/play/triggers.ts.
 */
(function () {
  'use strict';
  if (window.ShaderStudioPlay && window.ShaderStudioPlay.version >= 8) return;

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
@media (max-width:720px){.ssp:not(.ssp-bg){flex-direction:column}.ssp:not(.ssp-bg):not(.ssp-bare) .ssp-stage{flex:0 0 56%}.ssp-panel{width:auto;flex:1;border-left:0;border-top:1px solid #26272f}}
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
    switch (t.on) { case 'key': return 'key:' + t.code; case 'note': return 'note:' + t.channel + ':' + (t.note < 0 ? '*' : t.note); case 'mouse': return 'mouse'; case 'osc': return 'osc:' + t.address; case 'beat': return 'beat:' + t.bpm + ':' + t.beats; case 'audio': return 'audio:' + t.band + ':' + t.threshold; case 'zone': return t.event === 'fill' ? 'zone:' + t.layerId + ':fill:' + t.threshold : 'zone:' + t.layerId + ':' + t.event; case 'hand': return 'hand:' + t.side + ':' + t.gesture; case 'proximity': return 'prox:' + t.a + ':' + t.b + ':' + t.when + ':' + t.distance + ':' + t.margin; case 'reader': return 'reader:' + t.readerId + ':' + t.threshold + ':' + t.hysteresis; }
    return '';
  }
  // Firing modes (once, held, every N frames or seconds, on release): how many times a trigger fires this frame.
  function stepFire(st, fire, presses, gate, dt) {
    const fresh = Math.max(0, presses - st.seen); st.seen = presses;
    const was = st.held; st.held = gate;
    const mode = fire && fire.mode ? fire.mode : 'once';
    if (mode === 'once') return fresh;
    if (mode === 'release') return Math.max(0, (was ? 1 : 0) + fresh - (gate ? 1 : 0));
    if (mode === 'held') return gate || fresh > 0 ? 1 : 0;
    if (fresh > 0) { st.since = 0; return 1; }
    if (!gate) { st.since = 0; return 0; }
    st.since += fire.unit === 'frames' ? 1 : dt;
    const period = fire.unit === 'frames' ? Math.max(1, Math.round(fire.every)) : Math.max(0.01, fire.every);
    if (st.since < period - 1e-6) return 0;
    const n = Math.floor((st.since + 1e-6) / period); st.since -= n * period;
    return n;
  }
  // A firing-mode slot per action or trigger mapping; a changed mode starts from "nothing yet".
  function fireSlot(map, id, t, presses, gate) {
    const mode = t.fire && t.fire.mode ? t.fire.mode : 'once';
    const slot = map.get(id);
    if (slot && slot.mode === mode) return { slot, fresh: false };
    const made = { mode, st: { seen: presses, held: gate, since: 0 }, count: 0 };
    map.set(id, made);
    return { slot: made, fresh: true };
  }
  function proximityGate(open, d, when, distance, margin) {
    if (d === null) return false;
    if (when === 'closer') return open ? d <= distance + margin : d < distance;
    return open ? d >= distance - margin : d > distance;
  }
  function handAnchorOf(ref) { const m = /^hand:(left|right|any):(\d{1,2})$/.exec(ref); return m && +m[2] <= 20 ? { side: m[1], point: +m[2] } : null; }
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
  // A layer property (layer:<id>::<key>), or a Finish effect's number (finish:<effectId>::<key>, kept under the id 'finish:<effectId>').
  function layerTarget(t) {
    const fin = t.startsWith('finish:');
    if (!fin && !t.startsWith('layer:')) return null;
    const r = t.slice(fin ? 7 : 6); const i = r.lastIndexOf('::');
    return i > 0 ? { layerId: (fin ? 'finish:' : '') + r.slice(0, i), key: r.slice(i + 2) } : null;
  }
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
  // With an image, a video or a colour background the graph's shader is never compiled: this stands in, and never draws.
  const BG_ONLY_FRAG = 'precision mediump float;\nvoid main(){ gl_FragColor = vec4(0.0); }';
  /** Where a video background is at `time` seconds (types/play.ts videoTimeAt). */
  function videoTimeAt(time, duration, rate, loop) {
    if (!(duration > 0) || !isFinite(duration)) return 0;
    const t = Math.max(0, time) * (rate > 0 ? rate : 1);
    return loop ? t % duration : Math.min(t, Math.max(0, duration - 0.001));
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
    camera: null, cameraStream: null,
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

  // Audio readers: a band around a frequency as 0..1, smoothed. Mirrors src/play/audioReaders.ts.
  const READER_REF_DB = -10, READER_RANGE_DB = 40;
  function readerBandDb(freq, sr, lo, hi) {
    const n = freq.length, binHz = sr / 2 / n;
    if (n < 2) return -160;
    const a = Math.max(0.5, Math.min(lo, hi) / binHz), b = Math.min(n - 0.5, Math.max(lo, hi) / binHz);
    if (b <= a) return -160;
    let w = 0, p = 0;
    for (let k = Math.max(1, Math.floor(a + 0.5)); k <= Math.min(n - 1, Math.floor(b + 0.5)); k++) {
      const o = Math.min(b, k + 0.5) - Math.max(a, k - 0.5);
      if (o <= 0) continue;
      const db = freq[k];
      p += o * Math.pow(10, (isFinite(db) ? Math.max(-160, db) : -160) / 10); w += o;
    }
    return w > 0 ? 10 * Math.log10(Math.max(1e-16, p / w)) : -160;
  }
  function readerRead(r, freq, sr) {
    const half = Math.pow(2, Math.max(0.05, Math.min(4, r.width)) / 2);
    const top = READER_REF_DB - r.gain;
    return Math.max(0, Math.min(1, (readerBandDb(freq, sr, r.hz / half, r.hz * half) - (top - READER_RANGE_DB)) / READER_RANGE_DB));
  }
  function readerSmooth(prev, target, dt, attack, rel) {
    const tau = target > prev ? attack : rel;
    if (tau <= 0 || dt <= 0) return tau <= 0 ? target : prev;
    return prev + (target - prev) * (1 - Math.exp(-(dt * 1000) / tau));
  }
  function readerGate(open, v, threshold, hysteresis) { return open ? v > threshold - hysteresis : v >= threshold; }

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
    const showPanel = !bg && opts.panel !== false;
    const pointerOn = !bg && opts.pointer !== false;
    const pauseOffscreen = bg || !!opts.pauseOffscreen;
    // The layers are this mount's own copies: dragging a null or replacing a script never reaches the bundle.
    const play0 = B.play || { controls: [], mappings: [], layers: [] };
    const play = Object.assign({}, play0, { layers: (play0.layers || []).map(l => Object.assign({}, l)) });
    // Play's background: an image, a video or a colour in place of the shader. Then the graph never
    // compiles or draws here; the layer kit paints the background and reads it as the picture.
    // A Background layer (always the first) decides instead: the shader runs only while "this graph" shows.
    const queueLayer = play.layers[0] && play.layers[0].kind === 'background' ? play.layers[0] : null;
    const queueHasThis = !!queueLayer && (queueLayer.sources || []).some(s => s.kind === 'graph' && s.graph === 'this');
    const bgDisp = queueLayer ? {} : play.display || {};
    const bgSource = bgDisp.source === 'image' || bgDisp.source === 'video' || bgDisp.source === 'colour' ? bgDisp.source : 'shader';
    const bgOnly = queueLayer ? !queueHasThis : bgSource !== 'shader';
    const onScript = typeof opts.onScript === 'function' ? opts.onScript : null;
    const scriptErrors = new Map();
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
    // The Finish stack (the kit's finish.js): its own WebGL2 canvas over both, and the markers above it.
    const FK = typeof SSKit !== 'undefined' && SSKit.finish ? SSKit.finish : null;
    const finishOn = !!(FK && FK.active(play0.finish));
    let finishR = null, fnCanvas = null, guideCanvas = null;
    if (finishOn) {
      fnCanvas = el('canvas', 'ssp-overlay'); fnCanvas.style.display = 'none';
      guideCanvas = el('canvas', 'ssp-overlay');
      fitBox.append(fnCanvas, guideCanvas);
      finishR = FK.create(fnCanvas);
      if (!finishR.ok) finishR = null;
    }
    stage.append(fitBox);
    root.append(stage);
    const panel = el('div', 'ssp-panel');
    if (showPanel) root.append(panel); else if (!bg) root.classList.add('ssp-bare');
    if (bg) { root.style.pointerEvents = 'none'; glCanvas.setAttribute('aria-hidden', 'true'); }
    if (!bg && !pointerOn) stage.style.touchAction = 'auto';

    // WebGL. WebGL2 when there is one, like the app's Three.js renderer: the
    // compiled GLSL 1 source runs as GLSL 3 through the same defines Three
    // adds, feedback gets half-float targets, and images of any size get mipmaps.
    const ctxOpts = { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false };
    let gl = glCanvas.getContext('webgl2', ctxOpts);
    const gl2 = !!gl;
    if (!gl) gl = glCanvas.getContext('webgl', ctxOpts);
    if (!gl) { stage.append(el('div', 'ssp-error', 'WebGL is not available in this browser.')); return { destroy() {} }; }
    const passes = bgOnly ? {} : B.passes || {};
    const media = bgOnly ? { audio: (B.media || {}).audio } : B.media || {};
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
      program = link(VS, bgOnly ? BG_ONLY_FRAG : B.fragmentShader);
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
    let fontTex = !bgOnly && (B.fragmentShader.match(/\bu_fontTexture\b/g) || []).length > 1 ? texture(gl.LINEAR) : white;
    if (fontTex !== white) upload(fontTex, fontAtlas(), false);

    // Datasets (B.datasets: each one's frozen result and name, never the notebook). Data layers and
    // s.data() read them by id or name; Data nodes read their columns as float textures.
    const datasets = B.datasets || {};
    const dsEntry = ref => {
      if (ref == null) return null;
      const key = String(ref);
      if (datasets[key]) return { id: key, name: datasets[key].name, result: datasets[key].result || null };
      const want = key.trim().toLowerCase();
      for (const id in datasets) if (String(datasets[id].name || '').trim().toLowerCase() === want) return { id, name: datasets[id].name, result: datasets[id].result || null };
      return null;
    };
    const dsResult = id => (datasets[id] && datasets[id].result) || null;
    // A Data node's columns, four to a texel, row i at texel (i % 1024, i / 1024), as the app packs them
    // (src/data/texturePack.ts): numbers as they are, a category as its place among the values, the rest 0.
    const dataTexture = (id, cols) => {
      const r = dsResult(id), rows = r && r.kind === 'table' ? r.rows : 0;
      const w = Math.min(Math.max(1, rows), 1024), h = Math.ceil(Math.max(1, rows) / 1024);
      const data = new Float32Array(w * h * 4);
      cols.slice(0, 4).forEach((name, ch) => {
        const c = r && r.kind === 'table' ? r.columns.find(x => x.name === name) : null;
        if (!c) return;
        const codes = new Map();
        for (let i = 0; i < rows; i++) {
          const v = c.values[i];
          if (v == null) continue;
          if (c.type === 'number') data[i * 4 + ch] = +v || 0;
          else if (c.type === 'category') { let k = codes.get(v); if (k === undefined) { k = codes.size; codes.set(v, k); } data[i * 4 + ch] = k; }
        }
      });
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
      return t;
    };
    const dataTex = [], dataCounts = [];
    if (!bgOnly && gl2 && /u_ds_/.test(B.fragmentShader)) {
      const seenU = new Set();
      let m;
      const reT = /uniform\s+sampler2D\s+(u_ds_\w+)\s*;\s*\/\/\s*data-columns\s+([a-z][a-z0-9]*)\s+(\S*)/g;
      while ((m = reT.exec(B.fragmentShader))) { if (seenU.has(m[1])) continue; seenU.add(m[1]); const cols = m[3] ? m[3].split(',').map(c => decodeURIComponent(c)) : []; dataTex.push({ name: m[1], id: m[2], cols, tex: dataTexture(m[2], cols) }); }
      const reN = /uniform\s+float\s+(u_ds_\w+_n)\s*;\s*\/\/\s*data-count\s+([a-z][a-z0-9]*)/g;
      while ((m = reN.exec(B.fragmentShader))) { if (seenU.has(m[1])) continue; seenU.add(m[1]); const r = dsResult(m[2]); dataCounts.push({ name: m[1], id: m[2], n: r && r.kind === 'table' ? r.rows : 0 }); }
    }

    // Live datasets (a stream exported with Reconnect): the page connects to the same feed and adds each
    // message's rows to the window it carried (or replaces it), as the app's stream does (src/data/streams).
    // Data layers and s.data() read the new result; Data nodes' textures and counts are made again.
    const feedClosers = [];
    const liveFeeds = () => {
      const records = r => {
        if (!r || r.kind !== 'table') return [];
        return Array.from({ length: r.rows }, (_, i) => { const o = {}; for (const c of r.columns) o[c.name] = c.values[i] == null ? null : c.values[i]; return o; });
      };
      const column = (name, values) => {
        const present = values.filter(v => v != null);
        if (present.every(v => typeof v === 'number' && isFinite(v))) {
          let min = Infinity, max = -Infinity;
          for (const v of present) { if (v < min) min = v; if (v > max) max = v; }
          if (min === Infinity) { min = 0; max = 0; }
          return { name, type: 'number', values: values.map(v => (typeof v === 'number' && isFinite(v) ? v : null)), min, max };
        }
        if (present.every(v => typeof v === 'string' || typeof v === 'boolean')) return { name, type: 'category', values: values.map(v => (v == null ? null : String(v))) };
        return { name, type: 'other', values };
      };
      const toTable = (rows, normalize) => {
        const names = [];
        for (const r of rows) for (const k in r) if (!names.includes(k)) names.push(k);
        let columns = names.map(n => column(n, rows.map(r => (r[n] === undefined ? null : r[n]))));
        // Normalize 0–1 as the app does: each number column from its min…max, unless it's already within 0–1.
        if (normalize) columns = columns.map(c => (c.type !== 'number' || (c.min >= 0 && c.max <= 1)) ? c : { ...c, values: c.values.map(v => (v == null ? null : c.max > c.min ? (v - c.min) / (c.max - c.min) : 0)), min: 0, max: c.max > c.min ? 1 : 0 });
        return { kind: 'table', rows: rows.length, columns };
      };
      const flat = o => { const out = {}; for (const k in o) { const v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v)) { for (const k2 in v) out[k + '.' + k2] = v[k2]; } else out[k] = v; } return out; };
      const isRec = v => v && typeof v === 'object' && !Array.isArray(v);
      const jsonRows = v => {
        if (Array.isArray(v)) return v.length && v.every(x => typeof x === 'number' || x === null) ? [Object.fromEntries(v.map((x, i) => ['c' + (i + 1), x]))] : v.filter(isRec).map(flat);
        if (isRec(v)) {
          const arrays = Object.entries(v).filter(([, a]) => Array.isArray(a) && a.length && a.every(isRec));
          const pick = arrays.find(([k]) => ['rows', 'data', 'records', 'items', 'results', 'features'].includes(k)) || (arrays.length === 1 ? arrays[0] : null);
          if (pick) return pick[1].map(r => flat(pick[0] === 'features' && isRec(r.properties) ? r.properties : r));
          return [flat(v)];
        }
        return typeof v === 'number' ? [{ value: v }] : [];
      };
      const field = f => { const t = f.trim(); if (t === '' || /^(na|n\/a|nan|null|none|-)$/i.test(t)) return null; const n = Number(t.replace(/,(?=\d{3}\b)/g, '')); return isFinite(n) && /\d/.test(t) ? n : t === 'true' ? true : t === 'false' ? false : t; };
      const messageRows = (text, st, format) => {
        text = String(text).trim();
        if (!text) return [];
        if (format === 'text') return text.split(/\r?\n/).filter(Boolean).map(line => ({ text: line }));
        if (format !== 'csv' && format !== 'tsv' && (format === 'json' || text[0] === '{' || text[0] === '[')) {
          try { return jsonRows(JSON.parse(text)); } catch (e) {
            try { return text.split(/\r?\n/).filter(l => l.trim()).flatMap(l => jsonRows(JSON.parse(l))); } catch (e2) { if (format === 'json') return []; }
          }
        }
        const d = format === 'tsv' || text.includes('\t') ? '\t' : ',';
        const out = [];
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const f = line.split(d);
          if (st.header && f.length === st.header.length && f.every((x, i) => x.trim() === st.header[i])) continue;
          if (!st.header && f.every(x => x.trim() !== '' && field(x) !== null && typeof field(x) !== 'number')) { st.header = f.map((x, i) => x.trim() || 'c' + (i + 1)); continue; }
          const names = st.header || f.map((_, i) => 'c' + (i + 1));
          const row = {};
          f.forEach((x, i) => { row[names[i] || 'c' + (i + 1)] = field(x); });
          out.push(row);
        }
        return out;
      };
      for (const id in datasets) {
        const cfg = datasets[id].stream;
        if (!cfg || !cfg.address) continue;
        // A live dataset's window comes raw (not normalized), so new rows can join it; Normalize is applied here.
        let rows = records(datasets[id].result);
        const st = { header: null };
        const windowN = Math.max(1, cfg.window || 1000);
        const show = () => {
          const r = toTable(rows, cfg.normalize);
          datasets[id].result = r;
          for (const d of dataTex) if (d.id === id) { gl.deleteTexture(d.tex); d.tex = dataTexture(id, d.cols); }
          for (const c of dataCounts) if (c.id === id) c.n = r.rows;
        };
        const put = got => {
          if (!got.length) return;
          rows = cfg.mode === 'replace' ? got.slice(-windowN) : rows.concat(got).slice(-windowN);
          show();
        };
        if (cfg.normalize) show();
        const onMessage = data => { try { put(messageRows(data, st, cfg.format)); } catch (e) { /* a message that doesn't read is skipped */ } };
        let attempt = 0, timer = 0, sock = null, closed = false;
        const retry = go => { if (closed) return; const wait = Math.min(30000, 1000 * Math.pow(2, attempt++)) * (0.8 + Math.random() * 0.4); timer = setTimeout(go, wait); };
        if (cfg.transport === 'poll') {
          const tick = () => {
            if (closed) return;
            fetch(cfg.address, { cache: 'no-store', credentials: 'omit' }).then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status)))).then(t => { attempt = 0; onMessage(t); timer = setTimeout(tick, Math.max(0.5, cfg.interval || 5) * 1000); }, () => retry(tick));
          };
          tick();
        } else if (cfg.transport === 'websocket' && typeof WebSocket !== 'undefined') {
          const open = () => {
            if (closed) return;
            try { sock = new WebSocket(cfg.address); } catch (e) { return; }
            sock.onopen = () => { attempt = 0; };
            sock.onmessage = e => { if (typeof e.data === 'string') onMessage(e.data); else if (e.data && e.data.text) e.data.text().then(onMessage); };
            sock.onclose = () => { sock = null; retry(open); };
          };
          open();
        } else if (cfg.transport === 'sse' && typeof EventSource !== 'undefined') {
          const open = () => {
            if (closed) return;
            try { sock = new EventSource(cfg.address); } catch (e) { return; }
            sock.onopen = () => { attempt = 0; };
            sock.onmessage = e => onMessage(e.data);
            sock.onerror = () => { if (sock && sock.readyState === 2) { sock = null; retry(open); } };
          };
          open();
        }
        feedClosers.push(() => { closed = true; clearTimeout(timer); if (sock) { sock.onclose = null; sock.onerror = null; try { sock.close(); } catch (e) { /* closed */ } } });
      }
    };
    liveFeeds();

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
    // The background's image or video (a colour needs neither). The video follows the page's clock, as in the app.
    let bgEl = null, bgVideo = null, bgMuted = true;
    const bgVid = bgDisp.video || {};
    if (bgSource === 'image' && bgDisp.image && bgDisp.image.src) {
      bgEl = new Image(); bgEl.onload = () => { needsDraw = true; }; bgEl.src = bgDisp.image.src;
    } else if (bgSource === 'video' && bgVid.src) {
      const e = document.createElement('video');
      e.muted = true; e.loop = bgVid.loop !== false; e.playsInline = true; e.preload = 'auto';
      e.setAttribute('playsinline', ''); e.setAttribute('muted', '');
      const url = dataToBlobUrl(bgVid.src); if (url !== bgVid.src) blobUrls.push(url);
      e.src = url;
      e.addEventListener('loadeddata', () => { needsDraw = true; });
      e.addEventListener('seeked', () => { needsDraw = true; });
      bgEl = bgVideo = e;
      // Sound only after the visitor has clicked (browsers block it before): until then it plays muted.
      bgMuted = bgVid.muted !== false;
    }
    // A colour background can be a gradient or a palette's bands (types/play.ts activeFill); the kit paints it.
    const bgFill = bgSource === 'colour' && (bgDisp.colourMode === 'gradient' || bgDisp.colourMode === 'palette') && bgDisp.fill && Array.isArray(bgDisp.fill.stops) && bgDisp.fill.stops.length ? bgDisp.fill : null;
    const background = bgOnly && !queueLayer ? { el: bgEl, fit: bgDisp.fit === 'contain' || bgDisp.fit === 'stretch' ? bgDisp.fit : 'cover', colour: bgDisp.backdrop || [0, 0, 0], fill: bgFill } : null;
    const followBackground = run => { if (bgVideo) followVideo(bgVideo, bgVid.rate, bgVid.loop !== false, run); };
    // Keep a video on the page's clock (as the app's play/background.ts).
    const followVideo = (v, rateIn, loop, run) => {
      if (!v || v.readyState < 1) return;
      const rate = rateIn > 0 ? rateIn : 1;
      if (v.playbackRate !== rate) v.playbackRate = rate;
      const target = videoTimeAt(time, v.duration, rate, loop), d = v.duration, diff = Math.abs(v.currentTime - target);
      // Without a known length it just plays (videos recorded in a browser can say Infinity).
      const known = isFinite(d) && d > 0;
      const off = !known ? 0 : loop ? Math.min(diff, d - diff) : diff;
      if (run && (loop || !known || target < d - 0.01)) {
        if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
        if (off > 0.3 && !v.seeking) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (off > 0.02 && !v.seeking) v.currentTime = target;
      }
    };
    // The Background layer's queue: its videos (made when one first shows, following the clock only
    // while it shows), its other graphs as programs of their own, and the pictures the layer kit composes.
    const qGraphs = B.backgroundGraphs || {};
    const qProgs = new Map(), qFrames = new Map(), qVideos = new Map();
    let qSound = false;
    const qVideo = item => {
      if (!item.src) return null;
      let e = qVideos.get(item.id);
      if (!e) {
        e = document.createElement('video');
        e.muted = true; e.loop = item.loop !== false; e.playsInline = true; e.preload = 'auto';
        e.setAttribute('playsinline', ''); e.setAttribute('muted', '');
        const url = dataToBlobUrl(item.src); if (url !== item.src) blobUrls.push(url);
        e.src = url;
        e.addEventListener('loadeddata', () => { needsDraw = true; });
        e.addEventListener('seeked', () => { needsDraw = true; });
        qVideos.set(item.id, e);
      }
      return e;
    };
    const followQueue = (plan, run) => {
      const showing = new Map(plan.items.filter(i => i.item.kind === 'video').map(i => [i.item.id, i.item]));
      for (const [id, v] of qVideos) {
        const item = showing.get(id);
        if (!item) { if (!v.paused) v.pause(); continue; }
        // Sound only after the visitor has clicked (browsers block it before).
        const muted = item.muted !== false || !qSound;
        if (v.muted !== muted) v.muted = muted;
        followVideo(v, item.rate, item.loop !== false, run);
      }
    };
    // Video layers: their files ride in the page as `src` (exportHtml.ts playBundle), each in a <video>
    // of its own on the page's clock as in the app (play/videoLayers.ts): frame t shows start + t × speed.
    const lVideos = new Map();
    for (const l of play.layers) {
      if (l.kind !== 'video' || !l.src) continue;
      const e = document.createElement('video');
      e.muted = true; e.loop = false; e.playsInline = true; e.preload = 'auto';
      e.setAttribute('playsinline', ''); e.setAttribute('muted', '');
      const url = dataToBlobUrl(l.src); if (url !== l.src) blobUrls.push(url);
      e.src = url;
      e.addEventListener('loadeddata', () => { needsDraw = true; });
      e.addEventListener('seeked', () => { needsDraw = true; });
      lVideos.set(l.id, { el: e, started: false, an: null, freq: null, gain: null });
    }
    const layerVideo = l => { const v = lVideos.get(l.id); return v ? v.el : null; };
    /** Where a video layer is at `t` (types/playLayers.ts videoLayerTimeAt). */
    function videoLayerTimeAt(t, duration, speed, loop, start) {
      if (!(duration > 0) || !isFinite(duration)) return Math.max(0, start);
      const x = Math.max(0, start) + Math.max(0, t) * (speed > 0 ? speed : 1);
      return loop ? x % duration : Math.min(x, Math.max(0, duration - 0.001));
    }
    const followLayerVideos = run => {
      for (const l of play.layers) {
        const v = lVideos.get(l.id);
        if (!v || v.el.readyState < 1) continue;
        const e = v.el, rate = l.speed > 0 ? l.speed : 1;
        if (e.playbackRate !== rate) e.playbackRate = rate;
        if (v.gain) v.gain.gain.value = l.sound === 'play' ? Math.max(0, Math.min(1, value(l, 'volume'))) : 0;
        if (!l.follow) {
          e.loop = !!l.loop;
          if (!v.started) { v.started = true; if (l.start > 0) e.currentTime = l.start; }
          if (run && l.playing) { if (e.paused && !e.ended) { const p = e.play(); if (p && p.catch) p.catch(() => {}); } }
          else if (!e.paused) e.pause();
          continue;
        }
        e.loop = !!l.loop;
        const d = e.duration, known = isFinite(d) && d > 0;
        const target = videoLayerTimeAt(l.playing ? time : 0, d, rate, !!l.loop, l.start || 0);
        const diff = Math.abs(e.currentTime - target);
        const off = !known ? 0 : l.loop ? Math.min(diff, d - diff) : diff;
        if (run && l.playing && (l.loop || !known || target < d - 0.01)) {
          if (e.paused) { const p = e.play(); if (p && p.catch) p.catch(() => {}); }
          if (off > 0.3 && !e.seeking) e.currentTime = target;
        } else {
          if (!e.paused) e.pause();
          if (off > 0.02 && !e.seeking) e.currentTime = target;
        }
      }
    };
    // Their sound (Listen: analysed for the readers; Play: heard too). Browsers start sound only after a
    // click or a key, so it joins then: one MediaElementSource per element, into an analyser and a gain.
    const soundVideos = play.layers.filter(l => l.kind === 'video' && lVideos.has(l.id) && (l.sound === 'listen' || l.sound === 'play'));
    const vSound = { ctx: null, started: false };
    function startVideoSound() {
      if (!soundVideos.length || !alive) return;
      if (!vSound.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        vSound.ctx = new AC();
      }
      if (vSound.ctx.state === 'suspended') vSound.ctx.resume();
      if (vSound.started) return;
      vSound.started = true;
      for (const l of soundVideos) {
        const v = lVideos.get(l.id);
        try {
          const src = vSound.ctx.createMediaElementSource(v.el);
          const an = vSound.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
          const g = vSound.ctx.createGain(); g.gain.value = l.sound === 'play' ? Math.max(0, Math.min(1, l.volume)) : 0;
          src.connect(an); an.connect(g); g.connect(vSound.ctx.destination);
          v.an = an; v.freq = new Float32Array(an.frequencyBinCount); v.gain = g;
          v.el.muted = false; v.el.removeAttribute('muted');
        } catch (e) { /* this browser won't route the video's sound */ }
      }
    }
    const qProgram = id => {
      if (qProgs.has(id)) return qProgs.get(id);
      const g = qGraphs[id];
      let e = null;
      if (g) {
        try {
          const p = link(VS, g.fragmentShader);
          e = { program: p, locs: new Map(), uniforms: g.uniforms || {}, font: (g.fragmentShader.match(/\bu_fontTexture\b/g) || []).length > 1 };
        } catch (err) { e = null; }
      }
      qProgs.set(id, e);
      return e;
    };
    const drawQueueGraph = e => {
      const W = glCanvas.width, H = glCanvas.height;
      const ql = n => { if (!e.locs.has(n)) e.locs.set(n, gl.getUniformLocation(e.program, n)); return e.locs.get(n); };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(e.program);
      setUniformAt(ql('u_time'), time);
      setUniformAt(ql('u_resolution'), [W, H]);
      setUniformAt(ql('u_mouse'), [mouse.x * W, mouse.y * H]);
      for (const k in e.uniforms) setUniformAt(ql(k), e.uniforms[k]);
      const fl = ql('u_fontTexture');
      if (fl) { if (e.font && fontTex === white) { fontTex = texture(gl.LINEAR); upload(fontTex, fontAtlas(), false); } gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fontTex); gl.uniform1i(fl, 0); }
      drawQuad();
    };
    const captureQueue = id => {
      let c = qFrames.get(id);
      if (!c) { c = document.createElement('canvas'); qFrames.set(id, c); }
      if (c.width !== glCanvas.width || c.height !== glCanvas.height) { c.width = glCanvas.width; c.height = glCanvas.height; }
      const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
      try { x.drawImage(glCanvas, 0, 0); } catch (err) { /* nothing to copy */ }
    };
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
    const usesLayersNode = !bgOnly && /\bu_layers(Field)?\b/.test(B.fragmentShader);
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
    // pixelSize: a drawing buffer of exactly that many pixels, whatever the box's size on screen
    // (a capture at 1920 × 1080 shown scaled down); the box is then measured untransformed.
    const pixelSize = opts.pixelSize && opts.pixelSize.w > 0 && opts.pixelSize.h > 0 ? opts.pixelSize : null;
    const layout = () => {
      const r = pixelSize ? { width: stage.clientWidth, height: stage.clientHeight } : stage.getBoundingClientRect();
      let w = r.width, h = r.height;
      if (ratio && w > 0 && h > 0) { if (w / h > ratio) w = h * ratio; else h = w / ratio; }
      fitBox.style.width = w + 'px'; fitBox.style.height = h + 'px';
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
      const W = pixelSize ? Math.round(pixelSize.w) : Math.max(1, Math.round(w * dpr)), H = pixelSize ? Math.round(pixelSize.h) : Math.max(1, Math.round(h * dpr));
      if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; ovCanvas.width = W; ovCanvas.height = H; needsDraw = true; dropTargets(); }
    };
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    layout();

    // Mapping engine
    const controls = new Map(play.controls.map(c => [c.id, c]));
    const layersById = new Map(play.layers.map(l => [l.id, l]));
    // The Finish stack's effects are this mount's own copies too; their numbers are driven like layer properties.
    const finish = play.finish && Array.isArray(play.finish.effects) ? { on: play.finish.on !== false, effects: play.finish.effects.map(e => Object.assign({}, e)) } : null;
    if (finish) for (const e of finish.effects) layersById.set('finish:' + e.id, e);
    const base = new Map(), live = new Map(), layerLive = new Map(), smooth = new Map(), trig = new Map(), actLevel = new Map();
    const mouse = { x: 0.5, y: 0.5, down: 0, over: false };
    let time = typeof opts.startTime === 'number' && isFinite(opts.startTime) ? Math.max(0, opts.startTime) : 0, playing = !opts.paused, lastNow = 0, frame = 0;
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
        case 'reader': { updateReaders(); return readers.ok && readers.levels.has(s.readerId) ? readers.levels.get(s.readerId) : null; }
        case 'osc': { const a = shared.osc.get(s.address); if (!a) return null; const raw = a[s.arg]; const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : null; return v === null ? null : Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min))); }
        case 'null': { const l = layersById.get(s.layerId); if (!l) return null; return Math.max(0, Math.min(1, layerValue(l.id, s.axis, l[s.axis]))); }
        case 'hand': return handSt ? HK.read(handSt, s.side, s.read, s.point, s.axis, s.gesture) : null;
        case 'data': {
          // A dataset's current row (a Data layer's, or the first one showing it): the column there, 0..1 over its min..max.
          const r = dsResult(s.dataset);
          if (!r) return null;
          const at = s.layerId ? s.layerId : 'ds:' + s.dataset;
          const row = sensors.has(at + '::row') ? sensors.get(at + '::row') : 0, rows = sensors.get(at + '::rows');
          const n = rows != null ? rows : r.kind === 'table' ? r.rows : 0;
          if (s.column === '#row') return n > 1 ? Math.max(0, Math.min(1, row / (n - 1))) : 0;
          if (r.kind !== 'table' || !(r.rows > 0) || typeof SSKit === 'undefined' || !SSKit.data) return null;
          return SSKit.data.unit(SSKit.data.column(r, s.column), Math.max(0, Math.min(r.rows - 1, Math.round(row))));
        }
        case 'sensor': {
          if (s.read === 'distance') {
            const d = s.otherId ? anchorGap(s.layerId, s.otherId) : null;
            return d === null ? null : Math.min(1, d);
          }
          const v = sensors.get(s.layerId + '::' + s.read);
          return v === undefined ? null : v;
        }
        case 'control': { const c = controls.get(s.controlId); if (!c) return null; const v = live.has(c.id) ? live.get(c.id) : base.get(c.id); if (v === undefined) return null; if (Array.isArray(v)) return (v[0] + v[1] + v[2]) / 3; const span = c.max - c.min; return span > 0 ? Math.max(0, Math.min(1, (v - c.min) / span)) : 0; }
        default: return null;
      }
    }
    // Where an anchor is (a layer's centre, or a hand's landmark), 0..1 with y up, and how far apart two are in picture heights.
    const anchorLookup = id => { const l = layersById.get(id); return l ? { layer: l, value: k => value(l, k) } : null; };
    const reported = k => sensors.get(k);
    function anchorAt(ref) {
      const h = handAnchorOf(ref);
      if (h) return handSt && usesHands ? HK.point(handSt, h.side, h.point) : null;
      const l = layersById.get(ref);
      return l && typeof SSKit !== 'undefined' && SSKit.anchor ? SSKit.anchor(l, k => value(l, k), glCanvas.width / Math.max(1, glCanvas.height), reported, anchorLookup) : null;
    }
    function anchorGap(a, b) {
      const pa = anchorAt(a), pb = anchorAt(b);
      return pa && pb ? Math.hypot((pa.x - pb.x) * glCanvas.width / Math.max(1, glCanvas.height), pa.y - pb.y) : null;
    }
    function triggerInput(t) {
      if (t.on === 'beat') { const b = beatAt(t.bpm, t.beats, time); return { presses: b.count, gate: b.gate }; }
      const k = triggerKey(t);
      return { presses: shared.presses.get(k) || 0, gate: (shared.held.get(k) || 0) > 0 };
    }
    const mappingFire = new Map(), actionFire = new Map();
    function readTrigger(m, dt) {
      const s = m.source, t = s.trigger;
      const inp = triggerInput(t);
      const vel = s.velocity && t.on !== 'beat' ? shared.velocities.get(triggerKey(t)) || 1 : 1;
      // The firing mode turns presses into fires; the envelope, toggle or step counts those.
      const f = fireSlot(mappingFire, m.id, t, inp.presses, inp.gate);
      let st = trig.get(m.id);
      if (!st) { st = { seen: 0, value: 0, stage: 'idle', peak: 1, index: -1 }; trig.set(m.id, st); }
      if (f.fresh) st.seen = 0;
      else f.slot.count += Math.min(4, stepFire(f.slot.st, t.fire, inp.presses, inp.gate, dt));
      return stepTrigger(st, s, f.slot.count, inp.gate, dt, vel);
    }
    const colourBuf = new Map();
    // Audio readers: read from the live input, or from an Audio Input node's song (`input` is its id), once a frame.
    const readers = { cfg: play.audioReaders || null, levels: new Map(), ok: false, at: 0, gates: new Set() };
    function updateReaders() {
      const R = readers;
      if (!R.cfg || !R.cfg.readers.length) return;
      const now = performance.now();
      if (now - R.at < 4) return;
      const dt = R.at ? Math.min(0.1, (now - R.at) / 1000) : 1 / 60;
      R.at = now;
      let freq = null, sr = 48000;
      const a = R.cfg.input ? audioById.get(R.cfg.input) : null;
      // A Video layer's sound (`video:<id>`), once the visitor's first click has let it start.
      const vid = R.cfg.input && R.cfg.input.indexOf('video:') === 0 ? lVideos.get(R.cfg.input.slice(6)) : null;
      if (vid) { if (vid.an) { vid.an.getFloatFrequencyData(vid.freq); freq = vid.freq; sr = vid.an.context.sampleRate; } }
      else if (a && a.an) { a.an.getFloatFrequencyData(a.freq); freq = a.freq; sr = a.an.context.sampleRate; }
      else if ((!R.cfg.input || !a) && shared.live.status === 'on') { updateLive(); freq = shared.live.freq; sr = shared.live.sr; }
      R.ok = !!freq;
      if (!freq) { R.levels.clear(); return; }
      for (const r of R.cfg.readers) R.levels.set(r.id, readerSmooth(R.levels.get(r.id) || 0, readerRead(r, freq, sr), dt, r.attack, r.release));
    }
    // Audio hits (a band over its threshold; lets go below 80% of it) and reader triggers (lets go below threshold − hysteresis), for mappings and actions.
    function tickAudioTriggers() {
      const on = shared.live.status === 'on';
      if (on) updateLive();
      updateReaders();
      const seen = new Set();
      for (const t of allTriggers) {
        if (t.on !== 'audio' && t.on !== 'reader') continue;
        const k = triggerKey(t);
        if (seen.has(k)) continue;
        seen.add(k);
        if (t.on === 'audio') {
          if (!on) continue;
          const v = shared.live.v[t.band] || 0, open = shared.live.gates.has(k);
          if (!open && v >= t.threshold) { shared.live.gates.add(k); press(k, v); }
          else if (open && v < t.threshold * 0.8) { shared.live.gates.delete(k); release(k); }
        } else {
          const v = readers.levels.get(t.readerId) || 0, open = readers.gates.has(k), g = readerGate(open, v, t.threshold, t.hysteresis);
          if (g && !open) { readers.gates.add(k); press(k, v); }
          else if (!g && open) { readers.gates.delete(k); release(k); }
        }
      }
    }
    // Shape enter / fill triggers: a sensor crossing its threshold is a press (80% hysteresis).
    const zoneGates = new Set(), proxGates = new Set();
    // Proximity: A and B closer (or farther) than the distance is a press; past the margin it lets go.
    function tickProximityTriggers() {
      for (const t of allTriggers) {
        if (t.on !== 'proximity') continue;
        const k = triggerKey(t), open = proxGates.has(k), on = proximityGate(open, anchorGap(t.a, t.b), t.when, t.distance, t.margin);
        if (on && !open) { proxGates.add(k); press(k); }
        else if (!on && open) { proxGates.delete(k); release(k); }
      }
    }
    function tickZoneTriggers() {
      for (const t of allTriggers) {
        if (t.on !== 'zone' || t.event === 'click') continue;
        const k = triggerKey(t), v = sensors.get(t.layerId + '::' + (t.event === 'enter' ? 'hover' : 'fill')) || 0, th = t.event === 'enter' ? 0.5 : t.threshold, open = zoneGates.has(k);
        if (!open && v >= th) { zoneGates.add(k); press(k); }
        else if (open && v < th * 0.8) { zoneGates.delete(k); release(k); }
      }
    }
    // Hands: this mount's view of the page's tracker (placed where its Camera layer shows the camera), and gesture triggers.
    const HK = typeof SSKit !== 'undefined' && SSKit.hands ? SSKit.hands : null;
    const handSt = HK ? HK.create() : null;
    const handSettings = Object.assign({ smoothing: 0.5, overlay: true, colour: [0.35, 1, 0.75], mirror: true }, play.hands || {});
    const trigHands = t => t.on === 'hand' || (t.on === 'proximity' && (!!handAnchorOf(t.a) || !!handAnchorOf(t.b)));
    const usesHands = play.mappings.some(m => m.source.kind === 'hand' || (m.source.kind === 'trigger' && trigHands(m.source.trigger)) || (m.source.kind === 'sensor' && m.source.read === 'distance' && !!handAnchorOf(m.source.otherId || '')))
      || actions.some(a => trigHands(a.trigger)) || play.layers.some(l => l.kind === 'null' && l.follow === 'hand');
    if (usesHands && B.hands) { shared.hands.assets = B.hands; if (!shared.hands.options) shared.hands.options = HK.options(play.hands); }
    const handGates = new Set();
    let handSeq = -1;
    function tickHands() {
      if (!handSt || !usesHands) return;
      const H = shared.hands;
      if (H.frame && H.seq !== handSeq) {
        handSeq = H.seq;
        const picAspect = glCanvas.width / Math.max(1, glCanvas.height), camAspect = H.frame.w / Math.max(1, H.frame.h);
        HK.update(handSt, H.frame, { picAspect, place: HK.placement(play, value, camAspect, picAspect, handSettings.mirror), smoothing: handSettings.smoothing, responsiveness: handSettings.responsiveness, maxHands: handSettings.maxHands, swap: handSettings.swap });
      }
      HK.age(handSt, performance.now());
      for (const t of allTriggers) {
        if (t.on !== 'hand') continue;
        const k = triggerKey(t), on = HK.gate(handSt, t.side, t.gesture), open = handGates.has(k);
        if (on && !open) { handGates.add(k); press(k); }
        else if (!on && open) { handGates.delete(k); release(k); }
      }
    }
    // Actions (burst, next line, drop…): by their trigger's mode, once per press unless it says every frame, every N or on release.
    function tickActions(dt) {
      for (const a of actions) {
        const inp = triggerInput(a.trigger);
        const f = fireSlot(actionFire, a.id, a.trigger, inp.presses, inp.gate);
        if (f.fresh || !K) continue;
        const n = Math.min(4, stepFire(f.slot.st, a.trigger.fire, inp.presses, inp.gate, dt));
        for (let i = 0; i < n; i++) K.act(a);
      }
    }
    function tickMappings(dt) {
      tickHands();
      tickAudioTriggers();
      tickZoneTriggers();
      tickProximityTriggers();
      tickActions(dt);
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
    if (bgVideo && !bgMuted) on(window, 'pointerdown', () => { bgVideo.muted = false; }, true);
    if (soundVideos.length) { on(window, 'pointerdown', startVideoSound, true); on(window, 'keydown', startVideoSound, true); }
    if (queueLayer && (queueLayer.sources || []).some(s => s.kind === 'video' && s.muted === false)) { on(window, 'pointerdown', () => { qSound = true; }, true); on(window, 'keydown', () => { qSound = true; }, true); }
    if (pointerOn) {
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
    } else if (bg) {
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
    // Readers on the live input (or on a node whose song stayed out of the page, which listens to the input instead) need it too.
    const readerNode = readers.cfg && readers.cfg.input ? audioById.get(readers.cfg.input) : null;
    const readerVideo = !!(readers.cfg && readers.cfg.input && readers.cfg.input.indexOf('video:') === 0 && lVideos.has(readers.cfg.input.slice(6)));
    const readersLive = !!(readers.cfg && readers.cfg.readers.length) && (!readers.cfg.input || (readerNode ? !readerNode.src : !readerVideo));
    const usesLive = play.mappings.some(m => m.source.kind === 'live' || (m.source.kind === 'trigger' && m.source.trigger.on === 'audio'))
      || actions.some(a => a.trigger.on === 'audio') || play.layers.some(l => l.kind === 'audio' && l.visible) || audioNodes.some(a => !a.src) || readersLive;
    const matteIds = new Set(play.layers.map(l => (l.trackMatte ? l.trackMatte.id : '')));
    const usesCamera = play.layers.some(l => (l.visible || matteIds.has(l.id)) && (l.kind === 'camera' || ((l.kind === 'particles' || l.kind === 'glyphs' || l.kind === 'contours') && l.readFrom === 'camera')));
    let camVideo = null;
    const fmt = (v, step) => { const d = step && step >= 1 ? 0 : step && step >= 0.1 ? 1 : step && step >= 0.01 ? 2 : 3; return Number(v).toFixed(d); };
    const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
    // A control moved by hand (its slider, its colour, or the host through set()).
    const setColour = (c, rgb) => { base.set(c.id, rgb); const u = uniformFor(c); if (u && !live.has(c.id)) uniformValues[u] = rgb; needsDraw = true; };
    const setFloat = (c, v) => { base.set(c.id, v); const lt = layerTarget(c.target); if (lt) { const l = layersById.get(lt.layerId); if (l) l[lt.key] = v; } else { const u = uniformFor(c); if (u && !live.has(c.id)) uniformValues[u] = v; } needsDraw = true; };
    const fireAction = c => { const at = actTarget(c.target); if (at && K) { K.act({ do: at.do, layerId: at.layerId, amount: c.amount || 1 }); needsDraw = true; } };
    if (showPanel) {
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
      if (usesHands && B.hands) {
        const b = el('button', 'ssp-btn', 'Enable hands');
        b.title = 'Follows your hands with the camera. Everything runs on this device; nothing is uploaded.';
        const show = s => { b.textContent = s === 'on' ? 'Hands on' : s === 'starting' ? 'Starting…' : s === 'blocked' ? 'Camera blocked' : s === 'unsupported' ? 'No hand tracking here' : s === 'error' ? 'Hands didn’t start' : 'Enable hands'; b.disabled = s === 'on' || s === 'starting' || s === 'unsupported'; };
        shared.hands.listeners.add(show); listeners.push(() => shared.hands.listeners.delete(show));
        show(shared.hands.status);
        b.onclick = () => enableHands();
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
          b.onclick = () => fireAction(c);
          row.replaceChildren(b);
          panel.append(row);
          continue;
        }
        if (c.kind === 'color') {
          const input = el('input'); input.type = 'color'; input.className = 'ssp-colour';
          const b = base.get(c.id); if (Array.isArray(b)) input.value = hex(b);
          input.oninput = () => { const h = input.value; setColour(c, [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]); };
          row.append(input);
          readouts.set(c.id, { out, input, kind: 'color' });
        } else {
          const input = el('input'); input.type = 'range'; input.className = 'ssp-range';
          input.min = c.min; input.max = c.max; input.step = c.step || (c.max - c.min) / 400;
          const b = base.get(c.id); if (typeof b === 'number') input.value = b;
          input.oninput = () => { const v = parseFloat(input.value); setFloat(c, v); out.textContent = fmt(v, c.step); };
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
    // Layers only covers the picture with the backdrop (a colour background is the backdrop already).
    const hidden = !queueLayer && !!(play.display && play.display.picture === false && bgSource !== 'colour');
    const audioLayer = play.layers.some(l => l.kind === 'audio' && l.visible);
    const pointer = { x: 0.5, y: 0.5, over: false, down: false };
    function drawLayers(dt) {
      if (!K) return;
      const W = ovCanvas.width, H = ovCanvas.height, dpr = W / Math.max(1, fitBox.clientWidth);
      const L = shared.live;
      if (audioLayer && L.status === 'on') updateLive();
      pointer.x = mouse.x; pointer.y = mouse.y; pointer.over = mouse.over; pointer.down = !!mouse.down;
      let guides = null;
      if (finishR && guideCanvas) {
        if (guideCanvas.width !== W || guideCanvas.height !== H) { guideCanvas.width = W; guideCanvas.height = H; }
        guides = guideCanvas.getContext('2d'); guides.clearRect(0, 0, W, H);
      }
      K.frame(octx, play, {
        gl: glCanvas, W, H, dpr, time, dt, value, pointer, markers, editing: false, hidden, guides, alphaLayers: finishMap(),
        backdrop: play.display ? play.display.backdrop : [0, 0, 0],
        background,
        graphFrame: item => qFrames.get(item.id) || null,
        video: qVideo,
        allowDirect: true,
        audio: L.status === 'on' ? { wave: L.wave, freq: L.freq, sampleRate: L.sr } : null,
        camera: camVideo || shared.camera, image: img, layerVideo,
        hand: handSt && usesHands ? (side, point) => HK.point(handSt, side, point) : undefined,
        handsLive: !!(handSt && usesHands && handSt.live),
        // The skeleton is a setup aid: a page shows it only with its markers on.
        hands: handSt && usesHands && markers && handSettings.overlay && handSt.live ? { state: handSt, colour: handSettings.colour } : null,
        // three.js for 3D Script layers: the page carries it (SSThree) only when it has one.
        three: typeof SSThree !== 'undefined' ? SSThree : (window.SSThree || null),
        scriptStatus: (id, err) => { const e = err || null; if (scriptErrors.get(id) === e) return; scriptErrors.set(id, e); if (onScript) { try { onScript(id, e); } catch (x) { /* the host's problem */ } } },
        sensor: (k, v) => sensors.set(k, v),
        override: (id, k, v) => { if (v === null) overrides.delete(id + '::' + k); else overrides.set(id + '::' + k, v); },
        shaderTap: layersTap || undefined,
        data: dsEntry,
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
      for (const d of dataTex) bindSampler(d.name, d.tex);
      for (const c of dataCounts) setUniform(c.name, c.n);
      drawQuad();
      if (target) {
        if (echoCfg) captureEcho(target);
        blit(target.tex, null, W, H, ditherSeed(frame));
        if (stateful) pingIdx = 1 - pingIdx;
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    // Held by renderAt: the picture stays what it drew until play() lets the clock run again.
    let held = false;
    function tick(now) {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      if (held) return;
      const running = playing && !reduced && !document.hidden && !(pauseOffscreen && !onScreen);
      runVideos(running);
      followBackground(running);
      followLayerVideos(running);
      if ((pauseOffscreen && !onScreen) || document.hidden) return;
      if (reduced && !needsDraw && frame > 0) return;
      if (playing && !reduced) time += dt;
      frame++;
      shared.live.clock++;
      if (bg && followPage) clampedMouse(shared.pageX, shared.pageY);
      tickAudioNodes();
      const moved = tickMappings(dt);
      // Feedback and echo change with every frame drawn, so while paused they draw only when something changes (as in the app).
      if (!playing && (stateful || echoCfg) && !needsDraw && !moved && frame > 1) { refreshPanel(now); return; }
      paint(dt, running);
      refreshPanel(now);
    }
    // The picture and the layers at `time` (the mappings already ticked).
    function paint(dt, running) {
      needsDraw = false;
      // A Background layer: what shows now (its actions carried out), before anything is drawn.
      const qPlan = queueLayer && K ? K.background(play, { time, value, allowDirect: true }) : null;
      if (qPlan) followQueue(qPlan, running);
      const showsThis = !qPlan || qPlan.items.some(i => i.item.kind === 'graph' && i.item.graph === 'this');
      if (!bgOnly && showsThis) {
        uploadVideos();
        // Reduced motion's still frame of a feedback graph is the picture after its first 1.5 s
        // (90 frames at 60 fps), which is what the feedback looks like once it has built up.
        if (reduced && stateful && frame === 1 && !held) for (let i = 0; i < 89; i++) { drawPicture(); time += 1 / 60; }
        drawPicture();
        if (particles.length) drawParticles();
        if (qPlan && !qPlan.direct) { const self = qPlan.items.find(i => i.item.kind === 'graph' && i.item.graph === 'this'); if (self) captureQueue(self.item.id); }
      }
      if (qPlan) for (const { item } of qPlan.items) {
        if (item.kind !== 'graph' || item.graph === 'this') continue;
        const e = qProgram(item.id);
        if (!e) continue;
        drawQueueGraph(e);
        if (!qPlan.direct) captureQueue(item.id);
      }
      const layered = !!(play.layers.length || hidden || usesLayersNode || bgOnly);
      if (layered) drawLayers(dt);
      if (finishR) {
        const ok = finishR.draw({
          finish, value: (e, k) => layerValue('finish:' + e.id, k, e[k]), picture: glCanvas, layers: layered ? ovCanvas : null,
          layerAlpha: id => (K ? K.layerCanvas(id) : null), width: glCanvas.width, height: glCanvas.height, time, first: frame <= 1,
        });
        fnCanvas.style.display = ok ? 'block' : 'none';
        finishDrew = ok;
      }
    }
    // The layer the time map reads (Time displacement's Layer map), drawn alone by the kit.
    let finishDrew = false;
    function finishMap() {
      if (!finishR) return null;
      const t = finish.effects.find(e => e.kind === 'time' && e.enabled);
      return t && t.map === 'layer' && t.layerId ? [t.layerId] : null;
    }
    raf = requestAnimationFrame(tick);
    // The picture and its layers with both canvases, as one 2D canvas (read in the same task as the draw).
    const composite = () => {
      const out = document.createElement('canvas');
      out.width = glCanvas.width; out.height = glCanvas.height;
      const x = out.getContext('2d');
      if (finishR && finishDrew) { x.drawImage(fnCanvas, 0, 0, out.width, out.height); return out; }
      x.drawImage(glCanvas, 0, 0);
      x.drawImage(ovCanvas, 0, 0);
      return out;
    };

    return {
      destroy() {
        alive = false;
        for (const close of feedClosers) close();
        cancelAnimationFrame(raf);
        ro.disconnect();
        if (io) io.disconnect();
        for (const off of listeners) off();
        shared.instances.delete(inst);
        for (const v of videos) if (v.el) { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); }
        if (bgVideo) { bgVideo.pause(); bgVideo.removeAttribute('src'); bgVideo.load(); }
        for (const v of qVideos.values()) { v.pause(); v.removeAttribute('src'); v.load(); }
        for (const v of lVideos.values()) { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); }
        if (vSound.ctx) vSound.ctx.close();
        for (const u of blobUrls) URL.revokeObjectURL(u);
        if (song.ctx) song.ctx.close();
        if (finishR) finishR.dispose();
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        root.innerHTML = '';
        root.classList.remove('ssp', 'ssp-bg', 'ssp-bare');
      },
      pause() { setPlaying(false); },
      play() { held = false; setPlaying(true); },
      /**
       * Draw the frame at `t` seconds, the same every time: the clock stops and
       * the picture holds until play(). The layers and feedback start over
       * (the layers' random choices seeded by `seed`, default 1) and are
       * stepped through `steps` (clock times, fixed `dt` apart, from
       * lib/backgroundLibrary.ts captureSteps) first, so simulations arrive
       * where they would be. With `capture`, returns the picture and its
       * layers as one canvas; else null.
       */
      renderAt(t, o) {
        o = o || {};
        held = true; setPlaying(false);
        const fdt = o.dt > 0 ? o.dt : 1 / 60;
        const steps = Array.isArray(o.steps) ? o.steps : [];
        if (K) K.reset(o.seed > 0 ? o.seed : 1);
        if (finishR) finishR.reset();
        dropTargets(); frame = 0; smooth.clear(); trig.clear(); actLevel.clear(); overrides.clear();
        for (const at of steps) { time = Math.max(0, +at || 0); frame++; tickMappings(fdt); paint(fdt, false); }
        time = Math.max(0, +t || 0); frame++; tickMappings(fdt); paint(fdt, false);
        return o.capture ? composite() : null;
      },
      get(id) {
        const c = controls.get(id);
        if (!c) return null;
        const driven = live.has(id);
        const v = driven ? live.get(id) : base.get(id);
        return { value: Array.isArray(v) ? v.slice() : v, driven };
      },
      set(id, v) {
        const c = controls.get(id);
        if (!c) return;
        if (c.kind === 'color' && Array.isArray(v) && v.length >= 3) setColour(c, [+v[0], +v[1], +v[2]]);
        else if (typeof v === 'number' && isFinite(v)) setFloat(c, v);
      },
      fire(id) { const c = controls.get(id); if (c) fireAction(c); },
      // The graph's own songs (Audio Input files): heard or silent. Browsers want a click first.
      hasSound: songs.length > 0 || soundVideos.some(l => l.sound === 'play'),
      sound(audible) { startSongs(!!audible); startVideoSound(); },
      usesCamera,
      // Replace one Script layer's code in this mount: it compiles and starts over on the next frame.
      setScript(layerId, code) {
        const l = layersById.get(layerId);
        if (!l || l.kind !== 'script' || typeof code !== 'string' || l.code === code) return;
        l.code = code; needsDraw = true;
      },
      still() {
        try { return composite().toDataURL('image/png'); } catch (e) { return null; }
      },
    };
  }

  // The worker that runs the Hand Landmarker (mirrors src/lib/handWorker.ts): MediaPipe's ES module and
  // its WebAssembly come in as blob URLs, the model as bytes. MediaPipe's "Right" is the performer's right hand (unmirrored frames).
  const HAND_WORKER = [
    'let lm = null, lastT = 0;',
    'self.onmessage = async e => {',
    '  const d = e.data;',
    '  if (d.type === "init") {',
    '    try {',
    '      const V = await import(d.bundle);',
    '      const o = d.options || { numHands: 2, detection: 0.6, presence: 0.57, tracking: 0.55 };',
    '      const make = del => V.HandLandmarker.createFromOptions({ wasmLoaderPath: d.loader, wasmBinaryPath: d.wasm }, { baseOptions: { modelAssetBuffer: d.model, delegate: del }, runningMode: "VIDEO", numHands: o.numHands, minHandDetectionConfidence: o.detection, minHandPresenceConfidence: o.presence, minTrackingConfidence: o.tracking });',
    '      try { lm = await make("GPU"); } catch (x) { lm = await make("CPU"); }',
    '      self.postMessage({ type: "ready" });',
    '    } catch (x) { self.postMessage({ type: "failed", message: String(x) }); }',
    '    return;',
    '  }',
    '  if (d.type === "frame") {',
    '    let hands = [];',
    '    if (lm) {',
    '      const t = Math.max(lastT + 1, Math.round(d.t)); lastT = t;',
    '      try {',
    '        const r = lm.detectForVideo(d.bitmap, t);',
    '        hands = r.landmarks.map((p, i) => { const c = (r.handedness[i] || [])[0] || {}; const f = new Float32Array(63); for (let j = 0; j < 21; j++) { f[j * 3] = p[j].x; f[j * 3 + 1] = p[j].y; f[j * 3 + 2] = p[j].z; } return { side: c.categoryName === "Left" ? "left" : "right", score: c.score || 0, lm: f }; });',
    '      } catch (x) { /* a bad frame: none this time */ }',
    '    }',
    '    d.bitmap.close();',
    '    self.postMessage({ type: "result", t: d.t, w: d.w, h: d.h, hands });',
    '  }',
    '};',
  ].join('\n');

  // One tracker for the page: every mount with hand mappings reads its frames.
  shared.hands = { status: 'off', frame: null, seq: 0, count: 0, busy: false, sent: 0, worker: null, assets: null, options: null, listeners: new Set() };
  function setHandStatus(s) { shared.hands.status = s; shared.hands.listeners.forEach(f => f(s)); }
  function gunzip(b64) {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  function pumpHands() {
    const H = shared.hands, v = shared.camera;
    if (!H.worker || H.busy) return;
    if (!v || v.readyState < 2 || !v.videoWidth || document.hidden) { setTimeout(pumpHands, 200); return; }
    const w = Math.min(480, v.videoWidth), h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth)), t = performance.now();
    H.busy = true; H.sent = t;
    createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' }).then(
      bmp => H.worker.postMessage({ type: 'frame', bitmap: bmp, t, w: v.videoWidth, h: v.videoHeight }, [bmp]),
      () => { H.busy = false; setTimeout(pumpHands, 250); });
  }
  // Call from a click: the camera opens inside the gesture, then the files unpack and the model loads.
  function enableHands() {
    const H = shared.hands, assets = H.assets;
    if (H.status === 'on' || H.status === 'starting') return Promise.resolve(H.status);
    if (!assets || typeof DecompressionStream === 'undefined' || typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') { setHandStatus('unsupported'); return Promise.resolve('unsupported'); }
    const cam = enableCamera();
    setHandStatus('starting');
    return cam.then(c => {
      if (c !== 'on') { setHandStatus('blocked'); return 'blocked'; }
      return Promise.all([gunzip(assets.bundle), gunzip(assets.loader), gunzip(assets.wasm), gunzip(assets.model)]).then(([bundle, loader, wasm, model]) => new Promise(resolve => {
        const url = (data, type) => URL.createObjectURL(new Blob([data], { type }));
        const w = new Worker(url(HAND_WORKER, 'text/javascript'), { type: 'module' });
        H.worker = w;
        w.onmessage = e => {
          const d = e.data;
          if (d.type === 'ready') { setHandStatus('on'); pumpHands(); resolve('on'); }
          else if (d.type === 'failed') { H.worker = null; w.terminate(); setHandStatus('error'); resolve('error'); }
          else if (d.type === 'result') {
            H.busy = false; H.frame = { t: d.t, w: d.w, h: d.h, hands: d.hands }; H.seq++; H.count = d.hands.length;
            setTimeout(pumpHands, Math.max(0, 1000 / 30 - (performance.now() - H.sent)));
          }
        };
        w.onerror = () => { H.worker = null; setHandStatus('error'); resolve('error'); };
        w.postMessage({ type: 'init', bundle: url(bundle, 'text/javascript'), loader: url(loader, 'text/javascript'), wasm: url(wasm, 'application/wasm'), model: new Uint8Array(model), options: H.options }, [model]);
      }));
    }).catch(() => { setHandStatus('error'); return 'error'; });
  }

  // For a host drawing its own panel: what the panel's Enable MIDI and Listen buttons do, for every mount on the page.
  function enableMidi() {
    if (!navigator.requestMIDIAccess) return Promise.resolve(false);
    return navigator.requestMIDIAccess().then(a => { a.inputs.forEach(i => { i.onmidimessage = e => onMidi(e.data); }); return true; }, () => false);
  }
  // The camera, once for the page: every mount with a camera layer reads it. Browsers ask first, after a click.
  function enableCamera() {
    if (shared.camera) return Promise.resolve('on');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve('unsupported');
    return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(stream => {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = stream;
      v.play().catch(() => {});
      shared.camera = v; shared.cameraStream = stream;
      return 'on';
    }, () => 'blocked');
  }
  function stopCamera() {
    if (shared.cameraStream) shared.cameraStream.getTracks().forEach(t => t.stop());
    shared.camera = null; shared.cameraStream = null;
  }
  // internals: the pure GPU and audio helpers, for tests.
  window.ShaderStudioPlay = { version: 8, mount, enableMidi, listen: startLive, enableCamera, stopCamera, enableHands, internals: { toGlsl, particleGeometry, perspective, bandAmplitude, particleVertex, readerBandDb, readerRead, readerSmooth, readerGate, triggerKey } };

  // A full-page export: mount on #play with the page's options (URL params can override).
  if (window.PLAY_BUNDLE && document.getElementById('play')) {
    const q = new URLSearchParams(location.search);
    const o = Object.assign({}, window.PLAY_OPTIONS || {});
    if (q.get('panel') === '0' || q.get('mode') === 'background') o.mode = 'background';
    if (q.get('mode') === 'player') o.mode = 'player';
    if (q.get('fit') === 'cover' || q.get('fit') === 'contain') o.fit = q.get('fit');
    // host: the page that framed this one may live-edit its Script layers (see the top of this file).
    const host = o.host === true && window.parent !== window;
    if (host) o.onScript = (layerId, error) => window.parent.postMessage({ ssp: 'scriptStatus', layerId, error }, '*');
    const m = mount(document.getElementById('play'), window.PLAY_BUNDLE, o);
    if (host) {
      window.addEventListener('message', e => {
        const d = e.data;
        if (e.source !== window.parent || !d || d.ssp !== 'script' || typeof d.layerId !== 'string' || typeof d.code !== 'string') return;
        if (m.setScript) m.setScript(d.layerId, d.code);
      });
      window.parent.postMessage({ ssp: 'ready' }, '*');
    }
  }
})();
