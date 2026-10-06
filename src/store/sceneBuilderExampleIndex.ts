/**
 * sceneBuilderExampleIndex.ts — names and descriptions for the "3D: Scene
 * Builder" folder, kept apart from the graphs (sceneBuilderExamples.ts) so the
 * examples browser can list them without building them.
 */
import { SCENE_TEMPLATES, templateSpec } from '../sceneBuilder/templates';
import { printRecipe } from '../sceneBuilder/recipe';

export const SCENE_BUILDER_EXAMPLE_ROWS: Array<{ key: string; template: string; label: string }> = [
  { key: 'sbGlowingOrb', template: 'orb', label: '3D: Scene Builder · Glowing orb' },
  { key: 'sbBlobSculpture', template: 'blobs', label: '3D: Scene Builder · Smooth-blob sculpture' },
  { key: 'sbInfinitePillars', template: 'pillars', label: '3D: Scene Builder · Infinite pillars' },
  { key: 'sbTwistedTorus', template: 'twisted', label: '3D: Scene Builder · Twisted torus' },
  { key: 'sbGlassObjects', template: 'glass', label: '3D: Scene Builder · Glass objects' },
  { key: 'sbMengerFold', template: 'menger', label: '3D: Scene Builder · Menger-like fold' },
];

export const SCENE_BUILDER_EXAMPLE_KEYS = SCENE_BUILDER_EXAMPLE_ROWS.map(r => r.key);

const blurb = (template: string) => SCENE_TEMPLATES.find(t => t.key === template)?.blurb ?? '';

export const SCENE_BUILDER_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = Object.fromEntries(
  SCENE_BUILDER_EXAMPLE_ROWS.map(r => [r.key, { label: r.label, description: `${blurb(r.template)} Made in the 3D Scene Builder. Recipe: ${printRecipe(templateSpec(r.template))}` }]),
);
