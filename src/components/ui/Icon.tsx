import type { CSSProperties } from 'react';
import { ICONS, type IconName } from './iconPaths';

export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const def = ICONS[name] as { sw: number; body: string; fill?: boolean };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={def.fill ? 'currentColor' : 'none'}
      stroke={def.fill ? 'none' : 'currentColor'}
      strokeWidth={def.sw || undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block', ...style }}
      // Static markup from iconPaths.ts — never user content.
      dangerouslySetInnerHTML={{ __html: def.body }}
    />
  );
}
