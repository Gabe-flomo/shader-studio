import { createPortal } from 'react-dom';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { Completion } from './glslReference';
import { portalGuard } from '../ui/portalGuard';

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
  // A helper with parameters or an example gets a wider description; on a phone it goes under the list.
  const rich = !!(sel?.args?.length || sel?.example);
  const docW = rich ? 280 : 200;
  const stack = window.innerWidth < 320 + docW + 24;
  const left = stack ? Math.min(x, window.innerWidth - 316) : Math.min(x, window.innerWidth - (316 + docW));

  return createPortal(
    <div
      role="listbox"
      aria-label="Suggestions"
      // Keep focus in the field: a click picks without blurring it
      {...portalGuard}
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'fixed', left: Math.max(8, left), top: y, zIndex: 2100, display: 'flex', flexDirection: stack ? 'column' : 'row', alignItems: 'flex-start', padding: 4,
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
        <div style={{ width: stack ? 300 : docW, boxSizing: 'border-box', margin: stack ? '4px 0 0' : '0 0 0 4px', padding: '10px 12px', borderRadius: radius.md, background: tk.bg.subtle, color: tk.text.muted, lineHeight: 1.45, overflowWrap: 'anywhere', maxHeight: Math.max(160, window.innerHeight - y - 16), overflowY: 'auto' }}>
          <div style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary }}>
            {sel.name}{sel.detail}{sel.type && (sel.kind === 'fn' || rich) ? ` → ${sel.type}` : ''}
          </div>
          <div style={{ marginTop: 4 }}>{sel.doc}</div>
          {!!sel.args?.length && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5 }}>
              {sel.args.map(a => (
                <div key={a.name}>
                  <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{a.name}</span>
                  <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}> {a.type}{a.optional ? ', optional' : ''}</span>
                  <span> · {a.doc}</span>
                </div>
              ))}
            </div>
          )}
          {sel.returns && <div style={{ marginTop: 6, fontSize: 11.5 }}><b style={{ color: tk.text.secondary, fontWeight: 600 }}>Returns</b> {sel.returns}</div>}
          {sel.example && (
            <pre style={{ margin: '8px 0 0', padding: '6px 8px', borderRadius: 6, background: tk.bg.panel, color: tk.text.secondary, font: `500 11px/1.45 ${fontFamily.mono}`, whiteSpace: 'pre-wrap' }}>{sel.example}</pre>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
