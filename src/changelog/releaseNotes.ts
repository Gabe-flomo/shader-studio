/**
 * What's new: which releases this device hasn't seen, and the one-time "Updated" notice.
 *
 * Per device, in localStorage (both may be missing or blocked; everything still works):
 * - `playfield:whats-new-seen`: the newest release id seen in the What's new view.
 * - `playfield:whats-new-toasted`: the newest release id the "Updated" notice was shown for.
 *
 * A device that has never opened What's new shows the unread dot but gets no "Updated"
 * notice: the notice is for someone who saw an earlier release, then got a newer one.
 */
import { create } from 'zustand';
import { RELEASES, type Release } from './releases';

export const SEEN_KEY = 'playfield:whats-new-seen';
export const TOASTED_KEY = 'playfield:whats-new-toasted';

/** Compare `YEAR.MONTH.N` ids part by part, as numbers. Missing parts count as 0. */
export function compareReleaseIds(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const isReleaseId = (s: unknown): s is string => typeof s === 'string' && /^\d{4}\.(?:[1-9]|1[0-2])\.[1-9]\d*$/.test(s);

/** Newest first, whatever order the list was written in. */
export function sortReleases(list: readonly Release[]): Release[] {
  return [...list].sort((a, b) => compareReleaseIds(b.id, a.id));
}

export const latestRelease = (list: readonly Release[] = RELEASES): Release | undefined => sortReleases(list)[0];

/** Releases newer than `seen` (all of them when nothing was seen yet), newest first. */
export function unreadReleases(seen: string | null, list: readonly Release[] = RELEASES): Release[] {
  const sorted = sortReleases(list);
  return seen ? sorted.filter(r => compareReleaseIds(r.id, seen) > 0) : sorted;
}

/**
 * Show the "Updated · What's new" notice? Only when this device saw an earlier release and
 * hasn't been told about this one yet.
 */
export function shouldAnnounce(seen: string | null, toasted: string | null, list: readonly Release[] = RELEASES): boolean {
  const latest = latestRelease(list);
  if (!latest || !seen) return false;
  if (compareReleaseIds(latest.id, seen) <= 0) return false;
  return !toasted || compareReleaseIds(latest.id, toasted) > 0;
}

function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return isReleaseId(v) ? v : null;
  } catch { return null; }
}
function write(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* blocked: the dot comes back next load, nothing worse */ }
}

interface WhatsNewState {
  seen: string | null;
  /** Mark the newest release as seen (the What's new view is on screen). */
  markSeen: () => void;
}

export const useWhatsNew = create<WhatsNewState>((set, get) => ({
  seen: read(SEEN_KEY),
  markSeen: () => {
    const latest = latestRelease();
    if (!latest || (get().seen && compareReleaseIds(get().seen!, latest.id) >= 0)) return;
    write(SEEN_KEY, latest.id);
    // Seen it, so no "Updated" notice for it either.
    write(TOASTED_KEY, latest.id);
    set({ seen: latest.id });
  },
}));

/** Is there a release this device hasn't seen? (The dot on History.) */
export const useWhatsNewUnread = (): boolean => useWhatsNew(s => unreadReleases(s.seen).length > 0);

/**
 * Once per update: returns the release to announce, and records that it was. Call it once
 * when the app starts.
 */
export function takeUpdateAnnouncement(): Release | null {
  const seen = read(SEEN_KEY), toasted = read(TOASTED_KEY);
  if (!shouldAnnounce(seen, toasted)) return null;
  const latest = latestRelease()!;
  write(TOASTED_KEY, latest.id);
  return latest;
}

/** The event that opens What's new (History panel on desktop, the Browse sheet on a phone). */
export const OPEN_WHATS_NEW = 'open-whats-new';
let pendingOpen = false;
export function openWhatsNew(): void {
  pendingOpen = true;
  window.dispatchEvent(new Event(OPEN_WHATS_NEW));
}
/** A History panel mounting after openWhatsNew() starts on What's new. */
export function takePendingOpen(): boolean {
  const p = pendingOpen;
  pendingOpen = false;
  return p;
}
