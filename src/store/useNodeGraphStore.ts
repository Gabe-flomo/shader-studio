import { create } from 'zustand';
import type { GraphNode, InputSocket, DataType } from '../types/nodeGraph';
import { migrateNodeParams } from '../types/nodeGraph';
import type { CustomFnPreset, CustomFnPresetExport } from '../types/customFnPreset';
import type { ExprPreset } from '../types/exprPreset';
import type { GroupPreset } from '../types/groupPreset';
import { getNodeDefinition } from '../nodes/definitions';
import { compileGraph } from '../compiler/graphCompiler';
import { saveTextFile, openTextFile, readJsonFilesFromDir, writeTextFileAtPath, deleteFileAtPath } from '../utils/fileIO';
import { EXAMPLE_GRAPHS } from './exampleGraphs';
import { typesCompatible } from '../lib/typesCompatible';
import { audioEngine } from '../lib/audioEngine';

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
  return {
    ...node,
    type: 'exprNode',
    inputs: newInputs,
    outputs: { result: { type: 'vec3' as DataType, label: 'Result (vec3)' } },
    params: {
      inputs: dynamicInputs,
      outputType: (node.params.outputType as string) || 'float',
      lines: [],
      result: exprStr,
      expr: exprStr,
    },
  };
}

/** Recursively upgrades all 'expr' nodes in a flat node list, including those
 *  nested in subgraph params (groups, SceneGroups, MarchLoopGroups, etc.). */
function upgradeExprNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map(node => {
    let n = _upgradeExprNode(node);
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

// ── Custom-fn preset helpers ───────────────────────────────────────────────────
const CFP_PREFIX  = 'shader-studio:cfp:';
const EP_PREFIX   = 'shader-studio:ep:';
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

/** Convert a label to a filesystem-safe slug. */
function labelToSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fn';
}

/**
 * Directly save a CustomFnPreset from caller-supplied data.
 * Writes to localStorage, optionally to disk, and fires the
 * 'customfn-changed' CustomEvent so NodePalette refreshes.
 */
export function saveCustomFnPreset(
  data: { label: string; inputs: CustomFnPreset['inputs']; outputType: CustomFnPreset['outputType']; body: string; glslFunctions: string },
): void {
  const preset: CustomFnPreset = {
    id: `cfp_${Date.now()}`,
    label: data.label || 'Custom Fn',
    inputs: data.inputs ?? [],
    outputType: data.outputType ?? 'float',
    body: data.body ?? '0.0',
    glslFunctions: data.glslFunctions ?? '',
    savedAt: Date.now(),
  };
  localStorage.setItem(`${CFP_PREFIX}${preset.id}`, JSON.stringify(preset));
  window.dispatchEvent(new CustomEvent('customfn-changed'));
  const dir = getCustomFnDir();
  if (dir) {
    const slug = labelToSlug(preset.label);
    const filename = `${slug}_${preset.id}.json`;
    writeTextFileAtPath(`${dir}/${filename}`, JSON.stringify(preset, null, 2));
  }
}

/** Read all saved custom-fn presets from localStorage. */
export function loadCustomFns(): CustomFnPreset[] {
  const out: CustomFnPreset[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(CFP_PREFIX)) continue;
    try {
      const p = JSON.parse(localStorage.getItem(k)!) as CustomFnPreset;
      if (p?.id) out.push(p);
    } catch {}
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}

// ── Expr preset helpers ────────────────────────────────────────────────────────

export function saveExprPreset(data: Omit<ExprPreset, 'id' | 'savedAt'>): void {
  const preset: ExprPreset = {
    id: `ep_${Date.now()}`,
    ...data,
    savedAt: Date.now(),
  };
  localStorage.setItem(`${EP_PREFIX}${preset.id}`, JSON.stringify(preset));
  window.dispatchEvent(new CustomEvent('exprpreset-changed'));
  const dir = getExprDir();
  if (dir) {
    const slug = labelToSlug(preset.label ?? 'expr');
    writeTextFileAtPath(`${dir}/${slug}_${preset.id}.json`, JSON.stringify(preset, null, 2));
  }
}

export function loadExprPresets(): ExprPreset[] {
  const out: ExprPreset[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(EP_PREFIX)) continue;
    try {
      const p = JSON.parse(localStorage.getItem(k)!) as ExprPreset;
      if (p?.id) out.push(p);
    } catch {}
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}

export function deleteExprPreset(id: string): void {
  localStorage.removeItem(`${EP_PREFIX}${id}`);
  window.dispatchEvent(new CustomEvent('exprpreset-changed'));
}

// ── Group preset helpers ───────────────────────────────────────────────────────
const GP_PREFIX = 'shader-studio:gp:';

function loadGroupPresets(): GroupPreset[] {
  const presets: GroupPreset[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(GP_PREFIX)) continue;
    try {
      const p = JSON.parse(localStorage.getItem(key)!) as GroupPreset;
      if (p?.id && p?.subgraph) presets.push(p);
    } catch {}
  }
  return presets.sort((a, b) => b.savedAt - a.savedAt);
}

// Module-level debounce timer for recompilation triggered by param edits.
// Structure changes (connect/disconnect/add/remove) still compile immediately.
let _compileTimer: ReturnType<typeof setTimeout> | null = null;
// Debounce timer for history pushes during param edits (sliders/text) — we
// push once at the START of an edit burst, not on every keystroke/tick.
let _historyParamTimer: ReturnType<typeof setTimeout> | null = null;
let _historyParamPending = false;

// ── Undo history ──────────────────────────────────────────────────────────────
// Stored outside Zustand state so pushing snapshots never triggers a re-render.
const MAX_HISTORY = 50;
const _history: GraphNode[][] = [];

/** Push a deep-clone of the current node list onto the undo stack. */
function pushHistory(nodes: GraphNode[]) {
  _history.push(JSON.parse(JSON.stringify(nodes)));
  if (_history.length > MAX_HISTORY) _history.shift();
}

interface NodeGraphState {
  // Graph data
  nodes: GraphNode[];

  // Compiled shaders
  vertexShader: string;
  fragmentShader: string;
  compilationErrors: string[];
  /**
   * Uniform name → current value for all float params extracted by the compiler.
   * Updated in-place (without recompile) when sliders change eligible float params.
   */
  paramUniforms: Record<string, number>;
  /** Push param uniform value changes to ShaderCanvas without triggering a recompile. */
  updateParamUniforms: (updates: Record<string, number>) => void;

  // Runtime debug info (set by ShaderCanvas)
  glslErrors: string[];           // WebGL shader compile errors (from Three.js)
  pixelSample: [number, number, number, number] | null;  // mouse pixel RGBA 0-255
  hoveredParamHint: string | null;  // param hint shown in status bar on hover
  currentTime: number;            // current u_time uniform value (seconds)

  // Node probe — click a node to see its live output values in the status bar
  selectedNodeId: string | null;

  /**
   * Multi-select: set of currently selected node IDs.
   * Used for group operations, bulk actions, and visual highlighting.
   * Separate from selectedNodeId (which drives the probe panel).
   */
  selectedNodeIds: string[];
  selectNode: (id: string, addToSelection?: boolean) => void;
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

  // Texture inputs — maps nodeId → loaded THREE.Texture (or null if not yet loaded)
  // Populated by NodeComponent file picker; consumed by ShaderCanvas to bind sampler2D uniforms.
  nodeTextures: Record<string, import('three').Texture | null>;
  setNodeTexture: (nodeId: string, texture: import('three').Texture | null) => void;
  // textureUniforms from last compilation: uniformName → nodeId
  textureUniforms: Record<string, string>;
  // audioUniforms from last compilation: uniformName → nodeId
  audioUniforms: Record<string, string>;
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
  /** Toggle visibility of a standard output port on the exterior marchLoopGroup node */
  toggleMarchLoopOutputPort: (groupNodeId: string, outputKey: string) => void;
  /** Add a new dynamic input port to a group (from inside the group view) */
  addGroupInput: (groupId: string, type: import('../types/nodeGraph').DataType, label: string) => void;
  /** Reroute an existing group input port to a different inner node socket */
  rerouteGroupInput: (groupId: string, portKey: string, toNodeId: string, toInputKey: string) => void;
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
   * Wrap selected nodes in a LoopStart / LoopEnd pair.
   * Carry type is inferred from the wire entering the first body node.
   * Returns { startId, endId } or null if the selection is invalid.
   */
  wrapInLoop: (nodeIds: string[]) => { startId: string; endId: string } | null;
  undo: () => void;
  compile: () => void;
  loadExampleGraph: (name?: string) => void;
  autoLayout: () => void;
  setGlslErrors: (errors: string[]) => void;
  setPixelSample: (sample: [number, number, number, number] | null) => void;
  setHoveredParamHint: (hint: string | null) => void;
  setCurrentTime: (t: number) => void;
  toggleBypass: (nodeId: string) => void;

  // Save / Load
  saveGraph: (name: string) => void;
  getSavedGraphNames: () => string[];
  loadSavedGraph: (name: string) => void;
  deleteSavedGraph: (name: string) => void;
  exportGraph: () => Promise<void>;
  importGraph: (json: string) => void;
  importGraphFromFile: () => Promise<void>;

  // Custom-fn presets
  saveCustomFn: (nodeId: string) => void;
  deleteCustomFn: (id: string) => void;
  exportCustomFns: () => Promise<void>;
  importCustomFns: (json: string) => void;
  importCustomFnsFromFile: () => Promise<void>;
  setCustomFnPresetsDir: (path: string) => void;
  loadCustomFnsFromDisk: () => Promise<CustomFnPreset[]>;

  // Group presets
  groupPresets: GroupPreset[];
  saveGroupPreset: (groupNodeId: string, label?: string, description?: string) => void;
  deleteGroupPreset: (presetId: string) => void;
  instantiateGroupPreset: (presetId: string, position?: { x: number; y: number }) => string | null;
}

// ─── Example graph data ───────────────────────────────────────────────────────

export { EXAMPLE_GRAPHS, DEFAULT_EXAMPLE } from './exampleGraphs';


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

  // Pick the best output to preview — prefer vec3, then vec4, then any
  const outputEntries = Object.entries(innerNode.outputs);
  const vec3Entry = outputEntries.find(([, s]) => s.type === 'vec3');
  const vec4Entry = outputEntries.find(([, s]) => s.type === 'vec4');
  const chosen = vec3Entry ?? vec4Entry ?? outputEntries[0];
  if (!chosen) return nodes;

  const [chosenKey, chosenSocket] = chosen;
  const outType = (chosenSocket as { type: string }).type as import('../types/nodeGraph').DataType;
  const isVec4 = outType === 'vec4';
  const previewPortKey = '__preview_port__';

  // Clone the group node with a patched subgraph: add a synthetic output port
  // that routes the inner node's chosen output to the group's outputs.
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
    outputs: {
      ...groupNode.outputs,
      [previewPortKey]: { type: outType, label: '__preview__' },
    },
  };

  // Replace the original group node with the patched one; keep all other top-level nodes
  const patchedNodes = nodes.map(n => n.id === groupId ? patchedGroupNode : n);

  // Now use buildPreviewGraph on the patched top-level nodes, treating the group as the target.
  // We need a synthetic output node that reads the preview port from the group.
  const syntheticOutput: GraphNode = {
    id: '__preview_output__',
    type: isVec4 ? 'vec4Output' : 'output',
    position: { x: 0, y: 0 },
    params: {},
    inputs: {
      color: {
        type: isVec4 ? 'vec4' : 'vec3',
        label: 'Color',
        connection: { nodeId: groupId, outputKey: previewPortKey },
      },
    },
    outputs: {},
  };

  // BFS from the group node to collect all its transitive dependencies
  const included = new Set<string>();
  const queue = [groupId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (included.has(id)) continue;
    included.add(id);
    const node = patchedNodes.find(n => n.id === id);
    if (!node) continue;
    for (const input of Object.values(node.inputs)) {
      if (input.connection) queue.push(input.connection.nodeId);
    }
  }

  const filteredNodes = patchedNodes.filter(n => included.has(n.id));
  return [...filteredNodes, syntheticOutput];
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

  // Pick the best output to preview — prefer vec3, then vec4, then any
  const outputEntries = Object.entries(targetNode.outputs);
  const vec3Entry = outputEntries.find(([, s]) => s.type === 'vec3');
  const vec4Entry = outputEntries.find(([, s]) => s.type === 'vec4');
  const chosen = vec3Entry ?? vec4Entry ?? outputEntries[0];
  if (!chosen) return nodes; // no outputs to preview

  const [chosenKey, chosenSocket] = chosen;
  const outType = (chosenSocket as { type: string }).type;
  const isVec4 = outType === 'vec4';

  // Synthetic output node (exists only in the compiled preview graph)
  const syntheticOutput: GraphNode = {
    id: '__preview_output__',
    type: isVec4 ? 'vec4Output' : 'output',
    position: { x: 0, y: 0 },
    params: {},
    inputs: {
      color: {
        type: isVec4 ? 'vec4' : 'vec3',
        label: 'Color',
        connection: { nodeId: targetId, outputKey: chosenKey },
      },
    },
    outputs: {},
  };

  return [...subgraph, syntheticOutput];
}

let nodeIdCounter = 0;

/** Advance nodeIdCounter past the highest node_N index in a loaded node list
 *  so newly-added nodes never collide with existing IDs. Recursively scans
 *  all nested subgraphs so IDs inside groups are also accounted for. */
function syncCounterFromNodes(nodes: GraphNode[]) {
  for (const node of nodes) {
    const m = node.id.match(/^node_(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10) + 1;
      if (n > nodeIdCounter) nodeIdCounter = n;
    }
    const subgraph = node.params?.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (subgraph?.nodes?.length) syncCounterFromNodes(subgraph.nodes);
  }
}

function estimateNodeHeight(node: GraphNode): number {
  const def = getNodeDefinition(node.type);
  const inputCount  = Object.keys(node.inputs).length;
  const outputCount = Object.keys(node.outputs).length;
  // Count only visible param defs (float or select — things that render sliders/dropdowns)
  const paramCount = def ? Object.values(def.paramDefs ?? {}).filter(
    pd => pd.type === 'float' || pd.type === 'select' || pd.type === 'vec3'
  ).length : 0;
  // Header ~36px, each socket row ~22px, each param ~34px, padding 16px
  return 36 + (inputCount + outputCount) * 22 + paramCount * 34 + 16;
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
 * Deep-clone a group node, assigning new IDs to the group itself and all its
 * subgraph nodes (recursively for nested groups).
 */
function deepCloneGroupNode(groupNode: GraphNode): GraphNode {
  const subgraph = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
  const newGroupId = `node_${nodeIdCounter++}`;
  if (!subgraph) return { ...groupNode, id: newGroupId };

  const idMap = new Map<string, string>();
  for (const sn of subgraph.nodes) {
    idMap.set(sn.id, `node_${nodeIdCounter++}`);
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
  vertexShader: '',
  fragmentShader: '',
  compilationErrors: [],
  paramUniforms: {},
  glslErrors: [],
  pixelSample: null,
  hoveredParamHint: null,
  currentTime: 0,
  selectedNodeId: null,
  selectedNodeIds: [],
  nodeOutputVarMap: new Map(),
  nodeProbeValues: null,
  scopeProbeValues: {},
  previewNodeId: null,
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
  audioMasterVolume: 0.7,
  nodePreviews: {},
  isStateful: false,
  nodeSlugMap: new Map(),
  rawGlslShader: null,
  disconnectedNotice: null,
  groupPresets: loadGroupPresets(),

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
      if (groupNode?.type === 'sceneGroup' || groupNode?.type === 'spaceWarpGroup' || groupNode?.type === 'marchLoopGroup') {
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
      (groupNode?.type === 'sceneGroup' || groupNode?.type === 'marchLoopGroup') &&
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
      const isSceneStyleGroup = exitingNode?.type === 'sceneGroup' || exitingNode?.type === 'spaceWarpGroup' || exitingNode?.type === 'marchLoopGroup';
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
    pushHistory(nodes);
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

  setNodeTexture: (nodeId, texture) => set(state => ({
    nodeTextures: { ...state.nodeTextures, [nodeId]: texture },
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

    pushHistory(nodes);

    // ── Discover dangling connections ────────────────────────────────────────
    const inputPorts: import('../types/nodeGraph').GroupInputPort[] = [];
    const outputPorts: import('../types/nodeGraph').GroupOutputPort[] = [];
    // Track which outer connections feed into the group (for group node's input sockets)
    const groupInputSockets: Record<string, import('../types/nodeGraph').InputSocket> = {};
    // Track which outer nodes need their connections updated to point at the group
    const outerReplacements: Array<{ nodeId: string; inputKey: string; newConnection: { nodeId: string; outputKey: string } }> = [];

    let portIdx = 0;

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

    // Mark all original selected nodes as immutable within the group
    const originalNodes = selectedNodes.map(n => ({
      ...n,
      params: { ...n.params, _groupOriginal: true },
    }));

    // Auto-inject a LoopIndex node so iteration counter `i` is always accessible
    const loopIndexNode: import('../types/nodeGraph').GraphNode = {
      id: `node_${nodeIdCounter++}`,
      type: 'loopIndex',
      position: { x: Math.min(...xs) - 220, y: Math.min(...ys) },
      inputs: {},
      outputs: { i: { type: 'float', label: 'i' } },
      params: { _groupOriginal: true },
    };

    const groupId = `node_${nodeIdCounter++}`;
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

  wrapInLoop: (nodeIds) => {
    const { nodes } = get();
    if (nodeIds.length < 1) return null;

    const selectedSet  = new Set(nodeIds);
    const selectedNodes = nodes.filter(n => selectedSet.has(n.id));

    // Reject nodes that shouldn't be wrapped
    const forbidden = ['output', 'vec4Output', 'loopStart', 'loopEnd'];
    if (selectedNodes.some(n => forbidden.includes(n.type))) return null;

    pushHistory(nodes);

    // ── Find entry: first body node (no inputs from within selection) ──────────
    const entryNode = selectedNodes.find(n =>
      Object.values(n.inputs).every(
        inp => !inp.connection || !selectedSet.has(inp.connection.nodeId),
      ),
    ) ?? selectedNodes[0];

    // Discover external connection feeding into entry node → carry source + type
    let externalSource: { nodeId: string; outputKey: string } | undefined;
    let entryInputKey: string | undefined;
    let carryType: import('../types/nodeGraph').DataType = 'vec2';

    for (const [key, inp] of Object.entries(entryNode.inputs)) {
      if (inp.connection && !selectedSet.has(inp.connection.nodeId)) {
        externalSource  = { ...inp.connection };
        entryInputKey   = key;
        const srcNode   = nodes.find(n => n.id === inp.connection!.nodeId);
        const srcDef    = srcNode ? getNodeDefinition(srcNode.type) : undefined;
        const wireType  =
          srcNode?.outputs[inp.connection.outputKey]?.type ??
          srcDef?.outputs[inp.connection.outputKey]?.type;
        if (wireType === 'float' || wireType === 'vec2' || wireType === 'vec3' || wireType === 'vec4') {
          carryType = wireType;
        }
        break;
      }
    }

    // ── Find exit: last body node (output wired to non-selected node) ─────────
    let exitNodeId: string | undefined;
    let exitOutputKey: string | undefined;
    const downstreamEdges: Array<{ nodeId: string; inputKey: string }> = [];

    for (const n of nodes) {
      if (selectedSet.has(n.id)) continue;
      for (const [key, inp] of Object.entries(n.inputs)) {
        if (inp.connection && selectedSet.has(inp.connection.nodeId)) {
          exitNodeId    = inp.connection.nodeId;
          exitOutputKey = inp.connection.outputKey;
          downstreamEdges.push({ nodeId: n.id, inputKey: key });
        }
      }
    }
    // Fallback: last node with no internal downstream
    if (!exitNodeId) {
      const candidate = [...selectedNodes].reverse().find(n =>
        !nodes.some(other =>
          !selectedSet.has(other.id) &&
          Object.values(other.inputs).some(inp => inp.connection?.nodeId === n.id),
        ),
      );
      if (candidate) {
        exitNodeId    = candidate.id;
        exitOutputKey = Object.keys(candidate.outputs)[0] ?? 'out';
      }
    }

    const exitNode = selectedNodes.find(n => n.id === exitNodeId) ?? selectedNodes[selectedNodes.length - 1];

    const now     = Date.now();
    const startId = `loopStart_${now}`;
    const endId   = `loopEnd_${now + 1}`;

    const loopStartNode: import('../types/nodeGraph').GraphNode = {
      id: startId,
      type: 'loopStart',
      position: { x: entryNode.position.x - 240, y: entryNode.position.y },
      inputs:  { carry: { type: carryType, label: 'Initial value', connection: externalSource } },
      outputs: {
        carry:      { type: carryType, label: 'Carry →'    },
        iter_index: { type: 'float',   label: 'Iter Index' },
      },
      params: { iterations: 4, carryType },
    };

    const loopEndNode: import('../types/nodeGraph').GraphNode = {
      id: endId,
      type: 'loopEnd',
      position: { x: exitNode.position.x + 280, y: exitNode.position.y },
      inputs:  {
        carry: {
          type: carryType,
          label: '← Carry in',
          connection: exitNodeId && exitOutputKey
            ? { nodeId: exitNodeId, outputKey: exitOutputKey }
            : undefined,
        },
      },
      outputs: { result: { type: carryType, label: 'Result' } },
      params:  {},
    };

    // Re-wire entry node's external input → LoopStart.carry
    // Re-wire downstream nodes → LoopEnd.result
    const updatedNodes = nodes.map(n => {
      if (n.id === entryNode.id && entryInputKey) {
        return {
          ...n,
          inputs: {
            ...n.inputs,
            [entryInputKey]: { ...n.inputs[entryInputKey], connection: { nodeId: startId, outputKey: 'carry' } },
          },
        };
      }
      const replacements = downstreamEdges.filter(r => r.nodeId === n.id);
      if (replacements.length > 0) {
        const newInputs = { ...n.inputs };
        for (const r of replacements) {
          newInputs[r.inputKey] = { ...newInputs[r.inputKey], connection: { nodeId: endId, outputKey: 'result' } };
        }
        return { ...n, inputs: newInputs };
      }
      return n;
    });

    set({ nodes: [...updatedNodes, loopStartNode, loopEndNode] });
    get().compile();
    return { startId, endId };
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

    pushHistory(nodes);

    const subgraph = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;

    if (!subgraph) {
      const newWorking = workingNodes.filter(n => n.id !== groupId);
      const newNodes = isNested ? setActiveNodes(nodes, activeGroupPath, newWorking) : newWorking;
      if (newNodes) set({ nodes: newNodes });
      get().compile();
      return;
    }

    // Restore subgraph nodes — exclude auto-injected sentinels (loopIndex) and
    // strip the _groupOriginal flag so nodes are editable again.
    const restoredNodes = subgraph.nodes
      .filter(n => n.type !== 'loopIndex')
      .map(n => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _groupOriginal, ...restParams } = n.params as Record<string, unknown>;
        return { ...n, params: restParams };
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
        if (n.id !== nodeId || n.type !== 'group') return n;
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

  saveGroupPreset: (groupNodeId, label, description) => {
    const { nodes } = get();
    const groupNode = nodes.find(n => n.id === groupNodeId && n.type === 'group');
    if (!groupNode) return;
    const subgraph = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (!subgraph) return;
    const preset: GroupPreset = {
      id: `gp_${Date.now()}`,
      label: label ?? (typeof groupNode.params.label === 'string' ? groupNode.params.label : 'Group'),
      description: description || undefined,
      subgraph,
      savedAt: Date.now(),
    };
    localStorage.setItem(`${GP_PREFIX}${preset.id}`, JSON.stringify(preset));
    set({ groupPresets: loadGroupPresets() });
    const dir = getGroupPresetDir();
    if (dir) {
      const slug = labelToSlug(preset.label);
      writeTextFileAtPath(`${dir}/${slug}_${preset.id}.json`, JSON.stringify(preset, null, 2));
    }
  },

  deleteGroupPreset: (presetId) => {
    localStorage.removeItem(`${GP_PREFIX}${presetId}`);
    set({ groupPresets: loadGroupPresets() });
  },

  instantiateGroupPreset: (presetId, position) => {
    const { nodes } = get();
    const preset = get().groupPresets.find(p => p.id === presetId);
    if (!preset) return null;
    pushHistory(nodes);

    // Re-ID all subgraph nodes to avoid collisions
    const idMap = new Map<string, string>();
    const newSubNodes = preset.subgraph.nodes.map(n => {
      const newId = `node_${nodeIdCounter++}`;
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

    const groupId = `node_${nodeIdCounter++}`;
    const pos = position ?? { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 };
    const groupNode: GraphNode = {
      id: groupId,
      type: 'group',
      position: pos,
      inputs: groupInputSockets,
      outputs: groupOutputSockets,
      params: { label: preset.label, subgraph: newSubgraph },
    };

    set(state => ({ nodes: [...state.nodes, groupNode] }));
    get().compile();
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

    pushHistory(nodes);
    const newId = `node_${nodeIdCounter++}`;

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
    const prev = _history.pop();
    if (!prev) return;
    // Restore counter so new nodes after undo don't collide
    syncCounterFromNodes(prev);
    set({ nodes: prev, nodeProbeValues: null });
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
    }

    pushHistory(get().nodes);
    const def = getNodeDefinition(type);
    if (!def) {
      console.error(`Unknown node type: ${type}`);
      return;
    }

    const nodeId = `node_${nodeIdCounter++}`;

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
    pushHistory(get().nodes);
    const assignedIds: string[] = [];
    const newNodes: GraphNode[] = [];

    // First pass: create all nodes (no connections yet)
    for (const spec of nodeSpecs) {
      const def = getNodeDefinition(spec.type);
      if (!def) { console.error(`spawnGraph: Unknown node type: ${spec.type}`); continue; }

      const nodeId = `node_${nodeIdCounter++}`;
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

  removeNode: (nodeId) => {
    const { nodes, activeGroupPath } = get();

    // When inside a group, handle subgraph node removal (handles depth 1 and 2)
    if (activeGroupPath.length > 0) {
      const activeNodes = getActiveNodes(nodes, activeGroupPath);
      if (activeNodes) {
        const sgNode = activeNodes.find(n => n.id === nodeId);
        // Block deletion of original (creation-time) nodes
        if (sgNode?.params?._groupOriginal) return;
        if (sgNode) {
          pushHistory(nodes);
          // Remove from subgraph and clear connections pointing to it
          const newSgNodes = activeNodes
            .filter(n => n.id !== nodeId)
            .map(n => ({
              ...n,
              inputs: Object.fromEntries(
                Object.entries(n.inputs).map(([k, inp]) => [
                  k,
                  inp.connection?.nodeId === nodeId ? { ...inp, connection: undefined } : inp,
                ]),
              ),
            }));
          set(state => {
            const newTop = setActiveNodes(state.nodes, activeGroupPath, newSgNodes);
            return { nodes: newTop ?? state.nodes };
          });
          get().compile();
          return;
        }
      }
    }

    pushHistory(get().nodes);
    const deletedNode = nodes.find(n => n.id === nodeId);

    // ── Collect bridge info before removing ────────────────────────────────
    // Upstream: what was wired INTO the deleted node
    type Src = { sourceNodeId: string; sourceOutputKey: string; sourceType: string };
    const upstream: Src[] = [];
    if (deletedNode) {
      for (const input of Object.values(deletedNode.inputs)) {
        if (!input.connection) continue;
        const srcNode = nodes.find(n => n.id === input.connection!.nodeId);
        const srcDef  = srcNode ? getNodeDefinition(srcNode.type) : undefined;
        const srcType = srcDef?.outputs[input.connection!.outputKey]?.type ?? '';
        if (srcType) upstream.push({ sourceNodeId: input.connection.nodeId, sourceOutputKey: input.connection.outputKey, sourceType: srcType });
      }
    }

    // Downstream: what the deleted node was wired INTO
    type Tgt = { targetNodeId: string; targetInputKey: string; targetType: string };
    const downstream: Tgt[] = [];
    for (const n of nodes) {
      if (n.id === nodeId) continue;
      for (const [inputKey, input] of Object.entries(n.inputs)) {
        if (input.connection?.nodeId !== nodeId) continue;
        const tgtDef  = getNodeDefinition(n.type);
        const tgtType = tgtDef?.inputs[inputKey]?.type ?? '';
        downstream.push({ targetNodeId: n.id, targetInputKey: inputKey, targetType: tgtType });
      }
    }

    // Bridge: for each orphaned downstream input, pick the first compatible upstream source
    type Bridge = { sourceNodeId: string; sourceOutputKey: string; targetNodeId: string; targetInputKey: string };
    const bridges: Bridge[] = [];
    for (const tgt of downstream) {
      for (const src of upstream) {
        if (typesCompatible(src.sourceType as DataType, tgt.targetType as DataType)) {
          bridges.push({ sourceNodeId: src.sourceNodeId, sourceOutputKey: src.sourceOutputKey, targetNodeId: tgt.targetNodeId, targetInputKey: tgt.targetInputKey });
          break;
        }
      }
    }

    set(state => {
      // Remove the node and clear any connections that pointed to it
      let newNodes = state.nodes
        .filter(n => n.id !== nodeId)
        .map(n => ({
          ...n,
          inputs: Object.fromEntries(
            Object.entries(n.inputs).map(([key, input]) => [
              key,
              input.connection?.nodeId === nodeId
                ? { ...input, connection: undefined }
                : input,
            ])
          ),
        }));

      // Re-wire bridged connections
      for (const bridge of bridges) {
        newNodes = newNodes.map(n => {
          if (n.id !== bridge.targetNodeId) return n;
          return {
            ...n,
            inputs: {
              ...n.inputs,
              [bridge.targetInputKey]: {
                ...n.inputs[bridge.targetInputKey],
                connection: { nodeId: bridge.sourceNodeId, outputKey: bridge.sourceOutputKey },
              },
            },
          };
        });
      }

      const previewNodeId = state.previewNodeId === nodeId ? null : state.previewNodeId;
      return { nodes: newNodes, previewNodeId };
    });
    get().compile();
  },

  updateNodePosition: (nodeId, position) => {
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
      pushHistory(get().nodes);
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
    if (options?.immediate) {
      const currentUniforms = get().paramUniforms;
      const uniformUpdates: Record<string, number> = {};
      let allAreUniforms = true;
      for (const [key, val] of Object.entries(params)) {
        if (typeof val !== 'number') { allAreUniforms = false; break; }
        // Group inner-node overrides are stored as `innerNodeId::paramKey` on the group node.
        // The assembler prefixes the inner node as `groupNodeId_g_innerNodeId`, so the
        // compiled uniform name is `u_p_groupNodeId_g_innerNodeId_paramKey`.
        // Sanitize IDs: underscores create __ sequences which are reserved in GLSL ES.
        const safeNodeId = nodeId.replace(/_/g, 'x');
        const uniformName = key.includes('::')
          ? `u_p_${safeNodeId}_g_${key.replace('::', '_').replace(/_/g, 'x')}`
          : `u_p_${safeNodeId}_${key}`;
        if (!(uniformName in currentUniforms)) { allAreUniforms = false; break; }
        uniformUpdates[uniformName] = val;
      }
      if (allAreUniforms && Object.keys(uniformUpdates).length > 0) {
        // Fast path: update uniforms only, skip shader recompile entirely
        get().updateParamUniforms(uniformUpdates);
        return;
      }
      // Slow path: structural change or non-uniform param — full recompile
      if (_compileTimer) { clearTimeout(_compileTimer); _compileTimer = null; }
      get().compile();
    } else {
      // String fields (GLSL body, expr formula): debounce to avoid compile-on-every-keystroke
      if (_compileTimer) clearTimeout(_compileTimer);
      _compileTimer = setTimeout(() => { get().compile(); }, 500);
    }
  },

  updateNodeOutputs: (nodeId, outputs) => {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId ? { ...n, outputs } : n
      ),
    }));
    if (_compileTimer) { clearTimeout(_compileTimer); _compileTimer = null; }
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
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);
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

  rerouteGroupInput: (groupId, portKey, toNodeId, toInputKey) => {
    const { activeGroupPath } = get();
    set(state => {
      return {
        nodes: updateNodeInTree(state.nodes, groupId, activeGroupPath, n => {
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          return { ...n, params: { ...n.params, subgraph: { ...sg, inputPorts: sg.inputPorts.map(p => p.key === portKey ? { ...p, toNodeId, toInputKey } : p) } } };
        }),
      };
    });
    get().compile();
  },

  addGroupOutput: (groupId, type = 'float', label) => {
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);
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
    pushHistory(get().nodes);

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

  compile: () => {
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
    set({
      vertexShader: result.vertexShader,
      fragmentShader: result.fragmentShader,
      compilationErrors: result.errors ?? [],
      nodeOutputVarMap: result.nodeOutputVars,
      paramUniforms: result.paramUniforms,
      textureUniforms: result.textureUniforms,
      audioUniforms: result.audioUniforms,
      isStateful: result.isStateful,
      nodeSlugMap: result.nodeSlugMap ?? new Map(),
      // Clear stale probe values when graph recompiles
      nodeProbeValues: null,
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

    /** Run the BFS column-layout algorithm on any array of nodes and return a
     *  position map: nodeId → { x, y }. */
    function computeLayout(layoutNodes: import('../types/nodeGraph').GraphNode[]): Map<string, { x: number; y: number }> {
      // Build map of nodeId → set of upstream nodeIds (nodes that feed INTO this node)
      const upstreamOf: Map<string, Set<string>> = new Map();
      for (const node of layoutNodes) {
        if (!upstreamOf.has(node.id)) upstreamOf.set(node.id, new Set());
        for (const input of Object.values(node.inputs)) {
          if (input.connection) {
            upstreamOf.get(node.id)!.add(input.connection.nodeId);
          }
        }
      }

      // Assign column = max(upstream columns) + 1, BFS order
      const column: Map<string, number> = new Map();
      const queue: string[] = [];

      // Sources: nodes with no upstream
      for (const node of layoutNodes) {
        if (upstreamOf.get(node.id)!.size === 0) {
          column.set(node.id, 0);
          queue.push(node.id);
        }
      }

      // BFS
      while (queue.length > 0) {
        const id = queue.shift()!;
        const col = column.get(id)!;
        for (const node of layoutNodes) {
          if (upstreamOf.get(node.id)?.has(id)) {
            const prev = column.get(node.id) ?? -1;
            if (col + 1 > prev) {
              column.set(node.id, col + 1);
              queue.push(node.id);
            }
          }
        }
      }

      // Any disconnected nodes not yet assigned get column 0
      for (const node of layoutNodes) {
        if (!column.has(node.id)) column.set(node.id, 0);
      }

      // Group nodes by column, sort within column by id for stability
      const cols: Map<number, string[]> = new Map();
      for (const [id, col] of column.entries()) {
        if (!cols.has(col)) cols.set(col, []);
        cols.get(col)!.push(id);
      }
      for (const arr of cols.values()) arr.sort();

      // Assign positions — accumulate y per column so taller nodes don't overlap
      const newPositions: Map<string, { x: number; y: number }> = new Map();
      const nodeMap = new Map(layoutNodes.map(n => [n.id, n]));
      for (const [col, ids] of cols.entries()) {
        let y = START_Y;
        for (const id of ids) {
          newPositions.set(id, { x: START_X + col * 340, y });
          const node = nodeMap.get(id);
          y += (node ? estimateNodeHeight(node) : 210) + 24; // 24px gap between nodes
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

  loadExampleGraph: (name?: string) => {
    const example = name ?? 'fractalRings';
    const { nodes: rawNodes } = EXAMPLE_GRAPHS[example] ?? EXAMPLE_GRAPHS['fractalRings'];

    // Backfill any input sockets that exist in the live NodeDefinition but are
    // missing from the serialized graph (handles schema evolution across iterations).
    const nodes = upgradeExprNodes(rawNodes).map(rawNode => {
      const node = rawNode.params ? rawNode : { ...rawNode, params: {} };
      const def = getNodeDefinition(node.type);
      if (!def) return node;
      const mergedInputs: Record<string, InputSocket> = { ...node.inputs };
      for (const [key, socket] of Object.entries(def.inputs)) {
        if (!mergedInputs[key]) {
          mergedInputs[key] = {
            ...socket,
            defaultValue: def.paramDefs?.[key]
              ? undefined
              : def.defaultParams?.[key] as number | number[] | undefined,
          };
        }
      }
      return { ...node, inputs: mergedInputs };
    });

    syncCounterFromNodes(nodes);
    set({ nodes, previewNodeId: null, activeGroupId: null, activeGroupPath: [] });
    get().compile();
  },

  setPreviewNodeId: (id) => {
    set({ previewNodeId: id });
    get().compile();
  },

  setGlslErrors: (errors) => set({ glslErrors: errors }),
  setPixelSample: (sample) => set({ pixelSample: sample }),
  setHoveredParamHint: (hint) => set({ hoveredParamHint: hint }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id, nodeProbeValues: null }),
  setNodeProbeValues: (values) => set({ nodeProbeValues: values }),
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
  deselectAll: () => set({ selectedNodeIds: [] }),

  // ─── Save / Load ───────────────────────────────────────────────────────────
  saveGraph: (name) => {
    const { nodes } = get();
    const payload = JSON.stringify({ nodes, savedAt: Date.now() });
    localStorage.setItem(`shader-studio:${name}`, payload);
    const dir = getGraphDir();
    if (dir) {
      const slug = labelToSlug(name || 'graph');
      writeTextFileAtPath(`${dir}/${slug}.json`, JSON.stringify({ nodes }, null, 2));
    }
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
    if (!raw) return;
    try {
      const { nodes: rawNodes } = JSON.parse(raw) as { nodes: GraphNode[] };
      if (Array.isArray(rawNodes)) {
        // Strip in-memory audio state — audio buffers are not persisted, so
        // _isPlaying / _hasFile would crash the audio engine on load.
        const sanitized = rawNodes.map(n => {
          if (n.type === 'audioInput') {
            return { ...n, params: { ...n.params, _isPlaying: false, _hasFile: false, _fileName: '' } };
          }
          return n;
        });
        const nodes = upgradeExprNodes(sanitized).map(n => migrateNodeParams(n, getNodeDefinition));
        syncCounterFromNodes(nodes);
        // Reset group navigation so a saved graph that was captured inside a
        // subgraph doesn't leave the editor stranded in a non-existent group.
        set({ nodes, previewNodeId: null, activeGroupId: null, activeGroupPath: [] });
        get().compile();
      }
    } catch {}
  },

  deleteSavedGraph: (name) => {
    localStorage.removeItem(`shader-studio:${name}`);
  },

  exportGraph: async () => {
    const { nodes } = get();
    const json = JSON.stringify({ nodes }, null, 2);
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const name = isTauri ? 'shader-graph.json' : (window.prompt('File name:', 'shader-graph') ?? 'shader-graph');
    await saveTextFile(json, name.endsWith('.json') ? name : `${name}.json`);
  },

  importGraph: (json: string) => {
    try {
      const { nodes: rawNodes } = JSON.parse(json) as { nodes: GraphNode[] };
      if (Array.isArray(rawNodes)) {
        const nodes = upgradeExprNodes(rawNodes).map(n => migrateNodeParams(n, getNodeDefinition));
        syncCounterFromNodes(nodes);
        set({ nodes, previewNodeId: null, activeGroupId: null, activeGroupPath: [] });
        get().compile();
      }
    } catch {}
  },

  importGraphFromFile: async () => {
    const json = await openTextFile('.json');
    if (json) get().importGraph(json);
  },

  // ─── Custom-fn presets ──────────────────────────────────────────────────────

  saveCustomFn: (nodeId) => {
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
    if (!node || node.type !== 'customFn') return;
    const preset: CustomFnPreset = {
      id: `cfp_${Date.now()}`,
      label: (node.params.label as string) || 'Custom Fn',
      inputs: (node.params.inputs as CustomFnPreset['inputs']) ?? [],
      outputType: (node.params.outputType as CustomFnPreset['outputType']) ?? 'float',
      body: (node.params.body as string) ?? '0.0',
      glslFunctions: (node.params.glslFunctions as string) ?? '',
      savedAt: Date.now(),
    };
    // Always save to localStorage (belt-and-suspenders)
    localStorage.setItem(`${CFP_PREFIX}${preset.id}`, JSON.stringify(preset));
    window.dispatchEvent(new CustomEvent('customfn-changed'));
    // Also write to disk if a folder is configured
    const dir = getCustomFnDir();
    if (dir) {
      const slug = labelToSlug(preset.label);
      const filename = `${slug}_${preset.id}.json`;
      writeTextFileAtPath(`${dir}/${filename}`, JSON.stringify(preset, null, 2));
    }
  },

  deleteCustomFn: (id) => {
    // Remove from localStorage
    localStorage.removeItem(`${CFP_PREFIX}${id}`);
    window.dispatchEvent(new CustomEvent('customfn-changed'));
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
    const json = await openTextFile('.json');
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
