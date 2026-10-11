/**
 * The Agent Builder's rule set while it is edited: shown at once, applied to the group a quarter
 * of a second after the last change (one undo step a burst, agentRules/storeActions.ts), and
 * re-read when it changes from outside (undo, a preset, the rules editor) unless an edit is on its way.
 *
 * While a diagram is dragged (`hold(true)`), edits apply at most every HOLD_MS instead, so the
 * picture follows the drag; `hold(false)` applies the last one at once.
 */
import { useEffect, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { groupRules } from '../../agentRules/apply';
import type { AgentRuleSet } from '../../agentRules/spec';
import { applyGroupRules } from '../../agentRules/storeActions';
import type { GraphNode } from '../../types/nodeGraph';

const EMPTY: GraphNode = { id: '', type: 'agentsGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} };
/** While dragging: the longest an edit waits before it reaches the picture. */
export const HOLD_MS = 140;

export function useRuleSetEditing(groupId: string) {
  const [set, setSet] = useState<AgentRuleSet>(() => groupRules(useNodeGraphStore.getState().nodes.find(x => x.id === groupId) ?? EMPTY));
  const pending = useRef<AgentRuleSet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const flushedAt = useRef(0);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    flushedAt.current = Date.now();
    if (pending.current) { applyGroupRules(groupId, pending.current, 'Agent Builder: edited'); pending.current = null; }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: AgentRuleSet) => {
    setSet(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, holding.current ? Math.max(0, HOLD_MS - (Date.now() - flushedAt.current)) : 250);
  };
  /** A drag starts (edits reach the picture while it moves) or ends (the last edit applies now). */
  const hold = (on: boolean) => {
    holding.current = on;
    if (on) flushedAt.current = Date.now();
    else flush();
  };
  useEffect(() => useNodeGraphStore.subscribe((st, prev) => {
    const now = st.nodes.find(x => x.id === groupId);
    const was = prev.nodes.find(x => x.id === groupId);
    if (now && now.params.agentRules !== was?.params.agentRules && !pending.current) setSet(groupRules(now));
  }), [groupId]);
  return { set, setSet, update, flush, hold };
}
