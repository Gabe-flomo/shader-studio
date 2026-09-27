/**
 * Release notes: the list itself (order, ids, links that go somewhere), which releases count
 * as unread, the one-time "Updated" notice, and the version files agreeing with the newest
 * release (so an update can't ship without its notes, or notes without the version).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASES, type Release } from '../releases';
import { compareReleaseIds, isReleaseId, latestRelease, shouldAnnounce, sortReleases, unreadReleases, SEEN_KEY, TOASTED_KEY } from '../releaseNotes';
import { EXAMPLE_INDEX } from '../../store/exampleIndex';

// Paths from the repo root: the docs that exist, and the version files' text.
const DOCS = new Set(Object.keys(import.meta.glob('../../../docs/**/*.md')).map(k => k.replace('../../../', '')));
const VERSION_FILES = import.meta.glob(['../../../package.json', '../../../package-lock.json', '../../../src-tauri/tauri.conf.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const rel = (id: string): Release => ({ id, date: '2026-09-01', title: id, highlights: [{ area: 'Studio', text: 'x' }] });

describe('release ids', () => {
  it('compare part by part, as numbers', () => {
    expect(compareReleaseIds('2026.9.10', '2026.9.9')).toBeGreaterThan(0);
    expect(compareReleaseIds('2026.10.1', '2026.9.12')).toBeGreaterThan(0);
    expect(compareReleaseIds('2027.1.1', '2026.12.9')).toBeGreaterThan(0);
    expect(compareReleaseIds('2026.9.7', '2026.9.7')).toBe(0);
    expect(compareReleaseIds('2026.9.1', '2026.9.2')).toBeLessThan(0);
  });
  it('are YEAR.MONTH.N with no leading zeros (valid semver for the desktop build)', () => {
    expect(isReleaseId('2026.9.7')).toBe(true);
    expect(isReleaseId('2026.09.7')).toBe(false);
    expect(isReleaseId('2026.13.1')).toBe(false);
    expect(isReleaseId('2026.9.0')).toBe(false);
    expect(isReleaseId(null)).toBe(false);
  });
  it('sort newest first, whatever order they were written in', () => {
    expect(sortReleases([rel('2026.9.2'), rel('2026.10.1'), rel('2026.9.10')]).map(r => r.id)).toEqual(['2026.10.1', '2026.9.10', '2026.9.2']);
  });
});

describe('the release list', () => {
  it('is written newest first, with unique valid ids and dates that never go forward', () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    expect(RELEASES.map(r => r.id)).toEqual(sortReleases(RELEASES).map(r => r.id));
    expect(new Set(RELEASES.map(r => r.id)).size).toBe(RELEASES.length);
    for (const r of RELEASES) expect(isReleaseId(r.id), r.id).toBe(true);
    for (let i = 1; i < RELEASES.length; i++) expect(RELEASES[i].date <= RELEASES[i - 1].date, RELEASES[i].id).toBe(true);
  });
  it('keeps each release short: a title, 1–8 one-line highlights', () => {
    for (const r of RELEASES) {
      expect(r.date, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.trim().length, r.id).toBeGreaterThan(0);
      expect(r.highlights.length, r.id).toBeGreaterThanOrEqual(1);
      expect(r.highlights.length, r.id).toBeLessThanOrEqual(8);
      for (const h of r.highlights) {
        expect(h.text, r.id).not.toMatch(/\n/);
        expect(h.text.length, h.text).toBeLessThanOrEqual(160);
        expect(h.text, h.text).not.toMatch(/#\d+/); // user-facing, not PR numbers
      }
    }
  });
  it('links only to examples that exist and docs that are in the repo', () => {
    for (const r of RELEASES) for (const h of r.highlights) {
      const l = h.link;
      if (!l) continue;
      if (l.kind === 'example') expect(EXAMPLE_INDEX[l.key], `${r.id}: example ${l.key}`).toBeDefined();
      if (l.kind === 'doc') expect(DOCS.has(l.path), `${r.id}: ${l.path}`).toBe(true);
    }
  });
});

describe('unread releases', () => {
  const list = [rel('2026.9.1'), rel('2026.9.3'), rel('2026.9.2')];
  it('are all of them on a device that never opened What’s new', () => {
    expect(unreadReleases(null, list).map(r => r.id)).toEqual(['2026.9.3', '2026.9.2', '2026.9.1']);
  });
  it('are the ones newer than the last seen, newest first', () => {
    expect(unreadReleases('2026.9.1', list).map(r => r.id)).toEqual(['2026.9.3', '2026.9.2']);
    expect(unreadReleases('2026.9.3', list)).toEqual([]);
    // Seen a release newer than this build knows (a newer tab, then an older cached one): nothing unread
    expect(unreadReleases('2026.10.1', list)).toEqual([]);
  });
});

describe('the Updated notice', () => {
  const list = [rel('2026.9.2'), rel('2026.9.1')];
  it('is for someone who saw an earlier release, once per release', () => {
    expect(shouldAnnounce(null, null, list)).toBe(false); // first run: a dot, no notice
    expect(shouldAnnounce('2026.9.1', null, list)).toBe(true);
    expect(shouldAnnounce('2026.9.1', '2026.9.1', list)).toBe(true);
    expect(shouldAnnounce('2026.9.1', '2026.9.2', list)).toBe(false); // already shown
    expect(shouldAnnounce('2026.9.2', null, list)).toBe(false); // already seen
  });
});

describe('the What’s new store', () => {
  let data: Map<string, string>;
  let blocked = false;
  beforeEach(() => {
    data = new Map();
    blocked = false;
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => { if (blocked) throw new Error('blocked'); return data.get(k) ?? null; },
      setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); data.set(k, v); },
      removeItem: (k: string) => data.delete(k),
    });
  });
  const load = () => import('../releaseNotes');
  const latest = latestRelease()!.id;
  const older = sortReleases(RELEASES)[1]?.id ?? '2000.1.1';

  it('starts unread on a new device, and opening What’s new clears it for good', async () => {
    const m = await load();
    expect(unreadReleases(m.useWhatsNew.getState().seen).length).toBe(RELEASES.length);
    m.useWhatsNew.getState().markSeen();
    expect(data.get(SEEN_KEY)).toBe(latest);
    expect(unreadReleases(m.useWhatsNew.getState().seen)).toEqual([]);
    vi.resetModules();
    const again = await load();
    expect(again.useWhatsNew.getState().seen).toBe(latest);
    expect(again.takeUpdateAnnouncement()).toBeNull();
  });

  it('announces an update once, and not on a first run', async () => {
    let m = await load();
    expect(m.takeUpdateAnnouncement()).toBeNull();
    data.set(SEEN_KEY, older);
    vi.resetModules();
    m = await load();
    expect(m.takeUpdateAnnouncement()?.id).toBe(latest);
    expect(data.get(TOASTED_KEY)).toBe(latest);
    expect(m.takeUpdateAnnouncement()).toBeNull();
    // Still unread until What's new is opened
    expect(unreadReleases(m.useWhatsNew.getState().seen).length).toBeGreaterThan(0);
  });

  it('ignores junk in storage and survives storage that throws', async () => {
    data.set(SEEN_KEY, 'not a version');
    let m = await load();
    expect(m.useWhatsNew.getState().seen).toBeNull();
    blocked = true;
    vi.resetModules();
    m = await load();
    expect(m.useWhatsNew.getState().seen).toBeNull();
    expect(() => m.useWhatsNew.getState().markSeen()).not.toThrow();
    expect(m.useWhatsNew.getState().seen).toBe(latest);
    expect(m.takeUpdateAnnouncement()).toBeNull();
  });
});

describe('the app version', () => {
  const json = (p: string) => JSON.parse(VERSION_FILES['../../../' + p]) as { version: string; packages?: Record<string, { version?: string }> };
  const latest = latestRelease()!.id;
  const hint = `The newest release note is ${latest}. Add a release to src/changelog/releases.ts or run \`npm run release:sync\` (docs/release-notes.md).`;
  it('is the newest release id in package.json, package-lock.json and tauri.conf.json', () => {
    expect(json('package.json').version, hint).toBe(latest);
    expect(json('package-lock.json').packages?.['']?.version, hint).toBe(latest);
    expect(json('src-tauri/tauri.conf.json').version, hint).toBe(latest);
  });
});
