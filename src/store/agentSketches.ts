/**
 * agentSketches.ts — the Agents group's rules written again as small Script
 * layers (plain JavaScript on the CPU), for pages that can't run the group
 * itself: the Present page's canvases and exported web pages run the web
 * player, which doesn't run Agents groups yet (docs/agents-plan.md, P5).
 *
 * Each sketch follows its preset's rule step for step and uses the nodes'
 * names and units (picture units: y −1…1 across the picture's height; one
 * step is 1/60 s), only with tens of thousands of walkers instead of a
 * million, and a trail a couple of hundred pixels tall. The "How Agents
 * work" presentation (present/samples.ts) runs them live.
 */

/** Slime mold (and Multi-species slime): Sense → Crowding → Steer (Jones) → Move → Deposit → spread and fade. */
export const SKETCH_AGENT_SLIME = `// Slime mold, the rule by hand: the Agents group's Slime mold preset as a
// small JavaScript copy that runs anywhere. The same rule, step for step:
//   Sense → Crowding → Steer (Jones) → Move → Deposit → the trail spreads and fades.
// Units are the nodes': picture units (the picture is 2 tall) and seconds,
// one step is 1/60 s. The trail here is 200 rows tall and there are tens of
// thousands of walkers, where the preset has 1024 rows and a million, so the
// settings differ a little: sensors reach further (in picture units), and
// Crowding's sat is 6 (the preset's is 60) because this trail holds less.
const params = {
  walkers:  { value: 30000, min: 2000, max: 80000, step: 1000, label: 'Walkers', restart: true },
  species:  { value: 1, min: 1, max: 3, step: 1, label: 'Species', restart: true },
  angle:    { value: 22.5, min: 5, max: 90, step: 0.5, label: 'Sensor angle (°)' },
  distance: { value: 0.09, min: 0.02, max: 0.3, step: 0.005, label: 'Sensor distance' },
  turn:     { value: 45, min: 0, max: 90, step: 1, label: 'Turn (°)' },
  jitter:   { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Jitter' },
  speed:    { value: 0.6, min: 0.1, max: 2, step: 0.05, label: 'Speed' },
  halfLife: { value: 0.05, min: 0.01, max: 0.5, step: 0.005, label: 'Half-life (s)' },
  diffuse:  { value: 1, min: 0, max: 1, step: 0.05, label: 'Diffuse' },
  deposit:  { value: 1, min: 0.1, max: 5, step: 0.1, label: 'Deposit amount' },
  sat:      { value: 6, min: 0, max: 100, step: 1, label: 'Crowding sat (0 = off)' },
  steps:    { value: 2, min: 1, max: 8, step: 1, label: 'Steps per frame' },
  sensors:  { value: 0, min: 0, max: 40, step: 1, label: 'Show the sensors of' },
  restart:  { kind: 'button', label: 'Start over' },
};

const ROWS = 200;              // the trail's height in pixels (the Trail field's Resolution)
const DT = 1 / 60;             // one step, in simulated seconds
const COLOURS = [[1.0, 0.72, 0.28], [0.25, 0.85, 0.8], [0.72, 0.5, 1.0]]; // coral-gold, teal, violet
let W = 0, H = 0, K = 1, n = 0, S = 1;
let px, py, ph, sp;           // each walker: position (trail pixels), heading, species
let trail, tmp;               // one Float32Array per species channel
let img = null, buf = null, bctx = null;

function setup(s) {
  const aspect = s.width / Math.max(1, s.height);
  H = ROWS; W = Math.max(8, Math.round(ROWS * aspect)); K = ROWS / 2; // K: trail pixels per picture unit
  n = s.params.walkers | 0; S = Math.max(1, Math.min(3, s.params.species | 0));
  px = new Float32Array(n); py = new Float32Array(n); ph = new Float32Array(n); sp = new Uint8Array(n);
  trail = []; for (let c = 0; c < S; c++) trail.push(new Float32Array(W * H));
  tmp = new Float32Array(W * H);
  // Emit (Fill, Whole picture, facing Random): every walker is born at once, anywhere.
  for (let i = 0; i < n; i++) {
    px[i] = Math.random() * W; py[i] = Math.random() * H;
    ph[i] = Math.random() * Math.PI * 2; sp[i] = i % S;
  }
  img = null; buf = null;
}

// The trail's channel c at a point, wrapping round the edges (Trail field: Edges Wrap).
function at(c, x, y) {
  let ix = Math.floor(x) % W, iy = Math.floor(y) % H;
  if (ix < 0) ix += W; if (iy < 0) iy += H;
  return trail[c][iy * W + ix];
}
// Sense's Channels: its own species' trail counts +1, the others' −0.5.
function smell(k, x, y) {
  if (S === 1) return at(0, x, y);
  let v = 0; for (let c = 0; c < S; c++) v += (c === k ? 1 : -0.5) * at(c, x, y);
  return v;
}

function step(p) {
  const a = p.angle * Math.PI / 180, t = p.turn * Math.PI / 180, d = p.distance * K;
  const v = p.speed * DT * K, sat = p.sat;
  const crowd = r => (sat > 0 ? r * Math.exp(-r / sat) : r);
  for (let i = 0; i < n; i++) {
    const x = px[i], y = py[i], h = ph[i], k = sp[i];
    // Sense: three points Distance ahead, Angle to the left, straight on, Angle to the right.
    const L = crowd(smell(k, x + d * Math.cos(h + a), y - d * Math.sin(h + a)));
    const C = crowd(smell(k, x + d * Math.cos(h), y - d * Math.sin(h)));
    const R = crowd(smell(k, x + d * Math.cos(h - a), y - d * Math.sin(h - a)));
    // Steer (Jones): straight on if the centre wins; a random side if both sides beat it;
    // else Turn toward the stronger side. Jitter adds a little random turn every step.
    let nh = h;
    if (C > L && C > R) { /* keep going */ }
    else if (C < L && C < R) nh += Math.random() < 0.5 ? -t : t;
    else if (L > R) nh += t;
    else if (R > L) nh -= t;
    nh += (Math.random() * 2 - 1) * p.jitter * t;
    // Move: one step along the heading at Speed, wrapping round the edges.
    let nx = x + v * Math.cos(nh), ny = y - v * Math.sin(nh);
    if (nx < 0) nx += W; else if (nx >= W) nx -= W;
    if (ny < 0) ny += H; else if (ny >= H) ny -= H;
    px[i] = nx; py[i] = ny; ph[i] = nh;
  }
  // Deposit: every walker adds Amount to the pixel it stands on, in its own species' channel.
  for (let i = 0; i < n; i++) trail[sp[i]][(py[i] | 0) * W + (px[i] | 0)] += p.deposit;
  // The trail spreads (Diffuse: toward the 3×3 average) and fades (Half-life), every step.
  const keep = Math.pow(2, -DT / p.halfLife), dif = p.diffuse;
  for (const tr of trail) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) tmp[row + x] = tr[row + (x + W - 1) % W] + tr[row + x] + tr[row + (x + 1) % W];
    }
    for (let y = 0; y < H; y++) {
      const up = ((y + H - 1) % H) * W, row = y * W, dn = ((y + 1) % H) * W;
      for (let x = 0; x < W; x++) {
        const mean = (tmp[up + x] + tmp[row + x] + tmp[dn + x]) / 9;
        tr[row + x] = (tr[row + x] + (mean - tr[row + x]) * dif) * keep;
      }
    }
  }
}

function draw(s) {
  const { ctx, width, height, params, pressed } = s;
  if (pressed('restart') || Math.abs(W / H - width / Math.max(1, height)) > 0.02) setup(s);
  for (let k = 0; k < params.steps; k++) step(params);
  // The picture: the Trail field's Amount (1 − e^(−trail × gain)) through a palette.
  if (!img) {
    img = ctx.createImageData(W, H);
    if (typeof OffscreenCanvas !== 'undefined') { buf = new OffscreenCanvas(W, H); bctx = buf.getContext('2d'); }
  }
  if (!img || !img.data || !bctx) return;
  const data = img.data, gain = 0.08;
  for (let j = 0; j < W * H; j++) {
    let r = 0, g = 0, b = 0;
    if (S === 1) {
      const v = 1 - Math.exp(-trail[0][j] * gain);
      r = Math.min(1, v * 1.6); g = Math.min(1, v * v * 1.25); b = v * v * v * 0.85; // black → amber → gold → pale
    } else {
      for (let c = 0; c < S; c++) {
        const v = 1 - Math.exp(-trail[c][j] * gain);
        r += COLOURS[c][0] * v; g += COLOURS[c][1] * v; b += COLOURS[c][2] * v;
      }
    }
    const o = j * 4;
    data[o] = Math.min(255, r * 255); data[o + 1] = Math.min(255, g * 255); data[o + 2] = Math.min(255, b * 255); data[o + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buf, 0, 0, width, height);
  // Show the sensors: a few walkers' three sensor points; the one that won is bright.
  const sx = width / W, sy = height / H, a = params.angle * Math.PI / 180, d = params.distance * K;
  ctx.lineWidth = Math.max(1, height * 0.0025);
  for (let i = 0; i < Math.min(params.sensors | 0, n); i++) {
    const x = px[i], y = py[i], h = ph[i], k = sp[i];
    const pts = [h + a, h, h - a].map(q => [x + d * Math.cos(q), y - d * Math.sin(q)]);
    const vals = pts.map(([qx, qy]) => smell(k, qx, qy));
    const best = vals.indexOf(Math.max(...vals));
    pts.forEach(([qx, qy], m) => {
      ctx.strokeStyle = m === best ? 'rgba(120, 230, 255, 0.95)' : 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath(); ctx.moveTo(x * sx, y * sy); ctx.lineTo(qx * sx, qy * sy); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(qx * sx, qy * sy, height * 0.006, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x * sx, y * sy, height * 0.008, 0, Math.PI * 2); ctx.fill();
  }
}
`;

/** Particles (and Sound burst): forces chained through Also, then Integrate and Age / Life. */
export const SKETCH_AGENT_PARTICLES = `// Particles, the rule by hand: the Agents group's Particles preset as a small
// JavaScript copy. Inside the group it is a chain of forces whose Also inputs
// add them up, then Integrate and Age / Life:
//   Gravity + Curl noise + Vortex + Attract (mouse) + Sound kick → Integrate → Age / Life
// Set a force to 0 to take its node out of the chain. Units are the nodes'
// (picture units, seconds); one step is 1/60 s.
const params = {
  count:    { value: 6000, min: 500, max: 20000, step: 500, label: 'Particles', restart: true },
  gravity:  { value: 0, min: -1.5, max: 1.5, step: 0.05, label: 'Gravity (down)' },
  curl:     { value: 0.4, min: 0, max: 2, step: 0.05, label: 'Curl strength' },
  curlSize: { value: 1, min: 0.3, max: 4, step: 0.1, label: 'Curl size' },
  evolve:   { value: 0.15, min: 0, max: 1, step: 0.05, label: 'Curl evolve' },
  vortex:   { value: 0.3, min: -1.5, max: 1.5, step: 0.05, label: 'Vortex' },
  attract:  { value: 0.8, min: -3, max: 3, step: 0.1, label: 'Attract (mouse)' },
  shock:    { value: 0, min: 0, max: 3, step: 0.05, label: 'Sound kick' },
  beat:     { value: 120, min: 30, max: 200, step: 1, label: 'Beat (a minute)' },
  drag:     { value: 1, min: 0, max: 6, step: 0.1, label: 'Drag' },
  maxSpeed: { value: 4, min: 0.2, max: 8, step: 0.1, label: 'Max speed' },
  life:     { value: 4, min: 0.5, max: 12, step: 0.1, label: 'Life (s)' },
  steps:    { value: 2, min: 1, max: 6, step: 1, label: 'Steps per frame' },
};

const DT = 1 / 60;
let n = 0, x, y, vx, vy, age, span, aspect = 1.78, simTime = 0;
const PALETTE = ['#fff6c8', '#ffe08a', '#ffc04a', '#ff9a2a', '#ff7417', '#f2520e', '#d6380a', '#b02208', '#861407', '#5c0b05'];

// Emit (Keep full, a ring, outward): the Particles node's defaults.
function born(i, p, first) {
  const a = Math.random() * Math.PI * 2;
  x[i] = Math.cos(a) * 0.4; y[i] = Math.sin(a) * 0.4;
  const out = a + (Math.random() - 0.5) * 0.4 * Math.PI;      // Spread 0.4
  const v = 0.08 * (1 + 0.45 * (Math.random() * 2 - 1));     // Speed 0.08 ± 45%
  vx[i] = Math.cos(out) * v; vy[i] = Math.sin(out) * v;
  span[i] = p.life * (1 + 0.5 * (Math.random() * 2 - 1));     // Life ± half
  age[i] = first ? Math.random() * span[i] : 0;               // Keep full: everyone at once, at a random age
}

function setup(s) {
  aspect = s.width / Math.max(1, s.height);
  n = s.params.count | 0; simTime = 0;
  x = new Float32Array(n); y = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
  age = new Float32Array(n); span = new Float32Array(n);
  for (let i = 0; i < n; i++) born(i, s.params, true);
}

// Smooth noise for the curl: a stream function whose sideways slope is the current.
function hash(ix, iy) { let h = (ix * 374761393 + iy * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function stream(px, py, f, t) {
  return vnoise(px * f + t, py * f - t * 0.7) + 0.5 * vnoise(px * f * 2.03 + 17.1 - t, py * f * 2.03 + 5.3);
}

function step(p, mouse) {
  const f = 2.4 * p.curlSize, t = simTime * p.evolve, e = 0.02 / f;
  // Sound kick (Shockwave): a ring of pressure leaves the middle on every beat.
  const beatLen = 60 / p.beat, since = simTime % beatLen, ringR = since * 1.4;
  for (let i = 0; i < n; i++) {
    age[i] += DT;
    if (age[i] >= span[i]) { born(i, p, false); continue; } // Age / Life: dead → Keep full gives it a new life
    const X = x[i], Y = y[i];
    // Each force adds to the one before it (their Also inputs): the order doesn't matter.
    let fx = 0, fy = -p.gravity;                                                   // Gravity
    if (p.curl) {                                                                  // Curl noise
      const dx = (stream(X + e, Y, f, t) - stream(X - e, Y, f, t)) / (2 * e);
      const dy = (stream(X, Y + e, f, t) - stream(X, Y - e, f, t)) / (2 * e);
      fx += dy / f * 1.5 * p.curl; fy -= dx / f * 1.5 * p.curl;
    }
    const r = Math.hypot(X, Y) + 1e-4;                                              // Vortex, strongest at Reach 0.5
    fx += p.vortex * -Y / r * (r / (0.25 + r * r)); fy += p.vortex * X / r * (r / (0.25 + r * r));
    if (mouse) {                                                                   // Attract / Repel, within Reach 0.35, with Swirl
      const mx = mouse.x - X, my = mouse.y - Y, mr = Math.hypot(mx, my) + 1e-4;
      const fall = Math.exp(-mr * mr / (0.35 * 0.35));
      const pull = p.attract * Math.min(mr / 0.0875, 1) * 3;
      fx += (pull * mx / mr + 0.6 * -my / mr) * fall; fy += (pull * my / mr + 0.6 * mx / mr) * fall;
    }
    if (p.shock) { const k = Math.exp(-Math.pow((r - ringR) / 0.08, 2)); fx += p.shock * 4 * k * X / r; fy += p.shock * 4 * k * Y / r; } // Sound kick
    // Integrate: velocity += force × dt, drag bleeds speed, Max speed caps it, position += velocity × dt.
    let nvx = (vx[i] + fx * DT) * Math.exp(-p.drag * DT), nvy = (vy[i] + fy * DT) * Math.exp(-p.drag * DT);
    const s2 = Math.hypot(nvx, nvy);
    if (s2 > p.maxSpeed) { nvx *= p.maxSpeed / s2; nvy *= p.maxSpeed / s2; }
    vx[i] = nvx; vy[i] = nvy; x[i] = X + nvx * DT; y[i] = Y + nvy * DT;
  }
  simTime += DT;
}

function draw(s) {
  const { ctx, width, height, params, mouse } = s;
  if (Math.abs(aspect - width / Math.max(1, height)) > 0.02) setup(s);
  const K = height / 2; // pixels per picture unit
  const m = mouse.over ? { x: mouse.x / K - aspect, y: 1 - mouse.y / K } : null;
  for (let k = 0; k < params.steps; k++) step(params, m);
  // Over: a dark background with a faint warm glow in the middle (the preset's Ember glow).
  const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, height * 0.8);
  g.addColorStop(0, '#1a0c06'); g.addColorStop(1, '#030203');
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  // Draw agents (Glow, colour by age along Ember, fading in and out): ten buckets of one colour each.
  ctx.globalCompositeOperation = 'lighter';
  const size = Math.max(1.5, height * 0.0045);
  for (let b = 0; b < PALETTE.length; b++) {
    ctx.fillStyle = PALETTE[b];
    for (let i = 0; i < n; i++) {
      const u = age[i] / span[i];
      if (Math.min(9, (u * 10) | 0) !== b) continue;
      ctx.globalAlpha = Math.min(1, u * 8, (1 - u) * 3) * 0.75;
      ctx.fillRect((x[i] + aspect) * K - size / 2, (1 - y[i]) * K - size / 2, size, size);
    }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
`;

/** Ants: per-walker Memory (carrying food), two smells, a nest, food and a rock (Move's Obstacle ƒ, the Trail's Block). */
export const SKETCH_AGENT_ANTS = `// Ants, the rule by hand: the Agents group's Ants preset as a small JavaScript
// copy. Each ant remembers one thing from step to step (Agent Output's Memory):
// is it carrying food? Searching ants follow the food smell and lay the home
// smell; carrying ants follow the home smell and lay the food smell, weaker
// the longer they have walked. The rock is Move's Obstacle ƒ (turn back) and
// the Trail's Block (no smell inside it). Roads form round the rock, then straighten.
const params = {
  ants:     { value: 4000, min: 500, max: 12000, step: 500, label: 'Ants', restart: true },
  angle:    { value: 35, min: 5, max: 90, step: 1, label: 'Sensor angle (°)' },
  distance: { value: 0.07, min: 0.02, max: 0.2, step: 0.005, label: 'Sensor distance' },
  turn:     { value: 25, min: 0, max: 90, step: 1, label: 'Turn (°)' },
  jitter:   { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Jitter' },
  speed:    { value: 0.45, min: 0.1, max: 1.5, step: 0.05, label: 'Speed' },
  halfLife: { value: 2, min: 0.2, max: 10, step: 0.1, label: 'Smell half-life (s)' },
  fade:     { value: 6, min: 1, max: 30, step: 0.5, label: 'Smell weakens over (s)' },
  rock:     { value: 0.4, min: 0, max: 0.7, step: 0.01, label: 'Rock size' },
  steps:    { value: 3, min: 1, max: 8, step: 1, label: 'Steps per frame' },
  restart:  { kind: 'button', label: 'Start over' },
};

const ROWS = 160, DT = 1 / 60;
let W = 0, H = 0, K = 1, aspect = 1.78, n = 0, home = 0;
let px, py, ph, carry, walked;       // each ant: place (picture units), heading, Memory (carrying, seconds walked)
let homeSmell, foodSmell, tmp, img = null, buf = null, bctx = null;
let NEST = [-1.2, 0], FOOD = [];

function setup(s) {
  aspect = s.width / Math.max(1, s.height);
  H = ROWS; W = Math.max(8, Math.round(ROWS * aspect)); K = ROWS / 2;
  NEST = [-aspect * 0.72, 0];
  FOOD = [[aspect * 0.7, 0.6], [aspect * 0.7, -0.6]];
  n = s.params.ants | 0; home = 0;
  px = new Float32Array(n); py = new Float32Array(n); ph = new Float32Array(n);
  carry = new Uint8Array(n); walked = new Float32Array(n);
  for (let i = 0; i < n; i++) { px[i] = NEST[0]; py[i] = NEST[1]; ph[i] = Math.random() * Math.PI * 2; }
  homeSmell = new Float32Array(W * H); foodSmell = new Float32Array(W * H); tmp = new Float32Array(W * H);
  img = null; buf = null;
}

const rockAt = (x, y, r) => r > 0 && Math.hypot(x, y) < r;
const cell = (x, y) => { const ix = Math.floor((x + aspect) * K), iy = Math.floor((1 - y) * K); return ix >= 0 && iy >= 0 && ix < W && iy < H ? iy * W + ix : -1; };
const read = (g, x, y) => { const j = cell(x, y); return j < 0 ? 0 : g[j]; };

function step(p) {
  const a = p.angle * Math.PI / 180, t = p.turn * Math.PI / 180, d = p.distance, v = p.speed * DT;
  for (let i = 0; i < n; i++) {
    // Age / Life with Emit's Keep full: an ant lost for 20 s is born again at the nest.
    if (walked[i] > 20) { px[i] = NEST[0]; py[i] = NEST[1]; ph[i] = Math.random() * Math.PI * 2; carry[i] = 0; walked[i] = 0; }
    const x = px[i], y = py[i], h = ph[i];
    // Which smell: searching ants follow food, carrying ants follow home (their Memory picks Sense's channel).
    const g = carry[i] ? homeSmell : foodSmell;
    const L = read(g, x + d * Math.cos(h + a), y + d * Math.sin(h + a));
    const C = read(g, x + d * Math.cos(h), y + d * Math.sin(h));
    const R = read(g, x + d * Math.cos(h - a), y + d * Math.sin(h - a));
    let nh = h;
    if (C > L && C > R) { /* keep going */ }
    else if (C < L && C < R) nh += Math.random() < 0.5 ? -t : t;
    else if (L > R) nh += t;
    else if (R > L) nh -= t;
    nh += (Math.random() * 2 - 1) * p.jitter * t;
    // A weak lean toward the nest when carrying (the preset's homing lean), so the first roads can start.
    if (carry[i]) { const want = Math.atan2(NEST[1] - y, NEST[0] - x); nh += 0.04 * Math.sin(want - nh); }
    // Move, with an Obstacle: an ant that would step into the rock or off the picture turns back instead.
    const nx = x + v * Math.cos(nh), ny = y + v * Math.sin(nh);
    if (rockAt(nx, ny, p.rock) || Math.abs(nx) > aspect || Math.abs(ny) > 1) { ph[i] = nh + Math.PI + (Math.random() - 0.5); continue; }
    px[i] = nx; py[i] = ny; ph[i] = nh; walked[i] += DT;
    // Memory: picking food up at a pile, putting it down at the nest. Either way: turn round, start counting again.
    if (!carry[i] && FOOD.some(f => Math.hypot(nx - f[0], ny - f[1]) < 0.1)) { carry[i] = 1; walked[i] = 0; ph[i] += Math.PI; }
    else if (carry[i] && Math.hypot(nx - NEST[0], ny - NEST[1]) < 0.12) { carry[i] = 0; walked[i] = 0; ph[i] += Math.PI; home++; }
    // Deposit (Agent Output's Deposit, per ant): its smell, weaker the longer it has walked from where it set out.
    const j = cell(nx, ny);
    if (j >= 0) (carry[i] ? foodSmell : homeSmell)[j] += Math.exp(-walked[i] / p.fade);
  }
  // The Trail: spread (a little) and fade (Half-life); Block wipes the smell inside the rock.
  const keep = Math.pow(2, -DT / p.halfLife);
  for (const g of [homeSmell, foodSmell]) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const j = y * W + x, l = x > 0 ? g[j - 1] : g[j], r = x < W - 1 ? g[j + 1] : g[j];
      const u = y > 0 ? g[j - W] : g[j], dn = y < H - 1 ? g[j + W] : g[j];
      tmp[j] = (g[j] * 0.6 + (l + r + u + dn) * 0.1) * keep;
    }
    for (let j = 0; j < W * H; j++) g[j] = tmp[j];
    if (p.rock > 0) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rockAt((x + 0.5) / K - aspect, 1 - (y + 0.5) / K, p.rock)) g[y * W + x] = 0;
  }
}

function draw(s) {
  const { ctx, width, height, params, pressed } = s;
  if (pressed('restart') || Math.abs(aspect - width / Math.max(1, height)) > 0.02) setup(s);
  for (let k = 0; k < params.steps; k++) step(params);
  if (!img) {
    img = ctx.createImageData(W, H);
    if (typeof OffscreenCanvas !== 'undefined') { buf = new OffscreenCanvas(W, H); bctx = buf.getContext('2d'); }
  }
  if (!img || !img.data || !bctx) return;
  // Ground, the home smell (blue) and the food smell (orange).
  const data = img.data;
  for (let j = 0; j < W * H; j++) {
    const hs = 1 - Math.exp(-homeSmell[j] * 0.012), fs = 1 - Math.exp(-foodSmell[j] * 0.012), o = j * 4;
    data[o] = 18 + 30 * hs + 220 * fs; data[o + 1] = 15 + 120 * hs + 110 * fs; data[o + 2] = 12 + 210 * hs + 20 * fs; data[o + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buf, 0, 0, width, height);
  const P = (x, y) => [(x + aspect) * height / 2, (1 - y) * height / 2];
  const disc = (x, y, r, c) => { const [cx, cy] = P(x, y); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, r * height / 2, 0, Math.PI * 2); ctx.fill(); };
  if (params.rock > 0) disc(0, 0, params.rock, '#4a443d');
  disc(NEST[0], NEST[1], 0.12, '#6b4a2b');
  for (const f of FOOD) disc(f[0], f[1], 0.1, '#7dd36b');
  // The ants: pale while searching, gold while carrying (Draw agents, Colour by Agent).
  const sz = Math.max(1.5, height * 0.004);
  for (const c of [0, 1]) {
    ctx.fillStyle = c ? '#ffd23f' : 'rgba(235, 235, 245, 0.75)';
    for (let i = 0; i < n; i++) if (carry[i] === c) { const [x, y] = P(px[i], py[i]); ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz); }
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'; ctx.font = (height * 0.035) + 'px sans-serif';
  ctx.fillText('Food brought home: ' + home, height * 0.03, height * 0.06);
}
`;
