/*
 * play-runtime.js — the standalone Shader Studio player, inlined into web
 * exports (a full HTML page or a paste-in embed snippet). Plain ES2020, no
 * imports, no framework.
 *
 *   ShaderStudioPlay.mount(element, bundle, options) → { destroy(), pause(), play(), get(id), set(id, v), fire(id), still(), renderAt(t, o), renderAtAsync(t, o), seekVideos(t), setPixelSize(s) }
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
 *   follow: boolean,                 another window drives it (the app's output window, docs/projection.md):
 *                                    feed(f) gives the clock, pointer, uniforms, layer numbers and actions,
 *                                    step(now) draws a frame; no mapping engine, inputs or sound of its own
 * }
 *
 * Also on the handle: canvases() (the shader's, the layers', the Finish stack's canvas and
 * layer(id) drawn alone after showAlone(ids)), and feedOut() (what a follower needs, from
 * this mount). A full-page export's mount is window.__sspMount.
 *
 * When the browser takes the GPU away (webglcontextlost) the mount waits for it, then
 * builds itself again from the same second with the controls where they were, and says
 * "Graphics restarted" for a moment; if the GPU never comes back a Rebuild button tries
 * afresh. rebuild() on the handle does the same on demand; gpu() says where it is.
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
.ssp-xy{position:relative;height:120px;border-radius:8px;background:#121318;cursor:crosshair;touch-action:none;overflow:hidden;background-image:linear-gradient(#ffffff0d 1px,transparent 1px),linear-gradient(90deg,#ffffff0d 1px,transparent 1px);background-size:25% 25%}
.ssp-xy-dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:7px;background:#4d7cff;box-shadow:0 0 0 2px #1b1c23;pointer-events:none}
.ssp-colour{width:100%;height:30px;border:0;padding:0;background:none;border-radius:6px;cursor:pointer}
.ssp-empty{color:#9a9da8;margin-top:10px}
.ssp-error{position:absolute;inset:auto 12px 12px 12px;padding:10px 12px;border-radius:8px;background:#3a1216;color:#ffb4b4;font-size:12px}
.ssp-gpu{position:absolute;left:12px;bottom:12px;z-index:3;display:flex;align-items:center;gap:10px;padding:7px 11px;border-radius:8px;background:rgba(21,22,28,.94);color:#e6e7ec;font-size:12px;box-shadow:0 2px 12px rgba(0,0,0,.45),inset 0 0 0 1px #33353f;pointer-events:auto}
.ssp-gpu .ssp-btn{padding:3px 9px}
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
    switch (t.on) { case 'key': return 'key:' + t.code; case 'note': return 'note:' + t.channel + ':' + (t.note < 0 ? '*' : t.note); case 'mouse': return 'mouse'; case 'osc': return 'osc:' + t.address; case 'beat': return 'beat:' + t.bpm + ':' + t.beats; case 'audio': return 'audio:' + t.band + ':' + t.threshold; case 'zone': return t.event === 'fill' ? 'zone:' + t.layerId + ':fill:' + t.threshold : 'zone:' + t.layerId + ':' + t.event; case 'hand': return 'hand:' + t.side + ':' + t.gesture; case 'face': return 'face:' + t.gesture; case 'pose': return 'pose:' + t.gesture; case 'proximity': return 'prox:' + t.a + ':' + t.b + ':' + t.when + ':' + t.distance + ':' + t.margin; case 'reader': return 'reader:' + t.readerId + ':' + t.threshold + ':' + t.hysteresis; case 'value': return typeof SSKit !== 'undefined' && SSKit.signals ? SSKit.signals.valueKey(t) : 'val:' + t.value + ':' + t.cmp + ':' + t.threshold + ':' + t.hysteresis + ':' + t.tolerance; case 'signal': return 'sig:' + t.signal; }
    return '';
  }
  // Firing modes (once, held, every N frames or seconds, on release): how many times a trigger fires this frame.
  function stepFire(st, fire, presses, gate, dt, now) {
    const fresh = Math.max(0, presses - st.seen); st.seen = presses;
    const was = st.held; st.held = gate;
    const mode = fire && fire.mode ? fire.mode : 'once';
    if (mode === 'once') return fresh;
    if (mode === 'release') return Math.max(0, (was ? 1 : 0) + fresh - (gate ? 1 : 0));
    if (mode === 'held') return gate || fresh > 0 ? 1 : 0;
    // Counters (the app's play/triggers.ts stepFire): every Nth press, or N presses within a few seconds.
    if (mode === 'nth') { const n = Math.max(2, Math.round(fire.every)); st.count = (st.count || 0) + fresh; const k = Math.floor(st.count / n); st.count -= k * n; return k; }
    if (mode === 'within') {
      const n = Math.max(2, Math.round(fire.every)), win = Math.max(0.05, fire.window || 1);
      st.t = now !== undefined ? now : (st.t || 0) + (dt > 0 ? dt : 0); if (!st.times) st.times = [];
      if (st.times.length && st.t < st.times[st.times.length - 1]) st.times.length = 0;
      let k = 0;
      for (let i = 0; i < fresh; i++) { st.times.push(st.t); if (st.times.length > n) st.times.shift(); if (st.times.length === n && st.t - st.times[0] <= win + 1e-6) { k++; st.times.length = 0; } }
      return k;
    }
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
  // A proximity trigger is the distance case of a condition (the kit's signals.js): below or above, the margin its hysteresis.
  function proximityCondition(t) { return { value: 'dist:' + t.a + '|' + t.b, cmp: t.when === 'closer' ? 'below' : 'above', threshold: t.distance, hysteresis: t.margin, tolerance: 0 }; }
  function handAnchorOf(ref) { const m = /^hand:(left|right|any):(\d{1,2})$/.exec(ref); return m && +m[2] <= 21 ? { side: m[1], point: +m[2] } : null; }
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
  // A layer property (layer:<id>::<key>), a Finish effect's number (finish:<effectId>::<key>, kept under the id 'finish:<effectId>'),
  // or an audio effect's (audiofx:<chainId>:<effectId>::<key>, kept under 'audiofx:<chainId>:<effectId>').
  function layerTarget(t) {
    // A Spread's Amount or Shift (spread:<id>::amount), kept under 'spread:<id>' like a layer's numbers.
    if (t.startsWith('spread:')) { const i = t.lastIndexOf('::'); return i > 7 ? { layerId: t.slice(0, i), key: t.slice(i + 2) } : null; }
    if (t.startsWith('audiofx:')) { const i = t.lastIndexOf('::'); return i > 8 ? { layerId: t.slice(0, i), key: t.slice(i + 2) } : null; }
    // A Granulator rack's setting (au:<rackId>:inst::<address>, docs/granulator.md), kept under 'au:<rackId>:inst'.
    if (t.startsWith('au:')) { const i = t.indexOf('::'); return i > 3 ? { layerId: t.slice(0, i), key: t.slice(i + 2) } : null; }
    // A rack's Macro Control (macro:<rackId>::<n>, docs/audio-engine.md "Macros"), kept under 'macro:<rackId>'.
    if (t.startsWith('macro:')) { const i = t.indexOf('::'); return i > 6 ? { layerId: t.slice(0, i), key: t.slice(i + 2) } : null; }
    const fin = t.startsWith('finish:');
    if (!fin && !t.startsWith('layer:')) return null;
    const r = t.slice(fin ? 7 : 6); const i = r.lastIndexOf('::');
    return i > 0 ? { layerId: (fin ? 'finish:' : '') + r.slice(0, i), key: r.slice(i + 2) } : null;
  }
  // An action control (a button): `act:<layerId>::<action>`.
  function actTarget(t) { if (!t.startsWith('act:')) return null; const r = t.slice(4); const i = r.lastIndexOf('::'); return i > 0 ? { layerId: r.slice(0, i), do: r.slice(i + 2) } : null; }
  // A reader's level control (`reader:<id>::level`, play/readerControls.ts): its mapping drives it; the value is kept as the control's live value only, for "Another control", conditions and pairs.
  function readerTarget(t) { return t.startsWith('reader:') && t.endsWith('::level') ? { readerId: t.slice(7, -7) } : null; }
  // A Granulator's grain readout control (`grains:<rackId>::<read>`): driven by its sensor mapping, live value only, like a reader's.
  function grainsTarget(t) { return t.startsWith('grains:') && t.indexOf('::') > 7; }
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
    midi: Array.from({ length: 17 }, () => ({ note: 60, vel: 0, held: new Set(), bend: 0, cc: new Float32Array(128), seenNote: false, seenBend: false, seenCc: new Uint8Array(128), noteSeq: new Float64Array(128), noteVel: new Uint8Array(128) })),
    // Knob locks: every CC move under its device and channel (and "any"), kit/midi.js kmLockRecord.
    midiLocks: new Map(), midiSeq: 0,
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
  function onMidi(data, device) {
    const type = data[0] & 0xf0, chn = (data[0] & 0x0f) + 1;
    const noteOn = type === 0x90 && data[2] > 0, noteOff = type === 0x80 || (type === 0x90 && data[2] === 0);
    const seq = ++shared.midiSeq, KM = typeof SSKit !== 'undefined' && SSKit.midi ? SSKit.midi : null;
    if (type === 0xb0 && KM) KM.lockRecord(shared.midiLocks, device || '', chn, data[1] & 127, data[2], seq);
    if (type >= 0x80 && type <= 0xe0) for (const inst of shared.instances) { if (inst.pad) inst.pad(data[0], data[1] || 0, data[2] || 0, device || ''); if (inst.drum) inst.drum(data[0], data[1] || 0, data[2] || 0); if (inst.grain) inst.grain(data[0], data[1] || 0, data[2] || 0); }
    for (const ch of [shared.midi[0], shared.midi[chn]]) {
      if (noteOn) { ch.note = data[1]; ch.vel = data[2]; ch.held.add(data[1]); ch.seenNote = true; ch.noteSeq[data[1] & 127] = seq; ch.noteVel[data[1] & 127] = data[2]; }
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
  // ── GPU recovery ──────────────────────────────────────────────────────────
  // The browser can take the GPU away (a driver reset, a laptop waking, too many
  // contexts on the page): every program, texture and target a mount made is gone,
  // and so is the Finish stack's context. mountOnce hands the loss up to here, which
  // stops drawing, remembers where the clock and the controls were, and once the
  // browser gives the GPU back (webglcontextrestored, which needs the loss event
  // preventDefault-ed) mounts the same bundle again from that state: the picture
  // carries on at the same second, the controls where they were set; feedback
  // history and particles start over. A "Graphics restarted" note shows for a
  // moment. When the browser never restores it, a Rebuild button tries afresh.
  const GPU_WAIT_MS = 4000;
  const GPU_NOTE_MS = 3500;

  function mount(root, B, opts) {
    opts = opts || {};
    const startAt = typeof opts.startTime === 'number' && isFinite(opts.startTime) ? Math.max(0, opts.startTime) : 0;
    // What the next mount is told, so it carries on from where the lost one was.
    const carry = { time: startAt, paused: !!opts.paused, pixelSize: opts.pixelSize || null, scripts: new Map(), alone: null, sound: false, values: null };
    let inner = null, gen = 0, gpu = 'ok', waitTimer = 0, noteTimer = 0, alive = true, restarts = 0;
    const notice = el('div', 'ssp-gpu');
    notice.setAttribute('role', 'status');
    notice.style.display = 'none';
    const showNotice = (text, button) => {
      notice.textContent = '';
      notice.append(el('span', null, text));
      if (button) { const b = el('button', 'ssp-btn', button.label); b.type = 'button'; b.addEventListener('click', button.onClick); notice.append(b); }
      notice.style.display = 'flex';
      const stage = root.querySelector('.ssp-stage');
      if (stage && notice.parentNode !== stage) stage.append(notice);
    };
    const hideNotice = () => { notice.style.display = 'none'; };
    const hooksFor = g => ({
      lost() { if (alive && g === gen) onLost(); },
      restored() { if (alive && g === gen && gpu === 'lost') rebuild(); },
    });
    /** Where the mount is: the clock, whether it plays, and each control's own value (not a mapping's). */
    function remember() {
      if (!inner || !inner.state) return;
      const s = inner.state();
      carry.time = s.time; carry.paused = !s.playing || s.held;
      const values = new Map();
      for (const c of (B.play && B.play.controls) || []) { const g = inner.get(c.id); if (g && !g.driven && g.value !== undefined && g.value !== null) values.set(c.id, g.value); }
      carry.values = values;
    }
    function build() {
      const g = ++gen;
      const o = Object.assign({}, opts, { startTime: carry.time, paused: carry.paused });
      if (carry.pixelSize) o.pixelSize = carry.pixelSize;
      inner = mountOnce(root, B, o, hooksFor(g));
      if (!inner.state) return false;  // no WebGL, or the shader failed: the stage says so
      if (carry.values && inner.set) for (const [id, v] of carry.values) inner.set(id, v);
      if (carry.scripts.size && inner.setScript) for (const [id, code] of carry.scripts) inner.setScript(id, code);
      if (carry.alone && inner.showAlone) inner.showAlone(carry.alone);
      if (carry.sound && inner.sound) inner.sound(true);
      return true;
    }
    function onLost() {
      if (gpu === 'lost') return;
      gpu = 'lost';
      remember();
      showNotice('Graphics paused: waiting for the GPU to come back…');
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => {
        if (gpu === 'lost') showNotice('The graphics driver hasn’t come back yet.', { label: 'Rebuild', onClick: () => rebuild() });
      }, GPU_WAIT_MS);
    }
    /** Mount again from the remembered state (after a restore, the Rebuild button, or the handle's rebuild()). */
    function rebuild() {
      if (!alive) return;
      clearTimeout(waitTimer); clearTimeout(noteTimer);
      if (gpu !== 'lost') remember();
      gen++;  // the old mount's context events (its destroy loses the context on purpose) are stale from here
      const old = inner; inner = null;
      if (old) { try { old.destroy(); } catch (e) { /* already gone */ } }
      restarts++;
      if (build()) {
        gpu = 'ok';
        showNotice('Graphics restarted');
        noteTimer = setTimeout(hideNotice, GPU_NOTE_MS);
      } else {
        gpu = 'lost';
        showNotice('The graphics couldn’t start again.', { label: 'Rebuild', onClick: () => rebuild() });
      }
    }
    build();
    const call = name => (...a) => (inner && typeof inner[name] === 'function' ? inner[name](...a) : undefined);
    return {
      destroy() {
        alive = false;
        clearTimeout(waitTimer); clearTimeout(noteTimer);
        const old = inner; inner = null;
        if (old) old.destroy();
        if (notice.parentNode) notice.parentNode.removeChild(notice);
      },
      pause: call('pause'),
      play: call('play'),
      feed: call('feed'),
      step: call('step'),
      showAlone(ids) { carry.alone = Array.isArray(ids) && ids.length ? ids.slice() : null; call('showAlone')(ids); },
      canvases: call('canvases'),
      feedOut: call('feedOut'),
      renderAt: call('renderAt'),
      renderAtAsync(t, o) { const p = call('renderAtAsync')(t, o); return p || Promise.resolve(null); },
      setPixelSize(s) { carry.pixelSize = s && s.w > 0 && s.h > 0 ? { w: s.w, h: s.h } : null; call('setPixelSize')(s); },
      seekVideos(t) { const p = call('seekVideos')(t); return p || Promise.resolve(); },
      get: call('get'),
      set: call('set'),
      fire: call('fire'),
      hasSound: !!(inner && inner.hasSound),
      sound(audible) { carry.sound = !!audible; call('sound')(audible); },
      usesCamera: !!(inner && inner.usesCamera),
      setScript(layerId, code) { if (typeof layerId === 'string' && typeof code === 'string') carry.scripts.set(layerId, code); call('setScript')(layerId, code); },
      still: call('still'),
      /** Mount again on a fresh context from where the clock and the controls are (what the Rebuild button does). */
      rebuild() { rebuild(); },
      /** 'ok', or 'lost' while the GPU is away; `restarts` counts the rebuilds so far. */
      gpu() { return { state: gpu, restarts }; },
    };
  }

  function mountOnce(root, B, opts, gpuHooks) {
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
    // Follow: another window (the app's output window) drives this mount. Its clock, the pointer, the
    // uniforms, the layers' numbers and the actions come through feed(); its own mapping engine, inputs
    // and sound stay off, and the host draws each frame with step() instead of an animation frame.
    const follow = !!opts.follow;
    const fed = { t: 0, playing: true, pointer: null, uniforms: null, layers: null, actions: [], alpha: [] };
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
    // Context loss (see mount above): stop drawing, tell the wrapper; preventDefault so the browser
    // fires webglcontextrestored when the GPU is back. The Finish stack's context counts the same.
    let ctxLost = false;
    const watchContext = canvas => {
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ctxLost = true; if (gpuHooks) gpuHooks.lost(); });
      canvas.addEventListener('webglcontextrestored', () => { if (gpuHooks) gpuHooks.restored(); });
    };
    watchContext(glCanvas);
    if (finishR && fnCanvas) watchContext(fnCanvas);
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
      // Recorded in a browser, a video can say its length is Infinity until a seek past the end
      // works it out (as the app's play/videoLayers.ts does): without it, the clock can't place it.
      e.addEventListener('loadedmetadata', () => {
        if (e.duration !== Infinity) return;
        const back = () => { e.removeEventListener('durationchange', back); e.currentTime = 0; };
        e.addEventListener('durationchange', back);
        e.currentTime = 1e7;
      });
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
        // Every video's sound → the master chain → the speakers.
        vSound.bus = vSound.ctx.createGain();
        afxAttach(vSound.ctx, 'master', vSound.bus, vSound.ctx.destination, null);
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
          afxAttach(vSound.ctx, 'layer:' + l.id, src, g, an);
          g.connect(vSound.bus);
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
    // The pad grid (play.padGrid, kit/midi.js): pads from the shared MIDI listener, applied on this player's clock.
    const KM = typeof SSKit !== 'undefined' && SSKit.midi ? SSKit.midi : null;
    const padCfg = play.padGrid && KM ? play.padGrid : null;
    const padG = padCfg ? KM.gridFit(null, padCfg) : null;
    // The Pad Grid node's texture (one texel per cell), filled before each frame.
    const padTex = !bgOnly && padG && /\bu_padGrid\b/.test(B.fragmentShader) ? gl.createTexture() : null;
    const padBytes = padTex ? new Uint8Array(padCfg.cols * padCfg.rows * 4) : null;
    if (padTex) {
      gl.bindTexture(gl.TEXTURE_2D, padTex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    // The graph's Layers node: the layers' colour and distance field, uploaded after each frame's layers are drawn.
    const usesLayersNode = !bgOnly && /\bu_layers(Field)?\b/.test(B.fragmentShader);
    let layersTap = null, layersColourTex = null, layersFieldTex = null, layersFieldSize = [0, 0];
    // The distance field on the GPU (kit/jfa.js, a jump flood over the colour's alpha) on WebGL2;
    // the kit's CPU field (16-bit packed, u_layersFieldLinear 0) where that can't run.
    const layersJfa = usesLayersNode && gl2 && typeof SSKit !== 'undefined' && SSKit.jfa ? SSKit.jfa.create(gl) : null;
    let layersGpuField = null;
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
        const out = layersJfa ? layersJfa.run({ texture: layersColourTex, width: tap.color.width, height: tap.color.height }) : null;
        if (out) {
          layersGpuField = out.texture;
          layersFieldSize = [out.width, out.height];
        } else {
          layersGpuField = null;
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, layersFieldTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tap.gw, tap.gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, tap.field);
          layersFieldSize = [tap.gw, tap.gh];
        }
        gl.activeTexture(gl.TEXTURE0);
      };
    }

    // Size: contain letterboxes to the exported shape; cover fills the box.
    const ratio = fit === 'contain' && B.aspect && B.aspect.ratio ? B.aspect.ratio : null;
    let needsDraw = true;
    // pixelSize: a drawing buffer of exactly that many pixels, whatever the box's size on screen
    // (a capture at 1920 × 1080 shown scaled down); the box is then measured untransformed.
    let pixelSize = opts.pixelSize && opts.pixelSize.w > 0 && opts.pixelSize.h > 0 ? opts.pixelSize : null;
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
    const finish = play.finish && Array.isArray(play.finish.effects) ? { on: play.finish.on !== false, effects: play.finish.effects.map(e => Object.assign({}, e)), compare: play.finish.compare ? Object.assign({ id: 'compare' }, play.finish.compare) : undefined } : null;
    if (finish) for (const e of finish.effects) layersById.set('finish:' + e.id, e);
    // The before/after wipe's numbers are driven the same way (finish:compare::pos).
    if (finish && finish.compare) layersById.set('finish:compare', finish.compare);
    // Audio effects (the kit's audioFx.js): each effect's numbers are driven like layer properties too, under 'audiofx:<chain>:<effect>'.
    const AFK = typeof SSKit !== 'undefined' && SSKit.audioFx ? SSKit.audioFx : null;
    const afxChains = play.audioFx && play.audioFx.chains ? play.audioFx.chains : {};
    const afxPre = !!(play.audioFx && play.audioFx.analyse === 'pre');
    for (const cid of Object.keys(afxChains)) for (const e of afxChains[cid].effects || []) layersById.set('audiofx:' + cid + ':' + e.id, e);
    // Racks' Macro Controls: each rack's macro values (1..8) are driven like layer properties under 'macro:<rackId>'.
    const MCK = typeof SSKit !== 'undefined' && SSKit.macros ? SSKit.macros : null;
    for (const r of (play.audioEngine && play.audioEngine.racks) || []) {
      const mv = {};
      (r.macros || []).forEach((m, i) => { mv[String(i + 1)] = typeof m.value === 'number' ? m.value : 0; });
      layersById.set('macro:' + r.id, mv);
    }
    const afxSlots = [];
    const afxUpdate = sl => sl.c.update(afxChains[sl.chainId], (e, k) => layerValue('audiofx:' + sl.chainId + ':' + e.id, k, e[k]), sl.ctx.currentTime);
    // A sound through its chain: inlet → chain → outlet (null: only analysed), the analyser after the chain (or before).
    function afxAttach(ctx, chainId, inlet, outlet, an) {
      if (!AFK) { if (outlet) inlet.connect(outlet); if (an) inlet.connect(an); return; }
      const rec = afxChains[chainId];
      if (rec && AFK.needsWorklet([rec])) AFK.loadWorklet(ctx);
      const c = AFK.chain(ctx);
      inlet.connect(c.input);
      if (outlet) c.output.connect(outlet);
      if (an) (afxPre ? inlet : c.output).connect(an);
      const sl = { ctx, chainId, c };
      afxSlots.push(sl);
      afxUpdate(sl);
    }
    const base = new Map(), live = new Map(), layerLive = new Map(), smooth = new Map(), trig = new Map(), actLevel = new Map();
    const mouse = { x: 0.5, y: 0.5, down: 0, over: false };
    let time = typeof opts.startTime === 'number' && isFinite(opts.startTime) ? Math.max(0, opts.startTime) : 0, playing = !opts.paused, lastNow = 0, frame = 0;
    const bindings = B.paramBindings || {};
    const uniformFor = c => bindings[bindingKey(c.target)];
    for (const c of play.controls) {
      const lt = layerTarget(c.target);
      if (lt) { const l = layersById.get(lt.layerId); if (l && typeof l[lt.key] === 'number') base.set(c.id, l[lt.key]); }
      else if (readerTarget(c.target)) base.set(c.id, 0);
      else if (grainsTarget(c.target)) base.set(c.id, 0);
      else { const u = uniformFor(c); if (u && uniformValues[u] !== undefined) base.set(c.id, Array.isArray(uniformValues[u]) ? uniformValues[u].slice() : uniformValues[u]); }
    }
    // Layers talk back: sensors (zone fill, speed…) and where following nulls are. The layer kit (inlined ahead of this file) draws them.
    const sensors = new Map(), overrides = new Map();
    const K = typeof SSKit !== 'undefined' ? SSKit.createLayerKit() : null;
    const layerValue = (id, key, fb) => { const k = id + '::' + key; let v = overrides.get(k); if (v === undefined) v = layerLive.get(k); return v === undefined ? fb : v; };
    const value = (l, k) => layerValue(l.id, k, l[k]);
    // Drum pad layers (the kit's drumPads.js): each pad's sample from its data URL, or a generated drum,
    // decoded as the page opens; heard once the visitor's first click or key lets sound start.
    const DPK = typeof SSKit !== 'undefined' && SSKit.drumPads ? SSKit.drumPads : null;
    const drumLayers = DPK ? play.layers.filter(l => l.kind === 'drumpad' && l.visible) : [];
    const drums = { ctx: null, kits: new Map(), wired: false };
    if (drumLayers.length && !follow) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        drums.ctx = new AC();
        for (const l of drumLayers) {
          const kit = { l, sampler: null, an: null, freq: null, out: null, buffers: l.pads.map(() => null) };
          drums.kits.set(l.id, kit);
          l.pads.forEach((p, i) => {
            if (p.src) fetch(p.src).then(r => r.arrayBuffer()).then(b => drums.ctx.decodeAudioData(b)).then(buf => { kit.buffers[i] = buf; }, () => {});
            else if (p.synth) kit.buffers[i] = DPK.synth(drums.ctx, p.synth);
          });
        }
      }
    }
    // Each kit: sampler → its effect chain (`layer:<id>`, analysed for the readers) → its volume → the master chain.
    function wireDrums() {
      if (drums.wired || !drums.ctx) return;
      drums.wired = true;
      const bus = drums.ctx.createGain();
      afxAttach(drums.ctx, 'master', bus, drums.ctx.destination, null);
      for (const k of drums.kits.values()) {
        k.sampler = DPK.sampler(drums.ctx);
        k.an = drums.ctx.createAnalyser(); k.an.fftSize = 2048; k.an.smoothingTimeConstant = 0.8; k.freq = new Float32Array(k.an.frequencyBinCount);
        k.out = drums.ctx.createGain(); k.out.gain.value = Math.max(0, k.l.volume);
        afxAttach(drums.ctx, 'layer:' + k.l.id, k.sampler.output, k.out, k.an);
        k.out.connect(bus);
      }
    }
    function startDrums() { if (!drums.ctx || !alive) return; wireDrums(); if (drums.ctx.state === 'suspended') drums.ctx.resume(); }
    // A hit: { layerId, amount (pad number from 1), vel (0 lets a gate pad go) }.
    function drumAct(a) {
      const k = drums.kits.get(a.layerId);
      if (!k) return;
      startDrums();
      const pad = Math.round(a.amount) - 1, vel = a.vel == null ? 1 : a.vel;
      if (!k.l.pads[pad] || !k.sampler) return;
      if (vel <= 0) { k.sampler.release(pad); return; }
      // The sound comes from the indexed pad (docs/drum-pads.md "Sample index"); a take says which.
      const src = a.slot >= 1 ? a.slot - 1 : pickSlot(k.l, pad);
      const p = k.l.pads[src] || k.l.pads[pad];
      const buf = k.buffers[src] || k.buffers[pad];
      if (!buf) return;
      k.out.gain.value = Math.max(0, value(k.l, 'volume'));
      k.sampler.hit(pad, Object.assign(DPK.numbers(key => value(k.l, DPK.key(src, key))), { buffer: buf, mode: p.mode, loop: p.loop, reverse: p.reverse, choke: p.choke, velocity: vel }));
    }
    const drumHits = new Map();
    function pickSlot(l, pad) {
      if (!DPK.pick) return pad;
      const slots = DPK.slots(i => { const q = l.pads[i]; return !!q && (!!q.sampleId || !!q.synth); }, l.pads.length);
      const n = (drumHits.get(l.id) || 0) + 1; drumHits.set(l.id, n);
      return DPK.pick(slots, pad, value(l, 'sampleIndex'), l.indexMode || 'index', value(l, 'indexSpread'), DPK.hash(l.indexSeed || 0, n));
    }
    const drumHit = (pad, vel) => { for (const l of drumLayers) drumAct({ layerId: l.id, amount: pad + 1, vel }); };
    // Granulator racks (the kit's granulator.js, docs/granulator.md): each one's grains in an AudioWorklet (else a
    // ScriptProcessor) → its Sound chain (`rack:<id>`, analysed for the readers as `engine:<id>`) → its volume → the
    // master chain. Heard once the visitor's first click or key lets sound start; notes from Web MIDI and `ae:<id>`
    // pad actions; its settings driven like layer properties under 'au:<id>:inst'; its grains reported as sensors.
    const GRK = typeof SSKit !== 'undefined' && SSKit.granulator ? SSKit.granulator : null;
    const grainRacks = GRK && !follow && play.audioEngine ? (play.audioEngine.racks || []).filter(r => r.instrument && r.instrument.kind === 'granulator' && !r.source && !r.mute) : [];
    const grains = { ctx: null, racks: new Map(), wired: false };
    const grainsBright = grainRacks.some(r => r.instrument.from && (r.instrument.from.links || []).some(l => l.on !== false && l.prop === 'bright'));
    if (grainRacks.length) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        grains.ctx = new AC();
        for (const r of grainRacks) {
          const params = {};
          for (const p of GRK.params) params[String(p.addr)] = r.instrument.params && typeof r.instrument.params[p.addr] === 'number' ? r.instrument.params[p.addr] : p.value;
          layersById.set('au:' + r.id + ':inst', params);
          const g = { r, params, live: null, an: null, freq: null, out: null, buffer: null, stats: null };
          grains.racks.set(r.id, g);
          const sm = r.instrument.sample || {};
          if (sm.synth) g.buffer = GRK.synth(grains.ctx, sm.synth);
          else if (sm.src) fetch(sm.src).then(x => x.arrayBuffer()).then(b => grains.ctx.decodeAudioData(b)).then(buf => { g.buffer = buf; if (g.live) g.live.setBuffer(buf); }, () => {});
        }
      }
    }
    function wireGrains() {
      if (grains.wired || !grains.ctx) return;
      grains.wired = true;
      const bus = grains.ctx.createGain();
      afxAttach(grains.ctx, 'master', bus, grains.ctx.destination, null);
      for (const g of grains.racks.values()) {
        g.live = GRK.create(grains.ctx, { seed: 1 });
        g.an = grains.ctx.createAnalyser(); g.an.fftSize = 2048; g.an.smoothingTimeConstant = 0.8; g.freq = new Float32Array(g.an.frequencyBinCount);
        g.out = grains.ctx.createGain(); g.out.gain.value = Math.max(0, g.r.volume == null ? 1 : g.r.volume);
        afxAttach(grains.ctx, 'rack:' + g.r.id, g.live.output, g.out, null);
        g.out.connect(g.an); g.out.connect(bus);
        if (g.buffer) g.live.setBuffer(g.buffer);
        tickGrains();
      }
    }
    function startGrains() { if (!grains.ctx || !alive) return; wireGrains(); if (grains.ctx.state === 'suspended') grains.ctx.resume(); }
    // Every frame: the settings as mappings drive them, and the grains out as sensors (`ae:<id>::grains`…).
    function tickGrains() {
      for (const g of grains.racks.values()) {
        const id = 'au:' + g.r.id + ':inst';
        if (g.live) g.live.set(GRK.settings(g.params, (a, b) => grainMacro(g.r, a, layerValue(id, a, b))));
        const st = g.live ? g.live.stats() : null;
        if (!st) continue;
        const sum = GRK.summary(st), k = 'ae:' + g.r.id + '::';
        sensors.set(k + 'grains', sum.grains); sensors.set(k + 'grainMean', sum.mean); sensors.set(k + 'grainSpread', sum.spread); sensors.set(k + 'grainLevel', sum.level); sensors.set(k + 'grainPitch', sum.pitch); sensors.set(k + 'grainBandMean', sum.band || 0); sensors.set(k + 'grainEnergySum', sum.energy || 0);
        for (let i = 0; i < 16; i++) { sensors.set(k + 'grainPos' + (i + 1), i < st.count ? st.pos[i] : 0); sensors.set(k + 'grainAmp' + (i + 1), i < st.count ? Math.min(1, st.amp[i]) : 0); sensors.set(k + 'grainBand' + (i + 1), i < st.count && st.band ? st.band[i] : 0); sensors.set(k + 'grainEnergy' + (i + 1), i < st.count && st.energy ? Math.min(1, st.energy[i] * 4) : 0); }
      }
    }
    // A setting a driven macro turns: the macro's value through the target's curve and range (the kit's macros.js); else as it was.
    function grainMacro(r, addr, fallback) {
      if (!MCK || !r.macros) return fallback;
      for (let i = 0; i < r.macros.length; i++) {
        const m = r.macros[i];
        for (const t of m.targets || []) {
          if (t.slot !== 'inst' || t.address !== addr) continue;
          const v = layerValue('macro:' + r.id, String(i + 1), NaN);
          if (v === v) return MCK.value(v, t);
        }
      }
      return fallback;
    }
    // A rack's note: `ae:<id>` pad actions carry note + 1 and the velocity (0 lets it go).
    function grainNote(rackId, note, vel) {
      const g = grains.racks.get(rackId);
      if (!g) return;
      startGrains();
      if (!g.live) return;
      if (vel > 0) g.live.noteOn(note, vel); else g.live.noteOff(note);
    }
    // Play pad actions go to the drums; every other action to the layer kit.
    if (K && drumLayers.length) { const kitAct = K.act; K.act = a => (a.do === 'pad' ? drumAct(a) : kitAct(a)); }
    if (K && grains.racks.size) { const kitAct = K.act; K.act = a => (a.do === 'pad' && typeof a.layerId === 'string' && a.layerId.indexOf('ae:') === 0 ? grainNote(a.layerId.slice(3), Math.round(a.amount) - 1, a.vel == null ? 1 : a.vel) : kitAct(a)); }
    const actions = (play.actions || []).filter(a => a.enabled);
    // Conditions, signals and axis swaps: the kit's signals.js, the same code the app runs.
    const SG = typeof SSKit !== 'undefined' && SSKit.signals ? SSKit.signals : null;
    const pairs = new Map((play.pairs || []).map(p => [p.id, p]));
    const pairMappings = (play.pairMappings || []).filter(m => m.enabled && pairs.has(m.pairId));
    const pairState = new Map();
    // Increment mappings (the kit's increment.js, as the app runs them): their trigger and reset signal count presses like any other trigger.
    const INC = typeof SSKit !== 'undefined' && SSKit.increment ? SSKit.increment : null;
    const incMappings = play.mappings.filter(m => m.enabled && m.increment);
    const incState = new Map(), incFire = new Map(), incCond = new Map();
    const allTriggers = play.mappings.filter(m => m.enabled && m.source.kind === 'trigger').map(m => m.source.trigger).concat(actions.map(a => a.trigger))
      .concat(incMappings.filter(m => m.increment.on === 'trigger').map(m => m.increment.trigger))
      .concat(incMappings.filter(m => m.increment.resetOn).map(m => ({ on: 'signal', signal: m.increment.resetOn })))
      .concat(pairMappings.filter(m => m.source.kind === 'value' && m.source.source.kind === 'trigger').map(m => m.source.source.trigger))
      // A signal defined by a trigger listens to it like any other (the app's playEngine does the same).
      .concat((play.signals || []).filter(s => s.when && s.when.kind === 'trigger').map(s => s.when.trigger));
    const gamepad = i => (navigator.getGamepads ? navigator.getGamepads()[i] : null);
    const padQueue = [];
    function tickPads() { if (!padG) return; for (const m of padQueue.splice(0)) KM.gridMessage(padG, padCfg, m[0], m[1], m[2], m[3], time); }
    const keysUsed = new Set();
    for (const m of play.mappings) {
      if (!m.enabled) continue;
      if (m.source.kind === 'key') keysUsed.add(m.source.code);
      if (m.source.kind === 'trigger' && m.source.trigger.on === 'key') keysUsed.add(m.source.trigger.code);
    }
    for (const a of actions) if (a.trigger.on === 'key') keysUsed.add(a.trigger.code);
    for (const s of play.signals || []) if (s.when && s.when.kind === 'trigger' && s.when.trigger.on === 'key') keysUsed.add(s.when.trigger.code);
    for (const m of incMappings) if (m.increment.on === 'trigger' && m.increment.trigger.on === 'key') keysUsed.add(m.increment.trigger.code);
    for (const m of pairMappings) { const s = m.source.kind === 'value' ? m.source.source : null; if (s && s.kind === 'key') keysUsed.add(s.code); if (s && s.kind === 'trigger' && s.trigger.on === 'key') keysUsed.add(s.trigger.code); }
    function readSource(s) {
      switch (s.kind) {
        case 'mouse': return s.axis === 'x' ? mouse.x : s.axis === 'y' ? mouse.y : mouse.down;
        case 'key': return shared.keysHeld.has(s.code) ? 1 : 0;
        case 'lfo': return lfo(s.shape, time * s.rate + s.phase);
        case 'noise': return noiseAt(s.type, time, s.rate, s.seed, s.steps, frame);
        case 'clock': return lfo(s.shape, time * (s.bpm / 60 / Math.max(0.0625, s.beats)));
        case 'fn': { const FNK = typeof SSKit !== 'undefined' && SSKit.fn ? SSKit.fn : null; const v = FNK ? FNK.eval(s.expr, { t: time, b: time * 2 }).value : 0; return Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min))); }
        case 'tilt': { const t = shared.tilt; if (!t.got) return null; if (s.axis === 'alpha') return ((t.alpha % 360) + 360) % 360 / 360; const v = Math.max(-90, Math.min(90, s.axis === 'beta' ? t.beta : t.gamma)); return (v + 90) / 180; }
        case 'gamepad': { const p = gamepad(s.pad); if (!p) return null; if (s.control === 'axis') { const a = p.axes[s.index]; return a === undefined ? null : Math.max(0, Math.min(1, (a + 1) / 2)); } const b = p.buttons[s.index]; return b ? b.value : null; }
        case 'pad': return padG ? KM.gridRead(padG, padCfg, s.read, s.col, s.row, time) : null;
        case 'midi': {
          // Locked knobs (whichever moved last) and note ranges, as the app reads them (kit/midi.js).
          if (KM && s.signal === 'cc' && s.locks && s.locks.length) { const v = KM.lockRead(shared.midiLocks, s.locks); return v === null ? null : v / 127; }
          const chr = shared.midi[Math.max(0, Math.min(16, s.channel))];
          if (KM && s.range && (s.signal === 'note' || s.signal === 'velocity' || s.signal === 'gate')) { const r = KM.rangeRead(chr.noteSeq, chr.noteVel, chr.held, s.range); if (r.note < 0) return null; return s.signal === 'note' ? KM.noteUnit(s.range, r.note) : s.signal === 'velocity' ? r.vel / 127 : r.gate ? 1 : 0; }
          const ch = chr; switch (s.signal) { case 'note': return ch.seenNote ? ch.note / 127 : null; case 'velocity': return ch.seenNote ? ch.vel / 127 : null; case 'gate': return ch.seenNote ? (ch.held.size ? 1 : 0) : null; case 'bend': return ch.seenBend ? (ch.bend + 1) / 2 : null; case 'cc': { if (typeof s.cc !== 'number') return null; const n = s.cc & 127; return ch.seenCc[n] ? ch.cc[n] / 127 : null; } } return null; }
        case 'audio': { const a = audioById.get(s.nodeId); if (!a || !a.an) return null; const v = a.levels[s.band]; return v === undefined ? null : v; }
        case 'live': { if (shared.live.status !== 'on') return null; updateLive(); return Math.max(0, Math.min(1, shared.live.v[s.band] * s.gain)); }
        case 'reader': { updateReaders(); return readers.ok && readers.levels.has(s.readerId) ? readers.levels.get(s.readerId) : null; }
        case 'osc': { const a = shared.osc.get(s.address); if (!a) return null; const raw = a[s.arg]; const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : null; return v === null ? null : Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min))); }
        case 'null': { const l = layersById.get(s.layerId); if (!l) return null; return Math.max(0, Math.min(1, layerValue(l.id, s.axis, l[s.axis]))); }
        case 'hand': return handSt ? HK.read(handSt, s.side, s.read, s.point, s.axis, s.gesture) : null;
        case 'face': case 'pose': { const sj = subjects[s.kind]; return sj ? sj.K.read(sj.st, s.read, s.point, s.axis, s.gesture) : null; }
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
        // Set (the app's playEngine): the number a signal captured; after it lets go, stay, go back or go to a value.
        case 'captured': {
          const v = sigPayload.get(s.signal);
          if (typeof v !== 'number') return null;
          if (s.release === 'stay' || sigLevel(s.signal)) return v;
          return s.release === 'value' ? (s.rest || 0) : null;
        }
        case 'sensor': {
          if (s.read === 'distance') {
            const d = s.otherId ? anchorGap(s.layerId, s.otherId) : null;
            return d === null ? null : Math.min(1, d);
          }
          const v = sensors.get(s.layerId + '::' + s.read + (s.read === 'grainPos' || s.read === 'grainAmp' || s.read === 'grainBand' || s.read === 'grainEnergy' ? (s.otherId || '1') : ''));
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
      // On a page the pointer is the picture's: `mouse` and `pointer` are the same.
      if (ref === 'mouse' || ref === 'pointer') return { x: mouse.x, y: mouse.y };
      // Where a particles layer's latest birth, death or annihilation was (the kit reports it).
      const evm = /^ev:(.+):(born|died|annihilate)$/.exec(ref);
      if (evm) { const x = sensors.get(evm[1] + '::' + evm[2] + 'X'), y = sensors.get(evm[1] + '::' + evm[2] + 'Y'); return isFinite(x) && isFinite(y) && x !== undefined && y !== undefined ? { x, y } : null; }
      // A signal's captured position: sig:<id>, or sig:<id>:held only while the signal is true.
      if (ref.indexOf('sig:') === 0) {
        const held = /:held$/.test(ref), id = ref.slice(4, held ? -5 : undefined);
        const p = sigPayload.get(id);
        return p && typeof p === 'object' && (!held || sigLevel(id)) ? p : null;
      }
      // The pad grid's last pad (column across, row up, 0..1), like the Pad grid X and Y sources.
      if (ref === 'pad:last') {
        if (!padG) return null;
        const x = KM.gridRead(padG, padCfg, 'x', 0, 0, time), y = KM.gridRead(padG, padCfg, 'y', 0, 0, time);
        return x === null || y === null ? null : { x, y };
      }
      const pt = SG ? SG.point(ref) : null;
      if (pt) return pt;
      const h = handAnchorOf(ref);
      if (h) return handSt && usesHands ? HK.point(handSt, h.side, h.point) : null;
      const tm = /^(face|pose):(\d{1,3})$/.exec(ref);
      if (tm) { const sj = subjects[tm[1]]; return sj ? sj.K.point(sj.st, +tm[2]) : null; }
      const l = layersById.get(ref);
      return l && typeof SSKit !== 'undefined' && SSKit.anchor ? SSKit.anchor(l, k => value(l, k), glCanvas.width / Math.max(1, glCanvas.height), reported, anchorLookup) : null;
    }
    function anchorGap(a, b) {
      const pa = anchorAt(a), pb = anchorAt(b);
      return pa && pb ? Math.hypot((pa.x - pb.x) * glCanvas.width / Math.max(1, glCanvas.height), pa.y - pb.y) : null;
    }
    // A condition's value now (the kit's sgParseValueRef): a control, a layer's or Finish number, a mapping's source, the pointer, a distance.
    function readValue(ref) {
      const r = SG ? SG.parseRef(ref) : null;
      if (!r) return null;
      if (r.kind === 'control') { const c = controls.get(r.id); const v = !c ? undefined : live.has(c.id) ? live.get(c.id) : base.get(c.id); return v === undefined ? null : Array.isArray(v) ? (v[0] + v[1] + v[2]) / 3 : v; }
      if (r.kind === 'mapping') { const m = play.mappings.find(x => x.id === r.id); if (!m) return null; if (m.increment) { const st = incState.get(m.id); if (!st || !INC) return null; const rg = INC.range(m.outMin, m.outMax); return rg[1] > rg[0] ? Math.max(0, Math.min(1, (INC.fold(st.p, rg[0], rg[1], m.increment.limit) - rg[0]) / (rg[1] - rg[0]))) : 0; } if (m.source.kind === 'trigger') { const st = trig.get(m.id); return st ? st.value : 0; } return readSource(m.source); }
      if (r.kind === 'mouse') return r.axis === 'x' ? mouse.x : mouse.y;
      if (r.kind === 'distance') return anchorGap(r.a, r.b);
      if (r.kind === 'reading') return readSource({ kind: 'sensor', layerId: r.layerId, read: r.read, otherId: '' });
      if (r.kind === 'axis') { const p = anchorAt(r.anchor); return p ? (r.axis === 'x' ? p.x : p.y) : null; }
      // The picture's brightness, from the layer kit's grid of the last frame (the app's PICTURE_PATCH around a position).
      if (r.kind === 'picture') {
        if (!K || !K.pictureAt) return null;
        if (r.region === 'all') return K.pictureAt(null, null, 0, r.ch);
        const p = anchorAt(r.region);
        return p ? K.pictureAt(p.x, p.y, 0.05, r.ch) : null;
      }
      const l = layersById.get(r.layerId);
      return l && typeof l[r.key] === 'number' ? layerValue(r.layerId, r.key, l[r.key]) : null;
    }
    // A percent condition's range (the app's play/conditionRange.ts, carried in the bundle); null: raw, or the range seen so far.
    const condRanges = play.condRanges || {};
    function condRange(c) { return c.unit === 'pct' ? condRanges[c.value] || null : null; }
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
      else f.slot.count += Math.min(4, stepFire(f.slot.st, t.fire, inp.presses, inp.gate, dt, time));
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
      // A Drum pad layer's sound (`pads:<id>`), once the first click or key has let it start.
      const dk = R.cfg.input && R.cfg.input.indexOf('pads:') === 0 ? drums.kits.get(R.cfg.input.slice(5)) : null;
      // A Granulator rack's sound (`engine:<id>`), once the first click or key has let it start.
      const gk = R.cfg.input && R.cfg.input.indexOf('engine:') === 0 ? grains.racks.get(R.cfg.input.slice(7)) : null;
      if (gk) { if (gk.an) { gk.an.getFloatFrequencyData(gk.freq); freq = gk.freq; sr = gk.an.context.sampleRate; } }
      else if (dk) { if (dk.an) { dk.an.getFloatFrequencyData(dk.freq); freq = dk.freq; sr = dk.an.context.sampleRate; } }
      else if (vid) { if (vid.an) { vid.an.getFloatFrequencyData(vid.freq); freq = vid.freq; sr = vid.an.context.sampleRate; } }
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
    const zoneGates = new Set();
    // Conditions, proximity among them: becoming true is a press, false again its release; a crossing is both at once.
    const condStates = new Map();
    function tickConditionTriggers(dt) {
      if (!SG) return;
      const seen = new Set();
      for (const t of allTriggers) {
        if (t.on !== 'proximity' && t.on !== 'value') continue;
        const k = triggerKey(t);
        if (seen.has(k)) continue;
        seen.add(k);
        const c = t.on === 'proximity' ? proximityCondition(t) : t;
        let st = condStates.get(k);
        if (!st) { st = SG.condNew(); condStates.set(k, st); }
        const ev = SG.condStep(st, readValue(c.value), c, condRange(c), dt);
        if (ev === 'open') press(k);
        else if (ev === 'close') release(k);
        else if (ev === 'tap') { press(k); release(k); }
      }
    }
    // A signal: its "When signal fires" triggers see a press and its release at once.
    // Signals sent this frame (by an action or a layer): true for the frame, for combinations to read.
    const sigSent = new Set(), sigLevels = new Map(), sigSeen = new Map(), sigPayload = new Map();
    const sigById = new Map((play.signals || []).map(s => [s.id, s]));
    function sigLevel(id) { return (sigLevels.get(id) || false) || sigSent.has(id); }
    // What a signal captures (sample and hold): a number from a value path, or a position from pos:<anchor>.
    function capture(s) {
      const c = s.capture;
      if (!c) return;
      let v;
      if (c.what.indexOf('pos:') === 0) { const p = anchorAt(c.what.slice(4)); v = p ? { x: p.x, y: p.y } : null; }
      else v = readValue(c.what);
      if (v !== null && v !== undefined) sigPayload.set(s.id, v);
    }
    function emitSignal(id) { sigSent.add(id); const s = sigById.get(id); if (s && s.capture && !s.when) capture(s); const k = 'sig:' + id; press(k); release(k); }
    // Level signals (the app's playEngine tickSignalLevels): each defined signal is true while its trigger is held or
    // met, or while its combination of others holds; rising presses its key and holds it, falling lets go.
    const sigDefs = (() => {
      const list = play.signals || [];
      if (!SG || !SG.order) return [];
      const byId = new Map(list.map(s => [s.id, s]));
      return SG.order(list).order.map(id => byId.get(id)).filter(s => s && s.when);
    })();
    function tickSignalLevels() {
      for (const s of sigDefs) {
        const w = s.when;
        let level;
        if (w.kind === 'trigger') {
          const inp = triggerInput(w.trigger);
          const seen = sigSeen.has(s.id) ? sigSeen.get(s.id) : inp.presses;
          sigSeen.set(s.id, inp.presses);
          level = inp.gate || inp.presses > seen;
        } else level = SG.logic(w.op, w.inputs.map(i => (sigLevels.get(i) || false) || sigSent.has(i)));
        const was = sigLevels.get(s.id) || false;
        sigLevels.set(s.id, level);
        const at = s.capture && s.capture.at;
        if ((at === 'rise' && level && !was) || (at === 'fall' && !level && was) || (at === 'held' && level)) capture(s);
        if (level && !was) press('sig:' + s.id);
        else if (!level && was) release('sig:' + s.id);
      }
      sigSent.clear();
    }
    // Relationship layers: each catch the kit counted (`<id>::caught`) sends the layer's catch signal.
    const caughtSeen = new Map();
    function tickRelationshipSignals() {
      for (const l of play.layers) {
        if (l.kind !== 'relationship') continue;
        const n = sensors.get(l.id + '::caught') || 0, last = caughtSeen.get(l.id);
        caughtSeen.set(l.id, n);
        if (last !== undefined && n > last && l.catchSignal) emitSignal(l.catchSignal);
      }
    }
    // Multiply layers: each split, full, annihilate and cleared the kit counted sends the layer's matching signal.
    const multiplySeen = new Map();
    function tickMultiplySignals() {
      for (const l of play.layers) {
        if (l.kind !== 'particles' || l.emit !== 'multiply') continue;
        const split = sensors.get(l.id + '::split') || 0, full = sensors.get(l.id + '::full') || 0;
        const annihilate = sensors.get(l.id + '::annihilate') || 0, cleared = sensors.get(l.id + '::cleared') || 0;
        const last = multiplySeen.get(l.id);
        multiplySeen.set(l.id, { split, full, annihilate, cleared });
        if (!last) continue;
        if (split > last.split && l.splitSignal) emitSignal(l.splitSignal);
        if (full > last.full && l.fullSignal) emitSignal(l.fullSignal);
        if (annihilate > last.annihilate && l.annihilateSignal) emitSignal(l.annihilateSignal);
        if (cleared > last.cleared && l.clearedSignal) emitSignal(l.clearedSignal);
      }
    }
    // Every particles layer (any Emit mode) and every Agents layer: the kit counts how many were born and
    // how many died, cumulative (the kit itself reports the delta as the born/died readings). A rise in
    // either since last tick sends the layer's signal (once a tick, however many were involved).
    const bornDiedSeen = new Map();
    function tickBornDiedSignals() {
      for (const l of play.layers) {
        if (l.kind !== 'particles' && l.kind !== 'agents') continue;
        const born = sensors.get(l.id + '::bornCount') || 0, died = sensors.get(l.id + '::diedCount') || 0;
        const last = bornDiedSeen.get(l.id);
        bornDiedSeen.set(l.id, { born, died });
        if (!last) continue;
        if (born > last.born && l.bornSignal) emitSignal(l.bornSignal);
        if (died > last.died && l.diedSignal) emitSignal(l.diedSignal);
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
    let handSt = HK ? HK.create() : null;
    const handSettings = Object.assign({ smoothing: 0.5, overlay: true, colour: [0.35, 1, 0.75], mirror: true }, play.hands || {});
    // A condition on a distance to or from a hand point reads hands too.
    const condHands = c => { if (!c || typeof c.value !== 'string' || c.value.indexOf('dist:') !== 0) return false; const i = c.value.indexOf('|'); return i > 0 && (!!handAnchorOf(c.value.slice(5, i)) || !!handAnchorOf(c.value.slice(i + 1))); };
    const trigHands = t => t.on === 'hand' || (t.on === 'proximity' && (!!handAnchorOf(t.a) || !!handAnchorOf(t.b))) || (t.on === 'value' && condHands(t));
    const usesHands = play.mappings.some(m => m.source.kind === 'hand' || (m.source.kind === 'trigger' && trigHands(m.source.trigger)) || (!!m.increment && ((m.increment.on === 'trigger' && trigHands(m.increment.trigger)) || (m.increment.on === 'repeat' && condHands(m.increment.when)))) || (m.source.kind === 'sensor' && m.source.read === 'distance' && !!handAnchorOf(m.source.otherId || '')))
      || actions.some(a => trigHands(a.trigger)) || play.layers.some(l => l.kind === 'null' && l.follow === 'hand')
      || pairMappings.some(m => (m.source.kind === 'position' ? !!handAnchorOf(m.source.anchor) : m.source.source.kind === 'hand' || (m.source.source.kind === 'trigger' && trigHands(m.source.source.trigger))) || condHands(m.a.when) || condHands(m.b.when));
    // Baked tracks (docs/tracking.md): a Video layer the app analysed rides in the bundle (B.tracks, per tracker:
    // { layerId, data }), and a tracker on it reads the stored frames at the video's own time (the kit's tracks.js).
    // A tracker on a video that wasn't analysed stays at rest here (the page never runs a model on a video).
    const TK = typeof SSKit !== 'undefined' && SSKit.tracks ? SSKit.tracks : null;
    function bakedOf(kind) {
      const b = B.tracks && B.tracks[kind], settings = kind === 'hands' ? play.hands : play[kind];
      if (!TK || !b || !settings || settings.source !== b.layerId) return null;
      const l = layersById.get(b.layerId);
      if (!l || l.kind !== 'video') return null;
      if (b.track === undefined) { try { b.track = TK.decode(TK.fromBase64(b.data)); } catch (e) { b.track = null; } }
      return b.track && b.track.kind === kind ? { track: b.track, layer: l, drv: TK.driver() } : null;
    }
    const vtOf = bk => { const v = lVideos.get(bk.layer.id); return TK.videoTime(bk.layer, time, bk.track.duration, bk.layer.follow === false && v ? v.el.currentTime : null); };
    const handBaked = usesHands ? bakedOf('hands') : null;
    // Tracking a video with no analysis: nothing to read on the page, and no camera either.
    const handsFromCamera = !handSettings.source;
    if (usesHands && B.hands && handsFromCamera) { shared.hands.assets = B.hands; if (!shared.hands.options) shared.hands.options = HK.options(play.hands); }
    const handGates = new Set();
    let handSeq = -1;
    function tickHands() {
      if (!handSt || !usesHands) return;
      const H = shared.hands;
      if (handBaked) {
        const vt = vtOf(handBaked), picAspect = glCanvas.width / Math.max(1, glCanvas.height);
        TK.drive(handBaked.drv, handBaked.track, vt, () => { handSt = HK.create(); }, f => {
          const fr = TK.handsFrame(f), camAspect = fr.w / Math.max(1, fr.h);
          HK.update(handSt, fr, { picAspect, place: HK.placement(play, value, camAspect, picAspect, handSettings.mirror, handSettings.source), smoothing: handSettings.smoothing, responsiveness: handSettings.responsiveness, maxHands: handSettings.maxHands, swap: handSettings.swap });
        });
        HK.age(handSt, vt * 1000);
      } else if (handsFromCamera && H.frame && H.seq !== handSeq) {
        handSeq = H.seq;
        const picAspect = glCanvas.width / Math.max(1, glCanvas.height), camAspect = H.frame.w / Math.max(1, H.frame.h);
        HK.update(handSt, H.frame, { picAspect, place: HK.placement(play, value, camAspect, picAspect, handSettings.mirror), smoothing: handSettings.smoothing, responsiveness: handSettings.responsiveness, maxHands: handSettings.maxHands, swap: handSettings.swap });
      }
      if (!handBaked) HK.age(handSt, performance.now());
      for (const t of allTriggers) {
        if (t.on !== 'hand') continue;
        const k = triggerKey(t), on = HK.gate(handSt, t.side, t.gesture), open = handGates.has(k);
        if (on && !open) { handGates.add(k); press(k); }
        else if (!on && open) { handGates.delete(k); release(k); }
      }
    }
    // Faces and bodies: from a baked track only (the page carries no face or pose model).
    const trackAnchorOf = (ref, k) => typeof ref === 'string' && ref.indexOf(k + ':') === 0 && /^(face|pose):\d{1,3}$/.test(ref);
    const condTrack = (c, k) => { if (!c || typeof c.value !== 'string' || c.value.indexOf('dist:') !== 0) return false; const i = c.value.indexOf('|'); return i > 0 && (trackAnchorOf(c.value.slice(5, i), k) || trackAnchorOf(c.value.slice(i + 1), k)); };
    const trigTrack = (t, k) => t.on === k || (t.on === 'proximity' && (trackAnchorOf(t.a, k) || trackAnchorOf(t.b, k))) || (t.on === 'value' && condTrack(t, k));
    const srcTrack = (s, k) => s.kind === k || (s.kind === 'trigger' && trigTrack(s.trigger, k)) || (s.kind === 'sensor' && s.read === 'distance' && trackAnchorOf(s.otherId, k));
    const usesTrack = k => play.mappings.some(m => srcTrack(m.source, k) || (!!m.increment && ((m.increment.on === 'trigger' && trigTrack(m.increment.trigger, k)) || (m.increment.on === 'repeat' && condTrack(m.increment.when, k)))))
      || actions.some(a => trigTrack(a.trigger, k)) || play.layers.some(l => l.kind === 'null' && l.follow === k)
      || pairMappings.some(m => (m.source.kind === 'position' ? trackAnchorOf(m.source.anchor, k) : srcTrack(m.source.source, k)) || condTrack(m.a.when, k) || condTrack(m.b.when, k));
    const subjects = {};
    for (const k of ['face', 'pose']) {
      const SK = typeof SSKit !== 'undefined' ? SSKit[k] : null;
      if (!SK || !HK || !usesTrack(k)) continue;
      const bk = bakedOf(k);
      if (!bk) continue;
      subjects[k] = { K: SK, st: SK.create(), bk, settings: Object.assign({ smoothing: 0.5, overlay: true, colour: k === 'face' ? [1, 0.75, 0.35] : [0.45, 0.7, 1], mirror: true }, play[k] || {}) };
    }
    function tickSubjects() {
      for (const k in subjects) {
        const s = subjects[k], vt = vtOf(s.bk), picAspect = glCanvas.width / Math.max(1, glCanvas.height);
        TK.drive(s.bk.drv, s.bk.track, vt, () => { s.st = s.K.create(); }, f => {
          const camAspect = f.w / Math.max(1, f.h);
          s.K.update(s.st, f, { picAspect, place: HK.placement(play, value, camAspect, picAspect, s.settings.mirror, s.settings.source), smoothing: s.settings.smoothing, responsiveness: s.settings.responsiveness });
        });
        TK.subjectAge(s.st, vt * 1000);
      }
      for (const t of allTriggers) {
        if (t.on !== 'face' && t.on !== 'pose') continue;
        const s = subjects[t.on], k = triggerKey(t), on = !!s && s.K.gate(s.st, t.gesture), open = handGates.has(k);
        if (on && !open) { handGates.add(k); press(k); }
        else if (!on && open) { handGates.delete(k); release(k); }
      }
    }
    // Actions (burst, next line, drop…): by their trigger's mode, once per press unless it says every frame, every N or on release.
    // Send a signal passes its signal on down the chain in the same frame (each signal once a frame, a limited depth).
    function tickActions(dt) {
      // A chain looks at signal-fired actions again in the same frame: their clocks move once a frame (as the app does).
      const stepped = new Set();
      const fires = a => {
        const inp = triggerInput(a.trigger);
        const f = fireSlot(actionFire, a.id, a.trigger, inp.presses, inp.gate);
        const d = stepped.has(a.id) ? 0 : dt;
        stepped.add(a.id);
        return f.fresh ? 0 : Math.min(4, stepFire(f.slot.st, a.trigger.fire, inp.presses, inp.gate, d, time));
      };
      if (SG) { SG.runActions(actions, fires, a => { if (K) K.act(a); }, emitSignal); return; }
      for (const a of actions) { const n = fires(a); if (a.do !== 'signal' && K) for (let i = 0; i < n; i++) K.act(a); }
    }
    // Pair mappings: a position drives both axes (x → A, y → B), a single source A, B or both, each axis with its own
    // range, curve and smoothing; an axis whose condition doesn't hold keeps its last value; an axis swap moves between them.
    let lastTime = -Infinity;
    function writePlain(c, v, driven) {
      const lt = layerTarget(c.target);
      if (lt) layerLive.set(lt.layerId + '::' + lt.key, v);
      else { const un = uniformFor(c); if (un) uniformValues[un] = v; }
      live.set(c.id, v); driven.add(c.id);
    }
    function smoothAxis(prev, target, ax, dt) {
      if (ax.smoothMs <= 0 || prev === undefined) return target;
      const v = prev + (target - prev) * (1 - Math.exp(-(dt * 1000) / ax.smoothMs));
      return Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(ax.outMax - ax.outMin)) ? target : v;
    }
    function tickPairs(dt, driven) {
      if (!SG) return;
      for (const m of pairMappings) {
        const p = pairs.get(m.pairId), ca = controls.get(p.a), cb = controls.get(p.b);
        if (!ca || !cb) continue;
        let st = pairState.get(m.id);
        if (!st) { st = { a: undefined, b: undefined, swap: SG.swapNew(), condA: SG.condNew(), condB: SG.condNew() }; pairState.set(m.id, st); }
        let ua = null, ub = null;
        if (m.source.kind === 'position') { const pt = anchorAt(m.source.anchor); if (pt) { ua = Math.max(0, Math.min(1, pt.x)); ub = Math.max(0, Math.min(1, pt.y)); } }
        else { const src = m.source.source; ua = ub = src.kind === 'trigger' ? readTrigger({ id: m.id, source: src }, dt) : readSource(src); }
        const swapping = !!m.swap && m.source.kind === 'value';
        let useA = swapping ? st.swap.axis === 'a' : m.affect !== 'b', useB = swapping ? st.swap.axis === 'b' : m.affect !== 'a';
        if (m.a.when) { SG.condStep(st.condA, readValue(m.a.when.value), m.a.when, condRange(m.a.when), dt); if (!st.condA.open) useA = false; }
        if (m.b.when) { SG.condStep(st.condB, readValue(m.b.when.value), m.b.when, condRange(m.b.when), dt); if (!st.condB.open) useB = false; }
        if (useA && ua !== null) st.a = smoothAxis(st.a, m.a.outMin + (m.a.outMax - m.a.outMin) * curve(ua, m.a), m.a, dt);
        if (useB && ub !== null) st.b = smoothAxis(st.b, m.b.outMin + (m.b.outMax - m.b.outMin) * curve(ub, m.b), m.b, dt);
        if (st.a !== undefined && (swapping || m.affect !== 'b')) writePlain(ca, st.a, driven);
        if (st.b !== undefined && (swapping || m.affect !== 'a')) writePlain(cb, st.b, driven);
        if (swapping) {
          const ev = SG.swapStep(st.swap, useA && ua !== null ? st.a : null, useB && ub !== null ? st.b : null, m.swap);
          if (ev === 'toB' && m.swap.signal) emitSignal(m.swap.signal);
          if (ev === 'toA' && m.swap.backSignal) emitSignal(m.swap.backSignal);
        }
      }
    }
    // An increment: where it starts (its explicit start, else the control's value; a colour: its channel, or full brightness).
    function incStart(m) {
      const inc = m.increment;
      if (inc.start === 'value') return inc.startValue;
      const b = base.get(m.controlId);
      if (Array.isArray(b)) return m.channel === undefined || m.channel === null ? 1 : b[m.channel] || 0;
      return typeof b === 'number' && isFinite(b) ? b : Math.min(m.outMin, m.outMax);
    }
    function incFires(slotId, t, dt) {
      const inp = triggerInput(t);
      const f = fireSlot(incFire, slotId, t, inp.presses, inp.gate);
      return f.fresh ? 0 : stepFire(f.slot.st, t.fire, inp.presses, inp.gate, dt, time);
    }
    // One frame of an Increment mapping: what fired it (a trigger, a threshold, a repeat), that many steps, its signals, the value to write.
    // Spreads (docs/spread-control.md): each member's value so far (a mapping's, else its own) plus
    // Amount × curve(its place, rotated by Shift) × its range, clamped. Amount and Shift are the
    // Spread's own controls, so a mapping on them lands in layerLive under 'spread:<id>'.
    const SPK = typeof SSKit !== 'undefined' && SSKit.spread ? SSKit.spread : null;
    function tickSpreads(driven) {
      if (!SPK || !play.spreads || !play.spreads.length) return false;
      let moved = false;
      for (const sp of play.spreads) {
        const n = sp.members.length; if (!n) continue;
        const pid = 'spread:' + sp.id;
        const amount = layerLive.has(pid + '::amount') ? layerLive.get(pid + '::amount') : sp.amount;
        const shift = layerLive.has(pid + '::shift') ? layerLive.get(pid + '::shift') : sp.shift;
        for (let i = 0; i < n; i++) {
          const c = controls.get(sp.members[i]); if (!c || c.kind !== 'float') continue;
          const w = SPK.weight(i, n, shift, sp.curve, sp.curveY, !!sp.invert);
          const was = driven.has(c.id);
          if (!was && (amount === 0 || w === 0)) continue;
          const lt = layerTarget(c.target);
          let b = was ? live.get(c.id) : base.get(c.id);
          if (typeof b !== 'number' && lt) { const l = play.layers.find(x => x.id === lt.layerId); b = l ? l[lt.key] : undefined; }
          if (typeof b !== 'number') continue;
          const v = SPK.value(b, c.min, c.max, amount, w);
          if (lt) layerLive.set(lt.layerId + '::' + lt.key, v);
          else { const un = uniformFor(c); if (!un) continue; uniformValues[un] = v; }
          live.set(c.id, v); driven.add(c.id); moved = true;
        }
      }
      return moved;
    }
    function tickIncrement(m, dt) {
      const inc = m.increment, rg = INC.range(m.outMin, m.outMax);
      let st = incState.get(m.id);
      if (!st) { st = INC.create(incStart(m)); incState.set(m.id, st); }
      if (inc.resetOn && incFires(m.id + ':reset', { on: 'signal', signal: inc.resetOn }, dt) > 0) INC.reset(st, incStart(m), false);
      let count = 0;
      if (inc.on === 'trigger') count = incFires(m.id, inc.trigger, dt);
      else if (inc.on === 'threshold') count = INC.threshold(st, m.source.kind === 'trigger' ? readTrigger(m, dt) : readSource(m.source), inc);
      else {
        let open = true;
        if (inc.when && SG) { let c = incCond.get(m.id); if (!c) { c = SG.condNew(); incCond.set(m.id, c); } SG.condStep(c, readValue(inc.when.value), inc.when, condRange(inc.when), dt); open = c.open; }
        count = INC.repeat(st, time, inc, open);
      }
      if (count > 0) for (const ev of INC.advance(st, inc, rg[0], rg[1], count)) { const sig = ev === 'step' ? inc.stepSignal : inc.resetSignal; if (sig) emitSignal(sig); }
      return INC.glide(st, inc, rg[0], rg[1], dt);
    }
    function tickMappings(dt) {
      tickPads();
      if (grains.wired) tickGrains();
      tickHands();
      tickSubjects();
      tickAudioTriggers();
      tickZoneTriggers();
      // A clock sent back: axis swaps start on A again.
      if (time < lastTime - 1e-6) {
        for (const st of pairState.values()) st.swap = SG.swapNew();
        // Increments start over, so the same timeline steps the same way again.
        for (const m of incMappings) { const st = incState.get(m.id); if (st) INC.reset(st, incStart(m), true); }
        // Conditions forget the lowest and highest seen and a direction's averages, as the app does.
        if (SG && SG.condRewind) {
          for (const st of condStates.values()) SG.condRewind(st);
          for (const st of incCond.values()) SG.condRewind(st);
          for (const st of pairState.values()) { SG.condRewind(st.condA); SG.condRewind(st.condB); }
        }
        sigPayload.clear();
      }
      lastTime = time;
      tickConditionTriggers(dt);
      tickRelationshipSignals();
      tickMultiplySignals();
      tickBornDiedSignals();
      tickSignalLevels();
      tickActions(dt);
      const driven = new Set();
      let moved = false;
      for (const m of play.mappings) {
        if (!m.enabled) continue;
        const c = controls.get(m.controlId); if (!c) continue;
        let v;
        if (m.increment) { if (!INC) continue; v = tickIncrement(m, dt); }
        else {
          const u = m.source.kind === 'trigger' ? readTrigger(m, dt) : readSource(m.source);
          if (u === null) continue;
          // Set writes the captured number itself; every other source goes through the range and curve.
          const target = m.source.kind === 'captured' ? u : m.outMin + (m.outMax - m.outMin) * curve(u, m);
          v = smooth.get(m.id);
          if (m.smoothMs <= 0 || v === undefined) v = target;
          else { const a = 1 - Math.exp(-(dt * 1000) / m.smoothMs); v = v + (target - v) * a; if (Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(m.outMax - m.outMin))) v = target; }
        }
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
        if (readerTarget(c.target)) { live.set(c.id, v); driven.add(c.id); continue; }
        if (grainsTarget(c.target)) { live.set(c.id, v); driven.add(c.id); continue; }
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
      tickPairs(dt, driven);
      if (tickSpreads(driven)) moved = true;
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
        // The songs → the master chain → the volume.
        song.bus = song.ctx.createGain();
        afxAttach(song.ctx, 'master', song.bus, song.out, null);
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
          afxAttach(song.ctx, 'node:' + a.id, src, song.bus, an); src.start();
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
    if (bgVideo && !bgMuted && !follow) on(window, 'pointerdown', () => { bgVideo.muted = false; }, true);
    if (soundVideos.length && !follow) { on(window, 'pointerdown', startVideoSound, true); on(window, 'keydown', startVideoSound, true); }
    if (drums.ctx) {
      on(window, 'pointerdown', startDrums, true);
      // Z X C V / A S D F / Q W E R / 1 2 3 4 play pads 1–16 (a player only: a background never takes keys).
      if (mode === 'player' && drumLayers.some(l => l.keys)) {
        const held = new Map();
        on(window, 'keydown', e => {
          if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
          const pad = DPK.padOfKey(e.code);
          if (pad < 0) return;
          held.set(e.code, pad);
          for (const l of drumLayers) if (l.keys) drumAct({ layerId: l.id, amount: pad + 1, vel: 1 });
        });
        on(window, 'keyup', e => { const pad = held.get(e.code); if (pad === undefined) return; held.delete(e.code); for (const l of drumLayers) if (l.keys && l.pads[pad] && l.pads[pad].mode === 'gate') drumAct({ layerId: l.id, amount: pad + 1, vel: 0 }); });
      } else on(window, 'keydown', startDrums, true);
    }
    if (grains.ctx) { on(window, 'pointerdown', startGrains, true); on(window, 'keydown', startGrains, true); }
    if (!follow && queueLayer && (queueLayer.sources || []).some(s => s.kind === 'video' && s.muted === false)) { on(window, 'pointerdown', () => { qSound = true; }, true); on(window, 'keydown', () => { qSound = true; }, true); }
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
    const usesMidi = !!play.padGrid || drumLayers.some(l => l.midi) || grainRacks.some(r => r.midi !== 'off') || play.mappings.some(m => m.source.kind === 'midi' || m.source.kind === 'pad' || (m.source.kind === 'trigger' && m.source.trigger.on === 'note'));
    const usesOsc = play.mappings.some(m => m.source.kind === 'osc' || (m.source.kind === 'trigger' && m.source.trigger.on === 'osc'));
    const usesTilt = play.mappings.some(m => m.source.kind === 'tilt');
    // Readers on the live input (or on a node whose song stayed out of the page, which listens to the input instead) need it too.
    const readerNode = readers.cfg && readers.cfg.input ? audioById.get(readers.cfg.input) : null;
    const readerVideo = !!(readers.cfg && readers.cfg.input && ((readers.cfg.input.indexOf('video:') === 0 && lVideos.has(readers.cfg.input.slice(6))) || (readers.cfg.input.indexOf('pads:') === 0 && drums.kits.has(readers.cfg.input.slice(5)))));
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
        b.onclick = () => navigator.requestMIDIAccess().then(a => { a.inputs.forEach(i => { i.onmidimessage = e => onMidi(e.data, i.name || i.id || ''); }); b.textContent = 'MIDI on'; b.disabled = true; }, () => { b.textContent = 'MIDI refused'; });
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
      if (usesHands && B.hands && handsFromCamera) {
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
      // Drum pads: a button per pad that plays something (hold a gate pad).
      for (const l of drumLayers) {
        const row = el('div', 'ssp-control');
        row.append(el('span', 'ssp-label', l.label));
        const grid = el('div', 'ssp-row');
        grid.style.flexWrap = 'wrap'; grid.style.gap = '4px'; grid.style.justifyContent = 'flex-start';
        l.pads.forEach((p, i) => {
          if (!p.src && !p.synth) return;
          const b = el('button', 'ssp-btn', p.name || (p.fileName || '').replace(/\.[a-z0-9]{2,4}$/i, '') || ({ kick: 'Kick', snare: 'Snare', hat: 'Closed hat', openhat: 'Open hat', clap: 'Clap', tom: 'Tom', rim: 'Rim', cowbell: 'Cowbell' })[p.synth] || String(i + 1));
          b.onpointerdown = () => drumAct({ layerId: l.id, amount: i + 1, vel: 1 });
          b.onpointerup = () => { if (p.mode === 'gate') drumAct({ layerId: l.id, amount: i + 1, vel: 0 }); };
          grid.append(b);
        });
        row.append(grid);
        panel.append(row);
      }
      if (!play.controls.length) panel.append(el('div', 'ssp-empty', 'No controls in this play file.'));
      // A position pair (both its controls numbers) is one XY pad, where its A is.
      const xyPairOf = c => (play.pairs || []).find(p => p.position && (p.a === c.id || p.b === c.id) && controls.has(p.a) && controls.has(p.b) && controls.get(p.a).kind !== 'color' && controls.get(p.b).kind !== 'color' && !actTarget(controls.get(p.a).target) && !actTarget(controls.get(p.b).target));
      for (const c of play.controls) {
        const row = el('div', 'ssp-control');
        const top = el('div', 'ssp-row');
        const xyPair = xyPairOf(c);
        if (xyPair && xyPair.a !== c.id) continue;
        top.append(el('span', 'ssp-label', xyPair ? xyPair.label : c.label));
        const out = el('span', 'ssp-value', '');
        top.append(out);
        if (xyPair) {
          const cb = controls.get(xyPair.b);
          const pad = el('div', 'ssp-xy'), dot = el('span', 'ssp-xy-dot');
          pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', c.label + ' and ' + cb.label);
          pad.append(dot);
          const u = (v, k) => (k.max > k.min ? Math.max(0, Math.min(1, (v - k.min) / (k.max - k.min))) : 0);
          const now = k => { const v = live.has(k.id) ? live.get(k.id) : base.get(k.id); return typeof v === 'number' ? v : k.min; };
          const place = () => {
            const x = now(c), y = now(cb);
            dot.style.left = u(x, c) * 100 + '%'; dot.style.top = (1 - u(y, cb)) * 100 + '%';
            out.textContent = fmt(x, c.step) + ', ' + fmt(y, cb.step);
          };
          let dragging = false;
          const at = e => {
            const r = pad.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const ux = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), uy = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
            if (!live.has(c.id)) setFloat(c, c.min + (c.max - c.min) * ux);
            if (!live.has(cb.id)) setFloat(cb, cb.min + (cb.max - cb.min) * uy);
            place();
          };
          pad.onpointerdown = e => { dragging = true; try { pad.setPointerCapture(e.pointerId); } catch (_) { /* nothing to capture */ } at(e); };
          pad.onpointermove = e => { if (dragging) at(e); };
          pad.onpointerup = pad.onpointercancel = () => { dragging = false; };
          row.append(top, pad);
          place();
          readouts.set(c.id, { out, input: pad, kind: 'xy', place, ids: [c.id, cb.id] });
          panel.append(row);
          continue;
        }
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
        } else if (c.toggle) {
          // A switch (a boolean control): off is its low end, on its high end.
          const input = el('input'); input.type = 'checkbox'; input.className = 'ssp-switch';
          const b = base.get(c.id); input.checked = typeof b === 'number' && b >= (c.min + c.max) / 2;
          input.onchange = () => { const v = input.checked ? c.max : c.min; setFloat(c, v); out.textContent = input.checked ? 'On' : 'Off'; };
          out.textContent = input.checked ? 'On' : 'Off';
          row.append(input);
          readouts.set(c.id, { out, input, kind: 'toggle', mid: (c.min + c.max) / 2 });
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
        if (r.kind === 'xy') { r.input.parentElement.classList.toggle('ssp-driven', r.ids.some(k => live.has(k))); r.place(); continue; }
        const v = live.get(id), driven = v !== undefined;
        r.input.parentElement.classList.toggle('ssp-driven', driven);
        // A driven colour stays editable: mappings scale it or set one channel, starting from what the picker says.
        if (r.kind === 'color') { r.out.textContent = driven ? hex(v) : ''; continue; }
        r.input.disabled = driven;
        if (driven && r.kind === 'toggle') { r.input.checked = v >= r.mid; r.out.textContent = r.input.checked ? 'On' : 'Off'; }
        else if (driven) { r.input.value = v; r.out.textContent = fmt(v, r.step); }
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
        gl: glCanvas, W, H, dpr, time, dt, value, pointer, markers, editing: false, hidden, guides, alphaLayers: alphaList(),
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
        track: (k, p) => (subjects[k] ? subjects[k].K.point(subjects[k].st, p) : null),
        trackLive: k => !!(subjects[k] && subjects[k].st.live),
        tracks: markers ? Object.keys(subjects).filter(k => subjects[k].settings.overlay && subjects[k].st.live).map(k => ({ kind: k, state: subjects[k].st, colour: subjects[k].settings.colour })) : null,
        // three.js for 3D Script layers: the page carries it (SSThree) only when it has one.
        three: typeof SSThree !== 'undefined' ? SSThree : (window.SSThree || null),
        scriptStatus: (id, err) => { const e = err || null; if (scriptErrors.get(id) === e) return; scriptErrors.set(id, e); if (onScript) { try { onScript(id, e); } catch (x) { /* the host's problem */ } } },
        sensor: (k, v) => sensors.set(k, v),
        override: (id, k, v) => { if (v === null) overrides.delete(id + '::' + k); else overrides.set(id + '::' + k, v); },
        shaderTap: layersTap || undefined,
        data: dsEntry,
        needCoarse: grainsBright || !!play.readsPicture,
      });
      // "Grains from" a layer: each Granulator with a source takes the things inside its boundary, this frame.
      for (const g of grains.racks.values()) {
        const fr = g.r.instrument.from;
        if (!fr || !fr.source || !g.live) continue;
        const got = K.grainThings(play, fr.source, fr.boundary || '', value, W / Math.max(1, H));
        g.live.points(GRK.fromPoints(got.things, got.cx, got.cy, fr, GRK.settings(g.params, (a, b) => layerValue('au:' + g.r.id + ':inst', a, b))));
      }
    }

    // Visibility: a background pauses off-screen and in hidden tabs; reduced motion gets a still frame.
    let onScreen = true;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); if (onScreen) needsDraw = true; }) : null;
    if (io) io.observe(root);
    const reduced = stillForReducedMotion && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const inst = { mode, claimsKey: code => keysUsed.has(code), pad: padG ? (st, d1, d2, dev) => { padQueue.push([st, d1, d2, dev]); } : null };
    // MIDI notes from each drum layer's base note play its pads (36–51 by default).
    if (drumLayers.some(l => l.midi)) inst.drum = (st, d1, d2) => {
      const type = st & 0xf0, ch = (st & 0x0f) + 1;
      if (type !== 0x90 && type !== 0x80) return;
      for (const l of drumLayers) {
        if (!l.midi || (l.channel && l.channel !== ch)) continue;
        const pad = DPK.padOfNote(d1, l.baseNote);
        if (pad < 0) continue;
        const vel = type === 0x90 ? d2 / 127 : 0;
        if (vel > 0 || (l.pads[pad] && l.pads[pad].mode === 'gate')) drumAct({ layerId: l.id, amount: pad + 1, vel });
      }
    };
    // MIDI notes play the Granulator racks that listen (any input, or all devices here: a page can't tell them apart), by channel.
    if (grains.racks.size) inst.grain = (st, d1, d2) => {
      const type = st & 0xf0, ch = (st & 0x0f) + 1;
      for (const g of grains.racks.values()) {
        if (g.r.midi === 'off' || (g.r.channel && g.r.channel !== ch)) continue;
        if (type === 0x90 || type === 0x80) grainNote(g.r.id, d1, type === 0x90 ? d2 / 127 : 0);
        else if (type === 0xe0 && g.live) g.live.bend((((d2 << 7) | d1) - 8192) / 8192 * 2);
      }
    };
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
      if (padTex) {
        // The Pad Grid node: the cells' levels (kit/midi.js kmGridFill), the grid's size and the last pad.
        KM.gridFill(padG, padCfg, time, padBytes);
        gl.bindTexture(gl.TEXTURE_2D, padTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, padCfg.cols, padCfg.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, padBytes);
        bindSampler('u_padGrid', padTex);
        setUniform('u_padGridSize', [padCfg.cols, padCfg.rows]);
        setUniform('u_padLast', [padG.last.cx, padG.last.cy, padG.last.vel, padG.last.pressure]);
      }
      bindSampler('u_fontTexture', fontTex);
      if (usesLayersNode) {
        bindSampler('u_layers', layersColourTex); bindSampler('u_layersField', layersGpuField || layersFieldTex);
        const ls = loc('u_layersFieldSize'); if (ls) gl.uniform2fv(ls, layersFieldSize);
        const ll = loc('u_layersFieldLinear'); if (ll) gl.uniform1f(ll, layersGpuField ? 1 : 0);
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
    // Which renderAt is current: a newer one (or play()) makes a chunked renderAtAsync stop where it is.
    let renderGen = 0;
    /** Stop the clock and start the layers and feedback over for a deterministic render (renderAt / renderAtAsync). */
    const beginRender = o => {
      const gen = ++renderGen;
      held = true; setPlaying(false);
      const fdt = o.dt > 0 ? o.dt : 1 / 60;
      const steps = Array.isArray(o.steps) ? o.steps : [];
      if (K) K.reset(o.seed > 0 ? o.seed : 1);
      if (finishR) finishR.reset();
      dropTargets(); frame = 0; smooth.clear(); trig.clear(); actLevel.clear(); overrides.clear(); pairState.clear(); condStates.clear(); incState.clear(); incFire.clear(); incCond.clear(); lastTime = -Infinity;
      return { gen, fdt, steps };
    };
    /** One deterministic frame at clock time `at`. */
    const stepTo = (at, fdt) => { time = Math.max(0, +at || 0); frame++; tickMappings(fdt); paint(fdt, false); };
    function tick(now) {
      if (!alive) return;
      if (!follow) raf = requestAnimationFrame(tick);
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      if (ctxLost || held) return;
      const running = (follow ? fed.playing : playing) && !reduced && !document.hidden && !(pauseOffscreen && !onScreen);
      runVideos(running);
      followBackground(running);
      followLayerVideos(running);
      if ((pauseOffscreen && !onScreen) || document.hidden) return;
      if (reduced && !needsDraw && frame > 0) return;
      if (follow) time = fed.t;
      else if (playing && !reduced) time += dt;
      frame++;
      shared.live.clock++;
      if (bg && followPage) clampedMouse(shared.pageX, shared.pageY);
      let moved;
      if (follow) moved = applyFeed();
      else { tickAudioNodes(); moved = tickMappings(dt); }
      for (const sl of afxSlots) afxUpdate(sl);
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
      // Paused (or reduced-motion/off-screen) ⇒ dt 0 for the layer kit: simulated layers (particles,
      // agents, bodies…) hold still while the picture still draws. `time` is already frozen the same way.
      if (layered) drawLayers(running ? dt : 0);
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
    // The layers the Finish stack reads alone, and (follow) the ones the host shows alone.
    function alphaList() {
      const f = finishMap();
      if (!fed.alpha.length) return f;
      return f ? f.concat(fed.alpha) : fed.alpha;
    }
    // Follow: what the host fed in, as if this mount's own engine had worked it out.
    function applyFeed() {
      if (fed.pointer) { mouse.x = fed.pointer[0]; mouse.y = fed.pointer[1]; mouse.down = fed.pointer[2] ? 1 : 0; mouse.over = !!fed.pointer[3]; }
      if (fed.uniforms) for (const k in fed.uniforms) { const v = fed.uniforms[k]; uniformValues[k] = Array.isArray(v) ? v.slice() : v; }
      if (fed.layers) for (const k in fed.layers) layerLive.set(k, fed.layers[k]);
      for (const a of fed.actions.splice(0)) if (K && a.do !== 'pad') K.act(a);
      return true;
    }
    function finishMap() {
      if (!finishR) return null;
      const t = finish.effects.find(e => e.kind === 'time' && e.enabled);
      return t && t.map === 'layer' && t.layerId ? [t.layerId] : null;
    }
    if (!follow) raf = requestAnimationFrame(tick);
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
        if (drums.ctx) drums.ctx.close();
        for (const g of grains.racks.values()) if (g.live) g.live.dispose();
        if (grains.ctx) grains.ctx.close();
        for (const u of blobUrls) URL.revokeObjectURL(u);
        if (song.ctx) song.ctx.close();
        if (finishR) finishR.dispose();
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        root.innerHTML = '';
        root.classList.remove('ssp', 'ssp-bg', 'ssp-bare');
      },
      pause() { setPlaying(false); },
      /**
       * Follow mode: what the driving window says now. { t, playing, pointer: [x, y, down, over],
       * uniforms: { name: value }, layers: { '<layerId>::<key>': value }, actions: [{ do, layerId, amount }] };
       * any part may be left out. Applied on the next step().
       */
      feed(f) {
        if (!f) return;
        if (typeof f.t === 'number') fed.t = f.t;
        if (typeof f.playing === 'boolean') fed.playing = f.playing;
        if (f.pointer) fed.pointer = f.pointer;
        if (f.uniforms) fed.uniforms = f.uniforms;
        if (f.layers) fed.layers = f.layers;
        if (f.actions && f.actions.length) fed.actions.push(...f.actions);
        needsDraw = true;
      },
      /** Follow mode: draw one frame now (the host's animation frame). */
      step(now) { tick(typeof now === 'number' ? now : performance.now()); },
      /** Follow mode: these layers are drawn alone as well, for layer(id). */
      showAlone(ids) { fed.alpha = Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []; },
      /** The canvases the picture is made of: the shader's, the layers', the Finish stack's (null unless it drew), and one layer drawn alone. */
      canvases() {
        return { picture: glCanvas, layers: ovCanvas, finished: finishR && finishDrew ? fnCanvas : null, layer: id => (K ? K.layerCanvas(id) : null) };
      },
      /** What another window needs to follow this mount: the clock, the pointer, the uniforms and every layer number. */
      feedOut() {
        const layers = {};
        for (const [id, l] of layersById) for (const k in l) { const v = l[k]; if (typeof v === 'number') layers[id + '::' + k] = layerValue(id, k, v); }
        const uniforms = {};
        for (const k in uniformValues) { const v = uniformValues[k]; if (typeof v === 'number') uniforms[k] = v; else if (Array.isArray(v)) uniforms[k] = v.slice(); }
        return { t: time, playing, pointer: [mouse.x, mouse.y, mouse.down ? 1 : 0, mouse.over ? 1 : 0], uniforms, layers };
      },
      play() { renderGen++; held = false; setPlaying(true); },
      /**
       * Draw the frame at `t` seconds, the same every time: the clock stops and
       * the picture holds until play(). The layers and feedback start over
       * (the layers' random choices seeded by `seed`, default 1) and are
       * stepped through `steps` (clock times, fixed `dt` apart, from
       * lib/backgroundLibrary.ts captureSteps) first, so simulations arrive
       * where they would be. With `capture`, returns the picture and its
       * layers as one canvas; else null.
       */
      /** Where the mount is, for a rebuild after the GPU is lost: the clock, whether it plays, and whether renderAt holds it. */
      state() { return { time, playing, held, lost: ctxLost }; },
      renderAt(t, o) {
        o = o || {};
        if (ctxLost) return null;
        const { fdt, steps } = beginRender(o);
        for (const at of steps) stepTo(at, fdt);
        stepTo(t, fdt);
        return o.capture ? composite() : null;
      },
      /**
       * renderAt in chunks: the same steps in the same order (so the same
       * picture), but the work yields to the page every `budgetMs` (12) of
       * it, with `onProgress(done, total)` between chunks, so a long warm-up
       * keeps a slider moving. Resolves null when superseded: another
       * renderAt or renderAtAsync began, play() ran, `signal` aborted, or the
       * mount was destroyed.
       */
      renderAtAsync(t, o) {
        o = o || {};
        if (ctxLost) return Promise.resolve(null);
        const { gen, fdt, steps } = beginRender(o);
        const budget = o.budgetMs > 0 ? o.budgetMs : 12;
        const stale = () => !alive || gen !== renderGen || (o.signal && o.signal.aborted);
        return (async () => {
          let last = performance.now();
          for (let i = 0; i < steps.length; i++) {
            stepTo(steps[i], fdt);
            if (performance.now() - last < budget) continue;
            if (o.onProgress) o.onProgress(i + 1, steps.length + 1);
            await new Promise(r => setTimeout(r, 0));
            if (stale()) return null;
            last = performance.now();
          }
          stepTo(t, fdt);
          return o.capture ? composite() : null;
        })();
      },
      /** Draw this many pixels from now on (a preview at its shown size, the capture at its full size); the layers redraw at the new size on the next renderAt. */
      setPixelSize(s) {
        pixelSize = s && s.w > 0 && s.h > 0 ? { w: s.w, h: s.h } : null;
        layout();
      },
      /**
       * Bring every video layer (and a video background) to its exact frame at
       * `t`, decoded, before a renderAt capture of that moment: a promise that
       * settles when they're there (or gives up on one after a few seconds).
       * A free-running video layer goes where it would be following the clock,
       * as in the app's renders, so the same time gives the same picture.
       */
      seekVideos(t) {
        const at = Math.max(0, +t || 0);
        const wait = (e, ev, ms) => new Promise(res => {
          const done = () => { e.removeEventListener(ev, done); clearTimeout(timer); res(); };
          const timer = setTimeout(done, ms);
          e.addEventListener(ev, done);
        });
        const seekTo = async (e, target) => {
          if (!e.paused) e.pause();
          if (Math.abs(e.currentTime - target) < 0.0005 && e.readyState >= 2) return;
          const done = wait(e, 'seeked', 3000);
          e.currentTime = target;
          await done;
          if (e.readyState < 2) await wait(e, 'loadeddata', 2000);
        };
        const jobs = [];
        for (const l of play.layers) {
          const v = lVideos.get(l.id);
          if (!v) continue;
          const e = v.el;
          // Running free: it has started where the capture says, not at its own start.
          v.started = true;
          jobs.push((async () => {
            if (e.readyState < 1) await wait(e, 'loadedmetadata', 4000);
            // Its length still being worked out (see above): wait for it, or the clock can't place it.
            if (e.duration === Infinity) await wait(e, 'durationchange', 3000);
            await seekTo(e, videoLayerTimeAt(l.playing ? at : 0, e.duration, l.speed, !!l.loop, l.start || 0));
          })());
        }
        if (bgVideo) {
          const e = bgVideo;
          jobs.push((async () => {
            if (e.readyState < 1) await wait(e, 'loadedmetadata', 4000);
            await seekTo(e, videoTimeAt(at, e.duration, bgVid.rate, bgVid.loop !== false));
          })());
        }
        return Promise.all(jobs).then(() => { needsDraw = true; });
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

  // The worker that runs the Hand Landmarker (mirrors src/lib/trackerWorker.ts): MediaPipe's ES module and
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
    return navigator.requestMIDIAccess().then(a => { a.inputs.forEach(i => { i.onmidimessage = e => onMidi(e.data, i.name || i.id || ''); }); return true; }, () => false);
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
  window.ShaderStudioPlay = { version: 8, mount, enableMidi, listen: startLive, enableCamera, stopCamera, enableHands, internals: { toGlsl, particleGeometry, perspective, bandAmplitude, particleVertex, readerBandDb, readerRead, readerSmooth, readerGate, readerTarget, triggerKey } };

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
    // The page's mount, for a same-origin host (the app's Stage sends it on to the output window).
    window.__sspMount = m;
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
