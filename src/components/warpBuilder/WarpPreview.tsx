/**
 * WarpPreview — the Warp Builder's big preview (docs/warp-builder.md, "Preview"): the stack drawn
 * on its own small WebGL2 canvas (warpBuilder/preview.ts). It compiles only when the stack's shape
 * or the view changes; sliders, Run ×, mute and the hovered block are uniforms, set every frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { previewShader, previewUniforms } from '../../warpBuilder/preview';
import { onRuntimeReset } from '../../lib/runtimeReset';
import type { PreviewMode, WarpSpec } from '../../warpBuilder/spec';

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

interface Live { spec: WarpSpec; upTo: number | null; playing: boolean; t: number }

export function WarpPreview({ spec, mode, upTo, playing, onTime, seek }: {
  spec: WarpSpec; mode: PreviewMode; upTo: number | null; playing: boolean;
  /** Called with the time about 10 times a second (the time readout). */
  onTime?: (t: number) => void;
  /** Set the time (the scrubber); changes to it jump there. */
  seek?: { t: number; n: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shader = useMemo(() => previewShader(spec, mode), [spec, mode]);
  const live = useRef<Live>({ spec, upTo, playing, t: 0 });
  live.current.spec = spec;
  live.current.upTo = upTo;
  live.current.playing = playing;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (seek) live.current.t = seek.t; }, [seek]);
  // ↺ (lib/runtimeReset.ts): back to t = 0, shown at once (the readout too).
  useEffect(() => onRuntimeReset(() => { live.current.t = 0; onTimeRef.current?.(0); }), []);
  const onTimeRef = useRef(onTime);
  useEffect(() => { onTimeRef.current = onTime; });

  useEffect(() => {
    const c = ref.current;
    const gl = c?.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!c || !gl) { setError('This browser can’t draw the preview (no WebGL2).'); return; }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile failed');
      return s;
    };
    let prog: WebGLProgram | null = null;
    try {
      const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, shader.source);
      prog = gl.createProgram()!;
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'a_pos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
      gl.deleteShader(vs); gl.deleteShader(fs);
      setError(null);
    } catch (e) {
      setError(`The preview didn’t compile: ${(e as Error).message.split('\n')[0]}`);
      return;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const loc = (n: string) => gl.getUniformLocation(prog!, n);
    const L = { res: loc('u_res'), time: loc('u_time'), p: loc('u_p'), n: loc('u_n'), on: loc('u_on'), upto: loc('u_upto') };
    let raf = 0, last = performance.now(), lastTick = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      const st = live.current;
      if (st.playing) st.t += dt;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const u = previewUniforms(st.spec, st.upTo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.uniform2f(L.res, w, h);
      gl.uniform1f(L.time, st.t);
      gl.uniform1fv(L.p, u.p);
      gl.uniform1iv(L.n, u.n);
      gl.uniform1fv(L.on, u.on);
      gl.uniform1i(L.upto, u.upto);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (now - lastTick > 100) { lastTick = now; onTimeRef.current?.(st.t); }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); gl.deleteProgram(prog); gl.deleteBuffer(buf); };
  }, [shader.source]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={ref} data-warp-preview={mode} style={{ width: '100%', height: '100%', display: 'block', background: '#0d0d12' }} />
      {error && <div role="alert" data-warp-preview-error style={{ position: 'absolute', left: 12, bottom: 12, right: 12, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.7)', color: '#f88', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
