/**
 * MiniShader — a small square that runs one fragment shader with the Studio
 * uniforms (u_resolution, u_time, u_mouse). Used to preview a discovered
 * function. Recompiles when the source changes and reports compile errors
 * back instead of drawing.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

function compile(gl: WebGLRenderingContext, frag: string): { prog: WebGLProgram | null; error: string | null } {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, frag);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { const e = gl.getShaderInfoLog(fs) || 'compile failed'; gl.deleteShader(vs); gl.deleteShader(fs); return { prog: null, error: e }; }
  const prog = gl.createProgram()!; gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { const e = gl.getProgramInfoLog(prog) || 'link failed'; gl.deleteProgram(prog); return { prog: null, error: e }; }
  return { prog, error: null };
}

export function MiniShader({ source, size = 180, onError }: { source: string | null; size?: number; onError?: (e: string | null) => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const mouse = useRef<[number, number]>([size * 0.5, size * 0.5]);

  // One WebGL context per canvas for the component's life: losing it between sources would leave the
  // canvas dead (a lost context never comes back), so only the program changes with the source.
  const glRef = useRef<WebGLRenderingContext | null>(null);
  useEffect(() => () => { glRef.current?.getExtension('WEBGL_lose_context')?.loseContext(); glRef.current = null; }, []);

  useEffect(() => {
    const canvas = ref.current; if (!canvas || !source) return;
    const gl = glRef.current && glRef.current.canvas === canvas && !glRef.current.isContextLost() ? glRef.current : canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) { setError('WebGL is not available here.'); onError?.('WebGL is not available here.'); return; }
    glRef.current = gl;
    const { prog, error: err } = compile(gl, source);
    setError(err); onError?.(err);
    if (!prog) return;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    const uRes = gl.getUniformLocation(prog, 'u_resolution'), uTime = gl.getUniformLocation(prog, 'u_time'), uMouse = gl.getUniformLocation(prog, 'u_mouse');
    const t0 = performance.now();
    let raf = 0, alive = true;
    const tick = () => {
      if (!alive) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.uniform2f(uMouse, mouse.current[0], canvas.height - mouse.current[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { alive = false; cancelAnimationFrame(raf); gl.deleteProgram(prog); gl.deleteBuffer(buf); };
  }, [source, onError]);

  return (
    <div style={{ position: 'relative', width: size, height: size, borderRadius: radius.md, overflow: 'hidden', background: '#0d0d12', flexShrink: 0 }}>
      {source && !error && (
        <canvas
          ref={ref} width={size} height={size} aria-label="Function preview"
          onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); mouse.current = [e.clientX - r.left, e.clientY - r.top]; }}
          style={{ display: 'block', width: size, height: size }}
        />
      )}
      {(error || !source) && (
        <div style={{ position: 'absolute', inset: 0, padding: 10, overflow: 'auto', font: `500 10.5px/1.4 ${fontFamily.mono}`, color: error ? '#ffb4a2' : tk.text.faint }}>
          {error ? error.replace(/^ERROR:\s*/, '') : 'No preview'}
        </div>
      )}
    </div>
  );
}
