/**
 * corpus.ts — every Do… bar phrase and sentence there is (docs/playfield-language-plan.md §11.0):
 * the command corpus, every verb, action, connector, reference and recipe example in the
 * registry, the phrase corpus, every Grid Rules preset phrase (with and without slots) and the
 * 3D output phrases. Each entry names the graph it runs on and what is selected first.
 *
 * The goldens (goldens/do-bar.json) record what each one does today, as a graph digest; later
 * phases must give the same result through the new language (sugar → canonical → compile).
 */
import type { GraphNode } from '../../types/nodeGraph';
import { n } from '../../store/graphBuilder';
import { scratchGraph } from '../../suggestions/doScratch';
import { CORPUS as COMMAND_CORPUS } from '../../suggestions/__tests__/doCommandsCorpus';
import { CTX, CORPUS as PHRASE_CORPUS } from '../../suggestions/__tests__/doBarCorpus';
import { ACTIONS } from '../vocabulary';
import { COMMAND_VERBS, CONNECTORS, RECIPES, REFERENCE_FORMS, actionExamples, type ScratchId } from '../commands';
import { GRID_PHRASES } from '../../suggestions/doBarGridRules';

export interface CorpusEntry {
  text: string;
  /** Where it came from (for the golden's key and failure messages). */
  source: string;
  /** The graph it runs on (fresh each call). */
  graph: () => GraphNode[];
  selected: string[];
}

const scratch = (on: ScratchId) => () => scratchGraph(on);

function entries(): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  const add = (e: CorpusEntry) => { if (!out.some(x => x.text === e.text && x.source.split(':')[0] === e.source.split(':')[0] && JSON.stringify(x.selected) === JSON.stringify(e.selected) && x.graph().map(nd => nd.id).join() === e.graph().map(nd => nd.id).join())) out.push(e); };
  for (const [text, on, selected] of COMMAND_CORPUS) add({ text, source: `commands:${on}`, graph: scratch(on), selected: selected ?? [] });
  for (const v of COMMAND_VERBS) for (const x of v.examples) add({ text: x.text, source: `verb ${v.id}:${x.on}`, graph: scratch(x.on), selected: x.selected ?? [] });
  for (const a of ACTIONS) for (const x of actionExamples(a.id)) add({ text: x.text, source: `action ${a.id}:${x.on}`, graph: scratch(x.on), selected: x.selected ?? [] });
  for (const r of RECIPES) add({ text: r.text, source: `recipe ${r.id}:${r.on}`, graph: scratch(r.on), selected: [] });
  for (const c of CONNECTORS) {
    const on: ScratchId = c.example.includes('these') ? 'twoShapes' : 'mixed';
    add({ text: c.example, source: `connector:${on}`, graph: scratch(on), selected: c.example.includes('these') ? ['a', 'b'] : [] });
  }
  for (const r of REFERENCE_FORMS) {
    const on: ScratchId = r.example.includes('these') ? 'twoShapes' : r.example.includes('"Halo"') ? 'glow' : r.example.includes('circles') ? 'twoShapes' : r.example.includes('output') ? 'noise' : 'circle';
    add({ text: r.example, source: `reference:${on}`, graph: scratch(on), selected: r.example.includes('these') ? ['a', 'b'] : [] });
  }
  for (const [text, ctx] of PHRASE_CORPUS) add({ text, source: `phrase:${ctx}`, graph: () => CTX[ctx].nodes.map(nd => ({ ...nd })), selected: CTX[ctx].selected });
  const empty = () => [n('output', 'o', 900, 0)];
  for (const g of GRID_PHRASES) {
    add({ text: g.words[0], source: `grid ${g.id}:empty`, graph: empty, selected: [] });
    add({ text: `${g.words[0]} on a chunky board, fast, green on black`, source: `grid ${g.id} slots:empty`, graph: empty, selected: [] });
  }
  for (const text of ['output the depth', 'show the normals', 'colour it by distance with a palette', 'show the picture']) add({ text, source: 'output:noise', graph: scratch('noise'), selected: [] });
  return out;
}

export const LANGUAGE_CORPUS: readonly CorpusEntry[] = entries();
