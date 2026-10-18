/**
 * Value at point (docs/value-at-point.md): one number from a value that differs pixel to pixel, read exactly at a
 * point, the same everywhere. An SDF's distance, a noise, a mask: each is a different number at every pixel, so wiring
 * one into Text (or anything that needs a single number) gives each pixel its own. This node gives the one at Point.
 *
 * compiler/probeExpand.ts draws every Value at point into one shared tiny Pass (`__probe`, a full-float texel each)
 * whose program pins the picture coordinate (`g_uv`) to that node's Point, so everything upstream is worked out there;
 * the node is replaced by a read of its texel. Text uses one automatically for a wired Value (its Value at: Text).
 */
import type { NodeDefinition } from '../../types/nodeGraph';

export const PROBE_TYPE = 'probe';
export const PROBE_PACK_TYPE = 'probePack';
export const PROBE_READ_TYPE = 'probeRead';

export const ProbeNode: NodeDefinition = {
  type: PROBE_TYPE,
  label: 'Value at Point',
  category: 'Utility',
  aliases: ['Value at point', 'Probe', 'Sample at point', 'Read pixel', 'Single value', 'Freeze across pixels', 'Value here', 'Pick value'],
  description: 'Turns a value that changes from pixel to pixel (an SDF\'s distance, a noise, a mask) into one number, the same everywhere: the value at Point, read exactly. Use it before Text, a memory node, or any setting that wants a single number.',
  inputs: {
    value: { type: 'float', label: 'Value', hint: 'Any float: it is worked out at Point, not at each pixel.' },
  },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'The value at Point: one number for the whole picture.' },
  },
  defaultParams: { pointX: 0, pointY: 0 },
  paramDefs: {
    pointX: { label: 'Point X', type: 'float', min: -2, max: 2, step: 0.001, compileTime: true, hint: 'Where to read it, across (picture coordinates: the centre is 0, the edges about ±1.8).' },
    pointY: { label: 'Point Y', type: 'float', min: -1, max: 1, step: 0.001, compileTime: true, hint: 'Where to read it, up (−1 bottom … 1 top).' },
  },
  // Not expanded (inside a group, or nothing wired): the value as it is.
  generateGLSL: (node, inputVars) => ({ code: `    float ${node.id}_v = ${inputVars.value ?? '0.0'};\n`, outputVars: { value: `${node.id}_v` } }),
};

/** Internal: the shared probe Pass's program: texel i is probe i's value (g_uv pinned to its point by the compiler). */
export const ProbePackNode: NodeDefinition = {
  type: PROBE_PACK_TYPE,
  label: 'Value at point step',
  category: 'Output',
  description: 'Internal: every Value at point, one texel each.',
  inputs: {},
  outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  defaultParams: {},
  assignable: false,
  generateGLSL: (node, inputVars) => {
    const n = Math.max(0, Number(node.params.__count) || 0);
    let expr = '0.0';
    for (let i = n - 1; i >= 0; i--) expr = `(${node.id}_i == ${i} ? ${inputVars[`v${i}`] ?? '0.0'} : ${expr})`;
    return {
      code: `    int ${node.id}_i = int(floor(gl_FragCoord.x));\n    float ${node.id}_o = ${expr};\n`,
      outputVars: { color: `vec3(${node.id}_o)`, alpha: '1.0' },
    };
  },
};

/** Internal: a Value at point's output, its texel of the probe Pass. */
export const ProbeReadNode: NodeDefinition = {
  type: PROBE_READ_TYPE,
  label: 'Value at point read',
  category: 'Output',
  description: 'Internal: a Value at point\'s number, from its texel.',
  inputs: { state: { type: 'texture', label: 'Values' } },
  outputs: { value: { type: 'float', label: 'Value' } },
  defaultParams: {},
  assignable: false,
  generateGLSL: (node, inputVars) => {
    const st = inputVars.state;
    const i = Math.max(0, Math.round(Number(node.params.index) || 0));
    return { code: `    float ${node.id}_v = ${st ? `texelFetch(${st}, ivec2(${i}, 0), 0).r` : '0.0'};\n`, outputVars: { value: `${node.id}_v` } };
  },
};
