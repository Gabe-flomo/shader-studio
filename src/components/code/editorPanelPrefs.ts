import { create } from 'zustand';

/**
 * Which side panels the code editors (Expression Block, Custom Function) show: the function
 * palette on the right (closed by default, so the code gets the width) and the Inputs panel on
 * the left (open by default; it folds to a slim rail of input chips). Remembered across sessions
 * in localStorage, like the other editor preferences; storage that is missing or throws just
 * means the defaults, for this session.
 */
export type EditorPanel = 'functions' | 'inputs';
export type EditorPanels = Record<EditorPanel, boolean>;

export const EDITOR_PANELS_KEY = 'playfield.editorPanels.v1';
export const DEFAULT_EDITOR_PANELS: EditorPanels = { functions: false, inputs: true };
/** Below this window width the panels open as drawers over the code instead of beside it. */
export const DRAWER_BELOW_PX = 1100;

export function loadEditorPanels(): EditorPanels {
  try {
    const raw = localStorage.getItem(EDITOR_PANELS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const out = { ...DEFAULT_EDITOR_PANELS };
    if (parsed && typeof parsed === 'object') {
      for (const k of Object.keys(out) as EditorPanel[]) if (typeof parsed[k] === 'boolean') out[k] = parsed[k];
    }
    return out;
  } catch { return { ...DEFAULT_EDITOR_PANELS }; }
}

export const useEditorPanels = create<{
  open: EditorPanels;
  set: (panel: EditorPanel, open: boolean) => void;
  toggle: (panel: EditorPanel) => void;
  /** Re-read storage (tests, another window). */
  reload: () => void;
}>((set, get) => ({
  open: loadEditorPanels(),
  set: (panel, open) => {
    const next = { ...get().open, [panel]: open };
    try { localStorage.setItem(EDITOR_PANELS_KEY, JSON.stringify(next)); } catch { /* session only */ }
    set({ open: next });
  },
  toggle: panel => get().set(panel, !get().open[panel]),
  reload: () => set({ open: loadEditorPanels() }),
}));

/** The panel a shortcut toggles: ⌘[ the Inputs panel, ⌘] the functions (Ctrl on other systems). */
export function panelForShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): EditorPanel | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  return e.key === '[' ? 'inputs' : e.key === ']' ? 'functions' : null;
}
