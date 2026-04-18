import { useEffect, useRef, useCallback } from 'react';

// Use setInterval as fallback when rAF is throttled (e.g., headless/hidden tab)
function scheduleLoop(cb: () => void): () => void {
  let rafId = requestAnimationFrame(function tick() { cb(); rafId = requestAnimationFrame(tick); });
  // If first rAF doesn't fire within 100ms, fall back to setInterval
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const fallbackTimer = setTimeout(() => {
    cancelAnimationFrame(rafId);
    intervalId = setInterval(cb, 16);
  }, 100);
  return () => {
    clearTimeout(fallbackTimer);
    cancelAnimationFrame(rafId);
    if (intervalId) clearInterval(intervalId);
  };
}

const VERTEX_SRC = `
attribute vec2 a_position;
varying vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`.trim();

const FALLBACK_FRAG = `
precision mediump float;
void main() { gl_FragColor = vec4(0.07, 0.07, 0.11, 1.0); }
`.trim();

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

function getShaderError(gl: WebGLRenderingContext, type: number, src: string): string[] {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return []; }
  const log = gl.getShaderInfoLog(s) ?? '';
  gl.deleteShader(s);
  return log.split('\n').filter(l => l.trim());
}

function createProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

interface Props {
  shaderSource: string;
  xRange: [number, number];
  yRange: [number, number];
  onError: (errors: string[]) => void;
}

export function PreviewCanvas({ shaderSource, xRange, yRange, onError }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const glRef      = useRef<WebGLRenderingContext | null>(null);
  const progRef    = useRef<WebGLProgram | null>(null);
  const startRef   = useRef<number>(Date.now());
  const rangeRef   = useRef({ xRange, yRange });
  // Store onError in a ref so it never causes effect re-runs
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Keep range ref current without rebuilding shader
  useEffect(() => { rangeRef.current = { xRange, yRange }; }, [xRange, yRange]);

  const buildProgram = useCallback((gl: WebGLRenderingContext, fragSrc: string) => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    if (!vs) return null;

    const fsErrors = getShaderError(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (fsErrors.length > 0) { onErrorRef.current(fsErrors); return null; }

    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)!;
    const prog = createProgram(gl, vs, fs);
    if (!prog) { onErrorRef.current(['Program link failed']); return null; }

    onErrorRef.current([]);
    return prog;
  }, []); // no deps — uses stable refs

  // Initialize WebGL once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return;
    glRef.current = gl;

    gl.getExtension('OES_standard_derivatives');
    const vertices = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const loop = () => {
      const gl = glRef.current;
      const prog = progRef.current;
      if (!gl || !prog || !canvas) return;

      const w = canvas.clientWidth * devicePixelRatio;
      const h = canvas.clientHeight * devicePixelRatio;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      gl.useProgram(prog);

      const t = (Date.now() - startRef.current) / 1000;
      const uTime = gl.getUniformLocation(prog, 'u_time');
      const uRes  = gl.getUniformLocation(prog, 'u_resolution');
      const uXMin = gl.getUniformLocation(prog, 'u_xMin');
      const uXMax = gl.getUniformLocation(prog, 'u_xMax');
      const uYMin = gl.getUniformLocation(prog, 'u_yMin');
      const uYMax = gl.getUniformLocation(prog, 'u_yMax');
      gl.uniform1f(uTime, t);
      gl.uniform2f(uRes, w, h);
      const { xRange, yRange } = rangeRef.current;
      gl.uniform1f(uXMin, xRange[0]);
      gl.uniform1f(uXMax, xRange[1]);
      gl.uniform1f(uYMin, yRange[0]);
      gl.uniform1f(uYMax, yRange[1]);

      const pos = gl.getAttribLocation(prog, 'a_position');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    return scheduleLoop(loop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompile when shaderSource changes
  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;

    if (progRef.current) gl.deleteProgram(progRef.current);
    const src = shaderSource || FALLBACK_FRAG;
    // On compile error fall back to a solid-dark program so the canvas clears
    // rather than retaining the last successfully rendered frame.
    const mainProg = buildProgram(gl, src);
    const prog = mainProg ?? buildProgram(gl, FALLBACK_FRAG) ?? null;
    progRef.current = prog;
    // If the main shader failed, immediately clear to dark so we don't show a stale frame.
    if (!mainProg && prog) {
      gl.useProgram(prog);
      gl.clearColor(0.07, 0.07, 0.11, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }, [shaderSource, buildProgram]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
