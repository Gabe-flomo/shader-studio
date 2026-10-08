/**
 * recipeOfferStore.ts — the starter-recipe offer (docs/starter-recipes.md): which node just
 * added has one open, and the node types the user said not to ask about again.
 *
 * The store's addNode calls `noteNodeAdded` after a plain add on the top level; RecipeOffer.tsx
 * shows the offer next to the node; picking a recipe runs store.applyStarterRecipe. Closing it
 * any other way (Esc, a click elsewhere, "Just the node") adds nothing.
 */
import { create } from 'zustand';
import { recipesFor } from '../nodes/recipes';

/** localStorage key: JSON list of node types whose offer is turned off (App settings can reset it). */
export const RECIPES_OFF_KEY = 'shader-studio:settings:starterRecipesOff';

export interface RecipeOffer {
  nodeId: string;
  type: string;
  /** When it opened (performance.now / Date.now ms): clicks just after it opens don't close it. */
  openedAt: number;
}

export const useRecipeOffer = create<{ offer: RecipeOffer | null }>(() => ({ offer: null }));

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Node types whose offer the user turned off. */
export function recipesOffTypes(): Set<string> {
  try {
    const raw = localStorage.getItem(RECIPES_OFF_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Stop offering recipes when a node of `type` is added ("Don't ask for this node again"). */
export function turnRecipesOff(type: string): void {
  const off = recipesOffTypes();
  off.add(type);
  try { localStorage.setItem(RECIPES_OFF_KEY, JSON.stringify([...off].sort())); } catch { /* storage unavailable: asks again next time */ }
}

/** Offer recipes for every node again. */
export function resetRecipesOff(): void {
  try { localStorage.removeItem(RECIPES_OFF_KEY); } catch { /* nothing stored */ }
}

/** A node was just added: open its offer when it has recipes (and isn't turned off); any older offer closes. */
export function noteNodeAdded(nodeId: string, type: string): void {
  const offer = recipesFor(type).length && !recipesOffTypes().has(type) ? { nodeId, type, openedAt: now() } : null;
  useRecipeOffer.setState({ offer });
}

/** Open the offer for a node on request (its card's button or right-click menu), whatever the "don't ask" setting. */
export function openRecipeOffer(nodeId: string, type: string): void {
  if (!recipesFor(type).length) return;
  useRecipeOffer.setState({ offer: { nodeId, type, openedAt: now() } });
}

/** Close the offer (nothing is added). `dontAskAgain` turns it off for that node type. */
export function closeRecipeOffer(dontAskAgain = false): void {
  const { offer } = useRecipeOffer.getState();
  if (offer && dontAskAgain) turnRecipesOff(offer.type);
  useRecipeOffer.setState({ offer: null });
}
