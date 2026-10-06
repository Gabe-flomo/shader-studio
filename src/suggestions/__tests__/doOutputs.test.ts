/**
 * The Do… bar's output phrases and type fixes (suggestions/doOutputs.ts): "output the depth",
 * "show the normals", "colour it by distance with a palette" on a builder scene and a hand-made
 * loop; a colour fed to a number move is refused with its fix, and the fix runs.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { parseDo, runDoPlan } from '../doBar';
import { readOutputPhrase } from '../doOutputs';
import { applyScene } from '../../sceneBuilder/apply';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { META_KEY, type SceneBuilderMeta } from '../../sceneBuilder/build';
import { describeGraph } from '../../sceneBuilder/recognize';

let counter = 0;
const nextId = () => `t${++counter}`;
const builderScene = (recipe = 'sphere · box at=(1,0,0)') => applyScene([], parseRecipe(recipe).spec, { nextId }).nodes;
const shown = (nodes: GraphNode[]) => {
  const out = nodes.find(x => x.type === 'output')!;
  return nodes.find(x => x.id === out.inputs.color.connection?.nodeId);
};

describe('Do… bar: outputs', () => {
  it('reads the phrases', () => {
    expect(readOutputPhrase('output the depth')).toEqual({ show: 'depth' });
    expect(readOutputPhrase('show the normals')).toEqual({ show: 'normal' });
    expect(readOutputPhrase('colour it by distance with a palette')).toEqual({ show: 'distance', palette: 'sunset' });
    expect(readOutputPhrase('color by height palette fire')).toEqual({ show: 'height', palette: 'fire' });
    expect(readOutputPhrase('show the picture')).toEqual({ show: 'picture' });
    expect(readOutputPhrase('circle with a glow')).toBeNull();
    expect(readOutputPhrase('show me a circle')).toBeNull();
  });

  it('rebuilds a Scene Builder scene with the output, so its spec and Describe agree', () => {
    for (const [phrase, show] of [['output the depth', 'depth'], ['show the normals', 'normal'], ['colour it by distance with a palette', 'distance']] as const) {
      const nodes = builderScene();
      const plan = parseDo(phrase, { nodes, selected: [] });
      expect(plan.problem, phrase).toBeUndefined();
      expect(plan.steps.map(s => s.kind)).toEqual(['scene-output']);
      const r = runDoPlan(nodes, plan, nextId);
      expect(compileGraph({ nodes: r.nodes }).success, phrase).toBe(true);
      const scene = r.nodes.find(x => x.type === 'sceneGroup' && x.params[META_KEY])!;
      expect((scene.params[META_KEY] as SceneBuilderMeta).spec.output?.show).toBe(show);
      expect(describeGraph(r.nodes)!.spec.output?.show).toBe(show);
      // And back.
      const back = runDoPlan(r.nodes, parseDo('show the picture', { nodes: r.nodes, selected: [] }), nextId);
      expect((back.nodes.find(x => x.id === scene.id)!.params[META_KEY] as SceneBuilderMeta).spec.output).toBeUndefined();
    }
  });

  it('adds the same nodes to a hand-made march loop', () => {
    const scene = builderScene('sphere');
    // Strip the builder's spec: now it reads as hand-made.
    const nodes = scene.map(x => (x.params[META_KEY] ? { ...x, params: { ...x.params, [META_KEY]: undefined } } : x));
    const plan = parseDo('colour it by depth with a palette', { nodes, selected: [] });
    expect(plan.steps[0]).toMatchObject({ kind: 'scene-output', sceneId: null });
    const r = runDoPlan(nodes, plan, nextId);
    expect(shown(r.nodes)?.type).toBe('palette');
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });

  it('says what to do without a 3D scene', () => {
    const plan = parseDo('output the depth', { nodes: [n('output', 'o', 0, 0)], selected: [] });
    expect(plan.problem).toMatch(/3D Scene Builder/);
  });
});

describe('Do… bar: type checks', () => {
  const nodes = [n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 1260, 0, {}, { color: ['p', 'color'] })];

  it('refuses a colour (vec3) into a number move, with Luminance and .x as fixes', () => {
    const plan = parseDo('remap it', { nodes, selected: ['p'] });
    expect(plan.steps).toEqual([]);
    expect(plan.problem).toMatch(/three numbers \(vec3\).*number \(float\).*Luminance/);
    expect(plan.fixes?.map(f => f.label)).toEqual(['Use its brightness (Luminance), then Remap', 'Take .x (its first number), then Remap']);
  });

  it('the fix runs: Luminance, then the move on it, and it compiles', () => {
    const plan = parseDo('remap it', { nodes, selected: ['p'] });
    const r = runDoPlan(nodes, plan.fixes![0].plan, nextId);
    const lum = r.nodes.find(x => x.type === 'luminance')!;
    expect(lum.inputs.color.connection).toEqual({ nodeId: 'p', outputKey: 'color' });
    expect(r.nodes.some(x => Object.values(x.inputs).some(i => i.connection?.nodeId === lum.id))).toBe(true);
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });
});
