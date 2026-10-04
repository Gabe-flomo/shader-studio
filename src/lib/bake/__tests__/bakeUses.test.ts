/** Baked nodes elsewhere in the app (docs/bake.md): the Library's "used by", and the web page's copy of the clock. */
import { describe, expect, it } from 'vitest';
import runtimeSource from '../../../play/runtime/play-runtime.js?raw';
import { countBakedRefs, describeVideoUses, videoUses } from '../../videoUsage';
import { bakeFrameAt, type BakeClock } from '../plan';

const savedGraph = JSON.stringify({
  nodes: [{ id: 'node_9', type: 'baked', params: { videoId: 'vid_a', fileName: 'Baked "x" 1.mp4', bakeInfo: { fps: 30 } } }],
  play: { layers: [{ id: 'l1', kind: 'video', videoId: 'vid_a' }] },
});

describe('used by', () => {
  it('tells a Baked node’s video from a Video layer’s', () => {
    expect(countBakedRefs(savedGraph, 'vid_a')).toBe(1);
    expect(countBakedRefs(savedGraph, 'vid_b')).toBe(0);
  });

  it('the Library counts Baked nodes in saved graphs and the open one', () => {
    const kv = { keys: () => ['shader-studio:Sea'], get: () => savedGraph };
    const uses = videoUses(['vid_a', 'vid_c'], kv, { name: 'Open', layers: [], baked: ['vid_c'] });
    expect(uses.get('vid_a')).toEqual([{ kind: 'graph', label: 'Sea', layers: 2, baked: 1 }]);
    expect(describeVideoUses(uses.get('vid_a')!)).toBe('2 Video layers and Baked nodes in “Sea” use it.');
    expect(describeVideoUses(uses.get('vid_c')!)).toBe('A Baked node in the open graph (“Open”) uses it.');
  });
});

describe('web page clock', () => {
  it('play-runtime.js shows the same frame as the app at every time', () => {
    const src = runtimeSource as string;
    const m = /const bakeFrameAt = (\(t, c\) => \{[\s\S]*?\n {4}\});/.exec(src);
    expect(m).not.toBeNull();
    const pageFrameAt = new Function(`return ${m![1]}`)() as (t: number, c: BakeClock) => number;
    for (const c of [{ start: 0, duration: 4, fps: 30, loop: 'seamless' }, { start: 1.5, duration: 2, fps: 24, loop: 'none' }] as BakeClock[]) {
      for (let t = -1; t < 9; t += 0.0173) expect(pageFrameAt(t, c)).toBe(bakeFrameAt(t, c));
    }
  });
});
