import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { portalGuard } from '../ui/portalGuard';

const MARGIN = 8;

/**
 * Right-click on a node's die: which sliders Randomize may change. All are ticked by default;
 * unticked keys are stored on the node (params.__randExclude). Stays open while ticking; Esc or a
 * click outside closes it.
 */
export function RandomizeMenu({ x, y, params, excluded, onChange, amount, onAmountChange, onRandomize, onClose }: {
  x: number;
  y: number;
  params: Array<{ key: string; label: string }>;
  excluded: string[];
  onChange: (excluded: string[]) => void;
  /** Strength 0.01–1: how much of each slider's range a randomize may move it */
  amount: number;
  onAmountChange: (amount: number) => void;
  onRandomize: () => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const off = new Set(excluded);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN))}px`;
    el.style.top = `${y + r.height > window.innerHeight - MARGIN ? Math.max(MARGIN, y - r.height) : y}px`;
  }, [x, y]);

  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); } };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onCloseRef.current(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onDown, true); };
  }, []);

  const toggle = (key: string) => onChange(off.has(key) ? excluded.filter(k => k !== key) : [...excluded, key]);
  const allOn = off.size === 0;

  return createPortal(
    <div
      {...portalGuard}
      ref={ref}
      role="dialog"
      aria-label="Sliders to randomize"
      data-captures-escape
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 400, width: 280, padding: 4, boxSizing: 'border-box',
        background: tk.bg.panel, borderRadius: radius.lg, boxShadow: tk.shadow.popover, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '7px 8px 6px' }}>
        <span style={{ flex: 1, color: tk.text.faint, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>RANDOMIZE</span>
        <button
          type="button"
          onClick={() => onChange(allOn ? params.map(p => p.key) : [])}
          style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}
        >{allOn ? 'None' : 'All'}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px 8px' }}
        title="How far a randomize may move each slider: 100% picks anywhere in its range, 10% nudges it around its current value">
        <span style={{ width: 58, flexShrink: 0, color: tk.text.secondary }}>Strength</span>
        <RulerSlider value={Math.round(amount * 100)} min={1} max={100} step={1} integer defaultValue={100}
          onChange={v => onAmountChange(Math.min(1, Math.max(0.01, v / 100)))} ariaLabel="Randomize strength (percent)" />
        <span style={{ flexShrink: 0, color: tk.text.muted }}>%</span>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 4 }}>
        {params.map(p => {
          const on = !off.has(p.key);
          return (
            <button
              key={p.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() => toggle(p.key)}
              onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              style={{
                width: '100%', height: 32, display: 'flex', alignItems: 'center', gap: 9, padding: '0 8px', border: 0, borderRadius: 8,
                background: 'none', cursor: 'pointer', textAlign: 'left', color: on ? tk.text.primary : tk.text.muted, font: `12.5px ${fontFamily.ui}`,
              }}
            >
              <span style={{
                width: 16, height: 16, flexShrink: 0, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: on ? tk.accent.base : 'none', boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${tk.border.strong}`, color: '#ffffff',
              }}>{on && <Icon name="check" size={12} />}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ padding: '6px 4px 4px', borderTop: `1px solid ${tk.border.subtle}`, marginTop: 4 }}>
        <Button size="sm" variant="primary" icon="dice" disabled={off.size === params.length} onClick={onRandomize} style={{ width: '100%', justifyContent: 'center' }}>
          Randomize {off.size === 0 ? 'all' : `${params.length - off.size} of ${params.length}`}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
