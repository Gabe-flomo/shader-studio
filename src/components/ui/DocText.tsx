import { Fragment, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';

/**
 * Docstring text with a little formatting, for node descriptions and socket
 * hints. Supports exactly three things, so authors can't go wrong:
 *
 *   `code`      → monospace chip (socket names, ranges, GLSL)
 *   **bold**    → emphasis
 *   - item      → a bullet (one per line)
 *
 * Blank lines separate paragraphs. Everything else is plain text.
 */
export function DocText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const tk = useTokens();
  const blocks = splitBlocks(text);
  const codeStyle: React.CSSProperties = {
    font: `11px ${fontFamily.mono}`, padding: '1px 5px', borderRadius: radius.xs,
    background: alpha(tk.accent.base, 0.1), color: tk.accent.base,
  };
  const renderInline = (s: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
    let last = 0; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1] !== undefined) out.push(<code key={i++} style={codeStyle}>{m[1]}</code>);
      else out.push(<b key={i++} style={{ color: tk.text.primary, fontWeight: 600 }}>{m[2]}</b>);
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.45, ...style }}>
      {blocks.map((b, i) => b.kind === 'list' ? (
        <ul key={i} style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>
      ) : (
        <p key={i} style={{ margin: 0 }}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{renderInline(l)}</Fragment>)}</p>
      ))}
    </div>
  );
}

type Block = { kind: 'para'; lines: string[] } | { kind: 'list'; items: string[] };

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { cur = null; continue; }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (cur?.kind !== 'list') { cur = { kind: 'list', items: [] }; blocks.push(cur); }
      cur.items.push(bullet[1]);
    } else {
      if (cur?.kind !== 'para') { cur = { kind: 'para', lines: [] }; blocks.push(cur); }
      cur.lines.push(line.trim());
    }
  }
  return blocks;
}
