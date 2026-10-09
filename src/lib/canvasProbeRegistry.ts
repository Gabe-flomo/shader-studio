/**
 * canvasProbeRegistry.ts
 *
 * Shared "canvas-by-key registry" mechanism: a UI component registers a
 * canvas element on mount and removes it on unmount; an animation loop
 * looks it up by key once per frame and draws into its 2D context.
 * scopeRegistry.ts and audioSpectrumRegistry.ts each own a registry
 * instance of this plus their own (very different) drawing logic.
 */

export class CanvasProbeRegistry {
  private canvases = new Map<string, HTMLCanvasElement>();
  /**
   * Second views of the same key (a Deposit card showing its Trail field's texture): the loop draws
   * into the main canvas when there is one, and the mirror copies it; with no main canvas (that
   * card is off screen) the loop draws straight into the first mirror.
   */
  private mirrors = new Map<string, HTMLCanvasElement[]>();

  register(key: string, canvas: HTMLCanvasElement): void {
    this.canvases.set(key, canvas);
  }

  unregister(key: string): void {
    this.canvases.delete(key);
  }

  get(key: string): HTMLCanvasElement | undefined {
    return this.canvases.get(key) ?? this.mirrors.get(key)?.[0];
  }

  has(key: string): boolean {
    return this.canvases.has(key) || (this.mirrors.get(key)?.length ?? 0) > 0;
  }

  /** How many keys have a canvas (main or mirror): 0 means nothing to draw. */
  size(): number {
    let n = this.canvases.size;
    for (const [k, l] of this.mirrors) if (l.length && !this.canvases.has(k)) n++;
    return n;
  }

  /** The keys with a canvas (main or mirror). */
  keys(): string[] {
    return [...new Set([...this.canvases.keys(), ...[...this.mirrors].filter(([, l]) => l.length).map(([k]) => k)])];
  }

  /** The main canvas only (what a mirror copies from), not a mirror. */
  main(key: string): HTMLCanvasElement | undefined {
    return this.canvases.get(key);
  }

  registerMirror(key: string, canvas: HTMLCanvasElement): () => void {
    const list = this.mirrors.get(key) ?? [];
    list.push(canvas);
    this.mirrors.set(key, list);
    return () => {
      const l = (this.mirrors.get(key) ?? []).filter(c => c !== canvas);
      if (l.length) this.mirrors.set(key, l); else this.mirrors.delete(key);
    };
  }
}
