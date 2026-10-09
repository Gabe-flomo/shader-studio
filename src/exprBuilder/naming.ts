/**
 * naming.ts — what the chain has become (docs/expression-builder-plan.md §4.3, phase 3).
 *
 * As the chain grows, each step can give it a name, shown on that step's row:
 *
 *  - **Chain idioms**, read off the steps (their families, what they act on): a repeat of space is a
 *    "cell repeat", a centre after it "centred cells", a distance in them a "grid of circles", a
 *    space bent by a wave of itself a "domain warp", a fold after a turn a "kaleidoscope fold"…
 *    These are the multi-step tricks, which no one line spells.
 *  - **glslPatterns idioms** (idioms.ts), recognised on the chain inlined into one expression:
 *    a cosine palette, a soft circle, a checkerboard, centred UV…
 *
 * A name unlocks its usual finishing moves (`FINISHING`, a small curated table where the order
 * statistics are thin: a cell repeat → centre it, measure a distance, take the cell's id), which the
 * ranking lifts. Pure.
 */
import { explainTree, parseExpr, type Role } from '../lib/glslPatterns';
import { chainEnd, inlineSteps, type Chain, type ChainStep } from './chain';
import type { Move, MoveFamily } from './moves';

export interface ChainName {
  /** `cell-repeat`, `domain-warp`…, or a glslPatterns idiom's id. */
  id: string;
  /** "cell repeat", "domain warp", "Cosine palette (Inigo Quilez)". */
  name: string;
  /** Where it came from. */
  source: 'chain' | 'idiom';
}

interface StepView { s: ChainStep; inRole: Role; inType: string; i: number }

/** A chain idiom: does the chain, ending at step `i`, make it? */
interface ChainRule { id: string; name: string; test: (v: StepView[], i: number) => boolean }

const isSpace = (r: Role) => r === 'space' || r === 'unknown';
const fam = (v: StepView, ...f: MoveFamily[]) => f.includes(v.s.family);
/** One of the `n` steps before `i` is of these families. */
const before = (v: StepView[], i: number, n: number, ...f: MoveFamily[]) => v.slice(Math.max(0, i - n), i).some(x => fam(x, ...f));
const anyBefore = (v: StepView[], i: number, ...f: MoveFamily[]) => v.slice(0, i).some(x => fam(x, ...f));
const repeatOfSpace = (x: StepView) => fam(x, 'repeat') && isSpace(x.inRole) && x.inType !== 'float';

/** Order matters: the first rule that matches a step names it. */
const RULES: ChainRule[] = [
  { id: 'polar-repeat', name: 'polar repeat', test: (v, i) => (fam(v[i], 'repeat') && /opRepeatPolar/.test(v[i].s.template)) || (fam(v[i], 'repeat') && anyBefore(v, i, 'polar')) },
  { id: 'kaleidoscope-fold', name: 'kaleidoscope fold', test: (v, i) => fam(v[i], 'fold') && isSpace(v[i].inRole) && v[i].inType !== 'float' && before(v, i, 3, 'rotate', 'polar', 'fold') },
  { id: 'mirror-fold', name: 'mirror fold', test: (v, i) => fam(v[i], 'fold') && isSpace(v[i].inRole) && v[i].inType !== 'float' },
  { id: 'domain-warp', name: 'domain warp', test: (v, i) => fam(v[i], 'warp', 'couple') && isSpace(v[i].inRole) && v[i].inType !== 'float' },
  { id: 'centred-cells', name: 'centred cells', test: (v, i) => i > 0 && fam(v[i], 'offset') && isSpace(v[i].inRole) && repeatOfSpace(v[i - 1]) },
  { id: 'cell-repeat', name: 'cell repeat', test: (v, i) => repeatOfSpace(v[i]) },
  { id: 'cell-id', name: 'cell id', test: (v, i) => fam(v[i], 'cell') && isSpace(v[i].inRole) && v[i].inType !== 'float' },
  { id: 'polar', name: 'polar coordinates', test: (v, i) => fam(v[i], 'polar') },
  { id: 'colour-by-space', name: 'colour by space', test: (v, i) => fam(v[i], 'colour') && v[i].inType !== 'float' && isSpace(v[i].inRole) },
  { id: 'palette', name: 'colour ramp', test: (v, i) => fam(v[i], 'colour') && v[i].inType === 'float' },
  { id: 'grid-of-dots', name: 'grid of dots', test: (v, i) => fam(v[i], 'mask') && v[i].inRole === 'distance' && v.slice(0, i).some(repeatOfSpace) },
  { id: 'soft-shape', name: 'soft shape', test: (v, i) => fam(v[i], 'mask') && v[i].inRole === 'distance' },
  { id: 'grid-of-circles', name: 'grid of circles', test: (v, i) => fam(v[i], 'distance') && v.slice(0, i).some(repeatOfSpace) },
  { id: 'rings', name: 'rings', test: (v, i) => fam(v[i], 'repeat', 'wave') && v[i].inRole === 'distance' },
  { id: 'glow', name: 'glow', test: (v, i) => v[i].inRole === 'distance' && (fam(v[i], 'curve') || /^#\w+ \/ x$|\/ x\)?$|exp\(-/.test(v[i].s.template)) },
  { id: 'stripes', name: 'stripes', test: (v, i) => fam(v[i], 'wave', 'repeat') && v[i].inType === 'float' && i > 0 && fam(v[i - 1], 'swizzle', 'project') },
  { id: 'distance-field', name: 'distance field', test: (v, i) => fam(v[i], 'distance') && isSpace(v[i].inRole) && v[i].inType !== 'float' },
];

/** The steps with what each acted on. */
function views(chain: Chain, upTo: number): StepView[] {
  return chain.steps.slice(0, upTo).map((s, i) => {
    const e = chainEnd(chain, i);
    return { s, inRole: e.role, inType: e.type, i };
  });
}

const idiomCache = new Map<string, ChainName | null>();
/** The glslPatterns idiom the whole expression is (its root), if any. */
function rootIdiom(expr: string, seedName: string, seedType: string): ChainName | null {
  if (expr.length > 400) return null;
  const k = `${seedType}|${expr}`;
  if (idiomCache.has(k)) return idiomCache.get(k)!;
  let out: ChainName | null = null;
  try {
    const r = parseExpr(expr);
    if (r.ok) {
      const ex = explainTree(r.expr, expr, { types: { [seedName]: seedType as never } });
      const hit = ex.idioms.find(h => h.node.id === r.expr.id);
      if (hit) out = { id: hit.idiom.id, name: hit.idiom.name, source: 'idiom' };
    }
  } catch { out = null; }
  if (idiomCache.size > 2000) idiomCache.clear();
  idiomCache.set(k, out);
  return out;
}

/**
 * The name each step gives the chain (null where it adds none): a chain idiom first, else the
 * glslPatterns idiom the expression has become. A name the step before already had isn't repeated.
 */
export function chainNames(chain: Chain, upTo = chain.steps.length): Array<ChainName | null> {
  const v = views(chain, upTo);
  const out: Array<ChainName | null> = [];
  let last: string | null = null;
  for (let i = 0; i < v.length; i++) {
    const rule = RULES.find(r => r.test(v, i));
    let name: ChainName | null = rule ? { id: rule.id, name: rule.name, source: 'chain' } : null;
    if (!name) {
      const { expr } = inlineSteps(chain.steps.slice(0, i + 1), chain.seed.name);
      name = rootIdiom(expr, chain.seed.name, chain.seed.type);
    }
    out.push(name && name.id !== last ? name : null);
    last = name?.id ?? null;
  }
  return out;
}

/** What the chain is now: the name its last step gave it (or kept), if any. */
export function currentName(chain: Chain, upTo = chain.steps.length): ChainName | null {
  if (!upTo) return null;
  const v = views(chain, upTo);
  const i = v.length - 1;
  const rule = RULES.find(r => r.test(v, i));
  if (rule) return { id: rule.id, name: rule.name, source: 'chain' };
  const { expr } = inlineSteps(chain.steps.slice(0, upTo), chain.seed.name);
  return rootIdiom(expr, chain.seed.name, chain.seed.type);
}

/**
 * The usual finishing moves of what the chain has become, by family (where the order statistics are
 * thin). The ranking lifts these.
 */
export const FINISHING: Record<string, MoveFamily[]> = {
  'cell-repeat': ['offset', 'cell', 'distance', 'fold'],
  'centred-cells': ['distance', 'fold', 'clamp', 'rotate'],
  'cell-id': ['noise', 'colour', 'wave'],
  'grid-of-circles': ['mask', 'repeat', 'curve', 'colour'],
  'distance-field': ['mask', 'repeat', 'wave', 'curve', 'colour'],
  'rings': ['mask', 'colour', 'fold'],
  'soft-shape': ['colour', 'blend', 'curve'],
  'grid-of-dots': ['colour', 'blend', 'curve'],
  'domain-warp': ['distance', 'wave', 'colour', 'warp', 'couple', 'swizzle'],
  'kaleidoscope-fold': ['rotate', 'fold', 'repeat', 'distance'],
  'mirror-fold': ['rotate', 'offset', 'distance', 'fold'],
  'polar': ['repeat', 'wave', 'swizzle', 'fold'],
  'polar-repeat': ['offset', 'distance', 'fold'],
  'colour-by-space': ['curve', 'scale', 'blend'],
  'palette': ['curve', 'scale', 'blend'],
  'glow': ['colour', 'curve', 'clamp'],
  'stripes': ['mask', 'colour', 'curve'],
};

/** How much a finishing move is lifted (a factor on its chance of coming next). */
export const FINISH_BOOST = 2.5;

/** The lift for a pool's moves, for what the chain is called now. */
export function finishingBoost(name: ChainName | null, pool: readonly Move[]): Map<string, number> {
  const out = new Map<string, number>();
  const fams = name ? FINISHING[name.id] : undefined;
  if (!fams) return out;
  for (const m of pool) if (fams.includes(m.family)) out.set(m.id, FINISH_BOOST);
  return out;
}
