/**
 * An item's page in Files: a function, graph, Play, preset, script, published
 * node or GLSL shader. Its title and kind, a live picture (a graph's or
 * shader's poster; a function's plot or field with its numbers as sliders),
 * its code folded small, where it's used, its notes and credits, what's
 * inside it, and what to do with it (Open, Export, Duplicate, Delete).
 * A panel on a desktop; the same inside a sheet on a phone.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { formatSize } from '../../utils/library';
import type { FileNode, Inventory } from '../../files/inventory';
import { functionSnippet, isPlayGraph, itemCode, itemRecord } from '../../files/itemCode';
import { initialPreview } from '../../present/codePick';
import type { SnippetContext } from '../../present/snippetHarness';
import type { CodePreview } from '../../types/presentation';
import { IconTile } from './fileUi';
import { capsLabel, cardStyle, KIND_LABELS, when, tintFor } from './fileUiShared';
import { Relations, LinkRow } from './NodeView';
import { useItemPosters } from './useItemPosters';

const CodePreviewPane = lazy(() => import('../present/CodePreview').then(m => ({ default: m.CodePreviewPane })));

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

const NO_CONTEXT: SnippetContext = {};

export function ItemPage({ inv, node, compact, onOpen, onMenu, primary, onExportPlayfile, onExportReadable, onDuplicate, onRemove }: {
  inv: Inventory;
  node: FileNode;
  compact: boolean;
  onOpen: (id: string) => void;
  onMenu: (node: FileNode, at: { x: number; y: number }) => void;
  /** The "Open" button: where it opens. */
  primary: { label: string; icon: 'nodes' | 'play' | 'slides' | 'code' | 'fn'; onClick: () => void } | null;
  onExportPlayfile?: () => void;
  onExportReadable?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
}) {
  const tk = useTokens();
  const rec = useMemo(() => itemRecord(node), [node]);
  const code = useMemo(() => itemCode(node, rec), [node, rec]);
  const snippet = useMemo(() => functionSnippet(node, rec.value), [node, rec]);
  const [preview, setPreview] = useState<CodePreview | undefined>(() => (snippet ? initialPreview(snippet, NO_CONTEXT) ?? { mode: 'plot' } : undefined));
  const posterFor = useMemo(() => (node.kind === 'graph' || node.kind === 'presentation' || node.kind === 'shader' ? [node] : []), [node]);
  const posters = useItemPosters(posterFor);
  const poster = posters[node.id];
  const v = obj(rec.value);
  const play = obj(v?.play);
  const credit = obj(play?.source) ?? obj(v?.source);
  const notes = [str(play?.notes), str(v?.comment), str(v?.note), str(v?.description)].filter((s): s is string => !!s?.trim());
  const comments = rec.raw ? rec.raw.split('"__comment":"').length - 1 : 0;
  const kids = (node.children ?? []).filter(k => k.kind !== 'group' || k.label !== 'Media');
  const cardPad = compact ? '12px 12px' : '14px 16px';
  const isPlay = isPlayGraph(node);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: compact ? '4px 16px 40px' : '22px 28px 48px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <IconTile node={node} size={compact ? 36 : 42} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</h1>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
            {[isPlay ? 'Graph with a Play setup' : KIND_LABELS[node.kind], node.detail, formatSize(node.size), when(node.modified) && `saved ${when(node.modified)}`].filter(Boolean).join(' · ')}
          </span>
        </div>
        <IconButton icon="more" label={`More for ${node.label}`} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu(node, { x: r.right - 240, y: r.bottom + 4 }); }} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: compact ? -2 : -6, paddingLeft: compact ? 0 : 54 }}>
        {primary && <Button size="sm" variant="primary" icon={primary.icon} onClick={primary.onClick}>{primary.label}</Button>}
        {onExportPlayfile && <Button size="sm" icon="export" onClick={onExportPlayfile} title="This and what it uses, in one file that opens anywhere">Export as .playfile…</Button>}
        {onExportReadable && <Button size="sm" icon="code" onClick={onExportReadable} title="A file you can read and edit">Export readable…</Button>}
        {onDuplicate && <Button size="sm" icon="copy" onClick={onDuplicate}>Duplicate</Button>}
        {onRemove && <Button size="sm" variant="ghost" icon="trash" onClick={onRemove}>Delete…</Button>}
      </div>

      {node.unused && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.1), color: tk.status.warningText, font: `12px/1.45 ${fontFamily.ui}` }}>
          <Icon name="warning" size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span><b>Not used.</b> {node.unused}.</span>
        </div>
      )}

      {/* The picture */}
      {posterFor.length > 0 && (
        <div style={{ ...cardStyle(tk), padding: 6, display: 'flex', justifyContent: 'center', background: poster ? tk.bg.render : tk.bg.panel }}>
          <div style={{ width: '100%', maxWidth: 560, aspectRatio: '16 / 9', borderRadius: radius.md, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: poster ? tk.bg.render : alpha(tintFor(tk, node), 0.08) }}>
            {poster ? <img src={poster} alt={`A picture of ${node.label}`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              : poster === null ? <span style={{ fontSize: 12, color: tk.text.faint, padding: 16, textAlign: 'center' }}>{node.kind === 'shader' ? 'This shader can’t be drawn here (it may need textures or buffers). Open it to see it.' : node.kind === 'presentation' ? 'No picture yet: open it on Present and its Plays get their posters.' : 'Couldn’t draw a picture of it.'}</span>
              : <span style={{ fontSize: 12, color: tk.text.faint }}>Drawing…</span>}
          </div>
        </div>
      )}
      {snippet && preview && (
        <div style={{ ...cardStyle(tk), padding: cardPad, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={capsLabel(tk)}>Live preview · its numbers are the sliders</span>
          <Suspense fallback={<div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: tk.text.faint }}>Loading the preview…</div>}>
            <CodePreviewPane code={snippet} settings={preview} context={NO_CONTEXT} onSettings={setPreview} compact={compact} />
          </Suspense>
        </div>
      )}

      {/* Code, folded */}
      {code && <Folded title={code.language === 'json' ? 'The saved JSON' : 'The code'} text={code.text} compact={compact} />}

      <Relations inv={inv} node={node} onOpen={onOpen} compact={compact} />

      {/* Notes and credits */}
      {(notes.length > 0 || credit || comments > 0) && (
        <div style={{ ...cardStyle(tk), padding: cardPad, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={capsLabel(tk)}>Notes and credits</span>
          {notes.map((t, i) => <p key={i} style={{ margin: 0, font: `12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary, whiteSpace: 'pre-wrap' }}>{t.slice(0, 2000)}</p>)}
          {comments > 0 && <span style={{ fontSize: 12, color: tk.text.muted }}>{comments} node comment{comments === 1 ? '' : 's'} inside (see Notes).</span>}
          {credit && str(credit.title) && (
            <span style={{ fontSize: 12, color: tk.text.muted }}>
              Based on {str(credit.url) ? <a href={str(credit.url)} target="_blank" rel="noreferrer" style={{ color: tk.accent.text }}>{str(credit.title)}</a> : <b>{str(credit.title)}</b>}{str(credit.author) ? ` by ${str(credit.author)}` : ''}
            </span>
          )}
        </div>
      )}

      {/* Inside */}
      {kids.length > 0 && (
        <div style={{ ...cardStyle(tk), padding: cardPad, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...capsLabel(tk), marginBottom: 4 }}>Inside</span>
          {kids.map(k => <LinkRow key={k.id} label={k.label} sub={[k.detail, formatSize(k.size)].filter(Boolean).join(' · ')} tone="copy" onClick={() => onOpen(k.id)} />)}
        </div>
      )}
    </div>
  );
}

const FOLD_LINES = 12;

/** Code shown small and folded to its first lines, with Expand. */
export function Folded({ title, text, compact }: { title: string; text: string; compact: boolean }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const lines = text.split('\n');
  const shown = open ? text.slice(0, 60_000) : lines.slice(0, FOLD_LINES).join('\n');
  const more = lines.length > FOLD_LINES;
  return (
    <div style={{ ...cardStyle(tk), padding: compact ? '10px 12px' : '12px 16px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...capsLabel(tk), flex: 1 }}>{title} · {lines.length} line{lines.length === 1 ? '' : 's'}</span>
        {more && <Button size="sm" variant="ghost" icon={open ? 'chevU' : 'chevD'} onClick={() => setOpen(o => !o)}>{open ? 'Fold' : 'Expand'}</Button>}
      </div>
      <pre style={{ margin: 0, font: `11px/1.45 ${fontFamily.mono}`, color: tk.text.secondary, whiteSpace: 'pre', overflow: 'auto', maxHeight: open ? 520 : undefined, tabSize: 2, maskImage: !open && more ? 'linear-gradient(#000 70%, transparent)' : undefined }}>{shown}{open && text.length > 60_000 ? '\n…' : ''}</pre>
    </div>
  );
}

