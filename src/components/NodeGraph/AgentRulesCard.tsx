/**
 * The Agents group card's rules controls (docs/agent-rules.md). In rules mode: Edit rules ↗ (the
 * rules editor; double-clicking the card's title opens it too) and Open as nodes. In nodes mode:
 * Open rule ↗ as before, and a small link to Back to rules (a group that has rules) or Write as
 * rules (one that doesn't: its inside is replaced, undoably).
 */
import React from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { pal, MONO } from './vizKit';
import { isRulesGroup } from '../../agentRules/apply';
import { groupBackToRules, openAgentRulesEditor, openGroupAsNodes } from '../../agentRules/storeActions';
import { askChoice } from '../ui/dialogStore';

export function AgentRulesCardButtons({ node, button, onEnterGroup }: { node: GraphNode; button: React.CSSProperties; onEnterGroup?: (groupId: string) => void }) {
  const rules = isRulesGroup(node);
  // The rules editor is drawn by BuilderWindowsHost (builders/windows.ts), so the Builders section and the Do… bar open it too.
  return (
    <>
      {rules ? (
        <>
          <button type="button" style={button} title="Edit the rules this group's walkers follow, as When … Do … lines (or double-click the card's title)" onClick={() => openAgentRulesEditor(node.id)}>Edit rules ↗</button>
          <button type="button" style={button} title="Open as nodes: the nodes the rules make (Start, a block per rule, Finish, Move), every one with a note, to edit as nodes" onClick={() => openGroupAsNodes(node.id)}>Open as nodes</button>
        </>
      ) : (
        <button type="button" style={button} title="Open the rule one walker follows every step (or double-click the card's title)" onClick={() => onEnterGroup?.(node.id)}>Open rule ↗</button>
      )}
    </>
  );
}

/** Nodes mode: Back to rules / Write as rules, as a small link under the buttons. */
export function AgentRulesCardLink({ node }: { node: GraphNode }) {
  if (isRulesGroup(node)) return null;
  const had = !!node.params.agentRules;
  const go = async () => {
    const ok = await askChoice(had ? 'Back to rules?' : 'Write as rules?', [
      { id: 'no', label: 'Cancel' },
      { id: 'yes', label: had ? 'Back to rules' : 'Write as rules', variant: 'primary' },
    ], { message: had
      ? 'The inside is made from the group\'s rules again, replacing any changes made to its nodes. Undo brings them back.'
      : 'The group\'s inside is replaced by rules written as When … Do … lines (starting with: turn toward its trail, wander, leave trail). Undo brings the nodes back.' });
    if (ok !== 'yes') return;
    groupBackToRules(node.id);
    openAgentRulesEditor(node.id);
  };
  return (
    <button type="button" onClick={() => void go()}
      title={had ? 'Make the inside from this group\'s rules again (replaces node edits)' : 'Write this group\'s behaviour as When … Do … rules instead of nodes (replaces the inside)'}
      style={{ display: 'block', marginTop: 6, padding: 0, border: 0, background: 'none', color: pal.overlay0, font: `500 10px ${MONO}`, cursor: 'pointer', textDecoration: 'underline' }}>
      {had ? 'Back to rules' : 'Write as rules…'}
    </button>
  );
}
