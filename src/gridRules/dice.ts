/**
 * dice.ts — the Blocks (Margolus) rule's dice and block layout, written twice: as GLSL for the
 * board's step (gridRules/glsl.ts, and Open as nodes) and as TypeScript for the editor's CPU preview
 * (gridRules/cpu.ts). The two give the same answers, bit for bit (docs/grid-rules.md, Jitter).
 *
 * The dice: a whole-number hash in 0…2047. Every value along the way is a whole number below 2^24
 * and every division is by a power of two, so float32 on the GPU holds each one exactly and the
 * GPU and the CPU roll the same numbers. Each round adds an input, applies x(2x + 1) mod 2048 (a
 * permutation of 0…2047) and rotates the 11 bits by 5, so the high bits depend on every input.
 *
 * The layout (Jitter): Margolus blocks tile the board in 2×2 blocks whose grid shifts one cell
 * diagonally every step. Every grain that falls in a step ends in its block's bottom row, so a cloud
 * of falling grains sits on every other row: horizontal bands. Jitter breaks the lockstep. The board
 * is cut into columns two cells wide (the blocks' columns this step) and each column into segments of
 * SEGMENT rows; each segment takes the step's row parity, or (with chance Jitter / 2) the other one.
 * A block exists where its two rows agree on the parity. Where two segments disagree, one row sits
 * out the step (it is in no block and stays as it is), so the blocks never overlap: every block still
 * changes all four of its cells at once, and a rule that rearranges keeps every count. Jitter 0 is
 * the classic Margolus grid; Jitter 1 gives each segment its own parity, at random each step.
 */

/** The dice's range: 0…DICE − 1. */
export const DICE = 2048;
/** Rows in a jitter segment (even). Short enough that bands can't form, long enough that few rows sit out. */
export const SEGMENT = 4;
/** Salt for the jitter dice (the rules' own use 31 + 2j and 32 + 2j). */
export const JITTER_SALT = 41;

/** x mod 2048, as GLSL's mod (never negative). */
const m = (x: number) => x - DICE * Math.floor(x / DICE);

/** One round: add v, permute, rotate. */
function round(h: number, v: number): number {
  h = m(h + m(v));
  h = m(h * (2 * h + 1));
  return m(h * 32) + Math.floor(h / 64);
}

/** A roll in [0, 1) for a block's key (its corner, wrapped), the frame, a salt and the node's Seed. */
export function grDice(kx: number, ky: number, frame: number, salt: number, seed: number): number {
  return round(round(round(round(round(salt, Math.floor(seed * 2)), kx), ky), frame), 1013) / DICE;
}

/** The frame number the dice use: the GPU's is mod(floor(time × 60), 997); the CPU's its step count. */
export const diceFrame = (step: number) => ((Math.floor(step) % 997) + 997) % 997;

/**
 * The row parity of the segment holding `row` in the block column whose key is `strip`: the step's
 * parity, flipped with chance jitter / 2. `row` is wrapped already where the board wraps.
 */
export function blockPhase(strip: number, row: number, par: number, jitter: number, frame: number, seed: number): number {
  const flip = grDice(strip, Math.floor(row / SEGMENT), frame, JITTER_SALT, seed) < jitter * 0.5 ? 1 : 0;
  return Math.abs(par - flip);
}

/** Does a block start at row r (rows r and r + 1) in this column? `wrapH`: the even rows, wrapping (0: walls). */
export function blockStartsAt(strip: number, r: number, par: number, jitter: number, frame: number, seed: number, wrapH: number): boolean {
  const key = (y: number) => (wrapH > 0 ? y - wrapH * Math.floor(y / wrapH) : y);
  const p = blockPhase(strip, key(r), par, jitter, frame, seed);
  const odd = r - 2 * Math.floor(r / 2);
  return odd === p && blockPhase(strip, key(r + 1), par, jitter, frame, seed) === p;
}

/**
 * The same, as GLSL. grBlockOf: this cell's block, as (its bottom-left corner x, y, 1 if the cell is
 * in a block this step, else 0). `W`: the board's even part; `wrap` 1 on a wrapping board.
 */
export const GR_DICE_GLSL = `float grMod2048(float x) { return x - 2048.0 * floor(x / 2048.0); }
float grRound(float h, float v) {
    float a = grMod2048(h + grMod2048(v));
    a = grMod2048(a * (2.0 * a + 1.0));
    return grMod2048(a * 32.0) + floor(a / 64.0);
}
float grDice(vec2 key, float frame, float salt, float seed) {
    return grRound(grRound(grRound(grRound(grRound(salt, floor(seed * 2.0)), key.x), key.y), frame), 1013.0) / 2048.0;
}
float grBlockPhase(float strip, float row, float par, float jitter, float frame, float seed) {
    float flip = grDice(vec2(strip, floor(row / ${SEGMENT}.0)), frame, ${JITTER_SALT}.0, seed) < jitter * 0.5 ? 1.0 : 0.0;
    return abs(par - flip);
}
vec3 grBlockOf(vec2 cell, float par, vec2 W, float jitter, float frame, float seed, float wrap) {
    float ox = floor((cell.x - par) * 0.5) * 2.0 + par;
    float strip = ox < 0.0 ? ox + W.x : ox;
    float y = cell.y;
    float p0 = grBlockPhase(strip, y, par, jitter, frame, seed);
    float bottom = mod(y - p0, 2.0) < 0.5 ? 1.0 : 0.0;
    float other = bottom > 0.5 ? y + 1.0 : y - 1.0;
    // Wrapped by hand, not with mod(): a division by the board's height can round the wrong way on a GPU.
    float row = wrap > 0.5 ? (other < 0.0 ? other + W.y : (other > W.y - 0.5 ? other - W.y : other)) : other;
    float p1 = grBlockPhase(strip, row, par, jitter, frame, seed);
    return vec3(ox, bottom > 0.5 ? y : y - 1.0, abs(p1 - p0) < 0.5 ? 1.0 : 0.0);
}`;
