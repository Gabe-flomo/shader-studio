/**
 * explain.ts — names and phrases for patterns (docs/code-explorer-plan.md §8.1).
 *
 * The shared pattern library (`src/lib/glslPatterns/`, docs/expression-explainer.md) owns
 * names, phrases and "Make a node from this"; the Explorer only reads it. A pattern card is
 * explained through one of its real instances: the library's explainer reads the call, and
 * when an idiom matches the whole call the card takes the idiom's name; the plain-words
 * sentence is the phrase either way. Nothing here is generated: names are the library's
 * curated idioms, sentences its deterministic explainer.
 *
 * `registerPatternExplainer` lets another source (a user's named patterns) answer first.
 */
import { explainExpression, idiomById, idiomVocabulary } from '../lib/glslPatterns';

export interface PatternQuery {
  callee: string;
  /** L2 argument shape: `smoothstep(#, #, length(…))`. */
  l2: string;
  /** L1 exact shape, when asking about one variant. */
  l1?: string;
  /** A real instance's call, as written (`smoothstep(0.22, 0.28, length(cuv))`). */
  sample?: string;
}

export interface PatternInfo {
  /** The library idiom's id, when one matches the whole call. */
  id?: string;
  /** The idiom's name ("soft circle"); absent when no idiom matches the whole call. */
  name?: string;
  /** What the instance does, in plain words (the explainer's sentence). */
  phrase?: string;
  /** Search words: the idiom's name, function name and keywords. */
  words?: string[];
  from: 'library' | 'registered';
}

export interface PatternExplainer {
  explain(q: PatternQuery): PatternInfo | null;
}

const VOCAB = new Map(idiomVocabulary().map(v => [v.id, v.words]));
const cache = new Map<string, PatternInfo | null>();

export const libraryExplainer: PatternExplainer = {
  explain(q) {
    const code = q.sample?.trim();
    if (!code) return null;
    const hit = cache.get(code);
    if (hit !== undefined) return hit;
    let info: PatternInfo | null = null;
    try {
      const ex = explainExpression(code);
      if (ex.ok) {
        // An idiom matching the whole call names the card; one inside it only lends search words.
        const root = ex.idioms.find(h => h.node.start <= ex.root.start && h.node.end >= ex.root.end);
        const words = ex.idioms.flatMap(h => VOCAB.get(h.idiom.id) ?? []);
        info = { from: 'library', phrase: ex.sentence, words };
        if (root) { info.id = root.idiom.id; info.name = root.idiom.name; }
      }
    } catch { info = null; }
    if (cache.size > 5000) cache.clear();
    cache.set(code, info);
    return info;
  },
};

let registered: PatternExplainer | null = null;

/** Another explainer to ask first (the library still answers what it doesn't know). */
export function registerPatternExplainer(e: PatternExplainer | null): void { registered = e; }

export function explainPattern(q: PatternQuery): PatternInfo | null {
  return registered?.explain(q) ?? libraryExplainer.explain(q);
}

export { idiomById };
