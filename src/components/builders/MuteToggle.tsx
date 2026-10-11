/**
 * MuteToggle — the mute switch on every builder card's header (builders/mute.ts, docs/scene-builder.md,
 * "Muting"). The same ⊘ as a node's bypass, because a muted card is a bypassed node in the graph.
 *
 *  - click (or Enter / Space): mute or unmute the card, one undo step;
 *  - Alt/Option-click: solo it, muting the other cards in its stack (again: unmute them all);
 *  - a muted card dims (MutedBody) and says "Muted" (MutedTag).
 */
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { IconButton } from '../ui/Button';
import { useTokens } from '../../theme/themeStore';
import { alpha } from '../../theme/tokens';

export function MuteToggle({ muted, onToggle, onSolo, what = 'this', size = 'sm', style }: {
  muted: boolean;
  onToggle: () => void;
  /** Alt/Option-click: solo this card in its stack. */
  onSolo?: () => void;
  /** What the card is, for the label ("Mirror", "the bloom"). */
  what?: string;
  size?: 'sm' | 'md';
  style?: CSSProperties;
}) {
  const tk = useTokens();
  const label = muted
    ? `Turn ${what} back on`
    : `Mute ${what}: see the picture without it${onSolo ? ' (Alt-click: solo it)' : ''}`;
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    if (e.altKey && onSolo) onSolo(); else onToggle();
  };
  return (
    <IconButton
      icon="bypass"
      label={label}
      size={size}
      aria-pressed={muted}
      data-mute-toggle
      onMouseDown={e => e.stopPropagation()}
      onClick={click}
      style={{ ...(muted ? { background: alpha(tk.status.warning, 0.16), color: tk.status.warningText } : {}), ...style }}
    />
  );
}

/** "Muted" beside a muted card's title. */
export function MutedTag({ style }: { style?: CSSProperties }) {
  const tk = useTokens();
  return (
    <span data-muted-tag style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', borderRadius: 5, padding: '2px 6px', flexShrink: 0,
      color: tk.status.warningText, background: alpha(tk.status.warning, 0.16), textTransform: 'uppercase', ...style,
    }}>Muted</span>
  );
}

/** The dim a muted card's contents take (its header's toggle stays bright). */
export const MUTED_DIM: CSSProperties = { opacity: 0.45, filter: 'grayscale(0.5)' };

/** A muted card's body, dimmed; still editable. */
export function MutedBody({ muted, children, style }: { muted: boolean; children: ReactNode; style?: CSSProperties }) {
  return <div data-muted={muted || undefined} style={{ ...(muted ? MUTED_DIM : {}), transition: 'opacity 0.12s', ...style }}>{children}</div>;
}
