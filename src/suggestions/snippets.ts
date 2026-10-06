/**
 * snippets.ts — the snippet library of the code editors' Functions panel (docs/suggestions.md):
 * smooth-min, SDF ops (round, onion, repeat), IQ's cosine palette, hash and value noise,
 * rotate2d, polar, remap, gain / bias.
 *
 * Each snippet has two forms:
 *  - Expression Block: lines (an Expression Block can't hold functions), its variables wired to
 *    the block's own (the first float the snippet reads takes the block's first float, and so on;
 *    what is left becomes a literal), temporaries renamed when a name is taken;
 *  - Custom Function: a helper function for "Helper functions" (added once) and a call to it
 *    inserted at the caret, its arguments the function's own inputs where the types match.
 *    Helper names avoid the built-in nodes' own functions (smin, opRepeat, valueNoise), which
 *    would clash in a graph that also uses those nodes.
 *
 * Searchable by name and by the phrases people use ("smooth min", "melt", "hash").
 */
type T = 'float' | 'vec2' | 'vec3';

export interface Snippet {
  id: string;
  label: string;
  phrases: string[];
  doc: string;
  /** What it reads, in order: matched to the block's variables by type, else `fallback`. */
  args: Array<{ name: string; type: T; fallback: string }>;
  returns: T;
  /** Expression Block lines: `@arg` is an argument, `$name` a temporary; the last line declares the result. */
  lines: Array<[lhs: string, rhs: string]>;
  /** Custom Function: the helper function(s), and the call (`@arg` per argument). */
  helper: string;
  call: string;
}

export const SNIPPETS: readonly Snippet[] = [
  {
    id: 'smin', label: 'Smooth min', phrases: ['smooth min', 'smin', 'smooth union', 'melt', 'blend shapes', 'soft min'],
    doc: 'The smaller of two distances, melted over k: two shapes flow into one (Inigo Quilez, polynomial smin).',
    args: [{ name: 'a', type: 'float', fallback: '0.0' }, { name: 'b', type: 'float', fallback: '0.0' }, { name: 'k', type: 'float', fallback: '0.1' }],
    returns: 'float',
    lines: [['float $h', 'clamp(0.5 + 0.5 * (@b - @a) / @k, 0.0, 1.0)'], ['float $smin', 'mix(@b, @a, $h) - @k * $h * (1.0 - $h)']],
    helper: 'float sminPoly(float a, float b, float k) {\n  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);\n  return mix(b, a, h) - k * h * (1.0 - h);\n}',
    call: 'sminPoly(@a, @b, @k)',
  },
  {
    id: 'smax', label: 'Smooth max', phrases: ['smooth max', 'smax', 'smooth intersect', 'soft max'],
    doc: 'The larger of two distances, rounded over k (a smooth intersection).',
    args: [{ name: 'a', type: 'float', fallback: '0.0' }, { name: 'b', type: 'float', fallback: '0.0' }, { name: 'k', type: 'float', fallback: '0.1' }],
    returns: 'float',
    lines: [['float $h', 'clamp(0.5 - 0.5 * (@b - @a) / @k, 0.0, 1.0)'], ['float $smax', 'mix(@b, @a, $h) + @k * $h * (1.0 - $h)']],
    helper: 'float smax(float a, float b, float k) {\n  float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);\n  return mix(b, a, h) + k * h * (1.0 - h);\n}',
    call: 'smax(@a, @b, @k)',
  },
  {
    id: 'sdRound', label: 'SDF round', phrases: ['round', 'rounded', 'grow', 'offset', 'inflate', 'round corners'],
    doc: 'Grows a shape by r, rounding every corner by the same amount.',
    args: [{ name: 'd', type: 'float', fallback: '0.0' }, { name: 'r', type: 'float', fallback: '0.05' }],
    returns: 'float',
    lines: [['float $rounded', '@d - @r']],
    helper: 'float opRound(float d, float r) {\n  return d - r;\n}',
    call: 'opRound(@d, @r)',
  },
  {
    id: 'sdOnion', label: 'SDF onion', phrases: ['onion', 'shell', 'hollow', 'outline shape', 'ring of'],
    doc: 'A shell of thickness r round the shape\'s edge.',
    args: [{ name: 'd', type: 'float', fallback: '0.0' }, { name: 'r', type: 'float', fallback: '0.02' }],
    returns: 'float',
    lines: [['float $shell', 'abs(@d) - @r']],
    helper: 'float opOnion(float d, float r) {\n  return abs(d) - r;\n}',
    call: 'opOnion(@d, @r)',
  },
  {
    id: 'opRepeat', label: 'SDF repeat', phrases: ['repeat', 'tile', 'grid', 'domain repetition', 'copies'],
    doc: 'Repeats space every s: each cell centred on (0, 0), so a shape drawn in it appears in every cell.',
    args: [{ name: 'p', type: 'vec2', fallback: 'vec2(0.0)' }, { name: 's', type: 'float', fallback: '0.5' }],
    returns: 'vec2',
    lines: [['vec2 $cell', '@p - @s * floor(@p / @s + 0.5)']],
    helper: 'vec2 repeatCell(vec2 p, float s) {\n  return p - s * floor(p / s + 0.5);\n}',
    call: 'repeatCell(@p, @s)',
  },
  {
    id: 'cosPalette', label: 'Cosine palette (IQ)', phrases: ['palette', 'cosine palette', 'iq palette', 'rainbow', 'colour from number', 'color ramp', 'gradient'],
    doc: 'Inigo Quilez\'s cosine palette: a + b·cos(2π(c·t + d)). Change d for other colour sets.',
    args: [{ name: 't', type: 'float', fallback: '0.0' }],
    returns: 'vec3',
    lines: [['vec3 $col', 'vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0) * @t + vec3(0.0, 0.33, 0.67)))']],
    helper: 'vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {\n  return a + b * cos(6.28318 * (c * t + d));\n}',
    call: 'cosPalette(@t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67))',
  },
  {
    id: 'hash21', label: 'Hash (vec2 → float)', phrases: ['hash', 'random', 'rand', 'white noise', 'per cell random'],
    doc: 'A pseudo-random number 0…1 for every point: the same point always gives the same number.',
    args: [{ name: 'p', type: 'vec2', fallback: 'vec2(0.0)' }],
    returns: 'float',
    lines: [['float $rnd', 'fract(sin(dot(@p, vec2(127.1, 311.7))) * 43758.5453)']],
    helper: 'float hash21(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}',
    call: 'hash21(@p)',
  },
  {
    id: 'valueNoise', label: 'Value noise', phrases: ['noise', 'value noise', 'smooth noise', 'perlin', 'clouds'],
    doc: 'Smooth noise 0…1: random values at the grid corners, blended smoothly between.',
    args: [{ name: 'p', type: 'vec2', fallback: 'vec2(0.0)' }],
    returns: 'float',
    lines: [
      ['vec2 $i', 'floor(@p)'], ['vec2 $f', 'fract(@p)'], ['vec2 $u', '$f * $f * (3.0 - 2.0 * $f)'],
      ['float $n00', 'fract(sin(dot($i, vec2(127.1, 311.7))) * 43758.5453)'],
      ['float $n10', 'fract(sin(dot($i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453)'],
      ['float $n01', 'fract(sin(dot($i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453)'],
      ['float $n11', 'fract(sin(dot($i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453)'],
      ['float $noise', 'mix(mix($n00, $n10, $u.x), mix($n01, $n11, $u.x), $u.y)'],
    ],
    helper: 'float vnHash(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}\nfloat valueNoise2(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  return mix(mix(vnHash(i), vnHash(i + vec2(1.0, 0.0)), u.x), mix(vnHash(i + vec2(0.0, 1.0)), vnHash(i + vec2(1.0, 1.0)), u.x), u.y);\n}',
    call: 'valueNoise2(@p)',
  },
  {
    id: 'rotate2d', label: 'Rotate 2D', phrases: ['rotate', 'turn', 'spin', 'rotation matrix', 'rot2d'],
    doc: 'Turns a point by a radians round (0, 0).',
    args: [{ name: 'p', type: 'vec2', fallback: 'vec2(0.0)' }, { name: 'a', type: 'float', fallback: '0.5' }],
    returns: 'vec2',
    lines: [['vec2 $turned', 'mat2(cos(@a), sin(@a), -sin(@a), cos(@a)) * @p']],
    helper: 'vec2 rotate2d(vec2 p, float a) {\n  float c = cos(a), s = sin(a);\n  return mat2(c, s, -s, c) * p;\n}',
    call: 'rotate2d(@p, @a)',
  },
  {
    id: 'polar', label: 'To polar', phrases: ['polar', 'angle and radius', 'atan', 'radial'],
    doc: 'A point as (angle −π…π, distance from the centre).',
    args: [{ name: 'p', type: 'vec2', fallback: 'vec2(0.0)' }],
    returns: 'vec2',
    lines: [['vec2 $polar', 'vec2(atan(@p.y, @p.x), length(@p))']],
    helper: 'vec2 toPolar(vec2 p) {\n  return vec2(atan(p.y, p.x), length(p));\n}',
    call: 'toPolar(@p)',
  },
  {
    id: 'remap', label: 'Remap', phrases: ['remap', 'map range', 'rescale', 'normalize', 'fit'],
    doc: 'x from inMin…inMax to outMin…outMax.',
    args: [{ name: 'x', type: 'float', fallback: '0.0' }, { name: 'inMin', type: 'float', fallback: '0.0' }, { name: 'inMax', type: 'float', fallback: '1.0' }, { name: 'outMin', type: 'float', fallback: '0.0' }, { name: 'outMax', type: 'float', fallback: '1.0' }],
    returns: 'float',
    lines: [['float $mapped', '@outMin + (@x - @inMin) * (@outMax - @outMin) / (@inMax - @inMin)']],
    helper: 'float remap(float x, float inMin, float inMax, float outMin, float outMax) {\n  return outMin + (x - inMin) * (outMax - outMin) / (inMax - inMin);\n}',
    call: 'remap(@x, @inMin, @inMax, @outMin, @outMax)',
  },
  {
    id: 'gain', label: 'Gain', phrases: ['gain', 'contrast curve', 's curve', 'ease in out'],
    doc: 'An S-curve on 0…1: k > 1 pushes values toward 0 and 1, k < 1 toward ½ (Inigo Quilez).',
    args: [{ name: 'x', type: 'float', fallback: '0.0' }, { name: 'k', type: 'float', fallback: '2.0' }],
    returns: 'float',
    lines: [['float $g', '0.5 * pow(2.0 * ((@x < 0.5) ? @x : 1.0 - @x), @k)'], ['float $gained', '(@x < 0.5) ? $g : 1.0 - $g']],
    helper: 'float gain(float x, float k) {\n  float a = 0.5 * pow(2.0 * ((x < 0.5) ? x : 1.0 - x), k);\n  return (x < 0.5) ? a : 1.0 - a;\n}',
    call: 'gain(@x, @k)',
  },
  {
    id: 'bias', label: 'Bias', phrases: ['bias', 'skew', 'push', 'curve', 'gamma'],
    doc: 'Bends 0…1 toward 0 (b < ½) or 1 (b > ½); b = ½ leaves it (Schlick bias).',
    args: [{ name: 'x', type: 'float', fallback: '0.0' }, { name: 'b', type: 'float', fallback: '0.7' }],
    returns: 'float',
    lines: [['float $biased', '@x / ((1.0 / @b - 2.0) * (1.0 - @x) + 1.0)']],
    helper: 'float bias(float x, float b) {\n  return x / ((1.0 / b - 2.0) * (1.0 - x) + 1.0);\n}',
    call: 'bias(@x, @b)',
  },
];

/** Snippets for a search (name, then phrases, then the doc); all of them for an empty one. */
export function searchSnippets(query: string): Snippet[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SNIPPETS];
  const score = (s: Snippet) => {
    if (s.label.toLowerCase().startsWith(q) || s.id.toLowerCase() === q) return 3;
    if (s.phrases.some(p => p.startsWith(q) || q.includes(p))) return 2;
    if (s.label.toLowerCase().includes(q) || s.phrases.some(p => p.includes(q))) return 1.5;
    return s.doc.toLowerCase().includes(q) ? 1 : 0;
  };
  return SNIPPETS.map(s => ({ s, v: score(s) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).map(x => x.s);
}

/** Pick, for each argument, a variable of the same type (each used once), else its fallback. */
function bind(snippet: Snippet, vars: ReadonlyArray<{ name: string; type: string }>): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const a of snippet.args) {
    const v = vars.find(x => x.type === a.type && !used.has(x.name));
    if (v) { used.add(v.name); out[a.name] = v.name; } else out[a.name] = a.fallback;
  }
  return out;
}

const fill = (text: string, args: Record<string, string>) => text.replace(/@([A-Za-z_]\w*)/g, (m, nm: string) => args[nm] ?? m);

/**
 * The lines to append to an Expression Block: arguments wired to its variables (`inputs` and
 * the variables its lines declare), temporaries renamed past any name already taken. Returns the
 * lines and the variable holding the result.
 */
export function snippetLines(snippet: Snippet, inputs: ReadonlyArray<{ name: string; type: string }>, lines: ReadonlyArray<{ lhs: string }>): { lines: Array<{ lhs: string; op: string; rhs: string }>; result: string; resultType: T } {
  const declared = lines.map(l => /^\s*(float|vec[234]|int|mat[234])\s+([A-Za-z_]\w*)/.exec(l.lhs)).filter((m): m is RegExpExecArray => !!m).map(m => ({ name: m[2], type: m[1] }));
  const vars = [...inputs, ...declared];
  const taken = new Set(vars.map(v => v.name));
  const temps = new Map<string, string>();
  for (const [lhs] of snippet.lines) {
    const m = /\$([A-Za-z_]\w*)/.exec(lhs);
    if (!m) continue;
    let name = m[1], k = 2;
    while (taken.has(name)) name = `${m[1]}${k++}`;
    taken.add(name);
    temps.set(m[1], name);
  }
  const args = bind(snippet, vars);
  const sub = (text: string) => fill(text, args).replace(/\$([A-Za-z_]\w*)/g, (_, nm: string) => temps.get(nm) ?? nm);
  const out = snippet.lines.map(([lhs, rhs]) => ({ lhs: sub(lhs), op: '=', rhs: sub(rhs) }));
  const last = /\s([A-Za-z_]\w*)$/.exec(out[out.length - 1].lhs)![1];
  return { lines: out, result: last, resultType: snippet.returns };
}

/** The helper functions and the call for a Custom Function. `helpers` gets the snippet's helper once. */
export function snippetForFunction(snippet: Snippet, inputs: ReadonlyArray<{ name: string; type: string }>, helpers: string): { helpers: string; call: string } {
  const fnName = /\b(?:float|vec[234])\s+([A-Za-z_]\w*)\s*\(/g;
  const have = new Set([...helpers.matchAll(fnName)].map(m => m[1]));
  const wanted = [...snippet.helper.matchAll(fnName)].map(m => m[1]);
  const add = wanted.every(nm => have.has(nm)) ? '' : snippet.helper;
  const next = add ? `${helpers.trim() ? `${helpers.trimEnd()}\n\n` : ''}${add}\n` : helpers;
  return { helpers: next, call: fill(snippet.call, bind(snippet, inputs)) };
}
