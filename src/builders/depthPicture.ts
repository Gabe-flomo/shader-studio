/**
 * depthPicture.ts — Generate depth in the scene builders (docs/depth-mix.md, docs/scene-builder.md "Textures"): the
 * depth of a picture the scene reads, worked out once on this device, as the Texture card's Generate depth and the
 * Depth card's Bake depth do. The result is a grey image in the library (a DepthBakeInfo) that the builder keeps in its
 * spec; Build puts it on the Depth node (Update: Baked), so the depth is there at once, smooth, and goes into
 * exported pages.
 *
 * The model is an opt-in download (Depth Anything V2 Small, 50 MB, kept by the browser): `depthModelReady` says
 * whether it may run, and the builders offer the download first when it can't.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import type { DepthBakeInfo } from '../nodes/definitions/depth';
import { DEFAULT_DEPTH_MODEL_ID, depthModelById } from '../depthModel/config';
import { effectiveDepthModel } from '../depthModel/experimental';
import { depthModelUsable, depthOfferBytes, downloadDepthModel } from '../depthModel/client';
import { bakeImageDepth, type DepthBakeProgress } from '../lib/depth/bake';

/** The side the builders run the model at: finer than a live Depth node's default, still quick for one still. */
export const GENERATE_SIDE = 518;

/** The model Generate depth runs: the default (or the experimental pick, when that setting is on). */
export const generateModel = (): string => effectiveDepthModel(DEFAULT_DEPTH_MODEL_ID).id;

export const depthModelReady = (): boolean => depthModelUsable(generateModel());

/** "Depth Anything V2 Small, 50 MB": for the download offer. */
export function depthModelOffer(): { name: string; mb: number } {
  const id = generateModel();
  return { name: depthModelById(id).name, mb: Math.round(depthOfferBytes(id) / 1e6) };
}

/** The one-time download (asked for by a click). */
export const downloadGenerateModel = (): Promise<boolean> => downloadDepthModel(generateModel());

/**
 * The depth of the picture on node `pictureNode` (a Texture node of the graph), baked into the library. Throws with a
 * reason a person can act on (no picture yet, the model isn't downloaded, the model failed).
 */
export async function generatePictureDepth(pictureNode: string | undefined, source: string, onProgress?: (p: DepthBakeProgress) => void): Promise<DepthBakeInfo> {
  if (!pictureNode) throw new Error('Pick a picture first.');
  const img = useNodeGraphStore.getState().nodeTextures[pictureNode]?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) throw new Error('The picture hasn’t loaded yet: drop one on its Texture node, or pick one.');
  return bakeImageDepth(img, generateModel(), GENERATE_SIDE, source, onProgress);
}
