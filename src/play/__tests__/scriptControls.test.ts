import { describe, expect, it } from 'vitest';
import { klSketchCompile, klSketchPress, klSketchStep } from '../kit/layers.js';
import { controlCandidate, makeControl } from '../../components/play/layers/scriptTools';
import { extractScriptParams } from '../../components/play/layers/scriptExamples';
import { tokenizeJsLine } from '../../components/code/jsSyntax';
import { scriptFunctions } from '../savedScripts';
import { actionsForLayer, parseActionTarget, actionTarget, scriptActionKey } from '../../types/play';
import { defaultLayer, layerNumericProps, type ScriptLayer } from '../../types/playLayers';
import { scriptCompletions } from '../../components/play/layers/scriptCompletions';

const fakeCtx = () => new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
const frame = (ctx: CanvasRenderingContext2D, params: Record<string, number>) => ({ ctx, width: 100, height: 50, dpr: 1, time: 0, dt: 0.016, frame: 0, params, state: {}, mouse: { x: 0, y: 0, over: false, down: false }, picture: { brightness: () => 0 }, null: () => null, random: Math.random }) as Record<string, unknown>;

describe('param kinds', () => {
  it('reads sliders, toggles and buttons from a params object, with shorthands', () => {
    const r = extractScriptParams(`const params = { a: 0.5, b: { value: 3, min: 0, max: 10 }, on: true, flag: { kind: 'toggle', value: 0, label: 'Flag' }, go(s) {}, hit: 'button' }; function draw(s) {}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.defs.map(d => [d.key, d.kind ?? 'slider', d.value])).toEqual([['a', 'slider', 0.5], ['b', 'slider', 3], ['on', 'toggle', 1], ['flag', 'toggle', 0], ['go', 'button', 0], ['hit', 'button', 0]]);
    expect(r.defs.find(d => d.key === 'flag')?.label).toBe('Flag');
  });
  it('buttons are actions, toggles are 0/1 numbers', () => {
    const l = { ...defaultLayer('script', 'L', 'Sketch'), paramDefs: [{ key: 'speed', label: 'Speed', value: 1, min: 0, max: 4 }, { key: 'on', label: 'On', kind: 'toggle', value: 1, min: 0, max: 1, step: 1 }, { key: 'wipe', label: 'Wipe', kind: 'button', value: 0, min: 0, max: 1 }] } as ScriptLayer;
    expect(layerNumericProps(l).map(p => p.key)).toEqual(['p_speed', 'p_on', 'opacity']);
    expect(layerNumericProps(l).find(p => p.key === 'p_on')).toMatchObject({ min: 0, max: 1, step: 1 });
    expect(actionsForLayer(l)).toEqual(['script:wipe', 'toggle', 'show', 'hide']);
    const t = actionTarget('L', 'script:wipe');
    expect(parseActionTarget(t)).toEqual({ layerId: 'L', do: 'script:wipe' });
    expect(parseActionTarget('act:L::script:not valid')).toBeNull();
    expect(scriptActionKey('burst')).toBeNull();
  });
});

describe('klSketchStep', () => {
  it('drives toggles as booleans and delivers presses to handlers and s.pressed', () => {
    const log: string[] = [];
    const st = klSketchCompile(`let on = false; let hits = 0;
      const params = { on: true, bang(s, amount) { hits += amount; }, ping: 'button' };
      function draw(s) { s.log(on + ':' + hits + ':' + (s.pressed('ping') ? 'P' : '-') + ':' + s.params.ping); }`);
    expect(st.error).toBeNull();
    const defs = [{ key: 'on', kind: 'toggle' }, { key: 'bang', kind: 'button' }, { key: 'ping', kind: 'button' }];
    const ctx = fakeCtx();
    const run = (params: Record<string, number>) => { const s = frame(ctx, params); s.log = (m: string) => log.push(m); return klSketchStep(st, s, defs, true); };
    expect(run({ on: 1 })).toBeNull();
    expect(log.pop()).toBe('true:0:-:0');
    klSketchPress(st, 'bang', 3); klSketchPress(st, 'ping');
    expect(run({ on: 0 })).toBeNull();
    expect(log.pop()).toBe('false:3:P:1');
    expect(run({ on: 0 })).toBeNull();
    expect(log.pop()).toBe('false:3:-:0'); // a press lasts one frame
  });
  it('reports a runtime error once and stops', () => {
    const st = klSketchCompile('function draw(s) { nope(); }');
    const err = klSketchStep(st, frame(fakeCtx(), {}), [], true);
    expect(err).toMatch(/^Runtime: /);
    expect(klSketchStep(st, frame(fakeCtx(), {}), [], true)).toBe(err);
  });
});

describe('controlCandidate / makeControl', () => {
  const code = `let count = 60;\nconst glow = false;\nfunction wipe(s) { s.ctx.clearRect(0, 0, 1, 1); }\nfunction draw(s) {}\n`;
  it('classifies the selection', () => {
    expect(controlCandidate(code, 'count')).toMatchObject({ kind: 'slider', value: 60 });
    expect(controlCandidate(code, 'glow')).toMatchObject({ kind: 'toggle', value: false });
    expect(controlCandidate(code, 'wipe')).toMatchObject({ kind: 'button' });
    expect(controlCandidate(code, 'draw')).toBeNull();
    expect(controlCandidate(code, 's')).toBeNull();
  });
  it('makes a toggle: params entry and a let', () => {
    const r = makeControl(code, 'glow')!;
    expect(r.kind).toBe('toggle');
    expect(r.code).toContain("glow: { kind: 'toggle', value: false }");
    expect(r.code).toContain('let glow = false;');
    expect(extractScriptParams(r.code)).toMatchObject({ ok: true, defs: [{ key: 'glow', kind: 'toggle', value: 0 }] });
  });
  it('makes a button: the function goes in params by reference', () => {
    const r = makeControl(code, 'wipe')!;
    expect(r.kind).toBe('button');
    expect(r.code).toContain('wipe: wipe');
    const p = extractScriptParams(r.code);
    expect(p).toMatchObject({ ok: true, defs: [{ key: 'wipe', kind: 'button' }] });
    // ...and pressing it runs the function
    const st = klSketchCompile(r.code);
    expect(typeof st.params.wipe).toBe('function');
  });
  it('adds to an existing params object and refuses a kind that does not match', () => {
    const withParams = `const params = {\n  a: 1,\n};\n${code}`;
    const r = makeControl(withParams, 'count')!;
    expect(r.code).toContain("a: 1,\n  count: { value: 60, min: 0, max: 240, step: 1 },\n};");
    expect(makeControl(withParams, 'count', 'toggle')).toBeNull();
  });
});

describe('editor helpers', () => {
  it('tokenizes a JavaScript line with strings, numbers, comments and members', () => {
    const t = tokenizeJsLine("const x = s.width * 0.5; // half", { keyword: 'K', number: 'N', comment: 'C', swizzle: 'M', builtin: 'B', typeVec2: 'S', typeVec3: 'STR', operator: 'O', punct: 'P', ident: 'I' } as never);
    const by = (text: string) => t.find(k => k.text === text)?.color;
    expect(by('const')).toBe('K'); expect(by('s')).toBe('S'); expect(by('width')).toBe('M'); expect(by('0.5')).toBe('N'); expect(by('// half')).toBe('C'); expect(by('*')).toBe('O');
    expect(t.map(k => k.text).join('')).toBe("const x = s.width * 0.5; // half");
    expect(tokenizeJsLine("fill('a\\'b'); circle(1, 2, 3)").find(k => k.text === "'a\\'b'")).toBeTruthy();
  });
  it('lists the sketch’s own identifiers and members after s. and ctx.', () => {
    const c = scriptCompletions('let speed = 2; function spawn() {}\nconst params = { size: 3 };');
    expect(c.all.filter(x => x.kind === 'var').map(x => x.name)).toEqual(['speed', 'spawn', 'params']);
    expect(c.members.s.some(x => x.name === 'width')).toBe(true);
    expect(c.members.ctx.some(x => x.name === 'fillRect')).toBe(true);
    expect(c.members.params.map(x => x.name)).toEqual(['size']);
  });
  it('extracts top-level functions for importing', () => {
    const fns = scriptFunctions('function a(s) { if (s) { return 1; } }\nlet x = 1;\nfunction draw(s) {}\nasync function b() {}');
    expect(fns.map(f => f.name)).toEqual(['a', 'draw', 'b']);
    expect(fns[0].source).toBe('function a(s) { if (s) { return 1; } }');
  });
});
