/**
 * Gradient colour settings (lib/colourGradient.ts, docs/gradients.md): the maths matches the Stops
 * Palette's, stops are uniforms (editing one leaves the shader text alone), Solid compiles exactly as
 * before, each driver compiles in its context, presets save / rename / delete, and a gradient
 * survives a graph save round-trip.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { compileFragment, type Val } from '../../compiler/__tests__/glslRun';
import { evalStops } from '../palette';
import { evenStops } from '../../components/ui/gradientStops';
import {
  DRIVERS_2D, DRIVERS_3D_POINT, DRIVERS_3D_SURFACE, GRADIENT_DRIVERS, PF_GRADIENT_GLSL, evalGradient, gradientColourGlsl, gradientParams,
  gradientValueParams, readGradient, starterGradient, type ColourGradient, type GradientDriver,
} from '../colourGradient';
import { allPalettes, deletePalette, listPalettes, renamePalette, savePalette } from '../backgroundLibrary';
import { paletteAsGradientStops, paletteSwatchCss } from '../../components/ui/GradientSetting';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import { newShape, starterSpec, type SceneSpec } from '../../sceneBuilder/spec';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

const RGB3: Array<[number, number, number]> = [[0.1, 0.2, 0.9], [0.9, 0.4, 0.1], [0.2, 0.8, 0.3], [1, 1, 1]];
const grad = (over: Partial<ColourGradient> = {}): ColourGradient => ({
  along: 'height', interp: 'smooth', stops: evenStops(RGB3), from: -1, to: 1, ...over,
});

describe('gradient maths', () => {
  it('matches the Stops Palette for evenly spaced stops (Clamp), for every blend', () => {
    const pairs: Array<[ColourGradient['interp'], string]> = [['smooth', 'smooth'], ['linear', 'linear'], ['constant', 'bands']];
    for (const [interp, blend] of pairs) {
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const a = evalGradient(evenStops(RGB3), t, interp);
        const b = evalStops(RGB3, t, 'clamp', blend);
        // Constant changes colour exactly on a stop; the palette changes just after it.
        if (interp === 'constant' && Math.abs(t * 3 - Math.round(t * 3)) < 1e-9) continue;
        a.forEach((v, k) => expect(v, `${interp} t=${t}`).toBeCloseTo(b[k], 3)); // the palette stops 0.0001 short of its end
      }
    }
  });

  it('the GLSL pfGradient gives the same colours as the JS evaluator', () => {
    const stops = [{ pos: 0, color: [0, 0, 1] }, { pos: 0.3, color: [1, 0, 0] }, { pos: 0.9, color: [0, 1, 0] }] as ColourGradient['stops'];
    const prog = compileFragment(`${PF_GRADIENT_GLSL}\nuniform float T; uniform float M;\nvoid main() { gl_FragColor = vec4(pfGradient(T, 3, int(M), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.3, 0.9, 2.0, 2.0, 2.0, 2.0, 2.0), 1.0); }`);
    for (const [m, interp] of [[0, 'smooth'], [1, 'linear'], [2, 'constant']] as const) {
      for (const t of [0, 0.1, 0.29, 0.3, 0.31, 0.5, 0.89, 0.95, 1]) {
        const o = (prog.run({ T: t, M: m } as Record<string, Val>).gl_FragColor as number[]).slice(0, 3);
        const want = evalGradient(stops, t, interp);
        o.forEach((v, k) => expect(v, `${interp} t=${t}`).toBeCloseTo(want[k], 5));
      }
    }
  });

  it('round-trips through params, and a stop edit is values only', () => {
    const g = grad({ along: 'normal', from: 1, to: -1, interp: 'linear' });
    const params = gradientParams('albedo', g);
    expect(readGradient(params, 'albedo')).toEqual({ ...g, stops: g.stops.map(s => ({ pos: s.pos, color: [...s.color] })) });
    expect(Object.keys(gradientValueParams('albedo', g))).not.toContain('albedo__grad');
  });
});

// ── Compiling ──────────────────────────────────────────────────────────────────

const node = (id: string, type: string, params: Record<string, unknown>, wires: Record<string, { nodeId: string; outputKey: string }> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  return {
    id, type, position: { x: 0, y: 0 }, params: { ...(def.defaultParams ?? {}), ...params },
    inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: wires[k] } : {}) }])),
    outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
  };
};
const out = (from: string, key: string): GraphNode => node('out', 'output', {}, { color: { nodeId: from, outputKey: key } });
const ok = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return r;
};

/** A 2D fill, glow and Colorize graph with one colour setting set to `params`. */
const fillGraph = (params: Record<string, unknown>): GraphNode[] => [
  node('c', 'circleSDF', {}),
  node('f', 'sdfFill', params, { d: { nodeId: 'c', outputKey: 'distance' } }),
  out('f', 'result'),
];

describe('Solid is unchanged', () => {
  it('an SDF Fill with no Fill setting compiles to the same shader as before (white)', () => {
    const r = ok(fillGraph({}));
    expect(r.fragmentShader).toMatch(/mix\(mix\(vec3\(0\.0\), vec3\(1\.0\), \w+_fill\)/);
    expect(r.fragmentShader).not.toContain('pfGradient');
  });
  it('a gradient switched back to Solid compiles exactly as the plain colour', () => {
    const plain = ok(fillGraph({ fillColor: [0.3, 0.6, 0.9] })).fragmentShader;
    const off = ok(fillGraph({ fillColor: [0.3, 0.6, 0.9], ...gradientParams('fillColor', grad({ along: 'uvX' }), false) })).fragmentShader;
    expect(off).toBe(plain);
  });
});

describe('stops are uniforms', () => {
  it('editing a stop colour, a place or the range changes uniforms, not the shader text', () => {
    const g = grad({ along: 'uvX' });
    const a = ok(fillGraph(gradientParams('fillColor', g)));
    const g2: ColourGradient = { ...g, from: -0.5, stops: g.stops.map((s, i) => (i === 1 ? { pos: 0.4, color: [0, 0, 0] } : s)) };
    const b = ok(fillGraph(gradientParams('fillColor', g2)));
    expect(b.fragmentShader).toBe(a.fragmentShader);
    const vals = (r: typeof a) => Object.entries(r.paramUniforms).filter(([k]) => /fillColorxxg/.test(k));
    expect(vals(a)).toHaveLength(4 * 2 + 2);
    expect(vals(b)).not.toEqual(vals(a));
    expect(a.fragmentShader).toContain('pfGradient(');
  });
  it('binds each stop param for the slider fast path', () => {
    const r = ok(fillGraph(gradientParams('fillColor', grad({ along: 'radial' }))));
    expect(r.paramBindings['f::fillColor__gc0']).toMatch(/^u_p_/);
    expect(r.paramBindings['f::fillColor__gp2']).toMatch(/^u_p_/);
    expect(r.paramBindings['f::fillColor__gto']).toMatch(/^u_p_/);
  });
  it('changing the stop count changes the shader (a recompile)', () => {
    const a = ok(fillGraph(gradientParams('fillColor', grad({ along: 'uvX' })))).fragmentShader;
    const b = ok(fillGraph(gradientParams('fillColor', grad({ along: 'uvX', stops: evenStops(RGB3.slice(0, 2)) })))).fragmentShader;
    expect(b).not.toBe(a);
  });
});

describe('each driver compiles in its context', () => {
  it('2D: SDF Fill (Edge → inside + UV), SDF Glow (Distance to surface + UV), Colorize (Field + UV)', () => {
    for (const along of ['inside', ...DRIVERS_2D] as GradientDriver[]) {
      const r = ok(fillGraph(gradientParams('fillColor', grad({ along }))));
      expect(r.fragmentShader, along).toContain('pfGradient(');
    }
    for (const along of ['surface', ...DRIVERS_2D] as GradientDriver[]) {
      const r = ok([node('c', 'circleSDF', {}), node('g', 'light', { mode: 'halo', ...gradientParams('tint', grad({ along })) }, { distance: { nodeId: 'c', outputKey: 'distance' } }), out('g', 'tinted')]);
      expect(r.fragmentShader, along).toContain('pfGradient(');
    }
    for (const along of ['field', ...DRIVERS_2D] as GradientDriver[]) {
      const r = ok([node('n', 'circleSDF', {}), node('z', 'colorize', gradientParams('color', grad({ along })), { field: { nodeId: 'n', outputKey: 'distance' } }), out('z', 'color')]);
      expect(r.fragmentShader, along).toContain('pfGradient(');
    }
  });

  it('a driver the context cannot provide falls back to the solid colour', () => {
    expect(gradientColourGlsl(gradientParams('color', grad({ along: 'height' })), 'color', {}, DRIVERS_3D_POINT)).toBeNull();
    expect(gradientColourGlsl(gradientParams('color', grad({ along: 'depth' })), 'color', { pos: 'p' }, DRIVERS_3D_POINT)).toBeNull();
    expect(gradientColourGlsl(gradientParams('color', grad({ along: 'height' })), 'color', { pos: 'p' }, DRIVERS_3D_POINT)).toContain('(p).y');
  });

  const sceneWith = (mode: 'surface' | 'gi', along: GradientDriver, two = false): SceneSpec => {
    const s = starterSpec();
    s.look.mode = mode;
    const sh = s.root.children[0] as ReturnType<typeof newShape>;
    sh.gradient = grad({ along });
    if (two) s.root.children.push(newShape('box', 's2', { at: [1.5, 0, 0], color: [0.2, 0.3, 0.9] }));
    return s;
  };
  const idFor = (role: string) => `t_${role.replace(/[^A-Za-z0-9]/g, '_')}`;

  it('3D Scene Builder shapes: one shape and Materials (several), every surface driver', () => {
    for (const along of DRIVERS_3D_POINT) {
      for (const two of [false, true]) {
        const g = buildStandaloneGraph(sceneWith('surface', along, two), { idFor });
        const r = ok(g.nodes);
        expect(r.fragmentShader, `${along} ${two ? 'materials' : 'single'}`).toContain('pfGradient(');
      }
    }
  });

  it('march material: the GI Lit March Group\'s Albedo by every surface driver (Depth included)', () => {
    for (const along of DRIVERS_3D_SURFACE) {
      const g = buildStandaloneGraph(sceneWith('gi', along), { idFor });
      const r = ok(g.nodes);
      expect(r.fragmentShader, along).toMatch(/_alb\s+= pfGradient\(/);
      if (along === 'depth') expect(r.fragmentShader).toContain('length((');
    }
  });

  it('March Loop Group Albedo reads the hit point', () => {
    const loopDef = getNodeDefinition('marchLoopGroup')!;
    expect(loopDef.paramDefs?.albedo.gradient).toEqual(DRIVERS_3D_SURFACE);
    const g = buildStandaloneGraph(sceneWith('surface', 'height'), { idFor });
    const loop = g.nodes.find(n => n.type === 'marchLoopGroup')!;
    Object.assign(loop.params, gradientParams('albedo', grad({ along: 'normal', from: 1, to: -1 })));
    const r = ok(g.nodes);
    expect(r.fragmentShader).toMatch(/_alb\s+= pfGradient\(pfGradT\(\(\w+_n\)\.y/);
  });
});

describe('presets', () => {
  it('the built-ins include Sunset, Ocean, Fire, Mono, Neon and Earth', () => {
    const names = allPalettes().filter(p => p.preset).map(p => p.name);
    for (const n of ['Sunset', 'Ocean', 'Fire', 'Mono', 'Neon', 'Earth']) expect(names).toContain(n);
  });
  it('save, rename and delete a user preset; it reads back as at most 8 gradient stops', () => {
    const g = grad();
    const p = savePalette({ name: 'Test grad', stops: g.stops, style: 'gradient', angle: 90 });
    expect(listPalettes().map(x => x.name)).toContain('Test grad');
    expect(paletteAsGradientStops(p)).toHaveLength(4);
    renamePalette(p.id, 'Renamed');
    expect(listPalettes().find(x => x.id === p.id)?.name).toBe('Renamed');
    deletePalette(p.id);
    expect(listPalettes().find(x => x.id === p.id)).toBeUndefined();
    const fire = allPalettes().find(x => x.name === 'Fire')!;
    expect(paletteAsGradientStops(fire).length).toBeLessThanOrEqual(8);
    const big = savePalette({ name: 'Big', stops: evenStops(Array.from({ length: 20 }, (_, i) => [i / 19, 0, 1 - i / 19] as [number, number, number])), style: 'gradient' });
    expect(paletteAsGradientStops(big)).toHaveLength(8);
  });
  it('each preset row gets a swatch of its stops (the Presets menu)', () => {
    for (const p of allPalettes()) expect(paletteSwatchCss(p)).toMatch(/^linear-gradient\(90deg, rgb\(/);
    const two = { name: 'x', stops: [{ pos: 0, color: [1, 0, 0] as [number, number, number] }, { pos: 1, color: [0, 0, 1] as [number, number, number] }], style: 'gradient' as const };
    expect(paletteSwatchCss(two as Parameters<typeof paletteSwatchCss>[0])).toBe('linear-gradient(90deg, rgb(255 0 0) 0.0%, rgb(0 0 255) 100.0%)');
  });
});

describe('saved graphs', () => {
  it('a gradient setting survives a JSON save round-trip and compiles to the same shader', () => {
    const nodes = fillGraph({ fillColor: [1, 0, 0], ...gradientParams('fillColor', grad({ along: 'radial' })) });
    const again = JSON.parse(JSON.stringify(nodes)) as GraphNode[];
    expect(readGradient(again[1].params, 'fillColor')).toEqual(readGradient(nodes[1].params, 'fillColor'));
    expect(ok(again).fragmentShader).toBe(ok(nodes).fragmentShader);
  });
  it('a starter gradient spans the driver\'s default range', () => {
    for (const d of Object.keys(GRADIENT_DRIVERS) as GradientDriver[]) {
      const s = starterGradient([0.5, 0.5, 0.5], d);
      expect([s.from, s.to]).toEqual(GRADIENT_DRIVERS[d].range);
    }
  });
});
