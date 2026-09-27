/**
 * playFinish.ts — the Play record's Finish stack (`play.finish`): what it
 * holds, parsing it from a file, its control targets, and the grade's Looks.
 * The effects themselves (their numbers, the shader, the renderer) live in the
 * layer kit, play/kit/finish.js, so the app and exported pages share them.
 * See docs/finish-stack.md.
 */
import {
  FN_EFFECTS, FN_KINDS, FN_TONE_MODES, FN_TIME_MAPS, FN_TIME_QUALITY, FN_CURVE_CHANNELS, FN_HUE_CURVES,
  fnDefaultEffect, fnDefaultCurves, type FnCurves, type FnKind, type FnParam,
} from '../play/kit/finish.js';

export type FinishKind = FnKind;
export type FinishCurves = FnCurves;
export type FinishTimeMap = 'slit' | 'luma' | 'noise' | 'radial' | 'layer';
export type FinishTimeQuality = 'low' | 'medium' | 'high';

/** One effect in the stack: its kind's numbers (FN_EFFECTS[kind].params) as keys, plus what isn't a number. */
export interface FinishEffect {
  id: string;
  kind: FinishKind;
  enabled: boolean;
  /** Grade: the Tone Map node's mode ('none' = no tone mapping). */
  tone?: string;
  /** Grade: the curves ([x0, y0, x1, y1…] each, 0..1). */
  curves?: FinishCurves;
  /** Grade: the Look it started from, for the picker (the numbers can have moved since). */
  look?: string;
  /** Time displacement: what decides how far back each part of the picture looks. */
  map?: FinishTimeMap;
  /** Time displacement with map 'layer': the layer whose alpha is the map. */
  layerId?: string;
  /** Time displacement: how many frames it keeps, and at what size. */
  quality?: FinishTimeQuality;
  [key: string]: unknown;
}

/** The Finish stack: on or bypassed, and its effects in order. Absent = none. */
export interface PlayFinish {
  on: boolean;
  effects: FinishEffect[];
}

export const FINISH_KINDS = FN_KINDS as readonly FinishKind[];
export const FINISH_EFFECTS = FN_EFFECTS;
export const FINISH_TONE_MODES = FN_TONE_MODES;

// ── Control targets ─────────────────────────────────────────────────────────

export const FINISH_TARGET_PREFIX = 'finish:';

/** Control target for one of an effect's numbers: `finish:<effectId>::<key>`. */
export function finishTarget(effectId: string, key: string): string {
  return `${FINISH_TARGET_PREFIX}${effectId}::${key}`;
}

export function parseFinishTarget(target: string): { effectId: string; key: string } | null {
  if (!target.startsWith(FINISH_TARGET_PREFIX)) return null;
  const rest = target.slice(FINISH_TARGET_PREFIX.length);
  const i = rest.lastIndexOf('::');
  if (i <= 0) return null;
  return { effectId: rest.slice(0, i), key: rest.slice(i + 2) };
}

/**
 * The id the mapping engine keeps an effect's driven numbers under, beside
 * the layers' (playEngine.layerValue(finishPropId(e.id), key, base)).
 */
export function finishPropId(effectId: string): string {
  return `${FINISH_TARGET_PREFIX}${effectId}`;
}

/** An effect's numbers that can be controls: its sliders, then the hidden ones (wheel positions, colour channels). */
export function finishNumericProps(e: Pick<FinishEffect, 'kind'>): FnParam[] {
  const ps = FN_EFFECTS[e.kind]?.params ?? [];
  return [...ps.filter(p => !p.hidden), ...ps.filter(p => p.hidden)];
}

export function finishParam(kind: FinishKind, key: string): FnParam | undefined {
  return FN_EFFECTS[kind]?.params.find(p => p.key === key);
}

/** "Grade · Exposure": a finish target's words, or null when it isn't one or its effect is gone. */
export function finishTargetLabel(finish: PlayFinish | undefined, target: string): { effect: string; param: string } | null {
  const ft = parseFinishTarget(target);
  if (!ft) return null;
  const e = finish?.effects.find(x => x.id === ft.effectId);
  if (!e) return null;
  return { effect: FN_EFFECTS[e.kind].label, param: finishParam(e.kind, ft.key)?.label ?? ft.key };
}

/** A number of an effect in the record (undefined when the effect or key is gone). */
export function readFinishValue(finish: PlayFinish | undefined, target: string): number | undefined {
  const ft = parseFinishTarget(target);
  if (!ft || !finish) return undefined;
  const e = finish.effects.find(x => x.id === ft.effectId);
  const v = e ? e[ft.key] : undefined;
  return typeof v === 'number' && finishParam(e!.kind, ft.key) ? v : undefined;
}

/** The finish with one effect's numbers patched. */
export function patchFinishEffect(finish: PlayFinish | undefined, effectId: string, patch: Partial<FinishEffect>): PlayFinish | undefined {
  if (!finish) return finish;
  return { ...finish, effects: finish.effects.map(e => (e.id === effectId ? { ...e, ...patch } as FinishEffect : e)) };
}

// ── Making and parsing ──────────────────────────────────────────────────────

let seq = 0;
export function finishEffectId(kind: FinishKind): string {
  seq += 1;
  return `fx_${kind}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export function newFinishEffect(kind: FinishKind, id = finishEffectId(kind)): FinishEffect {
  return fnDefaultEffect(kind, id) as FinishEffect;
}

export function emptyFinish(): PlayFinish { return { on: true, effects: [] }; }

const clampNum = (v: unknown, p: FnParam): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(p.min, Math.min(p.max, v)) : p.value);

function parseCurve(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return fallback;
  const out: number[] = [];
  for (let i = 0; i + 1 < raw.length && out.length < 64; i += 2) {
    const x = raw[i], y = raw[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push(Math.round(Math.max(0, Math.min(1, x)) * 1e4) / 1e4, Math.round(Math.max(0, Math.min(1, y)) * 1e4) / 1e4);
  }
  return out;
}

export function parseCurves(raw: unknown): FinishCurves {
  const d = fnDefaultCurves();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const out = { ...d };
  for (const k of FN_CURVE_CHANNELS) { const c = parseCurve(r[k], d[k]); out[k] = c.length >= 2 ? c : d[k]; }
  for (const k of FN_HUE_CURVES) out[k] = parseCurve(r[k], []);
  return out;
}

/** One effect from a file, at its kind's defaults where anything is missing or odd; null for an unknown kind. */
export function parseFinishEffect(raw: unknown): FinishEffect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as FinishKind;
  if (!FINISH_KINDS.includes(kind)) return null;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.slice(0, 80) : finishEffectId(kind);
  const e = newFinishEffect(kind, id);
  e.enabled = r.enabled !== false;
  for (const p of FN_EFFECTS[kind].params) e[p.key] = clampNum(r[p.key], p);
  if (kind === 'grade') {
    e.tone = typeof r.tone === 'string' && FN_TONE_MODES.includes(r.tone) ? r.tone : 'none';
    e.curves = parseCurves(r.curves);
    if (typeof r.look === 'string' && r.look) e.look = r.look.slice(0, 80);
  }
  if (kind === 'time') {
    e.map = FN_TIME_MAPS.includes(r.map as string) ? r.map as FinishTimeMap : 'slit';
    e.layerId = typeof r.layerId === 'string' ? r.layerId.slice(0, 80) : '';
    e.quality = typeof r.quality === 'string' && r.quality in FN_TIME_QUALITY ? r.quality as FinishTimeQuality : 'medium';
  }
  return e;
}

/** The stack from a file: known effects only, one of each kind (the first), ids unique. Absent or empty (and on) = undefined. */
export function parseFinish(raw: unknown): PlayFinish | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const effects: FinishEffect[] = [];
  const kinds = new Set<string>(), ids = new Set<string>();
  if (Array.isArray(r.effects)) {
    for (const x of r.effects) {
      const e = parseFinishEffect(x);
      if (!e || kinds.has(e.kind)) continue;
      if (ids.has(e.id)) e.id = finishEffectId(e.kind);
      kinds.add(e.kind); ids.add(e.id);
      effects.push(e);
    }
  }
  const on = r.on !== false;
  if (!effects.length && on) return undefined;
  return { on, effects };
}

/** Does the finish do anything worth saving? */
export function isFinishEmpty(f: PlayFinish | undefined): boolean {
  return !f || (f.effects.length === 0 && f.on);
}

// ── Looks: starting points for the grade ────────────────────────────────────

export interface GradeLook {
  id: string;
  name: string;
  description: string;
  /** The grade's numbers that differ from its defaults. */
  values: Record<string, number>;
  tone?: string;
  curves?: Partial<FinishCurves>;
}

/**
 * A handful of looks made from the grade's own controls. Picking one sets
 * the grade to it (every other number back to its default), so what you see
 * is always what the sliders say, ready to tweak.
 */
export const GRADE_LOOKS: readonly GradeLook[] = [
  {
    id: 'teal-orange', name: 'Teal & orange', description: 'Warm skin and highlights against cool, teal shadows',
    values: { contrast: 0.25, vibrance: 0.2, temperature: 0.05, splitHiHue: 32, splitHiSat: 0.5, splitShHue: 188, splitShSat: 0.55, splitBalance: 0.1, liftX: -0.35, liftY: -0.25, gainX: 0.3, gainY: 0.25 },
    curves: { rgb: [0, 0.02, 0.25, 0.2, 0.75, 0.8, 1, 1] },
  },
  {
    id: 'bleach-bypass', name: 'Bleach bypass', description: 'Silver left in: low colour, hard contrast, heavy blacks',
    values: { contrast: 0.55, saturation: -0.6, highlights: -0.15, blacks: -0.3, shadows: -0.1 },
    curves: { rgb: [0, 0, 0.3, 0.22, 0.7, 0.8, 1, 1] },
  },
  {
    id: 'faded-print', name: 'Faded print', description: 'An old photograph: milky blacks, soft whites, warm and quiet',
    values: { blacks: 0.55, whites: -0.3, contrast: -0.15, saturation: -0.25, temperature: 0.12, splitShHue: 30, splitShSat: 0.2 },
    curves: { rgb: [0, 0.1, 0.5, 0.52, 1, 0.92] },
  },
  {
    id: 'cross-process', name: 'Cross-process', description: 'Slide film in the wrong chemistry: yellow highlights, blue shadows',
    values: { contrast: 0.2, saturation: 0.2 },
    curves: { r: [0, 0, 0.25, 0.18, 0.75, 0.86, 1, 1], g: [0, 0, 0.25, 0.22, 0.75, 0.84, 1, 1], b: [0, 0.16, 1, 0.82] },
  },
  {
    id: 'mono-toned', name: 'Mono, toned shadows', description: 'Black and white with cool shadows and warm paper',
    values: { saturation: -1, contrast: 0.25, splitShHue: 215, splitShSat: 0.4, splitHiHue: 40, splitHiSat: 0.18 },
  },
  {
    id: 'warm-film', name: 'Warm film', description: 'Golden, gentle, a soft film shoulder',
    values: { temperature: 0.3, tint: 0.05, contrast: 0.1, vibrance: 0.15, blacks: 0.15, gainX: 0.2, gainY: 0.3 },
    tone: 'agx',
  },
  {
    id: 'day-for-night', name: 'Day for night', description: 'Daylight turned into moonlight: dark, blue and muted',
    values: { exposure: -1.3, temperature: -0.65, saturation: -0.45, contrast: 0.2, highlights: -0.3 },
  },
];

/** A grade set to a look: every number back to its default, then the look's (id and on/off kept). */
export function applyLook(e: FinishEffect, look: Pick<GradeLook, 'values' | 'tone' | 'curves'> & { id?: string }): FinishEffect {
  const fresh = newFinishEffect('grade', e.id);
  const curves = { ...fnDefaultCurves(), ...(look.curves ?? {}) };
  const out: FinishEffect = { ...fresh, enabled: e.enabled, tone: look.tone ?? 'none', curves };
  for (const [k, v] of Object.entries(look.values)) if (finishParam('grade', k)) out[k] = v;
  if (look.id) out.look = look.id; else delete out.look;
  return out;
}

/** A grade's numbers that differ from the defaults, and its curves and tone: what a saved look keeps. */
export function lookFromGrade(e: FinishEffect): Pick<GradeLook, 'values' | 'tone' | 'curves'> {
  const values: Record<string, number> = {};
  for (const p of FN_EFFECTS.grade.params) { const v = e[p.key]; if (typeof v === 'number' && Math.abs(v - p.value) > 1e-6) values[p.key] = v; }
  return { values, tone: e.tone ?? 'none', curves: e.curves ?? fnDefaultCurves() };
}

export { FN_TIME_QUALITY as FINISH_TIME_QUALITY };
