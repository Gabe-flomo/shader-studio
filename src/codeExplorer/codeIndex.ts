/**
 * codeIndex.ts — the in-memory index the queries read (docs/code-explorer-plan.md §4.4).
 *
 * Docs are stored whole (one record per doc, with its sites); the postings
 * (callee → sites) and shape counts are kept up to date as docs come and
 * go, so an edit to one graph changes the counts by exactly its own sites.
 */
import type { DocRecord, Site } from './types';

export interface SiteRef { doc: DocRecord; site: Site }

export class CodeIndex {
  private docs = new Map<string, DocRecord>();
  private postings = new Map<string, SiteRef[]>();
  /** Sites per L1 / L2 shape, across the whole index. */
  readonly l1Counts = new Map<string, number>();
  readonly l2Counts = new Map<string, number>();
  /** Bumped on every change (query caches key on it). */
  revision = 0;

  get size(): number { return this.docs.size; }
  get(docId: string): DocRecord | undefined { return this.docs.get(docId); }
  all(): IterableIterator<DocRecord> { return this.docs.values(); }
  ids(): string[] { return [...this.docs.keys()]; }

  siteCount(): number { let n = 0; for (const d of this.docs.values()) n += d.sites.length; return n; }

  put(doc: DocRecord): void {
    if (this.docs.has(doc.docId)) this.remove(doc.docId);
    this.docs.set(doc.docId, doc);
    for (const site of doc.sites) {
      let list = this.postings.get(site.callee);
      if (!list) this.postings.set(site.callee, list = []);
      list.push({ doc, site });
      bump(this.l1Counts, site.l1, 1);
      bump(this.l2Counts, site.l2, 1);
    }
    this.revision++;
  }

  remove(docId: string): boolean {
    const doc = this.docs.get(docId);
    if (!doc) return false;
    this.docs.delete(docId);
    const callees = new Set<string>();
    for (const site of doc.sites) {
      callees.add(site.callee);
      bump(this.l1Counts, site.l1, -1);
      bump(this.l2Counts, site.l2, -1);
    }
    for (const c of callees) {
      const left = (this.postings.get(c) ?? []).filter(r => r.doc !== doc);
      if (left.length) this.postings.set(c, left); else this.postings.delete(c);
    }
    this.revision++;
    return true;
  }

  clear(): void {
    this.docs.clear(); this.postings.clear(); this.l1Counts.clear(); this.l2Counts.clear();
    this.revision++;
  }

  /** Every site calling `callee`. */
  sitesOf(callee: string): readonly SiteRef[] { return this.postings.get(callee) ?? []; }

  /** Callees and how many sites each has. */
  callees(): Array<[string, readonly SiteRef[]]> { return [...this.postings.entries()]; }
}

function bump(m: Map<string, number>, k: string, d: number) {
  const v = (m.get(k) ?? 0) + d;
  if (v > 0) m.set(k, v); else m.delete(k);
}
