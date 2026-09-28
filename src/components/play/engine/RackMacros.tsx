/**
 * RackMacros — a rack's 8 Macro Controls in its device chain (docs/audio-
 * engine.md, "Macros"), like Ableton's: a strip of knobs, folded by default to
 * a one-line summary. Each knob turns any number of the rack's parameters,
 * each through its own range and curve (play/rackMacros.ts).
 *
 * A knob's ⋯: Rename, Colour, Map (the editor below the knobs: add targets
 * from the rack's configured controls, any parameter of its devices, or by
 * touching a control in the plug-in's window; per target a range, a curve
 * with a small preview, custom breakpoints, Detach as a control, Remove),
 * Learn (the next MIDI control maps onto the macro) and the + mini mapper.
 * The macro is a Play control ("Rack 1 · Macro 3"), so it maps, records and
 * shows on the Controls tab like a rack control.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { askText } from '../../ui/dialogStore';
import { toast } from '../../ui/toastStore';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import type { PlayRecord } from '../../../types/play';
import {
  AE_INST, MACRO_TARGETS_MAX, aeSlot, aeSlotName, macroPropId, rackMacros,
  type AeRack, type AeSlot, type MacroCurve, type RackMacro, type RackMacroTarget,
} from '../../../types/playAudioEngine';
import { audioEngineHost } from '../../../lib/audioEngineHost';
import { formatParam, type AuParam } from '../../../lib/audioEngineProtocol';
import { playEngine } from '../../../lib/playEngine';
import { midiEngine } from '../../../lib/midiEngine';
import { useTape } from '../../../lib/tape';
import type { TouchedParam } from '../../../lib/paramWatch';
import { rackControlsOf } from '../../../play/rackControls';
import {
  addMacroTarget, curvePreview, detachMacroTarget, ensureMacroControl, macroControl, macrosSummary, mcTargetValue, patchMacro, patchMacroTarget,
  removeMacroTarget, setMacroValue, type MacroParamInfo,
} from '../../../play/rackMacros';
import { TRACK_COLORS } from '../../../play/engineView';
import { MiniMapper } from '../MiniMapper';
import { wireSource } from '../miniMapperCore';
import { usePlayUi, deviceFoldKey } from '../playUi';
import { fmtGr, useSlotParams } from './RackControls';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/** The fold key of a rack's Macros strip (folded unless unfolded: the collapsed-by-default rule). */
export const MACROS_FOLD = 'macros';

const CURVE_OPTIONS: Array<{ value: MacroCurve; label: string }> = [
  { value: 'linear', label: 'Lin' }, { value: 'exp', label: 'Exp' }, { value: 'log', label: 'Log' }, { value: 'scurve', label: 'S' }, { value: 'custom', label: 'Custom' },
];

const round = (v: number) => Math.round(v * 1000) / 1000;

/** The Macros device: 8 knobs (folded: a summary), and the Map editor for the one being mapped. */
export function MacrosDevice({ rack, play, onChange, touch, narrow, color }: {
  rack: AeRack; play: PlayRecord; onChange: Change; touch: boolean; narrow: boolean; color?: string;
}) {
  const tk = useTokens();
  const key = deviceFoldKey(rack.id, MACROS_FOLD);
  const stored = usePlayUi(s => s.folded[key]);
  const toggleFold = usePlayUi(s => s.toggleFold);
  const folded = stored !== false;
  const macros = rackMacros(rack);
  const [mapping, setMapping] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [plus, setPlus] = useState<{ n: number; controlId: string } | null>(null);
  const [learning, setLearning] = useState<number | null>(null);
  const anchors = useRef<Array<HTMLElement | null>>([]);
  const plusAnchor = useRef<HTMLElement | null>(null);

  // Learn: the next MIDI control (or note, bend) becomes the macro's source.
  useEffect(() => {
    if (learning === null) return;
    void midiEngine.connectWebMidi({ retry: true });
    const n = learning;
    return playEngine.startLearn(source => {
      onChange(p => {
        const r = ensureMacroControl(p, rack.id, n);
        return r.control ? wireSource(r.play, source, { control: r.control.id }).play : p;
      });
      setLearning(null);
      toast.info(`Mapped onto ${macros[n - 1].name}`, { message: 'Tune it on the Mappings tab.' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learning, rack.id]);

  const openPlus = (n: number) => {
    const cur = useNodeGraphStore.getState().play;
    const r = ensureMacroControl(cur, rack.id, n);
    if (!r.control) return;
    if (r.play !== cur) onChange(() => r.play);
    plusAnchor.current = anchors.current[n - 1];
    setPlus({ n, controlId: r.control.id });
  };

  const openMenu = (n: number, x: number, y: number) => {
    const m = macros[n - 1];
    const ctl = macroControl(play, rack.id, n);
    setMenu({
      x, y, items: [
        { heading: m.name },
        { label: 'Map…', icon: 'link', hint: `${m.targets.length} of up to ${MACRO_TARGETS_MAX} parameters`, onSelect: () => setMapping(n) },
        { label: 'Learn (MIDI)', icon: 'piano', hint: 'Move a knob on your controller', onSelect: () => setLearning(n) },
        { label: 'Map a source…', icon: 'plus', hint: 'MIDI, an LFO, audio, a layer…', onSelect: () => openPlus(n) },
        'separator',
        { label: 'Rename…', icon: 'edit', onSelect: async () => { const name = await askText('Rename macro', { initial: m.name, confirmLabel: 'Rename' }); if (name) onChange(p => patchMacro(p, rack.id, n, { name })); } },
        { heading: 'Colour' },
        ...TRACK_COLORS.map(c => ({ label: c === m.color ? 'This colour' : 'Colour', icon: 'starF' as const, iconColor: c, onSelect: () => onChange(p => patchMacro(p, rack.id, n, { color: c })) })),
        ...(m.color ? [{ label: 'No colour', icon: 'close' as const, onSelect: () => onChange(p => patchMacro(p, rack.id, n, { color: '' })) }] : []),
        'separator',
        { label: 'On the Controls tab', icon: 'sliders', disabled: !ctl, onSelect: () => usePlayUi.getState().revealControlGroup(`${rack.name} · Macros`) },
      ],
    });
  };

  const used = macros.filter(m => m.targets.length).length;
  return (
    <section aria-label={`${rack.name}’s macros`} style={{ flex: `0 0 ${folded ? 200 : narrow ? 320 : 360}px`, width: folded ? 200 : narrow ? 320 : 360, maxWidth: narrow ? 'calc(100vw - 48px)' : undefined, minHeight: 0, maxHeight: '100%', display: 'flex', flexDirection: 'column', borderRadius: radius.md, background: tk.bg.panel,
      boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
      {color && <span aria-hidden style={{ height: 3, flexShrink: 0, background: color }} />}
      <header style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 6px 6px 8px', borderBottom: folded ? undefined : `1px solid ${tk.border.subtle}`, minWidth: 0 }}>
        <IconButton icon={folded ? 'chevR' : 'chevD'} size="sm" label={folded ? 'Show the macros' : 'Fold to a summary'} onClick={() => toggleFold(key, !folded)} />
        <Icon name="sliders" size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />
        <b onDoubleClick={() => toggleFold(key, !folded)} style={{ flex: folded ? '0 0 auto' : 1, font: `650 12px ${fontFamily.ui}`, color: tk.text.primary, cursor: 'pointer' }}>Macros</b>
        {folded && <span title={macrosSummary(rack)} style={{ flex: 1, minWidth: 0, color: tk.text.faint, font: `10.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{macrosSummary(rack)}</span>}
        {!folded && <span style={{ color: tk.text.faint, font: `10.5px ${fontFamily.ui}` }}>{used} in use</span>}
      </header>
      {folded && (
        // Folded: the 8 values as small bars, so the strip still reads at a glance.
        <div aria-hidden style={{ display: 'flex', gap: 3, padding: '0 8px 8px' }}>
          {macros.map(m => <span key={m.id} title={`${m.name}: ${Math.round(m.value * 100)}%`} style={{ flex: 1, height: 4, borderRadius: 2, background: tk.bg.field, overflow: 'hidden', opacity: m.targets.length ? 1 : 0.45 }}>
            <span style={{ display: 'block', height: '100%', width: `${m.value * 100}%`, background: m.color ?? tk.accent.base }} />
          </span>)}
        </div>
      )}
      {!folded && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 9px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {macros.map((m, i) => (
              <MacroKnob key={m.id} rack={rack} n={i + 1} macro={m} touch={touch} selected={mapping === i + 1} learning={learning === i + 1}
                mapped={!!macroControl(play, rack.id, i + 1) && play.mappings.some(x => x.enabled && x.controlId === macroControl(play, rack.id, i + 1)?.id)}
                anchor={el => { anchors.current[i] = el; }}
                onSet={v => {
                  for (const t of m.targets) if (aeSlot(rack, t.slot)?.kind === 'au') audioEngineHost.setParamNow(rack.id, t.slot, t.address, mcTargetValue(v, t));
                  onChange(p => setMacroValue(p, rack.id, i + 1, v));
                }}
                onMenu={(x, y) => openMenu(i + 1, x, y)} onPlus={() => openPlus(i + 1)} onSelect={() => setMapping(mapping === i + 1 ? null : i + 1)} />
            ))}
          </div>
          {learning !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: radius.sm, background: alpha(tk.accent.base, 0.1) }}>
              <Icon name="piano" size={13} style={{ color: tk.accent.text }} />
              <span style={{ flex: 1, color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>Move a knob, fader or key on your MIDI device to map it onto {macros[learning - 1].name}…</span>
              <Button size="sm" variant="ghost" onClick={() => setLearning(null)}>Cancel</Button>
            </div>
          )}
          {mapping !== null
            ? <MacroMapEditor rack={rack} n={mapping} play={play} onChange={onChange} onClose={() => setMapping(null)} />
            : <span style={{ color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>Click a macro’s name to map it onto this rack’s parameters; its ⋯ has Learn, + and more. Map a MIDI knob or an LFO onto the macro to turn them all at once.</span>}
        </div>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {plus && <MiniMapper anchorRef={plusAnchor} target={{ control: plus.controlId }} label={macroLabel(rack, plus.n)} onClose={() => setPlus(null)} />}
    </section>
  );
}

const macroLabel = (rack: AeRack, n: number) => `${rack.name} · ${rackMacros(rack)[n - 1].name}`;

/** One macro: a knob (drag up and down, arrow keys; double-click for 0), its name (click to map it), ⋯ and +. */
function MacroKnob({ rack, n, macro, touch, selected, learning, mapped, anchor, onSet, onMenu, onPlus, onSelect }: {
  rack: AeRack; n: number; macro: RackMacro; touch: boolean; selected: boolean; learning: boolean; mapped: boolean;
  anchor: (el: HTMLElement | null) => void; onSet: (v: number) => void; onMenu: (x: number, y: number) => void; onPlus: () => void; onSelect: () => void;
}) {
  const tk = useTokens();
  const size = touch ? 50 : 42;
  const col = macro.color ?? tk.accent.base;
  const drag = useRef<{ y: number; v: number } | null>(null);
  const liveRef = useRef<SVGCircleElement>(null);
  const running = useTape(s => s.phase !== 'stopped');
  // A driven macro (a mapping, the tape): a dot rides the ring where it's driven, on its own animation frame.
  useEffect(() => {
    const dot = liveRef.current;
    if (!dot) return;
    const place = () => {
      const v = playEngine.layerValue(macroPropId(rack.id), String(n), Number.NaN);
      if (Number.isNaN(v)) { dot.style.opacity = '0'; return; }
      const [x, y] = knobPoint(Math.max(0, Math.min(1, v)), size);
      dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y));
      dot.style.opacity = '1';
    };
    place();
    if (!running && !mapped) return;
    let raf = 0;
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, mapped, rack.id, n, size]);
  const down = (e: RPointerEvent<SVGSVGElement>) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, v: macro.value }; };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return;
    const next = Math.max(0, Math.min(1, d.v + (d.y - e.clientY) / (e.shiftKey ? 600 : 150)));
    if (next !== macro.value) onSet(round(next));
  };
  const [x, y] = knobPoint(macro.value, size);
  return (
    <div ref={anchor} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 2px', borderRadius: radius.sm,
      background: selected ? alpha(col, 0.12) : learning ? alpha(tk.accent.base, 0.18) : 'transparent', boxShadow: selected ? `inset 0 0 0 1px ${alpha(col, 0.5)}` : undefined }}>
      <svg width={size} height={size} role="slider" tabIndex={0} aria-label={macro.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(macro.value * 100)}
        onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onDoubleClick={() => onSet(0)}
        onKeyDown={e => {
          const d = e.shiftKey ? 0.1 : 0.01;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); onSet(round(Math.min(1, macro.value + d))); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); onSet(round(Math.max(0, macro.value - d))); }
        }}
        style={{ cursor: 'ns-resize', touchAction: 'none', opacity: macro.targets.length ? 1 : 0.55 }}>
        <path d={arcPath(0, 1, size)} fill="none" stroke={tk.bg.field} strokeWidth={4} strokeLinecap="round" />
        {macro.value > 0.001 && <path d={arcPath(0, macro.value, size)} fill="none" stroke={col} strokeWidth={4} strokeLinecap="round" />}
        <line x1={size / 2} y1={size / 2} x2={x} y2={y} stroke={tk.text.primary} strokeWidth={2} strokeLinecap="round" />
        <circle ref={liveRef} r={3} fill={tk.status.warning} style={{ opacity: 0 }} />
      </svg>
      <span style={{ font: `10px ${fontFamily.mono}`, color: tk.text.muted }}>{Math.round(macro.value * 100)}%</span>
      <button type="button" onClick={onSelect} title={`${macro.name}: ${macro.targets.length ? macro.targets.map(t => t.name ?? t.address).join(', ') : 'nothing mapped yet'} (click to map)`}
        style={{ maxWidth: '100%', border: 0, padding: 0, background: 'none', color: macro.targets.length ? tk.text.primary : tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{macro.name}</button>
      <div style={{ display: 'flex', gap: 0 }}>
        <IconButton icon="plus" size="sm" label={`Map a source onto ${macro.name} (MIDI, an LFO, audio…)`} onClick={onPlus} />
        <IconButton icon="more" size="sm" label={`${macro.name}: map, learn, rename, colour`} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu(r.left, r.bottom + 2); }} />
      </div>
    </div>
  );
}

/** A point on the knob's ring (270°, from 7:30 to 4:30) for a value 0..1. */
function knobPoint(v: number, size: number): [number, number] {
  const a = (135 + v * 270) * (Math.PI / 180), r = size / 2 - 4;
  return [size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r];
}
function arcPath(from: number, to: number, size: number): string {
  const [x0, y0] = knobPoint(from, size), [x1, y1] = knobPoint(to, size), r = size / 2 - 4;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${(to - from) * 270 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

// ── Map ─────────────────────────────────────────────────────────────────────

/** One macro's targets: range, curve, Detach, Remove; and adding more. */
function MacroMapEditor({ rack, n, play, onChange, onClose }: { rack: AeRack; n: number; play: PlayRecord; onChange: Change; onClose: () => void }) {
  const tk = useTokens();
  const m = rackMacros(rack)[n - 1];
  const full = m.targets.length >= MACRO_TARGETS_MAX;
  const slots = [rack.instrument, ...rack.effects].filter((s): s is AeSlot => !!s && (s.kind === 'au' || s.kind === 'granulator'));
  const has = (slot: string, address: string) => m.targets.some(t => t.slot === slot && t.address === address);
  const add = (p: MacroParamInfo) => {
    if (full) { toast.error(`Up to ${MACRO_TARGETS_MAX} parameters on a macro`); return; }
    onChange(pr => addMacroTarget(pr, rack.id, n, p));
  };
  // The rack's configured controls: the quick picks.
  const configured = slots.flatMap(s => rackControlsOf(play, rack, s).map(({ address, control }) => ({ slot: s, address, label: control.label, lo: control.min, hi: control.max })));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 8px 8px 10px', borderRadius: radius.md, boxShadow: `inset 0 0 0 1.5px ${m.color ?? tk.accent.base}`, background: alpha(m.color ?? tk.accent.base, 0.04) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <b style={{ flex: 1, font: `650 12px ${fontFamily.ui}`, color: tk.text.primary }}>Map {m.name} · {m.targets.length} of {MACRO_TARGETS_MAX}</b>
        <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>
      {!m.targets.length && <span style={{ color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>Pick parameters below: turning {m.name} then turns each between its low and high end, through its curve.</span>}
      {m.targets.map((t, i) => <TargetRow key={`${t.slot}/${t.address}`} rack={rack} n={n} index={i} target={t} macroValue={m.value} onChange={onChange} />)}
      {configured.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Configured controls</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {configured.map(c => {
              const on = has(c.slot.id, c.address);
              return <Chip key={`${c.slot.id}/${c.address}`} disabled={on || full} title={on ? 'Already on this macro' : `${aeSlotName(c.slot)} · ${c.label}`}
                onClick={() => add({ slot: c.slot.id, address: c.address, name: c.label, lo: c.lo, hi: c.hi })}>{on ? '✓' : '+'} {c.label}</Chip>;
            })}
          </div>
        </div>
      )}
      {slots.map(s => <SlotParamPicker key={s.id} rack={rack} slot={s} has={a => has(s.id, a)} full={full} onAdd={add} />)}
      {!slots.length && <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>This rack has nothing a macro can turn yet: add an instrument or an Audio Unit effect.</span>}
    </div>
  );
}

function Chip({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  const tk = useTokens();
  return <button type="button" disabled={disabled} onClick={onClick} title={title}
    style={{ border: 0, borderRadius: radius.sm, padding: '4px 8px', background: tk.bg.field, color: tk.text.secondary, font: `11.5px ${fontFamily.ui}`, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>{children}</button>;
}

/** One device's parameters to add (filterable), and on an Audio Unit in the desktop app, touch to add. */
function SlotParamPicker({ rack, slot, has, full, onAdd }: { rack: AeRack; slot: AeSlot; has: (address: string) => boolean; full: boolean; onAdd: (p: MacroParamInfo) => void }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [watching, setWatching] = useState(false);
  const params = useSlotParams(rack, slot);
  const desktop = audioEngineHost.native();
  const onAddRef = useRef(onAdd);
  useEffect(() => { onAddRef.current = onAdd; });
  // Touch a control in the plug-in to add it (the same watch Configure uses).
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    let stop: (() => void) | null = null;
    const seen = new Set<string>();
    void (async () => {
      const why = await audioEngineHost.openUi(rack.id, slot.id, `${rack.name} · ${aeSlotName(slot)}`);
      if (why && alive) toast.error('The plug-in window didn’t open', { message: why });
      const r = await audioEngineHost.watchTouches(rack.id, slot.id, (t: TouchedParam) => {
        if (!alive || seen.has(t.param.address)) return;
        seen.add(t.param.address);
        onAddRef.current({ slot: slot.id, address: t.param.address, name: t.param.name, lo: t.param.min, hi: t.param.max, value: t.param.value });
      });
      if (typeof r === 'string') { if (alive) { toast.error('Couldn’t watch the plug-in', { message: r }); setWatching(false); } return; }
      if (alive) stop = r; else r();
    })();
    return () => { alive = false; stop?.(); };
  }, [watching, rack.id, slot.id]);
  const shown = (params ?? []).filter(p => !has(p.address) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  const info = (p: AuParam): MacroParamInfo => ({ slot: slot.id, address: p.address, name: p.name, lo: p.min, hi: p.max, value: p.value });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(!open)} style={{ border: 0, padding: 0, background: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer' }}>
          <Icon name={open ? 'chevD' : 'chevR'} size={12} />{aeSlotName(slot)}’s parameters
        </button>
        <span style={{ flex: 1 }} />
        {desktop && slot.kind === 'au' && (
          <Button size="sm" variant={watching ? 'primary' : 'ghost'} icon="target" onClick={() => setWatching(!watching)}>{watching ? 'Watching… Done' : 'Touch to add'}</Button>
        )}
      </div>
      {watching && <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}` }}>Touch a control in the plug-in to add it to this macro.</span>}
      {open && (params === null
        ? <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}` }}>{slot.kind === 'au' && !desktop ? 'Audio Unit parameters are listed in the desktop app.' : 'Reading its parameters…'}</span>
        : (
          <>
            <input aria-label={`Filter ${aeSlotName(slot)}’s parameters`} placeholder={`Filter ${params.length} parameters`} value={q} onChange={e => setQ(e.target.value)}
              style={{ height: 26, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
              {shown.map(p => <Chip key={p.address} disabled={full} onClick={() => onAdd(info(p))} title={`Add ${p.name}`}>+ {p.name}</Chip>)}
            </div>
          </>
        ))}
    </div>
  );
}

/** One target: its name, its low and high end (typing past the parameter's range is kept), its curve with a preview, Detach and Remove. */
function TargetRow({ rack, n, index, target, macroValue, onChange }: { rack: AeRack; n: number; index: number; target: RackMacroTarget; macroValue: number; onChange: Change }) {
  const tk = useTokens();
  const slot = aeSlot(rack, target.slot);
  const params = useSlotParamsMaybe(rack, slot);
  const p = params?.find(x => x.address === target.address);
  const fmt = (v: number) => (p ? formatParam(p, v) : slot?.kind === 'granulator' ? fmtGr(target.address, v) : String(round(v)));
  const patch = (o: Partial<Pick<RackMacroTarget, 'min' | 'max' | 'curve' | 'points'>>) => onChange(pr => patchMacroTarget(pr, rack.id, n, index, o));
  const field = { width: 70, height: 24, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' as const };
  const inverted = target.min > target.max;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 6px 6px 8px', borderRadius: radius.sm, background: tk.bg.field }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, minWidth: 0, color: tk.text.primary, font: `600 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {target.name ?? `Parameter ${target.address}`} <span style={{ color: tk.text.faint, fontWeight: 400 }}>· {slot ? aeSlotName(slot) : 'gone'}</span>
        </span>
        <span title="Its value now" style={{ color: tk.text.muted, font: `10.5px ${fontFamily.mono}` }}>{fmt(mcTargetValue(macroValue, target))}</span>
        <IconButton icon="unlink" size="sm" label="Detach as a control (a rack control on its device again)" onClick={() => onChange(pr => {
          const r = detachMacroTarget(pr, rack.id, n, index);
          if (!r.ok) toast.error('Its device already has 8 rack controls', { message: 'Remove one in Configure first.' });
          return r.record;
        })} />
        <IconButton icon="close" size="sm" label="Remove from this macro (the parameter stays where it is)" onClick={() => onChange(pr => removeMacroTarget(pr, rack.id, n, index))} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Range</span>
        <NumberInput value={round(target.min)} title="At 0 (type past the parameter’s range to go further)" onCommit={v => patch({ min: v })} style={field} />
        <span style={{ color: tk.text.faint }}>→</span>
        <NumberInput value={round(target.max)} title="At 100% (lower than the start inverts it)" onCommit={v => patch({ max: v })} style={field} />
        <IconButton icon="bidir" size="sm" active={inverted} label={inverted ? 'Inverted: turn it the right way round' : 'Invert (swap the ends)'} onClick={() => patch({ min: target.max, max: target.min })} />
        {target.lo !== undefined && target.hi !== undefined && (
          <button type="button" onClick={() => patch({ min: target.lo!, max: target.hi! })} title={`The parameter’s whole range: ${fmt(target.lo)} → ${fmt(target.hi)}`}
            style={{ border: 0, padding: 0, background: 'none', color: tk.text.faint, font: `10.5px ${fontFamily.ui}`, textDecoration: 'underline', cursor: 'pointer' }}>Full</button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Segmented size="sm" ariaLabel="Curve" value={target.curve} options={CURVE_OPTIONS} onChange={v => patch({ curve: v })} />
        <CurvePreview curve={target.curve} points={target.points} at={macroValue} inverted={inverted}
          onPoints={target.curve === 'custom' ? pts => patch({ points: pts }) : undefined} />
      </div>
    </div>
  );
}

/** useSlotParams, for a slot that may be gone. */
function useSlotParamsMaybe(rack: AeRack, slot: AeSlot | undefined): AuParam[] | null {
  const stand = useMemo<AeSlot>(() => slot ?? { id: AE_INST, kind: 'sampler' }, [slot]);
  return useSlotParams(rack, stand);
}

/**
 * The curve, small: x the macro, y the parameter (low to high; drawn flipped
 * when inverted), a dot where the macro is. A custom curve's breakpoints are
 * editable here: click to add one, drag one, double-click one to remove it.
 */
function CurvePreview({ curve, points, at, inverted, onPoints }: { curve: MacroCurve; points?: number[]; at: number; inverted: boolean; onPoints?: (pts: number[]) => void }) {
  const tk = useTokens();
  const W = onPoints ? 120 : 64, H = onPoints ? 64 : 30, P = 3;
  const box = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const line = curvePreview(curve, points, 32);
  const X = (x: number) => P + x * (W - 2 * P), Y = (y: number) => H - P - (inverted ? 1 - y : y) * (H - 2 * P);
  const d = line.map(([x, y], i) => `${i ? 'L' : 'M'} ${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(' ');
  const cur = line.length ? curvePreview(curve, points, 1000)[Math.round(Math.max(0, Math.min(1, at)) * 1000)] : [0, 0];
  const pts: Array<[number, number]> = [];
  if (points) for (let i = 0; i + 1 < points.length; i += 2) pts.push([points[i], points[i + 1]]);
  const toUnit = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left - P) / (r.width - 2 * P)));
    let y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top - P) / (r.height - 2 * P)));
    if (inverted) y = 1 - y;
    return [round(x), round(y)];
  };
  const commit = (list: Array<[number, number]>) => onPoints?.([...list].sort((a, b) => a[0] - b[0]).flat());
  return (
    <svg ref={box} width={W} height={H} role="img" aria-label={`${curve} curve`}
      onPointerDown={e => {
        if (!onPoints) return;
        const [x, y] = toUnit(e);
        const hit = pts.findIndex(([px, py]) => Math.abs(px - x) < 0.08 && Math.abs(py - y) < 0.15);
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        if (hit >= 0) { dragging.current = hit; return; }
        if (pts.length >= 16) return;
        const next = [...pts, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]);
        dragging.current = next.findIndex(q => q[0] === x && q[1] === y);
        commit(next);
      }}
      onPointerMove={e => {
        const i = dragging.current;
        if (i === null || !onPoints || !(e.buttons & 1)) return;
        const [x, y] = toUnit(e);
        const next = pts.map((q, j) => (j === i ? [x, y] as [number, number] : q));
        commit(next);
      }}
      onPointerUp={() => { dragging.current = null; }}
      onDoubleClick={e => {
        if (!onPoints || pts.length <= 2) return;
        const [x, y] = toUnit(e);
        const hit = pts.findIndex(([px, py]) => Math.abs(px - x) < 0.08 && Math.abs(py - y) < 0.15);
        if (hit >= 0) commit(pts.filter((_, j) => j !== hit));
      }}
      style={{ flexShrink: 0, borderRadius: 4, background: tk.bg.panel, cursor: onPoints ? 'crosshair' : 'default', touchAction: 'none' }}>
      <path d={d} fill="none" stroke={tk.accent.base} strokeWidth={1.6} />
      {onPoints && pts.map(([x, y], i) => <circle key={i} cx={X(x)} cy={Y(y)} r={3.2} fill={tk.bg.panel} stroke={tk.text.primary} strokeWidth={1.3} />)}
      <circle cx={X(cur[0])} cy={Y(cur[1])} r={2.6} fill={tk.status.warning} />
    </svg>
  );
}
