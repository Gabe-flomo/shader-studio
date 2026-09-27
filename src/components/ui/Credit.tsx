import type { CSSProperties } from 'react';
import { creditPlace, creditShort, creditSentence, type SourceCredit } from '../../types/credit';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { openExternal } from '../../utils/openExternal';
import { Icon } from './Icon';

/**
 * Where an example comes from (types/credit.ts), three ways.
 *
 * CreditTag: one quiet line under an example's name in a list ("The Book of
 * Shaders · Ch. 5 · Step and Smoothstep"). Plain text, because the row itself
 * is the button.
 *
 * CreditLink: the full credit as a link that opens the source in a new tab
 * (the system browser in the desktop app), for the Play page's Notes card.
 *
 * CreditCaption: a small linked line under a picture, for Present blocks.
 */
export function CreditTag({ source, size = 11, compact = false, style }: { source: SourceCredit; size?: number; /** A narrow list: the chapter and section only (the title is in the tooltip). */ compact?: boolean; style?: CSSProperties }) {
  const tk = useTokens();
  return (
    <span
      data-credit=""
      title={creditSentence(source)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, color: tk.text.muted, font: `500 ${size}px ${fontFamily.ui}`, ...style }}
    >
      <Icon name="book" size={size + 1} style={{ flexShrink: 0, color: tk.accent.base }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creditShort(source, compact)}</span>
    </span>
  );
}

/**
 * CreditCaption: one small linked line under a picture (Present blocks):
 * "From The Book of Shaders, Ch. 5 · Shaping functions · Step and Smoothstep".
 * Exported pages print the same line (exportPresentation.ts creditHtml).
 */
export function CreditCaption({ source, align = 'center', style }: { source: SourceCredit; align?: 'center' | 'left'; style?: CSSProperties }) {
  const tk = useTokens();
  const place = creditPlace(source);
  return (
    <div data-credit="" style={{ color: tk.text.faint, font: `500 12px/1.45 ${fontFamily.ui}`, textAlign: align, ...style }}>
      <Icon name="book" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5, color: tk.accent.base }} />
      From{' '}
      <a
        href={source.url} target="_blank" rel="noopener noreferrer"
        onClick={e => { e.stopPropagation(); openExternal(source.url, e); }}
        title={`${creditSentence(source)}. Opens ${source.url}`}
        style={{ color: tk.accent.text, fontWeight: 600, textDecoration: 'none' }}
      >{source.title}</a>
      {place.length > 0 && <>, {place.join(' · ')}</>}
    </div>
  );
}

export function CreditLink({ source, style }: { source: SourceCredit; style?: CSSProperties }) {
  const tk = useTokens();
  const place = creditPlace(source);
  return (
    <a
      data-credit=""
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => { e.stopPropagation(); openExternal(source.url, e); }}
      title={`${creditSentence(source)}. Opens ${source.url}`}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 7, padding: '6px 9px', borderRadius: radius.md, textDecoration: 'none',
        background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `500 11.5px/1.4 ${fontFamily.ui}`, ...style,
      }}
    >
      <Icon name="book" size={14} style={{ flexShrink: 0, marginTop: 1, color: tk.accent.base }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: tk.text.faint }}>From </span>
        <b style={{ fontWeight: 650, color: tk.text.primary }}>{source.title}</b>
        {/* The author wraps as a whole, so a name never splits across lines. */}
        {source.author && <> <span style={{ color: tk.text.faint, whiteSpace: 'nowrap' }}>by {source.author}</span></>}
        {place.length > 0 && <span style={{ display: 'block', color: tk.accent.text }}>{place.join(' · ')}</span>}
        {source.licence && <span style={{ display: 'block', color: tk.text.faint, fontSize: 10.5 }}>Licence: {source.licence}</span>}
      </span>
      <Icon name="popout" size={12} style={{ flexShrink: 0, marginTop: 2, color: tk.text.faint }} />
    </a>
  );
}
