import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { MIDI_FIXED_OUTPUTS, midiCcList, midiCcKey, midiUniformName, midiOutputSockets } from '../../lib/midiOutputs';

/**
 * MIDI Input — a Sources node whose outputs are floats written every frame by
 * the input bus (see lib/inputBus.ts and lib/midiEngine.ts). In GLSL each
 * output is just a `u_midi_<slug>_<key>` uniform; the assembler declares them
 * from `midiOutputKeys(node.params)` and maps each back to `${nodeId}::${key}`
 * so the engine never needs to know the slug.
 *
 * `channel` and `smooth_ms` are read by the JS engine, so the type is in
 * SKIP_UNIFORM_TYPES (a change is a param edit + recompile, like Audio Input).
 * `_ccs` is the list of CC numbers exposed as extra outputs; the card rebuilds
 * the node's output sockets when it changes.
 */
export const MidiInputNode: NodeDefinition = {
  type: 'midiInput',
  label: 'MIDI Input',
  category: 'Sources',
  description: 'Turn a MIDI controller (or the computer keyboard) into floats: last note, velocity, gate, pitch bend and any CC knobs you add. All outputs are 0–1 except pitch bend (−1..1).',
  aliases: ['MIDI', 'Controller', 'Keyboard Input'],
  inputs: {},
  outputs: midiOutputSockets(undefined),
  defaultParams: {
    channel: 'all',
    smooth_ms: 20,
    _ccs: [1],
  },
  paramDefs: {
    channel: { label: 'Channel', type: 'select', options: [
      { value: 'all', label: 'All' },
      ...Array.from({ length: 16 }, (_, i) => ({ value: `${i + 1}`, label: `${i + 1}` })),
    ]},
    smooth_ms: { label: 'Smoothing (ms)', type: 'float', min: 0, max: 500, step: 1 },
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    const lines: string[] = [];
    const outputVars: Record<string, string> = {};
    for (const { key } of MIDI_FIXED_OUTPUTS) {
      const v = `${id}_${key}`;
      lines.push(`    float ${v} = ${midiUniformName(id, key)};\n`);
      outputVars[key] = v;
    }
    for (const cc of midiCcList(node.params)) {
      const key = midiCcKey(cc);
      const v = `${id}_${key}`;
      lines.push(`    float ${v} = ${midiUniformName(id, key)};\n`);
      outputVars[key] = v;
    }
    return { code: lines.join(''), outputVars };
  },
};
