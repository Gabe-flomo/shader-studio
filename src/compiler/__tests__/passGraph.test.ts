/**
 * Pass node compiler (docs/pass-node-plan.md, phase 1): the cut into
 * programs, their order, slug stability across programs, the Previous cycle
 * cut and the errors. Pass-free graphs are covered by goldenShaders.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { hasPassNode, MAX_PASSES } from '../passGraph';
import { n, group, port } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';

/** uv → circle → grey → Pass A → (color) → add with the circle again → output. */
function simple(): GraphNode[] {
  return [
    n('uv', 'node_1', 0, 0),
    n('circleSDF', 'node_2', 0, 0, { radius: 0.4 }, { position: ['node_1', 'uv'] }),
    n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
    n('pass', 'node_4', 0, 0, {}, { color: ['node_3', 'rgb'] }),
    n('addColor', 'node_5', 0, 0, { scale: 0.5 }, { a: ['node_4', 'color'], b: ['node_3', 'rgb'] }),
    n('output', 'node_6', 0, 0, {}, { color: ['node_5', 'result'] }),
  ];
}

const declared = (fs: string) => new Set((fs.match(/^uniform \w+ (\w+);/gm) ?? []).map(l => l.split(' ')[2].replace(';', '')));

describe('Pass node compile', () => {
  it('finds Pass nodes at the top level and inside groups', () => {
    expect(hasPassNode(simple())).toBe(true);
    expect(hasPassNode(simple().filter(x => x.type !== 'pass'))).toBe(false);
  });

  it('cuts the graph into a pass program and a final program', () => {
    const r = compileGraph({ nodes: simple() });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.passes).toHaveLength(1);
    const [a] = r.passes!;
    expect(a).toMatchObject({ nodeId: 'node_4', slug: 'pass_4', scale: 1, format: 'half', filter: 'linear', wrap: 'clamp', previous: false, live: true, reads: [], readsPrevious: [] });
    expect(a.nodeIds.sort()).toEqual(['node_1', 'node_2', 'node_3']);
    // The pass program draws the circle into its texture.
    expect(a.fragmentShader).toContain('gl_FragColor = vec4(f2v_3');
    expect(a.fragmentShader).not.toContain('u_pass_pass_4');
    // The final program samples it and still computes the circle itself (Add reads it directly).
    expect(r.fragmentShader).toContain('uniform sampler2D u_pass_pass_4;');
    expect(r.fragmentShader).toContain('texture2D(u_pass_pass_4, vUv)');
    expect(r.fragmentShader).toContain('circ_2');
  });

  it('names a node\'s uniforms the same in every program it lands in', () => {
    const r = compileGraph({ nodes: simple() });
    const radius = r.paramBindings['node_2::radius'];
    expect(radius).toBeTruthy();
    expect(declared(r.passes![0].fragmentShader).has(radius)).toBe(true);
    expect(declared(r.fragmentShader).has(radius)).toBe(true);
    expect(r.nodeSlugMap?.get('node_2')).toBe('circ_2');
  });

  it('leaves nodes only a Pass needs out of the final program', () => {
    const nodes = simple();
    nodes[4] = n('addColor', 'node_5', 0, 0, {}, { a: ['node_4', 'color'] });
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).not.toContain('circ_2');
    expect(r.passes![0].fragmentShader).toContain('circ_2');
  });

  it('gives probes the variables of nodes only a pass program has (phase 3)', () => {
    const nodes = simple();
    nodes[4] = n('addColor', 'node_5', 0, 0, {}, { a: ['node_4', 'color'] });
    const r = compileGraph({ nodes });
    // circ_2 is drawn only by the pass: its variables come from the pass program, by the same slug.
    const vars = r.nodeOutputVars.get('node_2');
    expect(vars).toBeTruthy();
    expect(r.fragmentShader).not.toContain(vars!.distance);
    expect(r.passes![0].fragmentShader).toContain(vars!.distance);
    expect(r.passes![0].nodeIds).toContain('node_2');
    // The final program's own nodes keep their variables from the final program.
    expect(r.fragmentShader).toContain(r.nodeOutputVars.get('node_5')!.result);
    // The compiler's own Pass output never shows.
    expect([...r.nodeOutputVars.keys()].some(k => k.endsWith('__out'))).toBe(false);
  });

  it('orders chained passes and skips passes nothing reads', () => {
    const nodes = [
      n('uv', 'node_1', 0, 0),
      n('circleSDF', 'node_2', 0, 0, {}, { position: ['node_1', 'uv'] }),
      n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
      // B reads A, final reads B; C is drawn into but read by nothing.
      n('pass', 'node_20', 0, 0, { scale: '0.5' }, { color: ['node_10', 'color'] }),
      n('pass', 'node_10', 0, 0, {}, { color: ['node_3', 'rgb'] }),
      n('pass', 'node_30', 0, 0, {}, { color: ['node_3', 'rgb'] }),
      n('output', 'node_6', 0, 0, {}, { color: ['node_20', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const order = r.passes!.map(p => p.nodeId);
    expect(order.indexOf('node_10')).toBeLessThan(order.indexOf('node_20'));
    const by = Object.fromEntries(r.passes!.map(p => [p.nodeId, p]));
    expect(by.node_20.reads).toEqual(['pass_10']);
    expect(by.node_20.scale).toBe(0.5);
    expect(by.node_10.live && by.node_20.live).toBe(true);
    expect(by.node_30.live).toBe(false);
  });

  it('rejects a Pass fed its own picture (not through Previous)', () => {
    const nodes = [
      n('uv', 'node_1', 0, 0),
      n('circleSDF', 'node_2', 0, 0, {}, { position: ['node_1', 'uv'] }),
      n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
    ];
    // A Pass whose input is its own colour output would be a real loop: rejected.
    const loop = [...nodes,
      n('addColor', 'node_5', 0, 0, {}, { a: ['node_3', 'rgb'], b: ['node_4', 'color'] }),
      n('pass', 'node_4', 0, 0, {}, { color: ['node_5', 'result'] }),
      n('output', 'node_6', 0, 0, {}, { color: ['node_4', 'color'] }),
    ];
    const bad = compileGraph({ nodes: loop });
    expect(bad.success).toBe(false);
    expect(bad.errors!.join(' ')).toMatch(/Previous/);
  });

  it('rejects a Pass inside an iterated group (a plain one opens: passP7.test.ts)', () => {
    const inner = [n('uv', 'n_1', 0, 0), n('pass', 'n_2', 0, 0, {}, { color: port('c') })];
    const nodes = [
      n('uv', 'node_1', 0, 0),
      n('floatToVec3', 'node_3', 0, 0),
      group('group_9', 0, 0, { label: 'G', iterations: 3, inputs: [{ key: 'c', type: 'vec3', label: 'C', from: ['node_3', 'rgb'] }], outputs: [{ key: 'o', type: 'vec3', label: 'O', from: ['n_2', 'color'] }], nodes: inner }),
      n('output', 'node_6', 0, 0, {}, { color: ['group_9', 'o'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(false);
    expect(r.errors![0]).toMatch(/^Node group_9: "G" repeats its nodes \(Iterations above 1\)/);
  });

  it(`allows up to ${MAX_PASSES} passes`, () => {
    const nodes: GraphNode[] = [n('uv', 'node_1', 0, 0), n('floatToVec3', 'node_2', 0, 0)];
    let prev: [string, string] = ['node_2', 'rgb'];
    for (let i = 0; i < MAX_PASSES + 1; i++) { nodes.push(n('pass', `node_${100 + i}`, 0, 0, {}, { color: prev })); prev = [`node_${100 + i}`, 'color']; }
    nodes.push(n('output', 'node_9', 0, 0, {}, { color: prev }));
    const r = compileGraph({ nodes });
    expect(r.success).toBe(false);
    expect(r.errors![0]).toMatch(/up to 8 Pass nodes/);
    const ok = compileGraph({ nodes: nodes.filter(x => x.id !== `node_${100 + MAX_PASSES}`).map(x => x.type === 'output' ? n('output', 'node_9', 0, 0, {}, { color: [`node_${100 + MAX_PASSES - 1}`, 'color'] }) : x) });
    expect(ok.errors).toBeUndefined();
    expect(ok.passes).toHaveLength(MAX_PASSES);
  });

  it('counts samplers per program', () => {
    // 17 passes would be over the pass limit anyway; check the count with images instead.
    const nodes: GraphNode[] = [n('uv', 'node_1', 0, 0)];
    let acc: [string, string] | null = null;
    for (let i = 0; i < 17; i++) {
      nodes.push(n('textureInput', `node_${200 + i}`, 0, 0));
      if (acc) { nodes.push(n('addColor', `node_${300 + i}`, 0, 0, {}, { a: acc, b: [`node_${200 + i}`, 'color'] })); acc = [`node_${300 + i}`, 'result']; }
      else acc = [`node_${200 + i}`, 'color'];
    }
    nodes.push(n('pass', 'node_4', 0, 0, {}, { color: acc! }), n('output', 'node_6', 0, 0, {}, { color: ['node_4', 'color'] }));
    const r = compileGraph({ nodes });
    expect(r.success).toBe(false);
    expect(r.errors![0]).toMatch(/more than 16 textures/);
  });
});

describe('texture-sampling nodes', () => {
  /** uv → circle → grey → Pass A → Edges → Pass B (½) → Blur → Add over the circle → output. */
  function edgeGlow(): GraphNode[] {
    return [
      n('uv', 'node_1', 0, 0),
      n('circleSDF', 'node_2', 0, 0, {}, { position: ['node_1', 'uv'] }),
      n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
      n('pass', 'node_4', 0, 0, {}, { color: ['node_3', 'rgb'] }),
      n('edgesTexture', 'node_5', 0, 0, {}, { texture: ['node_4', 'texture'] }),
      n('pass', 'node_6', 0, 0, { scale: '0.5' }, { color: ['node_5', 'color'] }),
      n('blurTexture', 'node_7', 0, 0, { radius: 6 }, { texture: ['node_6', 'texture'] }),
      n('addColor', 'node_8', 0, 0, {}, { a: ['node_3', 'rgb'], b: ['node_7', 'color'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['node_8', 'result'] }),
    ];
  }

  it('compiles the edge-glow chain into two passes and a final program', () => {
    const r = compileGraph({ nodes: edgeGlow() });
    expect(r.errors).toBeUndefined();
    // Blur (texture) is Smooth: two hidden passes (across, then down) after Pass B, before the picture.
    expect(r.passes!.map(p => p.slug)).toEqual(['pass_4', 'pass_6', 'tblur_7Blh', 'tblur_7Blv']);
    expect(r.passes!.map(p => !!p.hidden)).toEqual([false, false, true, true]);
    const [a, b, h, v] = r.passes!;
    expect(h.reads).toEqual(['pass_6']);
    expect(h.fragmentShader).toContain('blGauss(u_pass_pass_6, vUv,');
    expect(v.reads).toEqual(['tblur_7Blh']);
    expect(v.fragmentShader).toContain('blGauss(u_pass_tblur_7Blh, vUv,');
    // Both stages read the card's Radius uniform.
    for (const st of [h, v]) expect(st.fragmentShader).toContain('u_p_tblurx7_radius');
    expect(a.nodeIds.sort()).toEqual(['node_1', 'node_2', 'node_3']);
    // Pass B runs Edges over Pass A's texture, in picture pixels.
    expect(b.reads).toEqual(['pass_4']);
    expect(b.fragmentShader).toContain('uniform sampler2D u_pass_pass_4;');
    expect(b.fragmentShader).toContain('u_pass_pass_4_px');
    expect(b.fragmentShader).not.toContain('circ_2');
    // The final program blurs Pass B and adds the circle, computed again here.
    expect(r.fragmentShader).toContain('blCubic(u_pass_tblur_7Blv,');
    expect(r.fragmentShader).toContain('circ_2');
    expect(r.fragmentShader).not.toContain('u_pass_pass_4;');
    // Sliders stay uniforms with one name everywhere.
    expect(r.paramBindings['node_7::radius']).toBe('u_p_tblurx7_radius');
    expect(r.paramBindings['node_5::strength']).toBeTruthy();
  });

  it('reads black when no texture is wired', () => {
    const nodes = [
      n('blurTexture', 'node_7', 0, 0),
      n('pass', 'node_4', 0, 0, {}, { color: ['node_7', 'color'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['node_4', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes![0].fragmentShader).toContain('vec4 tblur_7_acc = vec4(0.0);');
  });

  it('refuses a texture wire into a colour input', () => {
    const nodes = [
      n('floatToVec3', 'node_3', 0, 0),
      n('pass', 'node_4', 0, 0, {}, { color: ['node_3', 'rgb'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['node_4', 'texture'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(false);
    expect(r.errors!.join(' ')).toMatch(/Expected vec3, got texture/);
  });
});

describe('feedback, glow and displace (phase 4)', () => {
  /** A circle plus this Pass's own previous frame, read slightly offset: trails. */
  function trails(): GraphNode[] {
    return [
      n('uv', 'node_1', 0, 0),
      n('circleSDF', 'node_2', 0, 0, {}, { position: ['node_1', 'uv'] }),
      n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
      n('sampleTexture', 'node_10', 0, 0, { offsetX: 2 }, { texture: ['node_4', 'previous'] }),
      n('addColor', 'node_5', 0, 0, { scale: 0.95 }, { a: ['node_3', 'rgb'], b: ['node_10', 'color'] }),
      n('pass', 'node_4', 0, 0, { scale: '0.5' }, { color: ['node_5', 'result'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['node_4', 'color'] }),
    ];
  }

  it('cuts a loop through Previous and marks the pass for ping-pong', () => {
    const r = compileGraph({ nodes: trails() });
    expect(r.errors).toBeUndefined();
    const [p] = r.passes!;
    expect(p).toMatchObject({ slug: 'pass_4', previous: true, live: true, reads: [], readsPrevious: ['pass_4'] });
    // The pass program reads its own last frame, and its own texture never.
    expect(p.fragmentShader).toContain('texture2D(u_passprev_pass_4,');
    expect(p.fragmentShader).not.toMatch(/texture2D\(u_pass_pass_4\b/);
    expect(r.fragmentShader).toContain('texture2D(u_pass_pass_4, vUv)');
  });

  it('a pass read only through Previous by the picture is still drawn', () => {
    const nodes = [
      n('floatToVec3', 'node_3', 0, 0),
      n('pass', 'node_4', 0, 0, {}, { color: ['node_3', 'rgb'] }),
      n('sampleTexture', 'node_10', 0, 0, {}, { texture: ['node_4', 'previous'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['node_10', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.passes![0]).toMatchObject({ previous: true, live: true });
  });

  it('compiles Glow and Displace over passes', () => {
    const nodes = [
      n('uv', 'node_1', 0, 0),
      n('circleSDF', 'node_2', 0, 0, {}, { position: ['node_1', 'uv'] }),
      n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
      n('pass', 'node_4', 0, 0, {}, { color: ['node_3', 'rgb'] }),
      n('fbm', 'node_5', 0, 0, {}, { uv: ['node_1', 'uv'] }),
      n('floatToVec3', 'node_6', 0, 0, {}, { input: ['node_5', 'value'] }),
      n('pass', 'node_7', 0, 0, { scale: '0.25' }, { color: ['node_6', 'rgb'] }),
      n('displaceTexture', 'node_8', 0, 0, { amount: 30 }, { texture: ['node_4', 'texture'], map: ['node_7', 'texture'] }),
      n('glowTexture', 'node_11', 0, 0, { threshold: 0.3 }, { texture: ['node_4', 'texture'] }),
      n('addColor', 'node_12', 0, 0, {}, { a: ['node_8', 'color'], b: ['node_11', 'glow'] }),
      n('output', 'node_9', 0, 0, {}, { color: ['node_12', 'result'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.fragmentShader).toContain('texture2D(u_pass_pass_7, tdisp_8_uv).rg');
    // Glow is a Bloom chain: its first downsample keeps what is over Threshold.
    const d1 = r.passes!.find(p => p.slug === 'tglow_11Bld1')!;
    expect(d1.hidden).toBe(true);
    expect(d1.fragmentShader).toMatch(/blDown13Keep\(u_pass_pass_4, vUv, .*u_p_tglowx11_threshold/);
    expect(r.fragmentShader).toContain('blCubic(u_pass_tglow_11Blu1,');
    expect(Object.keys(r.paramBindings)).toEqual(expect.arrayContaining(['node_8::amount', 'node_11::threshold', 'node_11::radius', 'node_11::intensity']));
  });
});
