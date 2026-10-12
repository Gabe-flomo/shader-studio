/**
 * apply.ts — the Time Cube builder's scene as real nodes in the user's graph (docs/timecube-builder.md):
 *
 *   Time Cube ─► Time Cube View (or Frame Stack) ─► Output
 *                    ▲
 *   LFO ─────────────┘ (when the scene drives a socket: the slice, the scan, the spread…)
 *
 * Every node carries its role (`_tcRole`) and its build (`_tcBuild`); the Time Cube keeps the spec (`_tcBuilder`), so
 * Edit this one reopens it. A rebuild keeps each node's id per role (Play controls stay pointed at them), its place on
 * the canvas, and wires you made into sockets the builder doesn't set (a March Camera into Ray Origin…). Pure.
 */
import type { GraphNode, InputSocket, OutputSocket } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { placeInFreeSpace } from '../store/agentSetup';
import { ROLE_TYPE, TC_BUILD, TC_META, TC_ROLE, displayRole, normalizeSpec, specParams, type Params, type TcRole, type TimeCubeSpec } from './spec';

export interface TcMeta { v: 1; build: string; spec: TimeCubeSpec }

const roleOf = (n: GraphNode | undefined): string => (n && typeof n.params[TC_ROLE] === 'string' ? n.params[TC_ROLE] as string : '');

/** The builder's saved scene on a Time Cube it made, or null. */
export function tcMetaOf(n: GraphNode | undefined | null): TcMeta | null {
  const m = n?.type === 'timeCube' ? n.params[TC_META] as TcMeta | undefined : undefined;
  return m && typeof m === 'object' && m.v === 1 && typeof m.build === 'string' ? m : null;
}

/** The Time Cube (its id) of the build a node belongs to, from any of its nodes. */
export function timeCubeOfBuild(graph: readonly GraphNode[], anyId: string): string | null {
  const hit = graph.find(n => n.id === anyId);
  if (!hit) return null;
  if (tcMetaOf(hit)) return hit.id;
  const build = hit.params[TC_BUILD];
  if (!build) return null;
  return graph.find(n => tcMetaOf(n)?.build === build)?.id ?? null;
}

/** The nodes of one build, by role. */
export function findTcBuild(graph: readonly GraphNode[], sourceId: string): { source: GraphNode; meta: TcMeta; byRole: Map<string, GraphNode> } | null {
  const source = graph.find(n => n.id === sourceId);
  const meta = tcMetaOf(source);
  if (!source || !meta) return null;
  const mine = graph.filter(n => n.params[TC_BUILD] === meta.build && roleOf(n));
  return { source, meta, byRole: new Map(mine.map(n => [roleOf(n), n])) };
}

/**
 * The scene a build is now: its saved spec, with each built node's params as they are on the graph (a setting you
 * changed on a card is what the builder shows) and its LFO's. Pure.
 */
export function specOfBuild(graph: readonly GraphNode[], sourceId: string): TimeCubeSpec | null {
  const b = findTcBuild(graph, sourceId);
  if (!b) return null;
  const spec = normalizeSpec(b.meta.spec);
  spec.source = { ...spec.source, ...specParams(b.source.params) };
  const view = b.byRole.get('view'), stack = b.byRole.get('stack');
  if (view) { spec.display = 'cube'; spec.view = { ...spec.view, ...specParams(view.params) }; }
  else if (stack) { spec.display = 'stack'; spec.stack = { ...spec.stack, ...specParams(stack.params) }; }
  const lfo = b.byRole.get('drive');
  const shown = view ?? stack;
  const target = shown && lfo ? Object.entries(shown.inputs).find(([, s]) => s.connection?.nodeId === lfo.id)?.[0] : undefined;
  if (lfo && target) {
    const p = lfo.params;
    spec.drive = { on: true, target, waveform: (p.waveform as TimeCubeSpec['drive']['waveform']) ?? 'sine', freq: Number(p.freq ?? 1), offset: Number(p.offset ?? 0), amplitude: Number(p.amplitude ?? 1) };
  } else spec.drive = { ...spec.drive, on: false };
  return spec;
}

const NOTES: Record<TcRole, (s: TimeCubeSpec) => string> = {
  source: s => [
    'Time Cube (made by the Time Cube builder): stacks the frames of a video into one texture, a box of time.',
    `It reads ${s.source.source === 'library' ? `"${String(s.source.fileName || 'a Library video')}"` : 'the built-in test clip (a red car crossing a street)'}. Choose another video in the builder's Source section or on this card; Edit clip… trims it.`,
    'Frames and Frame size set how detailed it is; the card shows how much memory it takes.',
  ].join('\n'),
  view: () => [
    'Time Cube View (made by the Time Cube builder): draws the frames as one box in 3D, marching each ray through it.',
    'Frames before the slice (Offset) are see-through, after it solid; the frame at the slice is crisp. Every slider is a live uniform: right-click one in the builder or here to make it a Play control.',
  ].join('\n'),
  stack: () => [
    'Frame Stack (made by the Time Cube builder): draws each frame of the Time Cube as its own thin card.',
    'Layout arranges the cards (stack, fan, ring, helix, grid); the scan (Offset) lifts one out. Every slider is a live uniform.',
  ].join('\n'),
  drive: s => `LFO (made by the Time Cube builder): a ${s.drive.waveform} wave from ${round(s.drive.offset - s.drive.amplitude)} to ${round(s.drive.offset + s.drive.amplitude)}, ${round(1 / Math.max(1e-3, s.drive.freq))} s a round, driving the ${s.display === 'cube' ? 'View' : 'Frame Stack'}'s ${s.drive.target}.`,
};
const round = (v: number) => Math.round(v * 100) / 100;

/** The display sockets the builder sets (the rest keep what you wired). */
const MANAGED = new Set(['volume', 'slice', 'flowTime', 'scan', 'spread', 'morph', 'shuffle']);

function fresh(type: string, id: string): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`Time Cube builder: unknown node type ${type}`);
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(def.inputs)) inputs[k] = { type: s.type, label: s.label };
  const outputs: Record<string, OutputSocket> = {};
  for (const [k, s] of Object.entries(def.outputs)) outputs[k] = { type: s.type, label: s.label };
  return { id, type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def.defaultParams ?? {}) } };
}

export interface ApplyTcResult { nodes: GraphNode[]; sourceId: string; displayId: string; driveId: string | null }

/**
 * The graph with `spec0` built into it: new (no `sourceId`, or it isn't a build), or replacing the build of
 * `sourceId`. The Output shows the display. Pure.
 */
export function applyTimeCube(graph: readonly GraphNode[], spec0: TimeCubeSpec, opts: { nextId: () => string; sourceId?: string | null; at?: { x: number; y: number } }): ApplyTcResult {
  const spec = normalizeSpec(spec0);
  const found = opts.sourceId ? findTcBuild(graph, opts.sourceId) : null;
  const taken = new Set(graph.map(n => n.id));
  const nextId = () => { let id = opts.nextId(); while (taken.has(id)) id = opts.nextId(); taken.add(id); return id; };
  const build = found?.meta.build ?? `tc${nextId()}`;
  const show = displayRole(spec.display);
  const roles: TcRole[] = ['source', show, ...(spec.drive.on ? ['drive' as const] : [])];
  const old = found?.byRole ?? new Map<string, GraphNode>();
  const anchor = found?.source.position;
  const OFFSET: Record<TcRole, { x: number; y: number }> = { source: { x: 0, y: 0 }, view: { x: 380, y: 0 }, stack: { x: 380, y: 0 }, drive: { x: 0, y: 300 } };

  const made = new Map<TcRole, GraphNode>();
  for (const role of roles) {
    const prev = old.get(role);
    const base = prev && prev.type === ROLE_TYPE[role] ? prev : fresh(ROLE_TYPE[role], prev?.id ?? nextId());
    const params: Params = role === 'drive'
      ? { ...base.params, waveform: spec.drive.waveform, freq: spec.drive.freq, offset: spec.drive.offset, amplitude: spec.drive.amplitude }
      : { ...(getNodeDefinition(ROLE_TYPE[role])?.defaultParams ?? {}), ...spec[role] };
    for (const k of Object.keys(base.params)) if (k.startsWith('_fold')) params[k] = base.params[k];
    params.__comment = NOTES[role](spec);
    params[TC_ROLE] = role;
    params[TC_BUILD] = build;
    const position = prev ? { ...prev.position } : anchor ? { x: anchor.x + OFFSET[role].x, y: anchor.y + OFFSET[role].y } : { ...OFFSET[role] };
    made.set(role, { ...base, position, inputs: { ...base.inputs }, params });
  }
  const source = made.get('source')!, display = made.get(show)!, drive = made.get('drive') ?? null;
  source.params[TC_META] = { v: 1, build, spec: structuredClone(spec) } satisfies TcMeta;
  // The display reads the Time Cube; the LFO (when there is one) drives its socket; managed sockets otherwise go unwired
  // when what fed them was the builder's.
  const builderIds = new Set([...old.values()].map(n => n.id));
  for (const [k, s] of Object.entries(display.inputs)) {
    if (!MANAGED.has(k)) continue;
    const want = k === 'volume' ? { nodeId: source.id, outputKey: 'volume' } : drive && spec.drive.target === k ? { nodeId: drive.id, outputKey: 'value' } : null;
    if (want) display.inputs[k] = { ...s, connection: want };
    else if (s.connection && builderIds.has(s.connection.nodeId)) display.inputs[k] = { ...s, connection: undefined };
  }

  const keepIds = new Set([...made.values()].map(n => n.id));
  const gone = new Set([...old.values()].map(n => n.id).filter(id => !keepIds.has(id)));
  let rest = graph.filter(n => !builderIds.has(n.id));
  rest = rest.map(n => {
    let changed = false;
    const inputs = { ...n.inputs };
    for (const [k, s] of Object.entries(inputs)) if (s.connection && gone.has(s.connection.nodeId)) { inputs[k] = { ...s, connection: undefined }; changed = true; }
    return changed ? { ...n, inputs } : n;
  });
  let top = [...made.values()];
  if (!found) top = placeInFreeSpace(rest as GraphNode[], top, opts.at ?? { x: 0, y: 0 });
  // The Output shows the display.
  let output = rest.find(n => (n.type === 'output' || n.type === 'vec4Output') && n.inputs.color);
  if (!output) {
    const def = getNodeDefinition('output')!;
    const d = top.find(n => n.id === display.id)!;
    output = { id: nextId(), type: 'output', position: { x: d.position.x + 400, y: d.position.y }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
    rest = [...rest, output];
  }
  const outId = output.id;
  rest = rest.map(n => (n.id === outId ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { nodeId: display.id, outputKey: 'color' } } } } : n));
  return { nodes: [...rest, ...top], sourceId: source.id, displayId: display.id, driveId: drive?.id ?? null };
}

/** The top-level node ids of a build. */
export function tcBuildIds(graph: readonly GraphNode[], sourceId: string | null | undefined): string[] {
  const b = sourceId ? findTcBuild(graph, sourceId) : null;
  return b ? [...b.byRole.values()].map(n => n.id) : [];
}
