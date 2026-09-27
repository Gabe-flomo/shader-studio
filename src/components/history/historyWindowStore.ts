import { create } from 'zustand';

/** Whether the History panel is popped out into its floating window (HistoryWindow.tsx). */
export const useHistoryWindow = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({
  open: false,
  setOpen: open => set({ open }),
}));
