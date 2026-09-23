// Shared node-category metadata — split out from NodeSearchPalette.tsx so
// that file can keep exporting only its component (Vite's fast-refresh
// boundary warns when a component file also exports plain constants).

// ── Category accent colours (matches NodePalette) ─────────────────────────────
export const CATEGORY_COLORS: Record<string, string> = {
  Sources:         '#89b4fa',
  Transforms:      '#a6e3a1',
  Math:            '#b4befe',
  Color:           '#fab387',
  Noise:           '#74c7ec',
  Effects:         '#f38ba8',
  Loops:           '#89dceb',
  '2D Primitives': '#f9e2af',
  SDF:             '#f5c2e7',
  Combiners:       '#cba6f7',
  Spaces:          '#f2cdcd',
  Science:         '#94e2d5',
  'Group Presets': '#f9e2af',
  Output:          '#94e2d5',
};

// ── Types to hide from node listings (internal / special) ─────────────────────
export const HIDDEN_TYPES = new Set(['group', 'forwardCamera', 'marchPos', 'marchDist', 'marchOutput', 'scenePos', 'sceneOutput', 'spaceWarpGroup']);
