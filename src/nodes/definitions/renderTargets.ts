/**
 * Render Targets (docs/render-targets.md): several textures drawn in ONE draw (multiple render
 * targets, MRT). Up to four targets, each with its own input (float … vec4), precision (8-bit, half,
 * full float) and read (exact or smooth); all the same size. Each target is a Texture output and a
 * Previous output (it a frame ago), so a simulation can keep, say, position and velocity in one
 * target and a colour in another, worked out together once per pixel.
 *
 * The compiler opens it (compiler/renderTargetsExpand.ts) into
 *
 *   renderTargetsPack (`<id>__pack`) ──▶ Pass with the node's own id and `__extra` targets
 *
 * whose sink writes gl_FragColor (target 1) and `pc_mrt<k>` (targets 2…4) in the same draw, so the
 * node is one Pass toward the 8-Pass limit. Its outputs are the Pass's: texture / previous for target
 * 1, texture<k> / previous<k> for target k + 1.
 */
import type { DataType, GraphNode, InputSocket, NodeDefinition, OutputSocket } from '../../types/nodeGraph';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { FIELD_TYPES, inKey, type FieldType } from './dataTexture';

export const RENDER_TARGETS_TYPE = 'renderTargets';
export const RENDER_TARGETS_PACK_TYPE = 'renderTargetsPack';
export const MAX_TARGETS = 4;

export interface RenderTarget { name: string; type: FieldType; format: 'float' | 'half' | 'byte'; read: 'exact' | 'smooth' }

const sel = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

export const DEFAULT_TARGETS: RenderTarget[] = [
  { name: 'state', type: 'vec4', format: 'float', read: 'exact' },
  { name: 'colour', type: 'vec3', format: 'half', read: 'smooth' },
];

/** The node's targets, made sound: one to four, each a known type, precision and read. */
export function targetsOf(n: Pick<GraphNode, 'params'>): RenderTarget[] {
  const raw = Array.isArray(n.params.targets) && n.params.targets.length ? (n.params.targets as Partial<RenderTarget>[]) : DEFAULT_TARGETS;
  return raw.slice(0, MAX_TARGETS).map((t, i) => ({
    name: String(t?.name ?? '').trim() || `target ${i + 1}`,
    type: sel(t?.type, FIELD_TYPES, 'vec4'),
    format: sel(t?.format, ['float', 'half', 'byte'] as const, 'half'),
    read: sel(t?.read, ['exact', 'smooth'] as const, 'smooth'),
  }));
}

/** Target i's output keys: the Pass's own (texture / previous, then texture1 / previous1 …). */
export const targetTexKey = (i: number) => (i === 0 ? 'texture' : `texture${i}`);
export const targetPrevKey = (i: number) => (i === 0 ? 'previous' : `previous${i}`);

export function renderTargetsSockets(n: Pick<GraphNode, 'params'>): { inputs: Record<string, InputSocket>; outputs: Record<string, OutputSocket> } {
  const inputs: Record<string, InputSocket> = {};
  const outputs: Record<string, OutputSocket> = {};
  targetsOf(n).forEach((t, i) => {
    inputs[inKey(i)] = { type: t.type as DataType, label: t.name, hint: `What target ${i + 1} stores (${t.type}; the channels it leaves are 0, alpha 1).` };
    outputs[targetTexKey(i)] = { type: 'texture', label: t.name, hint: `Target ${i + 1} as a texture: Read channels, Sample, any texture node.` };
    outputs[targetPrevKey(i)] = { type: 'texture', label: `${t.name} (last frame)`, hint: `Target ${i + 1} as it was a frame ago: read it in what feeds this node to keep state.` };
  });
  return { inputs, outputs };
}

/** A Render Targets card's sockets follow its targets; a wire whose type no longer fits is dropped. */
export function retypeRenderTargets(n: GraphNode): GraphNode {
  if (n.type !== RENDER_TARGETS_TYPE) return n;
  const { inputs, outputs } = renderTargetsSockets(n);
  const nextIn: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(inputs)) {
    const old = n.inputs[k];
    nextIn[k] = { ...s, ...(old?.connection && old.type === s.type ? { connection: old.connection } : {}) };
  }
  return { ...n, inputs: nextIn, outputs };
}

/** A value of `type` as a vec4: the channels it leaves 0, alpha 1. */
export function asVec4(v: string, type: FieldType): string {
  return type === 'vec4' ? `(${v})` : type === 'vec3' ? `vec4(${v}, 1.0)` : type === 'vec2' ? `vec4(${v}, 0.0, 1.0)` : `vec4(${v}, 0.0, 0.0, 1.0)`;
}

/** The pack: each target's input as a vec4; target 1 as Color and Alpha, the rest as mrt<k>. */
export function packTargetsCode(node: GraphNode, inputVars: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  let code = '';
  const outputVars: Record<string, string> = {};
  targetsOf(node).forEach((t, i) => {
    const v = inputVars[inKey(i)];
    code += `    vec4 ${id}_t${i} = ${v ? asVec4(v, t.type) : 'vec4(0.0, 0.0, 0.0, 1.0)'};\n`;
    if (i === 0) { outputVars.color = `${id}_t0.rgb`; outputVars.alpha = `${id}_t0.a`; } else outputVars[`mrt${i}`] = `${id}_t${i}`;
  });
  return { code, outputVars };
}

const DEFAULTS = { targets: DEFAULT_TARGETS, scale: '1', wrap: 'clamp' };
const defaultSockets = renderTargetsSockets({ params: DEFAULTS });

export const RenderTargetsNode: NodeDefinition = {
  type: RENDER_TARGETS_TYPE,
  label: 'Render Targets (MRT)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['MRT', 'Multiple render targets', 'Render targets', 'G-buffer', 'Several textures', 'Multi target'],
  description: 'Several textures drawn in one draw: up to four targets, each with its own input (float to vec4), precision and read, all the same size. Everything feeding the node is worked out once per pixel for all of them. Each target is a Texture output and a Previous output (it a frame ago), so a simulation can keep position and velocity in one target and colour in another. Counts as one Pass.',
  // No fixed inputs: a node's sockets come from its targets (renderTargetsSockets), so loading never adds the defaults back.
  inputs: {},
  outputs: defaultSockets.outputs,
  defaultParams: DEFAULTS,
  paramDefs: {
    scale: { label: 'Size', type: 'select', section: 'Targets', hint: 'Every target\'s size relative to the picture.', options: [
      { value: '1', label: '1 (full size)' }, { value: '0.5', label: '½' }, { value: '0.25', label: '¼' }, { value: '0.125', label: '⅛' },
    ] },
    wrap: { label: 'Edges', type: 'select', section: 'Targets', hint: 'What a read past the edge sees, for every target.', options: [
      { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
    ] },
  },
  assignable: false,
  // Compiled only when the compiler hasn't opened it (compiler/renderTargetsExpand.ts always does in a graph).
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

/** What a Render Targets node draws into its targets: made by the compiler, never in a graph. */
export const RenderTargetsPackNode: NodeDefinition = {
  type: RENDER_TARGETS_PACK_TYPE,
  label: 'Render Targets pack',
  category: 'Output',
  description: 'Internal: a Render Targets node\'s inputs as one vec4 per target.',
  inputs: {},
  outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  defaultParams: DEFAULTS,
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => packTargetsCode(node, inputVars),
};
