import { create } from 'zustand';
import type { Tone } from './tone';

export interface ToastAction { label: string; onClick: () => void }

export interface Toast {
  id: number;
  tone: Tone;
  title: string;
  message?: string;
  /** Raw error text; the toast offers "Copy details". */
  details?: string;
  action?: ToastAction;
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
    set(s => ({ toasts: [...s.toasts, { ...t, id }].slice(-MAX_VISIBLE) }));
    return id;
  },
  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

type ToastOptions = Pick<Toast, 'message' | 'details' | 'action'>;

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
