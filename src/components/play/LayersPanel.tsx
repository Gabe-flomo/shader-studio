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
  type BlendMode, type ImageLayer, type MatteMode, type NullLayer, type ParticleField, type ParticleModulator, type ParticlesLayer,
  type PlayControl, type PlayLayer, type PlayLayerKind, type PlayRecord, type TextLayer,
} from '../../types/play';
import { PARTICLE_PALETTES, paletteColour } from '../../play/particle-sim.js';
import { playId } from '../../play/playControls';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { Select } from '../ui/Select';
import { RulerSlider } from '../ui/RulerSlider';
import { NumberInput } from '../NodeGraph/NumberInput';
import { Tooltip } from '../ui/Tooltip';

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
  { kind: 'particles', label: 'Particles', hint: 'A particle system: flow along the picture or a noise field, pulled by the mouse or a null.' },
];

/** What each field does, shown under the Field picker. */
const FIELD_HELP: Record<ParticleField, { label: string; title: string; body: string }> = {
  flow: { label: 'Flow', title: 'Brightness is a direction', body: 'Each particle reads the brightness under it and turns it into a heading: black points right, and the heading rotates as the picture gets brighter (Turns = full rotations from black to white). Particles stream along the picture\'s contours.' },
  climb: { label: 'Climb', title: 'Uphill, toward light', body: 'Particles move toward brighter parts of the picture and collect on highlights and bright edges. On flat areas there is no uphill: see “On flat areas”.' },
  descend: { label: 'Descend', title: 'Downhill, toward dark', body: 'Particles move toward darker parts and pool in shadows and dark lines. On flat areas there is no downhill: see “On flat areas”.' },
  noise: { label: 'Noise', title: 'A drifting noise field', body: 'An evolving flow field that ignores the picture: smooth swirling lanes. Swirl size sets how busy it is; Evolve how fast it changes.' },
  none: { label: 'None', title: 'Only the attractor', body: 'No field. Particles coast and slow down unless an attractor pulls them.' },
};

const MODULATORS: { value: ParticleModulator; label: string }[] = [
  { value: 'none', label: 'Nothing' }, { value: 'brightness', label: 'Picture brightness' }, { value: 'speed', label: 'Speed' },
  { value: 'age', label: 'Age' }, { value: 'null', label: 'Nearness to a null' },
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
            Layers sit on top of the picture. A null is a point you can drag or animate and map onto anything. Text and images can blend with the picture or be matted by it. Particles flow along it, swarm a null or the mouse, and can mask it.
          </div>
        ) : play.layers.map((l, i) => (
          <LayerRow
            key={l.id}
            layer={l}
            nulls={play.layers.filter((x): x is NullLayer => x.kind === 'null')}
            pictureHidden={play.display?.picture === false}
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

function LayerRow({ layer: l, nulls, pictureHidden, index, count, touch, exposedTargets, onPatch, onRemove, onMove, onExpose }: {
  layer: PlayLayer;
  /** The record's null layers (particles can follow one). */
  nulls: NullLayer[];
  /** Picture → Layers only: a Reveal matte then paints the picture into the shape over the page backdrop. */
  pictureHidden: boolean;
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
        <Tooltip label={def.label} description={def.hint} placement="top"><span style={{ ...labelStyle, display: 'inline-block', cursor: 'help' }}>{def.label}</span></Tooltip>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RulerSlider value={value} min={def.min} max={def.max} step={def.step ?? 0.01} defaultValue={value} onChange={v => set({ [key]: v } as Partial<PlayLayer>)} onType={v => set({ [key]: v } as Partial<PlayLayer>)} ariaLabel={`${l.label} ${def.label}`} touch={touch} />
        </div>
        <IconButton icon={exposed ? 'check' : 'plus'} label={exposed ? 'Already a control' : `Make ${def.label} a control (then map anything onto it)`} size="sm" active={exposed} disabled={exposed} onClick={() => onExpose(key)} />
      </div>
    );
  };
  const row = (label: string, children: ReactNode, hint?: string) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      {hint
        ? <Tooltip label={label} description={hint} placement="top"><span style={{ ...labelStyle, display: 'inline-block', cursor: 'help' }}>{label}</span></Tooltip>
        : <span style={labelStyle}>{label}</span>}
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
      {row('Matte', <Segmented size="sm" ariaLabel="Matte" value={x.matte} options={MATTES.map(m => ({ value: m.value, label: m.label, title: m.title }))} onChange={v => set({ matte: v })} />,
        'Over: drawn on top with a blend mode. Reveal: the picture shows only inside the shape. Luma: the picture\'s brightness sets the layer\'s transparency.')}
      {x.matte === 'over' && row('Blend', <Select ariaLabel="Blend mode" value={x.blend} options={BLENDS} onChange={v => set({ blend: v as BlendMode })} height={26} />, 'How the layer\'s colours mix with the picture under it.')}
      {!(x.matte === 'reveal' && pictureHidden) && colourRow(x.matte === 'over' && x.kind === 'text' ? 'Colour' : x.matte === 'reveal' ? 'Backdrop' : 'Colour', x.color, c => set({ color: c }))}
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
          {l.kind === 'particles' && <ParticleFields l={l} nulls={nulls} prop={prop} row={row} colourRow={colourRow} set={set} numStyle={numStyle} />}
        </>
      )}
    </div>
  );
}

type RowFn = (label: string, children: ReactNode, hint?: string) => ReactNode;

function Section({ title }: { title: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 2px' }}>
      <span style={{ color: tk.text.secondary, font: `650 11px ${fontFamily.ui}` }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: tk.border.default }} />
    </div>
  );
}

/** The particle system's settings, in the order you'd reach for them: motion, attractor, birth and death, look. */
function ParticleFields({ l, nulls, prop, row, colourRow, set, numStyle }: {
  l: ParticlesLayer;
  nulls: NullLayer[];
  prop: (key: string) => ReactNode;
  row: RowFn;
  colourRow: (label: string, value: [number, number, number], onColour: (c: [number, number, number]) => void) => ReactNode;
  set: (p: Partial<PlayLayer>) => void;
  numStyle: React.CSSProperties;
}) {
  const tk = useTokens();
  const help = FIELD_HELP[l.field];
  const picture = l.field === 'flow' || l.field === 'climb' || l.field === 'descend';
  const usesNull = l.attractor === 'null' || l.spawn === 'null' || l.sizeBy === 'null' || l.opacityBy === 'null';
  const note = (text: ReactNode) => <div style={{ margin: '6px 0 0 68px', color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{text}</div>;
  const nullOptions = [{ value: '', label: nulls.length ? 'Pick a null' : 'No nulls yet' }, ...nulls.map(n => ({ value: n.id, label: n.label }))];
  const swatch = (i: number) => `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(t => `rgb(${paletteColour(i, t).map(v => Math.round(v * 255)).join(',')})`).join(',')})`;
  return (
    <>
      {row('Count', <NumberInput value={l.count} min={1} max={5000} step={50} title="How many particles (up to 5000)" onCommit={n => set({ count: Math.max(1, Math.min(5000, Math.round(n))) })} style={numStyle} />, 'How many particles. Thousands are fine; very large sizes or trails cost more.')}

      <Section title="Motion" />
      {row('Field', <Segmented size="sm" ariaLabel="Field" value={l.field} options={(Object.keys(FIELD_HELP) as ParticleField[]).map(f => ({ value: f, label: FIELD_HELP[f].label, title: FIELD_HELP[f].title }))} onChange={v => set({ field: v })} />,
        'Where each particle wants to go. Flow, Climb and Descend read the picture; Noise is its own drifting field; None leaves it to the attractor.')}
      {note(<><b style={{ color: tk.text.secondary }}>{help.title}.</b> {help.body}</>)}
      {(l.field === 'climb' || l.field === 'descend') && row('On flat areas', <Segmented size="sm" ariaLabel="On flat areas" value={l.flat} options={[
        { value: 'wander', label: 'Wander', title: 'Keep moving on the noise field until they find a slope' },
        { value: 'settle', label: 'Settle', title: 'Slow down and stop: they freeze into patterns along edges' },
      ]} onChange={v => set({ flat: v })} />, 'Flat parts of the picture have no uphill or downhill. Wander keeps particles drifting on the noise field; Settle lets them slow down and collect, which freezes them into the patterns along edges.')}
      {['speed', 'steer'].map(prop)}
      {l.field === 'flow' && prop('turns')}
      {(l.field === 'noise' || ((l.field === 'climb' || l.field === 'descend') && l.flat === 'wander')) && ['noiseScale', 'noiseEvolve'].map(prop)}

      <Section title="Attractor" />
      {row('Pulled by', <Segmented size="sm" ariaLabel="Attractor" value={l.attractor} options={[
        { value: 'none', label: 'Nothing' }, { value: 'mouse', label: 'Mouse', title: 'The pointer while it is over the picture' }, { value: 'null', label: 'Null', title: 'A null layer (drag it, or drive its X/Y)' },
      ]} onChange={v => set({ attractor: v })} />, 'A point that pulls particles in (on top of the field). Mouse works while the pointer is over the picture; a null can be dragged or animated.')}
      {l.attractor !== 'none' && (
        <>
          {row('Force', <Segmented size="sm" ariaLabel="Force" value={l.force} options={[
            { value: 'gravitate', label: 'Gravitate', title: 'Pull straight in' }, { value: 'spiral', label: 'Spiral', title: 'Pull in while orbiting' }, { value: 'repel', label: 'Repel', title: 'Push away' },
          ]} onChange={v => set({ force: v })} />, 'Gravitate pulls straight in; Spiral pulls in while orbiting; Repel pushes particles away.')}
          {['strength', ...(l.force !== 'repel' ? ['catchRadius'] : [])].map(prop)}
        </>
      )}

      <Section title="Birth and death" />
      {row('Born', <Segmented size="sm" ariaLabel="Spawn" value={l.spawn} options={[
        { value: 'anywhere', label: 'Anywhere' }, { value: 'edges', label: 'Edges' }, { value: 'center', label: 'Centre' }, { value: 'null', label: 'At a null' },
      ]} onChange={v => set({ spawn: v })} />, 'Where new and respawned particles appear.')}
      {(l.spawn === 'center' || l.spawn === 'null') && prop('spawnRadius')}
      {row('At the edges', <Segmented size="sm" ariaLabel="Edges" value={l.edges} options={[
        { value: 'wrap', label: 'Wrap', title: 'Leave one side, come back on the other' }, { value: 'bounce', label: 'Bounce', title: 'Bounce off the edges' }, { value: 'respawn', label: 'Respawn', title: 'Start again where particles are born' },
      ]} onChange={v => set({ edges: v })} />, 'What happens when a particle leaves the picture: wrap round, bounce back, or respawn where particles are born.')}
      {prop('life')}

      <Section title="Look" />
      {row('Shape', <Select ariaLabel="Shape" value={l.shape} height={26} options={[
        { value: 'dot', label: 'Dot' }, { value: 'square', label: 'Square' }, { value: 'triangle', label: 'Triangle' }, { value: 'streak', label: 'Streak' },
        { value: 'ring', label: 'Ring' }, { value: 'star', label: 'Star' }, { value: 'image', label: 'Image / SVG' },
      ]} onChange={v => set({ shape: v as ParticlesLayer['shape'] })} />, 'What each particle looks like. Streaks stretch along their motion; Image uses a picture or SVG of your own.')}
      {l.shape === 'image' && row('Sprite', <SpritePicker l={l} onPick={sprite => set({ sprite })} onCrop={crop => set({ crop })} />, 'A PNG, JPG or SVG drawn for every particle. Size scales it; Square crop trims it to its centre square.')}
      {l.shape !== 'dot' && row('Rotate', <Segmented size="sm" ariaLabel="Rotate" value={l.rotate} options={[
        { value: 'heading', label: 'Face motion' }, { value: 'spin', label: 'Spin' }, { value: 'none', label: 'Upright' },
      ]} onChange={v => set({ rotate: v })} />, 'Face motion points each particle where it is going; Spin turns them steadily; Upright keeps them still.')}
      {['size', 'sizeJitter'].map(prop)}
      {row('Size follows', <Select ariaLabel="Size follows" value={l.sizeBy} height={26} options={MODULATORS} onChange={v => set({ sizeBy: v as ParticleModulator })} />,
        'Make size depend on something: the picture\'s brightness under the particle, how fast it moves, how old it is, or how near it is to a null (e.g. particles grow near the null).')}
      {l.sizeBy !== 'none' && prop('sizeAmount')}
      {row('Opacity follows', <Select ariaLabel="Opacity follows" value={l.opacityBy} height={26} options={MODULATORS} onChange={v => set({ opacityBy: v as ParticleModulator })} />,
        'Make opacity depend on something. Age with a negative amount fades particles out as they get old.')}
      {l.opacityBy !== 'none' && prop('opacityAmount')}
      {usesNull && (
        <>
          {row('Null', <Select ariaLabel="Null" value={l.nullId} height={26} options={nullOptions} onChange={v => set({ nullId: v })} />, 'The null the attractor, the spawn point and “nearness to a null” use. Add one with Add layer → Null.')}
          {(l.sizeBy === 'null' || l.opacityBy === 'null') && prop('falloff')}
          {!l.nullId && note('Pick a null (or add one with Add layer → Null).')}
        </>
      )}
      {l.shape !== 'image' && row('Colour', <Segmented size="sm" ariaLabel="Colour" value={l.colour} options={[
        { value: 'tint', label: 'Tint', title: 'One colour' }, { value: 'picture', label: 'Picture', title: 'The colour of the picture under each particle' }, { value: 'palette', label: 'Palette', title: 'A cosine gradient' },
      ]} onChange={v => set({ colour: v })} />, 'Tint paints every particle one colour; Picture takes the colour under each one; Palette picks from a gradient by heading, speed, age or brightness.')}
      {l.shape !== 'image' && l.colour === 'tint' && colourRow('Tint', l.color, c => set({ color: c }))}
      {l.shape !== 'image' && l.colour === 'palette' && (
        <>
          {row('Palette', (
            <>
              <Select ariaLabel="Palette" value={String(l.palette)} height={26} options={PARTICLE_PALETTES.map((pl, i) => ({ value: String(i), label: pl.name }))} onChange={v => set({ palette: Number(v) })} />
              <span style={{ width: 64, height: 14, borderRadius: 4, background: swatch(l.palette), boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}` }} />
            </>
          ), 'Cosine palettes: colour = a + b·cos(2π(c·t + d)).')}
          {row('Pick by', <Segmented size="sm" ariaLabel="Palette by" value={l.paletteBy} options={[
            { value: 'heading', label: 'Heading' }, { value: 'speed', label: 'Speed' }, { value: 'age', label: 'Age' }, { value: 'brightness', label: 'Brightness' },
          ]} onChange={v => set({ paletteBy: v })} />, 'What chooses each particle\'s place on the gradient.')}
        </>
      )}
      {['opacity', 'trail'].map(prop)}
      {row('Blend', <Select ariaLabel="Blend mode" value={l.blend} options={BLENDS} onChange={v => set({ blend: v as BlendMode })} height={26} />, 'How the particles mix with what is under them. Screen and Add glow.')}
      {row('Mask', <Toggle checked={l.reveal} onChange={reveal => set({ reveal })} label="Picture through particles" />,
        'The particles become a mask: each one shows the picture under it instead of a colour. Hide the picture (Picture → Layers only) to see the shader only where particles are.')}
      {!picture && l.colour === 'picture' && note('Picture colour still reads the picture, even when the field ignores it.')}
    </>
  );
}

const MAX_SPRITE_SIDE = 256;

/** A particle sprite: PNG, JPG or SVG, rasterised to at most 256 px so play files stay small. */
function SpritePicker({ l, onPick, onCrop }: { l: ParticlesLayer; onPick: (src: string) => void; onCrop: (crop: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const load = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // SVGs without a size report 0 (or 150): draw them at the sprite size.
      const w0 = img.naturalWidth || MAX_SPRITE_SIDE, h0 = img.naturalHeight || MAX_SPRITE_SIDE;
      const k = file.type === 'image/svg+xml' ? MAX_SPRITE_SIDE / Math.max(w0, h0) : Math.min(1, MAX_SPRITE_SIDE / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      onPick(c.toDataURL('image/png'));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };
  return (
    <>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
      {l.sprite && <img src={l.sprite} alt="" style={{ width: 26, height: 26, objectFit: l.crop ? 'cover' : 'contain', borderRadius: 6, background: 'repeating-conic-gradient(#8884 0 25%, transparent 0 50%) 0 0 / 8px 8px' }} />}
      <Button size="sm" icon="import" onClick={() => inputRef.current?.click()}>{l.sprite ? 'Replace' : 'Upload PNG / SVG'}</Button>
      {l.sprite && <Toggle checked={l.crop} onChange={onCrop} label="Square crop" />}
    </>
  );
}

function NullFields({ l, prop, row, set }: { l: NullLayer; prop: (key: string) => ReactNode; row: RowFn; set: (p: Partial<PlayLayer>) => void }) {
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
