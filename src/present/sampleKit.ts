/**
 * sampleKit.ts — what the sample presentations (samples.ts, teachingSamples.ts)
 * are built with: snapshots of bundled examples by key, and short makers for
 * steps and blocks that read from them.
 */
import { snapshotExample } from './snapshot';
import { PRESENTATION_VERSION, newId, type Block, type CodeBlock, type InteractiveBlock, type InteractiveControl, type Presentation, type PresentSource, type RenderBlock, type Step } from '../types/presentation';

// ── Building blocks ─────────────────────────────────────────────────────────

/** Snapshot every example a sample reads from, by key. */
export async function sources(keys: readonly string[]): Promise<Record<string, PresentSource>> {
  const out: Record<string, PresentSource> = {};
  for (const k of keys) {
    const r = await snapshotExample(k);
    if (!r.ok) throw new Error(`${k}: ${r.error}`);
    out[k] = r.source;
  }
  return out;
}

export function blocks(src: Record<string, PresentSource>) {
  return {
    text: (markdown: string): Block => ({ type: 'text', id: newId('b'), markdown }),
    render: (k: string, caption: string, more: Partial<RenderBlock> = {}): Block =>
      ({ type: 'render', id: newId('b'), source: src[k].id, aspect: '16:9', width: 'full', pointer: true, caption, ...more }),
    interactive: (k: string, markdown: string, controls: Array<[id: string, label?: string, hint?: string]>, more: Partial<InteractiveBlock> = {}): Block => ({
      type: 'interactive', id: newId('b'), source: src[k].id, markdown, layout: 'side', aspect: '4:3', pointer: true,
      controls: controls.map(([controlId, label, hint]): InteractiveControl => ({ controlId, showMappings: true, ...(label ? { label } : {}), ...(hint ? { hint } : {}) })),
      ...more,
    }),
    /** One node's lines of a source's shader (nothing when the node has no lines there). */
    nodeCode: (k: string, nodeId: string, caption: string): Block[] =>
      src[k].shader.nodes.some(n => n.id === nodeId) ? [{ type: 'code', id: newId('b'), language: 'glsl', from: { source: src[k].id, node: nodeId }, caption }] : [],
    /** One node's lines of a source's shader; throws when the node has none there, so a sample never drops a block quietly. */
    slice: (k: string, nodeId: string, caption: string): Block => {
      if (!src[k].shader.nodes.some(n => n.id === nodeId)) throw new Error(`samples: ${k} has no lines for node ${nodeId}`);
      return { type: 'code', id: newId('b'), language: 'glsl', from: { source: src[k].id, node: nodeId }, caption };
    },
    glsl: (code: string, caption: string, highlightLines?: [number, number][]): Block =>
      ({ type: 'code', id: newId('b'), language: 'glsl', code, caption, ...(highlightLines ? { highlightLines } : {}) }),
    /** A Script layer's code; `live` lets the reader edit it and see the edit in this step's canvases. */
    script: (k: string, layerId: string, caption: string, o: { live?: boolean; highlightLines?: [number, number][] } = {}): Block => {
      const b: CodeBlock = { type: 'code', id: newId('b'), language: 'js', from: { source: src[k].id, layerId }, caption };
      if (o.highlightLines) b.highlightLines = o.highlightLines;
      if (o.live) b.live = true;
      return b;
    },
  };
}

export const step = (title: string, content: Block[], columns: 1 | 2 = 1): Step => ({ id: newId('s'), title, columns, blocks: content });

/** The 1-based line range from the first line containing `from` to the first after it containing `to` (or just that line). */
export function linesBetween(code: string, from: string, to?: string): [number, number][] {
  const lines = code.split('\n');
  const a = lines.findIndex(l => l.includes(from));
  if (a < 0) throw new Error(`samples: no line with “${from}”`);
  if (to === undefined) return [[a + 1, a + 1]];
  const b = lines.findIndex((l, i) => i >= a && l.includes(to));
  if (b < 0) throw new Error(`samples: no line with “${to}” after “${from}”`);
  return [[a + 1, b + 1]];
}

export function presentation(title: string, keys: readonly string[], src: Record<string, PresentSource>, steps: Step[], now: number): Presentation {
  return { version: PRESENTATION_VERSION, title, steps, sources: keys.map(k => src[k]), createdAt: now, updatedAt: now };
}

