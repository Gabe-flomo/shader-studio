/**
 * The Explain row under an Expression Block line (and Return): one sentence, folded; open it
 * for the steps, with hover highlighting, Make a node and Where else.
 */
import { memo, useMemo, useState } from 'react';
import { explainLine, type ExplainContext, type UseQuery } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExplainView } from './ExplainView';
import { ExplainText } from './ExplainText';

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
}

export const ExplainRow = memo(function ExplainRow({ text, exprStart, ctx, onMakeNode, onFindUses, indent = 0, onShowPicture }: ExplainRowProps) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const ex = useMemo(() => explainLine(text, ctx), [text, ctx]);
  if (!ex.ok) {
    return (
      <div data-explain-row="error" style={{ marginLeft: indent, font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>
        Explain: {ex.error === 'Nothing to explain' ? 'nothing to explain yet.' : `can’t read this line yet (${ex.error}).`}
      </div>
    );
  }
  return (
    <div data-explain-row="" style={{ marginLeft: indent, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" aria-expanded={open} data-explain-toggle="" onClick={() => setOpen(o => !o)} title={open ? 'Hide the steps' : 'Explain this line, step by step'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 6px', margin: '-2px 0 0 -6px', border: 0, borderRadius: radius.sm, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={11} style={{ color: tk.text.faint }} />
        <span style={{ font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint, flexShrink: 0 }}>Explain</span>
        <span data-explain-summary="" style={{ font: `500 12px ${fontFamily.ui}`, color: tk.text.muted, whiteSpace: open ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}><ExplainText segs={ex.leadSegs} /></span>
      </button>
      {open && (
        <ExplainView ex={ex} onMakeNode={onMakeNode} onFindUses={onFindUses} onShowPicture={onShowPicture} editable={{ start: exprStart, end: text.length }} />
      )}
    </div>
  );
});
