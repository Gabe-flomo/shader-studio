/**
 * muteGate.ts — a builder mute compiled as a live bypass (docs/scene-builder.md, "Muting").
 *
 * A builder marks the node that carries a block's work with `__mute` (0 live, 1 muted). The node
 * compiles as usual, then each of its outputs is mixed toward what it would be without the block:
 *
 *   out = mix(out, through, u_<slug>_mute)
 *
 * where `through` is, in order: the input named by `__muteFrom` (the chain coming in: a point, a
 * colour) when its type matches; for a float output, `__muteTo` (a GLSL literal, e.g. a far
 * distance so a muted shape draws nothing); else the input with the output's own name and type.
 * An output with none of these stays as it is.
 *
 * The mute is a uniform, so muting and unmuting set a number: the shader text is the same either
 * way and nothing recompiles. A node without `__mute` compiles exactly as before.
 */
import type { DataType, GraphNode, NodeDefinition } from '../types/nodeGraph';

/** The node param: 0 live, 1 muted (builders/mute.ts sets it). */
export const MUTE_PARAM = '__mute';
/** The input the muted node passes through. */
export const MUTE_FROM_PARAM = '__muteFrom';
/** A float output's value while muted (a GLSL literal), where no input passes through. */
export const MUTE_TO_PARAM = '__muteTo';

const MIXABLE = new Set(['float', 'vec2', 'vec3', 'vec4']);

/** A GLSL-safe uniform name for a node's mute (no double underscores, which GLSL reserves). */
export function muteUniformName(slug: string): string {
  return `u_${slug}_mute`.replace(/[^A-Za-z0-9_]/g, '_').replace(/_{2,}/g, '_');
}

/** True when the node carries a builder mute gate. */
export function hasMuteGate(node: GraphNode): boolean {
  return typeof node.params?.[MUTE_PARAM] === 'number';
}

/**
 * The gate for one compiled node: the lines to add after its code, its outputs as gated, and the
 * uniform (name, value). Null when the node has no gate or nothing could be gated.
 */
export function muteGate(
  node: GraphNode,
  def: NodeDefinition,
  slug: string,
  inputVars: Record<string, string>,
  outputVars: Record<string, string>,
  outputType: (key: string, fallback: DataType) => DataType,
): { code: string; outputVars: Record<string, string>; uniform: string; value: number } | null {
  if (!hasMuteGate(node)) return null;
  const value = Number(node.params[MUTE_PARAM]) > 0 ? 1 : 0;
  const uniform = muteUniformName(slug);
  const from = typeof node.params[MUTE_FROM_PARAM] === 'string' ? node.params[MUTE_FROM_PARAM] as string : '';
  const to = typeof node.params[MUTE_TO_PARAM] === 'string' ? (node.params[MUTE_TO_PARAM] as string).trim() : '';
  const inType = (k: string): string | undefined => node.inputs?.[k]?.type ?? def.inputs[k]?.type;
  const out: Record<string, string> = { ...outputVars };
  let code = '';
  for (const [key, v] of Object.entries(outputVars)) {
    const fallback = (node.outputs?.[key]?.type ?? def.outputs[key]?.type ?? 'float') as DataType;
    const type = outputType(key, fallback);
    if (!MIXABLE.has(type)) continue;
    let through: string | undefined;
    if (from && inType(from) === type && inputVars[from]) through = inputVars[from];
    else if (to && type === 'float') through = to;
    else if (inType(key) === type && inputVars[key]) through = inputVars[key];
    if (!through) continue;
    const name = `${slug}_mt_${key}`.replace(/_{2,}/g, '_');
    code += `    ${type} ${name} = mix(${v}, ${through}, ${uniform});\n`;
    out[key] = name;
  }
  if (!code) return null;
  return { code, outputVars: out, uniform, value };
}
