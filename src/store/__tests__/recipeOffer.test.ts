/**
 * The starter-recipe offer (store/recipeOfferStore.ts, store.applyStarterRecipe): adding a node
 * with recipes opens it, closing it adds nothing, "Don't ask again" sticks per node type, a
 * recipe is one undo step, and nodes without recipes (or added inside a group, or by code with
 * params) are never asked about.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

const stored = new Map<string, string>();
vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (globalThis as unknown as { __ls: Map<string, string> }).__ls?.get(k) ?? null,
    setItem: (k: string, v: string) => { (globalThis as unknown as { __ls: Map<string, string> }).__ls?.set(k, v); },
    removeItem: (k: string) => { (globalThis as unknown as { __ls: Map<string, string> }).__ls?.delete(k); },
    key: () => null, length: 0, clear: () => {},
  });
});
(globalThis as unknown as { __ls: Map<string, string> }).__ls = stored;

import { useNodeGraphStore } from '../useNodeGraphStore';
import { closeRecipeOffer, recipesOffTypes, resetRecipesOff, RECIPES_OFF_KEY, useRecipeOffer } from '../recipeOfferStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { describeSetting } from '../../files/appSettings';

const outputOnly = (): GraphNode[] => [
  { id: 'out', type: 'output', position: { x: 1600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
];
const S = () => useNodeGraphStore.getState();

describe('the starter-recipe offer', () => {
  beforeEach(() => {
    stored.clear();
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
    S().replaceGraph(outputOnly());
    closeRecipeOffer();
  });

  it('opens for a node with recipes, at that node', () => {
    const id = S().addNode('gridLayout', { x: 0, y: 0 })!;
    expect(useRecipeOffer.getState().offer).toMatchObject({ nodeId: id, type: 'gridLayout' });
  });

  it('stays shut for a node without recipes, and a later add closes an open one', () => {
    S().addNode('gridLayout', { x: 0, y: 0 });
    S().addNode('add', { x: 0, y: 600 });
    expect(useRecipeOffer.getState().offer).toBeNull();
  });

  it('stays shut for adds made by code with params, and inside a group', () => {
    S().addNode('fbm', { x: 0, y: 0 }, { scale: 3 });
    expect(useRecipeOffer.getState().offer).toBeNull();
    const g = S().addNode('group', { x: 0, y: 400 })!;
    closeRecipeOffer();
    S().enterGroup(g);
    S().addNode('fbm', { x: 0, y: 0 });
    expect(useRecipeOffer.getState().offer).toBeNull();
    S().exitGroup();
  });

  it('closed (Esc, a click elsewhere, Just the node): nothing is added', () => {
    S().addNode('gridLayout', { x: 0, y: 0 });
    const before = S().nodes.length;
    closeRecipeOffer();
    expect(useRecipeOffer.getState().offer).toBeNull();
    expect(S().nodes.length).toBe(before);
  });

  it('"Don\'t ask for this node again" sticks for that type only, is an App setting, and resets', () => {
    S().addNode('gridLayout', { x: 0, y: 0 });
    closeRecipeOffer(true);
    expect([...recipesOffTypes()]).toEqual(['gridLayout']);
    expect(describeSetting(RECIPES_OFF_KEY).category).toBe('studio');
    S().addNode('gridLayout', { x: 0, y: 900 });
    expect(useRecipeOffer.getState().offer).toBeNull();
    S().addNode('fbm', { x: 0, y: 1800 });
    expect(useRecipeOffer.getState().offer?.type).toBe('fbm');
    resetRecipesOff();
    S().addNode('gridLayout', { x: 0, y: 2700 });
    expect(useRecipeOffer.getState().offer?.type).toBe('gridLayout');
  });

  it('a recipe: helper nodes, wired, on the Output, compiles; one undo step takes it back to just the node', () => {
    const id = S().addNode('gridLayout', { x: 0, y: 0 })!;
    const justTheNode = S().nodes;
    const added = S().applyStarterRecipe(id, 'grid-no-clip')!;
    expect(added.length).toBeGreaterThan(2);
    expect(useRecipeOffer.getState().offer).toBeNull();
    const nodes = S().nodes;
    expect(nodes.find(n => n.type === 'neighborDist')!.inputs.cellID.connection).toEqual({ nodeId: id, outputKey: 'cellID' });
    expect(nodes.find(n => n.type === 'output')!.inputs.color.connection?.nodeId).toBe(nodes.find(n => n.type === 'sdfFill')!.id);
    expect(compileGraph({ nodes }).errors).toBeUndefined();
    S().undo();
    expect(S().nodes).toEqual(justTheNode);
  });

  it('an unknown recipe or a node that is gone adds nothing', () => {
    const id = S().addNode('gridLayout', { x: 0, y: 0 })!;
    const before = S().nodes;
    expect(S().applyStarterRecipe(id, 'nope')).toBeNull();
    expect(S().applyStarterRecipe('gone', 'grid-no-clip')).toBeNull();
    expect(S().nodes).toBe(before);
  });
});
