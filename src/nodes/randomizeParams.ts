import type { GraphNode, NodeDefinition, ParamDef } from '../types/nodeGraph';
import { isParamVisible } from '../compiler/uniformPatcher';
import { isKeyframeBypassed, socketHasKeyframes } from '../compiler/keyframes';

/**
 * New random values for a node's sliders (the node card's 🎲 Randomize).
 *
 * - Every visible float/int slider not driven by a wire or by keyframes gets a value in the
 *   range the card shows: min → max, the typed max if there is one, and −max → max when the
 *   slider runs both ways. A slider with no declared range (Constant, matrix cells, …) uses −1 → 1.
 * - vec3 params: each unwired component in the param's range, or −1 → 1; colours 0 → 1.
 * - Values snap to the slider's step (whole numbers stay whole).
 */
export function randomizedParams(node: GraphNode, def: NodeDefinition, rand: () => number = Math.random): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const wired = (key: string) => !!node.inputs[key]?.connection || !!node.inputs[`__param_${key}`]?.connection;
  const keyframed = (key: string) => socketHasKeyframes(node, key) && !isKeyframeBypassed(node, key);
  const between = (lo: number, hi: number, pd: ParamDef) => snap(lo + rand() * (hi - lo), pd);

  for (const [key, pd] of Object.entries(def.paramDefs ?? {})) {
    if (!isParamVisible(pd, node.params) || wired(key) || keyframed(key)) continue;
    if (pd.type === 'float' || pd.type === 'int') {
      const [lo, hi] = floatRange(node, key, pd);
      out[key] = between(lo, hi, pd);
    } else if (pd.type === 'vec3' || pd.type === 'vec3color') {
      const cur = Array.isArray(node.params[key]) ? node.params[key] as number[] : [0, 0, 0];
      const [lo, hi] = pd.type === 'vec3color' ? [0, 1] : pd.min !== undefined || pd.max !== undefined ? [pd.min ?? -1, pd.max ?? 1] : [-1, 1];
      out[key] = ['r', 'g', 'b'].map((c, i) => (wired(`${key}_${c}`) ? cur[i] ?? 0 : between(lo, hi, pd)));
    }
  }
  return out;
}

/** Same effective range as the card's ruler (NodeComponent's float row) */
function floatRange(node: GraphNode, key: string, pd: ParamDef): [number, number] {
  const customMax = typeof node.params[`__scMax_${key}`] === 'number' ? node.params[`__scMax_${key}`] as number : null;
  const bidir = node.params[`__scBidir_${key}`] === true;
  if (customMax === null && pd.min === undefined && pd.max === undefined) return [-1, 1];
  const max = customMax ?? pd.max ?? 1;
  const min = bidir ? -max : customMax !== null ? 0 : pd.min ?? 0;
  return [min, max];
}

function snap(v: number, pd: ParamDef): number {
  const step = pd.type === 'int' ? Math.max(1, pd.step ?? 1) : pd.step ?? 0.01;
  const snapped = Math.round(v / step) * step;
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return Number(snapped.toFixed(decimals));
}

/** Whether the node has anything Randomize would change (to show the button) */
export function canRandomize(node: GraphNode, def: NodeDefinition): boolean {
  return Object.keys(randomizedParams(node, def, () => 0.5)).length > 0;
}
