/**
 * The Explain row under an Expression Block line (and Return): folded to a one-line summary
 * (what the line reads, how many steps, what it sets); open it for the build-up view, with
 * hover highlighting, step-through on the ▶ preview, Make a node and Where else.
 */
import { memo, useMemo, useState } from 'react';
import { explainLine, freeNames, type ExplainContext, type UseQuery } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExplainView } from './ExplainView';
import type { BuildUpHost } from './buildUpHost';

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
  /** Show this line's picture (the ▶ line preview), where there is no build-up host. */
  onShowPicture?: () => void;
  /** Where the line is, for "Explain more" ("line 3 of this block", "the Return line"). */
  where?: string;
  /** The line's place in an Expression Block: wiring-aware pictures and step-through. */
  buildUp?: BuildUpHost;
  /** Changes when ▶ on the line was pressed: the row opens, ready to step through. */
  openRequest?: number;
}

export const ExplainRow = memo(function ExplainRow({ text, exprStart, ctx, onMakeNode, onFindUses, indent = 0, onShowPicture, where, buildUp, openRequest }: ExplainRowProps) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  // A new open request (▶ pressed) opens it: adjusted while rendering, not in an effect
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (openRequest !== seenRequest) { setSeenRequest(openRequest); if (openRequest) setOpen(true); }
  const ex = useMemo(() => explainLine(text, ctx), [text, ctx]);
  if (!ex.ok) {
    return (
      <div data-explain-row="error" style={{ marginLeft: indent, font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>
        Explain: {ex.error === 'Nothing to explain' ? 'nothing to explain yet.' : `can’t read this line yet (${ex.error}).`}
      </div>
    );
  }
  // The summary: the names it reads → its steps → what it sets ("uv, t → 3 steps → d")
  const reads = freeNames(ex);
  const sets = ex.line.target ?? (ex.line.isReturn ? 'the result' : 'a value');
  const summary = `${reads.length ? `${reads.slice(0, 3).join(', ')}${reads.length > 3 ? ', …' : ''} → ` : ''}${ex.steps.length ? `${ex.steps.length} step${ex.steps.length === 1 ? '' : 's'} → ` : ''}${sets}`;
  return (
    <div data-explain-row="" style={{ marginLeft: indent, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" aria-expanded={open} data-explain-toggle="" onClick={() => setOpen(o => !o)} title={open ? 'Hide the build-up' : 'Explain this line: how it is built, step by step, with pictures'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 6px', margin: '-2px 0 0 -6px', border: 0, borderRadius: radius.sm, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={11} style={{ color: tk.text.faint }} />
        <span style={{ font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint, flexShrink: 0 }}>Explain</span>
        <span data-explain-summary="" style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{summary}</span>
      </button>
      {open && (
        <ExplainView ex={ex} onMakeNode={onMakeNode} onFindUses={onFindUses} onShowPicture={onShowPicture} editable={{ start: exprStart, end: text.length }} explainMore={{ ctx, where }}
          buildUp={buildUp} focusSignal={openRequest} />
      )}
    </div>
  );
});
