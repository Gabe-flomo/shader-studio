/**
 * toFinish.ts — the 2D Scene Builder's older whole-picture settings (Look → Grade cards, and the
 * Look's vignette and grain) moved into the one Finish (docs/finish-stack.md, "One Finish").
 *
 * The builder used to build these as nodes at the end of its graph. They work on the whole
 * picture, so they now live in the graph's Finish stack (`play.finish`): the same stack Play's
 * Finish rail, the builder's Finish card and the Studio's Finish button edit.
 *
 * Each card becomes one custom Finish effect whose code is the very maths of the nodes it used
 * to build (Brightness / Contrast, Tone Curve, Saturation…), with the card's settings as its
 * sliders, named as the card was. So a moved grade keeps every number and looks the same; only
 * its place changes (after the whole graph, the Effects page and Play's layers). `defId`
 * (`builder:<kind>`) says where an effect came from, so it maps back to the card.
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { PlayRecord } from '../../types/play';
import { finishEffectId, newCustomEffect, type FinishEffect, type PlayFinish } from '../../types/playFinish';
import { GRADE_BY_KIND, gradeParamTarget } from './grade';
import { newStackItem, stackValue, type LookParam, type StackItem, type StackValue } from './stack';
import type { Vec3 } from './palette';

/** `defId` of an effect moved from the builder: `builder:<grade kind>`, `builder:vignette`, `builder:grain`. */
export const BUILDER_FX_PREFIX = 'builder:';

const num = (v: number) => { const t = String(Math.round(v * 1e6) / 1e6); return /[.e]/.test(t) ? t : `${t}.0`; };
const clean = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** One `uniform float` line whose range holds the value (a number typed past a slider's end stays as it was). */
function uFloat(name: string, label: string, v: number, min: number, max: number, hint = '', step?: number): string {
  const lo = Math.min(min, v), hi = Math.max(max, v);
  return `uniform float ${name}; // ${num(lo)}..${num(hi)} = ${num(v)}${step ? ` step ${num(step)}` : ''} ${clean(label)}${hint ? ` | ${clean(hint)}` : ''}`;
}
const hex = (c: Vec3) => `#${c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
function uColour(name: string, label: string, c: Vec3, hint = ''): string {
  return `uniform vec3 ${name}; // color ${hex(c)} ${clean(label)}${hint ? ` | ${clean(hint)}` : ''}`;
}

const LUMA = 'dot(color, vec3(0.2126, 0.7152, 0.0722))';
const RGB = ['R', 'G', 'B'] as const;
const v3 = (v: StackValue, d: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 ? [v[0], v[1], v[2]] : d);

/** A grade card's settings as numbers, keyed the way its effect keeps them (`liftR`, `dark.r`…). */
function itemNumbers(it: StackItem): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of GRADE_BY_KIND[it.kind]?.params ?? []) {
    const v = stackValue(it, p);
    if (p.type === 'num') out[p.key] = v as number;
    else if (p.type === 'rgb') v3(v, p.def as Vec3).forEach((x, i) => { out[`${p.key}${RGB[i]}`] = x; });
    else if (p.type === 'colour') v3(v, p.def as Vec3).forEach((x, i) => { out[`${p.key}.${'rgb'[i]}`] = x; });
  }
  return out;
}

const numLine = (p: LookParam, v: number, label = p.label) => uFloat(p.key, label, v, p.min ?? 0, p.max ?? 1, p.hint, p.step ?? (p.integer ? 1 : undefined));

/** The effect's code: the maths of the nodes the card used to build, its settings as uniforms. */
function gradeCode(it: StackItem, swatches: readonly Vec3[]): string | null {
  const def = GRADE_BY_KIND[it.kind];
  if (!def) return null;
  const P = (k: string) => def.params.find(p => p.key === k)!;
  const n = (k: string) => stackValue(it, P(k)) as number;
  const lines: string[] = [];
  const body = (code: string) => `${lines.join('\n')}\nvec3 effect(vec2 uv, vec3 color) {\n${code}\n}\n`;
  switch (it.kind) {
    case 'brightness':
      lines.push(numLine(P('brightness'), n('brightness')), numLine(P('contrast'), n('contrast')));
      return body('  return clamp((color - 0.5) * contrast + 0.5 + brightness, 0.0, 1.0);');
    case 'levels':
      lines.push(numLine(P('blacks'), n('blacks')), numLine(P('whites'), n('whites')), numLine(P('curve'), n('curve')));
      return body('  vec3 r = clamp((color - vec3(blacks)) / max(whites - blacks, 0.001), vec3(0.0), vec3(1.0));\n  vec3 sc = r * r * (3.0 - 2.0 * r);\n  return mix(r, sc, curve);');
    case 'saturation':
      lines.push(numLine(P('amount'), n('amount')));
      return body(`  float l = ${LUMA};\n  return mix(vec3(l), color, amount);`);
    case 'hue':
      lines.push(numLine(P('angle'), n('angle'), 'Turn (degrees)'));
      return body('  float a = radians(angle);\n  float c = cos(a), s = sin(a);\n  float lum = dot(color, vec3(0.333333));\n  vec3 cr = vec3(color.g - color.b, color.b - color.r, color.r - color.g);\n  return color * c + cr * (s * 0.57735) + vec3(lum) * (1.0 - c);');
    case 'shadows':
      lines.push(numLine(P('shadows'), n('shadows')), numLine(P('highlights'), n('highlights')), numLine(P('pivot'), n('pivot')));
      return body(`  float lum = ${LUMA};\n  float sh = 1.0 - smoothstep(0.0, pivot, lum);\n  float hi = smoothstep(pivot, 1.0, lum);\n  return clamp(color + sh * shadows + hi * highlights, vec3(0.0), vec3(1.0));`);
    case 'lgg': {
      const nums = itemNumbers(it);
      for (const key of ['lift', 'gamma', 'gain']) {
        const p = P(key);
        RGB.forEach(c => lines.push(uFloat(`${key}${c}`, `${p.label} ${c}`, nums[`${key}${c}`], p.min ?? 0, p.max ?? 1, p.hint)));
      }
      return body('  vec3 g = max(vec3(gammaR, gammaG, gammaB), vec3(0.001));\n  vec3 l = max(color * vec3(gainR, gainG, gainB) + vec3(liftR, liftG, liftB), vec3(0.0));\n  return pow(l, 1.0 / g);');
    }
    case 'temperature':
      lines.push(numLine(P('kelvin'), n('kelvin')), numLine(P('amount'), n('amount')));
      // The Blackbody node's colour of light, multiplied over the picture (Blend Modes: Multiply, Amount as Opacity).
      return body([
        '  float t = clamp(kelvin, 1000.0, 12000.0) / 100.0;',
        '  float r, g, b;',
        '  if (t <= 66.0) { r = 1.0; g = clamp((99.4708025861 * log(t) - 161.1195681661) / 255.0, 0.0, 1.0); }',
        '  else { r = clamp((329.698727446 * pow(t - 60.0, -0.1332047592)) / 255.0, 0.0, 1.0); g = clamp((288.1221695283 * pow(t - 60.0, -0.0755148492)) / 255.0, 0.0, 1.0); }',
        '  if (t >= 66.0) b = 1.0; else if (t <= 19.0) b = 0.0; else b = clamp((138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0);',
        '  return mix(color, color * vec3(r, g, b), clamp(amount, 0.0, 1.0));',
      ].join('\n'));
    case 'posterize':
      lines.push(numLine(P('levels'), Math.round(n('levels'))));
      return body('  return floor(color * levels) / max(levels, 1.0);');
    case 'invert':
      lines.push(numLine(P('amount'), n('amount')));
      return body('  return mix(color, 1.0 - color, amount);');
    case 'duotone': {
      const dark = v3(stackValue(it, P('dark')), [0, 0, 0]), light = v3(stackValue(it, P('light')), [1, 1, 1]);
      lines.push(uColour('dark', 'Darks', dark, P('dark').hint), uColour('light', 'Lights', light, P('light').hint), numLine(P('amount'), n('amount')));
      return body(`  float l = ${LUMA};\n  return mix(color, mix(dark, light, clamp(l, 0.0, 1.0)), amount);`);
    }
    case 'gradient-map': {
      const cols = swatches.slice(0, 8).map(c => [c[0], c[1], c[2]] as Vec3);
      while (cols.length < 2) cols.push(cols[cols.length - 1] ?? [1, 1, 1]);
      cols.forEach((c, i) => lines.push(uColour(`stop${i + 1}`, `Colour ${i + 1}`, c, i === 0 ? 'The darks take the first colour, the lights the last.' : '')));
      lines.push(numLine(P('amount'), n('amount')));
      // The Color Ramp node's chain: the stops evenly spaced over the brightness.
      let expr = 'stop1';
      for (let i = 0; i < cols.length - 1; i++) {
        const lo = num(i / (cols.length - 1)), hi = num((i + 1) / (cols.length - 1));
        expr = `mix(${expr}, stop${i + 2}, clamp((l - ${lo}) / (${hi} - ${lo}), 0.0, 1.0))`;
      }
      return body(`  float l = ${LUMA};\n  return mix(color, ${expr}, amount);`);
    }
  }
  return null;
}

/** One Grade card as a Finish effect (the same maths, settings and on/off). */
export function gradeItemToFinish(it: StackItem, opts: { swatches?: readonly Vec3[]; id?: string } = {}): FinishEffect | null {
  const def = GRADE_BY_KIND[it.kind];
  const code = def ? gradeCode(it, opts.swatches ?? []) : null;
  if (!def || !code) return null;
  const e = newCustomEffect({ name: def.label, code, defId: `${BUILDER_FX_PREFIX}${it.kind}` }, opts.id ?? finishEffectId('custom'));
  for (const [k, v] of Object.entries(itemNumbers(it))) if (k in e) e[k] = v;
  if (it.kind === 'posterize') e.levels = Math.round(e.levels as number);
  e.enabled = it.on;
  return e;
}

/** A Finish effect that came from a Grade card, back as the card (null for any other effect). */
export function finishToGradeItem(e: FinishEffect, id = 'gr1'): StackItem | null {
  if (e.kind !== 'custom' || typeof e.defId !== 'string' || !e.defId.startsWith(BUILDER_FX_PREFIX)) return null;
  const def = GRADE_BY_KIND[e.defId.slice(BUILDER_FX_PREFIX.length)];
  if (!def) return null;
  const params: Record<string, StackValue> = {};
  for (const p of def.params) {
    if (p.type === 'num') { if (typeof e[p.key] === 'number') params[p.key] = e[p.key] as number; }
    else if (p.type === 'rgb') { const c = RGB.map(x => e[`${p.key}${x}`]); if (c.every(x => typeof x === 'number')) params[p.key] = c as Vec3; }
    else if (p.type === 'colour') { const c = ['r', 'g', 'b'].map(x => e[`${p.key}.${x}`]); if (c.every(x => typeof x === 'number')) params[p.key] = c as Vec3; }
  }
  return { ...newStackItem(def, id, params), on: e.enabled };
}

/** The Look's vignette or grain as a Finish effect: the Vignette or Grain node's maths, at the builder's point. */
export function postToFinish(kind: 'vignette' | 'grain', value: number, on = true, id = finishEffectId('custom')): FinishEffect {
  // The 2D builder read both at its UV node's point: the centre (0, 0), the top 1, x times the aspect.
  const point = '  vec2 p = (uv - 0.5) * 2.0;\n  p.x *= aspect;';
  const code = kind === 'vignette'
    ? `${uFloat('strength', 'Vignette', value, 0, 1, 'How dark the corners get.')}\nvec3 effect(vec2 uv, vec3 color) {\n${point}\n  float d = length(p - 0.5);\n  float vig = smoothstep(0.65, 0.65 - 0.45, d);\n  return color * mix(1.0, vig, strength);\n}\n`
    : `${uFloat('grainAmount', 'Grain', value, 0, 0.5, 'How much noise over everything.')}\nvec3 effect(vec2 uv, vec3 color) {\n${point}\n  vec3 h = fract(sin(vec3(dot(p * 1234.5678, vec2(12.9898, 4.1414)), dot(p * 876.5432, vec2(12.9898, 4.1414)), dot(p * 3214.5678, vec2(12.9898, 4.1414)))) * 43758.5453);\n  return clamp(color + mix(vec3(-grainAmount), vec3(grainAmount), h), 0.0, 1.0);\n}\n`;
  const e = newCustomEffect({ name: kind === 'vignette' ? 'Vignette (builder)' : 'Grain (builder)', code, defId: `${BUILDER_FX_PREFIX}${kind}` }, id);
  e[kind === 'vignette' ? 'strength' : 'grainAmount'] = value;
  e.enabled = on;
  return e;
}

/** A Finish effect from the Look's vignette or grain, back as the setting. */
export function finishToPost(e: FinishEffect): { kind: 'vignette' | 'grain'; value: number } | null {
  if (e.kind !== 'custom' || (e.defId !== `${BUILDER_FX_PREFIX}vignette` && e.defId !== `${BUILDER_FX_PREFIX}grain`)) return null;
  const kind = e.defId === `${BUILDER_FX_PREFIX}vignette` ? 'vignette' : 'grain';
  const v = e[kind === 'vignette' ? 'strength' : 'grainAmount'];
  return typeof v === 'number' ? { kind, value: v } : null;
}

// ── Moving a scene's settings ────────────────────────────────────────────────

/** What a 2D scene's Look holds that moves to the Finish. */
export interface MovableLook {
  grade?: StackItem[];
  post: { vignette: number; grain: number; bloom: number; scanlines: number };
  mute?: Partial<Record<string, boolean>>;
}

/** Does this Look still hold settings that belong in the Finish? */
export function hasMovableLook(look: MovableLook): boolean {
  return !!look.grade?.length || look.post.vignette > 0 || look.post.grain > 0;
}

export interface LookMove {
  /** The Finish effects, in the order they were built (the grade, then vignette, then grain). */
  effects: FinishEffect[];
  /** Play control targets on the old nodes → the same setting on its effect, with a factor for a unit change. */
  retarget: Map<string, { target: string; scale: number }>;
  /** What moved, in words. */
  names: string[];
}

/**
 * The Look's grade cards, vignette and grain as Finish effects. Given the build's nodes (by role), a
 * setting changed by hand on its node since the build moves with the node's value, and Play
 * controls on those nodes are retargeted onto the effects.
 */
export function lookToFinish(look: MovableLook, opts: { swatches?: readonly Vec3[]; byRole?: Map<string, GraphNode> } = {}): LookMove {
  const effects: FinishEffect[] = [];
  const retarget = new Map<string, { target: string; scale: number }>();
  const names: string[] = [];
  const byRole = opts.byRole;
  for (const it0 of look.grade ?? []) {
    const def = GRADE_BY_KIND[it0.kind];
    if (!def) continue;
    const it: StackItem = { ...it0, params: { ...it0.params } };
    for (const p of def.params) {
      const t = gradeParamTarget(it0, p.key);
      const v = t ? byRole?.get(t.role)?.params[t.param] : undefined;
      if (p.type === 'num' && typeof v === 'number') it.params[p.key] = p.deg ? Math.round(v * 180 / Math.PI * 1e4) / 1e4 : v;
      else if ((p.type === 'rgb' || p.type === 'colour') && Array.isArray(v) && v.length === 3) it.params[p.key] = [v[0], v[1], v[2]] as Vec3;
    }
    const e = gradeItemToFinish(it, { swatches: opts.swatches });
    if (!e) continue;
    effects.push(e);
    names.push(def.label);
    for (const p of def.params) {
      if (p.type !== 'num') continue;
      const t = gradeParamTarget(it0, p.key);
      const node = t ? byRole?.get(t.role) : undefined;
      if (node && t) retarget.set(`${node.id}::${t.param}`, { target: `finish:${e.id}::${p.key}`, scale: p.deg ? 180 / Math.PI : 1 });
    }
  }
  const mute = look.mute ?? {};
  if (look.post.vignette > 0) {
    const e = postToFinish('vignette', look.post.vignette, !mute.vignette);
    effects.push(e); names.push('Vignette');
    const node = byRole?.get('vignette');
    if (node) retarget.set(`${node.id}::strength`, { target: `finish:${e.id}::strength`, scale: 1 });
  }
  if (look.post.grain > 0) {
    const e = postToFinish('grain', look.post.grain, !mute.grain);
    effects.push(e); names.push('Grain');
    const node = byRole?.get('grain');
    if (node) retarget.set(`${node.id}::amount`, { target: `finish:${e.id}::grainAmount`, scale: 1 });
  }
  return { effects, retarget, names };
}

/** The Look with what moved taken out (the tone map, glow and the older bloom and scanlines stay). */
export function withoutMovedLook<L extends MovableLook>(look: L): L {
  const out: L = { ...look, post: { ...look.post, vignette: 0, grain: 0 } };
  delete out.grade;
  if (out.mute) { const m = { ...out.mute }; delete m.vignette; delete m.grain; out.mute = m; }
  return out;
}

/** The Play record with the moved effects at the end of its Finish, and controls on the old nodes moved onto them. */
export function addMovedToPlay(play: PlayRecord, move: LookMove): PlayRecord {
  if (!move.effects.length) return play;
  const f: PlayFinish = play.finish ?? { on: true, effects: [] };
  const finish: PlayFinish = { ...f, effects: [...f.effects, ...move.effects] };
  const controls = play.controls.map(c => {
    const to = move.retarget.get(c.target);
    if (!to) return c;
    return to.scale === 1 ? { ...c, target: to.target } : { ...c, target: to.target, min: c.min * to.scale, max: c.max * to.scale, ...(c.step ? { step: c.step * to.scale } : {}) };
  });
  return { ...play, finish, controls };
}
