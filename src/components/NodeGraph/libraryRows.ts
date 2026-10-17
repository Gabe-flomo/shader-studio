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
  'output', 'vec4Output', 'loopIndex',
  'groupOutput', 'groupInput', 'marchLoopInputs', 'marchLoopOutput', 'scope',
  'forLoop', 'loopRippleStep', 'loopRotateStep', 'loopDomainFold',
  'loopFloatAccumulate', 'loopColorRingStep', 'loopRingStep',
  'forwardCamera',
  'marchPos', 'marchDist', 'marchOutput',
  'scenePos', 'sceneOutput', 'spaceWarpGroup',
  'rotatingLinesLoop', 'accumulateLoop', 'flowField', 'circlePack',
  'raymarch3d', 'volumeClouds', 'rayMarch', 'loopCarry', 'loop',
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
  { label: '3D tools',         categories: ['3D Primitives', '3D Transforms', '3D Boolean Ops', '3D Scene', '3D Lighting', 'Loops', '4D Shapes', '4D Space', '4D Projection', 'Splats'] },
  { label: 'Shape operations', categories: ['SDF'] },
  { label: 'Colour',           categories: ['Color', 'Color Grading', 'Combiners'] },
  { label: 'Effects',          categories: ['Effects', 'Passes', 'Texture tools'] },
  { label: 'Agents',           categories: ['Agents', 'Agent presets', 'Particles', 'Particles & Fields'] },
  { label: 'Generators',       categories: ['Noise', 'Fractals', 'Science'] },
  { label: 'Math & Logic',     categories: ['Sources', 'Audio', 'Animation', 'Math', 'Matrix', 'Shapers', 'Conditionals'] },
  { label: 'Functions',        categories: ['My Nodes', 'Functions'] },
  { label: 'Utility',          categories: ['Utility', 'Output'] },
];

/** How a row reads in the library (the node definitions keep their own category names). */
const ROW_LABELS: Record<string, string> = {
  '2D Primitives': '2D Shapes',
  '3D Primitives': '3D Shapes',
  SDF: 'Combine, cut & fill (SDF)',
  Science: 'Chladni',
};
export const rowLabel = (row: string) => ROW_LABELS[row] ?? row;

const PRESET_TYPES = ['slimeMoldPreset', 'multiSlimePreset', 'antsPreset', 'boidsPreset', 'strandsPreset', 'growPicturePreset', 'myceliumPreset', 'particlesPreset', 'curlSmokePreset', 'soundBurstPreset', 'galaxyPreset', 'sandPlatePreset'];
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

/** The library row a node is listed under. */
export function rowOfType(type: string, category: string): string {
  for (const [row, v] of Object.entries(VIRTUAL_ROWS)) {
    if (v.from !== category) continue;
    if (v.only ? v.only.includes(type) : !(v.not ?? []).includes(type)) return row;
  }
  return category;
}

export const byLabel = (a: string, b: string) => a.localeCompare(b);
/** Sections and their rows, alphabetical at every level. */
export const CATEGORY_SECTIONS = [...CATEGORY_SECTIONS_RAW]
  .map(sec => ({ ...sec, categories: [...sec.categories].sort((a, b) => byLabel(rowLabel(a), rowLabel(b))) }))
  .sort((a, b) => byLabel(a.label, b.label));

/** Rows that show several node categories as one (the definitions keep their own category). */
export const MERGED_CATEGORIES: Record<string, string[]> = {
  Effects: ['Effects', 'Post Processing'],
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
  Loops: 'Repeat a chain of nodes several times inside one shader.',
  '4D Shapes': 'Shapes in four dimensions, measured at a 4D point (from Lift to 4D): hypersphere, tesseract, duocylinder, the regular polytopes and quaternion fractals. What you see is their 3D slice.',
  '4D Space': 'Get a point into 4D and change it there: Lift to 4D turns the 3D point into a 4D one (choosing how the slice cuts), then move, turn in any of the six 4D planes, scale, repeat, fold, twist or add noise, before a 4D shape measures it.',
  '4D Projection': 'See a whole 4D shape at once instead of a slice: project it into 3D (perspective or stereographic), draw its wireframe, or go straight to the flat picture.',
  Agents: 'Walkers, particles and slime that move and leave trails: the Agents group and the nodes that go outside and inside it.',
  'Agent presets': 'Ready-made Agents setups, one click each: slime mold, ants, boids, galaxy, smoke and more. Open the group to change how they behave.',
  '4D': 'Shapes and transforms in four dimensions. Lift to 4D turns a 3D point into a 4D one and the shape is sliced back to 3D; projection nodes show the whole 4D shape at once; 4D Wireframe 2D and Plane Slice 4D go straight to the flat picture.',
  Science: 'Chladni plates: the standing-wave patterns of a vibrating plate, and the waves that make them.',
  SDF: 'Work on distances from any shape, 2D or 3D. Combine joins, cuts or overlaps two shapes; Modify grows, hollows or sharpens one; Style turns a distance into colour.',
  Color: 'Make and change colour: pick colours, palettes and gradients, adjust, convert and blend.',
  'Color Grading': 'Film-style adjustments on a finished colour: tone, curves, saturation, tone mapping and grain.',
  Combiners: 'Put two pictures or colours together: mix, blend modes, masks, add, and glow layers.',
  Effects: 'Finishing touches on the picture: blur, bloom, chromatic shifts, glows and post-processing like vignette, scanlines and pixelation.',
  Simulation: 'Things that remember the last frame: agents (walkers with rules), particles, passes that read their own previous frame, and tools for the textures they make.',
  Particles: 'GPU particles: emit, move and draw thousands of points.',
  Passes: 'Render part of the graph to a texture, read it back later or in the next frame: feedback, trails, multi-step simulations.',
  'Texture tools': 'Shape a texture\'s raw values: masks, levels, flow directions, outlines, fades.',
  Noise: 'Smooth random patterns (value, Perlin, simplex, fBm, Voronoi) for textures, warps and motion.',
  Fractals: 'Shapes that repeat at every scale: Mandelbrot, Julia, kaleidoscopic folds.',
  Sources: 'Inputs from outside the graph: UV, time, mouse, resolution, video, constants (sound: the Audio row).',
  Audio: 'Sound into pictures: an Audio Source (a file or the microphone, with its own frequency bands) and the nodes that listen to it: how loud a band is, when a drum hits, the spectrum, its history and the wave itself.',
  Animation: 'Values that move over time: LFOs, envelopes and keyframes.',
  Math: 'Arithmetic, trigonometry, rounding, interpolation, vectors and comparison, one operation per node.',
  Matrix: '2×2, 3×3 and 4×4 matrices: build, combine and apply transforms.',
  Shapers: 'Curves that reshape a 0 to 1 value: easing, seats, sigmoids and Béziers.',
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
    { label: 'SDF',      types: ['circleSDF', 'boxSDF', 'ringSDF', 'simpleSDF', 'shapeSDF', 'sdSegment', 'sdEllipse'] },
    { label: 'Patterns', types: ['truchet', 'metaballs', 'lissajous'] },
  ],
  '3D Primitives': [
    { label: 'Basic',   types: ['sphereSDF3D', 'boxSDF3D', 'torusSDF3D', 'capsuleSDF3D', 'cylinderSDF3D', 'coneSDF3D', 'planeSDF3D', 'octahedronSDF3D', 'pieceBalls'] },
    { label: 'Curved',  types: ['ellipsoidSDF3D', 'cappedTorusSDF3D', 'cappedConeSDF3D', 'roundedBoxSDF3D', 'roundedCylinderSDF3D', 'verticalCapsuleSDF3D'] },
    { label: 'Complex', types: ['boxFrameSDF3D', 'linkSDF3D', 'pyramidSDF3D', 'hexPrismSDF3D', 'triPrismSDF3D', 'solidAngleSDF3D', 'sdCross3D'] },
    { label: 'Fields',  types: ['gyroidField', 'schwarzPField'] },
  ],
  '3D Transforms': [
    { label: 'Move',   types: ['transform', 'translate3D', 'rotate3D', 'rotateAxis3D', 'scale3d'] },
    { label: 'Repeat', types: ['repeat3D', 'limitedRepeat3D', 'polarRepeat3D', 'mirroredRepeat3D', 'voxelize'] },
    { label: 'Warp',   types: ['twist3D', 'bend3D', 'sinWarp3D', 'displace3D', 'spiralWarp3D', 'domainWarp3D', 'turbulence3D', 'shear3D'] },
    { label: 'Fold',   types: ['fold3D', 'mirrorFold3D', 'kaleidoscope3D', 'sphereInvert3D', 'mobiusWarp3D', 'logPolarWarp3D', 'helixWarp3D'] },
  ],
  '4D Shapes': [
    { label: 'Fractals',  types: ['quatJuliaSDF', 'quatMandelSDF'] },
    { label: 'Polytopes', types: ['cell5SDF', 'cell16SDF', 'cell24SDF'] },
    { label: 'Solids',    types: ['hypersphereSDF', 'tesseractSDF', 'duocylinderSDF', 'spherinderSDF', 'cubinderSDF', 'cylPrismSDF', 'ditorusSDF', 'cliffordTorusSDF', 'hopfCirclesSDF'] },
  ],
  '4D Space': [
    { label: 'Into 4D, move and turn', types: ['lift4D', 'transform', 'translate4D', 'rotate4D', 'scale4D'] },
    { label: 'Repeat, fold and warp',  types: ['repeat4D', 'fold4D', 'twist4D', 'noise4D'] },
  ],
  '3D Lighting': [
    { label: 'Shadow',  types: ['sdfAo', 'softShadow'] },
    { label: 'Surface', types: ['blinnPhong', 'fresnel3d', 'fakeSSS', 'materialSelect', 'multiLight'] },
    { label: 'Glass',   types: ['glass3d', 'fresnelSchlick', 'spectralDispersion'] },
    { label: 'Volume',  types: ['volumetricFog', 'phaseHG'] },
  ],
  Color: [
    { label: 'Build',   types: ['colorPicker', 'colorize', 'makeVec3'] },
    { label: 'Palette', types: ['palette', 'stopPalette', 'gradient', 'colorRamp', 'blackbody'] },
    { label: 'Adjust',  types: ['invert', 'colorSaturation', 'posterize', 'hueRange', 'brightnessContrast', 'colorMatrix'] },
    { label: 'Convert', types: ['hsv', 'normalToColor'] },
    { label: 'Blend',   types: ['blendModes', 'oklabMix'] },
  ],
  Math: [
    { label: 'Arithmetic', types: ['add', 'subtract', 'multiply', 'divide'] },
    { label: 'Trig',       types: ['sin', 'cos', 'tan', 'atan2'] },
    { label: 'Rounding',   types: ['abs', 'negate', 'ceil', 'floor', 'round', 'fract', 'fractRaw'] },
    { label: 'Algebra',    types: ['pow', 'sqrt', 'exp', 'tanh'] },
    { label: 'Interp',     types: ['clamp', 'bounds', 'mix', 'smoothstep', 'mod', 'modSelect'] },
    { label: 'Compare',    types: ['minMath', 'max', 'step', 'sign'] },
    { label: 'Geometry',   types: ['length', 'dot', 'crossProduct', 'reflect', 'refractDir', 'luminance'] },
    { label: 'Vec2',       types: ['vec2Const', 'makeVec2', 'splitVec2', 'transformVec', 'normalizeVec2', 'angleToVec2', 'vec2Angle'] },
    { label: 'Vec3',       types: ['makeVec3', 'splitVec3', 'floatToVec3'] },
    { label: 'Vec4',       types: ['makeVec4', 'splitVec4'] },
    { label: 'Swizzle',    types: ['swizzle', 'vec2Swizzle', 'vec3Swizzle'] },
    { label: 'Complex',    types: ['complexMul', 'complexPow'] },
    { label: 'Remap',      types: ['remap'] },
  ],
  Shapers: [
    { label: 'Ease',    types: ['expEase', 'circularEaseIn', 'circularEaseOut'] },
    { label: 'Seat',    types: ['doubleExpSeat', 'doubleCircleSeat'] },
    { label: 'Sigmoid', types: ['doubleExpSigmoid', 'logisticSigmoid', 'doubleCircleSigmoid', 'doubleEllipticSigmoid'] },
    { label: 'Bezier',  types: ['quadBezierShaper', 'cubicBezierShaper'] },
  ],
  // The Agents family (docs/agents-plan.md): the inside nodes only go into an open Agents group.
  Agents: [
    { label: 'Start here', types: ['agentsGroup'] },
    { label: 'Outside the group', types: ['agentEmit', 'agentDeposit', 'trailField', 'drawAgents'] },
    { label: 'Inside: walkers', types: ['agentSense', 'agentNeighbours', 'agentSteer', 'agentMove', 'agentBySpecies'] },
    { label: 'Inside: forces', types: ['agentGravity', 'agentWind', 'agentCurl', 'agentAttract', 'agentVortex', 'agentFlow', 'agentSoundKick'] },
    { label: 'Inside: moving', types: ['agentIntegrate', 'agentAge', 'agentCollide', 'agentChladni', 'agentRidePath'] },
  ],
  Effects: [
    { label: 'Blur',     types: ['gaussianBlur', 'bloom', 'radialBlur', 'tiltShiftBlur', 'lensBlur', 'depthOfField'] },
    { label: 'Chroma',   types: ['chromaShift', 'chromaticAberrationAuto', 'chromaticAberration'] },
    { label: 'Lighting', types: ['light', 'glowToColor', 'light2d', 'radianceCascadesApprox'] },
    { label: 'Warp',     types: ['gravitationalLens', 'floatWarp'] },
    { label: 'Glitch',   types: ['glitch'] },
  ],
  // Effects also shows the Post Processing nodes (MERGED_CATEGORIES); anything not listed here goes under More.
  'Color Grading': [
    { label: 'Tone',  types: ['liftGammaGain', 'toneCurve', 'shadowsHighlights', 'toneMap'] },
    { label: 'Color', types: ['hueRotate', 'colorSaturation'] },
    { label: 'Film',  types: ['grain'] },
  ],
  SDF: [
    { label: 'Combine', types: ['sdfUnion', 'sdfIntersect', 'sdfSubtract'] },
    { label: 'Modify',  types: ['sdfOffset', 'sdfOnion', 'sdfSharpen'] },
    { label: 'Style',   types: ['sdfFill', 'sdfColorize'] },
  ],
  '2D Space': [
    { label: 'Basic',   types: ['transform', 'uvTransform2d', 'rotate2d', 'shear', 'perspective2d', 'fract', 'displace'] },
    { label: 'Repeat',  types: ['infiniteRepeatSpace', 'limitedRepeat2D', 'mirroredRepeat2D', 'angularRepeat2D', 'kaleidoSpace', 'grid'] },
    { label: 'Warp',    types: ['uvWarp', 'smoothWarp', 'curlWarp', 'swirlWarp', 'swirlSpace', 'rippleSpace', 'sphericalSpace', 'lensDistortion', 'crtScreen', 'turbulence', 'uvReciprocal', 'gravityField', 'spiralField', 'vectorField'] },
    { label: 'Map',     types: ['polarSpace', 'logPolarSpace', 'hyperbolicSpace', 'inversionSpace', 'mobiusSpace', 'cornerPin'] },
    { label: 'Pattern', types: ['waveTexture', 'magicTexture', 'chaosLayers'] },
  ],
  Combiners: [
    { label: 'Blend',   types: ['mix', 'blendModes', 'mask', 'addColor', 'alphaBlend'] },
    { label: 'Layer',   types: ['glowLayer', 'deepGlow'] },
  ],
  Grid: [
    { label: 'Layout',   types: ['gridPattern', 'gridPaint', 'arrayField', 'gridLayout', 'cellPicture', 'pieces'] },
    { label: 'Motion',   types: ['waveRadius', 'animatedCellCenter'] },
    { label: 'Displace', types: ['neighborDist', 'cellDisplace', 'neighborAttractCircles'] },
    { label: 'Filter',   types: ['cellFilter', 'cellPattern', 'neighborOffset2d'] },
    { label: 'Warp',     types: ['gridDensityWarp'] },
  ],
  Field: [
    { label: 'Gaussian',  types: ['gaussianField', 'fieldAccumulate'] },
    { label: 'Noisy SDF', types: ['noisyGridSDF'] },
    { label: 'Threshold', types: ['metaballThreshold'] },
    { label: 'Falloff',   types: ['distanceFalloff'] },
  ],
};
