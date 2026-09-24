/**
 * Naming for the float uniforms an AudioInput node reads its band amplitudes
 * from. The compiler declares them per GLSL slug (`u_audio_<slug>_<band>`),
 * and the audio engine has to write to those exact names, so every side goes
 * through this module instead of rebuilding the name from a node id.
 */

/** Uniform name for band `band` of the AudioInput node compiled under `slug`. */
export function audioUniformName(slug: string, band: number): string {
  return `u_audio_${slug}_${band}`;
}

const BAND_SUFFIX = /_(\d+)$/;

/**
 * Invert a compiled `audioUniforms` map (uniform name → node id) into, per
 * node id, the uniform names indexed by band. The band index is the trailing
 * `_<n>` of the name, which `audioUniformName` always appends last. Nodes
 * whose names are missing a band leave holes rather than shifting later bands.
 */
export function audioUniformNamesByNode(audioUniforms: Record<string, string>): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  for (const [uniformName, nodeId] of Object.entries(audioUniforms)) {
    const m = BAND_SUFFIX.exec(uniformName);
    if (!m) continue;
    let names = byNode.get(nodeId);
    if (!names) { names = []; byNode.set(nodeId, names); }
    names[Number(m[1])] = uniformName;
  }
  return byNode;
}
