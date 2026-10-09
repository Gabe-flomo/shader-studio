/**
 * BuilderWindowsHost — draws the Grid Rules editor, the Agent Rules editor, the Agent Builder and the Expression
 * Builder when one is open (builders/windows.ts, exprBuilder/store.ts), whoever opened it: the card's own button, the node browser's Builders
 * section, the Do… bar, a Recipe chip. Mounted once beside the desktop graph (NodeGraph) and once
 * on a phone (PhoneOverlays), where the windows are full screen.
 */
import { useEffect } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { closeAgentBuilder, closeAgentRulesWindow, closeGridRulesEditor, openAgentBuilder, useBuilderWindows } from '../../builders/windows';
import { isRulesGroup } from '../../agentRules/apply';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { GridRulesEditor as GridRulesEditorT } from '../gridRules/GridRulesEditor';
import type { AgentRulesModal as AgentRulesModalT } from '../NodeGraph/AgentRulesModal';
import type { AgentBuilder as AgentBuilderT } from '../agentBuilder/AgentBuilder';
import { useExprBuilder } from '../../exprBuilder/store';

const GridRulesEditor = lazyWithSuspense<PropsOf<typeof GridRulesEditorT>>(() => import('../gridRules/GridRulesEditor').then(m => ({ default: m.GridRulesEditor })));
const AgentRulesModal = lazyWithSuspense<PropsOf<typeof AgentRulesModalT>>(() => import('../NodeGraph/AgentRulesModal').then(m => ({ default: m.AgentRulesModal })));
// The Agent Builder (its shell, cards, pictures) loads only when it opens.
const AgentBuilder = lazyWithSuspense<PropsOf<typeof AgentBuilderT>>(() => import('../agentBuilder/AgentBuilder').then(m => ({ default: m.AgentBuilder })));
// The Expression Builder's window and its move catalogue load only when it opens.
const ExpressionBuilderModal = lazyWithSuspense<Record<string, never>>(() => import('../exprBuilder/ExpressionBuilderModal').then(m => ({ default: m.ExpressionBuilderModal })));

export function BuilderWindowsHost() {
  const gridId = useBuilderWindows(s => s.gridRules);
  const agentsId = useBuilderWindows(s => s.agentRules);
  const exprOpen = useExprBuilder(s => s.open);
  const builder = useBuilderWindows(s => s.agentBuilder);
  const builderGroupOk = useNodeGraphStore(s => !builder?.groupId || s.nodes.some(nd => nd.id === builder.groupId && isRulesGroup(nd)));
  const gridThere = useNodeGraphStore(s => !!gridId && s.nodes.some(nd => nd.id === gridId && nd.type === 'gridRules'));
  // The editor keeps its own copy of the rules while open, so it gets the group once, not on every change.
  const group = useNodeGraphStore(s => (agentsId ? s.nodes.find(nd => nd.id === agentsId) : undefined));
  const agentsOk = !!group && isRulesGroup(group);
  // A window whose node went away (deleted, undone, opened as nodes) closes, so it can't come back by itself later.
  useEffect(() => { if (gridId && !gridThere) closeGridRulesEditor(); }, [gridId, gridThere]);
  useEffect(() => { if (agentsId && !agentsOk) closeAgentRulesWindow(); }, [agentsId, agentsOk]);
  useEffect(() => { if (builder && !builderGroupOk) closeAgentBuilder(); }, [builder, builderGroupOk]);
  return (
    <>
      {gridId && gridThere && <GridRulesEditor key={gridId} nodeId={gridId} onClose={closeGridRulesEditor} />}
      {agentsId && group && isRulesGroup(group) && <AgentRulesModal key={agentsId} node={group} onClose={closeAgentRulesWindow} />}
      {exprOpen && <ExpressionBuilderModal />}
      {builder && builderGroupOk && <AgentBuilder key="agent-builder" groupId={builder.groupId} onClose={closeAgentBuilder} onOpenGroup={openAgentBuilder} />}
    </>
  );
}
