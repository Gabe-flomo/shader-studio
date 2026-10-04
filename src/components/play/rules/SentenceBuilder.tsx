/**
 * SentenceBuilder — a rule's When as sentences (implementation guide 7.2):
 * "When [Space] [is pressed]", one line per input, with Any / All / None /
 * One between them when there are several. The subject opens the full
 * trigger editor (the condition fields are its "more" panel); the verb comes
 * from signalVerbs.ts; Learn listens for the next input. Another rule's
 * signal is an input too: while it is on, as it starts or as it stops (after
 * a delay).
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { SIGNAL_INPUTS_MAX, type FireSpec, type PlayRecord, type PlaySignal, type SignalCombine, type SignalInput, type TriggerSpec } from '../../../types/play';
import { playEngine } from '../../../lib/playEngine';
import { sameTrigger, subjectOf, verbOf, verbsFor } from '../../../play/signalVerbs';
import { triggerLabel } from '../../../play/playSources';
import { inputOf } from '../../../play/rules';
import { Button, IconButton } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Popover } from '../../ui/Popover';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { TriggerPicker } from '../TriggerPicker';
import { labelContext } from '../ConditionFields';

const COMBINES: { value: SignalCombine; label: string; title: string }[] = [
  { value: 'any', label: 'Any', title: 'On while any of them is' },
  { value: 'all', label: 'All', title: 'On while all of them are' },
  { value: 'none', label: 'None', title: 'On while none of them is' },
  { value: 'one', label: 'One', title: 'On while exactly one of them is' },
];
const AS_WORDS = { mirror: 'is on', rise: 'starts', fall: 'stops' } as const;

export function SentenceBuilder({ rule, play, fire, onInputs, onCombine, onVerb }: {
  rule: PlaySignal;
  play: PlayRecord;
  /** How the rule's reactions fire, when they all agree (null: they differ). */
  fire: FireSpec | undefined | null;
  onInputs: (inputs: SignalInput[]) => void;
  onCombine: (c: SignalCombine) => void;
  /** A verb picked for input `i`: its trigger, and how every reaction fires. */
  onVerb: (i: number, trigger: TriggerSpec, fire: FireSpec | undefined) => void;
}) {
  const tk = useTokens();
  const inputs = rule.inputs ?? [];
  const [learning, setLearning] = useState<number | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const set = (i: number, x: SignalInput) => onInputs(inputs.map((y, j) => (j === i ? x : y)));
  const learn = (i: number) => {
    cancel.current?.();
    if (learning === i) { setLearning(null); return; }
    setLearning(i);
    cancel.current = playEngine.learnAny(t => {
      setLearning(null);
      cancel.current = null;
      const x = inputOf(t);
      if (i >= inputs.length) onInputs([...inputs, x]); else set(i, x);
    });
  };
  const others = (play.signals ?? []).filter(s => s.id !== rule.id);
  const word: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 38, flexShrink: 0 };
  const full = inputs.length >= SIGNAL_INPUTS_MAX;
  return (
    <div data-sentence={rule.id}>
      {inputs.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={word}>When</span>
          <Segmented size="sm" ariaLabel="Combine" value={rule.combine ?? 'any'} options={COMBINES} onChange={onCombine} />
          <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>of these</span>
        </div>
      )}
      {inputs.map((x, i) => (
        <div key={i} data-input={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 30, padding: '2px 0' }}>
          <span style={word}>{inputs.length > 1 ? '' : 'When'}</span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {x.kind === 'trigger'
            ? <TriggerLine trigger={x.trigger} play={play} fire={fire} onTrigger={trigger => set(i, { kind: 'trigger', trigger })} onVerb={(t, f) => onVerb(i, t, f)} single={inputs.length === 1} />
            : <>
                <Select ariaLabel="Signal" height={26} style={{ maxWidth: 200 }} value={x.signal}
                  options={[...(others.some(s => s.id === x.signal) ? [] : [{ value: x.signal, label: 'Missing rule' }]), ...others.map(s => ({ value: s.id, label: s.name }))]}
                  onChange={signal => set(i, { ...x, signal })} />
                <Select ariaLabel="How it listens" height={26} value={x.as} options={(['mirror', 'rise', 'fall'] as const).map(a => ({ value: a, label: AS_WORDS[a] }))}
                  onChange={v => { const as = v as 'mirror' | 'rise' | 'fall'; set(i, { kind: 'signal', signal: x.signal, as, ...(as !== 'mirror' && x.delay ? { delay: x.delay } : {}) }); }} />
                {x.as !== 'mirror' && <>
                  <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>after</span>
                  <NumberInput value={x.delay ?? 0} min={0} max={60} step={0.05} title="Seconds after it starts (or stops)" onCommit={n => { const d = Math.max(0, Math.min(60, n)); const { delay: _d, ...rest } = x; void _d; set(i, d > 0 ? { ...rest, delay: d } : rest); }}
                    style={{ width: 46, height: 24, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' }} />
                  <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>s</span>
                </>}
              </>}
          </span>
          {x.kind === 'trigger' && <IconButton icon="spark" size="sm" active={learning === i} label={learning === i ? 'Listening… move, press, pinch, play or make a sound' : 'Learn: the next thing you do'} onClick={() => learn(i)} />}
          <IconButton icon="close" size="sm" label="Remove this input" onClick={() => onInputs(inputs.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!inputs.length && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 30 }}>
          <span style={word}>When</span>
          <span style={{ color: tk.text.faint, font: `12px ${fontFamily.ui}` }}>{learning === 0 ? 'Listening… move, press, pinch, play or make a sound' : 'Nothing yet: only a Test, or another rule sending it, turns it on.'}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, paddingLeft: 44 }}>
        <Button size="sm" variant="ghost" icon="spark" disabled={full} onClick={() => learn(inputs.length)}>{learning === inputs.length ? 'Listening…' : inputs.length ? 'Or when… (learn)' : 'Learn'}</Button>
        <Button size="sm" variant="ghost" icon="plus" disabled={full} onClick={() => onInputs([...inputs, { kind: 'trigger', trigger: { on: 'key', code: 'Space' } }])}>A key</Button>
        {others.length > 0 && <Button size="sm" variant="ghost" icon="bolt" disabled={full} onClick={() => onInputs([...inputs, { kind: 'signal', signal: others[0].id, as: 'mirror' }])}>Another rule</Button>}
      </div>
    </div>
  );
}

/** "[Space] [is pressed]": the subject opens the trigger editor; the verb picks from signalVerbs.ts. */
function TriggerLine({ trigger, play, fire, onTrigger, onVerb, single }: {
  trigger: TriggerSpec;
  play: PlayRecord;
  fire: FireSpec | undefined | null;
  onTrigger: (t: TriggerSpec) => void;
  onVerb: (t: TriggerSpec, f: FireSpec | undefined) => void;
  single: boolean;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const ctx = labelContext(play);
  const verbs = verbsFor(trigger);
  // With several inputs the verb is about the trigger alone; reactions' firing is the rule's.
  const current = verbOf(trigger, single && fire !== null ? fire : undefined) ?? (single ? undefined : verbs.find(v => sameTrigger(v.trigger, trigger)));
  const CUSTOM = '__custom';
  const layers = play.layers.map(l => ({ id: l.id, label: l.label, kind: l.kind }));
  const numStyle: React.CSSProperties = { width: 52, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' };
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Change what it watches"
        style={{ height: 26, padding: '0 9px', borderRadius: radius.md, border: 0, cursor: 'pointer', background: tk.bg.field, color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {current ? subjectOf(trigger, ctx) : triggerLabel(trigger, play.layers, ctx)}
      </button>
      {(current || verbs.length > 0) && (
        <Select ariaLabel="Verb" height={26} value={current?.id ?? CUSTOM}
          options={[...(current ? [] : [{ value: CUSTOM, label: 'as set' }]), ...verbs.map(v => ({ value: v.id, label: v.label }))]}
          onChange={id => { const v = verbs.find(x => x.id === id); if (v) onVerb(v.trigger, v.fire); }} />
      )}
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} width={380} padding={12}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <TriggerPicker trigger={trigger} layers={layers} numStyle={numStyle} onChange={onTrigger} />
          </div>
        </Popover>
      )}
    </>
  );
}
