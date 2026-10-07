/**
 * explain.ts — the words and pictures the Grid Rules editor uses to explain a Count / Stages rule
 * (components/gridRules/BornSurvive.tsx):
 *
 *  - neighbourPicture: a 3×3 picture of "a cell with k live neighbours" for each Born / Survive switch
 *    (the centre empty on the Born row, live on the Survive row).
 *  - countLabel: the switch's words ("empty + 3 neighbours → comes alive", "live + 4 → dies (too crowded)").
 *  - ruleSentence: the whole rule as one sentence, kept up to date as the switches change.
 *  - countedCells: a neighbourhood (Moore, von Neumann, a radius box or circle) as highlighted cells.
 *  - TEST_PATTERNS / patternCells: the small shapes the mini-board starts from (Glider, Blinker…).
 *
 * Pure: no React, so the tests read it directly.
 */
import { neighbourOffsets, type Neighbourhood, type RadiusShape } from './spec';
import { cpuBoard, type CpuBoard } from './cpu';

// ── 3×3 pictures ────────────────────────────────────────────────────────────────────────────────

/** A cell of a picture: live, empty, or not counted at all (a von Neumann corner). */
export type PictureCell = 'live' | 'empty' | 'unused';

/** Moore: the ring filled clockwise from the top left (row-major indices; 4 is the centre). */
export const MOORE_FILL = [0, 1, 2, 5, 8, 7, 6, 3] as const;
/** von Neumann: up, right, down, left. */
export const VON_NEUMANN_FILL = [1, 5, 7, 3] as const;

/**
 * Nine cells, row by row: the centre (index 4) live or empty, `n` of its neighbours live. Cells the
 * neighbourhood doesn't count (von Neumann's corners) are 'unused'.
 */
export function neighbourPicture(n: number, nb: 'moore' | 'vonNeumann' = 'moore', centreLive = false): PictureCell[] {
  const fill: readonly number[] = nb === 'vonNeumann' ? VON_NEUMANN_FILL : MOORE_FILL;
  const k = Math.max(0, Math.min(fill.length, Math.round(n)));
  const out: PictureCell[] = Array.from({ length: 9 }, (_, i) => (fill.includes(i) ? 'empty' : 'unused'));
  for (let j = 0; j < k; j++) out[fill[j]] = 'live';
  out[4] = centreLive ? 'live' : 'empty';
  return out;
}

/**
 * A neighbourhood as a square of cells (2r + 1 across; r = 1 for Moore and von Neumann): true where
 * a cell is counted. The centre is never counted.
 */
export function countedCells(nb: Neighbourhood, radius = 1, shape: RadiusShape = 'box'): { size: number; cells: boolean[] } {
  const offs = neighbourOffsets(nb, radius, shape);
  const r = Math.max(1, ...offs.map(([dx, dy]) => Math.max(Math.abs(dx), Math.abs(dy))));
  const size = 2 * r + 1;
  const cells = Array.from({ length: size * size }, () => false);
  for (const [dx, dy] of offs) cells[(dy + r) * size + (dx + r)] = true;
  return { size, cells };
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────

/** What happens to a live cell with k neighbours. */
export type SurviveFate = 'survives' | 'lonely' | 'crowded' | 'dies';

export function surviveFate(k: number, survive: number[]): SurviveFate {
  if (survive.includes(k)) return 'survives';
  if (!survive.length) return 'dies';
  if (k < Math.min(...survive)) return 'lonely';
  if (k > Math.max(...survive)) return 'crowded';
  return 'dies';
}

const plural = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

/** A Born or Survive switch in words. Stages rules start dying instead of dying. */
export function countLabel(row: 'born' | 'survive', k: number, born: number[], survive: number[], stages = false): string {
  if (row === 'born') return born.includes(k) ? `empty + ${plural(k, 'neighbour')} → comes alive` : `empty + ${plural(k, 'neighbour')} → stays empty`;
  const die = stages ? 'starts dying' : 'dies';
  switch (surviveFate(k, survive)) {
    case 'survives': return `live + ${k} → stays alive`;
    case 'lonely': return stages ? `live + ${k} → starts dying (lonely)` : `live + ${k} → dies of loneliness`;
    case 'crowded': return `live + ${k} → ${die} (too crowded)`;
    default: return `live + ${k} → ${die}`;
  }
}

const contiguous = (xs: number[]) => xs.every((x, i) => i === 0 || x === xs[i - 1] + 1);

/** "exactly 3", "2 or 3", "3, 6 or 8", "4 to 8". */
export function formatCounts(counts: number[]): string {
  const xs = [...new Set(counts)].sort((a, b) => a - b);
  if (xs.length === 0) return 'no count';
  if (xs.length === 1) return `exactly ${xs[0]}`;
  if (xs.length >= 3 && contiguous(xs)) return `${xs[0]} to ${xs[xs.length - 1]}`;
  return `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

/** Every whole number from lo to hi (a Larger than Life range). */
export const rangeCounts = (lo: number, hi: number) => (hi < lo ? [] : Array.from({ length: Math.round(hi) - Math.round(lo) + 1 }, (_, i) => Math.round(lo) + i));

/**
 * The rule in one sentence, e.g. Life: "Cells are born with exactly 3 neighbours and survive with
 * 2 or 3; fewer and they die of loneliness, more and they die of crowding."
 */
export function ruleSentence(o: { born: number[]; survive: number[]; max: number; stages?: boolean; states?: number }): string {
  const born = [...new Set(o.born)].filter(k => k >= 0 && k <= o.max).sort((a, b) => a - b);
  const survive = [...new Set(o.survive)].filter(k => k >= 0 && k <= o.max).sort((a, b) => a - b);
  const die = o.stages ? 'start dying' : 'die';
  const bornPart = !born.length ? 'Nothing is ever born'
    : born.length === o.max + 1 ? 'Every empty cell comes alive'
    : `Cells are born with ${formatCounts(born)} ${born.length === 1 && born[0] === 1 ? 'neighbour' : 'neighbours'}`;
  let survivePart: string;
  let tail = '';
  if (!survive.length) survivePart = o.stages ? 'every live cell starts dying the next step' : 'no live cell survives a step';
  else if (survive.length === o.max + 1) survivePart = 'live cells survive with any count';
  else {
    survivePart = `survive with ${formatCounts(survive)}`;
    if (!contiguous(survive)) tail = `; any other count and they ${die}`;
    else {
      const lonely = survive[0] > 0, crowded = survive[survive.length - 1] < o.max;
      const fewer = `fewer and they ${die} of loneliness`, more = `more and they ${die} of crowding`;
      tail = lonely && crowded ? `; ${fewer}, ${more}` : lonely ? `; ${fewer}` : crowded ? `; ${more}` : '';
    }
  }
  // "Nothing is ever born and survive with…" doesn't read: name the live cells when the subject changed.
  const join = born.length && born.length !== o.max + 1 ? ' and ' : ', and live cells ';
  const s = survivePart.startsWith('survive') ? `${bornPart}${join}${survivePart}${tail}.` : `${bornPart}, and ${survivePart}${tail}.`;
  const dying = o.stages ? Math.max(0, Math.round(o.states ?? 3) - 2) : 0;
  return dying > 0 ? `${s} A dying cell fades through ${plural(dying, 'stage')} before it is empty.` : s;
}

// ── Test patterns for the mini-board ────────────────────────────────────────────────────────────

export const TEST_PATTERNS = [
  { key: 'glider', label: 'Glider', hint: 'Five cells that walk diagonally in Life.' },
  { key: 'blinker', label: 'Blinker', hint: 'Three in a row: flips between across and down in Life.' },
  { key: 'rpentomino', label: 'R-pentomino', hint: 'Five cells that grow for over a thousand steps in Life.' },
  { key: 'blob', label: 'Random blob', hint: 'A random disc of cells.' },
] as const;
export type TestPattern = (typeof TEST_PATTERNS)[number]['key'];

/** A pattern's live cells as [x, y] offsets from the board's centre (y down, as drawn). */
export function patternCells(p: TestPattern, rnd: () => number = Math.random): Array<[number, number]> {
  switch (p) {
    case 'glider': return [[0, -1], [1, 0], [-1, 1], [0, 1], [1, 1]];
    case 'blinker': return [[-1, 0], [0, 0], [1, 0]];
    case 'rpentomino': return [[0, -1], [1, -1], [-1, 0], [0, 0], [0, 1]];
    case 'blob': {
      const out: Array<[number, number]> = [];
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 17 && rnd() < 0.5) out.push([x, y]);
      return out;
    }
  }
}

/** A board with one test pattern in the middle (rows go up the board, so the pattern's y is flipped). */
export function patternBoard(p: TestPattern, w = 32, h = 32, rnd: () => number = Math.random): CpuBoard {
  const B = cpuBoard(w, h);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (const [dx, dy] of patternCells(p, rnd)) {
    const x = cx + dx, y = cy - dy;
    if (x >= 0 && y >= 0 && x < w && y < h) B.a[y * w + x] = 1;
  }
  return B;
}

/** How many cells are on (state 1). */
export const liveCount = (B: CpuBoard) => B.a.reduce((n, v) => n + (Math.round(v) === 1 ? 1 : 0), 0);
