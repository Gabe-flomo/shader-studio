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

/** Registered types that are never offered for adding (their saved nodes still work). */
export const NOT_OFFERED: ReadonlySet<string> = new Set(OFFER_PIECES ? [] : PIECES_TYPES);

export const isOffered = (type: string): boolean => !NOT_OFFERED.has(type);
