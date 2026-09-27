/**
 * sliderFreeze — turning an Expression Block or Custom Function input's slider
 * off and on.
 *
 * Off freezes the input at the value it has right now (the slider, its
 * keyframes or a Play mapping: see lib/currentValue.ts) and bakes that value
 * into the shader, so the picture doesn't jump. Keyframes on the input are
 * paused, not deleted. On gives the slider back at that value, with the range
 * it had, and resumes paused keyframes.
 *
 * Stored on the input: `frozen` (the baked value), `range` (the slider's range
 * when it was turned off) and `frozenKf` (keyframes this paused). The compiler
 * reads `frozen` for an unwired input with no slider (shaderAssembler
 * resolveInputVars / resolveInputFallback); an input without it compiles as
 * before.
 */
import type { GraphNode } from '../types/nodeGraph';
import { isKeyframeBypassed, socketHasKeyframes } from '../compiler/keyframes';

export interface SliderInputDef {
  name: string;
  type: string;
  slider?: { min: number; max: number } | null;
  /** The value baked in while the slider is off. */
  frozen?: number;
  /** The slider's range when it was turned off. */
  range?: { min: number; max: number };
  /** Keyframes turning the slider off paused (turning it on resumes them). */
  frozenKf?: boolean;
  carry?: boolean;
}

/** The value an input's frozen slider holds, when it has one. */
export function frozenValueOf(node: GraphNode, inputKey: string): number | undefined {
  const inputs = node.params.inputs as SliderInputDef[] | undefined;
  if (!Array.isArray(inputs)) return undefined;
  const inp = inputs.find(i => i && i.name === inputKey);
  return inp && inp.slider == null && inp.type === 'float' && typeof inp.frozen === 'number' && Number.isFinite(inp.frozen) ? inp.frozen : undefined;
}

/**
 * Turn input `idx`'s slider on or off. `current` is the value the input has
 * right now (used when turning it off). Returns the new input list and the
 * params to write alongside it.
 */
export function setInputSlider<T extends SliderInputDef>(node: GraphNode, inputs: T[], idx: number, on: boolean, current: number): { inputs: T[]; params: Record<string, unknown> } {
  const inp = inputs[idx];
  const params: Record<string, unknown> = {};
  if (!inp) return { inputs, params };
  if (!on) {
    if (!inp.slider) return { inputs, params };
    const pause = socketHasKeyframes(node, inp.name) && !isKeyframeBypassed(node, inp.name);
    if (pause) params[`__kfBypass_${inp.name}`] = true;
    params[inp.name] = current;
    const next = { ...inp, slider: null, frozen: current, range: { ...inp.slider } } as T;
    if (pause) next.frozenKf = true; else delete next.frozenKf;
    return { inputs: inputs.map((c, i) => (i === idx ? next : c)), params };
  }
  if (inp.slider) return { inputs, params };
  const stored = node.params[inp.name];
  const value = typeof inp.frozen === 'number' ? inp.frozen : typeof stored === 'number' ? stored : 0.5;
  const r = inp.range ?? { min: 0, max: 1 };
  const slider = { min: Math.min(r.min, value), max: Math.max(r.max, value) };
  if (typeof inp.frozen === 'number' || typeof stored !== 'number') params[inp.name] = value;
  if (inp.frozenKf) params[`__kfBypass_${inp.name}`] = false;
  const next = { ...inp, slider } as T;
  delete next.frozen; delete next.range; delete next.frozenKf;
  return { inputs: inputs.map((c, i) => (i === idx ? next : c)), params };
}
