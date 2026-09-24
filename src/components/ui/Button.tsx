import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from './Icon';
import type { IconName } from './iconPaths';
import { Tooltip } from './Tooltip';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Text button. One `primary` (ink) per surface; `ghost` for dismissals. `md` is 34px (modals),
 * `sm` is 30px (panels, toolbars).
 */
export function Button({
  variant = 'secondary', size = 'md', icon, children, style, disabled, ...rest
}: {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: IconName;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const h = size === 'md' ? 34 : 30;
  const palette: Record<Variant, { bg: string; bgHover: string; fg: string; border: string }> = {
    primary: { bg: tk.ink.base, bgHover: tk.ink.base, fg: tk.ink.text, border: tk.ink.base },
    secondary: { bg: tk.bg.panel, bgHover: tk.bg.hover, fg: tk.text.secondary, border: tk.border.default },
    ghost: { bg: 'transparent', bgHover: tk.bg.hover, fg: tk.text.secondary, border: 'transparent' },
    danger: { bg: tk.status.danger, bgHover: tk.status.danger, fg: tk.ink.text, border: tk.status.danger },
  };
  const p = palette[variant];
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: h, padding: `0 ${size === 'md' ? 13 : 10}px`, borderRadius: size === 'md' ? radius.control : radius.md,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, flexShrink: 0,
        border: `1px solid ${p.border}`, background: hover && !disabled ? p.bgHover : p.bg, color: p.fg,
        font: `${variant === 'primary' ? 600 : 500} ${size === 'md' ? 12.5 : 12}px ${fontFamily.ui}`, whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : variant === 'primary' && hover ? 0.88 : 1,
        transition: 'background 0.12s, opacity 0.12s',
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/**
 * Icon-only button. `label` is required: it becomes the aria-label and the tooltip, so no
 * icon button ships without one. `sm` is 26px (node cards), `md` is 32px (panels).
 */
export function IconButton({
  icon, label, shortcut, size = 'md', active = false, tone = 'default', tooltip = true, style, disabled, ...rest
}: {
  icon: IconName;
  label: string;
  shortcut?: string;
  size?: 'sm' | 'md';
  active?: boolean;
  tone?: 'default' | 'danger';
  tooltip?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const s = size === 'md' ? 32 : 26;
  const color = active ? tk.accent.base
    : hover && tone === 'danger' ? tk.status.danger
    : hover ? tk.text.secondary : tk.text.faint;
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: s, height: s, padding: 0, border: 0, borderRadius: size === 'md' ? radius.control : radius.md,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        background: active ? tk.bg.selected : hover && !disabled ? tk.bg.hover : 'transparent',
        color, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        transition: 'background 0.12s, color 0.12s',
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={size === 'md' ? 16 : 15} />
    </button>
  );
  return tooltip ? <Tooltip label={label} shortcut={shortcut}>{button}</Tooltip> : button;
}
