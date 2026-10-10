/**
 * groupPorts.ts — one model of a group card's sockets, for every group-like
 * node (Group, Scene Group, Space Warp Group, March Loop / GI Lit March Group,
 * Agents). Each socket is either *built in* (the node type always has it: a
 * March Loop's Ray Origin, a Scene Group's Scene, an Agents group's Emit) or
 * *added* by the user (a Group's own ports, an input added to a loop or an
 * Agents group from outside). Built-in sockets show a lock and can't be renamed
 * or removed; added ones show their type and can be renamed and removed, the
 * same way on every group (components/NodeGraph/GroupPorts.tsx).
 *
 * Added ports live in one of two places, which decides the store action that
 * renames or removes them:
 *   - 'port':  the subgraph's inputPorts / outputPorts (Group, Scene Group…),
 *   - 'extra': an input added through the group's inner inputs card
 *              (March Loop's Group Inputs, Agents' Agent Inputs: params.extraInputs).
 *
 * Pure: no React, no store.
 */

import type { DataType, GraphNode, NodeDefinition, SubgraphData } from '../types/nodeGraph';
import { MARCH_GROUP_TYPES } from './smart3d';

export type PortOrigin = 'built-in' | 'added';

export interface GroupPort {
  key: string;
  type: string;
  label: string;
  dir: 'in' | 'out';
  origin: PortOrigin;
  /** For an added port: where it is stored (see the header). */
  store?: 'port' | 'extra';
}

/** The inner card that holds a group's added inputs (params.extraInputs). */
export const EXTRA_INPUTS_CARD_TYPES = new Set(['marchLoopInputs', 'agentInputs']);

/** Types an added port can carry, per group, in the order the Add form offers them. */
export const ADDABLE_PORT_TYPES: Record<string, readonly DataType[]> = {
  group: ['float', 'vec2', 'vec3', 'vec4', 'texture'],
  groupOutput: ['float', 'vec2', 'vec3', 'vec4'],
  marchLoopGroup: ['float', 'vec2', 'vec3', 'vec4', 'texture'],
  agentsGroup: ['float', 'vec2', 'vec3', 'vec4', 'texture', 'scene3d'],
};

/** A port type in words, for an added port's label and the Add form's choices. */
export const PORT_TYPE_WORDS: Record<string, string> = {
  float: 'number', vec2: 'x, y', vec3: 'colour / xyz', vec4: '4 numbers', texture: 'image', scene3d: '3D scene',
  mat2: '2×2 matrix', mat3: '3×3 matrix', spacewarp3d: 'space warp',
};
export const PORT_TYPE_CHOICES: Record<string, string> = {
  float: 'Number', vec2: 'x, y', vec3: 'Colour', vec4: '4', texture: 'Image', scene3d: 'Scene',
};

type Extra = { key: string; type: string; label: string };

function extraInputsOf(node: GraphNode): Extra[] {
  const sub = node.params.subgraph as SubgraphData | undefined;
  const card = sub?.nodes.find(n => EXTRA_INPUTS_CARD_TYPES.has(n.type));
  return (card?.params.extraInputs ?? []) as Extra[];
}

/**
 * A group card's sockets, built-in first, in the order the card draws them.
 * Surfaced inner params (`ps_…`) are not ports: the card draws them as sliders.
 */
export function groupCardPorts(node: GraphNode, def: NodeDefinition | null | undefined): { inputs: GroupPort[]; outputs: GroupPort[] } {
  const sub = node.params.subgraph as SubgraphData | undefined;
  const inputs: GroupPort[] = [];
  const outputs: GroupPort[] = [];
  const defIns = def?.inputs ?? {};
  const defOuts = def?.outputs ?? {};
  const extras = new Map(extraInputsOf(node).map(e => [e.key, e]));
  const portKeys = new Set((sub?.inputPorts ?? []).map(p => p.key));

  // Built-in inputs (what the definition declares), then inputs added from outside the loop / Agents group.
  if (MARCH_GROUP_TYPES.has(node.type) || node.type === 'agentsGroup') {
    for (const [key, input] of Object.entries(node.inputs)) {
      if (key.startsWith('ps_') || portKeys.has(key)) continue;
      if (key in defIns) inputs.push({ key, type: input.type, label: input.label, dir: 'in', origin: 'built-in' });
      else inputs.push({ key, type: input.type, label: extras.get(key)?.label ?? input.label, dir: 'in', origin: 'added', store: 'extra' });
    }
  }
  for (const p of sub?.inputPorts ?? []) inputs.push({ key: p.key, type: p.type, label: p.label, dir: 'in', origin: 'added', store: 'port' });

  if (MARCH_GROUP_TYPES.has(node.type)) {
    // The definition's outputs and the loop's accumulators (acc0, acc1… made at compile time), less the hidden ones.
    const dyn = Object.fromEntries(Object.entries(node.outputs).filter(([k]) => k.startsWith('acc')));
    const hidden = (node.params.hiddenOutputs as string[] | undefined) ?? [];
    for (const [key, o] of Object.entries({ ...defOuts, ...dyn })) {
      if (!hidden.includes(key)) outputs.push({ key, type: o.type, label: o.label, dir: 'out', origin: 'built-in' });
    }
  } else if (node.type === 'sceneGroup') {
    outputs.push({ key: 'scene', type: 'scene3d', label: defOuts.scene?.label ?? 'Scene', dir: 'out', origin: 'built-in' });
  } else if (node.type === 'agentsGroup') {
    for (const [key, o] of Object.entries(node.outputs)) outputs.push({ key, type: o.type, label: o.label, dir: 'out', origin: key in defOuts ? 'built-in' : 'added' });
  }
  for (const p of sub?.outputPorts ?? []) outputs.push({ key: p.key, type: p.type, label: p.label, dir: 'out', origin: 'added', store: 'port' });
  return { inputs, outputs };
}

/**
 * A key for a port added by name: letters, digits and _ (it becomes part of a GLSL
 * name), starting with a letter, and not one the group already has.
 */
export function portKeyFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = name.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[A-Za-z]/.test(base)) base = base ? `in_${base}` : 'in';
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}${i}`;
  return key;
}

/** Which Add form a group offers: input types, and whether outputs can be added. */
export function groupAddable(groupType: string): { inputs: readonly DataType[] | null; outputs: readonly DataType[] | null } {
  if (groupType === 'group') return { inputs: ADDABLE_PORT_TYPES.group, outputs: ADDABLE_PORT_TYPES.groupOutput };
  if (MARCH_GROUP_TYPES.has(groupType)) return { inputs: ADDABLE_PORT_TYPES.marchLoopGroup, outputs: null };
  if (groupType === 'agentsGroup') return { inputs: ADDABLE_PORT_TYPES.agentsGroup, outputs: null };
  return { inputs: null, outputs: null };
}
