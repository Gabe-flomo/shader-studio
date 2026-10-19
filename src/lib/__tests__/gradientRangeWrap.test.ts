/**
 * Gradient From / To are animatable (sockets and Play controls, live uniforms), and periodic drivers (Angle)
 * go round with no seam: Wrap (cyclic) by default, or Mirror. docs/gradients.md.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});
import { compileGraph } from '../../compiler/graphCompiler';
import { compileFragment, type Val } from '../../compiler/__tests__/glslRun';
import { evenStops } from '../../components/ui/gradientStops';
import {
  PF_GRADIENT_GLSL, evalGradient, evalGradientAt, evalGradientWrap, gradientCssOf, gradientParams, gradientValueParams, mirrorT,
  readGradient, withGradientRangeSockets, type ColourGradient,
} from '../colourGradient';
import { getNodeDefinition } from '../../nodes/definitions';
import { collectPlayCandidates } from '../../play/playControls';
import { bindingKeyOf } from '../playEngine';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';

const RGB3: Array<[number, number, number]> = [[0.1, 0.2, 0.9], [0.9, 0.4, 0.1], [0.2, 0.8, 0.3]];
const grad = (over: Partial<ColourGradient> = {}): ColourGradient => ({ along: 'angle', interp: 'smooth', stops: evenStops(RGB3), from: 0, to: 1, ...over });
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const node = (id: string, type: string, params: Record<string, unknown>, wires: Record<string, { nodeId: string; outputKey: string }> = {}, extraInputs: Record<string, { type: string; label: string }> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = { ...Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label }])), ...extraInputs } as GraphNode['inputs'];
  for (const [k, c] of Object.entries(wires)) inputs[k] = { ...inputs[k], connection: c };
  return { id, type, position: { x: 0, y: 0 }, params: { ...(def.defaultParams ?? {}), ...params }, inputs, outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }])) };
};
const out = (from: string, key: string): GraphNode => node('out', 'output', {}, { color: { nodeId: from, outputKey: key } });
const ok = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return r;
};
const RANGE_INPUTS = { tint__gfrom: { type: 'float', label: 'Tint from' }, tint__gto: { type: 'float', label: 'Tint to' } };
const glowGraph = (g: ColourGradient, wires: Record<string, { nodeId: string; outputKey: string }> = {}): GraphNode[] => [
  node('c', 'circleSDF', {}),
  node('t', 'time', {}),
  node('g', 'light', { mode: 'glow', ...gradientParams('tint', g) }, { distance: { nodeId: 'c', outputKey: 'distance' }, ...wires }, RANGE_INPUTS),
  out('g', 'tinted'),
];

describe('Wrap: a cyclic gradient with no seam', () => {
  it('blends the last stop back into the first: the colour just before a full turn meets the one just after', () => {
    for (const interp of ['smooth', 'linear'] as const) {
      for (const stops of [evenStops(RGB3), [{ pos: 0.1, color: RGB3[0] }, { pos: 0.6, color: RGB3[1] }, { pos: 0.8, color: RGB3[2] }]]) {
        const a = evalGradientWrap(stops, 1 - 1e-6, interp), b = evalGradientWrap(stops, 0, interp);
        expect(dist(a, b), interp).toBeLessThan(1e-3);
        // and it is smooth all the way round: no step between neighbouring samples
        for (let i = 0; i < 400; i++) expect(dist(evalGradientWrap(stops, i / 400, interp), evalGradientWrap(stops, (i + 1) / 400, interp))).toBeLessThan(0.05);
      }
    }
  });
  it('stops at 0, ½, 1 share the turn in thirds; quarter stops land on the quarters', () => {
    const s = evenStops(RGB3);
    expect(dist(evalGradientWrap(s, 0), RGB3[0])).toBeLessThan(1e-9);
    expect(dist(evalGradientWrap(s, 1 / 3), RGB3[1])).toBeLessThan(1e-9);
    expect(dist(evalGradientWrap(s, 2 / 3), RGB3[2])).toBeLessThan(1e-9);
    const q = [0, 0.25, 0.5, 0.75].map((pos, i) => ({ pos, color: [i / 4, 0, 1 - i / 4] as [number, number, number] }));
    for (let i = 0; i < 4; i++) expect(dist(evalGradientWrap(q, i / 4), q[i].color)).toBeLessThan(1e-9);
  });
  it('Mirror runs 0 → 1 → 0 round the turn', () => {
    expect(mirrorT(0)).toBe(0);
    expect(mirrorT(0.25)).toBeCloseTo(0.5);
    expect(mirrorT(0.5)).toBeCloseTo(1);
    expect(mirrorT(0.999999)).toBeCloseTo(0, 4);
    const g = grad({ repeat: 'mirror' });
    expect(dist(evalGradientAt(g, 0.5), RGB3[2])).toBeLessThan(1e-6);
    expect(dist(evalGradientAt(g, 1 - 1e-7), evalGradientAt(g, 0))).toBeLessThan(1e-3);
  });
  it('From turns the wheel: shifting From by ¼ shifts every colour by a quarter turn, seamlessly', () => {
    const a = grad(), b = grad({ from: 0.25, to: 1.25 });
    for (let i = 0; i < 20; i++) expect(dist(evalGradientAt(b, i / 20 + 0.25), evalGradientAt(a, i / 20))).toBeLessThan(1e-9);
  });
  it('a non-periodic driver still clamps at its ends', () => {
    const g = grad({ along: 'uvX', from: 0, to: 1 });
    expect(evalGradientAt(g, 5)).toEqual(evalGradient(g.stops, 1));
    expect(evalGradientAt(g, -5)).toEqual(evalGradient(g.stops, 0));
  });

  it('the GLSL pfGradientWrap and Mirror give the JS colours, across the angle\'s wrap (atan at ±π)', () => {
    const stops = [{ pos: 0, color: [0, 0, 1] }, { pos: 0.3, color: [1, 0, 0] }, { pos: 0.9, color: [0, 1, 0] }] as ColourGradient['stops'];
    const call = (u: string) => `pfGradientWrap(${u}, 3, int(M), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.3, 0.9, 2.0, 2.0, 2.0, 2.0, 2.0)`;
    const prog = compileFragment(`${PF_GRADIENT_GLSL}\nuniform float U; uniform float M; uniform float MIR;\nvoid main() { vec3 c = MIR > 0.5 ? pfGradient(pfGradMirror(U), 3, int(M), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.3, 0.9, 2.0, 2.0, 2.0, 2.0, 2.0) : ${call('U')}; gl_FragColor = vec4(c, 1.0); }`);
    for (const [m, interp] of [[0, 'smooth'], [1, 'linear'], [2, 'constant']] as const) {
      for (const u of [-0.7, -0.01, 0, 0.1, 0.3, 0.5, 0.6, 0.85, 0.95, 0.999, 1.2, 3.4]) {
        const o = (prog.run({ U: u, M: m, MIR: 0 } as Record<string, Val>).gl_FragColor as number[]).slice(0, 3);
        const want = evalGradientWrap(stops, u, interp);
        o.forEach((v, k) => expect(v, `wrap ${interp} u=${u}`).toBeCloseTo(want[k], 4));
        const om = (prog.run({ U: u, M: m, MIR: 1 } as Record<string, Val>).gl_FragColor as number[]).slice(0, 3);
        const wm = evalGradient(stops, mirrorT(u), interp);
        om.forEach((v, k) => expect(v, `mirror ${interp} u=${u}`).toBeCloseTo(wm[k], 4));
      }
    }
    // The Angle driver's value just either side of the ±π cut: same colour.
    const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)) / 6.28318 + 0.5;
    const run = (u: number) => (prog.run({ U: u, M: 0, MIR: 0 } as Record<string, Val>).gl_FragColor as number[]).slice(0, 3);
    expect(dist(run(angle(Math.PI - 1e-4)), run(angle(-Math.PI + 1e-4)))).toBeLessThan(2e-3);
  });

  it('the swatch (CPU) draws a periodic gradient as one turn that ends where it starts', () => {
    const css = gradientCssOf(grad());
    const cols = [...css.matchAll(/rgb\((\d+) (\d+) (\d+)\)/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(cols.length).toBeGreaterThan(40);
    expect(dist(cols[0], cols[cols.length - 1])).toBeLessThan(4);
    const mirror = [...gradientCssOf(grad({ repeat: 'mirror' })).matchAll(/rgb\((\d+) (\d+) (\d+)\)/g)];
    expect(mirror.length).toBeGreaterThan(40);
    // A plain (non-periodic) gradient keeps its stop list.
    expect(gradientCssOf({ stops: evenStops(RGB3), interp: 'linear' }).match(/rgb\(/g)).toHaveLength(3);
  });
});

describe('Angle compiles round, Wrap by default', () => {
  it('Wrap is the default (old Angle gradients lose their seam), Mirror on request; a structure change recompiles', () => {
    const wrap = ok(glowGraph(grad())).fragmentShader;
    expect(wrap).toContain('pfGradientWrap(pfGradU(');
    // A gradient saved before Wrap / Mirror (no repeat in its header) wraps.
    const old = gradientParams('tint', grad());
    delete (old.tint__grad as Record<string, unknown>).repeat;
    expect(readGradient(old, 'tint')?.repeat).toBe('wrap');
    const mirror = ok(glowGraph(grad({ repeat: 'mirror' }))).fragmentShader;
    expect(mirror).toContain('pfGradMirror(pfGradU(');
    expect(mirror).not.toBe(wrap);
    // Other drivers clamp as before.
    expect(ok(glowGraph(grad({ along: 'radial' }))).fragmentShader).toContain('pfGradient(pfGradT(');
    expect(readGradient(gradientParams('tint', grad({ along: 'radial' })), 'tint')).not.toHaveProperty('repeat');
  });
});

describe('From / To are animatable', () => {
  it('editing From / To is a uniform write: same shader text, bound for the slider fast path', () => {
    const a = ok(glowGraph(grad()));
    const b = ok(glowGraph(grad({ from: 0.4, to: 1.7 })));
    expect(b.fragmentShader).toBe(a.fragmentShader);
    expect(a.paramBindings['g::tint__gfrom']).toMatch(/^u_p_/);
    expect(a.paramBindings['g::tint__gto']).toMatch(/^u_p_/);
    expect(b.paramUniforms[b.paramBindings['g::tint__gfrom']]).toBe(0.4);
  });

  it('a wire into "Tint from" replaces the field (Time turns the wheel)', () => {
    const r = ok(glowGraph(grad(), { tint__gfrom: { nodeId: 't', outputKey: 'time' } }));
    const line = r.fragmentShader.split('\n').find(l => l.includes('pfGradientWrap(pfGradU('))!;
    expect(line).toMatch(/pfGradU\([^;]*u_time|pfGradU\([^;]*\bt\w*_time/);
    expect(line).not.toContain('tintxxgfrom');
    // The To field is still its uniform.
    expect(line).toContain('tintxxgto');
  });

  it('the node gains "Tint from" / "Tint to" sockets while the gradient is on, and loses them (unwired) when off', () => {
    const settings = [{ key: 'tint', label: 'Tint' }];
    const base = node('g', 'light', { mode: 'glow' });
    const on = withGradientRangeSockets({ ...base, params: { ...base.params, ...gradientParams('tint', grad()) } }, settings);
    expect(on.inputs.tint__gfrom).toMatchObject({ type: 'float', label: 'Tint from' });
    expect(on.inputs.tint__gto).toMatchObject({ type: 'float', label: 'Tint to' });
    const off = withGradientRangeSockets({ ...on, params: { ...on.params, tint__grad: { ...(on.params.tint__grad as object), on: false } } }, settings);
    expect(off.inputs.tint__gfrom).toBeUndefined();
    const wired: GraphNode = { ...on, inputs: { ...on.inputs, tint__gfrom: { ...on.inputs.tint__gfrom, connection: { nodeId: 't', outputKey: 'time' } } } };
    const offWired = withGradientRangeSockets({ ...wired, params: off.params }, settings);
    expect(offWired.inputs.tint__gfrom?.connection).toBeTruthy();
    expect(offWired.inputs.tint__gto).toBeUndefined();
  });

  it('the store adds the sockets when a card switches the colour to Gradient, and a From drag never recompiles', () => {
    const st = () => useNodeGraphStore.getState();
    st().replaceGraph([node('c', 'circleSDF', {}), node('g', 'light', { mode: 'glow' }, { distance: { nodeId: 'c', outputKey: 'distance' } }), out('g', 'tinted')]);
    st().updateNodeParams('g', gradientParams('tint', grad()), { immediate: true });
    const g = st().nodes.find(n => n.id === 'g')!;
    expect(Object.keys(g.inputs)).toEqual(expect.arrayContaining(['tint__gfrom', 'tint__gto']));
    const fs = st().fragmentShader;
    expect(fs).toContain('pfGradientWrap(');
    st().updateNodeParams('g', gradientValueParams('tint', grad({ from: 0.3 })), { immediate: true });
    expect(st().fragmentShader).toBe(fs);
    const name = st().paramBindings['g::tint__gfrom'];
    expect(st().paramUniforms?.[name]).toBe(0.3);
  });

  it('From and To are Play control candidates (live uniforms), but not while wired', () => {
    const nodes = glowGraph(grad());
    const r = ok(nodes);
    const cands = collectPlayCandidates(nodes, r.paramBindings);
    const from = cands.find(c => c.target === 'g::tint__gfrom')!;
    expect(from).toMatchObject({ kind: 'float', paramLabel: 'Tint from', value: 0 });
    expect(from.max).toBeGreaterThan(1);
    expect(bindingKeyOf(from.target) in r.paramBindings).toBe(true);
    expect(cands.some(c => c.target === 'g::tint__gto')).toBe(true);
    const wiredNodes = glowGraph(grad(), { tint__gfrom: { nodeId: 't', outputKey: 'time' } });
    const w = collectPlayCandidates(wiredNodes, ok(wiredNodes).paramBindings);
    expect(w.some(c => c.target === 'g::tint__gfrom')).toBe(false);
    expect(w.some(c => c.target === 'g::tint__gto')).toBe(true);
  });
});
