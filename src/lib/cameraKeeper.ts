/**
 * cameraKeeper.ts — turns the webcam off when nothing needs it any more.
 *
 * The camera is shared (lib/cameraInput.ts): Camera layers show it, particles,
 * glyphs and contours can read it instead of the picture, and hand tracking
 * watches it. Each of those can turn it on, but none of them owned turning it
 * off, so deleting the last Camera layer left the camera light on. This watches
 * the Play setup and hand tracking, and stops the camera as soon as none of
 * them uses it: the last camera layer is deleted, a layer stops reading the
 * camera, a graph without one is opened, or hand tracking is stopped.
 */
import type { PlayRecord } from '../types/play';
import { cameraInput } from './cameraInput';
import { handFeed } from './handFeed';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

/** Does this Play setup show or read the camera? */
export function playUsesCamera(play: Pick<PlayRecord, 'layers'>): boolean {
  return play.layers.some(l => {
    if (l.kind === 'camera') return true;
    const readFrom = (l as { readFrom?: string }).readFrom;
    return readFrom === 'camera';
  });
}

function handsHoldCamera(): boolean {
  const s = handFeed.getStatus();
  // A dev/test source (a video instead of the webcam) doesn't hold the camera.
  return (s === 'on' || s === 'starting') && handFeed.currentSource() === cameraInput.element();
}

let installed = false;

/** Start watching (once, at app start). */
export function installCameraKeeper(): void {
  if (installed) return;
  installed = true;
  const check = () => {
    if (cameraInput.getStatus() !== 'on') return;
    if (playUsesCamera(useNodeGraphStore.getState().play) || handsHoldCamera()) return;
    cameraInput.stop();
  };
  let lastPlay = useNodeGraphStore.getState().play;
  useNodeGraphStore.subscribe(s => { if (s.play !== lastPlay) { lastPlay = s.play; check(); } });
  handFeed.onStatus(() => check());
}
