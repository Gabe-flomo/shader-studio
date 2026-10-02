import { useEffect, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';

/** A rule's lamp: lit while it is on, and blinking each time it fires. */
export function Lamp({ on, flash, size = 9 }: { on: boolean; flash: number; size?: number }) {
  const tk = useTokens();
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!flash) return;
    setBlink(true);
    const t = window.setTimeout(() => setBlink(false), 180);
    return () => window.clearTimeout(t);
  }, [flash]);
  const lit = on || blink;
  return <span aria-label={lit ? 'On' : 'Off'} role="img" data-lamp={lit ? 'on' : 'off'} style={{ width: size, height: size, borderRadius: size, flexShrink: 0, background: lit ? tk.accent.base : tk.text.disabled, boxShadow: lit ? `0 0 6px ${tk.accent.base}` : 'none', transition: 'background 0.12s, box-shadow 0.12s' }} />;
}
