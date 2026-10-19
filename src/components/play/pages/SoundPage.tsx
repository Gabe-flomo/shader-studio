/**
 * The Sound rail page: the Audio engine's arrangement (engine/AudioEnginePanel.tsx)
 * with the takes under it (TakesSection.tsx, Play audit P8), and the effects
 * on the sound (finish/FinishPanel.tsx's sound view).
 */
import { useCan } from '../../../lib/plan';
import { AudioEnginePanel } from '../engine/AudioEnginePanel';
import { FinishPanel } from '../finish/FinishPanel';
import { LockedFinish } from './FinishPage';
import type { RailPageProps } from './shared';
import { TakesSection } from '../TakesSection';

/** The arrangement: racks of synths and effects, played live; the takes in a folded section under it. */
export function SoundArrangementPage({ play, onChange, touch, wide }: RailPageProps) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <AudioEnginePanel play={play} onChange={onChange} touch={touch} wide={wide} />
      <TakesSection touch={touch} />
    </div>
  );
}

/** Effects on each sound and the master. */
export function SoundEffectsPage({ play, onChange, touch, wide }: RailPageProps) {
  const finishOk = useCan('play.finish');
  return finishOk ? <FinishPanel play={play} onChange={onChange} touch={touch} wide={wide} only="sound" /> : <LockedFinish play={play} />;
}
