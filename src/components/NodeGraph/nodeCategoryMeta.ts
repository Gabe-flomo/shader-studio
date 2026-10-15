import { NOT_OFFERED } from '../../nodes/notOffered';
import { ctp } from '../../theme/palette';
// Shared node-category metadata — split out from NodeSearchPalette.tsx so
// that file can keep exporting only its component (Vite's fast-refresh
// boundary warns when a component file also exports plain constants).

// ── Category accent colours (matches NodePalette) ─────────────────────────────
// Kept as Catppuccin roles so a theme-aware palette (theme/nodePalette.ts useCtp) can resolve them:
// Mocha on dark, Latte on light. CATEGORY_COLORS is the dark set, for render surfaces.
export const CATEGORY_ROLES: Record<string, keyof typeof ctp> = {
  Sources:         'blue',
  Transforms:      'green',
  Math:            'lavender',
  Color:           'peach',
  Noise:           'sapphire',
  Effects:         'red',
  Passes:          'maroon',
  Simulation:      'green',
  Loops:           'sky',
  '2D Primitives': 'yellow',
  SDF:             'pink',
  '2D Space':      'flamingo',
  Combiners:       'mauve',
  Spaces:          'flamingo',
  Science:         'teal',
  'Group Presets': 'yellow',
  'My Nodes':      'sky',
  Output:          'teal',
};

export const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_ROLES).map(([cat, role]) => [cat, ctp[role]]),
);

// ── Types to hide from node listings (internal / special) ─────────────────────
export const HIDDEN_TYPES = new Set(['group', 'forwardCamera', 'marchPos', 'marchDist', 'marchOutput', 'scenePos', 'sceneOutput', 'spaceWarpGroup', 'passOutput', 'blurStage', 'radialFastBlurStage', 'deepGlowTextureStage', 'gridRulesStep', 'curveTraceBeamStep', 'textureFeedbackStep', 'memoryPack', 'memoryRead', 'dataTexturePack', 'renderTargetsPack', 'baked', 'agentInputs', 'agentOutput', 'agentStepOut', 'trailStepOut', 'agentProbeOut', 'splatProbeOut', 'agentGridOut',
  // The Texture node's video / webcam side: Texture (textureInput) is offered, its Source switch makes this one.
  'videoInput',
  // Hidden, not deleted: Pieces and Balls (nodes/notOffered.ts; one flag brings them back).
  ...NOT_OFFERED]);
