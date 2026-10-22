/**
 * Advect (nodes/definitions/advect.ts, docs/advect.md): Feedback (texture)'s sibling. It opens into a step and a
 * Pass of its own exactly as Feedback does (compiler/feedbackExpand.ts), every slider is a live uniform bound to
 * the node, a loop back into it is a frame delay, and it can't be part of a field chain.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import type { CompilationResult } from '../../compiler/types';
import type { GraphNode } from '../../types/nodeGraph';
import { n } from '../../store/graphBuilder';
import { expandFeedback, feedbackStepId, isFeedbackNode } from '../../compiler/feedbackExpand';
import { findLoop, isFrameDelayWire, loopIfWired } from '../../compiler/graphLoops';
import { FIELD_IMPURE } from '../../compiler/fieldSockets';
import { paramBindingKey } from '../../compiler/uniformPatcher';
import { getNodeDefinition } from '../definitions';
import { ADVECT_LIVE_KEYS, ADVECT_STEP_TYPE, advectCombine, advectKeep, advectMixAmount, advectSwirl } from '../definitions/advect';
import { FEEDBACK_STEP_OF, FEEDBACK_STEP_TYPE } from '../definitions/textureFeedback';

const compile = (nodes: GraphNode[]) => compileGraph({ nodes }) as CompilationResult;
const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

/** A photo as Source, a Noise's Slope as Flow, the Output reading the Advect. */
function graph(params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = { texture: ['photo', 'texture'], flow: ['nz', 'slope'] }, extra: GraphNode[] = []): GraphNode[] {
  return [
    n('uv', 'uv', 0, 0),
    n('textureInput', 'photo', 0, 0),
    n('noise', 'nz', 0, 0, { dims: '2d' }, { uv: ['uv', 'uv'] }),
    n('advect', 'adv', 0, 0, { label: 'Ink', ...params }, wires),
    ...extra,
    n('output', 'out', 0, 0, {}, { color: ['adv', 'color'] }),
  ];
}
const stepShader = (r: CompilationResult) => r.passes!.find(p => p.nodeId === 'adv')!.fragmentShader;

describe('Advect: the node', () => {
  it('sits in Texture tools, found by smoke, ink, marbling; Colour, Density and Texture out', () => {
    const def = getNodeDefinition('advect')!;
    expect(def.category).toBe('Texture tools');
    expect([def.label, ...(def.aliases ?? [])].map(a => a.toLowerCase())).toEqual(expect.arrayContaining(['advect', 'smoke', 'ink in water', 'marbling']));
    expect(Object.fromEntries(Object.entries(def.outputs).map(([k, o]) => [k, o.type]))).toEqual({ color: 'vec3', alpha: 'float', texture: 'texture' });
    expect(Object.keys(def.inputs)).toEqual(expect.arrayContaining(['texture', 'colour', 'flow', 'mask']));
  });

  it('every slider but the selects is live and offered as a socket; Reset is a trigger', () => {
    const def = getNodeDefinition('advect')!;
    for (const k of ADVECT_LIVE_KEYS) {
      expect(def.paramDefs![k], k).toBeDefined();
      expect(def.paramDefs![k].compileTime, k).toBeFalsy();
      expect(def.inputs[k], k).toBeDefined();
    }
    expect(def.paramDefs!.reset.trigger).toBe(true);
    expect(def.paramDefs!.mode.options!.map(o => o.value)).toEqual(['mix', 'add', 'max']);
  });

  it('its step is registered beside Feedback\'s, hidden from the library', () => {
    expect(FEEDBACK_STEP_OF.advect).toBe(ADVECT_STEP_TYPE);
    expect(FEEDBACK_STEP_OF.textureFeedback).toBe(FEEDBACK_STEP_TYPE);
    const step = getNodeDefinition(ADVECT_STEP_TYPE)!;
    expect(step.inputs.prev.type).toBe('texture');
    expect(step.category).toBe(getNodeDefinition(FEEDBACK_STEP_TYPE)!.category);
  });
});

describe('Advect: the maths', () => {
  it('Fade is per second: 0 keeps everything; 1 keeps e^−1 after a second at any frame rate', () => {
    expect(advectKeep(1 / 60, 0)).toBe(1);
    expect(Math.pow(advectKeep(1 / 60, 1), 60)).toBeCloseTo(Math.exp(-1), 6);
    expect(Math.pow(advectKeep(1 / 30, 1), 30)).toBeCloseTo(Math.exp(-1), 6);
  });
  it('Inject in Mix mode lays in the same amount per second at 30 and 60 frames a second', () => {
    const at60 = 1 - Math.pow(1 - advectMixAmount(0.1, 1 / 60), 2);
    expect(advectMixAmount(0.1, 1 / 30)).toBeCloseTo(at60, 9);
    expect(advectMixAmount(0, 1 / 60)).toBe(0);
    expect(advectMixAmount(1, 1 / 60)).toBe(1);
  });
  it('Mix fades towards the Source, Add piles up, Max keeps the brighter', () => {
    expect(advectCombine('mix', 0.2, 1, 1, 1 / 60)).toBe(1);
    expect(advectCombine('mix', 0.2, 1, 0, 1 / 60)).toBe(0.2);
    expect(advectCombine('add', 0.2, 1, 0.1, 1 / 60)).toBeCloseTo(0.3, 9);
    expect(advectCombine('max', 0.7, 1, 0.5, 1 / 60)).toBe(0.7);
    expect(advectCombine('max', 0.2, 1, 0.5, 1 / 60)).toBe(0.5);
  });
  it('Swirl turns the flow anticlockwise: 90° turns right into up', () => {
    const [x, y] = advectSwirl(1, 0, 90);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(1, 9);
  });
});

describe('Advect: it compiles into a Pass, as Feedback (texture) does', () => {
  it('opens into an advectStep and a Pass with the node\'s id that reads its own Previous', () => {
    expect(isFeedbackNode(n('advect', 'a', 0, 0))).toBe(true);
    const { nodes, bindAs } = expandFeedback(graph());
    const pass = nodes.find(x => x.id === 'adv')!;
    expect(pass.type).toBe('pass');
    expect(pass.params.label).toBe('Ink');
    expect(pass.inputs.color.connection).toEqual({ nodeId: feedbackStepId('adv'), outputKey: 'color' });
    expect(pass.inputs.alpha.connection).toEqual({ nodeId: feedbackStepId('adv'), outputKey: 'alpha' });
    const step = nodes.find(x => x.id === feedbackStepId('adv'))!;
    expect(step.type).toBe(ADVECT_STEP_TYPE);
    expect(step.inputs.prev.connection).toEqual({ nodeId: 'adv', outputKey: 'previous' });
    expect(step.inputs.flow.connection).toEqual({ nodeId: 'nz', outputKey: 'slope' });
    expect(bindAs.get(step.id)).toBe('adv');
    expect(nodes.some(x => x.type === 'advect')).toBe(false);
    // Unlabelled, the Pass is called Advect.
    const { nodes: plain } = expandFeedback([n('advect', 'b', 0, 0)]);
    expect(plain.find(x => x.id === 'b')!.params.label).toBe('Advect');
  });

  it('compiles to a half-float buffer Pass that keeps its Previous; the picture reads it; the GLSL parses', () => {
    const r = compile(graph());
    expect(r.errors).toBeUndefined();
    const pass = r.passes!.find(p => p.nodeId === 'adv')!;
    expect(pass.previous).toBe(true);
    expect(pass.live).toBe(true);
    expect(pass.format).toBe('half');
    expect(pass.readsPrevious).toContain(pass.slug);
    expect(r.fragmentShader).toContain(`u_pass_${pass.slug}`);
    const fs = stepShader(r);
    expect(fs).toContain(`u_passprev_${pass.slug}`);
    expect(fs).toContain('u_frameDt');
    expect(parses(fs)).toBeNull();
    expect(parses(r.fragmentShader)).toBeNull();
  });

  it('alone (nothing wired) it uses the built-in curl and a drifting spot of colour', () => {
    const r = compile([n('advect', 'adv', 0, 0), n('output', 'out', 0, 0, {}, { color: ['adv', 'color'] })]);
    expect(r.errors).toBeUndefined();
    const fs = stepShader(r);
    expect(fs).toContain('vec2 advCurl(vec2 p, float t)');
    expect(fs).toMatch(/advCurl\(g_uv \* u_p_\w+, u_time\)/);
    expect(parses(fs)).toBeNull();
    // A wired Flow replaces it.
    expect(stepShader(compile(graph()))).not.toMatch(/advCurl\(g_uv/);
  });

  it('every Mode, Resolution and Edges compiles and parses; Resolution and Edges reach the Pass', () => {
    const def = getNodeDefinition('advect')!;
    for (const [k, pd] of Object.entries(def.paramDefs!)) {
      if (pd.type !== 'select') continue;
      for (const o of pd.options ?? []) {
        const r = compile(graph({ [k]: o.value }));
        expect(r.errors, `${k} ${o.value}`).toBeUndefined();
        expect(parses(stepShader(r)), `${k} ${o.value}`).toBeNull();
      }
    }
    const pass = compile(graph({ scale: '0.5', wrap: 'repeat' })).passes!.find(p => p.nodeId === 'adv')!;
    expect(pass.scale).toBe(0.5);
    expect(pass.wrap).toBe('repeat');
  });

  it('a Colour, an Inject mask and a Texture out to another texture node all work', () => {
    const r = compile([
      n('uv', 'uv', 0, 0),
      n('voronoi', 'cells', 0, 0, {}, { uv: ['uv', 'uv'] }),
      n('circleSDF', 'dot', 0, 0, { radius: 0.1 }, { position: ['uv', 'uv'] }),
      n('smoothstep', 'm', 0, 0, { edge0: 0.02, edge1: 0 }, { value: ['dot', 'distance'] }),
      n('advect', 'adv', 0, 0, { mode: 'add' }, { colour: ['cells', 'cellColour'], mask: ['m', 'result'] }),
      n('textureLevels', 'lv', 0, 0, { gain: 2 }, { texture: ['adv', 'texture'] }),
      n('output', 'out', 0, 0, {}, { color: ['lv', 'color'] }),
    ]);
    expect(r.errors).toBeUndefined();
    const fs = stepShader(r);
    expect(fs).toMatch(/_src = vec4\(/);
    expect(fs).toMatch(/clamp\(sstep_\w+_result, 0\.0, 1\.0\)/);
  });
});

describe('Advect: sliders are live uniforms', () => {
  it('each live slider is a uniform bound to the Advect node itself, inside its Pass', () => {
    const r = compile(graph({ speed: 3, fade: 0.8, swirl: 45 }));
    for (const k of ADVECT_LIVE_KEYS) {
      if (k === 'curlSize') continue; // Flow is wired: the built-in curl is not used
      const u = r.paramBindings[paramBindingKey('adv', k)];
      expect(u, k).toBeTruthy();
      expect(stepShader(r), k).toContain(u);
    }
    expect(r.paramUniforms[r.paramBindings[paramBindingKey('adv', 'speed')]]).toBe(3);
    expect(r.paramUniforms[r.paramBindings[paramBindingKey('adv', 'swirl')]]).toBe(45);
  });

  it('moving a slider (Reset included) changes no shader text', () => {
    const a = compile(graph({ speed: 2, fade: 0.3, inject: 0.5, diffuse: 0.05, swirl: 0, reset: 0 }));
    const b = compile(graph({ speed: -6, fade: 2, inject: 0.01, diffuse: 0.4, swirl: 90, reset: 1 }));
    expect(b.fragmentShader).toBe(a.fragmentShader);
    expect(b.passes!.map(p => p.fragmentShader)).toEqual(a.passes!.map(p => p.fragmentShader));
  });
});

describe('Advect: frame to frame', () => {
  const loopNodes = () => graph({}, { texture: ['photo', 'texture'], flow: ['curl', 'flow'] }, [
    n('textureFlow', 'curl', 0, 0, { direction: 'along' }, { texture: ['adv', 'texture'] }),
  ]);

  it('a wire out of it is a frame delay: its own picture can drive its Flow', () => {
    const nodes = loopNodes();
    const byId = new Map(nodes.map(x => [x.id, x]));
    expect(isFrameDelayWire({ nodeId: 'adv', outputKey: 'texture' }, byId)).toBe(true);
    expect(findLoop(nodes)).toBeNull();
    expect(loopIfWired(nodes, 'adv', 'alpha', 'adv', 'mask')).toBeNull();
    const r = compile(nodes);
    expect(r.errors).toBeUndefined();
    const pass = r.passes!.find(p => p.nodeId === 'adv')!;
    expect(pass.reads).not.toContain(pass.slug);
    expect(pass.readsPrevious).toContain(pass.slug);
  });

  it('can\'t be part of a field chain (it reads the previous frame), as Echo can\'t', () => {
    expect(FIELD_IMPURE.advect).toBe(FIELD_IMPURE.echo);
    const r = compile([
      n('advect', 'adv', 0, 0),
      n('luminance', 'lum', 200, 0, {}, { color: ['adv', 'color'] }),
      n('gridPattern', 'gp', 400, 0, {}, { shape: ['lum', 'result'] }),
      n('output', 'out', 600, 0, {}, { color: ['gp', 'color'] }),
    ]);
    expect(r.success).toBe(false);
    expect(r.errors?.join('\n')).toMatch(/^Node adv: Advect can't be part of a shape wired into Grid Pattern's Shape: it reads the previous frame\.$/m);
  });

  it('control: wired straight into an ordinary socket it compiles', () => {
    const r = compile([
      n('advect', 'adv', 0, 0),
      n('luminance', 'lum', 200, 0, {}, { color: ['adv', 'color'] }),
      n('floatToVec3', 'g', 400, 0, {}, { input: ['lum', 'result'] }),
      n('output', 'out', 600, 0, {}, { color: ['g', 'rgb'] }),
    ]);
    expect(r.errors).toBeUndefined();
  });
});
