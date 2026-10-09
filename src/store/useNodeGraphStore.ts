import { isPlayfile } from '../playfile/reader';
import { recordActivity } from '../files/activity';
import { CONTAINER_ACCEPT } from '../playfile/format';
import { requireFeature } from '../lib/plan';
import { create } from 'zustand';
import type { GraphNode, InputSocket, OutputSocket, DataType } from '../types/nodeGraph';
import { VECTORIZABLE_NODES, swizzleTypes } from '../nodes/definitions/math';
import { migrateNodeParams, GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { LAYOUT_VERSION, needsLayoutSpread, spreadLegacyLayout } from './legacyLayout';
import { askText } from '../components/ui/dialogStore';
import { toast } from '../components/ui/toastStore';
import { LIGHTING_CATEGORY, MARCH_GROUP_TYPES, planSceneGroupAdd, planSmart3DAdd } from '../nodes/smart3d';
import { TIME_CUBE_AUTO_TYPES, planTimeCubeAdd } from '../lib/timeCube/autoWire';
import { addToScene, buildSceneSubgraphFor, camerasToWiden, rigSettingsFor, sceneRole, targetScene } from '../nodes/scene3dShapes';
import { VOLUMETRIC_LOOP_TYPES, volumetricOff, volumetricOn } from '../nodes/volumetricAuto';
import { askChoice } from '../components/ui/dialogStore';
import { buildAgentsSubgraph, buildMarchRig, buildMarchSubgraph, buildSceneSubgraph, buildVolumetricRig, graphOutput, instantiateNode, twoDNodesBefore3D } from '../nodes/scene3dDefaults';
import { agentEyeNodes, hasAgentsNode } from '../compiler/agentGraph';
import { hasPassNode } from '../compiler/passGraph';
import { hasHiddenBlur } from '../compiler/blurPasses';
import { agentPreset } from './agentExamples';
import { addAgentPieceTo, agentStarter, freshIds, placeInFreeSpace, startRuleIn, type AgentPiece, type AgentRuleStart } from './agentSetup';
import { rulesStarter } from '../agentRules/starter';
import { agents3dStarter, remapMarks } from '../agentRules/space3d';
import { particlesAsNodes } from './particlesAsNodes';
import { openGridRulesInGraph } from './gridRulesAsNodes';
import { openNewSceneBuilder } from '../sceneBuilder/store';
import { applyRecipe, LIGHT_SCENE_TYPES, placeNear, recipesFor } from '../nodes/recipes';
import { convertMarchLoop, type MarchLoopType } from '../nodes/convertMarchLoop';
import { upgradeBloom } from '../nodes/upgradeBloom';
import { runDoPlan as runDoPlanPure, type DoPlan } from '../suggestions/doBar';
import { execCommand, type CommandPlan } from '../suggestions/doCommands';
import { applyMove, moveById, learnGraph, learnSaved, recordWireBetween, textSignature } from '../suggestions';
import { closeRecipeOffer, noteNodeAdded } from './recipeOfferStore';
import { AGENT_INSIDE_TYPES, AGENT_OUTSIDE_TYPES, AGENT_PRESET_TYPES, syncAgentSpaces } from '../nodes/definitions/agents';
import { randomizedParams, weightKey } from '../nodes/randomizeParams';
import { getRandomizeOptions } from '../nodes/randomizeOptions';
import { upgradeLegacyNode } from './legacyLabels';
import { emptyPlayRecord, isPlayRecordEmpty, parsePlayRecord, usesHands, type PlayRecord, type PlayControl } from '../types/play';
import { tidyGroups } from '../types/layerGroups';
import { isDatasetsEmpty, parseDatasetsRecord, type Dataset, type DatasetsRecord } from '../data/types';
import { datasetStore } from '../data/datasetStore';
import { retypeDataNode } from '../nodes/definitions/data';
import { migratePlayRecord } from './migratePlay';
import { clearLegacyColumnsWire } from '../nodes/definitions/gridColumns';
import { playEngine } from '../lib/playEngine';
import { bakeControlValues, bakeLayerValues } from '../play/playControls';
import { TRACK_LIMIT, buildPlayHtml, type EmbedOptions, type PlayHtmlInput, type PlayMedia, type PlayMediaFile } from '../play/exportHtml';
import type { CpSaved } from '../play/kit/clipPlay.js';
import { bakeFor } from '../types/playTracking';
import { bakeBase64 } from '../lib/trackBakes';
import { loadThreeSource, playUses3D } from '../play/threeSource';
import { webInputFrom } from '../play/webInput';
import { queueGraphsForWeb } from '../play/queueGraphs';
import { imageDataUrl, mediaSource } from '../lib/mediaSources';
import { audioUniformNamesByNode } from '../compiler/audioUniformNames';

/** Top-level `kind` a play file carries, so importing one opens the Play page. */
export const PLAY_FILE_KIND = 'shader-studio-play';

/** A loaded graph brought a Play setup with it: say so, with a way straight to it. */
/**
 * SDF Glow's Tint only colours its Tinted output. When someone picks a tint on a glow whose
 * plain Glow output (a brightness) is what feeds a colour input, say so once, with a fix.
 */
const tintNudged = new Set<string>();
function suggestTintedOutput(nodeId: string): void {
  const s = useNodeGraphStore.getState();
  const node = s.nodes.find(n => n.id === nodeId);
  if (!node || node.type !== 'light' || tintNudged.has(nodeId)) return;
  const users = s.nodes.flatMap(n => Object.entries(n.inputs)
    .filter(([, inp]) => inp.connection?.nodeId === nodeId)
    .map(([key, inp]) => ({ target: n.id, key, out: inp.connection!.outputKey, type: inp.type })));
  if (users.some(u => u.out === 'tinted')) return;
  const plain = users.filter(u => u.out === 'glow' && u.type === 'vec3');
  if (!plain.length) return;
  tintNudged.add(nodeId);
  toast.info('Tint colours the Tinted output', {
    message: 'This SDF Glow sends its plain Glow output (brightness only) into a colour, so the tint has nowhere to go.',
    action: { label: 'Use Tinted', onClick: () => { for (const u of plain) useNodeGraphStore.getState().connectNodes(nodeId, 'tinted', u.target, u.key); } },
  });
}

/** The title of the "open Play" notice; the app clears it while the Play page is open. */
export const PLAY_SETUP_TOAST = 'This graph has a Play setup';

/** The `datasets` key of a saved graph: left out when there are none. */
function datasetsField(datasets: DatasetsRecord): { datasets?: DatasetsRecord } {
  return isDatasetsEmpty(datasets) ? {} : { datasets };
}

/** A graph was opened (a saved one, or an example): the linked-presentation watcher (App) hears it. */
export const GRAPH_OPENED = 'graph-opened';
export type GraphOpened = { kind: 'saved'; name: string } | { kind: 'example'; key: string };
function announceGraphOpened(detail: GraphOpened): void {
  try { window.dispatchEvent(new CustomEvent<GraphOpened>(GRAPH_OPENED, { detail })); } catch { /* no window in tests */ }
}

function announcePlay(play: PlayRecord, openPlay: () => void): void {
  if (isPlayRecordEmpty(play)) return;
  const c = play.controls.length, m = play.mappings.length;
  toast.info(PLAY_SETUP_TOAST, {
    message: `${c} control${c === 1 ? '' : 's'} · ${m} mapping${m === 1 ? '' : 's'}`,
    action: { label: 'Open Play', onClick: openPlay },
  });
}

/**
 * An example's pictures (ExampleGraph.images) into its nodes' image slots, as the card's
 * Load image does: the texture, and the thumbnail on the card. Dropped if another graph
 * opened meanwhile; the example stays unsaved and clean.
 */
async function attachExampleImages(images: Record<string, string>, epoch: number): Promise<void> {
  for (const [key, src] of Object.entries(images)) {
    try {
      const blob = await (await fetch(src)).blob();
      const { texture, thumbnailDataUrl, imageAspect } = await loadImageTextureFromFile(new File([blob], key, { type: blob.type }));
      const st = useNodeGraphStore.getState();
      if (st.graphEpoch !== epoch) { texture.dispose(); return; }
      st.setNodeTexture(key, texture);
      const [nodeId, slot] = key.split('::');
      const dirty = st.graphDirty;
      // A key without a slot is a Texture Input's picture (Passes 8): its card's thumbnail, as its Load image sets it.
      const thumb = slot ? { [`__tex_${slot}_thumb`]: thumbnailDataUrl } : { _thumbnailUrl: thumbnailDataUrl, _imageAspect: imageAspect };
      useNodeGraphStore.setState(s => ({ nodes: s.nodes.map(n => (n.id === nodeId ? { ...n, params: { ...n.params, ...thumb } } : n)) }));
      useNodeGraphStore.setState({ graphDirty: dirty });
    } catch (e) {
      console.error('[loadExampleGraph] could not load an example picture', e);
    }
  }
}
import type { CustomFnPreset, CustomFnPresetExport } from '../types/customFnPreset';
import type { ExprPreset } from '../types/exprPreset';
import type { TransformPreset } from '../types/transformPreset';
import type { GroupPreset } from '../types/groupPreset';
import type { SubgraphData } from '../types/nodeGraph';
import { buildUserNodeDefinition, CODE_RETURN_PORT, type PublishUserNodeSpec, type PublishSource } from '../nodes/userNodes/publishUserNode';
import { USER_NODE_DEFAULT_CATEGORY } from '../types/userNode';
import { registerUserNode, unregisterUserNode, getUserNode, exportUserNodes, importUserNodes, recompileUserNodes, containsSealedCode } from '../nodes/userNodes/userNodeRegistry';
import { sealDefinition } from '../playfile/sealing';
import { runRebuildHandlers } from '../lib/rebuild';
import type { KeyframePreset } from '../types/keyframePreset';
import { bakedInfo } from '../nodes/definitions/baked';
import { getNodeDefinition, getNodeDefinitionFor, resolveNodeAliases, resolveSubgraphAliases, NODE_ALIASES, aliasParams, clearNodeDefinitionCache } from '../nodes/definitions';
import { paletteNodeCoeffs, STOP_PALETTE_MAX } from '../nodes/definitions/color';
import { autoFitCosineStops, fitCosineStops } from '../lib/palette';
import { compileGraph } from '../compiler/graphCompiler';
import { recordGraphCompile } from '../lib/perfStats';
import { convertFragmentShader } from '../nodes/userNodes/glslImport';
import { paramBindingKey } from '../compiler/uniformPatcher';
import { saveTextFile, openTextFile, openBinaryFile, pickJsonFiles, readJsonFilesFromDir, writeTextFileAtPath, deleteFileAtPath, safeSetItem, errorMessage, CANCELLED } from '../utils/fileIO';
import { planGraphImport, type PreviewAspect } from '../utils/graphImportPlan';
import { loadFolders, createFolder, moveItemsToFolder } from '../utils/assetFolders';
import type { FileResult } from '../utils/fileIO';
import { BLANK_GRAPH, DEFAULT_EXAMPLE, loadExampleGraphs } from './exampleIndex';
import { loadImageTextureFromFile } from '../lib/loadImageTexture';
import { archiveCurrent, deleteHistory, nextNumber, readVersion, replaceVersion, versionMeta, type SaveKind } from './graphVersions';
import type { ExampleGraph } from './exampleIndex';
import { layoutByRank, estimateNodeHeight } from './graphLayout';
import { arrangeByStage } from '../structure/arrange';
import { getCardSize } from '../components/NodeGraph/socketRegistry';
import { constantsItems, constantsOutputs, paramKeysOf, paramsFor, type ConstantsItem } from '../nodes/definitions/constants';
import { typesCompatible } from '../lib/typesCompatible';
import { audioEngine } from '../lib/audioEngine';
import { videoEngine } from '../lib/videoEngine';
import { IdGenerator } from './managers/IdGenerator';
import { UndoManager } from './managers/UndoManager';
import { nodeName, nodesPhrase } from './historyLabels';
import { applySwitchToList, groupRuleFor, planSwitch, retargetPlay, type SwitchContext } from '../nodes/switchNode';
import { describePlayChange } from './playHistory';
import { PresetManager } from './managers/PresetManager';
import { CompilationService } from './managers/CompilationService';
import { GRAPH_LINK_FIELD, graphDeleted, linkedPresentationsOf } from '../present/links';
import { pickPreviewOutput, prefOf } from '../lib/nodePreview/showAs';
import { probedNode } from '../lib/nodePreview/lineProbe';

// ── Legacy ExprNode → ExprBlockNode migration ─────────────────────────────────
// ExprNode (type: 'expr') is removed from the registry.  Any saved graph that
// contains 'expr' nodes is upgraded transparently on load.

function _upgradeExprNode(node: GraphNode): GraphNode {
  if (node.type !== 'expr') return node;

  const dynamicInputs: Array<{ name: string; type: string; slider: null }> = [];
  const newInputs: Record<string, InputSocket> = {};

  for (let i = 0; i < 4; i++) {
    const rawName = (node.params[`in${i}Name`] as string) ?? `in${i}`;
    const name = rawName.trim();
    const defaultName = `in${i}`;
    const oldSocket = (node.inputs as Record<string, InputSocket>)[`in${i}`];
    const hasConnection = !!oldSocket?.connection;

    // Skip default-named slots with no connection — they're dead weight
    if (name === defaultName && !hasConnection) continue;

    const socketType = (oldSocket?.type as string) || 'float';
    newInputs[name] = {
      type: socketType as DataType,
      label: `${name} (${socketType})`,
      ...(hasConnection ? { connection: oldSocket!.connection } : {}),
    };
    dynamicInputs.push({ name, type: socketType, slider: null });
  }

  const exprStr = (node.params.expr as string) || '0.0';
  // The output socket has to match outputType, or wiring it compiles a float into a vec3 slot
  const outputType = (node.params.outputType as string) || 'float';
  return {
    ...node,
    type: 'exprNode',
    inputs: newInputs,
    outputs: { result: { type: outputType as DataType, label: `Result (${outputType})` } },
    params: {
      inputs: dynamicInputs,
      outputType,
      lines: [],
      result: exprStr,
      expr: exprStr,
    },
  };
}

/** Recursively upgrades all 'expr' nodes (and renamed socket labels) in a flat node list, including those
 *  nested in subgraph params (groups, SceneGroups, MarchLoopGroups, etc.). */
function upgradeExprNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map(node => {
    let n = upgradeLegacyNode(_upgradeExprNode(node));
    // Recurse into subgraph if present
    if (n.params?.subgraph) {
      const sg = n.params.subgraph as { nodes?: GraphNode[] };
      if (Array.isArray(sg?.nodes)) {
        n = { ...n, params: { ...n.params, subgraph: { ...sg, nodes: upgradeExprNodes(sg.nodes) } } };
      }
    }
    return n;
  });
}

/**
 * Nodes read from storage or an example, brought up to date the way loading
 * does (renamed node types, old Expression nodes, params added since). Used to
 * compile a saved graph off-screen without loading it (Present snapshots).
 */
export function migrateLoadedNodes(nodes: GraphNode[]): GraphNode[] {
  return upgradeExprNodes(resolveNodeAliases(nodes, getNodeDefinition)).map(n => migrateNodeParams(n.params ? n : { ...n, params: {} }, getNodeDefinition));
}

/**
 * A saved graph's Play record brought along with its node migrations (control
 * ranges on a param whose units changed, see store/migratePlay.ts). Takes the
 * nodes as saved, before migrateLoadedNodes.
 */
export function migrateLoadedPlay(play: PlayRecord, savedNodes: GraphNode[]): PlayRecord {
  return migratePlayRecord(play, resolveNodeAliases(savedNodes, getNodeDefinition), getNodeDefinition);
}

/** Convert a label to a filesystem-safe slug. Used by the generic graph-save
 *  feature below; each PresetManager instance has its own copy for presets. */
function labelToSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fn';
}

// ── Custom-fn preset helpers ───────────────────────────────────────────────────
const CFP_PREFIX  = 'shader-studio:cfp:';
const CFP_DIR_KEY  = 'shader-studio:settings:customFnDir';
const EXPR_DIR_KEY = 'shader-studio:settings:exprDir';
const GRAPH_DIR_KEY = 'shader-studio:settings:graphDir';

/** Get the user-configured presets folder path (or '' if not set). */
export function getCustomFnDir(): string {
  return localStorage.getItem(CFP_DIR_KEY) ?? '';
}

/** Persist the presets folder path. */
export function setCustomFnDir(path: string): void {
  if (path) localStorage.setItem(CFP_DIR_KEY, path);
  else localStorage.removeItem(CFP_DIR_KEY);
}

export function getExprDir(): string {
  return localStorage.getItem(EXPR_DIR_KEY) ?? '';
}
export function setExprDir(path: string): void {
  if (path) localStorage.setItem(EXPR_DIR_KEY, path);
  else localStorage.removeItem(EXPR_DIR_KEY);
}

export function getGraphDir(): string {
  return localStorage.getItem(GRAPH_DIR_KEY) ?? '';
}
export function setGraphDir(path: string): void {
  if (path) localStorage.setItem(GRAPH_DIR_KEY, path);
  else localStorage.removeItem(GRAPH_DIR_KEY);
}

const GP_DIR_KEY = 'shader-studio:settings:groupPresetDir';
export function getGroupPresetDir(): string {
  return localStorage.getItem(GP_DIR_KEY) ?? '';
}
export function setGroupPresetDir(path: string): void {
  if (path) localStorage.setItem(GP_DIR_KEY, path);
  else localStorage.removeItem(GP_DIR_KEY);
}

const customFnPresetManager  = new PresetManager<CustomFnPreset>({ localStoragePrefix: CFP_PREFIX, eventName: 'customfn-changed', diskDir: getCustomFnDir });
const exprPresetManager      = new PresetManager<ExprPreset>({ localStoragePrefix: 'shader-studio:ep:', eventName: 'exprpreset-changed', diskDir: getExprDir });
const transformPresetManager = new PresetManager<TransformPreset>({ localStoragePrefix: 'shader-studio:tp:', eventName: 'transformpreset-changed' });
const groupPresetManager     = new PresetManager<GroupPreset>({ localStoragePrefix: 'shader-studio:gp:', diskDir: getGroupPresetDir });
const keyframePresetManager  = new PresetManager<KeyframePreset>({ localStoragePrefix: 'shader-studio:kfp:', eventName: 'keyframepreset-changed' });

/**
 * Directly save a CustomFnPreset from caller-supplied data.
 * Writes to localStorage, optionally to disk, and fires the
 * 'customfn-changed' CustomEvent so NodePalette refreshes.
 */
/** Fired when a saved graph is added or removed, so every list of them (sidebar, top bar) refreshes */
export const SAVED_GRAPHS_CHANGED = 'saved-graphs-changed';

/** A new preset id: the time, and a counter so several saved in one millisecond don't overwrite each other. */
let cfpSeq = 0;
const newCfpId = () => `cfp_${Date.now()}${cfpSeq++ ? `_${cfpSeq}` : ''}`;

export function saveCustomFnPreset(
  data: { label: string; inputs: CustomFnPreset['inputs']; outputType: CustomFnPreset['outputType']; body: string; glslFunctions: string; comment?: string; preview?: CustomFnPreset['preview'] },
): Promise<FileResult> {
  const preset: CustomFnPreset = {
    id: newCfpId(),
    ...(data.preview ? { preview: data.preview } : {}),
    label: data.label || 'Custom Function',
    inputs: data.inputs ?? [],
    outputType: data.outputType ?? 'float',
    body: data.body ?? '0.0',
    glslFunctions: data.glslFunctions ?? '',
    comment: data.comment?.trim() || undefined,
    savedAt: Date.now(),
  };
  return customFnPresetManager.save(preset).then(r => { if (r.ok) recordActivity('save', preset.label); return r; });
}

/** Read all saved custom-fn presets from localStorage. */
export function loadCustomFns(): CustomFnPreset[] {
  return customFnPresetManager.load().sort((a, b) => a.savedAt - b.savedAt);
}

// ── Expr preset helpers ────────────────────────────────────────────────────────

export function saveExprPreset(data: Omit<ExprPreset, 'id' | 'savedAt'>): Promise<FileResult> {
  const preset: ExprPreset = {
    id: `ep_${Date.now()}`,
    ...data,
    savedAt: Date.now(),
  };
  return exprPresetManager.save(preset);
}

export function loadExprPresets(): ExprPreset[] {
  return exprPresetManager.load().sort((a, b) => a.savedAt - b.savedAt);
}

export function deleteExprPreset(id: string): void {
  exprPresetManager.delete(id);
}

export function renameExprPreset(id: string, newLabel: string): void {
  exprPresetManager.rename(id, newLabel);
}

// ── Keyframe preset helpers ─────────────────────────────────────────────────

export function saveKeyframePreset(data: Omit<KeyframePreset, 'id' | 'savedAt'>): Promise<FileResult> {
  const preset: KeyframePreset = {
    id: `kfp_${Date.now()}`,
    ...data,
    savedAt: Date.now(),
  };
  return keyframePresetManager.save(preset);
}

export function loadKeyframePresets(): KeyframePreset[] {
  return keyframePresetManager.load().sort((a, b) => a.savedAt - b.savedAt);
}

export function deleteKeyframePreset(id: string): void {
  keyframePresetManager.delete(id);
}

export function renameKeyframePreset(id: string, newLabel: string): void {
  keyframePresetManager.rename(id, newLabel);
}

// ── Transform Vec preset helpers ──────────────────────────────────────────────

export function saveTransformPreset(data: Omit<TransformPreset, 'id' | 'savedAt'>): Promise<FileResult> {
  const preset: TransformPreset = { id: `tp_${Date.now()}`, ...data, savedAt: Date.now() };
  return transformPresetManager.save(preset);
}

export function loadTransformPresets(): TransformPreset[] {
  return transformPresetManager.load().sort((a, b) => a.savedAt - b.savedAt);
}

export function deleteTransformPreset(id: string): void {
  transformPresetManager.delete(id);
}

export function renameTransformPreset(id: string, newLabel: string): void {
  transformPresetManager.rename(id, newLabel);
}

// ── Group preset helpers ───────────────────────────────────────────────────────

export function loadGroupPresets(): GroupPreset[] {
  return groupPresetManager.load()
    .filter(p => !!p.subgraph)
    // Presets saved before a node merge still reference the old type keys.
    .map(p => ({ ...p, subgraph: resolveSubgraphAliases(p.subgraph, getNodeDefinition) }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** What a new Scene Group or march loop contains, or undefined for any other type. */
function defaultSubgraphFor(type: string): SubgraphData | undefined {
  const nextId = () => idGenerator.next();
  if (type === 'sceneGroup') return buildSceneSubgraph(nextId);
  if (type === 'marchLoopGroup' || type === 'giLitMarchGroup') return buildMarchSubgraph(nextId);
  if (type === 'agentsGroup') return buildAgentsSubgraph(nextId);
  return undefined;
}

/**
 * A Scene Output added to an older Scene Group is wired to the value the group
 * already returned through its legacy `outputNodeId` / `outputKey`, so the
 * picture shows what the scene returns and the render doesn't change.
 */
function legacySceneReturnWire(sg: { nodes: GraphNode[]; outputNodeId?: string; outputKey?: string }): { connection?: { nodeId: string; outputKey: string } } {
  const { outputNodeId, outputKey } = sg;
  if (!outputNodeId || !outputKey || !sg.nodes.some(n => n.id === outputNodeId)) return {};
  return { connection: { nodeId: outputNodeId, outputKey } };
}

/** Set while an add re-runs after the "Adding a 3D scene" question, so it isn't asked twice. */
let skip3DAsk = false;
/** Set while a bare Agents group is added after its "start with" question (Empty group). */
let skipAgentsAsk = false;

/** Would adding `type` at the top level build a new 3D scene (camera, loop and Output takeover)? */
function startsA3DScene(type: string, nodes: GraphNode[]): boolean {
  if (type === 'marchLoopGroup' || type === 'giLitMarchGroup' || type === 'marchCamera' || type === 'volumetricScene') return true;
  const def = getNodeDefinition(type);
  if (!def) return false;
  const plan = type === 'sceneGroup' ? planSceneGroupAdd(nodes, { x: 0, y: 0 }) : planSmart3DAdd(type, def, nodes, { x: 0, y: 0 });
  if (def.category === LIGHTING_CATEGORY && type !== 'glass3d') return !nodes.some(n => MARCH_GROUP_TYPES.has(n.type));
  return plan.kind === 'wrap-scene' && plan.spawnMarch && !(type !== 'sceneGroup' && targetScene(nodes, { x: 0, y: 0 }));
}

/** The loop's Color into the Output node's colour input. */
function wireLoopToOutput(nodes: GraphNode[], outputId: string, loopId: string): GraphNode[] {
  return nodes.map(n => n.id === outputId && n.inputs.color
    ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { nodeId: loopId, outputKey: 'color' } } } }
    : n);
}

// Debounce timer for recompilation triggered by param edits.
// Structure changes (connect/disconnect/add/remove) still compile immediately.
const compilationService = new CompilationService();
// Debounce timer for history pushes during param edits (sliders/text) — we
// push once at the START of an edit burst, not on every keystroke/tick.
let _historyParamTimer: ReturnType<typeof setTimeout> | null = null;
let _historyParamPending = false;

// ── Undo history ──────────────────────────────────────────────────────────────
// Stored outside Zustand state so pushing snapshots never triggers a re-render.
export const undoManager = new UndoManager();

/** How a setPlay call joins the history: not at all, or as a step with this label. */
export type PlayHistoryOption = false | { label?: string };

// A Play value still changing (a slider drag, typing in the notes): the step made by its first
// change is kept and renamed as the value moves, until a second of quiet or a different edit.
let _playBurst: { key: string; entryId: number; timer: ReturnType<typeof setTimeout> } | null = null;
const PLAY_BURST_MS = 1000;
function endPlayBurst(): void {
  if (_playBurst) clearTimeout(_playBurst.timer);
  _playBurst = null;
}
/** One undo step for a Play edit, named from the difference (or `label`); the same value moving again joins the step. */
function recordPlayStep(prev: PlayRecord, next: PlayRecord, history: PlayHistoryOption | undefined): void {
  const change = describePlayChange(prev, next);
  const label = (history && history.label) || change?.label;
  if (!label) { endPlayBurst(); return; }  // nothing worth a step (a rack taking the keyboard)
  const key = history && history.label ? null : change?.key ?? null;
  const top = undoManager.top();
  if (key && _playBurst && _playBurst.key === key && top && top.id === _playBurst.entryId && top.play) {
    // The label reads from the step's own "before", so a drag says where it started: "Radius 0.2 → 0.5".
    undoManager.labelTop({ label: describePlayChange(top.play, next)?.label ?? label });
  } else {
    undoManager.pushPlay(prev, { label });
  }
  endPlayBurst();
  const entry = undoManager.top();
  if (key && entry) _playBurst = { key, entryId: entry.id, timer: setTimeout(() => { _playBurst = null; }, PLAY_BURST_MS) };
}

/** Shallow-deep equality for probe readouts: same output keys, same numbers. */
function probeValuesEqual(a: Record<string, number[]>, b: Record<string, number[]>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    const av = a[k], bv = b[k];
    if (!bv || av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
  }
  return true;
}

/**
 * A Swizzle card's sockets follow its params: the input is its input type, the output as wide as
 * its pattern. A wire into the input that no longer fits is dropped, as the type pills do.
 */
function retypeSwizzle(n: GraphNode): GraphNode {
  // A Data card's sockets follow its settings the same way (mode, output groups).
  if (n.type === 'data') return retypeDataNode(n);
  if (n.type !== 'swizzle') return n;
  const { input, output } = swizzleTypes(n);
  const inp = n.inputs.input, out = n.outputs.output;
  if (inp?.type === input && out?.type === output) return n;
  return {
    ...n,
    inputs: { ...n.inputs, input: { ...(inp ?? { label: 'Input' }), type: input as DataType, connection: inp?.type === input ? inp.connection : undefined } },
    outputs: { ...n.outputs, output: { ...(out ?? { label: 'Output' }), type: output as DataType } },
  };
}

/** What beginScratch keeps aside while a scratch graph is on the canvas. */
export interface ScratchSnapshot {
  nodes: GraphNode[];
  looseGroups: import('../types/nodeGraph').LooseGroup[];
  play: PlayRecord;
  datasets: DatasetsRecord;
  currentGraph: { name: string; version: number; major: number; minor: number; latest: boolean } | null;
  graphDirty: boolean;
  previewNodeId: string | null;
  activeGroupId: string | null;
  activeGroupPath: string[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

interface NodeGraphState {
  // Graph data
  nodes: GraphNode[];
  /** Purely-visual node clusters at the top-level scope — see LooseGroup in types/nodeGraph.ts. */
  looseGroups: import('../types/nodeGraph').LooseGroup[];

  // Compiled shaders
  vertexShader: string;
  fragmentShader: string;
  compilationErrors: string[];
  /**
   * Uniform name → current value for all float params extracted by the compiler.
   * Updated in-place (without recompile) when sliders change eligible float params.
   */
  paramUniforms: Record<string, number | number[]>;
  /** `${nodeId}::${paramKey}` → uniform name, from the last compile. See CompilationResult.paramBindings. */
  paramBindings: Record<string, string>;
  /** Push param uniform value changes to ShaderCanvas without triggering a recompile. */
  updateParamUniforms: (updates: Record<string, number | number[]>) => void;

  /**
   * The graph's Play setup: exposed controls and input mappings (see
   * types/play.ts). Saved with the graph under `play`. Every edit through
   * setPlay is an undo step in the same history as the graph's, named from
   * what changed (store/playHistory.ts); a value that keeps changing (a slider
   * drag) is one step. Pass `history: false` for a write that isn't an edit
   * (the output window's projection, which keeps its own history), or a
   * `label` to name the step yourself.
   */
  play: PlayRecord;
  setPlay: (next: PlayRecord | ((play: PlayRecord) => PlayRecord), history?: PlayHistoryOption) => void;
  /**
   * The graph's datasets (src/data/): imported files, their notebooks and
   * frozen results, read by Data nodes (and later the Data layer). Saved with
   * the graph under `datasets`, next to `play`. Not part of undo, like play.
   */
  datasets: DatasetsRecord;
  /** Add or replace a dataset (by its id). */
  setDataset: (dataset: Dataset) => void;
  /** Change some of a dataset's fields. */
  updateDataset: (id: string, patch: Partial<Omit<Dataset, 'id'>>) => void;
  removeDataset: (id: string) => void;
  /**
   * Save the graph and its Play record as one play file. Controls a
   * mapping is driving right now are written at their live value, so the file
   * opens looking exactly as the picture does at export time.
   */
  exportPlayFile: () => Promise<FileResult>;
  /** The open graph as a readable file: a graph file, or a Play file (live control values baked in). What both exports write. */
  graphFileJson: (asPlay: boolean) => string;
  /**
   * Everything a web export needs, as the picture is right now (driven
   * controls at their live value), and what in the graph it can't run.
   */
  playWebInput: (title: string) => { input: PlayHtmlInput; missing: string[] };
  /** Save a web page (player or background) to a file. See play/exportHtml.ts. */
  /** `hands`: carry hand tracking's files in the page (about 12 MB; play/handExport.ts). */
  exportPlayHtml: (options: EmbedOptions, title: string, extras?: { hands?: boolean }) => Promise<FileResult>;
  /** Bumped when a play file is imported; App switches to the Play page. */
  playOpenRequest: number;
  /** Asks the app to open the Studio centred on a node (a Play control's "go to source"). `n` counts requests. */
  focusNodeRequest: { id: string; n: number } | null;
  focusNode: (id: string) => void;
  /** Does a graph in browser storage carry a Play setup? (For the "Play" tag on its row.) */
  savedGraphHasPlay: (name: string) => boolean;

  // Runtime debug info (set by ShaderCanvas)
  glslErrors: string[];           // WebGL shader compile errors (from Three.js)
  glslErrorSource: string | null; // the source those errors refer to, for mapping them to nodes
  glContextLost: boolean;         // true while the preview's WebGL context is lost (GPU reset / memory pressure)
  pixelSample: [number, number, number, number] | null;  // mouse pixel RGBA 0-255
  hoveredParamHint: string | null;  // param hint shown in status bar on hover
  currentTime: number;            // current u_time uniform value (seconds)
  timePlaying: boolean;           // global play/pause for u_time animation

  // Node probe — click a node to see its live output values in the status bar
  selectedNodeId: string | null;

  /**
   * Multi-select: set of currently selected node IDs.
   * Used for group operations, bulk actions, and visual highlighting.
   * Separate from selectedNodeId (which drives the probe panel).
   */
  selectedNodeIds: string[];
  selectNode: (id: string, addToSelection?: boolean) => void;
  /** Replace the selection with exactly these nodes (e.g. "select all Circle SDFs" from graph stats). */
  selectNodes: (ids: string[]) => void;
  deselectAll: () => void;

  /** Maps nodeId → { outputKey → glslVarName }, updated on every compile */
  nodeOutputVarMap: Map<string, Record<string, string>>;
  /** Live-sampled values for the selected node: outputKey → number[] (1–4 components) */
  nodeProbeValues: Record<string, number[]> | null;
  /** Frame stats of the isolated preview (clipped / black / flat), for the explaining caption */
  previewStats: import('../lib/previewExplain').PreviewStats | null;
  setPreviewStats: (stats: import('../lib/previewExplain').PreviewStats | null) => void;
  setSelectedNodeId: (id: string | null) => void;
  /** Open `groupPath` (group ids from the current level inward), select `nodeId` there and ask the canvas to centre on it. */
  revealNode: (groupPath: string[], nodeId: string) => void;
  /** Set by revealNode; NodeGraph centres on the node once it is on screen, then clears it. */
  focusRequest: { nodeId: string; seq: number } | null;
  clearFocusRequest: () => void;
  /**
   * Wires that were removed or replaced this session, newest first. A node's
   * right-click menu offers them back as "Reconnect …" — a per-node memory,
   * unlike undo, which rewinds everything since. Not saved with the graph.
   */
  wireHistory: WireMemory[];
  /** Past wires touching `nodeId` that could be restored: both ends still exist in `scope` and the wire is not currently present. */
  pastWiresFor: (nodeId: string, scope: GraphNode[]) => WireMemory[];
  /** After a node is added from search, NodeGraph opens Smart connect on its first output */
  smartConnectRequest: { nodeId: string; at: number } | null;
  requestSmartConnect: (nodeId: string | null) => void;
  setNodeProbeValues: (values: Record<string, number[]> | null) => void;
  /** Live-sampled normalized [0,1] values for all scope nodes: nodeId → number */
  scopeProbeValues: Record<string, number>;
  setScopeProbeValues: (vals: Record<string, number>) => void;

  // Preview mode — isolates a single node's output for focused editing
  previewNodeId: string | null;
  /**
   * While a bake renders (lib/bake/runner.ts): the graph it renders, compiled
   * in place of the open graph (and the eye's preview) until it's set back to
   * null. The open graph's nodes are untouched.
   */
  bakeGraph: GraphNode[] | null;
  setBakeGraph: (nodes: GraphNode[] | null) => void;
  /** A fresh node id (for nodes built outside the store's own actions, e.g. a Baked node). */
  newNodeId: () => string;

  // Mobile keyframe editor — cross-cutting UI state, not graph data. Read
  // and written by two siblings in the mobile layout: MobileGraphBrowser
  // (renders the canvas editor in place of the node's card content when
  // this is set) and App.tsx's bottom action bar (renders the Select/Add/
  // Delete/Draw tool buttons when this is set) — hence living here rather
  // than as local state either component would have to lift.
  mobileKeyframeEditor: { nodeId: string; socketKey: string; axis?: string } | null;
  setMobileKeyframeEditor: (target: { nodeId: string; socketKey: string; axis?: string } | null) => void;
  mobileKeyframeTool: 'select' | 'add' | 'delete' | 'draw';
  setMobileKeyframeTool: (tool: 'select' | 'add' | 'delete' | 'draw') => void;

  // Read-only node-graph overlay floated on top of the shader canvas
  // (mobile) — real desktop-style node cards at their actual positions,
  // not the drill-down browser's abstract rank grid. Written by App.tsx's
  // toggle button next to the play/pause controls, read by
  // MobileGraphBrowser's overlay component — same cross-component
  // rationale as mobileKeyframeEditor above.
  mobileNodeOverlayOpen: boolean;
  setMobileNodeOverlayOpen: (open: boolean) => void;

  // Node highlight filter — set by keyboard shortcuts to visually dim non-matching nodes.
  // null = no filter (all nodes normal). 'all' = clear any filter.
  nodeHighlightFilter: string | null;  // e.g. 'float', 'vec2', 'vec3', 'uv-in', 'uv-out'
  setNodeHighlightFilter: (filter: string | null) => void;

  // Fit-view callback — registered by NodeGraph so App/shortcuts can trigger it
  _fitViewCallback: (() => void) | null;
  registerFitView: (cb: () => void) => void;
  _viewportCenterGetter: (() => { x: number; y: number }) | null;
  registerViewportCenterGetter: (cb: () => { x: number; y: number }) => void;
  /** Move the canvas: `pan` in screen px, `zoom` clamped to the canvas's range. Registered by NodeGraph. */
  _setViewCallback: ((pan: { x: number; y: number }, zoom: number) => void) | null;
  registerSetView: (cb: (pan: { x: number; y: number }, zoom: number) => void) => void;

  // Swap mode — user shift-clicked a node; next palette click replaces it
  swapTargetNodeId: string | null;
  setSwapTargetNodeId: (id: string | null) => void;
  /** Switch a node to another type in place (same id): wires mapped, settings, keyframes and Play controls kept (nodes/switchNode.ts). One undo step. */
  swapNode: (nodeId: string, newType: string) => { ok: boolean; keptWires: number } | undefined;

  // In-canvas node search palette (Shift+Space)
  searchPaletteOpen: boolean;
  setSearchPaletteOpen: (open: boolean) => void;

  // Group drill-down — when set, NodeGraph renders this group's subgraph instead
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  activeGroupPath: string[];
  enterGroup: (id: string) => void;
  exitGroup: () => void;
  exitToRoot: () => void;
  exitToDepth: (depth: number) => void;
  duplicateGroup: (groupId: string) => string | null;
  duplicateNode: (nodeId: string) => string | null;
  duplicateNodes: (nodeIds: string[]) => void;
  /** The Volumetric switch on a march loop: on builds Scene Distance → Volume Glow (+=) → Glow to Color; off removes them (nodeGraph/volumetricAuto.ts). One undo step. */
  setLoopVolumetric: (nodeId: string, on: boolean) => void;
  /**
   * Open as nodes (Particles node, docs/agents-plan.md §11): an Agents-group copy of a top-level
   * Particles node's settings, placed under it; what read the node reads the copy's Draw agents
   * instead. The original is left as it was. Returns the new group's id (null if it can't).
   */
  openParticlesAsNodes: (nodeId: string) => string | null;
  /** Open as nodes (Grid Rules, docs/grid-rules.md): the same simulation from ordinary nodes, under it (store/gridRulesAsNodes.ts). Returns the new board Pass's id. */
  openGridRulesAsNodes: (nodeId: string) => string | null;

  // Texture inputs — maps nodeId → loaded THREE.Texture (or null if not yet loaded)
  // Populated by NodeComponent file picker; consumed by ShaderCanvas to bind sampler2D uniforms.
  nodeTextures: Record<string, import('three').Texture | null>;
  setNodeTexture: (nodeId: string, texture: import('three').Texture | null) => void;
  // textureUniforms from last compilation: uniformName → nodeId
  textureUniforms: Record<string, string>;
  // audioUniforms from last compilation: uniformName → nodeId
  audioUniforms: Record<string, string>;
  // liveUniforms from last compilation: uniformName → `${nodeId}::${channel}` (input bus)
  liveUniforms: Record<string, string>;
  // Video inputs — maps nodeId → VideoTexture (or null)
  videoTextures: Record<string, import('three').VideoTexture | null>;
  setVideoTexture: (nodeId: string, texture: import('three').VideoTexture | null) => void;
  // videoUniforms from last compilation: uniformName → nodeId
  videoUniforms: Record<string, string>;
  // Master audio playback volume (0–1)
  audioMasterVolume: number;
  setAudioMasterVolume: (v: number) => void;

  // Per-node preview thumbnails — nodeId → data URL (jpeg)
  nodePreviews: Record<string, string>;
  setNodePreview: (nodeId: string, dataUrl: string) => void;

  // Stateful rendering — true when a PrevFrame node exists in the graph
  isStateful: boolean;
  /** Echo nodes present: snapshot ring the preview must keep (see nodes/definitions/echo.ts). */
  echoConfig: { copies: number; delay: number } | null;
  /** Pass nodes' programs, in drawing order (compiler/passGraph.ts); null when the graph has no Pass node. */
  passes: import('../compiler/types').PassProgram[] | null;
  /** The Agents family's programs from the last compile (compiler/agentGraph.ts); null without one. */
  agents: import('../compiler/types').AgentsSpec | null;
  /** With passes or agents: the nodes compiled into the final picture (Show passes). */
  finalNodeIds: string[] | null;
  /**
   * Show passes' view of the whole graph: its programs (lib/programTints.ts). The compile's own while
   * nothing is previewed; while the eye previews a node, the whole graph's (the preview compiles only
   * what that node needs), so the toggle and the tints stay as they were. Null for a one-program graph.
   */
  programMap: { passes: import('../compiler/types').PassProgram[] | null; agents: import('../compiler/types').AgentsSpec | null; finalNodeIds: string[] | null } | null;
  /** Show passes: tint each card by the program it runs in (lib/programTints.ts). */
  showPasses: boolean;
  setShowPasses: (on: boolean) => void;

  /** Maps nodeId → GLSL slug, e.g. "node_49" → "cos_49". Used for code-panel highlighting. */
  nodeSlugMap: Map<string, string>;

  // Raw GLSL editor override — when set, ShaderCanvas uses this shader instead of the compiled graph
  rawGlslShader: string | null;
  /** Shape the preview (and therefore every export) is held to. Persisted. */
  previewAspect: PreviewAspect;
  setPreviewAspect: (a: PreviewAspect) => void;
  /** A group just made from a selection that should open its Publish dialog once its card mounts. */
  pendingPublishGroupId: string | null;
  setPendingPublishGroupId: (id: string | null) => void;
  /** Import many graphs (a multi-file pick or a folder); folders are recreated in Saved Graphs. */
  importGraphsBulk: (mode: 'files' | 'folder') => Promise<FileResult & { imported?: string[]; skipped?: Array<{ path: string; reason: string }> }>;
  setRawGlslShader: (shader: string | null) => void;

  /** Brief notice shown when group output reassignment auto-disconnected incompatible outer connections */
  disconnectedNotice: string | null;
  clearDisconnectedNotice: () => void;
  /** Reassign a group output port to a different inner node's output */
  setGroupOutput: (groupId: string, outputPortKey: string, fromNodeId: string, fromOutputKey: string) => void;
  /** Add a new empty output port to a group (user then wires an inner node to it) */
  addGroupOutput: (groupId: string, type?: import('../types/nodeGraph').DataType, label?: string) => void;
  /** Remove an output port from a group and disconnect any external connections to it */
  removeGroupOutput: (groupId: string, portKey: string) => void;
  /** Add a user-defined extra input to a marchLoopGroup (surfaces as input socket + marchLoopInputs output) */
  addMarchLoopInput: (groupNodeId: string, key: string, type: import('../types/nodeGraph').DataType, label: string) => void;
  /** Remove a user-defined extra input from a marchLoopGroup */
  removeMarchLoopInput: (groupNodeId: string, key: string) => void;
  /** Rename a user-defined extra input on a marchLoopGroup */
  renameMarchLoopInput: (groupNodeId: string, key: string, newLabel: string) => void;
  /** Toggle visibility of a standard output port on the exterior marchLoopGroup node */
  toggleMarchLoopOutputPort: (groupNodeId: string, outputKey: string) => void;
  /** Add a new dynamic input port to a group (from inside the group view) */
  addGroupInput: (groupId: string, type: import('../types/nodeGraph').DataType, label: string) => void;
  /** Reroute an existing group input port to a different inner node socket */
  rerouteGroupInput: (groupId: string, portKey: string, toNodeId: string, toInputKey: string) => void;
  /** Remove a group input port and its external connection (called when disconnecting an external socket from inside a group) */
  removeGroupInputPort: (groupId: string, portKey: string) => void;
  /**
   * Create a brand-new group input port already wired to `toNodeId`/`toInputKey`
   * — combines addGroupInput + rerouteGroupInput into one step/one undo entry,
   * for a UI (mobile's "Connect Existing" picker) where "feed this input from
   * a new group input" is one tap rather than desktop's two-step add-then-drag.
   */
  exposeGroupInput: (groupId: string, toNodeId: string, toInputKey: string, type: import('../types/nodeGraph').DataType, label: string) => void;
  /**
   * Create a brand-new group input port wired to its OUTER source
   * (sourceNodeId/sourceOutputKey, a node outside the group) but with no
   * internal consumer yet — the mirror image of exposeGroupInput, which
   * wires the inner side but leaves the outer side unset. Used by the
   * group's own "+ Add Input" (its outer half is picked/created right
   * there; which internal node ends up reading it is wired later, the same
   * way as any other group input, from inside the group).
   */
  addGroupInputWithSource: (groupId: string, sourceNodeId: string, sourceOutputKey: string, type: import('../types/nodeGraph').DataType, label: string) => void;
  /**
   * Create a brand-new group output port already sourced from `fromNodeId`'s
   * `fromOutputKey` — combines addGroupOutput + setGroupOutput into one step,
   * for exposing an internal node's output that isn't a group output yet.
   */
  exposeGroupOutput: (groupId: string, fromNodeId: string, fromOutputKey: string, type: import('../types/nodeGraph').DataType, label: string) => void;
  /**
   * Set the assignOp on a node (works for both top-level and subgraph nodes).
   * Controls how its outputs accumulate across iterations in a loop group.
   */
  setNodeAssignOp: (nodeId: string, op: import('../types/nodeGraph').GraphNode['assignOp']) => void;
  /**
   * Set the assignInit expression on a node — the GLSL initializer used when assignOp !== '='.
   * Can reference any previously-computed GLSL variable name.
   */
  setNodeAssignInit: (nodeId: string, expr: string) => void;
  /** Toggle carry mode on a node inside an iterated group. */
  toggleNodeCarryMode: (nodeId: string) => void;

  // Actions
  addNode: (type: string, position: { x: number; y: number }, overrideParams?: Record<string, unknown>) => string | undefined;
  /** "Next steps" on an Agents group card: adds and wires an Emit, Draw agents, Deposit + Trail, or the Output (store/agentSetup.ts). */
  addAgentPiece: (groupId: string, piece: AgentPiece) => void;
  /** An empty Agents rule's starting points (inside the group): Sense → Steer → Move, Curl noise → Integrate, or Move alone. */
  startAgentRule: (groupId: string, kind: AgentRuleStart) => void;
  /**
   * Build starter recipe `recipeId` round node `nodeId` (nodes/recipes; offered by RecipeOffer
   * when the node is added): helper nodes in free space, wired, noted, the result on the Output.
   * One undo step. Returns the ids added, or null when the node or recipe is gone.
   */
  applyStarterRecipe: (nodeId: string, recipeId: string) => string[] | null;
  /** Turn a March Loop Group into a GI Lit March Group or back, in the level being edited (nodes/convertMarchLoop.ts). */
  convertMarchLoop: (nodeId: string, to: MarchLoopType) => boolean;
  /** Turn an old Bloom (reads last frame) into Pass → Glow (texture) → Add glow, in the level being edited (nodes/upgradeBloom.ts). */
  upgradeBloom: (nodeId: string) => boolean;
  /**
   * Apply suggestion move `moveId` (suggestions/moves.ts) on socket `key` of node `nodeId`, in the
   * level being edited: one undo step, a compile, a toast. Selects the move's result node.
   * Returns the ids added, or null when it can't go there.
   */
  applySuggestion: (nodeId: string, key: string, side: 'in' | 'out', moveId: string, args?: Record<string, unknown>) => string[] | null;
  /** Run a Do… bar plan (suggestions/doBar.ts) in the level being edited: one undo step, a compile. Returns the step labels that ran. */
  runDoPlan: (plan: DoPlan, label: string) => string[];
  /**
   * Run a Do… bar command sentence (suggestions/doCommands.ts) on the level being edited: every
   * clause, as one undo step (a "group …" at the end included). Refused (nothing changes) when a
   * clause can't be read, needs a pick, or fails its type check. Returns the plan that ran.
   */
  runCommand: (text: string, picks?: Record<string, string>) => CommandPlan;
  /** Add a node already built (an idiom's Expression Block from the Do… bar) to the level being edited, near the view: one undo step. */
  addBuiltNode: (node: GraphNode, label: string) => string | null;
  /**
   * Add an Agents starter setup at the top level (the Add Agents group choice): Emit → Agents → …,
   * wired to the Output over what it showed, one undo step. Returns the Agents group's id.
   */
  addAgentsStarter: (kind: 'particles' | 'slime' | 'rules' | 'rules3d', position?: { x: number; y: number }, template?: string) => string | null;
  /**
   * Spawn a pre-wired subgraph from a descriptor.
   * `origin` is the top-left anchor in canvas space.
   * Each entry in `nodes` has `type`, `relPos` (offset from origin), optional `params`.
   * `edges` wires output → input by local array index.
   */
  spawnGraph: (
    origin: { x: number; y: number },
    nodes: Array<{ type: string; relPos: { x: number; y: number }; params?: Record<string, unknown> }>,
    edges: Array<{ from: number; fromKey: string; to: number; toKey: string }>,
  ) => void;
  removeNode: (nodeId: string) => void;
  /** Remove several nodes as one undo step. */
  removeNodes: (nodeIds: string[]) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>, options?: { immediate?: boolean }) => void;
  /** New random values for the node's free sliders (see nodes/randomizeParams.ts); one undo step per call */
  randomizeNodeParams: (nodeId: string, weights?: Record<string, number> | null) => void;
  updateNodeOutputs: (nodeId: string, outputs: Record<string, { type: import('../types/nodeGraph').DataType; label: string }>) => void;
  updateNodeInputs: (nodeId: string, inputs: Record<string, import('../types/nodeGraph').InputSocket>) => void;
  setPreviewNodeId: (id: string | null) => void;

  connectNodes: (
    sourceNodeId: string,
    sourceOutputKey: string,
    targetNodeId: string,
    targetInputKey: string
  ) => void;

  disconnectInput: (nodeId: string, inputKey: string) => void;
  /**
   * Give a palette node these colour stops. A Stops Palette just takes them; a cosine Palette is
   * converted in place into a Stops Palette (same id, so every wire stays) and then takes them.
   * More stops than the node holds are thinned evenly. Returns how many stops were used.
   */
  setPaletteStops: (nodeId: string, colors: Array<[number, number, number]>, opts?: { wrap?: string; blend?: string }) => number;
  /**
   * Convert a cosine Palette into a Stops Palette in place (one undo step). Its colours are
   * sampled into `count` evenly spaced Loop stops — 'auto' picks the fewest that stay within
   * about 1% of the original — with whichever blend follows it best, unless `colors` gives
   * the stops outright.
   */
  convertPaletteToStops: (nodeId: string, count?: number | 'auto', colors?: Array<[number, number, number]>, opts?: { wrap?: string; blend?: string }) => boolean;
  /** Remove every wire leaving `nodeId.outputKey` at the level being edited (one undo step). Returns how many were removed. */
  disconnectOutput: (nodeId: string, outputKey: string) => number;

  // Rebuild a node's input sockets from a custom-fn inputs definition array
  updateNodeSockets: (
    nodeId: string,
    inputs: Array<{ name: string; type: DataType; slider?: { min: number; max: number } | null }>,
    outputType: DataType,
    /** Further outputs besides `result` (a Custom Function's out values, an Expression Block's exposed locals). */
    extraOutputs?: Array<{ name: string; type: DataType }>,
  ) => void;
  /** Rewrite a Constants card's entries: params, output sockets, and wires to outputs that went away. One undo step. */
  setConstantsItems: (nodeId: string, items: ConstantsItem[]) => void;
  /**
   * Put a rewritten copy of the whole graph in place (the optimiser's result):
   * one undo step, Play setup and saved identity kept, loose groups pruned of
   * members that no longer exist.
   */
  setNodesRewritten: (nodes: GraphNode[], label?: string) => void;

  /** Change the vector type of a vectorizable math node (sin, cos, pow, etc.).
   *  Updates params.outputType plus the primary input and output socket types. */
  changeNodeVectorType: (nodeId: string, primaryInputKey: string, primaryOutputKey: string, outputType: DataType) => void;

  /**
   * Collapse the given node IDs into a single group node.
   * Dangling input connections become group input ports; outputs wired outside
   * the selection become group output ports.  Returns the new group node ID or
   * null if the selection was invalid.
   */
  groupNodes: (nodeIds: string[], label?: string) => string | null;
  /** Dissolve a group node — expand its subgraph back into the flat graph. */
  ungroupNode: (groupId: string) => void;
  /** Rename an input or output port label on a group node. */
  renameGroupPort: (nodeId: string, portKey: string, dir: 'in' | 'out', newLabel: string) => void;
  /**
   * Cluster existing nodes into a purely visual LooseGroup at the current
   * active scope — no wiring/port logic, no compile effect, members stay
   * exactly where they are. Returns the new group's ID or null if fewer
   * than 2 valid member ids were given.
   */
  createLooseGroup: (nodeIds: string[], label?: string) => string | null;
  /** Dissolve a LooseGroup — members are unaffected, just no longer clustered. */
  ungroupLoose: (groupId: string) => void;
  toggleLooseGroupCollapsed: (groupId: string) => void;
  renameLooseGroup: (groupId: string, label: string) => void;
  undo: () => void;
  redo: () => void;
  /** Undo (or redo) several steps in one go — one render and compile. Returns how many were taken. */
  undoSteps: (count: number) => number;
  redoSteps: (count: number) => number;
  /**
   * Compile the graph into the preview's shader. `force` (Rebuild) starts from scratch: the
   * per-node definition cache and user nodes' compiled definitions are built again first, and
   * every compile output is written even when the shader text came out the same.
   */
  compile: (opts?: { force?: boolean }) => void;
  /**
   * Rebuild: recompile the whole graph with every cache bypassed, clear the error board, then
   * reset each live preview's GPU state (program, render targets, feedback/echo history,
   * particles, textures). The graph, the clock, the Play setup and its layers are kept.
   * Resolves to what was reset and the compile errors, if any.
   */
  rebuild: () => Promise<{ reset: string[]; errors: string[] }>;
  /** Bumped by every rebuild() */
  rebuildEpoch: number;
  loadExampleGraph: (name?: string) => Promise<void>;
  /** Put a graph built elsewhere (the GLSL → nodes converter) in place of the current one, undoably. */
  replaceGraph: (nodes: GraphNode[]) => void;
  /**
   * A scratch graph: the Convert page shows the graph a shader would become on
   * the real canvas, so it swaps that graph into the store while the page is
   * open and puts the user's graph back when it closes. `beginScratch` keeps
   * the current graph aside, `setScratchNodes` shows another candidate (no
   * undo entry), `endScratch(true)` keeps the scratch graph as the real one
   * (undoable, unsaved) and `endScratch(false)` restores what was kept aside.
   * Undo, redo and the graph-editing shortcuts sit out while a scratch is open.
   */
  scratch: ScratchSnapshot | null;
  beginScratch: () => void;
  /** `controls`: Play controls the scratch graph comes with (a converted shader's uniforms). */
  setScratchNodes: (nodes: GraphNode[], controls?: PlayControl[]) => void;
  endScratch: (commit: boolean) => void;
  /** Empty the canvas down to UV → Output (the trash button's right-click) */
  clearToMinimal: () => void;
  /** Tidy the current level: by data flow (columns by depth), or 'stage' (columns by stage in the flow, structure/arrange.ts). One undo step. */
  autoLayout: (mode?: 'flow' | 'stage') => void;
  /** Move top-level cards to new places (no undo entry, no recompile): for layouts the Convert page redoes once its cards are measured. */
  setNodePositions: (positions: Map<string, { x: number; y: number }>) => void;
  /** `source` is the shader the errors were reported against (their line numbers point into it) */
  setGlslErrors: (errors: string[], source?: string | null) => void;
  setGlContextLost: (lost: boolean) => void;
  /** The newest shader failed to compile, so the preview is still drawing the last one that worked */
  previewStale: boolean;
  setPreviewStale: (stale: boolean) => void;
  /** Bumped by restartPreview(); ShaderCanvas remounts on change (a fresh WebGL context) */
  previewEpoch: number;
  restartPreview: () => void;
  setPixelSample: (sample: [number, number, number, number] | null) => void;
  setHoveredParamHint: (hint: string | null) => void;
  setCurrentTime: (t: number) => void;
  setTimePlaying: (playing: boolean) => void;
  toggleBypass: (nodeId: string) => void;

  // Save / Load
  /**
   * Save the graph under `name`. A name that already exists is the same
   * project: the new save becomes its next version and the one it replaces
   * is kept in the project's history (graphVersions.ts). `note` says what changed.
   */
  /** Save under `name`: kind minor (default with that series open), major (a new family), inPlace (over the open version) or new (a new series, or a new family when the name exists). docs/graph-series-plan.md */
  saveGraph: (name: string, note?: string, kind?: SaveKind) => Promise<FileResult>;
  /** The saved graph open right now (loaded or last saved), and which version; null for examples, imports and new graphs. */
  currentGraph: { name: string; version: number; major: number; minor: number; latest: boolean } | null;
  /** Bumped whenever a whole different graph is loaded (an example, a saved graph, an import): not by edits or undo. */
  graphEpoch: number;
  /** The open graph changed since it was loaded or saved. */
  graphDirty: boolean;
  /** Open an earlier version of a saved graph. Saving it makes it the newest version. */
  loadGraphVersion: (name: string, version: number) => FileResult;
  getSavedGraphNames: () => string[];
  loadSavedGraph: (name: string) => FileResult;
  deleteSavedGraph: (name: string) => void;
  exportGraph: () => Promise<FileResult>;
  /** `recovered`: an autosave put back after a crash (files/recovery.ts): its own undo label, no import in the activity log. */
  importGraph: (json: string, opts?: { recovered?: boolean }) => FileResult;
  importGraphFromFile: () => Promise<FileResult>;
  /** Pick a .glsl/.frag file, wrap it as a code-backed node type and build UV → node → Output. */
  importGlslFromFile: () => Promise<FileResult & { notes?: string[]; label?: string }>;

  // Custom-fn presets
  saveCustomFn: (nodeId: string) => Promise<FileResult>;
  deleteCustomFn: (id: string) => void;
  exportCustomFns: () => Promise<void>;
  importCustomFns: (json: string) => void;
  importCustomFnsFromFile: () => Promise<void>;
  setCustomFnPresetsDir: (path: string) => void;
  loadCustomFnsFromDisk: () => Promise<CustomFnPreset[]>;

  // Group presets
  groupPresets: GroupPreset[];
  saveGroupPreset: (groupNodeId: string, label?: string, description?: string) => Promise<FileResult>;
  deleteGroupPreset: (presetId: string) => void;
  instantiateGroupPreset: (presetId: string, position?: { x: number; y: number }) => string | null;
  /** Place a copy of `subgraph` as a new group node (fresh ids). Shared by presets and user-node sources. */
  placeSubgraphAsGroup: (label: string, subgraph: SubgraphData, position?: { x: number; y: number }, description?: string) => string | null;

  // User-published node types (see nodes/userNodes)
  /** Flatten a group node (by id in the active scope) or a prepared subgraph into a GLSL function and register it as a node type. */
  /** Publish a node type; on success `id` is the node type's id (its registry key). */
  publishUserNode: (source: string | PublishSource, spec: PublishUserNodeSpec) => Promise<FileResult & { id?: string }>;
  /** Parse a saved graph's nodes (migrated) without loading it into the editor. */
  readSavedGraphNodes: (name: string) => GraphNode[] | null;
  deleteUserNode: (id: string) => void;
  /** Re-open a published node's source subgraph as an editable group. */
  openUserNodeSource: (id: string, position?: { x: number; y: number }) => string | null;
  /** Save one node type (or all of them) as a shareable .json file. */
  exportUserNodes: (ids?: string[]) => Promise<FileResult>;
  /** Pick a .json exported from any Playfield and register the node types in it. */
  /** A .playfile node pack opens its preview (`deferred`: the dialog imports); an older node .json imports straight away. */
  importUserNodesFromFile: () => Promise<FileResult & { imported?: string[]; replaced?: string[]; deferred?: boolean }>;
}

// ─── Example graph data ───────────────────────────────────────────────────────

export { EXAMPLE_INDEX, DEFAULT_EXAMPLE, EXAMPLE_FOLDERS } from './exampleIndex';


// ─── Preview sub-graph builder ────────────────────────────────────────────────
// Builds a preview graph for a node that lives inside a group's subgraph.
// Patches the group node so its output port points to the target inner node,
// then wraps the whole thing in a synthetic top-level output node.
function buildGroupPreviewGraph(nodes: GraphNode[], groupId: string, innerNodeId: string): GraphNode[] {
  const groupNode = nodes.find(n => n.id === groupId);
  if (!groupNode) return nodes;
  const subgraph = groupNode.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
  if (!subgraph) return nodes;

  // A line preview's probe (lib/nodePreview/lineProbe.ts) swaps in a copy of the block, for this compile only
  const innerNode = probedNode(subgraph.nodes.find(n => n.id === innerNodeId) ?? null);
  if (!innerNode) return nodes;

  // The output to preview: the one picked in "Show as" (docs/node-previews.md), else vec3, vec4, vec2, float, any
  const chosen = pickPreviewOutput(innerNode, prefOf(innerNode).output);
  if (!chosen) return nodes;

  const [chosenKey, chosenType] = chosen;
  const outType = chosenType as import('../types/nodeGraph').DataType;
  const previewPortKey = 'xpreviewport';

  // Patch the group: add a synthetic output port routing the inner node's chosen output.
  // Expose ONLY that port so buildPreviewGraph picks it and applies the correct type
  // promotions (float→grayscale, vec2→vec3, vec3/vec4 direct).
  const patchedGroupNode: GraphNode = {
    ...groupNode,
    params: {
      ...groupNode.params,
      subgraph: {
        ...subgraph,
        nodes: subgraph.nodes.map(n => (n.id === innerNodeId ? innerNode : n)),
        outputPorts: [
          ...subgraph.outputPorts,
          {
            key: previewPortKey,
            type: outType,
            label: '__preview__',
            fromNodeId: innerNodeId,
            fromOutputKey: chosenKey,
          },
        ],
      },
    },
    outputs: { [previewPortKey]: { type: outType, label: '__preview__' } },
  };

  const patchedNodes = nodes.map(n => n.id === groupId ? patchedGroupNode : n);

  // Delegate to buildPreviewGraph which handles all output types (float, vec2, vec3, vec4)
  return buildPreviewGraph(patchedNodes, groupId);
}

// Builds a minimal graph containing the target node + all its transitive
// input dependencies, plus a synthetic output node wired to the first
// vec3/vec4 output of the target.
function buildPreviewGraph(graph: GraphNode[], targetId: string): GraphNode[] {
  // A line preview's probe (lib/nodePreview/lineProbe.ts) swaps in a copy of the block, for this compile only
  const nodes = graph.map(n => (n.id === targetId ? probedNode(n) : n));
  // BFS: collect all transitive dependencies of targetId
  const included = new Set<string>();
  const queue = [targetId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (included.has(id)) continue;
    included.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    for (const input of Object.values(node.inputs)) {
      if (input.connection) queue.push(input.connection.nodeId);
    }
  }

  const subgraph = nodes.filter(n => included.has(n.id));
  const targetNode = nodes.find(n => n.id === targetId);
  if (!targetNode) return nodes; // fallback: don't break if node vanished

  // The output to preview: the one picked in "Show as" (docs/node-previews.md), else vec3, vec4, vec2, float, any
  const chosen = pickPreviewOutput(targetNode, prefOf(targetNode).output);
  if (!chosen) return nodes; // no outputs to preview

  const [chosenKey, outType] = chosen;

  if (outType === 'vec4') {
    const syntheticOutput: GraphNode = {
      id: '__preview_output__',
      type: 'vec4Output',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { color: { type: 'vec4', label: 'Color', connection: { nodeId: targetId, outputKey: chosenKey } } },
      outputs: {},
    };
    return [...subgraph, syntheticOutput];
  }

  if (outType === 'vec3') {
    const syntheticOutput: GraphNode = {
      id: '__preview_output__',
      type: 'output',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: targetId, outputKey: chosenKey } } },
      outputs: {},
    };
    return [...subgraph, syntheticOutput];
  }

  // vec2: promote (x, y, 0) → vec3 via extractX/Y + makeVec3
  if (outType === 'vec2') {
    const split: GraphNode = {
      id: '__preview_split__',
      type: 'splitVec2',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { v: { type: 'vec2', label: 'Vec2', connection: { nodeId: targetId, outputKey: chosenKey } } },
      outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } },
    };
    const mkVec3: GraphNode = {
      id: '__preview_mkVec3__',
      type: 'makeVec3',
      position: { x: 0, y: 0 },
      params: {},
      inputs: {
        r: { type: 'float', label: 'R', connection: { nodeId: '__preview_split__', outputKey: 'x' } },
        g: { type: 'float', label: 'G', connection: { nodeId: '__preview_split__', outputKey: 'y' } },
        b: { type: 'float', label: 'B' },
      },
      outputs: { rgb: { type: 'vec3', label: 'RGB' } },
    };
    const syntheticOutput: GraphNode = {
      id: '__preview_output__',
      type: 'output',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: '__preview_mkVec3__', outputKey: 'rgb' } } },
      outputs: {},
    };
    return [...subgraph, split, mkVec3, syntheticOutput];
  }

  // float: promote to grayscale vec3
  if (outType === 'float') {
    const toVec3: GraphNode = {
      id: '__preview_toVec3__',
      type: 'floatToVec3',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { input: { type: 'float', label: 'Value', connection: { nodeId: targetId, outputKey: chosenKey } } },
      outputs: { rgb: { type: 'vec3', label: 'RGB' } },
    };
    const syntheticOutput: GraphNode = {
      id: '__preview_output__',
      type: 'output',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: '__preview_toVec3__', outputKey: 'rgb' } } },
      outputs: {},
    };
    return [...subgraph, toVec3, syntheticOutput];
  }

  // Fallback for unsupported types (mat2, mat3, scene3d, etc.) — compile the full graph so
  // ShaderCanvas can still probe the node's input variables via nodeOutputVarMap.
  return nodes;
}

const idGenerator = new IdGenerator();


// ── Nested-group path helpers ──────────────────────────────────────────────
/**
 * Return the node list at the active depth specified by `path`.
 * path=[] → top-level nodes; path=['a'] → inside group a; path=['a','b'] → inside b inside a.
 */
export function getActiveNodes(nodes: GraphNode[], path: string[]): GraphNode[] | null {
  if (path.length === 0) return nodes;
  const g0 = nodes.find(n => n.id === path[0]);
  const sg0 = g0?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
  if (!sg0) return null;
  if (path.length === 1) return sg0.nodes;
  const g1 = sg0.nodes.find(n => n.id === path[1]);
  const sg1 = g1?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
  return sg1?.nodes ?? null;
}

/**
 * Remove `nodeId` from `nodeList` and repair the gap: any other node's input
 * that was wired to the deleted node's output is bridged directly to the
 * deleted node's own upstream source instead (when the types are
 * compatible), the same "smart delete" removeNode's top-level path has
 * always done — an input left dangling instead would silently fall back to
 * whatever default the socket has, changing the shader with no visible
 * cause. Picks the first compatible upstream source per orphaned input,
 * same tie-break the top-level path uses. Shared so deleting a node inside
 * a group (getActiveNodes-scoped `nodeList`) behaves identically to
 * deleting one at the top level, instead of just clearing the connection.
 */
export function removeNodeFromList(nodeList: GraphNode[], nodeId: string): GraphNode[] {
  const deletedNode = nodeList.find(n => n.id === nodeId);

  type Src = { sourceNodeId: string; sourceOutputKey: string; sourceType: string };
  const upstream: Src[] = [];
  if (deletedNode) {
    for (const input of Object.values(deletedNode.inputs)) {
      if (!input.connection) continue;
      const srcNode = nodeList.find(n => n.id === input.connection!.nodeId);
      const srcDef = srcNode ? getNodeDefinitionFor(srcNode) : undefined;
      const srcType = srcDef?.outputs[input.connection!.outputKey]?.type ?? '';
      if (srcType) upstream.push({ sourceNodeId: input.connection.nodeId, sourceOutputKey: input.connection.outputKey, sourceType: srcType });
    }
  }

  type Tgt = { targetNodeId: string; targetInputKey: string; targetType: string };
  const downstream: Tgt[] = [];
  for (const n of nodeList) {
    if (n.id === nodeId) continue;
    for (const [inputKey, input] of Object.entries(n.inputs)) {
      if (input.connection?.nodeId !== nodeId) continue;
      const tgtDef = getNodeDefinitionFor(n);
      const tgtType = tgtDef?.inputs[inputKey]?.type ?? '';
      downstream.push({ targetNodeId: n.id, targetInputKey: inputKey, targetType: tgtType });
    }
  }

  type Bridge = { sourceNodeId: string; sourceOutputKey: string; targetNodeId: string; targetInputKey: string };
  const bridges: Bridge[] = [];
  for (const tgt of downstream) {
    for (const src of upstream) {
      if (typesCompatible(src.sourceType as import('../types/nodeGraph').DataType, tgt.targetType as import('../types/nodeGraph').DataType)) {
        bridges.push({ sourceNodeId: src.sourceNodeId, sourceOutputKey: src.sourceOutputKey, targetNodeId: tgt.targetNodeId, targetInputKey: tgt.targetInputKey });
        break;
      }
    }
  }

  let newList = nodeList
    .filter(n => n.id !== nodeId)
    .map(n => ({
      ...n,
      inputs: Object.fromEntries(
        Object.entries(n.inputs).map(([key, input]) => [
          key,
          input.connection?.nodeId === nodeId ? { ...input, connection: undefined } : input,
        ]),
      ),
    }));

  for (const bridge of bridges) {
    newList = newList.map(n => {
      if (n.id !== bridge.targetNodeId) return n;
      return {
        ...n,
        inputs: {
          ...n.inputs,
          [bridge.targetInputKey]: { ...n.inputs[bridge.targetInputKey], connection: { nodeId: bridge.sourceNodeId, outputKey: bridge.sourceOutputKey } },
        },
      };
    });
  }

  return newList;
}

/**
 * Apply `updater` to a specific node anywhere in the tree (top-level or nested).
 * Uses `activeGroupPath` to locate the parent scope when the node is nested.
 */
function updateNodeInTree(
  nodes: GraphNode[],
  nodeId: string,
  activeGroupPath: string[],
  updater: (n: GraphNode) => GraphNode,
): GraphNode[] {
  if (nodes.some(n => n.id === nodeId)) {
    return nodes.map(n => n.id === nodeId ? updater(n) : n);
  }
  if (activeGroupPath.length >= 2) {
    const parentPath = activeGroupPath.slice(0, -1);
    const parentNodes = getActiveNodes(nodes, parentPath);
    if (parentNodes?.some(n => n.id === nodeId)) {
      const updated = parentNodes.map(n => n.id === nodeId ? updater(n) : n);
      return setActiveNodes(nodes, parentPath, updated) ?? nodes;
    }
  }
  return nodes;
}

/**
 * Return a new top-level nodes array with the subgraph at `path` replaced by `newSub`.
 */
export function setActiveNodes(nodes: GraphNode[], path: string[], newSub: GraphNode[]): GraphNode[] | null {
  if (path.length === 0) return newSub;
  if (path.length === 1) {
    return nodes.map(n => {
      if (n.id !== path[0]) return n;
      const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!sg) return n;
      return { ...n, params: { ...n.params, subgraph: { ...sg, nodes: newSub } } };
    });
  }
  return nodes.map(outer => {
    if (outer.id !== path[0]) return outer;
    const outerSg = outer.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (!outerSg) return outer;
    const newOuterSub = outerSg.nodes.map(inner => {
      if (inner.id !== path[1]) return inner;
      const innerSg = inner.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!innerSg) return inner;
      return { ...inner, params: { ...inner.params, subgraph: { ...innerSg, nodes: newSub } } };
    });
    return { ...outer, params: { ...outer.params, subgraph: { ...outerSg, nodes: newOuterSub } } };
  });
}

/**
 * LooseGroup counterpart to getActiveNodes/setActiveNodes — reads/writes the
 * looseGroups list at a given scope. Unlike nodes, the top-level list isn't
 * nested inside any GraphNode, it's its own store field, so both functions
 * thread it through as a separate argument/return value rather than folding
 * it into the nodes tree the way subgraph.nodes is.
 */
export function getActiveLooseGroups(
  nodes: GraphNode[],
  topLevelLooseGroups: import('../types/nodeGraph').LooseGroup[],
  path: string[],
): import('../types/nodeGraph').LooseGroup[] {
  if (path.length === 0) return topLevelLooseGroups;
  const g0 = nodes.find(n => n.id === path[0]);
  const sg0 = g0?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
  if (!sg0) return [];
  if (path.length === 1) return sg0.looseGroups ?? [];
  const g1 = sg0.nodes.find(n => n.id === path[1]);
  const sg1 = g1?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
  return sg1?.looseGroups ?? [];
}

function setActiveLooseGroups(
  nodes: GraphNode[],
  topLevelLooseGroups: import('../types/nodeGraph').LooseGroup[],
  path: string[],
  newGroups: import('../types/nodeGraph').LooseGroup[],
): { nodes: GraphNode[]; looseGroups: import('../types/nodeGraph').LooseGroup[] } {
  if (path.length === 0) return { nodes, looseGroups: newGroups };
  if (path.length === 1) {
    const newNodes = nodes.map(n => {
      if (n.id !== path[0]) return n;
      const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!sg) return n;
      return { ...n, params: { ...n.params, subgraph: { ...sg, looseGroups: newGroups } } };
    });
    return { nodes: newNodes, looseGroups: topLevelLooseGroups };
  }
  const newNodes = nodes.map(outer => {
    if (outer.id !== path[0]) return outer;
    const outerSg = outer.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (!outerSg) return outer;
    const newOuterNodes = outerSg.nodes.map(inner => {
      if (inner.id !== path[1]) return inner;
      const innerSg = inner.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!innerSg) return inner;
      return { ...inner, params: { ...inner.params, subgraph: { ...innerSg, looseGroups: newGroups } } };
    });
    return { ...outer, params: { ...outer.params, subgraph: { ...outerSg, nodes: newOuterNodes } } };
  });
  return { nodes: newNodes, looseGroups: topLevelLooseGroups };
}

/**
 * Drop a deleted node from every LooseGroup's membership, and dissolve any
 * group that falls below 2 members — a "cluster" of zero or one node isn't
 * meaningfully organizing anything anymore.
 */
function pruneLooseGroups(
  looseGroups: import('../types/nodeGraph').LooseGroup[],
  removedNodeId: string,
): import('../types/nodeGraph').LooseGroup[] {
  return looseGroups
    .map(g => ({ ...g, memberIds: g.memberIds.filter(id => id !== removedNodeId) }))
    .filter(g => g.memberIds.length >= 2);
}

/**
 * Deep-clone a group node, assigning new IDs to the group itself and all its
 * subgraph nodes (recursively for nested groups).
 */
function deepCloneGroupNode(groupNode: GraphNode): GraphNode {
  const subgraph = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
  const newGroupId = idGenerator.next();
  if (!subgraph) return { ...groupNode, id: newGroupId };

  const idMap = new Map<string, string>();
  for (const sn of subgraph.nodes) {
    idMap.set(sn.id, idGenerator.next());
  }
  const newSubNodes = subgraph.nodes.map(sn => {
    const newId = idMap.get(sn.id)!;
    const remappedInputs = Object.fromEntries(
      Object.entries(sn.inputs).map(([k, inp]) => [
        k,
        inp.connection && idMap.has(inp.connection.nodeId)
          ? { ...inp, connection: { ...inp.connection, nodeId: idMap.get(inp.connection.nodeId)! } }
          : inp,
      ])
    );
    const base: GraphNode = { ...sn, id: newId, inputs: remappedInputs };
    return sn.type === 'group' ? deepCloneGroupNode(base) : base;
  });
  const newInputPorts = subgraph.inputPorts.map(p => ({
    ...p, toNodeId: idMap.get(p.toNodeId) ?? p.toNodeId,
  }));
  const newOutputPorts = subgraph.outputPorts.map(p => ({
    ...p, fromNodeId: idMap.get(p.fromNodeId) ?? p.fromNodeId,
  }));
  return {
    ...groupNode,
    id: newGroupId,
    params: {
      ...groupNode.params,
      subgraph: { nodes: newSubNodes, inputPorts: newInputPorts, outputPorts: newOutputPorts },
    },
  };
}

// ─── Smart param surfacing heuristics ─────────────────────────────────────────
/** Param keys that are HIGH priority to surface (size/intensity knobs). */
const SURFACE_HIGH = new Set([
  'radius', 'scale', 'size', 'amount', 'strength', 'boost',
  'outmin', 'outmax', 'value', 'freq', 'amp', 'frequency', 'amplitude',
  'mix', 'blur', 'weight', 'intensity', 'density', 'speed',
]);
/** Param keys that should NOT be auto-surfaced (positional / rarely tweaked). */
const SURFACE_EXCLUDE = new Set([
  'posx', 'posy', 'positionx', 'positiony', 'inmin', 'inmax', 'seed',
]);

/**
 * Given a freshly-created group node whose subgraph may contain inner group nodes,
 * auto-select up to 2 params per inner group (max 8 total) as surfaced params.
 */
function pickSurfacedParams(
  subgraphNodes: GraphNode[],
): import('../types/nodeGraph').SurfacedParam[] {
  const result: import('../types/nodeGraph').SurfacedParam[] = [];
  let total = 0;

  for (const innerGroupNode of subgraphNodes) {
    if (innerGroupNode.type !== 'group') continue;
    if (total >= 8) break;
    const innerSub = innerGroupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (!innerSub) continue;

    let perGroup = 0;

    // Collect all candidate (nodeId, paramKey, paramDef) triples from inner nodes
    type Candidate = { nodeId: string; paramKey: string; label: string; priority: number };
    const candidates: Candidate[] = [];

    for (const inn of innerSub.nodes) {
      if (inn.type === 'loopIndex' || inn.type === 'loopCarry') continue;
      const innDef = getNodeDefinitionFor(inn);
      if (!innDef?.paramDefs) continue;
      const floatParams = Object.entries(innDef.paramDefs).filter(
        ([, pd]) => pd.type === 'float' && pd.step !== 1,
      );
      for (const [paramKey, paramDef] of floatParams) {
        const low = paramKey.toLowerCase();
        if (SURFACE_EXCLUDE.has(low)) continue;
        const priority = SURFACE_HIGH.has(low) ? 0 : 1;
        candidates.push({ nodeId: inn.id, paramKey, label: paramDef.label, priority });
      }
    }

    // Sort by priority (HIGH first), then alphabetically
    candidates.sort((a, b) =>
      a.priority !== b.priority ? a.priority - b.priority : a.paramKey.localeCompare(b.paramKey),
    );

    // Surface up to 2 (or 1 if only 1 candidate total in the inner group)
    const limit = Math.min(candidates.length === 1 ? 1 : 2, candidates.length);
    for (let i = 0; i < limit && perGroup < 2 && total < 8; i++) {
      result.push({
        innerGroupId: innerGroupNode.id,
        nodeId: candidates[i].nodeId,
        paramKey: candidates[i].paramKey,
        label: candidates[i].label,
      });
      perGroup++;
      total++;
    }
  }
  return result;
}

/** One remembered wire (see NodeGraphState.wireHistory). */
export interface WireMemory {
  fromNodeId: string;
  fromOutputKey: string;
  toNodeId: string;
  toInputKey: string;
  at: number;
}

const WIRE_HISTORY_MAX = 60;

/** Prepend a wire to the memory, dropping an earlier copy of the same wire. */
function rememberWire(history: WireMemory[], w: Omit<WireMemory, 'at'>): WireMemory[] {
  const same = (h: WireMemory) => h.fromNodeId === w.fromNodeId && h.fromOutputKey === w.fromOutputKey && h.toNodeId === w.toNodeId && h.toInputKey === w.toInputKey;
  return [{ ...w, at: Date.now() }, ...history.filter(h => !same(h))].slice(0, WIRE_HISTORY_MAX);
}

/** The node `id` at the level the user is editing (top level or the active group). */
function nodeInScope(state: { nodes: GraphNode[]; activeGroupPath: string[] }, id: string): GraphNode | undefined {
  const top = state.nodes.find(n => n.id === id);
  if (top) return top;
  if (state.activeGroupPath.length === 0) return undefined;
  return getActiveNodes(state.nodes, state.activeGroupPath)?.find(n => n.id === id);
}

/** The innermost group on `path` (a top-level group, or one nested a level in). */
function groupAtPath(nodes: GraphNode[], path: readonly string[]): GraphNode | undefined {
  const g0 = nodes.find(n => n.id === path[0]);
  if (path.length < 2) return g0;
  return (g0?.params.subgraph as SubgraphData | undefined)?.nodes.find(n => n.id === path[1]);
}

/** `nodes` with the innermost group on `path` replaced by `fn(group)`. */
function mapGroupAtPath(nodes: GraphNode[], path: readonly string[], fn: (g: GraphNode) => GraphNode): GraphNode[] {
  if (path.length === 1) return nodes.map(n => (n.id === path[0] && n.params.subgraph ? fn(n) : n));
  return nodes.map(outer => {
    if (outer.id !== path[0]) return outer;
    const sg = outer.params.subgraph as SubgraphData | undefined;
    if (!sg) return outer;
    return { ...outer, params: { ...outer.params, subgraph: { ...sg, nodes: sg.nodes.map(n => (n.id === path[1] && n.params.subgraph ? fn(n) : n)) } } };
  });
}

/**
 * What switching `nodeId` needs to know about where it is: its scope (the
 * level being edited), the types its wires bring (a group port's, an upstream
 * output's), the group output ports that read it, and the group rules.
 */
export function switchScopeFor(state: Pick<NodeGraphState, 'nodes' | 'activeGroupPath'>, nodeId: string):
  { scope: GraphNode[]; node: GraphNode; ctx: SwitchContext; path: string[] } | null {
  const path = state.activeGroupPath;
  const scope = path.length > 0 ? getActiveNodes(state.nodes, path) : state.nodes;
  const node = scope?.find(n => n.id === nodeId);
  if (!scope || !node) return null;
  const group = path.length > 0 ? groupAtPath(state.nodes, path) : undefined;
  const sg = group?.params.subgraph as SubgraphData | undefined;
  const byId = new Map(scope.map(n => [n.id, n]));
  const ctx: SwitchContext = {
    sourceType: conn => {
      if (conn.nodeId === GROUP_PORT_SENTINEL) return sg?.inputPorts?.find(p => p.key === conn.outputKey)?.type;
      const src = byId.get(conn.nodeId);
      return src ? (src.outputs[conn.outputKey]?.type ?? getNodeDefinitionFor(src)?.outputs[conn.outputKey]?.type) : undefined;
    },
    extraConsumers: (sg?.outputPorts ?? []).filter(p => p.fromNodeId === nodeId).map(p => ({ outputKey: p.fromOutputKey, type: p.type })),
    disallowed: type => groupRuleFor(type, path, path.length > 0 ? state.nodes.find(n => n.id === path[0])?.type : undefined),
  };
  return { scope, node, ctx, path };
}

/**
 * The files a web export carries for the graph's inputs: each Texture Input's
 * picture (encoded from its decoded canvas), and the videos and songs
 * mediaSources.ts kept when they were loaded.
 */
function webMedia(st: Pick<NodeGraphState, 'nodes' | 'textureUniforms' | 'nodeTextures' | 'videoUniforms' | 'audioUniforms' | 'play'>): PlayMedia {
  const byId = new Map(st.nodes.map(n => [n.id, n]));
  const labelOf = (id: string, fallback: string) => {
    const n = byId.get(id);
    const own = n && typeof n.params.label === 'string' && n.params.label.trim();
    return own || (n && getNodeDefinition(n.type)?.label) || fallback;
  };
  const textures: NonNullable<PlayMedia['textures']> = {};
  for (const [uniform, key] of Object.entries(st.textureUniforms)) {
    const [id, slot] = key.split('::');
    const label = slot ? `${labelOf(id, 'a node')} (${slot})` : labelOf(id, 'Texture Input');
    // A 16-bit Time Cube atlas is a half-float texture: the page gets its 8-bit canvas (time-cube deep.ts).
    const tex = st.nodeTextures[key];
    const enc = imageDataUrl((tex?.userData as { canvas8?: HTMLCanvasElement } | undefined)?.canvas8 ?? tex?.image);
    // A Time Cube's atlas of frames (docs/time-cube.md) is read without mipmaps, as in the app.
    const flat = byId.get(id)?.type === 'timeCube';
    textures[uniform] = { label, name: '', src: enc?.dataUrl ?? null, bytes: enc?.dataUrl.length ?? 0, scaledTo: enc?.scaledTo ?? null, ...(flat ? { flat: true } : {}) };
  }
  const videos: NonNullable<PlayMedia['videos']> = {};
  for (const [uniform, id] of Object.entries(st.videoUniforms)) {
    const m = mediaSource(id), n = byId.get(id), p = n?.params ?? {};
    // A Baked node's video keeps to the page's clock as it does in the app (docs/bake.md).
    const bake = n?.type === 'baked' ? bakedInfo(n) : null;
    videos[uniform] = {
      label: bake ? `Baked: ${bake.source}` : labelOf(id, 'Video Input'), name: m?.name ?? (typeof p.fileName === 'string' ? p.fileName : ''), src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : bake?.bytes ?? 0),
      loop: bake ? bake.loop === 'seamless' : p._loop !== false, speed: typeof p._speed === 'number' && p._speed > 0 ? p._speed : 1,
      ...(bake ? { clock: { start: bake.start, duration: bake.duration, fps: bake.fps, loop: bake.loop } } : {}),
      // Clip settings (docs/clip-editor.md): the page plays the kept segments as the app does.
      ...(p.clip && typeof p.clip === 'object' ? { clip: p.clip as CpSaved } : {}),
    };
  }
  // Every Audio Input node, wired into the shader or not: Play mappings can read its bands either way.
  const names = audioUniformNamesByNode(st.audioUniforms);
  const audio: NonNullable<PlayMedia['audio']> = [];
  for (const n of st.nodes) {
    if (n.type !== 'audioInput') continue;
    const m = mediaSource(n.id);
    const bands = Array.isArray(n.params._bands) ? (n.params._bands as unknown[]).map(b => Number(b) || 0) : [200];
    audio.push({
      id: n.id, label: labelOf(n.id, 'Audio Input'), name: m?.name ?? '', src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : 0),
      uniforms: Array.from({ length: bands.length }, (_, i) => names.get(n.id)?.[i] ?? ''),
      bands, range: typeof n.params.freq_range === 'number' ? n.params.freq_range : 200, mode: n.params.mode === 'full' ? 'full' : 'band',
    });
  }
  // Video layers: the files play/videoLayers.ts remembered when it opened them (key `vlayer:<id>`).
  const layerVideos: NonNullable<PlayMedia['layerVideos']> = {};
  for (const l of st.play.layers) {
    if (l.kind !== 'video' || !l.videoId) continue;
    const m = mediaSource(`vlayer:${l.id}`);
    layerVideos[l.id] = { label: l.label, name: l.fileName || m?.name || '', src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : l.bytes) };
  }
  // Drum pad samples: remembered by play/drumPads.ts when each loaded (key `dsample:<sampleId>`); generated drums need nothing.
  const layerPads: NonNullable<PlayMedia['layerPads']> = {};
  for (const l of st.play.layers) {
    if (l.kind !== 'drumpad') continue;
    const files: Record<string, PlayMediaFile> = {};
    l.pads.forEach((p, i) => {
      if (!p.sampleId) return;
      const m = mediaSource(`dsample:${p.sampleId}`);
      files[i] = { label: `${l.label} · pad ${i + 1}`, name: p.fileName || m?.name || '', src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : p.bytes) };
    });
    if (Object.keys(files).length) layerPads[l.id] = files;
  }
  // Granulator racks' Library samples: remembered by lib/webGranulator.ts when each loaded (the same `dsample:<sampleId>` key).
  const rackSamples: NonNullable<PlayMedia['rackSamples']> = {};
  for (const r of st.play.audioEngine?.racks ?? []) {
    const sm = r.instrument?.kind === 'granulator' ? r.instrument.sample : undefined;
    if (!sm?.sampleId) continue;
    const m = mediaSource(`dsample:${sm.sampleId}`);
    rackSamples[r.id] = { label: `${r.name} · Granulator`, name: sm.name || m?.name || '', src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : 0) };
  }
  // Trackers on a Video layer: their analysis (lib/trackBakes.ts), when it is loaded here and small enough.
  const tracks: NonNullable<PlayMedia['tracks']> = {};
  for (const kind of ['hands', 'face', 'pose'] as const) {
    const s = kind === 'hands' ? st.play.hands : st.play[kind];
    const layer = s?.source ? st.play.layers.find(l => l.id === s.source) : undefined;
    if (!s || !layer || layer.kind !== 'video' || !layer.videoId) continue;
    const b = bakeFor(s.bakes, layer.id, layer.videoId, '');
    if (!b) continue;
    const size = Math.ceil(b.bake.bytes / 3) * 4;
    const data = size <= TRACK_LIMIT ? bakeBase64(b.bake.key) : null;
    tracks[kind] = { layerId: layer.id, label: `“${layer.label}”`, name: layer.fileName, src: data, bytes: data?.length ?? size };
  }
  return { textures, videos, audio, ...(Object.keys(layerVideos).length ? { layerVideos } : {}), ...(Object.keys(layerPads).length ? { layerPads } : {}), ...(Object.keys(rackSamples).length ? { rackSamples } : {}), ...(Object.keys(tracks).length ? { tracks } : {}) };
}

export const useNodeGraphStore = create<NodeGraphState>((set, get) => ({
  nodes: [],
  looseGroups: [],
  vertexShader: '',
  fragmentShader: '',
  compilationErrors: [],
  paramUniforms: {},
  paramBindings: {},
  play: emptyPlayRecord(),
  datasets: {},
  playOpenRequest: 0,
  currentGraph: null,
  graphEpoch: 0,
  graphDirty: false,
  focusNodeRequest: null,
  focusNode: (id) => set(s => ({ selectedNodeIds: [id], selectedNodeId: id, focusNodeRequest: { id, n: (s.focusNodeRequest?.n ?? 0) + 1 } })),
  glslErrors: [],
  glslErrorSource: null,
  glContextLost: false,
  previewStale: false,
  previewEpoch: 0,
  rebuildEpoch: 0,
  pixelSample: null,
  hoveredParamHint: null,
  currentTime: 0,
  timePlaying: true,
  selectedNodeId: null,
  selectedNodeIds: [],
  nodeOutputVarMap: new Map(),
  nodeProbeValues: null,
  previewStats: null,
  setPreviewStats: (stats) => set(state => {
    const cur = state.previewStats;
    if (cur === stats) return state;
    if (cur && stats && cur.flat === stats.flat && Math.abs(cur.clipped - stats.clipped) < 0.02 && Math.abs(cur.black - stats.black) < 0.02 && Math.abs(cur.mean - stats.mean) < 0.03) return state;
    return { previewStats: stats };
  }),
  scopeProbeValues: {},
  previewNodeId: null,
  bakeGraph: null,
  newNodeId: () => idGenerator.next(),
  setBakeGraph: (nodes) => {
    set({ bakeGraph: nodes });
    get().compile();
  },
  mobileKeyframeEditor: null,
  mobileKeyframeTool: 'select',
  mobileNodeOverlayOpen: false,
  nodeHighlightFilter: null,
  _fitViewCallback: null,
  _viewportCenterGetter: null,
  _setViewCallback: null,
  swapTargetNodeId: null,
  searchPaletteOpen: false,
  activeGroupId: null,
  activeGroupPath: [],
  nodeTextures: {},
  textureUniforms: {},
  audioUniforms: {},
  liveUniforms: {},
  videoTextures: {},
  videoUniforms: {},
  audioMasterVolume: 0.7,
  nodePreviews: {},
  isStateful: false,
  echoConfig: null,
  passes: null,
  agents: null,
  finalNodeIds: null,
  programMap: null,
  showPasses: false,
  setShowPasses: (on: boolean) => set({ showPasses: on }),
  nodeSlugMap: new Map(),
  rawGlslShader: null,
  previewAspect: ((): PreviewAspect => {
    try { const v = localStorage.getItem('shader-studio:settings:previewAspect'); return (v as PreviewAspect) || 'free'; } catch { return 'free'; }
  })(),
  setPreviewAspect: (a) => {
    try { localStorage.setItem('shader-studio:settings:previewAspect', a); } catch { /* preference only */ }
    set({ previewAspect: a });
  },
  pendingPublishGroupId: null,
  setPendingPublishGroupId: (id) => set({ pendingPublishGroupId: id }),
  importGraphsBulk: async (mode) => {
    let files: Array<{ path: string; content: string }> | null;
    try {
      files = await pickJsonFiles(mode);
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
    if (files === null) return CANCELLED;
    const plan = planGraphImport(files, get().getSavedGraphNames());
    if (plan.graphs.length === 0) {
      const why = plan.skipped.length ? ` (${plan.skipped.length} file${plan.skipped.length === 1 ? '' : 's'} skipped: ${plan.skipped[0].reason})` : '';
      return { ok: false, error: `No graphs found in what you picked${why}.` };
    }
    const folderIds = new Map(loadFolders('graphs').map(f => [f.label, f.id]));
    const imported: string[] = [];
    for (const g of plan.graphs) {
      const stored = safeSetItem(`shader-studio:${g.name}`, g.payload, `graph "${g.name}"`);
      if (!stored.ok) return { ok: false, error: stored.error, imported, skipped: plan.skipped };
      imported.push(g.name);
      if (g.folder) {
        let fid = folderIds.get(g.folder);
        if (!fid) { fid = createFolder('graphs', g.folder).id; folderIds.set(g.folder, fid); }
        moveItemsToFolder('graphs', [g.name], fid);
      }
    }
    window.dispatchEvent(new Event(SAVED_GRAPHS_CHANGED));
    window.dispatchEvent(new Event('assetbrowser-folders-changed'));
    return { ok: true, imported, skipped: plan.skipped };
  },
  disconnectedNotice: null,
  groupPresets: loadGroupPresets(),

  setMobileKeyframeEditor: (target) => set({ mobileKeyframeEditor: target }),
  setMobileKeyframeTool: (tool) => set({ mobileKeyframeTool: tool }),
  setMobileNodeOverlayOpen: (open) => set({ mobileNodeOverlayOpen: open }),
  setNodeHighlightFilter: (filter) => set({ nodeHighlightFilter: filter }),
  setRawGlslShader: (shader) => set({ rawGlslShader: shader }),
  setActiveGroupId: (id) => {
    if (!id) {
      // ── On exit: just clear the active group ─────────────────────────────────
      // Only anchor nodes (scenePos, sceneOutput, marchPos, etc.) carry the
      // _groupOriginal flag — they are stamped at creation time. Do NOT stamp
      // user-added nodes here; that would prevent them from ever being deleted.
      set({ activeGroupId: null, activeGroupPath: [] });
      return;
    }

    // ── Migrate legacy groups on enter ───────────────────────────────────────
    // Groups created before the _groupOriginal / auto-LoopIndex feature was
    // added won't have those stamps. Detect and fix them now so the invariants
    // hold regardless of when the group was created.
    set(state => {
      const groupNode = state.nodes.find(n => n.id === id);
      const sg = groupNode?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!sg) {
        if (groupNode?.type === 'sceneGroup' || groupNode?.type === 'marchLoopGroup' || groupNode?.type === 'giLitMarchGroup') {
          // Saved before groups got their contents at creation: build them now.
          const startingSubgraph = defaultSubgraphFor(groupNode.type)!;
          return {
            activeGroupId: id,
            activeGroupPath: [id],
            nodes: state.nodes.map(n =>
              n.id === id ? { ...n, params: { ...n.params, subgraph: startingSubgraph } } : n
            ),
          };
        }
        if (groupNode?.type === 'spaceWarpGroup') {
          // SpaceWarpGroup added from palette — initialise with a ScenePos node.
          const scenePosNode: import('../types/nodeGraph').GraphNode = {
            id: `scenepos_${Date.now()}`,
            type: 'scenePos',
            position: { x: 200, y: 200 },
            inputs: {},
            outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
            params: { _groupOriginal: true },
          };
          const emptySubgraph = { nodes: [scenePosNode], outputNodeId: '', outputKey: '' };
          return {
            activeGroupId: id,
            activeGroupPath: [id],
            nodes: state.nodes.map(n =>
              n.id === id ? { ...n, params: { ...n.params, subgraph: emptySubgraph } } : n
            ),
          };
        }
        // Group was added from palette with no subgraph — initialise an empty one
        // and inject a LoopIndex so the iteration counter `i` is always available.
        const loopIndexNode: import('../types/nodeGraph').GraphNode = {
          id: `loopidx_${Date.now()}`,
          type: 'loopIndex',
          position: { x: 200, y: 200 },
          inputs: {},
          outputs: { i: { type: 'float' as import('../types/nodeGraph').DataType, label: 'i' } },
          params: { _groupOriginal: true },
        };
        const emptySubgraph: import('../types/nodeGraph').SubgraphData = {
          nodes: [loopIndexNode],
          inputPorts: [],
          outputPorts: [],
        };
        return {
          activeGroupId: id,
          activeGroupPath: [id],
          nodes: state.nodes.map(n =>
            n.id === id ? { ...n, params: { ...n.params, subgraph: emptySubgraph } } : n
          ),
        };
      }

      // For scene-style groups: skip LoopIndex migration entirely, but inject missing anchor nodes.
      if (groupNode?.type === 'sceneGroup' || groupNode?.type === 'spaceWarpGroup' || groupNode?.type === 'marchLoopGroup' || groupNode?.type === 'giLitMarchGroup') {
        // Stamp only anchor node types as originals if not already done (legacy migration).
        // Never stamp user-added nodes — they must remain deletable.
        const SCENE_ANCHOR_TYPES = new Set(['scenePos', 'sceneOutput', 'marchPos', 'marchDist', 'marchOutput']);
        const alreadyMigratedSg = sg.nodes.some(n => n.params?._groupOriginal);
        let sgNodes = alreadyMigratedSg
          ? sg.nodes
          : sg.nodes.map(n => SCENE_ANCHOR_TYPES.has(n.type)
              ? { ...n, params: { ...n.params, _groupOriginal: true } }
              : n);

        const ts_anc = Date.now();

        if (groupNode.type === 'sceneGroup') {
          // Inject missing scenePos anchor
          if (!sgNodes.some(n => n.type === 'scenePos')) {
            const minX = sgNodes.length ? Math.min(...sgNodes.map(n => n.position.x)) : 80;
            const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 200;
            sgNodes = [...sgNodes, {
              id: `scenepos_${ts_anc}`,
              type: 'scenePos',
              position: { x: minX - 440, y: avgY },
              inputs: {},
              outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
              params: { _groupOriginal: true },
            }];
          }
          // Inject missing sceneOutput anchor
          if (!sgNodes.some(n => n.type === 'sceneOutput')) {
            const maxX = sgNodes.length ? Math.max(...sgNodes.map(n => n.position.x)) : 480;
            const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 200;
            sgNodes = [...sgNodes, {
              id: `sceneout_${ts_anc}`,
              type: 'sceneOutput',
              position: { x: maxX + 440, y: avgY },
              inputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance', ...legacySceneReturnWire(sg) } },
              outputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
              params: { _groupOriginal: true },
            }];
          }
        }

        if (groupNode.type === 'marchLoopGroup') {
          // Inject missing marchPos anchor
          if (!sgNodes.some(n => n.type === 'marchPos')) {
            const minX = sgNodes.length ? Math.min(...sgNodes.map(n => n.position.x)) : 80;
            const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 160;
            sgNodes = [...sgNodes, {
              id: `marchpos_${ts_anc}`,
              type: 'marchPos',
              position: { x: minX - 200, y: avgY - 40 },
              inputs: {},
              outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
              params: { _groupOriginal: true },
            }];
          }
          // Inject missing marchDist anchor
          if (!sgNodes.some(n => n.type === 'marchDist')) {
            const minX = sgNodes.length ? Math.min(...sgNodes.map(n => n.position.x)) : 80;
            const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 160;
            sgNodes = [...sgNodes, {
              id: `marchdist_${ts_anc}`,
              type: 'marchDist',
              position: { x: minX - 200, y: avgY + 80 },
              inputs: {},
              outputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Dist' }, t: { type: 'float' as import('../types/nodeGraph').DataType, label: 't' } },
              params: { _groupOriginal: true },
            }];
          }
          // Inject missing marchOutput anchor
          if (!sgNodes.some(n => n.type === 'marchOutput')) {
            const maxX = sgNodes.length ? Math.max(...sgNodes.map(n => n.position.x)) : 380;
            const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 160;
            sgNodes = [...sgNodes, {
              id: `marchout_${ts_anc}`,
              type: 'marchOutput',
              position: { x: maxX + 200, y: avgY },
              inputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
              outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
              params: { _groupOriginal: true },
            }];
          }
        }

        if (groupNode.type === 'giLitMarchGroup') {
          // Inject missing marchLoopInputs anchor (new-style only — no legacy path)
          if (!sgNodes.some(n => n.type === 'marchLoopInputs')) {
            const minX = sgNodes.length ? Math.min(...sgNodes.map(n => n.position.x)) : 80;
            const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 180;
            sgNodes = [...sgNodes, {
              id: `mlInputs_${ts_anc}`,
              type: 'marchLoopInputs',
              position: { x: minX - 200, y: avgY },
              inputs: {},
              outputs: {
                ro:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Origin' },
                rd:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Dir' },
                marchPos:  { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'March Pos' },
                marchDist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'March Dist' },
              },
              params: { _groupOriginal: true, extraInputs: [] },
            }];
          }
          // Inject missing marchLoopOutput anchor
          if (!sgNodes.some(n => n.type === 'marchLoopOutput')) {
            const maxX = sgNodes.length ? Math.max(...sgNodes.map(n => n.position.x)) : 480;
            const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 180;
            const inputsNode = sgNodes.find(n => n.type === 'marchLoopInputs');
            sgNodes = [...sgNodes, {
              id: `mlOutput_${ts_anc}`,
              type: 'marchLoopOutput',
              position: { x: maxX + 200, y: avgY },
              inputs: {
                pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position',
                  ...(inputsNode ? { connection: { nodeId: inputsNode.id, outputKey: 'marchPos' } } : {}) },
              },
              outputs: {},
              params: { _groupOriginal: true, hiddenOutputs: [] },
            }];
          }
        }

        const nodesChanged = sgNodes !== sg.nodes;
        if (!nodesChanged && alreadyMigratedSg) return { activeGroupId: id, activeGroupPath: [id] };

        return {
          activeGroupId: id,
          activeGroupPath: [id],
          nodes: state.nodes.map(n =>
            n.id === id ? { ...n, params: { ...n.params, subgraph: { ...sg, nodes: sgNodes } } } : n
          ),
        };
      }

      const alreadyMigrated = sg.nodes.some(n => n.params?._groupOriginal);
      const hasLoopIndex    = sg.nodes.some(n => n.type === 'loopIndex');

      if (alreadyMigrated && hasLoopIndex) return { activeGroupId: id, activeGroupPath: [id] };

      // Stamp only loopIndex nodes as originals (legacy migration).
      // Never stamp user-added nodes — they must remain deletable.
      const stampedNodes = alreadyMigrated
        ? sg.nodes
        : sg.nodes.map(n => n.type === 'loopIndex'
            ? { ...n, params: { ...n.params, _groupOriginal: true } }
            : n);

      // Inject a LoopIndex node if missing
      let finalNodes = stampedNodes;
      if (!hasLoopIndex) {
        const xs = stampedNodes.map(n => n.position.x);
        const ys = stampedNodes.map(n => n.position.y);
        const minX = xs.length ? Math.min(...xs) : 420;
        const minY = ys.length ? Math.min(...ys) : 200;
        const loopIndexNode: import('../types/nodeGraph').GraphNode = {
          id: `loopidx_${Date.now()}`,
          type: 'loopIndex',
          position: { x: minX - 220, y: minY },
          inputs: {},
          outputs: { i: { type: 'float', label: 'i' } },
          params: { _groupOriginal: true },
        };
        finalNodes = [...stampedNodes, loopIndexNode];
      }

      // Migrate missing ps_ sockets for inner node float params
      const groupNodeForMigration = state.nodes.find(n => n.id === id);
      const hasPsSockets = groupNodeForMigration
        ? Object.keys(groupNodeForMigration.inputs).some(k => k.startsWith('ps_'))
        : false;
      let updatedGroupInputs = groupNodeForMigration?.inputs ?? {};
      if (!hasPsSockets && groupNodeForMigration) {
        const newPsSockets: Record<string, import('../types/nodeGraph').InputSocket> = {};
        for (const sn of finalNodes) {
          const snDef = getNodeDefinitionFor(sn);
          const snParamDefs = snDef?.paramDefs ?? {};
          for (const [paramKey, paramDef] of Object.entries(snParamDefs)) {
            if (paramDef.type !== 'float') continue;
            if (paramDef.step === 1) continue;
            const psKey = `ps_${sn.id}_${paramKey}`;
            newPsSockets[psKey] = {
              type: 'float' as import('../types/nodeGraph').DataType,
              label: paramDef.label,
            };
          }
        }
        updatedGroupInputs = { ...updatedGroupInputs, ...newPsSockets };
      }

      const updatedNodes = state.nodes.map(n => {
        if (n.id !== id) return n;
        return {
          ...n,
          inputs: updatedGroupInputs,
          params: { ...n.params, subgraph: { ...sg, nodes: finalNodes } },
        };
      });
      return { activeGroupId: id, activeGroupPath: [id], nodes: updatedNodes };
    });
  },

  enterGroup: (id) => {
    const { activeGroupPath, nodes } = get();
    if (activeGroupPath.length >= 2) return; // max depth

    // Sealed groups compile as standalone functions — entering them is not allowed.
    {
      const ctxNodes = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
      if (ctxNodes.find(n => n.id === id)?.sealed) return;
    }

    // ── Initialise a fresh SceneGroup subgraph if needed ─────────────────────
    // setActiveGroupId handles this for its own path, but enterGroup is the
    // normal entry point from the UI (double-click / context menu). Without this,
    // a brand-new SceneGroup has no subgraph and any attempt to add nodes into it
    // is silently dropped by addNode's `if (!sg) return n` guard.
    //
    // Search current active level first (for groups nested inside other groups),
    // then fall back to top-level nodes.
    const activeNodes = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
    const groupNode = activeNodes.find(n => n.id === id);
    // newPath = the path we'll be at after entering
    const newPath = [...activeGroupPath, id];
    if ((groupNode?.type === 'sceneGroup' || groupNode?.type === 'marchLoopGroup' || groupNode?.type === 'giLitMarchGroup' || groupNode?.type === 'agentsGroup') && !groupNode.params?.subgraph) {
      // Saved before groups got their contents at creation: build them now.
      const startingSubgraph = defaultSubgraphFor(groupNode.type)!;
      set(state => ({
        activeGroupPath: newPath,
        activeGroupId: id,
        nodes: updateNodeInTree(state.nodes, id, newPath, n => ({ ...n, params: { ...n.params, subgraph: startingSubgraph } })),
      }));
      return;
    }
    if (groupNode?.type === 'spaceWarpGroup' && !groupNode.params?.subgraph) {
      const scenePosNode: import('../types/nodeGraph').GraphNode = {
        id: `scenepos_${Date.now()}`,
        type: 'scenePos',
        position: { x: 200, y: 200 },
        inputs: {},
        outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
        params: { _groupOriginal: true },
      };
      set(state => ({
        activeGroupPath: newPath,
        activeGroupId: id,
        nodes: updateNodeInTree(state.nodes, id, newPath, n => ({ ...n, params: { ...n.params, subgraph: { nodes: [scenePosNode], outputNodeId: '', outputKey: '' } } })),
      }));
      return;
    }
    // ── Initialise a fresh regular group subgraph if needed ─────────────────────
    if (groupNode?.type === 'group' && !groupNode.params?.subgraph) {
      const defaultSubgraph: import('../types/nodeGraph').SubgraphData = {
        nodes: [],
        inputPorts: [],
        outputPorts: [],
      };
      set(state => ({
        activeGroupPath: newPath,
        activeGroupId: id,
        nodes: updateNodeInTree(state.nodes, id, newPath, n => ({ ...n, params: { ...n.params, subgraph: defaultSubgraph } })),
      }));
      return;
    }

    // ── Migrate existing scene-style subgraphs: inject missing anchor nodes + stamp _groupOriginal ──
    if (
      (groupNode?.type === 'sceneGroup' || groupNode?.type === 'marchLoopGroup' || groupNode?.type === 'giLitMarchGroup') &&
      groupNode.params?.subgraph
    ) {
      type SG = { nodes: import('../types/nodeGraph').GraphNode[]; outputNodeId?: string; outputKey?: string; inputPorts?: unknown[]; outputPorts?: unknown[] };
      const sg = groupNode.params.subgraph as SG;
      let sgNodes = sg.nodes;
      let changed = false;
      const ts_m = Date.now();

      // Stamp _groupOriginal on anchor nodes only (legacy migration for graphs saved
      // before the _groupOriginal feature). Only run when NO nodes are stamped yet —
      // once any node has the flag, migration has already completed and user-added nodes
      // (which correctly lack the flag) must NOT be touched, or they become undeletable.
      const ANCHOR_TYPES_MIGRATION = new Set([
        'scenePos', 'sceneOutput', 'marchPos', 'marchDist', 'marchOutput',
        'marchLoopInputs', 'marchLoopOutput', 'loopIndex',
      ]);
      const alreadyMigrated = sgNodes.some(n => n.params?._groupOriginal);
      if (!alreadyMigrated) {
        sgNodes = sgNodes.map(n =>
          ANCHOR_TYPES_MIGRATION.has(n.type)
            ? { ...n, params: { ...n.params, _groupOriginal: true } }
            : n
        );
        changed = true;
      }

      if (groupNode.type === 'sceneGroup') {
        if (!sgNodes.some(n => n.type === 'scenePos')) {
          const minX = sgNodes.length ? Math.min(...sgNodes.map(n => n.position.x)) : 80;
          const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 200;
          sgNodes = [...sgNodes, {
            id: `scenepos_${ts_m}`, type: 'scenePos',
            position: { x: minX - 440, y: avgY },
            inputs: {}, outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
            params: { _groupOriginal: true },
          }];
          changed = true;
        }
        if (!sgNodes.some(n => n.type === 'sceneOutput')) {
          const maxX = sgNodes.length ? Math.max(...sgNodes.map(n => n.position.x)) : 480;
          const avgY = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 200;
          sgNodes = [...sgNodes, {
            id: `sceneout_${ts_m + 1}`, type: 'sceneOutput',
            position: { x: maxX + 440, y: avgY },
            inputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance', ...legacySceneReturnWire(sg) } },
            outputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
            params: { _groupOriginal: true },
          }];
          changed = true;
        }
      }

      if (groupNode.type === 'marchLoopGroup') {
        // Check if already using new-style anchors
        if (!sgNodes.some(n => n.type === 'marchLoopInputs')) {
          // Migrate legacy marchPos + marchDist → single marchLoopInputs
          const oldMarchPos  = sgNodes.find(n => n.type === 'marchPos');
          const oldMarchDist = sgNodes.find(n => n.type === 'marchDist');
          const oldMarchOut  = sgNodes.find(n => n.type === 'marchOutput');

          const newInputsId = `mlInputs_${ts_m}`;
          const posY = oldMarchPos ? oldMarchPos.position.y : oldMarchDist ? oldMarchDist.position.y : 180;
          const distY = oldMarchDist ? oldMarchDist.position.y : posY + 80;
          const midY = (posY + distY) / 2;
          const leftX = oldMarchPos ? Math.min(oldMarchPos.position.x, oldMarchDist?.position.x ?? oldMarchPos.position.x) : 80;

          const newInputsNode: import('../types/nodeGraph').GraphNode = {
            id: newInputsId,
            type: 'marchLoopInputs',
            position: { x: leftX, y: midY },
            inputs: {},
            outputs: {
              ro:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Origin' },
              rd:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Dir' },
              marchPos:  { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'March Pos' },
              marchDist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'March Dist' },
            },
            params: { _groupOriginal: true, extraInputs: [] },
          };

          // Remove old separate nodes
          sgNodes = sgNodes.filter(n => n.type !== 'marchPos' && n.type !== 'marchDist');

          // Reroute connections from old anchor nodes → new marchLoopInputs outputs
          sgNodes = sgNodes.map(n => {
            const newInputsMap = Object.fromEntries(
              Object.entries(n.inputs).map(([k, inp]) => {
                if (!inp.connection) return [k, inp];
                if (oldMarchPos && inp.connection.nodeId === oldMarchPos.id)
                  return [k, { ...inp, connection: { nodeId: newInputsId, outputKey: 'marchPos' } }];
                if (oldMarchDist && (inp.connection.nodeId === oldMarchDist.id))
                  return [k, { ...inp, connection: { nodeId: newInputsId, outputKey: 'marchDist' } }];
                return [k, inp];
              })
            );
            return { ...n, inputs: newInputsMap };
          });

          sgNodes = [newInputsNode, ...sgNodes];

          // Migrate or inject marchLoopOutput
          if (oldMarchOut) {
            sgNodes = sgNodes.map(n =>
              n.id === oldMarchOut.id
                ? { ...n, type: 'marchLoopOutput', params: { ...n.params, hiddenOutputs: [] } }
                : n
            );
          } else {
            const maxX2 = sgNodes.length ? Math.max(...sgNodes.map(n => n.position.x)) : 480;
            const avgY2 = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 180;
            sgNodes = [...sgNodes, {
              id: `mlOutput_${ts_m + 1}`,
              type: 'marchLoopOutput',
              position: { x: maxX2 + 200, y: avgY2 },
              inputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
              outputs: {},
              params: { _groupOriginal: true, hiddenOutputs: [] },
            } as import('../types/nodeGraph').GraphNode];
          }
          changed = true;
        } else if (!sgNodes.some(n => n.type === 'marchLoopOutput')) {
          // New-style inputs but missing output — inject it
          const maxX3 = sgNodes.length ? Math.max(...sgNodes.map(n => n.position.x)) : 480;
          const avgY3 = sgNodes.length ? sgNodes.reduce((s, n) => s + n.position.y, 0) / sgNodes.length : 180;
          sgNodes = [...sgNodes, {
            id: `mlOutput_${ts_m}`,
            type: 'marchLoopOutput',
            position: { x: maxX3 + 200, y: avgY3 },
            inputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
            outputs: {},
            params: { _groupOriginal: true, hiddenOutputs: [] },
          } as import('../types/nodeGraph').GraphNode];
          changed = true;
        }
      }

      if (changed) {
        set(state => ({
          activeGroupPath: newPath,
          activeGroupId: id,
          nodes: updateNodeInTree(state.nodes, id, newPath, n => ({ ...n, params: { ...n.params, subgraph: { ...sg, nodes: sgNodes } } })),
        }));
        return;
      }
    }

    set(() => ({ activeGroupPath: newPath, activeGroupId: id }));
  },

  exitGroup: () => {
    const path = get().activeGroupPath;
    if (path.length === 0) return;
    const exitingId = path[path.length - 1];
    const newPath = path.slice(0, -1);
    set(state => {
      const exitingNode = state.nodes.find(n => n.id === exitingId);
      const isSceneStyleGroup = exitingNode?.type === 'sceneGroup' || exitingNode?.type === 'spaceWarpGroup' || exitingNode?.type === 'marchLoopGroup' || exitingNode?.type === 'giLitMarchGroup';
      if (isSceneStyleGroup) {
        const sg = exitingNode.params.subgraph as { nodes: import('../types/nodeGraph').GraphNode[] } | undefined;
        const newPsSockets: Record<string, import('../types/nodeGraph').InputSocket> = {};
        let anyNew = false;
        if (sg?.nodes) {
          for (const sn of sg.nodes) {
            const snDef = getNodeDefinitionFor(sn);

            // ExprBlock: surface slider inputs from params.inputs
            if (sn.type === 'exprNode') {
              const dynInputs = sn.params.inputs as Array<{ name: string; type: string; slider: { min: number; max: number } | null }> | undefined;
              for (const inp of (dynInputs ?? [])) {
                if (inp.type !== 'float' || !inp.slider) continue;
                const psKey = `ps_${sn.id}_${inp.name}`;
                if (!exitingNode.inputs[psKey]) {
                  newPsSockets[psKey] = { type: 'float' as import('../types/nodeGraph').DataType, label: inp.name };
                  anyNew = true;
                }
              }
              continue;
            }

            if (!snDef?.paramDefs) continue;
            for (const [paramKey, paramDef] of Object.entries(snDef.paramDefs)) {
              if ((paramDef as import('../types/nodeGraph').ParamDef).type !== 'float') continue;
              if ((paramDef as import('../types/nodeGraph').ParamDef).step === 1) continue;
              const psKey = `ps_${sn.id}_${paramKey}`;
              if (!exitingNode.inputs[psKey]) {
                newPsSockets[psKey] = {
                  type: 'float' as import('../types/nodeGraph').DataType,
                  label: (paramDef as import('../types/nodeGraph').ParamDef).label,
                };
                anyNew = true;
              }
            }
          }
        }
        if (anyNew) {
          return {
            activeGroupPath: newPath,
            activeGroupId: newPath[newPath.length - 1] ?? null,
            nodes: state.nodes.map(n =>
              n.id === exitingId ? { ...n, inputs: { ...n.inputs, ...newPsSockets } } : n
            ),
          };
        }
      }
      return { activeGroupPath: newPath, activeGroupId: newPath[newPath.length - 1] ?? null };
    });
  },

  exitToRoot: () => {
    set({ activeGroupPath: [], activeGroupId: null });
  },

  exitToDepth: (depth) => {
    const path = get().activeGroupPath;
    const newPath = path.slice(0, depth);
    set({ activeGroupPath: newPath, activeGroupId: newPath[newPath.length - 1] ?? null });
  },

  duplicateGroup: (groupId) => {
    const { nodes, activeGroupPath } = get();
    undoManager.push(nodes, { label: `Duplicated ${nodeName(nodeInScope(get(), groupId))}`, nodeIds: [groupId] });
    const activeNodes = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
    const groupNode = activeNodes.find(n => n.id === groupId);
    if (!groupNode || groupNode.type !== 'group') return null;
    const cloned = deepCloneGroupNode(groupNode);
    // Clear all input connections — duplicate spawns unconnected
    const clearedInputs = Object.fromEntries(
      Object.entries(cloned.inputs).map(([k, v]) => [k, { ...v, connection: undefined }])
    );
    const newNode = { ...cloned, inputs: clearedInputs, position: { x: groupNode.position.x + 60, y: groupNode.position.y + 60 } };
    if (activeGroupPath.length > 0) {
      const newActiveNodes = [...activeNodes, newNode];
      const newNodes = setActiveNodes(nodes, activeGroupPath, newActiveNodes);
      if (newNodes) set({ nodes: newNodes });
    } else {
      set(state => ({ nodes: [...state.nodes, newNode] }));
    }
    get().compile();
    return newNode.id;
  },

  duplicateNode: (nodeId) => {
    const { nodes, activeGroupPath } = get();
    undoManager.push(nodes, { label: `Duplicated ${nodeName(nodeInScope(get(), nodeId))}`, nodeIds: [nodeId] });
    const activeNodes = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
    const node = activeNodes.find(n => n.id === nodeId);
    if (!node) return null;
    const newId = idGenerator.next();
    const clearedInputs = Object.fromEntries(
      Object.entries(node.inputs).map(([k, v]) => [k, { ...v, connection: undefined }])
    );
    const newNode = { ...node, id: newId, inputs: clearedInputs, position: { x: node.position.x + 60, y: node.position.y + 60 } };
    if (activeGroupPath.length > 0) {
      const newActiveNodes = [...activeNodes, newNode];
      const newNodes = setActiveNodes(nodes, activeGroupPath, newActiveNodes);
      if (newNodes) set({ nodes: newNodes });
    } else {
      set(state => ({ nodes: [...state.nodes, newNode] }));
    }
    get().compile();
    return newId;
  },

  duplicateNodes: (nodeIds) => {
    const { nodes, activeGroupPath } = get();
    undoManager.push(nodes, { label: `Duplicated ${nodeIds.length === 1 ? nodeName(nodeInScope(get(), nodeIds[0])) : `${nodeIds.length} nodes`}`, nodeIds });
    const activeNodes = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
    const newNodes = nodeIds.flatMap(nodeId => {
      const node = activeNodes.find(n => n.id === nodeId);
      if (!node) return [];
      const newId = idGenerator.next();
      const clearedInputs = Object.fromEntries(
        Object.entries(node.inputs).map(([k, v]) => [k, { ...v, connection: undefined }])
      );
      return [{ ...node, id: newId, inputs: clearedInputs, position: { x: node.position.x + 60, y: node.position.y + 60 } }];
    });
    if (!newNodes.length) return;
    if (activeGroupPath.length > 0) {
      const updated = setActiveNodes(nodes, activeGroupPath, [...activeNodes, ...newNodes]);
      if (updated) set({ nodes: updated });
    } else {
      // A loose 3D shape copied on the top level goes into the scene the graph draws, like an added one.
      let top = [...nodes];
      const intoScene: string[] = [];
      for (const copy of newNodes) {
        const def = getNodeDefinitionFor(copy);
        const role = def ? sceneRole(def) : null;
        const target = role ? targetScene(top, copy.position) : null;
        const sub = target?.params.subgraph as SubgraphData | undefined;
        const placed = role && target && sub ? addToScene(() => idGenerator.next(), sub, { ...copy }, role, { byHand: false }) : null;
        if (target && placed) {
          top = top.map(n => n.id === target.id ? { ...n, params: { ...n.params, subgraph: placed.subgraph } } : n);
          intoScene.push(def!.label);
        } else top.push(copy);
      }
      set({ nodes: top });
      if (intoScene.length) toast.info('3D node placed', { message: `The copy of ${intoScene.join(', ')} went into the existing Scene Group, joined with a Union and moved beside what was there.` });
    }
    get().compile();
  },
  setLoopVolumetric: (nodeId, on) => {
    const { nodes, activeGroupPath } = get();
    const scope = getActiveNodes(nodes, activeGroupPath) ?? nodes;
    const loop = scope.find(n => n.id === nodeId);
    if (!loop) return;
    if (!VOLUMETRIC_LOOP_TYPES.has(loop.type)) { get().updateNodeParams(nodeId, { volumetric: on }, { immediate: true }); return; }
    if ((loop.params.volumetric === true) === on) return;
    undoManager.push(nodes, { label: on ? 'Turned Volumetric on' : 'Turned Volumetric off', nodeIds: [nodeId] });
    const r = on ? volumetricOn(() => idGenerator.next(), scope, nodeId) : volumetricOff(scope, nodeId);
    const updated = activeGroupPath.length ? setActiveNodes(nodes, activeGroupPath, r.nodes) : r.nodes;
    if (!updated) return;
    set({ nodes: updated });
    get().compile();
    if (r.summary) toast.info(on ? 'Volumetric on' : 'Volumetric off', { message: r.summary });
  },

  openGridRulesAsNodes: (nodeId) => {
    const st = get();
    const made = openGridRulesInGraph(nodeId, st.nodes, () => idGenerator.next());
    if ('problem' in made) { toast.info('Can\'t open these rules as nodes', { message: made.problem }); return null; }
    undoManager.push(st.nodes, { label: 'Opened Grid Rules as nodes' });
    set({ nodes: made.nodes });
    get().compile();
    toast.info('Grid Rules opened as nodes', {
      message: `The same simulation, built from ordinary nodes, is below it${made.kept ? '' : ', wired where the Grid Rules node was'}; the Grid Rules node is left as it was: delete it when you like. Every node has a note.`,
    });
    return made.boardId;
  },
  openParticlesAsNodes: (nodeId) => {
    const st = get();
    const src = st.nodes.find(nd => nd.id === nodeId);
    if (!src || src.type !== 'gpuParticles') {
      toast.info('Open as nodes works on a Particles node at the top level', { message: 'Leave the group it is in (or move it out) and try again.' });
      return null;
    }
    const made = particlesAsNodes(src, () => idGenerator.next(), { x: src.position.x, y: src.position.y + 520 });
    undoManager.push(st.nodes, { label: 'Opened Particles as nodes' });
    // What read the Particles node reads the copy's Draw agents now (the original stays, unwired).
    let kept = 0;
    const rewired = st.nodes.map(nd => {
      let changed = false;
      const inputs = Object.fromEntries(Object.entries(nd.inputs).map(([k, inp]) => {
        const c = inp.connection;
        if (!c || c.nodeId !== nodeId) return [k, inp];
        const to = made.outputs[c.outputKey as 'color' | 'particles' | 'density'];
        if (!to) { kept++; return [k, inp]; }
        changed = true;
        return [k, { ...inp, connection: { ...to } }];
      }));
      return changed ? { ...nd, inputs } : nd;
    });
    set({ nodes: [...rewired, ...made.nodes] });
    // An Image emitter: the node's picture, copied into the Texture Input the copy is born on.
    const tex = made.imageId ? st.nodeTextures[`${nodeId}::image`] : null;
    if (made.imageId && tex) {
      const copy = tex.clone();
      copy.needsUpdate = true;
      get().setNodeTexture(made.imageId, copy);
      const img = tex.image as { width?: number; height?: number } | undefined;
      const aspect = img?.width && img.height ? img.width / img.height : 1;
      const thumb = src.params.__tex_image_thumb;
      set(s2 => ({ nodes: s2.nodes.map(nd => (nd.id === made.imageId ? { ...nd, params: { ...nd.params, _imageAspect: aspect, ...(typeof thumb === 'string' ? { _thumbnailUrl: thumb } : {}) } } : nd)) }));
    }
    get().compile();
    const notCarried = made.missing.length ? ` Not carried over yet: ${made.missing.join(' ')}` : '';
    toast.info('Particles opened as nodes', {
      message: `An Agents group with the same settings is below it${kept ? ' (its Particles output still reads the original: the copy has no "particles alone" with Over wired)' : ', wired where the Particles node was'}; the Particles node is left as it was: delete it when you like. Double-click the group to see its forces; every node has a note.${notCarried}`,
      ...(made.missing.length ? { sticky: true } : {}),
    });
    return made.groupId;
  },
  setNodeTexture: (nodeId, texture) => set(state => ({
    nodeTextures: { ...state.nodeTextures, [nodeId]: texture },
  })),
  setVideoTexture: (nodeId, texture) => set(state => ({
    videoTextures: { ...state.videoTextures, [nodeId]: texture },
  })),
  setNodePreview: (nodeId, dataUrl) => set(state => ({
    nodePreviews: { ...state.nodePreviews, [nodeId]: dataUrl },
  })),
  setAudioMasterVolume: (v) => {
    // Side-effect: update the Web Audio gain node immediately
    audioEngine.setMasterVolume(v);
    set({ audioMasterVolume: Math.max(0, Math.min(1, v)) });
  },
  registerFitView: (cb) => set({ _fitViewCallback: cb }),
  registerViewportCenterGetter: (cb) => set({ _viewportCenterGetter: cb }),
  registerSetView: (cb) => set({ _setViewCallback: cb }),
  setSwapTargetNodeId: (id) => set({ swapTargetNodeId: id }),
  setSearchPaletteOpen: (open) => set({ searchPaletteOpen: open }),

  groupNodes: (nodeIds, label?) => {
    const { nodes, activeGroupPath } = get();
    if (nodeIds.length < 1) return null;

    // Depth guard: can't group when already at max depth
    if (activeGroupPath.length >= 2) return null;

    // When inside a group, operate on the active subgraph nodes
    const workingNodes = activeGroupPath.length > 0
      ? (getActiveNodes(nodes, activeGroupPath) ?? nodes)
      : nodes;

    const selectedSet = new Set(nodeIds);
    const selectedNodes = workingNodes.filter(n => selectedSet.has(n.id));
    if (selectedNodes.length === 0) return null;

    // Reject if any output nodes are in the selection
    if (selectedNodes.some(n => n.type === 'output' || n.type === 'vec4Output')) return null;

    undoManager.push(nodes, { label: `Grouped ${nodesPhrase(selectedNodes)}`, nodeIds });

    // ── Discover dangling connections ────────────────────────────────────────
    const inputPorts: import('../types/nodeGraph').GroupInputPort[] = [];
    const outputPorts: import('../types/nodeGraph').GroupOutputPort[] = [];
    // Track which outer connections feed into the group (for group node's input sockets)
    const groupInputSockets: Record<string, import('../types/nodeGraph').InputSocket> = {};
    // Track which outer nodes need their connections updated to point at the group
    const outerReplacements: Array<{ nodeId: string; inputKey: string; newConnection: { nodeId: string; outputKey: string } }> = [];

    let portIdx = 0;
    // nodeId -> inputKey -> portKey, so the dangling connection below can be
    // rewritten to the '__port__' sentinel instead of left pointing at the
    // (now-removed) outer node — see resolveGroupPortOverrides in
    // shaderAssembler.ts for why: it's what lets the port be reused by more
    // than one internal target, and lets the target be freely rewired or
    // disconnected from inside the group afterward.
    const danglingToPort = new Map<string, Map<string, string>>();

    // INPUT PORTS: selected node inputs wired to non-selected nodes
    for (const sn of selectedNodes) {
      for (const [key, inp] of Object.entries(sn.inputs)) {
        if (!inp.connection) continue;
        if (selectedSet.has(inp.connection.nodeId)) continue;
        // This is a dangling input — create an input port
        const portKey = `in${portIdx++}`;
        inputPorts.push({
          key: portKey,
          type: inp.type,
          label: inp.connection.outputKey !== key ? inp.connection.outputKey : key,
          toNodeId: sn.id,
          toInputKey: key,
        });
        if (!danglingToPort.has(sn.id)) danglingToPort.set(sn.id, new Map());
        danglingToPort.get(sn.id)!.set(key, portKey);
        groupInputSockets[portKey] = {
          type: inp.type,
          label: key,
          connection: { ...inp.connection },
        };
      }
    }

    // Add param input sockets for each inner node's float paramDefs
    for (const sn of selectedNodes) {
      const snDef = getNodeDefinitionFor(sn);
      const snParamDefs = snDef?.paramDefs ?? {};
      for (const [paramKey, paramDef] of Object.entries(snParamDefs)) {
        if (paramDef.type !== 'float') continue;
        if (paramDef.step === 1) continue; // skip integer params
        const psKey = `ps_${sn.id}_${paramKey}`;
        groupInputSockets[psKey] = {
          type: 'float' as import('../types/nodeGraph').DataType,
          label: paramDef.label,
        };
      }
    }

    // OUTPUT PORTS: non-selected nodes wired to selected node outputs
    const seenOutputs = new Set<string>(); // "fromNodeId:fromOutputKey"
    for (const n of workingNodes) {
      if (selectedSet.has(n.id)) continue;
      for (const [key, inp] of Object.entries(n.inputs)) {
        if (!inp.connection) continue;
        if (!selectedSet.has(inp.connection.nodeId)) continue;
        const sig = `${inp.connection.nodeId}:${inp.connection.outputKey}`;
        let portKey: string;
        const existing = outputPorts.find(p => `${p.fromNodeId}:${p.fromOutputKey}` === sig);
        if (existing) {
          portKey = existing.key;
        } else {
          // Determine the output type from the source node definition
          const srcNode = selectedNodes.find(sn => sn.id === inp.connection!.nodeId);
          const srcDef = srcNode ? getNodeDefinitionFor(srcNode) : undefined;
          const outType: import('../types/nodeGraph').DataType =
            srcNode?.outputs[inp.connection.outputKey]?.type ??
            srcDef?.outputs[inp.connection.outputKey]?.type ??
            'float';
          portKey = `out${portIdx++}`;
          outputPorts.push({
            key: portKey,
            type: outType,
            label: inp.connection.outputKey,
            fromNodeId: inp.connection.nodeId,
            fromOutputKey: inp.connection.outputKey,
          });
          seenOutputs.add(sig);
        }
        outerReplacements.push({ nodeId: n.id, inputKey: key, newConnection: { nodeId: '__group__', outputKey: portKey } });
      }
    }

    // Auto-create a float output port when no explicit outer connections were found.
    // Inside scene groups the SDF result flows implicitly, so nothing triggers the
    // scan above — we need to expose the terminal float output ourselves.
    if (outputPorts.length === 0) {
      const internallyConsumed = new Set<string>();
      for (const sn of selectedNodes) {
        for (const inp of Object.values(sn.inputs)) {
          if (inp.connection && selectedSet.has(inp.connection.nodeId)) {
            internallyConsumed.add(`${inp.connection.nodeId}:${inp.connection.outputKey}`);
          }
        }
      }
      let sinkNodeId = '';
      let sinkOutKey = '';
      for (const sn of selectedNodes) {
        if (sn.type === 'loopIndex') continue;
        const snDef = getNodeDefinitionFor(sn);
        if (!snDef) continue;
        for (const [outKey, outSock] of Object.entries(snDef.outputs)) {
          if (outSock.type !== 'float') continue;
          if (!internallyConsumed.has(`${sn.id}:${outKey}`)) {
            sinkNodeId = sn.id;
            sinkOutKey = outKey;
          }
        }
      }
      if (sinkNodeId) {
        const portKey = `out${portIdx++}`;
        outputPorts.push({ key: portKey, type: 'float', label: sinkOutKey, fromNodeId: sinkNodeId, fromOutputKey: sinkOutKey });
      }
    }

    // Build group output sockets
    const groupOutputSockets: Record<string, import('../types/nodeGraph').OutputSocket> = {};
    for (const p of outputPorts) {
      groupOutputSockets[p.key] = { type: p.type, label: p.label };
    }

    // Place group at bounding box centre of selected nodes
    const xs = selectedNodes.map(n => n.position.x);
    const ys = selectedNodes.map(n => n.position.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

    // Mark all original selected nodes as immutable within the group (only
    // the node itself can't be deleted — its wiring, incl. the dangling
    // inputs just turned into ports below, stays freely editable).
    const originalNodes = selectedNodes.map(n => {
      const portMap = danglingToPort.get(n.id);
      const inputs = portMap
        ? Object.fromEntries(Object.entries(n.inputs).map(([k, inp]) => {
            const portKey = portMap.get(k);
            return [k, portKey ? { ...inp, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: portKey } } : inp];
          }))
        : n.inputs;
      return { ...n, inputs, params: { ...n.params, _groupOriginal: true } };
    });

    // Auto-inject a LoopIndex node so iteration counter `i` is always accessible
    const loopIndexNode: import('../types/nodeGraph').GraphNode = {
      id: idGenerator.next(),
      type: 'loopIndex',
      position: { x: Math.min(...xs) - 220, y: Math.min(...ys) },
      inputs: {},
      outputs: { i: { type: 'float', label: 'i' } },
      params: { _groupOriginal: true },
    };

    const groupId = idGenerator.next();
    const subgraph: import('../types/nodeGraph').SubgraphData = {
      nodes: [...originalNodes, loopIndexNode],
      inputPorts,
      outputPorts,
    };
    // Auto-surface params from any inner group nodes
    const surfacedParams = pickSurfacedParams([...originalNodes, loopIndexNode]);

    // Add ps_ sockets for surfaced params from inner groups
    for (const sp of surfacedParams) {
      const psKey = `ps_${sp.innerGroupId}_${sp.nodeId}_${sp.paramKey}`;
      const innerGrpNode = selectedNodes.find(n => n.id === sp.innerGroupId);
      const innerSub = innerGrpNode?.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      const innNode = innerSub?.nodes.find(n => n.id === sp.nodeId);
      if (!innNode) continue;
      const innDef = getNodeDefinitionFor(innNode);
      const paramDef = innDef?.paramDefs?.[sp.paramKey];
      if (!paramDef) continue;
      groupInputSockets[psKey] = {
        type: 'float' as import('../types/nodeGraph').DataType,
        label: sp.label ?? paramDef.label,
      };
    }

    const groupNode: import('../types/nodeGraph').GraphNode = {
      id: groupId,
      type: 'group',
      position: { x: cx, y: cy },
      inputs: groupInputSockets,
      outputs: groupOutputSockets,
      params: {
        label: label ?? 'Group',
        subgraph,
        ...(surfacedParams.length > 0 ? { surfacedParams } : {}),
      },
    };

    // Replace outer connections that pointed into the group
    const updatedNodes = workingNodes
      .filter(n => !selectedSet.has(n.id))
      .map(n => {
        const replacements = outerReplacements.filter(r => r.nodeId === n.id);
        if (replacements.length === 0) return n;
        const newInputs = { ...n.inputs };
        for (const r of replacements) {
          newInputs[r.inputKey] = {
            ...newInputs[r.inputKey],
            connection: { nodeId: groupId, outputKey: r.newConnection.outputKey },
          };
        }
        return { ...n, inputs: newInputs };
      });

    const finalNodes = [...updatedNodes, groupNode];
    if (activeGroupPath.length > 0) {
      const newNodes = setActiveNodes(nodes, activeGroupPath, finalNodes);
      if (newNodes) set({ nodes: newNodes });
    } else {
      set({ nodes: finalNodes });
    }
    get().compile();
    return groupId;
  },

  ungroupNode: (groupId) => {
    const { nodes, activeGroupPath } = get();

    // Find the group node — check top-level first, then active subgraph
    let groupNode = nodes.find(n => n.id === groupId);
    let workingNodes = nodes;
    let isNested = false;

    if (!groupNode && activeGroupPath.length > 0) {
      const subNodes = getActiveNodes(nodes, activeGroupPath);
      const found = subNodes?.find(n => n.id === groupId);
      if (found && subNodes) {
        groupNode = found;
        workingNodes = subNodes;
        isNested = true;
      }
    }

    if (!groupNode || groupNode.type !== 'group') return;

    const subgraph = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;

    // Iterated groups are ungrouped as a single-pass (iterations=1 equivalent).
    // The for-loop carry logic is discarded; connections from inputPorts are still repaired correctly.

    undoManager.push(nodes, { label: `Ungrouped ${nodeName(groupNode)}`, nodeIds: [groupId] });

    if (!subgraph) {
      const newWorking = workingNodes.filter(n => n.id !== groupId);
      const newNodes = isNested ? setActiveNodes(nodes, activeGroupPath, newWorking) : newWorking;
      if (newNodes) set({ nodes: newNodes });
      get().compile();
      return;
    }

    // Collect IDs of loopIndex nodes so we can disconnect references to `i`
    const loopIndexIds = new Set(
      subgraph.nodes.filter(n => n.type === 'loopIndex').map(n => n.id)
    );

    // Build a map of authoritative outer connections by scanning subgraph
    // nodes for the GROUP_PORT_SENTINEL connection (see groupNodes), not the
    // port's own legacy toNodeId/toInputKey — a port can now be rewired to a
    // different internal node (or shared by several), so the sentinel scan
    // is the only way to know who's *actually* fed by it at ungroup time.
    const portOuterConn = new Map<string, { nodeId: string; outputKey: string }>();
    for (const port of (subgraph.inputPorts ?? [])) {
      const outerConn = groupNode.inputs[port.key]?.connection;
      if (outerConn) portOuterConn.set(port.key, outerConn);
    }
    const outerConnectionPatch = new Map<string, Record<string, { nodeId: string; outputKey: string }>>();
    for (const sn of subgraph.nodes) {
      for (const [k, inp] of Object.entries(sn.inputs)) {
        if (inp.connection?.nodeId !== GROUP_PORT_SENTINEL) continue;
        const outerConn = portOuterConn.get(inp.connection.outputKey);
        if (!outerConn) continue;
        const nodePatches = outerConnectionPatch.get(sn.id) ?? {};
        nodePatches[k] = outerConn;
        outerConnectionPatch.set(sn.id, nodePatches);
      }
    }

    // Restore subgraph nodes — exclude auto-injected sentinels (loopIndex) and
    // strip the _groupOriginal flag so nodes are editable again.
    // Re-wire outer connections from inputPorts (authoritative) and disconnect loopIndex refs.
    const restoredNodes = subgraph.nodes
      .filter(n => n.type !== 'loopIndex')
      .map(n => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _groupOriginal, ...restParams } = n.params as Record<string, unknown>;
        const patches = outerConnectionPatch.get(n.id);
        const cleanInputs: typeof n.inputs = {};
        for (const [k, inp] of Object.entries(n.inputs)) {
          if (patches?.[k]) {
            // Re-establish the authoritative outer connection from inputPorts
            cleanInputs[k] = { ...inp, connection: patches[k] };
          } else if (inp.connection && loopIndexIds.has(inp.connection.nodeId)) {
            // Disconnect dangling loopIndex reference
            cleanInputs[k] = { ...inp, connection: undefined };
          } else {
            cleanInputs[k] = inp;
          }
        }
        return { ...n, params: restParams, inputs: cleanInputs };
      });

    // Reconnect peer nodes: replace connections pointing to groupId with
    // connections to the actual subgraph node from the outputPort mapping.
    const updatedOuter = workingNodes
      .filter(n => n.id !== groupId)
      .map(n => {
        const newInputs = { ...n.inputs };
        let changed = false;
        for (const [key, inp] of Object.entries(n.inputs)) {
          if (inp.connection?.nodeId !== groupId) continue;
          const portKey = inp.connection.outputKey;
          const outPort = subgraph.outputPorts.find(p => p.key === portKey);
          if (outPort) {
            newInputs[key] = { ...inp, connection: { nodeId: outPort.fromNodeId, outputKey: outPort.fromOutputKey } };
            changed = true;
          }
        }
        return changed ? { ...n, inputs: newInputs } : n;
      });

    const finalNodes = [...updatedOuter, ...restoredNodes];
    const newNodes = isNested ? setActiveNodes(nodes, activeGroupPath, finalNodes) : finalNodes;
    if (newNodes) set({ nodes: newNodes });
    get().compile();
  },

  renameGroupPort: (nodeId, portKey, dir, newLabel) => {
    set(state => ({
      nodes: state.nodes.map(n => {
        if (n.id !== nodeId) return n;
        if (!['group', 'sceneGroup', 'spaceWarpGroup', 'marchLoopGroup', 'giLitMarchGroup'].includes(n.type)) return n;
        const subgraph = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!subgraph) return n;
        const updatedSubgraph: import('../types/nodeGraph').SubgraphData = {
          ...subgraph,
          inputPorts: dir === 'in'
            ? subgraph.inputPorts.map(p => p.key === portKey ? { ...p, label: newLabel } : p)
            : subgraph.inputPorts,
          outputPorts: dir === 'out'
            ? subgraph.outputPorts.map(p => p.key === portKey ? { ...p, label: newLabel } : p)
            : subgraph.outputPorts,
        };
        const updatedInputs = dir === 'in' && n.inputs[portKey]
          ? { ...n.inputs, [portKey]: { ...n.inputs[portKey], label: newLabel } }
          : n.inputs;
        const updatedOutputs = dir === 'out' && n.outputs[portKey]
          ? { ...n.outputs, [portKey]: { ...n.outputs[portKey], label: newLabel } }
          : n.outputs;
        return { ...n, inputs: updatedInputs, outputs: updatedOutputs, params: { ...n.params, subgraph: updatedSubgraph } };
      }),
    }));
  },

  createLooseGroup: (nodeIds, label) => {
    const { nodes, looseGroups, activeGroupPath } = get();
    const activeNodes = getActiveNodes(nodes, activeGroupPath) ?? nodes;
    const validIds = nodeIds.filter(id => activeNodes.some(n => n.id === id));
    if (validIds.length < 2) return null;

    undoManager.push(nodes, { label: `Boxed ${validIds.length} nodes together`, nodeIds: validIds });
    const members = activeNodes.filter(n => validIds.includes(n.id));
    const xs = members.map(n => n.position.x), ys = members.map(n => n.position.y);
    const newGroup: import('../types/nodeGraph').LooseGroup = {
      id: idGenerator.next(),
      label: label ?? 'Group',
      memberIds: validIds,
      collapsed: true,
      position: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
    };
    const activeLoose = getActiveLooseGroups(nodes, looseGroups, activeGroupPath);
    const { nodes: newNodes, looseGroups: newTopLoose } = setActiveLooseGroups(nodes, looseGroups, activeGroupPath, [...activeLoose, newGroup]);
    set({ nodes: newNodes, looseGroups: newTopLoose });
    return newGroup.id;
  },

  ungroupLoose: (groupId) => {
    const { nodes, looseGroups, activeGroupPath } = get();
    const activeLoose = getActiveLooseGroups(nodes, looseGroups, activeGroupPath);
    if (!activeLoose.some(g => g.id === groupId)) return;
    undoManager.push(nodes, { label: 'Removed a group box' });
    const { nodes: newNodes, looseGroups: newTopLoose } = setActiveLooseGroups(nodes, looseGroups, activeGroupPath, activeLoose.filter(g => g.id !== groupId));
    set({ nodes: newNodes, looseGroups: newTopLoose });
  },

  // Collapse/rename are undo-exempt (same reasoning saveGroupPreset's own
  // cosmetic-only writes skip it) — purely a view toggle/label, never worth
  // burning an undo step, and never touches anything that would need a
  // recompile.
  toggleLooseGroupCollapsed: (groupId) => {
    const { nodes, looseGroups, activeGroupPath } = get();
    const activeLoose = getActiveLooseGroups(nodes, looseGroups, activeGroupPath);
    const newLoose = activeLoose.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g);
    const { nodes: newNodes, looseGroups: newTopLoose } = setActiveLooseGroups(nodes, looseGroups, activeGroupPath, newLoose);
    set({ nodes: newNodes, looseGroups: newTopLoose });
  },

  renameLooseGroup: (groupId, label) => {
    const { nodes, looseGroups, activeGroupPath } = get();
    const activeLoose = getActiveLooseGroups(nodes, looseGroups, activeGroupPath);
    const newLoose = activeLoose.map(g => g.id === groupId ? { ...g, label } : g);
    const { nodes: newNodes, looseGroups: newTopLoose } = setActiveLooseGroups(nodes, looseGroups, activeGroupPath, newLoose);
    set({ nodes: newNodes, looseGroups: newTopLoose });
  },

  saveGroupPreset: async (groupNodeId, label, description) => {
    const { nodes, activeGroupPath } = get();
    const searchNodes = activeGroupPath.length > 0
      ? (getActiveNodes(nodes, activeGroupPath) ?? nodes)
      : nodes;
    const groupNode = searchNodes.find(n => n.id === groupNodeId && n.type === 'group');
    if (!groupNode) return { ok: false, error: 'Group node not found' };
    const subgraph = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (!subgraph) return { ok: false, error: 'Group node has no subgraph to save' };
    const preset: GroupPreset = {
      id: `gp_${Date.now()}`,
      label: label ?? (typeof groupNode.params.label === 'string' ? groupNode.params.label : 'Group'),
      // The group's comment stands in when the save form's description is left empty
      description: description || (typeof groupNode.params.__comment === 'string' && groupNode.params.__comment.trim()) || undefined,
      subgraph,
      savedAt: Date.now(),
    };
    // save() writes localStorage synchronously, so re-reading here sees the new preset.
    const result = groupPresetManager.save(preset);
    set({ groupPresets: loadGroupPresets() });
    return result;
  },

  deleteGroupPreset: (presetId) => {
    groupPresetManager.delete(presetId);
    set({ groupPresets: loadGroupPresets() });
  },

  instantiateGroupPreset: (presetId, position) => {
    const preset = get().groupPresets.find(p => p.id === presetId);
    if (!preset) return null;
    return get().placeSubgraphAsGroup(preset.label, preset.subgraph, position, preset.description);
  },

  placeSubgraphAsGroup: (label, subgraph, position, description) => {
    const { nodes } = get();
    const preset = { label, subgraph, description };
    undoManager.push(nodes, { label: `Added ${label}` });

    // Re-ID all subgraph nodes to avoid collisions. A preset saved a while
    // ago is migrated like a loaded graph (e.g. Grid's Columns units).
    const idMap = new Map<string, string>();
    const newSubNodes = preset.subgraph.nodes.map(n => migrateNodeParams(n.params ? n : { ...n, params: {} }, getNodeDefinition)).map(n => {
      const newId = idGenerator.next();
      idMap.set(n.id, newId);
      return { ...n, id: newId };
    });

    // Remap connections inside subgraph
    const remappedSubNodes = newSubNodes.map(n => ({
      ...n,
      inputs: Object.fromEntries(
        Object.entries(n.inputs).map(([k, v]) => [
          k,
          v.connection && idMap.has(v.connection.nodeId)
            ? { ...v, connection: { ...v.connection, nodeId: idMap.get(v.connection.nodeId)! } }
            : v,
        ])
      ),
    }));

    // Remap ports
    const remappedInputPorts = preset.subgraph.inputPorts.map(p => ({
      ...p, toNodeId: idMap.get(p.toNodeId) ?? p.toNodeId,
    }));
    const remappedOutputPorts = preset.subgraph.outputPorts.map(p => ({
      ...p, fromNodeId: idMap.get(p.fromNodeId) ?? p.fromNodeId,
    }));

    const newSubgraph: import('../types/nodeGraph').SubgraphData = {
      nodes: remappedSubNodes,
      inputPorts: remappedInputPorts,
      outputPorts: remappedOutputPorts,
    };

    const groupInputSockets: Record<string, import('../types/nodeGraph').InputSocket> = {};
    for (const p of remappedInputPorts) {
      groupInputSockets[p.key] = { type: p.type, label: p.label };
    }
    const groupOutputSockets: Record<string, import('../types/nodeGraph').OutputSocket> = {};
    for (const p of remappedOutputPorts) {
      groupOutputSockets[p.key] = { type: p.type, label: p.label };
    }

    const groupId = idGenerator.next();
    const pos = position ?? { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 };
    const { activeGroupPath } = get();

    // Auto-seal when loading inside an existing regular group to prevent
    // exceeding the 2-level nesting depth limit.
    const sealed = activeGroupPath.some((id, idx) => {
      const ctxNodes = idx === 0
        ? nodes
        : (getActiveNodes(nodes, activeGroupPath.slice(0, idx)) ?? []);
      return ctxNodes.find(n => n.id === id)?.type === 'group';
    });

    const groupNode: GraphNode = {
      id: groupId,
      type: 'group',
      position: pos,
      inputs: groupInputSockets,
      outputs: groupOutputSockets,
      params: { label: preset.label, subgraph: newSubgraph, ...(preset.description ? { __comment: preset.description } : {}) },
      ...(sealed ? { sealed: true } : {}),
    };

    if (activeGroupPath.length > 0) {
      set(state => {
        const currentActive = getActiveNodes(state.nodes, activeGroupPath);
        if (!currentActive) return state;
        const newNodes = setActiveNodes(state.nodes, activeGroupPath, [...currentActive, groupNode]);
        return newNodes ? { nodes: newNodes } : state;
      });
    } else {
      set(state => ({ nodes: [...state.nodes, groupNode] }));
    }
    get().compile();
    return groupId;
  },

  publishUserNode: async (source, spec) => {
    if (!requireFeature('nodes.publish')) return { ok: false, cancelled: true, error: 'Publishing nodes is part of Pro' };
    let resolved: PublishSource;
    if (typeof source === 'string') {
      const { nodes, activeGroupPath } = get();
      const scope = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
      const groupNode = scope.find(n => n.id === source && n.type === 'group');
      if (!groupNode) return { ok: false, error: 'Group node not found' };
      resolved = { kind: 'group', node: groupNode };
    } else {
      resolved = source;
    }
    const built = buildUserNodeDefinition(resolved, spec);
    if (!built.ok) return { ok: false, error: built.error };
    // Built from sealed nodes: the new node is sealed too, so their code never becomes editable.
    const sealedInside = containsSealedCode(built.def);
    const result = await registerUserNode(sealedInside.length ? sealDefinition(built.def) : built.def);
    if (result.ok && sealedInside.length) toast.info('Published as a sealed node', { message: `It’s built from ${sealedInside.map(l => `“${l}”`).join(', ')}, from a sealed node pack, so its code stays hidden too.` });
    // Instances of a re-published node pick up the new function on the next compile.
    get().compile();
    return result.ok ? { ...result, id: built.def.id } : result;
  },

  readSavedGraphNodes: (name) => {
    const raw = localStorage.getItem(`shader-studio:${name}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { nodes?: unknown };
      if (!Array.isArray(parsed?.nodes)) return null;
      return upgradeExprNodes(parsed.nodes as GraphNode[]).map(n => migrateNodeParams(n, getNodeDefinition));
    } catch {
      return null;
    }
  },

  deleteUserNode: (id) => {
    unregisterUserNode(id);
    get().compile();
  },

  openUserNodeSource: (id, position) => {
    const def = getUserNode(id);
    // Code-backed nodes are edited in the publish dialog (see NodePalette / NodeComponent), not as a group.
    if (!def?.source || def.source.kind !== 'subgraph') return null;
    const groupId = get().placeSubgraphAsGroup(def.label, def.source.subgraph, position, def.description);
    // Remember where the group came from so "Publish" offers to update the
    // existing node type instead of creating a second one.
    if (groupId) get().updateNodeParams(groupId, { __userNodeId: id, iterations: def.source.iterations }, { immediate: true });
    return groupId;
  },

  exportUserNodes: async (ids) => {
    // Sharing nodes as a file is making a node pack (Pro; importing one is Free), and node types
    // only leave as a signed .playfile pack (docs/accounts-and-plans.md decision 5): the dialog
    // asks whether to seal it, then writes it.
    if (!requireFeature('nodes.pack')) return { ok: false, cancelled: true, error: 'Making node packs is part of Pro' };
    if (exportUserNodes(ids).nodes.length === 0) return { ok: false, error: 'No node types to export yet.' };
    const { openNodePackDialog } = await import('../playfile/app');
    openNodePackDialog(ids);
    return { ok: true };
  },

  importUserNodesFromFile: async () => {
    let json: string | null;
    try {
      const picked = await openBinaryFile(`${CONTAINER_ACCEPT},.json`);
      if (!picked) return CANCELLED;
      // A node pack: its preview says who signed it and what's sealed, then imports.
      if (isPlayfile(picked.bytes)) {
        const { openPlayfileBytes } = await import('../playfile/app');
        const opened = await openPlayfileBytes(picked.name, picked.bytes);
        return opened ? { ok: true, deferred: true } : CANCELLED;
      }
      // Older node files: plain JSON, still read.
      json = new TextDecoder().decode(picked.bytes);
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
    const r = await importUserNodes(json);
    if (!r.ok) return { ok: false, error: r.error ?? 'Import failed' };
    get().compile();
    return { ok: true, imported: r.imported, replaced: r.replaced };
  },

  swapNode: (nodeId, newType) => {
    // Shift-click → pick in the palette, and the card's Switch picker: one path (nodes/switchNode.ts).
    // The node keeps its id, so Play controls, mappings and group overrides keep pointing at it.
    const st = get();
    const where = switchScopeFor(st, nodeId);
    if (!where) return undefined;
    const { scope, node: oldNode, ctx, path } = where;
    const plan = planSwitch(scope, oldNode, newType, ctx);
    if (!plan) return undefined;
    const blocked = ctx.disallowed?.(newType);
    if (blocked) {
      toast.info(blocked, { message: 'Switch it where that node is allowed.' });
      return undefined;
    }
    if (oldNode.type === newType) { set({ swapTargetNodeId: null }); return { ok: true, keptWires: plan.keptWires }; }
    const from = nodeName(oldNode);
    const to = plan.label;
    const { play, lost: lostControls } = retargetPlay(st.play, nodeId, plan);
    undoManager.push(st.nodes, { label: `Switched ${from} to ${to}`, nodeIds: [nodeId] }, st.play);

    const list = applySwitchToList(scope, plan);
    let nodes = path.length > 0 ? (setActiveNodes(st.nodes, path, list) ?? st.nodes) : list;
    // A group output port reading the node follows the output map.
    if (path.length > 0 && Object.keys(plan.outputMap).length) {
      nodes = mapGroupAtPath(nodes, path, g => {
        const sg = g.params.subgraph as SubgraphData;
        if (!sg.outputPorts?.some(p => p.fromNodeId === nodeId)) return g;
        const outputPorts = sg.outputPorts.map(p => (p.fromNodeId === nodeId && plan.outputMap[p.fromOutputKey]
          ? { ...p, fromOutputKey: plan.outputMap[p.fromOutputKey] } : p));
        return { ...g, params: { ...g.params, subgraph: { ...sg, outputPorts } } };
      });
    }
    set({ nodes, swapTargetNodeId: null, ...(play !== st.play ? { play } : {}) });
    get().compile();

    const wires = `${plan.keptWires} wire${plan.keptWires === 1 ? '' : 's'} kept`;
    const notes: string[] = [];
    if (plan.droppedWires) notes.push(`${plan.droppedWires} wire${plan.droppedWires === 1 ? '' : 's'} had no matching socket and came off.`);
    if (plan.lostLabels.length) notes.push(`${to} has no ${plan.lostLabels.join(', ')} ${plan.lostLabels.length === 1 ? 'setting, so it was' : 'settings, so they were'} left behind.`);
    if (lostControls.length) notes.push(`Play control${lostControls.length === 1 ? '' : 's'} ${lostControls.map(l => `“${l}”`).join(', ')} no longer reach${lostControls.length === 1 ? 'es' : ''} a setting.`);
    const title = `Switched ${from} → ${to}; ${wires}`;
    if (notes.length) toast.info(title, { message: `${notes.join(' ')} Undo puts it back.` });
    else toast.success(title);
    return { ok: plan.ok, keptWires: plan.keptWires };
  },

  undo: () => { get().undoSteps(1); },
  redo: () => { get().redoSteps(1); },

  undoSteps: (count) => {
    if (get().scratch) return 0;
    let { nodes, play } = get();
    let n = 0, graph = false, playChanged = false;
    for (; n < count; n++) {
      const prev = undoManager.undo({ nodes, play });
      if (!prev) break;
      if (prev.nodes) { nodes = prev.nodes; graph = true; }
      if (prev.play) { play = prev.play; playChanged = true; }
    }
    if (!n) return 0;
    endPlayBurst();
    // Restore counter so new nodes after undo don't collide
    if (graph) idGenerator.syncFromGraph(nodes);
    set({ ...(graph ? { nodes, nodeProbeValues: null } : {}), ...(playChanged ? { play } : {}) });
    if (graph) get().compile();
    return n;
  },

  redoSteps: (count) => {
    if (get().scratch) return 0;
    let { nodes, play } = get();
    let n = 0, graph = false, playChanged = false;
    for (; n < count; n++) {
      const next = undoManager.redo({ nodes, play });
      if (!next) break;
      if (next.nodes) { nodes = next.nodes; graph = true; }
      if (next.play) { play = next.play; playChanged = true; }
    }
    if (!n) return 0;
    endPlayBurst();
    if (graph) idGenerator.syncFromGraph(nodes);
    set({ ...(graph ? { nodes, nodeProbeValues: null } : {}), ...(playChanged ? { play } : {}) });
    if (graph) get().compile();
    return n;
  },

  addAgentPiece: (groupId, piece) => {
    const before = get().nodes;
    const r = addAgentPieceTo(before, groupId, piece, () => idGenerator.next());
    if (!r) return;
    undoManager.push(before, { label: `Added ${piece === 'emit' ? 'an Emit' : piece === 'draw' ? 'Draw agents' : piece === 'trail' ? 'a Deposit and a Trail' : 'the walkers to the Output'}` });
    set({ nodes: r.nodes });
    get().compile();
    toast.info('Done', { message: r.message });
  },

  startAgentRule: (groupId, kind) => {
    const before = get().nodes;
    const g = before.find(n => n.id === groupId);
    if (!g || g.type !== 'agentsGroup') return;
    undoManager.push(before, { label: 'Started the rule' });
    const sg = g.params.subgraph as SubgraphData;
    const inside = startRuleIn(g, kind, () => idGenerator.next());
    // The group's own sockets follow Agent Inputs' ports (the slime rule adds a Trail port).
    const ports = ((inside.find(n => n.type === 'agentInputs')?.params.extraInputs ?? []) as Array<{ key: string; type: DataType; label: string }>);
    const inputs = { ...g.inputs };
    for (const p of ports) if (!inputs[p.key]) inputs[p.key] = { type: p.type, label: p.label };
    set({ nodes: before.map(n => n.id === groupId ? { ...n, inputs, params: { ...n.params, subgraph: { ...sg, nodes: inside } } } : n) });
    // Outside, a slime rule needs its trail and a particles rule wants a way to be seen.
    if (kind === 'slime' && !before.some(n => n.type === 'agentDeposit' && n.inputs.agents?.connection?.nodeId === groupId)) {
      const r = addAgentPieceTo(get().nodes, groupId, 'trail', () => idGenerator.next());
      if (r) set({ nodes: r.nodes });
    }
    get().compile();
    toast.info('Rule started', {
      message: kind === 'slime' ? 'Sense → Steer → Move: walkers follow the trail they leave (a Deposit and a Trail field were added outside when missing).'
        : kind === 'particles' ? 'Curl noise → Integrate, and Age / Life: particles drift on swirling currents and live out the Life Emit gives them.'
        : 'Move: every walker steps forward along its heading.',
    });
  },

  applyStarterRecipe: (nodeId, recipeId) => {
    closeRecipeOffer();
    // Recipes are built on the top level, where the Output is.
    if (get().activeGroupPath.length) return null;
    const before = get().nodes;
    const self = before.find(n => n.id === nodeId);
    const recipe = self ? recipesFor(self.type).find(r => r.id === recipeId) : undefined;
    if (!self || !recipe) return null;
    const r = applyRecipe(before, nodeId, recipe, () => idGenerator.next());
    if (!r) return null;
    const label = getNodeDefinitionFor(self)?.label ?? self.type;
    const lighting = LIGHT_SCENE_TYPES.has(self.type);
    undoManager.push(before, { label: lighting ? `Light the scene: ${recipe.label}` : `Set up ${label}: ${recipe.label}` });
    set({ nodes: r.nodes });
    get().compile();
    toast.info(lighting ? `Lit: ${recipe.label}` : `${label}: ${recipe.label}`, {
      message: lighting
        ? `${recipe.description} Every node it added has a note; pick another look to replace it, or undo.`
        : `${recipe.description}${r.shown ? ' It is on the Output now.' : ''} Every node it added has a note on what it does; undo takes it back to just the node.`,
    });
    return r.added;
  },

  convertMarchLoop: (nodeId, to) => {
    closeRecipeOffer();
    const st = get();
    const path = st.activeGroupPath;
    const scope = path.length ? getActiveNodes(st.nodes, path) : st.nodes;
    if (!scope) return false;
    const r = convertMarchLoop(scope, nodeId, to);
    if (!r) return false;
    const label = to === 'giLitMarchGroup' ? 'GI Lit March Group' : 'March Loop Group';
    undoManager.push(st.nodes, { label: `Switched to ${label}`, nodeIds: [nodeId] });
    set({ nodes: path.length ? (setActiveNodes(st.nodes, path, r.nodes) ?? st.nodes) : r.nodes });
    get().compile();
    const notes: string[] = [];
    if (r.removedRig) notes.push(`The Light the scene rig (${r.removedRig} nodes) came out: GI Lit lights the scene itself, and its Color is on the Output.`);
    if (r.dropped) notes.push(`${r.dropped} wire${r.dropped === 1 ? '' : 's'} from GI-only outputs (AO, Shadow, GI, Diffuse, Reflection) came off.`);
    if (to === 'marchLoopGroup') notes.push('Light the scene (the sun button) adds lighting to it.');
    toast.info(`Switched to ${label}`, { message: `${notes.join(' ')} Settings, the loop body and the other wires are kept. Undo puts it back.` });
    return true;
  },

  upgradeBloom: (nodeId) => {
    const st = get();
    const path = st.activeGroupPath;
    const scope = path.length ? getActiveNodes(st.nodes, path) : st.nodes;
    if (!scope) return false;
    const r = upgradeBloom(scope, nodeId, () => idGenerator.next());
    if (!r) {
      toast.info('Nothing to upgrade', { message: 'Wire a picture into the Bloom\'s Color first.' });
      return false;
    }
    undoManager.push(st.nodes, { label: 'Upgraded Bloom to same-frame glow', nodeIds: [nodeId] });
    set({ nodes: path.length ? (setActiveNodes(st.nodes, path, r.nodes) ?? st.nodes) : r.nodes });
    get().compile();
    toast.info('Bloom upgraded: same frame, no lag', {
      message: `A Pass, a Glow (texture) Bloom chain and Add glow replace it; Threshold, Intensity and Radius came across (Softness is Knee now), and Tail stretches the glow's falloff.${r.droppedWires ? ` ${r.droppedWires} wire${r.droppedWires === 1 ? '' : 's'} into Threshold or Intensity came off (the Glow has them as sliders).` : ''} Undo puts the old Bloom back.`,
    });
    return true;
  },

  applySuggestion: (nodeId, key, side, moveId, args = {}) => {
    const st = get();
    const move = moveById(moveId);
    const path = st.activeGroupPath;
    const scope = path.length ? getActiveNodes(st.nodes, path) : st.nodes;
    const self = scope?.find(nd => nd.id === nodeId);
    if (!move || !scope || !self) return null;
    const r = applyMove(scope, { nodeId, key, side }, move, args, () => idGenerator.next(), { topLevel: path.length === 0 });
    if (!r) return null;
    const label = nodeName(self);
    undoManager.push(st.nodes, { label: `${move.label} on ${label}`, nodeIds: [nodeId] });
    const nodes = path.length ? (setActiveNodes(st.nodes, path, r.nodes) ?? st.nodes) : r.nodes;
    const select = r.resultNodeId && r.nodes.some(nd => nd.id === r.resultNodeId) ? r.resultNodeId : nodeId;
    set({ nodes, selectedNodeId: select, selectedNodeIds: [select] });
    get().compile();
    // Picking a move is a wiring choice too: it teaches the ranking (recency-weighted).
    if (move.anchor) {
      if (side === 'out') recordWireBetween(self.type, key, move.anchor.type, move.anchor.key);
      else recordWireBetween(move.anchor.type, move.anchor.out, self.type, key);
    }
    const what = move.shape === 'param' ? 'Changed its settings.' : `Added ${r.added.length} node${r.added.length === 1 ? '' : 's'}, each with a note${r.rewired ? ', in place' : ''}.`;
    toast.info(`${move.label} · ${label}`, { message: `${what}${r.shown ? ' It is on the Output now.' : ''} Undo takes it back.` });
    return r.added;
  },

  runDoPlan: (plan, label) => {
    const st = get();
    const path = st.activeGroupPath;
    const scope = path.length ? getActiveNodes(st.nodes, path) : st.nodes;
    if (!scope || !plan.steps.length) return [];
    const r = runDoPlanPure(scope, plan, () => idGenerator.next(), { topLevel: path.length === 0 });
    if (!r.ran.length) return [];
    undoManager.push(st.nodes, { label: `Do: ${label}` });
    const nodes = path.length ? (setActiveNodes(st.nodes, path, r.nodes) ?? st.nodes) : r.nodes;
    set({ nodes, ...(r.select ? { selectedNodeId: r.select, selectedNodeIds: [r.select] } : {}) });
    get().compile();
    return r.ran;
  },

  runCommand: (text, picks) => {
    const st = get();
    const path = st.activeGroupPath;
    const scope = (path.length ? getActiveNodes(st.nodes, path) : st.nodes) ?? [];
    const selected = (st.selectedNodeIds.length > 1 ? st.selectedNodeIds : st.selectedNodeId ? [st.selectedNodeId] : st.selectedNodeIds).filter(id => scope.some(n => n.id === id));
    const plan = execCommand(text, scope, { selected, picks, nextId: () => idGenerator.next(), topLevel: path.length === 0 });
    if (!plan.ok) return plan;
    const graphChanged = plan.nodes !== scope;
    if (graphChanged || plan.group) {
      undoManager.batch(st.nodes, () => {
        const nodes = path.length ? (setActiveNodes(st.nodes, path, plan.nodes) ?? st.nodes) : plan.nodes;
        set({ nodes });
        if (plan.group) get().groupNodes(plan.group.ids, plan.group.label);
      }, { label: `Do: ${text.trim()}` });
    }
    if (!plan.group && plan.select.length) set({ selectedNodeId: plan.select[0], selectedNodeIds: plan.select });
    if (graphChanged || plan.group) get().compile();
    return plan;
  },

  addAgentsStarter: (kind, position, template) => {
    if (get().activeGroupPath.length) get().exitToRoot();
    const before = get().nodes;
    const output = graphOutput(before);
    // Rules: the Slime setup with its group in rules mode (docs/agent-rules.md). Rules in 3D: the
    // 3D Agent Builder's setup (agentRules/space3d.ts), seen through Draw agents' camera.
    const starter = kind === 'rules3d' ? agents3dStarter(template)
      : kind === 'rules' ? rulesStarter(output?.inputs.color?.connection ?? null) : agentStarter(kind, output?.inputs.color?.connection ?? null);
    const { nodes: fresh0, idOf } = freshIds(starter.nodes, () => idGenerator.next());
    // Owner marks of the 3D setup (its camera view, its shape) name the temporary ids: follow the fresh ones.
    const fresh = remapMarks(fresh0, idOf);
    const placed = placeInFreeSpace(before, fresh, position ?? get()._viewportCenterGetter?.() ?? { x: 0, y: 0 });
    undoManager.push(before, { label: `Added an Agents group (${kind === 'particles' ? 'Particles' : kind === 'rules' ? 'Rules' : kind === 'rules3d' ? 'Rules in 3D' : 'Slime'})` });
    let nodes = [...before, ...placed];
    const out = { nodeId: idOf(starter.out.nodeId), outputKey: starter.out.outputKey };
    if (output) nodes = nodes.map(n => n.id === output.id ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: out } } } : n);
    set({ nodes });
    get().compile();
    get().focusNode(idOf(starter.groupId));
    toast.info(kind === 'particles' ? 'Particles added' : kind === 'rules' ? 'Agent rules added' : kind === 'rules3d' ? '3D agents added' : 'Slime added', {
      message: kind === 'rules3d'
        ? template === 'shape3d'
          ? `The 3D slime round a ray-marched torus: Collide (3D scene) keeps the walkers out of it, Draw agents sees them through the March Camera and hides them behind it${output ? ', on the Output' : ''}. Edit rules → Look → Around a shape for a Sphere or a Box. Every node has a note.`
          : `Emit (a Ball) → Agents (Space 3D, rules: the 3D slime) → Deposit → a volume Trail, and Draw agents through an orbiting camera${output ? ', on the Output' : ''}. The rules editor's Templates… has 3D flocks, orbiters, curl smoke and Around a shape; its Look tab the camera. Every node has a note.`
        : `${kind === 'particles' ? 'Emit → Agents (Curl noise → Integrate inside) → Draw agents' : kind === 'rules' ? 'Emit → Agents (rules: turn toward the trail, wander, leave trail; press Edit rules) → Deposit → Trail field → palette' : 'Emit → Agents (Sense → Steer → Move inside) → Deposit → Trail field → palette'}${output ? ', wired to the Output over what it showed' : ''}. Double-click the group to open its rule; every node has a note.`,
    });
    return idOf(starter.groupId);
  },

  addBuiltNode: (node, label) => {
    const st = get();
    const path = st.activeGroupPath;
    const scope = path.length ? getActiveNodes(st.nodes, path) : st.nodes;
    if (!scope) return null;
    const id = idGenerator.next();
    const placed = placeNear(scope, [{ ...node, id }]);
    undoManager.push(st.nodes, { label: `Added ${label}` });
    const list = [...scope, ...placed];
    const nodes = path.length ? (setActiveNodes(st.nodes, path, list) ?? st.nodes) : list;
    set({ nodes, selectedNodeId: id, selectedNodeIds: [id] });
    get().compile();
    return id;
  },

  addNode: (type, position, overrideParams?) => {
    // "New 3D scene…" is a palette entry that opens the 3D Scene Builder (docs/scene-builder.md).
    if (type === 'sceneBuilder') { openNewSceneBuilder(position); return undefined; }
    // ── The Agents family (docs/agents-plan.md) ──────────────────────────────
    // Sense, Steer, Move… run once per walker, so they only go inside an Agents
    // group; the group, Emit, Deposit, Trail and Draw are engines of their own
    // and go on the top level. The Slime mold preset builds the whole setup.
    {
      const path = get().activeGroupPath;
      const inside = path.length > 0 ? get().nodes.find(n => n.id === path[0]) : undefined;
      const inAgents = path.length === 1 && inside?.type === 'agentsGroup';
      const label = getNodeDefinition(type)?.label ?? type;
      if (AGENT_INSIDE_TYPES.has(type) && !inAgents) {
        toast.info(`${label} goes inside an Agents group`, { message: 'Double-click an Agents group (or press Open rule on it) and add it there.' });
        return undefined;
      }
      if ((AGENT_OUTSIDE_TYPES.has(type) || AGENT_PRESET_TYPES.has(type)) && path.length > 0) {
        toast.info(`${label} goes on the top level`, { message: 'Leave this group and add it there.' });
        return undefined;
      }
      // A bare Agents group from the node browser: ask what to start with (a working setup round
      // it, or the empty group), then add that. The add runs again with the answer.
      if (type === 'agentsGroup' && path.length === 0 && !overrideParams && !skipAgentsAsk) {
        void askChoice('Add an Agents group', [
          { id: 'empty', label: 'Empty group' },
          { id: 'slime', label: 'Slime (with a Trail)' },
          { id: 'rules', label: 'Rules (When … Do …)' },
          { id: 'rules3d', label: 'Rules in 3D' },
          { id: 'particles', label: 'Particles', variant: 'primary' },
        ], { message: 'Agents need a place to be born (Emit) and a way to be seen (Draw agents, or a Trail they leave). Start with a working setup round the group, wired to the Output and over what it shows now, or with the empty group to build it yourself. Rules in 3D: the 3D Agent Builder\'s setup, walkers in a volume seen through an orbiting camera. Every node it adds has a note.' })
          .then(choice => {
            if (!choice) return;
            if (choice === 'empty') {
              skipAgentsAsk = true;
              try { get().addNode(type, position); } finally { skipAgentsAsk = false; }
              return;
            }
            get().addAgentsStarter(choice as 'particles' | 'slime' | 'rules' | 'rules3d', position);
          });
        return undefined;
      }
      if (AGENT_PRESET_TYPES.has(type)) {
        const preset = agentPreset(type, () => idGenerator.next(), position);
        if (!preset) return undefined;
        undoManager.push(get().nodes, { label: `Added the ${preset.label} preset` });
        const { out } = preset;
        // In free space beside the graph, its own cards apart: never on top of what is there.
        const added = placeInFreeSpace(get().nodes, preset.nodes, position);
        let nodes = [...get().nodes, ...added];
        const output = graphOutput(get().nodes);
        if (output) nodes = nodes.map(n => n.id === output.id
          ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: out } } }
          : n);
        set({ nodes });
        get().compile();
        const what = ({
          slimeMoldPreset: '262,144 walkers (256k) that sense, turn, move and leave trail, coloured by a palette',
          multiSlimePreset: 'Three slime colonies that follow their own trail and avoid each other\'s',
          antsPreset: 'Ants that carry food from three piles to their nest along the smell they leave',
          boidsPreset: 'Birds that flock through a field of their own velocities',
          strandsPreset: 'Slime combed into long strands, drawn as ink on paper',
          growPicturePreset: 'Slime that feeds on a picture\'s bright parts and maps it in veins',
          galaxyPreset: 'Stars circling a bright core, crowding into two turning spiral arms',
          myceliumPreset: 'A fungus colony that branches out of a spore, drawn by a palette',
          sandPlatePreset: 'Grains of sand drawing a Chladni figure on a ringing plate (its stand-in Beat is off; turn it on for changing figures)',
        } as Record<string, string>)[type] ?? 'Particles moved by a chain of forces, drawn by Draw agents';
        const gid = added.find(n => n.type === 'agentsGroup')?.id;
        if (gid) get().focusNode(gid);
        toast.info(`${preset.label} added`, {
          message: `${what}${output ? ' and wired to the Output' : '. Add an Output node and wire the last node into it to see it'}. Every node has a note on what it does; double-click the Agents group to open the rule.`,
        });
        return added.find(n => n.type === 'agentsGroup')?.id;
      }
    }
    // ── Time cube (docs/time-cube.md) ────────────────────────────────────────
    // A Time Cube View or Time Slice on the top level gets a Time Cube to read (the nearest, or a
    // new one), and a View joins a ray-marched scene that's already there (lib/timeCube/autoWire.ts).
    if (TIME_CUBE_AUTO_TYPES.has(type) && get().activeGroupPath.length === 0 && !overrideParams) {
      const plan = planTimeCubeAdd(type, get().nodes, position, () => idGenerator.next());
      if (plan) {
        undoManager.push(get().nodes, { label: `Added ${getNodeDefinition(type)?.label ?? type}` });
        set({ nodes: plan.nodes });
        get().compile();
        toast.info(`${getNodeDefinition(type)?.label ?? type} added`, { message: plan.message });
        return plan.id;
      }
    }
    // ── 3D scene companion spawning ──────────────────────────────────────────
    // Adding a RayMarch node auto-spawns a SceneGroup to the left (pre-wired
    // scene→scene). Adding a SceneGroup auto-spawns a RayMarch to the right.
    // Only at the top level — not inside a group drill-down.
    // overrideParams guard prevents triggering from programmatic calls.
    if (!get().activeGroupId && !overrideParams) {
      // ── First 3D in a 2D graph ───────────────────────────────────────────
      // A 3D scene takes the Output over. When it is the graph's first 3D and
      // there are 2D nodes, ask whether to clear them (the picture they made is
      // being replaced) or keep them beside the scene, unwired from the Output.
      // The add then runs again with the answer; it returns no id this time.
      if (!skip3DAsk && startsA3DScene(type, get().nodes)) {
        const twoD = twoDNodesBefore3D(get().nodes);
        if (twoD.length) {
          void askChoice('Adding a 3D scene', [
            { id: 'keep', label: 'Keep 2D nodes' },
            { id: 'clear', label: 'Clear 2D nodes', variant: 'primary' },
          ], { message: `The 3D scene takes over the Output, so the 2D picture won't show any more. Clear its ${twoD.length === 1 ? 'node' : `${twoD.length} nodes`}, or keep them in the graph to reuse (they stay unwired from the Output)? Undo brings everything back either way.` })
            .then(choice => {
              if (!choice) return;
              if (choice === 'clear') {
                undoManager.push(get().nodes, { label: `Cleared ${twoD.length === 1 ? 'a 2D node' : `${twoD.length} 2D nodes`} for a 3D scene` });
                const gone = new Set(twoD.map(n => n.id));
                set({ nodes: get().nodes.filter(n => !gone.has(n.id)).map(n => ({
                  ...n,
                  inputs: Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => [k, v.connection && gone.has(v.connection.nodeId) ? { ...v, connection: undefined } : v])),
                })) });
              }
              skip3DAsk = true;
              try { get().addNode(type, position); } finally { skip3DAsk = false; }
            });
          return undefined;
        }
      }
      // ── Smart 3D placement ───────────────────────────────────────────────
      // A shape or 3D transform dropped on the top level goes into a new Scene
      // Group wired to a march loop; a lighting node is wired to the nearest
      // loop's outputs. See nodes/smart3d.ts for the rules.
      const smartDef = getNodeDefinition(type);
      const plan = type === 'sceneGroup'
        ? planSceneGroupAdd(get().nodes, position)
        : smartDef ? planSmart3DAdd(type, smartDef, get().nodes, position) : { kind: 'none' as const };
      const role = smartDef && type !== 'sceneGroup' ? sceneRole(smartDef) : null;
      // ── Into the scene that's already there ──────────────────────────────
      // A shape on the top level of a graph that already draws a Scene Group goes
      // inside it, joined by a Union and moved beside what's there; a warp bends
      // the whole scene (nodes/scene3dShapes.ts). Only a loop with a free Scene
      // input (handled below) gets a new group instead.
      if (smartDef && role && plan.kind === 'wrap-scene' && !plan.attachToMarchId) {
        const target = targetScene(get().nodes, position);
        const sub = target?.params.subgraph as SubgraphData | undefined;
        const nextId = () => idGenerator.next();
        const placed = target && sub ? addToScene(nextId, sub, instantiateNode(nextId(), type, smartDef, position), role, { byHand: false }) : null;
        if (target && placed) {
          undoManager.push(get().nodes, { label: `Added ${smartDef.label} to ${typeof target.params.label === 'string' && target.params.label ? target.params.label : 'the Scene Group'}` });
          const widen = placed.spread ? camerasToWiden(get().nodes, target.id, placed.spread) : [];
          set({ nodes: get().nodes.map(n => {
            if (n.id === target.id) return { ...n, params: { ...n.params, subgraph: placed.subgraph } };
            const w = widen.find(c => c.id === n.id);
            return w ? { ...n, params: { ...n.params, camDist: w.camDist, _autoCamDist: w.camDist } } : n;
          }) });
          get().compile();
          toast.info('3D node placed', { message: `${smartDef.label} went into the existing Scene Group: ${placed.summary}${widen.length ? ' The camera moved back to keep everything in view.' : ''} Double-click the group to edit it.` });
          return target.id;
        }
      }
      if (smartDef && plan.kind === 'wrap-scene') {
        undoManager.push(get().nodes, { label: `Added ${type === 'sceneGroup' ? 'a Scene Group' : smartDef.label}` });
        const nextId = () => idGenerator.next();
        // A Scene Group from the palette brings its default Sphere; a shape is wrapped in one
        // (a warp or modifier with a partner shape, so it shows).
        const isGroup = type === 'sceneGroup';
        const subgraph = isGroup
          ? buildSceneSubgraph(nextId)
          : role
            ? buildSceneSubgraphFor(nextId, instantiateNode(nextId(), type, smartDef, { x: 300, y: 200 }), role)
            : buildSceneSubgraph(nextId, { node: instantiateNode(nextId(), type, smartDef, { x: 300, y: 200 }), posInput: plan.posInput, distOutput: plan.distOutput });
        const partner = role && role.kind !== 'shape' ? (subgraph.nodes.find(n => n.type === 'sphereSDF3D' || n.type === 'boxSDF3D')) : undefined;
        const group = instantiateNode(nextId(), 'sceneGroup', getNodeDefinition('sceneGroup')!, position, {
          ...(isGroup ? {} : { label: smartDef.label }),
          subgraph,
        });
        let nodes = [...get().nodes, group];
        let note = isGroup ? 'The Scene Group has a Sphere inside' : `${smartDef.label} was placed inside a new Scene Group`;
        if (plan.attachToMarchId) {
          nodes = nodes.map(n => n.id === plan.attachToMarchId && n.inputs.scene
            ? { ...n, inputs: { ...n.inputs, scene: { ...n.inputs.scene, connection: { nodeId: group.id, outputKey: 'scene' } } } }
            : n);
          note += ' and is wired into the march loop.';
        } else if (plan.spawnMarch) {
          const rig = buildMarchRig(nextId, 'marchLoopGroup', {
            camera: { x: position.x - 440, y: position.y + 120 }, scene: position, loop: { x: position.x + 440, y: position.y },
          }, group);
          const tuned = rigSettingsFor(type);
          nodes = [...nodes, { ...rig.camera, params: { ...rig.camera.params, ...tuned.camera } }, { ...rig.loop, params: { ...rig.loop.params, ...tuned.loop } }];
          if (plan.outputNodeId) {
            nodes = wireLoopToOutput(nodes, plan.outputNodeId, rig.loop.id);
            note += ', with a camera and march loop wired to the Output.';
          } else {
            note += ', with a camera and march loop. Add an Output node and wire the loop\'s Color into it.';
          }
        } else {
          note += isGroup ? '. Wire its Scene into a march loop.' : '. Double-click it to edit the shape.';
        }
        if (partner) note += ` A small ${partner.type === 'boxSDF3D' ? 'box' : 'sphere'} inside shows what ${smartDef.label} does (it has a note).`;
        set({ nodes });
        get().compile();
        toast.info(isGroup ? 'Scene Group added' : '3D node placed', { message: note });
        return group.id;
      }
      // A lighting node with no scene to light: the scene comes first (camera → Scene
      // Group with a Sphere → loop on the Output), then it is wired to it below.
      let litRig: GraphNode[] | null = null;
      let litPlan = plan;
      if (smartDef && smartDef.category === LIGHTING_CATEGORY && type !== 'glass3d' && plan.kind === 'none' && !get().nodes.some(n => MARCH_GROUP_TYPES.has(n.type))) {
        const rig = buildMarchRig(() => idGenerator.next(), 'marchLoopGroup', {
          camera: { x: position.x - 1320, y: position.y }, scene: { x: position.x - 880, y: position.y }, loop: { x: position.x - 440, y: position.y },
        });
        litRig = [rig.camera, rig.scene, rig.loop];
        litPlan = planSmart3DAdd(type, smartDef, [...get().nodes, ...litRig], position);
      }
      if (smartDef && litPlan.kind === 'wire-lighting') {
        const plan = litPlan;
        undoManager.push(get().nodes, { label: `Added ${smartDef.label}${litRig ? ' and a 3D scene' : ''}` });
        if (litRig) {
          let withRig = [...get().nodes, ...litRig];
          const output = graphOutput(get().nodes);
          if (output) withRig = wireLoopToOutput(withRig, output.id, plan.marchId);
          set({ nodes: withRig });
        }
        const node = instantiateNode(idGenerator.next(), type, smartDef, position);
        for (const w of plan.wires) {
          if (node.inputs[w.input]) node.inputs[w.input] = { ...node.inputs[w.input], connection: { nodeId: plan.marchId, outputKey: w.fromKey } };
        }
        if (plan.sceneSourceId && node.inputs.scene) node.inputs.scene = { ...node.inputs.scene, connection: { nodeId: plan.sceneSourceId, outputKey: 'scene' } };
        if (plan.cameraId) {
          for (const k of ['viewDir', 'rd'] as const) {
            if (node.inputs[k]) node.inputs[k] = { ...node.inputs[k], connection: { nodeId: plan.cameraId, outputKey: 'rd' } };
          }
        }
        set(state => ({ nodes: [...state.nodes, node] }));
        get().compile();
        const wired = plan.wires.map(w => w.input).concat(plan.sceneSourceId && node.inputs.scene ? ['scene'] : []);
        if (litRig) toast.info('3D node placed', { message: `${smartDef.label} lights a 3D scene, so one was added: a camera, a Scene Group with a Sphere inside, and a march loop${graphOutput(get().nodes) ? ' wired to the Output' : ''}.${wired.length ? ` ${smartDef.label} is wired to the loop (${wired.join(', ')}).` : ''}` });
        else if (wired.length) toast.info(`${smartDef.label} wired to the march loop`, { message: `Connected: ${wired.join(', ')}.` });
        return node.id;
      }
      if (type === 'rayMarch') {
        get().spawnGraph(
          position,
          [
            { type: 'sceneGroup', relPos: { x: -380, y: 0 } },
            { type,               relPos: { x: 0,    y: 0 } },
          ],
          [{ from: 0, fromKey: 'scene', to: 1, toKey: 'scene' }],
        );
        return undefined;
      }
      if (type === 'marchLoopGroup' || type === 'giLitMarchGroup' || type === 'marchCamera') {
        // A working scene in one go: March Camera → Scene Group (Sphere) → loop,
        // with the loop's Color on the Output (a new scene takes it over).
        undoManager.push(get().nodes, { label: 'Added a 3D scene' });
        const at = type === 'marchCamera'
          ? { camera: position, scene: { x: position.x + 440, y: position.y }, loop: { x: position.x + 880, y: position.y } }
          : { camera: { x: position.x - 880, y: position.y }, scene: { x: position.x - 440, y: position.y }, loop: position };
        const rig = buildMarchRig(() => idGenerator.next(), type === 'giLitMarchGroup' ? 'giLitMarchGroup' : 'marchLoopGroup', at);
        let nodes = [...get().nodes, rig.camera, rig.scene, rig.loop];
        const output = graphOutput(get().nodes);
        if (output) nodes = wireLoopToOutput(nodes, output.id, rig.loop.id);
        set({ nodes });
        get().compile();
        toast.info('3D scene added', {
          message: `A camera, a Scene Group with a Sphere inside, and a march loop${output ? ' wired to the Output' : '. Add an Output node and wire the loop\'s Color into it to see it'}.`,
        });
        return type === 'marchCamera' ? rig.camera.id : rig.loop.id;
      }
      if (type === 'volumetricScene') {
        undoManager.push(get().nodes, { label: 'Added a volumetric scene' });
        const rig = buildVolumetricRig(() => idGenerator.next(), position);
        let nodes = [...get().nodes, rig.camera, rig.scene, rig.loop, rig.colour];
        const output = graphOutput(get().nodes);
        if (output) nodes = nodes.map(n => n.id === output.id
          ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { nodeId: rig.colour.id, outputKey: 'color' } } } }
          : n);
        set({ nodes });
        get().compile();
        toast.info('Volumetric scene added', {
          message: `A glowing sphere: the March Loop walks through it adding Volume Glow at every step, and Glow to Color colours the total${output ? '' : '. Add an Output node and wire Glow to Color into it to see it'}.`,
        });
        return rig.loop.id;
      }
      if (type === 'glass3d') {
        const existingNodes = get().nodes;
        const cam = existingNodes.find(n => n.type === 'marchCamera');
        const mlg = existingNodes.find(n => n.type === 'marchLoopGroup');
        if (cam && mlg) {
          // Wire to existing march setup
          undoManager.push(existingNodes, { label: `Added ${getNodeDefinition('glass3d')?.label ?? 'Glass'}` });
          const def = getNodeDefinition('glass3d')!;
          const nodeId = idGenerator.next();
          const inputs: Record<string, InputSocket> = {};
          for (const [key, socket] of Object.entries(def.inputs)) {
            inputs[key] = { ...socket };
          }
          inputs.rayDir = { ...inputs.rayDir, connection: { nodeId: cam.id, outputKey: 'rd'     } };
          inputs.normal = { ...inputs.normal, connection: { nodeId: mlg.id, outputKey: 'normal' } };
          inputs.hit    = { ...inputs.hit,    connection: { nodeId: mlg.id, outputKey: 'hit'    } };
          set(state => ({
            nodes: [...state.nodes, {
              id: nodeId, type: 'glass3d', position, inputs,
              outputs: { ...def.outputs },
              params: { ...(def.defaultParams ?? {}) },
            }],
          }));
          get().compile();
          return nodeId;
        } else {
          // Spawn full march + glass setup
          get().spawnGraph(
            position,
            [
              { type: 'marchCamera',    relPos: { x: -820, y: 0 } },
              { type: 'sceneGroup',     relPos: { x: -460, y: 0 } },
              { type: 'marchLoopGroup', relPos: { x: -200, y: 0 } },
              { type: 'glass3d',        relPos: { x:  200, y: 0 } },
            ],
            [
              { from: 0, fromKey: 'ro',     to: 2, toKey: 'ro'     },
              { from: 0, fromKey: 'rd',     to: 2, toKey: 'rd'     },
              { from: 1, fromKey: 'scene',  to: 2, toKey: 'scene'  },
              { from: 0, fromKey: 'rd',     to: 3, toKey: 'rayDir' },
              { from: 2, fromKey: 'normal', to: 3, toKey: 'normal' },
              { from: 2, fromKey: 'hit',    to: 3, toKey: 'hit'    },
            ],
          );
          return undefined;
        }
      }

      if (type === 'glassScene') {
        // Spawn camera + two sceneGroups (foreground/background) + glassScene
        get().spawnGraph(
          position,
          [
            { type: 'marchCamera',  relPos: { x: -900, y:   0 } },
            { type: 'sceneGroup',   relPos: { x: -480, y: -80 } },
            { type: 'sceneGroup',   relPos: { x: -480, y:  80 } },
            { type: 'glassScene',   relPos: { x:    0, y:   0 } },
          ],
          [
            { from: 0, fromKey: 'ro', to: 3, toKey: 'ro'         },
            { from: 0, fromKey: 'rd', to: 3, toKey: 'rd'         },
            { from: 1, fromKey: 'scene', to: 3, toKey: 'foreground' },
            { from: 2, fromKey: 'scene', to: 3, toKey: 'background' },
          ],
        );
        return undefined;
      }
    }

    if (type === 'volumetricScene') {
      // A starter, not a node: it only makes sense as a whole scene on the top level.
      toast.info('Volumetric Scene goes on the top level', { message: 'Leave this group and add it there.' });
      return undefined;
    }
    undoManager.push(get().nodes, { label: `Added ${typeof overrideParams?.label === 'string' && overrideParams.label ? overrideParams.label : getNodeDefinition(NODE_ALIASES[type]?.to ?? type)?.label ?? type}` });
    // A merged (aliased) type is created as its canonical node, with the alias's defaults.
    const alias = NODE_ALIASES[type];
    if (alias) {
      type = alias.to;
      overrideParams = { ...aliasParams(alias, {}), ...(overrideParams ?? {}) };
    }
    const def = getNodeDefinition(type);
    if (!def) {
      console.error(`Unknown node type: ${type}`);
      return;
    }

    const nodeId = idGenerator.next();

    // Merge overrideParams with defaults
    const mergedParams = { ...(def.defaultParams ?? {}), ...(overrideParams ?? {}) };
    // Scene Groups and march loops are never empty: their required parts exist from the start.
    const startingSubgraph = defaultSubgraphFor(type);
    if (startingSubgraph && !mergedParams.subgraph) mergedParams.subgraph = startingSubgraph;

    // Create inputs. Only copy defaultParams into socket.defaultValue for sockets
    // that do NOT have a paramDef (i.e. no slider UI). Param-slider sockets read
    // their value directly from node.params at compile time, so defaultValue must
    // stay undefined to avoid shadowing the live param value.
    const inputs: Record<string, InputSocket> = {};
    for (const [key, socket] of Object.entries(def.inputs)) {
      inputs[key] = {
        ...socket,
        defaultValue: def.paramDefs?.[key]
          ? undefined
          : def.defaultParams?.[key] as number | number[] | undefined,
      };
    }
    // An Agents group's added ports (its Agent Inputs' extra outputs) are sockets on the group too.
    if (type === 'agentsGroup') {
      const sub = mergedParams.subgraph as SubgraphData | undefined;
      const extras = (sub?.nodes.find(n => n.type === 'agentInputs')?.params.extraInputs ?? []) as Array<{ key: string; type: DataType; label: string }>;
      for (const e of extras) if (!inputs[e.key]) inputs[e.key] = { type: e.type, label: e.label };
    }

    // For customFn / exprNode: build sockets from the inputs array in params
    // (either overrideParams.inputs or defaultParams.inputs for fresh nodes)
    const customInputDefs = (type === 'customFn' || type === 'exprNode')
      ? (Array.isArray(overrideParams?.inputs)
          ? (overrideParams!.inputs as Array<{ name: string; type: DataType }>)
          : Array.isArray(def.defaultParams?.inputs)
            ? (def.defaultParams!.inputs as Array<{ name: string; type: DataType }>)
            : null)
      : null;

    if (customInputDefs) {
      // Replace inputs record with sockets from the override inputs array
      const customInputs: Record<string, InputSocket> = {};
      for (const inp of customInputDefs) {
        customInputs[inp.name] = { type: inp.type, label: inp.name };
      }
      Object.assign(inputs, customInputs);
      // Remove any sockets that were there from def.inputs (customFn def has none)
      for (const key of Object.keys(inputs)) {
        if (!customInputDefs.some(i => i.name === key)) {
          delete inputs[key];
        }
      }
    }

    const outputType = (mergedParams.outputType as DataType | undefined) ?? 'float';
    const outputs: Record<string, OutputSocket> = (type === 'customFn' || type === 'exprNode') && overrideParams?.outputType
      ? { result: { type: outputType, label: 'Result' } }
      : { ...def.outputs };

    if (alias?.socketTypes) {
      for (const [k, t] of Object.entries(alias.socketTypes.inputs ?? {}))  if (inputs[k])  inputs[k]  = { ...inputs[k],  type: t };
      for (const [k, t] of Object.entries(alias.socketTypes.outputs ?? {})) if (outputs[k]) outputs[k] = { ...outputs[k], type: t };
    }

    const newNode: GraphNode = {
      id: nodeId,
      type,
      position,
      inputs,
      outputs,
      params: mergedParams,
    };

    const { activeGroupId, activeGroupPath } = get();
    // Inside a Scene Group: a shape is wired from Scene Pos and into the scene's
    // output (joined by a Union when something is there already), so it shows.
    if (activeGroupId) {
      const holder = getActiveNodes(get().nodes, activeGroupPath.slice(0, -1))?.find(n => n.id === activeGroupId);
      const role = holder?.type === 'sceneGroup' ? sceneRole(def) : null;
      const active = role ? getActiveNodes(get().nodes, activeGroupPath) : null;
      if (role && active && !overrideParams) {
        const placed = addToScene(() => idGenerator.next(), { nodes: active, inputPorts: [], outputPorts: [] }, newNode, role, { byHand: true, at: position });
        const updated = placed ? setActiveNodes(get().nodes, activeGroupPath, placed.subgraph.nodes) : null;
        if (placed && updated) {
          set({ nodes: updated });
          get().compile();
          if (role.kind === 'shape') toast.info(`${def.label} wired into the scene`, { message: placed.summary });
          return nodeId;
        }
      }
    }
    if (activeGroupId) {
      // Inside a group view — insert into the active subgraph.
      // Use the path-based helper so nested groups (depth > 1) are handled correctly;

      // the old flat activeGroupId lookup only worked for top-level groups.
      set(state => {
        const currentActive = getActiveNodes(state.nodes, activeGroupPath);
        if (!currentActive) return state; // subgraph not initialised — shouldn't happen after enterGroup fix
        const newActive = [...currentActive, newNode];
        const newNodes = setActiveNodes(state.nodes, activeGroupPath, newActive);
        return newNodes ? { nodes: newNodes } : state;
      });
    } else {
      set(state => ({ nodes: [...state.nodes, newNode] }));
    }
    get().compile();
    // A plain add on the top level: offer the node's starter recipes (nodes/recipes), if any.
    if (!activeGroupId && !overrideParams) noteNodeAdded(nodeId, type);
    return nodeId;
  },

  spawnGraph: (origin, nodeSpecs, edges) => {
    undoManager.push(get().nodes, { label: `Added ${getNodeDefinition(nodeSpecs[nodeSpecs.length - 1]?.type ?? '')?.label ?? 'nodes'}${nodeSpecs.length > 1 ? ` and ${nodeSpecs.length - 1} more` : ''}` });
    const assignedIds: string[] = [];
    const newNodes: GraphNode[] = [];

    // First pass: create all nodes (no connections yet)
    for (const spec of nodeSpecs) {
      const def = getNodeDefinition(spec.type);
      if (!def) { console.error(`spawnGraph: Unknown node type: ${spec.type}`); continue; }

      const nodeId = idGenerator.next();
      assignedIds.push(nodeId);

      const mergedParams = { ...(def.defaultParams ?? {}), ...(spec.params ?? {}) };
      const startingSubgraph = defaultSubgraphFor(spec.type);
      if (startingSubgraph && !mergedParams.subgraph) mergedParams.subgraph = startingSubgraph;

      const inputs: Record<string, InputSocket> = {};
      for (const [key, socket] of Object.entries(def.inputs)) {
        inputs[key] = {
          ...socket,
          defaultValue: def.paramDefs?.[key]
            ? undefined
            : def.defaultParams?.[key] as number | number[] | undefined,
        };
      }

      const outputType = (mergedParams.outputType as DataType | undefined) ?? 'float';
      const outputs = spec.type === 'customFn' && spec.params?.outputType
        ? { result: { type: outputType, label: 'Result' } }
        : { ...def.outputs };

      newNodes.push({
        id: nodeId,
        type: spec.type,
        position: { x: origin.x + spec.relPos.x, y: origin.y + spec.relPos.y },
        inputs,
        outputs,
        params: mergedParams,
      });
    }

    // Second pass: wire edges using assigned IDs
    for (const edge of edges) {
      const srcId  = assignedIds[edge.from];
      const tgtId  = assignedIds[edge.to];
      const tgtIdx = newNodes.findIndex(n => n.id === tgtId);
      if (srcId == null || tgtIdx < 0) continue;
      const input = newNodes[tgtIdx].inputs[edge.toKey];
      if (!input) continue;
      newNodes[tgtIdx] = {
        ...newNodes[tgtIdx],
        inputs: {
          ...newNodes[tgtIdx].inputs,
          [edge.toKey]: { ...input, connection: { nodeId: srcId, outputKey: edge.fromKey } },
        },
      };
    }

    set(state => ({ nodes: [...state.nodes, ...newNodes] }));
    get().compile();
  },

  removeNodes: (nodeIds) => {
    undoManager.batch(get().nodes, () => { for (const id of nodeIds) get().removeNode(id); }, { label: `Removed ${nodeIds.length === 1 ? nodeName(nodeInScope(get(), nodeIds[0])) : `${nodeIds.length} nodes`}`, nodeIds });
  },

  removeNode: (nodeId) => {
    const { nodes, activeGroupPath } = get();

    // When inside a group, handle subgraph node removal (handles depth 1 and 2)
    if (activeGroupPath.length > 0) {
      const activeNodes = getActiveNodes(nodes, activeGroupPath);
      if (activeNodes) {
        const sgNode = activeNodes.find(n => n.id === nodeId);
        if (sgNode) {
          // _groupOriginal alone used to block every creation-time node
          // forever — for a plain 'group' that's every node you selected
          // when you made it, permanently frozen the moment you grouped
          // them, the opposite of "group nodes to keep iterating on them
          // together." The actual thing that needs protecting is narrower:
          // def.anchored node TYPES (ScenePos/SceneOutput/MarchLoopInputs/
          // MarchLoopOutput) are structural anchors the compiler requires
          // to exist inside the specialized 3D scene group types — same
          // flag NodeComponent.tsx's own 🔒 "Anchored — cannot be deleted"
          // indicator already keys off, so this stays consistent with
          // desktop's existing convention rather than inventing a new one.
          if (sgNode.params?._groupOriginal && getNodeDefinitionFor(sgNode)?.anchored) return;

          undoManager.push(nodes, { label: `Removed ${nodeName(sgNode)}`, nodeIds: [nodeId] });
          const newSgNodes = removeNodeFromList(activeNodes, nodeId);
          set(state => {
            const newTop = setActiveNodes(state.nodes, activeGroupPath, newSgNodes);
            if (!newTop) return { nodes: state.nodes };
            const activeLoose = getActiveLooseGroups(newTop, state.looseGroups, activeGroupPath);
            const { nodes: prunedNodes, looseGroups: prunedTopLoose } =
              setActiveLooseGroups(newTop, state.looseGroups, activeGroupPath, pruneLooseGroups(activeLoose, nodeId));
            return { nodes: prunedNodes, looseGroups: prunedTopLoose };
          });
          get().compile();
          return;
        }
      }
    }

    undoManager.push(get().nodes, { label: `Removed ${nodeName(nodes.find(n => n.id === nodeId))}`, nodeIds: [nodeId] });
    const deletedNode = nodes.find(n => n.id === nodeId);

    // Clean up video resources if this was a videoInput node
    if (deletedNode?.type === 'videoInput') {
      videoEngine.disposeNode(nodeId);
    }

    set(state => {
      const newNodes = removeNodeFromList(state.nodes, nodeId);
      const previewNodeId = state.previewNodeId === nodeId ? null : state.previewNodeId;
      return { nodes: newNodes, previewNodeId, looseGroups: pruneLooseGroups(state.looseGroups, nodeId) };
    });
    get().compile();
  },

  updateNodePosition: (nodeId, position) => {
    // Called once per drag, on release (the card moves imperatively while
    // dragging — see NodeGraph/nodeDrag.ts), so one call is one undo step.
    undoManager.push(get().nodes, { label: `Moved ${nodeName(nodeInScope(get(), nodeId))}`, nodeIds: [nodeId] });
    set(state => {
      // Fast path: top-level node
      if (state.nodes.some(n => n.id === nodeId)) {
        return { nodes: state.nodes.map(n => n.id === nodeId ? { ...n, position } : n) };
      }
      // Drill into active group's subgraph (handles depth 1 and 2)
      const path = state.activeGroupPath;
      if (path.length === 0) return {};
      const activeNodes = getActiveNodes(state.nodes, path);
      if (!activeNodes) return {};
      const newActiveNodes = activeNodes.map(sn => sn.id === nodeId ? { ...sn, position } : sn);
      const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
      return { nodes: newTop ?? state.nodes };
    });
  },

  updateNodeParams: (nodeId, params, options?) => {
    if ('tint' in params) suggestTintedOutput(nodeId);
    // Push history once at the start of an edit burst (debounced — not on every keystroke/tick)
    if (!_historyParamPending) {
      undoManager.push(get().nodes, { nodeIds: [nodeId] });  // named from the diff once the burst ends ("Changed Radius 0.3 → 0.42")
      _historyParamPending = true;
    }
    if (_historyParamTimer) clearTimeout(_historyParamTimer);
    _historyParamTimer = setTimeout(() => { _historyParamPending = false; }, 1000);
    set(state => {
      // Top-level node
      if (state.nodes.some(n => n.id === nodeId)) {
        const node = state.nodes.find(n => n.id === nodeId)!;
        // If this is a group node being updated with override keys (innerNodeId::paramKey),
        // also sync those values into the subgraph nodes' params. An Agents group's pinned
        // sliders and Play controls on its inside write the same way (docs/agents-group.md).
        if (node.type === 'group' || node.type === 'agentsGroup') {
          const sg = node.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (sg) {
            let updatedSgNodes = sg.nodes;
            let hasOverrides = false;
            for (const [key, val] of Object.entries(params)) {
              if (key.includes('::')) {
                hasOverrides = true;
                const sepIdx = key.indexOf('::');
                const innerNodeId = key.slice(0, sepIdx);
                const paramKey = key.slice(sepIdx + 2);
                updatedSgNodes = updatedSgNodes.map(sn =>
                  sn.id === innerNodeId
                    ? { ...sn, params: { ...sn.params, [paramKey]: val } }
                    : sn
                );
              }
            }
            if (hasOverrides) {
              return {
                nodes: state.nodes.map(n =>
                  n.id === nodeId
                    ? { ...n, params: { ...n.params, ...params, subgraph: { ...sg, nodes: updatedSgNodes } } }
                    : n
                ),
              };
            }
          }
        }
        return { nodes: state.nodes.map(n => n.id === nodeId ? retypeSwizzle({ ...n, params: { ...n.params, ...params } }) : n) };
      }
      // Subgraph node — also sync to group node's override keys (depth 1 only)
      const path = state.activeGroupPath;
      if (path.length === 0) return {};
      // Depth > 1: update node directly without override key sync
      if (path.length > 1) {
        const activeNodes = getActiveNodes(state.nodes, path);
        if (!activeNodes) return {};
        const newActiveNodes = activeNodes.map(sn => {
          if (sn.id !== nodeId) return sn;
          const updated = retypeSwizzle({ ...sn, params: { ...sn.params, ...params } });
          if (sn.type === 'loopCarry' && 'dataType' in params) {
            const t = params.dataType as import('../types/nodeGraph').DataType;
            return {
              ...updated,
              inputs: { init: { ...updated.inputs.init, type: t }, next: { ...updated.inputs.next, type: t } },
              outputs: { value: { ...updated.outputs.value, type: t } },
            };
          }
          return updated;
        });
        const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
        return { nodes: newTop ?? state.nodes };
      }
      // Depth 1: sync params back to parent group's override keys
      const groupId = path[0];
      return {
        nodes: state.nodes.map(n => {
          if (n.id !== groupId) return n;
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          // Build override key updates for the group node (nodeId::paramKey)
          const overrideUpdates: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(params)) {
            if (!key.includes('::')) { // avoid double-syncing
              overrideUpdates[`${nodeId}::${key}`] = val;
            }
          }
          return {
            ...n,
            params: {
              ...n.params,
              ...overrideUpdates,
              subgraph: {
                ...sg,
                nodes: sg.nodes.map(sn => {
                  if (sn.id !== nodeId) return sn;
                  const updated = retypeSwizzle({ ...sn, params: { ...sn.params, ...params } });
                  // loopCarry: auto-update socket types when dataType changes
                  if (sn.type === 'loopCarry' && 'dataType' in params) {
                    const t = params.dataType as import('../types/nodeGraph').DataType;
                    return {
                      ...updated,
                      inputs: {
                        init: { ...updated.inputs.init, type: t },
                        next: { ...updated.inputs.next, type: t },
                      },
                      outputs: {
                        value: { ...updated.outputs.value, type: t },
                      },
                    };
                  }
                  return updated;
                }),
              },
            },
          };
        }),
      };
    });

    // Randomize's locks (__randExclude, __randSkip) never reach the shader: no recompile, no uniform push.
    if (Object.keys(params).length > 0 && Object.keys(params).every(k => k.startsWith('__rand'))) return;

    // Optimisation: if every changed param already has a compiled uniform entry,
    // push the new values directly to ShaderCanvas via paramUniforms — no recompile.
    //
    // The uniform name comes from the compiler's binding map, never rebuilt
    // here: the compiler names uniforms from the node's *slug* (`u_p_fbmx49_scale`),
    // not its id, and a hand-built name from the id silently never matched, so
    // every slider tick used to take the full-recompile path below.
    if (options?.immediate) {
      const { paramUniforms: currentUniforms, paramBindings } = get();
      const uniformUpdates: Record<string, number | number[]> = {};
      let allAreUniforms = true;
      for (const [key, val] of Object.entries(params)) {
        // A float slider, or a vec3 / colour picker's [r, g, b].
        const isVec3 = Array.isArray(val) && val.length === 3 && val.every(n => typeof n === 'number');
        if (typeof val !== 'number' && !isVec3) { allAreUniforms = false; break; }
        // Editing inside a group passes the inner node's own id with a plain key.
        // Editing a group node's override passes the group id with an
        // `innerNodeId::paramKey` key — which is already the binding key. A param
        // surfaced from a nested group uses `nestedGroupId::innerNodeId::paramKey`;
        // the compiler binds it by the inner node's own id, i.e. the last two parts.
        const bindingKey = key.includes('::') ? key.split('::').slice(-2).join('::') : paramBindingKey(nodeId, key);
        const uniformName = paramBindings[bindingKey];
        if (!uniformName || !(uniformName in currentUniforms)) { allAreUniforms = false; break; }
        uniformUpdates[uniformName] = val as number | number[];
      }
      if (allAreUniforms && Object.keys(uniformUpdates).length > 0) {
        // Fast path: update uniforms only, skip shader recompile entirely
        get().updateParamUniforms(uniformUpdates);
        return;
      }
      // Slow path: structural change or non-uniform param — full recompile
      compilationService.cancelPending();
      get().compile();
    } else {
      // String fields (GLSL body, expr formula): debounce to avoid compile-on-every-keystroke
      compilationService.scheduleCompile(() => get().compile(), 500);
    }
  },

  randomizeNodeParams: (nodeId, weights) => {
    const { nodes, activeGroupPath } = get();
    const scope = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
    const node = scope.find(n => n.id === nodeId);
    const def = node ? getNodeDefinitionFor(node) : undefined;
    if (!node || !def) return;
    const opts = getRandomizeOptions();
    const weightOf = opts.focus && weights ? (k: string) => weights[node.type === 'group' ? k : weightKey(node.id, k)] : undefined;
    const patch = randomizedParams(node, def, Math.random, opts, weightOf);
    if (Object.keys(patch).length === 0) return;
    // Its own undo step, even when clicked again right away (the param-edit burst would merge them)
    undoManager.push(nodes, { label: `Randomised ${nodeName(node)}`, nodeIds: [nodeId] });
    _historyParamPending = true;
    get().updateNodeParams(nodeId, patch, { immediate: true });
    if (_historyParamTimer) { clearTimeout(_historyParamTimer); _historyParamTimer = null; }
    _historyParamPending = false;
  },

  updateNodeOutputs: (nodeId, outputs) => {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId ? { ...n, outputs } : n
      ),
    }));
    compilationService.cancelPending();
    get().compile();
  },

  updateNodeInputs: (nodeId, inputs) => {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId ? { ...n, inputs } : n
      ),
    }));
  },

  connectNodes: (sourceNodeId, sourceOutputKey, targetNodeId, targetInputKey) => {
    {
      // A wire you make teaches the suggestions (suggestions/learning.ts, recency-weighted).
      const a = nodeInScope(get(), sourceNodeId), b = nodeInScope(get(), targetNodeId);
      if (a && b) recordWireBetween(a.type, sourceOutputKey, b.type, targetInputKey);
    }
    undoManager.push(get().nodes, { label: `Connected ${nodeName(nodeInScope(get(), sourceNodeId))} → ${nodeName(nodeInScope(get(), targetNodeId))}`, nodeIds: [sourceNodeId, targetNodeId] });
    {
      // Replacing a wire: keep the old one so the node's menu can offer it back.
      const st = get();
      const prev = nodeInScope(st, targetNodeId)?.inputs[targetInputKey]?.connection;
      if (prev && (prev.nodeId !== sourceNodeId || prev.outputKey !== sourceOutputKey)) {
        set({ wireHistory: rememberWire(st.wireHistory, { fromNodeId: prev.nodeId, fromOutputKey: prev.outputKey, toNodeId: targetNodeId, toInputKey: targetInputKey }) });
      }
    }
    set(state => {
      // Top-level connection
      if (state.nodes.some(n => n.id === targetNodeId)) {
        return {
          nodes: state.nodes.map(n => {
            if (n.id !== targetNodeId) return n;
            return {
              ...clearLegacyColumnsWire(n, targetInputKey),
              inputs: {
                ...n.inputs,
                [targetInputKey]: {
                  ...n.inputs[targetInputKey],
                  connection: { nodeId: sourceNodeId, outputKey: sourceOutputKey },
                },
              },
            };
          }),
        };
      }
      // Subgraph connection (inside active group, handles depth 1 and 2)
      const path = state.activeGroupPath;
      if (path.length === 0) return {};
      const activeNodes = getActiveNodes(state.nodes, path);
      if (!activeNodes) return {};
      const targetSgNode = activeNodes.find(sn => sn.id === targetNodeId);
      if (!targetSgNode) return {};
      // Determine type/label for __param_ virtual inputs
      let socketType: import('../types/nodeGraph').DataType = targetSgNode.inputs[targetInputKey]?.type ?? 'float';
      let socketLabel = targetSgNode.inputs[targetInputKey]?.label ?? targetInputKey;
      if (targetInputKey.startsWith('__param_')) {
        const paramKey = targetInputKey.slice('__param_'.length);
        const def = getNodeDefinitionFor(targetSgNode);
        const pd = def?.paramDefs?.[paramKey];
        if (pd) { socketType = (pd.type as import('../types/nodeGraph').DataType) ?? 'float'; socketLabel = pd.label; }
      }
      const newActiveNodes = activeNodes.map(sn => {
        if (sn.id !== targetNodeId) return sn;
        return {
          ...clearLegacyColumnsWire(sn, targetInputKey),
          inputs: {
            ...sn.inputs,
            [targetInputKey]: {
              type: socketType,
              label: socketLabel,
              connection: { nodeId: sourceNodeId, outputKey: sourceOutputKey },
            },
          },
        };
      });
      const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
      return { nodes: newTop ?? state.nodes };
    });
    get().compile();
  },

  disconnectInput: (nodeId, inputKey) => {
    undoManager.push(get().nodes, { label: `Disconnected ${nodeName(nodeInScope(get(), nodeInScope(get(), nodeId)?.inputs[inputKey]?.connection?.nodeId ?? ''))} → ${nodeName(nodeInScope(get(), nodeId))}`, nodeIds: [nodeId] });
    {
      const st = get();
      const prev = nodeInScope(st, nodeId)?.inputs[inputKey]?.connection;
      if (prev) set({ wireHistory: rememberWire(st.wireHistory, { fromNodeId: prev.nodeId, fromOutputKey: prev.outputKey, toNodeId: nodeId, toInputKey: inputKey }) });
    }
    set(state => {
      // Top-level
      if (state.nodes.some(n => n.id === nodeId)) {
        return {
          nodes: state.nodes.map(n => {
            if (n.id !== nodeId) return n;
            const newInput = { ...n.inputs[inputKey] };
            delete newInput.connection;
            return { ...clearLegacyColumnsWire(n, inputKey), inputs: { ...n.inputs, [inputKey]: newInput } };
          }),
        };
      }
      // Subgraph (handles depth 1 and 2)
      const path = state.activeGroupPath;
      if (path.length === 0) return {};
      const activeNodes = getActiveNodes(state.nodes, path);
      if (!activeNodes) return {};
      const newActiveNodes = activeNodes.map(sn => {
        if (sn.id !== nodeId) return sn;
        const newInput = { ...sn.inputs[inputKey] };
        delete newInput.connection;
        return { ...clearLegacyColumnsWire(sn, inputKey), inputs: { ...sn.inputs, [inputKey]: newInput } };
      });
      const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
      return { nodes: newTop ?? state.nodes };
    });
    get().compile();
  },

  setPaletteStops: (nodeId, colors, opts) => {
    const st = get();
    const node = nodeInScope(st, nodeId);
    if (!node || colors.length < 2) return 0;
    // Thin a long palette evenly rather than cutting it off
    const picked = colors.length <= STOP_PALETTE_MAX ? colors
      : Array.from({ length: STOP_PALETTE_MAX }, (_, i) => colors[Math.round(i * (colors.length - 1) / (STOP_PALETTE_MAX - 1))]);
    const stopParams: Record<string, unknown> = { stops: String(picked.length) };
    picked.forEach((c, i) => { stopParams[`color${i}`] = [c[0], c[1], c[2]]; });
    if (opts?.wrap) stopParams.wrap = opts.wrap;
    if (opts?.blend) stopParams.blend = opts.blend;
    if (node.type === 'palette') {
      get().convertPaletteToStops(nodeId, picked.length, picked, opts);
    } else if (node.type === 'stopPalette') {
      get().updateNodeParams(nodeId, stopParams, { immediate: true });
    } else {
      return 0;
    }
    return picked.length;
  },

  convertPaletteToStops: (nodeId, count = 'auto', given, opts) => {
    const st = get();
    const old = nodeInScope(st, nodeId);
    const def = getNodeDefinition('stopPalette');
    if (!old || old.type !== 'palette' || !def) return false;
    let colors: Array<[number, number, number]>;
    let blend = opts?.blend ?? 'smooth';
    // When the stops span several Angle units (a palette that repeats every 2, say), Scale and
    // Speed shrink by the same factor so the result cycles exactly as fast as the cosine did.
    let period = 1;
    if (given) {
      colors = given.slice(0, STOP_PALETTE_MAX);
    } else {
      const coeffs = paletteNodeCoeffs(old.params);
      const fit = count === 'auto'
        ? autoFitCosineStops(coeffs, STOP_PALETTE_MAX)
        : fitCosineStops(coeffs, Math.max(2, Math.min(STOP_PALETTE_MAX, count)));
      colors = fit.stops;
      blend = opts?.blend ?? fit.blend;
      period = fit.period;
    }
    const n = colors.length;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const params: Record<string, unknown> = {
      ...(def.defaultParams ?? {}),
      value: old.params.value ?? 0, anim: old.params.anim ?? 0,
      scale: num(old.params.scale, 1) / period, speed: num(old.params.speed, 1) / period,
      stops: String(n), wrap: opts?.wrap ?? 'loop', blend,
    };
    colors.forEach((c, i) => { params[`color${i}`] = c; });
    // Same id and the same socket keys (value, anim → color), so wires in and out survive untouched.
    const converted: GraphNode = {
      ...old,
      type: 'stopPalette',
      inputs: {
        value: { ...def.inputs.value, connection: old.inputs.value?.connection },
        anim: { ...def.inputs.anim, connection: old.inputs.anim?.connection },
      },
      outputs: { ...def.outputs },
      params,
    };
    undoManager.push(st.nodes, { label: `Converted ${nodeName(old)} to colour stops`, nodeIds: [nodeId] });
    set(state => {
      const swap = (nodes: GraphNode[]) => nodes.map(n2 => (n2.id === nodeId ? converted : n2));
      if (state.activeGroupPath.length === 0) return { nodes: swap(state.nodes) };
      const active = getActiveNodes(state.nodes, state.activeGroupPath);
      if (!active) return {};
      return { nodes: setActiveNodes(state.nodes, state.activeGroupPath, swap(active)) ?? state.nodes };
    });
    get().compile();
    return true;
  },

  disconnectOutput: (nodeId, outputKey) => {
    const st = get();
    const scope = st.activeGroupPath.length > 0 ? (getActiveNodes(st.nodes, st.activeGroupPath) ?? []) : st.nodes;
    const targets: Array<{ id: string; key: string }> = [];
    for (const n of scope) {
      for (const [k, inp] of Object.entries(n.inputs)) {
        if (inp.connection?.nodeId === nodeId && inp.connection.outputKey === outputKey) targets.push({ id: n.id, key: k });
      }
    }
    if (targets.length === 0) return 0;
    undoManager.push(st.nodes, { label: `Disconnected ${targets.length === 1 ? 'a wire' : `${targets.length} wires`} from ${nodeName(nodeInScope(st, nodeId))}`, nodeIds: [nodeId, ...targets.map(t => t.id)] });
    let history = st.wireHistory;
    for (const t of targets) history = rememberWire(history, { fromNodeId: nodeId, fromOutputKey: outputKey, toNodeId: t.id, toInputKey: t.key });
    const strip = (nodes: GraphNode[]) => nodes.map(n => {
      const hit = targets.filter(t => t.id === n.id);
      if (hit.length === 0) return n;
      const inputs = { ...n.inputs };
      for (const t of hit) { const copy = { ...inputs[t.key] }; delete copy.connection; inputs[t.key] = copy; }
      return { ...n, inputs };
    });
    set(state => {
      if (state.activeGroupPath.length === 0) return { nodes: strip(state.nodes), wireHistory: history };
      const active = getActiveNodes(state.nodes, state.activeGroupPath);
      if (!active) return {};
      return { nodes: setActiveNodes(state.nodes, state.activeGroupPath, strip(active)) ?? state.nodes, wireHistory: history };
    });
    get().compile();
    return targets.length;
  },

  clearDisconnectedNotice: () => set({ disconnectedNotice: null }),

  setGroupOutput: (groupId, outputPortKey, fromNodeId, fromOutputKey) => {
    undoManager.push(get().nodes, { label: 'Changed a group output', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => {
      // Find the group node at any depth
      let groupNode = state.nodes.find(n => n.id === groupId);
      if (!groupNode && activeGroupPath.length >= 2) {
        const parentNodes = getActiveNodes(state.nodes, activeGroupPath.slice(0, -1));
        groupNode = parentNodes?.find(n => n.id === groupId);
      }
      if (!groupNode) return {};
      const sg = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!sg) return {};
      const port = sg.outputPorts.find(p => p.key === outputPortKey);
      if (!port) return {};

      const sourceNode = sg.nodes.find(sn => sn.id === fromNodeId);
      const newType = (sourceNode?.outputs[fromOutputKey]?.type ?? port.type) as import('../types/nodeGraph').DataType;
      const typeChanged = newType !== port.type;

      const newOutputPorts = sg.outputPorts.map(p =>
        p.key === outputPortKey ? { ...p, fromNodeId, fromOutputKey, type: newType } : p
      );
      const newGroupOutputs = {
        ...groupNode.outputs,
        [outputPortKey]: { ...groupNode.outputs[outputPortKey], type: newType },
      };

      let disconnectedCount = 0;
      const updater = (n: GraphNode) => ({
        ...n,
        outputs: newGroupOutputs,
        params: { ...n.params, subgraph: { ...sg, outputPorts: newOutputPorts } },
      });
      let newNodes = updateNodeInTree(state.nodes, groupId, activeGroupPath, updater);

      // Disconnect incompatible outer connections (top-level groups only for now)
      if (typeChanged && !activeGroupPath.length) {
        newNodes = newNodes.map(n => {
          if (n.id === groupId) return n;
          let changed = false;
          const newInputs = { ...n.inputs };
          for (const [key, inp] of Object.entries(n.inputs)) {
            if (inp.connection?.nodeId === groupId && inp.connection?.outputKey === outputPortKey) {
              if (!typesCompatible(newType, inp.type)) {
                const newInp = { ...inp };
                delete newInp.connection;
                newInputs[key] = newInp;
                disconnectedCount++;
                changed = true;
              }
            }
          }
          return changed ? { ...n, inputs: newInputs } : n;
        });
      }

      return {
        nodes: newNodes,
        disconnectedNotice: typeChanged && disconnectedCount > 0
          ? `Output type changed to ${newType} — ${disconnectedCount} incompatible connection${disconnectedCount > 1 ? 's' : ''} removed`
          : null,
      };
    });
    get().compile();
  },

  addMarchLoopInput: (groupNodeId, key, type, label) => {
    undoManager.push(get().nodes, { label: `Added loop input ${label ?? key}`, nodeIds: [groupNodeId] });
    set(state => {
      const nodes = state.nodes.map(n => {
        if (n.id !== groupNodeId) return n;
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        // Update marchLoopInputs node's outputs + params.extraInputs (Agent Inputs takes added ports the same way)
        const newSgNodes = sg.nodes.map(sn => {
          if (sn.type !== 'marchLoopInputs' && sn.type !== 'agentInputs') return sn;
          const extraInputs = [
            ...((sn.params.extraInputs ?? []) as Array<{key: string; type: string; label: string}>),
            { key, type, label },
          ];
          return { ...sn, outputs: { ...sn.outputs, [key]: { type, label } }, params: { ...sn.params, extraInputs } };
        });
        return {
          ...n,
          inputs: { ...n.inputs, [key]: { type, label } },
          params: { ...n.params, subgraph: { ...sg, nodes: newSgNodes } },
        };
      });
      return { nodes };
    });
    get().compile();
  },

  removeMarchLoopInput: (groupNodeId, key) => {
    undoManager.push(get().nodes, { label: 'Removed a loop input', nodeIds: [groupNodeId] });
    set(state => {
      const nodes = state.nodes.map(n => {
        if (n.id !== groupNodeId) return n;
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        const newSgNodes = sg.nodes.map(sn => {
          if (sn.type !== 'marchLoopInputs' && sn.type !== 'agentInputs') return sn;
          const extraInputs = ((sn.params.extraInputs ?? []) as Array<{key: string; type: string; label: string}>).filter(e => e.key !== key);
          const { [key]: _removed, ...restOutputs } = sn.outputs;
          return { ...sn, outputs: restOutputs, params: { ...sn.params, extraInputs } };
        });
        const { [key]: _removedInput, ...restInputs } = n.inputs;
        return { ...n, inputs: restInputs, params: { ...n.params, subgraph: { ...sg, nodes: newSgNodes } } };
      });
      return { nodes };
    });
    get().compile();
  },

  renameMarchLoopInput: (groupNodeId, key, newLabel) => {
    set(state => {
      const nodes = state.nodes.map(n => {
        if (n.id !== groupNodeId) return n;
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        const newSgNodes = sg.nodes.map(sn => {
          if (sn.type !== 'marchLoopInputs' && sn.type !== 'agentInputs') return sn;
          const extraInputs = ((sn.params.extraInputs ?? []) as Array<{key: string; type: string; label: string}>)
            .map(e => e.key === key ? { ...e, label: newLabel } : e);
          return { ...sn, outputs: { ...sn.outputs, [key]: { ...sn.outputs[key], label: newLabel } }, params: { ...sn.params, extraInputs } };
        });
        return {
          ...n,
          inputs: n.inputs[key] ? { ...n.inputs, [key]: { ...n.inputs[key], label: newLabel } } : n.inputs,
          params: { ...n.params, subgraph: { ...sg, nodes: newSgNodes } },
        };
      });
      return { nodes };
    });
  },

  toggleMarchLoopOutputPort: (groupNodeId, outputKey) => {
    set(state => {
      const nodes = state.nodes.map(n => {
        if (n.id !== groupNodeId) return n;
        const hidden = (n.params.hiddenOutputs as string[] | undefined) ?? [];
        const newHidden = hidden.includes(outputKey) ? hidden.filter(k => k !== outputKey) : [...hidden, outputKey];
        return { ...n, params: { ...n.params, hiddenOutputs: newHidden } };
      });
      return { nodes };
    });
    get().compile();
  },

  addGroupInput: (groupId, type, label) => {
    undoManager.push(get().nodes, { label: 'Added a group input', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => {
      return {
        nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          const existingKeys = new Set([...sg.inputPorts.map(p => p.key), ...sg.outputPorts.map(p => p.key)]);
          let idx = sg.inputPorts.length + sg.outputPorts.length;
          while (existingKeys.has(`in${idx}`)) idx++;
          const portKey = `in${idx}`;
          const newPort: import('../types/nodeGraph').GroupInputPort = { key: portKey, type, label, toNodeId: '', toInputKey: '' };
          return { ...n, inputs: { ...n.inputs, [portKey]: { type, label } }, params: { ...n.params, subgraph: { ...sg, inputPorts: [...sg.inputPorts, newPort] } } };
        }),
      };
    });
    get().compile();
  },

  // Wires `toNodeId`'s `toInputKey` to this port via the GROUP_PORT_SENTINEL
  // connection — the live source of truth the compiler scans for (see
  // resolveGroupPortOverrides) — so a port can drive any number of internal
  // targets and each stays freely rewireable/disconnectable afterward,
  // instead of a single fixed toNodeId/toInputKey silently overriding
  // whatever the node is actually wired to. Also updates the port's own
  // toNodeId/toInputKey as a display-only "primary target" record (legacy
  // field, no longer read by the compiler for plain groups).
  rerouteGroupInput: (groupId, portKey, toNodeId, toInputKey) => {
    undoManager.push(get().nodes, { label: 'Rerouted a group input', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => {
      return {
        nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          const newSgNodes = sg.nodes.map(sn => {
            if (sn.id !== toNodeId) return sn;
            const existing = sn.inputs[toInputKey];
            return {
              ...sn,
              inputs: {
                ...sn.inputs,
                [toInputKey]: { ...(existing ?? { type: 'float' as import('../types/nodeGraph').DataType, label: toInputKey }), connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: portKey } },
              },
            };
          });
          return {
            ...n,
            params: {
              ...n.params,
              subgraph: {
                ...sg,
                nodes: newSgNodes,
                inputPorts: sg.inputPorts.map(p => p.key === portKey ? { ...p, toNodeId, toInputKey } : p),
              },
            },
          };
        }),
      };
    });
    get().compile();
  },

  removeGroupInputPort: (groupId, portKey) => {
    undoManager.push(get().nodes, { label: 'Removed a group input', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => {
      return {
        nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          const newInputs = { ...n.inputs };
          const inputSlot = newInputs[portKey];
          if (inputSlot) {
            newInputs[portKey] = { type: inputSlot.type, label: inputSlot.label };
          }
          return {
            ...n,
            inputs: newInputs,
            params: { ...n.params, subgraph: { ...sg, inputPorts: sg.inputPorts.filter(p => p.key !== portKey) } },
          };
        }),
      };
    });
    get().compile();
  },

  exposeGroupInput: (groupId, toNodeId, toInputKey, type, label) => {
    undoManager.push(get().nodes, { label: 'Exposed an input on the group', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => ({
      nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        const existingKeys = new Set([...sg.inputPorts.map(p => p.key), ...sg.outputPorts.map(p => p.key)]);
        let idx = sg.inputPorts.length + sg.outputPorts.length;
        while (existingKeys.has(`in${idx}`)) idx++;
        const portKey = `in${idx}`;
        const newPort: import('../types/nodeGraph').GroupInputPort = { key: portKey, type, label, toNodeId, toInputKey };
        const newSgNodes = sg.nodes.map(sn => {
          if (sn.id !== toNodeId) return sn;
          const existing = sn.inputs[toInputKey];
          return {
            ...sn,
            inputs: {
              ...sn.inputs,
              [toInputKey]: { ...(existing ?? { type, label: toInputKey }), connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: portKey } },
            },
          };
        });
        return {
          ...n,
          inputs: { ...n.inputs, [portKey]: { type, label } },
          params: { ...n.params, subgraph: { ...sg, nodes: newSgNodes, inputPorts: [...sg.inputPorts, newPort] } },
        };
      }),
    }));
    get().compile();
  },

  addGroupInputWithSource: (groupId, sourceNodeId, sourceOutputKey, type, label) => {
    undoManager.push(get().nodes, { label: 'Added a group input', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => ({
      nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        const existingKeys = new Set([...sg.inputPorts.map(p => p.key), ...sg.outputPorts.map(p => p.key)]);
        let idx = sg.inputPorts.length + sg.outputPorts.length;
        while (existingKeys.has(`in${idx}`)) idx++;
        const portKey = `in${idx}`;
        const newPort: import('../types/nodeGraph').GroupInputPort = { key: portKey, type, label, toNodeId: '', toInputKey: '' };
        return {
          ...n,
          inputs: { ...n.inputs, [portKey]: { type, label, connection: { nodeId: sourceNodeId, outputKey: sourceOutputKey } } },
          params: { ...n.params, subgraph: { ...sg, inputPorts: [...sg.inputPorts, newPort] } },
        };
      }),
    }));
    get().compile();
  },

  exposeGroupOutput: (groupId, fromNodeId, fromOutputKey, type, label) => {
    undoManager.push(get().nodes, { label: 'Exposed an output on the group', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => ({
      nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        const existingKeys = new Set([...sg.inputPorts.map(p => p.key), ...sg.outputPorts.map(p => p.key)]);
        let idx = sg.outputPorts.length;
        let portKey = `out${idx}`;
        while (existingKeys.has(portKey)) portKey = `out${++idx}`;
        const newPort: import('../types/nodeGraph').GroupOutputPort = { key: portKey, type, label, fromNodeId, fromOutputKey };
        return {
          ...n,
          outputs: { ...n.outputs, [portKey]: { type, label } },
          params: { ...n.params, subgraph: { ...sg, outputPorts: [...sg.outputPorts, newPort] } },
        };
      }),
    }));
    get().compile();
  },

  addGroupOutput: (groupId, type = 'float', label) => {
    undoManager.push(get().nodes, { label: 'Added a group output', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => {
      return {
        nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          const existingKeys = new Set([...sg.inputPorts.map(p => p.key), ...sg.outputPorts.map(p => p.key)]);
          let idx = sg.outputPorts.length;
          let pk = `out${idx}`;
          while (existingKeys.has(pk)) pk = `out${++idx}`;
          const portLabel = label ?? `Output ${sg.outputPorts.length + 1}`;
          const newPort: import('../types/nodeGraph').GroupOutputPort = { key: pk, type, label: portLabel, fromNodeId: '', fromOutputKey: '' };
          return { ...n, outputs: { ...n.outputs, [pk]: { type, label: portLabel } }, params: { ...n.params, subgraph: { ...sg, outputPorts: [...sg.outputPorts, newPort] } } };
        }),
      };
    });
    get().compile();
  },

  removeGroupOutput: (groupId, portKey) => {
    undoManager.push(get().nodes, { label: 'Removed a group output', nodeIds: [groupId] });
    const { activeGroupPath } = get();
    set(state => {
      const newNodes = updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        const newOutputs = { ...n.outputs };
        delete newOutputs[portKey];
        return { ...n, outputs: newOutputs, params: { ...n.params, subgraph: { ...sg, outputPorts: sg.outputPorts.filter(p => p.key !== portKey) } } };
      });
      // Disconnect external nodes wired to this port (top-level groups only)
      if (!activeGroupPath.length) {
        return {
          nodes: newNodes.map(n => {
            if (n.id === groupId) return n;
            let changed = false;
            const newInputs = { ...n.inputs };
            for (const [key, inp] of Object.entries(n.inputs)) {
              if (inp.connection?.nodeId === groupId && inp.connection?.outputKey === portKey) {
                const newInp = { ...inp }; delete newInp.connection; newInputs[key] = newInp; changed = true;
              }
            }
            return changed ? { ...n, inputs: newInputs } : n;
          }),
        };
      }
      return { nodes: newNodes };
    });
    get().compile();
  },

  setNodeAssignOp: (nodeId, op) => {
    set(state => {
      const path = state.activeGroupPath;
      if (path.length > 0) {
        const activeNodes = getActiveNodes(state.nodes, path);
        if (!activeNodes) return {};
        const newActiveNodes = activeNodes.map(sn => sn.id === nodeId ? { ...sn, assignOp: op } : sn);
        const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
        return { nodes: newTop ?? state.nodes };
      }
      return { nodes: state.nodes.map(n => n.id === nodeId ? { ...n, assignOp: op } : n) };
    });
    get().compile();
  },

  setNodeAssignInit: (nodeId, expr) => {
    set(state => {
      const path = state.activeGroupPath;
      if (path.length > 0) {
        const activeNodes = getActiveNodes(state.nodes, path);
        if (!activeNodes) return {};
        const newActiveNodes = activeNodes.map(sn => sn.id === nodeId ? { ...sn, assignInit: expr } : sn);
        const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
        return { nodes: newTop ?? state.nodes };
      }
      return { nodes: state.nodes.map(n => n.id === nodeId ? { ...n, assignInit: expr } : n) };
    });
    get().compile();
  },

  toggleNodeCarryMode: (nodeId) => {
    set(state => {
      const path = state.activeGroupPath;
      if (path.length > 0) {
        const activeNodes = getActiveNodes(state.nodes, path);
        if (!activeNodes) return {};
        const newActiveNodes = activeNodes.map(sn => sn.id === nodeId ? { ...sn, carryMode: !sn.carryMode } : sn);
        const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
        return { nodes: newTop ?? state.nodes };
      }
      return { nodes: state.nodes.map(n => n.id === nodeId ? { ...n, carryMode: !n.carryMode } : n) };
    });
    get().compile();
  },

  toggleBypass: (nodeId) => {
    { const n = nodeInScope(get(), nodeId); undoManager.push(get().nodes, { label: n?.bypassed ? `Turned ${nodeName(n)} back on` : `Bypassed ${nodeName(n)}`, nodeIds: [nodeId] }); }
    set(state => {
      const path = state.activeGroupPath;
      if (path.length > 0) {
        const activeNodes = getActiveNodes(state.nodes, path);
        if (!activeNodes) return {};
        const newActiveNodes = activeNodes.map(n => n.id === nodeId ? { ...n, bypassed: !n.bypassed } : n);
        const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
        return { nodes: newTop ?? state.nodes };
      }
      return { nodes: state.nodes.map(n => n.id === nodeId ? { ...n, bypassed: !n.bypassed } : n) };
    });
    get().compile();
  },

  setNodesRewritten: (nodes, label) => {
    undoManager.push(get().nodes, { label: label ?? 'Optimised the graph' });
    const ids = new Set(nodes.map(n => n.id));
    set(st => ({ nodes, looseGroups: st.looseGroups.map(g => ({ ...g, memberIds: g.memberIds.filter(id => ids.has(id)) })).filter(g => g.memberIds.length > 1), selectedNodeId: st.selectedNodeId && ids.has(st.selectedNodeId) ? st.selectedNodeId : null, selectedNodeIds: st.selectedNodeIds.filter(id => ids.has(id)), nodeProbeValues: null }));
    get().compile();
  },

  setConstantsItems: (nodeId, items) => {
    { const n = nodeInScope(get(), nodeId); undoManager.push(get().nodes, { label: nodeName(n) === 'Constants' ? 'Applied Constants' : `Applied constants on ${nodeName(n)}`, nodeIds: [nodeId] }); }
    const outputs = constantsOutputs(items);
    const rebuild = (list: GraphNode[]): GraphNode[] => list.map(n => {
      if (n.id === nodeId) {
        const params = { ...n.params };
        // Values of entries that no longer exist go, so a stale slider value can't come back under a reused name.
        for (const it of constantsItems(n)) for (const k of paramKeysOf(it)) delete params[k];
        return { ...n, params: { ...params, items, ...paramsFor(items) }, outputs };
      }
      const stale = Object.entries(n.inputs).filter(([, s]) => s.connection?.nodeId === nodeId && !(s.connection.outputKey in outputs));
      if (!stale.length) return n;
      const inputs = { ...n.inputs };
      for (const [k, s] of stale) inputs[k] = { ...s, connection: undefined };
      return { ...n, inputs };
    });
    set(state => {
      if (state.nodes.some(n => n.id === nodeId)) return { nodes: rebuild(state.nodes) };
      const path = state.activeGroupPath;
      const inner = getActiveNodes(state.nodes, path);
      if (!inner || !inner.some(n => n.id === nodeId)) return {};
      return { nodes: setActiveNodes(state.nodes, path, rebuild(inner)) ?? state.nodes };
    });
    get().compile();
  },

  updateNodeSockets: (nodeId, inputDefs, outputType, extraOutputs = []) => {
    undoManager.push(get().nodes, { label: `Changed the inputs of ${nodeName(nodeInScope(get(), nodeId))}`, nodeIds: [nodeId] });
    const outputs: Record<string, { type: DataType; label: string }> = { result: { type: outputType, label: 'Result' } };
    for (const o of extraOutputs) if (o.name && o.name !== 'result' && !outputs[o.name]) outputs[o.name] = { type: o.type, label: o.name };
    /** A wire into an output that went away is dropped. */
    const pruneReaders = (list: import('../types/nodeGraph').GraphNode[]) => list.map(n => {
      let changed = false; const inputs = { ...n.inputs };
      for (const [k, sck] of Object.entries(inputs)) if (sck.connection?.nodeId === nodeId && !outputs[sck.connection.outputKey]) { inputs[k] = { ...sck, connection: undefined }; changed = true; }
      return changed ? { ...n, inputs } : n;
    });

    const buildUpdatedNode = (n: import('../types/nodeGraph').GraphNode): import('../types/nodeGraph').GraphNode => {
      const newInputs: Record<string, InputSocket> = {};
      for (const inp of inputDefs) {
        const existing = n.inputs[inp.name];
        const hasSlider = inp.type === 'float' && inp.slider != null;
        const paramVal = typeof n.params[inp.name] === 'number' ? (n.params[inp.name] as number) : 0;
        newInputs[inp.name] = {
          type: inp.type,
          label: inp.name,
          defaultValue: hasSlider ? paramVal : undefined,
          connection: (!hasSlider && existing?.type === inp.type) ? existing.connection : undefined,
        };
        // If carry is enabled, add an _init override socket
        if ((inp as { carry?: boolean }).carry) {
          const existingInit = n.inputs[`${inp.name}_init`];
          newInputs[`${inp.name}_init`] = {
            type: inp.type,
            label: `${inp.name} (init)`,
            connection: existingInit?.connection,
          };
        }
      }
      return { ...n, inputs: newInputs, outputs };
    };

    set(state => {
      // Top-level node
      if (state.nodes.some(n => n.id === nodeId)) {
        return { nodes: pruneReaders(state.nodes.map(n => n.id === nodeId ? buildUpdatedNode(n) : n)) };
      }
      // Subgraph node (inside active group)
      const groupId = state.activeGroupId;
      if (!groupId) return {};
      return {
        nodes: state.nodes.map(n => {
          if (n.id !== groupId) return n;
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          return {
            ...n,
            params: {
              ...n.params,
              subgraph: {
                ...sg,
                nodes: sg.nodes.map(sn => sn.id === nodeId ? buildUpdatedNode(sn) : sn),
              },
            },
          };
        }),
      };
    });
    get().compile();
  },

  changeNodeVectorType: (nodeId, primaryInputKey, primaryOutputKey, outputType) => {
    undoManager.push(get().nodes, { label: `Made ${nodeName(nodeInScope(get(), nodeId))} a ${outputType}`, nodeIds: [nodeId] });

    const updater = (n: import('../types/nodeGraph').GraphNode): import('../types/nodeGraph').GraphNode => {
      const newInputs = { ...n.inputs };
      // Both operands of an arithmetic node follow the chosen type (VECTORIZABLE_NODES.alsoInputs).
      const also = VECTORIZABLE_NODES[n.type]?.alsoInputs ?? [];
      for (const key of [primaryInputKey, ...also]) {
        const existingIn = newInputs[key];
        if (!existingIn) continue;
        // Drop the connection if the type changed (avoids type-mismatch wires)
        const keepConn = existingIn.connection != null && existingIn.type === outputType;
        newInputs[key] = { ...existingIn, type: outputType, connection: keepConn ? existingIn.connection : undefined };
      }
      const newOutputs = { ...n.outputs };
      if (newOutputs[primaryOutputKey]) {
        newOutputs[primaryOutputKey] = { ...newOutputs[primaryOutputKey], type: outputType };
      }
      return { ...n, params: { ...n.params, outputType }, inputs: newInputs, outputs: newOutputs };
    };

    set(state => {
      if (state.nodes.some(n => n.id === nodeId)) {
        return { nodes: state.nodes.map(n => n.id === nodeId ? updater(n) : n) };
      }
      const groupId = state.activeGroupId;
      if (!groupId) return {};
      return {
        nodes: state.nodes.map(n => {
          if (n.id !== groupId) return n;
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          return { ...n, params: { ...n.params, subgraph: { ...sg, nodes: sg.nodes.map(sn => sn.id === nodeId ? updater(sn) : sn) } } };
        }),
      };
    });
    get().compile();
  },

  compile: (opts) => {
    // A structural compile supersedes any debounced one still on the timer;
    // without this the timer fires later and runs an identical second compile.
    compilationService.cancelPending();
    const force = opts?.force === true;
    // Agents in 3D: the inside of a 3D group (and its Emit, Draw agents and Trails) carry the group's space on
    // their cards (vec3 sockets, the camera): kept in step with the groups' Space before every compile.
    {
      const synced = syncAgentSpaces(get().nodes, getNodeDefinition);
      if (synced !== get().nodes) set({ nodes: synced });
    }
    if (force) {
      // From scratch: nothing the compiler reads is taken from an earlier compile.
      clearNodeDefinitionCache();
      recompileUserNodes();
    }
    const { nodes, previewNodeId, activeGroupId, bakeGraph } = get();
    let graphNodes: GraphNode[];
    if (bakeGraph) {
      // A bake rendering: exactly the graph it asked for.
      graphNodes = bakeGraph;
    } else if (previewNodeId) {
      // Check if the preview target lives inside a group's subgraph rather than at the top level
      const isTopLevel = nodes.some(n => n.id === previewNodeId);
      if (!isTopLevel && activeGroupId) {
        const groupNode = nodes.find(n => n.id === activeGroupId);
        const subgraph = groupNode?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        const isInGroup = subgraph?.nodes.some(n => n.id === previewNodeId) ?? false;
        // Inside an Agents group the eye shows what an agent standing at each pixel would see
        // (compiler/agentGraph.ts agentEyeNodes); the simulation keeps running under it.
        const eye = isInGroup && groupNode?.type === 'agentsGroup' ? agentEyeNodes(nodes, activeGroupId, previewNodeId) : null;
        if (eye) {
          const preview = buildPreviewGraph([...eye.rest, ...eye.copies], previewNodeId);
          const ids = new Set(preview.map(n => n.id));
          graphNodes = [...eye.rest.filter(n => !ids.has(n.id)), ...preview];
        } else graphNodes = isInGroup
          ? buildGroupPreviewGraph(nodes, activeGroupId, previewNodeId)
          : buildPreviewGraph(nodes, previewNodeId);
      } else {
        graphNodes = buildPreviewGraph(nodes, previewNodeId);
      }
    } else {
      graphNodes = nodes;
    }
    const compileT0 = performance.now();
    const result = compileGraph({ nodes: graphNodes });
    recordGraphCompile(performance.now() - compileT0);

    // Patch MLG node.outputs with dynamic acc* sockets discovered at compile time.
    // Preserves any existing acc* labels already stored in the graph (e.g. from saved examples).
    // Every subscriber to `nodes` (each node card, the graph, App) re-renders
    // when the array reference changes, so the map passes below only produce
    // a new array when some element actually changed; otherwise `nodes` is
    // left out of the set() entirely.
    const prevNodes = get().nodes;
    let patchedForAcc = prevNodes;
    let nodesChanged = false;
    // A bake's compile (bakeGraph) says nothing about the open graph's sockets: leave them be.
    if (bakeGraph) { /* nothing to patch */ }
    else if (result.mlgDynamicOutputs && result.mlgDynamicOutputs.size > 0) {
      patchedForAcc = patchedForAcc.map(node => {
        const dynSockets = result.mlgDynamicOutputs!.get(node.id);
        if (!dynSockets) return node;
        let changed = false;
        const mergedOutputs = { ...node.outputs };
        for (const [key, sock] of Object.entries(dynSockets)) {
          if (!mergedOutputs[key]) { mergedOutputs[key] = sock as import('../types/nodeGraph').OutputSocket; changed = true; }
        }
        // Remove stale acc* outputs that no longer exist in the compiled result
        for (const key of Object.keys(mergedOutputs)) {
          if (key.startsWith('acc') && !dynSockets[key]) { delete mergedOutputs[key]; changed = true; }
        }
        if (changed) nodesChanged = true;
        return changed ? { ...node, outputs: mergedOutputs } : node;
      });
    } else {
      // No acc outputs in this compile — strip stale acc* from MLG nodes and
      // disconnect any outer nodes that were wired to those now-dead outputs.
      const strippedMlgIds = new Set<string>();
      patchedForAcc = patchedForAcc.map(node => {
        if (node.type !== 'marchLoopGroup' && node.type !== 'giLitMarchGroup') return node;
        const hasAcc = Object.keys(node.outputs).some(k => k.startsWith('acc'));
        if (!hasAcc) return node;
        strippedMlgIds.add(node.id);
        nodesChanged = true;
        const mergedOutputs = Object.fromEntries(Object.entries(node.outputs).filter(([k]) => !k.startsWith('acc')));
        return { ...node, outputs: mergedOutputs };
      });
      if (strippedMlgIds.size > 0) {
        patchedForAcc = patchedForAcc.map(node => {
          const newInputs = Object.fromEntries(
            Object.entries(node.inputs).map(([k, inp]) => {
              if (inp.connection && strippedMlgIds.has(inp.connection.nodeId) && inp.connection.outputKey.startsWith('acc')) {
                const { connection: _removed, ...rest } = inp;
                return [k, rest];
              }
              return [k, inp];
            })
          );
          const changed = Object.keys(newInputs).some(k => newInputs[k] !== node.inputs[k]);
          if (changed) nodesChanged = true;
          return changed ? { ...node, inputs: newInputs } : node;
        });
      }
    }

    const shaderChanged = result.fragmentShader !== get().fragmentShader;
    // Show passes: the whole graph's programs, even while the eye previews part of it.
    let whole: typeof result | null = result;
    if (bakeGraph) whole = null;
    else if (previewNodeId && (hasPassNode(nodes) || hasAgentsNode(nodes) || hasHiddenBlur(nodes))) {
      const full = compileGraph({ nodes });
      whole = full.success ? full : null;
    }
    const programMap = whole && (whole.passes || whole.agents)
      ? { passes: whole.passes ?? null, agents: whole.agents ?? null, finalNodeIds: whole.finalNodeIds ?? null }
      : null;
    set({
      programMap,
      ...(nodesChanged ? { nodes: patchedForAcc } : {}),
      vertexShader: result.vertexShader,
      fragmentShader: result.fragmentShader,
      compilationErrors: result.errors ?? [],
      nodeOutputVarMap: result.nodeOutputVars,
      paramUniforms: result.paramUniforms,
      paramBindings: result.paramBindings,
      textureUniforms: result.textureUniforms,
      audioUniforms: result.audioUniforms,
      liveUniforms: result.liveUniforms,
      videoUniforms: result.videoUniforms,
      isStateful: result.isStateful,
      echoConfig: result.echo ?? null,
      passes: result.passes ?? null,
      agents: result.agents ?? null,
      finalNodeIds: result.finalNodeIds ?? null,
      nodeSlugMap: result.nodeSlugMap ?? new Map(),
      // Probe values are read from the compiled program, so they only go
      // stale when the shader itself changed (or the program is rebuilt).
      ...(shaderChanged || force ? { nodeProbeValues: null } : {}),
    });
  },

  rebuild: async () => {
    // The error board starts empty: what is left after this is what the rebuild found.
    set(s => ({ glslErrors: [], glslErrorSource: null, previewStale: false, rebuildEpoch: s.rebuildEpoch + 1 }));
    get().compile({ force: true });
    const reset = await runRebuildHandlers();
    const { compilationErrors, glslErrors } = get();
    return { reset, errors: [...compilationErrors, ...glslErrors] };
  },

  updateParamUniforms: (updates) => {
    set(state => ({ paramUniforms: { ...state.paramUniforms, ...updates } }));
  },

  setPlay: (next, history) => {
    const prev = get().play;
    // Layer groups stay whole: a member removed, moved or duplicated elsewhere never splits one.
    const play = tidyGroups(typeof next === 'function' ? next(prev) : next);
    if (play === prev) return;
    if (history !== false && !get().scratch) recordPlayStep(prev, play, history);
    set({ play });
  },

  setDataset: (dataset) => set(state => ({ datasets: { ...state.datasets, [dataset.id]: dataset } })),
  updateDataset: (id, patch) => set(state => {
    const d = state.datasets[id];
    return d ? { datasets: { ...state.datasets, [id]: { ...d, ...patch } } } : state;
  }),
  removeDataset: (id) => set(state => {
    if (!state.datasets[id]) return state;
    const next = { ...state.datasets };
    delete next[id];
    return { datasets: next };
  }),

  savedGraphHasPlay: (name) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(`shader-studio:${name}`) ?? 'null') as { play?: unknown } | null;
      return !isPlayRecordEmpty(parsePlayRecord(parsed?.play));
    } catch { return false; }
  },

  playWebInput: (title) => {
    const st = get();
    const live = new Map<string, number | number[]>();
    for (const c of st.play.controls) {
      const v = playEngine.liveValue(c.id);
      if (v !== undefined) live.set(c.id, v);
    }
    // A Background layer's other graphs, compiled for the page (examples that haven't loaded yet are listed as left behind).
    return webInputFrom(st, st.play, { title, aspect: st.previewAspect, live, media: webMedia(st), backgroundGraphs: queueGraphsForWeb(st.play).graphs, datasets: st.datasets, liveData: id => datasetStore.result(id) });
  },

  exportPlayHtml: async (options, title, extras) => {
    const { input } = get().playWebInput(title);
    if (extras?.hands && usesHands(input.play)) {
      const { loadHandAssets } = await import('../play/handExport');
      input.handAssets = await loadHandAssets();
    }
    // A 3D Script layer: the page carries three.js, loaded on first need.
    if (playUses3D(input.play)) await loadThreeSource();
    const base = (title.trim() || 'play').replace(/\.html?$/i, '').replace(/[^\w\- ]+/g, '').trim() || 'play';
    return saveTextFile(buildPlayHtml(input, options), `${base}${options.mode === 'background' ? '-background' : ''}.html`, 'text/html');
  },

  graphFileJson: (asPlay) => {
    const { nodes, looseGroups, play, datasets } = get();
    if (!asPlay) return JSON.stringify({ nodes, looseGroups, ...(isPlayRecordEmpty(play) ? {} : { play }), ...datasetsField(datasets), layout: LAYOUT_VERSION }, null, 2);
    const live = new Map<string, number | number[]>();
    for (const c of play.controls) {
      const v = playEngine.liveValue(c.id);
      if (v !== undefined) live.set(c.id, v);
    }
    return JSON.stringify({ kind: PLAY_FILE_KIND, nodes: bakeControlValues(nodes, play, live), looseGroups, play: bakeLayerValues(play, live), ...datasetsField(datasets), layout: LAYOUT_VERSION }, null, 2);
  },

  exportPlayFile: async () => {
    const json = get().graphFileJson(true);
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    let name = 'play-file';
    if (!isTauri) {
      const typed = await askText('Export play file', { label: 'File name', initial: 'play-file', confirmLabel: 'Export' });
      if (typed === null) return CANCELLED;
      name = typed;
    }
    return saveTextFile(json, name.endsWith('.json') ? name : `${name}.json`);
  },

  autoLayout: (mode = 'flow') => {
    const state = get();
    const { nodes } = state;
    if (nodes.length === 0) return;

    // Layout constants
    const START_X = 40;
    const START_Y = 60;

    /** Run the BFS rank-layout algorithm (shared with the mobile drill-down
     *  browser's home grid, via computeNodeRanks/groupNodesByRank — same
     *  ranks, so a node lands in the same column here as it does in that
     *  grid's row) on any array of nodes and return a position map. */
    function computeLayout(layoutNodes: import('../types/nodeGraph').GraphNode[], looseGroups?: import('../types/nodeGraph').LooseGroup[]): Map<string, { x: number; y: number }> {
      // 360px cards + 80px for wires; a card's height as it rendered (code cards run tall), estimated before it has.
      const heightOf = (n: import('../types/nodeGraph').GraphNode) => getCardSize(n.id)?.h ?? estimateNodeHeight(n);
      if (mode === 'stage') return arrangeByStage(layoutNodes, { looseGroups, startX: START_X, startY: START_Y, colW: 440, gap: 32, heightOf });
      return layoutByRank(layoutNodes, { startX: START_X, startY: START_Y, colW: 440, gap: 32, heightOf });
    }
    const label = mode === 'stage' ? 'Arranged by stage' : 'Tidied the layout';

    const activeGroupId = state.activeGroupId;

    if (activeGroupId) {
      // Subgraph-aware: layout the inner nodes of the active group
      const groupNode = nodes.find(n => n.id === activeGroupId);
      const sg = groupNode?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!sg || sg.nodes.length === 0) return;
      undoManager.push(nodes, { label });
      const newPositions = computeLayout(sg.nodes, sg.looseGroups);
      set(state2 => ({
        nodes: state2.nodes.map(n => {
          if (n.id !== activeGroupId) return n;
          const sg2 = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg2) return n;
          return {
            ...n,
            params: {
              ...n.params,
              subgraph: {
                ...sg2,
                nodes: sg2.nodes.map(sn => ({
                  ...sn,
                  position: newPositions.get(sn.id) ?? sn.position,
                })),
              },
            },
          };
        }),
      }));
    } else {
      // Top-level layout
      undoManager.push(nodes, { label });
      const newPositions = computeLayout(nodes, state.looseGroups);
      set(state2 => ({
        nodes: state2.nodes.map(n => ({
          ...n,
          position: newPositions.get(n.id) ?? n.position,
        })),
      }));
    }
  },

  setNodePositions: (positions) => {
    if (!positions.size) return;
    set(st => ({ nodes: st.nodes.map(n => { const p = positions.get(n.id); return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n; }) }));
  },

  clearToMinimal: () => {
    undoManager.push(get().nodes, { label: 'Cleared the graph' });
    const uv = instantiateNode(idGenerator.next(), 'uv', getNodeDefinition('uv')!, { x: 100, y: 240 });
    const out = instantiateNode(idGenerator.next(), 'output', getNodeDefinition('output')!, { x: 820, y: 240 });
    set({ nodes: [uv, out], looseGroups: [], previewNodeId: null, activeGroupId: null, activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [], nodeProbeValues: null });
    get().compile();
  },

  loadExampleGraph: async (name?: string) => {
    const example = name ?? DEFAULT_EXAMPLE;
    let loadedKey = example;
    // The blank starter is bundled with the app; every other example lives in
    // a lazily loaded chunk (see exampleIndex.ts).
    let graph: ExampleGraph | undefined = example === 'blank' ? BLANK_GRAPH : undefined;
    if (!graph) {
      try {
        const all = await loadExampleGraphs();
        graph = all[example] ?? all[DEFAULT_EXAMPLE];
        if (!all[example]) loadedKey = DEFAULT_EXAMPLE;
      } catch (e) {
        console.error('[loadExampleGraph] could not load the example graphs chunk', e);
        return;
      }
    }
    // Only now — nothing above touched the current graph or its history.
    undoManager.clear(example === 'blank' ? 'Started a new graph' : `Loaded example: ${graph.label}`);
    const { nodes: rawNodes } = graph;

    const nodes = spreadLegacyLayout(upgradeExprNodes(resolveNodeAliases(rawNodes, getNodeDefinition)).map(n => migrateNodeParams(
      n.params ? n : { ...n, params: {} },
      getNodeDefinition,
    )));

    idGenerator.syncFromGraph(nodes);
    // Example graphs don't carry their own loose groups yet — reset rather
    // than leave a previous graph's groups referencing node ids that don't
    // exist in this one.
    const play = graph.play ? migrateLoadedPlay(parsePlayRecord(graph.play), rawNodes) : emptyPlayRecord();
    const datasets = parseDatasetsRecord(graph.datasets);
    set(st => ({ nodes, looseGroups: [], play, datasets, previewNodeId: null, activeGroupId: null, activeGroupPath: [], graphEpoch: st.graphEpoch + 1 }));
    get().compile();
    // An example is not a saved project: saving it asks for a name.
    set({ currentGraph: null, graphDirty: false });
    announcePlay(play, () => set(s => ({ playOpenRequest: s.playOpenRequest + 1 })));
    if (example !== 'blank') announceGraphOpened({ kind: 'example', key: loadedKey });
    if (graph.images) void attachExampleImages(graph.images, get().graphEpoch);
  },

  replaceGraph: (rawNodes) => {
    undoManager.push(get().nodes, { label: 'Replaced the graph' }, get().play);
    const nodes = rawNodes.map(n => migrateNodeParams(n.params ? n : { ...n, params: {} }, getNodeDefinition));
    idGenerator.syncFromGraph(nodes);
    set(st => ({ nodes, looseGroups: [], play: emptyPlayRecord(), datasets: {}, previewNodeId: null, activeGroupId: null, activeGroupPath: [], graphEpoch: st.graphEpoch + 1 }));
    get().compile();
    set({ currentGraph: null, graphDirty: true });
  },

  scratch: null,
  beginScratch: () => {
    const s = get();
    if (s.scratch) return;
    set({ scratch: {
      nodes: s.nodes, looseGroups: s.looseGroups, play: s.play, datasets: s.datasets, currentGraph: s.currentGraph, graphDirty: s.graphDirty,
      previewNodeId: s.previewNodeId, activeGroupId: s.activeGroupId, activeGroupPath: s.activeGroupPath,
      selectedNodeId: s.selectedNodeId, selectedNodeIds: s.selectedNodeIds,
    } });
  },
  setScratchNodes: (rawNodes, controls) => {
    if (!get().scratch) get().beginScratch();
    const nodes = rawNodes.map(n => migrateNodeParams(n.params ? n : { ...n, params: {} }, getNodeDefinition));
    idGenerator.syncFromGraph(nodes);
    set(st => ({ nodes, looseGroups: [], play: { ...emptyPlayRecord(), controls: controls ?? [] }, previewNodeId: null, activeGroupId: null, activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [], nodeProbeValues: null, graphEpoch: st.graphEpoch + 1 }));
    get().compile();
  },
  endScratch: (commit) => {
    const kept = get().scratch;
    if (!kept) return;
    if (commit) {
      undoManager.push(kept.nodes, { label: 'Converted GLSL (Materialize)' });
      set({ scratch: null, currentGraph: null, graphDirty: true });
      return;
    }
    idGenerator.syncFromGraph(kept.nodes);
    set(st => ({
      scratch: null, nodes: kept.nodes, looseGroups: kept.looseGroups, play: kept.play, datasets: kept.datasets, currentGraph: kept.currentGraph, graphDirty: true,
      previewNodeId: kept.previewNodeId, activeGroupId: kept.activeGroupId, activeGroupPath: kept.activeGroupPath,
      selectedNodeId: kept.selectedNodeId, selectedNodeIds: kept.selectedNodeIds, nodeProbeValues: null, graphEpoch: st.graphEpoch + 1,
    }));
    get().compile();
    // Restored last, on its own: the dirty-marking subscriber sees the nodes change first and would set it back.
    set({ graphDirty: kept.graphDirty });
  },

  setPreviewNodeId: (id) => {
    set({ previewNodeId: id });
    get().compile();
  },

  setGlslErrors: (errors, source = null) => set({ glslErrors: errors, glslErrorSource: errors.length ? source : null }),
  setGlContextLost: (lost) => set({ glContextLost: lost }),
  setPreviewStale: (stale) => set(s => (s.previewStale === stale ? s : { previewStale: stale })),
  restartPreview: () => set(s => ({ previewEpoch: s.previewEpoch + 1, glContextLost: false, previewStale: false })),
  // These four are written from ShaderCanvas's frame loop (~10 Hz). Zustand
  // notifies every subscriber on any set(), so each one returns the current
  // state object untouched when the value is unchanged — Object.is() on the
  // state then skips the notification and nothing re-renders while idle.
  setPixelSample: (sample) => set(state => {
    const cur = state.pixelSample;
    if (cur === sample) return state;
    if (cur && sample && cur[0] === sample[0] && cur[1] === sample[1] && cur[2] === sample[2] && cur[3] === sample[3]) return state;
    return { pixelSample: sample };
  }),
  setHoveredParamHint: (hint) => set(state => state.hoveredParamHint === hint ? state : { hoveredParamHint: hint }),
  setCurrentTime: (t) => set(state => state.currentTime === t ? state : { currentTime: t }),
  setTimePlaying: (playing) => set(state => state.timePlaying === playing ? state : { timePlaying: playing }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id, nodeProbeValues: null }),
  revealNode: (groupPath, nodeId) => {
    for (const groupId of groupPath) get().enterGroup(groupId);
    set(s => ({
      selectedNodeId: nodeId, nodeProbeValues: null, selectedNodeIds: [],
      focusRequest: { nodeId, seq: (s.focusRequest?.seq ?? 0) + 1 },
    }));
  },
  focusRequest: null,
  clearFocusRequest: () => set({ focusRequest: null }),
  wireHistory: [],
  pastWiresFor: (nodeId, scope) => {
    const byId = new Map(scope.map(n => [n.id, n]));
    return get().wireHistory.filter(w => {
      if (w.fromNodeId !== nodeId && w.toNodeId !== nodeId) return false;
      const from = byId.get(w.fromNodeId), to = byId.get(w.toNodeId);
      if (!from || !to) return false;
      const cur = to.inputs[w.toInputKey]?.connection;
      return !(cur && cur.nodeId === w.fromNodeId && cur.outputKey === w.fromOutputKey);
    });
  },
  smartConnectRequest: null,
  requestSmartConnect: (nodeId) => set({ smartConnectRequest: nodeId ? { nodeId, at: Date.now() } : null }),
  setNodeProbeValues: (values) => set(state => {
    const cur = state.nodeProbeValues;
    if (cur === values) return state;
    if (cur && values && probeValuesEqual(cur, values)) return state;
    return { nodeProbeValues: values };
  }),
  setScopeProbeValues: (vals) => set({ scopeProbeValues: vals }),

  selectNode: (id, addToSelection = false) => set(state => {
    if (addToSelection) {
      // Toggle: remove if already selected, add if not
      const already = state.selectedNodeIds.includes(id);
      return {
        selectedNodeIds: already
          ? state.selectedNodeIds.filter(x => x !== id)
          : [...state.selectedNodeIds, id],
      };
    }
    // Single-select: replace selection (unless clicking the only selected node — deselect)
    const isSoleSelection = state.selectedNodeIds.length === 1 && state.selectedNodeIds[0] === id;
    return { selectedNodeIds: isSoleSelection ? [] : [id] };
  }),
  selectNodes: (ids) => set({ selectedNodeIds: [...ids] }),
  deselectAll: () => set({ selectedNodeIds: [] }),

  // ─── Save / Load ───────────────────────────────────────────────────────────
  saveGraph: async (name, note, kind) => {
    const { nodes, looseGroups, play, datasets, currentGraph: open } = get();
    // `play` (and `datasets`) are left out when empty so graphs without them look as they always did.
    const playField = { ...(isPlayRecordEmpty(play) ? {} : { play }), ...datasetsField(datasets) };
    const noteField = note?.trim() ? { note: note.trim().slice(0, 300) } : {};
    // Its links to presentations belong to the graph, not to a version: a new version keeps them.
    const linked = linkedPresentationsOf(name);
    const linkField = linked.length ? { [GRAPH_LINK_FIELD]: linked } : {};
    // A series is its name (docs/graph-series-plan.md). The open version is the base when it is from this series.
    const base = open && open.name === name ? { major: open.major, minor: open.minor } : null;
    const how = kind ?? (base ? 'minor' : 'new');
    if (how === 'inPlace' && open && base) {
      // Save in place: the open version keeps its numbers, its graph is replaced.
      const payload = JSON.stringify({ nodes, looseGroups, ...playField, layout: LAYOUT_VERSION, savedAt: Date.now(), version: open.version, ...base, ...noteField, ...linkField });
      try { if (!replaceVersion(name, open.version, payload)) return { ok: false, error: `“${name}” ${base.major}.${base.minor} is no longer there to save over.` }; }
      catch (e) { return { ok: false, error: `Couldn’t save over “${name}”: ${errorMessage(e)}` }; }
      set({ graphDirty: false });
      window.dispatchEvent(new Event(SAVED_GRAPHS_CHANGED));
      return { ok: true };
    }
    const number = nextNumber(name, how === 'inPlace' ? 'minor' : how, base);
    // The version this replaces goes into the series' history first.
    const version = archiveCurrent(name);
    const payload = JSON.stringify({ nodes, looseGroups, ...playField, layout: LAYOUT_VERSION, savedAt: Date.now(), version, ...number, ...noteField, ...linkField });
    // localStorage is the primary store; a quota failure here means nothing
    // was saved, so stop before the (optional) disk mirror.
    const stored = safeSetItem(`shader-studio:${name}`, payload, `graph "${name}"`);
    if (!stored.ok) return stored;
    set({ currentGraph: { name, version, ...number, latest: true }, graphDirty: false });
    learnSaved(name, nodes, payload);
    recordActivity('save', name);
    window.dispatchEvent(new Event(SAVED_GRAPHS_CHANGED));
    const dir = getGraphDir();
    if (dir) {
      const path = `${dir}/${labelToSlug(name || 'graph')}.json`;
      try {
        await writeTextFileAtPath(path, JSON.stringify({ nodes, looseGroups, ...playField, layout: LAYOUT_VERSION }, null, 2));
      } catch (e) {
        console.error('[saveGraph] disk write failed', path, e);
        return { ok: false, error: `Graph "${name}" was saved in the browser, but writing ${path} failed: ${errorMessage(e)}` };
      }
    }
    return { ok: true };
  },

  getSavedGraphNames: () =>
    Object.keys(localStorage)
      .filter(k => {
        if (!k.startsWith('shader-studio:')) return false;
        try { return Array.isArray(JSON.parse(localStorage.getItem(k) ?? '').nodes); }
        catch { return false; }
      })
      .map(k => k.slice('shader-studio:'.length))
      .sort(),

  loadSavedGraph: (name) => get().loadGraphVersion(name, 0),

  loadGraphVersion: (name, wanted) => {
    // 0 = the newest version.
    const latest = localStorage.getItem(`shader-studio:${name}`);
    const raw = wanted ? readVersion(name, wanted) : latest;
    if (!raw) {
      const error = wanted ? `"${name}" has no version ${wanted}` : `No saved graph named "${name}"`;
      console.error('[loadSavedGraph]', error);
      return { ok: false, error };
    }
    // Same shape as importGraph: parse + migrate first, and only touch the
    // undo history / live graph once the saved data is known to be usable.
    let nodes: GraphNode[];
    let looseGroups: unknown;
    let play: PlayRecord;
    let datasets: DatasetsRecord;
    try {
      const parsed = JSON.parse(raw) as { nodes?: unknown; looseGroups?: unknown; play?: unknown; datasets?: unknown; layout?: unknown };
      if (!Array.isArray(parsed?.nodes)) throw new Error('missing "nodes" array');
      looseGroups = parsed.looseGroups;
      play = parsePlayRecord(parsed.play);
      datasets = parseDatasetsRecord(parsed.datasets);
      // Strip in-memory audio state — audio buffers are not persisted, so
      // _isPlaying / _hasFile would crash the audio engine on load.
      const sanitized = (parsed.nodes as GraphNode[]).map(n => {
        if (n.type === 'audioInput') {
          return { ...n, params: { ...n.params, _isPlaying: false, _hasFile: false, _fileName: '' } };
        }
        return n;
      });
      play = migrateLoadedPlay(play, sanitized);
      nodes = upgradeExprNodes(resolveNodeAliases(sanitized, getNodeDefinition)).map(n => migrateNodeParams(n, getNodeDefinition));
      if (needsLayoutSpread(parsed)) nodes = spreadLegacyLayout(nodes);
    } catch (e) {
      console.error('[loadSavedGraph] saved graph is corrupt', name, e);
      return { ok: false, error: `Saved graph "${name}" is corrupt and could not be loaded: ${errorMessage(e)}` };
    }
    undoManager.clear(`Opened “${name}”${wanted ? ` (version ${wanted})` : ''}`);
    idGenerator.syncFromGraph(nodes);
    // Reset group navigation so a saved graph that was captured inside a
    // subgraph doesn't leave the editor stranded in a non-existent group.
    const meta = versionMeta(raw) ?? { version: 1, major: 1, minor: 0 };
    const version = meta.version;
    let latestVersion = version;
    try { const v = latest ? (JSON.parse(latest) as { version?: unknown }).version : undefined; if (typeof v === 'number') latestVersion = v; } catch { /* newest is unreadable: treat this as it */ }
    set(st => ({ nodes, looseGroups: Array.isArray(looseGroups) ? looseGroups as import('../types/nodeGraph').LooseGroup[] : [], play, datasets, previewNodeId: null, activeGroupId: null, activeGroupPath: [], graphEpoch: st.graphEpoch + 1 }));
    get().compile();
    set({ currentGraph: { name, version, major: meta.major, minor: meta.minor, latest: version === latestVersion }, graphDirty: false });
    announcePlay(play, () => set(s => ({ playOpenRequest: s.playOpenRequest + 1 })));
    announceGraphOpened({ kind: 'saved', name });
    return { ok: true };
  },

  deleteSavedGraph: (name) => {
    // Its presentations stay; they just stop pointing at it.
    graphDeleted(name);
    localStorage.removeItem(`shader-studio:${name}`);
    deleteHistory(name);
    if (get().currentGraph?.name === name) set({ currentGraph: null });
    window.dispatchEvent(new Event(SAVED_GRAPHS_CHANGED));
  },

  exportGraph: async () => {
    const json = get().graphFileJson(false);
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    let name = 'shader-graph';
    if (!isTauri) {
      // In-app dialog (window.prompt is unreliable in the desktop webview); null = cancelled
      const typed = await askText('Export graph', { label: 'File name', initial: 'shader-graph', confirmLabel: 'Export' });
      if (typed === null) return CANCELLED;
      name = typed;
    }
    // saveTextFile never throws: Tauri dialog/write failures come back as a result.
    return saveTextFile(json, name.endsWith('.json') ? name : `${name}.json`);
  },

  importGraph: (json: string, opts) => {
    // Parse and migrate before touching any state: a malformed file must
    // leave the current graph and its undo history exactly as they were.
    let nodes: GraphNode[];
    let looseGroups: unknown;
    let play: PlayRecord;
    let datasets: DatasetsRecord;
    let isPlayFile = false;
    try {
      const parsed = JSON.parse(json) as { kind?: unknown; nodes?: unknown; looseGroups?: unknown; play?: unknown; datasets?: unknown; layout?: unknown } | null;
      if (!parsed || typeof parsed !== 'object') throw new Error('file does not contain a JSON object');
      if (!Array.isArray(parsed.nodes)) throw new Error('missing "nodes" array — is this a Playfield graph file?');
      looseGroups = parsed.looseGroups;
      play = parsePlayRecord(parsed.play);
      datasets = parseDatasetsRecord(parsed.datasets);
      isPlayFile = parsed.kind === PLAY_FILE_KIND;
      play = migrateLoadedPlay(play, parsed.nodes as GraphNode[]);
      nodes = upgradeExprNodes(resolveNodeAliases(parsed.nodes as GraphNode[], getNodeDefinition)).map(n => migrateNodeParams(n, getNodeDefinition));
      if (needsLayoutSpread(parsed)) nodes = spreadLegacyLayout(nodes);
    } catch (e) {
      console.error('[importGraph] invalid graph file', e);
      return { ok: false, error: `Could not import graph: ${errorMessage(e)}` };
    }
    undoManager.clear(opts?.recovered ? 'Recovered after a crash' : isPlayFile ? 'Imported a Play file' : 'Imported a graph file');
    idGenerator.syncFromGraph(nodes);
    set(state => ({
      nodes, looseGroups: Array.isArray(looseGroups) ? looseGroups as import('../types/nodeGraph').LooseGroup[] : [], play, datasets,
      previewNodeId: null, activeGroupId: null, activeGroupPath: [], graphEpoch: state.graphEpoch + 1,
      ...(isPlayFile ? { playOpenRequest: state.playOpenRequest + 1 } : {}),
    }));
    get().compile();
    set({ currentGraph: null, graphDirty: false });
    // A play file already opens on Play; a plain graph that happens to carry a setup just says so.
    if (!isPlayFile) announcePlay(play, () => set(s => ({ playOpenRequest: s.playOpenRequest + 1 })));
    if (!opts?.recovered) {
      recordActivity('import', 'Graph file');
      // An imported graph teaches the suggestions at half the weight of one you saved.
      const sig = textSignature(json);
      learnGraph(`import:${sig}`, 'imported', nodes, sig);
    }
    return { ok: true };
  },

  importGlslFromFile: async () => {
    let code: string | null;
    let fileName = 'Imported shader';
    try {
      code = await openTextFile('.glsl,.frag,.fs,.fsh,.shader,.txt');
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
    if (code === null) return CANCELLED;
    const titled = /^\s*\/\/\s*(.+)$/m.exec(code);
    if (titled && titled[1].length < 48) fileName = titled[1].trim();
    const converted = convertFragmentShader(code, { label: fileName });
    if (!converted.ok) return { ok: false, error: converted.error };
    const spec: PublishUserNodeSpec = {
      label: fileName, category: USER_NODE_DEFAULT_CATEGORY,
      description: `Imported from a fragment shader. ${converted.notes.join(' ')}`.trim(),
      inputs: [{ portKey: 'uv', key: 'uv', label: 'UV', type: 'vec2' }],
      outputs: [{ portKey: CODE_RETURN_PORT, key: 'color', label: 'Color', type: 'vec3' }, { portKey: 'alpha', key: 'alpha', label: 'Alpha', type: 'float' }],
      params: [], textures: [],
    };
    const built = buildUserNodeDefinition({ kind: 'code', code: converted.code, entry: converted.entry, label: fileName }, spec);
    if (!built.ok) return { ok: false, error: built.error };
    const reg = await registerUserNode(built.def);
    if (!reg.ok) return reg;
    // UV → shader → Output
    undoManager.push(get().nodes, { label: `Imported shader: ${fileName}` });
    const uvDef = getNodeDefinition('uv')!, outDef = getNodeDefinition('output')!, def = getNodeDefinition(built.def.id)!;
    const uv = instantiateNode(idGenerator.next(), 'uv', uvDef, { x: 80, y: 220 });
    const shader = instantiateNode(idGenerator.next(), built.def.id, def, { x: 520, y: 200 });
    const out = instantiateNode(idGenerator.next(), 'output', outDef, { x: 980, y: 220 });
    shader.inputs.uv = { ...shader.inputs.uv, connection: { nodeId: uv.id, outputKey: 'uv' } };
    out.inputs.color = { ...out.inputs.color, connection: { nodeId: shader.id, outputKey: 'color' } };
    set(st => ({ nodes: [uv, shader, out], activeGroupPath: [], activeGroupId: null, selectedNodeId: shader.id, selectedNodeIds: [shader.id], graphEpoch: st.graphEpoch + 1 }));
    get().compile();
    recordActivity('import', fileName);
    return { ok: true, notes: converted.notes, label: fileName };
  },

  importGraphFromFile: async () => {
    let json: string | null;
    try {
      json = await openTextFile('.json');
    } catch (e) {
      // openTextFile already logged the underlying dialog/read error.
      return { ok: false, error: errorMessage(e) };
    }
    if (json === null) return CANCELLED;
    return get().importGraph(json);
  },

  // ─── Custom-fn presets ──────────────────────────────────────────────────────

  saveCustomFn: async (nodeId) => {
    // Search top-level nodes first
    let node = get().nodes.find(n => n.id === nodeId);
    // If not found at top level, search inside group subgraphs
    if (!node) {
      outer: for (const n of get().nodes) {
        const sg = (n.params.subgraph as { nodes?: GraphNode[] } | undefined);
        if (sg?.nodes) {
          for (const sn of sg.nodes) {
            if (sn.id === nodeId) { node = sn; break outer; }
          }
        }
      }
    }
    if (!node || node.type !== 'customFn') return { ok: false, error: 'Node is not a Custom Function node' };
    const preset: CustomFnPreset = {
      id: newCfpId(),
      label: (node.params.label as string) || 'Custom Function',
      inputs: (node.params.inputs as CustomFnPreset['inputs']) ?? [],
      outputType: (node.params.outputType as CustomFnPreset['outputType']) ?? 'float',
      body: (node.params.body as string) ?? '0.0',
      glslFunctions: (node.params.glslFunctions as string) ?? '',
      comment: typeof node.params.__comment === 'string' && node.params.__comment.trim() ? node.params.__comment.trim() : undefined,
      savedAt: Date.now(),
    };
    // Always save to localStorage (belt-and-suspenders), and to disk if configured
    return customFnPresetManager.save(preset).then(r => { if (r.ok) recordActivity('save', preset.label); return r; });
  },

  deleteCustomFn: (id) => {
    customFnPresetManager.delete(id);
    // Remove from disk if folder is set — find by matching id in filename
    const dir = getCustomFnDir();
    if (dir) {
      readJsonFilesFromDir(dir).then(files => {
        const match = files.find(f => f.name.endsWith(`_${id}.json`));
        if (match) deleteFileAtPath(`${dir}/${match.name}`);
      });
    }
  },

  exportCustomFns: async () => {
    const presets = loadCustomFns();
    const payload: CustomFnPresetExport = { version: 1, presets };
    await saveTextFile(JSON.stringify(payload, null, 2), 'custom-fns.json');
  },

  importCustomFns: (json) => {
    try {
      const payload = JSON.parse(json) as CustomFnPresetExport;
      if (payload.version !== 1 || !Array.isArray(payload.presets)) return;
      const existing = new Set(loadCustomFns().map(p => p.id));
      const dir = getCustomFnDir();
      for (const preset of payload.presets) {
        if (!preset.id || existing.has(preset.id)) continue;
        localStorage.setItem(`${CFP_PREFIX}${preset.id}`, JSON.stringify(preset));
        // Also write to disk folder if set
        if (dir) {
          const slug = labelToSlug(preset.label);
          writeTextFileAtPath(`${dir}/${slug}_${preset.id}.json`, JSON.stringify(preset, null, 2));
        }
      }
      window.dispatchEvent(new CustomEvent('customfn-changed'));
    } catch {}
  },

  importCustomFnsFromFile: async () => {
    let json: string | null;
    try {
      json = await openTextFile('.json');
    } catch (e) {
      console.error('[importCustomFnsFromFile] open failed', e);
      return;
    }
    if (json) get().importCustomFns(json);
  },

  setCustomFnPresetsDir: (path) => {
    setCustomFnDir(path);
    // Immediately sync localStorage from disk so palette refreshes
    get().loadCustomFnsFromDisk().then(diskPresets => {
      const existing = new Set(loadCustomFns().map(p => p.id));
      for (const p of diskPresets) {
        if (!existing.has(p.id)) {
          localStorage.setItem(`${CFP_PREFIX}${p.id}`, JSON.stringify(p));
        }
      }
    });
  },

  loadCustomFnsFromDisk: async () => {
    const dir = getCustomFnDir();
    if (!dir) return [];
    const files = await readJsonFilesFromDir(dir);
    const out: CustomFnPreset[] = [];
    for (const { content } of files) {
      try {
        const p = JSON.parse(content) as CustomFnPreset;
        if (p?.id) out.push(p);
      } catch {}
    }
    return out.sort((a, b) => a.savedAt - b.savedAt);
  },
}));

// Any change to the graph or its Play setup after it was opened or saved marks it unsaved.
useNodeGraphStore.subscribe((s, prev) => {
  if (!s.currentGraph || s.graphDirty || s.currentGraph !== prev.currentGraph) return;
  if (s.nodes !== prev.nodes || s.looseGroups !== prev.looseGroups || s.play !== prev.play || s.datasets !== prev.datasets) useNodeGraphStore.setState({ graphDirty: true });
});

// The runtime dataset store (src/data/datasetStore.ts) follows the saved datasets: readers subscribe there.
useNodeGraphStore.subscribe((s, prev) => { if (s.datasets !== prev.datasets) datasetStore.sync(s.datasets); });
