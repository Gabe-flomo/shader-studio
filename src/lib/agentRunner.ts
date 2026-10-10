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
 *
 * Listening nodes inside a group (Sound kick, Chladni) hear their sound once a
 * step, before the rule runs, with the Particles engine's own code
 * (gpSoundStep, gpLevelsPush, the plate's gpPlateListen / gpPlateTargets /
 * gpPlateSmooth): their state (level, the level history, the shock rings in
 * flight, the plate's figure) belongs to the group's state, so it starts over
 * with it and a render of its own hears the same stand-in Beat at the same steps.
 */
import * as THREE from 'three';
import type { AgentDrawProgram, AgentGroupProgram, AgentParam, AgentsSpec, AgentTrailProgram } from '../compiler/types';
import { agentDrawUniform, agentNbUniforms, agentStateUniform, agentStepUniform, agentWindowUniform, trailStepUniforms, trailUniform, trailVolUniform } from '../nodes/definitions/agents';
import { AG_BESSEL_UNIFORM, listenUniforms, sceneGridUniforms } from '../nodes/definitions/agentForces';
import {
  AG_MAX_STEPS, AG_OFFLINE_CHUNK, AG_PROBE_POINTS, AG_STEP_HZ, agCamera3, agDrawLook, agGovern, agGovernorState, agGroupState, agGroupSteps, agHear, agKeep, agLights, agLiveState,
  agListenState, agNbLayout, agNbPasses, agNbTile, agProject3, agReadDecode, agReadPlan, agRestartGroup, agStepTime, agStepWindow, agTrailSize, agVolLayout, agVolUniform, type AgGroupState, type AgListenState, type AgVolLayout,
  AG_NB_SLOTS,
} from '../play/kit/agentPlan.js';
import { MEM_LENS_FRAG, MEM_LENS_VERT, MEM_RANGE_FRAG, MEM_RANGE_N, decodeMemRanges, parseMemSlot } from './agentMemoryGpu';
import { GP_BESSEL_N, GP_BESSEL_W, GP_LEVELS, GP_VOL, GP_VOL_TILES, gpBesselTable, gpReadback, type GpReadback, type GpSoundInput } from '../play/kit/gpuParticles.js';
import {
  AG_BLUR_FRAG, AG_COMPOSE_FRAG, AG_DEPOSIT3_VERT, AG_DEPOSIT_FRAG, AG_DEPOSIT_VERT, AG_DOWN_FRAG, AG_DRAW3_VERT, AG_DRAW_FRAG, AG_DRAW_VERT, AG_FULL_VERT, AG_PROJ3_FRAG, AG_READ_FRAG, AG_SUM_FRAG,
  AG_NB_BIN_FRAG, AG_NB_BIN_VERT, AG_SPOT_FRAG, AG_SPOT_VERT, AG_THUMB_DOTS_FRAG, AG_THUMB_DOTS_VERT, AG_TRAIL3_FRAG, AG_TRAIL_FRAG,
} from '../play/kit/agentShaders.js';
import { CanvasProbeRegistry } from './canvasProbeRegistry';
import { agentReadingsWanted, publishAgentReadings, setAgentGroups } from './agentReadings';
import { hoodRequests, pokeHood } from './agentHood';
import type { AgentHoodGpu, AgentStateView } from './agentHoodGpu';

type Uniforms = Record<string, THREE.IUniform>;

/** Trail cards register a canvas here (by node id); the live runner draws their thumbnails into it. */
export const trailThumbRegistry = new CanvasProbeRegistry();
/** Agents group cards register a canvas here (by node id): the live runner draws the walkers into it as dots (P4). */
export const agentThumbRegistry = new CanvasProbeRegistry();
/** Most walkers a group card's thumbnail draws (every k-th one beyond it): the dots stay cheap at 4M. */
const THUMB_DOTS = 1 << 16;
/**
 * The Agent Builder's species spotlight (by the Agents group's node id): the live runner draws only one
 * species' walkers into it as bright dots, over black, in the picture's place for them. The canvas says
 * what to draw: `dataset.species` (0-based; absent or -1: every species) and `dataset.colour`
 * ('r,g,b', 0–1). The runner writes back `dataset.spot` ('live' once drawn; 'flat' for a 3D group with
 * no live Draw agents camera to project through; 'none' before the group has state) and `dataset.dots`
 * (the walkers it looked at, every species).
 */
export const agentSpotRegistry = new CanvasProbeRegistry();
/** Most walkers the spotlight looks at (every k-th one beyond it). */
const SPOT_DOTS = 1 << 18;
/** The spotlight's width in pixels (its height follows the picture's aspect). */
const SPOT_W = 640;
/** A spotlight dot's size in pixels. */
const SPOT_PX = 2;

/** A small target and an async readback of it (a pixel buffer and a fence, no stall). */
interface DotRead { rt: THREE.WebGLRenderTarget; W: number; H: number; pbo: WebGLBuffer | null; sync: WebGLSync | null; buf: Uint8Array }

/** '0.2,0.5,1' → [0.2, 0.5, 1], clamped to 0–1 (white when it does not read). */
export function parseSpotColour(s: string | undefined): [number, number, number] {
  const v = (s ?? '').split(',').map(x => (x.trim() === '' ? NaN : Number(x)));
  if (v.length < 3 || v.slice(0, 3).some(x => !Number.isFinite(x))) return [1, 1, 1];
  return [0, 1, 2].map(i => Math.min(1, Math.max(0, v[i]))) as [number, number, number];
}

/** The species index a spotlight canvas asks for (-1: all of them). */
export function parseSpotSpecies(s: string | undefined): number {
  if (s === undefined || s.trim() === '') return -1;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : -1;
}

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

/** What one listening node (Sound kick, Chladni) has heard so far (kit/agentPlan.js), and its level history as a texture. */
interface ListenState extends AgListenState { levelTex: THREE.DataTexture }
/**
 * A group's simulation: the schedule's state (kit/agentPlan.js agGroupState: step, births, the live
 * clock, Burst and Start over edges, the listening nodes' state by slug) and its state textures.
 */
interface GroupState extends AgGroupState<ListenState> {
  key: string; side: number; rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]; cur: 0 | 1;
}
/** A Trail's textures; a volume (3D) also has its layout and its front view (`proj`, what the picture samples). */
interface TrailState { key: string; w: number; h: number; rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]; cur: 0 | 1; vol?: AgVolLayout; proj?: THREE.WebGLRenderTarget }
/** A Draw agents' targets; in 3D with a scene's camera also its probe (4 × 1: the camera) and the scene's depth (half size). */
interface DrawState { key: string; w: number; h: number; acc: THREE.WebGLRenderTarget; glow: THREE.WebGLRenderTarget[]; out: THREE.WebGLRenderTarget; cam?: THREE.WebGLRenderTarget; depth?: THREE.WebGLRenderTarget }

const STATE_OPTS = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, count: 2 } as const;

/** One set of simulation state: the live preview's, or an offline render's. */
export class AgentTargets {
  readonly groups = new Map<string, GroupState>();
  readonly trails = new Map<string, TrailState>();
  readonly draws = new Map<string, DrawState>();
  /** Collide (3D scene) grids by node slug: the Scene's distance on 48³ cells, slices side by side (half float). */
  readonly grids = new Map<string, THREE.WebGLRenderTarget>();
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

  /** A group's state (made, all dead, when its count or its per-walker state changes). */
  group(g: AgentGroupProgram): GroupState {
    // A new Space (2D ↔ 3D) means new state too: the same texels mean different things.
    const key = `${g.side}${g.stateC ? ':C' : ''}${g.stateC && g.stateE ? ':E' : ''}${g.space3d ? ':3D' : ''}`;
    let s = this.groups.get(g.slug);
    if (s && s.key === key) return s;
    if (s) { s.rt[0].dispose(); s.rt[1].dispose(); this.dropListen(s); }
    // State A and B; with per-walker state also C (species, memory, colour) and D (its deposit); with More memory also E.
    const make = () => new THREE.WebGLRenderTarget(g.side, g.side, { ...STATE_OPTS, count: g.stateC ? (g.stateE ? 5 : 4) : 2 });
    s = { ...(agGroupState() as AgGroupState<ListenState>), key, side: g.side, rt: [make(), make()], cur: 0 };
    this.clear(s.rt[0]); this.clear(s.rt[1]);
    this.renderer.setRenderTarget(null);
    this.groups.set(g.slug, s);
    return s;
  }

  /** Every walker dead and the step count back to 0: the next step (step 0) gives birth again. */
  restartGroup(s: GroupState): void {
    this.clear(s.rt[0]); this.clear(s.rt[1]);
    this.renderer.setRenderTarget(null);
    agRestartGroup(s);
    this.dropListen(s);
  }

  /** A listening node's state in group `s` (made fresh, silent, when first heard or after a start over). */
  listen(s: GroupState, slug: string): ListenState {
    let l = s.listen.get(slug);
    if (l) return l;
    const st = agListenState();
    const levelTex = new THREE.DataTexture(st.levels.levels, GP_LEVELS, 1, THREE.RedFormat, THREE.FloatType);
    levelTex.minFilter = THREE.NearestFilter; levelTex.magFilter = THREE.NearestFilter;
    levelTex.needsUpdate = true;
    l = { ...st, levelTex };
    s.listen.set(slug, l);
    return l;
  }

  private dropListen(s: GroupState): void {
    for (const l of s.listen.values()) l.levelTex.dispose();
    s.listen.clear();
  }

  /** A Trail's textures at the size it wants for a picture of w × h (made, empty, when that changes). */
  trail(t: AgentTrailProgram, w: number, h: number): TrailState {
    if (t.volume) return this.volume(t, w, h);
    const [tw, th] = agTrailSize(w, h, t);
    const key = `${tw}x${th}:${t.edges}`;
    let s = this.trails.get(t.slug);
    if (s && s.key === key) return s;
    if (s) this.disposeTrail(s);
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

  /**
   * A volume Trail (3D): its slices side by side in one half-float texture (kit/agentPlan.js
   * agVolLayout), ping-pong, and its front view (each column summed through the depth) at
   * columns × rows, which the picture samples as it samples a 2D trail.
   */
  private volume(t: AgentTrailProgram, w: number, h: number): TrailState {
    const L = agVolLayout(t.volume!, w, h);
    const key = `vol${L.nx}x${L.ny}x${L.nz}:${t.edges}`;
    let s = this.trails.get(t.slug);
    if (s && s.key === key) return s;
    if (s) this.disposeTrail(s);
    const type = this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const make = () => new THREE.WebGLRenderTarget(L.w, L.h, {
      type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
    });
    const wrap = t.edges === 'wrap' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    const proj = new THREE.WebGLRenderTarget(L.nx, L.ny, { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: wrap, wrapT: wrap, depthBuffer: false, stencilBuffer: false });
    s = { key, w: L.w, h: L.h, rt: [make(), make()], cur: 0, vol: L, proj };
    this.clear(s.rt[0]); this.clear(s.rt[1]); this.clear(proj);
    this.renderer.setRenderTarget(null);
    this.trails.set(t.slug, s);
    return s;
  }

  private disposeTrail(s: TrailState): void { s.rt[0].dispose(); s.rt[1].dispose(); s.proj?.dispose(); }

  clearTrail(s: TrailState): void { this.clear(s.rt[0]); this.clear(s.rt[1]); if (s.proj) this.clear(s.proj); this.renderer.setRenderTarget(null); }

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
    if (d.style !== 'points') {
      // GP's glow: ¼ and 1/16 size, each blurred (scratch + result), then composed over the points.
      const w1 = Math.ceil(w / 4), h1 = Math.ceil(h / 4), w2 = Math.ceil(w1 / 4), h2 = Math.ceil(h1 / 4);
      glow.push(rt(w1, h1), rt(w1, h1), rt(w2, h2), rt(w2, h2));
      out = rt(w, h);
    }
    s = { key, w, h, acc, glow, out };
    this.draws.set(d.slug, s);
    return s;
  }

  private disposeDraw(s: DrawState): void { s.acc.dispose(); for (const g of s.glow) g.dispose(); if (s.out !== s.acc) s.out.dispose(); s.cam?.dispose(); s.depth?.dispose(); }

  /** A 3D Draw agents' scene probe targets: the camera (4 × 1, full float) and the scene's depth at half the picture's size. */
  probeTargets(s: DrawState, depth: boolean): void {
    if (!s.cam) s.cam = new THREE.WebGLRenderTarget(4, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
    if (depth && !s.depth) {
      s.depth = new THREE.WebGLRenderTarget(Math.max(1, Math.ceil(s.w / 2)), Math.max(1, Math.ceil(s.h / 2)), {
        type: this.halfFloat ? THREE.HalfFloatType : THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false,
      });
    }
  }

  /** A Collide (3D scene)'s grid target (made once). */
  grid(slug: string): THREE.WebGLRenderTarget {
    let rt = this.grids.get(slug);
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(GP_VOL * GP_VOL_TILES[0], GP_VOL * GP_VOL_TILES[1], {
        type: this.halfFloat ? THREE.HalfFloatType : THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
      });
      this.grids.set(slug, rt);
    }
    return rt;
  }

  /** Start everything over: every group dead at step 0, every trail empty. */
  resetAll(): void {
    for (const g of this.groups.values()) { this.restartGroup(g); g.live = agLiveState(); }
    for (const t of this.trails.values()) this.clearTrail(t);
  }

  /** Drop what the spec no longer has. */
  prune(spec: AgentsSpec): void {
    const gs = new Set(spec.groups.map(g => g.slug)), ts = new Set(spec.trails.map(t => t.slug)), ds = new Set(spec.draws.map(d => d.slug));
    for (const [k, s] of this.groups) if (!gs.has(k)) { s.rt[0].dispose(); s.rt[1].dispose(); this.dropListen(s); this.groups.delete(k); }
    for (const [k, s] of this.trails) if (!ts.has(k)) { this.disposeTrail(s); this.trails.delete(k); }
    for (const [k, s] of this.draws) if (!ds.has(k)) { this.disposeDraw(s); this.draws.delete(k); }
    const gr = new Set(spec.groups.flatMap(g => (g.grids ?? []).map(x => x.slug)));
    for (const [k, rt] of this.grids) if (!gr.has(k)) { rt.dispose(); this.grids.delete(k); }
  }

  dispose(): void {
    for (const s of this.groups.values()) { s.rt[0].dispose(); s.rt[1].dispose(); this.dropListen(s); }
    for (const s of this.trails.values()) this.disposeTrail(s);
    for (const s of this.draws.values()) this.disposeDraw(s);
    for (const rt of this.grids.values()) rt.dispose();
    this.groups.clear(); this.trails.clear(); this.draws.clear(); this.grids.clear();
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
  /** What Sound from hears now ('live', 'master', 'track1'…): a spectrum, or null (the Particles node's source). */
  sound?: (source: string) => GpSoundInput | null;
}

interface StepEntry { spec: AgentGroupProgram; material: THREE.ShaderMaterial; ready: boolean; failed: boolean; dropped?: boolean }
/** A Trail's own step program (Add / Block wired), or a 3D Draw agents' scene probe (its camera or depth), compiled like an update shader. */
interface TrailEntry { slug: string; source: string; material: THREE.ShaderMaterial; ready: boolean; failed: boolean; dropped?: boolean }

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
  // Streaks: the same empty geometry drawn as line segments (two vertices an agent).
  private lineScene = new THREE.Scene();
  private lines: THREE.LineSegments;
  private compileScene = new THREE.Scene();
  private compileMesh: THREE.Mesh;
  private placeholder = new THREE.MeshBasicMaterial();
  private depositMat = raw(AG_DEPOSIT_VERT, AG_DEPOSIT_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_d: { value: null }, u_side: { value: 1 }, u_species: { value: 1 }, u_stateC: { value: 0 }, u_what: { value: 0 },
    u_aspect: { value: 1 }, u_amount: { value: 1 }, u_size: { value: 1 },
  }, true);
  private trailMat = raw(AG_FULL_VERT, AG_TRAIL_FRAG, { u_src: { value: null }, u_diffuse: { value: 1 }, u_keep: { value: 0.9 }, u_wrap: { value: 1 }, u_k5: { value: 0 }, u_signed: { value: 0 } }, false);
  private trailSteps: TrailEntry[] = [];
  // 3D: a volume's deposit, step and front view; Draw agents through a camera; the scene probes (by `<slug>:camera` / `:depth`).
  private deposit3Mat = raw(AG_DEPOSIT3_VERT, AG_DEPOSIT_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_d: { value: null }, u_side: { value: 1 }, u_species: { value: 1 }, u_stateC: { value: 0 }, u_what: { value: 0 },
    u_aspect: { value: 1 }, u_amount: { value: 1 }, u_vol: { value: new THREE.Vector4(1, 1, 1, 1) }, u_atlas: { value: new THREE.Vector2(1, 1) },
  }, true);
  private trail3Mat = raw(AG_FULL_VERT, AG_TRAIL3_FRAG, { u_src: { value: null }, u_diffuse: { value: 1 }, u_keep: { value: 0.9 }, u_wrap: { value: 1 }, u_k5: { value: 0 }, u_signed: { value: 0 }, u_vol: { value: new THREE.Vector4(1, 1, 1, 1) } }, false);
  private proj3Mat = raw(AG_FULL_VERT, AG_PROJ3_FRAG, { u_src: { value: null }, u_vol: { value: new THREE.Vector4(1, 1, 1, 1) } }, false);
  private draw3Mat = raw(AG_DRAW3_VERT, AG_DRAW_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_cam: { value: null }, u_stateC: { value: 0 }, u_side: { value: 1 }, u_species: { value: 1 }, u_colorBy: { value: 0 },
    u_aspect: { value: 1 }, u_size: { value: 1.5 }, u_bright: { value: 0.5 }, u_speedRef: { value: 0.5 },
    u_colA: { value: new THREE.Vector3(1, 1, 1) }, u_colB: { value: new THREE.Vector3(1, 1, 1) },
    u_prim: { value: 0 }, u_depth: { value: 0 }, u_field: { value: null }, u_viewSize: { value: new THREE.Vector2(1, 1) },
    u_ink: { value: 0 }, u_fade: { value: 1 }, u_usePal: { value: 0 }, u_rainbow: { value: 0 }, u_thread: { value: 0 },
    u_pal: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    u_lights: { value: 0 }, u_lightZ: { value: new THREE.Vector4() },
    u_light: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    u_lightCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    u_camSrc: { value: 0 }, u_eye: { value: new THREE.Vector3() }, u_fwd: { value: new THREE.Vector3(0, 0, -1) }, u_right: { value: new THREE.Vector3(1, 0, 0) }, u_up: { value: new THREE.Vector3(0, 1, 0) },
    u_lens: { value: 1.8 }, u_ortho: { value: 0 }, u_camDist: { value: 3 }, u_focus: { value: 3 }, u_coc: { value: 0 }, u_cap: { value: 7 },
  }, true);
  private probes: TrailEntry[] = [];
  /** Collide (3D scene)'s grid programs (by node slug): the Scene's distance on its grid, filled every step. */
  private gridPrograms: TrailEntry[] = [];
  private drawMat = raw(AG_DRAW_VERT, AG_DRAW_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_stateC: { value: 0 }, u_side: { value: 1 }, u_species: { value: 1 }, u_colorBy: { value: 0 },
    u_aspect: { value: 1 }, u_size: { value: 1.5 }, u_bright: { value: 0.5 }, u_speedRef: { value: 0.5 },
    u_colA: { value: new THREE.Vector3(1, 1, 1) }, u_colB: { value: new THREE.Vector3(1, 1, 1) },
    u_prim: { value: 0 }, u_depth: { value: 0 }, u_field: { value: null }, u_viewSize: { value: new THREE.Vector2(1, 1) },
    u_ink: { value: 0 }, u_fade: { value: 1 }, u_usePal: { value: 0 }, u_rainbow: { value: 0 }, u_thread: { value: 0 },
    u_pal: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    u_lights: { value: 0 }, u_lightZ: { value: new THREE.Vector4() },
    u_light: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    u_lightCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  }, true);
  /**
   * Neighbours (docs/agents-group.md "Neighbours"): each such group's grid, rebuilt every step just
   * before its rule from the state it reads (so one scratch set serves the live preview and offline
   * renders alike): two slot atlases (even and odd slots, full float) and the count per cell.
   */
  private nbGrids = new Map<string, { d3: boolean; atlas: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]; count: THREE.WebGLRenderTarget }>();
  private nbBinUniforms = () => ({
    u_a: { value: null }, u_b: { value: null }, u_prev: { value: null }, u_side: { value: 1 }, u_d3: { value: 0 },
    u_grid: { value: new THREE.Vector4(1, 1, 1, 1) }, u_pass: { value: new THREE.Vector4() }, u_target: { value: new THREE.Vector2(1, 1) },
  });
  private nbCountMat = raw(AG_NB_BIN_VERT, AG_NB_BIN_FRAG, this.nbBinUniforms(), true);
  private nbSlotMat = raw(AG_NB_BIN_VERT, AG_NB_BIN_FRAG, this.nbBinUniforms(), false);
  /** J_n for round Chladni plates (made when one first needs it). */
  private bessel: THREE.DataTexture | null = null;
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
  // The group cards' live dots: a sample of the walkers as additive points (every `u_stride`-th one).
  private dotsMat = raw(AG_THUMB_DOTS_VERT, AG_THUMB_DOTS_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_side: { value: 1 }, u_stride: { value: 1 }, u_aspect: { value: 1 }, u_gain: { value: 0.3 },
  }, true);
  private dots: THREE.Points;
  private dotsScene = new THREE.Scene();
  /**
   * Each group card's dots: its own small target and a read started into a pixel buffer, picked up
   * a frame or more later when the GPU has finished (no stall: a synchronous read here waited for
   * the whole frame's simulation, about 0.35–0.9 ms a frame on average on an M3 Pro).
   */
  private dotReads = new Map<string, DotRead>();
  /** The picture's aspect at the last run (the dots thumbnail's shape). */
  private aspect = 16 / 9;
  /** The clock of the last live run (where a 3D spotlight's camera was then). */
  private lastTime = 0;
  // The Agent Builder's species spotlight (agentSpotRegistry): one species' walkers as additive dots.
  private spotMat = raw(AG_SPOT_VERT, AG_SPOT_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_cam: { value: null },
    u_side: { value: 1 }, u_stride: { value: 1 }, u_species: { value: 1 }, u_stateC: { value: 0 }, u_only: { value: -1 }, u_deep: { value: 0 }, u_camSrc: { value: 0 },
    u_aspect: { value: 1 }, u_px: { value: SPOT_PX }, u_gain: { value: 1 }, u_col: { value: new THREE.Vector3(1, 1, 1) },
    u_eye: { value: new THREE.Vector3() }, u_fwd: { value: new THREE.Vector3(0, 0, -1) }, u_right: { value: new THREE.Vector3(1, 0, 0) }, u_up: { value: new THREE.Vector3(0, 1, 0) },
    u_lens: { value: 1.8 }, u_ortho: { value: 0 }, u_camDist: { value: 3 },
  }, true);
  private spot: THREE.Points;
  private spotScene = new THREE.Scene();
  /** Each spotlight canvas's target and read (keyed `spot:<node id>`, apart from the group cards' dots). */
  private spotReads = new Map<string, DotRead>();
  // The Memory section's lens (agentMemoryGpu.ts): walkers coloured by one memory; and its live ranges.
  private memMat = raw(MEM_LENS_VERT, MEM_LENS_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_e: { value: null }, u_cam: { value: null },
    u_side: { value: 1 }, u_stride: { value: 1 }, u_species: { value: 1 }, u_stateC: { value: 0 }, u_only: { value: -1 }, u_deep: { value: 0 }, u_camSrc: { value: 0 },
    u_aspect: { value: 1 }, u_px: { value: SPOT_PX }, u_gain: { value: 1 }, u_col: { value: new THREE.Vector3(1, 1, 1) },
    u_eye: { value: new THREE.Vector3() }, u_fwd: { value: new THREE.Vector3(0, 0, -1) }, u_right: { value: new THREE.Vector3(1, 0, 0) }, u_up: { value: new THREE.Vector3(0, 1, 0) },
    u_lens: { value: 1.8 }, u_ortho: { value: 0 }, u_camDist: { value: 3 },
    u_memSrc: { value: 0 }, u_memComp: { value: 0 }, u_lo: { value: 0 }, u_hi: { value: 1 },
  }, false);
  private memRangeMat = raw(AG_FULL_VERT, MEM_RANGE_FRAG, { u_b: { value: null }, u_c: { value: null }, u_e: { value: null }, u_side: { value: 1 }, u_stride: { value: 1 }, u_hasE: { value: 0 } }, false);
  private memRanges = new Map<string, { rt: THREE.WebGLRenderTarget; reader: GpReadback; busy: boolean; last: Float32Array | null; at: number }>();
  // Readings for Play (P6): the live state summed on the GPU into 2 × 1 texels, read back without a stall.
  private readMat = raw(AG_FULL_VERT, AG_READ_FRAG, {
    u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_side: { value: 1 }, u_species: { value: 1 }, u_stateC: { value: 0 }, u_w: { value: 1 }, u_deep: { value: 0 },
  }, false);
  private sumMat = raw(AG_FULL_VERT, AG_SUM_FRAG, { u_src: { value: null }, u_inW: { value: 1 }, u_inH: { value: 1 }, u_w: { value: 1 } }, false);
  private reads = new Map<string, { side: number; rts: THREE.WebGLRenderTarget[]; reader: GpReadback; busy: boolean; last: Float32Array | null; count: number; aspect: number }>();

  constructor(host: AgentRunnerHost) {
    this.host = host;
    this.quad = new THREE.Mesh(host.geometry, this.trailMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.points = new THREE.Points(this.pointGeometry, this.depositMat);
    this.points.frustumCulled = false;
    this.pointScene.add(this.points);
    this.lines = new THREE.LineSegments(this.pointGeometry, this.drawMat);
    this.lines.frustumCulled = false;
    this.lineScene.add(this.lines);
    this.compileMesh = new THREE.Mesh(host.geometry, this.placeholder);
    this.compileScene.add(this.compileMesh);
    this.thumbQuad = new THREE.Mesh(host.geometry, this.thumbMat);
    this.thumbScene.add(this.thumbQuad);
    this.dots = new THREE.Points(this.pointGeometry, this.dotsMat);
    this.dots.frustumCulled = false;
    this.dotsScene.add(this.dots);
    this.spot = new THREE.Points(this.pointGeometry, this.spotMat);
    this.spot.frustumCulled = false;
    this.spotScene.add(this.spot);
  }

  get current(): AgentsSpec { return this.spec; }
  /** Something runs while the clock does: the preview keeps drawing. */
  get active(): boolean { return this.spec.groups.some(g => g.live); }
  /** Every update and trail program compiled (or failed). */
  get settled(): boolean { return [...this.steps, ...this.trailSteps, ...this.probes, ...this.gridPrograms].every(e => e.ready || e.failed); }

  /** The uniforms the runner adds to the shared table. */
  private ensureUniforms(): void {
    const u = this.host.uniforms();
    for (const g of this.spec.groups) {
      for (const n of [agentStateUniform(g.slug, 'A'), agentStateUniform(g.slug, 'B'), ...(g.stateC ? [agentStateUniform(g.slug, 'C'), agentStateUniform(g.slug, 'D')] : []), ...(g.stateC && g.stateE ? [agentStateUniform(g.slug, 'E')] : [])]) if (!u[n]) u[n] = { value: null };
      if (!u[agentStepUniform(g.slug)]) u[agentStepUniform(g.slug)] = { value: 0 };
      if (!(u[agentWindowUniform(g.slug)]?.value instanceof THREE.Vector4)) u[agentWindowUniform(g.slug)] = { value: new THREE.Vector4(0, 0, 0, 0) };
      if (g.neighbours) {
        const n = agentNbUniforms(g.slug);
        for (const k of [n.a, n.b, n.n]) if (!u[k]) u[k] = { value: null };
        if (!(u[n.g]?.value instanceof THREE.Vector4)) u[n.g] = { value: new THREE.Vector4(1, 1, 1, 1) };
      }
      for (const gr of g.grids ?? []) {
        const n = sceneGridUniforms(gr.slug);
        if (!u[n.grid]) u[n.grid] = { value: null };
        if (!(u[n.at]?.value instanceof THREE.Vector4)) u[n.at] = { value: new THREE.Vector4(0, 0, 0, 2) };
      }
      for (const l of g.listeners) {
        const n = listenUniforms(l.slug);
        if (!(u[n.sound]?.value instanceof THREE.Vector4)) u[n.sound] = { value: new THREE.Vector4() };
        if (!Array.isArray(u[n.shocks]?.value)) u[n.shocks] = { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) };
        if (!u[n.levels]) u[n.levels] = { value: null };
        if (!Array.isArray(u[n.plateModes]?.value)) u[n.plateModes] = { value: Array.from({ length: 8 }, () => new THREE.Vector4()) };
        if (!u[n.plateCount]) u[n.plateCount] = { value: 0 };
        if (!u[n.plateShake]) u[n.plateShake] = { value: 0 };
        if (l.kind === 'plate' && l.shape === 'circle' && !u[AG_BESSEL_UNIFORM]?.value) {
          if (!this.bessel) {
            this.bessel = new THREE.DataTexture(gpBesselTable(), GP_BESSEL_W, GP_BESSEL_N, THREE.RedFormat, THREE.FloatType);
            this.bessel.minFilter = THREE.NearestFilter; this.bessel.magFilter = THREE.NearestFilter;
            this.bessel.needsUpdate = true;
          }
          u[AG_BESSEL_UNIFORM] = { value: this.bessel };
        }
      }
    }
    for (const t of this.spec.trails) {
      if (t.volume && !(u[trailVolUniform(t.slug)]?.value instanceof THREE.Vector4)) u[trailVolUniform(t.slug)] = { value: new THREE.Vector4(1, 1, 1, 1) };
      if (!u[trailUniform(t.slug)]) u[trailUniform(t.slug)] = { value: null };
      if (!(u[`${trailUniform(t.slug)}_px`]?.value instanceof THREE.Vector2)) u[`${trailUniform(t.slug)}_px`] = { value: new THREE.Vector2(1, 1) };
      if (t.stepShader) {
        const n = trailStepUniforms(t.slug);
        if (!u[n.src]) u[n.src] = { value: null };
        if (!(u[n.step]?.value instanceof THREE.Vector4)) u[n.step] = { value: new THREE.Vector4() };
      }
    }
    for (const d of this.spec.draws) {
      if (d.probe && !(u[d.probe.uniform]?.value instanceof THREE.Vector4)) u[d.probe.uniform] = { value: new THREE.Vector4() };
      if (!u[agentDrawUniform(d.slug)]) u[agentDrawUniform(d.slug)] = { value: null };
      if (!(u[`${agentDrawUniform(d.slug)}_px`]?.value instanceof THREE.Vector2)) u[`${agentDrawUniform(d.slug)}_px`] = { value: new THREE.Vector2(1, 1) };
    }
    if (this.boundTo !== u) {
      for (const e of this.steps) e.material.uniforms = u;
      for (const e of this.trailSteps) e.material.uniforms = u;
      for (const e of this.probes) e.material.uniforms = u;
      for (const e of this.gridPrograms) e.material.uniforms = u;
      this.boundTo = u;
    }
  }

  /** Take a new compile's agents. Update shaders whose source is unchanged are kept (a slider never gets here). */
  update(spec: AgentsSpec, vertexShader: string): void {
    setAgentGroups(spec.groups.map(g => ({ nodeId: g.nodeId, label: g.label })));
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
    for (const slug of [...this.nbGrids.keys()]) if (!spec.groups.some(g => g.slug === slug && g.neighbours)) this.dropNeighbours(slug);
    // Trails' own step programs (Add / Block wired), kept while their source is unchanged.
    const oldTrails = new Map(this.trailSteps.map(e => [e.slug, e]));
    this.trailSteps = spec.trails.filter(t => t.stepShader).map(t => {
      const prev = oldTrails.get(t.slug);
      if (prev && !vsChanged && prev.source === t.stepShader) { oldTrails.delete(t.slug); return prev; }
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: t.stepShader!, uniforms: u, depthTest: false, depthWrite: false });
      return { slug: t.slug, source: t.stepShader!, material, ready: false, failed: false };
    });
    for (const e of oldTrails.values()) this.drop(e);
    // 3D Draw agents' scene probes (a ray-marched scene's camera and depth), kept while their source is unchanged.
    const oldProbes = new Map(this.probes.map(e => [e.slug, e]));
    this.probes = spec.draws.flatMap(d => (d.probe ? [[`${d.slug}:camera`, d.probe.camera], ...(d.probe.depth ? [[`${d.slug}:depth`, d.probe.depth]] : [])] : [])).map(([slug, source]) => {
      const prev = oldProbes.get(slug);
      if (prev && !vsChanged && prev.source === source) { oldProbes.delete(slug); return prev; }
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: source, uniforms: u, depthTest: false, depthWrite: false });
      return { slug, source, material, ready: false, failed: false };
    });
    for (const e of oldProbes.values()) this.drop(e);
    // Collide (3D scene)'s grid programs, kept while their source is unchanged.
    const oldGrids = new Map(this.gridPrograms.map(e => [e.slug, e]));
    this.gridPrograms = spec.groups.flatMap(g => g.grids ?? []).map(gr => {
      const prev = oldGrids.get(gr.slug);
      if (prev && !vsChanged && prev.source === gr.shader) { oldGrids.delete(gr.slug); return prev; }
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: gr.shader, uniforms: u, depthTest: false, depthWrite: false });
      return { slug: gr.slug, source: gr.shader, material, ready: false, failed: false };
    });
    for (const e of oldGrids.values()) this.drop(e);
    this.boundTo = null;
    this.ensureUniforms();
    for (const e of this.steps) if (!e.ready && !e.failed) this.compile(e);
    for (const e of this.trailSteps) if (!e.ready && !e.failed) this.compile(e);
    for (const e of this.probes) if (!e.ready && !e.failed) this.compile(e);
    for (const e of this.gridPrograms) if (!e.ready && !e.failed) this.compile(e);
  }

  private drop(e: StepEntry | TrailEntry): void {
    e.dropped = true;
    if (e.ready || e.failed) e.material.dispose();
  }

  private compile(e: StepEntry | TrailEntry): void {
    const { renderer, camera } = this.host;
    this.compileMesh.material = e.material;
    const settle = () => {
      e.ready = true;
      if (e.dropped) { e.material.dispose(); return; }
      const gl = renderer.getContext();
      const prog = (renderer.properties.get(e.material) as { currentProgram?: { program?: WebGLProgram } }).currentProgram?.program;
      if (prog && gl.getProgramParameter(prog, gl.LINK_STATUS) === false) { e.failed = true; this.host.onLinkFailed('spec' in e ? e.spec.fragmentShader : e.source); }
      this.host.onReady();
    };
    renderer.compileAsync(this.compileScene, camera).then(settle, () => { e.failed = true; if (e.dropped) e.material.dispose(); });
    this.compileMesh.material = this.placeholder;
  }

  /** Compile every update shader again (after the GPU context was rebuilt). */
  recompileAll(): void {
    const spec = this.spec, vs = this.vertexShader;
    for (const e of this.steps) this.drop(e);
    for (const e of this.trailSteps) this.drop(e);
    for (const e of this.probes) this.drop(e);
    for (const e of this.gridPrograms) this.drop(e);
    this.steps = [];
    this.trailSteps = [];
    this.probes = [];
    this.gridPrograms = [];
    this.vertexShader = '';
    this.update(spec, vs);
  }

  private read(p: AgentParam | number[] | undefined, fallback: number): number {
    if (typeof p === 'number') return isFinite(p) ? p : fallback;
    if (typeof p === 'string') { const v = this.host.uniforms()[p]?.value; return typeof v === 'number' && isFinite(v) ? v : fallback; }
    return fallback;
  }
  /** read and readColour as the shared schedule calls them (kit/agentPlan.js). */
  private reader = (p: unknown, fallback: number) => this.read(p as AgentParam, fallback);
  private colourReader = (p: unknown, fallback: number[]) => this.readColour(p as AgentParam, fallback);

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
    if (o.live) { this.aspect = aspect; this.lastTime = o.time; }
    // A group steps once its rule is compiled, and its Collide (3D scene) grids too (else its first steps would collide with nothing).
    const gridDone = (g: AgentGroupProgram) => (g.grids ?? []).every(gr => this.gridPrograms.some(x => x.slug === gr.slug && (x.ready || x.failed)));
    const ready = this.steps.filter(e => e.spec.live && e.ready && !e.failed && gridDone(e.spec));
    const cap = o.live ? agGovern(this.gov, o.frameMs ?? 0, 1000 / 60) : Infinity;

    // How many steps each group runs this frame.
    const plan: Array<{ e: StepEntry; s: GroupState; steps: number; spf: number; preroll: number }> = [];
    const restarted = new Set<string>();
    for (const e of ready) {
      const g = e.spec;
      const s = targets.group(g);
      // The schedule (kit/agentPlan.js, shared with web pages): Burst, Start over, the live clock or the offline step.
      const r = agGroupSteps(s, g, this.reader, { live: o.live, time: o.time, cap, restart: o.live && (restartAll || restartRequests.has(g.nodeId)) }, () => {
        targets.restartGroup(s); restarted.add(g.slug);
      });
      if (o.live) stats.set(g.nodeId, { count: g.side * g.side, stepsPerFrame: r.spf, rate: r.rate, step: s.step + r.steps });
      plan.push({ e, s, steps: r.steps, spf: r.spf, preroll: r.preroll });
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
    // A volume (3D) as the picture sees it: summed through its depth into its front view.
    const project = () => {
      for (const [slug, ts] of trailState) {
        if (!ts.vol || !ts.proj) continue;
        const pu = this.proj3Mat.uniforms;
        pu.u_src.value = ts.rt[ts.cur].texture;
        (pu.u_vol.value as THREE.Vector4).fromArray(agVolUniform(ts.vol));
        this.pass(this.proj3Mat, ts.proj);
        u[trailUniform(slug)].value = ts.proj.texture;
      }
    };
    for (const [slug, ts] of trailState) if (ts.vol) (u[trailVolUniform(slug)].value as THREE.Vector4).fromArray(agVolUniform(ts.vol));
    // A picture pixel in 0–1 texture units, for the sampling nodes' offsets (as a Pass's `_px`).
    for (const t of this.spec.trails) (u[`${trailUniform(t.slug)}_px`].value as THREE.Vector2).set(1 / w, 1 / h);
    for (const d of this.spec.draws) (u[`${agentDrawUniform(d.slug)}_px`].value as THREE.Vector2).set(1 / w, 1 / h);

    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    const timeUniform = u.u_time;
    const keepTime = timeUniform?.value;
    try {
      const most = plan.reduce((m, p) => Math.max(m, p.steps), 0);
      for (let k = 0; k < most; k++) {
        const stepping = plan.filter(p => p.steps > k);
        // The clock time of this step (the first stepping group's): a Trail's own step program reads it.
        let stepTime: number | null = null;
        // 1. The rule, for every walker of every group stepping now (reading the trails as they are).
        bindTrails();
        for (const p of stepping) {
          const g = p.e.spec;
          const s = p.s;
          const win = agStepWindow(s, g, g.side * g.side, this.reader);
          (u[agentWindowUniform(g.slug)].value as THREE.Vector4).set(win.start, win.count, 0, 0);
          if (g.listeners.length) this.hear(targets, s, g, agStepTime(s.step, p.spf, p.preroll));
          u[agentStepUniform(g.slug)].value = s.step >>> 0;
          this.bindState(g, s);
          if (timeUniform) timeUniform.value = agStepTime(s.step, p.spf, p.preroll);
          if (stepTime === null) stepTime = agStepTime(s.step, p.spf, p.preroll);
          // Collide (3D scene): the Scene's grid at this step's clock (a moving scene moves the same live and offline).
          for (const gr of g.grids ?? []) this.fillGrid(targets, gr);
          // Neighbours: the grid of where the walkers are as this step begins.
          if (g.neighbours) {
            const timedNb = k === 0 && (o.timer?.begin(`agents:${g.label} neighbours`) ?? false);
            this.buildNeighbours(g, s, aspect);
            if (timedNb) o.timer!.end();
          }
          p.e.material.uniformsNeedUpdate = true;
          this.quad.material = p.e.material;
          const timed = k === 0 && (o.timer?.begin(`agents:${g.label} step`) ?? false);
          renderer.setRenderTarget(s.rt[1 - s.cur]);
          renderer.render(this.quadScene, this.host.camera);
          if (timed) o.timer!.end();
          s.cur = (1 - s.cur) as 0 | 1;
          s.step++;
          this.bindState(g, s);
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
          // Into a volume (a 3D group's trail): one cell a walker; a group in 3D into a flat trail lands at its x and y.
          const mat = ts.vol ? this.deposit3Mat : this.depositMat;
          const du = mat.uniforms;
          du.u_a.value = gs.rt[gs.cur].textures[0];
          du.u_b.value = gs.rt[gs.cur].textures[1];
          du.u_d.value = g.stateC ? gs.rt[gs.cur].textures[3] : null;
          du.u_stateC.value = g.stateC ? 1 : 0;
          du.u_what.value = d.what === 'velocity' ? 1 : 0;
          du.u_side.value = g.side; du.u_species.value = g.species; du.u_aspect.value = aspect;
          du.u_amount.value = this.read(d.params.amount, 1);
          if (ts.vol) {
            (du.u_vol.value as THREE.Vector4).fromArray(agVolUniform(ts.vol));
            (du.u_atlas.value as THREE.Vector2).set(ts.w, ts.h);
          } else du.u_size.value = Math.max(1, Math.min(4, Math.round(this.read(d.params.size, 1))));
          mat.uniformsNeedUpdate = true;
          this.points.material = mat;
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
          const diffuse = this.read(t.params.diffuse, 1), keep = agKeep(this.read(t.params.halfLife, 0.1));
          const wrap = t.edges === 'wrap' ? 1 : 0, k5 = t.kernel === 5 ? 1 : 0, signed = t.signed ? 1 : 0;
          // Add / Block wired: the trail's own step program (once compiled), at this step's clock time.
          const own = t.stepShader ? this.trailSteps.find(e => e.slug === t.slug && e.ready && !e.failed) : undefined;
          if (t.stepShader && !own) continue;
          if (own) {
            const n = trailStepUniforms(t.slug);
            u[n.src].value = ts.rt[ts.cur].texture;
            (u[n.step].value as THREE.Vector4).set(diffuse, keep, wrap + 2 * k5 + 4 * signed, 1 / AG_STEP_HZ);
            if (timeUniform && stepTime !== null) timeUniform.value = stepTime;
            own.material.uniformsNeedUpdate = true;
            this.quad.material = own.material;
          } else {
            const mat = ts.vol ? this.trail3Mat : this.trailMat;
            const tu = mat.uniforms;
            tu.u_src.value = ts.rt[ts.cur].texture;
            tu.u_diffuse.value = diffuse;
            tu.u_keep.value = keep;
            tu.u_wrap.value = wrap; tu.u_k5.value = k5; tu.u_signed.value = signed;
            if (ts.vol) (tu.u_vol.value as THREE.Vector4).fromArray(agVolUniform(ts.vol));
            mat.uniformsNeedUpdate = true;
            this.quad.material = mat;
          }
          const timed = k === 0 && (o.timer?.begin(`agents:${t.label} trail`) ?? false);
          renderer.setRenderTarget(ts.rt[1 - ts.cur]);
          renderer.render(this.quadScene, this.host.camera);
          if (timed) o.timer!.end();
          ts.cur = (1 - ts.cur) as 0 | 1;
        }
        // An offline run can be thousands of steps: hand the GPU each chunk as it goes.
        if (!o.live && k > 0 && k % AG_OFFLINE_CHUNK === 0) renderer.getContext().flush();
      }
      for (const p of plan) this.bindState(p.e.spec, p.s);
      bindTrails();
      project();
      // The frame's own clock from here on: a scene probe reads it as the picture will (an offline render sets the
      // picture's time only after this, so the uniform may still hold the last frame's).
      if (timeUniform) timeUniform.value = o.time;
      // 4. Draw agents.
      for (const d of this.spec.draws) {
        if (!d.live) continue;
        const gs = targets.groups.get(d.group);
        const g = this.spec.groups.find(x => x.slug === d.group);
        if (!gs || !g) { u[agentDrawUniform(d.slug)].value = null; continue; }
        const timed = o.timer?.begin(`agents:${g.label} draw`) ?? false;
        const ds = targets.draw(d, w, h);
        const seen = d.space3d && d.probe ? this.probe(targets, ds, d) : null;
        u[agentDrawUniform(d.slug)].value = (d.space3d ? this.draw3(ds, d, g, gs, aspect, o.time, seen) : this.draw(ds, d, g, gs, aspect, o.time)).texture;
        if (timed) o.timer!.end();
      }
      // 5. Readings for Play, for the groups something reads (live only: a render has no Play to read them).
      if (o.live) this.readings(targets, aspect, o.timer);
    } finally {
      if (timeUniform) timeUniform.value = keepTime;
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(null);
    }
    this.frames++;
  }

  /**
   * Readings (lib/agentReadings.ts): for every group Play reads, what arrived from the GPU is
   * published; when no read is in flight, its state is summed (kit/agentShaders.js AG_READ_FRAG,
   * then AG_SUM_FRAG, down to 2 × 1 texels) and a read of those started (gpReadback: a pixel
   * buffer and a fence, so nothing waits). The values are a frame or two late.
   */
  private readings(targets: AgentTargets, aspect: number, timer?: Timer): void {
    const { renderer } = this.host;
    const live = new Set<string>();
    for (const g of this.spec.groups) {
      if (!g.live || !agentReadingsWanted(g.nodeId)) continue;
      const gs = targets.groups.get(g.slug);
      if (!gs) continue;
      live.add(g.nodeId);
      let r = this.reads.get(g.nodeId);
      if (r && r.side !== g.side) { for (const rt of r.rts) rt.dispose(); r.reader.dispose(); r = undefined; }
      if (!r) {
        const rts = agReadPlan(g.side).map(([w, h]) => new THREE.WebGLRenderTarget(2 * w, h, {
          type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false,
        }));
        r = { side: g.side, rts, reader: gpReadback(renderer.getContext() as WebGL2RenderingContext), busy: false, last: null, count: g.side * g.side, aspect };
        this.reads.set(g.nodeId, r);
      }
      const px = r.reader.poll();
      if (px && px !== r.last) {
        r.last = px; r.busy = false;
        publishAgentReadings(g.nodeId, agReadDecode(px, r.count, r.aspect));
      }
      if (r.busy) continue;
      const timed = timer?.begin(`agents:${g.label} readings`) ?? false;
      const plan = agReadPlan(g.side);
      const ru = this.readMat.uniforms;
      const tex = gs.rt[gs.cur].textures;
      ru.u_a.value = tex[0]; ru.u_b.value = tex[1]; ru.u_c.value = g.stateC ? tex[2] : null;
      ru.u_side.value = g.side; ru.u_species.value = g.species; ru.u_stateC.value = g.stateC ? 1 : 0; ru.u_w.value = plan[0][0]; ru.u_deep.value = g.space3d ? 1 : 0;
      this.pass(this.readMat, r.rts[0]);
      for (let k = 1; k < plan.length; k++) {
        const su = this.sumMat.uniforms;
        su.u_src.value = r.rts[k - 1].texture;
        su.u_inW.value = plan[k - 1][0]; su.u_inH.value = plan[k - 1][1]; su.u_w.value = plan[k][0];
        this.pass(this.sumMat, r.rts[k]);
      }
      const last = r.rts[r.rts.length - 1];
      const fb = (renderer.properties.get(last) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer ?? null;
      if (fb && r.reader.request(fb, 2, 1)) { r.busy = true; r.count = g.side * g.side; r.aspect = aspect; }
      if (timed) timer!.end();
    }
    // Groups nobody reads any more (or gone): their targets go.
    for (const [id, r] of this.reads) if (!live.has(id)) { for (const rt of r.rts) rt.dispose(); r.reader.dispose(); this.reads.delete(id); }
  }

  /** A Collide (3D scene)'s grid: where it is (its sliders), then the Scene's distance at every cell. */
  private fillGrid(targets: AgentTargets, gr: NonNullable<AgentGroupProgram['grids']>[number]): void {
    const u = this.host.uniforms();
    const n = sceneGridUniforms(gr.slug);
    (u[n.at].value as THREE.Vector4).set(this.read(gr.at[0], 0), this.read(gr.at[1], 0), this.read(gr.at[2], 0), Math.max(1e-3, this.read(gr.at[3], 2)));
    const e = this.gridPrograms.find(x => x.slug === gr.slug && x.ready && !x.failed);
    const rt = targets.grid(gr.slug);
    if (e) {
      e.material.uniformsNeedUpdate = true;
      this.quad.material = e.material;
      this.host.renderer.setRenderTarget(rt);
      this.host.renderer.render(this.quadScene, this.host.camera);
    }
    u[n.grid].value = rt.texture;
  }

  /** A group's state textures as its update shader (and anything else) reads them now. */
  private bindState(g: AgentGroupProgram, s: GroupState): void {
    const u = this.host.uniforms();
    const tex = s.rt[s.cur].textures;
    u[agentStateUniform(g.slug, 'A')].value = tex[0];
    u[agentStateUniform(g.slug, 'B')].value = tex[1];
    if (g.stateC && tex.length >= 4) {
      u[agentStateUniform(g.slug, 'C')].value = tex[2];
      u[agentStateUniform(g.slug, 'D')].value = tex[3];
      if (g.stateE && tex.length >= 5) u[agentStateUniform(g.slug, 'E')].value = tex[4];
    }
  }

  /**
   * A group's neighbour grid for this step (kit/agentPlan.js agNbLayout / agNbPasses): the count of
   * each cell (one additive point per live walker), then each slot (one point per walker not yet in
   * a slot of its cell; no blending, so the last drawn, the highest index, stays). Deterministic:
   * points are drawn in index order and blending 1s is exact.
   */
  private buildNeighbours(g: AgentGroupProgram, s: GroupState, aspect: number): void {
    const nb = g.neighbours!;
    const d3 = !!g.space3d;
    const { renderer } = this.host;
    let grid = this.nbGrids.get(g.slug);
    if (grid && grid.d3 !== d3) { this.dropNeighbours(g.slug); grid = undefined; }
    if (!grid) {
      const [tw, th] = agNbTile(d3);
      const opts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false } as const;
      const atlas = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(tw * AG_NB_SLOTS / 2, th, opts);
      grid = {
        d3, atlas: [atlas(), atlas()],
        // Half float counts: exact to 2048 walkers a cell (blending half floats needs no extension).
        count: new THREE.WebGLRenderTarget(tw, th, { ...opts, type: THREE.HalfFloatType, format: THREE.RedFormat }),
      };
      this.nbGrids.set(g.slug, grid);
    }
    const radius = Math.max(...nb.radius.map(r => this.read(r, 0.05)));
    const most = Math.max(...nb.max.map(m => this.read(m, 36)));
    const L = agNbLayout(d3, aspect, radius, most);
    const [tw, th] = agNbTile(d3);
    const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const rt of [...grid.atlas, grid.count]) { renderer.setRenderTarget(rt); renderer.clear(true, false, false); }
    renderer.setClearColor(prevColor, prevAlpha);
    const st = s.rt[s.cur];
    this.pointGeometry.setDrawRange(0, g.side * g.side);
    for (const ps of agNbPasses(d3, L.slots)) {
      const mat = ps.count ? this.nbCountMat : this.nbSlotMat;
      const nu = mat.uniforms;
      nu.u_a.value = st.textures[0]; nu.u_b.value = st.textures[1];
      nu.u_prev.value = ps.prevAtlas >= 0 ? grid.atlas[ps.prevAtlas].texture : null;
      nu.u_side.value = g.side; nu.u_d3.value = d3 ? 1 : 0;
      (nu.u_grid.value as THREE.Vector4).fromArray(L.uniform);
      (nu.u_pass.value as THREE.Vector4).set(ps.x, ps.prevX, ps.prevAtlas >= 0 ? 1 : 0, ps.count ? 1 : 0);
      (nu.u_target.value as THREE.Vector2).set(ps.count ? tw : tw * AG_NB_SLOTS / 2, th);
      mat.uniformsNeedUpdate = true;
      this.points.material = mat;
      renderer.setRenderTarget(ps.count ? grid.count : grid.atlas[ps.atlas]);
      renderer.render(this.pointScene, this.host.camera);
    }
    const u = this.host.uniforms();
    const n = agentNbUniforms(g.slug);
    u[n.a].value = grid.atlas[0].texture; u[n.b].value = grid.atlas[1].texture; u[n.n].value = grid.count.texture;
    (u[n.g].value as THREE.Vector4).fromArray(L.uniform);
  }

  private dropNeighbours(slug: string): void {
    const grid = this.nbGrids.get(slug);
    if (!grid) return;
    grid.atlas[0].dispose(); grid.atlas[1].dispose(); grid.count.dispose();
    this.nbGrids.delete(slug);
  }

  private pass(mat: THREE.RawShaderMaterial, into: THREE.WebGLRenderTarget): void {
    const { renderer } = this.host;
    mat.uniformsNeedUpdate = true;
    this.quad.material = mat;
    renderer.setRenderTarget(into);
    renderer.render(this.quadScene, this.host.camera);
  }

  /**
   * One step of listening for group g's listening nodes, before its rule runs at `time` (the step's
   * own clock): the Particles engine's code as it is. Sound from Mic or the Audio engine gives a
   * spectrum; otherwise the level is Level plus the stand-in Beat (Level is added to a spectrum too).
   */
  private hear(targets: AgentTargets, s: GroupState, g: AgentGroupProgram, time: number): void {
    const u = this.host.uniforms();
    for (const l of g.listeners) {
      const st = targets.listen(s, l.slug);
      const n = listenUniforms(l.slug);
      // What it hears this step (kit/agentPlan.js agHear, shared with web pages), into its uniforms.
      const r = agHear(st, l, this.reader, this.host.sound, time, s.step === 0);
      (u[n.sound].value as THREE.Vector4).fromArray(r.sound);
      if (l.kind === 'kick') {
        const sv = u[n.shocks].value as THREE.Vector4[];
        for (let i = 0; i < 4; i++) sv[i].fromArray(r.shocks!, i * 4);
        st.levelTex.needsUpdate = true;
        u[n.levels].value = st.levelTex;
        continue;
      }
      const mv = u[n.plateModes].value as THREE.Vector4[];
      for (let i = 0; i < 8; i++) mv[i].fromArray(r.modes!, i * 4);
      u[n.plateCount].value = r.count;
      u[n.plateShake].value = r.shake;
    }
  }

  private draw(s: DrawState, d: AgentDrawProgram, g: AgentGroupProgram, gs: GroupState, aspect: number, time: number): THREE.WebGLRenderTarget {
    const { renderer } = this.host;
    const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(s.acc);
    renderer.clear(true, false, false);
    renderer.setClearColor(prevColor, prevAlpha);
    const n = g.side * g.side;
    // The look (kit/agentPlan.js agDrawLook, shared with web pages): size, brightness, points or lines, colours.
    const look = agDrawLook(d, n, s.h, this.reader, this.colourReader);
    const { ink, lines } = look;
    const du = this.drawMat.uniforms;
    du.u_a.value = gs.rt[gs.cur].textures[0];
    du.u_b.value = gs.rt[gs.cur].textures[1];
    du.u_c.value = g.stateC ? gs.rt[gs.cur].textures[2] : null;
    du.u_stateC.value = g.stateC ? 1 : 0;
    du.u_side.value = g.side; du.u_species.value = g.species; du.u_aspect.value = aspect;
    du.u_colorBy.value = look.colorBy;
    du.u_size.value = look.size;
    du.u_bright.value = look.bright;
    du.u_speedRef.value = look.speedRef;
    du.u_prim.value = lines ? 1 : 0;
    du.u_thread.value = look.thread;
    du.u_ink.value = ink ? 1 : 0;
    du.u_fade.value = look.fade ? 1 : 0;
    du.u_usePal.value = look.usePal ? 1 : 0;
    du.u_rainbow.value = look.rainbow ? 1 : 0;
    if (look.pal) (du.u_pal.value as THREE.Vector3[]).forEach((v, i) => v.fromArray(look.pal![i]));
    (du.u_colA.value as THREE.Vector3).fromArray(look.colA);
    (du.u_colB.value as THREE.Vector3).fromArray(look.colB);
    (du.u_viewSize.value as THREE.Vector2).set(s.w, s.h);
    const lights = agLights(d, this.reader, this.colourReader, time, aspect);
    const setLights = (uu: Record<string, THREE.IUniform>) => {
      uu.u_lights.value = lights.length;
      (uu.u_light.value as THREE.Vector4[]).forEach((v, i) => { const l = lights[i]; if (l) v.set(l.x, l.y, l.reach, l.power); else v.set(0, 0, 1, 0); });
      (uu.u_lightCol.value as THREE.Vector3[]).forEach((v, i) => { const l = lights[i]; if (l) v.fromArray(l.colour); else v.set(0, 0, 0); });
    };
    setLights(du);
    this.drawMat.uniformsNeedUpdate = true;
    renderer.setRenderTarget(s.acc);
    if (lines) {
      this.pointGeometry.setDrawRange(0, 2 * n);
      renderer.render(this.lineScene, this.host.camera);
    } else {
      this.points.material = this.drawMat;
      this.pointGeometry.setDrawRange(0, n);
      renderer.render(this.pointScene, this.host.camera);
    }
    if (d.style === 'points') return s.acc;
    // The Particles node's glow, unchanged: ¼ and 1/16 copies, blurred, composed over the points
    // with the lights' halos (Ink: the absorbance turned into ink covering the paper).
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
    cu.u_glow.value = look.glow;
    cu.u_halo.value = look.halo;
    cu.u_ink.value = ink ? 1 : 0;
    setLights(cu);
    this.pass(this.composeMat, s.out);
    return s.out;
  }

  /**
   * A 3D Draw agents' look at a ray-marched scene (Camera from and Camera ray wired): the camera
   * probe read at the four points (its origin, and its rays at the centre, half a picture right and
   * half up) into a 4 × 1 texture the draw shader rebuilds the camera from (no read-back, no lag),
   * and the Depth wired at half the picture's size. Null until its programs have compiled.
   */
  private probe(targets: AgentTargets, s: DrawState, d: AgentDrawProgram): { cam: THREE.Texture; depth: THREE.Texture | null } | null {
    const cam = this.probes.find(e => e.slug === `${d.slug}:camera` && e.ready && !e.failed);
    if (!cam || !d.probe) return null;
    const depth = d.probe.depth ? this.probes.find(e => e.slug === `${d.slug}:depth` && e.ready && !e.failed) : undefined;
    targets.probeTargets(s, !!depth);
    const { renderer } = this.host;
    const pu = this.host.uniforms()[d.probe.uniform].value as THREE.Vector4;
    AG_PROBE_POINTS.forEach(([x, y, k], i) => {
      pu.set(x, y, k, 0);
      cam.material.uniformsNeedUpdate = true;
      s.cam!.viewport.set(i, 0, 1, 1);
      this.quad.material = cam.material;
      renderer.setRenderTarget(s.cam!);
      renderer.render(this.quadScene, this.host.camera);
    });
    s.cam!.viewport.set(0, 0, 4, 1);
    if (depth && s.depth) {
      depth.material.uniformsNeedUpdate = true;
      this.quad.material = depth.material;
      renderer.setRenderTarget(s.depth);
      renderer.render(this.quadScene, this.host.camera);
    }
    return { cam: s.cam!.texture, depth: depth && s.depth ? s.depth.texture : null };
  }

  /**
   * Draw agents in 3D (kit/agentShaders.js AG_DRAW3_VERT): the same look as in 2D, through the
   * built-in camera (kit/agentPlan.js agCamera3) or a scene's (`seen`), with depth of field; then
   * the same glow and compose, the lights' halos where they land through the camera.
   */
  private draw3(s: DrawState, d: AgentDrawProgram, g: AgentGroupProgram, gs: GroupState, aspect: number, time: number, seen: { cam: THREE.Texture; depth: THREE.Texture | null } | null): THREE.WebGLRenderTarget {
    const { renderer } = this.host;
    const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(s.acc);
    renderer.clear(true, false, false);
    renderer.setClearColor(prevColor, prevAlpha);
    const n = g.side * g.side;
    const look = agDrawLook(d, n, s.h, this.reader, this.colourReader);
    const cam = agCamera3(d, this.reader, time, s.h);
    const du = this.draw3Mat.uniforms;
    du.u_a.value = gs.rt[gs.cur].textures[0];
    du.u_b.value = gs.rt[gs.cur].textures[1];
    du.u_c.value = g.stateC ? gs.rt[gs.cur].textures[2] : null;
    du.u_stateC.value = g.stateC ? 1 : 0;
    du.u_side.value = g.side; du.u_species.value = g.species; du.u_aspect.value = aspect;
    du.u_colorBy.value = look.colorBy; du.u_size.value = look.size; du.u_bright.value = look.bright; du.u_speedRef.value = look.speedRef;
    du.u_thread.value = look.thread; du.u_ink.value = look.ink ? 1 : 0; du.u_fade.value = look.fade ? 1 : 0;
    du.u_usePal.value = look.usePal ? 1 : 0; du.u_rainbow.value = look.rainbow ? 1 : 0;
    if (look.pal) (du.u_pal.value as THREE.Vector3[]).forEach((v, i) => v.fromArray(look.pal![i]));
    (du.u_colA.value as THREE.Vector3).fromArray(look.colA);
    (du.u_colB.value as THREE.Vector3).fromArray(look.colB);
    (du.u_viewSize.value as THREE.Vector2).set(s.w, s.h);
    (du.u_eye.value as THREE.Vector3).fromArray(cam.eye); (du.u_fwd.value as THREE.Vector3).fromArray(cam.fwd);
    (du.u_right.value as THREE.Vector3).fromArray(cam.right); (du.u_up.value as THREE.Vector3).fromArray(cam.up);
    du.u_lens.value = cam.lens; du.u_ortho.value = seen ? 0 : cam.ortho; du.u_camDist.value = cam.dist;
    du.u_focus.value = seen ? cam.focusShare : cam.focus; du.u_coc.value = cam.coc; du.u_cap.value = cam.cap;
    du.u_camSrc.value = seen ? 1 : 0; du.u_cam.value = seen?.cam ?? null;
    du.u_depth.value = seen?.depth ? 1 : 0; du.u_field.value = seen?.depth ?? null;
    const lights = agLights(d, this.reader, this.colourReader, time, aspect);
    du.u_lights.value = lights.length;
    (du.u_light.value as THREE.Vector4[]).forEach((v, i) => { const l = lights[i]; if (l) v.set(l.x, l.y, l.reach, l.power); else v.set(0, 0, 1, 0); });
    (du.u_lightZ.value as THREE.Vector4).set(lights[0]?.z ?? 0, lights[1]?.z ?? 0, lights[2]?.z ?? 0, lights[3]?.z ?? 0);
    (du.u_lightCol.value as THREE.Vector3[]).forEach((v, i) => { const l = lights[i]; if (l) v.fromArray(l.colour); else v.set(0, 0, 0); });
    renderer.setRenderTarget(s.acc);
    const pass = (prim: 0 | 1) => {
      du.u_prim.value = prim;
      this.draw3Mat.uniformsNeedUpdate = true;
      if (prim === 1) {
        this.lines.material = this.draw3Mat;
        this.pointGeometry.setDrawRange(0, 2 * n);
        renderer.render(this.lineScene, this.host.camera);
        this.lines.material = this.drawMat;
      } else {
        this.points.material = this.draw3Mat;
        this.pointGeometry.setDrawRange(0, n);
        renderer.render(this.pointScene, this.host.camera);
      }
    };
    // Streaks: the blurred share as points, the sharp share as lines (the Particles node's 3D threads).
    pass(0);
    if (look.lines) pass(1);
    if (d.style === 'points') return s.acc;
    // The lights' halos where they land through the camera (a scene's camera is only on the GPU: no halos then).
    const halos = seen ? [] : lights.map(l => {
      const q = agProject3(cam, [l.x, l.y, l.z]);
      return q.depth <= 0.05 ? { ...l, power: 0 } : { ...l, x: q.x, y: q.y, reach: l.reach * cam.dist / q.depth };
    });
    return this.glowCompose(s, look, halos, aspect);
  }

  /** The Particles node's glow, unchanged, and the compose with the lights' halos (shared by the 2D and 3D draws). */
  private glowCompose(s: DrawState, look: { glow: number; halo: number; ink: boolean }, lights: Array<{ x: number; y: number; reach: number; power: number; colour: number[] }>, aspect: number): THREE.WebGLRenderTarget {
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
    cu.u_glow.value = look.glow;
    cu.u_halo.value = look.halo;
    cu.u_ink.value = look.ink ? 1 : 0;
    cu.u_lights.value = lights.length;
    (cu.u_light.value as THREE.Vector4[]).forEach((v, i) => { const l = lights[i]; if (l) v.set(l.x, l.y, l.reach, l.power); else v.set(0, 0, 1, 0); });
    (cu.u_lightCol.value as THREE.Vector3[]).forEach((v, i) => { const l = lights[i]; if (l) v.fromArray(l.colour); else v.set(0, 0, 0); });
    this.pass(this.composeMat, s.out);
    return s.out;
  }

  /** Thumbnails for the Trail and Agents group cards that are showing (the live runner, every few frames). */
  drawThumbnails(targets: AgentTargets): void {
    this.drawGroupDots(targets);
    const { renderer, camera } = this.host;
    for (const t of this.spec.trails) {
      const canvas = trailThumbRegistry.get(t.nodeId);
      if (!canvas) continue;
      const ts = targets.trails.get(t.slug);
      const W = 128, H = Math.max(8, Math.round(128 * (ts ? (ts.vol ? ts.vol.ny / ts.vol.nx : ts.h / ts.w) : 9 / 16)));
      if (!this.thumbRt || this.thumbRt.height !== H) {
        this.thumbRt?.dispose();
        this.thumbRt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
        this.thumbBuf = new Uint8Array(W * H * 4);
      }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      if (!ts) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); continue; }
      this.thumbMat.uniforms.t.value = (ts.proj ?? ts.rt[ts.cur]).texture;
      this.thumbMat.uniforms.g.value = this.read(t.params.gain, 0.15);
      this.thumbMat.uniformsNeedUpdate = true;
      renderer.setRenderTarget(this.thumbRt);
      renderer.render(this.thumbScene, camera);
      renderer.readRenderTargetPixels(this.thumbRt, 0, 0, W, H, this.thumbBuf!);
      renderer.setRenderTarget(null);
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(this.thumbBuf!.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      ctx.putImageData(img, 0, 0);
      canvas.dataset.size = ts.vol ? `${ts.vol.nx}×${ts.vol.ny}×${ts.vol.nz}` : `${ts.w}×${ts.h}`;
    }
  }

  /** The Agents group cards' thumbnails: where the walkers are now, as dots (a sample of at most THUMB_DOTS). */
  private drawGroupDots(targets: AgentTargets): void {
    const { renderer, camera } = this.host;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const async = typeof gl.fenceSync === 'function';
    for (const g of this.spec.groups) {
      const canvas = agentThumbRegistry.get(g.nodeId);
      if (!canvas) { this.dropDots(g.nodeId); continue; }
      const W = 160, H = Math.max(8, Math.round(W / Math.max(0.25, this.aspect)));
      let d = this.dotReads.get(g.nodeId);
      if (d && d.H !== H) { this.dropDots(g.nodeId); d = undefined; }
      if (!d) {
        d = { rt: new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false }), W, H, pbo: null, sync: null, buf: new Uint8Array(W * H * 4) };
        this.dotReads.set(g.nodeId, d);
      }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const gs = targets.groups.get(g.slug);
      if (!gs) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); continue; }
      const show = () => {
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) img.data.set(d!.buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        ctx.putImageData(img, 0, 0);
      };
      // A read started earlier: show it once the GPU is done; until then leave the card as it is.
      if (d.sync) {
        if (!this.finishRead(d)) continue;
        show();
      }
      const n = g.side * g.side;
      const stride = Math.max(1, Math.ceil(n / THUMB_DOTS));
      const du = this.dotsMat.uniforms;
      du.u_a.value = gs.rt[gs.cur].textures[0];
      du.u_b.value = gs.rt[gs.cur].textures[1];
      du.u_side.value = g.side; du.u_stride.value = stride; du.u_aspect.value = this.aspect;
      // Each dot as bright as an even spread over the thumbnail needs to read about 0.6: crowds saturate.
      du.u_gain.value = Math.min(1, Math.max(0.04, 0.6 * W * H / Math.max(1, Math.ceil(n / stride))));
      this.dotsMat.uniformsNeedUpdate = true;
      const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      const prevAuto = renderer.autoClear;
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(d.rt);
      renderer.clear(true, false, false);
      renderer.setClearColor(prevColor, prevAlpha);
      renderer.autoClear = false;
      this.pointGeometry.setDrawRange(0, Math.ceil(n / stride));
      renderer.render(this.dotsScene, camera);
      renderer.autoClear = prevAuto;
      if (async) {
        // Start the read into a pixel buffer; the next call picks it up (no wait for the GPU).
        this.startRead(d);
      } else {
        renderer.readRenderTargetPixels(d.rt, 0, 0, W, H, d.buf);
        show();
      }
      renderer.setRenderTarget(null);
      canvas.dataset.dots = String(Math.ceil(n / stride));
    }
    for (const id of [...this.dotReads.keys()]) if (!this.spec.groups.some(g => g.nodeId === id)) this.dropDots(id);
  }

  /** Lets a group card's dots go (its card is off screen, hidden, or the group is gone). */
  private dropDots(nodeId: string): void {
    const d = this.dotReads.get(nodeId);
    if (!d) return;
    this.freeRead(d);
    this.dotReads.delete(nodeId);
  }

  private freeRead(d: DotRead): void {
    const gl = this.host.renderer.getContext() as WebGL2RenderingContext;
    if (d.sync) gl.deleteSync(d.sync);
    if (d.pbo) gl.deleteBuffer(d.pbo);
    d.rt.dispose();
  }

  /** Starts a read of `d.rt` into its pixel buffer and fences it (WebGL2; picked up by finishRead). */
  private startRead(d: DotRead): void {
    const { renderer } = this.host;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const fb = (renderer.properties.get(d.rt) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer ?? null;
    if (!fb) return;
    if (!d.pbo) {
      d.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, d.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, d.buf.byteLength, gl.STREAM_READ);
    } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, d.pbo);
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.readPixels(0, 0, d.W, d.H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    d.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }

  /** A fenced read: false while the GPU is still at it; once done, its pixels are in `d.buf`. */
  private finishRead(d: DotRead): boolean {
    if (!d.sync) return false;
    const gl = this.host.renderer.getContext() as WebGL2RenderingContext;
    if (gl.getSyncParameter(d.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gl.deleteSync(d.sync); d.sync = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, d.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, d.buf);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return true;
  }

  /** Copies a read's pixels (bottom row first) into a canvas the same size. */
  private static blit(ctx: CanvasRenderingContext2D, d: DotRead): void {
    const { W, H } = d;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(d.buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
  }

  /** Lets a spotlight's target go. */
  private dropSpot(nodeId: string): void {
    const key = `spot:${nodeId}`;
    const d = this.spotReads.get(key);
    if (!d) return;
    this.freeRead(d);
    this.spotReads.delete(key);
  }

  /**
   * The Agent Builder's species spotlight (agentSpotRegistry): for each group with a canvas there, its
   * live walkers of `dataset.species` only (every k-th beyond SPOT_DOTS) as additive dots in
   * `dataset.colour` over black, SPOT_W wide in the picture's shape, read back without a stall (a frame
   * or more late). 2D: at (x / aspect, y), as the picture has them. 3D: through the group's first live
   * Draw agents camera at the last live run's time (a scene's camera when that Draw probes one), without
   * depth of field; a 3D group with no live Draw agents draws nothing and says `dataset.spot = 'flat'`.
   */
  drawSpotlights(targets: AgentTargets): void {
    const { renderer, camera } = this.host;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const async = typeof gl.fenceSync === 'function';
    for (const g of this.spec.groups) {
      const canvas = agentSpotRegistry.get(g.nodeId);
      if (!canvas) { this.dropSpot(g.nodeId); continue; }
      const key = `spot:${g.nodeId}`;
      const W = SPOT_W, H = Math.max(8, Math.round(W / Math.max(0.25, this.aspect)));
      let d = this.spotReads.get(key);
      if (d && d.H !== H) { this.dropSpot(g.nodeId); d = undefined; }
      if (!d) {
        d = { rt: new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false }), W, H, pbo: null, sync: null, buf: new Uint8Array(W * H * 4) };
        this.spotReads.set(key, d);
      }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const gs = targets.groups.get(g.slug);
      const view3 = g.space3d ? this.spec.draws.find(x => x.group === g.slug && x.live && x.space3d) : undefined;
      if (!gs || (g.space3d && !view3)) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        canvas.dataset.spot = gs ? 'flat' : 'none';
        canvas.dataset.dots = '0';
        continue;
      }
      // A read started earlier: show it once the GPU is done; until then leave the canvas as it is.
      if (d.sync) {
        if (!this.finishRead(d)) continue;
        AgentRunner.blit(ctx, d);
        canvas.dataset.spot = 'live';
      }
      const n = g.side * g.side;
      const stride = Math.max(1, Math.ceil(n / SPOT_DOTS));
      const drawn = Math.ceil(n / stride);
      // The Memory section's lens: ranges for the panel, and the walkers coloured by the memory being edited.
      const memLens = canvas.dataset.mem !== undefined;
      if (memLens) this.memoryRange(g, gs, canvas);
      const memSlot = memLens ? parseMemSlot(canvas.dataset.mem) : null;
      const only = parseSpotSpecies(canvas.dataset.species);
      const species = Math.max(1, g.species);
      const su = this.spotMat.uniforms;
      su.u_a.value = gs.rt[gs.cur].textures[0];
      su.u_b.value = gs.rt[gs.cur].textures[1];
      su.u_c.value = g.stateC ? gs.rt[gs.cur].textures[2] : null;
      su.u_stateC.value = g.stateC ? 1 : 0;
      su.u_side.value = g.side; su.u_stride.value = stride; su.u_species.value = species; su.u_only.value = only;
      su.u_aspect.value = this.aspect;
      (su.u_col.value as THREE.Vector3).fromArray(parseSpotColour(canvas.dataset.colour));
      // Each dot as bright as an even spread of that kind (about 1 / species of the walkers) needs to read
      // about 0.6: a crowd saturates, and a sparse kind still shows at 0.2 or more.
      const share = only >= 0 ? drawn / species : drawn;
      su.u_gain.value = Math.min(1, Math.max(0.2, 0.6 * W * H / Math.max(1, share * SPOT_PX * SPOT_PX)));
      su.u_deep.value = 0; su.u_camSrc.value = 0; su.u_cam.value = null;
      if (view3) {
        su.u_deep.value = 1;
        const ds = targets.draws.get(view3.slug);
        const cam = agCamera3(view3, this.reader, this.lastTime, ds?.h ?? H);
        (su.u_eye.value as THREE.Vector3).fromArray(cam.eye); (su.u_fwd.value as THREE.Vector3).fromArray(cam.fwd);
        (su.u_right.value as THREE.Vector3).fromArray(cam.right); (su.u_up.value as THREE.Vector3).fromArray(cam.up);
        su.u_lens.value = cam.lens; su.u_ortho.value = cam.ortho; su.u_camDist.value = cam.dist;
        // A scene's camera (its probe has run): the same rays the 3D draw used.
        const probed = !!view3.probe && !!ds?.cam && this.probes.some(e => e.slug === `${view3.slug}:camera` && e.ready && !e.failed);
        if (probed) { su.u_camSrc.value = 1; su.u_cam.value = ds!.cam!.texture; }
      }
      this.spotMat.uniformsNeedUpdate = true;
      if (memLens) {
        const mu = this.memMat.uniforms;
        for (const k of Object.keys(su)) if (mu[k] && k !== 'u_col') mu[k].value = su[k].value;
        mu.u_e.value = g.stateC && g.stateE ? gs.rt[gs.cur].textures[4] ?? null : null;
        mu.u_memSrc.value = memSlot?.src ?? 0; mu.u_memComp.value = memSlot?.comp ?? 0;
        const [lo, hi] = (canvas.dataset.memRange ?? '0,1').split(',').map(Number);
        mu.u_lo.value = Number.isFinite(lo) ? lo : 0; mu.u_hi.value = Number.isFinite(hi) ? hi : 1;
        mu.u_px.value = 3;
        this.memMat.uniformsNeedUpdate = true;
        this.spot.material = this.memMat;
      } else this.spot.material = this.spotMat;
      const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      const prevAuto = renderer.autoClear;
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(d.rt);
      renderer.clear(true, false, false);
      renderer.setClearColor(prevColor, prevAlpha);
      renderer.autoClear = false;
      this.pointGeometry.setDrawRange(0, memLens && !memSlot ? 0 : drawn);
      renderer.render(this.spotScene, camera);
      renderer.autoClear = prevAuto;
      if (async) this.startRead(d);
      else {
        renderer.readRenderTargetPixels(d.rt, 0, 0, W, H, d.buf);
        AgentRunner.blit(ctx, d);
        canvas.dataset.spot = 'live';
      }
      renderer.setRenderTarget(null);
      canvas.dataset.dots = String(drawn);
    }
    for (const k of [...this.spotReads.keys()]) {
      const id = k.slice('spot:'.length);
      if (!this.spec.groups.some(g => g.nodeId === id)) this.dropSpot(id);
    }
  }

  /**
   * The Memory section's live ranges: 4096 walkers sampled (agentMemoryGpu.ts MEM_RANGE_FRAG) a few
   * times a second, read back without a stall; each memory number's min / max over the live ones
   * goes on the canvas as `dataset.ranges` ('lo,hi;…' for Memory x, Memory y, E.x … E.w).
   */
  private memoryRange(g: AgentGroupProgram, gs: GroupState, canvas: HTMLCanvasElement): void {
    const { renderer } = this.host;
    if (!g.stateC) { canvas.dataset.ranges = ''; return; }
    let r = this.memRanges.get(g.nodeId);
    if (!r) {
      r = { rt: new THREE.WebGLRenderTarget(MEM_RANGE_N, 2 * MEM_RANGE_N, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false }), reader: gpReadback(renderer.getContext() as WebGL2RenderingContext), busy: false, last: null, at: 0 };
      this.memRanges.set(g.nodeId, r);
    }
    const px = r.reader.poll();
    if (px && px !== r.last) {
      r.last = px; r.busy = false;
      const d = decodeMemRanges(px);
      canvas.dataset.ranges = d ? d.map(([a, b]) => `${a},${b}`).join(';') : '';
    }
    const now = performance.now();
    if (r.busy || now - r.at < 250) return;
    r.at = now;
    const u = this.memRangeMat.uniforms, tex = gs.rt[gs.cur].textures;
    u.u_b.value = tex[1]; u.u_c.value = tex[2]; u.u_e.value = g.stateE ? tex[4] ?? null : null; u.u_hasE.value = g.stateE && tex[4] ? 1 : 0;
    u.u_side.value = g.side; u.u_stride.value = Math.max(1, Math.floor(g.side * g.side / (MEM_RANGE_N * MEM_RANGE_N)));
    this.pass(this.memRangeMat, r.rt);
    const fb = (renderer.properties.get(r.rt) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer ?? null;
    if (fb && r.reader.request(fb, MEM_RANGE_N, 2 * MEM_RANGE_N)) r.busy = true;
    renderer.setRenderTarget(null);
  }

  /**
   * A read-only view of one group's live state (by its node id), for looking at it, never for
   * changing it: its side and count, whether it keeps C and D, the copy of its state textures the
   * next step reads (what was drawn this frame), the trail its Deposit fills, and in 3D the camera
   * its first live Draw agents sees through. Frozen; it doesn't expose the targets or the ping-pong,
   * and asking changes nothing. Null before the group has state.
   */
  stateView(targets: AgentTargets, nodeId: string): AgentStateView | null {
    const g = this.spec.groups.find(x => x.nodeId === nodeId);
    const s = g && targets.groups.get(g.slug);
    if (!g || !s || s.side !== g.side) return null;
    const rt = s.rt[s.cur];
    const deps = this.spec.deposits.filter(d => d.group === g.slug);
    const dep = deps.find(d => d.what !== 'velocity') ?? deps[0];
    const ts = dep ? targets.trails.get(dep.trail) : undefined;
    const tp = dep ? this.spec.trails.find(t => t.slug === dep.trail) : undefined;
    const trail = ts && tp && dep
      ? Object.freeze({ nodeId: tp.nodeId, texture: (ts.proj ?? ts.rt[ts.cur]).texture, w: ts.vol ? ts.vol.nx : ts.w, h: ts.vol ? ts.vol.ny : ts.h, velocity: dep.what === 'velocity' })
      : null;
    let camera: AgentStateView['camera'] = null;
    const view3 = g.space3d ? this.spec.draws.find(x => x.group === g.slug && x.live && x.space3d) : undefined;
    if (view3) {
      const ds = targets.draws.get(view3.slug);
      const c = agCamera3(view3, this.reader, this.lastTime, ds?.h ?? 360);
      const probed = !!view3.probe && !!ds?.cam && this.probes.some(e => e.slug === `${view3.slug}:camera` && e.ready && !e.failed);
      camera = Object.freeze({ eye: [...c.eye], fwd: [...c.fwd], right: [...c.right], up: [...c.up], lens: c.lens, ortho: c.ortho, dist: c.dist, scene: probed ? ds!.cam!.texture : null });
    }
    return Object.freeze({
      nodeId, slug: g.slug, side: g.side, count: g.side * g.side, species: Math.max(1, g.species), stateC: !!g.stateC, d3: !!g.space3d,
      aspect: this.aspect, step: s.step,
      stateE: !!(g.stateC && g.stateE),
      textures: Object.freeze({ A: rt.textures[0], B: rt.textures[1], C: g.stateC ? rt.textures[2] : null, D: g.stateC ? rt.textures[3] : null, E: g.stateC && g.stateE ? rt.textures[4] ?? null : null }),
      trail, camera,
    });
  }

  // The Agent Builder's Under the hood (lib/agentHood.ts): loaded and made the first time one is open.
  private hood: AgentHoodGpu | null = null;
  private hoodLoading = false;
  private disposed = false;
  /** Whether the hood still holds targets (ShaderCanvas calls drawHood once more after the last one closes, to free them). */
  get hoodHeld(): boolean { return !!this.hood?.busy; }

  /**
   * The open Under the hood views: their colour-mapped thumbnails (a few times a second), one walker's
   * numbers, a click's nearest walker; all from stateView, all read back without a stall. Does nothing
   * (and loads nothing) while none is open.
   */
  drawHood(targets: AgentTargets): void {
    const reqs = hoodRequests();
    if (!this.hood) {
      if (!reqs.length || this.hoodLoading) return;
      this.hoodLoading = true;
      void import('./agentHoodGpu').then(m => {
        if (!this.disposed) { this.hood = new m.AgentHoodGpu(this.host.renderer, this.host.geometry, this.host.camera); pokeHood(); }
      }).finally(() => { this.hoodLoading = false; });
      return;
    }
    this.hood.frame(reqs, id => this.stateView(targets, id));
  }

  dispose(): void {
    this.disposed = true;
    this.hood?.dispose();
    this.hood = null;
    for (const e of this.steps) this.drop(e);
    for (const e of this.trailSteps) this.drop(e);
    for (const e of this.probes) this.drop(e);
    for (const e of this.gridPrograms) this.drop(e);
    this.trailSteps = [];
    this.probes = [];
    this.gridPrograms = [];
    const u = this.boundTo;
    if (u) {
      for (const g of this.spec.groups) for (const n of [agentStateUniform(g.slug, 'A'), agentStateUniform(g.slug, 'B'), agentStateUniform(g.slug, 'C'), agentStateUniform(g.slug, 'D'), agentStateUniform(g.slug, 'E')]) if (u[n]) u[n].value = null;
      for (const t of this.spec.trails) {
        if (u[trailUniform(t.slug)]) u[trailUniform(t.slug)].value = null;
        const n = trailStepUniforms(t.slug);
        if (u[n.src]) u[n.src].value = null;
      }
      for (const d of this.spec.draws) if (u[agentDrawUniform(d.slug)]) u[agentDrawUniform(d.slug)].value = null;
    }
    this.steps = [];
    for (const m of [this.depositMat, this.trailMat, this.drawMat, this.downMat, this.blurMat, this.composeMat, this.thumbMat, this.dotsMat, this.readMat, this.sumMat, this.placeholder, this.deposit3Mat, this.trail3Mat, this.proj3Mat, this.draw3Mat, this.nbCountMat, this.nbSlotMat]) m.dispose();
    for (const slug of [...this.nbGrids.keys()]) this.dropNeighbours(slug);
    for (const r of this.reads.values()) { for (const rt of r.rts) rt.dispose(); r.reader.dispose(); }
    this.reads.clear();
    for (const id of [...this.dotReads.keys()]) this.dropDots(id);
    for (const k of [...this.spotReads.keys()]) this.dropSpot(k.slice('spot:'.length));
    this.spotMat.dispose();
    this.memMat.dispose(); this.memRangeMat.dispose();
    for (const r of this.memRanges.values()) { r.rt.dispose(); r.reader.dispose(); }
    this.memRanges.clear();
    this.pointGeometry.dispose();
    this.thumbRt?.dispose();
    this.bessel?.dispose();
    if (u?.[AG_BESSEL_UNIFORM]) u[AG_BESSEL_UNIFORM].value = null;
    for (const k of stats.keys()) if (this.spec.groups.some(g => g.nodeId === k)) stats.delete(k);
  }
}

/** Most steps any group may run in one live frame (for tests and the docs). */
export const AGENT_MAX_LIVE_STEPS = AG_MAX_STEPS;
