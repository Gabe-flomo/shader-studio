/**
 * audioFxOffline.ts — the audio effect chains in an offline mix (a video
 * render's sound, recordingAudio.ts mixdown), built by the same kit code as
 * playback (play/kit/audioFx.js) so a render sounds like what played.
 *
 * Each sound goes into its own chain, every chain into the master chain, the
 * master chain into the destination. The numbers start where they are now
 * (or where a take had them at its start) and follow the take's recorded
 * values through the render: every AUTOMATION_STEP seconds each number that
 * moved is scheduled with the same smoothing as live. Reverb size and decay
 * and the bitcrusher's bits rebuild an impulse response or a curve rather than
 * move a parameter, so a render keeps their starting values.
 */
import { afCreateChain, afLoadWorklet, afNeedsWorklet, type AfChain, type AfEffect } from '../play/kit/audioFx.js';
import { audioFxPropId, MASTER_CHAIN, type AudioFxChain, type PlayAudioFx } from '../types/playAudioFx';
import { parsePropTarget } from '../types/play';
import type { PlayTake, TakeTrack } from '../types/play';
import { trackAt } from './takePlayback';

export const AUTOMATION_STEP = 1 / 50;

/** A number `t` seconds into the mix: (the effect's prop id, its key, the record's value, t). */
export type ValueAt = (propId: string, key: string, base: number, t: number) => number;

export interface OfflineFx {
  /**
   * Where a sound on `chainId` goes in: its chain (made on first ask) into the
   * master chain, or with `tail`, a chain of its own into `tail` and on into
   * the master chain (a Video layer's volume comes after its effects).
   */
  input(chainId: string, tail?: AudioNode): AudioNode;
}

/**
 * The numbers through a render: a take's recorded values where it has them
 * (clock time `from` + t), else `now` (the live value, or the record's).
 */
export function takeValueAt(take: PlayTake | null | undefined, from: number, now: (propId: string, key: string, base: number) => number = (_i, _k, b) => b): ValueAt {
  const tracks = new Map<string, TakeTrack>();
  // Audio effect numbers and layer numbers (a drum pad's pitch): keyed by prop id and key, as asked.
  for (const tr of take?.tracks ?? []) {
    const pt = tr.kind === 'control' && tr.target ? parsePropTarget(tr.target) : null;
    if (pt) tracks.set(`${pt.layerId}::${pt.key}`, tr);
  }
  if (!take || !tracks.size) return (id, key, base) => now(id, key, base);
  return (id, key, base, t) => {
    const tr = tracks.get(`${id}::${key}`);
    if (!tr) return now(id, key, base);
    const v = trackAt(tr, from + t - take.from);
    return typeof v === 'number' ? v : v[0];
  };
}

function automate(chain: AfChain, chainId: string, rec: AudioFxChain | undefined, length: number, valueAt: ValueAt): void {
  const at = (t: number) => (e: AfEffect, key: string) => valueAt(audioFxPropId(chainId, e.id), key, typeof e[key] === 'number' ? e[key] as number : 0, t);
  chain.update(rec, at(0), null);
  if (!rec?.on || !rec.effects.some(e => e.enabled)) return;
  for (let t = AUTOMATION_STEP; t < length; t += AUTOMATION_STEP) chain.update(rec, at(t), t);
}

/** Build the chains of `fx` in an offline context, ending in its destination. */
export async function offlineFx(ctx: OfflineAudioContext, fx: PlayAudioFx | undefined, length: number, valueAt: ValueAt = (_i, _k, b) => b): Promise<OfflineFx> {
  if (fx && afNeedsWorklet(Object.values(fx.chains))) await afLoadWorklet(ctx);
  const master = afCreateChain(ctx);
  master.output.connect(ctx.destination);
  automate(master, MASTER_CHAIN, fx?.chains[MASTER_CHAIN], length, valueAt);
  const made = new Map<string, AfChain>();
  return {
    input(chainId: string, tail?: AudioNode): AudioNode {
      if (chainId === MASTER_CHAIN) {
        if (!tail) return master.input;
        tail.connect(master.input);
        return tail;
      }
      let c = tail ? undefined : made.get(chainId);
      if (!c) {
        c = afCreateChain(ctx);
        if (tail) { c.output.connect(tail); tail.connect(master.input); } else c.output.connect(master.input);
        automate(c, chainId, fx?.chains[chainId], length, valueAt);
        if (!tail) made.set(chainId, c);
      }
      return c.input;
    },
  };
}
