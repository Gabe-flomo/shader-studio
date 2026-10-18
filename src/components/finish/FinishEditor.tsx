/**
 * FinishEditor — the one Finish, wherever it is edited (docs/finish-stack.md, "One Finish").
 *
 * The graph has one Finish: `play.finish`, a stack of whole-picture effects (grade, lens, film,
 * CRT, shake, time…) applied after the graph and Play's layers, in the preview, renders and
 * exports. Play's Finish rail, the 2D builder's Look → Finish card and the Studio's Finish button
 * all show this same component on that same stack, so a grade made in one is the grade in all.
 *
 *   FinishEditor   the stack, read from and written to the graph store (locked on Free)
 *   FinishButton   the Studio preview header's entry: opens the Finish panel
 *   FinishDrawer   that panel: a floating window on a desktop, a bottom sheet on a phone
 */
import { create } from 'zustand';
import { lazy, Suspense, useEffect } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { openProSheet, useCan } from '../../lib/plan';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { usePhoneDialog } from '../ui/phoneDialog';

/** The Finish's own words, the same everywhere it shows. */
// The stack's editor loads when it is first shown (it is large), not with the app.
const PictureFinish = lazy(() => import('../play/finish/FinishPanel').then(m => ({ default: m.PictureFinish })));

export const FINISH_BLURB = 'The Finish works on the whole picture after the graph: grade, lens, film, CRT, shake and time effects. One per graph: the same stack as Play → Finish, the Studio’s Finish button and the builder’s Finish card. Effects that build nodes into the graph are on the Effects page.';

export function FinishEditor({ touch = false, wide = false, embedded = false }: { touch?: boolean; wide?: boolean; embedded?: boolean }) {
  const play = useNodeGraphStore(s => s.play);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const ok = useCan('play.finish');
  if (!ok) return <FinishLocked count={play.finish?.effects.length ?? 0} />;
  return <Suspense fallback={null}><PictureFinish play={play} onChange={fn => setPlay(fn)} touch={touch} wide={wide} embedded={embedded} /></Suspense>;
}

function FinishLocked({ count }: { count: number }) {
  const tk = useTokens();
  return (
    <div data-finish-locked style={{ padding: '12px 12px 10px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="lock" size={14} style={{ color: tk.text.faint }} />
        <b style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>The Finish is part of Pro</b>
      </div>
      <span style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
        Colour grading with curves and wheels, lens, CRT, glow, film grain, camera shake and time effects over the whole picture.
        {count > 0 ? ` This graph’s ${count === 1 ? 'effect is' : `${count} effects are`} kept as they are, and play again with Pro.` : ''}
      </span>
      <div><Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('play.finish')}>See what Pro adds</Button></div>
    </div>
  );
}

// ── The Studio's Finish panel ────────────────────────────────────────────────

export const useFinishDrawer = create<{ open: boolean; toggle: () => void; close: () => void; show: () => void }>(set => ({
  open: false,
  toggle: () => set(s => ({ open: !s.open })),
  close: () => set({ open: false }),
  show: () => set({ open: true }),
}));

/** The preview header's Finish button: how many effects the stack has, and the panel on a click. */
export function FinishButton() {
  const n = useNodeGraphStore(s => (s.play.finish?.on ? s.play.finish.effects.filter(e => e.enabled).length : 0));
  const open = useFinishDrawer(s => s.open), toggle = useFinishDrawer(s => s.toggle);
  return (
    <Button size="sm" variant={open ? 'primary' : 'ghost'} icon="curve" data-finish-button onClick={toggle}
      title="Finish: grade, lens, film and time effects over the whole picture (the same stack as Play → Finish)">
      {n ? `Finish · ${n}` : 'Finish'}
    </Button>
  );
}

/** The Finish panel the Studio opens: a floating window (desktop) or a bottom sheet (phone). */
export function FinishDrawer() {
  const tk = useTokens();
  const open = useFinishDrawer(s => s.open), close = useFinishDrawer(s => s.close);
  const phone = usePhoneDialog();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  if (!open) return null;
  const box = phone
    ? { left: 0, right: 0, bottom: 0, height: '78vh', borderRadius: '14px 14px 0 0' }
    : { right: 16, top: 96, width: 420, height: 'min(720px, calc(100vh - 128px))', borderRadius: radius.card };
  return (
    <div data-finish-drawer role="dialog" aria-label="Finish" style={{
      position: 'fixed', zIndex: 450, ...box, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`,
      boxShadow: '0 20px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(127,127,127,0.18)',
    }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 8px 14px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
        <Icon name="curve" size={15} style={{ color: tk.accent.base }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `650 13px ${fontFamily.ui}` }}>Finish</div>
          <div style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>The whole picture, after the graph · the same stack as Play → Finish</div>
        </div>
        <IconButton icon="close" label="Close the Finish" size="sm" onClick={close} />
      </div>
      <FinishEditor touch={phone} />
    </div>
  );
}
