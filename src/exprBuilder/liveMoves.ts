/**
 * liveMoves.ts — the move catalogue in the app: the prebuilt examples plus the user's own code,
 * kept current through the Code explorer's sync (codeExplorer/client.ts `onCorpusCollected`).
 *
 * Cheap until asked: a sync only records the latest doc set of each kind; the mining happens when
 * `liveCatalogue()` is called (the builder window opening, phase 2), and then only for docs that
 * changed. Nothing is sent anywhere: the user's code is mined in memory on this device.
 */
import { onCorpusCollected, startExplorer, syncLinked, syncUser, type CorpusKind } from '../codeExplorer/client';
import type { DocInput } from '../codeExplorer/types';
import { localKV } from '../utils/library';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { loadPrebuiltCatalogue } from './exampleMoves';
import { graphForDoc, LocalMoves } from './localMoves';
import { setActiveCatalogue, type Catalogue } from './moves';

const pending = new Map<CorpusKind, { prefixes: readonly string[]; docs: readonly DocInput[] }>();
let local: LocalMoves | null = null;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  onCorpusCollected((kind, prefixes, docs) => {
    // The examples ship prebuilt (a test keeps that file current).
    if (kind !== 'examples') pending.set(kind, { prefixes, docs });
  });
}

/** The catalogue with the user's code in it (and `movesFor`'s default from then on). */
export async function liveCatalogue(): Promise<Catalogue> {
  if (!local) {
    listen();
    await startExplorer();
    // Heard nothing yet (the index synced before we listened): ask for the user's docs again.
    if (!pending.has('user')) await syncUser();
    if (!pending.has('linked')) await syncLinked();
    local = new LocalMoves(await loadPrebuiltCatalogue());
  }
  const open = { nodes: useNodeGraphStore.getState().nodes, label: 'Open graph' };
  for (const [kind, { prefixes, docs }] of pending) {
    local.sync(prefixes, docs.map(doc => {
      const nodes = graphForDoc(doc.docId, localKV, open);
      return nodes ? { doc, nodes } : { doc };
    }));
    pending.delete(kind);
  }
  const cat = local.catalogue();
  setActiveCatalogue(cat);
  return cat;
}
