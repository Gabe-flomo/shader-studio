/**
 * windows.ts — which builder window is open, for the windows a card used to keep to itself: the
 * Grid Rules editor, the Agent Rules editor and the Agent Builder. Held here so anything can open them (the node
 * browser's Builders section, the Do… bar, the card's own button) and one host draws them
 * (components/builders/BuilderWindowsHost.tsx, on the desktop graph and on a phone).
 *
 * Also the recipe chip a card should open ("show the recipe" in the Do… bar). No graph imports.
 */
import { create } from 'zustand';

interface BuilderWindowsState {
  /** The Grid Rules node whose editor is open. */
  gridRules: string | null;
  /** The rules Agents group whose rules editor is open (the When … Do … editor: advanced rules). */
  agentRules: string | null;
  /**
   * The Agent Builder (components/agentBuilder): on a group (`groupId`), or on its start page
   * (`groupId` null: nothing is made until a kind is picked).
   */
  agentBuilder: { groupId: string | null } | null;
  /** A card asked to show its recipe expanded (`n` counts the asks, so asking again re-opens it). */
  recipe: { id: string; n: number } | null;
}

export const useBuilderWindows = create<BuilderWindowsState>(() => ({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null }));

export const openGridRulesEditor = (nodeId: string) => useBuilderWindows.setState({ gridRules: nodeId });
export const closeGridRulesEditor = () => useBuilderWindows.setState({ gridRules: null });
export const toggleGridRulesEditor = (nodeId: string) => useBuilderWindows.setState(s => ({ gridRules: s.gridRules === nodeId ? null : nodeId }));

export const openAgentRulesWindow = (groupId: string) => useBuilderWindows.setState({ agentRules: groupId, agentBuilder: null });
export const closeAgentRulesWindow = () => useBuilderWindows.setState({ agentRules: null });

/** The Agent Builder on a group, or (null) on its start page. */
export const openAgentBuilder = (groupId: string | null) => useBuilderWindows.setState({ agentBuilder: { groupId }, agentRules: null });
export const closeAgentBuilder = () => useBuilderWindows.setState({ agentBuilder: null });

/** Ask the card of `nodeId` to show its recipe chip expanded. */
export const showRecipeOf = (nodeId: string) => useBuilderWindows.setState(s => ({ recipe: { id: nodeId, n: (s.recipe?.n ?? 0) + 1 } }));
