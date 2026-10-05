/**
 * Time Cube View's temporal feather and its even opacity sliders (docs/time-cube.md, "Feather" and
 * "How it is drawn"): the ramp in lib/timeCube/style.ts that the GLSL's tcFeather mirrors, its
 * settings being live uniforms, and graphs saved before the opacity change loading as they looked.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { featherEase, featherOpacity, type TimeFeather } from '../style';
import { migrateOpacity } from '../plan';
import { compileGraph } from '../../../compiler/graphCompiler';
import { getNodeDefinition } from '../../../nodes/definitions';
import { TIME_CUBE_VIEW_VERSION } from '../../../nodes/definitions/timeCube';
import { buildTimeCubeExamples } from '../../../store/timeCubeExamples';
import { n } from '../../../store/graphBuilder';
import { migratePlayRecord } from '../../../store/migratePlay';
import { migrateNodeParams, type GraphNode } from '../../../types/nodeGraph';
import { parsePlayRecord, type PlayRecord } from '../../../types/play';

const F = (o: Partial<TimeFeather> = {}): TimeFeather => ({ width: 0.2, side: -1, curve: 0, wrap: false, ...o });
const BO = 0.2, AO = 0.9;
/** The opacity at box time g, the step's middle and its read point both at g. */
const at = (g: number, s: number, f: TimeFeather) => featherOpacity(g, g, s, BO, AO, f);

describe('the feather', () => {
  it('width 0 is exactly the hard step at the slice', () => {
    for (const g of [0, 0.2, 0.4999, 0.5, 0.7, 1]) expect(at(g, 0.5, F({ width: 0 }))).toBe(g < 0.5 ? BO : AO);
    // The read point does not matter then: the side is the step's.
    expect(featherOpacity(0.49, 0.51, 0.5, BO, AO, F({ width: 0 }))).toBe(BO);
  });

  it('Before (the default): the frames leading up to the slice fade from Before to After', () => {
    const f = F();
    expect(at(0.29, 0.5, f)).toBe(BO);
    expect(at(0.3, 0.5, f)).toBeCloseTo(BO, 9);
    expect(at(0.4, 0.5, f)).toBeCloseTo((BO + AO) / 2, 9);
    expect(at(0.4999999, 0.5, f)).toBeCloseTo(AO, 5);
    expect(at(0.5, 0.5, f)).toBe(AO);
    expect(at(0.8, 0.5, f)).toBe(AO);
    // It rises steadily through the ramp.
    let last = -1;
    for (let g = 0.3; g < 0.5; g += 0.005) { const o = at(g, 0.5, f); expect(o).toBeGreaterThanOrEqual(last); last = o; }
  });

  it('Centred and After move the ramp; each side is continuous with the step around it', () => {
    const c = F({ side: 0 });
    expect(at(0.39, 0.5, c)).toBe(BO);
    expect(at(0.5, 0.5, c)).toBeCloseTo((BO + AO) / 2, 9);
    expect(at(0.61, 0.5, c)).toBe(AO);
    const a = F({ side: 1 });
    expect(at(0.49, 0.5, a)).toBe(BO);
    expect(at(0.5, 0.5, a)).toBeCloseTo(BO, 9);
    expect(at(0.6, 0.5, a)).toBeCloseTo((BO + AO) / 2, 9);
    expect(at(0.71, 0.5, a)).toBe(AO);
    for (const side of [-1, -0.5, 0, 0.5, 1]) {
      const f = F({ side });
      const lo = 0.5 - 0.1 * (1 - side), hi = lo + 0.2;
      expect(at(lo - 1e-7, 0.5, f)).toBeCloseTo(at(lo + 1e-7, 0.5, f), 4);
      expect(at(hi - 1e-7, 0.5, f)).toBeCloseTo(at(hi + 1e-7, 0.5, f), 4);
    }
  });

  it('the curve: 0 smooth, −1 eases in (stays see-through longer), 1 eases out (firms up early)', () => {
    expect(featherEase(0.5, 0)).toBeCloseTo(0.5, 9);
    expect(featherEase(0.25, 0)).toBeCloseTo(0.15625, 9);
    expect(featherEase(0.25, -1)).toBeCloseTo(0.0625, 9);
    expect(featherEase(0.25, 1)).toBeCloseTo(0.4375, 9);
    for (const c of [-1, -0.4, 0, 0.6, 1]) {
      expect(featherEase(0, c)).toBe(0);
      expect(featherEase(1, c)).toBe(1);
      let last = -1;
      for (let x = 0; x <= 1; x += 0.01) { const y = featherEase(x, c); expect(y).toBeGreaterThanOrEqual(last - 1e-12); last = y; }
    }
    expect(at(0.35, 0.5, F({ curve: -1 }))).toBeLessThan(at(0.35, 0.5, F()));
    expect(at(0.35, 0.5, F({ curve: 1 }))).toBeGreaterThan(at(0.35, 0.5, F()));
  });

  it('in Flow the ramp wraps round the box\'s ends, as the clip does; in Slice it stops at the front', () => {
    // The frame near the front: half the Before ramp is at the back of the box.
    const s = 0.05, w = F({ wrap: true }), nw = F();
    expect(at(0.95, s, w)).toBeCloseTo((BO + AO) / 2, 9);
    expect(at(0.84, s, w)).toBe(AO); // in front of the wrapped ramp (0.85–1): After, as without a feather
    expect(at(0.95, s, nw)).toBe(AO);
    expect(at(0, s, w)).toBeCloseTo(at(0, s, nw), 12);
    // Away from the ends, wrapping changes nothing.
    for (const g of [0.2, 0.35, 0.45, 0.6]) expect(at(g, 0.5, w)).toBe(at(g, 0.5, nw));
  });

  it('the ramp is read at the step\'s own jittered point (fine grain, not bands a step wide)', () => {
    // Same step (middle 0.4), two read points: two opacities on the ramp.
    expect(featherOpacity(0.4, 0.38, 0.5, BO, AO, F())).toBeLessThan(featherOpacity(0.4, 0.42, 0.5, BO, AO, F()));
  });
});

const view = (params: Record<string, unknown>): GraphNode[] => [
  n('timeCube', 'src', 0, 0),
  n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'] }),
  n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
];

describe('the view', () => {
  it('Feather, its side and curve are live uniforms in Slice and Flow (no recompile), with highlights, key, motion and focus', () => {
    for (const params of [
      { timeFeather: 12 },
      { timeMode: 'flow', timeFeather: 12, highlights: true, keyMode: 'hue', keyAnimate: true },
      { highlights: true, motion: true, effects: true, dof: 'slice', timeFeather: 8, featherSide: 0, featherCurve: 0.5 },
    ]) {
      const r = compileGraph({ nodes: view(params) });
      expect(r.errors ?? []).toEqual([]);
      for (const k of ['timeFeather', 'featherSide', 'featherCurve', 'before', 'after']) expect(r.paramBindings[`v::${k}`], k).toBeTruthy();
      expect(r.fragmentShader).toMatch(/tcFeather\(\w+_gmid, \w+_gj, \w+_sl0, \w+_tf, /);
    }
    // Dragging Feather does not change the shader: only its uniform.
    const a = compileGraph({ nodes: view({ timeFeather: 4 }) }), b = compileGraph({ nodes: view({ timeFeather: 30, featherSide: 0.3, featherCurve: -1 }) });
    expect(b.fragmentShader).toBe(a.fragmentShader);
    // Flow wraps; Slice does not.
    expect(compileGraph({ nodes: view({ timeMode: 'flow' }) }).fragmentShader).toMatch(/_tf = vec4\([^;]*, 1\.0\);/);
    expect(a.fragmentShader).toMatch(/_tf = vec4\([^;]*, 0\.0\);/);
  });

  it('a new node starts with no feather (the hard line); the box example has a modest one', () => {
    expect(getNodeDefinition('timeCubeView')!.defaultParams!.timeFeather).toBe(0);
    const ex = buildTimeCubeExamples();
    const box = ex.timeCubeBox.nodes.find(nd => nd.type === 'timeCubeView')!;
    expect(box.params.timeFeather).toBe(16);
    expect(String(box.params.__comment)).toMatch(/Feather 16/);
  });
});

describe('graphs saved before the opacity change', () => {
  const migrate = (node: GraphNode) => migrateNodeParams(node, getNodeDefinition);
  const old = (params: Record<string, unknown>) => {
    const node = n('timeCubeView', 'v', 0, 0, params);
    delete node.params._schemaVersion;
    return node;
  };

  it('new nodes are stamped with the current version and never migrated', () => {
    const node = n('timeCubeView', 'v', 0, 0, { before: 0.4 });
    expect(node.params._schemaVersion).toBe(TIME_CUBE_VIEW_VERSION);
    expect(migrate(node).params.before).toBe(0.4);
  });

  it('Before, After and Kept opacity convert to the same look (missing ones from the old defaults), keyframes too', () => {
    const node = old({ before: 0.6, after: 0.7, keyOpacity: 1, __keyframes_after: [{ t: 0, v: 0.45, ease: 'linear' }, { t: 2, v: 1, ease: 'linear' }] });
    delete node.params.after; node.params.after = 0.7;
    const m = migrate(node).params;
    expect(m._schemaVersion).toBe(TIME_CUBE_VIEW_VERSION);
    expect(m.before).toBe(migrateOpacity(0.6));
    expect(m.after).toBe(migrateOpacity(0.7));
    expect(m.keyOpacity).toBe(1);
    expect((m.__keyframes_after as Array<{ v: number }>).map(k => k.v)).toEqual([migrateOpacity(0.45), 1]);
    const bare = old({});
    delete bare.params.before; delete bare.params.after;
    const mb = migrate(bare).params;
    expect(mb.before).toBeCloseTo(0.2584, 4);
    expect(mb.after).toBe(1);
  });

  it('Play controls on an opacity keep covering the same looks (their step stays)', () => {
    const saved = [old({ before: 0.45 })];
    const record: PlayRecord = {
      ...parsePlayRecord(null),
      controls: [{ id: 'c1', target: 'v::before', kind: 'float', label: 'Before', min: 0, max: 0.9, step: 0.01 }, { id: 'c2', target: 'v::slice', kind: 'float', label: 'Offset', min: 0, max: 1 }],
      mappings: [{ id: 'm1', controlId: 'c1', source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }, outMin: 0.2, outMax: 0.8, curve: 'linear', smoothMs: 0, enabled: true }],
    } as PlayRecord;
    const p = migratePlayRecord(record, saved, getNodeDefinition);
    expect(p.controls[0]).toMatchObject({ min: 0, max: migrateOpacity(0.9), step: 0.01 });
    expect(p.controls[1]).toMatchObject({ min: 0, max: 1 });
    expect(p.mappings[0]).toMatchObject({ outMin: migrateOpacity(0.2), outMax: migrateOpacity(0.8) });
  });
});
