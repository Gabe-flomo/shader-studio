/**
 * PresetMenu — one way to pick, save and manage presets of any kind (presets/presetStore.ts):
 *
 *   variant "menu"   a Presets button opening a list: the kind's built-ins, then yours (click to
 *                    apply; rename and delete on hover), "Save this … as a preset", and at the foot
 *                    Export, Import and "In the Library".
 *   variant "strip"  a builder's presets strip (docs/scene-builder.md, "Your presets"): a card per
 *                    preset you saved (its picture and name; click loads, ✎ renames, × deletes),
 *                    "+ Save this scene", and "All…" opening the same list as the menu.
 *
 * Whichever kind, the list, the save form, the rename and the delete are the same, and every
 * preset saved here also shows in the Library's Presets filter (or its own filter, for functions,
 * Expression Blocks and keyframe curves).
 */
import { useRef, useState, type CSSProperties } from 'react';
import '../../presets/presetKinds';
import {
  exportPresets, importPresets, presetKind, removePreset, renamePreset, savePreset, usePresets, type PresetItem,
} from '../../presets/presetStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toastStore';
import { errorMessage, openTextFile, saveTextFile } from '../../utils/fileIO';
import { reportFileResult } from '../shell/reportFileResult';
import { PresetCard } from '../builders/studio/StudioShell';
import { withUndo } from '../../library/libraryFacade';

export interface PresetMenuProps {
  /** The preset kind (presets/presetKinds.ts): "keyframe", "builder:3d", "transform"… */
  kind: string;
  variant?: 'menu' | 'strip';
  /** Load a preset (one undo step, where the host has undo). */
  onApply: (item: PresetItem) => void;
  /** The current thing as a preset's own fields; omit to offer no saving here, null when there is nothing to save. */
  getData?: () => Record<string, unknown> | null;
  /** A picture for a new preset (the strip's cards show it). */
  getThumb?: () => string | null;
  /** "scene", "curve", "warp": the word on the save row and in default names. */
  noun?: string;
  /** The menu button's label (default "Presets"). */
  label?: string;
  /** Built-ins are drawn by the host (a builder's own cards): list only yours. */
  hideBuiltIns?: boolean;
  /** A builder's id on the strip (`data-user-presets`), so tests and styles find it. */
  stripId?: string;
  /** The menu button's icon. */
  icon?: IconName;
  /** The name a new preset gets when none is typed (default "My <noun> <n>"). */
  defaultName?: () => string;
}

export function PresetMenu(props: PresetMenuProps) {
  return props.variant === 'strip' ? <PresetStrip {...props} /> : <PresetMenuButton {...props} />;
}

/** Save a preset of `kind` and say how it went. */
function saveNow(kind: string, name: string, data: Record<string, unknown>, thumb: string | null | undefined): boolean {
  const r = savePreset(kind, name, data, { thumb });
  if (r.ok) { toast.success(`Saved “${name}” to your presets.`); return true; }
  if (r.id) { toast.warning(`Saved “${name}” for now: this browser’s storage is full, so it won’t be here after a reload.`); return true; }
  toast.error('Couldn’t save the preset', { message: r.error });
  return false;
}

function deleteWithUndo(item: PresetItem): void {
  const { result, undo } = withUndo(() => removePreset(item.kind, item.id));
  if (!result.ok) { toast.error('Couldn’t delete it', { message: result.error }); return; }
  let undone = false;
  toast.info(`Deleted “${item.name}”.`, { action: { label: 'Undo', stillValid: () => !undone, onClick: () => { if (undone) return; undone = true; undo(); } } });
}

async function exportKind(kind: string, items: PresetItem[]): Promise<void> {
  const label = presetKind(kind)?.label ?? 'presets';
  const text = JSON.stringify(exportPresets(items.map(i => ({ kind, id: i.id }))), null, 1);
  reportFileResult(await saveTextFile(text, `${label}.library.json`), { failTitle: 'Couldn’t export the presets', success: `Exported ${items.length} preset${items.length === 1 ? '' : 's'}` });
}

async function importKind(): Promise<void> {
  let text: string | null;
  try { text = await openTextFile('.json'); } catch (e) { toast.error('Couldn’t open that file', { message: errorMessage(e) }); return; }
  if (text == null) return;
  const r = importPresets(text);
  if (!r.ok) { toast.error('Couldn’t import those presets', { message: r.error }); return; }
  toast.success('Presets imported', { message: r.added ? `${r.added} added${r.kept ? ` · ${r.kept} you already had (yours kept)` : ''}` : 'Nothing new' });
}

function openInLibrary(): void {
  void import('../../library/appLibrary').then(m => m.openLibrary('presets'));
}

// ── The list (the menu, and the strip's "All…") ─────────────────────────────

function PresetList({ kind, onApply, getData, getThumb, noun = 'preset', hideBuiltIns, defaultName, onDone }: PresetMenuProps & { onDone: () => void }) {
  const tk = useTokens();
  const def = presetKind(kind);
  const { mine, builtIns } = usePresets(kind);
  const [q, setQ] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const match = (p: PresetItem) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase());
  const fallbackName = defaultName?.() || `My ${noun} ${mine.length + 1}`;
  const head = (label: string) => <div style={{ padding: '8px 8px 3px', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>;
  const rowStyle: CSSProperties = { width: '100%', minHeight: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 0 8px', borderRadius: radius.md };
  const thumb = (p: PresetItem) => (p.thumb ? <img src={p.thumb} alt="" style={{ width: 28, height: 18, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }} /> : <Icon name="presets" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />);
  const data = getData ? getData() : undefined;
  return (
    <div data-preset-menu={kind} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(mine.length + builtIns.length) > 8 && <Field autoFocus aria-label="Search presets" placeholder="Search presets" height={28} value={q} onChange={e => setQ(e.target.value)} style={{ margin: '2px 2px 4px' }} />}
      {getData && (naming === null
        ? <button type="button" data-preset-save="" disabled={!data} onClick={() => setNaming('')}
            style={{ ...rowStyle, border: 0, background: 'none', cursor: data ? 'pointer' : 'default', color: data ? tk.text.primary : tk.text.disabled, font: `500 12.5px ${fontFamily.ui}`, textAlign: 'left' }}>
            <Icon name="save" size={14} style={{ color: tk.text.faint }} />Save this {noun} as a preset…
          </button>
        : <form data-preset-save-form="" onSubmit={e => { e.preventDefault(); const d = getData(); if (d && saveNow(kind, naming.trim() || fallbackName, d, getThumb?.())) setNaming(null); }}
            style={{ display: 'flex', gap: 6, padding: 4 }}>
            <Field autoFocus aria-label="Preset name" placeholder={fallbackName} height={28} value={naming} onChange={e => setNaming(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setNaming(null); }} style={{ flex: 1, minWidth: 0 }} />
            <Button size="sm" type="submit">Save</Button>
          </form>)}
      {!hideBuiltIns && builtIns.filter(match).length > 0 && <>
        {head('Built in')}
        {builtIns.filter(match).map(p => (
          <button key={p.id} type="button" data-preset-builtin={p.id} title={p.hint} onClick={() => { onApply(p); onDone(); }}
            style={{ ...rowStyle, border: 0, background: 'none', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, textAlign: 'left' }}
            onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
            {thumb(p)}<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
          </button>
        ))}
      </>}
      {head('Yours')}
      {mine.length === 0 && <div style={{ padding: '4px 8px 6px', fontSize: 12, color: tk.text.faint }}>None saved yet{getData ? `: save this ${noun} to keep it.` : '.'}</div>}
      {mine.filter(match).map(p => renaming?.id === p.id
        ? <form key={p.id} data-preset-rename-form={p.id} onSubmit={e => { e.preventDefault(); const r = renamePreset(kind, p.id, renaming.name); if (!r.ok) toast.error('Couldn’t rename it', { message: r.error }); setRenaming(null); }} style={{ padding: 2 }}>
            <Field autoFocus aria-label="New name" height={28} value={renaming.name} onChange={e => setRenaming({ id: p.id, name: e.target.value })}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setRenaming(null); }} onBlur={() => setRenaming(null)} />
          </form>
        : <PresetRow key={p.id} item={p} thumb={thumb(p)} onApply={() => { onApply(p); onDone(); }} onRename={() => setRenaming({ id: p.id, name: p.name })} onDelete={() => deleteWithUndo(p)} />)}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', borderTop: `1px solid ${tk.border.subtle}`, marginTop: 4, paddingTop: 4 }}>
        <IconButton icon="export" size="sm" label={`Export your ${def?.label.toLowerCase() ?? 'presets'}`} disabled={mine.length === 0} onClick={() => { void exportKind(kind, mine); }} />
        <IconButton icon="import" size="sm" label="Import presets (a Library export)" onClick={() => { void importKind(); }} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon="folder" onClick={() => { openInLibrary(); onDone(); }} title="Every preset you saved, of every kind, with folders">In the Library</Button>
      </div>
    </div>
  );
}

function PresetRow({ item, thumb, onApply, onRename, onDelete }: { item: PresetItem; thumb: React.ReactNode; onApply: () => void; onRename: () => void; onDelete: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <div data-preset-item={item.id} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ minHeight: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 0 8px', borderRadius: radius.md, background: hover ? tk.bg.hover : 'transparent' }}>
      {thumb}
      <button type="button" onClick={onApply} title={item.hint ? `${item.name} — ${item.hint}` : item.name}
        style={{ flex: 1, minWidth: 0, height: 30, border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</button>
      <span style={{ display: 'flex', gap: 2, visibility: hover ? 'visible' : 'hidden' }}>
        <IconButton icon="edit" size="sm" label={`Rename ${item.name}`} tooltip={false} onClick={onRename} />
        <IconButton icon="trash" size="sm" tone="danger" label={`Delete ${item.name}`} tooltip={false} onClick={onDelete} />
      </span>
    </div>
  );
}

// ── The menu ────────────────────────────────────────────────────────────────

function PresetMenuButton(props: PresetMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const { mine } = usePresets(props.kind);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <Button size="sm" variant="ghost" icon={props.icon ?? 'presets'} aria-expanded={open} data-preset-menu-button={props.kind} onClick={() => setOpen(o => !o)}>
        {props.label ?? 'Presets'}{mine.length ? ` · ${mine.length}` : ''} <Icon name="chevD" size={13} />
      </Button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={280} padding={6}>
          <PresetList {...props} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </span>
  );
}

// ── The strip ───────────────────────────────────────────────────────────────

function PresetStrip(props: PresetMenuProps) {
  const { kind, onApply, getData, getThumb, noun = 'scene', stripId } = props;
  const tk = useTokens();
  const { mine } = usePresets(kind);
  const [naming, setNaming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [all, setAll] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  const fallbackName = `My ${noun} ${mine.length + 1}`;

  const save = () => {
    const d = getData?.();
    if (!d) return;
    if (saveNow(kind, (naming ?? '').trim() || fallbackName, d, getThumb?.())) setNaming(null);
  };
  const rename = () => {
    if (renaming) { const r = renamePreset(kind, renaming.id, renaming.name); if (!r.ok) toast.error('Couldn’t rename it', { message: r.error }); }
    setRenaming(null);
  };

  const tile: CSSProperties = { flexShrink: 0, width: 132, height: 76, borderRadius: radius.md, border: `1px dashed ${tk.border.strong}`, background: 'transparent', color: tk.text.muted, font: `600 12px ${fontFamily.ui}`, cursor: 'pointer' };
  const formTile: CSSProperties = { ...tile, border: `1px solid ${tk.accent.base}`, cursor: 'default', display: 'flex', flexDirection: 'column', gap: 6, padding: 8, boxSizing: 'border-box', height: 'auto' };
  const input: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '3px 6px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.ui}` };
  const ok: CSSProperties = { flex: 1, border: 0, borderRadius: radius.sm, background: tk.accent.base, color: '#fff', font: `600 11.5px ${fontFamily.ui}`, padding: '3px 0', cursor: 'pointer' };
  const cancel: CSSProperties = { border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}`, padding: '3px 8px', cursor: 'pointer' };
  const corner = (right: number): CSSProperties => ({ position: 'absolute', top: 4, right, width: 20, height: 20, borderRadius: 10, border: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', font: `600 12px ${fontFamily.ui}`, cursor: 'pointer', lineHeight: '20px', padding: 0 });

  const nameForm = (value: string, set: (v: string) => void, submit: () => void, close: () => void, label: string, placeholder: string, attr: Record<string, string>) => (
    <form {...attr} onSubmit={e => { e.preventDefault(); submit(); }} style={formTile}>
      <input autoFocus aria-label={label} placeholder={placeholder} value={value} onChange={e => set(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }} style={input} />
      <span style={{ display: 'flex', gap: 6 }}>
        <button type="submit" style={ok}>Save</button>
        <button type="button" onClick={close} style={cancel}>Cancel</button>
      </span>
    </form>
  );

  return (
    <span ref={root} data-user-presets={stripId ?? kind} style={{ display: 'contents' }}>
      {mine.map(p => (renaming?.id === p.id
        ? <span key={p.id} data-user-preset={p.id}>{nameForm(renaming.name, name => setRenaming({ id: p.id, name }), rename, () => setRenaming(null), 'New name', p.name, { 'data-rename-preset-form': p.id })}</span>
        : (
          <span key={p.id} data-user-preset={p.id} style={{ position: 'relative', flexShrink: 0 }}>
            <PresetCard id={p.id} label={p.name} hint="Your preset: click to load it (undo takes it back)" src={p.thumb} onClick={() => onApply(p)} />
            <button type="button" aria-label={`Rename ${p.name}`} title="Rename this preset" data-rename-preset={p.id}
              onClick={() => setRenaming({ id: p.id, name: p.name })} style={corner(28)}>✎</button>
            <button type="button" aria-label={`Delete ${p.name}`} title="Delete this preset" data-delete-preset={p.id}
              onClick={() => deleteWithUndo(p)} style={corner(4)}>×</button>
          </span>
        )))}
      {getData && (naming === null
        ? <button type="button" data-save-preset style={tile} onClick={() => setNaming('')} title={`Save this ${noun} as a preset, with a picture of the view`}>+ Save this {noun}</button>
        : nameForm(naming, setNaming, save, () => setNaming(null), 'Preset name', fallbackName, { 'data-save-preset-form': stripId ?? kind }))}
      <button ref={allRef} type="button" data-preset-all={kind} style={{ ...tile, width: 64, border: `1px solid ${tk.border.default}` }} onClick={() => setAll(o => !o)}
        title="All your presets of this builder: search, export, import, and the Library">All…</button>
      {all && (
        <Popover anchorRef={allRef} onClose={() => setAll(false)} align="end" width={300} padding={6}>
          <PresetList {...props} hideBuiltIns onDone={() => setAll(false)} />
        </Popover>
      )}
    </span>
  );
}
