/**
 * webcamHost.ts — the app's one WebcamTextures (lib/texture/webcam.ts): the shared camera,
 * bound into webcam Texture nodes through the store's video textures. ShaderCanvas keeps it
 * in step with the graph and the camera's status.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { cameraInput } from '../cameraInput';
import { WebcamTextures } from './webcam';

export const webcamTextures = new WebcamTextures({
  element: () => cameraInput.element(),
  setTexture: (id, tex) => useNodeGraphStore.getState().setVideoTexture(id, tex),
});
