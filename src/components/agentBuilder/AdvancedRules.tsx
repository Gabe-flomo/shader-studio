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
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { type AgentRule, type AgentRuleSet, defaultRule, describeRule, kindOf } from '../../agentRules/spec';
import { type EditCtx, RuleLines, channelOptionsOf } from '../agentRules/RuleEditors';
import { MuteToggle, MutedTag, MUTED_DIM } from '../builders/MuteToggle';
import { clampLines } from '../ui/textFit';
import { removeKeys } from '../builders/removable';
import { ruleTitle } from '../../agentRules/ruleNames';

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
  // A rule just added starts open (to fill it in); the others start folded.
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const add = () => { setJustAdded(rules.length); setRules([...rules, defaultRule()]); onView('all'); };
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
        <AdvancedRuleCard key={i} i={i} n={rules.length} rule={rules[i]} ctx={ctx} startOpen={i === justAdded}
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

/**
 * One rule as a builder card, folded to its name and sentence until opened: its order (#2: rules run top to bottom),
 * its name (double-click or the pencil to rename; empty goes back to the name from what it does, "Die when older than 6 s"), on/off; open, move, duplicate, take
 * away, and its When … Then … lines.
 */
function AdvancedRuleCard({ i, n, rule, ctx, onChange, onMove, onDuplicate, onRemove, startOpen = false }: {
  i: number; n: number; rule: AgentRule; ctx: EditCtx; startOpen?: boolean;
  onChange: (r: AgentRule) => void; onMove: (to: number) => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(startOpen);
  const [naming, setNaming] = useState(false);
  const text = describeRule(ctx.set, ctx.s, rule);
  const title = ruleTitle(ctx.set, ctx.s, rule);
  const commitName = (v: string) => { setNaming(false); const t = v.trim(); if (t !== (rule.name ?? '')) onChange(t ? { ...rule, name: t } : (({ name: _n, ...r }) => r)(rule)); };
  return (
    <section data-card={`rule-${i}`} data-advanced-rule={i} {...removeKeys(onRemove, `rule ${i + 1}`)}
      style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${rule.off ? tk.border.subtle : tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span title={`Runs ${i + 1}${n > 1 ? ` of ${n}` : ''}: rules run top to bottom, every step`}
          style={{ flexShrink: 0, minWidth: 24, height: 22, marginTop: 1, borderRadius: radius.sm, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: `650 11px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.field }}>#{i + 1}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          {naming ? (
            <input autoFocus defaultValue={rule.name ?? ''} placeholder={ruleTitle(ctx.set, ctx.s, { ...rule, name: undefined })} aria-label="Rule name" data-rule-name-input={i}
              onKeyDown={e => { if (e.key === 'Enter') commitName((e.target as HTMLInputElement).value); if (e.key === 'Escape') { e.stopPropagation(); setNaming(false); } }}
              onBlur={e => commitName(e.target.value)}
              style={{ font: `650 13px ${fontFamily.ui}`, padding: '2px 6px', borderRadius: radius.sm, border: `1px solid ${tk.border.strong}`, background: tk.bg.field, color: tk.text.primary, minWidth: 0 }} />
          ) : (
            <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} onDoubleClick={() => setNaming(true)} title="Open or fold · double-click to rename"
              style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
              <b data-rule-title={i} style={{ fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
            </button>
          )}
          <span data-advanced-text style={{ fontSize: 11.5, lineHeight: 1.35, color: rule.off ? tk.text.faint : tk.text.muted, ...clampLines(open ? 4 : 2) }}>{text}</span>
        </div>
        {rule.off && <MutedTag />}
        <span data-rule-switch={i}><MuteToggle muted={!!rule.off} what={`rule ${i + 1}`} onToggle={() => onChange({ ...rule, off: !rule.off })} /></span>
      </div>
      {open && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: -4 }}>
            <IconButton icon="edit" label="Rename this rule" size="sm" onClick={() => setNaming(true)} data-rule-rename={i} />
            <span style={{ flex: 1 }} />
            <IconButton icon="chevU" label="Move up (runs earlier)" size="sm" disabled={i === 0} onClick={() => onMove(i - 1)} />
            <IconButton icon="chevD" label="Move down (runs later)" size="sm" disabled={i === n - 1} onClick={() => onMove(i + 1)} />
            <IconButton icon="plus" label="Duplicate this rule" size="sm" onClick={onDuplicate} />
            <IconButton icon="close" label="Take this rule away (Delete)" size="sm" tone="danger" onClick={onRemove} data-rule-remove={i} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(rule.off ? MUTED_DIM : {}) }}><RuleLines rule={rule} ctx={ctx} onChange={onChange} /></div>
        </>
      )}
    </section>
  );
}
