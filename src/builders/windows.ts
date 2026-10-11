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
  agentBuilder: { groupId: string | null; fromShell?: boolean } | null;
  /**
   * The Scene builder's own pages (components/builders/SceneBuilderShell.tsx): "What kind of
   * scene?" (`kinds`) or, on a graph a builder made, Edit this one / Start over / Add another
   * (`existing`). Null while closed or while one of its kinds is open in its own window.
   */
  sceneShell: SceneShellPage | null;
  /** A card asked to show its recipe expanded (`n` counts the asks, so asking again re-opens it). */
  recipe: { id: string; n: number } | null;
}

export interface SceneShellPage {
  page: 'kinds' | 'existing';
  /** A line over the kinds ("Started over: … is gone"). */
  note?: string;
  /** Keep the graph by default (Add another, or back from a builder with something built). */
  keep?: boolean;
}

export const useBuilderWindows = create<BuilderWindowsState>(() => ({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null, sceneShell: null }));

export const openGridRulesEditor = (nodeId: string) => useBuilderWindows.setState({ gridRules: nodeId });
export const closeGridRulesEditor = () => useBuilderWindows.setState({ gridRules: null });
export const toggleGridRulesEditor = (nodeId: string) => useBuilderWindows.setState(s => ({ gridRules: s.gridRules === nodeId ? null : nodeId }));

export const openAgentRulesWindow = (groupId: string) => useBuilderWindows.setState({ agentRules: groupId, agentBuilder: null });
export const closeAgentRulesWindow = () => useBuilderWindows.setState({ agentRules: null });

/**
 * The Agent Builder on a group, or (null) on its start page. `fromShell`: opened from the Scene
 * builder's kind page, which already asked whether to clear the graph and what to do with groups
 * already there, so its start page asks neither again.
 */
export const openAgentBuilder = (groupId: string | null, o: { fromShell?: boolean } = {}) =>
  useBuilderWindows.setState({ agentBuilder: { groupId, ...(o.fromShell ? { fromShell: true } : {}) }, agentRules: null, sceneShell: null });
export const closeAgentBuilder = () => useBuilderWindows.setState({ agentBuilder: null });

export const openSceneShell = (page: SceneShellPage) => useBuilderWindows.setState({ sceneShell: page });
export const closeSceneShell = () => useBuilderWindows.setState({ sceneShell: null });

/** Ask the card of `nodeId` to show its recipe chip expanded. */
export const showRecipeOf = (nodeId: string) => useBuilderWindows.setState(s => ({ recipe: { id: nodeId, n: (s.recipe?.n ?? 0) + 1 } }));
