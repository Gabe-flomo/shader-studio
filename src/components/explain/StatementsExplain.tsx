/**
 * Explain a block of code statement by statement (a Custom Function's body): one Explain row
 * per simple statement, folded under a header so it costs nothing until opened.
 */
import { useMemo, useState } from 'react';
import { parseLine, splitStatements, type ExplainContext, type UseQuery } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExplainRow } from './ExplainRow';
import { GlslCode } from './GlslCode';

export function StatementsExplain({ code, ctx, onMakeNode, onFindUses, onShowPicture }: {
  code: string;
  ctx: ExplainContext;
  /** A span of `code` to make into a node. */
  onMakeNode?: (span: { start: number; end: number }) => void;
  onFindUses?: (q: UseQuery, title: string) => void;
  /** Show a statement's picture (the ▶ line preview): the variable it declares, or Return. */
  onShowPicture?: (stmt: { target?: string; isReturn: boolean }) => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const stmts = useMemo(() => (open ? splitStatements(code) : []), [code, open]);
  return (
    <div data-statements-explain="" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `600 12.5px ${fontFamily.ui}`, textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} />
        Explain
        <span style={{ fontWeight: 400, color: tk.text.faint }}>statement by statement, in plain words</span>
      </button>
      {open && stmts.length === 0 && <span style={{ fontSize: 12, color: tk.text.muted }}>No statements to explain yet.</span>}
      {open && stmts.map((s, i) => {
        const parsed = parseLine(s.text);
        const exprStart = parsed.ok ? parsed.line.exprStart : 0;
        return (
          <div key={`${i}:${s.start}`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ font: `500 11.5px ${fontFamily.mono}` }}>
              <span style={{ color: tk.text.disabled, marginRight: 8 }}>{s.line}</span><GlslCode code={s.text} />
            </div>
            <ExplainRow text={s.text} exprStart={exprStart} ctx={ctx} onFindUses={onFindUses}
              onShowPicture={onShowPicture && parsed.ok && (parsed.line.isReturn || parsed.line.declType) ? () => onShowPicture({ target: parsed.line.target, isReturn: parsed.line.isReturn }) : undefined}
              onMakeNode={onMakeNode ? span => onMakeNode({ start: s.start + span.start, end: s.start + span.end }) : undefined} />
          </div>
        );
      })}
    </div>
  );
}
