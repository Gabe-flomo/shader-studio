/**
 * ColourPad — a colour control: the base colour to edit, and the live one
 * beside it while mappings drive it. Shared by the Play panel and Present.
 */
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';

export function ColourPad({ value, live, disabled, onChange }: { value: number[]; live?: number[]; disabled: boolean; onChange: (v: number[]) => void }) {
  const tk = useTokens();
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0');
  const hexOf = (c: number[]) => `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;
  const hex = hexOf(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label title={live ? 'The colour mappings start from. They scale it or set single channels.' : undefined} style={{
        position: 'relative', flex: 1, height: 34, borderRadius: radius.md, cursor: disabled ? 'default' : 'pointer',
        background: hex, boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`, opacity: disabled ? 0.8 : 1,
      }}>
        <input
          type="color"
          aria-label="Colour"
          value={hex}
          disabled={disabled}
          onChange={e => {
            const h = e.target.value;
            onChange([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
          }}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'inherit' }}
        />
      </label>
      {live && <span title="Right now, with its mappings" aria-label={`Live colour ${hexOf(live)}`} style={{ width: 22, height: 22, borderRadius: 6, background: hexOf(live), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`, flexShrink: 0 }} />}
      <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.muted, width: 64 }}>{hex}</span>
    </div>
  );
}
