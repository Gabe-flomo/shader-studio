/**
 * client.ts — the main thread's side of the Code Explorer (docs/code-explorer-plan.md §4.4).
 *
 * Starts the indexer worker on first use (in place where there are no
 * workers), feeds it the corpus and keeps it current: the user's code on
 * start and whenever something is saved, imported or edited (debounced), the
 * bundled examples once per session (only examples changed since the
 * prebuilt index was made are re-indexed), linked folders' .glsl files on
 * start and on request. Queries run in the worker too.
 */
import { create } from 'zustand';
import type { Host, InitResult, Query, QueryResult, Request, SyncResult, PrebuiltIndex } from './host';
import { collectUserDocs, OPEN_DOC_ID, USER_PREFIXES } from './userCorpus';
import { EXAMPLE_PREFIXES, bundledExampleDocs } from './exampleCorpus';
import { collectLinkedDocs, LINKED_PREFIXES } from './linkedCorpus';
import { hashText } from './extract';
import type { DocInput } from './types';
import { localKV } from '../utils/library';
import { useNodeGraphStore, SAVED_GRAPHS_CHANGED, GRAPH_OPENED, type GraphOpened } from '../store/useNodeGraphStore';
import { getNodeDefinition } from '../nodes/definitions';
import { loadExampleGraphs } from '../store/exampleIndex';
import { ACTIVITY_CHANGED } from '../files/activity';

export interface ExplorerStatus {
  phase: 'idle' | 'starting' | 'ready' | 'error';
  init?: InitResult;
  /** The last sync of each kind: what changed and how long it took. */
  syncs: Partial<Record<'user' | 'examples' | 'linked', SyncResult & { at: number; collectMs: number }>>;
  busy: number;
  /** Bumped after every sync that changed something: panels re-query. */
  revision: number;
  error?: string;
}

export const useExplorerStatus = create<ExplorerStatus>(() => ({ phase: 'idle', syncs: {}, busy: 0, revision: 0 }));

// ── Transport ──────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let local: Promise<Host> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./indexer.worker.ts', import.meta.url), { type: 'module', name: 'code-explorer' });
    } catch { return null; }
    worker.onmessage = (e: MessageEvent<{ id: number; res?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error !== undefined) p.reject(new Error(e.data.error)); else p.resolve(e.data.res);
    };
    worker.onerror = (e) => {
      for (const [id, p] of pending) { p.reject(new Error(`The Code Explorer’s indexer stopped: ${e.message || 'unknown error'}`)); pending.delete(id); }
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** In place, for tests and browsers without module workers: a memory store and the prebuilt index from the bundle. */
async function localHost(): Promise<Host> {
  const { createHost } = await import('./host');
  const { memoryStore } = await import('./store');
  return createHost({
    store: async () => memoryStore(),
    prebuilt: async () => {
      try {
        const { default: url } = await import('./prebuilt/examples.json?url');
        const r = await fetch(url);
        return r.ok ? (await r.json()) as PrebuiltIndex : null;
      } catch { return null; }
    },
  });
}

function call<T>(req: Request): Promise<T> {
  const w = getWorker();
  if (!w) return (local ??= localHost()).then(h => h.handle(req) as Promise<T>);
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, req });
  });
}

// ── Syncing ────────────────────────────────────────────────────────────────

const nodeLabel = (t: string) => getNodeDefinition(t)?.label;
/** Fingerprints of the examples' code, so an example opened unchanged isn't counted twice. */
let exampleFingerprints = new Set<string>();
const fingerprint = (d: DocInput) => hashText(JSON.stringify(d.sources.map(s => [s.nodeId, s.field, s.text])));
let lastOpened: GraphOpened | null = null;

function openGraphInput(): { nodes: unknown; label: string } | null {
  const s = useNodeGraphStore.getState();
  // A saved graph open with nothing changed is already indexed as itself.
  if (s.currentGraph && !s.graphDirty) return null;
  return { nodes: s.nodes, label: s.currentGraph ? `${s.currentGraph.name} (open, edited)` : 'Open graph' };
}

export type CorpusKind = 'user' | 'examples' | 'linked';
type CorpusListener = (kind: CorpusKind, prefixes: readonly string[], docs: readonly DocInput[]) => void;
const corpusListeners = new Set<CorpusListener>();

/**
 * Hear every doc set the index syncs (the complete current set of `prefixes`' docs), as collected.
 * The Expression Builder's move catalogue reads the user's code this way (exprBuilder/liveMoves.ts).
 */
export function onCorpusCollected(fn: CorpusListener): () => void {
  corpusListeners.add(fn);
  return () => { corpusListeners.delete(fn); };
}

async function sync(kind: CorpusKind, prefixes: string[], collect: () => Promise<DocInput[]> | DocInput[]): Promise<SyncResult | null> {
  useExplorerStatus.setState(s => ({ busy: s.busy + 1 }));
  try {
    const t0 = performance.now();
    const docs = await collect();
    const collectMs = performance.now() - t0;
    for (const fn of corpusListeners) { try { fn(kind, prefixes, docs); } catch (e) { console.warn('[code explorer] corpus listener failed', e); } }
    const r = await call<SyncResult>({ t: 'sync', prefixes, docs });
    useExplorerStatus.setState(s => ({
      syncs: { ...s.syncs, [kind]: { ...r, at: Date.now(), collectMs } },
      revision: r.added + r.updated + r.removed ? s.revision + 1 : s.revision,
    }));
    return r;
  } catch (e) {
    console.warn('[code explorer] sync failed', kind, e);
    return null;
  } finally {
    useExplorerStatus.setState(s => ({ busy: s.busy - 1 }));
  }
}

export function syncUser(): Promise<SyncResult | null> {
  return sync('user', USER_PREFIXES, () => {
    const docs = collectUserDocs(localKV, openGraphInput(), { nodeLabel });
    // The open graph unchanged from an example: the example already counts it.
    return docs.filter(d => d.docId !== OPEN_DOC_ID || !exampleFingerprints.has(fingerprint(d)));
  });
}

export function syncExamples(): Promise<SyncResult | null> {
  return sync('examples', EXAMPLE_PREFIXES, async () => {
    const docs = bundledExampleDocs(await loadExampleGraphs(), nodeLabel);
    exampleFingerprints = new Set(docs.map(fingerprint));
    return docs;
  });
}

export function syncLinked(): Promise<SyncResult | null> {
  return sync('linked', LINKED_PREFIXES, collectLinkedDocs);
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let started: Promise<void> | null = null;
let userTimer: ReturnType<typeof setTimeout> | null = null;

/** Re-read the user's code soon (many changes in a row make one sync). */
export function scheduleUserSync(delay = 1200): void {
  if (!started) return;
  if (userTimer) clearTimeout(userTimer);
  userTimer = setTimeout(() => { userTimer = null; void syncUser(); }, delay);
}

function listen(): void {
  if (typeof window === 'undefined') return;
  const soon = () => scheduleUserSync();
  for (const ev of [SAVED_GRAPHS_CHANGED, ACTIVITY_CHANGED, 'customfn-changed', 'presentations-changed', 'storage']) window.addEventListener(ev, soon);
  window.addEventListener(GRAPH_OPENED, e => { lastOpened = (e as CustomEvent<GraphOpened>).detail; soon(); });
  // Edits to the open graph: its nodes change.
  let nodes = useNodeGraphStore.getState().nodes;
  useNodeGraphStore.subscribe(s => { if (s.nodes !== nodes) { nodes = s.nodes; scheduleUserSync(2000); } });
}

/** Start the index (once): load it, then bring the user's code, the examples and linked folders up to date. */
export function startExplorer(): Promise<void> {
  if (started) return started;
  useExplorerStatus.setState({ phase: 'starting' });
  started = (async () => {
    try {
      const init = await call<InitResult>({ t: 'init' });
      useExplorerStatus.setState(s => ({ phase: 'ready', init, revision: s.revision + 1 }));
      listen();
      await syncExamples();
      await syncUser();
      void syncLinked();
    } catch (e) {
      useExplorerStatus.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return started;
}

/** Ask the index something (starting it if needed). */
export async function queryIndex<Q extends Query>(query: Q): Promise<{ result: QueryResult<Q>; ms: number }> {
  if (!started) void startExplorer();
  return call<{ result: QueryResult<Q>; ms: number }>({ t: 'query', query });
}

/** Throw the stored index away and build it again. */
export async function rebuildIndex(): Promise<void> {
  useExplorerStatus.setState(s => ({ busy: s.busy + 1 }));
  try {
    const init = await call<InitResult>({ t: 'rebuild' });
    useExplorerStatus.setState({ init });
    await syncExamples();
    await syncUser();
    await syncLinked();
  } finally {
    useExplorerStatus.setState(s => ({ busy: s.busy - 1, revision: s.revision + 1 }));
  }
}

/** The example open in the Studio, as last announced (for jump to source). */
export const lastOpenedGraph = (): GraphOpened | null => lastOpened;
