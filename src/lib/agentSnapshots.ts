/**
 * agentSnapshots.ts — stepping the live agents (the Agent Builder's transport, docs/agent-builder.md
 * "Stepping"): the buttons' queue, and the live runner's snapshots for going back.
 *
 * The buttons (components/agentBuilder/AgentTransport.tsx) don't step anything themselves: they
 * queue ops (stepAgents, stepAgentsBack) and wake the preview; the live runner (lib/agentRunner.ts
 * run) works through them in its next frame, so a step is the same step the clock would run.
 *
 * While a transport is open (armAgentStepping) the runner keeps a snapshot before every frame that
 * steps (a played frame, or a step forward): each group's state textures (copied on the GPU,
 * texel for texel) and its schedule (step, births, Burst edges, what its listeners heard), and each
 * trail's texture. Back puts back the newest one at or before the step wanted and runs the steps
 * between again (deterministic: the same state), so back is one step even into played frames. The ring is bounded by agentBuilder/stepRun.ts
 * (BACK_MAX snapshots, BACK_BUDGET bytes), and nothing is copied while no transport is open.
 */
import * as THREE from 'three';
import { AG_FULL_VERT } from '../play/kit/agentShaders.js';
import { agPrerollSteps, type AgGroupState, type AgListenState } from '../play/kit/agentPlan.js';
import { SnapshotRing, backReach, nextBatch, planBack, type StepOp } from '../agentBuilder/stepRun';
import { wakePreview } from './previewMirror';

type RT = THREE.WebGLRenderTarget;

// ── The buttons' side ──

let ops: StepOp[] = [];
let armed = 0;

export interface AgentStepInfo {
  /** Snapshots kept now: steps back on offer. */
  kept: number;
  /** How many snapshots of this size fit the budget. */
  reach: number;
  /** The step of the oldest snapshot (as far back as you can go), or null. */
  first: number | null;
  /** Ops still waiting for a frame. */
  pending: number;
}
let info: AgentStepInfo = { kept: 0, reach: 0, first: null, pending: 0 };
const listeners = new Set<() => void>();
function publish(next: AgentStepInfo): void {
  if (next.kept === info.kept && next.reach === info.reach && next.first === info.first && next.pending === info.pending) return;
  info = next;
  for (const l of listeners) l();
}

/** A transport is open: the live runner keeps snapshots. Returns the close (the snapshots go with the last one). */
export function armAgentStepping(): () => void {
  armed++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    armed = Math.max(0, armed - 1);
    if (!armed) { ops = []; wakePreview(); }
  };
}
export const agentSteppingArmed = (): boolean => armed > 0;

/** n steps forward (each group one fixed step each), at the next frame. */
export function stepAgents(n = 1): void {
  if (!armed || n <= 0) return;
  ops.push({ forward: n });
  publish({ ...info, pending: ops.length });
  wakePreview();
}

/** One snapshot back, at the next frame. */
export function stepAgentsBack(): void {
  if (!armed) return;
  ops.push({ back: true });
  publish({ ...info, pending: ops.length });
  wakePreview();
}

/**
 * A true reset (lib/runtimeReset.ts): steps still queued are dropped, and the bar shows nothing to go
 * back to (the runner clears its snapshots: AgentSnapshots.startedOver).
 */
export function forgetAgentSteps(): void {
  ops = [];
  publish({ ...info, kept: 0, first: null, pending: 0 });
}

export const agentStepInfo = (): AgentStepInfo => info;
export function onAgentStepInfo(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

// ── The runner's side ──

/** The parts of the runner's live state a snapshot copies (lib/agentRunner.ts GroupState, TrailState). */
interface LiveListen extends AgListenState { levelTex: THREE.DataTexture }
export interface SnapGroupState extends AgGroupState<LiveListen> { key: string; rt: [RT, RT]; cur: 0 | 1 }
export interface SnapTrailState { key: string; rt: [RT, RT]; cur: 0 | 1 }
export interface SnapTargets { groups: Map<string, SnapGroupState>; trails: Map<string, SnapTrailState> }

interface GroupCpu {
  step: number; born: number; lastTarget: number; burstPending: boolean; burstEdge: Record<string, number>;
  history: Array<[number, number]>; live: AgGroupState['live']; listen: Array<[string, AgListenState]>;
}
interface Snap {
  targets: SnapTargets;
  groups: Map<string, { key: string; rt: RT; cpu: GroupCpu }>;
  trails: Map<string, { key: string; rt: RT }>;
}

const texelBytes = (t: THREE.Texture) => (t.type === THREE.FloatType ? 16 : t.type === THREE.HalfFloatType ? 8 : 4);
const rtBytes = (rt: RT) => rt.width * rt.height * rt.textures.length * texelBytes(rt.texture);
const poolKey = (rt: RT) => `${rt.width}x${rt.height}:${rt.texture.type}:${rt.textures.length}`;

function cloneListen(l: AgListenState): AgListenState | null {
  try { return structuredClone({ sound: l.sound, levels: l.levels, shocks: l.shocks, plate: l.plate }); } catch { return null; }
}

/** One copy pass for render targets of n textures: texel for texel (texelFetch: no filtering, exact). */
function copyFrag(n: number): string {
  const decl = Array.from({ length: n }, (_, i) => `uniform highp sampler2D u_t${i};\nlayout(location = ${i}) out vec4 o${i};`).join('\n');
  const body = Array.from({ length: n }, (_, i) => `  o${i} = texelFetch(u_t${i}, p, 0);`).join('\n');
  return `precision highp float;\nprecision highp int;\n${decl}\nvoid main() {\n  ivec2 p = ivec2(gl_FragCoord.xy);\n${body}\n}`;
}

export interface SnapshotHost { renderer: THREE.WebGLRenderer; geometry: THREE.BufferGeometry; camera: THREE.Camera }

/**
 * The live runner's snapshots. `frame()` is called at the top of a live run (works through the
 * ops: backs restore now, forward steps are returned for the plan); `keep()` before the frame's
 * steps; `settle()` after a restore and after steps by hand.
 */
export class AgentSnapshots {
  private host: SnapshotHost;
  private ring: SnapshotRing<Snap>;
  private pool = new Map<string, RT[]>();
  private mats = new Map<number, THREE.RawShaderMaterial>();
  private scene = new THREE.Scene();
  private quad: THREE.Mesh;
  private lastBytes = 0;

  constructor(host: SnapshotHost) {
    this.host = host;
    this.quad = new THREE.Mesh(host.geometry, new THREE.MeshBasicMaterial());
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.ring = new SnapshotRing<Snap>(s => this.free(s));
  }

  get size(): number { return this.ring.size; }

  private mat(n: number): THREE.RawShaderMaterial {
    let m = this.mats.get(n);
    if (!m) {
      const uniforms: Record<string, THREE.IUniform> = {};
      for (let i = 0; i < n; i++) uniforms[`u_t${i}`] = { value: null };
      m = new THREE.RawShaderMaterial({ vertexShader: AG_FULL_VERT, fragmentShader: copyFrag(n), uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
      this.mats.set(n, m);
    }
    return m;
  }

  /** Every texture of `src` into `dst` (the same size and count). */
  private copy(src: RT, dst: RT): void {
    const { renderer, camera } = this.host;
    const n = src.textures.length;
    const m = this.mat(n);
    for (let i = 0; i < n; i++) m.uniforms[`u_t${i}`].value = src.textures[i];
    m.uniformsNeedUpdate = true;
    this.quad.material = m;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(dst);
    renderer.render(this.scene, camera);
    renderer.autoClear = prevAuto;
  }

  /** A target like `like` (from the pool when one is free). */
  private take(like: RT): RT {
    const free = this.pool.get(poolKey(like));
    const got = free?.pop();
    if (got) return got;
    return new THREE.WebGLRenderTarget(like.width, like.height, {
      type: like.texture.type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false, count: like.textures.length,
    });
  }

  private free(s: Snap): void {
    const give = (rt: RT) => {
      const k = poolKey(rt);
      const list = this.pool.get(k) ?? [];
      // A couple spare of each kind is enough to reuse as the ring turns over.
      if (list.length < 2) { list.push(rt); this.pool.set(k, list); } else rt.dispose();
    };
    for (const g of s.groups.values()) give(g.rt);
    for (const t of s.trails.values()) give(t.rt);
    s.groups.clear(); s.trails.clear();
  }

  /** A snapshot of the state now, kept. `step`: the step shown (the builder's group's, or the first group's). */
  keep(targets: SnapTargets, step: number): void {
    const snap: Snap = { targets, groups: new Map(), trails: new Map() };
    let bytes = 0;
    for (const [slug, s] of targets.groups) {
      const src = s.rt[s.cur];
      const rt = this.take(src);
      this.copy(src, rt);
      bytes += rtBytes(rt);
      snap.groups.set(slug, {
        key: s.key, rt,
        cpu: {
          step: s.step, born: s.born, lastTarget: s.lastTarget, burstPending: s.burstPending, burstEdge: { ...s.burstEdge },
          history: s.history.map(h => [h[0], h[1]] as [number, number]), live: { ...s.live },
          listen: [...s.listen].flatMap(([k, l]) => { const c = cloneListen(l); return c ? [[k, c] as [string, AgListenState]] : []; }),
        },
      });
    }
    for (const [slug, t] of targets.trails) {
      const src = t.rt[t.cur];
      const rt = this.take(src);
      this.copy(src, rt);
      bytes += rtBytes(rt);
      snap.trails.set(slug, { key: t.key, rt });
    }
    this.host.renderer.setRenderTarget(null);
    this.lastBytes = bytes;
    this.ring.push(snap, bytes, step);
  }

  /** Puts the newest snapshot back; false when there is none (or it was of other targets). */
  /**
   * `backs` steps back from step `now` (agentBuilder/stepRun.ts planBack): the snapshot at or before
   * the step wanted put back. Returns the steps to run after it to land on that step, or null.
   */
  private restore(targets: SnapTargets, now: number, backs: number): number | null {
    const p = planBack(this.ring, now, backs);
    if (!p) return null;
    const snap = p.kept.state;
    if (snap.targets !== targets) { if (p.popped) this.ring.free(snap); this.ring.clear(); return null; }
    for (const [slug, g] of snap.groups) {
      const s = targets.groups.get(slug);
      // A group whose count or state changed since has other textures: it stays as it is.
      if (!s || s.key !== g.key) continue;
      this.copy(g.rt, s.rt[s.cur]);
      const c = g.cpu;
      s.step = c.step; s.born = c.born; s.lastTarget = c.lastTarget; s.burstPending = c.burstPending;
      s.burstEdge = { ...c.burstEdge };
      s.history.length = 0; for (const h of c.history) s.history.push([h[0], h[1]]);
      s.live = { ...c.live };
      for (const [name, saved] of c.listen) {
        const l = s.listen.get(name);
        const fresh = l && cloneListen(saved);
        if (!l || !fresh) continue;
        l.sound = fresh.sound; l.shocks = fresh.shocks; l.plate = fresh.plate;
        // The level history texture reads this very array: refill it in place.
        l.levels.levels.set(fresh.levels.levels); l.levels.carry = fresh.levels.carry;
        l.levelTex.needsUpdate = true;
      }
    }
    for (const [slug, t] of snap.trails) {
      const s = targets.trails.get(slug);
      if (!s || s.key !== t.key) continue;
      this.copy(t.rt, s.rt[s.cur]);
    }
    this.host.renderer.setRenderTarget(null);
    if (p.popped) this.ring.free(snap);
    return p.replay;
  }

  /**
   * The top of a live frame at step `now`: the backs at the head of the queue (one restore for all,
   * and `replay` steps to run after it, without a snapshot), or else the forward steps up to the next
   * back (a snapshot before them). The rest wait for the next frame (`more`). After a restore
   * (`restored`) the caller re-anchors the clock (settle()) before planning the frame.
   */
  frame(targets: SnapTargets, now: number): { forward: number; replay: number; restored: boolean; more: boolean } {
    if (!armed) {
      if (this.ring.size) this.ring.clear();
      this.publish();
      return { forward: 0, replay: 0, restored: false, more: false };
    }
    const b = nextBatch(ops);
    ops = b.rest;
    const replay = b.backs ? this.restore(targets, now, b.backs) : null;
    this.publish();
    return { forward: b.forward, replay: replay ?? 0, restored: replay !== null, more: ops.length > 0 };
  }

  /** The run started over (↺, the clock went back): the snapshots are of another run. */
  startedOver(): void { if (this.ring.size) { this.ring.clear(); this.publish(); } }

  /**
   * After steps by hand or a restore, the live clock carries on from here: each group's schedule is
   * re-anchored at the clock now, so playing again doesn't catch up (or wait for) the steps moved.
   */
  settle(targets: SnapTargets, time: number, preroll: (slug: string) => number): void {
    for (const [slug, s] of targets.groups) {
      if (!isFinite(s.live.anchorTime)) continue;
      s.live.anchorTime = time;
      s.live.anchorStep = s.step - agPrerollSteps(preroll(slug));
      s.live.step = s.step;
      s.live.lastTime = time;
      s.lastTarget = s.step;
    }
    this.publish();
  }

  publish(): void {
    publish({ kept: this.ring.size, reach: armed ? backReach(this.lastBytes) : 0, first: this.ring.firstStep, pending: ops.length });
  }

  dispose(): void {
    this.ring.clear();
    for (const list of this.pool.values()) for (const rt of list) rt.dispose();
    this.pool.clear();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    (this.quad.material as THREE.Material).dispose();
    this.publish();
  }
}
