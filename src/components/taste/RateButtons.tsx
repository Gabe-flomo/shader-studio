/**
 * RateButtons — a small like / dislike pair on anything worth a taste (saved graphs, GLSL shaders,
 * examples, palettes, technique cards). A rating feeds the taste model (docs/taste.md) and, for a graph or
 * a shader, its weight as a Surprise source; clicking the lit one again clears it. All on this device.
 */
import type { MouseEvent } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { useTaste } from '../../taste/store';
import { rate, type RateTarget } from './tasteActions';

export function RateButtons({ target, size = 22, quiet = false }: { target: RateTarget; size?: number; /** Hide the unlit pair until rated (rows that are busy already). */ quiet?: boolean }) {
  const tk = useTokens();
  const v = useTaste(s => s.model.ratings[target.id]?.v ?? 0);
  const btn = (value: 1 | -1) => {
    const lit = v === value;
    const label = value > 0 ? (lit ? 'Liked: click to clear' : 'Like this (your taste learns; liked graphs inspire Surprise more)') : (lit ? 'Disliked: click to clear' : 'Not for me (your taste learns)');
    return (
      <button type="button" aria-label={label} title={label} aria-pressed={lit} data-rate={value > 0 ? 'up' : 'down'}
        onClick={(e: MouseEvent) => { e.stopPropagation(); void rate(target, lit ? 0 : value); }}
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 0, borderRadius: 6, cursor: 'pointer',
          background: lit ? alpha(value > 0 ? tk.status.success : tk.status.danger, 0.14) : 'transparent',
          color: lit ? (value > 0 ? tk.status.success : tk.status.danger) : tk.text.faint,
          opacity: quiet && !v ? 0.55 : 1,
        }}>
        <Icon name={value > 0 ? (lit ? 'thumbUpF' : 'thumbUp') : (lit ? 'thumbDownF' : 'thumbDown')} size={Math.round(size * 0.62)} />
      </button>
    );
  };
  return <span data-rate-item={target.id} style={{ display: 'inline-flex', gap: 1, flexShrink: 0 }}>{btn(1)}{btn(-1)}</span>;
}
