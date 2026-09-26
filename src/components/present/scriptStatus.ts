/**
 * scriptStatus — what each live-edited Script layer is doing, as its canvas
 * reports it (compiled and running, or the error), for the code block that
 * edits it. Keyed by step, source and layer: an edit runs only in its own
 * step's canvases.
 */
import { create } from 'zustand';

export const scriptKey = (stepId: string, source: string, layerId: string) => `${stepId}|${source}|${layerId}`;

interface ScriptStatusState {
  /** key → null (runs) or the error; missing when no canvas has run it yet. */
  status: Record<string, string | null>;
  report(key: string, error: string | null): void;
}

export const useScriptStatus = create<ScriptStatusState>(set => ({
  status: {},
  report: (key, error) => set(s => (s.status[key] === error ? s : { status: { ...s.status, [key]: error } })),
}));
