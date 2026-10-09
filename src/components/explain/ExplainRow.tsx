/**
 * The Explain row under an Expression Block line (and Return), and under a Custom Function's statements: one
 * **Explain** action, which asks the on-device language model (docs/explain-model.md; it offers the download when
 * the model isn't there), and a folded "Show working" with the line's build-up (ExplainView): hover highlighting,
 * the numbers, Make a node and Where else.
 */
import { memo, useMemo, useState } from 'react';
import { explainLine, type ExplainContext, type UseQuery } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExplainView } from './ExplainView';
import { ExplainMore } from './ExplainMore';

export interface ExplainRowProps {
  /** The whole line as it compiles: `float d = length(p) - r` or `return col`. */
  text: string;
  /** Where the expression starts in `text` (only it can be made into a node). */
  exprStart: number;
  ctx: ExplainContext;
  onMakeNode?: (span: { start: number; end: number }) => void;
  onFindUses?: (q: UseQuery, title: string) => void;
  /** Indent, to sit under the line's expression. */
  indent?: number;
  /** Show this line's picture (the ▶ line preview), for lines a plot can't show. */
  onShowPicture?: () => void;
  /** Where the line is, for Explain ("line 3 of this block", "the Return line"). */
  where?: string;
}

export const ExplainRow = memo(function ExplainRow({ text, exprStart, ctx, onMakeNode, onFindUses, indent = 0, onShowPicture, where }: ExplainRowProps) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const ex = useMemo(() => explainLine(text, ctx), [text, ctx]);
  if (!ex.ok && ex.error === 'Nothing to explain') return null;
  return (
    <div data-explain-row={ex.ok ? '' : 'error'} style={{ marginLeft: indent, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <ExplainMore key={text} text={text} ctx={ctx} where={where} />
        </div>
        {ex.ok && (
          <button type="button" aria-expanded={open} data-explain-toggle="" onClick={() => setOpen(o => !o)} title={open ? 'Hide the working' : 'Show how this line builds up its value, with the numbers'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, flexShrink: 0, padding: '0 6px', border: 0, borderRadius: radius.sm, background: 'none', cursor: 'pointer', color: tk.text.faint, font: `600 11px ${fontFamily.ui}` }}>
            <Icon name={open ? 'chevD' : 'chevR'} size={11} />Show working
          </button>
        )}
      </div>
      {ex.ok && open && (
        <ExplainView ex={ex} onMakeNode={onMakeNode} onFindUses={onFindUses} onShowPicture={onShowPicture} editable={{ start: exprStart, end: text.length }} />
      )}
    </div>
  );
});
