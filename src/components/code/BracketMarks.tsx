/**
 * The bracket marks over a code field: the pair at the caret (accent
 * outline) and every unmatched bracket (danger fill). Positioned by line and
 * column on a monospace grid, so the layer goes wherever the text goes.
 */
import { useMemo } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha } from '../../theme/tokens';
import { bracketAtCaret, lineCol, scanBrackets } from './brackets';

export function BracketMarks({ text, caret, charW, lineH, padX = 0, padY = 0, fontSize }: {
  text: string;
  /** The caret when the selection is empty; null hides the pair mark. */
  caret: number | null;
  charW: number;
  lineH: number;
  padX?: number;
  padY?: number;
  fontSize: number;
}) {
  const tk = useTokens();
  const scan = useMemo(() => scanBrackets(text), [text]);
  const at = caret === null ? -1 : bracketAtCaret(text, caret);
  const partner = at >= 0 ? scan.pairs.get(at) : undefined;
  const marks: Array<{ i: number; kind: 'pair' | 'bad' }> = scan.unmatched.map(i => ({ i, kind: 'bad' as const }));
  if (at >= 0 && partner !== undefined) marks.push({ i: at, kind: 'pair' }, { i: partner, kind: 'pair' });
  if (!marks.length) return null;
  const h = Math.round(fontSize * 1.25), top = (lineH - h) / 2;
  return (
    <>
      {marks.map(m => {
        const { line, col } = lineCol(text, m.i);
        const pair = m.kind === 'pair';
        return (
          <span
            key={`${m.kind}:${m.i}`}
            aria-hidden
            data-bracket={m.kind}
            style={{
              position: 'absolute', left: padX + col * charW - 1, top: padY + line * lineH + top, width: charW + 2, height: h, borderRadius: 3, pointerEvents: 'none', boxSizing: 'border-box',
              background: pair ? alpha(tk.accent.base, 0.22) : alpha(tk.status.danger, 0.3),
              boxShadow: `inset 0 0 0 1px ${pair ? tk.accent.base : tk.status.danger}`,
            }}
          />
        );
      })}
    </>
  );
}
