/**
 * gridRulesAsNodes.ts — "Open as nodes" on the Grid Rules node (docs/grid-rules.md): the same
 * simulation built from ordinary nodes, in the style of the Simulations: grids examples
 * (store/simGridExamples.ts), every node with a note saying what it does and why.
 *
 * The graph does what the node's compiled step does (gridRules/glsl.ts), cell for cell: a Pass
 * holds the board (R the state, G age / afterglow, B the step clock, A the rule's signature) and
 * reads its own Previous; Sample (texture) reads the cells round each one; Expression Blocks count
 * them and apply the rule; Compare, Mix and Round hold the board between steps, deal a new one and
 * paint the brush. The test (compiler/__tests__/gridRulesAsNodes.test.ts) steps both on the CPU
 * and expects the same boards.
 *
 * Seeding uses Noise Float's hash rather than the node's own, so a new board is a different (as
 * random) deal. Larger-than-Life radii above 2 aren't built: (2N + 1)² − 1 Sample nodes is too many
 * to read (gridAsNodesProblem says so). Patterns and Blocks are built by their own builders.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import {
  GRID_DEFAULTS, MOORE_OFFSETS, VON_NEUMANN_OFFSETS, gridShape, gridSignature, isDiscrete, maxCount, neighbourOffsets, ruleSummary, floatLiterals,
  type GridShape,
} from '../gridRules/spec';
import { gridLabel } from '../compiler/gridRulesExpand';
import { ANY, NOT_EMPTY, SAME, blockVariants, patternVariants, stencilOffset } from '../gridRules/stencils';
import { GR_HASH_GLSL } from '../gridRules/glsl';
import { GR_DICE_GLSL } from '../gridRules/dice';
import { estimateNodeHeight, groupNodesByRank } from './graphLayout';

export type GridOutKey = 'color' | 'state' | 'alive' | 'age' | 'value' | 'texture' | 'board';
type Wire = { nodeId: string; outputKey: string };

export interface GridAsNodes {
  nodes: GraphNode[];
  /** Where each of the node's outputs comes from in the new graph. */
  outputs: Partial<Record<GridOutKey, Wire>>;
  /** The new board Pass's id. */
  boardId: string;
}

/** Why this node can't be opened as nodes (null: it can). */
export function gridAsNodesProblem(src: GraphNode): string | null {
  const s = gridShape(src.params);
  if (isDiscrete(s.type) && (s.type === 'count' || s.type === 'stages') && s.neighbourhood === 'radius' && s.radius > 2) {
    return `Radius ${s.radius} counts ${maxCount('radius', s.radius, s.shape)} cells: as nodes that is one Sample (texture) card each. Open as nodes builds radius 1 and 2; set Radius to 2 to see one.`;
  }
  return null;
}

// ── A small builder: local keys for ids, notes, Expression Blocks ───────────────────────────────

type LWire = [key: string, output: string] | { ext: Wire };

class Builder {
  nodes: GraphNode[] = [];
  /** What feeds the Grid Rules node's Start image, if anything. */
  image: Wire | null = null;
  private ids = new Map<string, string>();
  private nextId: () => string;
  private at: { x: number; y: number };
  constructor(nextId: () => string, at: { x: number; y: number }) { this.nextId = nextId; this.at = at; }
  id(key: string): string {
    let v = this.ids.get(key);
    if (!v) { v = this.nextId(); this.ids.set(key, v); }
    return v;
  }
  private wire(w: LWire): Wire { return Array.isArray(w) ? { nodeId: this.id(w[0]), outputKey: w[1] } : w.ext; }
  /** A node of `type` at column `col`, row `row` (320 × 150 px apart). */
  add(type: string, key: string, col: number, row: number, params: Record<string, unknown>, note: string | string[], wires: Record<string, LWire> = {}): GraphNode {
    const nd = n(type, this.id(key), this.at.x + col * 320, this.at.y + row * 150, { ...params, __comment: Array.isArray(note) ? note.join('\n') : note });
    for (const [k, w] of Object.entries(wires)) {
      if (!nd.inputs[k]) throw new Error(`gridRulesAsNodes: ${type} has no input ${k}`);
      nd.inputs[k] = { ...nd.inputs[k], connection: this.wire(w) };
    }
    this.nodes.push(nd);
    return nd;
  }
  /** A node retyped (a Mix or Multiply on vec2 / vec3): its A, B and result take `t`. */
  retype(nd: GraphNode, t: 'vec2' | 'vec3', keys: string[]): GraphNode {
    nd.params.outputType = t;
    for (const k of keys) nd.inputs[k] = { ...nd.inputs[k], type: t };
    for (const k of Object.keys(nd.outputs)) nd.outputs[k] = { ...nd.outputs[k], type: t };
    return nd;
  }
  /** An Expression Block: named inputs, lines `type name = rhs`, a result; its note explains every named line. */
  expr(key: string, col: number, row: number, o: {
    label: string; outputType: 'float' | 'vec2' | 'vec3';
    inputs: Array<[name: string, type: 'float' | 'vec2' | 'vec3', from: LWire]>;
    lines?: Array<[lhs: string, rhs: string]>;
    result: string; note: string[]; functions?: string;
  }): GraphNode {
    const nd = n('exprNode', this.id(key), this.at.x + col * 320, this.at.y + row * 150, {
      label: o.label,
      inputs: o.inputs.map(([name, type]) => ({ name, type, slider: null })),
      outputType: o.outputType,
      lines: (o.lines ?? []).map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
      result: o.result, expr: o.result,
      ...(o.functions ? { glslFunctions: o.functions } : {}),
      __comment: o.note.join('\n'),
    });
    nd.inputs = Object.fromEntries(o.inputs.map(([name, type, from]) => [name, { type, label: name, connection: this.wire(from) }]));
    nd.outputs = { result: { type: o.outputType, label: 'Result' } };
    this.nodes.push(nd);
    return nd;
  }
  /** A Constants card of live float entries (outputs and Play targets by key). */
  card(key: string, col: number, row: number, label: string, items: Array<[k: string, label: string, value: number, max: number]>, note: string): GraphNode {
    const nd = n('constants', this.id(key), this.at.x + col * 320, this.at.y + row * 150, {
      label,
      items: items.map(([k, lbl, value, max]) => ({ key: k, label: lbl, type: 'float', value, slider: true, min: 0, max })),
      ...Object.fromEntries(items.map(([k, , value]) => [k, value])),
      __comment: note,
    });
    nd.outputs = Object.fromEntries(items.map(([k, lbl]) => [k, { type: 'float', label: lbl }]));
    this.nodes.push(nd);
    return nd;
  }
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const num = (P: Record<string, unknown>, k: string) => (typeof P[k] === 'number' ? P[k] as number : GRID_DEFAULTS[k] as number);
const vec = (P: Record<string, unknown>, k: string) => (Array.isArray(P[k]) ? P[k] as number[] : GRID_DEFAULTS[k] as number[]);

/** A name for a neighbour offset: compass points for 1 step, else x/y with m(inus)/p(lus). */
function nbName(dx: number, dy: number): string {
  const compass: Record<string, string> = { '0,1': 'n', '1,1': 'ne', '1,0': 'e', '1,-1': 'se', '0,-1': 's', '-1,-1': 'sw', '-1,0': 'w', '-1,1': 'nw' };
  const c = compass[`${dx},${dy}`];
  if (c) return c;
  const part = (v: number) => (v < 0 ? `m${-v}` : v > 0 ? `p${v}` : '0');
  return `x${part(dx)}y${part(dy)}`;
}
const WORD: Record<string, string> = { n: 'above', ne: 'above right', e: 'right', se: 'below right', s: 'below', sw: 'below left', w: 'left', nw: 'above left' };
const where = (dx: number, dy: number) => WORD[nbName(dx, dy)] ?? `${Math.abs(dx)} ${dx < 0 ? 'left' : 'right'}, ${Math.abs(dy)} ${dy < 0 ? 'down' : 'up'}`;

/** Build the graph. `read`: which of the node's outputs something reads (the rest aren't built). */
export function gridRulesAsNodes(src: GraphNode, nextId: () => string, at: { x: number; y: number }, read: ReadonlySet<GridOutKey> = new Set(['color'])): GridAsNodes {
  const P = { ...GRID_DEFAULTS, ...src.params };
  const s = gridShape(P);
  const sig = gridSignature(s);
  const b = new Builder(nextId, at);
  b.image = src.inputs.image?.connection ? { ...src.inputs.image.connection } : null;
  const cellPx = 1 / s.scale;
  const label = gridLabel(src);
  const summary = ruleSummary(P);
  const discrete = isDiscrete(s.type);

  // ── The cell, the clock, the start, the brush (as boardKit in the grid examples) ──
  b.add('fragCoord', 'cell', 0, 0, {}, 'Pixel Coordinates: inside the board\'s Pass this counts board cells (the Pass draws one pixel per cell). The brush and the walls are measured with it.');
  b.add('uv', 'uv', 0, 2, {}, 'UV: this cell\'s place in the picture. The seed noise is read at it, so every cell gets its own roll.');
  b.add('time', 'time', 0, 3, {}, 'Time: seconds since the start. Fed into the noise so each new board (and each brush stroke) is a new roll.');
  b.add('mouse', 'mouse', 0, 5, {}, 'Mouse: its Pixels output is where the pointer is, in picture pixels. Below it is scaled to board cells.');
  b.add('mouseButton', 'button', 0, 6, {}, 'Mouse button: 1 while the button is held over the picture (in the Studio, on the Play page and on exported pages).');

  b.add('sampleTexture', 'self', 1, 0, {}, [
    'Sample (texture): this cell one step ago (the board Pass\'s Previous). Red is its state, green its age (or afterglow), blue the step clock, Alpha the rule\'s signature.',
    'With the Pass on Nearest, the read is exactly this cell, never a blend of two.',
  ], { texture: ['board', 'previous'] });
  b.add('splitVec3', 'selfParts', 2, 0, {}, `Split Vec3: the cell a step ago in three numbers. X (red) is ${discrete ? 'its state (0, 1, 2…)' : 'u, the first value'}, Y (green) ${discrete ? 'its age or afterglow' : 'v, the second value'}, Z (blue) the step clock.`, { v: ['self', 'color'] });

  // The step clock (Speed) and a new board (first frame, another rule, or Reset).
  b.add('constant', 'speed', 1, 8, { value: num(P, 'rate'), label: 'Speed' }, 'Speed: steps per frame, 0 to 1. At 1 the rule runs every frame; at 0.25 every fourth. A constant so Play can drive it.');
  b.add('constant', 'signature', 1, 9, { value: sig, label: 'Rule signature' }, `Rule signature: the number this board keeps in Alpha (${sig}). A board with anything else there is new (an empty Pass reads 0 or 1), so it is dealt from the start.`);
  b.add('compare', 'ours', 2, 9, { operator: '≈', smoothing: 0.5 }, 'Compare (≈): 1 when the cell\'s Alpha is this rule\'s signature (a board already running), 0 on a new one. Whole numbers, so smoothing 0.5 is an exact match.', { a: ['self', 'alpha'], b: ['signature', 'value'] });
  b.add('constant', 'reset', 2, 10, { value: num(P, 'reset'), label: 'Reset' }, 'Reset: while 1, the board is dealt again every frame. Flip it on and off (a switch in Play) for a new board.');
  b.expr('restart', 3, 9, {
    label: 'Start over?', outputType: 'float',
    inputs: [['ours', 'float', ['ours', 'mask']], ['reset', 'float', ['reset', 'value']]],
    result: 'max(1.0 - ours, step(0.5, reset))',
    note: ['Start over?: 1 when the board is new (not this rule\'s signature) or Reset is on; then the cell takes its starting value instead of the rule\'s.', 'result: max(1 − ours, Reset rounded): either one starts over.'],
  });
  b.expr('clock', 3, 8, {
    label: 'Step clock', outputType: 'vec2',
    inputs: [['phase', 'float', ['selfParts', 'z']], ['speed', 'float', ['speed', 'value']], ['restart', 'float', ['restart', 'result']]],
    lines: s.steps > 1 ? [] : [['float clk', '(restart > 0.5 ? 0.0 : fract(phase)) + clamp(speed, 0.0, 1.0)']],
    result: s.steps > 1 ? 'vec2(1.0, 0.0)' : 'vec2(step(1.0, clk), clk - step(1.0, clk))',
    note: s.steps > 1
      ? ['Step clock: with Steps a frame above 1 the board Pass repeats (its Repeat), and every repeat is a step: X (step now) is always 1, Y (the phase) 0.', 'result: vec2(1, 0).']
      : ['Step clock: last frame\'s phase (blue) plus Speed. When it reaches 1 a step is due.', 'clk: the phase (0 on a new board) plus Speed.', 'result: X = 1 on a step frame, else 0; Y = what is left of the clock, stored in blue for the next frame.'],
  });
  b.add('splitVec2', 'tick', 4, 8, {}, 'Split Vec2: X is "step now" (1 or 0), Y the phase the board keeps in blue.', { v: ['clock', 'result'] });

  // The brush: a circle of cells round the pointer, while the button (or Paint) is down.
  const brushNodes = () => {
    const sc = b.add('multiply', 'brushAt', 1, 5, { b: s.scale }, `Multiply (vec2): the pointer's picture pixels times ${s.scale} (the board's size), so the pointer is in cells like Pixel Coordinates.`, { a: ['mouse', 'px'] });
    b.retype(sc, 'vec2', ['a', 'b']);
    b.add('circleSDF', 'brushDist', 2, 5, { radius: num(P, 'brushRadius') }, `Circle SDF: how far this cell is from the pointer, in cells, minus Radius (Brush size, ${num(P, 'brushRadius')} cells). Below 0 inside the brush.`, { position: ['cell', 'coord'], offset: ['brushAt', 'result'] });
    b.add('compare', 'inBrush', 3, 5, { operator: '<' }, 'Compare (< 0, B left empty): 1 inside the brush circle.', { a: ['brushDist', 'distance'] });
    b.add('constant', 'paint', 1, 7, { value: num(P, 'paint'), label: 'Paint' }, 'Paint: while 1 the brush paints without the button (map a key to it in Play).');
    b.add('max', 'pressing', 2, 6, {}, 'Max: the button is down, or Paint is on.', { a: ['button', 'down'], b: ['paint', 'value'] });
    b.add('multiply', 'brushing', 4, 5, {}, 'Multiply: inside the brush, and pressing.', { a: ['inBrush', 'mask'], b: ['pressing', 'result'] });
  };
  brushNodes();

  let state: Wire, age: Wire;
  if (discrete) ({ state, age } = discreteCore(b, s, P, cellPx));
  else ({ state, age } = smoothCore(b, s, P, cellPx));

  // ── Store and display ──
  b.add('makeVec3', 'pack', 9, 2, {}, `Make Vec3: what the board keeps: red ${discrete ? 'the state' : 'u'}, green ${discrete ? 'the age / afterglow' : 'v'}, blue the step clock's phase${s.type === 'blocks' ? ' and the blocks\' parity' : ''}.`, { r: { ext: state }, g: { ext: age }, b: s.type === 'blocks' ? ['blue', 'result'] : ['tick', 'y'] });
  b.add('pass', 'board', 10, 2, { label: `${label} cells (nodes)`, scale: String(s.scale), filter: 'nearest', wrap: s.wrap ? 'repeat' : 'clamp', format: 'half', repeat: s.steps }, [
    `Pass, the board: one pixel per cell at ${s.scale} of the picture's size. ${summary}.`,
    s.wrap ? 'Nearest keeps every read exactly one cell; Edges Repeat wraps the board round (a torus).' : 'Nearest keeps every read exactly one cell; Edges Clamp: a read past the edge sees the edge, which the walls keep empty.',
    s.steps > 1 ? `Repeat ${s.steps}: the rule runs ${s.steps} times a frame, each reading the step before through Previous.` : 'Its Previous output is this board a step ago: every read on the left comes from it.',
    'Alpha keeps the rule\'s signature, so a new board is recognised.',
  ], { color: ['pack', 'rgb'], alpha: ['signature', 'value'] });
  b.add('splitVec3', 'show', 11, 2, {}, `Split Vec3: the board now (the Pass's Color at this pixel). X is ${discrete ? 'the state' : 'u'}, Y ${discrete ? 'the age / afterglow' : 'v'}.`, { v: ['board', 'color'] });
  const outputs: GridAsNodes['outputs'] = { board: { nodeId: b.id('board'), outputKey: 'texture' } };
  outputs.color = discrete ? discreteLook(b, s, P) : smoothLook(b, s, P);
  if (read.has('state')) {
    if (discrete) b.add('round', 'stateOut', 12, 6, {}, 'Round: the state here as a whole number (the State output).', { input: ['show', 'x'] });
    if (!discrete && s.template === 'reaction') {
      b.expr('stateOut', 12, 6, { label: 'Chemical A', outputType: 'float', inputs: [['r', 'float', ['show', 'x']]], result: '1.0 - r', note: ['Chemical A: red keeps 1 − A, so A is 1 − red (the State output).', 'result: 1 − red.'] });
    }
    outputs.state = discrete || s.template === 'reaction' ? { nodeId: b.id('stateOut'), outputKey: discrete ? 'output' : 'result' } : { nodeId: b.id('show'), outputKey: 'x' };
  }
  if (read.has('age')) outputs.age = { nodeId: b.id('show'), outputKey: 'y' };
  if (read.has('alive') || read.has('value')) {
    b.expr('onOut', 12, 7, {
      label: 'On', outputType: 'float', inputs: [['st', 'float', ['show', 'x']]],
      result: discrete ? 'step(0.5, st) - step(1.5, st)' : 'clamp(st, 0.0, 1.0)',
      note: [discrete ? 'On: 1 where the cell\'s state is 1, else 0 (the On output).' : 'On: the value, 0 to 1 (the On output).', `result: ${discrete ? 'a step up at 0.5 minus one at 1.5' : 'u clamped to 0–1'}.`],
    });
    if (read.has('alive')) outputs.alive = { nodeId: b.id('onOut'), outputKey: 'result' };
    if (read.has('value')) outputs.value = { nodeId: b.id('onOut'), outputKey: 'result' };
  }
  if (read.has('texture')) {
    b.add('pass', 'picture', 13, 3, { label: `${label} picture (nodes)`, scale: String(s.scale), filter: 'nearest' }, 'Pass, the picture: the coloured board as a texture of its own (the Texture output), for Glow, Sample or a Texture tool.', { color: { ext: outputs.color } });
    outputs.texture = { nodeId: b.id('picture'), outputKey: 'texture' };
  }
  // Columns by data flow (the Studio's auto layout), the board's own Previous wires left out so the loop isn't one.
  const cut = b.nodes.map(nd => ({ ...nd, inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection?.outputKey === 'previous' ? { ...i, connection: undefined } : i])) }));
  // A tall column (the neighbour reads) wraps into another one.
  const pos = new Map<string, { x: number; y: number }>();
  let x = at.x;
  for (const { nodes: column } of groupNodesByRank(cut)) {
    let y = at.y;
    for (const nd of [...column].sort((p, q) => p.position.y - q.position.y || p.position.x - q.position.x)) {
      const h = estimateNodeHeight(nd);
      if (y > at.y && y + h > at.y + 1900) { x += 400; y = at.y; }
      pos.set(nd.id, { x, y });
      y += h + 28;
    }
    x += 400;
  }
  const nodes = b.nodes.map(nd => ({ ...nd, position: pos.get(nd.id) ?? nd.position }));
  return { nodes, outputs, boardId: b.id('board') };
}

// ── Count and Stages ────────────────────────────────────────────────────────────────────────────

const ON_FN = 'float grIsOn(float s) { return step(0.5, s) - step(1.5, s); }';
const HIT_FN = 'float grHit(float c, float k) { return 1.0 - step(0.5, abs(c - k)); }';

function discreteCore(b: Builder, s: GridShape, P: Record<string, unknown>, cellPx: number): { state: Wire; age: Wire } {
  const multi = s.type === 'patterns' || s.type === 'blocks';
  if (multi) {
    b.add('constant', 'states', 4, 13, { value: num(P, 'states'), label: 'States' }, 'States: how many states the rules use (0 is empty). A constant so Play can drive it.');
    if (s.type === 'patterns') patternsCore(b, s, cellPx); else blocksCore(b, s, P);
  } else countCore(b, s, P, cellPx);
  const stages = s.type !== 'count';
  b.card('look', 5, 13, 'Afterglow and age', [['afterglow', 'Afterglow', num(P, 'afterglow'), 0.99], ['ageRate', 'Ageing', num(P, 'ageRate'), 0.2]],
    'Constants: Afterglow (how much of a dead cell\'s glow is kept each step) and Ageing (how much a live cell ages each step). Live entries.');
  if (multi) {
    b.expr('ageNext', 6, 12, {
      label: 'Age and afterglow', outputType: 'float',
      inputs: [['s', 'float', ['selfParts', 'x']], ['next', 'float', ['rule', 'result']], ['g', 'float', ['selfParts', 'y']], ['afterglow', 'float', ['look', 'afterglow']], ['ageRate', 'float', ['look', 'ageRate']]],
      lines: [['float same', 'step(abs(next - floor(s + 0.5)), 0.5)']],
      result: 'same > 0.5 ? (next > 0.5 ? min(1.0, g + ageRate) : g * afterglow) : (next < 0.5 ? afterglow : 0.0)',
      note: [
        'Age and afterglow (green): a cell whose state stays ages a little each step (an empty one keeps fading); a cell that changes starts again, glowing (Afterglow) if it has just emptied.',
        'same: 1 if the rule leaves the state as it was.',
        'result: same → older (or fainter); changed → the afterglow when emptied, else 0.',
      ],
    });
  } else b.expr('ageNext', 6, 12, {
    label: 'Age and afterglow', outputType: 'float',
    inputs: [['s', 'float', ['selfParts', 'x']], ['next', 'float', ['rule', 'result']], ['g', 'float', ['selfParts', 'y']], ['afterglow', 'float', ['look', 'afterglow']], ['ageRate', 'float', ['look', 'ageRate']]],
    lines: [['float wasOn', 'step(0.5, s) - step(1.5, s)'], ['float isOn', 'step(0.5, next) - step(1.5, next)']],
    result: 'isOn > 0.5 ? (wasOn > 0.5 ? min(1.0, g + ageRate) : 0.0) : (next < 0.5 ? (s > 0.5 ? afterglow : g * afterglow) : 0.0)',
    note: [
      'Age and afterglow (green): a cell that stays on ages a little each step; a new one starts at 0. A cell that has just switched off starts to glow (Afterglow), and the glow fades by the same share each step.',
      'wasOn: 1 if the cell was on (state 1).',
      'isOn: 1 if the rule turns it on.',
      'result: on → its age climbs (or 0 when new); off → the afterglow, or the fading glow; dying stages → 0.',
    ],
  });
  return discreteTail(b, s, P, stages);
}

function countCore(b: Builder, s: GridShape, P: Record<string, unknown>, cellPx: number): void {
  const offsets = s.neighbourhood === 'moore' ? MOORE_OFFSETS : s.neighbourhood === 'vonNeumann' ? VON_NEUMANN_OFFSETS : neighbourOffsets('radius', s.radius, s.shape);
  // The neighbours: one Sample (texture) each, one cell away (Offset is in picture pixels).
  offsets.forEach(([dx, dy], i) => {
    const nm = nbName(dx, dy);
    b.add('sampleTexture', `nb_${nm}`, 1 + Math.floor(i / 12) * 0.5, 11 + (i % 12), { offsetX: dx * cellPx, offsetY: dy * cellPx },
      `Sample (texture): the cell ${where(dx, dy)}, a step ago (the board's Previous). Offset ${dx * cellPx}, ${dy * cellPx} picture pixels is ${Math.hypot(dx, dy) > 1.01 ? 'that many cells' : 'one cell'} at this board's size. Red is its state.`,
      { texture: ['board', 'previous'] });
  });
  const names = offsets.map(([dx, dy]) => nbName(dx, dy));
  const max = offsets.length;
  b.expr('count', 3, 11, {
    label: 'Count the neighbours', outputType: 'float',
    inputs: names.map(nm => [nm, 'vec3', [`nb_${nm}`, 'color']] as [string, 'vec3', LWire]),
    result: names.map(nm => `grIsOn(${nm}.r)`).join(' + '),
    functions: ON_FN,
    note: [
      `Count the neighbours: how many of the ${max} cells round this one are on (state 1): 0 to ${max}. ${s.neighbourhood === 'radius' ? `Larger than Life, radius ${s.radius}${s.shape === 'circle' ? ', a round neighbourhood' : ''}.` : s.neighbourhood === 'vonNeumann' ? 'von Neumann: the 4 cells beside it.' : 'Moore: the 8 cells round it.'}`,
      'Why an Expression Block: one sum of the reads is clearer as one line than as a chain of Add cards. grIsOn(s) is 1 for state 1 only (step(0.5, s) − step(1.5, s)), so dying cells don\'t count.',
      `result: grIsOn(n.r) + … for every neighbour.`,
    ],
  });
  // The rule's numbers.
  if (s.neighbourhood === 'radius') {
    b.card('ranges', 3, 13, 'Born and survive', [
      ['bornLo', 'Born from', num(P, 'bornLo'), 224], ['bornHi', 'Born to', num(P, 'bornHi'), 224],
      ['surviveLo', 'Survive from', num(P, 'surviveLo'), 224], ['surviveHi', 'Survive to', num(P, 'surviveHi'), 224],
    ], 'Constants: Larger than Life\'s ranges. An empty cell is born with Born from…to live neighbours; a live cell survives with Survive from…to. Live entries, so Play can change them.');
    b.expr('born', 4, 11, {
      label: 'Born?', outputType: 'float', inputs: [['count', 'float', ['count', 'result']], ['lo', 'float', ['ranges', 'bornLo']], ['hi', 'float', ['ranges', 'bornHi']]],
      result: 'step(lo - 0.5, count) * step(count, hi + 0.5)',
      note: ['Born?: 1 when the count is from Born from to Born to.', 'result: two steps, one up at lo, one down after hi (counts are whole numbers, so ±0.5 is exact).'],
    });
    b.expr('surv', 4, 12, {
      label: 'Survives?', outputType: 'float', inputs: [['count', 'float', ['count', 'result']], ['lo', 'float', ['ranges', 'surviveLo']], ['hi', 'float', ['ranges', 'surviveHi']]],
      result: 'step(lo - 0.5, count) * step(count, hi + 0.5)',
      note: ['Survives?: 1 when the count is from Survive from to Survive to.', 'result: two steps, as Born?.'],
    });
  } else {
    const switches = (mask: number) => Array.from({ length: max + 1 }, (_, k) => [`n${k}`, `${k}`, (Math.round(mask) >> k) & 1, 1] as [string, string, number, number]);
    b.card('bornOn', 3, 13, 'Born on', switches(num(P, 'bornMask')), `Constants: the Born switches. An empty cell with k live neighbours is born when switch k is 1. ${ruleSummary(P).split(' ')[1]}. Live entries, so Play can flip them.`);
    b.card('surviveOn', 3, 15, 'Survive on', switches(num(P, 'surviveMask')), 'Constants: the Survive switches. A live cell with k live neighbours stays on when switch k is 1. Live entries.');
    const lookup = (key: string, card: string, what: string) => b.expr(key, 4, key === 'born' ? 11 : 12, {
      label: what, outputType: 'float',
      inputs: [['count', 'float', ['count', 'result']], ...Array.from({ length: max + 1 }, (_, k) => [`n${k}`, 'float', [card, `n${k}`]] as [string, 'float', LWire])],
      result: Array.from({ length: max + 1 }, (_, k) => `n${k} * grHit(count, ${f(k)})`).join(' + '),
      functions: HIT_FN,
      note: [
        `${what}: looks the count up in the switches: 1 if the switch for this count is on, else 0. n0 to n${max} are the switches.`,
        'Why an Expression Block: a Compare and an Add for every switch would say the same thing at much greater length. grHit(c, k) is 1 exactly when c = k.',
        `result: n0 × grHit(count, 0) + … + n${max} × grHit(count, ${max}): at most one term is on.`,
      ],
    });
    lookup('born', 'bornOn', 'Born?');
    lookup('surv', 'surviveOn', 'Survives?');
  }
  const stages = s.type === 'stages';
  if (stages) b.add('constant', 'states', 4, 13, { value: num(P, 'states'), label: 'States' }, 'States: how many states, counting empty (0) and on (1); the rest are dying stages. A constant so Play can drive it.');
  b.expr('rule', 5, 11, {
    label: 'The rule', outputType: 'float',
    inputs: [['s', 'float', ['selfParts', 'x']], ['born', 'float', ['born', 'result']], ['surv', 'float', ['surv', 'result']], ...(stages ? [['states', 'float', ['states', 'value']] as [string, 'float', LWire]] : [])],
    lines: stages ? [['float N', 'max(floor(states + 0.5), 2.0)']] : [],
    result: stages
      ? 's < 0.5 ? born : (s < 1.5 ? (surv > 0.5 ? 1.0 : (N > 2.5 ? 2.0 : 0.0)) : (s + 1.0 > N - 0.5 ? 0.0 : s + 1.0))'
      : '(s > 0.5 && s < 1.5) ? surv : born',
    note: stages ? [
      'The rule (Generations): an empty cell is born (1) as Born? says; an on cell stays on if Survives?, else starts dying (2); a dying cell goes one stage on, and after the last it is empty.',
      'N: the number of states (at least 2).',
      'result: by the cell\'s state s: empty → Born?, on → 1 or 2, dying → s + 1, or 0 after the last.',
    ] : [
      'The rule: a live cell (state 1) stays on if Survives? says so; any other cell is born if Born? says so.',
      'result: s is 1 ? Survives? : Born?.',
    ],
  });
}

function discreteTail(b: Builder, s: GridShape, P: Record<string, unknown>, stages: boolean): { state: Wire; age: Wire } {
  // The start: noise, empty, a centre seed or a picture.
  const seed = startDiscrete(b, s, P, stages);
  // The brush's state, and whether it paints this cell this frame (Brush fill).
  b.add('noiseFloat', 'brushRoll', 3, 6, { mode: 'hash', scale: 51.7, speed: 3 }, 'Noise Float, Hash: another per-cell roll, new every moment, for Brush fill.', { uv: ['uv', 'uv'], time: ['time', 'time'] });
  b.add('constant', 'fill', 3, 7, { value: num(P, 'brushFill'), label: 'Brush fill' }, 'Brush fill: the share of cells under the brush it paints each frame (Life likes a sprinkle, not a solid block).');
  b.add('compare', 'fillOn', 4, 6, { operator: '<' }, 'Compare (<): 1 for the share of cells Brush fill picks.', { a: ['brushRoll', 'value'], b: ['fill', 'value'] });
  b.add('multiply', 'paintHere', 5, 5, {}, 'Multiply: the brush paints this cell now (inside, pressing, and picked).', { a: ['brushing', 'result'], b: ['fillOn', 'mask'] });
  b.add('constant', 'brushState', 4, 7, { value: num(P, 'brushState'), label: 'Brush paints' }, 'Brush paints: the state the brush paints (0 erases).');
  b.expr('brushPick', 5, 7, {
    label: 'Brush state', outputType: 'float',
    inputs: [['paints', 'float', ['brushState', 'value']], ...(stages ? [['states', 'float', ['states', 'value']] as [string, 'float', LWire]] : [])],
    result: `clamp(floor(paints + 0.5), 0.0, ${stages ? 'max(floor(states + 0.5), 2.0) - 1.0' : '1.0'})`,
    note: ['Brush state: Brush paints as a whole number the rule knows (0 to the last state).', 'result: rounded, then clamped.'],
  });
  // Hold, start, paint.
  b.add('mix', 'stepped', 6, 9, {}, 'Mix: on a step frame (Blend = step now) the rule\'s answer, otherwise the cell as it was. This is how Speed slows the board down.', { a: ['selfParts', 'x'], b: ['rule', 'result'], t: ['tick', 'x'] });
  b.add('mix', 'seeded', 7, 9, {}, 'Mix: the starting value instead when starting over.', { a: ['stepped', 'result'], b: { ext: seed }, t: ['restart', 'result'] });
  b.add('mix', 'painted', 8, 9, {}, 'Mix: the brush\'s state where the brush paints.', { a: ['seeded', 'result'], b: ['brushPick', 'result'], t: ['paintHere', 'result'] });
  b.add('round', 'stateRound', 8, 10, {}, 'Round: exactly a whole number, so a state never drifts between two.', { input: ['painted', 'result'] });
  b.expr('ageHeld', 7, 12, {
    label: 'Age: hold, start, paint', outputType: 'float',
    inputs: [['g', 'float', ['selfParts', 'y']], ['ng', 'float', ['ageNext', 'result']], ['tick', 'float', ['tick', 'x']], ['restart', 'float', ['restart', 'result']], ['paint', 'float', ['paintHere', 'result']]],
    result: '(restart > 0.5 || paint > 0.5) ? 0.0 : (tick > 0.5 ? ng : g)',
    note: ['Age: hold, start, paint: green follows the state: kept between steps, 0 on a new board and where the brush paints.', 'result: 0 when starting over or painted, else the new age on a step frame, else the old one.'],
  });
  let state: Wire = { nodeId: b.id('stateRound'), outputKey: 'output' };
  let age: Wire = { nodeId: b.id('ageHeld'), outputKey: 'result' };
  if (s.type === 'blocks') {
    b.expr('inside', 8, 11, {
      label: 'In a block', outputType: 'float', inputs: [['cell', 'vec2', ['cell', 'coord']]],
      lines: [['vec2 W', 'floor(u_resolution * 0.5) * 2.0']],
      result: 'step(floor(cell.x), W.x - 0.5) * step(floor(cell.y), W.y - 0.5)',
      note: ['In a block: 0 for a cell in an odd last row or column, which has no block; it is kept empty.', 'W: the board\'s even part.', 'result: 1 inside the even part.'],
    });
    b.add('multiply', 'stateIn', 9, 10, {}, 'Multiply: the state, emptied outside the blocks.', { a: { ext: state }, b: ['inside', 'result'] });
    b.add('multiply', 'ageIn', 9, 11, {}, 'Multiply: the age, emptied outside the blocks.', { a: { ext: age }, b: ['inside', 'result'] });
    state = { nodeId: b.id('stateIn'), outputKey: 'result' };
    age = { nodeId: b.id('ageIn'), outputKey: 'result' };
  }
  if (!s.wrap && s.type !== 'blocks') {
    b.expr('inside', 8, 11, {
      label: 'Inside the walls', outputType: 'float', inputs: [['cell', 'vec2', ['cell', 'coord']]],
      lines: [['vec2 c', 'floor(cell)']],
      result: 'step(0.5, c.x) * step(0.5, c.y) * step(c.x, u_resolution.x - 1.5) * step(c.y, u_resolution.y - 1.5)',
      note: ['Inside the walls: 0 on the outer ring of cells, 1 inside. Walls: the ring stays empty, so a read past the edge (which sees the edge) reads an empty cell.', 'c: this cell, counted from 0.', 'result: 1 unless the cell is in the first or last row or column (u_resolution is the board\'s size in cells).'],
    });
    b.add('multiply', 'stateIn', 9, 10, {}, 'Multiply: the state, emptied on the walls.', { a: { ext: state }, b: ['inside', 'result'] });
    b.add('multiply', 'ageIn', 9, 11, {}, 'Multiply: the age, emptied on the walls.', { a: { ext: age }, b: ['inside', 'result'] });
    state = { nodeId: b.id('stateIn'), outputKey: 'result' };
    age = { nodeId: b.id('ageIn'), outputKey: 'result' };
  }
  return { state, age };
}

function startDiscrete(b: Builder, s: GridShape, P: Record<string, unknown>, stages: boolean): Wire {
  if (s.start === 'empty') {
    b.add('constant', 'seedValue', 5, 3, { value: 0, label: 'Start empty' }, 'Start: empty. A new board starts with every cell at 0: paint on it.');
    return { nodeId: b.id('seedValue'), outputKey: 'value' };
  }
  b.add('noiseFloat', 'seedRoll', 3, 3, { mode: 'hash', scale: 37.3, speed: 1 }, 'Noise Float, Hash: a different random number (0 to 1) for every cell, and a new set every moment because Time is wired in.', { uv: ['uv', 'uv'], time: ['time', 'time'] });
  b.add('constant', 'density', 3, 4, { value: num(P, 'density'), label: 'Density' }, 'Density: the share of cells that start on (0 to 1). A constant so Play can drive it.');
  b.add('compare', 'seedOn', 4, 3, { operator: '<' }, 'Compare (<): 1 where the roll is under Density: that share of cells starts on (a random sprinkle).', { a: ['seedRoll', 'value'], b: ['density', 'value'] });
  if (s.start === 'centre') {
    b.add('circleSDF', 'centre', 4, 4, { radius: 0.3 }, 'Circle SDF: how far this cell is from the middle of the picture, minus 0.3.', { position: ['uv', 'uv'] });
    b.add('compare', 'inCentre', 5, 4, { operator: '<' }, 'Compare (< 0): 1 in the middle disc, where the seed is sprinkled.', { a: ['centre', 'distance'] });
    b.add('multiply', 'seedValue', 5, 3, {}, 'Multiply: the start: the sprinkle, only in the middle disc.', { a: ['seedOn', 'mask'], b: ['inCentre', 'mask'] });
    return { nodeId: b.id('seedValue'), outputKey: 'result' };
  }
  if (s.start === 'image') {
    b.add('sampleTexture', 'startPic', 4, 4, {}, 'Sample (texture): the start picture (what was wired into the Grid Rules node\'s Start image) at this cell.', b.image ? { texture: { ext: b.image } } : {});
    b.add('luminance', 'startLum', 5, 4, {}, 'Luminance: the picture\'s brightness here.', { color: ['startPic', 'color'] });
    b.expr('seedValue', 5, 3, {
      label: 'Start state', outputType: 'float',
      inputs: [['lum', 'float', ['startLum', 'result']], ...(stages ? [['states', 'float', ['states', 'value']] as [string, 'float', LWire]] : [])],
      lines: [['float top', stages ? 'max(floor(states + 0.5), 2.0) - 1.0' : '1.0']],
      result: 'floor(clamp(lum, 0.0, 1.0) * top + 0.5)',
      note: ['Start state: the picture\'s brightness picks the state, 0 for black up to the last state for white (two states: bright parts start on).', 'top: the last state.', 'result: the brightness scaled to 0…top, rounded.'],
    });
    return { nodeId: b.id('seedValue'), outputKey: 'result' };
  }
  return { nodeId: b.id('seedOn'), outputKey: 'mask' };
}

function discreteLook(b: Builder, s: GridShape, P: Record<string, unknown>): Wire {
  const stages = s.type === 'stages';
  b.add('colorPicker', 'c0', 11, 4, { color: vec(P, 'color0') }, 'Color: empty cells (state 0), before any afterglow.');
  b.add('colorPicker', 'c1', 11, 5, { color: vec(P, 'color1') }, 'Color: live cells (state 1).');
  b.add('colorPicker', 'glow', 11, 6, { color: vec(P, 'glowColor') }, 'Color: the afterglow of a cell that has just switched off.');
  b.add('colorPicker', 'old', 11, 7, { color: vec(P, 'oldColor') }, 'Color: what live cells age towards (Age fade).');
  b.add('constant', 'ageFade', 11, 8, { value: num(P, 'ageFade'), label: 'Age fade' }, 'Age fade: how far a live cell\'s colour moves towards Old cells as it ages (0 to 1).');
  const multi = s.type === 'patterns' || s.type === 'blocks';
  const extra = multi ? Math.max(0, Math.min(8, Math.round(num(P, 'states'))) - 2) : 0;
  for (let k = 2; k < 2 + extra; k++) b.add('colorPicker', `c${k}`, 11, 7 + k, { color: vec(P, `color${k}`) }, `Color: cells in state ${k}${k === 7 ? ' (and any above)' : ''}.`);
  if (multi) {
    const ladder = Array.from({ length: extra }, (_, i) => i + 2).reduceRight((acc, k) => (k === 1 + extra ? `c${k}` : `(s < ${f(k + 0.5)} ? c${k} : ${acc})`), '');
    b.expr('cellsLook', 12, 4, {
      label: 'Colour by state', outputType: 'vec3',
      inputs: [
        ['st', 'float', ['show', 'x']], ['g', 'float', ['show', 'y']], ['empty', 'vec3', ['c0', 'rgb']], ['on', 'vec3', ['c1', 'rgb']],
        ['glow', 'vec3', ['glow', 'rgb']], ['old', 'vec3', ['old', 'rgb']], ['fade', 'float', ['ageFade', 'value']],
        ...Array.from({ length: extra }, (_, i) => [`c${i + 2}`, 'vec3', [`c${i + 2}`, 'rgb']] as [string, 'vec3', LWire]),
      ],
      lines: [['float s', 'floor(st + 0.5)'], ['float age', 'clamp(g, 0.0, 1.0)'], ['vec3 dead', 'mix(empty, glow, age)'], ['vec3 live', 'mix(on, old, clamp(fade * age, 0.0, 1.0))']],
      result: `s < 0.5 ? dead : (s < 1.5 ? live${extra ? ` : ${ladder})` : ' : live)'}`,
      note: [
        'Colour by state: a colour for each state of the cell under this pixel.',
        's: the state, as a whole number.', 'age: green, the age of the cell or the glow of an emptied one.',
        'dead: empty cells, tinted by their afterglow.', 'live: state 1, moving towards Old cells as it ages (Age fade).',
        'result: state 0 → dead, 1 → live, 2 and up → their own colours.',
      ],
    });
    return { nodeId: b.id('cellsLook'), outputKey: 'result' };
  }
  if (stages) {
    b.add('colorPicker', 'c2', 11, 9, { color: vec(P, 'color2') }, 'Color: the first dying stage.');
    b.add('colorPicker', 'c3', 11, 10, { color: vec(P, 'color3') }, 'Color: the last dying stage (the stages between blend from the first).');
  }
  b.expr('cellsLook', 12, 4, {
    label: 'Colour by state', outputType: 'vec3',
    inputs: [
      ['st', 'float', ['show', 'x']], ['g', 'float', ['show', 'y']], ['empty', 'vec3', ['c0', 'rgb']], ['on', 'vec3', ['c1', 'rgb']],
      ['glow', 'vec3', ['glow', 'rgb']], ['old', 'vec3', ['old', 'rgb']], ['fade', 'float', ['ageFade', 'value']],
      ...(stages ? [['dying', 'vec3', ['c2', 'rgb']], ['last', 'vec3', ['c3', 'rgb']], ['states', 'float', ['states', 'value']]] as Array<[string, 'vec3' | 'float', LWire]> : []),
    ],
    lines: [
      ['float s', 'floor(st + 0.5)'],
      ['float age', 'clamp(g, 0.0, 1.0)'],
      ['vec3 dead', 'mix(empty, glow, age)'],
      ['vec3 live', 'mix(on, old, clamp(fade * age, 0.0, 1.0))'],
      ...(stages ? [['vec3 fading', 'mix(dying, last, clamp((s - 2.0) / max(max(floor(states + 0.5), 2.0) - 3.0, 1.0), 0.0, 1.0))'] as [string, string]] : []),
    ],
    result: stages ? 's < 0.5 ? dead : (s < 1.5 ? live : fading)' : 's > 0.5 ? live : dead',
    note: [
      'Colour by state: the colour of the cell under this pixel (the board is read with Nearest, so cells stay square).',
      's: the state, as a whole number.',
      'age: green, the age of a live cell or the glow of a dead one.',
      'dead: empty cells, tinted by their afterglow.',
      'live: live cells, moving towards Old cells as they age (Age fade).',
      ...(stages ? ['fading: the dying stages, blended from the first dying colour to the last.'] : []),
      `result: ${stages ? 'empty → dead, on → live, dying → fading' : 'live where the cell is on, else dead'}.`,
    ],
  });
  return { nodeId: b.id('cellsLook'), outputKey: 'result' };
}

// ── Smooth ──────────────────────────────────────────────────────────────────────────────────────

function smoothCore(b: Builder, s: GridShape, P: Record<string, unknown>, cellPx: number): { state: Wire; age: Wire } {
  const names = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  MOORE_OFFSETS.forEach(([dx, dy], i) => b.add('sampleTexture', `nb_${names[i]}`, 1, 11 + i, { offsetX: dx * cellPx, offsetY: dy * cellPx },
    `Sample (texture): the cell ${where(dx, dy)}, a step ago (the board's Previous). Red is its u, green its v.`, { texture: ['board', 'previous'] }));
  const reads = names.map(nm => [`r${nm}`, 'vec3', [`nb_${nm}`, 'color']] as [string, 'vec3', LWire]);
  const common: Array<[string, string]> = [
    ['float edgeU', 'rn.r + re.r + rs.r + rw.r'], ['float edgeV', 'rn.g + re.g + rs.g + rw.g'],
    ['float cornU', 'rne.r + rse.r + rsw.r + rnw.r'], ['float cornV', 'rne.g + rse.g + rsw.g + rnw.g'],
    ['float lapU', '0.2 * edgeU + 0.05 * cornU - u'], ['float lapV', '0.2 * edgeV + 0.05 * cornV - v'],
  ];
  const commonNotes = [
    'edgeU: u of the four cells beside (above, right, below, left), added up.', 'edgeV: the same for v.',
    'cornU: u of the four corner cells.', 'cornV: the same for v.',
    'lapU: the Laplacian of u, 0.2 per side cell and 0.05 per corner, minus the cell: positive in a dip, negative on a peak.', 'lapV: the same for v.',
  ];
  let card: Array<[string, string, number, number]>;
  let lines: Array<[string, string]>, result: string, notes: string[];
  if (s.template === 'diffusion') {
    card = [['spread', 'Spread', num(P, 'spread'), 1], ['decay', 'Cooling', num(P, 'decay'), 0.1]];
    lines = common;
    result = 'vec2(mix(u, edgeU * 0.25, spread) * (1.0 - decay), v)';
    notes = ['Diffusion: every cell moves towards the average of its four side cells by Spread, and loses Cooling of what it has.', ...commonNotes, 'result: the new u (v is kept).'];
  } else if (s.template === 'waves') {
    card = [['waveSpeed', 'Wave speed', num(P, 'waveSpeed'), 1], ['damping', 'Damping', num(P, 'damping'), 1]];
    lines = common;
    result = 'vec2((2.0 * u - v + waveSpeed * 0.5 * (edgeU - 4.0 * u)) * damping, u)';
    notes = ['Waves (Hugo Elias\'s two buffers): u is the height now, v the height a step ago. The new height carries on the way the surface was moving (2u − v), pulled towards its neighbours.', ...commonNotes, 'result: the new height, damped; and the old height becomes this one.'];
  } else if (s.template === 'reaction') {
    card = [['feed', 'Feed', num(P, 'feed'), 0.1], ['kill', 'Kill', num(P, 'kill'), 0.1], ['diffA', 'Spread A', num(P, 'diffA'), 1], ['diffB', 'Spread B', num(P, 'diffB'), 1]];
    lines = [...common, ['float A', '1.0 - u'], ['float abb', 'A * v * v']];
    result = 'vec2(1.0 - clamp(A - diffA * lapU - abb + feed * (1.0 - A), 0.0, 1.0), clamp(v + diffB * lapV + abb - (kill + feed) * v, 0.0, 1.0))';
    notes = ['Reaction–diffusion (Gray–Scott, as Karl Sims writes it): chemical A and chemical B (v). B eats A to make more B; A is fed in, B is taken away, and both spread. Red (u) keeps 1 − A: A sits near 1, where a half-float texture is coarse, and 1 − A near 0 keeps its precision.', ...commonNotes, 'A: chemical A, 1 − u. (Its Laplacian is −lapU.)', 'abb: the reaction, A × B × B.', 'result: 1 − (A a step on) and B a step on, each kept between 0 and 1.'];
  } else {
    card = [['a', 'Knob A', num(P, 'knobA'), 1], ['b', 'Knob B', num(P, 'knobB'), 1], ['c', 'Knob C', num(P, 'knobC'), 1], ['d', 'Knob D', num(P, 'knobD'), 1]];
    lines = [
      ...common,
      ['float avg_u', '(edgeU + cornU) * 0.125'], ['float avg_v', '(edgeV + cornV) * 0.125'], ['float lap_u', 'lapU'], ['float lap_v', 'lapV'],
      ['float n', 'rn.r'], ['float s', 'rs.r'], ['float e', 're.r'], ['float w', 'rw.r'],
      ['float x', '(floor(cell.x) + 0.5) / u_resolution.x'], ['float y', '(floor(cell.y) + 0.5) / u_resolution.y'],
    ];
    result = `vec2(clamp(${floatLiterals(s.customU.trim() || 'u')}, -1000.0, 1000.0), clamp(${floatLiterals(s.customV.trim() || 'v')}, -1000.0, 1000.0))`;
    notes = ['Your update: the two lines written in the Grid Rules editor, with the same names.', ...commonNotes,
      'avg_u: the average u of the 8 cells round.', 'avg_v: the same for v.', 'lap_u: the Laplacian, by its editor name.', 'lap_v: the same for v.',
      'n: u above.', 's: u below.', 'e: u to the right.', 'w: u to the left.', 'x: across the board, 0 to 1.', 'y: up the board, 0 to 1.',
      'result: the new u and v, kept within ±1000.'];
  }
  b.card('numbers', 2, 13, 'Rule numbers', card, 'Constants: the update\'s numbers. Live entries, so Play can drive them.');
  b.expr('update', 3, 11, {
    label: 'Update', outputType: 'vec2',
    inputs: [
      ['u', 'float', ['selfParts', 'x']], ['v', 'float', ['selfParts', 'y']], ...reads,
      ...card.map(([k]) => [k, 'float', ['numbers', k]] as [string, 'float', LWire]),
      ...(s.template === 'custom' ? [['cell', 'vec2', ['cell', 'coord']] as [string, 'vec2', LWire], ['rnd', 'float', ['seedRoll', 'value']] as [string, 'float', LWire]] : []),
    ],
    lines, result, note: notes,
  });
  // The start.
  b.add('noiseFloat', 'seedRoll', 3, 3, { mode: 'hash', scale: 37.3, speed: 1 }, 'Noise Float, Hash: a random number (0 to 1) for every cell, new every moment.', { uv: ['uv', 'uv'], time: ['time', 'time'] });
  b.add('constant', 'density', 3, 4, { value: num(P, 'density'), label: 'Density' }, 'Density: how much of the board starts set.');
  if (s.template === 'reaction') b.add('constant', 'seed', 2, 4, { value: num(P, 'seed'), label: 'Seed' }, 'Seed: which blobs a new board starts with (a different seed deals different ones).');
  b.add('circleSDF', 'centre', 4, 4, { radius: 0.16 }, 'Circle SDF: how far this cell is from the middle, minus 0.16 (the Centre seed).', { position: ['uv', 'uv'] });
  const startWord: Record<string, string> = {
    noise: s.template === 'reaction' ? 'blobs of B: 6 × 6 blocks of cells, each set with chance Density × 0.04 (single cells of B would only fade)' : s.template === 'waves' ? 'a few raised cells (Density × 0.02)' : 'cells set where the roll is under Density',
    empty: 'nothing', centre: 'a disc in the middle', image: 'the picture\'s brightness',
  };
  const startExpr = s.start === 'empty' ? '0.0' : s.start === 'centre' ? '(centre < 0.0 ? 1.0 : 0.0)' : s.start === 'image' ? 'pic'
    : s.template === 'reaction' ? '(grHash(vec3(floor(cell / 6.0), mod(floor(t * 60.0), 997.0) + seed * 1013.0 + 3.0)) < density * 0.04 ? 1.0 : 0.0)' : s.template === 'waves' ? '(roll < density * 0.02 ? 1.0 : 0.0)' : '(roll < density ? 1.0 : 0.0)';
  if (s.start === 'image') {
    b.add('sampleTexture', 'startPic', 4, 5, {}, 'Sample (texture): the start picture (what was wired into the Grid Rules node\'s Start image).', b.image ? { texture: { ext: b.image } } : {});
    b.add('luminance', 'startLum', 5, 5, {}, 'Luminance: the picture\'s brightness here.', { color: ['startPic', 'color'] });
  }
  b.expr('startVals', 5, 3, {
    label: 'Start values', outputType: 'vec2',
    inputs: [
      ['roll', 'float', ['seedRoll', 'value']], ['density', 'float', ['density', 'value']], ['centre', 'float', ['centre', 'distance']],
      ...(s.start === 'image' ? [['pic', 'float', ['startLum', 'result']] as [string, 'float', LWire]] : []),
      ...(s.template === 'reaction' ? [['cell', 'vec2', ['cell', 'coord']], ['seed', 'float', ['seed', 'value']]] as Array<[string, 'vec2' | 'float', LWire]> : []),
    ],
    lines: [['float a', startExpr]],
    ...(s.template === 'reaction' ? { functions: GR_HASH_GLSL } : {}),
    result: s.template === 'reaction' ? 'vec2(0.0, a)' : s.template === 'waves' ? 'vec2(a, a)' : 'vec2(a, 0.0)',
    note: [`Start values: a new board starts as ${startWord[s.start]}.`, 'a: the starting amount at this cell.', s.template === 'reaction' ? 'result: A = 1 everywhere (red keeps 1 − A, so 0), B where a is.' : s.template === 'waves' ? 'result: the height a, and the same as the height a step ago (so it starts still).' : 'result: u = a, v = 0.'],
  });
  b.add('constant', 'brushState', 4, 7, { value: num(P, 'brushState'), label: 'Brush value' }, `Brush value: what the brush sets ${s.template === 'reaction' ? 'B' : 'u'} to under it.`);
  b.expr('held', 6, 9, {
    label: 'Hold, start and paint', outputType: 'vec2',
    inputs: [
      ['u', 'float', ['selfParts', 'x']], ['v', 'float', ['selfParts', 'y']], ['next', 'vec2', ['update', 'result']], ['tick', 'float', ['tick', 'x']],
      ['restart', 'float', ['restart', 'result']], ['start', 'vec2', ['startVals', 'result']], ['brush', 'float', ['brushing', 'result']], ['value', 'float', ['brushState', 'value']],
    ],
    lines: [
      ['vec2 now', 'tick > 0.5 ? next : vec2(u, v)'],
      ['vec2 begun', 'restart > 0.5 ? start : now'],
    ],
    result: s.template === 'reaction' ? 'brush > 0.5 ? vec2(begun.x, clamp(value, 0.0, 1.0)) : begun' : 'brush > 0.5 ? vec2(value, begun.y) : begun',
    note: [
      'Hold, start and paint: the update on step frames, the start on a new board, the brush on top.',
      'now: the update\'s answer on a step frame (Speed), else the cell as it was.',
      'begun: the start values instead when starting over.',
      `result: where the brush is down, ${s.template === 'reaction' ? 'B' : 'u'} becomes Brush value.`,
    ],
  });
  b.add('splitVec2', 'heldParts', 7, 9, {}, 'Split Vec2: the new u and v, for the board.', { v: ['held', 'result'] });
  return { state: { nodeId: b.id('heldParts'), outputKey: 'x' }, age: { nodeId: b.id('heldParts'), outputKey: 'y' } };
}

function smoothLook(b: Builder, s: GridShape, P: Record<string, unknown>): Wire {
  for (let k = 0; k < 4; k++) b.add('colorPicker', `c${k}`, 11, 4 + k, { color: vec(P, `color${k}`) }, `Color: stop ${k + 1} of 4 on the ramp, from low values to high.`);
  b.add('constant', 'gain', 11, 8, { value: num(P, 'gain'), label: 'Contrast' }, 'Contrast: scales the value before it is coloured.');
  const shade = s.template === 'waves' ? 'u * gain * 0.5 + 0.5' : s.template === 'reaction' ? 'v * 3.0 * gain' : 'u * gain';
  b.expr('cellsLook', 12, 4, {
    label: 'Colour ramp', outputType: 'vec3',
    inputs: [['u', 'float', ['show', 'x']], ['v', 'float', ['show', 'y']], ['gain', 'float', ['gain', 'value']], ...[0, 1, 2, 3].map(k => [`c${k}`, 'vec3', [`c${k}`, 'rgb']] as [string, 'vec3', LWire])],
    lines: [['float k', `clamp(${shade}, 0.0, 1.0)`]],
    result: 'k < 0.3333 ? mix(c0, c1, k * 3.0) : (k < 0.6667 ? mix(c1, c2, k * 3.0 - 1.0) : mix(c2, c3, k * 3.0 - 2.0))',
    note: [
      'Colour ramp: the value under this pixel through four colours.',
      `k: ${s.template === 'waves' ? 'the height times Contrast, from −1…1 to 0…1 (still water is the middle of the ramp)' : s.template === 'reaction' ? 'chemical B, which stays below about 0.35, times 3 and Contrast' : 'u times Contrast'}, kept 0 to 1.`,
      'result: k along the ramp, a third per pair of colours.',
    ],
  });
  return { nodeId: b.id('cellsLook'), outputKey: 'result' };
}

// ── The store's side: Open as nodes on a node in the graph ──────────────────────────────────────

/**
 * The graph with `nodeId` opened as nodes beside it: the new nodes below the Grid Rules node, and
 * whatever read its outputs reading the new graph's instead. The node itself is left as it was
 * (unwired), as Open as nodes on Particles does. A problem (why not) when it can't be opened.
 */
export function openGridRulesInGraph(nodeId: string, nodes: GraphNode[], nextId: () => string): { nodes: GraphNode[]; boardId: string; kept: number } | { problem: string } {
  const src = nodes.find(nd => nd.id === nodeId);
  if (!src || src.type !== 'gridRules') return { problem: 'Open as nodes works on a Grid Rules node at the top level: leave the group it is in (or move it out) and try again.' };
  const problem = gridAsNodesProblem(src);
  if (problem) return { problem };
  const read = new Set<GridOutKey>(['color']);
  for (const nd of nodes) for (const i of Object.values(nd.inputs)) if (i.connection?.nodeId === nodeId) read.add(i.connection.outputKey as GridOutKey);
  const made = gridRulesAsNodes(src, nextId, { x: src.position.x, y: src.position.y + 520 }, read);
  let kept = 0;
  const rewired = nodes.map(nd => {
    let changed = false;
    const inputs = Object.fromEntries(Object.entries(nd.inputs).map(([k, inp]) => {
      const c = inp.connection;
      if (!c || c.nodeId !== nodeId) return [k, inp];
      const to = made.outputs[c.outputKey as GridOutKey];
      if (!to) { kept++; return [k, inp]; }
      changed = true;
      return [k, { ...inp, connection: { ...to } }];
    }));
    return changed ? { ...nd, inputs } : nd;
  });
  return { nodes: [...rewired, ...made.nodes], boardId: made.boardId, kept };
}

// ── Patterns and Blocks ─────────────────────────────────────────────────────────────────────────

const specTest = (spec: number, x: string) => (spec === ANY ? null : spec === NOT_EMPTY ? `abs(${x}) > 0.5` : `abs(${x} - ${f(spec)}) < 0.5`);
const specWord = (spec: number) => (spec === ANY ? 'any' : spec === NOT_EMPTY ? 'not empty' : `${spec}`);

function patternsCore(b: Builder, s: GridShape, cellPx: number): void {
  const names = ['nw', 'n', 'ne', 'w', 'me', 'e', 'sw', 's', 'se'];
  names.forEach((nm, i) => {
    if (i === 4) return;
    const [dx, dy] = stencilOffset(i);
    b.add('sampleTexture', `nb_${nm}`, 1, 11 + i, { offsetX: dx * cellPx, offsetY: dy * cellPx },
      `Sample (texture): the cell ${where(dx, dy)}, a step ago (the board's Previous). Red is its state.`, { texture: ['board', 'previous'] });
  });
  const rules = s.patterns.filter(r => !r.off);
  const counted = [...new Set(rules.flatMap(r => (r.count ? [r.count.state] : [])))];
  const lines: Array<[string, string]> = [...names.map((nm, i) => [`float c${i}`, i === 4 ? 'floor(me + 0.5)' : `floor(${nm}.r + 0.5)`] as [string, string])];
  const notes = names.map((nm, i) => `c${i}: the state ${i === 4 ? 'of this cell' : `of the cell ${WORD[nm]}`} (the stencil's ${['top left', 'top', 'top right', 'left', 'middle', 'right', 'bottom left', 'bottom', 'bottom right'][i]}).`);
  for (const k of counted) {
    lines.push([`float k${k}`, [0, 1, 2, 3, 5, 6, 7, 8].map(i => `step(abs(c${i} - ${f(k)}), 0.5)`).join(' + ')]);
    notes.push(`k${k}: how many of the 8 neighbours are in state ${k}.`);
  }
  rules.forEach((r, j) => {
    const variants = patternVariants(r).map(cells => cells.map((spec, i) => specTest(spec, `c${i}`)).filter((t): t is string => !!t));
    const any = variants.some(t => t.length === 0) ? 'true' : variants.map(t => `(${t.join(' && ')})`).join(' || ');
    const count = r.count ? ` && k${r.count.state} > ${f(r.count.min - 0.5)} && k${r.count.state} < ${f(r.count.max + 0.5)}` : '';
    lines.push([`float r${j}`, `((${any})${count}) ? 1.0 : 0.0`]);
    notes.push(`r${j}: 1 when rule ${j + 1} matches: this cell ${specWord(r.cells[4])}, ${r.cells.filter((c, i) => i !== 4 && c !== ANY).length} neighbour test(s)${r.symmetry === 'none' ? '' : r.symmetry === 'rotate' ? ' in any of four turns' : ' turned or mirrored'}${r.count ? `, and ${r.count.min} to ${r.count.max} neighbours in state ${r.count.state}` : ''}. It becomes ${r.becomes}.`);
  });
  const chain = rules.reduceRight((acc, r, j) => `(r${j} > 0.5 ? ${f(r.becomes)} : ${acc})`, 'c4');
  b.expr('rule', 3, 11, {
    label: 'The patterns', outputType: 'float',
    inputs: [['me', 'float', ['selfParts', 'x']], ...names.filter((_, i) => i !== 4).map(nm => [nm, 'vec3', [`nb_${nm}`, 'color']] as [string, 'vec3', LWire]), ['states', 'float', ['states', 'value']]],
    lines, result: `min(${chain}, max(floor(states + 0.5), 2.0) - 1.0)`,
    note: [
      'The patterns: the rules, tried in order: the first whose stencil matches says what this cell becomes; none matching, it stays.',
      'Why an Expression Block: each rule is a handful of yes/no tests on nine cells; as nodes they would sprawl.',
      ...notes,
      'result: the first matching rule\'s state (else this cell\'s own), no higher than the last state.',
    ],
  });
}

function blocksCore(b: Builder, s: GridShape, P: Record<string, unknown>): void {
  const W = 'floor(u_resolution * 0.5) * 2.0';
  const wrap = s.wrap ? '1.0' : '0.0';
  b.add('constant', 'jitter', 1, 11, { value: num(P, 'jitter'), label: 'Jitter' }, 'Jitter: how much the block grid is shuffled each step, 0 to 1. Each two-cell column is cut into 4-row segments, and a segment\'s blocks move up a row with chance Jitter ÷ 2, so falling grains stop lining up on every other row. 0 is the classic Margolus grid. A constant so Play can drive it.');
  b.add('constant', 'diceSeed', 1, 12, { value: num(P, 'seed'), label: 'Seed' }, 'Seed: picks which dice the blocks roll (a different seed, a different run; the same seed, the same run).');
  b.expr('blockCorner', 2, 11, {
    label: 'This cell\'s block', outputType: 'vec3',
    inputs: [['cell', 'vec2', ['cell', 'coord']], ['phase', 'float', ['selfParts', 'z']], ['jitter', 'float', ['jitter', 'value']], ['seed', 'float', ['diceSeed', 'value']]],
    lines: [['float par', 'step(1.5, phase)'], ['vec2 W', W], ['float frame', 'mod(floor(t * 60.0), 997.0)'], ['vec3 blk', `grBlockOf(floor(cell), par, W, clamp(jitter, 0.0, 1.0), frame, seed, ${wrap})`]],
    result: 'vec3(blk.xy, par)',
    functions: GR_DICE_GLSL,
    note: [
      'This cell\'s block: the Margolus grid of 2×2 blocks, shifted one cell diagonally on odd steps (and, with Jitter, a row up or down here and there).',
      'Why an Expression Block: grBlockOf rolls whole-number dice for this cell\'s column segment and the one next to it, a page of arithmetic as nodes.',
      'par: the step\'s parity, kept in blue as 2 + the phase on odd steps.',
      'W: the board\'s even part.',
      'frame: the frame number, for the dice.',
      'blk: the bottom-left corner of this cell\'s block (x, y), and whether the cell is in a block this step (z: a row between two segments that disagree sits out).',
      'result: the corner (x, y) and the parity (z).',
    ],
  });
  const corners = [[0, 1], [1, 1], [0, 0], [1, 0]];
  const word = ['top left', 'top right', 'bottom left', 'bottom right'];
  corners.forEach(([cx, cy], q) => {
    b.expr(`at${q}`, 3, 11 + q * 2, {
      label: `Block ${word[q]}`, outputType: 'vec2', inputs: [['blk', 'vec3', ['blockCorner', 'result']]],
      lines: [['vec2 W', W], ['vec2 p', s.wrap ? `mod(blk.xy + vec2(${f(cx)}, ${f(cy)}), W)` : `blk.xy + vec2(${f(cx)}, ${f(cy)})`]],
      result: '((p + 0.5) / u_resolution * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0)',
      note: [`Block ${word[q]}: where the block's ${word[q]} cell is, as a UV for Sample (texture).`, `W: the board's even part (an odd last row or column sits out).`, `p: the cell${s.wrap ? ', wrapped round the even part' : ''}.`, 'result: its middle in picture coordinates.'],
    });
    b.add('sampleTexture', `blk${q}`, 4, 11 + q * 2, {}, `Sample (texture): the block's ${word[q]} cell, a step ago (the board's Previous), read at the UV on the left.`, { texture: ['board', 'previous'], uv: [`at${q}`, 'result'] });
  });
  const lines: Array<[string, string]> = [['vec2 W', W], ['vec2 key', 'mod(blk.xy, W)'], ['float frame', 'mod(floor(t * 60.0), 997.0)']];
  const notes = ['W: the board\'s even part.', 'key: the block\'s corner, wrapped, so a block across the seam rolls one set of dice.', 'frame: the frame number, for the dice.'];
  corners.forEach(([cx, cy], q) => {
    const raw = `floor(b${q}.r + 0.5)`;
    lines.push([`float v${q}`, s.wrap ? raw : `(blk.x + ${f(cx)} < 0.0 || blk.y + ${f(cy)} < 0.0 || blk.x + ${f(cx)} > W.x - 0.5 || blk.y + ${f(cy)} > W.y - 0.5) ? -1.0 : ${raw}`]);
    notes.push(`v${q}: the ${word[q]} cell's state${s.wrap ? '' : ' (−1 past the walls: not empty, never a state)'}.`);
  });
  lines.push(['vec2 q', 'floor(cell) - blk.xy'], ['float qi', 'q.x + (1.0 - q.y) * 2.0'], ['float s', 'floor(me + 0.5)']);
  notes.push('q: this cell within its block (0 or 1 across and up).', 'qi: which of the four it is (top left 0, top right 1, bottom left 2, bottom right 3).', 's: this cell\'s state.');
  lines.push(['float inBlk', `grBlockOf(floor(cell), blk.z, W, clamp(jitter, 0.0, 1.0), frame, seed, ${wrap}).z`]);
  notes.push('inBlk: 1 if this cell is in a block this step (with Jitter a few rows sit out a step and stay as they are).');
  const rules = s.blocks.filter(r => !r.off);
  rules.forEach((r, j) => {
    const vars = blockVariants(r);
    const n = vars.length;
    lines.push([`float o${j}`, `floor(grDice(key, frame, ${f(31 + j * 2)}, seed) * ${f(n)})`]);
    notes.push(`o${j}: which of rule ${j + 1}'s ${n} orientation(s) is tried first, rolled once per block.`);
    vars.forEach(({ before }, k) => {
      const tests = before.map((spec, q) => specTest(spec, `v${q}`)).filter((t): t is string => !!t);
      lines.push([`float m${j}_${k}`, `(${tests.length ? tests.join(' && ') : 'true'}) ? ${f(n)} - mod(${f(k)} - o${j} + ${f(n)}, ${f(n)}) : 0.0`]);
      notes.push(`m${j}_${k}: rule ${j + 1}, orientation ${k + 1}: its priority when the block matches its before picture, else 0.`);
    });
    const best = vars.map((_, k) => `m${j}_${k}`).reduce((a, x) => `max(${a}, ${x})`);
    lines.push([`float hit${j}`, `(${best} > 0.5${r.chance < 1 ? ` && grDice(key, frame, ${f(32 + j * 2)}, seed) < ${f(r.chance)}` : ''}) ? 1.0 : 0.0`]);
    notes.push(`hit${j}: rule ${j + 1} fires on this block${r.chance < 1 ? ` (with chance ${r.chance}, rolled per block)` : ''}.`);
    // The chosen orientation's after, at this cell's place.
    const afterAt = (q: number) => vars.reduceRight((acc, { after }, k) => {
      const val = after[q] === SAME ? 's' : f(after[q]);
      const chosen = vars.map((__, kk) => (kk === k ? null : `m${j}_${k} >= m${j}_${kk}`)).filter(Boolean).join(' && ');
      return k === vars.length - 1 ? val : `((${chosen || 'true'}) ? ${val} : ${acc})`;
    }, '');
    lines.push([`float a${j}`, `qi < 0.5 ? ${afterAt(0)} : (qi < 1.5 ? ${afterAt(1)} : (qi < 2.5 ? ${afterAt(2)} : ${afterAt(3)}))`]);
    notes.push(`a${j}: what this cell becomes under rule ${j + 1}'s chosen orientation (= keeps it).`);
  });
  const chain = `(inBlk > 0.5 ? ${rules.reduceRight((acc, _r, j) => `(hit${j} > 0.5 ? a${j} : ${acc})`, 's')} : s)`;
  b.expr('rule', 5, 11, {
    label: 'The blocks', outputType: 'float',
    inputs: [
      ['blk', 'vec3', ['blockCorner', 'result']], ['cell', 'vec2', ['cell', 'coord']], ['me', 'float', ['selfParts', 'x']], ['states', 'float', ['states', 'value']], ['jitter', 'float', ['jitter', 'value']], ['seed', 'float', ['diceSeed', 'value']],
      ...corners.map((_, q) => [`b${q}`, 'vec3', [`blk${q}`, 'color']] as [string, 'vec3', LWire]),
    ],
    lines, functions: GR_DICE_GLSL,
    result: `clamp(${chain}, 0.0, max(floor(states + 0.5), 2.0) - 1.0)`,
    note: [
      'The blocks: the rules tried in order on this cell\'s 2×2 block; the first that fires rewrites all four cells at once (each cell works out its own part of the same answer, so the four agree and nothing is lost or made).',
      'Why an Expression Block: picking a rule and an orientation is a page of yes/no tests; as nodes it would sprawl.',
      ...notes,
      'result: the first firing rule\'s state for this cell (else unchanged), within the states.',
    ],
  });
  b.expr('blue', 8, 3, {
    label: 'Clock and parity', outputType: 'float',
    inputs: [['phase', 'float', ['tick', 'y']], ['tick', 'float', ['tick', 'x']], ['blk', 'vec3', ['blockCorner', 'result']]],
    result: 'phase + 2.0 * (tick > 0.5 ? 1.0 - blk.z : blk.z)',
    note: ['Clock and parity: blue keeps the clock\'s phase plus 2 on odd steps; a step flips the parity, which shifts the blocks.', 'result: phase + 2 × the new parity.'],
  });
}
