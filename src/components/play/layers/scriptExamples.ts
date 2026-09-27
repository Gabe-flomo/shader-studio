/**
 * Starter sketches for the Script layer. Each is a complete script the
 * editor can load, with the layer settings it expects (trails want the
 * canvas kept between frames; picture readers need the picture sampled).
 */
import { DEFAULT_SCRIPT, DEFAULT_SCRIPT_3D } from '../../../types/playLayers';
import { KL_SKETCH_NAMES, klCompileSketch } from '../../../play/kit/layers.js';
import { K3_SKETCH_NAMES } from '../../../play/kit/sketch3d.js';

export interface ScriptExample { name: string; hint: string; code: string; settings: { clear: boolean; readPicture: boolean } }

export const SCRIPT_EXAMPLES: ScriptExample[] = [
  {
    name: 'Dots', hint: 'Bouncing dots that light up near the mouse. Three sliders declared in the script.', settings: { clear: true, readPicture: false },
    code: DEFAULT_SCRIPT,
  },
  {
    name: 'p5 sketch', hint: 'p5-style: background, fill, circle, map, noise as plain names; plain variables become sliders with one click.', settings: { clear: true, readPicture: false },
    code: `// p5-style. Select a variable below (double-click "count") and press "Make a slider".
let count = 60;
let wobble = 30;
let hue = 210;

function draw(s) {
  background(12, 12, 18);
  noStroke();
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const x = map(t, 0, 1, 40, width - 40);
    const y = height / 2 + Math.sin(t * TWO_PI * 2 + s.time * 2) * wobble * 3;
    const n = noise(i * 0.2, s.time * 0.5);
    fill(hsl(hue + i * 2, 80, 40 + n * 40));
    circle(x, y, 8 + n * 24);
  }
  fill(255); textSize(14); textAlign('left', 'top');
  text('mouse: ' + Math.round(mouseX) + ', ' + Math.round(mouseY), 12, 12);
}
`,
  },
  {
    name: 'Trail', hint: 'A ribbon that follows the mouse and fades. Clear is off, so each frame draws over the last. Wipe is a button.', settings: { clear: false, readPicture: false },
    code: `// Trails: the canvas is kept between frames (Clear is off), so we fade it a little each frame
// instead of clearing it, then draw the newest segment on top.
const params = {
  fade:  { value: 0.06, min: 0.005, max: 0.4, step: 0.005, label: 'Fade' },
  width: { value: 14, min: 1, max: 80, label: 'Width' },
  hue:   { value: 200, min: 0, max: 360, step: 1, label: 'Hue' },
  // A function in params is a button: on the layer, and an action Play can press from a key or a beat.
  wipe(s) { s.ctx.clearRect(0, 0, s.width, s.height); },
};

function setup(s) { s.state.last = null; s.state.t = 0; }

function draw(s) {
  const { ctx, width, height, mouse, params, dt } = s;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,' + params.fade + ')';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  const p = mouse.over ? { x: mouse.x, y: mouse.y } : { x: width * (0.5 + 0.35 * Math.cos(s.time)), y: height * (0.5 + 0.35 * Math.sin(s.time * 1.3)) };
  const last = s.state.last || p;
  s.state.t += dt;
  ctx.strokeStyle = 'hsl(' + ((params.hue + s.state.t * 40) % 360) + ' 90% 60%)';
  ctx.lineWidth = params.width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  s.state.last = p;
}
`,
  },
  {
    name: 'Picture grid', hint: 'Squares sized by the picture’s brightness under them: the script reads the shader. Invert is a toggle.', settings: { clear: true, readPicture: true },
    code: `// Reads the picture: s.picture.brightness(x, y) is 0..1 at a pixel (Picture must be on).
const params = {
  cells:  { value: 28, min: 4, max: 80, step: 1, label: 'Cells' },
  gain:   { value: 1.2, min: 0.2, max: 3, step: 0.05, label: 'Gain' },
  invert: { kind: 'toggle', value: false, label: 'Invert' },
};

function draw(s) {
  const { ctx, width, height, params } = s;
  const cell = width / params.cells;
  ctx.fillStyle = 'white';
  for (let y = cell / 2; y < height; y += cell) {
    for (let x = cell / 2; x < width; x += cell) {
      let b = Math.min(1, s.picture.brightness(x, y) * params.gain);
      if (params.invert) b = 1 - b;
      const r = b * cell * 0.5;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}
`,
  },
  {
    name: 'Orbit a null', hint: 'Satellites circle a null called "Sun": s.null(name) gives any null’s position in pixels.', settings: { clear: true, readPicture: false },
    code: `// Add a Null layer named "Sun" (or rename one) and this orbits it. Without one it orbits the centre.
const params = {
  count:  { value: 8, min: 1, max: 40, step: 1, label: 'Satellites' },
  radius: { value: 140, min: 10, max: 600, label: 'Radius' },
  speed:  { value: 1, min: -4, max: 4, step: 0.05, label: 'Speed' },
};

function draw(s) {
  const { ctx, width, height, time, params } = s;
  const c = s.null('Sun') || { x: width / 2, y: height / 2 };
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(c.x, c.y, params.radius, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < params.count; i++) {
    const a = time * params.speed + (i / params.count) * Math.PI * 2;
    const x = c.x + Math.cos(a) * params.radius, y = c.y + Math.sin(a) * params.radius;
    ctx.fillStyle = 'hsl(' + (i / params.count) * 360 + ' 80% 65%)';
    ctx.beginPath(); ctx.arc(x, y, 8 + 4 * Math.sin(time * 3 + i), 0, Math.PI * 2); ctx.fill();
  }
}
`,
  },
];

/** Starters for a Script layer in 3D. */
export const SCRIPT_EXAMPLES_3D: ScriptExample[] = [
  {
    name: 'Boxes', hint: 'A ring of lit boxes turning over the picture. Drag on the picture to orbit. Three sliders declared in the script.', settings: { clear: true, readPicture: false },
    code: DEFAULT_SCRIPT_3D,
  },
  {
    name: 'Picture cube', hint: 'A cube wearing the live shader (s.picture.texture), with a lit sphere going round it.', settings: { clear: true, readPicture: false },
    code: `// The picture as a texture: s.picture.texture is the shader under this layer, this frame.
let size = 260;
let spin = 0.5;

function draw(s) {
  orbitControl();
  ambientLight(90);
  directionalLight(255, 255, 255, 0.2, 0.5, -1);
  noStroke();
  push();
  rotateX(s.time * spin * 0.8);
  rotateY(s.time * spin);
  texture(s.picture.texture);
  box(size);
  pop();
  const a = s.time * 1.2;
  push();
  translate(cos(a) * size, sin(a * 2) * 40, sin(a) * size);
  fill(255, 190, 90);
  sphere(size * 0.12);
  pop();
}
`,
  },
  {
    name: 'three.js', hint: 'Raw three.js through s.three: a torus knot built once in setup, turned in draw, lit by p5-style lights.', settings: { clear: true, readPicture: false },
    code: `// s.three = { THREE, scene, camera, renderer, root }: build in setup, change in draw.
// root holds the p5-style shapes (y down); scene is three's usual y-up world.
let knot;

function setup(s) {
  const { THREE, scene } = s.three;
  knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(Math.min(s.width, s.height) * 0.18, 34, 200, 24),
    new THREE.MeshStandardMaterial({ color: 0x8fd3ff, metalness: 0.4, roughness: 0.3 }),
  );
  scene.add(knot);
}

function draw(s) {
  orbitControl();
  ambientLight(50);
  directionalLight(255, 240, 220, -0.5, 0.8, -1);
  pointLight(120, 160, 255, 0, 0, 400);
  knot.rotation.x = s.time * 0.4;
  knot.rotation.y = s.time * 0.6;
}
`,
  },
];

export function examplesFor(mode: '2d' | '3d'): ScriptExample[] {
  return mode === '3d' ? SCRIPT_EXAMPLES_3D : SCRIPT_EXAMPLES;
}

/** The sliders a script declares, read by running its top level once (the kit does the same each time the code changes). */
export function extractScriptParams(code: string): { ok: true; defs: import('../../../types/playLayers').ScriptParamDef[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    // The same wrapper the kit uses, with helpers that do nothing, so a sketch that draws at its top level still parses.
    const stub: Record<string, unknown> = {};
    // 2D and 3D names alike: reading params does not depend on the mode.
    for (const n of [...KL_SKETCH_NAMES, ...K3_SKETCH_NAMES]) stub[n] = /^[A-Z_]+$/.test(n) ? 0 : (n === 'width' || n === 'height' || n.startsWith('mouse') || n === 'frameCount' || n === 'deltaTime') ? 0 : () => 0;
    raw = klCompileSketch(code, stub).params;
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
  const defs: import('../../../types/playLayers').ScriptParamDef[] = [];
  for (const [key, spec] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!/^[A-Za-z_]\w{0,30}$/.test(key)) continue;
    // Shorthands: a number is a 0–1 slider, a boolean a toggle, a function a button that runs it when pressed.
    const o: Record<string, unknown> = typeof spec === 'number' ? { value: spec }
      : typeof spec === 'boolean' ? { kind: 'toggle', value: spec }
      : typeof spec === 'function' ? { kind: 'button' }
      : spec === 'button' || spec === 'toggle' ? { kind: spec }
      : ((spec && typeof spec === 'object' ? spec : {}) as Record<string, unknown>);
    const kind = o.kind === 'toggle' || o.kind === 'button' ? o.kind : 'slider';
    const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key;
    const hint = typeof o.hint === 'string' ? { hint: o.hint } : {};
    if (kind === 'slider') {
      const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      const min = num(o.min, 0), max = num(o.max, Math.max(1, min + 1));
      defs.push({ key, label, value: Math.min(max, Math.max(min, num(o.value, min))), min, max, ...(typeof o.step === 'number' && o.step > 0 ? { step: o.step } : {}), ...hint });
    } else {
      const on = o.value === true || (typeof o.value === 'number' && o.value >= 0.5);
      defs.push({ key, label, kind, value: kind === 'toggle' && on ? 1 : 0, min: 0, max: 1, step: 1, ...hint });
    }
    if (defs.length >= 32) break;
  }
  return { ok: true, defs };
}
