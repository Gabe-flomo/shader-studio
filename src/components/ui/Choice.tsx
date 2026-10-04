import { isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Select } from './Select';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { displayCombo } from '../../hooks/useShortcuts';

/** On/off switch. Replaces checkboxes everywhere. `tall` gives it a 40px tap target (phones). */
export function Toggle({
  checked, onChange, label, disabled = false, tall = false, fullWidth = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  tall?: boolean;
  /** The label wraps onto more lines instead of overflowing, filling whatever width the parent gives it (a field row). */
  fullWidth?: boolean;
}) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  // Light: white knob either way. Dark: light knob when off, dark knob on the blue track when on.
  const knob = dark ? (checked ? tk.bg.app : tk.text.primary) : tk.bg.panel;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex', alignItems: 'center', gap: 7, border: 0, background: 'none', padding: 0,
        width: fullWidth ? '100%' : undefined,
        font: `12px ${fontFamily.ui}`, color: tk.text.secondary, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1, whiteSpace: fullWidth ? undefined : 'nowrap', textAlign: 'left', maxWidth: '100%',
        minHeight: tall ? 40 : undefined,
      }}
    >
      <span
        style={{
          position: 'relative', width: 30, height: 18, borderRadius: 9, flexShrink: 0, transition: 'background 0.15s',
          background: checked ? tk.accent.base : tk.border.strong,
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: checked ? 14 : 2, width: 14, height: 14, borderRadius: '50%',
            background: knob,
            boxShadow: '0 1px 2px rgba(20,20,30,0.2)', transition: 'left 0.15s',
          }}
        />
      </span>
      {/* A long label (a song's name) breaks onto a second line instead of running off a phone. */}
      {label !== undefined && <span style={{ whiteSpace: 'normal', minWidth: 0, flex: fullWidth ? '1 1 auto' : undefined, overflowWrap: 'break-word' }}>{label}</span>}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Keyboard shortcut shown inside the segment ("v", "shift+c"). */
  shortcut?: string;
  /** Small second line, e.g. "native" under "1×". */
  sub?: ReactNode;
  /** Can't be chosen right now; `title` says why. */
  disabled?: boolean;
  title?: string;
}

/**
 * 2–5 mutually exclusive options. `fill` stretches the segments across the container; `sm` is
 * the compact form for card headers; `tall` makes each segment at least 40px high, a
 * finger-sized tap target.
 *
 * It never runs past its container. A ResizeObserver compares the room it has with the width
 * the segments need side by side; when they don't fit (a narrow card, a phone), the same
 * options turn into a dropdown (Select) with the same value, onChange and aria-label, and turn
 * back into segments when there is room again. In a flex row it gives way last (a tiny
 * flex-shrink): what sits beside it shrinks first. A label that isn't plain text shows in the
 * dropdown as its `title`, else its value.
 *
 * `wrap` opts out of the dropdown: the segments break onto more rows instead. Only for a row of
 * big tap targets on a phone (the record dialog) where seeing every choice matters more.
 */
export function Segmented<T extends string>({
  options, value, onChange, fill = false, size = 'md', ariaLabel, wrap = false, tall = false,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  fill?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  wrap?: boolean;
  tall?: boolean;
}) {
  const sm = size === 'sm';
  const tk = useTokens();
  const outerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // The width the segments need side by side (null until measured), and whether that's more than there is.
  const [natural, setNatural] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const outer = outerRef.current, strip = stripRef.current;
    if (!outer || !strip || wrap) return;
    const check = () => {
      const need = strip.offsetWidth;
      // No layout (tests, a hidden tab): stay as it is.
      if (!need) return;
      if (!fill) setNatural(need);
      setCompact(need > outer.clientWidth + 0.5);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(outer);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [compact, fill, wrap]);

  // `live`: the real segments; otherwise the hidden copy that's only measured.
  const buttons = (live: boolean) => options.map(o => {
    const on = o.value === value;
    return (
      <button
        key={o.value}
        type="button"
        role={live ? 'radio' : undefined}
        aria-checked={live ? on : undefined}
        aria-disabled={(live && o.disabled) || undefined}
        tabIndex={live ? undefined : -1}
        title={live ? o.title : undefined}
        onClick={live ? () => { if (!o.disabled) onChange(o.value); } : undefined}
        style={{
          flex: fill && live ? 1 : undefined, border: 0, borderRadius: sm ? 6 : 7, padding: o.sub ? '5px 8px' : sm ? '3px 7px' : '4px 10px',
          cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.4 : 1,
          background: on ? tk.bg.panel : 'transparent', boxShadow: on ? '0 1px 2px rgba(20,20,30,0.1)' : 'none',
          color: on ? tk.text.primary : tk.text.muted, font: `${on ? 600 : 500} ${sm ? 11.5 : 12}px ${fontFamily.ui}`,
          display: 'inline-flex', flexDirection: o.sub ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: o.sub ? 1 : 4,
          whiteSpace: 'nowrap', minHeight: tall ? 40 : undefined,
        }}
      >
        <span>{o.label}</span>
        {o.shortcut && (
          <span style={{
            font: `600 10px ${fontFamily.mono}`, borderRadius: 4, padding: '1px 4px',
            color: on ? tk.accent.base : tk.text.faint, background: on ? tk.bg.selected : tk.border.subtle,
          }}>{displayCombo(o.shortcut)}</span>
        )}
        {o.sub && <span style={{ fontSize: 10.5, fontWeight: 500, color: tk.text.faint }}>{o.sub}</span>}
      </button>
    );
  });
  const stripStyle: CSSProperties = {
    gap: 2, padding: sm ? 2 : 3, borderRadius: sm ? radius.md : radius.control, background: tk.bg.field, boxSizing: 'border-box',
  };

  return (
    <div
      ref={outerRef}
      style={{
        position: 'relative', display: fill ? 'flex' : 'inline-flex', minWidth: 0, maxWidth: '100%', flexShrink: 0.001,
        // Folded into a dropdown, it keeps the footprint the segments would have (as far as there's room).
        width: !fill && compact && natural ? natural : undefined,
      }}
    >
      {compact ? <>
        <Select
          ariaLabel={ariaLabel ?? ''}
          value={value}
          options={options.map(o => ({ value: o.value, label: optionText(o), disabled: o.disabled }))}
          onChange={v => { const o = options.find(x => x.value === v); if (o && !o.disabled) onChange(o.value); }}
          height={tall ? 40 : sm ? 26 : 30}
          style={{ width: '100%', ...(sm ? { font: `500 11.5px ${fontFamily.ui}` } : {}) }}
        />
        {/* The segments, hidden but still measured: they come back when there is room. */}
        <div aria-hidden data-overflow-ok="" style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }}>
          <div ref={stripRef} style={{ ...stripStyle, display: 'inline-flex', width: 'max-content' }}>{buttons(false)}</div>
        </div>
      </> : (
        <div ref={stripRef} role="radiogroup" aria-label={ariaLabel}
          style={wrap
            ? { ...stripStyle, display: fill ? 'flex' : 'inline-flex', flexWrap: 'wrap', width: fill ? '100%' : undefined, maxWidth: '100%', minWidth: 0 }
            : { ...stripStyle, display: fill ? 'flex' : 'inline-flex', width: fill ? '100%' : 'max-content', minWidth: fill ? 'max-content' : undefined, flexShrink: 0 }}>
          {buttons(true)}
        </div>
      )}
    </div>
  );
}

/** A segment as dropdown text: its label's text, else its title, else its value (and its second line). */
function optionText<T extends string>(o: SegmentOption<T>): string {
  const text = nodeText(o.label).trim() || o.title || o.value;
  const sub = nodeText(o.sub).trim();
  return sub ? `${text} (${sub})` : text;
}

function nodeText(n: ReactNode): string {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(n)) return nodeText(n.props.children);
  return '';
}
