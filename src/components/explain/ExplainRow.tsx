/**
 * The Explain row under an Expression Block line (and Return), and under a Custom Function's statements: one
 * **Explain** action, which asks the on-device language model (docs/explain-model.md; it offers the download when
 * the model isn't there), and the line's build-up folded to a one-line summary (what the line reads, how many steps,
 * what it sets). Open it for the build-up view: pictures of each step, step-through on the ▶ preview, hover
 * highlighting, Make a node and Where else.
 */
import { memo, useMemo, useState } from 'react';
import { explainLine, freeNames, type ExplainContext, type UseQuery } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExplainView } from './ExplainView';
import { ExplainMore } from './ExplainMore';
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
  /** Where the line is, for Explain ("line 3 of this block", "the Return line"). */
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
  if (!ex.ok && ex.error === 'Nothing to explain') return null;
  // The summary: the names it reads → its steps → what it sets ("uv, t → 3 steps → d")
  const reads = ex.ok ? freeNames(ex) : [];
  const sets = ex.ok ? ex.line.target ?? (ex.line.isReturn ? 'the result' : 'a value') : '';
  const summary = ex.ok ? `${reads.length ? `${reads.slice(0, 3).join(', ')}${reads.length > 3 ? ', …' : ''} → ` : ''}${ex.steps.length ? `${ex.steps.length} step${ex.steps.length === 1 ? '' : 's'} → ` : ''}${sets}` : '';
  return (
    <div data-explain-row={ex.ok ? '' : 'error'} style={{ marginLeft: indent, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 1 auto', minWidth: 0, maxWidth: '100%' }}>
          <ExplainMore key={text} text={text} ctx={ctx} where={where} />
        </div>
        {ex.ok ? (
          <button type="button" aria-expanded={open} data-explain-toggle="" onClick={() => setOpen(o => !o)} title={open ? 'Hide the build-up' : 'How this line is built, step by step, with pictures'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 160px', height: 26, padding: '0 6px', border: 0, borderRadius: radius.sm, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <Icon name={open ? 'chevD' : 'chevR'} size={11} style={{ color: tk.text.faint }} />
            <span style={{ font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint, flexShrink: 0 }}>Build-up</span>
            <span data-explain-summary="" style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{summary}</span>
          </button>
        ) : (
          <span style={{ alignSelf: 'center', font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>Can’t read this line yet ({ex.error}).</span>
        )}
      </div>
      {ex.ok && open && (
        <ExplainView ex={ex} onMakeNode={onMakeNode} onFindUses={onFindUses} onShowPicture={onShowPicture} editable={{ start: exprStart, end: text.length }}
          buildUp={buildUp} focusSignal={openRequest} />
      )}
    </div>
  );
});
