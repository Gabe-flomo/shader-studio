/**
 * code.ts — what a Present code block shows: typed-in code, a source's
 * whole shader, one node's slice of it (the lines the code panel marks for
 * that node, with gaps between runs), or a Script layer's JavaScript.
 */
import { nodeSliceLines } from '../components/code/nodeSlice';
import type { CodeBlock, PresentSource } from '../types/presentation';

export type CodeRow = { n: number; text: string; marked: boolean } | { gap: number };

export interface ResolvedCode {
  language: 'glsl' | 'js';
  /** The rows to draw: numbered lines (numbers as in the full text) and gaps where lines were left out. */
  rows: CodeRow[];
  /** The text the copy button copies (what's shown, without the gaps). */
  text: string;
  /** Where it came from, for the caption line. */
  from: string;
  /** Something is missing (a source, a node, a layer): shown instead of the code. */
  problem?: string;
  /** A Script layer's code as the snapshot has it (what a live block's Reset goes back to). */
  original?: string;
}

function inRanges(n: number, ranges: [number, number][] | undefined): boolean {
  return !!ranges?.some(([a, b]) => n >= a && n <= b);
}

function wholeText(text: string, language: 'glsl' | 'js', from: string, ranges?: [number, number][]): ResolvedCode {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  return { language, from, text: lines.join('\n'), rows: lines.map((t, i) => ({ n: i + 1, text: t, marked: inRanges(i + 1, ranges) })) };
}

export function resolveCode(b: CodeBlock, sources: ReadonlyMap<string, PresentSource>): ResolvedCode {
  if (!b.from) return wholeText(b.code ?? '', b.language, b.origin?.label ?? '', b.highlightLines);
  const src = sources.get(b.from.source);
  if (!src) return { language: b.language, rows: [], text: '', from: '', problem: 'Its source was removed from this presentation.' };
  if ('layerId' in b.from) {
    const id = b.from.layerId;
    const layer = src.bundle.play.layers.find(l => l.id === id);
    if (!layer || layer.kind !== 'script') return { language: 'js', rows: [], text: '', from: src.title, problem: 'That Script layer isn’t in this source any more.' };
    // A live block shows the reader's edit, when there is one.
    const text = b.live && b.edited !== undefined ? b.edited : layer.code;
    return { ...wholeText(text, 'js', `${layer.label} · Script layer in ${src.title}`, b.highlightLines), original: layer.code };
  }
  const shader = src.bundle.fragmentShader;
  if (!b.from.node) return wholeText(shader, 'glsl', `Generated shader · ${src.title}`, b.highlightLines);
  const nodeId = b.from.node;
  const node = src.shader.nodes.find(n => n.id === nodeId);
  if (!node) return { language: 'glsl', rows: [], text: '', from: src.title, problem: 'That node isn’t in this source’s shader any more.' };
  const all = shader.split('\n');
  const idx = nodeSliceLines(shader, node.slug);
  const rows: CodeRow[] = [];
  let prev = -1;
  for (const i of idx) {
    if (prev >= 0 && i > prev + 1) rows.push({ gap: i - prev - 1 });
    rows.push({ n: i + 1, text: all[i], marked: inRanges(i + 1, b.highlightLines) });
    prev = i;
  }
  return { language: 'glsl', rows, text: idx.map(i => all[i]).join('\n'), from: `${node.label} · ${src.title}` };
}

/** "3-5, 9" → [[3, 5], [9, 9]]; junk is skipped. */
export function parseLineRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of text.split(/[,\s]+/)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a > 0 && b > 0) out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

export function formatLineRanges(r: [number, number][] | undefined): string {
  return (r ?? []).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}
