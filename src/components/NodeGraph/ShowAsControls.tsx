/**
 * The "Show as" picker for a node's preview (docs/node-previews.md), shared by the eye preview's
 * banner and the node card: the mode for a float / vec2 output and, on a node with several
 * outputs, which output to show. The choice is remembered per node (lib/nodePreview/showAs.ts).
 */
import type { GraphNode } from '../../types/nodeGraph';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import {
  modesFor, pickPreviewOutput, prefOf, previewableOutputs, showAsFor, useNodePreviewPrefs,
  type ShowAsMode, type ValueType,
} from '../../lib/nodePreview/showAs';

export interface ShowAsState {
  outputKey: string;
  /** The output's type; a "Show as" applies only to 'float' and 'vec2'. */
  type: string;
  valueType: ValueType | null;
  mode: ShowAsMode | null;
  sliceY: number;
}

/** The node's preview output, its mode and slice line, following the remembered choices. */
export function useShowAs(node: GraphNode | null): ShowAsState | null {
  const prefs = useNodePreviewPrefs(s => s.prefs);
  if (!node) return null;
  const pref = prefOf(node, prefs);
  const picked = pickPreviewOutput(node, pref.output);
  if (!picked) return null;
  const [outputKey, type] = picked;
  const valueType: ValueType | null = type === 'float' || type === 'vec2' ? type : null;
  return {
    outputKey, type, valueType,
    mode: valueType ? showAsFor(node, valueType, outputKey, prefs) : null,
    sliceY: typeof pref.sliceY === 'number' ? pref.sliceY : 0.5,
  };
}

/** Show another output: remembered, and the eye preview recompiles if it's on this node. */
export function setPreviewOutput(node: GraphNode, output: string) {
  useNodePreviewPrefs.getState().set(node, { output });
  const st = useNodeGraphStore.getState();
  if (st.previewNodeId === node.id) st.compile();
}

export function setShowAs(node: GraphNode, type: ValueType, mode: ShowAsMode) {
  useNodePreviewPrefs.getState().set(node, type === 'vec2' ? { vec2: mode as never } : { float: mode as never });
}

export function ShowAsControls({ node, state, compact = false }: { node: GraphNode; state: ShowAsState; compact?: boolean }) {
  const outputs = previewableOutputs(node);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }} onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      {outputs.length > 1 && (
        <Select
          ariaLabel="Output to preview"
          value={state.outputKey}
          height={compact ? 24 : 26}
          style={{ maxWidth: compact ? 110 : 140, fontSize: 11.5 }}
          options={outputs.map(o => ({ value: o.key, label: `${o.label} · ${o.type}` }))}
          onChange={k => setPreviewOutput(node, k)}
        />
      )}
      {state.valueType && state.mode && (
        <Segmented<ShowAsMode>
          size="sm"
          ariaLabel="Show as"
          value={state.mode}
          onChange={m => setShowAs(node, state.valueType!, m)}
          options={modesFor(state.valueType).map(m => ({ value: m.value, label: m.label }))}
        />
      )}
    </span>
  );
}
