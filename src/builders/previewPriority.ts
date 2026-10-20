/**
 * previewPriority.ts — while a builder window with a preview of its own is open, the main preview
 * behind it is held (lib/previewHold.ts): it stops drawing, keeps its last frame, and its clock
 * waits, so the builder's preview has the GPU to itself (docs/scene-builder.md, "The preview comes
 * first"). An output window or a recording keeps full speed, as with every hold.
 *
 * Held for: the Scene builder's own pages, the 2D and 3D Scene Builders and the Grid builder (their own WebGL previews)
 * and the Grid Rules editor (its CPU preview). Not for the Agent Builder or the Splat builder: their picture IS
 * the main preview, mirrored (components/builders/studio/LiveViewport.tsx). For those everything else waits instead
 * (builderFocus.ts): the graph behind the window, the preview's readbacks and thumbnails.
 */
import { holdPreview } from '../lib/previewHold';
import { useSceneBuilder } from '../sceneBuilder/store';
import { useSceneBuilder2D } from '../sceneBuilder2d/store';
import { useGridBuilder } from '../gridScene/store';
import { useSplatBuilder } from '../splatBuilder/store';
import { useWarpBuilder } from '../warpBuilder/store';
import { useTimeCubeBuilder } from '../timeCubeBuilder/store';
import { useTextureLab } from '../textureLab/store';
import { useBuilderWindows } from './windows';
import { setBuilderFocus } from './builderFocus';

/** Whether an open builder window wants the main preview held now. */
export function builderHoldsPreview(): boolean {
  const w = useBuilderWindows.getState();
  return useSceneBuilder.getState().open || useSceneBuilder2D.getState().open || useGridBuilder.getState().open || useWarpBuilder.getState().open || !!w.gridRules || !!w.sceneShell;
}

/** Whether a builder whose picture is the main preview (the Splat builder, the Agent Builder) is open now. */
export function builderMirrorsPreview(): boolean {
  return useSplatBuilder.getState().open || useTimeCubeBuilder.getState().open || useTextureLab.getState().open || !!useBuilderWindows.getState().agentBuilder;
}

/**
 * Hold the main preview whenever builderHoldsPreview() says so, from now until the returned stop
 * (which lets go of a hold it still has), and give a mirroring builder the focus (builderFocus.ts) while one is open.
 * BuilderWindowsHost runs it while it is mounted.
 */
export function watchBuilderPreview(): () => void {
  let release: (() => void) | null = null;
  const sync = () => {
    const want = builderHoldsPreview();
    if (want && !release) release = holdPreview();
    else if (!want && release) { release(); release = null; }
    setBuilderFocus(builderMirrorsPreview());
  };
  sync();
  const subs = [useSceneBuilder.subscribe(sync), useSceneBuilder2D.subscribe(sync), useGridBuilder.subscribe(sync), useBuilderWindows.subscribe(sync), useSplatBuilder.subscribe(sync), useTimeCubeBuilder.subscribe(sync), useWarpBuilder.subscribe(sync), useTextureLab.subscribe(sync)];
  return () => { for (const u of subs) u(); release?.(); release = null; setBuilderFocus(false); };
}
