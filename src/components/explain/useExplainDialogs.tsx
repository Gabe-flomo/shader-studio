/**
 * The Make-a-node and Where-else dialogs, for any editor that shows explanations: call
 * `makeNode(req)` / `findUses(query, title)` and render `dialogs` somewhere in the editor.
 * They open over the editor; Esc closes the one on top (Modal keeps a stack).
 */
import { useState, type ReactNode } from 'react';
import type { UseQuery } from '../../lib/glslPatterns';
import { MakeNodeDialog, type MakeNodeRequest } from './MakeNodeDialog';
import { FindUsesDialog } from './FindUsesDialog';

export function useExplainDialogs(opts: { onJumped?: () => void } = {}): {
  makeNode: (req: MakeNodeRequest) => void;
  findUses: (query: UseQuery, title: string) => void;
  dialogs: ReactNode;
} {
  const [make, setMake] = useState<MakeNodeRequest | null>(null);
  const [find, setFind] = useState<{ query: UseQuery; title: string } | null>(null);
  const dialogs = (
    <>
      {make && <MakeNodeDialog req={make} onClose={() => setMake(null)} onFindUses={(query, title) => setFind({ query, title })} />}
      {find && <FindUsesDialog query={find.query} title={find.title} onClose={() => setFind(null)} onJumped={() => { setMake(null); opts.onJumped?.(); }} />}
    </>
  );
  return { makeNode: setMake, findUses: (query, title) => setFind({ query, title }), dialogs };
}
