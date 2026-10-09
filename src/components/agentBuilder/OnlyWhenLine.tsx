/**
 * A behaviour card's "Only when…" line (docs/agent-builder.md): "+ Only when…" opens a picker of
 * plain conditions; once picked it is a small chip ("only when · older than 2 s") with its few
 * settings under it, and × takes it away. It is the card's rule's condition (behaviours.ts).
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import type { AgentRuleSet, ChannelRef, RuleCondition } from '../../agentRules/spec';
import { ONLY_WHEN_PICKER, newOnlyWhen, onlyWhenText } from '../../agentBuilder/onlyWhen';
import { smellChips } from '../../agentBuilder/cards';
import { ChipRow, SettingRow, SliderSetting } from './BehaviourCard';

export function OnlyWhenLine({ id, set, sp, when, onChange, onFocus }: {
  id: string; set: AgentRuleSet; sp: number; when: RuleCondition | null;
  onChange: (c: RuleCondition | null) => void;
  onFocus?: (setting: string | undefined) => void;
}) {
  const tk = useTokens();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  if (!when) {
    return (
      <div>
        <button type="button" data-only-when-add={id} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 6px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }}>
          <Icon name="plus" size={12} />Only when…
        </button>
        {menu && (
          <Menu x={menu.x} y={menu.y} title="Only when…" onClose={() => setMenu(null)}
            items={[{ heading: 'Only when' }, ...ONLY_WHEN_PICKER.map(p => ({ label: p.label, hint: p.hint, onSelect: () => { setOpen(true); onChange(newOnlyWhen(p.kind)); } }))]} />
        )}
      </div>
    );
  }
  const text = onlyWhenText(set, sp, when);
  return (
    <div data-only-when={id} data-only-when-kind={when.kind} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <button type="button" data-only-when-chip={id} aria-expanded={open} onClick={() => setOpen(v => !v)} title="Only when: this card only acts on a walker while this holds"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, height: 24, padding: '0 6px 0 9px', border: 0, borderRadius: 999, cursor: 'pointer',
            background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
          <span style={{ opacity: 0.75, fontWeight: 500 }}>only when</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
          <Icon name={open ? 'chevU' : 'chevD'} size={11} />
        </button>
        <button type="button" data-only-when-clear={id} aria-label="Always (take the only when away)" title="Always: take the only when away" onClick={() => onChange(null)}
          style={{ width: 22, height: 22, padding: 0, border: 0, borderRadius: 6, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={12} />
        </button>
      </span>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 10, borderLeft: `2px solid ${alpha(tk.accent.base, 0.3)}` }}>
        <ConditionSettings set={set} sp={sp} c={when} onChange={onChange} onFocus={onFocus} />
      </div>}
    </div>
  );
}

function ConditionSettings({ set, sp, c, onChange, onFocus }: { set: AgentRuleSet; sp: number; c: RuleCondition; onChange: (c: RuleCondition) => void; onFocus?: (s: string | undefined) => void }) {
  // The settings already carry their "when." id; the diagram reads it as the only when being edited.
  const f = (s: string | undefined) => onFocus?.(s);
  switch (c.kind) {
    case 'neighbours': return <>
      <SliderSetting id="when.count" label="More than" hint="How many walkers within its view (0: any one)." value={c.count} min={0} max={60} step={1} onFocus={f} onChange={v => onChange({ ...c, cmp: '>', count: Math.round(v) })} />
      <SettingRow id="when.who" label="Of" onFocus={f}>
        <Segmented size="sm" fill ariaLabel="Which walkers" value={c.who} onChange={v => onChange({ ...c, who: v })}
          options={[{ value: 'all' as const, label: 'Any kind' }, { value: 'own' as const, label: 'Its kind' }, { value: 'others' as const, label: 'Others' }]} />
      </SettingRow>
    </>;
    case 'sense': return <>
      <SettingRow id="when.channel" label="It smells" onFocus={f}>
        <ChipRow label="It smells" options={smellChips(set)} value={c.channel} onChange={v => onChange({ ...c, channel: v as ChannelRef })} />
      </SettingRow>
      <SliderSetting id="when.value" label={c.cmp === '>' ? 'Above' : 'Below'} value={c.value} min={0} max={2} step={0.01} onFocus={f} onChange={v => onChange({ ...c, value: v })}
        right={<Segmented size="sm" ariaLabel="Above or below" value={c.cmp} onChange={v => onChange({ ...c, cmp: v })} options={[{ value: '>' as const, label: 'Above' }, { value: '<' as const, label: 'Below' }]} />} />
    </>;
    case 'shape': return <>
      <SettingRow id="when.inside" label="Where" onFocus={f}>
        <span style={{ display: 'flex', gap: 6 }}>
          <Segmented size="sm" ariaLabel="Inside or outside" value={c.outside ? 'out' : 'in'} onChange={v => onChange({ ...c, outside: v === 'out' || undefined })} options={[{ value: 'in' as const, label: 'Inside' }, { value: 'out' as const, label: 'Outside' }]} />
          <Segmented size="sm" ariaLabel="Shape" value={c.shape} onChange={v => onChange({ ...c, shape: v })} options={[{ value: 'circle' as const, label: 'Circle' }, { value: 'box' as const, label: 'Box' }]} />
        </span>
      </SettingRow>
      <SliderSetting id="when.size" label={c.shape === 'circle' ? 'Radius' : 'Half-width'} value={c.size} min={0} max={1.5} step={0.01} onFocus={f} onChange={v => onChange({ ...c, size: v })} />
      <SliderSetting id="when.x" label="Across" value={c.x} min={-1.8} max={1.8} step={0.01} onFocus={f} onChange={v => onChange({ ...c, x: v })} />
      <SliderSetting id="when.y" label="Up" value={c.y} min={-1} max={1} step={0.01} onFocus={f} onChange={v => onChange({ ...c, y: v })} />
    </>;
    case 'age': return (
      <SliderSetting id="when.seconds" label={c.cmp === '>' ? 'Older than (s)' : 'Younger than (s)'} value={c.seconds} min={0} max={20} step={0.1} onFocus={f} onChange={v => onChange({ ...c, seconds: v })}
        right={<Segmented size="sm" ariaLabel="Older or younger" value={c.cmp} onChange={v => onChange({ ...c, cmp: v })} options={[{ value: '>' as const, label: 'Older' }, { value: '<' as const, label: 'Younger' }]} />} />
    );
    case 'chance': return (
      <SliderSetting id="when.chance" label="Chance a second (%)" value={Math.round(c.perSecond * 1000) / 10} min={0} max={100} step={0.5} onFocus={f} onChange={v => onChange({ ...c, perSecond: Math.min(Math.max(v / 100, 0), 1) })} />
    );
    case 'state': {
      const states = set.species[sp]?.states ?? [];
      return (
        <SettingRow id="when.state" label="In state" hint="States are made in the rules editor." onFocus={f}>
          <span style={{ display: 'flex', gap: 6 }}>
            <Segmented size="sm" ariaLabel="In or not in" value={c.not ? 'not' : 'in'} onChange={v => onChange({ ...c, not: v === 'not' || undefined })} options={[{ value: 'in' as const, label: 'In' }, { value: 'not' as const, label: 'Not in' }]} />
            <Select ariaLabel="State" value={String(c.state)} options={states.map((s, i) => ({ value: String(i), label: s.name || `state ${i + 1}` }))} onChange={v => onChange({ ...c, state: Number(v) })} />
          </span>
        </SettingRow>
      );
    }
    default: return null;
  }
}
