/**
 * The fold under an Expression Block line (and Return): light on purpose. Folded, it is one quiet
 * **Explain** toggle. Open, it shows the pattern the line is, by a short plain name ("Flipping a
 * mask", "Repeating grid") when it is a known one, then one sentence saying what the line does (the
 * rule-based explainer's lead), then **Open explain view**: the full view of the line
 * (LineExplainView.tsx: the steps, a live picture, quick overrides and the model's explanation) in
 * place of the editor. No model action here: the editor's only one is Explain the block.
 */
import { memo, useMemo, useState } from 'react';
import { explainLine, freeNames, type ExplainContext, type LineExplanation } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
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

/**
 * The pattern the whole line is, short and plain: what it is usually for ("Flipping a mask",
 * "Repeating grid"), else the idiom's name without its formula ("Invert"). None when it isn't one.
 */
export function linePattern(ex: LineExplanation): string | undefined {
  const use = ex.use?.trim().replace(/^(a|an|the) /i, '');
  const name = use || lineIdiom(ex)?.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : undefined;
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
  const pattern = ex.ok ? linePattern(ex) : undefined;
  return (
    <div data-line-fold={ex.ok ? '' : 'error'} style={{ marginLeft: indent, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ex.ok ? (
        <button type="button" aria-expanded={open} data-explain-toggle="" onClick={() => setOpen(o => !o)} title={open ? 'Fold' : 'What this line does, in short'}
          style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 6px', border: 0, borderRadius: radius.sm, background: 'none', cursor: 'pointer', alignSelf: 'flex-start', color: tk.text.faint, font: `600 11.5px ${fontFamily.ui}` }}>
          <Icon name={open ? 'chevD' : 'chevR'} size={11} />Explain
        </button>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>
          Can’t read this line yet ({ex.error}).
        </span>
      )}
      {ex.ok && open && (
        <div data-line-fold-body="" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px', borderRadius: radius.lg, background: tk.bg.subtle, border: `1px solid ${tk.border.subtle}` }}>
          {pattern && (
            <span data-line-fold-pattern="" title={lineIdiom(ex) ? `A well-known shader pattern: ${lineIdiom(ex)}` : 'A well-known shader pattern'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `650 12px ${fontFamily.ui}`, color: tk.text.primary }}>
              <Icon name="star" size={11} style={{ color: tk.status.success }} />{pattern}
            </span>
          )}
          <span data-line-fold-lead="" style={{ font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary }}>
            <ExplainText segs={ex.leadSegs} />
          </span>
          <button type="button" data-explain-action="open-view" onClick={onOpenView} title="The line step by step, with a live picture of each step and values to try"
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, marginTop: 2, padding: '0 10px', border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}` }}>
            <Icon name="popout" size={12} />Open explain view
          </button>
        </div>
      )}
    </div>
  );
});
