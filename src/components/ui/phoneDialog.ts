import { useEffect, useState } from 'react';
import { useViewport } from '../../lib/viewport';

/**
 * Below this viewport width (a phone) a Modal fills the screen instead of floating: the panel
 * runs edge to edge, its rows get 16px gutters, and the footer's buttons stack.
 */
export const PHONE_DIALOG_BELOW = 480;

/** Does a dialog take its phone layout at this viewport width? */
export function phoneDialog(viewportWidth: number): boolean {
  return viewportWidth < PHONE_DIALOG_BELOW;
}

/**
 * Live `phoneDialog(window.innerWidth)`, following rotations and resizes. A phone held sideways
 * (wider than 480, but only ~390 tall: lib/viewport.ts) takes the full-screen layout too, since a
 * floating panel would leave a strip a few rows high between its header and footer.
 */
export function usePhoneDialog(): boolean {
  const phoneDevice = useViewport(s => s.phone);
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && phoneDialog(window.innerWidth));
  useEffect(() => {
    const on = () => setPhone(phoneDialog(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return phone || phoneDevice;
}
