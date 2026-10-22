/**
 * Ease (nodes/definitions/ease.ts, docs/ease-node.md): the JavaScript reference against known values of
 * Penner's curves (easings.net), the emitted GLSL run on the CPU (compiler/__tests__/glslRun.ts) against that
 * reference for every Curve × Direction, the three Loops, Speed, and every Curve × Direction × Loop compiling
 * through compileGraph (Value wired and unwired, each output into an Output) to GLSL the parser accepts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import type { CompilationResult } from '../../compiler/types';
import { compileFragment } from '../../compiler/__tests__/glslRun';
import { getNodeDefinition, NODE_REGISTRY } from '../definitions';
import {
  EASE_CURVES, EASE_DIRECTIONS, EASE_LOOPS, bounceOut, easeFnName, easeJs, easeLoopProgress,
  type EaseCurve, type EaseDirection, type EaseLoop,
} from '../definitions/ease';
import { n } from '../../store/graphBuilder';

const CURVES = EASE_CURVES.map(c => c.value);
const DIRS = EASE_DIRECTIONS.map(d => d.value);
const LOOPS = EASE_LOOPS.map(l => l.value);

/** Run the node's emitted code (and its helper functions) on the CPU; its outputs by key. */
function run(params: Record<string, unknown>, inputs: Record<string, string>): Record<string, number> {
  const def = getNodeDefinition('ease')!;
  const node = n('ease', 'N', 0, 0, params);
  const { code, outputVars } = def.generateGLSL(node, inputs);
  const src = `${def.glslFunctionsFor!(node).join('\n')}\nvoid main(){\n${code}}\n`;
  const env = compileFragment(src).run({ u_time: 0 });
  return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, env[v] as number]));
}
const lit = (x: number) => x.toFixed(6);

describe('Ease: the JavaScript reference (Penner / easings.net)', () => {
  it('matches known values', () => {
    expect(bounceOut(0.5)).toBeCloseTo(0.765625, 6);
    expect(easeJs('bounce', 'out', 0.5)).toBeCloseTo(0.765625, 6);
    expect(easeJs('cubic', 'inOut', 0.25)).toBeCloseTo(0.0625, 6);
    expect(easeJs('cubic', 'inOut', 0.75)).toBeCloseTo(0.9375, 6);
    expect(easeJs('quad', 'out', 0.5)).toBeCloseTo(0.75, 6);
    expect(easeJs('sine', 'in', 0.5)).toBeCloseTo(1 - Math.cos(Math.PI / 4), 6);
    expect(easeJs('expo', 'in', 0.5)).toBeCloseTo(0.03125, 6);
    expect(easeJs('circ', 'out', 0.5)).toBeCloseTo(Math.sqrt(0.75), 6);
    // easeOutBack(0.5) = 1 + c3(x−1)³ + c1(x−1)², c1 = 1.70158
    expect(easeJs('back', 'out', 0.5)).toBeCloseTo(1 - 2.70158 / 8 + 1.70158 / 4, 6);
    // easeOutElastic(0.5) = 2^−5 · sin((5 − 0.75) · 2π/3) + 1
    expect(easeJs('elastic', 'out', 0.5)).toBeCloseTo(Math.pow(2, -5) * Math.sin(4.25 * 2 * Math.PI / 3) + 1, 6);
    expect(easeJs('steps', 'in', 0.5, 4)).toBe(0.5);
    expect(easeJs('steps', 'in', 0.49, 4)).toBe(0.25);
  });
  it('every Curve × Direction starts at 0 and ends at 1, and clamps outside 0…1', () => {
    for (const c of CURVES) for (const d of DIRS) {
      expect(easeJs(c, d, 0, 5), `${c} ${d} 0`).toBeCloseTo(0, 6);
      expect(easeJs(c, d, 1, 5), `${c} ${d} 1`).toBeCloseTo(1, 6);
      expect(easeJs(c, d, -3, 5)).toBeCloseTo(0, 6);
      expect(easeJs(c, d, 7, 5)).toBeCloseTo(1, 6);
    }
  });
  it('Back overshoots past the end (Out) and Amount 0 takes the overshoot away', () => {
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeJs('back', 'out', i / 100)));
    expect(peak).toBeGreaterThan(1.09);
    expect(peak).toBeLessThan(1.11);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => easeJs('back', 'out', i / 100, 0)))).toBeCloseTo(1, 6);
  });
  it('the Loops: Once, Repeat and Ping-pong with a Hold at each end', () => {
    expect(easeLoopProgress('once', -1, 2, 0.5)).toBe(0);
    expect(easeLoopProgress('once', 1.5, 2, 0.5)).toBeCloseTo(0.5, 6);
    expect(easeLoopProgress('once', 99, 2, 0.5)).toBe(1);
    // Repeat: hold 0.5 at 0, move 2 s, hold 0.5 at 1 (a 3 s cycle)
    expect(easeLoopProgress('repeat', 0.25, 2, 0.5)).toBe(0);
    expect(easeLoopProgress('repeat', 1.5, 2, 0.5)).toBeCloseTo(0.5, 6);
    expect(easeLoopProgress('repeat', 2.75, 2, 0.5)).toBe(1);
    expect(easeLoopProgress('repeat', 4.5, 2, 0.5)).toBeCloseTo(0.5, 6);
    // Ping-pong: there in 2.5 s (hold then move), back in 2.5 s
    expect(easeLoopProgress('pingpong', 1.5, 2, 0.5)).toBeCloseTo(0.5, 6);
    expect(easeLoopProgress('pingpong', 2.75, 2, 0.5)).toBe(1);
    expect(easeLoopProgress('pingpong', 4, 2, 0.5)).toBeCloseTo(0.5, 6);
    expect(easeLoopProgress('pingpong', 4.9, 2, 0.5)).toBeCloseTo(0.05, 6);
    expect(easeLoopProgress('pingpong', 5.2, 2, 0.5)).toBe(0);
    // Negative time (a per-cell delay) still loops
    expect(easeLoopProgress('pingpong', -1, 2, 0.5)).toBeCloseTo(easeLoopProgress('pingpong', 4, 2, 0.5), 6);
  });
});

describe('Ease: the GLSL', () => {
  it.each(CURVES)('%s: every Direction runs as the reference, From…To', curve => {
    for (const dir of DIRS) {
      for (const x of [0, 0.1, 0.3, 0.5, 0.62, 0.9, 1, 1.4, -0.2]) {
        const r = run({ curve, direction: dir, from: -1, to: 3, amount: 1.3, steps: 4 }, { value: lit(x) });
        const a = curve === 'steps' ? 4 : 1.3;
        expect(r.value, `${curve} ${dir} ${x}`).toBeCloseTo(-1 + 4 * easeJs(curve, dir, x, a), 4);
        expect(r.progress).toBeCloseTo(Math.min(Math.max(x, 0), 1), 6);
      }
    }
  });
  it('writes one function per Curve × Direction', () => {
    const fns = getNodeDefinition('ease')!.glslFunctionsFor!(n('ease', 'N', 0, 0, { curve: 'bounce', direction: 'outIn' })).join('\n');
    expect(fns).toContain(`float ${easeFnName('bounce', 'outIn')}(`);
    expect(fns.indexOf('ssEaseBounceOut(float')).toBeLessThan(fns.indexOf('ssEaseIn_bounce(float'));
    expect(fns).not.toContain('ssEase_bounce_in(');
  });
  it.each(LOOPS)('%s: unwired, it plays from Time', loop => {
    for (const t of [-0.7, 0, 0.3, 1.1, 1.6, 2.4, 3.3, 5.05]) {
      const r = run({ curve: 'quad', direction: 'out', loop, duration: 1.2, hold: 0.4, from: 2, to: 5 }, { time: lit(t) });
      const pr = easeLoopProgress(loop, t, 1.2, 0.4);
      expect(r.progress, `${loop} ${t}`).toBeCloseTo(pr, 4);
      expect(r.value, `${loop} ${t}`).toBeCloseTo(2 + 3 * easeJs('quad', 'out', pr), 4);
    }
  });
  it('Speed: per second when playing by itself (0 while holding), per unit of progress when wired', () => {
    // Linear, Once, 2 s: 0 → 4 is 2 a second
    expect(run({ curve: 'linear', loop: 'once', duration: 2, hold: 0, from: 0, to: 4 }, { time: lit(1) }).speed).toBeCloseTo(2, 3);
    expect(run({ curve: 'linear', loop: 'once', duration: 2, hold: 0, from: 0, to: 4 }, { time: lit(3) }).speed).toBeCloseTo(0, 6);
    // Ping-pong on the way back is negative
    expect(run({ curve: 'linear', loop: 'pingpong', duration: 1, hold: 0, from: 0, to: 1 }, { time: lit(1.5) }).speed).toBeCloseTo(-1, 3);
    // Wired: d/dx of Quad In at 0.5 is 1, times (To − From)
    expect(run({ curve: 'quad', direction: 'in', from: 0, to: 3 }, { value: lit(0.5) }).speed).toBeCloseTo(3, 3);
    // …and at the ends it stays inside 0…1
    expect(run({ curve: 'quad', direction: 'in', from: 0, to: 1 }, { value: lit(1) }).speed).toBeCloseTo(2, 2);
  });
});

describe('Ease: compiles', () => {
  const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };
  // Value, Progress and Speed as the colour's three channels: every output reaches the Output.
  const graph = (curve: EaseCurve, direction: EaseDirection, loop: EaseLoop, wired: boolean) => [
    n('constant', 'k', 0, 0, { value: 0.4 }),
    n('ease', 'e', 200, 0, { curve, direction, loop }, wired ? { value: ['k', 'value'] } : {}),
    n('makeVec3', 'v', 400, 0, {}, { r: ['e', 'value'], g: ['e', 'progress'], b: ['e', 'speed'] }),
    n('output', 'out', 600, 0, {}, { color: ['v', 'rgb'] }),
  ];
  it('is registered in Animation', () => {
    expect(NODE_REGISTRY.ease.category).toBe('Animation');
  });
  it.each(CURVES)('%s: every Direction × Loop, wired and unwired, all three outputs', curve => {
    for (const dir of DIRS) for (const loop of LOOPS) for (const wired of [false, true]) {
      const r = compileGraph({ nodes: graph(curve, dir, loop, wired) }) as CompilationResult;
      const tag = `${curve} ${dir} ${loop} ${wired ? 'wired' : 'unwired'}`;
      for (const out of ['value', 'progress', 'speed']) expect(r.fragmentShader, `${tag} ${out}`).toMatch(new RegExp(`ease_\\d+_${out}\\b`));
      expect(r.errors ?? [], tag).toEqual([]);
      expect(r.success, tag).toBe(true);
      expect(parses(r.fragmentShader), tag).toBeNull();
    }
  });
  it('its sliders are live uniforms: no recompile for Duration, Hold, Amount, Steps, From and To', () => {
    const r = compileGraph({ nodes: graph('back', 'out', 'repeat', false) }) as CompilationResult;
    for (const k of ['duration', 'hold', 'amount', 'from', 'to']) expect(r.paramBindings?.[`e::${k}`], k).toBeTruthy();
    const s = compileGraph({ nodes: graph('steps', 'in', 'once', false) }) as CompilationResult;
    expect(s.paramBindings?.['e::steps']).toBeTruthy();
    expect(s.paramBindings?.['e::amount']).toBeUndefined();
  });
});
