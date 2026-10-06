/**
 * idiomBlocks.ts — the explainer's shader idioms (lib/glslPatterns) in the Do… bar: typing an
 * idiom's name or words ("sine hash", "centre uv", "soft circle", "cosine palette") offers it, and
 * picking it adds an Expression Block that computes it, its holes as the block's inputs.
 *
 * The block is the idiom's first spelling: each `$hole` becomes an input (typed from the idiom's
 * hole spec, else from its name), each `#number` hole a literal (the classic constants where the
 * idiom names them, else 1.0). The result type is inferred from the expression; idioms whose
 * type can't be worked out are not offered.
 */
import type { GraphNode } from '../types/nodeGraph';
import { IDIOMS, idiomVocabulary, inferTypes, parseExpr, type Idiom } from '../lib/glslPatterns';
import { editDistance, fuzzBudget, tokenize } from '../lang/vocabulary';
import { exprBlock } from './moves';

type T = 'float' | 'vec2' | 'vec3';
const LITERALS: Record<string, Record<string, string>> = {
  'hash-sin-dot': { a: '127.1', b: '311.7', k: '43758.5453' },
  'hash-sin': { k: '43758.5453' },
};
const toT = (t: string | undefined): T | null => (t === 'float' || t === 'int' ? 'float' : t === 'vec2' ? 'vec2' : t === 'vec3' || t === 'vec4' ? 'vec3' : null);

export interface IdiomBlockSpec { idiom: Idiom; inputs: Array<{ name: string; type: T }>; result: string; outputType: T }

/** How an idiom becomes an Expression Block, or null when its types can't be worked out. */
export function idiomBlockSpec(idiom: Idiom): IdiomBlockSpec | null {
  const pattern = idiom.patterns[0];
  const inputs: Array<{ name: string; type: T }> = [];
  const names = new Map<string, string>();
  for (const m of pattern.matchAll(/\$([A-Za-z_]\w*)/g)) {
    const hole = m[1];
    if (names.has(hole)) continue;
    const spec = idiom.holes?.[hole];
    const name = (spec?.input ?? hole).replace(/[^A-Za-z0-9_]/g, '') || hole;
    const guess: T = /^(p|uv|q|v|z)$/.test(hole) ? 'vec2' : hole === 'c' && idiom.category === 'colour' ? 'vec3' : 'float';
    const type = toT(spec?.types?.[0]) ?? guess;
    names.set(hole, name);
    if (!inputs.some(i => i.name === name)) inputs.push({ name, type });
  }
  const lit = LITERALS[idiom.id] ?? {};
  const result = pattern
    .replace(/\$([A-Za-z_]\w*)/g, (_, h: string) => names.get(h) ?? h)
    .replace(/#([A-Za-z_]\w*)/g, (_, h: string) => lit[h] ?? '1.0');
  const parsed = parseExpr(result);
  if (!parsed.ok) return null;
  const env = Object.fromEntries(inputs.map(i => [i.name, i.type]));
  const outputType = toT(inferTypes(parsed.expr, env).get(parsed.expr.id));
  if (!outputType) return null;
  return { idiom, inputs, result, outputType };
}

/** The Expression Block for an idiom, at (x, y). */
export function idiomBlock(spec: IdiomBlockSpec, id: string, x: number, y: number): GraphNode {
  return exprBlock(id, x, y, {
    label: spec.idiom.name,
    inputs: spec.inputs.map(i => ({ name: i.name, type: i.type })),
    result: spec.result,
    outputType: spec.outputType,
    comment: `${spec.idiom.name} (Expression Block): ${spec.result}\nWhy: added from the Do… bar. Wire its inputs (${spec.inputs.map(i => i.name).join(', ') || 'none'}); the explainer (Explain on the block) says what each part does.`,
  });
}

let specs: IdiomBlockSpec[] | null = null;
/** Every idiom that can be a block. */
export function idiomSpecs(): IdiomBlockSpec[] {
  return (specs ??= IDIOMS.map(idiomBlockSpec).filter((s): s is IdiomBlockSpec => !!s));
}

/** Idioms a phrase names, best first (name, then its words; small typos allowed). */
export function matchIdioms(text: string, limit = 4): IdiomBlockSpec[] {
  const tokens = tokenize(text).filter(t => t.length > 2);
  if (!tokens.length) return [];
  const q = text.trim().toLowerCase();
  const vocab = new Map(idiomVocabulary().map(v => [v.id, v]));
  const scored = idiomSpecs().map(s => {
    const v = vocab.get(s.idiom.id)!;
    const name = v.name.toLowerCase();
    let score = name === q ? 10 : name.startsWith(q) ? 6 : 0;
    for (const t of tokens) {
      if (v.words.some(w => w.toLowerCase() === t)) score += 2;
      else if (name.split(/\W+/).some(w => w === t || (fuzzBudget(w) > 0 && editDistance(w, t, fuzzBudget(w)) <= fuzzBudget(w)))) score += 1.5;
    }
    return { s, score };
  });
  return scored.filter(x => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.s);
}
