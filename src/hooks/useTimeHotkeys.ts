import { useEffect } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

const STEP_SECONDS = 1;
const CONTINUOUS_RATE = 2; // seconds of playback time per real second, while Shift+arrow is held

/**
 * Global playback hotkeys — Space toggles play/pause, Left/Right arrows
 * step time by 1s per keypress (holding it down repeats via the browser's
 * own key-repeat, still in whole-second jumps), and Shift+arrow held down
 * scrubs continuously instead of stepping. Works everywhere, including
 * while a keyframe editor is open, since it's the same global u_time either
 * way — there is deliberately only one Space/arrow behavior, not a
 * keyframe-editor-specific one, to avoid two different things happening
 * depending on what's focused.
 *
 * Skipped entirely while a text field, dropdown, or slider/knob (a native
 * <input>, which includes type="range") has focus, so it never fights
 * normal typing or in-place value editing.
 */
export function useTimeHotkeys() {
  useEffect(() => {
    const held = { left: false, right: false };
    let rafId: number | null = null;
    let lastFrame: number | null = null;

    const tick = (now: number) => {
      if (lastFrame === null) lastFrame = now;
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      let delta = 0;
      if (held.left) delta -= CONTINUOUS_RATE * dt;
      if (held.right) delta += CONTINUOUS_RATE * dt;
      if (delta !== 0) window.dispatchEvent(new CustomEvent('step-time', { detail: { delta } }));
      if (held.left || held.right) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        lastFrame = null;
      }
    };

    const isTypingOrControlTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      const tag = el?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingOrControlTarget(e.target)) return;
      if (e.code === 'Space') {
        // preventDefault also stops the browser's own "activate the
        // focused button" behavior for Space, so this can't double-fire
        // with whatever button happens to still have focus.
        e.preventDefault();
        const { timePlaying, setTimePlaying } = useNodeGraphStore.getState();
        setTimePlaying(!timePlaying);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? 'left' : 'right';
        if (e.shiftKey) {
          if (!held[dir]) {
            held[dir] = true;
            if (rafId == null) { lastFrame = null; rafId = requestAnimationFrame(tick); }
          }
        } else {
          // Each event (including the browser's own key-repeat while held)
          // is exactly one second — the "one step at a time" contrast to
          // Shift's smooth continuous scrub above.
          window.dispatchEvent(new CustomEvent('step-time', { detail: { delta: dir === 'left' ? -STEP_SECONDS : STEP_SECONDS } }));
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') held.left = false;
      if (e.key === 'ArrowRight') held.right = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);
}
