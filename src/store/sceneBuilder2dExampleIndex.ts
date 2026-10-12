/**
 * sceneBuilder2dExampleIndex.ts — names and descriptions for the "2D: Scene Builder" folder, kept apart
 * from the graphs (sceneBuilder2dExamples.ts) so the examples browser can list them without building them.
 */
import { GRID_TEMPLATES_2D, TEMPLATES_2D } from '../sceneBuilder2d/templates';

export const SCENE_BUILDER_2D_EXAMPLE_ROWS: Array<{ key: string; template: string; label: string; picture?: boolean }> = [
  { key: 'sb2Kaleidoscope', template: 'kaleidoscope', label: '2D: Scene Builder · Kaleidoscope of glowing rings' },
  { key: 'sb2Orbits', template: 'orbits', label: '2D: Scene Builder · Orbiting shapes' },
  { key: 'sb2RingOfRings', template: 'ringOfRings', label: '2D: Scene Builder · A ring of rings' },
  { key: 'sb2RippleGrid', template: 'rippleGrid', label: '2D: Scene Builder · Morphing ripple grid' },
  { key: 'sb2MouseGrid', template: 'mouseGrid', label: '2D: Scene Builder · Ripples that follow the mouse' },
  // A picture with depth (docs/depth-mix.md): the "ridges at dusk" still, its depth worked out on this device.
  { key: 'sb2DepthSize', template: 'depthSize', label: '2D: Scene Builder · Circles sized by depth', picture: true },
  { key: 'sb2DepthBeams', template: 'depthBeams', label: '2D: Scene Builder · Glow beaming through depth', picture: true },
];

export const SCENE_BUILDER_2D_EXAMPLE_KEYS = SCENE_BUILDER_2D_EXAMPLE_ROWS.map(r => r.key);

const blurb = (template: string) => [...TEMPLATES_2D, ...GRID_TEMPLATES_2D].find(t => t.key === template)?.blurb ?? '';
const recipeOf = (template: string) => TEMPLATES_2D.find(t => t.key === template)?.recipe ?? '';

export const SCENE_BUILDER_2D_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = Object.fromEntries(
  SCENE_BUILDER_2D_EXAMPLE_ROWS.map(r => [r.key, { label: r.label, description: `${blurb(r.template)} Made in the 2D Scene Builder.${r.picture ? ' The picture is the "ridges at dusk" still; its depth needs the Depth model (a one-time 50 MB download on the Depth card, kept by the browser).' : ''} Recipe: ${recipeOf(r.template)}` }]),
);
