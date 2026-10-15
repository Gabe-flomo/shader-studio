/**
 * Blob tracking, the CPU half (docs/blob-track.md): a small mask in, blobs with stable IDs out.
 *
 * - `maskOf` turns RGBA bytes into a 0/1 mask (a channel over a threshold, optionally inverted).
 * - `findBlobs` labels the 8-connected regions (one flood fill per region) and measures each: its box, its
 *   centre (the mean of its pixels) and its area, all as shares of the frame (0–1, rows bottom-up, as a
 *   texture's coordinates run). Too small or too big blobs are dropped; the biggest `max` are kept.
 * - `trackBlobs` matches this frame's blobs to the last frame's tracks by nearest centre (closest pairs first,
 *   no further than Max jump), so a blob keeps its ID while it moves. A track that loses its blob is kept for
 *   `memory` frames (not reported) and picks its ID back up if a blob comes back near it; new blobs get new IDs.
 * - `packBlobs` lays the tracks out for the shader: BLOB_SLOTS × 2 RGBA floats.
 */

/** Most blobs a node reports (the data texture's width; the shader loops over this many). */
export const BLOB_SLOTS = 16;

export interface Blob {
  /** Centre (mean of its pixels), 0–1. */
  cx: number;
  cy: number;
  /** Box, 0–1. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Share of the frame it covers, 0–1. */
  area: number;
}

export interface Track extends Blob {
  id: number;
  /** Frames since it was first seen. */
  age: number;
  /** Frames since it last had a blob (0: seen this frame). */
  missed: number;
}

export type MaskChannel = 'luma' | 'red' | 'alpha';

/** A 0/1 mask from RGBA bytes: the channel (0–1) over the threshold, or under it when inverted. */
export function maskOf(rgba: Uint8Array, w: number, h: number, threshold: number, channel: MaskChannel = 'luma', invert = false): Uint8Array {
  const out = new Uint8Array(w * h);
  const t = Math.max(0, Math.min(1, threshold)) * 255;
  for (let i = 0, n = w * h; i < n; i++) {
    const o = i * 4;
    const v = channel === 'red' ? rgba[o] : channel === 'alpha' ? rgba[o + 3] : 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
    out[i] = (v > t) !== invert ? 1 : 0;
  }
  return out;
}

export interface FindOptions {
  /** Smallest and largest blob kept, as a share of the frame. */
  minArea?: number;
  maxArea?: number;
  /** Most blobs kept (the biggest). */
  max?: number;
}

/** The 8-connected blobs of a 0/1 mask (rows bottom-up), biggest first. */
export function findBlobs(mask: Uint8Array, w: number, h: number, opts: FindOptions = {}): Blob[] {
  const minArea = opts.minArea ?? 0, maxArea = opts.maxArea ?? 1, max = Math.max(0, opts.max ?? BLOB_SLOTS);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const total = w * h;
  const out: Blob[] = [];
  for (let start = 0; start < total; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0, count = 0, sx = 0, sy = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    stack[top++] = start; seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      count++; sx += x; sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }
    const area = count / total;
    if (area < minArea || area > maxArea) continue;
    out.push({ cx: (sx / count + 0.5) / w, cy: (sy / count + 0.5) / h, x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h, area });
  }
  out.sort((a, b) => b.area - a.area);
  return out.slice(0, max);
}

export interface TrackOptions {
  /** Furthest a blob may move between frames and keep its ID, as a share of the frame's height. */
  maxJump?: number;
  /** Frames a lost track is remembered. */
  memory?: number;
  /** Blend each track's position and size with its last (0: none, 0.9: very smooth). */
  smoothing?: number;
  /** Width / height of the frame, so a jump is measured the same across and up. */
  aspect?: number;
}

export interface TrackState {
  tracks: Track[];
  nextId: number;
}

export const emptyTrackState = (): TrackState => ({ tracks: [], nextId: 1 });

/** This frame's blobs matched onto the last frame's tracks. */
export function trackBlobs(state: TrackState, blobs: readonly Blob[], opts: TrackOptions = {}): TrackState {
  const maxJump = opts.maxJump ?? 0.2, memory = Math.max(0, Math.round(opts.memory ?? 10));
  const k = Math.max(0, Math.min(0.95, opts.smoothing ?? 0)), aspect = opts.aspect ?? 1;
  const prev = state.tracks;
  const pairs: { d: number; t: number; b: number }[] = [];
  for (let t = 0; t < prev.length; t++) {
    for (let b = 0; b < blobs.length; b++) {
      const d = Math.hypot((blobs[b].cx - prev[t].cx) * aspect, blobs[b].cy - prev[t].cy);
      if (d <= maxJump) pairs.push({ d, t, b });
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.t - b.t || a.b - b.b);
  const tookT = new Set<number>(), tookB = new Set<number>();
  const tracks: Track[] = [];
  for (const p of pairs) {
    if (tookT.has(p.t) || tookB.has(p.b)) continue;
    tookT.add(p.t); tookB.add(p.b);
    const o = prev[p.t], n = blobs[p.b];
    // A track coming back from missing frames jumps to its blob (nothing recent to smooth from).
    const m = o.missed > 0 ? 0 : k;
    const mix = (a: number, b: number) => a * m + b * (1 - m);
    tracks.push({ id: o.id, age: o.age + 1, missed: 0, area: n.area, cx: mix(o.cx, n.cx), cy: mix(o.cy, n.cy), x0: mix(o.x0, n.x0), y0: mix(o.y0, n.y0), x1: mix(o.x1, n.x1), y1: mix(o.y1, n.y1) });
  }
  for (let t = 0; t < prev.length; t++) {
    if (tookT.has(t) || prev[t].missed >= memory) continue;
    tracks.push({ ...prev[t], age: prev[t].age + 1, missed: prev[t].missed + 1 });
  }
  let nextId = state.nextId;
  for (let b = 0; b < blobs.length; b++) {
    if (tookB.has(b)) continue;
    tracks.push({ ...blobs[b], id: nextId++, age: 0, missed: 0 });
  }
  tracks.sort((a, b) => a.id - b.id);
  return { tracks, nextId };
}

/** The tracks seen this frame, oldest ID first, at most `max`. */
export const visibleTracks = (state: TrackState, max = BLOB_SLOTS): Track[] =>
  state.tracks.filter(t => t.missed === 0).slice(0, Math.min(max, BLOB_SLOTS));

export type MarkMotion = 'follow' | 'jump' | 'pulse';

/** Where a blob's marks are drawn: its box, held between jumps (centre and size, 0–1). */
export interface MarkBox { cx: number; cy: number; w: number; h: number }

export interface MarkState {
  boxes: Map<number, MarkBox>;
  /** Jump: when each track's marks next snap (seconds). */
  next: Map<number, number>;
  /** Pulse: when the marks were last placed (seconds). */
  placed: number;
}

export const emptyMarkState = (): MarkState => ({ boxes: new Map(), next: new Map(), placed: -Infinity });

export interface MarkOptions {
  /** Jump: snaps per second, per blob (on average). */
  jumpRate?: number;
  /** Jump: how far a snap lands off its blob, as a share of the blob's size. */
  scatter?: number;
  /** Pulse: seconds the marks stay put before they are placed again. */
  hold?: number;
}

const boxOf = (t: Track): MarkBox => ({ cx: t.cx, cy: t.cy, w: t.x1 - t.x0, h: t.y1 - t.y0 });

/**
 * Where each visible track's marks go this frame (the shader draws boxes, labels and connections there).
 * Follow: on the blob. Jump: held, then snapped to the blob (Scatter off it) at random moments, each blob on
 * its own clock, about Jump rate times a second. Pulse: all held for Hold seconds, then placed again together.
 * A new blob's marks start on it. `rand` is Math.random unless a test fixes it.
 */
export function placeMarks(state: MarkState, tracks: readonly Track[], motion: MarkMotion, now: number, opts: MarkOptions = {}, rand: () => number = Math.random): MarkBox[] {
  const live = new Set(tracks.map(t => t.id));
  for (const id of [...state.boxes.keys()]) if (!live.has(id)) { state.boxes.delete(id); state.next.delete(id); }
  if (motion === 'follow') {
    state.boxes.clear(); state.next.clear();
    return tracks.map(boxOf);
  }
  if (motion === 'pulse') {
    const hold = Math.max(0.05, opts.hold ?? 2);
    const again = now - state.placed >= hold;
    if (again) state.placed = now;
    return tracks.map(t => {
      let b = state.boxes.get(t.id);
      if (!b || again) { b = boxOf(t); state.boxes.set(t.id, b); }
      return b;
    });
  }
  const rate = Math.max(0.05, opts.jumpRate ?? 4), scatter = Math.max(0, opts.scatter ?? 0);
  return tracks.map(t => {
    let b = state.boxes.get(t.id);
    const due = state.next.get(t.id) ?? -Infinity;
    if (!b || now >= due) {
      const o = boxOf(t);
      b = { ...o, cx: o.cx + (rand() - 0.5) * scatter * o.w, cy: o.cy + (rand() - 0.5) * scatter * o.h };
      state.boxes.set(t.id, b);
      // Uneven holds (0.3–1.7 × the mean) so the blobs don't snap in step.
      state.next.set(t.id, now + (0.3 + 1.4 * rand()) / rate);
    }
    return b;
  });
}

/** Rows of the shader's data texture. */
export const BLOB_ROWS = 3;

/**
 * The shader's data: BLOB_SLOTS × BLOB_ROWS RGBA floats. Row 0: centre x, y and box width, height (0–1);
 * row 1: ID, area, age (frames) and 1 for a blob (0 for an empty slot); row 2: where its marks are drawn
 * (centre and size, as row 0; the blob itself when no marks are given).
 */
export function packBlobs(tracks: readonly Track[], out: Float32Array<ArrayBuffer> = new Float32Array(BLOB_SLOTS * BLOB_ROWS * 4), marks?: readonly MarkBox[]): Float32Array<ArrayBuffer> {
  out.fill(0);
  const n = Math.min(tracks.length, BLOB_SLOTS);
  for (let i = 0; i < n; i++) {
    const t = tracks[i], a = i * 4, b = (BLOB_SLOTS + i) * 4, c = (2 * BLOB_SLOTS + i) * 4;
    out[a] = t.cx; out[a + 1] = t.cy; out[a + 2] = t.x1 - t.x0; out[a + 3] = t.y1 - t.y0;
    out[b] = t.id; out[b + 1] = t.area; out[b + 2] = t.age; out[b + 3] = 1;
    const m = marks?.[i] ?? boxOf(t);
    out[c] = m.cx; out[c + 1] = m.cy; out[c + 2] = m.w; out[c + 3] = m.h;
  }
  return out;
}

/** The size to read a source at: `side` on its long side, its shape kept (at least 8 px). */
export function blobGrabSize(w: number, h: number, side: number): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: side, h: Math.max(8, Math.round(side * 9 / 16)) };
  const s = side / Math.max(w, h);
  return { w: Math.max(8, Math.round(w * s)), h: Math.max(8, Math.round(h * s)) };
}
