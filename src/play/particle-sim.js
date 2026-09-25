/**
 * particle-sim.js — the particles layer: a small physics system over the
 * picture. Part of the layer kit (see play/kit): plain JS, run by the app and
 * inlined into web exports, where every kit file shares one scope.
 *
 * After the p5 particle system Shader Studio's author built: particles have a
 * velocity that steers toward a field direction, can gravitate or spiral
 * around an attractor and respawn when they reach it, and are born in a
 * spawn area. Coordinates are 0..1 across the picture with y up; speeds and
 * distances are in picture heights so motion is the same length both ways.
 *
 * Fields (where each particle wants to go):
 *   flow      the picture's brightness is a heading (turns × 360°, plus `angle`)
 *   climb     uphill in brightness (toward light)
 *   descend   downhill (toward dark)
 *   noise     an evolving flow field, independent of the picture
 *   none      only the attractor and zones move them
 * On flat parts of the picture climb and descend have no direction: `flat`
 * says whether particles wander on the noise field or settle and collect.
 *
 * Why flow avoids white (with Turns 1): the heading turns a full circle from
 * black to white, so it points back the way a particle came at mid grey.
 * Particles entering a bright shape are turned along its outline near 25%
 * brightness and never reach the inside, and those already inside drift out.
 *
 * Zones (play/kit/geometry.js) act on particles as walls, containers,
 * attractors, sinks, portals, emitters, absorbers, wind, vortices, drag,
 * tints and resizers, and count what is inside them (sensors). An emitter
 * births particles and pushes them out; an absorber pulls them straight in
 * and swallows them, and they are reborn at an emitter: side by side the
 * two draw field lines, like a magnet's.
 *
 * Flocking (boids) steers each particle by its neighbours as well: match
 * their heading (alignment), head for their middle (cohesion) and keep your
 * distance (separation). It adds to the field, attractor and zones.
 */

const TAU = Math.PI * 2;

// ── Noise (value noise, smooth, 3D so the field can evolve over time) ───────
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = t => t * t * (3 - 2 * t);
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** A seeded random source (mulberry32). Seed 0 means Math.random. */
export function seededRandom(seed) {
  if (!seed) return Math.random;
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── Palettes: a + b·cos(2π(c·t + d)), from the author's sketch ──────────────
export const PARTICLE_PALETTES = [
  { name: 'Ocean dusk', a: [0.5, 0.5, 0.5], b: [0.1, 0.4, 0.5], c: [1, 1, 1], d: [0, 0.1, 0.2] },
  { name: 'Rainbow', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.33, 0.67] },
  { name: 'Strawberry lemonade', a: [0.5, 0.2, 0.5], b: [0.5, 0.5, 0.3], c: [0, 0.2, 0.9], d: [0.3, 0.2, 0.2] },
  { name: 'Tinted sunset', a: [0.5, 0, 0.5], b: [0.6, 0.5, 0.1], c: [1, 1, 0.5], d: [0.85, 0.2, 0.3] },
  { name: 'Sea sherbet', a: [0.5, 0.5, 0.5], b: [0.4431, 0.1235, 0.0042], c: [1, 0.7, 0.4], d: [0, 0.15, 0.2] },
  { name: 'Popsicle', a: [0.5, 0.5, 0.5], b: [0.4431, 0.4235, 0.4235], c: [2, 1, 0], d: [0.5, 0.2, 0.25] },
  { name: 'Deep sea', a: [0.2, 0.3, 0.5], b: [0.3, 0.165, 0.254], c: [0.2, 0.5, 1], d: [0.5, 0.5, 0.5] },
  { name: 'Berry', a: [0.721, 0.28, 0.542], b: [0.659, 0.181, 0.396], c: [0.612, 0.14, 0.196], d: [0.538, 0.78, 0.7] },
  { name: 'Violet', a: [0.412, 0.102, 0.491], b: [0.397, 0.13, 0.485], c: [0.612, 0.14, 0.196], d: [0.538, 0.978, 0.7] },
  { name: 'Lime haze', a: [0.7, 0.8, 0.5], b: [0.3, 0.3, 0.8], c: [0.147, 0.557, 0.197], d: [0.956, 0.39, 1.541] },
];

export function paletteColour(index, t) {
  const p = PARTICLE_PALETTES[Math.max(0, Math.min(PARTICLE_PALETTES.length - 1, index | 0))];
  const ch = i => Math.max(0, Math.min(1, p.a[i] + p.b[i] * Math.cos(TAU * (p.c[i] * t + p.d[i]))));
  return [ch(0), ch(1), ch(2)];
}

/** Palette colours as CSS strings, 64 steps per palette, built once. */
const paletteCss = [];
export function paletteCssAt(index, t) {
  const i = Math.max(0, Math.min(PARTICLE_PALETTES.length - 1, index | 0));
  if (!paletteCss[i]) paletteCss[i] = Array.from({ length: 64 }, (_, k) => { const c = paletteColour(i, k / 63); return 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')'; });
  const u = t - Math.floor(t);
  return paletteCss[i][Math.round(u * 63)];
}

// ── Picture sampling (bilinear, so there are no grid lines) ─────────────────
/** Brightness 0..1 at (x, y) in 0..1 with y up, from an RGBA grid of sw × sh. */
export function brightnessAt(sample, sw, sh, x, y) {
  const fx = Math.max(0, Math.min(sw - 1, x * sw - 0.5));
  const fy = Math.max(0, Math.min(sh - 1, (1 - y) * sh - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
  const L = (px, py) => { const k = (py * sw + px) * 4; return (sample[k] * 0.299 + sample[k + 1] * 0.587 + sample[k + 2] * 0.114) / 255; };
  const a = L(x0, y0), b = L(x1, y0), c = L(x0, y1), d = L(x1, y1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** The picture's colour at (x, y), blended between samples, as CSS. Quantised to 5 bits a channel so strings are cached. */
const colourCss = new Map();
function colourAt(sample, sw, sh, x, y) {
  const fx = Math.max(0, Math.min(sw - 1, x * sw - 0.5)), fy = Math.max(0, Math.min(sh - 1, (1 - y) * sh - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
  const k00 = (y0 * sw + x0) * 4, k10 = (y0 * sw + x1) * 4, k01 = (y1 * sw + x0) * 4, k11 = (y1 * sw + x1) * 4;
  const ch = o => { const a = sample[k00 + o] + (sample[k10 + o] - sample[k00 + o]) * tx, b = sample[k01 + o] + (sample[k11 + o] - sample[k01 + o]) * tx; return (a + (b - a) * ty) >> 3; };
  const key = (ch(0) << 10) | (ch(1) << 5) | ch(2);
  let s = colourCss.get(key);
  if (!s) { s = 'rgb(' + ((key >> 10) << 3) + ',' + (((key >> 5) & 31) << 3) + ',' + ((key & 31) << 3) + ')'; colourCss.set(key, s); }
  return s;
}

// ── System ───────────────────────────────────────────────────────────────────

function allocParticles(n) {
  return {
    count: n,
    x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n),
    age: new Float32Array(n), life: new Float32Array(n), r: new Float32Array(n),
    alive: new Uint8Array(n), cool: new Float32Array(n), zt: new Int16Array(n).fill(-1), zs: new Float32Array(n).fill(1),
    seed: 0,
  };
}

/** Fresh state for `count` particles. `rand` is injectable for tests. `dead` starts them unborn (burst mode). */
export function createParticles(count, rand = Math.random, dead = false) {
  const n = Math.max(1, count | 0);
  const st = allocParticles(n);
  st.seed = rand() * 1000;
  for (let i = 0; i < n; i++) { st.x[i] = rand(); st.y[i] = rand(); st.r[i] = rand(); st.age[i] = rand() * 10; st.life[i] = 0.6 + rand() * 0.8; st.alive[i] = dead ? 0 : 1; }
  return st;
}

/** The same particles with a new count: existing ones keep going, new ones are born where particles are born. */
export function resizeParticles(st, count, rand = Math.random, dead = false) {
  const n = Math.max(1, count | 0);
  if (n === st.count) return st;
  const out = allocParticles(n);
  out.seed = st.seed;
  const keep = Math.min(n, st.count);
  for (const k of ['x', 'y', 'vx', 'vy', 'age', 'life', 'r', 'alive', 'cool', 'zt', 'zs']) out[k].set(st[k].subarray(0, keep));
  for (let i = keep; i < n; i++) { out.x[i] = rand(); out.y[i] = rand(); out.r[i] = rand(); out.age[i] = 0; out.life[i] = 0.6 + rand() * 0.8; out.alive[i] = dead ? 0 : 1; }
  return out;
}

/** Where a new particle appears: an emitter zone if the layer has any, else the spawn setting. */
function spawn(st, i, p, env, rand) {
  const a = rand() * TAU;
  const emitters = env.emitters;
  const aspectInv = 1 / (env.aspect || 1);
  let inward = null, launch = null;
  if (emitters && emitters.length) {
    const z = emitters[Math.floor(rand() * emitters.length)];
    const pt = z.randomPoint(rand);
    st.x[i] = pt[0]; st.y[i] = pt[1];
    // Launched outward from the emitter's middle (any direction when born right on it).
    const ox = (pt[0] - z.x) * (env.aspect || 1), oy = pt[1] - z.y;
    launch = { dir: Math.hypot(ox, oy) > 1e-4 ? Math.atan2(oy, ox) : a, speed: p.speed * 0.18 * 0.7 + z.strength * 0.06 };
  } else switch (p.spawn) {
    case 'edges': {
      const side = Math.floor(rand() * 4), t = rand();
      st.x[i] = side === 0 ? 0 : side === 1 ? 1 : t;
      st.y[i] = side === 2 ? 0 : side === 3 ? 1 : t;
      // Head into the picture, so a particle born on an edge isn't recycled at once.
      inward = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      break;
    }
    case 'center': case 'null': {
      const c = p.spawn === 'null' && env.spawnPoint ? env.spawnPoint : { x: 0.5, y: 0.5 };
      const rad = Math.sqrt(rand()) * p.spawnRadius;
      st.x[i] = c.x + Math.cos(a) * rad * aspectInv;
      st.y[i] = c.y + Math.sin(a) * rad;
      break;
    }
    default:
      st.x[i] = rand(); st.y[i] = rand();
  }
  if (launch) {
    const d = launch.dir + (rand() - 0.5) * 0.5, sp = launch.speed * (0.7 + rand() * 0.6);
    st.vx[i] = Math.cos(d) * sp; st.vy[i] = Math.sin(d) * sp;
  } else {
    const dir = inward === null ? a : inward + (rand() - 0.5) * 1.2;
    const s = p.speed * 0.05 * (inward === null ? rand() : 0.5 + rand() * 0.5);
    st.vx[i] = Math.cos(dir) * s; st.vy[i] = Math.sin(dir) * s;
  }
  st.age[i] = 0;
  st.life[i] = 0.6 + rand() * 0.8;
  st.alive[i] = 1;
  st.cool[i] = 0;
}

/** A layer's lifetime in seconds for particle i (0 = forever). Burst particles always die. */
function lifeOf(st, i, p) {
  const life = p.emit === 'burst' && !(p.life > 0) ? 2.5 : p.life;
  return life > 0 ? life * st.life[i] : 0;
}

/**
 * Burst: `amount` particles are born at once (an action on a trigger), with an
 * outward kick. In burst mode they come from the unborn pool; otherwise the
 * oldest ones are reborn.
 */
export function burstParticles(st, p, env, amount, rand = Math.random) {
  let n = Math.max(0, Math.round(amount));
  const kick = (p.speed * 0.18 + 0.05) * 1.6;
  for (let i = 0; i < st.count && n > 0; i++) {
    if (p.emit === 'burst' && st.alive[i]) continue;
    spawn(st, i, p, env, rand);
    const a = rand() * TAU, k = kick * (0.4 + rand() * 0.8);
    st.vx[i] = Math.cos(a) * k; st.vy[i] = Math.sin(a) * k;
    n--;
  }
  if (n > 0 && p.emit !== 'burst') return;
  // Not enough unborn particles: recycle the oldest.
  while (n > 0) {
    let oldest = -1, age = -1;
    for (let i = 0; i < st.count; i++) if (st.age[i] > age) { age = st.age[i]; oldest = i; }
    if (oldest < 0) break;
    spawn(st, oldest, p, env, rand);
    const a = rand() * TAU, k = kick * (0.4 + rand() * 0.8);
    st.vx[oldest] = Math.cos(a) * k; st.vy[oldest] = Math.sin(a) * k;
    n--;
  }
}

/** Scatter: a random kick to every particle. */
export function scatterParticles(st, p, strength, rand = Math.random) {
  const k = (p.speed * 0.18 + 0.05) * 2 * (strength || 1);
  for (let i = 0; i < st.count; i++) { const a = rand() * TAU, m = k * (0.3 + rand()); st.vx[i] += Math.cos(a) * m; st.vy[i] += Math.sin(a) * m; st.cool[i] = 0; }
}

/** Every particle reborn. */
export function resetParticles(st, p, env, rand = Math.random) {
  for (let i = 0; i < st.count; i++) {
    if (p.emit === 'burst') { st.alive[i] = 0; continue; }
    spawn(st, i, p, env, rand);
    if (!(env.emitters && env.emitters.length) && p.spawn === 'anywhere') { st.x[i] = rand(); st.y[i] = rand(); }
  }
}

/**
 * Advance every particle by env.dt seconds.
 * p:   the layer's settings (see types/play.ts ParticlesLayer), numbers already driven
 * env: { dt, time, aspect (W/H), sample, sw, sh, attractorPoint ({x,y}|null),
 *        spawnPoint ({x,y}|null), zones (compiled, geometry.js), emitters,
 *        zoneById (Map) }
 */
export function stepParticles(st, p, env, rand = Math.random) {
  const dt = Math.min(0.1, Math.max(0, env.dt));
  const aspect = env.aspect || 1;
  const sample = env.sample, sw = env.sw, sh = env.sh;
  const maxV = p.speed * 0.18;                 // picture heights per second
  const steer = 1 - Math.exp(-dt * (0.5 + p.steer * 12)); // how quickly velocity turns toward the field
  const drag = Math.exp(-dt * 0.8);
  const nz = env.time * p.noiseEvolve;
  const rot = ((p.angle || 0) * Math.PI) / 180;
  const ap = p.attractor !== 'none' ? env.attractorPoint : null;
  // One sample row, the same physical distance across and up.
  const ey = 1 / Math.max(sh || 36, 1), ex = ey / aspect;
  const zones = env.zones || [];
  for (const z of zones) z.total += st.count;
  // With an emitter, particles leaving the picture come back out of it.
  const emitting = !!(env.emitters && env.emitters.length);
  if (p.flock > 0) flockPass(st, p, env, dt);
  for (let i = 0; i < st.count; i++) {
    if (!st.alive[i]) { st.zt[i] = -1; continue; }
    let x = st.x[i], y = st.y[i], vx = st.vx[i], vy = st.vy[i];
    // 1. Where the field wants to go (unit direction, or 0 to coast).
    let dx = 0, dy = 0, settle = false;
    const noiseDir = () => { const n = noise3(x * p.noiseScale * aspect, y * p.noiseScale, nz + st.seed); const a = n * TAU * 2 + rot; dx = Math.cos(a); dy = Math.sin(a); };
    if (p.field === 'noise') noiseDir();
    else if (sample && (p.field === 'flow' || p.field === 'climb' || p.field === 'descend')) {
      if (p.field === 'flow') {
        const a = brightnessAt(sample, sw, sh, x, y) * p.turns * TAU + rot;
        dx = Math.cos(a); dy = Math.sin(a);
      } else {
        const gx = brightnessAt(sample, sw, sh, x + ex, y) - brightnessAt(sample, sw, sh, x - ex, y);
        const gy = brightnessAt(sample, sw, sh, x, y + ey) - brightnessAt(sample, sw, sh, x, y - ey);
        const m = Math.hypot(gx, gy);
        if (m > 0.004) { const s = p.field === 'climb' ? 1 : -1; dx = s * gx / m; dy = s * gy / m; }
        else if (p.flat === 'settle') settle = true;
        else noiseDir();
      }
    }
    // 2. Steer the velocity toward it (inertia keeps motion smooth).
    if (settle) { vx *= Math.exp(-dt * 6); vy *= Math.exp(-dt * 6); }
    else if (dx || dy) { vx += (dx * maxV - vx) * steer; vy += (dy * maxV - vy) * steer; }
    else { vx *= drag; vy *= drag; }
    // 3. Attractor: gravitate (pull), spiral (pull + orbit) or repel.
    let caught = false;
    if (ap) {
      const ax = (ap.x - x) * aspect, ay = ap.y - y;
      const d2 = Math.max(0.0004, ax * ax + ay * ay), d = Math.sqrt(d2);
      if (p.force !== 'repel' && d < p.catchRadius) caught = true;
      const f = (p.strength * 0.02) / Math.min(Math.max(d2, 0.0025), 0.25);
      const ux = ax / d, uy = ay / d;
      const sgn = p.force === 'repel' ? -1 : 1;
      vx += sgn * ux * f * dt; vy += sgn * uy * f * dt;
      if (p.force === 'spiral') { vx += -uy * f * dt * 1.5; vy += ux * f * dt * 1.5; }
      const sp = Math.hypot(vx, vy), cap = maxV * 2.5 + 0.05;
      if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
    }
    // 4. Zone forces, read where the particle is now.
    for (let k = 0; k < zones.length; k++) {
      const z = zones[k];
      const act = z.action;
      if (act !== 'attract' && act !== 'repel' && act !== 'wind' && act !== 'vortex' && act !== 'drag' && act !== 'emitter' && act !== 'absorber') continue;
      if (act === 'emitter' || act === 'absorber') {
        // Like the attractor: strong close in, weaker far out, measured from the middle.
        const ax = (z.x - x) * aspect, ay = z.y - y, d2 = ax * ax + ay * ay, d = Math.sqrt(d2) || 1e-6;
        if (d > z.reach) continue;
        const f = (z.strength * 0.02) / Math.min(Math.max(d2, 0.0025), 0.25), sgn = act === 'absorber' ? 1 : -1;
        vx += sgn * (ax / d) * f * dt; vy += sgn * (ay / d) * f * dt;
        const sp = Math.hypot(vx, vy), cap = maxV * 2.5 + 0.05 + z.strength * 0.05;
        if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
        continue;
      }
      const d = z.dist(x, y);
      if (act === 'attract' || act === 'repel') {
        if (d > z.reach || (act === 'attract' && d < 0)) continue;
        const n = z.normal(x, y), f = z.strength * 0.6 * (1 - Math.max(0, d) / z.reach);
        const s = act === 'attract' ? -1 : 1;
        vx += s * n[0] * f * dt; vy += s * n[1] * f * dt;
      } else if (act === 'vortex') {
        if (d > z.reach) continue;
        const n = z.normal(x, y), f = z.strength * 0.5 * (1 - Math.max(0, d) / z.reach);
        vx += -n[1] * f * dt; vy += n[0] * f * dt;
      } else if (d < 0) {
        if (act === 'wind') { vx += Math.cos(z.angle) * z.strength * 0.5 * dt; vy -= Math.sin(z.angle) * z.strength * 0.5 * dt; }
        else { const k2 = Math.exp(-dt * z.strength * 4); vx *= k2; vy *= k2; }
      }
    }
    // 5. Move (x is scaled so a step is the same length in pixels both ways).
    x += (vx / aspect) * dt; y += vy * dt;
    st.age[i] += dt;
    if (st.cool[i] > 0) st.cool[i] -= dt;
    // 6. Zones at the new position: walls, sinks, portals, tints, sensors.
    let respawn = caught, tint = -1, scale = 1;
    for (let k = 0; k < zones.length && !respawn; k++) {
      const z = zones[k];
      let d = z.dist(x, y);
      const act = z.action;
      if (d < 0) z.inside++;
      if (act === 'wall' || act === 'container') {
        if (act === 'container') d = -d;
        if (d < 0) {
          const n = z.normal(x, y), s = act === 'container' ? -1 : 1;
          const nx = n[0] * s, ny = n[1] * s;
          // Back onto the surface, then drop the push into the wall (slide) or reflect it (bounce).
          x -= (nx * d) / aspect; y -= ny * d;
          const vn = vx * nx + vy * ny;
          if (vn < 0) { vx -= (1 + z.bounce) * vn * nx; vy -= (1 + z.bounce) * vn * ny; }
        }
      } else if (d >= 0) continue;
      else if (act === 'sink' || act === 'absorber') respawn = true;
      else if (act === 'portal' && st.cool[i] <= 0 && env.zoneById) {
        const t = env.zoneById.get(z.targetId);
        if (t && t !== z) {
          // Same place relative to the other shape, coming out the side it is heading.
          const sx = t.w / Math.max(1e-4, z.w), sy = t.h / Math.max(1e-4, z.h);
          const rx = (x - z.x) * aspect * sx, ry = (y - z.y) * sy;
          const turn = z.rot - t.rot, c = Math.cos(turn), sn = Math.sin(turn);
          x = t.x + (rx * c - ry * sn) / aspect; y = t.y + rx * sn + ry * c;
          const ovx = vx; vx = vx * c - vy * sn; vy = ovx * sn + vy * c;
          st.cool[i] = 0.4;
        }
      } else if (act === 'tint') tint = k;
      else if (act === 'resize') scale *= z.scale;
    }
    st.zt[i] = tint; st.zs[i] = scale;
    // 7. Edges and lifetime.
    const life = lifeOf(st, i, p);
    const expired = life > 0 && st.age[i] > life;
    if (expired && p.emit === 'burst') { st.alive[i] = 0; st.x[i] = x; st.y[i] = y; continue; }
    respawn = respawn || expired;
    const out = x < 0 || x > 1 || y < 0 || y > 1;
    if (out && !respawn) {
      if (p.edges === 'wrap') { x -= Math.floor(x); y -= Math.floor(y); }
      else if (p.edges === 'bounce') {
        if (x < 0) { x = -x; vx = -vx; } else if (x > 1) { x = 2 - x; vx = -vx; }
        if (y < 0) { y = -y; vy = -vy; } else if (y > 1) { y = 2 - y; vy = -vy; }
      } else if (p.emit === 'burst') { st.alive[i] = 0; continue; }
      else respawn = true;
      if (emitting && p.emit !== 'burst') respawn = true;
    }
    st.x[i] = x; st.y[i] = y; st.vx[i] = vx; st.vy[i] = vy;
    if (respawn) spawn(st, i, p, env, rand);
  }
  if (p.collide > 0) separate(st, p, env);
}

/**
 * Boids: each particle looks at up to 16 neighbours within flockRadius and
 * steers to match their heading, toward their middle and away from the ones
 * too close. Speeds are nudged toward the layer's speed so a flock keeps
 * flying even with no field.
 */
function flockPass(st, p, env, dt) {
  const aspect = env.aspect || 1, R = Math.max(0.005, p.flockRadius), maxV = Math.max(0.02, p.speed * 0.18);
  const cols = Math.max(1, Math.ceil(aspect / R)), rows = Math.max(1, Math.ceil(1 / R));
  if (cols * rows > 400000) return;
  const head = new Int32Array(cols * rows).fill(-1), next = new Int32Array(st.count);
  for (let i = 0; i < st.count; i++) {
    if (!st.alive[i]) continue;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((st.x[i] * aspect) / R))), cy = Math.min(rows - 1, Math.max(0, Math.floor(st.y[i] / R)));
    const h = cy * cols + cx; next[i] = head[h]; head[h] = i;
  }
  const k = p.flock * 4 * dt;
  const ax = new Float32Array(st.count), ay = new Float32Array(st.count);
  for (let i = 0; i < st.count; i++) {
    if (!st.alive[i]) continue;
    const X = st.x[i] * aspect, Y = st.y[i], cx = Math.floor(X / R), cy = Math.floor(Y / R);
    let n = 0, avx = 0, avy = 0, px = 0, py = 0, sx = 0, sy = 0;
    for (let oy = -1; oy <= 1 && n < 16; oy++) for (let ox = -1; ox <= 1 && n < 16; ox++) {
      const gx = cx + ox, gy = cy + oy;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      for (let j = head[gy * cols + gx]; j >= 0 && n < 16; j = next[j]) {
        if (j === i) continue;
        const dx = st.x[j] * aspect - X, dy = st.y[j] - Y, d = Math.hypot(dx, dy);
        if (d >= R || d < 1e-7) continue;
        n++; avx += st.vx[j]; avy += st.vy[j]; px += dx; py += dy;
        const push = (1 - d / R) / d; sx -= dx * push; sy -= dy * push;
      }
    }
    if (n) {
      ax[i] = ((avx / n - st.vx[i]) * p.flockAlign + (px / n / R) * maxV * p.flockCohere + (sx / n) * R * maxV * 4 * p.flockSeparate);
      ay[i] = ((avy / n - st.vy[i]) * p.flockAlign + (py / n / R) * maxV * p.flockCohere + (sy / n) * R * maxV * 4 * p.flockSeparate);
    }
    // Keep flying: nudge the speed toward the layer's.
    const sp = Math.hypot(st.vx[i], st.vy[i]);
    if (sp > 1e-6) { const f = (maxV - sp) / sp * 0.5; ax[i] += st.vx[i] * f; ay[i] += st.vy[i] * f; }
    else { const a = st.r[i] * Math.PI * 2; ax[i] += Math.cos(a) * maxV * 0.5; ay[i] += Math.sin(a) * maxV * 0.5; }
  }
  for (let i = 0; i < st.count; i++) { st.vx[i] += ax[i] * k; st.vy[i] += ay[i] * k; }
}

/**
 * Collisions: particles closer than twice their radius push apart (a spatial
 * hash keeps it near O(n)). Radius is the drawn size, in picture heights.
 */
function separate(st, p, env) {
  const aspect = env.aspect || 1;
  const rad = Math.max(0.002, (p.size * (env.dpr || 1)) / Math.max(1, env.H || 720));
  const minD = rad * 2, cell = minD;
  const cols = Math.max(1, Math.ceil(aspect / cell)), rows = Math.max(1, Math.ceil(1 / cell));
  if (cols * rows > 400000) return;
  const head = new Int32Array(cols * rows).fill(-1), next = new Int32Array(st.count);
  for (let i = 0; i < st.count; i++) {
    if (!st.alive[i]) continue;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((st.x[i] * aspect) / cell))), cy = Math.min(rows - 1, Math.max(0, Math.floor(st.y[i] / cell)));
    const h = cy * cols + cx; next[i] = head[h]; head[h] = i;
  }
  const k = Math.min(1, p.collide) * 0.5;
  for (let i = 0; i < st.count; i++) {
    if (!st.alive[i]) continue;
    const X = st.x[i] * aspect, Y = st.y[i];
    const cx = Math.floor(X / cell), cy = Math.floor(Y / cell);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      for (let j = head[gy * cols + gx]; j >= 0; j = next[j]) {
        if (j <= i) continue;
        const dx = st.x[j] * aspect - X, dy = st.y[j] - Y, d = Math.hypot(dx, dy);
        if (d >= minD || d < 1e-7) continue;
        const push = ((minD - d) / d) * k;
        st.x[i] -= (dx * push) / aspect; st.y[i] -= dy * push;
        st.x[j] += (dx * push) / aspect; st.y[j] += dy * push;
        // Trade the velocity along the contact (a soft, equal-mass bump).
        const nx = dx / d, ny = dy / d, rv = (st.vx[j] - st.vx[i]) * nx + (st.vy[j] - st.vy[i]) * ny;
        if (rv < 0) { const imp = rv * 0.5 * Math.min(1, p.collide); st.vx[i] += imp * nx; st.vy[i] += imp * ny; st.vx[j] -= imp * nx; st.vy[j] -= imp * ny; }
      }
    }
  }
}

/**
 * A particle's 0..1 reading of what its size or opacity follows:
 *   brightness  the picture under it          speed  how fast it moves (vs max)
 *   age         how far through its life       null   closeness to a null (1 at the null, 0 at `falloff`)
 */
export function modulator(by, st, i, p, env) {
  switch (by) {
    case 'brightness': return env.sample ? brightnessAt(env.sample, env.sw, env.sh, st.x[i], st.y[i]) : 0.5;
    case 'speed': return Math.min(1, Math.hypot(st.vx[i], st.vy[i]) / Math.max(1e-6, p.speed * 0.18));
    case 'age': { const life = lifeOf(st, i, p); return life > 0 ? Math.min(1, st.age[i] / life) : Math.min(1, st.age[i] / 10); }
    case 'null': {
      const m = env.modPoint;
      if (!m) return 0;
      const d = Math.hypot((st.x[i] - m.x) * (env.aspect || 1), st.y[i] - m.y);
      return Math.max(0, 1 - d / Math.max(0.01, p.falloff));
    }
    default: return 0;
  }
}

/** Scale factor from a modulator: amount 0 = none, +1 = up to double where the reading is 1, −1 = shrink to nothing there. */
function modScale(by, amount, st, i, p, env) {
  if (by === 'none' || !amount) return 1;
  return Math.max(0, 1 + amount * modulator(by, st, i, p, env));
}

/** Birth and death fades: `fade` is the fraction of the life spent fading in and out (fade-in only when particles live forever). */
function fadeOf(st, i, p) {
  if (!(p.fade > 0)) return 1;
  const life = lifeOf(st, i, p), age = st.age[i];
  const span = life > 0 ? Math.max(0.05, life * p.fade * 0.5) : 0.5 * p.fade + 0.05;
  let a = Math.min(1, age / span);
  if (life > 0) a = Math.min(a, Math.max(0, (life - age) / span));
  return a;
}

function star(ctx, r) {
  ctx.moveTo(0, -r);
  for (let k = 1; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
}

/** A sprite tinted to a colour, cached per sprite and colour. */
const tintCache = new Map();
function tintedSprite(sprite, css) {
  const key = (sprite.src || '') + '|' + css;
  let c = tintCache.get(key);
  if (c) return c;
  const w = sprite.naturalWidth || sprite.width, h = sprite.naturalHeight || sprite.height;
  c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d');
  x.drawImage(sprite, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = css; x.fillRect(0, 0, w, h);
  if (tintCache.size > 24) tintCache.delete(tintCache.keys().next().value);
  tintCache.set(key, c);
  return c;
}

/**
 * Draw the particles into `ctx` (W × H px).
 *   p.shape   dot · square · triangle · streak (along its motion) · ring · star · image (env.sprite)
 *   p.rotate  heading (point where it goes) · spin · none
 *   p.colour  tint · picture (the colour under it) · palette (by heading, speed, age or brightness)
 *   p.sizeBy / p.opacityBy with p.sizeAmount / p.opacityAmount: see modulator()
 *   p.links   joins particles closer than this (picture heights) with lines
 * env.alpha is the layer opacity; per-particle opacity multiplies it. Tint
 * and resize zones (env.zones) recolour and rescale particles inside them.
 */
export function drawParticles(ctx, st, p, env) {
  const W = env.W, H = env.H, sample = env.sample, sw = env.sw, sh = env.sh;
  const dpr = env.dpr || 1, base = p.size * dpr, alpha = env.alpha == null ? 1 : env.alpha;
  const fixed = 'rgb(' + Math.round(p.color[0] * 255) + ',' + Math.round(p.color[1] * 255) + ',' + Math.round(p.color[2] * 255) + ')';
  const sprite = p.shape === 'image' ? env.sprite : null;
  const spriteRatio = sprite ? (sprite.naturalWidth || sprite.width) / Math.max(1, sprite.naturalHeight || sprite.height) : 1;
  const zones = env.zones || [];
  const zoneCss = zones.map(z => z.action === 'tint' ? 'rgb(' + Math.round(z.tint[0] * 255) + ',' + Math.round(z.tint[1] * 255) + ',' + Math.round(z.tint[2] * 255) + ')' : null);
  const hasTintZones = zoneCss.some(Boolean);
  if (p.links > 0) drawLinks(ctx, st, p, env, fixed, alpha);
  // Fast path: one colour, one opacity, round or square dots → a single path.
  if ((p.shape === 'dot' || p.shape === 'square' || (p.shape === 'image' && !sprite)) && p.colour === 'tint' && p.opacityBy === 'none' && !(p.fade > 0) && !hasTintZones) {
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = fixed;
    ctx.beginPath();
    for (let i = 0; i < st.count; i++) {
      if (!st.alive[i]) continue;
      const r = Math.max(0.3, base * (1 - p.sizeJitter * st.r[i]) * modScale(p.sizeBy, p.sizeAmount, st, i, p, env) * st.zs[i]);
      const cx = st.x[i] * W, cy = (1 - st.y[i]) * H;
      if (p.shape === 'square') ctx.rect(cx - r, cy - r, r * 2, r * 2);
      else { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const tinted = sprite && p.tintSprite && p.colour === 'tint' ? tintedSprite(sprite, fixed) : sprite;
  for (let i = 0; i < st.count; i++) {
    if (!st.alive[i]) continue;
    const r = Math.max(0.3, base * (1 - p.sizeJitter * st.r[i]) * modScale(p.sizeBy, p.sizeAmount, st, i, p, env) * st.zs[i]);
    const a = Math.min(1, alpha * modScale(p.opacityBy, p.opacityAmount, st, i, p, env) * fadeOf(st, i, p));
    if (a <= 0.004 || r <= 0.3) continue;
    ctx.globalAlpha = a;
    const zt = st.zt[i];
    if (zt >= 0 && zoneCss[zt]) ctx.fillStyle = zoneCss[zt];
    else if (p.colour === 'picture' && sample) ctx.fillStyle = colourAt(sample, sw, sh, st.x[i], st.y[i]);
    else if (p.colour === 'palette') {
      const t = p.paletteBy === 'speed' || p.paletteBy === 'age' || p.paletteBy === 'brightness' ? modulator(p.paletteBy, st, i, p, env) : Math.atan2(st.vy[i], st.vx[i]) / TAU + 0.5;
      ctx.fillStyle = paletteCssAt(p.palette, t);
    } else ctx.fillStyle = fixed;
    const cx = st.x[i] * W, cy = (1 - st.y[i]) * H;
    if (p.shape === 'dot' || (p.shape === 'image' && !sprite)) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); continue; }
    const heading = -Math.atan2(st.vy[i], st.vx[i]);
    const rot = p.rotate === 'heading' ? heading : p.rotate === 'spin' ? env.time * 2 + st.r[i] * TAU : 0;
    ctx.setTransform(1, 0, 0, 1, cx, cy);
    if (rot) ctx.rotate(rot);
    switch (p.shape) {
      case 'square': ctx.fillRect(-r, -r, r * 2, r * 2); break;
      case 'triangle': ctx.beginPath(); ctx.moveTo(r * 1.2, 0); ctx.lineTo(-r * 0.8, r * 0.8); ctx.lineTo(-r * 0.8, -r * 0.8); ctx.closePath(); ctx.fill(); break;
      case 'streak': {
        const len = r * 2 + Math.hypot(st.vx[i], st.vy[i]) * H * 0.06;
        if (!rot) ctx.rotate(heading);
        ctx.fillRect(-len, -r * 0.35, len, r * 0.7);
        break;
      }
      case 'ring': ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.lineWidth = Math.max(1, r * 0.3); ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); break;
      case 'star': ctx.beginPath(); star(ctx, r * 1.3); ctx.fill(); break;
      case 'image': {
        const img = zt >= 0 && zoneCss[zt] && p.tintSprite ? tintedSprite(sprite, zoneCss[zt]) : tinted;
        const h = r * 2, w = p.crop ? h : h * spriteRatio;
        if (p.crop) {
          const iw = sprite.naturalWidth || sprite.width, ih = sprite.naturalHeight || sprite.height, s = Math.min(iw, ih);
          ctx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, -w / 2, -h / 2, w, h);
        } else ctx.drawImage(img, -w / 2, -h / 2, w, h);
        break;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.globalAlpha = 1;
}

/** Plexus: lines between particles closer than p.links, fading with distance. Checks at most 1500 particles. */
function drawLinks(ctx, st, p, env, css, alpha) {
  const aspect = env.aspect || 1, W = env.W, H = env.H, maxD = p.links;
  const n = Math.min(st.count, 1500);
  const cols = Math.max(1, Math.ceil(aspect / maxD)), rows = Math.max(1, Math.ceil(1 / maxD));
  if (cols * rows > 200000) return;
  const head = new Int32Array(cols * rows).fill(-1), next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!st.alive[i]) continue;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((st.x[i] * aspect) / maxD))), cy = Math.min(rows - 1, Math.max(0, Math.floor(st.y[i] / maxD)));
    const h = cy * cols + cx; next[i] = head[h]; head[h] = i;
  }
  const BUCKETS = 6, paths = Array.from({ length: BUCKETS }, () => []);
  for (let i = 0; i < n; i++) {
    if (!st.alive[i]) continue;
    const X = st.x[i] * aspect, Y = st.y[i];
    const cx = Math.floor(X / maxD), cy = Math.floor(Y / maxD);
    let links = 0;
    for (let oy = -1; oy <= 1 && links < 8; oy++) for (let ox = -1; ox <= 1 && links < 8; ox++) {
      const gx = cx + ox, gy = cy + oy;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      for (let j = head[gy * cols + gx]; j >= 0 && links < 8; j = next[j]) {
        if (j <= i) continue;
        const d = Math.hypot(st.x[j] * aspect - X, st.y[j] - Y);
        if (d >= maxD) continue;
        paths[Math.min(BUCKETS - 1, Math.floor((d / maxD) * BUCKETS))].push(i, j);
        links++;
      }
    }
  }
  ctx.strokeStyle = css;
  ctx.lineWidth = Math.max(0.5, (env.dpr || 1) * 0.8);
  for (let b = 0; b < BUCKETS; b++) {
    const list = paths[b];
    if (!list.length) continue;
    ctx.globalAlpha = Math.min(1, alpha * 0.7 * (1 - b / BUCKETS));
    ctx.beginPath();
    for (let k = 0; k < list.length; k += 2) {
      const i = list[k], j = list[k + 1];
      ctx.moveTo(st.x[i] * W, (1 - st.y[i]) * H); ctx.lineTo(st.x[j] * W, (1 - st.y[j]) * H);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
