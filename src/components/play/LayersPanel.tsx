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
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { LAYER_NUMERIC_PROPS, defaultLayer, layerTarget, type PlayControl, type PlayLayer, type PlayLayerKind, type PlayRecord } from '../../types/play';
import { playId } from '../../play/playControls';
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
  type EditorContext,
} from './layers/editors';
import { ActionsSection } from './layers/ActionsSection';

const KINDS: { kind: PlayLayerKind; label: string; hint: string; icon: IconName }[] = [
  { kind: 'particles', label: 'Particles', hint: 'Flow along the picture, flock, swarm nulls and shapes, burst on the beat.', icon: 'spark' },
  { kind: 'shape', label: 'Shape', hint: 'Boxes, circles, lines or drawn outlines: to see, and as walls, emitters, portals, sensors.', icon: 'layoutCanvas' },
  { kind: 'null', label: 'Null', hint: 'A point to drag or animate. Drives mappings, follows things, emits or absorbs particles.', icon: 'grip' },
  { kind: 'text', label: 'Text', hint: 'Words over the picture or the picture inside them. Can step through lines.', icon: 'edit' },
  { kind: 'image', label: 'Image', hint: 'A picture of your own, blended or matted.', icon: 'overlay' },
  { kind: 'bodies', label: 'Bodies', hint: 'Letters, circles or boxes that fall, bounce and pile up.', icon: 'dice' },
  { kind: 'brush', label: 'Brush', hint: 'Paint on the picture with the mouse. Strokes fade and can be walls.', icon: 'curve' },
  { kind: 'audio', label: 'Audio', hint: 'Live sound as a waveform, bars, a ring or a blob.', icon: 'wave' },
  { kind: 'glyphs', label: 'Glyphs', hint: 'The picture as ASCII, halftone dots, squares or lines.', icon: 'hash' },
  { kind: 'contours', label: 'Contours', hint: 'Topographic lines through the picture\'s brightness.', icon: 'loop' },
  { kind: 'lens', label: 'Lens', hint: 'A circle that magnifies, pixelates, blurs or inverts what is under it.', icon: 'search' },
  { kind: 'camera', label: 'Camera', hint: 'Your webcam: as a layer, a mask, or what particles read. Its motion is a source.', icon: 'camera' },
];
const KIND = Object.fromEntries(KINDS.map(k => [k.kind, k])) as Record<PlayLayerKind, (typeof KINDS)[number]>;

export function LayersPanel({ play, touch, exposedTargets, onChange, onExpose }: {
  play: PlayRecord;
  touch: boolean;
  /** Targets that already have a control (their + is shown pressed). */
  exposedTargets: Set<string>;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** Add a control for a numeric layer property. */
  onExpose: (control: PlayControl) => void;
}) {
  const tk = useTokens();
  const addRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState('');
  const [drawing, setDrawing] = useState<ShapeDrawing | null>(null);
  useEffect(() => { playOverlay.setEditing(true, selected); }, [selected]);
  useEffect(() => () => { playOverlay.setEditing(false); playOverlay.cancelDrawing(); }, []);
  useEffect(() => playOverlay.onDrawing(d => setDrawing(d ? { ...d } : null)), []);

  const add = (kind: PlayLayerKind) => {
    const n = play.layers.filter(l => l.kind === kind).length + 1;
    const id = playId('layer');
    onChange(p => ({ ...p, layers: [...p.layers, defaultLayer(kind, id, `${KIND[kind].label} ${n}`)] }));
    setSelected(id);
  };
  const patch = (id: string, fn: (l: PlayLayer) => PlayLayer) => onChange(p => ({ ...p, layers: p.layers.map(l => l.id === id ? fn(l) : l) }));
  const remove = (id: string) => onChange(p => {
    const controls = p.controls.filter(c => !c.target.startsWith(`layer:${id}::`));
    const ids = new Set(controls.map(c => c.id));
    const out: PlayRecord = {
      ...p,
      layers: p.layers.filter(l => l.id !== id),
      controls,
      mappings: p.mappings.filter(m => ids.has(m.controlId)
        && !((m.source.kind === 'null' || m.source.kind === 'sensor') && m.source.layerId === id)
        && !(m.source.kind === 'trigger' && m.source.trigger.on === 'zone' && m.source.trigger.layerId === id)),
    };
    const actions = (p.actions ?? []).filter(a => a.layerId !== id && !(a.trigger.on === 'zone' && a.trigger.layerId === id));
    if (actions.length) out.actions = actions; else delete out.actions;
    return out;
  });
  const move = (id: string, dir: -1 | 1) => onChange(p => {
    const i = p.layers.findIndex(l => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= p.layers.length) return p;
    const layers = [...p.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    return { ...p, layers };
  });
  const expose = (l: PlayLayer, key: string) => {
    const def = LAYER_NUMERIC_PROPS[l.kind].find(d => d.key === key);
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
          <Button size="sm" icon="plus" onClick={() => { const r = addRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 280, y: r.bottom + 6 } : null); }}>Add layer</Button>
        </span>
        {menu && <Menu x={menu.x} y={menu.y} minWidth={280} onClose={() => setMenu(null)} items={KINDS.map(k => ({ label: k.label, hint: k.hint, onSelect: () => add(k.kind) }))} />}
      </div>
      <div style={{ flex: 1, minHeight: play.notes ? 110 : 0, overflowY: 'auto', padding: '6px 12px 12px' }}>
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
            index={i}
            count={play.layers.length}
            touch={touch}
            selected={selected === l.id}
            pictureHidden={play.display?.picture === false}
            drawing={drawing?.layerId === l.id ? drawing.mode : null}
            exposedTargets={exposedTargets}
            onSelect={() => setSelected(l.id)}
            onPatch={fn => patch(l.id, fn)}
            onRemove={() => remove(l.id)}
            onMove={dir => move(l.id, dir)}
            onExpose={key => expose(l, key)}
          />
        ))}
        <ActionsSection play={play} onChange={onChange} />
      </div>
    </>
  );
}

function LayerRow({ layer: l, layers, index, count, touch, selected, pictureHidden, drawing, exposedTargets, onSelect, onPatch, onRemove, onMove, onExpose }: {
  layer: PlayLayer;
  layers: PlayLayer[];
  index: number;
  count: number;
  touch: boolean;
  selected: boolean;
  pictureHidden: boolean;
  drawing: 'polygon' | 'lasso' | null;
  exposedTargets: Set<string>;
  onSelect: () => void;
  onPatch: (fn: (l: PlayLayer) => PlayLayer) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onExpose: (key: string) => void;
}) {
  const tk = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(l.label);
  const [open, setOpen] = useState(true);
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== l.label) onPatch(x => ({ ...x, label: t })); else setDraft(l.label); };
  const set = (p: Record<string, unknown>) => onPatch(x => ({ ...x, ...p } as PlayLayer));
  const f = makeFieldKit({ l, tk, touch, exposedTargets, set, onExpose });
  const ctx: EditorContext = {
    layers,
    act: (kind, amount = 1) => playOverlay.act({ do: kind, layerId: l.id, amount }),
    drawing,
    startDrawing: mode => { onSelect(); playOverlay.startDrawing(l.id, mode); },
    cancelDrawing: () => playOverlay.cancelDrawing(),
  };
  let body: ReactNode = null;
  switch (l.kind) {
    case 'null': body = <NullEditor f={f} ctx={ctx} />; break;
    case 'text': body = <TextEditor f={f} ctx={ctx} pictureHidden={pictureHidden} />; break;
    case 'image': body = <ImageEditor f={f} pictureHidden={pictureHidden} />; break;
    case 'camera': body = <CameraEditor f={f} pictureHidden={pictureHidden} />; break;
    case 'particles': body = <ParticlesEditor f={f} ctx={ctx} />; break;
    case 'shape': body = <ShapeEditor f={f} ctx={ctx} />; break;
    case 'audio': body = <AudioEditor f={f} />; break;
    case 'glyphs': body = <GlyphsEditor f={f} />; break;
    case 'contours': body = <ContoursEditor f={f} />; break;
    case 'lens': body = <LensEditor f={f} ctx={ctx} />; break;
    case 'brush': body = <BrushEditor f={f} ctx={ctx} />; break;
    case 'bodies': body = <BodiesEditor f={f} ctx={ctx} />; break;
  }

  return (
    <div
      onPointerDownCapture={onSelect}
      style={{ padding: '8px 10px 10px', marginTop: 6, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 ${selected ? 1.5 : 1}px ${selected ? tk.accent.base : tk.border.default}`, opacity: l.visible ? 1 : 0.6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Collapse layer' : 'Expand layer'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />
        <Tooltip label={KIND[l.kind].label} description={KIND[l.kind].hint}><Icon name={KIND[l.kind].icon} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} /></Tooltip>
        {editing ? (
          <Field autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(l.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
        ) : (
          <button type="button" title="Rename" onClick={() => { setDraft(l.label); setEditing(true); }} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'text', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</button>
        )}
        <Toggle checked={l.visible} onChange={visible => set({ visible })} />
        <IconButton icon="chevU" label="Move up (drawn earlier)" size="sm" disabled={index === 0} tooltip={false} onClick={() => onMove(-1)} />
        <IconButton icon="chevD" label="Move down (drawn later, on top)" size="sm" disabled={index === count - 1} tooltip={false} onClick={() => onMove(1)} />
        <IconButton icon="trash" label="Remove layer" size="sm" tone="danger" tooltip={false} onClick={onRemove} />
      </div>
      {open && (
        <>
          {body}
          {l.kind !== 'null' && f.toggle('Shader', 'toShader', 'Seen by the Layers node', 'Include this layer in what the graph\'s Layers node reads (its colour, alpha and distance), so shader effects like SDF Glow can use it.')}
        </>
      )}
    </div>
  );
}
