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
