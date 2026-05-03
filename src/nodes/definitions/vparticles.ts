import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';

// ── Vertex Particle System ─────────────────────────────────────────────────────
// This node is special: it produces NO GLSL output for the fragment shader.
// Instead, shaderAssembler.ts detects it and populates CompilationResult.particleSystems
// so ShaderCanvas can spin up a THREE.Points particle system with CPU simulation.

export const VertexParticleSystemNode: NodeDefinition = {
  type: 'vParticles',
  label: 'Particle System',
  category: 'Particles',
  deprecated: true,
  description: 'Replaced by the P: Init → P: Render pipeline nodes.',
  inputs: {},
  outputs: {},
  defaultParams: {
    count:        500,
    emitRate:     60,
    lifetime:     2.5,
    initialSpeed: 0.25,
    gravity:      -0.15,
    turbulence:   0.08,
    spread:       0.3,
    emitX:        0.5,
    emitY:        0.2,
    particleSize: 6,
    colorStartR:  1.0,
    colorStartG:  0.6,
    colorStartB:  0.2,
    colorEndR:    0.8,
    colorEndG:    0.1,
    colorEndB:    0.8,
  },
  paramDefs: {
    count:        { label: 'Max Particles', type: 'int',   min: 10,   max: 5000, step: 10 },
    emitRate:     { label: 'Emit Rate/s',   type: 'float', min: 1,    max: 500,  step: 1 },
    lifetime:     { label: 'Lifetime (s)',  type: 'float', min: 0.1,  max: 10,   step: 0.1 },
    initialSpeed: { label: 'Speed',         type: 'float', min: 0,    max: 2,    step: 0.01 },
    gravity:      { label: 'Gravity',       type: 'float', min: -2,   max: 2,    step: 0.01 },
    turbulence:   { label: 'Turbulence',    type: 'float', min: 0,    max: 1,    step: 0.01 },
    spread:       { label: 'Spread',        type: 'float', min: 0,    max: 1,    step: 0.01 },
    emitX:        { label: 'Emit X',        type: 'float', min: 0,    max: 1,    step: 0.01 },
    emitY:        { label: 'Emit Y',        type: 'float', min: 0,    max: 1,    step: 0.01 },
    particleSize: { label: 'Point Size',    type: 'float', min: 1,    max: 64,   step: 0.5 },
    colorStartR:  { label: 'Start R',       type: 'float', min: 0,    max: 1,    step: 0.01 },
    colorStartG:  { label: 'Start G',       type: 'float', min: 0,    max: 1,    step: 0.01 },
    colorStartB:  { label: 'Start B',       type: 'float', min: 0,    max: 1,    step: 0.01 },
    colorEndR:    { label: 'End R',         type: 'float', min: 0,    max: 1,    step: 0.01 },
    colorEndG:    { label: 'End G',         type: 'float', min: 0,    max: 1,    step: 0.01 },
    colorEndB:    { label: 'End B',         type: 'float', min: 0,    max: 1,    step: 0.01 },
  },
  generateGLSL: (_node: GraphNode, _inputVars) => {
    return { code: '', outputVars: {} };
  },
};
