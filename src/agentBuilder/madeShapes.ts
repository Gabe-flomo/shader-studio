/**
 * madeShapes.ts — shapes made on the live picture in the Agent Builder's Where picker
 * (docs/agent-builder.md "Where"). Pure.
 *
 * A shape made here is a real node: an Expression Block ("Where: circle") that returns the shape's
 * signed distance (below 0 inside), with a note. Its place and size are the block's sliders (cx,
 * cy, r…), so dragging its handles on the picture writes uniforms (no recompile, and the walkers
 * aren't started over); only its kind of outline (a polygon's corners, a word's letters) is in its
 * lines. The spec is kept on the node (`whereShape`), so the builder reads it back and shows the
 * handles again; a block whose lines were edited by hand is just a graph output.
 *
 *   circle   length(uv − c) − r
 *   box      a box's exact distance, half-sizes (w, h)
 *   ring     |length(uv − c) − r| − t (a band t either side of the circle)
 *   polygon  Inigo Quilez's polygon distance, one line per edge, corners p0…p7 (sliders)
 *   text     a monoline stroke font (strokeFont.ts): segments, arcs and dots, joined with min, less
 *            the strokes' half-weight wt (centre c, height 2·s). Older text kept the 5 × 7 pixel font
 *            (`font: 'blocky'`: each run of lit pixels a box), which still loads and draws.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { DEFAULT_WEIGHT, STROKE_GLYPHS, layoutStrokes, strokeGlsl, textDistance } from './strokeFont';

export type MadeShapeKind = 'circle' | 'box' | 'ring' | 'polygon' | 'text';
export type TextFont = 'stroke' | 'blocky';
export interface MadeShape {
  shape: MadeShapeKind;
  /** Its centre (picture units: x ±aspect across, y ±1 up). */
  x: number; y: number;
  /** circle / ring: radius; box: half-width; text: half its height. */
  size: number;
  /** box: half-height. */
  h?: number;
  /** ring: half its thickness. */
  thickness?: number;
  /** text: the words (A–Z, 0–9, a few marks; up to MAX_TEXT). */
  text?: string;
  /** text: the smooth stroke font (new text) or the 5 × 7 pixel font (text made before it; still loads). */
  font?: TextFont;
  /** text, stroke font: the strokes' half-weight, in the letters' units (they are 2 tall). */
  weight?: number;
  /** polygon: its corners (3–8), picture units. */
  points?: Array<[number, number]>;
}

export const MADE_SHAPES: ReadonlyArray<{ kind: MadeShapeKind; label: string; hint: string }> = [
  { kind: 'circle', label: 'Circle', hint: 'A circle: drag its middle to move it, its edge to size it.' },
  { kind: 'box', label: 'Box', hint: 'A box: drag its middle, its corner for the size.' },
  { kind: 'ring', label: 'Ring', hint: 'A band round a circle: drag its edge for the radius, the inner handle for the width.' },
  { kind: 'polygon', label: 'Polygon', hint: 'Corners you drag; click a side\'s middle for another corner.' },
  { kind: 'text', label: 'Text', hint: 'Words in smooth letters: drag them, their corner for the size; type the words, the weight and the size in the card.' },
];
export const MAX_POLY = 8;
export const MAX_TEXT = 16;

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** A new shape of a kind at (x, y), sized `size` (a sensible default). */
export function newMadeShape(kind: MadeShapeKind, x = 0, y = 0, size = 0.35): MadeShape {
  switch (kind) {
    case 'circle': return { shape: kind, x, y, size };
    case 'box': return { shape: kind, x, y, size, h: size * 0.7 };
    case 'ring': return { shape: kind, x, y, size, thickness: Math.max(0.02, size * 0.15) };
    case 'polygon': {
      const pts: Array<[number, number]> = [0, 1, 2, 3, 4].map(i => {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
        return [r4(x + Math.cos(a) * size), r4(y + Math.sin(a) * size)];
      });
      return { shape: kind, x, y, size, points: pts };
    }
    case 'text': return { shape: kind, x, y, size: Math.min(size, 0.2), text: 'HELLO', font: 'stroke', weight: DEFAULT_WEIGHT };
  }
}

/** A shape read from saved data (never throws), or null when it isn't one. */
export function normalizeMadeShape(raw: unknown): MadeShape | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<MadeShape>;
  if (!MADE_SHAPES.some(s => s.kind === r.shape)) return null;
  const kind = r.shape as MadeShapeKind;
  const base = newMadeShape(kind, num(r.x, 0), num(r.y, 0), Math.max(0.005, num(r.size, 0.35)));
  if (kind === 'box') base.h = Math.max(0.005, num(r.h, base.h!));
  if (kind === 'ring') base.thickness = Math.max(0.002, num(r.thickness, base.thickness!));
  if (kind === 'text') {
    // Text saved before the stroke font has no `font`: it keeps its blocky letters.
    base.font = r.font === 'stroke' ? 'stroke' : 'blocky';
    if (base.font === 'stroke') base.weight = Math.min(0.6, Math.max(0.01, num(r.weight, DEFAULT_WEIGHT)));
    else delete base.weight;
    base.text = cleanText(typeof r.text === 'string' ? r.text : base.text!, base.font);
  }
  if (kind === 'polygon') {
    const pts = Array.isArray(r.points) ? r.points.filter(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && isFinite(v))).slice(0, MAX_POLY) as Array<[number, number]> : [];
    if (pts.length >= 3) base.points = pts.map(p => [p[0], p[1]]);
  }
  return base;
}

/** The words as the font can draw them: upper case, known characters, up to MAX_TEXT. */
export function cleanText(t: string, font: TextFont = 'blocky'): string {
  const glyphs: Record<string, unknown> = font === 'stroke' ? STROKE_GLYPHS : FONT;
  const s = t.toUpperCase().split('').filter(c => c in glyphs).join('').slice(0, MAX_TEXT);
  return s.trim() ? s : 'A';
}
const fontOf = (s: MadeShape): TextFont => (s.font === 'stroke' ? 'stroke' : 'blocky');

/** A text shape's half-width, in picture units (for its size handle and its outline). */
export function textHalfWidth(s: MadeShape): number {
  if (fontOf(s) === 'stroke') return (layoutStrokes(cleanText(s.text ?? 'A', 'stroke')).halfWidth + (s.weight ?? DEFAULT_WEIGHT)) * s.size;
  return textBoxes(s.text ?? 'A').reduce((m, b) => Math.max(m, b.x + b.hx), 0) * s.size;
}

// ── A 5 × 7 pixel font (rows top to bottom, 5 bits each, left bit first) ────────

const FONT: Record<string, string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
};

/**
 * The word's lit pixels as boxes in the text's own units (its height is 2: y −1…1, one pixel 2/7),
 * one box per run of lit pixels in a row: centre (x, y) and half-size (hx, hy).
 */
export function textBoxes(text: string): Array<{ x: number; y: number; hx: number; hy: number }> {
  const t = cleanText(text);
  const px = 2 / 7;
  const width = t.length * 6 - 1; // pixels across, a gap of one between letters
  const out: Array<{ x: number; y: number; hx: number; hy: number }> = [];
  t.split('').forEach((ch, k) => {
    const g = FONT[ch];
    g.forEach((row, ry) => {
      let c = 0;
      while (c < 5) {
        if (row[c] !== '1') { c++; continue; }
        let e = c;
        while (e + 1 < 5 && row[e + 1] === '1') e++;
        const x0 = k * 6 + c, x1 = k * 6 + e + 1;
        out.push({ x: ((x0 + x1) / 2 - width / 2) * px, y: (3.5 - (ry + 0.5)) * px, hx: ((x1 - x0) / 2) * px, hy: px / 2 });
        c = e + 1;
      }
    });
  });
  return out;
}
/** The word's width ÷ its height (2 units tall). */
export const textAspect = (text: string) => (cleanText(text).length * 6 - 1) / 7;

// ── The node ─────────────────────────────────────────────────────────────────

const glf = (v: number) => { const s = String(Math.round(v * 1e6) / 1e6); return /[.e]/.test(s) ? s : `${s}.0`; };

/** The block's sliders (name, value, range) for a shape: what dragging writes. */
export function shapeSliders(s: MadeShape): Array<{ name: string; value: number; min: number; max: number }> {
  const out = [
    { name: 'cx', value: s.x, min: -2, max: 2 },
    { name: 'cy', value: s.y, min: -1.2, max: 1.2 },
  ];
  if (s.shape === 'circle' || s.shape === 'ring') out.push({ name: 'r', value: s.size, min: 0.005, max: 2 });
  if (s.shape === 'box') out.push({ name: 'w', value: s.size, min: 0.005, max: 2 }, { name: 'h', value: s.h ?? s.size, min: 0.005, max: 2 });
  if (s.shape === 'ring') out.push({ name: 't', value: s.thickness ?? 0.05, min: 0.002, max: 1 });
  if (s.shape === 'text') out.push({ name: 's', value: s.size, min: 0.01, max: 1 });
  if (s.shape === 'text' && fontOf(s) === 'stroke') out.push({ name: 'wt', value: s.weight ?? DEFAULT_WEIGHT, min: 0.01, max: 0.6 });
  if (s.shape === 'polygon') (s.points ?? []).forEach((p, i) => out.push({ name: `p${i}x`, value: p[0] - s.x, min: -3, max: 3 }, { name: `p${i}y`, value: p[1] - s.y, min: -2, max: 2 }));
  return out.map(o => ({ ...o, value: r4(o.value) }));
}

/** The block's lines, result and each line's why: they depend only on the kind of outline. */
export function shapeLines(s: MadeShape): { lines: Array<{ lhs: string; op: string; rhs: string; why: string }>; result: string; why: string } {
  const lines: Array<{ lhs: string; op: string; rhs: string; why: string }> = [];
  const add = (lhs: string, rhs: string, why: string, op = '=') => lines.push({ lhs, op, rhs, why });
  add('vec2 q', 'uv - vec2(cx, cy)', 'q: this point seen from the shape\'s centre (cx, cy: its sliders, dragged on the picture).');
  switch (s.shape) {
    case 'circle': return { lines, result: 'length(q) - r', why: 'result: how far outside the circle of radius r (below 0 inside).' };
    case 'box':
      add('vec2 d', 'abs(q) - vec2(w, h)', 'd: how far past the box\'s sides it is, across and up (w, h: its half-width and half-height).');
      return { lines, result: 'length(max(d, 0.0)) + min(max(d.x, d.y), 0.0)', why: 'result: the distance to the box (below 0 inside).' };
    case 'ring': return { lines, result: 'abs(length(q) - r) - t', why: 'result: how far from a band t wide either side of the circle of radius r (below 0 in the band).' };
    case 'text': {
      add('q', 'q / s', 'q: scaled so the letters are 2 tall (s: half their height).', '=');
      if (fontOf(s) === 'stroke') {
        const words = cleanText(s.text ?? 'A', 'stroke');
        add('float d', '1e5', 'd: the nearest stroke so far (none yet).');
        for (const st of layoutStrokes(words).strokes) add('d', `min(d, ${strokeGlsl(st)})`, st.k === 'A' ? 'd: and each curve of the letters (an arc: on its circle within its angles, else its nearer end).' : st.k === 'P' ? 'd: and each dot.' : 'd: and each straight stroke of the letters (the nearest point of a segment).');
        return { lines, result: '(d - wt) * s', why: `result: how far from the letters "${words}" (below 0 on them: wt is the strokes' half-weight), in picture units.` };
      }
      add('float d', '1e5', 'd: the nearest lit pixel so far (none yet).');
      for (const b of textBoxes(s.text ?? 'A')) add('d', `min(d, max(abs(q.x - ${glf(b.x)}) - ${glf(b.hx)}, abs(q.y - ${glf(b.y)}) - ${glf(b.hy)}))`, 'd: and each run of lit pixels of the letters (a box).');
      return { lines, result: 'd * s', why: `result: how far from the letters "${cleanText(s.text ?? 'A')}" (below 0 on them), in picture units.` };
    }
    case 'polygon': {
      const k = (s.points ?? []).length;
      add('float d', 'dot(q - vec2(p0x, p0y), q - vec2(p0x, p0y))', 'd: the squared distance to the nearest edge so far (the first corner to start).');
      add('float sg', '1.0', 'sg: +1 outside, flipped each time an edge crosses the line through q (inside: −1).');
      for (let i = 0, j = k - 1; i < k; j = i, i++) {
        const vi = `vec2(p${i}x, p${i}y)`, vj = `vec2(p${j}x, p${j}y)`;
        add(`vec2 e${i}`, `${vj} - ${vi}`, `e${i}: the edge from corner ${i + 1} to corner ${j + 1}.`);
        add(`vec2 w${i}`, `q - ${vi}`, `w${i}: q from corner ${i + 1}.`);
        add(`vec2 b${i}`, `w${i} - e${i} * clamp(dot(w${i}, e${i}) / dot(e${i}, e${i}), 0.0, 1.0)`, `b${i}: from the nearest point of that edge to q.`);
        add('d', `min(d, dot(b${i}, b${i}))`, 'd: the nearest edge so far.');
        add('sg', `(q.y >= ${vi}.y) == (q.y < ${vj}.y) && ((e${i}.x * w${i}.y > e${i}.y * w${i}.x) == (q.y >= ${vi}.y)) ? -sg : sg`, 'sg: flipped when the edge crosses the line through q on one side (even-odd: inside after an odd number).');
      }
      return { lines, result: 'sg * sqrt(d)', why: 'result: the distance to the polygon\'s outline, below 0 inside.' };
    }
  }
}

const LABEL: Record<MadeShapeKind, string> = { circle: 'circle', box: 'box', ring: 'ring', polygon: 'polygon', text: 'text' };
/** "Circle", "Text "HI"". */
export function madeShapeName(s: MadeShape): string {
  const l = LABEL[s.shape];
  return s.shape === 'text' ? `Text "${cleanText(s.text ?? 'A', fontOf(s))}"` : l[0].toUpperCase() + l.slice(1);
}

/** The node's params for a shape (its lines, sliders, label, note and the spec it is read back from). */
export function madeShapeParams(s: MadeShape, use?: string): Record<string, unknown> {
  const { lines, result, why } = shapeLines(s);
  const sliders = shapeSliders(s);
  const name = madeShapeName(s);
  return {
    label: `Where: ${name.toLowerCase()}`,
    inputs: [{ name: 'uv', type: 'vec2', slider: null }, ...sliders.map(x => ({ name: x.name, type: 'float', slider: { min: x.min, max: x.max } }))],
    ...Object.fromEntries(sliders.map(x => [x.name, x.value])),
    outputType: 'float',
    lines: lines.map(l => ({ lhs: l.lhs, op: l.op, rhs: l.rhs })),
    result, expr: result,
    whereShape: s,
    __comment: [
      `Where: ${name.toLowerCase()} (an Expression Block, made in the Agent Builder's Where picker${use ? ` for ${use}` : ''}): the shape's signed distance, below 0 inside it. Drag it on the Agent Builder's picture, or move its sliders.`,
      'uv: where this is read (inside an Agents group: where each walker stands).',
      ...lines.filter((l, i) => lines.findIndex(m => m.why === l.why) === i).map(l => l.why),
      why,
    ].join('\n'),
  };
}

/** A new node for a shape made here (id, place on the canvas). */
export function madeShapeNode(id: string, s: MadeShape, x: number, y: number, use?: string): GraphNode {
  const node = n('exprNode', id, x, y, madeShapeParams(s, use));
  const sliders = shapeSliders(s);
  node.inputs = {
    uv: { type: 'vec2', label: 'uv (vec2)' },
    ...Object.fromEntries(sliders.map(x => [x.name, { type: 'float', label: `${x.name} (float)` }])),
  } as GraphNode['inputs'];
  node.outputs = { result: { type: 'float', label: 'Result (float)' } };
  return node;
}

/**
 * The shape a node holds, read back with its sliders' current values: an Expression Block made here
 * whose lines are still the ones it was made with (else null: it was edited, now any graph output).
 */
export function readMadeShape(node: GraphNode | undefined): MadeShape | null {
  if (!node || node.type !== 'exprNode') return null;
  const s = normalizeMadeShape(node.params.whereShape);
  if (!s) return null;
  const P = node.params;
  const val = (k: string, d: number) => num(P[k], d);
  const live: MadeShape = { ...s, x: val('cx', s.x), y: val('cy', s.y) };
  if (s.shape === 'circle' || s.shape === 'ring') live.size = val('r', s.size);
  if (s.shape === 'box') { live.size = val('w', s.size); live.h = val('h', s.h ?? s.size); }
  if (s.shape === 'ring') live.thickness = val('t', s.thickness ?? 0.05);
  if (s.shape === 'text') live.size = val('s', s.size);
  if (s.shape === 'text' && fontOf(s) === 'stroke') live.weight = val('wt', s.weight ?? DEFAULT_WEIGHT);
  if (s.shape === 'polygon') live.points = (s.points ?? []).map((p, i) => [r4(live.x + val(`p${i}x`, p[0] - s.x)), r4(live.y + val(`p${i}y`, p[1] - s.y))]);
  const want = shapeLines(live);
  const lines = (P.lines as Array<{ lhs: string; op: string; rhs: string }> | undefined) ?? [];
  const same = lines.length === want.lines.length && lines.every((l, i) => l.lhs === want.lines[i].lhs && (l.op || '=') === want.lines[i].op && l.rhs === want.lines[i].rhs) && P.result === want.result;
  return same ? live : null;
}

/**
 * The patch that moves or reshapes a made shape: its sliders only when the outline is the same kind
 * (a uniform write: no recompile), else its whole params (a polygon's corners added, a new word).
 */
export function madeShapePatch(node: GraphNode, next: MadeShape): Record<string, unknown> {
  const was = readMadeShape(node);
  const sameOutline = was && was.shape === next.shape && (next.shape !== 'polygon' || (was.points?.length ?? 0) === (next.points?.length ?? 0)) && (next.shape !== 'text' || (fontOf(was) === fontOf(next) && cleanText(was.text ?? '', fontOf(was)) === cleanText(next.text ?? '', fontOf(next))));
  if (sameOutline) {
    // Keep the stored spec's outline (its corners' count, its word), the place and size in the sliders.
    return { ...Object.fromEntries(shapeSliders(next).map(x => [x.name, x.value])), whereShape: { ...next } };
  }
  return madeShapeParams(next);
}

// ── Geometry for drawing it over the picture ─────────────────────────────────

/** Inside the shape at (px, py)? (the same as the block's sign, for the tests and hit tests). */
export function madeShapeDistance(s: MadeShape, px: number, py: number): number {
  const qx = px - s.x, qy = py - s.y;
  switch (s.shape) {
    case 'circle': return Math.hypot(qx, qy) - s.size;
    case 'ring': return Math.abs(Math.hypot(qx, qy) - s.size) - (s.thickness ?? 0.05);
    case 'box': {
      const dx = Math.abs(qx) - s.size, dy = Math.abs(qy) - (s.h ?? s.size);
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
    }
    case 'text': {
      const sc = Math.max(s.size, 1e-4);
      if (fontOf(s) === 'stroke') return textDistance(cleanText(s.text ?? 'A', 'stroke'), qx / sc, qy / sc, s.weight ?? DEFAULT_WEIGHT) * sc;
      let d = 1e5;
      for (const b of textBoxes(s.text ?? 'A')) d = Math.min(d, Math.max(Math.abs(qx / sc - b.x) - b.hx, Math.abs(qy / sc - b.y) - b.hy));
      return d * sc;
    }
    case 'polygon': {
      const v = s.points ?? [];
      if (v.length < 3) return 1;
      let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2, sg = 1;
      for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
        const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1], wx = px - v[i][0], wy = py - v[i][1];
        const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / Math.max(ex * ex + ey * ey, 1e-12)));
        const bx = wx - ex * t, by = wy - ey * t;
        d = Math.min(d, bx * bx + by * by);
        const c1 = py >= v[i][1], c2 = py < v[j][1], c3 = ex * wy > ey * wx;
        if (c1 === c2 && c3 === c1) sg = -sg;
      }
      return sg * Math.sqrt(d);
    }
  }
}
