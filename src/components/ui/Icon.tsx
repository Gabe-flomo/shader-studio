import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { ICONS, type IconName } from './iconPaths';

export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const def = ICONS[name] as { sw: number; body: string; fill?: boolean };
  const ref = useRef<SVGSVGElement>(null);
  // Written once per icon rather than via dangerouslySetInnerHTML, which React re-applies on
  // every re-render of an <svg> — replacing the <path> under the pointer mid-click, so the
  // browser never fires the click. The markup is static (iconPaths.ts), never user content.
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = def.body;
  }, [def.body]);
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={def.fill ? 'currentColor' : 'none'}
      stroke={def.fill ? 'none' : 'currentColor'}
      strokeWidth={def.sw || undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Clicks go to the button the icon sits in, never to the icon's own shapes.
      style={{ flexShrink: 0, display: 'block', pointerEvents: 'none', ...style }}
    />
  );
}
