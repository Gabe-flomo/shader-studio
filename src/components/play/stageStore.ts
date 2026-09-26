/**
 * stageStore — the Stage's state (the fullscreen view of the open Play).
 * It was called Present; the Present page (components/present) now teaches
 * with several Plays, and the Stage is where one Play is shown on its own.
 *
 *   mode    null when the Stage is closed; 'full' shows the picture from the
 *           app's own engine (everything works: songs, MIDI files, all layers);
 *           'exact' runs the website player itself, so what you see is what
 *           a visitor to the exported page gets.
 *   device  'screen' fills the window; 'phone' frames the picture at a
 *           phone's size (390 × 844), where the web player stacks its controls.
 *   panel   the side panel with the controls and the key / MIDI legend.
 */
import { create } from 'zustand';

export type StageMode = 'full' | 'exact';
export type StageDevice = 'screen' | 'phone';

interface StageState {
  mode: StageMode | null;
  device: StageDevice;
  panel: boolean;
  open: (mode: StageMode) => void;
  exit: () => void;
  setDevice: (d: StageDevice) => void;
  togglePanel: () => void;
}

export const useStage = create<StageState>(set => ({
  mode: null,
  device: 'screen',
  panel: true,
  open: mode => set({ mode }),
  exit: () => set({ mode: null }),
  setDevice: device => set({ device }),
  togglePanel: () => set(s => ({ panel: !s.panel })),
}));

/** The phone frame the web player lays out for: an iPhone 14/15 viewport. */
export const PHONE_SIZE = { w: 390, h: 844 };
