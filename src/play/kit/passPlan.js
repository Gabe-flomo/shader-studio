// passPlan.js — the frame schedule for Pass nodes (docs/pass-node-plan.md).
//
// Pure: no GPU. The app (src/lib/passRunner.ts, three.js) and web pages
// (kit/passHost.js, the page's own WebGL2) both run their passes by it, the
// way Finish and the JFA share code between hosts, so the two can't drift.
// A pass is { slug, scale, live, previous, afterAgents? } from the compile
// (compiler/types.ts PassProgram), already in drawing order.

/** A pass's texture size for a picture of w × h: scale × the picture, at least 1 × 1. */
export function ppSize(w, h, scale) {
  const s = scale > 0 ? scale : 1;
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** The passes drawn this frame, in order: those the picture needs (directly or through other passes). */
export function ppDrawn(passes) {
  return passes.filter(p => p.live);
}

/**
 * Of the passes drawn this frame, those a stage draws, in order. Without a stage (a graph
 * without agents) every one; with agents the frame draws them in two stages: 'pre' (before
 * the agents step: the passes the agents read) and 'post' (those that read a Trail or a
 * Draw agents, so they draw after it).
 */
export function ppStaged(drawn, stage) {
  return stage ? drawn.filter(p => (stage === 'post') === !!p.afterAgents) : drawn;
}

/** One picture pixel in a texture's 0–1 coordinates (the `_px` uniforms). */
export function ppPixel(w, h) {
  return [1 / Math.max(1, w), 1 / Math.max(1, h)];
}

/**
 * A key for a pass's targets: when it changes (size, format, filter, wrap or
 * whether it keeps a previous frame) the targets are made again and the
 * previous frame starts black.
 */
export function ppTargetKey(p, w, h) {
  const [tw, th] = ppSize(w, h, p.scale);
  return `${tw}x${th}:${p.format}:${p.filter}:${p.wrap}:${p.previous ? 2 : 1}`;
}
