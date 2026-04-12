import { create } from 'zustand';
import type { GraphNode, InputSocket, DataType } from '../types/nodeGraph';
import { migrateNodeParams } from '../types/nodeGraph';
import type { CustomFnPreset, CustomFnPresetExport } from '../types/customFnPreset';
import type { GroupPreset } from '../types/groupPreset';
import { getNodeDefinition } from '../nodes/definitions';
import { compileGraph } from '../compiler/graphCompiler';
import { saveTextFile, openTextFile, readJsonFilesFromDir, writeTextFileAtPath, deleteFileAtPath } from '../utils/fileIO';
import { EXAMPLE_GRAPHS } from './exampleGraphs';
import { typesCompatible } from '../lib/typesCompatible';

// ── Custom-fn preset helpers ───────────────────────────────────────────────────
const CFP_PREFIX = 'shader-studio:cfp:';
const CFP_DIR_KEY = 'shader-studio:settings:customFnDir';

/** Get the user-configured presets folder path (or '' if not set). */
export function getCustomFnDir(): string {
  return localStorage.getItem(CFP_DIR_KEY) ?? '';
}

/** Persist the presets folder path. */
export function setCustomFnDir(path: string): void {
  if (path) localStorage.setItem(CFP_DIR_KEY, path);
  else localStorage.removeItem(CFP_DIR_KEY);
}

/** Convert a label to a filesystem-safe slug. */
function labelToSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fn';
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

  // Texture inputs — maps nodeId → loaded THREE.Texture (or null if not yet loaded)
  // Populated by NodeComponent file picker; consumed by ShaderCanvas to bind sampler2D uniforms.
  nodeTextures: Record<string, import('three').Texture | null>;
  setNodeTexture: (nodeId: string, texture: import('three').Texture | null) => void;
  // textureUniforms from last compilation: uniformName → nodeId
  textureUniforms: Record<string, string>;

  // Per-node preview thumbnails — nodeId → data URL (jpeg)
  nodePreviews: Record<string, string>;
  setNodePreview: (nodeId: string, dataUrl: string) => void;

  // Stateful rendering — true when a PrevFrame node exists in the graph
  isStateful: boolean;

  // Actions
  addNode: (type: string, position: { x: number; y: number }, overrideParams?: Record<string, unknown>) => void;
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
 *  so newly-added nodes never collide with existing IDs. */
function syncCounterFromNodes(nodes: GraphNode[]) {
  for (const node of nodes) {
    const m = node.id.match(/^node_(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10) + 1;
      if (n > nodeIdCounter) nodeIdCounter = n;
    }
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

export const useNodeGraphStore = create<NodeGraphState>((set, get) => ({
  nodes: [],
  vertexShader: '',
  fragmentShader: '',
  compilationErrors: [],
  paramUniforms: {},
  glslErrors: [],
  pixelSample: null,
  currentTime: 0,
  selectedNodeId: null,
  selectedNodeIds: [],
  nodeOutputVarMap: new Map(),
  nodeProbeValues: null,
  scopeProbeValues: {},
  previewNodeId: null,
  nodeHighlightFilter: null,
  _fitViewCallback: null,
  swapTargetNodeId: null,
  searchPaletteOpen: false,
  activeGroupId: null,
  nodeTextures: {},
  textureUniforms: {},
  nodePreviews: {},
  isStateful: false,
  groupPresets: loadGroupPresets(),

  setNodeHighlightFilter: (filter) => set({ nodeHighlightFilter: filter }),
  setActiveGroupId: (id) => set({ activeGroupId: id }),
  setNodeTexture: (nodeId, texture) => set(state => ({
    nodeTextures: { ...state.nodeTextures, [nodeId]: texture },
  })),
  setNodePreview: (nodeId, dataUrl) => set(state => ({
    nodePreviews: { ...state.nodePreviews, [nodeId]: dataUrl },
  })),
  registerFitView: (cb) => set({ _fitViewCallback: cb }),
  setSwapTargetNodeId: (id) => set({ swapTargetNodeId: id }),
  setSearchPaletteOpen: (open) => set({ searchPaletteOpen: open }),

  groupNodes: (nodeIds, label?) => {
    const { nodes } = get();
    if (nodeIds.length < 1) return null;

    const selectedSet = new Set(nodeIds);
    const selectedNodes = nodes.filter(n => selectedSet.has(n.id));
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
          label: key,
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

    // OUTPUT PORTS: non-selected nodes wired to selected node outputs
    const seenOutputs = new Set<string>(); // "fromNodeId:fromOutputKey"
    for (const n of nodes) {
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

    const groupId = `group_${Date.now()}`;
    const subgraph: import('../types/nodeGraph').SubgraphData = {
      nodes: selectedNodes,
      inputPorts,
      outputPorts,
    };
    const groupNode: import('../types/nodeGraph').GraphNode = {
      id: groupId,
      type: 'group',
      position: { x: cx, y: cy },
      inputs: groupInputSockets,
      outputs: groupOutputSockets,
      params: {
        label: label ?? 'Group',
        subgraph,
      },
    };

    // Replace outer connections that pointed into the group
    const updatedNodes = nodes
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

    set({ nodes: [...updatedNodes, groupNode] });
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
    const { nodes } = get();
    const groupNode = nodes.find(n => n.id === groupId);
    if (!groupNode || groupNode.type !== 'group') return;

    pushHistory(nodes);

    const subgraph = groupNode.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
    if (!subgraph) {
      set({ nodes: nodes.filter(n => n.id !== groupId) });
      get().compile();
      return;
    }

    // Restore subgraph nodes (they carry their original connections)
    const restoredNodes = subgraph.nodes;

    // Reconnect external nodes: replace connections pointing to groupId with
    // connections to the actual subgraph node from the outputPort mapping.
    const updatedOuter = nodes
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

    set({ nodes: [...updatedOuter, ...restoredNodes] });
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

    const groupId = `group_${Date.now()}`;
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
    const { nodes } = get();
    const oldNode = nodes.find(n => n.id === nodeId);
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
        const srcNode = nodes.find(n => n.id === oldSock.connection!.nodeId);
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
          const srcNode = nodes.find(n => n.id === oldS.connection!.nodeId);
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
      const updated = state.nodes
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
      return { nodes: [...updated, newNodeObj], swapTargetNodeId: null };
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

    // For customFn nodes, build sockets from the inputs array in params
    // (either overrideParams.inputs or defaultParams.inputs for fresh nodes)
    const customInputDefs = type === 'customFn'
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
    const outputs = type === 'customFn' && overrideParams?.outputType
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

    set(state => ({ nodes: [...state.nodes, newNode] }));
    get().compile();
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
    pushHistory(get().nodes);
    const { nodes } = get();
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
      // Drill into active group's subgraph (handles drag inside "enter group" view)
      const groupId = state.activeGroupId;
      if (!groupId) return {};
      return {
        nodes: state.nodes.map(n => {
          if (n.id !== groupId) return n;
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          return {
            ...n,
            params: { ...n.params, subgraph: { ...sg, nodes: sg.nodes.map(sn => sn.id === nodeId ? { ...sn, position } : sn) } },
          };
        }),
      };
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
        return { nodes: state.nodes.map(n => n.id === nodeId ? { ...n, params: { ...n.params, ...params } } : n) };
      }
      // Subgraph node (inside "enter group" view)
      const groupId = state.activeGroupId;
      if (!groupId) return {};
      return {
        nodes: state.nodes.map(n => {
          if (n.id !== groupId) return n;
          const sg = n.params.subgraph as import('../types/nodeGraph').SubgraphData | undefined;
          if (!sg) return n;
          return {
            ...n,
            params: { ...n.params, subgraph: { ...sg, nodes: sg.nodes.map(sn => sn.id === nodeId ? { ...sn, params: { ...sn.params, ...params } } : sn) } },
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
        const uniformName = key.includes('::')
          ? `u_p_${nodeId}_g_${key.replace('::', '_')}`
          : `u_p_${nodeId}_${key}`;
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

  connectNodes: (sourceNodeId, sourceOutputKey, targetNodeId, targetInputKey) => {
    pushHistory(get().nodes);
    set(state => ({
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
    }));
    get().compile();
  },

  disconnectInput: (nodeId, inputKey) => {
    pushHistory(get().nodes);
    set(state => ({
      nodes: state.nodes.map(n => {
        if (n.id !== nodeId) return n;
        const newInput = { ...n.inputs[inputKey] };
        delete newInput.connection;
        return { ...n, inputs: { ...n.inputs, [inputKey]: newInput } };
      }),
    }));
    get().compile();
  },

  toggleBypass: (nodeId) => {
    pushHistory(get().nodes);
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId ? { ...n, bypassed: !n.bypassed } : n
      ),
    }));
    get().compile();
  },

  updateNodeSockets: (nodeId, inputDefs, outputType) => {
    pushHistory(get().nodes);
    set(state => ({
      nodes: state.nodes.map(n => {
        if (n.id !== nodeId) return n;
        // Build new inputs record from inputDefs, preserving existing connections where names match
        const newInputs: Record<string, InputSocket> = {};
        for (const inp of inputDefs) {
          const existing = n.inputs[inp.name];
          // Slider inputs: no socket connection — value comes from node.params[name]
          const hasSlider = inp.type === 'float' && inp.slider != null;
          const paramVal = typeof n.params[inp.name] === 'number' ? (n.params[inp.name] as number) : 0;
          newInputs[inp.name] = {
            type: inp.type,
            label: inp.name,
            // Slider inputs: set defaultValue so compiler emits the param value as GLSL literal
            defaultValue: hasSlider ? paramVal : undefined,
            // Preserve connection only if socket name & type still match, and no slider override
            connection: (!hasSlider && existing?.type === inp.type) ? existing.connection : undefined,
          };
        }
        const newOutputs = { result: { type: outputType, label: 'Result' } };
        return { ...n, inputs: newInputs, outputs: newOutputs };
      }),
    }));
    get().compile();
  },

  compile: () => {
    const { nodes, previewNodeId } = get();
    const graphNodes = previewNodeId
      ? buildPreviewGraph(nodes, previewNodeId)
      : nodes;
    const result = compileGraph({ nodes: graphNodes });
    set({
      vertexShader: result.vertexShader,
      fragmentShader: result.fragmentShader,
      compilationErrors: result.errors ?? [],
      nodeOutputVarMap: result.nodeOutputVars,
      paramUniforms: result.paramUniforms,
      textureUniforms: result.textureUniforms,
      isStateful: result.isStateful,
      // Clear stale probe values when graph recompiles
      nodeProbeValues: null,
    });
  },

  updateParamUniforms: (updates) => {
    set(state => ({ paramUniforms: { ...state.paramUniforms, ...updates } }));
  },

  autoLayout: () => {
    const { nodes } = get();
    if (nodes.length === 0) return;

    // Layout constants
    const START_X = 40;
    const START_Y = 60;

    // Build map of nodeId → set of upstream nodeIds (nodes that feed INTO this node)
    const upstreamOf: Map<string, Set<string>> = new Map();
    for (const node of nodes) {
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
    for (const node of nodes) {
      if (upstreamOf.get(node.id)!.size === 0) {
        column.set(node.id, 0);
        queue.push(node.id);
      }
    }

    // BFS
    while (queue.length > 0) {
      const id = queue.shift()!;
      const col = column.get(id)!;
      // Find all nodes that have id as upstream
      for (const node of nodes) {
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
    for (const node of nodes) {
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
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const [col, ids] of cols.entries()) {
      let y = START_Y;
      for (const id of ids) {
        newPositions.set(id, { x: START_X + col * 340, y });
        const node = nodeMap.get(id);
        y += (node ? estimateNodeHeight(node) : 210) + 24; // 24px gap between nodes
      }
    }

    set(state => ({
      nodes: state.nodes.map(n => ({
        ...n,
        position: newPositions.get(n.id) ?? n.position,
      })),
    }));
  },

  loadExampleGraph: (name?: string) => {
    const example = name ?? 'fractalRings';
    const { nodes: rawNodes } = EXAMPLE_GRAPHS[example] ?? EXAMPLE_GRAPHS['fractalRings'];

    // Backfill any input sockets that exist in the live NodeDefinition but are
    // missing from the serialized graph (handles schema evolution across iterations).
    const nodes = rawNodes.map(node => {
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
    set({ nodes, previewNodeId: null });
    get().compile();
  },

  setPreviewNodeId: (id) => {
    set({ previewNodeId: id });
    get().compile();
  },

  setGlslErrors: (errors) => set({ glslErrors: errors }),
  setPixelSample: (sample) => set({ pixelSample: sample }),
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
    localStorage.setItem(`shader-studio:${name}`, JSON.stringify({ nodes, savedAt: Date.now() }));
  },

  getSavedGraphNames: () =>
    Object.keys(localStorage)
      .filter(k => k.startsWith('shader-studio:'))
      .map(k => k.slice('shader-studio:'.length))
      .sort(),

  loadSavedGraph: (name) => {
    const raw = localStorage.getItem(`shader-studio:${name}`);
    if (!raw) return;
    try {
      const { nodes: rawNodes } = JSON.parse(raw) as { nodes: GraphNode[] };
      if (Array.isArray(rawNodes)) {
        const nodes = rawNodes.map(n => migrateNodeParams(n, getNodeDefinition));
        syncCounterFromNodes(nodes);
        set({ nodes, previewNodeId: null });
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
        const nodes = rawNodes.map(n => migrateNodeParams(n, getNodeDefinition));
        syncCounterFromNodes(nodes);
        set({ nodes, previewNodeId: null });
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
    const node = get().nodes.find(n => n.id === nodeId);
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
