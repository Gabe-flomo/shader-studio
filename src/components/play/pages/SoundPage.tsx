/**
 * The Sound rail page: the Audio engine's arrangement (engine/AudioEnginePanel.tsx)
 * and the effects on the sound (finish/FinishPanel.tsx's sound view).
 */
import { useCan } from '../../../lib/plan';
import { AudioEnginePanel } from '../engine/AudioEnginePanel';
import { FinishPanel } from '../finish/FinishPanel';
import { LockedFinish } from './FinishPage';
import type { RailPageProps } from './shared';

/** The arrangement: racks of synths and effects, played live. */
export function SoundArrangementPage({ play, onChange, touch, wide }: RailPageProps) {
  return <AudioEnginePanel play={play} onChange={onChange} touch={touch} wide={wide} />;
}

/** Effects on each sound and the master. */
export function SoundEffectsPage({ play, onChange, touch, wide }: RailPageProps) {
  const finishOk = useCan('play.finish');
  return finishOk ? <FinishPanel play={play} onChange={onChange} touch={touch} wide={wide} only="sound" /> : <LockedFinish play={play} />;
}
