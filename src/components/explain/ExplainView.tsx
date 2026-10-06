/**
 * An explanation, shown: the code with the hovered part highlighted, one sentence, and the
 * "First … then …" steps. Hovering a step (or an idiom chip) highlights its sub-expression.
 * Each step can be made into a node, and a recognised idiom can be looked for elsewhere.
 */
import { useState } from 'react';
import type { Explanation, Step, UseQuery } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';

export interface ExplainViewProps {
  ex: Explanation;
  /** The sentence to lead with (a line's own: "d is …"); defaults to the explanation's. */
  sentence?: string;
  /** Make a node from a span of `ex.source` (a step, or the whole thing). */
  onMakeNode?: (span: { start: number; end: number }) => void;
  onFindUses?: (query: UseQuery, title: string) => void;
  /** Only spans inside this range can be made into nodes (the expression part of a line). */
  editable?: { start: number; end: number };
}

export function ExplainView({ ex, sentence, onMakeNode, onFindUses, editable }: ExplainViewProps) {
  const tk = useTokens();
  const [hover, setHover] = useState<Step | null>(null);
  const src = ex.source;
  const hs = hover?.start ?? -1, he = hover?.end ?? -1;
  const canMake = (s: { start: number; end: number }) => !!onMakeNode && (!editable || (s.start >= editable.start && s.end <= editable.end));
  const rootSpan = { start: ex.root.start, end: ex.root.end };
  const rootIdiom = ex.idioms.find(h => h.node === ex.root);
  // A touch screen can't hover: a step's actions stay visible there (a tap still lights the step)
  const noHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;
  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', border: 0, borderRadius: radius.sm,
    background: 'none', color: tk.accent.text, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`, flexShrink: 0,
  };
  return (
    <div data-explain-view="" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.subtle, border: `1px solid ${tk.border.subtle}` }}>
      {/* The code, with the hovered part lit */}
      <div data-explain-code="" style={{ font: `500 12px/1.6 ${fontFamily.mono}`, color: tk.text.secondary, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {hs >= 0 ? (
          <>
            {src.slice(0, hs)}
            <mark data-explain-highlight="" style={{ background: alpha(tk.accent.base, 0.22), color: tk.text.primary, borderRadius: 3, boxShadow: `0 0 0 1px ${alpha(tk.accent.base, 0.5)}` }}>{src.slice(hs, he)}</mark>
            {src.slice(he)}
          </>
        ) : src}
      </div>
      <div data-explain-sentence="" style={{ font: `600 13px/1.45 ${fontFamily.ui}`, color: tk.text.primary }}>{sentence ?? ex.sentence}</div>
      {ex.steps.length > 0 && (
        <ol data-explain-steps="" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }} onMouseLeave={() => setHover(null)}>
          {ex.steps.map((s, i) => {
            const lead = ex.steps.length === 1 ? '' : i === 0 ? 'First' : i === ex.steps.length - 1 ? 'Finally' : 'Then';
            const on = hover === s;
            return (
              <li key={s.label} data-explain-step={s.label} onMouseEnter={() => setHover(s)} onFocus={() => setHover(s)} tabIndex={0}
                style={{ display: 'flex', flexWrap: noHover ? 'wrap' : undefined, gap: 8, alignItems: 'flex-start', padding: '4px 6px', borderRadius: radius.sm, background: on ? alpha(tk.accent.base, 0.08) : 'none', outline: 'none' }}>
                <span style={{ flexShrink: 0, minWidth: 18, height: 18, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: on ? tk.accent.base : tk.bg.field, color: on ? '#fff' : tk.text.muted, font: `650 10.5px ${fontFamily.mono}` }}>{s.label}</span>
                <span style={{ flex: 1, minWidth: 0, font: `500 12.5px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>
                  {lead && <span style={{ color: tk.text.faint }}>{lead}, </span>}
                  <code style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary, background: tk.bg.field, padding: '0 4px', borderRadius: 4 }}>{s.code}</code>
                  {' '}{s.text}.
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
    </div>
  );
}
