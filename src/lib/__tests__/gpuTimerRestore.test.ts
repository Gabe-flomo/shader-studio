/**
 * GpuTimer across a lost and restored WebGL context (docs/backlog-2026-10-10.md "Context lost /
 * restored"): the old context's queries are never read on the new one, and the timer extension is
 * asked for again (it belongs to one context).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GpuTimer } from '../gpuTimer';

class FakeGl {
  lost = false;
  ctx = 1;
  calls: string[] = [];
  readonly QUERY_RESULT_AVAILABLE = 1;
  readonly QUERY_RESULT = 2;
  isContextLost() { return this.lost; }
  getExtension(name: string) { this.calls.push(`getExtension ${name} ctx${this.ctx}`); return { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 }; }
  createQuery() { return { ctx: this.ctx }; }
  beginQuery() {}
  endQuery() {}
  flush() {}
  getParameter() { return false; }
  getQueryParameter(q: { ctx: number }, p: number) {
    if (q.ctx !== this.ctx) throw new Error('object does not belong to this context');
    return p === this.QUERY_RESULT_AVAILABLE ? true : 2e6;
  }
  deleteQuery(q: { ctx: number }) { if (q.ctx !== this.ctx) throw new Error('object does not belong to this context'); }
}

const g = globalThis as unknown as { WebGL2RenderingContext?: unknown };
let had: unknown;
beforeAll(() => { had = g.WebGL2RenderingContext; g.WebGL2RenderingContext = FakeGl; });
afterAll(() => { g.WebGL2RenderingContext = had; });

describe('GpuTimer across a lost context', () => {
  it('forgets the old queries and asks the restored context for the extension again', () => {
    const gl = new FakeGl();
    const t = new GpuTimer(gl as unknown as WebGL2RenderingContext);
    expect(t.supported).toBe(true);
    t.begin('main'); t.end();
    t.begin('more');
    // Lost: nothing is timed or read while it is.
    gl.lost = true;
    t.reset();
    expect(t.supported).toBe(false);
    expect(t.begin('x')).toBe(false);
    expect(t.poll()).toEqual([]);
    // Restored: a new context, where the old queries would throw if read or deleted.
    gl.lost = false; gl.ctx = 2;
    t.reset();
    expect(t.supported).toBe(true);
    expect(gl.calls).toEqual(['getExtension EXT_disjoint_timer_query_webgl2 ctx1', 'getExtension EXT_disjoint_timer_query_webgl2 ctx2']);
    expect(t.outstanding).toBe(0);
    expect(() => t.poll()).not.toThrow();
    t.begin('main'); t.end();
    expect(t.poll().map(r => r.ms)).toEqual([2]);
    expect(() => t.dispose()).not.toThrow();
  });

  it('a context lost before its event arrives: begin and poll do nothing', () => {
    const gl = new FakeGl();
    const t = new GpuTimer(gl as unknown as WebGL2RenderingContext);
    t.begin('main'); t.end();
    gl.lost = true; gl.ctx = 2;
    expect(t.begin('x')).toBe(false);
    expect(() => t.poll()).not.toThrow();
  });
});
