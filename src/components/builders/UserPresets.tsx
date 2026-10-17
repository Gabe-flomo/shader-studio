/**
 * UserPresets — your own presets in a builder's presets strip (docs/scene-builder.md, "Your presets"):
 * after the builder's built-ins, a card per preset you saved (its picture, its name; click to load,
 * the pencil renames, × deletes) and "+ Save this scene", which asks for a name and keeps the scene
 * with a picture of the viewport as it is now. Presets are the builder's own (builders/userPresets.ts,
 * one list per builder): they load only in the builder they were saved from, and never make a graph
 * by themselves.
 *
 * It draws its cards inline (display: contents), so a builder puts it in its strip's row after its own.
 */
import { useRef, useState, type CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { toast } from '../ui/toastStore';
import { PresetCard } from './studio/StudioShell';
import { builderPresets, type PresetBuilderKind } from '../../builders/userPresets';
import { captureViewportThumb } from './viewportThumb';

export interface UserPresetsProps {
  kind: PresetBuilderKind;
  /** The scene now, as preset text. */
  getRecipe: () => string;
  /** Load a preset's text into the builder (one undo step). */
  onLoad: (recipe: string) => void;
  /** The builder's own picture of its scene, when the viewport can't be read. */
  fallbackThumb?: () => string | null;
  /** "scene", "rule", "warp": the word on the save tile and in default names. */
  noun?: string;
  /** The viewport's canvas, when it isn't in the studio's viewport (captureViewportThumb). */
  canvasSelector?: string;
}

export function UserPresets({ kind, getRecipe, onLoad, fallbackThumb, noun = 'scene', canvasSelector }: UserPresetsProps) {
  const tk = useTokens();
  const store = builderPresets(kind);
  const mine = store(s => s.presets);
  const [naming, setNaming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const fallbackName = `My ${noun} ${mine.length + 1}`;

  const saveNow = () => {
    const name = (naming ?? '').trim() || fallbackName;
    const thumb = captureViewportThumb(root.current, fallbackThumb, canvasSelector);
    const { stored } = store.getState().add(name, getRecipe(), thumb);
    setNaming(null);
    if (stored) toast.success(`Saved "${name}" to your presets.`);
    else toast.warning(`Saved "${name}" for now: this browser's storage is full, so it won't be here after a reload.`);
  };
  const renameNow = () => {
    if (renaming) store.getState().rename(renaming.id, renaming.name);
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
    <span ref={root} data-user-presets={kind} style={{ display: 'contents' }}>
      {mine.map(p => (renaming?.id === p.id
        ? <span key={p.id} data-user-preset={p.id}>{nameForm(renaming.name, name => setRenaming({ id: p.id, name }), renameNow, () => setRenaming(null), 'New name', p.name, { 'data-rename-preset-form': p.id })}</span>
        : (
          <span key={p.id} data-user-preset={p.id} style={{ position: 'relative', flexShrink: 0 }}>
            <PresetCard id={p.id} label={p.name} hint="Your preset: click to load it (undo takes it back)" src={p.thumb} onClick={() => onLoad(p.recipe)} />
            <button type="button" aria-label={`Rename ${p.name}`} title="Rename this preset" data-rename-preset={p.id}
              onClick={() => setRenaming({ id: p.id, name: p.name })} style={corner(28)}>✎</button>
            <button type="button" aria-label={`Delete ${p.name}`} title="Delete this preset" data-delete-preset={p.id}
              onClick={() => { store.getState().remove(p.id); toast.info(`Deleted "${p.name}".`); }} style={corner(4)}>×</button>
          </span>
        )))}
      {naming === null
        ? <button type="button" data-save-preset style={tile} onClick={() => setNaming('')} title={`Save this ${noun} as a preset, with a picture of the view`}>+ Save this {noun}</button>
        : nameForm(naming, setNaming, saveNow, () => setNaming(null), "Preset name", fallbackName, { 'data-save-preset-form': kind })}
    </span>
  );
}
