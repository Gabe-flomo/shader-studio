/**
 * Send and Receive (docs/send-receive.md): a wireless link, like TouchDesigner's Select or Houdini's
 * Object Merge. A Send passes its Value through under a Name; a Receive anywhere in the graph (inside
 * any plain group or Agents group, at any depth) gives back that Send's Value.
 *
 * Neither node does anything clever in GLSL. Before the compile, compiler/sendReceive.ts turns each
 * Receive into a real wire: it gives the Receive a hidden `__via` input and routes it to the Send
 * through group ports it adds on the fly, so ordering, dead-code removal and types work as for a wire.
 *
 * A Receive stores the Send's node id (`sendId`), so renaming the Send just works. `name` is the
 * Send's name as last seen, kept so a Receive whose Send was deleted can say what it was reading.
 *
 * Both nodes take their type from what they carry: a Send from the wire into it, a Receive from its
 * Send (syncSendReceiveTypes, run before every compile and when a graph loads).
 */
import type { DataType, GraphNode, NodeDefinition } from '../../types/nodeGraph';

export const SEND_TYPE = 'send';
export const RECEIVE_TYPE = 'receive';
/** The hidden input the compile wires a Receive through. Never stored. */
export const RECEIVE_VIA = '__via';

/** What a Send can carry. */
export const SEND_CARRIES: ReadonlySet<string> = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'texture']);

function zeroOf(t: string): string {
  if (t === 'float') return '0.0';
  return `${t}(0.0)`;
}

/** Copy a value through as type `t`: a texture is a sampler's name, so it is passed on as is (or left out: black). */
function passThrough(node: GraphNode, t: DataType | string, v: string | undefined): { code: string; outputVars: Record<string, string> } {
  if (t === 'texture') return { code: '', outputVars: v ? { value: v } : {} };
  return { code: `    ${t} ${node.id}_value = ${v || zeroOf(t)};\n`, outputVars: { value: `${node.id}_value` } };
}

export const SendNode: NodeDefinition = {
  type: SEND_TYPE,
  label: 'Send',
  aliases: ['Wireless', 'Null', 'Broadcast', 'Transmit'],
  category: 'Utility',
  description: 'Shares its Value under a Name, without a wire. Any Receive in the graph, inside a group or not, can pick this Send and gets the same Value. The Value also comes straight out, so a Send can sit in the middle of a chain. Carries a number, a vector or a texture: it takes the type of whatever is wired in.',
  inputs: { value: { type: 'float', label: 'Value', hint: 'What to share. Any number, vector or texture.' } },
  outputs: { value: { type: 'float', label: 'Value', hint: 'The Value, unchanged.' } },
  defaultParams: { name: 'signal' },
  paramDefs: {
    name: { label: 'Name', type: 'string', hint: 'What the Receives list this Send as. Give each Send its own Name.' },
  },
  assignable: false,
  generateGLSL: (node, inputVars) => passThrough(node, node.outputs?.value?.type ?? 'float', inputVars.value),
};

export const ReceiveNode: NodeDefinition = {
  type: RECEIVE_TYPE,
  label: 'Receive',
  aliases: ['Wireless in', 'Select', 'Object Merge', 'Listen'],
  category: 'Utility',
  description: 'Gives the Value of a Send picked by its Name, from anywhere in the graph: the top level, inside a group or inside another group, with no wire and no group ports. The Value takes the Send\'s type. With no Send picked (or the Send deleted) the Value is zero, or black for a texture.',
  inputs: {},
  outputs: { value: { type: 'float', label: 'Value', hint: 'The picked Send\'s Value.' } },
  defaultParams: { sendId: '', name: '' },
  assignable: false,
  generateGLSL: (node, inputVars) => passThrough(node, node.outputs?.value?.type ?? 'float', inputVars[RECEIVE_VIA]),
};
