/**
 * hiddenBlurs.ts — compiles the hidden passes of Blur and Glow (texture) for
 * passGraph.ts (plans: blurPasses.ts; docs/blur-and-glow.md).
 *
 * For each Smooth or Bloom-chain node with a Texture wired, in a pass program
 * or the final picture: its stages are compiled as programs of their own (an
 * internal blurStage node with the node's id, so its sliders are the same
 * uniforms, ending in a Pass output), and handed back to be drawn just before
 * the first program that has the node. In those programs the node is
 * annotated with the last stage's sampler, which it then reads instead of
 * drawing the blur itself.
 *
 * Left in one pass (the node's single-pass look): a node in a repeated Pass
 * that blurs that Pass's own Previous (the hidden passes would run once, not
 * once per repeat), a node in an Agents program, and nodes past
 * MAX_HIDDEN_PASSES.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { PassProgram } from './types';
import type { generateFragmentShader } from './shaderAssembler';
import { PASS_SCALES, passRepeat, passUniform } from '../nodes/definitions/passes';
import { BLUR_NODE_TYPES, MAX_HIDDEN_PASSES, blurMethod, hiddenSlug, planBlur } from './blurPasses';
import { getNodeDefinitionFor } from '../nodes/definitions';

/** The final picture's key in `before` / annotate. */
export const FINAL = '__final__';

type Wire = { nodeId: string; outputKey: string };
interface ListLike { nodes: Map<string, GraphNode>; reads: Set<string>; readsPrevious: Set<string>; agentReads?: Set<string> }

export interface HiddenBlurCtx {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  slugs: Map<string, string>;
  order: string[];
  passLists: Map<string, ListLike>;
  finalList: ListLike;
  agents: boolean;
  afterAgents: Set<string>;
  beforeParticles: Set<string>;
  live: Set<string>;
  /** passGraph's collect(): the ancestors of wires, Pass nodes joining as sources. */
  collect: (starts: Wire[]) => ListLike;
  compileList: (list: GraphNode[], pictureScale?: number) => ReturnType<typeof generateFragmentShader>;
  absorb: (r: ReturnType<typeof generateFragmentShader>) => void;
}

export interface HiddenBlurs {
  /** Hidden passes to draw just before a pass (by id) or FINAL. */
  before: Map<string, PassProgram[]>;
  /** Hidden slugs a program reads (added to its `reads`). */
  reads: Map<string, string[]>;
  errors: string[];
  /** The list with its blur nodes annotated for this program (unchanged when none is). */
  annotate: (list: GraphNode[], program: string) => GraphNode[];
}

const nodeLabel = (n: GraphNode) => {
  const own = typeof n.params.label === 'string' ? n.params.label.trim() : '';
  return own || getNodeDefinitionFor(n)?.label || n.type;
};

export function planHiddenBlurs(ctx: HiddenBlurCtx): HiddenBlurs {
  const before = new Map<string, PassProgram[]>();
  const reads = new Map<string, string[]>();
  const errors: string[] = [];
  // node id → (programs it is annotated in, params added there)
  const ann = new Map<string, { programs: Set<string>; params: Record<string, unknown> }>();
  let budget = MAX_HIDDEN_PASSES;
  const out: HiddenBlurs = {
    before, reads, errors,
    annotate: (list, program) => (ann.size ? list.map(n => {
      const a = ann.get(n.id);
      return a && a.programs.has(program) ? { ...n, params: { ...n.params, ...a.params } } : n;
    }) : list),
  };
  for (const node of ctx.nodes) {
    if (!BLUR_NODE_TYPES.has(node.type)) continue;
    const method = blurMethod(node);
    const wire = node.inputs.texture?.connection;
    if (method === 'fast' || !wire) continue;
    const src = ctx.byId.get(wire.nodeId);
    if (!src) continue;
    // Programs that have the node, in drawing order; then whether each can read hidden passes.
    const programs = [...ctx.order.filter(id => ctx.passLists.get(id)!.nodes.has(node.id)), ...(ctx.finalList.nodes.has(node.id) ? [FINAL] : [])];
    const usable = programs.filter(id => {
      if (id === FINAL) return true;
      const pass = ctx.byId.get(id)!;
      return !(passRepeat(pass.params.repeat) > 1 && wire.nodeId === id && wire.outputKey === 'previous');
    });
    if (!usable.length) continue;
    const srcScale = src.type === 'pass' ? (PASS_SCALES[String(src.params.scale ?? '1')] ?? 1) : 1;
    const radius = typeof node.params.radius === 'number' ? node.params.radius : (node.type === 'glowTexture' ? 12 : 8);
    const plan = planBlur(method, radius, srcScale, node.type === 'glowTexture');
    if (!plan || plan.stages.length > budget) continue;
    budget -= plan.stages.length;

    const first = usable[0];
    const slug = ctx.slugs.get(node.id) ?? node.id;
    const slugOf = (key: string) => hiddenSlug(slug, key);
    const source = ctx.collect([wire]);
    const srcReads = [...source.reads].map(r => ctx.slugs.get(r)!);
    const srcPrev = [...source.readsPrevious].map(r => ctx.slugs.get(r)!);
    // Sliders driven by a wire (a group's param socket: __param_<key>): every stage computes the wire too.
    const paramInputs = Object.fromEntries(Object.entries(node.inputs).filter(([k, i]) => k.startsWith('__param_') && i.connection));
    const params = ctx.collect(Object.values(paramInputs).map(i => i.connection!));
    const parReads = [...params.reads].map(r => ctx.slugs.get(r)!);
    const parPrev = [...params.readsPrevious].map(r => ctx.slugs.get(r)!);
    const stage = first === FINAL ? undefined : first;
    const afterAgents = ctx.agents ? (stage ? ctx.afterAgents.has(stage) : true) : undefined;
    const beforeParticles = stage ? ctx.beforeParticles.has(stage) : false;
    const live = usable.some(id => id === FINAL || ctx.live.has(id));
    const label = nodeLabel(node);
    const list: PassProgram[] = [];
    let failed = false;
    for (const st of plan.stages) {
      const fromSource = st.reads.includes('source');
      const samplerParams = Object.fromEntries(Object.entries(st.samplers).map(([k, key]) => [k, passUniform(slugOf(key))]));
      const stageNode: GraphNode = {
        id: node.id, type: 'blurStage', position: { x: 0, y: 0 }, outputs: {},
        params: { ...node.params, ...st.params, ...samplerParams },
        inputs: { ...paramInputs, ...(fromSource ? { texture: { type: 'texture', label: 'Texture', connection: wire } } : {}) },
      };
      const sink: GraphNode = {
        id: `${node.id}__bl${st.key}`, type: 'passOutput', position: { x: 0, y: 0 }, params: {}, outputs: {},
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: node.id, outputKey: 'color' } },
          alpha: { type: 'float', label: 'Alpha', connection: { nodeId: node.id, outputKey: 'alpha' } },
        },
      };
      let r: ReturnType<typeof generateFragmentShader>;
      try { r = ctx.compileList([...new Map([...(fromSource ? source.nodes : []), ...params.nodes]).values(), stageNode, sink], st.scale); } catch (e) {
        errors.push(`Node ${node.id}: ${label}'s hidden pass: ${e instanceof Error ? e.message : 'did not compile'}`);
        failed = true;
        break;
      }
      ctx.absorb(r);
      list.push({
        nodeId: node.id, slug: slugOf(st.key), label: `${label} · ${st.label}`, fragmentShader: r.fragmentShader,
        reads: [...new Set([...(fromSource ? srcReads : []), ...parReads, ...st.reads.filter(k => k !== 'source').map(slugOf)])],
        readsPrevious: [...new Set([...(fromSource ? srcPrev : []), ...parPrev])],
        scale: st.scale, format: 'half', filter: 'linear', wrap: 'clamp',
        previous: false, live, nodeIds: [], hidden: true,
        ...(afterAgents !== undefined ? { afterAgents } : {}),
        ...(beforeParticles ? { beforeParticles: true } : {}),
      });
    }
    if (failed) continue;
    before.set(first, [...(before.get(first) ?? []), ...list]);
    const outSlug = slugOf(plan.out);
    for (const id of usable) if (id !== FINAL) reads.set(id, [...(reads.get(id) ?? []), outSlug]);
    ann.set(node.id, {
      programs: new Set(usable),
      params: {
        __blurSrc: passUniform(outSlug), __blurScale: plan.outScale, __blurCubic: plan.cubic, __blurSrcScale: srcScale,
        ...(plan.levels ? { __blurLevels: plan.levels } : {}),
      },
    });
  }
  return out;
}
