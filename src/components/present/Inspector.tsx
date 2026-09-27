/**
 * Inspector — the settings panel of the Present page's Edit view: the
 * selected block's settings (its source, shape, controls, labels, code), or,
 * with nothing selected, the step's title and columns and the presentation's
 * sources. On phones it opens as a sheet.
 */
import { useRef, useState } from 'react';
import { create } from 'zustand';
import { BLOCK_ASPECTS, type Block, type BlockAspect, type CodeBlock, type InteractiveBlock, type InteractiveControl, type PresentSource, type RenderBlock, type TextBlock } from '../../types/presentation';
import { formatLineRanges, parseLineRanges } from '../../present/code';
import { mappingsByControl } from '../../present/controls';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import type { Page } from '../page';
import { BLOCK_META } from './blockMeta';
import { Poster, SourceCard, SourcePicker } from './Sources';
import { originText } from './sourceActions';
import { usePresentation } from './presentationStore';
import { useMarkdownModule } from './useMarkdown';
import { Row, Section } from './InspectorParts';
import { LinkedGraphsSection } from './LinkedGraphs';
import { PresentationStyleSettings, StepBackgroundSettings } from './StyleSettings';

function TextArea({ value, onChange, rows = 8, mono = true, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; mono?: boolean; placeholder?: string }) {
  const tk = useTokens();
  return (
    <textarea
      value={value} rows={rows} placeholder={placeholder} spellCheck={!mono}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => e.stopPropagation()}
      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', border: 0, outline: 'none', borderRadius: radius.control, padding: '9px 10px', background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.55 ${mono ? fontFamily.mono : fontFamily.ui}` }}
    />
  );
}

const ASPECT_OPTIONS = BLOCK_ASPECTS.map(a => ({ value: a, label: a }));
const aspectValue = (a: BlockAspect) => (typeof a === 'string' ? a : '16:9');

/** Which source a block reads, with Change. */
function SourceChooser({ source, compact, onChange }: { source: PresentSource | undefined; compact: boolean; onChange: (s: PresentSource) => void }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: radius.lg, background: tk.bg.field }}>
      <Poster source={source} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source?.title ?? 'No source'}</div>
        {source && <div style={{ color: tk.text.muted, font: `500 11px ${fontFamily.ui}` }}>{originText(source)}</div>}
      </div>
      <span ref={anchor} style={{ display: 'inline-flex' }}><Button size="sm" onClick={() => setOpen(o => !o)}>Change</Button></span>
      {open && <SourcePicker anchorRef={anchor} compact={compact} onPick={s => { onChange(s); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TextSettings({ block }: { block: TextBlock }) {
  const tk = useTokens();
  const patchBlock = usePresentation(s => s.patchBlock);
  const sources = usePresentation(s => s.doc?.sources);
  const md = useMarkdownModule();
  const withNotes = (sources ?? []).filter(s => s.bundle.play.notes?.trim());
  const code = (t: string) => <code style={{ font: `11.5px ${fontFamily.mono}`, background: tk.bg.field, padding: '1px 4px', borderRadius: 4 }}>{t}</code>;
  return (
    <>
      <Section title="Writing">
        <div style={{ color: tk.text.muted, font: `500 12px/1.6 ${fontFamily.ui}` }}>
          Type in the block itself; the result shows under it.
          <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
            <li>{code('# Heading')}, {code('**bold**')}, {code('*italic*')}, {code('- list')}, {code('[link](https://…)')}</li>
            <li>{code('$x^2$')} maths in a line, {code('$$…$$')} a formula on its own lines</li>
            <li>{code('`code`')} and fenced code blocks</li>
            <li>{code('\\$')} for a dollar sign</li>
          </ul>
        </div>
      </Section>
      {withNotes.length > 0 && md && (
        <Section title="Start from a Play’s notes">
          {withNotes.map(s => (
            <Button key={s.id} size="sm" icon="comment" style={{ justifyContent: 'flex-start' }} onClick={() => patchBlock(block.id, { markdown: `${block.markdown.trim() ? `${block.markdown.trim()}\n\n` : ''}${md.notesToMarkdown(s.bundle.play.notes ?? '')}` })}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
            </Button>
          ))}
        </Section>
      )}
    </>
  );
}

function RenderSettings({ block, compact }: { block: RenderBlock; compact: boolean }) {
  const patchBlock = usePresentation(s => s.patchBlock);
  const source = usePresentation(s => s.doc?.sources.find(x => x.id === block.source));
  const set = (p: Partial<RenderBlock>) => patchBlock(block.id, p);
  return (
    <>
      <Section title="Source"><SourceChooser source={source} compact={compact} onChange={s => set({ source: s.id })} /></Section>
      <Section title="Canvas">
        <Row label="Shape"><Segmented fill size="sm" ariaLabel="Shape" value={aspectValue(block.aspect)} onChange={v => set({ aspect: v as BlockAspect })} options={ASPECT_OPTIONS} /></Row>
        <Row label="Width" hint="Of the step (phones always use the full width)"><Segmented fill size="sm" ariaLabel="Width" value={block.width} onChange={width => set({ width })} options={[{ value: 'full', label: 'Full' }, { value: 'half', label: 'Half' }, { value: 'third', label: 'Third' }]} /></Row>
        <Toggle checked={block.pointer} onChange={pointer => set({ pointer })} label="The mouse reaches the picture" />
        <Row label="Caption"><Field height={32} value={block.caption ?? ''} placeholder="Under the picture" onChange={e => set({ caption: e.target.value || undefined })} /></Row>
      </Section>
      <Section title="Clock">
        <Row label="Start at (seconds)"><Field height={32} type="number" min={0} step={0.1} value={block.startTime ?? 0} onChange={e => { const t = parseFloat(e.target.value); set({ startTime: Number.isFinite(t) && t > 0 ? t : undefined }); }} /></Row>
        <Toggle checked={!!block.paused} onChange={paused => set({ paused: paused || undefined })} label="Hold it there (a still)" />
      </Section>
    </>
  );
}

function InteractiveSettings({ block, compact }: { block: InteractiveBlock; compact: boolean }) {
  const tk = useTokens();
  const patchBlock = usePresentation(s => s.patchBlock);
  const source = usePresentation(s => s.doc?.sources.find(x => x.id === block.source));
  const set = (p: Partial<InteractiveBlock>) => patchBlock(block.id, p);
  const all = source?.bundle.play.controls ?? [];
  const maps = source ? mappingsByControl(source.bundle.play) : new Map();
  const chosen = new Map(block.controls.map((c, i) => [c.controlId, { c, i }]));
  const setControl = (id: string, patch: Partial<InteractiveControl>) => set({ controls: block.controls.map(c => (c.controlId === id ? { ...c, ...patch } : c)) });
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= block.controls.length) return; const cs = block.controls.slice(); [cs[i], cs[j]] = [cs[j], cs[i]]; set({ controls: cs }); };
  // Chosen ones in their order, then the rest.
  const ordered = [...block.controls.flatMap(c => all.filter(x => x.id === c.controlId)), ...all.filter(x => !chosen.has(x.id))];
  return (
    <>
      <Section title="Source">
        <SourceChooser source={source} compact={compact} onChange={s => set({ source: s.id, controls: s.bundle.play.controls.slice(0, 4).map(c => ({ controlId: c.id, showMappings: true })) })} />
      </Section>
      <Section title="Text">
        <TextArea value={block.markdown} onChange={markdown => set({ markdown })} rows={9} placeholder={'What to notice. [[control:id]] makes a chip that points at a slider.'} />
        <div style={{ color: tk.text.faint, font: `500 11.5px/1.45 ${fontFamily.ui}` }}>Point at a slider: click a control’s name below to add its chip.</div>
      </Section>
      <Section title="Controls" extra={<span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>{block.controls.length} of {all.length}</span>}>
        {all.length === 0 && <div style={{ color: tk.text.muted, font: `500 12px ${fontFamily.ui}` }}>This Play has no controls.</div>}
        {ordered.map(c => {
          const on = chosen.get(c.id);
          const words = maps.get(c.id)?.words ?? [];
          return (
            <div key={c.id} style={{ borderRadius: radius.md, border: `1px solid ${on ? tk.border.default : tk.border.subtle}`, background: on ? tk.bg.panel : 'transparent', padding: '8px 8px 8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Toggle checked={!!on} onChange={v => set({ controls: v ? [...block.controls, { controlId: c.id, showMappings: true }] : block.controls.filter(x => x.controlId !== c.id) })} />
                <button type="button" title="Add a chip for it to the text" onClick={() => set({ markdown: `${block.markdown.replace(/\s+$/, '')}${block.markdown.trim() ? ' ' : ''}[[control:${c.id}]]` })}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: on ? tk.text.primary : tk.text.muted, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {on?.c.label || c.label}
                  {on?.c.label && on.c.label !== c.label && <span style={{ color: tk.text.faint, fontWeight: 500 }}> · {c.label}</span>}
                </button>
                {on && <IconButton size="sm" icon="chevU" label="Earlier" disabled={on.i === 0} onClick={() => move(on.i, -1)} />}
                {on && <IconButton size="sm" icon="chevD" label="Later" disabled={on.i === block.controls.length - 1} onClick={() => move(on.i, 1)} />}
              </div>
              {on && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  <Field height={30} value={on.c.label ?? ''} placeholder={`Label (${c.label})`} onChange={e => setControl(c.id, { label: e.target.value || undefined })} />
                  <Field height={30} value={on.c.hint ?? ''} placeholder="Hint under the slider" onChange={e => setControl(c.id, { hint: e.target.value || undefined })} />
                  {words.length > 0 && <Toggle checked={on.c.showMappings} onChange={showMappings => setControl(c.id, { showMappings })} label={`Show what drives it (${words.join(', ')})`} />}
                </div>
              )}
            </div>
          );
        })}
      </Section>
      <Section title="Layout">
        <Row label="Arrangement" hint="Phones always stack the picture above the controls"><Segmented fill size="sm" ariaLabel="Arrangement" value={block.layout} onChange={layout => set({ layout })} options={[{ value: 'side', label: 'Side by side' }, { value: 'stacked', label: 'Stacked' }]} /></Row>
        <Row label="Shape"><Segmented fill size="sm" ariaLabel="Shape" value={aspectValue(block.aspect)} onChange={v => set({ aspect: v as BlockAspect })} options={ASPECT_OPTIONS} /></Row>
        <Toggle checked={block.pointer} onChange={pointer => set({ pointer })} label="The mouse reaches the picture" />
      </Section>
    </>
  );
}

function CodeSettings({ block, compact }: { block: CodeBlock; compact: boolean }) {
  const replaceBlock = usePresentation(s => s.replaceBlock);
  const sources = usePresentation(s => s.doc?.sources);
  const source = block.from ? sources?.find(x => x.id === block.from!.source) : undefined;
  const [lines, setLines] = useState(() => formatLineRanges(block.highlightLines));
  const put = (b: CodeBlock) => replaceBlock(b);
  const what = !block.from ? 'typed' : 'layerId' in block.from ? 'layer' : block.from.node ? 'node' : 'shader';
  const scripts = source?.bundle.play.layers.filter(l => l.kind === 'script') ?? [];
  const firstSource = sources?.[0];
  return (
    <>
      <Section title="Code">
        <Segmented fill size="sm" ariaLabel="Where the code comes from" value={block.from ? 'source' : 'typed'} onChange={v => {
          if (v === 'typed') put({ ...block, from: undefined, code: block.code ?? '' });
          else if (firstSource) put({ ...block, from: { source: firstSource.id }, language: 'glsl' });
        }} options={[{ value: 'typed', label: 'Typed in' }, { value: 'source', label: 'From a Play', disabled: !firstSource, title: firstSource ? undefined : 'Add a source first (a Render or Interactive block, or from the step settings)' }]} />
        {!block.from && <Row label="Language"><Segmented fill size="sm" ariaLabel="Language" value={block.language} onChange={language => put({ ...block, language })} options={[{ value: 'glsl', label: 'GLSL' }, { value: 'js', label: 'JavaScript' }]} /></Row>}
        {!block.from && <div style={{ font: `500 11.5px ${fontFamily.ui}`, opacity: 0.7 }}>Type the code in the block itself.</div>}
        {block.from && (
          <>
            <SourceChooser source={source} compact={compact} onChange={s => put({ ...block, from: { source: s.id }, language: 'glsl' })} />
            <Row label="Show">
              <Segmented fill size="sm" ariaLabel="Show" value={what} onChange={v => {
                if (!block.from) return;
                const src = block.from.source;
                if (v === 'shader') put({ ...block, from: { source: src }, language: 'glsl', live: undefined, edited: undefined });
                else if (v === 'node') put({ ...block, from: { source: src, node: source?.shader.nodes[0]?.id }, language: 'glsl', live: undefined, edited: undefined });
                else if (v === 'layer' && scripts[0]) put({ ...block, from: { source: src, layerId: scripts[0].id }, language: 'js' });
              }} options={[
                { value: 'shader', label: 'Shader' },
                { value: 'node', label: 'One node', disabled: !source?.shader.nodes.length },
                { value: 'layer', label: 'Script', disabled: !scripts.length, title: scripts.length ? undefined : 'This Play has no Script layers' },
              ]} />
            </Row>
            {what === 'node' && source && block.from && !('layerId' in block.from) && (
              <Row label="Node" hint="Its lines of the generated shader, as the code panel marks them">
                <Select ariaLabel="Node" value={block.from.node ?? ''} onChange={node => put({ ...block, from: { source: source.id, node } })} options={source.shader.nodes.map(n => ({ value: n.id, label: `${n.label} (${n.slug})` }))} />
              </Row>
            )}
            {what === 'layer' && source && block.from && 'layerId' in block.from && (
              <Row label="Script layer">
                <Select ariaLabel="Script layer" value={block.from.layerId} onChange={layerId => put({ ...block, from: { source: source.id, layerId }, edited: undefined })} options={scripts.map(l => ({ value: l.id, label: l.label }))} />
              </Row>
            )}
            {what === 'layer' && source && (
              <Row label="Live" hint={`Readers edit the code and the canvas of “${source.title}” on this step runs it (not the graph, not other steps). The edit is kept with the presentation.`}>
                <Toggle checked={!!block.live} onChange={live => put({ ...block, live: live || undefined, edited: live ? block.edited : undefined })} label="Edit it and watch" />
              </Row>
            )}
          </>
        )}
      </Section>
      <Section title="Marks">
        {/* A live block is an editor: its lines move as the reader types, so there's nothing to mark. */}
        {!block.live && (
          <Row label="Highlight lines" hint="Line numbers as shown, like 3-5, 9">
            <Field height={32} mono value={lines} placeholder="3-5, 9" onChange={e => { setLines(e.target.value); const r = parseLineRanges(e.target.value); put({ ...block, highlightLines: r.length ? r : undefined }); }} />
          </Row>
        )}
        <Row label="Caption"><Field height={32} value={block.caption ?? ''} placeholder="Under the code" onChange={e => put({ ...block, caption: e.target.value || undefined })} /></Row>
      </Section>
    </>
  );
}

function StepSettings({ navigate, compact }: { navigate: (p: Page) => void; compact: boolean }) {
  const tk = useTokens();
  const doc = usePresentation(s => s.doc);
  const stepIdx = usePresentation(s => s.step);
  const patchStep = usePresentation(s => s.patchStep);
  const [adding, setAdding] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const step = doc?.steps[stepIdx];
  if (!doc || !step) return null;
  return (
    <>
      <Section title={`Step ${stepIdx + 1}`}>
        <Row label="Title"><Field height={32} value={step.title ?? ''} placeholder="Shown above the step" onChange={e => patchStep(stepIdx, { title: e.target.value || undefined })} /></Row>
        <Row label="Columns" hint="Two puts blocks side by side on wide screens"><Segmented fill size="sm" ariaLabel="Columns" value={String(step.columns) as '1' | '2'} onChange={v => patchStep(stepIdx, { columns: v === '2' ? 2 : 1 })} options={[{ value: '1', label: 'One' }, { value: '2', label: 'Two' }]} /></Row>
      </Section>
      <StepBackgroundSettings compact={compact} />
      <Section title="Sources" extra={<span ref={anchor} style={{ display: 'inline-flex' }}><Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(a => !a)}>Add</Button></span>}>
        {adding && <SourcePicker anchorRef={anchor} compact={compact} onPick={() => setAdding(false)} onClose={() => setAdding(false)} />}
        {doc.sources.length === 0 && <div style={{ color: tk.text.muted, font: `500 12px/1.5 ${fontFamily.ui}` }}>The Plays this presentation shows. Each is a copy taken when it’s added, so editing the graph later changes nothing here until you Refresh it.</div>}
        {doc.sources.map(s => <SourceCard key={s.id} s={s} navigate={navigate} compact={compact} />)}
      </Section>
      <LinkedGraphsSection />
    </>
  );
}

/** Which settings show with no block selected (kept while the sheet closes and opens on phones). */
const useInspectorTab = create<{ tab: 'step' | 'style' }>(() => ({ tab: 'step' }));

export function Inspector({ navigate, compact = false }: { navigate: (p: Page) => void; compact?: boolean }) {
  const tk = useTokens();
  const selected = usePresentation(s => s.selected);
  const block = usePresentation(s => (s.selected ? s.doc?.steps.flatMap(st => st.blocks).find(b => b.id === s.selected) : undefined));
  const select = usePresentation(s => s.select);
  const tab = useInspectorTab(s => s.tab);
  const setTab = (t: 'step' | 'style') => useInspectorTab.setState({ tab: t });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {block && !compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 12px 16px', borderBottom: `1px solid ${tk.border.default}` }}>
          <span style={{ width: 26, height: 26, borderRadius: radius.md, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
            <Icon name={BLOCK_META[block.type].icon} size={14} />
          </span>
          <span style={{ flex: 1, color: tk.text.primary, font: `650 13px ${fontFamily.ui}` }}>{BLOCK_META[block.type].label} block</span>
          <Button size="sm" variant="ghost" onClick={() => select(null)}>Done</Button>
        </div>
      )}
      {selected && block ? <BlockSettings block={block} compact={compact} /> : (
        <>
          <div style={{ padding: '12px 16px 2px' }}>
            <Segmented fill size="sm" ariaLabel="Settings" value={tab} onChange={setTab} options={[
              { value: 'step', label: 'This step', title: 'Its title, columns and background, and the sources' },
              { value: 'style', label: 'Style', title: 'Every step: the background, fonts, text size and colours' },
            ]} />
          </div>
          {tab === 'style' ? <PresentationStyleSettings compact={compact} /> : <StepSettings navigate={navigate} compact={compact} />}
        </>
      )}
    </div>
  );
}

function BlockSettings({ block, compact }: { block: Block; compact: boolean }) {
  switch (block.type) {
    case 'text': return <TextSettings block={block} />;
    case 'render': return <RenderSettings block={block} compact={compact} />;
    case 'interactive': return <InteractiveSettings block={block} compact={compact} />;
    case 'code': return <CodeSettings key={block.id} block={block} compact={compact} />;
  }
}
