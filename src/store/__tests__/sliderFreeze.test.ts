/**
 * Turning a slider off freezes it at the value it has right now — plain,
 * keyframed, driven by a Play mapping, or a Play control at rest — and the
 * shader bakes exactly that value. Turning it back on resumes from there.
 * Covers every "slider off" switch: Expression Block and Custom Function
 * inputs, the Constants card's Live switch, and removing an expression knob.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { setInputSlider, type SliderInputDef } from '../../nodes/sliderFreeze';
import { currentParamValue, type CurrentValueSources } from '../../lib/currentValue';
import { evaluateKeyframes, getKeyframeConfig } from '../../compiler/keyframes';
import { formatGlslLiteral } from '../../compiler/shaderAssembler';
import { constantsItems, constantsOutputs, paramsFor, setItemLive, type ConstantsItem } from '../../nodes/definitions/constants';
import { freezeKnobInExpr, inputExprPatch, knobParamKey, numberLiteral } from '../../glsl/inputExpr';

const st = () => useNodeGraphStore.getState();
const node = (id: string) => st().nodes.find(n => n.id === id)!;
const kf = { __keyframes_a: [{ t: 0, v: 0.1 }, { t: 2, v: 0.9 }], __kfMode_a: 'loop' };

/** A code card with one float input `a` (slider 0..1 at 0.7) straight into the output. */
function codeGraph(type: 'exprNode' | 'customFn', extra: Record<string, unknown> = {}): void {
  const inputs: SliderInputDef[] = [{ name: 'a', type: 'float', slider: { min: 0, max: 1 } }];
  const params = type === 'exprNode'
    ? { inputs, outputType: 'vec3', lines: [], result: 'vec3(a)', a: 0.7, ...extra }
    : { inputs, outputType: 'vec3', body: 'return vec3(a);', label: 'Grey', a: 0.7, ...extra };
  const nodes: GraphNode[] = [
    { id: 'code', type, position: { x: 0, y: 0 }, inputs: { a: { type: 'float', label: 'a', defaultValue: 0.7 } }, outputs: { result: { type: 'vec3', label: 'Result' } }, params },
    { id: 'out', type: 'output', position: { x: 300, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'code', outputKey: 'result' } } }, outputs: {}, params: {} },
  ];
  st().replaceGraph(nodes);
}

/** What the editor's Slider switch does (ExprBlockModal / CustomFnModal toggleSlider). */
function toggle(on: boolean, src: CurrentValueSources): void {
  const n = node('code');
  const inputs = n.params.inputs as SliderInputDef[];
  const { inputs: next, params } = setInputSlider(n, inputs, 0, on, on ? 0 : currentParamValue(n, 'a', src));
  st().updateNodeParams('code', { inputs: next, ...params });
  st().updateNodeSockets('code', next as never, 'vec3');
}

const aLine = (fs: string, type: string) => type === 'exprNode'
  ? fs.split('\n').find(l => /float a = /.test(l))!.trim()
  : fs.split('\n').find(l => /customfn|grey/i.test(l) && /\(/.test(l) && !/^\s*(vec3|float) \w+\(/.test(l))!.trim();

describe.each(['exprNode', 'customFn'] as const)('%s input slider off freezes the current value', type => {
  const baked = (v: number) => formatGlslLiteral(v, 'float');
  const expectBaked = (v: number) => {
    const fs = st().fragmentShader;
    expect(aLine(fs, type)).toContain(baked(v));
    expect(fs).not.toMatch(/kf_code_a/);
  };

  beforeEach(() => codeGraph(type));

  // A live slider is a uniform (a drag writes it, no recompile); off, the value is baked.
  const expectLive = (v: number) => {
    const u = st().paramBindings['code::a'];
    expect(u).toMatch(/^u_p_/);
    expect(aLine(st().fragmentShader, type)).toContain(u);
    expect(st().paramUniforms[u]).toBeCloseTo(v, 12);
  };

  it('plain: keeps the slider value (it used to drop to 0.0)', () => {
    expectLive(0.7);
    toggle(false, { time: 0 });
    const inp = (node('code').params.inputs as SliderInputDef[])[0];
    expect(inp).toMatchObject({ slider: null, frozen: 0.7, range: { min: 0, max: 1 } });
    expectBaked(0.7);
    toggle(true, { time: 0 });
    expect((node('code').params.inputs as SliderInputDef[])[0]).toEqual({ name: 'a', type: 'float', slider: { min: 0, max: 1 } });
    expect(node('code').params.a).toBe(0.7);
    expectLive(0.7);
  });

  it('keyframed: bakes the curve at the current time and pauses the keyframes; on resumes them', () => {
    codeGraph(type, kf);
    expect(st().fragmentShader).toMatch(/kf_code_a/);
    const expected = evaluateKeyframes(getKeyframeConfig(node('code'), 'a')!, 1.3);
    toggle(false, { time: 1.3 });
    expect(node('code').params.a).toBeCloseTo(expected, 12);
    expect(node('code').params.__kfBypass_a).toBe(true);
    expectBaked(expected);
    toggle(true, { time: 0 });
    expect(node('code').params.__kfBypass_a).toBe(false);
    expect(st().fragmentShader).toMatch(/kf_code_a/);
  });

  it('driven by a Play mapping: bakes the value the mapping wrote last', () => {
    const src: CurrentValueSources = { time: 0, play: { controls: [{ id: 'c1', target: 'code::a', kind: 'float', label: 'A', min: 0, max: 1 }] }, liveValue: id => (id === 'c1' ? 0.33 : undefined) };
    toggle(false, src);
    expectBaked(0.33);
    toggle(true, { time: 0 });
    expect(node('code').params.a).toBe(0.33);
  });

  it('a Play control at rest: bakes the control\'s value (the slider\'s)', () => {
    const src: CurrentValueSources = { time: 0, play: { controls: [{ id: 'c1', target: 'code::a', kind: 'float', label: 'A', min: 0, max: 1 }] }, liveValue: () => undefined };
    toggle(false, src);
    expectBaked(0.7);
  });
});

describe('Constants Live switch off freezes the current value', () => {
  const items: ConstantsItem[] = [
    { key: 'speed', label: 'speed', type: 'float', value: 2, slider: true, min: 0, max: 10 },
    { key: 'off', label: 'off', type: 'vec2', value: [1, 2], slider: true },
  ];
  beforeEach(() => {
    st().replaceGraph([
      { id: 'k', type: 'constants', position: { x: 0, y: 0 }, inputs: {}, outputs: constantsOutputs(items), params: { items, ...paramsFor(items) } },
      { id: 'f', type: 'floatToVec3', position: { x: 0, y: 0 }, inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'k', outputKey: 'speed' } } }, outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f', outputKey: 'rgb' } } }, outputs: {}, params: {} },
    ]);
  });
  /** The editor: open, flip entry 0 (and 1) to fixed, apply. */
  const fix = (src: CurrentValueSources) => {
    let list = constantsItems(node('k'));
    list = setItemLive(node('k'), list, 0, false, src);
    list = setItemLive(node('k'), list, 1, false, src);
    st().setConstantsItems('k', list);
  };
  const speedLine = () => st().fragmentShader.split('\n').find(l => /float \w+_speed = /.test(l))!;

  it('plain: the slider was moved after the entry went live; fixed keeps where it is now, not the old value', () => {
    st().updateNodeParams('k', { speed: 4.25, off_x: 3 });
    fix({ time: 0 });
    expect(speedLine()).toContain('= 4.25;');
    expect(st().fragmentShader).toMatch(/vec2 \w+_off = vec2\(3\.0, 2\.0\);/);
  });

  it('keyframed: bakes the curve at the current time', () => {
    st().updateNodeParams('k', { __keyframes_speed: [{ t: 0, v: 1 }, { t: 4, v: 9 }] });
    const expected = evaluateKeyframes(getKeyframeConfig(node('k'), 'speed')!, 2.5);
    fix({ time: 2.5 });
    expect(speedLine()).toContain(`= ${expected};`);
  });

  it('driven by a Play mapping: bakes the last written value; a control at rest bakes the slider', () => {
    const controls = [{ id: 'c1', target: 'k::speed', kind: 'float' as const, label: 'Speed', min: 0, max: 10 }];
    fix({ time: 0, play: { controls }, liveValue: () => 6.5 });
    expect(speedLine()).toContain('= 6.5;');
    st().setConstantsItems('k', items);
    fix({ time: 0, play: { controls }, liveValue: () => undefined });
    expect(speedLine()).toContain('= 2.0;');
  });

  it('turning it live again resumes from the frozen value', () => {
    st().updateNodeParams('k', { speed: 4.25 });
    fix({ time: 0 });
    st().setConstantsItems('k', setItemLive(node('k'), constantsItems(node('k')), 0, true, { time: 0 }));
    expect(node('k').params.speed).toBe(4.25);
    expect(speedLine()).toMatch(/= u_p_\w+_speed;/);
  });
});

describe('Removing an expression knob freezes it', () => {
  it('replaces the name with its current value, so the input is unchanged', () => {
    expect(freezeKnobInExpr('input * wob + wob2 * sin(t * wob)', 'wob', 0.35)).toBe('input * 0.35 + wob2 * sin(t * 0.35)');
    expect(freezeKnobInExpr('input + k', 'k', -1)).toBe('input + (-1.0)');
    expect(freezeKnobInExpr('input + k(2.0) + v.k', 'k', 3)).toBe('input + k(2.0) + v.k');
  });

  it('compiles to the frozen literal (keyframed and Play-driven knobs too)', () => {
    const circle: GraphNode = { id: 'c', type: 'multiply', position: { x: 0, y: 0 }, inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } }, outputs: { result: { type: 'float', label: 'Result' } }, params: { outputType: 'float', a: 1, b: 0.5 } };
    st().replaceGraph([circle,
      { id: 'f', type: 'floatToVec3', position: { x: 0, y: 0 }, inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'c', outputKey: 'result' } } }, outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f', outputKey: 'rgb' } } }, outputs: {}, params: {} }]);
    const knobs = [{ name: 'wob', min: 0, max: 2 }];
    st().updateNodeParams('c', inputExprPatch(node('c'), 'b', 'input * wob', knobs, { wob: 0.8 }));
    const key = knobParamKey('b', 'wob');
    st().updateNodeParams('c', { [`__keyframes_${key}`]: [{ t: 0, v: 0 }, { t: 1, v: 2 }] });
    st().compile();
    const src: CurrentValueSources = { time: 0.25, play: { controls: [] }, liveValue: () => undefined };
    const v = currentParamValue(node('c'), key, src);
    expect(v).toBeCloseTo(evaluateKeyframes(getKeyframeConfig(node('c'), key)!, 0.25), 12);
    const expr = freezeKnobInExpr('input * wob', 'wob', v);
    expect(st().fragmentShader).toMatch(/kf_\w*wob/);
    st().updateNodeParams('c', inputExprPatch(node('c'), 'b', expr, []));
    st().compile();
    const fs = st().fragmentShader;
    expect(fs).not.toMatch(/kf_\w*wob/);
    expect(fs.split('\n').find(l => /mul\w*_result = /.test(l))).toContain(`* ${numberLiteral(v)}`);
    expect(node('c').params[key]).toBeUndefined();
  });
});
