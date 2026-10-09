/**
 * block.ts — a chain as an Expression Block (docs/expression-builder.md, "Add to graph"):
 *
 *   inputs   uv (vec2, wired from a UV node), s1_a, s2_a… (sliders: the steps' number holes)
 *   lines    vec2 s1 = fract(uv * s1_a)   /* repeat: repeats it in cells (from Fractal Rings) *\/
 *            vec2 s2 = s1 - s2_a          /* move: shifts it (from …) *\/
 *            float s3 = length(s2)        /* distance: measures a distance (from …) *\/
 *   result   s3
 *
 * The seed is wired from a UV or Time node; a world position or a plain variable is left as an
 * input to wire. The chain is stored on the block (`__exprChain`) so phase 5 can reopen it.
 *
 * The builder's pictures render this same block (with stand-ins for an unwired seed and the tile's
 * candidates as extra lines), so what you add is what you saw. Pure.
 */
import type { GraphNode, InputSocket } from '../types/nodeGraph';
import type { GlslType } from '../lib/glslPatterns';
import { chainEnd, isSliderHole, localName, sliderName, stepCode, stepNote, type Chain, type ChainStep, type ExprSeed } from './chain';

/** The param a built block keeps its chain in. */
export const CHAIN_KEY = '__exprChain';

export interface StoredChain { v: 1; seed: ExprSeed; steps: ChainStep[] }

export function storedChain(chain: Chain): StoredChain {
  return { v: 1, seed: structuredClone(chain.seed), steps: structuredClone(chain.steps) };
}

/** The chain a block was built from, when the builder made it. */
export function chainOfBlock(node: Pick<GraphNode, 'params'>): Chain | null {
  const s = node.params[CHAIN_KEY] as StoredChain | undefined;
  if (!s || s.v !== 1 || !s.seed || !Array.isArray(s.steps)) return null;
  return { seed: s.seed, steps: s.steps };
}

/** Block output types the Expression Block can have. */
const OUT_TYPES = new Set<GlslType>(['float', 'vec2', 'vec3', 'vec4']);

const commentSafe = (s: string) => s.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim();

export interface BlockInput { name: string; type: string; slider: { min: number; max: number } | null }

/** The block's inputs, lines and result for a chain (its first `upTo` steps). */
export function chainBlockParams(chain: Chain, upTo = chain.steps.length): {
  inputs: BlockInput[]; values: Record<string, number>; lines: Array<{ lhs: string; op: string; rhs: string }>; result: string; outputType: string;
} {
  const steps = chain.steps.slice(0, upTo);
  const inputs: BlockInput[] = [{ name: chain.seed.name, type: chain.seed.type, slider: null }];
  const values: Record<string, number> = {};
  const lines: Array<{ lhs: string; op: string; rhs: string }> = [];
  let prev = chain.seed.name;
  steps.forEach((s, i) => {
    for (const h of s.holes) {
      if (!isSliderHole(h)) continue;
      const name = sliderName(i, h);
      inputs.push({ name, type: 'float', slider: { min: h.min, max: h.max } });
      values[name] = h.value;
    }
    const code = stepCode(s, prev, { sliders: true, index: i });
    const name = localName(i);
    lines.push({ lhs: `${s.sig.out} ${name}`, op: '=', rhs: `${code} /* ${commentSafe(stepNote(s, true))} */` });
    prev = name;
  });
  const end = chainEnd(chain, upTo);
  return { inputs, values, lines, result: end.name, outputType: OUT_TYPES.has(end.type) ? end.type : 'float' };
}

/** A label for the block: the steps' names ("repeat → move → distance"). */
export function chainTitle(chain: Chain, upTo = chain.steps.length): string {
  const words = chain.steps.slice(0, upTo).map(s => s.label);
  return words.length ? `${chain.seed.label} → ${words.join(' → ')}` : chain.seed.label;
}

/** The block's note (its Note page): the seed, then each step with what it does and where it came from. */
export function chainNote(chain: Chain, upTo = chain.steps.length): string {
  const steps = chain.steps.slice(0, upTo);
  const seedLine = chain.seed.kind === 'uv' || chain.seed.kind === 'time'
    ? `Built in the Expression Builder from ${chain.seed.label} (wired into ${chain.seed.name}).`
    : `Built in the Expression Builder from ${chain.seed.label.toLowerCase()}: wire it into ${chain.seed.name}.`;
  return [seedLine, ...steps.map((s, i) => `${localName(i)} = ${stepNote(s)}.`), 'The s… sliders are the moves\' numbers.'].join('\n');
}

/**
 * The Expression Block for a chain. `seedFrom` wires the seed input; without it the seed is an
 * open input.
 */
export function chainBlock(chain: Chain, opts: { id: string; upTo?: number; seedFrom?: { nodeId: string; outputKey: string } | null; position?: { x: number; y: number } }): GraphNode {
  const upTo = opts.upTo ?? chain.steps.length;
  const p = chainBlockParams(chain, upTo);
  const sockets: Record<string, InputSocket> = {};
  for (const inp of p.inputs) {
    const from = inp.name === chain.seed.name ? opts.seedFrom ?? null : null;
    sockets[inp.name] = { type: inp.type, label: inp.name, ...(from ? { connection: { ...from } } : {}) } as InputSocket;
  }
  return {
    id: opts.id, type: 'exprNode', position: opts.position ?? { x: 0, y: 0 },
    inputs: sockets,
    outputs: { result: { type: p.outputType, label: 'Result' } } as GraphNode['outputs'],
    params: {
      label: chainTitle(chain, upTo), outputType: p.outputType, lines: p.lines, result: p.result, expr: p.result,
      inputs: p.inputs, ...p.values,
      __comment: chainNote(chain, upTo),
      [CHAIN_KEY]: storedChain({ seed: chain.seed, steps: chain.steps.slice(0, upTo) }),
    },
  };
}

/** The node a seed is wired from in the graph (a UV or Time node), or null when it stays an input. */
export function seedSourceNode(seed: ExprSeed, id: string, position = { x: 0, y: 0 }): GraphNode | null {
  if (seed.kind === 'uv') return { id, type: 'uv', position, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } as GraphNode['outputs'], params: { __comment: 'The picture\'s coordinates, the Expression Builder\'s seed.' } };
  if (seed.kind === 'time') return { id, type: 'time', position, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } } as GraphNode['outputs'], params: { __comment: 'Seconds since the start, the Expression Builder\'s seed.' } };
  return null;
}
export const seedOutputKey = (seed: ExprSeed) => (seed.kind === 'uv' ? 'uv' : 'time');

/**
 * The nodes "Add to graph" makes: the seed's source (UV / Time) and the block, side by side. The
 * block comes last.
 */
export function chainGraph(chain: Chain, opts: { nextId: () => string; upTo?: number; at?: { x: number; y: number } }): { nodes: GraphNode[]; blockId: string } {
  const at = opts.at ?? { x: 0, y: 0 };
  const src = seedSourceNode(chain.seed, opts.nextId(), at);
  const blockId = opts.nextId();
  const seedFrom = chain.seed.from ?? (src ? { nodeId: src.id, outputKey: seedOutputKey(chain.seed) } : null);
  const block = chainBlock(chain, { id: blockId, upTo: opts.upTo, seedFrom, position: { x: at.x + (src ? 300 : 0), y: at.y } });
  return { nodes: [...(src ? [src] : []), block], blockId };
}

/**
 * The graph the builder's pictures render: the block, fed by its seed's source or by a stand-in
 * for an open input (a world position: the z = 0 slice of a box 4 wide; a variable: a ramp or the
 * UV), and an Output so compileGraph can compile it too.
 */
export function previewGraph(chain: Chain, upTo = chain.steps.length): { nodes: GraphNode[]; blockId: string } {
  const nodes: GraphNode[] = [];
  const seed = chain.seed;
  let seedFrom: { nodeId: string; outputKey: string };
  const uv: GraphNode = seedSourceNode(UV_LIKE, 'xb_uv')!;
  if (seed.kind === 'time') {
    nodes.push(seedSourceNode(seed, 'xb_time')!);
    seedFrom = { nodeId: 'xb_time', outputKey: 'time' };
  } else if (seed.kind === 'uv') {
    nodes.push(uv);
    seedFrom = { nodeId: 'xb_uv', outputKey: 'uv' };
  } else {
    nodes.push(uv);
    const code = seed.type === 'vec3' ? (seed.kind === 'world' ? 'vec3(uv * 2.0, 0.0)' : 'vec3(uv * 0.5 + 0.5, 0.5)') : seed.type === 'vec2' ? 'uv' : 'uv.x * 0.5 + 0.5';
    nodes.push({
      id: 'xb_stand', type: 'exprNode', position: { x: 0, y: 0 },
      inputs: { uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'xb_uv', outputKey: 'uv' } } as InputSocket },
      outputs: { result: { type: seed.type, label: 'Result' } } as GraphNode['outputs'],
      params: { inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: seed.type, lines: [], result: code, expr: code },
    });
    seedFrom = { nodeId: 'xb_stand', outputKey: 'result' };
  }
  const block = chainBlock(chain, { id: 'xb_block', upTo, seedFrom });
  nodes.push(block);
  const out = block.params.outputType as string;
  const colour = out === 'vec3' ? null : out === 'vec4' ? 'result.rgb' : out === 'vec2' ? 'vec3(result, 0.0)' : 'vec3(result)';
  let final = { nodeId: 'xb_block', outputKey: 'result' };
  if (colour) {
    nodes.push({
      id: 'xb_show', type: 'exprNode', position: { x: 0, y: 0 },
      inputs: { result: { type: out, label: 'result', connection: { nodeId: 'xb_block', outputKey: 'result' } } as InputSocket },
      outputs: { result: { type: 'vec3', label: 'Result' } } as GraphNode['outputs'],
      params: { inputs: [{ name: 'result', type: out, slider: null }], outputType: 'vec3', lines: [], result: colour, expr: colour },
    });
    final = { nodeId: 'xb_show', outputKey: 'result' };
  }
  nodes.push({ id: 'xb_out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: final } as InputSocket }, outputs: {}, params: {} });
  return { nodes, blockId: 'xb_block' };
}

const UV_LIKE: ExprSeed = { kind: 'uv', name: 'uv', type: 'vec2', role: 'space', dimension: '2d', label: 'UV' };
