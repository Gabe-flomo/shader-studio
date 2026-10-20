/**
 * Combine in a Scene builder session (docs/combine.md): the kind page's Combine and a reopened build; Done is one undo
 * step and × leaves the graph as it was; "Add to this…" turns a builder's Done into layer 1; New… comes back with the
 * build (Done) or with the graph as it was (×); a slider writes params only; no Play controls are added.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import type { GraphNode } from '../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { n } from '../../store/graphBuilder';
import { useBuilderWindows } from '../../builders/windows';
import { closeSceneWindow, forgetSceneDraft, sceneDraftOpen } from '../../builders/sceneDraft';
import { editBuiltScene, startSceneKind } from '../../builders/open';
import { builtScenes, openSceneKind, sceneKindsFor, SCENE_KINDS } from '../../builders/sceneKinds';
import { useSplatBuilder } from '../../splatBuilder/store';
import { closeSplatBuilder, finishSplatBuilder, openNewSplatScene } from '../../splatBuilder/actions';
import { useCombine } from '../store';
import { addToThis, addToThisOffered, closeCombine, finishCombine, newProductIn, setLayerSetting, syncCombine } from '../actions';
import { applyCombinePreset } from '../presetActions';
import { findCombineBuild } from '../meta';

const output = (): GraphNode => n('output', 'out', 2000, 0);
const nodes = () => useNodeGraphStore.getState().nodes;
const ids = () => nodes().map(x => x.id).sort();

beforeEach(() => {
  forgetSceneDraft();
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [output()], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [], play: useNodeGraphStore.getState().play });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null, sceneShell: null });
  useSplatBuilder.setState({ open: false, targetId: null });
  useCombine.setState({ open: false });
});

describe('the kind', () => {
  it('is the ninth card, and not on a phone', () => {
    expect(SCENE_KINDS.map(k => k.id)).toContain('combine');
    expect(sceneKindsFor(true).map(k => k.id)).not.toContain('combine');
  });

  it('opens on an empty stack with "+ Add a layer" open, in a session', () => {
    startSceneKind('combine');
    expect(useCombine.getState().open).toBe(true);
    expect(useCombine.getState().picker).toEqual({ on: null, product: null });
    expect(sceneDraftOpen()).toBe(true);
    expect(openSceneKind()).toBe('combine');
    // Combine's own window doesn't offer "Add to this…".
    expect(addToThisOffered()).toBe(false);
  });
});

describe('Done and ×', () => {
  it('Done puts the stack in the graph as ONE undo step; undo takes it all away', () => {
    const before = ids();
    startSceneKind('combine');
    applyCombinePreset('photoInRoom');
    syncCombine();
    setLayerSetting('L2', 'size', 2.4);
    expect(undoManager.canUndo).toBe(0);
    const playBefore = useNodeGraphStore.getState().play;
    finishCombine();
    expect(useCombine.getState().open).toBe(false);
    expect(sceneDraftOpen()).toBe(false);
    expect(undoManager.canUndo).toBe(1);
    // No Play controls were added ([D8]).
    expect(useNodeGraphStore.getState().play).toBe(playBefore);
    const listed = builtScenes(nodes());
    expect(listed[0].kind).toBe('combine');
    expect(nodes().filter(x => x.type === 'pictureCard').every(c => c.params.size === 2.4)).toBe(true);
    useNodeGraphStore.getState().undo();
    expect(ids()).toEqual(before);
  });

  it('× leaves the graph as it was (no changes: no question)', async () => {
    const before = nodes();
    startSceneKind('combine');
    applyCombinePreset('sceneOnPhoto');
    syncCombine();
    expect(nodes().length).toBeGreaterThan(before.length);
    // The changes ask first; answered by closing quietly as the session's discard does.
    useCombine.setState({ open: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(nodes()).toBe(before);
    expect(sceneDraftOpen()).toBe(false);
  });

  it('reopens a build as it was, and a slider only writes params (same nodes, same wires)', () => {
    startSceneKind('combine');
    applyCombinePreset('photoInRoom');
    syncCombine();
    finishCombine();
    const anchor = builtScenes(nodes())[0].id;
    expect(editBuiltScene({ kind: 'combine', id: anchor })).toBe(true);
    expect(useCombine.getState().spec.layers.map(l => l.id)).toEqual(['L1', 'L2']);
    const wires = JSON.stringify(nodes().map(x => [x.id, Object.entries(x.inputs).map(([k, s]) => [k, s.connection?.nodeId])]));
    setLayerSetting('L2', 'glow', 2);
    expect(JSON.stringify(nodes().map(x => [x.id, Object.entries(x.inputs).map(([k, s]) => [k, s.connection?.nodeId])]))).toBe(wires);
    const cards = [...findCombineBuild(nodes(), anchor)!.byRole.values()].filter(x => x.type === 'pictureCard');
    expect(cards.map(c => nodes().find(x => x.id === c.id)!.params.brightness)).toEqual([2]);
    closeCombine();
  });
});

describe('Add to this… and New…', () => {
  it('a builder\'s Done becomes layer 1, the session still open; Combine\'s Done is one step', () => {
    const scan = openNewSplatScene()!;
    expect(addToThisOffered()).toBe(true);
    addToThis(finishSplatBuilder);
    expect(useSplatBuilder.getState().open).toBe(false);
    expect(useCombine.getState().open).toBe(true);
    expect(sceneDraftOpen()).toBe(true);
    const spec = useCombine.getState().spec;
    expect(spec.layers).toHaveLength(1);
    expect(spec.layers[0]).toMatchObject({ id: 'L1', verb: 'base', product: { kind: 'build', scene: 'splat', id: scan } });
    expect(useCombine.getState().picker).toEqual({ on: 'L1', product: null });
    finishCombine();
    expect(sceneDraftOpen()).toBe(false);
    expect(undoManager.canUndo).toBe(1);
  });

  it('New… opens a builder in the session: its Done comes back with the build to join; its × comes back with the graph as it was', async () => {
    startSceneKind('combine');
    applyCombinePreset('photoInRoom');
    syncCombine();
    const before = nodes();
    newProductIn('splat', 'L2');
    expect(useCombine.getState().open).toBe(false);
    expect(useSplatBuilder.getState().open).toBe(true);
    // ×: back to Combine, the splat gone.
    await closeSceneWindow(closeSplatBuilder);
    expect(useCombine.getState().open).toBe(true);
    expect(useSplatBuilder.getState().open).toBe(false);
    expect(nodes().map(x => x.id).sort()).toEqual(before.map(x => x.id).sort());
    // Again, with Done: the build comes back as the product to join.
    newProductIn('splat', 'L2');
    finishSplatBuilder();
    expect(useCombine.getState().open).toBe(true);
    expect(useCombine.getState().picker).toMatchObject({ on: 'L2', product: { kind: 'build', scene: 'splat' } });
    expect(sceneDraftOpen()).toBe(true);
    closeCombine();
  });
});
