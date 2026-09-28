/**
 * useBreakpoint — the layout's size class. `mobile` means a phone (a touch
 * device whose shorter side is small, either way up: see lib/viewport.ts),
 * never just a narrow window; the rest go by width.
 */
import { useViewport, getBreakpoint, type Breakpoint } from '../lib/viewport';

export { getBreakpoint, type Breakpoint };

export function useBreakpoint(): Breakpoint {
  return useViewport(s => s.breakpoint);
}

/** Phones: whether it's one, and which way it's held. */
export function usePhoneLayout(): { phone: boolean; landscape: boolean } {
  const phone = useViewport(s => s.phone);
  const landscape = useViewport(s => s.landscape);
  return { phone, landscape };
}

export const isMobile    = (bp: Breakpoint) => bp === 'mobile';
export const isTablet    = (bp: Breakpoint) => bp === 'tablet';
export const isDesktop   = (bp: Breakpoint) => bp === 'desktop-sm' || bp === 'desktop-lg';
export const isMobileOrTablet = (bp: Breakpoint) => bp === 'mobile' || bp === 'tablet';
