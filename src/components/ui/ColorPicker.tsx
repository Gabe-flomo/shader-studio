import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Popover } from './Popover';
import { hexToRgb, hsvToRgb, rgbToGlsl, rgbToHex, rgbToHsv, type HSV, type RGB } from '../../lib/colorMath';

const RECENT_KEY = 'shader-studio:settings:recentColors';
const RECENT_MAX = 8;

/** A dozen good starting points, Catppuccin-flavoured so they sit well with the UI. */
const PRESETS: string[] = [
  '#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#94e2d5', '#89b4fa', '#cba6f7', '#f5c2e7',
  '#ffffff', '#a6adc8', '#45475a', '#11111b',
];

function readRecent(): string[] {
  try { const raw = localStorage.getItem(RECENT_KEY); const arr = raw ? JSON.parse(raw) as unknown : null; return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX) : []; }
  catch { return []; }
}
function pushRecent(hex: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...readRecent().filter(h => h !== hex)].slice(0, RECENT_MAX))); } catch { /* private mode */ }
}

interface EyeDropperCtor { new (): { open(): Promise<{ sRGBHex: string }> } }
const eyeDropper = (): EyeDropperCtor | null => {
  const w = window as unknown as { EyeDropper?: EyeDropperCtor };
  return typeof w.EyeDropper === 'function' ? w.EyeDropper : null;
};

/**
 * Design-tool colour picker: saturation/brightness square, hue strip, hex and
 * RGB fields, presets and recents, plus the browser eyedropper where it exists.
 * `value` is [r, g, b] in 0–1, the way the shader wants it.
 */
export function ColorPickerPanel({ value, onChange, onCommit }: { value: RGB; onChange: (rgb: RGB) => void; onCommit?: (rgb: RGB) => void }) {
  const tk = useTokens();
  // Hue and saturation live here so a grey or black pick does not lose them.
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(value));
  const [hexText, setHexText] = useState(() => rgbToHex(value));
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [lastEmitted, setLastEmitted] = useState(() => rgbToHex(value));
  // Latest HSV for the pointer-up commit, without reading state inside an updater.
  const latest = useRef<HSV>(rgbToHsv(value));

  // Follow external changes (undo, keyframes, another editor of the same param):
  // when the prop stops matching what this panel last sent, adopt it.
  const incoming = rgbToHex(value);
  if (incoming !== lastEmitted) {
    setLastEmitted(incoming);
    setHsv(rgbToHsv(value));
    setHexText(incoming);
  }

  const emit = useCallback((next: HSV, commit = false) => {
    latest.current = next;
    setHsv(next);
    const rgb = hsvToRgb(next);
    const hex = rgbToHex(rgb);
    setLastEmitted(hex);
    setHexText(hex);
    onChange(rgb);
    if (commit) { onCommit?.(rgb); pushRecent(hex); setRecent(readRecent()); }
  }, [onChange, onCommit]);

  const setRgb = useCallback((rgb: RGB) => {
    const next = rgbToHsv(rgb);
    // Keep the current hue for greys, where hue is undefined.
    if (next[1] < 1e-6) next[0] = hsv[0];
    emit(next, true);
  }, [emit, hsv]);

  const [h, s, v] = hsv;
  const rgb = hsvToRgb(hsv);
  const hueHex = rgbToHex(hsvToRgb([h, 1, 1]));

  // ── drag handling shared by the square and the hue strip ──
  const drag = (el: HTMLElement, move: (fx: number, fy: number) => void) => (e: ReactPointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => move(
      Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)),
    );
    at(e);
    const onMove = (ev: PointerEvent) => at(ev);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rgbNow = hsvToRgb(latest.current);
      onCommit?.(rgbNow); pushRecent(rgbToHex(rgbNow)); setRecent(readRecent());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const field: CSSProperties = {
    height: 26, borderRadius: radius.sm, background: tk.bg.field, border: 0, outline: 'none', padding: '0 6px',
    color: tk.text.primary, font: `500 12px ${fontFamily.mono}`, minWidth: 0, width: '100%',
  };
  const label: CSSProperties = { font: `600 9.5px ${fontFamily.ui}`, letterSpacing: 0.6, textTransform: 'uppercase', color: tk.text.faint, marginBottom: 3 };

  const channel = (idx: 0 | 1 | 2, name: string) => (
    <label key={name} style={{ flex: 1, minWidth: 0 }}>
      <div style={label}>{name}</div>
      <input
        style={field} type="number" min={0} max={255} step={1} aria-label={`${name} 0–255`}
        value={Math.round(rgb[idx] * 255)}
        onChange={e => { const n = Math.max(0, Math.min(255, Number(e.target.value) || 0)); const next = [...rgb] as RGB; next[idx] = n / 255; setRgb(next); }}
      />
    </label>
  );

  const swatch = (hex: string, key: string) => (
    <button
      key={key} type="button" title={hex} aria-label={`Use ${hex}`}
      onClick={() => { const c = hexToRgb(hex); if (c) setRgb(c); }}
      style={{
        width: 20, height: 20, borderRadius: radius.xs, border: 0, padding: 0, cursor: 'pointer', background: hex,
        boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.15)}${hex === rgbToHex(rgb) ? `, 0 0 0 2px ${tk.accent.base}` : ''}`,
      }}
    />
  );

  return (
    <div style={{ width: 236, display: 'flex', flexDirection: 'column', gap: 10, padding: 6 }} onPointerDown={e => e.stopPropagation()}>
      <div
        ref={squareRef} role="slider" aria-label="Saturation and brightness" aria-valuetext={`saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`}
        onPointerDown={e => squareRef.current && drag(squareRef.current, (fx, fy) => emit([h, fx, 1 - fy]))(e)}
        style={{
          position: 'relative', height: 150, borderRadius: radius.md, cursor: 'crosshair', touchAction: 'none',
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hueHex})`,
          boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`,
        }}
      >
        <div style={{
          position: 'absolute', left: `${s * 100}%`, top: `${(1 - v) * 100}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7,
          borderRadius: '50%', background: rgbToHex(rgb), boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${alpha('#000000', 0.35)}`, pointerEvents: 'none',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          ref={hueRef} role="slider" aria-label="Hue" aria-valuenow={Math.round(h * 360)} aria-valuemin={0} aria-valuemax={360}
          onPointerDown={e => hueRef.current && drag(hueRef.current, fx => emit([fx, s, v]))(e)}
          style={{
            position: 'relative', flex: 1, height: 14, borderRadius: 7, cursor: 'ew-resize', touchAction: 'none',
            background: 'linear-gradient(to right, #f00 0%, #ff0 16.7%, #0f0 33.3%, #0ff 50%, #00f 66.7%, #f0f 83.3%, #f00 100%)',
            boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`,
          }}
        >
          <div style={{
            position: 'absolute', left: `${h * 100}%`, top: -2, width: 18, height: 18, marginLeft: -9, borderRadius: '50%',
            background: hueHex, boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${alpha('#000000', 0.35)}`, pointerEvents: 'none',
          }} />
        </div>
        {eyeDropper() && (
          <button
            type="button" title="Pick a colour from the screen" aria-label="Eyedropper"
            onClick={async () => {
              try { const Ctor = eyeDropper()!; const r = await new Ctor().open(); const c = hexToRgb(r.sRGBHex); if (c) setRgb(c); } catch { /* cancelled */ }
            }}
            style={{ width: 26, height: 26, borderRadius: radius.sm, border: 0, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `13px ${fontFamily.ui}` }}
          >⌖</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <label style={{ flex: 1.4, minWidth: 0 }}>
          <div style={label}>Hex</div>
          <input
            style={field} value={hexText} spellCheck={false} aria-label="Hex colour"
            onChange={e => { setHexText(e.target.value); const c = hexToRgb(e.target.value); if (c) { const next = rgbToHsv(c); if (next[1] < 1e-6) next[0] = h; setHsv(next); setLastEmitted(rgbToHex(c)); onChange(c); } }}
            onBlur={() => { const c = hexToRgb(hexText); if (c) setRgb(c); else setHexText(rgbToHex(rgb)); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </label>
        {channel(0, 'R')}{channel(1, 'G')}{channel(2, 'B')}
      </div>

      <div style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, textAlign: 'center' }}>{rgbToGlsl(rgb)}</div>

      <div>
        <div style={label}>Presets</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>{PRESETS.map(hx => swatch(hx, `p-${hx}`))}</div>
      </div>
      {recent.length > 0 && (
        <div>
          <div style={label}>Recent</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>{recent.map(hx => swatch(hx, `r-${hx}`))}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Colour swatch that opens the picker in a popover. Drop-in for a vec3color
 * param: `value` [r, g, b] 0–1, `onChange` fires live while dragging.
 */
export function ColorSwatch({ value, onChange, label, size = 'md', showHex = true, style }: {
  value: RGB; onChange: (rgb: RGB) => void; label: string; size?: 'sm' | 'md' | 'lg'; showHex?: boolean; style?: CSSProperties;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  // On a node card the picker opens beside the card, so it never hides the card's own sockets.
  const cardRef = useRef<HTMLElement | null>(null);
  const toggle = () => {
    cardRef.current = ref.current?.closest<HTMLElement>('[data-node-id]') ?? null;
    setOpen(o => !o);
  };
  const hex = rgbToHex(value);
  const dims = size === 'lg' ? { width: '100%', height: 44 } : size === 'sm' ? { width: 28, height: 20 } : { width: 44, height: 26 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, ...style }}>
      <button
        ref={ref} type="button" aria-label={`${label}: ${hex}. Open colour picker`} aria-expanded={open}
        onClick={toggle}
        onPointerDown={e => e.stopPropagation()}
        style={{
          ...dims, borderRadius: radius.md, border: 0, padding: 0, cursor: 'pointer', flexShrink: size === 'lg' ? 1 : 0, background: hex,
          boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}${open ? `, 0 0 0 2px ${tk.accent.base}` : ''}`,
        }}
      />
      {showHex && <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.muted }}>{hex}</span>}
      {open && (
        <Popover anchorRef={ref} clearRef={cardRef} onClose={() => setOpen(false)} align="start" padding={4}>
          <ColorPickerPanel value={value} onChange={onChange} />
        </Popover>
      )}
    </div>
  );
}
