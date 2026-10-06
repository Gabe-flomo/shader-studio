/**
 * host.ts — the indexer's side of the worker protocol (docs/code-explorer-plan.md §4.4).
 *
 * The same object runs inside the Web Worker (indexer.worker.ts) and, where
 * there are no workers (tests), in place. It keeps the index in memory,
 * mirrors it to the store, applies the bundled examples' prebuilt index, and
 * answers queries.
 *
 * Incremental: a synced doc is re-indexed only when its content version
 * changed; docs of the synced kinds that are no longer there are removed.
 */
import { CodeIndex } from './codeIndex';
import { docVersion, extractDoc } from './extract';
import { findIndexedUses, functionReport, searchPatterns, suggestFunctions, summarise, type FunctionReport, type IndexSummary, type Instance, type QueryScope, type SearchHit, type Count } from './queries';
import type { UseQuery } from '../lib/glslPatterns';
import type { IndexStore } from './store';
import { INDEX_SCHEMA, type DocInput, type DocRecord } from './types';

/** The bundled examples' index, built ahead (src/codeExplorer/__tests__/prebuilt.test.ts writes it). */
export interface PrebuiltIndex { schema: number; hash: string; builtAt: number; docs: DocRecord[] }

export type Query =
  | { q: 'function'; fn: string; scope?: QueryScope; withFn?: string }
  | { q: 'search'; text: string; scope?: QueryScope; limit?: number }
  | { q: 'summary'; scope?: QueryScope }
  | { q: 'suggest'; prefix: string }
  | { q: 'uses'; query: UseQuery; scope?: QueryScope; limit?: number };

export type QueryResult<Q extends Query> =
  Q extends { q: 'function' } ? FunctionReport :
  Q extends { q: 'search' } ? SearchHit[] :
  Q extends { q: 'summary' } ? IndexSummary :
  Q extends { q: 'uses' } ? Instance[] :
  Count[];

export interface SyncResult {
  added: number; updated: number; unchanged: number; removed: number;
  /** Time spent indexing (ms). */
  ms: number;
  docs: number; sites: number;
}

export type Request =
  | { t: 'init' }
  /** Docs of the kinds whose ids start with `prefixes`: the complete current set of them. */
  | { t: 'sync'; prefixes: string[]; docs: DocInput[] }
  /** Throw the stored index away and start again from the bundled one. */
  | { t: 'rebuild' }
  | { t: 'query'; query: Query };

export interface InitResult { docs: number; sites: number; ms: number; fromPrebuilt: number; schema: number }

export interface HostDeps {
  store: () => Promise<IndexStore>;
  prebuilt: () => Promise<PrebuiltIndex | null>;
  now?: () => number;
}

export function createHost(deps: HostDeps) {
  const index = new CodeIndex();
  const now = deps.now ?? (() => Date.now());
  let store: IndexStore | null = null;
  let ready: Promise<InitResult> | null = null;
  /** Serialise writes: one sync at a time, in order. */
  let chain: Promise<unknown> = Promise.resolve();

  async function applyPrebuilt(prebuiltHash: string | undefined): Promise<number> {
    const p = await deps.prebuilt().catch(() => null);
    if (!p || p.schema !== INDEX_SCHEMA || p.hash === prebuiltHash) return 0;
    const changed: DocRecord[] = [];
    for (const d of p.docs) {
      const have = index.get(d.docId);
      if (have?.version === d.version) continue;
      index.put(d);
      changed.push(d);
    }
    await store!.put(changed);
    await store!.setMeta({ schema: INDEX_SCHEMA, prebuilt: p.hash, builtAt: p.builtAt });
    return changed.length;
  }

  async function init(): Promise<InitResult> {
    const t0 = performance.now();
    store = await deps.store();
    let { meta, docs } = await store.load().catch(() => ({ meta: null, docs: [] as DocRecord[] }));
    if (meta && meta.schema !== INDEX_SCHEMA) { await store.clear(); meta = null; docs = []; }
    for (const d of docs) index.put(d);
    const fromPrebuilt = await applyPrebuilt(meta?.prebuilt);
    if (!meta && !fromPrebuilt) await store.setMeta({ schema: INDEX_SCHEMA });
    return { docs: index.size, sites: index.siteCount(), ms: performance.now() - t0, fromPrebuilt, schema: INDEX_SCHEMA };
  }

  const ensure = () => (ready ??= init());

  async function sync(prefixes: string[], docs: DocInput[]): Promise<SyncResult> {
    await ensure();
    const t0 = performance.now();
    const at = now();
    const seen = new Set<string>();
    const changed: DocRecord[] = [];
    let added = 0, updated = 0, unchanged = 0;
    for (const d of docs) {
      seen.add(d.docId);
      const have = index.get(d.docId);
      if (have && have.version === docVersion(d)) { unchanged++; continue; }
      const rec = extractDoc(d, at);
      index.put(rec);
      changed.push(rec);
      if (have) updated++; else added++;
    }
    const gone = index.ids().filter(id => prefixes.some(p => id.startsWith(p)) && !seen.has(id));
    for (const id of gone) index.remove(id);
    const ms = performance.now() - t0;
    await store!.put(changed);
    await store!.remove(gone);
    return { added, updated, unchanged, removed: gone.length, ms, docs: index.size, sites: index.siteCount() };
  }

  async function rebuild(): Promise<InitResult> {
    await ensure();
    index.clear();
    await store!.clear();
    ready = null;
    return ensure();
  }

  function query(q: Query): unknown {
    switch (q.q) {
      case 'function': return functionReport(index, q.fn, q.scope, q.withFn);
      case 'search': return searchPatterns(index, q.text, q.scope, q.limit);
      case 'summary': return summarise(index, q.scope);
      case 'suggest': return suggestFunctions(index, q.prefix);
      case 'uses': return findIndexedUses(index, q.query, q.scope, q.limit);
    }
  }

  async function handle(r: Request): Promise<unknown> {
    switch (r.t) {
      case 'init': return ensure();
      case 'sync': { const p = chain.then(() => sync(r.prefixes, r.docs)); chain = p.catch(() => {}); return p; }
      case 'rebuild': { const p = chain.then(rebuild); chain = p.catch(() => {}); return p; }
      case 'query': { await ensure(); await chain; const t0 = performance.now(); const result = query(r.query); return { result, ms: performance.now() - t0 }; }
    }
  }

  return { handle, index };
}

export type Host = ReturnType<typeof createHost>;
