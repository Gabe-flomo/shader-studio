/**
 * motion.js — the Motion layer's maths (part of the layer kit, see kit.js).
 *
 * A Motion layer watches a source (the camera, the picture, or another
 * layer such as a Video layer) and keeps:
 *
 *   a grid    per cell, how much moved lately (0..1), from the frame now
 *             against the one Delay frames before, thresholded by
 *             Sensitivity and eased by Smoothing
 *   readings  Amount, Area, Where X/Y (the centre of the movement) and
 *             Direction X/Y (the mean flow), each 0..1 (see MT_READS)
 *   a table   for picking a cell in proportion to its movement (particles
 *             born where it moves)
 *
 * Everything is a function of the frames it is given and the frame step, so
 * an offline render or a take (the same frames, the same steps) gives the
 * same grid and readings every time. The frames are sampled at a fixed size
 * that depends only on the picture's shape (mtSampleSize), so a render at a
 * different resolution reads the same too.
 *
 * Plain JS shared by the app and web exports; every kit file shares one scope
 * when inlined, so top-level names here start with `mt` / `MT_`.
 */

/** Rows of the copy each frame is sampled to (the columns follow the picture's shape). */
export const MT_ROWS = 144;
/** At most this many columns (a very wide picture is sampled with fewer rows). */
export const MT_MAX_COLS = 320;
/** The farthest back Delay reaches, in frames. */
export const MT_DELAY_MAX = 30;
/** A cell counts as moving (for Area) above this. */
export const MT_MOVING = 0.25;
/** Direction X/Y reach 0 or 1 at this speed, in picture heights a second. */
export const MT_DIR_FULL = 1.5;
/** The readings a Motion layer reports, as `<layerId>::<read>`. */
export const MT_READS = ['motion', 'area', 'moveX', 'moveY', 'dirX', 'dirY'];

const mtClamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The size each frame is sampled at for a picture of this shape (width / height): 144 rows, at most 320 columns. */
export function mtSampleSize(aspect) {
  const a = aspect > 0 && isFinite(aspect) ? aspect : 16 / 9;
  let h = MT_ROWS, w = Math.round(h * a);
  if (w > MT_MAX_COLS) { w = MT_MAX_COLS; h = Math.max(16, Math.round(MT_MAX_COLS / a)); }
  return { w: Math.max(16, w), h };
}

/**
 * The change in brightness (0..1) a pixel must pass to count as moving, from
 * Sensitivity (0..1): 0.215 at 0 (only big, contrasty movement), 0.065 at the
 * default 0.5, 0.015 at 1 (about a webcam's noise).
 */
export function mtThreshold(sensitivity) {
  const s = mtClamp(+sensitivity || 0, 0, 1);
  return 0.015 + 0.2 * (1 - s) * (1 - s);
}

/** The grid for a Cell size (picture heights) on a w × h sample: about 1 / cell rows, square cells, at least 2 pixels a cell. */
export function mtGridSize(cell, w, h, aspect) {
  const c = mtClamp(+cell || 0.04, 0.005, 0.5);
  const rows = mtClamp(Math.round(1 / c), 2, Math.max(2, Math.floor(h / 2)));
  const cols = mtClamp(Math.round(rows * (aspect > 0 ? aspect : w / h)), 2, Math.max(2, Math.floor(w / 2)));
  return { cols, rows };
}

/** A fresh state: nothing seen yet, readings at rest (no movement, centre and direction in the middle). */
export function mtCreate() {
  return {
    w: 0, h: 0, cols: 0, rows: 0, ring: [], grid: null, now: null, then: null, delay: 1,
    vx: 0, vy: 0, cdf: null, frames: 0,
    reads: { motion: 0, area: 0, moveX: 0.5, moveY: 0.5, dirX: 0.5, dirY: 0.5 },
  };
}

/** Rec. 709 brightness of an RGBA frame, 0..1 a pixel. */
export function mtLuma(rgba, n, out) {
  const L = out && out.length === n ? out : new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) L[j] = (rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722) / 255;
  return L;
}

/** A brightness grid halved each way (2 × 2 averages), for the flow estimate. */
function mtHalve(L, w, h) {
  const w2 = w >> 1, h2 = h >> 1, out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const i = (y * 2) * w + x * 2;
    out[y * w2 + x] = (L[i] + L[i + 1] + L[i + w] + L[i + w + 1]) * 0.25;
  }
  return { L: out, w: w2, h: h2 };
}

/**
 * The mean flow between two brightness grids (Lucas–Kanade over the whole
 * frame, at half size, from the pixels that changed by more than `thr`), in
 * sample pixels per step, y down. { x: 0, y: 0, n } when too little moved.
 */
export function mtFlow(now, then, w, h, thr) {
  const a = mtHalve(now, w, h), b = mtHalve(then, w, h), W = a.w, H = a.h;
  let sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0, n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const it = a.L[i] - b.L[i];
    if (Math.abs(it) < thr * 0.5) continue;
    const gx = (a.L[i + 1] - a.L[i - 1] + b.L[i + 1] - b.L[i - 1]) * 0.25;
    const gy = (a.L[i + W] - a.L[i - W] + b.L[i + W] - b.L[i - W]) * 0.25;
    sxx += gx * gx; sxy += gx * gy; syy += gy * gy; sxt += gx * it; syt += gy * it; n++;
  }
  const det = sxx * syy - sxy * sxy;
  if (n < 8 || !(det > 1e-9)) return { x: 0, y: 0, n };
  const vx = (-syy * sxt + sxy * syt) / det, vy = (sxy * sxt - sxx * syt) / det;
  // Half-size pixels to sample pixels; a wild estimate (a cut, a flash) is held to a few pixels.
  return { x: mtClamp(vx, -8, 8) * 2, y: mtClamp(vy, -8, 8) * 2, n };
}

/**
 * The readings of a grid (cols × rows, row 0 at the top), 0..1 each:
 *   motion  how much is moving overall: the square root of the grid's mean (a hand waving in
 *           a corner reads about 0.2, the whole frame moving 1)
 *   area    the share of cells moving (above MT_MOVING)
 *   moveX/Y where the movement is: its centre, y up (held where it last was while nothing moves)
 * Direction is the state's, set by mtStep.
 */
export function mtReadGrid(grid, cols, rows, prev) {
  const n = cols * rows;
  let sum = 0, moving = 0, wx = 0, wy = 0, ws = 0;
  for (let j = 0; j < n; j++) {
    const v = grid[j];
    sum += v;
    if (v > MT_MOVING) moving++;
    if (v > 0.05) { const wv = v * v; wx += wv * ((j % cols) + 0.5); wy += wv * (Math.floor(j / cols) + 0.5); ws += wv; }
  }
  const out = { motion: Math.min(1, Math.sqrt(sum / n)), area: moving / n, moveX: prev ? prev.moveX : 0.5, moveY: prev ? prev.moveY : 0.5 };
  if (ws > 0.02) { out.moveX = wx / ws / cols; out.moveY = 1 - wy / ws / rows; }
  return out;
}

/**
 * One frame. `rgba` is the source sampled at w × h (row 0 at the top). `o`:
 *   sensitivity  0..1 (mtThreshold)
 *   delay        frames back to compare with (1..MT_DELAY_MAX)
 *   smoothing    0..0.99: how slowly the grid and the readings follow (per 60th of a second)
 *   cell         cell size in picture heights (mtGridSize)
 *   aspect       the picture's width / height
 *   dt           the frame step in seconds; 0 (paused) holds everything as it is
 * Returns the state.
 */
export function mtStep(st, rgba, w, h, o) {
  const dt = +o.dt || 0;
  const aspect = o.aspect > 0 ? o.aspect : w / h;
  const gs = mtGridSize(o.cell, w, h, aspect);
  if (st.w !== w || st.h !== h) { st.w = w; st.h = h; st.ring = []; st.grid = null; st.now = st.then = null; }
  if (!st.grid || st.cols !== gs.cols || st.rows !== gs.rows) { st.cols = gs.cols; st.rows = gs.rows; st.grid = new Float32Array(gs.cols * gs.rows); st.cdf = null; }
  // Paused (or scrubbing a frozen clock): nothing new to compare, so everything holds.
  if (!(dt > 0) && st.frames > 0) return st;
  const delay = mtClamp(Math.round(+o.delay || 1), 1, MT_DELAY_MAX);
  st.delay = delay;
  st.ring.push(new Uint8ClampedArray(rgba));
  while (st.ring.length > delay + 1) st.ring.shift();
  st.frames++;
  const n = w * h, cols = st.cols, rows = st.rows, cells = cols * rows;
  const now = st.ring[st.ring.length - 1], then = st.ring.length > 1 ? st.ring[0] : null;
  st.now = now; st.then = then;
  const raw = new Float32Array(cells);
  const thr = mtThreshold(o.sensitivity);
  let flow = { x: 0, y: 0, n: 0 };
  if (then) {
    const Ln = mtLuma(now, n), Lt = mtLuma(then, n);
    const counts = new Float32Array(cells);
    for (let y = 0; y < h; y++) {
      const cy = Math.min(rows - 1, Math.floor((y * rows) / h));
      for (let x = 0; x < w; x++) {
        const j = y * w + x, cx = Math.min(cols - 1, Math.floor((x * cols) / w)), c = cy * cols + cx;
        const d = Math.abs(Ln[j] - Lt[j]);
        raw[c] += mtClamp((d - thr) / thr, 0, 1);
        counts[c]++;
      }
    }
    // A cell half full of moving pixels counts as fully moving.
    for (let c = 0; c < cells; c++) raw[c] = counts[c] ? Math.min(1, (raw[c] / counts[c]) * 2) : 0;
    flow = mtFlow(Ln, Lt, w, h, thr);
  }
  // Smoothing per 60th of a second, so 30 and 120 Hz ease alike.
  const k = Math.pow(mtClamp(+o.smoothing || 0, 0, 0.99), Math.max(0, dt) * 60);
  const g = st.grid;
  for (let c = 0; c < cells; c++) g[c] = k * g[c] + (1 - k) * raw[c];
  const r = mtReadGrid(g, cols, rows, st.reads);
  // Direction: the flow in picture heights a second (y up), eased like the grid; nothing moving eases back to still.
  const span = delay * dt;
  const tx = flow.n >= 8 && span > 0 ? flow.x / h / span : 0, ty = flow.n >= 8 && span > 0 ? -flow.y / h / span : 0;
  st.vx = k * st.vx + (1 - k) * tx; st.vy = k * st.vy + (1 - k) * ty;
  r.dirX = 0.5 + 0.5 * mtClamp(st.vx / MT_DIR_FULL, -1, 1);
  r.dirY = 0.5 + 0.5 * mtClamp(st.vy / MT_DIR_FULL, -1, 1);
  st.reads = r;
  // The table particles are born from: the last one with something in it, so they keep coming from where something last moved.
  let total = 0;
  const cdf = new Float32Array(cells);
  for (let c = 0; c < cells; c++) { total += g[c]; cdf[c] = total; }
  if (total > 0.5 || !st.cdf) st.cdf = { cdf, total, w: cols, h: rows };
  return st;
}

/**
 * The extracted look of the frame now against Delay frames ago, into `out`
 * (RGBA, the sample's size), like the Finish stack's Motion extract:
 *   grey   the classic trick: still parts cancel to mid-grey, what moves shows as outlines
 *   black  only how much changed, on black
 *   neon   on black: what arrives glows cyan, what leaves magenta
 * `gain` scales the change. Before there are two frames: grey or black.
 */
export function mtLook(st, out, look, gain) {
  const now = st.now, then = st.then, n = st.w * st.h;
  const gn = +gain || 1;
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    let r = 0, g = 0, b = 0;
    if (now && then) { r = (then[i] - now[i]) / 255 * gn; g = (then[i + 1] - now[i + 1]) / 255 * gn; b = (then[i + 2] - now[i + 2]) / 255 * gn; }
    if (look === 'grey') { out[i] = (0.5 + 0.5 * r) * 255; out[i + 1] = (0.5 + 0.5 * g) * 255; out[i + 2] = (0.5 + 0.5 * b) * 255; }
    else if (look === 'neon') {
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722, m = Math.min(1, Math.abs(l) * 1.6);
      // l < 0: brighter now than then (arriving) → cyan; else leaving → magenta.
      if (l < 0) { out[i] = 0.1 * m * 255; out[i + 1] = 0.95 * m * 255; out[i + 2] = m * 255; } else { out[i] = m * 255; out[i + 1] = 0.15 * m * 255; out[i + 2] = 0.85 * m * 255; }
    } else { out[i] = Math.abs(r) * 255; out[i + 1] = Math.abs(g) * 255; out[i + 2] = Math.abs(b) * 255; }
    out[i + 3] = 255;
  }
  return out;
}

const MT_HEAT = [[0, 0, 0], [0.1, 0.12, 0.75], [0.8, 0.12, 0.7], [1, 0.5, 0.1], [1, 1, 0.6]];
/** The heat map's colour for an amount (0..1): black, blue, magenta, orange, pale yellow. */
export function mtHeat(v) {
  const t = mtClamp(v, 0, 1) * (MT_HEAT.length - 1), i = Math.min(MT_HEAT.length - 2, Math.floor(t)), f = t - i;
  const a = MT_HEAT[i], b = MT_HEAT[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** A box blur of a cols × rows grid, `r` cells each way, in place (twice: close to a Gaussian). */
export function mtBlur(a, cols, rows, r) {
  const R = Math.round(r);
  if (!(R > 0)) return a;
  const tmp = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let s = 0, c = 0;
      for (let k = -R; k <= R; k++) { const xx = x + k; if (xx >= 0 && xx < cols) { s += a[y * cols + xx]; c++; } }
      tmp[y * cols + x] = s / c;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let s = 0, c = 0;
      for (let k = -R; k <= R; k++) { const yy = y + k; if (yy >= 0 && yy < rows) { s += tmp[yy * cols + x]; c++; } }
      a[y * cols + x] = s / c;
    }
  }
  return a;
}

/**
 * The layer as a matte: per cell, how solid "where it moves" is (0..1), a
 * cell half moving already solid, softened by `feather` (picture heights)
 * over the grid's cells (`cell` picture heights each). Inverting is the
 * matte's own Invert.
 */
export function mtMaskAlpha(st, feather, cell) {
  const cells = st.cols * st.rows, a = new Float32Array(cells);
  if (!st.grid) return a;
  for (let c = 0; c < cells; c++) a[c] = Math.min(1, st.grid[c] * 2);
  const r = (+feather || 0) / Math.max(0.005, +cell || 0.04);
  // Each box pass spreads about r / √3; two passes of r cover the feather's reach.
  return mtBlur(a, st.cols, st.rows, r);
}
