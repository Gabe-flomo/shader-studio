/**
 * Blur and Glow (texture)'s hidden passes (compiler/blurPasses.ts, hiddenBlurs.ts;
 * docs/blur-and-glow.md): the plan, where they draw, and the budget.
 */
import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import { n } from '../../store/graphBuilder';
import { MAX_PASSES } from '../passGraph';
import { MAX_HIDDEN_PASSES, blurMethod, hasHiddenBlur, hiddenSlug, planBlur } from '../blurPasses';
import type { GraphNode } from '../../types/nodeGraph';

const picture = (): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }),
  n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }),
];

describe('the plan', () => {
  it('Smooth: across then down, after any halvings; each stage reads the one before', () => {
    const small = planBlur('smooth', 8, 1, false)!;
    expect(small.stages.map(s => [s.key, s.scale, s.reads])).toEqual([['h', 1, ['source']], ['v', 1, ['h']]]);
    expect(small).toMatchObject({ out: 'v', outScale: 1, cubic: false });
    const wide = planBlur('smooth', 48, 0.5, false)!;
    expect(wide.stages.map(s => [s.key, s.scale, s.reads])).toEqual([
      ['d1', 0.25, ['source']], ['d2', 0.125, ['d1']], ['h', 0.125, ['d2']], ['v', 0.125, ['h']],
    ]);
    expect(wide).toMatchObject({ out: 'v', outScale: 0.125, cubic: true });
    // The Glow's threshold is applied where the source is read.
    expect(planBlur('smooth', 8, 1, true)!.stages[0].params.__keep).toBe(true);
    expect(planBlur('smooth', 48, 1, true)!.stages[0].params).toMatchObject({ __stage: 'down', __keep: true });
  });

  it('Bloom chain: levels down, then back up adding each level, ending at level 1', () => {
    const p = planBlur('bloom', 12, 1, true)!;
    expect(p.levels).toBe(4);
    expect(p.stages.map(s => s.key)).toEqual(['d1', 'd2', 'd3', 'd4', 'u3', 'u2', 'u1']);
    expect(p.stages.find(s => s.key === 'u3')!.reads).toEqual(['d3', 'd4']);
    expect(p.stages.find(s => s.key === 'u1')!.reads).toEqual(['d1', 'u2']);
    expect(p).toMatchObject({ out: 'u1', outScale: 0.5, cubic: true });
    expect(p.stages[0].params).toMatchObject({ __stage: 'down', __keep: true });
  });

  it('Fast needs none', () => {
    expect(planBlur('fast', 30, 1, false)).toBeNull();
  });

  it('graphs saved before Method become Smooth (same Radius, same look, no copies); new Glows start as a Bloom chain', () => {
    expect(blurMethod({ type: 'blurTexture', params: { radius: 8, quality: '24' } })).toBe('smooth');
    expect(blurMethod({ type: 'glowTexture', params: { radius: 8 } })).toBe('smooth');
    expect(blurMethod(n('glowTexture', 'g', 0, 0))).toBe('bloom');
    expect(blurMethod(n('blurTexture', 'b', 0, 0))).toBe('smooth');
    expect(blurMethod({ type: 'blurTexture', params: { method: 'bloom' } })).toBe('smooth');
    expect(blurMethod({ type: 'glowTexture', params: { method: 'fast' } })).toBe('fast');
  });

  it('names hidden passes after the node, with no double underscores', () => {
    expect(hiddenSlug('tblur_0', 'h')).toBe('tblur_0Blh');
    expect(hiddenSlug('odd_', 'd1')).toBe('oddBld1');
  });
});

describe('in a compiled graph', () => {
  it('draws the hidden passes just before the program that has the node, and the node reads the last', () => {
    const nodes = [
      ...picture(),
      n('pass', 'pa', 0, 0, { scale: '0.5' }, { color: ['rgb', 'rgb'] }),
      n('blurTexture', 'bl', 0, 0, { radius: 10 }, { texture: ['pa', 'texture'] }),
      n('pass', 'pb', 0, 0, {}, { color: ['bl', 'color'] }),
      n('output', 'out', 0, 0, {}, { color: ['pb', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const order = r.passes!.map(p => [p.nodeId, !!p.hidden]);
    expect(order).toEqual([['pa', false], ['bl', true], ['bl', true], ['pb', false]]);
    const pb = r.passes![3];
    expect(pb.reads).toContain(r.passes![2].slug);
    // The ½ result is read back through the cubic B-spline.
    expect(pb.fragmentShader).toContain(`blCubic(u_pass_${r.passes![2].slug}, `);
    // Hidden passes: half float, linear, no card, the card's slider uniforms.
    for (const h of r.passes!.slice(1, 3)) {
      expect(h).toMatchObject({ format: 'half', filter: 'linear', wrap: 'clamp', previous: false, live: true, nodeIds: [] });
      expect(h.fragmentShader).toContain('u_p_');
    }
    expect(r.paramBindings['bl::radius']).toBeTruthy();
  });

  it('hidden passes do not count towards the Pass nodes', () => {
    const nodes: GraphNode[] = [...picture()];
    let from: [string, string] = ['rgb', 'rgb'];
    for (let i = 0; i < MAX_PASSES; i++) {
      nodes.push(n('pass', `p${i}`, 0, 0, {}, { color: from }));
      nodes.push(n('blurTexture', `b${i}`, 0, 0, { radius: 4 }, { texture: [`p${i}`, 'texture'] }));
      from = [`b${i}`, 'color'];
    }
    nodes.push(n('output', 'out', 0, 0, {}, { color: from }));
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.filter(p => !p.hidden)).toHaveLength(MAX_PASSES);
    expect(r.passes!.filter(p => p.hidden)).toHaveLength(2 * MAX_PASSES);
  });

  it('stops at MAX_HIDDEN_PASSES: a node past it draws in one pass', () => {
    const nodes: GraphNode[] = [...picture(), n('pass', 'p', 0, 0, {}, { color: ['rgb', 'rgb'] })];
    const per = planBlur('bloom', 24, 1, true)!.stages.length;
    const count = Math.floor(MAX_HIDDEN_PASSES / per) + 1;
    let from: [string, string] = ['rgb', 'rgb'];
    for (let i = 0; i < count; i++) {
      nodes.push(n('glowTexture', `g${i}`, 0, 0, { radius: 24 }, { texture: ['p', 'texture'] }));
      nodes.push(n('addColor', `a${i}`, 0, 0, {}, { a: from, b: [`g${i}`, 'glow'] }));
      from = [`a${i}`, 'result'];
    }
    nodes.push(n('output', 'out', 0, 0, {}, { color: from }));
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.filter(p => p.hidden).length).toBe((count - 1) * per);
    expect(r.passes!.filter(p => p.hidden).length).toBeLessThanOrEqual(MAX_HIDDEN_PASSES);
    expect(r.fragmentShader).toContain('blDiscKeep(');
  });

  it('a repeated Pass blurring its own Previous keeps the blur in its program (once per repeat)', () => {
    const nodes = [
      ...picture(),
      n('blurTexture', 'bl', 0, 0, { radius: 3 }, { texture: ['p', 'previous'] }),
      n('addColor', 'mix', 0, 0, { scale: 0.5 }, { a: ['rgb', 'rgb'], b: ['bl', 'color'] }),
      n('pass', 'p', 0, 0, { repeat: 4 }, { color: ['mix', 'result'] }),
      n('output', 'out', 0, 0, {}, { color: ['p', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.some(p => p.hidden)).toBe(false);
    expect(r.passes![0].fragmentShader).toContain('blSoft(u_passprev_');
  });

  it('a once-a-frame Pass blurring its own Previous gets hidden passes that read the frame before', () => {
    const nodes = [
      ...picture(),
      n('blurTexture', 'bl', 0, 0, { radius: 3 }, { texture: ['p', 'previous'] }),
      n('addColor', 'mix', 0, 0, { scale: 0.5 }, { a: ['rgb', 'rgb'], b: ['bl', 'color'] }),
      n('pass', 'p', 0, 0, {}, { color: ['mix', 'result'] }),
      n('output', 'out', 0, 0, {}, { color: ['p', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const [h, v, p] = r.passes!;
    expect([h.hidden, v.hidden, p.hidden]).toEqual([true, true, undefined]);
    expect(h.readsPrevious).toEqual([p.slug]);
    expect(p.previous).toBe(true);
  });

  it('Fast stays in one pass', () => {
    const nodes = [
      ...picture(),
      n('pass', 'p', 0, 0, {}, { color: ['rgb', 'rgb'] }),
      n('blurTexture', 'bl', 0, 0, { radius: 20, method: 'fast', quality: '12' }, { texture: ['p', 'texture'] }),
      n('output', 'out', 0, 0, {}, { color: ['bl', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.passes!.map(p => p.nodeId)).toEqual(['p']);
    expect(r.fragmentShader).toContain('blDisc(u_pass_');
  });

  it('a picture blurred with no Pass node compiles with hidden passes only', () => {
    const nodes = [
      n('textureInput', 'img', 0, 0),
      n('blurTexture', 'bl', 0, 0, { radius: 6 }, { texture: ['img', 'texture'] }),
      n('output', 'out', 0, 0, {}, { color: ['bl', 'color'] }),
    ];
    expect(hasHiddenBlur(nodes)).toBe(true);
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.map(p => !!p.hidden)).toEqual([true, true]);
    expect(Object.keys(r.textureUniforms)).toHaveLength(1);
  });

  it('a graph without a Smooth or Bloom node is not a pass graph', () => {
    const nodes = [n('textureInput', 'img', 0, 0), n('blurTexture', 'bl', 0, 0, { method: 'fast' }, { texture: ['img', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['bl', 'color'] })];
    expect(hasHiddenBlur(nodes)).toBe(false);
    expect(compileGraph({ nodes }).passes).toBeUndefined();
  });
});
