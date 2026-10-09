/**
 * autoQuality — the preview's Auto resolution (lib/previewQuality.ts): when the picture's GPU work
 * gets heavy enough to stall the page (the whole UI shares that GPU), render fewer pixels; when it
 * would fit again at more, go back up. Pure: the frame loop (ShaderCanvas) calls autoQualityStep once
 * a second with what it measured and applies the scale it returns.
 *
 * With a GPU timer the decision is on the frame's GPU work (minus the timer's floor, the reference
 * draw): over HEAVY_MS twice in a row steps down; going up needs the work it *would* take at the
 * next level up (it grows with the pixel count, the square of the scale) to stay under LIGHT_MS
 * three times in a row, so it never steps up into a level it would step straight back down from.
 * Without a timer (Safari) it goes by the frame rate: down under LOW_FPS, up after a long run at
 * full rate, and not again for a minute if that brought the rate straight back down.
 */

export const AUTO_LEVELS = [1, 1 / 2, 1 / 3, 1 / 4] as const;

/** GPU work per frame that stalls the page: steps down. */
export const HEAVY_MS = 14;
/** GPU work the next level up would take, under which it steps back up. */
export const LIGHT_MS = 8;
/** Without a timer: under this frame rate steps down. */
export const LOW_FPS = 45;
/** Without a timer: at or above this frame rate (for UP_RUN seconds) tries a level up. */
export const FULL_FPS = 57;
const UP_RUN = 8;
/** Seconds after a change before the next reading counts (the averages still hold the old level). */
const SETTLE_MS = 2000;
const BAN_MS = 60_000;

export interface AutoSample {
  /** The frame's GPU work (ms, averaged), or null without a GPU timer. */
  gpuMs: number | null;
  /** The timer's floor (the reference draw), subtracted from gpuMs. */
  floorMs: number | null;
  fps: number;
  /** Frames were drawn this second (a still picture says nothing about cost). */
  drawing: boolean;
}

export interface AutoState {
  heavy: number;
  light: number;
  lastChange: number;
  lastUp: number;
  banUpUntil: number;
}

export const newAutoState = (): AutoState => ({ heavy: 0, light: 0, lastChange: -Infinity, lastUp: -Infinity, banUpUntil: -Infinity });

const levelOf = (scale: number) => {
  const i = AUTO_LEVELS.findIndex(l => Math.abs(l - scale) < 1e-6);
  return i < 0 ? 0 : i;
};

/** The scale to render at next, given the one it is at and this second's reading. Mutates `st`. */
export function autoQualityStep(st: AutoState, scale: number, s: AutoSample, now: number): number {
  if (!s.drawing || now - st.lastChange < SETTLE_MS) { st.heavy = 0; st.light = 0; return scale; }
  const i = levelOf(scale);
  let heavy: boolean;
  let light: boolean;
  if (s.gpuMs !== null) {
    const load = Math.max(0, s.gpuMs - (s.floorMs ?? 0));
    heavy = load > HEAVY_MS;
    const up = i > 0 ? AUTO_LEVELS[i - 1] : scale;
    light = i > 0 && load * (up / scale) ** 2 < LIGHT_MS;
  } else {
    heavy = s.fps > 0 && s.fps < LOW_FPS;
    light = i > 0 && s.fps >= FULL_FPS && now >= st.banUpUntil;
  }
  st.heavy = heavy ? st.heavy + 1 : 0;
  st.light = light ? st.light + 1 : 0;
  if (st.heavy >= 2 && i < AUTO_LEVELS.length - 1) {
    // Without a timer, a step up that brought the rate straight back down isn't tried again for a while.
    if (s.gpuMs === null && now - st.lastUp < SETTLE_MS + 5000) st.banUpUntil = now + BAN_MS;
    st.heavy = 0; st.light = 0; st.lastChange = now;
    return AUTO_LEVELS[i + 1];
  }
  if (st.light >= (s.gpuMs === null ? UP_RUN : 3)) {
    st.heavy = 0; st.light = 0; st.lastChange = now; st.lastUp = now;
    return AUTO_LEVELS[i - 1];
  }
  return scale;
}
