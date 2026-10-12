/**
 * shapesBench.ts — dev only: Draw agents' Shapes (lib/agentShapes.ts) timed and looked at outside the
 * app, on synthetic walkers, through the same renderer the runner draws with (AgentShapeRenderer).
 * The numbers in docs/particle-shapes.md's table come from here. In the dev build it is on
 * `window.__shaderStudioDev.shapes()`:
 *
 *   const b = await (await __shaderStudioDev.shapes()).shapesBench({ count: 200_000, shape: 'cube', shading: 'faces' })
 *   // { ms, drawn, vertices }: GPU ms a frame (median of `frames`), at 1920 × 1080
 *   (await __shaderStudioDev.shapes()).shapesPicture({ shape: 'voxel', shading: 'facesEdges' })  // a PNG data URL
 *   (await __shaderStudioDev.shapes()).compileAll()  // every variant compiled on this GPU: [] when all pass
 */
import * as THREE from 'three';
import { AgentShapeRenderer, type ShapeDrawLook } from '../lib/agentShapeRenderer';
import { SHAPE_DEFAULTS, allShapeVariants, shapeShaders, type Facing, type Shading, type ShapeKind, type SphereDetail } from '../lib/agentShapes';
import { agCamera3 } from '../play/kit/agentPlan.js';

export interface BenchOpts {
  count?: number; shape?: ShapeKind; shading?: Shading; facing?: Facing; detail?: SphereDetail; size?: number; grid?: number; dedupe?: boolean;
  every?: number; maxShapes?: number; farDots?: number; halfRes?: boolean; frames?: number; w?: number; h?: number; layout?: 'box' | 'shell' | 'sheet';
  camDist?: number; camAngle?: number; camElevation?: number;
}

let ctx: { renderer: THREE.WebGLRenderer; geometry: THREE.BufferGeometry; shapes: AgentShapeRenderer; canvas: HTMLCanvasElement } | null = null;
function context(w: number, h: number) {
  if (!ctx) {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.autoClear = false;
    const geometry = new THREE.BufferGeometry();
    ctx = { renderer, geometry, shapes: new AgentShapeRenderer(geometry), canvas };
  }
  ctx.renderer.setPixelRatio(1);
  ctx.renderer.setSize(w, h, false);
  return ctx;
}

/** Walkers: in the box, on a lumpy shell, or on a gyroid sheet through the box (slime-like), heading round the middle, every one alive. */
function state(count: number, layout: 'box' | 'shell' | 'sheet', aspect: number) {
  const side = Math.ceil(Math.sqrt(count));
  const A = new Float32Array(side * side * 4), B = new Float32Array(side * side * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number;
    if (layout === 'sheet') {
      // A slime-like network through the whole box: points near a gyroid's sheet, many layers deep.
      do { x = (rnd() * 2 - 1) * aspect * 0.95; y = (rnd() * 2 - 1) * 0.95; z = (rnd() * 2 - 1) * 0.95; }
      while (Math.abs(Math.sin(x * 5) * Math.cos(y * 5) + Math.sin(y * 5) * Math.cos(z * 5) + Math.sin(z * 5) * Math.cos(x * 5)) > 0.12);
    } else if (layout === 'shell') {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 0.75 + 0.08 * Math.sin(a * 5) * Math.cos(u * 7) + (rnd() - 0.5) * 0.03;
      x = Math.sqrt(1 - u * u) * Math.cos(a) * r; y = u * r * 0.9; z = Math.sqrt(1 - u * u) * Math.sin(a) * r;
    } else { x = (rnd() * 2 - 1) * aspect * 0.95; y = (rnd() * 2 - 1) * 0.95; z = (rnd() * 2 - 1) * 0.95; }
    A.set([x, y, z, rnd() * 5], i * 4);
    const s = 0.2 + rnd() * 0.4;
    B.set([-z * s, (rnd() - 0.5) * 0.2, x * s, 1e30], i * 4);
  }
  const tex = (d: Float32Array) => { const t = new THREE.DataTexture(d, side, side, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; };
  return { side, a: tex(A), b: tex(B) };
}

function look(o: BenchOpts): ShapeDrawLook {
  const D = SHAPE_DEFAULTS;
  return {
    shape: o.shape ?? 'cube', shading: o.shading ?? 'faces', facing: o.facing ?? 'motion', detail: o.detail ?? 'impostor',
    size: o.size ?? 0.008, sizeBy: 0, rodLength: D.rodLength, rodStretch: 0, spin: 1, grid: o.grid ?? 0.03, dedupe: o.dedupe ?? true,
    every: o.every ?? 1, maxShapes: o.maxShapes ?? 0, farDots: o.farDots ?? 0, ambient: D.ambient, rim: D.rim, edgeWidth: D.edgeWidth,
    colorBy: 3, bright: 1, speedRef: 0.5, fade: false, usePal: false, rainbow: false, pal: null, colA: [1, 0.62, 0.25], colB: [0.3, 0.62, 1],
  };
}

function setup(o: BenchOpts) {
  const w = o.w ?? 1920, h = o.h ?? 1080;
  const c = context(w, h);
  const aspect = w / h;
  const st = state(o.count ?? 200_000, o.layout ?? 'box', aspect);
  const tw = o.halfRes ? Math.ceil(w / 2) : w, th = o.halfRes ? Math.ceil(h / 2) : h;
  const target = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const read = (p: unknown, d: number) => (typeof p === 'number' ? p : d);
  const cam = agCamera3({ params: { camDist: o.camDist ?? 3.4, camAngle: o.camAngle ?? 25, camElevation: o.camElevation ?? 22 } }, read, 0, th);
  return { c, aspect, st, target, cam };
}

/** GPU ms a frame drawing the shapes (timer queries, median), or wall-clock with a finish when they aren't there. */
export async function shapesBench(o: BenchOpts = {}): Promise<{ ms: number; drawn: number; vertices: number; timer: 'gpu' | 'cpu' }> {
  const { c, aspect, st, target, cam } = setup(o);
  const gl = c.renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const lk = look(o);
  const s = { a: st.a, b: st.b, c: null, e: null, side: st.side, species: 1 };
  const draw = (t: number) => c.shapes.draw(c.renderer, target, s, lk, cam, aspect, t, null);
  for (let i = 0; i < 4; i++) draw(i / 60);
  gl.finish();
  const frames = o.frames ?? 24;
  const times: number[] = [];
  for (let i = 0; i < frames; i++) {
    if (ext) {
      gl.flush();
      const q = gl.createQuery()!;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      draw(i / 60);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.finish();
      for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(r => setTimeout(r, 2));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    } else {
      gl.finish();
      const t0 = performance.now();
      draw(i / 60);
      gl.finish();
      times.push(performance.now() - t0);
    }
  }
  target.dispose(); st.a.dispose(); st.b.dispose();
  times.sort((x, y) => x - y);
  return { ms: Math.round((times[Math.floor(times.length / 2)] ?? 0) * 100) / 100, drawn: c.shapes.last.drawn, vertices: c.shapes.last.vertices, timer: ext ? 'gpu' : 'cpu' };
}

/** One frame of shapes over a dark grey, as a PNG data URL (for looking at). */
export function shapesPicture(o: BenchOpts = {}): string {
  const { c, aspect, st, target, cam } = setup({ w: 1280, h: 720, count: 30_000, layout: 'shell', ...o });
  const lk = look({ size: 0.02, ...o });
  c.shapes.draw(c.renderer, target, { a: st.a, b: st.b, c: null, e: null, side: st.side, species: 1 }, lk, cam, aspect, 1, null);
  // Composite over a backdrop: the picture's own sum (Over × (1 − cover) + colour).
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'in vec3 position; out vec2 uv; void main() { uv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; uniform sampler2D t; in vec2 uv; out vec4 o; void main() { vec4 s = texture(t, uv); o = vec4(vec3(0.07, 0.075, 0.09) * (1.0 - s.a) + s.rgb, 1.0); }',
    uniforms: { t: { value: target.texture } }, depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const sc = new THREE.Scene(); sc.add(quad);
  c.renderer.setRenderTarget(null);
  c.renderer.clear();
  c.renderer.render(sc, new THREE.Camera());
  const url = c.canvas.toDataURL('image/png');
  mat.dispose(); quad.geometry.dispose(); target.dispose(); st.a.dispose(); st.b.dispose();
  return url;
}

/** Every variant compiled and linked on this GPU: the failures (empty when all pass). */
export function compileAll(): Array<{ variant: string; log: string }> {
  const gl = context(64, 64).renderer.getContext() as WebGL2RenderingContext;
  const out: Array<{ variant: string; log: string }> = [];
  for (const v of allShapeVariants()) {
    const { vertex, fragment } = shapeShaders(v);
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, `#version 300 es\n${src}`); gl.compileShader(s); return s; };
    const vs = sh(gl.VERTEX_SHADER, vertex), fs = sh(gl.FRAGMENT_SHADER, fragment);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) out.push({ variant: `${v.cls}:${v.shading}:${v.detail}`, log: `${gl.getShaderInfoLog(vs) ?? ''}${gl.getShaderInfoLog(fs) ?? ''}${gl.getProgramInfoLog(p) ?? ''}` });
    gl.deleteProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
  }
  return out;
}

/** The whole table: each count × shape × shading, GPU ms a frame. */
export async function shapesTable(counts = [50_000, 200_000, 500_000, 1_000_000], shapes: Array<{ shape: ShapeKind; detail?: SphereDetail }> = [{ shape: 'cube' }], shadings: Shading[] = ['flat', 'faces', 'facesEdges', 'lit', 'litEdges']) {
  const rows: Array<Record<string, unknown>> = [];
  for (const s of shapes) for (const shading of shadings) for (const count of counts) rows.push({ ...s, shading, count, ...(await shapesBench({ ...s, shading, count })) });
  return rows;
}
