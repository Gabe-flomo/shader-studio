/**
 * KeyboardPill — the top bar's sign that an Audio engine rack has the
 * computer keyboard ("Keyboard → Rack 1 · Esc"), while it does. Clicking it,
 * like Esc, gives the keyboard back (lib/rackKeyboard.ts).
 */
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily } from '../../../theme/tokens';
import { Icon } from '../../ui/Icon';
import { Kbd } from '../../ui/Kbd';
import { rackKeyboard, useRackKeyboard } from '../../../lib/rackKeyboard';

export function KeyboardPill({ compact = false }: { compact?: boolean } = {}) {
  const tk = useTokens();
  const rackId = useRackKeyboard(s => s.rackId);
  const rackName = useRackKeyboard(s => s.rackName);
  const octave = useRackKeyboard(s => s.octave);
  if (!rackId) return null;
  const label = `Keyboard → ${rackName || 'rack'}`;
  return (
    <button
      type="button"
      onClick={() => rackKeyboard.releaseNow()}
      title={`The computer keyboard plays ${rackName || 'this rack'} (octave C${octave}). The app's key shortcuts and Play key mappings wait; ⌘ combos still work. Click, or press Esc, to give the keyboard back.`}
      aria-label={`${label}. Click or press Esc to give the keyboard back`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: compact ? '0 8px' : '0 8px 0 10px', border: 0, borderRadius: 999, cursor: 'pointer', background: alpha(tk.accent.base, 0.14), color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}
    >
      <Icon name="keyboard" size={13} />
      {!compact && <span>{label}</span>}
      {!compact && <Kbd combo="escape" />}
    </button>
  );
}
