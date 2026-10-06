/**
 * What a function card says (docs/expression-explainer.md, "Function cards"): the name, its
 * signature(s) with types, the plain meaning, a mini plot for functions of one number (with the
 * clicked call's own literal arguments plugged in), and what *this* call does.
 *
 *   functionCard('float e = smoothstep(0.3, 0.35, d);', 12, { types: { d: 'float' } })
 *   → name 'smoothstep', kind 'builtin', overloads [genType (genType edge0, …), …],
 *     meaning "a soft ramp from 0 to 1 as x goes from edge0 to edge1 …",
 *     plot of smoothstep(0.3, 0.35, x) (literals: true),
 *     here "Goes smoothly from 0 to 1 as d goes from 0.3 to 0.35 …"
 *
 * Pure: no DOM, the same text always gives the same card.
 */
import { explainExpression, type ExplainContext } from './explain';
import { parseExpr } from './parse';
import { constValue } from './match';
import { transferPlot, type TransferPlot } from './plot';
import { toPlainText, type Seg } from './segments';
import { functionInfo, genericTypesIn, GENERIC_TYPES as GENERIC_LEGEND, type FnInfo, type FnKind, type FnOverload } from './functions';
import { declaredFunctions, functionAt, type FunctionAtOptions, type FunctionHit } from './fnAt';
import { SNIPPETS, type Snippet } from '../../suggestions/snippets';

export interface FunctionCardContext extends ExplainContext {
  /** More source to find user functions in (a Custom Function's helpers, the whole shader). */
  source?: string;
}

export interface FunctionCardModel {
  name: string;
  kind: FnKind | 'unknown';
  /** "GLSL built-in · Common", "Playfield helper", "your function", … */
  kindLabel: string;
  overloads: FnOverload[];
  /** Generic type names used in the table, with what they stand for. */
  legend: Array<{ type: string; means: string }>;
  meaning?: string;
  use?: string;
  /** A user function's comment, or a snippet's doc. */
  doc?: string;
  /** The mini plot, when the function is one of one number. */
  plot?: TransferPlot;
  /** True when the plot uses the call's own literal arguments. */
  plotFromCall?: boolean;
  /** The plotted expression (`smoothstep(0.3, 0.35, x)`). */
  plotExpr?: string;
  /** What this call does, as segments (ExplainText) and plain text. */
  here?: Seg[];
  hereText?: string;
  /** The call as written. */
  call?: string;
  snippet?: Snippet;
  docs?: string;
  notInWebGL?: boolean;
  hit: FunctionHit;
}

/** The snippet library entry for a function name: an explicit link, or a snippet whose helper declares it. */
export function snippetFor(name: string, info?: FnInfo): Snippet | undefined {
  if (info?.snippet) return SNIPPETS.find(s => s.id === info.snippet);
  return SNIPPETS.find(s => new RegExp(`\\b[A-Za-z_]\\w*\\s+${name}\\s*\\(`).test(s.helper));
}

const KIND_LABEL: Record<FnKind | 'unknown', string> = {
  builtin: 'GLSL built-in', constructor: 'Type constructor', helper: 'Playfield helper', user: 'Your function', unknown: 'Function',
};

/** The plot for one call: the call's literal arguments where it has them, the defaults elsewhere. */
export function plotForCall(info: FnInfo, args: readonly string[]): { plot: TransferPlot; expr: string; fromCall: boolean } | null {
  if (!info.plot) return null;
  const ov = info.overloads.find(o => o.params.length === info.plot!.defaults.length) ?? info.overloads[0];
  const xName = ov.params[info.plot.x]?.name || 'x';
  let fromCall = false;
  const parts = info.plot.defaults.map((d, i) => {
    if (i === info.plot!.x) return xName;
    const a = args[i];
    if (a !== undefined) {
      const p = parseExpr(a);
      const v = p.ok ? constValue(p.expr) : undefined;
      if (v !== undefined && Number.isFinite(v)) { fromCall = true; return a; }
    }
    return d;
  });
  const expr = `${info.name}(${parts.join(', ')})`;
  const ex = explainExpression(expr, { types: { [xName]: 'float' }, noIdioms: true });
  if (!ex.ok) return null;
  const plot = transferPlot(ex);
  return plot ? { plot, expr, fromCall } : null;
}

/** What this call does, in words: an idiom's plain meaning, else the call's own step. */
export function explainCall(call: string, ctx: ExplainContext = {}): Seg[] | null {
  const ex = explainExpression(call, ctx);
  if (!ex.ok || ex.root.kind !== 'call') return null;
  if (ex.meaningSegs?.length) return ex.meaningSegs;
  const step = ex.steps.find(s => s.node === ex.root) ?? ex.steps[ex.steps.length - 1];
  if (!step) return null;
  // An unknown function's step only says it calls it: nothing to add
  if (/a function this explainer doesn.t know/.test(step.text)) return null;
  const segs = step.segs.map(s => ({ ...s }));
  if (segs[0]?.kind === 'text') segs[0] = { kind: 'text', text: segs[0].text.charAt(0).toUpperCase() + segs[0].text.slice(1) };
  return segs;
}

/** The card for a function hit (from functionAt) in `code`. */
export function functionCardFor(code: string, hit: FunctionHit, ctx: FunctionCardContext = {}): FunctionCardModel {
  const info = functionInfo(hit.name);
  const declared = declaredFunctions(`${ctx.source ?? ''}\n${code}`).filter(d => d.name === hit.name);
  const user = !info || info.kind === 'helper' ? declared : [];
  const kind: FunctionCardModel['kind'] = info && !(info.kind === 'helper' && user.length && !sameAsHelper(info, user[0].overload)) ? info.kind : user.length ? 'user' : 'unknown';
  const overloads = kind === 'user' ? dedupe(user.map(d => d.overload)) : info?.overloads ?? [];
  const snippet = snippetFor(hit.name, kind === 'user' ? undefined : info);
  const model: FunctionCardModel = {
    name: hit.name,
    kind,
    kindLabel: kind === 'builtin' && info ? `${KIND_LABEL.builtin} · ${info.category}` : kind === 'helper' && info ? `${KIND_LABEL.helper} · ${info.category}` : KIND_LABEL[kind],
    overloads,
    legend: genericTypesIn(overloads).map(t => ({ type: t, means: GENERIC_LEGEND[t] })),
    hit,
  };
  if (kind !== 'user' && info) {
    model.meaning = info.meaning;
    if (info.use) model.use = info.use;
    if (info.docs) model.docs = info.docs;
    if (info.notInWebGL) model.notInWebGL = true;
  } else if (kind === 'user') {
    const doc = user.find(d => d.doc)?.doc;
    if (doc) model.doc = doc;
    if (snippet) model.meaning = lowerFirst(snippet.doc.replace(/\.$/, ''));
  }
  if (snippet) model.snippet = snippet;
  if (!hit.declaration) {
    model.call = code.slice(hit.start, Math.min(code.length, hit.close + 1));
    if (kind !== 'user' && info) {
      const p = plotForCall(info, hit.args);
      if (p) { model.plot = p.plot; model.plotExpr = p.expr; model.plotFromCall = p.fromCall; }
    }
    if (hit.close < code.length) {
      const segs = explainCall(model.call, ctx);
      // An unknown function's step only says "calls foo(…)": the card already says that
      if (segs && !(kind === 'user' || kind === 'unknown')) { model.here = segs; model.hereText = toPlainText(segs); }
    }
  }
  return model;
}

/** The card at a caret or click offset, or null when no function name is there. */
export function functionCard(code: string, pos: number, ctx: FunctionCardContext = {}, opts: FunctionAtOptions = {}): FunctionCardModel | null {
  const hit = functionAt(code, pos, opts);
  return hit ? functionCardFor(code, hit, ctx) : null;
}

/** A helper redeclared with a different signature is the user's own function. */
function sameAsHelper(info: FnInfo, ov: FnOverload): boolean {
  return info.overloads.some(h => h.returns === ov.returns && h.params.length === ov.params.length && h.params.every((p, i) => p.type === ov.params[i].type));
}

function dedupe(ovs: FnOverload[]): FnOverload[] {
  const seen = new Set<string>();
  return ovs.filter(o => { const k = `${o.returns}(${o.params.map(p => p.type).join(',')})`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
