/**
 * actions.ts — the Grid builder joined to the graph (docs/grid-builder.md): open it on a new scene
 * or on a build already there, Build / Done, and the jump to Grid Rules and back.
 *
 * "Make it a simulation" turns the drawn grid into a Grid Rules start: the Grid scene's distance
 * (its shapes as they are) goes through a small Expression Block (white inside a shape) into a
 * Pass, whose Texture is the Grid Rules node's Start image (Start: Image). The Grid Rules node
 * remembers the scene (`_gridSceneFrom`), so its editor offers the way back, and a second jump
 * reuses it instead of adding another.
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { toast } from '../components/ui/toastStore';
import { n } from '../store/graphBuilder';
import { COUNT_PRESETS, LOOKS, presetPatch } from '../gridRules/spec';
import { finishBuilder } from '../builders/finish';
import { closeGridRulesEditor, openGridRulesEditor } from '../builders/windows';
import { useGridBuilder } from './store';
import { applyGridScene, findGridBuild, gridFinalOf, gridSceneOfBuild } from './apply';
import { starterGridScene } from './spec';

/** On a Grid Rules node made by the jump: the Grid scene (its UV node) it started from. */
export const FROM_GRID_KEY = '_gridSceneFrom';

/** Open the builder on a new scene (Build or Done adds it). */
export function openNewGridScene(at?: { x: number; y: number }): void {
  useGridBuilder.getState().openWith(starterGridScene(), { at: at ?? null });
}

/** Open the builder on the Grid scene `nodeId` belongs to. False when it isn't one. */
export function editGridSceneInBuilder(nodeId: string): boolean {
  const nodes = useNodeGraphStore.getState().nodes;
  const sceneId = gridSceneOfBuild(nodes, nodeId);
  const found = sceneId ? findGridBuild(nodes, sceneId) : null;
  if (!found) return false;
  useGridBuilder.getState().openWith(found.meta.spec, { targetSceneId: sceneId });
  return true;
}

/** The top-level nodes a Grid scene build is made of. */
export function gridSceneBuildIds(sceneId: string | null | undefined): string[] {
  if (!sceneId) return [];
  const b = findGridBuild(useNodeGraphStore.getState().nodes, sceneId);
  return b ? [...b.byRole.values()].map(x => x.id) : [];
}

/** Build (or rebuild) the builder's scene into the graph. Returns the scene's UV node id. */
export function buildFromGridBuilder(asNew = false, o: { quiet?: boolean; keepOutput?: boolean } = {}): string {
  const gb = useGridBuilder.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const target = gb.targetSceneId && findGridBuild(nodes, gb.targetSceneId) ? gb.targetSceneId : null;
  const fresh = asNew || !target;
  const result = applyGridScene(nodes, gb.spec, {
    nextId: () => useNodeGraphStore.getState().newNodeId(),
    sceneId: fresh ? null : target, asNew: fresh, at: gb.at ?? undefined, keepOutput: o.keepOutput,
  });
  const placed = fresh ? intoView(nodes, result.nodes, gb.at ? 'ifOutOfView' : 'centre') : result.nodes;
  useNodeGraphStore.getState().setNodesRewritten(placed, fresh ? 'Built a grid scene' : 'Rebuilt the grid scene');
  gb.setTarget(result.sceneId);
  gb.markBuilt();
  if (!o.quiet) {
    const notes = [...(result.kept ? [`Kept ${result.kept} setting${result.kept === 1 ? '' : 's'} you changed on the nodes.`] : []), ...result.warnings];
    (result.warnings.length ? toast.warning : toast.success)(fresh ? 'Grid scene built' : 'Grid scene rebuilt', {
      message: notes.length ? notes.join(' ') : 'Every node has a note. Open the Scene builder to draw on it again.',
    });
  }
  return result.sceneId;
}

/** Done: build what isn't built yet, close, and frame it on the graph. */
export function finishGridBuilder(): void {
  const gb = useGridBuilder.getState();
  const nodes = useNodeGraphStore.getState().nodes;
  const built = !!gb.targetSceneId && !!findGridBuild(nodes, gb.targetSceneId);
  const id = gb.dirty || !built ? buildFromGridBuilder(false, { quiet: true }) : gb.targetSceneId;
  finishBuilder(() => useGridBuilder.getState().close(), gridSceneBuildIds(id));
}

// ── The jump to Grid Rules and back ───────────────────────────────────────────

/** The Grid Rules node made from the scene `sceneId`, if any. */
export const simulationOf = (nodes: readonly GraphNode[], sceneId: string) => nodes.find(nd => nd.type === 'gridRules' && nd.params[FROM_GRID_KEY] === sceneId);

/**
 * The graph with a Grid Rules simulation started from the Grid scene `sceneId`: its shapes (white
 * inside, through a Pass) as the Start image, the Output on the simulation. Reuses the one made
 * before. Pure.
 */
export function simulationFromGrid(graph: GraphNode[], sceneId: string, nextId: () => string): { nodes: GraphNode[]; gridRulesId: string } | null {
  const b = findGridBuild(graph, sceneId);
  const grid = b?.byRole.get('grid');
  if (!b || !grid) return null;
  const anchor = [...b.byRole.values()].reduce((m, x) => (x.position.x > m.position.x ? x : m), grid);
  const x0 = anchor.position.x + 480, y0 = anchor.position.y + 260;
  let nodes = graph;
  let rules = simulationOf(nodes, sceneId);
  if (!rules) {
    const startId = nextId(), passId = nextId(), rulesId = nextId();
    const start = n('exprNode', startId, x0, y0, {
      label: 'Start cells', outputType: 'vec3', lines: [], result: 'vec3(1.0 - step(0.0, d))', expr: 'vec3(1.0 - step(0.0, d))',
      inputs: [{ name: 'd', type: 'float', slider: null }],
      __comment: 'The grid\'s shapes as a start for the simulation: white inside a shape (its distance below 0), black elsewhere. Made by the Grid builder\'s “Make it a simulation”.',
    }, {}, {
      inputs: { d: { type: 'float', label: 'd', connection: { nodeId: grid.id, outputKey: 'd' } } },
      outputs: { result: { type: 'vec3', label: 'Result' } },
    });
    const pass = n('pass', passId, x0 + 440, y0, { scale: '0.125', filter: 'nearest', label: 'Start cells', __comment: 'Holds the start cells as a texture at the board\'s size, for Grid Rules\' Start image.' }, { color: [startId, 'result'] });
    const gr = n('gridRules', rulesId, x0 + 880, y0, {
      ...presetPatch(COUNT_PRESETS.life), ...LOOKS.count, start: 'image', board: '0.125', label: 'Grid Rules (from the grid)', [FROM_GRID_KEY]: sceneId,
      __comment: 'Grid Rules started from the Grid builder\'s drawing: its Start image is the grid\'s shapes (bright cells start on). Change the rule in its editor; “‹ Pattern grid” in the editor goes back to the drawing. Reset re-deals the board from the drawing as it is now.',
    }, { image: [passId, 'texture'] });
    nodes = [...nodes, start, pass, gr];
    rules = gr;
  } else {
    // Make sure it still starts from the drawing.
    const id = rules.id;
    nodes = nodes.map(nd => (nd.id === id ? { ...nd, params: { ...nd.params, start: 'image', reset: 0 } } : nd));
  }
  const rid = rules.id;
  const out = nodes.find(nd => (nd.type === 'output' || nd.type === 'vec4Output') && nd.inputs.color);
  if (out) nodes = nodes.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: rid, outputKey: 'color' } } } } : nd));
  return { nodes, gridRulesId: rid };
}

/** "Make it a simulation → Grid Rules": build the drawing (if it changed), add or reuse the simulation, open its editor. */
export function makeSimulation(): string | null {
  const sceneId = buildFromGridBuilder(false, { quiet: true, keepOutput: true });
  const st = useNodeGraphStore.getState();
  const r = simulationFromGrid(st.nodes, sceneId, () => useNodeGraphStore.getState().newNodeId());
  if (!r) return null;
  useNodeGraphStore.getState().setNodesRewritten(r.nodes, 'Grid builder: made it a simulation');
  useGridBuilder.getState().close();
  useNodeGraphStore.getState().focusNode(r.gridRulesId);
  openGridRulesEditor(r.gridRulesId);
  toast.success('Now a simulation', { message: 'Grid Rules starts from your drawing (Life). Pick another rule here; “‹ Pattern grid” goes back to the drawing.' });
  return r.gridRulesId;
}

/** The Grid scene a Grid Rules node was made from, if it is still there. */
export function gridSceneOfSimulation(nodes: readonly GraphNode[], gridRulesId: string): string | null {
  const gr = nodes.find(nd => nd.id === gridRulesId);
  const from = gr?.params[FROM_GRID_KEY];
  return typeof from === 'string' && findGridBuild(nodes, from) ? from : null;
}

/** "‹ Pattern grid" from the Grid Rules editor: the Output back on the drawing, and the Grid builder on it. */
export function backToGridScene(gridRulesId: string): boolean {
  const nodes = useNodeGraphStore.getState().nodes;
  const sceneId = gridSceneOfSimulation(nodes, gridRulesId);
  const final = sceneId ? gridFinalOf(nodes, sceneId) : null;
  if (!sceneId || !final) return false;
  const out = nodes.find(nd => (nd.type === 'output' || nd.type === 'vec4Output') && nd.inputs.color);
  if (out) {
    useNodeGraphStore.getState().setNodesRewritten(nodes.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { ...final } } } } : nd)), 'Grid builder: back to the pattern grid');
  }
  closeGridRulesEditor();
  return editGridSceneInBuilder(sceneId);
}
