/**
 * notOffered.ts — node types that are hidden, not deleted (docs/pieces.md, "Hidden").
 *
 * Pieces (2D) and Balls (3D) were hidden on 2026-10-11: they aren't offered in the node
 * browser, search, the Do bar, Switch to, the builders' menus or the examples, but every graph,
 * scene and recipe that already uses them loads, builds and renders exactly as before (the
 * definitions stay registered; only the places that *offer* nodes read this file).
 *
 * To bring them back, set OFFER_PIECES to true.
 */
export const OFFER_PIECES = false;

/** The Pieces family's node types. */
export const PIECES_TYPES: readonly string[] = ['pieces', 'pieceBalls'];

/**
 * The 2026-10-17 effects sweep (docs/node-retirements.md): one node per effect, the texture version where
 * there is one. These couldn't be mapped exactly onto their survivor, so they stay registered (saved graphs
 * load and render as before) but are offered nowhere. The ones that could map exactly are aliases now
 * (definitions/aliases.ts) and are gone from the registry.
 *  - Point Light 2D → SDF Glow, Point light mode (it measured its own distance from UV and Light Pos).
 *  - Chroma Shift (a fake fringe from the colour's slope) and Chromatic Aberration (three offset UVs) →
 *    Chromatic Aberration (lens) on a Pass of the picture.
 */
export const SWEPT_EFFECT_TYPES: readonly string[] = ['light2d', 'chromaShift', 'chromaticAberration'];

/**
 * Retired for good: Ride a curve (its curves built in) gave way on 2026-10-15 to Ride a path, which rides
 * any wired shape's outline (agentRidePath.ts); saved graphs with a Ride a curve still load and run.
 * Audio Input (a file with per-band floats) gave way on 2026-10-17 to the Audio nodes (docs/audio-tools.md): Audio
 * Source wired into Band level, Hit, Spectrum…; saved graphs with an Audio Input still load and play.
 */
export const RETIRED_TYPES: readonly string[] = ['agentRideCurve', 'audioInput', ...SWEPT_EFFECT_TYPES];

/** Registered types that are never offered for adding (their saved nodes still work). */
export const NOT_OFFERED: ReadonlySet<string> = new Set([...(OFFER_PIECES ? [] : PIECES_TYPES), ...RETIRED_TYPES]);

export const isOffered = (type: string): boolean => !NOT_OFFERED.has(type);
