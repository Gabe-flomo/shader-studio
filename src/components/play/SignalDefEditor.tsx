/**
 * SignalDefEditor — a rule's options on the Rules page: what it captures,
 * its timing and chance, and the loops its inputs make.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { playEngine } from '../../lib/playEngine';
import { CAPTURE_POS, SIGNAL_CHANCE_MIN, SIGNAL_TIME_MAX, layerNumericProps, type PlayLoop, type PlayRecord, type PlaySignal, type SignalCapture } from '../../types/play';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { NumberInput } from '../NodeGraph/NumberInput';
import { SG_LOOP_PULSES, sgLinkPlan, sgPulseLinks, sgShaped, type SgLoop } from '../../play/kit/signals.js';
import { GroupedPicker } from '../ui/GroupedPicker';
import { Menu } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import { DistanceAnchorPicker, valueSections } from './ConditionFields';
import { MapToMenu } from './MapToMenu';
import { moveLayerToSignal, setLoop } from './signalFlow';
import { Segmented, Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/** A signal's captured value, polled while shown ("3.2", "0.41, 0.66", or '' before the first capture). */
function usePayload(id: string): string {
  const [text, setText] = useState('');
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = playEngine.signalPayload(id);
      const r = (n: number) => `${Math.round(n * 100) / 100}`;
      const next = v === undefined ? '' : typeof v === 'number' ? r(v) : `${r(v.x)}, ${r(v.y)}`;
      setText(p => (p === next ? p : next));
    }, 120);
    return () => window.clearInterval(t);
  }, [id]);
  return text;
}

/**
 * What a signal takes with it (sample and hold): nothing, a number (any
 * value a condition can watch) or a position (a layer's centre, a hand's
 * pinch point, the pointer…), at its rise, its fall, or all the while it is
 * true. Then Set… sends a number to a control, and Move a layer here… sends
 * a position to a layer (both jump, and stay until the next capture).
 */
export function SignalCaptureEditor({ signal: s, play, onChange }: { signal: PlaySignal; play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const sections = useMemo(() => valueSections(play), [play]);
  const payload = usePayload(s.id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const c = s.capture;
  const kind = !c ? 'none' : c.what.startsWith(CAPTURE_POS) ? 'pos' : 'num';
  const set = (capture: SignalCapture | undefined) => onChange(p => ({ ...p, signals: (p.signals ?? []).map(x => { if (x.id !== s.id) return x; const n = { ...x }; if (capture) n.capture = capture; else delete n.capture; return n; }) }));
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' };
  const movable = play.layers.filter(l => layerNumericProps(l).some(d => d.key === 'x') && layerNumericProps(l).some(d => d.key === 'y'));
  return (
    <div data-signal-capture={s.id} style={{ marginTop: 8, padding: '0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={cap}>Takes</span>
        <Segmented size="sm" ariaLabel="What it captures" value={kind} onChange={k => {
          if (k === kind) return;
          if (k === 'none') set(undefined);
          else if (k === 'num') set({ what: play.controls[0] ? `ctl:${play.controls[0].id}` : 'mouse:x', at: c?.at ?? 'rise' });
          else set({ what: `${CAPTURE_POS}pointer`, at: c?.at ?? 'rise' });
        }} options={[
          { value: 'none', label: 'Nothing' },
          { value: 'num', label: 'A number', title: 'Sample a value (a slider, a layer’s number, a reading) to Set a control to it' },
          { value: 'pos', label: 'A position', title: 'Sample where something is (a layer, a hand’s pinch point, the pointer) to move a layer there' },
        ]} />
        {payload && <span title="What it captured last" style={{ marginLeft: 'auto', font: `600 11px ${fontFamily.mono}`, color: tk.text.secondary }}>{payload}</span>}
      </div>
      {c && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {kind === 'num'
            ? <GroupedPicker ariaLabel="Value it captures" value={c.what} placeholder="Pick a value" sections={sections} height={26} style={{ flex: 1, minWidth: 120, maxWidth: 240 }} width={300} searchPlaceholder="Search values" onChange={what => set({ ...c, what })} />
            : <DistanceAnchorPicker value={c.what.slice(CAPTURE_POS.length)} layers={play.layers} pads={!!play.padGrid} ariaLabel="Position it captures" onChange={a => set({ ...c, what: `${CAPTURE_POS}${a}` })} />}
          <Segmented size="sm" ariaLabel="When it captures" value={c.at} onChange={at => set({ ...c, at })} options={[
            { value: 'rise', label: 'As it starts', title: 'Once, the moment it becomes true' },
            { value: 'held', label: 'While true', title: 'Every frame while it is true: follows it' },
            { value: 'fall', label: 'As it ends', title: 'Once, the moment it becomes false: the value it had then' },
          ]} />
        </div>
      )}
      {c && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          {kind === 'num'
            ? <MapToMenu source={{ kind: 'captured', signal: s.id, release: 'stay' }} label={`${s.name}’s value`} button="Set…" smoothMs={0} />
            : <>
                <Button size="sm" variant="ghost" icon="target" disabled={!movable.length} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>Move a layer here…</Button>
                {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} title="Move a layer here" items={[{ heading: 'Jumps there on each capture' }, ...movable.map(l => ({
                  label: l.label, icon: 'layers' as const,
                  onSelect: () => { let ok = false; onChange(p => { const r = moveLayerToSignal(p, l.id, s.id); ok = r.ok; return r.play; }); if (!ok) toast.info('That layer’s position can’t be driven'); },
                }))]} />}
              </>}
          <span style={{ color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Jumps, and stays until the next capture. Glide, Go back and Go to are in Mappings.</span>
        </div>
      )}
    </div>
  );
}

/**
 * A signal's timing and chance (play/kit/signals.js sgShapeStep): Hold for
 * (it must stay true this long first), Linger (it stays true this long after),
 * Delay (its rise and fall arrive late: A sets off B half a second after) and
 * Chance (10 to 100%: each activation rolls once, seeded, so the same timeline
 * plays the same; Re-roll picks another sequence).
 */
export function SignalTimingEditor({ signal: s, onChange }: { signal: PlaySignal; onChange: Change }) {
  const tk = useTokens();
  const [open, setOpen] = useState(() => sgShaped(s));
  const set = (patch: Partial<Pick<PlaySignal, 'delay' | 'hold' | 'linger' | 'chance' | 'seed'>>) => onChange(p => ({ ...p, signals: (p.signals ?? []).map(x => {
    if (x.id !== s.id) return x;
    const n: PlaySignal = { ...x, ...patch };
    for (const k of ['delay', 'hold', 'linger'] as const) if (!(n[k]! > 0)) delete n[k];
    if (!(n.chance! < 1)) delete n.chance;
    return n;
  }) }));
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' };
  const num: React.CSSProperties = { width: 46, height: 24, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' };
  const word = (t: string, title?: string) => <span title={title} style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  const secs = (k: 'delay' | 'hold' | 'linger', label: string, title: string) => <>
    {word(label, title)}
    <NumberInput value={s[k] ?? 0} min={0} max={SIGNAL_TIME_MAX} step={0.05} title={title} onCommit={n => set({ [k]: Math.max(0, Math.min(SIGNAL_TIME_MAX, n)) })} style={num} />
    {word('s')}
  </>;
  const summary = [s.hold ? `hold ${s.hold}s` : '', s.linger ? `linger ${s.linger}s` : '', s.delay ? `delay ${s.delay}s` : '', s.chance !== undefined ? `${Math.round(s.chance * 100)}%` : ''].filter(Boolean).join(' · ');
  return (
    <div data-signal-timing={s.id} style={{ marginTop: 8, padding: '0 2px' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer' }}>
        <span style={cap}>{open ? '▾' : '▸'} Timing and chance</span>
        {!open && <span style={{ color: tk.text.secondary, font: `11px ${fontFamily.ui}` }}>{summary || 'at once, every time'}</span>}
      </button>
      {open && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {secs('hold', 'Hold for', 'It must stay true this long before it counts (ignores flickers)')}
          {secs('linger', 'Linger', 'It stays true this long after it stops (a pulse becomes a held level)')}
          {secs('delay', 'Delay', 'Its start and its end arrive this much later')}
          {word('Chance', 'Each time it starts, a roll decides whether it goes out at all (off is the signal’s own switch)')}
          <NumberInput value={Math.round((s.chance ?? 1) * 100)} min={SIGNAL_CHANCE_MIN * 100} max={100} step={5} title="Chance each activation goes out, 10–100%" onCommit={n => set({ chance: Math.max(SIGNAL_CHANCE_MIN, Math.min(1, n / 100)) })} style={num} />
          {word('%')}
          {s.chance !== undefined && <Button size="sm" variant="ghost" icon="dice" title="Roll a different sequence (the same timeline still plays the same way)" onClick={() => set({ seed: Math.floor(Math.random() * 1e9) })}>Re-roll</Button>}
        </div>
      )}
    </div>
  );
}

/** Polls a loop's pulses in flight and laps done while shown. */
function useLoopNow(key: string): { inFlight: number; laps: number } {
  const [now, setNow] = useState({ inFlight: 0, laps: 0 });
  useEffect(() => {
    const t = window.setInterval(() => { const n = playEngine.loopNow(key); setNow(p => (p.inFlight === n.inFlight && p.laps === n.laps ? p : n)); }, 150);
    return () => window.clearInterval(t);
  }, [key]);
  return now;
}

/**
 * The loops the links make (the plan's Loop object), derived from the links
 * (the links are the truth; only settings are stored, by the members): its
 * members in order, the time around, Run / Stop, Speed (scales every delay),
 * Laps (0 endless), what a new start does while it runs, and Reset.
 */
export function LoopsPanel({ play, onChange }: { play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const loops = useMemo(() => sgLinkPlan(sgPulseLinks(play.signals ?? []), play.loops).loops, [play.signals, play.loops]);
  if (!loops.length) return null;
  return (
    <div data-loops="" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      {loops.map(l => <LoopCard key={l.key} loop={l} play={play} onChange={onChange} tk={tk} />)}
    </div>
  );
}

function LoopCard({ loop: l, play, onChange, tk }: { loop: SgLoop; play: PlayRecord; onChange: Change; tk: ReturnType<typeof useTokens> }) {
  const now = useLoopNow(l.key);
  const saved = play.loops?.find(x => x.key === l.key);
  const nameOf = (id: string) => play.signals?.find(x => x.id === id)?.name ?? '?';
  const num: React.CSSProperties = { width: 46, height: 24, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' };
  const word = (t: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  const set = (patch: Partial<PlayLoop>) => onChange(p => setLoop(p, l.key, patch));
  return (
    <div data-loop={l.key} style={{ padding: '8px 10px', borderRadius: radius.card, background: alpha(tk.accent.base, 0.06), boxShadow: `inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="loop" size={14} style={{ color: tk.accent.text }} />
        <Field value={saved?.name ?? ''} placeholder="Loop" aria-label="Loop name" onChange={e => set({ name: e.target.value || undefined })} height={24} style={{ flex: 1, minWidth: 80, maxWidth: 200 }} />
        <span style={{ flex: 1 }} />
        <Toggle checked={l.running} onChange={running => set({ running: running ? undefined : false })} label={l.running ? 'Running' : 'Stopped'} />
      </div>
      <div style={{ marginTop: 4, color: tk.text.secondary, font: `11.5px/1.45 ${fontFamily.ui}` }}>
        {[...l.members, l.members[0]].map(nameOf).join(' → ')} · {Math.round(l.period * 100) / 100} s a lap
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {word('Speed')}
        <NumberInput value={l.speed} min={0.05} max={20} step={0.1} title="Scales every delay in the loop, like a tempo dial" onCommit={n => set({ speed: Math.max(0.05, Math.min(20, n)) === 1 ? undefined : Math.max(0.05, Math.min(20, n)) })} style={num} />
        {word('×  Laps')}
        <NumberInput value={l.laps} min={0} max={9999} step={1} title="How many times round, then it stops (0: endless)" onCommit={n => set({ laps: n > 0 ? Math.round(n) : undefined })} style={num} />
        {word(l.laps ? '' : '(endless)')}
        {word('Started again:')}
        <Select ariaLabel="A start while it runs" value={l.policy} height={24} onChange={v => set({ policy: v === 'ignore' ? undefined : v as PlayLoop['policy'] })} options={[
          { value: 'ignore', label: 'Ignore it' }, { value: 'add', label: 'Add a pulse' }, { value: 'restart', label: 'Restart' },
        ]} />
        <span style={{ flex: 1 }} />
        <span style={{ color: now.inFlight ? tk.accent.text : tk.text.faint, font: `600 11px ${fontFamily.mono}` }}>{now.inFlight ? `${now.inFlight} going round · lap ${now.laps + 1}` : 'idle'}</span>
        <Button size="sm" variant="ghost" icon="reset" onClick={() => playEngine.resetLoop(l.key)}>Reset</Button>
      </div>
      {l.branches && <div style={{ marginTop: 6, color: tk.status.warningText, font: `11.5px/1.4 ${fontFamily.ui}` }}>A signal in this loop links to two others in it, so pulses multiply each lap: at most {SG_LOOP_PULSES} go round at once.</div>}
    </div>
  );
}
