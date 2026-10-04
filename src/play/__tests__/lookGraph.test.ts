/**
 * Look effects made of nodes (play/lookGraph.ts): which nodes can be an
 * effect, the code a node or a graph compiles to and how it lands in the
 * Finish pass, settings parsed from uniform comments, and the graph kept
 * through the record, the library and a website export.
 */
import { describe, it, expect } from 'vitest';
import { getNodeDefinition } from '../../nodes/definitions';
import {
  colourSockets, compileEffectGraph, effectFromGraph, effectNodeProblem, emptyEffectGraph, graphWithEffectValues, nodeEffect, nodeEffectDefs,
  nodeEffectGraph, nodeEffectProblem, type EffectGraph,
} from '../lookGraph';
import { parseEffectGraph } from '../lookGraphRecord';
import { fnActive, fnAnimated, fnBuildFinal, fnParseCustom } from '../kit/finish.js';
import { newCustomEffect, parseFinish, withCustomCode } from '../../types/playFinish';
import { loadSavedEffects, saveEffect, type ListKV } from '../finishLibrary';
import { emptyPlayRecord } from '../../types/play';
import { playBundle } from '../exportHtml';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';

const def = (t: string) => getNodeDefinition(t)!;
const listKV = (): ListKV => { const data = new Map<string, string>(); return { get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } }; };

/** Picture colour → luminance → colorize → out, with a Picture at beside it. */
const GRAPH: EffectGraph = {
  v: 1,
  nodes: [
    { id: 'l', type: 'luminance', x: 200, y: 0, wires: { color: ['in', 'color'] } },
    { id: 'c', type: 'colorize', x: 400, y: 0, wires: { field: ['l', 'result'] }, params: { color: [1, 0.5, 0], background: [0, 0, 0.2], gain: 1.5 } },
    { id: 'out', type: 'fx:out', x: 600, y: 0, wires: { color: ['c', 'color'] } },
  ],
};

describe('which nodes can be a Look effect', () => {
  it('takes nodes with a colour in and a colour out', () => {
    for (const t of ['hueRotate', 'posterize', 'invert', 'toneMap', 'vignette', 'crtMask', 'grain', 'colorSaturation', 'brightnessContrast', 'blendModes']) {
      expect(nodeEffectProblem(def(t)), t).toBe('');
    }
    expect(colourSockets(def('blendModes'))).toEqual({ input: 'base', output: 'result' });
    expect(colourSockets(def('vignette'))).toEqual({ input: 'color', output: 'result' });
    const listed = nodeEffectDefs().map(d => d.type);
    expect(listed).toContain('hueRotate');
    expect(listed).not.toContain('mouse');
  });

  it('leaves out what a Finish pass can’t give, from what the node declares', () => {
    expect(nodeEffectProblem(def('gpuParticles'))).toMatch(/particle|texture/);
    expect(nodeEffectProblem(def('pass'))).toMatch(/texture/);
    expect(nodeEffectProblem(def('multiLight'))).toMatch(/3D/);
    expect(nodeEffectProblem(def('volumetricFog'))).toMatch(/3D/);
    expect(nodeEffectProblem(def('gridPattern'))).toMatch(/field socket/);
    expect(nodeEffectProblem(def('luminance'))).toMatch(/colour in|doesn’t take a colour and give a colour/);
    expect(effectNodeProblem(def('mouse'))).toMatch(/mouse/);
    expect(effectNodeProblem(def('prevFrame'))).toMatch(/frame before/);
    expect(effectNodeProblem(def('sampleTexture'))).toMatch(/texture/);
    // Blurs that read the frame before read the picture instead; ones that pass a sampler on are left out.
    expect(nodeEffectProblem(def('gaussianBlur'))).toBe('');
    expect(nodeEffectProblem(def('lensBlur'))).toMatch(/texture/);
  });
});

describe('compiling a node effect', () => {
  it('is effect code with the node’s settings as sliders', () => {
    const r = compileEffectGraph(nodeEffectGraph('hueRotate'));
    expect(r.error).toBe('');
    const p = fnParseCustom(r.code);
    expect(p.error).toBe('');
    const angle = p.params.find(x => x.key === 'angle')!;
    const pd = def('hueRotate').paramDefs!.angle;
    expect(angle).toMatchObject({ min: pd.min, max: pd.max, value: 0, step: pd.step });
    expect(r.bind.angle).toEqual({ nodeId: 'n1', param: 'angle', colour: false });
    expect(r.code).not.toMatch(/\bu_[a-z]/);
    expect(r.code).not.toMatch(/gl_FragColor|texture2D|varying/);
  });

  it('keeps a setting’s hint, wires a 0..1 UV and reads the clock as time', () => {
    const v = compileEffectGraph(nodeEffectGraph('vignette'));
    expect(v.code).toMatch(/vignette_1_vc\s*=\s*vUv - 0\.5/);
    const crt = nodeEffect('crtMask');
    expect(crt.error).toBe('');
    expect(crt.effect!.code).toMatch(/\btime \* pulseRate\b/);
    expect(fnAnimated({ on: true, effects: [crt.effect!] })).toBe(true);
    // A setting is never named like a word the code already uses (a #define would rewrite it): Grain's helper has an `amount`.
    expect(Object.keys(compileEffectGraph(nodeEffectGraph('grain')).bind)).toContain('grain_amount');
    const hinted = fnParseCustom(compileEffectGraph(nodeEffectGraph('posterize')).code).params.find(x => x.key === 'levels');
    expect(hinted?.hint ?? '').toBe(def('posterize').paramDefs?.levels?.hint ?? '');
  });

  it('goes into the Finish pass as one more colour step', () => {
    const e = nodeEffect('hueRotate').effect!;
    expect(e).toMatchObject({ kind: 'custom', name: 'Hue Rotate', angle: 0 });
    expect(e.graph?.node).toBe('hueRotate');
    const built = fnBuildFinal([e]);
    expect(built.custom).toEqual([e.id]);
    expect(built.src).toContain('#define angle U_cx0[0].x');
    expect(built.src).toContain('#define effect fnCx0');
    expect(built.src).toContain('c = fnCx0(p, c);');
    expect(fnActive({ on: true, effects: [e] })).toBe(true);
  });

  it('reads neighbours of the picture for the Studio’s blurs', () => {
    const r = compileEffectGraph(nodeEffectGraph('gaussianBlur'));
    expect(r.error).toBe('');
    expect(r.code).toContain('vec4 fxPrev(vec2 q) { return vec4(picture(q), 1.0); }');
    expect(r.code).not.toContain('u_prevFrame');
  });
});

describe('compiling a graph', () => {
  it('names settings readably and binds them to their nodes', () => {
    const r = compileEffectGraph(GRAPH);
    expect(r.error).toBe('');
    const p = fnParseCustom(r.code);
    expect(p.error).toBe('');
    // `color` is a name the pass uses: the node's name goes in front.
    expect(Object.keys(r.bind).sort()).toEqual(['background', 'colorize_color', 'gain']);
    expect(p.colours.map(c => c.name).sort()).toEqual(['background', 'colorize_color']);
    expect(p.params.find(x => x.key === 'gain')).toMatchObject({ value: 1.5, label: 'Gain · Colorize' });
    expect(p.params.find(x => x.key === 'colorize_color.g')?.value).toBeCloseTo(0.5, 2);
  });

  it('an empty graph passes the picture through; Picture at reads it elsewhere', () => {
    const r = compileEffectGraph(emptyEffectGraph());
    expect(r.error).toBe('');
    expect(r.code).toMatch(/fxOut = vec4\(fxColor, 1\.0\);/);
    const at: EffectGraph = { v: 1, nodes: [{ id: 'p', type: 'fx:pictureAt', x: 0, y: 0 }, { id: 'out', type: 'fx:out', x: 300, y: 0, wires: { color: ['p', 'color'] } }] };
    const ra = compileEffectGraph(at);
    expect(ra.error).toBe('');
    expect(ra.code).toMatch(/picture\(vUv\)/);
  });

  it('says what’s wrong instead of compiling', () => {
    const bad: EffectGraph = { v: 1, nodes: [{ id: 'm', type: 'mouse', x: 0, y: 0 }, { id: 'out', type: 'fx:out', x: 300, y: 0 }] };
    expect(compileEffectGraph(bad).error).toMatch(/Mouse can’t be in an effect/);
    const unknown: EffectGraph = { v: 1, nodes: [{ id: 'x', type: 'noSuchNode', x: 0, y: 0 }, { id: 'out', type: 'fx:out', x: 300, y: 0 }] };
    expect(compileEffectGraph(unknown).error).toMatch(/isn’t a node/);
    const mismatch: EffectGraph = { v: 1, nodes: [{ id: 'h', type: 'hueRotate', x: 0, y: 0, wires: { angle: ['in', 'uv'] } }, { id: 'out', type: 'fx:out', x: 300, y: 0, wires: { color: ['h', 'color'] } }] };
    expect(compileEffectGraph(mismatch).error).toMatch(/vec2 can’t go into/);
  });

  it('opens on the stack’s values: settings moved in the stack are written back into the nodes', () => {
    const e = effectFromGraph(GRAPH, { name: 'Duo', id: 'duo' }).effect!;
    e.gain = 0.25;
    e['background.r'] = 0.9;
    const g = graphWithEffectValues(e.graph!, e);
    const c = g.nodes.find(n => n.id === 'c')!;
    expect(c.params?.gain).toBe(0.25);
    expect((c.params?.background as number[])[0]).toBe(0.9);
    // Rebuilt from that graph, the effect has the same values.
    const again = effectFromGraph(g, { prev: e }).effect!;
    expect(again.gain).toBeCloseTo(0.25, 6);
    expect(again.id).toBe('duo');
  });
});

describe('uniform comments', () => {
  it('a hint after “ | ” is the setting’s hint; the label stays', () => {
    const p = fnParseCustom('uniform float amt; // 0..2 = 1 Amount | How much shows\nuniform vec3 ink; // color = #ff0000 Ink | The colour of the lines\nvec3 effect(vec2 uv, vec3 color) { return color * amt * ink; }');
    expect(p.error).toBe('');
    expect(p.params[0]).toMatchObject({ key: 'amt', label: 'Amount', min: 0, max: 2, value: 1, hint: 'How much shows' });
    expect(p.colours[0]).toMatchObject({ name: 'ink', label: 'Ink', hint: 'The colour of the lines' });
    expect(p.params.find(x => x.key === 'ink.r')).toMatchObject({ value: 1, hint: 'The colour of the lines' });
  });

  it('`graph` is a name the record uses', () => {
    expect(fnParseCustom('uniform float graph;\nvec3 effect(vec2 uv, vec3 color) { return color; }').error).toMatch(/graph/);
  });
});

describe('keeping the graph', () => {
  it('the record keeps it (checked), and code typed by hand drops it', () => {
    const e = effectFromGraph(GRAPH, { id: 'g1' }).effect!;
    e.where = 'picture';
    const parsed = parseFinish({ on: true, effects: [JSON.parse(JSON.stringify(e))] })!;
    expect(parsed.effects[0].graph).toEqual(GRAPH);
    expect(parsed.effects[0].code).toBe(e.code);
    const typed = withCustomCode(parsed.effects[0], 'vec3 effect(vec2 uv, vec3 color) { return color.bgr; }');
    expect(typed.graph).toBeUndefined();
    expect(typed.where).toBe('picture');
    expect(withCustomCode(parsed.effects[0], e.code!, GRAPH).graph).toEqual(GRAPH);
  });

  it('parseEffectGraph drops what isn’t one', () => {
    expect(parseEffectGraph(null)).toBeNull();
    expect(parseEffectGraph({ nodes: [{ id: 'a', type: 'invert', x: 0, y: 0 }] })).toBeNull(); // no output
    const g = parseEffectGraph({ v: 1, nodes: [
      { id: 'a', type: 'invert', x: 1.6, y: 2, params: { k: 1, f: () => 1, o: { x: 1 } }, wires: { color: ['in', 'color'], nope: ['ghost', 'x'] } },
      { id: 'a', type: 'invert', x: 0, y: 0 },
      { id: 'out', type: 'fx:out', x: 0, y: 0, wires: { color: ['a', 'color'] } },
      { id: 'out2', type: 'fx:out', x: 0, y: 0 },
    ] })!;
    expect(g.nodes.map(n => n.id)).toEqual(['a', 'out']);
    expect(g.nodes[0]).toEqual({ id: 'a', type: 'invert', x: 2, y: 2, params: { k: 1 }, wires: { color: ['in', 'color'] } });
  });

  it('Your effects keep it, and an effect added from there brings it', () => {
    const kv = listKV();
    const e = effectFromGraph(GRAPH, { name: 'Duo' }).effect!;
    const { result, saved } = saveEffect({ name: 'Duo', code: e.code!, graph: e.graph }, kv);
    expect(result.ok).toBe(true);
    const [back] = loadSavedEffects(kv);
    expect(back.id).toBe(saved!.id);
    expect(back.graph).toEqual(GRAPH);
    expect(back.code).toBe(e.code);
    const added = newCustomEffect({ name: back.name, code: back.code, defId: back.id, graph: back.graph });
    expect(added.graph).toEqual(GRAPH);
    expect(added.gain).toBe(1.5);
    // Saved without a graph (code), none comes back.
    saveEffect({ name: 'Plain', code: 'vec3 effect(vec2 uv, vec3 color) { return color; }' }, kv);
    expect(loadSavedEffects(kv).find(x => x.name === 'Plain')!.graph).toBeUndefined();
  });

  it('a website export carries the compiled code', () => {
    const e = nodeEffect('posterize').effect!;
    const b = playBundle({ title: 'S', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: { ...emptyPlayRecord(), finish: { on: true, effects: [e] } }, aspect: '16:9' });
    expect(b.play.finish!.effects[0].code).toBe(e.code);
    expect(fnParseCustom(b.play.finish!.effects[0].code!).error).toBe('');
  });

  it('the example has a node-built and a code-built effect that parse cleanly', () => {
    const ex = EXAMPLE_GRAPHS.lookBuilt as unknown as { play: { finish: { effects: Array<{ id: string; code: string; graph?: EffectGraph }> } } };
    const [duo, wob] = ex.play.finish.effects;
    expect(duo.graph?.nodes.map(n => n.type)).toEqual(['luminance', 'colorize', 'blendModes', 'vignette', 'fx:out']);
    expect(fnParseCustom(duo.code).error).toBe('');
    expect(duo.code).toContain('// Paints the brightness from deep violet');
    expect(Object.keys(compileEffectGraph(duo.graph!).bind)).toContain('opacity');
    expect(wob.graph).toBeUndefined();
    expect(fnParseCustom(wob.code).params.map(p => p.key)).toEqual(['amount', 'rows', 'speed', 'tint.r', 'tint.g', 'tint.b']);
  });
});
