/**
 * localMoves.ts — moves from the user's own code, mined on device (docs/expression-builder-plan.md:
 * "GLSL you import feeds the move corpus too. It stays on your machine").
 *
 * The docs are the Code explorer's own: the same collectors (userCorpus: saved graphs, the open
 * graph, presets, GLSL page shaders, the Convert page; linkedCorpus: .glsl files in linked folders)
 * and the same incremental sync (`{ prefixes, docs }`: the complete current set of those kinds). Each
 * doc is mined into its own small catalogue, again only when its code or graph changed, and the
 * whole is the prebuilt examples' catalogue merged with them. Nothing leaves the device.
 *
 * Pure (a KV and docs in); liveMoves.ts wires it to the Code explorer's client in the app.
 */
import type { KV } from '../utils/library';
import type { DocInput } from '../codeExplorer/types';
import { docVersion, hashText } from '../codeExplorer/extract';
import { collectUserDocs, OPEN_DOC_ID, type OpenGraph } from '../codeExplorer/userCorpus';
import type { GraphSourceOptions } from '../codeExplorer/corpus';
import type { GraphNode } from '../types/nodeGraph';
import { buildCatalogue, mergeCatalogues, type Catalogue, type MoveDoc } from './moves';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const parse = (raw: string | null): unknown => { if (raw == null) return undefined; try { return JSON.parse(raw); } catch { return undefined; } };

/** The graph behind a user doc (for wiring context), read from the same stored keys the Code explorer reads. */
export function graphForDoc(docId: string, kv: KV, open: OpenGraph | null): readonly GraphNode[] | undefined {
  let nodes: unknown;
  if (docId === OPEN_DOC_ID) nodes = open?.nodes;
  else if (docId.startsWith('saved:')) nodes = obj(parse(kv.get(`shader-studio:${docId.slice('saved:'.length)}`)))?.nodes;
  else if (docId.startsWith('preset:shader-studio:gp:')) nodes = obj(obj(parse(kv.get(docId.slice('preset:'.length))))?.subgraph)?.nodes;
  return Array.isArray(nodes) ? nodes as GraphNode[] : undefined;
}

/** The user's code as move docs: the Code explorer's user docs, each with its graph. */
export function userMoveDocs(kv: KV, open: OpenGraph | null, opts: GraphSourceOptions = {}): MoveDoc[] {
  return collectUserDocs(kv, open, opts).map(doc => {
    const nodes = graphForDoc(doc.docId, kv, open);
    return nodes ? { doc, nodes } : { doc };
  });
}

const versionOf = (d: MoveDoc) => hashText(`${docVersion(d.doc)}:${d.nodes ? hashText(JSON.stringify(d.nodes)) : ''}`);

/**
 * The local catalogue: per-doc catalogues kept current by `sync`, merged with a base (the prebuilt
 * examples) on demand.
 */
export class LocalMoves {
  private docs = new Map<string, { version: string; cat: Catalogue }>();
  private merged: Catalogue | null = null;
  private base: Catalogue | null;
  /** Bumped whenever the merged catalogue would change. */
  revision = 0;

  constructor(base: Catalogue | null = null) { this.base = base; }

  setBase(base: Catalogue | null): void { this.base = base; this.merged = null; this.revision++; }

  /** `docs` is the complete current set of the docs whose ids start with `prefixes`. Returns how many changed. */
  sync(prefixes: readonly string[], docs: readonly (MoveDoc | DocInput)[]): { added: number; updated: number; removed: number; unchanged: number } {
    let added = 0, updated = 0, unchanged = 0;
    const seen = new Set<string>();
    for (const x of docs) {
      const d: MoveDoc = 'doc' in x ? x : { doc: x };
      seen.add(d.doc.docId);
      const v = versionOf(d);
      const have = this.docs.get(d.doc.docId);
      if (have?.version === v) { unchanged++; continue; }
      this.docs.set(d.doc.docId, { version: v, cat: buildCatalogue([d], { generated: false }) });
      if (have) updated++; else added++;
    }
    let removed = 0;
    for (const id of [...this.docs.keys()]) if (prefixes.some(p => id.startsWith(p)) && !seen.has(id)) { this.docs.delete(id); removed++; }
    if (added + updated + removed) { this.merged = null; this.revision++; }
    return { added, updated, removed, unchanged };
  }

  /** Doc ids mined locally. */
  ids(): string[] { return [...this.docs.keys()]; }

  /** The base and every local doc's moves, as one catalogue (with the generated moves). */
  catalogue(): Catalogue {
    if (!this.merged) {
      const parts = [...(this.base ? [this.base] : []), ...[...this.docs.values()].map(x => x.cat)];
      this.merged = mergeCatalogues(...parts);
    }
    return this.merged;
  }
}
