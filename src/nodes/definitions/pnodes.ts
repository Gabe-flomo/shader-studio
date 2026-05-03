import type { NodeDefinition } from '../../types/nodeGraph';

// ── Particle Pipeline Nodes ────────────────────────────────────────────────────
// These nodes form a linear chain that compiles into a single THREE.Points
// vertex+fragment shader rendered with a perspective camera over the background.
//
// Wire: pInit → (pRotate?) → (pWave?) → (pColorDist?) → (pSize?) → pRender

// ── pInit ─────────────────────────────────────────────────────────────────────
export const PInitNode: NodeDefinition = {
  type: 'pInit',
  label: 'P: Init',
  category: 'Particles',
  description: 'Initialize particle positions on a 3D shape. The starting point of every particle pipeline. Connect to P: Rotate, P: Wave, or directly to P: Render.',
  inputs: {},
  outputs: { particles: { type: 'particle', label: 'Particles' } },
  defaultParams: { shape: 0, count: 3000, radius: 1.0 },
  paramDefs: {
    shape: { label: 'Shape', type: 'select', options: ['Sphere', 'Ball', 'Box', 'Disk', 'Ring', 'Spiral'] },
    count: { label: 'Count', type: 'int', min: 100, max: 10000, step: 100 },
    radius: { label: 'Radius', type: 'float', min: 0.1, max: 4.0, step: 0.05 },
  },
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

// ── pRotate ───────────────────────────────────────────────────────────────────
export const PRotateNode: NodeDefinition = {
  type: 'pRotate',
  label: 'P: Rotate',
  category: 'Particles',
  description: 'Rotate particles around an axis over time. Differential rotation makes inner particles spin faster than outer ones — creates a galaxy-like twist.',
  inputs: { particles: { type: 'particle', label: 'Particles' } },
  outputs: { particles: { type: 'particle', label: 'Particles' } },
  defaultParams: { axis: 1, rotSpeed: 0.3, rotVariance: 2.0, twirl: 0.0 },
  paramDefs: {
    axis:        { label: 'Axis',          type: 'select', options: ['X', 'Y', 'Z'] },
    rotSpeed:    { label: 'Speed',         type: 'float', min: -3.0, max: 3.0, step: 0.01 },
    rotVariance: { label: 'Differential',  type: 'float', min: 0.0, max: 6.0, step: 0.05 },
    twirl:       { label: 'Twirl',         type: 'float', min: -5.0, max: 5.0, step: 0.05 },
  },
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

// ── pWave ─────────────────────────────────────────────────────────────────────
export const PWaveNode: NodeDefinition = {
  type: 'pWave',
  label: 'P: Wave',
  category: 'Particles',
  description: 'Oscillate particle positions over time along a chosen axis — radial (breathe), Y (ripple), or tangential (swirl).',
  inputs: { particles: { type: 'particle', label: 'Particles' } },
  outputs: { particles: { type: 'particle', label: 'Particles' } },
  defaultParams: { waveAmp: 0.08, waveFreq: 3.0, waveSpeed: 2.0, waveAxis: 0 },
  paramDefs: {
    waveAmp:   { label: 'Amplitude',  type: 'float', min: 0.0, max: 1.0, step: 0.005 },
    waveFreq:  { label: 'Frequency',  type: 'float', min: 0.1, max: 20.0, step: 0.1 },
    waveSpeed: { label: 'Speed',      type: 'float', min: -5.0, max: 5.0, step: 0.1 },
    waveAxis:  { label: 'Wave Mode',  type: 'select', options: ['Radial', 'Y-Axis', 'Tangential'] },
  },
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

// ── pColorDist ────────────────────────────────────────────────────────────────
export const PColorDistNode: NodeDefinition = {
  type: 'pColorDist',
  label: 'P: Color by Distance',
  category: 'Particles',
  description: 'Color particles by their distance from the emitter center. Inner particles get colorCenter, outer particles get colorEdge. Mix Bias controls the transition curve.',
  inputs: { particles: { type: 'particle', label: 'Particles' } },
  outputs: { particles: { type: 'particle', label: 'Particles' } },
  defaultParams: {
    colorCenterR: 0.97, colorCenterG: 0.70, colorCenterB: 0.45,
    colorEdgeR: 0.34, colorEdgeG: 0.53, colorEdgeB: 0.96,
    mixPow: 0.5,
  },
  paramDefs: {
    colorCenterR: { label: 'Center R', type: 'float', min: 0, max: 1, step: 0.01 },
    colorCenterG: { label: 'Center G', type: 'float', min: 0, max: 1, step: 0.01 },
    colorCenterB: { label: 'Center B', type: 'float', min: 0, max: 1, step: 0.01 },
    colorEdgeR:   { label: 'Edge R',   type: 'float', min: 0, max: 1, step: 0.01 },
    colorEdgeG:   { label: 'Edge G',   type: 'float', min: 0, max: 1, step: 0.01 },
    colorEdgeB:   { label: 'Edge B',   type: 'float', min: 0, max: 1, step: 0.01 },
    mixPow:       { label: 'Mix Bias', type: 'float', min: 0.1, max: 2.0, step: 0.05 },
  },
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

// ── pSize ─────────────────────────────────────────────────────────────────────
export const PSizeNode: NodeDefinition = {
  type: 'pSize',
  label: 'P: Size',
  category: 'Particles',
  description: 'Control particle point size. Perspective Attenuation makes distant particles appear smaller (realistic). Size × Distance scales size with distance factor — inner particles bigger if positive.',
  inputs: { particles: { type: 'particle', label: 'Particles' } },
  outputs: { particles: { type: 'particle', label: 'Particles' } },
  defaultParams: { sizeBase: 10.0, sizeByDist: 10.0, sizeAttenuation: 1 },
  paramDefs: {
    sizeBase:        { label: 'Base Size',              type: 'float', min: 0.5, max: 64.0, step: 0.5 },
    sizeByDist:      { label: 'Size × Distance Factor', type: 'float', min: 0.0, max: 30.0, step: 0.5 },
    sizeAttenuation: { label: 'Perspective Attenuation', type: 'bool' },
  },
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

// ── pRender ───────────────────────────────────────────────────────────────────
export const PRenderNode: NodeDefinition = {
  type: 'pRender',
  label: 'P: Render',
  category: 'Particles',
  description: 'Terminal node: renders the particle pipeline as an additive 3D point cloud over the shader output. Softness controls how soft the particle circle edges are.',
  inputs: { particles: { type: 'particle', label: 'Particles' } },
  outputs: {},
  defaultParams: { opacity: 1.0, softness: 3.0 },
  paramDefs: {
    opacity:  { label: 'Opacity',  type: 'float', min: 0.0, max: 1.0, step: 0.01 },
    softness: { label: 'Softness', type: 'float', min: 0.5, max: 8.0, step: 0.1 },
  },
  generateGLSL: () => ({ code: '', outputVars: {} }),
};
