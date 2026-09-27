import { useEffect, useState } from 'react';

/**
 * Below this viewport width (a phone) a Modal fills the screen instead of floating: the panel
 * runs edge to edge, its rows get 16px gutters, and the footer's buttons stack.
 */
export const PHONE_DIALOG_BELOW = 480;

/** Does a dialog take its phone layout at this viewport width? */
export function phoneDialog(viewportWidth: number): boolean {
  return viewportWidth < PHONE_DIALOG_BELOW;
}

/** Live `phoneDialog(window.innerWidth)`, following rotations and resizes. */
export function usePhoneDialog(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && phoneDialog(window.innerWidth));
  useEffect(() => {
    const on = () => setPhone(phoneDialog(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return phone;
}
