/**
 * echoTempo.ts — a synced Echo follows the setup's tempo (Play audit P9).
 *
 * An Echo with Sync on a note value (1/8, 1/4d…) used to show its own Tempo
 * slider, so "synced" meant synced to a number typed on the effect. Now a
 * synced Echo takes the setup's tempo: the arrangement's BPM (Sound →
 * Arrangement), else the Clock source's, else 120. The tempo is written into
 * the effect's own `bpm` (which the audio kit, renders and website exports
 * already read), so every place that plays the chain agrees; the panel hides
 * the slider while Sync is on. `syncEchoTempo` runs whenever the effects or
 * the arrangement's tempo change.
 */
import type { PlayRecord } from '../types/play';
import { recordBpm } from '../types/playArrangement';

/** The setup's tempo: the arrangement's, else the Clock source's, else 120. */
export function playTempo(p: Pick<PlayRecord, 'arrangement' | 'mappings'>): number {
  return p.arrangement?.bpm ?? recordBpm(p.mappings);
}

/** Is this effect an Echo synced to a note value? */
export function isSyncedEcho(e: { kind: string; sync?: unknown }): boolean {
  return e.kind === 'echo' && typeof e.sync === 'string' && e.sync !== 'off';
}

/** Every synced Echo's tempo set to the setup's. The same record when nothing changes. */
export function syncEchoTempo<P extends PlayRecord>(p: P): P {
  const fx = p.audioFx;
  if (!fx) return p;
  const bpm = playTempo(p);
  let changed = false;
  const chains: typeof fx.chains = {};
  for (const [id, c] of Object.entries(fx.chains)) {
    const effects = c.effects.map(e => {
      if (!isSyncedEcho(e) || e.bpm === bpm) return e;
      changed = true;
      return { ...e, bpm };
    });
    chains[id] = effects.some((e, i) => e !== c.effects[i]) ? { ...c, effects } : c;
  }
  return changed ? { ...p, audioFx: { ...fx, chains } } : p;
}
