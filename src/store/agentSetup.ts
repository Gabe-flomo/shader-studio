/**
 * agentSetup.ts — guided setup for the Agents family (docs/agents-group.md "Start here"):
 *
 * - where presets and starters land: in free space next to the graph, their own cards
 *   pulled apart so none overlaps another (`placeInFreeSpace`, `untangle`);
 * - the starters a bare Agents group offers when it is added (Particles, Slime, Empty):
 *   Emit → Agents → Draw agents (or Deposit → Trail → palette) → Output, every node with a note;
 * - "Next steps" on the group card: what a group still lacks to show anything (an Emit, a way to
 *   be seen, a trail for its Sense, the Output) and the one-click pieces that add and wire it;
 * - the starting rules an empty rule offers inside the group.
 *
 * Pure functions of the node list (ids from `nextId`); the store applies them (addNode,
 * addAgentPiece, startAgentRule) with undo, a compile and a toast.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { note } from './agentExampleKit';
import { estimateNodeHeight } from './graphLayout';
import { graphOutput } from '../nodes/scene3dDefaults';

type Conn = { nodeId: string; outputKey: string };
interface Box { x: number; y: number; w: number; h: number }

const CARD_W = 360;
/** Space kept between cards a layout places. */
const GAP = 56;
/** Space kept between a new setup and the graph already there. */
const MARGIN = 140;

// ── Ids ──────────────────────────────────────────────────────────────────────

/** `nodes` (and their insides) with fresh ids from `nextId`, every wire between them following. */
export function freshIds(nodes: GraphNode[], nextId: () => string): { nodes: GraphNode[]; idOf: (old: string) => string } {
  const ids = new Map<string, string>();
  const collect = (list: GraphNode[]) => {
    for (const nd of list) {
      ids.set(nd.id, nextId());
      const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) collect(sg.nodes);
    }
  };
  collect(nodes);
  const remap = (nd: GraphNode): GraphNode => {
    const inputs = Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection && ids.has(i.connection.nodeId)
      ? { ...i, connection: { ...i.connection, nodeId: ids.get(i.connection.nodeId)! } } : i]));
    const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
    const params = sg?.nodes ? { ...nd.params, subgraph: { ...sg, nodes: sg.nodes.map(remap) } } : nd.params;
    return { ...nd, id: ids.get(nd.id)!, inputs, params };
  };
  return { nodes: nodes.map(remap), idOf: old => ids.get(old) ?? old };
}

// ── Placement ────────────────────────────────────────────────────────────────

/** Heights (world units) of the cards as they render with their sections folded, for cards not on screen yet. */
const TYPICAL_HEIGHT: Record<string, number> = {
  agentEmit: 840, agentsGroup: 600, agentDeposit: 310, trailField: 670, drawAgents: 560, stopPalette: 590, output: 120, uv: 120,
};

/** How tall a card is: measured when it is on screen, else what it typically renders at. */
export function cardHeight(nd: GraphNode): number {
  if (typeof document !== 'undefined') {
    const el = document.querySelector<HTMLElement>(`[data-node-id="${nd.id.replace(/["\\]/g, '')}"]`);
    if (el && el.offsetHeight > 0) return el.offsetHeight;
  }
  return TYPICAL_HEIGHT[nd.type] ?? estimateNodeHeight(nd);
}

const boxOf = (nd: GraphNode, heightOf: (nd: GraphNode) => number): Box => ({ x: nd.position.x, y: nd.position.y, w: CARD_W, h: heightOf(nd) });
const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * The cards of one setup with none overlapping another: taken top to bottom, each card that
 * would sit on a card above it moves down below that card (the layout's columns stay).
 */
export function untangle(nodes: GraphNode[], heightOf: (nd: GraphNode) => number = cardHeight): GraphNode[] {
  const order = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const placed: Box[] = [];
  const at = new Map<string, { x: number; y: number }>();
  for (const nd of order) {
    const b = boxOf(nd, heightOf);
    for (let moved = true, guard = 0; moved && guard < 64; guard++) {
      moved = false;
      for (const p of placed) if (overlaps(b, p, GAP / 2)) { b.y = p.y + p.h + GAP; moved = true; }
    }
    placed.push(b);
    at.set(nd.id, { x: b.x, y: b.y });
  }
  return nodes.map(nd => ({ ...nd, position: at.get(nd.id)! }));
}

/**
 * A new setup moved into free space: where it was asked for (`want`, its top-left) if nothing
 * there is in the way, else just right of the graph or just below it, whichever is nearer to
 * `want`. Its own cards are untangled first.
 */
export function placeInFreeSpace(existing: GraphNode[], added: GraphNode[], want: { x: number; y: number }, heightOf: (nd: GraphNode) => number = cardHeight): GraphNode[] {
  const tidy = untangle(added, heightOf);
  if (!tidy.length) return tidy;
  const boxes = tidy.map(nd => boxOf(nd, heightOf));
  const minX = Math.min(...boxes.map(b => b.x)), minY = Math.min(...boxes.map(b => b.y));
  const shifted = (dx: number, dy: number) => boxes.map(b => ({ ...b, x: b.x + dx, y: b.y + dy }));
  const there = existing.map(nd => boxOf(nd, heightOf));
  const clear = (dx: number, dy: number) => !shifted(dx, dy).some(b => there.some(e => overlaps(b, e, MARGIN / 2)));
  let dx = want.x - minX, dy = want.y - minY;
  if (there.length && !clear(dx, dy)) {
    const right = Math.max(...there.map(e => e.x + e.w)) + MARGIN;
    const top = Math.min(...there.map(e => e.y));
    const left = Math.min(...there.map(e => e.x));
    const bottom = Math.max(...there.map(e => e.y + e.h)) + MARGIN;
    const options = [
      { dx: right - minX, dy: top - minY },
      { dx: left - minX, dy: bottom - minY },
    ];
    const dist = (o: { dx: number; dy: number }) => Math.hypot(o.dx - dx, o.dy - dy);
    const best = options.sort((a, b) => dist(a) - dist(b))[0];
    dx = best.dx; dy = best.dy;
  }
  return tidy.map(nd => ({ ...nd, position: { x: Math.round(nd.position.x + dx), y: Math.round(nd.position.y + dy) } }));
}

// ── Starters (a bare Agents group, added from the node browser) ─────────────

export type AgentStarter = 'particles' | 'slime';

/** The inside of a particles rule: Curl noise → Integrate, Age / Life, wired into Agent Output. */
function particlesRule(): GraphNode[] {
  return [
    n('agentInputs', 'in', 0, 160, { _groupOriginal: true, extraInputs: [], ...note([
      'Agent Inputs: this particle as each step begins. The nodes to the right read its position and velocity by themselves (their unwired sockets say "← this walker\'s …").',
    ]) }),
    n('agentCurl', 'curl', 420, 60, { strength: 0.5, size: 1.2, evolve: 0.15, ...note([
      'Curl noise: swirling currents that carry every particle. Its Force goes into Integrate.',
      'Try: Strength 1.5 for a storm; Size 3 for small eddies. Chain more forces into its "+ Another force" (Gravity, Vortex, Attract / Repel): they add up.',
    ]) }),
    n('agentIntegrate', 'move', 840, 60, { drag: 1, maxSpeed: 4, mass: 1, edges: 'free', ...note([
      'Integrate: the force becomes motion (velocity, then position). Drag slows them a little every step.',
    ]) }, { force: ['curl', 'force'] }),
    n('agentAge', 'age', 840, 640, { span: 1, ...note([
      'Age / Life: Alive drops to 0 when a particle\'s Life (from Emit) is up, so Emit gives it a new one.',
    ]) }),
    n('agentOutput', 'out', 1260, 160, { _groupOriginal: true, ...note([
      'Agent Output: the particle at the end of the step: Position and Velocity from Integrate, Alive from Age / Life.',
    ]) }, { position: ['move', 'position'], velocity: ['move', 'velocity'], alive: ['age', 'alive'] }),
  ];
}

/** The inside of a slime rule: Sense the trail → Steer → Move, the trail coming in through the Trail port. */
function slimeRule(): GraphNode[] {
  const inputs = n('agentInputs', 'in', 0, 160, { _groupOriginal: true, extraInputs: [{ key: 'trail', type: 'texture', label: 'Trail' }], ...note([
    'Agent Inputs: this walker as each step begins. Trail comes from outside the group (the Trail field\'s Image, wired into the Agents card\'s Trail socket).',
  ]) });
  inputs.outputs = { ...inputs.outputs, trail: { type: 'texture', label: 'Trail' } };
  return [
    inputs,
    n('agentSense', 'sense', 420, 60, { angle: 30, distance: 0.035, weight: 1, width: '1', ...note([
      'Sense: smells the trail at three points ahead (left, centre, right). Its Readings go into Steer.',
      'Try: a longer Distance for bigger cells; a wider Angle for rounder ones.',
    ]) }, { texture: ['in', 'trail'] }),
    n('agentSteer', 'steer', 840, 60, { mode: 'jones', turn: 45, jitter: 0.15, ...note([
      'Steer: turns toward the strongest smell (the slime-mold rule). Jitter keeps the network alive.',
    ]) }, { readings: ['sense', 'readings'] }),
    n('agentMove', 'walk', 1260, 60, { speed: 0.22, edges: 'wrap', ...note([
      'Move: one step forward along the new heading. Wrap brings walkers in on the other side.',
    ]) }, { heading: ['steer', 'heading'] }),
    n('agentOutput', 'out', 1680, 160, { _groupOriginal: true, ...note([
      'Agent Output: the walker at the end of the step: where Move took it and which way it faces.',
    ]) }, { position: ['walk', 'position'], heading: ['walk', 'heading'], velocity: ['walk', 'velocity'] }),
  ];
}

/** A rule that only walks: Move, so something visibly runs. */
function walkRule(): GraphNode[] {
  return [
    n('agentInputs', 'in', 0, 160, { _groupOriginal: true, extraInputs: [] }),
    n('agentMove', 'walk', 420, 60, { speed: 0.2, edges: 'wrap', ...note([
      'Move: every walker steps forward along its heading. Add Sense and Steer before it to make them follow something, or wire noise into Heading for a wander.',
    ]) }),
    n('agentOutput', 'out', 840, 160, { _groupOriginal: true }, { position: ['walk', 'position'], heading: ['walk', 'heading'], velocity: ['walk', 'velocity'] }),
  ];
}

export type AgentRuleStart = 'slime' | 'particles' | 'walk';
const RULES: Record<AgentRuleStart, () => GraphNode[]> = { slime: slimeRule, particles: particlesRule, walk: walkRule };

/** An Emit for a rule: everyone at once in a small disc (slime, walking), or kept full on a ring (particles). */
function emitFor(kind: AgentRuleStart, id: string, x: number, y: number): GraphNode {
  return kind === 'particles'
    ? n('agentEmit', id, x, y, { mode: 'respawn', shape: 'disc', heading: 'outward', size: 0.25, life: 3, lifeVar: 0.4, speed: 0.12, speedVar: 0.45, spread: 0.5, ...note([
      'Emit: where the particles are born: a disc in the middle, moving outward, each living 3 s ± 40% and born again when it dies (Keep full).',
      'Try: Shape Ring or Line; Speed 0.4 for sparks.',
    ]) })
    : n('agentEmit', id, x, y, { mode: 'fill', shape: 'disc', heading: 'outward', size: 0.15, life: 0, ...note([
      'Emit: where the walkers start: all at once in a small disc in the middle, facing outward, living for ever.',
      'Try: Shape Whole picture and Facing Random for a network everywhere at once.',
    ]) });
}

/** Draw agents for a rule, over `over` (what the Output showed) when given. */
function drawFor(kind: AgentRuleStart, id: string, x: number, y: number, groupId: string, over: Conn | null): GraphNode {
  const d = n('drawAgents', id, x, y, {
    style: 'glow', colorBy: kind === 'particles' ? 'speed' : 'heading', palette: kind === 'particles' ? 'ember' : 'ab', scaleBy: 'crowd', size: 1.5, brightness: 1, glow: 1, fade: 'on', lights: '0',
    ...note([
      'Draw agents: draws every walker as a small glowing dot' + (over ? ', over the picture the Output showed before' : '') + '.',
      'Try: Style Streaks for motion trails; Colour by Species, Speed or Age; Brightness for a denser look.',
    ]),
  }, { agents: [groupId, 'agents'] });
  if (over) d.inputs.over = { ...d.inputs.over, connection: over };
  return d;
}

/** Deposit → Trail field → palette (over `over`), its Image going back into the group's `port`. */
function trailFor(prefix: string, x: number, y: number, groupId: string, over: Conn | null): { nodes: GraphNode[]; out: Conn; trailId: string } {
  const dep = n('agentDeposit', `${prefix}Dep`, x, y, { amount: 1, size: 1, ...note([
    'Deposit: every walker leaves a little trail where it stands, every step. More walkers on a path leave more trail, which pulls in more walkers.',
  ]) }, { agents: [groupId, 'agents'] });
  const trail = n('trailField', `${prefix}Trail`, x + 420, y, { resolution: '512', diffuse: 1, halfLife: 0.05, edges: 'wrap', gain: 0.05, ...note([
    'Trail field: the trail spreads (Diffuse) and fades (Half-life) every step. Its Image goes back into the Agents group (the "↺ last step" wire), so the walkers can smell it; its Amount colours the picture.',
    'Try: a longer Half-life for thick, slow veins; Resolution 1024 rows for finer ones (with more walkers).',
  ]) }, { deposit: [`${prefix}Dep`, 'deposit'] });
  const colour = n('stopPalette', `${prefix}Colour`, x + 840, y, {
    stops: '5', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
    color0: [0, 0, 0], color1: [0.16, 0.05, 0.01], color2: [0.75, 0.38, 0.05], color3: [1, 0.82, 0.32], color4: [1, 0.98, 0.85],
    ...note(['Stops Palette: the trail\'s Amount as colour: black where there is none, through amber to pale gold in the thickest veins.']),
  }, { value: [`${prefix}Trail`, 'amount'] });
  const nodes = [dep, trail, colour];
  let out: Conn = { nodeId: colour.id, outputKey: 'color' };
  if (over) {
    const mix = n('exprNode', `${prefix}Over`, x + 1260, y, {
      label: 'Trail over the picture',
      inputs: [{ name: 'picture', type: 'vec3', slider: null }, { name: 'trail', type: 'vec3', slider: null }],
      outputType: 'vec3', lines: [], result: 'picture + trail', expr: 'picture + trail',
      ...note(['Trail over the picture (an Expression Block): the glowing trail added on top of what the Output showed before.']),
    });
    mix.inputs = {
      picture: { type: 'vec3', label: 'picture (vec3)', connection: over },
      trail: { type: 'vec3', label: 'trail (vec3)', connection: { nodeId: colour.id, outputKey: 'color' } },
    };
    mix.outputs = { result: { type: 'vec3', label: 'Result (vec3)' } };
    nodes.push(mix);
    out = { nodeId: mix.id, outputKey: 'result' };
  }
  return { nodes, out, trailId: trail.id };
}

/**
 * A working setup round a new Agents group (temporary ids; the caller gives it fresh ones):
 * Particles: Emit → Agents (Curl noise → Integrate, Age / Life) → Draw agents → Output.
 * Slime: Emit → Agents (Sense → Steer → Move) → Deposit → Trail field → palette → Output, the
 * Trail's Image back into the group. `over` is what the Output showed (drawn under it).
 */
export function agentStarter(kind: AgentStarter, over: Conn | null): { nodes: GraphNode[]; out: Conn; groupId: string } {
  const g = n('agentsGroup', 'group', 420, 0, {
    label: kind === 'particles' ? 'Particles' : 'Slime',
    tier: '256k', species: '1', stepsPerFrame: 2, seed: 1, preroll: 0,
    subgraph: { nodes: RULES[kind](), inputPorts: [], outputPorts: [] } satisfies SubgraphData,
    ...note([
      kind === 'particles'
        ? 'Agents: 262,144 particles (256k), each following the rule inside (double-click to open it): Curl noise pushes, Integrate moves, Age / Life ends them.'
        : 'Agents: 262,144 walkers (256k), each following the rule inside (double-click to open it): Sense the trail, Steer toward it, Move.',
      'Count raises them (1M wants a good GPU). Emit says where they are born.',
    ]),
  }, { emit: ['emit', 'emitter'] });
  const emit = emitFor(kind, 'emit', 0, 0);
  if (kind === 'particles') {
    const draw = drawFor('particles', 'draw', 840, 0, 'group', over);
    return { nodes: [emit, g, draw], out: { nodeId: 'draw', outputKey: 'color' }, groupId: 'group' };
  }
  g.inputs = { ...g.inputs, trail: { type: 'texture', label: 'Trail', connection: { nodeId: 'slTrail', outputKey: 'texture' } } };
  const t = trailFor('sl', 840, 0, 'group', over);
  return { nodes: [emit, g, ...t.nodes], out: t.out, groupId: 'group' };
}

// ── Next steps (the group card) ──────────────────────────────────────────────

export type AgentPiece = 'emit' | 'draw' | 'trail' | 'output';
export interface AgentStep { piece: AgentPiece; label: string; why: string }

const insideOf = (g: GraphNode): GraphNode[] => ((g.params.subgraph as SubgraphData | undefined)?.nodes) ?? [];
const readsFrom = (nodes: GraphNode[], id: string, type?: string) =>
  nodes.filter(nd => (!type || nd.type === type) && Object.values(nd.inputs).some(i => i.connection?.nodeId === id));

/** Every node the Output's picture depends on (top level). */
function upstreamOfOutput(nodes: GraphNode[]): Set<string> {
  const out = graphOutput(nodes);
  const seen = new Set<string>();
  if (!out) return seen;
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const stack = [out.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const i of Object.values(byId.get(id)?.inputs ?? {})) if (i.connection && byId.has(i.connection.nodeId)) stack.push(i.connection.nodeId);
  }
  return seen;
}

/** Does the rule smell a trail (a Sense reading a texture port) that nothing outside fills? */
function senseWithoutTrail(nodes: GraphNode[], g: GraphNode): boolean {
  const inside = insideOf(g);
  const senses = inside.filter(nd => nd.type === 'agentSense');
  if (!senses.length) return false;
  const ins = inside.find(nd => nd.type === 'agentInputs');
  return senses.some(s => {
    const c = s.inputs.texture?.connection;
    if (!c) return !s.inputs.field?.connection;
    if (c.nodeId !== ins?.id) return false;
    return !g.inputs[c.outputKey]?.connection;
  }) && !readsFrom(nodes, g.id, 'agentDeposit').length;
}

/**
 * What the group still lacks to show anything, in the order to add it. Empty when it is set up
 * (every preset): an Emit, something that shows the walkers (Draw agents, or a Deposit into a
 * Trail), a trail for a rule that smells one, and the picture reaching the Output.
 */
export function agentNextSteps(nodes: GraphNode[], groupId: string): AgentStep[] {
  const g = nodes.find(nd => nd.id === groupId);
  if (!g || g.type !== 'agentsGroup') return [];
  const steps: AgentStep[] = [];
  if (!g.inputs.emit?.connection) steps.push({ piece: 'emit', label: 'Emit', why: 'Choose where the walkers are born (now: anywhere on the picture, all at once).' });
  const draws = readsFrom(nodes, g.id, 'drawAgents');
  const deposits = readsFrom(nodes, g.id, 'agentDeposit');
  if (senseWithoutTrail(nodes, g)) steps.push({ piece: 'trail', label: 'Deposit + Trail', why: 'The rule\'s Sense smells a trail, but nothing lays one: walkers leave a trail with Deposit, it spreads in a Trail field and comes back in.' });
  if (!draws.length && !deposits.length) {
    steps.push({ piece: 'draw', label: 'Draw agents', why: 'Nothing shows the walkers yet: Draw agents draws them as dots over the picture.' });
    if (!steps.some(s => s.piece === 'trail')) steps.push({ piece: 'trail', label: 'Deposit + Trail', why: 'Or show the trail they leave (slime): Deposit → Trail field → a palette.' });
  } else {
    const up = upstreamOfOutput(nodes);
    const shown = [...draws, ...deposits.flatMap(d => readsFrom(nodes, d.id, 'trailField'))].some(nd => up.has(nd.id) || readsFrom(nodes, nd.id).some(r => up.has(r.id)));
    if (!shown && graphOutput(nodes)) steps.push({ piece: 'output', label: 'Show on the Output', why: 'The walkers are drawn, but the Output shows something else: wire it in.' });
  }
  return steps;
}

/** The Output's current source (what a new drawing goes over), or null. */
const outputSource = (nodes: GraphNode[]): Conn | null => graphOutput(nodes)?.inputs.color?.connection ?? null;

/** Wire `out` into the graph's Output (when there is one). */
function wireOutput(nodes: GraphNode[], out: Conn): GraphNode[] {
  const o = graphOutput(nodes);
  return o ? nodes.map(nd => nd.id === o.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: out } } } : nd) : nodes;
}

/** Is the rule a particles one (forces and Integrate) rather than a walk? */
const isParticles = (g: GraphNode) => insideOf(g).some(nd => nd.type === 'agentIntegrate');

/**
 * The graph with `piece` added round group `groupId` and wired: placed right of the group in free
 * space. Returns the new top-level list, the ids added and a sentence saying what was done.
 */
export function addAgentPieceTo(nodes: GraphNode[], groupId: string, piece: AgentPiece, nextId: () => string): { nodes: GraphNode[]; added: string[]; message: string } | null {
  const g = nodes.find(nd => nd.id === groupId);
  if (!g) return null;
  const kind: AgentRuleStart = isParticles(g) ? 'particles' : 'slime';
  const near = { x: g.position.x + 420, y: g.position.y };
  const place = (list: GraphNode[], want = near) => placeInFreeSpace(nodes.filter(nd => nd.id !== g.id), list, want);
  if (piece === 'output') {
    const draw = readsFrom(nodes, g.id, 'drawAgents')[0];
    const trail = readsFrom(nodes, g.id, 'agentDeposit').flatMap(d => readsFrom(nodes, d.id, 'trailField'))[0];
    const palette = trail ? readsFrom(nodes, trail.id).find(nd => nd.type !== 'agentsGroup' && Object.values(nd.inputs).some(i => i.connection?.nodeId === trail.id && i.connection.outputKey === 'amount')) : undefined;
    const out: Conn | null = draw ? { nodeId: draw.id, outputKey: 'color' } : palette ? { nodeId: palette.id, outputKey: Object.keys(palette.outputs)[0] } : null;
    if (!out || !graphOutput(nodes)) return null;
    return { nodes: wireOutput(nodes, out), added: [], message: 'The Output now shows the walkers.' };
  }
  if (piece === 'emit') {
    const raw = emitFor(kind, 'emit', 0, 0);
    const fresh = freshIds([raw], nextId).nodes[0];
    const [placed] = placeInFreeSpace(nodes.filter(nd => nd.id !== g.id), [fresh], { x: g.position.x - 420, y: g.position.y });
    const next = nodes.map(nd => nd.id === g.id ? { ...nd, inputs: { ...nd.inputs, emit: { ...nd.inputs.emit, connection: { nodeId: placed.id, outputKey: 'emitter' } } } } : nd);
    return { nodes: [...next, placed], added: [placed.id], message: kind === 'particles' ? 'Emit added: particles are born in a disc and reborn when they die.' : 'Emit added: walkers start in a small disc in the middle.' };
  }
  const over = outputSource(nodes);
  if (piece === 'draw') {
    const { nodes: fresh, idOf } = freshIds([drawFor(kind, 'draw', 0, 0, g.id, over)], nextId);
    // The group keeps its id: freshIds left the wire to it as it was.
    const placed = place(fresh);
    return { nodes: wireOutput([...nodes, ...placed], { nodeId: idOf('draw'), outputKey: 'color' }), added: placed.map(nd => nd.id), message: 'Draw agents added and wired to the Output: every walker is a glowing dot.' };
  }
  // Deposit + Trail: the Trail's Image goes back into the group, through its Trail port (made if missing).
  const t = trailFor('tr', 0, 0, g.id, over);
  const { nodes: fresh, idOf } = freshIds(t.nodes, nextId);
  const placed = place(fresh);
  const trailId = idOf(t.trailId);
  let next = [...nodes, ...placed];
  next = next.map(nd => {
    if (nd.id !== g.id) return nd;
    const sg = nd.params.subgraph as SubgraphData;
    let inside = sg.nodes;
    const ins = inside.find(m => m.type === 'agentInputs');
    const extras = ((ins?.params.extraInputs ?? []) as Array<{ key: string; type: string; label: string }>);
    let port = extras.find(e => e.type === 'texture')?.key;
    if (ins && !port) {
      port = 'trail';
      inside = inside.map(m => m.id === ins.id
        ? { ...m, params: { ...m.params, extraInputs: [...extras, { key: port!, type: 'texture', label: 'Trail' }] }, outputs: { ...m.outputs, [port!]: { type: 'texture', label: 'Trail' } } }
        : m);
    }
    // A Sense that smells nothing yet smells the trail.
    if (ins && port) inside = inside.map(m => m.type === 'agentSense' && !m.inputs.texture?.connection && !m.inputs.field?.connection
      ? { ...m, inputs: { ...m.inputs, texture: { ...m.inputs.texture, connection: { nodeId: ins.id, outputKey: port! } } } }
      : m);
    const inputs = port ? { ...nd.inputs, [port]: { ...(nd.inputs[port] ?? { type: 'texture' as const, label: 'Trail' }), connection: { nodeId: trailId, outputKey: 'texture' } } } : nd.inputs;
    return { ...nd, inputs, params: { ...nd.params, subgraph: { ...sg, nodes: inside } } };
  });
  const draws = readsFrom(nodes, g.id, 'drawAgents');
  // Only take the Output over when nothing of this group shows there yet.
  if (!draws.length) next = wireOutput(next, { nodeId: idOf(t.out.nodeId), outputKey: t.out.outputKey });
  return { nodes: next, added: placed.map(nd => nd.id), message: 'Deposit and a Trail field added: the walkers leave a trail that spreads and fades, and it comes back into the group for Sense (the "↺ last step" wire).' };
}

// ── An empty rule (inside the group) ─────────────────────────────────────────

/** Is the rule empty: nothing inside but Agent Inputs and Agent Output, and nothing wired into the Output? */
export function ruleIsEmpty(g: GraphNode): boolean {
  const inside = insideOf(g);
  const out = inside.find(nd => nd.type === 'agentOutput');
  return inside.every(nd => nd.type === 'agentInputs' || nd.type === 'agentOutput') && !Object.values(out?.inputs ?? {}).some(i => i.connection);
}

/** The group's inside with a starting rule (fresh ids), its anchored Agent Inputs / Output kept. */
export function startRuleIn(g: GraphNode, kind: AgentRuleStart, nextId: () => string): GraphNode[] {
  const inside = insideOf(g);
  const ins = inside.find(nd => nd.type === 'agentInputs');
  const out = inside.find(nd => nd.type === 'agentOutput');
  const rule = RULES[kind]();
  const { nodes: fresh, idOf } = freshIds(rule.filter(nd => nd.type !== 'agentInputs' && nd.type !== 'agentOutput'), nextId);
  const ruleIn = rule.find(nd => nd.type === 'agentInputs')!;
  const ruleOut = rule.find(nd => nd.type === 'agentOutput')!;
  const base = ins?.position ?? { x: 0, y: 160 };
  const wire = (nd: GraphNode, inId: string): GraphNode => ({
    ...nd,
    inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection?.nodeId === ruleIn.id
      ? { ...i, connection: { ...i.connection, nodeId: inId } }
      : i.connection ? { ...i, connection: { ...i.connection, nodeId: idOf(i.connection.nodeId) } } : i])),
  });
  const moved = fresh.map(nd => ({ ...nd, position: { x: base.x + nd.position.x, y: base.y - 160 + nd.position.y } }));
  let nextIns = ins;
  const insId = ins?.id ?? 'agentInputs';
  // The slime rule smells the Trail port: made on Agent Inputs when it has none.
  const wantsTrail = kind === 'slime';
  const extras = ((ins?.params.extraInputs ?? []) as Array<{ key: string; type: string; label: string }>);
  let port = extras.find(e => e.type === 'texture')?.key;
  if (wantsTrail && ins && !port) {
    port = 'trail';
    nextIns = { ...ins, params: { ...ins.params, extraInputs: [...extras, { key: port, type: 'texture', label: 'Trail' }] }, outputs: { ...ins.outputs, [port]: { type: 'texture', label: 'Trail' } } };
  }
  const placed = moved.map(nd => {
    const w = wire(nd, insId);
    if (w.type === 'agentSense' && port) return { ...w, inputs: { ...w.inputs, texture: { ...w.inputs.texture, connection: { nodeId: insId, outputKey: port } } } };
    return w;
  });
  const outX = Math.max(...placed.map(nd => nd.position.x)) + 420;
  const nextOut = out ? {
    ...out,
    position: { x: Math.max(out.position.x, outX), y: out.position.y },
    inputs: Object.fromEntries(Object.entries(out.inputs).map(([k, i]) => {
      const c = ruleOut.inputs[k]?.connection;
      return [k, c ? { ...i, connection: { nodeId: idOf(c.nodeId), outputKey: c.outputKey } } : i];
    })),
  } : undefined;
  return [...(nextIns ? [nextIns] : []), ...placed, ...(nextOut ? [nextOut] : []), ...inside.filter(nd => nd.type !== 'agentInputs' && nd.type !== 'agentOutput')];
}
