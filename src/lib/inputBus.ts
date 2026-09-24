/**
 * inputBus.ts — the one per-frame hook for JS-side signals that drive float
 * uniforms (MIDI now; audio, mouse, keyboard mappings and envelopes later).
 *
 * The render loop asks the bus once per frame for `uniform name → value` and
 * writes what it gets. Sources never see uniform names: they write by
 * `${nodeId}::${channel}` and the bus translates through the compiler's
 * `liveUniforms` map, so slugs and renames can't break a binding.
 *
 * Module singleton, no React, no store. No allocation per frame: one result
 * map is reused and the writer closure is created once.
 */

export type InputWriter = (channelKey: string, value: number) => void;

export interface InputSource {
  /**
   * Called once per rendered frame. `dt` is seconds since the last frame,
   * `time` the graph clock. Write every channel the source owns; a channel
   * with no binding in the current shader is dropped silently.
   */
  tickInputs(dt: number, time: number, write: InputWriter): void;
}

class InputBus {
  private sources = new Set<InputSource>();
  /** channel key → uniform name (reverse of the compiler's liveUniforms). */
  private bindings = new Map<string, string>();
  /** `${nodeId}::${paramKey}` → param uniform name (the compiler's paramBindings, as is). */
  private paramBindings = new Map<string, string>();
  private result = new Map<string, number>();
  private writer: InputWriter = (channelKey, value) => {
    const uniform = this.bindings.get(channelKey) ?? this.paramBindings.get(channelKey);
    if (uniform !== undefined) this.result.set(uniform, value);
  };

  addSource(source: InputSource): () => void {
    this.sources.add(source);
    return () => { this.sources.delete(source); };
  }

  /** Take the compiler's `uniform name → channel key` map from the last compile. */
  setBindings(liveUniforms: Record<string, string>): void {
    this.bindings.clear();
    for (const [uniform, channelKey] of Object.entries(liveUniforms)) this.bindings.set(channelKey, uniform);
  }

  /**
   * Take the compiler's paramBindings so mappings can drive any live param by
   * `${nodeId}::${paramKey}`, exactly like a slider drag but without the store.
   */
  setParamBindings(paramBindings: Record<string, string>): void {
    this.paramBindings.clear();
    for (const [key, uniform] of Object.entries(paramBindings)) this.paramBindings.set(key, uniform);
  }

  hasBindings(): boolean {
    return this.bindings.size > 0 || this.paramBindings.size > 0;
  }

  /** Uniform names bound in the current shader (for registering them on the material). */
  uniformNames(): IterableIterator<string> {
    return this.bindings.values();
  }

  /**
   * Returns `uniform name → value` for this frame. The map is reused; consume
   * it synchronously. Empty when nothing is bound, so the loop's "is the
   * picture moving?" check stays cheap.
   */
  tick(dt: number, time: number): Map<string, number> {
    const result = this.result;
    result.clear();
    if (this.bindings.size === 0 && this.paramBindings.size === 0) return result;
    for (const source of this.sources) source.tickInputs(dt, time, this.writer);
    return result;
  }
}

export const inputBus = new InputBus();
