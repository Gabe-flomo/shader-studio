/**
 * Curve Trace (docs/curve-trace.md): every motion and wave compiles, a custom formula can't break
 * out of its expression, the 3D bound only runs without custom axes, and the examples are live.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { CURVE_TRACE_2D_KEYS, CURVE_TRACE_3D_KEYS } from '../../store/curveTraceExampleIndex';
import { collectPlayCandidates } from '../../play/playControls';
import { n } from '../../store/graphBuilder';

const flat = (params: Record<string, unknown>) => {
  const nodes = [
    n('curveTrace', 'c', 0, 0, params),
    n('floatToVec3', 'v', 400, 0, {}, { input: ['c', 'distance'] }),
    n('output', 'out', 800, 0, {}, { color: ['v', 'rgb'] }),
  ];
  return compileGraph({ nodes });
};

describe('Curve Trace', () => {
  it.each([...CURVE_TRACE_2D_KEYS, ...CURVE_TRACE_3D_KEYS])('%s compiles and its Play controls are live', key => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of EXAMPLE_GRAPHS[key].play!.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });

  it('smooth curves skip stretches that can\'t be nearest; curves that can jump visit every segment', () => {
    // Sine, triangle and both rotary motions have a speed bound: the chunked loop (a ball round each stretch)
    for (const p of [{ waveX: 'sine' }, { waveX: 'triangle' }, { mode: 'rotary' }, { mode: 'counter', morphOn: true }]) {
      expect(flat({ ...p, segments: 256 }).fragmentShader, JSON.stringify(p)).toMatch(/_reach = /);
    }
    // Square, saw and custom axes can jump, and short curves aren't worth it: the plain loop
    for (const p of [{ waveX: 'square' }, { waveY: 'saw' }, { waveX: 'custom' }, { segments: 16 }]) {
      expect(flat({ segments: 256, ...p }).fragmentShader, JSON.stringify(p)).not.toMatch(/_reach = /);
    }
  });

  it.each(['lateral', 'rotary', 'counter'])('motion %s compiles', mode => {
    const r = flat({ mode });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/sqrt\(\w+_d\)/);
  });

  it.each(['sine', 'triangle', 'square', 'saw', 'custom'])('wave %s compiles', wave => {
    expect(flat({ waveX: wave, waveY: wave, exprX: 'cos(t) * time * 0.0 + sin(4.0 * t)', exprY: 'sin(t)' }).errors ?? []).toEqual([]);
  });

  it('counter-current turns the second circle the other way', () => {
    expect(flat({ mode: 'counter' }).fragmentShader).toMatch(/sin\([^;]*\) - [^;]*sin\(/);
    expect(flat({ mode: 'rotary' }).fragmentShader).not.toMatch(/sin\([^;]*t[^;]*\) - [^;]*sin\(/);
  });

  it('a custom formula with statement characters is refused', () => {
    const r = flat({ waveX: 'custom', exprX: 'sin(t); } float x = 1.0; {' });
    expect(r.success).toBe(false);
    expect(String(r.errors)).toMatch(/can't use/);
  });

  it('3D skips the loop outside the bound, except with a custom axis', () => {
    const scene = (params: Record<string, unknown>) => resolveNodeAliases(EXAMPLE_GRAPHS.curveTraceKnot.nodes, getNodeDefinition).map(nd => {
      if (nd.type !== 'sceneGroup') return nd;
      const sg = nd.params.subgraph as { nodes: typeof nd[] };
      return { ...nd, params: { ...nd.params, subgraph: { ...sg, nodes: sg.nodes.map(s => (s.type === 'curveTrace3D' ? { ...s, params: { ...s.params, ...params } } : s)) } } };
    });
    const bounded = compileGraph({ nodes: scene({}) });
    expect(bounded.errors ?? []).toEqual([]);
    expect(bounded.fragmentShader).toMatch(/_far < /);
    const custom = compileGraph({ nodes: scene({ waveZ: 'custom', exprZ: '0.2 * t' }) });
    expect(custom.errors ?? []).toEqual([]);
    expect(custom.fragmentShader).not.toMatch(/_far < /);
  });
});

describe('Curve Trace: Beam', () => {
  const beam = (params: Record<string, unknown> = {}, extra: Record<string, [string, string]> = {}) => compileGraph({ nodes: [
    n('time', 'tm', -400, 0, {}),
    n('curveTrace', 'c', 0, 0, { draw: 'beam', freqX: 3, freqY: 2, ...params }, extra),
    n('output', 'out', 800, 0, {}, { color: ['c', 'color'] }),
  ] });

  it('draws into a screen Pass of its own, read by the node', () => {
    const r = beam();
    expect(r.errors ?? []).toEqual([]);
    expect(r.passes?.length).toBe(1);
    const screen = r.passes![0];
    // The step: fades its own Previous and lays in the frame's stretch
    expect(screen.fragmentShader).toMatch(/texture2D\(u_passprev_\w+, vUv\)/);
    expect(screen.fragmentShader).toMatch(/ctBeamInk\(/);
    expect(screen.nodeIds).toEqual(expect.arrayContaining(['c__beamstep', 'c']));
    // The node: reads the screen; no per-pixel loop over the trail in the picture
    expect(r.fragmentShader).toMatch(new RegExp(`texture2D\\(u_pass_${screen.slug}, vUv\\)\\.r`));
    expect(r.fragmentShader).not.toMatch(/ctBeamInk|_reach = |sqrt\(\w+_d\)/);
  });

  it('costs the same whatever the Persistence: the loop is bounded by Segments, not the trail', () => {
    const a = beam({ persistence: 0.05 }).passes![0].fragmentShader;
    const b = beam({ persistence: 3 }).passes![0].fragmentShader;
    expect(a).toBe(b);
    expect(beam({ segments: 64 }).passes![0].fragmentShader).toMatch(/_i <= 64;/);
  });

  it('keeps its own clock (only u_time): recordings at any frame rate step it the same way', () => {
    const fs = beam().passes![0].fragmentShader;
    expect(fs).not.toMatch(/u_dt\b|u_frame\b|u_prevTime/);
    // The time it was drawn is written into the screen (green, blue, alpha) and read back
    expect(fs).toMatch(/\.gba \* 255\.0/);
  });

  it('its sliders drive the step without a recompile (bound to the node)', () => {
    const r = beam();
    for (const k of ['glow', 'beamWidth', 'dwell', 'persistence', 'freqX', 'brightness']) expect(Object.keys(r.paramBindings ?? {})).toContain(`c::${k}`);
  });

  it('wires into the node drive the step too, and every motion and wave compiles', () => {
    const wired = beam({}, { time: ['tm', 'time'] });
    expect(wired.errors ?? []).toEqual([]);
    for (const p of [{ mode: 'rotary' }, { mode: 'counter', morphOn: true }, { waveX: 'square' }, { waveX: 'custom', exprX: 'sin(3.0 * t)' }, { damping: 0.05 }, { beamScale: '0.5' }]) {
      const r = beam(p);
      expect(r.errors ?? [], JSON.stringify(p)).toEqual([]);
    }
    expect(beam({ beamScale: '0.5' }).passes![0].scale).toBe(0.5);
    // A Custom axis has no frequency: it takes Segments pieces a frame
    expect(beam({ waveX: 'custom', exprX: 'sin(3.0 * t)', segments: 32 }).passes![0].fragmentShader).toMatch(/_back > 0\.0 \? 32 : 0/);
  });

  it('other Draw modes are unchanged and add no pass; 3D has no Beam', () => {
    expect(flat({ draw: 'live' }).passes ?? []).toEqual([]);
    const opts = (getNodeDefinition('curveTrace3D')!.paramDefs!.draw as { options: Array<{ value: string }> }).options.map(o => o.value);
    expect(opts).not.toContain('beam');
  });
});
