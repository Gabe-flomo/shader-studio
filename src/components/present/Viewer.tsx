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
 * Both have Full screen (the button, F, or ⌘⇧F): the presentation alone,
 * its controls fading after a moment without the mouse; arrows still step,
 * Esc leaves full screen, then goes back to Edit.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { isFullscreenKey, isTyping, toggleFullscreenTarget, useFullscreen } from '../../lib/fullscreen';
import type { BlockContext } from './Blocks';
import { StepView } from './StepView';
import { usePresentation } from './presentationStore';
import { openOnStage } from './stageHandoff';
import { Backdrop } from './Backdrop';
import { lookVars, ThemeScope, useColumn, useImageMap, usePageBackground, useStepLook } from './presentLook';
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
      else if (e.key === 'Escape' && !document.fullscreenElement && !useFullscreen.getState().target) onExit();
    };
    // F alone: full screen. On the document while capturing, so the app's own F (fit the graph) doesn't see it.
    const onF = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || !isFullscreenKey(e, { typing: isTyping(e.target), plainF: true })) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      void toggleFullscreenTarget('present');
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onF, true);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onF, true); };
  }, [go, onExit]);
}

/** True after `ms` without the pointer or a key, while `active`: full screen's controls fade then. */
function useIdle(active: boolean, ms = 2500): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!active) return;
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), ms); };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => { window.clearTimeout(t); setIdle(false); window.removeEventListener('pointermove', wake); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  }, [active, ms]);
  return active && idle;
}

/** The nav bar over the picture in full screen, fading while nothing moves. */
function FloatingControls({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', bottom: 18, left: '50%', transform: `translate(-50%, ${hidden ? 12 : 0}px)`, zIndex: 3,
      opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : undefined, transition: 'opacity .35s ease, transform .35s ease',
    }}>{children}</div>
  );
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
        ? { borderRadius: 22, background: `var(--pp-surface, ${tk.bg.panel})`, boxShadow: tk.shadow.popover, border: `1px solid ${tk.border.default}` }
        : { borderTop: `1px solid ${tk.border.default}`, background: `var(--pp-surface, ${tk.bg.panel})` }),
    }}>
      <IconButton icon="chevL" label="Previous step (←)" disabled={index <= 0} onClick={() => onGo(index - 1)} />
      {!floating && (
        <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }} role="tablist" aria-label="Steps">
          {Array.from({ length: total }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === index} title={`${i + 1}. ${titles[i] || 'Untitled step'}`} onClick={() => onGo(i)}
              style={{ flex: 1, height: 18, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <span style={{ width: '100%', height: 4, borderRadius: 2, background: i <= index ? `var(--pp-accent, ${tk.accent.base})` : tk.border.strong, opacity: i === index ? 1 : i < index ? 0.55 : 1, transition: 'background .2s' }} />
            </button>
          ))}
        </div>
      )}
      <span style={{ color: tk.text.muted, font: `600 12px ${fontFamily.mono}`, whiteSpace: 'nowrap', minWidth: 44, textAlign: 'center' }}>{index + 1} / {total}</span>
      <IconButton icon="chevR" label="Next step (→)" disabled={index >= total - 1} onClick={() => onGo(index + 1)} />
      {onStage && <IconButton icon="popout" label="Open this step’s picture on the Stage" onClick={onStage} />}
      {onFullscreen && <IconButton icon="fit" label={fullscreen ? 'Leave full screen' : 'Full screen'} shortcut={fullscreen ? 'escape' : 'f'} active={fullscreen} onClick={onFullscreen} />}
    </div>
  );
}

export function SlidesView({ ctx }: { ctx: Omit<BlockContext, 'active' | 'editing' | 'large'> }) {
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
  const fs = useFullscreen(s => s.target === 'present');
  const idle = useIdle(fs);
  const toggleFs = () => { void toggleFullscreenTarget('present'); };
  const step = doc?.steps[index];
  const look = useStepLook(step);
  const pageBg = usePageBackground(true);
  const column = useColumn('slides');
  if (!doc || !step) return null;
  const full: BlockContext = { ...ctx, editing: false, active: true, large: !ctx.compact };
  // The step's first canvas, for the Stage button.
  const first = step.blocks.find(b => (b.type === 'render' || b.type === 'interactive') && ctx.sources.has(b.source));
  const firstSource = first && (first.type === 'render' || first.type === 'interactive') ? ctx.sources.get(first.source) : undefined;
  const onStage = firstSource ? () => openOnStage(doc, firstSource, step) : undefined;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', cursor: fs && idle ? 'none' : undefined, ...pageBg }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* Keyed by step: the next background fades in over the last. */}
        <Backdrop key={step.id} look={look} column={column} style={{ animation: 'pp-fade .35s ease-out' }} />
        <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', zIndex: 1, ...lookVars(look) }}>
          <div key={step.id} style={{
            maxWidth: column + 112, margin: '0 auto', boxSizing: 'border-box', minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
            padding: ctx.compact ? '22px 16px 28px' : '44px 56px 44px', animation: 'pp-in .28s ease-out',
          }}>
            <ThemeScope><StepView step={step} index={index} total={total} ctx={full} /></ThemeScope>
          </div>
        </div>
      </div>
      {fs
        ? <FloatingControls hidden={idle}><ThemeScope><NavBar floating index={index} total={total} titles={doc.steps.map(s => s.title ?? '')} onGo={i => setStep(i)} fullscreen onFullscreen={toggleFs} /></ThemeScope></FloatingControls>
        : <ThemeScope><NavBar index={index} total={total} titles={doc.steps.map(s => s.title ?? '')} onGo={i => setStep(i)} fullscreen={false} onFullscreen={toggleFs} onStage={onStage} /></ThemeScope>}
    </div>
  );
}

export function ScrollView({ ctx }: { ctx: Omit<BlockContext, 'active' | 'editing' | 'large'> }) {
  const tk = useTokens();
  const pageBg = usePageBackground(true);
  const column = useColumn('scroll');
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
  const fs = useFullscreen(s => s.target === 'present');
  const idle = useIdle(fs);
  if (!doc) return null;
  const c: BlockContext = { ...ctx, editing: false, active: true, large: false };
  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', ...pageBg }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, zIndex: 3, background: alpha(tk.accent.base, 0.12) }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: `var(--pp-accent, ${tk.accent.base})`, transition: 'width .08s linear' }} />
      </div>
      <div ref={scroller} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', ['--pp-vh' as string]: viewH ? `${viewH}px` : '100vh' }}>
        {doc.steps.map((s, i) => (
          <ScrollSection key={s.id} step={s} index={i} total={total} ctx={c} look={looks[i]} column={column} prevBg={i > 0 && !!looks[i - 1].bg} last={i === total - 1}
            title={i === 0 ? doc.title : undefined}
            sectionRef={el => { if (el) sections.current.set(i, el); else sections.current.delete(i); }} />
        ))}
      </div>
      <FloatingControls hidden={fs && idle}>
        <ThemeScope><NavBar floating index={current} total={total} titles={doc.steps.map(s => s.title ?? '')} onGo={jump} fullscreen={fs} onFullscreen={() => { void toggleFullscreenTarget('present'); }} /></ThemeScope>
      </FloatingControls>
    </div>
  );
}

/**
 * One step of the Scroll view: full width, so its background runs edge to
 * edge; the background is sticky (it stays put while a long step scrolls by,
 * then leaves with it) and clipped to the step. The first carries the title.
 */
function ScrollSection({ step, index, total, ctx, look, column, prevBg, last, title, sectionRef }: {
  step: Step; index: number; total: number; ctx: BlockContext; look: StepLook; column: number; prevBg: boolean; last: boolean; title?: string;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const tk = useTokens();
  const bg = !!look.bg;
  const pad = `calc(${ctx.compact ? 44 : 64}px * var(--pp-space, 1))`;
  // Two plain steps in a row get a rule between them, as on paper; a background is its own divider.
  const rule = index > 0 && !bg && !prevBg;
  return (
    <section ref={sectionRef} style={{ position: 'relative', clipPath: bg ? 'inset(0)' : undefined, scrollMarginTop: 0, ...lookVars(look) }}>
      {bg && (
        <div style={{ position: 'sticky', top: 0, height: 'var(--pp-vh, 100vh)', marginBottom: 'calc(-1 * var(--pp-vh, 100vh))', zIndex: 0 }}>
          <Backdrop look={look} column={column} />
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: column + 96, margin: '0 auto', boxSizing: 'border-box', padding: ctx.compact ? '0 16px' : '0 48px' }}>
        <div style={{ borderTop: rule ? `1px solid var(--pp-rule, ${tk.border.default})` : undefined, paddingTop: title ? (ctx.compact ? 26 : 56) : pad, paddingBottom: last ? (ctx.compact ? 120 : 160) : pad }}>
          {title && (
            <>
              <h1 className="pp-title" style={{ margin: '0 0 8px', fontSize: `calc(${ctx.compact ? 28 : 38}px * var(--pp-scale, 1) * var(--pp-title, 1))`, letterSpacing: 'var(--pp-track, -0.02em)', lineHeight: 1.15 }}>{title}</h1>
              <div style={{ color: `var(--pp-muted, ${tk.text.faint})`, font: `500 13px ${fontFamily.ui}`, marginBottom: ctx.compact ? 30 : 48 }}>{total} step{total === 1 ? '' : 's'}</div>
            </>
          )}
          <ThemeScope><StepView step={step} index={index} total={total} ctx={ctx} /></ThemeScope>
        </div>
      </div>
    </section>
  );
}
