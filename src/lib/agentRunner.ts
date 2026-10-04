/**
 * agentRunner.ts — runs the Agents family (docs/agents-plan.md §3.4, §7, §8)
 * on ShaderCanvas's renderer. ShaderCanvas makes one only when the compile has
 * `agents`; a graph without an Agents-family node never reaches this file.
 *
 * One step, in Jones' order: every group's update shader (it reads the trails
 * as the step before left them) → every Deposit (its group's walkers as
 * additive points into its Trail) → every Trail's spread and fade (ping-pong).
 * A frame runs as many steps as the clock asks for, at most a cap the GPU
 * governor lowers under load (fewer steps, never fewer agents; the simulation
 * falls behind the clock rather than skipping). Then Draw agents draws.
 *
 * The update shaders share the preview's uniforms object by reference, as
 * Pass programs do, so sliders, Play mappings, takes, Time, the mouse, video
 * and Data reach them with no extra code; the runner adds its own entries
 * (state samplers, step, birth window, trail and drawing textures) to that
 * table. u_time is the step's own time while a step runs (determinism: the
 * simulation depends only on the step number and the seed).
 *
 * State lives in an AgentTargets set: the live preview has one, an offline
 * render (renderAtTime) another, so a render never disturbs the preview's
 * simulation (the PassTargets / OfflineHistory rule).
 */
import * as THREE from 'three';
import type { AgentDrawProgram, AgentGroupProgram, AgentParam, AgentsSpec, AgentTrailProgram } from '../compiler/types';
import { agentDrawUniform, agentStateUniform, agentStepUniform, agentWindowUniform, trailUniform } from '../nodes/definitions/agents';
import {
  AG_MAX_STEPS, AG_OFFLINE_CHUNK, agGovern, agGovernorState, agKeep, agLiveState, agLiveSteps, agRate, agStepTime, agStepsPerFrame,
  agTargetStep, agTrailSize, agWindow, type AgLiveState,
} from '../play/kit/agentPlan.js';
import {
  AG_BLUR_FRAG, AG_COMPOSE_FRAG, AG_DEPOSIT_FRAG, AG_DEPOSIT_VERT, AG_DOWN_FRAG, AG_DRAW_FRAG, AG_DRAW_VERT, AG_FULL_VERT, AG_TRAIL_FRAG,
} from '../play/kit/agentShaders.js';
import { CanvasProbeRegistry } from './canvasProbeRegistry';

type Uniforms = Record<string, THREE.IUniform>;

/** Trail cards register a canvas here (by node id); the live runner draws their thumbnails into it. */
export const trailThumbRegistry = new CanvasProbeRegistry();

/** What the group cards show: count, steps a frame and how fast the simulation keeps up. */
export interface AgentStats { count: number; stepsPerFrame: number; rate: number; step: number }
const stats = new Map<string, AgentStats>();
/** The live runner's latest numbers for a group (by node id), or undefined. */
export function agentStatsFor(nodeId: string): AgentStats | undefined { return stats.get(nodeId); }

/** Start-over requests from the cards (↺ on a group): the live runner starts those groups over next frame. */
const restartRequests = new Set<string>();
let restartAll = false;
export function restartAgents(nodeId?: string): void {
  if (nodeId) restartRequests.add(nodeId); else restartAll = true;
}

interface GroupState { key: string; side: number; rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]; cur: 0 | 1; step: number; born: number; live: AgLiveState; history: Array<[number, number]>; lastTarget: number }
interface TrailState { key: string; w: number; h: number; rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]; cur: 0 | 1 }
interface DrawState { key: string; w: number; h: number; acc: THREE.WebGLRenderTarget; glow: THREE.WebGLRenderTarget[]; out: THREE.WebGLRenderTarget }

const STATE_OPTS = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, count: 2 } as const;

/** One set of simulation state: the live preview's, or an offline render's. */
export class AgentTargets {
  readonly groups = new Map<string, GroupState>();
  readonly trails = new Map<string, TrailState>();
  readonly draws = new Map<string, DrawState>();
  private renderer: THREE.WebGLRenderer;
  private halfFloat: boolean;

  constructor(renderer: THREE.WebGLRenderer, halfFloat: boolean) { this.renderer = renderer; this.halfFloat = halfFloat; }

  private clear(rt: THREE.WebGLRenderTarget): void {
    const r = this.renderer;
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(rt);
    r.clear(true, false, false);
    r.setClearColor(prevColor, prevAlpha);
  }

  /** A group's state (made, all dead, when its count changes). */
  group(g: AgentGroupProgram): GroupState {
    const key = `${g.side}`;
    let s = this.groups.get(g.slug);
    if (s && s.key === key) return s;
    if (s) { s.rt[0].dispose(); s.rt[1].dispose(); }
    const make = () => new THREE.WebGLRenderTarget(g.side, g.side, { ...STATE_OPTS });
    s = { key, side: g.side, rt: [make(), make()], cur: 0, step: 0, born: 0, live: agLiveState(), history: [], lastTarget: 0 };
    this.clear(s.rt[0]); this.clear(s.rt[1]);
    this.renderer.setRenderTarget(null);
    this.groups.set(g.slug, s);
    return s;
  }

  /** Every walker dead and the step count back to 0: the next step (step 0) gives birth again. */
  restartGroup(s: GroupState): void {
    this.clear(s.rt[0]); this.clear(s.rt[1]);
    this.renderer.setRenderTarget(null);
    s.step = 0; s.born = 0; s.history.length = 0; s.lastTarget = 0;
  }

  /** A Trail's textures at the size it wants for a picture of w × h (made, empty, when that changes). */
  trail(t: AgentTrailProgram, w: number, h: number): TrailState {
    const [tw, th] = agTrailSize(w, h, t);
    const key = `${tw}x${th}:${t.edges}`;
    let s = this.trails.get(t.slug);
    if (s && s.key === key) return s;
    if (s) { s.rt[0].dispose(); s.rt[1].dispose(); }
    const wrap = t.edges === 'wrap' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    const make = () => new THREE.WebGLRenderTarget(tw, th, {
      type: this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: wrap, wrapT: wrap, depthBuffer: false, stencilBuffer: false,
    });
    s = { key, w: tw, h: th, rt: [make(), make()], cur: 0 };
    this.clear(s.rt[0]); this.clear(s.rt[1]);
    this.renderer.setRenderTarget(null);
    this.trails.set(t.slug, s);
    return s;
  }

  clearTrail(s: TrailState): void { this.clear(s.rt[0]); this.clear(s.rt[1]); this.renderer.setRenderTarget(null); }

  /** A Draw agents node's targets for a picture of w × h. */
  draw(d: AgentDrawProgram, w: number, h: number): DrawState {
    const key = `${w}x${h}:${d.style}`;
    let s = this.draws.get(d.slug);
    if (s && s.key === key) return s;
    if (s) this.disposeDraw(s);
    const type = this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const rt = (a: number, b: number) => new THREE.WebGLRenderTarget(Math.max(1, a), Math.max(1, b), { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    const acc = rt(w, h);
    const glow: THREE.WebGLRenderTarget[] = [];
    let out = acc;
    if (d.style === 'glow') {
      // GP's glow: ¼ and 1/16 size, each blurred (scratch + result), then composed over the points.
      const w1 = Math.ceil(w / 4), h1 = Math.ceil(h / 4), w2 = Math.ceil(w1 / 4), h2 = Math.ceil(h1 / 4);
      glow.push(rt(w1, h1), rt(w1, h1), rt(w2, h2), rt(w2, h2));
      out = rt(w, h);
    }
    s = { key, w, h, acc, glow, out };
    this.draws.set(d.slug, s);
    return s;
  }

  private disposeDraw(s: DrawState): void { s.acc.dispose(); for (const g of s.glow) g.dispose(); if (s.out !== s.acc) s.out.dispose(); }

  /** Start everything over: every group dead at step 0, every trail empty. */
  resetAll(): void {
    for (const g of this.groups.values()) { this.restartGroup(g); g.live = agLiveState(); }
    for (const t of this.trails.values()) this.clearTrail(t);
  }

  /** Drop what the spec no longer has. */
  prune(spec: AgentsSpec): void {
    const gs = new Set(spec.groups.map(g => g.slug)), ts = new Set(spec.trails.map(t => t.slug)), ds = new Set(spec.draws.map(d => d.slug));
    for (const [k, s] of this.groups) if (!gs.has(k)) { s.rt[0].dispose(); s.rt[1].dispose(); this.groups.delete(k); }
    for (const [k, s] of this.trails) if (!ts.has(k)) { s.rt[0].dispose(); s.rt[1].dispose(); this.trails.delete(k); }
    for (const [k, s] of this.draws) if (!ds.has(k)) { this.disposeDraw(s); this.draws.delete(k); }
  }

  dispose(): void {
    for (const s of this.groups.values()) { s.rt[0].dispose(); s.rt[1].dispose(); }
    for (const s of this.trails.values()) { s.rt[0].dispose(); s.rt[1].dispose(); }
    for (const s of this.draws.values()) this.disposeDraw(s);
    this.groups.clear(); this.trails.clear(); this.draws.clear();
  }
}

export interface AgentRunnerHost {
  renderer: THREE.WebGLRenderer;
  geometry: THREE.BufferGeometry;
  camera: THREE.Camera;
  /** The preview's uniforms object (it changes only on a GPU rebuild). */
  uniforms: () => Uniforms;
  /** An update shader finished compiling: draw a frame. */
  onReady: () => void;
  /** An update shader didn't link: report the driver's log against its source. */
  onLinkFailed: (fragmentShader: string) => void;
}

interface StepEntry { spec: AgentGroupProgram; material: THREE.ShaderMaterial; ready: boolean; failed: boolean; dropped?: boolean }

type Timer = { begin(name: string): boolean; end(): void };

const raw = (vertexShader: string, fragmentShader: string, uniforms: Uniforms, additive: boolean) => new THREE.RawShaderMaterial({
  vertexShader, fragmentShader, uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
  ...(additive ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor } : {}),
});

export class AgentRunner {
  private host: AgentRunnerHost;
  private spec: AgentsSpec = { groups: [], deposits: [], trails: [], draws: [] };
  private steps: StepEntry[] = [];
  private vertexShader = '';
  private boundTo: Uniforms | null = null;
  private gov = agGovernorState();
  private frames = 0;
  // Scenes: a full-picture quad (update shaders, trail step, glow) and a point cloud (deposit, draw).
  private quadScene = new THREE.Scene();
  private quad: THREE.Mesh;
  private pointScene = new THREE.Scene();
  private points: THREE.Points;
  private pointGeometry = new THREE.BufferGeometry();
  private compileScene = new THREE.Scene();
  private compileMesh: THREE.Mesh;
  private placeholder = new THREE.MeshBasicMaterial();
  private depositMat = raw(AG_DEPOSIT_VERT, AG_DEPOSIT_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_side: { value: 1 }, u_species: { value: 1 }, u_aspect: { value: 1 }, u_amount: { value: 1 }, u_size: { value: 1 },
  }, true);
  private trailMat = raw(AG_FULL_VERT, AG_TRAIL_FRAG, { u_src: { value: null }, u_diffuse: { value: 1 }, u_keep: { value: 0.9 }, u_wrap: { value: 1 } }, false);
  private drawMat = raw(AG_DRAW_VERT, AG_DRAW_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_side: { value: 1 }, u_species: { value: 1 }, u_colorBy: { value: 0 },
    u_aspect: { value: 1 }, u_size: { value: 1.5 }, u_bright: { value: 0.5 }, u_speedRef: { value: 0.5 },
    u_colA: { value: new THREE.Vector3(1, 1, 1) }, u_colB: { value: new THREE.Vector3(1, 1, 1) },
    u_prim: { value: 0 }, u_depth: { value: 0 }, u_field: { value: null }, u_viewSize: { value: new THREE.Vector2(1, 1) },
  }, true);
  private downMat = raw(AG_FULL_VERT, AG_DOWN_FRAG, { u_src: { value: null }, u_texel: { value: new THREE.Vector2() } }, false);
  private blurMat = raw(AG_FULL_VERT, AG_BLUR_FRAG, { u_src: { value: null }, u_dir: { value: new THREE.Vector2() }, u_size: { value: new THREE.Vector2() } }, false);
  private composeMat = raw(AG_FULL_VERT, AG_COMPOSE_FRAG, {
    u_acc: { value: null }, u_g1: { value: null }, u_g2: { value: null }, u_size: { value: new THREE.Vector2() },
    u_aspect: { value: 1 }, u_glow: { value: 1 }, u_halo: { value: 0 }, u_lights: { value: 0 }, u_ink: { value: 0 },
    u_light: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    u_lightCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  }, false);
  // Thumbnails (Trail cards): a small 8-bit copy read back into the card's canvas.
  private thumbRt: THREE.WebGLRenderTarget | null = null;
  private thumbBuf: Uint8Array | null = null;
  private thumbMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: 'precision highp float;\nuniform sampler2D t;\nuniform float g;\nvarying vec2 vUv;\nvoid main() { float a = texture2D(t, vUv).r; gl_FragColor = vec4(vec3(1.0 - exp(-max(a, 0.0) * g)), 1.0); }',
    uniforms: { t: { value: null }, g: { value: 0.15 } }, depthTest: false, depthWrite: false,
  });
  private thumbQuad: THREE.Mesh;
  private thumbScene = new THREE.Scene();

  constructor(host: AgentRunnerHost) {
    this.host = host;
    this.quad = new THREE.Mesh(host.geometry, this.trailMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.points = new THREE.Points(this.pointGeometry, this.depositMat);
    this.points.frustumCulled = false;
    this.pointScene.add(this.points);
    this.compileMesh = new THREE.Mesh(host.geometry, this.placeholder);
    this.compileScene.add(this.compileMesh);
    this.thumbQuad = new THREE.Mesh(host.geometry, this.thumbMat);
    this.thumbScene.add(this.thumbQuad);
  }

  get current(): AgentsSpec { return this.spec; }
  /** Something runs while the clock does: the preview keeps drawing. */
  get active(): boolean { return this.spec.groups.some(g => g.live); }

  /** The uniforms the runner adds to the shared table. */
  private ensureUniforms(): void {
    const u = this.host.uniforms();
    for (const g of this.spec.groups) {
      for (const n of [agentStateUniform(g.slug, 'A'), agentStateUniform(g.slug, 'B')]) if (!u[n]) u[n] = { value: null };
      if (!u[agentStepUniform(g.slug)]) u[agentStepUniform(g.slug)] = { value: 0 };
      if (!(u[agentWindowUniform(g.slug)]?.value instanceof THREE.Vector4)) u[agentWindowUniform(g.slug)] = { value: new THREE.Vector4(0, 0, 0, 0) };
    }
    for (const t of this.spec.trails) if (!u[trailUniform(t.slug)]) u[trailUniform(t.slug)] = { value: null };
    for (const d of this.spec.draws) if (!u[agentDrawUniform(d.slug)]) u[agentDrawUniform(d.slug)] = { value: null };
    if (this.boundTo !== u) {
      for (const e of this.steps) e.material.uniforms = u;
      this.boundTo = u;
    }
  }

  /** Take a new compile's agents. Update shaders whose source is unchanged are kept (a slider never gets here). */
  update(spec: AgentsSpec, vertexShader: string): void {
    const old = new Map(this.steps.map(e => [e.spec.slug, e]));
    const vsChanged = vertexShader !== this.vertexShader;
    this.vertexShader = vertexShader;
    this.spec = spec;
    const u = this.host.uniforms();
    this.steps = spec.groups.map(g => {
      const prev = old.get(g.slug);
      if (prev && !vsChanged && prev.material.fragmentShader === g.fragmentShader) {
        old.delete(g.slug);
        prev.spec = g;
        return prev;
      }
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: g.fragmentShader, uniforms: u, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
      return { spec: g, material, ready: false, failed: false };
    });
    for (const e of old.values()) this.drop(e);
    this.boundTo = null;
    this.ensureUniforms();
    for (const e of this.steps) if (!e.ready && !e.failed) this.compile(e);
  }

  private drop(e: StepEntry): void {
    e.dropped = true;
    if (e.ready || e.failed) e.material.dispose();
  }

  private compile(e: StepEntry): void {
    const { renderer, camera } = this.host;
    this.compileMesh.material = e.material;
    const settle = () => {
      e.ready = true;
      if (e.dropped) { e.material.dispose(); return; }
      const gl = renderer.getContext();
      const prog = (renderer.properties.get(e.material) as { currentProgram?: { program?: WebGLProgram } }).currentProgram?.program;
      if (prog && gl.getProgramParameter(prog, gl.LINK_STATUS) === false) { e.failed = true; this.host.onLinkFailed(e.spec.fragmentShader); }
      this.host.onReady();
    };
    renderer.compileAsync(this.compileScene, camera).then(settle, () => { e.failed = true; if (e.dropped) e.material.dispose(); });
    this.compileMesh.material = this.placeholder;
  }

  /** Compile every update shader again (after the GPU context was rebuilt). */
  recompileAll(): void {
    const spec = this.spec, vs = this.vertexShader;
    for (const e of this.steps) this.drop(e);
    this.steps = [];
    this.vertexShader = '';
    this.update(spec, vs);
  }

  private read(p: AgentParam | number[] | undefined, fallback: number): number {
    if (typeof p === 'number') return isFinite(p) ? p : fallback;
    if (typeof p === 'string') { const v = this.host.uniforms()[p]?.value; return typeof v === 'number' && isFinite(v) ? v : fallback; }
    return fallback;
  }

  private readColour(p: AgentParam | number[] | undefined, fallback: number[]): number[] {
    if (Array.isArray(p)) return p;
    if (typeof p === 'string') {
      const v = this.host.uniforms()[p]?.value as unknown;
      if (Array.isArray(v) && v.length >= 3) return v as number[];
      if (v instanceof THREE.Vector3) return [v.x, v.y, v.z];
      if (v instanceof THREE.Color) return [v.r, v.g, v.b];
    }
    return fallback;
  }

  /**
   * Step the simulations to `time` and draw the agents, for a picture of
   * w × h. Live: as many steps as the clock asks for, at most the governor's
   * cap; `frameMs` is the last frame's length (the load signal). Offline:
   * exactly the steps up to `time` (a still starts from step 0).
   */
  run(targets: AgentTargets, o: { width: number; height: number; time: number; live: boolean; frameMs?: number; timer?: Timer }): void {
    this.ensureUniforms();
    targets.prune(this.spec);
    const { renderer } = this.host;
    const u = this.host.uniforms();
    const w = Math.max(1, o.width), h = Math.max(1, o.height);
    const aspect = w / h;
    const ready = this.steps.filter(e => e.spec.live && e.ready && !e.failed);
    const cap = o.live ? agGovern(this.gov, o.frameMs ?? 0, 1000 / 60) : Infinity;

    // How many steps each group runs this frame.
    const plan: Array<{ e: StepEntry; s: GroupState; steps: number; spf: number; preroll: number }> = [];
    const restarted = new Set<string>();
    for (const e of ready) {
      const g = e.spec;
      const s = targets.group(g);
      const spf = agStepsPerFrame(this.read(g.params.stepsPerFrame, 2));
      const preroll = this.read(g.params.preroll, 0);
      let steps: number;
      if (o.live) {
        if (restartAll || restartRequests.has(g.nodeId)) { s.live = agLiveState(); }
        s.live.step = s.step;
        const r = agLiveSteps(s.live, o.time, spf, preroll, cap);
        if (r.restart) { targets.restartGroup(s); restarted.add(g.slug); }
        steps = r.steps;
        const wanted = Math.max(0, r.target - s.lastTarget);
        s.lastTarget = r.target;
        stats.set(g.nodeId, { count: g.side * g.side, stepsPerFrame: spf, rate: agRate(s.history, r.restart ? wanted : steps, wanted || steps), step: s.step + steps });
      } else {
        const target = agTargetStep(o.time, spf, preroll);
        if (target < s.step) { targets.restartGroup(s); restarted.add(g.slug); }
        steps = Math.max(0, target - s.step);
      }
      plan.push({ e, s, steps, spf, preroll });
    }
    if (o.live) { restartAll = false; restartRequests.clear(); }

    // Trails: their textures at this size; a trail fed by a group that started over starts empty too.
    const trailState = new Map<string, TrailState>();
    for (const t of this.spec.trails) {
      if (!t.live) continue;
      const ts = targets.trail(t, w, h);
      trailState.set(t.slug, ts);
      if (this.spec.deposits.some(d => d.trail === t.slug && restarted.has(d.group))) targets.clearTrail(ts);
    }
    const bindTrails = () => { for (const [slug, ts] of trailState) u[trailUniform(slug)].value = ts.rt[ts.cur].texture; };

    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    const timeUniform = u.u_time;
    const keepTime = timeUniform?.value;
    try {
      const most = plan.reduce((m, p) => Math.max(m, p.steps), 0);
      for (let k = 0; k < most; k++) {
        const stepping = plan.filter(p => p.steps > k);
        // 1. The rule, for every walker of every group stepping now (reading the trails as they are).
        bindTrails();
        for (const p of stepping) {
          const g = p.e.spec;
          const s = p.s;
          const n = g.side * g.side;
          const win = agWindow(g.emit.mode, s.step, n, this.read(g.emit.rate, 0), s.born);
          s.born = win.born;
          (u[agentWindowUniform(g.slug)].value as THREE.Vector4).set(win.start, win.count, 0, 0);
          u[agentStepUniform(g.slug)].value = s.step >>> 0;
          u[agentStateUniform(g.slug, 'A')].value = s.rt[s.cur].textures[0];
          u[agentStateUniform(g.slug, 'B')].value = s.rt[s.cur].textures[1];
          if (timeUniform) timeUniform.value = agStepTime(s.step, p.spf, p.preroll);
          p.e.material.uniformsNeedUpdate = true;
          this.quad.material = p.e.material;
          const timed = k === 0 && (o.timer?.begin(`agents:${g.label} step`) ?? false);
          renderer.setRenderTarget(s.rt[1 - s.cur]);
          renderer.render(this.quadScene, this.host.camera);
          if (timed) o.timer!.end();
          s.cur = (1 - s.cur) as 0 | 1;
          s.step++;
          u[agentStateUniform(g.slug, 'A')].value = s.rt[s.cur].textures[0];
          u[agentStateUniform(g.slug, 'B')].value = s.rt[s.cur].textures[1];
        }
        // 2. Deposits: the walkers as points added into their trails.
        const steppingSlugs = new Set(stepping.map(p => p.e.spec.slug));
        const fed = new Set<string>();
        for (const d of this.spec.deposits) {
          if (!steppingSlugs.has(d.group)) continue;
          const ts = trailState.get(d.trail);
          const gs = targets.groups.get(d.group);
          const g = this.spec.groups.find(x => x.slug === d.group);
          if (!ts || !gs || !g) continue;
          fed.add(d.trail);
          const du = this.depositMat.uniforms;
          du.u_a.value = gs.rt[gs.cur].textures[0];
          du.u_b.value = gs.rt[gs.cur].textures[1];
          du.u_side.value = g.side; du.u_species.value = g.species; du.u_aspect.value = aspect;
          du.u_amount.value = this.read(d.params.amount, 1);
          du.u_size.value = Math.max(1, Math.min(4, Math.round(this.read(d.params.size, 1))));
          this.depositMat.uniformsNeedUpdate = true;
          this.points.material = this.depositMat;
          this.pointGeometry.setDrawRange(0, g.side * g.side);
          const timed = k === 0 && (o.timer?.begin(`agents:${g.label} deposit`) ?? false);
          renderer.setRenderTarget(ts.rt[ts.cur]);
          renderer.render(this.pointScene, this.host.camera);
          if (timed) o.timer!.end();
        }
        // 3. Every trail fed this step spreads and fades.
        for (const t of this.spec.trails) {
          if (!fed.has(t.slug)) continue;
          const ts = trailState.get(t.slug)!;
          const tu = this.trailMat.uniforms;
          tu.u_src.value = ts.rt[ts.cur].texture;
          tu.u_diffuse.value = this.read(t.params.diffuse, 1);
          tu.u_keep.value = agKeep(this.read(t.params.halfLife, 0.1));
          tu.u_wrap.value = t.edges === 'wrap' ? 1 : 0;
          this.trailMat.uniformsNeedUpdate = true;
          this.quad.material = this.trailMat;
          const timed = k === 0 && (o.timer?.begin(`agents:${t.label} trail`) ?? false);
          renderer.setRenderTarget(ts.rt[1 - ts.cur]);
          renderer.render(this.quadScene, this.host.camera);
          if (timed) o.timer!.end();
          ts.cur = (1 - ts.cur) as 0 | 1;
        }
        // An offline run can be thousands of steps: hand the GPU each chunk as it goes.
        if (!o.live && k > 0 && k % AG_OFFLINE_CHUNK === 0) renderer.getContext().flush();
      }
      for (const p of plan) {
        u[agentStateUniform(p.e.spec.slug, 'A')].value = p.s.rt[p.s.cur].textures[0];
        u[agentStateUniform(p.e.spec.slug, 'B')].value = p.s.rt[p.s.cur].textures[1];
      }
      bindTrails();
      // 4. Draw agents.
      for (const d of this.spec.draws) {
        if (!d.live) continue;
        const gs = targets.groups.get(d.group);
        const g = this.spec.groups.find(x => x.slug === d.group);
        if (!gs || !g) { u[agentDrawUniform(d.slug)].value = null; continue; }
        const timed = o.timer?.begin(`agents:${g.label} draw`) ?? false;
        u[agentDrawUniform(d.slug)].value = this.draw(targets.draw(d, w, h), d, g, gs, aspect).texture;
        if (timed) o.timer!.end();
      }
    } finally {
      if (timeUniform) timeUniform.value = keepTime;
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(null);
    }
    this.frames++;
  }

  private pass(mat: THREE.RawShaderMaterial, into: THREE.WebGLRenderTarget): void {
    const { renderer } = this.host;
    mat.uniformsNeedUpdate = true;
    this.quad.material = mat;
    renderer.setRenderTarget(into);
    renderer.render(this.quadScene, this.host.camera);
  }

  private draw(s: DrawState, d: AgentDrawProgram, g: AgentGroupProgram, gs: GroupState, aspect: number): THREE.WebGLRenderTarget {
    const { renderer } = this.host;
    const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(s.acc);
    renderer.clear(true, false, false);
    renderer.setClearColor(prevColor, prevAlpha);
    const du = this.drawMat.uniforms;
    du.u_a.value = gs.rt[gs.cur].textures[0];
    du.u_b.value = gs.rt[gs.cur].textures[1];
    du.u_side.value = g.side; du.u_species.value = g.species; du.u_aspect.value = aspect;
    du.u_colorBy.value = d.colorBy === 'species' ? 1 : d.colorBy === 'speed' ? 2 : d.colorBy === 'heading' ? 3 : 0;
    du.u_size.value = this.read(d.params.size as AgentParam, 1.5);
    du.u_bright.value = this.read(d.params.brightness as AgentParam, 0.5);
    (du.u_colA.value as THREE.Vector3).fromArray(this.readColour(d.params.colorA, [1, 0.75, 0.35]));
    (du.u_colB.value as THREE.Vector3).fromArray(this.readColour(d.params.colorB, [0.25, 0.55, 1]));
    (du.u_viewSize.value as THREE.Vector2).set(s.w, s.h);
    this.drawMat.uniformsNeedUpdate = true;
    this.points.material = this.drawMat;
    this.pointGeometry.setDrawRange(0, g.side * g.side);
    renderer.setRenderTarget(s.acc);
    renderer.render(this.pointScene, this.host.camera);
    if (d.style !== 'glow') return s.acc;
    // The Particles node's glow, unchanged: ¼ and 1/16 copies, blurred, composed over the points.
    const [d1, b1, d2, b2] = s.glow;
    const down = (src: THREE.WebGLRenderTarget, into: THREE.WebGLRenderTarget) => {
      this.downMat.uniforms.u_src.value = src.texture;
      (this.downMat.uniforms.u_texel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.pass(this.downMat, into);
    };
    const blur = (a: THREE.WebGLRenderTarget, scratch: THREE.WebGLRenderTarget) => {
      const bu = this.blurMat.uniforms;
      (bu.u_size.value as THREE.Vector2).set(a.width, a.height);
      bu.u_src.value = a.texture; (bu.u_dir.value as THREE.Vector2).set(1, 0); this.pass(this.blurMat, scratch);
      bu.u_src.value = scratch.texture; (bu.u_dir.value as THREE.Vector2).set(0, 1); this.pass(this.blurMat, a);
    };
    down(s.acc, d1); blur(d1, b1);
    down(d1, d2); blur(d2, b2);
    const cu = this.composeMat.uniforms;
    cu.u_acc.value = s.acc.texture; cu.u_g1.value = d1.texture; cu.u_g2.value = d2.texture;
    (cu.u_size.value as THREE.Vector2).set(s.w, s.h);
    cu.u_aspect.value = aspect;
    cu.u_glow.value = this.read(d.params.glow as AgentParam, 1);
    this.pass(this.composeMat, s.out);
    return s.out;
  }

  /** Thumbnails for the Trail cards that are showing (the live runner, every few frames). */
  drawThumbnails(targets: AgentTargets): void {
    const { renderer, camera } = this.host;
    for (const t of this.spec.trails) {
      const canvas = trailThumbRegistry.get(t.nodeId);
      if (!canvas) continue;
      const ts = targets.trails.get(t.slug);
      const W = 128, H = Math.max(8, Math.round(128 * (ts ? ts.h / ts.w : 9 / 16)));
      if (!this.thumbRt || this.thumbRt.height !== H) {
        this.thumbRt?.dispose();
        this.thumbRt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
        this.thumbBuf = new Uint8Array(W * H * 4);
      }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      if (!ts) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); continue; }
      this.thumbMat.uniforms.t.value = ts.rt[ts.cur].texture;
      this.thumbMat.uniforms.g.value = this.read(t.params.gain, 0.15);
      this.thumbMat.uniformsNeedUpdate = true;
      renderer.setRenderTarget(this.thumbRt);
      renderer.render(this.thumbScene, camera);
      renderer.readRenderTargetPixels(this.thumbRt, 0, 0, W, H, this.thumbBuf!);
      renderer.setRenderTarget(null);
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(this.thumbBuf!.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      ctx.putImageData(img, 0, 0);
      canvas.dataset.size = `${ts.w}×${ts.h}`;
    }
  }

  dispose(): void {
    for (const e of this.steps) this.drop(e);
    const u = this.boundTo;
    if (u) {
      for (const g of this.spec.groups) for (const n of [agentStateUniform(g.slug, 'A'), agentStateUniform(g.slug, 'B')]) if (u[n]) u[n].value = null;
      for (const t of this.spec.trails) if (u[trailUniform(t.slug)]) u[trailUniform(t.slug)].value = null;
      for (const d of this.spec.draws) if (u[agentDrawUniform(d.slug)]) u[agentDrawUniform(d.slug)].value = null;
    }
    this.steps = [];
    for (const m of [this.depositMat, this.trailMat, this.drawMat, this.downMat, this.blurMat, this.composeMat, this.thumbMat, this.placeholder]) m.dispose();
    this.pointGeometry.dispose();
    this.thumbRt?.dispose();
    for (const k of stats.keys()) if (this.spec.groups.some(g => g.nodeId === k)) stats.delete(k);
  }
}

/** Most steps any group may run in one live frame (for tests and the docs). */
export const AGENT_MAX_LIVE_STEPS = AG_MAX_STEPS;
