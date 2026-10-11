/**
 * sceneBuilder2dExamples.ts — the "2D: Scene Builder" folder: graphs made by the 2D Scene Builder
 * from its templates (docs/scene-builder-2d-plan.md), exactly as Build makes them, with the recipe
 * on the UV node's note. Right-click a node → Edit in 2D Scene Builder opens it in the form again.
 * Names and descriptions live apart (no build needed to list them).
 */
import type { ExampleGraph } from './exampleIndex';
import { applyScene2D } from '../sceneBuilder2d/apply';
import { templateScene } from '../sceneBuilder2d/templates';
import { SCENE_BUILDER_2D_EXAMPLE_INDEX, SCENE_BUILDER_2D_EXAMPLE_ROWS } from './sceneBuilder2dExampleIndex';

export { SCENE_BUILDER_2D_EXAMPLE_KEYS } from './sceneBuilder2dExampleIndex';
import { printRecipe2D } from '../sceneBuilder2d/recipe';
import { textureNodeFor } from '../builders/textures';
import type { GraphNode } from '../types/nodeGraph';
import RIDGES_AT_DUSK from './playAssets/ridges-at-dusk.jpg?inline';

/** The picture the depth examples use: "ridges at dusk" (960 × 540), on a Texture node the scene reads. */
export const DEPTH_EXAMPLE_ASPECT = 960 / 540;

export function buildSceneBuilder2DExamples(): Record<string, ExampleGraph> {
  const out: Record<string, ExampleGraph> = {};
  for (const r of SCENE_BUILDER_2D_EXAMPLE_ROWS) {
    let i = 0;
    const scene = templateScene(r.template);
    // A picture with depth: its source gets a Texture node of its own, with the picture attached when the example opens.
    let start: GraphNode[] = [];
    let images: Record<string, string> | undefined;
    if (r.picture && scene.textures?.length) {
      const id = `${r.key}_pic`;
      scene.textures = scene.textures.map((s, k) => (k === 0 ? { ...s, node: id, aspect: DEPTH_EXAMPLE_ASPECT, kind: 'image' as const } : s));
      const pic = textureNodeFor(scene.textures[0], id, { x: -600, y: 0 }, 'The picture: "ridges at dusk". Drop your own picture on this card: the scene, its depth and the Depth Mix follow it.');
      pic.params = { ...pic.params, _imageName: 'Ridges at dusk.jpg' };
      start = [pic];
      images = { [id]: RIDGES_AT_DUSK };
    }
    const res = applyScene2D(start, scene, { nextId: () => `${r.key}_${++i}`, at: { x: 0, y: 0 } });
    const recipe = printRecipe2D(scene, { multiline: true });
    const nodes = res.nodes.map(n => n.id === res.sceneId
      ? { ...n, params: { ...n.params, __comment: `${String(n.params.__comment ?? '')}\n\nThe recipe this scene was built from (paste it into the 2D Scene Builder's Recipe tab, or right-click → Edit in 2D Scene Builder):\n${recipe}` } }
      : n);
    out[r.key] = { label: r.label, description: SCENE_BUILDER_2D_EXAMPLE_INDEX[r.key].description, counter: i + 1, nodes, ...(images ? { images } : {}) };
  }
  return out;
}
