/**
 * libraryRows.ts — how the node library is laid out (docs/node-browser.md): the sections, the rows
 * (categories, some merged or split), their sub-groups and one-line descriptions, and the node
 * types never offered by hand. Shared by the node browser (NodeBrowser.tsx) and the node search
 * (NodeSearchPalette.tsx), so the two always list the same categories.
 */
import { getNodesByCategory, getOfferedDefinitions } from '../../nodes/definitions';
import { NOT_OFFERED } from '../../nodes/notOffered';

// ── Nodes hidden from browser ─────────────────────────────────────────────────
export const HIDDEN_NODES = new Set([
  // Hidden, not deleted: Pieces and Balls (nodes/notOffered.ts; one flag brings them back).
  ...NOT_OFFERED,
  // Texture (textureInput) is the one card for pictures, videos and the webcam; its Source switch makes a videoInput.
  'videoInput',
  'output', 'vec4Output',
  'groupOutput', 'groupInput', 'marchLoopInputs', 'marchLoopOutput', 'scope',
  'loopRippleStep', 'loopRotateStep', 'loopDomainFold',
  'loopFloatAccumulate', 'loopColorRingStep', 'loopRingStep',
  'forwardCamera',
  'marchPos', 'marchDist', 'marchOutput',
  'scenePos', 'sceneOutput', 'spaceWarpGroup',
  // The whole-shader looks (For Loop, Rotating Lines, Flow Field, Raymarch 3D…) are retired: NOT_OFFERED above.
  // Loop Carry, Loop Index and Loop Break are offered (the Loops row): fractals are built from them.
  'rayMarch', 'loop',
  'grid',
  // Made by the compiler at the end of a Pass's program (compiler/passGraph.ts).
  'passOutput',
  // The end of a Shader Texture's inside, made with the node (docs/texture-builder.md).
  'shaderTextureOutput',
  // A hidden pass of Blur / Glow (texture) (compiler/hiddenBlurs.ts).
  'blurStage', 'lensDofStage', 'radialFastBlurStage', 'deepGlowTextureStage',
  // One step of a Grid Rules board (compiler/gridRulesExpand.ts).
  'gridRulesStep',
  // One frame of a Curve Trace Beam's screen (compiler/curveBeamExpand.ts).
  'curveTraceBeamStep',
  // One frame of a Feedback (texture) buffer (compiler/feedbackExpand.ts).
  'textureFeedbackStep',
  // One frame of an Advect buffer (compiler/feedbackExpand.ts).
  'advectStep',
  // The shared memory Pass's program and a memory node's read (compiler/memoryExpand.ts).
  'memoryPack', 'memoryRead',
  // An Optical Flow's step and read (compiler/opticalFlowExpand.ts).
  'opticalFlowStep', 'opticalFlowRead',
  // The Value at point Pass's program and a probe's read (compiler/probeExpand.ts).
  'probePack', 'probeRead',
  'dataTexturePack',
  'renderTargetsPack',
  // Made by Bake… (lib/bake): a node's frozen render, never added by hand.
  'baked',
  // An Agents group's anchors (made with the group) and its update shader's end (compiler/agentGraph.ts).
  'agentInputs', 'agentOutput', 'agentStepOut', 'trailStepOut', 'agentProbeOut', 'splatProbeOut', 'agentGridOut',
  // A Splat Scene's modifier program's end (compiler/splatGraph.ts).
  'splatModOut',
]);

const CATEGORY_SECTIONS_RAW: Array<{ label: string; categories: string[] }> = [
  { label: '2D tools',         categories: ['2D Primitives', '2D Space', 'Grid', 'Field', 'Halftone'] },
  { label: '3D tools',         categories: ['3D Primitives', '3D Transforms', '3D Boolean Ops', '3D Scene', '3D Lighting', '4D Shapes', '4D Space', '4D Projection', 'Splats'] },
  { label: 'Shape operations', categories: ['SDF'] },
  { label: 'Colour',           categories: ['Color', 'Color Grading', 'Combiners'] },
  { label: 'Effects',          categories: ['Effects', 'Texture tools'] },
  { label: 'Agents',           categories: ['Agents', 'Agent presets', 'Particles & Fields'] },
  { label: 'Generators',       categories: ['Noise', 'Science'] },
  { label: 'Math & Logic',     categories: ['Sources', 'Audio', 'Animation', 'Math', 'Matrix', 'Shapers', 'Conditionals', 'Loops'] },
  { label: 'Functions',        categories: ['My Nodes', 'Functions'] },
  { label: 'Utility',          categories: ['Utility', 'Output'] },
];

/**
 * How a row reads in the library (the node definitions keep their own category names). The
 * glossary (docs/glossary.md) decides the chrome's words: "Sources" is Play's word for what drives
 * a control, so the node row reads "Inputs & media"; UI copy spells colour the British way.
 */
const ROW_LABELS: Record<string, string> = {
  '2D Primitives': '2D Shapes',
  '3D Primitives': '3D Shapes',
  SDF: 'Combine, cut & fill (SDF)',
  Science: 'Chladni',
  Sources: 'Inputs & media',
  Color: 'Colour',
  'Color Grading': 'Colour grading',
};
export const rowLabel = (row: string) => ROW_LABELS[row] ?? row;

const PRESET_TYPES = ['slimeMoldPreset', 'multiSlimePreset', 'boidsPreset', 'strandsPreset', 'growPicturePreset', 'myceliumPreset', 'particlesPreset', 'curlSmokePreset', 'soundBurstPreset', 'galaxyPreset', 'sandPlatePreset'];
const FOURD_SPACE = ['lift4D', 'rotate4D', 'translate4D', 'scale4D', 'repeat4D', 'fold4D', 'twist4D', 'noise4D'];
const FOURD_PROJECTION = ['wireframe4D', 'project4D', 'stereo4D', 'stereoDist4D', 'wireframe4D2D', 'planeSlice4D'];

/** Rows made from part of one category: 4D split three ways, the agent presets apart from the rest. */
export const VIRTUAL_ROWS: Record<string, { from: string; only?: string[]; not?: string[] }> = {
  '4D Shapes': { from: '4D', not: [...FOURD_SPACE, ...FOURD_PROJECTION] },
  '4D Space': { from: '4D', only: FOURD_SPACE },
  '4D Projection': { from: '4D', only: FOURD_PROJECTION },
  Agents: { from: 'Simulation', not: PRESET_TYPES },
  'Agent presets': { from: 'Simulation', only: PRESET_TYPES },
};

/** The library row a node is listed under (a merged row for a category it shows, e.g. Pass → Texture tools). */
export function rowOfType(type: string, category: string): string {
  for (const [row, v] of Object.entries(VIRTUAL_ROWS)) {
    if (v.from !== category) continue;
    if (v.only ? v.only.includes(type) : !(v.not ?? []).includes(type)) return row;
  }
  for (const [row, cats] of Object.entries(MERGED_CATEGORIES)) if (cats.includes(category)) return row;
  return category;
}

export const byLabel = (a: string, b: string) => a.localeCompare(b);
/** Sections and their rows, alphabetical at every level. */
export const CATEGORY_SECTIONS = [...CATEGORY_SECTIONS_RAW]
  .map(sec => ({ ...sec, categories: [...sec.categories].sort((a, b) => byLabel(rowLabel(a), rowLabel(b))) }))
  .sort((a, b) => byLabel(a.label, b.label));

/**
 * Rows that show several node categories as one (the definitions keep their own category, so a
 * card keeps its colour). The Pass is a Texture tool: it makes the texture the rest work on.
 */
export const MERGED_CATEGORIES: Record<string, string[]> = {
  Effects: ['Effects', 'Post Processing'],
  'Texture tools': ['Texture tools', 'Passes'],
};

/** What a library row is for, shown under its title when it's open and as the row's tooltip. */
export const CATEGORY_INFO: Record<string, string> = {
  '2D Primitives': 'Flat shapes as distance fields (SDFs): for every pixel, how far it is from the shape. Negative inside, 0 on the edge, positive outside. Wire the distance into SDF Fill, SDF Glow or a palette. Patterns fill the whole picture.',
  '2D Space': 'Change where every pixel looks before a shape or texture measures it: move, rotate, tile, mirror, warp or remap the UV. A space node bends everything after it.',
  Grid: 'Cut the picture into cells and give each cell its own position, id and motion: grids of shapes, ripples through cells, per-cell variation.',
  Field: 'Smooth fields made by adding up many sources (metaballs, Gaussian blobs), then thresholded or coloured.',
  Halftone: 'Print looks: dots, lines and patterns whose size follows a brightness.',
  '3D Primitives': '3D shapes as distance fields, measured from Scene Pos inside a Scene Group. Adding one at the top level builds the Scene Group, camera and march loop for you.',
  '3D Transforms': 'Change 3D space before the shapes measure it: move, rotate, repeat, twist, bend or fold. Put them between Scene Pos and the shapes.',
  '3D Boolean Ops': 'Join, cut or overlap 3D distances.',
  '3D Scene': 'The 3D pipeline: a March Camera makes the rays, a Scene Group holds the shapes, a March Loop finds where each ray hits.',
  Splats: 'Change every splat of a Splat Scene before it is drawn: Dissolve, Explode, Wave, Colour, Crop, Size & Opacity and Points, or Splat Attributes → your own nodes → Set Splat. Chain them into the Splat Scene\'s Modifier; the chain runs once per splat.',
  '3D Lighting': 'Light what the march loop hit: shading, shadows, ambient occlusion, glass and fog. Wire them from the loop\'s outputs.',
  Loops: 'Inside a Group with Iterations above 1 (a for loop): Loop Carry keeps a value from pass to pass, Loop Index says which pass this is, Loop Break stops early. Fractals are built from these.',
  '4D Shapes': 'Shapes in four dimensions, measured at a 4D point (from Lift to 4D): hypersphere, tesseract, duocylinder, the regular polytopes and quaternion fractals. What you see is their 3D slice.',
  '4D Space': 'Get a point into 4D and change it there: Lift to 4D turns the 3D point into a 4D one (choosing how the slice cuts), then move, turn in any of the six 4D planes, scale, repeat, fold, twist or add noise, before a 4D shape measures it.',
  '4D Projection': 'See a whole 4D shape at once instead of a slice: project it into 3D (perspective or stereographic), draw its wireframe, or go straight to the flat picture.',
  Agents: 'Walkers, particles and slime that move and leave trails: the Particles node (up to millions of GPU particles in one node), the Agents group and the nodes that go outside and inside it.',
  'Agent presets': 'Ready-made Agents setups, one click each: slime mold, ants, boids, galaxy, smoke and more. Open the group to change how they behave.',
  '4D': 'Shapes and transforms in four dimensions. Lift to 4D turns a 3D point into a 4D one and the shape is sliced back to 3D; projection nodes show the whole 4D shape at once; 4D Wireframe 2D and Plane Slice 4D go straight to the flat picture.',
  Science: 'Chladni plates: the standing-wave patterns of a vibrating plate (Chladni), and one knob that sweeps their modes (Chladni Mode Frequency).',
  SDF: 'Work on distances from any shape, 2D or 3D. Combine joins, cuts or overlaps two shapes; Modify & fill grows, hollows or sharpens one, or turns a distance into colour.',
  Color: 'Make colour: pick colours, palettes and gradients, turn numbers into colour and back, and blend. Adjusting a colour is in Colour grading.',
  'Color Grading': 'Every adjustment of a finished colour, in one place: brightness and contrast, tone, curves, hue and saturation, inverting, tone mapping and grain.',
  Combiners: 'Put two pictures or colours together: masks, add, alpha blend, three channels into one colour. (Mix is in Math, Blend Modes in Colour.)',
  Effects: 'Finishing touches on the picture: blur, bloom, chromatic shifts, glows and post-processing like vignette, scanlines and pixelation.',
  Simulation: 'Things that remember the last frame: agents (walkers with rules), particles, passes that read their own previous frame, and tools for the textures they make.',
  Particles: 'GPU particles: emit, move and draw thousands of points.',
  'Texture tools': 'Everything that makes or works on a texture (a Pass, a picture, a video): the Pass that renders part of the graph to a texture (feedback, trails, multi-step simulations), then blur, glow, edges, lens effects, reading it elsewhere, masks and levels, its channels, trails and time, depth and tracking.',
  Noise: 'Smooth random patterns (value, Perlin, simplex, fBm, Voronoi) for textures, warps and motion.',
  Sources: 'Inputs from outside the graph: UV, time, mouse, resolution, video, constants (sound: the Audio row).',
  Audio: 'Sound into pictures: an Audio Source (a file or the microphone, with its own frequency bands) and the nodes that listen to it: how loud a band is, when a drum hits, the spectrum, its history and the wave itself.',
  Animation: 'Values that move over time: LFOs, Ease (named motion curves: Bounce, Back, Elastic…), envelopes and keyframes.',
  Math: 'Arithmetic, trigonometry, rounding, interpolation, vectors and comparison, one operation per node.',
  Matrix: '2×2, 3×3 and 4×4 matrices: build, combine and apply transforms.',
  Shapers: 'Curves that reshape a 0 to 1 value: Shaper (eases, seats, S-curves, a Bezier: pick the Curve) and Cubic Bezier.',
  Conditionals: 'Pick between values with a condition.',
  Functions: 'Custom GLSL functions and Expression Blocks: write your own maths.',
  'My Nodes': 'Nodes you published from your own graphs.',
  Utility: 'Helpers: comments, reroutes and tools for the graph itself.',
  Output: 'Where the picture leaves the graph.',
};

/**
 * Nodes a row also lists from another category, with the settings they start with there: the one
 * Transform (2D Space) leads the 3D and 4D moves too, in that dimension (docs/transform-node.md).
 */
export const ROW_ADD_PARAMS: Record<string, Record<string, Record<string, unknown>>> = {
  '3D Transforms': { transform: { dim: '3' } },
  '4D Space': { transform: { dim: '4' } },
};

export const nodesOfRow = (row: string) => {
  const extra = Object.keys(ROW_ADD_PARAMS[row] ?? {}).map(t => getOfferedDefinitions().find(d => d.type === t)).filter((d): d is NonNullable<typeof d> => !!d);
  const v = VIRTUAL_ROWS[row];
  if (v) return [...extra, ...getNodesByCategory(v.from).filter(d => (v.only ? v.only.includes(d.type) : !(v.not ?? []).includes(d.type)))];
  return [...extra, ...(MERGED_CATEGORIES[row] ?? [row]).flatMap(c => getNodesByCategory(c))];
};

export const CATEGORY_ORDER = [...CATEGORY_SECTIONS.flatMap(s => s.categories.flatMap(c => MERGED_CATEGORIES[c] ?? [c])), ...new Set(Object.values(VIRTUAL_ROWS).map(v => v.from))];

// ── Sub-group definitions for categories that need them ───────────────────────
export const CATEGORY_GROUPS: Record<string, Array<{ label: string; types: string[] }>> = {
  '2D Primitives': [
    { label: 'SDF',      types: ['circleSDF', 'boxSDF', 'ringSDF', 'shapeSDF', 'sdSegment', 'sdEllipse'] },
    { label: 'Patterns', types: ['truchet', 'lissajous'] },
    { label: 'Lines & text', types: ['curveTrace', 'text'] },
  ],
  '3D Primitives': [
    { label: 'Basic',   types: ['sphereSDF3D', 'boxSDF3D', 'torusSDF3D', 'capsuleSDF3D', 'cylinderSDF3D', 'coneSDF3D', 'planeSDF3D', 'octahedronSDF3D', 'pieceBalls'] },
    { label: 'Traced & pictures', types: ['curveTrace3D', 'timeCubeShape', 'pictureCard'] },
    { label: 'Curved',  types: ['ellipsoidSDF3D', 'cappedTorusSDF3D', 'cappedConeSDF3D'] },
    { label: 'Complex', types: ['boxFrameSDF3D', 'linkSDF3D', 'pyramidSDF3D', 'hexPrismSDF3D', 'triPrismSDF3D', 'solidAngleSDF3D', 'sdCross3D'] },
    { label: 'Fields',  types: ['gyroidField', 'schwarzPField'] },
  ],
  '3D Transforms': [
    { label: 'Move',   types: ['transform', 'rotateAxis3D'] },
    { label: 'Repeat', types: ['repeat3D', 'limitedRepeat3D', 'polarRepeat3D', 'mirroredRepeat3D', 'voxelize', 'repeatCell'] },
    { label: 'Warp',   types: ['twist3D', 'bend3D', 'sinWarp3D', 'displace3D', 'spiralWarp3D', 'domainWarp3D', 'turbulence3D', 'shear3D'] },
    { label: 'Fold',   types: ['mirrorFold3D', 'kaleidoscope3D', 'sphereInvert3D', 'mobiusWarp3D', 'logPolarWarp3D', 'helixWarp3D'] },
  ],
  '4D Shapes': [
    { label: 'Fractals',  types: ['quatJuliaSDF', 'quatMandelSDF'] },
    { label: 'Polytopes', types: ['cell5SDF', 'cell16SDF', 'cell24SDF'] },
    { label: 'Solids',    types: ['hypersphereSDF', 'tesseractSDF', 'duocylinderSDF', 'spherinderSDF', 'cubinderSDF', 'cylPrismSDF', 'ditorusSDF', 'cliffordTorusSDF', 'hopfCirclesSDF'] },
  ],
  '4D Space': [
    { label: 'Into 4D, move and turn', types: ['lift4D', 'transform'] },
    { label: 'Repeat, fold and warp',  types: ['repeat4D', 'fold4D', 'twist4D', 'noise4D'] },
  ],
  '3D Lighting': [
    { label: 'Shadow',  types: ['sdfAo', 'softShadow'] },
    { label: 'Surface', types: ['blinnPhong', 'fresnel3d', 'fakeSSS', 'materialSelect', 'multiLight', 'textureMaterial'] },
    { label: 'Glass',   types: ['glass3d', 'fresnelSchlick', 'spectralDispersion'] },
    { label: 'Volume',  types: ['volumetricFog', 'phaseHG'] },
  ],
  Color: [
    { label: 'Build',   types: ['colorPicker', 'colorize', 'floatToVec3'] },
    { label: 'Palette', types: ['palette', 'stopPalette', 'gradient', 'colorRamp', 'blackbody'] },
    { label: 'Convert', types: ['hsv', 'normalToColor', 'luminance', 'posterize', 'dither'] },
    { label: 'Blend',   types: ['blendModes', 'oklabMix'] },
  ],
  Math: [
    { label: 'Arithmetic', types: ['add', 'subtract', 'multiply', 'divide'] },
    { label: 'Trig',       types: ['sin', 'cos', 'tan', 'atan2'] },
    { label: 'Rounding',   types: ['abs', 'negate', 'ceil', 'floor', 'round', 'fractRaw', 'quantize'] },
    { label: 'Algebra',    types: ['pow', 'sqrt', 'exp', 'log', 'tanh'] },
    { label: 'Interp',     types: ['clamp', 'bounds', 'mix', 'smoothstep', 'mod', 'modSelect'] },
    { label: 'Compare',    types: ['minMath', 'max', 'step', 'sign'] },
    { label: 'Geometry',   types: ['length', 'dot', 'crossProduct', 'reflect', 'refractDir'] },
    { label: 'Vec2',       types: ['makeVec2', 'splitVec2', 'transformVec', 'normalizeVec2', 'angleToVec2'] },
    { label: 'Vec3 & Vec4', types: ['makeVec3', 'splitVec3', 'makeVec4', 'splitVec4', 'swizzle'] },
    { label: 'Complex',    types: ['complexMul', 'complexDiv', 'complexPow'] },
    { label: 'Remap',      types: ['remap', 'weightedAverage'] },
  ],
  // The Agents family (docs/agents-plan.md): the inside nodes only go into an open Agents group.
  Agents: [
    // The three whole systems, each one node: the Agents group, GPU Particles and a Grid Rules board.
    { label: 'Start here', types: ['agentsGroup', 'gpuParticles', 'gridRules'] },
    { label: 'Outside the group', types: ['agentEmit', 'agentDeposit', 'trailField', 'drawAgents'] },
    { label: 'Inside: walkers', types: ['agentSense', 'agentNeighbours', 'agentSteer', 'agentMove', 'agentBySpecies'] },
    { label: 'Inside: forces', types: ['agentGravity', 'agentWind', 'agentCurl', 'agentAttract', 'agentVortex', 'agentFlow', 'agentSoundKick'] },
    { label: 'Inside: moving', types: ['agentIntegrate', 'agentAge', 'agentCollide', 'agentCollideScene', 'agentFollowScene', 'agentChladni', 'agentRidePath'] },
    { label: 'Inside: rule steps', types: ['agentTurnToward', 'agentFollowTrail', 'agentWander', 'agentOrbit', 'agentAvoidWalls', 'agentApplyForce', 'agentDrag', 'agentSlowInCrowd', 'agentLeaveTrail', 'agentFadeWithAge'] },
  ],
  Effects: [
    // Float Warp shaped a value here beside the Gravitational Lens (Warp) until the lens was retired (2026-10-19).
    { label: 'Light and values', types: ['light', 'glowToColor', 'floatWarp'] },
    { label: 'Screen',   types: ['crtMask', 'scanlines', 'vignette', 'echo', 'glitch'] },
  ],
  // Effects also shows the Post Processing nodes (MERGED_CATEGORIES); anything not listed here goes under More.
  'Color Grading': [
    { label: 'Tone & film', types: ['brightnessContrast', 'liftGammaGain', 'toneCurve', 'shadowsHighlights', 'toneMap', 'grain'] },
    { label: 'Colour', types: ['hueRotate', 'colorSaturation', 'hueRange', 'invert', 'colorMatrix'] },
  ],
  SDF: [
    { label: 'Combine', types: ['sdfUnion', 'sdfIntersect', 'sdfSubtract'] },
    { label: 'Modify & fill', types: ['sdfOffset', 'sdfOnion', 'sdfSharpen', 'sdfFill', 'sdfBevel'] },
  ],
  '2D Space': [
    { label: 'Basic',   types: ['transform', 'mirror2D', 'motion2D', 'shear', 'perspective2d', 'fract', 'displace'] },
    { label: 'Repeat',  types: ['infiniteRepeatSpace', 'limitedRepeat2D', 'mirroredRepeat2D', 'angularRepeat2D', 'kaleidoSpace', 'grid'] },
    { label: 'Warp',    types: ['uvWarp', 'rippleSpace', 'sphericalSpace', 'lensDistortion', 'crtScreen', 'turbulence', 'uvReciprocal', 'gravityField', 'spiralField', 'vectorField'] },
    { label: 'Map',     types: ['polarSpace', 'logPolarSpace', 'hyperbolicSpace', 'inversionSpace', 'mobiusSpace', 'cornerPin'] },
  ],
  Combiners: [
    { label: 'Blend',   types: ['mask', 'addColor', 'alphaBlend', 'combineRGB'] },
  ],
  Grid: [
    { label: 'Layout',   types: ['gridPattern', 'gridPaint', 'arrayField', 'gridLayout', 'cellPicture', 'pieces'] },
    { label: 'Motion',   types: ['waveRadius', 'animatedCellCenter'] },
    { label: 'Displace & warp', types: ['neighborDist', 'cellDisplace', 'gridDensityWarp'] },
    { label: 'Filter',   types: ['cellFilter', 'cellPattern', 'neighborOffset2d'] },
  ],
  // Every node that works on a texture (the "(texture)" ones), in one row (docs/node-retirements.md).
  'Texture tools': [
    { label: 'Effects', types: ['blurTexture', 'glowTexture', 'edgesTexture', 'convolve', 'kuwahara', 'dofTexture', 'tiltShiftTexture', 'chromaLens', 'radialFastBlur', 'displaceTexture', 'displacementMap', 'jumpFloodTexture'] },
    { label: 'Read', types: ['sampleTexture', 'readTexture', 'readChannels', 'readNeighbours', 'textureNeighbours', 'showData'] },
    { label: 'Shape the values', types: ['textureMask', 'textureLevels', 'curves', 'threshold', 'textureFlow', 'textureChange', 'distanceShape', 'heightLight', 'normalFromHeight'] },
    { label: 'Channels', types: ['channelPick', 'channelShuffle', 'channelColours', 'dataTexture', 'renderTargets'] },
    { label: 'Pass and time', types: ['pass', 'textureFeedback', 'advect', 'cache', 'cacheRead'] },
    { label: 'Look and track', types: ['depth', 'depthMix', 'segment', 'blobTrack', 'blobSpace', 'analyze', 'opticalFlow'] },
  ],
  Field: [
    { label: 'Make a field', types: ['gaussianField', 'fieldAccumulate', 'noisyGridSDF'] },
    { label: 'Threshold', types: ['metaballThreshold', 'fieldToLines'] },
  ],
};

// ── The whole layout, for a list that shows every row (the phone's Browse) ───
export interface LibraryRow {
  /** The row's key (a node category, or a merged / virtual row). */
  row: string;
  /** What it reads as: the same name the desktop node list shows. */
  label: string;
  /** Its sub-groups as the desktop shows them (CATEGORY_GROUPS, then "More"); one unnamed group when it has none. */
  groups: Array<{ label: string | null; types: string[] }>;
}

/**
 * The library as the desktop node list lays it out: its sections in order, each with its rows
 * (rowLabel names) and their sub-groups, without `hidden` types and empty rows. The phone's Browse
 * lists this, so a category has one name and one place on both (UX audit §3.5).
 */
export function libraryLayout(hidden: ReadonlySet<string>): Array<{ label: string; rows: LibraryRow[] }> {
  const typeLabel = (t: string) => getOfferedDefinitions().find(d => d.type === t)?.label ?? t;
  const sortTypes = (ts: string[]) => [...ts].sort((a, b) => (a === 'transform' ? -1 : b === 'transform' ? 1 : byLabel(typeLabel(a), typeLabel(b))));
  return CATEGORY_SECTIONS.map(sec => ({
    label: sec.label,
    rows: sec.categories.map((row): LibraryRow => {
      const types = [...new Set(nodesOfRow(row).map(d => d.type))].filter(t => !hidden.has(t) && !HIDDEN_NODES.has(t));
      const listed = CATEGORY_GROUPS[row];
      if (!listed) return { row, label: rowLabel(row), groups: [{ label: null, types: sortTypes(types) }] };
      const ordered = [...listed].sort((a, b) => (a.label === 'Start here' ? -1 : b.label === 'Start here' ? 1 : byLabel(a.label, b.label)));
      const groups = ordered.map(g => ({ label: g.label as string | null, types: sortTypes(types.filter(t => g.types.includes(t))) }));
      const rest = types.filter(t => !listed.some(g => g.types.includes(t)));
      if (rest.length) groups.push({ label: 'More', types: sortTypes(rest) });
      return { row, label: rowLabel(row), groups: groups.filter(g => g.types.length > 0) };
    }).filter(r => r.groups.some(g => g.types.length > 0)),
  })).filter(sec => sec.rows.length > 0);
}
