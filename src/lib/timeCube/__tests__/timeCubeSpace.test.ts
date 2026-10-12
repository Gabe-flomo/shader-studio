/**
 * Time Cube in space (docs/timecube-space.md): the view's Repeat and Warp, the Space socket with a Time Cube Shape in a
 * Scene Group (through Repeat Scene and 3D warps), and that the plain view is untouched when they are off. The GLSL is
 * checked by the compiler and by a GLSL parser here; the GPU compile and the pictures are checked in a browser.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../../compiler/graphCompiler';
import { buildTimeCubeExamples } from '../../../store/timeCubeExamples';
import { n } from '../../../store/graphBuilder';
import { SPACE_PARAM_KEYS, TC_SPACE_DECL, TimeCubeViewNode, spaceOn } from '../../../nodes/definitions/timeCube';
import type { GraphNode, SubgraphData } from '../../../types/nodeGraph';
import { compileFragment, type Val } from '../../../compiler/__tests__/glslRun';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

const view = (params: Record<string, unknown>, wires: Record<string, [string, string]> = {}): GraphNode[] => [
  n('timeCube', 'src', 0, 0),
  n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'], ...wires }),
  n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
];

const ok = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  expect(parses(r.fragmentShader)).toBeNull();
  return r;
};

const twistedScene = (shapeWire = true): SubgraphData => ({ inputPorts: [], outputPorts: [], nodes: [
  n('scenePos', 'sp', 0, 0, { _groupOriginal: true }),
  n('twist3D', 'tw', 200, 0, { k: 0.8 }, { pos: ['sp', 'pos'] }),
  n('timeCubeShape', 'sh', 400, 0, {}, shapeWire ? { pos: ['tw', 'pos'] } : {}),
  n('sceneOutput', 'so', 600, 0, { _groupOriginal: true }, { dist: ['sh', 'dist'] }),
] });

describe('Time Cube View: space off', () => {
  it('the space settings are on the card, in the Space section, and off by default', () => {
    const d = TimeCubeViewNode.defaultParams as Record<string, unknown>;
    for (const k of SPACE_PARAM_KEYS) {
      expect(['Repeat', 'Copies', 'Warp', 'Space']).toContain(TimeCubeViewNode.paramDefs?.[k]?.section);
      expect(k in d, k).toBe(true);
    }
    expect(spaceOn(d)).toBe(false);
    expect(TimeCubeViewNode.inputs.space.type).toBe('scene3d');
  });

  it('off, the view compiles exactly as without the space settings (the plain march, no space code)', () => {
    for (const [k, g] of Object.entries(buildTimeCubeExamples())) {
      if (g.nodes.some(x => x.type === 'timeCubeView' && (spaceOn(x.params) || x.inputs.space?.connection))) continue;
      const strip = g.nodes.map(x => x.type !== 'timeCubeView' ? x : { ...x, params: Object.fromEntries(Object.entries(x.params).filter(([key]) => !SPACE_PARAM_KEYS.includes(key))) });
      const withDefaults = g.nodes.map(x => x.type !== 'timeCubeView' ? x : { ...x, params: { ...TimeCubeViewNode.defaultParams, ...x.params } });
      const a = compileGraph({ nodes: strip }), b = compileGraph({ nodes: withDefaults });
      const main = (s: string) => s.slice(s.indexOf('void main'));
      expect(main(b.fragmentShader), k).toBe(main(a.fragmentShader));
      expect(b.fragmentShader, k).not.toContain('tcSpaceWarp');
      expect(b.fragmentShader, k).not.toContain('g_tcB');
    }
  });
});

describe('Time Cube View: repeat and warp', () => {
  it('Repeat compiles to the space march, every slider a live uniform', () => {
    const r = ok(view({ repeat: true, copyTime: 0.1, copyHue: 0.2, copySpin: 30 }));
    expect(r.fragmentShader).toContain('tcHash3(');
    expect(r.fragmentShader).not.toContain('tcRayRoundBoxIn(v_ro');
    for (const k of ['repGap', 'repCount', 'copyTime', 'copyHue', 'copySpin', 'farDist', 'spaceFog', 'before', 'after', 'slice']) {
      expect(r.paramBindings[`v::${k}`], k).toBeTruthy();
    }
  });

  it.each(['x', 'y', 'z', 'xz', 'xy', 'xyz'])('repeats along %s', axes => {
    ok(view({ repeat: true, repAxes: axes, repMirror: true, copyTimeBy: 'random' }));
  });

  it.each(['twist', 'bend', 'wave', 'noise'])('warp %s compiles on each box and on the whole space, live', warp => {
    for (const where of ['each', 'space']) {
      const r = ok(view({ warp, warpWhere: where, repeat: where === 'space' }));
      expect(r.fragmentShader).toContain('tcSpaceWarp(');
      for (const k of ['warpAmount', 'warpFreq', 'warpSpeed']) expect(r.paramBindings[`v::${k}`], k).toBeTruthy();
    }
  });

  it('with keys, flow, tilt, feather, outline and a stack axis, still compiles', () => {
    ok(view({ repeat: true, warp: 'bend', timeMode: 'flow', keyMode: 'hue', keyAnimate: true, pulse: 1, pulseDir: 'outward', tiltX: 20, timeFeather: 8, outline: 'silhouette', axis: 'x' }));
    ok(view({ repeat: true, keyMode: 'luma', axis: 'y', highlights: true, motion: true, outline: 'edges' }));
  });

  it('Highlights and Frame motion are left out in space (their sheets need the one box)', () => {
    const r = ok(view({ repeat: true, highlights: true, motion: true }));
    expect(r.fragmentShader).not.toContain('tcCombNext(');
    expect(r.fragmentShader).not.toContain('tcShapeAt(');
  });
});

describe('Time Cube View: a wired Space (Time Cube Shape in a Scene Group)', () => {
  it('through a Twist 3D and a Repeat Scene: the scene is measured, the globals declared once', () => {
    const nodes: GraphNode[] = [
      ...view({ copyTime: 0.3, copyTimeBy: 'random' }, { space: ['rep', 'scene'] }),
      n('sceneGroup', 'sg', 0, 300, { subgraph: twistedScene() }),
      n('repeatScene', 'rep', 300, 300, { cellX: 3, cellY: 50, cellZ: 3, countX: 2, neighbours: 'skip' }, { scene: ['sg', 'scene'] }),
    ];
    const r = ok(nodes);
    const fs = r.fragmentShader;
    expect(fs.split(TC_SPACE_DECL.split('\n')[0]).length - 1).toBe(1);
    expect(fs).toMatch(/g_tcBest = 1e9;[^\n]*\n\s*(repScene|mapScene)_\w+\(\w+_mp/);
    expect(fs).toContain('g_tcCell = g_cell3;');
    expect(r.paramBindings['v::spaceStep']).toBeTruthy();
  });

  it('the scene alone (no Repeat Scene), and the view\'s own repeat on top', () => {
    ok([...view({ repeat: true, repAxes: 'x' }, { space: ['sg', 'scene'] }), n('sceneGroup', 'sg', 0, 300, { subgraph: twistedScene() })]);
  });

  it('a Time Cube Shape measured by a March Loop alone compiles (its globals come with it)', () => {
    const nodes: GraphNode[] = [
      n('marchCamera', 'cam', 0, 0),
      n('sceneGroup', 'sg', 0, 300, { subgraph: twistedScene() }),
      n('marchLoopGroup', 'ml', 300, 0, { subgraph: { inputPorts: [], outputPorts: [], nodes: [
        n('marchLoopInputs', 'mi', 0, 0, { _groupOriginal: true }),
        n('marchLoopOutput', 'mo', 200, 0, { _groupOriginal: true }, { pos: ['mi', 'marchPos'] }),
      ] } }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['sg', 'scene'] }),
      n('output', 'out', 600, 0, {}, { color: ['ml', 'color'] }),
    ];
    const r = ok(nodes);
    expect(r.fragmentShader).toContain('float g_tcBest = 1e9;');
    expect(r.fragmentShader).toContain('vec3 g_cell3');
  });

  it('an empty Scene Group in Space falls back to the plain view', () => {
    const r = ok([...view({}, { space: ['sg', 'scene'] }), n('sceneGroup', 'sg', 0, 300, { subgraph: { inputPorts: [], outputPorts: [], nodes: [] } })]);
    expect(r.fragmentShader).toContain('tcRayRoundBoxIn(');
  });
});

describe('the examples', () => {
  const ex = buildTimeCubeExamples();
  it.each(['timeCubeHall', 'timeCubeTwisted', 'timeCubeTrain', 'timeCubeSceneSpace'])('%s compiles, parses, uses the Ball action clip and has notes', k => {
    const g = ex[k];
    const r = ok(g.nodes);
    expect(r.fragmentShader).toContain('tcSample(');
    const src = g.nodes.find(x => x.type === 'timeCube')!;
    expect(src.params.source ?? 'ball').toBe('ball');
    for (const nd of g.nodes) expect(String(nd.params.__comment ?? '').length, nd.id).toBeGreaterThan(10);
    const sub = g.nodes.find(x => x.type === 'sceneGroup')?.params.subgraph as SubgraphData | undefined;
    for (const nd of sub?.nodes ?? []) expect(String(nd.params.__comment ?? '').length, nd.id).toBeGreaterThan(10);
  });
});

describe('the space warps (GLSL, run on the CPU)', () => {
  const src = (TimeCubeViewNode.glslFunctions ?? []).find(s => s.includes('vec3 tcSpaceWarp('))!;
  const prog = compileFragment(`${src}\nuniform vec3 P; uniform vec4 W; uniform float M; uniform float AX;\nvoid main() { gl_FragColor = vec4(tcSpaceWarp(P, M, W, AX), 0.0); }`);
  const run = (p: number[], mode: number, wp: number[], ax = 0) => {
    const env: Record<string, Val> = { P: p, M: mode, W: wp, AX: ax };
    const o = prog.run(env).gl_FragColor as number[];
    return o.slice(0, 3);
  };
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
  it('amount 0 leaves space as it is, for every warp and stack axis', () => {
    for (const mode of [1, 2, 3, 4]) for (const ax of [0, 1, 2]) expect(close(run([0.3, -0.2, 0.7], mode, [0, 1, 0, 0], ax), [0.3, -0.2, 0.7]), `${mode}/${ax}`).toBe(true);
  });
  it('twist turns round the time axis: the time coordinate and the distance from the axis stay', () => {
    for (const ax of [0, 1, 2]) {
      const p = [0.3, -0.2, 0.7];
      const q = run(p, 1, [0.6, 1.3, 0, 0], ax);
      const t = ax === 0 ? 2 : ax === 1 ? 0 : 1;
      expect(Math.abs(q[t] - p[t])).toBeLessThan(1e-6);
      const r2 = (v: number[]) => v.reduce((s, x, i) => s + (i === t ? 0 : x * x), 0);
      expect(Math.abs(r2(q) - r2(p))).toBeLessThan(1e-5);
      expect(close(q, p)).toBe(false);
    }
  });
  it('twist and bend breathe with the phase: a quarter turn of phase undoes them', () => {
    expect(close(run([0.3, -0.2, 0.7], 1, [0.8, 1, Math.PI / 2, 0]), [0.3, -0.2, 0.7])).toBe(true);
    expect(close(run([0.3, -0.2, 0.7], 2, [0.8, 1, Math.PI / 2, 0]), [0.3, -0.2, 0.7])).toBe(true);
  });
  it('wave moves points across time only, by at most a quarter of the amount up and less sideways', () => {
    const p = [0.1, 0.2, 0.45];
    const q = run(p, 3, [1, 1, 0.3, 0]);
    expect(q[2]).toBeCloseTo(p[2], 6);
    expect(Math.abs(q[1] - p[1])).toBeLessThanOrEqual(0.25 + 1e-6);
    expect(Math.abs(q[0] - p[0])).toBeLessThanOrEqual(0.15 + 1e-6);
  });
});
