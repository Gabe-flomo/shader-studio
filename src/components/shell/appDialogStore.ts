/**
 * appDialogStore.ts — the two app-wide windows that used to be Files pages (docs/glossary.md):
 * App settings (from the top bar's ⋯ menu) and the Nodes reference (from Help). AppDialogs.tsx
 * draws them over whatever page is open.
 */
import { create } from 'zustand';

interface AppDialogsState {
  settings: boolean;
  /** The Nodes reference: open, and the node type whose page it shows (null: the list). */
  nodes: { type: string | null } | null;
}

export const useAppDialogs = create<AppDialogsState>(() => ({ settings: false, nodes: null }));

export function openAppSettings(): void { useAppDialogs.setState({ settings: true }); }
export function closeAppSettings(): void { useAppDialogs.setState({ settings: false }); }
export function openNodesReference(type: string | null = null): void { useAppDialogs.setState({ nodes: { type } }); }
export function closeNodesReference(): void { useAppDialogs.setState({ nodes: null }); }
