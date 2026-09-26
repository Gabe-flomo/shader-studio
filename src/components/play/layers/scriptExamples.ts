/**
 * Starter sketches for the Script layer. Each is a complete script the
 * editor can load, with the layer settings it expects (trails want the
 * canvas kept between frames; picture readers need the picture sampled).
 */
import { DEFAULT_SCRIPT } from '../../../types/playLayers';

export interface ScriptExample { name: string; hint: string; code: string; settings: { clear: boolean; readPicture: boolean } }

export const SCRIPT_EXAMPLES: ScriptExample[] = [
  {
    name: 'Dots', hint: 'Bouncing dots that light up near the mouse. Three sliders declared in the script.', settings: { clear: true, readPicture: false },
    code: DEFAULT_SCRIPT,
  },
  {
    name: 'Trail', hint: 'A ribbon that follows the mouse and fades. Clear is off, so each frame draws over the last.', settings: { clear: false, readPicture: false },
    code: `// Trails: the canvas is kept between frames (Clear is off), so we fade it a little each frame
// instead of clearing it, then draw the newest segment on top.
const params = {
  fade:  { value: 0.06, min: 0.005, max: 0.4, step: 0.005, label: 'Fade' },
  width: { value: 14, min: 1, max: 80, label: 'Width' },
  hue:   { value: 200, min: 0, max: 360, step: 1, label: 'Hue' },
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
    name: 'Picture grid', hint: 'Squares sized by the picture’s brightness under them: the script reads the shader.', settings: { clear: true, readPicture: true },
    code: `// Reads the picture: s.picture.brightness(x, y) is 0..1 at a pixel (Picture must be on).
const params = {
  cells:  { value: 28, min: 4, max: 80, step: 1, label: 'Cells' },
  gain:   { value: 1.2, min: 0.2, max: 3, step: 0.05, label: 'Gain' },
  invert: { value: 0, min: 0, max: 1, step: 1, label: 'Invert' },
};

function draw(s) {
  const { ctx, width, height, params } = s;
  const cell = width / params.cells;
  ctx.fillStyle = 'white';
  for (let y = cell / 2; y < height; y += cell) {
    for (let x = cell / 2; x < width; x += cell) {
      let b = Math.min(1, s.picture.brightness(x, y) * params.gain);
      if (params.invert > 0.5) b = 1 - b;
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

/** The sliders a script declares, read by running its top level once (the kit does the same each time the code changes). */
export function extractScriptParams(code: string): { ok: true; defs: import('../../../types/playLayers').ScriptParamDef[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = new Function(`${code}\n;return typeof params === "object" && params ? params : {};`)();
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
  const defs: import('../../../types/playLayers').ScriptParamDef[] = [];
  for (const [key, spec] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!/^[A-Za-z_]\w{0,30}$/.test(key)) continue;
    const o = (typeof spec === 'number' ? { value: spec } : (spec ?? {})) as Record<string, unknown>;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const min = num(o.min, 0), max = num(o.max, Math.max(1, min + 1));
    const def = { key, label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key, value: Math.min(max, Math.max(min, num(o.value, min))), min, max, ...(typeof o.step === 'number' && o.step > 0 ? { step: o.step } : {}), ...(typeof o.hint === 'string' ? { hint: o.hint } : {}) };
    defs.push(def);
    if (defs.length >= 32) break;
  }
  return { ok: true, defs };
}
