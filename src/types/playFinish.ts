/**
 * playFinish.ts — the Play record's Finish stack (`play.finish`): what it
 * holds, parsing it from a file, its control targets, and the grade's Looks.
 * The effects themselves (their numbers, the shader, the renderer) live in the
 * layer kit, play/kit/finish.js, so the app and exported pages share them.
 * See docs/finish-stack.md.
 */
import {
  FN_EFFECTS, FN_KINDS, FN_TONE_MODES, FN_TIME_MAPS, FN_TIME_QUALITY, FN_WHERE, FN_DISPLACE_MAPS, FN_MOSH_MAPS, FN_SOURCE_MAPS, FN_CURVE_CHANNELS, FN_HUE_CURVES, FN_COMPARE_ID, FN_COMPARE_PARAMS,
  fnDefaultEffect, fnDefaultCurves, fnDefaultCompare, fnParseCustom, fnMigrateHalation, type FnCompare, type FnCurves, type FnKind, type FnParam,
} from '../play/kit/finish.js';
import { GY_MAX, gyList } from '../play/kit/glyphs.js';
import type { SealedBlob } from './userNode';
import { decryptPayload, encryptPayload } from '../playfile/sealing';

export type FinishKind = FnKind;
export type FinishCurves = FnCurves;
export type FinishTimeMap = 'slit' | 'luma' | 'noise' | 'radial' | 'layer';
export type FinishTimeQuality = 'low' | 'medium' | 'high';
/** Where an effect shows: everywhere, or weighted by a layer's alpha, the picture's brightness, or camera motion. */
export type FinishWhere = 'all' | 'layer' | 'picture' | 'motion';
/** What pushes the picture in Displace. */
export type FinishDisplaceMap = 'noise' | 'picture' | 'layer' | 'motion';
/** What Datamosh measures movement on: the picture, or a layer drawn alone (a Camera layer, hidden or not). */
export type FinishMoshMap = 'picture' | 'layer';
/** What Feedback and Echo keep: the picture, one layer (drawn alone), the parts that move, or the bright parts. */
export type FinishSourceMap = 'picture' | 'layer' | 'moving' | 'bright';
export const FINISH_SOURCE_MAPS = FN_SOURCE_MAPS as readonly FinishSourceMap[];

/** One effect in the stack: its kind's numbers (FN_EFFECTS[kind].params) as keys, plus what isn't a number. */
export interface FinishEffect {
  id: string;
  /** A built-in effect, or 'custom' (effect code: see play/kit/finish.js fnParseCustom). */
  kind: FinishKind | 'custom';
  enabled: boolean;
  /** Custom: its name in the stack. */
  name?: string;
  /** Custom: its GLSL (`vec3 effect(vec2 uv, vec3 color)` and its `uniform` settings). Empty when sealed. */
  code?: string;
  /** Custom: the saved effect it came from (Your effects), if any. */
  defId?: string;
  /** Custom: the code, encrypted, for an effect from a sealed node pack (filled in only in memory). */
  sealed?: SealedBlob;
  /** Grade: the Tone Map node's mode ('none' = no tone mapping). */
  tone?: string;
  /** Grade: the curves ([x0, y0, x1, y1…] each, 0..1). */
  curves?: FinishCurves;
  /** Grade: the Look it started from, for the picker (the numbers can have moved since). */
  look?: string;
  /** Time displacement: what decides how far back each part of the picture looks. Displace: what pushes the picture. Datamosh: what its movement is measured on. */
  map?: FinishTimeMap | FinishDisplaceMap | FinishMoshMap | FinishSourceMap;
  /** Time displacement or Displace with map 'layer': the layer whose alpha is the map. Datamosh with map 'layer': the layer whose movement moves the picture. */
  layerId?: string;
  /** Any effect: where it shows (absent = everywhere). */
  where?: FinishWhere;
  /** Where 'layer': the layer whose alpha says where (it can be hidden). */
  whereLayer?: string;
  /** Where: swap in and out. */
  whereInvert?: boolean;
  /** Time displacement: how many frames it keeps, and at what size. */
  quality?: FinishTimeQuality;
  /** ASCII: the characters it draws, darkest first ('' = the built-in 5 × 5 ones); emoji work. */
  chars?: string;
  /** ASCII: use typed characters in the order typed (else they are ordered by how much of their cell they cover). */
  keepOrder?: boolean;
  [key: string]: unknown;
}

export type FinishCompare = FnCompare;

/** The Finish stack: on or bypassed, its effects in order, and the before/after wipe. Absent = none. */
export interface PlayFinish {
  on: boolean;
  effects: FinishEffect[];
  /** The before/after wipe (absent = off): saved, mappable (`finish:compare::pos`), and in renders and exports when on. */
  compare?: FinishCompare;
}

export const FINISH_KINDS = FN_KINDS as readonly FinishKind[];
export const FINISH_WHERE = FN_WHERE as readonly FinishWhere[];
export const FINISH_DISPLACE_MAPS = FN_DISPLACE_MAPS as readonly FinishDisplaceMap[];
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

/** The id the before/after wipe's numbers go under: `finish:compare::pos`. */
export const FINISH_COMPARE_ID = FN_COMPARE_ID;

/**
 * What in a finish has numbers, as effects: the effects, then the wipe (when
 * the record has one) as `{ id: 'compare', kind: 'compare', enabled: on, pos,
 * angle, softness }`. Read-only views: patch with patchFinishEffect.
 */
export interface FinishCompareHost extends FinishCompare { id: 'compare'; kind: 'compare'; enabled: boolean; name?: undefined; code?: undefined; sealed?: undefined; [key: string]: unknown }
export type FinishHost = FinishEffect | FinishCompareHost;

export function compareHost(c: FinishCompare): FinishCompareHost {
  return { ...c, id: 'compare', kind: 'compare', enabled: c.on };
}
export function finishHosts(finish: PlayFinish | undefined): FinishHost[] {
  if (!finish) return [];
  return finish.compare ? [...finish.effects, compareHost(finish.compare)] : finish.effects;
}
export function finishHost(finish: PlayFinish | undefined, id: string): FinishHost | undefined {
  if (!finish) return undefined;
  if (id === FN_COMPARE_ID) return finish.compare ? compareHost(finish.compare) : undefined;
  return finish.effects.find(e => e.id === id);
}

type HostLike = { kind: FinishHost['kind']; name?: unknown; code?: unknown; sealed?: unknown };

/** An effect's name in lists: the built-in label, a custom effect's own name, or the wipe. */
export function finishHostLabel(e: HostLike): string {
  if (e.kind === 'compare') return 'Before / after wipe';
  if (e.kind === 'custom') return (typeof e.name === 'string' && e.name.trim()) || 'Custom effect';
  return FN_EFFECTS[e.kind]?.label ?? String(e.kind);
}

/** An effect's numbers, in order (a custom effect's from its code). */
export function finishParamsOf(e: HostLike): FnParam[] {
  if (e.kind === 'compare') return FN_COMPARE_PARAMS as FnParam[];
  if (e.kind === 'custom') return fnParseCustom(finishCustomCode(e as Pick<FinishEffect, 'code' | 'sealed'>)).params;
  return FN_EFFECTS[e.kind]?.params ?? [];
}

/** An effect's numbers that can be controls: its sliders, then the hidden ones (wheel positions, colour channels). */
export function finishNumericProps(e: HostLike): FnParam[] {
  const ps = finishParamsOf(e);
  return [...ps.filter(p => !p.hidden), ...ps.filter(p => p.hidden)];
}

export function finishParam(kind: FinishKind, key: string): FnParam | undefined {
  return FN_EFFECTS[kind]?.params.find(p => p.key === key);
}
/** One number of an effect (built-in, custom or the wipe). */
export function finishParamOf(e: HostLike, key: string): FnParam | undefined {
  return finishParamsOf(e).find(p => p.key === key);
}

/** "Grade · Exposure": a finish target's words, or null when it isn't one or its effect is gone. */
export function finishTargetLabel(finish: PlayFinish | undefined, target: string): { effect: string; param: string } | null {
  const ft = parseFinishTarget(target);
  if (!ft) return null;
  const e = finishHost(finish, ft.effectId);
  if (!e) return null;
  return { effect: finishHostLabel(e), param: finishParamOf(e, ft.key)?.label ?? ft.key };
}

/** A number of an effect in the record (undefined when the effect or key is gone). */
export function readFinishValue(finish: PlayFinish | undefined, target: string): number | undefined {
  const ft = parseFinishTarget(target);
  if (!ft || !finish) return undefined;
  const e = finishHost(finish, ft.effectId);
  const v = e ? e[ft.key] : undefined;
  return typeof v === 'number' && finishParamOf(e!, ft.key) ? v : undefined;
}

/** The finish with one effect's numbers patched (the id 'compare' patches the wipe). */
export function patchFinishEffect(finish: PlayFinish | undefined, effectId: string, patch: Record<string, unknown>): PlayFinish | undefined {
  if (!finish) return finish;
  if (effectId === FN_COMPARE_ID) {
    const c = { ...(finish.compare ?? fnDefaultCompare()) };
    for (const k of ['pos', 'angle', 'softness'] as const) if (typeof patch[k] === 'number') c[k] = patch[k] as number;
    if (typeof patch.enabled === 'boolean') c.on = patch.enabled;
    if (typeof patch.on === 'boolean') c.on = patch.on;
    return { ...finish, compare: c };
  }
  return { ...finish, effects: finish.effects.map(e => (e.id === effectId ? { ...e, ...patch } as FinishEffect : e)) };
}

// ── Custom effects ──────────────────────────────────────────────────────────

const unsealed = new Map<string, string>();
/** A custom effect's code: as written, or (from a sealed pack) decrypted in memory; '' when it can't be read. */
export function finishCustomCode(e: Pick<FinishEffect, 'code' | 'sealed'>): string {
  if (!e.sealed) return typeof e.code === 'string' ? e.code : '';
  const k = e.sealed.data;
  const hit = unsealed.get(k);
  if (hit !== undefined) return hit;
  let code = '';
  try { code = decryptPayload(e.sealed).functionCode; } catch { code = ''; }
  if (unsealed.size > 64) unsealed.delete(unsealed.keys().next().value!);
  unsealed.set(k, code);
  return code;
}

/** Seal a custom effect's code (for a sealed node pack): the code goes into the blob and out of the record. */
export function sealCustomCode(code: string): SealedBlob {
  return encryptPayload({ functionCode: code, helperFunctions: [] });
}

const renderable = new WeakMap<PlayFinish, PlayFinish>();
/** The finish as the renderer needs it: sealed custom effects with their code filled in (in memory only; the record keeps them sealed). */
export function renderableFinish(finish: PlayFinish | undefined): PlayFinish | undefined {
  if (!finish || !finish.effects.some(e => e.kind === 'custom' && e.sealed)) return finish;
  const hit = renderable.get(finish);
  if (hit) return hit;
  const out = { ...finish, effects: finish.effects.map(e => (e.kind === 'custom' && e.sealed ? { ...e, code: finishCustomCode(e) } : e)) };
  renderable.set(finish, out);
  return out;
}

/** A new custom effect in the stack, at its settings' defaults. */
export function newCustomEffect(def: { name: string; code: string; defId?: string; sealed?: SealedBlob }, id = finishEffectId('custom')): FinishEffect {
  const e: FinishEffect = { id, kind: 'custom', enabled: true, name: def.name.trim().slice(0, 60) || 'Custom effect', code: def.sealed ? '' : def.code, ...(def.defId ? { defId: def.defId } : {}), ...(def.sealed ? { sealed: def.sealed } : {}) };
  for (const p of fnParseCustom(finishCustomCode(e)).params) e[p.key] = p.value;
  return e;
}

/** A custom effect with new code: the settings it still has keep their values (clamped), new ones start at their defaults, gone ones go. */
export function withCustomCode(e: FinishEffect, code: string): FinishEffect {
  const old = fnParseCustom(finishCustomCode(e)).params;
  const out: FinishEffect = { id: e.id, kind: 'custom', enabled: e.enabled, name: e.name, code, ...(e.defId ? { defId: e.defId } : {}) };
  for (const p of fnParseCustom(code).params) {
    const v = e[p.key];
    out[p.key] = typeof v === 'number' && old.some(o => o.key === p.key) ? Math.max(p.min, Math.min(p.max, v)) : p.value;
  }
  return out;
}

export function isSealedBlob(x: unknown): x is SealedBlob {
  const b = x as SealedBlob | null;
  return !!b && typeof b === 'object' && b.v === 1 && b.alg === 'A256GCM' && typeof b.salt === 'string' && typeof b.iv === 'string' && typeof b.data === 'string';
}

// ── Making and parsing ──────────────────────────────────────────────────────

let seq = 0;
export function finishEffectId(kind: FinishKind | 'custom'): string {
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

/** The longest custom effect code kept (characters). */
export const FINISH_CUSTOM_MAX_CODE = 20000;

/** A custom effect from a file: its name, code (or sealed blob) and settings, clamped to what the code declares. */
function parseCustomEffect(r: Record<string, unknown>): FinishEffect | null {
  const sealed = isSealedBlob(r.sealed) ? r.sealed : undefined;
  const code = typeof r.code === 'string' ? r.code.slice(0, FINISH_CUSTOM_MAX_CODE) : '';
  if (!sealed && !code.trim()) return null;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.slice(0, 80) : finishEffectId('custom');
  const e = newCustomEffect({ name: typeof r.name === 'string' ? r.name : 'Custom effect', code, ...(typeof r.defId === 'string' && r.defId ? { defId: r.defId.slice(0, 80) } : {}), ...(sealed ? { sealed } : {}) }, id);
  e.enabled = r.enabled !== false;
  for (const p of finishParamsOf(e)) e[p.key] = clampNum(r[p.key], p);
  return withWhere(e, r);
}

/** An effect's Where from a file: kept only when it is a known one other than everywhere. */
function withWhere(e: FinishEffect, r: Record<string, unknown>): FinishEffect {
  const w = r.where;
  if (typeof w !== 'string' || w === 'all' || !(FN_WHERE as readonly string[]).includes(w)) return e;
  e.where = w as FinishWhere;
  if (w === 'layer') e.whereLayer = typeof r.whereLayer === 'string' ? r.whereLayer.slice(0, 80) : '';
  if (r.whereInvert === true) e.whereInvert = true;
  return e;
}

/** The wipe from a file (absent or odd = none). */
export function parseCompare(raw: unknown): FinishCompare | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const c = fnDefaultCompare();
  c.on = r.on === true;
  for (const p of FN_COMPARE_PARAMS) (c as unknown as Record<string, number>)[p.key] = clampNum(r[p.key], p);
  return c;
}

/** One effect from a file, at its kind's defaults where anything is missing or odd; null for an unknown kind. */
export function parseFinishEffect(raw: unknown): FinishEffect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'custom') return parseCustomEffect(r);
  const kind = r.kind as FinishKind;
  if (!FINISH_KINDS.includes(kind)) return null;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.slice(0, 80) : finishEffectId(kind);
  const e = newFinishEffect(kind, id);
  e.enabled = r.enabled !== false;
  // Halation saved before the reference model: its numbers move to the new scale first (fnMigrateHalation).
  const src = kind === 'halation' ? fnMigrateHalation(r as { kind: string; [key: string]: unknown }) : r;
  for (const p of FN_EFFECTS[kind].params) e[p.key] = clampNum(src[p.key], p);
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
  if (kind === 'displace') {
    e.map = (FN_DISPLACE_MAPS as readonly string[]).includes(r.map as string) ? r.map as FinishDisplaceMap : 'noise';
    e.layerId = typeof r.layerId === 'string' ? r.layerId.slice(0, 80) : '';
  }
  if (kind === 'feedback' || kind === 'echo') {
    // Absent (a Feedback saved before Source) is the whole picture, as it was.
    e.map = (FN_SOURCE_MAPS as readonly string[]).includes(r.map as string) ? r.map as FinishSourceMap : 'picture';
    e.layerId = typeof r.layerId === 'string' ? r.layerId.slice(0, 80) : '';
  }
  if (kind === 'datamosh') {
    e.map = (FN_MOSH_MAPS as readonly string[]).includes(r.map as string) ? r.map as FinishMoshMap : 'picture';
    e.layerId = typeof r.layerId === 'string' ? r.layerId.slice(0, 80) : '';
  }
  if (kind === 'ascii') {
    // Absent (an ASCII saved before typed characters) is the built-in characters, as it was.
    e.chars = typeof r.chars === 'string' ? gyList(r.chars).slice(0, GY_MAX).join('') : '';
    e.keepOrder = r.keepOrder === true;
  }
  return withWhere(e, r);
}

/** The stack from a file: known effects only, one of each built-in kind (the first; custom effects any number), ids unique, and the wipe. Absent or empty (and on) = undefined. */
export function parseFinish(raw: unknown): PlayFinish | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const effects: FinishEffect[] = [];
  const kinds = new Set<string>(), ids = new Set<string>();
  if (Array.isArray(r.effects)) {
    for (const x of r.effects) {
      const e = parseFinishEffect(x);
      if (!e || (e.kind !== 'custom' && kinds.has(e.kind))) continue;
      if (ids.has(e.id) || e.id === FN_COMPARE_ID) e.id = finishEffectId(e.kind);
      kinds.add(e.kind); ids.add(e.id);
      effects.push(e);
    }
  }
  const on = r.on !== false;
  if (!effects.length && on) return undefined;
  const compare = parseCompare(r.compare);
  return compare ? { on, effects, compare } : { on, effects };
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
