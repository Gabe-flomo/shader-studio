/**
 * RuleCard — one rule, whole (implementation guide 7.2): its name, lamp and
 * Test; When (the sentence builder); Options, folded (timing and chance,
 * what it captures); Do (its reactions, + Do); and what else listens to it.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord, PlaySignal } from '../../../types/play';
import { REACTIONS_PER_SIGNAL_MAX } from '../../../types/play';
import { playEngine } from '../../../lib/playEngine';
import { addReaction, defaultReaction, patchReaction, patchRule, removeReaction, setRuleVerb, sharedFire } from '../../../play/rules';
import { deleteSignal, renameSignal } from '../../../play/pairs';
import { Button, IconButton } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { SignalCaptureEditor, SignalTimingEditor } from '../SignalDefEditor';
import { signalLinks } from '../FullPages';
import { SentenceBuilder } from './SentenceBuilder';
import { ReactionEditor } from './ReactionEditor';
import { Lamp } from './Lamp';
import { usePlayUi } from '../playUi';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

export function RuleCard({ rule: s, play, onChange, on, flash }: { rule: PlaySignal; play: PlayRecord; onChange: Change; on: boolean; flash: number }) {
  const tk = useTokens();
  const [draft, setDraft] = useState(s.name);
  useEffect(() => setDraft(s.name), [s.name]);
  const fire = sharedFire(s);
  const reactions = s.do ?? [];
  const heardBy = [...new Set(signalLinks(play, s.id).heardBy.filter(x => !x.startsWith('Action:')))];
  const head: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' };
  return (
    <div data-rule-card={s.id} style={{ padding: '10px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Lamp on={on} flash={flash} />
        <Field value={draft} aria-label="Rule name" onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim() && draft !== s.name) onChange(p => renameSignal(p, s.id, draft)); else setDraft(s.name); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} height={28} style={{ flex: 1, minWidth: 0, font: `600 12.5px ${fontFamily.ui}` }} />
        <Button size="sm" icon="play" onClick={() => playEngine.fireSignal(s.id)} title="Fire it now: its reactions run">Test</Button>
        <IconButton icon="bolt" label="Rule from this: a new rule for when this one starts" size="sm" onClick={() => usePlayUi.getState().askQuickRule({ when: { on: 'signal', signal: s.id } })} />
        <IconButton icon="trash" label="Delete rule" size="sm" tone="danger" onClick={() => onChange(p => deleteSignal(p, s.id))} />
      </div>
      <div style={{ marginTop: 10 }}>
        <SentenceBuilder rule={s} play={play} fire={fire}
          onInputs={inputs => onChange(p => patchRule(p, s.id, { inputs }))}
          onCombine={combine => onChange(p => patchRule(p, s.id, { combine }))}
          onVerb={(i, t, f) => onChange(p => setRuleVerb(p, s.id, i, t, f))} />
      </div>
      <Options rule={s} play={play} onChange={onChange} />
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={head}>Do</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="plus" disabled={reactions.length >= REACTIONS_PER_SIGNAL_MAX}
            onClick={() => onChange(p => { const r = defaultReaction(p); const f = sharedFire(s); return addReaction(p, s.id, f ? { ...r, fire: f } : r); })}>Do</Button>
        </div>
        {reactions.map(r => (
          <ReactionEditor key={r.id} ruleId={s.id} r={r} play={play}
            onPatch={patch => onChange(p => patchReaction(p, s.id, r.id, patch))}
            onRemove={() => onChange(p => removeReaction(p, s.id, r.id))} />
        ))}
        {!reactions.length && <div style={{ color: tk.text.faint, font: `12px ${fontFamily.ui}`, padding: '2px 0' }}>Nothing yet{heardBy.length ? '' : ': add what it does'}.</div>}
      </div>
      {heardBy.length > 0 && (
        <div data-heard-by={s.id} style={{ marginTop: 10 }}>
          <span style={head}>Also listening</span>
          {heardBy.map(t => <div key={t} style={{ color: tk.text.secondary, font: `11.5px/1.5 ${fontFamily.ui}` }}>{t}</div>)}
        </div>
      )}
    </div>
  );
}

/** Options, folded: timing and chance, and what it captures. */
function Options({ rule: s, play, onChange }: { rule: PlaySignal; play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const busy = !!(s.hold || s.linger || s.delay || s.chance !== undefined || s.capture);
  const [open, setOpen] = useState(busy);
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {open ? '▾' : '▸'} Options
      </button>
      {open && <>
        <SignalTimingEditor signal={s} onChange={onChange} />
        <SignalCaptureEditor signal={s} play={play} onChange={onChange} />
      </>}
    </div>
  );
}
