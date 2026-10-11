/**
 * refreshRate — measures the display's refresh rate (lib/frameRate.ts estimateRefreshHz) from a
 * short run of requestAnimationFrame intervals, and again when the window moves to another screen
 * (its size, pixel ratio or position on the desktop changes). Only while the window is visible and
 * in front: a background window's frames are throttled and say nothing about the screen.
 *
 * Within one screen a lower reading never replaces a higher one (a busy moment drops frames, never
 * adds them); a new screen starts over.
 */
import { estimateRefreshHz, useFrameRate } from './frameRate';

const SAMPLES = 90;
const CHECK_MS = 2000;

let started = false;
let measuring = false;
let screenKey = '';
let best = 0;

/** What identifies the screen the window is on, as far as a page can tell. */
export function screenKeyOf(s: { width: number; height: number; availLeft?: number; availTop?: number }, dpr: number): string {
  return `${s.width}x${s.height}@${dpr}:${s.availLeft ?? 0},${s.availTop ?? 0}`;
}

function currentKey(): string {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return screenKeyOf(s, window.devicePixelRatio || 1);
}

function measure(): void {
  if (measuring || document.hidden || !document.hasFocus()) return;
  measuring = true;
  const key = currentKey();
  const intervals: number[] = [];
  let last = 0;
  const step = (now: number) => {
    if (document.hidden) { measuring = false; return; }
    if (last) intervals.push(now - last);
    last = now;
    if (intervals.length < SAMPLES) { requestAnimationFrame(step); return; }
    measuring = false;
    const hz = estimateRefreshHz(intervals);
    if (!hz) return;
    if (key !== screenKey) { screenKey = key; best = 0; }
    if (hz > best) { best = hz; useFrameRate.getState().setScreenHz(hz); }
  };
  requestAnimationFrame(step);
}

/** Start measuring (once per page); later calls do nothing. */
export function startRefreshDetection(): void {
  if (started || typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  started = true;
  measure();
  // A different screen: measure again. Polled (there's no "moved to another screen" event in every
  // browser, and WKWebView has none); comparing a few numbers every two seconds costs nothing.
  setInterval(() => { if (currentKey() !== screenKey || !useFrameRate.getState().measured) measure(); }, CHECK_MS);
  window.addEventListener('focus', () => { if (!useFrameRate.getState().measured) measure(); });
}
