/**
 * Step through a looped Expression Block's passes (docs/expression-block.md, "Loop"): a scrubber
 * over the passes and, for the pass it is on, every variable the loop writes, at the sample pixel
 * and across the picture. Measured on the CPU (lib/glslPatterns/worked.ts `workedLoop`), from the
 * same sample inputs as the build-up (lib/sampleInputs.ts `describeInputs`): a slider's
 * value, a UV's spread, the clock at 2 s. A line the CPU can't evaluate (a texture read, a helper
 * function) shows a dash, and so does anything built from it.
 */
import { useMemo, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { showValue, workedLoop, WORKED_LOOP_CAP, type BlockInput, type Value, type WorkedLoop } from '../../lib/glslPatterns';
import { describeInputs } from '../../lib/sampleInputs';
import { clampCount, loopCountValue, loopMax, loopOf, type ExprLoopLine } from '../../nodes/exprLoop';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

const stmt = (l: ExprLoopLine) => `${l.lhs} ${l.op || '='} ${l.rhs}`;
const on = (l: ExprLoopLine | undefined): l is ExprLoopLine => !!l && !l.off && !!l.lhs?.trim() && !!l.rhs?.trim();
const zero = (t: string): Value => (t === 'vec2' ? [0, 0] : t === 'vec3' ? [0, 0, 0] : t === 'vec4' ? [0, 0, 0, 0] : 0);

/** The block's loop measured pass by pass (pure: the graph is passed in). */
export function loopPassesOf(node: GraphNode, nodes: readonly GraphNode[]): WorkedLoop | null {
  const loop = loopOf(node.params);
  if (!loop) return null;
  const lines = (Array.isArray(node.params.lines) ? (node.params.lines as ExprLoopLine[]) : []).filter(on);
  const inputs: BlockInput[] = describeInputs(nodes.some(x => x.id === node.id) ? nodes : [...nodes, node], node.id).map(i => i.sample);
  const declared = new Set(inputs.map(i => i.name));
  const outType = (node.params.outputType as string) || 'float';
  const extra: Record<string, Value> = declared.has('p') ? {} : { p: zero(outType) };
  const n = clampCount(loopCountValue(node.params), Math.min(loopMax(loop), WORKED_LOOP_CAP));
  return workedLoop({ before: (loop.before ?? []).filter(on).map(stmt), body: lines.map(stmt), breakWhen: loop.breakWhen, n, inputs, extra });
}

const range = (r: Array<[number, number]> | null | undefined) => {
  if (!r || !r.length) return '–';
  const one = ([a, b]: [number, number]) => (Math.abs(a - b) < 1e-6 ? showValue(a) : `${showValue(a)}…${showValue(b)}`);
  return r.length === 1 ? one(r[0]) : `(${r.map(one).join(', ')})`;
};

export function LoopPasses({ node, nodes }: { node: GraphNode; nodes: readonly GraphNode[] }) {
  const tk = useTokens();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the code, inputs and count are what it reads
  const worked = useMemo(() => loopPassesOf(node, nodes), [node.params, node.inputs, nodes]);
  const [at, setAt] = useState<number | null>(null);
  if (!worked) return null;
  const last = worked.passes.length - 1;
  const pass = last < 0 ? null : worked.passes[Math.max(0, Math.min(last, at ?? last))];
  const cell: React.CSSProperties = { padding: '3px 8px', font: `500 11.5px ${fontFamily.mono}`, color: tk.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  return (
    <div data-loop-passes="" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: radius.control, background: tk.bg.field }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: tk.text.muted, whiteSpace: 'nowrap' }}>After pass</span>
        <input type="range" aria-label="Pass" min={0} max={Math.max(0, last)} step={1} value={pass?.i ?? 0} disabled={last < 1}
          onChange={e => setAt(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} />
        <span data-loop-pass="" style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary, minWidth: 64, textAlign: 'right' }}>
          {pass ? `i = ${pass.i}` : 'no passes'}
        </span>
      </div>
      {pass?.broke && <span style={{ fontSize: 12, color: tk.status.warningText }}>Break when is true after this pass at the sample pixel: the loop stops here.</span>}
      {worked.names.length === 0
        ? <span style={{ fontSize: 12, color: tk.text.muted }}>No line writes a variable yet.</span>
        : (
          <div role="table" style={{ display: 'grid', gridTemplateColumns: 'minmax(56px, auto) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', columnGap: 4 }}>
            {['', 'start', 'at the sample', 'across the picture'].map(h => <span key={h} style={{ ...cell, color: tk.text.faint, fontFamily: fontFamily.ui, fontSize: 11 }}>{h}</span>)}
            {worked.names.map(name => (
              <div key={name} role="row" style={{ display: 'contents' }}>
                <span style={{ ...cell, color: tk.text.primary }}>{name}</span>
                <span style={cell}>{worked.start[name] == null ? '–' : showValue(worked.start[name]!)}</span>
                <span style={{ ...cell, color: tk.text.primary }}>{pass?.values[name] == null ? '–' : showValue(pass.values[name]!)}</span>
                <span style={cell}>{range(pass?.ranges[name])}</span>
              </div>
            ))}
          </div>
        )}
      <span style={{ fontSize: 11.5, color: tk.text.faint }}>Measured on the CPU from sample inputs (a slider’s value, the clock at 2 s, a UV’s spread){loopCountValue(node.params) > WORKED_LOOP_CAP ? `; the first ${WORKED_LOOP_CAP} passes` : ''}.</span>
    </div>
  );
}
