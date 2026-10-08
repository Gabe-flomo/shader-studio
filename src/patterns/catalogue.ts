/**
 * catalogue.ts — the named techniques (pattern discovery, step 2).
 *
 * A technique is a multi-node way of doing something (attenuate light, tile space…). Each has a family,
 * a plain explanation, its maths in one line, the role slots it attaches to (what a future "apply
 * technique" would wire in and get out), and variants: the different spellings found in the graphs
 * (a node and its modes, the same idea in an Expression Block, a chain of nodes). A variant's matcher
 * reads the dataflow (dataflow.ts) and/or the GLSL its code nodes carry, and returns hits: the node
 * uids taking part, and for code the line.
 *
 * Hand-curated, checked against the mined frequent subgraphs (mine.ts); docs/reports/pattern-discovery.md
 * lists what was found. Pure data + pure functions.
 */
import type { DfEdge, DfNode, DfView } from './dataflow';
import { getNodeDefinition } from '../nodes/definitions';

export type FamilyId =
  | 'lightFalloff' | 'lightAccum' | 'spaceDistort' | 'repetition' | 'waves' | 'perCell' | 'colourMap'
  | 'feedback' | 'sdfCombine' | 'noise' | 'motion' | 'march3d' | 'agents';

export interface Family {
  id: FamilyId;
  name: string;
  /** "ways to attenuate light": the family's question, for "3 ways to attenuate light". */
  ways: string;
  line: string;
}

/** What a slot carries, in words a future "apply technique" can resolve against a graph's stages. */
export type SlotRole =
  | 'position' | 'distance' | 'brightness' | 'colour' | 'value' | 'time' | 'cell' | 'mask' | 'texture'
  | 'scene' | 'agents' | 'angle' | 'seed';

export interface Slot { name: string; role: SlotRole; type: string; note?: string }

export interface Hit {
  /** Dataflow uids of the nodes taking part. */
  nodes: string[];
  /** For code: the line that matched. */
  line?: string;
}

export interface Variant {
  id: string;
  name: string;
  /** The variant's maths, when it differs from the technique's. */
  maths?: string;
  match(v: DfView): Hit[];
}

export interface Technique {
  id: string;
  name: string;
  family: FamilyId;
  /** One plain line: what it does and why. */
  explain: string;
  /** The maths in one line. */
  maths: string;
  slots: { in: Slot[]; out: Slot[] };
  variants: Variant[];
  /** Words a query can match ("show graphs using wave interference"). */
  words?: string[];
}

export const FAMILIES: Family[] = [
  { id: 'lightFalloff', name: 'Light falloff', ways: 'ways to attenuate light', line: 'Turn a distance into brightness that fades away from a shape.' },
  { id: 'lightAccum', name: 'Light accumulation', ways: 'ways to accumulate light', line: 'Put several lights, or many steps of one, together.' },
  { id: 'spaceDistort', name: 'Space distortion', ways: 'ways to distort space', line: 'Bend the coordinates before anything is drawn.' },
  { id: 'repetition', name: 'Repetition & tiling', ways: 'ways to repeat', line: 'Draw once, see it many times.' },
  { id: 'waves', name: 'Waves & interference', ways: 'ways to make waves', line: 'Sines in space: bands, ripples, and where they meet.' },
  { id: 'perCell', name: 'Per-cell variation', ways: 'ways to vary cells', line: 'Every cell or copy a little different: a hash, a wave or a point decides.' },
  { id: 'colourMap', name: 'Colour mapping', ways: 'ways to colour a value', line: 'Turn a number into colour, and finish the colour.' },
  { id: 'feedback', name: 'Feedback & trails', ways: 'ways to remember', line: 'Use the frame before: trails, echoes, deposits.' },
  { id: 'sdfCombine', name: 'SDF combination', ways: 'ways to combine shapes', line: 'Join, cut and fill distance fields.' },
  { id: 'noise', name: 'Noise & texture', ways: 'ways to use noise', line: 'Layered noise as a texture, animated by time.' },
  { id: 'motion', name: 'Motion', ways: 'ways to animate', line: 'Make it move: oscillate, spin, drift.' },
  { id: 'march3d', name: 'Ray-marched 3D', ways: 'ways to build 3D', line: 'March rays through a scene of distances and light the hits.' },
  { id: 'agents', name: 'Agents & particles', ways: 'ways to move many things', line: 'Many small things each following simple rules.' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const DISTANCE_PORTS = /^(distance|dist|d|sdf|value|dCenter|distToCenter|cellDist)$/i;
const SHAPE_CATS = new Set(['2D Primitives', '3D Primitives', 'SDF', 'Field']);
const LIGHT_TYPES = ['light', 'glowLayer', 'deepGlow', 'volumeGlow', 'glowToColor', 'glowTexture', 'bloom'];
const NOISE_TYPES = ['fbm', 'noiseFloat', 'voronoi', 'domainWarp', 'turbulence', 'magicTexture', 'waveTexture', 'gyroidField'];
const WAVE_TYPES = ['sin', 'cos', 'lfo', 'sineLFO', 'waveTerm', 'waveTexture'];

const catOf = (t: string) => getNodeDefinition(t)?.category ?? '';
const isShape = (n: DfNode | undefined) => !!n && (SHAPE_CATS.has(catOf(n.type)) || ['length', 'circleSDF', 'shapeSDF', 'marchSceneDist'].includes(n.type));
const one = (n: DfNode): Hit => ({ nodes: [n.uid] });
const param = (n: DfNode, k: string) => n.params[k];

/** Nodes of these types (that pass `ok`), one hit each. */
const nodes = (types: string[], ok: (n: DfNode, v: DfView) => boolean = () => true) => (v: DfView): Hit[] =>
  v.ofType(...types).filter(n => ok(n, v)).map(one);

/** Like `nodes`, plus whatever feeds them a distance (the shape the light comes from). */
const lit = (types: string[], ok: (n: DfNode, v: DfView) => boolean = () => true) => (v: DfView): Hit[] =>
  v.ofType(...types).filter(n => ok(n, v)).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).filter(e => DISTANCE_PORTS.test(e.in) || isShape(v.node(e.from))).map(e => e.from)] }));

/** Has a wire into input `key` (or any input when no key). */
const wiredIn = (v: DfView, n: DfNode, key?: string) => v.ins(n.uid).some(e => !key || e.in === key);

/** The node feeding input `key`, if any. */
const feeder = (v: DfView, n: DfNode, key: string): DfNode | undefined => { const e = v.ins(n.uid).find(x => x.in === key); return e ? v.node(e.from) : undefined; };

/** Some node of `types` within `depth` wires upstream. */
const fromAny = (v: DfView, n: DfNode, pred: (m: DfNode) => boolean, depth = 2) => v.upstream(n.uid, depth).filter(pred);

/** Two-step chain a → b on a direct wire, a matching `a`, b matching `b`; hit holds both (plus `more`). */
function chain(a: (n: DfNode) => boolean, b: (n: DfNode, e: DfEdge) => boolean) {
  return (v: DfView): Hit[] => {
    const out: Hit[] = [];
    for (const n of v.df.nodes) {
      if (!a(n)) continue;
      for (const e of v.outs(n.uid)) {
        const m = v.node(e.to);
        if (m && b(m, e)) out.push({ nodes: [n.uid, m.uid] });
      }
    }
    return out;
  };
}

/** Code lines that pass `test`; one hit per code node (its first matching line). */
function code(test: (line: string, idioms: string[]) => boolean) {
  return (v: DfView): Hit[] => {
    const out: Hit[] = [];
    for (const n of v.codeNodes) {
      const l = n.code!.find(c => test(c.text, c.idioms));
      if (l) out.push({ nodes: [n.uid], line: l.text });
    }
    return out;
  };
}
const re = (r: RegExp) => (line: string) => r.test(line);
const idiom = (...ids: string[]) => (_: string, idioms: string[]) => ids.some(i => idioms.includes(i));
const count = (s: string, r: RegExp) => (s.match(r) ?? []).length;

const isLight = (n: DfNode) => LIGHT_TYPES.includes(n.type) || (!!n.code && n.code.some(c => /exp\s*\(\s*-|glow/i.test(c.text)));
const isWave = (n: DfNode) => WAVE_TYPES.includes(n.type);

/** Union of variants' hits for convenience in tests. */
export function techniqueHits(t: Technique, v: DfView): Array<Hit & { variant: string }> {
  return t.variants.flatMap(x => x.match(v).map(h => ({ ...h, variant: x.id })));
}

// ── The catalogue ─────────────────────────────────────────────────────────────

const S = (name: string, role: SlotRole, type: string, note?: string): Slot => ({ name, role, type, ...(note ? { note } : {}) });

export const TECHNIQUES: Technique[] = [
  // Light falloff ─────────────────────────────────────────────────────────────
  {
    id: 'falloff-inverse', name: 'Inverse falloff (1/d)', family: 'lightFalloff',
    explain: 'Brightness is a constant over the distance: very bright at the edge, a long soft tail.',
    maths: 'b = k / d', words: ['inverse', 'one over d', 'glow', 'neon'],
    slots: { in: [S('distance', 'distance', 'float'), S('strength', 'value', 'float')], out: [S('brightness', 'brightness', 'float')] },
    variants: [
      { id: 'node-simple', name: 'SDF Glow, Simple mode', match: lit(['light'], n => param(n, 'mode') === 'simple') },
      { id: 'glow-layer', name: 'Glow Layer (intensity / |d|)', match: lit(['glowLayer']) },
      { id: 'code', name: 'k / d in code', match: code((l, ids) => idiom('glow-inv', 'glow-over')(l, ids) || /[\d.]+\s*\/\s*(?:max\s*\(|abs\s*\(|length\s*\()/.test(l)) },
    ],
  },
  {
    id: 'falloff-exp', name: 'Exponential falloff', family: 'lightFalloff',
    explain: 'Brightness halves every fixed step away: a tight glow that ends cleanly.',
    maths: 'b = e^(−k·d)', words: ['exp', 'exponential', 'glow', 'fade'],
    slots: { in: [S('distance', 'distance', 'float'), S('falloff', 'value', 'float')], out: [S('brightness', 'brightness', 'float')] },
    variants: [
      { id: 'node-glow', name: 'SDF Glow, Glow mode', match: lit(['light'], n => (param(n, 'mode') ?? 'glow') === 'glow') },
      { id: 'code', name: 'exp(−k·d) in code', match: code((l, ids) => (ids.includes('glow-exp') || /exp\s*\(\s*-/.test(l)) && !/1\.0\s*-\s*exp/.test(l) && !/exp\s*\(\s*-\s*(\w+)\s*\*\s*\1\b/.test(l) && !/exp\s*\(\s*-\s*dot\s*\(/.test(l)) },
      { id: 'gaussian', name: 'Gaussian e^(−k·d²)', maths: 'b = e^(−k·d²)', match: code(re(/exp\s*\(\s*-\s*(?:\(?\s*(\w+)\s*\*\s*\1\b|dot\s*\(\s*(\w+)\s*,\s*\2\s*\))/)) },
    ],
  },
  {
    id: 'falloff-inverse-square', name: 'Inverse-square falloff', family: 'lightFalloff',
    explain: 'How real light spreads: a fat haze that never quite ends; the 1 + keeps the centre finite.',
    maths: 'b = 1 / (1 + k·d²)', words: ['haze', 'inverse square', 'physical'],
    slots: { in: [S('distance', 'distance', 'float'), S('falloff', 'value', 'float')], out: [S('brightness', 'brightness', 'float')] },
    variants: [
      { id: 'node-haze', name: 'SDF Glow, Haze mode', match: lit(['light'], n => param(n, 'mode') === 'haze') },
      { id: 'code', name: '1 / (1 + k·d²) or 1 / dot(p,p) in code', match: code(re(/\/\s*\(\s*1\.0?\s*\+[^;]*(\w+)\s*\*\s*\1\b|\/\s*\(?\s*dot\s*\(\s*(\w+)\s*,\s*\2\s*\)/)) },
    ],
  },
  {
    id: 'falloff-smoothstep', name: 'Smoothstep falloff', family: 'lightFalloff',
    explain: 'A soft edge between two radii: full inside, nothing past the outer one.',
    maths: 'b = 1 − smoothstep(r₀, r₁, d)', words: ['soft edge', 'smoothstep', 'mask', 'fill'],
    slots: { in: [S('distance', 'distance', 'float'), S('inner', 'value', 'float'), S('outer', 'value', 'float')], out: [S('brightness', 'brightness', 'float')] },
    variants: [
      { id: 'node', name: 'Smoothstep node on a distance', match: v => v.ofType('smoothstep').filter(n => fromAny(v, n, isShape, 2).length > 0).map(n => ({ nodes: [n.uid, ...fromAny(v, n, isShape, 2).map(m => m.uid)] })) },
      { id: 'fill', name: 'SDF Fill (soft)', match: lit(['sdfFill']) },
      { id: 'code', name: '1 − smoothstep(a, b, d) in code', match: code((l, ids) => ids.includes('soft-circle') || ids.includes('soft-circle-inside') || ids.includes('fill-soft') || /1\.0\s*-\s*smoothstep\s*\(/.test(l) || (() => { const m = /smoothstep\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,/.exec(l); return !!m && Number(m[1]) > Number(m[2]); })()) },
    ],
  },
  {
    id: 'falloff-bounded', name: 'Bounded falloff', family: 'lightFalloff',
    explain: 'A glow that reaches zero at a set radius, so lights never add up far away.',
    maths: 'b = max(0, 1 − k·d)²', words: ['bounded', 'radius', 'window'],
    slots: { in: [S('distance', 'distance', 'float'), S('radius', 'value', 'float')], out: [S('brightness', 'brightness', 'float')] },
    variants: [
      { id: 'node', name: 'SDF Glow, Bounded mode', match: lit(['light'], n => param(n, 'mode') === 'bounded') },
      { id: 'ring', name: 'SDF Glow, Ring mode', maths: 'b = e^(−k·d)·(½ + ½cos(f·d))', match: lit(['light'], n => param(n, 'mode') === 'ring') },
      { id: 'code', name: 'clamp(1 − d / r) in code', match: code(re(/(?:clamp|max)\s*\(\s*1\.0\s*-\s*\w+\s*[/*]/)) },
    ],
  },

  // Light accumulation ────────────────────────────────────────────────────────
  {
    id: 'accum-additive', name: 'Additive layers', family: 'lightAccum',
    explain: 'Lights add: put glows on top of each other and overlaps get brighter.',
    maths: 'c = Σ bᵢ·tintᵢ', words: ['add', 'sum', 'layer', 'accumulate', 'glow'],
    slots: { in: [S('layers', 'colour', 'vec3', 'two or more')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'add-colors', name: 'Add Colors of glows', match: v => v.ofType('addColor', 'add', 'addVec3').filter(n => v.ins(n.uid).length >= 2 && v.ins(n.uid).every(e => { const s = v.node(e.from); return !!s && (isLight(s) || fromAny(v, s, isLight, 2).length > 0); })).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from)] })) },
      { id: 'code', name: 'col += glow in code', match: code(re(/\+=\s*[^;]*(?:exp\s*\(|\/\s*(?:max|abs|length)\s*\(|glow|light)/i)) },
    ],
  },
  {
    id: 'accum-max', name: 'Brightest wins (max)', family: 'lightAccum',
    explain: 'Keep the brighter of two lights instead of adding: overlaps never blow out.',
    maths: 'c = max(a, b)', words: ['max', 'lighten', 'screen'],
    slots: { in: [S('a', 'brightness', 'float'), S('b', 'brightness', 'float')], out: [S('brightness', 'brightness', 'float')] },
    variants: [
      { id: 'node', name: 'Max of two lights', match: v => v.ofType('max').filter(n => v.ins(n.uid).length >= 2 && v.ins(n.uid).every(e => { const s = v.node(e.from); return !!s && (isLight(s) || isShape(s) || fromAny(v, s, x => isLight(x) || isShape(x), 2).length > 0); })).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from)] })) },
      { id: 'code', name: 'max(a, b) of glows in code', match: code(re(/max\s*\([^;]*(?:exp|glow|light)[^;]*,[^;]*(?:exp|glow|light)/i)) },
    ],
  },
  {
    id: 'accum-loop', name: 'Glow in a loop', family: 'lightAccum',
    explain: 'Add a little light at every step of a loop: along a ray (volumetric) or over iterations.',
    maths: 'c += f(dᵢ) for each step i', words: ['loop', 'volumetric', 'march', 'iterate', 'accumulate'],
    slots: { in: [S('distance each step', 'distance', 'float'), S('steps', 'value', 'float')], out: [S('brightness', 'brightness', 'float')] },
    variants: [
      { id: 'march', name: 'Volume glow in a March Loop', match: v => v.ofType('marchLoopGroup', 'giLitMarchGroup').flatMap(g => { const ins = v.inside(g.uid).filter(n => ['volumeGlow', 'light', 'glowLayer', 'deepGlow'].includes(n.type)); return ins.length ? [{ nodes: [g.uid, ...ins.map(n => n.uid)] }] : []; }) },
      { id: 'volume-node', name: 'Volume Glow node', match: nodes(['volumeGlow'], n => !n.container) },
      { id: 'group', name: 'Iterated group adding light', match: v => v.df.loops.flatMap(l => { const ms = l.members.map(u => v.node(u)).filter((n): n is DfNode => !!n && (isLight(n) || n.type === 'addColor')); return ms.length ? [{ nodes: ms.map(n => n.uid) }] : []; }) },
      { id: 'code', name: 'for loop with += in code', match: code(re(/\bfor\s*\(.*\+=/)) },
    ],
  },
  {
    id: 'accum-tinted', name: 'Tinted glow', family: 'lightAccum',
    explain: 'A brightness times a colour: the glow takes a hue before it is added or shown.',
    maths: 'c = b · tint', words: ['tint', 'colour glow', 'neon'],
    slots: { in: [S('brightness', 'brightness', 'float'), S('tint', 'colour', 'vec3')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'tinted-out', name: 'SDF Glow Tinted output', match: v => v.ofType('light').filter(n => v.outs(n.uid).some(e => e.out === 'tinted')).map(one) },
      { id: 'palette-tint', name: 'Palette into the Tint', match: v => v.ofType('light').filter(n => wiredIn(v, n, 'tint')).map(n => ({ nodes: [n.uid, feeder(v, n, 'tint')!.uid] })) },
      { id: 'multiply', name: 'Glow × colour (Multiply)', match: chain(isLight, (m, e) => ['multiply', 'multiplyVec3'].includes(m.type) && e.type === 'float') },
      { id: 'glow-to-color', name: 'Glow to Color', match: nodes(['glowToColor']) },
    ],
  },

  // Space distortion ──────────────────────────────────────────────────────────
  {
    id: 'domain-warp', name: 'Domain warp', family: 'spaceDistort',
    explain: 'Push the coordinates by noise before reading a pattern: straight things go liquid.',
    maths: 'p′ = p + k·noise(p); f(p′)', words: ['warp', 'domain warp', 'liquid', 'turbulence', 'distort'],
    slots: { in: [S('position', 'position', 'vec2'), S('amount', 'value', 'float')], out: [S('position', 'position', 'vec2')] },
    variants: [
      { id: 'node', name: 'Warp node', match: nodes(['domainWarp', 'domainWarp3D', 'turbulence', 'turbulence3D', 'smoothWarp', 'chaosLayers', 'sinWarp3D', 'gridDensityWarp', 'textureFlow', 'displacementMap']) },
      { id: 'noise-into-uv', name: 'Noise into another node’s position', match: v => { const out: Hit[] = []; for (const n of v.ofType(...NOISE_TYPES)) for (const m of v.downstream(n.uid, 2)) { const e = v.ins(m.uid).find(x => /^(uv|p|pos|position|coord)$/i.test(x.in) && (x.from === n.uid || v.upstream(x.from, 1).some(u => u.uid === n.uid) || x.from === n.uid)); if (e && m.uid !== n.uid) out.push({ nodes: [n.uid, m.uid] }); } return out; } },
      { id: 'code', name: 'p += sin(p.yx) or noise(p + noise(p)) in code', match: code(re(/(\w+)\s*\+=\s*[^;]*(?:sin|cos)\s*\(\s*[^;]*\1\.(?:yx|y|x)|(?:fbm|noise)\w*\s*\([^;]*(?:fbm|noise)\w*\s*\(/)) },
    ],
  },
  {
    id: 'polar', name: 'Polar coordinates', family: 'spaceDistort',
    explain: 'Read space as angle and radius: straight bands become rings and rays.',
    maths: '(r, θ) = (|p|, atan(p.y, p.x))', words: ['polar', 'angle', 'radial', 'atan'],
    slots: { in: [S('position', 'position', 'vec2')], out: [S('radius', 'distance', 'float'), S('angle', 'angle', 'float')] },
    variants: [
      { id: 'node', name: 'Polar Space node', match: nodes(['polarSpace', 'vec2Angle', 'rippleSpace']) },
      { id: 'code', name: 'atan(p.y, p.x) in code', match: code((l, ids) => ids.includes('polar') || ids.includes('angle') || /atan\s*\(\s*\w+\.[yz]\s*,\s*\w+\.x\s*\)/.test(l)) },
    ],
  },
  {
    id: 'twist-bend', name: 'Twist & bend', family: 'spaceDistort',
    explain: 'Rotate each point by an amount that depends on where it is: space twists or curls.',
    maths: 'p′ = rot(k·p.y)·p', words: ['twist', 'bend', 'spiral', 'swirl'],
    slots: { in: [S('position', 'position', 'vec3'), S('amount', 'value', 'float')], out: [S('position', 'position', 'vec3')] },
    variants: [
      { id: 'node', name: 'Twist / Bend / Spiral node', match: nodes(['twist3D', 'bend3D', 'spiralWarp3D']) },
      { id: 'rotate-by-place', name: 'Rotate by a distance or coordinate', match: v => v.ofType('rotate2d', 'rotationMatrix', 'rotate3D').filter(n => fromAny(v, n, m => isShape(m) || m.type === 'length' || m.type === 'polarSpace', 2).length > 0).map(one) },
      { id: 'code', name: 'rot(length(p)) in code', match: code(re(/rot\w*\s*\([^;]*(?:length\s*\(|\w+\.[xyz]\b)/)) },
    ],
  },
  {
    id: 'fold-mirror', name: 'Fold & mirror', family: 'spaceDistort',
    explain: 'abs() folds space onto itself: one side is drawn, both are seen (kaleidoscopes).',
    maths: 'p′ = |p|', words: ['fold', 'mirror', 'kaleidoscope', 'symmetry', 'abs'],
    slots: { in: [S('position', 'position', 'vec2')], out: [S('position', 'position', 'vec2')] },
    variants: [
      { id: 'node', name: 'Fold / Kaleido node', match: nodes(['kaleidoSpace', 'kaleidoscope3D', 'fold3D', 'mirrorFold3D', 'loopDomainFold', 'sphericalFoldFractal', 'mirroredRepeat2D', 'mirroredRepeat3D']) },
      { id: 'abs-uv', name: 'Abs on the coordinates', match: v => v.ofType('abs').filter(n => v.ins(n.uid).some(e => e.type.startsWith('vec'))).map(one) },
      { id: 'code', name: 'abs(p) in code', match: code(re(/\babs\s*\(\s*(?:p|uv|pos|q|z)\b(?:\.(?:xy|xz|yz|x|y))?\s*\)/)) },
    ],
  },
  {
    id: 'lens', name: 'Lens & projection', family: 'spaceDistort',
    explain: 'Remap the whole picture through a lens: fisheye, barrel, a black hole, a tilted screen.',
    maths: 'p′ = p·(1 + k·|p|²)', words: ['lens', 'fisheye', 'barrel', 'projection', 'perspective'],
    slots: { in: [S('position', 'position', 'vec2')], out: [S('position', 'position', 'vec2')] },
    variants: [
      { id: 'node', name: 'Lens node', match: nodes(['sphericalSpace', 'lensDistortion', 'mobiusSpace', 'gravitationalLens', 'crtScreen', 'perspective2d', 'cornerPin']) },
      { id: 'code', name: 'p · (1 + k·dot(p,p)) in code', match: code(re(/\*\s*\(\s*1\.0\s*\+\s*[^;]*dot\s*\(\s*(\w+)\s*,\s*\1\s*\)/)) },
    ],
  },

  // Repetition & tiling ───────────────────────────────────────────────────────
  {
    id: 'tile-fract', name: 'Tile with fract', family: 'repetition',
    explain: 'Scale space up and keep the fraction: every cell is the same small square.',
    maths: 'p′ = fract(p·n) − ½', words: ['tile', 'repeat', 'fract', 'grid', 'mod'],
    slots: { in: [S('position', 'position', 'vec2'), S('count', 'value', 'float')], out: [S('cell position', 'position', 'vec2'), S('cell id', 'cell', 'vec2')] },
    variants: [
      { id: 'node', name: 'Tile / Infinite Repeat node', match: nodes(['fract', 'infiniteRepeatSpace', 'pixelate']) },
      { id: 'fract-uv', name: 'Fract on the coordinates', match: v => v.ofType('fractRaw', 'mod').filter(n => v.ins(n.uid).some(e => e.type.startsWith('vec'))).map(one) },
      { id: 'code', name: 'fract(p·n) / mod(p, c) in code', match: code((l, ids) => ['tile', 'tile-centred', 'mod-repeat', 'mod-repeat-centred'].some(i => ids.includes(i)) || /fract\s*\(\s*(?:p|uv|q|pos)\w*\s*\*/.test(l)) },
    ],
  },
  {
    id: 'repeat-3d', name: 'Repeat in 3D', family: 'repetition',
    explain: 'Wrap the ray’s point into one cell so one shape fills endless space.',
    maths: 'p′ = mod(p + c/2, c) − c/2', words: ['repeat', 'infinite', 'pillars', '3d repeat'],
    slots: { in: [S('position', 'position', 'vec3'), S('spacing', 'value', 'vec3')], out: [S('position', 'position', 'vec3')] },
    variants: [
      { id: 'node', name: 'Repeat 3D node', match: nodes(['repeat3D', 'mirroredRepeat3D', 'voxelize']) },
    ],
  },
  {
    id: 'repeat-angular', name: 'Angular repeat', family: 'repetition',
    explain: 'Repeat around a centre: n copies on a circle, like petals or spokes.',
    maths: 'θ′ = mod(θ, 2π/n)', words: ['polar repeat', 'petals', 'radial', 'spokes'],
    slots: { in: [S('position', 'position', 'vec2'), S('copies', 'value', 'float')], out: [S('position', 'position', 'vec2')] },
    variants: [
      { id: 'node', name: 'Polar Repeat node', match: nodes(['polarRepeat3D', 'kaleidoSpace']) },
      { id: 'polar-fract', name: 'Polar space, then tile', match: chain(n => n.type === 'polarSpace', m => ['fract', 'fractRaw', 'mod', 'infiniteRepeatSpace'].includes(m.type)) },
      { id: 'code', name: 'mod(atan(…), 2π/n) in code', match: code(re(/mod\s*\(\s*atan\s*\(/)) },
    ],
  },
  {
    id: 'grid-layout', name: 'Grid of cells', family: 'repetition',
    explain: 'Lay out cells with their own local space, id and size, and draw a shape in each.',
    maths: 'id = floor(p·n), q = fract(p·n) − ½', words: ['grid', 'cells', 'array', 'layout'],
    slots: { in: [S('position', 'position', 'vec2'), S('shape', 'distance', 'float', 'a field socket')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'grid-pattern', name: 'Grid Pattern with a shape', match: nodes(['gridPattern', 'gridPaint']) },
      { id: 'grid', name: 'Grid node', match: nodes(['gridLayout']) },
      { id: 'array', name: 'Array (copies)', match: nodes(['arrayField']) },
    ],
  },
  {
    id: 'iterated-fold', name: 'Repeat, fold, repeat (iterated)', family: 'repetition',
    explain: 'Run tile-and-fold several times in a loop, each pass inside the last: fractal rings.',
    maths: 'pₙ₊₁ = fract(pₙ·s) − ½', words: ['fractal', 'iterate', 'carry', 'loop'],
    slots: { in: [S('position', 'position', 'vec2'), S('iterations', 'value', 'float')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'group', name: 'Iterated group with fract or abs', match: v => v.df.loops.flatMap(l => { const ms = l.members.map(u => v.node(u)).filter((n): n is DfNode => !!n && (['fract', 'fractRaw', 'abs', 'mod', 'infiniteRepeatSpace'].includes(n.type) || !!n.code?.some(c => /fract\s*\(|abs\s*\(/.test(c.text)))); return ms.length ? [{ nodes: [l.uid, ...ms.map(n => n.uid)] }] : []; }) },
      { id: 'fractal-node', name: 'Fractal Loop node', match: nodes(['fractalLoop', 'mandelbrot', 'newtonFractal', 'sphericalFoldFractal', 'raymarch3d']) },
    ],
  },

  // Waves & interference ──────────────────────────────────────────────────────
  {
    id: 'waves-summed', name: 'Summed waves (interference)', family: 'waves',
    explain: 'Add sines of different directions or speeds: where crests meet they double, where they cross they cancel.',
    maths: 'w = Σ sin(kᵢ·p + ωᵢ·t)', words: ['interference', 'wave', 'sum of sines', 'moiré'],
    slots: { in: [S('position', 'position', 'vec2'), S('time', 'time', 'float')], out: [S('wave', 'value', 'float')] },
    variants: [
      { id: 'nodes', name: 'Add of two waves', match: v => v.ofType('add', 'addColor', 'addVec3', 'weightedAverage').filter(n => v.ins(n.uid).filter(e => { const s = v.node(e.from); return !!s && (isWave(s) || fromAny(v, s, isWave, 1).length > 0); }).length >= 2).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from)] })) },
      { id: 'node', name: 'Wave Texture / Wave Term node', match: nodes(['waveTexture', 'waveTerm', 'loopRippleStep']) },
      { id: 'code', name: 'sin(a) + sin(b) in code', match: code(l => count(l, /\b(?:sin|cos)\s*\(/g) >= 2 && /\)\s*[+-]\s*[^;]*\b(?:sin|cos)\s*\(/.test(l)) },
    ],
  },
  {
    id: 'ripples', name: 'Ripples from centres', family: 'waves',
    explain: 'A sine of the distance to a point: rings spread out from it. Two centres interfere.',
    maths: 'w = sin(k·|p − c| − ω·t)', words: ['ripple', 'rings', 'circular wave', 'water'],
    slots: { in: [S('position', 'position', 'vec2'), S('centre', 'position', 'vec2'), S('time', 'time', 'float')], out: [S('wave', 'value', 'float')] },
    variants: [
      { id: 'nodes', name: 'Sine of a distance', match: v => v.ofType('sin', 'cos').filter(n => fromAny(v, n, m => isShape(m) || m.type === 'length', 2).length > 0).map(n => ({ nodes: [n.uid, ...fromAny(v, n, m => isShape(m) || m.type === 'length', 2).map(m => m.uid)] })) },
      { id: 'code', name: 'sin(k·length(p − c)) in code', match: code((l, ids) => ids.includes('rings') || /\b(?:sin|cos)\s*\([^;]*length\s*\(/.test(l)) },
      { id: 'several', name: 'Several centres', maths: 'w = Σ sin(k·|p − cᵢ|)', match: code(l => count(l, /\b(?:sin|cos)\s*\([^;()]*(?:\([^()]*\)[^;()]*)*length\s*\(/g) >= 2 || count(l, /length\s*\(/g) >= 2 && /\b(?:sin|cos)\s*\(/.test(l)) },
      { id: 'wave-radius', name: 'Wave Radius / Ripple node', match: nodes(['waveRadius', 'rippleSpace']) },
    ],
  },
  {
    id: 'standing-waves', name: 'Standing waves (Chladni)', family: 'waves',
    explain: 'Multiply waves across x and y: still nodal lines where sand would gather.',
    maths: 'w = cos(nπx)·cos(mπy) − cos(mπx)·cos(nπy)', words: ['chladni', 'standing wave', 'cymatics', 'nodal'],
    slots: { in: [S('position', 'position', 'vec2'), S('modes', 'value', 'vec2')], out: [S('wave', 'value', 'float')] },
    variants: [
      { id: 'node', name: 'Chladni node', match: nodes(['chladniField', 'chladniModeFreq', 'agentChladni']) },
      { id: 'code', name: 'sin(a)·sin(b) in code', match: code(re(/\b(?:sin|cos)\s*\([^;]*\)\s*\*\s*(?:sin|cos)\s*\(/)) },
    ],
  },

  // Per-cell variation ────────────────────────────────────────────────────────
  {
    id: 'cell-hash', name: 'Cell id → hash → offset', family: 'perCell',
    explain: 'Hash each cell’s id into a random number and use it to move, size or colour that cell.',
    maths: 'h = fract(sin(dot(id, k))·43758); q′ = q + (h − ½)·a', words: ['hash', 'random per cell', 'jitter', 'scatter'],
    slots: { in: [S('cell id', 'cell', 'vec2'), S('amount', 'value', 'float')], out: [S('random', 'seed', 'float'), S('offset', 'position', 'vec2')] },
    variants: [
      { id: 'code', name: 'floor → hash in code', match: v => v.codeNodes.filter(n => { const all = n.code!.map(c => c.text).join('\n'); const ids = n.code!.flatMap(c => c.idioms); return (ids.includes('hash-sin-dot') || ids.includes('hash-sin') || /fract\s*\(\s*sin\s*\(/.test(all) || /hash\w*\s*\(/.test(all)) && (ids.includes('cell-id') || /floor\s*\(|cell|\bid\b/i.test(all) || v.ins(n.uid).some(e => /cell|id/i.test(e.out))); }).map(n => ({ nodes: [n.uid], line: n.code!.find(c => /sin|hash/.test(c.text))?.text })) },
      { id: 'cell-into-code', name: 'Cell id wired into code', match: v => v.df.edges.filter(e => /cellId|^id$|cell$/i.test(e.out) && v.node(e.to)?.code).map(e => ({ nodes: [e.from, e.to] })) },
      { id: 'cell-noise', name: 'Cell id → noise', maths: 'h = noise(id)', match: v => v.df.edges.filter(e => /cellId|^id$|cell$/i.test(e.out) && NOISE_TYPES.includes(v.node(e.to)?.type ?? '')).map(e => ({ nodes: [e.from, e.to] })) },
      { id: 'node', name: 'Cell Displace / Animated Cell Center', match: nodes(['cellDisplace', 'animatedCellCenter', 'cellFilter', 'noisyGridSDF', 'truchet']) },
    ],
  },
  {
    id: 'cell-wave', name: 'Wave across cells', family: 'perCell',
    explain: 'A wave over the cells’ positions sets each one’s size or brightness: the grid breathes.',
    maths: 's = ½ + ½·sin(k·|id| − ω·t)', words: ['breathing grid', 'wave grid', 'per-cell wave'],
    slots: { in: [S('cell position', 'cell', 'vec2'), S('time', 'time', 'float')], out: [S('size', 'value', 'float')] },
    variants: [
      { id: 'field-cell', name: 'Cell → wave in a field shape', match: v => v.ofType('fieldCell').filter(n => v.downstream(n.uid, 3).some(m => isWave(m) || !!m.code?.some(c => /\b(?:sin|cos)\s*\(/.test(c.text)))).map(n => ({ nodes: [n.uid, ...v.downstream(n.uid, 3).filter(m => isWave(m) || m.code).map(m => m.uid)] })) },
      { id: 'grid-out', name: 'Grid outputs → wave', match: v => v.ofType('gridLayout').filter(n => v.downstream(n.uid, 2).some(isWave)).map(one) },
      { id: 'node', name: 'Wave Radius / Grid Density node', match: nodes(['waveRadius', 'gridDensityWarp']) },
    ],
  },
  {
    id: 'cell-influence', name: 'Influence from a point', family: 'perCell',
    explain: 'Cells near a point (the mouse, a moving centre) change more than far ones.',
    maths: 'w = falloff(|cellPos − c|)', words: ['mouse', 'affect', 'influence', 'near'],
    slots: { in: [S('point', 'position', 'vec2'), S('radius', 'value', 'float')], out: [S('influence', 'value', 'float')] },
    variants: [
      { id: 'affect', name: 'Grid Pattern’s Affect position wired', match: v => v.ofType('gridPattern', 'gridPaint', 'arrayField').filter(n => v.ins(n.uid).some(e => /affect/i.test(e.in))).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).filter(e => /affect/i.test(e.in)).map(e => e.from)] })) },
      { id: 'influence-out', name: 'Cell Influence used', match: v => v.df.edges.filter(e => /influence/i.test(e.out) && v.node(e.from)?.type === 'fieldCell').map(e => ({ nodes: [e.from, e.to] })) },
    ],
  },

  // Colour mapping ────────────────────────────────────────────────────────────
  {
    id: 'palette-map', name: 'Value → palette', family: 'colourMap',
    explain: 'Feed a number (noise, distance, time) into a palette and get a colour for each value.',
    maths: 'c = a + b·cos(2π(c·t + d))', words: ['palette', 'gradient', 'cosine palette', 'colour ramp'],
    slots: { in: [S('value', 'value', 'float')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'cosine', name: 'Cosine palette', match: v => v.ofType('palette', 'palettePreset').filter(n => wiredIn(v, n)).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from)] })) },
      { id: 'stops', name: 'Stops / ramp', maths: 'c = lerp between stops at t', match: v => v.ofType('stopPalette', 'colorRamp').filter(n => wiredIn(v, n)).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from)] })) },
      { id: 'code', name: 'a + b·cos(2π(ct + d)) in code', match: code((_, ids) => ids.includes('iq-palette')) },
    ],
  },
  {
    id: 'threshold-colour', name: 'Threshold to two colours', family: 'colourMap',
    explain: 'Compare a value with a level and paint either side its own colour.',
    maths: 'c = mix(a, b, step(k, v))', words: ['threshold', 'two colours', 'mask', 'colorize'],
    slots: { in: [S('value', 'value', 'float'), S('level', 'value', 'float')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'colorize', name: 'Compare → Colorize', match: chain(n => ['compare', 'step', 'smoothstep'].includes(n.type), m => m.type === 'colorize') },
      { id: 'colorize-any', name: 'Colorize a mask', match: v => v.ofType('colorize').filter(n => wiredIn(v, n, 'field')).map(one) },
      { id: 'code', name: 'mix(a, b, step(…)) in code', match: code(re(/mix\s*\([^;]*,\s*(?:step|smoothstep)\s*\(/)) },
    ],
  },
  {
    id: 'mix-by-mask', name: 'Mix by a mask', family: 'colourMap',
    explain: 'Blend two colours with a shape or noise as the blend amount.',
    maths: 'c = a·(1 − m) + b·m', words: ['mix', 'blend', 'mask', 'lerp'],
    slots: { in: [S('a', 'colour', 'vec3'), S('b', 'colour', 'vec3'), S('mask', 'mask', 'float')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'node', name: 'Mix with a wired amount', match: v => v.ofType('mix', 'mixVec3', 'oklabMix', 'mask', 'blendModes').filter(n => v.ins(n.uid).length >= 2).map(one) },
      { id: 'code', name: 'mix(a, b, m) in code', match: code((l, ids) => ids.includes('mix') && /mix\s*\(\s*(?:vec3|col|c\w*|base)/.test(l)) },
    ],
  },
  {
    id: 'soft-clip', name: 'Tone map (soft clip)', family: 'colourMap',
    explain: 'Squeeze bright, added-up light back under white without a hard clip.',
    maths: 'c′ = 1 − e^(−c)  or  c / (1 + c)', words: ['tone map', 'exposure', 'reinhard', 'aces', 'soft clip'],
    slots: { in: [S('colour', 'colour', 'vec3')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'node', name: 'Tone Map node', match: nodes(['toneMap']) },
      { id: 'exposure', name: '1 − e^(−x) in code', match: code(re(/1\.0\s*-\s*exp\s*\(\s*-/)) },
      { id: 'reinhard', name: 'x / (1 + x) in code', maths: 'c′ = c / (1 + c)', match: code(re(/(\w+)\s*\/\s*\(\s*1\.0\s*\+\s*\1\s*\)|tanh\s*\(/)) },
    ],
  },
  {
    id: 'grade', name: 'Colour grade', family: 'colourMap',
    explain: 'Adjust the finished colour: gamma, contrast, hue, posterize.',
    maths: 'c′ = pow(c, 1/γ)', words: ['grade', 'gamma', 'contrast', 'hue', 'posterize'],
    slots: { in: [S('colour', 'colour', 'vec3')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'node', name: 'Grade node', match: nodes(['posterize', 'hueRotate', 'brightnessContrast', 'colorMatrix', 'hsv', 'grain', 'vignette']) },
      { id: 'code', name: 'gamma / contrast in code', match: code((_, ids) => ['gamma-encode', 'gamma-decode', 'contrast', 'vignette', 'quantise'].some(i => ids.includes(i))) },
    ],
  },

  // Feedback & trails ─────────────────────────────────────────────────────────
  {
    id: 'feedback-pass', name: 'Read the frame before', family: 'feedback',
    explain: 'Sample last frame’s picture, change it a little, and draw it again: trails and smears.',
    maths: 'cₜ = f(cₜ₋₁(p′)) + new', words: ['feedback', 'trails', 'previous frame', 'smear'],
    slots: { in: [S('new', 'colour', 'vec3'), S('decay', 'value', 'float')], out: [S('colour', 'colour', 'vec3'), S('previous', 'texture', 'texture')] },
    variants: [
      { id: 'pass', name: 'Pass → previous → sample', match: v => v.ofType('pass').filter(n => v.outs(n.uid).some(e => e.out === 'previous')).map(n => ({ nodes: [n.uid, ...v.outs(n.uid).filter(e => e.out === 'previous').map(e => e.to)] })) },
      { id: 'prev-frame', name: 'Previous Frame / Echo node', match: nodes(['prevFrame', 'echo', 'motionBlur', 'textureFade']) },
      { id: 'history', name: 'Time Cube / Frame Stack history', match: nodes(['timeCube', 'frameStack']) },
    ],
  },
  {
    id: 'deposit-trail', name: 'Deposit, spread, sense', family: 'feedback',
    explain: 'Movers leave marks in a trail that spreads and fades; they steer by what they smell.',
    maths: 'T ← blur(T)·decay + deposits; heading ← f(T ahead)', words: ['slime mould', 'physarum', 'stigmergy', 'trail'],
    slots: { in: [S('agents', 'agents', 'agents')], out: [S('trail', 'texture', 'texture')] },
    variants: [
      { id: 'loop', name: 'Deposit → Trail → back to the agents', match: v => v.ofType('trailField').filter(n => v.ins(n.uid).some(e => v.node(e.from)?.type === 'agentDeposit')).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from), ...v.outs(n.uid).filter(e => e.in === 'trail').map(e => e.to)] })) },
      { id: 'sense', name: 'Sense the trail', match: nodes(['agentSense']) },
    ],
  },

  {
    id: 'cellular-automaton', name: 'Cellular automaton', family: 'feedback',
    explain: 'Each cell reads its neighbours in last frame’s grid and a rule decides its next state.',
    maths: 'sₜ₊₁(i) = rule(sₜ(i), Σ neighbours)', words: ['game of life', 'automaton', 'grid sim', 'rules'],
    slots: { in: [S('rule', 'value', 'float')], out: [S('state', 'texture', 'texture')] },
    variants: [
      { id: 'grid-rules', name: 'Grid Rules node', match: nodes(['gridRules']) },
      { id: 'neighbours', name: 'Neighbours of the previous frame', match: v => v.ofType('textureNeighbours', 'agentNeighbours').map(one) },
      { id: 'pass-compare', name: 'Pass → sample → compare (by hand)', match: v => v.ofType('pass').flatMap(p => { const smp = v.outs(p.uid).filter(e => e.out === 'previous').map(e => v.node(e.to)).filter((n): n is DfNode => !!n); const cmp = smp.flatMap(s => v.downstream(s.uid, 2).filter(m => ['compare', 'step'].includes(m.type))); return cmp.length ? [{ nodes: [p.uid, ...smp.map(n => n.uid), ...cmp.map(n => n.uid)] }] : []; }) },
    ],
  },

  // SDF combination ───────────────────────────────────────────────────────────
  {
    id: 'sdf-boolean', name: 'Union, cut, overlap', family: 'sdfCombine',
    explain: 'Join two shapes with min, cut one out with max(a, −b), keep the overlap with max.',
    maths: 'min(a, b) · max(a, −b) · max(a, b)', words: ['union', 'subtract', 'intersect', 'boolean', 'csg'],
    slots: { in: [S('a', 'distance', 'float'), S('b', 'distance', 'float')], out: [S('distance', 'distance', 'float')] },
    variants: [
      { id: 'node', name: 'Union / Subtract / Intersect node', match: nodes(['sdfUnion', 'sdfSubtract', 'sdfIntersect'], n => !(Number(param(n, 'k') ?? 0) > 0)) },
      { id: 'min', name: 'Min of two shapes', match: v => v.ofType('minMath').filter(n => v.ins(n.uid).filter(e => isShape(v.node(e.from))).length >= 2).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from)] })) },
      { id: 'code', name: 'min / max of distances in code', match: code((_, ids) => ['sdf-union', 'sdf-subtract', 'sdf-intersect'].some(i => ids.includes(i))) },
    ],
  },
  {
    id: 'sdf-smooth', name: 'Smooth union (blobs)', family: 'sdfCombine',
    explain: 'A soft minimum melts shapes together where they meet: metaballs.',
    maths: 'h = clamp(½ + ½(b − a)/k); d = mix(b, a, h) − k·h(1 − h)', words: ['smooth min', 'smin', 'metaballs', 'blob', 'melt'],
    slots: { in: [S('a', 'distance', 'float'), S('b', 'distance', 'float'), S('k', 'value', 'float')], out: [S('distance', 'distance', 'float')] },
    variants: [
      { id: 'node', name: 'Smooth Union node', match: v => [...v.ofType('smoothMin', 'sdfSmoothUnion'), ...v.ofType('sdfUnion').filter(n => Number(param(n, 'k') ?? 0) > 0)].map(one) },
      { id: 'field', name: 'Gaussian field + threshold', match: nodes(['gaussianField', 'metaballThreshold']) },
      { id: 'code', name: 'smin in code', match: code((_, ids) => ['smin-poly', 'smin-exp', 'smin-root', 'smin-weight'].some(i => ids.includes(i))) },
    ],
  },
  {
    id: 'sdf-outline', name: 'Outline (onion)', family: 'sdfCombine',
    explain: 'abs(d) − w turns any filled shape into a ring of width w.',
    maths: 'd′ = |d| − w', words: ['outline', 'onion', 'ring', 'stroke'],
    slots: { in: [S('distance', 'distance', 'float'), S('width', 'value', 'float')], out: [S('distance', 'distance', 'float')] },
    variants: [
      { id: 'node', name: 'Ring / Outline node', match: nodes(['ringSDF', 'distanceShape', 'fieldToLines']) },
      { id: 'abs-shape', name: 'Abs on a distance', match: v => v.ofType('abs').filter(n => v.ins(n.uid).some(e => isShape(v.node(e.from)))).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from)] })) },
      { id: 'code', name: 'abs(d) − w in code', match: code((l, ids) => ids.includes('onion') || ids.includes('ring-sdf') || /abs\s*\(\s*(?:d|dist|r)\w*\s*\)\s*-/.test(l)) },
    ],
  },

  // Noise & texture ───────────────────────────────────────────────────────────
  {
    id: 'fbm', name: 'Layered noise (fBm)', family: 'noise',
    explain: 'Add octaves of noise, each finer and fainter: clouds, terrain, smoke.',
    maths: 'n = Σ ½ⁱ·noise(2ⁱ·p)', words: ['fbm', 'fractal noise', 'clouds', 'octaves'],
    slots: { in: [S('position', 'position', 'vec2'), S('time', 'time', 'float')], out: [S('value', 'value', 'float')] },
    variants: [
      { id: 'node', name: 'Fractal Noise node', match: nodes(['fbm']) },
      { id: 'noise', name: 'Noise / Voronoi node', match: nodes(['noiseFloat', 'voronoi', 'gyroidField', 'magicTexture']) },
      { id: 'code', name: 'octave loop in code', match: code(re(/\b(?:amp|a)\s*\*=\s*0?\.5|\bfbm\w*\s*\(/)) },
    ],
  },
  {
    id: 'animated-noise', name: 'Noise moving with time', family: 'noise',
    explain: 'Wire time into the noise so the texture drifts or boils.',
    maths: 'n = noise(p + v·t)', words: ['animated noise', 'drift', 'boil'],
    slots: { in: [S('position', 'position', 'vec2'), S('time', 'time', 'float')], out: [S('value', 'value', 'float')] },
    variants: [
      { id: 'time-in', name: 'Time into a noise node', match: v => v.ofType(...NOISE_TYPES).filter(n => v.ins(n.uid).some(e => v.node(e.from)?.type === 'time' || v.node(e.from)?.type === 'lfo')).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from).filter(u => ['time', 'lfo'].includes(v.node(u)?.type ?? ''))] })) },
    ],
  },
  {
    id: 'noise-to-colour', name: 'Noise → colour', family: 'noise',
    explain: 'Use the noise value as the palette position: the commonest way to colour noise.',
    maths: 'c = palette(noise(p))', words: ['noise colour', 'clouds colour'],
    slots: { in: [S('value', 'value', 'float')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'chain', name: 'Noise → Palette', match: chain(n => NOISE_TYPES.includes(n.type), m => ['palette', 'palettePreset', 'stopPalette', 'colorRamp', 'colorize'].includes(m.type)) },
    ],
  },

  // Motion ────────────────────────────────────────────────────────────────────
  {
    id: 'oscillate', name: 'Oscillate with time', family: 'motion',
    explain: 'A sine of time makes a value swing back and forth: pulse, breathe, sway.',
    maths: 'v = a + b·sin(ω·t)', words: ['pulse', 'breathe', 'lfo', 'oscillate', 'sway'],
    slots: { in: [S('time', 'time', 'float'), S('speed', 'value', 'float')], out: [S('value', 'value', 'float')] },
    variants: [
      { id: 'lfo', name: 'LFO node', match: nodes(['lfo', 'sineLFO', 'bpmSync']) },
      { id: 'time-sin', name: 'Time → Sin', match: chain(n => n.type === 'time', m => ['sin', 'cos'].includes(m.type)) },
      { id: 'code', name: 'sin(t · k) in code', match: code(re(/\b(?:sin|cos)\s*\(\s*(?:t|time|iTime|u_time)\b/)) },
    ],
  },
  {
    id: 'spin', name: 'Spin with time', family: 'motion',
    explain: 'Rotate the space by an angle that grows with time.',
    maths: 'p′ = rot(ω·t)·p', words: ['spin', 'rotate', 'turn'],
    slots: { in: [S('position', 'position', 'vec2'), S('time', 'time', 'float')], out: [S('position', 'position', 'vec2')] },
    variants: [
      { id: 'node', name: 'Rotate fed by time', match: v => v.ofType('rotate2d', 'rotationMatrix', 'rotate3D', 'uvTransform2d').filter(n => fromAny(v, n, m => m.type === 'time' || m.type === 'lfo', 2).length > 0).map(one) },
      { id: 'code', name: 'rot(t) in code', match: code(re(/rot\w*\s*\(\s*[^;]*\b(?:t|time)\b/)) },
    ],
  },

  // Ray-marched 3D ────────────────────────────────────────────────────────────
  {
    id: 'march-scene', name: 'March a scene', family: 'march3d',
    explain: 'A camera sends a ray per pixel; a loop steps along it by the scene’s distance until it hits.',
    maths: 'tₙ₊₁ = tₙ + sdf(ro + tₙ·rd)', words: ['ray march', 'sphere tracing', '3d', 'camera'],
    slots: { in: [S('scene', 'scene', 'scene3d'), S('camera', 'position', 'vec3')], out: [S('hit colour', 'colour', 'vec3'), S('depth', 'distance', 'float')] },
    variants: [
      { id: 'loop', name: 'Camera → March Loop with a scene', match: v => v.ofType('marchLoopGroup', 'giLitMarchGroup', 'glassScene').filter(n => v.ins(n.uid).some(e => v.node(e.from)?.type === 'marchCamera')).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).map(e => e.from).filter(u => ['marchCamera', 'sceneGroup'].includes(v.node(u)?.type ?? ''))] })) },
      { id: 'fractal', name: 'Raymarch 3D node', match: nodes(['raymarch3d']) },
    ],
  },
  {
    id: 'light-hit', name: 'Light the hit', family: 'march3d',
    explain: 'Shade the surface the ray found: diffuse and specular, then soft shadows and ambient occlusion.',
    maths: 'c = albedo·max(n·l, 0)·shadow·ao + spec', words: ['shading', 'phong', 'shadow', 'ao', 'fresnel'],
    slots: { in: [S('normal', 'position', 'vec3'), S('light dir', 'position', 'vec3')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'lights', name: 'Multi-Light / Blinn-Phong', match: nodes(['multiLight', 'blinnPhong']) },
      { id: 'shadow-ao', name: 'Soft Shadow / AO', match: nodes(['softShadow', 'sdfAo']) },
      { id: 'fresnel', name: 'Fresnel / glass', match: nodes(['fresnelSchlick', 'glass3d', 'refractDir']) },
      { id: 'normal-colour', name: 'Normal as colour', match: nodes(['normalToColor']) },
    ],
  },
  {
    id: 'scene-transform', name: 'Move a shape in the scene', family: 'march3d',
    explain: 'Transform the point before the shape reads it: the shape moves the other way.',
    maths: 'd = sdf(R⁻¹(p − t))', words: ['translate', 'rotate', '3d transform'],
    slots: { in: [S('position', 'position', 'vec3'), S('offset', 'position', 'vec3')], out: [S('position', 'position', 'vec3')] },
    variants: [
      { id: 'node', name: 'Translate / Rotate 3D → shape', match: chain(n => ['translate3D', 'rotate3D', 'transformVec'].includes(n.type), m => catOf(m.type) === '3D Primitives') },
    ],
  },

  // Agents & particles ────────────────────────────────────────────────────────
  {
    id: 'sense-steer-move', name: 'Sense → steer → move', family: 'agents',
    explain: 'Each agent looks ahead, turns toward what it likes, and steps forward.',
    maths: 'h += turn(sense(p + d(h))); p += v·d(h)', words: ['agents', 'boids', 'steer', 'slime'],
    slots: { in: [S('trail', 'texture', 'texture')], out: [S('agents', 'agents', 'agents')] },
    variants: [
      { id: 'nodes', name: 'Sense / Steer / Move nodes', match: v => v.ofType('agentMove').filter(n => v.upstream(n.uid, 3).some(m => m.type === 'agentSense' || m.type === 'agentSteer')).map(n => ({ nodes: [n.uid, ...v.upstream(n.uid, 3).filter(m => ['agentSense', 'agentSteer', 'exprNode'].includes(m.type)).map(m => m.uid)] })) },
      { id: 'code', name: 'Heading rules in code', match: code(re(/\bh\s*\+=|heading\s*=\s*atan/)) },
    ],
  },
  {
    id: 'agent-system', name: 'Emit → agents → draw', family: 'agents',
    explain: 'An Emit gives birth to agents, the Agents group runs their rules each frame, a Draw shows them.',
    maths: 'state ← rules(state); picture = draw(state)', words: ['agents', 'emit', 'swarm', 'simulation'],
    slots: { in: [S('rules', 'agents', 'agents', 'the group\'s insides')], out: [S('picture', 'colour', 'vec3')] },
    variants: [
      { id: 'nodes', name: 'Emit → Agents → Draw / Deposit', match: v => v.ofType('agentsGroup').filter(n => v.ins(n.uid).some(e => v.node(e.from)?.type === 'agentEmit')).map(n => ({ nodes: [n.uid, ...v.ins(n.uid).filter(e => v.node(e.from)?.type === 'agentEmit').map(e => e.from), ...v.outs(n.uid).filter(e => ['drawAgents', 'agentDeposit'].includes(v.node(e.to)?.type ?? '')).map(e => e.to)] })) },
    ],
  },
  {
    id: 'forces', name: 'Forces on movers', family: 'agents',
    explain: 'Push agents or particles with a field: curl noise, gravity, wind, vortex, attraction.',
    maths: 'v += F(p)·dt; p += v·dt', words: ['forces', 'curl noise', 'gravity', 'wind', 'flow'],
    slots: { in: [S('position', 'position', 'vec2')], out: [S('velocity', 'position', 'vec2')] },
    variants: [
      { id: 'node', name: 'Force node', match: nodes(['agentCurl', 'agentAttract', 'agentVortex', 'agentWind', 'agentGravity', 'agentFlow', 'agentSoundKick']) },
      { id: 'integrate', name: 'Integrate velocity', match: nodes(['agentIntegrate']) },
    ],
  },
  {
    id: 'particles', name: 'Particles', family: 'agents',
    explain: 'Many points born, moved and drawn on the GPU.',
    maths: 'pᵢ(t) = pᵢ(0) + ∫ vᵢ dt', words: ['particles', 'sparks', 'dust'],
    slots: { in: [S('emitter', 'position', 'vec2')], out: [S('colour', 'colour', 'vec3')] },
    variants: [
      { id: 'node', name: 'Particles node', match: nodes(['gpuParticles']) },
    ],
  },
];

export const TECHNIQUE_BY_ID: ReadonlyMap<string, Technique> = new Map(TECHNIQUES.map(t => [t.id, t]));
export const FAMILY_BY_ID: ReadonlyMap<FamilyId, Family> = new Map(FAMILIES.map(f => [f.id, f]));
