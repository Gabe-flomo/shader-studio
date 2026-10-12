/**
 * SlotMenu — the right-click menu of an empty Warp Builder slot (docs/warp-builder.md, "Filling a
 * slot from a menu"). Compact: Number and the variables are flat one-line rows; Operators, Functions
 * and Compare fold open in place (a row of names, no descriptions: those are the title tooltips).
 * Arrow keys walk the rows, Enter picks or folds, Escape or a click outside closes it. Sized like the
 * app's other right-click menus, with an inner scroll and kept inside the viewport.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { portalGuard } from '../ui/portalGuard';
import { applyTile, slotMenuGroups, type SlotOption } from '../../warpBuilder/slotMenu';
import type { TileTarget } from '../../warpBuilder/spec';

const MARGIN = 8;
const FOLDED = new Set(['Operators', 'Functions', 'Compare']);

type Cell = { kind: 'item'; key: string; option: SlotOption } | { kind: 'fold'; key: string };

/** Pick an option: a drop, and for a number, the picked tile's text box takes the keys. */
function pick(to: TileTarget, o: SlotOption): void {
  applyTile(to, o.drag);
  if (o.drag.from === 'palette' && o.drag.kind === 'num') {
    window.setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('[data-warp-picked] input[aria-label="The picked tile as text"]');
      el?.focus(); el?.select();
    }, 30);
  }
}

export function SlotMenu({ x, y, to, onClose }: { x: number; y: number; to: TileTarget; onClose: () => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => slotMenuGroups(to), [to.block, to.line, to.path?.join('.')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ left: x, top: y });

  // The cells in order: flat rows, and a fold's children right after it when it is open.
  const cells = useMemo(() => {
    const out: Array<Cell & { parent?: string }> = [];
    for (const g of groups) {
      if (g.heading && FOLDED.has(g.heading)) {
        out.push({ kind: 'fold', key: g.heading });
        if (open === g.heading) for (const o of g.options) out.push({ kind: 'item', key: `${g.heading}:${o.label}`, option: o, parent: g.heading });
      } else for (const o of g.options) out.push({ kind: 'item', key: o.label, option: o });
    }
    return out;
  }, [groups, open]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - r.height - MARGIN)),
    });
  }, [x, y, open]);

  const activate = (c: Cell) => {
    if (c.kind === 'fold') { setOpen(o => (o === c.key ? null : c.key)); return; }
    pick(to, c.option);
    onClose();
  };

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        setActive(a => (a + (e.key === 'ArrowDown' ? 1 : cells.length - 1)) % cells.length);
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        const c = cells[active];
        if (c) activate(c);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ref.current?.querySelector('[data-slot-active]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const row = (c: Cell, i: number, chip = false) => {
    const on = active === i;
    const label = c.kind === 'fold' ? c.key : c.option.label;
    return (
      <button key={c.key} type="button" role="menuitem" title={c.kind === 'item' ? c.option.hint : undefined} data-slot-active={on || undefined} data-slot-item={c.key}
        onMouseEnter={() => setActive(i)} onClick={() => activate(c)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: chip ? 'center' : undefined, height: 24, padding: chip ? '0 8px' : '0 8px', border: 0, borderRadius: radius.md - 2, cursor: 'pointer',
          background: on ? tk.bg.field : 'transparent', color: tk.text.primary, font: chip ? `600 12px ${fontFamily.mono}` : 'inherit', whiteSpace: 'nowrap', minWidth: chip ? 26 : undefined, width: chip ? undefined : '100%', textAlign: 'left',
        }}>
        {chip ? label : <><span style={{ flex: 1 }}>{label}</span>{c.kind === 'fold' && <span aria-hidden style={{ color: tk.text.faint }}>{open === c.key ? '▾' : '▸'}</span>}</>}
      </button>
    );
  };

  const out: ReactNode[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as Cell & { parent?: string };
    if (c.kind === 'item' && c.parent) continue; // drawn with its fold
    out.push(row(c, i));
    if (c.kind === 'fold' && open === c.key) {
      const kids = cells.map((k, j) => ({ k: k as Cell & { parent?: string }, j })).filter(({ k }) => k.parent === c.key);
      out.push(
        <div key={`${c.key}-kids`} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '2px 4px 4px 12px' }}>
          {kids.map(({ k, j }) => row(k, j, true))}
        </div>,
      );
    }
  }

  return createPortal(
    <div {...portalGuard} ref={ref} role="menu" data-slot-menu
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 9000, width: 168, maxHeight: 'min(340px, calc(100dvh - 16px))', overflowY: 'auto', overscrollBehavior: 'contain', padding: 3, boxSizing: 'border-box',
        background: tk.bg.panel, borderRadius: 10, boxShadow: tk.shadow.popover, font: `12px ${fontFamily.ui}`,
      }}>
      {out}
    </div>,
    document.body,
  );
}
