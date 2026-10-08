import type { GraphNode, NodeDefinition, ParamDef, SubgraphData, SurfacedParam } from '../types/nodeGraph';
import { getNodeDefinitionFor } from './definitions';
import { hasCustomRange, paramSliderRange } from './sliderRange';
import { isParamVisible } from '../compiler/uniformPatcher';
import { isKeyframeBypassed, socketHasKeyframes } from '../compiler/keyframes';
import { hslToRgb, interestingRange, makeRng, neverRandomise, type Interesting } from '../lib/surprise';
import { DEFAULT_RANDOMIZE_OPTIONS, type RandomizeOptions } from './randomizeOptions';

/**
 * New random values for a node's settings (the node card's 🎲 Randomize and, per node, the canvas dice).
 *
 * - Every visible float/int slider not driven by a wire or by keyframes gets a value moved toward a
 *   random target in its *interesting* range (lib/surprise/ranges.ts: the part of the legal range
 *   that looks good, by the param's name, else a band round its default), always inside the range
 *   the card shows. A range the user typed (a typed max, both ways) is theirs: the whole of it is
 *   the target range. A slider with no declared range (Constant, matrix cells, …) uses −1 → 1. Bit
 *   masks and counters (lib/surprise neverRandomise) are always left alone.
 * - Strength (options.strength, 0–1): the value moves from the current one toward the target by
 *   0.05 + 0.95 × strength of the way (in log space for settings the ranges table says are
 *   log-scaled). 0 = a small nudge, 1 = the target itself, anywhere in the interesting range.
 * - vec3 params: each unwired component likewise; colours move toward a pleasant colour
 *   (saturation 0.45–0.9, lightness 0.35–0.7) and are skipped when options.colours is off.
 * - Choices (menus, switches) are left alone unless options.includeChoices.
 * - Values snap to the slider's step (whole numbers stay whole).
 * - Keys listed in `node.params.__randExclude` (locked: 🔒 on the row, or unticked in the die's
 *   right-click list) are never changed.
 * - `weightOf(key)` (Focus): a 0–1 measure of how much the setting changes the picture. Dead
 *   settings (< 0.03) are left alone; the rest move by a share of the strength that grows with it.
 */
export function randomizedParams(
  node: GraphNode, def: NodeDefinition, rand: () => number = Math.random,
  opts: RandomizeOptions = DEFAULT_RANDOMIZE_OPTIONS, weightOf?: WeightOf,
): Record<string, unknown> {
  if (node.type === 'group') return randomizedGroupOverrides(node, rand, opts, weightOf);
  const out: Record<string, unknown> = {};
  const wired = (key: string) => !!node.inputs[key]?.connection || !!node.inputs[`__param_${key}`]?.connection;
  const keyframed = (key: string) => socketHasKeyframes(node, key) && !isKeyframeBypassed(node, key);

  const excluded = new Set(randomizeExcluded(node));
  for (const [key, pd] of Object.entries(def.paramDefs ?? {})) {
    if (!isParamVisible(pd, node.params, def.defaultParams) || wired(key) || keyframed(key) || excluded.has(key) || neverRandomise(key)) continue;
    const t = moveShare(opts, weightOf?.(key));
    if (t === null) continue;
    if (pd.type === 'float' || pd.type === 'int') {
      const [lo, hi] = floatRange(node, key, pd);
      const nice = niceRange(node, key, pd, lo, hi, def.defaultParams?.[key]);
      out[key] = pickIn(lo, hi, nice, node.params[key], t, rand, pd);
    } else if (pd.type === 'vec3color' && opts.colours && !['r', 'g', 'b'].some(c => wired(`${key}_${c}`))) {
      const cur = Array.isArray(node.params[key]) ? node.params[key] as number[] : [0.5, 0.5, 0.5];
      const target = hslToRgb(rand(), 0.45 + rand() * 0.45, 0.35 + rand() * 0.35);
      out[key] = t >= 1 ? target : target.map((c, i) => (typeof cur[i] === 'number' ? cur[i] + (c - cur[i]) * t : c));
    } else if (pd.type === 'vec3' || (pd.type === 'vec3color' && opts.colours)) {
      const cur = Array.isArray(node.params[key]) ? node.params[key] as number[] : [0, 0, 0];
      const [lo, hi] = pd.type === 'vec3color' ? [0, 1] : pd.min !== undefined || pd.max !== undefined ? [pd.min ?? -1, pd.max ?? 1] : [-1, 1];
      const nice: Interesting = { lo, hi, log: false, int: false, source: 'legal' };
      out[key] = ['r', 'g', 'b'].map((c, i) => (wired(`${key}_${c}`) ? cur[i] ?? 0 : pickIn(lo, hi, nice, cur[i], t, rand, pd)));
    } else if (opts.includeChoices && (pd.type === 'select' || pd.type === 'bool')) {
      const next = pickChoice(pd, node.params[key] ?? def.defaultParams?.[key], t, rand);
      if (next !== undefined) out[key] = next;
    }
  }
  return out;
}

/** A choice setting: with chance `t` another option (or the other way for a switch); else undefined (unchanged). */
function pickChoice(pd: ParamDef, current: unknown, t: number, rand: () => number): unknown {
  if (pd.type === 'bool') return rand() < t ? !current : undefined;
  const others = (pd.options ?? []).map(o => o.value).filter(v => v !== current);
  if (!others.length) return undefined;
  const u = rand(), v = rand();
  return u < t ? others[Math.min(others.length - 1, Math.floor(v * others.length))] : undefined;
}

/** Weight lookup for a setting key on one node (Focus); undefined when not measured. */
export type WeightOf = (key: string) => number | undefined;

/** Settings measured as changing less than this are left alone by Focus. */
export const DEAD_WEIGHT = 0.03;

/**
 * How far toward its target a setting moves, 0–1: the strength mapped to 0.05…1, scaled down for
 * settings that matter little when a Focus weight is given. Null: leave the setting alone.
 */
export function moveShare(opts: RandomizeOptions, weight?: number): number | null {
  const base = 0.05 + 0.95 * Math.min(1, Math.max(0, opts.strength));
  if (weight === undefined) return base;
  if (weight < DEAD_WEIGHT) return null;
  return base * (0.25 + 0.75 * Math.min(1, weight));
}

/**
 * The part of a slider's range Randomize lands in: the whole range the user typed, else the
 * interesting range for its name (lib/surprise), cut to the card's range.
 */
function niceRange(node: GraphNode, key: string, pd: ParamDef, lo: number, hi: number, def: unknown): Interesting {
  const custom = hasCustomRange(node.params, key) || node.params[`__scBidir_${key}`] === true || (pd.min === undefined && pd.max === undefined);
  const r = custom ? null : interestingRange(key, { min: lo, max: hi, step: pd.step, def: typeof def === 'number' ? def : undefined, int: pd.type === 'int' }, node.type);
  return r ?? { lo, hi, log: false, int: pd.type === 'int', source: 'legal' };
}

/**
 * A random target in the nice range (log-spread when it says so), then the current value moved
 * `t` of the way toward it (in log space for a log range); inside [lo, hi].
 */
function pickIn(lo: number, hi: number, nice: Interesting, current: unknown, t: number, rand: () => number, pd: ParamDef): number {
  const nlo = Math.max(lo, Math.min(hi, nice.lo)), nhi = Math.max(nlo, Math.min(hi, nice.hi));
  const u = rand();
  const useLog = nice.log && nlo > 0;
  const target = useLog ? Math.exp(Math.log(nlo) + u * (Math.log(nhi) - Math.log(nlo))) : nlo + u * (nhi - nlo);
  if (t >= 1 || typeof current !== 'number' || !Number.isFinite(current)) return clampSnap(target, lo, hi, pd);
  const v = useLog && current > 0
    ? Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * t)
    : current + (target - current) * t;
  return clampSnap(v, lo, hi, pd);
}

function clampSnap(v: number, lo: number, hi: number, pd: ParamDef): number {
  const s = snap(v, pd);
  return Math.min(hi, Math.max(lo, s));
}

/** What Randomize did to a setting, for the toast (biggest measured effect first). */
export interface RandomChange { label: string; weight?: number }

/** Skip a whole node (and, for a group, everything inside it) in Randomize all. */
export const isNodeSkipped = (node: GraphNode): boolean => node.params.__randSkip === true;

const nodeLabel = (n: GraphNode): string => (typeof n.params.label === 'string' && n.params.label ? n.params.label : getNodeDefinitionFor(n)?.label ?? n.type);

/** The weight key of a setting: the binding key `${nodeId}::${paramKey}` (a group's face rows already are one). */
export const weightKey = (nodeId: string, key: string): string => `${nodeId}::${key}`;

type Rng = ReturnType<typeof makeRng>;

/**
 * Randomise all settings in a graph level (the toolbar's dice): every node's free settings, as its
 * card's Randomize would, from one seed (each node its own stream, so adding a node elsewhere
 * doesn't change the others). `nodes` is one level (top level, or a group's inside). Group faces
 * and group insides are in only when the options say so; locked settings and skipped nodes never
 * change. `weights` (Focus) maps weightKey → 0–1. Returns the new list, how many settings changed
 * and what they were.
 */
export function randomizedGraph(
  nodes: GraphNode[], seed: number, opts: RandomizeOptions = DEFAULT_RANDOMIZE_OPTIONS, weights?: Record<string, number> | null,
): { nodes: GraphNode[]; changed: number; changes: RandomChange[] } {
  const changes: RandomChange[] = [];
  const withPatch = (n: GraphNode, def: NodeDefinition | undefined, stream: Rng, face: boolean): GraphNode => {
    if (!def && !face) return n;
    const weightOf: WeightOf | undefined = opts.focus && weights ? k => weights[face ? k : weightKey(n.id, k)] : undefined;
    const patch = randomizedParams(n, def ?? ({} as NodeDefinition), stream.next, opts, weightOf);
    const keys = Object.keys(patch).filter(k => JSON.stringify(patch[k]) !== JSON.stringify(n.params[k]));
    if (!keys.length) return n;
    for (const k of keys) changes.push({ label: `${nodeLabel(n)} · ${def?.paramDefs?.[k]?.label ?? k.split('::').pop() ?? k}`, weight: weightOf?.(k) });
    const params = { ...n.params, ...Object.fromEntries(keys.map(k => [k, patch[k]])) };
    // A group's override keys also go into the nodes inside it, as editing the card does (the store's updateNodeParams).
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (face && sg && Array.isArray(sg.nodes)) {
      params.subgraph = {
        ...sg,
        nodes: sg.nodes.map(sn => {
          const mine = keys.filter(k => k.slice(0, k.indexOf('::')) === sn.id);
          return mine.length ? { ...sn, params: { ...sn.params, ...Object.fromEntries(mine.map(k => [k.slice(k.indexOf('::') + 2), patch[k]])) } } : sn;
        }),
      };
    }
    return { ...n, params };
  };
  const walk = (level: GraphNode[], rng: Rng): GraphNode[] => level.map(n => {
    if (isNodeSkipped(n)) return n;
    const stream = rng.fork(n.id);
    if (n.type !== 'group') return withPatch(n, getNodeDefinitionFor(n), stream, false);
    let node = n;
    if (opts.groupFace) node = withPatch(node, getNodeDefinitionFor(n), stream.fork('face'), true);
    const sg = node.params.subgraph as SubgraphData | undefined;
    if (opts.insideGroups && sg && Array.isArray(sg.nodes)) {
      node = { ...node, params: { ...node.params, subgraph: { ...sg, nodes: walk(sg.nodes, stream.fork('inside')) } } };
    }
    return node;
  });
  const out = walk(nodes, makeRng(seed));
  if (opts.focus && weights) changes.sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5));
  return { nodes: out, changed: changes.length, changes };
}

/** Everything locked in a graph (recursing into groups): whole nodes and single settings. */
export interface LockedItem { nodeId: string; path: string[]; key?: string; label: string }
export function lockedItems(nodes: readonly GraphNode[], path: string[] = []): LockedItem[] {
  const out: LockedItem[] = [];
  for (const n of nodes) {
    const name = nodeLabel(n);
    if (isNodeSkipped(n)) out.push({ nodeId: n.id, path, label: `${name} (whole node)` });
    const defs = getNodeDefinitionFor(n)?.paramDefs;
    for (const k of randomizeExcluded(n)) out.push({ nodeId: n.id, path, key: k, label: `${name} · ${defs?.[k]?.label ?? k.split('::').pop() ?? k}` });
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (n.type === 'group' && sg && Array.isArray(sg.nodes)) out.push(...lockedItems(sg.nodes, [...path, n.id]));
  }
  return out;
}

/** The graph with one lock (a setting, or a whole node when `item.key` is unset) removed. */
export function withoutLock(nodes: GraphNode[], item: LockedItem): GraphNode[] {
  return nodes.map(n => {
    if (item.path.length === 0) {
      if (n.id !== item.nodeId) return n;
      const { __randExclude, __randSkip, ...rest } = n.params;
      if (item.key === undefined) return { ...n, params: __randExclude === undefined ? rest : { ...rest, __randExclude } };
      const left = randomizeExcluded(n).filter(k => k !== item.key);
      return { ...n, params: { ...rest, ...(__randSkip === true ? { __randSkip } : {}), ...(left.length ? { __randExclude: left } : {}) } };
    }
    if (n.id !== item.path[0]) return n;
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (!sg || !Array.isArray(sg.nodes)) return n;
    return { ...n, params: { ...n.params, subgraph: { ...sg, nodes: withoutLock(sg.nodes, { ...item, path: item.path.slice(1) }) } } };
  });
}

/** The graph with every lock removed (settings and whole nodes), groups included. */
export function withoutLocks(nodes: GraphNode[]): GraphNode[] {
  return nodes.map(n => {
    let params = n.params;
    if (params.__randExclude !== undefined || params.__randSkip !== undefined) {
      const { __randExclude: _a, __randSkip: _b, ...rest } = params;
      void _a; void _b;
      params = rest;
    }
    const sg = params.subgraph as SubgraphData | undefined;
    if (n.type === 'group' && sg && Array.isArray(sg.nodes)) params = { ...params, subgraph: { ...sg, nodes: withoutLocks(sg.nodes) } };
    return params === n.params ? n : { ...n, params };
  });
}

/** Same effective range as the card's ruler (NodeComponent's float row) */
function floatRange(node: GraphNode, key: string, pd: ParamDef): [number, number] {
  if (!hasCustomRange(node.params, key) && pd.min === undefined && pd.max === undefined) return [-1, 1];
  const { min, max } = paramSliderRange(node.params, key, pd);
  return [min, max];
}

function snap(v: number, pd: ParamDef): number {
  const step = pd.type === 'int' ? Math.max(1, pd.step ?? 1) : pd.step ?? 0.01;
  const snapped = Math.round(v / step) * step;
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return Number(snapped.toFixed(decimals));
}

/** Whether the node has anything Randomize would change (to show the button) */
export function canRandomize(node: GraphNode, def: NodeDefinition): boolean {
  return randomizableParams(node, def).length > 0;
}

/** Keys that are locked (the 🔒 on a row, or unticked in the die's right-click list) */
export function randomizeExcluded(node: GraphNode): string[] {
  return Array.isArray(node.params.__randExclude) ? (node.params.__randExclude as unknown[]).filter((k): k is string => typeof k === 'string') : [];
}

/** Every setting Randomize could change, locked or not, for the right-click list */
export function randomizableParams(node: GraphNode, def: NodeDefinition, opts: RandomizeOptions = DEFAULT_RANDOMIZE_OPTIONS): Array<{ key: string; label: string }> {
  if (node.type === 'group') return groupRandomRows(node).map(r => ({ key: r.key, label: r.label }));
  // A draw of 0 and full strength: every setting the options allow shows up (a choice always "fires").
  const all = randomizedParams({ ...node, params: { ...node.params, __randExclude: [] } }, def, () => 0, { ...opts, strength: 1 });
  return Object.keys(all).map(key => ({ key, label: def.paramDefs?.[key]?.label ?? key }));
}

// ── Groups ──────────────────────────────────────────────────────────────────
// A group's own Randomize changes the values shown on its card (the group's override keys). The
// rows mirror NodeComponent's group card: inner nodes' float sliders that aren't hidden or wired,
// plus params surfaced from nested groups. What's inside a group is only touched by the canvas dice
// with "Inside groups" on (randomizedGraph).

interface GroupRow { key: string; label: string; lo: number; hi: number; pd: ParamDef; current: unknown; nice?: Interesting }

function groupRandomRows(group: GraphNode): GroupRow[] {
  const sg = group.params.subgraph as SubgraphData | undefined;
  if (!sg || !Array.isArray(sg.nodes)) return [];
  const hidden = Array.isArray(group.params.hiddenParams) ? group.params.hiddenParams as string[] : [];
  const surfaced = Array.isArray(group.params.surfacedParams) ? group.params.surfacedParams as SurfacedParam[] : [];
  const sectionLabel = (inner: GraphNode) => {
    const custom = group.params[`__sectionLabel_${inner.id}`];
    if (typeof custom === 'string') return custom;
    return typeof inner.params.label === 'string' ? inner.params.label : getNodeDefinitionFor(inner)?.label ?? inner.type;
  };
  const rows: GroupRow[] = [];
  for (const inner of sg.nodes) {
    if (inner.type === 'group') {
      const innerSub = inner.params.subgraph as SubgraphData | undefined;
      for (const sp of surfaced.filter(x => x.innerGroupId === inner.id)) {
        const innNode = innerSub?.nodes.find(n => n.id === sp.nodeId);
        const pd = innNode ? getNodeDefinitionFor(innNode)?.paramDefs?.[sp.paramKey] : undefined;
        if (!innNode || !pd || group.inputs[`ps_${inner.id}_${sp.nodeId}_${sp.paramKey}`]?.connection) continue;
        if (isNodeSkipped(innNode) || randomizeExcluded(innNode).includes(sp.paramKey)) continue;
        rows.push({ key: `${inner.id}::${sp.nodeId}::${sp.paramKey}`, label: `${sectionLabel(inner)} · ${sp.label ?? pd.label}`, lo: pd.min ?? 0, hi: pd.max ?? 1, pd, current: innNode.params[sp.paramKey] });
      }
      continue;
    }
    const def = getNodeDefinitionFor(inner);
    for (const [key, pd] of Object.entries(def?.paramDefs ?? {})) {
      if (pd.type !== 'float' || pd.step === 1 || !isParamVisible(pd, inner.params, def?.defaultParams)) continue;
      if (inner.inputs[`__param_${key}`]?.connection) continue;
      if (Object.entries(inner.inputs).some(([k, inp]) => k.toLowerCase() === key.toLowerCase() && inp.connection)) continue;
      if (hidden.includes(`${inner.id}::${key}`) || group.inputs[`ps_${inner.id}_${key}`]?.connection) continue;
      // A setting locked (or a node skipped) where it lives stays put on the group's face too.
      if (neverRandomise(key) || isNodeSkipped(inner) || randomizeExcluded(inner).includes(key)) continue;
      const [lo, hi] = floatRange(inner, key, pd);
      const nice = niceRange(inner, key, pd, lo, hi, def?.defaultParams?.[key]);
      rows.push({ key: `${inner.id}::${key}`, label: `${sectionLabel(inner)} · ${pd.label}`, lo, hi, pd, current: inner.params[key], nice });
    }
  }
  return rows;
}

function randomizedGroupOverrides(group: GraphNode, rand: () => number, opts: RandomizeOptions, weightOf?: WeightOf): Record<string, unknown> {
  const excluded = new Set(randomizeExcluded(group));
  const out: Record<string, unknown> = {};
  for (const r of groupRandomRows(group)) {
    if (excluded.has(r.key)) continue;
    const t = moveShare(opts, weightOf?.(r.key));
    if (t === null) continue;
    const nice = r.nice ?? { lo: r.lo, hi: r.hi, log: false, int: false, source: 'legal' as const };
    out[r.key] = pickIn(r.lo, r.hi, nice, group.params[r.key] ?? r.current, t, rand, r.pd);
  }
  return out;
}
