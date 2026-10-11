/**
 * playParam.ts — the right-click Play menu for the 3D Scene Builder's sliders: the node param a
 * value builds (sceneBuilder/paramMap.ts), looked up in the graph when the menu opens.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useSceneBuilder } from '../../sceneBuilder/store';
import { liveParam, type SpecPath } from '../../sceneBuilder/paramMap';

/** BuilderSlider's `lazyParam` for a value of the spec. */
export const lazyParamFor = (path: SpecPath) => () => {
  const sb = useSceneBuilder.getState();
  return liveParam(useNodeGraphStore.getState().nodes, sb.targetSceneId, sb.spec, path);
};
