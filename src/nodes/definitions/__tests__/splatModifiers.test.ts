/**
 * Per-splat modifiers (nodes/definitions/splatModifiers.ts, compiler/splatGraph.ts, docs/splat-scene.md): the chain
 * wired into a Splat Scene's Modifier compiles into its modifier program (and out of the picture), every recipe
 * compiles and parses, the per-splat inputs are there, the sliders are live uniforms of the picture's table, what
 * moves the splats is known, the dissolve and explode maths, sorting by moved positions, the card's "Add a modifier",
 * and the splat shader's modifier variant.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../../compiler/graphCompiler';
import { pictureGraphOf, splatModPrelude, splatModUniformNames } from '../../../compiler/splatGraph';
import { n } from '../../../store/graphBuilder';
import type { GraphNode } from '../../../types/nodeGraph';
import { SPLAT_RECIPE_TYPES, dissolveAt, explodeAt } from '../splatModifiers';
import { SPLAT_DEPTH_FRAG, SPLAT_DEPTH_VERT, SPLAT_VERT, SPLAT_VERT_MOD, SPLAT_FRAG } from '../../../lib/splats/shaders';
import { orderByDepth, sortSplats } from '../../../lib/splats/pack';
import { modifierMoves, movedSum } from '../../../lib/splats/engine';
import { addSplatModifier, splatModifierChain, SPLAT_MODIFIER_MENU } from '../../recipes/splatModifierRecipes';
import { splatModifiersNodes, splatDissolvePlayNodes } from '../../../store/splatExamples';
import { collectPlayCandidates } from '../../../play/playControls';

/** A Splat Scene on its own (the default camera), its Modifier fed by `chain` ending in `last`. */
function scan(chain: GraphNode[], last?: string, extra: Record<string, unknown> = {}): GraphNode[] {
  return [
    ...chain,
    n('splatScene', 'scan', 0, 0, extra, last ? { modifier: [last, 'splat'] } : {}),
    n('output', 'out', 0, 0, {}, { color: ['scan', 'color'] }),
  ];
}

/** GLSL ES 3.00 parses (three.js adds the version line and, for a ShaderMaterial, these lines). */
const SHADER_MATERIAL_PREFIX = '#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';
function parses(src: string, prefix = SHADER_MATERIAL_PREFIX) {
  expect(() => parser.parse(prefix + src, { quiet: true })).not.toThrow();
}

describe('Splat modifiers: compiling', () => {
  it('a recipe wired into Modifier compiles into a modifier program, and out of the picture', () => {
    const r = compileGraph({ nodes: scan([n('splatDissolve', 'dis', 0, 0)], 'dis') });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    const mod = r.splats![0].modifier!;
    expect(mod.nodeId).toBe('scan');
    expect(mod.fragmentShader).toContain('spFbm3(');
    expect(mod.fragmentShader).toMatch(/gl_FragColor = vec4\(\w+_s\[0\], \w+_enc\);/);
    expect(mod.fragmentShader).toContain('splatModOut1 = vec4(');
    // The picture never runs the chain.
    expect(r.fragmentShader).not.toContain('spFbm3');
    expect(r.fragmentShader).not.toContain('sp_base');
    parses(mod.fragmentShader);
  });

  it('the per-splat inputs are there: the splat, its place in the scan, index, random, count and radius', () => {
    const r = compileGraph({ nodes: scan([n('splatDissolve', 'dis', 0, 0)], 'dis') });
    const fs = r.splats![0].modifier!.fragmentShader;
    const u = splatModUniformNames('scan');
    expect(fs).toContain(`uniform highp usampler2D ${u.data};`);
    expect(fs).toContain(`uniform highp sampler2D ${u.probe};`);
    expect(fs).toContain(`uniform float ${u.count};`);
    expect(fs).toContain(splatModPrelude('scan', true));
    for (const g of ['sp_base', 'sp_local', 'sp_index', 'sp_rand', 'sp_count', 'sp_radius', 'sp_T']) expect(fs).toMatch(new RegExp(`\\b${g} =`));
    // "Up is: +Y" leaves the scan's own axes alone.
    const up = compileGraph({ nodes: scan([n('splatDissolve', 'dis', 0, 0)], 'dis', { up: 'y' }) }).splats![0].modifier!.fragmentShader;
    expect(up).toContain('sp_local = sp_p * vec3(1.0) * sp_scale;');
  });

  it('Splat Attributes → ordinary nodes → Set Splat: the chain runs on the per-splat values', () => {
    const nodes = scan([
      n('splatAttributes', 'attrs', 0, 0),
      n('time', 't', 0, 200),
      n('multiply', 'm', 200, 0, { b: 0.1 }, { a: ['attrs', 'random'] }),
      n('makeVec3', 'up', 400, 0, { r: 0, b: 0 }, { g: ['m', 'result'] }),
      // Set Splat's own Splat unwired: it starts from the splat as loaded, as Splat Attributes does.
      n('splatSet', 'set', 600, 0, {}, { offset: ['up', 'rgb'], color: ['attrs', 'local'] }),
    ], 'set');
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const fs = r.splats![0].modifier!.fragmentShader;
    expect(fs).toMatch(/mat3 \w+_i = sp_base;/);
    expect(fs).toContain('sp_rand');
    expect(fs).toContain('sp_local');
    // Set Splat's Amount is a live uniform.
    expect(r.paramBindings['set::amount']).toBeTruthy();
    parses(fs);
    // The chain's nodes aren't in the picture's program.
    expect(r.fragmentShader).not.toContain('sp_rand');
  });

  it('every recipe compiles and parses alone, and stacked in one chain', () => {
    for (const type of SPLAT_RECIPE_TYPES) {
      const r = compileGraph({ nodes: scan([n(type, 'm', 0, 0)], 'm') });
      expect(r.errors ?? [], type).toEqual([]);
      expect(r.success, type).toBe(true);
      const fs = r.splats![0].modifier!.fragmentShader;
      parses(fs);
      // Every float slider of the recipe is a live uniform, read by the program (no dead sliders).
      for (const [binding, uniform] of Object.entries(r.paramBindings)) {
        if (!binding.startsWith('m::')) continue;
        const key = binding.slice(3);
        const shapeOnly = (type === 'splatCrop' && (key === 'size' || key === 'normal'));
        if (shapeOnly) continue;
        expect(fs, `${type}.${key}`).toMatch(new RegExp(`\\b${uniform}\\b[^;]*;`));
        expect(fs.split(uniform).length, `${type}.${key} read`).toBeGreaterThan(2);
      }
    }
    // All of them, one after another.
    const chain: GraphNode[] = [];
    let prev: string | undefined;
    SPLAT_RECIPE_TYPES.forEach((type, i) => {
      chain.push(n(type, `m${i}`, i * 300, 0, {}, prev ? { splat: [prev, 'splat'] } : {}));
      prev = `m${i}`;
    });
    const r = compileGraph({ nodes: scan(chain, prev) });
    expect(r.errors ?? []).toEqual([]);
    parses(r.splats![0].modifier!.fragmentShader);
  });

  it('each shape and mode of Crop and Wave compiles', () => {
    for (const shape of ['plane', 'box', 'sphere']) for (const keep of ['inside', 'outside']) for (const space of ['scan', 'scene']) {
      const r = compileGraph({ nodes: scan([n('splatCrop', 'c', 0, 0, { shape, keep, space })], 'c') });
      expect(r.success, `${shape}/${keep}/${space}`).toBe(true);
      parses(r.splats![0].modifier!.fragmentShader);
    }
    for (const mode of ['wave', 'wobble', 'twist']) for (const along of ['x', 'radial']) for (const push of ['y', 'out']) {
      const r = compileGraph({ nodes: scan([n('splatWave', 'w', 0, 0, { mode, along, push })], 'w') });
      expect(r.success, `${mode}/${along}/${push}`).toBe(true);
      parses(r.splats![0].modifier!.fragmentShader);
    }
    for (const mode of ['both', 'fade', 'shrink']) {
      const r = compileGraph({ nodes: scan([n('splatDissolve', 'd', 0, 0, { mode })], 'd') });
      parses(r.splats![0].modifier!.fragmentShader);
    }
  });

  it('the chain\'s sliders join the picture\'s uniform table, so Play and drags reach them', () => {
    const r = compileGraph({ nodes: scan([n('splatDissolve', 'dis', 0, 0, { amount: 0.6 })], 'dis') });
    const u = r.paramBindings['dis::amount'];
    expect(u).toBeTruthy();
    expect(r.paramUniforms[u]).toBe(0.6);
    expect(r.splats![0].modifier!.paramUniforms[u]).toBe(0.6);
    // Play sees it as a control.
    const targets = collectPlayCandidates(scan([n('splatDissolve', 'dis', 0, 0)], 'dis'), r.paramBindings).map(c => c.target);
    expect(targets).toContain('dis::amount');
    expect(targets).toContain('dis::glow');
  });

  it('two scans\' chains never share a uniform by accident; a node feeding the picture too stays in it', () => {
    const nodes: GraphNode[] = [
      n('time', 't', 0, 0),
      n('splatWave', 'w1', 0, 0, {}, { time: ['t', 'time'] }),
      n('splatWave', 'w2', 0, 0),
      n('splatScene', 'a', 0, 0, {}, { modifier: ['w1', 'splat'] }),
      n('splatScene', 'b', 0, 0, {}, { modifier: ['w2', 'splat'] }),
      n('add', 'sum', 0, 0, {}, { a: ['a', 'alpha'], b: ['t', 'time'] }),
      n('output', 'out', 0, 0, {}, { color: ['sum', 'result'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const a1 = r.paramBindings['w1::amplitude'], a2 = r.paramBindings['w2::amplitude'];
    expect(a1).toBeTruthy();
    expect(a2).toBeTruthy();
    expect(a1).not.toBe(a2);
    // Time feeds the picture (sum) and w1: it stays in the picture; the Waves don't.
    const pic = pictureGraphOf({ nodes });
    expect(pic.nodes.map(x => x.id).sort()).toEqual(['a', 'b', 'out', 'sum', 't']);
    expect(pic.nodes.find(x => x.id === 'a')!.inputs.modifier.connection).toBeUndefined();
    // Without a Modifier wired the graph is left as it is.
    const plain = { nodes: scan([]) };
    expect(pictureGraphOf(plain)).toBe(plain);
  });

  it('knows what moves the splats: Explode\'s Amount, Wave\'s Amplitude, Dissolve\'s Drift, Set Splat with Offset', () => {
    const moving = (chain: GraphNode[], last: string, uniforms: (b: Record<string, string>) => Record<string, number>) => {
      const r = compileGraph({ nodes: scan(chain, last) });
      const mod = r.splats![0].modifier!;
      const u = Object.fromEntries(Object.entries(r.paramUniforms).map(([k, v]) => [k, { value: v }]));
      for (const [k, v] of Object.entries(uniforms(r.paramBindings))) u[k] = { value: v };
      return modifierMoves(mod, u);
    };
    expect(moving([n('splatColor', 'c', 0, 0)], 'c', () => ({}))).toBe(false);
    expect(moving([n('splatExplode', 'e', 0, 0, { amount: 0.5 })], 'e', () => ({}))).toBe(true);
    expect(moving([n('splatExplode', 'e', 0, 0, { amount: 0.5 })], 'e', b => ({ [b['e::amount']]: 0 }))).toBe(false);
    expect(moving([n('splatWave', 'w', 0, 0, { amplitude: 0 })], 'w', () => ({}))).toBe(false);
    expect(moving([n('splatWave', 'w', 0, 0)], 'w', () => ({}))).toBe(true);
    expect(moving([n('splatDissolve', 'd', 0, 0, { drift: 0 })], 'd', () => ({}))).toBe(false);
    expect(moving([n('splatSet', 's', 0, 0)], 's', () => ({}))).toBe(false);
    expect(moving([n('makeVec3', 'v', 0, 0), n('splatSet', 's', 0, 0, {}, { offset: ['v', 'rgb'] })], 's', () => ({}))).toBe(true);
  });

  it('a Splat Scene can\'t sit inside another\'s Modifier chain', () => {
    const nodes = [
      n('splatScene', 'inner', 0, 0),
      n('splatSet', 's', 0, 0, {}, { opacity: ['inner', 'alpha'] }),
      ...scan([], undefined),
    ];
    nodes.find(x => x.id === 'scan')!.inputs.modifier.connection = { nodeId: 's', outputKey: 'splat' };
    const r = compileGraph({ nodes });
    expect(r.success).toBe(false);
    expect((r.errors ?? []).join(' ')).toMatch(/Modifier chain/);
  });

  it('outside a modifier program (a node\'s eye preview) the splat nodes read a pretend splat at the pixel', () => {
    const r = compileGraph({ nodes: [n('splatAttributes', 'a', 0, 0), n('output', 'out', 0, 0, {}, { color: ['a', 'color'] })] });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).not.toContain('sp_base');
    expect(r.fragmentShader).toContain('mat3(vec3(g_uv, 0.0), vec3(0.8)');
  });
});

describe('Splat modifiers: the maths', () => {
  it('Dissolve: Amount 0 keeps every splat with no edge; 1 removes every one', () => {
    for (const soft of [0, 0.08, 0.3]) for (const edge of [0, 0.06]) for (let f = 0; f <= 1.0001; f += 0.05) {
      const a = dissolveAt(f, 0, soft, edge);
      expect(a.vis).toBe(1);
      expect(a.edge).toBeCloseTo(0, 6);
      expect(dissolveAt(f, 1, soft, edge).vis).toBe(0);
    }
  });

  it('Dissolve: low field values go first, and a splat never comes back as Amount rises', () => {
    const soft = 0.08, edge = 0.06;
    expect(dissolveAt(0.2, 0.4, soft, edge).vis).toBeLessThan(dissolveAt(0.8, 0.4, soft, edge).vis);
    for (const f of [0.1, 0.5, 0.9]) {
      let last = 1;
      for (let a = 0; a <= 1.0001; a += 0.01) { const v = dissolveAt(f, a, soft, edge).vis; expect(v).toBeLessThanOrEqual(last + 1e-12); last = v; }
    }
  });

  it('Dissolve: the edge glows brightest at the threshold, fading over Edge width', () => {
    const t = dissolveAt(0.5, 0.5, 0.08, 0.06).threshold;
    expect(dissolveAt(t, 0.5, 0.08, 0.06).edge).toBeCloseTo(1, 6);
    expect(dissolveAt(t + 0.03, 0.5, 0.08, 0.06).edge).toBeGreaterThan(0.2);
    expect(dissolveAt(t + 0.07, 0.5, 0.08, 0.06).edge).toBe(0);
    // Exactly at the threshold the splat is still whole (it fades over Softness below it).
    expect(dissolveAt(t, 0.5, 0.08, 0.06).vis).toBe(1);
    expect(dissolveAt(t - 0.04, 0.5, 0.08, 0.06).vis).toBeCloseTo(0.5, 6);
  });

  it('Explode: home at 0, out at 1, back home with Return home 1, staggered by each splat\'s random', () => {
    for (const r of [0, 0.3, 1]) {
      expect(explodeAt(0, r, 0.5, 0)).toBe(0);
      expect(explodeAt(1, r, 0.5, 0)).toBe(1);
      expect(explodeAt(1, r, 0.5, 1)).toBe(0);
    }
    // Midway, an early splat (random 0) is further out than a late one (random 1).
    expect(explodeAt(0.4, 0, 0.5, 0)).toBeGreaterThan(explodeAt(0.4, 1, 0.5, 0));
    // No stagger: all together.
    expect(explodeAt(0.4, 0, 0, 0)).toBeCloseTo(explodeAt(0.4, 1, 0, 0), 12);
  });
});

describe('Splat modifiers: sorting moved splats', () => {
  /**
   * The GPU's depth pass (shaders.ts SPLAT_DEPTH_FRAG) in plain JS: each moved centre's distance along the camera's
   * forward ray, from the eye. Camera at z = 3 looking down −z, as an unwired Splat Scene's.
   */
  const eye = [0, 0, 3], F = [0, 0, -1];
  const depths = (pts: number[][]) => new Float32Array(pts.map(p => (p[0] - eye[0]) * F[0] + (p[1] - eye[1]) * F[1] + (p[2] - eye[2]) * F[2]));

  it('sorts the moved splats\' depths far to near, as sorting the centres along the view would', () => {
    const d = depths([[0, 0, 0], [0, 0, -5], [0, 0, 2], [0, 0, -1]]);
    expect([...orderByDepth(d, 4)]).toEqual([1, 3, 0, 2]);
    const pos = new Float32Array([0, 0, 0, 0, 0, -5, 0, 0, 2, 0, 0, -1]);
    expect([...sortSplats(pos, 4, F)]).toEqual([1, 3, 0, 2]);
  });

  it('offsets change the order: a splat moved behind another is drawn first', () => {
    expect([...orderByDepth(depths([[0, 0, 0], [0, 0, 1]]), 2)]).toEqual([0, 1]);
    // An explode pushes splat 1 back past splat 0.
    expect([...orderByDepth(depths([[0, 0, 0], [0, 0, -3]]), 2)]).toEqual([1, 0]);
  });

  it('a broken centre (NaN, infinite) doesn\'t spoil the others\' order', () => {
    const d = depths([[0, 0, 0], [NaN, NaN, NaN], [0, 0, -2], [Infinity, 0, Infinity], [0, 0, 1]]);
    const order = [...orderByDepth(d, 5)];
    expect(order.filter(i => i === 0 || i === 2 || i === 4)).toEqual([2, 0, 4]);
    expect(order.length).toBe(5);
  });

  it('the fingerprint changes when the splats (or the camera) move and not when they don\'t', () => {
    const a = depths([[0, 0, 0], [1, 2, 3]]), b = depths([[0, 0, 0], [1, 2, 3]]), c = depths([[0, 0, 0], [1, 2, 2.5]]);
    expect(movedSum(a, 2)).toBe(movedSum(b, 2));
    expect(movedSum(a, 2)).not.toBe(movedSum(c, 2));
  });
});

describe('Splat modifiers: the card and the examples', () => {
  it('"Add a modifier" stacks recipes at the end of the chain, in order, one wire each', () => {
    let ids = 0;
    const next = () => `x${++ids}`;
    let nodes: GraphNode[] = scan([]);
    nodes = addSplatModifier(nodes, 'scan', 'splatDissolve', next)!;
    nodes = addSplatModifier(nodes, 'scan', 'splatExplode', next)!;
    nodes = addSplatModifier(nodes, 'scan', 'custom', next)!;
    const chain = splatModifierChain(nodes, 'scan').map(x => x.type);
    expect(chain).toEqual(['splatSet', 'splatExplode', 'splatDissolve']);
    // Your own: Splat Attributes and Set Splat both start from what came before.
    const attrs = nodes.find(x => x.type === 'splatAttributes')!;
    expect(attrs.inputs.splat.connection?.nodeId).toBe(nodes.find(x => x.type === 'splatExplode')!.id);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    parses(r.splats![0].modifier!.fragmentShader);
    expect(addSplatModifier(nodes, 'nope', 'splatWave', next)).toBeNull();
    expect(SPLAT_MODIFIER_MENU.map(m => m.pick)).toEqual([...SPLAT_RECIPE_TYPES, 'custom']);
  });

  it('the Studio and Play examples compile, every node noted, the Play controls live', () => {
    for (const nodes of [splatModifiersNodes(), splatDissolvePlayNodes()]) {
      const r = compileGraph({ nodes });
      expect(r.errors ?? []).toEqual([]);
      expect(r.splats?.[0]?.modifier).toBeTruthy();
      parses(r.splats![0].modifier!.fragmentShader);
      for (const x of nodes) if (x.type !== 'output') expect(typeof x.params.__comment, x.id).toBe('string');
    }
    // The LFO drives Explode's Amount through its param socket.
    const r = compileGraph({ nodes: splatModifiersNodes() });
    expect(r.splats![0].modifier!.fragmentShader).toMatch(/clamp\(\w+_value, 0\.0, 1\.0\) \* \(1\.0 \+/);
  });
});

describe('Splat modifiers: the splat shader', () => {
  const RAW_PREFIX = '#version 300 es\n';
  it('both variants of the vertex shader, and the fragment shader, parse', () => {
    parses(SPLAT_VERT, RAW_PREFIX);
    parses(SPLAT_VERT_MOD, RAW_PREFIX);
    parses(SPLAT_FRAG, RAW_PREFIX);
    parses(SPLAT_DEPTH_VERT, RAW_PREFIX);
    parses(SPLAT_DEPTH_FRAG, RAW_PREFIX);
    expect(SPLAT_VERT_MOD.startsWith('#define SPLAT_MOD\n')).toBe(true);
    expect(SPLAT_VERT).toContain('#ifdef SPLAT_MOD');
    // The modifier variant reads the two targets at the splat's texel (2048 a row).
    expect(SPLAT_VERT).toContain('ivec2 mt = ivec2(int(i & 2047u), int(i >> 11));');
  });
});
