/**
 * Grid Rules (docs/grid-rules.md): a cellular simulation in one node. Its editor window
 * (components/gridRules) writes a rule set into the node's params; the compiler opens the node
 * into a board Pass that reads its own Previous, a step program made from the rule
 * (gridRulesStep), and, where the node is read, the board coloured (this node's own GLSL).
 * See compiler/gridRulesExpand.ts. Open as nodes (store/gridRulesAsNodes.ts) builds the same
 * simulation from ordinary nodes, for learning.
 *
 * Also here: Mouse button, the pointer's button as a number (u_mousebtn), which the hosts set on
 * the Studio preview, the Play page and exported pages alike.
 */
import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';
import { BOARD_SIZES, GRID_DEFAULTS, MAX_RADIUS, MAX_STATES, MAX_STEPS, gridShape } from '../../gridRules/spec';
import { GRID_VIEWS, GR_HASH_GLSL, gridStepGLSL, gridViewGLSL, gridViewMode, type GridNames } from '../../gridRules/glsl';
import { GR_DICE_GLSL } from '../../gridRules/dice';

/** The pointer's button (1 while down over the picture). Declared only by the nodes that read it. */
export const MOUSE_BUTTON_UNIFORM = 'u_mousebtn';
const BUTTON_DECL = `uniform float ${MOUSE_BUTTON_UNIFORM};`;

const sel = (label: string, options: Array<[string, string]>, hint: string, section?: string): ParamDef =>
  ({ label, type: 'select', options: options.map(([value, l]) => ({ value, label: l })), hint, ...(section ? { section } : {}) });
const num = (label: string, min: number, max: number, step: number, hint: string, section: string, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ label, type: 'float', min, max, step, hint, section, ...extra });
const colour = (label: string, hint: string): ParamDef => ({ label, type: 'vec3color', hint, section: 'Colours' });

const DISCRETE = { param: 'ruleType', value: ['count', 'stages', 'patterns', 'blocks'] };
const SMOOTH = { param: 'ruleType', value: 'smooth' };
const MULTI = { param: 'ruleType', value: ['patterns', 'blocks'] };

/**
 * Every setting. Selects and Steps are baked (they shape the GLSL); the numbers and colours are
 * live uniforms, so the editor's switches, sliders and Play controls never recompile. The card
 * shows only a few of them (GRID_CARD_KEYS); the editor window has the rest. Whole-number
 * settings step by 0.5, not 1, so Play can map them (it takes sliders, and reads step 1 as not
 * one); the GLSL rounds them.
 */
export const GRID_PARAM_DEFS: Record<string, ParamDef> = {
  ruleType: sel('Rule type', [['count', 'Count (Life-like)'], ['stages', 'Stages (Generations)'], ['patterns', 'Patterns (3×3 stencils)'], ['blocks', 'Blocks (Margolus 2×2)'], ['smooth', 'Smooth (continuous)']], 'Which kind of rule: each has its own form in the editor.', 'Rule'),
  neighbourhood: sel('Neighbourhood', [['moore', 'Moore (8 round)'], ['vonNeumann', 'von Neumann (4: up, down, left, right)'], ['radius', 'Radius N (Larger than Life)']], 'Which cells count as neighbours.', 'Rule'),
  radius: num('Radius', 1, MAX_RADIUS, 1, 'Larger than Life: how far the neighbourhood reaches, in cells.', 'Rule', { compileTime: true, hard: true }),
  shape: sel('Shape', [['box', 'Box'], ['circle', 'Circle']], 'Larger than Life: a square block of cells, or a round one.', 'Rule'),
  bornMask: num('Born on', 0, 511, 0.5, 'Which neighbour counts bring an empty cell to life (bit k: born with k neighbours). Set in the editor.', 'Rule', { showWhen: { param: 'ruleType', value: ['count', 'stages'] } }),
  surviveMask: num('Survive on', 0, 511, 0.5, 'Which neighbour counts keep a live cell alive (bit k). Set in the editor.', 'Rule', { showWhen: { param: 'ruleType', value: ['count', 'stages'] } }),
  bornLo: num('Born from', 0, 224, 0.5, 'Larger than Life: an empty cell is born with at least this many live neighbours…', 'Rule', { showWhen: { param: 'neighbourhood', value: 'radius' } }),
  bornHi: num('Born to', 0, 224, 0.5, '…and at most this many.', 'Rule', { showWhen: { param: 'neighbourhood', value: 'radius' } }),
  surviveLo: num('Survive from', 0, 224, 0.5, 'Larger than Life: a live cell survives with at least this many…', 'Rule', { showWhen: { param: 'neighbourhood', value: 'radius' } }),
  surviveHi: num('Survive to', 0, 224, 0.5, '…and at most this many.', 'Rule', { showWhen: { param: 'neighbourhood', value: 'radius' } }),
  states: num('States', 2, MAX_STATES, 0.5, 'Stages: how many states, counting empty and on. 3 = on, one dying stage, off.', 'Rule', { showWhen: { param: 'ruleType', value: ['stages', 'patterns', 'blocks'] } }),
  jitter: num('Jitter', 0, 1, 0.01, 'Blocks: shifts the blocks a row up or down at random, column by column, each step. Grains then stop falling in step on every other row (no bands), and slopes look less rigid. 0 is the classic Margolus grid; every block still changes all four cells at once, so nothing is lost or made.', 'Rule', { showWhen: { param: 'ruleType', value: 'blocks' } }),
  template: sel('Template', [['diffusion', 'Diffusion (heat)'], ['waves', 'Waves'], ['reaction', 'Reaction–diffusion'], ['custom', 'Custom update']], 'Smooth: which update every cell runs.', 'Rule'),
  customU: { label: 'New u', type: 'string', hint: 'Smooth, Custom: one expression for the new first value (u, v, lap_u, avg_u, n, s, e, w, a…d, t, rnd).', section: 'Rule' },
  customV: { label: 'New v', type: 'string', hint: 'Smooth, Custom: one expression for the new second value.', section: 'Rule' },
  spread: num('Spread', 0, 1, 0.01, 'Diffusion: how far each step moves a cell towards its neighbours\' average.', 'Rule', { showWhen: SMOOTH }),
  decay: num('Cooling', 0, 0.1, 0.001, 'Diffusion: the share lost each step.', 'Rule', { showWhen: SMOOTH }),
  waveSpeed: num('Wave speed', 0, 1, 0.01, 'Waves: how fast ripples spread (1 is the fastest the grid can carry).', 'Rule', { showWhen: SMOOTH }),
  damping: num('Damping', 0.9, 1, 0.001, 'Waves: what each step keeps (1 rings for ever).', 'Rule', { showWhen: SMOOTH }),
  feed: num('Feed', 0, 0.1, 0.0005, 'Reaction–diffusion: how fast chemical A is fed in.', 'Rule', { showWhen: SMOOTH }),
  kill: num('Kill', 0, 0.1, 0.0005, 'Reaction–diffusion: how fast chemical B is taken away.', 'Rule', { showWhen: SMOOTH }),
  diffA: num('Spread A', 0, 1, 0.01, 'Reaction–diffusion: how fast A spreads.', 'Rule', { showWhen: SMOOTH }),
  diffB: num('Spread B', 0, 1, 0.01, 'Reaction–diffusion: how fast B spreads.', 'Rule', { showWhen: SMOOTH }),
  knobA: num('Knob A', 0, 1, 0.001, 'Custom update: the value of a.', 'Rule', { showWhen: SMOOTH }),
  knobB: num('Knob B', 0, 1, 0.001, 'Custom update: the value of b.', 'Rule', { showWhen: SMOOTH }),
  knobC: num('Knob C', 0, 1, 0.001, 'Custom update: the value of c.', 'Rule', { showWhen: SMOOTH }),
  knobD: num('Knob D', 0, 1, 0.001, 'Custom update: the value of d.', 'Rule', { showWhen: SMOOTH }),

  rate: num('Speed', 0, 1, 0.01, 'Steps a frame below 1: at 0.25 the board steps every fourth frame. (Steps runs several a frame.)', 'Run'),
  steps: num('Steps a frame', 1, MAX_STEPS, 1, 'Runs the rule this many times each frame (the board Pass\'s Repeat). Costs that many board draws.', 'Run', { compileTime: true, hard: true }),
  reset: num('Reset', 0, 1, 0.5, 'While 1, the board is dealt again every frame. A switch in Play.', 'Run'),
  start: sel('Start', [['noise', 'Noise'], ['empty', 'Empty'], ['image', 'Image (wire Start image)'], ['centre', 'Centre seed']], 'What a new board starts as.', 'Run'),
  density: num('Density', 0, 1, 0.01, 'Noise and Centre seed: the share of cells that start on.', 'Run'),
  seed: num('Seed', 0, 100, 0.5, 'Which noise: a different seed deals a different board.', 'Run'),
  board: sel('Board size', BOARD_SIZES.map(b => [b.value, b.label]), 'How many cells: the board Pass\'s size. Each cell is a block of the picture.', 'Run'),
  edges: sel('Edges', [['wrap', 'Wrap (a torus)'], ['walls', 'Walls']], 'Wrap: what leaves one side comes back on the other. Walls: the edge is empty (Smooth: it reflects).', 'Run'),

  paint: num('Paint', 0, 1, 0.5, 'While 1 the brush paints wherever the pointer is, button or not (map a key to it in Play).', 'Brush'),
  brushRadius: num('Brush size', 0.5, 40, 0.5, 'The brush\'s radius, in cells.', 'Brush'),
  brushState: num('Brush paints', -1, MAX_STATES - 1, 0.5, 'The state the brush paints (0 erases). Smooth: the value it sets.', 'Brush'),
  brushFill: num('Brush fill', 0, 1, 0.01, 'The share of cells under the brush it paints each frame (Life likes a sprinkle, not a solid block).', 'Brush', { showWhen: DISCRETE }),

  afterglow: num('Afterglow', 0, 0.99, 0.01, 'How long a cell that just switched off keeps glowing (its glow is kept times this each step).', 'Colours', { showWhen: DISCRETE }),
  ageRate: num('Ageing', 0, 0.2, 0.001, 'How fast a live cell ages (its age climbs by this each step, up to 1).', 'Colours', { showWhen: DISCRETE }),
  ageFade: num('Age fade', 0, 1, 0.01, 'How far a live cell\'s colour moves to Old cells as it ages.', 'Colours', { showWhen: DISCRETE }),
  gain: num('Contrast', 0, 8, 0.01, 'Smooth: scales the value before it is coloured.', 'Colours', { showWhen: SMOOTH }),
  color0: colour('Empty (state 0)', 'Empty cells. Smooth: the low end of the ramp.'),
  color1: colour('On (state 1)', 'Live cells. Smooth: the second stop.'),
  color2: { ...colour('State 2', 'Stages: the first dying stage. Smooth: the third stop.'), showWhen: { param: 'ruleType', value: ['stages', 'patterns', 'blocks', 'smooth'] } },
  color3: { ...colour('State 3', 'Stages: the last dying stage (stages between blend). Smooth: the high end.'), showWhen: { param: 'ruleType', value: ['stages', 'patterns', 'blocks', 'smooth'] } },
  color4: { ...colour('State 4', 'Patterns and Blocks: state 4.'), showWhen: MULTI },
  color5: { ...colour('State 5', 'Patterns and Blocks: state 5.'), showWhen: MULTI },
  color6: { ...colour('State 6', 'Patterns and Blocks: state 6.'), showWhen: MULTI },
  color7: { ...colour('State 7', 'Patterns and Blocks: state 7 and up.'), showWhen: MULTI },
  view: sel('Show', GRID_VIEWS.map(x => [x.value, x.label]), 'What Color shows: the coloured board, or the State, Age or Neighbour count as grey (the sockets always carry them).', 'Colours'),
  glowColor: { ...colour('Afterglow', 'The colour a cell glows as it switches off, fading to Empty.'), showWhen: DISCRETE },
  oldColor: { ...colour('Old cells', 'The colour live cells age towards (Age fade).'), showWhen: DISCRETE },
};

/** The settings the card shows (the editor has every one). */
export const GRID_CARD_KEYS = new Set(['rate', 'reset', 'brushRadius', 'brushState']);

function names(node: GraphNode): GridNames {
  return {
    id: node.id,
    P: key => p(node.params[key], typeof GRID_DEFAULTS[key] === 'number' ? GRID_DEFAULTS[key] as number : 0),
    C: key => pv3(node.params[key], (GRID_DEFAULTS[key] as number[] | undefined) ?? [0, 0, 0]),
  };
}

export const GridRulesNode: NodeDefinition = {
  type: 'gridRules',
  label: 'Grid Rules',
  category: 'Simulation',
  aliases: ['Cellular automaton', 'Game of Life', 'Life-like', 'Generations', 'Wireworld', 'Margolus', 'Reaction diffusion', 'Grid simulation', 'Rule set'],
  description: 'A cellular simulation in one node: a board of cells and the rule that steps it. Open the editor to pick a rule (Count, Stages, Smooth…), a start, the brush and the colours. The compiler gives it a board Pass of its own that reads its last step; Open as nodes builds the same thing from ordinary nodes, to learn from.',
  brief: {
    summary: 'A board of cells and its rule, in one node. Open the editor (⊞) for the rule; wire Color to the Output.',
    start: ['Wire Color into the Output.', 'Open the editor and pick a preset (Life, Brian\'s Brain, Ripples…).', 'Hold the mouse button over the picture to paint cells.'],
  },
  inputs: {
    image: { type: 'texture', label: 'Start image', hint: 'With Start set to Image: a picture (a Texture Input\'s or a Pass\'s Texture) whose bright parts start on.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The board at this pixel, coloured by state (and afterglow / age).' },
    state: { type: 'float', label: 'State', hint: 'The cell\'s state here: 0, 1, 2… (Smooth: its first value).' },
    alive: { type: 'float', label: 'On', hint: '1 where the cell is on (state 1), else 0. Smooth: the value, 0–1.' },
    age: { type: 'float', label: 'Age', hint: 'A live cell\'s age (0–1), or a dead cell\'s afterglow. Smooth: the second value.' },
    value: { type: 'float', label: 'Shade', hint: 'The 0–1 shade the colours are picked by.' },
    neighbours: { type: 'float', label: 'Neighbours', hint: 'How many of the cells round this one are on (0–8; von Neumann 0–4). Smooth: their average value.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The coloured board as a texture (one more small pass): wire it into Glow, Sample, a Texture tool or an Agents group.' },
    board: { type: 'texture', label: 'Cells', hint: 'The raw board: red the state, green age, alpha the rule\'s signature. For Sample (texture) reads of the cells.' },
  },
  defaultParams: { ...GRID_DEFAULTS },
  paramDefs: GRID_PARAM_DEFS,
  assignable: false,
  generateGLSL: (node, inputVars) => gridViewGLSL(gridShape(node.params), names(node), inputVars.__board, inputVars.__pic, gridViewMode(node.params.view)),
};

/** One step of a Grid Rules board: made by the compiler (compiler/gridRulesExpand.ts), never in a graph. */
export const GridRulesStepNode: NodeDefinition = {
  type: 'gridRulesStep',
  label: 'Grid Rules step',
  category: 'Output',
  description: 'Internal: one step of a Grid Rules board, the whole of its board Pass\'s program.',
  inputs: {
    prev: { type: 'texture', label: 'Board a step ago' },
    image: { type: 'texture', label: 'Start image' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams: { ...GRID_DEFAULTS },
  paramDefs: GRID_PARAM_DEFS,
  assignable: false,
  glslFunction: GR_HASH_GLSL,
  // Blocks' dice and block layout (gridRules/dice.ts): only Blocks boards carry them.
  glslFunctionsFor: (node: GraphNode) => (gridShape(node.params).type === 'blocks' ? [GR_DICE_GLSL] : []),
  declarationsFor: () => [BUTTON_DECL],
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    if (!inputVars.prev) return { code: `    vec3 ${id}_out = vec3(0.0);\n    float ${id}_outA = 0.0;\n`, outputVars: { color: `${id}_out`, alpha: `${id}_outA` } };
    return { code: gridStepGLSL(gridShape(node.params), names(node), inputVars.prev, inputVars.image), outputVars: { color: `${id}_out`, alpha: `${id}_outA` } };
  },
};

export const MouseButtonNode: NodeDefinition = {
  type: 'mouseButton',
  label: 'Mouse button',
  category: 'Sources',
  aliases: ['Mouse down', 'Click', 'Pointer down', 'Pressed'],
  description: '1 while the mouse button (or a finger) is down on the picture, else 0: in the Studio preview, on the Play page and on exported pages. With Mouse, a brush.',
  inputs: {},
  outputs: { down: { type: 'float', label: 'Down', hint: '1 while the button is held over the picture.' } },
  assignable: false,
  declarationsFor: () => [BUTTON_DECL],
  generateGLSL: node => ({ code: `    float ${node.id}_down = ${MOUSE_BUTTON_UNIFORM};\n`, outputVars: { down: `${node.id}_down` } }),
};
