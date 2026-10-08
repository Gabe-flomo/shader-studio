/**
 * stages.ts — the loose order of operations most shaders follow (docs/structure-hints.md).
 *
 * Every node type has a STAGE (where it usually sits in the picture's making: Space, Bend space,
 * Shape, Shape it, Colour, Post…) or 'any' (maths, time, constants, functions: they go anywhere).
 * Stages line up into four FLOWS: 2D, 3D, passes / sims and agents. It is a guide only: nothing
 * here blocks a wire or moves a node.
 *
 * The map is data: a stage per category (CATEGORY_STAGE), then per-type overrides (TYPE_STAGE).
 * A test checks that every registered node resolves to one or the other.
 *
 * Pure: no React, no store.
 */
import { getNodeDefinition } from '../nodes/definitions';

export type StageId =
  | 'space' | 'camera' | 'source'
  | 'bend'
  | 'shape' | 'objects' | 'combine' | 'scene' | 'march'
  | 'shapeIt' | 'light'
  | 'pass' | 'rule' | 'readout'
  | 'sense' | 'steer' | 'move' | 'deposit' | 'trail' | 'draw'
  | 'colour' | 'post';

/** A node's stage, or 'any' for nodes that belong everywhere. */
export type StageOf = StageId | 'any';

export type FlowId = '2d' | '3d' | 'pass' | 'agents';

export interface StageInfo {
  id: StageId;
  label: string;
  /** One line: what happens at this stage. */
  line: string;
  /** Examples of nodes, for the legend. */
  examples: string;
  /** A named accent (theme/categories accentColor): distinct within every flow. */
  accent: string;
}

export const STAGES: Record<StageId, StageInfo> = {
  space:   { id: 'space',   label: 'Space',       accent: 'blue',     examples: 'UV, centre, zoom',               line: 'Where each pixel is: the UV, centred and scaled.' },
  camera:  { id: 'camera',  label: 'Camera',      accent: 'blue',     examples: 'March Camera',                    line: 'A ray for each pixel: where it starts and which way it looks.' },
  source:  { id: 'source',  label: 'Source',      accent: 'blue',     examples: 'Texture, Video, a seed',          line: 'What the simulation starts from or is fed with.' },
  bend:    { id: 'bend',    label: 'Bend space',  accent: 'teal',     examples: 'warp, repeat, polar, pixelate',   line: 'Bend the coordinates before anything is drawn: warp, repeat, fold.' },
  shape:   { id: 'shape',   label: 'Shape',       accent: 'yellow',   examples: 'SDFs, noise, fractals',           line: 'The thing itself: a distance, a pattern, a field of noise.' },
  objects: { id: 'objects', label: 'Objects',     accent: 'yellow',   examples: 'Sphere, Box, Torus 3D',           line: 'The shapes in the scene, each a distance in 3D.' },
  combine: { id: 'combine', label: 'Combine',     accent: 'green',    examples: 'Union, Subtract, Intersect',      line: 'Join the shapes: keep the nearer, cut one out, keep the overlap.' },
  scene:   { id: 'scene',   label: 'Scene',       accent: 'lavender', examples: 'Scene Group',                     line: 'The whole scene as one distance the march can ask.' },
  march:   { id: 'march',   label: 'March',       accent: 'sky',      examples: 'Ray March',                       line: 'Step along each ray until it hits a surface.' },
  shapeIt: { id: 'shapeIt', label: 'Shape it',    accent: 'mauve',    examples: 'glow, rings, mask, levels',       line: 'Turn the distance or value into light: a glow, rings, a soft mask.' },
  light:   { id: 'light',   label: 'Lighting',    accent: 'peach',    examples: 'shadows, AO, fog',                line: 'Light the hit: shading, soft shadows, ambient occlusion, fog.' },
  pass:    { id: 'pass',    label: 'Pass',        accent: 'mauve',    examples: 'Pass, Previous Frame',            line: 'Keep last frame’s picture so this frame can build on it.' },
  rule:    { id: 'rule',    label: 'Rule',        accent: 'green',   examples: 'Grid Rules, Fade, Neighbours',    line: 'The update: how each cell changes from the frame before.' },
  readout: { id: 'readout', label: 'Read out',    accent: 'peach',    examples: 'Mask, Levels, Flow (texture)',    line: 'Read the state back as something to show: a mask, a flow, levels.' },
  sense:   { id: 'sense',   label: 'Sense',       accent: 'blue',     examples: 'Sense',                           line: 'Each agent looks ahead at the trail.' },
  steer:   { id: 'steer',   label: 'Steer',       accent: 'teal',     examples: 'Steer, forces',                   line: 'Turn toward what it sensed; forces push it.' },
  move:    { id: 'move',    label: 'Move',        accent: 'yellow',   examples: 'Move, Integrate, Collide',        line: 'Step forward; bounce, age, die.' },
  deposit: { id: 'deposit', label: 'Deposit',     accent: 'green',    examples: 'Deposit',                         line: 'Leave a mark where it is.' },
  trail:   { id: 'trail',   label: 'Trail',       accent: 'lavender', examples: 'Trail field',                     line: 'The marks spread and fade into a trail the others sense.' },
  draw:    { id: 'draw',    label: 'Draw',        accent: 'peach',    examples: 'Draw agents',                     line: 'Show the agents or their trail as a picture.' },
  colour:  { id: 'colour',  label: 'Colour',      accent: 'pink',     examples: 'palette, mix, ramp',              line: 'Give it colour: a palette, a ramp, a mix of two.' },
  post:    { id: 'post',    label: 'Post',        accent: 'red',      examples: 'tone map, grain, vignette, Look', line: 'Finish the whole picture: tone map, bloom, grain, vignette.' },
};

export interface FlowInfo {
  id: FlowId;
  label: string;
  stages: StageId[];
  /** Stages of other flows read as one of this flow's (a 2D graph's Union is its Shape). */
  alias: Partial<Record<StageId, StageId>>;
}

export const FLOWS: Record<FlowId, FlowInfo> = {
  '2d': {
    id: '2d', label: '2D',
    stages: ['space', 'bend', 'shape', 'shapeIt', 'colour', 'post'],
    alias: { camera: 'space', source: 'shape', objects: 'shape', combine: 'shape', scene: 'shape', march: 'shape', light: 'shapeIt', pass: 'post', rule: 'shapeIt', readout: 'shapeIt', sense: 'shape', steer: 'shape', move: 'shape', deposit: 'shape', trail: 'shape', draw: 'shape' },
  },
  '3d': {
    id: '3d', label: '3D',
    stages: ['camera', 'bend', 'objects', 'combine', 'scene', 'march', 'light', 'colour', 'post'],
    alias: { space: 'camera', source: 'objects', shape: 'objects', shapeIt: 'light', pass: 'post', rule: 'light', readout: 'light', sense: 'objects', steer: 'objects', move: 'objects', deposit: 'objects', trail: 'objects', draw: 'march' },
  },
  pass: {
    id: 'pass', label: 'Passes',
    stages: ['source', 'pass', 'rule', 'readout', 'colour', 'post'],
    alias: { space: 'source', camera: 'source', bend: 'rule', shape: 'source', objects: 'source', combine: 'source', scene: 'source', march: 'source', light: 'readout', shapeIt: 'readout', sense: 'rule', steer: 'rule', move: 'rule', deposit: 'rule', trail: 'rule', draw: 'readout' },
  },
  agents: {
    id: 'agents', label: 'Agents',
    stages: ['sense', 'steer', 'move', 'deposit', 'trail', 'draw', 'colour', 'post'],
    alias: { space: 'sense', camera: 'sense', source: 'sense', bend: 'steer', shape: 'sense', objects: 'sense', combine: 'sense', scene: 'sense', march: 'draw', light: 'draw', shapeIt: 'draw', pass: 'trail', rule: 'trail', readout: 'draw' },
  },
};

export const FLOW_ORDER: FlowId[] = ['2d', '3d', 'pass', 'agents'];

/** A stage as a flow sees it (its own, or the alias), with its place in the flow. */
export function inFlow(stage: StageOf, flow: FlowId): { stage: StageId; index: number } | null {
  if (stage === 'any') return null;
  const f = FLOWS[flow];
  const s = f.stages.includes(stage) ? stage : f.alias[stage];
  if (!s) return null;
  return { stage: s, index: f.stages.indexOf(s) };
}

// ── The map ─────────────────────────────────────────────────────────────────

/** Each registry category's usual stage. A category missing here fails the coverage test. */
export const CATEGORY_STAGE: Record<string, StageOf> = {
  Sources: 'any',
  '2D Space': 'bend',
  '2D Primitives': 'shape',
  SDF: 'shape',
  Noise: 'shape',
  Fractals: 'shape',
  Field: 'shape',
  Grid: 'bend',
  Science: 'shape',
  Halftone: 'shapeIt',
  Combiners: 'colour',
  Effects: 'post',
  'Post Processing': 'post',
  Color: 'colour',
  'Color Grading': 'colour',
  '3D Primitives': 'objects',
  '3D Transforms': 'bend',
  '4D': 'bend',
  '3D Scene': 'scene',
  '3D Lighting': 'light',
  Passes: 'readout',
  'Texture tools': 'readout',
  Simulation: 'move',
  Particles: 'draw',
  Output: 'any',
  Math: 'any',
  Shapers: 'any',
  Conditionals: 'any',
  Matrix: 'any',
  Animation: 'any',
  Utility: 'any',
  Functions: 'any',
  Loops: 'any',
};

/** Per-type exceptions to the category's stage. */
export const TYPE_STAGE: Record<string, StageOf> = {
  // Space: the coordinate itself, centred and zoomed.
  uv: 'space', pixelUV: 'space', fragCoord: 'space', uvTransform2d: 'space', rotate2d: 'space',
  // Sources that are pictures: what a pass or sim starts from.
  textureInput: 'source', videoInput: 'source', baked: 'source', timeCube: 'source', timeSlice: 'source',
  playLayers: 'source', motionMap: 'source',
  // 2D Space that draws rather than bends.
  waveTexture: 'shape', magicTexture: 'shape', chaosLayers: 'shape',
  // Noise: a warp is a bend.
  domainWarp: 'bend',
  // SDF: the style nodes paint the distance.
  sdfFill: 'shapeIt', sdfColorize: 'colour',
  // Union / Subtract / Intersect: Combine in 3D (a 2D flow reads Combine as Shape).
  sdfUnion: 'combine', sdfSubtract: 'combine', sdfIntersect: 'combine',
  // Field: thresholds and falloffs shape a field.
  metaballThreshold: 'shapeIt', fieldToLines: 'shapeIt', distanceFalloff: 'shapeIt',
  // Grid: the layout bends space; the rest draws or filters.
  gridPattern: 'shape', arrayField: 'shape', neighborDist: 'shape', neighborAttractCircles: 'shape', noisyGridSDF: 'shape',
  gridPaint: 'colour', cellFilter: 'shapeIt', waveRadius: 'shapeIt', neighborOffset2d: 'any', animatedCellCenter: 'any',
  // Halftone: cells are a bend; the CMYK screens are a finish.
  gridUV: 'bend', pixelate: 'bend', rgbToCMYK: 'post', cmykHalftone: 'post',
  // Science: the plate's terms are maths.
  waveTerm: 'any', chladniModeFreq: 'any',
  // Fractals that are whole 3D renders.
  raymarch3d: 'march', mandelbulb: 'march', volumeClouds: 'march',
  // Combiners: glows shape the distance; the rest mixes colour.
  glowLayer: 'shapeIt', deepGlow: 'shapeIt',
  // Effects: light from a distance; warps; the colour-making ones.
  light: 'shapeIt', light2d: 'shapeIt', radianceCascadesApprox: 'shapeIt', glowToColor: 'colour', normalToColor: 'colour',
  gravitationalLens: 'bend', floatWarp: 'any', forLoop: 'any', exprNode: 'any', customFn: 'any',
  // Colour grading's finishing tools.
  toneMap: 'post', grain: 'post',
  // Post Processing: the feedback ones are a pass.
  prevFrame: 'pass', sobel: 'shapeIt',
  // 2D Space fields that give directions.
  vectorField: 'bend', gravityField: 'bend', spiralField: 'bend',
  // 4D: the shapes are objects, the rest bend the point.
  hypersphereSDF: 'objects', tesseractSDF: 'objects', duocylinderSDF: 'objects', spherinderSDF: 'objects', cubinderSDF: 'objects',
  cylPrismSDF: 'objects', ditorusSDF: 'objects', cliffordTorusSDF: 'objects', cell5SDF: 'objects', cell16SDF: 'objects', cell24SDF: 'objects', noise4D: 'any', wireframe4D: 'objects', project4D: 'objects', hopfCirclesSDF: 'objects',
  // 3D Primitives that warp space.
  mirrorFold3D: 'bend', domainWarp3D: 'bend', turbulence3D: 'bend',
  // 3D Scene.
  marchCamera: 'camera', forwardCamera: 'camera', scenePos: 'any', marchPos: 'any', marchLoopInputs: 'any', marchLoopOutput: 'any',
  spaceWarpGroup: 'bend', marchOutput: 'bend', sceneGroup: 'scene', sceneOutput: 'scene', marchDist: 'scene', marchSceneDist: 'scene',
  rayMarch: 'march', rayRender: 'march', marchLoopGroup: 'march', giLitMarchGroup: 'march', volumetricScene: 'march',
  glassScene: 'march', sceneBuilder: 'march', timeCubeView: 'march', frameStack: 'march', volumeGlow: 'light',
  // Passes.
  pass: 'pass', blurTexture: 'rule', displaceTexture: 'rule', jumpFloodTexture: 'rule', displacementMap: 'bend',
  textureFade: 'rule', textureNeighbours: 'rule', gridRules: 'rule', echo: 'pass',
  // Simulation: the Agents family, step by step.
  agentSense: 'sense', agentNeighbours: 'sense', agentSteer: 'steer',
  agentGravity: 'steer', agentWind: 'steer', agentCurl: 'steer', agentAttract: 'steer', agentVortex: 'steer', agentFlow: 'steer', agentSoundKick: 'steer',
  agentDeposit: 'deposit', trailField: 'trail', drawAgents: 'draw',
  agentInputs: 'any', agentOutput: 'any', agentBySpecies: 'any',
  // Output: the hidden ends of passes keep their stage.
  blurStage: 'rule', gridRulesStep: 'rule',
  // Interpolation that makes masks.
  smoothstep: 'any',
  // A picked colour is a constant (a tint fed anywhere), not a colouring step.
  colorPicker: 'any', luminance: 'any',
};

/** A type's stage and where it came from; undefined when neither its type nor its category is mapped. */
export function stageEntry(type: string): { stage: StageOf; from: 'type' | 'category' } | undefined {
  if (type in TYPE_STAGE) return { stage: TYPE_STAGE[type], from: 'type' };
  const cat = getNodeDefinition(type)?.category;
  if (cat !== undefined && cat in CATEGORY_STAGE) return { stage: CATEGORY_STAGE[cat], from: 'category' };
  return undefined;
}

const cache = new Map<string, StageOf>();
/** A node type's stage ('any' for user nodes and unknown categories). */
export function stageOfType(type: string): StageOf {
  let s = cache.get(type);
  if (s === undefined) {
    s = stageEntry(type)?.stage ?? 'any';
    // User nodes can change; only built-ins are cached.
    if (type in TYPE_STAGE || getNodeDefinition(type)?.category !== 'My Nodes') cache.set(type, s);
  }
  return s;
}

/** Types that mark a flow (a graph that has one is that kind). */
export const FLOW_MARKERS: Record<Exclude<FlowId, '2d'>, ReadonlySet<StageId>> = {
  '3d': new Set<StageId>(['camera', 'objects', 'scene', 'march', 'light']),
  pass: new Set<StageId>(['pass', 'rule']),
  agents: new Set<StageId>(['sense', 'steer', 'move', 'deposit', 'trail', 'draw']),
};
