/**
 * resetOnGraphLoad.ts — a newly opened graph starts the Play page on each
 * section's primary page (Controls, Layers, Picture, Arrangement), not on
 * whatever sub-page the last graph was left on (its MIDI file, its
 * Background). The rail keeps its category and the panel its size; only
 * the sub-page, the remembered sub-page per category, the phone's picked
 * page, the Finish view and the old graph's layer selection go.
 *
 * Fires on every graph swap (graphEpoch: an example, a saved graph, an
 * imported file), but not while the Code page previews a conversion
 * (`scratch`): that isn't a new graph yet.
 */
import { useEffect } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { usePlaySplit } from './playSplit';
import { usePlayUi } from './playUi';
import { categoryOf, firstPageOf } from './railPages';

export function resetPlayPagesForNewGraph(): void {
  const split = usePlaySplit.getState();
  const primary = firstPageOf(categoryOf(split.railPage));
  usePlaySplit.setState({ railPageMemory: {} });
  usePlaySplit.getState().setRailPage(primary);
  usePlayUi.setState({ phonePage: '', finishView: 'picture', entered: '', selected: '', mask: '' });
}

/** Mounted once (App). */
export function usePlayResetOnGraphLoad(): void {
  useEffect(() => useNodeGraphStore.subscribe((s, prev) => {
    if (s.graphEpoch !== prev.graphEpoch && !s.scratch) resetPlayPagesForNewGraph();
  }), []);
}
