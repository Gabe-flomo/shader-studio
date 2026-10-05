/**
 * MatteMask.tsx — the Matte and Mask buttons on every layer card (except
 * nulls and the Background layer), and the layer's list of masks.
 *
 * Matte: another layer this one shows through, by its alpha or its
 * brightness (luma), optionally inverted; or a new Shape layer made for it.
 * Mask: rectangles, ellipses and outlines drawn on the picture that belong to
 * this layer. The open mask is the one with handles on the picture.
 * Displace: After Effects' Displacement Map on this layer's own pixels, by
 * another layer (hidden or not) or the picture (play/kit/displace.js).
 * The record edits are in play/mattes.ts; the kit draws them (kit/mattes.js).
 */
import { useRef, useState, type ReactNode } from 'react';
import { fontFamily, radius } from '../../../theme/tokens';
import { layerNumericProps, type LayerMask, type MaskOp, type PlayLayer, type PlayRecord } from '../../../types/play';
import { canBeMatte, canHaveMatte, maskKey, maskLabel, matteCandidates, MASKS_MAX, type LayerDisplace, type MaskProp } from '../../../types/playLayers';
import { addDisplace, addMask, addMatteMotion, addMatteShape, matteSummary, moveMask, patchDisplace, patchMask, patchTrackMatte, removeDisplace, removeMask, setTrackMatte } from '../../../play/mattes';
import { DM_BEHAVIOURS, DM_BEHAVIOUR_LABELS, DM_CHANNELS, DM_CHANNEL_LABELS, DM_HINTS, DM_QUALITIES, DM_QUALITY_LABELS } from '../../../play/kit/displace.js';
import { playOverlay } from '../../../play/overlay';
import { Button, IconButton } from '../../ui/Button';
import { Segmented, Toggle } from '../../ui/Choice';
import { Icon } from '../../ui/Icon';
import { rowField } from '../../ui/rowLayout';
import { Menu } from '../../ui/Menu';
import { Popover } from '../../ui/Popover';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { toast } from '../../ui/toastStore';
import { BUILTIN_LAYER } from './addLayerCatalog';
import { usePlayUi } from '../playUi';
import type { FieldKit } from './fields';

const SHAPE_NAMES: Record<LayerMask['shape'], string> = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Outline' };
const OP_NAMES: Record<MaskOp, string> = { add: 'Add', subtract: 'Subtract', intersect: 'Intersect' };

/** The Matte and Mask buttons, the drawing hint while a mask is being drawn, and the layer's masks. */
export function MatteMaskBar({ f, play, changePlay, drawing, onSelect }: {
  f: FieldKit;
  play: PlayRecord;
  changePlay: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** A mask outline is being drawn on the picture for this layer. */
  drawing: 'polygon' | 'lasso' | null;
  onSelect: () => void;
}) {
  const { l, tk } = f;
  const matteRef = useRef<HTMLSpanElement>(null);
  const maskRef = useRef<HTMLSpanElement>(null);
  const [matteOpen, setMatteOpen] = useState(false);
  const [maskMenu, setMaskMenu] = useState<{ x: number; y: number } | null>(null);
  const setMask = usePlayUi(s => s.setMask);
  if (!canHaveMatte(l.kind)) return null;
  const matte = l.trackMatte ? play.layers.find(x => x.id === l.trackMatte!.id) : undefined;
  const masks = l.masks ?? [];
  const full = masks.length >= MASKS_MAX;

  const addBoxMask = (shape: 'rect' | 'ellipse') => {
    // Most of the layer's own box, so the cut shows straight away; the middle of the picture for layers without one.
    const b = playOverlay.bounds(l);
    const aspect = playOverlay.pictureAspect();
    const place = b ? { x: 0, y: 0, w: b.w * 0.7, h: b.h * 0.7 } : { x: 0, y: 0, w: Math.min(aspect, 1.6) * 0.5, h: 0.55 };
    let made = '';
    changePlay(p => { const r = addMask(p, l.id, shape, place); made = r.maskId; return r.play; });
    onSelect();
    if (made) setMask(made);
  };
  const drawMask = (mode: 'polygon' | 'lasso') => { onSelect(); setMask(''); playOverlay.startDrawing(l.id, mode, true); };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <span ref={matteRef} style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}>
          <Button
            size="sm"
            icon="link"
            aria-expanded={matteOpen}
            title={matte ? `Matte: ${matteSummary(play, l)}` : 'Show this layer only where another layer is'}
            onClick={() => setMatteOpen(o => !o)}
            style={{ height: 26, maxWidth: '100%', ...(matte ? { background: tk.bg.selected, color: tk.accent.text, borderColor: 'transparent' } : {}) }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{matte ? `Matte · ${matte.label}` : 'Matte'}</span>
            {matte && <span style={{ font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.03em', opacity: 0.8 }}>{l.trackMatte!.mode === 'luma' ? 'LUMA' : 'ALPHA'}{l.trackMatte!.invert ? ' · INV' : ''}</span>}
          </Button>
        </span>
        <span ref={maskRef} style={{ display: 'inline-flex' }}>
          <Button
            size="sm"
            icon="mask"
            disabled={full}
            title={full ? `A layer holds up to ${MASKS_MAX} masks` : 'Cut this layer with a shape of its own'}
            onClick={() => { const r = maskRef.current?.getBoundingClientRect(); setMaskMenu(r ? { x: r.left, y: r.bottom + 4 } : null); }}
            style={{ height: 26 }}
          >
            {masks.length ? 'Add mask' : 'Mask'}
          </Button>
        </span>
        {!l.displace && (
          <Button
            size="sm"
            icon="curve"
            title="Displacement Map: move this layer’s pixels by another layer or the picture, like After Effects"
            onClick={() => { onSelect(); changePlay(p => addDisplace(p, l.id, play.layers.find(x => x.id !== l.id && canBeMatte(x.kind) && x.kind !== 'background')?.id ?? '')); }}
            style={{ height: 26 }}
          >
            Displace
          </Button>
        )}
      </div>
      {matteOpen && (
        <Popover anchorRef={matteRef} onClose={() => setMatteOpen(false)} width={296} padding={12}>
          <MattePanel f={f} play={play} changePlay={changePlay} onClose={() => setMatteOpen(false)} />
        </Popover>
      )}
      {maskMenu && (
        <Menu
          x={maskMenu.x}
          y={maskMenu.y}
          minWidth={230}
          onClose={() => setMaskMenu(null)}
          items={[
            { heading: 'New mask' },
            { label: 'Rectangle', icon: 'layoutCanvas', hint: 'Over the middle of the layer; drag its handles', onSelect: () => addBoxMask('rect') },
            { label: 'Ellipse', icon: 'mask', hint: 'Over the middle of the layer; drag its handles', onSelect: () => addBoxMask('ellipse') },
            { label: 'Polygon', icon: 'edit', hint: 'Click its corners on the picture, then press Enter', onSelect: () => drawMask('polygon') },
            { label: 'Freehand', icon: 'curve', hint: 'Drag an outline on the picture', onSelect: () => drawMask('lasso') },
          ]}
        />
      )}
      {drawing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="primary" onClick={() => playOverlay.cancelDrawing()}>Cancel mask</Button>
          <span style={{ flex: 1, minWidth: 160, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
            {drawing === 'polygon' ? 'Click corners on the picture; click the first one, double-click or press Enter to close.' : 'Drag an outline on the picture.'}
          </span>
        </div>
      )}
      {masks.length > 0 && <MaskList f={f} changePlay={changePlay} onSelect={onSelect} />}
      {l.displace && <DisplacePanel f={f} play={play} changePlay={changePlay} />}
    </>
  );
}

const CHANNEL_OPTIONS = DM_CHANNELS.map(c => ({ value: c, label: DM_CHANNEL_LABELS[c] }));
const BEHAVIOUR_OPTIONS = DM_BEHAVIOURS.map(b => ({ value: b, label: DM_BEHAVIOUR_LABELS[b] }));
const QUALITY_OPTIONS = DM_QUALITIES.map(q => ({ value: q, label: DM_QUALITY_LABELS[q] }));

/** The layer's Displacement Map: its map, channels, maxima (mappable), behaviour and edges. Folded to one line by default. */
function DisplacePanel({ f, play, changePlay }: { f: FieldKit; play: PlayRecord; changePlay: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const { l, tk } = f;
  const d = l.displace!;
  const [open, setOpen] = useState(false);
  const reveal = usePlayUi(s => s.reveal);
  const patch = (c: Partial<LayerDisplace>) => changePlay(p => patchDisplace(p, l.id, c));
  const mapLayer = d.map === 'layer' ? play.layers.find(x => x.id === d.layerId) : undefined;
  const candidates = play.layers.filter(x => x.id !== l.id && canBeMatte(x.kind) && x.kind !== 'background');
  const summary = `${mapLayer ? mapLayer.label : 'The picture'} · ${DM_CHANNEL_LABELS[d.h]} / ${DM_CHANNEL_LABELS[d.v]}${d.on ? '' : ' · off'}`;
  return (
    <div style={{ marginTop: 6, borderRadius: radius.md, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, padding: '2px 6px 2px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 30 }}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: '4px 2px', cursor: 'pointer', textAlign: 'left' }}
        >
          <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
          <Icon name="curve" size={14} style={{ color: tk.accent.base }} />
          <span style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, whiteSpace: 'nowrap' }}>Displace</span>
          <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        </button>
        <Toggle checked={d.on} onChange={on => patch({ on })} />
        <IconButton icon="trash" label="Remove the Displacement Map" size="sm" tone="danger" onClick={() => changePlay(p => removeDisplace(p, l.id))} />
      </div>
      {open && (
        <div style={{ padding: '0 2px 8px 18px' }}>
          {f.row('Map', (
            <Select
              ariaLabel="Displacement map layer"
              height={26}
              style={{ flex: 1 }}
              value={d.map === 'layer' ? d.layerId : ''}
              onChange={id => patch(id ? { map: 'layer', layerId: id } : { map: 'picture', layerId: '' })}
              options={[
                { value: '', label: 'The picture (shader or background)' },
                ...candidates.map(x => ({ value: x.id, label: `${x.label}${x.visible ? '' : ' (hidden)'}`, group: 'Layers' })),
              ]}
            />
          ), DM_HINTS.map)}
          {f.row('Horiz.', <Select ariaLabel="Use for horizontal displacement" height={26} value={d.h} options={CHANNEL_OPTIONS} onChange={v => patch({ h: v as LayerDisplace['h'] })} />, `${DM_HINTS.h} ${DM_HINTS.channels}`)}
          {f.row('Vert.', <Select ariaLabel="Use for vertical displacement" height={26} value={d.v} options={CHANNEL_OPTIONS} onChange={v => patch({ v: v as LayerDisplace['v'] })} />, `${DM_HINTS.v} ${DM_HINTS.channels}`)}
          {f.prop('disp_maxH', 'Max horiz.')}
          {f.prop('disp_maxV', 'Max vert.')}
          {f.row('Behaviour', <Select ariaLabel="Displacement map behaviour" height={26} value={d.behaviour} options={BEHAVIOUR_OPTIONS} onChange={v => patch({ behaviour: v as LayerDisplace['behaviour'] })} />, DM_HINTS.behaviour)}
          {f.row('Edges', <Toggle checked={d.wrap} onChange={wrap => patch({ wrap })} label="Wrap pixels around" />, DM_HINTS.wrap)}
          {f.row('Map quality', <Select ariaLabel="Displacement map quality" height={26} value={d.quality ?? 'full'} options={QUALITY_OPTIONS} onChange={v => patch({ quality: v === 'full' ? undefined : v as LayerDisplace['quality'] })} />, DM_HINTS.quality)}
          {mapLayer && f.row('Show', <Toggle checked={mapLayer.visible} onChange={visible => changePlay(p => ({ ...p, layers: p.layers.map(x => (x.id === mapLayer.id ? { ...x, visible } : x)) }))} label="Show it on the picture too" />, 'The map layer works while hidden; show it to see what is pushing.')}
          {mapLayer && <div style={{ marginTop: 6 }}><Button size="sm" onClick={() => reveal(mapLayer.id)}>Go to {mapLayer.label}</Button></div>}
          {f.note('Mid-grey in the map leaves pixels where they are; brighter pushes right and up by up to Max, darker left and down. Max is in pixels of a 1080-pixel-tall picture.')}
        </div>
      )}
    </div>
  );
}

/** Pick the matte, how it is read, and whether it shows on its own. */
function MattePanel({ f, play, changePlay, onClose }: { f: FieldKit; play: PlayRecord; changePlay: (fn: (p: PlayRecord) => PlayRecord) => void; onClose: () => void }) {
  const { l, tk } = f;
  const t = l.trackMatte;
  const matte = t ? play.layers.find(x => x.id === t.id) : undefined;
  const candidates = matteCandidates(play.layers, l.id);
  // Layers that can't be picked because they'd loop back here, named so it's clear why they're missing.
  const looping = play.layers.filter(x => x.id !== l.id && canBeMatte(x.kind) && !candidates.includes(x));
  const reveal = usePlayUi(s => s.reveal);
  const pick = (id: string) => {
    if (id === '__new') {
      let made = '';
      changePlay(p => { const r = addMatteShape(p, l.id, playOverlay.pictureAspect()); made = r.id; return r.play; });
      onClose();
      if (made) { reveal(made); toast.success('Added a shape as the matte', { message: 'It is hidden; drag its handles on the picture to move the window.' }); }
      return;
    }
    if (id === '__motion') {
      let made = '';
      changePlay(p => { const r = addMatteMotion(p, l.id); made = r.id; return r.play; });
      if (made) toast.success('Showing it only where things move', { message: 'A hidden Motion layer is the matte. Turn the camera on (or point it at a video) in its card; Feather softens the edge, Invert shows it where nothing moves.' });
      return;
    }
    changePlay(p => setTrackMatte(p, l.id, id));
  };
  const label: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62, flexShrink: 0 };
  const row = (name: string, children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}><span style={label}>{name}</span><div style={rowField}>{children}</div></div>
  );
  const kindName = (x: PlayLayer) => BUILTIN_LAYER[x.kind]?.label ?? x.kind;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="link" size={14} style={{ color: tk.text.faint }} />
        <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Matte</span>
      </div>
      <div style={{ marginTop: 4, color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>
        Show {l.label} only where another layer is: its solid parts (Alpha) or its bright parts (Luma).
      </div>
      {row('Layer', (
        <Select
          ariaLabel="Matte layer"
          height={28}
          style={{ flex: 1 }}
          value={t?.id ?? ''}
          onChange={pick}
          options={[
            { value: '', label: 'None' },
            ...candidates.map(x => ({ value: x.id, label: `${x.label}${x.visible ? '' : ' (hidden)'}`, group: 'Layers' })),
            { value: '__new', label: '+ New shape', group: 'Make one' },
            { value: '__motion', label: '+ Where it moves (Motion layer)', group: 'Make one' },
          ]}
        />
      ))}
      {t && matte && (
        <>
          {row('By', <Segmented size="sm" ariaLabel="Matte by" value={t.mode} options={[{ value: 'alpha', label: 'Alpha', title: 'Where the matte is solid' }, { value: 'luma', label: 'Luma', title: 'Where the matte is bright' }]} onChange={mode => changePlay(p => patchTrackMatte(p, l.id, { mode }))} />)}
          {row('Invert', <Toggle checked={t.invert} onChange={invert => changePlay(p => patchTrackMatte(p, l.id, { invert }))} label={t.invert ? 'Where the matte isn’t' : 'Where the matte is'} />)}
          {matte.kind === 'motion' && row('Feather', (
            <div style={{ flex: 1, minWidth: 0 }}>
              <RulerSlider value={matte.feather} min={0} max={0.3} defaultValue={0.03} ariaLabel="Feather of where it moves" onChange={feather => changePlay(p => ({ ...p, layers: p.layers.map(x => (x.id === matte.id && x.kind === 'motion' ? { ...x, feather } : x)) }))} />
            </div>
          ))}
          {matte.kind === 'motion' && <div style={{ marginTop: 6, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Shows {l.label} where {matte.label} sees movement. Its Sensitivity, Delay and Smoothing decide how much counts; Invert shows it where nothing moves.</div>}
          {matte.kind === 'water' && row('Feather', (
            <div style={{ flex: 1, minWidth: 0 }}>
              <RulerSlider value={matte.feather} min={0} max={0.3} defaultValue={0.02} ariaLabel="Feather of where the water moves" onChange={feather => changePlay(p => ({ ...p, layers: p.layers.map(x => (x.id === matte.id && x.kind === 'water' ? { ...x, feather } : x)) }))} />
            </div>
          ))}
          {matte.kind === 'water' && <div style={{ marginTop: 6, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Shows {l.label} where {matte.label}’s water moves (its waves), fading out where the water lies flat. Invert shows it on the still water instead.</div>}
          {matte.kind !== 'background' && row('Matte', <Toggle checked={matte.visible} onChange={visible => changePlay(p => ({ ...p, layers: p.layers.map(x => (x.id === matte.id ? { ...x, visible } : x)) }))} label="Show it on the picture too" />)}
          <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center' }}>
            <Button size="sm" onClick={() => { onClose(); reveal(matte.id); }}>Go to {matte.label}</Button>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={() => changePlay(p => setTrackMatte(p, l.id, ''))}>Remove</Button>
          </div>
          <div style={{ marginTop: 8, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{kindName(matte)} · {matte.visible ? 'shown on its own too' : 'hidden, working as the matte'}</div>
        </>
      )}
      {looping.length > 0 && (
        <div style={{ marginTop: 10, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
          Not offered: {looping.map(x => x.label).join(', ')} ({looping.length === 1 ? 'it uses' : 'they use'} {l.label} as a matte, which would loop).
        </div>
      )}
    </div>
  );
}

/** The layer's masks, in the order they combine. The open one has handles on the picture. */
function MaskList({ f, changePlay, onSelect }: { f: FieldKit; changePlay: (fn: (p: PlayRecord) => PlayRecord) => void; onSelect: () => void }) {
  const { l, tk } = f;
  const masks = l.masks ?? [];
  const open = usePlayUi(s => (s.selected === l.id ? s.mask : ''));
  const setMask = usePlayUi(s => s.setMask);
  const several = masks.length > 1;
  const props = new Set(layerNumericProps(l).map(d => d.key));
  const num = (m: LayerMask, p: MaskProp, label: string) => (props.has(maskKey(m.id, p)) ? f.prop(maskKey(m.id, p), label) : null);
  return (
    <div style={{ marginTop: 6, borderRadius: radius.md, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      {masks.map((m, i) => {
        const isOpen = open === m.id;
        return (
          <div key={m.id} style={{ borderTop: i ? `1px solid ${tk.border.subtle}` : undefined, padding: '2px 6px 2px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 30 }}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => { onSelect(); setMask(isOpen ? '' : m.id); }}
                title={isOpen ? 'Close (the layer gets its handles back)' : 'Open: its handles show on the picture'}
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: '4px 2px', cursor: 'pointer', textAlign: 'left' }}
              >
                <Icon name={isOpen ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
                <Icon name="mask" size={14} style={{ color: tk.status.warning }} />
                <span style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, whiteSpace: 'nowrap' }}>{maskLabel(m.id)}</span>
                <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {SHAPE_NAMES[m.shape]}{i > 0 || m.op !== 'add' ? ` · ${OP_NAMES[m.op]}` : ''}{m.invert ? ' · Inverted' : ''}
                </span>
              </button>
              {several && <IconButton icon="chevU" label="Combine earlier" size="sm" tooltip={false} disabled={i === 0} onClick={() => changePlay(p => moveMask(p, l.id, m.id, -1))} />}
              {several && <IconButton icon="chevD" label="Combine later" size="sm" tooltip={false} disabled={i === masks.length - 1} onClick={() => changePlay(p => moveMask(p, l.id, m.id, 1))} />}
              <IconButton icon="trash" label={`Delete ${maskLabel(m.id)}`} size="sm" tone="danger" onClick={() => { if (isOpen) setMask(''); changePlay(p => removeMask(p, l.id, m.id)); }} />
            </div>
            {isOpen && (
              <div style={{ padding: '0 2px 8px 18px' }}>
                {several && f.row('Mode', (
                  <Segmented<MaskOp>
                    size="sm"
                    ariaLabel="Mask mode"
                    value={m.op}
                    options={[{ value: 'add', label: 'Add', title: 'Joins this mask to the ones above' }, { value: 'subtract', label: 'Subtract', title: 'Cuts this mask out of the ones above' }, { value: 'intersect', label: 'Intersect', title: 'Keeps only where this mask and the ones above overlap' }]}
                    onChange={op => changePlay(p => patchMask(p, l.id, m.id, { op }))}
                  />
                ), 'How this mask combines with the masks above it.')}
                {f.row('Invert', <Toggle checked={m.invert} onChange={invert => changePlay(p => patchMask(p, l.id, m.id, { invert }))} label={m.invert ? 'Hides inside, shows outside' : 'Shows inside'} />, 'Swap inside and outside.')}
                {num(m, 'feather', 'Feather')}
                {num(m, 'expand', 'Expand')}
                {num(m, 'opacity', 'Opacity')}
                {num(m, 'x', 'X')}
                {num(m, 'y', 'Y')}
                {num(m, 'w', 'Width')}
                {num(m, 'h', 'Height')}
                {num(m, 'rotation', 'Rotation')}
                {m.shape === 'rect' && num(m, 'round', 'Rounding')}
                {f.note('Drag it on the picture with its amber handles. X and Y are from the layer’s centre, so the mask moves and turns with the layer.')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
