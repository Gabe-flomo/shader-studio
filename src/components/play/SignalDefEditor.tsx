/**
 * SignalDefEditor — what makes a signal true, on its card on the Signals page
 * (types/play.ts SignalDef): sent (true in the frame an action or a layer
 * sends it, its When list), its own trigger (true while a key is held, a
 * condition is met, a hand is closed), or a combination of other signals
 * (all of, any of, none of, exactly one of: "hover AND click"). A dot shows
 * whether it is true right now.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { playEngine } from '../../lib/playEngine';
import { SIGNAL_INPUTS_MAX, type PlayRecord, type PlaySignal, type SignalDef, type SignalLogic } from '../../types/play';
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
