/**
 * engine.ts — every Splat Scene node's scan, loaded, sorted and drawn before the picture (docs/splat-scene.md).
 *
 *  - `sync(nodes)`: on every graph change. Each top-level Splat Scene gets a slot; a new file (params.videoId) is read
 *    from the library and handed to the worker (parse, GPU layout, thumbnail); Max splats / SH degree lay it out again.
 *  - `setPrograms(probes, vertexShader)`: after each compile, each node's probe program (compiler/splatGraph.ts).
 *  - `beforeFrame(ctx)`: before the picture's programs (ShaderCanvas). Each slot draws its probe and its splats into
 *    its two targets (bound as the node's `::color` and `::depth` textures). When the probe's numbers come back and
 *    the camera (or the scan) has turned, the worker sorts again; the new order is drawn when it arrives. Nothing is
 *    read back while the uniforms the probe (and a moving modifier) read are as they were at the last read
 *    (uniformPrint.ts): a still camera over a still scan costs no readback and no sort.
 *  - `settle(ctx)`: offline renders: the probe read at once and a sort waited for, so every exported frame is in order.
 */
import * as THREE from 'three';
import type { GraphNode } from '../../types/nodeGraph';
import type { SplatModifierProgram, SplatProbeProgram } from '../../compiler/types';
import { SPLAT_PIVOT_UNIFORM, SPLAT_SCENE_TYPE, splatFileOf, splatMaxOf, splatScaleOf, splatShOf, splatSortOf } from '../../nodes/definitions/splatScene';
import { SplatPass, type ProbeReading } from './render';
import { dropSplats, loadSplats, repackSplats, sortKeptSplats, sortSplatDepths } from './client';
import { getSplatFile } from './library';
import { setVideoThumb } from '../backgroundLibrary';
import { sortAxis } from './math';
import { uniformsPrint, usedUniforms } from './uniformPrint';
import type { PackedSplats, SplatInfo } from './pack';
import { THUMB_H, THUMB_W } from './workerCore';
import { DEMO_KINDS, demoBlob, demoRings } from './demo';
import { writeSplat } from './format';

/**
 * The scan's middle (its own coordinates) for the probe about to draw: what a Splat Scene turns and scales about
 * (splatScene.ts SPLAT_PIVOT_UNIFORM). One uniform for every probe, set before each one draws; in the table before
 * the probe's material is made, so three.js uploads it. Before the file is read: the origin.
 */
export function setPivot(uniforms: Record<string, THREE.IUniform>, center: readonly number[] | undefined): void {
  const u = uniforms[SPLAT_PIVOT_UNIFORM] ?? (uniforms[SPLAT_PIVOT_UNIFORM] = { value: new THREE.Vector3() });
  (u.value as THREE.Vector3).set(center?.[0] ?? 0, center?.[1] ?? 0, center?.[2] ?? 0);
}

/**
 * A generated scan instead of a file (params.demo = 'rings' or 'blob', params.demoCount): the example graphs', and
 * for timing.
 * Its key is `demo:<kind>:<count>`.
 */
export function demoKeyOf(node: GraphNode): string {
  const kind = node.params.demo;
  if (!(DEMO_KINDS as readonly unknown[]).includes(kind)) return '';
  const c = Math.max(1, Math.min(8_000_000, Math.floor(Number(node.params.demoCount) || 60000)));
  return `demo:${kind}:${c}`;
}

export type SplatState = 'empty' | 'loading' | 'ready' | 'missing' | 'error' | 'nested';

export interface SplatStatus {
  state: SplatState;
  message?: string;
  fileName?: string;
  bytes?: number;
  info?: SplatInfo;
  /** Splats drawn (after Max splats). */
  drawn: number;
  shDegree: number;
  parseMs?: number;
  sortMs?: number;
  sorts: number;
  /** A small picture of the scan (data URL). */
  thumb?: string;
  /** Its Modifier is wired but this GPU can't draw into float textures: the scan draws unmodified. */
  modifierRefused?: boolean;
}

export interface SplatHost {
  setTexture(key: string, tex: THREE.Texture | null): void;
  requestRender(): void;
}

export interface SplatFrame {
  renderer: THREE.WebGLRenderer;
  uniforms: Record<string, THREE.IUniform>;
  width: number;
  height: number;
}

interface Slot {
  node: GraphNode;
  status: SplatStatus;
  file: string;
  layout: string;
  gen: number;
  pass: SplatPass | null;
  packed: PackedSplats | null;
  order: Uint32Array | null;
  sortBusy: boolean;
  /** The axis the current order was sorted along (scan space), and the readings count it came from. */
  sortedAxis: [number, number, number] | null;
  readingsSeen: number;
  /** Modifiers moving the splats: a fingerprint of the depths the last moved sort used (NaN: none yet). */
  movedSum: number;
  /**
   * The print of the uniforms the probe read at its last read started (uniformPrint.ts), and the probe's and the
   * modifier's at the last depth read. Undefined: none yet; null: no print (it reads a texture), read every frame.
   */
  probePrint?: string | null;
  movedPrint?: string | null;
}

const idle = (): SplatStatus => ({ state: 'empty', drawn: 0, shDegree: 0, sorts: 0 });

/** Sort again once the view has turned more than this (cosine of 0.25°). */
const RESORT_COS = Math.cos((0.25 * Math.PI) / 180);

/** The scan-space sort axis from a probe reading: Mᵀ · forward (math.ts sortAxis), normalised. */
export function axisFromReading(r: ProbeReading): [number, number, number] | null {
  const f = [r[4], r[5], r[6]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  if (!(fl > 1e-9) || !r.every(Number.isFinite)) return null;
  const m = [r[16], r[17], r[18], 0, r[20], r[21], r[22], 0, r[24], r[25], r[26], 0, r[28], r[29], r[30], 1];
  const a = sortAxis(m, [f[0] / fl, f[1] / fl, f[2] / fl]);
  const al = Math.hypot(a[0], a[1], a[2]);
  return al > 1e-12 ? [a[0] / al, a[1] / al, a[2] / al] : null;
}

/**
 * Should the scan be sorted again (the view turned past RESORT_COS, or with Sort: every frame, turned at all)? A view
 * that hasn't turned is never sorted again: the order would be the same.
 */
export function needsResort(prev: readonly number[] | null, next: readonly number[], everyFrame: boolean): boolean {
  if (!prev) return true;
  if (everyFrame) return prev[0] !== next[0] || prev[1] !== next[1] || prev[2] !== next[2];
  return prev[0] * next[0] + prev[1] * next[1] + prev[2] * next[2] < RESORT_COS;
}

/** Does the modifier move splats now (always, or one of its gates, Explode's Amount or Wave's Amplitude, is non-zero)? */
export function modifierMoves(mod: SplatModifierProgram | undefined, uniforms: Record<string, { value: unknown }>): boolean {
  if (!mod) return false;
  if (mod.moves.always) return true;
  return mod.moves.gates.some(g => { const v = Number(uniforms[g]?.value); return Number.isFinite(v) && v !== 0; });
}

/**
 * A cheap fingerprint of the moved splats' depths (about 4096 of them), so a still scan seen from a still camera isn't
 * sorted again. The depths are measured from the camera, so a turn of the view changes them too.
 */
export function movedSum(depths: Float32Array, count: number): number {
  const step = Math.max(1, Math.floor(count / 4096));
  let s = 0;
  for (let i = 0; i < count; i += step) s += depths[i] * (1 + (i % 13) * 0.071);
  return s;
}

/** Top-level Splat Scene nodes (the probe is made for those); nested ones are listed apart. */
export function splatNodesIn(nodes: readonly GraphNode[]): { top: GraphNode[]; nested: GraphNode[] } {
  const top = nodes.filter(n => n.type === SPLAT_SCENE_TYPE);
  const nested: GraphNode[] = [];
  const walk = (list: readonly GraphNode[]) => {
    for (const n of list) {
      const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes?.length) { for (const m of sg.nodes) if (m.type === SPLAT_SCENE_TYPE) nested.push(m); walk(sg.nodes); }
    }
  };
  walk(nodes);
  return { top, nested };
}

function thumbUrl(px: Uint8ClampedArray): string | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    c.width = THUMB_W; c.height = THUMB_H;
    const g = c.getContext('2d');
    if (!g) return undefined;
    g.putImageData(new ImageData(new Uint8ClampedArray(px), THUMB_W, THUMB_H), 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return undefined; }
}

class SplatEngine {
  private host: SplatHost | null = null;
  private slots = new Map<string, Slot>();
  private probes = new Map<string, SplatProbeProgram>();
  private vertexShader = '';
  private listeners = new Set<() => void>();
  private nested = new Set<string>();

  setHost(host: SplatHost | null): void {
    this.host = host;
    if (host) for (const [id, s] of this.slots) this.bind(id, s);
  }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  status(nodeId: string): SplatStatus {
    if (this.nested.has(nodeId)) return { ...idle(), state: 'nested', message: 'A Splat Scene draws only at the top level of the graph, not inside a group.' };
    return this.slots.get(nodeId)?.status ?? idle();
  }

  /** Any slot with something to draw (ShaderCanvas skips beforeFrame otherwise). */
  wants(): boolean {
    for (const s of this.slots.values()) if (s.packed || s.pass) return true;
    return false;
  }

  /** A sort is on its way: keep drawing until it lands. */
  busy(): boolean {
    // A read of moved centres on its way counts too (it lands on the next frame drawn).
    for (const s of this.slots.values()) if (s.sortBusy || s.status.state === 'loading' || s.pass?.movedPending) return true;
    return false;
  }

  sync(nodes: readonly GraphNode[]): void {
    const { top, nested } = splatNodesIn(nodes);
    const nestedNow = new Set(nested.map(n => n.id));
    if (nestedNow.size !== this.nested.size || [...nestedNow].some(id => !this.nested.has(id))) { this.nested = nestedNow; this.changed(); }
    const want = new Map(top.map(n => [n.id, n]));
    for (const [id, s] of this.slots) if (!want.has(id)) this.drop(id, s);
    for (const [id, n] of want) {
      let s = this.slots.get(id);
      if (!s) {
        s = { node: n, status: idle(), file: '', layout: '', gen: 0, pass: null, packed: null, order: null, sortBusy: false, sortedAxis: null, readingsSeen: 0, movedSum: NaN };
        this.slots.set(id, s);
      }
      s.node = n;
      const file = splatFileOf(n) || demoKeyOf(n);
      const layout = `${splatMaxOf(n)}|${splatShOf(n)}`;
      if (file !== s.file) { s.file = file; s.layout = layout; void this.load(id, s); }
      else if (layout !== s.layout && s.status.state === 'ready') { s.layout = layout; void this.repack(id, s); }
    }
  }

  setPrograms(probes: readonly SplatProbeProgram[] | null, vertexShader: string): void {
    this.probes = new Map((probes ?? []).map(p => [p.nodeId, p]));
    this.vertexShader = vertexShader;
    this.host?.requestRender();
  }

  private async load(id: string, s: Slot): Promise<void> {
    const gen = ++s.gen;
    const name = typeof s.node.params.fileName === 'string' ? s.node.params.fileName : '';
    s.packed = null; s.order = null; s.sortedAxis = null; s.movedPrint = undefined;
    void dropSplats(id);
    if (!s.file) { s.status = idle(); this.changed(); this.host?.requestRender(); return; }
    s.status = { ...idle(), state: 'loading', fileName: name, message: 'Reading the scan…' };
    this.changed();
    try {
      const demo = /^demo:(rings|blob):(\d+)$/.exec(s.file);
      const f = demo
        ? (() => {
          const count = Number(demo[2]);
          const b = writeSplat(demo[1] === 'blob' ? demoBlob(count) : demoRings(count));
          return { name: `Generated ${demo[1] === 'blob' ? 'ball' : 'rings'} (${count.toLocaleString()}).splat`, bytes: b.byteLength, blob: new Blob([b.buffer as ArrayBuffer]) };
        })()
        : await getSplatFile(s.file);
      if (s.gen !== gen) return;
      if (!f) { s.status = { ...idle(), state: 'missing', fileName: name, message: `The scan${name ? ` “${name}”` : ''} isn’t on this device. Load it again (or open the .play file that carries it).` }; this.changed(); return; }
      s.status = { ...s.status, fileName: f.name, bytes: f.bytes };
      this.changed();
      const bytes = await f.blob.arrayBuffer();
      if (s.gen !== gen) return;
      const r = await loadSplats(id, bytes, f.name, splatMaxOf(s.node), splatShOf(s.node));
      if (s.gen !== gen) return;
      const thumb = thumbUrl(r.thumb);
      s.packed = r.packed;
      s.status = { state: 'ready', fileName: f.name, bytes: f.bytes, info: r.info, drawn: r.packed.count, shDegree: r.packed.shDegree, parseMs: r.parseMs, sorts: 0, thumb };
      if (s.pass) s.pass.setSplats(r.packed);
      if (thumb && !demo) void setVideoThumb(s.file, thumb).catch(() => {});
      this.changed();
      this.host?.requestRender();
    } catch (e) {
      if (s.gen !== gen) return;
      s.status = { ...idle(), state: 'error', fileName: name, message: e instanceof Error ? e.message : String(e) };
      this.changed();
    }
  }

  private async repack(id: string, s: Slot): Promise<void> {
    const gen = s.gen;
    try {
      const r = await repackSplats(id, splatMaxOf(s.node), splatShOf(s.node));
      if (s.gen !== gen) return;
      s.packed = r.packed; s.order = null; s.sortedAxis = null; s.movedPrint = undefined;
      s.pass?.setSplats(r.packed);
      s.status = { ...s.status, drawn: r.packed.count, shDegree: r.packed.shDegree };
      this.changed();
      this.host?.requestRender();
    } catch (e) {
      // The worker lost it (reloaded): read the file again.
      if (s.gen === gen) { console.warn('[splats] repack', e); void this.load(id, s); }
    }
  }

  private bind(id: string, s: Slot): void {
    if (!s.pass) return;
    this.host?.setTexture(`${id}::color`, s.pass.target.textures[0]);
    this.host?.setTexture(`${id}::depth`, s.pass.target.textures[1]);
  }

  private ensurePass(id: string, s: Slot, renderer: THREE.WebGLRenderer): SplatPass {
    if (s.pass) return s.pass;
    s.pass = new SplatPass(renderer);
    if (s.packed) s.pass.setSplats(s.packed);
    if (s.order) s.pass.setOrder(s.order);
    this.bind(id, s);
    return s.pass;
  }

  /** Draw every scan for this frame (before the picture's programs). */
  beforeFrame(ctx: SplatFrame): void {
    for (const [id, s] of this.slots) {
      const probe = this.probes.get(id);
      if (!probe) continue;
      const pass = this.ensurePass(id, s, ctx.renderer);
      setPivot(ctx.uniforms, s.status.info?.center);
      pass.setProbe(this.vertexShader, probe.fragmentShader, ctx.uniforms);
      this.setModifier(s, pass, probe, ctx.uniforms);
      const k = splatScaleOf(s.node);
      // The probe's numbers are read back only when what it reads has changed since the last read (or it reads a
      // texture, which has no print): a still camera reads nothing back while a slider that doesn't move it is dragged.
      const print = uniformsPrint(usedUniforms(probe.fragmentShader), ctx.uniforms);
      const read = print === null || print !== s.probePrint || !pass.reading;
      if (pass.draw(Math.max(1, Math.round(ctx.width * k)), Math.max(1, Math.round(ctx.height * k)), read)) s.probePrint = print;
      const fresh = pass.readings !== s.readingsSeen && !!pass.reading;
      if (fresh) s.readingsSeen = pass.readings;
      // A read on its way lands on a later frame: draw one even with the clock paused (the last turn of a slider). Not
      // for a probe without a print, which reads every frame drawn (that would keep a paused preview drawing).
      if (pass.probePending && print !== null) this.host?.requestRender();
      // Modifiers moving the splats: sort by the moved centres (read back from the GPU) instead.
      if (pass.hasModifier() && modifierMoves(probe.modifier, ctx.uniforms)) this.sortMovedFrame(id, s, pass, this.movedPrintOf(pass, probe.modifier!, ctx.uniforms));
      // A new reading, or no order for this view yet (a new scan, after a moved sort): sort if the view needs it.
      else if (pass.reading && (fresh || !s.sortedAxis)) this.maybeSort(id, s, pass.reading);
    }
  }

  private setModifier(s: Slot, pass: SplatPass, probe: SplatProbeProgram, uniforms: Record<string, THREE.IUniform>): void {
    const mod = probe.modifier;
    pass.setBox(s.status.info?.center, s.status.info?.radius);
    pass.setModifier(this.vertexShader, mod?.fragmentShader ?? null, uniforms, mod?.uniforms ?? null);
    const refused = pass.modifierRefused;
    if (refused !== !!s.status.modifierRefused) { s.status = { ...s.status, modifierRefused: refused }; this.changed(); }
  }

  /**
   * One frame of sorting moved splats: when last frame's read of their depths (worked out on the GPU from the moved
   * centres) has landed, sort them unless nothing changed, else start a read. One read or sort at a time, so it runs
   * as fast as the worker sorts and stops when the scan and the camera are still.
   */
  private sortMovedFrame(id: string, s: Slot, pass: SplatPass, print: string | null): void {
    if (s.status.state !== 'ready' || !s.packed) return;
    const got = pass.pollDepths();
    if (!got) {
      // Nothing the modifier or the camera reads has changed since the last read: the depths are the same.
      const same = print !== null && print === s.movedPrint;
      if (!pass.movedPending && !s.sortBusy && !same && pass.startDepthRead()) s.movedPrint = print;
      // Draw again so the read is picked up, even with the clock paused (a slider dragged, a Play control).
      if (pass.movedPending) this.host?.requestRender();
      return;
    }
    const count = s.packed.count;
    const sum = movedSum(got, count);
    if (s.sortBusy || sum === s.movedSum) { pass.recycleDepths(got); return; }
    s.sortBusy = true;
    s.movedSum = sum;
    const gen = s.gen, packed = s.packed;
    void sortSplatDepths(id, got, count).then(r => {
      s.sortBusy = false;
      s.pass?.recycleDepths(r.depths);
      if (s.gen !== gen || s.packed !== packed || r.order.length !== packed.count) return;
      this.landOrder(s, r.order, r.ms);
      // The next unmoved sort starts afresh (this order is the moved one's).
      s.sortedAxis = null;
    }, e => { s.sortBusy = false; console.warn('[splats] moved sort', e); });
  }

  /**
   * The print a depth read depends on: the camera as the probe last read it (its numbers, not the uniforms behind
   * them, so a slider the camera doesn't read, or the clock under a still camera, doesn't count), and the modifier's
   * own uniforms. A turn shows in the next reading, so the depths are read again a frame later.
   */
  private movedPrintOf(pass: SplatPass, mod: SplatModifierProgram, uniforms: Record<string, THREE.IUniform>): string | null {
    if (!pass.reading) return null;
    // The splat data doesn't change while the scan is loaded (a new one resets movedPrint); the probe's target holds
    // the camera the reading prints.
    const fixed = new Set<unknown>([uniforms[mod.uniforms.data]?.value, uniforms[mod.uniforms.probe]?.value]);
    const own = uniformsPrint(usedUniforms(mod.fragmentShader), uniforms, fixed);
    return own === null ? null : `${Array.prototype.join.call(pass.reading)}|${own}`;
  }

  private landOrder(s: Slot, order: Uint32Array, ms: number): void {
    s.order = order;
    s.pass?.setOrder(order);
    s.status = { ...s.status, sortMs: ms, sorts: s.status.sorts + 1 };
    if (s.status.sorts <= 1 || s.status.sorts % 30 === 0) this.changed();
    this.host?.requestRender();
  }

  private maybeSort(id: string, s: Slot, reading: ProbeReading): Promise<void> | null {
    if (s.sortBusy || !s.packed || s.status.state !== 'ready') return null;
    const axis = axisFromReading(reading);
    if (!axis || !needsResort(s.sortedAxis, axis, splatSortOf(s.node) === 'frame')) return null;
    s.sortBusy = true;
    const gen = s.gen, packed = s.packed;
    return sortKeptSplats(id, axis).then(r => {
      s.sortBusy = false;
      if (s.gen !== gen || s.packed !== packed || r.order.length !== packed.count) return;
      s.sortedAxis = axis;
      // The next moved sort (if a modifier starts moving them) starts afresh.
      s.movedSum = NaN; s.movedPrint = undefined;
      this.landOrder(s, r.order, r.ms);
    }, e => { s.sortBusy = false; console.warn('[splats] sort', e); });
  }

  /**
   * Offline renders (export, bake): before a frame, the probe read at once (with the frame's time already set on the
   * uniforms) and the scan sorted for it, waited for. Then beforeFrame draws it in order.
   */
  async settle(ctx: SplatFrame): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const [id, s] of this.slots) {
      const probe = this.probes.get(id);
      if (!probe || !s.packed) continue;
      const pass = this.ensurePass(id, s, ctx.renderer);
      setPivot(ctx.uniforms, s.status.info?.center);
      pass.setProbe(this.vertexShader, probe.fragmentShader, ctx.uniforms);
      this.setModifier(s, pass, probe, ctx.uniforms);
      // The probe, then the modifier program (it reads the probe), for this frame's time.
      pass.runProbe();
      const reading = pass.readProbeNow();
      if (!reading) continue;
      s.readingsSeen = pass.readings;
      // Wait for a sort already on its way, then sort for this frame if it turned (or, moved, always).
      while (s.sortBusy) await new Promise(r => setTimeout(r, 2));
      if (pass.hasModifier() && modifierMoves(probe.modifier, ctx.uniforms)) {
        const depths = pass.readDepthsNow(), packed = s.packed;
        if (!depths) continue;
        s.sortBusy = true;
        waits.push(sortSplatDepths(id, depths, packed.count).then(r => {
          s.sortBusy = false;
          if (s.packed !== packed || r.order.length !== packed.count) return;
          s.movedSum = NaN; s.sortedAxis = null;
          this.landOrder(s, r.order, r.ms);
        }, e => { s.sortBusy = false; console.warn('[splats] moved sort', e); }));
        continue;
      }
      const p = this.maybeSort(id, s, reading);
      if (p) waits.push(p);
    }
    await Promise.all(waits);
  }

  /** The preview's WebGL context was lost: GPU objects go now and are made again on the next frame. */
  contextLost(): void {
    for (const [id, s] of this.slots) {
      if (!s.pass) continue;
      s.pass.contextLost();
      s.pass = null;
      this.host?.setTexture(`${id}::color`, null);
      this.host?.setTexture(`${id}::depth`, null);
    }
  }

  private drop(id: string, s: Slot): void {
    s.gen++;
    s.pass?.dispose();
    s.pass = null;
    this.slots.delete(id);
    this.host?.setTexture(`${id}::color`, null);
    this.host?.setTexture(`${id}::depth`, null);
    void dropSplats(id);
    this.changed();
  }
}

export const splatEngine = new SplatEngine();

/** For checking in dev: `window.__splatEngine`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __splatEngine?: unknown }).__splatEngine = splatEngine;
