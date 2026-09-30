/**
 * SignalDefEditor — what makes a signal true, on its card on the Signals page
 * (types/play.ts SignalDef): sent (true in the frame an action or a layer
 * sends it, its When list), its own trigger (true while a key is held, a
 * condition is met, a hand is closed), or a combination of other signals
 * (all of, any of, none of, exactly one of: "hover AND click"). A dot shows
 * whether it is true right now.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { playEngine } from '../../lib/playEngine';
import { CAPTURE_POS, SIGNAL_CHANCE_MIN, SIGNAL_INPUTS_MAX, SIGNAL_LINKS_MAX, SIGNAL_TIME_MAX, layerNumericProps, type PlayLoop, type PlayRecord, type PlaySignal, type SignalCapture, type SignalDef, type SignalLogic } from '../../types/play';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { addSignal } from '../../play/pairs';
import { NumberInput } from '../NodeGraph/NumberInput';
import { SG_LOOP_PULSES, sgLinkPlan, sgShaped, type SgLoop } from '../../play/kit/signals.js';
import { GroupedPicker } from '../ui/GroupedPicker';
import { Menu } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import { DistanceAnchorPicker, valueSections } from './ConditionFields';
import { MapToMenu } from './MapToMenu';
import { SIGNAL_SHAPE_LABELS, addLink, moveLayerToSignal, removeLink, setLoop, type SignalShape } from './signalFlow';
import { Segmented, Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import { TriggerPicker } from './TriggerPicker';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

const LOGIC_OPTIONS: { value: SignalLogic; label: string; title: string }[] = [
  { value: 'and', label: 'All of', title: 'True while every one of them is true: hover AND click' },
  { value: 'or', label: 'Any of', title: 'True while at least one is true' },
  { value: 'not', label: 'None of', title: 'True while none of them is (NOT one signal)' },
  { value: 'xor', label: 'Exactly one of', title: 'True while exactly one is true' },
];

/** Is the signal true now (polled while shown)? */
function useSignalLevel(id: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 50) return;
      last = ms;
      const v = playEngine.signalLevel(id);
      setOn(p => (p === v ? p : v));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id]);
  return on;
}

/** `shape`: where it sits among the signals (signalFlow.ts signalStructure), shown as a chip. */
export function SignalDefEditor({ signal: s, play, onChange, shape }: { signal: PlaySignal; play: PlayRecord; onChange: Change; shape?: SignalShape }) {
  const tk = useTokens();
  const level = useSignalLevel(s.id);
  const kind = s.when?.kind ?? 'sent';
  const set = (when: SignalDef | undefined) => onChange(p => ({ ...p, signals: (p.signals ?? []).map(x => { if (x.id !== s.id) return x; const n = { ...x }; if (when) n.when = when; else delete n.when; return n; }) }));
  const others = (play.signals ?? []).filter(x => x.id !== s.id);
  const numStyle: React.CSSProperties = { width: 52, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' };
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' };
  const layerRefs = play.layers.map(l => ({ id: l.id, label: l.label, kind: l.kind }));
  const loop = s.when?.kind === 'logic' && playEngine.signalInLoop(s.id);
  return (
    <div data-signal-def={s.id} style={{ marginTop: 6, padding: '0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={cap}>True</span>
        <Segmented size="sm" ariaLabel="What makes it true" value={kind} onChange={k => {
          if (k === kind) return;
          if (k === 'sent') set(undefined);
          else if (k === 'trigger') set({ kind: 'trigger', trigger: { on: 'key', code: 'Space' } });
          else set({ kind: 'logic', op: 'and', inputs: others.slice(0, 2).map(x => x.id) });
        }} options={[
          { value: 'sent', label: 'When sent', title: 'True in the frame something sends it (its When list)' },
          { value: 'trigger', label: 'While…', title: 'True while its own trigger is held or its condition is met' },
          { value: 'logic', label: 'Combine', title: 'True from other signals: all of, any of, none of, exactly one of' },
        ]} />
        <span style={{ flex: 1 }} />
        {shape && <span data-signal-shape={shape} title="Where it sits among the signals: links, combinations and relays" style={{ height: 18, padding: '0 6px', borderRadius: 9, display: 'inline-flex', alignItems: 'center', background: shape === 'loop' ? alpha(tk.accent.base, 0.15) : alpha(tk.text.primary, 0.06), color: shape === 'loop' ? tk.accent.text : tk.text.muted, font: `600 10px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{SIGNAL_SHAPE_LABELS[shape]}</span>}
        <span title={level ? 'True now' : 'False now'} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: level ? tk.accent.text : tk.text.faint, font: `600 11px ${fontFamily.ui}` }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: level ? tk.accent.base : tk.text.disabled, boxShadow: level ? `0 0 0 3px ${alpha(tk.accent.base, 0.2)}` : undefined }} />
          {level ? 'true' : 'false'}
        </span>
      </div>
      {s.when?.kind === 'trigger' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <TriggerPicker trigger={s.when.trigger} layers={layerRefs} numStyle={numStyle} onChange={trigger => set({ kind: 'trigger', trigger })} />
        </div>
      )}
      {s.when?.kind === 'logic' && (() => {
        const w = s.when;
        return (
          <div style={{ marginTop: 6 }}>
            <Select ariaLabel="Combine how" value={w.op} options={LOGIC_OPTIONS} height={26} onChange={op => set({ ...w, op: op as SignalLogic })} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} role="group" aria-label="Signals it combines">
              {others.length === 0 && <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>Add another signal to combine.</span>}
              {others.map(o => {
                const on = w.inputs.includes(o.id);
                const full = !on && w.inputs.length >= SIGNAL_INPUTS_MAX;
                return (
                  <button key={o.id} type="button" aria-pressed={on} disabled={full}
                    onClick={() => set({ ...w, inputs: on ? w.inputs.filter(i => i !== o.id) : [...w.inputs, o.id] })}
                    style={{ height: 24, padding: '0 9px', borderRadius: radius.md, border: 0, cursor: full ? 'default' : 'pointer', font: `600 11.5px ${fontFamily.ui}`,
                      background: on ? tk.bg.selected : alpha(tk.text.primary, 0.05), color: on ? tk.accent.text : tk.text.secondary, boxShadow: on ? `inset 0 0 0 1px ${alpha(tk.accent.base, 0.5)}` : undefined }}>
                    {o.name}
                  </button>
                );
              })}
            </div>
            {loop && <div style={{ marginTop: 6, color: tk.status.warningText, font: `11.5px/1.4 ${fontFamily.ui}` }}>This loops back to itself through the signals it combines, so each reads the others a frame late.</div>}
          </div>
        );
      })()}
    </div>
  );
}

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

/**
 * A signal's links: when it rises (or falls), send another signal after a
 * delay. A chain of links that comes back round is a loop (LoopsPanel).
 */
export function SignalLinksEditor({ signal: s, play, onChange }: { signal: PlaySignal; play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const [adding, setAdding] = useState<{ to: string; delay: number; on: 'rise' | 'fall' } | null>(null);
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' };
  const num: React.CSSProperties = { width: 46, height: 24, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' };
  const nameOf = (id: string) => play.signals?.find(x => x.id === id)?.name ?? 'Missing signal';
  const links = s.links ?? [];
  const full = links.length >= SIGNAL_LINKS_MAX;
  const NEW = '__new';
  const commit = () => {
    if (!adding) return;
    const a = adding;
    onChange(p => {
      let to = a.to, q = p;
      if (to === NEW) { const r = addSignal(p, `After ${s.name}`); if (!r.id) return p; to = r.id; q = r.play; }
      return addLink(q, s.id, { to, delay: a.delay, ...(a.on === 'fall' ? { on: 'fall' as const } : {}) });
    });
    setAdding(null);
  };
  return (
    <div data-signal-links={s.id} style={{ marginTop: 8, padding: '0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={cap}>Links</span>
        <span style={{ flex: 1 }} />
        {!adding && <Button size="sm" variant="ghost" icon="link" disabled={full} onClick={() => setAdding({ to: (play.signals ?? []).find(x => x.id !== s.id)?.id ?? NEW, delay: 0.5, on: 'rise' })}>Link</Button>}
      </div>
      {links.map((l, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 12px', color: tk.text.secondary, font: `11.5px/1.5 ${fontFamily.ui}` }}>
          <span style={{ flex: 1 }}>{l.on === 'fall' ? 'When it ends' : 'When it starts'}, send <b style={{ color: tk.text.primary }}>{nameOf(l.to)}</b>{l.delay > 0 ? ` ${l.delay} s later` : ' next frame'}</span>
          <IconButton icon="close" size="sm" label="Remove this link" onClick={() => onChange(p => removeLink(p, s.id, i))} />
        </div>
      ))}
      {adding && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4, padding: '6px 8px', borderRadius: radius.md, background: alpha(tk.text.primary, 0.03) }}>
          <Segmented size="sm" ariaLabel="When" value={adding.on} onChange={on => setAdding({ ...adding, on })} options={[{ value: 'rise', label: 'Starts' }, { value: 'fall', label: 'Ends' }]} />
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>send</span>
          <Select ariaLabel="Signal to send" value={adding.to} height={26} onChange={to => setAdding({ ...adding, to })}
            options={[...(play.signals ?? []).map(x => ({ value: x.id, label: x.id === s.id ? `${x.name} (itself: a loop)` : x.name })), { value: NEW, label: '+ New signal' }]} />
          <NumberInput value={adding.delay} min={0} max={SIGNAL_TIME_MAX} step={0.1} title="Seconds later (0: the next frame)" onCommit={n => setAdding({ ...adding, delay: Math.max(0, Math.min(SIGNAL_TIME_MAX, n)) })} style={num} />
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>s later</span>
          <Button size="sm" onClick={commit}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
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
  const loops = useMemo(() => sgLinkPlan(play.signals ?? [], play.loops).loops, [play.signals, play.loops]);
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
