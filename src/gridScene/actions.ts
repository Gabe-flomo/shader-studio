/**
 * actions.ts — the Grid builder joined to the graph (docs/grid-builder.md): open it on a new scene
 * or on a build already there, Build / Done, and the jump to Grid Rules and back.
 *
 * "Make it a simulation" turns the drawn grid into a Grid Rules drawn start (Start: Your drawing,
 * `startCells`: each drawn shape the state picked for it, 1 unless set, 0 left out), so the
 * simulation and the Grid Rules builder's try board both start from the drawing. The Grid Rules node
 * remembers the scene (`_gridSceneFrom`), so its editor offers the way back, and a second jump
 * reuses it instead of adding another.
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { toast } from '../components/ui/toastStore';
import { n } from '../store/graphBuilder';
import { COUNT_PRESETS, LOOKS, STAGES_PRESETS, presetPatch } from '../gridRules/spec';
import { doneBuilding, type BuildingBuilder } from '../builders/finish';
import { clearDraft, hasUnbuiltEdits, reopenDraft } from '../builders/drafts';
import { closeGridRulesEditor, openGridRulesEditor } from '../builders/windows';
import { useGridBuilder } from './store';
import { applyGridScene, findGridBuild, gridFinalOf, gridSceneOfBuild } from './apply';
import { shownCells, simStateOf, starterGridScene, type GridSceneSpec } from './spec';
import { startCellsFromGrid, type StartCells } from '../gridRules/startCells';

/** On a Grid Rules node made by the jump: the Grid scene (its UV node) it started from. */
export const FROM_GRID_KEY = '_gridSceneFrom';

/** Open the builder on a new scene (Build or Done adds it). */
export function openNewGridScene(at?: { x: number; y: number }): void {
  const fresh = () => useGridBuilder.getState().openWith(starterGridScene(), { at: at ?? null });
  // A new grid left unbuilt last time comes back (builders/drafts.ts).
  if (reopenDraft({ kind: 'grid', store: useGridBuilder, target: null, original: starterGridScene(), label: 'grid scene', startFresh: fresh,
    open: (spec, was) => useGridBuilder.getState().openWith(spec, { at: at ?? was }) })) return;
  fresh();
}

/** Open the builder on the Grid scene `nodeId` belongs to. False when it isn't one. */
export function editGridSceneInBuilder(nodeId: string): boolean {
  const nodes = useNodeGraphStore.getState().nodes;
  const sceneId = gridSceneOfBuild(nodes, nodeId);
  const found = sceneId ? findGridBuild(nodes, sceneId) : null;
  if (!found) return false;
  const asBuilt = () => useGridBuilder.getState().openWith(found.meta.spec, { targetSceneId: sceneId });
  // Edits to this grid left unbuilt last time come back (builders/drafts.ts).
  if (!reopenDraft({ kind: 'grid', store: useGridBuilder, target: sceneId, original: found.meta.spec, label: 'grid scene', startFresh: asBuilt,
    open: spec => useGridBuilder.getState().openWith(spec, { targetSceneId: sceneId }) })) asBuilt();
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
  if (JSON.stringify(result.spec.textures ?? []) !== JSON.stringify(gb.spec.textures ?? [])) useGridBuilder.setState(s => ({ spec: { ...s.spec, textures: result.spec.textures } }));
  gb.markBuilt();
  if (!o.quiet) {
    const notes = [...(result.kept ? [`Kept ${result.kept} setting${result.kept === 1 ? '' : 's'} you changed on the nodes.`] : []), ...result.warnings];
    (result.warnings.length ? toast.warning : toast.success)(fresh ? 'Grid scene built' : 'Grid scene rebuilt', {
      message: notes.length ? notes.join(' ') : 'Every node has a note. Open the Scene builder to draw on it again.',
    });
  }
  return result.sceneId;
}

/** Whether Done has to build: not built yet (or its build is gone), or changed since. */
function needsGridBuild(): boolean {
  const gb = useGridBuilder.getState();
  const built = !!gb.targetSceneId && !!findGridBuild(useNodeGraphStore.getState().nodes, gb.targetSceneId);
  return gb.dirty || !built;
}

/**
 * The Grid builder as builders/finish.ts drives it: Done builds (or rebuilds, same ids) and then
 * closes, a failed build stays open; ✕ and Esc ask about unbuilt edits.
 */
export const gridSceneBuilder: BuildingBuilder = {
  label: 'grid scene',
  needsBuild: needsGridBuild,
  unbuiltEdits: () => hasUnbuiltEdits(useGridBuilder.getState()) && needsGridBuild(),
  build: () => buildFromGridBuilder(false, { quiet: true }),
  close: () => useGridBuilder.getState().close(),
  ids: () => gridSceneBuildIds(useGridBuilder.getState().targetSceneId),
  discard: () => clearDraft('grid', useGridBuilder.getState().targetSceneId),
};

/** Done: build what isn't built yet, close, and frame it on the graph. A failed build stays open. */
export function finishGridBuilder(): Promise<boolean> {
  return doneBuilding(gridSceneBuilder);
}

// ── The jump to Grid Rules and back ───────────────────────────────────────────

/** The Grid Rules node made from the scene `sceneId`, if any. */
export const simulationOf = (nodes: readonly GraphNode[], sceneId: string) => nodes.find(nd => nd.type === 'gridRules' && nd.params[FROM_GRID_KEY] === sceneId);

/**
 * The drawing as a Grid Rules drawn start, rows top first: each drawn shape the state picked for it
 * ("Make it a simulation": `spec.simStates`, 1 unless set; 0 leaves the shape out). Null when
 * nothing is left. Pure.
 */
export function drawnStartOf(spec: GridSceneSpec): StartCells | null {
  const grid = Array.from({ length: spec.rows }, () => Array.from({ length: spec.cols }, () => 0));
  // What the grid shows (after the draw mode: repeat, mirror and rotate copies count too).
  shownCells(spec).forEach((id, i) => { if (id) grid[Math.floor(i / spec.cols)][i % spec.cols] = simStateOf(spec, id); });
  return startCellsFromGrid(grid);
}

/**
 * The rules the jump can start the simulation with ("count:life", "stages:briansBrain"): Grid
 * Rules' Count and Stages presets, which read the drawn states (Stages: 1 alive, 2… dying).
 */
export const SIM_RULES: Array<{ key: string; label: string; hint: string; group: string }> = [
  ...Object.entries(COUNT_PRESETS).map(([k, pr]) => ({ key: `count:${k}`, label: pr.label, hint: pr.hint, group: 'Count' })),
  ...Object.entries(STAGES_PRESETS).map(([k, pr]) => ({ key: `stages:${k}`, label: pr.label, hint: pr.hint, group: 'Stages' })),
];
/** A rule key's params for the Grid Rules node (its type, preset and look), or null when unknown. */
export function simRulePatch(key: string | null | undefined): Record<string, unknown> | null {
  const [type, k] = (key ?? '').split(':');
  if (type === 'count' && COUNT_PRESETS[k]) return { ruleType: 'count', ...presetPatch(COUNT_PRESETS[k]), ...LOOKS.count };
  if (type === 'stages' && STAGES_PRESETS[k]) return { ruleType: 'stages', ...presetPatch(STAGES_PRESETS[k]) };
  return null;
}

/**
 * The graph with a Grid Rules simulation started from the Grid scene `sceneId`: its drawn shapes as
 * the node's drawn start (Start: Your drawing, each shape a live cell, placed in the middle of the
 * board whatever its size), the Output on the simulation. Reuses the one made before and updates
 * its drawing; a node made by an older jump (a Start image through a Pass) keeps that wiring and
 * switches to the drawn start. Pure.
 */
export function simulationFromGrid(graph: GraphNode[], sceneId: string, nextId: () => string, o: { rule?: string | null } = {}): { nodes: GraphNode[]; gridRulesId: string } | null {
  const b = findGridBuild(graph, sceneId);
  const grid = b?.byRole.get('grid');
  if (!b || !grid) return null;
  const anchor = [...b.byRole.values()].reduce((m, x) => (x.position.x > m.position.x ? x : m), grid);
  const x0 = anchor.position.x + 480, y0 = anchor.position.y + 260;
  const drawn = drawnStartOf(b.meta.spec);
  let nodes = graph;
  let rules = simulationOf(nodes, sceneId);
  if (!rules) {
    const rulesId = nextId();
    const gr = n('gridRules', rulesId, x0, y0, {
      ...(simRulePatch(o.rule) ?? { ...presetPatch(COUNT_PRESETS.life), ...LOOKS.count }), board: '0.125', label: 'Grid Rules (from the grid)', [FROM_GRID_KEY]: sceneId,
      ...(drawn ? { start: 'cells', startCells: drawn } : {}),
      __comment: 'Grid Rules started from the Grid builder\'s drawing: each drawn shape is a live cell of its drawn start (Start: Your drawing), placed in the middle of the board. Change the rule in its editor; “‹ Pattern grid” in the editor goes back to the drawing. Reset re-deals the board from the drawing as it was when you jumped.',
    }, {});
    nodes = [...nodes, gr];
    rules = gr;
  } else {
    // Update the drawing it starts from (and switch an older image-start node over to it).
    const id = rules.id;
    nodes = nodes.map(nd => {
      if (nd.id !== id) return nd;
      // A rule picked for this jump replaces the one it has; otherwise its rule stays.
      const params: Record<string, unknown> = { ...nd.params, ...(simRulePatch(o.rule) ?? {}), reset: 0 };
      if (drawn) { params.start = 'cells'; params.startCells = drawn; } else delete params.startCells;
      return { ...nd, params };
    });
  }
  const rid = rules.id;
  const out = nodes.find(nd => (nd.type === 'output' || nd.type === 'vec4Output') && nd.inputs.color);
  if (out) nodes = nodes.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: rid, outputKey: 'color' } } } } : nd));
  return { nodes, gridRulesId: rid };
}

/**
 * "Make it a simulation → Grid Rules": build the drawing (if it changed), add or reuse the
 * simulation, open its editor. `rule`: a SIM_RULES key to start it with (a new one starts as Life;
 * one made before keeps its rule unless one is given).
 */
export function makeSimulation(o: { rule?: string | null } = {}): string | null {
  const sceneId = buildFromGridBuilder(false, { quiet: true, keepOutput: true });
  const st = useNodeGraphStore.getState();
  const r = simulationFromGrid(st.nodes, sceneId, () => useNodeGraphStore.getState().newNodeId(), o);
  if (!r) return null;
  useNodeGraphStore.getState().setNodesRewritten(r.nodes, 'Grid builder: made it a simulation');
  useGridBuilder.getState().close();
  useNodeGraphStore.getState().focusNode(r.gridRulesId);
  openGridRulesEditor(r.gridRulesId);
  toast.success('Now a simulation', { message: 'Grid Rules starts from your drawing, each shape as the state you picked. Change the rule here; “‹ Pattern grid” goes back to the drawing.' });
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
