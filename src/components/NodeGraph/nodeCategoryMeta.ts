import { ctp } from '../../theme/palette';
// Shared node-category metadata — split out from NodeSearchPalette.tsx so
// that file can keep exporting only its component (Vite's fast-refresh
// boundary warns when a component file also exports plain constants).

// ── Category accent colours (matches NodePalette) ─────────────────────────────
export const CATEGORY_COLORS: Record<string, string> = {
  Sources:         ctp.blue,
  Transforms:      ctp.green,
  Math:            ctp.lavender,
  Color:           ctp.peach,
  Noise:           ctp.sapphire,
  Effects:         ctp.red,
  Loops:           ctp.sky,
  '2D Primitives': ctp.yellow,
  SDF:             ctp.pink,
  Combiners:       ctp.mauve,
  Spaces:          ctp.flamingo,
  Science:         ctp.teal,
  'Group Presets': ctp.yellow,
  Output:          ctp.teal,
};

// ── Types to hide from node listings (internal / special) ─────────────────────
export const HIDDEN_TYPES = new Set(['group', 'forwardCamera', 'marchPos', 'marchDist', 'marchOutput', 'scenePos', 'sceneOutput', 'spaceWarpGroup']);
