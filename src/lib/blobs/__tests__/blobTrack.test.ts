/** Blob Track (docs/blob-track.md): blobs found in a mask, followed with stable IDs, and the node's shader. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { BLOB_ROWS, BLOB_SLOTS, emptyMarkState, emptyTrackState, findBlobs, maskOf, packBlobs, placeMarks, trackBlobs, visibleTracks } from '../track';
import { blobSources, stepBlobs } from '../engine';
import { compileGraph } from '../../../compiler/graphCompiler';
import type { CompilationResult } from '../../../compiler/types';
import type { GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '../../../nodes/definitions';

/** RGBA bytes w×h with white discs (cx, cy, r in pixels). */
function frame(w: number, h: number, discs: [number, number, number][]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = discs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
    const o = (y * w + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = on ? 255 : 0; out[o + 3] = 255;
  }
  return out;
}

describe('Blob Track: finding', () => {
  it('finds separate blobs with their centres, boxes and areas, biggest first', () => {
    const w = 64, h = 32;
    const m = maskOf(frame(w, h, [[10, 10, 3], [40, 20, 6]]), w, h, 0.5);
    const b = findBlobs(m, w, h);
    expect(b).toHaveLength(2);
    expect(b[0].cx * w).toBeCloseTo(40.5, 0);
    expect(b[0].cy * h).toBeCloseTo(20.5, 0);
    expect(b[0].area).toBeGreaterThan(b[1].area);
    expect((b[1].x1 - b[1].x0) * w).toBe(7);
  });

  it('Min size, Max size and Max blobs filter; Invert finds dark shapes', () => {
    const w = 64, h = 32, rgba = frame(w, h, [[10, 10, 1], [40, 20, 6], [55, 5, 3]]);
    const m = maskOf(rgba, w, h, 0.5);
    expect(findBlobs(m, w, h, { minArea: 0.005 })).toHaveLength(2);
    expect(findBlobs(m, w, h, { maxArea: 0.03 })).toHaveLength(2);
    expect(findBlobs(m, w, h, { max: 1 })[0].cx * w).toBeCloseTo(40.5, 0);
    // Inverted, the black background is one blob around the discs.
    expect(findBlobs(maskOf(rgba, w, h, 0.5, 'luma', true), w, h)).toHaveLength(1);
  });

  it('diagonal neighbours join (8-connected)', () => {
    const w = 4, h = 4, m = new Uint8Array(16);
    m[0] = m[5] = m[10] = 1;
    expect(findBlobs(m, w, h)).toHaveLength(1);
  });
});

describe('Blob Track: following', () => {
  it('keeps IDs while blobs move, even when they swap order by size', () => {
    let st = emptyTrackState();
    const w = 80, h = 40, P = { minSize: 0, maxSize: 1, maxJump: 0.2, smoothing: 0 };
    st = stepBlobs(st, frame(w, h, [[10, 20, 3], [60, 20, 5]]), w, h, P);
    const ids = Object.fromEntries(visibleTracks(st).map(t => [Math.round(t.cx * w / 10), t.id]));
    st = stepBlobs(st, frame(w, h, [[14, 20, 7], [56, 20, 2]]), w, h, P);
    const now = Object.fromEntries(visibleTracks(st).map(t => [Math.round(t.cx * w / 10), t.id]));
    expect(now[1]).toBe(ids[1]);
    expect(now[6]).toBe(ids[6]);
  });

  it('a lost blob keeps its ID for Memory frames, then a new blob gets a new ID', () => {
    const b = { cx: 0.5, cy: 0.5, x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55, area: 0.01 };
    let st = trackBlobs(emptyTrackState(), [b], { memory: 2 });
    const id = st.tracks[0].id;
    st = trackBlobs(st, [], { memory: 2 });
    expect(visibleTracks(st)).toHaveLength(0);
    st = trackBlobs(st, [{ ...b, cx: 0.52 }], { memory: 2 });
    expect(visibleTracks(st)[0].id).toBe(id);
    for (let i = 0; i < 3; i++) st = trackBlobs(st, [], { memory: 2 });
    st = trackBlobs(st, [b], { memory: 2 });
    expect(visibleTracks(st)[0].id).not.toBe(id);
  });

  it('a blob jumping further than Max jump is a new one', () => {
    const b = { cx: 0.1, cy: 0.5, x0: 0, y0: 0, x1: 0.2, y1: 1, area: 0.01 };
    let st = trackBlobs(emptyTrackState(), [b], { maxJump: 0.1, memory: 0 });
    st = trackBlobs(st, [{ ...b, cx: 0.8 }], { maxJump: 0.1, memory: 0 });
    expect(visibleTracks(st)[0].id).toBe(2);
  });

  it('packs centre and size in row 0, ID, area, age and 1 in row 1', () => {
    const st = trackBlobs(emptyTrackState(), [{ cx: 0.25, cy: 0.75, x0: 0.2, y0: 0.7, x1: 0.3, y1: 0.8, area: 0.01 }]);
    const d = packBlobs(visibleTracks(st));
    expect(d.length).toBe(BLOB_SLOTS * BLOB_ROWS * 4);
    // Row 2: where the marks go (the blob itself without marks).
    expect([...d.slice(BLOB_SLOTS * 8, BLOB_SLOTS * 8 + 4)].map(v => +v.toFixed(3))).toEqual([0.25, 0.75, 0.1, 0.1]);
    expect([...d.slice(0, 4)].map(v => +v.toFixed(3))).toEqual([0.25, 0.75, 0.1, 0.1]);
    expect([...d.slice(BLOB_SLOTS * 4, BLOB_SLOTS * 4 + 4)].map(v => +v.toFixed(3))).toEqual([1, 0.01, 0, 1]);
    expect(d[4 * BLOB_SLOTS + 7]).toBe(0);
  });
});

describe('Blob Track: where the marks go (Motion)', () => {
  const track = (id: number, cx: number) => ({ id, age: 0, missed: 0, cx, cy: 0.5, x0: cx - 0.05, y0: 0.45, x1: cx + 0.05, y1: 0.55, area: 0.01 });
  it('Follow: on the blob', () => {
    const st = emptyMarkState();
    expect(placeMarks(st, [track(1, 0.3)], 'follow', 0)[0].cx).toBeCloseTo(0.3);
  });
  it('Jump: held between snaps, each blob on its own clock, Scatter off the blob', () => {
    const st = emptyMarkState(), r = () => 0.5;
    expect(placeMarks(st, [track(1, 0.3)], 'jump', 0, { jumpRate: 2 }, r)[0].cx).toBeCloseTo(0.3);
    // Next snap at (0.3 + 1.4 × 0.5) / 2 = 0.5 s: before it the mark stays.
    expect(placeMarks(st, [track(1, 0.4)], 'jump', 0.4, { jumpRate: 2 }, r)[0].cx).toBeCloseTo(0.3);
    expect(placeMarks(st, [track(1, 0.4)], 'jump', 0.6, { jumpRate: 2 }, r)[0].cx).toBeCloseTo(0.4);
    const off = placeMarks(emptyMarkState(), [track(1, 0.3)], 'jump', 0, { scatter: 1 }, () => 1)[0];
    expect(off.cx).toBeCloseTo(0.35);
  });
  it('Pulse: all held for Hold seconds, then placed again together; a new blob starts on itself', () => {
    const st = emptyMarkState();
    placeMarks(st, [track(1, 0.3)], 'pulse', 0, { hold: 1 });
    const mid = placeMarks(st, [track(1, 0.5), track(2, 0.8)], 'pulse', 0.5, { hold: 1 });
    expect(mid[0].cx).toBeCloseTo(0.3);
    expect(mid[1].cx).toBeCloseTo(0.8);
    expect(placeMarks(st, [track(1, 0.5)], 'pulse', 1.1, { hold: 1 })[0].cx).toBeCloseTo(0.5);
  });
});

describe('Blob Track: the node', () => {
  const node = (id: string, type: string, params: Record<string, unknown> = {}): GraphNode => {
    const def = getNodeDefinition(type)!;
    return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label }])) } as GraphNode;
  };
  const out = (from: string, key: string): GraphNode => {
    return { id: 'out', type: 'output', position: { x: 600, y: 0 }, outputs: {}, params: {},
      inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } } } as unknown as GraphNode;
  };

  it('compiles: its blob texture is a node texture and the code names its source', () => {
    const r = compileGraph({ nodes: [node('bt', 'blobTrack'), out('bt', 'overlay')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const S = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'bt')!;
    expect(S).toMatch(/^u_tex_/);
    expect(blobSources([r.fragmentShader]).get(S)).toBe('picture');
    expect(r.fragmentShader).toContain(`texelFetch(${S}, ivec2(`);
    expect(r.fragmentShader).toContain(`#define ${S}_px`);
  });

  it('a wired texture is what it reads', () => {
    const tex = node('img', 'textureInput');
    const bt = node('bt', 'blobTrack');
    bt.inputs.texture = { ...bt.inputs.texture, connection: { nodeId: 'img', outputKey: 'texture' } };
    const r = compileGraph({ nodes: [tex, bt, out('bt', 'overlay')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const S = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'bt')!;
    const img = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'img')!;
    expect(blobSources([r.fragmentShader]).get(S)).toBe(img);
  });

  it('marks: brackets, crosses, labels and every Connect mode compile; Stamp samples its texture with fit, cells and spin', () => {
    for (const connect of ['off', 'chain', 'nearest', 'nearest2', 'all']) {
      const bt = node('bt', 'blobTrack', { connect, boxStyle: 'brackets', marker: 'cross', labels: 'xy', flow: 1 });
      const r = compileGraph({ nodes: [bt, out('bt', 'marks')] }) as CompilationResult;
      expect(r.errors ?? [], connect).toEqual([]);
      expect(r.fragmentShader).toContain('bt_label(');
      expect(r.fragmentShader.includes('bt_edge(') && /bt_edge\(\w+_px,/.test(r.fragmentShader)).toBe(connect !== 'off');
    }
    const img = node('img', 'textureInput');
    const bt = node('bt', 'blobTrack', { stampFit: 'circle', stampCells: '4', stampSpin: 0.5 });
    bt.inputs.stamp = { ...bt.inputs.stamp, connection: { nodeId: 'img', outputKey: 'texture' } };
    const r = compileGraph({ nodes: [img, bt, out('bt', 'stamped')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const S = Object.keys(r.textureUniforms).find(k => r.textureUniforms[k] === 'img')!;
    expect(r.fragmentShader).toContain(`textureLod(${S}, lu, 0.0)`);
    expect(r.fragmentShader).toMatch(/mod\(bid - 1\.0, 16\.0\)/);
  });

  it('Motion, line styles, colour by, wobble, max link and hex labels compile; Jump re-picks partners, Pulse runs packets', () => {
    for (const motion of ['follow', 'jump', 'pulse']) for (const connect of ['chain', 'nearest2', 'all']) {
      const bt = node('bt', 'blobTrack', { motion, connect, lineStyle: 'dashed', lineColourBy: 'gradient', wobble: 0.5, maxLink: 0.5, labels: 'hex', boxStyle: 'brackets', padding: 4 });
      const r = compileGraph({ nodes: [bt, out('bt', 'marks')] }) as CompilationResult;
      expect(r.errors ?? [], `${motion} ${connect}`).toEqual([]);
      expect(r.fragmentShader).toContain('ivec2(i, 2)');
      if (motion === 'jump' && connect !== 'all') expect(r.fragmentShader).toMatch(/if \(j1 >= i\) j1\+\+;/);
      if (motion === 'pulse') expect(r.fragmentShader).toMatch(/u_time, [0-9.]+, 1\.0, bt_h/);
    }
  });
});
