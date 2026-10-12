/**
 * A true reset (docs/true-reset.md, lib/runtimeReset.ts): after ↺ the first frames are the frames a
 * fresh open draws, for the three kinds of state that carry a frame into the next one:
 *
 *  - a grid simulation (a Grid Rules board, a Pass reading its own Previous): its real GLSL run on
 *    the CPU (compiler/__tests__/glslRun.ts) through the app's PassRunner and PassTargets, so the
 *    boards compared are the pixels the GPU would hold;
 *  - an Agents graph (slime mold): the app's AgentRunner and AgentTargets on a recording renderer
 *    that gives every texture a content hash (what was drawn into it, from what), plus the schedule's
 *    numbers, the step governor, the cards' step counts and the transport's kept steps;
 *  - a builder's own preview passes (the Grid builder's rule memory): a fake WebGL2 that keeps what
 *    each texture holds.
 *
 * Each is checked against a control: the same frames without the reset differ, so the test sees it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import * as THREE from 'three';
import { compileGraph } from '../../compiler/graphCompiler';
import type { CompilationResult, PassProgram } from '../../compiler/types';
import { n } from '../../store/graphBuilder';
import { gridCellsId } from '../../compiler/gridRulesExpand';
import { COUNT_PRESETS, presetPatch } from '../../gridRules/spec';
import { compileFragment, drawPass, makeBoard, type Board, type Env, type Program } from '../../compiler/__tests__/glslRun';
import { PassRunner, PassTargets } from '../passRunner';
import { AgentRunner, AgentTargets, agentStatsFor } from '../agentRunner';
import { agentStepInfo, armAgentStepping } from '../agentSnapshots';
import { slimeMoldNodes } from '../../store/agentExamples';
import { makePreviewPasses } from '../../components/builders/previewPasses';

// ── A grid simulation, pixel for pixel ───────────────────────────────────────────────────────────

/**
 * A three.js renderer stand-in that draws for real: every render target is a board of floats, a
 * clear zeroes it, and a draw runs the material's fragment shader on the CPU over the target, with
 * the uniform table's numbers and the boards behind its textures.
 */
function cpuRenderer(uniforms: Record<string, THREE.IUniform>) {
  const boards = new Map<THREE.WebGLRenderTarget, Board>();
  const byTexture = new Map<THREE.Texture, THREE.WebGLRenderTarget>();
  const programs = new Map<string, Program>();
  let target: THREE.WebGLRenderTarget | null = null;
  const boardOf = (rt: THREE.WebGLRenderTarget) => {
    let b = boards.get(rt);
    if (!b || b.w !== rt.width || b.h !== rt.height) {
      b = makeBoard(rt.width, rt.height, rt.texture.wrapS === THREE.RepeatWrapping ? 'repeat' : 'clamp');
      boards.set(rt, b);
      for (const t of rt.textures) byTexture.set(t, rt);
    }
    return b;
  };
  const env = (): { values: Env; samplers: Record<string, Board> } => {
    const values: Env = {}, samplers: Record<string, Board> = {};
    for (const [k, u] of Object.entries(uniforms)) {
      const v = u.value as unknown;
      if (typeof v === 'number') values[k] = v;
      else if (v instanceof THREE.Vector2) values[k] = [v.x, v.y];
      else if (v instanceof THREE.Vector3) values[k] = [v.x, v.y, v.z];
      else if (v instanceof THREE.Vector4) values[k] = [v.x, v.y, v.z, v.w];
      else if (Array.isArray(v)) values[k] = v as number[];
      else if (v instanceof THREE.Texture) { const rt = byTexture.get(v); if (rt) samplers[k] = boardOf(rt); }
    }
    return { values, samplers };
  };
  const renderer = {
    compileAsync: () => Promise.resolve(),
    getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0, flush: () => {} }),
    properties: { get: () => ({}) },
    autoClear: true,
    getClearColor: (c: THREE.Color) => c.setRGB(0, 0, 0), getClearAlpha: () => 0, setClearColor: () => {},
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; if (t) boardOf(t); },
    clear: () => { if (target) boardOf(target).data.fill(0); },
    render: (scene: THREE.Scene) => {
      if (!target) return;
      const m = (scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
      let prog = programs.get(m.fragmentShader);
      if (!prog) { prog = compileFragment(m.fragmentShader); programs.set(m.fragmentShader, prog); }
      const out = boardOf(target);
      const { values, samplers } = env();
      out.data.set(drawPass(prog, out.w, out.h, out.wrap, samplers, values).data);
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, boardOf };
}

const PIC = { w: 256, h: 160 };

async function gridSim() {
  const nodes = [
    n('gridRules', 'g1', 0, 0, { label: 'Life', ...presetPatch(COUNT_PRESETS.life), start: 'noise', density: 0.35, seed: 3, board: '0.125' }),
    n('output', 'out', 0, 0, {}, { color: ['g1', 'color'] }),
  ];
  const r = compileGraph({ nodes }) as CompilationResult;
  expect(r.errors).toBeUndefined();
  const passes = (r.passes ?? []).filter(p => p.live);
  const board = passes.find(p => p.nodeId === gridCellsId('g1'))!;
  expect(board.previous).toBe(true);
  const uniforms: Record<string, THREE.IUniform> = {
    u_time: { value: 0 }, u_frameDt: { value: 1 / 60 }, u_resolution: { value: new THREE.Vector2(PIC.w, PIC.h) },
    u_mouse: { value: new THREE.Vector2(-1000, -1000) }, u_mousebtn: { value: 0 },
  };
  for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = { value: Array.isArray(v) ? [...v] : v };
  const { renderer, boardOf } = cpuRenderer(uniforms);
  const runner = new PassRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
  runner.update(passes as PassProgram[], 'void main() {}');
  await new Promise(res => setTimeout(res, 0));
  const targets = new PassTargets(renderer, true);
  /** One preview frame at `time`: the board drawn, and what the picture reads of it (a copy). */
  const frame = (time: number) => {
    uniforms.u_time.value = time;
    runner.run(targets, PIC.w, PIC.h);
    const tex = uniforms[`u_pass_${board.slug}`].value as THREE.Texture;
    const t = targets.get(board.slug)!;
    const rt = [t.cur, t.prev!].find(x => x.textures.includes(tex))!;
    return Array.from(boardOf(rt).data);
  };
  return { frame, targets };
}

describe('a true reset: a grid simulation (a Grid Rules board)', () => {
  it('the first frames after ↺ are pixel for pixel a fresh open\'s (the same deal, the same steps)', async () => {
    const FIRST = [0, 1 / 60, 2 / 60, 3 / 60];
    const fresh = await gridSim();
    const want = FIRST.map(fresh.frame);
    // Something happened: cells were dealt, and they changed step to step.
    expect(want[0].some(v => v > 0.5)).toBe(true);
    expect(want[1]).not.toEqual(want[0]);

    const sim = await gridSim();
    FIRST.forEach(sim.frame);
    for (let k = 1; k <= 12; k++) sim.frame(0.1 + k * 0.25);
    // ↺: what ShaderCanvas's reset does to the passes (clock 0 is the frame's u_time).
    sim.targets.clearPrevious();
    expect(FIRST.map(sim.frame)).toEqual(want);
  });

  it('control: only the clock back at 0 (the Previous kept) is not the fresh picture', async () => {
    const FIRST = [0, 1 / 60];
    const fresh = await gridSim();
    const want = FIRST.map(fresh.frame);
    const sim = await gridSim();
    for (let k = 0; k <= 8; k++) sim.frame(k * 0.25);
    expect(FIRST.map(sim.frame)).not.toEqual(want);
  });
});

// ── An Agents graph ─────────────────────────────────────────────────────────────────────────────

/** A short stable hash (FNV-1a). */
const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

/**
 * A recording renderer: every render target holds a content hash: '0' when cleared, else the hash of
 * what was drawn into it (the program, the step, the clock, the birth window, the draw count and the
 * contents of every texture the draw read), folded into what it held (additive draws accumulate).
 */
function hashRenderer() {
  const content = new Map<THREE.WebGLRenderTarget, string>();
  const byTexture = new Map<THREE.Texture, THREE.WebGLRenderTarget>();
  const ids = new Map<string, number>();
  let target: THREE.WebGLRenderTarget | null = null;
  const seen = (rt: THREE.WebGLRenderTarget) => { for (const t of rt.textures) byTexture.set(t, rt); if (!content.has(rt)) content.set(rt, 'new'); };
  const read = (v: unknown) => (v instanceof THREE.Texture && byTexture.has(v) ? content.get(byTexture.get(v)!) : undefined);
  const renderer = {
    compileAsync: () => Promise.resolve(),
    getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0, flush: () => {} }),
    properties: { get: () => ({}) },
    autoClear: true,
    getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 0, setClearColor: () => {},
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; if (t) seen(t); },
    clear: () => { if (target) content.set(target, '0'); },
    render: (scene: THREE.Scene) => {
      if (!target) return;
      const obj = scene.children[0] as THREE.Mesh;
      const m = obj.material as THREE.ShaderMaterial;
      let id = ids.get(m.fragmentShader);
      if (id === undefined) { id = ids.size; ids.set(m.fragmentShader, id); }
      const parts: string[] = [`p${id}`, `n${(obj.geometry as THREE.BufferGeometry).drawRange.count}`];
      for (const [k, u] of Object.entries(m.uniforms ?? {})) {
        const v = u.value as unknown;
        const c = read(v);
        if (c !== undefined) parts.push(`${k}=${c}`);
        else if (typeof v === 'number') parts.push(`${k}=${Math.round(v * 1e6) / 1e6}`);
        else if (v instanceof THREE.Vector4 || v instanceof THREE.Vector2) parts.push(`${k}=${v.toArray().join(',')}`);
      }
      content.set(target, hash(`${content.get(target)}|${parts.join('|')}`));
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, contentOf: (rt: THREE.WebGLRenderTarget) => content.get(rt) ?? 'none' };
}

async function agentsSim() {
  const r = compileGraph({ nodes: slimeMoldNodes(0, 0) }) as CompilationResult;
  expect(r.errors).toBeUndefined();
  const spec = r.agents!;
  const uniforms: Record<string, THREE.IUniform> = { u_time: { value: 0 } };
  for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = { value: v };
  const { renderer, contentOf } = hashRenderer();
  const runner = new AgentRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
  runner.update(spec, 'void main() {}');
  await new Promise(res => setTimeout(res, 0));
  const targets = new AgentTargets(renderer, true);
  const g = spec.groups[0];
  /** One live frame: the walkers' and trails' textures (by content), the schedule's numbers and the card's step. */
  const frame = (time: number, frameMs = 16.7) => {
    runner.run(targets, { width: 320, height: 180, time, live: true, frameMs });
    const s = targets.groups.get(g.slug)!;
    const trails = [...targets.trails.entries()].map(([slug, t]) => [slug, t.cur, contentOf(t.rt[t.cur]), contentOf(t.rt[t.cur ^ 1])]);
    return { walkers: [s.cur, contentOf(s.rt[s.cur]), contentOf(s.rt[s.cur ^ 1])], step: s.step, born: s.born, live: { ...s.live }, history: [...s.history], trails, card: agentStatsFor(g.nodeId)?.step };
  };
  /** ↺: what ShaderCanvas's reset does to the agents. */
  const reset = () => { targets.resetAll(); runner.resetRuntime(); };
  return { frame, reset, runner, targets, g };
}

describe('a true reset: an Agents graph (slime mold)', () => {
  const FIRST = [0, 1 / 60, 2 / 60, 3 / 60, 4 / 60];
  const RUN_FOR = 4;
  /** Four seconds at 60 a second, the last three slow (120 ms frames: the governor steps its cap down). */
  const run = (sim: Awaited<ReturnType<typeof agentsSim>>) => { for (let k = 0; k <= RUN_FOR * 60; k++) sim.frame(k / 60, k > 60 ? 120 : 16.7); };

  it('the first frames after ↺ are a fresh open\'s: walkers, trails, step, births, the live clock and the card', async () => {
    const fresh = await agentsSim();
    const want = FIRST.map(t => fresh.frame(t));
    expect(want[4].step).toBeGreaterThan(0);

    const sim = await agentsSim();
    // A while of running, ending in a slow stretch (the step governor lowers its cap to one step a frame).
    run(sim);
    expect(sim.frame(RUN_FOR + 0.02, 120).step).toBeGreaterThan(want[4].step);
    sim.reset();
    expect(agentStatsFor(sim.g.nodeId)?.step).toBe(0);
    expect(FIRST.map(t => sim.frame(t))).toEqual(want);
  });

  it('control: the clock alone sent back (the old ↺: walkers born again, but the runner\'s governor kept) is not the fresh run', async () => {
    const fresh = await agentsSim();
    const want = FIRST.map(t => fresh.frame(t));
    const sim = await agentsSim();
    run(sim);
    expect(FIRST.map(t => sim.frame(t))).not.toEqual(want);
  });

  it('the transport\'s kept steps are forgotten: nothing to step back to into the run before', async () => {
    const close = armAgentStepping();
    try {
      const sim = await agentsSim();
      for (let k = 0; k < 10; k++) sim.frame(k / 60);
      expect(agentStepInfo().kept).toBeGreaterThan(0);
      expect(agentStepInfo().first).not.toBeNull();
      sim.reset();
      expect(agentStepInfo()).toMatchObject({ kept: 0, first: null, pending: 0 });
      // The next frame keeps a snapshot of the new run only (step 0 onwards).
      sim.frame(0);
      sim.frame(1 / 60);
      sim.frame(2 / 60);
      expect(agentStepInfo().kept).toBeGreaterThan(0);
      expect(agentStepInfo().first).toBeLessThan(5);
    } finally { close(); }
  });
});

// ── A builder's own preview passes (the Grid builder's rule memory) ──────────────────────────────

/**
 * A WebGL2 stand-in for previewPasses: each texture holds a content hash ('undef' when (re)made,
 * '0' when cleared, else the hash of the program, the clock and what it read).
 */
function fakeGl() {
  let next = 1;
  const content = new Map<number, string>();
  const fbTex = new Map<number, number>();
  const units = new Map<number, number>();
  let fb = 0, unit = 0, prog = 0, time = 0;
  const loc = new Map<string, { name: string }>();
  const samplerUnit = new Map<string, number>();
  const gl = new Proxy({
    getExtension: () => ({}),
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {}, getShaderParameter: () => true,
    createProgram: () => ({ id: next++ }), attachShader: () => {}, linkProgram: () => {}, getProgramParameter: () => true, deleteProgram: () => {},
    createVertexArray: () => ({}), bindVertexArray: () => {}, deleteVertexArray: () => {}, bindBuffer: () => {}, getAttribLocation: () => -1,
    createTexture: () => ({ id: next++ }), deleteTexture: () => {}, createFramebuffer: () => ({ id: next++ }), deleteFramebuffer: () => {},
    bindTexture: (_: number, t: { id: number } | null) => { if (t) units.set(unit, t.id); },
    texImage2D: () => { const t = units.get(unit); if (t !== undefined) content.set(t, 'undef'); },
    texParameteri: () => {},
    bindFramebuffer: (_: number, f: { id: number } | null) => { fb = f ? f.id : 0; },
    framebufferTexture2D: (_a: number, _b: number, _c: number, t: { id: number }) => { fbTex.set(fb, t.id); },
    clearColor: () => {}, clear: () => { const t = fbTex.get(fb); if (fb && t !== undefined) content.set(t, '0'); },
    useProgram: (p: { id: number }) => { prog = p.id; },
    getUniformLocation: (_p: unknown, name: string) => { const k = `${prog}:${name}`; if (!loc.has(k)) loc.set(k, { name }); return loc.get(k)!; },
    activeTexture: (u: number) => { unit = u; },
    uniform1i: (l: { name: string }, v: number) => { samplerUnit.set(l.name, v); },
    uniform1f: (l: { name: string }, v: number) => { if (l.name === 'u_time') time = v; },
    uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {}, viewport: () => {},
    drawArrays: () => {
      const t = fbTex.get(fb);
      if (!fb || t === undefined) return;
      const reads = [...samplerUnit.entries()].map(([name, u]) => `${name}=${content.get(units.get(u)!)}`).sort().join('|');
      content.set(t, hash(`${prog}|${time}|${reads}`));
    },
    TEXTURE0: 33984, TEXTURE_2D: 1, FRAMEBUFFER: 2, COLOR_ATTACHMENT0: 3,
  } as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : 0) }) as unknown as WebGL2RenderingContext;
  return { gl, content, fbTex };
}

describe('a true reset: a builder\'s preview passes', () => {
  it('reset() makes both targets again, cleared, and the frames after it are a fresh preview\'s', () => {
    const spec = { slug: 'mem', fs: 'void main() {}', size: 8, scale: 1, filter: 'nearest' as const, format: 'half' as const };
    const run = (frames: number[], resetAfter?: number) => {
      const { gl, content, fbTex } = fakeGl();
      const passes = makePreviewPasses(gl, 'void main() {}', [spec], null);
      if (typeof passes === 'string') throw new Error(passes);
      const out: string[] = [];
      frames.forEach((t, i) => {
        passes.draw(null, t, 64, 64);
        out.push([...fbTex.values()].map(id => content.get(id)).join(','));
        if (i === resetAfter) passes.reset();
      });
      return out;
    };
    const FIRST = [0, 0.1, 0.2];
    const fresh = run(FIRST);
    const later = run([0, 0.5, 1, 1.5, ...FIRST], 3);
    expect(later.slice(4)).toEqual(fresh);
    // Control: the clock back at 0 without reset() keeps the memory.
    expect(run([0, 0.5, 1, 1.5, ...FIRST]).slice(4)).not.toEqual(fresh);
  });
});
