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
  if (isDiscrete(s.type)) L.push(...discreteStep(s, N, read, image, sig));
  else L.push(...smoothStep(s, N, read, image));
  return L.map(l => `    ${l}\n`).join('');
}

/** The seed for a whole-number board: 1 where the start says a cell is on. */
function discreteSeed(s: GridShape, N: GridNames, image?: string): string {
  const { id, P } = N;
  const noise = `(${id}_h < ${P('density')} ? 1.0 : 0.0)`;
  if (s.start === 'empty') return '0.0';
  if (s.start === 'centre') return `(length(${id}_cell + 0.5 - ${id}_res * 0.5) < min(${id}_res.x, ${id}_res.y) * 0.15 ? ${noise} : 0.0)`;
  if (s.start === 'image' && image) return `(dot(texture2D(${image}, (${id}_cell + 0.5) / ${id}_res).rgb, vec3(0.2126, 0.7152, 0.0722)) > 0.5 ? 1.0 : 0.0)`;
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

function discreteStep(s: GridShape, N: GridNames, read: (d: string) => string, image: string | undefined, sig: number): string[] {
  const { id, P } = N;
  const v = (name: string) => `${id}_${name}`;
  const L: string[] = [`float ${v('s')} = floor(${v('me')}.r + 0.5);`, `float ${v('g')} = ${v('me')}.g;`];
  L.push(...countLines(s, N, read));
  // Born / survive: bit `count` of the masks (Moore, von Neumann), or a range (radius).
  if (s.neighbourhood === 'radius') {
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
  if (s.type === 'stages') {
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
  L.push(
    `float ${v('ng')} = 0.0;`,
    `if (${v('next')} > 0.5 && ${v('next')} < 1.5) ${v('ng')} = (${v('s')} > 0.5 && ${v('s')} < 1.5) ? min(1.0, ${v('g')} + ${P('ageRate')}) : 0.0;`,
    `else if (${v('next')} < 0.5) ${v('ng')} = ${v('s')} > 0.5 ? ${P('afterglow')} : ${v('g')} * ${P('afterglow')};`,
    `if (${v('tick')} < 0.5) { ${v('next')} = ${v('s')}; ${v('ng')} = ${v('g')}; }`,
    `if (${v('fresh')} > 0.5) { ${v('next')} = ${discreteSeed(s, N, image)}; ${v('ng')} = 0.0; }`,
    `float ${v('roll')} = grHash(vec3(${v('cell')} + 0.5, ${FRAME} + 7919.0));`,
    `if (${v('in')} > 0.5 && ${v('roll')} < ${P('brushFill')}) { ${v('next')} = clamp(floor(${P('brushState')} + 0.5), 0.0, ${v('top')}); ${v('ng')} = 0.0; }`,
  );
  if (!s.wrap) {
    // Walls: the outer ring of cells stays empty, so a read past the edge (which sees the edge) reads an empty cell.
    L.push(
      `float ${v('inside')} = step(0.5, ${v('cell')}.x) * step(0.5, ${v('cell')}.y) * step(${v('cell')}.x, ${v('res')}.x - 1.5) * step(${v('cell')}.y, ${v('res')}.y - 1.5);`,
      `${v('next')} = ${v('next')} * ${v('inside')};`,
      `${v('ng')} = ${v('ng')} * ${v('inside')};`,
    );
  }
  L.push(`vec3 ${v('out')} = vec3(${v('next')}, ${v('ng')}, ${v('phase')});`, `float ${v('outA')} = ${f(sig)};`);
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

/** The board at this pixel, coloured. `board` is the board's sampler (this frame's), `pic` the coloured picture's. */
export function gridViewGLSL(s: GridShape, N: GridNames, board: string | undefined, pic?: string): GridView {
  const { id, P, C } = N;
  const v = (name: string) => `${id}_${name}`;
  if (!board) {
    return {
      code: `    vec3 ${v('col')} = vec3(0.0);\n    float ${v('st')} = 0.0;\n`,
      outputVars: { color: v('col'), state: v('st'), alive: v('st'), age: v('st'), value: v('st') },
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
  return {
    code: L.map(l => `    ${l}\n`).join(''),
    outputVars: {
      color: v('col'), state: v('st'), alive: v('alive'), age: v('age'), value: v('val'),
      texture: pic ?? board, board,
    },
  };
}
