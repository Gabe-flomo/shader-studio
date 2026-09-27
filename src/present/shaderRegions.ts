/**
 * shaderRegions.ts — the parts of a generated shader a code block can quote,
 * for the "From this graph's shader" picker: the whole shader, its
 * declarations (uniforms and constants), each function it defines (the app's
 * always-present helpers marked as such), main() whole, and main() by node
 * (each node's lines, as the code panel marks them).
 */
import { nodeSliceLines } from '../components/code/nodeSlice';
import type { SourceNode } from '../types/presentation';
import { blankComments } from './snippetHarness';

export interface ShaderRegion {
  id: string;
  kind: 'whole' | 'header' | 'fn' | 'main' | 'node';
  label: string;
  /** A line of detail: a signature, how many lines. */
  detail: string;
  /** 0-based line indices of the region in the shader (runs may have gaps, for a node). */
  lines: number[];
  /** The region's text (a node's runs joined). */
  text: string;
  /** One of the helpers every generated shader carries. */
  builtin?: boolean;
}

const HELPERS_START = /Always-available helpers/;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Where each top-level function sits: its name, signature and [first, last] line. */
function functionSpans(code: string): Array<{ name: string; signature: string; first: number; last: number }> {
  const blank = blankComments(code);
  const lines = blank.split('\n');
  const out: Array<{ name: string; signature: string; first: number; last: number }> = [];
  let depth = 0;
  let open: { name: string; signature: string; first: number } | null = null;
  let pending = '';
  let pendingStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (depth === 0) {
      if (pendingStart < 0 && l.trim()) pendingStart = i;
      pending += `${l}\n`;
    }
    for (const c of l) {
      if (c === '{') {
        if (depth === 0) {
          const head = pending.slice(0, pending.lastIndexOf('{') >= 0 ? pending.lastIndexOf('{') : undefined).replace(/\s+/g, ' ').trim();
          const m = /(?:^|[;}]\s*)(?:(?:highp|mediump|lowp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*$/.exec(head);
          open = m && !/^(if|for|while|else|return|struct)$/.test(m[1]) ? { name: m[2], signature: `${m[1]} ${m[2]}(${m[3].replace(/\s+/g, ' ').trim()})`, first: pendingStart >= 0 ? pendingStart : i } : null;
        }
        depth++;
      } else if (c === '}') {
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
          if (open) out.push({ ...open, last: i });
          open = null;
          pending = '';
          pendingStart = -1;
        }
      } else if (c === ';' && depth === 0) { pending = ''; pendingStart = -1; }
    }
    if (depth === 0 && /^\s*#/.test(l)) { pending = ''; pendingStart = -1; }
  }
  return out;
}

export function shaderRegions(code: string, nodes: readonly SourceNode[] = []): ShaderRegion[] {
  const all = code.replace(/\r/g, '').split('\n');
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k);
  const textOf = (idx: number[]) => idx.map(i => all[i]).join('\n');
  const out: ShaderRegion[] = [];
  out.push({ id: 'whole', kind: 'whole', label: 'The whole shader', detail: plural(all.length, 'line'), lines: range(0, all.length - 1), text: code.replace(/\n+$/, '') });

  const spans = functionSpans(code);
  const helpersAt = all.findIndex(l => HELPERS_START.test(l));
  const helpersEnd = helpersAt >= 0 ? all.findIndex((l, i) => i > helpersAt && /^\s*\/\/\s*─+\s*$/.test(l)) : -1;
  const firstFn = spans[0]?.first ?? all.length;
  // Declarations: from the top to the first function (or the helpers' banner), blank lines trimmed.
  const headEnd = Math.min(firstFn, helpersAt >= 0 ? helpersAt : all.length) - 1;
  const head = range(0, headEnd).filter(i => all[i].trim());
  if (head.length) out.push({ id: 'header', kind: 'header', label: 'Declarations', detail: 'Uniforms, constants and the varying', lines: range(head[0], head[head.length - 1]), text: textOf(range(head[0], head[head.length - 1])) });

  const main = spans.find(s => s.name === 'main');
  for (const s of spans) {
    if (s.name === 'main') continue;
    const builtin = helpersAt >= 0 && s.first > helpersAt && (helpersEnd < 0 || s.last < helpersEnd);
    const idx = range(s.first, s.last);
    out.push({ id: `fn:${s.name}:${s.first}`, kind: 'fn', label: `${s.name}()`, detail: `${s.signature} · ${plural(idx.length, 'line')}`, lines: idx, text: textOf(idx), ...(builtin ? { builtin } : {}) });
  }
  if (main) {
    const idx = range(main.first, main.last);
    out.push({ id: 'main', kind: 'main', label: 'main()', detail: `Everything the graph does per pixel · ${plural(idx.length, 'line')}`, lines: idx, text: textOf(idx) });
    const inner = new Set(range(main.first + 1, main.last - 1));
    const balance = (idx: number[]) => idx.reduce((b, i) => b + (all[i].match(/\{/g)?.length ?? 0) - (all[i].match(/\}/g)?.length ?? 0), 0);
    for (const n of nodes) {
      let idx2 = nodeSliceLines(code, n.slug).filter(i => inner.has(i));
      if (!idx2.length) continue;
      // Whole statements: a line that goes on from the one above, or onto the next, brings them.
      const ends = (i: number) => /[;{}]\s*$/.test(all[i].replace(/\/\/.*$/, '').trimEnd()) || !all[i].trim();
      const set = new Set<number>();
      for (const i of idx2) {
        let a = i, b = i;
        while (a - 1 > main.first && !ends(a - 1)) a--;
        while (b < main.last - 1 && !ends(b)) b++;
        for (let k = a; k <= b; k++) set.add(k);
      }
      idx2 = [...set].sort((x, y) => x - y);
      // Lines inside a loop or a branch bring the rest of it, so the part is whole GLSL.
      if (balance(idx2) !== 0 || idx2.some(i => /[{}]/.test(all[i]))) {
        let a = idx2[0], b = idx2[idx2.length - 1];
        const lo = main.first + 1, hi = main.last - 1;
        const span = () => range(a, b);
        let guard = 0;
        while (guard++ < 400) {
          const s = span();
          // Unclosed braces before the end: take lines below; a close with no open: take lines above.
          let depth = 0, minDepth = 0;
          for (const i of s) { for (const c of all[i]) { if (c === '{') depth++; else if (c === '}') { depth--; minDepth = Math.min(minDepth, depth); } } }
          if (depth === 0 && minDepth === 0) break;
          if (minDepth < 0 && a > lo) a--;
          else if (depth > 0 && b < hi) b++;
          else if (depth < 0 && a > lo) a--;
          else break;
        }
        idx2 = span();
      }
      out.push({ id: `node:${n.id}`, kind: 'node', label: n.label, detail: `${n.slug} · ${plural(idx2.length, 'line')}`, lines: idx2, text: textOf(idx2).replace(/^(\s*)/gm, m => m.slice(Math.min(m.length, 4))) });
    }
  }
  return out;
}
