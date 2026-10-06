import { describe, it, expect } from 'vitest';
import { parseExpr, parseLine, splitStatements, pickExplainSpan, matchPattern, IDIOMS, explainExpression, type Expr } from '..';

const expr = (s: string): Expr => { const r = parseExpr(s); if (!r.ok) throw new Error(r.error); return r.expr; };
const T = { uv: 'vec2', p: 'vec2', q: 'vec2', col: 'vec3', c: 'vec3', d: 'float', d1: 'float', d2: 'float', t: 'float', x: 'float', r: 'float', k: 'float', a: 'float', b: 'float', h: 'float' } as const;
const idiomsOf = (s: string) => { const r = explainExpression(s, { types: { ...T } }); if (!r.ok) throw new Error(r.error); return r.idioms.map(h => h.idiom.id); };
const rootIdiom = (s: string) => { const r = explainExpression(s, { types: { ...T } }); if (!r.ok) throw new Error(r.error); return r.idioms.find(h => h.node === r.root)?.idiom.id ?? null; };

describe('parser', () => {
  it('keeps spans, parentheses included', () => {
    const e = expr('fract(sin(uv*3.0)*2.0)');
    expect(e.kind).toBe('call');
    const r = parseExpr('(a + b) * c');
    expect(r.ok && r.expr.kind === 'binary' && r.expr.left.start).toBe(0);
    expect(r.ok && r.expr.kind === 'binary' && r.expr.left.end).toBe(7);
  });
  it('respects precedence and associativity', () => {
    const e = expr('a - b - c');
    expect(e.kind === 'binary' && e.left.kind === 'binary').toBe(true);
    const t = expr('x > 0.5 ? a : b');
    expect(t.kind).toBe('ternary');
  });
  it('reports what it cannot read, never throws', () => {
    expect(parseExpr('sin(').ok).toBe(false);
    expect(parseExpr('a +* b').ok).toBe(false);
    expect(parseExpr('').ok).toBe(false);
  });
  it('splits a line into what it assigns', () => {
    const r = parseLine('float d = length(p) - 0.3;');
    expect(r.ok && r.line.declType).toBe('float');
    expect(r.ok && r.line.target).toBe('d');
    const c = parseLine('p.xy *= 2.0');
    expect(c.ok && c.line.op).toBe('*=');
    const ret = parseLine('return col;');
    expect(ret.ok && ret.line.isReturn).toBe(true);
  });
  it('splits a body into statements, skipping control heads', () => {
    const s = splitStatements('float l = length(p);\nif (l < 0.5) { col = vec3(1.0); }\nreturn col * l;');
    expect(s.map(x => x.text)).toEqual(['float l = length(p)', 'col = vec3(1.0)', 'return col * l']);
    expect(s[2].line).toBe(3);
  });
  it('picks the statement at the caret, or the trimmed selection', () => {
    const code = 'void main() {\n  float d = length(uv) - 0.3;\n  gl_FragColor = vec4(d);\n}';
    const at = code.indexOf('length');
    expect(code.slice(...Object.values(pickExplainSpan(code, { start: at, end: at })!) as [number, number])).toBe('float d = length(uv) - 0.3');
    const s = code.indexOf('length'), e = code.indexOf(';');
    expect(pickExplainSpan(code, { start: s, end: e + 1 })).toEqual({ start: s, end: e });
  });
});

describe('structural matching', () => {
  it('is commutative for + and *', () => {
    expect(matchPattern('$x * 0.5 + 0.5', expr('0.5 + 0.5 * sin(t)'))).not.toBeNull();
    expect(matchPattern('$x * 0.5 + 0.5', expr('0.5 + sin(t) * 0.5'))).not.toBeNull();
    expect(matchPattern('$x * $x * (3.0 - 2.0 * $x)', expr('(3.0 - 2.0 * x) * x * x'))).not.toBeNull();
  });
  it('is not commutative for - and /', () => {
    expect(matchPattern('$a - $b', expr('x - y'))?.a.key).toBe('x');
    expect(matchPattern('1.0 / $d', expr('d / 1.0'))).toBeNull();
  });
  it('tolerates literal spellings and named constants', () => {
    expect(matchPattern('$x * 2.0', expr('x * 2'))).not.toBeNull();
    expect(matchPattern('$x * 6.28318', expr('x * TAU'))).not.toBeNull();
    expect(matchPattern('$x * 6.28318', expr('x * (2.0 * PI)'))).not.toBeNull();
    expect(matchPattern('pow($c, vec3(1.0 / 2.2))', expr('pow(col, vec3(0.4545))'))).not.toBeNull();
    expect(matchPattern('vec3(0.5, 0.5, 0.5)', expr('vec3(0.5)'))).not.toBeNull();
    expect(matchPattern('$x * 2.0', expr('x * 2.1'))).toBeNull();
  });
  it('pulls minus signs out of products', () => {
    for (const s of ['exp(-k * d)', 'exp(-(k * d))', 'exp(k * -d)', 'exp(-d * k)']) expect(matchPattern('exp(-$k * $d)', expr(s)), s).not.toBeNull();
    expect(matchPattern('exp(-#k * $d)', expr('exp(-3.0 * d)'))?.k.value).toBe(3);
  });
  it('requires a repeated hole to bind the same thing', () => {
    expect(matchPattern('smoothstep($r, $r + $w, $x)', expr('smoothstep(r, r + 0.1, x)'))).not.toBeNull();
    expect(matchPattern('smoothstep($r, $r + $w, $x)', expr('smoothstep(r, k + 0.1, x)'))).toBeNull();
  });
  it('folds literal sums (r, r + w as two numbers)', () => {
    const b = matchPattern('smoothstep($r, $r + $w, $x)', expr('smoothstep(0.3, 0.35, x)'));
    expect(b?.r.value).toBe(0.3);
    expect(b?.w.value).toBeCloseTo(0.05, 6);
  });
  it('lets a bare hole take several operands', () => {
    expect(matchPattern('$a + 1.0', expr('x + y + 1.0'))?.a).toBeDefined();
  });
  it('#holes only take numbers', () => {
    expect(matchPattern('fract($p * #n)', expr('fract(uv * 4.0)'))?.n.value).toBe(4);
    expect(matchPattern('fract($p * #n)', expr('fract(uv * k)'))).toBeNull();
  });
});

describe('idiom library', () => {
  it('has 40+ idioms, each with a parsing pattern and unique id', () => {
    expect(IDIOMS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(IDIOMS.map(i => i.id)).size).toBe(IDIOMS.length);
    for (const i of IDIOMS) for (const p of i.patterns) expect(parseExpr(p).ok, `${i.id}: ${p}`).toBe(true);
  });
  const positives: Array<[string, string]> = [
    ['dot(col, vec3(0.299, 0.587, 0.114))', 'luma-601'],
    ['dot(col.rgb, vec3(0.2126, 0.7152, 0.0722))', 'luma-709'],
    ['fract(uv * 8.0)', 'tile'],
    ['sin(t) * 0.5 + 0.5', 'remap-01'],
    ['0.5 + 0.5 * cos(t * 3.0)', 'remap-01'],
    ['uv * 2.0 - 1.0', 'centre-uv'],
    ['(uv - 0.5) * 2.0', 'centre-uv'],
    ['uv - 0.5', 'centre-half'],
    ['smoothstep(0.3, 0.32, length(p))', 'soft-circle'],
    ['1.0 - smoothstep(r, r + 0.01, length(p))', 'soft-circle-inside'],
    ['abs(fract(x) - 0.5)', 'triangle'],
    ['atan(p.y, p.x)', 'angle'],
    ['mat2(cos(a), -sin(a), sin(a), cos(a))', 'rotation-matrix'],
    ['mat2(cos(a), -sin(a), sin(a), cos(a)) * p', 'rotate-mat'],
    ['mix(a, b, t)', 'mix'],
    ['vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)))', 'iq-palette'],
    ['c + c * cos(TAU * (c * t + c))', 'iq-palette'],
    ['exp(-4.0 * d)', 'glow-exp'],
    ['1.0 / (1.0 + 20.0 * d)', 'glow-inv'],
    ['0.02 / abs(d)', 'glow-over'],
    ['mix(b, a, h) - k * h * (1.0 - h)', 'smin-poly'],
    ['-log(exp(-k * a) + exp(-k * b)) / k', 'smin-exp'],
    ['clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)', 'smin-weight'],
    ['step(0.5, x)', 'step-threshold'],
    ['length(p) - 0.25', 'circle-sdf'],
    ['length(max(abs(p) - vec2(0.3), 0.0))', 'box-sdf-outside'],
    ['abs(p) - vec2(0.3, 0.2)', 'box-offsets'],
    ['floor(uv * 10.0)', 'cell-id'],
    ['fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453)', 'hash-sin-dot'],
    ['mod(p, 2.0)', 'mod-repeat'],
    ['vec2(length(p), atan(p.y, p.x))', 'polar'],
    ['normalize(p)', 'normalize'],
    ['clamp(x, 0.0, 1.0)', 'saturate'],
    ['pow(col, vec3(1.0 / 2.2))', 'gamma-encode'],
    ['pow(col, vec3(2.2))', 'gamma-decode'],
    ['x * x * (3.0 - 2.0 * x)', 'smoothstep-hand'],
    ['abs(length(p) - 0.4)', 'ring-sdf'],
    ['step(0.3, x) - step(0.6, x)', 'step-band'],
    ['floor(x * 4.0) / 4.0', 'quantise'],
    ['(col - 0.5) * 1.2 + 0.5', 'contrast'],
    ['gl_FragCoord.xy / u_resolution.xy', 'screen-uv'],
    ['(2.0 * gl_FragCoord.xy - u_resolution.xy) / u_resolution.y', 'centred-aspect-uv'],
    ['dot(p, p)', 'dot-self'],
    ['(x - a) / (b - a)', 'inverse-lerp'],
    ['mix(a, b, 0.5)', 'mix-half'],
    ['sin(length(p) * 20.0 - t)', 'rings'],
    ['1.0 - x', 'invert'],
  ];
  it.each(positives)('recognises %s as %s', (src, id) => {
    expect(rootIdiom(src)).toBe(id);
  });
  const negatives: Array<[string, string]> = [
    ['fract(sin(uv * 3.0) * 2.0)', 'hash-sin'],          // the multiplier is too small for a hash
    ['fract(sin(uv * 3.0) * 2.0)', 'tile'],              // sin of space is waves, not space
    ['dot(col, vec3(0.3, 0.6, 0.1))', 'luma-601'],       // other weights
    ['uv * 3.0 - 1.0', 'centre-uv'],
    ['smoothstep(0.35, 0.3, length(p))', 'soft-circle'], // reversed edges fill instead
    ['x - 0.5', 'centre-half'],                          // a float isn't UV
    ['min(a, b)', 'sdf-union'],                          // plain floats, not distances
    ['step(0.5, x)', 'step-threshold-inv'],
    ['abs(fract(x) - 0.4)', 'triangle'],
  ];
  it.each(negatives)('does not take %s for %s', (src, id) => {
    expect(idiomsOf(src)).not.toContain(id);
  });
  it('matches SDF min as a union only for distances', () => {
    expect(rootIdiom('min(d1, d2)')).toBe('sdf-union');
  });
});
