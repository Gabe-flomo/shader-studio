import { create } from 'zustand';
import type { GraphNode, InputSocket, DataType } from '../types/nodeGraph';
import { migrateNodeParams, GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { LAYOUT_VERSION, needsLayoutSpread, spreadLegacyLayout } from './legacyLayout';
import { relabelLegacySockets } from './legacyLabels';
import type { CustomFnPreset, CustomFnPresetExport } from '../types/customFnPreset';
import type { ExprPreset } from '../types/exprPreset';
import type { TransformPreset } from '../types/transformPreset';
import type { GroupPreset } from '../types/groupPreset';
import type { SubgraphData } from '../types/nodeGraph';
import { buildUserNodeDefinition, type PublishUserNodeSpec } from '../nodes/userNodes/publishUserNode';
import { registerUserNode, unregisterUserNode, getUserNode } from '../nodes/userNodes/userNodeRegistry';
import type { KeyframePreset } from '../types/keyframePreset';
import { getNodeDefinition } from '../nodes/definitions';
import { compileGraph } from '../compiler/graphCompiler';
import { paramBindingKey } from '../compiler/uniformPatcher';
import { saveTextFile, openTextFile, readJsonFilesFromDir, writeTextFileAtPath, deleteFileAtPath, safeSetItem, errorMessage, CANCELLED } from '../utils/fileIO';
import type { FileResult } from '../utils/fileIO';
import { BLANK_GRAPH, DEFAULT_EXAMPLE, loadExampleGraphs } from './exampleIndex';
import type { ExampleGraph } from './exampleIndex';
import { groupNodesByRank } from './graphLayout';
import { typesCompatible } from '../lib/typesCompatible';
import { audioEngine } from '../lib/audioEngine';
import { videoEngine } from '../lib/videoEngine';
import { IdGenerator } from './managers/IdGenerator';
import { UndoManager } from './managers/UndoManager';
import { PresetManager } from './managers/PresetManager';
import { CompilationService } from './managers/CompilationService';

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
    let n = relabelLegacySockets(_upgradeExprNode(node));
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
export function saveCustomFnPreset(
  data: { label: string; inputs: CustomFnPreset['inputs']; outputType: CustomFnPreset['outputType']; body: string; glslFunctions: string },
): Promise<FileResult> {
  const preset: CustomFnPreset = {
    id: `cfp_${Date.now()}`,
    label: data.label || 'Custom Function',
    inputs: data.inputs ?? [],
    outputType: data.outputType ?? 'float',
    body: data.body ?? '0.0',
    glslFunctions: data.glslFunctions ?? '',
    savedAt: Date.now(),
  };
  return customFnPresetManager.save(preset);
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

function loadGroupPresets(): GroupPreset[] {
  return groupPresetManager.load()
    .filter(p => !!p.subgraph)
    .sort((a, b) => b.savedAt - a.savedAt);
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
const undoManager = new UndoManager();

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

interface NodeGraphState {
  // Graph data
  nodes: GraphNode[];
  /** Purely-visual node clusters at the top-level scope — see LooseGroup in types/nodeGraph.ts. */
  looseGroups: import('../types/nodeGraph').LooseGroup[];

  // Compiled shaders
  vertexShader: string;
  fragmentShader: string;
  compilationErrors: string[];
  /** GPU particle systems compiled from pInit→…→pRender chains — consumed by ShaderCanvas. */
  particleSystems: import('../compiler/types').ParticleSystemData[];
  /**
   * Uniform name → current value for all float params extracted by the compiler.
   * Updated in-place (without recompile) when sliders change eligible float params.
   */
  paramUniforms: Record<string, number>;
  /** `${nodeId}::${paramKey}` → uniform name, from the last compile. See CompilationResult.paramBindings. */
  paramBindings: Record<string, string>;
  /** Push param uniform value changes to ShaderCanvas without triggering a recompile. */
  updateParamUniforms: (updates: Record<string, number>) => void;

  // Runtime debug info (set by ShaderCanvas)
  glslErrors: string[];           // WebGL shader compile errors (from Three.js)
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
  setSelectedNodeId: (id: string | null) => void;
  setNodeProbeValues: (values: Record<string, number[]> | null) => void;
  /** Live-sampled normalized [0,1] values for all scope nodes: nodeId → number */
  scopeProbeValues: Record<string, number>;
  setScopeProbeValues: (vals: Record<string, number>) => void;

  // Preview mode — isolates a single node's output for focused editing
  previewNodeId: string | null;

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

  // Swap mode — user shift-clicked a node; next palette click replaces it
  swapTargetNodeId: string | null;
  setSwapTargetNodeId: (id: string | null) => void;
  swapNode: (nodeId: string, newType: string) => void;

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

  // Texture inputs — maps nodeId → loaded THREE.Texture (or null if not yet loaded)
  // Populated by NodeComponent file picker; consumed by ShaderCanvas to bind sampler2D uniforms.
  nodeTextures: Record<string, import('three').Texture | null>;
  setNodeTexture: (nodeId: string, texture: import('three').Texture | null) => void;
  // textureUniforms from last compilation: uniformName → nodeId
  textureUniforms: Record<string, string>;
  // audioUniforms from last compilation: uniformName → nodeId
  audioUniforms: Record<string, string>;
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

  /** Maps nodeId → GLSL slug, e.g. "node_49" → "cos_49". Used for code-panel highlighting. */
  nodeSlugMap: Map<string, string>;

  // Raw GLSL editor override — when set, ShaderCanvas uses this shader instead of the compiled graph
  rawGlslShader: string | null;
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

  // Rebuild a node's input sockets from a custom-fn inputs definition array
  updateNodeSockets: (
    nodeId: string,
    inputs: Array<{ name: string; type: DataType; slider?: { min: number; max: number } | null }>,
    outputType: DataType
  ) => void;

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
  compile: () => void;
  loadExampleGraph: (name?: string) => Promise<void>;
  autoLayout: () => void;
  setGlslErrors: (errors: string[]) => void;
  setGlContextLost: (lost: boolean) => void;
  setPixelSample: (sample: [number, number, number, number] | null) => void;
  setHoveredParamHint: (hint: string | null) => void;
  setCurrentTime: (t: number) => void;
  setTimePlaying: (playing: boolean) => void;
  toggleBypass: (nodeId: string) => void;

  // Save / Load
  saveGraph: (name: string) => Promise<FileResult>;
  getSavedGraphNames: () => string[];
  loadSavedGraph: (name: string) => FileResult;
  deleteSavedGraph: (name: string) => void;
  exportGraph: () => Promise<FileResult>;
  importGraph: (json: string) => FileResult;
  importGraphFromFile: () => Promise<FileResult>;

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
  placeSubgraphAsGroup: (label: string, subgraph: SubgraphData, position?: { x: number; y: number }) => string | null;

  // User-published node types (see nodes/userNodes)
  /** Flatten the group node into a GLSL function and register it as a node type. */
  publishUserNode: (groupNodeId: string, spec: PublishUserNodeSpec) => Promise<FileResult>;
  deleteUserNode: (id: string) => void;
  /** Re-open a published node's source subgraph as an editable group. */
  openUserNodeSource: (id: string, position?: { x: number; y: number }) => string | null;
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

  const innerNode = subgraph.nodes.find(n => n.id === innerNodeId);
  if (!innerNode) return nodes;

  // Pick the best output to preview — prefer vec3, then vec4, then vec2, then float, then any
  const outputEntries = Object.entries(innerNode.outputs);
  const vec3Entry  = outputEntries.find(([, s]) => s.type === 'vec3');
  const vec4Entry  = outputEntries.find(([, s]) => s.type === 'vec4');
  const vec2Entry  = outputEntries.find(([, s]) => s.type === 'vec2');
  const floatEntry = outputEntries.find(([, s]) => s.type === 'float');
  const chosen = vec3Entry ?? vec4Entry ?? vec2Entry ?? floatEntry ?? outputEntries[0];
  if (!chosen) return nodes;

  const [chosenKey, chosenSocket] = chosen;
  const outType = (chosenSocket as { type: string }).type as import('../types/nodeGraph').DataType;
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
function buildPreviewGraph(nodes: GraphNode[], targetId: string): GraphNode[] {
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

  // Pick the best output to preview — prefer vec3, then vec4, then vec2, then float, then any
  const outputEntries = Object.entries(targetNode.outputs);
  const vec3Entry  = outputEntries.find(([, s]) => s.type === 'vec3');
  const vec4Entry  = outputEntries.find(([, s]) => s.type === 'vec4');
  const vec2Entry  = outputEntries.find(([, s]) => s.type === 'vec2');
  const floatEntry = outputEntries.find(([, s]) => s.type === 'float');
  const chosen = vec3Entry ?? vec4Entry ?? vec2Entry ?? floatEntry ?? outputEntries[0];
  if (!chosen) return nodes; // no outputs to preview

  const [chosenKey, chosenSocket] = chosen;
  const outType = (chosenSocket as { type: string }).type;

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
    const extX: GraphNode = {
      id: '__preview_extX__',
      type: 'extractX',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { v: { type: 'vec2', label: 'Vec2', connection: { nodeId: targetId, outputKey: chosenKey } } },
      outputs: { x: { type: 'float', label: 'X' } },
    };
    const extY: GraphNode = {
      id: '__preview_extY__',
      type: 'extractY',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { v: { type: 'vec2', label: 'Vec2', connection: { nodeId: targetId, outputKey: chosenKey } } },
      outputs: { y: { type: 'float', label: 'Y' } },
    };
    const mkVec3: GraphNode = {
      id: '__preview_mkVec3__',
      type: 'makeVec3',
      position: { x: 0, y: 0 },
      params: {},
      inputs: {
        r: { type: 'float', label: 'R', connection: { nodeId: '__preview_extX__', outputKey: 'x' } },
        g: { type: 'float', label: 'G', connection: { nodeId: '__preview_extY__', outputKey: 'y' } },
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
    return [...subgraph, extX, extY, mkVec3, syntheticOutput];
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

function estimateNodeHeight(node: GraphNode): number {
  const def = getNodeDefinition(node.type);
  const inputCount  = Object.keys(node.inputs).length;
  const outputCount = Object.keys(node.outputs).length;
  // Count only visible param defs (float or select — things that render sliders/dropdowns)
  const paramCount = def ? Object.values(def.paramDefs ?? {}).filter(
    pd => pd.type === 'float' || pd.type === 'select' || pd.type === 'vec3'
  ).length : 0;
  // Header 43px, socket rows 26px, param rows 36px, body padding 12px, footer 37px
  return 43 + (inputCount + outputCount) * 26 + paramCount * 36 + 12 + 37;
}

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
      const srcDef = srcNode ? getNodeDefinition(srcNode.type) : undefined;
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
      const tgtDef = getNodeDefinition(n.type);
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
function setActiveNodes(nodes: GraphNode[], path: string[], newSub: GraphNode[]): GraphNode[] | null {
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
      const innDef = getNodeDefinition(inn.type);
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

export const useNodeGraphStore = create<NodeGraphState>((set, get) => ({
  nodes: [],
  looseGroups: [],
  vertexShader: '',
  fragmentShader: '',
  compilationErrors: [],
  particleSystems: [],
  paramUniforms: {},
  paramBindings: {},
  glslErrors: [],
  glContextLost: false,
  pixelSample: null,
  hoveredParamHint: null,
  currentTime: 0,
  timePlaying: true,
  selectedNodeId: null,
  selectedNodeIds: [],
  nodeOutputVarMap: new Map(),
  nodeProbeValues: null,
  scopeProbeValues: {},
  previewNodeId: null,
  mobileKeyframeEditor: null,
  mobileKeyframeTool: 'select',
  mobileNodeOverlayOpen: false,
  nodeHighlightFilter: null,
  _fitViewCallback: null,
  _viewportCenterGetter: null,
  swapTargetNodeId: null,
  searchPaletteOpen: false,
  activeGroupId: null,
  activeGroupPath: [],
  nodeTextures: {},
  textureUniforms: {},
  audioUniforms: {},
  videoTextures: {},
  videoUniforms: {},
  audioMasterVolume: 0.7,
  nodePreviews: {},
  isStateful: false,
  nodeSlugMap: new Map(),
  rawGlslShader: null,
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
        if (groupNode?.type === 'sceneGroup') {
          // SceneGroup added from palette — initialise with ScenePos + SceneOutput nodes.
          const ts2 = Date.now();
          const scenePosNode: import('../types/nodeGraph').GraphNode = {
            id: `scenepos_${ts2}`,
            type: 'scenePos',
            position: { x: 80, y: 200 },
            inputs: {},
            outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
            params: { _groupOriginal: true },
          };
          const sceneOutputNode2: import('../types/nodeGraph').GraphNode = {
            id: `sceneout_${ts2}`,
            type: 'sceneOutput',
            position: { x: 480, y: 200 },
            inputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
            outputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
            params: { _groupOriginal: true },
          };
          const emptySceneSubgraph = { nodes: [scenePosNode, sceneOutputNode2], outputNodeId: '', outputKey: '' };
          return {
            activeGroupId: id,
            activeGroupPath: [id],
            nodes: state.nodes.map(n =>
              n.id === id ? { ...n, params: { ...n.params, subgraph: emptySceneSubgraph } } : n
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
        if (groupNode?.type === 'giLitMarchGroup') {
          // GILitMarchGroup — initialise with new-style marchLoopInputs + marchLoopOutput.
          const tsGi = Date.now();
          const giInputsNode: import('../types/nodeGraph').GraphNode = {
            id: `mlInputs_${tsGi}`,
            type: 'marchLoopInputs',
            position: { x: 80, y: 180 },
            inputs: {},
            outputs: {
              ro:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Origin' },
              rd:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Dir' },
              marchPos:  { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'March Pos' },
              marchDist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'March Dist' },
            },
            params: { _groupOriginal: true, extraInputs: [] },
          };
          const giOutputNode: import('../types/nodeGraph').GraphNode = {
            id: `mlOutput_${tsGi}`,
            type: 'marchLoopOutput',
            position: { x: 480, y: 180 },
            inputs: {
              pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position',
                connection: { nodeId: `mlInputs_${tsGi}`, outputKey: 'marchPos' } },
            },
            outputs: {},
            params: { _groupOriginal: true, hiddenOutputs: [] },
          };
          const giEmptySubgraph: import('../types/nodeGraph').SubgraphData = {
            nodes: [giInputsNode, giOutputNode],
            inputPorts: [],
            outputPorts: [],
          };
          return {
            activeGroupId: id,
            activeGroupPath: [id],
            nodes: state.nodes.map(n =>
              n.id === id ? { ...n, params: { ...n.params, subgraph: giEmptySubgraph } } : n
            ),
          };
        }
        if (groupNode?.type === 'marchLoopGroup') {
          // MarchLoopGroup — initialise with MarchPos + MarchDist + MarchOutput (pure warp chain).
          const ts3 = Date.now();
          const marchPosNode: import('../types/nodeGraph').GraphNode = {
            id: `marchpos_${ts3}`,
            type: 'marchPos',
            position: { x: 80, y: 120 },
            inputs: {},
            outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
            params: { _groupOriginal: true },
          };
          const marchDistNode3: import('../types/nodeGraph').GraphNode = {
            id: `marchdist_${ts3}`,
            type: 'marchDist',
            position: { x: 80, y: 220 },
            inputs: {},
            outputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Dist' }, t: { type: 'float' as import('../types/nodeGraph').DataType, label: 't' } },
            params: { _groupOriginal: true },
          };
          const marchOutputNode3: import('../types/nodeGraph').GraphNode = {
            id: `marchout_${ts3}`,
            type: 'marchOutput',
            position: { x: 380, y: 160 },
            inputs: {
              pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position',
                connection: { nodeId: `marchpos_${ts3}`, outputKey: 'pos' } },
            },
            outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
            params: { _groupOriginal: true },
          };
          const emptySubgraph: import('../types/nodeGraph').SubgraphData = {
            nodes: [marchPosNode, marchDistNode3, marchOutputNode3],
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
              position: { x: minX - 200, y: avgY },
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
              position: { x: maxX + 200, y: avgY },
              inputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
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
          const snDef = getNodeDefinition(sn.type);
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
    if (groupNode?.type === 'sceneGroup' && !groupNode.params?.subgraph) {
      const ts = Date.now();
      const scenePosNode: import('../types/nodeGraph').GraphNode = {
        id: `scenepos_${ts}`,
        type: 'scenePos',
        position: { x: 80, y: 200 },
        inputs: {},
        outputs: { pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position' } },
        params: { _groupOriginal: true },
      };
      const sceneOutputNode: import('../types/nodeGraph').GraphNode = {
        id: `sceneout_${ts}`,
        type: 'sceneOutput',
        position: { x: 480, y: 200 },
        inputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
        outputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
        params: { _groupOriginal: true },
      };
      const emptySceneSubgraph = { nodes: [scenePosNode, sceneOutputNode], outputNodeId: '', outputKey: '' };
      set(state => ({
        activeGroupPath: newPath,
        activeGroupId: id,
        nodes: updateNodeInTree(state.nodes, id, newPath, n => ({ ...n, params: { ...n.params, subgraph: emptySceneSubgraph } })),
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
    if (groupNode?.type === 'marchLoopGroup' && !groupNode.params?.subgraph) {
      const ts = Date.now();
      const marchLoopInputsNode: import('../types/nodeGraph').GraphNode = {
        id: `mlInputs_${ts}`,
        type: 'marchLoopInputs',
        position: { x: 80, y: 180 },
        inputs: {},
        outputs: {
          ro:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Origin' },
          rd:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Dir' },
          marchPos:  { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'March Pos' },
          marchDist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'March Dist' },
        },
        params: { _groupOriginal: true, extraInputs: [] },
      };
      const marchLoopOutputNode: import('../types/nodeGraph').GraphNode = {
        id: `mlOutput_${ts}`,
        type: 'marchLoopOutput',
        position: { x: 480, y: 180 },
        inputs: {
          pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position',
            connection: { nodeId: `mlInputs_${ts}`, outputKey: 'marchPos' } },
        },
        outputs: {},
        params: { _groupOriginal: true, hiddenOutputs: [] },
      };
      const defaultSubgraph: import('../types/nodeGraph').SubgraphData = {
        nodes: [marchLoopInputsNode, marchLoopOutputNode],
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
    if (groupNode?.type === 'giLitMarchGroup' && !groupNode.params?.subgraph) {
      const ts = Date.now();
      const giMlInputsNode: import('../types/nodeGraph').GraphNode = {
        id: `mlInputs_${ts}`,
        type: 'marchLoopInputs',
        position: { x: 80, y: 180 },
        inputs: {},
        outputs: {
          ro:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Origin' },
          rd:        { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Ray Dir' },
          marchPos:  { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'March Pos' },
          marchDist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'March Dist' },
        },
        params: { _groupOriginal: true, extraInputs: [] },
      };
      const giMlOutputNode: import('../types/nodeGraph').GraphNode = {
        id: `mlOutput_${ts}`,
        type: 'marchLoopOutput',
        position: { x: 480, y: 180 },
        inputs: {
          pos: { type: 'vec3' as import('../types/nodeGraph').DataType, label: 'Position',
            connection: { nodeId: `mlInputs_${ts}`, outputKey: 'marchPos' } },
        },
        outputs: {},
        params: { _groupOriginal: true, hiddenOutputs: [] },
      };
      const giDefaultSubgraph: import('../types/nodeGraph').SubgraphData = {
        nodes: [giMlInputsNode, giMlOutputNode],
        inputPorts: [],
        outputPorts: [],
      };
      set(state => ({
        activeGroupPath: newPath,
        activeGroupId: id,
        nodes: updateNodeInTree(state.nodes, id, newPath, n => ({ ...n, params: { ...n.params, subgraph: giDefaultSubgraph } })),
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
            position: { x: minX - 200, y: avgY },
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
            position: { x: maxX + 200, y: avgY },
            inputs: { dist: { type: 'float' as import('../types/nodeGraph').DataType, label: 'Distance' } },
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
            const snDef = getNodeDefinition(sn.type);

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
    undoManager.push(nodes);
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
    undoManager.push(nodes);
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
    undoManager.push(nodes);
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
      set(state => ({ nodes: [...state.nodes, ...newNodes] }));
    }
    get().compile();
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

    undoManager.push(nodes);

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
      const snDef = getNodeDefinition(sn.type);
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
          const srcDef = srcNode ? getNodeDefinition(srcNode.type) : undefined;
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
        const snDef = getNodeDefinition(sn.type);
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
      const innDef = getNodeDefinition(innNode.type);
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

    undoManager.push(nodes);

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

    undoManager.push(nodes);
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
    undoManager.push(nodes);
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
      description: description || undefined,
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
    return get().placeSubgraphAsGroup(preset.label, preset.subgraph, position);
  },

  placeSubgraphAsGroup: (label, subgraph, position) => {
    const { nodes } = get();
    const preset = { label, subgraph };
    undoManager.push(nodes);

    // Re-ID all subgraph nodes to avoid collisions
    const idMap = new Map<string, string>();
    const newSubNodes = preset.subgraph.nodes.map(n => {
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
      params: { label: preset.label, subgraph: newSubgraph },
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

  publishUserNode: async (groupNodeId, spec) => {
    const { nodes, activeGroupPath } = get();
    const scope = activeGroupPath.length > 0 ? (getActiveNodes(nodes, activeGroupPath) ?? nodes) : nodes;
    const groupNode = scope.find(n => n.id === groupNodeId && n.type === 'group');
    if (!groupNode) return { ok: false, error: 'Group node not found' };
    const built = buildUserNodeDefinition(groupNode, spec);
    if (!built.ok) return { ok: false, error: built.error };
    const result = await registerUserNode(built.def);
    // Instances of a re-published node pick up the new function on the next compile.
    get().compile();
    return result;
  },

  deleteUserNode: (id) => {
    unregisterUserNode(id);
    get().compile();
  },

  openUserNodeSource: (id, position) => {
    const def = getUserNode(id);
    if (!def?.source) return null;
    const groupId = get().placeSubgraphAsGroup(def.label, def.source.subgraph, position);
    // Remember where the group came from so "Publish" offers to update the
    // existing node type instead of creating a second one.
    if (groupId) get().updateNodeParams(groupId, { __userNodeId: id, iterations: def.source.iterations }, { immediate: true });
    return groupId;
  },

  swapNode: (nodeId, newType) => {
    const { nodes, activeGroupPath } = get();

    // Resolve the node list to operate on — subgraph when inside a group, top-level otherwise
    const workingNodes = activeGroupPath.length > 0
      ? (getActiveNodes(nodes, activeGroupPath) ?? nodes)
      : nodes;

    const oldNode = workingNodes.find(n => n.id === nodeId);
    if (!oldNode) return;
    const def = getNodeDefinition(newType);
    if (!def) return;

    undoManager.push(nodes);
    const newId = idGenerator.next();

    // Build new inputs, carrying over connections where types are compatible
    const newInputs: Record<string, InputSocket> = {};
    for (const [key, socket] of Object.entries(def.inputs)) {
      const newSocket: InputSocket = {
        ...socket,
        defaultValue: def.paramDefs?.[key]
          ? undefined
          : def.defaultParams?.[key] as number | number[] | undefined,
      };

      // Priority 1: exact key match with compatible source type
      const oldSock = oldNode.inputs[key];
      if (oldSock?.connection) {
        const srcNode = workingNodes.find(n => n.id === oldSock.connection!.nodeId);
        const srcDef  = srcNode ? getNodeDefinition(srcNode.type) : null;
        const srcType = srcDef?.outputs[oldSock.connection!.outputKey]?.type;
        if (srcType && typesCompatible(srcType, socket.type)) {
          newSocket.connection = oldSock.connection;
        }
      }

      // Priority 2: any connected old input whose source type is compatible
      if (!newSocket.connection) {
        for (const oldS of Object.values(oldNode.inputs)) {
          if (!oldS.connection) continue;
          const srcNode = workingNodes.find(n => n.id === oldS.connection!.nodeId);
          const srcDef  = srcNode ? getNodeDefinition(srcNode.type) : null;
          const srcType = srcDef?.outputs[oldS.connection!.outputKey]?.type;
          if (srcType && typesCompatible(srcType, socket.type)) {
            newSocket.connection = oldS.connection;
            break;
          }
        }
      }

      newInputs[key] = newSocket;
    }

    const newNodeObj: GraphNode = {
      id: newId,
      type: newType,
      position: { ...oldNode.position },
      inputs: newInputs,
      outputs: { ...def.outputs },
      params: { ...(def.defaultParams ?? {}) },
    };

    set(state => {
      const path = state.activeGroupPath;
      const srcNodes = path.length > 0 ? (getActiveNodes(state.nodes, path) ?? state.nodes) : state.nodes;

      const updated = srcNodes
        .filter(n => n.id !== nodeId)
        .map(n => {
          // Reroute downstream connections that pointed to oldNode's outputs
          let changed = false;
          const updatedInputs = { ...n.inputs };
          for (const [key, sock] of Object.entries(n.inputs)) {
            if (sock.connection?.nodeId !== nodeId) continue;
            const oldOutputKey = sock.connection.outputKey;
            let newOutputKey: string | null = null;
            // Try same key first
            if (newNodeObj.outputs[oldOutputKey]
                && typesCompatible(newNodeObj.outputs[oldOutputKey].type, sock.type)) {
              newOutputKey = oldOutputKey;
            } else {
              // First compatible output
              for (const [outKey, out] of Object.entries(newNodeObj.outputs)) {
                if (typesCompatible(out.type, sock.type)) { newOutputKey = outKey; break; }
              }
            }
            updatedInputs[key] = newOutputKey
              ? { ...sock, connection: { nodeId: newId, outputKey: newOutputKey } }
              : { ...sock, connection: undefined };
            changed = true;
          }
          return changed ? { ...n, inputs: updatedInputs } : n;
        });

      const newList = [...updated, newNodeObj];

      if (path.length > 0) {
        const newTop = setActiveNodes(state.nodes, path, newList);
        return { nodes: newTop ?? state.nodes, swapTargetNodeId: null };
      }
      return { nodes: newList, swapTargetNodeId: null };
    });

    get().compile();
  },

  undo: () => {
    const prev = undoManager.pop();
    if (!prev) return;
    undoManager.pushRedo(get().nodes);
    // Restore counter so new nodes after undo don't collide
    idGenerator.syncFromGraph(prev);
    set({ nodes: prev, nodeProbeValues: null });
    get().compile();
  },

  redo: () => {
    const next = undoManager.popRedo();
    if (!next) return;
    undoManager.pushUndo(get().nodes);
    idGenerator.syncFromGraph(next);
    set({ nodes: next, nodeProbeValues: null });
    get().compile();
  },

  addNode: (type, position, overrideParams?) => {
    // ── 3D scene companion spawning ──────────────────────────────────────────
    // Adding a RayMarch node auto-spawns a SceneGroup to the left (pre-wired
    // scene→scene). Adding a SceneGroup auto-spawns a RayMarch to the right.
    // Only at the top level — not inside a group drill-down.
    // overrideParams guard prevents triggering from programmatic calls.
    if (!get().activeGroupId && !overrideParams) {
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
      if (type === 'sceneGroup') {
        get().spawnGraph(
          position,
          [
            { type: 'marchCamera',    relPos: { x: -560, y: 0 } },
            { type: 'sceneGroup',     relPos: { x: -200, y: 0 } },
            { type: 'marchLoopGroup', relPos: { x: 200,  y: 0 } },
          ],
          [
            { from: 0, fromKey: 'ro',    to: 2, toKey: 'ro'    },
            { from: 0, fromKey: 'rd',    to: 2, toKey: 'rd'    },
            { from: 1, fromKey: 'scene', to: 2, toKey: 'scene' },
          ],
        );
        return undefined;
      }
      if (type === 'marchLoopGroup') {
        // Auto-spawn MarchCamera + SceneGroup + MarchLoopGroup, all pre-wired
        get().spawnGraph(
          position,
          [
            { type: 'marchCamera',    relPos: { x: -560, y: 0 } },
            { type: 'sceneGroup',     relPos: { x: -200, y: 0 } },
            { type: 'marchLoopGroup', relPos: { x: 200,  y: 0 } },
          ],
          [
            { from: 0, fromKey: 'ro',    to: 2, toKey: 'ro'    },
            { from: 0, fromKey: 'rd',    to: 2, toKey: 'rd'    },
            { from: 1, fromKey: 'scene', to: 2, toKey: 'scene' },
          ],
        );
        return undefined;
      }
      if (type === 'giLitMarchGroup') {
        // Auto-spawn MarchCamera + SceneGroup + GILitMarchGroup, all pre-wired
        get().spawnGraph(
          position,
          [
            { type: 'marchCamera',      relPos: { x: -560, y: 0 } },
            { type: 'sceneGroup',       relPos: { x: -200, y: 0 } },
            { type: 'giLitMarchGroup',  relPos: { x: 200,  y: 0 } },
          ],
          [
            { from: 0, fromKey: 'ro',    to: 2, toKey: 'ro'    },
            { from: 0, fromKey: 'rd',    to: 2, toKey: 'rd'    },
            { from: 1, fromKey: 'scene', to: 2, toKey: 'scene' },
          ],
        );
        return undefined;
      }
      if (type === 'marchCamera') {
        // Auto-spawn MarchCamera + SceneGroup + MarchLoopGroup, all pre-wired
        get().spawnGraph(
          position,
          [
            { type: 'marchCamera',    relPos: { x: 0,   y: 0 } },
            { type: 'sceneGroup',     relPos: { x: 360, y: 0 } },
            { type: 'marchLoopGroup', relPos: { x: 760, y: 0 } },
          ],
          [
            { from: 0, fromKey: 'ro',    to: 2, toKey: 'ro'    },
            { from: 0, fromKey: 'rd',    to: 2, toKey: 'rd'    },
            { from: 1, fromKey: 'scene', to: 2, toKey: 'scene' },
          ],
        );
        return undefined;
      }
      if (type === 'glass3d') {
        const existingNodes = get().nodes;
        const cam = existingNodes.find(n => n.type === 'marchCamera');
        const mlg = existingNodes.find(n => n.type === 'marchLoopGroup');
        if (cam && mlg) {
          // Wire to existing march setup
          undoManager.push(existingNodes);
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

    undoManager.push(get().nodes);
    const def = getNodeDefinition(type);
    if (!def) {
      console.error(`Unknown node type: ${type}`);
      return;
    }

    const nodeId = idGenerator.next();

    // Merge overrideParams with defaults
    const mergedParams = { ...(def.defaultParams ?? {}), ...(overrideParams ?? {}) };

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
    const outputs = (type === 'customFn' || type === 'exprNode') && overrideParams?.outputType
      ? { result: { type: outputType, label: 'Result' } }
      : { ...def.outputs };

    const newNode: GraphNode = {
      id: nodeId,
      type,
      position,
      inputs,
      outputs,
      params: mergedParams,
    };

    const { activeGroupId, activeGroupPath } = get();
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
    return nodeId;
  },

  spawnGraph: (origin, nodeSpecs, edges) => {
    undoManager.push(get().nodes);
    const assignedIds: string[] = [];
    const newNodes: GraphNode[] = [];

    // First pass: create all nodes (no connections yet)
    for (const spec of nodeSpecs) {
      const def = getNodeDefinition(spec.type);
      if (!def) { console.error(`spawnGraph: Unknown node type: ${spec.type}`); continue; }

      const nodeId = idGenerator.next();
      assignedIds.push(nodeId);

      const mergedParams = { ...(def.defaultParams ?? {}), ...(spec.params ?? {}) };

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
    undoManager.batch(get().nodes, () => { for (const id of nodeIds) get().removeNode(id); });
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
          if (sgNode.params?._groupOriginal && getNodeDefinition(sgNode.type)?.anchored) return;

          undoManager.push(nodes);
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

    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    // Push history once at the start of an edit burst (debounced — not on every keystroke/tick)
    if (!_historyParamPending) {
      undoManager.push(get().nodes);
      _historyParamPending = true;
    }
    if (_historyParamTimer) clearTimeout(_historyParamTimer);
    _historyParamTimer = setTimeout(() => { _historyParamPending = false; }, 1000);
    set(state => {
      // Top-level node
      if (state.nodes.some(n => n.id === nodeId)) {
        const node = state.nodes.find(n => n.id === nodeId)!;
        // If this is a group node being updated with override keys (innerNodeId::paramKey),
        // also sync those values into the subgraph nodes' params
        if (node.type === 'group') {
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
        return { nodes: state.nodes.map(n => n.id === nodeId ? { ...n, params: { ...n.params, ...params } } : n) };
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
          const updated = { ...sn, params: { ...sn.params, ...params } };
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
                  const updated = { ...sn, params: { ...sn.params, ...params } };
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

    // Optimisation: if every changed param already has a compiled uniform entry,
    // push the new values directly to ShaderCanvas via paramUniforms — no recompile.
    //
    // The uniform name comes from the compiler's binding map, never rebuilt
    // here: the compiler names uniforms from the node's *slug* (`u_p_fbmx49_scale`),
    // not its id, and a hand-built name from the id silently never matched, so
    // every slider tick used to take the full-recompile path below.
    if (options?.immediate) {
      const { paramUniforms: currentUniforms, paramBindings } = get();
      const uniformUpdates: Record<string, number> = {};
      let allAreUniforms = true;
      for (const [key, val] of Object.entries(params)) {
        if (typeof val !== 'number') { allAreUniforms = false; break; }
        // Editing inside a group passes the inner node's own id with a plain key.
        // Editing a group node's override passes the group id with an
        // `innerNodeId::paramKey` key — which is already the binding key. A param
        // surfaced from a nested group uses `nestedGroupId::innerNodeId::paramKey`;
        // the compiler binds it by the inner node's own id, i.e. the last two parts.
        const bindingKey = key.includes('::') ? key.split('::').slice(-2).join('::') : paramBindingKey(nodeId, key);
        const uniformName = paramBindings[bindingKey];
        if (!uniformName || !(uniformName in currentUniforms)) { allAreUniforms = false; break; }
        uniformUpdates[uniformName] = val;
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
    undoManager.push(get().nodes);
    set(state => {
      // Top-level connection
      if (state.nodes.some(n => n.id === targetNodeId)) {
        return {
          nodes: state.nodes.map(n => {
            if (n.id !== targetNodeId) return n;
            return {
              ...n,
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
        const def = getNodeDefinition(targetSgNode.type);
        const pd = def?.paramDefs?.[paramKey];
        if (pd) { socketType = (pd.type as import('../types/nodeGraph').DataType) ?? 'float'; socketLabel = pd.label; }
      }
      const newActiveNodes = activeNodes.map(sn => {
        if (sn.id !== targetNodeId) return sn;
        return {
          ...sn,
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
    undoManager.push(get().nodes);
    set(state => {
      // Top-level
      if (state.nodes.some(n => n.id === nodeId)) {
        return {
          nodes: state.nodes.map(n => {
            if (n.id !== nodeId) return n;
            const newInput = { ...n.inputs[inputKey] };
            delete newInput.connection;
            return { ...n, inputs: { ...n.inputs, [inputKey]: newInput } };
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
        return { ...sn, inputs: { ...sn.inputs, [inputKey]: newInput } };
      });
      const newTop = setActiveNodes(state.nodes, path, newActiveNodes);
      return { nodes: newTop ?? state.nodes };
    });
    get().compile();
  },

  clearDisconnectedNotice: () => set({ disconnectedNotice: null }),

  setGroupOutput: (groupId, outputPortKey, fromNodeId, fromOutputKey) => {
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
    set(state => {
      const nodes = state.nodes.map(n => {
        if (n.id !== groupNodeId) return n;
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        // Update marchLoopInputs node's outputs + params.extraInputs
        const newSgNodes = sg.nodes.map(sn => {
          if (sn.type !== 'marchLoopInputs') return sn;
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
    undoManager.push(get().nodes);
    set(state => {
      const nodes = state.nodes.map(n => {
        if (n.id !== groupNodeId) return n;
        const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        if (!sg) return n;
        const newSgNodes = sg.nodes.map(sn => {
          if (sn.type !== 'marchLoopInputs') return sn;
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
          if (sn.type !== 'marchLoopInputs') return sn;
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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
    undoManager.push(get().nodes);
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

  updateNodeSockets: (nodeId, inputDefs, outputType) => {
    undoManager.push(get().nodes);

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
      return { ...n, inputs: newInputs, outputs: { result: { type: outputType, label: 'Result' } } };
    };

    set(state => {
      // Top-level node
      if (state.nodes.some(n => n.id === nodeId)) {
        return { nodes: state.nodes.map(n => n.id === nodeId ? buildUpdatedNode(n) : n) };
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
    undoManager.push(get().nodes);

    const updater = (n: import('../types/nodeGraph').GraphNode): import('../types/nodeGraph').GraphNode => {
      const newInputs = { ...n.inputs };
      const existingIn = newInputs[primaryInputKey];
      if (existingIn) {
        // Drop the connection if the type changed (avoids type-mismatch wires)
        const keepConn = existingIn.connection != null && existingIn.type === outputType;
        newInputs[primaryInputKey] = { ...existingIn, type: outputType, connection: keepConn ? existingIn.connection : undefined };
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

  compile: () => {
    // A structural compile supersedes any debounced one still on the timer;
    // without this the timer fires later and runs an identical second compile.
    compilationService.cancelPending();
    const { nodes, previewNodeId, activeGroupId } = get();
    let graphNodes: GraphNode[];
    if (previewNodeId) {
      // Check if the preview target lives inside a group's subgraph rather than at the top level
      const isTopLevel = nodes.some(n => n.id === previewNodeId);
      if (!isTopLevel && activeGroupId) {
        const groupNode = nodes.find(n => n.id === activeGroupId);
        const subgraph = groupNode?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
        const isInGroup = subgraph?.nodes.some(n => n.id === previewNodeId) ?? false;
        graphNodes = isInGroup
          ? buildGroupPreviewGraph(nodes, activeGroupId, previewNodeId)
          : buildPreviewGraph(nodes, previewNodeId);
      } else {
        graphNodes = buildPreviewGraph(nodes, previewNodeId);
      }
    } else {
      graphNodes = nodes;
    }
    const result = compileGraph({ nodes: graphNodes });

    // Patch MLG node.outputs with dynamic acc* sockets discovered at compile time.
    // Preserves any existing acc* labels already stored in the graph (e.g. from saved examples).
    // Every subscriber to `nodes` (each node card, the graph, App) re-renders
    // when the array reference changes, so the map passes below only produce
    // a new array when some element actually changed; otherwise `nodes` is
    // left out of the set() entirely.
    const prevNodes = get().nodes;
    let patchedForAcc = prevNodes;
    let nodesChanged = false;
    if (result.mlgDynamicOutputs && result.mlgDynamicOutputs.size > 0) {
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
    set({
      ...(nodesChanged ? { nodes: patchedForAcc } : {}),
      vertexShader: result.vertexShader,
      fragmentShader: result.fragmentShader,
      compilationErrors: result.errors ?? [],
      nodeOutputVarMap: result.nodeOutputVars,
      paramUniforms: result.paramUniforms,
      paramBindings: result.paramBindings,
      textureUniforms: result.textureUniforms,
      audioUniforms: result.audioUniforms,
      videoUniforms: result.videoUniforms,
      isStateful: result.isStateful,
      particleSystems: result.particleSystems ?? [],
      nodeSlugMap: result.nodeSlugMap ?? new Map(),
      // Probe values are read from the compiled program, so they only go
      // stale when the shader itself changed.
      ...(shaderChanged ? { nodeProbeValues: null } : {}),
    });
  },

  updateParamUniforms: (updates) => {
    set(state => ({ paramUniforms: { ...state.paramUniforms, ...updates } }));
  },

  autoLayout: () => {
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
    function computeLayout(layoutNodes: import('../types/nodeGraph').GraphNode[]): Map<string, { x: number; y: number }> {
      const ranked = groupNodesByRank(layoutNodes);
      const newPositions: Map<string, { x: number; y: number }> = new Map();
      for (const { rank, nodes: rankNodes } of ranked) {
        let y = START_Y;
        for (const node of rankNodes) {
          newPositions.set(node.id, { x: START_X + rank * 440, y }); // 360px cards + 80px for wires
          y += estimateNodeHeight(node) + 32;
        }
      }
      return newPositions;
    }

    const activeGroupId = state.activeGroupId;

    if (activeGroupId) {
      // Subgraph-aware: layout the inner nodes of the active group
      const groupNode = nodes.find(n => n.id === activeGroupId);
      const sg = groupNode?.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
      if (!sg || sg.nodes.length === 0) return;
      const newPositions = computeLayout(sg.nodes);
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
      const newPositions = computeLayout(nodes);
      set(state2 => ({
        nodes: state2.nodes.map(n => ({
          ...n,
          position: newPositions.get(n.id) ?? n.position,
        })),
      }));
    }
  },

  loadExampleGraph: async (name?: string) => {
    const example = name ?? DEFAULT_EXAMPLE;
    // The blank starter is bundled with the app; every other example lives in
    // a lazily loaded chunk (see exampleIndex.ts).
    let graph: ExampleGraph | undefined = example === 'blank' ? BLANK_GRAPH : undefined;
    if (!graph) {
      try {
        const all = await loadExampleGraphs();
        graph = all[example] ?? all[DEFAULT_EXAMPLE];
      } catch (e) {
        console.error('[loadExampleGraph] could not load the example graphs chunk', e);
        return;
      }
    }
    // Only now — nothing above touched the current graph or its history.
    undoManager.clear();
    const { nodes: rawNodes } = graph;

    const nodes = spreadLegacyLayout(upgradeExprNodes(rawNodes).map(n => migrateNodeParams(
      n.params ? n : { ...n, params: {} },
      getNodeDefinition,
    )));

    idGenerator.syncFromGraph(nodes);
    // Example graphs don't carry their own loose groups yet — reset rather
    // than leave a previous graph's groups referencing node ids that don't
    // exist in this one.
    set({ nodes, looseGroups: [], previewNodeId: null, activeGroupId: null, activeGroupPath: [] });
    get().compile();
  },

  setPreviewNodeId: (id) => {
    set({ previewNodeId: id });
    get().compile();
  },

  setGlslErrors: (errors) => set({ glslErrors: errors }),
  setGlContextLost: (lost) => set({ glContextLost: lost }),
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
  saveGraph: async (name) => {
    const { nodes, looseGroups } = get();
    const payload = JSON.stringify({ nodes, looseGroups, layout: LAYOUT_VERSION, savedAt: Date.now() });
    // localStorage is the primary store; a quota failure here means nothing
    // was saved, so stop before the (optional) disk mirror.
    const stored = safeSetItem(`shader-studio:${name}`, payload, `graph "${name}"`);
    if (!stored.ok) return stored;
    const dir = getGraphDir();
    if (dir) {
      const path = `${dir}/${labelToSlug(name || 'graph')}.json`;
      try {
        await writeTextFileAtPath(path, JSON.stringify({ nodes, looseGroups, layout: LAYOUT_VERSION }, null, 2));
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

  loadSavedGraph: (name) => {
    const raw = localStorage.getItem(`shader-studio:${name}`);
    if (!raw) {
      const error = `No saved graph named "${name}"`;
      console.error('[loadSavedGraph]', error);
      return { ok: false, error };
    }
    // Same shape as importGraph: parse + migrate first, and only touch the
    // undo history / live graph once the saved data is known to be usable.
    let nodes: GraphNode[];
    let looseGroups: unknown;
    try {
      const parsed = JSON.parse(raw) as { nodes?: unknown; looseGroups?: unknown; layout?: unknown };
      if (!Array.isArray(parsed?.nodes)) throw new Error('missing "nodes" array');
      looseGroups = parsed.looseGroups;
      // Strip in-memory audio state — audio buffers are not persisted, so
      // _isPlaying / _hasFile would crash the audio engine on load.
      const sanitized = (parsed.nodes as GraphNode[]).map(n => {
        if (n.type === 'audioInput') {
          return { ...n, params: { ...n.params, _isPlaying: false, _hasFile: false, _fileName: '' } };
        }
        return n;
      });
      nodes = upgradeExprNodes(sanitized).map(n => migrateNodeParams(n, getNodeDefinition));
      if (needsLayoutSpread(parsed)) nodes = spreadLegacyLayout(nodes);
    } catch (e) {
      console.error('[loadSavedGraph] saved graph is corrupt', name, e);
      return { ok: false, error: `Saved graph "${name}" is corrupt and could not be loaded: ${errorMessage(e)}` };
    }
    undoManager.clear();
    idGenerator.syncFromGraph(nodes);
    // Reset group navigation so a saved graph that was captured inside a
    // subgraph doesn't leave the editor stranded in a non-existent group.
    set({ nodes, looseGroups: Array.isArray(looseGroups) ? looseGroups as import('../types/nodeGraph').LooseGroup[] : [], previewNodeId: null, activeGroupId: null, activeGroupPath: [] });
    get().compile();
    return { ok: true };
  },

  deleteSavedGraph: (name) => {
    localStorage.removeItem(`shader-studio:${name}`);
  },

  exportGraph: async () => {
    const { nodes, looseGroups } = get();
    const json = JSON.stringify({ nodes, looseGroups, layout: LAYOUT_VERSION }, null, 2);
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    let name = 'shader-graph';
    if (!isTauri) {
      // prompt() returns null on Cancel — that's a cancel, not a request for
      // the default name. An empty string (OK with the field cleared) keeps it.
      const typed = window.prompt('File name:', 'shader-graph');
      if (typed === null) return CANCELLED;
      name = typed.trim() || 'shader-graph';
    }
    // saveTextFile never throws: Tauri dialog/write failures come back as a result.
    return saveTextFile(json, name.endsWith('.json') ? name : `${name}.json`);
  },

  importGraph: (json: string) => {
    // Parse and migrate before touching any state: a malformed file must
    // leave the current graph and its undo history exactly as they were.
    let nodes: GraphNode[];
    let looseGroups: unknown;
    try {
      const parsed = JSON.parse(json) as { nodes?: unknown; looseGroups?: unknown; layout?: unknown } | null;
      if (!parsed || typeof parsed !== 'object') throw new Error('file does not contain a JSON object');
      if (!Array.isArray(parsed.nodes)) throw new Error('missing "nodes" array — is this a Shader Studio graph file?');
      looseGroups = parsed.looseGroups;
      nodes = upgradeExprNodes(parsed.nodes as GraphNode[]).map(n => migrateNodeParams(n, getNodeDefinition));
      if (needsLayoutSpread(parsed)) nodes = spreadLegacyLayout(nodes);
    } catch (e) {
      console.error('[importGraph] invalid graph file', e);
      return { ok: false, error: `Could not import graph: ${errorMessage(e)}` };
    }
    undoManager.clear();
    idGenerator.syncFromGraph(nodes);
    set({ nodes, looseGroups: Array.isArray(looseGroups) ? looseGroups as import('../types/nodeGraph').LooseGroup[] : [], previewNodeId: null, activeGroupId: null, activeGroupPath: [] });
    get().compile();
    return { ok: true };
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
      id: `cfp_${Date.now()}`,
      label: (node.params.label as string) || 'Custom Function',
      inputs: (node.params.inputs as CustomFnPreset['inputs']) ?? [],
      outputType: (node.params.outputType as CustomFnPreset['outputType']) ?? 'float',
      body: (node.params.body as string) ?? '0.0',
      glslFunctions: (node.params.glslFunctions as string) ?? '',
      savedAt: Date.now(),
    };
    // Always save to localStorage (belt-and-suspenders), and to disk if configured
    return customFnPresetManager.save(preset);
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
