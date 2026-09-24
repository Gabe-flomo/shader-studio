import { createContext, useContext } from 'react';
import { create } from 'zustand';
import { THEMES, type ThemeMode, type Tokens } from './tokens';

const STORAGE_KEY = 'shader-studio:theme';

// Light is the default; dark is opt-in from the top bar. The OS preference is deliberately ignored.
function loadMode(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: loadMode(),
  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* private mode: keep it for this session only */ }
    set({ mode });
  },
  toggle: () => get().setMode(get().mode === 'light' ? 'dark' : 'light'),
}));

/** Pins a subtree to one theme regardless of the app setting (the UI gallery shows both side by side). */
export const ThemeOverrideContext = createContext<ThemeMode | null>(null);

export function useThemeMode(): ThemeMode {
  const override = useContext(ThemeOverrideContext);
  const mode = useThemeStore(s => s.mode);
  return override ?? mode;
}

export function useTokens(): Tokens {
  return THEMES[useThemeMode()];
}
