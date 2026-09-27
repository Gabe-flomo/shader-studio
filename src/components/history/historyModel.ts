/**
 * historyModel — the words and groupings the History panel's cards use, kept
 * apart from the components so they can be tested: which time group an entry
 * falls in, and what kind of change or notice it is (its chip).
 */
import type { StepDiff } from '../../store/historyLabels';
import type { ActivityEntry } from '../ui/activityStore';

export type TimeBucket = 'Just now' | 'Last hour' | 'Earlier today' | 'Yesterday' | 'Earlier this week' | 'Older';

/** The group an entry at `at` sits in, seen at `now`. */
export function timeBucket(at: number, now: number): TimeBucket {
  const age = Math.max(0, now - at);
  if (age < 5 * 60_000) return 'Just now';
  if (age < 60 * 60_000) return 'Last hour';
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return 'Earlier today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  return 'Older';
}

/**
 * A newest-first list cut into runs under a heading. A run starts whenever the
 * group changes, so an out-of-order entry (an undone step, made earlier) gets
 * its own heading rather than being moved.
 */
export function groupByTime<T>(items: readonly T[], at: (t: T) => number, now: number): { bucket: TimeBucket; items: T[] }[] {
  const out: { bucket: TimeBucket; items: T[] }[] = [];
  for (const it of items) {
    const b = timeBucket(at(it), now);
    const last = out[out.length - 1];
    if (last && last.bucket === b) last.items.push(it); else out.push({ bucket: b, items: [it] });
  }
  return out;
}

/** "just now", "4 min ago", "14:03", "Sep 3, 14:03". */
export function whenText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const d = new Date(at);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${hm}`;
}

/** The full date and time, for a detail view. */
export const fullTime = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** What a chip says and which colour role it takes (resolved to a token by the panel). */
export type ChipKind = 'added' | 'removed' | 'wiring' | 'edit' | 'comment' | 'moved' | 'changed' | 'graph'
  | 'error' | 'warning' | 'export' | 'import' | 'play' | 'saved' | 'done' | 'info' | 'release';

export const CHIP_LABEL: Record<ChipKind, string> = {
  added: 'Added', removed: 'Removed', wiring: 'Wiring', edit: 'Edit', comment: 'Comment', moved: 'Moved', changed: 'Changed', graph: 'Graph change',
  error: 'Error', warning: 'Warning', export: 'Export', import: 'Import', play: 'Play', saved: 'Saved', done: 'Done', info: 'Info', release: 'Release',
};

/** What kind of graph change an undo step is, read from what it changed. */
export function stepKind(d: StepDiff): ChipKind {
  const add = d.added.length, rem = d.removed.length, par = d.params.length, wire = d.wires.length, other = d.other.length;
  if (add && !rem) return 'added';
  if (rem && !add) return 'removed';
  if (add || rem) return 'changed';
  if (par && par >= wire && d.params.every(p => p.param === '__comment' || p.param === '__credit')) return 'comment';
  if (par && par >= wire) return 'edit';
  if (wire) return 'wiring';
  if (other) return 'changed';
  if (d.moved.length) return 'moved';
  return 'graph';
}

/** What kind of notice an Activity entry is: its tone, or what its title says it was about. */
export function activityKind(e: Pick<ActivityEntry, 'kind' | 'title'>): ChipKind {
  if (e.kind === 'error') return 'error';
  if (e.kind === 'warning') return 'warning';
  const t = e.title;
  if (/\bexport|\bdownload|\brender(ed)?\b|\brecord(ed|ing)\b/i.test(t)) return 'export';
  if (/\bimport|\bopened\b|\bloaded\b/i.test(t)) return 'import';
  if (/\bplay\b|\bplay ?file|\bstage\b|\bcontrol|\blayer/i.test(t)) return 'play';
  if (/\bsaved?\b/i.test(t)) return 'saved';
  return e.kind === 'success' ? 'done' : 'info';
}
