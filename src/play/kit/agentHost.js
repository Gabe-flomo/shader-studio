// agentHost.js — the Agents family on a web page (docs/agents-plan.md §9, P5).
//
// The page's own WebGL2 context, no three.js: the runtime (play-runtime.js) hands it the
// compiled update shaders and engine settings the export carries (bundle.agents) and a few
// hooks into its own uniform binding, so every update shader (and a Trail's own step
// program) reads the same uniforms, images, Data textures, passes and feedback the picture
// does, as the app's share the preview's uniform table.
//
// Everything that decides what happens is shared with the app's lib/agentRunner.ts (three.js):
// the schedule and each frame's steps, Burst and Start over, the birth windows, what Sound kick
// and Chladni hear, how Draw agents looks and its lights (kit/agentPlan.js); the fixed GLSL
// (kit/agentShaders.js: Deposit, the Trail's spread and fade, Draw agents with the Particles
// engine's own point, glow and compose shaders). This file only puts it on the GPU, in the
// order the app does: every group's rule → every Deposit → every Trail's step, as many steps
// as the clock asks for (at most the governor's cap live, exactly up to the time offline),
// then Draw agents.
//
// Top-level names start with `ah` (the kit's one-scope rule).
import { AG_NB_SLOTS, AG_OFFLINE_CHUNK, AG_PROBE_POINTS, AG_STEP_HZ, agNbLayout, agNbPasses, agNbTile, agCamera3, agDrawLook, agGovern, agGovernorState, agGroupState, agGroupSteps, agHear, agKeep, agLights, agListenState, agLiveState, agProject3, agReadDecode, agReadPlan, agRestartGroup, agStepTime, agStepWindow, agTrailSize, agVolLayout, agVolUniform } from './agentPlan.js';
import { AG_NB_BIN_FRAG, AG_NB_BIN_VERT, AG_BLUR_FRAG, AG_COMPOSE_FRAG, AG_DEPOSIT3_VERT, AG_DEPOSIT_FRAG, AG_DEPOSIT_VERT, AG_DOWN_FRAG, AG_DRAW3_VERT, AG_DRAW_FRAG, AG_DRAW_VERT, AG_FULL_VERT, AG_PROJ3_FRAG, AG_READ_FRAG, AG_SUM_FRAG, AG_TRAIL3_FRAG, AG_TRAIL_FRAG } from './agentShaders.js';
import { GP_BESSEL_N, GP_BESSEL_W, GP_LEVELS, GP_VOL, GP_VOL_TILES, gpBesselTable, gpReadback } from './gpuParticles.js';

/** Why a page can't run agents here, or null. */
export function ahUnsupported(gl) {
  if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return 'Agents need WebGL2, which this browser does not offer here.';
  if (!gl.getExtension('EXT_color_buffer_float')) return 'Agents need float render targets (EXT_color_buffer_float), which this GPU does not offer.';
  return null;
}

/** Uniforms of a program by name: { loc, type }, the array ones under their bare name. */
function ahUniforms(gl, p) {
  const out = new Map();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    out.set(name, { loc: gl.getUniformLocation(p, name), type: info.type });
  }
  return out;
}

/** Set a uniform by its declared type (three.js does the same from the shader's own declarations). */
function ahSet(gl, us, name, v) {
  const u = us.get(name);
  if (!u || !u.loc || v == null) return;
  const t = u.type;
  if (t === gl.FLOAT) gl.uniform1f(u.loc, +v);
  else if (t === gl.INT || t === gl.BOOL) gl.uniform1i(u.loc, v | 0);
  else if (t === gl.UNSIGNED_INT) gl.uniform1ui(u.loc, v >>> 0);
  else if (t === gl.FLOAT_VEC2) gl.uniform2fv(u.loc, v);
  else if (t === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, v);
  else if (t === gl.FLOAT_VEC4) gl.uniform4fv(u.loc, v);
}

/**
 * spec: the bundle's agents: { groups, deposits, trails, draws, bessel } (compiler/types.ts
 * AgentsSpec without the node lists, plus each one's uniform names in `u`: play/webInput.ts).
 * env: {
 *   link(fs) → program compiled as the page compiles its picture (a Trail's own step program),
 *   link3(fs) → program for a GLSL 3 update shader (two or four outputs),
 *   use(program, w, h), done(), quad(): as for passes (kit/passHost.js),
 *   textures: Map sampler name → texture, vec2s: Map name → [x, y] (shared by every program),
 *   read(name) → a uniform's value now, sound(source) → a spectrum or null (Sound from),
 *   halfFloat,
 * }
 */
export function ahCreate(gl, spec, env) {
  const unsupported = ahUnsupported(gl);
  const groups = spec.groups || [], deposits = spec.deposits || [], trails = spec.trails || [], draws = spec.draws || [];
  // Every sampler the agents fill starts blank (the app's empty texture), every `_px` at one pixel.
  for (const g of groups) for (const k of ['A', 'B', 'C', 'D']) env.textures.set(g.u[k], null);
  for (const t of trails) { env.textures.set(t.u.tex, null); env.vec2s.set(t.u.tex + '_px', [1, 1]); if (t.stepShader) env.textures.set(t.u.src, null); }
  // 3D: a volume Trail's layout and a Draw agents' scene probe point are uniforms every program may read.
  const vec4s = new Map();
  for (const t of trails) if (t.volume && t.u.vol) vec4s.set(t.u.vol, [1, 1, 1, 1]);
  for (const d of draws) if (d.probe) vec4s.set(d.probe.uniform, [0, 0, 0, 0]);
  for (const g of groups) for (const gr of g.grids || []) { env.textures.set(gr.u.grid, null); vec4s.set(gr.u.at, [0, 0, 0, 2]); }
  for (const d of draws) { env.textures.set(d.u.tex, null); env.vec2s.set(d.u.tex + '_px', [1, 1]); }
  // Neighbours: a group's grid (its two slot atlases and the count per cell) and its layout uniform.
  for (const g of groups) if (g.neighbours && g.u.nb) { for (const k of ['a', 'b', 'n']) env.textures.set(g.u.nb[k], null); vec4s.set(g.u.nb.g, [1, 1, 1, 1]); }
  if (unsupported) {
    if (typeof console !== 'undefined') console.warn('[Playfield] ' + unsupported + ' The picture draws without them.');
    return { unsupported, active: false, run() {}, reset() {}, dispose() {} };
  }

  const warn = (what, e) => { if (typeof console !== 'undefined') console.warn('[Playfield] ' + what + ' did not compile here: ' + (e && e.message ? e.message : e)); };
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log || 'shader failed'); }
    return s;
  };
  /** The engine's fixed programs (GLSL 3 bodies: the `#version` line added, as three.js does for a RawShaderMaterial). */
  const raw = (vs, fs) => {
    const p = gl.createProgram();
    const a = compile(gl.VERTEX_SHADER, '#version 300 es\n' + vs), b = compile(gl.FRAGMENT_SHADER, '#version 300 es\n' + fs);
    gl.attachShader(p, a); gl.attachShader(p, b);
    gl.bindAttribLocation(p, 0, 'position');
    gl.linkProgram(p);
    gl.deleteShader(a); gl.deleteShader(b);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
    return { p, u: ahUniforms(gl, p) };
  };
  let fixed = null;
  try {
    fixed = {
      deposit: raw(AG_DEPOSIT_VERT, AG_DEPOSIT_FRAG), trail: raw(AG_FULL_VERT, AG_TRAIL_FRAG), draw: raw(AG_DRAW_VERT, AG_DRAW_FRAG),
      down: raw(AG_FULL_VERT, AG_DOWN_FRAG), blur: raw(AG_FULL_VERT, AG_BLUR_FRAG), compose: raw(AG_FULL_VERT, AG_COMPOSE_FRAG),
    };
    // 3D (only when the page has a 3D group): a volume's deposit, step and front view, and the camera draw.
    // Neighbours (only when a group has them): the grid's passes (kit/agentShaders.js AG_NB_BIN_VERT).
    if (groups.some(g => g.neighbours)) fixed.nbBin = raw(AG_NB_BIN_VERT, AG_NB_BIN_FRAG);
    if (groups.some(g => g.space3d)) Object.assign(fixed, {
      deposit3: raw(AG_DEPOSIT3_VERT, AG_DEPOSIT_FRAG), trail3: raw(AG_FULL_VERT, AG_TRAIL3_FRAG), proj3: raw(AG_FULL_VERT, AG_PROJ3_FRAG), draw3: raw(AG_DRAW3_VERT, AG_DRAW_FRAG),
    });
  } catch (e) {
    warn('The agents engine', e);
    return { unsupported: String(e && e.message ? e.message : e), active: false, run() {}, reset() {}, dispose() {} };
  }
  // The rules (update shaders) and the Trails' own step programs (Add / Block wired).
  const steps = groups.map(g => {
    let p = null;
    try { p = env.link3(g.fragmentShader); } catch (e) { warn('The Agents group "' + (g.label || g.slug) + '"', e); }
    return { spec: g, p, u: p ? ahUniforms(gl, p) : null };
  });
  const trailSteps = new Map();
  for (const t of trails) {
    if (!t.stepShader) continue;
    let p = null;
    try { p = env.link(t.stepShader); } catch (e) { warn('The Trail field "' + (t.label || t.slug) + '"', e); }
    trailSteps.set(t.slug, { p, u: p ? ahUniforms(gl, p) : null });
  }
  // 3D Draw agents' scene probes (a ray-marched scene's camera and its depth), linked as the picture is.
  const probes = new Map();
  for (const d of draws) {
    if (!d.probe) continue;
    const one = (src, what) => { try { const p = env.link(src); return { p, u: ahUniforms(gl, p) }; } catch (e) { warn('The scene ' + what + ' of "' + d.slug + '"', e); return null; } };
    probes.set(d.slug, { camera: one(d.probe.camera, 'camera'), depth: d.probe.depth ? one(d.probe.depth, 'depth') : null });
  }
  // Collide (3D scene)'s grid programs (the Scene's distance on its 48³ grid), linked as the picture is.
  const gridProgs = new Map();
  for (const g of groups) for (const gr of g.grids || []) {
    try { const p = env.link(gr.shader); gridProgs.set(gr.slug, { p, u: ahUniforms(gl, p) }); } catch (e) { warn('The scene grid of "' + (g.label || g.slug) + '"', e); }
  }
  const gridTex = new Map();
  /** Set the 3D uniforms (vec4s) in a program the runtime links (env.use binds the rest). */
  const setVec4s = (prog) => { if (prog && prog.u) for (const [n, v] of vec4s) ahSet(gl, prog.u, n, v); };

  const emptyVao = gl.createVertexArray();
  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const tex = (internal, format, type, filter, wrap, w, h, data) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
    return t;
  };
  const fbOf = (texs) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    if (texs.length > 1) gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return fb;
  };
  const clearFb = (fb, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };
  const half = env.halfFloat;
  const look = (w, h, filter, wrap) => {
    const t = tex(half ? gl.RGBA16F : gl.RGBA8, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, filter, wrap, Math.max(1, w), Math.max(1, h));
    return { t, fb: fbOf([t]), w: Math.max(1, w), h: Math.max(1, h) };
  };
  const dropLook = l => { gl.deleteFramebuffer(l.fb); gl.deleteTexture(l.t); };

  // The simulation's state: per group its textures and the schedule's state (kit/agentPlan.js), per trail and drawing their textures.
  const G = new Map(), T = new Map(), D = new Map();
  const dropGroup = s => { for (const side of s.tex) for (const t of side) gl.deleteTexture(t); for (const fb of s.fb) gl.deleteFramebuffer(fb); dropListen(s); };
  const dropListen = s => { for (const l of s.listen.values()) if (l.levelTex) gl.deleteTexture(l.levelTex); s.listen.clear(); };
  const group = g => {
    const key = g.side + (g.stateC ? ':C' : '') + (g.space3d ? ':3D' : '');
    let s = G.get(g.slug);
    if (s && s.key === key) return s;
    if (s) dropGroup(s);
    // State A and B; with per-walker state also C (species, memory, colour) and D (its deposit). RGBA32F, MRT.
    const count = g.stateC ? 4 : 2;
    const tx = [0, 1].map(() => Array.from({ length: count }, () => tex(gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, g.side, g.side)));
    s = Object.assign(agGroupState(), { key, side: g.side, tex: tx, fb: tx.map(fbOf), cur: 0 });
    for (const fb of s.fb) clearFb(fb, g.side, g.side);
    G.set(g.slug, s);
    return s;
  };
  /**
   * Neighbours (docs/agents-group.md "Neighbours"): a group's grid for this step, as the app builds it
   * (lib/agentRunner.ts buildNeighbours): the count of each cell (additive points), then each slot
   * (no blending: the last walker drawn, the highest index, stays). Scratch textures by group.
   */
  const NB = new Map();
  const dropNb = s => { for (const x of [s.atlas[0], s.atlas[1], s.count]) { gl.deleteFramebuffer(x.fb); gl.deleteTexture(x.t); } };
  const neighbours = (g, s, aspect) => {
    const d3 = !!g.space3d;
    const [tw, th] = agNbTile(d3);
    let nb = NB.get(g.slug);
    if (!nb) {
      const make = (internal, format, type, w, h) => { const t = tex(internal, format, type, gl.NEAREST, gl.CLAMP_TO_EDGE, w, h); return { t, fb: fbOf([t]), w, h }; };
      const aw = tw * AG_NB_SLOTS / 2;
      nb = { atlas: [make(gl.RGBA32F, gl.RGBA, gl.FLOAT, aw, th), make(gl.RGBA32F, gl.RGBA, gl.FLOAT, aw, th)], count: make(gl.R16F, gl.RED, gl.HALF_FLOAT, tw, th) };
      NB.set(g.slug, nb);
    }
    const radius = Math.max(...g.neighbours.radius.map(r => read(r, 0.05)));
    const most = Math.max(...g.neighbours.max.map(m => read(m, 36)));
    const L = agNbLayout(d3, aspect, radius, most);
    for (const x of [nb.atlas[0], nb.atlas[1], nb.count]) clearFb(x.fb, x.w, x.h);
    const P = fixed.nbBin;
    gl.useProgram(P.p);
    const t = s.tex[s.cur];
    const set = (n, v) => ahSet(gl, P.u, n, v);
    set('u_side', g.side); set('u_d3', d3 ? 1 : 0); set('u_grid', L.uniform);
    gl.bindVertexArray(emptyVao);
    for (const ps of agNbPasses(d3, L.slots)) {
      samplers(P, [['u_a', t[0]], ['u_b', t[1]], ['u_prev', ps.prevAtlas >= 0 ? nb.atlas[ps.prevAtlas].t : null]]);
      set('u_pass', [ps.x, ps.prevX, ps.prevAtlas >= 0 ? 1 : 0, ps.count ? 1 : 0]);
      const into = ps.count ? nb.count : nb.atlas[ps.atlas];
      set('u_target', [into.w, into.h]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb); gl.viewport(0, 0, into.w, into.h);
      if (ps.count) { gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); }
      gl.drawArrays(gl.POINTS, 0, g.side * g.side);
      if (ps.count) gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    env.textures.set(g.u.nb.a, nb.atlas[0].t); env.textures.set(g.u.nb.b, nb.atlas[1].t); env.textures.set(g.u.nb.n, nb.count.t);
    vec4s.set(g.u.nb.g, L.uniform);
  };
  const restartGroup = s => {
    for (const fb of s.fb) clearFb(fb, s.side, s.side);
    agRestartGroup(s);
    dropListen(s);
  };
  const listen = (s, slug) => {
    let l = s.listen.get(slug);
    if (l) return l;
    l = agListenState();
    l.levelTex = tex(gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, GP_LEVELS, 1, l.levels.levels);
    s.listen.set(slug, l);
    return l;
  };
  let bessel = null;
  const dropTrail = s => { s.rt.forEach(dropLook); if (s.proj) dropLook(s.proj); };
  const trail = (t, w, h) => {
    if (t.volume) {
      // A volume (a 3D group's trail): its slices side by side, ping-pong, and its front view for the picture.
      const L = agVolLayout(t.volume, w, h);
      const key = 'vol' + L.nx + 'x' + L.ny + 'x' + L.nz + ':' + t.edges;
      let s = T.get(t.slug);
      if (s && s.key === key) return s;
      if (s) dropTrail(s);
      const wrap = t.edges === 'wrap' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      s = { key, w: L.w, h: L.h, vol: L, rt: [look(L.w, L.h, gl.LINEAR, gl.CLAMP_TO_EDGE), look(L.w, L.h, gl.LINEAR, gl.CLAMP_TO_EDGE)], proj: look(L.nx, L.ny, gl.LINEAR, wrap), cur: 0 };
      for (const r of s.rt) clearFb(r.fb, L.w, L.h);
      clearFb(s.proj.fb, L.nx, L.ny);
      T.set(t.slug, s);
      return s;
    }
    const [tw, th] = agTrailSize(w, h, t);
    const key = tw + 'x' + th + ':' + t.edges;
    let s = T.get(t.slug);
    if (s && s.key === key) return s;
    if (s) dropTrail(s);
    const wrap = t.edges === 'wrap' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    s = { key, w: tw, h: th, rt: [look(tw, th, gl.LINEAR, wrap), look(tw, th, gl.LINEAR, wrap)], cur: 0 };
    for (const r of s.rt) clearFb(r.fb, tw, th);
    T.set(t.slug, s);
    return s;
  };
  const clearTrail = s => { for (const r of s.rt) clearFb(r.fb, s.w, s.h); if (s.proj) clearFb(s.proj.fb, s.proj.w, s.proj.h); };
  const dropDraw = s => {
    dropLook(s.acc); s.glow.forEach(dropLook); if (s.out !== s.acc) dropLook(s.out);
    if (s.cam) { gl.deleteFramebuffer(s.cam.fb); gl.deleteTexture(s.cam.t); }
    if (s.depth) dropLook(s.depth);
  };
  const drawTargets = (d, w, h) => {
    const key = w + 'x' + h + ':' + d.style;
    let s = D.get(d.slug);
    if (s && s.key === key) return s;
    if (s) dropDraw(s);
    const acc = look(w, h, gl.LINEAR, gl.CLAMP_TO_EDGE);
    const glow = [];
    let out = acc;
    if (d.style !== 'points') {
      // The Particles node's glow: ¼ and 1/16 size, each blurred (scratch + result), then composed over the points.
      const w1 = Math.ceil(w / 4), h1 = Math.ceil(h / 4), w2 = Math.ceil(w1 / 4), h2 = Math.ceil(h1 / 4);
      glow.push(look(w1, h1, gl.LINEAR, gl.CLAMP_TO_EDGE), look(w1, h1, gl.LINEAR, gl.CLAMP_TO_EDGE), look(w2, h2, gl.LINEAR, gl.CLAMP_TO_EDGE), look(w2, h2, gl.LINEAR, gl.CLAMP_TO_EDGE));
      out = look(w, h, gl.LINEAR, gl.CLAMP_TO_EDGE);
    }
    s = { key, w, h, acc, glow, out };
    D.set(d.slug, s);
    return s;
  };

  const read = (p, fb) => {
    if (typeof p === 'number') return isFinite(p) ? p : fb;
    if (typeof p === 'string') { const v = env.read(p); return typeof v === 'number' && isFinite(v) ? v : fb; }
    return fb;
  };
  const readColour = (p, fb) => {
    if (Array.isArray(p)) return p;
    if (typeof p === 'string') { const v = env.read(p); if (Array.isArray(v) && v.length >= 3) return v; }
    return fb;
  };
  const gov = agGovernorState();

  /** A fixed program's samplers on units 0…, null as blank. */
  const samplers = (prog, list) => list.forEach(([name, t], i) => {
    const u = prog.u.get(name);
    if (!u || !u.loc) return;
    gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t || blank); gl.uniform1i(u.loc, i);
  });
  const quadInto = (fb, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); env.quad(); };

  // Readings for the page's Play (P6): only for groups its setup reads (`readAs`, the sensor layer
  // `ag:<id>`), as the app does: the state summed on the GPU to 2 × 1 texels (kit/agentShaders.js),
  // read back without a stall (gpReadback), decoded by the shared agReadDecode. A frame or two late.
  const readProgs = groups.some(g => g.readAs) ? (() => {
    try { return { read: raw(AG_FULL_VERT, AG_READ_FRAG), sum: raw(AG_FULL_VERT, AG_SUM_FRAG) }; } catch (e) { warn('The agents readings', e); return null; }
  })() : null;
  const R = new Map(), readOut = new Map();
  const dropRead = r => { for (const l of r.levels) { gl.deleteFramebuffer(l.fb); gl.deleteTexture(l.t); } r.reader.dispose(); };
  const readings = (aspect) => {
    if (!readProgs) return;
    for (const g of groups) {
      const gs = g.readAs ? G.get(g.slug) : null;
      if (!gs) continue;
      let r = R.get(g.slug);
      if (r && r.side !== g.side) { dropRead(r); r = null; }
      if (!r) {
        const levels = agReadPlan(g.side).map(([w, h]) => { const t = tex(gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, 2 * w, h); return { t, fb: fbOf([t]), w, h }; });
        r = { side: g.side, levels, reader: gpReadback(gl), busy: false, last: null, count: g.side * g.side, aspect };
        R.set(g.slug, r);
      }
      const px = r.reader.poll();
      if (px && px !== r.last) { r.last = px; r.busy = false; readOut.set(g.readAs, agReadDecode(px, r.count, r.aspect)); }
      if (r.busy) continue;
      const t = gs.tex[gs.cur];
      const P = readProgs.read;
      gl.useProgram(P.p);
      samplers(P, [['u_a', t[0]], ['u_b', t[1]], ['u_c', g.stateC ? t[2] : null]]);
      ahSet(gl, P.u, 'u_side', g.side); ahSet(gl, P.u, 'u_species', g.species); ahSet(gl, P.u, 'u_stateC', g.stateC ? 1 : 0); ahSet(gl, P.u, 'u_w', r.levels[0].w); ahSet(gl, P.u, 'u_deep', g.space3d ? 1 : 0);
      quadInto(r.levels[0].fb, 2 * r.levels[0].w, r.levels[0].h);
      for (let k = 1; k < r.levels.length; k++) {
        const S = readProgs.sum, a = r.levels[k - 1], b = r.levels[k];
        gl.useProgram(S.p);
        samplers(S, [['u_src', a.t]]);
        ahSet(gl, S.u, 'u_inW', a.w); ahSet(gl, S.u, 'u_inH', a.h); ahSet(gl, S.u, 'u_w', b.w);
        quadInto(b.fb, 2 * b.w, b.h);
      }
      if (r.reader.request(r.levels[r.levels.length - 1].fb, 2, 1)) { r.busy = true; r.count = g.side * g.side; r.aspect = aspect; }
    }
  };
  const bindState = (g, s) => {
    const t = s.tex[s.cur];
    env.textures.set(g.u.A, t[0]); env.textures.set(g.u.B, t[1]);
    if (g.stateC) { env.textures.set(g.u.C, t[2]); env.textures.set(g.u.D, t[3]); }
  };

  /** One step of listening for group g, before its rule: values for its uniforms (and the level history uploaded). */
  const hear = (s, g, time) => {
    const vals = [];
    for (const l of g.listeners) {
      const st = listen(s, l.slug);
      const r = agHear(st, l, read, env.sound, time, s.step === 0);
      vals.push([l.u.sound, r.sound]);
      if (l.kind === 'kick') {
        vals.push([l.u.shocks, r.shocks]);
        gl.bindTexture(gl.TEXTURE_2D, st.levelTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GP_LEVELS, 1, gl.RED, gl.FLOAT, r.levels);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        env.textures.set(l.u.levels, st.levelTex);
        continue;
      }
      vals.push([l.u.plateModes, r.modes], [l.u.plateCount, r.count], [l.u.plateShake, r.shake]);
      if (l.shape === 'circle' && spec.bessel) {
        if (!bessel) bessel = tex(gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, GP_BESSEL_W, GP_BESSEL_N, gpBesselTable());
        env.textures.set(spec.bessel, bessel);
      }
    }
    return vals;
  };

  /** Draw agents d over group g's walkers into its targets s; returns the texture the picture samples. */
  const drawAgents = (s, d, g, gs, aspect, time) => {
    const n = g.side * g.side;
    const L = agDrawLook(d, n, s.h, read, readColour);
    const lights = agLights(d, read, readColour, time, aspect);
    const lightVals = [], lightCols = [];
    for (let i = 0; i < 4; i++) { const l = lights[i]; if (l) { lightVals.push(l.x, l.y, l.reach, l.power); lightCols.push(...l.colour); } else { lightVals.push(0, 0, 1, 0); lightCols.push(0, 0, 0); } }
    clearFb(s.acc.fb, s.w, s.h);
    const P = fixed.draw;
    gl.useProgram(P.p);
    const t = gs.tex[gs.cur];
    samplers(P, [['u_a', t[0]], ['u_b', t[1]], ['u_c', g.stateC ? t[2] : null], ['u_field', null]]);
    const set = (k, v) => ahSet(gl, P.u, k, v);
    set('u_stateC', g.stateC ? 1 : 0); set('u_side', g.side); set('u_species', g.species); set('u_aspect', aspect);
    set('u_colorBy', L.colorBy); set('u_size', L.size); set('u_bright', L.bright); set('u_speedRef', L.speedRef);
    set('u_prim', L.lines ? 1 : 0); set('u_depth', 0); set('u_thread', L.thread); set('u_ink', L.ink ? 1 : 0); set('u_fade', L.fade ? 1 : 0);
    set('u_usePal', L.usePal ? 1 : 0); set('u_rainbow', L.rainbow ? 1 : 0);
    set('u_pal', L.pal ? [].concat(...L.pal.slice(0, 4)) : new Array(12).fill(0));
    set('u_colA', L.colA.slice(0, 3)); set('u_colB', L.colB.slice(0, 3)); set('u_viewSize', [s.w, s.h]);
    set('u_lights', lights.length); set('u_lightZ', [0, 0, 0, 0]); set('u_light', lightVals); set('u_lightCol', lightCols);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.acc.fb); gl.viewport(0, 0, s.w, s.h);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(emptyVao);
    if (L.lines) gl.drawArrays(gl.LINES, 0, 2 * n); else gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    if (d.style === 'points') return s.acc.t;
    // The Particles node's glow, unchanged: ¼ and 1/16 copies, blurred, composed over the points
    // with the lights' halos (Ink: the absorbance turned into ink covering the paper).
    const [d1, b1, d2, b2] = s.glow;
    const down = (src, into) => {
      gl.useProgram(fixed.down.p);
      samplers(fixed.down, [['u_src', src.t]]);
      ahSet(gl, fixed.down.u, 'u_texel', [1 / src.w, 1 / src.h]);
      quadInto(into.fb, into.w, into.h);
    };
    const blur = (a, scratch) => {
      gl.useProgram(fixed.blur.p);
      ahSet(gl, fixed.blur.u, 'u_size', [a.w, a.h]);
      samplers(fixed.blur, [['u_src', a.t]]); ahSet(gl, fixed.blur.u, 'u_dir', [1, 0]); quadInto(scratch.fb, scratch.w, scratch.h);
      samplers(fixed.blur, [['u_src', scratch.t]]); ahSet(gl, fixed.blur.u, 'u_dir', [0, 1]); quadInto(a.fb, a.w, a.h);
    };
    down(s.acc, d1); blur(d1, b1);
    down(d1, d2); blur(d2, b2);
    const C = fixed.compose;
    gl.useProgram(C.p);
    samplers(C, [['u_acc', s.acc.t], ['u_g1', d1.t], ['u_g2', d2.t]]);
    const cs = (k, v) => ahSet(gl, C.u, k, v);
    cs('u_size', [s.w, s.h]); cs('u_aspect', aspect); cs('u_glow', L.glow); cs('u_halo', L.halo); cs('u_ink', L.ink ? 1 : 0);
    cs('u_lights', lights.length); cs('u_light', lightVals); cs('u_lightCol', lightCols);
    quadInto(s.out.fb, s.out.w, s.out.h);
    return s.out.t;
  };

  /** The Particles node's glow and compose over s.acc (shared by the 2D and 3D draws); `lights` in picture units. */
  const glowCompose = (s, L, lights) => {
    const lightVals = [], lightCols = [];
    for (let i = 0; i < 4; i++) { const l = lights[i]; if (l) { lightVals.push(l.x, l.y, l.reach, l.power); lightCols.push(...l.colour); } else { lightVals.push(0, 0, 1, 0); lightCols.push(0, 0, 0); } }
    const [d1, b1, d2, b2] = s.glow;
    const down = (src, into) => {
      gl.useProgram(fixed.down.p);
      samplers(fixed.down, [['u_src', src.t]]);
      ahSet(gl, fixed.down.u, 'u_texel', [1 / src.w, 1 / src.h]);
      quadInto(into.fb, into.w, into.h);
    };
    const blur = (a, scratch) => {
      gl.useProgram(fixed.blur.p);
      ahSet(gl, fixed.blur.u, 'u_size', [a.w, a.h]);
      samplers(fixed.blur, [['u_src', a.t]]); ahSet(gl, fixed.blur.u, 'u_dir', [1, 0]); quadInto(scratch.fb, scratch.w, scratch.h);
      samplers(fixed.blur, [['u_src', scratch.t]]); ahSet(gl, fixed.blur.u, 'u_dir', [0, 1]); quadInto(a.fb, a.w, a.h);
    };
    down(s.acc, d1); blur(d1, b1);
    down(d1, d2); blur(d2, b2);
    const C = fixed.compose;
    gl.useProgram(C.p);
    samplers(C, [['u_acc', s.acc.t], ['u_g1', d1.t], ['u_g2', d2.t]]);
    const cs = (k, v) => ahSet(gl, C.u, k, v);
    cs('u_size', [s.w, s.h]); cs('u_aspect', s.w / s.h); cs('u_glow', L.glow); cs('u_halo', L.halo); cs('u_ink', L.ink ? 1 : 0);
    cs('u_lights', lights.length); cs('u_light', lightVals); cs('u_lightCol', lightCols);
    quadInto(s.out.fb, s.out.w, s.out.h);
    return s.out.t;
  };

  /**
   * A 3D Draw agents' look at a ray-marched scene: its camera probe read at four points into 4 × 1
   * texels (the origin; the rays at the centre, half a picture right and half up), and its Depth at
   * half the picture's size. As the app's runner does; null until linked.
   */
  const probeScene = (s, d, w, h) => {
    const pr = probes.get(d.slug);
    if (!pr || !pr.camera) return null;
    if (!s.cam) {
      const t = tex(gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, 4, 1);
      s.cam = { t, fb: fbOf([t]), w: 4, h: 1 };
    }
    if (pr.depth && !s.depth) s.depth = look(Math.ceil(s.w / 2), Math.ceil(s.h / 2), gl.NEAREST, gl.CLAMP_TO_EDGE);
    const P = pr.camera;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.cam.fb);
    for (let i = 0; i < 4; i++) {
      const [x, y, k] = AG_PROBE_POINTS[i];
      vec4s.set(d.probe.uniform, [x, y, k, 0]);
      gl.viewport(i, 0, 1, 1);
      env.use(P.p, w, h);
      setVec4s(P);
      env.quad();
      env.done();
    }
    if (pr.depth && s.depth) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.depth.fb); gl.viewport(0, 0, s.depth.w, s.depth.h);
      env.use(pr.depth.p, w, h);
      setVec4s(pr.depth);
      env.quad();
      env.done();
    }
    return { cam: s.cam.t, depth: pr.depth && s.depth ? s.depth.t : null };
  };

  /** Draw agents in 3D (AG_DRAW3_VERT): through the built-in camera (agCamera3) or a scene's, with depth of field. */
  const drawAgents3 = (s, d, g, gs, aspect, time, w, h) => {
    const n = g.side * g.side;
    const L = agDrawLook(d, n, s.h, read, readColour);
    const lights = agLights(d, read, readColour, time, aspect);
    const cam = agCamera3(d, read, time, s.h);
    const seen = d.probe ? probeScene(s, d, w, h) : null;
    clearFb(s.acc.fb, s.w, s.h);
    const P = fixed.draw3;
    gl.useProgram(P.p);
    const t = gs.tex[gs.cur];
    samplers(P, [['u_a', t[0]], ['u_b', t[1]], ['u_c', g.stateC ? t[2] : null], ['u_field', seen && seen.depth], ['u_cam', seen && seen.cam]]);
    const set = (k, v) => ahSet(gl, P.u, k, v);
    set('u_stateC', g.stateC ? 1 : 0); set('u_side', g.side); set('u_species', g.species); set('u_aspect', aspect);
    set('u_colorBy', L.colorBy); set('u_size', L.size); set('u_bright', L.bright); set('u_speedRef', L.speedRef);
    set('u_thread', L.thread); set('u_ink', L.ink ? 1 : 0); set('u_fade', L.fade ? 1 : 0);
    set('u_usePal', L.usePal ? 1 : 0); set('u_rainbow', L.rainbow ? 1 : 0);
    set('u_pal', L.pal ? [].concat(...L.pal.slice(0, 4)) : new Array(12).fill(0));
    set('u_colA', L.colA.slice(0, 3)); set('u_colB', L.colB.slice(0, 3)); set('u_viewSize', [s.w, s.h]);
    set('u_eye', cam.eye); set('u_fwd', cam.fwd); set('u_right', cam.right); set('u_up', cam.up);
    set('u_lens', cam.lens); set('u_ortho', seen ? 0 : cam.ortho); set('u_camDist', cam.dist);
    set('u_focus', seen ? cam.focusShare : cam.focus); set('u_coc', cam.coc); set('u_cap', cam.cap);
    set('u_camSrc', seen ? 1 : 0); set('u_depth', seen && seen.depth ? 1 : 0);
    const lightVals = [], lightCols = [], lz = [];
    for (let i = 0; i < 4; i++) { const l = lights[i]; if (l) { lightVals.push(l.x, l.y, l.reach, l.power); lightCols.push(...l.colour); lz.push(l.z); } else { lightVals.push(0, 0, 1, 0); lightCols.push(0, 0, 0); lz.push(0); } }
    set('u_lights', lights.length); set('u_lightZ', lz); set('u_light', lightVals); set('u_lightCol', lightCols);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.acc.fb); gl.viewport(0, 0, s.w, s.h);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(emptyVao);
    // Streaks: the blurred share as points, the sharp share as lines (the Particles node's 3D threads).
    set('u_prim', 0); gl.drawArrays(gl.POINTS, 0, n);
    if (L.lines) { set('u_prim', 1); gl.drawArrays(gl.LINES, 0, 2 * n); }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    if (d.style === 'points') return s.acc.t;
    const halos = seen ? [] : lights.map(l => {
      const q = agProject3(cam, [l.x, l.y, l.z]);
      return q.depth <= 0.05 ? Object.assign({}, l, { power: 0 }) : Object.assign({}, l, { x: q.x, y: q.y, reach: l.reach * cam.dist / q.depth });
    });
    return glowCompose(s, L, halos);
  };

  return {
    unsupported: null,
    /** Something runs while the clock does. */
    active: groups.some(g => g.live),
    /**
     * Step the simulations to `time` and draw the agents, for a picture of width × height.
     * Live: as many steps as the clock asks for, at most the governor's cap (frameMs: the last
     * frame's length); offline (a renderAt): exactly the steps up to `time`.
     */
    run(o) {
      const w = Math.max(1, o.width), h = Math.max(1, o.height), aspect = w / h;
      const cap = o.live ? agGovern(gov, o.frameMs || 0, 1000 / 60) : Infinity;
      const keep = { groups: new Set(groups.map(g => g.slug)) };
      for (const [k, s] of G) if (!keep.groups.has(k)) { dropGroup(s); G.delete(k); }
      // How many steps each group runs this frame (the shared schedule).
      const plan = [];
      const restarted = new Set();
      for (const e of steps) {
        const g = e.spec;
        if (!g.live || !e.p) continue;
        const s = group(g);
        const r = agGroupSteps(s, g, read, { live: !!o.live, time: o.time, cap, restart: false }, () => { restartGroup(s); restarted.add(g.slug); });
        plan.push({ e, s, steps: r.steps, spf: r.spf, preroll: r.preroll });
      }
      // Trails: their textures at this size; a trail fed by a group that started over starts empty too.
      const trailState = new Map();
      for (const t of trails) {
        if (!t.live) continue;
        const ts = trail(t, w, h);
        trailState.set(t.slug, ts);
        if (deposits.some(d => d.trail === t.slug && restarted.has(d.group))) clearTrail(ts);
      }
      const bindTrails = () => { for (const [slug, ts] of trailState) env.textures.set(trails.find(t => t.slug === slug).u.tex, ts.rt[ts.cur].t); };
      for (const [slug, ts] of trailState) if (ts.vol) vec4s.set(trails.find(t => t.slug === slug).u.vol, agVolUniform(ts.vol));
      // A volume as the picture sees it: summed through its depth into its front view.
      const project = () => {
        for (const [slug, ts] of trailState) {
          if (!ts.vol) continue;
          const P = fixed.proj3;
          gl.useProgram(P.p);
          samplers(P, [['u_src', ts.rt[ts.cur].t]]);
          ahSet(gl, P.u, 'u_vol', agVolUniform(ts.vol));
          quadInto(ts.proj.fb, ts.proj.w, ts.proj.h);
          env.textures.set(trails.find(t => t.slug === slug).u.tex, ts.proj.t);
        }
      };
      // A picture pixel in 0–1 texture units, for the sampling nodes' offsets (as a Pass's `_px`).
      for (const t of trails) env.vec2s.set(t.u.tex + '_px', [1 / w, 1 / h]);
      for (const d of draws) env.vec2s.set(d.u.tex + '_px', [1 / w, 1 / h]);

      const most = plan.reduce((m, p) => Math.max(m, p.steps), 0);
      for (let k = 0; k < most; k++) {
        const stepping = plan.filter(p => p.steps > k);
        let stepTime = null;
        // 1. The rule, for every walker of every group stepping now (reading the trails as they are).
        bindTrails();
        for (const p of stepping) {
          const g = p.e.spec, s = p.s;
          const win = agStepWindow(s, g, g.side * g.side, read);
          const time = agStepTime(s.step, p.spf, p.preroll);
          const heard = g.listeners.length ? hear(s, g, time) : [];
          if (stepTime === null) stepTime = time;
          // Collide (3D scene): the Scene's grid at this step's clock, before the rule (as the app does).
          for (const gr of g.grids || []) {
            vec4s.set(gr.u.at, [read(gr.at[0], 0), read(gr.at[1], 0), read(gr.at[2], 0), Math.max(1e-3, read(gr.at[3], 2))]);
            let gt = gridTex.get(gr.slug);
            if (!gt) { gt = look(GP_VOL * GP_VOL_TILES[0], GP_VOL * GP_VOL_TILES[1], gl.LINEAR, gl.CLAMP_TO_EDGE); gridTex.set(gr.slug, gt); }
            const gp = gridProgs.get(gr.slug);
            if (gp) {
              gl.bindFramebuffer(gl.FRAMEBUFFER, gt.fb); gl.viewport(0, 0, gt.w, gt.h);
              env.use(gp.p, w, h);
              setVec4s(gp);
              ahSet(gl, gp.u, 'u_time', time);
              env.quad();
              env.done();
            }
            env.textures.set(gr.u.grid, gt.t);
          }
          // Neighbours: the grid of where the walkers are as this step begins.
          if (g.neighbours && fixed.nbBin && g.u.nb) neighbours(g, s, aspect);
          bindState(g, s);
          gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb[1 - s.cur]);
          gl.viewport(0, 0, g.side, g.side);
          env.use(p.e.p, w, h);
          setVec4s(p.e);
          // The step's own clock (determinism), its number, its birth window and what its listeners heard.
          const set = (n, v) => ahSet(gl, p.e.u, n, v);
          set('u_time', time);
          set(g.u.step, s.step);
          set(g.u.win, [win.start, win.count, 0, 0]);
          for (const [n, v] of heard) set(n, v);
          env.quad();
          env.done();
          s.cur = 1 - s.cur;
          s.step++;
          bindState(g, s);
        }
        // 2. Deposits: the walkers as points added into their trails.
        const steppingSlugs = new Set(stepping.map(p => p.e.spec.slug));
        const fed = new Set();
        for (const d of deposits) {
          if (!steppingSlugs.has(d.group)) continue;
          const ts = trailState.get(d.trail), gs = G.get(d.group), g = groups.find(x => x.slug === d.group);
          if (!ts || !gs || !g) continue;
          fed.add(d.trail);
          const P = ts.vol ? fixed.deposit3 : fixed.deposit;
          gl.useProgram(P.p);
          const t = gs.tex[gs.cur];
          samplers(P, [['u_a', t[0]], ['u_b', t[1]], ['u_d', g.stateC ? t[3] : null]]);
          const set = (n, v) => ahSet(gl, P.u, n, v);
          set('u_stateC', g.stateC ? 1 : 0); set('u_what', d.what === 'velocity' ? 1 : 0);
          set('u_side', g.side); set('u_species', g.species); set('u_aspect', aspect);
          set('u_amount', read(d.params.amount, 1));
          if (ts.vol) { set('u_vol', agVolUniform(ts.vol)); set('u_atlas', [ts.w, ts.h]); }
          else set('u_size', Math.max(1, Math.min(4, Math.round(read(d.params.size, 1)))));
          const into = ts.rt[ts.cur];
          gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb); gl.viewport(0, 0, ts.w, ts.h);
          gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(emptyVao);
          gl.drawArrays(gl.POINTS, 0, g.side * g.side);
          gl.bindVertexArray(null);
          gl.disable(gl.BLEND);
        }
        // 3. Every trail fed this step spreads and fades.
        for (const t of trails) {
          if (!fed.has(t.slug)) continue;
          const ts = trailState.get(t.slug);
          const diffuse = read(t.params.diffuse, 1), keepShare = agKeep(read(t.params.halfLife, 0.1));
          const wrap = t.edges === 'wrap' ? 1 : 0, k5 = t.kernel === 5 ? 1 : 0, signed = t.signed ? 1 : 0;
          const own = t.stepShader ? trailSteps.get(t.slug) : null;
          if (t.stepShader && (!own || !own.p)) continue;
          const src = ts.rt[ts.cur], into = ts.rt[1 - ts.cur];
          if (own) {
            // Add / Block wired: the trail's own step program, at this step's clock time.
            env.textures.set(t.u.src, src.t);
            gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb); gl.viewport(0, 0, ts.w, ts.h);
            env.use(own.p, w, h);
            ahSet(gl, own.u, t.u.step, [diffuse, keepShare, wrap + 2 * k5 + 4 * signed, 1 / AG_STEP_HZ]);
            if (stepTime !== null) ahSet(gl, own.u, 'u_time', stepTime);
            env.quad();
            env.done();
            env.textures.set(t.u.src, null);
          } else {
            const P = ts.vol ? fixed.trail3 : fixed.trail;
            gl.useProgram(P.p);
            samplers(P, [['u_src', src.t]]);
            const set = (n, v) => ahSet(gl, P.u, n, v);
            set('u_diffuse', diffuse); set('u_keep', keepShare); set('u_wrap', wrap); set('u_k5', k5); set('u_signed', signed);
            if (ts.vol) set('u_vol', agVolUniform(ts.vol));
            quadInto(into.fb, ts.w, ts.h);
          }
          ts.cur = 1 - ts.cur;
        }
        // An offline run can be thousands of steps: hand the GPU each chunk as it goes.
        if (!o.live && k > 0 && k % AG_OFFLINE_CHUNK === 0) gl.flush();
      }
      for (const p of plan) bindState(p.e.spec, p.s);
      bindTrails();
      project();
      // 4. Draw agents.
      for (const d of draws) {
        if (!d.live) continue;
        const gs = G.get(d.group), g = groups.find(x => x.slug === d.group);
        if (!gs || !g) { env.textures.set(d.u.tex, null); continue; }
        env.textures.set(d.u.tex, d.space3d && fixed.draw3 ? drawAgents3(drawTargets(d, w, h), d, g, gs, aspect, o.time, w, h) : drawAgents(drawTargets(d, w, h), d, g, gs, aspect, o.time));
      }
      // 5. Readings for the page's Play (live only).
      if (o.live) readings(aspect);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
    },
    /** The simulation as it stands (scripted checks): per group its state textures, framebuffers and step; per trail and drawing its targets; each Collide (3D scene)'s grid. */
    state() { return { groups: G, trails: T, draws: D, grids: gridTex }; },
    /** The latest readings of the groups the page's setup reads: [sensor layer (`ag:<id>`), { alive, centroidX… }]. */
    readings() { return [...readOut]; },
    /** Start everything over: every group dead at step 0, every trail empty (a new render). */
    reset() {
      for (const s of G.values()) { restartGroup(s); s.live = agLiveState(); }
      for (const s of T.values()) clearTrail(s);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    dispose() {
      for (const s of G.values()) dropGroup(s);
      for (const s of T.values()) dropTrail(s);
      for (const s of D.values()) dropDraw(s);
      for (const r of R.values()) dropRead(r);
      R.clear(); readOut.clear();
      if (readProgs) { gl.deleteProgram(readProgs.read.p); gl.deleteProgram(readProgs.sum.p); }
      G.clear(); T.clear(); D.clear();
      for (const e of steps) if (e.p) gl.deleteProgram(e.p);
      for (const e of trailSteps.values()) if (e.p) gl.deleteProgram(e.p);
      for (const e of probes.values()) for (const x of [e.camera, e.depth]) if (x) gl.deleteProgram(x.p);
      for (const e of gridProgs.values()) gl.deleteProgram(e.p);
      for (const t of gridTex.values()) dropLook(t);
      for (const nb of NB.values()) dropNb(nb);
      NB.clear();
      for (const k in fixed) gl.deleteProgram(fixed[k].p);
      if (bessel) gl.deleteTexture(bessel);
      gl.deleteTexture(blank);
      gl.deleteVertexArray(emptyVao);
    },
  };
}
