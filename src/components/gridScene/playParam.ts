/**
 * playParam.ts — the right-click Play menu for the Grid builder's sliders (as the splat builder's):
 * the built node's param a slider sets, found by its role (`_gsRole`: a shape's id, grid, glow…) in
 * the build the builder edits, looked up when the menu opens.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useGridBuilder } from '../../gridScene/store';
import { gridParamTarget, type ParamTarget } from '../../gridScene/apply';

export { gridParamTarget };

/** BuilderSlider's `lazyParam` for a built node's param. */
export const gridPlay = (role: string, key: string) => (): ParamTarget =>
  gridParamTarget(useNodeGraphStore.getState().nodes, useGridBuilder.getState().targetSceneId, role, key);
