/**
 * embedLite.ts — the small web export: one canvas, a tiny WebGL2 bootstrap
 * and the graph's GLSL. No player, no kit, no three.js.
 *
 * A graph whose picture is one fragment shader (with its time, resolution,
 * mouse, slider values and, optionally, previous-frame feedback and images)
 * needs none of the player runtime (runtime/play-runtime.js and the kit, about
 * 1.5 MB). `liteBlockers` says why a graph needs the player instead, feature by
 * feature, so the dialog can say "uses Agents" and what that adds; everything
 * else goes through `buildLiteSnippet` (docs/web-export.md).
 *
 * Pure: same input, same string.
 */
import { renderableFinish } from '../types/playFinish';
import { backgroundLayerOf } from '../types/play';
import { PREVIEW_ASPECTS } from '../utils/graphImportPlan';
import type { EmbedOptions, PlayHtmlInput } from './exportHtml';
import type { PlayCurve, PlaySource, TriggerMode } from '../types/play';

/** One reason the small snippet can't run a graph: what it uses, and (when it maps to one) the kit feature the player brings for it. */
export interface LiteBlocker { what: string; feature?: string }

/** Uniforms the bootstrap fills every frame. */
const BUILT_INS = new Set(['u_time', 'u_frameDt', 'u_resolution', 'u_mouse', 'u_mousebtn']);

/** The uniforms a shader reads: declared, and used past the declaration (the GLSL compiler drops the rest). */
export function usedUniforms(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)/gm)) {
    const name = m[1];
    if ((src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length > 1 && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Why this graph needs the full player rather than the small snippet; empty
 * when the small snippet runs it. Each line names what the graph uses.
 */
export function liteBlockers(input: PlayHtmlInput): LiteBlocker[] {
  const out: LiteBlocker[] = [];
  const play = input.play;
  const add = (what: string, feature?: string) => { if (!out.some(b => b.what === what)) out.push({ what, ...(feature ? { feature } : {}) }); };
  if (input.graphPasses?.length) add('Pass nodes', 'passes');
  if (input.agents) add('Agents', 'agentsGpu');
  if (input.passes?.echo) add('Echo');
  if (input.motionMap) add('Motion (texture)');
  if (input.backgroundGraphs && Object.keys(input.backgroundGraphs).length) add('a Background layer’s graphs');
  if (input.datasets && Object.keys(input.datasets).length) add('Data', 'data');
  if (input.handAssets || input.media?.tracks && Object.values(input.media.tracks).some(t => t?.src)) add('Tracking', 'trackers');
  if (Object.keys(input.media?.videos ?? {}).length) add('Video');
  if (input.media?.audio?.length || input.media?.audioTools) add('Audio');
  // Play: anything that moves, draws over or sounds needs the player.
  const visible = play.layers.filter(l => l.visible !== false);
  for (const l of visible) add(`${l.kind[0].toUpperCase()}${l.kind.slice(1)} layers`, LAYER_FEATURE[l.kind]);
  // Mappings from the pointer, keys and the clock run in the snippet (liteMaps); any other kind needs the player.
  if (liteMaps(input) === null) add('Mappings');
  if (play.pairMappings?.length) add('Pair mappings');
  if (play.actions?.length) add('Actions');
  if (renderableFinish(play.finish)) add('Finish effects', 'finish');
  if (play.audioFx && Object.keys(play.audioFx.chains ?? {}).length) add('Audio effects', 'audioFx');
  if (play.audioEngine?.racks.length) add('The Audio engine', 'drums');
  if (play.padGrid) add('Pad grid');
  if (play.midiFile) add('A MIDI file');
  if (play.hands || play.face || play.pose) add('Tracking', 'trackers');
  if (play.audioReaders?.readers.length) add('Audio readers');
  if (backgroundLayerOf(play)) add('A Background layer');
  const d = play.display;
  if (d && (d.picture === false || (d.source && d.source !== 'shader'))) add('A picture background');
  // Anything the shader reads that the bootstrap doesn't fill.
  const known = new Set([...BUILT_INS, ...Object.keys(input.uniforms), ...Object.keys(input.media?.textures ?? {})]);
  if (input.passes?.stateful) known.add('u_prevFrame');
  if (input.fragmentShader.includes('// gpu-particles ')) add('Particles', 'gpuParticles');
  for (const u of usedUniforms(input.fragmentShader)) {
    // An image input with no file loaded reads blank, as in the player.
    if (known.has(u) || /^u_tex_/.test(u)) continue;
    const kind = UNIFORM_KINDS.find(([re]) => re.test(u));
    if (kind) add(kind[1], kind[2]);
    else add(`its input ${u}`);
  }
  return out;
}

/** Inputs the player fills that the bootstrap doesn't, by uniform name: what to call them, and the kit feature they need. */
const UNIFORM_KINDS: [RegExp, string, string?][] = [
  [/^u_fontTexture$/, 'Text (the font atlas)'], [/^u_layers/, 'the Layers node', 'jfa'], [/^u_pad(Grid|Last)/, 'Pad grid'],
  [/^u_ds_/, 'Data', 'data'], [/^u_pass/, 'Pass nodes', 'passes'], [/^u_(agdraw|trail|ag_)/, 'Agents', 'agentsGpu'],
  [/^(u_gpup|gpp_)/, 'Particles', 'gpuParticles'], [/^u_audio_/, 'Audio'], [/^u_vid_/, 'Video'], [/^u_echo\d/, 'Echo'],
  [/^u_midi_/, 'A MIDI Input node'], [/^u_motionMap/, 'Motion (texture)'],
];

/** The kit feature a layer kind brings (exportHtml.ts KIT_GROUPS), for the dialog's sizes. */
const LAYER_FEATURE: Partial<Record<string, string>> = { script: 'script', agents: 'agentsCpu', water: 'finish', drumpad: 'drums', data: 'data' };

/**
 * A Play mapping the snippet runs: a uniform written from the pointer (x, y, a button held), a key held,
 * an LFO or Clock on the snippet's clock,
 * or a key / click trigger (envelope, toggle, step or random), through the mapping's range, curve and
 * smoothing, as the player does (runtime/play-runtime.js readSource, stepTrigger, smoothAxis).
 */
export interface LiteMap {
  u: string;
  on: 'x' | 'y' | 'down' | 'key' | 'click' | 'wave';
  key?: string;
  /** A wave on the clock (an LFO, or a Clock at its tempo): its shape, cycles a second and phase. */
  w?: { shape: 'sine' | 'triangle' | 'saw' | 'square'; hz: number; ph: number };
  /** A trigger's mode and envelope (ms), and Step's count. */
  t?: { mode: TriggerMode; a: number; d: number; s: number; r: number; n: number };
  lo: number;
  hi: number;
  c?: Exclude<PlayCurve, 'linear'>;
  cy?: number[];
  /** Smoothing, ms. */
  ms?: number;
  /** A colour's channel; -1: the whole colour, its brightness (the colour as exported times the value). */
  ch?: 0 | 1 | 2 | -1;
}

/** The pointer or key a source reads, in the snippet's terms; null for anything else. */
function liteSource(s: PlaySource): Pick<LiteMap, 'on' | 'key' | 't' | 'w'> | null {
  // Time: an LFO, or a Clock (one cycle every `beats` beats at `bpm`); a random wave needs the player.
  if ((s.kind === 'lfo' || s.kind === 'clock') && s.shape !== 'random') {
    return { on: 'wave', w: { shape: s.shape, hz: s.kind === 'lfo' ? s.rate : s.bpm / 60 / Math.max(0.0625, s.beats), ph: s.kind === 'lfo' ? s.phase : 0 } };
  }
  if (s.kind === 'mouse') return { on: s.axis };
  if (s.kind === 'key') return { on: 'key', key: s.code };
  if (s.kind === 'trigger') {
    const tr = s.trigger;
    if (tr.fire && tr.fire.mode !== 'once') return null;
    const t = { mode: s.mode, a: s.attack, d: s.decay, s: s.sustain, r: s.release, n: s.steps };
    if (tr.on === 'key') return { on: 'key', key: tr.code, t };
    if (tr.on === 'mouse') return { on: 'click', t };
  }
  return null;
}

/**
 * The Play mappings the snippet runs, or null when one needs the player: every enabled mapping (and
 * Source route) reads the pointer, a key or the clock (an LFO, a Clock), writes a uniform the shader reads (a colour by one channel),
 * one per control, with no increment or delay. An empty list: no mappings.
 */
export function liteMaps(input: PlayHtmlInput): LiteMap[] | null {
  const play = input.play;
  const used = new Set(usedUniforms(input.fragmentShader));
  const out: LiteMap[] = [];
  const seen = new Set<string>();
  const one = (source: PlaySource, r: { controlId: string; outMin: number; outMax: number; curve: PlayCurve; curveY?: number[]; smoothMs?: number; delayMs?: number; channel?: 0 | 1 | 2 }): boolean => {
    const src = liteSource(source);
    const c = play.controls.find(x => x.id === r.controlId);
    // One mapping per control; a colour's channels each take one (the player sums nothing else).
    const ch = r.channel ?? undefined;
    const key = `${c?.id}:${ch ?? 'all'}`;
    if (!src || !c || (r.delayMs ?? 0) > 0 || seen.has(key) || (ch === undefined ? [...seen].some(k => k.startsWith(`${c.id}:`)) : seen.has(`${c.id}:all`))) return false;
    seen.add(key);
    const u = /^[\w-]+::/.test(c.target) && !/^(layer|act|finish|spread|audiofx|au|macro|reader|grains):/.test(c.target) ? input.paramBindings[c.target.split('::').slice(-2).join('::')] : undefined;
    if (!u || !(u in input.uniforms)) return false;
    const v = input.uniforms[u];
    if (!Array.isArray(v) && ch !== undefined) return false;
    if (!used.has(u)) return true;
    out.push({
      u, ...src, lo: r.outMin, hi: r.outMax,
      ...(r.curve !== 'linear' ? { c: r.curve } : {}), ...(r.curve === 'custom' && r.curveY ? { cy: r.curveY } : {}),
      ...(r.smoothMs ? { ms: r.smoothMs } : {}), ...(Array.isArray(v) ? { ch: ch ?? -1 } : {}),
    });
    return true;
  };
  for (const m of play.mappings) {
    if (m.enabled === false) continue;
    if (m.increment || !one(m.source, m)) return null;
  }
  for (const d of play.sources ?? []) {
    if (!d.enabled) continue;
    for (const o of d.outputs) {
      const routes = o.routes.filter(r => r.enabled !== false);
      if (o.kind !== 'value' && routes.length) return null;
      for (const r of routes) if (r.mode !== 'replace' || !one(d.source, { ...r, controlId: r.to })) return null;
    }
  }
  return out;
}

/**
 * The bootstrap's mapping part, in the snippet only when it has mappings: keys held and pressed, clicks
 * on the picture, the player's trigger envelope and smoothing. `mouse`, `down`, `clicks` and `U` are the
 * bootstrap's own.
 */
export const LITE_MAPS = `  var M = O.maps || [], held = {}, presses = {}, mst = M.map(function (m) { return { seen: 0, value: 0, stage: 'idle', index: -1, s: undefined, b: [].concat(U[m.u]) }; });
  function typing(t) { return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }
  // Capture phase: a host page that stops a key for its own shortcut still lets the picture hear it.
  window.addEventListener('keydown', function (e) { if (e.repeat || typing(e.target)) return; held[e.code] = 1; presses[e.code] = (presses[e.code] || 0) + 1; }, true);
  window.addEventListener('keyup', function (e) { held[e.code] = 0; }, true);
  window.addEventListener('blur', function () { held = {}; });
  function curve(x, m) { x = x < 0 ? 0 : x > 1 ? 1 : x; if (m.c === 'exp') return x * x; if (m.c === 'log') return Math.sqrt(x); if (m.c === 'custom' && m.cy && m.cy.length > 1) { var p = x * (m.cy.length - 1), i = Math.min(m.cy.length - 2, Math.floor(p)); return m.cy[i] + (m.cy[i + 1] - m.cy[i]) * (p - i); } return x; }
  // A trigger: toggle, step, random, or an attack / decay / sustain / release envelope (ms) while held.
  function trig(t, st, n, gate, dt) {
    var fresh = n > st.seen, E = 1e-6, ms = dt * 1000, lv = t.s; st.seen = n;
    if (t.mode === 'toggle') { if (fresh) st.value = st.value >= 0.5 ? 0 : 1; return st.value; }
    if (t.mode === 'step') { if (fresh) { var k = Math.max(2, t.n); st.index = (st.index + 1) % k; st.value = st.index / (k - 1); } return st.value; }
    if (t.mode === 'random') { if (fresh) st.value = Math.random(); return st.value; }
    if (fresh) st.stage = 'attack';
    if (st.stage === 'attack') { st.value = t.a <= 0 ? 1 : Math.min(1, st.value + ms / t.a); if (st.value >= 1 - E) { st.value = 1; st.stage = 'decay'; } }
    else if (st.stage === 'decay') { st.value = t.d <= 0 ? lv : Math.max(lv, st.value - (ms / t.d) * (1 - lv || 1)); if (st.value <= lv + E) { st.value = lv; st.stage = 'sustain'; } }
    else if (st.stage === 'sustain') st.value = lv;
    else if (st.stage === 'release') { st.value = t.r <= 0 ? 0 : Math.max(0, st.value - ms / t.r); if (st.value <= E) { st.value = 0; st.stage = 'idle'; } }
    else st.value = 0;
    if (!gate && (st.stage === 'decay' || st.stage === 'sustain')) st.stage = lv > 0 || st.stage === 'sustain' ? 'release' : st.stage;
    if (st.stage === 'sustain' && lv === 0) st.stage = 'idle';
    return st.value;
  }
  function tickMaps(dt) {
    M.forEach(function (m, j) {
      var st = mst[j], u, v;
      if (m.t) u = trig(m.t, st, m.on === 'key' ? presses[m.key] || 0 : clicks, m.on === 'key' ? !!held[m.key] : !!down, dt);
      else if (m.w) { var p = time * m.w.hz + m.w.ph; p -= Math.floor(p); u = m.w.shape === 'sine' ? 0.5 - 0.5 * Math.cos(p * Math.PI * 2) : m.w.shape === 'triangle' ? 1 - Math.abs(2 * p - 1) : m.w.shape === 'square' ? (p < 0.5 ? 1 : 0) : p; }
      else u = m.on === 'x' ? mouse[0] : m.on === 'y' ? mouse[1] : m.on === 'down' ? down : held[m.key] ? 1 : 0;
      v = m.lo + (m.hi - m.lo) * curve(u, m);
      st.s = st.s === undefined || !m.ms ? v : st.s + (v - st.s) * (1 - Math.exp(-(dt * 1000) / m.ms));
      if (m.ch === undefined) U[m.u] = st.s;
      else if (m.ch < 0) U[m.u] = st.b.map(function (x) { return x * st.s; });
      else { var a = [].concat(U[m.u]); a[m.ch] = st.s; U[m.u] = a; }
    });
  }
`;

/** A safe file name for an image that stays next to the page. */
export function liteFileName(label: string, name: string, uniform: string): string {
  const base = (name || label || uniform).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || uniform;
  return /\.\w{2,5}$/.test(base) ? base : `${base}.png`;
}

/** The images the snippet reads: inline data URLs, or files to put next to the page (too big to carry). */
export interface LiteImage { uniform: string; src: string; inline: boolean; flat: boolean; label: string }
export function liteImages(input: PlayHtmlInput): LiteImage[] {
  return Object.entries(input.media?.textures ?? {}).flatMap(([u, t]): LiteImage[] => {
    if (t.src) return [{ uniform: u, src: t.src, inline: true, flat: !!t.flat, label: t.label }];
    if (t.bytes > 0) return [{ uniform: u, src: liteFileName(t.label, t.name, u), inline: false, flat: !!t.flat, label: t.label }];
    return [];
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
/** JSON safe inside a <script>. */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
/** A number as short as it reads. */
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6));
const value = (v: number | number[]) => (Array.isArray(v) ? `[${v.map(num).join(', ')}]` : num(v));

/** The uniforms object, one per line, each with its control's label when Play has one. */
function uniformLines(input: PlayHtmlInput): string {
  const labels = new Map<string, string>();
  for (const c of input.play.controls) {
    const u = input.paramBindings[c.target.split('::').slice(-2).join('::')];
    if (u && !labels.has(u)) labels.set(u, c.label);
  }
  const used = new Set(usedUniforms(input.fragmentShader));
  const entries = Object.entries(input.uniforms).filter(([k]) => used.has(k));
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `    ${js(k)}: ${value(v)},${labels.has(k) ? ` // ${labels.get(k)!.replace(/[\r\n]+/g, ' ')}` : ''}`).join('\n')}\n  }`;
}

/**
 * The bootstrap: WebGL2, the shader as the app runs it (the defines three.js
 * puts ahead of GLSL 1), the uniforms by their GL type, images, optional
 * previous-frame feedback, the clock, the mouse, resizing, pausing off-screen
 * and a still frame for reduced motion. Plain JS, no libraries.
 */
const BOOTSTRAP = `(function (root, src, U, O) {
  'use strict';
  var cv = root.querySelector('canvas');
  var gl = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) { root.textContent = 'This picture needs WebGL2.'; return; }
  var VS = '#version 300 es\\nin vec2 p; out vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  var HEAD = '#version 300 es\\n#define varying in\\nlayout(location = 0) out highp vec4 pc_fragColor;\\n#define gl_FragColor pc_fragColor\\n#define texture2D texture\\n#define textureCube texture\\n#define texture2DLodEXT textureLod\\n#define texture2DGradEXT textureGrad\\n';
  function shader(type, s) { var x = gl.createShader(type); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; }
  function program(fs) {
    var p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, HEAD + fs.replace(/^[ \\t]*#extension[^\\n]*$/gm, '')));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
  }
  var prog = program(src), units = 0, setters = {}, T = {}, samplers = [];
  var copy = O.feedback ? program('precision highp float; uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }') : null;
  // A setter per active uniform, from its GL type: floats, ints and bools, vectors, matrices and samplers.
  for (var i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) {
    var info = gl.getActiveUniform(prog, i), name = info.name.replace(/\\[0\\]$/, ''), at = gl.getUniformLocation(prog, info.name);
    setters[name] = (function (t, at) {
      var f = { 5126: 'uniform1fv', 35664: 'uniform2fv', 35665: 'uniform3fv', 35666: 'uniform4fv', 5124: 'uniform1iv', 35670: 'uniform1iv', 35667: 'uniform2iv', 35668: 'uniform3iv', 35669: 'uniform4iv' }[t];
      var m = { 35674: 'uniformMatrix2fv', 35675: 'uniformMatrix3fv', 35676: 'uniformMatrix4fv' }[t];
      if (t === 35678) { var u = units++; samplers.push(name); return function (tex) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, tex || blank); gl.uniform1i(at, u); }; }
      if (m) return function (v) { gl[m](at, false, v); };
      if (!f) return function () {};
      return function (v) { v = [].concat(v); gl[f](at, f.indexOf('iv') > 0 ? v.map(Math.round) : v); };
    })(info.type, at);
  }
  function texture(w, h, data, type, format) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (k) { gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE); });
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, format || gl.RGBA, w, h, 0, gl.RGBA, type || gl.UNSIGNED_BYTE, data); return t;
  }
  var blank = texture(1, 1, new Uint8Array(4));
  // Images: flipped and mipmapped, as the app uploads them. Inline data URLs, or files next to the page.
  Object.keys(O.images || {}).forEach(function (k) {
    var im = new Image(), m = O.images[k]; T[k] = blank;
    im.onload = function () {
      var t = texture(1, 1, null); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      if (!m.flat) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      T[k] = t; dirty = true;
    };
    im.onerror = function () { console.warn('[Playfield] Couldn\\u2019t load ' + m.src + ' for ' + k + '.'); };
    im.src = m.src;
  });
  // Previous-frame feedback: two half-float targets, drawn into in turn and copied to the canvas.
  var half = O.feedback && gl.getExtension('EXT_color_buffer_float'), targets = null, ping = 0;
  function target(w, h) { var t = texture(w, h, null, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, half ? gl.RGBA16F : gl.RGBA), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t: t, fb: fb }; }
  function drop() { (targets || []).forEach(function (x) { gl.deleteFramebuffer(x.fb); gl.deleteTexture(x.t); }); targets = null; ping = 0; }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // Data attributes override the baked values: data-u_speed="2", data-u_tint="1,0.5,0".
  var lower = {}; Object.keys(U).forEach(function (k) { lower[k.toLowerCase()] = k; });
  Object.keys(root.dataset).forEach(function (k) { var u = lower[k.toLowerCase()]; if (u) U[u] = root.dataset[k].indexOf(',') >= 0 ? root.dataset[k].split(',').map(Number) : Number(root.dataset[k]); });
  var time = 0, fdt = 0, last = 0, mouse = [0.5, 0.5], down = 0, clicks = 0, dirty = true, visible = true, raf = 0;
/*MAPS*/
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function draw() {
    var W = cv.width, H = cv.height, set = function (k, v) { if (setters[k]) setters[k](v); };
    if (O.feedback && !targets) targets = [target(W, H), target(W, H)];
    gl.useProgram(prog); gl.bindFramebuffer(gl.FRAMEBUFFER, targets ? targets[ping].fb : null); gl.viewport(0, 0, W, H);
    set('u_time', clock()); set('u_frameDt', fdt); set('u_resolution', [W, H]); set('u_mouse', [mouse[0] * W, mouse[1] * H]); set('u_mousebtn', down);
    for (var k in U) set(k, U[k]);
    samplers.forEach(function (s) { set(s, T[s]); });
    if (targets) set('u_prevFrame', targets[1 - ping].t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (targets) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(copy); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets[ping].t); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); ping = 1 - ping; }
  }
  // The graph's frame rate (O.fps): draw that often (gateMs) and/or step the time by 1/fps (stepT).
  var F = O.fps || 0, gateMs = F && O.fpsMode !== 'posterize' ? 1000 / F : 0, stepT = F && O.fpsMode !== 'draw', nextAt = 0, acc = 0, shown = -1;
  function clock() { return stepT ? Math.floor(time * F + 1e-6) / F : time; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0, s, nu; last = now; fdt = dt;
    if (!visible || document.hidden || (still && !dirty)) return;
    if (!still) time += dt;
    if (gateMs) { acc += dt; s = Math.floor(time * F + 1e-6); nu = stepT && !still && s !== shown;
      if (nu) nextAt = now + gateMs; else if (!nextAt || now >= nextAt - 2) nextAt = nextAt && now - nextAt < gateMs ? nextAt + gateMs : now + gateMs; else return;
      if (!nu && stepT && !still && !dirty) return; shown = s; fdt = Math.min(0.25, acc); acc = 0; }
    /*TICK*/dirty = false; draw();
  }
  function resize() {
    var r = root.getBoundingClientRect(), d = Math.min(O.dpr, window.devicePixelRatio || 1);
    var W = Math.max(1, Math.round(r.width * d)), H = Math.max(1, Math.round(r.height * d));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; drop(); dirty = true; }
  }
  new ResizeObserver(resize).observe(root); resize();
  if (window.IntersectionObserver) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(root);
  (O.followPage ? window : root).addEventListener('pointermove', function (e) { var r = root.getBoundingClientRect(); mouse = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))]; dirty = true; });
  // A click on the picture (a background takes it from the window: it lets the page's own clicks through).
  (O.window ? window : root).addEventListener('pointerdown', function (e) { var r = root.getBoundingClientRect(); down = 1; if (e.clientX >= r.left && e.clientX <= r.left + r.width && e.clientY >= r.top && e.clientY <= r.top + r.height) clicks++; dirty = true; });
  window.addEventListener('pointerup', function () { down = 0; dirty = true; });
  // el.playfield: set a uniform, stop the clock, or draw one frame at a time (stops the clock).
  root.playfield = { uniforms: U, set: function (k, v) { U[k] = v; dirty = true; }, stop: function () { cancelAnimationFrame(raf); }, renderAt: function (t) { cancelAnimationFrame(raf); time = t; fdt = 1 / 60; drop(); if (typeof tickMaps === 'function') tickMaps(fdt); draw(); } };
  raf = requestAnimationFrame(frame);
})`;
/** The bootstrap for a snippet without mappings. */
export const LITE_BOOTSTRAP = BOOTSTRAP.replace('/*MAPS*/\n', '').replace('/*TICK*/', '');
/** The bootstrap with the mapping part (LITE_MAPS), for a snippet whose mappings read the pointer or keys. */
export const LITE_BOOTSTRAP_MAPS = BOOTSTRAP.replace('/*MAPS*/\n', () => LITE_MAPS).replace('/*TICK*/', 'tickMaps(fdt); ');

/** The small snippet's options, from the dialog's. */
export interface LiteOptions { mode: EmbedOptions['mode']; placement: EmbedOptions['placement']; height: number; followPage: boolean }

/**
 * The paste-in snippet: a <div data-playfield> with its canvas, the GLSL in a
 * <script type="x-shader/x-fragment">, and the bootstrap. Player: a block in
 * the export's shape (or `height` px with a free shape). Background: fills its
 * section, or the whole page, behind your content.
 */
export function buildLiteSnippet(input: PlayHtmlInput, options: LiteOptions): string {
  const bg = options.mode === 'background';
  const ratio = PREVIEW_ASPECTS.find(a => a.id === input.aspect)?.ratio ?? null;
  const style = !bg
    ? `position:relative;width:100%;${ratio ? `aspect-ratio:${num(ratio)}` : `height:${Math.max(200, Math.round(options.height))}px`};overflow:hidden;border-radius:12px;background:#000`
    : options.placement === 'page'
      ? 'position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none'
      : 'position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none';
  const hostFix = bg && options.placement === 'section'
    ? "\n  var h = el.parentElement; if (h) { if (getComputedStyle(h).position === 'static') h.style.position = 'relative'; h.style.isolation = 'isolate'; }"
    : '';
  const images = liteImages(input);
  const files = images.filter(i => !i.inline);
  const o: Record<string, unknown> = { dpr: input.passes?.stateful ? 1 : bg ? 1.5 : 2 };
  if (input.passes?.stateful) o.feedback = true;
  if (bg && options.followPage) o.followPage = true;
  if (bg) o.window = true;
  const maps = liteMaps(input) ?? [];
  if (maps.length) o.maps = maps;
  // The graph's frame rate (docs/frame-rate.md): the snippet draws that often and/or steps its time.
  const rate = input.play.frameRate;
  if (rate && rate.fps !== 'auto') { o.fps = rate.fps; if (rate.mode && rate.mode !== 'both') o.fpsMode = rate.mode; }
  if (images.length) o.images = Object.fromEntries(images.map(i => [i.uniform, i.flat ? { src: i.src, flat: true } : { src: i.src }]));
  const glsl = input.fragmentShader.replace(/<\/script/gi, '<\\/script').trim();
  return `<!-- Playfield · ${escapeHtml(input.title).replace(/-{2,}/g, '-')} · ${bg ? 'background' : 'player'} · WebGL2, no libraries.
     Set a value with an attribute on the div (data-u_name="0.5", or "1,0,0" for a vector),
     or from your own script: el.playfield.set('u_name', 0.5).${files.length ? `
     Put ${files.map(f => f.src).join(', ')} next to this page (the picture${files.length === 1 ? '' : 's'} from ${files.map(f => f.label).join(', ')}: too big to carry inside it).` : ''} -->
<div data-playfield style="${style}"><canvas style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas></div>
<script type="x-shader/x-fragment">
${glsl}
</script>
<script>
${maps.length ? LITE_BOOTSTRAP_MAPS : LITE_BOOTSTRAP}(
  (function () { var el = document.currentScript.previousElementSibling.previousElementSibling;${hostFix} return el; })(),
  document.currentScript.previousElementSibling.textContent,
  ${uniformLines(input)},
  ${js(o)}
);
</script>
`;
}

/**
 * A whole page around the small snippet, to host or iframe: the picture fills the window behind
 * the page. The black goes on <html> only: the snippet sits at z-index −1, and a <body> with its
 * own background paints over negative z-index content, which left the downloaded page black.
 * The pointer is read from the window (the background ignores pointer events), so u_mouse works.
 */
export function buildLitePage(input: PlayHtmlInput, options: LiteOptions): string {
  const page = { ...options, mode: 'background' as const, placement: 'page' as const, followPage: true };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>html{height:100%;background:#000}body{margin:0;min-height:100%}</style>
</head>
<body>
${buildLiteSnippet(input, page).trim()}
</body>
</html>
`;
}

/**
 * The GLSL alone, for your own WebGL code or a shader site: the fragment
 * shader with a header listing what to feed it (its uniforms with their
 * current values and controls' names, and the conventions it expects).
 */
export function buildGlslOnly(input: PlayHtmlInput): string {
  const used = new Set(usedUniforms(input.fragmentShader));
  const labels = new Map<string, string>();
  for (const c of input.play.controls) {
    const u = input.paramBindings[c.target.split('::').slice(-2).join('::')];
    if (u && !labels.has(u)) labels.set(u, c.label);
  }
  const lines = [
    `// Playfield · ${input.title.replace(/[\r\n]+/g, ' ')}`,
    '// GLSL ES 1.0 style (gl_FragColor, texture2D). For WebGL2 put these lines first:',
    '//   #version 300 es',
    '//   #define varying in',
    '//   out highp vec4 pc_fragColor;',
    '//   #define gl_FragColor pc_fragColor',
    '//   #define texture2D texture',
    '// It expects vUv (0..1 across the picture) from a full-screen quad.',
    '// Feed it:',
  ];
  const builtIns: Record<string, string> = { u_time: 'seconds since start', u_frameDt: 'seconds since the last frame', u_resolution: 'the canvas size in pixels', u_mouse: 'the pointer in pixels, y up', u_mousebtn: '1 while a button is down', u_prevFrame: 'the previous frame (feedback)' };
  for (const u of used) {
    if (builtIns[u]) lines.push(`//   ${u}: ${builtIns[u]}`);
    else if (u in input.uniforms) lines.push(`//   ${u} = ${value(input.uniforms[u])}${labels.has(u) ? ` (${labels.get(u)!.replace(/[\r\n]+/g, ' ')})` : ''}`);
    else if (input.media?.textures?.[u]) lines.push(`//   ${u}: the image from ${input.media.textures[u].label}`);
    else lines.push(`//   ${u}`);
  }
  return `${lines.join('\n')}\n\n${input.fragmentShader.trim()}\n`;
}
