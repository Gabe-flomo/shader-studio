/**
 * sceneBuilderExamples.ts — the "3D: Scene Builder" folder: graphs made by the
 * 3D Scene Builder from its templates (docs/scene-builder.md), exactly as
 * Build makes them, each with its recipe in its description and on its Scene
 * Group's note. Right-click a node → Edit in Scene Builder opens the recipe in
 * the form again.
 */
import type { ExampleGraph } from './exampleIndex';
import { applyScene } from '../sceneBuilder/apply';
import { templateSpec } from '../sceneBuilder/templates';
import { printRecipe } from '../sceneBuilder/recipe';
import { SCENE_BUILDER_EXAMPLE_INDEX, SCENE_BUILDER_EXAMPLE_ROWS } from './sceneBuilderExampleIndex';

export { SCENE_BUILDER_EXAMPLE_KEYS } from './sceneBuilderExampleIndex';

export function buildSceneBuilderExamples(): Record<string, ExampleGraph> {
  const out: Record<string, ExampleGraph> = {};
  for (const r of SCENE_BUILDER_EXAMPLE_ROWS) {
    let i = 0;
    const spec = templateSpec(r.template);
    const res = applyScene([], spec, { nextId: () => `${r.key}_${++i}`, at: { x: 0, y: 0 } });
    const recipe = printRecipe(spec, { multiline: true });
    const nodes = res.nodes.map(n => n.id === res.sceneId
      ? { ...n, params: { ...n.params, __comment: `${String(n.params.__comment ?? '')}\n\nThe recipe this scene was built from (paste it into the builder's Recipe tab, or right-click → Edit in Scene Builder):\n${recipe}` } }
      : n);
    out[r.key] = { label: r.label, description: SCENE_BUILDER_EXAMPLE_INDEX[r.key].description, counter: i + 1, nodes };
  }
  return out;
}
