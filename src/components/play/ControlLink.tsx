/**
 * ControlLink.tsx — "quick link" between two controls on the Controls page: ⌘-click (Ctrl-click
 * off Mac) a control card to pick it as the link's start, then ⌘-click a second one to open a
 * small popover choosing which drives which. Picking a direction makes the same "Another
 * control" mapping Map… → Your controls does (controlLink.ts), just in two clicks. Esc, or
 * ⌘-clicking the start card again, cancels.
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { PlayRecord } from '../../types/play';
import { findControlLink, linkControls } from '../../play/controlLink';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toastStore';
import { usePlayUi } from './playUi';

interface ControlLinkUi {
  /** The control picked as the link's source ('' none). */
  from: string;
  /** The second control ⌘-clicked, while its direction popover is open. */
  target: string;
  /** id ⌘-clicked with nothing picked yet → start; `from` clicked again → cancel; a different id → open its popover. */
  pick: (id: string) => void;
  cancel: () => void;
}

export const useControlLinkUi = create<ControlLinkUi>((set, get) => ({
  from: '',
  target: '',
  pick: id => {
    const { from } = get();
    if (!from) set({ from: id, target: '' });
    else if (from === id) set({ from: '', target: '' });
    else set({ target: id });
  },
  cancel: () => set({ from: '', target: '' }),
}));

/** Esc cancels link mode from anywhere on the Controls page; call once near the page's root. */
export function useControlLinkEscape(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!useControlLinkUi.getState().from) return;
      useControlLinkUi.getState().cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The board header's "Link from …" hint, while a link is in progress. */
export function ControlLinkHint({ play }: { play: PlayRecord }) {
  const tk = useTokens();
  const from = useControlLinkUi(s => s.from);
  const cancel = useControlLinkUi(s => s.cancel);
  if (!from) return null;
  const label = play.controls.find(c => c.id === from)?.label ?? 'control';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 999, background: alpha(tk.accent.base, 0.14), color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
      <Icon name="link" size={13} />
      <span>Link from {label} — ⌘-click another control</span>
      <button type="button" onClick={cancel} title="Cancel (Esc)" style={{ display: 'inline-flex', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}>
        <Icon name="close" size={13} />
      </button>
    </span>
  );
}

/**
 * Wraps a control (or pair) card so ⌘-click picks it for the quick link instead of reaching its
 * slider: the pointerdown that would start a drag, and the click that would open a nested
 * button, are both swallowed in the capture phase whenever the modifier is held.
 */
export function LinkableControl({ id, play, onLink, children }: {
  id: string;
  play: PlayRecord;
  /** Applies the link (undoable) and toasts; called with (sourceId, targetId). */
  onLink: (sourceId: string, targetId: string) => void;
  children: React.ReactNode;
}) {
  const tk = useTokens();
  const anchor = useRef<HTMLDivElement>(null);
  const from = useControlLinkUi(s => s.from);
  const target = useControlLinkUi(s => s.target);
  const pick = useControlLinkUi(s => s.pick);
  const cancel = useControlLinkUi(s => s.cancel);
  const isFrom = from === id;
  const isTarget = target === id;

  const guard = (e: { metaKey: boolean; ctrlKey: boolean; preventDefault: () => void; stopPropagation: () => void }) => {
    if (!e.metaKey && !e.ctrlKey) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  return (
    <div
      ref={anchor}
      onPointerDownCapture={e => guard(e)}
      onClickCapture={e => { if (guard(e)) pick(id); }}
      style={{ borderRadius: radius.card, boxShadow: isFrom ? `0 0 0 2px ${tk.accent.base}` : undefined, transition: 'box-shadow 120ms ease' }}
    >
      {children}
      {isTarget && <LinkDirectionPopover play={play} sourceId={from} targetId={id} anchorRef={anchor} onLink={onLink} onClose={cancel} />}
    </div>
  );
}

function LinkDirectionPopover({ play, sourceId, targetId, anchorRef, onLink, onClose }: {
  play: PlayRecord;
  sourceId: string;
  targetId: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onLink: (sourceId: string, targetId: string) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const a = play.controls.find(c => c.id === sourceId);
  const b = play.controls.find(c => c.id === targetId);
  // A control vanished (removed) while the popover was open: close instead of updating state
  // mid-render.
  useEffect(() => { if (!a || !b) onClose(); }, [a, b, onClose]);
  if (!a || !b) return null;
  const existing = findControlLink(play, sourceId, targetId);
  const row = (text: React.ReactNode, onSelect: () => void, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => { onSelect(); onClose(); }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 32, padding: '0 10px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.background = tk.bg.hover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {text}
    </button>
  );
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} align="start" width={280} padding={6}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {existing ? (
          row(<>Open mapping</>, () => usePlayUi.getState().setTab('mappings'), 'open')
        ) : (
          <>
            {row(<>Link <b>{a.label}</b> → <b>{b.label}</b></>, () => onLink(sourceId, targetId), 'a-b')}
            {row(<>Link <b>{b.label}</b> → <b>{a.label}</b></>, () => onLink(targetId, sourceId), 'b-a')}
          </>
        )}
        <div style={{ height: 1, margin: '2px 0', background: tk.border.subtle }} />
        {row(<span style={{ color: tk.text.faint }}>Cancel <Kbd combo="escape" /></span>, () => {}, 'cancel')}
      </div>
    </Popover>
  );
}

/** Applies a quick link (undoable through `update`) and toasts, offering to open Mappings. */
export function applyControlLink(play: PlayRecord, update: (fn: (p: PlayRecord) => PlayRecord) => void, sourceId: string, targetId: string): void {
  const source = play.controls.find(c => c.id === sourceId), target = play.controls.find(c => c.id === targetId);
  if (!source || !target) return;
  let ok = false;
  update(p => { const r = linkControls(p, sourceId, targetId); ok = !!r; return r ? r.play : p; });
  if (!ok) return;
  toast.success(`Linked ${source.label} → ${target.label}`, {
    message: 'Tune its range and curve in Mappings.',
    action: { label: 'Open in Mappings', onClick: () => usePlayUi.getState().setTab('mappings') },
  });
}
