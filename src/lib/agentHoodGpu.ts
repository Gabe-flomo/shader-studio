/**
 * agentHoodGpu.ts — the GPU side of the Agent Builder's "Under the hood" (docs/agent-builder.md),
 * loaded by the agent runner the first time a hood is open (lib/agentHood.ts).
 *
 * For each open request, from the runner's read-only view of the group's state (AgentRunner.stateView):
 *  - the atlas: every channel of every state texture, and the trail's channels, colour-mapped into
 *    one small 8-bit texture (each thumbnail samples one walker a pixel: every side ÷ 128-th each
 *    way), redrawn and read back at most every HOOD_ATLAS_MS without a stall (a pixel buffer and a
 *    fence; the panel copies it into its canvases a frame or more later);
 *  - the probe: one walker's texel of A, B, C and D and where it lands on the picture (the same
 *    projection as the species spotlight and Draw agents: 2D (x ÷ aspect, y), 3D through the
 *    group's Draw agents camera), 5 × 1 floats, read back the same way, every frame it is asked for;
 *  - the pick: every live walker as a point into one float texel with depth = its distance from the
 *    click, so the nearest within the radius wins the depth test; its number is read back.
 * Never a full readback of the state.
 */
import * as THREE from 'three';
import { MAP_STOPS, type Rgb } from '../agentBuilder/hood';
import { HOOD_ATLAS_MS, pokeHood, type HoodRequest } from './agentHood';

/** The runner's read-only view of one group's live state (AgentRunner.stateView). */
export interface AgentStateView {
  readonly nodeId: string;
  readonly slug: string;
  readonly side: number;
  readonly count: number;
  readonly species: number;
  readonly stateC: boolean;
  readonly d3: boolean;
  /** The picture's width ÷ height at the last live run. */
  readonly aspect: number;
  readonly step: number;
  /** The copy the next step reads (what Draw agents drew this frame). */
  readonly textures: Readonly<{ A: THREE.Texture; B: THREE.Texture; C: THREE.Texture | null; D: THREE.Texture | null }>;
  /** The trail its Deposit fills (a volume: its front view). */
  readonly trail: Readonly<{ nodeId: string; texture: THREE.Texture; w: number; h: number; velocity: boolean }> | null;
  /** 3D: the camera its first live Draw agents sees through (`scene`: a scene's camera texture, when probed). */
  readonly camera: Readonly<{ eye: number[]; fwd: number[]; right: number[]; up: number[]; lens: number; ortho: number; dist: number; scene: THREE.Texture | null }> | null;
}

const MAX_TILES = 24;

const v3 = (c: Rgb) => `vec3(${c.map(x => x.toFixed(4)).join(', ')})`;
function stopsGlsl(name: string, stops: Rgb[]): string {
  const n = stops.length;
  return `vec3 ${name}(float t) {
  const vec3 S[${n}] = vec3[${n}](${stops.map(v3).join(', ')});
  float x = clamp(t, 0.0, 1.0) * ${(n - 1).toFixed(1)};
  int i = min(int(floor(x)), ${n - 2});
  return mix(S[i], S[i + 1], x - float(i));
}`;
}

/** The camera's projection (AG_SPOT_VERT's, as a function): (clip x, clip y, 1 when seen, depth). */
const PROJECT = `uniform highp sampler2D u_cam;
uniform int u_deep, u_camSrc;
uniform float u_aspect, u_lens, u_ortho, u_camDist;
uniform vec3 u_eye, u_fwd, u_right, u_up;
vec4 hoodProject(vec3 p) {
  if (u_deep == 0) return vec4(p.x / u_aspect, p.y, 1.0, 0.0);
  vec3 eye = u_eye, f = u_fwd, r = u_right, u = u_up;
  float lens = u_lens, cd = u_camDist, fl = clamp(u_ortho, 0.0, 1.0);
  if (u_camSrc == 1) {
    eye = texelFetch(u_cam, ivec2(0, 0), 0).xyz;
    f = normalize(texelFetch(u_cam, ivec2(1, 0), 0).xyz);
    vec3 rx = normalize(texelFetch(u_cam, ivec2(2, 0), 0).xyz), ry = normalize(texelFetch(u_cam, ivec2(3, 0), 0).xyz);
    float cx = dot(rx, f), cy = clamp(dot(ry, f), -0.9999, 0.9999);
    lens = 0.5 / tan(acos(cy));
    r = normalize(rx - cx * f);
    u = normalize(ry - cy * f);
    u = normalize(u - dot(r, u) * r);
    cd = max(0.1, dot(-eye, f));
    fl = 0.0;
  }
  vec3 d = p - eye;
  float z = dot(d, f);
  if (z < 0.06 && fl < 0.999) return vec4(0.0);
  float w = mix(z, cd, fl);
  vec2 q = vec2(dot(d, r), dot(d, u)) * lens / w;
  return vec4(q.x / u_aspect, q.y, 1.0, z);
}`;

const FULL_VERT = `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const HOOD_ATLAS_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_c;
uniform highp sampler2D u_d;
uniform sampler2D u_trail;
uniform int u_side, u_n, u_H, u_trailOk, u_spN;
uniform vec4 u_rect[${MAX_TILES}];
uniform vec4 u_spec[${MAX_TILES}];
uniform vec4 u_range[${MAX_TILES}];
uniform vec3 u_col[${MAX_TILES}];
uniform vec3 u_sp[4];
out vec4 o;
${stopsGlsl('hoodGradient', MAP_STOPS.gradient)}
${stopsGlsl('hoodRamp', MAP_STOPS.ramp)}
${stopsGlsl('hoodHeat', MAP_STOPS.heat)}
${stopsGlsl('hoodDiverge', MAP_STOPS.diverge)}
vec3 hoodHsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
void main() {
  // Top-left pixel coordinates (the panel's canvases): row 0 is the top.
  vec2 p = vec2(floor(gl_FragCoord.x), float(u_H - 1) - floor(gl_FragCoord.y));
  int k = -1;
  for (int i = 0; i < ${MAX_TILES}; i++) {
    if (i >= u_n) break;
    vec4 r = u_rect[i];
    if (p.x >= r.x && p.x < r.x + r.z && p.y >= r.y && p.y < r.y + r.w) { k = i; break; }
  }
  if (k < 0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 r = u_rect[k], s = u_spec[k];
  vec2 lp = p - r.xy;
  int src = int(s.x + 0.5), comp = int(s.y + 0.5), m = int(s.z + 0.5);
  vec2 rg = u_range[k].xy;
  if (src == 4) {
    // A trail channel, in the picture's shape (v up as the picture's y).
    if (u_trailOk == 0) { o = vec4(0.06, 0.06, 0.07, 1.0); return; }
    float v = texture(u_trail, vec2((lp.x + 0.5) / r.z, 1.0 - (lp.y + 0.5) / r.w))[comp];
    o = vec4(u_col[k] * (1.0 - exp(-abs(v) * rg.y)), 1.0);
    return;
  }
  // One walker a pixel: the texel under this pixel's centre (walker i at (i mod side, i ÷ side)).
  ivec2 t = clamp(ivec2(floor((lp + 0.5) * float(u_side) / r.zw)), ivec2(0), ivec2(u_side - 1));
  vec4 B = texelFetch(u_b, t, 0);
  // Dead (or not born yet): black in every channel.
  if (B.w <= 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 T = src == 0 ? texelFetch(u_a, t, 0) : src == 1 ? B : src == 2 ? texelFetch(u_c, t, 0) : texelFetch(u_d, t, 0);
  float v = T[comp];
  float tt = (v - rg.x) / max(rg.y - rg.x, 1e-6);
  vec3 c;
  if (m == 0) c = hoodGradient(tt);
  else if (m == 1) c = hoodDiverge(tt);
  else if (m == 2) c = hoodHsv(fract(v / 6.2831853), 0.8, 1.0);
  else if (m == 3) c = hoodRamp(tt);
  else if (m == 4) c = v > 1.0e20 ? vec3(0.35, 0.85, 0.5) : hoodRamp(0.15 + 0.85 * tt);
  else if (m == 5) c = u_sp[clamp(int(floor(v + 0.5)), 0, max(u_spN - 1, 0))];
  else if (m == 6) c = hoodHeat(tt);
  else if (m == 9) c = hoodRamp(1.0 - exp(-max(v, 0.0) / max(rg.y, 1e-6)));
  else if (m == 7) {
    float b = floor(v / 65536.0), g = floor((v - b * 65536.0) / 256.0);
    c = vec3(v - b * 65536.0 - g * 256.0, g, b) / 255.0;
  } else c = u_col[k] * clamp(tt, 0.0, 1.0);
  o = vec4(c, 1.0);
}`;

export const HOOD_PROBE_FRAG = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_c;
uniform highp sampler2D u_d;
uniform int u_i, u_side, u_stateC;
${PROJECT}
out vec4 o;
void main() {
  int x = int(gl_FragCoord.x);
  ivec2 t = ivec2(u_i % u_side, u_i / u_side);
  vec4 A = texelFetch(u_a, t, 0);
  if (x == 0) o = A;
  else if (x == 1) o = texelFetch(u_b, t, 0);
  else if (x == 2) o = u_stateC == 1 ? texelFetch(u_c, t, 0) : vec4(0.0);
  else if (x == 3) o = u_stateC == 1 ? texelFetch(u_d, t, 0) : vec4(0.0);
  else o = hoodProject(u_deep == 1 ? A.xyz : vec3(A.xy, 0.0));
}`;

export const HOOD_PICK_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform int u_side;
uniform vec2 u_click, u_rad;
${PROJECT}
out float v_id;
out float v_d;
void hoodCull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
void main() {
  int id = gl_VertexID;
  ivec2 t = ivec2(id % u_side, id / u_side);
  if (t.y >= u_side) { hoodCull(); return; }
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  if (B.w <= 0.0) { hoodCull(); return; }
  vec4 q = hoodProject(u_deep == 1 ? A.xyz : vec3(A.xy, 0.0));
  if (q.z < 0.5) { hoodCull(); return; }
  float d = length((q.xy - u_click) / u_rad);
  if (d > 1.0) { hoodCull(); return; }
  // Everyone near lands on the one texel; the nearest wins the depth test.
  gl_Position = vec4(0.0, 0.0, d * 2.0 - 1.0, 1.0);
  gl_PointSize = 1.0;
  v_id = float(id);
  v_d = d;
}`;

export const HOOD_PICK_FRAG = `precision highp float;
in float v_id;
in float v_d;
out vec4 o;
void main() { o = vec4(v_id, v_d, 1.0, 1.0); }`;

/** A small target and an async read of it (a pixel buffer and a fence). */
interface Read { rt: THREE.WebGLRenderTarget; W: number; H: number; float: boolean; pbo: WebGLBuffer | null; sync: WebGLSync | null; buf: Uint8Array | Float32Array; pending: boolean }
interface Slot { atlas?: Read; atlasAt: number; atlasStep: number; atlasSpecs: unknown; probe?: Read; probeIndex: number; probeStep: number; pick?: Read; picking: boolean }

const camUniforms = () => ({
  u_cam: { value: null }, u_deep: { value: 0 }, u_camSrc: { value: 0 }, u_aspect: { value: 1 }, u_lens: { value: 1.8 }, u_ortho: { value: 0 }, u_camDist: { value: 3 },
  u_eye: { value: new THREE.Vector3() }, u_fwd: { value: new THREE.Vector3(0, 0, -1) }, u_right: { value: new THREE.Vector3(1, 0, 0) }, u_up: { value: new THREE.Vector3(0, 1, 0) },
});

export class AgentHoodGpu {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.Camera;
  private quadScene = new THREE.Scene();
  private quad: THREE.Mesh;
  private pointScene = new THREE.Scene();
  private pointGeometry = new THREE.BufferGeometry();
  private slots = new Map<string, Slot>();
  private atlasMat = new THREE.RawShaderMaterial({
    vertexShader: FULL_VERT, fragmentShader: HOOD_ATLAS_FRAG, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: {
      u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_d: { value: null }, u_trail: { value: null },
      u_side: { value: 1 }, u_n: { value: 0 }, u_H: { value: 1 }, u_trailOk: { value: 0 }, u_spN: { value: 1 },
      u_rect: { value: Array.from({ length: MAX_TILES }, () => new THREE.Vector4()) },
      u_spec: { value: Array.from({ length: MAX_TILES }, () => new THREE.Vector4()) },
      u_range: { value: Array.from({ length: MAX_TILES }, () => new THREE.Vector4()) },
      u_col: { value: Array.from({ length: MAX_TILES }, () => new THREE.Vector3()) },
      u_sp: { value: Array.from({ length: 4 }, () => new THREE.Vector3(1, 1, 1)) },
    },
  });
  private probeMat = new THREE.RawShaderMaterial({
    vertexShader: FULL_VERT, fragmentShader: HOOD_PROBE_FRAG, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { u_a: { value: null }, u_b: { value: null }, u_c: { value: null }, u_d: { value: null }, u_i: { value: 0 }, u_side: { value: 1 }, u_stateC: { value: 0 }, ...camUniforms() },
  });
  private pickMat = new THREE.RawShaderMaterial({
    vertexShader: HOOD_PICK_VERT, fragmentShader: HOOD_PICK_FRAG, glslVersion: THREE.GLSL3, depthTest: true, depthWrite: true,
    uniforms: { u_a: { value: null }, u_b: { value: null }, u_side: { value: 1 }, u_click: { value: new THREE.Vector2() }, u_rad: { value: new THREE.Vector2(0.01, 0.01) }, ...camUniforms() },
  });

  constructor(renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry, camera: THREE.Camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.quad = new THREE.Mesh(geometry, this.atlasMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const pts = new THREE.Points(this.pointGeometry, this.pickMat);
    pts.frustumCulled = false;
    this.pointScene.add(pts);
  }

  /** One frame for every open request (`view(groupId)`: the runner's read-only state, or null before it has any). */
  frame(reqs: HoodRequest[], view: (groupId: string) => AgentStateView | null, now = performance.now()): void {
    for (const req of reqs) {
      let slot = this.slots.get(req.groupId);
      if (!slot) { slot = { atlasAt: -Infinity, atlasStep: -1, atlasSpecs: null, probeIndex: -1, probeStep: -1, picking: false }; this.slots.set(req.groupId, slot); }
      const v = view(req.groupId);
      req.onState?.(v ? { side: v.side, count: v.count, stateC: v.stateC, d3: v.d3, aspect: v.aspect, species: v.species, trail: !!v.trail } : null);
      if (!v) continue;
      this.atlas(req, slot, v, now);
      this.probe(req, slot, v);
      this.pick(req, slot, v);
    }
    for (const [id, s] of this.slots) if (!reqs.some(r => r.groupId === id)) { this.dropSlot(s); this.slots.delete(id); }
    // A read in flight is picked up next frame: a paused preview draws one more for it.
    if ([...this.slots.values()].some(s => s.atlas?.pending || s.probe?.pending || s.picking)) setTimeout(pokeHood, 30);
  }

  get busy(): boolean { return this.slots.size > 0; }

  private atlas(req: HoodRequest, slot: Slot, v: AgentStateView, now: number): void {
    const { W, H } = req.atlas;
    if (!req.atlas.tiles.length || W < 1 || H < 1) return;
    if (slot.atlas && (slot.atlas.W !== W || slot.atlas.H !== H)) { this.free(slot.atlas); slot.atlas = undefined; }
    if (!slot.atlas) slot.atlas = this.makeRead(W, H, false);
    const d = slot.atlas;
    if (d.pending) {
      if (!this.finish(d)) return;
      req.onAtlas(d.buf as Uint8Array, W, H);
    }
    // A few times a second, and only when the walkers have moved on (or the view asks for other maps).
    if (now - slot.atlasAt < HOOD_ATLAS_MS || (slot.atlasStep === v.step && slot.atlasSpecs === req.specs)) return;
    slot.atlasAt = now; slot.atlasStep = v.step; slot.atlasSpecs = req.specs;
    const u = this.atlasMat.uniforms;
    u.u_a.value = v.textures.A; u.u_b.value = v.textures.B; u.u_c.value = v.textures.C; u.u_d.value = v.textures.D;
    u.u_trail.value = v.trail?.texture ?? null; u.u_trailOk.value = v.trail ? 1 : 0;
    u.u_side.value = v.side; u.u_H.value = H;
    const n = Math.min(MAX_TILES, req.atlas.tiles.length, req.specs.length);
    u.u_n.value = n;
    for (let i = 0; i < n; i++) {
      const t = req.atlas.tiles[i], s = req.specs[i];
      (u.u_rect.value[i] as THREE.Vector4).set(t.x, t.y, t.w, t.h);
      (u.u_spec.value[i] as THREE.Vector4).set(s.source, s.comp, s.map, 0);
      (u.u_range.value[i] as THREE.Vector4).set(s.lo, s.hi, 0, 0);
      (u.u_col.value[i] as THREE.Vector3).fromArray(s.colour);
    }
    const sp = req.species.length ? req.species : [[1, 1, 1] as Rgb];
    u.u_spN.value = Math.min(4, sp.length);
    for (let i = 0; i < 4; i++) (u.u_sp.value[i] as THREE.Vector3).fromArray(sp[Math.min(i, sp.length - 1)]);
    this.atlasMat.uniformsNeedUpdate = true;
    this.quad.material = this.atlasMat;
    this.draw(d.rt, this.quadScene);
    this.start(d);
  }

  private probe(req: HoodRequest, slot: Slot, v: AgentStateView): void {
    if (req.probe === null || req.probe < 0 || req.probe >= v.count) return;
    if (!slot.probe) slot.probe = this.makeRead(5, 1, true);
    const d = slot.probe;
    if (d.pending) {
      if (!this.finish(d)) return;
      req.onProbe(d.buf as Float32Array, slot.probeIndex);
    }
    if (slot.probeIndex === req.probe && slot.probeStep === v.step) return;
    const u = this.probeMat.uniforms;
    u.u_a.value = v.textures.A; u.u_b.value = v.textures.B; u.u_c.value = v.textures.C; u.u_d.value = v.textures.D;
    u.u_i.value = req.probe; u.u_side.value = v.side; u.u_stateC.value = v.stateC ? 1 : 0;
    this.setCamera(u, v);
    this.probeMat.uniformsNeedUpdate = true;
    slot.probeIndex = req.probe; slot.probeStep = v.step;
    this.quad.material = this.probeMat;
    this.draw(d.rt, this.quadScene);
    this.start(d);
  }

  private pick(req: HoodRequest, slot: Slot, v: AgentStateView): void {
    if (slot.picking && slot.pick) {
      if (!this.finish(slot.pick)) return;
      slot.picking = false;
      const f = slot.pick.buf as Float32Array;
      req.onPick(f[2] > 0.5 ? Math.round(f[0]) : -1);
    }
    const p = req.pick;
    if (!p) return;
    req.pick = null;
    if (!slot.pick) slot.pick = this.makeRead(1, 1, true, true);
    const u = this.pickMat.uniforms;
    u.u_a.value = v.textures.A; u.u_b.value = v.textures.B; u.u_side.value = v.side;
    (u.u_click.value as THREE.Vector2).set(p.x, p.y);
    (u.u_rad.value as THREE.Vector2).set(Math.max(1e-4, p.rx), Math.max(1e-4, p.ry));
    this.setCamera(u, v);
    this.pickMat.uniformsNeedUpdate = true;
    this.pointGeometry.setDrawRange(0, v.count);
    this.draw(slot.pick.rt, this.pointScene, true);
    this.start(slot.pick);
    slot.picking = true;
  }

  private setCamera(u: Record<string, THREE.IUniform>, v: AgentStateView): void {
    u.u_aspect.value = v.aspect;
    const c = v.camera;
    u.u_deep.value = v.d3 && c ? 1 : 0;
    u.u_camSrc.value = c?.scene ? 1 : 0;
    u.u_cam.value = c?.scene ?? null;
    if (!c) return;
    (u.u_eye.value as THREE.Vector3).fromArray(c.eye); (u.u_fwd.value as THREE.Vector3).fromArray(c.fwd);
    (u.u_right.value as THREE.Vector3).fromArray(c.right); (u.u_up.value as THREE.Vector3).fromArray(c.up);
    u.u_lens.value = c.lens; u.u_ortho.value = c.ortho; u.u_camDist.value = c.dist;
  }

  private draw(rt: THREE.WebGLRenderTarget, scene: THREE.Scene, depth = false): void {
    const r = this.renderer;
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha(), prevAuto = r.autoClear;
    const prevTarget = r.getRenderTarget();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(rt);
    r.clear(true, depth, false);
    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = false;
    r.render(scene, this.camera);
    r.autoClear = prevAuto;
    r.setRenderTarget(prevTarget);
  }

  private makeRead(W: number, H: number, float: boolean, depth = false): Read {
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: float ? THREE.FloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: depth, stencilBuffer: false,
    });
    return { rt, W, H, float, pbo: null, sync: null, buf: float ? new Float32Array(W * H * 4) : new Uint8Array(W * H * 4), pending: false };
  }

  /** Starts a read of `d.rt` into its pixel buffer and fences it (no wait for the GPU). */
  private start(d: Read): void {
    const r = this.renderer;
    const gl = r.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync !== 'function') {
      // No fences (not WebGL2): a plain read (these targets are tiny or rare).
      r.readRenderTargetPixels(d.rt, 0, 0, d.W, d.H, d.buf);
      d.sync = null;
      d.pending = true;
      return;
    }
    const fb = (r.properties.get(d.rt) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer ?? null;
    if (!fb) return;
    if (!d.pbo) {
      d.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, d.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, d.buf.byteLength, gl.STREAM_READ);
    } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, d.pbo);
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.readPixels(0, 0, d.W, d.H, gl.RGBA, d.float ? gl.FLOAT : gl.UNSIGNED_BYTE, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    d.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    d.pending = true;
  }

  /** A fenced read: false while the GPU is still at it; once done, its pixels are in `d.buf`. */
  private finish(d: Read): boolean {
    if (!d.sync) { d.pending = false; return true; }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl.getSyncParameter(d.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gl.deleteSync(d.sync); d.sync = null; d.pending = false;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, d.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, d.buf);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return true;
  }

  private free(d: Read): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (d.sync) gl.deleteSync(d.sync);
    if (d.pbo) gl.deleteBuffer(d.pbo);
    d.rt.dispose();
  }

  private dropSlot(s: Slot): void { for (const d of [s.atlas, s.probe, s.pick]) if (d) this.free(d); }

  dispose(): void {
    for (const s of this.slots.values()) this.dropSlot(s);
    this.slots.clear();
    this.atlasMat.dispose(); this.probeMat.dispose(); this.pickMat.dispose();
    this.pointGeometry.dispose();
  }
}
