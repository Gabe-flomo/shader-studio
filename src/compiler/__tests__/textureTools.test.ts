/**
 * Texture tools (docs/texture-tools.md): every node and mode compiles with every texture source,
 * reads only the sampler wired in (no new samplers), keeps its sliders live, and its GLSL does the
 * maths the JS mirror (and the inline curves) say it does. The examples and the quick adds too.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { MAX_SAMPLERS } from '../passGraph';
import { n } from '../../store/graphBuilder';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import {
  FRAME_DT_UNIFORM, TEXTURE_TOOL_TYPES, neighbourTaps, ttDecayFactor, ttDistanceShape, ttFadeStep, ttHardThreshold, ttLevels,
  ttMaskThreshold, ttPack, ttRollOff, ttSoftThreshold, ttUnpack, type LevelsSettings,
} from '../../nodes/definitions/textureTools';
import { slimeMoldNodes } from '../../store/agentExamples';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { TEXTURE_TOOL_EXAMPLE_KEYS } from '../../store/textureToolExamples';
import { shaderShape } from '../../lib/shaderShape';
import { suggestQuickAdds } from '../../components/NodeGraph/quickAdds';
import { canSwitchNode, switchFamiliesFor } from '../../nodes/switchNode';
import { recipesFor } from '../../nodes/recipes';
import { runGlsl, type Env, type Val } from './glslEval';
import type { GraphNode } from '../../types/nodeGraph';

type Wire = [string, string];

/** Each texture source: the nodes that make it, and the wire of its texture. */
const SOURCES: Record<string, () => { nodes: GraphNode[]; tex: Wire; sampler: RegExp }> = {
  pass: () => ({
    nodes: [n('uv', 'u', 0, 0), n('fbm', 'pic', 0, 0, {}, { uv: ['u', 'uv'] }), n('pass', 'src', 0, 0, {}, { color: ['pic', 'value'] })],
    tex: ['src', 'texture'], sampler: /texture2D\(u_pass_\w+,/,
  }),
  passPrevious: () => ({
    nodes: [n('uv', 'u', 0, 0), n('fbm', 'pic', 0, 0, {}, { uv: ['u', 'uv'] }), n('pass', 'src', 0, 0, {}, { color: ['pic', 'value'] })],
    tex: ['src', 'previous'], sampler: /texture2D\(u_passprev_\w+,/,
  }),
  textureInput: () => ({ nodes: [n('textureInput', 'src', 0, 0)], tex: ['src', 'texture'], sampler: /texture2D\(u_tex_\w+,/ }),
  videoInput: () => ({ nodes: [n('videoInput', 'src', 0, 0)], tex: ['src', 'texture'], sampler: /texture2D\(u_vid_\w+,/ }),
  baked: () => ({ nodes: [n('baked', 'src', 0, 0)], tex: ['src', 'texture'], sampler: /texture2D\(u_vid_\w+,/ }),
  motionMap: () => ({ nodes: [n('motionMap', 'src', 0, 0)], tex: ['src', 'texture'], sampler: /texture2D\(u_motionMap,/ }),
  trailField: () => ({ nodes: slimeMoldNodes(0, 0, false), tex: ['slimeTrail', 'texture'], sampler: /texture2D\(u_trail_\w+,/ }),
};

/** The output to show, per node type, and the input its texture goes into. */
const SHOW: Record<string, string> = {
  textureMask: 'mask', textureLevels: 'color', textureFlow: 'flow', textureNeighbours: 'color', textureChange: 'motion',
  distanceShape: 'light', textureFade: 'color', readTexture: 'color',
};

/** Every select's every option, one at a time (the rest at their defaults), plus the bools on. */
function modeVariants(type: string): Array<Record<string, unknown>> {
  const def = getNodeDefinition(type)!;
  const out: Array<Record<string, unknown>> = [{}];
  for (const [k, pd] of Object.entries(def.paramDefs ?? {})) {
    if (pd.type === 'select') for (const o of pd.options ?? []) out.push({ [k]: o.value });
    if (pd.type === 'bool') out.push({ [k]: true });
  }
  return out;
}

function graphWith(source: string, type: string, params: Record<string, unknown> = {}, extraWires: Record<string, Wire> = {}): GraphNode[] {
  const s = SOURCES[source]();
  const wires: Record<string, Wire> = { texture: s.tex, ...extraWires };
  // Change compares a texture with itself a frame ago: with a Pass, its Previous.
  if (type === 'textureChange' && source === 'pass') wires.before = ['src', 'previous'];
  // A vec2 (Flow) pads into the Output's colour.
  return [...s.nodes, n(type, 'tool', 0, 0, params, wires), n('output', 'out', 0, 0, {}, { color: ['tool', SHOW[type]] })];
}

describe('Texture tools compile', () => {
  it('are registered in the Texture tools category with notes on every socket and setting', () => {
    for (const type of TEXTURE_TOOL_TYPES) {
      const def = getNodeDefinition(type)!;
      expect(def, type).toBeDefined();
      expect(def.category).toBe('Texture tools');
      expect(def.description?.length ?? 0).toBeGreaterThan(80);
      for (const [k, s] of [...Object.entries(def.inputs), ...Object.entries(def.outputs)]) expect(s.hint?.length ?? 0, `${type}.${k} hint`).toBeGreaterThan(10);
      for (const [k, pd] of Object.entries(def.paramDefs ?? {})) expect(pd.hint?.length ?? 0, `${type}.${k} hint`).toBeGreaterThan(10);
      expect(def.inputs.uv?.type, `${type} has a UV`).toBe('vec2');
      expect(def.inputs.texture?.type, `${type} takes a texture`).toBe('texture');
    }
  });

  for (const type of TEXTURE_TOOL_TYPES) {
    it(`${type}: every mode compiles on a Pass and reads it`, () => {
      for (const params of modeVariants(type)) {
        const r = compileGraph({ nodes: graphWith('pass', type, params) });
        expect(r.errors, `${type} ${JSON.stringify(params)}`).toBeUndefined();
        expect(r.success).toBe(true);
        expect(r.fragmentShader).toMatch(SOURCES.pass().sampler);
      }
    });
    it(`${type}: compiles with every texture source (Pass, Previous, Texture Input, Video, Baked, Motion, Trail field)`, () => {
      for (const source of Object.keys(SOURCES)) {
        const r = compileGraph({ nodes: graphWith(source, type) });
        expect(r.errors, `${type} on ${source}`).toBeUndefined();
        expect(r.fragmentShader, `${type} reads ${source}`).toMatch(SOURCES[source]().sampler);
      }
    });
  }

  it('Mask and Levels also shape a plain Value or Color (no texture)', () => {
    for (const type of ['textureMask', 'textureLevels']) {
      for (const [key, from] of [['value', ['d', 'distance']], ['color', ['c', 'rgb']]] as const) {
        const nodes = [n('uv', 'u', 0, 0), n('circleSDF', 'd', 0, 0, {}, { position: ['u', 'uv'] }), n('colorPicker', 'c', 0, 0),
          n(type, 'tool', 0, 0, {}, { [key]: from as unknown as Wire }), n('output', 'out', 0, 0, {}, { color: ['tool', SHOW[type]] })];
        const r = compileGraph({ nodes });
        expect(r.errors, `${type} from ${key}`).toBeUndefined();
        expect(r.fragmentShader).not.toMatch(/texture2D/);
      }
    }
  });

  it('Outline (distance) draws from Jump flood\'s Distance', () => {
    const s = SOURCES.pass();
    const nodes = [...s.nodes, n('jumpFloodTexture', 'jf', 0, 0, {}, { texture: s.tex }),
      n('distanceShape', 'tool', 0, 0, { mode: 'rings' }, { distance: ['jf', 'distance'] }), n('output', 'out', 0, 0, {}, { color: ['tool', 'light'] })];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.fragmentShader).toMatch(/u_time \*/);
  });

  it('Fade declares the frame-length uniform; nothing else does', () => {
    const r = compileGraph({ nodes: graphWith('pass', 'textureFade') });
    expect(r.passes).toBeDefined();
    expect(r.fragmentShader).toContain(`uniform float ${FRAME_DT_UNIFORM};`);
    expect(compileGraph({ nodes: graphWith('pass', 'textureMask') }).fragmentShader).not.toContain(FRAME_DT_UNIFORM);
  });
});

describe('sampler budget', () => {
  const countSamplers = (fs: string) => (fs.match(/^uniform sampler2D \w+;/gm) ?? []).length;

  it('the tools read the sampler wired in and declare none of their own', () => {
    const base = compileGraph({ nodes: [...SOURCES.pass().nodes, n('sampleTexture', 'tool', 0, 0, {}, { texture: ['src', 'texture'] }), n('output', 'out', 0, 0, {}, { color: ['tool', 'color'] })] });
    // All eight tools on the same Pass, summed into the picture.
    const nodes: GraphNode[] = [...SOURCES.pass().nodes];
    let last: Wire | null = null;
    TEXTURE_TOOL_TYPES.forEach((type, i) => {
      const wires: Record<string, Wire> = { texture: ['src', 'texture'] };
      if (type === 'textureChange') wires.before = ['src', 'previous'];
      nodes.push(n(type, `t${i}`, 0, 0, {}, wires));
      const out = getNodeDefinition(type)!.outputs[SHOW[type]];
      const add = n('addColor', `s${i}`, 0, 0, {}, { ...(last ? { a: last } : {}), ...(out.type === 'vec2' ? {} : { b: [`t${i}`, SHOW[type]] as Wire }) });
      nodes.push(add);
      last = [`s${i}`, 'result'];
    });
    nodes.push(n('output', 'out', 0, 0, {}, { color: last! }));
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    // The Pass's own sampler, plus its Previous (Change reads it): the tools add nothing.
    expect(countSamplers(r.fragmentShader)).toBe(countSamplers(base.fragmentShader));
    expect(countSamplers(r.fragmentShader)).toBeLessThanOrEqual(MAX_SAMPLERS);
  });

  it('Neighbours\' loop has a literal bound the Performance panel reports, and a fixed number of reads', () => {
    expect([3, 5, 7, 9].map(s => neighbourTaps(s))).toEqual([9, 21, 37, 69]);
    // Average and Difference read between texels: 3 × 3 in 4 reads, 5 × 5 in 16…
    expect([3, 5, 7, 9].map(s => neighbourTaps(s, true))).toEqual([4, 16, 32, 60]);
    for (const size of ['3', '5', '7', '9']) {
      for (const mode of ['average', 'max']) {
        const r = compileGraph({ nodes: graphWith('textureInput', 'textureNeighbours', { size, mode }) });
        const shape = shaderShape(r.fragmentShader);
        expect(shape.loopBounds, size).toContain((Number(size) - (mode === 'average' ? 1 : 0)) ** 2);
        expect(shape.maxLoopDepth).toBe(1);
      }
    }
    // Size is a compile-time choice (it is the loop's count); Spacing stays a live uniform.
    const def = getNodeDefinition('textureNeighbours')!;
    expect(def.paramDefs!.size.compileTime).toBe(true);
  });
});

describe('live uniforms', () => {
  it('every float and colour setting is a live uniform; modes are compiled in', () => {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ['textureMask', { source: 'key' }, ['tolerance', 'softness', 'key', 'level', 'width']],
      ['textureMask', { source: 'hue' }, ['hue', 'hueWidth']],
      ['textureLevels', {}, ['gain', 'offset', 'inBlack', 'inWhite', 'gamma', 'rollOff', 'outBlack', 'outWhite']],
      ['textureFlow', {}, ['strength', 'reach']],
      ['textureNeighbours', { mode: 'difference' }, ['spacing', 'strength']],
      ['textureChange', {}, ['amount', 'level', 'width']],
      ['distanceShape', { mode: 'rings' }, ['offset', 'softness', 'spacing', 'thickness', 'fade', 'speed', 'tint']],
      ['textureFade', {}, ['tail', 'clean', 'tint']],
      ['readTexture', {}, ['zoom', 'turn', 'moveX', 'moveY', 'pivotX', 'pivotY']],
    ];
    for (const [type, params, live] of cases) {
      const r = compileGraph({ nodes: graphWith('pass', type, params) });
      for (const k of live) expect(r.paramBindings[`tool::${k}`], `${type}.${k}`).toBeTruthy();
      for (const [k, pd] of Object.entries(getNodeDefinition(type)!.paramDefs ?? {})) {
        if (pd.type === 'select' || pd.type === 'bool') expect(r.paramBindings[`tool::${k}`], `${type}.${k} is compiled in`).toBeUndefined();
      }
    }
  });
});

// ── The maths ───────────────────────────────────────────────────────────────

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const m1 = (a: Val, f: (x: number) => number): Val => (Array.isArray(a) ? a.map(f) : f(a as number));
const m2 = (a: Val, b: Val, f: (x: number, y: number) => number): Val =>
  Array.isArray(a) ? a.map((x, i) => f(x, Array.isArray(b) ? b[i] : (b as number))) : Array.isArray(b) ? b.map(y => f(a as number, y)) : f(a as number, b as number);
const EXTRA: Env = {
  pow: (a: Val, b: Val) => m2(a, b, Math.pow),
  step: (e: Val, x: Val) => m2(e, x, (ee, xx) => (xx < ee ? 0 : 1)),
  smoothstep: (a: Val, b: Val, x: Val) => m1(x, xx => smooth(a as number, b as number, xx)),
  distance: (a: Val, b: Val) => Math.hypot(...(a as number[]).map((x, i) => x - (b as number[])[i])),
  exp2: (a: Val) => m1(a, x => 2 ** x),
};

/** Run a node's own GLSL (numbers baked in, as when a slider isn't a uniform) with `inputVars`. */
function run(type: string, params: Record<string, unknown>, inputVars: Record<string, string>, env: Env): Env {
  const def = getNodeDefinition(type)!;
  const node = n(type, 'tt', 0, 0, params);
  const { code } = def.generateGLSL(node, inputVars);
  return runGlsl(code, { ...EXTRA, ...env });
}

describe('the maths helpers', () => {
  it('thresholds: hard is step, soft is smoothstep(t, t + w)', () => {
    expect([0.49, 0.5, 0.9].map(v => ttHardThreshold(v, 0.5))).toEqual([0, 1, 1]);
    expect(ttSoftThreshold(0.5, 0.5, 0.2)).toBe(0);
    expect(ttSoftThreshold(0.6, 0.5, 0.2)).toBeCloseTo(0.5, 6);
    expect(ttSoftThreshold(0.7, 0.5, 0.2)).toBe(1);
    expect(ttMaskThreshold(0.6, 'soft', 0.5, 0.2, true)).toBeCloseTo(0.5, 6);
    expect(ttMaskThreshold(0.3, 'off', 0.5, 0.2, false)).toBe(0.3);
  });

  it('roll-off, pack and unpack', () => {
    expect(ttRollOff(1, 0)).toBe(1);
    expect(ttRollOff(4, 0.5)).toBeCloseTo(4 / 3, 9);
    expect(ttRollOff(-4, 0.5)).toBeCloseTo(-4 / 3, 9);
    for (const v of [-1, -0.25, 0, 0.6, 1]) expect(ttUnpack(ttPack(v))).toBeCloseTo(v, 12);
    expect(ttPack(0)).toBe(0.5);
  });

  it('decay is frame-rate independent: one second fades the same at 30 and 120 fps', () => {
    const fade = (fps: number, seconds: number, tail: number) => { let v = 1; for (let i = 0; i < fps * seconds; i++) v *= ttDecayFactor(1 / fps, tail); return v; };
    expect(fade(30, 1, 1)).toBeCloseTo(0.01, 6);
    expect(fade(120, 1, 1)).toBeCloseTo(0.01, 6);
    expect(fade(60, 2, 4)).toBeCloseTo(0.1, 6);
    // Clean takes a fixed amount a second off, so faint trails reach black.
    let v = 0.02;
    for (let i = 0; i < 60; i++) v = ttFadeStep(v, 1 / 60, 100, 0.05);
    expect(v).toBe(0);
  });

  it('Levels\' GLSL does what ttLevels says, step for step', () => {
    const cases: Array<Partial<LevelsSettings>> = [
      {}, { gain: 2, offset: -0.1 }, { inBlack: 0.2, inWhite: 0.8, gamma: 2 }, { gamma: 0.5, rollOff: 0.5 },
      { outBlack: 0.2, outWhite: 0.6, clamp: true }, { signed: 'unpack' }, { signed: 'pack', clamp: true }, { inBlack: 0.8, inWhite: 0.2 },
    ];
    for (const s of cases) {
      for (const x of [0, 0.1, 0.5, 0.9, 1.6]) {
        const env = run('textureLevels', { ...s, channel: 'brightness' }, { value: 'X' }, { X: x });
        expect(env.tt_value as number, `${JSON.stringify(s)} at ${x}`).toBeCloseTo(ttLevels(x, s), 5);
      }
    }
  });

  it('Mask\'s GLSL thresholds as ttMaskThreshold says', () => {
    for (const [threshold, invert] of [['off', false], ['hard', false], ['soft', false], ['soft', true]] as const) {
      for (const x of [0, 0.45, 0.55, 0.62, 1]) {
        const env = run('textureMask', { threshold, invert, level: 0.5, width: 0.1 }, { value: 'X' }, { X: x, g_uv: [0, 0] });
        expect(env.tt_mask as number).toBeCloseTo(ttMaskThreshold(x, threshold, 0.5, 0.1, invert), 6);
      }
    }
    // A colour key: the key colour itself is a full match, far colours none.
    const key = (rgb: number[]) => run('textureMask', { source: 'key', key: [0, 1, 0], tolerance: 0.2, softness: 0.1, threshold: 'off' }, { color: 'C' }, { C: rgb, g_uv: [0, 0] }).tt_mask as number;
    expect(key([0, 1, 0])).toBe(1);
    expect(key([1, 0, 1])).toBe(0);
  });

  it('Outline (distance)\'s GLSL matches ttDistanceShape in every mode', () => {
    const o = { offset: 0.05, width: 0.02, softness: 0.01, reach: 0.2, spacing: 0.1, thickness: 0.02, fade: 2, speed: 0 };
    for (const mode of ['outline', 'glow', 'rings', 'inside', 'outside']) {
      for (const d of [0, 0.03, 0.05, 0.07, 0.2, 0.43]) {
        const env = run('distanceShape', { mode, ...o }, { distance: 'D' }, { D: d, u_time: 0 });
        expect(env.tt_mask as number, `${mode} at ${d}`).toBeCloseTo(ttDistanceShape(d, mode, o), 5);
      }
    }
  });

  it('Fade\'s GLSL is max(old × d − e, 0) with d from the tail and the frame\'s length', () => {
    const texture2D = () => [0.8, 0.4, 0.2, 1];
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const env = run('textureFade', { tail: 2, clean: 0.1, tint: [1, 0.5, 1], combine: 'add' }, { texture: 'T', fresh: 'F' },
        { texture2D, T: 0, F: [0.1, 0, 0], g_uv: [0, 0], u_resolution: [100, 100], [FRAME_DT_UNIFORM]: dt });
      const c = env.tt_color as number[];
      expect(c[0]).toBeCloseTo(ttFadeStep(0.8, dt, 2, 0.1) + 0.1, 6);
      expect(c[1]).toBeCloseTo(ttFadeStep(0.4, dt, 1, 0.1), 6);
    }
    // A host that doesn't set the frame's length (0) fades as at 60 fps.
    const env = run('textureFade', { tail: 2, clean: 0 }, { texture: 'T' }, { texture2D, T: 0, g_uv: [0, 0], u_resolution: [100, 100], [FRAME_DT_UNIFORM]: 0 });
    expect((env.tt_color as number[])[0]).toBeCloseTo(0.8 * ttDecayFactor(1 / 60, 2), 6);
  });

  it('Read at its defaults reads exactly here; Zoom 2 reads halfway to the pivot', () => {
    const env0 = run('readTexture', {}, {}, { g_uv: [0.4, -0.2], u_resolution: [100, 100] });
    expect(env0.tt_q).toEqual([0.4, -0.2]);
    const env1 = run('readTexture', { zoom: 2, pivotX: 0.2 }, {}, { g_uv: [0.4, -0.2], u_resolution: [100, 100] });
    expect((env1.tt_q as number[])[0]).toBeCloseTo(0.3, 9);
    expect((env1.tt_q as number[])[1]).toBeCloseTo(-0.1, 9);
  });

  it('Flow points uphill, and along the contours when asked', () => {
    // A ramp brightening to the right: uphill is +x, along the contours is +y.
    const texture2D = (_t: Val, st: Val) => { const x = (st as number[])[0]; return [x, x, x, 1]; };
    const env = { texture2D, T: 0, g_uv: [0, 0], u_resolution: [100, 100], T_px: [0.01, 0.01] };
    const up = run('textureFlow', { strength: 1 }, { texture: 'T' }, { ...env }).tt_flow as number[];
    expect(up[0]).toBeCloseTo(1, 6);
    expect(up[1]).toBeCloseTo(0, 6);
    const along = run('textureFlow', { strength: 1, direction: 'along' }, { texture: 'T' }, { ...env }).tt_flow as number[];
    expect(along[0]).toBeCloseTo(0, 6);
    expect(along[1]).toBeCloseTo(1, 6);
  });

  it('Change\'s direction follows a moving edge', () => {
    // An edge moving right: brightness ramps up to the right, and this pixel got darker (the dark side moved in).
    const now = (_t: Val, st: Val) => { const x = (st as number[])[0]; return [x, x, x, 1]; };
    const texture2D = (t: Val, st: Val) => (t === 1 ? now(t, st).map((v, i) => (i < 3 ? (v as number) + 0.01 : v)) : now(t, st));
    const env = run('textureChange', { amount: 100, level: 0, width: 0.01 }, { texture: 'T', before: 'B' }, { texture2D, T: 0, B: 1, g_uv: [0, 0], u_resolution: [100, 100], T_px: [0.01, 0.01] });
    expect(env.tt_change as number).toBeLessThan(0);
    expect((env.tt_dir as number[])[0]).toBeGreaterThan(0);
  });
});

// ── Around the nodes ────────────────────────────────────────────────────────

describe('quick adds, Switch to and starter offers', () => {
  it('a texture output offers the Texture tools; a texture input offers its sources', () => {
    expect(suggestQuickAdds({ type: 'texture', dir: 'out', label: 'Texture' }).map(q => q.type)).toEqual(['textureMask', 'textureLevels', 'textureFlow']);
    expect(suggestQuickAdds({ type: 'texture', dir: 'in', label: 'Texture' }).map(q => q.type)).toEqual(['pass', 'textureInput']); // one Texture node: picture, video or webcam (docs/texture-node.md)
  });

  it('a mask or shaped value goes to colour first; a distance from a jump flood to Outline; a glow to the layering nodes', () => {
    for (const nodeType of ['textureMask', 'textureLevels', 'textureNeighbours', 'distanceShape']) {
      expect(suggestQuickAdds({ type: 'float', dir: 'out', label: 'Mask', nodeType }).map(q => q.type)).toEqual(['palette', 'colorRamp', 'mix']);
    }
    expect(suggestQuickAdds({ type: 'float', dir: 'out', label: 'Distance', nodeType: 'jumpFloodTexture' })[0].type).toBe('distanceShape');
    expect(suggestQuickAdds({ type: 'vec3', dir: 'out', label: 'Light', nodeType: 'distanceShape' }).map(q => q.type).slice(0, 2)).toEqual(['addColor', 'blendModes']);
    // Elsewhere nothing changes.
    expect(suggestQuickAdds({ type: 'float', dir: 'out', label: 'Distance' }).map(q => q.type)).toEqual(['sdfFill', 'glowLayer', 'sdfColorize']);
  });

  it('switch among themselves', () => {
    expect(canSwitchNode(n('textureMask', 'a', 0, 0))).toBe(true);
    const fam = switchFamiliesFor('textureMask').flatMap(f => f.types);
    expect(fam).toEqual(expect.arrayContaining(['textureLevels', 'textureNeighbours', 'textureFlow']));
  });

  it('Jump flood, Change and Fade offer setups', () => {
    expect(recipesFor('jumpFloodTexture').map(r => r.id)).toEqual(['flood-outline', 'flood-glow', 'flood-rings']);
    expect(recipesFor('textureChange').length).toBeGreaterThan(0);
    expect(recipesFor('textureFade').length).toBeGreaterThan(0);
  });
});

describe('the Texture tools examples', () => {
  const walk = (nodes: GraphNode[], visit: (nd: GraphNode) => void) => {
    for (const nd of nodes) { visit(nd); const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, visit); }
  };

  it('are a folder of their own, use every Texture tool, and compile', () => {
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Texture tools')?.keys).toEqual(TEXTURE_TOOL_EXAMPLE_KEYS);
    expect(TEXTURE_TOOL_EXAMPLE_KEYS.length).toBeGreaterThanOrEqual(4);
    const used = new Set<string>();
    for (const k of TEXTURE_TOOL_EXAMPLE_KEYS) {
      walk(EXAMPLE_GRAPHS[k].nodes, nd => used.add(nd.type));
      const r = compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition) });
      expect(r.errors, k).toBeUndefined();
    }
    for (const t of TEXTURE_TOOL_TYPES) expect(used.has(t), t).toBe(true);
  });

  it('every node has a plain-language note, and Expression Blocks explain each named line', () => {
    const missing: string[] = [];
    for (const k of TEXTURE_TOOL_EXAMPLE_KEYS) walk(EXAMPLE_GRAPHS[k].nodes, nd => {
      const note = String(nd.params?.__comment ?? '');
      if (note.trim().length < 20) missing.push(`${k}: ${nd.id} (${nd.type})`);
      if (nd.type !== 'exprNode') return;
      for (const line of (nd.params.lines ?? []) as Array<{ lhs: string }>) {
        const name = line.lhs.trim().split(/\s+/).pop()!;
        if (!new RegExp(`(^|\\W)${name}( = [^\\n:]*)?:`, 'm').test(note)) missing.push(`${k}/${nd.id}: line "${name}"`);
      }
    });
    expect(missing).toEqual([]);
  });
});
