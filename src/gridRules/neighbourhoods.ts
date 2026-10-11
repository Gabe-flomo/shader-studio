/**
 * neighbourhoods.ts — a neighbourhood you draw yourself (docs/grid-rules.md "Your own
 * neighbourhood"): Count and Stages rules with `neighbourhood: 'custom'` count the cells of a
 * stencil (the node's `stencil` param) instead of the 8 round, the 4 beside or a radius.
 *
 * A stencil is a square of cells, 3, 5 or 7 across, row by row from the top, each a weight: 0 not
 * counted, 1 counted once, 2 or 3 counted that many times. The middle is this cell, never counted.
 * A cell's count is the sum of the weights of its live neighbours, so Born and Survive work on it
 * as on any count; the most it can count is the sum of the weights.
 *
 * The GLSL unrolls one read a counted cell (gridRules/glsl.ts), the CPU step adds the same weights
 * (gridRules/cpu.ts): the try board and the node agree step for step (gridRulesCustomNb.test.ts).
 * Pure.
 */

export interface NeighbourStencil {
  /** Cells across (and down): 3, 5 or 7. */
  size: number;
  /** size × size weights, the top row first; the middle is ignored. */
  cells: number[];
}

export const STENCIL_SIZES = [3, 5, 7] as const;
/** The largest weight a cell can have. */
export const MAX_WEIGHT = 3;
/**
 * Born and Survive are bit masks (switches) up to this count; above it they are ranges, as a radius
 * rule's (a mask is a float uniform, exact to 2^24).
 */
export const MASK_MAX_COUNT = 23;

const clampSize = (n: unknown) => (STENCIL_SIZES as readonly number[]).includes(Number(n)) ? Number(n) : 3;

/** A stencil from rows of weights (top first, odd and square); used by the presets. */
export function stencilFromRows(rows: string[]): NeighbourStencil {
  const size = clampSize(rows.length);
  const cells: number[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) cells.push(Math.max(0, Math.min(MAX_WEIGHT, Number(rows[r]?.[c] === '.' ? 0 : rows[r]?.[c] ?? 0) || 0)));
  cells[(size * size - 1) / 2] = 0;
  return { size, cells };
}

/** The stencils to start from. Moore and von Neumann count exactly what the built-in ones count. */
export const STENCIL_PRESETS: Record<string, { label: string; hint: string; stencil: NeighbourStencil }> = {
  moore: { label: 'Moore', hint: 'The 8 round it: the same as the built-in Moore (Life\'s).', stencil: stencilFromRows(['111', '1.1', '111']) },
  vonNeumann: { label: 'von Neumann', hint: 'The 4 beside it: the same as the built-in von Neumann.', stencil: stencilFromRows(['.1.', '1.1', '.1.']) },
  hex: { label: 'Hex-ish', hint: 'Six neighbours: the 8 round it less two opposite corners, the way a hexagonal grid sits on a square one.', stencil: stencilFromRows(['.11', '1.1', '11.']) },
  ring: { label: 'Ring', hint: 'The 16 cells two steps out, and none of the 8 next to it: rules see further than they touch.', stencil: stencilFromRows(['11111', '1...1', '1...1', '1...1', '11111']) },
  cross: { label: 'Cross', hint: 'Two cells each way up, down, left and right: 8 in a plus.', stencil: stencilFromRows(['..1..', '..1..', '11.11', '..1..', '..1..']) },
};

export const DEFAULT_STENCIL: NeighbourStencil = STENCIL_PRESETS.moore.stencil;

/** A stored stencil read defensively (sizes 3, 5, 7; weights 0–3; the middle 0). */
export function readStencil(v: unknown): NeighbourStencil {
  const x = (v && typeof v === 'object' ? v : {}) as Partial<NeighbourStencil>;
  if (!Array.isArray(x.cells)) return { size: DEFAULT_STENCIL.size, cells: [...DEFAULT_STENCIL.cells] };
  const size = clampSize(x.size);
  const cells = Array.from({ length: size * size }, (_, i) => Math.max(0, Math.min(MAX_WEIGHT, Math.round(Number(x.cells![i]) || 0))));
  cells[(size * size - 1) / 2] = 0;
  return { size, cells };
}

/** The counted cells: offset (x right, y up) and weight, clockwise rows from the top. */
export function stencilWeights(st: NeighbourStencil): Array<[number, number, number]> {
  const r = (st.size - 1) / 2;
  const out: Array<[number, number, number]> = [];
  st.cells.forEach((w, i) => {
    if (!w) return;
    const dx = (i % st.size) - r, dy = r - Math.floor(i / st.size);
    if (dx === 0 && dy === 0) return;
    out.push([dx, dy, w]);
  });
  return out;
}

/** The most the stencil can count (every counted cell live). */
export const stencilMax = (st: NeighbourStencil) => stencilWeights(st).reduce((s, [, , w]) => s + w, 0);

/** Whether Born and Survive are ranges (too many counts for switches). */
export const stencilUsesRanges = (st: NeighbourStencil) => stencilMax(st) > MASK_MAX_COUNT;

/** The stencil grown or shrunk to `size`, keeping the middle where it is. */
export function resizeStencil(st: NeighbourStencil, size: number): NeighbourStencil {
  const n = clampSize(size);
  const r0 = (st.size - 1) / 2, r1 = (n - 1) / 2;
  const cells = Array.from({ length: n * n }, (_, i) => {
    const dx = (i % n) - r1, dy = Math.floor(i / n) - r1;
    if (Math.abs(dx) > r0 || Math.abs(dy) > r0) return 0;
    return st.cells[(dy + r0) * st.size + (dx + r0)] ?? 0;
  });
  cells[(n * n - 1) / 2] = 0;
  return { size: n, cells };
}

/** The preset this stencil is (its key), or null. */
export function matchingStencil(st: NeighbourStencil): string | null {
  const key = (s: NeighbourStencil) => stencilWeights(s).map(x => x.join(',')).sort().join(';');
  const mine = key(st);
  return Object.entries(STENCIL_PRESETS).find(([, p]) => key(p.stencil) === mine)?.[0] ?? null;
}

/** One line on a stencil: "12 cells, weights up to 2 · counts 0–16". */
export function stencilSummary(st: NeighbourStencil): string {
  const ws = stencilWeights(st);
  const preset = matchingStencil(st);
  const heavy = ws.some(([, , w]) => w > 1);
  return `${preset ? `${STENCIL_PRESETS[preset].label}: ` : ''}${ws.length} cell${ws.length === 1 ? '' : 's'}${heavy ? ' (weighted)' : ''} · counts 0–${stencilMax(st)}`;
}
