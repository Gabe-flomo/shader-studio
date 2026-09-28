/**
 * GradientStopsEditor — a gradient bar with its colour stops built in, so a
 * palette of any length stays one bar tall:
 *
 *   click the bar      add a stop there, in the colour the bar already has
 *   drag a handle      move it (free stops) or reorder it (evenly spaced ones)
 *   click a handle     select it and open the colour picker beside it
 *   double-click       type its exact place in the row below
 *   ← →                nudge it 1% (10% with Shift), or one place over when evenly spaced
 *   Backspace / ×      remove it (never below `min`)
 *
 * Under the bar, one row for the chosen stop: its colour (a swatch and the
 * hex), where it sits, remove and add, and how many stops of the most allowed
 * (8 for Play and Present backgrounds, 32 in the Studio's Stops Palette).
 *
 * `fixedSpacing` is the Stops Palette's layout: stops sit evenly along the bar
 * in their order, so their `pos` is ignored and dragging reorders them. A
 * `wired` stop (fed by a socket) shows a marker saying so instead of a colour.
 * The logic lives in gradientStops.ts.
 */
import { useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from './Button';
import { ColorPickerPanel } from './ColorPicker';
import { Field } from './Field';
import { Popover } from './Popover';
import { toast } from './toastStore';
import { hexToRgb, rgbToHex } from '../../lib/colorMath';
import {
  addStop, addStopBeside, evenStops, gradientCss, insertColourAt, moveStop, nudgeStop, removeStop,
  reorderColours, rgbCss as css, setStopColour, setStopPos, slotAt, type GradientStop, type GradientStyle, type RGB,
} from './gradientStops';

/** The handle's hit area (touch-friendly) and the visible dot inside it. */
const HANDLE = 28;

export function GradientStopsEditor({
  stops: given, onChange, max, min = 2, style = 'gradient', fixedSpacing = false, wired, selected: selectedProp, onSelect,
  touch = false, clearRef, label = 'Stop', barHeight,
}: {
  stops: readonly GradientStop[];
  onChange: (stops: GradientStop[]) => void;
  /** The most stops there can be. */
  max: number;
  /** The fewest (a gradient needs two). */
  min?: number;
  /** How the bar paints between stops. */
  style?: GradientStyle;
  /** Stops sit evenly in their order (their `pos` is ignored); dragging reorders them. */
  fixedSpacing?: boolean;
  /** Is stop `i` fed by a socket? It then shows a "wired" marker and its colour can't be picked here. */
  wired?: (index: number) => boolean;
  /** Which stop is chosen, when the parent keeps it. */
  selected?: number;
  onSelect?: (index: number) => void;
  /** Bigger targets. */
  touch?: boolean;
  /** An element the colour picker must not cover (a node card). */
  clearRef?: RefObject<HTMLElement | null>;
  /** What a stop is called in labels. */
  label?: string;
  barHeight?: number;
}) {
  const tk = useTokens();
  const stops = fixedSpacing ? evenStops(given.map(s => s.color)) : given;
  const n = stops.length;
  const [selState, setSelState] = useState(0);
  const selected = Math.max(0, Math.min(n - 1, selectedProp ?? selState));
  const select = (i: number) => { setSelState(i); onSelect?.(i); };
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [hexText, setHexText] = useState<string | null>(null);
  /** While a fixed-spacing handle is dragged: which stop, and where the pointer is along the bar. */
  const [dragAt, setDragAt] = useState<{ i: number; t: number } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const posInput = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const handles = useRef<Array<HTMLButtonElement | null>>([]);
  const drag = useRef<{ i: number; moved: boolean; startX: number } | null>(null);
  const h = barHeight ?? (touch ? 40 : 34);
  const isWired = (i: number) => !!wired?.(i);

  const posAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    return r ? Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) : 0;
  };
  const emit = (next: readonly GradientStop[]) => onChange(fixedSpacing ? evenStops(next.map(s => s.color)) : [...next]);
  const emitColours = (colors: RGB[]) => onChange(evenStops(colors));
  const full = () => toast.info(`${max} stops at most`, { message: 'Remove one to add another here.' });

  const addAt = (t: number) => {
    if (fixedSpacing) {
      const r = insertColourAt(stops.map(s => s.color), t, max, style);
      if (!r) { full(); return; }
      emitColours(r.colors); select(r.index);
    } else {
      const r = addStop(stops, t, max, style);
      if (!r) { full(); return; }
      emit(r.stops); select(r.index);
    }
  };
  const addBeside = () => {
    if (fixedSpacing) { addAt(n > 1 ? Math.min(1, (selected + 0.5) / (n - 1)) : 0.75); return; }
    const r = addStopBeside(stops, selected, max, style);
    if (!r) { full(); return; }
    emit(r.stops); select(r.index);
  };
  const remove = (i: number) => {
    const r = removeStop(stops, i, min);
    if (!r) return;
    setPickerFor(null);
    emit(r.stops); select(r.index);
  };
  const place = (i: number, t: number) => {
    if (fixedSpacing) {
      const to = slotAt(n, t);
      if (to === i) return;
      emitColours(reorderColours(stops.map(s => s.color), i, to)); select(to);
    } else {
      const r = setStopPos(stops, i, t);
      emit(r.stops); select(r.index);
    }
  };
  const openPicker = (i: number) => {
    if (isWired(i)) return;
    anchor.current = handles.current[i];
    setPickerFor(p => (p === i ? null : i));
  };

  const sel = stops[selected];
  const hexShown = hexText ?? (sel ? rgbToHex(sel.color) : '');
  const commitHex = () => {
    if (hexText === null) return;
    const c = hexToRgb(hexText);
    if (c && sel) emit(setStopColour(stops, selected, c));
    setHexText(null);
  };

  const faint: CSSProperties = { color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }} onMouseDown={e => e.stopPropagation()}>
      {/* The bar and its stops */}
      <div style={{ position: 'relative', paddingBottom: HANDLE - 8, margin: '0 10px' }}>
        <div
          ref={bar}
          role="presentation"
          title={n < max ? 'Click to add a stop here' : `${max} stops at most`}
          onPointerDown={e => { if (e.target === e.currentTarget) { e.stopPropagation(); addAt(posAt(e.clientX)); } }}
          style={{ height: h, borderRadius: radius.md, background: gradientCss(stops, style), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`, cursor: n < max ? 'copy' : 'default', touchAction: 'none' }}
        />
        {stops.map((s, i) => {
          const on = i === selected;
          const w = isWired(i);
          const t = dragAt?.i === i ? dragAt.t : s.pos;
          return (
            <button
              key={i} type="button" ref={el => { handles.current[i] = el; }}
              aria-label={`${label} ${i + 1}${fixedSpacing ? ` of ${n}` : ` at ${Math.round(s.pos * 100)}%`}${w ? ', wired' : `: ${rgbToHex(s.color)}`}`}
              aria-pressed={on}
              title={w ? 'Wired from a socket' : fixedSpacing ? 'Drag to reorder · click for its colour · Backspace removes' : 'Drag to move · click for its colour · double-click to type its place · Backspace removes'}
              onPointerDown={e => {
                // preventDefault keeps text from being selected during the drag, but also keeps the
                // browser from focusing the handle: focus it by hand so ← → and Backspace reach it.
                e.preventDefault(); e.stopPropagation();
                e.currentTarget.focus();
                e.currentTarget.setPointerCapture(e.pointerId);
                select(i);
                drag.current = { i, moved: false, startX: e.clientX };
              }}
              onPointerMove={e => {
                // The captured handle keeps the events; with fixed spacing the stop it drags may have
                // moved to another place (d.i) since the press.
                const d = drag.current;
                if (!d) return;
                if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
                d.moved = true;
                const t2 = posAt(e.clientX);
                if (fixedSpacing) {
                  const to = slotAt(n, t2);
                  if (to !== d.i) { emitColours(reorderColours(stops.map(x => x.color), d.i, to)); select(to); d.i = to; }
                  setDragAt({ i: d.i, t: t2 });
                } else {
                  onChange(moveStop(stops, d.i, t2));
                }
              }}
              onPointerUp={() => {
                const d = drag.current; drag.current = null;
                setDragAt(null);
                if (d && !d.moved) openPicker(i);
              }}
              onPointerCancel={() => { drag.current = null; setDragAt(null); }}
              onClick={e => { if (e.detail === 0) openPicker(i); }}
              onDoubleClick={() => { if (!fixedSpacing) { posInput.current?.focus(); posInput.current?.select(); } }}
              onKeyDown={e => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault(); e.stopPropagation();
                  const dir = e.key === 'ArrowLeft' ? -1 : 1;
                  if (fixedSpacing) {
                    const to = Math.max(0, Math.min(n - 1, i + dir));
                    if (to !== i) { emitColours(reorderColours(stops.map(x => x.color), i, to)); select(to); setTimeout(() => handles.current[to]?.focus(), 0); }
                  } else {
                    const r = nudgeStop(stops, i, dir * (e.shiftKey ? 0.1 : 0.01));
                    emit(r.stops); select(r.index);
                    if (r.index !== i) setTimeout(() => handles.current[r.index]?.focus(), 0);
                  }
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault(); e.stopPropagation(); remove(i);
                } else if (e.key === 'Escape' && pickerFor !== null) {
                  setPickerFor(null);
                }
              }}
              style={{
                position: 'absolute', top: h - 10, left: `calc(${t * 100}% - ${HANDLE / 2}px)`, width: HANDLE, height: HANDLE, padding: 0, border: 0, background: 'none',
                cursor: dragAt?.i === i ? 'grabbing' : 'grab', touchAction: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: on ? 2 : 1,
                outline: 'none',
              }}
            >
              {w ? (
                <span style={{
                  marginTop: on ? 0 : 2, padding: '2px 5px', borderRadius: 999, background: tk.bg.panel, color: tk.accent.text, font: `700 8.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase',
                  boxShadow: `0 0 0 2px ${on ? tk.accent.base : tk.border.strong}, 0 1px 3px ${alpha('#000000', 0.35)}`,
                }}>wired</span>
              ) : (
                <span style={{
                  width: on ? 18 : 15, height: on ? 18 : 15, marginTop: on ? 0 : 2, borderRadius: '50%', background: css(s.color),
                  boxShadow: `0 0 0 2px ${on ? tk.accent.base : tk.bg.panel}, 0 1px 3px ${alpha('#000000', 0.35)}`,
                  transition: 'width 80ms, height 80ms',
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* The chosen stop */}
      {sel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <button
            type="button" aria-label={`${label} ${selected + 1} colour: ${rgbToHex(sel.color)}. Open colour picker`} aria-expanded={pickerFor === selected}
            disabled={isWired(selected)}
            onClick={() => openPicker(selected)}
            style={{
              width: 28, height: 24, flexShrink: 0, borderRadius: radius.md, border: 0, padding: 0, cursor: isWired(selected) ? 'default' : 'pointer', background: css(sel.color),
              boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}${pickerFor === selected ? `, 0 0 0 2px ${tk.accent.base}` : ''}`,
            }}
          />
          {isWired(selected)
            ? <span style={{ ...faint, color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>wired</span>
            : (
              <Field aria-label={`${label} ${selected + 1} hex colour`} mono height={26} style={{ width: 86, padding: '0 8px' }} spellCheck={false}
                value={hexShown}
                onChange={e => setHexText(e.target.value)}
                onBlur={commitHex}
                onKeyDown={e => { if (e.key === 'Enter') { commitHex(); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }} />
            )}
          {fixedSpacing
            ? <span style={faint}>{selected + 1} of {n}</span>
            : (
              <Field ref={posInput} aria-label={`Where ${label.toLowerCase()} ${selected + 1} sits (%)`} height={26} style={{ width: 66, padding: '0 8px' }} suffix="%" inputMode="numeric"
                value={String(Math.round(sel.pos * 100))}
                onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) place(selected, v / 100); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
            )}
          <IconButton icon="close" label={`Remove ${label.toLowerCase()} ${selected + 1}`} size="sm" disabled={n <= min} onClick={() => remove(selected)} />
          <span style={{ flex: 1 }} />
          <IconButton icon="plus" label={n >= max ? `${max} stops at most` : 'Add a stop next to this one'} size="sm" disabled={n >= max} onClick={addBeside} />
          <span style={faint}>{n} / {max}</span>
        </div>
      )}

      {pickerFor !== null && stops[pickerFor] && (
        <Popover anchorRef={anchor} clearRef={clearRef} onClose={() => setPickerFor(null)} align="center" padding={4}>
          <ColorPickerPanel value={stops[pickerFor].color} onChange={c => emit(setStopColour(stops, pickerFor, c))} />
        </Popover>
      )}
    </div>
  );
}
