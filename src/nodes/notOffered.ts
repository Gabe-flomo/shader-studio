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
 *  - Bloom (it glowed last frame's picture, so moving things lagged) → a Pass + Glow (texture), same frame
 *    (right-click an old Bloom → Upgrade to same-frame glow does it: nodes/upgradeBloom.ts).
 *  - Gaussian Blur → Blur (texture); Radial Blur → Radial Fast Blur; Lens Blur and Depth of Field → Depth of Field
 *    (texture) (Focus Point / Depth); Tilt-Shift Blur → Tilt-Shift (texture). All of them read last frame's picture.
 *  - Previous Frame (Feedback) and Motion Blur (last frame's whole picture) → Feedback (texture), or a Pass and its
 *    Previous to build your own; Fade (feedback) → Feedback (texture) (which still runs Fade's code inside).
 *  - Sobel Edges (a slope of one value, dFdx / dFdy) → Edges (texture).
 */
export const SWEPT_EFFECT_TYPES: readonly string[] = [
  'light2d', 'chromaShift', 'chromaticAberration', 'bloom',
  'gaussianBlur', 'radialBlur', 'lensBlur', 'depthOfField', 'tiltShiftBlur',
  'prevFrame', 'motionBlur', 'textureFade',
  'sobel',
];

/**
 * The 2026-10-17 catalogue sweep (docs/node-retirements.md, "The catalogue sweep"): nodes another node now does,
 * kept registered so saved graphs load and render as before, offered nowhere. Each family says where it went.
 */
export const CATALOGUE_RETIRED_TYPES: readonly string[] = [
  // The old single-purpose transforms → Transform (a saved one switches on load when that is exact: toTransform.ts).
  'place2D', 'uvTransform2d', 'rotate2d', 'translate3D', 'rotate3D', 'scale3d', 'translate4D', 'rotate4D', 'scale4D',
  // Rounded Cylinder → Cylinder, Edges Rounded (an alias moves it, except one with its Radius wired: definitions/aliases.ts).
  'roundedCylinderSDF3D',
  // Simple SDF → Shape SDF / Circle / Box / Ring SDF, SDF Colorize → SDF Fill: the same pictures, but not the same
  // float operations (Shape SDF's ring and SDF Fill's mix run differently), so they stay as they were.
  'simpleSDF', 'sdfColorize',
  // Radiance Cascades 2D: too slow for what it gives (the user's call, 2026-10-17); SDF Glow lights a shape cheaply.
  'radianceCascadesApprox',
  // Voxelize (2026-10-19): one voxel system, the Voxels setting on the March Loop and GI Lit March Group
  // (docs/march-voxels.md). Voxelize snapped space inside the scene, so its cubes came from the shapes you built per cell;
  // the loop's Voxels turn any scene into cubes. Not the same picture, so a saved Voxelize graph keeps its node.
  'voxelize',
  // The Ants starter (2026-10-19): the ants examples and presets were deleted (the user: they looked terrible). Its
  // definition stays, so the starter still builds if anything asks for it; the Ants rule kind stays (Termites, SIR
  // and Fireflies use it).
  'antsPreset',
];

/**
 * The 2026-10-19 monolith retirement (docs/node-retirements.md, "Whole-shader nodes"): the user's call that a look is
 * built up from small nodes, not one "whole shader" node with a palette and a loop inside. These drew a finished
 * picture (a fractal, a raymarched scene, a fixed texture) behind a wall of sliders. They stay registered, so a saved
 * graph that uses one loads and renders exactly as before; nothing offers them, and no example uses them. The
 * examples that did are rebuilt from small nodes: an iterated Group with Loop Carry, Loop Index and Loop Break, and
 * Complex Mul / Complex Divide / Log for the fractal maths (examples: fractalRings, learnFractal, newtonFractalZ5).
 *
 * Glass Scene is retired from offering too, but the 3D Scene Builder's Glass look still writes one as its renderer
 * (sceneBuilder/build.ts): see BUILDER_WRITTEN_TYPES.
 */
export const MONOLITH_RETIRED_TYPES: readonly string[] = [
  // Fractal and loop "whole shaders".
  'fractalLoop', 'rotatingLinesLoop', 'accumulateLoop', 'forLoop', 'flowField', 'circlePack',
  'mandelbrot', 'ifs', 'newtonFractal', 'lyapunov', 'apollonian', 'sphericalFoldFractal',
  'raymarch3d', 'volumeClouds', 'mandelbulb',
  // Other fixed looks.
  'chaosLayers', 'magicTexture', 'metaballs',
  // The borderline four (the user's call): a lens warp with its looks built in, attractor circles, glass that marches
  // its own scenes, and a bands / rings texture (Length or a Split → Sin builds it).
  'gravitationalLens', 'neighborAttractCircles', 'glassScene', 'waveTexture',
];

/**
 * Not offered by hand, but a builder still writes them as part of what it makes (its renderer): the 3D Scene
 * Builder's Glass look is a Glass Scene. A builder-made node carries its role (params._sbRole), so a test can tell
 * it from one added by hand.
 */
export const BUILDER_WRITTEN_TYPES: readonly string[] = ['glassScene'];

/**
 * Retired for good: Ride a curve (its curves built in) gave way on 2026-10-15 to Ride a path, which rides
 * any wired shape's outline (agentRidePath.ts); saved graphs with a Ride a curve still load and run.
 * Audio Input (a file with per-band floats) gave way on 2026-10-17 to the Audio nodes (docs/audio-tools.md): Audio
 * Source wired into Band level, Hit, Spectrum…; saved graphs with an Audio Input still load and play.
 */
export const RETIRED_TYPES: readonly string[] = ['agentRideCurve', 'audioInput', ...SWEPT_EFFECT_TYPES, ...CATALOGUE_RETIRED_TYPES, ...MONOLITH_RETIRED_TYPES];

/** Registered types that are never offered for adding (their saved nodes still work). */
export const NOT_OFFERED: ReadonlySet<string> = new Set([...(OFFER_PIECES ? [] : PIECES_TYPES), ...RETIRED_TYPES]);

export const isOffered = (type: string): boolean => !NOT_OFFERED.has(type);
