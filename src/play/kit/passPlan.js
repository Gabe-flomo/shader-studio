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
 *
 * `part` (only when some drawn pass is beforeParticles: ppSplitsForParticles) splits the
 * frame round the Particles step: 'particles' draws the passes the particles read first
 * (none of them is afterAgents), 'rest' the others in their stages. Without it, as before.
 */
export function ppStaged(drawn, stage, part) {
  const staged = stage ? drawn.filter(p => (stage === 'post') === !!p.afterAgents) : drawn;
  return part ? staged.filter(p => (part === 'particles') === !!p.beforeParticles) : staged;
}

/** Some pass the frame draws is read by the particles: the host draws those first (part 'particles'), then the rest. */
export function ppSplitsForParticles(drawn) {
  return drawn.some(p => p.beforeParticles);
}

/**
 * The passes whose Previous sampler a call (stage, part) binds: those not yet drawn this frame.
 * A pass drawn in an earlier call has swapped its ping-pong, so its "previous" is now this frame's
 * picture: its sampler keeps what the earlier call bound (the frame before), for every program after.
 */
export function ppPrevBound(drawn, stage, part) {
  const split = !!part && ppSplitsForParticles(drawn);
  const order = p => (split && p.beforeParticles ? 0 : stage && p.afterAgents ? 2 : 1);
  const now = part === 'particles' ? 0 : stage === 'post' ? 2 : 1;
  return drawn.filter(p => order(p) >= now);
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

/**
 * A frame's steps before its picture, in order: the same in the app's live preview and on
 * exported pages, so neither reads a texture before the frame has drawn it. o: { passes, split (ppSplitsForParticles), particles,
 * agents } (booleans: what the graph has). The passes the particles read, the particles; with
 * agents, the passes they read ('pre'), the agents' steps, the passes after them ('post');
 * else the passes. The last 'passes' step is marked `last` (its Pass card thumbnails are drawn
 * after it). The picture itself comes after these.
 */
export function ppFrameSteps(o) {
  const part = o.passes && o.split ? 'rest' : undefined;
  const steps = [];
  if (o.passes && o.split) steps.push({ do: 'passes', part: 'particles' });
  if (o.particles) steps.push({ do: 'particles' });
  if (o.agents) {
    if (o.passes) steps.push({ do: 'passes', stage: 'pre', part });
    steps.push({ do: 'agents' });
    if (o.passes) steps.push({ do: 'passes', stage: 'post', part });
  } else if (o.passes) steps.push({ do: 'passes', part });
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].do === 'passes') { steps[i].last = true; break; }
  return steps;
}
