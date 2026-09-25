/**
 * particle-sim.js — the particles layer: a small physics system over the
 * picture. Plain JS with no imports so the same file runs in the app
 * (play/overlay.ts imports it) and in web exports (play/exportHtml.ts inlines
 * it with its `export`s removed, wrapped in a closure).
 *
 * After the p5 particle system Shader Studio's author built: particles have a
 * velocity that steers toward a field direction, can gravitate or spiral
 * around an attractor and respawn when they reach it, and are born in a
 * spawn area. Coordinates are 0..1 across the picture with y up.
 *
 * Fields (where each particle wants to go):
 *   flow      the picture's brightness is a heading (turns × 360°)
 *   climb     uphill in brightness (toward light)
 *   descend   downhill (toward dark)
 *   noise     an evolving Perlin-style flow field, independent of the picture
 *   none      only the attractor (or nothing) moves them
 * On flat parts of the picture climb and descend have no direction: `flat`
 * says whether particles wander on the noise field or settle and collect
 * (they gather along edges and make patterns).
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

function colourAt(sample, sw, sh, x, y) {
  const px = Math.max(0, Math.min(sw - 1, Math.floor(x * sw))), py = Math.max(0, Math.min(sh - 1, Math.floor((1 - y) * sh)));
  const k = (py * sw + px) * 4;
  return 'rgb(' + sample[k] + ',' + sample[k + 1] + ',' + sample[k + 2] + ')';
}

// ── System ───────────────────────────────────────────────────────────────────

/** Fresh state for `count` particles. `rand` is injectable for tests. */
export function createParticles(count, rand = Math.random) {
  const n = Math.max(1, count | 0);
  const st = {
    count: n,
    x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n),
    age: new Float32Array(n), life: new Float32Array(n), r: new Float32Array(n),
    seed: rand() * 1000,
  };
  for (let i = 0; i < n; i++) { st.x[i] = rand(); st.y[i] = rand(); st.r[i] = rand(); st.age[i] = rand() * 10; st.life[i] = 0.6 + rand() * 0.8; }
  return st;
}

function spawn(st, i, p, env, rand) {
  const a = rand() * TAU;
  switch (p.spawn) {
    case 'edges': {
      const side = Math.floor(rand() * 4), t = rand();
      st.x[i] = side === 0 ? 0 : side === 1 ? 1 : t;
      st.y[i] = side === 2 ? 0 : side === 3 ? 1 : t;
      break;
    }
    case 'center': case 'null': {
      const c = p.spawn === 'null' && env.spawnPoint ? env.spawnPoint : { x: 0.5, y: 0.5 };
      const rad = Math.sqrt(rand()) * p.spawnRadius;
      st.x[i] = c.x + Math.cos(a) * rad * env.aspectInv;
      st.y[i] = c.y + Math.sin(a) * rad;
      break;
    }
    default:
      st.x[i] = rand(); st.y[i] = rand();
  }
  const s = p.speed * 0.05 * rand();
  st.vx[i] = Math.cos(a) * s; st.vy[i] = Math.sin(a) * s;
  st.age[i] = 0;
  st.life[i] = 0.6 + rand() * 0.8;
}

/**
 * Advance every particle by env.dt seconds.
 * p:   { speed, steer, field, turns, noiseScale, noiseEvolve, flat, attractor,
 *        force, strength, catchRadius, spawn, spawnRadius, edges, life }
 * env: { dt, time, aspect (W/H), sample, sw, sh, attractorPoint ({x,y}|null),
 *        spawnPoint ({x,y}|null) }
 */
export function stepParticles(st, p, env, rand = Math.random) {
  const dt = Math.min(0.1, Math.max(0, env.dt));
  const aspect = env.aspect || 1;
  env.aspectInv = 1 / aspect;
  const sample = env.sample, sw = env.sw, sh = env.sh;
  const maxV = p.speed * 0.18;                 // picture heights per second
  const steer = 1 - Math.exp(-dt * (0.5 + p.steer * 12)); // how quickly velocity turns toward the field
  const drag = Math.exp(-dt * 0.8);
  const nz = env.time * p.noiseEvolve;
  const ap = p.attractor !== 'none' ? env.attractorPoint : null;
  const eps = 1 / Math.max(sw || 64, 1);
  for (let i = 0; i < st.count; i++) {
    let x = st.x[i], y = st.y[i], vx = st.vx[i], vy = st.vy[i];
    // 1. Where the field wants to go (unit direction, or 0 to coast).
    let dx = 0, dy = 0, settle = false;
    const noiseDir = () => { const n = noise3(x * p.noiseScale * aspect, y * p.noiseScale, nz + st.seed); const a = n * TAU * 2; dx = Math.cos(a); dy = Math.sin(a); };
    if (p.field === 'noise') noiseDir();
    else if (sample && (p.field === 'flow' || p.field === 'climb' || p.field === 'descend')) {
      if (p.field === 'flow') {
        const a = brightnessAt(sample, sw, sh, x, y) * p.turns * TAU;
        dx = Math.cos(a); dy = Math.sin(a);
      } else {
        const gx = brightnessAt(sample, sw, sh, x + eps, y) - brightnessAt(sample, sw, sh, x - eps, y);
        const gy = brightnessAt(sample, sw, sh, x, y + eps) - brightnessAt(sample, sw, sh, x, y - eps);
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
    // 4. Move (x is scaled so a step is the same length in pixels both ways).
    x += (vx / aspect) * dt; y += vy * dt;
    st.age[i] += dt;
    // 5. Edges, lifetime, attractor catch.
    let respawn = caught || (p.life > 0 && st.age[i] > p.life * st.life[i]);
    const out = x < 0 || x > 1 || y < 0 || y > 1;
    if (out && !respawn) {
      if (p.edges === 'wrap') { x -= Math.floor(x); y -= Math.floor(y); }
      else if (p.edges === 'bounce') {
        if (x < 0) { x = -x; vx = -vx; } else if (x > 1) { x = 2 - x; vx = -vx; }
        if (y < 0) { y = -y; vy = -vy; } else if (y > 1) { y = 2 - y; vy = -vy; }
      } else respawn = true;
    }
    st.x[i] = x; st.y[i] = y; st.vx[i] = vx; st.vy[i] = vy;
    if (respawn) spawn(st, i, p, env, rand);
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
    case 'age': return p.life > 0 ? Math.min(1, st.age[i] / Math.max(1e-6, p.life * st.life[i])) : Math.min(1, st.age[i] / 10);
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
  const v = modulator(by, st, i, p, env);
  return Math.max(0, amount >= 0 ? 1 + amount * v : 1 + amount * v);
}

function star(ctx, r) {
  ctx.moveTo(0, -r);
  for (let k = 1; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
}

/**
 * Draw the particles into `ctx` (W × H px).
 *   p.shape   dot · square · triangle · streak (along its motion) · ring · star · image (env.sprite)
 *   p.rotate  heading (point where it goes) · spin · none
 *   p.colour  tint · picture (the pixel under it) · palette (by heading, speed, age or brightness)
 *   p.sizeBy / p.opacityBy with p.sizeAmount / p.opacityAmount: see modulator()
 * env.alpha is the layer opacity; per-particle opacity multiplies it.
 */
export function drawParticles(ctx, st, p, env) {
  const W = env.W, H = env.H, sample = env.sample, sw = env.sw, sh = env.sh;
  const dpr = env.dpr || 1, base = p.size * dpr, alpha = env.alpha == null ? 1 : env.alpha;
  const fixed = 'rgb(' + Math.round(p.color[0] * 255) + ',' + Math.round(p.color[1] * 255) + ',' + Math.round(p.color[2] * 255) + ')';
  const sprite = p.shape === 'image' ? env.sprite : null;
  const spriteRatio = sprite ? (sprite.naturalWidth || sprite.width) / Math.max(1, sprite.naturalHeight || sprite.height) : 1;
  for (let i = 0; i < st.count; i++) {
    const r = Math.max(0.3, base * (1 - p.sizeJitter * st.r[i]) * modScale(p.sizeBy, p.sizeAmount, st, i, p, env));
    const a = Math.min(1, alpha * modScale(p.opacityBy, p.opacityAmount, st, i, p, env));
    if (a <= 0.004 || r <= 0.3) continue;
    ctx.globalAlpha = a;
    if (p.colour === 'picture' && sample) ctx.fillStyle = colourAt(sample, sw, sh, st.x[i], st.y[i]);
    else if (p.colour === 'palette') {
      const t = p.paletteBy === 'speed' || p.paletteBy === 'age' || p.paletteBy === 'brightness' ? modulator(p.paletteBy, st, i, p, env) : Math.atan2(st.vy[i], st.vx[i]) / TAU + 0.5;
      const c = paletteColour(p.palette, t);
      ctx.fillStyle = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
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
        const h = r * 2, w = p.crop ? h : h * spriteRatio;
        if (p.crop) {
          const iw = sprite.naturalWidth || sprite.width, ih = sprite.naturalHeight || sprite.height, s = Math.min(iw, ih);
          ctx.drawImage(sprite, (iw - s) / 2, (ih - s) / 2, s, s, -w / 2, -h / 2, w, h);
        } else ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
        break;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.globalAlpha = 1;
}
