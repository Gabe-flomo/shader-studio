/**
 * An explanation, shown: the code (highlighted, with the hovered part lit), the plain meaning
 * first, a mini plot when it is a function of one number, and, folded under it, the literal
 * reading and the "First … then …" steps. Hovering a step (or an idiom chip) lights its
 * sub-expression; hovering a variable chip lights where the code reads it, and the other way
 * round. Each step can be made into a node, and a recognised idiom can be looked for elsewhere.
 */
import { useMemo, useState } from 'react';
import { allNodes, transferPlot, needsPicture, type ExplainContext, type Explanation, type LineExplanation, type Seg, type Step, type UseQuery } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExplainText } from './ExplainText';
import { GlslCode, type CodeSpan } from './GlslCode';
import { TransferPlotView } from './TransferPlotView';
import { ExplainMore } from './ExplainMore';
import { explainModelUsable, useExplainModel } from '../../explainModel/client';

export interface ExplainViewProps {
  ex: Explanation | LineExplanation;
  /** Make a node from a span of `ex.source` (a step, or the whole thing). */
  onMakeNode?: (span: { start: number; end: number }) => void;
  onFindUses?: (query: UseQuery, title: string) => void;
  /** Only spans inside this range can be made into nodes (the expression part of a line). */
  editable?: { start: number; end: number };
  /**
   * Show the line's picture (the per-line ▶ probe): offered when the line reads space or several
   * inputs, so a plot can't say it. On demand only: nothing renders on the GPU until pressed.
   */
  onShowPicture?: () => void;
  /**
   * Offer "Explain more" (the optional on-device language model, docs/explain-model.md) for this line: its names'
   * types, and where it is. Absent: no such action here.
   */
  explainMore?: { ctx?: ExplainContext; where?: string };
}

// The steps' fold is remembered for the session (collapsed by default)
let stepsOpenPref = false;

const isLine = (ex: Explanation | LineExplanation): ex is LineExplanation => 'leadSegs' in ex;

/** Where each variable is read in the source (start → name), the assigned name included. */
function varSpans(ex: Explanation | LineExplanation): Array<{ start: number; end: number; name: string }> {
  const out = allNodes(ex.root).flatMap(n => (n.kind === 'ident' && n.end > n.start ? [{ start: n.start, end: n.end, name: n.name }] : []));
  if (isLine(ex) && ex.line.target) {
    const base = ex.line.target.split(/[.[]/)[0];
    const m = new RegExp(`\\b${base}\\b`).exec(ex.source.slice(0, ex.line.exprStart));
    if (m && !out.some(o => o.start === m.index)) out.push({ start: m.index, end: m.index + base.length, name: base });
  }
  return out;
}

export function ExplainView({ ex, onMakeNode, onFindUses, editable, onShowPicture, explainMore }: ExplainViewProps) {
  const tk = useTokens();
  const [hover, setHover] = useState<Step | null>(null);
  const [hoverVar, setHoverVar] = useState<string | null>(null);
  const [stepsOpen, setStepsOpenState] = useState(stepsOpenPref);
  const setStepsOpen = (v: boolean) => { stepsOpenPref = v; setStepsOpenState(v); };
  const src = ex.source;
  const canMake = (s: { start: number; end: number }) => !!onMakeNode && (!editable || (s.start >= editable.start && s.end <= editable.end));
  const rootSpan = { start: ex.root.start, end: ex.root.end };
  const rootIdiom = ex.idioms.find(h => h.node === ex.root);
  const reads = useMemo(() => varSpans(ex), [ex]);
  const varMap = useMemo(() => new Map(reads.map(r => [r.start, r.name])), [reads]);
  const plot = useMemo(() => transferPlot(ex), [ex]);
  const picture = !plot && !!onShowPicture && needsPicture(ex);
  // What to lead with: the plain meaning when there is one; the literal reading folds under it
  const lead: Seg[] = isLine(ex) ? ex.leadSegs : ex.meaningSegs ?? ex.sentenceSegs;
  const literal: Seg[] | null = isLine(ex) ? (ex.lineMeaningSegs ? ex.lineSentenceSegs : null) : ex.meaningSegs ? ex.sentenceSegs : null;
  const resultName = isLine(ex) ? ex.line.target : undefined;
  const spans: CodeSpan[] = [
    ...(hoverVar ? reads.filter(r => r.name === hoverVar).map(r => ({ start: r.start, end: r.end, kind: 'var' as const })) : []),
    ...(hover ? [{ start: hover.start, end: hover.end, kind: 'step' as const }] : []),
  ];
  // A touch screen can't hover: a step's actions stay visible there (a tap still lights the step)
  const noHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;
  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', border: 0, borderRadius: radius.sm,
    background: 'none', color: tk.accent.text, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`, flexShrink: 0,
  };
  const hasFold = ex.steps.length > 0 || !!literal;
  const autoSteps = useExplainModel(m => m.autoSteps && explainModelUsable(m));
  const stepInfo = useMemo(() => ex.steps.map(s => ({ label: s.label, code: s.code, reading: s.text })), [ex.steps]);
  return (
    <div data-explain-view="" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.subtle, border: `1px solid ${tk.border.subtle}` }}>
      {/* The code, highlighted, with the hovered part lit */}
      <div data-explain-code="" style={{ font: `500 12px/1.6 ${fontFamily.mono}` }}>
        <GlslCode code={src} spans={spans} vars={varMap} onVarHover={setHoverVar} />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div data-explain-sentence="" style={{ font: `600 13px/1.55 ${fontFamily.ui}`, color: tk.text.primary }}>
            <ExplainText segs={lead} activeVar={hoverVar} onVarHover={setHoverVar} />
          </div>
          {ex.use && (
            <span data-explain-use="" title="What this is usually for" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 9, background: alpha(tk.status.success, 0.12), color: tk.text.secondary, font: `600 11px ${fontFamily.ui}` }}>
              <Icon name="star" size={10} />{ex.use}
            </span>
          )}
          {ex.inShortSegs && (
            <div data-explain-inshort="" style={{ font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary }}>
              <ExplainText segs={ex.inShortSegs} activeVar={hoverVar} onVarHover={setHoverVar} />
            </div>
          )}
        </div>
        {plot && <TransferPlotView plot={plot} resultName={resultName} />}
        {picture && (
          <button type="button" data-explain-action="show-picture" onClick={onShowPicture} title="Render this line over the picture (the ▶ line preview)"
            style={{ ...small, background: tk.bg.field, color: tk.text.secondary }}>
            <Icon name="play" size={11} />Show picture
          </button>
        )}
      </div>
      {hasFold && (
        <button type="button" aria-expanded={stepsOpen} data-explain-steps-toggle="" onClick={() => setStepsOpen(!stepsOpen)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}`, textAlign: 'left' }}>
          <Icon name={stepsOpen ? 'chevD' : 'chevR'} size={11} />
          {literal ? 'Literal reading and steps' : ex.steps.length === 1 ? 'The step' : `Step by step (${ex.steps.length})`}
        </button>
      )}
      {stepsOpen && literal && (
        <div data-explain-literal="" style={{ font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary }}>
          <ExplainText segs={literal} activeVar={hoverVar} onVarHover={setHoverVar} />
        </div>
      )}
      {stepsOpen && ex.steps.length > 0 && (
        <ol data-explain-steps="" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }} onMouseLeave={() => setHover(null)}>
          {ex.steps.map((s, i) => {
            const lead = ex.steps.length === 1 ? '' : i === 0 ? 'First' : i === ex.steps.length - 1 ? 'Finally' : 'Then';
            const on = hover === s;
            return (
              <li key={s.label} data-explain-step={s.label} onMouseEnter={() => setHover(s)} onFocus={() => setHover(s)} tabIndex={0}
                style={{ display: 'flex', flexWrap: noHover ? 'wrap' : undefined, gap: 8, alignItems: 'flex-start', padding: '4px 6px', borderRadius: radius.sm, background: on ? alpha(tk.accent.base, 0.08) : 'none', outline: 'none' }}>
                <span style={{ flexShrink: 0, minWidth: 18, height: 18, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: on ? tk.accent.base : tk.bg.field, color: on ? '#fff' : tk.text.muted, font: `650 10.5px ${fontFamily.mono}` }}>{s.label}</span>
                <span style={{ flex: 1, minWidth: 0, font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary }}>
                  {lead && <span style={{ color: tk.text.faint }}>{lead}, </span>}
                  <span data-explain-step-code="" style={{ font: `500 11.5px ${fontFamily.mono}`, background: tk.bg.field, padding: '0 4px', borderRadius: 4 }}><GlslCode code={s.code} /></span>
                  {' '}<ExplainText segs={s.segs} activeVar={hoverVar} onVarHover={setHoverVar} />.
                  {s.idiom && (
                    <span title="A well-known shader idiom" style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 6px', borderRadius: 9, background: alpha(tk.status.success, 0.12), color: tk.text.secondary, font: `600 10.5px ${fontFamily.ui}`, verticalAlign: 1 }}>
                      <Icon name="star" size={10} />{s.idiom.name}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', gap: 2, opacity: on || noHover ? 1 : 0, transition: 'opacity 0.1s', ...(noHover ? { flexBasis: '100%', paddingLeft: 20 } : null) }}>
                  {s.idiom && onFindUses && (
                    <button type="button" data-explain-action="find-uses" title={`Where else is “${s.idiom.name}” used?`} style={small}
                      onClick={() => onFindUses({ idiomId: s.idiom!.id }, s.idiom!.name)}>
                      <Icon name="search" size={12} />Where else?
                    </button>
                  )}
                  {canMake(s) && (
                    <button type="button" data-explain-action="make-node" title={`Make a node from ${s.code}`} style={small} onClick={() => onMakeNode!({ start: s.start, end: s.end })}>
                      <Icon name="plus" size={12} />Node
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {stepsOpen && explainMore && ex.steps.length > 1 && (
        <ExplainMore key={`steps:${src}`} mode="steps" text={src} steps={stepInfo} ctx={explainMore.ctx} where={explainMore.where} auto={autoSteps} />
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
