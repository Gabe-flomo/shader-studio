/**
 * pack.ts — the catalogue as compact JSON (for prebuilt/moves.json), and back.
 *
 * Objects become arrays, repeated strings (families, types, roles, feeds, techniques, fields, group
 * paths, hole names) an index into one string table, a move's steps and the order statistics move
 * indices. Ids and keys are recomputed from the templates on the way back, and the generated moves
 * aren't stored at all (generated.ts makes them). `unpackCatalogue(packCatalogue(c))` equals `c`.
 */
import type { Origin } from '../codeExplorer/types';
import type { GlslType, Role } from '../lib/glslPatterns';
import { CatalogueBuilder, MOVES_SCHEMA, type Catalogue, type Dimension, type Feed, type Into, type Move, type MoveFamily, type MoveHole } from './moves';
import { generatedMoves } from './generated';
import { moveId, templateKey, varDefault } from './shared';

type PackedHole = Array<string | number>;
/** [template, family, in, out, role, outRole, holes, count, sources, sourceCount, contexts, step, steps, idiom] */
export type PackedMove = [string, number, number, number, number, number, PackedHole[], number, number[], number, number[][], number, number[], number];

export interface PackedCatalogue {
  schema: number;
  /** Of what the catalogue was made from (exampleMoves.catalogueHash). */
  hash: string;
  strings: string[];
  docs: Array<[string, string, Origin]>;
  moves: PackedMove[];
  /** Flat: from, to (move indices), dimension, feed (string indices), count. */
  order: number[];
}

export function packCatalogue(cat: Catalogue, hash: string): PackedCatalogue {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const s = (x: string) => { let i = index.get(x); if (i === undefined) { i = strings.length; strings.push(x); index.set(x, i); } return i; };
  const mined = cat.moves.filter(m => !m.generated);
  const at = new Map(mined.map((m, i) => [m.id, i]));
  const moves: PackedMove[] = mined.map(m => [
    m.template, s(m.family), s(m.sig.in), s(m.sig.out), s(m.sig.role), s(m.sig.outRole),
    m.holes.map(h => (h.kind === 'number'
      ? [s(h.name), h.type === 'int' ? 1 : 0, h.default, h.range.min, h.range.max, h.seenMin, h.seenMax, ...h.vals.flat()]
      : [s(h.name), s(h.type), s(h.role), ...h.names.map(s)])),
    m.count,
    m.sources.flatMap(x => [x.doc, x.path ? s(x.path.join('/')) : -1, x.field !== undefined ? s(x.field) : -1, x.line ?? -1]),
    m.sourceCount,
    m.contexts.map(c => [s(c.dim), s(c.feed), s(c.into), c.n, ...c.techniques.map(s)]),
    m.step ? 1 : 0,
    (m.steps ?? []).map(id => at.get(id) ?? -1).filter(i => i >= 0),
    m.idiom ? s(m.idiom) : -1,
  ]);
  const order = cat.order.flatMap(o => {
    const f = at.get(o.from), t = at.get(o.to);
    return f === undefined || t === undefined ? [] : [f, t, s(o.dim), s(o.feed), o.n];
  });
  return { schema: MOVES_SCHEMA, hash, strings, docs: cat.docs.map(d => [d.id, d.label, d.origin]), moves, order };
}

export function unpackCatalogue(p: PackedCatalogue): Catalogue {
  const S = p.strings;
  const moves: Move[] = p.moves.map(pm => {
    const [template, fam, inT, outT, role, outRole, ph, count, src, sourceCount, ctx, step, , idiom] = pm;
    const holes: MoveHole[] = ph.map(h => {
      const name = S[h[0] as number];
      if (name.startsWith('#')) {
        const [, int, def, rmin, rmax, smin, smax, ...flat] = h as number[];
        const vals: Array<[number, number]> = [];
        for (let i = 0; i + 1 < flat.length; i += 2) vals.push([flat[i], flat[i + 1]]);
        return { name, kind: 'number', type: int ? 'int' : 'float', default: def, range: { min: rmin, max: rmax }, seenMin: smin, seenMax: smax, vals };
      }
      const [, type, r, ...names] = h as number[];
      return { name, kind: 'var', type: S[type] as GlslType, role: S[r] as Role, names: names.map(i => S[i]), default: varDefault(S[type] as GlslType, S[r] as Role) };
    });
    const sig = { in: S[inT] as GlslType, out: S[outT] as GlslType, role: S[role] as Role, outRole: S[outRole] as Role };
    const env: Record<string, GlslType> = { x: sig.in };
    for (const h of holes) env[h.name] = h.type;
    const key = templateKey(template, sig.in, sig.role, env) ?? `${sig.in}|${sig.role}|${template}`;
    const sources = [];
    for (let i = 0; i + 3 < src.length; i += 4) {
      const [doc, path, field, line] = src.slice(i, i + 4);
      sources.push({ doc, ...(path >= 0 ? { path: S[path].split('/') } : {}), ...(field >= 0 ? { field: S[field] } : {}), ...(line >= 0 ? { line } : {}) });
    }
    const m: Move = {
      id: moveId(key), key, template, family: S[fam] as MoveFamily, ...(idiom >= 0 ? { idiom: S[idiom] } : {}), sig, holes,
      count, sources, sourceCount,
      contexts: ctx.map(([dim, feed, into, n, ...t]) => ({ dim: S[dim] as Dimension, feed: S[feed] as Feed, into: S[into] as Into, techniques: t.map(i => S[i]), n })),
    };
    if (step) m.step = true;
    return m;
  });
  p.moves.forEach((pm, i) => { if (pm[12].length) moves[i].steps = pm[12].map(j => moves[j].id); });
  const order = [];
  for (let i = 0; i + 4 < p.order.length; i += 5) order.push({ from: moves[p.order[i]].id, to: moves[p.order[i + 1]].id, dim: S[p.order[i + 2]] as Dimension, feed: S[p.order[i + 3]] as Feed, n: p.order[i + 4] });
  const mined: Catalogue = { schema: p.schema, docs: p.docs.map(([id, label, origin]) => ({ id, label, origin })), moves, order };
  const b = new CatalogueBuilder();
  b.addCatalogue(mined);
  b.addGenerated(generatedMoves());
  return b.finish();
}
