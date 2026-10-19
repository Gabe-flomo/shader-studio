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
 *   snapshot  set when a Present page's canvas opened the Stage: its
 *           snapshot's page runs in Exact (a snapshot isn't the open graph,
 *           so Full has nothing to show for it).
 */
import { create } from 'zustand';
import type { PlayRecord } from '../../types/play';
import type { PlayHtmlInput } from '../../play/exportHtml';
import { RANDOM_STRENGTH, type PerformSize } from '../../play/perform';

/** A Present canvas on the Stage: the page to run and what to say about it. */
export interface StageSnapshot {
  /** The source's title, and the presentation it's in. */
  title: string;
  presentation: string;
  capturedAt: number;
  /** The exported page for the snapshot (with the step's Script edits). */
  html: string;
  /** Someone else's Script layers: the page runs in a sandboxed frame (and can't be recorded). */
  sandboxed: boolean;
  /** The step's live code blocks changed its Script layers. */
  edited: boolean;
  play: PlayRecord;
  /** What the page is built from (with the step's Script edits): the output window follows it from this. */
  input?: PlayHtmlInput;
  missing: string[];
  left: { what: string; why: string }[];
}

export type StageMode = 'full' | 'exact';
export type StageDevice = 'screen' | 'phone';

interface StageState {
  mode: StageMode | null;
  device: StageDevice;
  panel: boolean;
  snapshot: StageSnapshot | null;
  open: (mode: StageMode) => void;
  /** Open the Stage on a Present canvas's snapshot (Exact). */
  openSnapshot: (s: StageSnapshot) => void;
  exit: () => void;
  setDevice: (d: StageDevice) => void;
  togglePanel: () => void;
  /** Perform (docs/perform-mode.md): the controls grid's size and Randomize's strength, kept on this computer. */
  size: PerformSize;
  strength: number;
  setSize: (s: PerformSize) => void;
  setStrength: (k: number) => void;
}

const PERFORM_KEY = 'shader-studio:perform';
function loadPerform(): { size: PerformSize; strength: number } {
  const d = { size: 'M' as PerformSize, strength: RANDOM_STRENGTH.default };
  try {
    const raw = JSON.parse(localStorage.getItem(PERFORM_KEY) ?? 'null') as { size?: unknown; strength?: unknown } | null;
    const size = raw?.size === 'S' || raw?.size === 'M' || raw?.size === 'L' ? raw.size : d.size;
    const k = typeof raw?.strength === 'number' && Number.isFinite(raw.strength) ? Math.max(RANDOM_STRENGTH.min, Math.min(RANDOM_STRENGTH.max, raw.strength)) : d.strength;
    return { size, strength: k };
  } catch { return d; }
}
function savePerform(v: { size: PerformSize; strength: number }): void {
  try { localStorage.setItem(PERFORM_KEY, JSON.stringify(v)); } catch { /* private window: kept for this visit only */ }
}

export const useStage = create<StageState>(set => ({
  mode: null,
  device: 'screen',
  panel: true,
  snapshot: null,
  open: mode => set({ mode }),
  openSnapshot: snapshot => set({ mode: 'exact', snapshot }),
  exit: () => set({ mode: null, snapshot: null }),
  setDevice: device => set({ device }),
  togglePanel: () => set(s => ({ panel: !s.panel })),
  ...loadPerform(),
  setSize: size => set(s => { savePerform({ size, strength: s.strength }); return { size }; }),
  setStrength: k => set(s => {
    const strength = Math.max(RANDOM_STRENGTH.min, Math.min(RANDOM_STRENGTH.max, k));
    savePerform({ size: s.size, strength });
    return { strength };
  }),
}));

/** The phone frame the web player lays out for: an iPhone 14/15 viewport. */
export const PHONE_SIZE = { w: 390, h: 844 };
