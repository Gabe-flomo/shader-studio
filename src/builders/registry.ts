/**
 * registry.ts — the builders, as the node browser's Builders section shows them
 * (docs/node-browser.md, "Builders"): the 3D and 2D Scene Builders, Grid Rules, Agent Rules and the
 * 3D Agent Builder (Agent Rules in a volume, seen through a camera) and the Expression Builder (an
 * expression grown move by move from UV, a world position or time). Each is a window that writes a
 * graph for you from a form, a few lines of text or a few clicks.
 *
 * The section, the empty-canvas right-click menu and the Do… bar ("new 3d scene", "new grid
 * rules"…) all read this list, and builders/open.ts opens them. Pure: no store here.
 */
import type { IconName } from '../components/ui/iconPaths';

export type BuilderId = 'scene' | 'scene2d' | 'grid' | 'agents' | 'agents3d' | 'expr';

export interface BuilderInfo {
  id: BuilderId;
  title: string;
  icon: IconName;
  /** One line on what the builder is. */
  description: string;
  /** What you can make with it. */
  makes: string;
  /** What clicking it does. */
  action: string;
  /** Words the node browser's search finds it by (with the title, description and makes). */
  keywords: string[];
}

export const BUILDERS: readonly BuilderInfo[] = [
  {
    id: 'scene', title: '3D Scene Builder', icon: 'cube',
    description: '3D scenes from a form or a recipe',
    makes: 'shapes, combine, bend space, look, outputs',
    action: 'Opens the builder on a new scene',
    keywords: ['builder', 'builders', 'scene', '3d', 'raymarch', 'sdf', 'recipe'],
  },
  {
    id: 'scene2d', title: '2D Scene Builder', icon: 'mask',
    description: '2D pictures from a form or a recipe',
    makes: 'shapes, rings of rings, kaleidoscopes, motion, glow',
    action: 'Opens the builder on a new 2D scene',
    keywords: ['builder', 'builders', 'scene', '2d', 'flat', 'shapes', 'sdf', 'kaleidoscope', 'recipe'],
  },
  {
    id: 'grid', title: 'Grid Rules', icon: 'grid',
    description: 'Cellular automata in one node',
    makes: 'Life, sand, heat, waves, Wireworld…',
    action: 'Adds a Grid Rules node and opens its editor',
    keywords: ['builder', 'builders', 'rules', 'grid', 'cellular', 'automaton', 'automata', 'cells', 'simulation'],
  },
  {
    id: 'agents', title: 'Agent Rules', icon: 'swarm',
    description: 'Walkers that follow When … Do …',
    makes: 'slime, ants, flocks, infection…',
    action: 'Adds an Agents group in rules mode and opens its rules',
    keywords: ['builder', 'builders', 'rules', 'agents', 'agent', 'walkers', 'boids', 'when do'],
  },
  {
    id: 'agents3d', title: '3D Agent Builder', icon: 'swarm',
    description: 'Walkers in a volume, seen through a camera',
    makes: '3D slime, 3D flocks, orbiting swarms, curl smoke…',
    action: 'Adds 3D agents (Ball Emit, volume Trail, orbiting camera) and opens their rules',
    keywords: ['builder', 'builders', 'agents', 'agent', '3d', 'volume', 'swarm', 'flock', 'orbit', 'camera', 'depth'],
  },
  {
    id: 'expr', title: 'Expression Builder', icon: 'expr',
    description: 'An expression grown one move at a time',
    makes: 'repeats, folds, warps, distances, colour from space',
    action: 'Opens the builder on UV; Add to graph makes an Expression Block',
    keywords: ['builder', 'builders', 'expression', 'expressions', 'glsl', 'code', 'moves', 'formula', 'math', 'uv', 'warp', 'fold', 'repeat'],
  },
];

export const builderInfo = (id: BuilderId): BuilderInfo => BUILDERS.find(b => b.id === id)!;

/** The builders a search finds: every word of the query is in the builder's text, or starts one of its words. */
export function matchBuilders(query: string): BuilderInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...BUILDERS];
  return BUILDERS.filter(b => {
    const hay = [b.title, b.description, b.makes, ...b.keywords].join(' ').toLowerCase();
    const keys = hay.split(/[^a-z0-9]+/).filter(Boolean);
    // Short words must be whole words ("3d"), so typing one letter doesn't bring up every builder.
    return words.every(w => (w.length < 3 ? keys.includes(w) : keys.some(k => k.startsWith(w)) || hay.includes(w)));
  });
}
