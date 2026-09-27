/**
 * p5.js — p5 compatibility for the Script layer (part of the layer kit, see kit.js).
 *
 * A p5 global-mode sketch (setup / draw / preload, createCanvas, mouseX,
 * mousePressed()…) or an instance-mode one (`new p5(p => { p.setup = … })`)
 * runs as a Script layer. The sketch draws on a canvas of its own, the size
 * createCanvas asked for, which the layer fits into the picture every frame;
 * that canvas keeps what was drawn between frames, as p5's does. WEBGL
 * sketches run on the 3D mode (sketch3d.js). DOM controls (createSlider…)
 * read the layer's declared controls (see kp5Control); other DOM calls do
 * nothing. Top-level names start with `kp5` / `KP5`.
 */
import { k3ParseCss, k3Setup, k3Begin, k3End } from './sketch3d.js';

// ── What p5 names mean here ──────────────────────────────────────────────────

/** p5 names this layer provides (2D, and the shared ones in 3D). For the importer's report and the editor. */
export const KP5_NAMES = [
  // Structure and environment
  'createCanvas', 'resizeCanvas', 'noCanvas', 'pixelDensity', 'displayDensity', 'frameRate', 'getTargetFrameRate', 'getFrameRate',
  'noLoop', 'loop', 'isLooping', 'redraw', 'push', 'pop',
  'width', 'height', 'windowWidth', 'windowHeight', 'displayWidth', 'displayHeight', 'frameCount', 'deltaTime', 'millis', 'focused',
  'cursor', 'noCursor', 'print',
  // Input
  'mouseX', 'mouseY', 'pmouseX', 'pmouseY', 'winMouseX', 'winMouseY', 'movedX', 'movedY', 'mouseIsPressed', 'mouseButton',
  'key', 'keyCode', 'keyIsPressed', 'keyIsDown', 'touches',
  // Colour
  'background', 'clear', 'fill', 'noFill', 'stroke', 'noStroke', 'colorMode', 'color', 'lerpColor',
  'red', 'green', 'blue', 'alpha', 'hue', 'saturation', 'brightness', 'lightness', 'erase', 'noErase', 'blendMode',
  // Shapes and attributes
  'ellipse', 'circle', 'rect', 'square', 'line', 'point', 'triangle', 'quad', 'arc', 'bezier', 'curve',
  'bezierPoint', 'bezierTangent', 'curvePoint', 'curveTightness',
  'beginShape', 'vertex', 'curveVertex', 'bezierVertex', 'quadraticVertex', 'endShape', 'beginContour', 'endContour',
  'strokeWeight', 'strokeCap', 'strokeJoin', 'rectMode', 'ellipseMode', 'smooth', 'noSmooth',
  // Transform
  'translate', 'rotate', 'scale', 'resetMatrix', 'applyMatrix', 'shearX', 'shearY', 'angleMode',
  // Type
  'text', 'textSize', 'textFont', 'textAlign', 'textLeading', 'textStyle', 'textWidth', 'textAscent', 'textDescent', 'textWrap', 'loadFont',
  // Images and pixels
  'image', 'loadImage', 'tint', 'noTint', 'imageMode', 'createImage', 'createGraphics', 'get', 'set', 'pixels', 'loadPixels', 'updatePixels', 'filter',
  // Files
  'loadJSON', 'loadStrings', 'loadTable',
  // Maths
  'abs', 'ceil', 'floor', 'round', 'min', 'max', 'sqrt', 'sq', 'pow', 'exp', 'log', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'map', 'constrain', 'lerp', 'dist', 'mag', 'norm', 'fract', 'radians', 'degrees',
  'random', 'randomSeed', 'randomGaussian', 'noise', 'noiseSeed', 'noiseDetail', 'createVector',
  'int', 'float', 'str', 'boolean', 'hex', 'unhex', 'nf', 'nfc', 'nfs', 'nfp', 'split', 'splitTokens', 'join', 'trim',
  'append', 'shuffle', 'sort', 'reverse', 'concat', 'subset', 'arrayCopy', 'splice',
  'day', 'month', 'year', 'hour', 'minute', 'second',
  // DOM controls, read from the layer's controls
  'createSlider', 'createCheckbox', 'createSelect', 'createRadio', 'createColorPicker', 'createButton', 'control',
  // Sound, read from the live audio input (no playback)
  'getAudioContext', 'userStartAudio',
  // Constants
  'PI', 'TWO_PI', 'HALF_PI', 'QUARTER_PI', 'TAU', 'DEGREES', 'RADIANS',
  'RGB', 'HSB', 'HSL', 'CLOSE', 'OPEN', 'CHORD', 'PIE', 'CORNER', 'CORNERS', 'CENTER', 'RADIUS', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM', 'BASELINE',
  'ROUND', 'SQUARE', 'PROJECT', 'MITER', 'BEVEL', 'POINTS', 'LINES', 'TRIANGLES', 'TRIANGLE_FAN', 'TRIANGLE_STRIP', 'QUADS', 'QUAD_STRIP', 'TESS',
  'NORMAL', 'ITALIC', 'BOLD', 'BOLDITALIC', 'WORD', 'CHAR',
  'BLEND', 'ADD', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEST', 'LIGHTEST', 'DIFFERENCE', 'EXCLUSION', 'HARD_LIGHT', 'SOFT_LIGHT', 'DODGE', 'BURN', 'REPLACE', 'REMOVE',
  'GRAY', 'INVERT', 'THRESHOLD', 'BLUR', 'OPAQUE', 'POSTERIZE', 'ERODE', 'DILATE',
  'P2D', 'WEBGL', 'ARROW', 'CROSS', 'HAND', 'MOVE', 'TEXT', 'WAIT',
  'BACKSPACE', 'DELETE', 'ENTER', 'RETURN', 'TAB', 'ESCAPE', 'SHIFT', 'CONTROL', 'OPTION', 'ALT', 'UP_ARROW', 'DOWN_ARROW', 'LEFT_ARROW', 'RIGHT_ARROW',
];

/** Functions a p5 sketch defines that the layer calls: setup and draw, loading, and events. */
export const KP5_CALLBACKS = [
  'preload', 'setup', 'draw', 'windowResized',
  'mousePressed', 'mouseReleased', 'mouseClicked', 'doubleClicked', 'mouseMoved', 'mouseDragged', 'mouseWheel',
  'keyPressed', 'keyReleased', 'keyTyped', 'touchStarted', 'touchMoved', 'touchEnded',
];

/** p5 names that exist here but do nothing (page elements, cursors, saving): the sketch runs, the call is skipped. */
export const KP5_STUBBED = [
  'createDiv', 'createP', 'createSpan', 'createImg', 'createA', 'createElement', 'createInput', 'createFileInput',
  'select', 'selectAll', 'removeElements', 'noCanvas', 'cursor', 'noCursor', 'fullscreen', 'textWrap',
  'save', 'saveCanvas', 'saveFrames', 'saveJSON', 'saveStrings', 'describe', 'describeElement', 'gridOutput', 'textOutput',
];

/** p5 names this layer cannot do. The importer lists them; calling one throws a clear error. */
export const KP5_UNSUPPORTED = [
  'loadShader', 'createShader', 'shader', 'resetShader', 'loadModel', 'model', 'createFramebuffer', 'buildGeometry', 'beginGeometry', 'endGeometry',
  'createCapture', 'createVideo', 'createAudio', 'loadSound', 'soundFormats', 'loadXML', 'loadBytes', 'httpGet', 'httpPost', 'httpDo',
  'requestPointerLock', 'exitPointerLock', 'textToPoints', 'saveGif', 'setAttributes', 'debugMode', 'noDebugMode',
];

/** The 3D names a WEBGL p5 sketch uses; they run on the 3D mode (sketch3d.js). */
export const KP5_WEBGL = [
  'box', 'sphere', 'ellipsoid', 'torus', 'cylinder', 'cone', 'plane', 'rotateX', 'rotateY', 'rotateZ',
  'normalMaterial', 'ambientMaterial', 'specularMaterial', 'emissiveMaterial', 'shininess', 'texture',
  'ambientLight', 'directionalLight', 'pointLight', 'camera', 'perspective', 'ortho', 'orbitControl',
];

/** p5.sound classes read from the live audio input: amplitude and spectrum, never playback. */
export const KP5_SOUND = ['p5.Amplitude', 'p5.FFT', 'p5.AudioIn'];

/** Is this a p5 sketch (so the layer runs it the p5 way)? createCanvas or `new p5(` says so. */
export function kp5Detect(code) {
  return /\bcreateCanvas\s*\(|\bnew\s+p5\s*\(|\bfunction\s+preload\s*\(/.test(String(code || ''));
}

// ── Numbers: seeded random and p5's noise ───────────────────────────────────

/** A seeded generator (the LCG p5 uses for randomSeed / noiseSeed), 0 ≤ x < 1. */
export function kp5Lcg(seed) {
  let z = (seed == null ? Math.random() * 4294967296 : seed) >>> 0;
  return () => { z = (1664525 * z + 1013904223) % 4294967296; return z / 4294967296; };
}

const KP5_PN = 4095, KP5_YB = 4, KP5_Y = 1 << KP5_YB, KP5_ZB = 8, KP5_Z = 1 << KP5_ZB;
const kp5Cos = i => 0.5 * (1 - Math.cos(i * Math.PI));
/**
 * p5's noise: a table of 4096 random values, read on a lattice with cosine
 * easing, summed over `octaves` with each one `falloff` as strong. Seeded
 * tables are the same every run; unseeded ones come from `rnd`.
 */
export function kp5Noise(rnd) {
  const n = { table: null, octaves: 4, falloff: 0.5, rnd };
  n.seed = seed => { const r = kp5Lcg(seed); n.table = new Float32Array(KP5_PN + 1); for (let i = 0; i <= KP5_PN; i++) n.table[i] = r(); };
  n.at = (x, y, z) => {
    if (!n.table) { n.table = new Float32Array(KP5_PN + 1); for (let i = 0; i <= KP5_PN; i++) n.table[i] = n.rnd(); }
    const p = n.table;
    x = Math.abs(+x || 0); y = Math.abs(+y || 0); z = Math.abs(+z || 0);
    let xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    let r = 0, amp = 0.5;
    for (let o = 0; o < n.octaves; o++) {
      let of = xi + (yi << KP5_YB) + (zi << KP5_ZB);
      const rx = kp5Cos(xf), ry = kp5Cos(yf);
      let n1 = p[of & KP5_PN]; n1 += rx * (p[(of + 1) & KP5_PN] - n1);
      let n2 = p[(of + KP5_Y) & KP5_PN]; n2 += rx * (p[(of + KP5_Y + 1) & KP5_PN] - n2);
      n1 += ry * (n2 - n1);
      of += KP5_Z;
      n2 = p[of & KP5_PN]; n2 += rx * (p[(of + 1) & KP5_PN] - n2);
      let n3 = p[(of + KP5_Y) & KP5_PN]; n3 += rx * (p[(of + KP5_Y + 1) & KP5_PN] - n3);
      n2 += ry * (n3 - n2);
      n1 += kp5Cos(zf) * (n2 - n1);
      r += n1 * amp;
      amp *= n.falloff;
      xi <<= 1; xf *= 2; yi <<= 1; yf *= 2; zi <<= 1; zf *= 2;
      if (xf >= 1) { xi++; xf--; }
      if (yf >= 1) { yi++; yf--; }
      if (zf >= 1) { zi++; zf--; }
    }
    return r;
  };
  return n;
}

// ── Vectors ──────────────────────────────────────────────────────────────────

const kp5V3 = (x, y, z) => {
  if (x instanceof kp5Vector) return [x.x, x.y, x.z];
  if (Array.isArray(x)) return [+x[0] || 0, +x[1] || 0, +x[2] || 0];
  return [+x || 0, +y || 0, +z || 0];
};
/** A scalar, or per-axis numbers / a vector / an array, for mult and div. */
const kp5Scale = (x, y, z) => {
  if (x instanceof kp5Vector || Array.isArray(x)) return kp5V3(x);
  if (y === undefined && z === undefined) { const n = +x || 0; return [n, n, n]; }
  return [+x || 0, y === undefined ? 1 : +y || 0, z === undefined ? 1 : +z || 0];
};

/** p5.Vector: x, y, z and the usual maths; methods change the vector and return it, statics make new ones. */
export class kp5Vector {
  constructor(x, y, z) { this.x = +x || 0; this.y = +y || 0; this.z = +z || 0; }
  set(x, y, z) { const a = kp5V3(x, y, z); this.x = a[0]; this.y = a[1]; this.z = a[2]; return this; }
  copy() { return new kp5Vector(this.x, this.y, this.z); }
  add(x, y, z) { const a = kp5V3(x, y, z); this.x += a[0]; this.y += a[1]; this.z += a[2]; return this; }
  sub(x, y, z) { const a = kp5V3(x, y, z); this.x -= a[0]; this.y -= a[1]; this.z -= a[2]; return this; }
  mult(x, y, z) { const a = kp5Scale(x, y, z); this.x *= a[0]; this.y *= a[1]; this.z *= a[2]; return this; }
  div(x, y, z) {
    const a = kp5Scale(x, y, z);
    // p5 leaves the vector as it is rather than dividing by zero.
    if (!a[0] || !a[1] || (!a[2] && this.z && (x instanceof kp5Vector || Array.isArray(x) || z !== undefined))) { if (!a[0] || !a[1]) return this; }
    this.x /= a[0]; this.y /= a[1]; if (a[2]) this.z /= a[2];
    return this;
  }
  rem(x, y, z) { const a = kp5Scale(x, y, z); if (a[0]) this.x %= a[0]; if (a[1]) this.y %= a[1]; if (a[2]) this.z %= a[2]; return this; }
  mag() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  magSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  dot(x, y, z) { const a = kp5V3(x, y, z); return this.x * a[0] + this.y * a[1] + this.z * a[2]; }
  cross(v) { return new kp5Vector(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x); }
  dist(v) { return Math.hypot(v.x - this.x, v.y - this.y, v.z - this.z); }
  normalize() { const m = this.mag(); if (m) { this.x /= m; this.y /= m; this.z /= m; } return this; }
  limit(max) { const m2 = this.magSq(); if (m2 > max * max) { const k = max / Math.sqrt(m2); this.x *= k; this.y *= k; this.z *= k; } return this; }
  setMag(n) { return this.normalize().mult(n); }
  heading() { return Math.atan2(this.y, this.x); }
  setHeading(a) { const m = this.mag(); this.x = m * Math.cos(a); this.y = m * Math.sin(a); return this; }
  rotate(a) { const h = this.heading() + a, m = this.mag(); this.x = Math.cos(h) * m; this.y = Math.sin(h) * m; return this; }
  angleBetween(v) { const d = this.mag() * v.mag(); if (!d) return 0; const c = Math.max(-1, Math.min(1, this.dot(v) / d)); const a = Math.acos(c); return this.x * v.y - this.y * v.x < 0 ? -a : a; }
  lerp(x, y, z, t) { if (x instanceof kp5Vector) { t = y; z = x.z; y = x.y; x = x.x; } this.x += (x - this.x) * t; this.y += (y - this.y) * t; this.z += ((+z || 0) - this.z) * t; return this; }
  reflect(n) { const u = n.copy().normalize(); return this.sub(u.mult(2 * this.dot(u))); }
  array() { return [this.x, this.y, this.z]; }
  equals(x, y, z) { const a = kp5V3(x, y, z); return this.x === a[0] && this.y === a[1] && this.z === a[2]; }
  toString() { return `p5.Vector Object : [${this.x}, ${this.y}, ${this.z}]`; }
  static fromAngle(a, len) { const l = len === undefined ? 1 : len; return new kp5Vector(l * Math.cos(a), l * Math.sin(a), 0); }
  static fromAngles(theta, phi, len) { const l = len === undefined ? 1 : len; const cp = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(theta), s = Math.sin(theta); return new kp5Vector(l * s * sp, -l * ct, l * s * cp); }
  static random2D() { return kp5Vector.fromAngle(kp5Vector.rnd() * Math.PI * 2); }
  static random3D() { const a = kp5Vector.rnd() * Math.PI * 2, vz = kp5Vector.rnd() * 2 - 1, r = Math.sqrt(1 - vz * vz); return new kp5Vector(r * Math.cos(a), r * Math.sin(a), vz); }
  static add(a, b, t) { return (t ? t.set(a) : a.copy()).add(b); }
  static sub(a, b, t) { return (t ? t.set(a) : a.copy()).sub(b); }
  static mult(a, n, t) { return (t ? t.set(a) : a.copy()).mult(n); }
  static div(a, n, t) { return (t ? t.set(a) : a.copy()).div(n); }
  static dist(a, b) { return a.dist(b); }
  static dot(a, b) { return a.dot(b); }
  static cross(a, b) { return a.cross(b); }
  static lerp(a, b, t) { return a.copy().lerp(b, t); }
  static mag(a) { return a.mag(); }
  static normalize(a) { return a.copy().normalize(); }
  static limit(a, m) { return a.copy().limit(m); }
  static setMag(a, m) { return a.copy().setMag(m); }
  static angleBetween(a, b) { return a.angleBetween(b); }
  static copy(a) { return a.copy(); }
}
/** Where p5.Vector.random2D / random3D draw from (the running sketch's random). */
kp5Vector.rnd = Math.random;

// ── Colour ───────────────────────────────────────────────────────────────────

/** Hue (degrees), saturation and brightness / lightness (0–1) to r, g, b (0–1). */
function kp5Hsx(h, s, x, hsb) {
  h = (((h % 360) + 360) % 360) / 60;
  let c, m;
  if (hsb) { c = x * s; m = x - c; } else { c = (1 - Math.abs(2 * x - 1)) * s; m = x - c / 2; }
  const k = c * (1 - Math.abs((h % 2) - 1));
  const t = h < 1 ? [c, k, 0] : h < 2 ? [k, c, 0] : h < 3 ? [0, c, k] : h < 4 ? [0, k, c] : h < 5 ? [k, 0, c] : [c, 0, k];
  return [t[0] + m, t[1] + m, t[2] + m];
}
function kp5ToHsx(r, g, b, hsb) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (hsb) return [h, mx ? d / mx : 0, mx];
  const l = (mx + mn) / 2;
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
}

/** p5.Color: levels 0–255 (r, g, b, a); prints as CSS, so it works anywhere a CSS colour does. */
export class kp5Color {
  constructor(levels) { this.levels = levels.slice(0, 4); if (this.levels.length < 4) this.levels[3] = 255; }
  toString() { return kp5Css(this.levels); }
  setRed(v) { this.levels[0] = v; }
  setGreen(v) { this.levels[1] = v; }
  setBlue(v) { this.levels[2] = v; }
  setAlpha(v) { this.levels[3] = v; }
  get _array() { return this.levels.map(v => v / 255); }
}

const KP5_DEFAULT_MAX = { rgb: [255, 255, 255, 255], hsb: [360, 100, 100, 1], hsl: [360, 100, 100, 1] };
function kp5Css(l) { return `rgba(${Math.round(l[0])}, ${Math.round(l[1])}, ${Math.round(l[2])}, ${+(l[3] / 255).toFixed(4)})`; }

/** Colour arguments in a colour mode (with its maxes) to levels 0–255. Strings are CSS; arrays and p5 colours pass through. */
export function kp5Levels(args, mode, maxes) {
  const a0 = args[0];
  if (a0 instanceof kp5Color) return a0.levels.slice();
  if (Array.isArray(a0)) return kp5Levels(a0, mode, maxes);
  const mx = maxes || KP5_DEFAULT_MAX[mode] || KP5_DEFAULT_MAX.rgb;
  if (typeof a0 === 'string') {
    const out = [1, 1, 1, 1];
    k3ParseCss(a0, out);
    const l = [out[0] * 255, out[1] * 255, out[2] * 255, out[3] * 255];
    if (typeof args[1] === 'number') l[3] = Math.max(0, Math.min(255, (args[1] / mx[3]) * 255));
    return l;
  }
  const n = args.length, num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const c01 = v => Math.max(0, Math.min(1, v));
  if (n === 0 || a0 === undefined) return [255, 255, 255, 255];
  if (n <= 2) {
    // Grey (and alpha): of the first max in RGB, of brightness / lightness in HSB / HSL.
    const g = c01(num(a0, 0) / (mode === 'hsb' || mode === 'hsl' ? mx[2] : mx[0])) * 255;
    return [g, g, g, n === 2 ? c01(num(args[1], mx[3]) / mx[3]) * 255 : 255];
  }
  const al = n >= 4 ? c01(num(args[3], mx[3]) / mx[3]) * 255 : 255;
  if (mode !== 'hsb' && mode !== 'hsl') return [c01(num(a0, 0) / mx[0]) * 255, c01(num(args[1], 0) / mx[1]) * 255, c01(num(args[2], 0) / mx[2]) * 255, al];
  const rgb = kp5Hsx((num(a0, 0) / mx[0]) * 360, c01(num(args[1], 0) / mx[1]), c01(num(args[2], 0) / mx[2]), mode === 'hsb');
  return [rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, al];
}

// ── Keyboard and wheel (one listener per page) ──────────────────────────────

const KP5_EVENTS = { seq: 0, list: [], held: new Set(), on: false };
function kp5Push(ev) { ev.seq = ++KP5_EVENTS.seq; KP5_EVENTS.list.push(ev); if (KP5_EVENTS.list.length > 64) KP5_EVENTS.list.shift(); }
function kp5Listen() {
  if (KP5_EVENTS.on || typeof window === 'undefined' || !window.addEventListener) return;
  KP5_EVENTS.on = true;
  // Typing in a field (the code editor) is not the sketch's keyboard.
  const typing = e => { const t = e.target; return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))); };
  window.addEventListener('keydown', e => { if (typing(e) || e.repeat) return; KP5_EVENTS.held.add(e.keyCode); kp5Push({ type: 'down', key: e.key, keyCode: e.keyCode }); });
  window.addEventListener('keyup', e => { KP5_EVENTS.held.delete(e.keyCode); if (!typing(e)) kp5Push({ type: 'up', key: e.key, keyCode: e.keyCode }); });
  window.addEventListener('blur', () => { KP5_EVENTS.held.clear(); });
  window.addEventListener('wheel', e => kp5Push({ type: 'wheel', delta: e.deltaY }), { passive: true });
}
/** A key or wheel event as the page would deliver it (tests; hosts without a window). */
export function kp5Event(ev) {
  if (ev.type === 'down') KP5_EVENTS.held.add(ev.keyCode);
  if (ev.type === 'up') KP5_EVENTS.held.delete(ev.keyCode);
  kp5Push(Object.assign({}, ev));
}

// ── Page elements: a handle that takes any call ─────────────────────────────

/**
 * What createDiv, createCanvas's return and the DOM controls hand back: every
 * p5.Element method is there and does nothing (returning the handle, so
 * chains work). mousePressed / changed / input keep their callbacks.
 */
function kp5Handle(extra) {
  const h = { elt: null, _cb: {} };
  const self = () => h;
  for (const m of ['position', 'style', 'size', 'parent', 'class', 'addClass', 'removeClass', 'id', 'html', 'hide', 'show', 'remove', 'attribute', 'removeAttribute', 'center', 'child', 'option', 'selected', 'disable', 'enable', 'drop', 'draggable', 'touchStarted', 'touchEnded', 'mouseOver', 'mouseOut', 'mouseReleased', 'mouseClicked', 'mouseMoved', 'doubleClicked', 'mouseWheel', 'dragOver', 'dragLeave', 'value']) h[m] = self;
  h.value = () => '';
  for (const m of ['mousePressed', 'changed', 'input']) h[m] = fn => { if (typeof fn === 'function') h._cb[m] = fn; return h; };
  return Object.assign(h, extra || {});
}

// ── Canvases, images, surfaces ───────────────────────────────────────────────

function kp5MakeCanvas(host, w, h) {
  const make = host && host.makeCanvas;
  let c = null;
  if (make) c = make(w, h);
  else if (typeof document !== 'undefined') c = document.createElement('canvas');
  else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
  if (!c) return null;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

/** p5.Image: a canvas (none while loading) with p5's pixel methods. */
export class kp5Image {
  constructor(host, w, h) { this._host = host; this.width = w | 0; this.height = h | 0; this.canvas = w && h ? kp5MakeCanvas(host, w | 0, h | 0) : null; this.pixels = []; this._data = null; this.ready = !!this.canvas; this.version = 0; }
  get elt() { return this.canvas; }
  _ctx() { return this.canvas ? this.canvas.getContext('2d') : null; }
  loadPixels() { const c = this._ctx(); if (!c) return; this._data = c.getImageData(0, 0, this.canvas.width, this.canvas.height); this.pixels = this._data.data; }
  updatePixels() { const c = this._ctx(); if (c && this._data) { c.putImageData(this._data, 0, 0); this.version++; } }
  get(x, y, w, h) { return kp5GetPixels(this._host, this.canvas, 1, x, y, w, h); }
  set(x, y, c) { if (!this._data) this.loadPixels(); kp5SetPixel(this._data, this.canvas ? this.canvas.width : 0, 1, x, y, c); }
  resize(w, h) {
    if (!this.canvas) return;
    if (!w && h) w = Math.round((this.width * h) / this.height);
    if (!h && w) h = Math.round((this.height * w) / this.width);
    const n = kp5MakeCanvas(this._host, Math.max(1, w | 0), Math.max(1, h | 0));
    if (!n) return;
    n.getContext('2d').drawImage(this.canvas, 0, 0, n.width, n.height);
    this.canvas = n; this.width = n.width; this.height = n.height; this._data = null; this.version++;
  }
  copy(src, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (typeof src === 'number') { dh = dw; dw = dy; dy = dx; dx = sh; sh = sw; sw = sy; sy = sx; sx = src; src = this; }
    const c = this._ctx(), el = kp5Source(src);
    if (!c || !el) return;
    c.drawImage(el, sx, sy, sw, sh, dx, dy, dw, dh); this.version++;
  }
  mask(m) { const c = this._ctx(), el = kp5Source(m); if (!c || !el) return; c.save(); c.globalCompositeOperation = 'destination-in'; c.drawImage(el, 0, 0, this.width, this.height); c.restore(); this.version++; }
  filter(kind, v) { if (!this.canvas) return; kp5Filter(this._ctx(), this.canvas, kind, v); this.version++; }
  save() {}
}
/** What drawImage takes for a p5 image, a graphics buffer or an element. */
function kp5Source(im) {
  if (!im) return null;
  if (im instanceof kp5Image) return im.canvas;
  if (im._surface) return im._surface.canvas;
  return im;
}
function kp5GetPixels(host, canvas, d, x, y, w, h) {
  if (!canvas) return x !== undefined && w === undefined ? [0, 0, 0, 0] : new kp5Image(host, 1, 1);
  const c = canvas.getContext('2d');
  if (x === undefined) { const im = new kp5Image(host, canvas.width, canvas.height); if (im.canvas) im.canvas.getContext('2d').drawImage(canvas, 0, 0); return im; }
  if (w === undefined) {
    const px = Math.floor(x * d), py = Math.floor(y * d);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return [0, 0, 0, 0];
    const p = c.getImageData(px, py, 1, 1).data;
    return [p[0], p[1], p[2], p[3]];
  }
  const im = new kp5Image(host, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  if (im.canvas) im.canvas.getContext('2d').drawImage(canvas, x * d, y * d, w * d, h * d, 0, 0, im.width, im.height);
  return im;
}
function kp5SetPixel(data, cw, d, x, y, col) {
  if (!data || !cw) return;
  const l = typeof col === 'number' ? [col, col, col, 255] : kp5Levels([col], 'rgb');
  const ch = data.data.length / 4 / cw;
  for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
    const px = Math.floor(x * d) + i, py = Math.floor(y * d) + j;
    if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
    const k = (py * cw + px) * 4;
    data.data[k] = l[0]; data.data[k + 1] = l[1]; data.data[k + 2] = l[2]; data.data[k + 3] = l[3];
  }
}
function kp5Filter(c, canvas, kind, v) {
  if (!c || !canvas) return;
  const k = String(kind || '').toLowerCase();
  if (k === 'blur') {
    if (!('filter' in c)) return;
    const tmp = kp5MakeCanvas(null, canvas.width, canvas.height);
    if (!tmp) return;
    tmp.getContext('2d').drawImage(canvas, 0, 0);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.filter = `blur(${Math.max(0, v === undefined ? 1 : +v)}px)`; c.clearRect(0, 0, canvas.width, canvas.height); c.drawImage(tmp, 0, 0); c.restore();
    return;
  }
  if (k !== 'gray' && k !== 'invert' && k !== 'threshold' && k !== 'posterize' && k !== 'opaque') return;
  const img = c.getImageData(0, 0, canvas.width, canvas.height), p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    if (k === 'gray') { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; p[i] = p[i + 1] = p[i + 2] = y; }
    else if (k === 'invert') { p[i] = 255 - r; p[i + 1] = 255 - g; p[i + 2] = 255 - b; }
    else if (k === 'threshold') { const t = (v === undefined ? 0.5 : +v) * 255; const y = 0.2126 * r + 0.7152 * g + 0.0722 * b >= t ? 255 : 0; p[i] = p[i + 1] = p[i + 2] = y; }
    else if (k === 'posterize') { const n = Math.max(2, Math.min(255, v | 0 || 4)); const q = x => Math.round((Math.round((x / 255) * (n - 1)) * 255) / (n - 1)); p[i] = q(r); p[i + 1] = q(g); p[i + 2] = q(b); }
    else if (k === 'opaque') p[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

const KP5_BLEND = { blend: 'source-over', add: 'lighter', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darkest: 'darken', lightest: 'lighten', difference: 'difference', exclusion: 'exclusion', hard_light: 'hard-light', soft_light: 'soft-light', dodge: 'color-dodge', burn: 'color-burn', replace: 'copy', remove: 'destination-out' };

function kp5Style() {
  return {
    fill: [255, 255, 255, 255], stroke: [0, 0, 0, 255], doFill: true, doStroke: true, strokeSet: false, weight: 1, cap: 'round', join: 'miter',
    rectMode: 'corner', ellipseMode: 'center', imageMode: 'corner', angle: 'radians', cmode: 'rgb', maxes: KP5_DEFAULT_MAX.rgb.slice(),
    textSize: 12, textFont: 'sans-serif', textStyle: 'normal', textLeading: 15, alignH: 'left', alignV: 'alphabetic',
    tint: null, blend: 'source-over', erasing: false, eraseFill: 255, eraseStroke: 255, tight: 0,
  };
}
const kp5CopyStyle = s => Object.assign({}, s, { fill: s.fill.slice(), stroke: s.stroke.slice(), maxes: s.maxes.slice(), tint: s.tint ? s.tint.slice() : null });

/** A surface: a canvas a sketch (or a createGraphics buffer) draws on, its density and its style. */
function kp5Surface(host, w, h, d) {
  const sf = { canvas: null, ctx: null, w: 0, h: 0, d: 1, style: kp5Style(), stack: [], shape: null, data: null, pixels: [] };
  kp5Resize(host, sf, w, h, d);
  return sf;
}
function kp5Resize(host, sf, w, h, d) {
  sf.w = Math.max(1, Math.round(w)); sf.h = Math.max(1, Math.round(h)); sf.d = d > 0 ? d : 1;
  const cw = Math.max(1, Math.round(sf.w * sf.d)), ch = Math.max(1, Math.round(sf.h * sf.d));
  sf.canvas = kp5MakeCanvas(host, cw, ch);
  sf.ctx = sf.canvas ? sf.canvas.getContext('2d') : null;
  sf.data = null; sf.pixels = [];
  kp5Reset(sf);
}
/** The matrix p5 starts each draw with: none, apart from the density; and the style's line settings. */
function kp5Reset(sf) { if (sf.ctx) { sf.ctx.setTransform(sf.d, 0, 0, sf.d, 0, 0); kp5Apply(sf); } }
function kp5Apply(sf) {
  const c = sf.ctx, s = sf.style;
  if (!c) return;
  c.lineWidth = s.weight; c.lineCap = s.cap; c.lineJoin = s.join;
  c.globalCompositeOperation = s.erasing ? 'destination-out' : s.blend;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Drawing on one surface: shapes, colour, transforms, type, images and pixels, as p5's 2D renderer does them. */
function kp5Drawing(host, sf) {
  const C = () => { if (!sf.ctx) throw new Error('This sketch has no 2D canvas here (a WEBGL sketch draws in 3D).'); return sf.ctx; };
  const S = () => sf.style;
  const ang = a => (S().angle === 'degrees' ? (a * Math.PI) / 180 : a);
  const lv = a => kp5Levels(a, S().cmode, S().maxes);
  const fillIt = c => { const s = S(); if (!s.doFill) return; c.fillStyle = s.erasing ? `rgba(0,0,0,${s.eraseFill / 255})` : kp5Css(s.fill); c.fill(); };
  const strokeIt = c => { const s = S(); if (!s.doStroke) return; c.strokeStyle = s.erasing ? `rgba(0,0,0,${s.eraseStroke / 255})` : kp5Css(s.stroke); c.lineWidth = s.weight; c.stroke(); };
  const paint = (c, closeIt) => { if (closeIt) c.closePath(); fillIt(c); strokeIt(c); };
  const ell = (x, y, w, h) => {
    const m = S().ellipseMode;
    if (h === undefined) h = w;
    if (m === 'radius') return [x, y, Math.abs(w), Math.abs(h)];
    if (m === 'corner') return [x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2];
    if (m === 'corners') return [(x + w) / 2, (y + h) / 2, Math.abs(w - x) / 2, Math.abs(h - y) / 2];
    return [x, y, Math.abs(w) / 2, Math.abs(h) / 2];
  };
  const rct = (x, y, w, h) => {
    const m = S().rectMode;
    if (h === undefined) h = w;
    if (m === 'center') return [x - w / 2, y - h / 2, w, h];
    if (m === 'radius') return [x - w, y - h, w * 2, h * 2];
    if (m === 'corners') return [Math.min(x, w), Math.min(y, h), Math.abs(w - x), Math.abs(h - y)];
    return [x, y, w, h];
  };
  // A Catmull-Rom piece from p1 to p2 as a cubic (curveTightness 0 is p5's default).
  const catmull = (c, p0, p1, p2, p3, first) => {
    const k = (1 - (S().tight || 0)) / 6;
    if (first) c.moveTo(p1[0], p1[1]);
    c.bezierCurveTo(p1[0] + k * (p2[0] - p0[0]), p1[1] + k * (p2[1] - p0[1]), p2[0] - k * (p3[0] - p1[0]), p2[1] - k * (p3[1] - p1[1]), p2[0], p2[1]);
  };
  const dot = (c, x, y) => {
    const s = S();
    if (!s.doStroke) return;
    c.save(); c.fillStyle = s.erasing ? `rgba(0,0,0,${s.eraseStroke / 255})` : kp5Css(s.stroke); c.beginPath();
    if (s.cap === 'butt' || s.cap === 'square') c.rect(x - s.weight / 2, y - s.weight / 2, s.weight, s.weight);
    else c.arc(x, y, Math.max(0.5, s.weight / 2), 0, Math.PI * 2);
    c.fill(); c.restore();
  };
  const fontOf = () => { const s = S(); const st = s.textStyle === 'bolditalic' ? 'italic bold' : s.textStyle === 'normal' ? '' : s.textStyle; return `${st ? st + ' ' : ''}${s.textSize}px ${s.textFont}`; };
  // A tinted copy of an image, kept until the tint or the image changes.
  const tinted = new WeakMap();
  const tintedOf = (im, el, w, h) => {
    const t = S().tint;
    if (!t || (t[0] === 255 && t[1] === 255 && t[2] === 255)) return el;
    const key = t.slice(0, 3).join(',') + ':' + ((im && im.version) || 0);
    let e = tinted.get(el);
    if (!e || e.key !== key) {
      const cv = kp5MakeCanvas(host, Math.max(1, w | 0), Math.max(1, h | 0));
      if (!cv) return el;
      const x = cv.getContext('2d');
      x.drawImage(el, 0, 0, cv.width, cv.height);
      x.globalCompositeOperation = 'multiply'; x.fillStyle = `rgb(${t[0]}, ${t[1]}, ${t[2]})`; x.fillRect(0, 0, cv.width, cv.height);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(el, 0, 0, cv.width, cv.height);
      e = { key, cv }; tinted.set(el, e);
    }
    return e.cv;
  };
  const D = {
    background: (...a) => {
      const c = C();
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
      const el = a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) && !(a[0] instanceof kp5Color) ? kp5Source(a[0]) : null;
      if (el) c.drawImage(el, 0, 0, sf.canvas.width, sf.canvas.height);
      else { c.fillStyle = kp5Css(lv(a)); c.fillRect(0, 0, sf.canvas.width, sf.canvas.height); }
      c.restore();
    },
    clear: () => { const c = C(); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, sf.canvas.width, sf.canvas.height); c.restore(); },
    fill: (...a) => { const s = S(); s.fill = lv(a); s.doFill = true; },
    noFill: () => { S().doFill = false; },
    stroke: (...a) => { const s = S(); s.stroke = lv(a); s.doStroke = true; s.strokeSet = true; },
    noStroke: () => { S().doStroke = false; },
    strokeWeight: w => { S().weight = +w || 0; if (sf.ctx) sf.ctx.lineWidth = S().weight; },
    strokeCap: m => { S().cap = m === 'square' ? 'butt' : m === 'project' ? 'square' : 'round'; if (sf.ctx) sf.ctx.lineCap = S().cap; },
    strokeJoin: m => { S().join = m === 'bevel' ? 'bevel' : m === 'round' ? 'round' : 'miter'; if (sf.ctx) sf.ctx.lineJoin = S().join; },
    colorMode: (m, a, b, c, d) => {
      const s = S(), mode = m === 'hsb' || m === 'hsl' ? m : 'rgb';
      s.cmode = mode; s.maxes = KP5_DEFAULT_MAX[mode].slice();
      if (a !== undefined && b === undefined) s.maxes = [a, a, a, a];
      else if (c !== undefined) s.maxes = [a, b, c, d === undefined ? s.maxes[3] : d];
    },
    color: (...a) => new kp5Color(lv(a)),
    erase: (f, s) => { const st = S(); st.erasing = true; st.eraseFill = f === undefined ? 255 : f; st.eraseStroke = s === undefined ? 255 : s; if (sf.ctx) sf.ctx.globalCompositeOperation = 'destination-out'; },
    noErase: () => { const st = S(); st.erasing = false; if (sf.ctx) sf.ctx.globalCompositeOperation = st.blend; },
    blendMode: m => { const st = S(); st.blend = KP5_BLEND[m] || 'source-over'; if (sf.ctx && !st.erasing) sf.ctx.globalCompositeOperation = st.blend; },
    ellipseMode: m => { S().ellipseMode = m; },
    rectMode: m => { S().rectMode = m; },
    imageMode: m => { S().imageMode = m; },
    angleMode: m => { if (m === 'degrees' || m === 'radians') S().angle = m; else return S().angle; },
    smooth: () => { if (sf.ctx) sf.ctx.imageSmoothingEnabled = true; },
    noSmooth: () => { if (sf.ctx) sf.ctx.imageSmoothingEnabled = false; },
    // Shapes
    ellipse: (x, y, w, h) => { const c = C(), e = ell(x, y, w, h); c.beginPath(); c.ellipse(e[0], e[1], e[2], e[3], 0, 0, Math.PI * 2); paint(c, false); },
    circle: (x, y, d) => D.ellipse(x, y, d, d),
    rect: (x, y, w, h, tl, tr, br, bl) => {
      const c = C(), r = rct(x, y, w, h);
      c.beginPath();
      if (tl !== undefined && typeof c.roundRect === 'function') c.roundRect(r[0], r[1], r[2], r[3], tr === undefined ? tl : [tl, tr, br || 0, bl || 0]);
      else c.rect(r[0], r[1], r[2], r[3]);
      paint(c, false);
    },
    square: (x, y, s, tl, tr, br, bl) => D.rect(x, y, s, s, tl, tr, br, bl),
    line: (x1, y1, x2, y2) => { const c = C(); if (!S().doStroke) return; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); strokeIt(c); },
    point: (x, y) => { if (x instanceof kp5Vector) { y = x.y; x = x.x; } dot(C(), x, y); },
    triangle: (x1, y1, x2, y2, x3, y3) => { const c = C(); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); paint(c, true); },
    quad: (x1, y1, x2, y2, x3, y3, x4, y4) => { const c = C(); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.lineTo(x4, y4); paint(c, true); },
    arc: (x, y, w, h, a0, a1, mode) => {
      // Filled as a wedge (a chord for CHORD); stroked open, closed (CHORD) or to the centre (PIE).
      const c = C(), e = ell(x, y, w, h), s = S();
      let start = ang(a0), stop = ang(a1);
      if (Math.abs(stop - start) >= Math.PI * 2 - 1e-9) { start = 0; stop = Math.PI * 2; }
      if (s.doFill) { c.beginPath(); if (mode !== 'chord') c.moveTo(e[0], e[1]); c.ellipse(e[0], e[1], e[2], e[3], 0, start, stop); c.closePath(); fillIt(c); }
      if (s.doStroke) {
        c.beginPath(); c.ellipse(e[0], e[1], e[2], e[3], 0, start, stop);
        if (mode === 'pie') { c.lineTo(e[0], e[1]); c.closePath(); } else if (mode === 'chord') c.closePath();
        strokeIt(c);
      }
    },
    bezier: (x1, y1, x2, y2, x3, y3, x4, y4) => { const c = C(); c.beginPath(); c.moveTo(x1, y1); c.bezierCurveTo(x2, y2, x3, y3, x4, y4); fillIt(c); strokeIt(c); },
    curve: (x1, y1, x2, y2, x3, y3, x4, y4) => { const c = C(); c.beginPath(); catmull(c, [x1, y1], [x2, y2], [x3, y3], [x4, y4], true); fillIt(c); strokeIt(c); },
    curveTightness: t => { S().tight = +t || 0; },
    beginShape: kind => { sf.shape = { kind: kind || null, v: [], contours: [], cur: null }; sf.shape.cur = sf.shape.v; },
    vertex: (x, y) => { if (x instanceof kp5Vector) { y = x.y; x = x.x; } if (sf.shape) sf.shape.cur.push({ t: 'v', x, y }); },
    curveVertex: (x, y) => { if (sf.shape) sf.shape.cur.push({ t: 'c', x, y }); },
    bezierVertex: (a, b, c, d, e, f) => { if (sf.shape) sf.shape.cur.push({ t: 'b', a: [a, b, c, d, e, f] }); },
    quadraticVertex: (a, b, c, d) => { if (sf.shape) sf.shape.cur.push({ t: 'q', a: [a, b, c, d] }); },
    beginContour: () => { if (sf.shape) { sf.shape.cur = []; sf.shape.contours.push(sf.shape.cur); } },
    endContour: () => { if (sf.shape) sf.shape.cur = sf.shape.v; },
    endShape: mode => {
      const sh = sf.shape;
      sf.shape = null;
      if (!sh || !sh.v.length) return;
      const c = C(), k = sh.kind, pts = sh.v.filter(p => p.t === 'v' || p.t === 'c');
      if (k === 'points') { for (const p of pts) dot(c, p.x, p.y); return; }
      if (k === 'lines') { if (!S().doStroke) return; c.beginPath(); for (let i = 0; i + 1 < pts.length; i += 2) { c.moveTo(pts[i].x, pts[i].y); c.lineTo(pts[i + 1].x, pts[i + 1].y); } strokeIt(c); return; }
      const poly = list => { c.beginPath(); c.moveTo(list[0].x, list[0].y); for (let i = 1; i < list.length; i++) c.lineTo(list[i].x, list[i].y); paint(c, true); };
      if (k === 'triangles') { for (let i = 0; i + 2 < pts.length; i += 3) poly(pts.slice(i, i + 3)); return; }
      if (k === 'triangle_strip') { for (let i = 0; i + 2 < pts.length; i++) poly(pts.slice(i, i + 3)); return; }
      if (k === 'triangle_fan') { for (let i = 1; i + 1 < pts.length; i++) poly([pts[0], pts[i], pts[i + 1]]); return; }
      if (k === 'quads') { for (let i = 0; i + 3 < pts.length; i += 4) poly(pts.slice(i, i + 4)); return; }
      if (k === 'quad_strip') { for (let i = 0; i + 3 < pts.length; i += 2) poly([pts[i], pts[i + 1], pts[i + 3], pts[i + 2]]); return; }
      const trace = list => {
        const curves = list.filter(p => p.t === 'c');
        if (curves.length && curves.length === list.length) {
          if (curves.length < 4) return;
          const P = curves.map(p => [p.x, p.y]);
          for (let i = 1; i + 2 < P.length; i++) catmull(c, P[i - 1], P[i], P[i + 1], P[i + 2], i === 1);
          return;
        }
        let started = false;
        for (const p of list) {
          if (p.t === 'v' || p.t === 'c') { if (!started) { c.moveTo(p.x, p.y); started = true; } else c.lineTo(p.x, p.y); }
          else if (p.t === 'b' && started) c.bezierCurveTo(p.a[0], p.a[1], p.a[2], p.a[3], p.a[4], p.a[5]);
          else if (p.t === 'q' && started) c.quadraticCurveTo(p.a[0], p.a[1], p.a[2], p.a[3]);
        }
      };
      c.beginPath();
      trace(sh.v);
      if (mode === 'close') c.closePath();
      for (const ct of sh.contours) if (ct.length) { trace(ct); c.closePath(); }
      fillIt(c); strokeIt(c);
    },
    // Transform (push and pop keep the style too, as p5's do)
    push: () => { C().save(); sf.stack.push(kp5CopyStyle(S())); },
    pop: () => { C().restore(); if (sf.stack.length) sf.style = sf.stack.pop(); kp5Apply(sf); },
    translate: (x, y) => { if (x instanceof kp5Vector) { y = x.y; x = x.x; } C().translate(+x || 0, +y || 0); },
    rotate: a => C().rotate(ang(+a || 0)),
    scale: (x, y) => { if (x instanceof kp5Vector) { y = x.y; x = x.x; } else if (Array.isArray(x)) { y = x[1]; x = x[0]; } C().scale(x, y === undefined ? x : y); },
    shearX: a => C().transform(1, 0, Math.tan(ang(a)), 1, 0, 0),
    shearY: a => C().transform(1, Math.tan(ang(a)), 0, 1, 0, 0),
    applyMatrix: (a, b, c, d, e, f) => { if (Array.isArray(a)) { f = a[5]; e = a[4]; d = a[3]; c = a[2]; b = a[1]; a = a[0]; } C().transform(a, b, c, d, e, f); },
    resetMatrix: () => { C().setTransform(sf.d, 0, 0, sf.d, 0, 0); },
    // Type
    textSize: n => { if (n === undefined) return S().textSize; S().textSize = +n || 12; S().textLeading = S().textSize * 1.25; },
    textLeading: n => { if (n === undefined) return S().textLeading; S().textLeading = +n; },
    textStyle: st => { if (st === undefined) return S().textStyle; S().textStyle = st; },
    textFont: (f, size) => { if (f === undefined) return S().textFont; S().textFont = f && typeof f === 'object' ? (f.family ? `"${f.family}"` : 'sans-serif') : String(f); if (size !== undefined) D.textSize(size); },
    textAlign: (h, v) => { if (h === undefined) return { horizontal: S().alignH, vertical: S().alignV }; S().alignH = h === 'center' ? 'center' : h === 'right' ? 'right' : 'left'; if (v !== undefined) S().alignV = v === 'center' ? 'middle' : v === 'baseline' ? 'alphabetic' : v; },
    textWidth: str => { const c = C(); c.save(); c.font = fontOf(); const w = Math.max(...String(str).split('\n').map(x => c.measureText(x).width)); c.restore(); return w; },
    textAscent: () => { const c = C(); c.save(); c.font = fontOf(); const m = c.measureText('Mg'); c.restore(); return m.actualBoundingBoxAscent || S().textSize * 0.8; },
    textDescent: () => { const c = C(); c.save(); c.font = fontOf(); const m = c.measureText('Mg'); c.restore(); return m.actualBoundingBoxDescent || S().textSize * 0.2; },
    text: (str, x, y, bw, bh) => {
      const c = C(), s = S();
      if (str === undefined || str === null) return;
      c.save(); c.font = fontOf(); c.textAlign = s.alignH; c.textBaseline = s.alignV;
      let lines = String(Array.isArray(str) ? str.join(',') : str).split('\n');
      if (bw !== undefined) {
        // Wrapped to the box's width, placed inside it.
        const out = [];
        for (const para of lines) { let line = ''; for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (line && c.measureText(t).width > bw) { out.push(line); line = w; } else line = t; } out.push(line); }
        lines = out;
        if (s.alignH === 'center') x += bw / 2; else if (s.alignH === 'right') x += bw;
        if (bh !== undefined && s.alignV === 'middle') y += bh / 2 - ((lines.length - 1) * s.textLeading) / 2;
        else if (bh !== undefined && s.alignV === 'bottom') y += bh - (lines.length - 1) * s.textLeading;
        else if (s.alignV === 'alphabetic' || s.alignV === 'top') c.textBaseline = 'top';
      } else if (lines.length > 1) {
        if (s.alignV === 'middle') y -= ((lines.length - 1) * s.textLeading) / 2; else if (s.alignV === 'bottom') y -= (lines.length - 1) * s.textLeading;
      }
      lines.forEach((ln, i) => {
        const yy = y + i * s.textLeading;
        if (s.doFill) { c.fillStyle = s.erasing ? 'rgba(0,0,0,1)' : kp5Css(s.fill); c.fillText(ln, x, yy); }
        // Type is stroked only once the sketch has set a stroke, as in p5.
        if (s.doStroke && s.strokeSet) { c.strokeStyle = kp5Css(s.stroke); c.lineWidth = s.weight; c.strokeText(ln, x, yy); }
      });
      c.restore();
    },
    // Images
    image: (im, x, y, w, h, sx, sy, sw, sh) => {
      const c = C(), el = kp5Source(im);
      if (!el || (im instanceof kp5Image && !im.ready)) return;
      const iw = im.width || el.width || el.naturalWidth || 0, ih = im.height || el.height || el.naturalHeight || 0;
      if (!iw || !ih) return;
      if (w === undefined) { w = iw; h = ih; } else if (h === undefined) h = (ih * w) / iw;
      const m = S().imageMode;
      if (m === 'center') { x -= w / 2; y -= h / 2; } else if (m === 'corners') { w -= x; h -= y; }
      const src = tintedOf(im instanceof kp5Image ? im : null, el, el.width || iw, el.height || ih);
      const t = S().tint, k = (el.width || iw) / iw;
      c.save();
      if (t) c.globalAlpha *= t[3] / 255;
      if (sx !== undefined) c.drawImage(src, sx * k, sy * k, (sw === undefined ? iw : sw) * k, (sh === undefined ? ih : sh) * k, x, y, w, h);
      else c.drawImage(src, x, y, w, h);
      c.restore();
    },
    tint: (...a) => { S().tint = lv(a); },
    noTint: () => { S().tint = null; },
    // Pixels: the canvas's own (density² per sketch pixel), read back and written whole: slow on big canvases.
    loadPixels: () => { const c = C(); sf.data = c.getImageData(0, 0, sf.canvas.width, sf.canvas.height); sf.pixels = sf.data.data; },
    updatePixels: () => { const c = C(); if (sf.data) c.putImageData(sf.data, 0, 0); },
    get: (x, y, w, h) => kp5GetPixels(host, sf.canvas, sf.d, x, y, w, h),
    set: (x, y, col) => {
      if (col && typeof col === 'object' && !(col instanceof kp5Color) && !Array.isArray(col)) { const el = kp5Source(col); if (el) C().drawImage(el, x, y); return; }
      if (!sf.data) D.loadPixels();
      kp5SetPixel(sf.data, sf.canvas.width, sf.d, x, y, col);
    },
    filter: (kind, v) => kp5Filter(C(), sf.canvas, kind, v),
  };
  return D;
}
const KP5_DRAW_NAMES = Object.keys(kp5Drawing(null, { style: kp5Style(), stack: [], ctx: null, canvas: null, d: 1 }));

/** Colour readers and lerpColor, in a surface's colour mode. */
function kp5ColourReaders(sfOf) {
  const lvOf = c => (c instanceof kp5Color ? c.levels : kp5Levels([c], sfOf().style.cmode, sfOf().style.maxes));
  const hsx = (c, hsb) => { const l = lvOf(c); return kp5ToHsx(l[0] / 255, l[1] / 255, l[2] / 255, hsb); };
  const mx = () => sfOf().style.maxes, mode = () => sfOf().style.cmode;
  return {
    red: c => lvOf(c)[0], green: c => lvOf(c)[1], blue: c => lvOf(c)[2],
    alpha: c => (lvOf(c)[3] / 255) * mx()[3],
    hue: c => (hsx(c, mode() !== 'hsl')[0] / 360) * (mode() === 'rgb' ? 360 : mx()[0]),
    saturation: c => hsx(c, mode() !== 'hsl')[1] * (mode() === 'rgb' ? 100 : mx()[1]),
    brightness: c => hsx(c, true)[2] * (mode() === 'rgb' ? 100 : mx()[2]),
    lightness: c => hsx(c, false)[2] * (mode() === 'rgb' ? 100 : mx()[2]),
    lerpColor: (a, b, t) => {
      t = Math.max(0, Math.min(1, +t || 0));
      const A = lvOf(a), B = lvOf(b);
      if (mode() === 'rgb') return new kp5Color([0, 1, 2, 3].map(i => A[i] + (B[i] - A[i]) * t));
      // HSB / HSL: through hue, the short way round.
      const hsb = mode() === 'hsb', ha = kp5ToHsx(A[0] / 255, A[1] / 255, A[2] / 255, hsb), hb = kp5ToHsx(B[0] / 255, B[1] / 255, B[2] / 255, hsb);
      let dh = hb[0] - ha[0];
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      const rgb = kp5Hsx(ha[0] + dh * t, ha[1] + (hb[1] - ha[1]) * t, ha[2] + (hb[2] - ha[2]) * t, hsb);
      return new kp5Color([rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, A[3] + (B[3] - A[3]) * t]);
    },
  };
}

// ── The console ──────────────────────────────────────────────────────────────

/**
 * The sketch's `console` (and p5's print): to the host's console (the
 * editor's pane) when there is one, else the page's own. `watch(name, v)`
 * reports a value to watch instead of a line per frame.
 */
export function kp5Console(sink) {
  const real = typeof console !== 'undefined' ? console : null;
  const out = level => (...args) => { if (sink) sink(level, args); else if (real) (real[level] || real.log).apply(real, args); };
  const C = { log: out('log'), info: out('info'), debug: out('log'), warn: out('warn'), error: out('error'), table: out('table'), dir: out('log'), trace: out('log') };
  C.clear = () => { if (sink) sink('clear', []); else if (real && real.clear) real.clear(); };
  for (const m of ['group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'timeLog', 'count', 'countReset']) C[m] = () => {};
  C.assert = (ok, ...args) => { if (!ok) C.error('Assertion failed:', ...args); };
  C.watch = (name, value) => { if (sink) sink('watch', [String(name), value]); };
  return C;
}

// ── The helpers ──────────────────────────────────────────────────────────────

/**
 * p5's global names for one sketch, over `base` (klSketchHelpers: the app's
 * own p5-style names, reused where they mean the same). `get()` is the
 * current frame (kp5Step sets it); `host` the sketch's p5 state (kp5Host).
 */
export function kp5Helpers(base, get, host) {
  const P = Object.create(null);
  Object.defineProperties(P, Object.getOwnPropertyDescriptors(base));
  const rnd = () => { if (host.rng) return host.rng(); const s = get(); return s && typeof s.random === 'function' ? s.random() : Math.random(); };
  const noise = kp5Noise(rnd);
  host.noise = noise;
  const ang = a => (host.sf.style.angle === 'degrees' ? (a * Math.PI) / 180 : a);
  const unang = a => (host.sf.style.angle === 'degrees' ? (a * 180) / Math.PI : a);
  // Drawing goes to whichever canvas the sketch has now (createCanvas makes a new one).
  let drawing = null, drawingFor = null;
  const Dr = () => { if (drawingFor !== host.sf) { drawing = kp5Drawing(host, host.sf); drawingFor = host.sf; } return drawing; };
  for (const k of KP5_DRAW_NAMES) P[k] = (...a) => Dr()[k](...a);
  Object.defineProperty(P, 'pixels', { get: () => host.sf.pixels, set: v => { host.sf.pixels = v; }, enumerable: true, configurable: true });
  Object.assign(P, kp5ColourReaders(() => host.sf));
  Object.assign(P, {
    PI: Math.PI, TWO_PI: Math.PI * 2, HALF_PI: Math.PI / 2, QUARTER_PI: Math.PI / 4, TAU: Math.PI * 2, DEGREES: 'degrees', RADIANS: 'radians',
    RGB: 'rgb', HSB: 'hsb', HSL: 'hsl', CLOSE: 'close', OPEN: 'open', CHORD: 'chord', PIE: 'pie', CORNER: 'corner', CORNERS: 'corners', CENTER: 'center', RADIUS: 'radius',
    LEFT: 'left', RIGHT: 'right', TOP: 'top', BOTTOM: 'bottom', BASELINE: 'baseline', ROUND: 'round', SQUARE: 'square', PROJECT: 'project', MITER: 'miter', BEVEL: 'bevel',
    POINTS: 'points', LINES: 'lines', TRIANGLES: 'triangles', TRIANGLE_FAN: 'triangle_fan', TRIANGLE_STRIP: 'triangle_strip', QUADS: 'quads', QUAD_STRIP: 'quad_strip', TESS: 'tess',
    NORMAL: 'normal', ITALIC: 'italic', BOLD: 'bold', BOLDITALIC: 'bolditalic', WORD: 'word', CHAR: 'char',
    BLEND: 'blend', ADD: 'add', MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEST: 'darkest', LIGHTEST: 'lightest', DIFFERENCE: 'difference', EXCLUSION: 'exclusion',
    HARD_LIGHT: 'hard_light', SOFT_LIGHT: 'soft_light', DODGE: 'dodge', BURN: 'burn', REPLACE: 'replace', REMOVE: 'remove',
    GRAY: 'gray', INVERT: 'invert', THRESHOLD: 'threshold', BLUR: 'blur', OPAQUE: 'opaque', POSTERIZE: 'posterize', ERODE: 'erode', DILATE: 'dilate',
    P2D: 'p2d', WEBGL: 'webgl', ARROW: 'default', CROSS: 'crosshair', HAND: 'pointer', MOVE: 'move', TEXT: 'text', WAIT: 'wait',
    BACKSPACE: 8, DELETE: 46, ENTER: 13, RETURN: 13, TAB: 9, ESCAPE: 27, SHIFT: 16, CONTROL: 17, OPTION: 18, ALT: 18, UP_ARROW: 38, DOWN_ARROW: 40, LEFT_ARROW: 37, RIGHT_ARROW: 39,
  });
  const getters = {
    width: () => (host.g3 ? host.lw : host.sf.w), height: () => (host.g3 ? host.lh : host.sf.h),
    windowWidth: () => host.winW, windowHeight: () => host.winH, displayWidth: () => host.winW, displayHeight: () => host.winH,
    frameCount: () => host.frameCount, deltaTime: () => host.deltaTime, focused: () => true,
    mouseX: () => host.mouseX, mouseY: () => host.mouseY, pmouseX: () => host.pmouseX, pmouseY: () => host.pmouseY,
    winMouseX: () => host.mouseX, winMouseY: () => host.mouseY, movedX: () => host.mouseX - host.pmouseX, movedY: () => host.mouseY - host.pmouseY,
    mouseIsPressed: () => host.down, mouseButton: () => 'left',
    key: () => host.key, keyCode: () => host.keyCode, keyIsPressed: () => KP5_EVENTS.held.size > 0,
    touches: () => (host.down ? [{ x: host.mouseX, y: host.mouseY, id: 0 }] : []),
  };
  for (const k in getters) Object.defineProperty(P, k, { get: getters[k], enumerable: true, configurable: true });
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  Object.assign(P, {
    // Structure
    createCanvas: (w, h, renderer) => {
      if (renderer === 'webgl' && !host.g3) throw new Error('This sketch draws in WEBGL: set the layer’s Mode to 3D (Canvas settings).');
      host.explicit = true;
      if (host.g3) { host.lw = Math.max(1, num(w, host.winW)); host.lh = Math.max(1, num(h, host.winH)); return host.canvasHandle; }
      const W = Math.max(1, num(w, 100)), H = Math.max(1, num(h, 100));
      const d = host.density || kp5DefaultDensity(host, W, H);
      if (host.sf.w !== Math.round(W) || host.sf.h !== Math.round(H) || host.sf.d !== d) kp5Resize(host, host.sf, W, H, d);
      host.sf.style = kp5Style(); kp5Apply(host.sf);
      return host.canvasHandle;
    },
    resizeCanvas: (w, h) => {
      if (host.g3) { host.lw = num(w, host.lw); host.lh = num(h, host.lh); return; }
      // What was drawn stays, top left, as in p5.
      const keep = host.sf.canvas, cw = keep ? keep.width : 0, ch = keep ? keep.height : 0;
      const tmp = keep && cw && ch ? kp5MakeCanvas(host, cw, ch) : null;
      if (tmp) tmp.getContext('2d').drawImage(keep, 0, 0);
      const style = host.sf.style;
      kp5Resize(host, host.sf, num(w, host.sf.w), num(h, host.sf.h), host.sf.d);
      host.sf.style = style; kp5Apply(host.sf);
      if (tmp && host.sf.ctx) { host.sf.ctx.save(); host.sf.ctx.setTransform(1, 0, 0, 1, 0, 0); host.sf.ctx.drawImage(tmp, 0, 0); host.sf.ctx.restore(); }
    },
    pixelDensity: d => {
      if (d === undefined) return host.sf.d;
      host.density = Math.max(0.25, +d || 1);
      if (!host.g3 && host.sf.d !== host.density) { const style = host.sf.style; kp5Resize(host, host.sf, host.sf.w, host.sf.h, host.density); host.sf.style = style; kp5Apply(host.sf); }
    },
    displayDensity: () => { const s = get(); return (s && s.dpr) || 1; },
    frameRate: n => { if (n === undefined) return host.fps; host.targetFps = Math.max(0, +n || 0); },
    getTargetFrameRate: () => host.targetFps || 60,
    getFrameRate: () => host.fps,
    noLoop: () => { host.looping = false; },
    loop: () => { host.looping = true; },
    isLooping: () => host.looping,
    redraw: n => { host.redraws += Math.max(1, n | 0); },
    millis: () => { const s = get(); return Math.max(0, (num(s && s.time, 0) - host.t0) * 1000); },
    // Maths p5 does its own way
    random: (a, b) => {
      if (Array.isArray(a)) return a[Math.floor(rnd() * a.length)];
      if (a === undefined) return rnd();
      if (b === undefined) return rnd() * a;
      return Math.min(a, b) + rnd() * Math.abs(b - a);
    },
    randomSeed: seed => { host.rng = kp5Lcg(seed); host.gaussNext = null; },
    randomGaussian: (mean, sd) => {
      let y1;
      if (host.gaussNext !== null) { y1 = host.gaussNext; host.gaussNext = null; }
      else { let x1, x2, w; do { x1 = rnd() * 2 - 1; x2 = rnd() * 2 - 1; w = x1 * x1 + x2 * x2; } while (w >= 1 || w === 0); w = Math.sqrt((-2 * Math.log(w)) / w); y1 = x1 * w; host.gaussNext = x2 * w; }
      return y1 * (sd === undefined ? 1 : sd) + (mean || 0);
    },
    noise: (x, y, z) => noise.at(x, y, z),
    noiseSeed: s => noise.seed(s),
    noiseDetail: (lod, falloff) => { if (lod > 0) noise.octaves = lod | 0; if (falloff > 0) noise.falloff = falloff; },
    dist: (...a) => (a.length >= 6 ? Math.hypot(a[3] - a[0], a[4] - a[1], a[5] - a[2]) : Math.hypot(a[2] - a[0], a[3] - a[1])),
    mag: (...a) => Math.hypot(...a),
    sq: n => n * n,
    fract: n => n - Math.floor(n),
    exp: Math.exp, log: Math.log,
    asin: v => unang(Math.asin(v)), acos: v => unang(Math.acos(v)), atan: v => unang(Math.atan(v)), atan2: (y, x) => unang(Math.atan2(y, x)),
    sin: a => Math.sin(ang(a)), cos: a => Math.cos(ang(a)), tan: a => Math.tan(ang(a)),
    createVector: (x, y, z) => new kp5Vector(x, y, z),
    int: (v, radix) => { if (Array.isArray(v)) return v.map(x => P.int(x, radix)); if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'string') return parseInt(v, radix || 10); return v < 0 ? Math.ceil(v) : Math.floor(v); },
    float: v => (Array.isArray(v) ? v.map(x => parseFloat(x)) : parseFloat(v)),
    str: v => (Array.isArray(v) ? v.map(String) : String(v)),
    boolean: v => (Array.isArray(v) ? v.map(x => P.boolean(x)) : typeof v === 'string' ? v.toLowerCase() === 'true' : !!v),
    hex: (n, d) => { const s = (Math.round(n) >>> 0).toString(16).toUpperCase(); const w = d === undefined ? 8 : d; return s.length >= w ? s.slice(s.length - w) : '0'.repeat(w - s.length) + s; },
    unhex: s => parseInt(s, 16),
    nf: (n, left, right) => {
      if (Array.isArray(n)) return n.map(x => P.nf(x, left, right));
      const neg = n < 0, s = right !== undefined ? Math.abs(n).toFixed(right) : String(Math.abs(n));
      const [i, f] = s.split('.'), L = left === undefined ? i.length : Math.max(left, 0);
      return (neg ? '-' : '') + (i.length < L ? '0'.repeat(L - i.length) + i : i) + (f !== undefined ? '.' + f : '');
    },
    nfc: (n, right) => { const s = right !== undefined ? (+n).toFixed(right) : String(n); const [i, f] = s.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f !== undefined ? '.' + f : ''); },
    nfs: (n, l, r) => (n < 0 ? P.nf(n, l, r) : ' ' + P.nf(n, l, r)),
    nfp: (n, l, r) => (n < 0 ? P.nf(n, l, r) : '+' + P.nf(n, l, r)),
    split: (s, d) => String(s).split(d),
    splitTokens: (s, d) => String(s).split(new RegExp('[' + (d || ' \\t\\n\\r\\f').replace(/[\]\\^-]/g, '\\$&') + ']+')).filter(x => x),
    join: (a, d) => a.join(d),
    trim: s => (Array.isArray(s) ? s.map(x => String(x).trim()) : String(s).trim()),
    append: (a, v) => { a.push(v); return a; },
    shuffle: (a, inPlace) => { const o = inPlace ? a : a.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; } return o; },
    sort: (a, n) => { const o = a.slice(0, n === undefined ? a.length : n).sort(typeof a[0] === 'number' ? (x, y) => x - y : undefined); return n === undefined ? o : o.concat(a.slice(n)); },
    reverse: a => a.reverse(),
    concat: (a, b) => a.concat(b),
    subset: (a, start, n) => a.slice(start, n === undefined ? undefined : start + n),
    arrayCopy: (src, a, b, c, d) => { if (b === undefined) { for (let i = 0; i < src.length; i++) a[i] = src[i]; return; } if (c === undefined) { for (let i = 0; i < b; i++) a[i] = src[i]; return; } for (let i = 0; i < d; i++) c[b + i] = src[a + i]; },
    splice: (a, v, i) => { a.splice(i, 0, ...(Array.isArray(v) ? v : [v])); return a; },
    day: () => new Date().getDate(), month: () => new Date().getMonth() + 1, year: () => new Date().getFullYear(),
    hour: () => new Date().getHours(), minute: () => new Date().getMinutes(), second: () => new Date().getSeconds(),
    keyIsDown: code => KP5_EVENTS.held.has(code),
    bezierPoint: (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; },
    bezierTangent: (a, b, c, d, t) => { const u = 1 - t; return 3 * d * t * t - 3 * c * t * t + 6 * c * u * t - 6 * b * u * t + 3 * b * u * u - 3 * a * u * u; },
    curvePoint: (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); },
    // Files the project brought
    loadImage: (path, ok, fail) => kp5LoadImage(host, path, ok, fail),
    createImage: (w, h) => new kp5Image(host, w, h),
    createGraphics: (w, h) => kp5Graphics(host, P, w, h),
    loadJSON: (path, ok, fail) => kp5LoadText(host, path, 'json', ok, fail),
    loadStrings: (path, ok, fail) => kp5LoadText(host, path, 'strings', ok, fail),
    loadTable: (path, ...rest) => kp5LoadText(host, path, 'table', rest.find(x => typeof x === 'function'), undefined, rest.includes('header'), rest.includes('tsv') ? '\t' : ','),
    loadFont: (path, ok) => kp5LoadFont(host, path, ok),
    // DOM controls read the layer's declared controls (the importer names them); other elements do nothing.
    control: key => kp5Control(host, String(key)),
    createSlider: (min, max, value) => kp5Control(host, kp5AutoKey(host, 'slider'), { kind: 'slider', value: value === undefined ? (num(min, 0) + num(max, 1)) / 2 : value }),
    createCheckbox: (label, checked) => kp5Control(host, kp5AutoKey(host, 'checkbox'), { kind: 'toggle', value: !!checked }),
    createSelect: () => kp5Control(host, kp5AutoKey(host, 'select'), { kind: 'choice', value: '' }),
    createRadio: () => kp5Control(host, kp5AutoKey(host, 'radio'), { kind: 'choice', value: '' }),
    createColorPicker: value => kp5Control(host, kp5AutoKey(host, 'colour'), { kind: 'colour', value: value === undefined ? '#000000' : String(value) }),
    createButton: () => kp5Control(host, kp5AutoKey(host, 'button'), { kind: 'button', value: 0 }),
    // Sound reads the live audio input; nothing plays.
    getAudioContext: () => ({ state: 'running', resume: () => Promise.resolve(), sampleRate: 48000 }),
    userStartAudio: () => Promise.resolve(),
  });
  for (const n of KP5_STUBBED) if (!(n in P) || n === 'cursor' || n === 'noCursor') P[n] = () => kp5Handle();
  for (const n of KP5_UNSUPPORTED) P[n] = () => { throw new Error(`${n}() is not supported on a Script layer.`); };
  P.p5 = kp5Namespace(host, P);
  return P;
}

/** The density a canvas starts with: the picture's pixels per sketch pixel (1 when the sketch reads pixels). */
function kp5DefaultDensity(host, w, h) {
  if (host.usesPixels) return 1;
  const k = Math.min(host.layerW / w, host.layerH / h);
  return Math.max(1, Math.min(3, Math.round(k * 4) / 4 || 1));
}

/** `p5` inside the sketch: `new p5(fn)` (instance mode), p5.Vector, p5.Color, and the sound readers. */
function kp5Namespace(host, P) {
  function p5(fn) {
    const inst = Object.create(P);
    host.inst = inst;
    if (typeof fn === 'function') fn(inst);
    return inst;
  }
  p5.Vector = kp5Vector;
  p5.Color = kp5Color;
  p5.Image = kp5Image;
  p5.Element = function () { return kp5Handle(); };
  p5.disableFriendlyErrors = true;
  p5.prototype = P;
  p5.Amplitude = function () {
    let smooth = 0, lvl = 0;
    return {
      setInput() {}, toggleNormalize() {}, connect() {}, disconnect() {},
      smooth(v) { smooth = Math.max(0, Math.min(0.99, +v || 0)); },
      getLevel() { const a = kp5Audio(host); let s = 0; if (a && a.wave) { const w = a.wave; for (let i = 0; i < w.length; i++) s += w[i] * w[i]; s = Math.sqrt(s / Math.max(1, w.length)); } lvl = lvl * smooth + s * (1 - smooth); return lvl; },
    };
  };
  p5.FFT = function (smoothing, bins) {
    const n = Math.max(16, Math.min(1024, bins | 0 || 1024));
    let spec = new Array(n).fill(0);
    // The live input's spectrum is in dB; p5's is 0–255.
    const unit = db => Math.max(0, Math.min(255, Math.round(((db + 100) / 70) * 255)));
    const range = { bass: [20, 140], lowMid: [140, 400], mid: [400, 2600], highMid: [2600, 5200], treble: [5200, 14000] };
    const nyquist = () => { const a = kp5Audio(host); return ((a && a.sampleRate) || 48000) / 2; };
    return {
      setInput() {}, smooth() {}, connect() {}, disconnect() {},
      analyze() {
        const a = kp5Audio(host);
        if (!a || !a.freq) { spec = new Array(n).fill(0); return spec; }
        const src = a.freq, k = src.length / n;
        spec = new Array(n);
        for (let i = 0; i < n; i++) { let m = -200; const j0 = Math.floor(i * k), j1 = Math.max(j0 + 1, Math.floor((i + 1) * k)); for (let j = j0; j < j1; j++) m = Math.max(m, src[Math.min(src.length - 1, j)]); spec[i] = unit(m); }
        return spec;
      },
      waveform() { const a = kp5Audio(host); if (!a || !a.wave) return new Array(n).fill(0); const w = a.wave, out = new Array(n); for (let i = 0; i < n; i++) out[i] = w[Math.floor((i * w.length) / n)]; return out; },
      getEnergy(lo, hi) {
        if (typeof lo === 'string') { const r = range[lo] || range.bass; lo = r[0]; hi = r[1]; }
        if (hi === undefined) hi = lo;
        const top = nyquist(), a = Math.max(0, Math.floor((lo / top) * spec.length)), b = Math.min(spec.length - 1, Math.max(a, Math.floor((hi / top) * spec.length)));
        let s = 0;
        for (let i = a; i <= b; i++) s += spec[i] || 0;
        return s / (b - a + 1);
      },
      getCentroid() { let s = 0, w = 0; for (let i = 0; i < spec.length; i++) { s += i * spec[i]; w += spec[i]; } return w ? (s / w) * (nyquist() / spec.length) : 0; },
      linAverages(k) { const m = Math.max(1, k | 0 || 16), out = [], per = spec.length / m; for (let i = 0; i < m; i++) { let s = 0; for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) s += spec[j]; out.push(s / Math.max(1, Math.floor(per))); } return out; },
    };
  };
  p5.AudioIn = function () {
    const amp = p5.Amplitude();
    return { enabled: true, start(ok) { if (typeof ok === 'function') ok(); }, stop() {}, connect() {}, disconnect() {}, amp() {}, getLevel: () => amp.getLevel() };
  };
  p5.SoundFile = function () { throw new Error('Sound files do not play on a Script layer.'); };
  return p5;
}
function kp5Audio(host) { const s = host.frame; return s && s.audio ? s.audio : null; }

/** A createGraphics buffer: its own canvas and drawing names; p5's other names through to the sketch's. */
function kp5Graphics(host, P, w, h) {
  const sf = kp5Surface(host, Math.max(1, +w || 1), Math.max(1, +h || 1), 1);
  const G = Object.create(P);
  const D = kp5Drawing(host, sf);
  for (const k of KP5_DRAW_NAMES) G[k] = D[k];
  Object.assign(G, kp5ColourReaders(() => sf));
  const prop = (k, get, set) => Object.defineProperty(G, k, { get, set, enumerable: true, configurable: true });
  prop('pixels', () => sf.pixels, v => { sf.pixels = v; });
  prop('width', () => sf.w); prop('height', () => sf.h); prop('canvas', () => sf.canvas); prop('elt', () => sf.canvas);
  G._surface = sf;
  G.pixelDensity = d => { if (d === undefined) return sf.d; kp5Resize(host, sf, sf.w, sf.h, Math.max(0.25, +d || 1)); };
  G.resizeCanvas = (nw, nh) => kp5Resize(host, sf, nw, nh, sf.d);
  G.remove = () => {};
  G.reset = () => kp5Reset(sf);
  return G;
}

// ── Loading what the project brought ─────────────────────────────────────────

/** A project file by the path the sketch uses ('assets/cat.png', './data.json'). */
function kp5Asset(host, path) {
  if (typeof path !== 'string') return null;
  const want = path.replace(/^\.?\//, '').replace(/\\/g, '/');
  const list = host.assets || [];
  const base = want.split('/').pop();
  return list.find(a => a.name === want) || list.find(a => a.name.toLowerCase() === want.toLowerCase()) || list.find(a => a.name.split('/').pop() === base) || null;
}
function kp5LoadImage(host, path, ok, fail) {
  const im = new kp5Image(host, 0, 0);
  im.ready = false;
  const a = kp5Asset(host, path);
  const url = a ? a.data : typeof path === 'string' && /^(data:|blob:|https?:)/.test(path) ? path : null;
  if (!url || typeof Image === 'undefined') {
    if (!url) host.console.warn(`loadImage: “${path}” is not in this sketch’s files.`);
    if (typeof fail === 'function') fail(new Error('not found'));
    return im;
  }
  host.pending++;
  const el = new Image();
  el.crossOrigin = 'anonymous';
  el.onload = () => {
    host.pending--;
    im.width = el.naturalWidth; im.height = el.naturalHeight;
    im.canvas = kp5MakeCanvas(host, im.width, im.height);
    if (im.canvas) im.canvas.getContext('2d').drawImage(el, 0, 0);
    im.ready = true; im.version++;
    if (typeof ok === 'function') host.later.push(() => ok(im));
  };
  el.onerror = () => { host.pending--; host.console.warn(`loadImage: “${path}” did not load.`); if (typeof fail === 'function') host.later.push(() => fail(new Error('load failed'))); };
  el.src = url;
  return im;
}
/** CSV / TSV text as a p5.Table (quoted cells may hold the separator). */
export function kp5ParseTable(text, header, sep) {
  const rows = String(text).split(/\r?\n/).filter(l => l.length).map(l => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
  const columns = header && rows.length ? rows.shift() : (rows[0] || []).map((_, i) => String(i));
  const col = c => (typeof c === 'number' ? c : columns.indexOf(c));
  const rowObj = r => ({ arr: r, obj: Object.fromEntries(columns.map((c, i) => [c, r[i]])), get: c => r[col(c)], getString: c => String(r[col(c)] ?? ''), getNum: c => parseFloat(r[col(c)]), set: (c, v) => { r[col(c)] = v; } });
  return {
    columns, rows: rows.map(rowObj),
    getRowCount: () => rows.length, getColumnCount: () => columns.length,
    getString: (r, c) => String(rows[r] ? rows[r][col(c)] ?? '' : ''), getNum: (r, c) => parseFloat(rows[r] ? rows[r][col(c)] : NaN),
    get: (r, c) => (rows[r] ? rows[r][col(c)] : undefined),
    getColumn: c => rows.map(r => r[col(c)]), getRow: r => rowObj(rows[r] || []), getRows: () => rows.map(rowObj),
    getArray: () => rows.map(r => r.slice()),
    getObject: key => { const o = {}; rows.forEach((r, i) => { o[key !== undefined ? r[col(key)] : i] = Object.fromEntries(columns.map((c, j) => [c, r[j]])); }); return o; },
    findRow: (v, c) => { const r = rows.find(x => x[col(c)] === v); return r ? rowObj(r) : null; },
    findRows: (v, c) => rows.filter(x => x[col(c)] === v).map(rowObj),
  };
}
function kp5LoadText(host, path, as, ok, fail, header, sep) {
  const name = as === 'json' ? 'loadJSON' : as === 'strings' ? 'loadStrings' : 'loadTable';
  const make = text => (as === 'json' ? JSON.parse(text) : as === 'strings' ? String(text).split(/\r?\n/) : kp5ParseTable(text, header, sep || ','));
  const a = kp5Asset(host, path);
  if (a && a.kind !== 'image' && a.kind !== 'font') {
    // Bundled: there at once.
    let v;
    try { v = make(a.data); } catch (e) { host.console.error(`${name}: ${path}: ${(e && e.message) || e}`); if (typeof fail === 'function') fail(e); return as === 'strings' ? [] : {}; }
    if (typeof ok === 'function') host.later.push(() => ok(v));
    return v;
  }
  const target = as === 'strings' ? [] : as === 'table' ? kp5ParseTable('', header, ',') : {};
  if (typeof path === 'string' && /^https?:/.test(path) && typeof fetch !== 'undefined') {
    // A URL is fetched; preload waits for it.
    host.pending++;
    fetch(path).then(r => r.text()).then(t => {
      host.pending--;
      const v = make(t);
      if (Array.isArray(target) && Array.isArray(v)) target.push(...v); else Object.assign(target, v);
      if (typeof ok === 'function') host.later.push(() => ok(v));
    }).catch(e => { host.pending--; host.console.warn(`${name}: ${path}: ${(e && e.message) || e}`); if (typeof fail === 'function') host.later.push(() => fail(e)); });
    return target;
  }
  host.console.warn(`${name}: “${path}” is not in this sketch’s files.`);
  if (typeof fail === 'function') fail(new Error('not found'));
  return target;
}
function kp5LoadFont(host, path, ok) {
  const a = kp5Asset(host, path);
  const family = 'p5font-' + String(path).replace(/[^\w]+/g, '-');
  const f = { family, font: null, textBounds: (s, x, y, size) => ({ x, y: y - (size || 12), w: String(s).length * (size || 12) * 0.55, h: size || 12 }) };
  if (!a || typeof FontFace === 'undefined' || typeof document === 'undefined') { if (!a) host.console.warn(`loadFont: “${path}” is not in this sketch’s files.`); return f; }
  host.pending++;
  new FontFace(family, `url(${a.data})`).load().then(ff => { host.pending--; document.fonts.add(ff); f.font = ff; if (typeof ok === 'function') host.later.push(() => ok(f)); })
    .catch(() => { host.pending--; host.console.warn(`loadFont: “${path}” did not load.`); });
  return f;
}

// ── Controls ────────────────────────────────────────────────────────────────

function kp5AutoKey(host, what) { host.autoKeys[what] = (host.autoKeys[what] || 0) + 1; return what + host.autoKeys[what]; }

/**
 * A DOM control as the layer's declared control `key`: .value() reads it (a
 * slider's number, a select's option, a picker's hex), .checked() a toggle,
 * .color() a picker's colour. With no declared control of that key it keeps
 * its own value (what the sketch made it with, or set).
 */
function kp5Control(host, key, own) {
  let c = host.controls.get(key);
  if (c) return c.handle;
  c = { key, own: own ? own.value : undefined, kind: own ? own.kind : null, last: undefined, handle: null };
  const read = () => {
    const f = host.frame, p = f && f.params;
    if (p && Object.prototype.hasOwnProperty.call(p, key)) return p[key];
    return c.own;
  };
  const h = kp5Handle({
    value: v => { if (v !== undefined) { c.own = v; return h; } const r = read(); return typeof r === 'boolean' ? (r ? 1 : 0) : r; },
    checked: v => { if (v !== undefined) { c.own = !!v; return h; } const r = read(); return typeof r === 'number' ? r >= 0.5 : !!r; },
    color: () => new kp5Color(kp5Levels([read() || '#000'], 'rgb')),
    selected: v => { if (v !== undefined) { c.own = v; return h; } return read(); },
    option: (label, value) => { if (c.own === '' || c.own === undefined) c.own = value === undefined ? label : value; return h; },
  });
  c.handle = h;
  host.controls.set(key, c);
  return h;
}

// ── One sketch ───────────────────────────────────────────────────────────────

/** A p5 sketch's state, kept on the compiled sketch (st.p5). */
export function kp5Host(opts) {
  const o = opts || {};
  const host = {
    sf: null, g3: !!o.g3, lw: 100, lh: 100, explicit: false, density: 0, usesPixels: !!o.usesPixels,
    winW: 100, winH: 100, layerW: 100, layerH: 100,
    frameCount: 0, deltaTime: 0, fps: 60, targetFps: 0, acc: 0, looping: true, redraws: 0, t0: 0, drawnOnce: false,
    mouseX: 0, mouseY: 0, pmouseX: 0, pmouseY: 0, down: false, lastClick: -1, key: '', keyCode: 0, keySeq: KP5_EVENTS.seq,
    rng: null, gaussNext: null, noise: null, controls: new Map(), autoKeys: {}, assets: o.assets || [], pending: 0, later: [],
    preloaded: false, inst: null, frame: null, makeCanvas: o.makeCanvas || null, console: o.console || kp5Console(o.log || null), view: null,
  };
  host.canvasHandle = kp5Handle();
  host.sf = kp5Surface(host, 100, 100, 1);
  kp5Listen();
  return host;
}

/** The sketch's function called `name`: instance mode's (p.setup = …) or the global one. */
function kp5Fn(st, name) {
  const h = st.p5;
  if (h.inst && Object.prototype.hasOwnProperty.call(h.inst, name) && typeof h.inst[name] === 'function') return h.inst[name];
  return st.fn ? st.fn(name) : null;
}
/** Does the sketch have a draw (global or instance mode)? */
export function kp5HasDraw(st) { return !!kp5Fn(st, 'draw'); }

/**
 * One frame of a p5 sketch into the layer's canvas (s.ctx, W × H device
 * pixels): wait for preload's files, run setup once, deliver mouse and key
 * events, run draw at the sketch's frame rate (unless noLoop), and fit the
 * sketch's canvas into the layer, centred (st.p5.view). A 3D sketch's scene
 * is rendered by the host into that view afterwards (kit.js).
 */
export function kp5Step(st, s, drive) {
  const h = st.p5, W = s.width, H = s.height, dpr = s.dpr || 1, g3 = st.g3;
  h.frame = s;
  kp5Vector.rnd = () => (h.rng ? h.rng() : typeof s.random === 'function' ? s.random() : Math.random());
  h.layerW = W; h.layerH = H;
  const winW = Math.max(1, Math.round(W / dpr)), winH = Math.max(1, Math.round(H / dpr));
  const resized = h.winW !== winW || h.winH !== winH;
  h.winW = winW; h.winH = winH;
  if (!st.ready) {
    // Before setup the canvas is the picture's size (p5's would be 100 × 100; the picture is more use).
    h.explicit = false; h.lw = winW; h.lh = winH; h.frameCount = 0; h.looping = true; h.redraws = 0; h.t0 = +s.time || 0; h.drawnOnce = false;
    if (!g3) { kp5Resize(h, h.sf, winW, winH, h.density || kp5DefaultDensity(h, winW, winH)); h.sf.style = kp5Style(); kp5Apply(h.sf); }
    if (drive) drive();
    if (!h.preloaded) {
      h.preloaded = true;
      const pre = kp5Fn(st, 'preload');
      if (pre) pre();
    }
    if (h.pending > 0) { st.waiting = true; return; }
    st.waiting = false;
    kp5Later(h);
    if (g3) { k3Setup(g3, h.lw, h.lh); k3Begin(g3, h.lw, h.lh); }
    const setup = kp5Fn(st, 'setup');
    if (setup) setup();
    // setup may have sized the canvas: the 3D camera follows it.
    if (g3) k3Setup(g3, h.lw, h.lh);
    st.ready = true; st.w = W; st.h = H;
  } else {
    if (resized) {
      if (!h.explicit) { if (g3) { h.lw = winW; h.lh = winH; } else { const style = h.sf.style; kp5Resize(h, h.sf, winW, winH, h.sf.d); h.sf.style = style; kp5Apply(h.sf); } }
      const wr = kp5Fn(st, 'windowResized');
      if (wr) wr();
    }
    if (drive) drive();
  }
  kp5Later(h);
  // Where the sketch's canvas sits in the layer: fitted, centred.
  const lw = g3 ? h.lw : h.sf.w, lh = g3 ? h.lh : h.sf.h;
  const k = Math.min(W / lw, H / lh), vw = lw * k, vh = lh * k, ox = (W - vw) / 2, oy = (H - vh) / 2;
  h.view = { x: ox, y: oy, w: vw, h: vh, k };
  // The mouse in the sketch's pixels, and its events.
  const m = s.mouse || { x: 0, y: 0, over: false, down: false };
  const mx = (m.x - ox) / k, my = (m.y - oy) / k;
  const first = !h.drawnOnce && h.frameCount === 0;
  h.pmouseX = first ? mx : h.mouseX; h.pmouseY = first ? my : h.mouseY;
  h.mouseX = mx; h.mouseY = my;
  const down = !!m.down && m.over !== false;
  const call = (n, ev) => { const f = kp5Fn(st, n); if (f) { f(ev); return true; } return false; };
  const ev = { x: mx, y: my, button: 0 };
  if (down && !h.down) {
    h.down = true;
    if (!call('mousePressed', ev)) call('touchStarted', ev);
    if (h.canvasHandle._cb.mousePressed) h.canvasHandle._cb.mousePressed(ev);
  } else if (!down && h.down) {
    h.down = false;
    if (!call('mouseReleased', ev)) call('touchEnded', ev);
    call('mouseClicked', ev);
    const t = +s.time || 0;
    if (h.lastClick >= 0 && t - h.lastClick < 0.35) { call('doubleClicked', ev); h.lastClick = -1; } else h.lastClick = t;
  } else if (!first && (mx !== h.pmouseX || my !== h.pmouseY)) {
    if (down) { if (!call('mouseDragged', ev)) call('touchMoved', ev); } else if (m.over !== false) call('mouseMoved', ev);
  }
  // Keys and the wheel since the last frame.
  for (const e of KP5_EVENTS.list) {
    if (e.seq <= h.keySeq) continue;
    h.keySeq = e.seq;
    if (e.type === 'wheel') { if (m.over !== false) call('mouseWheel', { delta: e.delta, deltaY: e.delta }); continue; }
    h.key = e.key; h.keyCode = e.keyCode;
    if (e.type === 'down') { call('keyPressed', { key: e.key, keyCode: e.keyCode }); if (e.key && e.key.length === 1) call('keyTyped', { key: e.key }); }
    else call('keyReleased', { key: e.key, keyCode: e.keyCode });
  }
  // Controls the sketch listens to: .changed / .input when the value moves, a button's .mousePressed when pressed.
  for (const c of h.controls.values()) {
    const hd = c.handle;
    if (s.pressed && s.pressed(c.key)) { if (hd._cb.mousePressed) hd._cb.mousePressed(); continue; }
    if (c.kind === 'button') continue;
    const v = hd.value();
    if (c.last !== undefined && c.last !== v) { if (hd._cb.changed) hd._cb.changed(); if (hd._cb.input) hd._cb.input(); }
    c.last = v;
  }
  // draw, at the sketch's rate (every frame unless frameRate asked for fewer; once after noLoop or redraw).
  const dt = +s.dt || 0;
  h.acc += dt;
  const period = h.targetFps > 0 && h.targetFps < 59 ? 1 / h.targetFps : 0;
  let run = h.looping || h.redraws > 0 || !h.drawnOnce;
  if (run && period && h.drawnOnce && h.acc + 1e-4 < period) run = false;
  const draw = kp5Fn(st, 'draw');
  h.drew = false;
  if (run && draw) {
    if (!h.looping && h.redraws > 0 && h.drawnOnce) h.redraws--;
    h.deltaTime = (h.drawnOnce ? h.acc : dt) * 1000;
    if (h.acc > 0) h.fps = h.fps * 0.9 + (1 / Math.max(1e-3, h.acc)) * 0.1;
    h.acc = period ? Math.min(period, Math.max(0, h.acc - period)) : 0;
    h.frameCount++;
    if (g3) k3Begin(g3, h.lw, h.lh);
    else if (h.sf.ctx) { kp5Reset(h.sf); h.sf.stack.length = 0; h.sf.ctx.save(); }
    try { draw(); }
    finally {
      if (g3) k3End(g3);
      else if (h.sf.ctx) { h.sf.ctx.restore(); if (h.sf.stack.length) { h.sf.style = h.sf.stack[0]; h.sf.stack.length = 0; } }
    }
    h.drawnOnce = true; h.drew = true;
  }
  // The sketch's canvas, fitted into the layer's.
  if (!g3 && s.ctx && h.sf.canvas) {
    const bx = s.ctx;
    bx.save(); bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalAlpha = 1; bx.globalCompositeOperation = 'source-over';
    bx.clearRect(0, 0, W, H);
    bx.imageSmoothingEnabled = !h.sf.ctx || h.sf.ctx.imageSmoothingEnabled !== false;
    bx.drawImage(h.sf.canvas, ox, oy, vw, vh);
    bx.restore();
  }
}
function kp5Later(h) { if (!h.later.length) return; const l = h.later; h.later = []; for (const f of l) f(); }

/** Colour arguments (a p5 colour, or numbers in the sketch's colour mode) as CSS, for the 3D helpers. */
function kp5CssArgs(host, a) {
  const s = host.sf.style;
  if (!a.length) return a;
  if (a[0] instanceof kp5Color || (typeof a[0] === 'number' && (s.cmode !== 'rgb' || s.maxes[0] !== 255 || s.maxes[3] !== 255))) return [kp5Css(kp5Levels(a, s.cmode, s.maxes))];
  return a;
}

/** p5's WEBGL meanings on the 3D helpers: angle mode, p5 colours and colour modes, p5 images as textures. */
export function kp5Webgl(P3, host) {
  const ang = a => (host.sf.style.angle === 'degrees' ? (a * Math.PI) / 180 : a);
  for (const n of ['rotateX', 'rotateY', 'rotateZ', 'rotate']) { const f = P3[n]; if (typeof f === 'function') P3[n] = (a, ...r) => f(ang(+a || 0), ...r); }
  for (const n of ['fill', 'stroke', 'background', 'ambientMaterial', 'specularMaterial', 'emissiveMaterial', 'ambientLight']) {
    const f = P3[n];
    if (typeof f === 'function') P3[n] = (...a) => f(...kp5CssArgs(host, a));
  }
  for (const n of ['directionalLight', 'pointLight']) {
    const f = P3[n];
    if (typeof f === 'function') P3[n] = (...a) => {
      if (a[0] instanceof kp5Color) return f(kp5Css(a[0].levels), ...a.slice(1));
      const s = host.sf.style;
      if (s.cmode !== 'rgb' && a.length >= 6 && typeof a[0] === 'number') return f(kp5Css(kp5Levels(a.slice(0, a.length - 3), s.cmode, s.maxes)), ...a.slice(a.length - 3));
      return f(...a);
    };
  }
  const tex = P3.texture;
  if (typeof tex === 'function') P3.texture = t => tex(kp5Source(t));
  return P3;
}
