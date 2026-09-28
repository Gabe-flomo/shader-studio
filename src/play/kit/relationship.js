/**
 * relationship.js — a Relationship layer: a small force simulation between
 * existing layers (its members), run once a frame by the kit (kit.js), which
 * then drives the members' x and y like a null on a spring.
 *
 * Positions here are in picture heights, x scaled by the aspect (as bodies.js
 * does), so distances are round on any canvas; the kit converts on the way in
 * and out. Speeds are picture heights per second. Top-level names start with
 * `rl`. Nothing here touches the DOM (rlDraw takes a 2D context), so the
 * tests run it in Node.
 *
 * A member is { id, role, mass, base: { x, y } (0..1, y up), group: a nested
 * relationship's state, or null }. Roles: chaser, prey, member (the last for
 * repel and attract, where everyone is alike).
 *
 * Determinism: every random choice (a respawn point, a wander seed) comes from
 * `rand`, the kit's seeded source in a take or a render, and the wander walk
 * is a smooth noise of the clock, so the same seed and clock give the same
 * motion twice.
 */

/** Members a relationship holds at most: pairs are O(n²), and 24 stays cheap. */
export const RL_MAX_MEMBERS = 24;
/** Readings a relationship reports (`<id>::<read>`), all 0..1. */
export const RL_READS = ['gap', 'closing', 'chaseSpeed', 'sight', 'catch', 'sinceCatch', 'catches'];
/** A member's radius for walls and catches, in picture heights. */
const RL_RADIUS = 0.02;
/** Seconds since the last catch that read as 1 (`sinceCatch`), and catches that read as 1 (`catches`). */
const RL_SINCE_FULL = 10, RL_CATCHES_FULL = 20;

function rlHash(i, seed) { const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); }
/** Smooth value noise of t (0..1), the same for the same seed and t. */
export function rlNoise(t, seed) { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return rlHash(i, seed) + (rlHash(i + 1, seed) - rlHash(i, seed)) * u; }

/** Channels a member can read the picture in. `layer` is another layer's alpha (the kit hands over its grid). */
export const RL_CHANNELS = ['brightness', 'red', 'green', 'blue', 'hue', 'saturation', 'layer'];

/** One channel of an RGBA grid at cell (i), 0..1. */
function rlChannel(g, i, channel) {
  const r = g[i], gg = g[i + 1], b = g[i + 2];
  switch (channel) {
    case 'red': return r / 255;
    case 'green': return gg / 255;
    case 'blue': return b / 255;
    case 'layer': return g[i + 3] / 255;
    case 'hue': case 'saturation': {
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
      if (channel === 'saturation') return mx > 0 ? d / mx : 0;
      if (d === 0) return 0;
      let h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
      if (h < 0) h += 6;
      return h / 6;
    }
    default: return (r + gg + b) / 765;
  }
}

/** A channel of a coarse grid at (x, y), 0..1 with y up, bilinear (the edge clamps). */
export function rlPictureAt(grid, gw, gh, channel, x, y) {
  const fx = Math.max(0, Math.min(gw - 1, x * gw - 0.5)), fy = Math.max(0, Math.min(gh - 1, (1 - y) * gh - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const at = (cx, cy) => rlChannel(grid, (cy * gw + cx) * 4, channel);
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

/**
 * The picture around a point: the channel's value there (`v`), and its
 * gradient over a ring of 8 samples `radius` picture heights out (`gx`, `gy`
 * in body units: x scaled by the aspect, y up). A step from dark to bright
 * across the ring reads as a gradient of about 1 toward the bright side.
 */
export function rlPictureForce(grid, gw, gh, channel, x, y, radius, aspect) {
  const v = rlPictureAt(grid, gw, gh, channel, x, y);
  let gx = 0, gy = 0;
  const r = Math.max(0.005, radius);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
    const s = rlPictureAt(grid, gw, gh, channel, x + (cx * r) / aspect, y + cy * r);
    gx += (s - v) * cx; gy += (s - v) * cy;
  }
  return { v, gx: gx / 2, gy: gy / 2 };
}

/** A relationship's state: its members' bodies and what happened. */
export function rlCreate() {
  return { m: new Map(), order: [], catches: 0, lastCatchAt: -Infinity, catchPulse: 0, swaps: new Map(), reads: {}, cx: 0.5, cy: 0.5, cvx: 0, cvy: 0, lines: [] };
}

/** A member's role now: as set, unless a catch swapped it. */
function rlRole(st, mem) { return st.swaps.get(mem.id) || mem.role; }

/** A member's body, made where its layer stands when it joins (or after the layer was moved by hand). */
function rlBody(st, mem, aspect, rand) {
  let b = st.m.get(mem.id);
  if (!b) {
    b = { x: mem.base.x * aspect, y: mem.base.y, vx: 0, vy: 0, seed: Math.floor(rand() * 1000) + 1, bx: mem.base.x, by: mem.base.y, escaped: false, timer: 0, out: 0, armed: true, target: null };
    st.m.set(mem.id, b);
  } else if (b.bx !== mem.base.x || b.by !== mem.base.y) {
    // The layer itself was moved (dragged on the picture, or its x/y edited): the body goes there.
    b.x = mem.base.x * aspect; b.y = mem.base.y; b.vx = 0; b.vy = 0; b.bx = mem.base.x; b.by = mem.base.y; b.escaped = false; b.timer = 0;
  }
  return b;
}

/** Where a respawn puts a body: somewhere new, its layer's own place, or the side farthest from the chasers. */
function rlRespawn(b, where, aspect, rand, chasers) {
  b.vx = 0; b.vy = 0; b.escaped = false; b.timer = 0; b.armed = true;
  if (where === 'fixed') { b.x = b.bx * aspect; b.y = b.by; return; }
  if (where === 'far' && chasers.length) {
    let cx = 0, cy = 0;
    for (const c of chasers) { cx += c.x; cy += c.y; }
    cx /= chasers.length; cy /= chasers.length;
    // The corner-free far side: the edge point of the picture (inset a little) farthest from them.
    const inset = 0.1, cands = [[inset, cy], [aspect - inset, cy], [cx, inset], [cx, 1 - inset]];
    let best = null, bd = -1;
    for (const c of cands) { const d = Math.hypot(c[0] - cx, c[1] - cy); if (d > bd) { bd = d; best = c; } }
    b.x = best[0]; b.y = best[1];
    return;
  }
  b.x = (0.1 + 0.8 * rand()) * aspect; b.y = 0.1 + 0.8 * rand();
}

/** Steer a body toward a wanted velocity: turn at most `turn` radians and change speed at most `accel` this step. */
function rlSteer(b, wx, wy, accel, turn) {
  const want = Math.hypot(wx, wy), sp = Math.hypot(b.vx, b.vy);
  const wantAng = want > 1e-6 ? Math.atan2(wy, wx) : (sp > 1e-6 ? Math.atan2(b.vy, b.vx) : 0);
  let ang = sp > 1e-4 ? Math.atan2(b.vy, b.vx) : wantAng;
  let diff = wantAng - ang;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  ang += Math.max(-turn, Math.min(turn, diff));
  const nsp = sp + Math.max(-accel, Math.min(accel, want - sp));
  b.vx = Math.cos(ang) * nsp; b.vy = Math.sin(ang) * nsp;
}

/**
 * One frame. `l` is the layer, `v(key)` a setting now (a mapping may drive
 * it), `members` the resolved members (at most RL_MAX_MEMBERS are used), and
 * `rand` the kit's random source. Afterwards st.m holds where each member is,
 * st.reads its readings and st.lines the debug overlay's lines.
 */
export function rlStep(st, l, v, dt, time, aspect, members, rand) {
  const mems = members.slice(0, RL_MAX_MEMBERS);
  const ids = new Set(mems.map(m => m.id));
  for (const id of [...st.m.keys()]) if (!ids.has(id)) { st.m.delete(id); st.swaps.delete(id); }
  for (const id of [...st.swaps.keys()]) if (!ids.has(id)) st.swaps.delete(id);
  const bodies = mems.map(m => { const b = rlBody(st, m, aspect, rand); b.mem = m; b.role = rlRole(st, m); b.mass = Math.max(0.05, m.mass || 1); b.r = RL_RADIUS; return b; });
  // A nested relationship stands at its members' centroid; the parent moves it as one body.
  for (const b of bodies) if (b.mem.group && b.mem.group.m.size) { b.x = b.mem.group.cx * aspect; b.y = b.mem.group.cy; b.mass = Math.max(b.mass, b.mem.group.m.size); }
  st.order = bodies.map(b => b.mem.id);
  const kind = l.relation, n = bodies.length;
  const speed = Math.max(0, v('speed')), accel = Math.max(0, v('accel')), turnRate = 1 + Math.max(0, Math.min(1, v('turn'))) * 12;
  const sight = Math.max(0, v('sight')), flee = Math.max(0, v('flee')), wander = Math.max(0, v('wander'));
  const strength = Math.max(0, v('strength')), spring = Math.max(0, Math.min(1, v('springiness'))), bounce = Math.max(0, Math.min(1, v('bounciness'))), damping = Math.max(0, Math.min(1, v('damping')));
  const maxSpeed = Math.max(0.01, v('maxSpeed')), catchR = Math.max(0, v('catchRadius')), respawnDelay = Math.max(0, v('respawnDelay'));
  const k = 20 + spring * 220; // the soft contacts' stiffness
  const step = Math.min(0.05, Math.max(0, dt)), SUB = 2, h = step / SUB;
  st.catchPulse = Math.max(0, st.catchPulse - dt * 4);
  const lines = [];
  let inSight = 0;
  const chasers = bodies.filter(b => b.role === 'chaser'), prey = bodies.filter(b => b.role === 'prey');
  const active = b => !b.escaped;
  // The picture under each member (sampled once a frame from the kit's coarse grid): its value, and the
  // gradient to climb or descend along.
  for (const b of bodies) {
    const pic = b.mem.pic;
    b.pv = null; b.pgx = 0; b.pgy = 0;
    if (!pic || !pic.grid) continue;
    const f = rlPictureForce(pic.grid, pic.gw, pic.gh, pic.channel, b.x / aspect, b.y, pic.radius, aspect);
    b.pv = f.v;
    const sgn = pic.mode === 'climb' ? 1 : pic.mode === 'descend' ? -1 : 0;
    b.pgx = f.gx * sgn * pic.strength * 1.5; b.pgy = f.gy * sgn * pic.strength * 1.5;
  }
  for (let s = 0; s < SUB; s++) {
    for (const b of bodies) { b.ax = b.pgx / b.mass; b.ay = b.pgy / b.mass; b.target = null; }
    if (kind === 'chase') {
      for (const c of chasers) {
        if (c.escaped) continue;
        let best = null, bd = sight;
        for (const p of prey) { if (!active(p)) continue; const d = Math.hypot(p.x - c.x, p.y - c.y); if (d <= bd) { bd = d; best = p; } }
        c.target = best;
        if (best) {
          const d = Math.max(1e-6, bd), a = accel * h / c.mass;
          rlSteer(c, (best.x - c.x) / d * speed, (best.y - c.y) / d * speed, a, turnRate * h);
        } else {
          const ang = rlNoise(time * 0.35 + c.seed, c.seed) * Math.PI * 4;
          rlSteer(c, Math.cos(ang) * speed * 0.4 * wander, Math.sin(ang) * speed * 0.4 * wander, accel * 0.5 * h / c.mass, turnRate * 0.5 * h);
        }
      }
      for (const p of prey) {
        if (p.escaped) continue;
        let fx = 0, fy = 0, threat = 0;
        for (const c of chasers) {
          if (c.escaped) continue;
          const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
          if (d < flee && d > 1e-6) { const w = (flee - d) / flee; fx += dx / d * w; fy += dy / d * w; threat = Math.max(threat, w); }
        }
        if (threat > 0) {
          const m = Math.hypot(fx, fy) || 1;
          rlSteer(p, fx / m * speed, fy / m * speed, accel * h / p.mass, turnRate * h);
        } else {
          const ang = rlNoise(time * 0.3 + p.seed * 0.5, p.seed + 7) * Math.PI * 4;
          rlSteer(p, Math.cos(ang) * speed * 0.25 * wander, Math.sin(ang) * speed * 0.25 * wander, accel * 0.5 * h / p.mass, turnRate * 0.5 * h);
        }
      }
    } else if (kind === 'repel') {
      const R = Math.max(0.001, v('repelDistance')), inverse = l.repelCurve === 'inverse';
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = bodies[i], b = bodies[j];
        if (!active(a) || !active(b)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= R) continue;
        const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
        const f = strength * 2 * (inverse ? Math.min(6, (R / Math.max(d, 0.02)) * (R / Math.max(d, 0.02)) - 1) * 0.3 : 1 - d / R);
        a.ax -= nx * f / a.mass; a.ay -= ny * f / a.mass; b.ax += nx * f / b.mass; b.ay += ny * f / b.mass;
      }
    } else if (kind === 'attract') {
      const keep = l.attractMode === 'keep', minD = Math.max(0, v('minDistance')), falloff = Math.max(0, Math.min(1, v('falloff')));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = bodies[i], b = bodies[j];
        if (!active(a) || !active(b)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
        if (keep) {
          if (d > minD) {
            const f = strength * 1.5 * Math.min(1, (d - minD) / Math.max(0.05, minD));
            a.ax += nx * f; a.ay += ny * f; b.ax -= nx * f; b.ay -= ny * f;
          } else {
            // At the boundary: a soft spring apart, and the closing speed bounced off.
            const f = k * (minD - d);
            a.ax -= nx * f / a.mass; a.ay -= ny * f / a.mass; b.ax += nx * f / b.mass; b.ay += ny * f / b.mass;
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) { const imp = -(1 + bounce) * rv / 2; a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny; }
          }
        } else {
          // Gravity-like: they can pass through and orbit. falloff 0 pulls evenly, 1 as the inverse square.
          const g = strength * 0.12 * Math.pow(Math.max(d, 0.08), -(0.5 + 1.5 * falloff));
          a.ax += nx * g * b.mass; a.ay += ny * g * b.mass; b.ax -= nx * g * a.mass; b.ay -= ny * g * a.mass;
        }
      }
    }
    // Walls, by role: a soft boundary inside the edge pushes back before the edge is reached.
    for (const b of bodies) {
      const mode = rlWallOf(l, b.role);
      if (mode === 'repel' && !b.escaped) {
        const m = 0.1, kk = 6 + spring * 40;
        if (b.x < m) b.ax += kk * (m - b.x); if (b.x > aspect - m) b.ax -= kk * (b.x - (aspect - m));
        if (b.y < m) b.ay += kk * (m - b.y); if (b.y > 1 - m) b.ay -= kk * (b.y - (1 - m));
      }
    }
    // Integrate: damping, the speed cap, then the move.
    const decay = Math.exp(-damping * 2.5 * h);
    for (const b of bodies) {
      if (b.escaped) continue;
      b.vx = (b.vx + b.ax * h) * decay; b.vy = (b.vy + b.ay * h) * decay;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxSpeed) { b.vx *= maxSpeed / sp; b.vy *= maxSpeed / sp; }
      b.x += b.vx * h; b.y += b.vy * h;
    }
    // Edges.
    for (const b of bodies) {
      const mode = rlWallOf(l, b.role), r = b.r;
      const rest = Math.max(0.1, bounce);
      if (mode === 'bounce') {
        if (b.x < r) { b.x = r; if (b.vx < 0) b.vx = -b.vx * rest; } else if (b.x > aspect - r) { b.x = aspect - r; if (b.vx > 0) b.vx = -b.vx * rest; }
        if (b.y < r) { b.y = r; if (b.vy < 0) b.vy = -b.vy * rest; } else if (b.y > 1 - r) { b.y = 1 - r; if (b.vy > 0) b.vy = -b.vy * rest; }
      } else if (mode === 'wrap') {
        if (b.x < -r) { b.x += aspect + 2 * r; b.armed = true; } else if (b.x > aspect + r) { b.x -= aspect + 2 * r; b.armed = true; }
        if (b.y < -r) { b.y += 1 + 2 * r; b.armed = true; } else if (b.y > 1 + r) { b.y -= 1 + 2 * r; b.armed = true; }
      } else if (mode === 'respawn') {
        if (b.x < -r || b.x > aspect + r || b.y < -r || b.y > 1 + r) rlRespawn(b, l.respawnAt, aspect, rand, chasers.filter(c => c !== b && !c.escaped));
      } else if (mode === 'escape') {
        const out = b.x < -0.15 || b.x > aspect + 0.15 || b.y < -0.15 || b.y > 1.15;
        if (out && !b.escaped) { b.escaped = true; b.timer = respawnDelay; b.vx = 0; b.vy = 0; }
      } else if (mode === 'repel') {
        // The soft boundary usually holds; a body flung past it turns back.
        if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * rest; } else if (b.x > aspect - r) { b.x = aspect - r; b.vx = -Math.abs(b.vx) * rest; }
        if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) * rest; } else if (b.y > 1 - r) { b.y = 1 - r; b.vy = -Math.abs(b.vy) * rest; }
      }
    }
  }
  // Escaped bodies come back after the delay.
  for (const b of bodies) if (b.escaped) { b.timer -= dt; if (b.timer <= 0) rlRespawn(b, l.respawnAt, aspect, rand, chasers.filter(c => c !== b && !c.escaped)); }
  // Catches: a chaser within the catch radius of a prey it can see. One catch per approach.
  let caught = false;
  if (kind === 'chase') {
    for (const c of chasers) {
      if (c.escaped) continue;
      for (const p of prey) {
        if (p.escaped) continue;
        const d = Math.hypot(p.x - c.x, p.y - c.y), reach = catchR + c.r + p.r;
        if (d <= reach) {
          if (p.armed && c.armed) {
            caught = true; st.catches++; st.lastCatchAt = time; st.catchPulse = 1; p.armed = false;
            if (l.onCatch === 'respawn') rlRespawn(p, l.respawnAt, aspect, rand, chasers.filter(x => !x.escaped));
            else if (l.onCatch === 'swap') { st.swaps.set(c.mem.id, 'prey'); st.swaps.set(p.mem.id, 'chaser'); c.role = 'prey'; p.role = 'chaser'; }
          }
        } else if (d > reach * 2.5) p.armed = true;
      }
      if (c.target) { lines.push({ kind: 'target', x0: c.x / aspect, y0: c.y, x1: c.target.x / aspect, y1: c.target.y }); inSight = 1; }
    }
  }
  // The centroid (this relationship's anchor, and its place as a member of another) and its readings.
  let cx = 0, cy = 0, cvx = 0, cvy = 0, cn = 0;
  for (const b of bodies) if (!b.escaped) { cx += b.x; cy += b.y; cvx += b.vx; cvy += b.vy; cn++; }
  if (cn) { st.cx = cx / cn / aspect; st.cy = cy / cn; st.cvx = cvx / cn; st.cvy = cvy / cn; }
  st.lines = lines;
  st.reads = rlReadings(st, bodies, kind, chasers, prey, maxSpeed, inSight, time, aspect);
  st.reads.catch = caught ? 1 : st.catchPulse;
  return caught;
}

/** A role's wall behaviour on this layer. */
export function rlWallOf(l, role) {
  const w = role === 'chaser' ? l.wallChaser : role === 'prey' ? l.wallPrey : l.wallMember;
  return w || 'bounce';
}

/** The closest pair (chase: a chaser and a prey; else any two), and how fast they close. */
function rlReadings(st, bodies, kind, chasers, prey, maxSpeed, inSight, time, aspect) {
  let gap = Infinity, closing = 0, pair = null;
  const consider = (a, b) => {
    if (a.escaped || b.escaped) return;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < gap) { gap = d; pair = [a, b]; }
  };
  if (kind === 'chase') { for (const c of chasers) for (const p of prey) consider(c, p); }
  else for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) consider(bodies[i], bodies[j]);
  if (pair) {
    const [a, b] = pair, dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1e-6, gap);
    // Relative velocity along the line between them: positive when they close in.
    const rel = -((b.vx - a.vx) * dx + (b.vy - a.vy) * dy) / d;
    closing = Math.max(-1, Math.min(1, rel / Math.max(0.01, maxSpeed)));
  }
  let chaseSpeed = 0, cn = 0;
  const movers = kind === 'chase' ? chasers : bodies;
  for (const b of movers) if (!b.escaped) { chaseSpeed += Math.hypot(b.vx, b.vy); cn++; }
  return {
    gap: pair ? Math.min(1, gap) : 1,
    closing: (closing + 1) / 2,
    chaseSpeed: cn ? Math.min(1, chaseSpeed / cn / maxSpeed) : 0,
    sight: inSight,
    catch: 0,
    sinceCatch: st.lastCatchAt === -Infinity ? 1 : Math.min(1, Math.max(0, time - st.lastCatchAt) / RL_SINCE_FULL),
    catches: Math.min(1, st.catches / RL_CATCHES_FULL),
  };
}

/** The picture's value under a member this frame (0..1), or null without a picture to read. */
export function rlPictureOf(st, id) { const b = st.m.get(id); return b && typeof b.pv === 'number' ? b.pv : null; }

/** Where a member is now, 0..1 with y up (null when it isn't in the relationship). */
export function rlPlace(st, id, aspect) {
  const b = st.m.get(id);
  return b ? { x: b.x / aspect, y: b.y } : null;
}

/** Move every member by (dx, dy) in picture units (a parent relationship moved this one as a body). */
export function rlShift(st, dx, dy, aspect) {
  for (const b of st.m.values()) { b.x += dx * aspect; b.y += dy; }
  st.cx += dx; st.cy += dy;
}

/** Forget a member's swapped role and body (the kit's reset, or a member leaving). */
export function rlForget(st, id) { st.m.delete(id); st.swaps.delete(id); }

/**
 * The debug overlay while editing: sight and flee radii, lines from each
 * chaser to its target, and velocity arrows. Nothing else is ever drawn.
 */
export function rlDraw(ctx, st, l, v, W, H, dpr, aspect) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.9; ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = Math.max(1, dpr);
  const px = b => (b.x / aspect) * W, py = b => (1 - b.y) * H;
  for (const b of st.m.values()) {
    if (b.escaped) continue;
    const x = px(b), y = py(b);
    if (l.relation === 'chase') {
      const r = (b.role === 'chaser' ? v('sight') : v('flee')) * H;
      ctx.strokeStyle = b.role === 'chaser' ? 'rgba(255,120,80,0.45)' : 'rgba(90,200,255,0.45)';
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // The picture's pull on it (green), a fifth of a second of it.
    if (b.pgx || b.pgy) {
      const px2 = x + b.pgx / aspect * W * 0.2, py2 = y - b.pgy * H * 0.2;
      ctx.strokeStyle = 'rgba(120,230,120,0.9)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px2, py2); ctx.stroke();
    }
    // Velocity: an arrow a fifth of a second long.
    const ex = x + b.vx / aspect * W * 0.2, ey = y - b.vy * H * 0.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const ang = Math.atan2(ey - y, ex - x), ah = 5 * dpr;
    if (Math.hypot(ex - x, ey - y) > ah) { ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(ang - 0.5) * ah, ey - Math.sin(ang - 0.5) * ah); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(ang + 0.5) * ah, ey - Math.sin(ang + 0.5) * ah); ctx.stroke(); }
  }
  ctx.strokeStyle = 'rgba(255,120,80,0.9)';
  for (const ln of st.lines) { ctx.beginPath(); ctx.moveTo(ln.x0 * W, (1 - ln.y0) * H); ctx.lineTo(ln.x1 * W, (1 - ln.y1) * H); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
