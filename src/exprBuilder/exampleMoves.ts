/**
 * exampleMoves.ts — the bundled examples as move docs, and the prebuilt catalogue made from them.
 *
 * The docs are exactly the Code explorer's (bundledExampleDocs: every example graph's written code,
 * and the Convert page's example shaders), each with its graph for context. The catalogue ships as
 * compact JSON (pack.ts) in prebuilt/moves.json, written by src/exprBuilder/__tests__/prebuilt.test.ts
 * the way the Code explorer writes its examples.json:
 *
 *   EXPR_BUILDER_WRITE=1 npx vitest run src/exprBuilder/__tests__/prebuilt.test.ts
 *
 * Its `hash` covers the examples' code, their graphs and MOVES_SCHEMA, and the test fails when it
 * is out of date.
 */
import { bundledExampleDocs } from '../codeExplorer/exampleCorpus';
import { docVersion, hashText } from '../codeExplorer/extract';
import { buildCatalogue, MOVES_SCHEMA, type Catalogue, type MoveDoc } from './moves';
import { packCatalogue, unpackCatalogue, type PackedCatalogue } from './pack';

type Graphs = Record<string, { label: string; nodes: unknown }>;

export function exampleMoveDocs(graphs: Graphs, nodeLabel?: (type: string) => string | undefined): MoveDoc[] {
  return bundledExampleDocs(graphs, nodeLabel).map(doc => {
    const key = doc.docId.startsWith('example:') ? doc.docId.slice('example:'.length) : null;
    const nodes = key ? graphs[key]?.nodes : undefined;
    return { doc, ...(Array.isArray(nodes) ? { nodes } : {}) } as MoveDoc;
  });
}

/** A hash of everything the catalogue is made from. */
export function catalogueHash(docs: readonly MoveDoc[]): string {
  return hashText(JSON.stringify([MOVES_SCHEMA, docs.map(d => [d.doc.docId, docVersion(d.doc), d.nodes ? hashText(JSON.stringify(d.nodes)) : ''])]));
}

export function buildPrebuilt(graphs: Graphs, nodeLabel?: (type: string) => string | undefined): PackedCatalogue {
  const docs = exampleMoveDocs(graphs, nodeLabel);
  return packCatalogue(buildCatalogue(docs), catalogueHash(docs));
}

let prebuilt: Promise<Catalogue | null> | null = null;

/** The shipped catalogue (a lazy chunk), or null when it can't be read or is of an old schema. */
export function loadPrebuiltCatalogue(): Promise<Catalogue | null> {
  return (prebuilt ??= import('./prebuilt/moves.json')
    .then(m => {
      const p = (m.default ?? m) as unknown as PackedCatalogue;
      return p.schema === MOVES_SCHEMA ? unpackCatalogue(p) : null;
    })
    .catch(() => null));
}
