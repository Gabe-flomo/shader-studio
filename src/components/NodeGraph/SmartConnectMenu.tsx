import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { TYPE_COLORS } from './typeColors';
import type { Suggestion } from './smartConnect';
import type { QuickAdd } from './quickAdds';
import { portalGuard } from '../ui/portalGuard';

const MARGIN = 8;

type Entry = { kind: 'wire'; s: Suggestion } | { kind: 'add'; q: QuickAdd };

/**
 * The Smart connect popover: the suggested sockets already on the canvas (up to three, plus
 * the Output node), then new nodes to add and wire in one go, then "Add a new node…".
 * A number key or a click picks a row, A opens the node search, Esc or a click outside closes.
 * Hovering a canvas row previews its wire (onHover).
 */
export function SmartConnectMenu({ x, y, title, items, quickAdds = [], onPick, onQuickAdd, onHover, onAddNode, onClose, justAdded = false }: {
  x: number;
  y: number;
  title: string;
  items: Suggestion[];
  quickAdds?: QuickAdd[];
  /** Opened on a node just added from search: the footer offers to leave it unconnected instead */
  justAdded?: boolean;
  onPick: (s: Suggestion) => void;
  onQuickAdd?: (q: QuickAdd) => void;
  onHover: (s: Suggestion | null) => void;
  onAddNode: () => void;
  onClose: () => void;
}) {
  const entries: Entry[] = [...items.map(s => ({ kind: 'wire', s }) as Entry), ...quickAdds.map(q => ({ kind: 'add', q }) as Entry)];
  const choose = (e: Entry) => { if (e.kind === 'wire') onPick(e.s); else onQuickAdd?.(e.q); };
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Open beside the pointer, kept inside the viewport
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(MARGIN, Math.min(x + 10, window.innerWidth - r.width - MARGIN))}px`;
    el.style.top = `${y + 10 + r.height > window.innerHeight - MARGIN ? Math.max(MARGIN, y - r.height - 10) : y + 10}px`;
  }, [x, y, entries.length]);

  const latest = useRef({ entries, choose, onAddNode, onClose });
  const latestJustAdded = useRef(justAdded);
  useEffect(() => { latestJustAdded.current = justAdded; }, [justAdded]);
  useEffect(() => { latest.current = { entries, choose, onAddNode, onClose }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { entries: list, choose: pick, onAddNode: add, onClose: close } = latest.current;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      const n = Number(e.key);
      // Handled keys stop here, so the canvas shortcuts (A = add node, …) don't also fire
      if (n >= 1 && n <= list.length) { e.preventDefault(); e.stopPropagation(); pick(list[n - 1]); return; }
      if (!latestJustAdded.current && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); e.stopPropagation(); add(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(1, list.length));
      }
      if (e.key === 'Enter' && list.length) { e.preventDefault(); e.stopPropagation(); pick(list[Math.min(activeRef.current, list.length - 1)]); }
    };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) latest.current.onClose(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onDown, true); };
  }, []);

  const kbd = (k: string, on: boolean) => (
    <span style={{
      width: 18, height: 18, flexShrink: 0, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: `600 10.5px ${fontFamily.mono}`, background: on ? tk.accent.base : tk.bg.field, color: on ? '#ffffff' : tk.text.muted,
    }}>{k}</span>
  );

  return createPortal(
    <div
      {...portalGuard}
      ref={ref}
      role="menu"
      aria-label={title}
      data-captures-escape
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left: x + 10, top: y + 10, zIndex: 400, width: 312, padding: 4, boxSizing: 'border-box',
        background: tk.bg.panel, borderRadius: radius.lg, boxShadow: tk.shadow.popover, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`,
      }}
    >
      <div style={{ padding: '7px 8px 6px', color: tk.text.faint, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>{title}</div>
      {entries.length === 0 && (
        <div style={{ padding: '6px 8px 10px', color: tk.text.muted, fontSize: 12 }}>Nothing on the canvas takes this yet.</div>
      )}
      {entries.map((e, i) => {
        const on = i === active;
        const isAdd = e.kind === 'add';
        const first = i === 0 || entries[i - 1].kind !== e.kind;
        const label = isAdd ? e.q.label : e.s.nodeLabel;
        const sockLabel = isAdd ? e.q.socketLabel : e.s.socketLabel;
        const type = isAdd ? e.q.type_ : e.s.type;
        const right = isAdd ? e.q.note : e.s.pinned ? 'always' : e.s.replaces ? 'replaces' : `${Math.round(e.s.distance)} px`;
        return (
          <div key={isAdd ? `add:${e.q.type}` : `${e.s.nodeId}:${e.s.key}`}>
            {first && entries.length > 0 && (items.length > 0 && quickAdds.length > 0) && (
              <div style={{ padding: isAdd ? '8px 8px 3px' : '0 8px 3px', color: tk.text.faint, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
                {isAdd ? 'ADD AND WIRE' : 'ON THE CANVAS'}
              </div>
            )}
            <div
              role="menuitem"
              onMouseEnter={() => { setActive(i); onHover(isAdd ? null : e.s); }}
              onMouseLeave={() => onHover(null)}
              onClick={() => choose(e)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, height: 40, padding: '0 8px', borderRadius: 8, cursor: 'pointer',
                background: on ? tk.bg.selected : 'none',
              }}
            >
              {kbd(String(i + 1), on)}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {isAdd && <Icon name="plus" size={11} />}
                  {label}
                </b>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: tk.text.muted, fontSize: 11.5 }}>
                  <i style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[type] ?? tk.text.faint, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isAdd ? 'New · ' : ''}{sockLabel} · {type}{!isAdd && e.s.replaces ? ` · now from ${e.s.replaces}` : ''}</span>
                </span>
              </span>
              <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{right}</span>
            </div>
          </div>
        );
      })}
      <div
        role="menuitem"
        onClick={justAdded ? onClose : onAddNode}
        onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 8px', marginTop: 2, borderRadius: 8,
          borderTop: `1px solid ${tk.border.subtle}`, color: tk.text.muted, cursor: 'pointer',
        }}
      >
        <Icon name={justAdded ? 'close' : 'search'} size={14} />
        <span style={{ flex: 1 }}>{justAdded ? 'Leave it unconnected' : 'Add a new node…'}</span>
        {kbd(justAdded ? 'Esc' : 'A', false)}
      </div>
    </div>,
    document.body,
  );
}
