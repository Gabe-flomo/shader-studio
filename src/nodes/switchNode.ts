/**
 * switchNode.ts — "Switch to": turn a node into a sibling (Union → Intersect,
 * Sphere → Cone, Sin → Cos, Floor → Round) in place, wires and settings kept.
 *
 * Pure: the store's swapNode (the shift-click "Replacing … pick a node" flow)
 * and the card's Switch picker both go through planSwitch / applySwitchToList.
 *
 *  - A node's alternatives are its FAMILY: an explicit family it belongs to
 *    (SDF combiners, colour adjustments…) and its natural one (same category,
 *    and same subcategory where the category has them).
 *  - A target is COMPATIBLE when every wire the node has now finds a place:
 *    each wired input goes to a target input of the same key, else the same
 *    label, else the first input of the same type, else the first that the
 *    source can feed (typesCompatible); each wired output likewise, checked
 *    against every consumer. No two wires share one socket.
 *  - The switched node keeps its id, so Play controls, mappings, group
 *    overrides and the selection keep pointing at it. Params carry over by
 *    key (and by meaning: radius ↔ r…), keyframes and input expressions go
 *    with their socket, and Play targets on a renamed param are retargeted.
 */
import type { DataType, GraphNode, InputSocket, NodeDefinition } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { NODE_REGISTRY, getNodeDefinition } from './definitions';
import { VECTORIZABLE_NODES } from './definitions/math';
import { AGENT_INSIDE_TYPES, AGENT_OUTSIDE_TYPES, AGENT_PRESET_TYPES } from './definitions/agents';
import { isAssignableDef } from './assignable';
import { typesCompatible } from '../lib/typesCompatible';

// ── Families ────────────────────────────────────────────────────────────────

export interface SwitchFamily { id: string; label: string; types: readonly string[] }

/** Families that cross categories, or pick the like-for-like part of a mixed one. */
export const SWITCH_FAMILIES: readonly SwitchFamily[] = [
  // Smooth variants are the same nodes (their k), and Min / Max are the hard-edged ones.
  { id: 'sdf-combine', label: 'SDF combiners', types: ['sdfUnion', 'sdfIntersect', 'sdfSubtract', 'minMath', 'max'] },
  { id: 'rounding', label: 'Rounding', types: ['floor', 'ceil', 'round', 'fractRaw', 'quantize', 'mod', 'abs', 'sign'] },
  { id: 'trig', label: 'Trigonometry', types: ['sin', 'cos', 'tan', 'tanh'] },
  { id: 'unary-math', label: 'One-input math', types: ['abs', 'negate', 'sqrt', 'exp', 'sign', 'floor', 'ceil', 'round', 'fractRaw', 'tanh'] },
  { id: 'sdf-modify', label: 'SDF modifiers', types: ['sdfOffset', 'sdfOnion', 'sdfSharpen', 'abs', 'negate'] },
  { id: 'arith', label: 'Arithmetic', types: ['add', 'subtract', 'multiply', 'divide', 'pow', 'minMath', 'max', 'mod'] },
  { id: 'interp', label: 'Interpolation', types: ['mix', 'smoothstep', 'remap', 'clamp', 'step'] },
  { id: 'noise', label: 'Noise', types: ['fbm', 'noiseFloat', 'voronoi', 'scatter', 'waveTexture'] },
  { id: 'colour-adjust', label: 'Colour adjustments', types: [
    'brightnessContrast', 'colorSaturation', 'hueRotate', 'liftGammaGain', 'shadowsHighlights', 'toneCurve', 'toneMap',
    'invert', 'posterize', 'hsv', 'hueRange', 'grain',
  ] },
  { id: 'colour-mix', label: 'Colour mixing', types: ['blendModes', 'oklabMix', 'addColor', 'mask'] },
  { id: 'palettes', label: 'Palettes', types: ['palette', 'stopPalette', 'colorRamp', 'blackbody'] },
  { id: 'shapers', label: 'Shapers & easing', types: [] /* filled from the Shapers category below */ },
];

/** Categories whose nodes are engines, groups or wiring, not interchangeable operations. */
const NO_SWITCH_CATEGORIES = new Set([
  'Sources', 'Output', 'Simulation', '3D Scene', 'Functions', 'Loops', 'Passes', 'Utility', 'Particles',
]);
const NO_SWITCH_TYPES = new Set(['customFn', 'exprNode', 'group', 'constants', 'data']);

function switchableDef(def: NodeDefinition | undefined): def is NodeDefinition {
  if (!def || def.deprecated || def.anchored) return false;
  if (NO_SWITCH_CATEGORIES.has(def.category) || NO_SWITCH_TYPES.has(def.type)) return false;
  if (def.syncSockets || def.paramDefsFor || def.textureSlots?.length) return false;
  if (def.defaultParams && 'subgraph' in def.defaultParams) return false;
  return NODE_REGISTRY[def.type] === def;
}

/** Whether a node can be switched at all (built-in, not a group, not an engine). */
export function canSwitchNode(node: GraphNode): boolean {
  if (node.params?.subgraph) return false;
  return switchableDef(NODE_REGISTRY[node.type]);
}

const naturalLabel = (def: NodeDefinition) => (def.subcategory ? `${def.category} · ${def.subcategory}` : def.category);

/** The families a type is switched within: explicit ones first, then its natural one. */
export function switchFamiliesFor(type: string): SwitchFamily[] {
  const def = NODE_REGISTRY[type];
  if (!switchableDef(def)) return [];
  const all = Object.values(NODE_REGISTRY).filter(switchableDef);
  const out: SwitchFamily[] = [];
  for (const f of SWITCH_FAMILIES) {
    const types = f.id === 'shapers' ? all.filter(d => d.category === 'Shapers').map(d => d.type) : f.types;
    if (types.includes(type)) out.push({ ...f, types: types.filter(t => switchableDef(NODE_REGISTRY[t])) });
  }
  if (def.category !== 'Shapers') {
    const natural = all.filter(d => d.category === def.category && (d.subcategory ?? '') === (def.subcategory ?? '')).map(d => d.type);
    // Natural families that an explicit one already covers add nothing.
    if (!out.some(f => natural.every(t => f.types.includes(t)))) out.push({ id: `cat:${naturalLabel(def)}`, label: naturalLabel(def), types: natural });
  }
  return out;
}

// ── Compatibility ───────────────────────────────────────────────────────────

/** Where a wire into the node comes from, and where the node's outputs go. */
export interface SwitchContext {
  /** The type an input's connection delivers (a group port, an upstream output), if known. */
  sourceType: (conn: NonNullable<InputSocket['connection']>) => DataType | string | undefined;
  /** Consumers outside the node list (a group's output ports reading this node). */
  extraConsumers?: Array<{ outputKey: string; type: DataType | string }>;
  /** Why a target type can't go in this scope (agents-inside rules), or null. */
  disallowed?: (type: string) => string | null;
}

export type MatchKind = 'key' | 'label' | 'type' | 'promoted';
const MATCH_SCORE: Record<MatchKind, number> = { key: 3, label: 2, type: 1, promoted: 0 };

export interface SwitchPlan {
  type: string;
  label: string;
  ok: boolean;
  /** Why it isn't compatible (the first wire with nowhere to go). */
  reason?: string;
  score: number;
  /** Old input key → new input key, for wired inputs. */
  inputMap: Record<string, string>;
  /** Old output key → new output key, for outputs that feed something. */
  outputMap: Record<string, string>;
  /** Wires that find a place (in + out, counting each consumer). */
  keptWires: number;
  droppedWires: number;
  /** The switched node (same id, position…). */
  node: GraphNode;
  /** Param keys carried over (old → new). */
  paramMap: Record<string, string>;
  /** Old params (shown as sliders) that the target has no place for. */
  lostParams: string[];
  /** The same, by their names on the card ("Radius", "Blend radius"). */
  lostLabels: string[];
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Params that mean the same thing under different keys. Each row is one meaning. */
const PARAM_SYNONYMS: readonly (readonly string[])[] = [
  ['radius', 'r', 'size'],
  ['height', 'h', 'he'],
  ['thickness', 'th', 'line_width'],
  ['k', 'smoothK', 'smoothness', 'blend_k'],
  ['strength', 'amount', 'intensity'],
  ['frequency', 'freq'],
  ['amplitude', 'amp'],
  ['angle', 'angle_deg'],
  ['posX', 'cx', 'tx'],
  ['posY', 'cy', 'ty'],
  ['scale', 'zoom'],
];

function sameKind(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return true;
  if (typeof a === 'boolean' && typeof b === 'boolean') return true;
  if (typeof a === 'string' && typeof b === 'string') return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length;
  return false;
}

/** A fresh node of `type` with the old node's identity and, for vectorizable math, its vector type. */
function buildTarget(old: GraphNode, def: NodeDefinition): GraphNode {
  const inputs: Record<string, InputSocket> = {};
  for (const [key, socket] of Object.entries(def.inputs)) {
    inputs[key] = { ...socket, defaultValue: def.paramDefs?.[key] ? undefined : def.defaultParams?.[key] as number | number[] | undefined };
  }
  const outputs = { ...def.outputs };
  const params: Record<string, unknown> = { ...(def.defaultParams ?? {}) };
  // Add (vec3) → Multiply (vec3): the target takes the same vector type.
  const vt = old.params.outputType as DataType | undefined;
  const vec = VECTORIZABLE_NODES[def.type];
  if (vt && vt !== 'float' && vec && VECTORIZABLE_NODES[old.type]) {
    for (const k of [vec.primaryInput, ...(vec.alsoInputs ?? [])]) if (inputs[k]) inputs[k] = { ...inputs[k], type: vt };
    if (vec.primaryOutput && outputs[vec.primaryOutput]) outputs[vec.primaryOutput] = { ...outputs[vec.primaryOutput], type: vt };
    params.outputType = vt;
  }
  return { id: old.id, type: def.type, position: { ...old.position }, inputs, outputs, params };
}

/**
 * Pair each wanted socket (old) with a free socket on the target: same key,
 * then same label, then same type, then a type it can feed. Returns the
 * mapping and the first socket with nowhere to go.
 */
function pairSockets<T extends { key: string; label: string; fits: (t: string) => boolean; exact: (t: string) => boolean; field?: boolean }>(
  wanted: T[],
  targets: Array<{ key: string; label: string; type: string; field?: boolean }>,
): { map: Record<string, { to: string; kind: MatchKind }>; missing: T | null } {
  const map: Record<string, { to: string; kind: MatchKind }> = {};
  const taken = new Set<string>();
  const free = (w: T) => targets.filter(t => !taken.has(t.key) && !!t.field === !!w.field && w.fits(t.type));
  const passes: Array<[MatchKind, (w: T, t: (typeof targets)[number]) => boolean]> = [
    ['key', (w, t) => t.key === w.key],
    ['label', (w, t) => norm(t.label) === norm(w.label)],
    ['type', (w, t) => w.exact(t.type)],
    ['promoted', () => true],
  ];
  for (const [kind, test] of passes) {
    for (const w of wanted) {
      if (map[w.key]) continue;
      const hit = free(w).find(t => test(w, t));
      if (hit) { map[w.key] = { to: hit.key, kind }; taken.add(hit.key); }
    }
  }
  return { map, missing: wanted.find(w => !map[w.key]) ?? null };
}

/** Carry the old node's settings onto the target: by key, then by meaning; metadata by socket. */
function carryParams(old: GraphNode, oldDef: NodeDefinition | undefined, target: GraphNode, def: NodeDefinition, inputMap: Record<string, string>) {
  const params = { ...target.params };
  const paramMap: Record<string, string> = {};
  const targetKeys = new Set([...Object.keys(def.paramDefs ?? {}), ...Object.keys(def.defaultParams ?? {})]);
  const oldKeys = Object.keys(oldDef?.paramDefs ?? {});
  const fits = (k: string, v: unknown) => {
    if (!sameKind(v, params[k])) return false;
    const pd = def.paramDefs?.[k];
    if (pd?.type === 'select' && pd.options && !pd.options.some(o => o.value === v)) return false;
    return true;
  };
  const used = new Set<string>();
  for (const k of oldKeys) {
    if (k === 'outputType') continue;
    const v = old.params[k];
    if (v === undefined) continue;
    if (targetKeys.has(k) && fits(k, v)) { params[k] = v; paramMap[k] = k; used.add(k); }
  }
  for (const k of oldKeys) {
    if (paramMap[k] || old.params[k] === undefined) continue;
    const row = PARAM_SYNONYMS.find(r => r.includes(k));
    const to = row?.find(s => s !== k && targetKeys.has(s) && !used.has(s) && !oldKeys.includes(s) && fits(s, old.params[k]));
    if (to) { params[to] = old.params[k]; paramMap[k] = to; used.add(to); }
  }
  // A wire's socket that is also a slider (sin's input): its key moved with the wire.
  const socketMove = (k: string): string | null => {
    if (inputMap[k]) return inputMap[k];
    if (paramMap[k]) return paramMap[k];
    return def.inputs[k] ? k : null;
  };
  // Per-socket metadata: keyframes, their settings, input expressions.
  const PER_SOCKET = /^(__keyframes|__kfMode|__kfLoopBack|__kfBypass|__kfOffset|__kfLoopCount|__inExpr)_(.+?)(_[xyz])?$/;
  const lostMeta: string[] = [];
  for (const [k, v] of Object.entries(old.params)) {
    if (!k.startsWith('__')) {
      if (k === 'label' && typeof v === 'string' && v.trim()) params.label = v;
      continue;
    }
    const m = PER_SOCKET.exec(k);
    if (m) {
      const to = socketMove(m[2]);
      if (to && (def.inputs[to] || def.paramDefs?.[to])) params[`${m[1]}_${to}${m[3] ?? ''}`] = v;
      else if (m[1] === '__keyframes') lostMeta.push(m[2]);
      continue;
    }
    if (k === '__comment' || k === '__credit' || k === '__randAmount' || k === '__inputHints' || k === '__inputLabels') {
      params[k] = v;
    } else if (k === '__randExclude' && Array.isArray(v)) {
      const kept = v.map(x => (typeof x === 'string' ? paramMap[x] : undefined)).filter((x): x is string => !!x);
      if (kept.length) params[k] = kept;
    } else if (k === '__sockets' && Array.isArray(v)) {
      const kept = v.map(x => (typeof x === 'string' ? socketMove(x) : null)).filter((x): x is string => !!x && !!def.inputs[x]);
      if (kept.length) params[k] = kept;
    }
    // Everything else (a code override, an import note) belonged to the old node's GLSL.
  }
  const lostParams = [...new Set([...oldKeys.filter(k => k !== 'outputType' && !paramMap[k] && !def.inputs[k] && !(inputMap[k])), ...lostMeta])];
  return { params, paramMap, lostParams };
}

/** Plan switching `old` (in `scope`) to `targetType`: the mapping and whether every wire survives. */
export function planSwitch(scope: readonly GraphNode[], old: GraphNode, targetType: string, ctx: SwitchContext): SwitchPlan | null {
  const def = getNodeDefinition(targetType);
  if (!def) return null;
  const oldDef = getNodeDefinition(old.type);
  const target = buildTarget(old, def);

  // Wired inputs and the types they bring.
  const wantedIn = Object.entries(old.inputs).flatMap(([key, s]) => {
    if (!s.connection) return [];
    const src = ctx.sourceType(s.connection) ?? s.type;
    return [{ key, label: s.label, field: !!oldDef?.inputs[key]?.field, fits: (t: string) => typesCompatible(src, t), exact: (t: string) => t === src }];
  });
  const inPair = pairSockets(wantedIn, Object.entries(target.inputs).map(([key, s]) => ({ key, label: s.label, type: s.type, field: !!def.inputs[key]?.field })));

  // Wired outputs and every type they must still feed.
  const consumers = new Map<string, string[]>();
  for (const n of scope) {
    if (n.id === old.id) continue;
    for (const s of Object.values(n.inputs)) {
      if (s.connection?.nodeId !== old.id) continue;
      const list = consumers.get(s.connection.outputKey) ?? [];
      list.push(s.type);
      consumers.set(s.connection.outputKey, list);
    }
  }
  for (const c of ctx.extraConsumers ?? []) {
    const list = consumers.get(c.outputKey) ?? [];
    list.push(c.type);
    consumers.set(c.outputKey, list);
  }
  const wantedOut = [...consumers.entries()].map(([key, types]) => {
    const own = old.outputs[key]?.type;
    return { key, label: old.outputs[key]?.label ?? key, fits: (t: string) => types.every(ct => typesCompatible(t, ct)), exact: (t: string) => t === own };
  });
  const outPair = pairSockets(wantedOut, Object.entries(target.outputs).map(([key, s]) => ({ key, label: s.label, type: s.type })));

  const inputMap = Object.fromEntries(Object.entries(inPair.map).map(([k, v]) => [k, v.to]));
  const outputMap = Object.fromEntries(Object.entries(outPair.map).map(([k, v]) => [k, v.to]));
  const outWires = [...consumers.entries()].reduce((n, [k, t]) => n + (outputMap[k] ? t.length : 0), 0);
  const allOutWires = [...consumers.values()].reduce((n, t) => n + t.length, 0);
  const keptWires = Object.keys(inputMap).length + outWires;
  const droppedWires = wantedIn.length + allOutWires - keptWires;

  const sockLabel = (key: string, where: 'in' | 'out') => (where === 'in' ? old.inputs[key]?.label : old.outputs[key]?.label) ?? key;
  let reason: string | undefined;
  if (inPair.missing) reason = `No input for the wire into ${sockLabel(inPair.missing.key, 'in')}`;
  else if (outPair.missing) reason = `No output for the wire from ${sockLabel(outPair.missing.key, 'out')}`;
  const blocked = ctx.disallowed?.(targetType) ?? null;
  if (!reason && blocked) reason = blocked;

  // Settings, metadata and the wires themselves.
  const { params, paramMap, lostParams } = carryParams(old, oldDef, target, def, inputMap);
  for (const [k, s] of Object.entries(old.inputs)) {
    const to = inputMap[k];
    if (to && s.connection) target.inputs[to] = { ...target.inputs[to], connection: s.connection };
    // An unwired socket's own value (no slider behind it) follows by key.
    if (!s.connection && s.defaultValue !== undefined && target.inputs[k] && !def.paramDefs?.[k]
      && target.inputs[k].type === s.type) target.inputs[k] = { ...target.inputs[k], defaultValue: s.defaultValue };
  }
  const node: GraphNode = {
    ...target,
    params,
    ...(old.bypassed ? { bypassed: true } : {}),
    ...(old.carryMode ? { carryMode: true } : {}),
    ...(old.assignOp && old.assignOp !== '=' && isAssignableDef(def) ? { assignOp: old.assignOp, ...(old.assignInit ? { assignInit: old.assignInit } : {}) } : {}),
  };

  const score = [...Object.values(inPair.map), ...Object.values(outPair.map)].reduce((n, m) => n + MATCH_SCORE[m.kind], 0)
    + Object.keys(paramMap).length * 0.5;
  const lostLabels = lostParams.map(k => oldDef?.paramDefs?.[k]?.label ?? old.inputs[k]?.label ?? k);
  return { type: targetType, label: def.label, ok: !reason, reason, score, inputMap, outputMap, keptWires, droppedWires, node, paramMap, lostParams, lostLabels };
}

export interface SwitchOption extends Omit<SwitchPlan, 'node'> { current: boolean }
export interface SwitchGroup { family: SwitchFamily; options: SwitchOption[] }

/**
 * Every alternative for `node`, by family: the node itself (current), the
 * compatible ones best match first, then the incompatible ones with why.
 * A type in two families is listed under the first.
 */
export function switchOptions(scope: readonly GraphNode[], node: GraphNode, ctx: SwitchContext): SwitchGroup[] {
  if (!canSwitchNode(node)) return [];
  const seen = new Set<string>([node.type]);
  const groups: SwitchGroup[] = [];
  const order = (f: SwitchFamily, t: string) => { const i = f.types.indexOf(t); return i >= 0 ? i : 1e6 + Object.keys(NODE_REGISTRY).indexOf(t); };
  for (const family of switchFamiliesFor(node.type)) {
    const options: SwitchOption[] = [];
    for (const t of family.types) {
      if (seen.has(t)) continue;
      const plan = planSwitch(scope, node, t, ctx);
      if (!plan) continue;
      seen.add(t);
      const { node: _n, ...rest } = plan;
      void _n;
      options.push({ ...rest, current: false });
    }
    options.sort((a, b) => Number(b.ok) - Number(a.ok) || b.score - a.score || order(family, a.type) - order(family, b.type));
    if (options.length) groups.push({ family, options });
  }
  return groups;
}

/** Whether `node` has any compatible switch (the card shows its Switch pill only then). */
export function hasSwitchOptions(node: GraphNode): boolean {
  if (!canSwitchNode(node)) return false;
  return switchFamiliesFor(node.type).some(f => f.types.some(t => t !== node.type));
}

/**
 * The node list with `plan` applied: the node replaced in place (same id, same
 * slot in the list), consumers re-pointed through the output map, and wires
 * that found no place cleared (the shift-click swap accepts any target).
 */
export function applySwitchToList(scope: readonly GraphNode[], plan: SwitchPlan): GraphNode[] {
  const id = plan.node.id;
  return scope.map(n => {
    if (n.id === id) return plan.node;
    let changed = false;
    const inputs = { ...n.inputs };
    for (const [k, s] of Object.entries(n.inputs)) {
      if (s.connection?.nodeId !== id) continue;
      const to = plan.outputMap[s.connection.outputKey];
      inputs[k] = to ? { ...s, connection: { nodeId: id, outputKey: to } } : { ...s, connection: undefined };
      changed = true;
    }
    return changed ? { ...n, inputs } : n;
  });
}

/** Agents-family placement rules (the same ones addNode applies), as a reason or null. */
export function groupRuleFor(type: string, path: readonly string[], insideType: string | undefined): string | null {
  const inAgents = path.length === 1 && insideType === 'agentsGroup';
  const label = getNodeDefinition(type)?.label ?? type;
  if (AGENT_INSIDE_TYPES.has(type) && !inAgents) return `${label} goes inside an Agents group`;
  if ((AGENT_OUTSIDE_TYPES.has(type) || AGENT_PRESET_TYPES.has(type)) && path.length > 0) return `${label} goes on the top level`;
  return null;
}

/**
 * Play controls on the switched node: those on a renamed param are retargeted,
 * those on a param that's gone are counted (left in place, so undo-free edits
 * elsewhere don't lose them; the card no longer shows them).
 */
export function retargetPlay(play: PlayRecord, nodeId: string, plan: Pick<SwitchPlan, 'paramMap' | 'node'>): { play: PlayRecord; lost: string[]; moved: number } {
  const def = getNodeDefinition(plan.node.type);
  const has = (k: string) => !!(def?.paramDefs?.[k] || def?.inputs[k] || k in plan.node.params);
  const lost: string[] = [];
  let moved = 0;
  const controls = play.controls.map(c => {
    const parts = c.target.split('::');
    if (parts.length < 2 || parts[parts.length - 2] !== nodeId) return c;
    const key = parts[parts.length - 1];
    const to = plan.paramMap[key];
    if (to && to !== key) { moved++; return { ...c, target: [...parts.slice(0, -1), to].join('::') }; }
    if (!to && !has(key)) lost.push(c.label || key);
    return c;
  });
  return { play: moved ? { ...play, controls } : play, lost, moved };
}
