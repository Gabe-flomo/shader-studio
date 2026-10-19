/**
 * overflowCheck.ts — a dev-only layout check: does anything in a card or a
 * panel run past its edge at a narrow width? (No horizontal clipping, ever:
 * see Segmented in components/ui/Choice.tsx and the row helpers.)
 *
 * `findOverflow(root)` lists the elements that
 *   - stick out past the root, or past an ancestor inside it that clips or
 *     scrolls (only the outermost offender is listed, not its children),
 *   - hold text that runs past those edges (a label wider than its button), or
 *   - scroll sideways (overflow auto/scroll with scrollWidth > clientWidth).
 * Text that ends in an ellipsis, text fields and elements marked
 * `data-overflow-ok` (a deliberate sideways scroller, a measuring copy) are
 * left out.
 *
 * `sweepOverflow(selector, widths)` squeezes every match to each width in
 * turn, lets ResizeObservers settle, and reports what overflows. In the dev
 * build it is on `window.__shaderStudioDev.overflow`:
 *
 *   await __shaderStudioDev.overflow.sweepOverflow('[data-column=sources]', [280, 320])
 */

export interface OverflowHit {
  /** A short CSS-ish path from the root to the element. */
  path: string;
  /** What it does: sticks out past `past` px, or scrolls sideways by that much. */
  kind: 'sticks-out' | 'scrolls';
  by: number;
  /** Its text, shortened, to recognise it by. */
  text: string;
  el: Element;
}

const TOLERANCE = 1.5;
const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'CANVAS', 'VIDEO', 'IMG', 'svg', 'SVG']);

function skipped(el: Element): boolean {
  return !!el.closest('[data-overflow-ok], [aria-hidden="true"]');
}

// Laid out counts, even when `visibility: hidden`: hover-only tools take their room and show on hover.
function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  return getComputedStyle(el).display !== 'none';
}

function describe(el: Element, root: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== root && parts.length < 5; e = e.parentElement) {
    const data = [...e.attributes].find(a => a.name.startsWith('data-') || a.name === 'aria-label' || a.name === 'role');
    parts.unshift(`${e.tagName.toLowerCase()}${data ? `[${data.name}=${data.value.slice(0, 24)}]` : ''}`);
  }
  return parts.join(' > ');
}

const clips = (cs: CSSStyleDeclaration) => cs.overflowX !== 'visible';

export function findOverflow(root: Element): OverflowHit[] {
  const hits: OverflowHit[] = [];
  const rootBox = root.getBoundingClientRect();
  // The box each element must stay inside: the root's, narrowed by any clipping ancestor below it.
  const bounds = new Map<Element, { left: number; right: number }>();
  bounds.set(root, { left: rootBox.left, right: rootBox.right });
  const offenders = new Set<Element>();
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (skipped(child)) continue;
      const parentBounds = bounds.get(el)!;
      const cs = getComputedStyle(child);
      if (cs.display === 'none') continue;
      const box = child.getBoundingClientRect();
      const shown = visible(child) && cs.position !== 'fixed';
      if (shown && box.width > 0) {
        const past = Math.max(box.right - parentBounds.right, parentBounds.left - box.left);
        const parentOffends = offenders.has(el);
        const ellipsis = cs.textOverflow === 'ellipsis';
        if (past > TOLERANCE && !parentOffends) {
          offenders.add(child);
          hits.push({ path: describe(child, root), kind: 'sticks-out', by: Math.round(past), text: (child.textContent ?? '').trim().slice(0, 40), el: child });
        } else if (parentOffends) offenders.add(child);
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && !ellipsis && !FIELDS.has(child.tagName) && child.scrollWidth - child.clientWidth > TOLERANCE) {
          hits.push({ path: describe(child, root), kind: 'scrolls', by: child.scrollWidth - child.clientWidth, text: (child.textContent ?? '').trim().slice(0, 40), el: child });
        }
      }
      if (FIELDS.has(child.tagName)) continue;
      // An ellipsis cuts what's inside it on purpose.
      if (cs.textOverflow === 'ellipsis' && clips(cs)) continue;
      // Text that runs past the edge (a label wider than its button), not just boxes.
      if (shown && !offenders.has(child)) {
        const inside = clips(cs) && box.width > 0 ? { left: Math.max(parentBounds.left, box.left), right: Math.min(parentBounds.right, box.right) } : parentBounds;
        for (const node of child.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const t = range.getBoundingClientRect();
          const past = Math.max(t.right - inside.right, inside.left - t.left);
          if (t.width > 0 && past > TOLERANCE) {
            hits.push({ path: describe(child, root), kind: 'sticks-out', by: Math.round(past), text: node.textContent.trim().slice(0, 40), el: child });
            break;
          }
        }
      }
      bounds.set(child, clips(cs) && box.width > 0
        ? { left: Math.max(parentBounds.left, box.left), right: Math.min(parentBounds.right, box.right) }
        : parentBounds);
      walk(child);
    }
  };
  walk(root);
  return hits;
}

// n animation frames, or n × 50ms when frames don't come (a hidden tab or browser pane pauses them).
const frames = (n: number) => new Promise<void>(resolve => {
  const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
  setTimeout(resolve, n * 50);
});

export interface SweepResult { selector: string; width: number; index: number; hits: Omit<OverflowHit, 'el'>[] }

/** Squeezes each match of `selector` to each width, checks it, and puts it back. */
export async function sweepOverflow(selector: string, widths: readonly number[] = [280, 320]): Promise<SweepResult[]> {
  const out: SweepResult[] = [];
  const roots = [...document.querySelectorAll<HTMLElement>(selector)];
  for (const width of widths) {
    for (const [index, root] of roots.entries()) {
      const before = root.getAttribute('style') ?? '';
      root.style.width = `${width}px`; root.style.maxWidth = `${width}px`; root.style.minWidth = `${width}px`; root.style.flex = 'none';
      await frames(3);
      const hits = findOverflow(root).map(h => ({ path: h.path, kind: h.kind, by: h.by, text: h.text }));
      if (hits.length) out.push({ selector, width, index, hits });
      root.setAttribute('style', before);
    }
  }
  await frames(2);
  return out;
}

// ── Reachability (docs/toolbars.md) ─────────────────────────────────────────

export interface UnreachableHit {
  path: string;
  /** Its accessible name (aria-label, else text), to recognise it by. */
  name: string;
  /** How much of it can be seen and clicked, 0–1. */
  shown: number;
  el: Element;
}

const CONTROLS = 'button, [role="tab"], [role="radio"], [role="menuitem"], [role="switch"], a[href], input:not([type="hidden"]), select';

/**
 * Controls under `root` that can't be reached: less than half of each is left once it is clipped by the
 * viewport and by every ancestor that clips (`overflow: hidden/clip`). An ancestor that scrolls on an axis
 * (`auto`/`scroll`) lets the control through on that axis — scrolling brings it into view — so there only
 * the scroller's own box counts, clipped further up. With `clipToRoot`, `root`'s box clips too (a node
 * card, a squeezed header); `viewport: false` skips the window's edges (a card panned off screen). Elements inside `[aria-hidden="true"]`, `[inert]`, `[data-overflow-ok]` or
 * (below `root`) a pan-and-zoom layer `[data-zoom-layer]`, or with zero size, are skipped.
 */
export function findUnreachable(root: Element = document.body, { clipToRoot = false, viewport = true }: { clipToRoot?: boolean; viewport?: boolean } = {}): UnreachableHit[] {
  const out: UnreachableHit[] = [];
  for (const el of root.querySelectorAll(CONTROLS)) {
    if (el.closest('[aria-hidden="true"], [inert], [data-overflow-ok]')) continue;
    const zoom = el.closest('[data-zoom-layer]');
    if (zoom && root.contains(zoom) && zoom !== root) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const b = a.getBoundingClientRect();
      const forced = clipToRoot && a === root;
      const sx = acs.overflowX === 'auto' || acs.overflowX === 'scroll';
      const sy = acs.overflowY === 'auto' || acs.overflowY === 'scroll';
      // A scroller: the control can be scrolled to its near edge.
      if (sx) { const w = Math.min(right - left, b.width); left = b.left; right = b.left + Math.max(0, w); }
      else if (forced || acs.overflowX !== 'visible') { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (sy) { const h = Math.min(bottom - top, b.height); top = b.top; bottom = b.top + Math.max(0, h); }
      else if (forced || acs.overflowY !== 'visible') { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
      // Checked on its own: what's outside the root doesn't clip (a card panned off the canvas).
      if (forced) break;
    }
    if (viewport) { left = Math.max(left, 0); right = Math.min(right, window.innerWidth); }
    if (viewport) { top = Math.max(top, 0); bottom = Math.min(bottom, window.innerHeight); }
    const shown = Math.max(0, right - left) * Math.max(0, bottom - top) / (r.width * r.height);
    if (shown < 0.5) {
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
      out.push({ path: describe(el, root), name, shown: Math.round(shown * 100) / 100, el });
    }
  }
  return out;
}

export interface ReachSweep { selector: string; width: number | null; index: number; hits: Omit<UnreachableHit, 'el'>[] }

/**
 * Squeezes each match of `selector` to each width (`null`: as it is) and lists the controls inside it
 * that can't be reached, with the match's own box as a clip. For headers, bars and node cards:
 *
 *   await (await __shaderStudioDev.overflow()).sweepReach('[data-preview-header]', [280, 360, 480])
 */
export async function sweepReach(selector: string, widths: readonly (number | null)[] = [280, 360]): Promise<ReachSweep[]> {
  const out: ReachSweep[] = [];
  const roots = [...document.querySelectorAll<HTMLElement>(selector)];
  for (const width of widths) {
    for (const [index, root] of roots.entries()) {
      const before = root.getAttribute('style') ?? '';
      if (width !== null) { root.style.width = `${width}px`; root.style.maxWidth = `${width}px`; root.style.minWidth = `${width}px`; root.style.flex = 'none'; }
      await frames(4);
      const hits = findUnreachable(root, { clipToRoot: true, viewport: false }).map(({ el: _el, ...h }) => h);
      if (hits.length) out.push({ selector, width, index, hits });
      root.setAttribute('style', before);
    }
  }
  await frames(2);
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface PageSweep { page: string; width: number; hits: Omit<UnreachableHit, 'el'>[] }

/**
 * Visits each top-level page (the top bar's `[data-page-tab]`s, and every tab of the Code page) at
 * the current window width and lists the controls `findUnreachable` finds. The width itself is set
 * from outside (the in-app browser's viewport, or a CDP device-metrics override).
 *
 *   await (await __shaderStudioDev.overflow()).sweepPages()
 */
export async function sweepPages(pages?: readonly string[], settleMs = 1200): Promise<PageSweep[]> {
  const out: PageSweep[] = [];
  const tabs = pages ?? [...document.querySelectorAll('[data-page-tab]')].map(e => e.getAttribute('data-page-tab')!).filter(Boolean);
  const record = (page: string) => {
    const hits = findUnreachable().map(({ el: _el, ...h }) => h);
    out.push({ page, width: window.innerWidth, hits });
  };
  for (const page of tabs) {
    const tab = document.querySelector<HTMLElement>(`[data-page-tab="${page}"]`);
    if (!tab) continue;
    tab.click();
    await sleep(settleMs);
    if (page !== 'code') { record(page); continue; }
    // Every tab of the Code page (CodeTabs): Shader, Convert, Functions, Node packs.
    const count = document.querySelectorAll('[data-code-tabs] [role="radio"]').length;
    if (!count) record(page);
    for (let i = 0; i < count; i++) {
      const t = document.querySelectorAll<HTMLElement>('[data-code-tabs] [role="radio"]')[i];
      if (!t) continue;
      const name = (t.textContent ?? '').trim();
      t.click();
      await sleep(settleMs);
      record(`code/${name}`);
    }
    document.querySelector<HTMLElement>('[data-code-tabs] [role="radio"]')?.click();
    await sleep(settleMs);
  }
  return out;
}
