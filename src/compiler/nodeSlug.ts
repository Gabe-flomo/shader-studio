import type { GraphNode } from '../types/nodeGraph';

/** Short type abbreviations used as GLSL variable prefixes. */
const TYPE_ABBREV: Record<string, string> = {
  // Sources
  uv: 'uv', pixelUv: 'puv', time: 'time', mousePos: 'mouse',
  constant: 'cst', textureInput: 'tex', audioInput: 'audio',
  previousFrame: 'prev', loopIndex: 'idx',
  // Output
  output: 'out', vec4Output: 'out4',
  // Math
  add: 'add', subtract: 'sub', multiply: 'mul', divide: 'div',
  negate: 'neg', abs: 'abs', sin: 'sin', cos: 'cos', tan: 'tan',
  pow: 'pow', exp: 'exp', sqrt: 'sqrt',
  floor: 'flr', ceil: 'ceil', round: 'rnd', fractRaw: 'frac',
  minMath: 'min', maxMath: 'max', clamp: 'clamp', mix: 'mix',
  smoothstep: 'sstep', mod: 'mod', dot: 'dot', length: 'len',
  sign: 'sign', step: 'step', tanh: 'tanh', atan2: 'atan2',
  smoothMin: 'smin',
  // Vector
  makeVec2: 'mkv2', makeVec3: 'mkv3',
  extractX: 'extx', extractY: 'exty', extractZ: 'extz',
  addVec3: 'addv', multiplyVec3: 'mulv', mixVec3: 'mixv',
  floatToVec3: 'f2v',
  // Color
  palette: 'pal', palettePreset: 'palp', colorRamp: 'ramp',
  hsv: 'hsv', blackbody: 'blkb', blendModes: 'blend',
  toneMap: 'tone', desaturate: 'dsat', hueRange: 'huer',
  posterize: 'post', invert: 'inv', grain: 'grain', gradient: 'grad',
  luma: 'luma', brightnessContrast: 'bcon', luminanceTint: 'ltint',
  // Noise / texture
  fbm: 'fbm', noiseFloat: 'noise', voronoi: 'voro', domainWarp: 'dwarp',
  waveTexture: 'wave', magicTexture: 'magic',
  // 2D SDF / light
  circleSDF: 'circ', ringSDF: 'ring', shapeSDF: 'shape',
  makeLight: 'light', remap: 'remap', sdfColorize: 'sdfcol',
  sdBox: 'sbox', sdfOutline: 'outline', glowLayer: 'glow',
  // 2D Warps
  swirlWarp: 'swirl', curlWarp: 'curl', uvWarp: 'uvw', displace: 'disp',
  smoothWarp: 'swrp', swirlSpace: 'swirlsp', polarSpace: 'polar',
  mobiusSpace: 'mobius', infiniteRepeatSpace: 'irrp', hyperbolicSpace: 'hyper',
  kaleidoSpace: 'kali', rotate2d: 'rot2',
  // 3D
  scenePos: 'spos', sceneGroup: 'grp', rayMarch: 'march', rayRender: 'rend',
  sphereSDF3D: 'sph', boxSDF3D: 'box3', torusSDF3D: 'tor',
  planeSDF3D: 'pln', capsuleSDF3D: 'cap', cylinderSDF3D: 'cyl',
  coneSDF3D: 'cone', octahedronSDF3D: 'oct',
  translate3D: 'tr', rotate3D: 'rot', fold3D: 'fold', repeat3D: 'rep',
  scale3D: 'scl', sinWarp3D: 'swrp3', spiralWarp3D: 'spr', rotateAxis3D: 'rota',
  // Domain Repetition (IQ article)
  mirroredRepeat2D: 'mrep2', limitedRepeat2D: 'lrep2', angularRepeat2D: 'arep2',
  mirroredRepeat3D: 'mrep3',
  sdCross3D: 'xcross', mengerSponge: 'menger',
  // Groups / loops
  group: 'grp', loopStart: 'lstart', loopEnd: 'lend',
  marchLoopInputs: 'mli', marchLoopOutput: 'mlo', marchSceneDist: 'msd',
  // Misc
  expr: 'expr', customFn: 'cfn', scope: 'scope',
  sineLFO: 'lfo', squareLFO: 'slfo', sawtoothLFO: 'sawlfo',
  triangleLFO: 'tlfo', bpmSync: 'bpm',
};

/** Convert a human label to a safe GLSL identifier fragment. */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^[^a-z_]+/, '')  // strip any leading non-letter/non-underscore chars
    .replace(/^_+|_+$/g, '')   // strip leading/trailing underscores
    .replace(/__+/g, '_')      // collapse consecutive underscores
    .slice(0, 16);
}

/**
 * Derive a short, human-readable GLSL identifier prefix for a node.
 * Uses the node type abbreviation (or slugified label if set) + the
 * numeric suffix of the node's stored ID for uniqueness.
 *
 * Examples:
 *   node_49 (type: cos)              → cos_49
 *   node_10 (type: grain)            → grain_10
 *   group_1775985976579 (type: grp)  → grp_6579
 *   node_3 (label: "My Warp")        → my_warp_3
 *
 * usedSlugs is mutated to track allocated slugs and prevent collisions.
 */
export function computeNodeSlug(node: GraphNode, usedSlugs: Set<string>): string {
  // Custom label takes priority over type abbreviation
  const customLabel =
    typeof node.params?.label === 'string' && node.params.label.trim()
      ? node.params.label.trim()
      : null;

  let base = customLabel
    ? slugifyLabel(customLabel)
    : (TYPE_ABBREV[node.type] ?? node.type.slice(0, 10).toLowerCase().replace(/[^a-z0-9_]/g, ''));

  // Guard all GLSL identifier rules on the base:
  // 1. gl_ prefix is reserved by the GLSL spec
  if (base.startsWith('gl_')) base = `n_${base}`;
  // 2. Empty base (e.g. label was all special chars) → fall back to type abbrev or 'nd'
  if (!base) base = TYPE_ABBREV[node.type] ?? 'nd';
  // 3. Must not start with a digit
  if (/^\d/.test(base)) base = `n_${base}`;
  // 4. Strip trailing underscores — a base ending in '_' would combine with '_N' suffix
  //    to produce double underscores (e.g. 'const__31') which are reserved in GLSL ES.
  base = base.replace(/_+$/, '');

  // Extract the trailing numeric part from the ID for a short, unique suffix.
  // For node_49 → "49"; for group_1775985976579 → last 4 digits "6579".
  const nums = node.id.match(/\d+/g);
  const rawNum = nums ? nums[nums.length - 1] : '0';
  const num = rawNum.length <= 4 ? rawNum : rawNum.slice(-4);

  let candidate = `${base}_${num}`;
  if (!usedSlugs.has(candidate)) {
    usedSlugs.add(candidate);
    return candidate;
  }
  // Collision fallback (rare — same type + same numeric suffix in one graph)
  let i = 2;
  while (usedSlugs.has(`${candidate}_c${i}`)) i++;
  const final = `${candidate}_c${i}`;
  usedSlugs.add(final);
  return final;
}
