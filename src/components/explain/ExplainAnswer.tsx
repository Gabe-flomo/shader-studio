/**
 * ExplainAnswer — how the local model's answer is shown (docs/explain-model.md): the explanation of each line with a
 * small confidence dot (the tooltip says why) and a "not sure" tag whenever the answer is low-confidence or the
 * model said it was unsure; plain prose for answers that are not in the JSON format; and Compare models, the same
 * question answered by every downloaded model side by side.
 */
import { useMemo } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { modelById } from '../../explainModel/config';
import { viewAnswer, type AnswerView } from '../../explainModel/assess';
import type { Confidence, GroundingContext, TokenLp } from '../../explainModel/confidence';
import type { CompareEntry } from '../../explainModel/useAnswer';
import { useElapsed } from './useElapsed';

/** An answer as paragraphs and list items ("- …" or the block format's "3: …"). */
export function AnswerText({ text }: { text: string }) {
  const tk = useTokens();
  const parts = useMemo(() => {
    const out: Array<{ list: boolean; items: Array<{ n?: string; text: string }> }> = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const summary = /^summary\s*:\s*(.*)$/i.exec(line);
      if (summary) { out.push({ list: false, items: [{ text: summary[1] }] }); continue; }
      const item = /^(?:([-*•])|(\d+)\s*[.):])\s*(.*)$/.exec(line);
      if (!item) { out.push({ list: false, items: [{ text: line }] }); continue; }
      const last = out[out.length - 1];
      const it = { n: item[2], text: item[3] };
      if (last?.list) last.items.push(it); else out.push({ list: true, items: [it] });
    }
    return out;
  }, [text]);
  return (
    <div data-explain-answer="" style={{ display: 'flex', flexDirection: 'column', gap: 6, font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.primary }}>
      {parts.map((p, i) => p.list
        ? (
          <ul key={i} style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {p.items.map((it, j) => (
              <li key={j} style={{ display: 'flex', gap: 8 }}>
                <span style={{ flexShrink: 0, minWidth: 16, color: tk.text.faint, font: `600 11px/1.9 ${fontFamily.mono}` }}>{it.n ?? '•'}</span>
                <span style={{ minWidth: 0 }}><Code text={it.text} /></span>
              </li>
            ))}
          </ul>
        )
        : <p key={i} style={{ margin: 0 }}><Code text={p.items.map(x => x.text).join(' ')} /></p>)}
    </div>
  );
}

/** `backticked` words as code. */
export function Code({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((s, i) => (s.startsWith('`') && s.endsWith('`') && s.length > 2 ? <code key={i} style={{ font: `500 0.92em ${fontFamily.mono}` }}>{s.slice(1, -1)}</code> : s))}</>;
}

const LEVEL_WORDS = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

/** The small confidence dot: colour = level; the tooltip says why. */
export function ConfidenceDot({ c }: { c: Confidence }) {
  const tk = useTokens();
  const colour = c.level === 'high' ? tk.status.success : c.level === 'medium' ? tk.status.warning : tk.status.danger;
  const why = `${LEVEL_WORDS[c.level]}: ${c.reasons.join('; ')}.`;
  return <span role="img" aria-label={why} title={why} data-confidence={c.level} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0, marginTop: 6 }} />;
}

/** "not sure" and why: always beside a low-confidence answer. */
export function NotSureTag({ reason }: { reason: string }) {
  const tk = useTokens();
  return (
    <span data-explain-not-sure="" title={reason} style={{ display: 'inline-block', maxWidth: '100%', font: `600 10.5px ${fontFamily.ui}`, padding: '1px 8px', borderRadius: 10, lineHeight: 1.45, background: alpha(tk.status.danger, 0.1), color: tk.status.danger, verticalAlign: 'baseline', marginLeft: 6 }}>
      <span style={{ whiteSpace: 'nowrap' }}>not sure</span><span style={{ fontWeight: 500, opacity: 0.85 }}> · {reason.length > 70 ? `${reason.slice(0, 68)}…` : reason}</span>
    </span>
  );
}

/** The model's structured answer: the summary, then each line's explanation with its dot and tag. */
export function AnswerBody({ view, mode, labels }: { view: AnswerView; mode: 'line' | 'block' | 'node'; /** Names for the numbered items (a line's step letters). */ labels?: readonly string[] }) {
  const tk = useTokens();
  if (view.plain) {
    const c = view.plain.confidence;
    return (
      <div data-explain-answer="" style={{ display: 'flex', gap: 7 }}>
        {c && <ConfidenceDot c={c} />}
        <div style={{ minWidth: 0 }}>
          <AnswerText text={view.plain.text} />
          {c?.notSure && <div style={{ marginTop: 4 }}><NotSureTag reason={c.notSure} /></div>}
        </div>
      </div>
    );
  }
  const text: React.CSSProperties = { font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.primary };
  return (
    <div data-explain-answer="" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {view.summary && <p style={{ ...text, margin: 0 }}><Code text={view.summary} /></p>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {view.items.map(({ item, confidence }, i) => (
          <li key={i} data-explain-item="" style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            {confidence ? <ConfidenceDot c={confidence} /> : <span style={{ width: 8, flexShrink: 0 }} />}
            {mode === 'block' && <span style={{ flexShrink: 0, minWidth: 14, color: tk.text.faint, font: `600 11px/1.9 ${fontFamily.mono}` }}>{labels?.[(item.line ?? i + 1) - 1] ?? item.line ?? i + 1}</span>}
            <span style={{ ...text, minWidth: 0 }}>
              {item.what && <Code text={item.what} />}{item.what && item.effect ? ' ' : ''}
              {item.effect && <span style={{ color: tk.text.secondary }}><Code text={item.effect} /></span>}
              {confidence?.notSure && <NotSureTag reason={confidence.notSure} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface CompareCtx { check?: GroundingContext; lineNo?: number }

/** Compare models: every downloaded model's answer to the same question, side by side. */
export function ComparePanel({ entries, mode, state, onClose }: { entries: CompareEntry[]; mode: 'line' | 'block' | 'node'; state: CompareCtx; onClose: () => void }) {
  const tk = useTokens();
  return (
    <div data-explain-compare="" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: `1px solid ${alpha(tk.accent.base, 0.18)}` }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>
        Compare models<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· one at a time, so only one is in memory</span>
        <button type="button" style={{ marginLeft: 'auto', border: 0, background: 'none', color: tk.accent.text, cursor: 'pointer', font: `600 11px ${fontFamily.ui}` }} onClick={onClose}>Close</button>
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
        {entries.map(e => <CompareCard key={e.modelId} e={e} mode={mode} state={state} />)}
      </div>
    </div>
  );
}

function CompareCard({ e, mode, state }: { e: CompareEntry; mode: 'line' | 'block' | 'node'; state: CompareCtx }) {
  const tk = useTokens();
  const spec = modelById(e.modelId);
  const done = e.state === 'done';
  const view = useMemo(
    () => viewAnswer({ kind: mode, raw: e.meta?.raw ?? e.text, tokens: e.meta?.tokens as TokenLp[] | undefined, check: state.check, lineNo: state.lineNo, done }),
    [e.text, e.meta, mode, state.check, state.lineNo, done],
  );
  const elapsed = useElapsed(e.state === 'running' ? e.startedAt : undefined);
  return (
    <div data-explain-compare-card={e.modelId} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '7px 9px', borderRadius: radius.md, background: tk.bg.field }}>
      <span style={{ font: `650 11.5px ${fontFamily.ui}`, color: tk.text.primary }}>{spec.name}{spec.thinks ? ' · thinks first' : ''}</span>
      {e.state === 'waiting' && <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>Waiting for its turn…</span>}
      {e.state === 'running' && (view.empty || view.split.thinkingNow) && <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: tk.text.muted }}>{view.split.thinkingNow ? 'Thinking' : 'Loading and answering'}… {elapsed} s</span>}
      {e.state === 'failed' && <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: tk.status.danger }}>{e.error ?? 'Failed.'}</span>}
      {!view.empty && !view.split.thinkingNow && <AnswerBody view={view} mode={mode} />}
      {done && e.meta && <span style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.text.faint }}>{(e.meta.ms / 1000).toFixed(1)} s{e.meta.tokensPerSec ? ` · ${e.meta.tokensPerSec} tokens a second` : ''}</span>}
    </div>
  );
}
