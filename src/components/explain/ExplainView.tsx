/**
 * An explanation, shown: the code (highlighted, with the hovered or selected part lit), a mini
 * plot when it is a function of one number, and the build-up view (BuildUpView.tsx): one row per
 * input, per step and for the result, each with its code, a small picture and its range. Click a
 * row (or ←/→ on the list) to show that step on the big ▶ preview, where the host can; Escape
 * goes back to the whole line. Each step can be made into a node, and a recognised idiom can be
 * looked for elsewhere. The sample inputs ("With base = …") drive the CPU pictures and ranges.
 *
 * No worded sentences here: the rule-based wording (explain.ts) stays for the Code explorer, the
 * Do bar and the model's prompt, but this panel shows values instead.
 */
import { useEffect, useMemo, useState } from 'react';
import { allNodes, buildUpRows, transferPlot, workedSteps, workedVars, showValue, type ExplainContext, type Explanation, type LineExplanation, type UseQuery, type Value, type WorkedVar } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { GlslCode, type CodeSpan } from './GlslCode';
import { TransferPlotView } from './TransferPlotView';
import { ExplainMore } from './ExplainMore';
import { BuildUpView } from './BuildUpView';
import type { BuildUpHost } from './buildUpHost';

export interface ExplainViewProps {
  ex: Explanation | LineExplanation;
  /** Make a node from a span of `ex.source` (a step, or the whole thing). */
  onMakeNode?: (span: { start: number; end: number }) => void;
  onFindUses?: (query: UseQuery, title: string) => void;
  /** Only spans inside this range can be made into nodes (the expression part of a line). */
  editable?: { start: number; end: number };
  /**
   * Show the whole line on the big preview (the per-line ▶ probe) where there is no build-up
   * host to step through: selecting the result row calls it.
   */
  onShowPicture?: () => void;
  /**
   * Offer "Explain" (the on-device language model, docs/explain-model.md) for this line: its names' types, and where
   * it is. Absent: no such action here (the Expression Block's rows put their own Explain beside the line).
   */
  explainMore?: { ctx?: ExplainContext; where?: string };
  /** Where the line lives (an Expression Block): wiring-aware pictures and step-through on the ▶ preview. */
  buildUp?: BuildUpHost;
  /** Changes when ▶ on the line opened this view: the build-up takes focus, ready to step. */
  focusSignal?: number;
}

// The build-up's fold is remembered for the session (it is the primary section: open by default)
let buildUpOpenPref = true;

const isLine = (ex: Explanation | LineExplanation): ex is LineExplanation => 'leadSegs' in ex;

/** Where each variable is read in the source (start → name), the assigned name included. */
export function varSpans(ex: Explanation | LineExplanation): Array<{ start: number; end: number; name: string }> {
  const out = allNodes(ex.root).flatMap(n => (n.kind === 'ident' && n.end > n.start ? [{ start: n.start, end: n.end, name: n.name }] : []));
  if (isLine(ex) && ex.line.target) {
    const base = ex.line.target.split(/[.[]/)[0];
    const m = new RegExp(`\\b${base}\\b`).exec(ex.source.slice(0, ex.line.exprStart));
    if (m && !out.some(o => o.start === m.index)) out.push({ start: m.index, end: m.index + base.length, name: base });
  }
  return out;
}

export function ExplainView({ ex, onMakeNode, onFindUses, editable, onShowPicture, explainMore, buildUp, focusSignal }: ExplainViewProps) {
  const tk = useTokens();
  const [hover, setHover] = useState<{ start: number; end: number } | null>(null);
  const [hoverVar, setHoverVar] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpenState] = useState(buildUpOpenPref);
  const setOpen = (v: boolean) => { buildUpOpenPref = v; setOpenState(v); };
  // ▶ on the line opens the build-up even when it was folded
  const [seenSignal, setSeenSignal] = useState<number | undefined>(undefined);
  if (focusSignal !== seenSignal) { setSeenSignal(focusSignal); if (focusSignal) setOpenState(true); }
  const src = ex.source;
  const canMake = (s: { start: number; end: number }) => !!onMakeNode && (!editable || (s.start >= editable.start && s.end <= editable.end));
  const rootSpan = { start: ex.root.start, end: ex.root.end };
  const rootIdiom = ex.idioms.find(h => h.node === ex.root);
  const reads = useMemo(() => varSpans(ex), [ex]);
  const varMap = useMemo(() => new Map(reads.map(r => [r.start, r.name])), [reads]);
  const plot = useMemo(() => transferPlot(ex), [ex]);
  const resultName = isLine(ex) ? ex.line.target : undefined;
  const varies = buildUp?.varies;
  const rows = useMemo(() => buildUpRows(ex, varies), [ex, varies]);
  // The line was edited and the selected row is gone: nothing is selected
  const selRow = rows.find(r => r.key === selected) ?? null;
  const spans: CodeSpan[] = [
    ...(hoverVar ? reads.filter(r => r.name === hoverVar).map(r => ({ start: r.start, end: r.end, kind: 'var' as const })) : []),
    ...(hover ? [{ start: hover.start, end: hover.end, kind: 'step' as const }] : selRow && selRow.kind !== 'input' ? [{ start: selRow.start, end: selRow.end, kind: 'step' as const }] : []),
    ...(!hoverVar && selRow?.kind === 'input' ? reads.filter(r => r.name === selRow.label).map(r => ({ start: r.start, end: r.end, kind: 'var' as const })) : []),
  ];
  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', border: 0, borderRadius: radius.sm,
    background: 'none', color: tk.accent.text, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`, flexShrink: 0,
  };
  // Worked examples: a sample value for each name the line reads (editable), and each row's usual spread
  const defaults = useMemo(() => workedVars(ex), [ex]);
  const [overrides, setOverrides] = useState<Record<string, Value>>({});
  const vars: WorkedVar[] = useMemo(() => defaults.map(v => (v.name in overrides ? { ...v, value: overrides[v.name] } : v)), [defaults, overrides]);
  const ranges = useMemo(() => {
    const out = new Map<string, [number, number] | null>();
    if (!open) return out;
    for (const v of vars) out.set(`in:${v.name}`, v.range);
    for (const w of ex.steps.length ? workedSteps(ex, vars) : []) out.set(`step:${w.label}`, w.range);
    const last = ex.steps[ex.steps.length - 1];
    if (last && last.node === ex.root) out.set('result', out.get(`step:${last.label}`) ?? null);
    return out;
  }, [open, ex, vars]);
  const idioms = useMemo(() => new Map(ex.steps.flatMap(s => (s.idiom ? [[s.label, s.idiom] as const] : []))), [ex.steps]);
  const inputs = rows.filter(r => r.kind === 'input').length;

  // Selecting a row shows it on the big preview (the host's ▶ probe); none: the whole line again
  const select = (key: string | null) => {
    setSelected(key);
    const row = rows.find(r => r.key === key) ?? null;
    if (buildUp?.show) buildUp.show(row);
    else if (row?.kind === 'result' && onShowPicture) onShowPicture();
  };
  return (
    <div data-explain-view="" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.subtle, border: `1px solid ${tk.border.subtle}` }}>
      {/* The code, highlighted, with the hovered (or selected) part lit */}
      <div data-explain-code="" style={{ font: `500 12px/1.6 ${fontFamily.mono}` }}>
        <GlslCode code={src} spans={spans} vars={varMap} onVarHover={setHoverVar} />
      </div>
      {(ex.use || plot) && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {ex.use && (
            <span data-explain-use="" title="What this is usually for" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 9, background: alpha(tk.status.success, 0.12), color: tk.text.secondary, font: `600 11px ${fontFamily.ui}` }}>
              <Icon name="star" size={10} />{ex.use}
            </span>
          )}
          {plot && <TransferPlotView plot={plot} resultName={resultName} />}
        </div>
      )}
      <button type="button" aria-expanded={open} data-buildup-toggle="" onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}`, textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={11} />
        Build-up
        <span style={{ fontWeight: 400, color: tk.text.faint }}>
          {inputs} input{inputs === 1 ? '' : 's'} · {ex.steps.length} step{ex.steps.length === 1 ? '' : 's'}{open && buildUp?.show ? ' · click a row or ← → to show it on the preview' : ''}
        </span>
      </button>
      {open && vars.length > 0 && (
        <TryValues vars={vars} onChange={(name, v) => setOverrides(o => ({ ...o, [name]: v }))} onReset={Object.keys(overrides).length ? () => setOverrides({}) : undefined} />
      )}
      {open && (
        <BuildUpView rows={rows} vars={vars} ranges={ranges} host={buildUp} activeVar={hoverVar}
          onHoverSpan={setHover} onHoverVar={setHoverVar} selected={selRow?.key ?? null} onSelect={select}
          canMake={canMake} onMakeNode={onMakeNode} onFindUses={onFindUses} idioms={idioms} focusSignal={focusSignal} />
      )}
      {(canMake(rootSpan) || (rootIdiom && onFindUses)) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canMake(rootSpan) && (
            <button type="button" data-explain-action="make-node-all" style={{ ...small, background: tk.bg.field, color: tk.text.secondary }} onClick={() => onMakeNode!(rootSpan)}>
              <Icon name="nodes" size={12} />Make a node from this
            </button>
          )}
          {rootIdiom && onFindUses && (
            <button type="button" data-explain-action="find-uses-all" style={{ ...small, background: tk.bg.field, color: tk.text.secondary }} onClick={() => onFindUses({ idiomId: rootIdiom.idiom.id }, rootIdiom.idiom.name)}>
              <Icon name="search" size={12} />Where else is this used?
            </button>
          )}
        </div>
      )}
      {explainMore && <ExplainMore text={ex.source} ctx={explainMore.ctx} where={explainMore.where} />}
    </div>
  );
}


/** The sample values the CPU pictures and ranges use: one small field per name the line reads. */
function TryValues({ vars, onChange, onReset }: { vars: WorkedVar[]; onChange: (name: string, v: Value) => void; onReset?: () => void }) {
  const tk = useTokens();
  return (
    <div data-explain-try="" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, font: `500 11.5px ${fontFamily.ui}`, color: tk.text.muted }}>
      <span title="Pictures the CPU works out (strips, numbers) and the usual ranges use these values. Change one to see how the line responds.">With</span>
      {vars.map(v => <TryField key={v.name} v={v} onChange={val => onChange(v.name, val)} />)}
      {onReset && <button type="button" onClick={onReset} style={{ border: 0, background: 'none', padding: 0, color: tk.accent.text, cursor: 'pointer', font: `600 11px ${fontFamily.ui}` }}>Reset</button>}
    </div>
  );
}

function TryField({ v, onChange }: { v: WorkedVar; onChange: (v: Value) => void }) {
  const tk = useTokens();
  const shown = showValue(v.value).replace(/^\(|\)$/g, '');
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const nums = text.split(/[ ,]+/).map(Number).filter(n => Number.isFinite(n));
    if (!nums.length) { setText(shown); return; }
    const n = Array.isArray(v.value) ? v.value.length : 1;
    onChange(n === 1 ? nums[0] : Array.from({ length: n }, (_, i) => nums[i] ?? nums[nums.length - 1]));
  };
  return (
    <label title={`${v.name}: ${v.why}, usually ${showValue(v.range[0])} to ${showValue(v.range[1])}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ font: `600 11px ${fontFamily.mono}`, color: tk.text.secondary }}>{v.name} =</span>
      <input aria-label={`Sample value of ${v.name}`} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: Math.max(38, text.length * 7 + 14), height: 20, padding: '0 4px', border: `1px solid ${tk.border.subtle}`, borderRadius: 4, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}` }} />
    </label>
  );
}
