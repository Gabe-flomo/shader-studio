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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { Sheet } from '../ui/Sheet';
import { askConfirm, askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import type { Page } from '../page';
import { listPresentations, lastPresentation, PRESENTATIONS_CHANGED, type PresentationEntry } from '../../present/storage';
import { buildSamplePresentation, SAMPLE_TITLE } from '../../present/sample';
import { usePresentation, type PresentMode } from './presentationStore';
import { Inspector } from './Inspector';
import { StepsList, StepsStrip } from './StepsList';
import { StepView } from './StepView';
import { ScrollView, SlidesView } from './Viewer';
import { loadMarkdown, presentCss } from './Markdown';
import { usePosters } from './Sources';
import { ExportDialog, exportPresentationFile, importPresentationFile } from './ExportDialog';
import type { BlockContext } from './Blocks';

function usePresentationList(): PresentationEntry[] {
  const [list, setList] = useState(listPresentations);
  useEffect(() => {
    const on = () => setList(listPresentations());
    window.addEventListener(PRESENTATIONS_CHANGED, on);
    return () => window.removeEventListener(PRESENTATIONS_CHANGED, on);
  }, []);
  return list;
}

async function openSample(): Promise<void> {
  try {
    const doc = await buildSamplePresentation();
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
  const doc = usePresentation(s => s.doc);
  const mode = usePresentation(s => s.mode);
  const list = usePresentationList();
  const rootRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // Markdown and KaTeX: fetched now that the page is open.
  useEffect(() => { void loadMarkdown(); }, []);
  // Open the last presentation (or the newest) when there's none open.
  useEffect(() => {
    if (usePresentation.getState().doc) return;
    const last = lastPresentation();
    const st = usePresentation.getState();
    if (last && st.open(last)) return;
    if (list[0]) st.open(list[0].name);
  }, [list]);
  usePosters();

  const css = useMemo(() => presentCss(tk), [tk]);
  const ctx: Omit<BlockContext, 'active' | 'editing' | 'large'> = useMemo(() => ({
    sources: new Map((doc?.sources ?? []).map(s => [s.id, s])),
    sandbox: doc?.origin === 'imported',
    compact,
  }), [doc?.sources, doc?.origin, compact]);

  return (
    <div ref={rootRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: tk.bg.app, color: tk.text.primary, font: `13px ${fontFamily.ui}` }}>
      <style>{css}</style>
      <Header compact={compact} list={list} onExport={() => setExporting(true)} />
      {!doc ? <EmptyState compact={compact} /> : mode === 'slides' ? <SlidesView ctx={ctx} rootRef={rootRef} /> : mode === 'scroll' ? <ScrollView ctx={ctx} /> : compact ? <EditPhone ctx={ctx} onNavigate={onNavigate} /> : <EditDesktop ctx={ctx} onNavigate={onNavigate} />}
      {exporting && doc && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({ compact, list, onExport }: { compact: boolean; list: PresentationEntry[]; onExport: () => void }) {
  const tk = useTokens();
  const name = usePresentation(s => s.name);
  const doc = usePresentation(s => s.doc);
  const mode = usePresentation(s => s.mode);
  const status = usePresentation(s => s.status);
  const setMode = usePresentation(s => s.setMode);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const titleRef = useRef<HTMLButtonElement>(null);

  const items: MenuItem[] = [
    ...list.slice(0, 12).map(p => ({ label: p.name, icon: p.name === name ? 'check' as const : 'slides' as const, hint: `${p.steps} step${p.steps === 1 ? '' : 's'}`, onSelect: () => { usePresentation.getState().open(p.name); } })),
    ...(list.length ? ['separator' as const] : []),
    { label: 'New presentation…', icon: 'plus', onSelect: () => void newPresentation() },
    { label: `Sample: ${SAMPLE_TITLE}`, icon: 'spark', hint: 'Built from the Learn 3D lessons', onSelect: () => void openSample() },
    { label: 'Import a presentation file…', icon: 'import', onSelect: () => void importPresentationFile() },
    ...(doc ? [
      'separator' as const,
      { label: 'Rename…', icon: 'edit' as const, onSelect: async () => {
        const t = await askText('Rename presentation', { label: 'Title', initial: name ?? '', confirmLabel: 'Rename' });
        if (t && !usePresentation.getState().rename(t)) toast.error('That name is taken', { message: `There's already a presentation called “${t}”.` });
      } },
      { label: 'Duplicate', icon: 'copy' as const, onSelect: () => { const d = usePresentation.getState().doc; if (d) usePresentation.getState().adopt(structuredClone(d)); } },
      { label: 'Export as a file…', icon: 'export' as const, hint: 'A .present.json others can open, with every Play in it', onSelect: () => void exportPresentationFile() },
      { label: 'Delete…', icon: 'trash' as const, danger: true, onSelect: async () => {
        if (await askConfirm(`Delete “${name}”?`, { message: 'The presentation goes; the graphs it was built from stay.', confirmLabel: 'Delete', danger: true })) usePresentation.getState().remove();
      } },
    ] : []),
  ];
  const modes: { value: PresentMode; label: React.ReactNode; title: string }[] = [
    { value: 'edit', label: compact ? <Icon name="edit" size={14} /> : <><Icon name="edit" size={13} /> Edit</>, title: 'Build the steps' },
    { value: 'slides', label: compact ? <Icon name="slides" size={14} /> : <><Icon name="slides" size={13} /> Slides</>, title: 'One step at a time, for teaching in the room (← →)' },
    { value: 'scroll', label: compact ? <Icon name="scroll" size={14} /> : <><Icon name="scroll" size={13} /> Scroll</>, title: 'Everything on one page, for reading alone' },
  ];
  return (
    <div style={{ height: compact ? 48 : 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: compact ? 6 : 12, padding: compact ? '0 8px 0 12px' : '0 14px 0 16px', background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}` }}>
      <button
        ref={titleRef} type="button"
        onClick={() => { const r = titleRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.left, y: r.bottom + 6 } : null); }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: compact ? '46vw' : 380, height: 34, padding: '0 8px 0 6px', border: 0, borderRadius: radius.control, background: menu ? tk.bg.hover : 'transparent', cursor: 'pointer', color: tk.text.primary }}
      >
        <span style={{ width: 24, height: 24, borderRadius: radius.sm, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.14), color: tk.accent.base }}><Icon name="slides" size={14} /></span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `650 13.5px ${fontFamily.ui}` }}>{doc?.title ?? 'Presentations'}</span>
        <Icon name="chevD" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      </button>
      {doc && !compact && (
        <span title={status === 'failed' ? 'The last change couldn’t be saved' : 'Changes save themselves'} style={{ color: status === 'failed' ? tk.status.danger : tk.text.faint, font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
          {status === 'pending' ? 'Saving…' : status === 'failed' ? 'Not saved' : 'Saved'}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {doc && <Segmented size={compact ? 'sm' : 'md'} ariaLabel="View" value={mode} onChange={setMode} options={modes} />}
      {doc && !compact && <Button size="sm" icon="export" onClick={onExport} title="A web page (slides or scroll) or a presentation file">Export</Button>}
      {doc && compact && <IconButton icon="export" label="Export" onClick={onExport} />}
      {menu && <Menu x={menu.x} y={menu.y} minWidth={260} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ── No presentation yet ─────────────────────────────────────────────────────

function EmptyState({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 520, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 52, height: 52, borderRadius: radius.lg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}><Icon name="slides" size={26} /></span>
        <h2 style={{ margin: 0, font: `720 ${compact ? 22 : 26}px/1.2 ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary }}>Teach with your Plays</h2>
        <p style={{ margin: 0, color: tk.text.muted, font: `500 14px/1.6 ${fontFamily.ui}` }}>
          Build a lesson step by step: text with maths, the pictures your graphs make, sliders to try, and the code behind them. Show it as slides in the room or as one page to read, or export it as a web page.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
          <Button variant="primary" icon="spark" disabled={busy} onClick={async () => { setBusy(true); await openSample(); setBusy(false); }}>{busy ? 'Building it…' : `Open the sample: ${SAMPLE_TITLE}`}</Button>
          <Button icon="plus" onClick={() => void newPresentation()}>New presentation</Button>
          <Button variant="ghost" icon="import" onClick={() => void importPresentationFile()}>Import a file</Button>
        </div>
      </div>
    </div>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────

function EditDesktop({ ctx, onNavigate }: { ctx: Omit<BlockContext, 'active' | 'editing' | 'large'>; onNavigate: (p: Page) => void }) {
  const tk = useTokens();
  const doc = usePresentation(s => s.doc);
  const index = usePresentation(s => s.step);
  const select = usePresentation(s => s.select);
  const step = doc?.steps[index];
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [index]);
  if (!doc || !step) return null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <aside style={{ width: 236, flexShrink: 0, borderRight: `1px solid ${tk.border.default}`, background: tk.bg.subtle }}><StepsList /></aside>
      <main ref={scroller} onClick={() => select(null)} style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '48px 48px 120px' }}>
          <StepView step={step} index={index} total={doc.steps.length} ctx={{ ...ctx, editing: true, active: true, large: false }} />
        </div>
      </main>
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
  if (!doc || !step) return null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <StepsStrip />
      <main onClick={() => select(null)} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 16px 96px' }}>
        <StepView step={step} index={index} total={doc.steps.length} ctx={{ ...ctx, editing: true, active: true, large: false }} />
      </main>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }}>
        <div style={{ display: 'flex', gap: 6, padding: 5, borderRadius: 24, background: tk.bg.panel, boxShadow: tk.shadow.popover, border: `1px solid ${tk.border.default}`, pointerEvents: 'auto' }}>
          <Button size="sm" variant="primary" icon="sliders" onClick={() => setSheet(true)} style={{ borderRadius: 18 }}>{selected ? 'Block settings' : 'Step and sources'}</Button>
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
