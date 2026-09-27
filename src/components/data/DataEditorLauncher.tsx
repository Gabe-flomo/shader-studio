/**
 * The Data card body with its own editor (a sheet on phones): what the mobile
 * node view shows for a Data node, where the desktop card's editor button
 * isn't available.
 */
import { useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { DataEditor as DataEditorT } from './DataEditor';
import { DataCardBody } from './DataCardBody';

const DataEditor = lazyWithSuspense<PropsOf<typeof DataEditorT>>(() => import('./DataEditor').then(m => ({ default: m.DataEditor })));

export function DataEditorLauncher({ node }: { node: GraphNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DataCardBody node={node} touch onOpen={() => setOpen(true)} />
      {open && <DataEditor node={node} onClose={() => setOpen(false)} />}
    </>
  );
}
