/**
 * wheelOwner.ts — who a wheel / trackpad swipe belongs to, shared by the controls that react to the wheel.
 *
 * A swipe is a run of wheel events with short gaps (its momentum included); who owns it is settled at its first
 * event. An element owns it only when the swipe starts on it and the pointer was moved onto that element (and rested
 * a moment) beforehand. So a two-finger pan that passes over a slider, or starts where a pan left a slider under a
 * still pointer, stays a pan. RulerSlider uses it; anything else that nudges a value on the wheel can too:
 *
 *   const off = claimWheel(el, '[data-ruler-track]');   // in an effect, on mount
 *   if (!ownsWheel(el)) return;                          // in the element's own wheel listener
 */

export const SWIPE_GAP_MS = 200;
export const SETTLE_MS = 200;

const wheel = { owner: null as Element | null, armed: null as Element | null, armedAt: 0, lastAt: 0, installed: false };
const selectors = new Set<string>();

function install(): void {
  if (wheel.installed || typeof window === 'undefined') return;
  wheel.installed = true;
  // Capture runs before the element's own listener sees the event.
  window.addEventListener('wheel', e => {
    const now = performance.now();
    if (now - wheel.lastAt > SWIPE_GAP_MS) {
      const target = e.target as Element | null;
      let on: Element | null = null;
      for (const sel of selectors) { on = target?.closest?.(sel) ?? null; if (on) break; }
      wheel.owner = on && on === wheel.armed && now - wheel.armedAt >= SETTLE_MS ? on : null;
      // A pan moves things under the pointer: nothing is armed until the pointer moves again.
      if (!wheel.owner) wheel.armed = null;
    }
    wheel.lastAt = now;
  }, { capture: true, passive: true });
}

/** Whether the swipe now in progress belongs to `el`. */
export function ownsWheel(el: Element): boolean {
  return wheel.owner === el;
}

/**
 * Let `el` (matched by `selector`) own swipes that start on it once the pointer has really moved onto it. Returns
 * the clean-up for the effect.
 */
export function claimWheel(el: HTMLElement, selector: string): () => void {
  selectors.add(selector);
  install();
  // Arm on a real pointer move: content panned under a still pointer doesn't count.
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || (!e.movementX && !e.movementY)) return;
    if (wheel.armed !== el) { wheel.armed = el; wheel.armedAt = performance.now(); }
  };
  const onLeave = () => { if (wheel.armed === el) wheel.armed = null; };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  return () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerleave', onLeave);
    if (wheel.armed === el) wheel.armed = null;
    if (wheel.owner === el) wheel.owner = null;
  };
}

/** A wheel event that is mostly vertical (an ordinary scroll), ignoring zero-size events. */
export function mostlyVertical(e: Pick<WheelEvent, 'deltaX' | 'deltaY'>): boolean {
  return Math.abs(e.deltaY) > Math.abs(e.deltaX);
}

/**
 * What a wheel event over a zoomable view means: ctrl / ⌘ (a trackpad pinch arrives as ctrl+wheel) zooms; otherwise
 * a mostly-vertical delta is `vertical` (the owner decides: zoom a plot, scroll the page past a timeline) and a
 * mostly-horizontal one pans.
 */
export function wheelIntent(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey'>): 'zoom' | 'vertical' | 'pan' {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  return mostlyVertical(e) ? 'vertical' : 'pan';
}
