/**
 * The builders made easy to find (docs/node-browser.md, "Builders"): the Builders section's search
 * and what each entry opens; the Recipe chip's text (builder-made scenes only) and its "edited
 * since build" check; Grid Rules and Agent Rules recipes; the Do… bar's builder phrases.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useSceneBuilder } from '../../sceneBuilder/store';
import { applyScene } from '../../sceneBuilder/apply';
import { ROLE_KEY } from '../../sceneBuilder/build';
import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import { templateSpec } from '../../sceneBuilder/templates';
import { rulesStarter } from '../../agentRules/starter';
import { BUILDER_COMMANDS } from '../../lang/commands';
import { ALL_BUILDERS, BUILDERS, matchBuilders } from '../registry';
import { agentRulesSummary, builderRecipeOf, gridRecipeText, highlightRecipe, sceneEditedSinceBuild } from '../recipe';
import { normalisePhrase, planBuilderCommand, readBuilderCommand } from '../doBuilders';
import { openBuilder, runBuilderAction } from '../open';
import { useBuilderWindows } from '../windows';
import { useExprBuilder } from '../../exprBuilder/store';
import { groupRules } from '../../agentRules/apply';
import { COUNT_PRESETS, SMOOTH_PRESETS, presetPatch } from '../../gridRules/spec';

const ids = () => { let i = 0; return () => `n${++i}`; };
const builtScene = () => {
  const graph = applyScene([], templateSpec('twisted'), { nextId: ids() }).nodes;
  return { graph, scene: graph.find(n => n.type === 'sceneGroup')! };
};
const handScene = (): GraphNode => ({ id: 'hand', type: 'sceneGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { subgraph: { nodes: [] } } });
const grid = (params: Record<string, unknown> = {}): GraphNode => ({ id: 'g1', type: 'gridRules', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params });

describe('the Builders section', () => {
  it('lists the four visible builders with a line each and what they make (Expression and 3D Agent are hidden)', () => {
    expect(BUILDERS.map(b => b.title)).toEqual(['3D Scene Builder', '2D Scene Builder', 'Grid Rules', 'Agent Builder']);
    expect(ALL_BUILDERS.filter(b => b.hidden).map(b => b.id)).toEqual(['agents3d', 'expr']);
    for (const b of BUILDERS) { expect(b.description.length).toBeGreaterThan(10); expect(b.makes.length).toBeGreaterThan(5); }
  });
  it('is searchable: "builder" finds all four, "scene" the Scene Builders, "rules" Grid and Agents, "3d" the 3D ones; hidden builders never show', () => {
    expect(matchBuilders('builder').map(b => b.id)).toEqual(['scene', 'scene2d', 'grid', 'agents']);
    expect(matchBuilders('expression').map(b => b.id)).toEqual([]);
    expect(matchBuilders('glsl').map(b => b.id)).toEqual([]);
    expect(matchBuilders('scene').map(b => b.id)).toEqual(['scene', 'scene2d']);
    expect(matchBuilders('2d').map(b => b.id)).toEqual(['scene2d', 'agents']);
    expect(matchBuilders('kaleidoscope').map(b => b.id)).toEqual(['scene2d']);
    expect(matchBuilders('rules').map(b => b.id)).toEqual(['grid', 'agents']);
    expect(matchBuilders('slime').map(b => b.id)).toEqual(['agents']);
    expect(matchBuilders('agents').map(b => b.id)).toEqual(['agents']);
    expect(matchBuilders('3d agents').map(b => b.id)).toEqual(['agents']);
    expect(matchBuilders('wireworld').map(b => b.id)).toEqual(['grid']);
    expect(matchBuilders('3d').map(b => b.id)).toEqual(['scene', 'agents']);
    expect(matchBuilders('n')).toEqual([]);
    expect(matchBuilders('voronoi')).toEqual([]);
  });
});

describe('opening a builder', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
    useSceneBuilder.setState({ open: false, targetSceneId: null });
  });
  it('Expression Builder: its window on a new chain from UV, at the menu\'s point', () => {
    useExprBuilder.setState({ open: false });
    openBuilder('expr', { x: 40, y: 60 });
    const xb = useExprBuilder.getState();
    expect(xb.open).toBe(true);
    expect(xb.chain.seed.kind).toBe('uv');
    expect(xb.chain.steps).toEqual([]);
    expect(xb.place).toEqual({ x: 40, y: 60 });
    expect(useNodeGraphStore.getState().nodes).toEqual([]);
  });
  it('3D Scene Builder: the builder on a new scene', () => {
    openBuilder('scene');
    expect(useSceneBuilder.getState().open).toBe(true);
    expect(useSceneBuilder.getState().targetSceneId).toBeNull();
    expect(useSceneBuilder.getState().tab).toBe('templates');
    expect(useNodeGraphStore.getState().nodes).toEqual([]);
  });
  it('Grid Rules: a new Grid Rules node, on the Output, with its editor open', () => {
    openBuilder('grid');
    const nodes = useNodeGraphStore.getState().nodes;
    const g = nodes.find(n => n.type === 'gridRules')!;
    expect(g).toBeTruthy();
    expect(useBuilderWindows.getState().gridRules).toBe(g.id);
    const out = nodes.find(n => n.type === 'output');
    expect(out?.inputs.color.connection?.nodeId).toBe(g.id);
    expect(useSceneBuilder.getState().open).toBe(false);
  });
  it('Agent Rules: a new Agents group in rules mode, with its rules open', () => {
    openBuilder('agents');
    const g = useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup')!;
    expect(g.params.ruleMode).toBe('rules');
    expect(useBuilderWindows.getState().agentRules).toBe(g.id);
    expect(useBuilderWindows.getState().gridRules).toBeNull();
  });
  it('3D Agent Builder: a 3D rules group with a volume Trail and a camera, its rules open', () => {
    openBuilder('agents3d');
    const nodes = useNodeGraphStore.getState().nodes;
    const g = nodes.find(n => n.type === 'agentsGroup')!;
    expect(g.params.ruleMode).toBe('rules');
    expect(g.params.space).toBe('3d');
    expect(nodes.find(n => n.type === 'agentEmit')!.params.shape).toBe('ball');
    expect(nodes.find(n => n.type === 'trailField')!.params.volume).toBe('96');
    expect(nodes.find(n => n.type === 'drawAgents')!.params.rotSpeed).toBeGreaterThan(0);
    expect(useBuilderWindows.getState().agentRules).toBe(g.id);
  });
});

describe('the Recipe chip', () => {
  it('shows the printed recipe of a scene the builder made', () => {
    const { graph, scene } = builtScene();
    const r = builderRecipeOf(scene, graph);
    expect(r?.kind).toBe('scene');
    expect(r!.text).toBe(printRecipe(templateSpec('twisted')));
    expect(r!.lines).toBe(printRecipe(templateSpec('twisted'), { pretty: true }));
    // It reads back to the same scene.
    expect(parseRecipe(r!.text).errors).toEqual([]);
  });
  it('is hidden on a hand-made Scene Group', () => {
    expect(builderRecipeOf(handScene(), [handScene()])).toBeNull();
  });
  it('tells a scene edited by hand since its build ("edited since build")', () => {
    const { graph, scene } = builtScene();
    expect(sceneEditedSinceBuild(graph, scene.id)).toBe(false);
    // Moving cards is not an edit.
    const moved = graph.map(n => ({ ...n, position: { x: n.position.x + 50, y: n.position.y } }));
    expect(sceneEditedSinceBuild(moved, scene.id)).toBe(false);
    // A setting changed on a built node is.
    const shadow = graph.find(n => n.params[ROLE_KEY] === 'shadow')!;
    const edited = graph.map(n => (n.id === shadow.id ? { ...n, params: { ...n.params, k: 40 } } : n));
    expect(sceneEditedSinceBuild(edited, scene.id)).toBe(true);
    expect(builderRecipeOf(edited.find(n => n.id === scene.id)!, edited)).toMatchObject({ kind: 'scene', edited: true });
    // So is a wire moved.
    const cam = graph.find(n => n.params[ROLE_KEY] === 'camera')!;
    const unwired = graph.map(n => (Object.values(n.inputs).some(i => i.connection?.nodeId === cam.id)
      ? { ...n, inputs: Object.fromEntries(Object.entries(n.inputs).map(([k, i]) => [k, i.connection?.nodeId === cam.id ? { ...i, connection: undefined } : i])) } : n));
    expect(sceneEditedSinceBuild(unwired, scene.id)).toBe(true);
    // A hand-made scene was never built.
    expect(sceneEditedSinceBuild([handScene()], 'hand')).toBe(false);
  });
  it('a Grid Rules node: the rule as text', () => {
    expect(gridRecipeText(presetPatch(COUNT_PRESETS.life))).toBe('Life B3/S23 · 240×135 · wrap');
    expect(gridRecipeText({ ...presetPatch(COUNT_PRESETS.life), board: '0.0625', edges: 'walls' })).toBe('Life B3/S23 · 120×68 · walls');
    expect(gridRecipeText({ ruleType: 'smooth', ...presetPatch(SMOOTH_PRESETS.heat) })).toMatch(/^Heat · Smooth · /);
    expect(builderRecipeOf(grid(presetPatch(COUNT_PRESETS.life)), [])).toMatchObject({ kind: 'grid', text: 'grid life', summary: 'Life B3/S23 · 240×135 · wrap' });
  });
  it('a rules Agents group: "n rules · n states", its rules in the Playfield language', () => {
    const s = rulesStarter(null);
    const g = s.nodes.find(n => n.id === s.groupId)!;
    const set = groupRules(g);
    const r = builderRecipeOf(g, s.nodes)!;
    expect(r.kind).toBe('agents');
    expect(r.text).toBe(agentRulesSummary(set));
    expect(r.text).toMatch(/^\d+ rules? · \d+ states?$/);
    expect(r.lines).toMatch(/^agents/);
    expect(r.lines).toMatch(/\n  always do /);
    // Two species and two states.
    const two = { ...set, species: [set.species[0], { ...set.species[0], name: 'B', states: [...set.species[0].states, { name: 'sick', colour: [1, 0, 0] as [number, number, number] }] }] };
    expect(agentRulesSummary(two)).toMatch(/ · 3 states · 2 species$/);
  });
  it('colours a recipe\'s words', () => {
    const runs = highlightRecipe('volumetric · smooth-union(sphere r=1, cone h=2) k=0.3 · twist 0.5 · fog 0.3 color=white');
    const kind = (t: string) => runs.find(r => r.text === t)?.kind;
    expect(kind('volumetric')).toBe('mode');
    expect(kind('smooth-union')).toBe('op');
    expect(kind('sphere')).toBe('shape');
    expect(kind('twist')).toBe('warp');
    expect(kind('fog')).toBe('setting');
    expect(kind('r')).toBe('key');
    expect(kind('0.5')).toBe('number');
    expect(kind('white')).toBe('colour');
    expect(highlightRecipe('torus name=Ring').find(r => r.text === 'Ring')?.kind).toBe('name');
    expect(highlightRecipe('When always → turn toward its trail (30°)', { words: false }).some(r => r.kind === 'warp')).toBe(false);
    expect(runs.map(r => r.text).join('')).toBe('volumetric · smooth-union(sphere r=1, cone h=2) k=0.3 · twist 0.5 · fog 0.3 color=white');
  });
});

describe('Do… bar builder phrases', () => {
  const phrases: Array<[string, string]> = [
    ['open the scene builder', 'open-scene-builder'], ['Open scene builder!', 'open-scene-builder'],
    ['new 3d scene', 'new-3d-scene'], ['edit this scene', 'edit-scene'],
    ['open grid rules', 'open-grid-rules'], ['new grid rules', 'new-grid-rules'], ['edit the rules', 'edit-rules'],
    ['open agent rules', 'open-agent-rules'], ['new agent rules', 'new-agent-rules'],
    ['new 3d agents', 'new-3d-agents'], ['3D agent builder', 'new-3d-agents'], ['open the 3d agent builder', 'new-3d-agents'],
    ['new 3d agents round a shape', 'new-3d-agents-shape'], ['agents around a shape', 'new-3d-agents-shape'],
    ['show the recipe', 'show-recipe'], ['copy the recipe', 'copy-recipe'], ['please copy the recipe', 'copy-recipe'],
  ];
  for (const [text, id] of phrases) it(`“${text}” reads as ${id}`, () => expect(readBuilderCommand(text)?.id).toBe(id));
  it('reads only whole phrases', () => {
    for (const t of ['create a circle', 'show the noise', 'copy the glow', 'new', 'edit', 'scene builder please make it red', '']) expect(readBuilderCommand(t), t).toBeNull();
  });
  it('no phrase means two commands', () => {
    const seen = new Map<string, string>();
    for (const c of BUILDER_COMMANDS) for (const w of c.words) {
      const k = normalisePhrase(w);
      if (seen.has(k)) expect(seen.get(k), w).toBe(c.id);
      seen.set(k, c.id);
    }
  });
  const plan = (text: string, nodes: GraphNode[], selected: string[] = []) => planBuilderCommand(readBuilderCommand(text)!, { nodes, selected });
  it('plans against the graph: which node it opens, or why it can\'t', () => {
    const { graph, scene } = builtScene();
    const march = graph.find(n => n.params[ROLE_KEY] === 'march')!;
    expect(plan('new 3d scene', []).action).toEqual({ kind: 'new-scene' });
    expect(plan('edit this scene', graph, [march.id]).action).toEqual({ kind: 'edit-scene', sceneId: scene.id });
    expect(plan('edit this scene', graph).action).toEqual({ kind: 'edit-scene', sceneId: scene.id });
    expect(plan('edit this scene', [handScene()]).problem).toMatch(/no scene the Scene Builder built/);
    expect(plan('open grid rules', []).action).toEqual({ kind: 'new-grid' });
    expect(plan('open grid rules', [grid()]).action).toEqual({ kind: 'open-grid', nodeId: 'g1' });
    expect(plan('open grid rules', [grid(), { ...grid(), id: 'g2' }]).problem).toMatch(/there are 2/);
    expect(plan('open grid rules', [grid(), { ...grid(), id: 'g2' }], ['g2']).action).toEqual({ kind: 'open-grid', nodeId: 'g2' });
    const s = rulesStarter(null);
    expect(plan('edit the rules', s.nodes).action).toEqual({ kind: 'open-agents', groupId: s.groupId });
    expect(plan('edit the rules', [...s.nodes, grid()], ['g1']).action).toEqual({ kind: 'open-grid', nodeId: 'g1' });
    expect(plan('open agent rules', []).action).toEqual({ kind: 'new-agents' });
    expect(plan('new 3d agents', []).action).toEqual({ kind: 'new-agents3d' });
    expect(plan('new 3d agents round a shape', []).action).toEqual({ kind: 'new-agents3d', template: 'shape3d' });
    expect(plan('show the recipe', graph, [march.id]).action).toEqual({ kind: 'show-recipe', nodeId: scene.id });
    expect(plan('copy the recipe', [grid()]).action).toEqual({ kind: 'copy-recipe', nodeId: 'g1' });
    expect(plan('copy the recipe', [handScene()]).action).toBeNull();
  });
  it('runs the same open actions', () => {
    useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
    runBuilderAction(plan('new grid rules', [])!.action!);
    const g = useNodeGraphStore.getState().nodes.find(n => n.type === 'gridRules')!;
    expect(useBuilderWindows.getState().gridRules).toBe(g.id);
    runBuilderAction({ kind: 'show-recipe', nodeId: g.id });
    expect(useBuilderWindows.getState().recipe?.id).toBe(g.id);
    const { graph, scene } = builtScene();
    useNodeGraphStore.setState({ nodes: graph });
    expect(runBuilderAction({ kind: 'edit-scene', sceneId: scene.id })).toBe(true);
    expect(useSceneBuilder.getState().targetSceneId).toBe(scene.id);
    // The Expression Builder still opens from its action (hidden from lists and the Do… bar)
    useExprBuilder.setState({ open: false });
    expect(runBuilderAction({ kind: 'new-expression' })).toBe(true);
    expect(useExprBuilder.getState().open).toBe(true);
  });
});
