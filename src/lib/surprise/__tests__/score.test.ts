/** Deep mode's scoring (score.ts): cheap image metrics, novelty and ranking. */
import { describe, expect, it } from 'vitest';
import { bestOf, colourfulness, scoreFrames, signatureDistance, signatureOf, type Frame } from '../score';

const W = 32, H = 20;
function frame(px: (x: number, y: number) => [number, number, number]): Frame {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = px(x, y);
    rgba.set([r, g, b, 255], (y * W + x) * 4);
  }
  return { rgba, w: W, h: H };
}
const black = frame(() => [0, 0, 0]);
const grey = frame(() => [128, 128, 128]);
const rings = (t = 0) => frame((x, y) => {
  const d = Math.hypot(x - W / 2, y - H / 2);
  const v = 0.5 + 0.5 * Math.sin(d * 1.3 - t);
  return [255 * v, 120 * (1 - v), 255 * (1 - v)];
});
const greyRings = frame((x, y) => { const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - W / 2, y - H / 2) * 1.3); return [255 * v, 255 * v, 255 * v]; });

describe('scoring a surprise', () => {
  it('turns down a blank or flat frame', () => {
    expect(scoreFrames([black, black]).score).toBe(-1);
    expect(scoreFrames([grey, grey]).degenerate).toBeTruthy();
  });
  it('colour, motion and detail raise the score', () => {
    expect(colourfulness(rings())).toBeGreaterThan(colourfulness(greyRings) + 0.2);
    const still = scoreFrames([rings(0), rings(0)]);
    const moving = scoreFrames([rings(0), rings(2)]);
    expect(moving.metrics.motion).toBeGreaterThan(still.metrics.motion);
    expect(moving.score).toBeGreaterThan(still.score);
    expect(scoreFrames([rings(), rings()]).score).toBeGreaterThan(scoreFrames([greyRings, greyRings]).score);
    expect(moving.why).toContain('moves');
  });
  it('novelty: a picture like the last kept one scores lower than a new one', () => {
    const kept = [signatureOf(rings())];
    expect(signatureDistance(signatureOf(rings()), kept[0])).toBe(0);
    const again = scoreFrames([rings(), rings()], kept);
    const fresh = scoreFrames([greyRings, greyRings], kept);
    expect(again.metrics.novelty).toBe(0);
    expect(fresh.metrics.novelty).toBeGreaterThan(0.3);
    expect(scoreFrames([rings(), rings()]).score).toBeGreaterThan(again.score);
  });
  it('bestOf keeps the best few, best first, never a degenerate one', () => {
    const a = { id: 'a', score: scoreFrames([greyRings, greyRings]) };
    const b = { id: 'b', score: scoreFrames([rings(0), rings(2)]) };
    const c = { id: 'c', score: scoreFrames([black, black]) };
    expect(bestOf([a, b, c], 5).map(x => x.id)).toEqual(['b', 'a']);
    expect(bestOf([a, b, c], 1).map(x => x.id)).toEqual(['b']);
  });
});
