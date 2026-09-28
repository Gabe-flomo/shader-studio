/**
 * DrumKitRow — the Kit section's "Save kit… / Load kit…" row of a Drum pad
 * layer's editor (docs/drum-pads.md, "Kits"; play/drumKits.ts).
 *
 * Save keeps the whole layer as a kit on this device. Load opens a sheet
 * listing the built-in kits (generated drums) and the saved ones, each with
 * Replace (every pad, the numbers, the settings and the effect chain) or
 * Merge (the kit's sounds land on this layer's empty pads). A saved kit can
 * be renamed, exported as a .playfile with its samples, or deleted. A kit
 * whose samples this device lacks says so; loaded, those pads show "missing".
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DrumPadLayer } from '../../../types/playLayers';
import { AUDIO_FX_EFFECTS } from '../../../types/playAudioFx';
import { hasVideo } from '../../../lib/backgroundLibrary';
import {
  applyDrumKit, BUILTIN_KITS, deleteDrumKit, DRUM_KITS_CHANGED, isBuiltinKit, kitMissing, kitSummary, loadDrumKits, renameDrumKit, saveDrumKit, type DrumKit, type KitLoadMode,
} from '../../../play/drumKits';
import { exportPlayfile } from '../../../playfile/app';
import { reportFileResult } from '../../shell/reportFileResult';
import { Button, IconButton } from '../../ui/Button';
import { Menu } from '../../ui/Menu';
import { Sheet } from '../../ui/Sheet';
import { askConfirm, askText } from '../../ui/dialogStore';
import { toast } from '../../ui/toastStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import type { EditorContext } from './editors';
import type { FieldKit } from './fields';

const subscribe = (fn: () => void) => { window.addEventListener(DRUM_KITS_CHANGED, fn); window.addEventListener('storage', fn); return () => { window.removeEventListener(DRUM_KITS_CHANGED, fn); window.removeEventListener('storage', fn); }; };
let snapshot: { raw: string | null; kits: DrumKit[] } = { raw: null, kits: [] };
function savedKits(): DrumKit[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem('shader-studio:drum-kits'); } catch { /* blocked */ }
  if (raw !== snapshot.raw) snapshot = { raw, kits: loadDrumKits() };
  return snapshot.kits;
}
/** The saved kits, kept current. */
function useSavedKits(): DrumKit[] { return useSyncExternalStore(subscribe, savedKits, savedKits); }

const fxLabel = (kind: string) => AUDIO_FX_EFFECTS[kind as keyof typeof AUDIO_FX_EFFECTS]?.label ?? kind;

export function DrumKitRow({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as DrumPadLayer;
  const [open, setOpen] = useState(false);
  const save = async () => {
    const name = await askText('Save the kit', { label: 'Name', initial: l.label || 'My kit', confirmLabel: 'Save' });
    if (name === null || !name.trim()) return;
    const { result, kit } = saveDrumKit(name, l, ctx.play.audioFx);
    if (reportFileResult(result, { failTitle: 'Couldn’t save the kit' }) && kit) toast.success(`Saved the kit “${kit.name}”`, { message: `${kitSummary(kit, fxLabel)}. Kits are on the Files page under Presets → Drum kits.` });
  };
  return (
    <>
      {f.row('Kit', (
        <>
          <Button size="sm" icon="save" onClick={() => { void save(); }} title="Keep every pad, its numbers, the kit’s settings and its effect chain as a preset on this device">Save kit…</Button>
          <Button size="sm" icon="import" onClick={() => setOpen(true)} title="Load a built-in or saved kit into this layer">Load kit…</Button>
        </>
      ), 'A kit is the whole layer as a preset: every pad’s sound and settings, its numbers, Keys/MIDI/Pad grid, Volume and the effect chain. Samples are named by their library id, so a kit made here plays here; exported as a .playfile it takes its samples along.')}
      {open && <KitSheet layer={l} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

function KitSheet({ layer: l, ctx, onClose }: { layer: DrumPadLayer; ctx: EditorContext; onClose: () => void }) {
  const saved = useSavedKits();
  const kits = [...BUILTIN_KITS, ...saved];
  const [here, setHere] = useState<Set<string> | null>(null);
  const [menu, setMenu] = useState<{ kit: DrumKit; x: number; y: number } | null>(null);
  const empty = l.pads.filter(p => !p.sampleId && !p.synth).length;
  // Which samples this device has, for the "missing" notes.
  useEffect(() => {
    const ids = [...new Set(kits.flatMap(k => k.pads.map(p => p.sampleId).filter(Boolean)))];
    let live = true;
    void Promise.all(ids.map(async id => [id, await hasVideo(id).catch(() => false)] as const)).then(r => { if (live) setHere(new Set(r.filter(([, ok]) => ok).map(([id]) => id))); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const load = (kit: DrumKit, mode: KitLoadMode) => {
    const r = applyDrumKit(l, ctx.play.audioFx, kit, mode);
    ctx.changePlay(p => ({ ...p, layers: p.layers.map(x => (x.id === l.id ? r.layer : x)), audioFx: r.fx }));
    const missing = here ? kitMissing(kit, id => here.has(id)) : [];
    toast.success(mode === 'replace' ? `Loaded the kit “${kit.name}”` : `Merged “${kit.name}” into ${r.filled} empty pad${r.filled === 1 ? '' : 's'}`, missing.length ? { message: `${missing.length} sample${missing.length === 1 ? '' : 's'} this device doesn’t have: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}. Those pads say “missing” until you pick the files again.` } : undefined);
    onClose();
  };
  const rename = async (kit: DrumKit) => {
    const name = await askText('Rename the kit', { label: 'Name', initial: kit.name, confirmLabel: 'Rename' });
    if (name === null || !name.trim()) return;
    reportFileResult(renameDrumKit(kit.id, name), { failTitle: 'Couldn’t rename the kit' });
  };
  const remove = async (kit: DrumKit) => {
    if (!(await askConfirm(`Delete the kit “${kit.name}”?`, { message: 'Layers made from it keep their pads; only the preset goes. Its samples stay in the library.', confirmLabel: 'Delete', danger: true }))) return;
    reportFileResult(deleteDrumKit(kit.id), { failTitle: 'Couldn’t delete the kit' });
  };
  const exportKit = async (kit: DrumKit) => {
    reportFileResult(await exportPlayfile([`dkit:${kit.id}`], { fileName: kit.name, dependencies: false, success: `Exported the kit “${kit.name}”` }), { failTitle: 'Couldn’t export the kit' });
  };

  return (
    <Sheet title="Load a kit" onClose={onClose} zIndex={80} maxHeight="88dvh">
      <div data-kit-list style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 12px' }}>
        <KitGroup label="Built in">
          {BUILTIN_KITS.map(k => <KitCard key={k.id} kit={k} empty={empty} here={here} onLoad={load} />)}
        </KitGroup>
        <KitGroup label="Saved on this device">
          {saved.length === 0 && <span style={{ font: `12px/1.45 ${fontFamily.ui}`, opacity: 0.7, padding: '2px 4px' }}>No saved kits yet. Save kit… keeps this layer as one.</span>}
          {saved.map(k => <KitCard key={k.id} kit={k} empty={empty} here={here} onLoad={load} onMore={(x, y) => setMenu({ kit: k, x, y })} />)}
        </KitGroup>
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} minWidth={220} title={menu.kit.name} onClose={() => setMenu(null)} items={[
          { label: 'Rename…', icon: 'edit', onSelect: () => { void rename(menu.kit); } },
          { label: 'Save as a .playfile…', icon: 'export', hint: 'The kit with the samples it uses, in one file that opens anywhere', onSelect: () => { void exportKit(menu.kit); } },
          'separator',
          { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => { void remove(menu.kit); } },
        ]} />
      )}
    </Sheet>
  );
}

function KitGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6, padding: '0 4px' }}>{label}</span>
      {children}
    </div>
  );
}

function KitCard({ kit, empty, here, onLoad, onMore }: { kit: DrumKit; empty: number; here: Set<string> | null; onLoad: (kit: DrumKit, mode: KitLoadMode) => void; onMore?: (x: number, y: number) => void }) {
  const missing = here ? kitMissing(kit, id => here.has(id)) : [];
  const fills = kit.pads.filter(p => p.sampleId || p.synth).length;
  return (
    <div data-kit={kit.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: radius.md, background: alpha('#888', 0.08), flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}` }}>{kit.name}</span>
        <span style={{ font: `11px/1.4 ${fontFamily.ui}`, opacity: 0.7 }}>{kit.description ? `${kit.description} · ` : ''}{kitSummary(kit, fxLabel)}</span>
        {missing.length > 0 && <span data-kit-missing style={{ font: `11px/1.4 ${fontFamily.ui}`, color: '#d9534f' }}>{missing.length} sample{missing.length === 1 ? '' : 's'} missing on this device</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button size="sm" variant="primary" onClick={() => onLoad(kit, 'replace')} title="Every pad, the numbers, Keys/MIDI/Pad grid, Volume and the effect chain become the kit’s">Replace pads</Button>
        <Button size="sm" disabled={!empty || !fills} onClick={() => onLoad(kit, 'merge')} title={empty ? `The kit’s sounds land on this layer’s ${empty} empty pad${empty === 1 ? '' : 's'}; everything else stays` : 'No empty pads to fill'}>Merge into empty</Button>
        {onMore && !isBuiltinKit(kit) && <IconButton icon="more" size="sm" label={`More for ${kit.name}`} tooltip={false} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMore(r.left, r.bottom + 4); }} />}
      </div>
    </div>
  );
}
