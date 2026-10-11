/**
 * windows.ts — which builder window is open, for the windows a card used to keep to itself: the
 * Grid Rules editor, the Agent Rules editor and the Agent Builder. Held here so anything can open them (the node
 * browser's Builders section, the Do… bar, the card's own button) and one host draws them
 * (components/builders/BuilderWindowsHost.tsx, on the desktop graph and on a phone).
 *
 * Also the recipe chip a card should open ("show the recipe" in the Do… bar). No graph imports.
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { openDoBar } from '../suggestions/doBarStore';
import { requestPage } from '../components/page';

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

// ── ⌘⇧D inside a builder: show its recipe ─────────────────────────────────────────────────────────
//
// ⌘⇧D (App.tsx, `doBarOrRecipe`) opens the Do… bar, except while a scene builder is open: then it
// asks that builder to show its recipe (its text view) with the editor focused. Each builder that
// has one listens while it is mounted (useBuilderRecipeRequest); the last one mounted, the one on
// top, answers. The Scene builder's kind page doesn't listen, so ⌘⇧D there opens the Do… bar.

const recipeListeners: Array<{ current: () => void }> = [];

/** Listen for ⌘⇧D's "show your recipe". Returns the unsubscribe. */
export function onBuilderRecipeRequest(fn: () => void): () => void {
  const entry = { current: fn };
  recipeListeners.push(entry);
  return () => { const i = recipeListeners.indexOf(entry); if (i >= 0) recipeListeners.splice(i, 1); };
}

/** Ask the open builder (the topmost) to show its recipe. False when no builder is listening. */
export function requestBuilderRecipe(): boolean {
  const top = recipeListeners[recipeListeners.length - 1];
  if (!top) return false;
  top.current();
  // The builder's frame (StudioShell) unfolds its settings panel, where the recipe shows.
  try { window.dispatchEvent(new Event(BUILDER_RECIPE_EVENT)); } catch { /* no window */ }
  return true;
}

/** Fired after a builder was asked for its recipe (StudioShell opens its inspector on it). */
export const BUILDER_RECIPE_EVENT = 'playfield-builder-recipe';

/** A builder answers ⌘⇧D with `show` (open its recipe view, focus its editor) while mounted. */
export function useBuilderRecipeRequest(show: () => void): void {
  const ref = useRef(show);
  ref.current = show;
  useEffect(() => onBuilderRecipeRequest(() => ref.current()), []);
}

/**
 * ⌘⇧D: in an open builder, its recipe; else the Do… bar. Off the Studio (Play, Present, Files…)
 * it switches to the Studio first, where the Do… bar and the builders live, then decides (a
 * builder left open there mounts again and answers).
 */
export function doBarOrRecipe(onStudio: boolean): void {
  const decide = () => {
    if (requestBuilderRecipe()) return;
    // A page with no recipe (the Scene builder's kind page, the Agent Builder's start page) would
    // cover the Do… bar: close it first ("new 2d scene" and the like in the bar open it again).
    const w = useBuilderWindows.getState();
    if (w.sceneShell || (w.agentBuilder && !w.agentBuilder.groupId)) useBuilderWindows.setState({ sceneShell: null, ...(w.agentBuilder && !w.agentBuilder.groupId ? { agentBuilder: null } : {}) });
    openDoBar();
  };
  if (onStudio) { decide(); return; }
  requestPage('studio');
  setTimeout(decide, 50);
}

/**
 * Focus the first element matching `selector` once it is on screen (the recipe view renders a
 * frame later), caret at the end, ready to type. Gives up after a few frames.
 */
export function focusRecipeEditor(selector: string, tries = 12): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>(selector);
  if (el) {
    el.focus();
    if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView?.({ block: 'nearest' });
    return;
  }
  if (tries > 0) requestAnimationFrame(() => focusRecipeEditor(selector, tries - 1));
}
