// Data types that flow between nodes
export type DataType = "float" | "vec2" | "vec3" | "vec4" | "scene3d" | "spacewarp3d";

// Socket (connection point on a node)
export interface Socket {
  type: DataType;
  label: string;
}

// Input socket with connection and default value
export interface InputSocket extends Socket {
  connection?: {
    nodeId: string;
    outputKey: string;
  };
  defaultValue?: number | number[];
}

// Output socket
export interface OutputSocket extends Socket {}

// Runtime node instance
export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  inputs: Record<string, InputSocket>;
  outputs: Record<string, OutputSocket>;
  params: Record<string, unknown>;
  /** When true the node is skipped — inputs are passed through to outputs */
  bypassed?: boolean;
  /** When true the node is a sealed group preset — compiles as a standalone GLSL function; double-click to enter is disabled */
  sealed?: boolean;
  /**
   * Assignment operator applied to this node's output via an accumulator variable.
   * Works everywhere — main graph, inside a group (with or without iterations):
   *   '='  — overwrite (default, no accumulator)
   *   '+=' — acc = assignInit; acc += nodeOutput
   *   '-=' — acc = assignInit; acc -= nodeOutput
   *   '*=' — acc = assignInit; acc *= nodeOutput
   *   '/=' — acc = assignInit; acc /= nodeOutput
   * Inside an iterated group the accumulator persists across iterations.
   */
  assignOp?: '=' | '+=' | '-=' | '*=' | '/=';
  /**
   * GLSL expression used to initialise the accumulator when assignOp !== '='.
   * Defaults to the neutral element for the operator (0.0 for add/subtract, 1.0 for multiply/divide).
   * Can reference any previously-computed GLSL variable name.
   */
  assignInit?: string;
  /**
   * Carry mode — when true inside an iterated group, this node's first output
   * feeds back as its own first type-matching input each iteration.
   *
   * Classic use: enable on a Fract/Tile node to get  uv = fract(uv * 1.5) - 0.5
   * without needing a separate LoopCarry node.
   *
   * The compiler:
   *   1. Declares T carryVar = <initial input value> before the loop
   *   2. Each iteration: feeds carryVar as this node's carry input
   *   3. After the node runs: carryVar = this node's output
   * Only meaningful inside an iterated group (iterations > 1).
   */
  carryMode?: boolean;
}

// Editable parameter definition (used to render inline controls on the node card)
export interface ParamDef {
  label: string;
  type: 'float' | 'vec3' | 'vec3color' | 'select' | 'string' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  // Options for 'select' type — array of { value, label } pairs
  options?: { value: string; label: string }[];
  // Conditionally show this param only when another param matches a value
  showWhen?: { param: string; value: string | string[] };
}

// Node definition (blueprint)
export interface NodeDefinition {
  type: string;
  label: string;
  category: string;
  description?: string;

  inputs: Record<string, Socket>;
  outputs: Record<string, Socket>;

  // How to generate GLSL for this node
  generateGLSL: (
    node: GraphNode,
    inputVars: Record<string, string>
  ) => {
    code: string;
    outputVars: Record<string, string>;
  };

  // Optional GLSL function(s) to include in shader
  glslFunction?: string;
  glslFunctions?: string[];

  // Default parameter values
  defaultParams?: Record<string, unknown>;

  // Editable param metadata — drives inline UI controls on the node card
  paramDefs?: Record<string, ParamDef>;

  /**
   * When true the node is auto-added to its parent container (SceneGroup, etc.)
   * and cannot be deleted by the user.  Visually indicated with a lock icon.
   */
  anchored?: boolean;

  /**
   * When true the node is hidden from the creation palette and marked with a
   * visual badge in existing graphs.  Compilation support is preserved.
   */
  deprecated?: boolean;

  /**
   * Schema version for this node definition.  Increment whenever the shape of
   * `defaultParams` / `paramDefs` changes in a way that could break saved graphs
   * (e.g. a param is renamed, removed, or its semantics change).
   * Omit or set to 1 for the initial version.
   */
  version?: number;

  /**
   * Migrate a node's params from an older schema version to the current one.
   * Called by the store when loading a saved graph whose node's `_schemaVersion`
   * is less than `version`.
   *
   * @param params      - The raw params from the saved graph
   * @param fromVersion - The schema version stored with the saved node (0 if absent)
   * @returns The migrated params (may be the same object mutated in-place)
   */
  migrateParams?: (
    params: Record<string, unknown>,
    fromVersion: number,
  ) => Record<string, unknown>;
}

// ── Helper: run migrations on a node's params ─────────────────────────────────

/**
 * Given a loaded graph node, look up its definition and run `migrateParams`
 * if the node's saved schema version is behind the current definition version.
 * Returns the node with updated params and `_schemaVersion` stamped.
 */
export function migrateNodeParams(
  node: GraphNode,
  getDef: (type: string) => NodeDefinition | undefined,
): GraphNode {
  const def = getDef(node.type);
  if (!def) return node;

  const currentVersion  = def.version ?? 1;
  const savedVersion    = (node.params._schemaVersion as number | undefined) ?? 0;

  if (!def.migrateParams || savedVersion >= currentVersion) {
    // Stamp the current version so it's always present in saved graphs
    if (savedVersion !== currentVersion) {
      return { ...node, params: { ...node.params, _schemaVersion: currentVersion } };
    }
    return node;
  }

  const migratedParams = def.migrateParams({ ...node.params }, savedVersion);
  migratedParams._schemaVersion = currentVersion;
  return { ...node, params: migratedParams };
}

// The entire graph
export interface NodeGraph {
  nodes: GraphNode[];
}

// ── Group / subgraph node types ───────────────────────────────────────────────

/** A port that maps an outer connection into a specific socket inside the subgraph. */
export interface GroupInputPort {
  key: string;          // socket key on the group node's inputs
  type: DataType;
  label: string;
  toNodeId: string;     // subgraph node that receives this value
  toInputKey: string;   // which input socket on that node
}

/** A port that maps a subgraph node's output to the group node's outputs. */
export interface GroupOutputPort {
  key: string;           // socket key on the group node's outputs
  type: DataType;
  label: string;
  fromNodeId: string;    // subgraph node that provides the value
  fromOutputKey: string; // which output socket on that node
}

/** Payload stored in node.params.subgraph for group nodes. */
export interface SubgraphData {
  nodes: GraphNode[];
  inputPorts: GroupInputPort[];
  outputPorts: GroupOutputPort[];
}

/**
 * A surfaced parameter from a nested inner group node.
 * Stored as node.params.surfacedParams on an outer group that contains inner groups.
 * Override values are stored as node.params["innerGroupId::nodeId::paramKey"].
 */
export interface SurfacedParam {
  /** ID of the inner group node within the outer group's subgraph */
  innerGroupId: string;
  /** ID of the node inside the inner group's subgraph */
  nodeId: string;
  /** Param key on that inner node */
  paramKey: string;
  /** Optional label override shown on the slider */
  label?: string;
}
