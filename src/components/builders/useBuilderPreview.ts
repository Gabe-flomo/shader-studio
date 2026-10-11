/**
 * useBuilderPreview — the 2D and 3D Scene Builders' live pictures (docs/scene-builder.md, "The
 * preview comes first"), shared:
 *
 *  - compiling follows the form while you drag, at most every COMPILE_EVERY_MS (the first change
 *    at once, the last one always), instead of waiting until the drag stops;
 *  - a compile whose shaders are the same as the last one's, comments aside (a slider moved a
 *    value the graph keeps as a uniform) only sets the uniforms: no new program, nothing relinked;
 *  - the canvas draws every animation frame at the screen's pixel density (up to 2×), not 30 a
 *    second at CSS pixels; paused, it draws only when something changed.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { makeProgram, type Compiled } from '../sceneBuilder/previewGl';
import { bindPreviewTextures } from './previewTextures';

/** The quickest compiles follow a drag (about 20 a second). */
export const COMPILE_EVERY_MS = 50;

/**
 * `value`, but changing at most every `ms`: the first change shows at once, a run of changes
 * every `ms`, and the last one always lands. For compiling a spec while a slider is dragged.
 */
export function useThrottled<T>(value: T, ms = COMPILE_EVERY_MS): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = Math.max(0, last.current + ms - performance.now());
    const t = setTimeout(() => { last.current = performance.now(); setShown(value); }, wait);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

type Uniforms = Compiled['uniforms'];

/**
 * A shader without its comments: what decides whether a new program is needed. The compiler writes
 * each node's note into the code, and a note can quote a value ("3.6 away"), so two compiles that
 * differ only there are the same program with different uniforms.
 */
export const shaderKey = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/[ \t]+\n/g, '\n');

/**
 * Draw `compiled` into `canvasRef` every frame. Returns a GL error (shader compile or link), if any.
 * `clockRef`, when given, is the picture's clock (seconds): the 3D viewport reads it to put its
 * gizmo where an orbiting camera is now.
 */
export function useBuilderPreview(canvasRef: RefObject<HTMLCanvasElement | null>, compiled: Compiled, paused: boolean, clockRef?: { current: number }): string | null {
  const [glError, setGlError] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  // The clock carries on across a new program (a structural change while dragging doesn't jump the picture back).
  const ownClock = useRef(0);
  const clock = clockRef ?? ownClock;
  pausedRef.current = paused;
  const uniforms = useRef<{ values: Uniforms; dirty: boolean }>({ values: compiled.uniforms, dirty: true });
  // Every compile hands its uniforms to the running program (no relink when the shaders are the same).
  useEffect(() => { uniforms.current = { values: compiled.uniforms, dirty: true }; }, [compiled.uniforms]);

  const { error } = compiled;
  const vs = useMemo(() => shaderKey(compiled.vs), [compiled.vs]);
  const fs = useMemo(() => shaderKey(compiled.fs), [compiled.fs]);
  // Its pictures (sampler → the graph node it shows), bound with the program (previewTextures.ts).
  const texKey = JSON.stringify(compiled.textures ?? {});
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || error || !vs || !fs) return;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) { setGlError('WebGL2 is not available here.'); return; }
    const prog = makeProgram(gl, vs, fs);
    if (typeof prog === 'string') { setGlError(prog.slice(0, 400)); return; }
    setGlError(null);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One quad: x, y, z, u, v.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 0, 1, -1, 0, 1, 0, -1, 1, 0, 0, 1, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posLoc = gl.getAttribLocation(prog, 'position');
    const uvLoc = gl.getAttribLocation(prog, 'uv');
    if (posLoc >= 0) { gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0); }
    if (uvLoc >= 0) { gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12); }
    gl.useProgram(prog);
    const locs = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => { if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name)); return locs.get(name) ?? null; };
    const setUniforms = (values: Uniforms) => {
      for (const [name, v] of Object.entries(values)) {
        const l = loc(name);
        if (!l) continue;
        if (typeof v === 'number') gl.uniform1f(l, v);
        else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
      }
    };
    uniforms.current.dirty = true;
    const pictures = bindPreviewTextures(gl, prog, JSON.parse(texKey) as Record<string, string>);
    let frames = 0;
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    let raf = 0, last = 0, sized = '';
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      if (document.hidden) return;
      const running = !pausedRef.current;
      if (running) clock.current += Math.min(dt, 0.1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      const size = `${w}x${h}`;
      const resized = size !== sized;
      if (resized) { sized = size; if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } }
      const u = uniforms.current;
      if (!running && !u.dirty && !resized) return;
      if (u.dirty) { setUniforms(u.values); u.dirty = false; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, clock.current);
      pictures.refresh(frames++);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      pictures.dispose();
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    };
  }, [canvasRef, vs, fs, error, texKey]);

  return error ?? glError;
}
