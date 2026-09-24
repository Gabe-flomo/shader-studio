import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { NumberInput } from '../NodeGraph/NumberInput';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import {
  COUNT_MAX_MARKS, TICK_HEIGHT, TICK_WIDTH, clampToStep, countAfterDrag, formatValue, rangeEdges, rulerTicks, rulerUnit,
  valueAfterDrag,
} from './rulerMath';
import { Tooltip } from './Tooltip';

/**
 * The redesign's float control: a value chip (click to type) and a ruler that scrolls under a
 * fixed centre needle. Drag to change (⇧ for ×0.1), double-click to reset, ← / → to step
 * (⇧ ×10), horizontal trackpad scroll to nudge. Vertical scroll is left alone so the canvas
 * and panels keep scrolling.
 *
 * `integer` params are counts, so they get a different track: one mark per item, spread evenly and
 * squeezing together as the count grows. Dragging right adds items.
 *
 * `keyframed` greys the ruler out and stops edits: the value is animated, so the chip shows the
 * live value and hovering explains why.
 */
export function RulerSlider({
  value, min, max, step = 0.01, defaultValue, onChange, integer = false, keyframed, disabled = false,
  ariaLabel, touch = false,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  integer?: boolean;
  /** Set when the param is driven by keyframes; `summary` is shown in the hover tooltip ("4 keys · loop"). */
  keyframed?: { summary?: string };
  disabled?: boolean;
  ariaLabel: string;
  /** Mobile: taller track. */
  touch?: boolean;
}) {
  const tk = useTokens();
  const locked = disabled || !!keyframed;
  const unit = rulerUnit(min, max, integer);
  const effectiveStep = integer ? 1 : step;
  const h = touch ? 36 : 28;
  const fmt = useCallback((n: number) => formatValue(n, effectiveStep, integer), [effectiveStep, integer]);

  const trackRef = useRef<HTMLDivElement>(null);
  const live = useRef({ value, locked, unit, min, max, step: effectiveStep, integer, onChange });
  useEffect(() => { live.current = { value, locked, unit, min, max, step: effectiveStep, integer, onChange }; });

  // Horizontal wheel/trackpad nudges the value. Needs a non-passive listener to preventDefault.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = live.current;
      if (s.locked || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const next = s.integer ? countAfterDrag(s.value, e.deltaX, e.shiftKey) : valueAfterDrag(s.value, -e.deltaX, s.unit, e.shiftKey);
      s.onChange(clampToStep(next, s.min, s.max, s.step));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ lastX: number; acc: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // don't start a canvas pan / node drag underneath
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { lastX: e.clientX, acc: value };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Integrate per event so pressing/releasing ⇧ mid-drag changes speed without a jump.
    const dx = e.clientX - d.lastX;
    const moved = integer ? countAfterDrag(d.acc, dx, e.shiftKey) : valueAfterDrag(d.acc, dx, unit, e.shiftKey);
    d.acc = Math.min(max, Math.max(min, moved));
    d.lastX = e.clientX;
    const next = clampToStep(d.acc, min, max, effectiveStep);
    if (next !== value) onChange(next);
  };
  const endDrag = () => { drag.current = null; };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const inc = effectiveStep * (e.shiftKey ? 10 : 1);
    const moves: Record<string, number> = { ArrowRight: inc, ArrowUp: inc, ArrowLeft: -inc, ArrowDown: -inc };
    if (e.key in moves) { e.preventDefault(); onChange(clampToStep(value + moves[e.key], min, max, effectiveStep)); }
    else if (e.key === 'Home') { e.preventDefault(); onChange(min); }
    else if (e.key === 'End') { e.preventDefault(); onChange(max); }
  };

  const inkTick = locked ? tk.text.faint : tk.text.primary;
  const ticks = integer ? [] : rulerTicks(value, min, max, unit);

  // Count track: `n` marks evenly spread across the track; past COUNT_MAX_MARKS they'd be
  // sub-pixel apart anyway, so draw a solid band instead.
  const n = Math.max(0, Math.round(value));
  const countMarks = (
    <span style={{ position: 'absolute', left: 12, right: 12, top: 0, bottom: 0 }}>
      {n > COUNT_MAX_MARKS
        ? <span style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 12, marginTop: -6, borderRadius: 2, background: inkTick, opacity: 0.55 }} />
        : Array.from({ length: n }, (_, i) => (
          <span
            key={i}
            style={{
              position: 'absolute', top: '50%', left: `${((i + 0.5) / n) * 100}%`, width: 2, height: 14, marginLeft: -1, marginTop: -7,
              borderRadius: 1, background: inkTick, opacity: 0.75, transition: 'left 0.12s ease-out',
            }}
          />
        ))}
    </span>
  );
  const edges = rangeEdges(value, min, max, unit);
  const needle = locked ? tk.text.faint : tk.accent.base;
  const outShade: CSSProperties = { position: 'absolute', top: 0, bottom: 0, background: alpha(tk.text.primary, 0.05) };
  const edgeLine = `1.5px solid ${alpha(tk.text.primary, 0.25)}`;

  const track = (
    <div
      ref={trackRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={locked || undefined}
      tabIndex={locked ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => { if (!locked && defaultValue !== undefined) onChange(defaultValue); }}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative', flex: 1, minWidth: 0, height: h, borderRadius: h / 2, overflow: 'hidden', outline: 'none',
        background: tk.bg.field, touchAction: 'none', cursor: locked ? 'not-allowed' : 'ew-resize',
        opacity: locked ? 0.45 : 1,
        backgroundImage: keyframed
          ? `repeating-linear-gradient(135deg, ${alpha(tk.text.primary, 0.05)} 0 2px, transparent 2px 6px)` : undefined,
      }}
      onFocus={e => { if (!locked) e.currentTarget.style.boxShadow = `inset 0 0 0 1.5px ${tk.accent.base}`; }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {integer ? countMarks : <>
      {edges.lo !== null && <span style={{ ...outShade, left: 0, width: `calc(50% + ${edges.lo}px)`, borderRight: edgeLine }} />}
      {edges.hi !== null && <span style={{ ...outShade, right: 0, left: `calc(50% + ${edges.hi}px)`, borderLeft: edgeLine }} />}
      {ticks.map(t => (
        <span
          key={Math.round(t.dx * 100)}
          style={{
            position: 'absolute', top: '50%', left: `calc(50% + ${t.dx}px)`, borderRadius: 1, background: inkTick,
            width: TICK_WIDTH[t.tier], height: TICK_HEIGHT[t.tier],
            marginLeft: -TICK_WIDTH[t.tier] / 2, marginTop: -TICK_HEIGHT[t.tier] / 2, opacity: t.opacity,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: '50%', top: 3, bottom: 3, width: 2, marginLeft: -1, borderRadius: 1, background: needle }} />
      </>}
    </div>
  );

  const chipStyle: CSSProperties = {
    minWidth: 48, width: 56, height: 26, boxSizing: 'border-box', padding: '0 6px', border: 0, borderRadius: radius.md,
    textAlign: 'center', outline: 'none', flexShrink: 0,
    font: `600 12px ${fontFamily.mono}`, fontVariantNumeric: 'tabular-nums',
    background: tk.bg.field, color: tk.text.primary,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
      {keyframed ? (
        <span
          style={{
            ...chipStyle, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            background: alpha(tk.status.warning, 0.16), color: tk.status.warningText,
          }}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.8L9.2 5 5 9.2 0.8 5Z" fill={tk.status.warning} /></svg>
          {formatValue(value, effectiveStep, integer)}
        </span>
      ) : (
        <NumberInput
          value={value}
          format={fmt}
          onCommit={n => onChange(clampToStep(n, min, max, effectiveStep))}
          disabled={disabled}
          title={`${ariaLabel} (${min} – ${max})`}
          style={chipStyle}
        />
      )}
      {keyframed
        ? <Tooltip grow label="Keyframes attached" description={keyframed.summary ?? 'Edit them from the ◆ socket.'}>{track}</Tooltip>
        : track}
    </div>
  );
}

