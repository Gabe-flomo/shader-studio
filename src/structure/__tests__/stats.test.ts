/**
 * The numbers behind the flows (docs/structure-hints.md): in the bundled examples, how often each
 * order of stages appears. Checks the flows agree with the examples; WRITE_DOCS=1 rewrites the
 * tables in the doc:
 *
 *   WRITE_DOCS=1 npx vitest run src/structure/__tests__/stats.test.ts
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import type { GraphNode } from '../../types/nodeGraph';
import { computeStageStats, type FlowStats } from '../stats';
import { FLOWS, FLOW_ORDER, STAGES, type StageId } from '../stages';

const graphs = Object.values(EXAMPLE_GRAPHS).map(g => (g as { nodes?: GraphNode[] }).nodes ?? []);
const stats = computeStageStats(graphs);

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '–');
const label = (s: string) => STAGES[s as StageId]?.label ?? s;

function flowTable(st: FlowStats): string {
  const k = st.kinds;
  const ordered = k.forward + k.backward;
  const lines = [
    `**${FLOWS[st.flow].label}** — ${st.graphs} examples, ${st.links} stage links. ` +
      `Forward ${k.forward}, same stage ${k.same}, feedback ${k.feedback}, colour into an input ${k.tint}, backward ${k.backward}: ` +
      `**${pct(k.forward, ordered)} of order-carrying links follow the flow**; ${st.graphsWithBackward} of ${st.graphs} examples have any backward link.`,
    '',
    '| Link | Examples with it | Share |',
    '|---|---:|---:|',
  ];
  const order = FLOWS[st.flow].stages;
  const rows = [...st.pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [pair, count] of rows) {
    const [a, b] = pair.split('>');
    const back = order.indexOf(b as StageId) < order.indexOf(a as StageId);
    lines.push(`| ${label(a)} → ${label(b)}${back ? ' (backward)' : ''} | ${count} | ${pct(count, st.graphs)} |`);
  }
  lines.push('', '| Stages feeding the Output | Examples |', '|---|---:|');
  for (const [chain, count] of [...st.chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    lines.push(`| ${chain ? chain.split(' ').map(label).join(' → ') : '(none)'} | ${count} |`);
  }
  return lines.join('\n');
}

describe('stage order in the examples', () => {
  it('follows the flows: at least 95% of order-carrying links go forward in every flow', () => {
    expect(stats.total).toBeGreaterThan(300);
    for (const f of FLOW_ORDER) {
      const st = stats.byFlow[f];
      expect(st.graphs).toBeGreaterThan(10);
      const { forward, backward } = st.kinds;
      expect([f, forward / (forward + backward) >= 0.95]).toEqual([f, true]);
    }
  });

  it('has the 2D backbone as its most common links', () => {
    const st = stats.byFlow['2d'];
    const top = [...st.pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
    expect(top).toContain('space>shape');
    expect(top).toContain('shape>shapeIt');
  });

  it('writes the doc tables when asked', async () => {
    if (!(import.meta.env as Record<string, unknown>).WRITE_DOCS) return;
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync: (f: URL, e: string) => string; writeFileSync: (f: URL, s: string) => void };
    const url = new URL('../../../docs/structure-hints.md', import.meta.url);
    const doc = fs.readFileSync(url, 'utf8');
    const body = [
      `${stats.total} bundled examples: ${FLOW_ORDER.map(f => `${stats.byFlow[f].graphs} ${FLOWS[f].label}`).join(', ')}.`,
      '',
      ...FLOW_ORDER.map(f => flowTable(stats.byFlow[f]) + '\n'),
    ].join('\n');
    const next = doc.replace(/<!-- stats:start -->[\s\S]*<!-- stats:end -->/, `<!-- stats:start -->\n${body}\n<!-- stats:end -->`);
    fs.writeFileSync(url, next);
  });
});
