/**
 * PhoneOverlays — what the desktop graph (NodeGraph) mounts beside the canvas, mounted on a phone,
 * where the graph is the list browser instead: the Do… bar (its entry points are the browser's Do…
 * buttons, since a phone has no ⌘K) with its Commands reference, and the builders: the 3D Scene Builder (opened by adding a Scene Builder
 * node, or from the node browser's Builders), the 2D Scene Builder, the Grid Rules and Agent Rules editors; full screen there, in
 * the phone builder layout (builders/studio/PhoneStudio.tsx).
 */
import { lazyWithSuspense } from '../lazyWithSuspense';
import { useSceneBuilder2D } from '../../sceneBuilder2d/store';
import { DoBar } from '../NodeGraph/DoBar';
import { CommandsReference } from '../NodeGraph/DoCommandsReference';
import { ShowHowWindow } from '../NodeGraph/ShowHowWindow';
import { SceneBuilderHost } from '../sceneBuilder/SceneBuilderModal';
import { BuilderWindowsHost } from '../builders/BuilderWindowsHost';

// The 2D Scene Builder (the desktop mounts it in NodeGraph) loads only when it opens.
const SceneBuilder2DModal = lazyWithSuspense<Record<string, never>>(() => import('../sceneBuilder2d/SceneBuilder2DModal').then(m => ({ default: m.SceneBuilder2DModal })));
function SceneBuilder2DPhoneHost() {
  const open = useSceneBuilder2D(s => s.open);
  return open ? <SceneBuilder2DModal /> : null;
}

export function PhoneOverlays() {
  return (
    <>
      <DoBar />
      <CommandsReference />
      <ShowHowWindow />
      <SceneBuilderHost />
      <BuilderWindowsHost />
      <SceneBuilder2DPhoneHost />
    </>
  );
}

export default PhoneOverlays;
