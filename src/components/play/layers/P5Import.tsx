/**
 * P5Import — bring a p5.js sketch in as a Script layer, like the GLSL
 * converter: paste it (or open .js files, a folder or a .zip of a p5
 * project), see the report, choose what becomes a control, create.
 *
 *   read      the project: index.html's script order (p5 itself and its
 *             addons left out), the file that defines setup/draw becomes
 *             sketch.js, the others tabs; images, fonts and data come along
 *   report    what runs as it is, what is mapped (createSlider → a control,
 *             createCanvas → fitted into the picture, WEBGL → 3D), what does
 *             nothing (page elements) and what cannot run, with file:line
 *   controls  the sketch's DOM controls become the layer's; its values can
 *             too ("Suggest controls" ticks the likeliest)
 *   preview   the sketch as it will run, beside the report
 *
 * The importer (src/play/p5import, with acorn) loads on first use.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import type { ScriptAsset } from '../../../types/playLayers';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { Select } from '../../ui/Select';
import { toast } from '../../ui/toastStore';
import { CodeField } from '../../code/CodeField';
import { tokenizeJsLine } from '../../code/jsSyntax';
import { ScriptPreview } from './ScriptPreview';
import { extractScriptParams } from './scriptExamples';
import type * as P5I from '../../../play/p5import';
import { loadP5Importer, useP5Importer } from './p5Importer';
import type { P5LayerInput } from './p5Layer';

/** What Create hands over: the layer's fields and where its controls start. */
export interface P5ImportResult { patch: P5LayerInput; startAt: Record<string, number>; title: string }

const KIND_LABEL: Record<string, string> = { slider: 'Slider', integer: 'Whole number', toggle: 'Toggle', colour: 'Colour', choice: 'Choice', button: 'Button' };
const fmt = (v: unknown) => (Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? (v.startsWith('#') ? v : `'${v}'`) : String(v));
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * The importer's body: input, report, controls and preview. `onCreate` gets the
 * layer when the person presses the create button (`actions` renders them).
 */
export function P5ImportPanel({ initialText = '', narrow = false, actions }: {
  initialText?: string;
  narrow?: boolean;
  /** The buttons that create: given the result (null while there is nothing to create) and whether the images are being saved. */
  actions: (make: (() => Promise<P5ImportResult | null>) | null, blocked: string | null) => ReactNode;
}) {
  const tk = useTokens();
  const mod = useP5Importer();
  const [text, setText] = useState(initialText);
  const [project, setProject] = useState<P5I.P5Project | null>(null);
  const [fromFiles, setFromFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Record<string, P5I.P5ChosenControl>>({});
  const [showSupported, setShowSupported] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // Pasted code is read a moment after typing stops.
  useEffect(() => {
    if (!mod || fromFiles) return;
    const t = setTimeout(() => { setProject(text.trim() ? mod.projectFromText(text) : null); setChosen({}); }, 300);
    return () => clearTimeout(t);
  }, [mod, text, fromFiles]);

  const readFiles = async (list: FileList | File[] | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    setBusy(true);
    try {
      const m = mod ?? await loadP5Importer();
      const p = await m.readP5Inputs({ files });
      setProject(p); setFromFiles(true); setChosen({});
      setText(p.main.code);
    } catch (e) {
      toast.error('Couldn’t read those files', { message: (e as Error)?.message ?? String(e) });
    } finally { setBusy(false); }
  };

  const allFiles = useMemo<P5I.P5File[]>(() => (project ? [...project.files.map(f => ({ name: f.name, code: f.code })), { name: 'sketch.js', code: project.main.code }] : []), [project]);
  const analysis = useMemo(() => (mod && project ? mod.analyzeProject(allFiles, project.assets) : null), [mod, project, allFiles]);
  const dom = useMemo(() => { if (!mod || !project || analysis?.syntaxErrors.length) return null; try { return mod.mapDomControls(allFiles); } catch { return null; } }, [mod, project, allFiles, analysis]);
  const candidates = useMemo(() => (mod && dom ? mod.findControlCandidates(dom.files, { colourModeNotRgb: analysis?.colourModeNotRgb }) : []), [mod, dom, analysis]);
  const build = useMemo(() => {
    if (!mod || !project || !analysis) return null;
    try {
      const picks = Object.values(chosen);
      let rewrite: P5I.P5RewriteResult | null = dom;
      if (dom && picks.length) rewrite = mod.combineRewrites(dom, mod.applyControls(dom.files, picks, candidates));
      return mod.buildP5Layer(project, analysis, rewrite);
    } catch (e) { return { error: (e as Error)?.message ?? String(e) }; }
  }, [mod, project, analysis, dom, chosen, candidates]);
  const built = build && 'patch' in build ? build : null;
  const defs = useMemo(() => { if (!built) return []; const r = extractScriptParams(built.patch.code, built.patch.files); return r.ok ? r.defs : []; }, [built]);
  const compileError = useMemo(() => { if (!built) return null; const r = extractScriptParams(built.patch.code, built.patch.files); return r.ok ? null : r.error; }, [built]);

  const toggle = (c: P5I.P5Candidate, on: boolean) => setChosen(ch => {
    const next = { ...ch };
    if (on) next[c.id] = { id: c.id, kind: c.kind, key: c.name, min: c.range?.min, max: c.range?.max, step: c.range?.step, options: c.options };
    else delete next[c.id];
    return next;
  });
  const change = (id: string, p: Partial<P5I.P5ChosenControl>) => setChosen(ch => (ch[id] ? { ...ch, [id]: { ...ch[id], ...p } } : ch));
  const suggest = () => {
    if (!mod) return;
    const ids = new Set(mod.suggestControls(candidates));
    const next: Record<string, P5I.P5ChosenControl> = {};
    for (const c of candidates) if (ids.has(c.id)) next[c.id] = { id: c.id, kind: c.kind, key: c.name, min: c.range?.min, max: c.range?.max, step: c.range?.step, options: c.options };
    setChosen(next);
  };

  const blocked = !project ? 'Paste a sketch or open its files first.'
    : analysis?.syntaxErrors.length ? `Fix the syntax error first (${analysis.syntaxErrors[0].file}:${analysis.syntaxErrors[0].line}).`
    : compileError ? `It does not compile: ${compileError}`
    : !built ? (build && 'error' in build ? build.error : 'Reading…') : null;
  const make = built && project && !blocked ? async (): Promise<P5ImportResult | null> => {
    // Images go to the image library too; the layer keeps its own copy so it runs anywhere.
    let assets: ScriptAsset[] = built.patch.assets;
    if (project.assets.some(a => a.kind === 'image' && !a.tooBig)) {
      try { const saved = await (mod ?? await loadP5Importer()).saveImagesToLibrary(project); const byName = new Map(saved.map(a => [a.name, a])); assets = assets.map(a => byName.get(a.name) ?? a); } catch { /* the embedded copies still work */ }
    }
    return { patch: { label: built.patch.label, code: built.patch.code, files: built.patch.files, assets, mode: built.patch.mode }, startAt: built.startAt, title: project.title };
  } : null;

  // ── Pieces ─────────────────────────────────────────────────────────────────
  const heading = (t: string, n?: number, colour?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: colour ?? tk.text.faint }}>
      {t}{n !== undefined && <span style={{ fontWeight: 600, color: tk.text.faint }}>{n}</span>}
    </div>
  );
  const refs = (r: ReadonlyArray<{ file: string; line: number }>) => r.length ? <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{r.slice(0, 4).map(x => `${x.file}:${x.line}`).join(' · ')}{r.length > 4 ? ` +${r.length - 4}` : ''}</span> : null;
  const item = (i: P5I.P5Item, colour: string) => (
    <div key={i.name + i.status} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2, padding: '4px 8px', borderRadius: radius.sm, background: alpha(colour, 0.07) }}>
      <span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary }}>{i.name}</span>
      <span style={{ fontSize: 11.5, color: tk.text.muted, flex: '1 1 160px', minWidth: 0 }}>{i.note}</span>
      {refs(i.refs)}
    </div>
  );
  const grouped = analysis && mod ? mod.groupItems(analysis.items) : null;
  const input = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: narrow ? undefined : 1 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Button size="sm" icon="import" onClick={() => filesRef.current?.click()} disabled={busy} title="One or more .js files, or a .zip of a p5 project (with its index.html)">Open files or .zip…</Button>
        <Button size="sm" icon="folder" onClick={() => folderRef.current?.click()} disabled={busy} title="A p5 project folder: index.html, the sketch files and their assets">Open a folder…</Button>
        {fromFiles && <Button size="sm" variant="ghost" onClick={() => { setFromFiles(false); setProject(null); setText(''); }}>Start over</Button>}
        <input ref={filesRef} type="file" multiple accept=".js,.mjs,.zip,.html,.htm,.json,.txt,.csv,.tsv,.png,.jpg,.jpeg,.gif,.webp,.svg,.ttf,.otf,.woff,.woff2" style={{ display: 'none' }} onChange={e => { void readFiles(e.target.files); e.target.value = ''; }} />
        <input ref={folderRef} type="file" multiple style={{ display: 'none' }} {...{ webkitdirectory: '', directory: '' }} onChange={e => { void readFiles(e.target.files); e.target.value = ''; }} />
      </div>
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void readFiles(e.dataTransfer.files); }} style={{ display: 'flex', flexDirection: 'column', minHeight: narrow ? 220 : 260, flex: 1 }}>
        <CodeField
          grow title={fromFiles ? 'sketch.js (from the project)' : 'p5.js sketch'} ariaLabel="p5.js sketch to import" value={text}
          onChange={v => { setText(v); if (fromFiles && project) { setProject({ ...project, main: { ...project.main, code: v } }); } }}
          completions={[]} tokenize={tokenizeJsLine} autoIndent minHeight={narrow ? 220 : 260}
          placeholder={'Paste a p5.js sketch: function setup() { createCanvas(400, 400); } function draw() { … }\nOr open its files, a folder or a .zip, or drop them here.'}
        />
      </div>
    </div>
  );

  const report = project && analysis && (
    <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12, lineHeight: 1.45, color: tk.text.secondary }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {[`${allFiles.length} file${allFiles.length === 1 ? '' : 's'}`, `${project.assets.filter(a => !a.tooBig).length} asset${project.assets.length === 1 ? '' : 's'}`, analysis.mode === '3d' ? '3D (WEBGL)' : '2D', analysis.instance ? 'instance mode' : 'global mode', `${defs.length} control${defs.length === 1 ? '' : 's'}`].map(t => (
          <span key={t} style={{ padding: '2px 8px', borderRadius: 999, background: tk.bg.field, fontSize: 11.5, color: tk.text.secondary }}>{t}</span>
        ))}
      </div>
      {analysis.syntaxErrors.length > 0 && <>{heading('Syntax errors', analysis.syntaxErrors.length, tk.status.danger)}{analysis.syntaxErrors.map((e, i) => <div key={i} style={{ color: tk.status.danger, fontFamily: fontFamily.mono, fontSize: 11.5 }}>{e.file}:{e.line}:{e.column} {e.message}</div>)}</>}
      {heading('Files', allFiles.length)}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {allFiles.slice().sort((a, b) => (a.name === 'sketch.js' ? -1 : b.name === 'sketch.js' ? 1 : 0)).map(f => (
          <span key={f.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: radius.sm, background: f.name === 'sketch.js' ? alpha(tk.accent.base, 0.14) : tk.bg.field, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>
            {f.name}{f.name === 'sketch.js' && <span style={{ fontFamily: fontFamily.ui, fontSize: 10, color: tk.accent.base, fontWeight: 700 }}>MAIN</span>}
          </span>
        ))}
      </div>
      {project.files.length > 0 && <div style={{ fontSize: 11.5, color: tk.text.muted, marginTop: 4 }}>The other files run first, in this order, and share one scope with sketch.js.</div>}
      {(project.notes.length > 0 || project.warnings.length > 0) && <div style={{ fontSize: 11.5, marginTop: 4 }}>{project.warnings.map((w, i) => <div key={`w${i}`} style={{ color: tk.status.warningText }}>{w}</div>)}{project.notes.map((n, i) => <div key={`n${i}`} style={{ color: tk.text.muted }}>{n}</div>)}</div>}
      {project.assets.length > 0 && <>{heading('Assets', project.assets.length)}{project.assets.map(a => (
        <div key={a.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5 }}>
          <span style={{ fontFamily: fontFamily.mono, color: a.tooBig ? tk.status.warningText : tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{a.name}</span>
          <span style={{ color: tk.text.faint, flexShrink: 0 }}>{a.kind} · {kb(a.size)}{a.tooBig ? ' · too big, left out' : a.kind === 'image' ? ' · also to your image library' : ''}</span>
        </div>
      ))}</>}
      {project.skipped.length > 0 && <>{heading('Left out', project.skipped.length)}{project.skipped.map((s, i) => <div key={i} style={{ fontSize: 11.5, color: s.unsupported ? tk.status.warningText : tk.text.muted }}><span style={{ fontFamily: fontFamily.mono }}>{s.path}</span> · {s.reason}</div>)}</>}
      {analysis.warnings.length > 0 && <>{heading('Check', analysis.warnings.length, tk.status.warningText)}{analysis.warnings.map((w, i) => <div key={i} style={{ fontSize: 11.5, color: tk.status.warningText }}>{w.message}{w.file ? ` (${w.file}:${w.line})` : ''}</div>)}</>}
      {grouped && grouped.unsupported.length > 0 && <>{heading('Won’t run', grouped.unsupported.length, tk.status.danger)}<div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{grouped.unsupported.map(i => item(i, i.severity === 'error' ? tk.status.danger : tk.status.warning))}</div></>}
      {grouped && grouped.mapped.length > 0 && <>{heading('Mapped', grouped.mapped.length, tk.accent.base)}<div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{grouped.mapped.map(i => item(i, tk.accent.base))}</div></>}
      {grouped && grouped.stubbed.length > 0 && <>{heading('Do nothing here', grouped.stubbed.length)}<div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{grouped.stubbed.map(i => item(i, tk.text.faint))}</div></>}
      {grouped && grouped.supported.length > 0 && <>
        {heading('Run as they are', grouped.supported.length)}
        {showSupported
          ? <div style={{ font: `500 11.5px/1.6 ${fontFamily.mono}`, color: tk.text.muted }}>{grouped.supported.map(i => i.name).join('  ')}</div>
          : <button type="button" onClick={() => setShowSupported(true)} style={{ all: 'unset', cursor: 'pointer', whiteSpace: 'normal', overflowWrap: 'anywhere', font: `500 11.5px/1.5 ${fontFamily.mono}`, color: tk.text.muted }}>{grouped.supported.slice(0, 6).map(i => i.name).join(', ')}{grouped.supported.length > 6 ? ` and ${grouped.supported.length - 6} more…` : ''}</button>}
      </>}
    </div>
  );

  const controls = project && analysis && !analysis.syntaxErrors.length && (
    <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
      {heading('Controls from the page', dom?.controls.length ?? 0)}
      {dom && dom.controls.length > 0
        ? dom.controls.map(c => <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5 }}><span style={{ fontFamily: fontFamily.mono, color: tk.text.primary }}>{c.creator}()</span><span style={{ color: tk.text.muted }}>→ {KIND_LABEL[c.kind] ?? c.kind} “{c.key}”</span>{refs([{ file: c.file, line: c.line }])}</div>)
        : <div style={{ fontSize: 11.5, color: tk.text.muted }}>None: the sketch makes no sliders, checkboxes or pickers.</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 4px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>Choose what becomes a control</span>
        <span style={{ flex: 1 }} />
        {candidates.length > 0 && <Button size="sm" icon="spark" onClick={suggest} title="Tick the likeliest few: named values used in draw, not counters or positions">Suggest controls</Button>}
      </div>
      {candidates.length === 0 && <div style={{ fontSize: 11.5, color: tk.text.muted }}>No values to offer.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: narrow ? undefined : 340, overflowY: 'auto' }}>
        {candidates.slice(0, 40).map(c => {
          const ch = chosen[c.id];
          const kind = ch?.kind ?? c.kind;
          const numeric = kind === 'slider' || kind === 'integer';
          return (
            <div key={c.id} style={{ padding: '6px 8px', borderRadius: radius.md, background: ch ? alpha(tk.accent.base, 0.08) : tk.bg.subtle, boxShadow: ch ? `inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}` : 'none', opacity: c.state && !ch ? 0.7 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Toggle checked={!!ch} onChange={on => toggle(c, on)} label={<span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary }}>{c.name}</span>} />
                {kind === 'colour' && typeof c.value !== 'boolean' && <span style={{ width: 14, height: 14, borderRadius: 4, background: Array.isArray(c.value) ? `rgb(${c.value.slice(0, 3).join(',')})` : String(c.value), boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />}
                <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>= {fmt(c.value)}</span>
                {c.state && <span style={{ fontSize: 11, color: tk.status.warningText }}>state, not a good control</span>}
                {c.setupOnly && <span style={{ fontSize: 11, color: tk.text.faint }}>restarts the sketch</span>}
                <span style={{ flex: 1 }} />
                {refs(c.uses.length ? c.uses : [{ file: c.file, line: c.line }])}
              </div>
              {c.note && <div style={{ fontSize: 11, color: tk.text.faint, marginTop: 2 }}>{c.note}</div>}
              {ch && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
                  <Select ariaLabel="Kind of control" value={kind} height={28} onChange={v => change(c.id, { kind: v as P5I.P5ControlKind })}
                    options={(c.kind === 'colour' ? ['colour'] : c.kind === 'toggle' ? ['toggle'] : c.kind === 'choice' ? ['choice'] : ['slider', 'integer']).map(k => ({ value: k, label: KIND_LABEL[k] }))} />
                  <Field aria-label="Control name" height={28} mono value={ch.key ?? c.name} onChange={e => change(c.id, { key: e.target.value.replace(/[^\w]/g, '') })} style={{ width: 120 }} />
                  {numeric && (['min', 'max', 'step'] as const).map(k => (
                    <Field key={k} aria-label={k} height={28} mono type="number" value={String(ch[k] ?? '')} suffix={<span style={{ fontSize: 10.5, color: tk.text.faint }}>{k}</span>}
                      onChange={e => change(c.id, { [k]: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 92 }} />
                  ))}
                  {kind === 'choice' && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{(ch.options ?? c.options ?? []).join(' · ')}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const previewW = narrow ? Math.min(340, (typeof window !== 'undefined' ? window.innerWidth : 375) - 90) : 340;
  const preview = built && !blocked && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {heading('Preview')}
      <ScriptPreview code={built.patch.code} files={built.patch.files} p5 assets={built.patch.assets} mode={built.patch.mode} defs={defs} values={built.startAt} clear={false} width={previewW} ratio={16 / 9} />
      <span style={{ fontSize: 11, color: tk.text.faint }}>The sketch as it will run, fitted into the picture. Click and drag in it to use the mouse.</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 16, minHeight: 0, minWidth: 0, maxWidth: '100%', height: narrow ? undefined : '100%' }}>
      <div style={{ flex: narrow ? undefined : '1 1 50%', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {input}
        {!mod && <div style={{ fontSize: 11.5, color: tk.text.faint, marginTop: 6 }}>Loading the importer…</div>}
      </div>
      <div style={{ flex: narrow ? undefined : '1 1 50%', minWidth: 0, overflowY: narrow ? undefined : 'auto', overflowX: 'hidden', overflowWrap: 'anywhere', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: narrow ? 0 : 4 }}>
        {!project && <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: radius.md, background: tk.bg.subtle, fontSize: 12, lineHeight: 1.5, color: tk.text.muted }}>
          <Icon name="info" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>A p5.js sketch runs as a Script layer: its own canvas fitted into the picture, its sliders and checkboxes as the layer’s controls, WEBGL sketches in 3D. A project folder keeps its files as tabs and brings its images, fonts and data.</span>
        </div>}
        {preview}
        {report}
        {controls}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12, position: narrow ? undefined : 'sticky', bottom: 0, padding: '8px 0', background: tk.bg.panel }}>
          {blocked && project && <span style={{ flex: '1 1 180px', fontSize: 11.5, color: tk.status.warningText }}>{blocked}</span>}
          {actions(make, blocked)}
        </div>
      </div>
    </div>
  );
}

/** The importer in a window: Create hands the layer over and closes. */
export function P5ImportDialog({ title = 'Import p5.js sketch', createLabel = 'Create layer', note, onCreate, onClose }: {
  title?: string;
  createLabel?: string;
  /** A line above the buttons (replacing a layer's code, say). */
  note?: string;
  onCreate: (r: P5ImportResult) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 860);
  useEffect(() => { const on = () => setNarrow(window.innerWidth < 860); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const [making, setMaking] = useState(false);
  return (
    <Modal title={title} subtitle={narrow ? undefined : 'Paste a sketch, or open its files, a folder or a .zip'} icon="import" iconColor={tk.kind.fn} width={1200} height={860} onClose={onClose} closeOnScrim={false}>
      <div style={{ height: '100%', minHeight: 0, padding: 12, boxSizing: 'border-box', overflowY: narrow ? 'auto' : 'hidden', overflowX: 'hidden' }}>
        <P5ImportPanel narrow={narrow} actions={(make, blocked) => (
          <>
            {note && <span style={{ flex: '1 1 200px', fontSize: 11.5, color: tk.text.muted }}>{note}</span>}
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="plus" disabled={!make || making} title={blocked ?? undefined}
              onClick={async () => { if (!make) return; setMaking(true); try { const r = await make(); if (r) onCreate(r); } finally { setMaking(false); } }}>{making ? 'Saving images…' : createLabel}</Button>
          </>
        )} />
      </div>
    </Modal>
  );
}
