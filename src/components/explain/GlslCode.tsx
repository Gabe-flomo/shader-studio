/**
 * A GLSL snippet in the explainer, highlighted with the app's own tokenizer and colours (the GLSL
 * page's and the code card's: glslSyntax.ts via highlightGlsl), with optional lit spans: the
 * hovered step, or every place a hovered variable is read. Hovering a variable in the code
 * reports its name, so the explanation can light its chips.
 */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha } from '../../theme/tokens';
import { highlightGlsl } from '../NodeGraph/codeCard/highlight';

export interface CodeSpan { start: number; end: number; kind: 'step' | 'var' }

export interface GlslCodeProps {
  code: string;
  /** Spans to light, in `code`'s coordinates. */
  spans?: CodeSpan[];
  /** Where each variable is read: start offset → name. Those tokens report hovers. */
  vars?: Map<number, string>;
  onVarHover?: (name: string | null) => void;
  style?: CSSProperties;
}

interface Piece { text: string; color: string; start: number }

/** The highlighted tokens with absolute offsets, cut wherever a span starts or ends. */
function pieces(code: string, dark: boolean, cuts: number[]): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  highlightGlsl(code, dark).forEach((line, li) => {
    if (li > 0) { out.push({ text: '\n', color: 'inherit', start: at }); at += 1; }
    for (const t of line) {
      let s = at;
      const end = at + t.text.length;
      for (const c of cuts) if (c > s && c < end) { out.push({ text: code.slice(s, c), color: t.color, start: s }); s = c; }
      out.push({ text: code.slice(s, end), color: t.color, start: s });
      at = end;
    }
  });
  return out;
}

export function GlslCode({ code, spans = [], vars, onVarHover, style }: GlslCodeProps) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  const cuts = [...new Set(spans.flatMap(s => [s.start, s.end]))];
  const ps = pieces(code, dark, cuts);
  const inSpan = (p: Piece) => spans.find(s => p.start >= s.start && p.start < s.end && p.text !== '\n');
  // Group neighbouring pieces lit by the same span into one <mark>
  const out: ReactNode[] = [];
  let i = 0;
  const token = (p: Piece, k: number) => {
    const name = vars?.get(p.start);
    return name && onVarHover
      ? <span key={k} data-code-var={name} style={{ color: p.color, cursor: 'default' }} onMouseEnter={() => onVarHover(name)} onMouseLeave={() => onVarHover(null)}>{p.text}</span>
      : <span key={k} style={{ color: p.color }}>{p.text}</span>;
  };
  while (i < ps.length) {
    const sp = inSpan(ps[i]);
    if (!sp) { out.push(token(ps[i], i)); i++; continue; }
    const group: ReactNode[] = [];
    const first = i;
    while (i < ps.length && inSpan(ps[i]) === sp) { group.push(token(ps[i], i)); i++; }
    const step = sp.kind === 'step';
    out.push(
      <mark key={`m${first}`} {...(step ? { 'data-explain-highlight': '' } : { 'data-explain-var-highlight': '' })}
        style={{ background: alpha(tk.accent.base, step ? 0.2 : 0.3), color: 'inherit', borderRadius: 3, boxShadow: `0 0 0 1px ${alpha(tk.accent.base, step ? 0.5 : 0.7)}` }}>
        {group}
      </mark>,
    );
  }
  // data-fn-code: a click on a function name opens its card (functionCard/triggers.ts)
  return <code data-glsl-code="" data-fn-code="" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...style }}>{out.map((n, k) => <Fragment key={k}>{n}</Fragment>)}</code>;
}
