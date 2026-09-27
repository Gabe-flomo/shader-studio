/**
 * ConditionFields — the editor for a condition on any value ("When a value…"
 * triggers, and a pair mapping axis's "only while"): which value (a control,
 * a layer's or a Finish number, a mapping's source, the pointer, or a
 * distance between two things), how it compares (below, above, crosses,
 * equals), the threshold, the hysteresis, and a live meter of the value
 * against the threshold.
 *
 * Also the signal pieces: SignalPicker (pick or make one) and SignalsList
 * (make, rename, fire and delete a setup's signals).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { playEngine } from '../../lib/playEngine';
import { sgParseValueRef, sgScreenPoint } from '../../play/kit/signals.js';
import { COND_LABELS, anchorOptions, valueRefLabel, type LabelContext } from '../../play/playSources';
import { addSignal, deleteSignal, renameSignal, signalUses } from '../../play/pairs';
import { layerNumericProps, parseHandAnchor, type CondCmp, type PlayRecord, type ValueCondition } from '../../types/play';
import { finishHost, finishHostLabel, finishHosts, finishNumericProps, finishParamOf } from '../../types/playFinish';
import { GroupedPicker } from '../ui/GroupedPicker';
import type { PickerSection } from '../ui/groupedPickerModel';
import { sectionsFromOptions } from '../ui/groupedPickerModel';
import { HAND_POINT_SECTIONS } from './sourcePickerSections';
import { Segmented } from '../ui/Choice';
import { NumberInput } from '../NodeGraph/NumberInput';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';

// ── Values ───────────────────────────────────────────────────────────────────

const DIST = 'dist:';

/** The value picker's sections for a setup: controls, layers' numbers, Finish numbers, mappings' sources, the pointer, a distance. */
export function valueSections(play: PlayRecord): PickerSection[] {
  const out: PickerSection[] = [];
  const ctx = labelContext(play);
  const floats = play.controls.filter(c => c.kind !== 'action');
  if (floats.length) out.push({ heading: 'Controls', items: floats.map(c => ({ value: `ctl:${c.id}`, label: c.label, icon: 'sliders' as const, description: `${c.min} to ${c.max}` })) });
  const layerItems = play.layers.flatMap(l => layerNumericProps(l).map(d => ({ value: `layer:${l.id}::${d.key}`, label: `${l.label} · ${d.label}`, icon: 'layoutCanvas' as const, keywords: l.kind })));
  if (layerItems.length) out.push({ heading: 'Layers', items: layerItems });
  const finishItems = finishHosts(play.finish).flatMap(e => finishNumericProps(e).map(d => ({ value: `finish:${e.id}::${d.key}`, label: `${finishHostLabel(e)} · ${d.label}`, icon: 'spark' as const, keywords: 'finish' })));
  if (finishItems.length) out.push({ heading: 'Finish', items: finishItems });
  if (play.mappings.length) out.push({ heading: 'Mapping sources', items: play.mappings.map(m => ({ value: `map:${m.id}`, label: valueRefLabel(`map:${m.id}`, ctx), icon: 'bidir' as const, description: 'What it reads, 0 to 1' })) });
  out.push({ heading: 'Pointer & distance', items: [
    { value: 'mouse:x', label: 'Mouse X', icon: 'mouse', description: '0 to 1 across the picture' },
    { value: 'mouse:y', label: 'Mouse Y', icon: 'mouse', description: '0 to 1 up the picture' },
    { value: DIST, label: 'Distance between two things', icon: 'bidir', description: 'Layers, nulls, hands, the pointer or a point', keywords: 'proximity near far' },
  ] });
  return out;
}

/** What labels need from the setup. */
export function labelContext(play: PlayRecord): LabelContext {
  return { layers: play.layers, controls: play.controls, signals: play.signals, mappings: play.mappings, finish: play.finish };
}

/** A value's natural range, for the threshold ruler and the meter. */
export function valueRange(ref: string, play: PlayRecord): { min: number; max: number; step: number } {
  const r = sgParseValueRef(ref);
  if (r?.kind === 'control') { const c = play.controls.find(x => x.id === r.id); if (c && c.max > c.min) return { min: c.min, max: c.max, step: c.step ?? 0.01 }; }
  if (r?.kind === 'prop') {
    if (r.layerId.startsWith('finish:')) {
      const e = finishHost(play.finish, r.layerId.slice(7));
      const d = e && finishParamOf(e, r.key);
      if (d && d.max > d.min) return { min: d.min, max: d.max, step: d.step ?? 0.01 };
    } else {
      const l = play.layers.find(x => x.id === r.layerId);
      const d = l && layerNumericProps(l).find(x => x.key === r.key);
      if (d && d.max > d.min) return { min: d.min, max: d.max, step: d.step ?? 0.01 };
    }
  }
  return { min: 0, max: 1, step: 0.01 };
}

/** The value a condition reads, and whether it is met, polled while shown. */
function useConditionNow(c: ValueCondition, isOpen: () => boolean): { v: number | null; open: boolean } {
  const [now, setNow] = useState<{ v: number | null; open: boolean }>({ v: null, open: false });
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 60) return;
      last = ms;
      const x = playEngine.readValue(c.value);
      const v = x === null ? null : Math.round(x * 1000) / 1000;
      const open = isOpen();
      setNow(p => (p.v === v && p.open === open ? p : { v, open }));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [c, isOpen]);
  return now;
}

/** A layer, a hand, the pointer or a point on the picture (x, y), for one end of a distance. */
export function DistanceAnchorPicker({ value, layers, exclude, ariaLabel, onChange }: {
  value: string;
  layers: ReadonlyArray<{ id: string; label: string; kind: string }>;
  exclude?: string;
  ariaLabel: string;
  onChange: (ref: string) => void;
}) {
  const tk = useTokens();
  const pt = sgScreenPoint(value);
  const hand = parseHandAnchor(value);
  const sections = useMemo(() => [
    { heading: 'Pointer & picture', items: [
      { value: 'mouse', label: 'Mouse', icon: 'mouse' as const, description: 'The pointer over the picture' },
      { value: 'pt', label: 'A point on the picture', icon: 'target' as const, description: 'X and Y, 0 to 1 (Y up)' },
    ] },
    ...sectionsFromOptions(anchorOptions(layers, exclude)),
  ], [layers, exclude]);
  const pick = pt ? 'pt' : hand ? `hand:${hand.side}` : value;
  const num = { width: 44, height: 24, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' as const };
  return (
    <span style={{ display: 'inline-flex', gap: 4, minWidth: 0, flexWrap: 'wrap', alignItems: 'center' }}>
      <GroupedPicker ariaLabel={ariaLabel} value={pick} placeholder="Pick one" sections={sections} height={26} style={{ maxWidth: 170 }} width={240}
        onChange={v => onChange(v === 'pt' ? 'pt:0.5,0.5' : v.startsWith('hand:') ? `${v}:${hand?.point ?? 8}` : v)} />
      {hand && <GroupedPicker ariaLabel={`${ariaLabel}: point on the hand`} value={`${hand.point}`} sections={HAND_POINT_SECTIONS} onChange={v => onChange(`hand:${hand.side}:${parseInt(v, 10) || 0}`)} height={26} style={{ maxWidth: 150 }} width={220} searchPlaceholder="Search points" />}
      {pt && <>
        <NumberInput value={pt.x} min={0} max={1} step={0.05} title="X, 0 left to 1 right" onCommit={n => onChange(`pt:${round(n)},${pt.y}`)} style={num} />
        <NumberInput value={pt.y} min={0} max={1} step={0.05} title="Y, 0 bottom to 1 top" onCommit={n => onChange(`pt:${pt.x},${round(n)}`)} style={num} />
      </>}
    </span>
  );
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** The comparisons offered: all five for a trigger; the held ones (no crossings) for "only while". */
function cmpOptions(crossings: boolean) {
  const all: CondCmp[] = crossings ? ['below', 'above', 'crossUp', 'crossDown', 'equals'] : ['below', 'above', 'equals'];
  return all.map(v => ({ value: v, label: COND_LABELS[v].label, title: COND_LABELS[v].title }));
}

/**
 * The fields of a condition, in a bordered block on its own line. `isOpen`
 * says whether the engine sees it met (for the status dot); `crossings`
 * offers Crosses ↑ / ↓ (a trigger's taps).
 */
export function ConditionFields({ cond: c, isOpen, crossings = true, onChange }: {
  cond: ValueCondition;
  isOpen: () => boolean;
  crossings?: boolean;
  onChange: (c: ValueCondition) => void;
}) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const sections = useMemo(() => valueSections(play), [play]);
  const ref = sgParseValueRef(c.value);
  const dist = ref?.kind === 'distance' ? ref : null;
  const range = useMemo(() => (dist ? { min: 0, max: 1, step: 0.01 } : valueRange(c.value, play)), [c.value, dist, play]);
  const now = useConditionNow(c, isOpen);
  const layerRefs = play.layers;
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 58, flexShrink: 0 };
  const line: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 };
  const small = { width: 48, height: 22, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' as const };
  const span = range.max - range.min || 1;
  const pct = (v: number) => `${Math.max(0, Math.min(1, (v - range.min) / span)) * 100}%`;
  // The band where it is met, and the lighter strip it holds through (the hysteresis).
  const th = c.threshold, h = c.hysteresis;
  const below = c.cmp === 'below' || c.cmp === 'crossDown', equals = c.cmp === 'equals';
  const band: [number, number] = equals ? [th - c.tolerance, th + c.tolerance] : below ? [range.min, th] : [th, range.max];
  const hold: [number, number] = equals ? [th - c.tolerance - h, th + c.tolerance + h] : below ? [th, th + h] : [th - h, th];
  const crossing = c.cmp === 'crossUp' || c.cmp === 'crossDown';
  const state = now.v === null ? 'No value yet' : crossing ? (now.open ? 'Past it: fires on the next crossing back and over' : 'Waiting for it to cross') : now.open ? 'Met: firing' : 'Not met';
  return (
    <div style={{ order: 1, flexBasis: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2, padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.text.primary, 0.03), boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      <div style={line}>
        <span style={cap}>Value</span>
        <GroupedPicker ariaLabel="Value" value={dist ? DIST : c.value} placeholder="Pick a value" sections={sections} height={26} style={{ flex: 1, minWidth: 120, maxWidth: 260 }} width={300} searchPlaceholder="Search values"
          onChange={v => {
            if (v === DIST) { if (!dist) { const first = play.layers.find(l => l.kind === 'null')?.id ?? 'mouse'; onChange({ ...c, value: `dist:${first}|pt:0.5,0.5`, threshold: 0.15, hysteresis: 0.03 }); } return; }
            const r = valueRange(v, play);
            // A new value starts with its threshold in the middle of its range.
            onChange({ ...c, value: v, threshold: round(r.min + (r.max - r.min) / 2), hysteresis: round((r.max - r.min) * 0.05), tolerance: round((r.max - r.min) * 0.02) });
          }} />
      </div>
      {dist && <>
        <div style={line}><span style={cap}>From</span><DistanceAnchorPicker value={dist.a} layers={layerRefs} exclude={dist.b} ariaLabel="Distance from" onChange={a => onChange({ ...c, value: `dist:${a}|${dist.b}` })} /></div>
        <div style={line}><span style={cap}>To</span><DistanceAnchorPicker value={dist.b} layers={layerRefs} exclude={dist.a} ariaLabel="Distance to" onChange={b => onChange({ ...c, value: `dist:${dist.a}|${b}` })} /></div>
      </>}
      <div style={line}>
        <span style={cap}>When</span>
        <Segmented size="sm" ariaLabel="Comparison" value={c.cmp} options={cmpOptions(crossings)} onChange={cmp => onChange({ ...c, cmp })} wrap />
      </div>
      <div style={{ ...line, flexWrap: 'nowrap' }}>
        <span style={cap} title={dist ? 'In picture heights: 1 is the height of the picture' : undefined}>{equals ? 'Equals' : 'Threshold'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RulerSlider ariaLabel="Threshold" value={c.threshold} min={range.min} max={range.max} step={range.step} onChange={threshold => onChange({ ...c, threshold })} onType={threshold => onChange({ ...c, threshold })} />
        </div>
      </div>
      <div style={{ ...line, flexWrap: 'nowrap' }}>
        <span style={cap}>Now</span>
        <div role="meter" aria-label="Value now" aria-valuemin={range.min} aria-valuemax={range.max} aria-valuenow={now.v ?? undefined}
          title="The shaded part is where it is met; the lighter strip is how far past it holds before letting go"
          style={{ position: 'relative', flex: 1, minWidth: 60, height: 8, borderRadius: 4, background: tk.bg.field }}>
          <span style={{ position: 'absolute', top: 0, bottom: 0, left: pct(band[0]), width: `calc(${pct(band[1])} - ${pct(band[0])})`, borderRadius: 4, background: alpha(tk.accent.base, 0.28) }} />
          <span style={{ position: 'absolute', top: 0, bottom: 0, left: pct(Math.min(hold[0], hold[1])), width: `calc(${pct(Math.max(hold[0], hold[1]))} - ${pct(Math.min(hold[0], hold[1]))})`, background: alpha(tk.accent.base, 0.12) }} />
          {!equals && <span style={{ position: 'absolute', top: -2, bottom: -2, left: pct(th), width: 2, marginLeft: -1, background: tk.accent.base }} />}
          {now.v !== null && <span style={{
            position: 'absolute', top: '50%', left: pct(now.v), width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: 6,
            background: now.open ? tk.accent.base : tk.bg.panel, boxShadow: `0 0 0 1.5px ${now.open ? tk.accent.base : tk.text.muted}`, transition: 'left 60ms linear',
          }} />}
        </div>
        <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary, width: 44, textAlign: 'right', flexShrink: 0 }}>{now.v === null ? '–' : fmt(now.v)}</span>
      </div>
      <div style={{ ...line, justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: now.open ? tk.accent.text : tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: now.open ? tk.accent.base : tk.text.disabled }} />
          {state}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {equals && <>
            <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }} title="How close counts as equal">±</span>
            <NumberInput value={c.tolerance} min={0} step={range.step} title="How close counts as equal" onCommit={n => onChange({ ...c, tolerance: Math.max(0, n) })} style={small} />
          </>}
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }} title="It lets go only this far past the threshold, so it doesn't flicker at the edge">Hysteresis</span>
          <NumberInput value={c.hysteresis} min={0} step={range.step} title="How far back past the threshold it has to go to let go (or, for a crossing, to be ready again)" onCommit={n => onChange({ ...c, hysteresis: Math.max(0, n) })} style={small} />
        </span>
      </div>
    </div>
  );
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

// ── Signals ──────────────────────────────────────────────────────────────────

const NEW_SIGNAL = '__new';

/** Pick a signal, or make a new one right here. `none` offers "No signal" (an optional one). */
export function SignalPicker({ value, onChange, none, ariaLabel = 'Signal' }: { value: string; onChange: (id: string) => void; none?: string; ariaLabel?: string }) {
  const signals = useNodeGraphStore(s => s.play.signals) ?? NO_SIGNALS;
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const known = signals.some(s => s.id === value);
  const options = [
    ...(none !== undefined ? [{ value: '', label: none }] : !known ? [{ value, label: value ? 'Missing signal' : 'Pick one' }] : []),
    ...signals.map(s => ({ value: s.id, label: s.name })),
    { value: NEW_SIGNAL, label: '+ New signal' },
  ];
  return (
    <Select ariaLabel={ariaLabel} value={known || none !== undefined ? value : value} options={options} height={26} style={{ maxWidth: 170 }} onChange={v => {
      if (v !== NEW_SIGNAL) { onChange(v); return; }
      let made = '';
      setPlay(p => { const r = addSignal(p); made = r.id; return r.play; });
      if (made) onChange(made);
    }} />
  );
}
const NO_SIGNALS: NonNullable<PlayRecord['signals']> = [];

/** A setup's signals: add, rename, fire by hand (to try what listens), delete. Each flashes as it fires. */
export function SignalsList({ play, onChange }: { play: PlayRecord; onChange: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const tk = useTokens();
  const signals = play.signals ?? NO_SIGNALS;
  const [lit, setLit] = useState<Record<string, number>>({});
  useEffect(() => playEngine.onSignal(id => setLit(l => ({ ...l, [id]: (l[id] ?? 0) + 1 }))), []);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px' }}>
        <span style={{ font: `650 12.5px ${fontFamily.ui}` }}>Signals</span>
        {signals.length > 0 && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{signals.length}</span>}
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="plus" onClick={() => onChange(p => addSignal(p).play)}>Add signal</Button>
      </div>
      {signals.length === 0 && (
        <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '2px 2px 6px' }}>
          A signal is a named event: an action sends it (Do: Send a signal), and other actions and mappings fire on it (When: a signal fires). Chain them: the dot reaches the box, that sends Hit, Hit bursts the sparks and steps the text.
        </div>
      )}
      {signals.map(s => <SignalRow key={s.id} name={s.name} uses={signalUses(play, s.id)} flash={lit[s.id] ?? 0}
        onRename={name => onChange(p => renameSignal(p, s.id, name))}
        onFire={() => playEngine.fireSignal(s.id)}
        onRemove={() => onChange(p => deleteSignal(p, s.id))} />)}
    </div>
  );
}

function SignalRow({ name, uses, flash, onRename, onFire, onRemove }: { name: string; uses: number; flash: number; onRename: (n: string) => void; onFire: () => void; onRemove: () => void }) {
  const tk = useTokens();
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flash) return;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), 180);
    return () => window.clearTimeout(t);
  }, [flash]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '6px 8px 6px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${on ? tk.accent.base : tk.border.default}`, transition: 'box-shadow 0.15s' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: on ? tk.accent.base : tk.text.disabled, transition: 'background 0.15s' }} />
      <Field value={draft} aria-label="Signal name" onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim() && draft !== name) onRename(draft); else setDraft(name); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} height={26} style={{ flex: 1, minWidth: 0 }} />
      <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}`, whiteSpace: 'nowrap' }} title="Actions, mappings and swaps that send or listen for it">{uses === 0 ? 'unused' : `${uses} use${uses === 1 ? '' : 's'}`}</span>
      <IconButton icon="play" label="Fire it now: what listens for it runs" size="sm" onClick={onFire} />
      <IconButton icon="trash" label={uses ? 'Delete signal (what uses it stays, marked missing)' : 'Delete signal'} size="sm" tone="danger" onClick={onRemove} />
    </div>
  );
}
