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
  /** Where the chain's output is connected now (the outlet, or a send). */
  routed: AudioNode | null;
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
    const slot: Slot = { ctx, chainId, inlet, outlet, analyser, chain: afCreateChain(ctx), pre: null, routed: null };
    inlet.connect(slot.chain.input);
    this.route(slot);
    this.slots.add(slot);
    this.apply(slot);
    return () => {
      if (!this.slots.delete(slot)) return;
      try { inlet.disconnect(slot.chain.input); } catch { /* already */ }
      if (analyser) { try { inlet.disconnect(analyser); } catch { /* not there */ } }
      if (slot.routed) { try { slot.chain.output.disconnect(slot.routed); } catch { /* already */ } }
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

  /**
   * Send a chain's sound elsewhere: every slot of `chainId` in `ctx` puts its
   * chain's output into `to` instead of its outlet (the Audio engine's send:
   * lib/engineSend.ts), or back into the outlet with null. The analyser keeps
   * reading. Slots attached later while a send is on are diverted too.
   */
  divert(ctx: BaseAudioContext, chainId: string, to: AudioNode | null): void {
    if (to) this.diverted.set(`${chainId}`, { ctx, to }); else this.diverted.delete(chainId);
    for (const s of this.slots) if (s.ctx === ctx && s.chainId === chainId) this.route(s);
  }

  private diverted = new Map<string, { ctx: BaseAudioContext; to: AudioNode }>();

  /** Where a slot's chain output goes now: its outlet, or the send it's diverted into. */
  private route(s: Slot): void {
    const d = this.diverted.get(s.chainId);
    const want = d && d.ctx === s.ctx ? d.to : s.outlet;
    if (s.routed === want) return;
    if (s.routed) { try { s.chain.output.disconnect(s.routed); } catch { /* not there */ } }
    if (want) s.chain.output.connect(want);
    s.routed = want;
  }

  /** Is this chain diverted (sent to the Audio engine) right now? */
  isDiverted(chainId: string): boolean { return this.diverted.has(chainId); }

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
