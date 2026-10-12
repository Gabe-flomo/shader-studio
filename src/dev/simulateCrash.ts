/**
 * simulateCrash.ts — a hidden helper for testing crash recovery and crash
 * reports (docs/crash-recovery.md "Testing it"). From the console:
 *
 *   playfieldSimulateCrash('web-process')   // desktop: WebKit's content process killed → reload → Recover
 *   playfieldSimulateCrash('sigkill')       // desktop: the app killed (kill -9) → relaunch → Recover
 *   playfieldSimulateCrash('rust-panic')    // desktop: a Rust panic on the main thread (report written by Rust)
 *   playfieldSimulateCrash('js-fatal')      // a render error that blanks the page → Reload → Recover
 *   playfieldSimulateCrash('js-error')      // an uncaught error (logged; the app keeps running)
 *   playfieldSimulateCrash('rejection')     // an unhandled promise rejection (logged)
 *   playfieldSimulateCrash('webgl-lost')    // every canvas's WebGL context lost for 2 s (a report)
 *
 * Also in Files → App settings → Crash reports when `localStorage['shader-studio:dev'] = '1'`
 * (or in a dev build).
 */
import { useCrashSim } from '../components/crash/crashSim';

export type CrashKind = 'web-process' | 'sigkill' | 'rust-panic' | 'js-fatal' | 'js-error' | 'rejection' | 'webgl-lost';

export const CRASH_KINDS: ReadonlyArray<{ id: CrashKind; label: string; desktop?: boolean }> = [
  { id: 'js-fatal', label: 'JS fatal (blank page)' },
  { id: 'js-error', label: 'Uncaught JS error' },
  { id: 'rejection', label: 'Unhandled rejection' },
  { id: 'webgl-lost', label: 'WebGL context lost' },
  { id: 'web-process', label: 'Web process killed', desktop: true },
  { id: 'sigkill', label: 'Force quit (SIGKILL)', desktop: true },
  { id: 'rust-panic', label: 'Rust panic', desktop: true },
];

export const DEV_KEY = 'shader-studio:dev';
export function devToolsOn(): boolean {
  if (import.meta.env.DEV) return true;
  try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; }
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function simulateCrash(kind: CrashKind): Promise<void> {
  switch (kind) {
    case 'js-fatal': useCrashSim.setState({ bomb: true }); return;
    case 'js-error': setTimeout(() => { throw new Error('Simulated uncaught error (dev helper)'); }, 0); return;
    case 'rejection': void Promise.reject(new Error('Simulated unhandled rejection (dev helper)')); return;
    case 'webgl-lost': {
      for (const c of Array.from(document.querySelectorAll('canvas'))) {
        const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
        const ext = gl?.getExtension('WEBGL_lose_context');
        if (ext) { ext.loseContext(); setTimeout(() => ext.restoreContext(), 2000); }
      }
      return;
    }
    default: {
      if (!isTauri()) { console.warn(`simulateCrash('${kind}') needs the desktop app.`); return; }
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('crash_simulate', { kind });
    }
  }
}

/** `window.playfieldSimulateCrash(kind)`: hidden, always there (it does nothing until called). */
export function installCrashSimulator(): void {
  (window as unknown as { playfieldSimulateCrash?: typeof simulateCrash }).playfieldSimulateCrash = simulateCrash;
}
