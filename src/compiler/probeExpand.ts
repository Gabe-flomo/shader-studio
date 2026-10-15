/**
 * probeExpand.ts — Value at point (nodes/definitions/probe.ts) into one shared tiny Pass, before the pass compile
 * (compiler/passGraph.ts), as the memory nodes are (memoryExpand.ts):
 *
 *   Value at point step (`__probe__pack`) ──▶ Pass `__probe` (N × N full float, nearest; texel i is probe i)
 *   Value at point read (each probe's own id) ──▶ every wire out of it
 *
 * The Pass's params carry `__pinUv` (each probe's point): its program sets `g_uv` to texel i's point before anything
 * runs, and reads `u_resolution` as the picture's (`u_pictureRes`), so the values upstream are worked out there.
 *
 * First, `expandTextProbes`: a Text whose Value is wired (and Value at: Text) gets a Value at point between, at the
 * text's Position, so a number that changes across the picture shows as one steady number.
 */
import type { GraphNode, InputSocket } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { PROBE_PACK_TYPE, PROBE_READ_TYPE, PROBE_TYPE } from '../nodes/definitions/probe';

export const PROBE_PASS_ID = '__probe';
export const PROBE_PACK_ID = '__probe__pack';

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
const wire = (nodeId: string, outputKey: string, type: InputSocket['type'], label: string): InputSocket => ({ type, label, connection: { nodeId, outputKey } });
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const isProbe = (n: GraphNode): boolean => n.type === PROBE_TYPE && !n.bypassed && !!n.inputs.value?.connection;
export const textNeedsProbe = (n: GraphNode): boolean => n.type === 'text' && !n.bypassed && !!n.inputs.value?.connection && n.params.valueAt !== 'pixel';

/** A Text with a wired Value reads it at its own Position (the middle of its first line), through a Value at point. */
export function expandTextProbes(nodes: GraphNode[]): GraphNode[] {
  if (!nodes.some(textNeedsProbe)) return nodes;
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (!textNeedsProbe(n)) { out.push(n); continue; }
    const c = n.inputs.value.connection!;
    const pid = `${n.id}__value`;
    out.push({
      id: pid, type: PROBE_TYPE, position: n.position,
      params: { pointX: num(n.params.posX, 0), pointY: num(n.params.posY, 0.06) - num(n.params.size, 0.12) * 0.5 },
      inputs: { value: wire(c.nodeId, c.outputKey, 'float', 'Value') },
      outputs: { value: { type: 'float', label: 'Value' } },
    });
    out.push({ ...n, inputs: { ...n.inputs, value: { ...n.inputs.value, connection: { nodeId: pid, outputKey: 'value' } } } });
  }
  return out;
}

export function expandProbes(nodes: GraphNode[]): GraphNode[] {
  const probes = nodes.filter(isProbe);
  if (!probes.length) return nodes;
  const index = new Map(probes.map((p, i) => [p.id, i]));
  const packInputs: GraphNode['inputs'] = {};
  const points: [number, number][] = [];
  probes.forEach((p, i) => {
    const c = p.inputs.value.connection!;
    packInputs[`v${i}`] = wire(c.nodeId, c.outputKey, 'float', `Value ${i + 1}`);
    points.push([num(p.params.pointX, 0), num(p.params.pointY, 0)]);
  });
  const pack: GraphNode = {
    id: PROBE_PACK_ID, type: PROBE_PACK_TYPE, position: probes[0].position, params: { __count: probes.length }, inputs: packInputs,
    outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  };
  const pass: GraphNode = {
    id: PROBE_PASS_ID, type: 'pass', position: probes[0].position, outputs: passOutputs(),
    params: { label: 'Values at points', scale: '1', format: 'float', filter: 'nearest', wrap: 'clamp', repeat: 1, __size: probes.length, __pinUv: points },
    inputs: { color: wire(pack.id, 'color', 'vec3', 'Color') },
  };
  const out = nodes.map(n => (index.has(n.id)
    ? { id: n.id, type: PROBE_READ_TYPE, position: n.position, params: { index: index.get(n.id) }, inputs: { state: wire(PROBE_PASS_ID, 'texture', 'texture', 'Values') }, outputs: { value: { type: 'float' as const, label: 'Value' } } }
    : n));
  return [...out, pack, pass];
}

/** The GLSL that pins g_uv to texel i's point (passGraph hands it to the probe Pass's program). */
export function pinUvGlsl(points: readonly [number, number][]): string {
  let expr = 'g_uv';
  for (let i = points.length - 1; i >= 0; i--) {
    const [x, y] = points[i];
    expr = `(pin_i == ${i} ? vec2(${x.toFixed(5)}, ${y.toFixed(5)}) : ${expr})`;
  }
  return `    { int pin_i = int(floor(gl_FragCoord.x)); g_uv = ${expr}; }\n`;
}
