/**
 * userNodeRegistry.ts — runtime registry of user-published node types.
 *
 * The built-in NODE_REGISTRY is a static literal. This module layers a
 * mutable set of definitions on top: `getNodeDefinition` in
 * nodes/definitions/index.ts falls through to `getUserNodeDefinition`, so the
 * compiler, store, palettes and validation see user nodes exactly like
 * built-ins. UI that lists node types subscribes through `subscribeUserNodes`
 * (or the `useUserNodesVersion` hook) because the set can change at runtime.
 *
 * Persistence is localStorage under `shader-studio:un:<id>` via PresetManager,
 * so it also picks up the optional disk-folder sync and the change event.
 * Storage access is guarded so the module loads in tests (no DOM).
 */

import type { NodeDefinition, InputSocket, OutputSocket, ParamDef, GraphNode } from '../../types/nodeGraph';
import type { UserNodeDefinition, UserNodeExport } from '../../types/userNode';
import { PresetManager } from '../../store/managers/PresetManager';
import type { FileResult } from '../../utils/fileIO';
import { p } from '../definitions/helpers';

export const USER_NODE_PREFIX = 'shader-studio:un:';
export const USER_NODE_CHANGED_EVENT = 'usernode-changed';

const hasStorage = () => typeof localStorage !== 'undefined' && typeof window !== 'undefined';

const manager = new PresetManager<UserNodeDefinition>({ localStoragePrefix: USER_NODE_PREFIX, eventName: USER_NODE_CHANGED_EVENT });

const defs = new Map<string, UserNodeDefinition>();
const compiled = new Map<string, NodeDefinition>();
const listeners = new Set<() => void>();
let version = 0;
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (!hasStorage()) return;
  for (const def of manager.load()) {
    if (isValidDefinition(def)) {
      defs.set(def.id, def);
      compiled.set(def.id, userNodeToDefinition(def));
    }
  }
}

function notify(): void {
  version++;
  for (const l of listeners) l();
}

function isValidDefinition(d: unknown): d is UserNodeDefinition {
  if (!d || typeof d !== 'object') return false;
  const x = d as Partial<UserNodeDefinition>;
  return typeof x.id === 'string' && typeof x.label === 'string' && typeof x.fnName === 'string'
    && typeof x.functionCode === 'string' && Array.isArray(x.inputs) && Array.isArray(x.outputs) && Array.isArray(x.params);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getUserNodeDefinition(type: string): NodeDefinition | undefined {
  ensureLoaded();
  return compiled.get(type);
}

export function getUserNode(id: string): UserNodeDefinition | undefined {
  ensureLoaded();
  return defs.get(id);
}

export function getAllUserNodes(): UserNodeDefinition[] {
  ensureLoaded();
  return Array.from(defs.values()).sort((a, b) => b.savedAt - a.savedAt);
}

export function getAllUserNodeDefinitions(): NodeDefinition[] {
  ensureLoaded();
  return Array.from(compiled.values());
}

/** Register (or replace) a definition. Persists when storage is available. */
export async function registerUserNode(def: UserNodeDefinition, { persist = true }: { persist?: boolean } = {}): Promise<FileResult> {
  ensureLoaded();
  defs.set(def.id, def);
  compiled.set(def.id, userNodeToDefinition(def));
  notify();
  if (persist && hasStorage()) return manager.save(def);
  return { ok: true };
}

export function unregisterUserNode(id: string): void {
  ensureLoaded();
  defs.delete(id);
  compiled.delete(id);
  if (hasStorage()) manager.delete(id);
  notify();
}

export function subscribeUserNodes(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getUserNodesVersion(): number {
  return version;
}

/** Test helper: forget everything without touching storage. */
export function resetUserNodesForTests(): void {
  defs.clear();
  compiled.clear();
  loaded = true;
  notify();
}

// ── Sharing ───────────────────────────────────────────────────────────────────
// A node definition is self-contained GLSL plus metadata, so a file exported
// from one project works in any other copy of Shader Studio. The source
// subgraph travels with it so the recipient can open and re-publish it.

export function exportUserNodes(ids?: string[]): UserNodeExport {
  ensureLoaded();
  const nodes = (ids ? ids.map(id => defs.get(id)).filter((d): d is UserNodeDefinition => !!d) : getAllUserNodes());
  return { version: 1, nodes };
}

export interface ImportUserNodesResult {
  ok: boolean;
  imported: string[];
  /** Definitions that already existed and were replaced (same id). */
  replaced: string[];
  error?: string;
}

/**
 * Import one or more definitions from JSON: either an export file
 * (`{ version: 1, nodes: [...] }`) or a bare definition object. A definition
 * with an id that already exists replaces it — ids embed a timestamp, so a
 * collision means the same node being shared again, and updating is what
 * the sender intends.
 */
export async function importUserNodes(json: string): Promise<ImportUserNodesResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, imported: [], replaced: [], error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const candidates: unknown[] = Array.isArray((parsed as UserNodeExport)?.nodes)
    ? (parsed as UserNodeExport).nodes
    : Array.isArray(parsed) ? parsed : [parsed];
  const valid = candidates.filter(isValidDefinition);
  if (valid.length === 0) {
    return { ok: false, imported: [], replaced: [], error: 'The file has no node definitions in it. Export one from the Presets tab (My nodes) or a node’s info card.' };
  }
  ensureLoaded();
  const imported: string[] = [];
  const replaced: string[] = [];
  for (const def of valid) {
    (defs.has(def.id) ? replaced : imported).push(def.label);
    const r = await registerUserNode({ ...def, savedAt: Date.now() });
    if (!r.ok) return { ok: false, imported, replaced, error: r.error };
  }
  return { ok: true, imported, replaced };
}

/** `un_<label slug>_<base36 time>` — unique, and readable in the emitted GLSL. */
export function makeUserNodeId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'node';
  return `un_${slug}_${Date.now().toString(36)}`;
}

// ── Adapter: UserNodeDefinition → NodeDefinition ─────────────────────────────

function zeroFor(type: string): string {
  switch (type) {
    case 'vec2': return 'vec2(0.0)';
    case 'vec3': return 'vec3(0.0)';
    case 'vec4': return 'vec4(0.0)';
    case 'mat2': return 'mat2(1.0)';
    case 'mat3': return 'mat3(1.0)';
    default: return '0.0';
  }
}

/**
 * Build the registry-facing definition. Every instance emits one call to the
 * flattened function. Inputs with a slider double as params (same key), which
 * is the built-in convention for "slider when unconnected, wire when
 * connected"; live params are plain float paramDefs, so the uniform patcher
 * turns them into per-instance `u_p_*` uniforms automatically.
 */
export function userNodeToDefinition(def: UserNodeDefinition): NodeDefinition {
  const inputs: Record<string, InputSocket> = {};
  const outputs: Record<string, OutputSocket> = {};
  const paramDefs: Record<string, ParamDef> = {};
  const defaultParams: Record<string, unknown> = {};

  for (const port of def.inputs) {
    inputs[port.key] = { type: port.type, label: port.label };
    if (port.slider && port.type === 'float') {
      paramDefs[port.key] = { label: port.label, type: 'float', min: port.slider.min, max: port.slider.max, step: port.slider.step ?? 0.01 };
      defaultParams[port.key] = port.slider.default;
    }
  }
  for (const out of def.outputs) outputs[out.key] = { type: out.type, label: out.label };
  for (const prm of def.params) {
    paramDefs[prm.key] = { label: prm.label, type: 'float', min: prm.min, max: prm.max, step: prm.step ?? 0.01, hint: prm.hint };
    defaultParams[prm.key] = prm.default;
  }

  const generateGLSL = (node: GraphNode, inputVars: Record<string, string>) => {
    const args: string[] = [...def.implicitGlobals];
    for (const port of def.inputs) {
      const wired = inputVars[port.key];
      if (wired) args.push(wired);
      else if (port.slider && port.type === 'float') args.push(p(node.params[port.key], port.slider.default));
      else args.push(zeroFor(port.type));
    }
    for (const prm of def.params) args.push(p(node.params[prm.key], prm.default));

    const outputVars: Record<string, string> = {};
    let code = '';
    const [primary, ...rest] = def.outputs;
    for (const o of rest) {
      const v = `${node.id}_${o.key}`;
      code += `    ${o.type} ${v};\n`;
      outputVars[o.key] = v;
      args.push(v);
    }
    const pv = `${node.id}_${primary.key}`;
    code += `    ${primary.type} ${pv} = ${def.fnName}(${args.join(', ')});\n`;
    outputVars[primary.key] = pv;
    return { code, outputVars };
  };

  return {
    type: def.id,
    label: def.label,
    category: def.category,
    description: def.description || `User node. ${def.inputs.length} input${def.inputs.length === 1 ? '' : 's'}, ${def.outputs.length} output${def.outputs.length === 1 ? '' : 's'}.`,
    inputs,
    outputs,
    defaultParams,
    paramDefs: Object.keys(paramDefs).length ? paramDefs : undefined,
    glslFunctions: [...def.helperFunctions, def.functionCode],
    generateGLSL,
  };
}
