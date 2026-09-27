/**
 * LayersPanel — the Play page's Layers tab: things drawn over the picture by
 * the layer kit (play/kit). Add a layer, edit it here (each kind has its own
 * editor in layers/editors.tsx), and press the small + next to any number to
 * make it a control (target `layer:<id>::<key>`) you can map and drive.
 * Below the layers, actions fire things on triggers.
 *
 * While this tab is open the overlay is in editing mode: shapes can be
 * dragged and invisible zones are outlined.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { accentColor } from '../../theme/categories';
import { kindOf, type LayerKindDef } from '../../types/layerKinds';
import { addKindLayer, kindHint } from '../../play/layerKinds';
import { AddLayerMenu } from './layers/AddLayerMenu';
import { BUILTIN_LAYER, BUILTIN_LAYERS, type BuiltinVariant } from './layers/addLayerCatalog';
import { script3dDefaults } from '../../types/playLayers';
import { fontFamily, radius } from '../../theme/tokens';
import { backgroundLayerOf, layerNumericProps, SENSOR_READS_FOR, defaultLayer, layerTarget, pictureHidden as isPictureHidden, type PlayControl, type PlayLayer, type PlayLayerKind, type PlayRecord } from '../../types/play';
import { playId } from '../../play/playControls';
import { addNullFor, backgroundMenuItems, driveWithNull, duplicateLayer, layerMenuItems, layerNullDrives, moveLayer, removeLayer, renameLayer, resetLayer } from './layerOps';
import { BackgroundEditor } from './layers/BackgroundEditor';
import { addBackground, thisGraphSource } from '../../play/backgroundQueue';
import { toast } from '../ui/toastStore';
import { SoloButton, SoloStrip } from './Solo';
import { LayerReadings } from './MapToMenu';
import { Section } from './layers/Section';
import { usePlayUi } from './playUi';
import { NOTE_REF_TYPE, noteRef } from './noteRefs';
import { playOverlay, type ShapeDrawing } from '../../play/overlay';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Menu } from '../ui/Menu';
import { Tooltip } from '../ui/Tooltip';
import { makeFieldKit } from './layers/fields';
import {
  AudioEditor, BodiesEditor, BrushEditor, CameraEditor, ContoursEditor, GlyphsEditor, ImageEditor, LensEditor, NullEditor, ParticlesEditor, ShapeEditor, TextEditor,
  type EditorContext, ClonerEditor, ScriptEditor } from './layers/editors';
import { ActionsSection } from './layers/ActionsSection';
import { MatteMaskBar } from './layers/MatteMask';
import { matteMaskSummary } from '../../play/mattes';
import { matteUsers } from '../../types/playLayers';

const KIND = BUILTIN_LAYER;

export function LayersPanel({ play, touch, exposedTargets, onChange, onExpose, top }: {
  play: PlayRecord;
  touch: boolean;
  /** Targets that already have a control (their + is shown pressed). */
  exposedTargets: Set<string>;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** Add a control for a numeric layer property. */
  onExpose: (control: PlayControl) => void;
  /** Scrolls with the list, above the layers (phones put the notes here). */
  top?: ReactNode;
}) {
  const tk = useTokens();
  const addRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState(false);
  const selected = usePlayUi(s => s.selected), setSelected = usePlayUi(s => s.select), revealTick = usePlayUi(s => s.revealTick);
  const mask = usePlayUi(s => s.mask);
  const [drawing, setDrawing] = useState<ShapeDrawing | null>(null);
  useEffect(() => { playOverlay.setEditing(true, selected, mask); }, [selected, mask]);
  // A mask picked (or drawn) on the picture opens in its layer's card.
  useEffect(() => playOverlay.onMaskSelect((layerId, maskId) => { const ui = usePlayUi.getState(); if (ui.selected !== layerId) ui.select(layerId); ui.setMask(maskId); }), []);
  useEffect(() => () => { playOverlay.setEditing(false); playOverlay.cancelDrawing(); }, []);
  useEffect(() => playOverlay.onDrawing(d => setDrawing(d ? { ...d } : null)), []);
  // A layer clicked on the picture is selected here too.
  useEffect(() => playOverlay.onSelect(id => usePlayUi.getState().reveal(id)), []);

  const addKind = (k: LayerKindDef) => {
    const id = playId('layer');
    onChange(p => addKindLayer(p, k, id));
    setSelected(id);
  };
  const add = (kind: PlayLayerKind, variant?: BuiltinVariant) => {
    if (kind === 'background') {
      // One per setup, at the bottom. A new one starts with this graph, so the picture stays as it was.
      const there = backgroundLayerOf(play);
      if (there) { usePlayUi.getState().reveal(there.id); toast.info('This setup has a Background layer', { message: 'Add sources to its queue.' }); return; }
      const id = playId('layer');
      onChange(p => addBackground(p, [thisGraphSource()], id).play);
      setSelected(id);
      return;
    }
    // A 3D Script is a Script layer in 3D, starting from the 3D starter.
    const is3d = variant === 'script3d';
    const n = play.layers.filter(l => l.kind === kind && (kind !== 'script' || (l.kind === 'script' && (l.mode === '3d') === is3d))).length + 1;
    const id = playId('layer');
    const made = defaultLayer(kind, id, `${is3d ? '3D Script' : KIND[kind].label} ${n}`);
    onChange(p => ({ ...p, layers: [...p.layers, is3d ? ({ ...made, ...script3dDefaults() } as PlayLayer) : made] }));
    setSelected(id);
  };
  const patch = (id: string, fn: (l: PlayLayer) => PlayLayer) => onChange(p => ({ ...p, layers: p.layers.map(l => l.id === id ? fn(l) : l) }));
  const remove = (id: string) => onChange(p => removeLayer(p, id));
  const move = (id: string, dir: -1 | 1) => onChange(p => moveLayer(p, id, dir));
  const duplicate = (id: string) => { let made = ''; onChange(p => { const r = duplicateLayer(p, id); made = r.id; return r.play; }); if (made) setSelected(made); };
  const reset = (id: string) => onChange(p => resetLayer(p, id));
  const createNull = (id: string, key: string) => onChange(p => addNullFor(p, id, key).play);
  // A property's control plus a null on the picture that drives it, in one go.
  const driveNull = (l: PlayLayer, key: string) => {
    const r = layerNullDrives(l, key);
    if (!r) return;
    onChange(p => driveWithNull(p, r.drives, r.label).play);
    toast.success(`Added “${r.label}”`, { message: 'Drag the dot on the picture to change the value.' });
  };
  // Asked to show a layer (a link in the notes, the picture's menu): scroll to it.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealTick || !selected) return;
    const el = listRef.current?.querySelector(`[data-layer-id="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [revealTick, selected]);
  const expose = (l: PlayLayer, key: string) => {
    const def = layerNumericProps(l).find(d => d.key === key);
    if (!def) return;
    onExpose({ id: playId('ctl'), target: layerTarget(l.id, key), kind: 'float', label: `${l.label} · ${def.label}`, min: def.min, max: def.max, ...(def.step ? { step: def.step } : {}) });
  };

  return (
    <>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 14px', borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel }}>
        <span style={{ font: `650 13px ${fontFamily.ui}` }}>Layers</span>
        {play.layers.length > 0 && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{play.layers.length}</span>}
        <span style={{ flex: 1 }} />
        <span ref={addRef} style={{ display: 'inline-flex' }}>
          <Button size="sm" icon="plus" aria-expanded={menu} onClick={() => setMenu(m => !m)}>Add layer</Button>
        </span>
        {menu && <AddLayerMenu play={play} touch={touch} anchorRef={addRef} onAdd={add} onAddKind={addKind} onChange={onChange} onClose={() => setMenu(false)} />}
      </div>
      <div ref={listRef} style={{ flex: 1, minHeight: play.notes && !top ? 110 : 0, overflowY: 'auto', padding: '6px 12px 12px' }}>
        {top && <div style={{ margin: '0 -12px' }}>{top}</div>}
        <SoloStrip kind="layer" total={play.layers.filter(l => l.kind !== 'null').length} />
        {play.layers.length === 0 ? (
          <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
            <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>No layers yet</div>
            Layers sit on top of the picture: particles that flow along it, shapes that act as walls and emitters, text, images, falling letters, a brush, audio, ASCII, contours, a lens, your camera. Every number can be a control, and actions fire them from keys, beats and notes.
          </div>
        ) : play.layers.map((l, i) => (
          <LayerRow
            key={l.id}
            layer={l}
            layers={play.layers}
            play={play}
            onChangePlay={onChange}
            index={i}
            count={play.layers.length}
            touch={touch}
            selected={selected === l.id}
            pictureHidden={isPictureHidden(play.display)}
            drawing={drawing?.layerId === l.id && !drawing.mask ? drawing.mode : null}
            maskDrawing={drawing?.layerId === l.id && drawing.mask ? drawing.mode : null}
            matteOf={matteUsers(play.layers, l.id)}
            nested={i > 0 && play.layers[i - 1].trackMatte?.id === l.id}
            exposedTargets={exposedTargets}
            onSelect={() => setSelected(l.id)}
            onPatch={fn => patch(l.id, fn)}
            revealTick={selected === l.id ? revealTick : 0}
            onRemove={() => remove(l.id)}
            onRename={label => onChange(p => renameLayer(p, l.id, label))}
            onDuplicate={() => duplicate(l.id)}
            onReset={() => reset(l.id)}
            onCreateNull={key => createNull(l.id, key)}
            onMove={dir => move(l.id, dir)}
            onExpose={key => expose(l, key)}
            onExposeControl={onExpose}
            onDriveNull={key => driveNull(l, key)}
          />
        ))}
        <ActionsSection play={play} onChange={onChange} />
      </div>
    </>
  );
}

function LayerRow({ layer: l, layers, play, onChangePlay, index, count, touch, selected, pictureHidden, drawing, maskDrawing, matteOf, nested, exposedTargets, revealTick, onSelect, onPatch, onRemove, onRename, onDuplicate, onReset, onCreateNull, onMove, onExpose, onExposeControl, onDriveNull }: {
  layer: PlayLayer;
  layers: PlayLayer[];
  play: PlayRecord;
  onChangePlay: (fn: (p: PlayRecord) => PlayRecord) => void;
  index: number;
  count: number;
  touch: boolean;
  selected: boolean;
  pictureHidden: boolean;
  drawing: 'polygon' | 'lasso' | null;
  /** A mask outline is being drawn for this layer. */
  maskDrawing: 'polygon' | 'lasso' | null;
  /** The layers using this one as their matte. */
  matteOf: PlayLayer[];
  /** It sits right after the layer it is the matte of: shown tucked under it. */
  nested: boolean;
  exposedTargets: Set<string>;
  onSelect: () => void;
  onPatch: (fn: (l: PlayLayer) => PlayLayer) => void;
  revealTick: number;
  onRemove: () => void;
  onRename: (label: string) => void;
  onDuplicate: () => void;
  onReset: () => void;
  onCreateNull: (key: string) => void;
  onMove: (dir: -1 | 1) => void;
  onExpose: (key: string) => void;
  onExposeControl: (control: PlayControl) => void;
  onDriveNull: (key: string) => void;
}) {
  const tk = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(l.label);
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  // Shown from elsewhere (a link in the notes, the picture's menu): open it.
  const [seenTick, setSeenTick] = useState(revealTick);
  if (revealTick !== seenTick) { setSeenTick(revealTick); if (revealTick) setOpen(true); }
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== l.label) onRename(t); else setDraft(l.label); };
  const set = (p: Record<string, unknown>) => onPatch(x => ({ ...x, ...p } as PlayLayer));
  const f = makeFieldKit({ l, tk, touch, exposedTargets, set, onExpose, onExposeControl, onDriveNull });
  const ctx: EditorContext = {
    layers,
    act: (kind, amount = 1) => playOverlay.act({ do: kind, layerId: l.id, amount }),
    drawing,
    startDrawing: mode => { onSelect(); playOverlay.startDrawing(l.id, mode); },
    cancelDrawing: () => playOverlay.cancelDrawing(),
    createNull: onCreateNull,
    play,
    changePlay: onChangePlay,
  };
  // A layer made from a saved kind shows the kind's icon, colour and name.
  const mode = useThemeMode();
  const kind = kindOf(l, play.layerKinds);
  const look = kind
    ? { label: kind.name, hint: `${kindHint(kind.hint, kind.paramDefs.length)}. A Script layer underneath.`, icon: kind.icon as IconName, color: accentColor(kind.colour, mode) }
    : l.kind === 'script' && l.mode === '3d' ? { ...(BUILTIN_LAYERS.find(b => b.variant === 'script3d') ?? KIND.script), color: tk.text.faint }
    : { ...KIND[l.kind], color: tk.text.faint };
  let body: ReactNode = null;
  switch (l.kind) {
    case 'null': body = <NullEditor f={f} ctx={ctx} />; break;
    case 'text': body = <TextEditor f={f} ctx={ctx} pictureHidden={pictureHidden} />; break;
    case 'image': body = <ImageEditor f={f} pictureHidden={pictureHidden} />; break;
    case 'camera': body = <CameraEditor f={f} pictureHidden={pictureHidden} />; break;
    case 'particles': body = <ParticlesEditor f={f} ctx={ctx} />; break;
    case 'shape': body = <ShapeEditor f={f} ctx={ctx} />; break;
    case 'audio': body = <AudioEditor f={f} />; break;
    case 'glyphs': body = <GlyphsEditor f={f} ctx={ctx} />; break;
    case 'contours': body = <ContoursEditor f={f} />; break;
    case 'lens': body = <LensEditor f={f} ctx={ctx} />; break;
    case 'brush': body = <BrushEditor f={f} ctx={ctx} />; break;
    case 'bodies': body = <BodiesEditor f={f} ctx={ctx} />; break;
    case 'cloner': body = <ClonerEditor f={f} ctx={ctx} />; break;
    case 'script': body = <ScriptEditor f={f} ctx={ctx} />; break;
    case 'background': body = <BackgroundEditor f={f} ctx={ctx} />; break;
  }
  // The Background layer stays at the bottom: it doesn't move, and there is only one.
  const isBackground = l.kind === 'background';
  const floor = layers[0]?.kind === 'background' ? 1 : 0;

  const summary = !open ? matteMaskSummary(play, l) : '';
  const reveal = usePlayUi(s => s.reveal);

  return (
    <div
      data-layer-id={l.id}
      onPointerDownCapture={onSelect}
      style={{
        position: 'relative', padding: '8px 10px 10px', marginTop: nested ? 4 : 6, marginLeft: nested ? 18 : 0, borderRadius: radius.card, background: tk.bg.panel,
        boxShadow: `inset 0 0 0 ${selected ? 1.5 : 1}px ${selected ? tk.accent.base : tk.border.default}`,
        // A hidden matte is still at work: it isn't dimmed like a hidden layer.
        opacity: l.visible || matteOf.length ? 1 : 0.6,
      }}
    >
      {/* Tucked under the layer it is the matte of, joined by an elbow (After Effects' track matte column). */}
      {nested && <span aria-hidden style={{ position: 'absolute', left: -12, top: -5, width: 11, height: 23, borderLeft: `1.5px solid ${tk.text.faint}`, borderBottom: `1.5px solid ${tk.text.faint}`, borderBottomLeftRadius: 7, opacity: 0.7 }} />}
      <div
        draggable={!editing}
        onDragStart={e => { e.dataTransfer.setData(NOTE_REF_TYPE, noteRef('layer', l.id)); e.dataTransfer.setData('text/plain', noteRef('layer', l.id)); e.dataTransfer.effectAllowed = 'copy'; }}
        title="Drag onto the notes to link this layer"
        style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}
      >
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Collapse layer' : 'Expand layer'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />
        <Tooltip label={look.label} description={look.hint}><Icon name={look.icon} size={14} style={{ color: look.color, flexShrink: 0 }} /></Tooltip>
        {editing ? (
          <Field autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(l.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
        ) : (
          <button type="button" title="Rename" onClick={() => { setDraft(l.label); setEditing(true); }} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'text', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</button>
        )}
        {l.kind !== 'null' && !isBackground && <SoloButton kind="layer" id={l.id} />}
        <span title={matteOf.length ? (l.visible ? 'Showing on its own too. Off: only as the matte' : 'Hidden, working as the matte. On: show it on its own too') : l.visible ? 'Hide' : 'Show'} style={{ display: 'inline-flex' }}>
          <Toggle checked={l.visible} onChange={visible => set({ visible })} />
        </span>
        {!isBackground && <IconButton icon="chevU" label="Move up (drawn earlier)" size="sm" disabled={index <= floor} tooltip={false} onClick={() => onMove(-1)} />}
        {!isBackground && <IconButton icon="chevD" label="Move down (drawn later, on top)" size="sm" disabled={index === count - 1} tooltip={false} onClick={() => onMove(1)} />}
        <span ref={moreRef} style={{ display: 'inline-flex' }}>
          <IconButton icon="more" label="More: duplicate, reset, delete" size="sm" tooltip={false} onClick={() => { const r = moreRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 220, y: r.bottom + 4 } : null); }} />
        </span>
        {menu && <Menu x={menu.x} y={menu.y} minWidth={220} onClose={() => setMenu(null)} items={isBackground ? backgroundMenuItems({ onReset, onRemove }) : layerMenuItems({ onDuplicate, onReset, onRemove })} />}
      </div>
      {matteOf.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '2px 0 0 20px', color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, minWidth: 0 }}>
          <Icon name="link" size={13} style={{ color: tk.accent.base }} />
          <span style={{ whiteSpace: 'nowrap' }}>Matte for</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {matteOf.map((u, k) => (
              <span key={u.id}>
                {k > 0 && ', '}
                <button type="button" onClick={() => reveal(u.id)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: 'inherit' }}>{u.label}</button>
              </span>
            ))}
          </span>
          {!l.visible && <span style={{ whiteSpace: 'nowrap' }}>· hidden</span>}
        </div>
      )}
      {summary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '2px 0 0 20px', color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <Icon name={l.trackMatte ? 'link' : 'mask'} size={13} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
        </div>
      )}
      {open && (
        <>
          <MatteMaskBar f={f} play={play} changePlay={onChangePlay} drawing={maskDrawing} onSelect={onSelect} />
          {body}
          {SENSOR_READS_FOR[l.kind] && l.kind !== 'null' && (
            <Section kind={l.kind} title={l.kind === 'audio' ? 'Bands' : 'Readings'} hint={l.kind === 'audio'
              ? 'How loud each part of the sound is right now. Map… sends one to a control: bass to size, treble to sparkle.'
              : 'What this layer measures right now. Map… sends it to a control.'}>
              <LayerReadings layer={l} />
            </Section>
          )}
          {l.kind !== 'null' && !isBackground && f.toggle('Shader', 'toShader', 'Seen by the Layers node', 'Include this layer in what the graph\'s Layers node reads (its colour, alpha and distance), so shader effects like SDF Glow can use it.')}
        </>
      )}
    </div>
  );
}

