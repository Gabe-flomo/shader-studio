/**
 * passBudget.ts — the pass account: how many of a graph's MAX_PASSES it uses, and what for.
 *
 * Many nodes are passes once compiled (a Pass, a Shader Texture, a Feedback (texture), a Data Texture,
 * Render Targets, each Grid Rules board, Optical Flow's two, the shared Memory and value-probe passes,
 * a Smooth lens, a Sprite from a picture that isn't a Pass's). The count here is the count the compile
 * checks: it runs the same expansion (passExpand.ts) and counts the Pass nodes that come out, then
 * says which node of the graph each one came from. Blur / Glow (texture) hidden passes are reported
 * apart: they have their own budget (MAX_HIDDEN_PASSES) and never count towards MAX_PASSES.
 *
 * Cheap: no shader is generated. Memoised by the node list (the store replaces it on every change).
 */
import type { GraphNode } from '../types/nodeGraph';
import { MAX_PASSES, PASS_TYPE, expandPassNodes } from './passExpand';
import { MEMORY_PASS_ID, isMemoryNode } from './memoryExpand';
import { PROBE_PASS_ID, isProbe, textNeedsProbe } from './probeExpand';
import { MAX_HIDDEN_PASSES } from './blurPasses';
import { hiddenPlanOf } from './hiddenBlurs';
import { getNodeDefinition, getNodeDefinitionFor } from '../nodes/definitions';
import { instantiateNode } from '../nodes/scene3dDefaults';

export { MAX_PASSES, MAX_HIDDEN_PASSES };

/** One line of the account: a node of the graph (or, shared, a set of them) and the passes it costs. */
export interface PassBudgetItem {
  /** The node in the graph the passes came from (the first member, for a shared pass). */
  nodeId: string;
  /** The top-level node holding it (itself, unless it is inside a group or Shader Texture). */
  topId: string;
  /** The groups to open, from the top, to reach it (revealNode). */
  path: string[];
  /** The node's own label, or its kind. */
  label: string;
  /** What kind of node it is ("Pass", "Optical Flow", "Memory nodes"…). */
  kind: string;
  type: string;
  /** Passes it adds. */
  cost: number;
  /** A pass every node of this kind shares: how many nodes share it, and their ids. */
  shared?: { count: number; nodeIds: string[] };
  /** What the passes are, from the compile ("Flow source", "Optical flow"…). */
  passes: string[];
}

export interface HiddenPassItem { nodeId: string; topId: string; path: string[]; label: string; cost: number }

export interface PassBudget {
  used: number;
  max: number;
  items: PassBudgetItem[];
  hidden: { used: number; max: number; items: HiddenPassItem[] };
  /** The expansion itself failed (a Pass inside a group that can't hold one): the compile says why. */
  error?: string;
}

const EMPTY: PassBudget = { used: 0, max: MAX_PASSES, items: [], hidden: { used: 0, max: MAX_HIDDEN_PASSES, items: [] } };

interface Origin { node: GraphNode; topId: string; path: string[] }

/** Every node of the graph, nested ones too, by id, with the top-level node holding it. */
function originIndex(nodes: GraphNode[]): Map<string, Origin> {
  const out = new Map<string, Origin>();
  const walk = (list: GraphNode[], path: string[]) => {
    const prefix = path[path.length - 1];
    for (const n of list) {
      const o: Origin = { node: n, topId: path[0] ?? n.id, path };
      if (!out.has(n.id)) out.set(n.id, o);
      // An opened group's inner node that clashed gets the group's id in front (passGroups.ts, shaderTextureExpand.ts).
      if (prefix && !out.has(`${prefix}__${n.id}`)) out.set(`${prefix}__${n.id}`, o);
      const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) walk(sg.nodes, [...path, n.id]);
    }
  };
  walk(nodes, []);
  return out;
}

/** The graph node an expanded node came from: its own id, or the id before an expansion's `__suffix`. */
function originOf(id: string, index: Map<string, Origin>): Origin | undefined {
  let cur = id;
  for (;;) {
    const o = index.get(cur);
    if (o) return o;
    const cut = cur.lastIndexOf('__');
    if (cut <= 0) return undefined;
    cur = cur.slice(0, cut);
  }
}

const ownLabel = (n: GraphNode) => (typeof n.params?.label === 'string' && n.params.label.trim()) || '';
const kindOf = (n: GraphNode) => getNodeDefinitionFor(n)?.label ?? n.type;
const passLabel = (p: GraphNode) => (typeof p.params?.label === 'string' && p.params.label) || 'Pass';

const cache = new WeakMap<GraphNode[], PassBudget>();

/** The pass account of a graph (its top-level node list). */
export function passBudget(nodes: GraphNode[]): PassBudget {
  const hit = cache.get(nodes);
  if (hit) return hit;
  const result = computeBudget(nodes);
  cache.set(nodes, result);
  return result;
}

function computeBudget(nodes: GraphNode[]): PassBudget {
  if (!nodes.length) return EMPTY;
  let expanded: GraphNode[];
  try {
    const e = expandPassNodes(nodes);
    if ('errors' in e) return { ...EMPTY, error: e.errors[0] };
    expanded = e.nodes;
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) };
  }
  const index = originIndex(nodes);
  const items: PassBudgetItem[] = [];
  const byOrigin = new Map<string, PassBudgetItem>();
  const sharedItem = (key: string, kind: string, members: Origin[], pass: GraphNode) => {
    const first = members[0];
    const item: PassBudgetItem = {
      nodeId: first?.node.id ?? key, topId: first?.topId ?? key, path: first?.path ?? [], label: kind, kind, type: first?.node.type ?? key,
      cost: 1, shared: { count: members.length, nodeIds: members.map(m => m.node.id) }, passes: [passLabel(pass)],
    };
    items.push(item);
  };
  for (const p of expanded) {
    if (p.type !== PASS_TYPE) continue;
    if (p.id === MEMORY_PASS_ID || p.id === PROBE_PASS_ID) {
      const memory = p.id === MEMORY_PASS_ID;
      // The members: the expanded list keeps each one's id (as its reader).
      const members = expanded.flatMap(n => {
        const o = index.get(n.id);
        if (!o) return [];
        return (memory ? isMemoryNode(o.node) && !o.node.bypassed : isProbe(o.node) || textNeedsProbe(o.node)) ? [o] : [];
      });
      sharedItem(p.id, memory ? 'Memory nodes' : 'Values at points', members, p);
      continue;
    }
    const o = originOf(p.id, index);
    const key = o?.node.id ?? p.id;
    const prev = byOrigin.get(key);
    if (prev) { prev.cost++; prev.passes.push(passLabel(p)); continue; }
    const node = o?.node ?? p;
    const item: PassBudgetItem = {
      nodeId: node.id, topId: o?.topId ?? p.id, path: o?.path ?? [], label: ownLabel(node) || kindOf(node), kind: kindOf(node), type: node.type,
      cost: 1, passes: [passLabel(p)],
    };
    byOrigin.set(key, item);
    items.push(item);
  }
  // Hidden passes (Blur / Glow): the plan the compile draws, up to their own budget.
  const byId = new Map(expanded.map(n => [n.id, n]));
  const hiddenItems: HiddenPassItem[] = [];
  let hiddenUsed = 0;
  for (const n of expanded) {
    const planned = hiddenPlanOf(n, byId);
    if (!planned) continue;
    const cost = planned.plan.stages.length;
    if (hiddenUsed + cost > MAX_HIDDEN_PASSES) continue;
    hiddenUsed += cost;
    const o = originOf(n.id, index);
    const node = o?.node ?? n;
    hiddenItems.push({ nodeId: node.id, topId: o?.topId ?? n.id, path: o?.path ?? [], label: ownLabel(node) || kindOf(node), cost });
  }
  const used = items.reduce((s, i) => s + i.cost, 0);
  return { used, max: MAX_PASSES, items, hidden: { used: hiddenUsed, max: MAX_HIDDEN_PASSES, items: hiddenItems } };
}

/** "ok" below the last pass, "warn" with one (or none) left, "over" past the limit. */
export function budgetLevel(used: number, max = MAX_PASSES): 'ok' | 'warn' | 'over' {
  return used > max ? 'over' : used >= max - 1 ? 'warn' : 'ok';
}

/** The items summed by kind: "Pass ×5", "Optical Flow ×1 (2 passes)", "Memory nodes (1, shared)". */
export function budgetSummary(items: PassBudgetItem[]): string[] {
  const kinds = new Map<string, { count: number; cost: number; shared: boolean }>();
  for (const i of items) {
    const k = kinds.get(i.kind) ?? { count: 0, cost: 0, shared: !!i.shared };
    k.count += i.shared ? i.shared.count : 1;
    k.cost += i.cost;
    kinds.set(i.kind, k);
  }
  return [...kinds].map(([kind, k]) => (k.shared
    ? `${kind} (${k.cost}, shared by ${k.count})`
    : k.cost === k.count ? `${kind} ×${k.count}` : `${kind} ×${k.count} (${k.cost} passes)`));
}

/** The over-limit error, itemised from the same account. */
export function overBudgetMessage(b: Pick<PassBudget, 'used' | 'max' | 'items'>): string {
  const repeat = b.items.some(i => i.type === PASS_TYPE) ? ', or let one Pass draw several steps with its Repeat setting' : '';
  return `This graph needs ${b.used} of ${b.max} passes: ${budgetSummary(b.items).join(', ')}. Remove some of them${repeat}. (Blur and Glow use hidden passes of their own and don't count.)`;
}

/** Why there is a limit, in one sentence (the toolbar popover and docs). */
export const PASS_LIMIT_WHY = 'Each pass renders the whole picture into a texture of its own every frame, and a shader can only read so many textures at once.';

/**
 * The library's note for a node type: what a fresh one costs (from the same expansion), or what it costs
 * once set up (the nodes whose pass depends on a setting or a wire). Null: it never adds a pass.
 */
export function nodePassNote(type: string): string | null {
  const conditional = CONDITIONAL_NOTES[type];
  if (conditional) return conditional;
  const cached = noteCache.get(type);
  if (cached !== undefined) return cached;
  let note: string | null = null;
  const def = getNodeDefinition(type);
  if (def) {
    try {
      // Its Texture inputs wired to a picture (Optical Flow only opens with one wired).
      const node = instantiateNode('n1', type, def, { x: 0, y: 0 });
      const picDef = getNodeDefinition('textureInput');
      const extra = picDef ? [instantiateNode('n0', 'textureInput', picDef, { x: 0, y: 0 })] : [];
      if (extra.length) for (const [k, i] of Object.entries(node.inputs)) if (i.type === 'texture') node.inputs[k] = { ...i, connection: { nodeId: 'n0', outputKey: 'texture' } };
      const b = computeBudget([...extra, node]);
      const item = b.items[0];
      if (item) note = item.shared ? `Shares 1 pass (of ${MAX_PASSES}) with every ${item.kind === 'Memory nodes' ? 'memory node' : 'node like it'}` : `Uses ${b.used} pass${b.used === 1 ? '' : 'es'} (of ${MAX_PASSES})`;
    } catch { note = null; }
  }
  noteCache.set(type, note);
  return note;
}
const noteCache = new Map<string, string | null>();

/** Nodes that add a pass only when set up a certain way (the rules themselves live in their expanders). */
const CONDITIONAL_NOTES: Record<string, string> = {
  probe: `Shares 1 pass (of ${MAX_PASSES}) with every Value at Point, once its Value is wired`,
  text: `With a wired Value read at a point: shares 1 pass (of ${MAX_PASSES}) with every Value at Point`,
  curveTrace: `Draw: Beam uses 1 pass (of ${MAX_PASSES}) for its screen`,
  marchCamera: `Lens Smooth or Soft grain uses 1 pass (of ${MAX_PASSES})`,
  drawAgents: `A Sprite from a picture that isn't a Pass's uses 1 pass (of ${MAX_PASSES})`,
  gridRules: `Uses 1 pass (of ${MAX_PASSES}) for its board, 2 when its Texture is wired`,
};
