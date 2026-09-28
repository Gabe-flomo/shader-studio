/**
 * RackControls — a rack's controls on its card (docs/arrangement.md,
 * Configure): the compact strip of faders (up to 8 per instrument or effect)
 * and Configure, where they're picked. On the desktop, Configure watches the
 * plug-in's own window: move a knob there and it's offered ("Add Cutoff");
 * the parameter list is always there too (the only way in a browser, and for
 * a plug-in that doesn't report its window's moves).
 *
 * The faders are ordinary Play controls (play/rackControls.ts): mappable to a
 * MIDI knob, recorded by takes and on the tape. While the tape plays, a
 * fader's dot follows the value the tape (or a mapping) gives it, on its own
 * animation frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { askText } from '../../ui/dialogStore';
import { toast } from '../../ui/toastStore';
import type { PlayRecord } from '../../../types/play';
import { RACK_CONTROLS_MAX } from '../../../types/playArrangement';
import { aeSlotName, auPropId, patchSlot, type AeRack, type AeSlot } from '../../../types/playAudioEngine';
import { audioEngineHost, useEngineUi } from '../../../lib/audioEngineHost';
import { formatParam, type AuParam } from '../../../lib/audioEngineProtocol';
import { ParamWatch, WATCH_EVERY_MS } from '../../../lib/paramWatch';
import { playEngine } from '../../../lib/playEngine';
import { useTape } from '../../../lib/tape';
import { GR_PARAMS } from '../../../play/kit/granulator.js';
import { addRackControl, moveRackControl, rackControlsOf, removeRackControl, renameRackControl, type RackParamInfo } from '../../../play/rackControls';
import { withEngine } from './engineOps';
import { usePlayUi } from '../playUi';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/** What a slot's parameters are: an Audio Unit's (listed by the engine), or a granulator's settings. */
function useSlotParams(rack: AeRack, slot: AeSlot): AuParam[] | null {
  const key = `${rack.id}/${slot.id}`;
  const au = useEngineUi(s => s.params[key]);
  useEffect(() => { if (slot.kind === 'au' && !au) void audioEngineHost.listParams(rack.id, slot.id); }, [au, rack.id, slot.id, slot.kind]);
  return useMemo(() => {
    if (slot.kind === 'granulator') {
      return GR_PARAMS.map(p => ({ address: String(p.addr), identifier: p.key, name: p.name, min: p.min, max: p.max, value: p.value, unit: p.unit, kind: p.kind as AuParam['kind'], step: p.step, log: p.log, ...(p.values ? { values: p.values as string[] } : {}) }));
    }
    return slot.kind === 'au' ? au ?? null : [];
  }, [slot.kind, au]);
}

const info = (p: AuParam): RackParamInfo => ({ address: p.address, name: p.name, min: p.min, max: p.max, ...(p.step ? { step: p.step } : {}), value: p.value });

// ── The strip ────────────────────────────────────────────────────────────────

/** Every rack control on the rack (the instrument's, then each effect's), as small faders. */
export function RackControlsStrip({ rack, play, onChange, touch }: { rack: AeRack; play: PlayRecord; onChange: Change; touch: boolean }) {
  const tk = useTokens();
  const slots = [rack.instrument, ...rack.effects].filter((s): s is AeSlot => !!s);
  const any = slots.some(s => rackControlsOf(play, rack, s).length);
  if (!any) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {slots.map(s => {
        const list = rackControlsOf(play, rack, s);
        if (!list.length) return null;
        return (
          <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {slots.length > 1 && <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}` }}>{aeSlotName(s)}</span>}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${touch ? 130 : 108}px, 1fr))`, gap: 4 }}>
              {list.map(({ address, control }) => <StripFader key={address} rack={rack} slot={s} address={address} label={control.label} min={control.min} max={control.max} step={control.step} onChange={onChange} touch={touch} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StripFader({ rack, slot, address, label, min, max, step, onChange, touch }: {
  rack: AeRack; slot: AeSlot; address: string; label: string; min: number; max: number; step?: number; onChange: Change; touch: boolean;
}) {
  const params = useEngineUi(s => s.params[`${rack.id}/${slot.id}`]);
  const p = params?.find(x => x.address === address);
  const base = slot.params?.[address] ?? p?.value ?? (slot.kind === 'granulator' ? GR_PARAMS.find(g => String(g.addr) === address)?.value ?? min : min);
  const set = (v: number) => {
    if (slot.kind === 'au') audioEngineHost.setParamNow(rack.id, slot.id, address, v);
    onChange(pr => withEngine(pr, patchSlot(pr.audioEngine, rack.id, slot.id, { params: { ...slot.params, [address]: v } })));
  };
  const text = (v: number) => (p ? formatParam(p, v) : slot.kind === 'granulator' ? fmtGr(address, v) : String(Math.round(v * 100) / 100));
  return <MiniFader label={label} value={base} min={min} max={max} step={step} onChange={set} format={text} touch={touch}
    live={() => playEngine.layerValue(auPropId(rack.id, slot.id), address, Number.NaN)} />;
}

function fmtGr(address: string, v: number): string {
  const g = GR_PARAMS.find(x => String(x.addr) === address);
  if (!g) return String(v);
  return formatParam({ unit: g.unit, kind: g.kind as AuParam['kind'], values: g.values as string[] | undefined, min: g.min }, v);
}

/**
 * A small horizontal fader: drag (or arrow keys), double-click for the
 * middle. `live` is read on an animation frame while the tape runs, and
 * shown as a dot where the value is being driven.
 */
function MiniFader({ label, value, min, max, step, onChange, format, touch, live }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format: (v: number) => string; touch: boolean; live?: () => number;
}) {
  const tk = useTokens();
  const dotRef = useRef<HTMLSpanElement>(null);
  const running = useTape(s => s.phase !== 'stopped');
  const span = max - min || 1;
  const f = Math.max(0, Math.min(1, (value - min) / span));
  const snap = (v: number) => { const c = Math.max(min, Math.min(max, v)); return step ? Math.round((c - min) / step) * step + min : c; };
  const fromX = (el: HTMLElement, x: number) => { const r = el.getBoundingClientRect(); return snap(min + ((x - r.left) / r.width) * span); };
  useEffect(() => {
    const dot = dotRef.current;
    if (!dot || !live) return;
    const place = () => {
      const v = live();
      if (Number.isNaN(v)) { dot.style.opacity = '0'; return; }
      dot.style.opacity = '1';
      dot.style.left = `${Math.max(0, Math.min(1, (v - min) / span)) * 100}%`;
    };
    place();
    if (!running) return;
    let raf = 0;
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, live, min, span]);
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={format(value)} title={`${label}: ${format(value)}`}
      onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onChange(fromX(e.currentTarget, e.clientX)); }}
      onPointerMove={e => { if (e.buttons & 1) onChange(fromX(e.currentTarget, e.clientX)); }}
      onDoubleClick={() => onChange(snap(min + span / 2))}
      onKeyDown={e => {
        const d = (step || span / 100) * (e.shiftKey ? 10 : 1);
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(snap(value + d)); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(snap(value - d)); }
      }}
      style={{ position: 'relative', height: touch ? 40 : 32, borderRadius: radius.sm, background: tk.bg.field, overflow: 'hidden', cursor: 'ew-resize', touchAction: 'none', userSelect: 'none' }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${f * 100}%`, background: alpha(tk.accent.base, 0.28) }} />
      <span style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: tk.accent.base }} />
      <span ref={dotRef} style={{ position: 'absolute', bottom: 3, width: 6, height: 6, marginLeft: -3, borderRadius: '50%', background: tk.status.warning, opacity: 0 }} />
      <span style={{ position: 'absolute', left: 6, right: 6, top: 3, display: 'flex', justifyContent: 'space-between', gap: 4, pointerEvents: 'none' }}>
        <span style={{ font: `600 10.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{label}</span>
      </span>
      <span style={{ position: 'absolute', left: 6, bottom: 3, font: `10px ${fontFamily.mono}`, color: tk.text.muted, pointerEvents: 'none' }}>{format(value)}</span>
    </div>
  );
}

// ── Configure ────────────────────────────────────────────────────────────────

/** Pick up to RACK_CONTROLS_MAX of a slot's parameters as rack controls; rename, reorder, remove them. */
export function ConfigurePanel({ rack, slot, play, onChange, desktop, onClose }: {
  rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; desktop: boolean; onClose: () => void;
}) {
  const tk = useTokens();
  const params = useSlotParams(rack, slot);
  const current = rackControlsOf(play, rack, slot);
  const full = current.length >= RACK_CONTROLS_MAX;
  const [q, setQ] = useState('');
  const have = new Set(current.map(c => c.address));
  const add = (p: AuParam) => {
    if (full) { toast.error(`Up to ${RACK_CONTROLS_MAX} rack controls on ${aeSlotName(slot)}`); return; }
    onChange(pr => addRackControl(pr, rack.id, slot.id, info(p)));
  };
  const shown = (params ?? []).filter(p => !have.has(p.address) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  const watching = desktop && slot.kind === 'au';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 8px 8px 10px', borderRadius: radius.md, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, background: alpha(tk.accent.base, 0.04) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <b style={{ flex: 1, font: `650 12px ${fontFamily.ui}`, color: tk.text.primary }}>Configure · {current.length} of {RACK_CONTROLS_MAX} rack controls</b>
        <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>
      <span style={{ color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>
        Rack controls sit on this card as faders, in <b>{rack.name} · {aeSlotName(slot)}</b> on the Controls tab: map a MIDI knob to one, and the tape records its moves.
      </span>
      {current.map(({ address, control }, i) => (
        <div key={address} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ flex: 1, minWidth: 0, color: tk.text.secondary, font: `12px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {control.label}</span>
          <IconButton icon="edit" size="sm" label="Rename" onClick={async () => { const n = await askText('Rename rack control', { initial: control.label, confirmLabel: 'Rename' }); if (n) onChange(p => renameRackControl(p, rack.id, slot.id, address, n)); }} />
          <IconButton icon="chevU" size="sm" label="Earlier" disabled={i === 0} onClick={() => onChange(p => moveRackControl(p, rack.id, slot.id, address, -1))} />
          <IconButton icon="chevD" size="sm" label="Later" disabled={i === current.length - 1} onClick={() => onChange(p => moveRackControl(p, rack.id, slot.id, address, 1))} />
          <IconButton icon="close" size="sm" label="Remove this rack control (its mappings and its moves on the tape go too)" onClick={() => onChange(p => removeRackControl(p, rack.id, slot.id, address))} />
        </div>
      ))}
      {current.length > 0 && <div><Button size="sm" variant="ghost" icon="sliders" onClick={() => usePlayUi.getState().revealControlGroup(`${rack.name} · ${aeSlotName(slot)}`)}>On the Controls tab</Button></div>}
      {watching && <WindowWatch rack={rack} slot={slot} have={have} full={full} onAdd={add} />}
      {params === null ? (
        <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>{slot.kind === 'au' && !desktop ? 'Audio Unit parameters are listed in the desktop app.' : 'Reading its parameters…'}</span>
      ) : !params.length ? (
        <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>It has no parameters to pick.</span>
      ) : (
        <>
          <input aria-label="Filter parameters" placeholder={`Pick from ${params.length} parameters`} value={q} onChange={e => setQ(e.target.value)}
            style={{ height: 28, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
            {shown.map(p => (
              <button key={p.address} type="button" disabled={full} onClick={() => add(p)} title={full ? `Up to ${RACK_CONTROLS_MAX}` : `Add ${p.name}`}
                style={{ border: 0, borderRadius: radius.sm, padding: '4px 8px', background: tk.bg.field, color: tk.text.secondary, font: `11.5px ${fontFamily.ui}`, cursor: full ? 'default' : 'pointer', opacity: full ? 0.5 : 1 }}>+ {p.name}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Watching the plug-in's window: what moved there lately, offered to add. */
function WindowWatch({ rack, slot, have, full, onAdd }: { rack: AeRack; slot: AeSlot; have: Set<string>; full: boolean; onAdd: (p: AuParam) => void }) {
  const tk = useTokens();
  const [offers, setOffers] = useState<Array<{ p: AuParam; live: boolean }>>([]);
  const [heard, setHeard] = useState(false);
  const [since] = useState(() => performance.now());
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    const w = new ParamWatch();
    let on = true;
    const tick = async () => {
      const list = await audioEngineHost.readParams(rack.id, slot.id);
      if (!on || !list) return;
      const now = performance.now();
      w.push(new Map(list.map(p => [p.address, p.value])), now);
      const byAddr = new Map(list.map(p => [p.address, p]));
      setOffers(w.offers(now).filter(o => byAddr.has(o.address)).map(o => ({ p: byAddr.get(o.address)!, live: o.live })));
      setHeard(w.heard());
      setQuiet(!w.heard() && now - since > 20000);
    };
    const id = setInterval(() => void tick(), WATCH_EVERY_MS);
    void tick();
    return () => { on = false; clearInterval(id); };
  }, [rack.id, slot.id, since]);
  const openWindow = async () => {
    const why = await audioEngineHost.openUi(rack.id, slot.id, `${rack.name} · ${aeSlotName(slot)}`);
    if (why) toast.error('The plug-in window didn’t open', { message: why });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', borderRadius: radius.sm, background: tk.bg.field }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tk.status.danger, animation: 'tapePulse 1.2s ease-in-out infinite' }} />
        <span style={{ flex: 1, color: tk.text.secondary, font: `11.5px ${fontFamily.ui}` }}>Move a control in the plug-in’s window to add it.</span>
        <Button size="sm" variant="ghost" icon="popout" onClick={() => void openWindow()}>Its window</Button>
      </div>
      {offers.map(({ p, live }) => (
        <div key={p.address} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0, color: live ? tk.text.primary : tk.text.muted, font: `${live ? 600 : 500} 12px ${fontFamily.ui}` }}>{p.name} <span style={{ color: tk.text.faint, font: `11px ${fontFamily.mono}` }}>{formatParam(p, p.value)}</span></span>
          {have.has(p.address)
            ? <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Added</span>
            : <Button size="sm" variant={live ? 'primary' : 'secondary'} disabled={full} onClick={() => onAdd(p)}>Add {p.name}</Button>}
        </div>
      ))}
      {!heard && quiet && <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Nothing reported yet: this plug-in may not tell the host about its window’s moves. Pick from the list below instead.</span>}
      <style>{'@keyframes tapePulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }'}</style>
    </div>
  );
}
