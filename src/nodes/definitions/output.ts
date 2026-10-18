import type { NodeDefinition, GraphNode, ParamDef } from '../../types/nodeGraph';
import { p } from './helpers';

const OPACITY: ParamDef = {
  label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, literalAt: 1,
  hint: 'Multiplies the picture\'s alpha. Below 1 the picture is see-through where it is exported with its own alpha (Record → Transparent → Its own alpha); the preview stays opaque.',
};

/**
 * The opacity factor as GLSL, or null when it is a plain 1 (or absent: graphs saved before
 * Opacity existed), so those compile exactly as they did.
 */
function opacityOf(node: GraphNode): string | null {
  const v = node.params.opacity;
  if (v === undefined || v === 1) return null;
  return p(v, 1);
}

export const OutputNode: NodeDefinition = {
  type: 'output',
  label: 'Output',
  category: 'Output',
  description: 'Final colour of the shader, with its alpha: Color, an optional Alpha (1 when empty) and an Opacity that multiplies it. The alpha is what a transparent export keeps (Record → Transparent → Its own alpha).',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha', hint: 'How opaque each pixel is, 0–1. Empty: fully opaque. A transparent export with Its own alpha keeps it.' },
  },
  outputs: {},
  defaultParams: { opacity: 1 },
  paramDefs: { opacity: OPACITY },
  generateGLSL: (node: GraphNode, inputVars) => {
    const colorVar = inputVars.color || 'vec3(0.0)';
    const op = opacityOf(node);
    const alpha = inputVars.alpha ? `clamp(${inputVars.alpha}, 0.0, 1.0)` : null;
    const a = alpha && op ? `${alpha} * clamp(${op}, 0.0, 1.0)` : alpha ?? (op ? `clamp(${op}, 0.0, 1.0)` : '1.0');
    return {
      code: `    gl_FragColor = vec4(${colorVar}, ${a});\n`,
      outputVars: {},
    };
  },
};

export const Vec4OutputNode: NodeDefinition = {
  type: 'vec4Output',
  label: 'Output (RGBA)',
  category: 'Output',
  description: 'Final RGBA output. Passes a vec4 color (including alpha) directly to gl_FragColor, its alpha times Opacity. Use with nodes that produce a vec4, like Rotating Lines Loop. (The plain Output takes an Alpha too.)',
  inputs: {
    color: { type: 'vec4', label: 'Color (RGBA)' },
  },
  outputs: {},
  defaultParams: { opacity: 1 },
  paramDefs: { opacity: OPACITY },
  generateGLSL: (node: GraphNode, inputVars) => {
    const colorVar = inputVars.color || 'vec4(0.0, 0.0, 0.0, 1.0)';
    const op = opacityOf(node);
    return {
      code: op
        ? `    gl_FragColor = ${colorVar};\n    gl_FragColor.a *= clamp(${op}, 0.0, 1.0);\n`
        : `    gl_FragColor = ${colorVar};\n`,
      outputVars: {},
    };
  },
};
