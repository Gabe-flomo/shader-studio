/**
 * PhoneOverlays — what the desktop graph (NodeGraph) mounts beside the canvas, mounted on a phone,
 * where the graph is the list browser instead: the Do… bar (its entry points are the browser's Do…
 * buttons, since a phone has no ⌘K) and the 3D Scene Builder (opened by adding a Scene Builder
 * node; full screen there, its panels as tabs).
 */
import { DoBar } from '../NodeGraph/DoBar';
import { SceneBuilderHost } from '../sceneBuilder/SceneBuilderModal';

export function PhoneOverlays() {
  return (
    <>
      <DoBar />
      <SceneBuilderHost />
    </>
  );
}

export default PhoneOverlays;
