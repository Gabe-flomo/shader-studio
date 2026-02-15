import { useState, useEffect } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop-sm' | 'desktop-lg';

function getBreakpoint(width: number): Breakpoint {
  if (width < 768)  return 'mobile';
  if (width < 1024) return 'tablet';
  if (width < 1280) return 'desktop-sm';
  return 'desktop-lg';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => getBreakpoint(window.innerWidth));

  useEffect(() => {
    const handler = () => setBp(getBreakpoint(window.innerWidth));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return bp;
}

export const isMobile    = (bp: Breakpoint) => bp === 'mobile';
export const isTablet    = (bp: Breakpoint) => bp === 'tablet';
export const isDesktop   = (bp: Breakpoint) => bp === 'desktop-sm' || bp === 'desktop-lg';
export const isMobileOrTablet = (bp: Breakpoint) => bp === 'mobile' || bp === 'tablet';
