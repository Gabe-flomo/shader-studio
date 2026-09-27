/**
 * dropMakers.ts — how dropped files become what layers keep, in the app
 * (dropLayers.ts takes these as a parameter, so its tests need neither).
 */
import { imageFileToSrc } from './layers/imageFiles';
import { playVideoLayers } from '../../play/videoLayers';
import type { DropMakers } from './dropLayers';

export const appDropMakers: DropMakers = {
  imageSrc: file => imageFileToSrc(file),
  video: file => playVideoLayers.pick(file),
};
