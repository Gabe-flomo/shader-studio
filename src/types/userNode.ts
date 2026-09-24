import type { DataType, SubgraphData } from './nodeGraph';

/**
 * A user-published node type.
 *
 * Unlike a group preset (a *copy* of a subgraph placed into the graph), a user
 * node is a first-class node *type*: instances store only `type: def.id` plus
 * their params, and every instance calls one flattened GLSL function. Editing
 * or deleting the definition affects every instance.
 *
 * The compiled form is pure GLSL (`functionCode` + `helperFunctions`) so
 * publishing a project that itself uses user nodes never nests definitions —
 * the inner nodes' functions are simply carried along as helpers. The source
 * subgraph is kept only as edit metadata; the compiler never reads it.
 */

/** A socket on the published node. `slider` (float only) gives the socket a
 *  param-backed default so it shows a slider when unconnected. */
export interface UserNodePort {
  key: string;
  type: DataType;
  label: string;
  slider?: { min: number; max: number; step?: number; default: number } | null;
  /** Docstring: what this socket expects (inputs) or produces (outputs). Supports `code`, **bold**, - bullets. */
  hint?: string;
}

/** A live float param: becomes a function argument, so per-instance sliders
 *  stay real-time uniforms with no recompile. */
export interface UserNodeParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  hint?: string;
  /** Where this param came from in the source subgraph
   *  ("nodeId::paramKey" or "innerGroupId::nodeId::paramKey"). Edit metadata only. */
  sourcePath?: string;
}

/**
 * A live iteration count. The group compiler unrolls iterations at compile
 * time, so the count can't be a uniform; instead one function variant is
 * pre-built per count and an instance's stepped slider picks which variant
 * is emitted (changing it recompiles, like loop counts on built-ins).
 */
export interface UserNodeIterations {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** Iteration count (as a string key) → complete GLSL function named `${fnName}_i${count}`. */
  functions: Record<string, string>;
}

export interface UserNodeSource {
  kind: 'subgraph';
  subgraph: SubgraphData;
  iterations: number;
}

export interface UserNodeDefinition {
  /** Unique id; doubles as the registry `type` key. Format: `un_<slug>_<base36 time>`. */
  id: string;
  label: string;
  category: string;
  description?: string;
  inputs: UserNodePort[];
  outputs: UserNodePort[];
  params: UserNodeParam[];
  /** Name of the emitted GLSL function (unique per definition). */
  fnName: string;
  /** The flattened GLSL function, complete. */
  functionCode: string;
  /** Helper blocks the function body depends on (captured from the source nodes). */
  helperFunctions: string[];
  /** main()-scope variables the body references that must be passed in as
   *  leading hidden arguments (today only `g_uv`). */
  implicitGlobals: string[];
  /** Present when the iteration count is exposed as a slider; `functionCode` is then the default count's variant. */
  iterations?: UserNodeIterations;
  /** Kept so the node can be re-opened in the builder. Not used by the compiler. */
  source?: UserNodeSource;
  version: 1;
  savedAt: number;
}

/** Shape of the JSON export file for user nodes. */
export interface UserNodeExport {
  version: 1;
  nodes: UserNodeDefinition[];
}

export const USER_NODE_DEFAULT_CATEGORY = 'My Nodes';
