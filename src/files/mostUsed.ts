/**
 * mostUsed.ts — what you reach for most, counted across saved graphs (and
 * the open one): node types (into groups too), custom functions by name,
 * Play layer kinds and the sources Play mappings read. Pure over parsed
 * graph JSON, so the Files home can show it as chips with counts.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export interface UsageCount { id: string; label: string; count: number; /** In how many graphs. */ graphs: number }

export interface MostUsed {
  nodes: UsageCount[];
  functions: UsageCount[];
  layerKinds: UsageCount[];
  sources: UsageCount[];
}

/** Words for a Play source's kind (mappings' `source.kind`). */
export const SOURCE_LABELS: Record<string, string> = {
  midi: 'MIDI', pad: 'Pad grid', mouse: 'Mouse', key: 'Keyboard', control: 'Control', lfo: 'LFO', clock: 'Clock', audio: 'Audio node',
  tilt: 'Tilt', gamepad: 'Gamepad', null: 'Null layer', osc: 'OSC', live: 'Live audio', reader: 'Audio reader', noise: 'Noise', trigger: 'Trigger',
  sensor: 'Sensor', hand: 'Hands', data: 'Data',
};

/** Words for a layer's kind. */
export const LAYER_KIND_LABELS: Record<string, string> = {
  image: 'Image', video: 'Video', text: 'Text', script: 'Script', particles: 'Particles', brush: 'Brush', bodies: 'Bodies', glyphs: 'Glyphs',
  contours: 'Contours', audio: 'Audio', drumpad: 'Drum pads', camera: 'Camera', background: 'Background', data: 'Data', shape: 'Shape', null: 'Null', cloner: 'Cloner', p5: 'p5 sketch',
};

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase());

class Counter {
  private m = new Map<string, { label: string; count: number; graphs: Set<number> }>();
  add(id: string, label: string, graph: number, n = 1) {
    const e = this.m.get(id) ?? { label, count: 0, graphs: new Set<number>() };
    e.count += n;
    e.graphs.add(graph);
    this.m.set(id, e);
  }
  list(limit: number): UsageCount[] {
    return [...this.m.entries()].map(([id, e]) => ({ id, label: e.label, count: e.count, graphs: e.graphs.size }))
      .sort((a, b) => b.count - a.count || b.graphs - a.graphs || a.label.localeCompare(b.label)).slice(0, limit);
  }
}

/** Every node in a graph, into group subgraphs at any depth. */
export function* allNodes(nodes: unknown): Generator<Obj> {
  for (const n of arr(nodes).map(obj)) {
    if (!n) continue;
    yield n;
    const sub = obj(obj(n.params)?.subgraph);
    if (sub) yield* allNodes(sub.nodes);
  }
}

export interface MostUsedOptions {
  limit?: number;
  /** Words for a node type (its definition's label); the type itself otherwise. */
  nodeLabel?: (type: string) => string | undefined;
}

/** Count across graphs (each a parsed saved graph: `nodes`, `play`). */
export function mostUsed(graphs: unknown[], opts: MostUsedOptions = {}): MostUsed {
  const limit = opts.limit ?? 12;
  const nodes = new Counter(), functions = new Counter(), layerKinds = new Counter(), sources = new Counter();
  graphs.forEach((g, gi) => {
    const graph = obj(g);
    if (!graph) return;
    for (const n of allNodes(graph.nodes)) {
      const type = str(n.type);
      if (!type) continue;
      nodes.add(type, opts.nodeLabel?.(type) ?? titleCase(type), gi);
      if (type === 'customFn') {
        const label = str(obj(n.params)?.label)?.trim() || 'Custom Function';
        functions.add(label, label, gi);
      }
    }
    const play = obj(graph.play);
    const kindNames = new Map(arr(play?.layerKinds).map(obj).filter((k): k is Obj => !!k).map(k => [str(k.id) ?? '', str(k.name) ?? 'Layer kind']));
    for (const l of arr(play?.layers).map(obj)) {
      const kind = str(l?.kind);
      if (!kind) continue;
      const kindId = str(l?.kindId);
      const id = kindId ? `kind:${kindId}` : kind;
      layerKinds.add(id, kindId ? kindNames.get(kindId) ?? LAYER_KIND_LABELS[kind] ?? titleCase(kind) : LAYER_KIND_LABELS[kind] ?? titleCase(kind), gi);
    }
    for (const m of arr(play?.mappings).map(obj)) {
      const kind = str(obj(m?.source)?.kind);
      if (kind) sources.add(kind, SOURCE_LABELS[kind] ?? titleCase(kind), gi);
    }
  });
  return { nodes: nodes.list(limit), functions: functions.list(limit), layerKinds: layerKinds.list(limit), sources: sources.list(limit) };
}

/** Which graphs (by index) hold a node of this type, and how many of it each. */
export function graphsUsingNode(graphs: unknown[], type: string): Array<{ index: number; count: number }> {
  const out: Array<{ index: number; count: number }> = [];
  graphs.forEach((g, index) => {
    let count = 0;
    for (const n of allNodes(obj(g)?.nodes)) if (n.type === type) count++;
    if (count) out.push({ index, count });
  });
  return out;
}
