/**
 * browse.ts — the node types of one stage, for the node browser when a stage on the flow strip
 * is clicked (docs/structure-hints.md). A stage lists its own nodes and those its flow reads as
 * it (a 2D graph's Shape includes Union), but not another flow's own kinds (no 3D shapes in 2D).
 */
import { getOfferedDefinitions } from '../nodes/definitions';
import { FLOW_MARKERS, inFlow, stageOfType, type FlowId, type StageId } from './stages';

/** Offered node types in `stage` of `flow`, by category then label. */
export function typesForStage(flow: FlowId, stage: StageId, hidden: ReadonlySet<string> = new Set()): Array<{ type: string; label: string; category: string }> {
  const foreign = new Set<StageId>();
  for (const [f, set] of Object.entries(FLOW_MARKERS) as Array<[FlowId, ReadonlySet<StageId>]>) if (f !== flow) for (const s of set) foreign.add(s);
  return getOfferedDefinitions()
    .filter(d => !hidden.has(d.type))
    .filter(d => {
      const own = stageOfType(d.type);
      if (own === 'any') return false;
      if (own !== stage && foreign.has(own)) return false;
      return inFlow(own, flow)?.stage === stage;
    })
    .map(d => ({ type: d.type, label: d.label, category: d.category }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

/** Ask the app to show the node browser (desktop sidebar, phone Browse sheet) on a stage. */
export const BROWSE_STAGE_EVENT = 'structure-browse-stage';
