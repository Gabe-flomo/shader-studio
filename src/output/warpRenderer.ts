/**
 * warpRenderer.ts — the projection mapping's final pass, in WebGL2.
 *
 * Takes the finished picture (the player's canvases: the shader's, the
 * layers', the Finish stack's) as textures and draws each surface through its
 * corner pin and mesh (warp.ts), with its source region, edge blend,
 * brightness and gamma, or a test pattern instead of the picture; then the
 * masks, black, through the stencil buffer (any polygon, even concave).
 *
 * Used by the output window (the real thing) and by the Mapping editor's
 * preview (the same pass on a snapshot of the main window's picture).
 */
import type { ProjectionRecord, ProjSurface, TestPattern } from '../types/projection';
import { surfaceGeometry } from './warp';

export interface WarpSources {
  /** The shader's canvas. */
  shader: TexImageSource | null;
  /** The layers' canvas (transparent where no layer draws). */
  layers: TexImageSource | null;
  /** The Finish stack's canvas when it drew this frame: the picture and the layers, finished. */
  finished: TexImageSource | null;
  /** A layer-or-group surface's picture (its layers alone), by surface id. */
  surfaceLayers?: (surfaceId: string) => TexImageSource | null;
}

const PATTERN_IDS: Record<TestPattern, number> = { none: 0, grid: 1, crosshair: 2, bars: 3, white: 4 };

const VS = `#version 300 es
in vec3 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() { v_uv = a_uv; gl_Position = vec4(a_pos.x, a_pos.y, 0.0, a_pos.z); }`;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform int u_mode;       // 0: a (opaque), 1: b over a, 2: b over black
uniform vec4 u_region;    // x, y, w, h in the picture (top left origin)
uniform int u_pattern;    // 0 none, 1 grid, 2 crosshair, 3 bars, 4 white
uniform vec4 u_blend;     // left, right, top, bottom widths
uniform vec2 u_curve;     // ramp curve, projector gamma
uniform vec2 u_tone;      // brightness, gamma
uniform float u_selected;

float lineAt(float x, float n, float px) {
  float d = abs(fract(x * n + 0.5) - 0.5) / n;
  float w = max(fwidth(x) * px, 1e-5);
  return 1.0 - smoothstep(w * 0.5, w * 1.5, d);
}
float lineNear(float x, float c, float px) {
  float w = max(fwidth(x) * px, 1e-5);
  return 1.0 - smoothstep(w * 0.5, w * 1.5, abs(x - c));
}
vec3 pattern(vec2 uv) {
  if (u_pattern == 4) return vec3(1.0);
  if (u_pattern == 3) {
    int i = int(clamp(floor(uv.x * 7.0), 0.0, 6.0));
    vec3 bars[7] = vec3[7](vec3(0.75), vec3(0.75, 0.75, 0.0), vec3(0.0, 0.75, 0.75), vec3(0.0, 0.75, 0.0), vec3(0.75, 0.0, 0.75), vec3(0.75, 0.0, 0.0), vec3(0.0, 0.0, 0.75));
    vec3 c = bars[i];
    // The bottom strip: black to white steps, for the projector's levels.
    if (uv.y > 0.8) c = vec3(floor(uv.x * 8.0) / 7.0);
    return c;
  }
  float border = max(max(lineNear(uv.x, 0.0, 6.0), lineNear(uv.x, 1.0, 6.0)), max(lineNear(uv.y, 0.0, 6.0), lineNear(uv.y, 1.0, 6.0)));
  float centre = max(lineNear(uv.x, 0.5, 3.0), lineNear(uv.y, 0.5, 3.0));
  vec3 c = vec3(0.0);
  if (u_pattern == 1) {
    float g = max(lineAt(uv.x, 8.0, 1.5), lineAt(uv.y, 8.0, 1.5));
    float fine = max(lineAt(uv.x, 32.0, 1.0), lineAt(uv.y, 32.0, 1.0)) * 0.25;
    float r = length((uv - 0.5) * vec2(1.0, 1.0));
    float ring = max(lineNear(r, 0.25, 2.0), lineNear(r, 0.45, 2.0));
    c = vec3(max(max(g, fine), max(centre, ring)));
  } else {
    float diag = max(lineNear(uv.x - uv.y, 0.0, 2.0), lineNear(uv.x + uv.y, 1.0, 2.0));
    c = vec3(max(centre, diag * 0.6));
  }
  c = max(c, vec3(border));
  // The corners, so which way round the surface is shows at a glance: red, green, blue, yellow clockwise from top left.
  float k = 0.07;
  if (uv.x < k && uv.y < k) c = vec3(1.0, 0.2, 0.2);
  else if (uv.x > 1.0 - k && uv.y < k) c = vec3(0.2, 1.0, 0.2);
  else if (uv.x > 1.0 - k && uv.y > 1.0 - k) c = vec3(0.25, 0.45, 1.0);
  else if (uv.x < k && uv.y > 1.0 - k) c = vec3(1.0, 0.9, 0.2);
  if (u_selected > 0.5) c = mix(c, vec3(0.35, 0.55, 1.0) * 0.5 + c * 0.5, 0.25);
  return c;
}
float ramp(float d, float w) {
  if (w <= 0.0) return 1.0;
  float x = clamp(d / w, 0.0, 1.0);
  float s = x < 0.5 ? 0.5 * pow(2.0 * x, u_curve.x) : 1.0 - 0.5 * pow(2.0 * (1.0 - x), u_curve.x);
  return pow(s, 1.0 / u_curve.y);
}
void main() {
  vec2 uv = clamp(v_uv, 0.0, 1.0);
  vec3 col;
  if (u_pattern > 0) col = pattern(uv);
  else {
    vec2 st = u_region.xy + uv * u_region.zw;
    vec4 a = texture(u_a, st);
    vec4 b = texture(u_b, st);
    col = u_mode == 0 ? a.rgb * a.a : u_mode == 1 ? mix(a.rgb * a.a, b.rgb, b.a) : b.rgb * b.a;
  }
  col = pow(max(col, vec3(0.0)), vec3(1.0 / u_tone.y)) * u_tone.x;
  float f = ramp(uv.x, u_blend.x) * ramp(1.0 - uv.x, u_blend.y) * ramp(uv.y, u_blend.z) * ramp(1.0 - uv.y, u_blend.w);
  o = vec4(col * f, f);
}`;

const MASK_VS = `#version 300 es
in vec2 a_p;
void main() { gl_Position = vec4(a_p, 0.0, 1.0); }`;
const MASK_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0, 0.0, 0.0, 1.0); }`;

interface GeoEntry { key: string; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number }

export class WarpRenderer {
  readonly ok: boolean;
  private gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private maskProg: WebGLProgram | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private geo = new Map<string, GeoEntry>();
  private tex = new Map<string, { t: WebGLTexture; frame: number }>();
  private blank: WebGLTexture | null = null;
  private maskBuf: WebGLBuffer | null = null;
  private frame = 0;
  private vao: WebGLVertexArrayObject | null = null;

  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, stencil: true, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    this.ok = !!this.gl && this.init();
  }

  private compile(vs: string, fs: string): WebGLProgram | null {
    const gl = this.gl!;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[warp]', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram()!;
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_uv');
    gl.bindAttribLocation(p, 0, 'a_p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[warp]', gl.getProgramInfoLog(p)); return null; }
    return p;
  }

  private init(): boolean {
    const gl = this.gl!;
    this.prog = this.compile(VS, FS);
    this.maskProg = this.compile(MASK_VS, MASK_FS);
    if (!this.prog || !this.maskProg) return false;
    for (const n of ['u_a', 'u_b', 'u_mode', 'u_region', 'u_pattern', 'u_blend', 'u_curve', 'u_tone', 'u_selected']) this.loc[n] = gl.getUniformLocation(this.prog, n);
    this.vao = gl.createVertexArray();
    this.blank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.maskBuf = gl.createBuffer();
    return true;
  }

  /** A canvas or video as a texture, uploaded once a frame whoever asks. */
  private texture(key: string, src: TexImageSource | null): WebGLTexture {
    const gl = this.gl!;
    if (!src) return this.blank!;
    let e = this.tex.get(key);
    if (!e) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e = { t, frame: -1 };
      this.tex.set(key, e);
    }
    if (e.frame !== this.frame) {
      e.frame = this.frame;
      gl.bindTexture(gl.TEXTURE_2D, e.t);
      // Row 0 at the top, colours as they are, straight alpha: picture space is top-left based.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch { /* a canvas with no size yet */ }
    }
    return e.t;
  }

  private geometry(s: ProjSurface): GeoEntry {
    const gl = this.gl!;
    const key = JSON.stringify([s.corners, s.mesh.on ? s.mesh : 0]);
    let e = this.geo.get(s.id);
    if (e && e.key === key) return e;
    const g = surfaceGeometry(s);
    if (!e) { e = { key, vbo: gl.createBuffer()!, ibo: gl.createBuffer()!, count: 0 }; this.geo.set(s.id, e); }
    e.key = key;
    gl.bindBuffer(gl.ARRAY_BUFFER, e.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, g.vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.DYNAMIC_DRAW);
    e.count = g.indices.length;
    return e;
  }

  /**
   * Draw one frame at the canvas's size. `pattern` replaces the picture on
   * every surface; `selected` tints that surface's pattern.
   */
  render(projection: ProjectionRecord, sources: WarpSources, pattern: TestPattern = 'none', selected: string | null = null): void {
    const gl = this.gl;
    if (!gl || !this.ok) return;
    this.frame++;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.loc.u_a, 0);
    gl.uniform1i(this.loc.u_b, 1);
    const pat = PATTERN_IDS[pattern] ?? 0;
    for (const s of projection.surfaces) {
      if (!s.enabled) continue;
      let a: WebGLTexture = this.blank!, b: WebGLTexture = this.blank!, mode = 0;
      if (!pat) {
        switch (s.source.kind) {
          case 'shader': a = this.texture('shader', sources.shader); mode = 0; break;
          case 'layers': b = this.texture('layers', sources.layers); mode = 2; break;
          case 'layer': case 'group': b = this.texture(`sel:${s.id}`, sources.surfaceLayers?.(s.id) ?? null); mode = 2; break;
          default:
            if (sources.finished) { a = this.texture('finished', sources.finished); mode = 0; }
            else { a = this.texture('shader', sources.shader); b = this.texture('layers', sources.layers); mode = sources.layers ? 1 : 0; }
        }
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b);
      gl.uniform1i(this.loc.u_mode, mode);
      gl.uniform4f(this.loc.u_region, s.region.x, s.region.y, s.region.w, s.region.h);
      gl.uniform1i(this.loc.u_pattern, pat);
      gl.uniform4f(this.loc.u_blend, s.blend.left, s.blend.right, s.blend.top, s.blend.bottom);
      gl.uniform2f(this.loc.u_curve, s.blend.curve, s.blend.gamma);
      gl.uniform2f(this.loc.u_tone, s.brightness, s.gamma);
      gl.uniform1f(this.loc.u_selected, s.id === selected ? 1 : 0);
      const g = this.geometry(s);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disableVertexAttribArray(1);
    gl.activeTexture(gl.TEXTURE0);
    this.drawMasks(projection);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    // Surfaces gone from the mapping let go of their buffers.
    if (this.geo.size > projection.surfaces.length) {
      const ids = new Set(projection.surfaces.map(s => s.id));
      for (const [id, e] of this.geo) if (!ids.has(id)) { gl.deleteBuffer(e.vbo); gl.deleteBuffer(e.ibo); this.geo.delete(id); }
    }
  }

  /** Each mask: its polygon flips the stencil (even-odd, so concave shapes work), then black where it's inside (or outside, inverted). */
  private drawMasks(p: ProjectionRecord): void {
    const gl = this.gl!;
    const masks = p.masks.filter(m => m.enabled && m.points.length >= 3);
    if (!masks.length) return;
    gl.useProgram(this.maskProg);
    gl.disable(gl.BLEND);
    gl.enable(gl.STENCIL_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuf);
    gl.enableVertexAttribArray(0);
    for (const m of masks) {
      gl.clear(gl.STENCIL_BUFFER_BIT);
      const pts = new Float32Array(m.points.length * 2);
      m.points.forEach((q, i) => { pts[i * 2] = q.x * 2 - 1; pts[i * 2 + 1] = 1 - q.y * 2; });
      gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.colorMask(false, false, false, false);
      gl.stencilMask(1);
      gl.stencilFunc(gl.ALWAYS, 0, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, m.points.length);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.EQUAL, m.invert ? 0 : 1, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.STENCIL_TEST);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }
}
