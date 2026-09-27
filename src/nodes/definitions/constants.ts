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
import { currentParamValue, currentVectorValue, type CurrentValueSources } from '../../lib/currentValue';
import { rangeForValue } from '../../lib/rangeMath';

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

/** A slider range that shows a value comfortably (the importer's rule: 0 to about twice it, on a round number). */
export function rangeFor(v: number): { min: number; max: number; step: number } {
  return rangeForValue(v);
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

/**
 * A live entry's value as the card has it: its params (the slider moves those,
 * not `items`), or, given `src`, what keyframes or a Play mapping hold it at
 * right now. A fixed entry's value is its own.
 */
export function liveItemValue(node: GraphNode, it: ConstantsItem, src?: CurrentValueSources): number | number[] {
  if (!it.slider) return it.value;
  const none: CurrentValueSources = { time: 0 };
  if (it.type === 'color') return currentVectorValue(node, it.key, src ?? none, it.value as number[]);
  if (it.type === 'float') {
    if (!src) { const v = node.params[it.key]; return typeof v === 'number' && Number.isFinite(v) ? v : it.value; }
    return currentParamValue(node, it.key, src, it.value as number);
  }
  return paramKeysOf(it).map((k, i) => {
    const fb = (it.value as number[])[i];
    if (!src) { const v = node.params[k]; return typeof v === 'number' && Number.isFinite(v) ? v : fb; }
    return currentParamValue(node, k, src, fb);
  });
}

/**
 * The editor's Live switch on entry `i` of its working list. Off freezes the
 * entry at the value it has right now (`src`: keyframes, a Play mapping, else
 * its slider), so the picture doesn't jump; on gives it a slider from there.
 */
export function setItemLive(node: GraphNode, items: ConstantsItem[], i: number, on: boolean, src: CurrentValueSources): ConstantsItem[] {
  const it = items[i];
  if (!it) return items;
  let patch: Partial<ConstantsItem>;
  if (on) patch = { slider: true, ...(it.type === 'float' && it.min === undefined ? rangeFor(it.value as number) : {}) };
  else {
    const was = constantsItems(node).find(o => o.key === it.key && o.type === it.type && o.slider);
    patch = { slider: false, ...(was ? { value: liveItemValue(node, was, src) } : {}) };
  }
  return items.map((x, k) => (k === i ? { ...x, ...patch } : x));
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
