import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { NumberInput } from '../NodeGraph/NumberInput';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import {
  COUNT_MAX_MARKS, TICK_HEIGHT, TICK_WIDTH, bipolarBand, clampToStep, countAfterDrag, dragStep, formatValue, rangeAfterTyping, rangeEdges, rangeIncluding, rulerTicks, rulerUnit,
  valueAfterDrag,
} from './rulerMath';
import { Tooltip } from './Tooltip';
import { claimWheel, ownsWheel } from './wheelOwner';

/**
 * The redesign's float control: a value chip (click to type) and a ruler that scrolls under a
 * fixed centre needle. Drag to change (⇧ for ×0.1), double-click to reset, ← / → to step
 * (⇧ ×10), horizontal trackpad scroll to nudge. Vertical scroll is left alone so the canvas
 * and panels keep scrolling.
 *
 * Typing sets the range: a number typed into the chip past the max becomes the new max (0 → N;
 * −N → N when the range is symmetric about zero), one below the min of a one-way slider the new
 * min. A number inside the range is just the value, so the range never shrinks on its own. The
 * slider keeps the wider range itself; `onRange` lets the owner store it. `hard` limits (opacity,
 * an audio unit's range) clamp instead. The slider itself has no min/max fields and no
 * right-click of its own: a right-click reaches whatever menu the row around it has.
 *
 * `integer` params are counts, so they get a different track: one mark per item, spread evenly and
 * squeezing together as the count grows. Dragging right adds items.
 *
 * `keyframed` greys the ruler out and stops edits: the value is animated, so the chip shows the
 * live value and hovering explains why.
 */
export function RulerSlider({
  value, min, max, step = 0.01, defaultValue, onChange, integer = false, keyframed, disabled = false,
  ariaLabel, touch = false, onType, onRange, hard = false, unit: unitProp, bipolar = false, trackMinWidth = 0, display,
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
  /**
   * Takes a typed value instead of `onChange`: the value is already past the step clamp, and
   * the range has already been widened to hold it (see `onRange`), so this is for owners that
   * store typed values differently from dragged ones (immediately, say).
   */
  onType?: (value: number) => void;
  /**
   * A typed value went past the range and widened it: store the new range (a node's
   * `__scMin_/__scMax_`, a Play control's min/max). Without it the slider still widens, but
   * only for as long as it's mounted.
   */
  onRange?: (min: number, max: number) => void;
  /** A physical limit (0–1 opacity, an audio unit's range): a typed value is clamped, never widens the range. */
  hard?: boolean;
  /**
   * The ruler's unit (40 px of drag), for a small range the default would squeeze (rulerMath
   * fineUnit). A function gets the range in use, which a typed value may have widened.
   */
  unit?: number | ((min: number, max: number) => number | undefined);
  /**
   * The least the track may shrink to (px). 0 by default: in a narrow column the number chip keeps
   * its width and the track can vanish, so a builder's sliders ask for some track to stay grabbable.
   */
  trackMinWidth?: number;
  /**
   * Bipolar: on a range symmetric about zero (−N … N), zero is marked on the ruler and the stretch
   * from zero to the needle is tinted, so which way and how far reads at a glance. A node card's
   * bidirectional slider and the builders' symmetric ones use it.
   */
  bipolar?: boolean;
  /**
   * The slider runs on an inner scale (a log scale: LogRulerSlider) while the chip shows and takes the real value:
   * `show` writes an inner value as the real one, `parse` turns a typed real value into the inner one.
   */
  display?: { show: (inner: number) => string; parse: (typed: number) => number };
}) {
  const tk = useTokens();
  const locked = disabled || !!keyframed;
  // The value shown is the real one, and a drag starts from it: a value past the declared range
  // widens the range around it rather than being clamped back on the first touch. While a drag
  // is on, the range it started with holds, so the ruler's scale doesn't change under the pointer.
  const [held, setHeld] = useState<{ min: number; max: number } | null>(null);
  // A range a typed value widened, kept here until the owner's range (min/max) changes: that's
  // the owner storing it, or resetting it, and either way theirs is right again.
  const [typed, setTyped] = useState<{ min: number; max: number; base: string } | null>(null);
  const base = `${min}:${max}`;
  if (typed && typed.base !== base) setTyped(null);
  const grown = typed && typed.base === base ? { min: Math.min(min, typed.min), max: Math.max(max, typed.max) } : { min, max };
  const range = held ?? rangeIncluding(value, grown.min, grown.max);
  ({ min, max } = range);
  // Typing sets the range (rangeAfterTyping); the typed number itself is kept as typed.
  const commitTyped = (typed: number) => {
    const n = display ? display.parse(typed) : typed;
    const r = rangeAfterTyping(n, min, max, hard);
    if (r.extended) { setTyped({ min: r.min, max: r.max, base }); onRange?.(r.min, r.max); }
    (onType ?? onChange)(r.value);
  };
  const unit = (typeof unitProp === 'function' ? unitProp(min, max) : unitProp) ?? rulerUnit(min, max, integer);
  const effectiveStep = integer ? 1 : step;
  const h = touch ? 40 : 28;
  const show = display?.show;
  const fmt = useCallback((n: number) => (show ? show(n) : formatValue(n, effectiveStep, integer)), [effectiveStep, integer, show]);

  const trackRef = useRef<HTMLDivElement>(null);
  const live = useRef({ value, locked, unit, min, max, step: effectiveStep, integer, onChange });
  useEffect(() => { live.current = { value, locked, unit, min, max, step: effectiveStep, integer, onChange }; });

  // Horizontal wheel/trackpad nudges the value, but only a swipe that belongs to this
  // slider (see wheelOwner): a pan that slides over it moves the view, not the value.
  // Needs a non-passive listener to preventDefault.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = live.current;
      if (s.locked || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || !ownsWheel(el)) return;
      e.preventDefault();
      e.stopPropagation(); // the swipe is the slider's: the canvas behind must not pan with it
      const next = s.integer ? countAfterDrag(s.value, e.deltaX, e.shiftKey) : valueAfterDrag(s.value, -e.deltaX, s.unit, e.shiftKey);
      s.onChange(clampToStep(next, s.min, s.max, s.step));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const release = claimWheel(el, '[data-ruler-track]');
    return () => {
      el.removeEventListener('wheel', onWheel);
      release();
    };
  }, []);

  const drag = useRef<{ lastX: number; acc: number; startX: number } | null>(null);
  // A double tap resets, as a double-click does (a touch screen doesn't always send dblclick).
  const lastTap = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // don't start a canvas pan / node drag underneath
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    if (e.pointerType === 'touch') {
      const now = e.timeStamp || performance.now();
      if (now - lastTap.current < 320 && defaultValue !== undefined) {
        lastTap.current = 0;
        onChange(defaultValue);
        return;
      }
      lastTap.current = now;
    }
    drag.current = { lastX: e.clientX, acc: value, startX: e.clientX };
    setHeld(range);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Integrate per event so pressing/releasing ⇧ mid-drag changes speed without a jump.
    const dx = e.clientX - d.lastX;
    d.acc = dragStep(d.acc, dx, range, unit, integer, e.shiftKey);
    d.lastX = e.clientX;
    const next = clampToStep(d.acc, min, max, effectiveStep);
    if (next !== value) onChange(next);
  };
  const endDrag = () => {
    // A drag isn't a tap: only a still touch counts towards a double tap.
    if (drag.current && Math.abs(drag.current.lastX - drag.current.startX) > 6) lastTap.current = 0;
    drag.current = null; setHeld(null);
  };

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
  const band = bipolar && !integer ? bipolarBand(value, min, max, unit) : null;
  const needle = locked ? tk.text.faint : tk.accent.base;
  const outShade: CSSProperties = { position: 'absolute', top: 0, bottom: 0, background: alpha(tk.text.primary, 0.05) };
  const edgeLine = `1.5px solid ${alpha(tk.text.primary, 0.25)}`;

  const track = (
    <div
      ref={trackRef}
      data-ruler-track=""
      data-overflow-ok=""
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={display ? display.show(value) : undefined}
      aria-disabled={locked || undefined}
      tabIndex={locked ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => { if (!locked && defaultValue !== undefined) onChange(defaultValue); }}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative', flex: 1, minWidth: trackMinWidth, height: h, borderRadius: h / 2, overflow: 'hidden', outline: 'none',
        background: tk.bg.field, touchAction: 'none', cursor: locked ? 'not-allowed' : 'ew-resize',
        opacity: locked ? 0.45 : 1,
        backgroundImage: keyframed
          ? `repeating-linear-gradient(135deg, ${alpha(tk.text.primary, 0.05)} 0 2px, transparent 2px 6px)` : undefined,
      }}
      onFocus={e => { if (!locked) e.currentTarget.style.boxShadow = `inset 0 0 0 1.5px ${tk.accent.base}`; }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {integer ? countMarks : <>
      {band && <>
        <span data-ruler-bipolar="" style={{ position: 'absolute', top: 5, bottom: 5, left: `calc(50% + ${band.left}px)`, width: band.width, background: alpha(tk.accent.base, locked ? 0.08 : 0.2), borderRadius: 2 }} />
        <span data-ruler-zero="" style={{ position: 'absolute', top: 2, bottom: 2, left: `calc(50% + ${band.zero}px)`, width: 2, marginLeft: -1, borderRadius: 1, background: alpha(tk.accent.base, 0.55) }} />
      </>}
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

  const ends = display ? `${display.show(min)} – ${display.show(max)}` : `${min} – ${max}`;
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
          {fmt(value)}
        </span>
      ) : (
        <NumberInput
          value={value}
          format={fmt}
          onCommit={commitTyped}
          disabled={disabled}
          title={hard ? `${ariaLabel} (${ends})` : `${ariaLabel} (${ends}): type a number past the end to widen the range`}
          style={chipStyle}
        />
      )}
      {keyframed
        ? <Tooltip grow label="Keyframes attached" description={keyframed.summary ?? 'Edit them from the ◆ socket.'}>{track}</Tooltip>
        : track}
    </div>
  );
}
