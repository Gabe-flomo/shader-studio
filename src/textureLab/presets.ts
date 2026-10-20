/**
 * presets.ts — Texture Lab's built-in stacks and Surprise me (docs/texture-lab.md). A preset is a stack of blocks with
 * their settings; your source (the photo, the clip, your picture) stays. Surprise me picks a few blocks from a seed and
 * varies them inside ranges that read well on any picture, keeping the stack cheap (a few passes at most). Pure.
 */
import { makeRng, harmoniousPalette, type Rng } from '../lib/surprise';
import { curvesParams, curvesPresetParams, CURVES_PRESETS } from '../nodes/definitions/curves';

/** A heat camera's colours as three tone curves: on a grey picture, Curves is a gradient map (dark purple → red → yellow → white). */
const THERMAL_CURVES = curvesParams({
  r: [[0, 0.02], [0.25, 0.32], [0.5, 0.95], [0.75, 1], [1, 1]],
  g: [[0, 0], [0.4, 0.06], [0.6, 0.3], [0.8, 0.68], [1, 1]],
  b: [[0, 0.12], [0.25, 0.7], [0.5, 0.35], [0.75, 0.06], [1, 0.85]],
});
import { blockDef } from './blocks';
import { defsOf, newBlock, type Params, type TextureLabSpec, type TxBlock } from './spec';

export interface TxPresetBlock { type: string; params?: Params; view?: string; amount?: number; aux?: Record<string, Params> }

export interface TxPreset {
  key: string;
  label: string;
  blurb: string;
  blocks: TxPresetBlock[];
  /** Reads best on a moving picture. */
  video?: boolean;
}

export const TX_PRESETS: readonly TxPreset[] = [
  {
    key: 'thermal', label: 'Thermal', blurb: 'A heat camera: softened, its brightness through hot colours (Curves as a gradient map), the hottest glowing.',
    blocks: [
      { type: 'blurTexture', params: { radius: 4 } },
      { type: 'channelPick', params: { channel: 'bright', shape: 'remap', inLow: 0.03, inHigh: 0.7 } },
      { type: 'curves', params: THERMAL_CURVES },
      { type: 'glowTexture', params: { threshold: 0.75, intensity: 0.9, radius: 18 } },
    ],
  },
  {
    key: 'ink', label: 'Ink outline', blurb: 'Edges drawn in black ink on white paper.',
    blocks: [
      { type: 'edgesTexture', view: 'edges', params: { strength: 2.4, width: 1.25 } },
      { type: 'textureLevels', params: { outBlack: 1, outWhite: 0, gamma: 0.7, clamp: true } },
      { type: 'threshold', params: { level: 0.42, softness: 0.3, colorOut: 'bw' } },
    ],
  },
  {
    key: 'trails', label: 'Motion trails', blurb: 'What moves leaves a fading trail that drifts outwards. Best on a video.', video: true,
    blocks: [
      { type: 'textureChange', view: 'color', params: { measure: 'colour', amount: 6, level: 0.06 } },
      { type: 'textureFeedback', params: { tail: 1.6, zoom: 1.008, turn: 0.4, tint: [0.6, 0.85, 1] } },
      { type: 'textureLevels', params: { gain: 1.5, rollOff: 0.5 } },
    ],
  },
  {
    key: 'relief', label: 'Relief', blurb: 'The picture as a carved relief, lit by a low sun.',
    blocks: [
      { type: 'heightLight', params: { channel: 'bright', relief: 0.07, sunAngle: 135, sunHeight: 32, ambient: 0.4, spacing: 2.5 } },
      { type: 'curves', params: curvesPresetParams('contrast') ?? {} },
    ],
  },
];

/** The spec with a preset's blocks (your source stays). */
export function withPreset(spec: TextureLabSpec, key: string): TextureLabSpec {
  const p = TX_PRESETS.find(x => x.key === key);
  if (!p) return spec;
  const next: TextureLabSpec = { ...spec, blocks: [] };
  for (const b of p.blocks) {
    const block = newBlock(next, b.type, { ...(b.view ? { view: b.view } : {}), ...(b.amount !== undefined ? { amount: b.amount } : {}), ...(b.aux ? { aux: structuredClone(b.aux) } : {}) });
    block.params = { ...block.params, ...structuredClone(b.params ?? {}) };
    next.blocks.push(block);
  }
  return next;
}

/** The preset the stack is now (its block types, in order), or null. */
export function presetNow(spec: TextureLabSpec): string | null {
  const key = spec.blocks.map(b => b.type).join(',');
  return TX_PRESETS.find(p => p.blocks.map(b => b.type).join(',') === key)?.key ?? null;
}

// ── Surprise me ──────────────────────────────────────────────────────────────

/** Blocks Surprise me picks from, by weight: none needs a download, and each shows on a still picture. */
const POOL: ReadonlyArray<readonly [string, number]> = [
  ['blurTexture', 1], ['glowTexture', 3], ['edgesTexture', 3], ['textureNeighbours', 2], ['distanceShape', 2],
  ['readTexture', 2], ['displaceTexture', 2], ['displacementMap', 2], ['textureFlow', 2], ['heightLight', 2],
  ['dofTexture', 1], ['tiltShiftTexture', 1], ['chromaLens', 3], ['radialFastBlur', 2],
  ['textureMask', 1], ['textureLevels', 2], ['curves', 3], ['threshold', 1], ['channelColours', 2],
];
/** On a video, motion too. */
const VIDEO_POOL: ReadonlyArray<readonly [string, number]> = [['textureFeedback', 3], ['textureChange', 2], ['cache', 1]];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A block's numbers moved a little (inside their slider ranges), its colours from one palette. */
function vary(rng: Rng, b: TxBlock, colours: number[][]): void {
  const defs = defsOf(b.type);
  const start = blockDef(b.type)?.start ?? {};
  for (const [k, v] of Object.entries(start)) {
    const pd = defs[k];
    if (!pd) continue;
    if (typeof v === 'number' && (pd.type === 'float' || pd.type === 'int')) {
      const lo = pd.min ?? -Infinity, hi = pd.max ?? Infinity;
      const f = rng.float(0.6, 1.6);
      // A zoom near 1 varies how far it is from 1, not itself.
      const x = v === 0 ? v : k === 'zoom' ? 1 + (v - 1) * f : v * f;
      b.params[k] = pd.type === 'int' ? Math.round(Math.max(lo, Math.min(hi, x))) : r3(Math.max(lo, Math.min(hi, x)));
    } else if (pd.type === 'vec3color' && colours.length) b.params[k] = colours[rng.int(0, colours.length - 1)].map(r3);
  }
  if (b.type === 'curves') Object.assign(b.params, curvesPresetParams(rng.pick(CURVES_PRESETS.filter(p => p.value !== 'linear' && p.value !== 'invert').map(p => p.value))) ?? {});
  if (b.type === 'distanceShape') b.params.mode = rng.pick(['outline', 'glow', 'rings']);
  if (b.type === 'textureNeighbours') b.params.mode = rng.pick(['max', 'min', 'range', 'average']);
  if (b.type === 'radialFastBlur') b.params.mode = rng.pick(['brightest', 'average', 'add']);
  const def = blockDef(b.type);
  if (def && def.views.length > 1 && rng.chance(0.3)) b.view = rng.pick(def.views).id;
  if (rng.chance(0.25)) b.amount = r3(rng.float(0.55, 0.9));
}

/**
 * A stack from `seed`: 2–4 blocks, varied. `passesOf` says how many passes a stack would use (the actions build it to
 * count); a block that would take it past 4 is left out. Your source stays.
 */
export function surpriseTextureLab(seed: number, spec: TextureLabSpec, passesOf: (s: TextureLabSpec) => number = () => 0): TextureLabSpec {
  const rng = makeRng(seed);
  const pool = spec.source.kind === 'ball' ? [...POOL, ...VIDEO_POOL] : POOL;
  const colours = harmoniousPalette(rng.fork('colour'), 3, { light: [0.55, 0.75] });
  const next: TextureLabSpec = { ...spec, blocks: [] };
  const want = rng.int(2, 4);
  const used = new Set<string>();
  for (let tries = 0; next.blocks.length < want && tries < 20; tries++) {
    const type = rng.weighted(pool.filter(([t]) => !used.has(t)) as Array<readonly [string, number]>);
    used.add(type);
    const b = newBlock(next, type);
    vary(rng.fork(`${type}:${next.blocks.length}`), b, colours);
    const trial = { ...next, blocks: [...next.blocks, b] };
    if (passesOf(trial) > 4) continue;
    next.blocks.push(b);
  }
  return next;
}
