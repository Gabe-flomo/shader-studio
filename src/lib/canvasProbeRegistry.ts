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

  register(key: string, canvas: HTMLCanvasElement): void {
    this.canvases.set(key, canvas);
  }

  unregister(key: string): void {
    this.canvases.delete(key);
  }

  get(key: string): HTMLCanvasElement | undefined {
    return this.canvases.get(key);
  }

  has(key: string): boolean {
    return this.canvases.has(key);
  }
}
