/**
 * stripPresets.ts — the built-in presets each builder's strip offers (docs/scene-builder.md, "Your
 * presets"): at most MAX_STRIP_BUILT_INS, picked to be the most distinct; the rest of the strip is
 * your own presets. A builder whose strip follows a kind (Agents: the walker kind; Grid Rules: the
 * rule type) offers at most four for each kind, so the strip never shows more than four.
 *
 * The others are no longer offered, but they stay in their tables: an example, a saved graph or a
 * recipe that names one still loads it, and a preset that matches the scene still lights up.
 */
import type { WalkerKind } from '../agentRules/spec';
import type { GridRuleType } from '../gridRules/spec';

export const MAX_STRIP_BUILT_INS = 4;

/** 3D Scene builder: GI-lit room, volumetric orb, smooth blobs, glass. */
export const SCENE_STRIP_KEYS = ['room', 'orb', 'blobs', 'glass'] as const;
/** 2D Scene builder: glow and repetition, motion, symmetry, a grid. */
export const SCENE2D_STRIP_KEYS = ['kaleidoscope', 'orbits', 'mirror', 'pixel'] as const;
/** Grid builder: a drawing, a ripple, travelling cells, a warped grid. */
export const GRID_STRIP_KEYS = ['hearts', 'pond', 'traffic', 'weave'] as const;
/** Splat builder: show it, dissolve it, blow it apart, restyle it. */
export const SPLAT_STRIP_KEYS = ['turntable', 'dissolve', 'exploded', 'hologram'] as const;
/** Time Cube builder: the box, frames lifted out, light trails, a ring of cards. */
export const TIMECUBE_STRIP_KEYS = ['box', 'highlights', 'exposure', 'ring'] as const;
/** Warp builder: none (its built-in blocks are in its Library card). */
export const WARP_STRIP_KEYS = [] as const;
/** Texture Lab (textureLab/presets.ts): all four of its built-ins. */
export const TEXTURE_STRIP_KEYS = ['thermal', 'ink', 'trails', 'relief'] as const;

/** Agents builder, by walker kind. */
export const AGENT_STRIP_KEYS: Record<WalkerKind, readonly string[]> = {
  trail: ['slime', 'veins', 'cells', 'dla'],
  ants: ['slime', 'veins', 'cells', 'dla'],
  particles: ['particles', 'smoke', 'snow', 'burst'],
  flock: ['boids', 'streams', 'balls', 'murmuration'],
  crowd: ['crowd', 'door', 'crossing'],
  swarm: ['swarm', 'galaxy', 'opposite', 'moths'],
};

/** Grid Rules builder, by rule type. */
export const GRID_RULES_STRIP_KEYS: Record<GridRuleType, readonly string[]> = {
  count: ['life', 'seeds', 'maze', 'caves'],
  stages: ['briansBrain', 'starWars', 'spirals', 'lava'],
  smooth: ['ripples', 'mitosis', 'worms', 'maze'],
  patterns: ['wireworld', 'fallingDots', 'crystal'],
  blocks: ['sand', 'gas'],
};

/** The offered ones of a list, in the strip's order (unknown keys skipped, at most four). */
export function stripOf<T extends { key: string }>(all: readonly T[], keys: readonly string[]): T[] {
  return keys.map(k => all.find(t => t.key === k)).filter((t): t is T => !!t).slice(0, MAX_STRIP_BUILT_INS);
}

/** The same for a table keyed by id (Grid Rules' preset tables). */
export function stripOfTable<T>(table: Record<string, T>, keys: readonly string[]): Array<[string, T]> {
  return keys.filter(k => k in table).slice(0, MAX_STRIP_BUILT_INS).map(k => [k, table[k]] as [string, T]);
}
