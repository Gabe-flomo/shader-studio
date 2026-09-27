/**
 * PresentPage — teach a concept step by step with Plays (docs/present-plan.md).
 *
 * A presentation is a list of steps made of blocks (text with maths, a Play's
 * picture, an interactive picture with some of its controls, code), reading
 * from snapshots of Plays. Three views of it:
 *
 *   Edit    the steps on the left, the step in the middle, the selected
 *           block's settings (or the step's, and the sources) on the right
 *   Slides  one step at a time, for the room
 *   Scroll  all of it on one page, for reading alone
 *
 * Phones get one column: the steps as a strip of numbers, settings in a
 * sheet. Markdown and KaTeX load with this page, not with the app.
 */
import { reportFileResult } from '../shell/reportFileResult';
import { exportPresentationPlayfile } from '../../playfile/app';
import { openBackgrounds, openCapture } from '../backgrounds/backgroundsUi';
import { useEffect, useMemo, useRef, useState } from 'react';
import { paperStyle } from './paper';
import { exitFullscreen, registerFullscreenTarget, useFullscreen } from '../../lib/fullscreen';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { Sheet } from '../ui/Sheet';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import type { Page } from '../page';
import { listPresentations, lastPresentation, savePresentation, PRESENTATIONS_CHANGED, type PresentationEntry } from '../../present/storage';
import { internStoredPresentations } from '../../present/presentAssets';
import { SAMPLE_GROUPS, SAMPLE_PRESENTATIONS, type SamplePresentation } from '../../present/samples';
import { usePresentation, type PresentMode } from './presentationStore';
import { Inspector } from './Inspector';
import { StepsList, StepsStrip } from './StepsList';
import { StepView } from './StepView';
import { ScrollView, SlidesView } from './Viewer';
import { loadMarkdown } from './useMarkdown';
import { presentCss } from './presentCss';
import { usePosters } from './usePosters';
import { useSampleStills } from './useSampleStills';
import { ExportDialog } from './ExportDialog';
import { deleteWithUndo, exportPresentationFile, importPresentationFile, saveCopy } from './presentationFiles';
import { PresentationsDialog } from './PresentationsDialog';
import { announcePresentationOpened } from './linkActions';
import { whenSaved } from '../../store/graphVersions';
import type { BlockContext } from './Blocks';
import { useCamera } from '../../present/runtimeHost';
import { Backdrop, MissingImageNote } from './Backdrop';
import { lookVars, ThemeScope, useColumn, usePageBackground, usePageVars, usePresentFonts, useStepLook } from './presentLook';

function usePresentationList(): PresentationEntry[] {
  const [list, setList] = useState(listPresentations);
  useEffect(() => {
    const on = () => setList(listPresentations());
    window.addEventListener(PRESENTATIONS_CHANGED, on);
    return () => window.removeEventListener(PRESENTATIONS_CHANGED, on);
  }, []);
  return list;
}

async function openSample(sample: SamplePresentation): Promise<void> {
  try {
    const doc = await sample.build();
    usePresentation.getState().adopt(doc);
  } catch (e) {
    toast.error('Couldn’t build the sample', { message: e instanceof Error ? e.message : String(e) });
  }
}

async function newPresentation(): Promise<void> {
  const title = await askText('New presentation', { label: 'Title', initial: 'Untitled presentation', confirmLabel: 'Create' });
  if (title) usePresentation.getState().create(title);
}

export function PresentPage({ compact = false, onNavigate }: { compact?: boolean; onNavigate: (p: Page) => void }) {
  const tk = useTokens();
  const dark = useThemeStore(s => s.mode) === 'dark';
  const doc = usePresentation(s => s.doc);
  const mode = usePresentation(s => s.mode);
  const list = usePresentationList();
  const rootRef = useRef<HTMLDivElement>(null);
  // Full screen is the page itself, without its header; from Edit it opens Slides first. Back in Edit, or leaving the page, ends it.
  const fullscreen = useFullscreen(s => s.target === 'present');
  useEffect(() => {
    registerFullscreenTarget('present', rootRef.current, () => { if (usePresentation.getState().mode === 'edit') usePresentation.getState().setMode('slides'); });
    return () => { registerFullscreenTarget('present', null); if (useFullscreen.getState().target === 'present') void exitFullscreen(); };
  }, []);
  useEffect(() => { if (mode === 'edit' && useFullscreen.getState().target === 'present') void exitFullscreen(); }, [mode]);
  const [exporting, setExporting] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  // Markdown and KaTeX: fetched now that the page is open.
  useEffect(() => { void loadMarkdown(); }, []);
  // Saved presentations that still carry embedded pictures or font files (from before, or restored from a ZIP) move them into the library.
  useEffect(() => { void internStoredPresentations(savePresentation); }, []);
  // Open the last presentation (or the newest) when there's none open.
  useEffect(() => {
    if (usePresentation.getState().doc) return;
    const last = lastPresentation();
    const st = usePresentation.getState();
    if (last && st.open(last)) return;
    if (list[0]) st.open(list[0].name);
  }, [list]);
  usePosters();
  // The camera stays on only while the page is open (it's turned on for the page, not per canvas).
  useEffect(() => () => useCamera.getState().stop(), []);

  const css = useMemo(() => presentCss(tk), [tk]);
  const fonts = usePresentFonts();
  const page = usePageVars();
  const ctx: Omit<BlockContext, 'active' | 'editing' | 'large'> = useMemo(() => ({
    sources: new Map((doc?.sources ?? []).map(s => [s.id, s])),
    sandbox: doc?.origin === 'imported',
    compact,
  }), [doc?.sources, doc?.origin, compact]);

  return (
    <div ref={rootRef} {...(doc ? page.attrs : {})} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', ...paperStyle(tk.bg.app, dark), color: tk.text.primary, font: `13px ${fontFamily.ui}`, ...(doc ? page.style : {}) }}>
      <style>{css}</style>
      {fonts && <style>{fonts}</style>}
      {!fullscreen && <Header compact={compact} list={list} onExport={() => setExporting(true)} onBrowse={() => setBrowsing(true)} />}
      {!doc ? <EmptyState compact={compact} /> : mode === 'slides' ? <SlidesView ctx={ctx} /> : mode === 'scroll' ? <ScrollView ctx={ctx} /> : compact ? <EditPhone ctx={ctx} onNavigate={onNavigate} /> : <EditDesktop ctx={ctx} onNavigate={onNavigate} />}
      {exporting && doc && <ExportDialog onClose={() => setExporting(false)} />}
      {browsing && <PresentationsDialog list={list} compact={compact} onClose={() => setBrowsing(false)} onNew={() => void newPresentation()} />}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({ compact, list, onExport, onBrowse }: { compact: boolean; list: PresentationEntry[]; onExport: () => void; onBrowse: () => void }) {
  const tk = useTokens();
  const name = usePresentation(s => s.name);
  const doc = usePresentation(s => s.doc);
  const mode = usePresentation(s => s.mode);
  const setMode = usePresentation(s => s.setMode);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const titleRef = useRef<HTMLButtonElement>(null);

  const others = list.filter(p => p.name !== name).slice(0, 5);
  const items: MenuItem[] = [
    ...(others.length ? [
      ...others.map(p => ({ label: p.name, icon: 'slides' as const, hint: `${p.steps} step${p.steps === 1 ? '' : 's'}${p.updatedAt ? ` · ${whenSaved(p.updatedAt)}` : ''}`, onSelect: () => { if (usePresentation.getState().open(p.name)) announcePresentationOpened(p.name); } })),
    ] : []),
    { label: list.length ? `All presentations (${list.length})…` : 'All presentations…', icon: 'folder', hint: 'Search, folders, download, delete', onSelect: onBrowse },
    'separator',
    { label: 'New presentation…', icon: 'plus', onSelect: () => void newPresentation() },
    { label: 'Import a .present.json file…', icon: 'import', onSelect: () => void importPresentationFile() },
    'separator',
    { heading: 'Backgrounds' },
    { label: 'Capture a background…', icon: 'camera', hint: 'A still from any graph at the moment you choose, 1920 × 1080 or up to 4K, kept in the Library', onSelect: () => { void openCapture({ aspect: 16 / 9 }); } },
    { label: 'Your backgrounds…', icon: 'overlay', hint: 'Image backgrounds and palettes in the Library', onSelect: () => { void openBackgrounds(); } },
    // The samples, under a heading per group.
    ...SAMPLE_GROUPS.flatMap(g => [
      'separator' as const,
      { heading: `Samples: ${g.label.toLowerCase()}` },
      ...SAMPLE_PRESENTATIONS.filter(sample => sample.group === g.id).map(sample => ({ label: sample.title, icon: 'spark' as const, hint: sample.hint, onSelect: () => void openSample(sample) })),
    ]),
    ...(doc ? [
      'separator' as const,
      { label: 'Rename…', icon: 'edit' as const, onSelect: async () => {
        const t = await askText('Rename presentation', { label: 'Title', initial: name ?? '', confirmLabel: 'Rename' });
        if (t && !usePresentation.getState().rename(t)) toast.error('That name is taken', { message: `There's already a presentation called “${t}”.` });
      } },
      { label: 'Save a copy…', icon: 'copy' as const, hint: 'Under a new name; the copy opens', onSelect: async () => {
        const t = await askText('Save a copy', { label: 'Title of the copy', initial: `${name ?? doc.title} copy`, confirmLabel: 'Save the copy' });
        if (t) { const n = saveCopy(t); if (n) toast.success(`Saved a copy: “${n}”`, { message: 'The copy is open now.' }); }
      } },
      { label: 'Download as .playfile', icon: 'export' as const, hint: 'Every Play, picture and font in it, and the graphs it was made from: opens in Playfield anywhere', onSelect: () => { if (name) void exportPresentationPlayfile(name, doc).then(r => reportFileResult(r, { failTitle: 'Couldn’t download the presentation' })); } },
      { label: 'Download as .present.json', icon: 'code' as const, hint: 'A readable presentation file with every Play in it', onSelect: () => void exportPresentationFile() },
      { label: 'Export as a web page…', icon: 'code' as const, hint: 'One HTML file, slides or one long page', onSelect: onExport },
      'separator' as const,
      { label: 'Delete', icon: 'trash' as const, danger: true, hint: 'You can undo it for a few seconds', onSelect: () => { if (name) deleteWithUndo(name); } },
    ] : []),
  ];
  const modeLabel = (icon: 'edit' | 'slides' | 'scroll', text: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={icon} size={compact ? 15 : 13} />{!compact && text}</span>
  );
  const modes: { value: PresentMode; label: React.ReactNode; title: string }[] = [
    { value: 'edit', label: modeLabel('edit', 'Edit'), title: 'Build the steps' },
    { value: 'slides', label: modeLabel('slides', 'Slides'), title: 'One step at a time, for teaching in the room (← →)' },
    { value: 'scroll', label: modeLabel('scroll', 'Scroll'), title: 'Everything on one page, for reading alone' },
  ];
  return (
    <div style={{ height: compact ? 48 : 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: compact ? 4 : 10, padding: compact ? '0 6px 0 8px' : '0 14px 0 16px', background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}` }}>
      <button
        ref={titleRef} type="button" aria-haspopup="menu" title="Presentation: open, new, import, rename, copy, download, delete"
        onClick={() => { const r = titleRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.left, y: r.bottom + 6 } : null); }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1, maxWidth: compact ? undefined : 380, height: 34, padding: compact ? '0 4px' : '0 8px 0 6px', border: 0, borderRadius: radius.control, background: menu ? tk.bg.hover : 'transparent', cursor: 'pointer', color: tk.text.primary }}
      >
        {!compact && <span style={{ width: 24, height: 24, borderRadius: radius.sm, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.14), color: tk.accent.base }}><Icon name="slides" size={14} /></span>}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `650 13.5px ${fontFamily.ui}` }}>{doc?.title ?? 'Presentations'}</span>
        <Icon name="chevD" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      </button>
      {doc && <SaveStatus compact={compact} />}
      <span style={{ flex: 1 }} />
      {!compact && <Button size="sm" variant="ghost" icon="folder" onClick={onBrowse} title="Every presentation saved here: open, search, folders, download, delete">Open</Button>}
      {compact && <IconButton icon="folder" label="Presentations" tooltip={false} onClick={onBrowse} style={{ width: 34, height: 36 }} />}
      {doc && <Segmented size={compact ? 'sm' : 'md'} ariaLabel="View" value={mode} onChange={setMode} options={modes} />}
      {doc && !compact && <Button size="sm" icon="export" onClick={onExport} title="A web page (slides or scroll) or a presentation file">Export</Button>}
      {doc && compact && <IconButton icon="export" label="Export" tooltip={false} onClick={onExport} style={{ width: 34, height: 36 }} />}
      {menu && <Menu x={menu.x} y={menu.y} minWidth={270} title="Presentations" items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Saved, saving or not saved: always in sight, since there's no Save button (changes save themselves). */
function SaveStatus({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const status = usePresentation(s => s.status);
  const savedAt = usePresentation(s => s.savedAt);
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick(n => n + 1), 30000); return () => window.clearInterval(id); }, []);
  const when = savedAt ? whenSaved(savedAt) : '';
  const text = status === 'pending' ? 'Saving…' : status === 'failed' ? 'Not saved' : when === 'just now' || !when ? 'Saved' : `Saved ${when}`;
  const title = status === 'failed' ? 'The last change couldn’t be saved: the browser’s storage may be full (see Library)' : 'Changes save themselves in this browser half a second after you make them';
  const colour = status === 'failed' ? tk.status.danger : tk.text.faint;
  if (compact) {
    return (
      <span role="status" aria-label={text} title={title} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, color: status === 'failed' ? tk.status.danger : status === 'pending' ? tk.text.faint : tk.status.success }}>
        {status === 'failed' ? <Icon name="warning" size={14} /> : status === 'pending' ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: tk.text.faint }} /> : <Icon name="check" size={14} />}
      </span>
    );
  }
  return (
    <span role="status" title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: colour, font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
      {status === 'saved' && <Icon name="check" size={12} style={{ color: tk.status.success }} />}
      {status === 'failed' && <Icon name="warning" size={12} />}
      {text}
    </span>
  );
}

// ── No presentation yet ─────────────────────────────────────────────────────

function EmptyState({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const [busy, setBusy] = useState<string | null>(null);
  const stills = useSampleStills(SAMPLE_PRESENTATIONS);
  const open = async (sample: SamplePresentation) => { setBusy(sample.title); await openSample(sample); setBusy(null); };
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: compact ? '28px 16px 48px' : '56px 40px 72px', display: 'flex', flexDirection: 'column', gap: compact ? 30 : 44 }}>
        <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, maxWidth: 620 }}>
          <span style={{ width: 44, height: 44, borderRadius: radius.lg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}><Icon name="slides" size={22} /></span>
          <h2 style={{ margin: 0, font: `720 ${compact ? 24 : 30}px/1.15 ${fontFamily.ui}`, letterSpacing: '-0.02em', color: tk.text.primary }}>Teach with your Plays</h2>
          <p style={{ margin: 0, color: tk.text.muted, font: `500 ${compact ? 14 : 15}px/1.6 ${fontFamily.ui}` }}>
            Build a lesson step by step: text with maths, the pictures your graphs make, sliders to try, and the code behind them. Show it as slides in the room, or as one page to read.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <Button variant="primary" icon="plus" onClick={() => void newPresentation()}>New presentation</Button>
            <Button icon="import" onClick={() => void importPresentationFile()} title="Open a .present.json file">Import a file</Button>
            <Button variant="ghost" icon="camera" onClick={() => { void openCapture({ aspect: 16 / 9 }); }} title="A still from any graph, 1920 × 1080 or up to 4K, kept in the Library for step backgrounds">Capture a background</Button>
          </div>
        </section>
        {SAMPLE_GROUPS.map(g => (
          <section key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, font: `680 ${compact ? 15 : 16}px ${fontFamily.ui}`, color: tk.text.primary }}>{g.label}</h3>
              <span style={{ color: tk.text.faint, font: `500 12.5px ${fontFamily.ui}` }}>{g.blurb}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 150 : 170}px, 1fr))`, gap: compact ? 10 : 14 }}>
              {SAMPLE_PRESENTATIONS.filter(sample => sample.group === g.id).map(sample => (
                <SampleCard key={sample.title} sample={sample} still={stills[sample.title]} compact={compact}
                  busy={busy === sample.title} disabled={!!busy} onOpen={() => void open(sample)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function SampleCard({ sample, still, compact, busy, disabled, onOpen }: { sample: SamplePresentation; still: string | null | undefined; compact: boolean; busy: boolean; disabled: boolean; onOpen: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const lift = hover && !disabled;
  return (
    <button
      type="button" disabled={disabled} onClick={onOpen} title={`Open the sample “${sample.title}”`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0, padding: 0, textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${lift ? tk.border.strong : tk.border.default}`, borderRadius: radius.card, overflow: 'hidden',
        background: tk.bg.panel, color: tk.text.primary, font: 'inherit',
        boxShadow: lift ? tk.shadow.popover : 'none', transform: lift ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow 120ms ease, transform 120ms ease, border-color 120ms ease', opacity: disabled && !busy ? 0.6 : 1,
      }}
    >
      <span style={{ position: 'relative', display: 'block', aspectRatio: '16 / 9', background: `linear-gradient(135deg, ${tk.bg.render}, ${alpha(tk.accent.base, 0.35)})`, overflow: 'hidden' }}>
        {still
          ? <img src={still} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Icon name="slides" size={22} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: alpha('#ffffff', still === undefined ? 0.25 : 0.45) }} />}
        {busy && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff', font: `600 12.5px ${fontFamily.ui}` }}>Building it…</span>
        )}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: compact ? '9px 10px 11px' : '11px 13px 13px' }}>
        <span style={{ font: `640 ${compact ? 13 : 13.5}px/1.3 ${fontFamily.ui}` }}>{sample.title}</span>
        <span style={{ color: tk.text.muted, font: `500 ${compact ? 11.5 : 12}px/1.4 ${fontFamily.ui}`, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{sample.hint}</span>
      </span>
    </button>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────

function EditDesktop({ ctx, onNavigate }: { ctx: Omit<BlockContext, 'active' | 'editing' | 'large'>; onNavigate: (p: Page) => void }) {
  const tk = useTokens();
  const doc = usePresentation(s => s.doc);
  const index = usePresentation(s => s.step);
  const select = usePresentation(s => s.select);
  const step = doc?.steps[index];
  const look = useStepLook(step);
  const scroller = useRef<HTMLDivElement>(null);
  const pageBg = usePageBackground();
  const column = useColumn('edit');
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [index]);
  if (!doc || !step) return null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <aside style={{ width: 236, flexShrink: 0, borderRight: `1px solid ${tk.border.default}`, background: tk.bg.subtle }}><StepsList /></aside>
      <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', ...pageBg }}>
        <Backdrop look={look} column={column} />
        <main ref={scroller} onClick={() => select(null)} style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative', zIndex: 1, ...lookVars(look) }}>
          <div style={{ maxWidth: column + 96, margin: '0 auto', padding: '48px 48px 120px' }}>
            <ThemeScope>
              <MissingImageNote look={look} />
              <StepView step={step} index={index} total={doc.steps.length} ctx={{ ...ctx, editing: true, active: true, large: false }} />
            </ThemeScope>
          </div>
        </main>
      </div>
      <aside style={{ width: 340, flexShrink: 0, borderLeft: `1px solid ${tk.border.default}`, background: tk.bg.subtle, overflowY: 'auto' }}>
        <Inspector navigate={onNavigate} />
      </aside>
    </div>
  );
}

function EditPhone({ ctx, onNavigate }: { ctx: Omit<BlockContext, 'active' | 'editing' | 'large'>; onNavigate: (p: Page) => void }) {
  const tk = useTokens();
  const doc = usePresentation(s => s.doc);
  const index = usePresentation(s => s.step);
  const selected = usePresentation(s => s.selected);
  const select = usePresentation(s => s.select);
  const [sheet, setSheet] = useState(false);
  const step = doc?.steps[index];
  const look = useStepLook(step);
  const pageBg = usePageBackground();
  const column = useColumn('edit');
  if (!doc || !step) return null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <StepsStrip />
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', ...pageBg }}>
        <Backdrop look={look} column={column} />
        <main onClick={() => select(null)} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 16px 96px', position: 'relative', zIndex: 1, ...lookVars(look) }}>
          <ThemeScope>
            <MissingImageNote look={look} />
            <StepView step={step} index={index} total={doc.steps.length} ctx={{ ...ctx, editing: true, active: true, large: false }} />
          </ThemeScope>
        </main>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }}>
        <div style={{ display: 'flex', gap: 6, padding: 5, borderRadius: 24, background: tk.bg.panel, boxShadow: tk.shadow.popover, border: `1px solid ${tk.border.default}`, pointerEvents: 'auto' }}>
          <Button size="sm" variant="primary" icon="sliders" onClick={() => setSheet(true)} style={{ borderRadius: 18 }}>{selected ? 'Block settings' : 'Step and style'}</Button>
          {selected && <Button size="sm" variant="ghost" onClick={() => select(null)} style={{ borderRadius: 18 }}>Done</Button>}
        </div>
      </div>
      {sheet && (
        <Sheet title={selected ? 'Block settings' : `Step ${index + 1}`} onClose={() => setSheet(false)} maxHeight="82dvh">
          <Inspector navigate={onNavigate} compact />
        </Sheet>
      )}
    </div>
  );
}
