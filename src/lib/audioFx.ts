/**
 * audioFx.ts — the app's audio effect chains, live. Every place a sound is
 * made attaches a slot here: its context, the chain it goes through (see
 * types/playAudioFx.ts), where the sound comes in, where it goes out, and the
 * analyser that reads it (the audio readers, audio layers, Audio Input
 * uniforms). Each frame (ShaderCanvas) `frame` hands every slot's chain the
 * record and the driven numbers; the kit (play/kit/audioFx.js) rebuilds only
 * when the chain's shape changed and otherwise glides the numbers.
 *
 *   inlet ─→ chain ─→ outlet
 *     └─(pre)   └─(post, default)─→ analyser
 *
 * The master chain is a slot per context: the audio engine's mix bus (songs,
 * video sound), the tone synth's own context, and the test loop's.
 *
 * Plan: the chains run on Pro (`play.audioFx`); on Free every slot is
 * straight through (the record keeps its effects).
 */
import { afCreateChain, afLoadWorklet, afNeedsWorklet, type AfChain, type AfEffect } from '../play/kit/audioFx.js';
import { audioFxPropId, type PlayAudioFx } from '../types/playAudioFx';
import { can } from './plan';

export type ValueOf = (propId: string, key: string, base: number) => number;

interface Slot {
  ctx: BaseAudioContext;
  chainId: string;
  inlet: AudioNode;
  outlet: AudioNode | null;
  analyser: AnalyserNode | null;
  chain: AfChain;
  /** Where the analyser was last wired (null: not yet). */
  pre: boolean | null;
}

const plain: ValueOf = (_id, _key, base) => base;

class AudioFxHost {
  private slots = new Set<Slot>();
  private fx: PlayAudioFx | undefined;
  private valueOf: ValueOf = plain;
  private loading = new WeakSet<BaseAudioContext>();

  /**
   * Put `chainId`'s chain between `inlet` and `outlet` (null: nowhere, for a
   * sound that is only analysed) and tap `analyser`. Returns the way to take
   * it out again (inlet and analyser are left disconnected).
   */
  attach(ctx: BaseAudioContext, chainId: string, inlet: AudioNode, outlet: AudioNode | null, analyser: AnalyserNode | null = null): () => void {
    const slot: Slot = { ctx, chainId, inlet, outlet, analyser, chain: afCreateChain(ctx), pre: null };
    inlet.connect(slot.chain.input);
    if (outlet) slot.chain.output.connect(outlet);
    this.slots.add(slot);
    this.apply(slot);
    return () => {
      if (!this.slots.delete(slot)) return;
      try { inlet.disconnect(slot.chain.input); } catch { /* already */ }
      if (analyser) { try { inlet.disconnect(analyser); } catch { /* not there */ } }
      slot.chain.dispose();
    };
  }

  /** The record's effects (none on Free) and how numbers are driven now; call every frame. */
  frame(fx: PlayAudioFx | undefined, valueOf: ValueOf = plain): void {
    this.fx = fx && can('play.audioFx') ? fx : undefined;
    this.valueOf = valueOf;
    for (const s of this.slots) this.apply(s);
  }

  /** The chains a context has slots for right now (tests, the panel). */
  chainIds(): string[] { return [...new Set([...this.slots].map(s => s.chainId))]; }

  private apply(s: Slot): void {
    const fx = this.fx;
    const chain = fx?.chains[s.chainId];
    if (chain && afNeedsWorklet([chain]) && !this.loading.has(s.ctx)) {
      this.loading.add(s.ctx);
      void afLoadWorklet(s.ctx);
    }
    const id = s.chainId, vo = this.valueOf;
    s.chain.update(chain, (e: AfEffect, key: string) => {
      const base = typeof e[key] === 'number' ? e[key] as number : 0;
      return vo(audioFxPropId(id, e.id), key, base);
    }, s.ctx.currentTime);
    const pre = fx?.analyse === 'pre';
    if (s.analyser && s.pre !== pre) {
      if (s.pre !== null) {
        try { (s.pre ? s.inlet : s.chain.output).disconnect(s.analyser); } catch { /* not there */ }
      }
      (pre ? s.inlet : s.chain.output).connect(s.analyser);
      s.pre = pre;
    }
  }
}

export const audioFxHost = new AudioFxHost();
