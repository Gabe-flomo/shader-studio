/**
 * Viewer — the presentation as learners get it, read-only:
 *
 *   Slides  one step fills the page, for teaching in the room: ← / → (and
 *           Space, Page Up / Down, Home, End), a progress bar you can click,
 *           fullscreen, and Stage (this step's first canvas on the Stage).
 *           Only this step's canvases run.
 *   Scroll  every step on one page, for reading alone: canvases run while
 *           they're on screen, a progress bar along the top, ← / → jump
 *           between steps.
 *
 * Esc goes back to Edit.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { paperStyle } from './paper';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import type { BlockContext } from './Blocks';
import { StepView } from './StepView';
import { usePresentation } from './presentationStore';
import { openOnStage } from './stageHandoff';
import { Backdrop } from './Backdrop';
import { COLUMN, lookVars, useImageMap, useStepLook } from './presentLook';
import { stepLook, type StepLook } from '../../types/presentationStyle';
import type { Step } from '../../types/presentation';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

function useNavKeys(go: (d: number | 'first' | 'last') => void, onExit: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') { e.preventDefault(); go('first'); }
      else if (e.key === 'End') { e.preventDefault(); go('last'); }
      else if (e.key === 'Escape' && !document.fullscreenElement) onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onExit]);
}

/** The bar under the slides: back, progress (click to jump), where you are, next. */
function NavBar({ index, total, titles, onGo, fullscreen, onFullscreen, onStage, floating }: {
  index: number; total: number; titles: string[]; onGo: (i: number) => void; fullscreen?: boolean; onFullscreen?: () => void; onStage?: () => void; floating?: boolean;
}) {
  const tk = useTokens();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: floating ? '6px 8px' : '10px 16px',
      ...(floating
        ? { borderRadius: 22, background: tk.bg.panel, boxShadow: tk.shadow.popover, border: `1px solid ${tk.border.default}` }
        : { borderTop: `1px solid ${tk.border.default}`, background: tk.bg.panel }),
    }}>
      <IconButton icon="chevL" label="Previous step (←)" disabled={index <= 0} onClick={() => onGo(index - 1)} />
      {!floating && (
        <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }} role="tablist" aria-label="Steps">
          {Array.from({ length: total }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === index} title={`${i + 1}. ${titles[i] || 'Untitled step'}`} onClick={() => onGo(i)}
              style={{ flex: 1, height: 18, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <span style={{ width: '100%', height: 4, borderRadius: 2, background: i <= index ? tk.accent.base : tk.border.strong, opacity: i === index ? 1 : i < index ? 0.55 : 1, transition: 'background .2s' }} />
            </button>
          ))}
        </div>
      )}
      <span style={{ color: tk.text.muted, font: `600 12px ${fontFamily.mono}`, whiteSpace: 'nowrap', minWidth: 44, textAlign: 'center' }}>{index + 1} / {total}</span>
      <IconButton icon="chevR" label="Next step (→)" disabled={index >= total - 1} onClick={() => onGo(index + 1)} />
      {onStage && <IconButton icon="popout" label="Open this step’s picture on the Stage" onClick={onStage} />}
      {onFullscreen && <IconButton icon="fit" label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} active={fullscreen} onClick={onFullscreen} />}
    </div>
  );
}

export function SlidesView({ ctx, rootRef }: { ctx: Omit<BlockContext, 'active' | 'editing' | 'large'>; rootRef: React.RefObject<HTMLElement | null> }) {
  const tk = useTokens();
  const dark = useThemeStore(s => s.mode) === 'dark';
  const doc = usePresentation(s => s.doc);
  const index = usePresentation(s => s.step);
  const setStep = usePresentation(s => s.setStep);
  const setMode = usePresentation(s => s.setMode);
  const scroller = useRef<HTMLDivElement>(null);
  const total = doc?.steps.length ?? 0;
  const go = useMemo(() => (d: number | 'first' | 'last') => {
    const cur = usePresentation.getState().step;
    setStep(d === 'first' ? 0 : d === 'last' ? total - 1 : cur + d);
  }, [setStep, total]);
  const exit = useMemo(() => () => setMode('edit'), [setMode]);
  useNavKeys(go, exit);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [index]);
  const [fs, setFs] = useState(!!document.fullscreenElement);
  useEffect(() => { const on = () => setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on); }, []);
  const toggleFs = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void rootRef.current?.requestFullscreen?.().catch(() => {}); };
  const step = doc?.steps[index];
  const look = useStepLook(step);
  if (!doc || !step) return null;
  const full: BlockContext = { ...ctx, editing: false, active: true, large: !ctx.compact };
  // The step's first canvas, for the Stage button.
  const first = step.blocks.find(b => (b.type === 'render' || b.type === 'interactive') && ctx.sources.has(b.source));
  const firstSource = first && (first.type === 'render' || first.type === 'interactive') ? ctx.sources.get(first.source) : undefined;
  const onStage = firstSource ? () => openOnStage(doc, firstSource, step) : undefined;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...paperStyle(tk.bg.app, dark) }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* Keyed by step: the next background fades in over the last. */}
        <Backdrop key={step.id} look={look} column={COLUMN.slides} style={{ animation: 'pp-fade .35s ease-out' }} />
        <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', zIndex: 1, ...lookVars(look) }}>
          <div key={step.id} style={{
            maxWidth: 1180, margin: '0 auto', boxSizing: 'border-box', minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
            padding: ctx.compact ? '22px 16px 28px' : '44px 56px 44px', animation: 'pp-in .28s ease-out',
          }}>
            <StepView step={step} index={index} total={total} ctx={full} />
          </div>
        </div>
      </div>
      <NavBar index={index} total={total} titles={doc.steps.map(s => s.title ?? '')} onGo={i => setStep(i)} fullscreen={fs} onFullscreen={ctx.compact ? undefined : toggleFs} onStage={onStage} />
    </div>
  );
}

export function ScrollView({ ctx }: { ctx: Omit<BlockContext, 'active' | 'editing' | 'large'> }) {
  const tk = useTokens();
  const dark = useThemeStore(s => s.mode) === 'dark';
  const doc = usePresentation(s => s.doc);
  const setMode = usePresentation(s => s.setMode);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef(new Map<number, HTMLElement>());
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(() => usePresentation.getState().step);
  const total = doc?.steps.length ?? 0;
  const images = useImageMap();
  const looks = useMemo(() => (doc?.steps ?? []).map(st => stepLook(doc?.style, images, st)), [doc?.steps, doc?.style, images]);
  // The scroller's height: a step's background stays in view (sticky) while its step scrolls past.
  const [viewH, setViewH] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);
  // Open where the Edit view was.
  useEffect(() => {
    const i = usePresentation.getState().step;
    if (i > 0) sections.current.get(i)?.scrollIntoView({ block: 'start' });
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setProgress(el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 1);
    const mid = el.getBoundingClientRect().top + el.clientHeight * 0.35;
    let c = 0;
    for (const [i, s] of sections.current) if (s.getBoundingClientRect().top <= mid) c = Math.max(c, i);
    setCurrent(c);
  };
  const jump = (i: number) => { const t = Math.max(0, Math.min(total - 1, i)); sections.current.get(t)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const go = useMemo(() => (d: number | 'first' | 'last') => {
    if (d === 'first') jump(0); else if (d === 'last') jump(total - 1); else jump(current + d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, total]);
  const exit = useMemo(() => () => { usePresentation.getState().setStep(current); setMode('edit'); }, [current, setMode]);
  useNavKeys(go, exit);
  if (!doc) return null;
  const c: BlockContext = { ...ctx, editing: false, active: true, large: false };
  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', ...paperStyle(tk.bg.app, dark) }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, zIndex: 3, background: alpha(tk.accent.base, 0.12) }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: tk.accent.base, transition: 'width .08s linear' }} />
      </div>
      <div ref={scroller} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', ['--pp-vh' as string]: viewH ? `${viewH}px` : '100vh' }}>
        {doc.steps.map((s, i) => (
          <ScrollSection key={s.id} step={s} index={i} total={total} ctx={c} look={looks[i]} prevBg={i > 0 && !!looks[i - 1].bg} last={i === total - 1}
            title={i === 0 ? doc.title : undefined}
            sectionRef={el => { if (el) sections.current.set(i, el); else sections.current.delete(i); }} />
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 3 }}>
        <NavBar floating index={current} total={total} titles={doc.steps.map(s => s.title ?? '')} onGo={jump} />
      </div>
    </div>
  );
}

/**
 * One step of the Scroll view: full width, so its background runs edge to
 * edge; the background is sticky (it stays put while a long step scrolls by,
 * then leaves with it) and clipped to the step. The first carries the title.
 */
function ScrollSection({ step, index, total, ctx, look, prevBg, last, title, sectionRef }: {
  step: Step; index: number; total: number; ctx: BlockContext; look: StepLook; prevBg: boolean; last: boolean; title?: string;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const tk = useTokens();
  const bg = !!look.bg;
  const pad = ctx.compact ? 44 : 64;
  // Two plain steps in a row get a rule between them, as on paper; a background is its own divider.
  const rule = index > 0 && !bg && !prevBg;
  return (
    <section ref={sectionRef} style={{ position: 'relative', clipPath: bg ? 'inset(0)' : undefined, scrollMarginTop: 0, ...lookVars(look) }}>
      {bg && (
        <div style={{ position: 'sticky', top: 0, height: 'var(--pp-vh, 100vh)', marginBottom: 'calc(-1 * var(--pp-vh, 100vh))', zIndex: 0 }}>
          <Backdrop look={look} column={COLUMN.scroll} />
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 920, margin: '0 auto', boxSizing: 'border-box', padding: ctx.compact ? '0 16px' : '0 48px' }}>
        <div style={{ borderTop: rule ? `1px solid var(--pp-rule, ${tk.border.default})` : undefined, paddingTop: title ? (ctx.compact ? 26 : 56) : pad, paddingBottom: last ? (ctx.compact ? 120 : 160) : pad }}>
          {title && (
            <>
              <h1 className="pp-title" style={{ margin: '0 0 8px', fontSize: `calc(${ctx.compact ? 28 : 38}px * var(--pp-scale, 1))`, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{title}</h1>
              <div style={{ color: `var(--pp-muted, ${tk.text.faint})`, font: `500 13px ${fontFamily.ui}`, marginBottom: ctx.compact ? 30 : 48 }}>{total} step{total === 1 ? '' : 's'}</div>
            </>
          )}
          <StepView step={step} index={index} total={total} ctx={ctx} />
        </div>
      </div>
    </section>
  );
}
