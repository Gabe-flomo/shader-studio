/**
 * spec.ts — a Texture Lab build (docs/texture-lab.md): a source picture and a stack of blocks applied top to bottom.
 *
 *   source  the built-in Room and cat or Walkway cat photo, the Ball action clip, or a node of the graph (a picture
 *           you uploaded, a Texture or Shader Texture, or what the Output showed when Texture Lab opened);
 *   blocks  each one Texture tools node (blocks.ts) with its own settings, which of its outputs is shown (`view`),
 *           an Amount (1 is the block's result, 0 the picture as it came in) and, once muted, `muted`.
 *
 * Every setting is a param of a real node, so the spec keeps the main node's params as they are. Pure.
 */
import { getNodeDefinition } from '../nodes/definitions';
import type { ParamDef } from '../types/nodeGraph';
import { isParamVisible } from '../compiler/uniformPatcher';
import { BUILTIN_IMAGES, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';
import { BLOCKS, blockDef, viewOf, type Params } from './blocks';

export type { Params };

export type TxSourceKind = 'room' | 'walkway' | 'ball' | 'node';

export interface TxSource {
  kind: TxSourceKind;
  /** `node`: the graph node read (anything with a texture output, or the node that fed the Output). */
  nodeId?: string;
  /** `node`: its output read as the picture (`texture` when it has one). */
  output?: string;
  /** `node`: what to call it. */
  name?: string;
  /** A built-in source's own node params as the graph has them (a video's playback, a picture's fit). */
  params?: Params;
}

export interface TxBlock {
  /** Stable in the build ("b1", "b2"…): its nodes' roles start with it. */
  id: string;
  type: string;
  params: Params;
  /** 0 the picture as it came in, 1 the block's result (a Mix's Blend). */
  amount: number;
  /** Which output shows (blocks.ts views); absent: the first. */
  view?: string;
  /** Absent: never muted (no gate). */
  muted?: boolean;
  /** Settings of a helper node, by its role ("seed": a jump flood's Mask). */
  aux?: Record<string, Params>;
}

export interface TextureLabSpec {
  v: 1;
  source: TxSource;
  blocks: TxBlock[];
}

/** Keys the builder keeps on nodes for itself. */
export const TX_ROLE = '_txRole';
export const TX_BUILD = '_txBuild';
export const TX_META = 'textureLab';
const OWN_KEYS = new Set(['__comment', TX_ROLE, TX_BUILD, TX_META, '__mute', '__muteFrom', '__muteTo', 'label']);
/** A node's params as the spec keeps them (its note and the builder's keys taken off). */
export const specParams = (p: Params): Params => Object.fromEntries(Object.entries(p).filter(([k]) => !OWN_KEYS.has(k) && !k.startsWith('_fold')));

export const defaultsOf = (type: string): Params => structuredClone(getNodeDefinition(type)?.defaultParams ?? {}) as Params;
export const defsOf = (type: string): Record<string, ParamDef> => getNodeDefinition(type)?.paramDefs ?? {};
export const visibleNow = (pd: ParamDef, params: Params, type: string) => isParamVisible(pd, params, defaultsOf(type));

/** The next free block id. */
export function nextBlockId(spec: Pick<TextureLabSpec, 'blocks'>): string {
  let i = spec.blocks.length + 1;
  const taken = new Set(spec.blocks.map(b => b.id));
  while (taken.has(`b${i}`)) i++;
  return `b${i}`;
}

/** A new block of `type`, with the settings it starts with. */
export function newBlock(spec: Pick<TextureLabSpec, 'blocks'>, type: string, over: Partial<TxBlock> = {}): TxBlock {
  const def = blockDef(type);
  return { id: nextBlockId(spec), type, params: { ...defaultsOf(type), ...structuredClone(def?.start ?? {}) }, amount: 1, ...over };
}

export function blankSpec(source: TxSource = { kind: 'room' }): TextureLabSpec {
  return { v: 1, source, blocks: [] };
}

/** Fill in what an older or partial spec lacks; drop blocks of types Texture Lab doesn't know. */
export function normalizeSpec(s: Partial<TextureLabSpec> | null | undefined): TextureLabSpec {
  const src = s?.source && typeof s.source === 'object' ? s.source : { kind: 'room' as const };
  const kind: TxSourceKind = (['room', 'walkway', 'ball', 'node'] as const).includes(src.kind) ? src.kind : 'room';
  const blocks: TxBlock[] = [];
  const seen = new Set<string>();
  for (const b of Array.isArray(s?.blocks) ? s!.blocks : []) {
    if (!b || !blockDef(b.type)) continue;
    let id = typeof b.id === 'string' && b.id && !seen.has(b.id) ? b.id : '';
    if (!id) { let i = blocks.length + 1; while (seen.has(`b${i}`)) i++; id = `b${i}`; }
    seen.add(id);
    blocks.push({
      id, type: b.type, params: { ...defaultsOf(b.type), ...(b.params ?? {}) },
      amount: typeof b.amount === 'number' && Number.isFinite(b.amount) ? b.amount : 1,
      ...(typeof b.view === 'string' ? { view: b.view } : {}),
      ...(typeof b.muted === 'boolean' ? { muted: b.muted } : {}),
      ...(b.aux && typeof b.aux === 'object' ? { aux: structuredClone(b.aux) } : {}),
    });
  }
  return { v: 1, source: { ...src, kind }, blocks };
}

// ── Names and summaries ──────────────────────────────────────────────────────

export const SOURCE_NAMES: Record<Exclude<TxSourceKind, 'node'>, string> = {
  room: BUILTIN_IMAGES[ROOM_AND_CAT_ID].name, walkway: BUILTIN_IMAGES[WALKWAY_CAT_ID].name, ball: 'Ball action',
};

export function sourceName(s: TxSource): string {
  return s.kind === 'node' ? (s.name || 'A picture in the graph') : SOURCE_NAMES[s.kind];
}

export const blockLabel = (b: Pick<TxBlock, 'type'>): string => blockDef(b.type)?.label ?? b.type;

/** "Edges · lines · 80%". */
export function blockSummary(b: TxBlock): string {
  const def = blockDef(b.type);
  if (!def) return b.type;
  const parts: string[] = [];
  if (def.views.length > 1) parts.push(viewOf(def, b.view).label.toLowerCase());
  if (b.amount < 0.995) parts.push(`${Math.round(b.amount * 100)}%`);
  if (b.muted) parts.push('muted');
  return parts.join(' · ');
}

/** The whole stack in a line: "Room and cat → Edges → Levels". */
export function stackLine(spec: TextureLabSpec): string {
  return [sourceName(spec.source), ...spec.blocks.map(b => blockLabel(b) + (b.muted ? ' (muted)' : ''))].join(' → ');
}

/** Every block type, in the menu's order (for tests and Surprise me). */
export const BLOCK_TYPES: readonly string[] = BLOCKS.map(b => b.type);
