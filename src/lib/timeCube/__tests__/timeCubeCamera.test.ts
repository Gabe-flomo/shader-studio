/**
 * Time Cube View's camera (docs/time-cube.md, "Camera"): Translate X / Y / Z, every camera setting a
 * live uniform on Play's list (no input sockets), the fly-through example, and the settings the view
 * no longer has (Swing, Lightning, Focus, Frame effects) dropped from older graphs.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { compileGraph } from '../../../compiler/graphCompiler';
import { getNodeDefinition } from '../../../nodes/definitions';
import { REMOVED_VIEW_PARAMS, swingToOrbit } from '../../../nodes/definitions/timeCube';
import { collectPlayCandidates } from '../../../play/playControls';
import { buildTimeCubeExamples, TIME_CUBE_EXAMPLE_INDEX } from '../../../store/timeCubeExamples';
import { n } from '../../../store/graphBuilder';
import { migrateNodeParams, type GraphNode } from '../../../types/nodeGraph';

const CAMERA = ['camDist', 'camAngle', 'camElevation', 'rotSpeed', 'ortho', 'fov', 'camX', 'camY', 'camZ'];
const view = (params: Record<string, unknown>): GraphNode[] => [
  n('timeCube', 'src', 0, 0),
  n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'] }),
  n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
];

describe('the camera', () => {
  it('Translate X / Y / Z move the camera and the point it looks at together, after the orbit', () => {
    const r = compileGraph({ nodes: view({ camX: 0.5, camZ: -1 }) });
    expect(r.errors ?? []).toEqual([]);
    const fs = r.fragmentShader!;
    // The orbit's direction is worked out round the box's centre, then the whole camera moves.
    const ro = fs.search(/\w+_ro \+= vec3\(u_p_\w+_camX, u_p_\w+_camY, u_p_\w+_camZ\);/);
    expect(ro).toBeGreaterThan(fs.search(/vec3 \w+_rd = normalize\(/));
    expect(fs).not.toMatch(/_sw = /);
  });

  it('every camera setting is a live uniform on Play\'s list, with no input socket', () => {
    const nodes = view({});
    const r = compileGraph({ nodes });
    const listed = collectPlayCandidates(nodes, r.paramBindings).map(c => c.target);
    for (const k of CAMERA) {
      expect(r.paramBindings[`v::${k}`], k).toBeTruthy();
      expect(listed, k).toContain(`v::${k}`);
    }
    const def = getNodeDefinition('timeCubeView')!;
    for (const k of CAMERA) expect(def.inputs[k], k).toBeUndefined();
    // Dragging them never recompiles.
    expect(compileGraph({ nodes: view({ camX: 2, camZ: -3, camAngle: 1, fov: 3 }) }).fragmentShader).toBe(r.fragmentShader);
  });

  it('the view has no Swing, Lightning, Focus or Frame effects any more', () => {
    const def = getNodeDefinition('timeCubeView')!;
    for (const k of REMOVED_VIEW_PARAMS) {
      expect(def.paramDefs![k], k).toBeUndefined();
      expect(def.defaultParams![k], k).toBeUndefined();
    }
    const fs = compileGraph({ nodes: view({ keyMode: 'hue', keyAnimate: true, highlights: true, motion: true }) }).fragmentShader!;
    for (const gone of ['tcBurst', 'tcSampleBlur', 'tcBlurTaps', 'tcFx(', 'tcHash']) expect(fs, gone).not.toContain(gone);
  });
});

describe('the fly-through example', () => {
  const ex = buildTimeCubeExamples();
  it('replaces the depth-of-field example, is listed for Play, and its panel drives the camera', () => {
    expect(TIME_CUBE_EXAMPLE_INDEX.timeCubeFocus).toBeUndefined();
    expect(TIME_CUBE_EXAMPLE_INDEX.timeCubeFlyThrough.play).toBe(true);
    const fly = ex.timeCubeFlyThrough;
    const r = compileGraph({ nodes: fly.nodes });
    expect(r.success).toBe(true);
    const targets = fly.play!.controls.map(c => c.target);
    for (const k of ['camZ', 'camX', 'camY', 'camDist', 'camAngle', 'camElevation', 'fov', 'ortho']) expect(targets).toContain(`tfyView::${k}`);
    for (const c of fly.play!.controls) expect(r.paramBindings[c.target], c.target).toBeTruthy();
    // LFOs fly it: Translate Z from in front of the first frame to past the slice.
    const z = fly.play!.mappings.find(m => m.controlId === 'tz')!;
    expect(z.source.kind).toBe('lfo');
    expect(z.outMin).toBeLessThan(0);
    expect(z.outMax).toBeGreaterThan(0);
  });

  it('no example uses what was removed; the pulsing key has no lightning', () => {
    for (const [k, g] of Object.entries(ex)) {
      for (const nd of g.nodes) for (const p of REMOVED_VIEW_PARAMS) expect(nd.params[p], `${k}/${nd.id}/${p}`).toBeUndefined();
      for (const c of g.play?.controls ?? []) expect(REMOVED_VIEW_PARAMS.some(p => c.target.endsWith(`::${p}`)), c.target).toBe(false);
    }
    expect(JSON.stringify(ex.timeCubePulse)).not.toMatch(/ightning/);
  });
});

describe('older graphs with the removed settings', () => {
  const old = (params: Record<string, unknown>) => {
    const node = n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'] });
    delete node.params._schemaVersion;
    for (const k of ['camX', 'camY', 'camZ', 'timeFeather', 'featherSide', 'featherCurve']) delete node.params[k];
    return node;
  };
  const migrate = (node: GraphNode) => migrateNodeParams(node, getNodeDefinition);

  it('load and compile, the removed settings and their keyframes dropped quietly', () => {
    const node = old({
      dof: 'slice', blur: 0.9, focus: 1, maxBlur: 18, blurQuality: 'fast', effects: true, fxHue: 0.5, fxPosterize: 4, fxAgeGrey: 0.5,
      keyMode: 'hue', keyAnimate: true, lightning: 0.45, lightningRate: 2.5, lightningWidth: 0.12, lightningSeed: 7,
      __keyframes_blur: [{ t: 0, v: 0, ease: 'linear' }], swing: 0.2, rotSpeed: 0.5,
    });
    const m = migrate(node);
    for (const k of REMOVED_VIEW_PARAMS) expect(m.params[k], k).toBeUndefined();
    expect(m.params.__keyframes_blur).toBeUndefined();
    expect(m.params.keyMode).toBe('hue');
    const r = compileGraph({ nodes: [n('timeCube', 'src', 0, 0), m, n('output', 'out', 600, 0, {}, { color: ['v', 'color'] })] });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    // The new settings are there at values that change nothing, so they are on Play's list at once.
    expect(m.params).toMatchObject({ camX: 0, camY: 0, camZ: 0, timeFeather: 0, featherSide: -1, featherCurve: 0 });
    expect(r.paramBindings['v::camZ']).toBeTruthy();
  });

  it('a swinging camera becomes the nearest plain one: still for a small swing, an orbit for a wide one', () => {
    expect(swingToOrbit(0.25, 0.35)).toBe(0);
    expect(swingToOrbit(3, 0.5)).toBeCloseTo(2 / Math.PI * 3 * 0.5, 12);
    expect(swingToOrbit(0, 0.4)).toBe(0.4);
    expect(swingToOrbit(1, 0)).toBe(0);
    expect(migrate(old({ swing: 0.25, rotSpeed: 0.35, camAngle: 0.5 })).params).toMatchObject({ rotSpeed: 0, camAngle: 0.5 });
    expect(migrate(old({ swing: 3, rotSpeed: -0.5 })).params.rotSpeed).toBeCloseTo(-2 / Math.PI * 1.5, 12);
    expect(migrate(old({ rotSpeed: 0.12 })).params.rotSpeed).toBe(0.12);
  });
});
