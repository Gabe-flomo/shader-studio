/**
 * Your own 3D Scene Builder presets (docs/scene-builder.md, "Presets"): a scene saved from the builder
 * with a name and a picture of it, loaded only from the builder's preset strip. A preset is a recipe
 * (printRecipe), not a graph: it becomes nodes only when you Build.
 *
 * The 3D builder's list in the shared builder presets (builders/userPresets.ts), which every builder
 * with presets uses; its storage key is the one it has always had.
 */
import { MAX_USER_PRESETS, builderPresets, presetStorageKey, type UserBuilderPreset } from '../builders/userPresets';

export type UserScenePreset = UserBuilderPreset;
export { MAX_USER_PRESETS };
export const USER_PRESETS_KEY = presetStorageKey('3d');
export const useUserScenePresets = builderPresets('3d');
