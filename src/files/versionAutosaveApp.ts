/**
 * versionAutosaveApp.ts — autosave as versions, wired to the app (the rules are in versionAutosave.ts).
 *
 * It follows the open graph (useNodeGraphStore.currentGraph): opening or saving a named graph
 * starts it, leaving the graph stops it. Saves go through `saveGraph(name, "Autosave", "minor",
 * { auto: true })`, the series' normal path (size cap, trimming, the storage limit).
 */
import { create } from 'zustand';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { seriesLabel } from '../store/graphVersions';
import { toast } from '../components/ui/toastStore';
import { isAutosaveHeld } from './recovery';
import {
  AUTOSAVE_NOTE, VERSION_AUTOSAVE_MIN_KEY, VERSION_AUTOSAVE_ON_KEY, VersionAutosave, parseAutosaveDefaultOn, parseAutosaveMinutes,
  type AutosaveSpan, type VersionAutosaveStatus,
} from './versionAutosave';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* a preference only */ } };

interface VersionAutosaveState {
  status: VersionAutosaveStatus;
  minutes: number;
  defaultOn: boolean;
  setOn: (on: boolean, span?: AutosaveSpan) => void;
  setSpan: (span: AutosaveSpan) => void;
  setMinutes: (minutes: number) => void;
  setDefaultOn: (on: boolean) => void;
  resume: () => void;
}

let engine: VersionAutosave | null = null;

export const useVersionAutosave = create<VersionAutosaveState>(set => ({
  status: { graph: null, on: false, span: 'graph', until: null, nextAt: null, intervalMs: parseAutosaveMinutes(read(VERSION_AUTOSAVE_MIN_KEY)) * 60_000, paused: null, last: null },
  minutes: parseAutosaveMinutes(read(VERSION_AUTOSAVE_MIN_KEY)),
  defaultOn: parseAutosaveDefaultOn(read(VERSION_AUTOSAVE_ON_KEY)),
  setOn: (on, span) => engine?.setOn(on, span),
  setSpan: span => engine?.setSpan(span),
  setMinutes: minutes => { write(VERSION_AUTOSAVE_MIN_KEY, String(minutes)); set({ minutes }); engine?.setMinutes(minutes); },
  setDefaultOn: on => { write(VERSION_AUTOSAVE_ON_KEY, on ? 'on' : 'off'); set({ defaultOn: on }); engine?.setDefaultOn(on); },
  resume: () => engine?.resume(),
}));

/** Start following the open graph. Returns a stop (tests; the app runs it for good). */
export function startVersionAutosave(): () => void {
  if (engine) return () => {};
  const st = useVersionAutosave.getState();
  const e = new VersionAutosave({
    graph: () => {
      const g = useNodeGraphStore.getState();
      // Convert's scratch graph isn't the project; recordings and renders hold saves too.
      return { name: g.currentGraph?.name ?? null, dirty: g.graphDirty, busy: !!g.scratch || isAutosaveHeld() };
    },
    save: async name => {
      const r = await useNodeGraphStore.getState().saveGraph(name, AUTOSAVE_NOTE, 'minor', { auto: true });
      if (!r.ok) return { ok: false, error: 'error' in r && r.error ? r.error : 'The save didn’t go through.' };
      const c = useNodeGraphStore.getState().currentGraph;
      return { ok: true, label: c ? seriesLabel(c) : '' };
    },
    onStatus: status => useVersionAutosave.setState({ status }),
    onPaused: (name, error) => toast.warning('Autosave paused', {
      message: `“${name}” couldn’t be autosaved, so autosave stopped trying. Free some space (Files → Clean up) or raise the storage limit, then resume it from the Save menu; a save by hand resumes it too.`,
      details: error,
      action: { label: 'Resume', onClick: () => useVersionAutosave.getState().resume() },
    }),
    onEnded: name => toast.info('Autosave ended', { message: `The 30 minutes of autosave for “${name}” are up. Turn it on again from the Save menu.` }),
  }, { minutes: st.minutes, defaultOn: st.defaultOn });
  engine = e;
  let prev = useNodeGraphStore.getState().currentGraph;
  e.graphChanged();
  const unsub = useNodeGraphStore.subscribe(s => {
    const cur = s.currentGraph;
    if (cur === prev) return;
    const was = prev;
    prev = cur;
    if (cur?.name !== was?.name) { e.graphChanged(); return; }
    // The same series with another version, saved: the countdown starts again (an autosave's own save is skipped inside).
    if (cur && was && cur.version !== was.version && !s.graphDirty) e.saved();
  });
  return () => { unsub(); e.dispose(); engine = null; };
}
