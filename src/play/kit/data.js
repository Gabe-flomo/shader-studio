/**
 * data.js — the Data layer (types/playLayers.ts DataLayer): a dataset drawn
 * over the picture. Plain JS, part of the layer kit, shared by the app
 * (kit.js through overlay.ts) and exported pages (the kit is inlined).
 *
 *   text      a text dataset split into chunks (lines, a separator, words,
 *             letters, fixed-size pieces), optionally counted and sorted
 *   stepping  which rows (or chunks) show: all, a range, or a window of N
 *             starting at the current one (Offset + what Next / Previous /
 *             Random / Go to added), with a cut or a crossfade
 *   axes      a number to where it sits: centred (−1…1 over min…max, or
 *             symmetric around 0) or corner (0…1 from min to max)
 *   views     points, path, bars, pie and lines, laid out in pixels (pure),
 *             then drawn
 *   s.data()  what a Script layer reads
 *
 * Everything that decides where things go is a pure function of its
 * arguments, so the tests check the layout without a canvas. Names start
 * with `kd` so the file can share the exported page's scope with the kit's
 * other files.
 */
import { klCss, klFontFor } from './layers.js';
import { paletteColour } from '../particle-sim.js';

/** Most marks a table view draws (points, bars, slices), and most labels. */
export const KD_MAX_MARKS = 100000;
export const KD_MAX_LABELS = 5000;
/** Most chunks "Show all" puts on the picture at once. */
export const KD_MAX_TEXT_ALL = 400;

// ── Text: chunks, counts and order ───────────────────────────────────────────

/** A separator as typed: \n and \t mean a new line and a tab. */
function kdSep(sep) { return String(sep == null ? '' : sep).replace(/\\n/g, '\n').replace(/\\t/g, '\t'); }

/**
 * Split text into chunks.
 *   lines      one chunk per line (blank lines dropped)
 *   separator  split on `sep` (\n and \t allowed), pieces trimmed, empty ones dropped
 *   words      split on white space (punctuation stays with its word)
 *   letters    every character that isn't white space
 *   chunks     pieces of `size` characters, in order
 */
export function kdSplit(text, mode, sep, size) {
  const s = String(text == null ? '' : text);
  switch (mode) {
    case 'separator': {
      const d = kdSep(sep);
      if (!d) return s.trim() ? [s.trim()] : [];
      return s.split(d).map(x => x.trim()).filter(Boolean);
    }
    case 'words': return s.split(/\s+/).filter(Boolean);
    case 'letters': return Array.from(s).filter(c => !/\s/.test(c));
    case 'chunks': {
      const n = Math.max(1, Math.round(size) || 1), chars = Array.from(s.replace(/\s+/g, ' ').trim()), out = [];
      for (let i = 0; i < chars.length; i += n) out.push(chars.slice(i, i + n).join(''));
      return out;
    }
    default: return s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  }
}

/** What counts as "the same" chunk: lower case, without the punctuation around it ("Sea," and "sea" are one word). */
export function kdKey(chunk) {
  const k = String(chunk).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return k || String(chunk).toLowerCase();
}

/**
 * Chunks in an order, with how often each occurs.
 *   text          as written, every chunk (counts: how often its word occurs in all)
 *   frequency     each different chunk once, most frequent first (ties: first seen first)
 *   alphabetical  each different chunk once, A to Z
 */
export function kdOrder(chunks, order) {
  const counts = new Map(), first = new Map();
  chunks.forEach((c, i) => { const k = kdKey(c); counts.set(k, (counts.get(k) || 0) + 1); if (!first.has(k)) first.set(k, { i, c }); });
  if (order === 'frequency' || order === 'alphabetical') {
    const keys = [...first.keys()];
    if (order === 'frequency') keys.sort((a, b) => counts.get(b) - counts.get(a) || first.get(a).i - first.get(b).i);
    else keys.sort((a, b) => a.localeCompare(b));
    return { items: keys.map(k => first.get(k).c), counts: keys.map(k => counts.get(k)) };
  }
  return { items: chunks.slice(), counts: chunks.map(c => counts.get(kdKey(c))) };
}

/** How the chunks of a split join when several show at once. */
export function kdJoiner(split) {
  return split === 'words' ? ' ' : split === 'letters' || split === 'chunks' ? '' : '\n';
}

const kdTextCache = new WeakMap();
/** A text result's chunks for a layer's split and order (cached per result and settings). */
export function kdTextItems(result, l) {
  const text = result && result.kind === 'text' ? result.text : '';
  const key = [l.split, l.separator, l.chunkSize, l.order].join('\u0001');
  const holder = result && typeof result === 'object' ? result : null;
  let per = holder ? kdTextCache.get(holder) : null;
  if (per && per.has(key)) return per.get(key);
  const out = kdOrder(kdSplit(text, l.split, l.separator, l.chunkSize), l.order);
  if (holder) { if (!per) { per = new Map(); kdTextCache.set(holder, per); } per.set(key, out); }
  return out;
}

// ── Stepping ─────────────────────────────────────────────────────────────────

export function kdWrap(k, n) { return n > 0 ? ((Math.round(k) % n) + n) % n : -1; }

/**
 * The stepping state a layer keeps in the kit:
 *   pos    what Next / Previous / Random / Go to added to Offset (in rows)
 *   key    what shows now ('all', or the current row)
 *   from   the current row fading out (-1 when none)
 *   at     when that change started, on the graph clock
 */
export function kdState() { return { pos: 0, key: '', from: -1, cur: -1, at: 0, started: false }; }

/** The current row: Offset (rounded) plus the actions' steps, wrapped into n rows (-1 when there are none). */
export function kdCurrent(st, offset, n) { return kdWrap((isFinite(offset) ? Math.round(offset) : 0) + st.pos, n); }

/** How far Next and Previous move: one row, or a whole window. */
export function kdStride(l, count) { return l.show === 'window' && l.stepBy === 'window' ? Math.max(1, Math.round(count) || 1) : 1; }

/**
 * A Next / Previous / Random / Go to / Reset action on a Data layer. `n` is
 * the row count, `offset` the layer's live Offset, `count` its live window
 * size. Returns false for actions it doesn't handle (show, hide, toggle).
 */
export function kdAct(st, l, offset, count, n, a, rand) {
  const cur = () => kdCurrent(st, offset, n);
  const stride = kdStride(l, count);
  switch (a.do) {
    case 'next': st.pos += stride; break;
    case 'prev': st.pos -= stride; break;
    case 'shuffle': {
      if (n < 2) break;
      const c = cur();
      if (stride > 1) {
        // Paging: another page, not another row.
        const pages = Math.ceil(n / stride);
        if (pages < 2) break;
        const here = Math.floor(c / stride);
        let p = Math.floor(rand() * (pages - 1));
        if (p >= here) p++;
        st.pos += p * stride - c;
        break;
      }
      let k = Math.floor(rand() * (n - 1));
      if (k >= c) k++;
      st.pos += k - c;
      break;
    }
    case 'goto': {
      if (!n) break;
      const want = Math.max(0, Math.min(n - 1, Math.round(a.amount || 1) - 1));
      st.pos += want - cur();
      break;
    }
    case 'reset': st.pos = 0; break;
    default: return false;
  }
  if (n > 0) st.pos = ((st.pos % n) + n) % n;
  return true;
}

/**
 * The rows that show for a current row: every row, rows from…to (counting
 * from 1, inclusive; the other way round works too), or `count` rows from the
 * current one (wrapping round the end). At most KD_MAX_MARKS.
 */
export function kdShown(n, show, from, to, current, count) {
  if (!(n > 0)) return [];
  const out = [];
  if (show === 'range') {
    let a = Math.max(1, Math.min(n, Math.round(from) || 1)), b = Math.max(1, Math.min(n, Math.round(to) || n));
    if (a > b) { const t = a; a = b; b = t; }
    for (let i = a - 1; i < b && out.length < KD_MAX_MARKS; i++) out.push(i);
    return out;
  }
  if (show === 'window') {
    const k = Math.max(1, Math.min(n, Math.round(count) || 1));
    for (let i = 0; i < k; i++) out.push(kdWrap(current + i, n));
    return out;
  }
  for (let i = 0; i < n && i < KD_MAX_MARKS; i++) out.push(i);
  return out;
}

/**
 * What shows at `time`: the current row, and one or two sets of rows with an
 * alpha (the outgoing set fading out under the incoming one). A change of the
 * current row starts a crossfade when the layer fades (only when what shows
 * changes: with Show all it doesn't). Calling it twice at one time gives the
 * same answer.
 */
export function kdPlan(st, l, v, n, time) {
  const current = kdCurrent(st, v('offset'), n);
  const count = v('count');
  const key = n > 0 ? (l.show === 'window' ? 'w' + current : l.show === 'range' ? 'r' + Math.round(v('from')) + ':' + Math.round(v('to')) : 'all') : '';
  const duration = Math.max(0, v('duration'));
  if (key !== st.key) {
    const fade = l.transition === 'fade' && duration > 0 && st.started && st.key !== '' && n > 0;
    st.from = fade ? st.cur : -1;
    st.fromKey = fade ? st.key : '';
    st.key = key;
    st.at = time;
    st.started = true;
  }
  st.cur = current;
  let mix = 1;
  if (st.from >= 0) {
    mix = time < st.at ? 1 : Math.min(1, (time - st.at) / Math.max(1e-3, duration));
    if (mix >= 1) st.from = -1;
  }
  const sets = [];
  const rowsFor = c => kdShown(n, l.show, v('from'), v('to'), c, count);
  if (st.from >= 0 && st.from < n) sets.push({ current: st.from, rows: rowsFor(st.from), alpha: 1 - mix });
  if (n > 0) sets.push({ current, rows: rowsFor(current), alpha: st.from >= 0 ? mix : 1 });
  return { current, sets, fading: st.from >= 0 };
}

// ── Columns ──────────────────────────────────────────────────────────────────

export function kdColumn(table, name) {
  if (!table || !name) return null;
  for (const c of table.columns) if (c.name === name) return c;
  return null;
}

const kdCodes = new WeakMap();
/** A category column's values as codes 0, 1, 2… in order of first appearance, and how many there are. */
export function kdCategoryCodes(col) {
  let c = kdCodes.get(col);
  if (c) return c;
  const map = new Map();
  for (const v of col.values) if (v != null && !map.has(v)) map.set(v, map.size);
  c = { map, count: map.size };
  kdCodes.set(col, c);
  return c;
}

/** A number for row i: the value, a category's code, or null. */
export function kdNumber(col, i) {
  if (!col) return null;
  const v = col.values[i];
  if (col.type === 'number') return typeof v === 'number' && isFinite(v) ? v : null;
  if (col.type === 'category') { const k = kdCategoryCodes(col).map.get(v); return k === undefined ? null : k; }
  return null;
}

/** min and max of what kdNumber gives for a column. */
export function kdRange(col) {
  if (!col) return { min: 0, max: 0 };
  if (col.type === 'number') return { min: col.min, max: col.max };
  if (col.type === 'category') return { min: 0, max: Math.max(0, kdCategoryCodes(col).count - 1) };
  return { min: 0, max: 0 };
}

/** Row i of a column as 0…1 over its min…max (0.5 when the column is flat, null when missing). */
export function kdUnit(col, i) {
  const x = kdNumber(col, i);
  if (x === null) return null;
  const r = kdRange(col), span = r.max - r.min;
  return span > 0 ? (x - r.min) / span : 0.5;
}

/** Text for a cell (labels, captions). */
export function kdText(col, i) {
  if (!col) return '';
  const v = col.values[i];
  if (v == null) return '';
  if (typeof v === 'number') return kdFormat(v);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** A number as a short label: up to 3 significant digits after the point, no trailing zeros. */
export function kdFormat(v) {
  if (!isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e6 || (a > 0 && a < 1e-3)) return v.toExponential(1).replace('e+', 'e');
  const d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return String(Number(v.toFixed(d)));
}

// ── Axes ─────────────────────────────────────────────────────────────────────

/**
 * A value's normalised coordinate on an axis.
 *   centred, range  −1 at min, +1 at max (the middle of the frame is the middle of the data)
 *   centred, zero   0 at 0, ±1 at the largest |value| (symmetric: 0 sits in the middle)
 *   corner          0 at min, 1 at max
 * A flat axis puts everything in the middle (centred) or at the start (corner).
 */
export function kdNorm(value, min, max, axes, centre) {
  if (axes === 'corner') { const s = max - min; return s > 0 ? (value - min) / s : 0; }
  if (centre === 'zero') { const m = Math.max(Math.abs(min), Math.abs(max)); return m > 0 ? value / m : 0; }
  const s = max - min;
  return s > 0 ? ((value - min) / s) * 2 - 1 : 0;
}

/** A normalised coordinate as a fraction across the frame (0 = left / bottom, 1 = right / top). */
export function kdFrac(n, axes) { return axes === 'corner' ? n : (n + 1) / 2; }

/** Where 0 sits across the frame on an axis over min…max (clamped into the frame): a bar's baseline. */
export function kdZero(min, max, axes, centre) {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  return Math.max(0, Math.min(1, kdFrac(kdNorm(0, lo, hi, axes, centre), axes)));
}

/**
 * The frame the view fills, in device pixels, y down: the picture (with a
 * margin for labels when the view has them) or the layer's region (x, y its
 * centre 0…1 with y up; w, h in picture heights).
 */
export function kdFrame(l, v, W, H, dpr, labels) {
  if (l.fit === 'region') {
    const w = Math.max(1, v('w') * H), h = Math.max(1, v('h') * H);
    return { left: v('x') * W - w / 2, top: (1 - v('y')) * H - h / 2, w, h };
  }
  const m = Math.min(W, H) * 0.08 + (labels ? 18 * dpr : 0);
  return { left: m, top: m, w: Math.max(1, W - 2 * m), h: Math.max(1, H - 2 * m) };
}

/**
 * The frame shrunk (and centred in it) so a unit across is as long as a unit
 * up: a map or a route keeps its shape on any picture. `xr`, `yr` are the
 * columns' { min, max }; centred on zero, each axis spans twice its largest
 * |value|.
 */
export function kdEqualFrame(frame, xr, yr, axes, centre) {
  const span = r => (axes === 'centred' && centre === 'zero' ? 2 * Math.max(Math.abs(r.min), Math.abs(r.max)) : r.max - r.min);
  const sx = span(xr), sy = span(yr);
  if (!(sx > 0) || !(sy > 0)) return frame;
  const k = Math.min(frame.w / sx, frame.h / sy), w = sx * k, h = sy * k;
  return { left: frame.left + (frame.w - w) / 2, top: frame.top + (frame.h - h) / 2, w, h };
}

/** About `count` round values from min to max (steps of 1, 2 or 5 × 10ⁿ). */
export function kdTicks(min, max, count) {
  if (!(isFinite(min) && isFinite(max)) || max <= min) return isFinite(min) ? [min] : [];
  const raw = (max - min) / Math.max(1, count || 5);
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let t = Math.ceil(min / step - 1e-9) * step; t <= max + step * 1e-9 && out.length < 50; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : Number(t.toPrecision(12)));
  return out;
}

// ── Marks ────────────────────────────────────────────────────────────────────

/** An 0…1 channel from a column: 0…1 as it is, 0…255 divided down, anything else over its min…max. */
function kdChannel(col, i) {
  const x = kdNumber(col, i);
  if (x === null) return 0;
  const r = kdRange(col);
  if (r.min >= 0 && r.max <= 1) return x;
  if (r.min >= 0 && r.max <= 255) return x / 255;
  return kdUnit(col, i);
}

/** A row's colour: the tint, three columns as RGB, or one column through a palette (row order without one). */
export function kdColour(l, table, i, k, of) {
  if (l.colour === 'rgb') {
    const r = kdColumn(table, l.rCol), g = kdColumn(table, l.gCol), b = kdColumn(table, l.bCol);
    if (r || g || b) return [kdChannel(r, i), kdChannel(g, i), kdChannel(b, i)];
    return l.color;
  }
  if (l.colour === 'palette') {
    const c = kdColumn(table, l.colourCol);
    const u = c ? kdUnit(c, i) : of > 1 ? k / (of - 1) : 0;
    return paletteColour(l.palette, (u === null ? 0 : u) * 0.92);
  }
  return l.color;
}

/**
 * Points: one mark per shown row at its x, y columns. Returns
 * [{ row, x, y, r, rgb, a, rot, label }] in pixels. Rows without both
 * numbers are skipped. `px` is the size scale (device pixels per px).
 */
export function kdPointsLayout(table, l, v, frame, rows, px) {
  const xc = kdColumn(table, l.xCol), yc = kdColumn(table, l.yCol);
  if (!xc || !yc) return [];
  const xr = kdRange(xc), yr = kdRange(yc);
  const sc = kdColumn(table, l.sizeCol), oc = kdColumn(table, l.opacityCol), rc = kdColumn(table, l.rotationCol), lc = kdColumn(table, l.labelCol);
  const s0 = v('sizeMin'), s1 = v('sizeMax'), size = v('size');
  const out = [];
  rows.forEach((i, k) => {
    const x = kdNumber(xc, i), y = kdNumber(yc, i);
    if (x === null || y === null) return;
    const fx = kdFrac(kdNorm(x, xr.min, xr.max, l.axes, l.centre), l.axes), fy = kdFrac(kdNorm(y, yr.min, yr.max, l.axes, l.centre), l.axes);
    const su = sc ? kdUnit(sc, i) : null, ou = oc ? kdUnit(oc, i) : null;
    const rot = rc ? kdNumber(rc, i) : 0;
    out.push({
      row: i, x: frame.left + fx * frame.w, y: frame.top + (1 - fy) * frame.h,
      r: Math.max(0.5, (sc ? s0 + (su === null ? 0 : su) * (s1 - s0) : size) * px / 2),
      rgb: kdColour(l, table, i, k, rows.length), a: ou === null ? 1 : 0.15 + 0.85 * ou, rot: rot || 0,
      label: lc && k < KD_MAX_LABELS ? kdText(lc, i) : '',
    });
  });
  return out;
}

/** Path: the shown rows' points in order (as kdPointsLayout), with the path's length so far at each. */
export function kdPathLayout(table, l, v, frame, rows, px) {
  const pts = kdPointsLayout(table, l, v, frame, rows, px);
  let len = 0;
  for (let i = 0; i < pts.length; i++) { if (i) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); pts[i].at = len; }
  return { pts, length: len };
}

/** Where a path is `t` (0…1) of the way along: { x, y, i } (i: the segment it is on), or null. */
export function kdPathPoint(path, t) {
  const pts = path.pts;
  if (!pts.length) return null;
  const want = Math.max(0, Math.min(1, t)) * path.length;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].at >= want) {
      const a = pts[i - 1], b = pts[i], seg = b.at - a.at, u = seg > 0 ? (want - a.at) / seg : 1;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, i: i - 1 };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, i: pts.length - 1 };
}

/**
 * Bars: one per shown row, side by side in row order. The value axis runs
 * over the column's whole min…max with 0 included, so bars keep their size
 * as the rows shown change; they grow from 0. Returns
 * [{ row, x, y, w, h, base, rgb, label, value }] in pixels (y, h: the bar's
 * top and height, y down).
 */
export function kdBarsLayout(table, l, frame, rows) {
  const vc = kdColumn(table, l.valueCol);
  if (!vc || !rows.length) return [];
  const cc = kdColumn(table, l.categoryCol);
  const r = kdRange(vc), lo = Math.min(0, r.min), hi = Math.max(0, r.max);
  const slot = frame.w / rows.length, bw = slot * 0.72;
  const zero = kdZero(r.min, r.max, l.axes, l.centre);
  const baseY = frame.top + (1 - zero) * frame.h;
  return rows.map((i, k) => {
    const x = kdNumber(vc, i);
    const f = x === null ? zero : kdFrac(kdNorm(x, lo, hi, l.axes, l.centre), l.axes);
    const topY = frame.top + (1 - f) * frame.h;
    return {
      row: i, x: frame.left + slot * k + (slot - bw) / 2, w: bw, y: Math.min(topY, baseY), h: Math.abs(baseY - topY), base: baseY,
      rgb: kdColour(l, table, i, k, rows.length), label: cc ? kdText(cc, i) : String(i + 1), value: x,
    };
  });
}

/** Pie: a slice per shown row, sized by |value|, clockwise from 12 o'clock. Returns { cx, cy, r, slices: [{ row, a0, a1, rgb, label, share }] }. */
export function kdPieLayout(table, l, frame, rows) {
  const vc = kdColumn(table, l.valueCol);
  // Room round it for the labels, when it has them.
  const cx = frame.left + frame.w / 2, cy = frame.top + frame.h / 2, rad = (Math.min(frame.w, frame.h) / 2) * (l.labels ? 0.72 : 0.96);
  if (!vc) return { cx, cy, r: rad, slices: [] };
  const cc = kdColumn(table, l.categoryCol);
  let sum = 0;
  for (const i of rows) sum += Math.abs(kdNumber(vc, i) || 0);
  const slices = [];
  let a = -Math.PI / 2;
  rows.forEach((i, k) => {
    const x = Math.abs(kdNumber(vc, i) || 0), share = sum > 0 ? x / sum : 0;
    const a1 = a + share * Math.PI * 2;
    slices.push({ row: i, a0: a, a1, share, label: cc ? kdText(cc, i) : String(i + 1), rgb: l.colour === 'tint' ? l.color : kdColour(l, table, i, k, rows.length), k });
    a = a1;
  });
  return { cx, cy, r: rad, slices };
}

/**
 * Lines: the value column across the frame, one line per value of the
 * category column (the series), or one line through every row without one.
 * x is a row's place in its series. Returns [{ name, rgb, pts: [{ row, x, y }] }].
 */
export function kdLinesLayout(table, l, frame, rows) {
  const vc = kdColumn(table, l.valueCol);
  if (!vc) return [];
  const cc = kdColumn(table, l.categoryCol);
  const r = kdRange(vc);
  const series = new Map();
  for (const i of rows) {
    const x = kdNumber(vc, i);
    if (x === null) continue;
    const name = cc ? kdText(cc, i) : '';
    let s = series.get(name);
    if (!s) { s = { name, rows: [], vals: [] }; series.set(name, s); }
    s.rows.push(i); s.vals.push(x);
  }
  let longest = 1;
  for (const s of series.values()) longest = Math.max(longest, s.rows.length);
  const out = [];
  let k = 0;
  const n = series.size;
  for (const s of series.values()) {
    const rgb = l.colour === 'palette' ? paletteColour(l.palette, n > 1 ? (k / (n - 1)) * 0.92 : 0) : l.colour === 'rgb' ? kdColour(l, table, s.rows[0], k, n) : l.color;
    out.push({
      name: s.name, rgb,
      pts: s.rows.map((row, j) => ({ row, x: frame.left + (longest > 1 ? j / (longest - 1) : 0.5) * frame.w, y: frame.top + (1 - kdFrac(kdNorm(s.vals[j], r.min, r.max, l.axes, l.centre), l.axes)) * frame.h })),
    });
    k++;
  }
  return out;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function kdFont(l, px) { return (l.weight >= 600 ? 600 : 500) + ' ' + Math.round(px) + 'px ' + klFontFor(l); }

/** Axis lines, grid and ticks for the numeric axes a view has (`xr`, `yr`: { min, max } or null). */
function kdDrawAxes(c, l, v, frame, xr, yr, dpr, opts) {
  const col = l.textColor, lw = Math.max(1, dpr);
  const fs = Math.max(6, v('labelSize') * dpr);
  c.save();
  c.lineWidth = lw;
  const X = f => frame.left + f * frame.w, Y = f => frame.top + (1 - f) * frame.h;
  const posX = t => X(kdFrac(kdNorm(t, xr.min, xr.max, l.axes, l.centre), l.axes));
  const posY = t => Y(kdFrac(kdNorm(t, opts.yLo, opts.yHi, l.axes, l.centre), l.axes));
  const xt = xr && xr.max > xr.min ? kdTicks(xr.min, xr.max, 5) : [];
  const yt = yr && yr.max > yr.min ? kdTicks(opts.yLo, opts.yHi, 5) : [];
  if (l.grid) {
    c.strokeStyle = klCss(col, 0.12);
    c.beginPath();
    for (const t of xt) { const x = posX(t); c.moveTo(x, frame.top); c.lineTo(x, frame.top + frame.h); }
    for (const t of yt) { const y = posY(t); c.moveTo(frame.left, y); c.lineTo(frame.left + frame.w, y); }
    c.stroke();
  }
  // The axes: an L at the bottom-left (corner), or a cross through the middle (centred).
  c.strokeStyle = klCss(col, 0.45);
  c.beginPath();
  if (!l.axisLine) { /* no axis lines */ } else if (l.axes === 'corner') {
    c.moveTo(frame.left, frame.top); c.lineTo(frame.left, frame.top + frame.h); c.lineTo(frame.left + frame.w, frame.top + frame.h);
  } else {
    const mx = X(0.5), my = opts.baseY != null ? opts.baseY : Y(0.5);
    if (!opts.noVertical) { c.moveTo(mx, frame.top); c.lineTo(mx, frame.top + frame.h); }
    c.moveTo(frame.left, my); c.lineTo(frame.left + frame.w, my);
  }
  // Bars in the corner grow from 0: its line, when 0 isn't the bottom edge.
  if (l.axisLine && l.axes === 'corner' && opts.baseY != null && opts.baseY < frame.top + frame.h - 1) {
    c.moveTo(frame.left, opts.baseY); c.lineTo(frame.left + frame.w, opts.baseY);
  }
  c.stroke();
  if (l.ticks) {
    c.fillStyle = klCss(col, 0.75);
    c.font = kdFont(l, fs);
    const ax = l.axes === 'corner' ? frame.left : X(0.5), ay = l.axes === 'corner' ? frame.top + frame.h : opts.baseY != null ? opts.baseY : Y(0.5);
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.beginPath(); c.strokeStyle = klCss(col, 0.45);
    for (const t of xt) { const x = posX(t); c.moveTo(x, ay); c.lineTo(x, ay + 4 * dpr); c.fillText(kdFormat(t), x, ay + 6 * dpr); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const t of yt) { const y = posY(t); c.moveTo(ax - 4 * dpr, y); c.lineTo(ax, y); c.fillText(kdFormat(t), ax - 6 * dpr, y); }
    c.stroke();
  }
  c.restore();
}

function kdMark(c, shape, x, y, r, rot) {
  c.beginPath();
  if (shape === 'square' || shape === 'triangle') {
    c.save(); c.translate(x, y); c.rotate((rot * Math.PI) / 180);
    if (shape === 'square') c.rect(-r, -r, r * 2, r * 2);
    else { c.moveTo(0, -r * 1.2); c.lineTo(r * 1.05, r * 0.7); c.lineTo(-r * 1.05, r * 0.7); c.closePath(); }
    c.restore();
  } else c.arc(x, y, r, 0, Math.PI * 2);
}

/**
 * Draw one set of rows of a table view into `c`. `alpha` scales everything
 * (a crossfade); `current` is the current row, marked when `mark` (the others
 * dimmed). Returns where the current row is on the picture (pixels), for the
 * layer's anchor, or null when it isn't drawn.
 */
export function kdDrawTable(c, l, v, table, rows, frame, W, H, dpr, alpha, current, mark) {
  const opacity = v('opacity') * alpha;
  if (!(opacity > 0)) return null;
  const labels = l.labels, fs = Math.max(6, v('labelSize') * dpr);
  const highlight = mark ? current : -1;
  const dim = highlight >= 0 ? 0.45 : 1;
  let at = null;
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  switch (l.view) {
    case 'points': case 'path': {
      const xc = kdColumn(table, l.xCol), yc = kdColumn(table, l.yCol);
      if (!xc || !yc) break;
      const xr = kdRange(xc), yr = kdRange(yc);
      // Same scale: a unit across as long as a unit up (a map, a route).
      if (l.equal) frame = kdEqualFrame(frame, xr, yr, l.axes, l.centre);
      if (l.grid || l.ticks || l.axisLine) { c.globalAlpha = opacity; kdDrawAxes(c, l, v, frame, xr, yr, dpr, { yLo: yr.min, yHi: yr.max }); }
      if (l.view === 'points') {
        const pts = kdPointsLayout(table, l, v, frame, rows, dpr);
        for (const p of pts) {
          const cur = p.row === highlight;
          c.globalAlpha = opacity * p.a * (cur ? 1 : dim);
          c.fillStyle = klCss(p.rgb);
          kdMark(c, l.mark, p.x, p.y, cur && highlight >= 0 ? p.r * 1.6 : p.r, p.rot);
          c.fill();
          if (p.row === current) at = { x: p.x, y: p.y };
          if (cur) { if (highlight >= 0) { c.globalAlpha = opacity; c.strokeStyle = klCss(l.textColor); c.lineWidth = 1.5 * dpr; kdMark(c, l.mark, p.x, p.y, p.r * 1.6 + 3 * dpr, p.rot); c.stroke(); } }
        }
        if (labels) {
          c.font = kdFont(l, fs); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = klCss(l.textColor);
          for (const p of pts) if (p.label) { c.globalAlpha = opacity * (p.row === highlight || highlight < 0 ? 0.9 : 0.5); c.fillText(p.label, p.x + p.r + 4 * dpr, p.y); }
        }
        break;
      }
      const path = kdPathLayout(table, l, v, frame, rows, dpr), pts = path.pts;
      if (pts.length < 1) break;
      const trim = Math.max(0, Math.min(1, v('trim')));
      const head = kdPathPoint(path, trim);
      c.lineWidth = Math.max(0.5, v('lineWidth') * dpr);
      c.globalAlpha = opacity;
      const perSegment = l.colour !== 'tint';
      if (!perSegment) { c.strokeStyle = klCss(l.color); c.beginPath(); c.moveTo(pts[0].x, pts[0].y); }
      for (let i = 1; i < pts.length && head; i++) {
        const last = i > head.i;
        const to = last ? head : pts[i];
        if (perSegment) { c.strokeStyle = klCss(pts[i].rgb); c.beginPath(); c.moveTo(pts[i - 1].x, pts[i - 1].y); c.lineTo(to.x, to.y); c.stroke(); }
        else c.lineTo(to.x, to.y);
        if (last) break;
      }
      if (!perSegment) c.stroke();
      if (head && trim > 0) {
        c.fillStyle = klCss(perSegment ? pts[Math.min(pts.length - 1, head.i + 1)].rgb : l.color);
        c.beginPath(); c.arc(head.x, head.y, Math.max(2, v('lineWidth') * 1.4) * dpr, 0, Math.PI * 2); c.fill();
      }
      // The current row: a ring on its point.
      const cur = pts.find(p => p.row === highlight);
      if (cur) { c.strokeStyle = klCss(l.textColor); c.lineWidth = 1.5 * dpr; c.beginPath(); c.arc(cur.x, cur.y, 6 * dpr, 0, Math.PI * 2); c.stroke(); }
      // A path's anchor is its head: where the drawing-on has got to.
      if (head) at = { x: head.x, y: head.y };
      if (labels) {
        c.font = kdFont(l, fs); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = klCss(l.textColor);
        for (const p of pts) if (p.label && p.at <= trim * path.length + 0.5) { c.globalAlpha = opacity * 0.85; c.fillText(p.label, p.x + 6 * dpr, p.y); }
      }
      break;
    }
    case 'bars': {
      const vc = kdColumn(table, l.valueCol);
      if (!vc) break;
      const bars = kdBarsLayout(table, l, frame, rows);
      const r = kdRange(vc);
      c.globalAlpha = opacity;
      kdDrawAxes(c, l, v, frame, null, r, dpr, { yLo: Math.min(0, r.min), yHi: Math.max(0, r.max), baseY: bars.length ? bars[0].base : null, noVertical: true });
      for (const b of bars) {
        const cur = b.row === highlight;
        c.globalAlpha = opacity * (cur ? 1 : dim);
        c.fillStyle = klCss(b.rgb);
        const rr = Math.min(b.w / 2, 4 * dpr, b.h);
        c.beginPath();
        if (c.roundRect && rr > 0.5) c.roundRect(b.x, b.y, b.w, Math.max(0.5, b.h), b.y < b.base ? [rr, rr, 0, 0] : [0, 0, rr, rr]); else c.rect(b.x, b.y, b.w, Math.max(0.5, b.h));
        c.fill();
        if (b.row === current) at = { x: b.x + b.w / 2, y: b.y };
      }
      if (labels && bars.length <= 200) {
        c.font = kdFont(l, fs); c.fillStyle = klCss(l.textColor); c.textAlign = 'center';
        const slotW = frame.w / bars.length;
        for (const b of bars) {
          c.globalAlpha = opacity * (b.row === highlight || highlight < 0 ? 0.9 : 0.55);
          const up = b.y < b.base || b.h < 1;
          c.textBaseline = up ? 'top' : 'bottom';
          const name = b.label;
          // Names under the bars (above them when they hang down), values at their ends.
          const nameY = up ? b.base + 5 * dpr : b.base - 5 * dpr;
          if (name && c.measureText(name).width <= slotW * 1.4) c.fillText(name, b.x + b.w / 2, nameY);
          if (b.value !== null) { c.textBaseline = up ? 'bottom' : 'top'; c.fillText(kdFormat(b.value), b.x + b.w / 2, up ? b.y - 4 * dpr : b.y + b.h + 4 * dpr); }
        }
      }
      break;
    }
    case 'pie': {
      const pie = kdPieLayout(table, l, frame, rows);
      const n = pie.slices.length;
      for (const s of pie.slices) {
        if (!(s.a1 > s.a0)) continue;
        const cur = s.row === highlight;
        const mid = (s.a0 + s.a1) / 2, out = cur ? pie.r * 0.06 : 0;
        const cx = pie.cx + Math.cos(mid) * out, cy = pie.cy + Math.sin(mid) * out;
        c.globalAlpha = opacity * (l.colour === 'tint' ? 1 - 0.65 * (n > 1 ? s.k / (n - 1) : 0) : 1) * (cur ? 1 : highlight >= 0 ? 0.7 : 1);
        c.fillStyle = klCss(s.rgb);
        c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, pie.r, s.a0, s.a1); c.closePath(); c.fill();
        if (n > 1) { c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = Math.max(1, dpr); c.stroke(); }
        if (s.row === current) at = { x: pie.cx + Math.cos(mid) * pie.r * 0.6, y: pie.cy + Math.sin(mid) * pie.r * 0.6 };
      }
      if (labels) {
        c.font = kdFont(l, fs); c.fillStyle = klCss(l.textColor); c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const s of pie.slices) {
          if (s.share < 0.03) continue;
          const mid = (s.a0 + s.a1) / 2, rr = pie.r * 1.12;
          c.globalAlpha = opacity * 0.9;
          c.textAlign = Math.cos(mid) > 0.2 ? 'left' : Math.cos(mid) < -0.2 ? 'right' : 'center';
          c.fillText(s.label + ' · ' + Math.round(s.share * 100) + '%', pie.cx + Math.cos(mid) * rr, pie.cy + Math.sin(mid) * rr);
        }
      }
      break;
    }
    case 'lines': {
      const vc = kdColumn(table, l.valueCol);
      if (!vc) break;
      const r = kdRange(vc);
      c.globalAlpha = opacity;
      kdDrawAxes(c, l, v, frame, null, r, dpr, { yLo: r.min, yHi: r.max, noVertical: true });
      const lines = kdLinesLayout(table, l, frame, rows);
      const trim = Math.max(0, Math.min(1, v('trim')));
      c.lineWidth = Math.max(0.5, v('lineWidth') * dpr);
      for (const s of lines) {
        const pts = s.pts;
        if (!pts.length) continue;
        const upto = trim * (pts.length - 1);
        c.globalAlpha = opacity;
        c.strokeStyle = klCss(s.rgb);
        c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
        let end = pts[0];
        for (let i = 1; i < pts.length; i++) {
          if (i <= upto) { c.lineTo(pts[i].x, pts[i].y); end = pts[i]; continue; }
          const u = upto - (i - 1);
          if (u > 0) { end = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u }; c.lineTo(end.x, end.y); }
          break;
        }
        c.stroke();
        const cur = pts.find(p => p.row === highlight);
        if (cur) { c.fillStyle = klCss(s.rgb); c.beginPath(); c.arc(cur.x, cur.y, 4 * dpr, 0, Math.PI * 2); c.fill(); c.strokeStyle = klCss(l.textColor); c.lineWidth = 1.5 * dpr; c.stroke(); c.lineWidth = Math.max(0.5, v('lineWidth') * dpr); }
        const here = pts.find(p => p.row === current);
        if (here) at = { x: here.x, y: here.y };
        if (labels && s.name) { c.font = kdFont(l, fs); c.fillStyle = klCss(s.rgb); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(s.name, end.x + 6 * dpr, end.y); }
      }
      break;
    }
  }
  c.restore();
  return at;
}

/** Wrap text into lines no wider than `maxW` (in the font already set on `c`); explicit new lines stay. */
export function kdWrapText(c, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line && c.measureText(next.trimEnd()).width > maxW && w.trim()) { out.push(line.trimEnd()); line = w.trimStart(); }
      else line = next;
    }
    out.push(line.trimEnd());
  }
  return out.join('\n');
}

/** A text chunk (or a window of them) as it shows: joined, with counts when the layer shows them. */
export function kdChunkText(l, items, counts, rows) {
  const j = kdJoiner(l.split);
  const list = rows.slice(0, KD_MAX_TEXT_ALL).map(i => (l.counts ? items[i] + ' · ' + counts[i] : items[i]));
  return l.counts && j !== '\n' ? list.join('\n') : list.join(j);
}

// ── s.data() for Script layers ──────────────────────────────────────────────

const kdViews = new WeakMap();
/**
 * What a Script layer's s.data(name) returns, less the current row (the host
 * adds index and current). Cached per result, so reading it every frame is
 * cheap. `items` are a text dataset's chunks (as the Data layer showing it
 * splits them; lines without one).
 */
export function kdScriptView(entry, items) {
  const r = entry.result;
  const hit = r && typeof r === 'object' ? kdViews.get(r) : null;
  if (hit && hit.items === items) return hit.view;
  const view = { name: entry.name, id: entry.id, kind: r ? r.kind : 'none', rows: [], columns: [], length: 0 };
  const cols = new Map();
  if (r && r.kind === 'table') {
    view.columns = r.columns.map(c => c.name);
    for (const c of r.columns) cols.set(c.name, c);
    const rows = new Array(r.rows);
    for (let i = 0; i < r.rows; i++) { const o = {}; for (const c of r.columns) o[c.name] = c.values[i] == null ? null : c.values[i]; rows[i] = o; }
    view.rows = rows;
  } else if (r && r.kind === 'text') {
    view.text = r.text;
    view.rows = items || kdSplit(r.text, 'lines');
    view.columns = ['text'];
  } else if (r && r.kind === 'json') {
    view.value = r.value;
    view.rows = Array.isArray(r.value) ? r.value : [];
  }
  view.length = view.rows.length;
  view.col = name => { const c = cols.get(name); return c ? c.values.slice() : view.kind === 'text' && name === 'text' ? view.rows.slice() : []; };
  view.min = name => { const c = cols.get(name); return c && c.type === 'number' ? c.min : 0; };
  view.max = name => { const c = cols.get(name); return c && c.type === 'number' ? c.max : 0; };
  if (r && typeof r === 'object') kdViews.set(r, { items, view });
  return view;
}
