/**
 * agentSketches.ts — the Agents group's Slime mold rule written again as a
 * small Script layer (plain JavaScript on the CPU). Pages run the group itself
 * now (kit/agentHost.js), so this copy is kept for what the group can't show:
 * the rule as a few dozen lines anyone can read and edit, and "Show the
 * sensors of", which draws what a few walkers smell and which side won.
 *
 * It follows the preset's rule step for step and uses the nodes' names and
 * units (picture units: y −1…1 across the picture's height; one step is
 * 1/60 s), only with tens of thousands of walkers instead of a million, and a
 * trail a couple of hundred pixels tall. The "How Agents work" presentation
 * (present/agentsSample.ts) runs it on "The loop".
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
