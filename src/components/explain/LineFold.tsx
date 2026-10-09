/**
 * The fold under an Expression Block line (and Return): light on purpose. Folded, it is one line of
 * what the line reads, how many steps and what it sets ("uv, t → 3 steps → d"). Open, it says in
 * one sentence what the line does (the rule-based explainer's lead: the idiom's plain meaning when
 * there is one, else the literal reading), with the idiom's chip, and offers **Open explain view**:
 * the full view of the line (LineExplainView.tsx: the steps, a live picture, quick overrides and the
 * model's explanation) in place of the editor. No model action here: the editor's only one is
 * Explain the block.
 */
import { memo, useMemo, useState } from 'react';
import { explainLine, freeNames, type ExplainContext, type LineExplanation } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExplainText } from './ExplainText';

/** A line's build-up in one line: the names it reads → its steps → what it sets. */
export function lineSummary(ex: LineExplanation): string {
  const reads = freeNames(ex);
  const sets = ex.line.target ?? (ex.line.isReturn ? 'the result' : 'a value');
  return `${reads.length ? `${reads.slice(0, 3).join(', ')}${reads.length > 3 ? ', …' : ''} → ` : ''}${ex.steps.length ? `${ex.steps.length} step${ex.steps.length === 1 ? '' : 's'} → ` : ''}${sets}`;
}

/** The idiom the whole line is, by name, when it is one. */
export function lineIdiom(ex: LineExplanation): string | undefined {
  return ex.idioms.find(h => h.node === ex.root)?.idiom.name;
}

export interface LineFoldProps {
  /** The whole line as it compiles: `float d = length(p) - r` or `return col`. */
  text: string;
  ctx: ExplainContext;
  /** Indent, to sit under the line's expression. */
  indent?: number;
  /** Changes when ▶ on the line was pressed: the fold opens. */
  openRequest?: number;
  /** Open the full explain view of this line. */
  onOpenView: () => void;
}

export const LineFold = memo(function LineFold({ text, ctx, indent = 0, openRequest, onOpenView }: LineFoldProps) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  // A new open request (▶ pressed) opens it: adjusted while rendering, not in an effect
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (openRequest !== seenRequest) { setSeenRequest(openRequest); if (openRequest) setOpen(true); }
  const ex = useMemo(() => explainLine(text, ctx), [text, ctx]);
  if (!ex.ok && ex.error === 'Nothing to explain') return null;
  const idiom = ex.ok ? lineIdiom(ex) : undefined;
  const openView = (
    <button type="button" data-explain-action="open-view" onClick={onOpenView} title="The line step by step, with a live picture of each step and values to try"
      style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}` }}>
      <Icon name="popout" size={12} />Open explain view
    </button>
  );
  return (
    <div data-line-fold={ex.ok ? '' : 'error'} style={{ marginLeft: indent, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ex.ok ? (
        <button type="button" aria-expanded={open} data-explain-toggle="" onClick={() => setOpen(o => !o)} title={open ? 'Fold' : 'What this line does, in short'}
          style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, height: 24, padding: '0 6px', border: 0, borderRadius: radius.sm, background: 'none', cursor: 'pointer', textAlign: 'left', alignSelf: 'flex-start', maxWidth: '100%' }}>
          <Icon name={open ? 'chevD' : 'chevR'} size={11} style={{ color: tk.text.faint }} />
          <span data-explain-summary="" style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{lineSummary(ex)}</span>
          {idiom && !open && <span style={{ flexShrink: 0, font: `600 10px ${fontFamily.ui}`, color: tk.text.faint }}>· {idiom}</span>}
        </button>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>
          Can’t read this line yet ({ex.error}).
        </span>
      )}
      {ex.ok && open && (
        <div data-line-fold-body="" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px', borderRadius: radius.lg, background: tk.bg.subtle, border: `1px solid ${tk.border.subtle}` }}>
          <span data-line-fold-lead="" style={{ font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary }}>
            <ExplainText segs={ex.leadSegs} />
          </span>
          {(idiom || ex.use) && (
            <span data-explain-use="" title="A well-known shader idiom, and what it is usually for" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 9, background: alpha(tk.status.success, 0.12), color: tk.text.secondary, font: `600 11px ${fontFamily.ui}` }}>
              <Icon name="star" size={10} />{idiom ?? ex.use}{idiom && ex.use ? ` · ${ex.use}` : ''}
            </span>
          )}
          {openView}
        </div>
      )}
    </div>
  );
});
