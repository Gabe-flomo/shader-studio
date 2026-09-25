/**
 * inputBus.ts — the one per-frame hook for JS-side signals that drive
 * uniforms (MIDI nodes and Play mappings now; audio and envelopes later).
 *
 * The render loop asks the bus once per frame for `uniform name → value` and
 * writes what it gets. Sources never see uniform names: they write by a
 * channel key and the bus translates it, so slugs and renames can't break a
 * binding. Two kinds of channel key exist:
 *
 *   - `${nodeId}::${channel}` — a live node output (MIDI Input's `note`…),
 *     translated through the compiler's `liveUniforms` map.
 *   - `param:${nodeId}::${paramKey}` — a slider or colour param, translated
 *     through the compiler's `paramBindings` map. This is what Play mappings
 *     write: a knob turning is a uniform write, nothing more.
 *
 * Module singleton, no React, no store. No allocation per frame: the result
 * map is reused and the writer closure is created once. A vec3 value is an
 * array the source owns and mutates in place.
 */

export type InputValue = number | number[];
export type InputWriter = (channelKey: string, value: InputValue) => void;

export interface InputSource {
  /**
   * Called once per rendered frame. `dt` is seconds since the last frame,
   * `time` the graph clock. Write every channel the source owns; a channel
   * with no binding in the current shader is dropped silently.
   */
  tickInputs(dt: number, time: number, write: InputWriter): void;
  /** Tick even when the shader binds nothing (the Play engine: actions, layer mappings). */
  wantsTick?(): boolean;
}

const PARAM_PREFIX = 'param:';

/** Channel key for a param target (`nodeId::paramKey`, the compiler's binding key). */
export function paramChannelKey(bindingKey: string): string {
  return PARAM_PREFIX + bindingKey;
}

class InputBus {
  private sources = new Set<InputSource>();
  /** channel key → uniform name (reverse of the compiler's liveUniforms + prefixed paramBindings). */
  private live = new Map<string, string>();
  private params = new Map<string, string>();
  private result = new Map<string, InputValue>();
  /** Last frame's scalar values, to tell "a value moved" from "a value was written again". */
  private previous = new Map<string, number>();
  private moved = false;
  private writer: InputWriter = (channelKey, value) => {
    const uniform = this.live.get(channelKey) ?? this.params.get(channelKey);
    if (uniform !== undefined) this.result.set(uniform, value);
  };

  private wakeListeners = new Set<() => void>();

  /**
   * The render loop sleeps when nothing moves and the clock is paused. A
   * source calls `wake()` when an input arrives (a MIDI message, a key, the
   * pointer) so the loop runs a frame and the change shows.
   */
  onWake(cb: () => void): () => void {
    this.wakeListeners.add(cb);
    return () => { this.wakeListeners.delete(cb); };
  }

  wake(): void {
    for (const cb of this.wakeListeners) cb();
  }

  addSource(source: InputSource): () => void {
    this.sources.add(source);
    return () => { this.sources.delete(source); };
  }

  /** Take the compiler's `uniform name → channel key` map from the last compile. */
  setBindings(liveUniforms: Record<string, string>): void {
    this.live.clear();
    for (const [uniform, channelKey] of Object.entries(liveUniforms)) this.live.set(channelKey, uniform);
  }

  /** Take the compiler's `nodeId::paramKey → uniform name` map from the last compile. */
  setParamBindings(paramBindings: Record<string, string>): void {
    this.params.clear();
    for (const [bindingKey, uniform] of Object.entries(paramBindings)) this.params.set(paramChannelKey(bindingKey), uniform);
  }

  hasBindings(): boolean {
    return this.live.size > 0 || this.params.size > 0;
  }

  /** Live-node uniform names bound in the current shader (for registering them on the material). */
  uniformNames(): IterableIterator<string> {
    return this.live.values();
  }

  /** Uniform name a param binding key resolves to right now, if the param is a live uniform. */
  paramUniform(bindingKey: string): string | undefined {
    return this.params.get(paramChannelKey(bindingKey));
  }

  /**
   * Returns `uniform name → value` for this frame. The map is reused; consume
   * it synchronously. Empty when nothing is bound, so the loop's "is the
   * picture moving?" check stays cheap.
   */
  tick(dt: number, time: number): Map<string, InputValue> {
    const result = this.result;
    result.clear();
    this.moved = false;
    if (this.live.size === 0 && this.params.size === 0 && ![...this.sources].some(s => s.wantsTick?.())) return result;
    for (const source of this.sources) source.tickInputs(dt, time, this.writer);
    // Did any scalar change since last frame? (Vectors are mutated in place by
    // their source, so a written vector always counts as movement.)
    const prev = this.previous;
    for (const [name, v] of result) {
      if (typeof v !== 'number') { this.moved = true; continue; }
      if (prev.get(name) !== v) { this.moved = true; prev.set(name, v); }
    }
    return result;
  }

  /** True when the last tick produced a value different from the frame before (a knob moved). */
  changed(): boolean {
    return this.moved;
  }
}

export const inputBus = new InputBus();
