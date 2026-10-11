/**
 * Muting in the Splat builder (builders/mute.ts, docs/splat-builder.md, "Muting"): an effect card's mute is its
 * off switch, so a muted effect is left out of the Modifier chain (the splat chain compiles in its own program,
 * where no live gate fits) and the build is exactly the chain without it; nothing gets a `__mute` param; the recipe
 * prints and reads `muted` (and still reads `off`); a mute is one undo step, Alt-click solos, and it survives Build
 * and reopening.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { MUTE_PARAM } from '../../builders/mute';
import { buildSplatGraph, buildSplatStandalone, splatMetaOf } from '../build';
import { applySplatScene } from '../apply';
import { readSplatRecipe, splatRecipe } from '../recipe';
import { EFFECT_TYPE, effectSummary, newEffect, soloEffect, starterSplatScene, toggleEffectMute, type SplatBuilderSpec } from '../spec';
import { useSplatBuilder } from '../store';
import { closeSplatBuilder, editSplatSceneInBuilder } from '../actions';

function stack(mutedColour: boolean): SplatBuilderSpec {
  const s = starterSplatScene();
  s.effects = [newEffect('wave', 'e1'), { ...newEffect('color', 'e2'), on: !mutedColour }, newEffect('crop', 'e3')];
  return s;
}

const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
let n = 0;
const nextId = () => `m${++n}`;

describe('muting in the Splat builder', () => {
  it('a muted effect is bypassed: the build is the chain without it, and it still compiles', () => {
    const muted = stack(true);
    const without = stack(false);
    without.effects.splice(1, 1);
    expect(buildSplatGraph(muted).nodes).toEqual(buildSplatGraph(without).nodes);
    // Wave feeds Crop directly; no Colour grade node.
    const nodes = buildSplatGraph(muted).nodes;
    expect(nodes.some(x => x.type === EFFECT_TYPE.color)).toBe(false);
    const crop = nodes.find(x => x.type === EFFECT_TYPE.crop)!;
    const wave = nodes.find(x => x.type === EFFECT_TYPE.wave)!;
    expect(crop.inputs.splat.connection?.nodeId).toBe(wave.id);
    for (const s of [muted, stack(false)]) {
      const r = compileGraph({ nodes: buildSplatStandalone(s).nodes });
      expect(r.errors ?? []).toEqual([]);
      expect(r.success).toBe(true);
    }
    // Every card muted: no modifier at all.
    const all = stack(true);
    all.effects.forEach(e => { e.on = false; });
    expect(compileGraph({ nodes: buildSplatStandalone(all).nodes }).splats?.[0].modifier).toBeFalsy();
  });

  it('no node ever carries a gate (the fallback: left out, never a __mute param)', () => {
    for (const s of [stack(false), stack(true)]) expect(buildSplatGraph(s).nodes.some(x => MUTE_PARAM in x.params)).toBe(false);
  });

  it('toggle and solo: Alt-click mutes the others, again brings them all back', () => {
    const s = stack(false);
    toggleEffectMute(s.effects, 'e1');
    expect(s.effects.map(e => e.on)).toEqual([false, true, true]);
    expect(effectSummary(s.effects[0])).toMatch(/· muted$/);
    toggleEffectMute(s.effects, 'e1');
    soloEffect(s.effects, 'e2');
    expect(s.effects.map(e => e.on)).toEqual([false, true, false]);
    soloEffect(s.effects, 'e2');
    expect(s.effects.map(e => e.on)).toEqual([true, true, true]);
  });

  it('the recipe prints `muted`, reads it back exactly, and still reads the older `off`', () => {
    const plain = stack(false);
    expect(splatRecipe(plain)).not.toMatch(/\bmuted\b/);
    const muted = stack(true);
    const text = splatRecipe(muted);
    expect(text).toMatch(/^color muted /m);
    const back = readSplatRecipe(text, muted);
    expect(back.errors).toEqual([]);
    expect(back.spec).toEqual(muted);
    expect(splatRecipe(back.spec)).toBe(text);
    const old = readSplatRecipe(text.replace(/^color muted /m, 'color off '), muted);
    expect(old.errors).toEqual([]);
    expect(old.spec).toEqual(muted);
  });

  describe('in the builder', () => {
    beforeEach(() => {
      undoManager.clear('test');
      useNodeGraphStore.setState({ nodes: [output()], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
      useSplatBuilder.setState({ open: false, targetId: null });
    });

    it('a mute is one undo step', () => {
      useSplatBuilder.getState().openWith(stack(false));
      const was = structuredClone(useSplatBuilder.getState().spec);
      useSplatBuilder.getState().edit(d => toggleEffectMute(d.effects, 'e2'));
      expect(useSplatBuilder.getState().spec.effects[1].on).toBe(false);
      useSplatBuilder.getState().undo();
      expect(useSplatBuilder.getState().spec).toEqual(was);
      useSplatBuilder.setState({ open: false });
    });

    it('survives Build and reopening (the spec on the Splat Scene keeps it)', () => {
      const spec = stack(true);
      const r = applySplatScene(useNodeGraphStore.getState().nodes, spec, { nextId });
      useNodeGraphStore.setState({ nodes: r.nodes });
      expect(splatMetaOf(r.nodes.find(x => x.id === r.scanId))!.spec.effects[1].on).toBe(false);
      expect(editSplatSceneInBuilder(r.scanId)).toBe(true);
      expect(useSplatBuilder.getState().spec).toEqual(spec);
      closeSplatBuilder();
    });
  });
});
