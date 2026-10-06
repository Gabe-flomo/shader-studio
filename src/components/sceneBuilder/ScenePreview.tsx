/**
 * ScenePreview — the Scene Builder's live picture: the spec built into a graph
 * (the same graph Build makes), compiled, and drawn by a small WebGL2 canvas
 * of its own, so the form can be tried before anything touches the canvas.
 * Recompiles a moment after the spec stops changing; animates (the camera's
 * orbit) while it is on screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import type { SceneSpec } from '../../sceneBuilder/spec';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

type Compiled = { vs: string; fs: string; uniforms: Record<string, number | number[]>; nodes: number; error: string | null; ms: number };

function compileSpec(spec: SceneSpec): Compiled {
  const t0 = performance.now();
  try {
    const g = buildStandaloneGraph(spec, { idFor: role => `pv_${role.replace(/[^A-Za-z0-9]/g, '_')}` });
    const r = compileGraph({ nodes: g.nodes });
    if (!r.success) return { vs: '', fs: '', uniforms: {}, nodes: g.nodes.length, error: (r.errors ?? []).join('; ') || 'The graph did not compile.', ms: performance.now() - t0 };
    return { vs: r.vertexShader, fs: r.fragmentShader, uniforms: r.paramUniforms as Record<string, number | number[]>, nodes: g.nodes.length, error: null, ms: performance.now() - t0 };
  } catch (e) {
    return { vs: '', fs: '', uniforms: {}, nodes: 0, error: e instanceof Error ? e.message : String(e), ms: 0 };
  }
}

/** The app's shaders are written for three.js's GLSL 1 front end; this is what it adds for WebGL2. */
const VS_HEAD = '#version 300 es\n#define attribute in\n#define varying out\nin vec3 position;\nin vec2 uv;\n';
const FS_HEAD = '#version 300 es\n#define varying in\n#define gl_FragColor pc_fragColor\n#define texture2D texture\nout highp vec4 pc_fragColor;\n';
const strip = (src: string) => src.replace(/^\s*#extension.*$/gm, '').replace(/^\s*#version.*$/gm, '');

function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | string {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return gl.getShaderInfoLog(s) ?? 'compile error';
    return s;
  };
  const v = sh(gl.VERTEX_SHADER, VS_HEAD + strip(vs));
  if (typeof v === 'string') return `Vertex: ${v}`;
  const f = sh(gl.FRAGMENT_SHADER, FS_HEAD + strip(fs));
  if (typeof f === 'string') return f;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return gl.getProgramInfoLog(p) ?? 'link error';
  return p;
}

export function ScenePreview({ spec, height = 240 }: { spec: SceneSpec; height?: number }) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debounced, setDebounced] = useState(spec);
  useEffect(() => { const t = setTimeout(() => setDebounced(spec), 160); return () => clearTimeout(t); }, [spec]);
  const compiled = useMemo(() => compileSpec(debounced), [debounced]);
  const [glError, setGlError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || compiled.error) return;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) { setGlError('WebGL2 is not available here.'); return; }
    const prog = makeProgram(gl, compiled.vs, compiled.fs);
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
    for (const [name, v] of Object.entries(compiled.uniforms)) {
      const loc = gl.getUniformLocation(prog, name);
      if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    let raf = 0, last = 0, t = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / 30) return;
      const dt = (now - (last || now)) / 1000;
      last = now;
      if (!pausedRef.current && !document.hidden) t += dt;
      const w = Math.max(1, Math.round(canvas.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    };
  }, [compiled]);

  const error = compiled.error ?? glError;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', height, borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render }}>
        <canvas ref={canvasRef} data-scene-preview aria-label="Live preview of the scene" style={{ width: '100%', height: '100%', display: 'block' }} />
        {error && (
          <div style={{ position: 'absolute', inset: 0, padding: 12, overflow: 'auto', color: '#f38ba8', font: `500 11px ${fontFamily.mono}`, background: 'rgba(13,13,18,0.86)' }}>
            {error}
          </div>
        )}
        <button type="button" onClick={() => setPaused(p => !p)} title={paused ? 'Play the preview' : 'Pause the preview'}
          style={{ position: 'absolute', right: 6, bottom: 6, height: 24, padding: '0 8px', border: 0, borderRadius: 6, background: 'rgba(0,0,0,0.45)', color: '#fff', font: `600 11px ${fontFamily.ui}`, cursor: 'pointer' }}>
          {paused ? 'Play' : 'Pause'}
        </button>
      </div>
      <span style={{ fontSize: 11.5, color: tk.text.muted }}>{error ? 'The preview could not draw this scene.' : `Live: the graph Build makes, compiled in ${Math.round(compiled.ms)} ms`}</span>
    </div>
  );
}
