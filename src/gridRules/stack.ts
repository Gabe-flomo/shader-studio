/**
 * stack.ts — stacked rules on a base (docs/grid-rules.md "Stacked rules", docs/simulation-builder-plan.md
 * phases 1 and 3). A Grid Rules node of a whole-number kind (Count, Stages, Stencils) can carry, after
 * its own rule (the base), up to MAX_STACK rule cards, run in order every step:
 *
 *   base (Life, Brian's Brain, Wireworld…) → card 1 → card 2 → …
 *
 * Each card sees the board the one before it made (the base's step, then card 1's…), so the order
 * matters: a later card has the last word on the cells it touches. The cards:
 *
 *  - **explode** (cells meet): a live cell with `lo`…`hi` live neighbours (1…1: two cells touching
 *    and nothing else) explodes: the empty cells `distance` away in the first `copies` of eight
 *    directions become `becomes` (`fly`: each copy heading away); the meeting cells vanish (unless `keep`).
 *  - **crowd** (too many neighbours): a live cell with at least `lo` live neighbours dies, or
 *    (`move`) steps one cell away from them (the opposite of where its neighbours sit), into an empty
 *    cell.
 *  - **drift** (a direction): every live cell (`any`: every cell that isn't empty) steps one cell in
 *    `dir` (N, NE, E… clockwise) when the cell there is empty.
 *  - **cluster** (a big clump): a live cell with at least `lo` live cells within `radius` (a square,
 *    itself not counted) becomes `becomes` (0: it dies).
 *  - **move** (movers): a cell with a heading steps one cell along it, where the cell ahead is empty
 *    and no other mover claims it; a blocked mover waits, turns round (`act` bounce) or turns right
 *    (`act` turn). Cells with no heading stay still, or take one (`assign`: at random, or a direction).
 *  - **collide** (movers meet): two movers head-on (side by side, facing each other) or about to
 *    arrive at the same empty cell `act`: bounce (turn round), turn (right), stop (lose their heading),
 *    merge (one cell, heading the way their headings add up to) or explode (they vanish and copies
 *    land round the meeting point).
 *
 * **Headings.** A cell can carry a heading as extra state: 1…8 for the eight directions (N, NE, E…
 * clockwise, DIRECTIONS[h − 1]), 0 for none. It rides in the fraction of red: red = state + heading / 32
 * (at most a quarter, so everything that reads a state as floor(red + 0.5) reads it as before, and the
 * values are exact in a half float). The base keeps a cell's heading while the cell stays (a survivor);
 * a newborn has none. Moving cards carry it along. `who` on any card limits it to cells with one
 * heading (or none): "only cells heading right".
 *
 * **Movers without conflicts** (claim and resolve, gathered): every mover claims the cell ahead; a
 * cell claimed by exactly one mover, and empty, takes it; anything else is a conflict. The collide card
 * resolves the conflicts it sees (head-on pairs and contested cells) one stage before a move card does
 * the moving, so the two cards are the two passes of the claim-and-resolve step; a move card on its
 * own leaves every conflict waiting. Each cell works its answer out from the cells within two (five
 * for explode's copies) of it, so no two cells ever write the same cell.
 *
 * "Live" is state 1, as the base counts it. Every card has a **chance**: rolled per cell (for
 * explode, per meeting cell; for a move, per moving cell; for a collision, per meeting cell) and step
 * with the whole-number dice of gridRules/dice.ts, so the GPU and the try board's CPU roll the same
 * numbers and make the same board (gridRulesStack.test.ts, gridRulesMovers.test.ts).
 *
 * On the GPU the cards are stages of the board Pass (compiler/gridRulesExpand.ts): its Repeat is
 * Steps × (1 + cards), and the Pass's Step uniform says which stage a draw is (0 the base, k card
 * k). The base marks the board's blue with +2 on a frame it stepped (not on a frame Speed skips or a
 * new deal), so a card acts only after a real step. Each stage reads the one before through the
 * Pass's Previous: one Pass, however many cards. Open as nodes builds each card as a Pass of its own
 * (store/gridRulesAsNodes.ts).
 *
 * Stored in the node's params as `stack` (an array, baked into the GLSL like Stencils: an edit
 * recompiles). Gathered, not scattered: each cell works out its own next state from what is round
 * it, as a fragment shader must. Where two drifters aim at one empty cell, it takes one of them (the
 * other is lost); explode's copies only land on empty cells.
 */
import type { CpuBoard } from './cpu';
import { grDice } from './dice';

export type StackKind = 'explode' | 'crowd' | 'drift' | 'cluster' | 'move' | 'collide';
/** What a blocked mover does (move), or what colliding movers do (collide). */
export type StackAct = 'wait' | 'bounce' | 'turn' | 'stop' | 'merge' | 'explode';

export interface StackRule {
  kind: StackKind;
  /** Chance it fires where it can, 0–1 (rolled per cell and step). */
  chance: number;
  off?: boolean;
  /** explode: the live-neighbour counts that make a meeting (lo…hi); crowd and cluster: at least lo. */
  lo: number;
  hi: number;
  /** explode (and collide's explode): how many copies (1–8: N, S, E, W, then the diagonals). */
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
  /** drift, move, collide: every cell that isn't empty (else only live ones). */
  any: boolean;
  /** cluster: how far round the cell is counted (1–4). */
  radius: number;
  /** Which cells the card acts on: −1 any, 0 those with no heading, 1…8 those with that heading. */
  who: number;
  /** explode (and collide's explode): each copy heads away from the meeting cell. */
  fly: boolean;
  /** move: cells with no heading: −1 stay still, 0 take one at random, 1…8 take that one. */
  assign: number;
  /** move: what a blocked mover does (wait, bounce, turn); collide: what colliding movers do (bounce, turn, stop, merge, explode). */
  act: StackAct;
}

/** Most cards on a base. */
export const MAX_STACK = 4;
/** Most explode copies, distance, cluster radius. */
export const MAX_COPIES = 8, MAX_DISTANCE = 4, MAX_CLUSTER_RADIUS = 4;
/** Salt of card j's dice (Blocks use 31…, Jitter 41); a move card's random headings use the next one. */
export const stackSalt = (j: number) => 51 + j * 2;

/** The eight directions (x right, y up), clockwise from up: drift's choices; heading h is DIRECTIONS[h − 1]. */
export const DIRECTIONS: Array<{ key: string; label: string; d: [number, number] }> = [
  { key: 'n', label: 'Up', d: [0, 1] }, { key: 'ne', label: 'Up right', d: [1, 1] }, { key: 'e', label: 'Right', d: [1, 0] }, { key: 'se', label: 'Down right', d: [1, -1] },
  { key: 's', label: 'Down', d: [0, -1] }, { key: 'sw', label: 'Down left', d: [-1, -1] }, { key: 'w', label: 'Left', d: [-1, 0] }, { key: 'nw', label: 'Up left', d: [-1, 1] },
];
/** Arrows for the eight directions, in DIRECTIONS order. */
export const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
/** Explode's copies in order: the four sides first, then the corners (2 copies: up and down). */
export const COPY_DIRS: Array<[number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
/** The 8 round a cell (as spec.ts MOORE_OFFSETS, kept here so this file reads nothing of spec.ts). */
const MOORE: Array<[number, number]> = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];

// ── Headings ────────────────────────────────────────────────────────────────────────────────────

/** A heading's share of red: red = state + heading × HEAD_UNIT (at most 8/32, so rounding red still gives the state). */
export const HEAD_UNIT = 1 / 32;
/** The state a board value holds. */
export const stateOfValue = (v: number) => Math.round(v);
/** The heading a board value holds (0 none, 1…8). */
export function headingOfValue(v: number): number {
  const h = Math.round((v - Math.round(v)) / HEAD_UNIT);
  return h >= 1 && h <= 8 ? h : 0;
}
/** A board value: a state and a heading (an empty cell has none). */
export const withHeading = (state: number, h: number) => state + (state > 0 && h >= 1 && h <= 8 ? h * HEAD_UNIT : 0);
/** A heading's step (x right, y up); (0, 0) for none. */
export const headingVec = (h: number): [number, number] => (h >= 1 && h <= 8 ? DIRECTIONS[h - 1].d : [0, 0]);
/** The heading of a step (its signs); 0 for (0, 0). */
export function headingOf(dx: number, dy: number): number {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  return DIRECTIONS.findIndex(x => x.d[0] === sx && x.d[1] === sy) + 1;
}
/** The heading turned round. */
export const reverseHeading = (h: number) => (h ? ((h + 3) % 8) + 1 : 0);
/** The heading turned right by `eighths` eighths of a turn (2: a right angle). */
export const turnHeading = (h: number, eighths = 2) => (h ? ((((h - 1 + eighths) % 8) + 8) % 8) + 1 : 0);

export const STACK_KINDS: Array<{ kind: StackKind; label: string; when: string; hint: string }> = [
  { kind: 'explode', label: 'Cells meet → explode', when: 'collisions', hint: 'Where live cells meet (two touching, nothing else round them), they burst into copies around them.' },
  { kind: 'crowd', label: 'Too crowded → die or move', when: 'crowding', hint: 'A live cell with too many live neighbours dies, or steps away from them.' },
  { kind: 'drift', label: 'Drift in a direction', when: 'direction', hint: 'Cells step one cell a step in a direction, where the way is clear.' },
  { kind: 'cluster', label: 'Big clusters change', when: 'clusters', hint: 'A live cell in a big clump (many live cells near it) changes state, or dies.' },
  { kind: 'move', label: 'Move along a heading', when: 'heading', hint: 'Cells carry a heading (an arrow) and step one cell a step along it, where the way is clear; blocked, they wait, bounce or turn.' },
  { kind: 'collide', label: 'Movers collide → …', when: 'collisions', hint: 'Two moving cells meeting head-on or arriving at the same cell bounce, turn, stop, merge or explode. Put it before a Move card.' },
];

/** What collide can do, and what a blocked mover can do. */
export const COLLIDE_ACTS: Array<{ value: StackAct; label: string; hint: string }> = [
  { value: 'bounce', label: 'Bounce', hint: 'Both turn round (their heading reverses).' },
  { value: 'turn', label: 'Turn', hint: 'Both turn right, a quarter turn.' },
  { value: 'stop', label: 'Stop', hint: 'Both lose their heading and stay where they are.' },
  { value: 'merge', label: 'Merge', hint: 'They become one cell, heading the way their headings add up to (head-on: they stop).' },
  { value: 'explode', label: 'Explode', hint: 'They vanish and copies land round the meeting point.' },
];
export const BLOCKED_ACTS: Array<{ value: StackAct; label: string; hint: string }> = [
  { value: 'wait', label: 'Wait', hint: 'A blocked mover waits until the way is clear.' },
  { value: 'bounce', label: 'Bounce', hint: 'A blocked mover turns round (walls, other cells, a conflict).' },
  { value: 'turn', label: 'Turn', hint: 'A blocked mover turns right, a quarter turn.' },
];

/** Does this card read or write headings (so the try board offers arrows)? */
export const usesHeadings = (r: StackRule) => r.kind === 'move' || r.kind === 'collide' || r.who >= 0 || r.fly;

/** A new card of a kind, with settings that show something on Life straight away. */
export function newStackRule(kind: StackKind): StackRule {
  const base: StackRule = { kind, chance: 1, lo: 1, hi: 1, copies: 4, distance: 2, becomes: 1, keep: false, move: false, dir: 2, any: false, radius: 2, who: -1, fly: false, assign: -1, act: 'wait' };
  if (kind === 'explode') return { ...base, chance: 0.5 };
  if (kind === 'crowd') return { ...base, lo: 5 };
  if (kind === 'drift') return { ...base, chance: 0.3 };
  if (kind === 'move') return { ...base, assign: 0 };
  if (kind === 'collide') return { ...base, act: 'bounce', copies: 8, distance: 2, fly: true };
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
    const acts = d.kind === 'collide' ? COLLIDE_ACTS : BLOCKED_ACTS;
    return {
      kind: d.kind,
      chance: typeof x.chance === 'number' && isFinite(x.chance) ? Math.max(0, Math.min(1, x.chance)) : d.chance,
      lo, hi: Math.max(lo, clampInt(x.hi, 0, 8, d.hi)),
      copies: clampInt(x.copies, 1, MAX_COPIES, d.copies), distance: clampInt(x.distance, 1, MAX_DISTANCE, d.distance),
      becomes: clampInt(x.becomes, 0, 15, d.becomes), keep: x.keep === true, move: x.move === true,
      dir: clampInt(x.dir, 0, 7, d.dir), any: x.any === true, radius: clampInt(x.radius, 1, MAX_CLUSTER_RADIUS, d.radius),
      who: clampInt(x.who, -1, 8, d.who), fly: typeof x.fly === 'boolean' ? x.fly : d.fly, assign: clampInt(x.assign, -1, 8, d.assign),
      act: acts.some(a => a.value === x.act) ? x.act as StackAct : d.act,
      ...(x.off ? { off: true } : {}),
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
const headingWord = (h: number) => DIRECTIONS[h - 1]?.label.toLowerCase() ?? '';

/** "only cells heading right" and the like, for the sentences. */
function whoWords(r: StackRule): string {
  if (r.who < 0) return '';
  return r.who === 0 ? ' (only cells with no heading)' : ` (only cells heading ${headingWord(r.who)})`;
}

/** One card as a sentence. */
export function describeStackRule(r: StackRule): string {
  const chance = r.chance < 1 ? ` (${Math.round(r.chance * 100)}% of the time)` : '';
  const who = whoWords(r);
  const copies = `${plural(r.copies, 'copy').replace('copys', 'copies')} ${r.distance} away${r.fly ? ', flying outward' : ''}`;
  switch (r.kind) {
    case 'explode': {
      const meet = r.lo === r.hi ? (r.lo === 1 ? 'two live cells meet (touching only each other)' : `a live cell has exactly ${plural(r.lo, 'live neighbour')}`) : `a live cell has ${r.lo} to ${r.hi} live neighbours`;
      return `When ${meet}, it explodes into ${copies}${r.keep ? '' : ' and vanishes'}${who}${chance}.`;
    }
    case 'crowd': return `A live cell with ${r.lo} or more live neighbours ${r.move ? 'steps away from them' : 'dies'}${who}${chance}.`;
    case 'drift': return `${r.any ? 'Every cell' : 'Live cells'} drift ${DIRECTIONS[r.dir].label.toLowerCase()}, one cell a step where it is empty${who}${chance}.`;
    case 'cluster': return `A live cell with ${r.lo} or more live cells within ${r.radius} ${r.becomes === 0 ? 'dies' : `becomes ${r.becomes}`}${who}${chance}.`;
    case 'move': {
      const still = r.assign < 0 ? 'cells with no heading stay still' : r.assign === 0 ? 'cells with no heading pick one at random' : `cells with no heading head ${headingWord(r.assign)}`;
      const blocked = r.act === 'bounce' ? 'turn round' : r.act === 'turn' ? 'turn right' : 'wait';
      return `${r.any ? 'Every cell' : 'Live cells'} step one cell along their heading where the way is clear; blocked ones ${blocked}; ${still}${who}${chance}.`;
    }
    case 'collide': {
      const what = r.act === 'bounce' ? 'both turn round' : r.act === 'turn' ? 'both turn right' : r.act === 'stop' ? 'both stop'
        : r.act === 'merge' ? 'they merge into one cell' : `they vanish and burst into ${copies}`;
      return `When two moving cells meet head-on or head for the same cell, ${what}${who}${chance}.`;
    }
  }
}

/** A short line for the nav and the card ("+ explode, drift"). */
export const stackLine = (rules: StackRule[]) => rules.filter(r => !r.off).map(r => r.kind).join(', ');

/** A still base: nothing is born, everything survives (Count B/S012345678), for movers on their own. */
const STILL = { bornMask: 0, surviveMask: 511 };

/** Ready-made bases with cards: the section's "Try" chips (the base's own params come from its preset). */
export const STACK_RECIPES: Array<{ key: string; label: string; hint: string; base: { ruleType: 'count' | 'stages' | 'patterns'; preset: string }; stack: Array<Partial<StackRule> & { kind: StackKind }>; extra?: Record<string, unknown> }> = [
  // Tuned on a 64 × 40 try board over 300 steps: each stays alive (Life that explodes ~17% live, the others 2–30%).
  { key: 'lifeExplodes', label: 'Life that explodes', hint: 'Life, and where two cells meet they now and then burst into 8 copies three cells away: Life that never settles.', base: { ruleType: 'count', preset: 'life' }, stack: [{ kind: 'explode', copies: 8, distance: 3, chance: 0.05 }] },
  { key: 'windyBrain', label: 'Brain in the wind', hint: 'Brian\'s Brain with every cell blown one cell right, a third of the time: sparks stream sideways and keep each other going.', base: { ruleType: 'stages', preset: 'briansBrain' }, stack: [{ kind: 'drift', dir: 2, any: true, chance: 0.3 }] },
  { key: 'crowdedBrain', label: 'Brain that spreads out', hint: 'Brian\'s Brain, where a firing cell with 4 or more firing neighbours steps away from them.', base: { ruleType: 'stages', preset: 'briansBrain' }, stack: [{ kind: 'crowd', lo: 4, move: true }] },
  { key: 'clumpsBurn', label: 'Crystals that burn out', hint: 'Life without Death grows crystals that never die; here a cell with 10 live cells within 2 dies half the time, so clumps hollow out and grow again.', base: { ruleType: 'count', preset: 'lifeWithoutDeath' }, stack: [{ kind: 'cluster', lo: 10, radius: 2, becomes: 0, chance: 0.5 }] },
  // Movers (phase 3): a still base, so only the cards change the board.
  { key: 'billiards', label: 'Bouncing cells', hint: 'Cells with random headings fly about a walled box; meeting head-on or at one cell they bounce, and walls turn them round.', base: { ruleType: 'count', preset: 'life' }, stack: [{ kind: 'collide', act: 'bounce' }, { kind: 'move', assign: 0, act: 'bounce' }], extra: { ...STILL, density: 0.06, edges: 'walls' } },
  { key: 'fireworks', label: 'Fireworks', hint: 'Movers that meet burst into eight copies flying outward, which meet others and burst again. Walls turn them round.', base: { ruleType: 'count', preset: 'life' }, stack: [{ kind: 'collide', act: 'explode', copies: 8, distance: 2, fly: true, chance: 0.6 }, { kind: 'move', assign: 0, act: 'bounce' }, { kind: 'cluster', radius: 2, lo: 9, becomes: 0 }], extra: { ...STILL, density: 0.03, edges: 'walls' } },
  { key: 'merging', label: 'Movers that merge', hint: 'Movers that head for the same cell merge into one, heading the way their headings add up to: the crowd thins into a few big streams.', base: { ruleType: 'count', preset: 'life' }, stack: [{ kind: 'collide', act: 'merge' }, { kind: 'move', assign: 0, act: 'turn' }], extra: { ...STILL, density: 0.1 } },
  { key: 'traffic', label: 'Traffic', hint: 'Every cell heads right and moves where the cell ahead is free (rule 184): jams form and travel backwards.', base: { ruleType: 'count', preset: 'life' }, stack: [{ kind: 'move', assign: 3, act: 'wait' }], extra: { ...STILL, density: 0.35 } },
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

/** One card on a board, as its GPU stage does it. Red keeps state + heading / 32. */
export function cpuStackStep(r: StackRule, j: number, B: CpuBoard, c: StackCtx): CpuBoard {
  const { w, h } = B;
  const out: CpuBoard = { ...B, a: B.a.slice(), b: B.b.slice() };
  // A read past the edge: wrapped, or (walls) the edge cell, as the GPU's Clamp reads it (the ring is kept empty).
  const idx = (x: number, y: number) => {
    if (c.wrap) { x = ((x % w) + w) % w; y = ((y % h) + h) % h; } else { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); }
    return y * w + x;
  };
  const raw = (x: number, y: number) => B.a[idx(x, y)];
  const st = (x: number, y: number) => Math.round(raw(x, y));
  const hd = (x: number, y: number) => headingOfValue(raw(x, y));
  const whoOk = (x: number, y: number) => r.who < 0 || hd(x, y) === r.who;
  const live = (x: number, y: number) => (st(x, y) === 1 ? 1 : 0);
  /** A live cell this card acts on. */
  const acts = (x: number, y: number) => live(x, y) === 1 && whoOk(x, y);
  const key = (x: number, y: number): [number, number] => (c.wrap ? [((x % w) + w) % w, ((y % h) + h) % h] : [x, y]);
  const dice = (x: number, y: number, salt: number) => { const [kx, ky] = key(x, y); return grDice(kx, ky, c.frame, salt, c.seed); };
  const roll = (x: number, y: number) => dice(x, y, stackSalt(j)) < r.chance;
  const inside = (x: number, y: number) => c.wrap || (x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2);
  const count = (x: number, y: number) => MOORE.reduce((n, [dx, dy]) => n + live(x + dx, y + dy), 0);
  const becomes = Math.min(r.becomes, c.top);
  const sel = (x: number, y: number) => (r.any ? st(x, y) > 0 : live(x, y) === 1) && whoOk(x, y);

  // Movers (move): a heading (or one assigned), and their roll.
  const he = (x: number, y: number) => {
    const h0 = hd(x, y);
    if (h0 || r.assign < 0) return h0;
    return r.assign > 0 ? r.assign : 1 + Math.floor(dice(x, y, stackSalt(j) + 1) * 8);
  };
  const active = (x: number, y: number) => sel(x, y) && he(x, y) > 0 && roll(x, y);
  /** Active movers round (cx, cy) whose heading points at it. */
  const claims = (cx: number, cy: number) => MOORE.filter(([qx, qy]) => active(cx + qx, cy + qy) && he(cx + qx, cy + qy) === headingOf(-qx, -qy));
  // Movers (collide): their own heading only.
  const mover = (x: number, y: number) => sel(x, y) && hd(x, y) > 0;
  const claimsC = (cx: number, cy: number) => MOORE.filter(([qx, qy]) => mover(cx + qx, cy + qy) && hd(cx + qx, cy + qy) === headingOf(-qx, -qy));
  const contested = (x: number, y: number) => st(x, y) === 0 && inside(x, y) && claimsC(x, y).length >= 2;
  const headOn = (x: number, y: number) => {
    if (!mover(x, y)) return false;
    const [dx, dy] = headingVec(hd(x, y));
    return mover(x + dx, y + dy) && hd(x + dx, y + dy) === reverseHeading(hd(x, y));
  };
  /** A meeting cell that fires: an empty cell two movers head for, or the first of a head-on pair (heading 1–4). */
  const meetsAt = (x: number, y: number) => (contested(x, y) || (headOn(x, y) && hd(x, y) <= 4)) && roll(x, y);
  /** Does this mover collide (its meeting cell fires)? */
  const collides = (x: number, y: number) => {
    if (!mover(x, y)) return false;
    const [dx, dy] = headingVec(hd(x, y));
    if (headOn(x, y)) return hd(x, y) <= 4 ? roll(x, y) : roll(x + dx, y + dy);
    return contested(x + dx, y + dy) && roll(x + dx, y + dy);
  };

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const s0 = st(x, y);
    let next = B.a[i], ng = B.b[i];
    if (r.kind === 'explode') {
      const meets = (px: number, py: number) => { if (!acts(px, py)) return false; const n = count(px, py); return n >= r.lo && n <= r.hi && roll(px, py); };
      const k = s0 === 0 ? COPY_DIRS.slice(0, r.copies).findIndex(([dx, dy]) => meets(x - dx * r.distance, y - dy * r.distance)) : -1;
      if (k >= 0) { next = withHeading(becomes, r.fly ? headingOf(...COPY_DIRS[k]) : 0); ng = 0; }
      else if (!r.keep && meets(x, y)) { next = 0; ng = c.afterglow; }
    } else if (r.kind === 'crowd') {
      if (!r.move) {
        if (acts(x, y) && count(x, y) >= r.lo && roll(x, y)) { next = 0; ng = c.afterglow; }
      } else {
        // Where a crowded cell steps: away from its live neighbours (the sign of their offsets' sum, turned round).
        const away = (px: number, py: number): [number, number] => {
          let sx = 0, sy = 0;
          for (const [dx, dy] of MOORE) if (live(px + dx, py + dy)) { sx += dx; sy += dy; }
          return [-Math.sign(sx), -Math.sign(sy)];
        };
        const mv = (px: number, py: number): [number, number] | null => {
          if (!acts(px, py) || count(px, py) < r.lo) return null;
          const [dx, dy] = away(px, py);
          if ((dx === 0 && dy === 0) || st(px + dx, py + dy) !== 0 || !inside(px + dx, py + dy) || !roll(px, py)) return null;
          return [dx, dy];
        };
        if (s0 === 0) {
          for (const [dx, dy] of MOORE) {
            const m = mv(x - dx, y - dy);
            if (m && m[0] === dx && m[1] === dy) { next = raw(x - dx, y - dy); ng = B.b[idx(x - dx, y - dy)]; break; }
          }
        } else if (mv(x, y)) { next = 0; ng = 0; }
      }
    } else if (r.kind === 'drift') {
      const [dx, dy] = DIRECTIONS[r.dir].d;
      const mv = (px: number, py: number) => sel(px, py) && st(px + dx, py + dy) === 0 && inside(px + dx, py + dy) && roll(px, py);
      if (s0 === 0) { if (mv(x - dx, y - dy)) { next = raw(x - dx, y - dy); ng = B.b[idx(x - dx, y - dy)]; } }
      else if (mv(x, y)) { next = 0; ng = 0; }
    } else if (r.kind === 'cluster') {
      if (acts(x, y)) {
        let n = 0;
        for (let dy = -r.radius; dy <= r.radius; dy++) for (let dx = -r.radius; dx <= r.radius; dx++) if (dx || dy) n += live(x + dx, y + dy);
        if (n >= r.lo && roll(x, y)) { next = withHeading(becomes, hd(x, y)); ng = becomes === 0 ? c.afterglow : 0; }
      }
    } else if (r.kind === 'move') {
      if (s0 === 0) {
        const cl = inside(x, y) ? claims(x, y) : [];
        if (cl.length === 1) { const [qx, qy] = cl[0]; next = withHeading(st(x + qx, y + qy), he(x + qx, y + qy)); ng = B.b[idx(x + qx, y + qy)]; }
      } else if (active(x, y)) {
        const e = he(x, y);
        const [dx, dy] = headingVec(e);
        const free = st(x + dx, y + dy) === 0 && inside(x + dx, y + dy) && claims(x + dx, y + dy).length === 1;
        if (free) { next = 0; ng = 0; } else next = withHeading(s0, r.act === 'bounce' ? reverseHeading(e) : r.act === 'turn' ? turnHeading(e) : e);
      }
    } else if (r.kind === 'collide') {
      if (mover(x, y)) {
        if (collides(x, y)) {
          const h0 = hd(x, y);
          if (r.act === 'bounce') next = withHeading(s0, reverseHeading(h0));
          else if (r.act === 'turn') next = withHeading(s0, turnHeading(h0));
          else if (r.act === 'stop') next = s0;
          else if (r.act === 'merge') { if (headOn(x, y) && h0 <= 4) next = s0; else { next = 0; ng = 0; } }
          else { next = 0; ng = c.afterglow; }
        }
      } else if (s0 === 0 && inside(x, y)) {
        if (r.act === 'merge' && contested(x, y) && roll(x, y)) {
          // One cell: the first claimant's state, heading the way the claimants' headings add up to.
          const cl = claimsC(x, y);
          const sx = cl.reduce((t, [qx]) => t - qx, 0), sy = cl.reduce((t, [, qy]) => t - qy, 0);
          next = withHeading(st(x + cl[0][0], y + cl[0][1]), headingOf(sx, sy)); ng = 0;
        } else if (r.act === 'explode' && !meetsAt(x, y)) {
          const k = COPY_DIRS.slice(0, r.copies).findIndex(([dx, dy]) => meetsAt(x - dx * r.distance, y - dy * r.distance));
          if (k >= 0) { next = withHeading(becomes, r.fly ? headingOf(...COPY_DIRS[k]) : 0); ng = 0; }
        }
      }
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
/** A GLSL name piece for an offset: m1p2 is (−1, 2). */
const tag = (dx: number, dy: number) => `${dx < 0 ? 'm' : 'p'}${Math.abs(dx)}${dy < 0 ? 'm' : 'p'}${Math.abs(dy)}`;

/** GLSL the stages share: a cell's key for the dice, wrapped by hand (a division can round the wrong way on a GPU); a heading from a step. */
export const GR_STACK_GLSL = `vec2 grWrapKey(vec2 p, vec2 res, float wrap) {
    if (wrap < 0.5) return p;
    return vec2(p.x < 0.0 ? p.x + res.x : (p.x > res.x - 0.5 ? p.x - res.x : p.x), p.y < 0.0 ? p.y + res.y : (p.y > res.y - 0.5 ? p.y - res.y : p.y));
}
float grHeadingOf(vec2 d) {
    vec2 s = sign(d);
    return s.y > 0.5 ? (s.x > 0.5 ? 2.0 : (s.x < -0.5 ? 8.0 : 1.0)) : (s.y < -0.5 ? (s.x > 0.5 ? 4.0 : (s.x < -0.5 ? 6.0 : 5.0)) : (s.x > 0.5 ? 3.0 : (s.x < -0.5 ? 7.0 : 0.0)));
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
 *
 * Every value a cell needs about a cell near it (its state, heading, whether it is a mover, the
 * movers claiming it…) is declared once, the first time it is needed, so a card reads each cell
 * at most once however many questions it asks of it.
 */
export function stackStageGLSL(r: StackRule, j: number, N: StackStageNames): string[] {
  const { id, P, prev, wrap } = N;
  const v = (name: string) => `${id}_k${j}${name}`;
  const cell = `${id}_cell`, res = `${id}_res`, me = `${id}_me`;
  const L: string[] = [];
  const seen = new Set<string>();
  /** Declare `name` once with `rhs` (made on first use); returns the name. */
  const once = (name: string, type: string, rhs: () => string) => {
    if (!seen.has(name)) { const val = rhs(); seen.add(name); L.push(`${type} ${name} = ${val};`); }
    return name;
  };
  const rd = (d: string) => `texture2D(${prev}, (${cell} + ${d} + 0.5) / ${res})`;
  const T = (dx: number, dy: number) => (dx === 0 && dy === 0 ? me : once(v(`T${tag(dx, dy)}`), 'vec4', () => rd(vec(dx, dy))));
  const ST = (dx: number, dy: number) => once(v(`S${tag(dx, dy)}`), 'float', () => `floor(${T(dx, dy)}.r + 0.5)`);
  const HD = (dx: number, dy: number) => once(v(`H${tag(dx, dy)}`), 'float', () => `floor((${T(dx, dy)}.r - ${ST(dx, dy)}) * 32.0 + 0.5)`);
  const is = (x: string, k: number) => `(abs(${x} - ${f(k)}) < 0.5 ? 1.0 : 0.0)`;
  const LIVE = (dx: number, dy: number) => is(ST(dx, dy), 1);
  const WHO = (dx: number, dy: number) => (r.who < 0 ? '' : ` * ${is(HD(dx, dy), r.who)}`);
  const ACTS = (dx: number, dy: number) => `${LIVE(dx, dy)}${WHO(dx, dy)}`;
  const SEL = (dx: number, dy: number) => once(v(`L${tag(dx, dy)}`), 'float', () => `${r.any ? `step(0.5, ${ST(dx, dy)})` : LIVE(dx, dy)}${WHO(dx, dy)}`);
  const dice = (dx: number, dy: number, salt: number) => `grDice(grWrapKey(${cell} + ${vec(dx, dy)}, ${res}, ${wrap ? '1.0' : '0.0'}), ${id}_frame, ${f(salt)}, ${P('seed')})`;
  const ROLL = (dx: number, dy: number) => once(v(`R${tag(dx, dy)}`), 'float', () => `(${dice(dx, dy, stackSalt(j))} < ${f(r.chance)} ? 1.0 : 0.0)`);
  const INSIDE = (dx: number, dy: number) => (wrap ? '1.0'
    : `(step(0.5, ${cell}.x + ${f(dx)}) * step(0.5, ${cell}.y + ${f(dy)}) * step(${cell}.x + ${f(dx)}, ${res}.x - 1.5) * step(${cell}.y + ${f(dy)}, ${res}.y - 1.5))`);
  const COUNT = (px: number, py: number) => once(v(`N${tag(px, py)}`), 'float', () => MOORE.map(([dx, dy]) => LIVE(px + dx, py + dy)).join(' + '));
  const head = (h: string) => `${h} / 32.0`;
  /** A state and a heading as red (an empty cell keeps none). */
  const withH = (state: string, h: string) => `(${state} + (${state} > 0.5 ? ${head(h)} : 0.0))`;
  const rev = (h: string) => `(mod(${h} + 3.0, 8.0) + 1.0)`;
  const turn = (h: string) => `(mod(${h} + 1.0, 8.0) + 1.0)`;

  L.push(
    `float ${v('s')} = floor(${me}.r + 0.5);`,
    `float ${v('next')} = ${me}.r;`,
    `float ${v('ng')} = ${me}.g;`,
    `float ${v('top')} = ${N.top};`,
  );
  const s = v('s'), next = v('next'), ng = v('ng');
  const becomes = `min(${f(r.becomes)}, ${v('top')})`;
  if (r.kind === 'explode') {
    const MEET = (px: number, py: number) => once(v(`M${tag(px, py)}`), 'float', () => `${ACTS(px, py)} * step(${f(r.lo - 0.5)}, ${COUNT(px, py)}) * step(${COUNT(px, py)}, ${f(r.hi + 0.5)}) * ${ROLL(px, py)}`);
    const srcs = COPY_DIRS.slice(0, r.copies).map(([dx, dy]) => [-dx * r.distance, -dy * r.distance] as [number, number]);
    srcs.forEach(([px, py]) => MEET(px, py));
    MEET(0, 0);
    srcs.forEach(([px, py], k) => L.push(`${k ? 'else ' : ''}if (${s} < 0.5 && ${MEET(px, py)} > 0.5) { ${next} = ${withH(becomes, f(r.fly ? headingOf(...COPY_DIRS[k]) : 0))}; ${ng} = 0.0; }`));
    if (!r.keep) L.push(`else if (${MEET(0, 0)} > 0.5) { ${next} = 0.0; ${ng} = ${P('afterglow')}; }`);
  } else if (r.kind === 'crowd' && !r.move) {
    L.push(`if (${ACTS(0, 0)} * step(${f(r.lo - 0.5)}, ${COUNT(0, 0)}) * ${ROLL(0, 0)} > 0.5) { ${next} = 0.0; ${ng} = ${P('afterglow')}; }`);
  } else if (r.kind === 'crowd') {
    // Each cell round this one that might step here: crowded, stepping away from its neighbours in exactly this direction.
    const away = (px: number, py: number, name: string) => {
      const ls = MOORE.map(([dx, dy]) => [dx, dy, LIVE(px + dx, py + dy)] as const);
      L.push(`float ${v(name + 'x')} = -sign(${ls.filter(x => x[0] !== 0).map(x => `${f(x[0])} * ${x[2]}`).join(' + ')});`);
      L.push(`float ${v(name + 'y')} = -sign(${ls.filter(x => x[1] !== 0).map(x => `${f(x[1])} * ${x[2]}`).join(' + ')});`);
    };
    MOORE.forEach(([dx, dy], k) => {
      away(-dx, -dy, `p${k}`);
      L.push(`float ${v(`p${k}`)} = ${ACTS(-dx, -dy)} * step(${f(r.lo - 0.5)}, ${COUNT(-dx, -dy)}) * (abs(${v(`p${k}x`)} - ${f(dx)}) < 0.5 && abs(${v(`p${k}y`)} - ${f(dy)}) < 0.5 ? 1.0 : 0.0) * ${INSIDE(0, 0)} * ${ROLL(-dx, -dy)};`);
    });
    away(0, 0, 'self');
    const tgt = `vec2(${v('selfx')}, ${v('selfy')})`;
    const insideT = wrap ? '1.0' : `(step(0.5, ${cell}.x + ${v('selfx')}) * step(0.5, ${cell}.y + ${v('selfy')}) * step(${cell}.x + ${v('selfx')}, ${res}.x - 1.5) * step(${cell}.y + ${v('selfy')}, ${res}.y - 1.5))`;
    L.push(`float ${v('self')} = ${ACTS(0, 0)} * step(${f(r.lo - 0.5)}, ${COUNT(0, 0)}) * (abs(${v('selfx')}) + abs(${v('selfy')}) > 0.5 ? 1.0 : 0.0) * (floor(${rd(tgt)}.r + 0.5) < 0.5 ? 1.0 : 0.0) * ${insideT} * ${ROLL(0, 0)};`);
    L.push(`if (${s} < 0.5) {`);
    MOORE.forEach(([dx, dy], k) => L.push(`    ${k ? 'else ' : ''}if (${v(`p${k}`)} > 0.5) { ${next} = ${T(-dx, -dy)}.r; ${ng} = ${T(-dx, -dy)}.g; }`));
    L.push('}', `else if (${v('self')} > 0.5) { ${next} = 0.0; ${ng} = 0.0; }`);
  } else if (r.kind === 'drift') {
    const [dx, dy] = DIRECTIONS[r.dir].d;
    L.push(`float ${v('in')} = ${SEL(-dx, -dy)} * ${INSIDE(0, 0)} * ${ROLL(-dx, -dy)};`);
    L.push(`float ${v('out')} = ${SEL(0, 0)} * (${ST(dx, dy)} < 0.5 ? 1.0 : 0.0) * ${INSIDE(dx, dy)} * ${ROLL(0, 0)};`);
    L.push(`if (${s} < 0.5 && ${v('in')} > 0.5) { ${next} = ${T(-dx, -dy)}.r; ${ng} = ${T(-dx, -dy)}.g; }`);
    L.push(`else if (${v('out')} > 0.5) { ${next} = 0.0; ${ng} = 0.0; }`);
  } else if (r.kind === 'cluster') {
    const R = r.radius;
    L.push(
      `float ${v('n')} = 0.0;`,
      `for (int ${v('dy')} = -${R}; ${v('dy')} <= ${R}; ${v('dy')}++) {`,
      `    for (int ${v('dx')} = -${R}; ${v('dx')} <= ${R}; ${v('dx')}++) {`,
      `        float ${v('q')} = floor(${rd(`vec2(float(${v('dx')}), float(${v('dy')}))`)}.r + 0.5);`,
      `        ${v('n')} += (${v('dx')} == 0 && ${v('dy')} == 0) ? 0.0 : (abs(${v('q')} - 1.0) < 0.5 ? 1.0 : 0.0);`,
      '    }',
      '}',
      `if (${ACTS(0, 0)} * step(${f(r.lo - 0.5)}, ${v('n')}) * ${ROLL(0, 0)} > 0.5) { ${next} = ${withH(becomes, HD(0, 0))}; ${ng} = ${becomes} < 0.5 ? ${P('afterglow')} : 0.0; }`,
    );
  } else if (r.kind === 'move') {
    // A mover's heading (its own, or one it takes), and whether it moves this step (its roll).
    const HE = (dx: number, dy: number) => once(v(`E${tag(dx, dy)}`), 'float', () => {
      const given = r.assign < 0 ? '0.0' : r.assign > 0 ? f(r.assign) : `(1.0 + floor(${dice(dx, dy, stackSalt(j) + 1)} * 8.0))`;
      return `${HD(dx, dy)} > 0.5 ? ${HD(dx, dy)} : ${given}`;
    });
    const ACT = (dx: number, dy: number) => once(v(`A${tag(dx, dy)}`), 'float', () => `${SEL(dx, dy)} * step(0.5, ${HE(dx, dy)}) * ${ROLL(dx, dy)}`);
    /** Does the mover at c + q head for c? */
    const toward = (cx: number, cy: number, qx: number, qy: number) => `${ACT(cx + qx, cy + qy)} * ${is(HE(cx + qx, cy + qy), headingOf(-qx, -qy))}`;
    const CLAIM = (cx: number, cy: number) => once(v(`C${tag(cx, cy)}`), 'float', () => MOORE.map(([qx, qy]) => toward(cx, cy, qx, qy)).join(' + '));
    const free = DIRECTIONS.map(({ d: [dx, dy] }, k) => `${is(HE(0, 0), k + 1)} * (${ST(dx, dy)} < 0.5 ? 1.0 : 0.0) * ${INSIDE(dx, dy)} * ${is(CLAIM(dx, dy), 1)}`);
    L.push(`float ${v('free')} = ${free.join(' + ')};`);
    ACT(0, 0); CLAIM(0, 0);
    const blocked = r.act === 'bounce' ? rev(HE(0, 0)) : r.act === 'turn' ? turn(HE(0, 0)) : HE(0, 0);
    L.push(`if (${s} < 0.5) {`, `    if (${INSIDE(0, 0)} * ${is(CLAIM(0, 0), 1)} > 0.5) {`);
    MOORE.forEach(([qx, qy], k) => L.push(`        ${k ? 'else ' : ''}if (${toward(0, 0, qx, qy)} > 0.5) { ${next} = ${withH(ST(qx, qy), HE(qx, qy))}; ${ng} = ${T(qx, qy)}.g; }`));
    L.push('    }', '}');
    L.push(`else if (${ACT(0, 0)} > 0.5) {`, `    if (${v('free')} > 0.5) { ${next} = 0.0; ${ng} = 0.0; }`, `    else ${next} = ${withH(s, blocked)};`, '}');
  } else {
    // collide: movers (a heading of their own), the cells two head for, head-on pairs, and where they meet.
    const MV = (dx: number, dy: number) => once(v(`V${tag(dx, dy)}`), 'float', () => `${SEL(dx, dy)} * step(0.5, ${HD(dx, dy)})`);
    const toward = (cx: number, cy: number, qx: number, qy: number) => `${MV(cx + qx, cy + qy)} * ${is(HD(cx + qx, cy + qy), headingOf(-qx, -qy))}`;
    const CLAIM = (cx: number, cy: number) => once(v(`C${tag(cx, cy)}`), 'float', () => MOORE.map(([qx, qy]) => toward(cx, cy, qx, qy)).join(' + '));
    const CON = (cx: number, cy: number) => once(v(`K${tag(cx, cy)}`), 'float', () => `(${ST(cx, cy)} < 0.5 ? 1.0 : 0.0) * ${INSIDE(cx, cy)} * step(1.5, ${CLAIM(cx, cy)})`);
    /** The mover at p and the one ahead of it in direction k + 1 face each other. */
    const facing = (px: number, py: number, k: number) => { const [dx, dy] = DIRECTIONS[k].d; return `${is(HD(px, py), k + 1)} * ${MV(px + dx, py + dy)} * ${is(HD(px + dx, py + dy), reverseHeading(k + 1))}`; };
    const HO = (px: number, py: number) => once(v(`O${tag(px, py)}`), 'float', () => `${MV(px, py)} * (${DIRECTIONS.map((_, k) => facing(px, py, k)).join(' + ')})`);
    const MEET = (px: number, py: number) => once(v(`M${tag(px, py)}`), 'float', () => `(${CON(px, py)} + ${HO(px, py)} * step(${HD(px, py)}, 4.5)) * ${ROLL(px, py)}`);
    // Does this mover collide: head-on (the pair's meeting cell is the one heading 1–4) or into a contested cell?
    const hit = DIRECTIONS.map(({ d: [dx, dy] }, k) => `${is(HD(0, 0), k + 1)} * (${facing(0, 0, k)} * ${k + 1 <= 4 ? ROLL(0, 0) : ROLL(dx, dy)} + ${CON(dx, dy)} * ${ROLL(dx, dy)})`);
    L.push(`float ${v('hit')} = ${MV(0, 0)} * (${hit.join(' + ')});`);
    // Declared here, before the if / else chain below reads them.
    const h0 = HD(0, 0);
    HO(0, 0); CON(0, 0); ROLL(0, 0); CLAIM(0, 0);
    const srcs = COPY_DIRS.slice(0, r.copies).map(([dx, dy]) => [-dx * r.distance, -dy * r.distance] as [number, number]);
    if (r.act === 'explode') { srcs.forEach(([px, py]) => MEET(px, py)); MEET(0, 0); }
    let onHit: string;
    if (r.act === 'bounce') onHit = `${next} = ${withH(s, rev(h0))};`;
    else if (r.act === 'turn') onHit = `${next} = ${withH(s, turn(h0))};`;
    else if (r.act === 'stop') onHit = `${next} = ${s};`;
    else if (r.act === 'merge') onHit = `if (${HO(0, 0)} * step(${h0}, 4.5) > 0.5) ${next} = ${s}; else { ${next} = 0.0; ${ng} = 0.0; }`;
    else onHit = `${next} = 0.0; ${ng} = ${P('afterglow')};`;
    L.push(`if (${v('hit')} > 0.5) { ${onHit} }`);
    if (r.act === 'merge') {
      // A contested cell takes one cell: the first claimant's state, heading the way their headings add up to.
      const sx = MOORE.map(([qx, qy]) => `${f(-qx)} * ${toward(0, 0, qx, qy)}`).join(' + ');
      const sy = MOORE.map(([qx, qy]) => `${f(-qy)} * ${toward(0, 0, qx, qy)}`).join(' + ');
      L.push(`else if (${CON(0, 0)} * ${ROLL(0, 0)} > 0.5) {`, `    float ${v('mh')} = grHeadingOf(vec2(${sx}, ${sy}));`);
      MOORE.forEach(([qx, qy], k) => L.push(`    ${k ? 'else ' : ''}if (${toward(0, 0, qx, qy)} > 0.5) ${next} = ${withH(ST(qx, qy), v('mh'))};`));
      L.push(`    ${ng} = 0.0;`, '}');
    } else if (r.act === 'explode') {
      L.push(`else if (${s} < 0.5 && ${INSIDE(0, 0)} > 0.5 && ${MEET(0, 0)} < 0.5) {`);
      srcs.forEach(([px, py], k) => L.push(`    ${k ? 'else ' : ''}if (${MEET(px, py)} > 0.5) { ${next} = ${withH(becomes, f(r.fly ? headingOf(...COPY_DIRS[k]) : 0))}; ${ng} = 0.0; }`));
      L.push('}');
    }
  }
  if (!wrap) {
    L.push(
      `float ${v('ins')} = step(0.5, ${cell}.x) * step(0.5, ${cell}.y) * step(${cell}.x, ${res}.x - 1.5) * step(${cell}.y, ${res}.y - 1.5);`,
      `${next} = ${next} * ${v('ins')};`, `${ng} = ${ng} * ${v('ins')};`,
    );
  }
  // Only after a real step of the base (its mark in blue); otherwise the board goes on as it is.
  L.push(`if (${me}.b < 1.5) { ${next} = ${me}.r; ${ng} = ${me}.g; }`);
  L.push(`${id}_out = vec3(${next}, ${ng}, ${me}.b);`, `${id}_outA = ${me}.a;`);
  return L;
}
