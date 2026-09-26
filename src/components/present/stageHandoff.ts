/**
 * stageHandoff — a Present canvas onto the Stage. The Stage normally shows
 * the open graph; a canvas here is a snapshot, so the Stage runs the
 * snapshot's own exported page in Exact (the same page "Put it on a website"
 * would build from it, with this step's Script edits), sandboxed when the
 * presentation came from a file and has Script layers.
 */
import { leftBehind } from '../../play/exportHtml';
import { snapshotStagePage, stepScriptEdits } from '../../present/liveScript';
import { sourceLimits } from '../../present/snapshot';
import type { Presentation, PresentSource, Step } from '../../types/presentation';
import { useStage } from '../play/stageStore';

export function openOnStage(doc: Presentation, source: PresentSource, step: Step | undefined): void {
  const edits = stepScriptEdits(step).get(source.id);
  const hasScript = source.bundle.play.layers.some(l => l.kind === 'script');
  useStage.getState().openSnapshot({
    title: source.title,
    presentation: doc.title,
    capturedAt: source.capturedAt,
    html: snapshotStagePage(source, edits),
    sandboxed: doc.origin === 'imported' && hasScript,
    edited: !!edits && Object.keys(edits).length > 0,
    play: source.bundle.play,
    missing: sourceLimits(source),
    left: leftBehind(source.bundle.play, source.bundle.media).filter(l => !/notes/i.test(l.what)),
  });
}
