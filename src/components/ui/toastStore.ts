import { create } from 'zustand';
import type { Tone } from './tone';
import { useActivityStore } from './activityStore';

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Whether the button still applies, asked when the History panel's Activity log offers it later. */
  stillValid?: () => boolean;
}

export interface Toast {
  id: number;
  tone: Tone;
  title: string;
  message?: string;
  /** Raw error text; the toast offers "Copy details". */
  details?: string;
  action?: ToastAction;
  /** A second button beside the first (Surprise's Reroll · Undo). Not kept in the Activity log. */
  secondary?: ToastAction;
  /** Stay until dismissed, like an error (for a notice that asks for something, like a reload). */
  sticky?: boolean;
  /** Its entry in the Activity log (History panel). */
  logId?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
}

const MAX_VISIBLE = 3;
let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    // Every notice is also kept in the Activity log, so one that faded can still be read
    const logId = useActivityStore.getState().add(t);
    set(s => ({ toasts: [...s.toasts, { ...t, id, logId }].slice(-MAX_VISIBLE) }));
    return id;
  },
  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

type ToastOptions = Pick<Toast, 'message' | 'details' | 'action' | 'secondary' | 'sticky'>;

/**
 * Transient notices for things that happen outside any open panel: an import that failed, a
 * save that didn't make it to disk, a finished export. Errors stay until dismissed; the rest
 * auto-dismiss (see Toaster).
 */
export const toast = {
  error: (title: string, opts?: ToastOptions) => useToastStore.getState().push({ tone: 'danger', title, ...opts }),
  warning: (title: string, opts?: ToastOptions) => useToastStore.getState().push({ tone: 'warning', title, ...opts }),
  success: (title: string, opts?: ToastOptions) => useToastStore.getState().push({ tone: 'success', title, ...opts }),
  info: (title: string, opts?: ToastOptions) => useToastStore.getState().push({ tone: 'info', title, ...opts }),
};
