/**
 * ExportDialog — the open presentation as a web page (slides or scroll,
 * maths as MathML or KaTeX's HTML) or as a `.present.json` file, with what
 * the page leaves behind. Also the file import, which marks what it brings
 * in as someone else's (its Script layers then run sandboxed).
 */
import { useMemo, useState } from 'react';
import { buildPresentationHtml, exportNotes, presentationFileJson } from '../../present/exportPresentation';
import { PRESENTATION_FILE_KIND, parsePresentation } from '../../types/presentation';
import { openTextFile, saveTextFile } from '../../utils/fileIO';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toastStore';
import { reportFileResult } from '../shell/reportFileResult';
import { loadMarkdown } from './Markdown';
import { usePresentation } from './presentationStore';

const fileBase = (title: string) => title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'presentation';

export async function exportPresentationFile(): Promise<void> {
  const doc = usePresentation.getState().doc;
  if (!doc) return;
  reportFileResult(await saveTextFile(presentationFileJson(doc), `${fileBase(doc.title)}.present.json`), { failTitle: 'Couldn’t export the presentation', success: 'Presentation exported' });
}

export async function importPresentationFile(): Promise<void> {
  let text: string | null;
  try { text = await openTextFile('.json,.present.json'); } catch (e) { toast.error('Couldn’t open the file', { message: e instanceof Error ? e.message : String(e) }); return; }
  if (text === null) return;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { toast.error('That isn’t a presentation file', { message: 'It isn’t JSON.' }); return; }
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind !== undefined && kind !== PRESENTATION_FILE_KIND) { toast.error('That isn’t a presentation file', { message: kind === 'shader-studio-play' ? 'It’s a play file: import it on the Play page.' : 'Its kind is something else.' }); return; }
  const doc = parsePresentation(raw);
  if (!doc) { toast.error('That isn’t a presentation file', { message: 'It has no steps.' }); return; }
  // Its Script layers are someone else's JavaScript: they run in a sandboxed frame.
  const name = usePresentation.getState().adopt({ ...doc, origin: 'imported' });
  const scripts = doc.sources.some(s => s.bundle.play.layers.some(l => l.kind === 'script'));
  toast.success(`Imported “${name}”`, scripts ? { message: 'Its Script layers run in a sandboxed frame, since they’re code from somewhere else.' } : undefined);
}

/** KaTeX's stylesheet with its fonts (woff2) inlined as data URLs, so the exported page needs nothing else. */
async function katexCssInline(): Promise<string> {
  const { default: href } = await import('katex/dist/katex.min.css?url');
  const css = await (await fetch(href)).text();
  const base = new URL(href, location.href);
  const fonts = new Map<string, string>();
  for (const m of css.matchAll(/url\(([^)]+\.woff2)\)/g)) {
    const u = m[1].replace(/["']/g, '');
    if (fonts.has(u)) continue;
    const buf = new Uint8Array(await (await fetch(new URL(u, base))).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    fonts.set(u, `data:font/woff2;base64,${btoa(bin)}`);
  }
  // Only the woff2 fonts: drop the woff / ttf fallbacks.
  return css.replace(/url\(([^)]+)\)\s*format\(["']?(woff|truetype)["']?\)\s*,?/g, '').replace(/,\s*;/g, ';').replace(/url\(([^)]+\.woff2)\)/g, (_m, u: string) => `url(${fonts.get(u.replace(/["']/g, '')) ?? u})`);
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const tk = useTokens();
  const doc = usePresentation(s => s.doc);
  const [layout, setLayout] = useState<'slides' | 'scroll'>('slides');
  const [math, setMath] = useState<'mathml' | 'html'>('mathml');
  const [busy, setBusy] = useState(false);
  const notes = useMemo(() => (doc ? exportNotes(doc) : []), [doc]);
  if (!doc) return null;
  const save = async () => {
    setBusy(true);
    try {
      const md = await loadMarkdown();
      const katexCss = math === 'html' ? await katexCssInline() : undefined;
      const html = buildPresentationHtml(doc, md.renderMarkdown, { layout, math, katexCss });
      const r = await saveTextFile(html, `${fileBase(doc.title)}${layout === 'scroll' ? '' : '-slides'}.html`, 'text/html');
      reportFileResult(r, { failTitle: 'Couldn’t save the page', success: `Saved the page (${Math.round(html.length / 1024)} KB)` });
      if (r.ok) onClose();
    } catch (e) {
      toast.error('Couldn’t build the page', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const label = (t: string) => <div style={{ color: tk.text.secondary, font: `600 12px ${fontFamily.ui}`, marginBottom: 6 }}>{t}</div>;
  return (
    <Modal
      title="Export the presentation" subtitle={doc.title} icon="export" onClose={onClose} width={500}
      footer={<>
        <Button variant="ghost" icon="export" onClick={() => { void exportPresentationFile(); onClose(); }} title="The presentation with every Play in it, to open in Playfield anywhere">Presentation file</Button>
        <span style={{ flex: 1 }} />
        <Button variant="primary" icon="code" disabled={busy} onClick={save}>{busy ? 'Building…' : 'Save the web page'}</Button>
      </>}
    >
      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: tk.text.muted, font: `500 12.5px/1.55 ${fontFamily.ui}` }}>
          One HTML file with everything in it: the steps, the maths, every picture and its controls. Put it on any website or open it from your computer; nothing else to host.
        </div>
        <div>{label('Layout')}<Segmented fill ariaLabel="Layout" value={layout} onChange={setLayout} options={[{ value: 'slides', label: 'Slides', sub: 'one step at a time' }, { value: 'scroll', label: 'Scroll', sub: 'one long page' }]} /></div>
        <div>{label('Maths')}<Segmented fill ariaLabel="Maths" value={math} onChange={setMath} options={[{ value: 'mathml', label: 'MathML', sub: 'small, the browser draws it' }, { value: 'html', label: 'KaTeX', sub: 'same everywhere, ~300 KB more' }]} /></div>
        {notes.length > 0 && (
          <div style={{ padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.field, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: tk.status.warningText, font: `650 12px ${fontFamily.ui}` }}><Icon name="warning" size={13} />What the page leaves behind</div>
            {notes.map(n => <div key={n.what} style={{ color: tk.text.secondary, font: `500 12px/1.45 ${fontFamily.ui}` }}><b style={{ color: tk.text.primary }}>{n.what}</b>: {n.why}</div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
