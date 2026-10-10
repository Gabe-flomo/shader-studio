/**
 * Shader Texture (docs/texture-builder.md): a node holding its own graph, drawn into a texture
 * through the Pass machinery. Compile, the render target and Update modes (app runner and page
 * host), save / load, wiring into an Agents group's food and Grid Rules' start, and the edits
 * that make one (starters, from a Texture node, from a selection or a group).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import * as THREE from 'three';
import { compileGraph } from '../graphCompiler';
import { n, group } from '../../store/graphBuilder';
import { buildShaderTextureSubgraph, makeShaderTexture, restartShaderTexture, selectionToShaderTexture, textureNodeToShaderTexture } from '../../nodes/shaderTextureStarters';
import { growPictureNodes } from '../../store/agentExamplesP3';
import { PassRunner, PassTargets, uniformsRead } from '../../lib/passRunner';
import { ppKeeps, ppSize, ppTargetKey } from '../../play/kit/passPlan.js';
import { phCreate } from '../../play/kit/passHost.js';
import { webPasses } from '../../play/webInput';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { PassProgram } from '../types';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

function ids(prefix = 'st') { let i = 0; return () => `${prefix}${++i}`; }

/** A Shader Texture (noise starter) whose Color is on the Output. */
function basic(params: Record<string, unknown> = {}, starter = 'noise'): GraphNode[] {
  const st = { ...makeShaderTexture(ids(), { x: 0, y: 0 }, { starter, ...params }), id: 'tex' };
  return [st, n('output', 'out', 400, 0, {}, { color: ['tex', 'color'] })];
}

describe('compile', () => {
  it('opens into its inside and a Pass with the node\'s id, at a fixed size, On change', () => {
    const r = compileGraph({ nodes: basic() });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    const [p] = r.passes!;
    expect(p).toMatchObject({ nodeId: 'tex', size: 512, update: 'change', wrap: 'repeat', filter: 'linear', format: 'half', live: true, label: 'Shader Texture' });
    // The inside's nodes keep their ids (st2 = UV, st3 = noise, st4 = palette) and draw in the pass, not the picture.
    expect(p.nodeIds).toEqual(expect.arrayContaining(['st2', 'st3', 'st4']));
    expect(r.finalNodeIds).not.toContain('st3');
    expect(p.fragmentShader).toContain('gl_FragColor');
    expect(r.fragmentShader).toContain(`uniform sampler2D u_pass_${p.slug};`);
    // The node's card reads its outputs from the Pass.
    expect(r.nodeOutputVars.get('tex')?.texture).toBe(`u_pass_${p.slug}`);
  });

  it('every starter compiles', () => {
    for (const s of ['noise', 'gradient', 'circles', 'stripes']) {
      const r = compileGraph({ nodes: basic({}, s) });
      expect(r.errors, s).toBeUndefined();
      expect(r.passes![0].nodeIds.length, s).toBeGreaterThan(1);
    }
  });

  it('draws even when nothing reads it yet (its card and the inside preview show it)', () => {
    const st = { ...makeShaderTexture(ids(), { x: 0, y: 0 }), id: 'tex' };
    const r = compileGraph({ nodes: [st, n('uv', 'uv', 0, 0), n('output', 'out', 0, 0, {}, { color: ['uv', 'uv'] })] });
    expect(r.errors).toBeUndefined();
    expect(r.passes![0].live).toBe(true);
  });

  it('Match the picture and Every frame: scaled with the picture, no Update', () => {
    const r = compileGraph({ nodes: basic({ size: 'canvas', update: 'frame', wrap: 'clamp', filter: 'nearest', format: 'byte' }) });
    const [p] = r.passes!;
    expect(p.size).toBeUndefined();
    expect(p.update).toBeUndefined();
    expect(p).toMatchObject({ scale: 1, wrap: 'clamp', filter: 'nearest', format: 'byte' });
  });

  it('a slider moved inside writes an override on the node, and the compile uses it', () => {
    const nodes = basic();
    const st = nodes[0];
    st.params = { ...st.params, 'st3::scale': 7.5 };
    const r = compileGraph({ nodes });
    expect(JSON.stringify(r.paramUniforms)).toContain('7.5');
  });

  it('two copies with the same inner ids are two passes', () => {
    const a = { ...makeShaderTexture(ids(), { x: 0, y: 0 }), id: 'texA' };
    const b = { ...makeShaderTexture(ids(), { x: 0, y: 0 }), id: 'texB' };
    const s = n('sampleTexture', 's', 0, 0, {}, { texture: ['texB', 'texture'] });
    const r = compileGraph({ nodes: [a, b, s, n('output', 'out', 0, 0, {}, { color: ['texA', 'color'] })] });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.map(p => p.nodeId).sort()).toEqual(['texA', 'texB']);
    expect(r.passes![1].nodeIds.some(id => id.startsWith('tex'))).toBe(true);
  });

  it('inside a plain group', () => {
    const st = { ...makeShaderTexture(ids(), { x: 0, y: 0 }), id: 'tex' };
    const g = group('g', 0, 0, { label: 'G', iterations: 1, inputs: [], outputs: [{ key: 'o', type: 'vec3', label: 'O', from: ['tex', 'color'] }], nodes: [st] });
    const r = compileGraph({ nodes: [g, n('output', 'out', 0, 0, {}, { color: ['g', 'o'] })] });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.map(p => p.nodeId)).toEqual(['tex']);
  });

  it('an Output left inside is ignored', () => {
    const nodes = basic();
    const sg = nodes[0].params.subgraph as SubgraphData;
    sg.nodes.push(n('output', 'innerOut', 0, 0, {}, { color: ['st4', 'color'] }));
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
  });
});

describe('wired into food and starts', () => {
  it('an Agents slime eats it: Food reads the Shader Texture, the Trail\'s Add reads its pass', () => {
    const nodes = growPictureNodes(0, 200);
    const st = { ...makeShaderTexture(ids(), { x: 0, y: 0 }, { starter: 'circles' }), id: 'food' };
    const food = nodes.find(x => x.id === 'gpFood')!;
    food.inputs = { ...food.inputs, c: { ...food.inputs.c, connection: { nodeId: 'food', outputKey: 'color' } } };
    const r = compileGraph({ nodes: [...nodes, st] });
    expect(r.errors).toBeUndefined();
    const p = r.passes!.find(q => q.nodeId === 'food')!;
    expect(p.live).toBe(true);
    // Drawn before the agents step, and read by the trail's step program.
    expect(p.afterAgents).toBe(false);
    expect(r.agents!.trails.some(t => t.readsPasses?.includes(p.slug))).toBe(true);
  });

  it('an Agents Emit takes its Texture as the birth Picture', () => {
    const nodes = growPictureNodes(0, 200);
    const emit = nodes.find(x => x.type === 'agentEmit')!;
    emit.params = { ...emit.params, shape: 'picture' };
    emit.inputs = { ...emit.inputs, picture: { type: 'texture', label: 'Picture', connection: { nodeId: 'food', outputKey: 'texture' } } };
    const st = { ...makeShaderTexture(ids(), { x: 0, y: 0 }), id: 'food' };
    const r = compileGraph({ nodes: [...nodes, st] });
    expect(r.errors).toBeUndefined();
    const p = r.passes!.find(q => q.nodeId === 'food')!;
    expect(r.agents!.groups[0].readsPasses).toContain(p.slug);
  });

  it('Grid Rules starts from it', () => {
    const st = { ...makeShaderTexture(ids(), { x: 0, y: 0 }, { starter: 'stripes' }), id: 'start' };
    const grid = n('gridRules', 'grid', 0, 0, { start: 'image' }, { image: ['start', 'texture'] });
    const r = compileGraph({ nodes: [st, grid, n('output', 'out', 0, 0, {}, { color: ['grid', 'color'] })] });
    expect(r.errors).toBeUndefined();
    const p = r.passes!.find(q => q.nodeId === 'start')!;
    const board = r.passes!.find(q => q.nodeId === 'grid__cells')!;
    expect(board.reads).toContain(p.slug);
  });
});

describe('render target and Update', () => {
  it('a fixed size ignores the picture\'s; its key changes with Resolution', () => {
    expect(ppSize(1920, 1080, 1, 256)).toEqual([256, 256]);
    expect(ppSize(1920, 1080, 0.5)).toEqual([960, 540]);
    const base = { scale: 1, format: 'half', filter: 'linear', wrap: 'repeat', previous: false };
    expect(ppTargetKey({ ...base, size: 256 }, 1920, 1080)).toBe(ppTargetKey({ ...base, size: 256 }, 640, 360));
    expect(ppTargetKey({ ...base, size: 256 }, 640, 360)).not.toBe(ppTargetKey({ ...base, size: 512 }, 640, 360));
  });

  it('ppKeeps: only a Shader Texture with Update, drawn with the same thing, alone', () => {
    expect(ppKeeps({ previous: false }, 'a', 'a')).toBe(false);
    expect(ppKeeps({ update: 'once', previous: false }, undefined, 'a')).toBe(false);
    expect(ppKeeps({ update: 'once', previous: false }, 'a', 'a')).toBe(true);
    expect(ppKeeps({ update: 'change', previous: false }, 'a', 'b')).toBe(false);
    expect(ppKeeps({ update: 'change', previous: false, reads: ['x'] }, 'a', 'a')).toBe(false);
    expect(ppKeeps({ update: 'once', previous: true }, 'a', 'a')).toBe(false);
  });

  it('uniformsRead: only uniforms named after their declaration', () => {
    const fs = 'uniform float u_time;\nuniform vec2 u_resolution;\nuniform float u_k;\nvoid main(){ gl_FragColor = vec4(u_k * u_resolution.x); }';
    expect(uniformsRead(fs, new Set())).toEqual(['u_resolution', 'u_k']);
  });

  /** The app runner on a recording renderer: which slugs drew each frame, and the target sizes. */
  async function appRun(passes: PassProgram[], frames: Array<{ w: number; h: number; set?: Record<string, number>; clear?: boolean }>) {
    const draws: string[][] = [];
    const sizes: string[] = [];
    let frame: string[] = [];
    let target: THREE.WebGLRenderTarget | null = null;
    const bySource = new Map(passes.map(p => [p.fragmentShader, p.slug]));
    const uniforms: Record<string, THREE.IUniform> = { u_resolution: { value: new THREE.Vector2(1, 1) } };
    const renderer = {
      compileAsync: () => Promise.resolve(), getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0 }),
      properties: { get: () => ({}) }, setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; }, clear: () => {},
      render: (scene: THREE.Scene) => {
        const m = (scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
        frame.push(bySource.get(m.fragmentShader)!);
        sizes.push(`${target!.width}x${target!.height}`);
      },
    } as unknown as THREE.WebGLRenderer;
    const runner = new PassRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
    runner.update(passes, 'void main() {}');
    await new Promise(r => setTimeout(r, 0));
    const targets = new PassTargets(renderer, true);
    for (const f of frames) {
      for (const [k, v] of Object.entries(f.set ?? {})) uniforms[k] = { value: v };
      if (f.clear) targets.clearPrevious();
      frame = [];
      runner.run(targets, f.w, f.h);
      draws.push(frame);
    }
    return { draws, sizes, uniforms };
  }

  const sliderGraph = (update: string) => {
    const r = compileGraph({ nodes: basic({ update }) });
    expect(r.errors).toBeUndefined();
    return r.passes!;
  };

  it('On change: drawn once, kept while nothing it reads changes, drawn again when a slider moves', async () => {
    const passes = sliderGraph('change');
    const slug = passes[0].slug;
    const reads = uniformsRead(passes[0].fragmentShader, new Set());
    const slider = reads.find(u => u !== 'u_resolution' && u !== 'u_time')!;
    expect(slider).toBeTruthy();
    const { draws, sizes, uniforms } = await appRun(passes, [
      { w: 960, h: 540, set: { [slider]: 1 } }, { w: 960, h: 540 }, { w: 960, h: 540 },
      { w: 960, h: 540, set: { [slider]: 2 } }, { w: 960, h: 540 },
      { w: 640, h: 360 }, // a resize leaves a fixed size alone
      { w: 640, h: 360, clear: true }, // a new render starts it over
    ]);
    expect(draws).toEqual([[slug], [], [], [slug], [], [], [slug]]);
    expect(new Set(sizes)).toEqual(new Set(['512x512']));
    // Kept frames still bind its texture for the picture.
    expect(uniforms[`u_pass_${slug}`].value).toBeTruthy();
  });

  it('On change ignores the clock unless a Time node is inside', async () => {
    const still = sliderGraph('change');
    expect(still[0].stillTime).toBe(true);
    const a = await appRun(still, [{ w: 960, h: 540, set: { u_time: 1 } }, { w: 960, h: 540, set: { u_time: 2 } }]);
    expect(a.draws.map(d => d.length)).toEqual([1, 0]);
    const nodes = basic({ update: 'change' });
    const sg = nodes[0].params.subgraph as SubgraphData;
    const noise = sg.nodes.find(x => x.type === 'fbm')!;
    sg.nodes.push(n('time', 'clock', 0, 0));
    noise.inputs = { ...noise.inputs, time: { ...noise.inputs.time, connection: { nodeId: 'clock', outputKey: 'time' } } };
    noise.params = { ...noise.params, time_scale: 0.5 };
    const moving = compileGraph({ nodes }).passes!;
    expect(moving[0].stillTime).toBeUndefined();
    const b = await appRun(moving, [{ w: 960, h: 540, set: { u_time: 1 } }, { w: 960, h: 540, set: { u_time: 2 } }, { w: 960, h: 540 }]);
    expect(b.draws.map(d => d.length)).toEqual([1, 1, 0]);
  });

  it('Once: a slider doesn\'t draw it again; Every frame always draws', async () => {
    const once = sliderGraph('once');
    const slider = uniformsRead(once[0].fragmentShader, new Set()).find(u => u !== 'u_resolution' && u !== 'u_time')!;
    const a = await appRun(once, [{ w: 960, h: 540, set: { [slider]: 1 } }, { w: 960, h: 540, set: { [slider]: 2 } }, { w: 960, h: 540 }]);
    expect(a.draws.map(d => d.length)).toEqual([1, 0, 0]);
    const every = sliderGraph('frame');
    const b = await appRun(every, [{ w: 960, h: 540 }, { w: 960, h: 540 }, { w: 960, h: 540 }]);
    expect(b.draws.map(d => d.length)).toEqual([1, 1, 1]);
  });

  it('a page draws Once a single time at its fixed size (and carries size and update in the bundle)', () => {
    const passes = sliderGraph('once');
    const web = webPasses(passes);
    expect(web[0]).toMatchObject({ size: 512, update: 'once' });
    let drawn = 0;
    const sizes: number[][] = [];
    const gl = new Proxy({
      createTexture: () => ({}), createFramebuffer: () => ({}),
      texImage2D: (...a: unknown[]) => { sizes.push([a[3] as number, a[4] as number]); },
    } as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : /^[A-Z0-9_]+$/.test(k) ? k : () => {}) });
    const host = phCreate(gl, web, {
      link: () => ({}), use: () => {}, done: () => {}, quad: () => { drawn++; },
      textures: new Map(), vec2s: new Map(), halfFloat: true,
    });
    for (let i = 0; i < 4; i++) host.run(960, 540);
    expect(drawn).toBe(1);
    expect(sizes).toEqual([[512, 512]]);
    host.clearPrevious();
    host.run(960, 540);
    expect(drawn).toBe(2);
  });
});

describe('save, load and undo', () => {
  it('a new node from the store has its inside; saving and loading compiles the same', () => {
    const st = useNodeGraphStore.getState();
    st.clearToMinimal();
    const id = st.addNode('shaderTexture', { x: 0, y: 0 }, { starter: 'gradient' })!;
    const node = useNodeGraphStore.getState().nodes.find(x => x.id === id)!;
    const sg = node.params.subgraph as SubgraphData;
    expect(sg.nodes.map(x => x.type)).toEqual(['uv', 'exprNode', 'shaderTextureOutput']);
    const out = useNodeGraphStore.getState().nodes.find(x => x.type === 'output')!;
    useNodeGraphStore.getState().connectNodes(id, 'color', out.id, 'color');
    const before = compileGraph({ nodes: useNodeGraphStore.getState().nodes });
    expect(before.errors).toBeUndefined();
    const json = JSON.stringify({ nodes: useNodeGraphStore.getState().nodes });
    expect(useNodeGraphStore.getState().importGraph(json).ok).toBe(true);
    const after = compileGraph({ nodes: useNodeGraphStore.getState().nodes });
    expect(after.passes![0].fragmentShader).toBe(before.passes![0].fragmentShader);
    expect(after.fragmentShader).toBe(before.fragmentShader);
  });

  it('undo takes the node back out', () => {
    const st = useNodeGraphStore.getState();
    st.clearToMinimal();
    const count = useNodeGraphStore.getState().nodes.length;
    st.addNode('shaderTexture', { x: 0, y: 0 });
    expect(useNodeGraphStore.getState().nodes.length).toBe(count + 1);
    useNodeGraphStore.getState().undo();
    expect(useNodeGraphStore.getState().nodes.length).toBe(count);
  });
});

describe('edits that make one', () => {
  it('a starter restarts the inside and keeps the node\'s wires and settings', () => {
    const nodes = basic({ size: '256' });
    const next = restartShaderTexture(nodes, 'tex', 'stripes', ids('x'))!;
    const st = next.find(x => x.id === 'tex')!;
    expect(st.params.size).toBe('256');
    expect((st.params.subgraph as SubgraphData).nodes.find(x => x.type === 'exprNode')?.params.label).toBe('Stripes');
    expect(next.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: 'tex', outputKey: 'color' });
  });

  it('a Texture node becomes a Shader Texture in place, its readers rewired', () => {
    const nodes = [n('textureInput', 'img', 10, 20), n('sampleTexture', 's', 0, 0, {}, { texture: ['img', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['s', 'color'] })];
    const next = textureNodeToShaderTexture(nodes, 'img', ids('y'))!;
    const st = next.find(x => x.type === 'shaderTexture')!;
    expect(st.position).toEqual({ x: 10, y: 20 });
    expect(next.find(x => x.id === 's')!.inputs.texture.connection).toEqual({ nodeId: st.id, outputKey: 'texture' });
    expect(compileGraph({ nodes: next }).errors).toBeUndefined();
  });

  it('a selection becomes its inside; the shared UV is copied in; its reader reads Color', () => {
    const nodes = [
      n('uv', 'uv', 0, 0),
      n('fbm', 'noise', 200, 0, {}, { uv: ['uv', 'uv'] }),
      n('palette', 'pal', 400, 0, {}, { value: ['noise', 'value'] }),
      n('output', 'out', 600, 0, {}, { color: ['pal', 'color'] }),
    ];
    const r = selectionToShaderTexture(nodes, ['noise', 'pal'], ids('z'));
    if ('error' in r) throw new Error(r.error);
    const st = r.nodes.find(x => x.id === r.id)!;
    const inside = (st.params.subgraph as SubgraphData).nodes;
    expect(inside.map(x => x.type).sort()).toEqual(['fbm', 'palette', 'shaderTextureOutput', 'uv']);
    expect(r.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: r.id, outputKey: 'color' });
    expect(r.nodes.some(x => x.id === 'uv')).toBe(true); // the original UV stays for anyone else
    expect(compileGraph({ nodes: r.nodes }).errors).toBeUndefined();
  });

  it('a selection reading something it can\'t take along says what', () => {
    const nodes = [
      n('uv', 'uv', 0, 0),
      n('fbm', 'noise', 200, 0, {}, { uv: ['uv', 'uv'] }),
      n('palette', 'pal', 400, 0, {}, { value: ['noise', 'value'] }),
      n('output', 'out', 600, 0, {}, { color: ['pal', 'color'] }),
    ];
    const r = selectionToShaderTexture(nodes, ['pal'], ids('z'));
    expect('error' in r && r.error).toMatch(/Fractal Noise/);
  });

  it('a plain group with no inputs becomes one', () => {
    const inner = [n('uv', 'gu', 0, 0), n('fbm', 'gn', 0, 0, {}, { uv: ['gu', 'uv'] }), n('palette', 'gp', 0, 0, {}, { value: ['gn', 'value'] })];
    const g = group('g', 0, 0, { label: 'G', iterations: 1, inputs: [], outputs: [{ key: 'o', type: 'vec3', label: 'O', from: ['gp', 'color'] }], nodes: inner });
    const nodes = [g, n('output', 'out', 0, 0, {}, { color: ['g', 'o'] })];
    const r = selectionToShaderTexture(nodes, ['g'], ids('w'));
    if ('error' in r) throw new Error(r.error);
    expect(r.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: r.id, outputKey: 'color' });
    expect(compileGraph({ nodes: r.nodes }).errors).toBeUndefined();
  });

  it('buildShaderTextureSubgraph: Texture Output is anchored and wired', () => {
    const sg = buildShaderTextureSubgraph(ids());
    const out = sg.nodes.find(x => x.type === 'shaderTextureOutput')!;
    expect(out.params._groupOriginal).toBe(true);
    expect(out.inputs.color.connection).toBeTruthy();
  });
});
