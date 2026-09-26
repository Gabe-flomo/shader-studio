/**
 * presentStore — the Present view's state.
 *
 *   mode    null when not presenting; 'full' shows the picture from the app's
 *           own engine (everything works: songs, MIDI files, all layers);
 *           'exact' runs the website player itself, so what you see is what
 *           a visitor to the exported page gets.
 *   device  'screen' fills the window; 'phone' frames the picture at a
 *           phone's size (390 × 844), where the web player stacks its controls.
 *   panel   the side panel with the controls and the key / MIDI legend.
 */
import { create } from 'zustand';

export type PresentMode = 'full' | 'exact';
export type PresentDevice = 'screen' | 'phone';

interface PresentState {
  mode: PresentMode | null;
  device: PresentDevice;
  panel: boolean;
  present: (mode: PresentMode) => void;
  exit: () => void;
  setDevice: (d: PresentDevice) => void;
  togglePanel: () => void;
}

export const usePresent = create<PresentState>(set => ({
  mode: null,
  device: 'screen',
  panel: true,
  present: mode => set({ mode }),
  exit: () => set({ mode: null }),
  setDevice: device => set({ device }),
  togglePanel: () => set(s => ({ panel: !s.panel })),
}));

/** The phone frame the web player lays out for: an iPhone 14/15 viewport. */
export const PHONE_SIZE = { w: 390, h: 844 };
