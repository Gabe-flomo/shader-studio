/**
 * The Record dialog asks the canvas's GL for its size limits. A phone that has lost the context
 * (it reclaims GPU memory) answers null to every getParameter: that must not throw (it used to
 * take the whole app down from the Record dialog), and a live context still decides the limit.
 */
import { describe, expect, it } from 'vitest';
import { getGpuLimits } from '../exportLimits';

function canvasWith(gl: unknown): HTMLCanvasElement {
  return { getContext: () => gl } as unknown as HTMLCanvasElement;
}
const GL = { MAX_VIEWPORT_DIMS: 1, MAX_TEXTURE_SIZE: 2, MAX_RENDERBUFFER_SIZE: 3 };

describe('getGpuLimits', () => {
  it('a lost context keeps the 4096 floor instead of throwing', () => {
    const lost = { ...GL, isContextLost: () => true, getParameter: () => null };
    expect(getGpuLimits(canvasWith(lost)).maxDim).toBe(4096);
  });
  it('null answers without isContextLost are ignored too', () => {
    const odd = { ...GL, getParameter: () => null };
    expect(getGpuLimits(canvasWith(odd)).maxDim).toBe(4096);
  });
  it('a live context: the smallest of its limits', () => {
    const live = { ...GL, isContextLost: () => false, getParameter: (p: number) => (p === 1 ? new Int32Array([16384, 8192]) : p === 2 ? 16384 : 12000) };
    expect(getGpuLimits(canvasWith(live)).maxDim).toBe(8192);
  });
});
