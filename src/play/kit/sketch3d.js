/**
 * sketch3d.js — the Script layer's 3D mode (part of the layer kit, see kit.js).
 *
 * p5's WEBGL vocabulary on three.js, immediate mode: every frame the sketch
 * calls box(), sphere(), translate(), fill(), lights… and this file turns
 * the calls into a few instanced meshes, one per shape and look, so hundreds
 * of shapes are a handful of draw calls. Nothing is allocated per shape: the
 * batches, their instance buffers, the edge buffer and the lights are pooled
 * on the sketch and reset at the start of each frame (k3Begin), then trimmed
 * to what the frame used (k3End). Unit geometries are shared by every sketch.
 *
 * Coordinates are p5's: the origin in the middle of the picture, x right,
 * y down, z toward you, one unit a pixel at z = 0. The shapes live under a
 * root group flipped in y; three.js itself (s.three) keeps its own y-up world.
 *
 * THREE is handed in (the three-slim.js set: the SSThree global an exported
 * page carries, which the app loads the same way), so this file has no
 * imports and inlines into the web kit like the others. Top-level names start with `k3` / `K3`.
 */

/** Names the 3D helpers add or replace, for the editor's reference and its param reader. */
export const K3_SKETCH_NAMES = [
  'box', 'sphere', 'ellipsoid', 'torus', 'cylinder', 'cone', 'plane', 'line',
  'push', 'pop', 'translate', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'scale', 'resetMatrix',
  'background', 'clear', 'fill', 'noFill', 'stroke', 'noStroke',
  'normalMaterial', 'ambientMaterial', 'specularMaterial', 'emissiveMaterial', 'shininess', 'texture',
  'ambientLight', 'directionalLight', 'pointLight',
  'camera', 'perspective', 'ortho', 'orbitControl',
];

/** 2D helpers with no meaning on a 3D layer: calling one says so. */
const K3_FLAT_ONLY = ['circle', 'ellipse', 'rect', 'square', 'point', 'triangle', 'quad', 'arc', 'beginShape', 'vertex', 'endShape', 'text', 'textSize', 'textAlign', 'textFont'];

// ── Colours ──────────────────────────────────────────────────────────────────
// p5's forms (grey, grey + alpha, r g b, r g b a in 0–255, an array) and CSS
// strings (hex, rgb(), hsl() with commas or spaces, names), to 0–1 sRGB.
const K3_CSS = new Map();
let k3CssCtx = null;
function k3ParseCss(str, out) {
  let hit = K3_CSS.get(str);
  if (!hit) {
    hit = [1, 1, 1, 1];
    let s = String(str).trim().toLowerCase();
    if (!/^(#|rgb|hsl)/.test(s) && typeof document !== 'undefined') {
      // A colour name: let a canvas say what it is.
      try { if (!k3CssCtx) k3CssCtx = document.createElement('canvas').getContext('2d'); k3CssCtx.fillStyle = '#fff'; k3CssCtx.fillStyle = s; s = String(k3CssCtx.fillStyle); } catch (e) { /* stays white */ }
    }
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      if (isFinite(n)) { hit[0] = ((n >> 16) & 255) / 255; hit[1] = ((n >> 8) & 255) / 255; hit[2] = (n & 255) / 255; }
      if (h.length === 8) hit[3] = parseInt(h.slice(6, 8), 16) / 255;
    } else {
      const nums = (s.match(/-?[\d.]+%?/g) || []).map(t => ({ v: parseFloat(t), pct: t.endsWith('%') }));
      if (s.startsWith('hsl') && nums.length >= 3) {
        const h = ((nums[0].v % 360) + 360) % 360 / 360, sat = nums[1].v / 100, l = nums[2].v / 100;
        const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
        const f = t => { t = t < 0 ? t + 1 : t > 1 ? t - 1 : t; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
        hit[0] = f(h + 1 / 3); hit[1] = f(h); hit[2] = f(h - 1 / 3);
      } else if (nums.length >= 3) {
        for (let i = 0; i < 3; i++) hit[i] = Math.max(0, Math.min(1, nums[i].pct ? nums[i].v / 100 : nums[i].v / 255));
      }
      if (nums.length >= 4) hit[3] = Math.max(0, Math.min(1, nums[3].pct ? nums[3].v / 100 : nums[3].v));
    }
    if (K3_CSS.size > 512) K3_CSS.clear();
    K3_CSS.set(str, hit);
  }
  out[0] = hit[0]; out[1] = hit[1]; out[2] = hit[2]; out[3] = hit[3];
  return out;
}
/** Colour arguments starting at `from` (up to `count` of them) into out = [r, g, b, a], 0–1. */
function k3Colour(args, from, count, out) {
  const n = Math.min(count, args.length - from);
  const a0 = args[from];
  if (n <= 0 || a0 === undefined) { out[0] = out[1] = out[2] = out[3] = 1; return out; }
  if (typeof a0 === 'string') return k3ParseCss(a0, out);
  if (Array.isArray(a0)) return k3Colour(a0, 0, a0.length, out);
  if (a0 && typeof a0 === 'object' && typeof a0.r === 'number') { out[0] = a0.r; out[1] = a0.g; out[2] = a0.b; out[3] = 1; return out; }
  const c = v => Math.max(0, Math.min(1, (+v || 0) / 255));
  if (n === 1) { out[0] = out[1] = out[2] = c(a0); out[3] = 1; }
  else if (n === 2) { out[0] = out[1] = out[2] = c(a0); out[3] = c(args[from + 1]); }
  else { out[0] = c(a0); out[1] = c(args[from + 1]); out[2] = c(args[from + 2]); out[3] = n >= 4 ? c(args[from + 3]) : 1; }
  return out;
}
/** How many leading arguments are the colour, when numbers follow it (directionalLight(r, g, b, x, y, z) vs (colour, x, y, z)). */
const k3ColourArgs = (args, rest) => (typeof args[0] === 'string' || Array.isArray(args[0]) || (args[0] && typeof args[0] === 'object') ? 1 : Math.max(1, Math.min(4, args.length - rest)));

// ── Shared geometry ──────────────────────────────────────────────────────────
// One unit geometry per shape and detail, scaled per instance; its edges (for
// stroke) as a flat list of segment ends. Torus shapes depend on the tube's
// share of the radius, so those are keyed by it and capped.
const K3_GEOS = new Map();
let k3TorusCount = 0;
function k3Geo(T, key, make) {
  let g = K3_GEOS.get(key);
  if (!g) {
    if (key.startsWith('torus:')) { if (k3TorusCount >= 48) { for (const k of K3_GEOS.keys()) if (k.startsWith('torus:')) { K3_GEOS.get(k).geo.dispose(); K3_GEOS.delete(k); k3TorusCount--; break; } } k3TorusCount++; }
    g = { key, geo: make(), edges: null, double: key === 'plane' };
    K3_GEOS.set(key, g);
  }
  return g;
}
function k3Edges(T, g) {
  if (!g.edges) { const e = new T.EdgesGeometry(g.geo, 20); g.edges = e.getAttribute('position').array.slice(); e.dispose(); }
  return g.edges;
}

// ── Renderers ────────────────────────────────────────────────────────────────
// A few WebGL renderers shared by every sketch on the page, one per size in
// use (the picture, the editor's scratch run, an export), so switching
// between them never reallocates a canvas; the least recently used is resized
// when a fourth size turns up. Each frame renders and is copied out at once.
const K3_RENDERERS = [];
let k3Tick = 0;
export function k3Renderer(T, W, H) {
  if (typeof document === 'undefined') return null;
  k3Tick++;
  let r = K3_RENDERERS.find(x => x.w === W && x.h === H);
  if (!r) {
    if (K3_RENDERERS.length < 3) {
      let gl = null;
      try { gl = new T.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false }); } catch (e) { return null; }
      gl.setPixelRatio(1);
      gl.setClearColor(0x000000, 0);
      r = { w: 0, h: 0, gl, used: 0 };
      K3_RENDERERS.push(r);
    } else r = K3_RENDERERS.reduce((a, b) => (a.used < b.used ? a : b));
    r.w = W; r.h = H;
    r.gl.setSize(W, H, false);
  }
  r.used = k3Tick;
  return r.gl;
}

// The picture as a texture: one per source canvas, uploaded at most once a frame, and only when a sketch asks for it.
const K3_PICTURES = new Map();
export function k3PictureTexture(T, src, stamp) {
  if (!src) return null;
  let p = K3_PICTURES.get(src);
  if (!p) {
    const tex = new T.Texture(src);
    tex.colorSpace = T.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = T.LinearFilter; tex.magFilter = T.LinearFilter;
    p = { tex, stamp: -1 };
    if (K3_PICTURES.size > 4) { const [k, old] = K3_PICTURES.entries().next().value; old.tex.dispose(); K3_PICTURES.delete(k); }
    K3_PICTURES.set(src, p);
  }
  if (p.stamp !== stamp) { p.stamp = stamp; p.tex.needsUpdate = true; }
  return p.tex;
}

// ── A sketch's 3D state ──────────────────────────────────────────────────────

/** Everything one 3D sketch keeps: its scene, camera, pools. `s.three` is `g.api`. */
export function k3Create(T) {
  const scene = new T.Scene();
  const root = new T.Group();
  root.scale.set(1, -1, 1);
  root.name = 'p5';
  scene.add(root);
  const persp = new T.PerspectiveCamera(60, 1, 1, 10000);
  const ortho = new T.OrthographicCamera(-1, 1, 1, -1, 0, 10000);
  const lineGeo = new T.BufferGeometry();
  const lines = new T.LineSegments(lineGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true }));
  lines.frustumCulled = false;
  lines.userData.k3 = true;
  root.add(lines);
  const g = {
    T, scene, root, persp, ortho, lines, lineGeo, linePos: new Float32Array(0), lineCol: new Float32Array(0), lineN: 0,
    batches: new Map(), batchList: [], last: { geo: '', style: '', batch: null },
    lights: { ambient: [], directional: [], point: [] }, lightUse: { ambient: 0, directional: 0, point: 0 },
    m: new T.Matrix4(), mstack: [], sstack: [], depth: 0, tmp: new T.Matrix4(), tmp2: new T.Matrix4(), v: new T.Vector3(), col: new T.Color(), c4: [1, 1, 1, 1],
    style: k3DefaultStyle(), styleKey: '', bg: null,
    cam: { eye: [0, 0, 0], center: [0, 0, 0], up: [0, 1, 0], fov: Math.PI / 3, near: 0, far: 0, ortho: null, set: false, w: 0, h: 0 },
    orbit: { x: 0, y: 0, down: false },
    textures: new WeakMap(), stamp: 0,
  };
  g.api = { THREE: T, scene, camera: persp, renderer: null, root };
  return g;
}
function k3DefaultStyle() {
  return { fill: [1, 1, 1, 1], doFill: true, stroke: [0, 0, 0, 1], doStroke: false, mat: 'fill', spec: [1, 1, 1], emis: [0, 0, 0], shin: 32, tex: null };
}
const k3CopyStyle = (a, b) => { for (let i = 0; i < 4; i++) { b.fill[i] = a.fill[i]; b.stroke[i] = a.stroke[i]; } for (let i = 0; i < 3; i++) { b.spec[i] = a.spec[i]; b.emis[i] = a.emis[i]; } b.doFill = a.doFill; b.doStroke = a.doStroke; b.mat = a.mat; b.shin = a.shin; b.tex = a.tex; };

/** The default camera for a W × H picture, as p5 places it: on the z axis, 60° tall, z = 0 one pixel per unit. */
function k3DefaultCamera(g, W, H) {
  const c = g.cam, z = (H / 2) / Math.tan(Math.PI / 6);
  c.eye[0] = 0; c.eye[1] = 0; c.eye[2] = z; c.center[0] = c.center[1] = c.center[2] = 0; c.up[0] = 0; c.up[1] = 1; c.up[2] = 0;
  c.fov = Math.PI / 3; c.near = z / 10; c.far = z * 10; c.ortho = null; c.w = W; c.h = H;
}

/** setup is about to run (first frame, a resize): a fresh camera, and what the last setup added to the scene goes. */
export function k3Setup(g, W, H) {
  // The pools stay (marked k3); what the sketch added, to the scene or to root, goes.
  for (const c of g.scene.children.slice()) if (c !== g.root) g.scene.remove(c);
  for (const c of g.root.children.slice()) if (!c.userData.k3) g.root.remove(c);
  g.api.camera = g.persp;
  k3DefaultCamera(g, W, H); g.cam.set = false;
  k3CopyStyle(k3DefaultStyle(), g.style); g.styleKey = '';
}

/** Start a frame: the pools go back to empty and the transform to none. Fill, stroke and material carry over, as in p5. */
export function k3Begin(g, W, H) {
  if (g.cam.w !== W || g.cam.h !== H) {
    // A new size keeps a camera the sketch placed; the default one follows the picture.
    if (!g.cam.set) k3DefaultCamera(g, W, H); else { g.cam.w = W; g.cam.h = H; }
  }
  g.m.identity(); g.depth = 0;
  for (const b of g.batchList) b.n = 0;
  g.lineN = 0;
  g.lightUse.ambient = g.lightUse.directional = g.lightUse.point = 0;
  g.bg = null;
  g.last.batch = null;
  g.stamp++;
}

/** End a frame: trim every pool to what was drawn, pick lit or flat materials, upload. */
export function k3End(g) {
  const lit = g.lightUse.ambient + g.lightUse.directional + g.lightUse.point > 0;
  for (const b of g.batchList) {
    b.mesh.count = b.n;
    b.mesh.visible = b.n > 0;
    if (!b.n) continue;
    if (b.flat) b.mesh.material = lit ? b.lit : b.flat;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.instanceMatrix.clearUpdateRanges(); b.mesh.instanceMatrix.addUpdateRange(0, b.n * 16);
    if (b.mesh.instanceColor) { b.mesh.instanceColor.needsUpdate = true; b.mesh.instanceColor.clearUpdateRanges(); b.mesh.instanceColor.addUpdateRange(0, b.n * 3); }
  }
  // Lights the frame did not call stay in the scene at zero, so the shaders are not rebuilt.
  for (const kind of ['ambient', 'directional', 'point']) {
    const list = g.lights[kind];
    for (let i = g.lightUse[kind]; i < list.length; i++) list[i].intensity = 0;
  }
  const lg = g.lineGeo;
  if (g.lineN) {
    const pa = lg.getAttribute('position');
    if (!pa || pa.array !== g.linePos) { if (pa) lg.dispose(); lg.setAttribute('position', new g.T.BufferAttribute(g.linePos, 3)); lg.setAttribute('color', new g.T.BufferAttribute(g.lineCol, 4)); }
    else { lg.getAttribute('position').needsUpdate = true; lg.getAttribute('color').needsUpdate = true; }
  }
  lg.setDrawRange(0, g.lineN);
  g.lines.visible = g.lineN > 0;
}

/** Place the camera the sketch asked for, and render into `renderer`. Returns its canvas. */
export function k3Render(g, renderer, W, H) {
  const T = g.T, c = g.cam;
  g.api.renderer = renderer;
  let cam = g.api.camera;
  if (cam === g.persp || cam === g.ortho) {
    cam = c.ortho ? g.ortho : g.persp;
    // p5 coordinates to the scene's: y flips, and so does the up vector's sideways part (see k3Create).
    cam.position.set(c.eye[0], -c.eye[1], c.eye[2]);
    cam.up.set(-c.up[0], c.up[1], -c.up[2]);
    if (cam.up.lengthSq() < 1e-9) cam.up.set(0, 1, 0);
    cam.lookAt(c.center[0], -c.center[1], c.center[2]);
    if (c.ortho) { const o = c.ortho; cam.left = o[0]; cam.right = o[1]; cam.bottom = o[2]; cam.top = o[3]; cam.near = o[4]; cam.far = o[5]; }
    else { cam.fov = (c.fov * 180) / Math.PI; cam.aspect = W / H; cam.near = c.near; cam.far = c.far; }
    cam.updateProjectionMatrix();
  } else if (cam && cam.isPerspectiveCamera && Math.abs(cam.aspect - W / H) > 1e-6) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
  if (!renderer || !cam) return null;
  if (g.bg) renderer.setClearColor(g.col.setRGB(g.bg[0], g.bg[1], g.bg[2], T.SRGBColorSpace), g.bg[3]);
  else renderer.setClearColor(0x000000, 0);
  renderer.render(g.scene, cam);
  return renderer.domElement;
}

/** Let the pools' GPU buffers go (the code changed, the layer went). Shared geometry stays. */
export function k3Dispose(g) {
  for (const b of g.batchList) { b.mesh.dispose(); for (const m of [b.flat, b.lit, b.mat]) if (m) m.dispose(); }
  g.batchList.length = 0; g.batches.clear();
  g.lineGeo.dispose(); g.lines.material.dispose();
}

// ── Recording shapes ─────────────────────────────────────────────────────────

function k3StyleKey(g) {
  if (g.styleKey) return g.styleKey;
  const s = g.style, q = v => Math.round(v * 255);
  const tex = s.tex ? s.tex.id : 0;
  g.styleKey = s.mat === 'normal' ? `n|${q(s.fill[3])}` : s.mat === 'specular' ? `s|${q(s.fill[3])}|${tex}|${q(s.spec[0])},${q(s.spec[1])},${q(s.spec[2])}|${s.shin}`
    : s.mat === 'emissive' ? `e|${q(s.fill[3])}|${tex}|${q(s.emis[0])},${q(s.emis[1])},${q(s.emis[2])}` : `${s.mat === 'ambient' ? 'a' : 'f'}|${q(s.fill[3])}|${tex}`;
  return g.styleKey;
}
function k3MakeBatch(g, gg, cap) {
  const T = g.T, s = g.style, alpha = s.fill[3], transparent = alpha < 0.999;
  const common = { transparent, opacity: alpha, side: gg.double ? T.DoubleSide : T.FrontSide };
  if (s.tex) common.map = s.tex;
  const b = { key: '', n: 0, cap, mesh: null, flat: null, lit: null, mat: null, geo: gg };
  if (s.mat === 'normal') b.mat = new T.MeshNormalMaterial({ transparent, opacity: alpha, side: common.side });
  else if (s.mat === 'specular') b.mat = new T.MeshPhongMaterial(Object.assign({ specular: new T.Color().setRGB(s.spec[0], s.spec[1], s.spec[2], T.SRGBColorSpace), shininess: s.shin }, common));
  else if (s.mat === 'emissive') b.mat = new T.MeshLambertMaterial(Object.assign({ emissive: new T.Color().setRGB(s.emis[0], s.emis[1], s.emis[2], T.SRGBColorSpace) }, common));
  else if (s.mat === 'ambient') b.mat = new T.MeshLambertMaterial(common);
  else { b.flat = new T.MeshBasicMaterial(common); b.lit = new T.MeshLambertMaterial(common); }
  b.mesh = new T.InstancedMesh(gg.geo, b.mat || b.flat, cap);
  b.mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  b.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); b.mesh.instanceColor.setUsage(T.DynamicDrawUsage);
  b.mesh.frustumCulled = false;
  b.mesh.count = 0;
  b.mesh.userData.k3 = true;
  g.root.add(b.mesh);
  return b;
}
function k3Grow(g, b) {
  const T = g.T, cap = b.cap * 2, old = b.mesh;
  const mesh = new T.InstancedMesh(old.geometry, old.material, cap);
  mesh.instanceMatrix.array.set(old.instanceMatrix.array);
  mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceColor.array.set(old.instanceColor.array);
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.instanceColor.setUsage(T.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.userData.k3 = true;
  g.root.remove(old); old.dispose();
  g.root.add(mesh);
  b.mesh = mesh; b.cap = cap;
}
/** One shape: a unit geometry `gg`, scaled by sx, sy, sz under the current transform. */
function k3Shape(g, gg, sx, sy, sz) {
  const s = g.style;
  if (s.doFill) {
    const sk = k3StyleKey(g);
    let b = g.last.batch;
    if (!b || g.last.geo !== gg.key || g.last.style !== sk) {
      const key = gg.key + '#' + sk;
      b = g.batches.get(key);
      if (!b) { b = k3MakeBatch(g, gg, 16); b.key = key; g.batches.set(key, b); g.batchList.push(b); }
      g.last.batch = b; g.last.geo = gg.key; g.last.style = sk;
    }
    if (b.n >= b.cap) k3Grow(g, b);
    const m = g.tmp.copy(g.m);
    m.scale(g.v.set(sx, sy, sz));
    m.toArray(b.mesh.instanceMatrix.array, b.n * 16);
    const white = s.mat === 'normal' || !!s.tex;
    g.col.setRGB(white ? 1 : s.fill[0], white ? 1 : s.fill[1], white ? 1 : s.fill[2], g.T.SRGBColorSpace);
    g.col.toArray(b.mesh.instanceColor.array, b.n * 3);
    b.n++;
  }
  if (s.doStroke) {
    const e = k3Edges(g.T, gg);
    const m = g.tmp2.copy(g.m).scale(g.v.set(sx, sy, sz)).elements;
    k3LineRoom(g, e.length / 3);
    const pos = g.linePos, col = g.lineCol, c = s.stroke;
    g.col.setRGB(c[0], c[1], c[2], g.T.SRGBColorSpace);
    for (let i = 0; i < e.length; i += 3) {
      const x = e[i], y = e[i + 1], z = e[i + 2], o = g.lineN * 3, k = g.lineN * 4;
      pos[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
      pos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      pos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      col[k] = g.col.r; col[k + 1] = g.col.g; col[k + 2] = g.col.b; col[k + 3] = c[3];
      g.lineN++;
    }
  }
}
function k3LineRoom(g, more) {
  const need = g.lineN + more;
  if (need * 3 <= g.linePos.length) return;
  let cap = Math.max(256, g.linePos.length / 3);
  while (cap < need) cap *= 2;
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4);
  pos.set(g.linePos); col.set(g.lineCol);
  g.linePos = pos; g.lineCol = col;
}
function k3Light(g, kind) {
  const T = g.T, list = g.lights[kind], i = g.lightUse[kind]++;
  if (i < list.length) return list[i];
  let l;
  if (kind === 'ambient') l = new T.AmbientLight(0xffffff, 0);
  else if (kind === 'directional') { l = new T.DirectionalLight(0xffffff, 0); l.target.userData.k3 = true; g.root.add(l.target); }
  else { l = new T.PointLight(0xffffff, 0, 0, 0); }
  l.userData.k3 = true;
  g.root.add(l);
  list.push(l);
  return l;
}
function k3Texture(g, t) {
  if (!t) return null;
  if (t.isTexture) return t;
  // A canvas, image or video: wrapped once, re-uploaded each frame it is used when it can change.
  let w = g.textures.get(t);
  if (!w) {
    w = { tex: new g.T.Texture(t), stamp: -1, live: typeof HTMLImageElement === 'undefined' || !(t instanceof HTMLImageElement) };
    w.tex.colorSpace = g.T.SRGBColorSpace;
    g.textures.set(t, w);
  }
  if (w.stamp < 0 || (w.live && w.stamp !== g.stamp)) { w.stamp = g.stamp; w.tex.needsUpdate = true; }
  return w.tex;
}

/**
 * The 3D helpers over the 2D ones: `base` is klSketchHelpers' object (maths,
 * colour strings, width, mouseX…), `get()` the current frame's `s`. Returns a
 * new object with base's properties (getters kept) and the 3D names on top.
 */
export function k3Helpers(g, base, get) {
  const P = Object.create(null);
  Object.defineProperties(P, Object.getOwnPropertyDescriptors(base));
  const T = g.T, st = () => g.style;
  const dirty = () => { g.styleKey = ''; };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const det = (v, d) => Math.max(3, Math.min(128, Math.round(num(v, d))));
  const H = {
    // Shapes (p5's defaults and detail).
    box: (w, h, d) => { w = num(w, 50); k3Shape(g, k3Geo(T, 'box', () => new T.BoxGeometry(1, 1, 1)), w, num(h, w), num(d, w)); },
    sphere: (r, dx, dy) => { r = num(r, 50); const a = det(dx, 24), b = det(dy, 16); k3Shape(g, k3Geo(T, `sphere:${a}:${b}`, () => new T.SphereGeometry(1, a, b)), r, r, r); },
    ellipsoid: (rx, ry, rz, dx, dy) => { rx = num(rx, 50); const a = det(dx, 24), b = det(dy, 16); k3Shape(g, k3Geo(T, `sphere:${a}:${b}`, () => new T.SphereGeometry(1, a, b)), rx, num(ry, rx), num(rz, rx)); },
    torus: (r, tube, dx, dy) => {
      r = num(r, 50); tube = num(tube, 10);
      const ratio = Math.max(0.001, Math.round((tube / (r || 1)) * 200) / 200), a = det(dx, 24), b = det(dy, 16);
      k3Shape(g, k3Geo(T, `torus:${ratio}:${a}:${b}`, () => new T.TorusGeometry(1, ratio, b, a)), r, r, r);
    },
    cylinder: (r, h, dx, dy, bottom, top) => {
      r = num(r, 50); const a = det(dx, 24), b = Math.max(1, Math.round(num(dy, 1))), open = bottom === false || top === false;
      k3Shape(g, k3Geo(T, `cylinder:${a}:${b}:${open ? 1 : 0}`, () => new T.CylinderGeometry(1, 1, 1, a, b, open)), r, num(h, r), r);
    },
    cone: (r, h, dx, dy, cap) => {
      r = num(r, 50); const a = det(dx, 24), b = Math.max(1, Math.round(num(dy, 1))), open = cap === false;
      k3Shape(g, k3Geo(T, `cone:${a}:${b}:${open ? 1 : 0}`, () => new T.ConeGeometry(1, 1, a, b, open)), r, num(h, r), r);
    },
    plane: (w, h) => { w = num(w, 50); k3Shape(g, k3Geo(T, 'plane', () => new T.PlaneGeometry(1, 1)), w, num(h, w), 1); },
    line: (...a) => {
      // line(x1, y1, x2, y2) on z = 0, or line(x1, y1, z1, x2, y2, z2); in the stroke colour (the fill's without one).
      const six = a.length >= 6, p = six ? a : [a[0], a[1], 0, a[2], a[3], 0];
      const s = st(), c = s.doStroke ? s.stroke : s.fill, m = g.m.elements;
      k3LineRoom(g, 2);
      g.col.setRGB(c[0], c[1], c[2], T.SRGBColorSpace);
      for (let j = 0; j < 2; j++) {
        const x = num(p[j * 3], 0), y = num(p[j * 3 + 1], 0), z = num(p[j * 3 + 2], 0), o = g.lineN * 3, k = g.lineN * 4;
        g.linePos[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        g.linePos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        g.linePos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        g.lineCol[k] = g.col.r; g.lineCol[k + 1] = g.col.g; g.lineCol[k + 2] = g.col.b; g.lineCol[k + 3] = c[3];
        g.lineN++;
      }
    },
    // Transform.
    push: () => {
      const d = g.depth++;
      if (!g.mstack[d]) { g.mstack[d] = new T.Matrix4(); g.sstack[d] = k3DefaultStyle(); }
      g.mstack[d].copy(g.m); k3CopyStyle(g.style, g.sstack[d]);
    },
    pop: () => { if (g.depth <= 0) return; const d = --g.depth; g.m.copy(g.mstack[d]); k3CopyStyle(g.sstack[d], g.style); dirty(); g.last.batch = null; },
    translate: (x, y, z) => { g.m.multiply(g.tmp.makeTranslation(num(x, 0), num(y, 0), num(z, 0))); },
    rotateX: a => { g.m.multiply(g.tmp.makeRotationX(num(a, 0))); },
    rotateY: a => { g.m.multiply(g.tmp.makeRotationY(num(a, 0))); },
    rotateZ: a => { g.m.multiply(g.tmp.makeRotationZ(num(a, 0))); },
    rotate: (a, axis) => {
      if (Array.isArray(axis) || (axis && typeof axis === 'object')) {
        const v = Array.isArray(axis) ? g.v.set(num(axis[0], 0), num(axis[1], 0), num(axis[2], 1)) : g.v.set(num(axis.x, 0), num(axis.y, 0), num(axis.z, 1));
        if (v.lengthSq() > 0) g.m.multiply(g.tmp.makeRotationAxis(v.normalize(), num(a, 0)));
      } else g.m.multiply(g.tmp.makeRotationZ(num(a, 0)));
    },
    scale: (x, y, z) => { x = num(x, 1); g.m.multiply(g.tmp.makeScale(x, num(y, x), num(z, y === undefined ? x : 1))); },
    resetMatrix: () => { g.m.identity(); },
    // Colour and materials.
    background: (...a) => { g.bg = k3Colour(a, 0, 4, [0, 0, 0, 1]); },
    clear: () => { g.bg = null; },
    fill: (...a) => {
      // The colour rides on each instance; only a new alpha or look needs another batch.
      const s = st(), was = s.fill[3];
      k3Colour(a, 0, 4, s.fill); s.doFill = true;
      if (s.mat !== 'fill' || s.tex || was !== s.fill[3]) { s.mat = 'fill'; s.tex = null; dirty(); }
    },
    noFill: () => { st().doFill = false; },
    stroke: (...a) => { const s = st(); k3Colour(a, 0, 4, s.stroke); s.doStroke = true; },
    noStroke: () => { st().doStroke = false; },
    strokeWeight: () => {},
    normalMaterial: () => { const s = st(); s.mat = 'normal'; s.doFill = true; s.tex = null; dirty(); },
    ambientMaterial: (...a) => { const s = st(); if (a.length) k3Colour(a, 0, 4, s.fill); s.mat = 'ambient'; s.doFill = true; dirty(); },
    specularMaterial: (...a) => { const s = st(); const c = a.length ? k3Colour(a, 0, 4, g.c4) : [1, 1, 1]; s.spec[0] = c[0]; s.spec[1] = c[1]; s.spec[2] = c[2]; s.mat = 'specular'; s.doFill = true; dirty(); },
    emissiveMaterial: (...a) => { const s = st(); const c = k3Colour(a, 0, 4, g.c4); s.emis[0] = c[0]; s.emis[1] = c[1]; s.emis[2] = c[2]; s.mat = 'emissive'; s.doFill = true; dirty(); },
    shininess: n => { st().shin = Math.max(1, num(n, 32)); dirty(); },
    texture: t => { const s = st(); s.tex = k3Texture(g, t); s.doFill = true; if (s.mat === 'normal') s.mat = 'fill'; dirty(); },
    // Lights: they light the whole frame, whenever in draw they are called. Intensities follow p5 (colour 255 = full).
    ambientLight: (...a) => { const c = k3Colour(a, 0, 4, g.c4), l = k3Light(g, 'ambient'); l.color.setRGB(c[0], c[1], c[2], T.SRGBColorSpace); l.intensity = Math.PI; },
    directionalLight: (...a) => {
      const n = k3ColourArgs(a, a.length >= 4 && typeof a[a.length - 1] === 'number' ? 3 : 1), c = k3Colour(a, 0, n, g.c4), l = k3Light(g, 'directional');
      let dx = num(a[n], 0), dy = num(a[n + 1], 0), dz = num(a[n + 2], -1);
      if (a[n] && typeof a[n] === 'object') { const v = a[n]; dx = num(v.x ?? v[0], 0); dy = num(v.y ?? v[1], 0); dz = num(v.z ?? v[2], -1); }
      l.color.setRGB(c[0], c[1], c[2], T.SRGBColorSpace); l.intensity = Math.PI;
      const len = Math.hypot(dx, dy, dz) || 1;
      l.position.set(-dx / len * 1000, -dy / len * 1000, -dz / len * 1000); l.target.position.set(0, 0, 0);
    },
    pointLight: (...a) => {
      const n = k3ColourArgs(a, a.length >= 4 && typeof a[a.length - 1] === 'number' ? 3 : 1), c = k3Colour(a, 0, n, g.c4), l = k3Light(g, 'point');
      let x = num(a[n], 0), y = num(a[n + 1], 0), z = num(a[n + 2], 0);
      if (a[n] && typeof a[n] === 'object') { const v = a[n]; x = num(v.x ?? v[0], 0); y = num(v.y ?? v[1], 0); z = num(v.z ?? v[2], 0); }
      l.color.setRGB(c[0], c[1], c[2], T.SRGBColorSpace); l.intensity = Math.PI; l.position.set(x, y, z);
    },
    // Camera: kept between frames, like p5's (setup is the place to set it once).
    camera: (ex, ey, ez, cx, cy, cz, ux, uy, uz) => {
      const c = g.cam, s = get();
      if (ex === undefined) { k3DefaultCamera(g, s.width, s.height); c.set = false; return; }
      c.eye[0] = num(ex, 0); c.eye[1] = num(ey, 0); c.eye[2] = num(ez, c.eye[2]);
      c.center[0] = num(cx, 0); c.center[1] = num(cy, 0); c.center[2] = num(cz, 0);
      c.up[0] = num(ux, 0); c.up[1] = num(uy, 1); c.up[2] = num(uz, 0);
      c.set = true;
    },
    perspective: (fovy, aspect, near, far) => {
      const c = g.cam, z = Math.hypot(c.eye[0] - c.center[0], c.eye[1] - c.center[1], c.eye[2] - c.center[2]) || 800;
      c.fov = num(fovy, Math.PI / 3); c.near = num(near, z / 10); c.far = num(far, z * 10); c.ortho = null; c.set = true;
    },
    ortho: (l, r, b, t, near, far) => {
      const s = get(), c = g.cam;
      c.ortho = [num(l, -s.width / 2), num(r, s.width / 2), num(b, -s.height / 2), num(t, s.height / 2), num(near, 0), num(far, Math.max(s.width, s.height) * 10)];
      c.set = true;
    },
    orbitControl: (sx, sy) => {
      // Drag on the picture to turn the camera round what it looks at.
      const s = get(), o = g.orbit, m = s.mouse || {};
      const down = !!m.down && m.over !== false;
      if (down && o.down) {
        const dx = (m.x - o.x) / Math.max(1, s.width), dy = (m.y - o.y) / Math.max(1, s.height);
        if (dx || dy) {
          const c = g.cam, ox = c.eye[0] - c.center[0], oy = c.eye[1] - c.center[1], oz = c.eye[2] - c.center[2];
          const r = Math.hypot(ox, oy, oz) || 1;
          let yaw = Math.atan2(ox, oz), pitch = Math.asin(Math.max(-1, Math.min(1, oy / r)));
          yaw -= dx * Math.PI * 2 * num(sx, 1);
          pitch = Math.max(-1.55, Math.min(1.55, pitch + dy * Math.PI * num(sy, 1)));
          c.eye[0] = c.center[0] + r * Math.cos(pitch) * Math.sin(yaw);
          c.eye[1] = c.center[1] + r * Math.sin(pitch);
          c.eye[2] = c.center[2] + r * Math.cos(pitch) * Math.cos(yaw);
          c.up[0] = 0; c.up[1] = 1; c.up[2] = 0;
          c.set = true;
        }
      }
      o.down = down; o.x = m.x; o.y = m.y;
    },
  };
  for (const n of K3_FLAT_ONLY) {
    P[n] = () => { throw new Error(`${n}() draws on the 2D canvas. This layer is in 3D: use box(), sphere() or plane(), or switch the layer’s Mode to 2D.`); };
  }
  for (const k in H) P[k] = H[k];
  return P;
}
