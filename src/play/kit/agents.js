/**
 * agents.js — the Agents layer: N entities (a few hundred to a few thousand)
 * with a position, a velocity, a heading, an age, an energy and a group,
 * moved by a composable stack of rules (seek, flee, align, cohere, separate,
 * wander, orbit, gravity, springs, field, boundary, drag, max speed, catch).
 *
 * Stage 1 of a general simulation engine (docs/agents-layer.md). The kit
 * (kit.js) steps and draws it; the app, takes, offline renders and website
 * exports all run this same file.
 *
 * Units: positions are picture heights with x scaled by the aspect (x in
 * 0..aspect, y in 0..1, y up), so distances are round on any canvas; speeds
 * are picture heights per second.
 *
 * Determinism: the simulation advances in fixed steps of AG_STEP seconds of
 * simulated time (the frame's dt times Speed goes into an accumulator), and
 * every random choice comes from the layer's own seeded source in a fixed
 * order; wander is a hash noise of the agent's seed and the simulated clock.
 * So the same seed and the same frame times give the same frames twice, in
 * the editor, in a take's offline render and in a website export.
 *
 * Top-level names start with `ag` (the export inlines every kit file into one
 * scope). Nothing here touches the DOM except agDraw (which takes a 2D
 * context and makes its trail canvas), so the tests run the stepping in Node.
 */
import { seededRandom, noise3, paletteColour, gooCell, gooSplat, gooBlit } from '../particle-sim.js';
import { rlPictureForce } from './relationship.js';

/** Agents a layer holds at most (all groups together). */
export const AG_MAX = 5000;
/** Groups a layer can have. */
export const AG_GROUPS = 4;
/** The fixed simulation step, seconds of simulated time. */
export const AG_STEP = 1 / 60;
/** Fixed steps one frame may take at most: a stalled frame drops the rest rather than freezing the page. */
const AG_MAX_STEPS = 8;
/** gravity (all pairs): past this many agents only pairs within AG_FAR_PAIRS count, through the spatial hash. */
const AG_PAIRS_ALL = 1200, AG_FAR_PAIRS = 0.4;
/** Readings a layer reports (`<id>::<read>`), all 0..1. */
export const AG_READS = ['alive', 'speed', 'spread', 'centroidX', 'centroidY', 'group1', 'group2', 'group3', 'group4', 'catch', 'catches'];

const P = (key, label, min, max, value, hint, step) => ({ key, label, min, max, value, hint, ...(step ? { step } : {}) });
const W_HINT = 'How much this rule counts next to the others (their steering is added up, weighted).';

/**
 * Every rule type: its label, a one-line hint, the numbers it has (each a
 * mappable layer property `<ruleId>_<key>`), its modes, and whether it aims
 * at a target (a point, the pointer, another layer's elements, a group).
 */
export const AG_RULES = {
  seek: { label: 'Seek', hint: 'Steer toward a target: a point, the pointer, the nearest element of another layer, or the nearest agent of a group.', target: true,
    params: [P('weight', 'Weight', 0, 5, 1, W_HINT), P('speed', 'Speed', 0, 2, 0.5, 'How fast it wants to go toward the target, picture heights per second.'), P('radius', 'Reach', 0, 2, 0, 'Only targets closer than this (picture heights). 0: any distance.')] },
  flee: { label: 'Flee', hint: 'Steer away from a target within reach, harder the closer it is.', target: true,
    params: [P('weight', 'Weight', 0, 5, 1.5, W_HINT), P('speed', 'Speed', 0, 2, 0.6, 'How fast it wants to run, picture heights per second.'), P('radius', 'Reach', 0, 2, 0.25, 'Runs from targets closer than this. 0: any distance.')] },
  align: { label: 'Align', hint: 'Match the heading and speed of neighbours within the radius (boids).', neighbours: true,
    params: [P('weight', 'Weight', 0, 5, 1, W_HINT), P('radius', 'Radius', 0.005, 0.5, 0.08, 'Neighbours closer than this count.')] },
  cohere: { label: 'Cohere', hint: 'Steer toward the centre of neighbours within the radius (boids).', neighbours: true,
    params: [P('weight', 'Weight', 0, 5, 0.6, W_HINT), P('radius', 'Radius', 0.005, 0.5, 0.1, 'Neighbours closer than this count.')] },
  separate: { label: 'Separate', hint: 'Push away from neighbours closer than the radius, harder the closer (boids).', neighbours: true,
    params: [P('weight', 'Weight', 0, 5, 1.5, W_HINT), P('radius', 'Radius', 0.002, 0.3, 0.035, 'Neighbours closer than this push apart.')] },
  wander: { label: 'Wander', hint: 'A slow random walk (seeded noise, the same every run).',
    params: [P('weight', 'Weight', 0, 5, 0.6, W_HINT), P('rate', 'Rate', 0, 5, 1, 'How quickly the wandering direction changes.')] },
  orbit: { label: 'Orbit', hint: 'Circle a target at a distance: a point, the pointer, another layer (its nearest element), or a group’s centre.', target: true, modes: ['ccw', 'cw'],
    params: [P('weight', 'Weight', 0, 5, 1, W_HINT), P('radius', 'Distance', 0.01, 1, 0.25, 'The orbit’s radius, picture heights.'), P('speed', 'Speed', 0, 2, 0.4, 'Speed along the orbit, picture heights per second.')] },
  gravity: { label: 'Gravity', hint: 'Pairs: every agent pulls every other (n-body, softened). Point: everyone falls toward a target.', target: true, modes: ['pairs', 'point'],
    params: [P('weight', 'Strength', 0, 5, 1, 'How hard the pull is.'), P('soft', 'Softening', 0.001, 0.3, 0.04, 'Keeps close passes from flinging agents off: the pull stops growing inside about this distance.'), P('radius', 'Reach', 0, 2, 0, 'Pairs: only agents closer than this pull (0: all of them; over 1200 agents, within 0.4).')] },
  springs: { label: 'Springs', hint: 'Join agents with springs: each to its nearest few, in a ring, or in a grid (as they were placed). Rest length is the length they were built at.', modes: ['nearest', 'ring', 'grid'],
    params: [P('weight', 'Stiffness', 0, 200, 30, 'How hard a stretched or squashed spring pulls back.'), P('damp', 'Damping', 0, 10, 1.5, 'How quickly a spring stops wobbling.'), P('rest', 'Rest', 0.1, 3, 1, 'Rest length as a multiple of the built length: under 1 pulls the net tight, over 1 puffs it out.'), P('radius', 'Link within', 0.005, 0.5, 0.1, 'Nearest: links only to agents closer than this when the net is built.'), P('anchor', 'Anchor', 0, 50, 0, 'A pull back to where each agent was when the net was built: 0 lets the net drift and fold; higher keeps its shape like a jelly.')] },
  field: { label: 'Field', hint: 'Follow a vector field: curl noise, a vortex round a target, a uniform wind, or the picture (climb toward bright, descend toward dark).', target: true, modes: ['curl', 'vortex', 'uniform', 'climb', 'descend'],
    params: [P('weight', 'Weight', 0, 5, 1, W_HINT), P('speed', 'Speed', 0, 2, 0.3, 'How fast the field carries them, picture heights per second.'), P('scale', 'Swirl size', 0.2, 12, 3, 'Curl noise: how many swirls fit across the picture.'), P('evolve', 'Evolve', 0, 2, 0.15, 'Curl noise: how fast the field changes.'), P('angle', 'Direction', -180, 180, 0, 'Uniform: the wind’s direction, degrees (0 is right, 90 up).', 1), P('look', 'Looks', 0.01, 0.4, 0.05, 'Climb and descend: how far around it samples the picture.')] },
  boundary: { label: 'Boundary', hint: 'What happens at the edge of the picture (or a shape): wrap round, bounce, die, or steer away before reaching it.', target: true, modes: ['wrap', 'bounce', 'kill', 'steer'],
    params: [P('weight', 'Weight', 0, 10, 2, 'Steer: how hard it turns them back. Bounce: how much speed a bounce keeps (0..1).'), P('margin', 'Margin', 0, 0.4, 0.08, 'Steer: they start turning this far inside the edge.')] },
  drag: { label: 'Drag', hint: 'Slow everything down, like moving through water.',
    params: [P('weight', 'Drag', 0, 10, 0.5, 'How much speed is lost per second.')] },
  maxSpeed: { label: 'Max speed', hint: 'Cap each agent’s speed (and, optionally, keep it above a minimum so a flock never stalls).',
    params: [P('weight', 'Max', 0.01, 3, 0.45, 'Top speed, picture heights per second.'), P('min', 'Min', 0, 2, 0, 'Lowest speed: slower agents are nudged along their heading.')] },
  catch: { label: 'Catch', hint: 'Agents of this group catch agents of the target group within the radius: the caught die and the catcher gains energy.', neighbours: true,
    params: [P('radius', 'Radius', 0.002, 0.3, 0.025, 'How close a catch is.'), P('gain', 'Energy gain', 0, 2, 0.5, 'Energy a catcher gains per catch (energy starts at 1).')] },
};
export const AG_RULE_TYPES = Object.keys(AG_RULES);
/** Where a rule aims. */
export const AG_TARGETS = ['point', 'pointer', 'layer', 'group'];
/** Channels the field rule reads the picture in. */
export const AG_CHANNELS = ['brightness', 'red', 'green', 'blue', 'hue', 'saturation'];

/** A rule's number now: its property if set, else the type's default. */
function agNum(v, rule, key) {
  const x = v(rule.id + '_' + key);
  if (typeof x === 'number' && isFinite(x)) return x;
  const d = AG_RULES[rule.type] && AG_RULES[rule.type].params.find(p => p.key === key);
  return d ? d.value : 0;
}

// ── Noise ────────────────────────────────────────────────────────────────────

function agHash(i, seed) { const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); }
/** Smooth value noise of t, 0..1, the same for the same seed and t. */
export function agNoise(t, seed) { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return agHash(i, seed) + (agHash(i + 1, seed) - agHash(i, seed)) * u; }

// ── Spatial hash ─────────────────────────────────────────────────────────────
//
// A uniform grid over the area (w × h), rebuilt every step by a counting
// sort: `start[c]..start[c+1]` in `items` are the agents in cell c. Points
// outside the area land in the edge cells. A query gathers every agent in
// the cells the circle touches and keeps those within the radius.

/** Build (or rebuild into `hs`) the hash of the first `n` points of xs/ys (alive[i] = 0 are left out). */
export function agHashBuild(hs, xs, ys, alive, n, cell, w, h) {
  const size = Math.max(cell, Math.max(w, h) / 256, 1e-4);
  const cols = Math.max(1, Math.ceil(w / size)), rows = Math.max(1, Math.ceil(h / size));
  const nc = cols * rows;
  if (!hs.start || hs.start.length < nc + 1) hs.start = new Int32Array(nc + 1);
  if (!hs.items || hs.items.length < n) { hs.items = new Int32Array(Math.max(n, 16)); hs.cellOf = new Int32Array(Math.max(n, 16)); }
  const start = hs.start, items = hs.items, cellOf = hs.cellOf;
  start.fill(0, 0, nc + 1);
  for (let i = 0; i < n; i++) {
    if (alive && !alive[i]) { cellOf[i] = -1; continue; }
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(xs[i] / size))), cy = Math.min(rows - 1, Math.max(0, Math.floor(ys[i] / size)));
    const c = cy * cols + cx;
    cellOf[i] = c; start[c + 1]++;
  }
  for (let c = 0; c < nc; c++) start[c + 1] += start[c];
  // Fill in index order (a stable sort), so queries list neighbours in a fixed order.
  const fill = hs.fill && hs.fill.length >= nc ? hs.fill : (hs.fill = new Int32Array(nc));
  for (let c = 0; c < nc; c++) fill[c] = start[c];
  for (let i = 0; i < n; i++) { const c = cellOf[i]; if (c >= 0) items[fill[c]++] = i; }
  hs.size = size; hs.cols = cols; hs.rows = rows; hs.xs = xs; hs.ys = ys; hs.n = n;
  return hs;
}

/** The agents within `r` of (x, y) into `out` (an Int32Array), and how many (at most out.length). The point itself counts if it is one. */
export function agHashQuery(hs, x, y, r, out) {
  const size = hs.size, cols = hs.cols, rows = hs.rows, xs = hs.xs, ys = hs.ys, start = hs.start, items = hs.items;
  const x0 = Math.max(0, Math.floor((x - r) / size)), x1 = Math.min(cols - 1, Math.floor((x + r) / size));
  const y0 = Math.max(0, Math.floor((y - r) / size)), y1 = Math.min(rows - 1, Math.floor((y + r) / size));
  const r2 = r * r, cap = out.length;
  let k = 0;
  // Points outside the area sit in the edge cells: a query reaching past the edge still looks there.
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const c = cy * cols + cx;
    for (let s = start[c], e = start[c + 1]; s < e; s++) {
      const j = items[s], dx = xs[j] - x, dy = ys[j] - y;
      if (dx * dx + dy * dy <= r2) { if (k < cap) out[k++] = j; else return k; }
    }
  }
  return k;
}

// ── State ────────────────────────────────────────────────────────────────────

/** A layer's group counts (only the first `groups`), clamped so the total stays within AG_MAX. */
export function agCounts(l) {
  const g = Math.max(1, Math.min(AG_GROUPS, Math.round(l.groups || 1)));
  const out = [];
  let left = AG_MAX;
  for (let k = 1; k <= AG_GROUPS; k++) {
    const c = k <= g ? Math.max(0, Math.min(left, Math.round(l['g' + k + '_count'] || 0))) : 0;
    out.push(c); left -= c;
  }
  return out;
}

/** A fresh, empty state; agStep fills it on its first frame. */
export function agCreate() {
  return { key: '', n: 0, acc: 0, simTime: 0, steps: 0, aspect: 1, rand: null, links: new Map(), hs: {}, buf: new Int32Array(256), reads: {}, catches: 0, catchPulse: 0, respawn: [0, 0, 0, 0], counts: [0, 0, 0, 0], frozen: false };
}

/** Where a new agent goes (spawn mode), in body units. `k` of `n` places a grid or a ring in order. */
function agSpawnAt(st, l, k, n, aspect, rand, forRespawn) {
  const mode = forRespawn && (l.spawn === 'grid' || l.spawn === 'ring') ? 'random' : l.spawn;
  const R = Math.max(0, Math.min(0.5, l.spawnRadius));
  const cx = aspect / 2, cy = 0.5;
  switch (mode) {
    case 'centre': { const a = rand() * Math.PI * 2, r = R * Math.sqrt(rand()); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }
    case 'ring': { const a = (k / Math.max(1, n)) * Math.PI * 2; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; }
    case 'grid': {
      const cols = agGridCols(n, aspect), rows = Math.max(1, Math.ceil(n / cols));
      const i = k % cols, j = Math.floor(k / cols), w = 2 * R * aspect, h = 2 * R;
      return [cx - w / 2 + (cols > 1 ? (i / (cols - 1)) * w : w / 2), cy - h / 2 + (rows > 1 ? (j / (rows - 1)) * h : h / 2)];
    }
    case 'edges': { const s = rand(), t = rand(); return s < 0.25 ? [0.02, t] : s < 0.5 ? [aspect - 0.02, t] : s < 0.75 ? [t * aspect, 0.02] : [t * aspect, 0.98]; }
    default: return [(0.05 + 0.9 * rand()) * aspect, 0.05 + 0.9 * rand()];
  }
}
/** A spawn grid's columns: about square cells over the picture's shape. */
function agGridCols(n, aspect) { return Math.max(1, Math.round(Math.sqrt(n * aspect))); }

/** (Re)build every agent: counts, groups, places, starting speed. Everything random comes from `rand` in order. */
function agBuild(st, l, v, aspect, rand) {
  const counts = agCounts(l), n = counts.reduce((a, b) => a + b, 0);
  st.n = n; st.counts = counts;
  st.x = new Float64Array(n); st.y = new Float64Array(n); st.vx = new Float64Array(n); st.vy = new Float64Array(n);
  st.ax = new Float64Array(n); st.ay = new Float64Array(n);
  st.age = new Float64Array(n); st.energy = new Float64Array(n); st.heading = new Float64Array(n); st.seed = new Float64Array(n);
  st.group = new Uint8Array(n); st.alive = new Uint8Array(n);
  st.rand = rand; st.acc = 0; st.simTime = 0; st.steps = 0; st.aspect = aspect;
  st.links = new Map(); st.catches = 0; st.catchPulse = 0; st.respawn = [0, 0, 0, 0];
  const v0 = Math.max(0, v('startSpeed')), spin = v('spin') || 0;
  let i = 0;
  for (let g = 0; g < AG_GROUPS; g++) for (let c = 0; c < counts[g]; c++, i++) {
    const p = agSpawnAt(st, l, i, n, aspect, rand, false);
    const a = rand() * Math.PI * 2, s = v0 * (0.5 + 0.5 * rand());
    st.x[i] = p[0]; st.y[i] = p[1]; st.vx[i] = Math.cos(a) * s; st.vy[i] = Math.sin(a) * s;
    // Spin: turning round the picture's centre at `spin` radians per second (a disc that doesn't just fall in).
    if (spin) { st.vx[i] -= (p[1] - 0.5) * spin; st.vy[i] += (p[0] - aspect / 2) * spin; }
    st.heading[i] = Math.atan2(st.vy[i], st.vx[i]);
    st.group[i] = g + 1; st.alive[i] = 1; st.energy[i] = 1; st.seed[i] = Math.floor(rand() * 100000) / 100 + 1;
  }
  if (st.buf.length < Math.min(AG_MAX, n) + 1) st.buf = new Int32Array(Math.min(AG_MAX, n) + 1);
}

/** What rebuilds a layer when it changes: the groups and counts, where they start, the seed. */
function agKey(l) { return [agCounts(l).join(','), l.spawn, l.spawnRadius, l.seed, l.spin, l.startSpeed].join('|'); }

/** Start over (a Reset action, or the key changed): the next agStep rebuilds. */
export function agReset(st) { st.key = ''; }

/** Throw every agent in a random direction (a Scatter action), `amount` picture heights per second. */
export function agScatter(st, amount) {
  if (!st.n || !st.rand) return;
  for (let i = 0; i < st.n; i++) { if (!st.alive[i]) continue; const a = st.rand() * Math.PI * 2, s = amount * (0.5 + 0.5 * st.rand()); st.vx[i] += Math.cos(a) * s; st.vy[i] += Math.sin(a) * s; }
}

// ── Rules ────────────────────────────────────────────────────────────────────

/** Does rule r apply to an agent of group g? (group 0: everyone.) */
const agApplies = (r, g) => !r.group || r.group === g;
/** Does an agent of group gj count as a neighbour or target for an agent of group gi under rule r? (0 any, -1 own group, -2 other groups.) */
function agCounts2(r, gi, gj) { const t = r.targetGroup || 0; return t === 0 || (t === -1 ? gi === gj : t === -2 ? gi !== gj : t === gj); }

/**
 * The rules this frame, with their numbers read once: only enabled ones of
 * a known type, in order. `info` resolves targets (see agStep).
 */
function agPrepare(st, l, v, info, aspect) {
  const out = [];
  for (const r of l.rules || []) {
    if (!r || r.on === false || !AG_RULES[r.type]) continue;
    const q = { id: r.id, type: r.type, group: r.group | 0, targetGroup: r.targetGroup | 0, mode: r.mode || (AG_RULES[r.type].modes ? AG_RULES[r.type].modes[0] : ''), target: r.target || 'point', targetId: r.targetId || '', channel: r.channel || 'brightness', k: Math.max(1, Math.min(8, Math.round(r.k || 3))) };
    for (const p of AG_RULES[r.type].params) q[p.key] = agNum(v, r, p.key);
    // A fixed point (x, y in 0..1, y up), the pointer, or another layer's elements.
    q.point = null; q.elems = null; q.zone = null; q.live = true;
    const tx = v(r.id + '_x'), ty = v(r.id + '_y');
    if (AG_RULES[r.type].target) {
      if (q.target === 'pointer') { if (info.pointer && info.pointer.over) q.point = [info.pointer.x * aspect, info.pointer.y]; else q.live = r.type === 'boundary' || r.type === 'gravity' && q.mode === 'pairs' || r.type === 'field' && q.mode !== 'vortex'; }
      else if (q.target === 'layer') {
        if (r.type === 'boundary') q.zone = info.zone ? info.zone(q.targetId) : null;
        else {
          const els = info.elements ? info.elements(q.targetId) : null;
          if (els && els.length) { q.elems = els.map(e => [e.x * aspect, e.y]); let sx = 0, sy = 0; for (const e of q.elems) { sx += e[0]; sy += e[1]; } q.point = [sx / q.elems.length, sy / q.elems.length]; }
          else q.live = r.type === 'gravity' && q.mode === 'pairs' || r.type === 'field' && q.mode !== 'vortex';
        }
      } else if (q.target === 'group') q.point = null; // resolved per step (a centroid, or the nearest agent)
      else q.point = [(typeof tx === 'number' && isFinite(tx) ? tx : 0.5) * aspect, typeof ty === 'number' && isFinite(ty) ? ty : 0.5];
    }
    if (r.type === 'field' && (q.mode === 'climb' || q.mode === 'descend')) q.pic = info.picture || null;
    if (q.live) out.push(q);
  }
  return out;
}

/** A group's centroid of live agents (0: everyone), or null. */
function agCentroid(st, g) {
  let sx = 0, sy = 0, c = 0;
  for (let i = 0; i < st.n; i++) if (st.alive[i] && (!g || st.group[i] === g)) { sx += st.x[i]; sy += st.y[i]; c++; }
  return c ? [sx / c, sy / c] : null;
}

/** The nearest live agent to i of the rule's target group within `r` (0: any distance), or -1. */
function agNearestAgent(st, q, i, r) {
  const gi = st.group[i];
  let best = -1, bd = Infinity;
  if (r > 0 && st.hashed) {
    const k = agHashQuery(st.hs, st.x[i], st.y[i], r, st.buf);
    for (let s = 0; s < k; s++) { const j = st.buf[s]; if (j === i || !agCounts2(q, gi, st.group[j])) continue; const d = (st.x[j] - st.x[i]) ** 2 + (st.y[j] - st.y[i]) ** 2; if (d < bd) { bd = d; best = j; } }
    return best;
  }
  const r2 = r > 0 ? r * r : Infinity;
  for (let j = 0; j < st.n; j++) { if (j === i || !st.alive[j] || !agCounts2(q, gi, st.group[j])) continue; const d = (st.x[j] - st.x[i]) ** 2 + (st.y[j] - st.y[i]) ** 2; if (d < bd && d <= r2) { bd = d; best = j; } }
  return best;
}

/** The target point for agent i under rule q (x, y in body units), or null (none in reach). */
function agTargetOf(st, q, i, near) {
  if (q.target === 'group') {
    if (near) { const j = agNearestAgent(st, q, i, q.radius || 0); return j >= 0 ? [st.x[j], st.y[j]] : null; }
    return q.centroid;
  }
  if (q.elems && near) {
    let best = null, bd = Infinity;
    for (const e of q.elems) { const d = (e[0] - st.x[i]) ** 2 + (e[1] - st.y[i]) ** 2; if (d < bd) { bd = d; best = e; } }
    return best;
  }
  return q.point;
}

/** Springs: the links of one rule, built from where the agents are now (rest length = the length now). */
function agLinks(st, q, aspect) {
  const key = [q.mode, q.k, q.group, q.mode === 'nearest' ? q.radius : 0, st.n, st.buildId].join('|');
  let L = st.links.get(q.id);
  if (L && L.key === key) return L;
  const a = [], b = [];
  const ids = [];
  for (let i = 0; i < st.n; i++) if (agApplies(q, st.group[i])) ids.push(i);
  if (q.mode === 'ring') {
    // Each group round its own ring.
    for (let s = 0; s < ids.length; s++) { const i = ids[s], j = ids[(s + 1) % ids.length]; if (i !== j && st.group[i] === st.group[j]) { a.push(i); b.push(j); } }
  } else if (q.mode === 'grid') {
    const cols = agGridCols(st.n, aspect);
    for (const i of ids) {
      if ((i % cols) + 1 < cols && i + 1 < st.n && agApplies(q, st.group[i + 1])) { a.push(i); b.push(i + 1); }
      if (i + cols < st.n && agApplies(q, st.group[i + cols])) { a.push(i); b.push(i + cols); }
      // Diagonals, so the net resists shearing instead of folding flat.
      if ((i % cols) + 1 < cols && i + cols + 1 < st.n && agApplies(q, st.group[i + cols + 1])) { a.push(i); b.push(i + cols + 1); }
      if (i % cols > 0 && i + cols - 1 < st.n && agApplies(q, st.group[i + cols - 1])) { a.push(i); b.push(i + cols - 1); }
    }
  } else {
    // Nearest k within the radius (each pair once).
    const seen = new Set(), r = Math.max(0.005, q.radius), hs = agHashBuild({}, st.x, st.y, st.alive, st.n, r, aspect, 1);
    const buf = new Int32Array(Math.max(16, Math.min(st.n, 512)));
    for (const i of ids) {
      const k = agHashQuery(hs, st.x[i], st.y[i], r, buf);
      const near = [];
      for (let s = 0; s < k; s++) { const j = buf[s]; if (j !== i && agApplies(q, st.group[j])) near.push([j, (st.x[j] - st.x[i]) ** 2 + (st.y[j] - st.y[i]) ** 2]); }
      near.sort((p, u) => p[1] - u[1] || p[0] - u[0]);
      for (let s = 0; s < Math.min(q.k, near.length); s++) {
        const j = near[s][0], lo = Math.min(i, j), hi = Math.max(i, j), id = lo * AG_MAX + hi;
        if (!seen.has(id)) { seen.add(id); a.push(lo); b.push(hi); }
      }
    }
  }
  const rest = new Float64Array(a.length);
  for (let s = 0; s < a.length; s++) rest[s] = Math.hypot(st.x[b[s]] - st.x[a[s]], st.y[b[s]] - st.y[a[s]]);
  L = { key, a: Int32Array.from(a), b: Int32Array.from(b), rest, hx: Float64Array.from(st.x), hy: Float64Array.from(st.y) };
  st.links.set(q.id, L);
  return L;
}

/** The curl of a noise potential at (x, y): a divergence-free swirl, normalised. */
function agCurl(x, y, t, scale) {
  const e = 0.02 / Math.max(0.2, scale), sx = x * scale, sy = y * scale;
  const n = (px, py) => noise3(px, py, t);
  const dx = (n(sx + e * scale, sy) - n(sx - e * scale, sy)) / (2 * e), dy = (n(sx, sy + e * scale) - n(sx, sy - e * scale)) / (2 * e);
  const cx = dy, cy = -dx, m = Math.hypot(cx, cy);
  return m > 1e-9 ? [cx / m, cy / m] : [0, 0];
}

/** One substep of `h` seconds: every rule's steering, then the move, then the edges, catches, energy and respawns. */
function agSubstep(st, rules, h, aspect, info) {
  const n = st.n, x = st.x, y = st.y, vx = st.vx, vy = st.vy, ax = st.ax, ay = st.ay, alive = st.alive, group = st.group;
  // The hash, at the widest neighbour radius any rule needs this step.
  let cell = 0;
  for (const q of rules) {
    if (AG_RULES[q.type].neighbours) cell = Math.max(cell, q.radius);
    else if ((q.type === 'seek' || q.type === 'flee') && q.target === 'group' && q.radius > 0) cell = Math.max(cell, q.radius);
    else if (q.type === 'gravity' && q.mode === 'pairs' && (q.radius > 0 || n > AG_PAIRS_ALL)) cell = Math.max(cell, q.radius > 0 ? q.radius : AG_FAR_PAIRS);
  }
  st.hashed = cell > 0;
  if (st.hashed) agHashBuild(st.hs, x, y, alive, n, cell, aspect, 1);
  for (const q of rules) if (q.target === 'group') q.centroid = agCentroid(st, q.targetGroup > 0 ? q.targetGroup : 0);
  ax.fill(0); ay.fill(0);
  const buf = st.buf;
  let drag = new Float64Array(0), maxS = null;
  for (const q of rules) {
    const w = q.weight;
    switch (q.type) {
      case 'seek': case 'flee': {
        const near = q.target === 'group' || !!q.elems;
        const flee = q.type === 'flee';
        for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i])) continue;
          const t = agTargetOf(st, q, i, near);
          if (!t) continue;
          const dx = t[0] - x[i], dy = t[1] - y[i], d = Math.hypot(dx, dy);
          if (d < 1e-6 || (q.radius > 0 && d > q.radius)) continue;
          // Steering toward the wanted velocity (Reynolds), weighted; fleeing counts more the closer the target is.
          const f = flee ? (q.radius > 0 ? 1 - d / q.radius : 1) : 1, s = flee ? -q.speed : q.speed;
          ax[i] += ((dx / d) * s - vx[i]) * w * 2 * f;
          ay[i] += ((dy / d) * s - vy[i]) * w * 2 * f;
        }
        break;
      }
      case 'align': case 'cohere': case 'separate': {
        if (!st.hashed) break;
        const r = q.radius;
        for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i])) continue;
          const k = agHashQuery(st.hs, x[i], y[i], r, buf), gi = group[i];
          let sx = 0, sy = 0, c = 0;
          for (let s = 0; s < k; s++) {
            const j = buf[s];
            if (j === i || !agCounts2(q, gi, group[j])) continue;
            if (q.type === 'align') { sx += vx[j]; sy += vy[j]; c++; }
            else if (q.type === 'cohere') { sx += x[j]; sy += y[j]; c++; }
            else {
              const dx = x[i] - x[j], dy = y[i] - y[j], d = Math.hypot(dx, dy);
              if (d < 1e-9) { const a = st.seed[i] * 7.1; sx += Math.cos(a); sy += Math.sin(a); c++; continue; }
              const f = 1 - d / r;
              sx += (dx / d) * f; sy += (dy / d) * f; c++;
            }
          }
          if (!c) continue;
          if (q.type === 'align') { ax[i] += (sx / c - vx[i]) * w * 1.5; ay[i] += (sy / c - vy[i]) * w * 1.5; }
          else if (q.type === 'cohere') { ax[i] += ((sx / c - x[i]) / r) * w * 0.8; ay[i] += ((sy / c - y[i]) / r) * w * 0.8; }
          else { ax[i] += sx * w * 2; ay[i] += sy * w * 2; }
        }
        break;
      }
      case 'wander': {
        const t = st.simTime * Math.max(0, q.rate);
        for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i])) continue;
          const a = agNoise(t + st.seed[i], st.seed[i]) * Math.PI * 4;
          ax[i] += Math.cos(a) * w * 0.9; ay[i] += Math.sin(a) * w * 0.9;
        }
        break;
      }
      case 'orbit': {
        const dir = q.mode === 'cw' ? -1 : 1, near = !!q.elems;
        for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i])) continue;
          const c = agTargetOf(st, q, i, near);
          if (!c) continue;
          const rx = x[i] - c[0], ry = y[i] - c[1], d = Math.max(1e-4, Math.hypot(rx, ry));
          const tx = (-ry / d) * dir, ty = (rx / d) * dir, pull = (q.radius - d) * 3;
          const wx = tx * q.speed + (rx / d) * pull, wy = ty * q.speed + (ry / d) * pull;
          ax[i] += (wx - vx[i]) * w * 2; ay[i] += (wy - vy[i]) * w * 2;
        }
        break;
      }
      case 'gravity': {
        const s2 = q.soft * q.soft;
        if (q.mode === 'point') {
          const near = !!q.elems;
          for (let i = 0; i < n; i++) {
            if (!alive[i] || !agApplies(q, group[i])) continue;
            const c = agTargetOf(st, q, i, near);
            if (!c) continue;
            const dx = c[0] - x[i], dy = c[1] - y[i], d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1e-6, g = w * 0.05 / (d2 + s2);
            ax[i] += (dx / d) * g; ay[i] += (dy / d) * g;
          }
          break;
        }
        // Pairs: G scaled by the count so the pull doesn't grow with it.
        let live = 0;
        for (let i = 0; i < n; i++) if (alive[i]) live++;
        const G = (w * 0.25) / Math.max(1, live), far = q.radius > 0 ? q.radius : n > AG_PAIRS_ALL ? AG_FAR_PAIRS : 0;
        for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i])) continue;
          const gi = group[i];
          const pull = j => {
            if (j === i || !agCounts2(q, gi, group[j])) return;
            const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy, inv = 1 / Math.sqrt(d2 + s2);
            const g = G * inv * inv * inv;
            ax[i] += dx * g; ay[i] += dy * g;
          };
          if (far > 0) { const k = agHashQuery(st.hs, x[i], y[i], far, buf); for (let s = 0; s < k; s++) pull(buf[s]); }
          else for (let j = 0; j < n; j++) if (alive[j]) pull(j);
        }
        break;
      }
      case 'springs': {
        const L = agLinks(st, q, aspect), rest = Math.max(0.1, q.rest), k = w, c = q.damp;
        for (let s = 0; s < L.a.length; s++) {
          const i = L.a[s], j = L.b[s];
          if (!alive[i] || !alive[j]) continue;
          const dx = x[j] - x[i], dy = y[j] - y[i], d = Math.hypot(dx, dy);
          if (d < 1e-9) continue;
          const ux = dx / d, uy = dy / d, rel = (vx[j] - vx[i]) * ux + (vy[j] - vy[i]) * uy;
          const f = k * (d - L.rest[s] * rest) + c * rel;
          ax[i] += ux * f; ay[i] += uy * f; ax[j] -= ux * f; ay[j] -= uy * f;
        }
        if (q.anchor > 0) for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i]) || i >= L.hx.length) continue;
          ax[i] += (L.hx[i] - x[i]) * q.anchor - vx[i] * Math.sqrt(q.anchor) * 0.5; ay[i] += (L.hy[i] - y[i]) * q.anchor - vy[i] * Math.sqrt(q.anchor) * 0.5;
        }
        break;
      }
      case 'field': {
        const t = st.simTime * q.evolve, ang = (q.angle * Math.PI) / 180, ux = Math.cos(ang), uy = Math.sin(ang);
        const pic = q.pic, sgn = q.mode === 'climb' ? 1 : -1;
        for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i])) continue;
          if (q.mode === 'climb' || q.mode === 'descend') {
            if (!pic) continue;
            const f = rlPictureForce(pic.s, pic.w, pic.h, q.channel, x[i] / aspect, y[i], q.look, aspect);
            ax[i] += f.gx * sgn * w * 4; ay[i] += f.gy * sgn * w * 4;
            continue;
          }
          let fx = ux, fy = uy;
          if (q.mode === 'curl') { const c = agCurl(x[i], y[i], t, q.scale); fx = c[0]; fy = c[1]; }
          else if (q.mode === 'vortex') {
            const c = agTargetOf(st, q, i, false);
            if (!c) continue;
            const rx = x[i] - c[0], ry = y[i] - c[1], d = Math.hypot(rx, ry);
            if (d < 1e-5) continue;
            fx = -ry / d; fy = rx / d;
          }
          ax[i] += (fx * q.speed - vx[i]) * w * 1.5; ay[i] += (fy * q.speed - vy[i]) * w * 1.5;
        }
        break;
      }
      case 'boundary': {
        if (q.mode !== 'steer') break;
        const m = Math.max(1e-3, q.margin), k = w * 3;
        for (let i = 0; i < n; i++) {
          if (!alive[i] || !agApplies(q, group[i])) continue;
          if (q.zone) {
            const d = q.zone.dist(x[i] / aspect, y[i]);
            if (d > -m) { const nn = agNormal(q.zone, x[i] / aspect, y[i], aspect); const f = k * Math.min(3, (d + m) / m); ax[i] -= nn[0] * f; ay[i] -= nn[1] * f; }
            continue;
          }
          if (x[i] < m) ax[i] += k * (m - x[i]) / m; else if (x[i] > aspect - m) ax[i] -= k * (x[i] - (aspect - m)) / m;
          if (y[i] < m) ay[i] += k * (m - y[i]) / m; else if (y[i] > 1 - m) ay[i] -= k * (y[i] - (1 - m)) / m;
        }
        break;
      }
      case 'drag': {
        if (drag.length !== n) drag = new Float64Array(n);
        for (let i = 0; i < n; i++) if (agApplies(q, group[i])) drag[i] += Math.max(0, w);
        break;
      }
      case 'maxSpeed': if (!maxS) maxS = []; maxS.push(q); break;
      default: break;
    }
  }
  // Integrate (semi-implicit Euler): speed first, then the move with the new speed.
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    vx[i] += ax[i] * h; vy[i] += ay[i] * h;
    if (drag.length) { const f = Math.exp(-drag[i] * h); vx[i] *= f; vy[i] *= f; }
    if (maxS) for (const q of maxS) {
      if (!agApplies(q, group[i])) continue;
      const s = Math.hypot(vx[i], vy[i]), hi = Math.max(0.001, q.weight), lo = Math.min(hi, Math.max(0, q.min));
      if (s > hi) { vx[i] *= hi / s; vy[i] *= hi / s; }
      else if (lo > 0 && s < lo) {
        const a = s > 1e-6 ? Math.atan2(vy[i], vx[i]) : st.heading[i];
        vx[i] = Math.cos(a) * lo; vy[i] = Math.sin(a) * lo;
      }
    }
    x[i] += vx[i] * h; y[i] += vy[i] * h;
    if (vx[i] * vx[i] + vy[i] * vy[i] > 1e-10) st.heading[i] = Math.atan2(vy[i], vx[i]);
    st.age[i] += h;
  }
  // Edges: position rules after the move.
  for (const q of rules) {
    if (q.type !== 'boundary' || q.mode === 'steer') continue;
    const keep = Math.max(0, Math.min(1, q.weight));
    for (let i = 0; i < n; i++) {
      if (!alive[i] || !agApplies(q, group[i])) continue;
      if (q.zone) {
        const d = q.zone.dist(x[i] / aspect, y[i]);
        if (d <= 0) continue;
        if (q.mode === 'kill') { agKill(st, i); continue; }
        const nn = agNormal(q.zone, x[i] / aspect, y[i], aspect);
        x[i] -= nn[0] * (d + 1e-3); y[i] -= nn[1] * (d + 1e-3);
        const vn = vx[i] * nn[0] + vy[i] * nn[1];
        if (vn > 0) { vx[i] -= (1 + (q.mode === 'bounce' ? keep : 0)) * vn * nn[0]; vy[i] -= (1 + (q.mode === 'bounce' ? keep : 0)) * vn * nn[1]; }
        continue;
      }
      if (q.mode === 'wrap') {
        if (x[i] < 0) x[i] += aspect; else if (x[i] >= aspect) x[i] -= aspect;
        if (y[i] < 0) y[i] += 1; else if (y[i] >= 1) y[i] -= 1;
      } else if (q.mode === 'bounce') {
        if (x[i] < 0) { x[i] = -x[i]; vx[i] = Math.abs(vx[i]) * keep; } else if (x[i] > aspect) { x[i] = 2 * aspect - x[i]; vx[i] = -Math.abs(vx[i]) * keep; }
        if (y[i] < 0) { y[i] = -y[i]; vy[i] = Math.abs(vy[i]) * keep; } else if (y[i] > 1) { y[i] = 2 - y[i]; vy[i] = -Math.abs(vy[i]) * keep; }
      } else if (q.mode === 'kill') {
        if (x[i] < -0.02 || x[i] > aspect + 0.02 || y[i] < -0.02 || y[i] > 1.02) agKill(st, i);
      }
    }
  }
  // Catches: each catcher takes the nearest live agent of the target group in reach, one per step, in index order.
  for (const q of rules) {
    if (q.type !== 'catch') continue;
    if (st.hashed) agHashBuild(st.hs, x, y, alive, n, Math.max(q.radius, st.hs.size || 0), aspect, 1);
    for (let i = 0; i < n; i++) {
      if (!alive[i] || !agApplies(q, group[i])) continue;
      const j = agNearestAgent(st, q, i, q.radius);
      if (j < 0 || !alive[j]) continue;
      agKill(st, j);
      st.energy[i] = Math.min(3, st.energy[i] + q.gain);
      st.catches++; st.catchPulse = 1;
    }
  }
  // Energy: a group with a drain loses it every second and dies at 0. Respawns bring the dead back at a rate per group.
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const drain = info.drain[group[i] - 1];
    if (drain > 0) { st.energy[i] -= drain * h; if (st.energy[i] <= 0) agKill(st, i); }
  }
  for (let g = 0; g < AG_GROUPS; g++) {
    const rate = info.respawn[g];
    if (!(rate > 0) || !st.counts[g]) { st.respawn[g] = 0; continue; }
    st.respawn[g] += rate * h;
    let first = 0;
    for (let k = 0; k < g; k++) first += st.counts[k];
    for (let i = first; i < first + st.counts[g] && st.respawn[g] >= 1; i++) {
      if (alive[i]) continue;
      agRevive(st, info.layer, i, aspect);
      st.respawn[g] -= 1;
    }
    st.respawn[g] = Math.min(st.respawn[g], 1);
  }
  st.simTime += h;
}

/** The outward normal of a zone at (x, y) (0..1, y up), in body units. */
function agNormal(z, x, y, aspect) {
  if (z.normal) { const nn = z.normal(x, y); return [nn[0], nn[1]]; }
  const e = 0.002, gx = z.dist(x + e / aspect, y) - z.dist(x - e / aspect, y), gy = z.dist(x, y + e) - z.dist(x, y - e), m = Math.hypot(gx, gy) || 1;
  return [gx / m, gy / m];
}

function agKill(st, i) { st.alive[i] = 0; st.vx[i] = 0; st.vy[i] = 0; }
function agRevive(st, l, i, aspect) {
  const p = agSpawnAt(st, l, i, st.n, aspect, st.rand, true), a = st.rand() * Math.PI * 2, s = 0.1 * st.rand();
  st.x[i] = p[0]; st.y[i] = p[1]; st.vx[i] = Math.cos(a) * s; st.vy[i] = Math.sin(a) * s; st.heading[i] = a;
  st.alive[i] = 1; st.age[i] = 0; st.energy[i] = 1;
}

/**
 * One frame. `l` is the layer, `v(key)` a setting now (mappings may drive
 * it), `dt` the frame's step in seconds, `rand` the random source to build
 * with (the layer's own seed, or the kit's session source), and `info`:
 *   pointer   { x, y, over } 0..1 with y up
 *   elements(layerId)  another layer's elements [{ x, y }] (0..1, y up), or null
 *   zone(layerId)      a shape's zone ({ dist(x, y) }, negative inside), or null
 *   picture   { s, w, h } the kit's coarse RGBA grid, or null
 * Takes as many fixed steps as the accumulated time allows (at most
 * AG_MAX_STEPS). Afterwards st.reads holds the readings.
 */
export function agStep(st, l, v, dt, aspect, rand, info) {
  const key = agKey(l);
  if (st.key !== key) { st.key = key; st.buildId = (st.buildId || 0) + 1; agBuild(st, l, v, aspect, rand); }
  // The picture changed shape: keep everyone where they were on it.
  if (Math.abs(st.aspect - aspect) > 1e-9) { const s = aspect / st.aspect; for (let i = 0; i < st.n; i++) { st.x[i] *= s; } st.aspect = aspect; }
  const inf = info || {};
  const full = { pointer: inf.pointer || null, elements: inf.elements || null, zone: inf.zone || null, picture: inf.picture || null, layer: l, drain: [], respawn: [] };
  for (let g = 1; g <= AG_GROUPS; g++) { full.drain.push(Math.max(0, v('g' + g + '_drain') || 0)); full.respawn.push(Math.max(0, v('g' + g + '_respawn') || 0)); }
  const rules = agPrepare(st, l, v, full, aspect);
  st.catchPulse = Math.max(0, st.catchPulse - Math.max(0, dt) * 4);
  st.frameDt = dt;
  if (!st.frozen) {
    st.acc += Math.max(0, dt) * Math.max(0, v('speed'));
    const subs = Math.max(1, Math.min(4, Math.round(v('substeps') || 1)));
    let steps = 0;
    while (st.acc >= AG_STEP && steps < AG_MAX_STEPS) {
      for (let s = 0; s < subs; s++) agSubstep(st, rules, AG_STEP / subs, aspect, full);
      st.acc -= AG_STEP; st.steps++; steps++;
    }
    if (steps >= AG_MAX_STEPS) st.acc = Math.min(st.acc, AG_STEP);
  }
  st.reads = agReadings(st, aspect, rules);
  return st;
}

/** The readings (all 0..1): alive share, mean speed (1 at the max speed rule's cap, else 1 ph/s), spread, centroid, per-group shares, catches. */
function agReadings(st, aspect, rules) {
  let n = 0, sp = 0, mx = 0, my = 0, mxx = 0, myy = 0;
  const per = [0, 0, 0, 0];
  for (let i = 0; i < st.n; i++) {
    if (!st.alive[i]) continue;
    n++; per[st.group[i] - 1]++;
    sp += Math.hypot(st.vx[i], st.vy[i]);
    mx += st.x[i]; my += st.y[i]; mxx += st.x[i] * st.x[i]; myy += st.y[i] * st.y[i];
  }
  const cap = rules.find(q => q.type === 'maxSpeed');
  const top = cap ? Math.max(0.01, cap.weight) : 1;
  const out = {
    alive: st.n ? n / st.n : 0,
    speed: n ? Math.min(1, sp / n / top) : 0,
    spread: 0, centroidX: NaN, centroidY: NaN,
    group1: st.counts[0] ? per[0] / st.counts[0] : 0, group2: st.counts[1] ? per[1] / st.counts[1] : 0,
    group3: st.counts[2] ? per[2] / st.counts[2] : 0, group4: st.counts[3] ? per[3] / st.counts[3] : 0,
    catch: st.catchPulse, catches: Math.min(1, st.catches / 20), count: n,
  };
  if (n) {
    mx /= n; my /= n;
    out.centroidX = mx / aspect; out.centroidY = my;
    out.spread = Math.min(1, Math.sqrt(Math.max(0, mxx / n - mx * mx + myy / n - my * my)) / (0.29 * Math.hypot(aspect, 1)));
  }
  return out;
}

/** The live agents as elements other layers can follow: [{ i, x, y (0..1, y up), vx, vy, age, energy, group }]. */
export function agElements(st, aspect) {
  const out = [];
  if (!st || !st.n) return out;
  const a = st.aspect || aspect;
  for (let i = 0; i < st.n; i++) if (st.alive[i]) out.push({ i, x: st.x[i] / a, y: st.y[i], vx: st.vx[i] / a, vy: st.vy[i], age: st.age[i], energy: st.energy[i], group: st.group[i] });
  return out;
}

/** Agent i (by its number, 0 first) as an element, or null while it is dead or there is no such agent. */
export function agElement(st, i) {
  if (!st || !st.n || i < 0 || i >= st.n || !st.alive[i]) return null;
  return { x: st.x[i] / st.aspect, y: st.y[i] };
}

// ── Drawing ─────────────────────────────────────────────────────────────────

const AG_BUCKETS = 16;
const agCss = c => 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';

/** Agent i's colour as 0..1 numbers: its group's, or the palette along speed, age, energy or heading. */
function agColour(st, i, l, v, cols) {
  if (l.colourBy === 'group' || !l.colourBy) return cols[st.group[i] - 1];
  return paletteColour(l.palette, agColourT(st, i, l, v));
}
function agColourT(st, i, l, v) {
  switch (l.colourBy) {
    case 'speed': return Math.min(1, Math.hypot(st.vx[i], st.vy[i]) / Math.max(0.01, v('colourSpan')));
    case 'age': return Math.min(1, st.age[i] / Math.max(0.01, v('colourSpan') * 10));
    case 'energy': return Math.min(1, st.energy[i] / 2);
    default: return st.heading[i] / (Math.PI * 2) + 0.5;
  }
}

/**
 * Draw the agents onto `ctx` (W × H device pixels): dots, sprites
 * (triangles along the heading) or goo, optional links (the springs, or
 * neighbours within a radius), with the layer's opacity and blend, and a
 * trail when Trail is above 0 (kept on the state's own canvas).
 */
export function agDraw(ctx, st, l, v, W, H, dpr, aspect, blend) {
  if (!st.n) return;
  const opacity = Math.max(0, Math.min(1, v('opacity'))), trail = Math.max(0, Math.min(1, v('trail')));
  let c = ctx;
  if (trail > 0) {
    if (!st.trail) st.trail = document.createElement('canvas');
    if (st.trail.width !== W || st.trail.height !== H) { st.trail.width = W; st.trail.height = H; }
    c = st.trail.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    // Fade by time, not frames, so trails are the same length at 60 and 120 Hz.
    const per60 = Math.max(0.02, 1 - Math.pow(trail, 0.6)), a = 1 - Math.pow(1 - per60, Math.max(0.25, (st.frameDt || 1 / 60) * 60));
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,' + a + ')'; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
  } else {
    c.globalAlpha = opacity; c.globalCompositeOperation = blend || 'source-over';
  }
  agPaint(c, st, l, v, W, H, dpr, aspect);
  if (trail > 0) {
    ctx.globalAlpha = opacity; ctx.globalCompositeOperation = blend || 'source-over';
    ctx.drawImage(st.trail, 0, 0);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

function agPaint(c, st, l, v, W, H, dpr, aspect) {
  const n = st.n, a = st.aspect || aspect;
  const px = i => (st.x[i] / a) * W, py = i => (1 - st.y[i]) * H;
  const cols = [];
  for (let g = 1; g <= AG_GROUPS; g++) { const col = l['g' + g + '_color']; cols.push(Array.isArray(col) ? col : [1, 1, 1]); }
  const size = g => Math.max(0.3, (v('g' + g + '_size') || 3) * dpr);
  // Links under the agents.
  if (l.links && l.links !== 'off') {
    c.lineWidth = Math.max(0.5, v('linkWidth') * dpr);
    const la = Math.max(0, Math.min(1, v('linkOpacity')));
    c.strokeStyle = agCss(l.linkColor || [1, 1, 1]);
    const base = c.globalAlpha;
    if (l.links === 'springs') {
      c.globalAlpha = base * la;
      c.beginPath();
      for (const L of st.links.values()) for (let s = 0; s < L.a.length; s++) { const i = L.a[s], j = L.b[s]; if (!st.alive[i] || !st.alive[j]) continue; c.moveTo(px(i), py(i)); c.lineTo(px(j), py(j)); }
      c.stroke();
    } else {
      // Neighbours within the radius, fading with distance (four bands, each one path), at most 6 per agent.
      const r = Math.max(0.005, v('linkRadius')), hs = {}, buf = new Int32Array(64);
      agHashBuild(hs, st.x, st.y, st.alive, n, r, a, 1);
      const bands = [[], [], [], []];
      for (let i = 0; i < n; i++) {
        if (!st.alive[i]) continue;
        const k = agHashQuery(hs, st.x[i], st.y[i], r, buf);
        let made = 0;
        for (let s = 0; s < k && made < 6; s++) {
          const j = buf[s];
          if (j <= i) continue;
          const d = Math.hypot(st.x[j] - st.x[i], st.y[j] - st.y[i]), b = Math.min(3, Math.floor((d / r) * 4));
          bands[b].push(i, j); made++;
        }
      }
      for (let b = 0; b < 4; b++) {
        if (!bands[b].length) continue;
        c.globalAlpha = base * la * (1 - b / 4);
        c.beginPath();
        const L = bands[b];
        for (let s = 0; s < L.length; s += 2) { c.moveTo(px(L[s]), py(L[s])); c.lineTo(px(L[s + 1]), py(L[s + 1])); }
        c.stroke();
      }
    }
    c.globalAlpha = base;
  }
  if (l.look === 'goo') { agGoo(c, st, l, v, W, H, dpr, cols, size, px, py); return; }
  // Batch by colour: one path per group, or per palette band.
  const byGroup = l.colourBy === 'group' || !l.colourBy;
  const nb = byGroup ? AG_GROUPS : AG_BUCKETS;
  const paths = Array.from({ length: nb }, () => []);
  for (let i = 0; i < n; i++) {
    if (!st.alive[i]) continue;
    const b = byGroup ? st.group[i] - 1 : Math.min(AG_BUCKETS - 1, Math.max(0, Math.floor(agColourT(st, i, l, v) * AG_BUCKETS)));
    paths[b].push(i);
  }
  const sprite = l.look === 'sprites';
  for (let b = 0; b < nb; b++) {
    const P2 = paths[b];
    if (!P2.length) continue;
    c.fillStyle = agCss(byGroup ? cols[b] : paletteColour(l.palette, (b + 0.5) / AG_BUCKETS));
    c.beginPath();
    for (const i of P2) {
      const r = size(st.group[i]), X = px(i), Y = py(i);
      if (sprite) {
        // A triangle pointing along the heading (y flips: the canvas's y runs down).
        const h = st.heading[i], cx = Math.cos(h), sy = -Math.sin(h), L = r * 2.2, Wd = r * 0.9;
        c.moveTo(X + cx * L, Y + sy * L);
        c.lineTo(X - cx * L * 0.6 - sy * Wd, Y - sy * L * 0.6 + cx * Wd);
        c.lineTo(X - cx * L * 0.6 + sy * Wd, Y - sy * L * 0.6 - cx * Wd);
        c.closePath();
      } else if (r < 1.5) c.rect(X - r, Y - r, r * 2, r * 2);
      else { c.moveTo(X + r, Y); c.arc(X, Y, r, 0, Math.PI * 2); }
    }
    c.fill();
  }
}

/** Goo: each agent a metaball bump (the particles' Goo, shared through particle-sim.js). */
function agGoo(c, st, l, v, W, H, dpr, cols, size, px, py) {
  const blend = Math.max(1, v('gooBlend')), t = v('gooThreshold'), soft = v('gooSoft');
  let reach = 1;
  for (let g = 1; g <= AG_GROUPS; g++) if (st.counts[g - 1]) reach = Math.max(reach, size(g) * blend);
  const cell = gooCell(W, H, reach);
  const gw = Math.max(1, Math.ceil(W / cell)), gh = Math.max(1, Math.ceil(H / cell));
  const vv = new Float32Array(gw * gh), rgb = new Float32Array(gw * gh * 3);
  for (let i = 0; i < st.n; i++) {
    if (!st.alive[i]) continue;
    gooSplat(vv, rgb, gw, gh, cell, px(i), py(i), size(st.group[i]) * blend, 1, agColour(st, i, l, v, cols));
  }
  if (!st.gooHolder) st.gooHolder = {};
  gooBlit(c, st.gooHolder, vv, rgb, gw, gh, cell, t, soft, c.globalAlpha);
}

// ── Presets ─────────────────────────────────────────────────────────────────

/**
 * The preset rule stacks and settings. `rules` are [type, overrides] with
 * numbers under their keys (weight, radius…) and the rest (group, mode,
 * target, targetGroup, k) as rule fields; `set` is the layer's own settings.
 * agPresetLayer turns one into a patch for a layer.
 */
export const AG_PRESETS = {
  boids: { label: 'Boids', hint: 'A flock: align, cohere and separate, a little wander, wrapping round the edges.',
    set: { groups: 1, g1_count: 300, spawn: 'random', look: 'sprites', g1_size: 3, trail: 0.4, links: 'off', colourBy: 'heading', palette: 1, speed: 1, startSpeed: 0.3 },
    rules: [['align', { weight: 1, radius: 0.08 }], ['cohere', { weight: 0.7, radius: 0.1 }], ['separate', { weight: 1.6, radius: 0.03 }], ['wander', { weight: 0.3, rate: 0.5 }], ['maxSpeed', { weight: 0.4, min: 0.18 }], ['boundary', { mode: 'wrap' }]] },
  gravity: { label: 'Gravity', hint: 'A few hundred bodies pulling on each other (n-body), with trails.',
    set: { groups: 1, g1_count: 300, spawn: 'centre', spawnRadius: 0.4, look: 'dots', g1_size: 1.6, trail: 0.85, links: 'off', colourBy: 'speed', palette: 3, colourSpan: 0.8, speed: 1, startSpeed: 0.02, spin: 1.1 },
    rules: [['gravity', { mode: 'pairs', weight: 1, soft: 0.04 }], ['maxSpeed', { weight: 1.5 }], ['boundary', { mode: 'bounce', weight: 0.6 }]] },
  springNet: { label: 'Spring net', hint: 'A grid joined by springs, with drag; the pointer pulls on it.',
    set: { groups: 1, g1_count: 400, spawn: 'grid', spawnRadius: 0.36, look: 'dots', g1_size: 2, trail: 0, links: 'springs', linkOpacity: 0.5, colourBy: 'speed', palette: 4, colourSpan: 0.5, speed: 1, startSpeed: 0 },
    rules: [['springs', { mode: 'grid', weight: 80, damp: 2, rest: 1, anchor: 4 }], ['seek', { target: 'pointer', weight: 1.5, speed: 1, radius: 0.2 }], ['drag', { weight: 1 }], ['boundary', { mode: 'bounce', weight: 0.3 }]] },
  predatorPrey: { label: 'Predator–prey', hint: 'Two groups: prey flock and flee predators; predators chase the nearest prey, lose energy over time and regain it by catching; prey respawn.',
    set: { groups: 2, g1_count: 240, g2_count: 6, spawn: 'random', look: 'sprites', g1_size: 2.6, g2_size: 5, trail: 0.3, links: 'off', colourBy: 'group', speed: 1, startSpeed: 0.3, g1_drain: 0, g1_respawn: 4, g2_drain: 0.08, g2_respawn: 0.25 },
    rules: [
      ['align', { group: 1, targetGroup: 1, weight: 1, radius: 0.07 }], ['cohere', { group: 1, targetGroup: 1, weight: 0.6, radius: 0.09 }], ['separate', { group: 1, targetGroup: 0, weight: 1.6, radius: 0.03 }],
      ['flee', { group: 1, target: 'group', targetGroup: 2, weight: 3, speed: 0.6, radius: 0.18 }], ['wander', { group: 1, weight: 0.3, rate: 0.6 }],
      ['seek', { group: 2, target: 'group', targetGroup: 1, weight: 1.5, speed: 0.5, radius: 0 }], ['separate', { group: 2, targetGroup: 2, weight: 2, radius: 0.08 }],
      ['catch', { group: 2, targetGroup: 1, radius: 0.02, gain: 0.35 }],
      ['maxSpeed', { group: 1, weight: 0.45, min: 0.15 }], ['maxSpeed', { group: 2, weight: 0.5, min: 0.1 }], ['boundary', { mode: 'steer', weight: 2, margin: 0.08 }],
    ] },
  flowField: { label: 'Flow field', hint: 'Agents carried by curl noise: smooth swirling lanes, with long trails.',
    set: { groups: 1, g1_count: 1200, spawn: 'random', look: 'dots', g1_size: 1.2, trail: 0.9, links: 'off', colourBy: 'heading', palette: 2, speed: 1, startSpeed: 0.1 },
    rules: [['field', { mode: 'curl', weight: 1.2, speed: 0.3, scale: 2.5, evolve: 0.08 }], ['maxSpeed', { weight: 0.5 }], ['boundary', { mode: 'wrap' }]] },
};

/**
 * A preset as a patch for a layer: its settings, and its rules as r1, r2…
 * with every number of each rule (the preset's, else the type's default).
 * Numbers of the layer's old rules are dropped (set to undefined).
 */
export function agPresetLayer(name, old) {
  const pr = AG_PRESETS[name];
  if (!pr) return null;
  const patch = Object.assign({}, pr.set);
  // Numbers of rules that are going away.
  for (const r of (old && old.rules) || []) for (const k in old) if (k.indexOf(r.id + '_') === 0) patch[k] = undefined;
  const rules = [];
  pr.rules.forEach(([type, o], i) => {
    const id = 'r' + (i + 1), def = AG_RULES[type];
    const rule = { id, type, on: true, group: o.group || 0, targetGroup: o.targetGroup || 0, mode: o.mode || (def.modes ? def.modes[0] : ''), target: o.target || 'point', targetId: '', channel: 'brightness', k: o.k || 3 };
    rules.push(rule);
    for (const p of def.params) patch[id + '_' + p.key] = typeof o[p.key] === 'number' ? o[p.key] : p.value;
    if (def.target) { patch[id + '_x'] = typeof o.x === 'number' ? o.x : 0.5; patch[id + '_y'] = typeof o.y === 'number' ? o.y : 0.5; }
  });
  patch.rules = rules;
  patch.preset = name;
  return patch;
}
