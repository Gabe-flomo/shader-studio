/**
 * midi.js — MIDI reading that the app and exported pages share: knob locks,
 * note ranges and pad grids (Push, Launchpad, or a grid learned from two
 * corner pads). Plain JS, part of the layer kit (inlined into web exports),
 * pure apart from the small state objects it is handed. Names start with
 * `km` so the file can share the exported page's scope with the kit's other
 * files.
 *
 *   locks     a CC mapping bound to exact controls (device + channel + CC);
 *             whichever locked control moved last drives it
 *   ranges    note sources that only count notes from `lo` to `hi`
 *   pad grid  a controller's pads as columns and rows (row 0 at the bottom),
 *             lined up with a grid shader's cells by an offset, a scale and
 *             flips, each cell holding a level on the graph clock: held while
 *             pressed, latched (toggled), or decaying after each hit
 */

// ── Knob locks ──────────────────────────────────────────────────────────────

/** The key a CC value is kept under. Device '' and channel 0 are "any". */
export function kmLockKey(device, channel, cc) {
  return device + '\u0000' + channel + '\u0000' + cc;
}

/**
 * Note a CC move in `store` (a Map key → { v, seq }) under its exact
 * device and channel and under "any device" / "any channel", so a lock on
 * either finds it.
 */
export function kmLockRecord(store, device, channel, cc, value, seq) {
  const devs = device ? [device, ''] : [''];
  for (const d of devs) for (const c of [channel, 0]) {
    const k = kmLockKey(d, c, cc);
    const e = store.get(k);
    if (e) { e.v = value; e.seq = seq; } else store.set(k, { v: value, seq: seq });
  }
}

/** Does a lock match a CC message? A lock's '' device or channel 0 matches any. */
export function kmLockMatches(lock, device, channel, cc) {
  return lock.cc === cc && (!lock.channel || lock.channel === channel) && (!lock.device || lock.device === device);
}

/** The raw 0..127 value of the locked control that moved last, or null while none has. */
export function kmLockRead(store, locks) {
  let best = null;
  for (const l of locks) {
    const e = store.get(kmLockKey(l.device || '', l.channel || 0, l.cc));
    if (e && (!best || e.seq > best.seq)) best = e;
  }
  return best ? best.v : null;
}

// ── Note ranges ─────────────────────────────────────────────────────────────

const KM_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "C4" for 60 (middle C is C4). */
export function kmNoteName(n) {
  const c = Math.max(0, Math.min(127, Math.round(n)));
  return KM_NOTE_NAMES[c % 12] + (Math.floor(c / 12) - 1);
}

/** 60 for "C4", "c#3" → 49, "Db3" → 49; null when it isn't a note name or a number 0–127. */
export function kmParseNote(text) {
  const s = String(text).trim();
  if (/^\d{1,3}$/.test(s)) { const n = Number(s); return n <= 127 ? n : null; }
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(s);
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const n = (Number(m[3]) + 1) * 12 + base + acc;
  return n >= 0 && n <= 127 ? n : null;
}

/** A range from two presses in either order, or null for "every note". */
export function kmRange(a, b) {
  const lo = Math.max(0, Math.min(127, Math.round(Math.min(a, b))));
  const hi = Math.max(0, Math.min(127, Math.round(Math.max(a, b))));
  return lo === 0 && hi === 127 ? null : [lo, hi];
}

export function kmInRange(range, note) {
  return !range || (note >= range[0] && note <= range[1]);
}

/**
 * What a note source reads inside a range: the latest note in it (by the
 * `seq` each note-on was given), its velocity, and whether any note in it is
 * held. `note` is -1 while no note in the range has played.
 */
export function kmRangeRead(seq, vel, held, range) {
  const lo = range ? range[0] : 0, hi = range ? range[1] : 127;
  let note = -1, best = 0, gate = false;
  for (let n = lo; n <= hi; n++) {
    if (seq[n] > best) { best = seq[n]; note = n; }
    if (!gate && held.has(n)) gate = true;
  }
  return { note: note, vel: note < 0 ? 0 : vel[note], gate: gate };
}

/** A note as 0..1: across the range when there is one (its low note 0, its high note 1), else n / 127. */
export function kmNoteUnit(range, note) {
  if (!range) return note / 127;
  const span = range[1] - range[0];
  return span > 0 ? Math.max(0, Math.min(1, (note - range[0]) / span)) : 1;
}

// ── Pad grids ───────────────────────────────────────────────────────────────

/**
 * Known layouts as a line: pad (col, row) sends note origin + col·colStep +
 * row·rowStep, row 0 at the bottom.
 *   push              Push 2 and 3 in User mode: 36 bottom-left … 99 top-right
 *   launchpad         Launchpad X, Mini MK3, Pro MK3 and MK2 in programmer mode: 11 … 88
 *   launchpadClassic  the original Launchpad, S and Mini (MK1/MK2) X-Y layout: 0 top-left, 16 a row
 */
export const KM_LAYOUTS = {
  push: { origin: 36, colStep: 1, rowStep: 8, cols: 8, rows: 8 },
  launchpad: { origin: 11, colStep: 1, rowStep: 10, cols: 8, rows: 8 },
  launchpadClassic: { origin: 112, colStep: 1, rowStep: -16, cols: 8, rows: 8 },
};

/** The layout a pad grid setup reads with (a learned one, or a known one; Push when unknown). */
export function kmLayoutOf(pg) {
  if (pg.layout === 'learned' && pg.learned) return pg.learned;
  return KM_LAYOUTS[pg.layout] || KM_LAYOUTS.push;
}

/** The pad a note is on, or null when the note is not a pad of this layout. */
export function kmPadOf(geo, note) {
  for (let row = 0; row < geo.rows; row++) {
    const d = note - geo.origin - row * geo.rowStep;
    if (d % geo.colStep !== 0) continue;
    const col = d / geo.colStep;
    if (col >= 0 && col < geo.cols) return { col: col, row: row };
  }
  return null;
}

/** The note a pad sends. */
export function kmNoteOfPad(geo, col, row) {
  return geo.origin + col * geo.colStep + row * geo.rowStep;
}

/**
 * Learn a grid from its bottom-left and top-right pads' notes and its size in
 * pads: rows first (each row `cols` notes apart or more), else columns first.
 * Null when no whole-number layout fits (another size, or pads out of order).
 */
export function kmLearnGrid(bottomLeft, topRight, cols, rows) {
  cols = Math.max(1, Math.round(cols)); rows = Math.max(1, Math.round(rows));
  const span = topRight - bottomLeft;
  if (cols === 1 && rows === 1) return span === 0 ? { origin: bottomLeft, colStep: 1, rowStep: 1, cols: 1, rows: 1 } : null;
  if (rows === 1) { const s = span / (cols - 1); return Number.isInteger(s) && s !== 0 ? { origin: bottomLeft, colStep: s, rowStep: cols * Math.abs(s), cols: cols, rows: 1 } : null; }
  if (cols === 1) { const s = span / (rows - 1); return Number.isInteger(s) && s !== 0 ? { origin: bottomLeft, colStep: rows * Math.abs(s), rowStep: s, cols: 1, rows: rows } : null; }
  // Rows of consecutive notes (Push, Launchpad): rowStep from what is left once the columns are taken off.
  const rowStep = (span - (cols - 1)) / (rows - 1);
  if (Number.isInteger(rowStep) && Math.abs(rowStep) >= cols) return { origin: bottomLeft, colStep: 1, rowStep: rowStep, cols: cols, rows: rows };
  // Columns of consecutive notes.
  const colStep = (span - (rows - 1)) / (cols - 1);
  if (Number.isInteger(colStep) && Math.abs(colStep) >= rows) return { origin: bottomLeft, colStep: colStep, rowStep: 1, cols: cols, rows: rows };
  return null;
}

/**
 * The shader cells a pad covers, [c0, c1, r0, r1] inclusive, after the flips,
 * the scale (cells per pad) and the offset (cells); clipped to the grid, or
 * null when the pad lands outside it.
 */
export function kmCellsOf(pg, geo, col, row) {
  const c = pg.flipX ? geo.cols - 1 - col : col;
  const r = pg.flipY ? geo.rows - 1 - row : row;
  const s = pg.scale > 0 ? pg.scale : 1;
  const ox = Math.round(pg.offsetX || 0), oy = Math.round(pg.offsetY || 0);
  let c0 = Math.floor(c * s + 1e-9) + ox, c1 = Math.max(c0, Math.ceil((c + 1) * s - 1e-9) - 1 + ox);
  let r0 = Math.floor(r * s + 1e-9) + oy, r1 = Math.max(r0, Math.ceil((r + 1) * s - 1e-9) - 1 + oy);
  c0 = Math.max(0, c0); r0 = Math.max(0, r0);
  c1 = Math.min(pg.cols - 1, c1); r1 = Math.min(pg.rows - 1, r1);
  return c0 > c1 || r0 > r1 ? null : [c0, c1, r0, r1];
}

/** A pad grid's state: one entry per shader cell, the pads held, and the last pad hit. */
export function kmGridCreate(cols, rows) {
  const n = cols * rows;
  const cells = [];
  for (let i = 0; i < n; i++) cells.push({ held: 0, on: -Infinity, off: -Infinity, peak: 0, latched: false, vel: 0, pressure: 0 });
  return { cols: cols, rows: rows, cells: cells, pads: new Map(), last: { col: -1, row: -1, cx: -1, cy: -1, vel: 0, pressure: 0 }, heldPads: 0 };
}

/** Starts over when the setup's grid size changed. */
export function kmGridFit(g, pg) {
  return g && g.cols === pg.cols && g.rows === pg.rows ? g : kmGridCreate(pg.cols, pg.rows);
}

/** A cell's level at time `t`, 0..1. */
export function kmCellLevel(cell, pg, t) {
  const rel = Math.max(0, pg.release || 0);
  const fade = from => (rel > 0 ? Math.max(0, 1 - (t - from) / rel) : 0);
  switch (pg.mode) {
    case 'latch':
      return cell.latched ? cell.peak : cell.peak * fade(cell.off);
    case 'decay':
      return cell.on === -Infinity ? 0 : cell.peak * Math.max(0, 1 - (t - cell.on) / Math.max(0.02, rel));
    default: // hold
      return cell.held > 0 ? cell.peak : cell.peak * fade(cell.off);
  }
}

/** A pad pressed (velocity 0..1) at clock `t`. Returns the cells it covers, or null off the grid. */
export function kmGridDown(g, pg, geo, col, row, vel, t) {
  const key = col + ',' + row;
  if (g.pads.has(key)) kmGridUp(g, pg, col, row, t);
  const box = kmCellsOf(pg, geo, col, row);
  const peak = pg.velocity === false ? 1 : vel;
  const idx = [];
  if (box) for (let r = box[2]; r <= box[3]; r++) for (let c = box[0]; c <= box[1]; c++) {
    const i = r * g.cols + c, cell = g.cells[i];
    idx.push(i);
    cell.held++;
    cell.vel = vel;
    if (pg.mode === 'latch') {
      cell.latched = !cell.latched;
      if (cell.latched) { cell.on = t; cell.peak = peak; } else cell.off = t;
    } else { cell.on = t; cell.peak = peak; }
  }
  g.pads.set(key, idx);
  g.heldPads = g.pads.size;
  g.last = { col: col, row: row, cx: box ? box[0] : -1, cy: box ? box[2] : -1, vel: vel, pressure: 0 };
  return box;
}

/** A pad let go. */
export function kmGridUp(g, pg, col, row, t) {
  const key = col + ',' + row;
  const idx = g.pads.get(key);
  if (!idx) return;
  g.pads.delete(key);
  g.heldPads = g.pads.size;
  for (const i of idx) {
    const cell = g.cells[i];
    if (!cell) continue;
    cell.held = Math.max(0, cell.held - 1);
    if (cell.held === 0) { cell.pressure = 0; if (pg.mode !== 'latch') cell.off = t; }
  }
  if (g.last.col === col && g.last.row === row) g.last.pressure = 0;
}

/** Pressure (aftertouch) 0..1 on a held pad, or on every held pad (`col` -1: channel pressure). */
export function kmGridPressure(g, col, row, value) {
  const each = (key, idx) => { for (const i of idx) if (g.cells[i]) g.cells[i].pressure = value; };
  if (col < 0) { for (const [k, idx] of g.pads) each(k, idx); if (g.heldPads) g.last.pressure = value; return; }
  const idx = g.pads.get(col + ',' + row);
  if (!idx) return;
  each('', idx);
  if (g.last.col === col && g.last.row === row) g.last.pressure = value;
}

/** Let everything go (a reset, the setup turned off). Latched cells stay latched. */
export function kmGridReleaseAll(g, pg, t) {
  for (const k of [...g.pads.keys()]) { const [c, r] = k.split(','); kmGridUp(g, pg, Number(c), Number(r), t); }
}

/** Clear every cell: nothing held, latched or fading. */
export function kmGridClear(g) {
  for (const cell of g.cells) { cell.held = 0; cell.on = -Infinity; cell.off = -Infinity; cell.peak = 0; cell.latched = false; cell.vel = 0; cell.pressure = 0; }
  g.pads.clear(); g.heldPads = 0;
  g.last = { col: -1, row: -1, cx: -1, cy: -1, vel: 0, pressure: 0 };
}

/**
 * A raw MIDI message for the grid. Handles note on/off, poly aftertouch
 * (0xA0) and channel pressure (0xD0) from the setup's device and channel.
 * Returns 'down', 'up', 'pressure' or null (not for the grid).
 */
export function kmGridMessage(g, pg, status, d1, d2, device, t) {
  if (pg.device && device && pg.device !== device) return null;
  const type = status & 0xf0, ch = (status & 0x0f) + 1;
  if (pg.channel && pg.channel !== ch) return null;
  const geo = kmLayoutOf(pg);
  if (type === 0xd0) { kmGridPressure(g, -1, -1, d1 / 127); return 'pressure'; }
  if (type !== 0x90 && type !== 0x80 && type !== 0xa0) return null;
  const pad = kmPadOf(geo, d1);
  if (!pad) return null;
  if (type === 0xa0) { kmGridPressure(g, pad.col, pad.row, d2 / 127); return 'pressure'; }
  if (type === 0x90 && d2 > 0) { kmGridDown(g, pg, geo, pad.col, pad.row, d2 / 127, t); return 'down'; }
  kmGridUp(g, pg, pad.col, pad.row, t);
  return 'up';
}

/**
 * The cells into `rgba` (cols·rows·4 bytes, row 0 first = the bottom row):
 * R the level, G the last hit's velocity, B pressure, A 255 while held.
 * Returns true while a cell is still fading (the picture keeps changing).
 */
export function kmGridFill(g, pg, t, rgba) {
  let moving = false;
  for (let i = 0; i < g.cells.length; i++) {
    const cell = g.cells[i];
    const v = kmCellLevel(cell, pg, t);
    if (v > 0 && v < cell.peak - 1e-6) moving = true;
    if (pg.mode === 'decay' && v > 0) moving = true;
    rgba[i * 4] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    rgba[i * 4 + 1] = Math.round(cell.vel * 255);
    rgba[i * 4 + 2] = Math.round(cell.pressure * 255);
    rgba[i * 4 + 3] = cell.held > 0 ? 255 : 0;
  }
  return moving;
}

/**
 * A pad grid source's reading, 0..1: the last pad's column or row across the
 * pads, its velocity or pressure, 1 while any pad is held, or one cell's level.
 * Null before any pad has been hit (a `cell` read is 0 instead).
 */
export function kmGridRead(g, pg, read, col, row, t) {
  const geo = kmLayoutOf(pg);
  if (read === 'cell') {
    const c = Math.round(col), r = Math.round(row);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return 0;
    return kmCellLevel(g.cells[r * g.cols + c], pg, t);
  }
  if (g.last.col < 0) return null;
  switch (read) {
    case 'x': return geo.cols > 1 ? g.last.col / (geo.cols - 1) : 0;
    case 'y': return geo.rows > 1 ? g.last.row / (geo.rows - 1) : 0;
    case 'velocity': return g.last.vel;
    case 'pressure': return g.last.pressure;
    case 'gate': return g.heldPads > 0 ? 1 : 0;
  }
  return null;
}
