import { createPortal } from 'react-dom';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { Completion } from './glslReference';

/**
 * Autocomplete list shown under the caret: up to six matches with the typed prefix in accent,
 * the selected item's description beside it, and the keys that drive it. `x`/`y` are viewport
 * coordinates of the word's start, just below the line.
 */
export function CompletionPopup({ items, index, word, x, y, onPick, onHover }: {
  items: Completion[];
  index: number;
  word: string;
  x: number;
  y: number;
  onPick: (item: Completion) => void;
  onHover: (index: number) => void;
}) {
  const tk = useTokens();
  const sel = items[index];
  const kbd = { font: `600 10px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.hover, borderRadius: 4, padding: '1px 4px', marginRight: 4 };
  const left = Math.min(x, window.innerWidth - 540);

  return createPortal(
    <div
      role="listbox"
      aria-label="Suggestions"
      // Keep focus in the field: a click picks without blurring it
      onMouseDown={e => e.preventDefault()}
      style={{
        position: 'fixed', left: Math.max(8, left), top: y, zIndex: 2100, display: 'flex', alignItems: 'flex-start', padding: 4,
        background: tk.bg.panel, borderRadius: radius.lg, boxShadow: tk.shadow.popover, font: `12px ${fontFamily.ui}`, color: tk.text.primary,
      }}
    >
      <div style={{ width: 300 }}>
        {items.map((c, i) => {
          const on = i === index;
          const k = c.name.toLowerCase().indexOf(word.toLowerCase());
          return (
            <div
              key={`${c.kind}:${c.name}`}
              role="option"
              aria-selected={on}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(c)}
              style={{
                height: 30, display: 'flex', alignItems: 'center', gap: 9, padding: '0 8px', borderRadius: radius.md, cursor: 'pointer',
                background: on ? tk.bg.selected : 'transparent',
              }}
            >
              {c.kind === 'var'
                ? <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, margin: '0 1px', background: TYPE_COLORS[c.type ?? ''] ?? tk.text.faint }} />
                : <span style={{ width: 10, flexShrink: 0, textAlign: 'center', font: `600 11px ${fontFamily.mono}`, color: c.kind === 'fn' ? tk.kind.fn : tk.text.faint }}>
                    {c.kind === 'fn' ? 'ƒ' : c.kind === 'const' ? 'π' : '·'}
                  </span>}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 12.5px ${fontFamily.mono}` }}>
                {k >= 0 ? <>{c.name.slice(0, k)}<b style={{ color: tk.accent.text }}>{c.name.slice(k, k + word.length)}</b>{c.name.slice(k + word.length)}</> : c.name}
                {c.detail && <span style={{ color: tk.text.faint, marginLeft: 2 }}>{c.detail}</span>}
              </span>
              {c.type && <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{c.type}</span>}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 12, padding: '6px 8px 3px', color: tk.text.faint, fontSize: 11 }}>
          <span><span style={kbd}>↑↓</span>move</span><span><span style={kbd}>Tab</span>insert</span><span><span style={kbd}>Esc</span>close</span>
        </div>
      </div>
      {sel?.doc && (
        <div style={{ width: 200, marginLeft: 4, padding: '10px 12px', borderRadius: radius.md, background: tk.bg.subtle, color: tk.text.muted, lineHeight: 1.45 }}>
          <div style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary }}>
            {sel.name}{sel.detail}{sel.type && sel.kind === 'fn' ? ` → ${sel.type}` : ''}
          </div>
          <div style={{ marginTop: 4 }}>{sel.doc}</div>
        </div>
      )}
    </div>,
    document.body,
  );
}
