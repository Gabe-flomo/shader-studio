/**
 * The Finish stack's follow-ups (docs/finish-stack.md): the before/after wipe
 * in the record (parse, controls, renders), custom effects (settings from the
 * code, the stage's GLSL, a broken one left out), stack presets and Your
 * effects (storage, loading, the library and the Files page), and exports.
 *
 * The renderer runs on a recording stand-in for WebGL2: it compiles whatever
 * doesn't mention `oops`, and remembers every uniform it is given.
 */
import { describe, it, expect } from 'vitest';
import {
  FN_COMPARE_PARAMS, fnActive, fnAnimated, fnBuildFinal, fnCreate, fnCustomDefaults, fnCustomErrors, fnParseCustom, fnRunning, type FnFinish,
} from '../kit/finish.js';
import {
  compareHost, finishHost, finishHostLabel, finishHosts, finishNumericProps, finishTarget, finishTargetLabel, newCustomEffect, newFinishEffect, parseCompare,
  parseFinish, patchFinishEffect, readFinishValue, renderableFinish, sealCustomCode, withCustomCode, type PlayFinish,
} from '../../types/playFinish';
import { emptyPlayRecord, parsePlayRecord, type PlayRecord } from '../../types/play';
import { bakeLayerValues, readControlValue } from '../playControls';
import { buildPlayHtml, kitScript, playBundle, type PlayHtmlInput } from '../exportHtml';
import {
  applyStackPreset, deleteEffect, deleteStackPreset, installEffects, loadSavedEffects, loadStackPresets, renameEffect, renameStackPreset, saveEffect, saveStackPreset,
  EFFECT_TEMPLATE, FINISH_EFFECTS_KEY, FINISH_PRESETS_KEY, type ListKV,
} from '../finishLibrary';
import { describeSnapshot, kindOfKey, libraryStats, readableFiles, takeSnapshot } from '../../utils/library';
import { memoryKV } from '../../files/mutate';
import { buildInventory, walk } from '../../files/inventory';

const POSTERIZE = `uniform float levels; // 2..16 = 5 Levels
uniform float amount; // 0..1 = 1
uniform vec3 tint;    // color = #ff8800 Warm tint
vec3 effect(vec2 uv, vec3 color) {
  return mix(color, floor(color * levels + 0.5) / levels * tint, amount);
}
`;
const listKV = (): ListKV & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } }; };

// ── A recording stand-in for WebGL2 ─────────────────────────────────────────

interface Recorded { uniforms: Map<string, number[]>; sources: string[] }
function fakeCanvas(): { canvas: HTMLCanvasElement; rec: Recorded } {
  const rec: Recorded = { uniforms: new Map(), sources: [] };
  const shaders = new Map<object, string>();
  const locName = new Map<object, string>();
  const gl: Record<string, unknown> = {
    isContextLost: () => false,
    getExtension: (n: string) => (n === 'EXT_color_buffer_float' ? {} : null),
    createShader: () => ({}),
    shaderSource: (s: object, src: string) => { shaders.set(s, src); rec.sources.push(src); },
    getShaderParameter: (s: object) => !(shaders.get(s) ?? '').includes('oops'),
    getShaderInfoLog: (s: object) => {
      const src = shaders.get(s) ?? '';
      // Like a real compiler: the error names the source string and line (#line 1 1000 for stage 0).
      const lines = src.split('\n');
      const start = lines.findIndex(l => /^#line 1 1000$/.test(l));
      const at = lines.slice(start + 1).findIndex(l => l.includes('oops')) + 1;
      return `ERROR: 1000:${at}: 'oops' : undeclared identifier\nERROR: 0:1: compilation errors`;
    },
    getProgramParameter: () => true,
    getUniformLocation: (_p: object, name: string) => { const l = {}; locName.set(l, name); return l; },
    uniform4f: (l: object, ...v: number[]) => rec.uniforms.set(locName.get(l)!, v),
    uniform4fv: (l: object, v: Float32Array) => rec.uniforms.set(locName.get(l)!, [...v]),
    uniform1f: (l: object, v: number) => rec.uniforms.set(locName.get(l)!, [v]),
  };
  const proxy = new Proxy(gl, { get: (t, k: string) => (k in t ? t[k] : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? 1 : () => ({})) });
  const canvas = { width: 0, height: 0, getContext: () => proxy } as unknown as HTMLCanvasElement;
  return { canvas, rec };
}
const pixels = () => ({ data: new Uint8Array(4 * 4 * 4), width: 4, height: 4 });

// ── The wipe ────────────────────────────────────────────────────────────────

describe('the before/after wipe', () => {
  const stack = (): PlayFinish => ({ on: true, effects: [newFinishEffect('grade', 'g')], compare: { on: true, pos: 0.3, angle: 20, softness: 0.1 } });

  it('parses and migrates: clamped, off unless it says on, absent in older records', () => {
    expect(parseCompare({ on: true, pos: 2, angle: -999, softness: 'x' })).toEqual({ on: true, pos: 1, angle: -180, softness: 0 });
    expect(parseCompare({ pos: 0.2 })!.on).toBe(false);
    expect(parseCompare(null)).toBeUndefined();
    expect(parseFinish({ on: true, effects: [{ id: 'g', kind: 'grade' }] })!.compare).toBeUndefined();
    const f = parseFinish(JSON.parse(JSON.stringify(stack())))!;
    expect(f.compare).toEqual({ on: true, pos: 0.3, angle: 20, softness: 0.1 });
    // An effect can't take the wipe's id.
    expect(parseFinish({ on: true, effects: [{ id: 'compare', kind: 'bloom' }] })!.effects[0].id).not.toBe('compare');
  });

  it('is a control target: finish:compare::pos reads, patches, bakes and survives a reload with its control', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), finish: stack(),
      controls: [{ id: 'w', target: finishTarget('compare', 'pos'), kind: 'float', label: 'Wipe', min: 0, max: 1 }],
      mappings: [{ id: 'm', controlId: 'w', source: { kind: 'lfo', shape: 'sine', rate: 0.5, phase: 0 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    };
    expect(readFinishValue(rec.finish, 'finish:compare::pos')).toBe(0.3);
    expect(readControlValue([], 'finish:compare::angle', rec)).toBe(20);
    expect(finishTargetLabel(rec.finish, 'finish:compare::pos')).toEqual({ effect: 'Before / after wipe', param: 'Position' });
    expect(finishHosts(rec.finish).map(h => h.id)).toEqual(['g', 'compare']);
    expect(finishNumericProps(compareHost(rec.finish!.compare!)).map(p => p.key)).toEqual(['pos', 'angle', 'softness']);
    expect(patchFinishEffect(rec.finish, 'compare', { pos: 0.7 })!.compare).toEqual({ on: true, pos: 0.7, angle: 20, softness: 0.1 });
    expect(bakeLayerValues(rec, new Map([['w', 0.9]])).finish!.compare!.pos).toBe(0.9);
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.controls.map(c => c.id)).toEqual(['w']);
    expect(back.mappings.map(m => m.id)).toEqual(['m']);
    // Without a wipe in the record, its control goes.
    const none = parsePlayRecord(JSON.parse(JSON.stringify({ ...rec, finish: { on: true, effects: rec.finish!.effects } })));
    expect(none.controls).toEqual([]);
  });

  it('is in the pass, and renders (pixels mode: takes, offline renders, stills) draw it with its driven numbers', () => {
    expect(fnBuildFinal([newFinishEffect('grade', 'g')]).src).toContain('fnWipe(p)');
    const { canvas, rec } = fakeCanvas();
    const r = fnCreate(canvas);
    expect(r.ok).toBe(true);
    const value = (e: { id: string; [k: string]: unknown }, k: string) => (e.id === 'compare' && k === 'pos' ? 0.8 : e[k] as number);
    expect(r.draw({ finish: stack() as FnFinish, value, picture: pixels(), pixels: true, width: 4, height: 4, time: 0 })).toBe(true);
    expect(rec.uniforms.get('uWipe')).toEqual([1, 0.8, 20, 0.1]);
    // Off: the pass is told so.
    r.draw({ finish: { ...stack(), compare: { on: false, pos: 0.3, angle: 0, softness: 0 } } as FnFinish, picture: pixels(), pixels: true, width: 4, height: 4, time: 0 });
    expect(rec.uniforms.get('uWipe')![0]).toBe(0);
  });

  it('every number has a default inside its range', () => {
    for (const p of FN_COMPARE_PARAMS) expect(p.value >= p.min && p.value <= p.max).toBe(true);
  });
});

// ── Custom effects ──────────────────────────────────────────────────────────

describe('custom effects: settings from the code', () => {
  it('floats with range, default, step and label; ints; colours as three hidden numbers', () => {
    const p = fnParseCustom(`uniform float amount; // 0..1 = 0.25
uniform float levels; // 2..16 = 6 step 1 How many levels
uniform int count; // 1..8
uniform float plain;
uniform vec3 tint; // color = #ff8800
vec3 effect(vec2 uv, vec3 color) { return color; }`);
    expect(p.error).toBe('');
    const by = Object.fromEntries(p.params.map(x => [x.key, x]));
    expect(by.amount).toMatchObject({ label: 'Amount', min: 0, max: 1, value: 0.25, step: 0.01, hidden: false, type: 'float' });
    expect(by.levels).toMatchObject({ label: 'How many levels', min: 2, max: 16, value: 6, step: 1 });
    expect(by.count).toMatchObject({ type: 'int', min: 1, max: 8, step: 1, value: 5 });
    expect(by.plain).toMatchObject({ min: 0, max: 1, value: 0.5 });
    expect(p.colours).toEqual([{ name: 'tint', label: 'Tint', keys: ['tint.r', 'tint.g', 'tint.b'] }]);
    expect(['tint.r', 'tint.g', 'tint.b'].map(k => by[k].value)).toEqual([1, 0x88 / 255, 0]);
    expect(by['tint.r'].hidden).toBe(true);
    // Uniform lines are blanked, so the code keeps its line numbers.
    expect(p.lines.length).toBe(6);
    expect(p.lines[0]).toBe('');
    expect(fnCustomDefaults(EFFECT_TEMPLATE)).toEqual({ levels: 5, amount: 1 });
  });

  it('says what is wrong before compiling: no effect function, a reserved or repeated name, other uniforms', () => {
    expect(fnParseCustom('vec3 notIt(vec2 uv, vec3 c) { return c; }').error).toMatch(/vec3 effect\(vec2 uv, vec3 color\)/);
    expect(fnParseCustom('uniform float time;\nvec3 effect(vec2 uv, vec3 color) { return color; }').error).toMatch(/Line 1: “time”/);
    expect(fnParseCustom('uniform float a;\nuniform float a;\nvec3 effect(vec2 uv, vec3 color) { return color; }').error).toMatch(/Line 2: “a” is declared twice/);
    expect(fnParseCustom('uniform sampler2D img;\nvec3 effect(vec2 uv, vec3 color) { return color; }').error).toMatch(/Line 1: only/);
  });

  it('a stack effect keeps its settings as numbers (control targets), and new code keeps the ones that stay', () => {
    const e = newCustomEffect({ name: 'Posterize', code: POSTERIZE });
    expect(e).toMatchObject({ kind: 'custom', name: 'Posterize', levels: 5, amount: 1, 'tint.r': 1 });
    expect(finishHostLabel(e)).toBe('Posterize');
    expect(finishNumericProps(e).map(p => p.key)).toEqual(['levels', 'amount', 'tint.r', 'tint.g', 'tint.b']);
    const f: PlayFinish = { on: true, effects: [{ ...e, levels: 9 }] };
    expect(readFinishValue(f, finishTarget(e.id, 'levels'))).toBe(9);
    expect(finishTargetLabel(f, finishTarget(e.id, 'levels'))).toEqual({ effect: 'Posterize', param: 'Levels' });
    const next = withCustomCode({ ...e, levels: 9 }, POSTERIZE.replace('uniform float amount; // 0..1 = 1\n', 'uniform float grain; // 0..2 = 0.5\n'));
    expect(next).toMatchObject({ levels: 9, grain: 0.5 });
    expect('amount' in next).toBe(false);
  });

  it('parses from a file: any number of custom effects, settings clamped, empty code dropped', () => {
    const f = parseFinish({ on: true, effects: [
      { id: 'a', kind: 'custom', name: 'P1', code: POSTERIZE, levels: 99 },
      { id: 'b', kind: 'custom', name: 'P2', code: POSTERIZE },
      { id: 'c', kind: 'custom', code: '  ' },
    ] })!;
    expect(f.effects.map(e => e.id)).toEqual(['a', 'b']);
    expect(f.effects[0].levels).toBe(16);
    expect(fnRunning(f as FnFinish).length).toBe(2);
    expect(fnActive(f as FnFinish)).toBe(true);
    expect(fnAnimated(f as FnFinish)).toBe(false);
    expect(fnAnimated({ on: true, effects: [newCustomEffect({ name: 'T', code: 'vec3 effect(vec2 uv, vec3 color) { return color * (0.5 + 0.5 * sin(time)); }' })] } as FnFinish)).toBe(true);
  });
});

describe('custom effects: the stage in the pass', () => {
  it('is a function called in the stack’s order, its numbers named onto a uniform array, its code under its own line numbers', () => {
    const grade = newFinishEffect('grade', 'g');
    const post = newCustomEffect({ name: 'P', code: POSTERIZE }, 'p');
    const { src, custom } = fnBuildFinal([post, grade]);
    expect(custom).toEqual(['p']);
    expect(src).toContain('uniform vec4 U_cx0[2];');
    expect(src).toContain('#define levels U_cx0[0].x');
    expect(src).toContain('#define tint vec3(U_cx0[0].z, U_cx0[0].w, U_cx0[1].x)');
    expect(src).toContain('#define effect fnCx0');
    expect(src).toContain('#line 1 1000');
    expect(src.indexOf('c = fnCx0(p, c);')).toBeLessThan(src.indexOf('c = fnGrade(c);'));
    expect(src).toContain('#undef levels');
  });

  it('two effects with the same helper names don’t clash: each gets its own', () => {
    const code = 'float k(float x) { return x * 0.5; }\nconst float K = 2.0;\nvec3 effect(vec2 uv, vec3 color) { return color * k(K); }';
    const { src } = fnBuildFinal([newCustomEffect({ name: 'A', code }, 'a'), newCustomEffect({ name: 'B', code }, 'b')]);
    expect(src).toContain('#define k k_cx0');
    expect(src).toContain('#define k k_cx1');
    expect(src).toContain('#define K K_cx1');
    expect(src).toContain('c = fnCx0(p, c);\n  c = fnCx1(p, c);');
  });

  it('reads a compile log back to the snippet’s own lines', () => {
    expect(fnCustomErrors("ERROR: 1000:5: 'oops' : undeclared identifier\nERROR: 0:1: compilation errors\nERROR: 1001:2: other stage", 0)).toBe("Line 5: 'oops' : undeclared identifier");
    expect(fnCustomErrors('ERROR: 1001:2: x', 1)).toBe('Line 2: x');
  });

  it('a broken one is left out (with its error) and the rest of the stack still draws', () => {
    const { canvas, rec } = fakeCanvas();
    const r = fnCreate(canvas);
    const bad = newCustomEffect({ name: 'Bad', code: 'vec3 effect(vec2 uv, vec3 color) {\n  return color + oops;\n}' }, 'bad');
    const good = newCustomEffect({ name: 'Good', code: POSTERIZE }, 'good');
    const finish = { on: true, effects: [newFinishEffect('grade', 'g'), bad, good] } as FnFinish;
    expect(r.draw({ finish, picture: pixels(), pixels: true, width: 4, height: 4, time: 0 })).toBe(true);
    const info = r.info()!;
    expect(info.effects).toEqual(['grade', 'custom']);
    expect(info.custom).toEqual({ bad: "Line 2: 'oops' : undeclared identifier" });
    // The good one is stage 0 in the program that ran, with its numbers.
    expect(rec.uniforms.get('U_cx0')!.slice(0, 5)).toEqual([5, 1, 1, 0x88 / 255, 0].map(v => Math.fround(v)));
    // Only broken effects: nothing is drawn (the picture shows unfinished), never a blank frame.
    expect(r.draw({ finish: { on: true, effects: [bad] } as FnFinish, picture: pixels(), pixels: true, width: 4, height: 4, time: 0 })).toBe(false);
  });
});

describe('custom effects: sealed ones', () => {
  it('keep their code out of the record; settings and rendering use it in memory; exports carry it as code', () => {
    const sealed = sealCustomCode(POSTERIZE);
    const e = newCustomEffect({ name: 'Sealed', code: '', sealed }, 's');
    expect(e.code).toBe('');
    expect(JSON.stringify(e)).not.toContain('floor(');
    expect(e.levels).toBe(5);
    const f: PlayFinish = { on: true, effects: [e] };
    expect(fnActive(f as FnFinish)).toBe(false);
    expect(fnActive(renderableFinish(f) as FnFinish)).toBe(true);
    expect(parseFinish(JSON.parse(JSON.stringify(f)))!.effects[0].sealed).toEqual(sealed);
    const b = playBundle({ title: 'S', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: { ...emptyPlayRecord(), finish: f }, aspect: '16:9' });
    expect(b.play.finish!.effects[0].code).toBe(POSTERIZE);
    expect(b.play.finish!.effects[0].sealed).toBeUndefined();
  });
});

// ── Stack presets and Your effects ──────────────────────────────────────────

describe('stack presets', () => {
  const stack = (): PlayFinish => {
    const g = { ...newFinishEffect('grade', 'g'), exposure: 0.5, look: 'teal-orange' };
    g.curves = { ...g.curves!, rgb: [0, 0.1, 0.5, 0.6, 1, 1] };
    return { on: true, effects: [g, newFinishEffect('bloom', 'b'), newCustomEffect({ name: 'P', code: POSTERIZE }, 'p')], compare: { on: true, pos: 0.5, angle: 0, softness: 0 } };
  };

  it('save keeps every effect, its order and settings (curves and look); rename and delete', () => {
    const kv = listKV();
    const { result, preset } = saveStackPreset('Warm', stack(), kv);
    expect(result.ok).toBe(true);
    const list = loadStackPresets(kv);
    expect(list).toHaveLength(1);
    expect(list[0].finish.effects.map(e => e.kind)).toEqual(['grade', 'bloom', 'custom']);
    expect(list[0].finish.effects[0]).toMatchObject({ exposure: 0.5, look: 'teal-orange' });
    expect(list[0].finish.effects[0].curves!.rgb).toEqual([0, 0.1, 0.5, 0.6, 1, 1]);
    expect(list[0].finish.effects[2].code).toBe(POSTERIZE);
    // The wipe stays with the Play.
    expect(list[0].finish.compare).toBeUndefined();
    // Same name replaces.
    saveStackPreset('Warm', { on: true, effects: [newFinishEffect('grain', 'x')] }, kv);
    expect(loadStackPresets(kv).map(p => p.finish.effects.length)).toEqual([1]);
    const id = loadStackPresets(kv)[0].id;
    renameStackPreset(id, 'Grainy', kv);
    expect(loadStackPresets(kv)[0].name).toBe('Grainy');
    deleteStackPreset(id, kv);
    expect(loadStackPresets(kv)).toEqual([]);
    expect(preset).not.toBeNull();
    expect(saveStackPreset('Empty', { on: true, effects: [] }, kv).result.ok).toBe(false);
  });

  it('load: Replace stack, or Add to stack (a kind already there is skipped); loaded effects get new ids', () => {
    const kv = listKV();
    const { preset } = saveStackPreset('Warm', stack(), kv);
    const mine: PlayFinish = { on: false, effects: [newFinishEffect('grade', 'mine'), newFinishEffect('vignette', 'v')], compare: { on: true, pos: 0.2, angle: 0, softness: 0 } };
    const rep = applyStackPreset(mine, preset!, 'replace');
    expect(rep.finish.effects.map(e => e.kind)).toEqual(['grade', 'bloom', 'custom']);
    expect(rep.finish.on).toBe(true);
    expect(rep.finish.compare).toEqual(mine.compare);
    expect(rep.finish.effects.some(e => ['g', 'b', 'p'].includes(e.id))).toBe(false);
    const add = applyStackPreset(mine, preset!, 'add');
    expect(add.finish.effects.map(e => e.kind)).toEqual(['grade', 'vignette', 'bloom', 'custom']);
    expect(add.skipped).toEqual(['Grade']);
    expect(new Set(add.finish.effects.map(e => e.id)).size).toBe(4);
    expect(parseFinish(JSON.parse(JSON.stringify(add.finish)))!.effects.length).toBe(4);
  });
});

describe('Your effects', () => {
  it('save, update by id, rename, delete; sealed ones can’t be overwritten; a pack install updates by id', () => {
    const kv = listKV();
    const a = saveEffect({ name: 'Posterize', code: POSTERIZE }, kv).saved!;
    saveEffect({ name: 'Posterize', code: POSTERIZE.replace('= 5', '= 7'), id: a.id }, kv);
    expect(loadSavedEffects(kv).map(x => [x.id, x.code.includes('= 7')])).toEqual([[a.id, true]]);
    renameEffect(a.id, 'Poster', kv);
    expect(loadSavedEffects(kv)[0].name).toBe('Poster');
    installEffects([{ id: 'sealed1', name: 'Sealed', code: '', sealed: sealCustomCode(POSTERIZE), savedAt: 1, pack: 'Kit' }], kv);
    expect(saveEffect({ name: 'X', code: POSTERIZE, id: 'sealed1' }, kv).result.ok).toBe(false);
    expect(loadSavedEffects(kv).map(x => x.name)).toEqual(['Poster', 'Sealed']);
    deleteEffect(a.id, kv);
    expect(loadSavedEffects(kv).map(x => x.id)).toEqual(['sealed1']);
    // Bad entries in storage are skipped.
    kv.set(FINISH_EFFECTS_KEY, JSON.stringify([{ id: 'x' }, null, { id: 'y', name: 'Y', code: 'vec3 effect(vec2 uv, vec3 color){return color;}' }]));
    expect(loadSavedEffects(kv).map(x => x.id)).toEqual(['y']);
  });
});

describe('in the library, the Files page and exports', () => {
  const stored = () => {
    const kv = memoryKV();
    saveStackPreset('Warm', { on: true, effects: [newFinishEffect('grade', 'g'), newCustomEffect({ name: 'P', code: POSTERIZE }, 'p')] }, kv);
    saveEffect({ name: 'Posterize', code: POSTERIZE }, kv);
    return kv;
  };

  it('library ZIPs carry both lists (and a readable file each), counted as Finish', () => {
    const snap = takeSnapshot(stored());
    expect(Object.keys(snap.items).sort()).toEqual([FINISH_EFFECTS_KEY, FINISH_PRESETS_KEY].sort());
    expect(kindOfKey(FINISH_PRESETS_KEY, '[]')).toBe('finish');
    expect(libraryStats(snap).kinds.finish.count).toBe(2);
    expect(describeSnapshot(snap).other).toBe(2);
    const files = readableFiles(snap);
    expect(Object.keys(files).sort()).toEqual(['finish effects.json', 'finish stack presets.json']);
  });

  it('the Files page lists them under Presets', async () => {
    const inv = await buildInventory(stored());
    const labels = [...walk([inv.sections.find(s => s.id === 'section:presets')!])].map(n => `${n.kind}:${n.label}`);
    expect(labels).toEqual(expect.arrayContaining(['group:Finish stack presets', 'preset:Warm', 'group:Finish effects (Your effects)', 'preset:Posterize']));
    expect(inv.sections.find(s => s.id === 'section:settings')?.children?.some(n => n.label.includes('finish'))).toBeFalsy();
  });

  it('website exports carry the wipe and custom effects, and the page kit runs them', () => {
    const input: PlayHtmlInput = {
      title: 'F', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, aspect: '16:9',
      play: { ...emptyPlayRecord(), finish: { on: true, effects: [newCustomEffect({ name: 'P', code: POSTERIZE }, 'p')], compare: { on: true, pos: 0.4, angle: 0, softness: 0 } } },
    };
    const b = playBundle(input);
    expect(b.play.finish!.compare).toEqual({ on: true, pos: 0.4, angle: 0, softness: 0 });
    const html = buildPlayHtml(input);
    expect(html).toContain('"compare":{"on":true,"pos":0.4');
    expect(html).toContain("layersById.set('finish:compare'");
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { finish: { active: (f: unknown) => boolean } };
    expect(SSKit.finish.active(b.play.finish)).toBe(true);
    expect(finishHost(b.play.finish, 'compare')?.kind).toBe('compare');
  });
});
