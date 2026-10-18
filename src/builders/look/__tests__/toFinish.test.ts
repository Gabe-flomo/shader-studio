/**
 * One Finish (docs/finish-stack.md, "One Finish"): the 2D builder's older Grade cards, vignette and
 * grain map onto the graph's Finish stack and back; a Build moves them (Pro), with hand-made node
 * changes and Play controls; on Free they stay nodes; old data still loads and builds unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});
import { GRADE_KINDS } from '../grade';
import { newStackItem, type StackItem } from '../stack';
import {
  BUILDER_FX_PREFIX, addMovedToPlay, finishToGradeItem, finishToPost, gradeItemToFinish, hasMovableLook, lookToFinish, postToFinish, withoutMovedLook,
} from '../toFinish';
import { fnParseCustom } from '../../../play/kit/finish.js';
import { parseFinish, type FinishEffect } from '../../../types/playFinish';
import { emptyPlayRecord } from '../../../types/play';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { buildFromBuilder2D } from '../../../sceneBuilder2d/actions';
import { find2dBuild } from '../../../sceneBuilder2d/apply';
import { buildScene2D } from '../../../sceneBuilder2d/build';
import { starterScene, type Scene2D } from '../../../sceneBuilder2d/spec';
import { usePlan } from '../../../lib/plan';

const sample = (kind: string): StackItem => {
  const def = GRADE_KINDS.find(d => d.kind === kind)!;
  // Every setting off its default, one past its slider's end (typing extends the range).
  const params: StackItem['params'] = {};
  for (const p of def.params) {
    if (p.type === 'num') params[p.key] = p.key === 'kelvin' ? 3200 : p.key === 'levels' ? 4 : (p.max ?? 1) + 0.25;
    else params[p.key] = [0.2, 0.3, 0.4];
  }
  return { ...newStackItem(def, 'gr1', params), on: kind !== 'invert' };
};

describe('builder grade ↔ Finish effects', () => {
  for (const def of GRADE_KINDS) {
    it(`${def.label} becomes a custom Finish effect and comes back the same`, () => {
      const it0 = sample(def.kind);
      const e = gradeItemToFinish(it0, { swatches: [[0, 0, 0], [0.5, 0.2, 0.9], [1, 1, 1]] })!;
      expect(e.kind).toBe('custom');
      expect(e.defId).toBe(`${BUILDER_FX_PREFIX}${def.kind}`);
      expect(e.name).toBe(def.label);
      expect(e.enabled).toBe(it0.on);
      expect(fnParseCustom(e.code ?? "").error).toBe('');
      // Through a saved file and back: nothing clamped, nothing lost.
      const reread = parseFinish(JSON.parse(JSON.stringify({ on: true, effects: [e] })))!.effects[0];
      const back = finishToGradeItem(reread, 'gr1')!;
      expect(back.kind).toBe(def.kind);
      expect(back.on).toBe(it0.on);
      for (const p of def.params) {
        if (def.kind === 'gradient-map' || p.type === 'colour') continue;
        expect(back.params[p.key]).toEqual(it0.params[p.key]);
      }
      if (def.kind === 'duotone') expect(back.params.dark).toEqual([0.2, 0.3, 0.4]);
    });
  }

  it('the gradient map keeps the scene palette it was read from', () => {
    const e = gradeItemToFinish(newStackItem(GRADE_KINDS.find(d => d.kind === 'gradient-map')!, 'gr1'), { swatches: [[0.1, 0.2, 0.3], [0.9, 0.8, 0.7]] })!;
    expect(e['stop1.r']).toBeCloseTo(0.1);
    expect(e['stop2.b']).toBeCloseTo(0.7);
    expect(e.code).toContain('mix(stop1, stop2');
  });

  it('vignette and grain map both ways', () => {
    for (const kind of ['vignette', 'grain'] as const) {
      const e = postToFinish(kind, 0.3, false);
      expect(fnParseCustom(e.code ?? "").error).toBe('');
      expect(e.enabled).toBe(false);
      expect(finishToPost(parseFinish({ on: true, effects: [e] })!.effects[0])).toEqual({ kind, value: 0.3 });
    }
    expect(finishToPost({ id: 'x', kind: 'grain', enabled: true } as FinishEffect)).toBeNull();
  });

  it('moves a Look: values changed on the nodes win, controls follow (hue in degrees)', () => {
    const hue = newStackItem(GRADE_KINDS.find(d => d.kind === 'hue')!, 'gr1', { angle: 30 });
    const sat = newStackItem(GRADE_KINDS.find(d => d.kind === 'saturation')!, 'gr2', { amount: 1.3 });
    const look = { grade: [hue, sat], post: { vignette: 0.4, grain: 0, bloom: 0, scanlines: 0 }, mute: { vignette: true } };
    expect(hasMovableLook(look)).toBe(true);
    const node = (id: string, params: Record<string, unknown>) => ({ id, type: 'x', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params });
    const byRole = new Map([['grade:gr1', node('n1', { angle: Math.PI / 2 })], ['grade:gr2', node('n2', { amount: 1.3 })], ['vignette', node('n3', { strength: 0.4 })]]);
    const move = lookToFinish(look, { byRole });
    expect(move.names).toEqual(['Hue shift', 'Saturation', 'Vignette']);
    expect(move.effects[0].angle).toBeCloseTo(90);
    expect(move.effects[2].enabled).toBe(false);
    const play = { ...emptyPlayRecord(), controls: [
      { id: 'c1', target: 'n1::angle', kind: 'float' as const, label: 'Hue', min: -Math.PI, max: Math.PI },
      { id: 'c2', target: 'n2::amount', kind: 'float' as const, label: 'Sat', min: 0, max: 3 },
      { id: 'c3', target: 'other::x', kind: 'float' as const, label: 'Other', min: 0, max: 1 },
    ] };
    const out = addMovedToPlay(play, move);
    expect(out.finish!.effects).toHaveLength(3);
    expect(out.controls[0].target).toBe(`finish:${move.effects[0].id}::angle`);
    expect(out.controls[0].max).toBeCloseTo(180);
    expect(out.controls[1].target).toBe(`finish:${move.effects[1].id}::amount`);
    expect(out.controls[2].target).toBe('other::x');
    const left = withoutMovedLook(look);
    expect(left.grade).toBeUndefined();
    expect(left.post.vignette).toBe(0);
    expect(left.mute?.vignette).toBeUndefined();
    expect(hasMovableLook(left)).toBe(false);
  });
});

describe('Build moves the Look into the one Finish', () => {
  const gradedScene = (): Scene2D => {
    const s = starterScene();
    s.look.grade = [newStackItem(GRADE_KINDS.find(d => d.kind === 'saturation')!, 'gr1', { amount: 1.4 })];
    s.look.post.grain = 0.1;
    return s;
  };
  beforeEach(() => {
    useNodeGraphStore.setState({ nodes: [], play: emptyPlayRecord() });
  });
  afterEach(() => { usePlan.setState({ session: { status: 'signed-in', user: '', plan: 'pro', source: 'open' } }); useSceneBuilder2D.getState().close(); });

  it('old data builds unchanged: a scene with a grade still builds its grade nodes', () => {
    const roles = buildScene2D(gradedScene(), r => r).nodes.map(n => String(n.params._sbRole));
    expect(roles).toContain('grade:gr1');
    expect(roles).toContain('grain');
  });

  it('on Pro, Build puts the grade and grain in play.finish and builds no grade nodes; a rebuild adds nothing', () => {
    useSceneBuilder2D.getState().openWith(gradedScene());
    expect(buildFromBuilder2D()).toBe(true);
    const st = useNodeGraphStore.getState();
    const fx = st.play.finish!.effects;
    expect(fx.map(e => e.defId)).toEqual([`${BUILDER_FX_PREFIX}saturation`, `${BUILDER_FX_PREFIX}grain`]);
    expect(fx[0].amount).toBe(1.4);
    const id = useSceneBuilder2D.getState().targetSceneId!;
    const build = find2dBuild(st.nodes, id)!;
    expect([...build.byRole.keys()].some(r => r.startsWith('grade:') || r === 'grain')).toBe(false);
    expect(useSceneBuilder2D.getState().scene.look.grade).toBeUndefined();
    expect(build.meta.spec.look.post.grain).toBe(0);
    useSceneBuilder2D.getState().edit(d => { d.look.glow.amount = 0.004; });
    buildFromBuilder2D();
    expect(useNodeGraphStore.getState().play.finish!.effects).toHaveLength(2);
  });

  it('on Free, the grade stays nodes in the graph and the Finish is untouched', () => {
    usePlan.setState({ session: { status: 'signed-in', user: '', plan: 'free', source: 'open' } });
    useSceneBuilder2D.getState().openWith(gradedScene());
    buildFromBuilder2D();
    const st = useNodeGraphStore.getState();
    expect(st.play.finish).toBeUndefined();
    const build = find2dBuild(st.nodes, useSceneBuilder2D.getState().targetSceneId!)!;
    expect(build.byRole.has('grade:gr1')).toBe(true);
  });
});
