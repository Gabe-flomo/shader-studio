/**
 * tasteNav.ts — asking the Files page for its Taste view (docs/taste.md "The Taste page"), from the Do bar's
 * taste panel or App settings; and opening what a signal-log entry was about (an item, a seed).
 */
import { requestPage } from '../page';
import type { SignalRef } from '../../taste/log';

/** Ask the Files page to show the Taste view (read when it opens, or heard when it's open). */
export const OPEN_TASTE_VIEW = 'open-taste-view';
let wanted = false;
export function openTastePage(): void {
  wanted = true;
  window.dispatchEvent(new Event('open-files-page'));
  window.dispatchEvent(new Event(OPEN_TASTE_VIEW));
}
export function takeTasteViewRequest(): boolean { const w = wanted; wanted = false; return w; }

const OPENABLE = /^(saved|example|shader|preset|example-convert):/;

/** Whether a log entry can be opened: an item that's here, or a seed. */
export function canOpenRef(ref: SignalRef | undefined): boolean {
  if (!ref || ref.foreign) return false;
  return (!!ref.item && OPENABLE.test(ref.item)) || ref.seed != null;
}

/** Open what a log entry was about: the graph, example or shader; else its seed again (Surprise or Evolve). */
export async function openRef(ref: SignalRef): Promise<void> {
  if (ref.item && OPENABLE.test(ref.item)) {
    const { openSource } = await import('../surprise/inspiredAction');
    openSource({ id: ref.item, label: ref.label ?? ref.item, what: [], at: [] });
    return;
  }
  if (ref.seed == null) return;
  requestPage('studio');
  if (ref.via === 'evolve') { const { startEvolveSession } = await import('../surprise/evolveAction'); await startEvolveSession(ref.seed); return; }
  const { inspiredSurprise } = await import('../surprise/inspiredAction');
  await inspiredSurprise({ seed: ref.seed });
}
