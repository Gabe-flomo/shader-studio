/**
 * Starter recipes (docs/starter-recipes.md): when one of these nodes is added, a small offer
 * next to it suggests a few one-click setups round it (RecipeOffer.tsx). Keyed by node type.
 *
 * Not here on purpose: the Agents group (it asks with its own dialog: store addNode) and 3D
 * shapes / scenes (wrapped in a Scene Group automatically: nodes/smart3d.ts).
 */
import type { StarterRecipe } from './types';
import { GRID_PATTERN_RECIPES, GRID_RECIPES } from './gridRecipes';
import { NOISE_RECIPES, PALETTE_RECIPES, VORONOI_RECIPES } from './noiseRecipes';
import { KALEIDO_RECIPES, POLAR_RECIPES, REPEAT_RECIPES, SDF_COMBINE_RECIPES, SDF_SHAPE_RECIPES, TILE_RECIPES } from './shapeRecipes';
import { AUDIO_RECIPES, FEEDBACK_RECIPES, LFO_RECIPES, PARTICLE_RECIPES, PASS_RECIPES, PICTURE_EFFECT_RECIPES } from './effectRecipes';
import { CHANGE_RECIPES, FADE_RECIPES, JUMP_FLOOD_RECIPES } from './textureRecipes';
import { LIGHT_RECIPES } from './lightRecipes';
import { PICTURE_DEPTH_RECIPES, PICTURE_DEPTH_SET } from './depthRecipes';

export { PICTURE_DEPTH_SET, FACE_CAMERA_OPTION, pictureSource } from './depthRecipes';

export { LIGHT_SCENE_TYPES } from './lightRecipes';

export type { StarterRecipe, RecipeBuild, RecipeContext } from './types';
export { applyRecipe, placeNear } from './apply';

const each = (types: string[], recipes: StarterRecipe[]) => Object.fromEntries(types.map(t => [t, recipes]));

export const STARTER_RECIPES: Readonly<Record<string, StarterRecipe[]>> = {
  gridLayout: GRID_RECIPES,
  gridPattern: GRID_PATTERN_RECIPES,
  ...each(['fbm', 'noiseFloat', 'waveTexture'], NOISE_RECIPES),
  voronoi: VORONOI_RECIPES,
  palette: PALETTE_RECIPES,
  ...each(['circleSDF', 'boxSDF', 'ringSDF', 'shapeSDF', 'simpleSDF'], SDF_SHAPE_RECIPES),
  sdfUnion: SDF_COMBINE_RECIPES.union,
  sdfSubtract: SDF_COMBINE_RECIPES.subtract,
  sdfIntersect: SDF_COMBINE_RECIPES.intersect,
  fract: TILE_RECIPES,
  ...each(['infiniteRepeatSpace', 'mirroredRepeat2D', 'limitedRepeat2D'], REPEAT_RECIPES),
  kaleidoSpace: KALEIDO_RECIPES,
  polarSpace: POLAR_RECIPES,
  prevFrame: FEEDBACK_RECIPES,
  pass: PASS_RECIPES,
  // Texture tools (docs/texture-tools.md): the Pass and flood setups they need.
  jumpFloodTexture: JUMP_FLOOD_RECIPES,
  textureChange: CHANGE_RECIPES,
  textureFade: FADE_RECIPES,
  gpuParticles: PARTICLE_RECIPES,
  audioInput: AUDIO_RECIPES,
  lfo: LFO_RECIPES,
  // Light the scene (docs/light-scene.md): 3D and 4D scenes both march through a March Loop Group.
  marchLoopGroup: LIGHT_RECIPES,
  // "Add a picture with depth" (docs/depth-node.md): opened from a March Loop / GI Lit card, never on add.
  [PICTURE_DEPTH_SET]: PICTURE_DEPTH_RECIPES,
  ...each(['bloom', 'vignette', 'grain', 'toneMap', 'chromaShift', 'colorSaturation', 'hueRotate', 'posterize', 'scanlines', 'brightnessContrast', 'toneCurve', 'invert', 'cmykHalftone'], PICTURE_EFFECT_RECIPES),
};

/** The recipes offered when a node of `type` is added (none: no offer). */
export function recipesFor(type: string): StarterRecipe[] {
  return STARTER_RECIPES[type] ?? [];
}
