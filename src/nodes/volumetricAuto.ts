/**
 * volumetricAuto.ts — what the Volumetric switch on a march loop builds.
 *
 * In volumetric mode the loop never stops at a surface: the ray walks right
 * through the scene and the loop's body runs at every step. On its own that
 * draws nothing (the loop's Color is for surfaces), so turning the switch on
 * also builds the usual volumetric setup, each node with a note:
 *
 *   inside the loop:  Group Inputs → Scene Distance → Volume Glow (+=)
 *   after the loop:   the loop's Glow output → Glow to Color, which takes the
 *                     place of the loop's Color wherever that was read (the
 *                     Output, usually), or goes to a free Output.
 *
 * What is already there is reused: a Scene Distance in the body, a Volume Glow
 * set to +=, or something already reading the glow. The loop remembers what it
 * added (`_volumetricAuto`); turning the switch off removes those nodes when
 * they are as they were added, keeps any that were changed (with a line added
 * to their note), and puts the loop's Color back where Glow to Color was.
 *
 * Pure: ids come from the caller; the store pushes one undo step around it.
 */

import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition, getNodeDefinitionFor } from './definitions';
import { instantiateNode } from './scene3dDefaults';

export const VOLUMETRIC_LOOP_TYPES = new Set(['marchLoopGroup', 'giLitMarchGroup']);

type Ref = { nodeId: string; outputKey: string };
type Added = { id: string; where: 'body' | 'outside'; sig: string };
export type VolumetricRecord = { added: Added[]; rewired: Array<{ nodeId: string; input: string }>; colourId: string | null; accKey: string };

const make = (nextId: () => string, type: string, at: { x: number; y: number }, params?: Record<string, unknown>): GraphNode =>
  instantiateNode(nextId(), type, getNodeDefinition(type)!, at, params);

/** What makes a node "as it was added": its settings and wiring (not its note or where it sits). */
function signature(n: GraphNode): string {
  const { __comment: _c, ...params } = n.params;
  void _c;
  const wires = Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => [k, v.connection ? `${v.connection.nodeId}.${v.connection.outputKey}` : null]));
  return JSON.stringify({ params, wires, op: n.assignOp ?? null, type: n.type });
}

/** Accumulator outputs of a loop body, in the order the compiler numbers them acc0, acc1… */
function accumulators(body: GraphNode[]): Array<{ nodeId: string; key: string }> {
  const out: Array<{ nodeId: string; key: string }> = [];
  const push = (n: GraphNode) => {
    if (!n.assignOp || n.assignOp === '=') return;
    const def = getNodeDefinitionFor(n);
    for (const [k, s] of Object.entries(def?.outputs ?? {})) if (s.type === 'float' || s.type === 'vec2' || s.type === 'vec3') out.push({ nodeId: n.id, key: k });
  };
  for (const n of body) push(n);
  for (const g of body) {
    if (g.type !== 'group') continue;
    for (const n of (g.params.subgraph as SubgraphData | undefined)?.nodes ?? []) push(n);
  }
  return out;
}

const readers = (scope: GraphNode[], ref: Ref) => scope.flatMap(n => Object.entries(n.inputs)
  .filter(([, v]) => v.connection?.nodeId === ref.nodeId && v.connection.outputKey === ref.outputKey)
  .map(([k]) => ({ nodeId: n.id, input: k })));

const setWire = (scope: GraphNode[], at: { nodeId: string; input: string }, to: Ref): GraphNode[] =>
  scope.map(n => n.id === at.nodeId && n.inputs[at.input] ? { ...n, inputs: { ...n.inputs, [at.input]: { ...n.inputs[at.input], connection: { ...to } } } } : n);

/**
 * Turn Volumetric on for `loopId` (a node in `scope`, the level the user is on),
 * building what it needs. Returns the new scope and a sentence for the toast.
 */
export function volumetricOn(nextId: () => string, scope: GraphNode[], loopId: string): { nodes: GraphNode[]; summary: string } {
  const loop = scope.find(n => n.id === loopId);
  if (!loop) return { nodes: scope, summary: '' };
  const sub = (loop.params.subgraph as SubgraphData | undefined) ?? { nodes: [], inputPorts: [], outputPorts: [] };
  const body = [...sub.nodes];
  const added: Added[] = [];
  const built: string[] = [];
  const inputs = body.find(n => n.type === 'marchLoopInputs');

  // ── Inside the loop: Scene Distance → Volume Glow (+=) ──
  let glow = body.find(n => n.type === 'volumeGlow' && n.assignOp === '+=');
  const accBefore = accumulators(body);
  if (!glow) {
    let sceneDist = body.find(n => n.type === 'marchSceneDist');
    const y = body.length ? Math.max(...body.map(n => n.position.y)) + 320 : 180;
    if (!sceneDist) {
      sceneDist = make(nextId, 'marchSceneDist', { x: 440, y }, {
        __comment: 'Added by the Volumetric switch. Measures, at every step of the ray, how far the ray\'s point (March Pos) is from the scene\'s shapes. Raw Distance is the true value, negative inside a shape, which is what Volume Glow needs.',
      });
      if (inputs) sceneDist.inputs.pos = { ...sceneDist.inputs.pos, connection: { nodeId: inputs.id, outputKey: 'marchPos' } };
      body.push(sceneDist);
      added.push({ id: sceneDist.id, where: 'body', sig: '' });
      built.push('Scene Distance');
    }
    glow = {
      ...make(nextId, 'volumeGlow', { x: 880, y }, {
        density: 0.06, falloff: 10, shell: 0,
        __comment: 'Added by the Volumetric switch. Turns that distance into a little light at every step: bright near and inside the shapes, fading with distance. Its header is set to += so the steps add up into one total, which leaves the loop as its Glow output. Raise Shell (0.1–0.2) to make only a skin glow, like a soap bubble. Raise Density for a brighter glow, lower Falloff for a wider one.',
      }),
      assignOp: '+=',
    };
    glow.inputs.dist = { ...glow.inputs.dist, connection: { nodeId: sceneDist.id, outputKey: 'rawDist' } };
    body.push(glow);
    added.push({ id: glow.id, where: 'body', sig: '' });
    built.push('Volume Glow (+=)');
  }
  const accs = accumulators(body);
  const accIndex = accs.findIndex(a => a.nodeId === glow!.id && a.key === 'glow');
  const accKey = `acc${accIndex}`;
  // A new top-level accumulator is numbered before ones nested in groups: move their wires up by one.
  const shift = accs.length - accBefore.length;
  let nodes = scope;
  if (shift > 0) {
    nodes = nodes.map(n => {
      let changed = false;
      const ins = Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => {
        const c = v.connection;
        const m = c?.nodeId === loopId ? /^acc(\d+)$/.exec(c.outputKey) : null;
        if (!m || Number(m[1]) < accIndex) return [k, v];
        changed = true;
        return [k, { ...v, connection: { nodeId: loopId, outputKey: `acc${Number(m[1]) + shift}` } }];
      }));
      return changed ? { ...n, inputs: ins } : n;
    });
  }

  // ── After the loop: Glow → Glow to Color, where the loop's Color was shown ──
  let colourId: string | null = null;
  const rewired: Array<{ nodeId: string; input: string }> = [];
  const extra: GraphNode[] = [];
  if (readers(nodes, { nodeId: loopId, outputKey: accKey }).length === 0) {
    const colour = make(nextId, 'glowToColor', { x: loop.position.x + 480, y: loop.position.y + 380 }, {
      exposure: 1.5, tint: [0.3, 0.8, 1.0],
      __comment: 'Added by the Volumetric switch. Turns the glow the loop added up into a colour (Tint × tanh(Glow × Exposure)), so bright cores fade to the tint instead of blowing out to white. It took the place of the loop\'s Color, which shows surfaces, and there are no surfaces in volumetric mode. Change Tint for the colour, Exposure for the brightness.',
    });
    colour.inputs.glow = { ...colour.inputs.glow, connection: { nodeId: loopId, outputKey: accKey } };
    colourId = colour.id;
    extra.push(colour);
    added.push({ id: colour.id, where: 'outside', sig: '' });
    built.push('Glow to Color');
    const colourRef: Ref = { nodeId: colour.id, outputKey: 'color' };
    for (const r of readers(nodes, { nodeId: loopId, outputKey: 'color' })) {
      nodes = setWire(nodes, r, colourRef);
      rewired.push(r);
    }
    if (!rewired.length) {
      const output = nodes.find(n => (n.type === 'output' || n.type === 'vec4Output') && n.inputs.color && !n.inputs.color.connection);
      if (output) { nodes = setWire(nodes, { nodeId: output.id, input: 'color' }, colourRef); rewired.push({ nodeId: output.id, input: 'color' }); }
    }
  }

  // Signatures as added (after wiring), to tell later whether the user changed them.
  const byId = new Map([...body, ...extra].map(n => [n.id, n]));
  for (const a of added) a.sig = signature(byId.get(a.id)!);

  const record: VolumetricRecord = { added, rewired, colourId, accKey };
  nodes = nodes.map(n => n.id !== loopId ? n : {
    ...n,
    outputs: { ...n.outputs, [accKey]: { type: 'float', label: 'Glow' } },
    params: { ...n.params, volumetric: true, subgraph: { ...sub, nodes: body }, ...(added.length ? { _volumetricAuto: record } : {}) },
  });
  nodes = [...nodes, ...extra];
  const shown = rewired.length ? (colourId ? ' and shown where the loop\'s Color was' : '') : (colourId ? '. Wire Glow to Color into the Output to see it' : '');
  const summary = built.length
    ? `Added ${built.join(', ')}${shown}. The ray now walks through the shapes adding glow at every step; every added node has a note.`
    : 'The loop already had a glow set up, so nothing was added.';
  return { nodes, summary };
}

/**
 * Turn Volumetric off: remove what turning it on added, where unchanged, and
 * put the loop's Color back where Glow to Color was shown.
 */
export function volumetricOff(scope: GraphNode[], loopId: string): { nodes: GraphNode[]; summary: string } {
  const loop = scope.find(n => n.id === loopId);
  if (!loop) return { nodes: scope, summary: '' };
  const record = loop.params._volumetricAuto as VolumetricRecord | undefined;
  const sub = (loop.params.subgraph as SubgraphData | undefined) ?? { nodes: [], inputPorts: [], outputPorts: [] };
  const { _volumetricAuto: _r, ...rest } = loop.params;
  void _r;
  if (!record) {
    return { nodes: scope.map(n => n.id === loopId ? { ...n, params: { ...rest, volumetric: false } } : n), summary: '' };
  }
  let body = sub.nodes;
  let nodes = scope;
  const removed: string[] = [];
  const kept: string[] = [];
  const gone = new Set<string>();
  const addedIds = new Set(record.added.map(a => a.id));
  for (const a of record.added) {
    const list = a.where === 'body' ? body : nodes;
    const n = list.find(x => x.id === a.id);
    if (!n) continue;
    const label = getNodeDefinition(n.type)?.label ?? n.type;
    // Unchanged, and read only by what was added with it (or the wires it took over): safe to take away.
    const readBy = [...body, ...nodes].filter(x => Object.values(x.inputs).some(v => v.connection?.nodeId === a.id) && !addedIds.has(x.id) && !record.rewired.some(r => r.nodeId === x.id));
    if (signature(n) === a.sig && readBy.length === 0) {
      gone.add(a.id);
      removed.push(label);
    } else {
      kept.push(label);
      const keptNote = 'Kept when Volumetric was turned off, because it had been changed. Delete it if you no longer need it.';
      const c = typeof n.params.__comment === 'string' ? n.params.__comment : '';
      const updated = { ...n, params: { ...n.params, __comment: c.includes(keptNote) ? c : `${c}${c ? '\n\n' : ''}${keptNote}` } };
      if (a.where === 'body') body = body.map(x => x.id === a.id ? updated : x);
      else nodes = nodes.map(x => x.id === a.id ? updated : x);
    }
  }
  // The loop's Color back where Glow to Color was shown.
  if (record.colourId) {
    for (const r of record.rewired) {
      const n = nodes.find(x => x.id === r.nodeId);
      if (n?.inputs[r.input]?.connection?.nodeId === record.colourId) nodes = setWire(nodes, r, { nodeId: loopId, outputKey: 'color' });
    }
  }
  const clear = (list: GraphNode[]) => list.filter(n => !gone.has(n.id)).map(n => {
    if (!Object.values(n.inputs).some(v => v.connection && gone.has(v.connection.nodeId))) return n;
    return { ...n, inputs: Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => [k, v.connection && gone.has(v.connection.nodeId) ? { ...v, connection: undefined } : v])) };
  });
  body = clear(body);
  nodes = clear(nodes);
  const glowGone = !body.some(n => n.type === 'volumeGlow' && n.assignOp === '+=');
  nodes = nodes.map(n => {
    if (n.id !== loopId) {
      // A kept Glow to Color reading a glow that is gone: unwired, not left pointing at nothing.
      if (!glowGone || !Object.values(n.inputs).some(v => v.connection?.nodeId === loopId && v.connection.outputKey === record.accKey)) return n;
      return { ...n, inputs: Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => [k, v.connection?.nodeId === loopId && v.connection.outputKey === record.accKey ? { ...v, connection: undefined } : v])) };
    }
    const outputs = { ...n.outputs };
    if (glowGone) delete outputs[record.accKey];
    return { ...n, outputs, params: { ...rest, volumetric: false, subgraph: { ...sub, nodes: body } } };
  });
  const parts = [
    removed.length ? `Removed ${removed.join(', ')}` : '',
    kept.length ? `kept ${kept.join(', ')} (changed since; see the note on ${kept.length === 1 ? 'it' : 'them'})` : '',
  ].filter(Boolean);
  const summary = `${parts.join('; ')}${parts.length ? '. ' : ''}${record.colourId ? 'The loop\'s Color is shown again.' : ''}`.trim();
  return { nodes, summary };
}
