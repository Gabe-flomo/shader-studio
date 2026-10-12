/**
 * The Agent Builder's Advanced rules (docs/agent-builder.md "Advanced rules"): the rules the cards
 * can't show (two conditions, Stop, states, masks…), edited right here as a list of cards in the
 * builder's style, each its When … Do … lines (components/agentRules/RuleEditors.tsx, the same
 * pieces the old rules editor used). "Every rule" lists all of the kind's rules, top to bottom, so
 * nothing needs the old rules editor any more. Edits go through the builder's own update (applied a
 * quarter of a second after you stop, one undo step a burst).
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { type AgentRule, type AgentRuleSet, defaultRule, describeRule, kindOf } from '../../agentRules/spec';
import { type EditCtx, RuleLines, channelOptionsOf } from '../agentRules/RuleEditors';
import { CardGlyph } from './BehaviourCard';
import { MuteToggle, MutedTag, MUTED_DIM } from '../builders/MuteToggle';
import { clampLines } from '../ui/textFit';
import { removeKeys } from '../builders/removable';

export type AdvancedView = 'advanced' | 'all';

const move = <T,>(list: T[], from: number, to: number) => { const out = [...list]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out; };

/** The rule set with species `sp`'s rules replaced. */
export const withRules = (set: AgentRuleSet, sp: number, rules: AgentRule[]): AgentRuleSet =>
  ({ ...set, species: set.species.map((x, i) => (i === sp ? { ...x, rules } : x)) });

export function AdvancedRules({ set, sp, advanced, update, view, onView, intro }: {
  set: AgentRuleSet; sp: number;
  /** The rules (by index) the cards don't show (behaviours.ts readBehaviours). */
  advanced: ReadonlyArray<{ rule: number }>;
  update: (next: AgentRuleSet) => void;
  view: AdvancedView; onView: (v: AdvancedView) => void;
  intro?: React.ReactNode;
}) {
  const tk = useTokens();
  const rules = set.species[sp]?.rules ?? [];
  const ctx: EditCtx = { set, s: sp, tk, channelOptions: channelOptionsOf(set), kind: kindOf(set) };
  const shownIdx = view === 'all' ? rules.map((_, i) => i) : advanced.map(a => a.rule).filter(i => i < rules.length);
  const setRules = (next: AgentRule[]) => update(withRules(set, sp, next));
  const add = () => { setRules([...rules, defaultRule()]); onView('all'); };
  return (
    <div data-advanced-rules={view} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {intro}
      <Segmented size="sm" fill ariaLabel="Which rules" value={view} onChange={onView}
        options={[{ value: 'advanced' as const, label: `Only these (${advanced.length})` }, { value: 'all' as const, label: `Every rule (${rules.length})` }]} />
      {!shownIdx.length && (
        <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
          {view === 'advanced' ? 'Every rule is on a card. Every rule shows them all as When … Do … lines.' : 'No rules yet.'}
        </span>
      )}
      {shownIdx.map(i => (
        <AdvancedRuleCard key={i} i={i} n={rules.length} rule={rules[i]} ctx={ctx}
          onChange={r => setRules(rules.map((x, j) => (j === i ? r : x)))}
          onMove={to => setRules(move(rules, i, to))}
          onDuplicate={() => setRules([...rules.slice(0, i + 1), structuredClone(rules[i]), ...rules.slice(i + 1)])}
          onRemove={() => setRules(rules.filter((_, j) => j !== i))} />
      ))}
      <button type="button" data-add-rule onClick={add}
        style={{
          height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
          border: `1.5px dashed ${tk.border.strong}`, borderRadius: radius.card, background: 'none', color: tk.text.muted, font: `500 12.5px ${fontFamily.ui}`,
        }}>
        <Icon name="plus" size={15} />Add a rule
      </button>
    </div>
  );
}

/** One rule as a builder card: its number and sentence, on/off, move, duplicate, take away; then its When … Do … lines. */
function AdvancedRuleCard({ i, n, rule, ctx, onChange, onMove, onDuplicate, onRemove }: {
  i: number; n: number; rule: AgentRule; ctx: EditCtx;
  onChange: (r: AgentRule) => void; onMove: (to: number) => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(true);
  const text = describeRule(ctx.set, ctx.s, rule);
  return (
    <section data-card={`rule-${i}`} data-advanced-rule={i} {...removeKeys(onRemove, `rule ${i + 1}`)}
      style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${rule.off ? tk.border.subtle : tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CardGlyph kind="advanced" size={32} />
        <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}>
          <b style={{ fontSize: 13, fontWeight: 650 }}>Rule {i + 1}</b>
          <span data-advanced-text style={{ fontSize: 11.5, lineHeight: 1.35, color: rule.off ? tk.text.faint : tk.text.muted, ...clampLines(2) }}>{text}</span>
        </button>
        {rule.off && <MutedTag />}
        <span data-rule-switch={i}><MuteToggle muted={!!rule.off} what={`rule ${i + 1}`} onToggle={() => onChange({ ...rule, off: !rule.off })} /></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: -4 }}>
        <span style={{ flex: 1, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: alpha(tk.text.faint, 0.9) }}>runs {i + 1} of {n}</span>
        <IconButton icon="chevU" label="Move up" size="sm" disabled={i === 0} onClick={() => onMove(i - 1)} />
        <IconButton icon="chevD" label="Move down" size="sm" disabled={i === n - 1} onClick={() => onMove(i + 1)} />
        <IconButton icon="plus" label="Duplicate this rule" size="sm" onClick={onDuplicate} />
        <IconButton icon="close" label="Take this rule away (Delete)" size="sm" tone="danger" onClick={onRemove} data-rule-remove={i} />
      </div>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(rule.off ? MUTED_DIM : {}) }}><RuleLines rule={rule} ctx={ctx} onChange={onChange} /></div>}
    </section>
  );
}
