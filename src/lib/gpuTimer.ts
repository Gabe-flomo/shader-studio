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
 */
export interface TimerResult { name: string; ms: number }

interface Pending { name: string; query: WebGLQuery }

export class GpuTimer {
  readonly supported: boolean;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: Pending[] = [];
  private readonly pool: WebGLQuery[] = [];
  private active: Pending | null = null;
  private readonly gl: WebGL2RenderingContext | WebGLRenderingContext;

  constructor(gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.gl = gl;
    const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this.ext = isGl2 ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext']) : null;
    this.supported = !!this.ext;
  }

  /** Start timing GPU work under `name`. False when unsupported or a query is already open. */
  begin(name: string): boolean {
    if (!this.ext || this.active) return false;
    if (this.pending.length > 64) return false; // results never polled — don't leak queries
    const gl = this.gl as WebGL2RenderingContext;
    const query = this.pool.pop() ?? gl.createQuery();
    if (!query) return false;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { name, query };
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
        out.push({ name: p.name, ms: ns / 1e6 });
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
