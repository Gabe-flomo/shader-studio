/**
 * The behaviour cards of one section for particles, flocks, crowds and orbiters (docs/agent-builder.md):
 * each card the section has, in the order they run (the rule order), with its switch, its sliders,
 * its "Only when…" line and, where order matters, a handle to drag it (or ↑ / ↓ on the handle).
 * Cards it doesn't have yet are "+ Gravity" chips under them. The cards are the rule set
 * (agentBuilder/behaviours.ts), so every change is a rule change.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Choice';
import type { AgentRuleSet, NeighbourWho, RuleAction, RuleCondition } from '../../agentRules/spec';
import {
  type CardId, type CardRead, addCard, patchAt, removeAt, reorderCards, setOnAt, setOnlyWhen,
} from '../../agentBuilder/behaviours';
import { CARD_WORDS, MORE_HINTS, type SectionDef } from '../../agentBuilder/sections';
import { setFlow } from '../../agentBuilder/cards';
import { BehaviourCard, SettingRow, SliderSetting, type CardPicture } from './BehaviourCard';
import { OnlyWhenLine } from './OnlyWhenLine';

type Act<K extends RuleAction['kind']> = Extract<RuleAction, { kind: K }>;
const n = (v: number, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d);

/** A card's one-line summary under its name. */
export function cardSummary(c: CardRead): string {
  const a = c.action;
  switch (a.kind) {
    case 'force': {
      if (a.field === 'gravity' || a.field === 'wind') return `${n(a.strength)} toward ${n(a.angle ?? (a.field === 'gravity' ? -90 : 0), 0)}°`;
      if (a.field === 'curl') return `strength ${n(a.strength)}`;
      return `${a.strength < 0 ? 'pushes away' : 'pulls in'} ${n(Math.abs(a.strength))} · ${a.field === 'mouse' ? 'the mouse' : `(${n(a.x ?? 0)}, ${n(a.y ?? 0)})`}`;
    }
    case 'drag': return `loses ${n(a.amount)} a second`;
    case 'fade': return `black after ${n(a.seconds, 1)} s`;
    case 'die': return c.when?.kind === 'age' && c.when.cmp === '>' ? `at ${n(c.when.seconds)} s old` : c.when ? 'when its only when holds' : 'at once (give it an only when)';
    case 'separate': case 'match': case 'cohere': return `up to ${n(a.degrees, 1)}° a step`;
    case 'avoidEdges': return `within ${n(a.margin)} · ${n(a.degrees, 1)}°`;
    case 'turn': return a.toward === 'point' ? `(${n(a.x ?? 0)}, ${n(a.y ?? 0)}) · ${n(a.degrees, 1)}°` : `the ${a.toward} · ${n(a.degrees, 1)}°`;
    case 'slow': return `nearly stops at ${n(a.jam, 0)}`;
    case 'orbit': return `${a.target === 'point' ? `(${n(a.x ?? 0)}, ${n(a.y ?? 0)})` : `the ${a.target}`} · ${n(a.distance)} out${a.cw ? ' · clockwise' : ''}`;
    case 'wander': return `±${n(a.degrees, 1)}°`;
    default: return '';
  }
}

export function SectionCards({ section, all, set, sp, update, focusCard, hotCard, onFocusSetting, intro, cardsFor }: {
  section: SectionDef;
  /** Every card of the kind (reading order). */
  all: readonly CardRead[];
  set: AgentRuleSet; sp: number;
  update: (next: AgentRuleSet) => void;
  focusCard: (key: string | undefined) => void;
  hotCard?: string;
  onFocusSetting: (s: string | undefined) => void;
  /** The section's own settings card (Neighbours' view), before its behaviour cards. */
  intro?: ReactNode;
  /** The card order new cards are placed by (the kind's). */
  cardsFor: readonly CardId[];
}) {
  const tk = useTokens();
  const cards = all.filter(c => section.cards.includes(c.card));
  const missing = section.cards.filter(id => !cards.some(c => c.card === id));
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const move = (i: number, j: number) => update(reorderCards(set, sp, cards, i, j));
  return (
    <div data-section-cards={section.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {intro}
      {cards.map((c, i) => {
        const words = CARD_WORDS[c.card];
        const handle = section.reorder && cards.length > 1 ? (
          <button type="button" data-card-handle={c.key} draggable aria-label={`Move ${words.title}: drag, or ↑ ↓`} title="Drag to change the order they run in (or ↑ / ↓)"
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key); setDrag({ from: i, over: i }); }}
            onDragEnd={() => setDrag(null)}
            onKeyDown={e => {
              if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); move(i, i - 1); }
              if (e.key === 'ArrowDown' && i < cards.length - 1) { e.preventDefault(); move(i, i + 1); }
            }}
            style={{ width: 18, height: 30, marginLeft: -6, padding: 0, border: 0, borderRadius: 6, background: 'none', color: tk.text.faint, cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="grip" size={14} />
          </button>
        ) : undefined;
        const line = drag && drag.over === i && drag.from !== i;
        return (
          <div key={c.key} data-card-slot={c.key}
            onPointerEnter={() => focusCard(c.key)}
            onDragOver={e => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }}
            onDrop={e => { e.preventDefault(); if (drag) move(drag.from, i); setDrag(null); }}
            style={{ position: 'relative', opacity: drag?.from === i ? 0.45 : 1 }}>
            {line && <span style={{ position: 'absolute', left: 8, right: 8, [drag!.from < i ? 'bottom' : 'top']: -7, height: 3, borderRadius: 2, background: tk.accent.base }} />}
            <BehaviourCard id={c.key} picture={c.card as CardPicture} title={words.title} hint={words.hint} summary={cardSummary(c)}
              hot={hotCard === c.key} handle={handle}
              on={c.on} onToggle={on => update(setOnAt(set, sp, c.at, on))}
              onRemove={() => update(removeAt(set, sp, c.at))}
              onlyWhen={<OnlyWhenLine id={c.key} set={set} sp={sp} when={c.when} onFocus={s => { focusCard(c.key); onFocusSetting(s); }}
                onChange={w => update(setOnlyWhen(set, sp, c.at, w))} />}
              more={moreSettings(c, set, sp, update, onFocusSetting)}>
              <CardSettings c={c} set={set} sp={sp} update={update} onFocus={onFocusSetting} />
            </BehaviourCard>
          </div>
        );
      })}
      {cards.length === 0 && <span style={{ fontSize: 12, color: tk.text.muted, padding: '2px 2px 0' }}>Nothing here yet: add one below.</span>}
      {missing.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {missing.map(id => (
            <button key={id} type="button" data-card-add={id} title={CARD_WORDS[id].hint} onClick={() => update(addCard(set, sp, id, cardsFor).set)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px 0 8px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` }}>
              <Icon name="plus" size={12} />{CARD_WORDS[id].title}
            </button>
          ))}
        </div>
      )}
      {section.reorder && cards.length > 1 && <span style={{ fontSize: 11, color: tk.text.faint, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="grip" size={12} />They run top to bottom: drag to reorder.</span>}
    </div>
  );
}

const WHO = [{ value: 'all' as const, label: 'Any kind' }, { value: 'own' as const, label: 'Its kind' }, { value: 'others' as const, label: 'Others' }];

/** The sliders a card shows. */
function CardSettings({ c, set, sp, update, onFocus }: { c: CardRead; set: AgentRuleSet; sp: number; update: (s: AgentRuleSet) => void; onFocus: (s: string | undefined) => void }) {
  const patch = <A extends RuleAction>(p: Partial<A>) => update(patchAt<A>(set, sp, c.at, p));
  const a = c.action;
  switch (a.kind) {
    case 'force': {
      if (a.field === 'gravity' || a.field === 'wind') return <>
        <SliderSetting id="strength" label="Strength" hint={MORE_HINTS.strength} value={a.strength} min={0} max={3} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'force'>>({ strength: v })} />
        <SliderSetting id="angle" label="Direction (°)" hint={MORE_HINTS.direction} value={a.angle ?? (a.field === 'gravity' ? -90 : 0)} min={-180} max={180} step={1} onFocus={onFocus} onChange={v => patch<Act<'force'>>({ angle: v })} />
      </>;
      if (a.field === 'curl') return <>
        <SliderSetting id="strength" label="Strength" hint={MORE_HINTS.strength} value={a.strength} min={0} max={3} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'force'>>({ strength: v })} />
        <SliderSetting id="flowSize" label="Eddies" hint={MORE_HINTS.flowSize} value={set.flow.size} min={0.2} max={4} step={0.05} onFocus={onFocus} onChange={v => update(setFlow(set, { size: v }))} />
      </>;
      return <>
        <SliderSetting id="strength" label="Pull (− pushes)" hint={MORE_HINTS.strength} value={a.strength} min={-3} max={3} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'force'>>({ strength: v })} />
        <SettingRow id="target" label="Toward" hint={MORE_HINTS.target} onFocus={onFocus}>
          <Segmented size="sm" fill ariaLabel="Toward" value={a.field === 'mouse' ? 'mouse' : 'point'} onChange={v => patch<Act<'force'>>({ field: v })}
            options={[{ value: 'point' as const, label: 'A point' }, { value: 'mouse' as const, label: 'The mouse' }]} />
        </SettingRow>
        {a.field === 'point' && <>
          <SliderSetting id="x" label="Across" value={a.x ?? 0} min={-1.8} max={1.8} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'force'>>({ x: v })} />
          <SliderSetting id="y" label="Up" value={a.y ?? 0} min={-1} max={1} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'force'>>({ y: v })} />
        </>}
      </>;
    }
    case 'drag': return <SliderSetting id="drag" label="Drag" hint={MORE_HINTS.dragAmount} value={a.amount} min={0} max={4} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'drag'>>({ amount: v })} />;
    case 'fade': return <SliderSetting id="fade" label="Fades over (s)" hint={MORE_HINTS.fadeSeconds} value={a.seconds} min={0.1} max={20} step={0.1} onFocus={onFocus} onChange={v => patch<Act<'fade'>>({ seconds: Math.max(0.1, v) })} />;
    case 'die': {
      const w = c.when;
      if (w?.kind !== 'age') return null;
      return <SliderSetting id="dieAfter" label="Dies after (s)" hint="Seconds from its birth (its only when: older than)." value={w.seconds} min={0} max={20} step={0.1} onFocus={onFocus}
        onChange={v => update(setOnlyWhen(set, sp, c.at, { ...w, seconds: v } as RuleCondition))} />;
    }
    case 'separate': case 'match': case 'cohere':
      return <SliderSetting id="degrees" label="How hard (° a step)" hint={MORE_HINTS.degrees} value={a.degrees} min={0} max={45} step={0.5} onFocus={onFocus} onChange={v => patch<Act<'separate'>>({ degrees: v })} />;
    case 'avoidEdges': return <>
      <SliderSetting id="degrees" label="How hard (° a step)" hint={MORE_HINTS.degrees} value={a.degrees} min={0} max={45} step={0.5} onFocus={onFocus} onChange={v => patch<Act<'avoidEdges'>>({ degrees: v })} />
      <SliderSetting id="margin" label="From the edge" hint={MORE_HINTS.margin} value={a.margin} min={0} max={0.6} step={0.005} onFocus={onFocus} onChange={v => patch<Act<'avoidEdges'>>({ margin: v })} />
    </>;
    case 'turn': return <>
      <SettingRow id="target" label="Toward" hint={MORE_HINTS.target} onFocus={onFocus}>
        <Segmented size="sm" fill ariaLabel="Head for" value={a.toward === 'trail' ? 'point' : a.toward} onChange={v => patch<Act<'turn'>>({ toward: v })}
          options={[{ value: 'point' as const, label: 'A point' }, { value: 'centre' as const, label: 'Centre' }, { value: 'mouse' as const, label: 'Mouse' }]} />
      </SettingRow>
      {a.toward === 'point' && <>
        <SliderSetting id="x" label="Across" value={a.x ?? 0} min={-50} max={50} step={0.05} onFocus={onFocus} onChange={v => patch<Act<'turn'>>({ x: v })} />
        <SliderSetting id="y" label="Up" value={a.y ?? 0} min={-50} max={50} step={0.05} onFocus={onFocus} onChange={v => patch<Act<'turn'>>({ y: v })} />
      </>}
      <SliderSetting id="degrees" label="How hard (° a step)" hint={MORE_HINTS.degrees} value={a.degrees} min={0} max={45} step={0.5} onFocus={onFocus} onChange={v => patch<Act<'turn'>>({ degrees: v })} />
    </>;
    case 'slow': return <SliderSetting id="jam" label="Jam at" hint={MORE_HINTS.jam} value={a.jam} min={1} max={100} step={1} onFocus={onFocus} onChange={v => patch<Act<'slow'>>({ jam: Math.max(1, Math.round(v)) })} />;
    case 'orbit': return <>
      <SettingRow id="target" label="Round" hint={MORE_HINTS.target} onFocus={onFocus}>
        <Segmented size="sm" fill ariaLabel="Orbit round" value={a.target} onChange={v => patch<Act<'orbit'>>({ target: v })}
          options={[{ value: 'centre' as const, label: 'Centre' }, { value: 'point' as const, label: 'A point' }, { value: 'mouse' as const, label: 'Mouse' }]} />
      </SettingRow>
      {a.target === 'point' && <>
        <SliderSetting id="x" label="Across" value={a.x ?? 0} min={-1.8} max={1.8} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'orbit'>>({ x: v })} />
        <SliderSetting id="y" label="Up" value={a.y ?? 0} min={-1} max={1} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'orbit'>>({ y: v })} />
      </>}
      <SliderSetting id="distance" label="Radius" hint={MORE_HINTS.distance} value={a.distance} min={0.02} max={1.5} step={0.01} onFocus={onFocus} onChange={v => patch<Act<'orbit'>>({ distance: Math.max(0.02, v) })} />
      <SettingRow id="way" label="Way round" hint={MORE_HINTS.direction2} onFocus={onFocus}>
        <Segmented size="sm" fill ariaLabel="Way round" value={a.cw ? 'cw' : 'ccw'} onChange={v => patch<Act<'orbit'>>({ cw: v === 'cw' || undefined })}
          options={[{ value: 'ccw' as const, label: '↺ Anticlockwise' }, { value: 'cw' as const, label: '↻ Clockwise' }]} />
      </SettingRow>
      <SliderSetting id="degrees" label="How hard (° a step)" hint={MORE_HINTS.degrees} value={a.degrees} min={0} max={30} step={0.5} onFocus={onFocus} onChange={v => patch<Act<'orbit'>>({ degrees: v })} />
    </>;
    case 'wander': return <SliderSetting id="wobble" label="Wander (±°)" hint="A random turn of up to this many degrees each step." value={a.degrees} min={0} max={45} step={0.5} onFocus={onFocus} onChange={v => patch<Act<'wander'>>({ degrees: v })} />;
    default: return null;
  }
}

/** The folded settings ("More") of a card: whose neighbours it reads, and how far. */
function moreSettings(c: CardRead, set: AgentRuleSet, sp: number, update: (s: AgentRuleSet) => void, onFocus: (s: string | undefined) => void): ReactNode {
  const a = c.action;
  if (a.kind === 'separate' || a.kind === 'match' || a.kind === 'cohere' || a.kind === 'slow') {
    return <>
      <SettingRow id="who" label="Reads" hint={MORE_HINTS.who} onFocus={onFocus}>
        <Segmented size="sm" fill ariaLabel="Which walkers it reads" value={a.who} onChange={(v: NeighbourWho) => update(patchAt(set, sp, c.at, { who: v }))} options={WHO} />
      </SettingRow>
      <SliderSetting id="reach" label="Reach (0: its view)" hint={MORE_HINTS.reach} value={a.radius ?? 0} min={0} max={0.25} step={0.001} onFocus={onFocus}
        onChange={v => update(patchAt(set, sp, c.at, { radius: v > 0 ? v : undefined }))} />
    </>;
  }
  if (a.kind === 'force' && a.field === 'curl') {
    return <SliderSetting id="flowEvolve" label="Changes" hint={MORE_HINTS.flowEvolve} value={set.flow.evolve} min={0} max={1} step={0.01} onFocus={onFocus} onChange={v => update(setFlow(set, { evolve: v }))} />;
  }
  return undefined;
}

/** A small caps heading with a one-line hint over a section's cards. */
export function SectionHint({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45, padding: '0 2px', borderLeft: `2px solid ${alpha(tk.accent.base, 0.25)}`, paddingLeft: 8 }}>{children}</span>;
}
