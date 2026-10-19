/**
 * phoneTrim.ts — what the phone's Play page leaves out (user decisions
 * 2026-10-18; docs/split-view.md, "Phones"). Phone only: the stacked Play
 * layout (a phone, or a window under 600px: lib/viewport.ts playStacked).
 * Desktop and tablet keep everything.
 *
 * - Picture sizes: only Free and 1:1. A setup or device that saved another
 *   shape shows as Free on a phone; the saved shape isn't rewritten unless
 *   the phone picks one.
 * - Sound: no Arrangement, Audio engine, Granulator, MIDI synth or tracks.
 *   What's left is the Sampler (to upload sounds, which readers can hear),
 *   the effects, and the readers. A setup that has the desktop's sound
 *   features still plays them on a phone; it just can't edit them there.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { playStacked, useViewport } from '../../lib/viewport';
import { PREVIEW_ASPECTS, type PreviewAspect } from '../../utils/graphImportPlan';
import type { PlayRecord } from '../../types/play';
import { usePlayUi } from './playUi';

/** The picture sizes a phone offers. */
export const PHONE_ASPECTS: readonly PreviewAspect[] = ['free', '1:1'];

/** The size a phone shows for a saved one: 1:1 stays, everything else is Free. */
export function phoneAspect(a: PreviewAspect): PreviewAspect {
  return a === '1:1' ? '1:1' : 'free';
}

/** The size choices to offer: a phone's two, or every one. */
export function aspectChoices(phone: boolean): typeof PREVIEW_ASPECTS {
  return phone ? PREVIEW_ASPECTS.filter(a => PHONE_ASPECTS.includes(a.id)) : PREVIEW_ASPECTS;
}

/** The phone's Play page is showing: the stacked layout, with Play open. */
export function usePhonePlay(): boolean {
  const stacked = useViewport(playStacked);
  const performing = usePlayUi(s => s.performing);
  return stacked && performing;
}

/** The picture size in effect: the saved one, or on a phone's Play page its phone size. */
export function useShownAspect(): PreviewAspect {
  const saved = useNodeGraphStore(s => s.previewAspect);
  return usePhonePlay() ? phoneAspect(saved) : saved;
}

/** Layer kinds a phone's Add layer leaves out: the sound ones, except the Sampler (addLayerCatalog.ts). */
export { PHONE_HIDDEN_LAYER_KINDS } from './layers/addLayerCatalog';

/**
 * What a setup has of the desktop's sound features (the Audio engine's racks
 * and tracks): they play on a phone, but are edited on a computer. Empty when
 * there's nothing to say.
 */
export function desktopSoundNote(p: PlayRecord): string {
  const racks = p.audioEngine?.racks.length ?? 0;
  if (!racks) return '';
  return `This setup’s Audio engine (${racks} rack${racks === 1 ? '' : 's'}) still plays here, as in any browser. Its arrangement is edited on a computer.`;
}
