/**
 * Node types that have been taken out of the app. A saved graph can still
 * hold one: it loads, its card says what happened, and the compile error
 * names the node and its replacement instead of "Unknown node type".
 */

/** Removed type → its old label, and what to use instead. */
export const REMOVED_NODE_TYPES: Record<string, { label: string; use: string }> = {
  // The old particle systems (Particles, gpuParticles, replaces them all).
  particleEmitter: { label: 'Particle Emitter', use: 'Particles' },
  vParticles: { label: 'Particle System', use: 'Particles' },
  pInit: { label: 'P: Init', use: 'Particles' },
  pRotate: { label: 'P: Rotate', use: 'Particles' },
  pWave: { label: 'P: Wave', use: 'Particles' },
  pColorDist: { label: 'P: Color by Distance', use: 'Particles' },
  pSize: { label: 'P: Size', use: 'Particles' },
  pRender: { label: 'P: Render', use: 'Particles' },
};

/** "Particle Emitter was removed — use the Particles node", or null for a type that wasn't removed. */
export function removedNodeMessage(type: string): string | null {
  const r = Object.prototype.hasOwnProperty.call(REMOVED_NODE_TYPES, type) ? REMOVED_NODE_TYPES[type] : null;
  return r ? `${r.label} was removed — use the ${r.use} node` : null;
}
