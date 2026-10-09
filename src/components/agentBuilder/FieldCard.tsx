/**
 * Follow a field's settings (docs/agent-builder.md "Follow a field"): how the particles take the
 * field (ride it, or feel it as a force), its layers (each a known field with 1–3 plain sliders, or
 * your own vx / vy, with a weight, an optional turn, mask and animation), and a gallery of
 * moving tiles to add a layer from. The field is agentRules/fields.ts; every change is a patch of
 * the card's rule action, so the Field block is generated again (Open as nodes, Play, export).
 *
 * The tiles are drawn only while the gallery is open: one shared animation loop, each tile a few
 * particles riding its field, simulated once (fields.ts rideField) and replayed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Segmented, Toggle } from '../ui/Choice';
import {
  type FieldKind, type FieldLayer, type FieldSpec, FIELD_GALLERY, FIELD_KINDS, MAX_LAYERS, OWN_EXAMPLES,
  fieldFunction, newLayer, normalizeFieldSpec, ownParts, rideField,
} from '../../agentRules/fields';
import { FIELD_COLOURS } from '../../agentBuilder/legend';
import { SettingRow, SliderSetting } from './BehaviourCard';

type FieldAct = { kind: 'field'; strength: number; grip?: number; spec: FieldSpec };

export function FieldSettings({ id, action, d3, onChange, onFocus }: {
  /** The card's key (gravity#0 style), for data attributes. */
  id: string;
  action: FieldAct;
  d3: boolean;
  onChange: (patch: Partial<FieldAct>) => void;
  onFocus: (s: string | undefined) => void;
}) {
  const tk = useTokens();
  const spec = useMemo(() => normalizeFieldSpec(action.spec), [action.spec]);
  const [open, setOpen] = useState<number | null>(spec.layers.length === 1 ? 0 : null);
  const [gallery, setGallery] = useState(false);
  const setLayers = (layers: FieldLayer[]) => onChange({ spec: { layers } });
  const patchLayer = (k: number, p: Partial<FieldLayer>) => setLayers(spec.layers.map((l, j) => (j === k ? { ...l, ...p } : l)));
  const ride = !!action.grip && action.grip > 0;
  return (
    <div data-field-card={id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SliderSetting id="strength" label="Strength" hint="The field's velocity times this." value={action.strength} min={0} max={3} step={0.01} onFocus={onFocus} onChange={v => onChange({ strength: v })} />
      <SettingRow id="how" label="How it moves them" hint="Ride: they take on the field's velocity (they trace its lines). Push: the field is a force (they overshoot and swing)." onFocus={onFocus}>
        <Segmented size="sm" fill ariaLabel="How it moves them" value={ride ? 'ride' : 'push'} onChange={v => onChange({ grip: v === 'ride' ? (action.grip && action.grip > 0 ? action.grip : 3) : undefined })}
          options={[{ value: 'ride' as const, label: 'Ride it' }, { value: 'push' as const, label: 'Push (a force)' }]} />
      </SettingRow>
      {ride && <SliderSetting id="grip" label="Grip (a second)" hint="How quickly their velocity becomes the field's: higher follows its lines more tightly." value={action.grip ?? 3} min={0.1} max={20} step={0.1} onFocus={onFocus}
        onChange={v => onChange({ grip: Math.max(0.1, v) })} />}

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: tk.text.secondary, marginTop: 2 }}>
        Layers <span style={{ fontWeight: 500, color: tk.text.faint }}>they add up</span>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {spec.layers.map((l, k) => (
          <LayerRow key={k} k={k} layer={l} d3={d3} open={open === k} onOpen={() => setOpen(open === k ? null : k)} onFocus={onFocus}
            onPatch={p => patchLayer(k, p)} onRemove={() => { setLayers(spec.layers.filter((_, j) => j !== k)); setOpen(null); }} />
        ))}
        {!spec.layers.length && <span style={{ fontSize: 12, color: tk.text.muted }}>No layers: the field is still. Add one below.</span>}
      </div>
      {spec.layers.length < MAX_LAYERS && (
        <button type="button" data-field-add aria-expanded={gallery} onClick={() => setGallery(g => !g)}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px 0 8px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: gallery ? tk.bg.hover : 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` }}>
          <Icon name={gallery ? 'chevD' : 'plus'} size={12} />Add a layer
        </button>
      )}
      {gallery && (
        <div data-field-gallery style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 8 }}>
          {FIELD_GALLERY.map(kind => (
            <button key={kind} type="button" data-field-tile={kind} title={FIELD_KINDS[kind].hint}
              onClick={() => { setLayers([...spec.layers, newLayer(kind)]); setOpen(spec.layers.length); setGallery(false); }}
              style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 5, border: 0, borderRadius: radius.md, background: tk.bg.field, cursor: 'pointer', color: tk.text.secondary, textAlign: 'left', boxShadow: `inset 0 0 0 1px ${tk.border.subtle ?? tk.border.default}` }}>
              <FieldTile kind={kind} />
              <span style={{ font: `500 11px ${fontFamily.ui}`, padding: '0 2px', lineHeight: 1.25 }}>{FIELD_KINDS[kind].label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LayerRow({ k, layer: l, d3, open, onOpen, onPatch, onRemove, onFocus }: {
  k: number; layer: FieldLayer; d3: boolean; open: boolean; onOpen: () => void;
  onPatch: (p: Partial<FieldLayer>) => void; onRemove: () => void; onFocus: (s: string | undefined) => void;
}) {
  const tk = useTokens();
  const info = FIELD_KINDS[l.kind];
  const colour = FIELD_COLOURS[k % FIELD_COLOURS.length];
  const bad = l.kind === 'own' && ownParts(l, d3).some(p => !p.check.ok);
  const focus = (s: string | undefined) => onFocus(s === undefined ? undefined : `layer${k}`);
  return (
    <div data-field-layer-row={k} data-setting={`layer${k}`} onPointerEnter={() => onFocus(`layer${k}`)}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, opacity: l.off ? 0.55 : 1, boxShadow: open ? `inset 0 0 0 1px ${alpha(colour, 0.6)}` : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" data-field-layer-open={k} aria-expanded={open} onClick={onOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.primary, textAlign: 'left' }}>
          <Icon name={open ? 'chevD' : 'chevR'} size={12} />
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: colour, flexShrink: 0 }} />
          <b style={{ font: `600 12.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.label}</b>
          <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: bad ? tk.status.danger : tk.text.muted, whiteSpace: 'nowrap' }}>
            {bad ? 'fix it' : `× ${Math.round(l.weight * 100) / 100}${l.mask ? ` · ${l.mask.outside ? 'outside' : 'inside'}` : ''}${l.animate?.speed ? ` · ${l.animate.mode}` : ''}`}
          </span>
        </button>
        <span data-field-layer-switch={k}><Toggle checked={!l.off} onChange={on => onPatch({ off: on ? undefined : true })} /></span>
        <button type="button" data-field-layer-remove={k} aria-label={`Take ${info.label} away`} title={`Take ${info.label} away`} onClick={onRemove}
          style={{ width: 22, height: 22, padding: 0, border: 0, borderRadius: 6, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={12} />
        </button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SliderSetting id={`layer${k}-weight`} label="Weight" hint="How much of it is added (negative turns it round)." value={l.weight} min={-2} max={2} step={0.01} onFocus={focus} onChange={v => onPatch({ weight: v })} />
          {info.size && <SliderSetting id={`layer${k}-size`} label={info.size.label} hint={info.size.hint} value={l.size ?? info.defaults.size ?? 0.3} min={info.size.min} max={info.size.max} step={0.01} onFocus={focus} onChange={v => onPatch({ size: Math.max(info.size!.min, v) })} />}
          {info.centre && <>
            <SliderSetting id={`layer${k}-x`} label="Across" value={l.x ?? 0} min={-1.8} max={1.8} step={0.01} onFocus={focus} onChange={v => onPatch({ x: v })} />
            <SliderSetting id={`layer${k}-y`} label="Up" value={l.y ?? 0} min={-1} max={1} step={0.01} onFocus={focus} onChange={v => onPatch({ y: v })} />
          </>}
          {info.angle && <SliderSetting id={`layer${k}-angle`} label="Direction (°)" hint="0 right, 90 up." value={l.angle ?? 0} min={-180} max={180} step={1} onFocus={focus} onChange={v => onPatch({ angle: v })} />}
          {info.flip && (
            <SettingRow id={`layer${k}-flip`} label="Which way" onFocus={focus}>
              <Segmented size="sm" fill ariaLabel="Which way" value={l.flip ? 'b' : 'a'} onChange={v => onPatch({ flip: v === 'b' ? true : undefined })}
                options={[{ value: 'a' as const, label: info.flip[0] }, { value: 'b' as const, label: info.flip[1] }]} />
            </SettingRow>
          )}
          {l.kind === 'slope' && <>
            <SettingRow id={`layer${k}-around`} label="Along" onFocus={focus}>
              <Segmented size="sm" fill ariaLabel="Along" value={l.around ? 'round' : 'down'} onChange={v => onPatch({ around: v === 'round' ? true : undefined })}
                options={[{ value: 'down' as const, label: 'The slope' }, { value: 'round' as const, label: 'Round its contours' }]} />
            </SettingRow>
            <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>Wire a picture, a shape or any chain into the group's <b>Field ƒ</b> socket. It isn't drawn here: the walkers show it.</span>
          </>}
          {l.kind === 'own' && <OwnEditor k={k} layer={l} d3={d3} onPatch={onPatch} />}
          <Extras k={k} layer={l} onPatch={onPatch} onFocus={focus} />
        </div>
      )}
    </div>
  );
}

/** Rotate, mask, animate: folded. */
function Extras({ k, layer: l, onPatch, onFocus }: { k: number; layer: FieldLayer; onPatch: (p: Partial<FieldLayer>) => void; onFocus: (s: string | undefined) => void }) {
  const tk = useTokens();
  const [open, setOpen] = useState(!!(l.rotate || l.mask || l.animate));
  const m = l.mask, an = l.animate;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button type="button" data-field-extras={k} aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}` }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />Turn, mask, animate
      </button>
      {open && <>
        <SliderSetting id={`layer${k}-rotate`} label="Turn its flow (°)" hint="Turn every arrow of this layer: a vortex turned 60° spirals in." value={l.rotate ?? 0} min={-180} max={180} step={1} onFocus={onFocus} onChange={v => onPatch({ rotate: v || undefined })} />
        <SettingRow id={`layer${k}-mask`} label="Where" onFocus={onFocus}>
          <Segmented size="sm" fill ariaLabel="Where" value={!m ? 'all' : m.outside ? 'out' : 'in'}
            onChange={v => onPatch({ mask: v === 'all' ? undefined : { shape: m?.shape ?? 'circle', x: m?.x ?? 0, y: m?.y ?? 0, size: m?.size ?? 0.5, ...(v === 'out' ? { outside: true } : {}) } })}
            options={[{ value: 'all' as const, label: 'Everywhere' }, { value: 'in' as const, label: 'Only inside' }, { value: 'out' as const, label: 'Only outside' }]} />
        </SettingRow>
        {m && <>
          <SettingRow id={`layer${k}-shape`} label="Shape" onFocus={onFocus}>
            <Segmented size="sm" fill ariaLabel="Shape" value={m.shape} onChange={v => onPatch({ mask: { ...m, shape: v } })}
              options={[{ value: 'circle' as const, label: 'Circle' }, { value: 'box' as const, label: 'Box' }]} />
          </SettingRow>
          <SliderSetting id={`layer${k}-msize`} label={m.shape === 'circle' ? 'Radius' : 'Half-width'} value={m.size} min={0.02} max={2} step={0.01} onFocus={onFocus} onChange={v => onPatch({ mask: { ...m, size: Math.max(0.02, v) } })} />
          <SliderSetting id={`layer${k}-mx`} label="Its centre across" value={m.x} min={-1.8} max={1.8} step={0.01} onFocus={onFocus} onChange={v => onPatch({ mask: { ...m, x: v } })} />
          <SliderSetting id={`layer${k}-my`} label="Its centre up" value={m.y} min={-1} max={1} step={0.01} onFocus={onFocus} onChange={v => onPatch({ mask: { ...m, y: v } })} />
        </>}
        <SettingRow id={`layer${k}-animate`} label="Animate" onFocus={onFocus}>
          <Segmented size="sm" fill ariaLabel="Animate" value={an?.mode ?? 'still'}
            onChange={v => onPatch({ animate: v === 'still' ? undefined : { mode: v, speed: an?.speed ?? (v === 'spin' ? 20 : 0.1), ...(an?.angle !== undefined ? { angle: an.angle } : {}) } })}
            options={[{ value: 'still' as const, label: 'Still' }, { value: 'drift' as const, label: 'Drift' }, { value: 'spin' as const, label: 'Spin' }]} />
        </SettingRow>
        {an && <SliderSetting id={`layer${k}-aspeed`} label={an.mode === 'spin' ? 'Turns (° a second)' : 'Drifts (a second)'} value={an.speed} min={an.mode === 'spin' ? -180 : 0} max={an.mode === 'spin' ? 180 : 1} step={an.mode === 'spin' ? 1 : 0.005} onFocus={onFocus}
          onChange={v => onPatch({ animate: { ...an, speed: v } })} />}
        {an?.mode === 'drift' && <SliderSetting id={`layer${k}-aangle`} label="Toward (°)" value={an.angle ?? 0} min={-180} max={180} step={1} onFocus={onFocus} onChange={v => onPatch({ animate: { ...an, angle: v } })} />}
      </>}
    </div>
  );
}

/** Your own: vx, vy (and vz in 3D), each checked as you type, with its error under it; examples to insert. */
function OwnEditor({ k, layer: l, d3, onPatch }: { k: number; layer: FieldLayer; d3: boolean; onPatch: (p: Partial<FieldLayer>) => void }) {
  const tk = useTokens();
  const parts = ownParts(l, d3);
  return (
    <div data-field-own={k} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>In x, y{d3 ? ', z' : ''} (picture units: the picture is 2 tall) and t (seconds). GLSL: write 2.0, not 2.</span>
      {parts.map(p => (
        <label key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.secondary, width: 30 }}>{p.key} =</span>
            <input data-field-own-input={p.key} value={l[p.key] ?? (p.key === 'vz' ? '0.0' : '')} spellCheck={false} aria-label={p.key} aria-invalid={!p.check.ok}
              onChange={e => onPatch({ [p.key]: e.target.value })}
              style={{ flex: 1, minWidth: 0, height: 28, padding: '0 8px', borderRadius: radius.control, border: 0, outline: 'none', background: tk.bg.panel, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`,
                boxShadow: `inset 0 0 0 1px ${p.check.ok ? tk.border.default : (tk.status.danger)}` }} />
          </span>
          {!p.check.ok && <span data-field-own-error={p.key} role="alert" style={{ fontSize: 11.5, color: tk.status.danger, paddingLeft: 38, lineHeight: 1.4 }}>{p.check.error}</span>}
        </label>
      ))}
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {OWN_EXAMPLES.map(e => (
          <button key={e.label} type="button" data-field-example={e.label} title={`vx = ${e.vx}, vy = ${e.vy}`} onClick={() => onPatch({ vx: e.vx, vy: e.vy, ...(d3 ? { vz: e.vz ?? '0.0' } : {}) })}
            style={{ height: 24, padding: '0 9px', borderRadius: 12, border: 0, cursor: 'pointer', background: tk.bg.panel, color: tk.text.secondary, font: `500 11px ${fontFamily.ui}`, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
            {e.label}
          </button>
        ))}
      </span>
    </div>
  );
}

// ── The gallery's moving tiles ───────────────────────────────────────────────

const TILE_W = 80, TILE_H = 54;
const TILE_BOX = { x0: -1.2, y0: -0.8, x1: 1.2, y1: 0.8 };
const TILE_SECONDS = 4;
/** One animation loop for every tile on screen (nothing runs while none is). */
const tiles = new Set<(t: number) => void>();
let raf = 0;
const loop = (now: number) => { for (const d of tiles) d(now / 1000); raf = tiles.size ? requestAnimationFrame(loop) : 0; };

function tilePicture(kind: FieldKind) {
  const layer = kind === 'slope' ? { ...newLayer('source'), flip: true, size: 0.5 } : { ...newLayer(kind), weight: 1 };
  const fn = fieldFunction({ layers: [layer] });
  const starts = Array.from({ length: 22 }, (_, i) => ({ x: TILE_BOX.x0 + ((i * 0.618034) % 1) * 2.4, y: TILE_BOX.y0 + ((i * 0.381966 + 0.13) % 1) * 1.6 }));
  const tracks = rideField(fn, starts, { seconds: TILE_SECONDS, strength: 0.9, grip: 6, box: TILE_BOX });
  const arrows: Array<[number, number, number, number]> = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 7; i++) {
    const x = TILE_BOX.x0 + (i + 0.5) * 2.4 / 7, y = TILE_BOX.y0 + (j + 0.5) * 0.4;
    const [vx, vy] = fn(x, y, 0);
    const m = Math.hypot(vx, vy) || 1;
    arrows.push([x, y, vx / m, vy / m]);
  }
  return { tracks, arrows };
}

function FieldTile({ kind }: { kind: FieldKind }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const pic = useMemo(() => tilePicture(kind), [kind]);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = TILE_W * dpr; c.height = TILE_H * dpr;
    const X = (x: number) => (x - TILE_BOX.x0) / 2.4 * TILE_W, Y = (y: number) => (1 - (y - TILE_BOX.y0) / 1.6) * TILE_H;
    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, TILE_W, TILE_H);
      ctx.strokeStyle = alpha(tk.accent.base, 0.55); ctx.lineWidth = 1.1;
      for (const [x, y, ux, uy] of pic.arrows) {
        ctx.beginPath(); ctx.moveTo(X(x - ux * 0.13), Y(y - uy * 0.13)); ctx.lineTo(X(x + ux * 0.13), Y(y + uy * 0.13)); ctx.stroke();
      }
      const f = Math.floor((t % TILE_SECONDS) * 30);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
      for (const tr of pic.tracks) {
        // A short tail behind each rider (split where it wraps).
        ctx.globalAlpha = 0.45; ctx.beginPath();
        for (let k = Math.max(0, f - 8); k <= Math.min(f, tr.length - 1); k++) {
          const q = tr[k], prev = tr[k - 1];
          if (k === Math.max(0, f - 8) || !prev || Math.abs(q.x - prev.x) > 1 || Math.abs(q.y - prev.y) > 1) ctx.moveTo(X(q.x), Y(q.y)); else ctx.lineTo(X(q.x), Y(q.y));
        }
        ctx.stroke();
        const p = tr[Math.min(f, tr.length - 1)];
        ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw(0);
    tiles.add(draw);
    if (!raf) raf = requestAnimationFrame(loop);
    return () => { tiles.delete(draw); if (!tiles.size && raf) { cancelAnimationFrame(raf); raf = 0; } };
  }, [pic, tk.accent.base, tk.text.primary]);
  return <canvas ref={ref} width={TILE_W} height={TILE_H} style={{ width: '100%', height: TILE_H, borderRadius: radius.sm ?? 6, background: tk.bg.render, display: 'block' }} />;
}
