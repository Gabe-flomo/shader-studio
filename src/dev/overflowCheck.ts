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

const frames = (n: number) => new Promise<void>(resolve => {
  const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
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
