/**
 * MyBlocks — saving your own space blocks and the library's "My blocks" (docs/scene-builder-2d.md,
 * "My blocks"): the Save block form, the saved blocks as library tiles with their pictures, and
 * rename / duplicate / copy / export / delete / import. The stored work is sceneBuilder2d/savedBlocks.ts.
 */
import { useEffect, useState } from 'react';
import type { CombineSpec, SpaceBlock } from '../../sceneBuilder2d/blocks';
import { BLOCK_CATEGORIES } from '../../sceneBuilder2d/blockLibrary';
import {
  MY_BLOCKS, MY_BLOCKS_LABEL, SAVED_BLOCKS_CHANGED, SAVED_BLOCKS_KEY, categoryLabel, deleteSavedBlock, duplicateSavedBlock, exportSavedBlock, importSavedBlock,
  loadSavedBlocks, renameSavedBlock, saveSavedBlock, savedBlockFrom, savedBlockOk, type SavedBlock, type SavedCategory,
} from '../../sceneBuilder2d/savedBlocks';
import { openTextFile, saveTextFile } from '../../utils/fileIO';
import { askConfirm, askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { reportFileResult } from '../shell/reportFileResult';
import { BuilderNote } from '../builders/BuilderWindow';
import { Button, IconButton } from '../ui/Button';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

/** The saved blocks, re-read when they change (this tab's event, another tab's storage event). */
export function useSavedBlocks(): SavedBlock[] {
  const [list, setList] = useState<SavedBlock[]>(() => loadSavedBlocks());
  useEffect(() => {
    const on = () => setList(loadSavedBlocks());
    const onStorage = (e: StorageEvent) => { if (e.key === SAVED_BLOCKS_KEY) on(); };
    window.addEventListener(SAVED_BLOCKS_CHANGED, on);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(SAVED_BLOCKS_CHANGED, on); window.removeEventListener('storage', onStorage); };
  }, []);
  return list;
}

export const CATEGORY_OPTIONS = [{ value: MY_BLOCKS, label: MY_BLOCKS_LABEL }, ...BLOCK_CATEGORIES.map(c => ({ value: c.id, label: c.label }))];

/**
 * Save block: a name, a line on what it does, a category, whether Random may offer it. Saving
 * under a name that's taken replaces that block (how a saved block is edited). `onSaved` gets the
 * name so the scene's block can link back to it.
 */
export function SaveBlockForm({ src, onSaved, onCancel }: { src: { block?: SpaceBlock; combine?: CombineSpec }; onSaved: (name: string) => void; onCancel: () => void }) {
  const tk = useTokens();
  const list = useSavedBlocks();
  const from = src.combine?.my ?? src.block?.my;
  const was = from ? list.find(s => s.name === from) : undefined;
  const [name, setName] = useState(from ?? (src.block?.name && src.block.name !== 'My block' && src.block.name !== 'Block' ? src.block.name : ''));
  const [blurb, setBlurb] = useState(was?.blurb ?? '');
  const [category, setCategory] = useState<SavedCategory>(was?.category ?? MY_BLOCKS);
  const [random, setRandom] = useState(was?.random ?? false);
  const ok = savedBlockOk(src);
  const replaces = list.find(s => s.name.toLowerCase() === name.trim().toLowerCase());
  const save = () => {
    const s = savedBlockFrom(src, { name, blurb, category, random });
    if (!s) return;
    if (reportFileResult(saveSavedBlock(s), { failTitle: 'Couldn’t save the block', success: replaces ? `Updated “${s.name}”` : `Saved “${s.name}” to My blocks` })) onSaved(s.name);
  };
  const field: React.CSSProperties = { height: 28, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, minWidth: 0 };
  return (
    <div data-save-block-form style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, background: tk.bg.panel }}>
      <b style={{ fontSize: 12.5 }}>{src.combine ? 'Save this combine' : 'Save this block'}</b>
      <input aria-label="Block name" placeholder="Name (e.g. Wobble rings)" value={name} autoFocus onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim() && ok) save(); if (e.key === 'Escape') onCancel(); }} style={field} />
      <input aria-label="What it does" placeholder="What it does, in a line (optional)" value={blurb} onChange={e => setBlurb(e.target.value)} style={field} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ width: 190 }}><Select ariaLabel="Category" height={28} value={category} options={CATEGORY_OPTIONS} onChange={v => setCategory(v as SavedCategory)} /></span>
        <Toggle checked={random} onChange={setRandom} label="Random may offer it" />
      </div>
      {!ok && <BuilderNote style={{ color: tk.status.danger }}>A line doesn’t check yet: fix it before saving.</BuilderNote>}
      {replaces && <BuilderNote>Replaces your saved “{replaces.name}”.</BuilderNote>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" icon="save" data-save-block-confirm disabled={!name.trim() || !ok} onClick={save}>{replaces ? 'Replace' : 'Save'}</Button>
      </div>
    </div>
  );
}

/** Rename, duplicate, copy as text, export as a file, delete: the buttons on a saved tile. */
function SavedActions({ s }: { s: SavedBlock }) {
  const rename = async () => {
    const n = await askText('Rename block', { initial: s.name, confirmLabel: 'Rename' });
    if (n && n.trim() && n.trim() !== s.name) reportFileResult(renameSavedBlock(s.id, n), { failTitle: 'Couldn’t rename the block' });
  };
  const remove = async () => {
    if (await askConfirm(`Delete “${s.name}”?`, { message: 'It leaves My blocks. Scenes that use it keep their own copy of its lines.', confirmLabel: 'Delete', danger: true })) {
      reportFileResult(deleteSavedBlock(s.id), { failTitle: 'Couldn’t delete the block' });
    }
  };
  const copy = () => { navigator.clipboard?.writeText(exportSavedBlock(s)).then(() => toast.success(`Copied “${s.name}”: paste it into Import on another machine`), () => toast.error('Couldn’t copy')); };
  const exportFile = async () => {
    const r = await saveTextFile(exportSavedBlock(s), `${s.name.replace(/[^\w -]+/g, '').trim() || 'block'}.spaceblock.json`);
    if (!r.ok && !('cancelled' in r && r.cancelled)) reportFileResult(r, { failTitle: 'Couldn’t export the block' });
  };
  return (
    <span style={{ display: 'flex', gap: 0 }} onClick={e => e.stopPropagation()}>
      <IconButton icon="edit" label={`Rename ${s.name}`} size="sm" onClick={() => void rename()} />
      <IconButton icon="copy" label={`Duplicate ${s.name}`} size="sm" onClick={() => reportFileResult(duplicateSavedBlock(s.id).result, { failTitle: 'Couldn’t duplicate the block' })} />
      <IconButton icon="export" label={`Copy ${s.name} as text to share`} size="sm" onClick={copy} />
      <IconButton icon="save" label={`Export ${s.name} as a file`} size="sm" onClick={() => void exportFile()} />
      <IconButton icon="trash" label={`Delete ${s.name}`} size="sm" onClick={() => void remove()} />
    </span>
  );
}

/** A saved block as a library tile: its picture, name, what it does, sliders, and its buttons. */
export function SavedTile({ s, thumb, onPick }: { s: SavedBlock; thumb: number; onPick: () => void }) {
  const tk = useTokens();
  const params = s.combine ? [...s.combine.a.params, ...s.combine.b.params] : s.block?.params ?? [];
  return (
    <div role="button" tabIndex={0} data-saved-block={s.name} onClick={onPick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      title={s.combine ? `Combine (${s.combine.mode}) of ${s.combine.a.name || 'A'} and ${s.combine.b.name || 'B'}` : s.block?.lines.map(l => `${l.target} ${l.op} ${l.rhs}`).join('\n')}
      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 8, borderRadius: radius.md, cursor: 'pointer', background: tk.bg.field, color: tk.text.primary }}>
      <img src={s.thumb} alt={`A grid warped by ${s.name}`} width={thumb} height={thumb} style={{ width: thumb, height: thumb, borderRadius: 6, display: 'block', flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, overflowWrap: 'anywhere' }}>{s.name}{s.combine && <span style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.text.muted }}> · combine</span>}</span>
        {s.blurb && <span style={{ font: `500 11px/1.35 ${fontFamily.ui}`, color: tk.text.muted }}>{s.blurb}</span>}
        <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>
          {[s.category !== MY_BLOCKS ? categoryLabel(s.category) : '', params.map(p => p.name).join(' · '), s.random ? 'in Random' : ''].filter(Boolean).join(' — ')}
        </span>
        <SavedActions s={s} />
      </span>
    </div>
  );
}

/** Import: paste a shared block's text, or open a .spaceblock.json file. */
export function ImportBlock({ onDone }: { onDone: () => void }) {
  const tk = useTokens();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = (t: string) => {
    const r = importSavedBlock(t, loadSavedBlocks());
    if (!r.block) { setError(r.error ?? 'Couldn’t read that.'); return; }
    if (reportFileResult(saveSavedBlock(r.block), { failTitle: 'Couldn’t import the block', success: `Added “${r.block.name}” to My blocks` })) onDone();
  };
  const open = async () => { try { const t = await openTextFile('.json'); if (t) add(t); } catch (e) { setError(String(e)); } };
  return (
    <div data-import-block style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea aria-label="Shared block text" placeholder="Paste a block’s text (Copy on a saved block gives it)" value={text} rows={3} onChange={e => { setText(e.target.value); setError(null); }}
        style={{ padding: 8, borderRadius: radius.sm, border: `1px solid ${error ? tk.status.danger : tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, resize: 'vertical' }} />
      {error && <div role="alert" style={{ fontSize: 11.5, color: tk.status.danger }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" icon="folder" onClick={() => void open()}>Open a file…</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" icon="import" disabled={!text.trim()} onClick={() => add(text)}>Add</Button>
      </div>
    </div>
  );
}
