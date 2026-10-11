/**
 * Guided Convert's code view (docs/guided-convert.md): the shader as pasted, highlighted, with line
 * numbers. Lines a step converted are tinted in that step's colour (a bar in the gutter, a wash over
 * the line); lines still in the remainder are plain. Drag over the lines (or the numbers) to select;
 * the selection snaps to whole statements, shown with an outline.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { highlightGlsl } from '../../NodeGraph/codeCard/highlight';

export interface LineTint { hue: number; label: string; active?: boolean }

const LINE_H = 20;

export function GuidedCode({ source, tints, selected, snapped, focusLine, onSelect, onHoverLine }: {
  source: string;
  /** Line (1-based) → its step's colour. */
  tints: ReadonlyMap<number, LineTint>;
  /** The lines being dragged over. */
  selected: [number, number] | null;
  /** The lines the selection snapped to (whole statements). */
  snapped: ReadonlySet<number>;
  /** Scroll this line into view when it changes. */
  focusLine?: number | null;
  onSelect: (range: [number, number] | null, done: boolean) => void;
  onHoverLine?: (line: number | null) => void;
}) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  const lines = useMemo(() => highlightGlsl(source, dark), [source, dark]);
  const drag = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The selection as last drawn, for the mouse-up that ends a drag (it can land outside the code).
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    const up = () => {
      if (drag.current === null) return;
      drag.current = null;
      onSelect(selectedRef.current, true);
    };
    // Capture: a mouse-up over another part of the page may stop its propagation.
    window.addEventListener('mouseup', up, true);
    return () => window.removeEventListener('mouseup', up, true);
  }, [onSelect]);

  useEffect(() => {
    if (!focusLine || !scroller.current) return;
    const el = scroller.current;
    const y = (focusLine - 1) * LINE_H;
    if (y < el.scrollTop + 20 || y > el.scrollTop + el.clientHeight - 60) el.scrollTo({ top: Math.max(0, y - el.clientHeight / 3), behavior: 'smooth' });
  }, [focusLine]);

  const lo = selected ? Math.min(...selected) : -1, hi = selected ? Math.max(...selected) : -1;
  const digits = String(lines.length).length;
  return (
    <div ref={scroller} data-guided-code style={{ flex: 1, minHeight: 0, overflow: 'auto', background: tk.bg.panel, userSelect: 'none', cursor: 'text', padding: '8px 0 24px' }}
      onMouseLeave={() => onHoverLine?.(null)}>
      <div style={{ minWidth: 'max-content', font: `500 12.5px/${LINE_H}px ${fontFamily.mono}` }}>
        {lines.map((toks, i) => {
          const n = i + 1;
          const tint = tints.get(n);
          const inDrag = n >= lo && n <= hi;
          const snap = snapped.has(n);
          const wash = tint ? `hsla(${tint.hue}, 70%, ${dark ? 55 : 50}%, ${tint.active ? 0.22 : 0.1})` : 'transparent';
          return (
            <div key={i} data-line={n}
              onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); drag.current = n; onSelect([n, n], false); }}
              onMouseEnter={() => { onHoverLine?.(n); if (drag.current !== null) onSelect([drag.current, n], false); }}
              style={{
                display: 'flex', height: LINE_H, position: 'relative',
                background: inDrag ? alpha(tk.accent.base, 0.16) : wash,
                boxShadow: snap ? `inset 3px 0 0 ${tk.accent.base}` : undefined,
              }}>
              <span style={{ width: digits * 8 + 22, flexShrink: 0, textAlign: 'right', paddingRight: 10, color: tint ? `hsl(${tint.hue}, 60%, ${dark ? 65 : 40}%)` : tk.text.faint, borderRight: `3px solid ${tint ? `hsl(${tint.hue}, 70%, ${dark ? 55 : 50}%)` : 'transparent'}`, cursor: 'pointer', fontWeight: tint ? 650 : 500 }}
                title={tint ? tint.label : 'Not converted yet: drag to select'}>{n}</span>
              <span style={{ paddingLeft: 12, paddingRight: 24, whiteSpace: 'pre' }}>
                {toks.length ? toks.map((t, k) => <span key={k} style={{ color: t.color }}>{t.text}</span>) : ' '}
              </span>
            </div>
          );
        })}
      </div>
      {selected === null && snapped.size === 0 && tints.size === 0 && (
        <div style={{ margin: '14px 16px 0', padding: '10px 12px', borderRadius: radius.md, background: tk.bg.subtle, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, maxWidth: 360 }}>
          Drag over some lines to turn them into nodes. The rest keeps running as code, so the picture stays the same.
        </div>
      )}
    </div>
  );
}
