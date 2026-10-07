/**
 * previewGl.ts — the Scene Builder's own small WebGL2 drawing: a spec built into the graph Build
 * makes, compiled, and turned into a program. Shared by the live preview (ScenePreview.tsx) and
 * Surprise me's frame check (surpriseActions.ts).
 */
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import type { SceneSpec } from '../../sceneBuilder/spec';

export type Compiled = { vs: string; fs: string; uniforms: Record<string, number | number[]>; nodes: number; error: string | null; ms: number };

export function compileSpec(spec: SceneSpec): Compiled {
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
export const VS_HEAD = '#version 300 es\n#define attribute in\n#define varying out\nin vec3 position;\nin vec2 uv;\n';
export const FS_HEAD = '#version 300 es\n#define varying in\n#define gl_FragColor pc_fragColor\n#define texture2D texture\nout highp vec4 pc_fragColor;\n';
const strip = (src: string) => src.replace(/^\s*#extension.*$/gm, '').replace(/^\s*#version.*$/gm, '');

export function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | string {
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
