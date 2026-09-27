/**
 * threeSource.ts — the three.js script an exported page carries when it has a
 * 3D Script layer (src/play/kit/three-slim.js bundled into one script that
 * defines `SSThree`; see `virtual:three-slim-source` in vite.config.ts).
 *
 * It is about 550 KB, so the app loads it only when something exports a
 * Play with a 3D sketch: `loadThreeSource()` before building the page, or
 * `useThreeSource(needed)` in a component that builds one as it renders.
 * The page builders in exportHtml.ts read it with `threeSource()`.
 */
import { useEffect, useState } from 'react';
import type { PlayRecord } from '../types/play';

/** Does the Play have a 3D Script layer (so its page carries three.js)? Hidden ones count: an action can show them. */
export function playUses3D(play: PlayRecord): boolean {
  return play.layers.some(l => (l.kind === 'script' && l.mode === '3d') || (l.kind === 'background' && l.sources.some(s => s.kind === 'script' && s.mode === '3d')));
}

let cached: string | null = null;
let pending: Promise<string> | null = null;
const waiting = new Set<() => void>();

/** The script, once loaded; null before. */
export function threeSource(): string | null {
  return cached;
}

/** Load the script (once); resolves with it. */
export function loadThreeSource(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = import('virtual:three-slim-source').then(m => {
      cached = m.default;
      for (const fn of waiting) fn();
      waiting.clear();
      return cached;
    }).catch(e => { pending = null; throw e; });
  }
  return pending;
}

/** Set the script directly (tests, and hosts that already have it). */
export function setThreeSource(source: string): void {
  cached = source;
}

/**
 * three.js for the app's own 3D Script layers: the same script evaluated once
 * here, so the app and exported pages run the very same build, and the app's
 * main bundle carries none of it until a 3D sketch appears.
 */
let runtime: unknown = null;
let runtimePending: Promise<unknown> | null = null;
const waitingRuntime = new Set<() => void>();
export function threeRuntime(): unknown {
  return runtime;
}
export function loadThreeRuntime(): Promise<unknown> {
  if (runtime) return Promise.resolve(runtime);
  if (!runtimePending) {
    runtimePending = loadThreeSource().then(src => {
      runtime = new Function(`${src}\nreturn SSThree;`)();
      for (const fn of waitingRuntime) fn();
      waitingRuntime.clear();
      return runtime;
    }).catch(e => { runtimePending = null; throw e; });
  }
  return runtimePending;
}
/** In a component: three.js for a 3D sketch when `needed` (null until it has loaded; the component re-renders then). */
export function useThreeRuntime(needed: boolean): unknown {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!needed || runtime) return;
    const on = () => bump(n => n + 1);
    waitingRuntime.add(on);
    void loadThreeRuntime().catch(() => {});
    return () => { waitingRuntime.delete(on); };
  }, [needed]);
  return needed ? runtime : null;
}

/** In a component: loads the script when `needed`, and re-renders once it is here. True when ready (or not needed). */
export function useThreeSource(needed: boolean): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!needed || cached) return;
    const on = () => bump(n => n + 1);
    waiting.add(on);
    void loadThreeSource().catch(() => {});
    return () => { waiting.delete(on); };
  }, [needed]);
  return !needed || cached !== null;
}
