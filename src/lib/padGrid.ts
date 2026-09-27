/**
 * padGrid.ts — the Play record's pad grid in the app: a Push or Launchpad's
 * pads (or the on-screen grid, clicked) as the cells of a grid shader.
 *
 *   MIDI in   midiEngine's raw messages (notes, poly aftertouch, channel
 *             pressure) from the setup's device and channel, read by the
 *             shared kit (play/kit/midi.js) so exported pages do the same
 *   state     one level per shader cell on the graph clock (hold, latch or
 *             decay), so a render or a MIDI file replays it exactly
 *   shader    `u_padGrid` (cols × rows RGBA: level, velocity, pressure,
 *             held), `u_padGridSize` (0 when there is no grid) and
 *             `u_padLast` (the last pad's cell, velocity, pressure), shared
 *             objects every material gets, like the Layers node's textures
 *   sources   Pad grid mappings (playEngine.readSource → read())
 *   takes     the cells' levels are recorded; playing back sets them
 *   MIDI out  "Light the pads" sends each pad's state back where the browser
 *             has Web MIDI outputs
 */
import * as THREE from 'three';
import { inputBus, type InputSource } from './inputBus';
import { midiEngine } from './midiEngine';
import type { PadGridRead, PlayPadGrid } from '../types/play';
import {
  kmCellLevel, kmCellsOf, kmGridClear, kmGridDown, kmGridFill, kmGridFit, kmGridMessage, kmGridRead, kmGridReleaseAll, kmGridUp, kmLayoutOf, kmNoteOfPad, kmPadOf, type KmGrid,
} from '../play/kit/midi.js';

function makeTexture(cols: number, rows: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(Math.max(1, cols * rows) * 4), Math.max(1, cols), Math.max(1, rows), THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export const padGridUniforms = {
  u_padGrid: { value: makeTexture(1, 1) as THREE.Texture },
  u_padGridSize: { value: new THREE.Vector2(0, 0) },
  u_padLast: { value: new THREE.Vector4(-1, -1, 0, 0) },
};

/** A lit pad's colour index: Launchpad's palette green, Push's white. */
const LIT: Record<string, number> = { launchpad: 21, launchpadClassic: 60, push: 122, learned: 127 };

class PadGrid implements InputSource {
  private pg: PlayPadGrid | null = null;
  private g: KmGrid | null = null;
  private time = 0;
  private dirty = true;
  private moving = false;
  private stamp = 0;
  /** A take playing back: cell levels and the last pad, by track id (`c<i>`, x, y, v, p). */
  private playback: Map<string, number> | null = null;
  private listeners = new Set<() => void>();
  private lit = new Map<number, number>();
  /**
   * Hits wait for the next frame, which stamps them with its clock time: the
   * clock only moves in ticks, and a hit stamped with a stale time would
   * already have faded. A MIDI file's messages arrive inside the same frame.
   */
  private queue: (() => void)[] = [];

  constructor() {
    midiEngine.subscribeRaw((status, d1, d2, device) => {
      if (!this.pg) return;
      this.queue.push(() => {
        const pg = this.pg, g = this.g;
        if (!pg || !g) return;
        const what = kmGridMessage(g, pg, status, d1, d2, device, this.time);
        if (what && what !== 'pressure') this.lightPad(d1);
      });
      this.changed();
    });
  }

  /** Apply the waiting hits at the clock's time now. */
  private drain(): void {
    if (!this.queue.length) return;
    const q = this.queue;
    this.queue = [];
    for (const f of q) f();
  }

  /** The record's pad grid (undefined: none). */
  setConfig(pg: PlayPadGrid | undefined): void {
    if (pg === this.pg) return;
    const before = this.pg;
    this.pg = pg ?? null;
    if (!pg) { this.g = null; this.lit.clear(); this.queue = []; this.changed(); return; }
    this.g = kmGridFit(this.g, pg);
    const tex = padGridUniforms.u_padGrid.value as THREE.DataTexture;
    if (tex.image.width !== pg.cols || tex.image.height !== pg.rows) { tex.dispose(); padGridUniforms.u_padGrid.value = makeTexture(pg.cols, pg.rows); }
    if (before && (before.layout !== pg.layout || before.device !== pg.device)) this.lit.clear();
    this.changed();
  }

  config(): PlayPadGrid | null { return this.pg; }
  grid(): KmGrid | null { return this.g; }

  /** Watch for hits and config changes (the on-screen grid). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private changed(): void {
    this.dirty = true;
    inputBus.wake();
    for (const l of this.listeners) l();
  }

  private pressListeners = new Set<(col: number, row: number, vel: number) => void>();
  /** On-screen grid presses (vel 0: let go), as they happen (drum pads play them). */
  onPress(fn: (col: number, row: number, vel: number) => void): () => void {
    this.pressListeners.add(fn);
    return () => { this.pressListeners.delete(fn); };
  }

  /** A pad pressed on the on-screen grid (velocity 0..1). */
  press(col: number, row: number, vel = 0.8): void {
    if (!this.pg) return;
    for (const fn of this.pressListeners) fn(col, row, vel);
    this.queue.push(() => {
      const pg = this.pg, g = this.g;
      if (!pg || !g) return;
      kmGridDown(g, pg, kmLayoutOf(pg), col, row, vel, this.time);
      this.lightPad(kmNoteOfPad(kmLayoutOf(pg), col, row));
    });
    this.changed();
  }

  release(col: number, row: number): void {
    if (!this.pg) return;
    for (const fn of this.pressListeners) fn(col, row, 0);
    this.queue.push(() => {
      const pg = this.pg, g = this.g;
      if (!pg || !g) return;
      kmGridUp(g, pg, col, row, this.time);
      this.lightPad(kmNoteOfPad(kmLayoutOf(pg), col, row));
    });
    this.changed();
  }

  /** Let go of everything and clear every cell (latched ones too). */
  clear(): void {
    const pg = this.pg, g = this.g;
    if (!pg || !g) return;
    this.queue = [];
    kmGridReleaseAll(g, pg, this.time);
    kmGridClear(g);
    if (pg.light) for (const note of [...this.lit.keys()]) this.sendLight(note, 0);
    this.changed();
  }

  /** A shader cell's level now (0..1). */
  level(i: number): number {
    if (this.playback) return this.playback.get(`c${i}`) ?? 0;
    const pg = this.pg, g = this.g;
    return pg && g && g.cells[i] ? kmCellLevel(g.cells[i], pg, this.time) : 0;
  }

  /** A Pad grid source's reading (null before any pad was hit). */
  read(read: PadGridRead, col: number, row: number): number | null {
    const pg = this.pg, g = this.g;
    if (!pg || !g) return null;
    if (this.playback) {
      if (read === 'cell') return this.playback.get(`c${Math.round(row) * pg.cols + Math.round(col)}`) ?? 0;
      const k = read === 'x' ? 'x' : read === 'y' ? 'y' : read === 'velocity' ? 'v' : read === 'pressure' ? 'p' : '';
      if (k) { const v = this.playback.get(k); return v === undefined ? null : v; }
    }
    return kmGridRead(g, pg, read, col, row, this.time);
  }

  // ── Takes ────────────────────────────────────────────────────────────────

  /** What a take records this frame: each cell's level (by index) and the last pad (x, y, v, p; x −1 before any). */
  snapshot(): { cells: Float32Array; x: number; y: number; v: number; p: number } | null {
    const pg = this.pg, g = this.g;
    if (!pg || !g) return null;
    const cells = new Float32Array(g.cells.length);
    for (let i = 0; i < cells.length; i++) cells[i] = kmCellLevel(g.cells[i], pg, this.time);
    const geo = kmLayoutOf(pg);
    const x = g.last.col < 0 ? -1 : geo.cols > 1 ? g.last.col / (geo.cols - 1) : 0;
    const y = g.last.row < 0 ? -1 : geo.rows > 1 ? g.last.row / (geo.rows - 1) : 0;
    return { cells, x, y, v: g.last.vel, p: g.last.pressure };
  }

  /** A take's value for a track (`c<i>`, x, y, v, p); playing back ignores live pads until clearPlayback. */
  setPlayback(id: string, v: number): void {
    if (!this.playback) this.playback = new Map();
    this.playback.set(id, v);
    this.dirty = true;
  }

  clearPlayback(): void {
    if (!this.playback) return;
    this.playback = null;
    this.changed();
  }

  // ── Per frame ────────────────────────────────────────────────────────────

  wantsTick(): boolean {
    return (this.pg !== null && (this.dirty || this.moving || this.playback !== null)) || (this.pg === null && padGridUniforms.u_padGridSize.value.x !== 0);
  }

  tickInputs(_dt: number, time: number): void {
    this.time = time;
    this.drain();
    if (!this.pg) {
      if (padGridUniforms.u_padGridSize.value.x !== 0) { padGridUniforms.u_padGridSize.value.set(0, 0); inputBus.writeUniform('u_padGridStamp', ++this.stamp); }
      return;
    }
    if (this.flush()) inputBus.writeUniform('u_padGridStamp', ++this.stamp);
  }

  /**
   * Fill the texture and u_padLast from the state (or a take) at the last
   * clock time. True when the picture changed. Offline renders call this
   * after setting a take's values.
   */
  flush(): boolean {
    const pg = this.pg, g = this.g;
    if (!pg || !g) return false;
    const tex = padGridUniforms.u_padGrid.value as THREE.DataTexture;
    const data = tex.image.data as Uint8Array;
    const last = padGridUniforms.u_padLast.value;
    const wasMoving = this.moving;
    if (this.playback) {
      const pb = this.playback;
      for (let i = 0; i < g.cells.length; i++) {
        const v = Math.max(0, Math.min(1, pb.get(`c${i}`) ?? 0));
        data[i * 4] = Math.round(v * 255); data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; data[i * 4 + 3] = v > 0 ? 255 : 0;
      }
      const geo = kmLayoutOf(pg), x = pb.get('x') ?? -1, y = pb.get('y') ?? -1;
      last.set(x < 0 ? -1 : Math.round(x * (geo.cols - 1)), y < 0 ? -1 : Math.round(y * (geo.rows - 1)), pb.get('v') ?? 0, pb.get('p') ?? 0);
      this.moving = false;
    } else {
      this.moving = kmGridFill(g, pg, this.time, data);
      last.set(g.last.cx, g.last.cy, g.last.vel, g.last.pressure);
    }
    tex.needsUpdate = true;
    padGridUniforms.u_padGridSize.value.set(pg.cols, pg.rows);
    const changed = this.dirty || this.moving || wasMoving;
    this.dirty = false;
    if (this.moving && this.listeners.size) for (const l of this.listeners) l();
    return changed;
  }

  // ── MIDI out: light the pads ─────────────────────────────────────────────

  private lightPad(note: number): void {
    const pg = this.pg, g = this.g;
    if (!pg?.light || !g || !pg.device) return;
    const pad = kmPadOf(kmLayoutOf(pg), note);
    if (!pad) return;
    const on = pg.mode === 'latch' ? this.padLatched(pad.col, pad.row) : g.pads.has(`${pad.col},${pad.row}`);
    this.sendLight(note, on ? LIT[pg.layout] ?? 127 : 0);
  }

  private padLatched(col: number, row: number): boolean {
    const pg = this.pg, g = this.g;
    if (!pg || !g) return false;
    const box = kmCellsOf(pg, kmLayoutOf(pg), col, row);
    return !!box && !!g.cells[box[2] * g.cols + box[0]]?.latched;
  }

  private sendLight(note: number, vel: number): void {
    const pg = this.pg;
    if (!pg || this.lit.get(note) === vel) return;
    this.lit.set(note, vel);
    const ch = Math.max(0, (pg.channel || 1) - 1);
    for (const out of midiEngine.outputsNamed(pg.device)) {
      try { out.send(vel > 0 ? [0x90 | ch, note & 127, vel] : [0x80 | ch, note & 127, 0]); } catch { /* the port went away */ }
    }
  }
}

export const padGrid = new PadGrid();
inputBus.addSource(padGrid);
