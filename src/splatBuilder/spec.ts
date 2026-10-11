/**
 * spec.ts — the Splat builder's description of a splat scene (docs/splat-builder.md): which scan, where
 * it sits, the per-splat effects stacked on it, the world round it, the camera and the look. Build
 * (build.ts) turns it into the same graph you would wire by hand: a Splat Scene, its Modifier chain
 * (one recipe node per effect, nodes/recipes/splatModifierRecipes.ts), a March Camera, and optionally
 * a ray-marched world from the 3D Scene Builder's own builder.
 *
 * Pure: no DOM, no store.
 */
import { getNodeDefinition } from '../nodes/definitions';
import type { TexSource } from '../builders/textures';
import { soloIn } from '../builders/mute';

export type Vec3 = [number, number, number];

// ── The scan ────────────────────────────────────────────────────────────────

export type DemoScan = 'blob' | 'rings';
export type ScanSource =
  | { kind: 'demo'; demo: DemoScan; count: number }
  | { kind: 'file'; videoId: string; fileName: string; bytes: number };

export type QualityPreset = 'fast' | 'balanced' | 'best';
export const QUALITY_PRESETS: Record<QualityPreset, { label: string; line: string; maxSplats: number; shDegree: number; sort: 'moves' | 'frame'; resolution: 'full' | 'half' }> = {
  fast: { label: 'Fast', line: '500k splats, flat colour, half resolution', maxSplats: 500_000, shDegree: 0, sort: 'moves', resolution: 'half' },
  balanced: { label: 'Balanced', line: '2M splats, a little shine', maxSplats: 2_000_000, shDegree: 1, sort: 'moves', resolution: 'full' },
  best: { label: 'Best', line: '4M splats, full shine, sorted every frame', maxSplats: 4_000_000, shDegree: 3, sort: 'frame', resolution: 'full' },
};
export const QUALITY_KEYS = Object.keys(QUALITY_PRESETS) as QualityPreset[];

export interface ScanSpec {
  source: ScanSource;
  maxSplats: number;
  shDegree: number;
  sort: 'moves' | 'frame';
  resolution: 'full' | 'half';
}

export interface PlaceSpec {
  position: Vec3;
  /** Degrees, X then Y then Z (the Splat Scene's order). */
  rotation: Vec3;
  scale: number;
  /** −Y: the 3DGS convention (most scans); +Y: as it comes. */
  up: 'minusY' | 'y';
  splatSize: number;
  opacity: number;
}

// ── Effects: the Modifier chain ─────────────────────────────────────────────

export const EFFECT_KINDS = ['dissolve', 'explode', 'wave', 'color', 'crop', 'look', 'points'] as const;
export type EffectKind = typeof EFFECT_KINDS[number];
/**
 * A card in the stack: one of the effects, or `custom`, "Your nodes": a run of nodes you added on the Splat Scene card
 * (Splat Attributes → … → Set Splat, or any splat node), kept where it is in the chain. The builder never builds or
 * changes those nodes; it only wires them in their place (`tail` is the one that feeds the next card).
 */
export type StackKind = EffectKind | 'custom';

export const EFFECT_TYPE: Record<StackKind, string> = {
  dissolve: 'splatDissolve', explode: 'splatExplode', wave: 'splatWave', color: 'splatColor', crop: 'splatCrop', look: 'splatLook', points: 'splatPoints', custom: '',
};

export const EFFECT_INFO: Record<StackKind, { label: string; line: string; /** The setting Animate sweeps. */ main: string }> = {
  custom: { label: 'Your nodes', line: 'Nodes you added on the card, kept in their place in the chain', main: '' },
  dissolve: { label: 'Dissolve', line: 'Splats fade away through noise, with a glowing edge', main: 'amount' },
  explode: { label: 'Explode', line: 'Blown out from a point; Return home brings them back', main: 'amount' },
  wave: { label: 'Wave', line: 'A travelling wave, a wobble or a twist', main: 'amplitude' },
  color: { label: 'Colour grade', line: 'Hue, saturation, brightness, contrast, tint', main: 'hue' },
  crop: { label: 'Crop', line: 'Keep one side of a plane, or inside a box or ball', main: 'offset' },
  look: { label: 'Size & opacity', line: 'Bigger, fainter, denser or sparser splats', main: 'size' },
  points: { label: 'Points', line: 'Every splat a crisp dot: a point cloud', main: 'dotSize' },
};

export type ParamValue = number | string | Vec3;

export interface EffectSpec {
  id: string;
  kind: StackKind;
  /** Your nodes: the node that feeds the next card (the run's end on the chain). */
  tail?: string;
  /** Your nodes: what the run is made of, in words ("Splat Attributes → Expression → Set Splat"). */
  label?: string;
  /**
   * Off is the card's mute (the ⊘ on its header, `muted` in the recipe): left out of the chain, kept in the
   * stack with all its settings. Saved specs and recipes from before muting keep working as they were.
   */
  on: boolean;
  /** The recipe node's params (its own keys). */
  params: Record<string, ParamValue>;
  /** Sweep one setting with a slow LFO (From → To → From), wired into its socket. */
  animate?: AnimateSpec | null;
}

export interface AnimateSpec { param: string; speed: number; from: number; to: number }

/** The sweep Animate starts with for a setting: a range that shows the effect well. */
export function animateFor(kind: StackKind, param = EFFECT_INFO[kind].main, speed = 0.1): AnimateSpec {
  const ranges: Record<string, [number, number]> = {
    amount: [0, 1], offset: [-1, 1], amplitude: [0, 0.12], hue: [-180, 180], size: [0.2, 1.4], dotSize: [0.6, 4], returnHome: [0, 1],
    saturation: [0, 2], brightness: [0.5, 2], opacity: [0.2, 1], keep: [0.1, 1], glow: [0, 10], spin: [-1, 1], tintAmount: [0, 1],
  };
  const [from, to] = ranges[param] ?? [0, 1];
  return { param, speed, from, to };
}

/** What a new effect of `kind` starts with: its node's defaults, nudged so it shows at once. */
export function effectDefaults(kind: StackKind): Record<string, ParamValue> {
  if (kind === 'custom') return {};
  const def = getNodeDefinition(EFFECT_TYPE[kind]);
  const out: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(def?.defaultParams ?? {})) {
    // Not settings: the load stamp; and Relative to the scan, which the builder always has on (build.ts).
    if (k.startsWith('_') || k === 'relative') continue;
    if (typeof v === 'number' || typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && v.length === 3) out[k] = [Number(v[0]), Number(v[1]), Number(v[2])];
  }
  const nudge: Partial<Record<StackKind, Record<string, ParamValue>>> = {
    dissolve: { amount: 0.35 },
    explode: { amount: 0.35 },
    wave: { amplitude: 0.05 },
    color: { saturation: 1.2 },
    crop: { offset: 0.2 },
    look: { size: 0.8 },
    points: { dotSize: 1.6 },
  };
  return { ...out, ...(nudge[kind] ?? {}) };
}

export function newEffect(kind: EffectKind, id: string, params: Record<string, ParamValue> = {}): EffectSpec {
  return { id, kind, on: true, params: { ...effectDefaults(kind), ...params }, animate: null };
}

/** A fresh effect id (`e1`, `e2`…). */
export function nextEffectId(effects: readonly EffectSpec[]): string {
  const used = new Set(effects.map(e => e.id));
  for (let i = 1; ; i++) if (!used.has(`e${i}`)) return `e${i}`;
}

/** The stack with `id` moved by `by` places (kept inside it). Pure. */
/** Mute or unmute one effect card (builders/mute.ts): off = left out of the chain. */
export function toggleEffectMute(effects: EffectSpec[], id: string): void {
  const e = effects.find(x => x.id === id);
  if (e) e.on = !e.on;
}

/** Alt/Option-click: solo one card (the others muted); again, every card back on. */
export function soloEffect(effects: EffectSpec[], id: string): void {
  const view = effects.map(e => ({ id: e.id, muted: !e.on }));
  soloIn(view, id);
  view.forEach((v, i) => { effects[i].on = !v.muted; });
}

export function moveEffect(effects: readonly EffectSpec[], id: string, by: number): EffectSpec[] {
  const out = [...effects];
  const i = out.findIndex(e => e.id === id);
  if (i < 0) return out;
  const j = Math.max(0, Math.min(out.length - 1, i + by));
  const [e] = out.splice(i, 1);
  out.splice(j, 0, e);
  return out;
}

/** The stack with `id` put before `beforeId` (null: at the end). Pure. */
export function placeEffect(effects: readonly EffectSpec[], id: string, beforeId: string | null): EffectSpec[] {
  const e = effects.find(x => x.id === id);
  if (!e || id === beforeId) return [...effects];
  const rest = effects.filter(x => x.id !== id);
  const at = beforeId ? rest.findIndex(x => x.id === beforeId) : -1;
  if (at < 0) return [...rest, e];
  rest.splice(at, 0, e);
  return rest;
}

// ── The world round the scan ────────────────────────────────────────────────

export const PROP_KINDS = ['sphere', 'box', 'torus', 'cylinder', 'capsule', 'octahedron'] as const;
export type PropKind = typeof PROP_KINDS[number];
export const PROP_LABELS: Record<PropKind, string> = { sphere: 'Ball', box: 'Box', torus: 'Ring', cylinder: 'Pillar', capsule: 'Pill', octahedron: 'Gem' };

export interface PropSpec { id: string; kind: PropKind; at: Vec3; size: number; color: Vec3 }

export const LIGHTS = ['studio', 'sunset', 'night', 'overcast'] as const;
export type LightKind = typeof LIGHTS[number];
export const LIGHT_INFO: Record<LightKind, { label: string; sunDir: Vec3; sunColor: Vec3; sky: Vec3; bounce: Vec3 }> = {
  studio: { label: 'Studio', sunDir: [0.5, 0.8, 0.4], sunColor: [1, 0.95, 0.88], sky: [0.35, 0.4, 0.5], bounce: [0.1, 0.1, 0.1] },
  sunset: { label: 'Sunset', sunDir: [-0.8, 0.25, 0.3], sunColor: [1.4, 0.7, 0.35], sky: [0.25, 0.25, 0.45], bounce: [0.15, 0.08, 0.05] },
  night: { label: 'Night', sunDir: [0.3, 0.9, -0.3], sunColor: [0.35, 0.45, 0.8], sky: [0.06, 0.08, 0.16], bounce: [0.02, 0.02, 0.04] },
  overcast: { label: 'Overcast', sunDir: [0.2, 1, 0.1], sunColor: [0.45, 0.46, 0.5], sky: [0.32, 0.34, 0.38], bounce: [0.1, 0.1, 0.1] },
};

export interface WorldSpec {
  /** Off: the scan alone over the background (no ray marching). */
  on: boolean;
  floor: { on: boolean; y: number; color: Vec3 };
  props: PropSpec[];
  light: LightKind;
  shadows: boolean;
  fog: number;
}

export interface BackgroundSpec {
  kind: 'solid' | 'gradient' | 'picture';
  color: Vec3;
  /** The bottom of a gradient. */
  color2: Vec3;
  /** A picture's name in `textures` (the shared picker). */
  picture: string | null;
}

export interface CameraSpec {
  dist: number;
  /** Degrees round Y. */
  angle: number;
  /** Degrees up. */
  elev: number;
  /** March Camera's lens (higher: narrower). */
  fov: number;
  /** Degrees a second round the scan (0: still). */
  turntable: number;
  target: Vec3;
}

export const TONES = ['none', 'aces', 'agx', 'oklab', 'hable'] as const;
export type Tone = typeof TONES[number];
export const TONE_LABELS: Record<Tone, string> = { none: 'As scanned', aces: 'ACES', agx: 'AgX', oklab: 'OkLab', hable: 'Filmic' };

export interface LookSpec {
  tone: Tone;
  bloom: { on: boolean; intensity: number; threshold: number; radius: number };
}

export interface SplatBuilderSpec {
  v: 1;
  scan: ScanSpec;
  place: PlaceSpec;
  effects: EffectSpec[];
  world: WorldSpec;
  background: BackgroundSpec;
  camera: CameraSpec;
  look: LookSpec;
  /** The pictures the scene reads (builders/textures.ts): the background picture. */
  textures?: TexSource[];
}

export const DEFAULT_PLACE: PlaceSpec = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, up: 'minusY', splatSize: 1, opacity: 1 };
export const DEFAULT_CAMERA: CameraSpec = { dist: 3.6, angle: 25, elev: 12, fov: 1.5, turntable: 0, target: [0, 0, 0] };
export const DEFAULT_WORLD: WorldSpec = { on: false, floor: { on: true, y: -1, color: [0.32, 0.33, 0.36] }, props: [], light: 'studio', shadows: true, fog: 0 };
export const DEFAULT_BACKGROUND: BackgroundSpec = { kind: 'gradient', color: [0.09, 0.1, 0.14], color2: [0.02, 0.02, 0.03], picture: null };
export const DEFAULT_LOOK: LookSpec = { tone: 'none', bloom: { on: false, intensity: 0.5, threshold: 0.8, radius: 32 } };

export function scanWithQuality(source: ScanSource, q: QualityPreset = 'balanced'): ScanSpec {
  const p = QUALITY_PRESETS[q];
  return { source, maxSplats: p.maxSplats, shDegree: p.shDegree, sort: p.sort, resolution: p.resolution };
}

/** Which preset the scan's quality settings are, if any. */
export function qualityOf(s: ScanSpec): QualityPreset | null {
  return QUALITY_KEYS.find(k => { const p = QUALITY_PRESETS[k]; return p.maxSplats === s.maxSplats && p.shDegree === s.shDegree && p.sort === s.sort && p.resolution === s.resolution; }) ?? null;
}

export const DEMO_SOURCE: ScanSource = { kind: 'demo', demo: 'blob', count: 150_000 };

/** What a new Splat builder opens with: the generated ball, turning a little, over a gradient. */
export function starterSplatScene(): SplatBuilderSpec {
  return {
    v: 1,
    scan: scanWithQuality({ ...DEMO_SOURCE }),
    place: { ...DEFAULT_PLACE, position: [...DEFAULT_PLACE.position], rotation: [...DEFAULT_PLACE.rotation] },
    effects: [],
    world: structuredClone(DEFAULT_WORLD),
    background: structuredClone(DEFAULT_BACKGROUND),
    camera: structuredClone(DEFAULT_CAMERA),
    look: structuredClone(DEFAULT_LOOK),
  };
}

/** A spec read from anywhere (a saved meta, a pasted recipe), with every part present. */
export function normalizeSpec(raw: Partial<SplatBuilderSpec> | null | undefined): SplatBuilderSpec {
  const base = starterSplatScene();
  if (!raw || typeof raw !== 'object') return base;
  const out: SplatBuilderSpec = {
    v: 1,
    scan: { ...base.scan, ...(raw.scan ?? {}) },
    place: { ...base.place, ...(raw.place ?? {}) },
    effects: Array.isArray(raw.effects) ? raw.effects.filter(e => e && ((EFFECT_KINDS as readonly string[]).includes(e.kind) || (e.kind === 'custom' && typeof e.tail === 'string'))).map(e => ({ ...e, params: { ...effectDefaults(e.kind), ...(e.params ?? {}) }, on: e.on !== false, animate: e.animate ?? null })) : [],
    world: { ...base.world, ...(raw.world ?? {}), floor: { ...base.world.floor, ...(raw.world?.floor ?? {}) }, props: Array.isArray(raw.world?.props) ? raw.world!.props : [] },
    background: { ...base.background, ...(raw.background ?? {}) },
    camera: { ...base.camera, ...(raw.camera ?? {}) },
    look: { ...base.look, ...(raw.look ?? {}), bloom: { ...base.look.bloom, ...(raw.look?.bloom ?? {}) } },
    ...(raw.textures?.length ? { textures: raw.textures } : {}),
  };
  return out;
}

// ── Words for the left nav ──────────────────────────────────────────────────

export const scanName = (s: ScanSource): string => (s.kind === 'file' ? s.fileName : s.demo === 'rings' ? 'Example: two rings' : 'Example: lumpy ball');
const r2 = (v: number) => Math.round(v * 100) / 100;
const count = (n: number) => (n >= 1e6 ? `${r2(n / 1e6)}M` : `${Math.round(n / 1e3)}k`);

export type SplatSection = 'scan' | 'place' | 'effects' | 'scene' | 'camera' | 'look';

export function sectionSummary(spec: SplatBuilderSpec, s: SplatSection): string {
  switch (s) {
    case 'scan': {
      const q = qualityOf(spec.scan);
      return `${scanName(spec.scan.source)} · ${q ? QUALITY_PRESETS[q].label : `${count(spec.scan.maxSplats)}, SH ${spec.scan.shDegree}`}`;
    }
    case 'place': {
      const p = spec.place;
      const turned = p.rotation.some(v => v !== 0) ? ` · turned ${p.rotation.map(r2).join(', ')}` : '';
      return `scale ${r2(p.scale)}${turned}${p.up === 'y' ? ' · +Y up' : ''}`;
    }
    case 'effects': {
      const on = spec.effects.filter(e => e.on);
      return on.length ? on.map(e => effectLabel(e)).join(' → ') : 'none yet';
    }
    case 'scene': {
      const bg = spec.background.kind === 'picture' ? 'picture background' : spec.background.kind === 'gradient' ? 'gradient' : 'solid background';
      if (!spec.world.on) return `just the scan · ${bg}`;
      const parts = [spec.world.floor.on ? 'floor' : '', spec.world.props.length ? `${spec.world.props.length} shape${spec.world.props.length === 1 ? '' : 's'}` : '', LIGHT_INFO[spec.world.light].label.toLowerCase()].filter(Boolean);
      return parts.join(', ');
    }
    case 'camera': {
      const c = spec.camera;
      return `${r2(c.dist)} away · ${Math.round(c.angle)}°${c.turntable ? ` · turntable ${r2(c.turntable)}°/s` : ''}`;
    }
    case 'look': {
      const l = spec.look;
      return `${TONE_LABELS[l.tone]}${l.bloom.on ? ` · bloom ${r2(l.bloom.intensity)}` : ''}`;
    }
  }
}

/** One line for an effect card while folded ("amount 0.35 · animated"). */
export function effectSummary(e: EffectSpec): string {
  if (e.kind === 'custom') return `${e.label || 'your own nodes'}${e.on ? '' : ' · muted'}`;
  const main = EFFECT_INFO[e.kind].main;
  const v = e.params[main];
  const label = getNodeDefinition(EFFECT_TYPE[e.kind])?.paramDefs?.[main]?.label ?? main;
  const val = typeof v === 'number' ? r2(v) : Array.isArray(v) ? v.map(r2).join(', ') : String(v ?? '');
  return `${label.toLowerCase()} ${val}${e.animate ? ' · animated' : ''}${e.on ? '' : ' · muted'}`;
}

/** A card's name: the effect's, or "Your nodes". */
export const effectLabel = (e: Pick<EffectSpec, 'kind'>) => EFFECT_INFO[e.kind].label;

/** The stack's "Your nodes" cards kept onto `effects` (a template or a surprise brings its own effects, never your nodes). */
export const keepCustom = (effects: EffectSpec[], from: readonly EffectSpec[]): EffectSpec[] => [...effects, ...from.filter(e => e.kind === 'custom').map(e => structuredClone(e))];
