/**
 * LayersPanel — the Play page's third section: things drawn over the picture
 * in JavaScript (see play/overlay.ts). Add a null, text, image or particles
 * layer, edit it here, and press the small + next to any numeric property to
 * make it a control (target `layer:<id>::<key>`), after which it can be
 * mapped and driven like a slider.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import {
  LAYER_NUMERIC_PROPS, defaultLayer, layerTarget,
  type BlendMode, type ImageLayer, type MatteMode, type NullLayer, type PlayControl, type PlayLayer, type PlayLayerKind, type PlayRecord, type TextLayer,
} from '../../types/play';
import { playId } from '../../play/playControls';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { Select } from '../ui/Select';
import { RulerSlider } from '../ui/RulerSlider';
import { NumberInput } from '../NodeGraph/NumberInput';

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }, { value: 'overlay', label: 'Overlay' },
  { value: 'lighten', label: 'Lighten' }, { value: 'darken', label: 'Darken' }, { value: 'difference', label: 'Difference' }, { value: 'exclusion', label: 'Exclusion' }, { value: 'add', label: 'Add' },
];
const MATTES: { value: MatteMode; label: string; title: string }[] = [
  { value: 'over', label: 'Over', title: 'Drawn over the picture with the blend mode' },
  { value: 'reveal', label: 'Reveal', title: 'The picture shows only inside the shape; the colour fills the rest' },
  { value: 'luma', label: 'Luma', title: 'The picture\'s brightness is the layer\'s alpha: it shows where the picture is bright' },
];
const KINDS: { kind: PlayLayerKind; label: string; hint: string }[] = [
  { kind: 'null', label: 'Null', hint: 'A draggable point. Its X and Y are sources.' },
  { kind: 'text', label: 'Text', hint: 'Words over the picture, or the picture inside the words.' },
  { kind: 'image', label: 'Image', hint: 'A picture of your own, blended or matted.' },
  { kind: 'particles', label: 'Particles', hint: 'Dots that read the picture\'s brightness and flow along it.' },
];

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

  const add = (kind: PlayLayerKind) => {
    const n = play.layers.filter(l => l.kind === kind).length + 1;
    const label = `${KINDS.find(k => k.kind === kind)!.label} ${n}`;
    onChange(p => ({ ...p, layers: [...p.layers, defaultLayer(kind, playId('layer'), label)] }));
  };
  const patch = (id: string, fn: (l: PlayLayer) => PlayLayer) => onChange(p => ({ ...p, layers: p.layers.map(l => l.id === id ? fn(l) : l) }));
  const remove = (id: string) => onChange(p => ({
    ...p,
    layers: p.layers.filter(l => l.id !== id),
    controls: p.controls.filter(c => !c.target.startsWith(`layer:${id}::`)),
    mappings: p.mappings.filter(m => !(m.source.kind === 'null' && m.source.layerId === id) && p.controls.some(c => c.id === m.controlId && !c.target.startsWith(`layer:${id}::`))),
  }));
  const move = (id: string, dir: -1 | 1) => onChange(p => {
    const i = p.layers.findIndex(l => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.layers.length) return p;
    const layers = [...p.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    return { ...p, layers };
  });
  const expose = (l: PlayLayer, key: string) => {
    const def = LAYER_NUMERIC_PROPS[l.kind].find(pdef => pdef.key === key);
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
          <Button size="sm" icon="plus" onClick={() => { const r = addRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 230, y: r.bottom + 6 } : null); }}>Add layer</Button>
        </span>
        {menu && (
          <Menu x={menu.x} y={menu.y} minWidth={230} onClose={() => setMenu(null)} items={KINDS.map(k => ({ label: k.label, hint: k.hint, onSelect: () => add(k.kind) }))} />
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 12px 12px' }}>
        {play.layers.length === 0 ? (
          <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
            <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>No layers yet</div>
            Layers sit on top of the picture. A null is a point you can drag or animate and map onto anything. Text and images can blend with the picture or be matted by it. Particles read its brightness and flow.
          </div>
        ) : play.layers.map((l, i) => (
          <LayerRow
            key={l.id}
            layer={l}
            index={i}
            count={play.layers.length}
            touch={touch}
            exposedTargets={exposedTargets}
            onPatch={fn => patch(l.id, fn)}
            onRemove={() => remove(l.id)}
            onMove={dir => move(l.id, dir)}
            onExpose={key => expose(l, key)}
          />
        ))}
      </div>
    </>
  );
}

function LayerRow({ layer: l, index, count, touch, exposedTargets, onPatch, onRemove, onMove, onExpose }: {
  layer: PlayLayer;
  index: number;
  count: number;
  touch: boolean;
  exposedTargets: Set<string>;
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
  const set = (p: Partial<PlayLayer>) => onPatch(x => ({ ...x, ...p } as PlayLayer));
  const numStyle = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  const labelStyle = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const, width: 62, flexShrink: 0 };
  const kindIcon = l.kind === 'null' ? 'grip' : l.kind === 'text' ? 'edit' : l.kind === 'image' ? 'camera' : 'spark';

  /** A numeric property row: ruler + the "make it a control" button. */
  const prop = (key: string) => {
    const def = LAYER_NUMERIC_PROPS[l.kind].find(d => d.key === key)!;
    const value = (l as unknown as Record<string, number>)[key];
    const exposed = exposedTargets.has(layerTarget(l.id, key));
    return (
      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={labelStyle}>{def.label}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RulerSlider value={value} min={def.min} max={def.max} step={def.step ?? 0.01} defaultValue={value} onChange={v => set({ [key]: v } as Partial<PlayLayer>)} onType={v => set({ [key]: v } as Partial<PlayLayer>)} ariaLabel={`${l.label} ${def.label}`} touch={touch} />
        </div>
        <IconButton icon={exposed ? 'check' : 'plus'} label={exposed ? 'Already a control' : `Make ${def.label} a control (then map anything onto it)`} size="sm" active={exposed} disabled={exposed} onClick={() => onExpose(key)} />
      </div>
    );
  };
  const row = (label: string, children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
  const colourRow = (label: string, value: [number, number, number], onColour: (c: [number, number, number]) => void) => {
    const hex = `#${value.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
    return row(label, (
      <label style={{ position: 'relative', width: 44, height: 26, borderRadius: radius.md, background: hex, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}`, cursor: 'pointer' }}>
        <input type="color" aria-label={`${l.label} ${label}`} value={hex} onChange={e => { const h = e.target.value; onColour([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]); }} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </label>
    ));
  };
  const blendMatte = (x: TextLayer | ImageLayer) => (
    <>
      {row('Matte', <Segmented size="sm" ariaLabel="Matte" value={x.matte} options={MATTES.map(m => ({ value: m.value, label: m.label, title: m.title }))} onChange={v => set({ matte: v })} />)}
      {x.matte === 'over' && row('Blend', <Select ariaLabel="Blend mode" value={x.blend} options={BLENDS} onChange={v => set({ blend: v as BlendMode })} height={26} />)}
      {colourRow(x.matte === 'over' && x.kind === 'text' ? 'Colour' : x.matte === 'reveal' ? 'Backdrop' : 'Colour', x.color, c => set({ color: c }))}
    </>
  );

  return (
    <div style={{ padding: '8px 10px 10px', marginTop: 6, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, opacity: l.visible ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Collapse layer' : 'Expand layer'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />
        <Icon name={kindIcon} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
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
          {l.kind === 'null' && <NullFields l={l} prop={prop} row={row} set={set} />}
          {l.kind === 'text' && (
            <>
              {row('Text', <Field value={l.text} onChange={e => set({ text: e.target.value })} height={26} style={{ flex: 1, minWidth: 0 }} placeholder="Type something" />)}
              {row('Font', (
                <>
                  <Segmented size="sm" ariaLabel="Font" value={l.font} options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]} onChange={v => set({ font: v })} />
                  <Toggle checked={l.weight >= 600} onChange={b => set({ weight: b ? 700 : 400 })} label="Bold" />
                </>
              ))}
              {['x', 'y', 'size', 'rotation', 'opacity'].map(prop)}
              {blendMatte(l)}
            </>
          )}
          {l.kind === 'image' && (
            <>
              {row('Image', <ImagePicker l={l} onPick={src => set({ src })} />)}
              {['x', 'y', 'scale', 'rotation', 'opacity'].map(prop)}
              {blendMatte(l)}
            </>
          )}
          {l.kind === 'particles' && (
            <>
              {row('Count', <NumberInput value={l.count} min={1} max={5000} step={50} title="How many particles" onCommit={n => set({ count: Math.max(1, Math.min(5000, Math.round(n))) })} style={numStyle} />)}
              {row('Steer', <Segmented size="sm" ariaLabel="Steering" value={l.mode} options={[{ value: 'flow', label: 'Flow', title: 'Brightness is the heading' }, { value: 'climb', label: 'Climb', title: 'Toward brighter' }, { value: 'descend', label: 'Descend', title: 'Toward darker' }]} onChange={v => set({ mode: v })} />)}
              {['speed', 'size', 'opacity', 'turns', 'trail'].map(prop)}
              {row('Colour', <Toggle checked={l.colorFromPicture} onChange={colorFromPicture => set({ colorFromPicture })} label="From the picture" />)}
              {!l.colorFromPicture && colourRow('Tint', l.color, c => set({ color: c }))}
              {row('Blend', <Select ariaLabel="Blend mode" value={l.blend} options={BLENDS} onChange={v => set({ blend: v as BlendMode })} height={26} />)}
            </>
          )}
        </>
      )}
    </div>
  );
}

function NullFields({ l, prop, row, set }: { l: NullLayer; prop: (key: string) => ReactNode; row: (label: string, children: ReactNode) => ReactNode; set: (p: Partial<PlayLayer>) => void }) {
  const tk = useTokens();
  return (
    <>
      {['x', 'y', 'size'].map(prop)}
      {row('Marker', (
        <>
          <label style={{ position: 'relative', width: 44, height: 26, borderRadius: radius.md, background: l.color, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}`, cursor: 'pointer' }}>
            <input type="color" aria-label={`${l.label} marker colour`} value={l.color} onChange={e => set({ color: e.target.value } as Partial<PlayLayer>)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
          </label>
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Drag the marker on the picture. Map its X and Y from the mappings drawer (source: Null position).</span>
        </>
      ))}
    </>
  );
}

const MAX_IMAGE_SIDE = 1024;

/** Picks an image file and stores it as a data URL, downscaled so play files stay small. */
function ImagePicker({ l, onPick }: { l: ImageLayer; onPick: (src: string) => void }) {
  const tk = useTokens();
  const inputRef = useRef<HTMLInputElement>(null);
  const load = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      onPick(c.toDataURL(file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg', 0.9));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
      {l.src && <img src={l.src} alt="" style={{ width: 44, height: 26, objectFit: 'cover', borderRadius: 6, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}` }} />}
      <Button size="sm" icon="import" onClick={() => inputRef.current?.click()}>{l.src ? 'Replace' : 'Choose image'}</Button>
      {!l.src && <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>PNG with transparency works best for mattes</span>}
    </>
  );
}
