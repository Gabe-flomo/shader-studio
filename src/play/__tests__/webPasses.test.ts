/**
 * Pass nodes on web pages (docs/pass-node-plan.md, phase 5): the bundle carries
 * the pass programs only when a graph has them, the export no longer warns,
 * and the page's host (kit/passHost.js, raw WebGL2) draws the same schedule
 * as the app's (lib/passRunner.ts, three.js): both run kit/passPlan.js, and
 * this test drives each through a recording stand-in for its GPU and compares
 * what they draw, into which texture, at what size, frame after frame.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import * as THREE from 'three';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { n } from '../../store/graphBuilder';
import { parsePlayRecord, emptyPlayRecord } from '../../types/play';
import { webInputFrom } from '../webInput';
import { kitScript, playBundle } from '../exportHtml';
import { phCreate } from '../kit/passHost.js';
import { ppFrameSteps } from '../kit/passPlan.js';
import { PassRunner, PassTargets } from '../../lib/passRunner';
import type { CompilationResult, PassProgram } from '../../compiler/types';
import type { GraphNode } from '../../types/nodeGraph';

const edgeGlow = () => compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS.passEdgeGlow.nodes, getNodeDefinition) });

/** Feedback at ½ (Previous), an 8-bit nearest/repeat ¼ pass as a map, Displace and Glow (texture). */
function feedbackGraph(): GraphNode[] {
  return [
    n('uv', 'node_1', 0, 0),
    n('fbm', 'node_2', 0, 0, {}, { uv: ['node_1', 'uv'] }),
    n('palette', 'node_3', 0, 0, {}, { value: ['node_2', 'value'] }),
    n('sampleTexture', 'node_10', 0, 0, { offsetX: 3 }, { texture: ['node_4', 'previous'] }),
    n('addColor', 'node_13', 0, 0, { scale: 0.9 }, { a: ['node_3', 'color'], b: ['node_10', 'color'] }),
    n('pass', 'node_4', 0, 0, { scale: '0.5' }, { color: ['node_13', 'result'] }),
    n('floatToVec3', 'node_6', 0, 0, {}, { input: ['node_2', 'value'] }),
    n('pass', 'node_7', 0, 0, { scale: '0.25', format: 'byte', filter: 'nearest', wrap: 'repeat' }, { color: ['node_6', 'rgb'] }),
    n('displaceTexture', 'node_8', 0, 0, { amount: 30 }, { texture: ['node_4', 'texture'], map: ['node_7', 'texture'] }),
    n('glowTexture', 'node_11', 0, 0, {}, { texture: ['node_4', 'texture'] }),
    n('addColor', 'node_12', 0, 0, {}, { a: ['node_8', 'color'], b: ['node_11', 'glow'] }),
    n('output', 'node_9', 0, 0, {}, { color: ['node_12', 'result'] }),
  ];
}

describe('the web bundle', () => {
  it('carries a Pass graph’s programs with their sampler names, and no longer warns', () => {
    const r = edgeGlow();
    expect(r.passes?.length).toBe(2);
    const { input, missing } = webInputFrom(r, parsePlayRecord(EXAMPLE_GRAPHS.passEdgeGlow.play), { title: 'x', aspect: 'free' });
    expect(missing).toEqual([]);
    const b = playBundle(input) as { graphPasses?: Array<Record<string, unknown>> };
    expect(b.graphPasses?.map(p => p.slug)).toEqual(r.passes!.map(p => p.slug));
    const [a] = b.graphPasses!;
    expect(a).toMatchObject({ fragmentShader: r.passes![0].fragmentShader, scale: r.passes![0].scale, live: true, u: { tex: `u_pass_${a.slug}`, prev: `u_passprev_${a.slug}` } });
    // The node lists stay in the app.
    expect(a).not.toHaveProperty('nodeIds');
    expect(a).not.toHaveProperty('reads');
  });

  it('a graph without a Pass node serializes as before (no graphPasses key)', () => {
    const r = compileGraph({ nodes: [n('uv', 'node_1', 0, 0), n('output', 'node_2', 0, 0, {}, { color: ['node_1', 'uv'] })] });
    const { input } = webInputFrom(r, emptyPlayRecord(), { title: 'x', aspect: 'free' });
    expect(input.graphPasses).toBeUndefined();
    expect(JSON.stringify(playBundle(input))).not.toContain('graphPasses');
  });

  it('the kit hands the runtime the pass host', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { passes: { create: unknown; steps: typeof ppFrameSteps } };
    expect(typeof SSKit.passes.create).toBe('function');
    // And the frame's order, the one the app's live preview and its offline renders run.
    expect(SSKit.passes.steps({ passes: true, split: true, particles: true, agents: true })).toEqual(ppFrameSteps({ passes: true, split: true, particles: true, agents: true }));
  });
});

describe('one frame order for the live preview and pages (kit/passPlan.js ppFrameSteps)', () => {
  const order = (o: Parameters<typeof ppFrameSteps>[0]) => ppFrameSteps(o).map(s => [s.do, s.stage ?? '', s.part ?? '', s.last ? 'last' : ''].filter(Boolean).join(':'));

  it('a graph with nothing but its picture has no steps', () => {
    expect(ppFrameSteps({ passes: false, split: false, particles: false, agents: false })).toEqual([]);
  });

  it('passes, particles and agents keep the order they had (particles, then passes; agents between pre and post)', () => {
    expect(order({ passes: true, split: false, particles: false, agents: false })).toEqual(['passes:last']);
    expect(order({ passes: true, split: false, particles: true, agents: false })).toEqual(['particles', 'passes:last']);
    expect(order({ passes: false, split: false, particles: true, agents: true })).toEqual(['particles', 'agents']);
    expect(order({ passes: true, split: false, particles: false, agents: true })).toEqual(['passes:pre', 'agents', 'passes:post:last']);
  });

  it('the passes the agents read draw before their step', () => {
    const steps = ppFrameSteps({ passes: true, split: false, particles: true, agents: true });
    const agents = steps.findIndex(s => s.do === 'agents');
    const pre = steps.findIndex(s => s.do === 'passes' && s.stage === 'pre');
    expect(pre).toBeGreaterThanOrEqual(0);
    expect(pre).toBeLessThan(agents);
    expect(steps.filter(s => s.last)).toEqual([{ do: 'passes', stage: 'post', last: true }]);
  });

  it('with Emit from, the passes the particles read draw first', () => {
    expect(order({ passes: true, split: true, particles: true, agents: false })).toEqual(['passes:particles', 'particles', 'passes:rest:last']);
    expect(order({ passes: true, split: true, particles: true, agents: true })).toEqual(['passes:particles', 'particles', 'passes:pre:rest', 'agents', 'passes:post:rest:last']);
  });
});

/** One draw: which pass, into which of its textures (0, 1, … in order of first use), at what size, what it saw. */
interface Draw { slug: string; into: number; w: number; h: number; res: string; prev: number | null }
type Frame = { w: number; h: number; stage?: 'pre' | 'post'; part?: 'particles' | 'rest'; clear?: boolean };

/** Numbers each pass's textures in the order they are first seen (the draw target first, then its Previous). */
function numbering() {
  const ids = new Map<unknown, number>(), count = new Map<string, number>();
  return (slug: string, obj: unknown) => {
    if (!ids.has(obj)) { const k = count.get(slug) ?? 0; ids.set(obj, k); count.set(slug, k + 1); }
    return ids.get(obj)!;
  };
}

/** The app's runner on a recording three.js renderer. */
async function appDraws(passes: PassProgram[], frames: Frame[]): Promise<Draw[]> {
  const out: Draw[] = [];
  const idOf = numbering();
  let target: THREE.WebGLRenderTarget | null = null;
  const bySource = new Map(passes.map(p => [p.fragmentShader, p.slug]));
  const uniforms: Record<string, THREE.IUniform> = { u_resolution: { value: new THREE.Vector2(1, 1) } };
  let targets: PassTargets | null = null;
  const renderer = {
    compileAsync: () => Promise.resolve(),
    getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0 }),
    properties: { get: () => ({}) },
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; },
    clear: () => {},
    render: (scene: THREE.Scene) => {
      const m = (scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
      const slug = bySource.get(m.fragmentShader)!;
      const res = uniforms.u_resolution.value as THREE.Vector2;
      const t = targets!.get(slug)!;
      expect(t.cur).toBe(target);
      const into = idOf(slug, target);
      const bound = uniforms[`u_passprev_${slug}`]?.value as THREE.Texture | null;
      if (t.prev) expect(bound).toBe(t.prev.texture);
      out.push({ slug, into, w: target!.width, h: target!.height, res: `${res.x}x${res.y}`, prev: t.prev ? idOf(slug, t.prev) : null });
    },
  } as unknown as THREE.WebGLRenderer;
  const runner = new PassRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
  runner.update(passes, 'void main() {}');
  await new Promise(r => setTimeout(r, 0));
  targets = new PassTargets(renderer, true);
  for (const f of frames) {
    if (f.clear) targets.clearPrevious();
    runner.run(targets, f.w, f.h, undefined, f.stage, f.part);
  }
  return out;
}

/** The page's host on a recording WebGL2 stand-in. */
function pageDraws(passes: PassProgram[], frames: Frame[]): Draw[] {
  const out: Draw[] = [];
  const idOf = numbering();
  let nextObj = 1, vp = [0, 0];
  let fb: { id: number; tex?: { id: number } } | null = null;
  const gl = new Proxy({
    createTexture: () => ({ id: nextObj++ }), createFramebuffer: () => ({ id: nextObj++ }),
    bindFramebuffer: (_: number, f: typeof fb) => { fb = f; },
    framebufferTexture2D: (_a: number, _b: number, _c: number, t: { id: number }) => { fb!.tex = t; },
    viewport: (_x: number, _y: number, w: number, h: number) => { vp = [w, h]; },
  } as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : /^[A-Z0-9_]+$/.test(k) ? k : () => {}) });
  const textures = new Map<string, { id: number } | null>();
  const env = {
    link: (fs: string) => ({ slug: passes.find(p => p.fragmentShader === fs)!.slug }),
    use: (p: { slug: string }, w: number, h: number) => {
      const prev = textures.get(`u_passprev_${p.slug}`);
      const into = idOf(p.slug, fb!.tex);
      const keeps = passes.find(x => x.slug === p.slug)!.previous;
      out.push({ slug: p.slug, into, w: vp[0], h: vp[1], res: `${w}x${h}`, prev: keeps && prev ? idOf(p.slug, prev) : null });
    },
    done: () => {}, quad: () => {},
    textures, vec2s: new Map(), halfFloat: true,
  };
  const host = phCreate(gl, passes.map(p => ({ ...p, u: { tex: `u_pass_${p.slug}`, prev: `u_passprev_${p.slug}` } })), env);
  for (const f of frames) {
    if (f.clear) host.clearPrevious();
    host.run(f.w, f.h, f.stage, f.part);
  }
  return out;
}

describe('the same schedule in the app and on a page (kit/passPlan.js)', () => {
  const frames = [
    { w: 960, h: 540 }, { w: 960, h: 540 }, { w: 960, h: 540 },
    // A resize makes the targets again; a new render clears Previous.
    { w: 640, h: 360 }, { w: 640, h: 360, clear: true }, { w: 640, h: 360 },
  ];

  it('Passes 1 · Edge glow', async () => {
    const r = edgeGlow();
    const app = await appDraws(r.passes!, frames), page = pageDraws(r.passes!, frames);
    expect(app.length).toBe(frames.length * 2);
    expect(page).toEqual(app);
    // Pass B is drawn at half size, with its own size as u_resolution.
    expect(page[1]).toMatchObject({ w: 480, h: 270, res: '480x270' });
  });

  it('feedback, an 8-bit nearest pass, Displace and Glow', async () => {
    const r = compileGraph({ nodes: feedbackGraph() }) as CompilationResult;
    expect(r.errors).toBeUndefined();
    const app = await appDraws(r.passes!, frames), page = pageDraws(r.passes!, frames);
    expect(page).toEqual(app);
    // The feedback pass ping-pongs: it draws into one texture while reading the other.
    const fb = page.filter(d => d.slug === r.passes!.find(p => p.previous)!.slug);
    expect(fb.slice(0, 3).map(d => [d.into, d.prev])).toEqual([[0, 1], [1, 0], [0, 1]]);
  });

  it('with agents: the passes draw in two stages, pre and post', async () => {
    const r = edgeGlow();
    const staged = r.passes!.map((p, i) => ({ ...p, afterAgents: i === 1 }));
    const f2 = [{ w: 960, h: 540, stage: 'pre' as const }, { w: 960, h: 540, stage: 'post' as const }];
    const app = await appDraws(staged, f2), page = pageDraws(staged, f2);
    expect(page).toEqual(app);
    expect(page.map(d => d.slug)).toEqual([staged[0].slug, staged[1].slug]);
  });

  it('with Particles reading a pass: those draw first (part particles), the rest after', async () => {
    const r = edgeGlow();
    const split = r.passes!.map((p, i) => ({ ...p, beforeParticles: i === 0 }));
    const f2 = [{ w: 960, h: 540, part: 'particles' as const }, { w: 960, h: 540, part: 'rest' as const }];
    const app = await appDraws(split, f2), page = pageDraws(split, f2);
    expect(page).toEqual(app);
    expect(page.map(d => d.slug)).toEqual([split[0].slug, split[1].slug]);
  });

  it('a pass drawn in an earlier call of the frame keeps its Previous at the frame before', async () => {
    // The feedback pass draws before the particles; the picture still reads last frame's Previous of it.
    const r = compileGraph({ nodes: feedbackGraph() }) as CompilationResult;
    const fbSlug = r.passes!.find(p => p.previous)!.slug;
    const split = r.passes!.map(p => ({ ...p, beforeParticles: p.slug === fbSlug }));
    const f = [
      { w: 960, h: 540, part: 'particles' as const }, { w: 960, h: 540, part: 'rest' as const },
      { w: 960, h: 540, part: 'particles' as const }, { w: 960, h: 540, part: 'rest' as const },
    ];
    const app = await appDraws(split, f), page = pageDraws(split, f);
    expect(page).toEqual(app);
    // The app's shared uniform: after the 'rest' call it must still hold the texture the pass read
    // (its previous frame), not the one it just drew.
    const uniforms: Record<string, THREE.IUniform> = { u_resolution: { value: new THREE.Vector2(1, 1) } };
    const renderer = {
      compileAsync: () => Promise.resolve(), getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0 }),
      properties: { get: () => ({}) }, setRenderTarget: () => {}, clear: () => {}, render: () => {},
    } as unknown as THREE.WebGLRenderer;
    const runner = new PassRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
    runner.update(split, 'void main() {}');
    await new Promise(res => setTimeout(res, 0));
    expect(runner.splitsForParticles).toBe(true);
    const targets = new PassTargets(renderer, true);
    runner.run(targets, 960, 540, undefined, undefined, 'particles');
    const drawn = uniforms[`u_pass_${fbSlug}`].value;
    const before = uniforms[`u_passprev_${fbSlug}`].value;
    expect(before).not.toBe(drawn);
    runner.run(targets, 960, 540, undefined, undefined, 'rest');
    expect(uniforms[`u_passprev_${fbSlug}`].value).toBe(before);
  });
});
