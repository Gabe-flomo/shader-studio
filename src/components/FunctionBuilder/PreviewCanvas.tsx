import { useEffect, useRef, useCallback } from 'react';

// Use setInterval as fallback when rAF is throttled (e.g., headless/hidden tab)
function scheduleLoop(cb: () => void): () => void {
  // Plain rAF. A hidden tab simply doesn't get frames, which is the point —
  // the old setInterval fallback kept this loop running at 60 Hz in the
  // background forever once it had kicked in.
  let rafId = requestAnimationFrame(function tick() { cb(); rafId = requestAnimationFrame(tick); });
  return () => cancelAnimationFrame(rafId);
}

/** Uniform / attribute locations, looked up once per program instead of six times per frame. */
interface ProgramLocations {
  uTime: WebGLUniformLocation | null; uRes: WebGLUniformLocation | null;
  uXMin: WebGLUniformLocation | null; uXMax: WebGLUniformLocation | null;
  uYMin: WebGLUniformLocation | null; uYMax: WebGLUniformLocation | null;
  pos: number;
}
function lookupLocations(gl: WebGLRenderingContext, prog: WebGLProgram): ProgramLocations {
  return {
    uTime: gl.getUniformLocation(prog, 'u_time'),
    uRes:  gl.getUniformLocation(prog, 'u_resolution'),
    uXMin: gl.getUniformLocation(prog, 'u_xMin'),
    uXMax: gl.getUniformLocation(prog, 'u_xMax'),
    uYMin: gl.getUniformLocation(prog, 'u_yMin'),
    uYMax: gl.getUniformLocation(prog, 'u_yMax'),
    pos:   gl.getAttribLocation(prog, 'a_position'),
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
void main() { gl_FragColor = vec4(0.0); }
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
  const locRef     = useRef<ProgramLocations | null>(null);
  const startRef   = useRef<number>(Date.now());
  const rangeRef   = useRef({ xRange, yRange });
  // Store onError in a ref so it never causes effect re-runs
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Keep range ref current without rebuilding shader
  useEffect(() => { rangeRef.current = { xRange, yRange }; }, [xRange, yRange]);

  // `report` is off for the fallback program, whose success must not clear the real shader's errors.
  const buildProgram = useCallback((gl: WebGLRenderingContext, fragSrc: string, report = true) => {
    const onError = (errors: string[]) => { if (report) onErrorRef.current(errors); };
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    if (!vs) return null;

    const fsErrors = getShaderError(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (fsErrors.length > 0) { onError(fsErrors); return null; }

    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)!;
    const prog = createProgram(gl, vs, fs);
    if (!prog) { onError(['Program link failed']); return null; }

    onError([]);
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
      const loc = locRef.current;
      if (!gl || !prog || !loc || !canvas) return;
      // Nothing to show while the tab is hidden; the clock keeps running.
      if (document.hidden) return;

      const w = canvas.clientWidth * devicePixelRatio;
      const h = canvas.clientHeight * devicePixelRatio;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      gl.useProgram(prog);

      const t = (Date.now() - startRef.current) / 1000;
      gl.uniform1f(loc.uTime, t);
      gl.uniform2f(loc.uRes, w, h);
      const { xRange, yRange } = rangeRef.current;
      gl.uniform1f(loc.uXMin, xRange[0]);
      gl.uniform1f(loc.uXMax, xRange[1]);
      gl.uniform1f(loc.uYMin, yRange[0]);
      gl.uniform1f(loc.uYMax, yRange[1]);

      gl.enableVertexAttribArray(loc.pos);
      gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
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
    // On compile error fall back to a transparent program so the canvas clears
    // rather than retaining the last successfully rendered frame.
    const mainProg = buildProgram(gl, src);
    const prog = mainProg ?? buildProgram(gl, FALLBACK_FRAG, false) ?? null;
    progRef.current = prog;
    locRef.current = prog ? lookupLocations(gl, prog) : null;
    // If the main shader failed, clear immediately so we don't show a stale frame.
    if (!mainProg && prog) {
      gl.useProgram(prog);
      gl.clearColor(0, 0, 0, 0);
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
