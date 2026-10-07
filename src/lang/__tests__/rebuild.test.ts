/**
 * §13 decision 4: editing a builder-made node edits the node and marks the scene edited since
 * build; "Rebuild from recipe" (applyScene restore) puts the recipe back, dropping the hand edits.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { applyScene } from '../../sceneBuilder/apply';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { sceneEditedSinceBuild } from '../../builders/recipe';
import { META_KEY } from '../../sceneBuilder/build';

describe('rebuild from recipe', () => {
  it('a hand edit marks the scene edited; rebuilding with restore clears it, keeping the scene\'s place', () => {
    let k = 0;
    const nextId = () => `n${++k}`;
    const built = applyScene([], parseRecipe('sphere r=0.5 · box at=(1,0,0)').spec, { nextId });
    const sphere = built.nodes.flatMap(n => [n, ...(((n.params.subgraph as { nodes?: typeof built.nodes })?.nodes) ?? [])]).find(n => n.type === 'sphereSDF3D')!;
    const edit = (nodes: typeof built.nodes): typeof built.nodes => nodes.map(n => {
      if (n.id === sphere.id) return { ...n, params: { ...n.params, radius: 0.9 } };
      const sub = n.params.subgraph as { nodes?: typeof built.nodes } | undefined;
      return sub?.nodes ? { ...n, params: { ...n.params, subgraph: { ...sub, nodes: edit(sub.nodes) } } } : n;
    });
    const edited = edit(built.nodes);
    expect(sceneEditedSinceBuild(edited, built.sceneId)).toBe(true);
    // An ordinary rebuild keeps the hand edit; a restore drops it.
    const kept = applyScene(edited, (edited.find(n => n.id === built.sceneId)!.params[META_KEY] as { spec: never }).spec, { nextId, sceneId: built.sceneId });
    expect(kept.kept.length).toBeGreaterThan(0);
    const restored = applyScene(edited, (edited.find(n => n.id === built.sceneId)!.params[META_KEY] as { spec: never }).spec, { nextId, sceneId: built.sceneId, restore: true });
    expect(restored.kept).toEqual([]);
    expect(sceneEditedSinceBuild(restored.nodes, restored.sceneId)).toBe(false);
  });
});
