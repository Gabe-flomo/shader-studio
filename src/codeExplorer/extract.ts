/**
 * extract.ts — from a doc's written code to its index record (docs/code-explorer-plan.md §4.2).
 *
 * For every call: its shapes (L1, L2), where it is (field, line, column), the
 * statement it sits in and that statement's kind, its enclosing call chain,
 * the producer → call → consumer flow, the other functions on the same
 * statement, the literal arguments, and the words around it.
 *
 * Function definitions come from discover.ts (`discoverInSource`), the same
 * layer the GLSL page's Discover functions uses; the statement parser gives
 * the rest.
 */
import { discoverInSource } from '../glsl/discover';
import { parseSource, TYPE_NAMES, type Expr, type Stmt } from './parser';
import { shapes, fold } from './shape';
import { lineStarts, lineIndexAt } from './tokenizer';
import { codeWords, commentText, proseWords } from './words';
import type { DocInput, DocRecord, DocSource, Site, SourceInput } from './types';

/** FNV-1a, 32-bit, hex. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A doc's content version: changes when any of its code, labels or places change. */
export function docVersion(d: DocInput): string {
  return hashText(JSON.stringify([d.label, d.group, d.sources.map(s => [s.sourceKind, s.mode, s.field, s.nodeId, s.nodePath, s.nodeLabel, s.nodeType, s.words, s.text, s.lineFields])]));
}

const isCtor = (name: string) => TYPE_NAMES.test(name.replace(/\[\]$/, ''));

interface CallVisit { call: Extract<Expr, { k: 'call' }>; chain: string[]; parentCall?: string; flip: boolean }

/** Every call in an expression, with its enclosing (non-constructor) calls. */
function visitCalls(e: Expr, out: CallVisit[], chain: string[] = [], parent?: Expr): void {
  switch (e.k) {
    case 'call': {
      const ctor = isCtor(e.name);
      const flip = parent?.k === 'bin' && parent.op === '-' && parent.r === e && fold(parent.l).k === 'num' && Math.abs((fold(parent.l) as { v: number }).v - 1) < 1e-9;
      const myChain = ctor ? chain : [...chain, e.name];
      out.push({ call: e, chain: ctor ? [...chain, e.name] : myChain, parentCall: chain[chain.length - 1], flip });
      for (const a of e.args) visitCalls(a, out, myChain, e);
      return;
    }
    case 'bin': visitCalls(e.l, out, chain, e); visitCalls(e.r, out, chain, e); return;
    case 'un': case 'post': visitCalls(e.a, out, chain, e); return;
    case 'mem': visitCalls(e.o, out, chain, e); return;
    case 'idx': visitCalls(e.o, out, chain, e); visitCalls(e.i, out, chain, e); return;
    case 'tern': visitCalls(e.c, out, chain, e); visitCalls(e.a, out, chain, e); visitCalls(e.b, out, chain, e); return;
    case 'assign': visitCalls(e.l, out, chain, e); visitCalls(e.r, out, chain, e); return;
    default: return;
  }
}

/** The first non-constructor call in an expression, breadth first. */
function headCall(e: Expr): string | undefined {
  const queue: Expr[] = [e];
  while (queue.length) {
    const x = queue.shift()!;
    if (x.k === 'call' && !isCtor(x.name)) return x.name;
    switch (x.k) {
      case 'call': queue.push(...x.args); break;
      case 'bin': queue.push(x.l, x.r); break;
      case 'un': case 'post': queue.push(x.a); break;
      case 'mem': queue.push(x.o); break;
      case 'idx': queue.push(x.o, x.i); break;
      case 'tern': queue.push(x.c, x.a, x.b); break;
      case 'assign': queue.push(x.r); break;
    }
  }
  return undefined;
}

/** Identifiers read in an expression, in order. */
function reads(e: Expr, out: string[] = []): string[] {
  switch (e.k) {
    case 'id': out.push(e.name); break;
    case 'call': e.args.forEach(a => reads(a, out)); break;
    case 'bin': reads(e.l, out); reads(e.r, out); break;
    case 'un': case 'post': reads(e.a, out); break;
    case 'mem': reads(e.o, out); break;
    case 'idx': reads(e.o, out); reads(e.i, out); break;
    case 'tern': reads(e.c, out); reads(e.a, out); reads(e.b, out); break;
    case 'assign': reads(e.r, out); break;
  }
  return out;
}

/** The innermost non-constructor call around the first read of one of `names`, or null when the read isn't inside a call; undefined when none is read. */
function readContext(e: Expr, names: ReadonlySet<string>, chain: string[] = []): string | null | undefined {
  switch (e.k) {
    case 'id': return names.has(e.name) ? (chain[chain.length - 1] ?? null) : undefined;
    case 'call': {
      const c = isCtor(e.name) ? chain : [...chain, e.name];
      for (const a of e.args) { const r = readContext(a, names, c); if (r !== undefined) return r; }
      return undefined;
    }
    case 'bin': { const r = readContext(e.l, names, chain); return r !== undefined ? r : readContext(e.r, names, chain); }
    case 'un': case 'post': return readContext(e.a, names, chain);
    case 'mem': return readContext(e.o, names, chain);
    case 'idx': { const r = readContext(e.o, names, chain); return r !== undefined ? r : readContext(e.i, names, chain); }
    case 'tern': { for (const x of [e.c, e.a, e.b]) { const r = readContext(x, names, chain); if (r !== undefined) return r; } return undefined; }
    case 'assign': return readContext(e.r, names, chain);
    default: return undefined;
  }
}

function stmtKindLabel(st: Stmt): string {
  switch (st.kind) {
    case 'decl': return `${st.declType} x =`;
    case 'assign': return st.targets[0] === 'gl_FragColor' || st.targets[0] === 'fragColor' ? `gl_FragColor ${st.op}` : `x ${st.op}`;
    case 'return': return 'return';
    case 'if': case 'while': case 'switch': return st.kind;
    case 'for': return 'for';
    default: return 'expr';
  }
}

/** What a statement's value flows into: the next statement reading what it writes. */
function consumerOf(stmts: Stmt[], k: number): string {
  const st = stmts[k];
  if (st.kind === 'return') return 'return';
  if (st.kind === 'if' || st.kind === 'while' || st.kind === 'for' || st.kind === 'switch') return 'if';
  if (st.targets[0] === 'gl_FragColor' || st.targets[0] === 'fragColor') return 'gl_FragColor';
  const names = new Set(st.targets);
  if (!names.size) return '·';
  for (let m = k + 1; m < stmts.length; m++) {
    const next = stmts[m];
    if (next.fn !== st.fn) break;
    for (const e of next.exprs) {
      const r = readContext(e, names);
      if (r === undefined) continue;
      if (r) return r;
      if (next.kind === 'return') return 'return';
      if (next.kind === 'if' || next.kind === 'while' || next.kind === 'for') return 'if';
      if (next.targets[0] === 'gl_FragColor' || next.targets[0] === 'fragColor') return 'gl_FragColor';
      return '(arith)';
    }
  }
  return '·';
}

/** Index one source's code into sites. */
export function extractSource(src: SourceInput, srcIndex: number): { sites: Site[]; source: DocSource } {
  const parsed = parseSource(src.text, src.mode);
  const starts = lineStarts(src.text);
  // Function definitions from discover.ts: which function a statement sits in.
  const defs = src.mode === 'file' ? discoverInSource({ id: 'x', name: 'x', code: src.text }) : [];
  const fnAt = (off: number): string | undefined => defs.find(f => off >= f.start && off < f.end)?.name;
  const sites: Site[] = [];
  const stmts = parsed.stmts;
  /** Per function: the statement that last wrote a name. */
  const lastDef = new Map<string, Stmt>();
  let curFn: string | null = null;
  const lineText = (li: number) => src.text.slice(starts[li], (starts[li + 1] ?? src.text.length + 1) - 1);

  stmts.forEach((st, k) => {
    if (st.fn !== curFn) { lastDef.clear(); curFn = st.fn; }
    const visits: CallVisit[] = [];
    for (const e of st.exprs) visitCalls(e, visits);
    if (st.lhs) visitCalls(st.lhs, visits);
    const stmtText = src.text.slice(st.s, st.e);
    const ids = codeWords(stmtText);
    const callees = [...new Set(visits.filter(v => !isCtor(v.call.name)).map(v => v.call.name))];
    const cons = visits.length ? consumerOf(stmts, k) : '·';
    const sk = stmtKindLabel(st);
    for (const v of visits) {
      const c = v.call;
      const { l1, l2 } = shapes(c);
      const li = lineIndexAt(starts, c.s);
      const lf = src.lineFields?.[li];
      const raw = lineText(li);
      const lead = raw.length - raw.trimStart().length;
      const text = raw.trim();
      const hs = Math.max(0, c.s - starts[li] - lead);
      const he = Math.min(text.length, c.e - starts[li] - lead);
      // Producer: a call in the arguments, else the statement that wrote the first name read.
      let prod: string | undefined;
      for (const a of c.args) { prod = headCall(a); if (prod) break; }
      if (!prod) {
        for (const name of reads({ ...c, k: 'call' })) {
          const def = lastDef.get(name);
          if (!def) continue;
          prod = def.exprs.map(headCall).find(Boolean) ?? (def.exprs.some(x => x.k === 'bin' || x.k === 'un' || x.k === 'tern') ? '(arith)' : undefined);
          if (prod) break;
        }
      }
      const ctor = isCtor(c.name);
      const site: Site = {
        src: srcIndex,
        callee: c.name,
        l1, l2,
        field: lf?.field ?? src.field,
        line: lf ? lf.line : li + 1,
        col: Math.max(1, c.s - starts[li] + 1 - (lf?.prefix ?? 0)),
        text, hs, he,
        chain: v.chain,
        sk,
        prod: prod ?? '·',
        cons: v.parentCall ?? cons,
        same: callees.filter(n => n !== c.name),
        lits: c.args.map(a => { const f = fold(a); return f.k === 'num' ? f.v : null; }),
        ids,
      };
      if (ctor) site.ctor = 1;
      if (v.flip) site.flip = 1;
      const fn = st.fn || fnAt(c.s);
      if (fn) site.fn = fn;
      sites.push(site);
    }
    for (const t of st.targets) lastDef.set(t, st);
  });

  const words = new Set<string>([...proseWords(src.words ?? ''), ...proseWords(src.nodeLabel ?? ''), ...proseWords(commentText(src.text))]);
  for (const f of parsed.fns) for (const w of codeWords(f.name)) words.add(w);
  const source: DocSource = { sourceKind: src.sourceKind, field: src.field, words: [...words] };
  if (src.nodeId) source.nodeId = src.nodeId;
  if (src.nodePath) source.nodePath = src.nodePath;
  if (src.nodeLabel) source.nodeLabel = src.nodeLabel;
  if (src.nodeType) source.nodeType = src.nodeType;
  return { sites, source };
}

/** Index a whole doc. */
export function extractDoc(d: DocInput, now = Date.now()): DocRecord {
  const sources: DocSource[] = [];
  const sites: Site[] = [];
  d.sources.forEach((s, i) => {
    const r = extractSource(s, i);
    sources.push(r.source);
    for (const x of r.sites) sites.push(x);
  });
  return { docId: d.docId, version: docVersion(d), origin: d.origin, label: d.label, group: d.group, indexedAt: now, sources, sites };
}
