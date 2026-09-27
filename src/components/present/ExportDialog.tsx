/**
 * ExportDialog — the open presentation as a web page (slides or scroll,
 * maths as MathML or KaTeX's HTML) or as a `.present.json` file, with what
 * the page leaves behind.
 */
import { offerPresentationExport } from '../playfile/exportMenus';
import { useEffect, useMemo, useState } from 'react';
import { withEmbeddedAssets } from '../../present/presentAssets';
import type { Presentation } from '../../types/presentation';
import { buildPresentationHtml, exportNotes } from '../../present/exportPresentation';
import { saveTextFile } from '../../utils/fileIO';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toastStore';
import { reportFileResult } from '../shell/reportFileResult';
import { loadMarkdown } from './useMarkdown';
import { usePresentation } from './presentationStore';
import { fileBase } from './presentationFiles';
import { STYLE_WARN_BYTES, sizeLabel, styleBytes } from '../../types/presentationStyle';

/** KaTeX's stylesheet with its fonts (woff2) inlined as data URLs, so the exported page needs nothing else. */
async function katexCssInline(): Promise<string> {
  // The stylesheet as built (its font URLs point at this app's copies of the fonts).
  const { default: css } = await import('katex/dist/katex.min.css?inline');
  const base = new URL(location.href);
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
  return css.replace(/url\(([^)]+)\)\s*format\(["']?(woff|truetype)["']?\)\s*,?/g, '').replace(/,\s*([;}])/g, '$1').replace(/url\(([^)]+\.woff2)\)/g, (_m, u: string) => `url(${fonts.get(u.replace(/["']/g, '')) ?? u})`);
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const tk = useTokens();
  const doc = usePresentation(s => s.doc);
  const [layout, setLayout] = useState<'slides' | 'scroll'>('slides');
  const [math, setMath] = useState<'mathml' | 'html'>('mathml');
  const [busy, setBusy] = useState(false);
  // The pictures and fonts, fetched from the library and the font cache and embedded (each once).
  const [prepared, setPrepared] = useState<{ for: Presentation; doc: Presentation } | null>(null);
  useEffect(() => {
    if (!doc) return;
    let live = true;
    withEmbeddedAssets(doc).then(r => { if (live) setPrepared({ for: doc, doc: r.doc }); }, () => { if (live) setPrepared({ for: doc, doc }); });
    return () => { live = false; };
  }, [doc]);
  const ready = prepared && prepared.for === doc ? prepared.doc : null;
  const notes = useMemo(() => (ready ? exportNotes(ready) : doc ? exportNotes({ ...doc, images: [], fonts: [] }) : []), [ready, doc]);
  const kept = useMemo(() => {
    if (!ready) return null;
    const b = styleBytes(ready);
    const families = [...new Set((ready.fonts ?? []).map(f => f.family))];
    const images = (ready.images ?? []).filter(i => i.src).length;
    if (!b.total) return null;
    const parts = [images ? `${images} image background${images === 1 ? '' : 's'}` : '', families.length ? `the fonts ${families.join(', ')}` : ''].filter(Boolean);
    return { text: `It carries ${parts.join(' and ') || 'previews of its pictures'}: ${sizeLabel(b.total)}.`, heavy: b.total > STYLE_WARN_BYTES };
  }, [ready]);
  if (!doc) return null;
  const save = async () => {
    setBusy(true);
    try {
      const md = await loadMarkdown();
      const katexCss = math === 'html' ? await katexCssInline() : undefined;
      const full = ready ?? (await withEmbeddedAssets(doc)).doc;
      const html = buildPresentationHtml(full, md.renderMarkdown, { layout, math, katexCss });
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
        <Button variant="ghost" icon="export" onClick={e => { offerPresentationExport(e.currentTarget); }} title="The presentation with every Play in it, to open in Playfield anywhere: a .playfile, or a readable .present.json">Presentation file</Button>
        <span style={{ flex: 1 }} />
        <Button variant="primary" icon="code" disabled={busy || !ready} onClick={save}>{busy ? 'Building…' : !ready ? 'Gathering pictures…' : 'Save the web page'}</Button>
      </>}
    >
      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: tk.text.muted, font: `500 12.5px/1.55 ${fontFamily.ui}` }}>
          One HTML file with everything in it: the steps, the maths, every picture and its controls. Put it on any website or open it from your computer; nothing else to host.
        </div>
        <div>{label('Layout')}<Segmented fill ariaLabel="Layout" value={layout} onChange={setLayout} options={[{ value: 'slides', label: 'Slides', sub: 'one step at a time' }, { value: 'scroll', label: 'Scroll', sub: 'one long page' }]} /></div>
        <div>{label('Maths')}<Segmented fill ariaLabel="Maths" value={math} onChange={setMath} options={[{ value: 'mathml', label: 'MathML', sub: 'small, the browser draws it' }, { value: 'html', label: 'KaTeX', sub: 'same everywhere, ~360 KB more' }]} /></div>
        {kept && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: kept.heavy ? tk.status.warningText : tk.text.muted, font: `500 12px/1.5 ${fontFamily.ui}` }}>
            <Icon name={kept.heavy ? 'warning' : 'info'} size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{kept.text}{kept.heavy ? ' That’s a heavy page: it will be slow to open on phones. Use fewer image backgrounds.' : ' Embedded, so the page works offline.'}</span>
          </div>
        )}
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
