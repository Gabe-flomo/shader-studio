/**
 * engine.ts — keeps the local cache (localStorage + the background images in
 * IndexedDB) and the workspace folder the same.
 *
 * The app always reads and writes the cache; this copies changes across.
 * For every file it remembers the content hash (and size and time) both sides
 * had when they last matched: the base. A pass compares the cache (as files,
 * layout.ts) and the folder with it:
 *
 *   changed only here            → written to the folder (a deletion removes the file)
 *   changed only in the folder   → brought into the cache (a deletion removes it here)
 *   changed on both sides        → the same content: nothing; else the newer keeps
 *                                  the name and the other is kept beside it as
 *                                  "Name (conflict, <date>)", listed in Files.
 *                                  List files (images.json, palettes.json) merge;
 *                                  side files (a shader's details) take the newer.
 *   edited on one side, deleted on the other → the edit wins
 *   first time (no base)         → nothing is deleted: both sides' things end up on both
 *
 * Files deleted from the folder are noted in .shader-studio/deleted.json with
 * their hash (a tombstone), so an app that had lost its base doesn't put back
 * something deleted elsewhere. Unreadable files (half-written, hand-edited
 * into bad JSON) are skipped and reported, never taken as deletions.
 *
 * What's waiting to sync is simply what differs from the base, so it
 * survives a restart with the cache. A pass that fails midway (drive pulled
 * out) keeps what it finished; the rest is still different next time.
 */
import type { MutableKV } from '../files/mutate';
import {
  applyMembership, AREAS, classify, decodeAreas, describePath, displayName, encodeTree, equivalent, LIST_DIRS, META_DIR, mergeLists, newMemo, retarget, TOMBSTONES_FILE, validate, WORKSPACE_FILE,
  type Area, type EncodeMemo, type Encoded, type Entry, type ImageStore, type Tree,
} from './layout';
import { hashBytes, hashString } from './hash';
import { WorkspaceFsError, type FileStat, type WsFs } from './fs';
import { conflictPath, foldCase, nameFor, splitPath } from './names';

export interface BaseRec { h: string; s: number; m: number }

export interface ConflictRecord {
  id: string;
  /** Where the version that kept the name is. */
  path: string;
  /** The other version, kept beside it. */
  copyPath: string;
  at: number;
  /** Which side's version kept the name. */
  kept: 'here' | 'folder';
  kindLabel: string;
  /** The name that was kept, and the copy's. */
  label: string;
  copyLabel: string;
}

export interface SyncState {
  workspaceId: string;
  base: Record<string, BaseRec>;
  /** Folder files that can't be used (unreadable, or versions of no graph), by their stat: not read again until they change. */
  ignored: Record<string, BaseRec & { why: string }>;
  /** When this app first saw a local change to a path (for "the newer one wins"). */
  localSeen: Record<string, number>;
  lastSyncAt: number | null;
  conflicts: ConflictRecord[];
}

export const newState = (workspaceId: string): SyncState => ({ workspaceId, base: {}, ignored: {}, localSeen: {}, lastSyncAt: null, conflicts: [] });

export interface PendingChange { path: string; action: 'write' | 'delete'; kindLabel: string; label: string }

export interface SyncResult {
  wrote: number;
  removed: number;
  pulled: number;
  conflicts: ConflictRecord[];
  problems: string[];
  /** Deletions held back: too many at once from the folder (the wrong folder, or emptied?). */
  held: number;
  /** Deletions held back: too many at once from this app's storage (cleared by the browser?). */
  heldHere: number;
  /** Cache keys changed by the pass (to refresh the app). */
  changedKeys: string[];
  imagesChanged: boolean;
}

export interface EngineDeps {
  kv: MutableKV;
  images: ImageStore | null;
  fs: WsFs;
  state: SyncState;
  saveState(s: SyncState): Promise<void>;
  now?(): number;
}

interface Tombstones { kind: 'shader-studio-deleted'; version: 1; deleted: Record<string, { h: string; at: number }> }
const TOMBSTONE_DAYS = 90;
/** Why a readable folder file is skipped: nothing in the app is made from it. */
export const UNUSED = 'not used by anything';
/** Deletions from the folder at once, beyond which a pass stops and asks. */
const MASS_DELETE = { count: 10, share: 0.5 };

export class SyncEngine {
  readonly memo: EncodeMemo = newMemo();
  private readonly d: EngineDeps;
  constructor(deps: EngineDeps) { this.d = deps; }
  get state(): SyncState { return this.d.state; }
  private now(): number { return this.d.now?.() ?? Date.now(); }

  encode(): Promise<Encoded> { return encodeTree(this.d.kv, this.d.images, this.memo); }

  /** Local changes not in the folder yet (also notes when each was first seen). */
  async pending(enc?: Encoded): Promise<PendingChange[]> {
    const e = enc ?? await this.encode();
    const { base, localSeen } = this.d.state;
    const out: PendingChange[] = [];
    const now = this.now();
    for (const [p, entry] of e.tree) {
      if (base[p]?.h === entry.hash) continue;
      localSeen[p] ??= now;
      out.push({ path: p, action: 'write', ...describePath(p) });
    }
    for (const p of Object.keys(base)) {
      if (e.tree.has(p)) continue;
      localSeen[p] ??= now;
      out.push({ path: p, action: 'delete', ...describePath(p) });
    }
    return out.filter(x => !x.path.endsWith('.glsl.json') || !out.some(y => y.path === x.path.slice(0, -5)));
  }

  /** One pass. Throws a WorkspaceFsError when the folder can't be listed or goes away midway (what was done is kept). */
  async sync(opts: { allowMassDelete?: boolean } = {}): Promise<SyncResult> {
    const { fs, state } = this.d;
    const now = this.now();
    const enc = await this.encode();
    const cache = enc.tree;
    await this.pending(enc);
    const listing = await fs.list([...LIST_DIRS, META_DIR], [WORKSPACE_FILE]);
    const first = state.lastSyncAt == null;
    const tomb = await this.readTombstones(listing);
    const res: SyncResult = { wrote: 0, removed: 0, pulled: 0, conflicts: [], problems: [], held: 0, heldHere: 0, changedKeys: [], imagesChanged: false };

    const read = new Map<string, Entry>();
    const readFolder = async (p: string): Promise<Entry> => {
      const had = read.get(p);
      if (had) return had;
      const info = classify(p)!;
      let e: Entry;
      if (info.json || info.kind === 'shader') { const text = await fs.readText(p); e = { text, hash: hashString(text) }; }
      else { const bytes = await fs.readBytes(p); e = { bytes, hash: hashBytes(bytes) }; }
      read.set(p, e);
      return e;
    };

    const merged = new Map<string, Entry | null>();
    const writes = new Map<string, Entry>();
    const removes = new Set<string>();
    const baseAfterPull = new Map<string, BaseRec | null>();
    const baseNow = new Map<string, BaseRec | null>();
    const taken = new Set<string>([...cache.keys(), ...listing.keys()].map(foldCase));
    let folderDeletions = 0;

    const paths = new Set<string>([...cache.keys(), ...Object.keys(state.base)]);
    for (const p of listing.keys()) if (classify(p)) paths.add(p);
    const rec = (h: string, st: FileStat): BaseRec => ({ h, s: st.size, m: st.mtime });

    for (const p of [...paths].sort()) {
      const info = classify(p);
      if (!info) continue;
      const c = cache.get(p);
      const f = listing.get(p);
      const b = state.base[p];
      let fe: Entry | undefined;
      let fHash: string | undefined;
      if (f) {
        if (b && b.s === f.size && b.m === f.mtime) fHash = b.h;
        else {
          // Skipped before and not changed since: an unreadable file is never overwritten (someone may be editing it).
          const ig = state.ignored[p];
          if (ig && ig.s === f.size && ig.m === f.mtime && (ig.why !== UNUSED || (!c && !b))) continue;
          try { fe = await readFolder(p); } catch (e) { if (e instanceof WorkspaceFsError && e.code !== 'io') throw e; res.problems.push(`${p}: couldn’t be read`); continue; }
          fHash = fe.hash;
        }
      }
      const cChanged = c?.hash !== b?.h;
      const fChanged = fHash !== b?.h;
      if (!cChanged && !fChanged) {
        if (b && !c && !f) baseNow.set(p, null);
        else if (b && f && (b.s !== f.size || b.m !== f.mtime)) baseNow.set(p, rec(b.h, f));
        continue;
      }
      // A folder file that has to be used must be readable as what it says it is.
      if (fChanged && f && fe) {
        const bad = validate(p, fe);
        if (bad) {
          res.problems.push(`${p}: ${bad}`);
          state.ignored[p] = { ...rec(fe.hash, f), why: bad };
          continue;
        }
        delete state.ignored[p];
      }
      if (cChanged && !fChanged) {
        // Deleted in another app while identical here, and this app had lost its record of it: follow the deletion.
        if (c && !b && !f && !first && tomb.deleted[p]?.h === c.hash) { merged.set(p, null); continue; }
        if (c) writes.set(p, c);
        else if (f) removes.add(p);
        else baseNow.set(p, null);
        continue;
      }
      if (!cChanged && fChanged) {
        if (f && fe) { merged.set(p, fe); baseAfterPull.set(p, rec(fe.hash, f)); }
        else { merged.set(p, null); baseAfterPull.set(p, null); folderDeletions++; }
        continue;
      }
      // Changed on both sides (or new on one side with no base).
      if (!c && !f) { baseNow.set(p, null); continue; }
      if (!c && f && fe) { merged.set(p, fe); baseAfterPull.set(p, rec(fe.hash, f)); continue; }
      if (c && !f) { writes.set(p, c); continue; }
      if (!c || !f || !fe) continue;
      if (c.hash === fe.hash) { baseNow.set(p, rec(fe.hash, f)); continue; }
      if (equivalent(p, c, fe)) { writes.set(p, c); continue; }
      const localNewer = (state.localSeen[p] ?? 0) >= f.mtime;
      if (info.policy === 'newer') {
        if (localNewer) writes.set(p, c); else { merged.set(p, fe); baseAfterPull.set(p, rec(fe.hash, f)); }
      } else if (info.policy === 'merge') {
        const m = mergeLists(p, c, fe, localNewer);
        merged.set(p, m);
        writes.set(p, m);
      } else {
        const copy = conflictPath(p, now, taken);
        // The copy is written first: if the drive goes midway, both versions still exist somewhere.
        if (localNewer) { merged.set(copy, fe); writes.set(copy, fe); writes.set(p, c); }
        else { merged.set(p, fe); baseAfterPull.set(p, rec(fe.hash, f)); merged.set(copy, c); writes.set(copy, c); }
        const d = describePath(p);
        const label = displayName(p, localNewer ? c : fe);
        const copyLabel = nameFor(displayName(p, localNewer ? fe : c), splitPath(copy).base);
        res.conflicts.push({ id: `${now}-${hashString(p).slice(0, 8)}`, path: p, copyPath: copy, at: now, kept: localNewer ? 'here' : 'folder', kindLabel: d.kindLabel, label, copyLabel });
      }
    }

    // Many things gone from the folder at once looks like the wrong folder, or one being emptied: ask first.
    const tracked = Object.keys(state.base).length;
    if (folderDeletions > MASS_DELETE.count && folderDeletions > tracked * MASS_DELETE.share && !opts.allowMassDelete) {
      res.held = folderDeletions;
      for (const [p, e] of [...merged]) if (e === null) { merged.delete(p); baseAfterPull.delete(p); }
    }
    // And many things gone from this app's storage at once (the browser cleared it?): never empty the folder without a yes.
    if (removes.size > MASS_DELETE.count && removes.size > tracked * MASS_DELETE.share && !opts.allowMassDelete) {
      res.heldHere = removes.size;
      removes.clear();
    }

    // 1. The folder's changes into the cache.
    if (merged.size) {
      const areas = new Set<Area>();
      for (const p of merged.keys()) { const a = classify(p)?.area; if (a) areas.add(a); }
      const tree: Tree = new Map(cache);
      for (const [p, e] of merged) { if (e) tree.set(p, e); else tree.delete(p); }
      try {
        const applied = await this.applyToCache(areas, tree, enc);
        res.changedKeys = applied.keys;
        res.imagesChanged = applied.images;
        res.problems.push(...applied.problems);
        for (const [p, r] of baseAfterPull) {
          if (r && !applied.consumed.has(p)) {
            // Nothing in the app is made from it (an earlier version of no graph…): leave it be.
            state.ignored[p] = { ...r, why: UNUSED };
            continue;
          }
          baseNow.set(p, r);
          if (r) res.pulled++;
        }
      } catch (e) {
        res.problems.push(`Couldn’t bring the folder’s changes in: ${e instanceof Error ? e.message : String(e)}`);
        for (const p of merged.keys()) writes.delete(p);
      }
    }
    this.commitBase(baseNow);
    await this.d.saveState(state);

    // 2. This app's changes into the folder: writes first, then removals (a move never loses the file).
    const deleted: Record<string, { h: string; at: number }> = {};
    try {
      for (const [p, e] of writes) {
        let data: string | Uint8Array;
        try { data = e.text ?? e.bytes ?? await e.load!(); } catch (err) { res.problems.push(`${p}: ${err instanceof Error ? err.message : String(err)}`); continue; }
        try {
          const st = await fs.write(p, data);
          state.base[p] = { h: e.hash, s: st.size, m: st.mtime };
          delete state.localSeen[p];
          res.wrote++;
        } catch (err) {
          const fe = err instanceof WorkspaceFsError ? err : null;
          if (fe && fe.code !== 'io') throw fe;
          res.problems.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      for (const p of removes) {
        await fs.remove(p);
        const b = state.base[p];
        if (b) deleted[p] = { h: b.h, at: now };
        delete state.base[p];
        delete state.localSeen[p];
        res.removed++;
      }
    } finally {
      await this.d.saveState(state);
    }
    await this.writeTombstones(tomb, deleted, writes, now);
    for (const p of Object.keys(state.localSeen)) if (state.base[p]?.h === cache.get(p)?.hash) delete state.localSeen[p];
    state.lastSyncAt = now;
    state.conflicts = [...state.conflicts, ...res.conflicts];
    await this.d.saveState(state);
    return res;
  }

  private commitBase(m: Map<string, BaseRec | null>): void {
    for (const [p, r] of m) {
      if (r) this.d.state.base[p] = r; else delete this.d.state.base[p];
      if (r) delete this.d.state.localSeen[p];
    }
  }

  /** Decode these areas of a tree into the cache: changed keys written, gone ones removed, images and folders updated. */
  async applyToCache(areas: Set<Area>, tree: Tree, enc: Encoded): Promise<{ keys: string[]; images: boolean; problems: string[]; consumed: Set<string> }> {
    const { kv, images } = this.d;
    const ch = decodeAreas(areas, tree, kv, enc);
    const keys: string[] = [];
    const problems: string[] = [];
    for (const [k, v] of ch.set) {
      if (kv.get(k) === v) continue;
      try { kv.set(k, v); keys.push(k); } catch (e) { problems.push(`Couldn’t store “${k}” here (storage full?): ${e instanceof Error ? e.message : String(e)}`); for (const p of tree.keys()) ch.consumed.delete(p); }
    }
    for (const k of ch.remove) { if (kv.get(k) != null) { kv.remove(k); keys.push(k); } }
    let imagesChanged = false;
    if (images) {
      for (const { meta, entry } of ch.images.put) {
        try {
          const data = entry.bytes ?? (entry.load ? await entry.load() : null);
          if (!data) continue;
          await images.put({ ...meta, bytes: data.length }, data);
          imagesChanged = true;
        } catch (e) { problems.push(`Background image “${meta.name}”: ${e instanceof Error ? e.message : String(e)}`); }
      }
      for (const { id, name } of ch.images.rename) { try { await images.rename(id, name); imagesChanged = true; } catch { /* next pass */ } }
      for (const id of ch.images.remove) { try { await images.remove(id); imagesChanged = true; } catch { /* next pass */ } }
    }
    const folders = applyMembership(kv, ch.membership, this.now());
    if (folders != null) { try { kv.set('assetbrowser_folders', folders); keys.push('assetbrowser_folders'); } catch { /* folders only */ } }
    return { keys, images: imagesChanged, problems, consumed: ch.consumed };
  }

  /** Things gone from this app's storage come back from the folder (instead of being removed there). */
  async restoreFromFolder(): Promise<void> {
    const enc = await this.encode();
    for (const p of Object.keys(this.d.state.base)) if (!enc.tree.has(p)) { delete this.d.state.base[p]; delete this.d.state.localSeen[p]; }
    await this.d.saveState(this.d.state);
  }

  // ── Conflicts ──

  /** Keep this (the version with the name), the other (the copy, under the name) or both. */
  async resolve(id: string, choice: 'this' | 'other' | 'both'): Promise<{ keys: string[]; images: boolean }> {
    const state = this.d.state;
    const c = state.conflicts.find(x => x.id === id);
    state.conflicts = state.conflicts.filter(x => x.id !== id);
    let out = { keys: [] as string[], images: false };
    if (c && choice !== 'both') {
      const enc = await this.encode();
      const tree: Tree = new Map(enc.tree);
      const copy = tree.get(c.copyPath);
      if (copy) {
        if (choice === 'other') tree.set(c.path, retarget(c.path, copy, tree.get(c.path)));
        tree.delete(c.copyPath);
        tree.delete(`${c.copyPath}.json`);
        const area = classify(c.path)?.area;
        if (area) { const r = await this.applyToCache(new Set([area]), tree, enc); out = { keys: r.keys, images: r.images }; }
      }
    }
    await this.d.saveState(state);
    return out;
  }

  // ── Tombstones ──

  private async readTombstones(listing: Map<string, FileStat>): Promise<Tombstones> {
    const empty: Tombstones = { kind: 'shader-studio-deleted', version: 1, deleted: {} };
    if (!listing.has(TOMBSTONES_FILE)) return empty;
    try {
      const v = JSON.parse(await this.d.fs.readText(TOMBSTONES_FILE)) as Tombstones;
      return v && typeof v.deleted === 'object' && v.deleted ? v : empty;
    } catch { return empty; }
  }

  private async writeTombstones(t: Tombstones, added: Record<string, { h: string; at: number }>, written: Map<string, Entry>, now: number): Promise<void> {
    const before = JSON.stringify(t.deleted);
    const cutoff = now - TOMBSTONE_DAYS * 86400_000;
    const next: Tombstones['deleted'] = {};
    for (const [p, v] of Object.entries(t.deleted)) if (v && v.at >= cutoff && !written.has(p)) next[p] = v;
    Object.assign(next, added);
    if (JSON.stringify(next) === before) return;
    try { await this.d.fs.write(TOMBSTONES_FILE, JSON.stringify({ ...t, deleted: next }, null, 1)); } catch { /* bookkeeping only */ }
  }
}

export { AREAS };
