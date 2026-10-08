/**
 * gpuTimer — GPU elapsed-time queries (EXT_disjoint_timer_query_webgl2).
 *
 * A frame's requestAnimationFrame FPS tops out at the display rate, so it says
 * nothing about how much of the budget a shader really uses. Timer queries
 * measure the GPU work between begin() and end() in nanoseconds. Results
 * arrive a few frames later; poll() collects the ones that are ready.
 *
 * Queries cannot nest: begin() while one is open is ignored and returns false.
 * Safari (and WebGL1) have no usable extension — `supported` is false and every
 * call is a no-op, so callers fall back to CPU timing.
 *
 * Isolation (Chrome on a Mac, ANGLE's Metal backend): a timer there reads from the
 * start of the GPU command buffer it ends in, so it also counts everything queued
 * since the last flush — a 0.02 ms draw read 2–4 ms after an unrelated heavy draw.
 * A gl.flush() just before beginQuery submits that earlier work on its own and the
 * timer reads only what follows (measured: 2.1 ms → 0.015 ms). With `isolate` on,
 * every begin() flushes first; results carry the flag and the frame they belong to.
 */
export interface TimerResult { name: string; ms: number; frame: number; isolated: boolean }

interface Pending { name: string; query: WebGLQuery; frame: number; isolated: boolean }

export class GpuTimer {
  readonly supported: boolean;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: Pending[] = [];
  private readonly pool: WebGLQuery[] = [];
  private active: Pending | null = null;
  private readonly gl: WebGL2RenderingContext | WebGLRenderingContext;
  /** The frame the next queries belong to (set by the frame loop). */
  frame = 0;
  /** Flush before every begin(), so each query times only its own work (see above). */
  isolate = false;

  constructor(gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.gl = gl;
    const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this.ext = isGl2 ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext']) : null;
    this.supported = !!this.ext;
  }

  /**
   * Start timing GPU work under `name`. False when unsupported or a query is already open.
   * `isolated` (or the `isolate` flag) flushes the work queued so far first.
   */
  begin(name: string, isolated = this.isolate): boolean {
    if (!this.ext || this.active) return false;
    if (this.pending.length > 64) return false; // results never polled — don't leak queries
    const gl = this.gl as WebGL2RenderingContext;
    const query = this.pool.pop() ?? gl.createQuery();
    if (!query) return false;
    if (isolated) gl.flush();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { name, query, frame: this.frame, isolated };
    return true;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    (this.gl as WebGL2RenderingContext).endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collect the results that are ready. After a GPU disjoint event the pending ones are dropped as unreliable. */
  poll(): TimerResult[] {
    if (!this.ext || this.pending.length === 0) return [];
    const gl = this.gl as WebGL2RenderingContext;
    const out: TimerResult[] = [];
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    // Oldest first; stop at the first one that isn't ready (they complete in order)
    while (this.pending.length) {
      const p = this.pending[0];
      const ready = gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!ready && !disjoint) break;
      this.pending.shift();
      if (!disjoint) {
        const ns = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
        out.push({ name: p.name, ms: ns / 1e6, frame: p.frame, isolated: p.isolated });
      }
      this.pool.push(p.query);
    }
    return out;
  }

  /** Outstanding queries whose results have not been read yet. */
  get outstanding(): number { return this.pending.length + (this.active ? 1 : 0); }

  dispose(): void {
    const gl = this.gl as WebGL2RenderingContext;
    if (!this.ext) return;
    if (this.active) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pool.push(this.active.query); this.active = null; }
    for (const p of this.pending) this.pool.push(p.query);
    this.pending.length = 0;
    for (const q of this.pool) gl.deleteQuery(q);
    this.pool.length = 0;
  }
}
