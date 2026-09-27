import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';

/**
 * Columns on Grid and Grid Pattern: how many cells across the width.
 *
 * Before version 2 both nodes drew twice the count they were set to. The UV
 * they read runs from −aspect to +aspect across the picture (2 × aspect wide)
 * but the cell was aspect / Columns, so Columns 4 drew 8 cells across. Version
 * 2 makes the cell 2 × aspect / Columns.
 *
 * Graphs saved before that keep their pictures because loading doubles every
 * value that sets the count (see migrateNodeParams in types/nodeGraph.ts and
 * store/migratePlay.ts):
 *   - the Columns param, and its keyframes;
 *   - a group's override of an inner node's Columns;
 *   - Play controls on Columns (min, max and step), the output range of
 *     mappings into those controls, and recorded takes of them.
 * A Columns input driven by a wire can't be doubled by value (the wire may
 * come from a Constant used elsewhere, a Time chain, a group port…). Those
 * nodes get LEGACY_COLUMNS_WIRE instead, and the compiled code doubles the
 * wired value. Wiring something new into Columns clears the flag, since the
 * new wire is chosen against the new meaning.
 *
 * Nodes made since carry `_schemaVersion: 2` from defaultParams, so the
 * migration never touches them.
 */
export const GRID_COLUMNS_VERSION = 2;
export const LEGACY_COLUMNS_WIRE = '__legacyColumnsWire';

/** Version, migration hooks and the version stamp for a node whose Columns default was `oldDefault`. */
export function gridColumnsMigration(oldDefault: number): Pick<NodeDefinition, 'version' | 'migrateParams' | 'migrateParamValue'> {
  const scale = (key: string, value: unknown, fromVersion: number): unknown =>
    key === 'columns' && fromVersion < GRID_COLUMNS_VERSION && typeof value === 'number' ? value * 2 : value;
  return {
    version: GRID_COLUMNS_VERSION,
    migrateParamValue: scale,
    migrateParams: (params, fromVersion, node) => {
      if (fromVersion >= GRID_COLUMNS_VERSION) return params;
      const out = { ...params };
      // A node saved without the param drew the old default.
      out.columns = scale('columns', typeof out.columns === 'number' ? out.columns : oldDefault, fromVersion);
      const kf = out.__keyframes_columns;
      if (Array.isArray(kf)) {
        out.__keyframes_columns = kf.map(k => (k && typeof k === 'object' && typeof (k as { v?: unknown }).v === 'number'
          ? { ...k, v: (k as { v: number }).v * 2 } : k));
      }
      if (node?.inputs?.columns?.connection) out[LEGACY_COLUMNS_WIRE] = true;
      return out;
    },
  };
}

/**
 * The Columns count as GLSL: the wire, the keyframes or the param. A wire
 * into a node saved before version 2 is doubled (see LEGACY_COLUMNS_WIRE).
 */
export function columnsExpr(node: GraphNode, wired: string | undefined, fallback: number): string {
  if (!wired) return p(node.params.columns, fallback);
  return node.params[LEGACY_COLUMNS_WIRE] === true && node.inputs.columns?.connection ? `(2.0 * ${wired})` : wired;
}

/** The node with LEGACY_COLUMNS_WIRE dropped when `inputKey` is its Columns input (a new wire there is in the new units). */
export function clearLegacyColumnsWire(node: GraphNode, inputKey: string): GraphNode {
  if (inputKey !== 'columns' || node.params[LEGACY_COLUMNS_WIRE] === undefined) return node;
  const params = { ...node.params };
  delete params[LEGACY_COLUMNS_WIRE];
  return { ...node, params };
}
