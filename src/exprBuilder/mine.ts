/**
 * mine.ts — written code into moves (docs/expression-builder-plan.md §1).
 *
 * Every statement in a doc's code (an Expression Block line or its result, a Custom Function's
 * body, the helper functions with their local variables, a whole imported shader) is read with the
 * Code explorer's statement parser, and its right-hand side with glslPatterns. Then:
 *
 *  1. **The subject.** The variable the statement transforms: what it assigns, if it reads it
 *     (`p = fract(p * 4.0) - 0.5`, `p += …`), else the best of the names it reads (space before
 *     colour before plain values before time).
 *  2. **Steps.** Along the subject's path up the tree, each operation is a step with the child
 *     replaced by `x`: `x * #a`, `fract(x)`, `x - #a`. Where two branches both read the subject
 *     (`x + #a * sin(x.yx * #b)`), that node is one step.
 *  3. **Compounds.** Every sub-expression on the path, whole, with all its subject reads as `x`:
 *     `fract(x * #a)`, `fract(x * #a) - #b`.
 *
 * In each, numbers become number holes (`#a`, with the value seen) and other names variable holes
 * (`$t` for a time, `$u`…, typed). A candidate is kept only when it type-checks with the subject's
 * type and calls nothing but GLSL built-ins and the always-there helpers.
 *
 * Context per statement (context.ts): the dimension, what fed the subject, what the result went
 * into, and the techniques at the node. Order: consecutive steps in a statement, the last step of
 * the statement that made a variable → the first step of the next statement reading it, and across
 * wires from one code node into another.
 */
import { parseSource, type Expr as CeExpr, type Stmt } from '../codeExplorer/parser';
import { lineIndexAt, lineStarts } from '../codeExplorer/tokenizer';
import type { SourceInput } from '../codeExplorer/types';
import {
  allNodes, checkTypes, childrenOf, GLOBAL_TYPES, inferRoles, inferTypes, parseExpr, printExpr, roleFromName, roleFromType, typesFromCode,
  type Expr, type GlslType, type Role, type RoleEnv, type TypeEnv,
} from '../lib/glslPatterns';
import { normalize, NAMED_CONSTANTS, type N } from '../lib/glslPatterns/match';
import { customFnEnv, exprBlockEnv } from '../lib/glslPatterns/findUses';
import { vecOf } from '../lib/glslPatterns/types';
import { dimensionOf, feedRole, graphContext, nameFeed, type FeedInfo, type GraphContext, type NodeSite } from './context';
import { callOk, familyOf, HELPER_ENV, HOLE_TYPES, idiomOf, numHoleName, SUBJ, templateKey, VALUE_TYPES, varHoleName } from './shared';
import type { CatalogueBuilder, Dimension, Feed, Instance, Into, MoveDoc, MoveFamily, MoveSignature } from './moves';

/** Compounds bigger than this (tree nodes) are too specific to be a move. */
const MAX_COMPOUND = 24;
/** A merge step (both branches read the subject) can be bigger, but not a whole shader line. */
const MAX_STEP = 40;
const MAX_HOLES = 8;
const MAX_RHS = 600;

type Draft = Omit<Instance, 'src' | 'ctx' | 'step' | 'steps'>;

const SWZ = /^[xyzw]{1,4}$|^[rgba]{1,4}$|^[stpq]{1,4}$/;

/** A template from an expression whose subject reads are `__s`. */
function makeDraft(text: string, env: TypeEnv, sType: GlslType, roles: RoleEnv, userFns: ReadonlySet<string>): Draft | null {
  const r = parseExpr(text);
  if (!r.ok) return null;
  const I = r.expr;
  const nodes = allNodes(I);
  if (!nodes.some(n => n.kind === 'ident' && n.name === SUBJ)) return null;
  if (nodes.every(n => n.kind === 'ident' && n.name === SUBJ)) return null;
  for (const n of nodes) if (n.kind === 'call' && !callOk(n.callee, userFns)) return null;
  const fullEnv: TypeEnv = { ...HELPER_ENV, ...env, [SUBJ]: sType };
  const typeOf = (name: string): GlslType => fullEnv[name] ?? GLOBAL_TYPES[name] ?? 'unknown';
  const types = inferTypes(I, fullEnv);
  const roleInfo = inferRoles(I, types, roles);
  const N0 = normalize(I);

  const subst = new Map<number, string>();
  const holes: Draft['holes'] = [];
  const varHole = new Map<string, string>();
  let ni = 0, vi = 0, ti = 0;
  const anon = (n: N) => anonInst(n, typeOf);
  const visit = (n: N): void => {
    switch (n.k) {
      case 'num': {
        const name = numHoleName(ni++);
        subst.set(n.src.id, name);
        holes.push({ name, kind: 'number', type: n.src.kind === 'num' && n.src.int ? 'int' : 'float', value: n.v });
        return;
      }
      case 'id': {
        const src = n.src as Extract<Expr, { kind: 'ident' }>;
        if (src.name === SUBJ) { subst.set(src.id, 'x'); return; }
        let h = varHole.get(src.name);
        if (!h) {
          const type = typeOf(src.name);
          const role = roles[src.name] ?? roleInfo.get(src.id)?.role ?? roleFromType(type);
          h = role === 'time' && (type === 'float' || type === 'int') ? varHoleName(0, ti++) : varHoleName(vi++, null);
          varHole.set(src.name, h);
          holes.push({ name: h, kind: 'var', type, role, varName: src.name });
        }
        subst.set(src.id, h);
        return;
      }
      case 'hole': return;
      case 'call': n.args.forEach(visit); return;
      case 'nary': [...n.items].map(x => [anon(x), x] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).forEach(([, x]) => visit(x)); return;
      case 'bin': visit(n.l); visit(n.r); return;
      case 'un': visit(n.a); return;
      case 'mem': visit(n.o); return;
      case 'idx': visit(n.o); if (n.i.k !== 'num') visit(n.i); return;
      case 'tern': visit(n.t); visit(n.a); visit(n.b); return;
    }
  };
  visit(N0);
  if (holes.length > MAX_HOLES) return null;
  if (holes.some(h => !HOLE_TYPES.has(h.type))) return null;
  const template = printExpr(I, subst);
  const t = parseExpr(template);
  if (!t.ok) return null;
  const tEnv: TypeEnv = { ...HELPER_ENV, x: sType };
  for (const h of holes) tEnv[h.name] = h.type;
  // GLSL ES 3.0's rules, strictly (constructor sizes, built-in overloads, no int → float): a move
  // that wouldn't compile on its own type never reaches the builder's grid.
  const strict = checkTypes(t.expr, tEnv);
  if (!strict.ok) return null;
  const out = strict.type;
  if (!VALUE_TYPES.has(out)) return null;
  const subjRole = nodes.filter(n => n.kind === 'ident' && n.name === SUBJ).map(n => roleInfo.get(n.id)?.role).find(Boolean) ?? roleFromType(sType);
  const sig: MoveSignature = { in: sType, out, role: subjRole, outRole: roleInfo.get(I.id)?.role ?? roleFromType(out) };
  const key = templateKey(template, sType, subjRole, tEnv);
  if (!key) return null;
  const idiom = idiomOf(template, tEnv);
  const family = familyOf(t.expr, sig);
  // Moving, scaling, folding, repeating… space gives space (a vec3 of space isn't a colour because
  // vec3s often are): these keep what the subject stood for while the type stays.
  if (out === sType && KEEPS_ROLE.has(family) && subjRole !== 'unknown') sig.outRole = subjRole;
  return { key, template, family, sig, holes, norm: N0, ...(idiom ? { idiom } : {}) };
}

/** Families whose result, when the type stays, stands for what their input did. */
const KEEPS_ROLE: ReadonlySet<MoveFamily> = new Set(['scale', 'offset', 'repeat', 'fold', 'warp', 'rotate', 'clamp', 'swizzle', 'couple', 'product', 'blend', 'curve', 'wave']);

/** anonKey on an instance tree (names typed from the environment). */
function anonInst(n: N, typeOf: (name: string) => GlslType): string {
  switch (n.k) {
    case 'num': return '#';
    case 'hole': return n.lit ? '#' : '$';
    case 'id': return n.name === SUBJ ? 'x' : `$${typeOf((n.src as Extract<Expr, { kind: 'ident' }>).name)}`;
    case 'call': return `${n.callee}(${n.args.map(a => anonInst(a, typeOf)).join(',')})`;
    case 'nary': return `${n.neg ? '-' : ''}${n.op}[${n.items.map(a => anonInst(a, typeOf)).sort().join(',')}]`;
    case 'bin': return `(${anonInst(n.l, typeOf)}${n.op}${anonInst(n.r, typeOf)})`;
    case 'un': return `${n.op}${anonInst(n.a, typeOf)}`;
    case 'mem': return `${anonInst(n.o, typeOf)}.${n.f}`;
    case 'idx': return `${anonInst(n.o, typeOf)}[${n.i.k === 'num' ? n.i.v : anonInst(n.i, typeOf)}]`;
    case 'tern': return `(${anonInst(n.t, typeOf)}?${anonInst(n.a, typeOf)}:${anonInst(n.b, typeOf)})`;
  }
}

interface Subject { name: string; swz?: string; type: GlslType }

const CALL_INTO: Record<string, Into> = {
  length: 'distance', distance: 'distance', sdBox: 'distance', sdSegment: 'distance', sdEllipse: 'distance', smin: 'distance',
  palette: 'palette', smoothstep: 'mask', step: 'mask', texture: 'sample', texture2D: 'sample', textureLod: 'sample', atan: 'angle',
};

/** One statement, read. */
interface Item {
  st: Stmt;
  fn: string;
  /** The right-hand side as computed (compound assignments spelled out). */
  expr: Expr;
  target?: string;
  swz?: string;
  declType?: string;
  isReturn: boolean;
  line: number;
  field: string;
}

function readItems(src: SourceInput): { items: Item[]; fns: Array<{ name: string; s: number; e: number }>; text: string } {
  let parsed;
  try { parsed = parseSource(src.text, src.mode); } catch { return { items: [], fns: [], text: src.text }; }
  const starts = lineStarts(src.text);
  const items: Item[] = [];
  const slice = (e: CeExpr) => src.text.slice(e.s, e.e);
  for (const st of parsed.stmts) {
    if (!(st.kind === 'decl' || st.kind === 'assign' || st.kind === 'return' || (st.kind === 'expr' && src.mode === 'expr'))) continue;
    const rhs = st.exprs[0];
    if (!rhs || rhs.k === 'err') continue;
    let text = src.text.slice(rhs.s, exprEnd(src.text, rhs.s, rhs.e)).trim();
    if (!text || text.length > MAX_RHS) continue;
    let target: string | undefined, swz: string | undefined;
    if (st.kind === 'decl') target = st.targets[0];
    if (st.kind === 'assign' && st.lhs) {
      const l = st.lhs;
      if (l.k === 'id') target = l.name;
      else if (l.k === 'mem' && l.o.k === 'id' && SWZ.test(l.f)) { target = l.o.name; swz = l.f; }
      else continue;
      const op = st.op ?? '=';
      if (op !== '=') {
        if (!['+=', '-=', '*=', '/='].includes(op)) continue;
        text = `${slice(l)} ${op[0]} (${text})`;
      }
    }
    const r = parseExpr(text);
    if (!r.ok) continue;
    const li = lineIndexAt(starts, st.s);
    const lf = src.lineFields?.[li];
    items.push({ st, fn: st.fn, expr: r.expr, target, swz, declType: st.declType, isReturn: st.kind === 'return', line: lf ? lf.line : li + 1, field: lf?.field ?? src.field });
  }
  return { items, fns: parsed.fns, text: src.text };
}

/**
 * Where an expression starting at `s` really ends: the statement parser's spans stop before a closing
 * parenthesis, so read on to the `;` (or `,` / an unmatched bracket) at depth 0.
 */
function exprEnd(text: string, s: number, atLeast: number): number {
  let depth = 0;
  for (let i = s; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { if (depth === 0) return Math.max(i, atLeast); depth--; }
    else if (depth === 0 && (c === ';' || c === ',' || c === '{' || c === '}')) return Math.max(i, atLeast);
  }
  return text.length;
}

/** Names that are never what a statement transforms (the screen's size scales, it isn't transformed). */
const NOT_SUBJECTS = /^(u_resolution|iResolution|resolution|iChannelResolution)$/;

const isConstName = (name: string) => name in NAMED_CONSTANTS || name === 'true' || name === 'false';

/** Per doc: what the miner keeps across its sources. */
interface DocState {
  b: CatalogueBuilder;
  docIndex: number;
  g: GraphContext | null;
  /** Code node (path) → the last step of its result. */
  nodeLast: Map<string, string>;
  /** Wires between code nodes, resolved once every node has been read. */
  deferred: Array<{ from: string; to: string; dim: Dimension; feed: Feed }>;
}

export function mineDoc(md: MoveDoc, b: CatalogueBuilder): void {
  const d = md.doc;
  const docIndex = b.doc({ id: d.docId, label: d.label, origin: d.origin });
  const gOrigin = d.origin === 'example' ? 'example' : d.origin === 'open' ? 'open' : 'saved';
  const g = md.nodes?.length ? graphContext(d.docId, d.label, gOrigin, md.nodes) : null;
  const ds: DocState = { b, docIndex, g, nodeLast: new Map(), deferred: [] };
  for (const src of d.sources) {
    try { mineSource(src, ds); } catch (e) { console.warn('[moves] could not mine', d.docId, src.field, e); }
  }
  for (const w of ds.deferred) {
    const from = ds.nodeLast.get(w.from);
    if (from) b.addPair(from, w.to, w.dim, w.feed);
  }
}

function mineSource(src: SourceInput, ds: DocState): void {
  const { items, fns, text } = readItems(src);
  if (!items.length) return;
  const site: NodeSite | undefined = ds.g?.find(src.nodePath);
  const node = site?.node;
  const userFns = new Set(fns.map(f => f.name));
  for (const k of Object.keys(typesFromCode(text))) if (k.endsWith('()')) userFns.add(k.slice(0, -2));

  // Types: the node's inputs and locals, or the code's own declarations (per function in a file).
  let baseEnv: TypeEnv;
  // The node's own sockets say what its inputs are, even where params.inputs is missing.
  const sockets: TypeEnv = Object.fromEntries(Object.entries(node?.inputs ?? {}).filter(([, s]) => VALUE_TYPES.has(s.type as GlslType)).map(([k, s]) => [k, s.type as GlslType]));
  if (node?.type === 'exprNode') baseEnv = { ...typesFromCode(text), ...exprBlockEnv(node), ...sockets };
  else if (node?.type === 'customFn' && src.mode === 'body') baseEnv = { ...customFnEnv(node), ...sockets };
  else if (src.mode === 'expr' && node) baseEnv = Object.fromEntries(Object.entries(node.inputs ?? {}).map(([k, s]) => [k, s.type as GlslType]));
  else baseEnv = src.mode === 'body' ? { t: 'float', ...typesFromCode(text) } : {};
  const fnEnv = new Map<string, TypeEnv>();
  const envFor = (fn: string): TypeEnv => {
    if (src.mode !== 'file') return baseEnv;
    let e = fnEnv.get(fn);
    if (!e) {
      const span = fns.find(f => f.name === fn);
      // Globals (uniforms, consts) from outside every function, then the function's own names.
      let outside = text;
      for (const f of fns) outside = outside.slice(0, f.s) + ' '.repeat(f.e - f.s) + outside.slice(f.e);
      e = { ...typesFromCode(outside), ...(span ? typesFromCode(text.slice(span.s, span.e)) : {}) };
      fnEnv.set(fn, e);
    }
    return e;
  };
  const file3D = src.mode === 'file' && /\b(rd|rayDir)\b/.test(text) && /\b(march|raymarch|rayMarch|map|sdf|calcNormal|getNormal)\b/.test(text);
  const in3D = site ? ds.g!.in3D(site) : false;
  const techniques = node && ds.g ? ds.g.techniquesAt(node.id) : [];
  const nodeKey = src.nodePath?.join('/') ?? '';
  const topFn = src.mode !== 'file';

  // Per function: what fed each local, and the last step that made it.
  let curFn: string | null = null;
  const localFeed = new Map<string, FeedInfo>();
  const lastStep = new Map<string, string>();
  const inputFeed = new Map<string, FeedInfo>();
  const feedOf = (name: string, type: GlslType): FeedInfo => {
    const l = localFeed.get(name);
    if (l) return l;
    if (site && node?.inputs?.[name] && topFn) {
      let f = inputFeed.get(name);
      if (!f) { f = ds.g!.feedOfInput(site, name); inputFeed.set(name, f); }
      return f;
    }
    if (node?.type === 'exprNode' && name === 't' && !node.inputs?.t) return { feed: 'time', via3d: false };
    return { feed: nameFeed(name, type), via3d: false };
  };

  items.forEach((it, idx) => {
    if (it.fn !== curFn) { curFn = it.fn; localFeed.clear(); lastStep.clear(); }
    const env = envFor(it.fn);
    const typeOf = (name: string): GlslType => env[name] ?? GLOBAL_TYPES[name] ?? 'unknown';
    const subj = pickSubject(it.expr, it, typeOf, feedOf);
    const outType = inferTypes(it.expr, { ...HELPER_ENV, ...env }).get(it.expr.id) ?? 'unknown';
    if (!subj) {
      if (it.target) localFeed.set(it.target, { feed: 'value', via3d: false });
      return;
    }
    const into = stmtInto(it, idx, items, outType, site, topFn, ds.g);
    const srcRef = { doc: ds.docIndex, ...(src.nodePath?.length ? { path: src.nodePath } : {}), field: it.field, line: it.line };

    // Roles the graph (or names) know for certain.
    const roles: RoleEnv = {};
    for (const n of allNodes(it.expr)) if (n.kind === 'ident' && !isConstName(n.name)) {
      const ty = typeOf(n.name);
      const r = feedRole(feedOf(n.name, ty).feed, ty);
      if (r) roles[n.name] = r;
    }
    const parents = new Map<number, Expr>();
    for (const n of allNodes(it.expr)) for (const c of childrenOf(n)) parents.set(c.id, n);
    const seen = new Set<string>();
    // Every node's type and role in the statement: a step along the path acts on what its child
    // gives (after `length(p)` the next step acts on a float distance, not on p's vec2).
    const stmtTypes = inferTypes(it.expr, { ...HELPER_ENV, ...env });
    const stmtRoles = inferRoles(it.expr, stmtTypes, roles);

    /** Mine one subject's path through `root`, then the side branches that don't read it. */
    const mineTree = (root: Expr, sj: Subject, rootInto: Into, depth: number): { first?: string; last?: string; feed: FeedInfo; dim: Dimension } => {
      const sFeed = feedOf(sj.name, typeOf(sj.name));
      const isSubj = (n: Expr) => (sj.swz
        ? n.kind === 'member' && n.field === sj.swz && n.object.kind === 'ident' && n.object.name === sj.name
        : n.kind === 'ident' && n.name === sj.name);
      const contains = new Set<number>();
      const occ: Expr[] = [];
      const mark = (n: Expr): boolean => {
        if (isSubj(n)) { contains.add(n.id); occ.push(n); return true; }
        let any = false;
        for (const c of childrenOf(n)) if (mark(c)) any = true;
        if (any) contains.add(n.id);
        return any;
      };
      const sRole = feedRole(sFeed.feed, sj.type) ?? roleFromName(sj.name, sj.type) ?? roleFromType(sj.type);
      const dim = dimensionOf({ type: sj.type, feed: sFeed.feed, role: sRole, in3D, via3d: sFeed.via3d, fnName: it.fn || undefined, file3D });
      if (!mark(root)) return { feed: sFeed, dim };
      const occMap = new Map(occ.map(o => [o.id, SUBJ]));
      const rolesHere: RoleEnv = { ...roles, [SUBJ]: sRole };
      const intoOf = (n: Expr): Into => {
        const p = n === root ? undefined : parents.get(n.id);
        if (p?.kind === 'call' && CALL_INTO[p.callee]) return CALL_INTO[p.callee];
        return rootInto;
      };
      const ctx = (n: Expr, feed: Feed = sFeed.feed) => ({ dim, feed, into: intoOf(n), techniques });
      const draftCache = new Map<string, Draft | null>();
      const draft = (txt: string, type: GlslType = sj.type, role: Role = sRole) => {
        const k = `${type}|${role}|${txt}`;
        if (!draftCache.has(k)) draftCache.set(k, VALUE_TYPES.has(type) ? makeDraft(txt, env, type, { ...rolesHere, [SUBJ]: role }, userFns) : null);
        return draftCache.get(k)!;
      };
      // Steps along the path, innermost first, each typed by what it acts on (its child) and fed by
      // what that is (a distance once the path went through `length`).
      const stepsOf = (n: Expr): Array<{ n: Expr; d: Draft | null; feed: Feed }> => {
        if (isSubj(n)) return [];
        const kids = childrenOf(n).filter(c => contains.has(c.id));
        if (kids.length === 1) {
          const kid = kids[0];
          const below = stepsOf(kid);
          const txt = printExpr(n, new Map([[kid.id, SUBJ]]));
          const kt = isSubj(kid) ? sj.type : stmtTypes.get(kid.id) ?? 'unknown';
          const kr = isSubj(kid) ? sRole : stmtRoles.get(kid.id)?.role ?? roleFromType(kt);
          // Space stays fed as the subject was (the statement's dimension says which space).
          const feed = (kt === sj.type && kr === sRole) || kr === 'space' ? sFeed.feed : roleFeedOf(kr, kt, sFeed.feed);
          return [...below, { n, d: allNodes(n).length - allNodes(kid).length + 1 <= MAX_STEP ? draft(txt, kt, kr) : null, feed }];
        }
        return [{ n, d: allNodes(n).length <= MAX_STEP ? draft(printExpr(n, occMap)) : null, feed: sFeed.feed }];
      };
      const emit = (d: Draft, n: Expr, step: boolean, stepKeys: string[], feed?: Feed) => {
        const k = `${n.id}|${d.key}`;
        if (seen.has(k)) return;
        seen.add(k);
        ds.b.addInstance({ ...d, step, steps: stepKeys, src: srcRef, ctx: ctx(n, feed) });
      };
      const steps = stepsOf(root);
      for (const x of steps) if (x.d) emit(x.d, x.n, true, [x.d.key], x.feed);
      // Order inside the statement: consecutive valid steps (a step that isn't a move breaks the chain).
      for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1].d, c = steps[i].d;
        if (a && c) ds.b.addPair(a.key, c.key, dim, steps[i].feed);
      }
      // Compounds: every sub-expression on the path.
      for (const n of allNodes(root)) {
        if (!contains.has(n.id) || isSubj(n)) continue;
        if (allNodes(n).length > MAX_COMPOUND) continue;
        const d = draft(printExpr(n, occMap));
        if (!d) continue;
        const sub = stepsOf(n).map(x => x.d?.key).filter((k): k is string => !!k);
        emit(d, n, sub.length === 1 && sub[0] === d.key, sub);
      }
      // Side branches: arguments that don't read the subject but transform another variable.
      if (depth < 4) {
        for (const n of allNodes(root)) {
          if (contains.has(n.id) || n.kind === 'ident' || n.kind === 'num') continue;
          const p = parents.get(n.id);
          if (!p || !contains.has(p.id)) continue;
          const side = pickSubject(n, null, typeOf, feedOf);
          if (!side) continue;
          const r = mineTree(n, side, intoOf(n), depth + 1);
          const prevSide = lastStep.get(side.name);
          if (prevSide && r.first) ds.b.addPair(prevSide, r.first, r.dim, r.feed.feed);
        }
      }
      const valid = steps.map(x => x.d).filter((x): x is Draft => !!x);
      return { first: steps[0]?.d ? valid[0]?.key : undefined, last: valid[valid.length - 1]?.key, feed: sFeed, dim };
    };

    const r = mineTree(it.expr, subj, into, 0);
    // Across statements: the move that made the subject, then this one.
    const prev = lastStep.get(subj.name);
    if (prev && r.first) ds.b.addPair(prev, r.first, r.dim, r.feed.feed);
    // Across wires: a code node feeding this one.
    if (!prev && r.first && site && topFn && node?.inputs?.[subj.name]?.connection) {
      const c = node.inputs[subj.name].connection!;
      const from = [...site.ancestors.map(a => a.id), c.nodeId].join('/');
      ds.deferred.push({ from, to: r.first, dim: r.dim, feed: r.feed.feed });
    }
    if (it.target) {
      // A new type is a new thing: a length of space is a distance, not space.
      const tType = it.declType && VALUE_TYPES.has(it.declType as GlslType) ? it.declType as GlslType : outType;
      const same = tType === subj.type || (!!it.swz && it.target === subj.name);
      const outRole = roleFromName(it.target, tType) ?? roleFromType(tType);
      localFeed.set(it.target, same ? r.feed : { feed: roleFeedOf(outRole, tType, r.feed.feed), via3d: r.feed.via3d });
      if (r.last) lastStep.set(it.target, r.last); else lastStep.delete(it.target);
    }
    if (it.isReturn && topFn && nodeKey && r.last) ds.nodeLast.set(nodeKey, r.last);
  });
  // An Expression Block returning a variable as is: its last step is the variable's.
  const ret = items.filter(i => i.isReturn && i.expr.kind === 'ident').pop();
  if (ret && topFn && nodeKey && !ds.nodeLast.has(nodeKey)) {
    const k = lastStep.get((ret.expr as Extract<Expr, { kind: 'ident' }>).name);
    if (k) ds.nodeLast.set(nodeKey, k);
  }
}

const FEED_RANK: Partial<Record<Feed, number>> = {
  uv: 6, fragCoord: 6, position: 6, hitPos: 6, normal: 6, rayDir: 5, rayOrigin: 4, mouse: 3,
  distance: 4, colour: 4, cell: 4, agent: 4, mask: 3, value: 3, loopIndex: 2, unknown: 2, time: 1, constant: 0,
};

/** The variable a statement transforms. */
function pickSubject(root: Expr, it: Item | null, typeOf: (n: string) => GlslType, feedOf: (n: string, t: GlslType) => FeedInfo): Subject | null {
  const nodes = allNodes(root);
  const ok = (t: GlslType) => VALUE_TYPES.has(t);
  if (it?.target) {
    const tt = typeOf(it.target);
    if (it.swz) {
      const hit = nodes.some(n => n.kind === 'member' && n.field === it.swz && n.object.kind === 'ident' && n.object.name === it.target);
      const t = vecOf(it.swz.length);
      if (hit && ok(t)) return { name: it.target, swz: it.swz, type: t };
    }
    if (nodes.some(n => n.kind === 'ident' && n.name === it.target) && ok(tt)) return { name: it.target, type: tt };
  }
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const n of nodes) if (n.kind === 'ident' && !isConstName(n.name) && !NOT_SUBJECTS.test(n.name) && !n.name.startsWith('$') && !n.name.startsWith('#')) {
    if (!counts.has(n.name)) order.push(n.name);
    counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
  }
  let best: Subject | null = null, bestScore = -Infinity;
  order.forEach((name, i) => {
    const t = typeOf(name);
    if (!ok(t)) return;
    const f = feedOf(name, t).feed;
    const score = (FEED_RANK[f] ?? 2) * 100 + (t === 'float' ? 1 : Number(t[3])) * 10 + (counts.get(name) ?? 0) * 2 - i * 0.01;
    if (score > bestScore) { bestScore = score; best = { name, type: t }; }
  });
  return best;
}

/** What a value made from `from` is fed by, once its type changed (a length of uv is a distance). */
function roleFeedOf(role: Role, type: GlslType, from: Feed): Feed {
  switch (role) {
    case 'distance': return 'distance';
    case 'colour': return 'colour';
    case 'cell': return 'cell';
    case 'mask': return 'mask';
    case 'time': return 'time';
    case 'direction': return 'normal';
    case 'space': return type === 'vec3' ? (from === 'hitPos' || from === 'normal' ? from : 'position') : type === 'vec2' ? (from === 'fragCoord' ? from : 'uv') : 'value';
    default: return from === 'time' && type === 'float' ? 'time' : 'value';
  }
}

/** What a statement's result goes into. */
function stmtInto(it: Item, idx: number, items: Item[], outType: GlslType, site: NodeSite | undefined, topFn: boolean, g: GraphContext | null): Into {
  if (it.target === 'gl_FragColor' || it.target === 'fragColor') return 'output';
  if (it.isReturn) {
    if (site && topFn && g) { const x = g.intoOfNode(site); if (x) return x; }
    if (it.fn) {
      if (/^(map|scene|sdf?|de|df|field|world|sd[A-Z0-9_]\w*)$/i.test(it.fn)) return 'distance';
      if (/palette|col|colou?r|shade|render|light/i.test(it.fn)) return 'colour';
    }
    return roleFromType(outType);
  }
  if (it.target) {
    const r = roleFromName(it.target, outType);
    if (r && r !== 'value') return r;
    for (let j = idx + 1; j < items.length && items[j].fn === it.fn; j++) {
      const later = items[j];
      const parents = new Map<number, Expr>();
      let readAt: Expr | null = null;
      for (const n of allNodes(later.expr)) {
        for (const c of childrenOf(n)) parents.set(c.id, n);
        if (!readAt && n.kind === 'ident' && n.name === it.target) readAt = n;
      }
      if (!readAt) continue;
      let p = parents.get(readAt.id);
      while (p && p.kind !== 'call') p = parents.get(p.id);
      if (p?.kind === 'call' && CALL_INTO[p.callee]) return CALL_INTO[p.callee];
      if (later.target === 'gl_FragColor' || later.target === 'fragColor') return 'output';
      if (later.target) { const r2 = roleFromName(later.target, 'unknown'); if (r2 && r2 !== 'value' && r2 !== 'space') return r2; }
      break;
    }
  }
  return roleFromType(outType);
}
