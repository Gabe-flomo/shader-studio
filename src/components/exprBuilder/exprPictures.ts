/**
 * exprPictures.ts — the Expression Builder's small renders (docs/expression-builder.md): the
 * Explain build-up's render path (buildUpHost.renderBlockRows: one compile for many rows, a draw
 * per row, cached by shader + uniforms, strips when a render per row costs too much) run on the
 * builder's own small graph (exprBuilder/block.ts previewGraph: the seed, the block that Add to
 * graph makes, an Output).
 *
 * A time seed is drawn on the CPU instead (its value is the same at every pixel): a float as a
 * plot, a vector as a strip of colour along t.
 */
import { exprBlockCost, renderBlockRows, type RenderRow, type RowField } from '../explain/buildUpHost';
import { stripField } from '../explain/rowPicture';
import { pictureBudget, type TransferPlot } from '../../lib/glslPatterns';
import { previewGraph } from '../../exprBuilder/block';
import { plotChain, type Chain, type ChainStep } from '../../exprBuilder/chain';

export type { RowField };

/** Render rows (expressions in the block's names after its first `upTo` steps). Null when it doesn't compile or there is no GPU. */
export async function renderChainRows(chain: Chain, upTo: number, rows: readonly RenderRow[], size?: number): Promise<Map<string, RowField> | null> {
  if (!rows.length) return new Map();
  const g = previewGraph(chain, upTo);
  const block = g.nodes.find(n => n.id === g.blockId)!;
  const budget = pictureBudget(exprBlockCost(block, g.nodes));
  try {
    return await renderBlockRows(block, g.nodes, 'return', rows, budget.render ? 'square' : 'strip', size);
  } catch {
    return null;
  }
}

/** A CPU picture for a time seed: a plot (float) or a strip along t (a vector). */
export type CpuPicture = { kind: 'plot'; plot: TransferPlot } | { kind: 'strip'; field: RowField; type: string };

export function timePicture(chain: Chain, upTo: number, extra: readonly ChainStep[] = []): CpuPicture | null {
  const data = plotChain(chain, upTo, extra);
  if (!data) return null;
  if (data.type === 'float' || data.type === 'int') {
    const ys = data.samples.map(s => s.v[0]);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const pad = hi > lo ? (hi - lo) * 0.08 : 0.5;
    return {
      kind: 'plot',
      plot: {
        input: 't', inputType: 'float', from: data.samples[0].t, to: data.samples[data.samples.length - 1].t, edges: [],
        points: data.samples.map(s => [s.t, s.v[0]] as [number, number]), yMin: lo - pad, yMax: hi + pad, yLo: lo, yHi: hi,
      },
    };
  }
  return { kind: 'strip', field: stripField(data.samples.map(s => s.v)), type: data.type };
}
