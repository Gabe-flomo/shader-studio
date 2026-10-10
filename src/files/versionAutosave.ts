/**
 * versionAutosave.ts — autosave as versions, the pure part (docs/graph-series-plan.md, "Autosave").
 *
 * Not crash recovery (autosave.ts / recovery.ts keep snapshots of unsaved work outside the
 * graph's history). This saves the open graph as a new **minor version** of its series, through
 * the series' normal save path, so the size cap and history trimming apply.
 *
 * - Only a graph saved once (it has a series name); an untitled graph can't autosave.
 * - On by default: it starts when a named graph is opened or saved, and stops when you leave it
 *   (another graph, an example, a new graph). Optionally only for 30 minutes.
 * - Every 2 / 5 / 10 / 15 minutes (5 by default), and only if the graph changed since its last save.
 * - The version is marked `auto` with the note "Autosave"; trimming drops autosaves first.
 * - While something holds the graph in a temporary state (Convert's scratch graph, a recording
 *   or a render), a due save waits and is tried again shortly after.
 * - A failed save (storage full, the storage limit) pauses autosave with its reason until it is
 *   resumed or a save by hand works.
 *
 * No storage and no timers of its own: the wiring (versionAutosaveApp.ts) hands it the graph,
 * the save and the clock, and tests hand it fakes.
 */
import { realTimers, type Timers } from './autosave';

export const VERSION_AUTOSAVE_MIN_KEY = 'shader-studio:settings:versionAutosaveMin';
export const VERSION_AUTOSAVE_ON_KEY = 'shader-studio:settings:versionAutosaveOn';
export const AUTOSAVE_MINUTES = [2, 5, 10, 15] as const;
export const DEFAULT_AUTOSAVE_MIN = 5;
export const AUTOSAVE_NOTE = 'Autosave';
/** How long "For 30 minutes" lasts. */
export const AUTOSAVE_SPAN_MS = 30 * 60_000;
/** A due save that something holds is tried again this soon. */
export const HELD_RETRY_MS = 5_000;

/** How long it runs once on: until you leave this graph, or for 30 minutes (and no longer than the graph is open). */
export type AutosaveSpan = 'graph' | '30m';
export const AUTOSAVE_SPANS: ReadonlyArray<{ id: AutosaveSpan; label: string }> = [
  { id: 'graph', label: 'While it’s open' },
  { id: '30m', label: 'For 30 minutes' },
];

/** The interval setting, in minutes. Any positive number reads (a dev override can be shorter); the menu offers 2, 5, 10 and 15. */
export function parseAutosaveMinutes(raw: string | null | undefined): number {
  const v = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(v) && v > 0 ? v : DEFAULT_AUTOSAVE_MIN;
}

export function parseAutosaveDefaultOn(raw: string | null | undefined): boolean {
  return raw !== 'off';
}

export interface AutosaveGraph {
  /** The open graph's series name; null while it is untitled (or an example). */
  name: string | null;
  /** It changed since it was opened or last saved. */
  dirty: boolean;
  /** Something holds it in a temporary state: don't save now. */
  busy: boolean;
}

export type AutosaveSaveResult = { ok: true; label?: string } | { ok: false; error: string };

export interface VersionAutosaveStatus {
  /** The series it is running for (null: no named graph open). */
  graph: string | null;
  on: boolean;
  span: AutosaveSpan;
  /** "For 30 minutes": when it ends. */
  until: number | null;
  /** When the next save is due (null while off or paused). */
  nextAt: number | null;
  intervalMs: number;
  /** Why it paused (a save failed), or null. */
  paused: string | null;
  /** The last autosave: its version label ("2.4") and when. */
  last: { label: string; at: number } | null;
}

export interface VersionAutosaveDeps {
  graph: () => AutosaveGraph;
  save: (name: string) => Promise<AutosaveSaveResult>;
  timers?: Timers;
  /** Every status change (for the indicator and the save menu). */
  onStatus?: (s: VersionAutosaveStatus) => void;
  /** A save failed and autosave paused. */
  onPaused?: (name: string, error: string) => void;
  /** "For 30 minutes" ran out. */
  onEnded?: (name: string) => void;
}

export class VersionAutosave {
  private s: VersionAutosaveStatus;
  private timer: unknown = null;
  private saving = false;
  private defaultOn: boolean;
  private readonly t: Timers;
  private readonly deps: VersionAutosaveDeps;

  constructor(deps: VersionAutosaveDeps, opts: { minutes?: number; defaultOn?: boolean } = {}) {
    this.deps = deps;
    this.t = deps.timers ?? realTimers;
    this.defaultOn = opts.defaultOn ?? true;
    this.s = { graph: null, on: false, span: 'graph', until: null, nextAt: null, intervalMs: (opts.minutes ?? DEFAULT_AUTOSAVE_MIN) * 60_000, paused: null, last: null };
  }

  get status(): VersionAutosaveStatus { return this.s; }
  get isSaving(): boolean { return this.saving; }

  /**
   * The open graph's name may have changed: opening or saving a named graph starts autosave
   * for it (when on by default); leaving it (another graph, untitled) stops it.
   */
  graphChanged(): void {
    const name = this.deps.graph().name;
    if (name === this.s.graph) return;
    this.disarm();
    if (name === null) { this.set({ graph: null, on: false, until: null, nextAt: null, paused: null, last: null }); return; }
    this.set({ graph: name, on: this.defaultOn, span: 'graph', until: null, paused: null, last: null, nextAt: null });
    if (this.s.on) this.restart();
  }

  /** The open graph was saved (by hand or not): a working save lifts a pause, and the countdown starts again. */
  saved(): void {
    if (this.saving || !this.s.graph) return;
    if (this.s.paused) this.set({ paused: null });
    if (this.s.on) this.restart();
  }

  /** Turn it on or off for the open graph (with how long, when turning on). */
  setOn(on: boolean, span: AutosaveSpan = this.s.span): void {
    if (on && !this.s.graph) return; // untitled: nothing to save into
    this.disarm();
    if (!on) { this.set({ on: false, until: null, nextAt: null }); return; }
    this.set({ on: true, span, paused: null, until: span === '30m' ? this.t.now() + AUTOSAVE_SPAN_MS : null });
    this.restart();
  }

  setSpan(span: AutosaveSpan): void {
    if (this.s.on) this.setOn(true, span); else this.set({ span });
  }

  setMinutes(minutes: number): void {
    if (!(minutes > 0)) return;
    this.set({ intervalMs: minutes * 60_000 });
    if (this.s.on && !this.s.paused) this.restart();
  }

  /** Whether autosave starts on for each graph opened from now on. */
  setDefaultOn(on: boolean): void { this.defaultOn = on; }

  /** Try again after a pause. */
  resume(): void {
    if (!this.s.graph) return;
    this.set({ paused: null });
    if (this.s.on) this.restart(); else this.setOn(true);
  }

  /** Save now if due and changed (the timer's job; tests call it too). */
  async tick(): Promise<void> {
    this.timer = null;
    const s = this.s;
    if (!s.on || !s.graph || s.paused || this.saving) return;
    const now = this.t.now();
    // "For 30 minutes" is up: changes since the last autosave are saved once more, then it ends.
    const ending = s.until !== null && now >= s.until;
    if (!ending && s.nextAt !== null && now < s.nextAt) { this.arm(); return; }
    const g = this.deps.graph();
    if (g.name !== s.graph) { this.graphChanged(); return; }
    if (g.busy) { this.armIn(HELD_RETRY_MS); return; }
    if (g.dirty) {
      this.saving = true;
      let r: AutosaveSaveResult;
      try { r = await this.deps.save(s.graph); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
      finally { this.saving = false; }
      if (this.s.graph !== s.graph || !this.s.on) return; // left the graph (or turned it off) while it saved
      if (!r.ok) {
        this.disarm();
        this.set({ paused: r.error, nextAt: null });
        this.deps.onPaused?.(s.graph, r.error);
        return;
      }
      this.set({ last: { label: r.label ?? '', at: this.t.now() } });
    }
    if (ending) {
      this.disarm();
      this.set({ on: false, until: null, nextAt: null });
      this.deps.onEnded?.(s.graph);
      return;
    }
    this.restart();
  }

  dispose(): void { this.disarm(); }

  private restart(): void {
    this.set({ nextAt: this.t.now() + this.s.intervalMs });
    this.arm();
  }

  /** The timer, to the next save or the 30-minute end, whichever is sooner. */
  private arm(): void {
    if (this.s.nextAt === null) return;
    const due = this.s.until !== null ? Math.min(this.s.nextAt, this.s.until) : this.s.nextAt;
    this.armIn(Math.max(0, due - this.t.now()));
  }

  private armIn(ms: number): void {
    this.disarm();
    this.timer = this.t.setTimeout(() => { void this.tick(); }, ms);
  }

  private disarm(): void {
    if (this.timer !== null) { this.t.clearTimeout(this.timer); this.timer = null; }
  }

  private set(patch: Partial<VersionAutosaveStatus>): void {
    this.s = { ...this.s, ...patch };
    this.deps.onStatus?.(this.s);
  }
}

/** "next in 3 min", "next in 40 s". */
export function nextInLabel(nextAt: number | null, now = Date.now()): string {
  if (nextAt === null) return '';
  const s = Math.max(0, Math.round((nextAt - now) / 1000));
  if (s < 60) return `next in ${s} s`;
  return `next in ${Math.ceil(s / 60)} min`;
}
