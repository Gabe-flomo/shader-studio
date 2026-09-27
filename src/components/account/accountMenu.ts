import { signOut } from '../../auth/gate';
import { openProSheet, type Session } from '../../lib/plan';
import type { MenuItem } from '../ui/Menu';

/** "Signed in as gabe · Pro", or null when there's no sign-in (the gate is off). */
export function signedInLabel(s: Session): string | null {
  if (s.status !== 'signed-in' || s.source === 'open') return null;
  return `Signed in as ${s.user} · ${s.plan === 'pro' ? 'Pro' : 'Free'}`;
}

/** The account rows of a More menu: who is signed in, what Pro adds (on Free), Sign out. */
export function accountMenuItems(s: Session): MenuItem[] {
  const label = signedInLabel(s);
  if (!label || s.status !== 'signed-in') return [];
  return [
    { heading: label },
    ...(s.plan === 'free' ? [{ label: 'What Pro adds', icon: 'spark' as const, hint: 'Layers, every Play source, Convert, 4K, website export and more', onSelect: () => openProSheet() }] : []),
    { label: 'Sign out', icon: 'unlink', onSelect: signOut },
  ];
}
