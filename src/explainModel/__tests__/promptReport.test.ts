/**
 * The explanation model's prompts on real code (docs/explain-model.md "Comparing the context"): ~20 Expression Block
 * lines taken from the bundled examples, each prompt built the way the Explain button builds it. No model runs here.
 *
 * Always: checks every prompt is free of user labels and of the rule-based readings, and carries the facts.
 * With WRITE_REPORT=1 it also writes docs/reports/explain-prompt-context.md: each line's prompt, and, when
 * EXPLAIN_BEFORE_JSON names a file of prompts captured from an earlier build, the earlier prompt beside it.
 *
 *   WRITE_REPORT=1 [EXPLAIN_BEFORE_JSON=before.json] npx vitest run src/explainModel/__tests__/promptReport.test.ts
 *   EXPLAIN_CAPTURE_JSON=before.json npx vitest run …   (saves the prompts as JSON, to compare a later build with)
 */
import { describe, expect, it, vi } from 'vitest';

const env = import.meta.env as Record<string, string | undefined>;
interface Fs {
  writeFileSync: (f: string | URL, s: string) => void;
  readFileSync: (f: string | URL, enc: 'utf8') => string;
  existsSync: (f: string | URL) => boolean;
  mkdirSync: (f: string | URL, o: { recursive: boolean }) => void;
}

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));

import type { GraphNode } from '../../types/nodeGraph';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { getNodeDefinition } from '../../nodes/definitions';
import { exprBlockCode } from '../../components/explain/hosts';
import { promptForBlock, promptForLine, type ExplainScope } from '../prompt';
import { describerFrom } from '../inputs';

interface Sample { example: string; nodeId: string; line: string; lineNo: number; total: number; nodes: GraphNode[]; code: string }

const levels = (nodes: GraphNode[], out: GraphNode[][] = []): GraphNode[][] => {
  out.push(nodes);
  for (const n of nodes) {
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) levels(sg.nodes, out);
  }
  return out;
};

/**
 * ~20 lines from different examples: blocks with a wired input and at least three lines; in each, a later line that
 * calls a function. One per example, no two with the same code, spread evenly over the examples.
 */
function samples(max = 20): Sample[] {
  const out: Sample[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(EXAMPLE_GRAPHS).sort()) {
    const g = EXAMPLE_GRAPHS[key] as { nodes?: GraphNode[] };
    if (!g.nodes) continue;
    let took = false;
    for (const nodes of levels(g.nodes)) {
      for (const n of nodes) {
        if (took || n.type !== 'exprNode') continue;
        const wired = Object.values(n.inputs ?? {}).some(s => s.connection);
        const code = exprBlockCode(n);
        const lines = code.split('\n').filter(Boolean);
        if (!wired || lines.length < 3 || seen.has(code)) continue;
        seen.add(code);
        // The first line after the first that calls a function (a later line has earlier lines to trace through)
        let i = lines.findIndex((l, j) => j > 0 && /\b[a-z]\w*\s*\(/.test(l.replace(/^\s*(float|vec[234]|mat[234])\s/, '')));
        if (i < 0) i = 1;
        out.push({ example: key, nodeId: n.id, line: lines[i], lineNo: i + 1, total: lines.length, nodes, code });
        took = true;
      }
    }
  }
  const unique = out.filter((s, i) => out.findIndex(o => o.line === s.line) === i);
  if (unique.length <= max) return unique;
  return Array.from({ length: max }, (_, i) => unique[Math.floor((i * unique.length) / max)]);
}

function scopeOf(s: Sample): ExplainScope {
  return {
    nodeId: s.nodeId, nodes: s.nodes, enclosing: s.code, where: `line ${s.lineNo} of ${s.total}`,
    namer: t => getNodeDefinition(t)?.label,
    describe: describerFrom(getNodeDefinition),
  };
}

const userText = (m: Array<{ role: string; content: string }>) => m[m.length - 1].content;
const labelsOf = (nodes: GraphNode[]) => nodes.flatMap(n => [n.params?.label, n.params?.title]).filter((x): x is string => typeof x === 'string' && x.trim().length > 3);

describe('prompts on real Expression Block lines from the examples', () => {
  const all = samples();

  it('finds about twenty lines', () => {
    expect(all.length).toBeGreaterThanOrEqual(15);
  });

  it('never carries a user label, and never the rule-based readings', () => {
    for (const s of all) {
      const line = promptForLine(s.line, scopeOf(s));
      const block = promptForBlock(s.code, scopeOf(s));
      for (const p of [line, block]) {
        const text = JSON.stringify(p.messages) + p.context;
        for (const label of labelsOf(s.nodes)) {
          // A label that is also a node type's name or a word in the code is not a leak
          if (getNodeDefinition(label) || s.code.includes(label) || text.includes(`${label} node`)) continue;
          expect(text, `${s.example}: label "${label}"`).not.toContain(`"${label}"`);
        }
        expect(text).not.toMatch(/rule-based/i);
        expect(text).not.toMatch(/Idiom:/);
      }
      expect(userText(line.messages)).toContain(`Explain line ${line.lineNo} only.`);
    }
  });

  it('writes the before/after report (WRITE_REPORT=1)', async () => {
    const beforePath = env.EXPLAIN_BEFORE_JSON;
    const capture = env.EXPLAIN_CAPTURE_JSON;
    if (!capture && !env.WRITE_REPORT) return;
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as Fs;
    const now = all.map(s => ({ key: `${s.example}#${s.nodeId}:${s.lineNo}`, example: s.example, line: s.line, lineNo: s.lineNo, prompt: userText(promptForLine(s.line, scopeOf(s)).messages) }));
    if (capture) { fs.writeFileSync(capture, JSON.stringify(now, null, 1)); return; }
    const before: Record<string, string> = {};
    if (beforePath && fs.existsSync(beforePath)) for (const b of JSON.parse(fs.readFileSync(beforePath, 'utf8')) as typeof now) before[b.key] = b.prompt;
    const fence = (t: string) => `\`\`\`text\n${t.replace(/```/g, "'''")}\n\`\`\``;
    const parts = [
      '# Explain: the model\'s context, before and after',
      '',
      'Generated by `WRITE_REPORT=1 npx vitest run src/explainModel/__tests__/promptReport.test.ts` (docs/explain-model.md).',
      `${all.length} real Expression Block lines from the bundled examples; for each, the user message the model is given when you press **Explain** on that line.`,
      'The system prompt and the worked examples are the same for every line and are left out. No model ran to make this page.',
      '',
      '- **Before**: the prompt on main before the fact-only context (the rule-based reading, idioms and readings were included).',
      '- **After**: code up to the line, each input traced to the node type that feeds it, what each earlier line is built from, measured numbers, what the block feeds, function meanings and colours. No rule-based wording.',
      '',
    ];
    for (const n of now) {
      parts.push(`## ${n.example}, line ${n.lineNo}`, '', `\`${n.line}\``, '');
      if (before[n.key]) parts.push('**Before**', '', fence(before[n.key]), '');
      parts.push('**After**', '', fence(n.prompt), '');
    }
    const dir = env.REPORT_DIR ? `${env.REPORT_DIR.replace(/\/$/, '')}/` : 'docs/reports/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}explain-prompt-context.md`, parts.join('\n'));
  });
});
