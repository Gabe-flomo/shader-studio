/**
 * build.ts — a Grid scene as real nodes (docs/grid-builder.md, "What Build makes"):
 *
 *   UV ─► warps (Expression Blocks from the 2D builder's block library) ─┬─► Grid scene ─► colour, d
 *   Time ───────────────────────────────────────────────────────────────┤      ▲
 *   per shape: Colour ─► Shape A (Expression Block: size, turn, spin,   │      │ motion, look, edge, colour
 *              pulse, outline, move X / Y, speed, lag as sliders) ──────┼──────┘
 *   Ground & lines (Expression Block, the cell grid over the background) ◄┘
 *   Glow Layer (d, colour) ─► Add over the ground ─► SDF Fill ─► Tone Map ─► Output
 *
 * The Grid scene node is an Expression Block whose helpers (glsl.ts) draw every cell; its pattern
 * numbers (amount, freq, speed, arms) are sliders on it, the shapes' numbers sliders on their own
 * Shape nodes, so dragging any of them never recompiles. Drawing cells, the motion path, the
 * pattern's kind and the rules are structure: they rebuild.
 *
 * Every node has a note (`__comment`) and a role (`_gsRole`); the UV node keeps the spec, so the
 * Scene builder reopens the scene as it was built. Pure: ids from `idFor`.
 */
import type { GraphNode, InputSocket, OutputSocket } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { tidy } from '../sceneBuilder/build';
import { blockGlslLines, checkBlock, clampTimes, type SpaceBlock } from '../sceneBuilder2d/blocks';
import { BLOCK_BY_ID } from '../sceneBuilder2d/blockLibrary';
import { colourText } from '../lang/colours';
import { gf, gridProgram, shapeArgs, activeMask, activeRules } from './glsl';
import { LUMA, findTex, fitLines, picUv, standInId, standIns } from '../builders/textures';
import {
  MOTION_LABELS, PATTERN_LABELS, SHAPE_LABELS, TARGET_LABELS, cellSize, ruleText, shapeOf,
  type GShape, type GridSceneSpec,
} from './spec';

export const GS_ROLE = '_gsRole';
export const GS_BUILD = '_gsBuild';
/** On the UV node: the scene it was built from. */
export const GS_META = 'gridScene';

export interface GridSceneMeta {
  v: 1;
  spec: GridSceneSpec;
  build?: string;
  /** role → fingerprint of the node as built, to tell the user's own edits apart on a rebuild. */
  built?: Record<string, string>;
}

export type Ref = { nodeId: string; outputKey: string };
const ref = (n: GraphNode, outputKey: string): Ref => ({ nodeId: n.id, outputKey });

export interface GridBuildResult {
  nodes: GraphNode[];
  final: Ref;
  /** The UV node: it carries the spec. */
  sceneId: string;
  /** The Grid scene node (its distance `d` is what a jump to Grid Rules starts from). */
  gridId: string;
  warnings: string[];
}

interface Ctx { idFor: (role: string) => string; nodes: GraphNode[]; warnings: string[] }

function mk(c: Ctx, type: string, role: string, params: Record<string, unknown>, wires: Record<string, Ref | null | undefined>, note: string): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`Grid builder: unknown node type ${type}`);
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(def.inputs)) {
    const w = wires[k];
    inputs[k] = { type: s.type, label: s.label, ...(w ? { connection: { ...w } } : {}) };
  }
  const outputs: Record<string, OutputSocket> = {};
  for (const [k, s] of Object.entries(def.outputs)) outputs[k] = { type: s.type, label: s.label };
  const node: GraphNode = { id: c.idFor(role), type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params, __comment: note, [GS_ROLE]: role } };
  c.nodes.push(node);
  return node;
}

type In = { name: string; type: 'float' | 'vec2' | 'vec3' | 'vec4'; from?: Ref; slider?: { value: number; min: number; max: number } };
type Line = { lhs: string; op: string; rhs: string };

/** An Expression Block: typed inputs (wired, or a float slider), lines, a result, exposed outputs, helpers. */
function expr(c: Ctx, role: string, label: string, inputs: In[], result: string, note: string, o: {
  outputType?: 'float' | 'vec2' | 'vec3' | 'vec4'; lines?: Line[]; outputs?: Array<{ name: string; type: string; label: string }>; functions?: string;
} = {}): GraphNode {
  const outputType = o.outputType ?? 'vec3';
  const node: GraphNode = {
    id: c.idFor(role), type: 'exprNode', position: { x: 0, y: 0 },
    inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type, label: i.name, ...(i.from ? { connection: { ...i.from } } : {}) } as InputSocket])),
    outputs: {
      result: { type: outputType, label: 'Result' },
      ...Object.fromEntries((o.outputs ?? []).map(x => [x.name, { type: x.type, label: x.label } as OutputSocket])),
    },
    params: {
      label, outputType, lines: o.lines ?? [], result, expr: result,
      inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: i.slider ? { min: i.slider.min, max: i.slider.max } : null })),
      ...Object.fromEntries(inputs.filter(i => i.slider).map(i => [i.name, i.slider!.value])),
      ...(o.outputs?.length ? { outputs: o.outputs.map(x => x.name) } : {}),
      ...(o.functions ? { glslFunctions: o.functions } : {}),
      __comment: note, [GS_ROLE]: role,
    },
  };
  c.nodes.push(node);
  return node;
}

const L = (lhs: string, rhs: string, op = '='): Line => ({ lhs, op, rhs });
const r2 = (n: number) => Math.round(n * 100) / 100;
const col = (v: readonly number[]) => colourText(v);

/** A warp block as an Expression Block (as the 2D Scene Builder builds its space blocks). */
function warpNode(c: Ctx, i: number, block: SpaceBlock, pos: Ref): Ref {
  const lines = blockGlslLines(block);
  const name = block.name || `Warp ${i + 1}`;
  if (!lines) {
    const chk = checkBlock(block);
    c.warnings.push(`Warp “${name}” was left out: ${[...chk.errors, ...chk.lines.filter(l => !l.ok).map(l => l.error!)][0] ?? 'it doesn\'t check'}`);
    return pos;
  }
  const entry = block.lib ? BLOCK_BY_ID[block.lib] : undefined;
  const times = clampTimes(block.times);
  const node = expr(c, `w${i + 1}`, name, [
    { name: 'uv', type: 'vec2', from: pos },
    ...block.params.map(p => ({ name: p.name, type: 'float' as const, slider: { value: p.value, min: p.min, max: p.max } })),
  ], 'uv', `${name} (grid warp ${i + 1}): ${entry ? entry.blurb : 'a space block.'} It bends the space the whole grid is drawn in, so the cells and their shapes warp together${times > 1 ? `; its lines run ${times} times over` : ''}. `
    + `${block.params.length ? `The sliders (${block.params.map(p => `${p.name} ${r2(p.value)}`).join(', ')}) are live.` : ''} From the 2D Scene Builder's block library.`,
  { outputType: 'vec2', lines });
  return ref(node, 'result');
}

/** A shape's sliders: an Expression Block whose result is its motion, with its look and outline beside. */
function shapeNode(c: Ctx, spec: GridSceneSpec, s: GShape): { node: GraphNode; colour: Ref } {
  const n = spec.cells.filter(x => x.s === s.id).length;
  const colour = mk(c, 'colorPicker', `${s.id}:color`, { color: [...s.color] }, {}, `Shape ${s.id}'s colour, ${col(s.color)}. Rules can change it per cell (swap, colour).`);
  const m = s.motion;
  const path = MOTION_LABELS[m.path];
  const node = expr(c, s.id, `Shape ${s.id} · ${SHAPE_LABELS[s.kind].toLowerCase()}`, [
    { name: 'size', type: 'float', slider: { value: s.size, min: 0.05, max: 1.5 } },
    { name: 'turn', type: 'float', slider: { value: s.turn, min: -180, max: 180 } },
    { name: 'spin', type: 'float', slider: { value: s.spin, min: -2, max: 2 } },
    { name: 'pulse', type: 'float', slider: { value: s.pulse, min: 0, max: 1 } },
    { name: 'outline', type: 'float', slider: { value: s.outline, min: 0, max: 0.5 } },
    { name: 'moveX', type: 'float', slider: { value: m.xy[0], min: -3, max: 3 } },
    { name: 'moveY', type: 'float', slider: { value: m.xy[1], min: -3, max: 3 } },
    { name: 'speed', type: 'float', slider: { value: m.speed, min: -2, max: 2 } },
    { name: 'lag', type: 'float', slider: { value: m.lag, min: -0.5, max: 0.5 } },
  ], 'vec4(moveX, moveY, speed, lag)',
  `Shape ${s.id}: a ${SHAPE_LABELS[s.kind].toLowerCase()} in ${n} cell${n === 1 ? '' : 's'}${spec.pattern.fill === s.id ? ', and the pattern\'s fill' : ''}. Its sliders feed the Grid scene node and are live. `
    + `Size is the radius as a share of half a cell (1 touches the neighbours); turn in degrees; spin in turns a second; pulse makes the size breathe; outline above 0 draws only the edge. `
    + `Motion: ${path.label.toLowerCase()} (${path.blurb.toLowerCase()}) moveX and moveY are the XY reach in cells, speed in cycles a second, lag delays each cell by (x + y) × lag of a cycle so the motion travels as a wave. `
    + 'The path itself is set in the Grid builder (it shapes the code). Result: the motion (x, y, speed, lag); look: (size, turn in radians, spin, pulse); edge: the outline.',
  {
    outputType: 'vec4',
    lines: [L('vec4 look', 'vec4(size, radians(turn), spin, pulse)'), L('float edge', 'outline')],
    outputs: [{ name: 'look', type: 'vec4', label: 'Look' }, { name: 'edge', type: 'float', label: 'Edge' }],
  });
  return { node, colour: ref(colour, 'rgb') };
}

/** The scene's nodes. */
export function buildGridScene(spec: GridSceneSpec, idFor: (role: string) => string = r => `gs_${r.replace(/[^A-Za-z0-9]/g, '_')}`): GridBuildResult {
  const c: Ctx = { idFor, nodes: [], warnings: [] };
  const look = spec.look;
  const uv = mk(c, 'uv', 'uv', {}, {}, `The picture's coordinates: the centre is (0, 0), the top is 1. Built by the Grid builder (${spec.cols} × ${spec.rows} cells, ${spec.cells.length} drawn); open the Scene builder (or right-click → Edit in Grid builder) to draw on it again.`);
  const time = mk(c, 'time', 'time', {}, {}, 'Time in seconds: it drives the motion, spin, pulse and the pattern\'s wave.');
  let pos = ref(uv, 'uv');
  spec.warps.forEach((w, i) => { pos = warpNode(c, i, w, pos); });

  const prog = gridProgram(spec);
  if (spec.cells.length > prog.placed) c.warnings.push('Some drawn cells name a shape that is gone or sit outside the grid; they were left out.');
  const shapeRefs = new Map<string, { node: GraphNode; colour: Ref }>();
  for (const s of spec.shapes) shapeRefs.set(s.id, shapeNode(c, spec, s));

  const P = spec.pattern;
  const inputs: In[] = [
    { name: 'uv', type: 'vec2', from: pos },
    { name: 't', type: 'float', from: ref(time, 'time') },
    { name: 'amount', type: 'float', slider: { value: P.amount, min: 0, max: 1.5 } },
    { name: 'freq', type: 'float', slider: { value: P.freq, min: 0, max: 16 } },
    { name: 'speed', type: 'float', slider: { value: P.speed, min: -2, max: 2 } },
    { name: 'arms', type: 'float', slider: { value: P.arms, min: 1, max: 8 } },
  ];
  for (const s of spec.shapes) {
    const a = shapeArgs(s.id);
    const sr = shapeRefs.get(s.id)!;
    inputs.push(
      { name: a.m, type: 'vec4', from: ref(sr.node, 'result') },
      { name: a.l, type: 'vec4', from: ref(sr.node, 'look') },
      { name: a.e, type: 'float', from: ref(sr.node, 'edge') },
      { name: a.c, type: 'vec3', from: sr.colour },
    );
  }
  // Pictures (docs/grid-builder.md, "Textures"): a picture over the grid, read at the centre of this pixel's cell.
  const cs0 = cellSize(spec);
  const gx = spec.cols * cs0 / 2, gy = spec.rows * cs0 / 2;
  const cellLum = new Map<string, Ref>();
  const texOf = (name: string | undefined, what: string) => {
    const src = findTex(spec.textures, name);
    if (!src) { c.warnings.push(`${what} reads the picture “${name ?? ''}”, which the scene doesn't have: pick one.`); return null; }
    return { src, out: { nodeId: standInId(src), outputKey: 'texture' } as Ref };
  };
  const brightnessAtCell = (name: string | undefined, what: string): Ref | null => {
    if (name && cellLum.has(name)) return cellLum.get(name)!;
    const t = texOf(name, what);
    if (!t) return null;
    const key = t.src.name.replace(/[^A-Za-z0-9]/g, '_');
    const at = expr(c, `pic:${key}:cell`, 'Cell centre on the picture', [{ name: 'uv', type: 'vec2', from: pos }], picUv('st'),
      `Where the picture “${t.src.name}” is read for this pixel's cell: id is the cell (as the grid counts them), q its centre in picture units, the picture covering the whole grid (Fill, keeping its shape). Every pixel of a cell reads the same place, so a cell takes one brightness.`,
      { outputType: 'vec2', lines: [
        L('vec2 cp', `vec2(uv.x / ${gf(cs0)} + ${gf(spec.cols / 2)}, ${gf(spec.rows / 2)} - uv.y / ${gf(cs0)})`),
        L('vec2 id', 'floor(cp)'),
        L('vec2 q', `vec2((id.x + 0.5) * ${gf(cs0)} - ${gf(gx)}, ${gf(gy)} - (id.y + 0.5) * ${gf(cs0)})`),
        L('vec2 ext', `vec2(${gf(gx)}, ${gf(gy)})`),
        ...fitLines('cover', 'q', 'ext', gf(t.src.aspect ?? 1), '1.0'),
      ] });
    const smp = mk(c, 'sampleTexture', `pic:${key}:sample`, {}, { texture: t.out, uv: ref(at, 'result') }, `Reads the picture “${t.src.name}” at the centre of this pixel's cell.`);
    const lum = expr(c, `pic:${key}:lum`, 'Cell brightness', [{ name: 'col', type: 'vec3', from: ref(smp, 'color') }, { name: 'a', type: 'float', from: ref(smp, 'alpha') }],
      `${LUMA('col')} * a`, `The brightness of “${t.src.name}” at this cell, 0 to 1 (times its alpha).`, { outputType: 'float' });
    cellLum.set(t.src.name, ref(lum, 'result'));
    return ref(lum, 'result');
  };
  if (prog.patternPic) {
    const pb = brightnessAtCell(P.tex, 'The pattern');
    inputs.push(pb ? { name: 'pb', type: 'float', from: pb } : { name: 'pb', type: 'float', slider: { value: 0.5, min: 0, max: 1 } });
  }
  const rules = activeRules(spec).filter(r => !r.id.endsWith('~'));
  const fill = shapeOf(spec, P.fill);
  const patternWords = P.kind === 'none' ? 'No pattern.' : `Pattern: ${PATTERN_LABELS[P.kind].label.toLowerCase()} (${PATTERN_LABELS[P.kind].blurb.toLowerCase()}) changing each shape's ${TARGET_LABELS[P.target].toLowerCase()} by amount; freq is waves across the grid, speed cycles a second${P.kind === 'spiral' ? ', arms the spiral\'s arms' : ''}.${fill ? ` It fills the empty cells with shape ${fill.id}.` : ''}${activeMask(spec) ? ` Only in the cells the words "${activeMask(spec)!.text}" cover (gs_mask: the stroke font, one line a stroke).` : ''}`;
  const grid = expr(c, 'grid', 'Grid scene', inputs, 'g.rgb',
    `The grid: ${spec.cols} × ${spec.rows} cells, ${prog.placed} drawn with shapes ${spec.shapes.map(s => s.id).join(', ') || 'none'}. `
    + `Its helper ${prog.name} (in the node's functions) draws every drawn cell: where its shape is now (its motion), which cell that is, the pattern's wave there, the rules, and its distance; the nearest shape gives the colour. `
    + `${patternWords} ${rules.length ? `Rules, checked in the shader for every cell: ${rules.map(ruleText).join('; ')}.` : 'No rules.'} `
    + 'Result: the colour of the nearest shape; d: the distance to it (negative inside). The sliders are live; drawing cells, paths and rules rebuild the code.',
  {
    outputType: 'vec3',
    lines: [
      ...(prog.picture ? [L('vec4 pic', 'vec4(0.0, 0.0, 0.0, -1.0)')] : []),
      L('vec4 g', `${prog.name}(uv, t, vec4(amount, freq, speed, arms)${prog.args.length ? `, ${prog.args.join(', ')}` : ''})`), L('float d', 'g.w'),
    ],
    outputs: [{ name: 'd', type: 'float', label: 'Distance' }, ...(prog.picture ? [{ name: 'pic', type: 'vec4', label: 'Picture place' }] : [])],
    functions: prog.functions,
  });
  if (prog.patternPic) grid.params.__comment = `${grid.params.__comment} pb is the pattern's picture brightness at this pixel's cell (the wave is pb × 2 − 1).`;
  let d = ref(grid, 'd');
  let colour = ref(grid, 'result');
  // Pictures inside cells: the winning cell's place on its picture (pic), read and painted over its colour.
  prog.slots.forEach((name, j) => {
    const t = texOf(name, 'A picture cell');
    if (!t) return;
    const key = t.src.name.replace(/[^A-Za-z0-9]/g, '_');
    const at = expr(c, `cells:${key}:fit`, 'Picture in the cell', [{ name: 'pic', type: 'vec4', from: ref(grid, 'pic') }], picUv('st'),
      `Where the picture “${t.src.name}” is read inside a cell: pic.xy is the place in the cell's square (0 to 1, turning with the shape), fitted to the picture (Fill, keeping its shape).`,
      { outputType: 'vec2', lines: [L('vec2 q', 'pic.xy - 0.5'), L('vec2 ext', 'vec2(0.5)'), ...fitLines('cover', 'q', 'ext', gf(t.src.aspect ?? 1), '1.0')] });
    const smp = mk(c, 'sampleTexture', `cells:${key}:sample`, {}, { texture: t.out, uv: ref(at, 'result') }, `Reads the picture “${t.src.name}” inside its cells.`);
    colour = ref(expr(c, `cells:${key}:paint`, 'Paint picture cells', [
      { name: 'base', type: 'vec3', from: colour }, { name: 'tex', type: 'vec3', from: ref(smp, 'color') }, { name: 'a', type: 'float', from: ref(smp, 'alpha') }, { name: 'pic', type: 'vec4', from: ref(grid, 'pic') },
    ], `mix(base, tex, pic.z * step(abs(pic.w - ${gf(j)}), 0.5) * clamp(a, 0.0, 1.0))`,
    `The picture “${t.src.name}” where the nearest cell is a picture cell showing it (pic.z 1, slot pic.w ${j}); the shapes' own colours elsewhere.`), 'result');
  });
  // The picture mask: shapes only in the cells where the picture is bright (or dark).
  if (spec.picMask) {
    const m = spec.picMask;
    const lum = brightnessAtCell(m.tex, 'The mask');
    if (lum) {
      d = ref(expr(c, 'picmask', 'Picture mask', [
        { name: 'd', type: 'float', from: d }, { name: 'l', type: 'float', from: lum }, { name: 'cut', type: 'float', slider: { value: m.cut, min: 0, max: 1 } },
      ], `mix(1.0e3, d, ${m.invert ? '1.0 - ' : ''}step(cut, l))`,
      `Shapes only in the cells where the picture is ${m.invert ? 'darker' : 'brighter'} than cut (live): elsewhere the distance is pushed far away, so nothing is drawn or glows there. Read once per cell, at its centre.`, { outputType: 'float' }), 'result');
    }
  }

  // The ground: background, a faint checker of the cells, and the grid lines, in the warped space.
  const bg = mk(c, 'colorPicker', 'bg', { color: [...look.bg] }, {}, `The background, ${col(look.bg)}.`);
  const lineC = mk(c, 'colorPicker', 'lines', { color: [...look.lineColor] }, {}, `The grid lines' colour, ${col(look.lineColor)}.`);
  const cs = gf(cellSize(spec));
  const ground = expr(c, 'ground', 'Ground & lines', [
    { name: 'uv', type: 'vec2', from: pos },
    { name: 'bg', type: 'vec3', from: ref(bg, 'rgb') },
    { name: 'line', type: 'vec3', from: ref(lineC, 'rgb') },
    { name: 'width', type: 'float', slider: { value: look.lines ? look.lineWidth : 0, min: 0, max: 0.2 } },
    { name: 'tint', type: 'float', slider: { value: 0.12, min: 0, max: 0.6 } },
  ], 'mix(bg * (1.0 + tint * checker * inside), line, ln * inside)',
  `The ground under the shapes: the background, every other cell a little lighter (tint), and the cell borders as lines (width in cells; 0 hides them). cp is the point in cell units (${spec.cols} × ${spec.rows}, ${cs} picture units a cell); inside is 1 over the grid. It reads the warped space, so the lines bend with the warps.`,
  {
    lines: [
      L('vec2 cp', `vec2(uv.x / ${cs} + ${gf(spec.cols / 2)}, ${gf(spec.rows / 2)} - uv.y / ${cs})`),
      L('float inside', `step(-width, cp.x) * step(-width, cp.y) * step(cp.x, ${gf(spec.cols)} + width) * step(cp.y, ${gf(spec.rows)} + width)`),
      L('vec2 f', 'abs(fract(cp + 0.5) - 0.5)'),
      L('float px', `2.0 / (u_resolution.y * ${cs})`),
      L('float ln', 'width > 0.0 ? 1.0 - smoothstep(width * 0.5, width * 0.5 + px, min(f.x, f.y)) : 0.0'),
      L('float checker', `mod(floor(cp.x) + floor(cp.y), 2.0) * step(0.0, cp.x) * step(cp.x, ${gf(spec.cols)}) * step(0.0, cp.y) * step(cp.y, ${gf(spec.rows)})`),
    ],
  });
  let acc = ref(ground, 'result');
  if (look.glow) {
    const gl = mk(c, 'glowLayer', 'glow', { intensity: look.glowAmount, power: look.glowFalloff }, { d, color: colour },
      `The shapes' glow: each shape's colour × (${r2(look.glowAmount * 1000) / 1000} ÷ distance) ^ ${look.glowFalloff}, added to the ground.`);
    acc = ref(mk(c, 'addColor', 'addglow', {}, { a: acc, b: ref(gl, 'result') }, 'Adds the glow over the ground.'), 'result');
  }
  let final = ref(mk(c, 'sdfFill', 'fill', {}, { d, fillColor: colour, background: acc }, 'Paints the shapes over the ground: inside a shape (negative distance) its colour shows, the edge anti-aliased.'), 'result');
  if (look.tone !== 'none') final = ref(mk(c, 'toneMap', 'tone', { mode: look.tone }, { color: final }, `Squeezes the glow's bright light into colours a screen can show (${look.tone.toUpperCase()}).`), 'color');
  tidy(c.nodes, 0, 0);
  return { nodes: c.nodes, final, sceneId: uv.id, gridId: grid.id, warnings: c.warnings };
}

/** A stand-alone graph with its own Output: the builder's preview, examples and tests. */
export function buildStandaloneGrid(spec: GridSceneSpec, opts: { idFor?: (role: string) => string; outputId?: string } = {}): GridBuildResult & { outputId: string } {
  const built = buildGridScene(spec, opts.idFor);
  // Its pictures: a Texture node per source, so it compiles alone (the preview binds the real picture to it).
  built.nodes.push(...standIns(spec.textures));
  const uv = built.nodes.find(n => n.id === built.sceneId)!;
  uv.params = { ...uv.params, [GS_META]: { v: 1, spec: structuredClone(spec) } satisfies GridSceneMeta };
  const last = built.nodes.find(n => n.id === built.final.nodeId)!;
  const outputId = opts.outputId ?? 'out';
  const def = getNodeDefinition('output')!;
  built.nodes.push({
    id: outputId, type: 'output', position: { x: last.position.x + 440, y: last.position.y },
    inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label, connection: { ...built.final } } },
    outputs: {}, params: {},
  });
  return { ...built, outputId };
}
