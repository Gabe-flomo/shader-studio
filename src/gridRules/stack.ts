/**
 * stack.ts — stacked rules on a base (docs/grid-rules.md "Stacked rules", docs/simulation-builder-plan.md
 * phase 1). A Grid Rules node of a whole-number kind (Count, Stages, Stencils) can carry, after its
 * own rule (the base), up to MAX_STACK rule cards, run in order every step:
 *
 *   base (Life, Brian's Brain, Wireworld…) → card 1 → card 2 → …
 *
 * Each card sees the board the one before it made (the base's step, then card 1's…), so the order
 * matters: a later card has the last word on the cells it touches. The cards:
 *
 *  - **explode** (cells meet): a live cell with `lo`…`hi` live neighbours (1…1: two cells touching
 *    and nothing else) explodes: the empty cells `distance` away in the first `copies` of eight
 *    directions become `becomes`; the meeting cells vanish (unless `keep`).
 *  - **crowd** (too many neighbours): a live cell with at least `lo` live neighbours dies, or
 *    (`move`) steps one cell away from them (the opposite of where its neighbours sit), into an empty
 *    cell.
 *  - **drift** (a direction): every live cell (`any`: every cell that isn't empty) steps one cell in
 *    `dir` (N, NE, E… clockwise) when the cell there is empty.
 *  - **cluster** (a big clump): a live cell with at least `lo` live cells within `radius` (a square,
 *    itself not counted) becomes `becomes` (0: it dies).
 *
 * "Live" is state 1, as the base counts it. Every card has a **chance**: rolled per cell (for
 * explode, per meeting cell; for a move, per moving cell) and step with the whole-number dice of
 * gridRules/dice.ts, so the GPU and the try board's CPU roll the same numbers and make the same
 * board (gridRulesStack.test.ts).
 *
 * On the GPU the cards are stages of the board Pass (compiler/gridRulesExpand.ts): its Repeat is
 * Steps × (1 + cards), and the Pass's Step uniform says which stage a draw is (0 the base, k card
 * k). The base marks the board's blue with +2 on a frame it stepped (not on a frame Speed skips or a
 * new deal), so a card acts only after a real step. Each stage reads the one before through the
 * Pass's Previous: one Pass, however many cards.
 *
 * Stored in the node's params as `stack` (an array, baked into the GLSL like Stencils: an edit
 * recompiles). Gathered, not scattered: each cell works out its own next state from what is round
 * it, as a fragment shader must. Where two movers aim at one empty cell, it takes one of them (the
 * other is lost); explode's copies only land on empty cells.
 */
import type { CpuBoard } from './cpu';
import { grDice } from './dice';

export type StackKind = 'explode' | 'crowd' | 'drift' | 'cluster';

export interface StackRule {
  kind: StackKind;
  /** Chance it fires where it can, 0–1 (rolled per cell and step). */
  chance: number;
  off?: boolean;
  /** explode: the live-neighbour counts that make a meeting (lo…hi); crowd and cluster: at least lo. */
  lo: number;
  hi: number;
  /** explode: how many copies (1–8: N, S, E, W, then the diagonals). */
  copies: number;
  /** explode: how far from the meeting cell the copies land (1–4). */
  distance: number;
  /** explode: the state of the copies; cluster: the state a clumped cell becomes (0 dies). */
  becomes: number;
  /** explode: the meeting cells stay (else they vanish). */
  keep: boolean;
  /** crowd: step away from the crowd instead of dying. */
  move: boolean;
  /** drift: the direction (an index in DIRECTIONS). */
  dir: number;
  /** drift: every cell that isn't empty moves (else only live ones). */
  any: boolean;
  /** cluster: how far round the cell is counted (1–4). */
  radius: number;
}

/** Most cards on a base. */
export const MAX_STACK = 4;
/** Most explode copies, distance, cluster radius. */
export const MAX_COPIES = 8, MAX_DISTANCE = 4, MAX_CLUSTER_RADIUS = 4;
/** Salt of card j's dice (Blocks use 31…, Jitter 41). */
export const stackSalt = (j: number) => 51 + j * 2;

/** The eight directions (x right, y up), clockwise from up: drift's choices. */
export const DIRECTIONS: Array<{ key: string; label: string; d: [number, number] }> = [
  { key: 'n', label: 'Up', d: [0, 1] }, { key: 'ne', label: 'Up right', d: [1, 1] }, { key: 'e', label: 'Right', d: [1, 0] }, { key: 'se', label: 'Down right', d: [1, -1] },
  { key: 's', label: 'Down', d: [0, -1] }, { key: 'sw', label: 'Down left', d: [-1, -1] }, { key: 'w', label: 'Left', d: [-1, 0] }, { key: 'nw', label: 'Up left', d: [-1, 1] },
];
/** Explode's copies in order: the four sides first, then the corners (2 copies: up and down). */
export const COPY_DIRS: Array<[number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
/** The 8 round a cell (as spec.ts MOORE_OFFSETS, kept here so this file reads nothing of spec.ts). */
const MOORE: Array<[number, number]> = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];

export const STACK_KINDS: Array<{ kind: StackKind; label: string; when: string; hint: string }> = [
  { kind: 'explode', label: 'Cells meet → explode', when: 'collisions', hint: 'Where live cells meet (two touching, nothing else round them), they burst into copies around them.' },
  { kind: 'crowd', label: 'Too crowded → die or move', when: 'crowding', hint: 'A live cell with too many live neighbours dies, or steps away from them.' },
  { kind: 'drift', label: 'Drift in a direction', when: 'direction', hint: 'Cells step one cell a step in a direction, where the way is clear.' },
  { kind: 'cluster', label: 'Big clusters change', when: 'clusters', hint: 'A live cell in a big clump (many live cells near it) changes state, or dies.' },
];

/** A new card of a kind, with settings that show something on Life straight away. */
export function newStackRule(kind: StackKind): StackRule {
  const base: StackRule = { kind, chance: 1, lo: 1, hi: 1, copies: 4, distance: 2, becomes: 1, keep: false, move: false, dir: 2, any: false, radius: 2 };
  if (kind === 'explode') return { ...base, chance: 0.5 };
  if (kind === 'crowd') return { ...base, lo: 5 };
  if (kind === 'drift') return { ...base, chance: 0.3 };
  return { ...base, lo: 14, becomes: 0 };
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : d;
  return Math.max(lo, Math.min(hi, n));
};

/** The cards stored in params.stack, every field filled and in range. */
export function readStack(v: unknown): StackRule[] {
  if (!Array.isArray(v)) return [];
  return v.filter(r => r && typeof r === 'object' && STACK_KINDS.some(k => k.kind === (r as StackRule).kind)).slice(0, MAX_STACK).map(r => {
    const x = r as Partial<StackRule>;
    const d = newStackRule(x.kind as StackKind);
    const loMax = x.kind === 'cluster' ? (2 * MAX_CLUSTER_RADIUS + 1) ** 2 - 1 : 8;
    const lo = clampInt(x.lo, 0, loMax, d.lo);
    return {
      kind: d.kind,
      chance: typeof x.chance === 'number' && isFinite(x.chance) ? Math.max(0, Math.min(1, x.chance)) : d.chance,
      lo, hi: Math.max(lo, clampInt(x.hi, 0, 8, d.hi)),
      copies: clampInt(x.copies, 1, MAX_COPIES, d.copies), distance: clampInt(x.distance, 1, MAX_DISTANCE, d.distance),
      becomes: clampInt(x.becomes, 0, 15, d.becomes), keep: x.keep === true, move: x.move === true,
      dir: clampInt(x.dir, 0, 7, d.dir), any: x.any === true, radius: clampInt(x.radius, 1, MAX_CLUSTER_RADIUS, d.radius),
      ...(x.off || (x as { muted?: boolean }).muted ? { off: true } : {}),
    };
  });
}

/** Rule types a stack runs on: the whole-number kinds with a cell-by-cell rule. */
export const stacksOn = (type: string) => type === 'count' || type === 'stages' || type === 'patterns';

/** The cards that run: on a base that takes them, switched on, at most MAX_STACK. */
export function activeStack(type: string, stack: unknown): StackRule[] {
  return stacksOn(type) ? readStack(stack).filter(r => !r.off) : [];
}

/** Most draws a board Pass takes a frame (passes.ts MAX_PASS_REPEAT). */
const MAX_REPEAT = 64;
/** Steps a frame with a stack: each step is 1 + cards draws, within the Pass's Repeat. */
export const stackedSteps = (steps: number, cards: number) => Math.max(1, Math.min(steps, Math.floor(MAX_REPEAT / (1 + cards))));

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** One card as a sentence. */
export function describeStackRule(r: StackRule): string {
  const chance = r.chance < 1 ? ` (${Math.round(r.chance * 100)}% of the time)` : '';
  switch (r.kind) {
    case 'explode': {
      const meet = r.lo === r.hi ? (r.lo === 1 ? 'two live cells meet (touching only each other)' : `a live cell has exactly ${plural(r.lo, 'live neighbour')}`) : `a live cell has ${r.lo} to ${r.hi} live neighbours`;
      return `When ${meet}, it explodes into ${plural(r.copies, 'copy').replace('copys', 'copies')} ${r.distance} away${r.keep ? '' : ' and vanishes'}${chance}.`;
    }
    case 'crowd': return `A live cell with ${r.lo} or more live neighbours ${r.move ? 'steps away from them' : 'dies'}${chance}.`;
    case 'drift': return `${r.any ? 'Every cell' : 'Live cells'} drift ${DIRECTIONS[r.dir].label.toLowerCase()}, one cell a step where it is empty${chance}.`;
    case 'cluster': return `A live cell with ${r.lo} or more live cells within ${r.radius} ${r.becomes === 0 ? 'dies' : `becomes ${r.becomes}`}${chance}.`;
  }
}

/** A short line for the nav and the card ("+ explode, drift"). */
export const stackLine = (rules: StackRule[]) => rules.filter(r => !r.off).map(r => r.kind).join(', ');

/** Ready-made bases with cards: the section's "Try" chips (the base's own params come from its preset). */
export const STACK_RECIPES: Array<{ key: string; label: string; hint: string; base: { ruleType: 'count' | 'stages' | 'patterns'; preset: string }; stack: Array<Partial<StackRule> & { kind: StackKind }>; extra?: Record<string, unknown> }> = [
  // Tuned on a 64 × 40 try board over 300 steps: each stays alive (Life that explodes ~17% live, the others 2–30%).
  { key: 'lifeExplodes', label: 'Life that explodes', hint: 'Life, and where two cells meet they now and then burst into 8 copies three cells away: Life that never settles.', base: { ruleType: 'count', preset: 'life' }, stack: [{ kind: 'explode', copies: 8, distance: 3, chance: 0.05 }] },
  { key: 'windyBrain', label: 'Brain in the wind', hint: 'Brian\'s Brain with every cell blown one cell right, a third of the time: sparks stream sideways and keep each other going.', base: { ruleType: 'stages', preset: 'briansBrain' }, stack: [{ kind: 'drift', dir: 2, any: true, chance: 0.3 }] },
  { key: 'crowdedBrain', label: 'Brain that spreads out', hint: 'Brian\'s Brain, where a firing cell with 4 or more firing neighbours steps away from them.', base: { ruleType: 'stages', preset: 'briansBrain' }, stack: [{ kind: 'crowd', lo: 4, move: true }] },
  { key: 'clumpsBurn', label: 'Crystals that burn out', hint: 'Life without Death grows crystals that never die; here a cell with 10 live cells within 2 dies half the time, so clumps hollow out and grow again.', base: { ruleType: 'count', preset: 'lifeWithoutDeath' }, stack: [{ kind: 'cluster', lo: 10, radius: 2, becomes: 0, chance: 0.5 }] },
];

// ── The CPU step (the try board) ───────────────────────────────────────────────────────────────

interface StackCtx {
  wrap: boolean;
  /** The highest state the base holds (Count 1). */
  top: number;
  afterglow: number;
  frame: number;
  seed: number;
}

/** One card on a board, as its GPU stage does it. */
export function cpuStackStep(r: StackRule, j: number, B: CpuBoard, c: StackCtx): CpuBoard {
  const { w, h } = B;
  const out: CpuBoard = { ...B, a: B.a.slice(), b: B.b.slice() };
  // A read past the edge: wrapped, or (walls) the edge cell, as the GPU's Clamp reads it (the ring is kept empty).
  const idx = (x: number, y: number) => {
    if (c.wrap) { x = ((x % w) + w) % w; y = ((y % h) + h) % h; } else { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); }
    return y * w + x;
  };
  const st = (x: number, y: number) => Math.round(B.a[idx(x, y)]);
  const live = (x: number, y: number) => (st(x, y) === 1 ? 1 : 0);
  const key = (x: number, y: number): [number, number] => (c.wrap ? [((x % w) + w) % w, ((y % h) + h) % h] : [x, y]);
  const roll = (x: number, y: number) => { const [kx, ky] = key(x, y); return grDice(kx, ky, c.frame, stackSalt(j), c.seed) < r.chance; };
  const inside = (x: number, y: number) => c.wrap || (x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2);
  const count = (x: number, y: number) => MOORE.reduce((n, [dx, dy]) => n + live(x + dx, y + dy), 0);
  const becomes = Math.min(r.becomes, c.top);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const s0 = st(x, y);
    let next = s0, ng = B.b[i];
    if (r.kind === 'explode') {
      const meets = (px: number, py: number) => { if (!live(px, py)) return false; const n = count(px, py); return n >= r.lo && n <= r.hi && roll(px, py); };
      if (s0 === 0 && COPY_DIRS.slice(0, r.copies).some(([dx, dy]) => meets(x - dx * r.distance, y - dy * r.distance))) { next = becomes; ng = 0; }
      else if (!r.keep && meets(x, y)) { next = 0; ng = c.afterglow; }
    } else if (r.kind === 'crowd') {
      if (!r.move) {
        if (live(x, y) && count(x, y) >= r.lo && roll(x, y)) { next = 0; ng = c.afterglow; }
      } else {
        // Where a crowded cell steps: away from its live neighbours (the sign of their offsets' sum, turned round).
        const away = (px: number, py: number): [number, number] => {
          let sx = 0, sy = 0;
          for (const [dx, dy] of MOORE) if (live(px + dx, py + dy)) { sx += dx; sy += dy; }
          return [-Math.sign(sx), -Math.sign(sy)];
        };
        const mover = (px: number, py: number): [number, number] | null => {
          if (!live(px, py) || count(px, py) < r.lo) return null;
          const [dx, dy] = away(px, py);
          if ((dx === 0 && dy === 0) || st(px + dx, py + dy) !== 0 || !inside(px + dx, py + dy) || !roll(px, py)) return null;
          return [dx, dy];
        };
        if (s0 === 0) {
          for (const [dx, dy] of MOORE) {
            const m = mover(x - dx, y - dy);
            if (m && m[0] === dx && m[1] === dy) { next = 1; ng = B.b[idx(x - dx, y - dy)]; break; }
          }
        } else if (mover(x, y)) { next = 0; ng = 0; }
      }
    } else if (r.kind === 'drift') {
      const [dx, dy] = DIRECTIONS[r.dir].d;
      const sel = (px: number, py: number) => (r.any ? st(px, py) > 0 : live(px, py) === 1);
      const mover = (px: number, py: number) => sel(px, py) && st(px + dx, py + dy) === 0 && inside(px + dx, py + dy) && roll(px, py);
      if (s0 === 0) { if (mover(x - dx, y - dy)) { next = st(x - dx, y - dy); ng = B.b[idx(x - dx, y - dy)]; } }
      else if (mover(x, y)) { next = 0; ng = 0; }
    } else if (live(x, y)) {
      let n = 0;
      for (let dy = -r.radius; dy <= r.radius; dy++) for (let dx = -r.radius; dx <= r.radius; dx++) if (dx || dy) n += live(x + dx, y + dy);
      if (n >= r.lo && roll(x, y)) { next = becomes; ng = becomes === 0 ? c.afterglow : 0; }
    }
    // Walls: the outer ring stays empty, as the base keeps it.
    const ring = !inside(x, y);
    out.a[i] = ring ? 0 : next;
    out.b[i] = ring ? 0 : ng;
  }
  return out;
}

// ── The GPU stage ───────────────────────────────────────────────────────────────────────────────

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const vec = (dx: number, dy: number) => `vec2(${f(dx)}, ${f(dy)})`;

/** GLSL the stages share: a cell's key for the dice, wrapped by hand (a division can round the wrong way on a GPU). */
export const GR_STACK_GLSL = `vec2 grWrapKey(vec2 p, vec2 res, float wrap) {
    if (wrap < 0.5) return p;
    return vec2(p.x < 0.0 ? p.x + res.x : (p.x > res.x - 0.5 ? p.x - res.x : p.x), p.y < 0.0 ? p.y + res.y : (p.y > res.y - 0.5 ? p.y - res.y : p.y));
}`;

export interface StackStageNames {
  /** The node's slug. */
  id: string;
  /** A param as GLSL. */
  P: (key: string) => string;
  /** The board this stage reads (the Pass's Previous). */
  prev: string;
  wrap: boolean;
  /** The highest state, as GLSL. */
  top: string;
}

/**
 * Card j's stage: the lines inside its `if (stage == j + 1) { … }`. Reads the prelude's cell, res,
 * me (this cell a stage ago) and frame; assigns the node's out and outA. A card acts only after a
 * real step of the base (blue ≥ 2: its mark), else it passes the board on unchanged.
 */
export function stackStageGLSL(r: StackRule, j: number, N: StackStageNames): string[] {
  const { id, P, prev, wrap } = N;
  const v = (name: string) => `${id}_k${j}${name}`;
  const cell = `${id}_cell`, res = `${id}_res`, me = `${id}_me`;
  const rd = (d: string) => `texture2D(${prev}, (${cell} + ${d} + 0.5) / ${res})`;
  const stAt = (dx: number, dy: number) => (dx === 0 && dy === 0 ? `floor(${me}.r + 0.5)` : `floor(${rd(vec(dx, dy))}.r + 0.5)`);
  const liveAt = (dx: number, dy: number) => `(abs(${stAt(dx, dy)} - 1.0) < 0.5 ? 1.0 : 0.0)`;
  const roll = (dx: number, dy: number) => `(grDice(grWrapKey(${cell} + ${vec(dx, dy)}, ${res}, ${wrap ? '1.0' : '0.0'}), ${id}_frame, ${f(stackSalt(j))}, ${P('seed')}) < ${f(r.chance)} ? 1.0 : 0.0)`;
  const insideAt = (dx: number, dy: number) => (wrap ? '1.0'
    : `(step(0.5, ${cell}.x + ${f(dx)}) * step(0.5, ${cell}.y + ${f(dy)}) * step(${cell}.x + ${f(dx)}, ${res}.x - 1.5) * step(${cell}.y + ${f(dy)}, ${res}.y - 1.5))`);
  const countAt = (px: number, py: number) => MOORE.map(([dx, dy]) => liveAt(px + dx, py + dy)).join(' + ');
  const L: string[] = [
    `float ${v('s')} = floor(${me}.r + 0.5);`,
    `float ${v('next')} = ${v('s')};`,
    `float ${v('ng')} = ${me}.g;`,
    `float ${v('top')} = ${N.top};`,
  ];
  const becomes = `min(${f(r.becomes)}, ${v('top')})`;
  if (r.kind === 'explode') {
    const meet = (px: number, py: number, name: string) => {
      L.push(`float ${v(name + 'n')} = ${countAt(px, py)};`);
      L.push(`float ${v(name)} = ${liveAt(px, py)} * step(${f(r.lo - 0.5)}, ${v(name + 'n')}) * step(${v(name + 'n')}, ${f(r.hi + 0.5)}) * ${roll(px, py)};`);
    };
    const srcs = COPY_DIRS.slice(0, r.copies).map(([dx, dy]) => [-dx * r.distance, -dy * r.distance] as [number, number]);
    srcs.forEach(([px, py], k) => meet(px, py, `m${k}`));
    meet(0, 0, 'self');
    const hit = srcs.map((_, k) => v(`m${k}`)).reduce((a, b) => `max(${a}, ${b})`);
    L.push(`if (${v('s')} < 0.5 && ${hit} > 0.5) { ${v('next')} = ${becomes}; ${v('ng')} = 0.0; }`);
    if (!r.keep) L.push(`else if (${v('self')} > 0.5) { ${v('next')} = 0.0; ${v('ng')} = ${P('afterglow')}; }`);
  } else if (r.kind === 'crowd' && !r.move) {
    L.push(`float ${v('n')} = ${countAt(0, 0)};`);
    L.push(`if (${liveAt(0, 0)} * step(${f(r.lo - 0.5)}, ${v('n')}) * ${roll(0, 0)} > 0.5) { ${v('next')} = 0.0; ${v('ng')} = ${P('afterglow')}; }`);
  } else if (r.kind === 'crowd') {
    // Each cell round this one that might step here: crowded, stepping away from its neighbours in exactly this direction.
    const away = (px: number, py: number, name: string) => {
      const ls = MOORE.map(([dx, dy]) => [dx, dy, liveAt(px + dx, py + dy)] as const);
      L.push(`float ${v(name + 'n')} = ${ls.map(x => x[2]).join(' + ')};`);
      L.push(`float ${v(name + 'x')} = -sign(${ls.filter(x => x[0] !== 0).map(x => `${f(x[0])} * ${x[2]}`).join(' + ')});`);
      L.push(`float ${v(name + 'y')} = -sign(${ls.filter(x => x[1] !== 0).map(x => `${f(x[1])} * ${x[2]}`).join(' + ')});`);
    };
    MOORE.forEach(([dx, dy], k) => {
      away(-dx, -dy, `p${k}`);
      L.push(`float ${v(`p${k}`)} = ${liveAt(-dx, -dy)} * step(${f(r.lo - 0.5)}, ${v(`p${k}n`)}) * (abs(${v(`p${k}x`)} - ${f(dx)}) < 0.5 && abs(${v(`p${k}y`)} - ${f(dy)}) < 0.5 ? 1.0 : 0.0) * ${insideAt(0, 0)} * ${roll(-dx, -dy)};`);
    });
    away(0, 0, 'self');
    const tgt = `vec2(${v('selfx')}, ${v('selfy')})`;
    const insideT = wrap ? '1.0' : `(step(0.5, ${cell}.x + ${v('selfx')}) * step(0.5, ${cell}.y + ${v('selfy')}) * step(${cell}.x + ${v('selfx')}, ${res}.x - 1.5) * step(${cell}.y + ${v('selfy')}, ${res}.y - 1.5))`;
    L.push(`float ${v('self')} = ${liveAt(0, 0)} * step(${f(r.lo - 0.5)}, ${v('selfn')}) * (abs(${v('selfx')}) + abs(${v('selfy')}) > 0.5 ? 1.0 : 0.0) * (floor(${rd(tgt)}.r + 0.5) < 0.5 ? 1.0 : 0.0) * ${insideT} * ${roll(0, 0)};`);
    L.push(`if (${v('s')} < 0.5) {`);
    MOORE.forEach(([dx, dy], k) => L.push(`    ${k ? 'else ' : ''}if (${v(`p${k}`)} > 0.5) { ${v('next')} = 1.0; ${v('ng')} = ${rd(vec(-dx, -dy))}.g; }`));
    L.push('}', `else if (${v('self')} > 0.5) { ${v('next')} = 0.0; ${v('ng')} = 0.0; }`);
  } else if (r.kind === 'drift') {
    const [dx, dy] = DIRECTIONS[r.dir].d;
    const sel = (x: number, y: number) => (r.any ? `step(0.5, ${stAt(x, y)})` : liveAt(x, y));
    L.push(`vec4 ${v('src')} = ${rd(vec(-dx, -dy))};`);
    L.push(`float ${v('in')} = ${sel(-dx, -dy)} * ${insideAt(0, 0)} * ${roll(-dx, -dy)};`);
    L.push(`float ${v('out')} = ${sel(0, 0)} * (${stAt(dx, dy)} < 0.5 ? 1.0 : 0.0) * ${insideAt(dx, dy)} * ${roll(0, 0)};`);
    L.push(`if (${v('s')} < 0.5 && ${v('in')} > 0.5) { ${v('next')} = floor(${v('src')}.r + 0.5); ${v('ng')} = ${v('src')}.g; }`);
    L.push(`else if (${v('out')} > 0.5) { ${v('next')} = 0.0; ${v('ng')} = 0.0; }`);
  } else {
    const R = r.radius;
    L.push(
      `float ${v('n')} = 0.0;`,
      `for (int ${v('dy')} = -${R}; ${v('dy')} <= ${R}; ${v('dy')}++) {`,
      `    for (int ${v('dx')} = -${R}; ${v('dx')} <= ${R}; ${v('dx')}++) {`,
      `        float ${v('q')} = floor(${rd(`vec2(float(${v('dx')}), float(${v('dy')}))`)}.r + 0.5);`,
      `        ${v('n')} += (${v('dx')} == 0 && ${v('dy')} == 0) ? 0.0 : (abs(${v('q')} - 1.0) < 0.5 ? 1.0 : 0.0);`,
      '    }',
      '}',
      `if (${liveAt(0, 0)} * step(${f(r.lo - 0.5)}, ${v('n')}) * ${roll(0, 0)} > 0.5) { ${v('next')} = ${becomes}; ${v('ng')} = ${becomes} < 0.5 ? ${P('afterglow')} : 0.0; }`,
    );
  }
  if (!wrap) {
    L.push(
      `float ${v('ins')} = step(0.5, ${cell}.x) * step(0.5, ${cell}.y) * step(${cell}.x, ${res}.x - 1.5) * step(${cell}.y, ${res}.y - 1.5);`,
      `${v('next')} = ${v('next')} * ${v('ins')};`, `${v('ng')} = ${v('ng')} * ${v('ins')};`,
    );
  }
  // Only after a real step of the base (its mark in blue); otherwise the board goes on as it is.
  L.push(`if (${me}.b < 1.5) { ${v('next')} = ${v('s')}; ${v('ng')} = ${me}.g; }`);
  L.push(`${id}_out = vec3(${v('next')}, ${v('ng')}, ${me}.b);`, `${id}_outA = ${me}.a;`);
  return L;
}

/**
 * Solo card `i` of a list switched by `off` (stacked cards, stencils, blocks): Alt/Option-click on its
 * mute (builders/mute.ts soloIn). The others go off, it comes on; soloing the one already alone turns
 * them all back on. `off` is the cards' mute: an off card stays in the spec and is left out of the step.
 */
export function soloOff<T extends { off?: boolean }>(list: T[], i: number): T[] {
  const alone = !list[i]?.off && list.every((r, k) => k === i || r.off);
  return list.map((r, k) => {
    const off = alone ? false : k !== i;
    if (off) return { ...r, off: true };
    const on = { ...r };
    delete on.off;
    return on;
  });
}
