import { create } from 'zustand';

// In-app replacements for window.prompt / window.confirm, which are unreliable in the desktop
// (Tauri) webview. Call askText / askConfirm from anywhere; <DialogHost /> (mounted once, next to
// the Toaster) renders whichever one is open.

export interface TextRequest { kind: 'text'; title: string; label?: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void }
export interface ConfirmRequest { kind: 'confirm'; title: string; message?: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void }
type Request = TextRequest | ConfirmRequest;

export const useDialogStore = create<{ current: Request | null }>(() => ({ current: null }));

/** Ask for a line of text. Resolves with the trimmed text, or null if cancelled or left empty. */
export function askText(title: string, opts: { label?: string; initial?: string; confirmLabel?: string } = {}): Promise<string | null> {
  return new Promise(resolve => useDialogStore.setState({
    current: { kind: 'text', title, label: opts.label, initial: opts.initial ?? '', confirmLabel: opts.confirmLabel ?? 'OK', resolve },
  }));
}

/** Ask to confirm an action. Resolves true only when confirmed. */
export function askConfirm(title: string, opts: { message?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => useDialogStore.setState({
    current: { kind: 'confirm', title, message: opts.message, confirmLabel: opts.confirmLabel ?? 'OK', danger: !!opts.danger, resolve },
  }));
}

export function closeDialog() { useDialogStore.setState({ current: null }); }
