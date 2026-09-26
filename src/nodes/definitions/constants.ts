/**
 * Constants — named values in one card, each an output. A number, a pair, a
 * triple or a colour, with a name. An entry is a fixed constant (baked into the
 * shader, changed only in the card's editor) until its slider is turned on;
 * then it's a live value the card, keyframes and Play can move. No inputs, so
 * nothing upstream can rewrite a constant. The converter puts a shader's
 * `const`s and named numbers here.
 */
import type { NodeDefinition, GraphNode, ParamDef, OutputSocket, DataType } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';

export type ConstantsItemType = 'float' | 'vec2' | 'vec3' | 'color';
export interface ConstantsItem {
  /** Output socket key and param key stem; a GLSL identifier. */
  key: string;
  label: string;
  type: ConstantsItemType;
  value: number | number[];
  /** Live (slider on the card, a uniform, a Play candidate) or fixed (baked, editor-only). */
  slider: boolean;
  min?: number;
  max?: number;
  step?: number;
}

const COMPS = ['x', 'y', 'z'] as const;
const N: Record<ConstantsItemType, number> = { float: 1, vec2: 2, vec3: 3, color: 3 };
export const outputTypeOf = (t: ConstantsItemType): DataType => (t === 'color' ? 'vec3' : t);

/** The card's entries, validated (an older or hand-edited save may hold anything). */
export function constantsItems(node: GraphNode): ConstantsItem[] {
  const raw = node.params.items;
  if (!Array.isArray(raw)) return [];
  const out: ConstantsItem[] = []; const seen = new Set<string>();
  for (const it of raw as Array<Partial<ConstantsItem>>) {
    if (!it || typeof it.key !== 'string' || !/^[A-Za-z_]\w*$/.test(it.key) || seen.has(it.key)) continue;
    const type: ConstantsItemType = it.type === 'vec2' || it.type === 'vec3' || it.type === 'color' ? it.type : 'float';
    const n = N[type];
    const value = n === 1 ? (typeof it.value === 'number' ? it.value : 0) : (Array.isArray(it.value) && it.value.length >= n ? it.value.slice(0, n).map(v => (typeof v === 'number' ? v : 0)) : Array(n).fill(0));
    seen.add(it.key);
    out.push({ key: it.key, label: typeof it.label === 'string' && it.label.trim() ? it.label : it.key, type, value, slider: !!it.slider, min: it.min, max: it.max, step: it.step });
  }
  return out;
}

/** A slider range that shows a value comfortably. */
export function rangeFor(v: number): { min: number; max: number; step: number } {
  const a = Math.abs(v);
  if (a <= 1) return { min: v < 0 ? -1 : 0, max: 1, step: 0.01 };
  const top = Math.pow(10, Math.ceil(Math.log10(a * 2)));
  return { min: v < 0 ? -top : 0, max: top, step: top >= 100 ? 1 : 0.01 };
}

/** The param keys an entry's value lives under: `key` for a float or colour, `key_x`… for a vector. */
export function paramKeysOf(it: ConstantsItem): string[] {
  return it.type === 'vec2' || it.type === 'vec3' ? COMPS.slice(0, N[it.type]).map(c => `${it.key}_${c}`) : [it.key];
}

/** Param values for the entries (what the sliders and the compiler read). */
export function paramsFor(items: ConstantsItem[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const it of items) {
    if (it.type === 'vec2' || it.type === 'vec3') paramKeysOf(it).forEach((k, i) => { out[k] = (it.value as number[])[i]; });
    else out[it.key] = it.value;
  }
  return out;
}

/** Live entries as param definitions; fixed entries have none (they're baked, and not offered to sliders, keyframes or Play). */
export function constantsParamDefs(node: GraphNode): Record<string, ParamDef> {
  const defs: Record<string, ParamDef> = {};
  for (const it of constantsItems(node)) {
    if (!it.slider) continue;
    if (it.type === 'color') { defs[it.key] = { label: it.label, type: 'vec3color', hint: 'A live colour: drag the swatch, or make it a Play control.' }; continue; }
    const keys = paramKeysOf(it);
    keys.forEach((k, i) => {
      const v = it.type === 'float' ? (it.value as number) : (it.value as number[])[i];
      const r = rangeFor(v);
      defs[k] = { label: keys.length > 1 ? `${it.label} ${COMPS[i].toUpperCase()}` : it.label, type: 'float', min: it.min ?? r.min, max: it.max ?? r.max, step: it.step ?? r.step, hint: 'A live value: slide it, keyframe it, or make it a Play control.' };
    });
  }
  return defs;
}

export function constantsOutputs(items: ConstantsItem[]): Record<string, OutputSocket> {
  const out: Record<string, OutputSocket> = {};
  for (const it of items) out[it.key] = { type: outputTypeOf(it.type), label: it.label };
  return out;
}

const fmt = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export const ConstantsNode: NodeDefinition = {
  type: 'constants',
  label: 'Constants', aliases: ['values', 'numbers', 'parameters', 'knobs', 'dials', 'defines', 'const'],
  category: 'Sources',
  description:
    'Named values in one card, each an output: a number, a pair, a triple or a colour. ' +
    'An entry is a fixed constant until its slider is turned on; then it is a live value you can slide, keyframe or hand to Play. ' +
    'No inputs, so nothing can rewrite a constant from upstream. Open the editor (the # button) to add, rename, retype or remove entries.',
  inputs: {},
  outputs: { value: { type: 'float', label: 'value' } },
  defaultParams: {
    items: [{ key: 'value', label: 'value', type: 'float', value: 1, slider: false }] as ConstantsItem[],
    value: 1,
  },
  paramDefs: {},
  paramDefsFor: constantsParamDefs,
  generateGLSL: (node: GraphNode) => {
    const items = constantsItems(node);
    const lines: string[] = []; const outputVars: Record<string, string> = {};
    for (const it of items) {
      const v = `${node.id}_${it.key}`;
      const t = outputTypeOf(it.type);
      let expr: string;
      if (it.type === 'color') expr = it.slider ? pv3(node.params[it.key], it.value as number[]) : `vec3(${(it.value as number[]).map(fmt).join(', ')})`;
      else if (it.type === 'float') expr = it.slider ? p(node.params[it.key], it.value as number) : fmt(it.value as number);
      else expr = `${t}(${paramKeysOf(it).map((k, i) => (it.slider ? p(node.params[k], (it.value as number[])[i]) : fmt((it.value as number[])[i]))).join(', ')})`;
      lines.push(`    ${t} ${v} = ${expr};\n`);
      outputVars[it.key] = v;
    }
    return { code: lines.join(''), outputVars };
  },
};
