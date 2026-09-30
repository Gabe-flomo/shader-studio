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
import { CAPTURE_POS, SIGNAL_INPUTS_MAX, layerNumericProps, type PlayRecord, type PlaySignal, type SignalCapture, type SignalDef, type SignalLogic } from '../../types/play';
import { Button } from '../ui/Button';
import { GroupedPicker } from '../ui/GroupedPicker';
import { Menu } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import { DistanceAnchorPicker, valueSections } from './ConditionFields';
import { MapToMenu } from './MapToMenu';
import { moveLayerToSignal } from './signalFlow';
import { Segmented } from '../ui/Choice';
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

export function SignalDefEditor({ signal: s, play, onChange }: { signal: PlaySignal; play: PlayRecord; onChange: Change }) {
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
