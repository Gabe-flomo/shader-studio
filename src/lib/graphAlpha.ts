/**
 * Does the graph's picture carry an alpha of its own, for a transparent export's "Its own alpha"?
 *
 * Output (RGBA) passes its vec4's alpha; the plain Output has an Alpha input (1 when empty) and an
 * Opacity slider that multiplies it. A graph whose Output has neither is opaque: "Its own alpha"
 * would export a solid file, which the Record dialog warns about. This only reads the graph; a
 * frame read back with no transparent pixel at all is caught by frameIsOpaque.
 */
import type { GraphNode } from '../types/nodeGraph';

export function graphOwnAlpha(nodes: readonly GraphNode[]): boolean {
  return nodes.some(n => {
    if (n.type === 'vec4Output') return true;
    if (n.type !== 'output') return false;
    if (n.inputs.alpha?.connection) return true;
    const op = n.params.opacity;
    // A number below 1, or anything not a plain number (driven by a control or keyframes).
    return op !== undefined && op !== 1;
  });
}

/** Every pixel of a straight-alpha RGBA frame fully opaque. */
export function frameIsOpaque(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
}
