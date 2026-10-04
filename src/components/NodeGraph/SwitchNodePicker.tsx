/**
 * The card footer's "Switch" pill: turn this node into a sibling (Union →
 * Intersect, Sphere → Cone, Sin → Cos) in place, wires and settings kept.
 * The list is worked out when it opens (nodes/switchNode.ts), never per render.
 * The node's right-click menu opens the same list (openSwitchPicker).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { PickerPanel, type PickerSection } from '../ui/GroupedPicker';
import { menuAsSheet } from '../ui/menuSheet';
import { getNodeDefinition } from '../../nodes/definitions';
import { switchOpeners, switchSections, THIS_NODE } from './switchPickerModel';

export function SwitchNodePicker({ nodeId, nodeType }: { nodeId: string; nodeType: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [open, setOpen] = useState<{ sections: PickerSection[]; asSheet: boolean } | null>(null);

  useEffect(() => {
    const fn = () => setOpen({ sections: switchSections(nodeId), asSheet: menuAsSheet(window.innerWidth) });
    switchOpeners.set(nodeId, fn);
    return () => { if (switchOpeners.get(nodeId) === fn) switchOpeners.delete(nodeId); };
  }, [nodeId]);
  const show = () => setOpen({ sections: switchSections(nodeId), asSheet: menuAsSheet(window.innerWidth) });

  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) ref.current?.focus({ preventScroll: true });
  };
  const label = getNodeDefinition(nodeType)?.label ?? nodeType;

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={!!open}
        aria-controls={open ? listId : undefined}
        title={`Switch ${label} to a similar node, wires and settings kept`}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); if (open) close(false); else show(); }}
        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); show(); } }}
        style={{
          marginLeft: 'auto', flexShrink: 0, height: 22, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 8px 0 6px',
          border: 0, borderRadius: 11, cursor: 'pointer', whiteSpace: 'nowrap',
          background: open ? alpha(tk.accent.base, 0.16) : tk.bg.field, color: open ? tk.accent.text : tk.text.muted,
          font: `600 11.5px ${fontFamily.ui}`,
        }}
      >
        <Icon name="bidir" size={12} />
        Switch
      </button>
      {open && (
        <PickerPanel
          listId={listId}
          sections={open.sections}
          value={nodeType}
          ariaLabel={`Switch ${label} to`}
          title={`Switch ${label} to`}
          asSheet={open.asSheet}
          width={260}
          withSearch={open.sections.reduce((n, s) => n + s.items.length, 0) > 6}
          initialQuery=""
          searchPlaceholder="Search similar nodes"
          anchorRef={ref}
          onPick={v => { close(true); if (v !== nodeType) useNodeGraphStore.getState().swapNode(nodeId, v); }}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * Under the shift-click "Replacing … pick a node" banner: the like-for-like
 * switches first, one click each (any palette node still works for the rest).
 */
export function SwapSuggestions({ nodeId }: { nodeId: string }) {
  const tk = useTokens();
  // Worked out once per target (the banner is keyed by it); the graph doesn't change meanwhile.
  const [items] = useState(() => switchSections(nodeId).flatMap(s => s.items).filter(i => !i.disabled && i.description !== THIS_NODE).slice(0, 8));
  if (!items.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minWidth: 0 }}>
      <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.8, marginRight: 2 }}>Same wiring</span>
      {items.map(i => (
        <button key={i.value} type="button" title={i.description}
          onClick={() => useNodeGraphStore.getState().swapNode(nodeId, i.value)}
          style={{
            height: 22, padding: '0 8px', border: 0, borderRadius: 11, cursor: 'pointer', maxWidth: '100%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            background: tk.bg.panel, color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`,
          }}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
