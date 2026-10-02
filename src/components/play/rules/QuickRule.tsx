/**
 * QuickRule — the fast way to a rule (implementation guide 6.2): "Do it now"
 * listens for the first thing that moves (a key, a note, a click or a pointer
 * move on the picture, a pinch, a sound, a signal), reads it as a sentence
 * ("When Right · Pinch closes", with the other verbs beside it), then the Do
 * chips (the likely layer's actions first): one click makes the rule.
 *
 * + Rule, then do the thing, then pick what happens: three steps, no typing.
 * A When handed in ("Rule from this") skips the listening; a layer handed in
 * puts its actions first.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import type { FireSpec, PlayReaction, PlayRecord, TriggerSpec } from '../../../types/play';
import { SIGNAL_ACTION } from '../../../types/play';
import { playEngine } from '../../../lib/playEngine';
import { subjectOf, verbsFor } from '../../../play/signalVerbs';
import { Button } from '../../ui/Button';
import { labelContext } from '../ConditionFields';
import { defaultAmount, doChoices } from './reactionChoices';

/** How many Do chips show before "More…". */
const CHIPS = 8;

export function QuickRule({ play, when: given, layerId, onMake, onCancel }: {
  play: PlayRecord;
  when?: TriggerSpec;
  layerId?: string;
  /** Make the rule: its trigger, and its first reaction (or none: Just the rule). */
  onMake: (trigger: TriggerSpec, reaction: Omit<PlayReaction, 'id'> | null) => void;
  onCancel: () => void;
}) {
  const tk = useTokens();
  const [heard, setHeard] = useState<TriggerSpec | null>(given ?? null);
  const [verb, setVerb] = useState(0);
  const [all, setAll] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const listen = () => {
    cancel.current?.();
    setHeard(null);
    setVerb(0);
    cancel.current = playEngine.learnAny(t => { cancel.current = null; setHeard(t); });
  };
  useEffect(() => {
    if (!given) listen();
    return () => cancel.current?.();
    // Listen once on open; Change listens again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ctx = labelContext(play);
  const verbs = heard ? verbsFor(heard) : [];
  const v = verbs[Math.min(verb, verbs.length - 1)];
  const choices = doChoices(play, layerId);
  const shown = all ? choices : choices.slice(0, CHIPS);
  const make = (c: (typeof choices)[number] | null) => {
    if (!v) return;
    const fire: FireSpec | undefined = v.fire;
    const l = play.layers.find(x => x.id === c?.layerId);
    onMake(v.trigger, c ? { do: c.do, layerId: c.layerId, amount: defaultAmount(c.do, l), enabled: true, ...(c.do === SIGNAL_ACTION ? { signal: '' } : {}), ...(fire ? { fire } : {}) } : null);
  };
  const box: React.CSSProperties = { padding: '12px 14px', borderRadius: radius.card, background: alpha(tk.accent.base, 0.06), boxShadow: `inset 0 0 0 1px ${alpha(tk.accent.base, 0.45)}`, marginBottom: 10 };
  const chip = (on: boolean): React.CSSProperties => ({ height: 28, padding: '0 11px', borderRadius: 14, border: 0, cursor: 'pointer', font: `${on ? 600 : 500} 12px ${fontFamily.ui}`, background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.primary, boxShadow: on ? `inset 0 0 0 1px ${tk.accent.base}` : 'none' });
  return (
    <div data-quick-rule="" style={box}>
      {!heard ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: tk.accent.base, animation: 'ssPulse 1s ease-in-out infinite' }} />
          <span style={{ flex: 1, font: `600 13px/1.4 ${fontFamily.ui}`, color: tk.text.primary }}>
            Do it now: <span style={{ fontWeight: 400, color: tk.text.secondary }}>press a key, play a note, click or move on the picture, pinch, or make a sound</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => { cancel.current?.(); cancel.current = null; setHeard({ on: 'key', code: 'Space' }); }}>Use a key instead</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <style>{'@keyframes ssPulse{0%,100%{opacity:1}50%{opacity:.3}}'}</style>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ font: `600 13px ${fontFamily.ui}`, color: tk.text.primary }}>When {subjectOf(heard, ctx)}</span>
            {verbs.map((x, i) => <button key={x.id} type="button" data-verb={x.id} aria-pressed={i === verb} onClick={() => setVerb(i)} style={chip(i === verb)}>{x.label}</button>)}
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={listen}>Change</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <span style={{ font: `600 13px ${fontFamily.ui}`, color: tk.text.primary, marginRight: 2 }}>Do</span>
            {shown.map(c => <button key={c.value} type="button" data-do={c.value} onClick={() => make(c)} style={chip(false)}>{c.label}</button>)}
            {!all && choices.length > CHIPS && <Button size="sm" variant="ghost" onClick={() => setAll(true)}>More…</Button>}
            <Button size="sm" variant="ghost" onClick={() => make(null)}>Just the rule</Button>
          </div>
        </>
      )}
    </div>
  );
}
