/**
 * Surprise — seeded randomness for "Surprise me", "Randomise" and the shared language's
 * `random`, `random(a..b)` and surprise lines. The API is documented in docs/surprise.md.
 *
 *   rng.ts         makeRng(seed): float, logFloat, int, chance, pick, weighted, sample, shuffle, fork;
 *                  newSeed, seedFrom (typed text → seed), deriveSeed (retry n), weightedChoice
 *   ranges.ts      interestingRange(key, legal, nodeType), sampleRange, randomValue,
 *                  INTERESTING_RANGES, registerInterestingRanges, neverRandomise
 *   colour.ts      harmoniousPalette, randomColour, darkBackground, lightBackground, rampPalette, hslToRgb
 *   degenerate.ts  frameStats (RGBA → stats), degenerateReason, withRetries / withRetriesAsync, statsJudge
 */
export * from './rng';
export * from './ranges';
export * from './colour';
export * from './degenerate';
