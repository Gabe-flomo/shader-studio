/**
 * "Make a slider" in any code editor: put the caret on a number (or select it) and a small
 * button offers to turn it into a slider input. The text work is lib/glslPatterns/literalSlider.ts
 * and the node work nodes/codeSlider.ts; this is the offer (useLiteralOffer + MakeSliderButton)
 * and the write (codeSliderActions.ts: useLiteralOffer, applyCodeSlider: one undo step, the
 * sockets refreshed, a toast).
 */
import type { LiteralSpan } from '../../lib/glslPatterns/literalSlider';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';

/** The offer: a small button under the field the number is in. Keeps the field focused. */
export function MakeSliderButton({ lit, name, onMake, indent = 0 }: { lit: LiteralSpan; name?: string; onMake: () => void; indent?: number }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', paddingLeft: indent }}>
      <button type="button" data-make-slider="" title={`Turn ${lit.text} into a slider input${name ? ` named ${name}` : ''}, starting at ${lit.value}`}
        onMouseDown={e => e.preventDefault()}
        onClick={onMake}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', border: 0, borderRadius: radius.control, cursor: 'pointer',
          background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 12px ${fontFamily.ui}`,
        }}>
        <Icon name="sliders" size={13} />
        Make a slider
        <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>{lit.text}{name ? ` → ${name}` : ''}</span>
      </button>
    </div>
  );
}
