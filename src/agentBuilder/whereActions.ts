/**
 * whereActions.ts — the Where picker's store side (docs/agent-builder.md "Where"): pick a region of
 * the graph (or make a shape here) for a use, and it is wired where that use reads it, with the
 * rule set changed to match, as one undo step. Dragging a made shape writes its sliders (a burst of
 * moves is one undo step, and no recompile). Pure planning is where.ts; shapes are madeShapes.ts.
 *
 * Wiring three ways: a pick is an output of the graph, an output from a group, or something
 * created new for it: a shape made here, a new Shader Texture (docs/texture-builder.md) or a new
 * plain group, each a top-level node wired in as part of the same undo step. The new node's id is
 * kept for the builder to open it ready to edit (`takeCreated`).
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore, undoManager } from '../store/useNodeGraphStore';
import { placeSetupInView } from '../store/placement';
import { toast } from '../components/ui/toastStore';
import { applyRulesToGroup, groupRules } from '../agentRules/apply';
import { type AgentRuleSet, type RuleCondition, DEFAULT_COLLIDE } from '../agentRules/spec';
import type { FieldMask } from '../agentRules/fields';
import { type MadeShape, madeShapeName, madeShapeNode, madeShapePatch, shapeSliders } from './madeShapes';
import {
  type Region, type RegionOut, type WhereUse, FOOD_AMOUNT, USE_WORDS, adapterNode, foodAdapterNode, foodResult, foodSampleNode, maskCondition, maskSlotFor, needsAdapter, pruneMasks, regionAt, throughAdapter,
} from './where';
import { makeShaderTexture } from '../nodes/shaderTextureStarters';
import { group as groupNode, n } from '../store/graphBuilder';
import { setSetupParam, setupOf } from './actions';

export interface WherePick {
  /** A region of the graph… */
  region?: RegionOut;
  /** …or a shape made here (a new node)… */
  make?: MadeShape;
  /** …or a new top-level source: a Shader Texture (a texture) or a plain group (a shape). */
  create?: 'shaderTexture' | 'group';
  /** Outside it instead of inside. */
  outside?: boolean;
}

/** How a use puts the region into the rule set (only when / a field layer's mask). */
export interface WhereEdit {
  /** onlyWhen: the card's condition (null: none). */
  condition?: (set: AgentRuleSet, c: RuleCondition | null) => AgentRuleSet;
  /** fieldMask: the layer's mask (undefined: none). */
  fieldMask?: (set: AgentRuleSet, m: FieldMask | undefined) => AgentRuleSet;
  /** The mask slot it reads now (re-picking may reuse it). */
  slot?: number;
  /** food: the trail channel it is painted into (0–3). */
  channel?: number;
}

const USE_LABEL: Record<WhereUse, string> = { onlyWhen: 'only when inside', fieldMask: 'a field layer\'s region', slope: 'Field ƒ', born: 'born inside', obstacle: 'walls', food: 'food' };

/** The node the last pick created (a Shader Texture or a group), for the builder to open; read once. */
let created: string | null = null;
export function takeCreated(): string | null { const c = created; created = null; return c; }

/**
 * A new plain group whose one output is a shape's distance, for "Create new → A new group": inside, an
 * Expression Block (a circle, with a note saying what to change), its Distance the group's output.
 */
export function newRegionGroup(id: string, innerId: string, x: number, y: number): GraphNode {
  const inner = n('exprNode', innerId, 300, 160, {
    label: 'Shape',
    inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'r', type: 'float', slider: { min: 0.01, max: 2 } }],
    r: 0.5, outputType: 'float', lines: [], result: 'length(uv) - r', expr: 'length(uv) - r',
    __comment: [
      'Shape (an Expression Block in a group made by the Agent Builder): a distance, below 0 inside. The group\'s Distance output feeds what you made it for (only when, born inside, walls, food…).',
      'uv: where it is read (inside an Agents group: where each walker stands).',
      'result: length(uv) − r, a circle of radius r round the middle. Write any shape here, or add nodes and wire them into the Distance output.',
    ].join('\n'),
  });
  inner.inputs = { uv: { type: 'vec2', label: 'uv (vec2)' }, r: { type: 'float', label: 'r (float)' } } as GraphNode['inputs'];
  inner.outputs = { result: { type: 'float', label: 'Result (float)' } };
  const g = groupNode(id, x, y, { label: 'New region', iterations: 1, inputs: [], outputs: [{ key: 'out0', type: 'float', label: 'Distance', from: [innerId, 'result'] }], nodes: [inner] });
  return { ...g, params: { ...g.params, __comment: 'A group made by the Agent Builder (Create new → A new group): its Distance output is a region (below 0 inside). Open it to change the shape.' } };
}

/** What a group's food reads now: its adapter (How much and the channel), or null. */
export function foodNow(nodes: readonly GraphNode[], groupId: string): { adapter: string; amount: number; channel: number } | null {
  const t = setupOf(nodes, groupId).trail;
  const c = t?.inputs.add?.connection;
  const a = c ? nodes.find(x => x.id === c.nodeId) : undefined;
  const w = a?.params.whereAdapter as { use?: string; channel?: number } | undefined;
  if (!a || w?.use !== 'food') return null;
  return { adapter: a.id, amount: typeof a.params.amount === 'number' ? a.params.amount : FOOD_AMOUNT, channel: w.channel ?? 0 };
}

/** Food into another trail channel: the adapter's result rewritten (one undo step). */
export function setFoodChannel(groupId: string, channel: number): void {
  const st = useNodeGraphStore.getState();
  const f = foodNow(st.nodes, groupId);
  if (!f || f.channel === channel) return;
  const a = st.nodes.find(x => x.id === f.adapter)!;
  const w = a.params.whereAdapter as { kind: Region['kind']; outside?: boolean };
  const result = foodResult(w.kind, channel, !!w.outside);
  undoManager.push(st.nodes, { label: 'Agent Builder: food channel' });
  useNodeGraphStore.setState({ nodes: st.nodes.map(x => (x.id === a.id ? { ...x, params: { ...x.params, result, expr: result, whereAdapter: { ...a.params.whereAdapter as object, channel } } } : x)) });
  st.compile();
}
const conn = (o: RegionOut) => ({ nodeId: o.nodeId, outputKey: o.outputKey });

/** What the group's mask socket `i` reads (through nothing: masks are wired straight). */
export const maskWire = (g: GraphNode, i: number): RegionOut | null => g.inputs[`mask${i + 1}`]?.connection ?? null;

/** Adapters (where.ts) nothing reads any more, taken away. */
function dropOrphanAdapters(nodes: GraphNode[]): GraphNode[] {
  let out = nodes;
  for (;;) {
    const read = new Set(out.flatMap(x => Object.values(x.inputs).map(i => i.connection?.nodeId).filter(Boolean) as string[]));
    const gone = out.filter(x => x.params.whereAdapter && !read.has(x.id));
    if (!gone.length) return out;
    const ids = new Set(gone.map(x => x.id));
    out = out.filter(x => !ids.has(x.id));
  }
}

/**
 * Pick where for a use on a group: the new nodes (a shape made here, an adapter), the wires and the
 * rule set, one undo step. Returns the rule set as it now is (null when nothing changed).
 */
export function setWhere(groupId: string, use: WhereUse, pick: WherePick | null, edit: WhereEdit = {}): AgentRuleSet | null {
  const st = useNodeGraphStore.getState();
  const before = st.nodes;
  const g0 = before.find(x => x.id === groupId);
  if (!g0) return null;
  let nodes = before.slice();
  const added: GraphNode[] = [];
  let region: Region | null = null;
  const near = { at: { x: g0.position.x - 340, y: g0.position.y + 120 } };
  if (pick?.make) {
    const id = st.newNodeId();
    const node = madeShapeNode(id, pick.make, g0.position.x - 520, g0.position.y + 40, `"${USE_LABEL[use]}"`);
    const [placed] = placeSetupInView(nodes, [node], st._viewportRectGetter?.() ?? null, near);
    added.push(placed);
    region = { nodeId: id, outputKey: 'result', kind: 'shape', label: madeShapeName(pick.make), made: pick.make };
  } else if (pick?.create === 'shaderTexture') {
    // A new Shader Texture (white discs on black to start), its Texture wired in.
    if (!USE_WORDS[use].kinds.includes('texture')) return null;
    const node = makeShaderTexture(() => useNodeGraphStore.getState().newNodeId(), { x: g0.position.x - 520, y: g0.position.y + 40 }, { starter: 'circles' });
    const [placed] = placeSetupInView(nodes, [node], st._viewportRectGetter?.() ?? null, near);
    added.push(placed);
    region = { nodeId: placed.id, outputKey: 'texture', kind: 'texture', label: 'Shader Texture', from: 'Shader Texture', inside: placed.id };
  } else if (pick?.create === 'group') {
    // A new plain group: its Distance output (a circle to start) wired in.
    const id = st.newNodeId(), inner = st.newNodeId();
    const [placed] = placeSetupInView(nodes, [newRegionGroup(id, inner, g0.position.x - 520, g0.position.y + 40)], st._viewportRectGetter?.() ?? null, near);
    added.push(placed);
    region = { nodeId: id, outputKey: 'out0', kind: 'shape', label: 'New region', from: 'New region', inside: id };
  } else if (pick?.region) region = regionAt(nodes, pick.region);
  if (pick && !region) return null;
  nodes = [...nodes, ...added];
  const outside = !!pick?.outside;
  let set = groupRules(g0);
  let g = g0;
  const wire = (gg: GraphNode, key: string, to: RegionOut | null): GraphNode => {
    if (!gg.inputs[key]) return gg;
    const { connection: _drop, ...rest } = gg.inputs[key];
    return { ...gg, inputs: { ...gg.inputs, [key]: to ? { ...rest, connection: conn(to) } : rest } };
  };
  const adapt = (r: Region, u: 'born' | 'obstacle'): RegionOut => {
    if (!needsAdapter(u, r.kind, outside)) return r;
    const id = useNodeGraphStore.getState().newNodeId();
    const [a] = placeSetupInView(nodes, [adapterNode(id, { ...r, kind: r.kind, use: u, outside, name: r.label }, 0, 0)], st._viewportRectGetter?.() ?? null, { at: { x: g0.position.x - 300, y: g0.position.y + (u === 'born' ? -220 : 260) } });
    nodes.push(a);
    added.push(a);
    return { nodeId: id, outputKey: 'result' };
  };

  switch (use) {
    case 'onlyWhen': case 'fieldMask': {
      if (!region) {
        set = use === 'onlyWhen' ? edit.condition!(set, null) : edit.fieldMask!(set, undefined);
        set = pruneMasks(set);
        g = applyRulesToGroup(g, set);
        break;
      }
      if (region.kind === 'scene') return null;
      const slot = maskSlotFor(set, region, i => maskWire(g0, i), edit.slot);
      if (!slot) {
        toast.info('Four regions at most', { message: 'A group reads at most four masks. Take one away from another card first (its × in the only when), or pick a region already in use.' });
        return null;
      }
      set = slot.set;
      if (use === 'onlyWhen') set = edit.condition!(set, maskCondition(region.kind, slot.mask, outside));
      else set = edit.fieldMask!(set, { shape: 'circle', x: 0, y: 0, size: 0.5, ...(outside ? { outside: true } : {}), region: { mask: slot.mask, read: region.kind === 'texture' ? 'texture' : region.kind === 'shape' ? 'shape' : 'mask', name: region.label } });
      set = pruneMasks(set);
      g = wire(applyRulesToGroup(g, set), `mask${slot.mask + 1}`, region);
      break;
    }
    case 'slope':
      if (region?.kind === 'texture' || region?.kind === 'scene') return null;
      g = wire(g, 'field', region);
      break;
    case 'born': {
      const emit = setupOf(nodes, groupId).emit;
      if (!emit) { toast.info('No Emit', { message: 'Wire an Emit into the group first: it is where walkers are born.' }); return null; }
      let e: GraphNode = emit;
      const unwire = (nd: GraphNode, k: string) => { if (!nd.inputs[k]?.connection) return nd; const { connection: _c, ...rest } = nd.inputs[k]; return { ...nd, inputs: { ...nd.inputs, [k]: rest } }; };
      e = unwire(unwire(e, 'where'), 'picture');
      if (!region) e = { ...e, params: { ...e.params, shape: e.params.shape === 'field' || e.params.shape === 'picture' ? 'disc' : e.params.shape } };
      else if (region.kind === 'texture') e = { ...e, params: { ...e.params, shape: 'picture', threshold: 0.5 }, inputs: { ...e.inputs, picture: { ...e.inputs.picture, connection: conn(region) } } };
      else if (region.kind === 'scene') return null;
      else e = { ...e, params: { ...e.params, shape: 'field', threshold: 0.5, miss: 'skip' }, inputs: { ...e.inputs, where: { ...e.inputs.where, connection: conn(adapt(region, 'born')) } } };
      nodes = nodes.map(x => (x.id === e.id ? e : x));
      break;
    }
    case 'obstacle': {
      if (region?.kind === 'texture') return null;
      if (region?.kind === 'scene') {
        set = { ...set, collide: set.collide ?? { ...DEFAULT_COLLIDE } };
        g = wire(applyRulesToGroup(g, set), 'scene', region);
        break;
      }
      if (!region) {
        const { obstacle: _o, ...rest } = set;
        set = rest as AgentRuleSet;
        if (g.inputs.scene?.connection && set.collide) { const { collide: _c, ...r2 } = set; set = r2 as AgentRuleSet; }
        g = applyRulesToGroup(g, set);
        break;
      }
      set = { ...set, obstacle: { on: set.obstacle?.on ?? 'turn' } };
      g = wire(applyRulesToGroup(g, set), 'obstacle', adapt(region, 'obstacle'));
      break;
    }
    case 'food': {
      // Painted into the Trail field every step (its Add), through a Food block (How much, the channel).
      const trail = setupOf(nodes, groupId).trail;
      if (!trail?.inputs.add) { toast.info('No Trail field', { message: 'Food is painted into the trail: wire the group into a Deposit and a Trail field first.' }); return null; }
      if (region?.kind === 'scene') return null;
      const was = foodNow(nodes, groupId);
      const { connection: _c, ...rest } = trail.inputs.add;
      let t: GraphNode = { ...trail, inputs: { ...trail.inputs, add: rest } };
      if (region) {
        const at = { x: trail.position.x - 340, y: trail.position.y + 260 };
        let sampleId: string | undefined;
        if (region.kind === 'texture') {
          sampleId = useNodeGraphStore.getState().newNodeId();
          const [sm] = placeSetupInView(nodes, [foodSampleNode(sampleId, region, 0, 0)], st._viewportRectGetter?.() ?? null, { at: { x: at.x - 300, y: at.y } });
          nodes.push(sm);
          added.push(sm);
        }
        const id = useNodeGraphStore.getState().newNodeId();
        const [a] = placeSetupInView(nodes, [foodAdapterNode(id, { ...region, outside, name: region.label, channel: edit.channel ?? was?.channel ?? 0, amount: was?.amount }, 0, 0, sampleId)], st._viewportRectGetter?.() ?? null, { at });
        nodes.push(a);
        added.push(a);
        t = { ...t, inputs: { ...t.inputs, add: { ...rest, connection: { nodeId: id, outputKey: 'result' } } } };
      }
      nodes = nodes.map(x => (x.id === t.id ? t : x));
      break;
    }
  }
  if (pick?.create && region) created = region.nodeId;
  nodes = dropOrphanAdapters(nodes.map(x => (x.id === groupId ? g : x)));
  undoManager.push(before, { label: `Agent Builder: ${USE_LABEL[use]}${region ? `: ${region.label}` : ' (none)'}` });
  useNodeGraphStore.setState({ nodes });
  st.compile();
  return groupRules(nodes.find(x => x.id === groupId)!);
}

/** What a use reads now (the region and whether it is "outside"). */
export function whereNow(nodes: readonly GraphNode[], groupId: string, use: WhereUse, o: { condition?: RuleCondition | null; fieldMask?: FieldMask } = {}): { region: Region | null; outside: boolean } {
  const g = nodes.find(x => x.id === groupId);
  if (!g) return { region: null, outside: false };
  switch (use) {
    case 'onlyWhen': {
      const c = o.condition;
      if (c?.kind !== 'mask') return { region: null, outside: false };
      const r = regionAt(nodes, maskWire(g, c.mask));
      return { region: r, outside: c.value === 0 ? c.cmp === '>' : c.cmp === '<' };
    }
    case 'fieldMask': {
      const m = o.fieldMask;
      if (!m?.region) return { region: null, outside: false };
      return { region: regionAt(nodes, maskWire(g, m.region.mask)), outside: !!m.outside };
    }
    case 'slope': return { region: regionAt(nodes, g.inputs.field?.connection), outside: false };
    case 'born': {
      const e = setupOf(nodes, groupId).emit;
      if (!e) return { region: null, outside: false };
      const c = e.params.shape === 'field' ? e.inputs.where?.connection : e.params.shape === 'picture' ? e.inputs.picture?.connection : null;
      const t = throughAdapter(nodes, c);
      return { region: t ? regionAt(nodes, t.out) : null, outside: !!t?.outside };
    }
    case 'food': {
      const t = setupOf(nodes, groupId).trail;
      const r = throughAdapter(nodes, t?.inputs.add?.connection);
      return { region: r ? regionAt(nodes, r.out) : null, outside: !!r?.outside };
    }
    case 'obstacle': {
      const set = groupRules(g);
      if (set.collide && g.inputs.scene?.connection) return { region: regionAt(nodes, g.inputs.scene.connection), outside: false };
      if (!set.obstacle) return { region: null, outside: false };
      const t = throughAdapter(nodes, g.inputs.obstacle?.connection);
      return { region: t ? regionAt(nodes, t.out) : null, outside: !!t?.outside };
    }
  }
}

/**
 * Move or reshape a shape made here. The same outline: its sliders only (a uniform write; a burst of
 * drags is one undo step). A new outline (a corner added, a new word): its lines and sockets too.
 */
export function setMadeShape(nodeId: string, next: MadeShape): void {
  const st = useNodeGraphStore.getState();
  const node = st.nodes.find(x => x.id === nodeId);
  if (!node) return;
  const patch = madeShapePatch(node, next);
  if (!('lines' in patch)) { setSetupParam(nodeId, patch, 'Agent Builder: moved a shape'); return; }
  const sliders = shapeSliders(next);
  const inputs: GraphNode['inputs'] = {
    uv: node.inputs.uv ?? { type: 'vec2', label: 'uv (vec2)' },
    ...Object.fromEntries(sliders.map(x => [x.name, node.inputs[x.name] ?? { type: 'float', label: `${x.name} (float)` }])),
  };
  undoManager.push(st.nodes, { label: 'Agent Builder: reshaped a shape' });
  useNodeGraphStore.setState({ nodes: st.nodes.map(x => (x.id === nodeId ? { ...x, inputs, params: { ...x.params, ...patch } } : x)) });
  st.compile();
}

/** Obstacles: turn back or slide along the wall (Move's On obstacle). */
export function setObstacleMode(groupId: string, on: 'turn' | 'slide'): AgentRuleSet | null {
  const st = useNodeGraphStore.getState();
  const g = st.nodes.find(x => x.id === groupId);
  if (!g) return null;
  const set = groupRules(g);
  if (!set.obstacle) return null;
  const next = { ...set, obstacle: { on } };
  undoManager.push(st.nodes, { label: 'Agent Builder: walls' });
  useNodeGraphStore.setState({ nodes: st.nodes.map(x => (x.id === groupId ? applyRulesToGroup(x, next) : x)) });
  st.compile();
  return next;
}
