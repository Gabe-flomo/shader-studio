/**
 * RulesPage — every rule as a sentence with a lamp (implementation guide
 * 7.2), replacing the Signals and Actions pages: "When Space is pressed →
 * Burst 60 · Sparks". + Rule opens Quick rule (do it now, pick what
 * happens); the selected rule's card is beside the list.
 *
 * The page shows a setup's older wiring (actions, a signal's When and links)
 * as the rules it plays as (play/rules.ts); the first edit here rewrites the
 * record that way, which plays the same.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord, PlaySignal, TriggerSpec } from '../../../types/play';
import { addRule, asRules, inputOf, ruleName, sharedFire } from '../../../play/rules';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { PageHeader, TwoPane } from '../FullPages';
import { LoopsPanel } from '../SignalDefEditor';
import { usePlayUi } from '../playUi';
import { QuickRule } from './QuickRule';
import { BehavioursDialog } from './BehavioursDialog';
import { RuleCard } from './RuleCard';
import { reactionText } from './reactionChoices';
import { signalStructure, type SignalShape } from '../signalFlow';
import { ShapeBadge } from './ShapeBadge';
import { useLamps } from './useLamps';
import { Lamp } from './Lamp';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

export function RulesPage({ play: raw, onChange: rawChange, wide }: { play: PlayRecord; onChange: Change; wide: boolean }) {
  const tk = useTokens();
  const play = useMemo(() => asRules(raw), [raw]);
  const onChange: Change = fn => rawChange(p => fn(asRules(p)));
  const rules = play.signals ?? [];
  const { on, flash } = useLamps(rules.map(r => r.id));
  const shapes = useMemo(() => signalStructure(play), [play]);
  // What's selected: a pick here, or what something else asked to show since.
  const focus = usePlayUi(s => s.signalFocus);
  const [local, setLocal] = useState({ id: '', at: 0 });
  const picked = focus.tick > local.at ? focus.id : local.id;
  const pick = (id: string) => setLocal({ id, at: focus.tick });
  const selected = rules.find(r => r.id === picked) ?? rules[0];
  // Quick rule: + Rule here, or asked for from elsewhere (Rule from this).
  const ask = usePlayUi(s => s.quickRule);
  const [quick, setQuick] = useState<{ key: number; when?: TriggerSpec; layerId?: string } | null>(null);
  useEffect(() => {
    if (!ask.pending) return;
    usePlayUi.getState().takeQuickRule();
    setQuick({ key: Date.now(), when: ask.when, layerId: ask.layerId });
  }, [ask]);
  const startQuick = () => setQuick({ key: Date.now() });
  const [library, setLibrary] = useState(false);
  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <LoopsPanel play={play} onChange={onChange} />
      {!rules.length && !quick && (
        <div style={{ padding: '18px 16px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>Nothing happens yet</div>
          A rule says when something happens, what to do: when you pinch, burst the sparks; when the bass hits, step the text. Press + Rule, do the thing, and pick what happens.
          <div style={{ marginTop: 10 }}><Button size="sm" variant="primary" icon="plus" onClick={startQuick}>Rule</Button></div>
        </div>
      )}
      <div role="listbox" aria-label="Rules" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rules.map(r => <RuleRow key={r.id} rule={r} play={play} shape={shapes.get(r.id)} on={!!on[r.id]} flash={flash[r.id] ?? 0} selected={r.id === selected?.id} onPick={() => pick(r.id)} />)}
      </div>
    </div>
  );
  const side = selected ? <RuleCard key={selected.id} rule={selected} play={play} onChange={onChange} on={!!on[selected.id]} flash={flash[selected.id] ?? 0} /> : null;
  return (
    <>
      <PageHeader title="Rules" count={rules.length} extra={<>
        <Button size="sm" variant="ghost" icon="star" onClick={() => setLibrary(true)}>Behaviours</Button>
        <Button size="sm" variant="primary" icon="plus" onClick={startQuick}>Rule</Button>
      </>} />
      {library && <BehavioursDialog play={play} onChange={onChange} onAdded={id => { if (id) pick(id); }} onClose={() => setLibrary(false)} />}
      {quick && <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
        <QuickRule key={quick.key} play={play} when={quick.when} layerId={quick.layerId} onCancel={() => setQuick(null)}
          onMake={(trigger, reaction) => {
            let id = '';
            onChange(p => { const r = addRule(p, [inputOf(trigger)], reaction ? [{ id: `re_${Date.now().toString(36)}`, ...reaction }] : []); id = r.id; return r.play; });
            setQuick(null);
            if (id) pick(id);
          }} />
      </div>}
      <TwoPane wide={wide} list={list} side={side} />
    </>
  );
}

/** One rule in the list: lamp, its sentence, and what it does. */
function RuleRow({ rule: r, play, shape, on, flash, selected, onPick }: { rule: PlaySignal; play: PlayRecord; shape?: SignalShape; on: boolean; flash: number; selected: boolean; onPick: () => void }) {
  const tk = useTokens();
  const does = (r.do ?? []).filter(x => x.enabled);
  const auto = ruleName(play, r.inputs ?? [], sharedFire(r) ?? undefined, r.combine);
  return (
    <div role="option" aria-selected={selected} tabIndex={0} data-rule-row={r.id} onClick={onPick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 42, padding: '5px 10px', borderRadius: radius.md, cursor: 'pointer', background: selected ? tk.bg.selected : 'transparent', boxShadow: selected ? `inset 2px 0 0 ${tk.accent.base}` : undefined }}>
      <Lamp on={on} flash={flash} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ font: `600 12px ${fontFamily.ui}`, color: selected ? tk.accent.text : tk.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
          {shape && shape !== 'isolated' && <ShapeBadge shape={shape} />}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, font: `11.5px ${fontFamily.ui}`, color: tk.text.muted, minWidth: 0 }}>
          {r.name !== auto && (r.inputs?.length ?? 0) > 0 && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' }}>{auto.replace(/^When /, '')}</span>}
          <Icon name="chevR" size={11} style={{ flexShrink: 0, color: tk.text.faint }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{does.length ? does.map(x => reactionText(x, play)).join(', ') : 'nothing yet'}</span>
        </span>
      </span>
    </div>
  );
}
