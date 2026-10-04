/**
 * The Agents family on web pages (docs/agents-plan.md §9, P5): the bundle
 * carries the agents only when a graph has them (with every uniform name the
 * page fills), the export no longer warns, the shared per-frame logic in
 * kit/agentPlan.js behaves, and the page's host (kit/agentHost.js, raw
 * WebGL2) runs the same schedule as the app's (lib/agentRunner.ts, three.js):
 * each driven through a recording stand-in for its GPU, frame after frame,
 * live and offline, they run the same programs in the same order with the
 * same step numbers, birth windows, step clocks, listener values and draw
 * counts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import * as THREE from 'three';
import { compileGraph } from '../../compiler/graphCompiler';
import { antsNodes } from '../../store/agentExamplesP3';
import { particlesNodes, slimeMoldNodes, soundBurstNodes } from '../../store/agentExamples';
import { n } from '../../store/graphBuilder';
import { emptyPlayRecord } from '../../types/play';
import { webAgents, webInputFrom } from '../webInput';
import { kitScript, playBundle } from '../exportHtml';
import { ahCreate } from '../kit/agentHost.js';
import { AG_DEPOSIT_FRAG, AG_TRAIL_FRAG, AG_DRAW_FRAG, AG_DOWN_FRAG, AG_BLUR_FRAG, AG_COMPOSE_FRAG } from '../kit/agentShaders.js';
import { agDrawLook, agGroupState, agGroupSteps, agHear, agListenState, agStepWindow } from '../kit/agentPlan.js';
import { AgentRunner, AgentTargets } from '../../lib/agentRunner';
import type { AgentsSpec, CompilationResult } from '../../compiler/types';
import type { WebAgents } from '../exportHtml';

const compile = (nodes: ReturnType<typeof slimeMoldNodes>) => compileGraph({ nodes }) as CompilationResult;

describe('the web bundle', () => {
  it('carries the agents with their uniform names, and no longer warns', () => {
    const r = compile(soundBurstNodes(0, 0));
    const { input, missing } = webInputFrom(r, emptyPlayRecord(), { title: 'x', aspect: 'free' });
    expect(missing).toEqual([]);
    const a = (playBundle(input) as { agents?: WebAgents }).agents!;
    const g = a.groups[0], src = r.agents!.groups[0];
    expect(g.fragmentShader).toBe(src.fragmentShader);
    expect(g.u).toEqual({ A: `u_agA_${src.slug}`, B: `u_agB_${src.slug}`, C: `u_agC_${src.slug}`, D: `u_agD_${src.slug}`, step: `u_agStep_${src.slug}`, win: `u_agWin_${src.slug}` });
    expect(g.listeners[0].u.shocks).toBe(`u_agShk_${src.listeners[0].slug}`);
    expect(a.draws[0].u.tex).toBe(`u_agdraw_${r.agents!.draws[0].slug}`);
    expect(a.bessel).toBe('u_agBessel');
    // The node lists stay in the app.
    expect(g).not.toHaveProperty('nodeIds');
    expect(g.listeners[0]).not.toHaveProperty('nodeId');
    // Every name the page needs is declared by the programs it runs.
    expect(src.fragmentShader).toContain(`uniform highp uint ${g.u.step};`);
  });

  it('a Trail with Add / Block carries its step program and its names', () => {
    const r = compile(antsNodes(0, 0));
    const t = webAgents(r.agents!).trails[0];
    expect(t.stepShader).toBe(r.agents!.trails[0].stepShader);
    expect(t.u).toEqual({ tex: `u_trail_${t.slug}`, src: `u_trSrc_${t.slug}`, step: `u_trStep_${t.slug}` });
  });

  it('Motion (texture) is filled by the page: the bundle names its sampler only when a program reads it', () => {
    const r = compile([n('motionMap', 'mm', 0, 0), n('output', 'out', 400, 0, {}, { color: ['mm', 'amount'] })]);
    expect(webInputFrom(r, emptyPlayRecord(), { title: 'x', aspect: 'free' }).input.motionMap).toBe('u_motionMap');
    const plain = compile([n('uv', 'u', 0, 0), n('output', 'out', 400, 0, {}, { color: ['u', 'uv'] })]);
    const { input } = webInputFrom(plain, emptyPlayRecord(), { title: 'x', aspect: 'free' });
    expect(input.motionMap).toBeUndefined();
    expect(input.agents).toBeUndefined();
    const json = JSON.stringify(playBundle(input));
    for (const k of ['"agents"', '"motionMap"', '"graphPasses"']) expect(json).not.toContain(k);
  });

  it('the kit hands the runtime the agents host, and its one scope has no clashing names', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { agents: { create: unknown; unsupported: (gl: unknown) => string | null } };
    expect(typeof SSKit.agents.create).toBe('function');
    expect(SSKit.agents.unsupported(null)).toMatch(/WebGL2/);
  });
});

describe('the shared per-frame logic (kit/agentPlan.js)', () => {
  const read = (p: unknown, fb: number) => (typeof p === 'number' ? p : fb);
  it('live: starts over on its first frame, follows the clock, and the Start over trigger restarts it once per rise', () => {
    const s = agGroupState();
    const g = { emit: { burst: 0 }, params: { stepsPerFrame: 2, preroll: 0, restart: 0 } };
    let restarts = 0;
    const frame = (time: number, restartV = 0) => agGroupSteps(s, { ...g, params: { ...g.params, restart: restartV } }, read, { live: true, time, cap: 8 }, () => { restarts++; s.step = 0; });
    expect(frame(5)).toMatchObject({ steps: 0, restarted: true });
    s.step += frame(5 + 1 / 60).steps;
    expect(s.step).toBe(2);
    frame(5 + 2 / 60, 1);
    expect(restarts).toBe(2);
    frame(5 + 3 / 60, 1); // still high: no second restart
    expect(restarts).toBe(2);
  });

  it('offline: exactly the steps to the time; an earlier time starts over', () => {
    const s = agGroupState();
    const g = { emit: { burst: 0 }, params: { stepsPerFrame: 2, preroll: 1 } };
    expect(agGroupSteps(s, g, read, { live: false, time: 0.5, cap: Infinity }, () => {}).steps).toBe(60 + 60);
    s.step = 120;
    let again = false;
    expect(agGroupSteps(s, g, read, { live: false, time: 0.25, cap: Infinity }, () => { again = true; s.step = 0; }).steps).toBe(90);
    expect(again).toBe(true);
  });

  it('Burst: everyone is born on the next step after it rises', () => {
    const s = agGroupState();
    const g = { emit: { mode: 'rate', rate: 0, burst: 1 }, params: {} };
    agGroupSteps(s, g, read, { live: false, time: 0, cap: Infinity }, () => {});
    expect(agStepWindow(s, g, 100, read)).toMatchObject({ start: 0, count: 100 });
    expect(agStepWindow(s, g, 100, read)).toMatchObject({ count: 0 });
  });

  it('a kick hears the stand-in Beat: a hit sends a ring, the level history moves on', () => {
    const st = agListenState();
    const l = { kind: 'kick', soundFrom: 'graph', params: { level: 0, beat: 120, x: 0.2, y: -0.1 } };
    const r = agHear(st, l, read, null, 0, true);
    expect(r.sound[0]).toBeGreaterThan(0.3);
    expect(r.shocks!.slice(0, 4)).toEqual([0.2, -0.1, 0, expect.any(Number)]);
    expect(r.levels![0]).toBeGreaterThan(0);
    // Sound from Mic with nothing heard falls back to Level and Beat.
    expect(agHear(agListenState(), { ...l, soundFrom: 'live' }, read, () => null, 0, true).sound[0]).toBeCloseTo(r.sound[0]);
  });

  it('Draw agents: The crowd keeps a million walkers as bright as a few', () => {
    const d = { style: 'glow', scaleBy: 'crowd', palette: 'ember', colorBy: 'age', fade: true, params: { size: 2, brightness: 0.5 } };
    const big = agDrawLook(d, 1 << 20, 1080, read, (_p, fb) => fb), small = agDrawLook(d, 1 << 16, 1080, read, (_p, fb) => fb);
    expect(big.bright).toBeLessThan(small.bright);
    expect(big).toMatchObject({ usePal: true, rainbow: false, colorBy: 4, lines: false });
  });
});

// ── Schedule parity: the app's runner and the page's host on recording stand-ins ────────────────

interface Op { op: string; step?: number; win?: number[]; time?: number; count?: number; heard?: number[] }
type Frame = { time: number; live: boolean; frameMs?: number };
const FIXED: Array<[string, string]> = [['deposit', AG_DEPOSIT_FRAG], ['trail', AG_TRAIL_FRAG], ['draw', AG_DRAW_FRAG], ['down', AG_DOWN_FRAG], ['blur', AG_BLUR_FRAG], ['compose', AG_COMPOSE_FRAG]];
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** The app's AgentRunner on a recording three.js renderer. */
async function appOps(spec: AgentsSpec, values: Record<string, number | number[]>, frames: Frame[]): Promise<Op[]> {
  const ops: Op[] = [];
  const uniforms: Record<string, THREE.IUniform> = { u_time: { value: 0 } };
  for (const [k, v] of Object.entries(values)) uniforms[k] = { value: v };
  const stepOf = new Map(spec.groups.map(g => [g.fragmentShader, g]));
  const trailOf = new Map(spec.trails.filter(t => t.stepShader).map(t => [t.stepShader!, t]));
  const renderer = {
    compileAsync: () => Promise.resolve(),
    getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0, flush: () => {} }),
    properties: { get: () => ({}) },
    autoClear: true,
    setRenderTarget: () => {}, clear: () => {}, getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 0, setClearColor: () => {},
    render: (scene: THREE.Scene) => {
      const obj = scene.children[0] as THREE.Mesh;
      const m = obj.material as THREE.ShaderMaterial;
      const g = stepOf.get(m.fragmentShader);
      if (g) {
        const l = g.listeners[0];
        ops.push({
          op: `step:${g.slug}`, step: uniforms[`u_agStep_${g.slug}`].value as number, time: round(uniforms.u_time.value as number),
          win: (uniforms[`u_agWin_${g.slug}`].value as THREE.Vector4).toArray().slice(0, 2),
          ...(l ? { heard: (uniforms[`u_agSnd_${l.slug}`].value as THREE.Vector4).toArray().map(round) } : {}),
        });
        return;
      }
      const t = trailOf.get(m.fragmentShader);
      if (t) { ops.push({ op: `trailStep:${t.slug}`, time: round(uniforms.u_time.value as number) }); return; }
      const fixed = FIXED.find(([, fs]) => m.fragmentShader === fs);
      const range = (obj.geometry as THREE.BufferGeometry).drawRange;
      ops.push({ op: fixed ? fixed[0] : 'unknown', ...(fixed && (fixed[0] === 'deposit' || fixed[0] === 'draw') ? { count: range.count } : {}) });
    },
  } as unknown as THREE.WebGLRenderer;
  const runner = new AgentRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
  runner.update(spec, 'void main() {}');
  await new Promise(r => setTimeout(r, 0));
  const targets = new AgentTargets(renderer, true);
  for (const f of frames) runner.run(targets, { width: 960, height: 540, time: f.time, live: f.live, frameMs: f.frameMs });
  return ops;
}

/** Uniform declarations of a GLSL source: [name, type] (comma lists and arrays too). */
function declared(src: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of src.matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+([^;]+);/g)) for (const part of m[2].split(',')) out.push([part.trim().replace(/\[\d+\]$/, ''), m[1]]);
  return out;
}

/** The page's host on a recording WebGL2 stand-in. */
function pageOps(spec: WebAgents, values: Record<string, number | number[]>, frames: Frame[]): Op[] {
  const ops: Op[] = [];
  const TYPES: Record<string, number> = { float: 1, int: 2, uint: 3, vec2: 4, vec3: 5, vec4: 6, sampler2D: 7, bool: 2 };
  type Prog = { kind: string; slug?: string; uniforms: Array<[string, string]>; vals: Record<string, unknown>; srcs: string[] };
  let cur: Prog | null = null, count = 1;
  const shaders = new Map<object, string>();
  const gl: Record<string, unknown> = new Proxy({
    FLOAT: 1, INT: 2, UNSIGNED_INT: 3, FLOAT_VEC2: 4, FLOAT_VEC3: 5, FLOAT_VEC4: 6, SAMPLER_2D: 7, BOOL: 2, ACTIVE_UNIFORMS: 'AU',
    getExtension: () => ({}),
    createShader: () => ({ id: count++ }), shaderSource: (s: object, src: string) => { shaders.set(s, src); },
    getShaderParameter: () => true, getProgramParameter: (p: Prog, k: string) => (k === 'AU' ? p.uniforms.length : true),
    createProgram: () => ({ kind: 'fixed', uniforms: [], vals: {}, srcs: [] }),
    attachShader: (p: Prog, s: object) => { const src = shaders.get(s)!; p.srcs.push(src); p.uniforms.push(...declared(src).filter(([n]) => !p.uniforms.some(([m]) => m === n))); const f = FIXED.find(([, fs]) => src.endsWith(fs)); if (f) p.kind = f[0]; },
    getActiveUniform: (p: Prog, i: number) => ({ name: p.uniforms[i][0], type: TYPES[p.uniforms[i][1]] ?? 0 }),
    getUniformLocation: (p: Prog, name: string) => ({ p, name }),
    useProgram: (p: Prog) => { cur = p; },
    uniform1f: (l: { p: Prog; name: string }, v: number) => { l.p.vals[l.name] = v; },
    uniform1i: (l: { p: Prog; name: string }, v: number) => { l.p.vals[l.name] = v; },
    uniform1ui: (l: { p: Prog; name: string }, v: number) => { l.p.vals[l.name] = v; },
    uniform2fv: (l: { p: Prog; name: string }, v: number[]) => { l.p.vals[l.name] = [...v]; },
    uniform3fv: (l: { p: Prog; name: string }, v: number[]) => { l.p.vals[l.name] = [...v]; },
    uniform4fv: (l: { p: Prog; name: string }, v: number[]) => { l.p.vals[l.name] = [...v]; },
    drawArrays: (_mode: unknown, _first: number, n: number) => { ops.push({ op: cur!.kind, count: n }); },
  } as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : /^[A-Z0-9_]+$/.test(k) ? k : () => ({})) });
  // ahUnsupported asks for a real WebGL2 context: this stand-in passes as one.
  (globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext = Object;
  const env = {
    link: (fs: string) => { const t = spec.trails.find(x => x.stepShader === fs)!; return { kind: 'trailStep', slug: t.slug, uniforms: declared(fs), vals: {}, srcs: [fs] }; },
    link3: (fs: string) => { const g = spec.groups.find(x => x.fragmentShader === fs)!; return { kind: 'step', slug: g.slug, uniforms: declared(fs).concat([['u_time', 'float']]), vals: {}, srcs: [fs] }; },
    use: (p: Prog) => { cur = p; },
    done: () => {},
    quad: () => {
      const p = cur!;
      if (p.kind === 'step') {
        const g = spec.groups.find(x => x.slug === p.slug)!;
        const l = g.listeners[0];
        ops.push({
          op: `step:${p.slug}`, step: p.vals[g.u.step] as number, time: round(p.vals.u_time as number), win: (p.vals[g.u.win] as number[]).slice(0, 2),
          ...(l ? { heard: (p.vals[l.u.sound] as number[]).map(round) } : {}),
        });
      } else if (p.kind === 'trailStep') ops.push({ op: `trailStep:${p.slug}`, time: round(p.vals.u_time as number) });
      else ops.push({ op: p.kind });
    },
    textures: new Map(), vec2s: new Map(), read: (name: string) => values[name], sound: null, halfFloat: true,
  };
  const host = ahCreate(gl, spec, env);
  expect(host.unsupported).toBeNull();
  for (const f of frames) host.run({ width: 960, height: 540, time: f.time, live: f.live, frameMs: f.frameMs });
  return ops;
}

describe('the same schedule in the app and on a page (kit/agentPlan.js)', () => {
  // Live at 60 Hz with a stall and a slow stretch (the governor), then an offline render from the start.
  const live: Frame[] = [];
  for (let k = 0; k < 40; k++) live.push({ time: k / 60, live: true, frameMs: k > 20 && k < 30 ? 40 : 16.7 });
  live.push({ time: 1, live: true, frameMs: 16.7 });
  const offline: Frame[] = [0.1, 0.2, 0.5].map(time => ({ time, live: false }));

  for (const [name, nodes] of [['Slime mold', slimeMoldNodes(0, 0)], ['Sound burst (listener, Burst, streaks + glow)', soundBurstNodes(0, 0)], ['Particles (lights, Keep full, pre-roll)', particlesNodes(0, 0)], ['Ants (state C/D, a Trail step program)', antsNodes(0, 0)]] as const) {
    it(name, async () => {
      const r = compile(nodes);
      expect(r.errors).toBeUndefined();
      const values = r.paramUniforms;
      const app = await appOps(r.agents!, values, live), page = pageOps(webAgents(r.agents!), values, live);
      expect(app.length).toBeGreaterThan(10);
      expect(page).toEqual(app);
      const appOff = await appOps(r.agents!, values, offline), pageOff = pageOps(webAgents(r.agents!), values, offline);
      expect(pageOff).toEqual(appOff);
    });
  }
});
