/**
 * renderKeepAlive — "someone needs every frame drawn".
 *
 * ShaderCanvas only redraws when something changed (a slider, the clock when
 * the shader uses time, audio, video, …) and stops scheduling frames when the
 * picture is static. A canvas.captureStream() recording is the one consumer
 * that needs frames even for a static picture — no repaint, no video frame —
 * so the recorder holds a lease here for the duration of the recording.
 */
class RenderKeepAlive {
  private leases = 0;

  /** Returns a release function; call it exactly once. */
  acquire(): () => void {
    this.leases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases = Math.max(0, this.leases - 1);
    };
  }

  active(): boolean {
    return this.leases > 0;
  }
}

export const renderKeepAlive = new RenderKeepAlive();
