/**
 * rotateFullscreen — a phone turned sideways can show just the picture,
 * full-bleed: on Play only (the default), on Play and the Studio ("always"),
 * or never. Remembered on this device. `rotateShowsFullscreen` is the rule.
 */
import { create } from 'zustand';

export type RotateFullscreen = 'off' | 'play' | 'always';
export const ROTATE_FULLSCREEN_KEY = 'shader-studio:rotateFullscreen';
export const ROTATE_FULLSCREEN_OPTIONS: readonly { value: RotateFullscreen; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'play', label: 'Play only' },
  { value: 'always', label: 'Always' },
];

export const rotateFullscreenLabel = (v: RotateFullscreen): string => ROTATE_FULLSCREEN_OPTIONS.find(o => o.value === v)?.label ?? 'Play only';

/** The setting after Off → Play only → Always → Off. */
export function nextRotateFullscreen(v: RotateFullscreen): RotateFullscreen {
  return v === 'off' ? 'play' : v === 'play' ? 'always' : 'off';
}

export function readRotateFullscreen(): RotateFullscreen {
  try {
    const v = localStorage.getItem(ROTATE_FULLSCREEN_KEY);
    if (v === 'off' || v === 'play' || v === 'always') return v;
  } catch { /* storage blocked */ }
  return 'play';
}

/**
 * Whether turning the phone sideways shows the picture alone: a phone in
 * landscape, on a page with a picture the setting covers, and not after the
 * person left it this time round (`dismissed`, cleared when it turns back).
 */
export function rotateShowsFullscreen(a: { setting: RotateFullscreen; page: string; phone: boolean; landscape: boolean; dismissed?: boolean }): boolean {
  if (!a.phone || !a.landscape || a.dismissed) return false;
  if (a.setting === 'off') return false;
  if (a.setting === 'play') return a.page === 'play';
  return a.page === 'play' || a.page === 'studio';
}

interface RotateState { setting: RotateFullscreen; set: (v: RotateFullscreen) => void; cycle: () => void }

export const useRotateFullscreen = create<RotateState>((set, get) => ({
  setting: readRotateFullscreen(),
  set: v => {
    set({ setting: v });
    try { if (v === 'play') localStorage.removeItem(ROTATE_FULLSCREEN_KEY); else localStorage.setItem(ROTATE_FULLSCREEN_KEY, v); } catch { /* storage blocked */ }
  },
  cycle: () => get().set(nextRotateFullscreen(get().setting)),
}));
