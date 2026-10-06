/**
 * PhoneOverlays — what the desktop graph (NodeGraph) mounts beside the canvas, mounted on a phone,
 * where the graph is the list browser instead: the Do… bar (its entry points are the browser's Do…
 * buttons, since a phone has no ⌘K) with its Commands reference, and the builders: the 3D Scene Builder (opened by adding a Scene Builder
 * node, or from the node browser's Builders), the Grid Rules and Agent Rules editors; full screen there, their panels as tabs.
 */
import { DoBar } from '../NodeGraph/DoBar';
import { CommandsReference } from '../NodeGraph/DoCommandsReference';
import { SceneBuilderHost } from '../sceneBuilder/SceneBuilderModal';
import { BuilderWindowsHost } from '../builders/BuilderWindowsHost';

export function PhoneOverlays() {
  return (
    <>
      <DoBar />
      <CommandsReference />
      <SceneBuilderHost />
      <BuilderWindowsHost />
    </>
  );
}

export default PhoneOverlays;
