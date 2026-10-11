/**
 * Splat modifiers (docs/splat-scene.md "Per-splat modifiers"; docs/depth-and-splats-plan.md phase 3): node chains that
 * change every splat of a Splat Scene before it is drawn, the way an Agents rule runs once per walker.
 *
 * The wire type `splat` carries one splat's state, as a GLSL mat3:
 *  - column 0: its centre in the scene (after Position / Rotation / Scale);
 *  - column 1: its colour (linear, may go above 1 for glow);
 *  - column 2: (opacity, size multiplier, dot radius in pixels: 0 draws the soft Gaussian, above 0 a crisp dot).
 * A chain starts from the splat as loaded (any splat input left unwired) and ends in the Splat Scene's Modifier input.
 * Splat Attributes reads the state (and the splat's fixed facts: its place in the scan, index, a random number) as
 * ordinary floats and vectors, so Noise, Transform, maths and Expression Blocks work on them; Set Splat writes
 * results back. The recipe nodes (Dissolve, Explode, Wave, Colour, Crop, Size & Opacity, Points) each do one look.
 *
 * The chain is compiled into the scene's modifier program (compiler/splatGraph.ts): a program of the picture's kind
 * drawn over one texel per splat, whose prelude reads the splat and sets the per-splat globals (`sp_*`) the nodes
 * read. Nodes compiled there carry `params.__splatProgram`; anywhere else (a node's eye preview) they read a pretend
 * splat at the pixel, so a preview shows something sensible instead of failing.
 *
 * Every slider is an ordinary param: a live uniform shared with the picture, so dragging, Play mappings and keyframes
 * never recompile.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';

export const SPLAT_TYPE = 'splat' as const;
export const SPLAT_MOD_OUT_TYPE = 'splatModOut';
export const SPLAT_CATEGORY = 'Splats';

/** The state a fresh splat has outside the modifier program (a node's preview): a grey splat at the pixel. */
const PRETEND_STATE = 'mat3(vec3(g_uv, 0.0), vec3(0.8), vec3(1.0, 1.0, 0.0))';

/** The per-splat globals the modifier program's prelude sets, or a pretend splat at the pixel elsewhere. */
export function splatContext(node: GraphNode) {
  const prog = node.params.__splatProgram === true;
  return prog
    ? { base: 'sp_base', local: 'sp_local', index: 'sp_index', rand: 'sp_rand', count: 'sp_count', radius: 'sp_radius', origin: 'sp_T', mid: 'sp_mid', midW: 'sp_midW', unit: 'sp_unit' }
    : { base: PRETEND_STATE, local: 'vec3(g_uv, 0.0)', index: '0.0', rand: 'fract(sin(dot(g_uv, vec2(12.9898, 78.233))) * 43758.5453)', count: '1.0', radius: '0.02', origin: 'vec3(0.0)', mid: 'vec3(0.0)', midW: 'vec3(0.0)', unit: '1.0' };
}

// ── Relative to the scan ────────────────────────────────────────────────────
//
// A moving or cutting node can measure in the scan's own size instead of scene units (`relative`, on for new nodes):
// its place in the scan is taken from the scan's middle and divided by the scan's size (its core radius × Scale), and
// its distances (Distance, Amplitude, Drift) are multiplied by it. So Noise scale 1.5 is "a patch a radius / 1.5
// across" on a small object and on a whole street alike. Graphs saved before it keep measuring in scene units: their
// nodes load with `relative` off (SPLAT_RELATIVE_VERSION's migration).

/** The schema version that brought `relative`: older saved nodes load with it off, so they look as they did. */
export const SPLAT_RELATIVE_VERSION = 2;

/** Version, migration and the param for a node that can measure relative to the scan. */
const relativeParam = {
  version: SPLAT_RELATIVE_VERSION,
  migrateParams: (params: Record<string, unknown>, fromVersion: number) => (fromVersion < SPLAT_RELATIVE_VERSION && !('relative' in params) ? { ...params, relative: false } : params),
} as const;
const RELATIVE_DEF = { label: 'Relative to the scan', type: 'bool' as const, hint: 'On: sizes and distances are in the scan\'s own size (its radius), so the look is the same on a small object and on a whole place. Off: scene units.' };
const RELATIVE_DEFAULTS = { relative: true, _schemaVersion: SPLAT_RELATIVE_VERSION };

/** Whether a node measures relative to the scan (absent: off, as before). */
export const splatRelative = (node: GraphNode) => node.params.relative === true;

/** The node's place in the scan: relative (from the middle, in scan sizes) or as it is. */
const placeIn = (node: GraphNode, c: ReturnType<typeof splatContext>) => (splatRelative(node) ? `((${c.local} - ${c.mid}) / ${c.unit})` : c.local);
/** A distance in the node's units, in scene units. */
const scaled = (node: GraphNode, c: ReturnType<typeof splatContext>, x: string) => (splatRelative(node) ? `(${x} * ${c.unit})` : x);
/** The point the scan moves round: its middle (relative) or its origin. */
const pivot = (node: GraphNode, c: ReturnType<typeof splatContext>) => (splatRelative(node) ? c.midW : c.origin);

/** Shared helpers: 3D value noise (0–1, stretched to fill the range), a vec3 of it, a hash and a hue turn. */
export const SPLAT_GLSL = `float spHash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}
float spNoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(spHash31(i), spHash31(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(spHash31(i + vec3(0.0, 1.0, 0.0)), spHash31(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(spHash31(i + vec3(0.0, 0.0, 1.0)), spHash31(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(spHash31(i + vec3(0.0, 1.0, 1.0)), spHash31(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float spFbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 3; k++) { s += a * spNoise3(p); p = p * 2.03 + 17.1; a *= 0.5; }
    // Three octaves of value noise cluster round the middle: stretch them to fill 0–1.
    return clamp((s / 0.875 - 0.5) * 2.2 + 0.5, 0.0, 1.0);
}
vec3 spNoise33(vec3 p) {
    return vec3(spNoise3(p), spNoise3(p + vec3(31.7, 11.3, 5.9)), spNoise3(p + vec3(63.1, 47.9, 23.3)));
}
vec3 spHueTurn(vec3 c, float a) {
    vec3 y = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c;
    float h = atan(y.z, y.y) + a, ch = length(y.yz);
    return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * vec3(y.x, ch * cos(h), ch * sin(h));
}
mat3 spRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }`;

// ── Plain-JS mirrors (tested; the GLSL below says the same) ─────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * Dissolve at one splat: its field value `f` (0–1) against the sweep `amount` (0 all there … 1 all gone). The
 * threshold runs from just below −edge to just past 1 + soft, so at 0 nothing fades or glows and at 1 everything is
 * gone. `vis` is how much of the splat is left (fades over `soft` below the threshold), `edge` the glow band round it.
 */
export function dissolveAt(f: number, amount: number, soft: number, edge: number): { vis: number; edge: number; threshold: number } {
  const threshold = -(edge + 1e-3) + (1 + soft + edge + 2e-3) * amount;
  const d = f - threshold;
  const vis = soft > 0 ? smooth(-soft, 0, d) : d >= 0 ? 1 : 0;
  const e = edge > 1e-4 ? 1 - smooth(0, Math.max(edge, 1e-4), Math.abs(d)) : 0;
  return { vis, edge: e, threshold };
}

/** Explode at one splat: how far out it is (0 home … 1 all the way), from the sweep, its random number and Return home. */
export function explodeAt(amount: number, rand: number, stagger: number, returnHome: number): number {
  const out = smooth(0, 1, clamp01(amount * (1 + stagger) - rand * stagger));
  const home = smooth(0, 1, clamp01(returnHome * (1 + stagger) - (1 - rand) * stagger));
  return out * (1 - home);
}

// ── Shared parts of the definitions ─────────────────────────────────────────

const splatIn = { splat: { type: SPLAT_TYPE, label: 'Splat', hint: 'The splat so far: from Splat Attributes or another modifier. Unwired: the splat as loaded.' } } as const;
const splatOut = { splat: { type: SPLAT_TYPE, label: 'Splat', hint: 'The changed splat: into the Splat Scene\'s Modifier, or another modifier.' } } as const;
const timeIn = { time: { type: 'float' as const, label: 'Time', hint: 'Unwired: the clock.' } };

/** The state wired in, copied (so later nodes see this point of the chain). */
const head = (node: GraphNode, v: Record<string, string>) => `    mat3 ${node.id}_i = ${v.splat ?? splatContext(node).base};\n`;

/** Moving nodes: the params that move the splats (non-zero) — the engine sorts by moved positions while any is. */
export type SplatMoveGate = { always: true } | { params: string[] };

const SECTION = 'Look';

// ── Splat Attributes ────────────────────────────────────────────────────────

export const SplatAttributesNode: NodeDefinition = {
  type: 'splatAttributes',
  label: 'Splat Attributes',
  category: SPLAT_CATEGORY,
  aliases: ['Splat in', 'Per splat', 'Splat position', 'Splat colour'],
  description: 'One splat of a Splat Scene, as numbers: where it is, its colour, opacity and size, its place in the scan, its index and a random number of its own. Wire them through any nodes (Noise, Transform, maths, Expression Blocks) into Set Splat, then into the Splat Scene\'s Modifier: the chain runs once for every splat.',
  inputs: { ...splatIn },
  outputs: {
    position: { type: 'vec3', label: 'Position', hint: 'Where the splat is in the scene (after the Splat Scene\'s Position, Rotation and Scale, and any modifier before).' },
    local: { type: 'vec3', label: 'In the scan', hint: 'Where it sits in the scan itself, in scene units with +Y up: it moves with the scan, so noise read here sticks to it.' },
    color: { type: 'vec3', label: 'Color', hint: 'Its colour (0–1).' },
    opacity: { type: 'float', label: 'Opacity', hint: 'Its opacity (0–1).' },
    size: { type: 'float', label: 'Size', hint: 'Its size multiplier (1 as loaded).' },
    radius: { type: 'float', label: 'Radius', hint: 'How big it is in the scene: its Gaussian\'s spread, times Size.' },
    index: { type: 'float', label: 'Index', hint: 'Its number, 0 to Count − 1.' },
    random: { type: 'float', label: 'Random', hint: 'A 0–1 number of its own that never changes.' },
    count: { type: 'float', label: 'Count', hint: 'How many splats are drawn.' },
  },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node, v) => {
    const c = splatContext(node), id = node.id;
    return {
      code: head(node, v),
      outputVars: {
        position: `${id}_i[0]`, local: c.local, color: `${id}_i[1]`, opacity: `${id}_i[2].x`, size: `${id}_i[2].y`,
        radius: `(${c.radius} * ${id}_i[2].y)`, index: c.index, random: c.rand, count: c.count,
      },
    };
  },
};

// ── Set Splat ───────────────────────────────────────────────────────────────

export const SetSplatNode: NodeDefinition = {
  type: 'splatSet',
  label: 'Set Splat',
  category: SPLAT_CATEGORY,
  aliases: ['Splat out', 'Write splat', 'Modify splat'],
  description: 'Changes one splat: wire a new Position, an Offset to move it by, a Color, an Opacity, a Size multiplier or a Dot size. What you leave unwired stays as it was. Amount blends from the splat as it came in (0) to the changes (1).',
  inputs: {
    ...splatIn,
    position: { type: 'vec3', label: 'Position', hint: 'Where it goes (in the scene). Unwired: where it was.' },
    offset: { type: 'vec3', label: 'Offset', hint: 'Added to its position: a move.' },
    color: { type: 'vec3', label: 'Color', hint: 'Its new colour (above 1 glows).' },
    opacity: { type: 'float', label: 'Opacity', hint: 'Its new opacity (0–1).' },
    size: { type: 'float', label: 'Size', hint: 'Its new size multiplier (1 as loaded, 0 hides it).' },
    dot: { type: 'float', label: 'Dot size', hint: 'Above 0: draw it as a crisp round dot this many pixels across (times Size). 0: the soft Gaussian.' },
  },
  outputs: { ...splatOut },
  defaultParams: { amount: 1 },
  paramDefs: {
    amount: { label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the change to use: 0 leaves the splat as it came in.' },
  },
  generateGLSL: (node, v) => {
    const id = node.id;
    const k = p(node.params.amount, 1);
    return {
      code: head(node, v) + [
        `    vec3 ${id}_p = ${v.position ?? `${id}_i[0]`}${v.offset ? ` + ${v.offset}` : ''};\n`,
        `    vec3 ${id}_c = ${v.color ?? `${id}_i[1]`};\n`,
        `    vec3 ${id}_l = vec3(${v.opacity ?? `${id}_i[2].x`}, ${v.size ?? `${id}_i[2].y`}, ${v.dot ?? `${id}_i[2].z`});\n`,
        `    float ${id}_k = clamp(${k}, 0.0, 1.0);\n`,
        `    mat3 ${id}_s = mat3(mix(${id}_i[0], ${id}_p, ${id}_k), mix(${id}_i[1], ${id}_c, ${id}_k), mix(${id}_i[2], ${id}_l, ${id}_k));\n`,
      ].join(''),
      outputVars: { splat: `${id}_s` },
    };
  },
};

// ── Dissolve ────────────────────────────────────────────────────────────────

export const SplatDissolveNode: NodeDefinition = {
  type: 'splatDissolve',
  label: 'Splat Dissolve',
  category: SPLAT_CATEGORY,
  aliases: ['Dissolve', 'Disintegrate', 'Burn away', 'Fade by noise'],
  description: 'Dissolves the scan by noise: as Amount sweeps from 0 to 1, a threshold moves through a noise field and the splats below it fade or shrink away, with a glowing edge. Wire your own 0–1 field into Field (height, a distance, a texture) to dissolve by that instead.',
  inputs: {
    ...splatIn,
    field: { type: 'float', label: 'Field', hint: 'A 0–1 value per splat to dissolve by: low values go first. Unwired: noise through the scan.' },
    ...timeIn,
  },
  outputs: { ...splatOut },
  defaultParams: { amount: 0.4, scale: 1.5, evolve: 0.1, softness: 0.08, edge: 0.06, edgeColor: [1, 0.45, 0.12], glow: 4, mode: 'both', drift: 0.25, ...RELATIVE_DEFAULTS },
  ...relativeParam,
  paramDefs: {
    amount: { label: 'Amount', type: 'float', min: 0, max: 1, step: 0.005, hint: '0: the whole scan. 1: all gone. Map it in Play, or keyframe it.' },
    relative: RELATIVE_DEF,
    scale: { label: 'Noise scale', type: 'float', min: 0.05, max: 20, step: 0.01, hint: 'How fine the noise is: small numbers dissolve in big patches.' },
    evolve: { label: 'Evolve', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How fast the noise changes over time (0: still).' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 0.5, step: 0.005, hint: 'How gradually a splat fades as the threshold passes it.' },
    edge: { label: 'Edge width', type: 'float', min: 0, max: 0.3, step: 0.005, section: SECTION, hint: 'How wide the glowing band round the threshold is (0: no edge).' },
    edgeColor: { label: 'Edge colour', type: 'vec3color', section: SECTION, hint: 'The glow\'s colour.' },
    glow: { label: 'Glow', type: 'float', min: 0, max: 20, step: 0.1, section: SECTION, hint: 'How bright the edge is (above 1 blooms).' },
    mode: { label: 'Splats go by', type: 'select', section: SECTION, hint: 'Fading (opacity), shrinking (size), or both.', options: [
      { value: 'both', label: 'Fading and shrinking' }, { value: 'fade', label: 'Fading' }, { value: 'shrink', label: 'Shrinking' },
    ] },
    drift: { label: 'Drift', type: 'float', min: -2, max: 2, step: 0.01, section: SECTION, hint: 'Going splats float up by this much (negative: fall) as they fade.' },
  },
  glslFunction: SPLAT_GLSL,
  generateGLSL: (node, v) => {
    const id = node.id, P = node.params, c = splatContext(node);
    const soft = p(P.softness, 0.08), edge = p(P.edge, 0.06);
    const mode = P.mode === 'fade' || P.mode === 'shrink' ? P.mode : 'both';
    const field = v.field ?? `spFbm3(${placeIn(node, c)} * ${p(P.scale, 1.5)} + vec3(0.0, ${id}_t, ${id}_t * 0.7))`;
    return {
      code: head(node, v) + [
        `    float ${id}_t = ${v.time ?? 'u_time'} * ${p(P.evolve, 0.1)};\n`,
        `    float ${id}_f = ${field};\n`,
        `    float ${id}_soft = max(${soft}, 0.0), ${id}_ew = max(${edge}, 0.0);\n`,
        `    float ${id}_d = ${id}_f - (-(${id}_ew + 1e-3) + (1.0 + ${id}_soft + ${id}_ew + 2e-3) * clamp(${p(P.amount, 0.4)}, 0.0, 1.0));\n`,
        `    float ${id}_vis = ${id}_soft > 0.0 ? smoothstep(-${id}_soft, 0.0, ${id}_d) : step(0.0, ${id}_d);\n`,
        `    float ${id}_e = ${id}_ew > 1e-4 ? 1.0 - smoothstep(0.0, ${id}_ew, abs(${id}_d)) : 0.0;\n`,
        `    mat3 ${id}_s = ${id}_i;\n`,
        `    ${id}_s[0] += vec3(0.0, ${scaled(node, c, p(P.drift, 0.25))} * (1.0 - ${id}_vis), 0.0);\n`,
        `    ${id}_s[1] += ${pv3(P.edgeColor, [1, 0.45, 0.12])} * (${p(P.glow, 4)} * ${id}_e);\n`,
        mode !== 'shrink' ? `    ${id}_s[2].x *= ${id}_vis;\n` : '',
        mode !== 'fade' ? `    ${id}_s[2].y *= ${id}_vis;\n` : '',
      ].join(''),
      outputVars: { splat: `${id}_s` },
    };
  },
};

// ── Explode / scatter ───────────────────────────────────────────────────────

export const SplatExplodeNode: NodeDefinition = {
  type: 'splatExplode',
  label: 'Splat Explode',
  category: SPLAT_CATEGORY,
  aliases: ['Explode', 'Scatter', 'Blow apart', 'Shatter', 'Return home'],
  description: 'Blows the scan apart from a point: Amount sends every splat out (each a little later than the last, by Stagger), Return home brings them back. Scatter mixes the straight-out direction with a random one; Spin swirls them round the vertical.',
  inputs: {
    ...splatIn,
    center: { type: 'vec3', label: 'Center', hint: 'Where they fly from, in the scene. Unwired: the Center sliders.' },
  },
  outputs: { ...splatOut },
  defaultParams: { amount: 0.5, distance: 1.5, center: [0, 0, 0], scatter: 0.35, stagger: 0.5, returnHome: 0, spin: 0.25, ...RELATIVE_DEFAULTS },
  ...relativeParam,
  paramDefs: {
    relative: RELATIVE_DEF,
    amount: { label: 'Amount', type: 'float', min: 0, max: 1, step: 0.005, hint: '0: every splat at home. 1: all the way out.' },
    returnHome: { label: 'Return home', type: 'float', min: 0, max: 1, step: 0.005, hint: 'Brings them back: 1 is home again, whatever Amount says.' },
    distance: { label: 'Distance', type: 'float', min: 0, max: 10, step: 0.01, hint: 'How far they fly, in scene units.' },
    center: { label: 'Center', type: 'vec3', min: -10, max: 10, step: 0.01, hint: 'Where they fly from.' },
    scatter: { label: 'Scatter', type: 'float', min: 0, max: 1, step: 0.01, hint: '0: straight out from the centre. 1: every splat its own random way.' },
    stagger: { label: 'Stagger', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How spread out in time they go and come back (0: all at once).' },
    spin: { label: 'Spin', type: 'float', min: -4, max: 4, step: 0.01, hint: 'Turns round the vertical as they fly, in turns.' },
  },
  glslFunction: SPLAT_GLSL,
  generateGLSL: (node, v) => {
    const id = node.id, P = node.params, c = splatContext(node);
    // Relative: the sliders' Center is from the scan's middle, in scan sizes (a wired Center stays in the scene).
    const center = v.center ?? (splatRelative(node) ? `(${c.midW} + ${pv3(P.center, [0, 0, 0])} * ${c.unit})` : pv3(P.center, [0, 0, 0]));
    const stagger = p(P.stagger, 0.5);
    return {
      code: head(node, v) + [
        `    vec3 ${id}_c = ${center};\n`,
        `    float ${id}_r = ${c.rand};\n`,
        `    float ${id}_st = clamp(${stagger}, 0.0, 1.0);\n`,
        `    float ${id}_out = smoothstep(0.0, 1.0, clamp(clamp(${p(P.amount, 0.5)}, 0.0, 1.0) * (1.0 + ${id}_st) - ${id}_r * ${id}_st, 0.0, 1.0));\n`,
        `    float ${id}_home = smoothstep(0.0, 1.0, clamp(clamp(${p(P.returnHome, 0)}, 0.0, 1.0) * (1.0 + ${id}_st) - (1.0 - ${id}_r) * ${id}_st, 0.0, 1.0));\n`,
        `    float ${id}_k = ${id}_out * (1.0 - ${id}_home);\n`,
        `    vec3 ${id}_rel = ${id}_i[0] - ${id}_c;\n`,
        `    vec3 ${id}_rnd = vec3(spHash31(vec3(${id}_r * 113.1, ${id}_r * 71.7, 1.3)), spHash31(vec3(${id}_r * 57.3, 2.9, ${id}_r * 91.1)), spHash31(vec3(3.7, ${id}_r * 37.9, ${id}_r * 19.3))) * 2.0 - 1.0;\n`,
        `    vec3 ${id}_dir = normalize(mix(${id}_rel / max(length(${id}_rel), 1e-4), ${id}_rnd / max(length(${id}_rnd), 1e-4), clamp(${p(P.scatter, 0.35)}, 0.0, 1.0)) + vec3(1e-5));\n`,
        `    vec3 ${id}_moved = ${id}_rel + ${id}_dir * (${scaled(node, c, p(P.distance, 1.5))} * ${id}_k * (0.6 + 0.8 * fract(${id}_r * 7.31)));\n`,
        `    mat3 ${id}_s = ${id}_i;\n`,
        `    ${id}_s[0] = ${id}_c + spRotY(${p(P.spin, 0.25)} * 6.2831853 * ${id}_k) * ${id}_moved;\n`,
      ].join(''),
      outputVars: { splat: `${id}_s` },
    };
  },
};

// ── Wave / wobble / twist ───────────────────────────────────────────────────

const AXES: Record<string, string> = { x: 'vec3(1.0, 0.0, 0.0)', y: 'vec3(0.0, 1.0, 0.0)', z: 'vec3(0.0, 0.0, 1.0)' };

export const SplatWaveNode: NodeDefinition = {
  type: 'splatWave',
  label: 'Splat Wave',
  category: SPLAT_CATEGORY,
  aliases: ['Wave', 'Wobble', 'Jiggle', 'Twist', 'Ripple'],
  description: 'Moves the splats: a Wave travelling through the scan, a noisy Wobble, or a Twist round the vertical. Amplitude 0 leaves them still.',
  inputs: { ...splatIn, ...timeIn },
  outputs: { ...splatOut },
  defaultParams: { mode: 'wave', amplitude: 0.06, frequency: 3, speed: 1.5, along: 'x', push: 'y', ...RELATIVE_DEFAULTS },
  ...relativeParam,
  paramDefs: {
    relative: RELATIVE_DEF,
    mode: { label: 'Kind', type: 'select', hint: 'Wave: a sine travelling along an axis. Wobble: noise in every direction. Twist: turns the scan more the higher up.', options: [
      { value: 'wave', label: 'Wave' }, { value: 'wobble', label: 'Wobble' }, { value: 'twist', label: 'Twist' },
    ] },
    amplitude: { label: 'Amplitude', type: 'float', min: 0, max: 1, step: 0.001, hint: 'How far they move (in scene units; for Twist, turns per unit of height).' },
    frequency: { label: 'Frequency', type: 'float', min: 0, max: 30, step: 0.01, hint: 'How many waves (or how fine the wobble) per unit.' },
    speed: { label: 'Speed', type: 'float', min: -10, max: 10, step: 0.01, hint: 'How fast it moves.' },
    along: { label: 'Travels along', type: 'select', showWhen: { param: 'mode', value: 'wave' }, hint: 'The direction the wave travels, in the scan (or out from its middle).', options: [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y (height)' }, { value: 'z', label: 'Z' }, { value: 'radial', label: 'Out from the middle' },
    ] },
    push: { label: 'Pushes', type: 'select', showWhen: { param: 'mode', value: 'wave' }, hint: 'Which way the splats move.', options: [
      { value: 'y', label: 'Up and down' }, { value: 'x', label: 'Sideways (X)' }, { value: 'z', label: 'In and out (Z)' }, { value: 'out', label: 'Out from the middle' },
    ] },
  },
  glslFunction: SPLAT_GLSL,
  generateGLSL: (node, v) => {
    const id = node.id, P = node.params, c = splatContext(node);
    const amp = p(P.amplitude, 0.06), freq = p(P.frequency, 3);
    const t = `(${v.time ?? 'u_time'} * ${p(P.speed, 1.5)})`;
    const at = placeIn(node, c), o = pivot(node, c), a = scaled(node, c, amp);
    const lines = [head(node, v), `    mat3 ${id}_s = ${id}_i;\n`];
    if (P.mode === 'wobble') {
      lines.push(`    ${id}_s[0] += (spNoise33(${at} * ${freq} + vec3(${t}, ${t} * 0.83, ${t} * 0.61)) * 2.0 - 1.0) * ${a};\n`);
    } else if (P.mode === 'twist') {
      // Turns per unit of height: relative, per scan size (an angle, so Amplitude isn't scaled).
      lines.push(`    ${id}_s[0] = ${o} + spRotY(${amp} * 6.2831853 * ${at}.y * sin(${t} + ${at}.y * ${freq} * 0.25)) * (${id}_i[0] - ${o});\n`);
    } else {
      const along = P.along === 'radial' ? `length(${at})` : `dot(${at}, ${AXES[String(P.along)] ?? AXES.x})`;
      const push = P.push === 'out' ? `normalize(${id}_i[0] - ${o} + vec3(1e-5))` : AXES[String(P.push)] ?? AXES.y;
      lines.push(`    ${id}_s[0] += ${push} * (${a} * sin(${along} * ${freq} - ${t}));\n`);
    }
    return { code: lines.join(''), outputVars: { splat: `${id}_s` } };
  },
};

// ── Colour ──────────────────────────────────────────────────────────────────

export const SplatColorNode: NodeDefinition = {
  type: 'splatColor',
  label: 'Splat Colour',
  category: SPLAT_CATEGORY,
  aliases: ['Splat color', 'Colour grade', 'Tint', 'Hue shift', 'Recolour'],
  description: 'Grades the scan\'s colours: turn the hue, change saturation, brightness and contrast, and tint it towards a colour.',
  inputs: { ...splatIn },
  outputs: { ...splatOut },
  defaultParams: { hue: 0, saturation: 1, brightness: 1, contrast: 1, tint: [1, 0.6, 0.3], tintAmount: 0 },
  paramDefs: {
    hue: { label: 'Hue', type: 'float', min: -180, max: 180, step: 0.5, hint: 'Turns every colour round the colour wheel, in degrees.' },
    saturation: { label: 'Saturation', type: 'float', min: 0, max: 3, step: 0.01, hint: '0 is grey, 1 as it was, above 1 more vivid.' },
    brightness: { label: 'Brightness', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Multiplies the colour (above 1 glows).' },
    contrast: { label: 'Contrast', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Pushes colours away from (or towards) middle grey.' },
    tint: { label: 'Tint', type: 'vec3color', hint: 'The colour to tint towards: it keeps each splat\'s brightness.' },
    tintAmount: { label: 'Tint amount', type: 'float', min: 0, max: 1, step: 0.01, hint: '0: no tint. 1: every splat is the tint at its own brightness.' },
  },
  glslFunction: SPLAT_GLSL,
  generateGLSL: (node, v) => {
    const id = node.id, P = node.params;
    return {
      code: head(node, v) + [
        `    vec3 ${id}_c = spHueTurn(${id}_i[1], radians(${p(P.hue, 0)}));\n`,
        `    float ${id}_y = dot(${id}_c, vec3(0.299, 0.587, 0.114));\n`,
        `    ${id}_c = mix(vec3(${id}_y), ${id}_c, ${p(P.saturation, 1)});\n`,
        `    ${id}_c = ((${id}_c - 0.5) * ${p(P.contrast, 1)} + 0.5) * ${p(P.brightness, 1)};\n`,
        `    ${id}_c = mix(${id}_c, ${pv3(P.tint, [1, 0.6, 0.3])} * dot(${id}_c, vec3(0.299, 0.587, 0.114)), clamp(${p(P.tintAmount, 0)}, 0.0, 1.0));\n`,
        `    mat3 ${id}_s = ${id}_i;\n`,
        `    ${id}_s[1] = max(${id}_c, 0.0);\n`,
      ].join(''),
      outputVars: { splat: `${id}_s` },
    };
  },
};

// ── Crop ────────────────────────────────────────────────────────────────────

export const SplatCropNode: NodeDefinition = {
  type: 'splatCrop',
  label: 'Splat Crop',
  category: SPLAT_CATEGORY,
  aliases: ['Crop', 'Clip', 'Clip plane', 'Reveal', 'Cut away', 'Section'],
  description: 'Keeps the splats inside a box, a sphere, or on one side of a plane, and hides the rest (fading or shrinking over Softness, with an optional glowing edge). Move the plane\'s Offset (or the box) with Play to reveal the scan section by section.',
  inputs: {
    ...splatIn,
    center: { type: 'vec3', label: 'Center', hint: 'The shape\'s centre (or a point on the plane). Unwired: the Center sliders.' },
  },
  outputs: { ...splatOut },
  defaultParams: { shape: 'plane', space: 'scan', keep: 'inside', center: [0, 0, 0], size: [1, 1, 1], normal: [0, 1, 0], offset: 0, softness: 0.05, edge: 0.03, edgeColor: [0.3, 0.8, 1], glow: 2, ...RELATIVE_DEFAULTS },
  ...relativeParam,
  paramDefs: {
    relative: RELATIVE_DEF,
    shape: { label: 'Shape', type: 'select', hint: 'What to cut with.', options: [
      { value: 'plane', label: 'Plane (keep one side)' }, { value: 'box', label: 'Box' }, { value: 'sphere', label: 'Sphere' },
    ] },
    space: { label: 'Measured in', type: 'select', hint: 'The scan: the cut turns and moves with it. The scene: it stays put while the scan moves through it.', options: [
      { value: 'scan', label: 'The scan' }, { value: 'scene', label: 'The scene' },
    ] },
    keep: { label: 'Keep', type: 'select', hint: 'Which side stays: inside the shape (below the plane), or outside it (above).', options: [
      { value: 'inside', label: 'Inside (below the plane)' }, { value: 'outside', label: 'Outside (above the plane)' },
    ] },
    center: { label: 'Center', type: 'vec3', min: -10, max: 10, step: 0.01, hint: 'The shape\'s centre, or a point on the plane.' },
    size: { label: 'Size', type: 'vec3', min: 0, max: 10, step: 0.01, showWhen: { param: 'shape', value: ['box', 'sphere'] }, hint: 'The box\'s half sizes (X, Y, Z); a sphere uses X as its radius.' },
    normal: { label: 'Plane faces', type: 'vec3', min: -1, max: 1, step: 0.01, showWhen: { param: 'shape', value: 'plane' }, hint: 'The plane\'s direction: (0, 1, 0) keeps what is below a level.' },
    offset: { label: 'Offset', type: 'float', min: -5, max: 5, step: 0.005, hint: 'Moves the plane along its direction (or grows the box and sphere): sweep it to reveal.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 1, step: 0.005, hint: 'How gradually splats fade across the cut.' },
    edge: { label: 'Edge width', type: 'float', min: 0, max: 0.5, step: 0.005, section: SECTION, hint: 'A glowing band along the cut (0: none).' },
    edgeColor: { label: 'Edge colour', type: 'vec3color', section: SECTION, hint: 'The band\'s colour.' },
    glow: { label: 'Glow', type: 'float', min: 0, max: 20, step: 0.1, section: SECTION, hint: 'How bright the band is.' },
  },
  generateGLSL: (node, v) => {
    const id = node.id, P = node.params, c = splatContext(node);
    // Relative: measured from the scan's middle in scan sizes (Size 1 is the whole scan; Offset −1 … 1 sweeps through it).
    const rel = splatRelative(node);
    const at = P.space === 'scene' ? (rel ? `((${id}_i[0] - ${c.midW}) / ${c.unit})` : `${id}_i[0]`) : placeIn(node, c);
    const center = v.center ?? pv3(P.center, [0, 0, 0]);
    const off = p(P.offset, 0);
    const shape = P.shape === 'box' || P.shape === 'sphere' ? P.shape : 'plane';
    const dist = shape === 'plane'
      ? `dot(${id}_q, normalize(${pv3(P.normal, [0, 1, 0])} + vec3(0.0, 1e-6, 0.0))) - ${off}`
      : shape === 'sphere'
        ? `length(${id}_q) - (${pv3(P.size, [1, 1, 1])}.x + ${off})`
        : `length(max(abs(${id}_q) - (${pv3(P.size, [1, 1, 1])} + ${off}), 0.0)) + min(max(abs(${id}_q).x - (${pv3(P.size, [1, 1, 1])}.x + ${off}), max(abs(${id}_q).y - (${pv3(P.size, [1, 1, 1])}.y + ${off}), abs(${id}_q).z - (${pv3(P.size, [1, 1, 1])}.z + ${off}))), 0.0)`;
    const keepOutside = P.keep === 'outside';
    return {
      code: head(node, v) + [
        `    vec3 ${id}_q = ${at} - ${center};\n`,
        `    float ${id}_d = ${dist};\n`,
        `    float ${id}_soft = max(${p(P.softness, 0.05)}, 1e-4);\n`,
        `    float ${id}_k = ${keepOutside ? `smoothstep(-${id}_soft, ${id}_soft, ${id}_d)` : `1.0 - smoothstep(-${id}_soft, ${id}_soft, ${id}_d)`};\n`,
        `    float ${id}_ew = max(${p(P.edge, 0.03)}, 0.0);\n`,
        `    float ${id}_e = ${id}_ew > 1e-4 ? (1.0 - smoothstep(0.0, ${id}_ew, abs(${id}_d))) * ${id}_k : 0.0;\n`,
        `    mat3 ${id}_s = ${id}_i;\n`,
        `    ${id}_s[1] += ${pv3(P.edgeColor, [0.3, 0.8, 1])} * (${p(P.glow, 2)} * ${id}_e);\n`,
        `    ${id}_s[2].x *= ${id}_k;\n`,
      ].join(''),
      outputVars: { splat: `${id}_s` },
    };
  },
};

// ── Size & opacity ──────────────────────────────────────────────────────────

export const SplatLookNode: NodeDefinition = {
  type: 'splatLook',
  label: 'Splat Size & Opacity',
  category: SPLAT_CATEGORY,
  aliases: ['Splat size', 'Opacity floor', 'Sparse', 'Dense', 'Thin out'],
  description: 'Sparse or dense looks: scale every splat, multiply its opacity, lift faint splats to an Opacity floor (a denser, more solid scan), and Keep only a share of the splats (a sparse, dotted one).',
  inputs: { ...splatIn },
  outputs: { ...splatOut },
  defaultParams: { size: 1, opacity: 1, floor: 0, keep: 1 },
  paramDefs: {
    size: { label: 'Size', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Multiplies every splat\'s size: below 1 thins the scan into specks, above 1 softens it.' },
    opacity: { label: 'Opacity', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Multiplies every splat\'s opacity.' },
    floor: { label: 'Opacity floor', type: 'float', min: 0, max: 1, step: 0.01, hint: 'No splat is fainter than this: lifts the wispy ones for a more solid scan.' },
    keep: { label: 'Keep', type: 'float', min: 0, max: 1, step: 0.005, hint: 'The share of splats drawn (picked at random, always the same ones): lower for a sparse scan.' },
  },
  generateGLSL: (node, v) => {
    const id = node.id, P = node.params, c = splatContext(node);
    return {
      code: head(node, v) + [
        `    mat3 ${id}_s = ${id}_i;\n`,
        `    ${id}_s[2].y *= ${p(P.size, 1)};\n`,
        `    ${id}_s[2].x = max(${id}_s[2].x * ${p(P.opacity, 1)}, ${p(P.floor, 0)}) * step(${c.rand}, ${p(P.keep, 1)});\n`,
      ].join(''),
      outputVars: { splat: `${id}_s` },
    };
  },
};

// ── Points ──────────────────────────────────────────────────────────────────

export const SplatPointsNode: NodeDefinition = {
  type: 'splatPoints',
  label: 'Splat Points',
  category: SPLAT_CATEGORY,
  aliases: ['Points', 'Point cloud', 'Dots', 'Crisp dots'],
  description: 'Draws every splat as a crisp round dot instead of a soft Gaussian: a point cloud. Dot size is in pixels; On below 0.5 brings the Gaussians back (map it in Play to switch).',
  inputs: { ...splatIn },
  outputs: { ...splatOut },
  defaultParams: { on: 1, dotSize: 2, solid: 1 },
  paramDefs: {
    on: { label: 'On', type: 'float', min: 0, max: 1, step: 1, hint: '1: dots. 0: the soft splats (a switch Play can drive).' },
    dotSize: { label: 'Dot size', type: 'float', min: 0.5, max: 24, step: 0.1, hint: 'Each dot\'s radius in pixels (times the splat\'s Size).' },
    solid: { label: 'Solid', type: 'float', min: 0, max: 1, step: 0.01, hint: '1: every dot fully opaque. 0: each keeps its splat\'s opacity.' },
  },
  generateGLSL: (node, v) => {
    const id = node.id, P = node.params;
    return {
      code: head(node, v) + [
        `    float ${id}_on = step(0.5, ${p(P.on, 1)});\n`,
        `    mat3 ${id}_s = ${id}_i;\n`,
        `    ${id}_s[2].z = mix(${id}_i[2].z, max(${p(P.dotSize, 2)}, 0.25), ${id}_on);\n`,
        `    ${id}_s[2].x = mix(${id}_i[2].x, mix(${id}_i[2].x, step(0.02, ${id}_i[2].x), clamp(${p(P.solid, 1)}, 0.0, 1.0)), ${id}_on);\n`,
      ].join(''),
      outputVars: { splat: `${id}_s` },
    };
  },
};

// ── The program's end (made by compiler/splatGraph.ts; never in a graph) ────

/**
 * Writes one splat's changed state into the modifier targets (lib/splats/render.ts): texel A the centre and the size
 * (negative: a crisp dot of that radius in pixels), texel B (location 1) the colour and opacity.
 */
export const SplatModOutNode: NodeDefinition = {
  type: SPLAT_MOD_OUT_TYPE,
  label: 'Splat modifier output',
  category: 'Output',
  description: 'Internal: what a Splat Scene\'s modifier program writes for each splat.',
  inputs: { splat: { type: SPLAT_TYPE, label: 'Splat' } },
  outputs: {},
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node, v) => {
    const s = v.splat ?? 'sp_base', id = node.id;
    return {
      code: [
        `    mat3 ${id}_s = ${s};\n`,
        `    float ${id}_size = max(${id}_s[2].y, 0.0);\n`,
        `    float ${id}_enc = ${id}_s[2].z > 0.0 ? -max(${id}_s[2].z * ${id}_size, 0.25) : ${id}_size;\n`,
        `    gl_FragColor = vec4(${id}_s[0], ${id}_enc);\n`,
        `    splatModOut1 = vec4(max(${id}_s[1], 0.0), clamp(${id}_s[2].x, 0.0, 4.0));\n`,
      ].join(''),
      outputVars: {},
    };
  },
};

/** Every node that carries (or reads) a splat state: the compiler marks these with `__splatProgram` in the program. */
export const SPLAT_NODE_TYPES = new Set(['splatAttributes', 'splatSet', 'splatDissolve', 'splatExplode', 'splatWave', 'splatColor', 'splatCrop', 'splatLook', 'splatPoints', SPLAT_MOD_OUT_TYPE]);

/**
 * Which nodes move splats, and by which params (any non-zero moves them): the engine then sorts by the moved
 * positions (lib/splats/engine.ts). Set Splat moves them whenever Position or Offset is wired.
 */
export function splatMoveGate(n: GraphNode): SplatMoveGate | null {
  switch (n.type) {
    case 'splatSet': return n.inputs.position?.connection || n.inputs.offset?.connection ? { params: ['amount'] } : null;
    case 'splatDissolve': return { params: ['drift'] };
    case 'splatExplode': return { params: ['amount'] };
    case 'splatWave': return { params: ['amplitude'] };
    default: return null;
  }
}

/** The recipe nodes (each one look, a card of its own), in the order the Splat Scene card offers them. */
export const SPLAT_RECIPE_TYPES = ['splatDissolve', 'splatExplode', 'splatWave', 'splatColor', 'splatCrop', 'splatLook', 'splatPoints'] as const;
