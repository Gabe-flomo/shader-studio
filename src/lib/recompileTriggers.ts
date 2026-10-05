/**
 * The sliders that rebuild the shader when they move, for the Performance panel's Compiles note.
 *
 * Most float params are uniforms (compiler/uniformPatcher.ts): a drag is a uniform write. Two
 * kinds aren't: a param declared `compileTime` (it shapes the code, like a loop's count: FBM's
 * Octaves) and every param of a node type in SKIP_UNIFORM_TYPES. The note names the params, not
 * just the node, so "Fractal Noise (FBM)" doesn't read as if its Frequency or Gain recompiled.
 */
import { SKIP_UNIFORM_TYPES, isParamVisible } from '../compiler/uniformPatcher';
import { getNodeDefinitionFor } from '../nodes/definitions';
import type { GraphNode } from '../types/nodeGraph';

/** "Fractal Noise (FBM) · Octaves", "Mandelbrot (every slider)"; a repeat gets "×2". Groups are searched too. */
export function recompileTriggers(nodes: readonly GraphNode[]): string[] {
  const out = new Map<string, number>();
  const visit = (list: readonly GraphNode[]) => {
    for (const n of list) {
      const def = getNodeDefinitionFor(n);
      if (def) {
        let entry: string | null = null;
        if (SKIP_UNIFORM_TYPES.has(n.type)) {
          if (Object.keys(def.paramDefs ?? {}).length) entry = `${def.label} (every slider)`;
        } else {
          const params = Object.values(def.paramDefs ?? {})
            .filter(pd => pd.compileTime && isParamVisible(pd, n.params ?? {}, def.defaultParams))
            .map(pd => pd.label);
          if (params.length) entry = `${def.label} · ${params.join(', ')}`;
        }
        if (entry) out.set(entry, (out.get(entry) ?? 0) + 1);
      }
      const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) visit(sg.nodes);
    }
  };
  visit(nodes);
  return [...out.entries()].map(([l, c]) => (c > 1 ? `${l} ×${c}` : l));
}
