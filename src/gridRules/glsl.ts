/**
 * glsl.ts — the GLSL of a Grid Rules node (docs/grid-rules.md), generated from its rule set.
 *
 *  - gridStepGLSL: one step of the board. Compiled as the whole of the board Pass's program
 *    (compiler/gridRulesExpand.ts): it reads the board a step ago (the Pass's Previous), counts or
 *    matches the cells round this one, applies the rule, seeds a new board, paints the brush, and
 *    writes R = state, G = age / afterglow (Smooth: the two fields), B = the clock, A = the signature.
 *  - gridViewGLSL: the node's outputs in whatever program reads it: the board at this pixel, coloured.
 *
 * `P(key)` is a param as GLSL (its uniform's name, or a literal when baked); `C(key)` a colour.
 * Only GLSL ES 1.00 that the test evaluator also runs (compiler/__tests__/glslRun.ts): declarations,
 * if / else, for loops with constant bounds, ?:, and the built-ins.
 */
import { ANY, NOT_EMPTY, SAME, blockCorner, blockVariants, patternVariants, stencilOffset } from './stencils';
import {
  MOORE_OFFSETS, VON_NEUMANN_OFFSETS, gridSignature, floatLiterals, isDiscrete,
  type GridShape,
} from './spec';

/**
 * A hash of a cell and a frame (Dave Hoskins, "Hash without Sine", hash13): no sin(), so no
 * 1/256 steps near 0. Three inputs, so the frame doesn't just slide one frame's dice along the board
 * (a frame number added to the cell's coordinates would: a flare would leave a streak).
 */
export const GR_HASH_GLSL = `float grHash(vec3 p) {
    vec3 p3 = fract(p * 0.1031);
    p3 = p3 + dot(p3, vec3(p3.z, p3.y, p3.x) + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}`;

export interface GridNames {
  /** The node's slug: every variable is prefixed with it. */
  id: string;
  P: (key: string) => string;
  C: (key: string) => string;
}

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const off = (dx: number, dy: number) => `vec2(${f(dx)}, ${f(dy)})`;

/** The frame number for hashing (kept small so the hash stays precise). */
const FRAME = 'mod(floor(u_time * 60.0), 997.0)';

/** One step of the board. `prev` is the board a step ago (a sampler), `image` the start picture's sampler, if wired. */
export function gridStepGLSL(s: GridShape, N: GridNames, prev: string, image?: string): string {
  const { id, P } = N;
  const v = (name: string) => `${id}_${name}`;
  const read = (d: string) => `texture2D(${prev}, (${v('cell')} + ${d} + 0.5) / ${v('res')})`;
  const L: string[] = [];
  const sig = gridSignature(s);
  L.push(
    `vec2 ${v('res')} = u_resolution;`,
    `vec2 ${v('cell')} = floor(gl_FragCoord.xy);`,
    `vec4 ${v('me')} = ${read('vec2(0.0)')};`,
    `float ${v('fresh')} = (abs(${v('me')}.a - ${f(sig)}) > 0.5 || ${P('reset')} > 0.5) ? 1.0 : 0.0;`,
  );
  // The clock: Speed below 1 steps on some frames only; Steps above 1 is the Pass's Repeat.
  if (s.steps > 1) L.push(`float ${v('tick')} = 1.0;`, `float ${v('phase')} = 0.0;`);
  else {
    L.push(
      `float ${v('clk')} = (${v('fresh')} > 0.5 ? 0.0 : fract(${v('me')}.b)) + clamp(${P('rate')}, 0.0, 1.0);`,
      `float ${v('tick')} = step(1.0, ${v('clk')});`,
      `float ${v('phase')} = ${v('clk')} - ${v('tick')};`,
    );
  }
  L.push(`float ${v('h')} = grHash(vec3(${v('cell')}, ${FRAME} + ${P('seed')} * 1013.0 + 1.0));`);
  L.push(
    `vec2 ${v('m')} = u_mouse * ${f(s.scale)};`,
    `float ${v('in')} = (length(${v('cell')} + 0.5 - ${v('m')}) < ${P('brushRadius')} ? 1.0 : 0.0) * max(step(0.5, u_mousebtn), step(0.5, ${P('paint')}));`,
  );
  if (isDiscrete(s.type)) L.push(...discreteStep(s, N, read, image, sig, prev));
  else L.push(...smoothStep(s, N, read, image));
  return L.map(l => `    ${l}\n`).join('');
}

/** The seed for a whole-number board: 1 where the start says a cell is on. */
function discreteSeed(s: GridShape, N: GridNames, image?: string): string {
  const { id, P } = N;
  const noise = `(${id}_h < ${P('density')} ? 1.0 : 0.0)`;
  if (s.start === 'empty') return '0.0';
  if (s.start === 'centre') return `(length(${id}_cell + 0.5 - ${id}_res * 0.5) < min(${id}_res.x, ${id}_res.y) * 0.15 ? ${noise} : 0.0)`;
  // An image: its brightness picks the state (0 dark … the last state white), so a picture can lay out several.
  if (s.start === 'image' && image) return `floor(clamp(dot(texture2D(${image}, (${id}_cell + 0.5) / ${id}_res).rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0) * ${id}_top + 0.5)`;
  return noise;
}

function countLines(s: GridShape, N: GridNames, read: (d: string) => string): string[] {
  const { id } = N;
  const L = [`float ${id}_cnt = 0.0;`, `float ${id}_q = 0.0;`];
  const on = `(step(0.5, ${id}_q) - step(1.5, ${id}_q))`;
  if (s.neighbourhood === 'radius') {
    const R = s.radius;
    L.push(
      `for (int ${id}_dy = -${R}; ${id}_dy <= ${R}; ${id}_dy++) {`,
      `    for (int ${id}_dx = -${R}; ${id}_dx <= ${R}; ${id}_dx++) {`,
      `        vec2 ${id}_d = vec2(float(${id}_dx), float(${id}_dy));`,
      `        float ${id}_w = (${id}_dx == 0 && ${id}_dy == 0) ? 0.0 : ${s.shape === 'circle' ? `step(dot(${id}_d, ${id}_d), ${f(R * R + R + 0.5)})` : '1.0'};`,
      `        ${id}_q = ${read(`${id}_d`)}.r;`,
      `        ${id}_cnt += ${id}_w * ${on};`,
      '    }',
      '}',
    );
    return L;
  }
  for (const [dx, dy] of s.neighbourhood === 'vonNeumann' ? VON_NEUMANN_OFFSETS : MOORE_OFFSETS) {
    L.push(`${id}_q = ${read(off(dx, dy))}.r;`, `${id}_cnt += ${on};`);
  }
  return L;
}

function discreteStep(s: GridShape, N: GridNames, read: (d: string) => string, image: string | undefined, sig: number, prev: string): string[] {
  const { id, P } = N;
  const v = (name: string) => `${id}_${name}`;
  const L: string[] = [`float ${v('s')} = floor(${v('me')}.r + 0.5);`, `float ${v('g')} = ${v('me')}.g;`];
  const multi = s.type === 'patterns' || s.type === 'blocks';
  if (multi) {
    L.push(`float ${v('top')} = max(floor(${P('states')} + 0.5), 2.0) - 1.0;`);
    L.push(...(s.type === 'patterns' ? patternLines(s, N, read) : blockLines(s, N, prev)));
  }
  if (!multi) L.push(...countLines(s, N, read));
  // Born / survive: bit `count` of the masks (Moore, von Neumann), or a range (radius).
  if (multi) { /* the next state is worked out above */ } else if (s.neighbourhood === 'radius') {
    L.push(
      `float ${v('born')} = step(${P('bornLo')} - 0.5, ${v('cnt')}) * step(${v('cnt')}, ${P('bornHi')} + 0.5);`,
      `float ${v('surv')} = step(${P('surviveLo')} - 0.5, ${v('cnt')}) * step(${v('cnt')}, ${P('surviveHi')} + 0.5);`,
    );
  } else {
    L.push(
      `float ${v('born')} = mod(floor((${P('bornMask')} + 0.5) / exp2(${v('cnt')})), 2.0);`,
      `float ${v('surv')} = mod(floor((${P('surviveMask')} + 0.5) / exp2(${v('cnt')})), 2.0);`,
    );
  }
  if (multi) { /* done */ } else if (s.type === 'stages') {
    L.push(
      `float ${v('N')} = max(floor(${P('states')} + 0.5), 2.0);`,
      `float ${v('top')} = ${v('N')} - 1.0;`,
      `float ${v('next')} = ${v('s')} < 0.5 ? ${v('born')} : (${v('s')} < 1.5 ? (${v('surv')} > 0.5 ? 1.0 : (${v('N')} > 2.5 ? 2.0 : 0.0)) : (${v('s')} + 1.0 > ${v('N')} - 0.5 ? 0.0 : ${v('s')} + 1.0));`,
    );
  } else {
    L.push(
      `float ${v('top')} = 1.0;`,
      `float ${v('next')} = (${v('s')} > 0.5 && ${v('s')} < 1.5) ? ${v('surv')} : ${v('born')};`,
    );
  }
  // G: a live cell's age climbs from 0; a cell that just switched off glows (Afterglow), fading each step.
  // Patterns and Blocks: any state that stays ages; a cell that changes starts again (empty: glowing).
  L.push(`float ${v('ng')} = 0.0;`);
  if (multi) {
    L.push(
      `if (abs(${v('next')} - ${v('s')}) < 0.5) ${v('ng')} = ${v('next')} > 0.5 ? min(1.0, ${v('g')} + ${P('ageRate')}) : ${v('g')} * ${P('afterglow')};`,
      `else ${v('ng')} = ${v('next')} < 0.5 ? ${P('afterglow')} : 0.0;`,
    );
  } else L.push(
    `if (${v('next')} > 0.5 && ${v('next')} < 1.5) ${v('ng')} = (${v('s')} > 0.5 && ${v('s')} < 1.5) ? min(1.0, ${v('g')} + ${P('ageRate')}) : 0.0;`,
    `else if (${v('next')} < 0.5) ${v('ng')} = ${v('s')} > 0.5 ? ${P('afterglow')} : ${v('g')} * ${P('afterglow')};`,
  );
  L.push(
    `if (${v('tick')} < 0.5) { ${v('next')} = ${v('s')}; ${v('ng')} = ${v('g')}; }`,
    `if (${v('fresh')} > 0.5) { ${v('next')} = ${discreteSeed(s, N, image)}; ${v('ng')} = 0.0; }`,
    `float ${v('roll')} = grHash(vec3(${v('cell')} + 0.5, ${FRAME} + 7919.0));`,
    `if (${v('in')} > 0.5 && ${v('roll')} < ${P('brushFill')}) { ${v('next')} = clamp(floor(${P('brushState')} + 0.5), 0.0, ${v('top')}); ${v('ng')} = 0.0; }`,
  );
  if (s.type === 'blocks') {
    // An odd last row or column has no block: it is kept empty (it would hold whatever landed there for ever).
    L.push(`${v('next')} = ${v('next')} * ${v('live')};`, `${v('ng')} = ${v('ng')} * ${v('live')};`);
  }
  if (!s.wrap && s.type !== 'blocks') {
    // Walls: the outer ring of cells stays empty, so a read past the edge (which sees the edge) reads an empty cell.
    L.push(
      `float ${v('inside')} = step(0.5, ${v('cell')}.x) * step(0.5, ${v('cell')}.y) * step(${v('cell')}.x, ${v('res')}.x - 1.5) * step(${v('cell')}.y, ${v('res')}.y - 1.5);`,
      `${v('next')} = ${v('next')} * ${v('inside')};`,
      `${v('ng')} = ${v('ng')} * ${v('inside')};`,
    );
  }
  // Blocks: blue also keeps the step's parity (2 + phase on odd steps), which shifts the blocks.
  const blue = s.type === 'blocks' ? `${v('phase')} + 2.0 * (${v('tick')} > 0.5 ? 1.0 - ${v('par')} : ${v('par')})` : v('phase');
  L.push(`vec3 ${v('out')} = vec3(${v('next')}, ${v('ng')}, ${blue});`, `float ${v('outA')} = ${f(sig)};`);
  return L;
}

/** A state test: a spec (any, not empty, a state) on a value. */
function specTest(spec: number, x: string): string | null {
  if (spec === ANY) return null;
  if (spec === NOT_EMPTY) return `abs(${x}) > 0.5`;
  return `abs(${x} - ${f(spec)}) < 0.5`;
}

/** Patterns: the 3×3 block read once, then the rules in order (first match wins; none: stay). */
function patternLines(s: GridShape, N: GridNames, read: (d: string) => string): string[] {
  const { id } = N;
  const v = (name: string) => `${id}_${name}`;
  const L: string[] = [];
  for (let i = 0; i < 9; i++) {
    if (i === 4) { L.push(`float ${v('c4')} = ${v('s')};`); continue; }
    const [dx, dy] = stencilOffset(i);
    L.push(`float ${v('c' + i)} = floor(${read(off(dx, dy))}.r + 0.5);`);
  }
  const rules = s.patterns.filter(r => !r.off);
  const counted = [...new Set(rules.flatMap(r => (r.count ? [r.count.state] : [])))];
  for (const k of counted) {
    L.push(`float ${v('k' + k)} = ${[0, 1, 2, 3, 5, 6, 7, 8].map(i => `(abs(${v('c' + i)} - ${f(k)}) < 0.5 ? 1.0 : 0.0)`).join(' + ')};`);
  }
  L.push(`float ${v('next')} = ${v('s')};`);
  rules.forEach((r, j) => {
    const variants = patternVariants(r).map(cells => cells.map((spec, i) => specTest(spec, v('c' + i))).filter((t): t is string => !!t));
    const any = variants.some(t => t.length === 0) ? 'true' : variants.map(t => `(${t.join(' && ')})`).join(' || ');
    const count = r.count ? ` && ${v('k' + r.count.state)} > ${f(r.count.min - 0.5)} && ${v('k' + r.count.state)} < ${f(r.count.max + 0.5)}` : '';
    L.push(`${j ? 'else ' : ''}if ((${any})${count}) ${v('next')} = ${f(r.becomes)};`);
  });
  L.push(`${v('next')} = min(${v('next')}, ${v('top')});`);
  return L;
}

/**
 * Blocks (Margolus): this cell's 2×2 block (its grid shifted one cell diagonally on odd steps), its
 * four cells read, the rules tried in order; within a rule the variants are tried starting from one
 * rolled per block. Every cell of the block makes the same choice, so a rearranging rule conserves.
 * Wrap: the board's even part wraps (an odd last row or column sits out); walls: outside reads −1.
 */
function blockLines(s: GridShape, N: GridNames, prev: string): string[] {
  const { id } = N;
  const v = (name: string) => `${id}_${name}`;
  const L: string[] = [
    `float ${v('par')} = step(1.5, ${v('me')}.b);`,
    `vec2 ${v('W')} = floor(${v('res')} * 0.5) * 2.0;`,
    `vec2 ${v('org')} = floor((${v('cell')} - ${v('par')}) * 0.5) * 2.0 + ${v('par')};`,
    `vec2 ${v('q')} = ${v('cell')} - ${v('org')};`,
    `float ${v('qi')} = ${v('q')}.x + (1.0 - ${v('q')}.y) * 2.0;`,
    `float ${v('live')} = step(${v('cell')}.x, ${v('W')}.x - 0.5) * step(${v('cell')}.y, ${v('W')}.y - 0.5);`,
    // The block's dice are keyed by its corner, wrapped: a block across the seam has one corner, not two.
    `vec2 ${v('key')} = mod(${v('org')}, ${v('W')});`,
  ];
  for (let q = 0; q < 4; q++) {
    const [cx, cy] = blockCorner(q);
    const c = `${v('org')} + ${off(cx, cy)}`;
    if (s.wrap) L.push(`float ${v('b' + q)} = floor(texture2D(${prev}, (mod(${c}, ${v('W')}) + 0.5) / ${v('res')}).r + 0.5);`);
    else {
      L.push(`vec2 ${v('p' + q)} = ${c};`);
      L.push(`float ${v('b' + q)} = (${v('p' + q)}.x < 0.0 || ${v('p' + q)}.y < 0.0 || ${v('p' + q)}.x > ${v('W')}.x - 0.5 || ${v('p' + q)}.y > ${v('W')}.y - 0.5) ? -1.0 : floor(texture2D(${prev}, (${v('p' + q)} + 0.5) / ${v('res')}).r + 0.5);`);
    }
  }
  L.push(`float ${v('next')} = ${v('s')};`, `float ${v('done')} = 0.0;`);
  s.blocks.filter(r => !r.off).forEach((r, j) => {
    const vars = blockVariants(r);
    const n = vars.length;
    // The variant tried first, and the chance, rolled once per block and step.
    L.push(`float ${v(`o${j}`)} = floor(grHash(vec3(${v('key')}, ${FRAME} + ${f(31 + j * 2)})) * ${f(n)});`);
    const dice = r.chance < 1 ? ` * step(grHash(vec3(${v('key')}, ${FRAME} + ${f(32 + j * 2)})), ${f(r.chance)})` : '';
    L.push(`float ${v(`best${j}`)} = 0.0;`, `float ${v(`pick${j}`)} = -1.0;`);
    vars.forEach(({ before }, k) => {
      const tests = before.map((spec, q) => specTest(spec, v('b' + q))).filter((t): t is string => !!t);
      L.push(`float ${v(`m${j}_${k}`)} = (${tests.length ? tests.join(' && ') : 'true'}) ? ${f(n)} - mod(${f(k)} - ${v(`o${j}`)} + ${f(n)}, ${f(n)}) : 0.0;`);
      L.push(`if (${v(`m${j}_${k}`)} > ${v(`best${j}`)}) { ${v(`best${j}`)} = ${v(`m${j}_${k}`)}; ${v(`pick${j}`)} = ${f(k)}; }`);
    });
    const pickAfter = (q: number) => vars.reduceRight((acc, { after }, k) => {
      const val = after[q] === SAME ? v('s') : f(after[q]);
      return k === vars.length - 1 ? val : `(${v(`pick${j}`)} < ${f(k + 0.5)} ? ${val} : ${acc})`;
    }, '');
    const byPos = `(${v('qi')} < 0.5 ? ${pickAfter(0)} : (${v('qi')} < 1.5 ? ${pickAfter(1)} : (${v('qi')} < 2.5 ? ${pickAfter(2)} : ${pickAfter(3)})))`;
    L.push(`if (${v('done')} < 0.5 && ${v(`best${j}`)}${dice} > 0.5) { ${v('next')} = ${byPos}; ${v('done')} = 1.0; }`);
  });
  L.push(`${v('next')} = clamp(${v('next')}, 0.0, ${v('top')});`);
  return L;
}

function smoothStep(s: GridShape, N: GridNames, read: (d: string) => string, image: string | undefined): string[] {
  const { id, P } = N;
  const v = (name: string) => `${id}_${name}`;
  const L: string[] = [`float ${v('u')} = ${v('me')}.r;`, `float ${v('v')} = ${v('me')}.g;`];
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  MOORE_OFFSETS.forEach(([dx, dy], i) => L.push(`vec4 ${v('r' + names[i])} = ${read(off(dx, dy))};`));
  const sum = (ks: string[], c: 'r' | 'g') => ks.map(k => `${v('r' + k)}.${c}`).join(' + ');
  L.push(
    `float ${v('edgeU')} = ${sum(['N', 'E', 'S', 'W'], 'r')};`,
    `float ${v('edgeV')} = ${sum(['N', 'E', 'S', 'W'], 'g')};`,
    `float ${v('cornU')} = ${sum(['NE', 'SE', 'SW', 'NW'], 'r')};`,
    `float ${v('cornV')} = ${sum(['NE', 'SE', 'SW', 'NW'], 'g')};`,
    `float ${v('lapU')} = 0.2 * ${v('edgeU')} + 0.05 * ${v('cornU')} - ${v('u')};`,
    `float ${v('lapV')} = 0.2 * ${v('edgeV')} + 0.05 * ${v('cornV')} - ${v('v')};`,
    `float ${v('nu')} = ${v('u')};`,
    `float ${v('nv')} = ${v('v')};`,
  );
  if (s.template === 'diffusion') {
    L.push(`${v('nu')} = mix(${v('u')}, ${v('edgeU')} * 0.25, ${P('spread')}) * (1.0 - ${P('decay')});`);
  } else if (s.template === 'waves') {
    L.push(
      `${v('nu')} = (2.0 * ${v('u')} - ${v('v')} + ${P('waveSpeed')} * 0.5 * (${v('edgeU')} - 4.0 * ${v('u')})) * ${P('damping')};`,
      `${v('nv')} = ${v('u')};`,
    );
  } else if (s.template === 'reaction') {
    L.push(
      // Red keeps 1 − A, not A: A sits near 1, where half floats are coarse (steps of 1/2048), and Feed's
      // f × (1 − A) would round away. 1 − A near 0 keeps its precision (the Passes 4 example does the same).
      `float ${v('A')} = 1.0 - ${v('u')};`,
      `float ${v('abb')} = ${v('A')} * ${v('v')} * ${v('v')};`,
      `${v('nu')} = 1.0 - clamp(${v('A')} - ${P('diffA')} * ${v('lapU')} - ${v('abb')} + ${P('feed')} * (1.0 - ${v('A')}), 0.0, 1.0);`,
      `${v('nv')} = clamp(${v('v')} + ${P('diffB')} * ${v('lapV')} + ${v('abb')} - (${P('kill')} + ${P('feed')}) * ${v('v')}, 0.0, 1.0);`,
    );
  } else {
    // Your own update: the names it may use (gridRules/spec.ts SMOOTH_NAMES), in a block of their own.
    L.push(
      '{',
      `    float u = ${v('u')}; float v = ${v('v')};`,
      `    float avg_u = (${v('edgeU')} + ${v('cornU')}) * 0.125; float avg_v = (${v('edgeV')} + ${v('cornV')}) * 0.125;`,
      `    float lap_u = ${v('lapU')}; float lap_v = ${v('lapV')};`,
      `    float n = ${v('rN')}.r; float s = ${v('rS')}.r; float e = ${v('rE')}.r; float w = ${v('rW')}.r;`,
      `    float x = (${v('cell')}.x + 0.5) / ${v('res')}.x; float y = (${v('cell')}.y + 0.5) / ${v('res')}.y;`,
      `    float t = u_time; float rnd = ${v('h')};`,
      `    float a = ${P('knobA')}; float b = ${P('knobB')}; float c = ${P('knobC')}; float d = ${P('knobD')};`,
      `    ${v('nu')} = clamp(${floatLiterals(s.customU.trim() || 'u')}, -1000.0, 1000.0);`,
      `    ${v('nv')} = clamp(${floatLiterals(s.customV.trim() || 'v')}, -1000.0, 1000.0);`,
      '}',
    );
  }
  L.push(`if (${v('tick')} < 0.5) { ${v('nu')} = ${v('u')}; ${v('nv')} = ${v('v')}; }`);
  // The start.
  const D = P('density');
  const disc = `(length(${v('cell')} + 0.5 - ${v('res')} * 0.5) < min(${v('res')}.x, ${v('res')}.y) * 0.08 ? 1.0 : 0.0)`;
  const lum = image ? `dot(texture2D(${image}, (${v('cell')} + 0.5) / ${v('res')}).rgb, vec3(0.2126, 0.7152, 0.0722))` : null;
  const blob = `(grHash(vec3(floor(${v('cell')} / 6.0), ${FRAME} + ${P('seed')} * 1013.0 + 3.0)) < ${D} * 0.04 ? 1.0 : 0.0)`;
  let su: string, sv: string;
  if (s.template === 'reaction') {
    const b = s.start === 'empty' ? '0.0' : s.start === 'centre' ? disc : s.start === 'image' && lum ? lum : blob;
    su = '0.0'; sv = b; // A = 1 everywhere (red keeps 1 − A)
  } else {
    const a = s.start === 'empty' ? '0.0' : s.start === 'centre' ? disc : s.start === 'image' && lum ? lum
      : s.template === 'waves' ? `(${v('h')} < ${D} * 0.02 ? 1.0 : 0.0)` : `(${v('h')} < ${D} ? 1.0 : 0.0)`;
    su = a; sv = s.template === 'waves' ? a : '0.0';
  }
  L.push(`if (${v('fresh')} > 0.5) { ${v('nu')} = ${su}; ${v('nv')} = ${sv}; }`);
  // The brush sets the value under it (Reaction: the second chemical).
  if (s.template === 'reaction') L.push(`if (${v('in')} > 0.5) ${v('nv')} = clamp(${P('brushState')}, 0.0, 1.0);`);
  else L.push(`if (${v('in')} > 0.5) ${v('nu')} = ${P('brushState')};`);
  L.push(`vec3 ${v('out')} = vec3(${v('nu')}, ${v('nv')}, ${v('phase')});`, `float ${v('outA')} = ${f(gridSignature(s))};`);
  return L;
}

// ── The view: the node's outputs ────────────────────────────────────────────────────────────────

export interface GridView { code: string; outputVars: Record<string, string> }

/** What the Color output shows (the `view` param): the coloured board, or one of its numbers as grey. */
export type GridViewMode = 'colour' | 'state' | 'age' | 'neighbours';
export const GRID_VIEWS: Array<{ value: GridViewMode; label: string; hint: string }> = [
  { value: 'colour', label: 'Colours', hint: 'The board coloured by state, afterglow and age (the default).' },
  { value: 'state', label: 'State', hint: 'Each cell\'s state as grey: 0 black, the top state white (Smooth: its value).' },
  { value: 'age', label: 'Age', hint: 'A live cell\'s age, or a dead cell\'s afterglow, as grey (Smooth: the second value).' },
  { value: 'neighbours', label: 'Neighbours', hint: 'How many of the 8 cells round each cell are on, as grey (Smooth: their average value).' },
];
export const gridViewMode = (v: unknown): GridViewMode => (GRID_VIEWS.some(x => x.value === v) ? v as GridViewMode : 'colour');

/**
 * The live-neighbour count round this pixel's cell (Smooth: the neighbours' average u), as one
 * expression: it costs its texture reads only where something reads it. Counted over the 8 (von
 * Neumann: 4) cells; a Radius rule's neighbours are shown as the 8 round it.
 */
export function gridNeighboursExpr(s: GridShape, board: string): string {
  const res = `floor(u_resolution * ${f(s.scale)})`;
  const at = (dx: number, dy: number) => `texture2D(${board}, (floor(vUv * ${res}) + ${off(dx, dy)} + 0.5) / ${res}).r`;
  const offs = s.neighbourhood === 'vonNeumann' ? VON_NEUMANN_OFFSETS : MOORE_OFFSETS;
  if (!isDiscrete(s.type)) return `((${offs.map(([dx, dy]) => at(dx, dy)).join(' + ')}) / ${f(offs.length)})`;
  return `(${offs.map(([dx, dy]) => `(1.0 - step(0.5, abs(${at(dx, dy)} - 1.0)))`).join(' + ')})`;
}

/** The board at this pixel, coloured. `board` is the board's sampler (this frame's), `pic` the coloured picture's. */
export function gridViewGLSL(s: GridShape, N: GridNames, board: string | undefined, pic?: string, view: GridViewMode = 'colour'): GridView {
  const { id, P, C } = N;
  const v = (name: string) => `${id}_${name}`;
  if (!board) {
    return {
      code: `    vec3 ${v('col')} = vec3(0.0);\n    float ${v('st')} = 0.0;\n`,
      outputVars: { color: v('col'), state: v('st'), alive: v('st'), age: v('st'), value: v('st'), neighbours: v('st') },
    };
  }
  const L: string[] = [`vec4 ${v('b')} = texture2D(${board}, vUv);`];
  if (isDiscrete(s.type)) {
    L.push(`float ${v('st')} = floor(${v('b')}.r + 0.5);`, `float ${v('age')} = clamp(${v('b')}.g, 0.0, 1.0);`);
    const dead = `mix(${C('color0')}, ${C('glowColor')}, ${v('age')})`;
    const live = `mix(${C('color1')}, ${C('oldColor')}, clamp(${P('ageFade')} * ${v('age')}, 0.0, 1.0))`;
    if (s.type === 'stages') {
      L.push(
        `float ${v('N')} = max(floor(${P('states')} + 0.5), 2.0);`,
        `vec3 ${v('col')} = ${v('st')} < 0.5 ? ${dead} : (${v('st')} < 1.5 ? ${live} : mix(${C('color2')}, ${C('color3')}, clamp((${v('st')} - 2.0) / max(${v('N')} - 3.0, 1.0), 0.0, 1.0)));`,
        `float ${v('val')} = ${v('st')} / max(${v('N')} - 1.0, 1.0);`,
      );
    } else if (s.type === 'count') {
      L.push(`vec3 ${v('col')} = ${v('st')} > 0.5 ? ${live} : ${dead};`, `float ${v('val')} = clamp(${v('st')}, 0.0, 1.0);`);
    } else {
      // Patterns and Blocks: a colour per state (states past the eighth take the eighth's).
      const pal = Array.from({ length: 7 }, (_, k) => k + 1).reverse()
        .reduce((acc, k) => `(${v('st')} < ${f(k - 0.5)} ? ${k === 1 ? dead : `${C(`color${k - 1}`)}`} : ${acc})`, C('color7'));
      L.push(`vec3 ${v('col')} = ${v('st')} > 0.5 && ${v('st')} < 1.5 ? ${live} : ${pal};`, `float ${v('val')} = ${v('st')} / max(${P('states')} - 1.0, 1.0);`);
    }
    L.push(`float ${v('alive')} = step(0.5, ${v('st')}) - step(1.5, ${v('st')});`);
  } else {
    // The shade the ramp is read at: Waves' still water is the middle (Contrast scales the ripples round it).
    const shade = s.template === 'waves' ? `${v('b')}.r * ${P('gain')} * 0.5 + 0.5` : s.template === 'reaction' ? `${v('b')}.g * 3.0 * ${P('gain')}` : `${v('b')}.r * ${P('gain')}`;
    L.push(
      `float ${v('st')} = ${s.template === 'reaction' ? `1.0 - ${v('b')}.r` : `${v('b')}.r`};`,
      `float ${v('age')} = ${v('b')}.g;`,
      `float ${v('val')} = clamp(${shade}, 0.0, 1.0);`,
      `vec3 ${v('col')} = ${v('val')} < 0.3333 ? mix(${C('color0')}, ${C('color1')}, ${v('val')} * 3.0) : (${v('val')} < 0.6667 ? mix(${C('color1')}, ${C('color2')}, ${v('val')} * 3.0 - 1.0) : mix(${C('color2')}, ${C('color3')}, ${v('val')} * 3.0 - 2.0));`,
      `float ${v('alive')} = clamp(${v('st')}, 0.0, 1.0);`,
    );
  }
  const neighbours = gridNeighboursExpr(s, board);
  // Another view: one of the board's numbers as grey instead of the colours (code only then).
  let color = v('col');
  if (view !== 'colour') {
    const top = s.type === 'count' ? '1.0' : s.type === 'smooth' ? '1.0' : `max(${P('states')} - 1.0, 1.0)`;
    const maxN = s.neighbourhood === 'vonNeumann' ? 4 : 8;
    const g = view === 'state' ? (isDiscrete(s.type) ? `clamp(${v('st')} / ${top}, 0.0, 1.0)` : `clamp(${v('st')}, 0.0, 1.0)`)
      : view === 'age' ? `clamp(${v('age')}, 0.0, 1.0)`
      : isDiscrete(s.type) ? `${neighbours} / ${f(maxN)}` : `clamp(${neighbours}, 0.0, 1.0)`;
    L.push(`vec3 ${v('view')} = vec3(${g});`);
    color = v('view');
  }
  return {
    code: L.map(l => `    ${l}\n`).join(''),
    outputVars: {
      color, state: v('st'), alive: v('alive'), age: v('age'), value: v('val'), neighbours,
      texture: pic ?? board, board,
    },
  };
}
