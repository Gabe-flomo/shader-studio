/**
 * startOver.ts — "Start over": empty the whole Play record (docs: the Play
 * page header's ⋯ menu and the Layers page header), after a confirm the call
 * site asks for. Everything isPlayRecordEmpty checks goes: layers, controls,
 * mappings, actions, signals, pairs, Finish (Picture and Sound), the audio
 * engine's racks and tape, drum pads, projection, the split view's own
 * selection. One undo step; the Studio graph is untouched.
 *
 * Any playing audio or tape is stopped first, so nothing keeps sounding once
 * the racks and tape that made it are gone.
 */
import { tape, useTape } from '../lib/tape';
import { useTakes } from '../lib/takes';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { emptyPlayRecord } from '../types/play';
import { usePlayUi } from '../components/play/playUi';
import { askConfirm } from '../components/ui/dialogStore';
import type { MenuItem } from '../components/ui/Menu';

/** Empty the whole Play record as one undo step. Call after the user has confirmed. */
export function startOverPlay(): void {
  // A take recording or replaying: cancel rather than keep it, since play.takes is about to go too.
  const tk = useTakes.getState();
  if (tk.phase === 'recording' || tk.phase === 'countdown') tk.cancel();
  else if (tk.phase === 'replay') tk.endReplay();
  // The engine's tape, if it's running.
  if (useTape.getState().phase !== 'stopped') tape.stop();
  const ui = usePlayUi.getState();
  ui.select('');
  ui.enter('');
  useNodeGraphStore.getState().setPlay(emptyPlayRecord(), { label: 'Started over' });
}

/** Confirm, then start over. Shared by the Play page's and the Layers page's ⋯ menu. */
export async function confirmStartOverPlay(): Promise<void> {
  const ok = await askConfirm('Clear everything on Play?', {
    message: 'Layers, controls, mappings, effects and the engine. You can undo.',
    confirmLabel: 'Start over',
    danger: true,
  });
  if (ok) startOverPlay();
}

/** The "Start over" menu item, for a ⋯ menu (closes it first, then asks and clears). */
export function startOverMenuItem(onClose: () => void): MenuItem {
  return { label: 'Start over…', icon: 'trash', danger: true, hint: 'Empty layers, controls, effects and the engine', onSelect: () => { onClose(); void confirmStartOverPlay(); } };
}
