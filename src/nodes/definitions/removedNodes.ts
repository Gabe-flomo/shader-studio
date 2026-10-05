/**
 * Node types that have been taken out of the app. A saved graph can still
 * hold one: it loads, its card says what happened, and the compile error
 * names the node and its replacement instead of "Unknown node type".
 */

/** Removed type → its old label, and what to use instead (if anything does the same job). */
export const REMOVED_NODE_TYPES: Record<string, { label: string; use?: string }> = {
  // The old particle systems (Particles, gpuParticles, replaces them all).
  particleEmitter: { label: 'Particle Emitter', use: 'Particles' },
  vParticles: { label: 'Particle System', use: 'Particles' },
  pInit: { label: 'P: Init', use: 'Particles' },
  pRotate: { label: 'P: Rotate', use: 'Particles' },
  pWave: { label: 'P: Wave', use: 'Particles' },
  pColorDist: { label: 'P: Color by Distance', use: 'Particles' },
  pSize: { label: 'P: Size', use: 'Particles' },
  pRender: { label: 'P: Render', use: 'Particles' },
  // Removed 2026-10 with no example or lesson using them.
  glowFalloff: { label: 'Glow Falloff', use: 'Distance Falloff' },
  mandelboxDE: { label: 'Mandelbox DE' },
  kifsTetra: { label: 'KIFS Tetrahedron DE' },
  mengerSponge: { label: 'Menger Sponge' },
  chladni3d: { label: 'Chladni 3D', use: 'Chladni Plate' },
  chladni3dParticles: { label: 'Chladni 3D Particles', use: 'Chladni Plate' },
  electronOrbital: { label: 'Electron Orbital' },
  orbitalVolume3d: { label: 'Orbital 3D' },
  printFloat: { label: 'Print Float' },
  printText: { label: 'Print Text' },
};

/**
 * "Particle Emitter was removed — use the Particles node" ("Menger Sponge was
 * removed" when nothing replaces it), or null for a type that wasn't removed.
 */
export function removedNodeMessage(type: string): string | null {
  const r = Object.prototype.hasOwnProperty.call(REMOVED_NODE_TYPES, type) ? REMOVED_NODE_TYPES[type] : null;
  if (!r) return null;
  return r.use ? `${r.label} was removed — use the ${r.use} node` : `${r.label} was removed`;
}
