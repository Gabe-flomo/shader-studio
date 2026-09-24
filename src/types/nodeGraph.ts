// Data types that flow between nodes
export type DataType = "float" | "vec2" | "vec3" | "vec4" | "mat2" | "mat3" | "scene3d" | "spacewarp3d" | "particle";

// Socket (connection point on a node)
export interface Socket {
  type: DataType;
  label: string;
  /** Optional docstring shown in the node info panel: what the socket expects or produces. */
  hint?: string;
}

// Input socket with connection and default value
export interface InputSocket extends Socket {
  connection?: {
    nodeId: string;
    outputKey: string;
  };
  defaultValue?: number | number[];
  /**
   * For a vec2/vec3 socket whose unconnected fallback is built from separate
   * float params (e.g. UvTransform2D's `translate` from `tx`/`ty`) rather
   * than a single vector value: the param name backing each axis, in order
   * (['tx','ty'] or ['x','y','z']). Opts the socket into per-axis vector
   * keyframing — resolveInputVars uses it to find each axis's static
   * fallback, and the keyframe editor uses it to seed each axis's starting
   * value. Sockets without this (most vec2/vec3 sockets, meant to be wired
   * from another node — UV, SDF positions, etc.) are not keyframe-eligible.
   */
  axisParams?: string[];
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
  /** When true the group can't be entered (double-click disabled). Compilation is unchanged — it still inlines.
   *  To get a real standalone GLSL function, publish the group as a node type (see nodes/userNodes). */
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
  type: 'float' | 'int' | 'vec3' | 'vec3color' | 'select' | 'string' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  // Options for 'select' type
  options?: { value: string; label: string }[];
  // Conditionally show this param only when another param matches a value
  showWhen?: { param: string; value: string | string[] };
  /**
   * The value is baked into the GLSL as a constant (loop bounds, array sizes)
   * rather than becoming a live uniform; changing it recompiles. Prefer this
   * over relying on `step === 1` as the signal.
   */
  compileTime?: boolean;
}

// Node definition (blueprint)
export interface NodeDefinition {
  type: string;
  label: string;
  category: string;
  /** Optional finer grouping within `category` — used by the mobile Nodes
   *  browser to break up a large category (e.g. Math's 50+ nodes) into
   *  named sub-lists (Trigonometry, Vectors, ...) instead of one long flat
   *  list. Purely a browsing aid; unset categories still work everywhere
   *  else exactly as before. */
  subcategory?: string;
  description?: string;
  /** Previous names, still matched by node search after a rename. */
  aliases?: string[];

  inputs: Record<string, InputSocket>;
  outputs: Record<string, OutputSocket>;

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
  /**
   * Helper functions that depend on the instance (e.g. a user node whose
   * flattened body was pre-built per iteration count). Collected alongside
   * `glslFunctions` wherever a node is compiled; de-duplicated by name.
   */
  glslFunctionsFor?: (node: GraphNode) => string[];
  /**
   * Image slots this node owns. For each slot the assembler declares a
   * per-instance `uniform sampler2D u_tex_<slug>_<slot>` bound to the texture
   * stored under `nodeTextures["<nodeId>::<slot>"]`; generateGLSL passes it
   * as `u_tex_${node.id}_${slot}`.
   */
  textureSlots?: string[];

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

  /**
   * Rename stale input socket keys from old definitions.
   * Keys are `{ oldKey: newKey }` pairs applied unconditionally on every load.
   * Use this when an input is renamed so that saved connections survive the rename.
   */
  migrateInputKeys?: Record<string, string>;
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

  let result = node;

  // Recurse into group subgraphs so nodes at any nesting depth are migrated
  if (result.params?.subgraph) {
    const sg = result.params.subgraph as SubgraphData;
    if (Array.isArray(sg.nodes)) {
      let migratedInner = sg.nodes.map(n => migrateNodeParams(n, getDef));

      // Repair a group input port whose internal wiring predates
      // GROUP_PORT_SENTINEL (or otherwise never got it): toNodeId/toInputKey
      // is deprecated, display-only metadata — the *live* source of truth
      // for a plain group's input is a subgraph node whose connection.nodeId
      // === GROUP_PORT_SENTINEL. A file that only ever set toNodeId/
      // toInputKey (an older save format, or a raw cross-scope nodeId that
      // was never valid inside a subgraph's own scope) has a port that
      // looks wired in the UI but silently compiles to that socket's type
      // default (0.0, vec2(0.0), ...) — no error, just a wrong render. Only
      // a connection that's unambiguously broken (points at an id that
      // doesn't exist anywhere in this subgraph, and isn't the sentinel) is
      // touched; a genuinely absent connection is left alone; disconnecting
      // an input is a normal, intentional action elsewhere in the app and
      // must stay that way here.
      const idsInScope = new Set(migratedInner.map(n => n.id));
      const inputPorts = sg.inputPorts ?? [];
      if (inputPorts.length > 0) {
        migratedInner = migratedInner.map(n => {
          const port = inputPorts.find(p => p.toNodeId === n.id);
          if (!port) return n;
          const inp = n.inputs[port.toInputKey];
          const conn = inp?.connection;
          if (!inp || !conn) return n;
          const dangling = conn.nodeId !== GROUP_PORT_SENTINEL && !idsInScope.has(conn.nodeId);
          if (!dangling) return n;
          return {
            ...n,
            inputs: { ...n.inputs, [port.toInputKey]: { ...inp, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: port.key } } },
          };
        });
      }

      result = { ...result, params: { ...result.params, subgraph: { ...sg, nodes: migratedInner } } };
    }
  }

  // Rename stale input socket keys (e.g. 't' → 'value' on palette nodes)
  if (def.migrateInputKeys) {
    const renames = def.migrateInputKeys;
    const newInputs = { ...result.inputs };
    let changed = false;
    for (const [oldKey, newKey] of Object.entries(renames)) {
      if (oldKey in newInputs && !(newKey in newInputs)) {
        newInputs[newKey] = newInputs[oldKey];
        delete newInputs[oldKey];
        changed = true;
      }
    }
    if (changed) result = { ...result, inputs: newInputs };
  }

  // Backfill any input sockets that exist in the definition but are missing
  // from the saved node (e.g. when a new input is added to an existing node type)
  {
    const newInputs = { ...result.inputs };
    let changed = false;
    for (const [key, socketDef] of Object.entries(def.inputs)) {
      if (!(key in newInputs)) {
        newInputs[key] = {
          type: socketDef.type,
          label: socketDef.label,
          ...(socketDef.defaultValue !== undefined ? { defaultValue: socketDef.defaultValue } : {}),
        };
        changed = true;
      }
    }
    if (changed) result = { ...result, inputs: newInputs };
  }

  const currentVersion = def.version ?? 1;
  const savedVersion   = (result.params._schemaVersion as number | undefined) ?? 0;

  if (!def.migrateParams || savedVersion >= currentVersion) {
    if (savedVersion !== currentVersion) {
      return { ...result, params: { ...result.params, _schemaVersion: currentVersion } };
    }
    return result;
  }

  const migratedParams = def.migrateParams({ ...result.params }, savedVersion);
  migratedParams._schemaVersion = currentVersion;
  return { ...result, params: migratedParams };
}

// The entire graph
export interface NodeGraph {
  nodes: GraphNode[];
}

// ── Group / subgraph node types ───────────────────────────────────────────────

/**
 * Sentinel `connection.nodeId` a plain-'group' subgraph node's input uses to
 * mean "sourced from this group's own input port" (outputKey = the port's
 * key) rather than another node in the subgraph. Set by groupNodes() when a
 * dangling input becomes a port; read by shaderAssembler.ts's
 * resolveGroupPortOverrides, which scans for it instead of trusting each
 * port's own (legacy) toNodeId/toInputKey — connectNodes()/disconnectInput()
 * need no special-casing since it's just an ordinary connection value, which
 * is what lets a port be reused by more than one internal target and lets a
 * target be freely rewired or disconnected from inside the group.
 */
export const GROUP_PORT_SENTINEL = '__port__';

/** A port that maps an outer connection into a specific socket inside the subgraph. */
export interface GroupInputPort {
  key: string;          // socket key on the group node's inputs
  type: DataType;
  label: string;
  /** @deprecated primary/first target only, kept for back-compat display — the
   * live source of truth for a plain group is any subgraph node input whose
   * connection.nodeId === GROUP_PORT_SENTINEL and outputKey === this port's key. */
  toNodeId: string;
  /** @deprecated see toNodeId */
  toInputKey: string;
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
  /** Purely-visual node clusters at this scope — see LooseGroup below. */
  looseGroups?: LooseGroup[];
}

/**
 * A purely visual/organizational cluster of nodes — unlike a real `group`
 * node, this has no compile effect at all: members stay exactly where they
 * are in the flat node list, wired exactly as before. It only changes how
 * they're *displayed* — collapsed to one compound-looking box on desktop's
 * canvas (crossing wires reroute to the box's edge), or folded into one
 * folder-style entry in mobile's list view. Scoped the same way regular
 * nodes are: lives in the top-level looseGroups field, or nested in a
 * SubgraphData alongside that scope's own nodes.
 */
export interface LooseGroup {
  id: string;
  label: string;
  memberIds: string[];
  collapsed: boolean;
  /** Desktop canvas position for the collapsed compound box; unused on mobile. */
  position: { x: number; y: number };
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
