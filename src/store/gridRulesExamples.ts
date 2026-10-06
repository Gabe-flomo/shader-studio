/**
 * gridRulesExamples.ts — the Grid Rules versions of the Simulations: grids examples
 * (docs/grid-rules.md): each one a Grid Rules node and an Output (a Glow where it adds to the
 * look), beside the wired version it rebuilds ("… (under the hood)", store/simGridExamples.ts).
 * Built from the node definitions (graphBuilder.ts); every node has a note.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayControl, PlayRecord } from '../types/play';
import { colourCtl, ctl, n } from './graphBuilder';
import { COUNT_PRESETS, SMOOTH_PRESETS, STAGES_PRESETS, maskOf, presetPatch } from '../gridRules/spec';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../gridRules/stencils';
import { GRID_RULES_EXAMPLE_INDEX } from './gridRulesExampleIndex';

const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });
const toggle = (id: string, target: string, label: string): PlayControl => ({ ...ctl(id, target, label, 0, 1, 1), toggle: true });
const play = (controls: PlayControl[], notes: string): PlayRecord => ({ version: 1, controls, mappings: [], layers: [], notes });
const out = (from: [string, string], x = 900) => n('output', 'out', x, 200, note('Output: the picture. The board is read with Nearest sampling, so cells stay square at any size.'), { color: from });

const runControls = (G: string, discrete = true): PlayControl[] => [
  ctl('speed', `${G}::rate`, 'Speed', 0.02, 1, 0.01),
  toggle('reset', `${G}::reset`, 'Reset'),
  ctl('density', `${G}::density`, 'Start density', 0.02, 0.95, 0.01),
  ctl('brush', `${G}::brushRadius`, 'Brush size (cells)', 0.5, 30, 0.5),
  toggle('paint', `${G}::paint`, 'Paint without the button'),
  ...(discrete ? [ctl('afterglow', `${G}::afterglow`, 'Afterglow', 0, 0.99, 0.01)] : []),
];

const HOW = '**How it is built.** One Grid Rules node: its editor (the ⊞ on the card) holds the rule, the start, the brush and the colours. The compiler gives it a board Pass that reads its own last step, so it runs on the GPU like the wired version. **Open as nodes** (on the card) builds that wired graph under it, every node with a note.';

export function buildGridRulesExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};
  const grid = (id: string, label: string, params: Record<string, unknown>, why: string[]): GraphNode =>
    n('gridRules', id, 100, 200, { label, ...params, ...note(why) });

  // 1 · Life
  g.gridRulesLife = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesLife, counter: 10,
    nodes: [
      grid('life', 'Life rules', {
        ...COUNT_PRESETS.life.params, board: '0.125', rate: 0.5, density: 0.3, brushRadius: 4, brushFill: 0.5, afterglow: 0.93,
        color0: [0.02, 0.025, 0.05], glowColor: [0.95, 0.45, 0.2], color1: [0.85, 1.0, 0.92],
      }, [
        'Grid Rules: Conway\'s Game of Life (B3/S23) on a ⅛-size board (240 × 135 cells at 1080p) that wraps round.',
        'Speed 0.5 steps every other frame; a cell that dies glows warm (Afterglow) and fades. The brush sprinkles half the cells under it (a solid block would die of crowding).',
      ]),
      out(['life', 'color']),
    ],
    play: play([
      ...runControls('life'),
      colourCtl('live', 'life::color1', 'Live cells'),
      colourCtl('glow', 'life::glowColor', 'Afterglow colour'),
    ], `**What it shows.** Conway's Game of Life (Gardner, 1970) as one node.\n\n${HOW}\n\n**Try.** Hold the mouse button and draw. Slow Speed right down to watch single steps. Flip Reset for a new board. In the editor, pick HighLife or Seeds.`),
  };

  // 2 · Life-like
  g.gridRulesLifeLike = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesLifeLike, counter: 10,
    nodes: [
      grid('rules', 'Day and Night', {
        ...COUNT_PRESETS.dayNight.params, board: '0.125', rate: 0.5, density: 0.5, brushRadius: 5, brushFill: 0.5, afterglow: 0.8,
        color0: [0.04, 0.03, 0.09], glowColor: [0.2, 0.35, 0.8], color1: [1.0, 0.86, 0.55],
      }, [
        'Grid Rules: Day & Night (B3678/S34678), a rule that treats live and dead alike: islands of each grow in the other.',
        'Open the editor to switch the Born on and Survive on numbers, or type a rule such as B36/S23.',
      ]),
      out(['rules', 'color']),
    ],
    play: play([
      ...runControls('rules'),
      ctl('born', 'rules::bornMask', 'Born on (bits 0–8)', 0, 511, 1),
      ctl('survive', 'rules::surviveMask', 'Survive on (bits 0–8)', 0, 511, 1),
    ], `**What it shows.** Life-like rules: which neighbour counts give birth, which let a cell survive.\n\n${HOW}\n\n**Try.** In the editor: HighLife (B36/S23), Seeds (B2/S), Maze (B3/S12345), Coral (B3/S45678), Anneal (B4678/S35678), Diamoeba, Replicator. The two Play numbers are the switches as bits (bit k on = count k).`),
  };

  // 3 · Brian's Brain, with a glow from its Texture
  g.gridRulesBrain = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesBrain, counter: 10,
    nodes: [
      grid('brain', 'Brain rules', {
        ruleType: 'stages', ...STAGES_PRESETS.briansBrain.params, board: '0.25', rate: 1, density: 0.3, brushRadius: 6, brushFill: 0.4, afterglow: 0,
        color0: [0.01, 0.01, 0.03], color1: [0.75, 0.95, 1.0], color2: [0.25, 0.45, 1.0], color3: [0.12, 0.06, 0.3],
      }, [
        'Grid Rules, Stages: Brian\'s Brain (Generations /2/3) on a ¼-size board (480 × 270 cells), one step a frame.',
        'On cells are pale blue, the dying stage deep blue. Its Texture output (the coloured board as a texture: one more small pass) feeds the Glow.',
      ]),
      n('glowTexture', 'glow', 420, 380, { radius: 10, threshold: 0.3, intensity: 1.4, ...note('Glow (texture): the bright on cells, spread into a soft light (a bloom chain on the board\'s Texture).') }, { texture: ['brain', 'texture'] }),
      n('addColor', 'add', 680, 220, { scale: 1, ...note('Add Colors: the cells plus their glow.') }, { a: ['brain', 'color'], b: ['glow', 'glow'] }),
      out(['add', 'result'], 960),
    ],
    play: play([
      ...runControls('brain'),
      ctl('glow', 'glow::intensity', 'Glow', 0, 4, 0.01),
      colourCtl('on', 'brain::color1', 'On cells'),
    ], `**What it shows.** A three-state automaton as a Stages rule: off → on with exactly 2 on neighbours, on → dying, dying → off.\n\n${HOW}\n\n**Try.** In the editor, raise States for longer tails, or try Star Wars and Sticks.`),
  };

  // 4 · Cave generator
  g.gridRulesCave = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesCave, counter: 10,
    nodes: [
      grid('cave', 'Cave rules', {
        ruleType: 'count', neighbourhood: 'moore', bornMask: maskOf([5, 6, 7, 8]), surviveMask: maskOf([4, 5, 6, 7, 8]),
        board: '0.125', edges: 'walls', steps: 8, density: 0.5, seed: 7, brushRadius: 3, brushFill: 1, brushState: 0,
        afterglow: 0.6, ageRate: 0, ageFade: 0,
        color0: [0.86, 0.78, 0.62], color1: [0.3, 0.25, 0.23], glowColor: [0.62, 0.55, 0.45],
      }, [
        'Grid Rules, Count: the 4-5 rule. A cell is rock when 5 or more of its 3 × 3 block (itself too) are rock: as a Life-like rule that is born with 5–8 rock neighbours and survives with 4–8.',
        'Steps a frame 8 (the board Pass\'s Repeat): a new map is smoothed within a frame, then holds. Walls keep the edge open. Afterglow shades where rock was just dug away.',
        'The brush paints 0: dig tunnels.',
      ]),
      out(['cave', 'color']),
    ],
    play: play([
      toggle('reset', 'cave::reset', 'New map'),
      ctl('seed', 'cave::seed', 'Seed', 0, 100, 1),
      ctl('density', 'cave::density', 'Rock density', 0.35, 0.6, 0.005),
      ctl('brush', 'cave::brushRadius', 'Dig size (cells)', 0.5, 12, 0.5),
      colourCtl('rock', 'cave::color1', 'Rock'),
      colourCtl('floor', 'cave::color0', 'Floor'),
    ], `**What it shows.** Cave maps from noise by the 4-5 rule (Johnson, Yannakakis and Togelius; Babcock on RogueBasin).\n\n${HOW}\n\n**Try.** Move Seed or Rock density (then New map). Hold the mouse button to dig.`),
  };

  // 5 · Water
  g.gridRulesWater = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesWater, counter: 10,
    nodes: [
      grid('water', 'Water rules', {
        ruleType: 'smooth', ...SMOOTH_PRESETS.ripples.params, board: '0.5', edges: 'walls', start: 'centre', steps: 2, brushRadius: 3, brushState: 1, gain: 4,
        color0: [0.0, 0.04, 0.12], color1: [0.03, 0.2, 0.42], color2: [0.3, 0.65, 0.88], color3: [0.95, 1.0, 1.0],
      }, [
        'Grid Rules, Smooth, Waves: Hugo Elias\'s two-buffer water on a ½-size board, two steps a frame. Red is the height now, green the height a step before.',
        'Walls reflect the ripples. It starts with one drop in the middle; hold the mouse button to push the surface.',
      ]),
      out(['water', 'color']),
    ],
    play: play([
      toggle('reset', 'water::reset', 'Reset'),
      ctl('speed', 'water::waveSpeed', 'Wave speed', 0, 1, 0.01),
      ctl('damping', 'water::damping', 'Damping', 0.95, 1, 0.0005),
      ctl('brush', 'water::brushRadius', 'Push size (cells)', 0.5, 20, 0.5),
      toggle('paint', 'water::paint', 'Push without the button'),
    ], `**What it shows.** Water ripples as a Smooth rule's Waves template.\n\n${HOW}\n\n**Try.** Draw across the water. Lower Damping for calmer water.`),
  };

  // 6 · Heat
  g.gridRulesHeat = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesHeat, counter: 10,
    nodes: [
      grid('heat', 'Heat rules', {
        ruleType: 'smooth', template: 'custom', customU: 'mix(u, (n + s + e + w) * 0.25, 0.9) * (1.0 - a * 0.01) + step(1.0 - b * 0.001, rnd) * 3.0', customV: 'v',
        knobA: 0.4, knobB: 0.3, board: '0.25', edges: 'walls', steps: 4, start: 'empty', brushRadius: 4, brushState: 1, gain: 1,
        color0: [0.02, 0.02, 0.05], color1: [0.55, 0.05, 0.2], color2: [1.0, 0.45, 0.1], color3: [1.0, 0.95, 0.75],
      }, [
        'Grid Rules, Smooth, Custom: the update is one line. Each cell moves 0.9 of the way to its four neighbours\' average (diffusion), loses a share (knob a: cooling) and, now and then (knob b), flares to 3.',
        'Four steps a frame on a ¼-size board. Paint heat with the mouse.',
      ]),
      out(['heat', 'color']),
    ],
    play: play([
      ctl('cool', 'heat::knobA', 'Cooling (a)', 0, 1, 0.01),
      ctl('flares', 'heat::knobB', 'Flares (b)', 0, 1, 0.01),
      ctl('brush', 'heat::brushRadius', 'Brush size (cells)', 0.5, 30, 0.5),
      toggle('paint', 'heat::paint', 'Paint without the button'),
      toggle('reset', 'heat::reset', 'Reset'),
    ], `**What it shows.** Heat spreading and cooling, written as a custom update: mix(u, (n + s + e + w) × 0.25, 0.9) × (1 − a × 0.01) + flares.\n\n${HOW}\n\n**Try.** In the editor, change the update: drop the flares, or make it spread only sideways.`),
  };

  // 7 · Forest fire
  g.gridRulesFire = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesFire, counter: 10,
    nodes: [
      grid('fire', 'Fire rules', {
        ruleType: 'smooth', template: 'custom',
        customU: 'u > 1.5 ? 0.0 : (u > 0.5 ? (((max(max(n, s), max(e, w)) > 1.5 && rnd < a) || (abs(x - fract(sin(floor(t * d * 10.0) * 12.9898) * 43758.5453)) < 0.003 && abs(y - fract(sin(floor(t * d * 10.0) * 78.233) * 43758.5453)) < 0.005)) ? 2.0 : 1.0) : (rnd < b * 0.02 && mod(floor(t * 6.0), 6.0) < 0.5 ? 1.0 : 0.0))',
        customV: 'u > 1.5 ? 1.0 : v * 0.9',
        knobA: 0.95, knobB: 0.2, knobD: 0.03, board: '0.25', start: 'noise', density: 0.75, rate: 1, brushRadius: 3, brushState: 2, gain: 0.5,
        color0: [0.06, 0.04, 0.03], color1: [0.08, 0.3, 0.1], color2: [0.12, 0.42, 0.14], color3: [1.0, 0.55, 0.12],
      }, [
        'Grid Rules, Smooth, Custom: the Drossel–Schwabl forest fire as one line. u is 0 (ground), 1 (a tree) or 2 (fire): fire burns out; a tree catches from fire beside it (with chance a); lightning strikes one random spot, d × 10 times a second (the spot comes from t, not rnd: a per-cell chance that small is below what the dice can roll); ground grows a tree with chance b × 0.02 during one frame-window in six (about b × 0.0033 a step), so a forest takes some 25 s to grow back and fires sweep through grown forest in fronts.',
        'The ramp colours u: ground dark, trees green, fire orange. The brush sets 2: click to light the forest.',
      ]),
      out(['fire', 'color']),
    ],
    play: play([
      ctl('spread', 'fire::knobA', 'Spread chance (a)', 0, 1, 0.01),
      ctl('growth', 'fire::knobB', 'Growth (b)', 0, 1, 0.01),
      ctl('lightning', 'fire::knobD', 'Lightning (d)', 0, 1, 0.01),
      ctl('speed', 'fire::rate', 'Speed', 0.05, 1, 0.01),
      toggle('reset', 'fire::reset', 'Replant'),
    ], `**What it shows.** A forest fire (Drossel and Schwabl, 1992) as a custom Smooth update holding three states.\n\n${HOW}\n\n**Try.** Raise Growth for a denser forest and bigger fires; set Spread chance to 1 for square fire fronts.`),
  };
  // 8 · Falling sand: Blocks
  g.gridRulesSand = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesSand, counter: 10,
    nodes: [
      grid('sand', 'Sand rules', {
        ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.sand), board: '0.25', edges: 'walls', start: 'noise', density: 0.2, rate: 1, brushRadius: 4,
      }, [
        'Grid Rules, Blocks: Margolus falling sand on a ¼-size board with walls. 0 is air, 1 sand, 2 wall.',
        'Each step the board is cut into 2×2 blocks (the cut shifting one cell diagonally every other step); a block whose picture matches a rule becomes its after picture: a grain over air falls, a grain on a heap slides down to the side (with chance 0.8, rolled per block). The rules only rearrange, so the count of grains never changes.',
        'Hold the mouse button to pour sand; set Brush paints to 2 to draw walls, 0 to erase.',
      ]),
      out(['sand', 'color']),
    ],
    play: play([
      ctl('brush', 'sand::brushRadius', 'Brush size (cells)', 0.5, 20, 0.5),
      ctl('paints', 'sand::brushState', 'Brush paints (0 air, 1 sand, 2 wall)', 0, 2, 0.5),
      ctl('fill', 'sand::brushFill', 'Brush fill', 0, 1, 0.01),
      toggle('paint', 'sand::paint', 'Pour without the button'),
      toggle('reset', 'sand::reset', 'Reset'),
      colourCtl('grain', 'sand::color1', 'Sand'),
    ], `**What it shows.** Falling sand as a Blocks rule (Toffoli and Margolus): 2×2 blocks change together, so grains move without ever being lost or doubled.\n\n${HOW}\n\n**Try.** Draw walls (Brush paints 2) as shelves, then pour sand on them. In the editor, lower the slide's Chance for steeper heaps.`),
  };

  // 9 · Wireworld: Patterns, its starter circuit drawn into a Pass (whole-number cells, so == is exact)
  const onRingCheck = (row: string) => `(onRing > 0.5 && at.x == ring && ${row}) ? 1.0 : 0.0`;
  g.gridRulesWire = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesWire, counter: 20,
    nodes: [
      n('fragCoord', 'pix', -1180, 200, note('Pixel Coordinates: inside the starter Pass (the board\'s size) this counts cells, so the layout is drawn cell by cell.')),
      n('constant', 'bridges', -1180, 380, { value: 0.35, label: 'Bridges', ...note('Bridges: the share of tiles whose outer loop is joined to the next tile\'s. Takes effect on Reset.') }),
      n('exprNode', 'starter', -780, 200, {
        label: 'Starter circuit',
        inputs: [{ name: 'cell', type: 'vec2', slider: null }, { name: 'bridges', type: 'float', slider: null }],
        outputType: 'vec3',
        lines: [
          ['vec2 tile', 'floor(cell / 24.0)'],
          ['vec2 at', 'floor(cell) - tile * 24.0 - 12.0'],
          ['float ring', 'max(abs(at.x), abs(at.y))'],
          ['float onRing', '(ring == 3.0 || ring == 6.0 || ring == 9.0) ? 1.0 : 0.0'],
          ['float right', '(noiseHash1(tile) < bridges && at.y == 0.0 && at.x > 9.5) ? 1.0 : 0.0'],
          ['float fromLeft', '(noiseHash1(tile - vec2(1.0, 0.0)) < bridges && at.y == 0.0 && at.x < -9.5) ? 1.0 : 0.0'],
          ['float wire', 'min(onRing + right + fromLeft, 1.0)'],
          ['float head', (onRingCheck('at.y == 1.0'))],
          ['float tail', (onRingCheck('at.y == 0.0'))],
          ['float state', 'head > 0.5 ? 1.0 : (tail > 0.5 ? 2.0 : (wire > 0.5 ? 3.0 : 0.0))'],
        ].map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
        result: 'vec3(state / 3.0)', expr: 'vec3(state / 3.0)',
        ...note([
          'Starter circuit: the board\'s first picture, as brightness: Grid Rules\' Image start turns brightness into a state (0 black … 3 white).',
          'Why an Expression Block: a layout is a handful of yes/no tests on the cell\'s position; as nodes it would sprawl.',
          'tile: which 24 × 24 tile this cell is in.',
          'at: where in its tile, 0 at the middle.',
          'ring: the square radius: cells at the same one form a square loop.',
          'onRing: 1 on three loops, 3, 6 and 9 cells out.',
          'right: a wire from the outer loop to the tile\'s right edge, on some tiles (Bridges).',
          'fromLeft: the other half of the bridge from the tile to the left.',
          'wire: copper wherever any of those is.',
          'head: one electron head per loop, on its right side.',
          'tail: its tail just below.',
          'state: 1 head, 2 tail, 3 copper, 0 empty.',
          'result: the state as grey, state / 3.',
        ]),
      }, {}),
      n('pass', 'circuit', -360, 200, { label: 'Starter circuit', scale: '0.125', filter: 'nearest', ...note('Pass: the starter circuit as a picture at the board\'s size (⅛), Nearest, so each pixel is one cell for the board to start from.') }, { color: ['starter', 'result'] }),
      grid('wire', 'Wireworld rules', {
        ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.wireworld), board: '0.125', edges: 'walls', start: 'image', rate: 0.5,
      }, [
        'Grid Rules, Patterns: Wireworld as three stencil rules on a ⅛-size board. 0 empty, 1 electron head, 2 tail, 3 copper.',
        'A head becomes a tail, a tail becomes copper; copper becomes a head when 1 or 2 of its 8 neighbours are heads (the third rule\'s count). Any other cell stays.',
        'Start: Image: the Starter circuit Pass, its brightness picked into states. Reset lays it down again. The pen (mouse button) lays copper; set Brush paints to 1 to send sparks.',
      ]),
      out(['wire', 'color'], 560),
    ],
    play: play([
      ctl('speed', 'wire::rate', 'Speed', 0.05, 1, 0.01),
      toggle('reset', 'wire::reset', 'Lay the circuit again'),
      ctl('paints', 'wire::brushState', 'Pen paints (1 spark, 3 copper, 0 erase)', 0, 3, 0.5),
      ctl('bridges', 'bridges::value', 'Bridges', 0, 1, 0.01),
      colourCtl('head', 'wire::color1', 'Electron heads'),
    ], `**What it shows.** Wireworld (Silverman, 1987) as three pattern rules, and a start drawn by nodes.\n\n${HOW}\n\n**Try.** Draw copper paths between loops; set the pen to 1 and click a wire to send an electron.`),
  };
  g.gridRulesWire.nodes[1].outputs = { value: { type: 'float', label: 'Value' } };
  const starter = g.gridRulesWire.nodes[2];
  starter.inputs = { cell: { type: 'vec2', label: 'cell', connection: { nodeId: 'pix', outputKey: 'coord' } }, bridges: { type: 'float', label: 'bridges', connection: { nodeId: 'bridges', outputKey: 'value' } } };
  starter.outputs = { result: { type: 'vec3', label: 'Result' } };
  const wireNode = g.gridRulesWire.nodes[4];
  wireNode.inputs = { ...wireNode.inputs, image: { ...wireNode.inputs.image, connection: { nodeId: 'circuit', outputKey: 'texture' } } };

  // 10 · Frost: a pattern rule with a count
  g.gridRulesCrystal = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesCrystal, counter: 10,
    nodes: [
      grid('frost', 'Frost rules', {
        ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.crystal), board: '0.25', start: 'centre', density: 0.01, rate: 1,
        oldColor: [0.12, 0.25, 0.7], ageRate: 0.004, ageFade: 1,
      }, [
        'Grid Rules, Patterns: one rule. This cell empty (the stencil\'s middle), any neighbours, and exactly one of the 8 round it frozen (the rule\'s count): it freezes. Frozen cells stay frozen (no rule changes them).',
        'It starts from a sprinkle of seeds in the middle (Centre seed, Density 0.01). Age fade turns old frost blue, so the colour shows when each arm grew.',
      ]),
      out(['frost', 'color']),
    ],
    play: play([
      toggle('reset', 'frost::reset', 'Start again'),
      ctl('density', 'frost::density', 'Seeds', 0, 0.1, 0.001),
      ctl('ageing', 'frost::ageRate', 'Colour by age', 0, 0.02, 0.0005),
      ctl('brush', 'frost::brushRadius', 'Brush size (cells)', 0.5, 10, 0.5),
    ], `**What it shows.** A Patterns rule: a 3×3 stencil plus a count.\n\n${HOW}\n\n**Try.** In the editor, change the count to 1 to 2 and watch the arms thicken, or add a second rule.`),
  };

  // 11 · Gas: block rules turned four ways
  g.gridRulesGas = {
    ...GRID_RULES_EXAMPLE_INDEX.gridRulesGas, counter: 10,
    nodes: [
      grid('gas', 'Gas rules', {
        ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.gas), board: '0.25', start: 'centre', density: 0.6, rate: 1,
      }, [
        'Grid Rules, Blocks: the HPP lattice gas (Toffoli and Margolus). In each 2×2 block every particle moves to the opposite corner, except two meeting head-on, which leave at right angles. Four rules, each turned four ways.',
        'A ball of gas starts in the middle and spreads; Afterglow leaves faint trails. The board wraps, and no particle is ever lost.',
      ]),
      out(['gas', 'color']),
    ],
    play: play([
      toggle('reset', 'gas::reset', 'Start again'),
      ctl('density', 'gas::density', 'Gas density', 0.05, 1, 0.01),
      ctl('afterglow', 'gas::afterglow', 'Trails', 0, 0.99, 0.01),
      ctl('brush', 'gas::brushRadius', 'Brush size (cells)', 0.5, 20, 0.5),
    ], `**What it shows.** A Blocks rule with turns: one before → after picture covers four directions.\n\n${HOW}\n\n**Try.** In the editor, switch off the collision rule (rule 2): the particles pass through each other and the diamond stays sharp.`),
  };
  return g;
}
