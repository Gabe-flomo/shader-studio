/**
 * paramCandidates.ts — which params inside a group can become live params of
 * a published node.
 *
 * A candidate is a float slider on a node inside the subgraph (or one level
 * down, inside a nested group) that is not already driven by a wire. The
 * eligibility rules mirror the uniform patcher's: only `float` paramDefs
 * that aren't integer-stepped or compile-time, and are visible under their
 * `showWhen`. Anything not surfaced gets baked into the function as a literal.
 */

import type { SubgraphData, GraphNode, ParamDef } from '../../types/nodeGraph';
import { getNodeDefinition } from '../definitions';
import { isParamVisible } from '../../compiler/uniformPatcher';

export interface ParamCandidate {
  /** Override path the group compiler understands: "nodeId::key" or "innerGroupId::nodeId::key". */
  sourcePath: string;
  nodeLabel: string;
  /** For nested params, the inner group's label. */
  groupLabel?: string;
  paramKey: string;
  paramLabel: string;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  /** Current value inside the group (what gets baked if not surfaced). */
  value: number;
}

const SKIP_TYPES = new Set(['output', 'vec4Output', 'uv', 'pixelUV', 'time', 'mouse', 'loopIndex', 'loopCarry', 'group', 'exprNode', 'customFn']);

function labelOf(node: GraphNode): string {
  const def = getNodeDefinition(node.type);
  return (typeof node.params.label === 'string' && node.params.label.trim()) || def?.label || node.type;
}

function eligible(node: GraphNode, key: string, pd: ParamDef): boolean {
  if (pd.type !== 'float' || pd.step === 1 || pd.compileTime) return false;
  if (!isParamVisible(pd, node.params)) return false;
  // Driven from inside the group by a wire → not a free param
  if (node.inputs[`__param_${key}`]?.connection) return false;
  const sameNamed = Object.entries(node.inputs).find(([k, inp]) => k.toLowerCase() === key.toLowerCase() && inp.connection);
  return !sameNamed;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function collectParamCandidates(subgraph: SubgraphData): ParamCandidate[] {
  const out: ParamCandidate[] = [];

  const visit = (nodes: GraphNode[], prefix: string, groupLabel: string | undefined, overrides: Record<string, unknown>) => {
    for (const node of nodes) {
      if (SKIP_TYPES.has(node.type)) continue;
      const def = getNodeDefinition(node.type);
      if (!def?.paramDefs) continue;
      for (const [key, pd] of Object.entries(def.paramDefs)) {
        if (!eligible(node, key, pd)) continue;
        const overridden = overrides[`${node.id}::${key}`];
        const value = numberOr(overridden, numberOr(node.params[key], numberOr(def.defaultParams?.[key], 0)));
        out.push({
          sourcePath: `${prefix}${node.id}::${key}`,
          nodeLabel: labelOf(node),
          groupLabel,
          paramKey: key,
          paramLabel: pd.label,
          min: pd.min ?? 0,
          max: pd.max ?? 1,
          step: pd.step,
          hint: pd.hint,
          value,
        });
      }
    }
  };

  visit(subgraph.nodes, '', undefined, {});
  for (const g of subgraph.nodes) {
    if (g.type !== 'group') continue;
    const inner = g.params.subgraph as SubgraphData | undefined;
    if (!inner) continue;
    visit(inner.nodes, `${g.id}::`, labelOf(g), g.params);
  }
  return out;
}

/** Turn a label into a unique, valid GLSL identifier fragment. */
export function keyFromLabel(label: string, taken: Set<string>, fallback = 'value'): string {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^\d+/, '');
  if (!base) base = fallback;
  if (GLSL_RESERVED.has(base)) base = `${base}_`;
  let key = base;
  let i = 2;
  while (taken.has(key)) key = `${base}${i++}`;
  taken.add(key);
  return key;
}

const GLSL_RESERVED = new Set([
  'in', 'out', 'inout', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'if', 'else', 'for', 'while', 'do',
  'return', 'break', 'continue', 'discard', 'uniform', 'varying', 'attribute', 'const', 'void', 'true', 'false', 'struct',
  'sampler2D', 'precision', 'highp', 'mediump', 'lowp', 'main', 'texture', 'mix', 'step', 'length', 'normalize', 'dot', 'cross',
]);
