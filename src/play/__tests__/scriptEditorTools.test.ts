import { describe, expect, it } from 'vitest';
import { KL_SKETCH_NAMES, klSketchCompile, klSketchPress, klSketchStep } from '../kit/layers.js';
import { addControl, placeCode, topLevelNames } from '../../components/play/layers/scriptTools';
import { extractScriptParams } from '../../components/play/layers/scriptExamples';
import { SCRIPT_REFERENCE, refInsert, refSignature } from '../../components/play/layers/scriptReference';
import { SCRIPT_SNIPPETS } from '../../components/play/layers/scriptSnippets';
import { scriptCompletions } from '../../components/play/layers/scriptCompletions';
import { changedLines } from '../../components/code/lineDiff';

// A canvas context that accepts anything: every property is a callable that returns the same thing (gradients, measureText…).
const anyCtx = (): CanvasRenderingContext2D => {
  const p: unknown = new Proxy(function () {}, { get: () => p, set: () => true, apply: () => p });
  return p as CanvasRenderingContext2D;
};
const frame = (ctx: CanvasRenderingContext2D, params: Record<string, number>, i: number) => ({
  ctx, width: 320, height: 180, dpr: 1, time: i / 60, dt: 1 / 60, frame: i, params, state: {},
  mouse: { x: 100, y: 60, over: true, down: i % 2 === 0 }, picture: { brightness: () => 0.5 }, null: () => null, random: Math.random,
}) as Record<string, unknown>;

// The runner keeps the sketch's s.state on the compiled sketch (ScriptPreview reads it the same way).
const stateOf = (st: object) => (st as unknown as { state: Record<string, unknown> }).state;

/** Compiles, and runs a few frames (pressing every button once) without an error. */
function runs(code: string): string | null {
  const st = klSketchCompile(code);
  if (st.error) return st.error;
  const r = extractScriptParams(code);
  if (!r.ok) return r.error;
  const params = Object.fromEntries(r.defs.map(d => [d.key, d.value]));
  const ctx = anyCtx();
  for (let i = 0; i < 4; i++) {
    if (i === 2) for (const d of r.defs) if (d.kind === 'button') klSketchPress(st, d.key, 1);
    const err = klSketchStep(st, { ...frame(ctx, { ...params }, i), state: stateOf(st) }, r.defs, true);
    if (err) return err;
  }
  return null;
}

const SKETCH = `const params = {
  speed: { value: 1, min: 0, max: 4 },
};
let dots = [];

// setup runs once
function setup(s) {
  dots = [];
}

function draw(s) {
  background(20);
  circle(10, 10, 5);
}
`;

describe('placeCode', () => {
  it('puts a top-level pattern after the declarations, before setup and its comment', () => {
    const out = placeCode(SKETCH, 'top', 'function palette(i) { return hsl(i, 80, 60); }\n');
    expect(out).toContain('let dots = [];\n\nfunction palette(i) { return hsl(i, 80, 60); }\n\n// setup runs once\nfunction setup(s) {');
    expect(runs(out)).toBeNull();
  });
  it('appends a top-level pattern when there is no setup or draw', () => {
    expect(placeCode('let a = 1;\n', 'top', 'let b = 2;\n')).toBe('let a = 1;\n\nlet b = 2;\n');
    expect(placeCode('', 'top', 'let b = 2;\n')).toBe('let b = 2;\n');
  });
  it('puts setup and draw patterns at the end of those functions, at their indent', () => {
    const out = placeCode(placeCode(SKETCH, 'setup', 's.state.items = [];\n'), 'draw', 'if (mouseIsPressed) {\n  fill(255);\n}\n');
    expect(out).toContain('  dots = [];\n  s.state.items = [];\n}');
    expect(out).toContain('  circle(10, 10, 5);\n  if (mouseIsPressed) {\n    fill(255);\n  }\n}');
    expect(runs(out)).toBeNull();
  });
  it('creates setup (before draw) or draw when the sketch has none', () => {
    const noSetup = 'function draw(s) {\n  background(0);\n}\n';
    expect(placeCode(noSetup, 'setup', 's.state.n = 0;')).toBe('function setup(s) {\n  s.state.n = 0;\n}\n\nfunction draw(s) {\n  background(0);\n}\n');
    expect(placeCode('let a = 1;\n', 'draw', 'circle(a, a, 4);')).toBe('let a = 1;\n\nfunction draw(s) {\n  circle(a, a, 4);\n}\n');
  });
  it('opens up a one-line function and goes before a trailing return', () => {
    expect(placeCode('function draw(s) { background(0); }\n', 'draw', 'circle(1, 1, 1);')).toBe('function draw(s) {\n  background(0);\n  circle(1, 1, 1);\n}\n');
    expect(placeCode('function draw(s) {}\n', 'draw', 'circle(1, 1, 1);')).toBe('function draw(s) {\n  circle(1, 1, 1);\n}\n');
    const ret = 'function draw(s) {\n  if (!s.state.on) return;\n  background(0);\n  return;\n}\n';
    expect(placeCode(ret, 'draw', 'circle(1, 1, 1);')).toBe('function draw(s) {\n  if (!s.state.on) return;\n  background(0);\n  circle(1, 1, 1);\n  return;\n}\n');
  });
  it('uses a blank line under the caret inside the function', () => {
    const code = 'function draw(s) {\n  background(0);\n  \n  circle(1, 1, 1);\n}\n';
    const caret = code.indexOf('  \n') + 2;
    expect(placeCode(code, 'draw', 'fill(255);', caret)).toBe('function draw(s) {\n  background(0);\n  fill(255);\n  circle(1, 1, 1);\n}\n');
    // A caret outside draw, or on a line with code, is ignored.
    expect(placeCode(code, 'draw', 'fill(255);', 3)).toContain('  circle(1, 1, 1);\n  fill(255);\n}');
  });
  it('lifts a pattern’s settings to the top (once), and follows draw’s own parameter name', () => {
    const code = 'function draw(p) {\n  background(0);\n}\n';
    const once = placeCode(code, 'draw', 'let radius = 120, speed = 1;\ncircle(s.width / 2, s.height / 2, radius * speed);\n');
    expect(once).toBe('let radius = 120;\nlet speed = 1;\n\nfunction draw(p) {\n  background(0);\n  circle(p.width / 2, p.height / 2, radius * speed);\n}\n');
    const twice = placeCode(once, 'draw', 'let radius = 120, speed = 1;\ncircle(0, 0, radius);\n');
    expect(twice.match(/let radius/g)).toHaveLength(1);
    expect(runs(twice.replace(/\bp\b/g, 's'))).toBeNull();
  });
  it('merges a params pattern into the sketch’s params, skipping keys it has', () => {
    const params = SCRIPT_SNIPPETS.find(sn => sn.name === 'Params: every kind')!;
    const out = placeCode(SKETCH.replace('max: 4 },', 'max: 4 },            // how fast'), 'top', params.code);
    expect(out.match(/const params/g)).toHaveLength(1);
    expect(out).toContain('speed: { value: 1, min: 0, max: 4 },            // how fast');
    const r = extractScriptParams(out);
    expect(r.ok && r.defs.map(d => d.key)).toEqual(['speed', 'size', 'glow', 'reset']);
    expect(runs(out)).toBeNull();
  });
  it('every pattern goes into every starter shape and still runs', () => {
    const shapes = [SKETCH, 'function draw(s) { background(0); }\n', 'function setup(s) {}\nfunction draw(s) {}\n'];
    for (const sn of SCRIPT_SNIPPETS) for (const shape of shapes) {
      // Patterns that expect an object p get one.
      const code = placeCode(shape, sn.where, sn.code);
      const withP = /\bp\./.test(sn.code) && !/\bp\b\s*(=|of)/.test(sn.code) ? placeCode(code, 'top', 'const p = { x: 1, y: 1, vx: 1, vy: 1 };') : code;
      expect(runs(withP), `${sn.name} in ${JSON.stringify(shape)}`).toBeNull();
    }
  });
});

describe('addControl', () => {
  it('adds a slider to params and a let the slider drives', () => {
    const r = addControl(SKETCH, { key: 'size', kind: 'slider', value: 12, min: 2, max: 40 });
    if ('error' in r) throw new Error(r.error);
    expect(r.entry).toBe("size: { value: 12, min: 2, max: 40, label: 'Size' }");
    expect(r.startAt).toBe(12);
    expect(r.code).toContain("  speed: { value: 1, min: 0, max: 4 },\n  size: { value: 12, min: 2, max: 40, label: 'Size' },\n};");
    expect(r.code).toContain('let dots = [];\n\nlet size = 12;\n\n// setup runs once');
    expect(runs(r.code)).toBeNull();
  });
  it('a counting slider can add a loop in draw, or an array made in setup and kept at the count in draw', () => {
    const loop = addControl(SKETCH, { key: 'count', kind: 'slider', value: 5.4, min: 0, max: 50, helper: 'loop' });
    if ('error' in loop) throw new Error(loop.error);
    expect(loop.entry).toContain('value: 5, min: 0, max: 50, step: 1');
    expect(loop.code).toMatch(/function draw\(s\) \{[\s\S]*for \(let i = 0; i < count; i\+\+\) \{[\s\S]*\n\}\n$/);
    expect(runs(loop.code)).toBeNull();

    const arr = addControl('function draw(s) {\n  background(0);\n}\n', { key: 'dotCount', kind: 'slider', value: 8, min: 1, max: 100, helper: 'array' });
    if ('error' in arr) throw new Error(arr.error);
    expect(arr.code).toContain('function setup(s) {\n  s.state.items = [];\n}\n\nfunction draw(s) {');
    expect(arr.code).toContain('while (s.state.items.length < dotCount)');
    expect(runs(arr.code)).toBeNull();
    // The array follows the slider: 8 items, then 3 when it is turned down.
    const st = klSketchCompile(arr.code);
    const r = extractScriptParams(arr.code);
    if (!r.ok) throw new Error(r.error);
    const ctx = anyCtx();
    const items = () => stateOf(st).items as unknown[];
    expect(klSketchStep(st, frame(ctx, { dotCount: 8 }, 0), r.defs, true)).toBeNull();
    expect(items()).toHaveLength(8);
    expect(klSketchStep(st, { ...frame(ctx, { dotCount: 3 }, 1), state: stateOf(st) }, r.defs, true)).toBeNull();
    expect(items()).toHaveLength(3);
  });
  it('adds toggles and buttons with their if blocks', () => {
    const t = addControl(SKETCH, { key: 'glow', kind: 'toggle', value: false, helper: 'if', label: "Glow's on" });
    if ('error' in t) throw new Error(t.error);
    expect(t.entry).toBe("glow: { kind: 'toggle', value: false, label: 'Glow\\'s on' }");
    expect(t.startAt).toBe(0);
    expect(t.code).toContain('let glow = false;');
    expect(t.code).toContain('  if (glow) {\n');
    const b = addControl(t.code, { key: 'burst', kind: 'button', helper: 'if' });
    if ('error' in b) throw new Error(b.error);
    expect(b.code).toContain("burst: { kind: 'button', label: 'Burst' }");
    expect(b.code).toContain("  if (s.pressed('burst')) {\n");
    expect(runs(b.code)).toBeNull();
    const r = extractScriptParams(b.code);
    expect(r.ok && r.defs.map(d => [d.key, d.kind ?? 'slider', d.label])).toEqual([['speed', 'slider', 'speed'], ['glow', 'toggle', "Glow's on"], ['burst', 'button', 'Burst']]);
  });
  it('makes params when there are none, and refuses names it cannot use', () => {
    const r = addControl('function draw(s) {}\n', { key: 'n', kind: 'slider' });
    if ('error' in r) throw new Error(r.error);
    expect(r.code.startsWith('const params = {\n  n: { value: 0, min: 0, max: 1')).toBe(true);
    const bad = (key: string) => { const x = addControl(SKETCH, { key, kind: 'slider' }, KL_SKETCH_NAMES); return 'error' in x ? x.error : null; };
    expect(bad('')).toMatch(/name/);
    expect(bad('2fast')).toMatch(/Letters/);
    expect(bad('speed')).toMatch(/already has a control/);
    expect(bad('dots')).toMatch(/already declared/);
    expect(bad('circle')).toMatch(/built-in/);
    expect(bad('draw')).toMatch(/built-in/);
    expect(addControl(SKETCH, { key: 'x', kind: 'slider', min: 5, max: 1 })).toEqual({ error: 'Max has to be more than min.' });
  });
  it('reads top-level names, including several in one declaration', () => {
    expect([...topLevelNames('let a = 1, b = 2;\nconst c = 3;\nfunction d() {}\n  let inner = 1;\n')]).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('reference', () => {
  const items = SCRIPT_REFERENCE.flatMap(g => g.items);
  it('every entry has a signature: one name, typed parameters, a return type, a description and an example', () => {
    for (const it of items) {
      expect(it.name, it.name).toMatch(/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/);
      expect(it.type.trim(), it.name).not.toBe('');
      expect(it.doc.trim(), it.name).not.toBe('');
      expect(it.example.trim(), it.name).not.toBe('');
      for (const a of it.args ?? []) {
        expect(a.name, it.name).toMatch(/^[A-Za-z_]\w*$/);
        expect(a.type.trim() && a.doc.trim(), `${it.name}(${a.name})`).toBeTruthy();
      }
      // An optional parameter is never followed by a required one.
      const opt = (it.args ?? []).map(a => !!a.optional);
      expect(opt.indexOf(true) < 0 || opt.slice(opt.indexOf(true)).every(Boolean), it.name).toBe(true);
    }
    expect(new Set(items.map(it => it.name)).size).toBe(items.length);
  });
  it('covers every helper the kit provides, with the kit’s number of parameters', () => {
    const names = new Set(items.map(it => it.name));
    for (const n of KL_SKETCH_NAMES) expect(names.has(n), n).toBe(true);
    const signatures: Record<string, string> = { circle: '(x, y, d)', rect: '(x, y, w, [h], [r])', map: '(v, a, b, c, d, [clamp])', hsl: '(h, s, l, [a])', 's.picture.brightness': '(x, y)', millis: '()' };
    for (const [n, sig] of Object.entries(signatures)) expect(refSignature(items.find(it => it.name === n)!)).toBe(sig);
    expect(refInsert(items.find(it => it.name === 'dist')!)).toBe('dist(x1, y1, x2, y2)');
  });
  it('every example compiles', () => {
    for (const it of items) {
      const body = /^function (setup|draw)\b/.test(it.example) || it.name === 'params' ? it.example : `function draw(s) {\n${it.example}\n}`;
      expect(klSketchCompile(/function draw\b/.test(body) ? body : `${body}\nfunction draw(s) {}`).error, it.name).toBeNull();
    }
  });
  it('autocomplete carries the signature, parameters and example', () => {
    const c = scriptCompletions('').all.find(x => x.name === 'circle')!;
    expect(c).toMatchObject({ kind: 'fn', detail: '(x, y, d)', insert: 'circle(x, y, 20)' });
    expect(c.args?.map(a => a.name)).toEqual(['x', 'y', 'd']);
    expect(c.example).toContain('circle(');
    const dist = scriptCompletions('').all.find(x => x.name === 'dist')!;
    expect(dist).toMatchObject({ type: 'number', insert: 'dist()' });
    const brightness = scriptCompletions('').members.s.find(x => x.name === 'picture.brightness')!;
    expect(brightness).toMatchObject({ detail: '(x, y)', type: 'number', insert: 'picture.brightness()' });
    expect(scriptCompletions('').members.s.find(x => x.name === 'null')!.insert).toBe("null('Sun')");
    expect(scriptCompletions('').members.s.find(x => x.name === 'time')).toMatchObject({ kind: 'const', type: 'number' });
  });
});

describe('patterns', () => {
  it('every pattern has an example sketch that uses it and runs', () => {
    for (const sn of SCRIPT_SNIPPETS) {
      expect(sn.example.trim(), sn.name).not.toBe('');
      // The pattern's first line of real code starts a line of its example.
      const first = sn.code.split('\n').find(l => l.trim() && !/^\s*(\/\/|let )/.test(l))!.trim();
      expect(sn.example, sn.name).toContain(first.slice(0, 22));
      expect(runs(sn.example), sn.name).toBeNull();
    }
  });
});

describe('changedLines', () => {
  it('finds the runs of lines an insert added', () => {
    expect(changedLines('a\nb\nc', 'a\nx\ny\nb\nc')).toEqual([[1, 2]]);
    expect(changedLines('a\nb\nc', 'z\na\nb\nq\nc')).toEqual([[0, 0], [3, 3]]);
    expect(changedLines('a\nb', 'a\nb')).toEqual([]);
    expect(changedLines('a\n}\nb\n}', 'a\n  x\n}\nb\n}')).toEqual([[1, 1]]);
  });
});
