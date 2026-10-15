/**
 * The When … Do … rule editors (docs/agent-rules.md), shared by the Agent Builder's Advanced rules
 * (components/agentBuilder/AdvancedRules.tsx) and the old rules editor (NodeGraph/AgentRulesModal.tsx):
 * a rule's card, its When and Do lines, each condition's and action's pieces, and the small inputs.
 */
import React from 'react';
import { fieldName } from '../../agentRules/fields';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { HintMark } from '../builders/BuilderWindow';
import { TypeAheadPicker } from '../builders/TypeAhead';
import { ACTION_HELP, CONDITION_HELP } from '../builders/helpContent';
import {
  DEFAULT_NEIGHBOURS, type AgentRule, type AgentRuleSet, type ChannelRef, type NeighbourWho, type RuleAction, type RuleCondition, type WalkerKind,
  actionKindsFor, conditionKindsFor, describeRule, newAction, newCondition,
} from '../../agentRules/spec';

type Tk = ReturnType<typeof useTokens>;

/** The channels a rule can name: its own trail, then the four by name. */
export const channelOptionsOf = (set: AgentRuleSet) => [{ value: 'own', label: 'its own trail' }, ...[0, 1, 2, 3].map(c => ({ value: String(c), label: set.channels[c]?.trim() ? `${set.channels[c].trim()} (${c + 1})` : `trail ${c + 1}` }))];

export interface EditCtx { set: AgentRuleSet; s: number; tk: Tk; channelOptions: Array<{ value: string; label: string }>; kind: WalkerKind }

export function RuleCard({ i, n, rule, ctx, lines, onChange, onMove, onRemove, onDuplicate }: {
  i: number; n: number; rule: AgentRule; ctx: EditCtx; lines?: string;
  onChange: (r: AgentRule) => void; onMove: (to: number) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  const { tk } = ctx;
  return (
    <div data-rule={i + 1} style={{ border: `1px solid ${tk.border.default}`, borderRadius: radius.control, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, opacity: rule.off ? 0.5 : 1, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: `700 12px ${fontFamily.mono}`, color: tk.text.faint, width: 20 }}>{i + 1}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={describeRule(ctx.set, ctx.s, rule)}>{describeRule(ctx.set, ctx.s, rule)}</span>
        <Toggle checked={!rule.off} onChange={on => onChange({ ...rule, off: !on })} label="On" />
        <IconButton icon="chevU" label="Move up" size="sm" tooltip={false} disabled={i === 0} onClick={() => onMove(i - 1)} />
        <IconButton icon="chevD" label="Move down" size="sm" tooltip={false} disabled={i === n - 1} onClick={() => onMove(i + 1)} />
        <IconButton icon="plus" label="Duplicate rule" size="sm" tooltip={false} onClick={onDuplicate} />
        <IconButton icon="close" label="Remove rule" size="sm" tone="danger" tooltip={false} onClick={onRemove} />
      </div>
      <RuleLines rule={rule} ctx={ctx} onChange={onChange} />
      {lines !== undefined && (
        <pre style={{ margin: 0, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, color: tk.text.secondary, font: `500 11px/1.5 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{lines}</pre>
      )}
    </div>
  );
}

/** A rule's When … and Do … lines (each piece editable, + and… / + do… to add) and its "Stop after this rule". */
export function RuleLines({ rule, ctx, onChange }: { rule: AgentRule; ctx: EditCtx; onChange: (r: AgentRule) => void }) {
  const when = rule.when.length ? rule.when : [{ kind: 'always' } as RuleCondition];
  const setWhen = (list: RuleCondition[]) => onChange({ ...rule, when: list.length ? list : [{ kind: 'always' }] });
  return (
    <>
      <Line word="When">
        {when.map((c, j) => (
          <React.Fragment key={j}>
            <Piece lead={j > 0 ? 'and' : 'If'} hint={CONDITION_HELP[c.kind].hint} onRemove={rule.when.length > 1 || c.kind !== 'always' ? () => setWhen(when.filter((_, k) => k !== j)) : undefined}>
              <ConditionEditor c={c} ctx={ctx} onChange={x => setWhen(when.map((y, k) => (k === j ? x : y)))} />
            </Piece>
          </React.Fragment>
        ))}
        <AddRow><TypeAheadPicker ariaLabel="Add a condition" placeholder="+ Add condition" width={150} accent
          items={conditionKindsFor(ctx.kind).map(k => ({ value: k.kind, label: k.label, hint: CONDITION_HELP[k.kind].hint, example: CONDITION_HELP[k.kind].example, words: [k.kind] }))}
          onPick={k => setWhen([...when.filter(x => x.kind !== 'always'), newCondition(k as RuleCondition['kind'])])} /></AddRow>
      </Line>
      <Line word="Then">
        {rule.do.map((a, j) => (
          <Piece key={j} lead={j > 0 ? 'then' : 'Do'} hint={ACTION_HELP[a.kind].hint} onRemove={() => onChange({ ...rule, do: rule.do.filter((_, k) => k !== j) })}>
            <ActionEditor a={a} ctx={ctx} onChange={x => onChange({ ...rule, do: rule.do.map((y, k) => (k === j ? x : y)) })} />
          </Piece>
        ))}
        <AddRow><TypeAheadPicker ariaLabel="Add an action" placeholder="+ Add action" width={150} accent
          items={actionKindsFor(ctx.kind).map(k => ({ value: k.kind, label: k.label, hint: ACTION_HELP[k.kind].hint, example: ACTION_HELP[k.kind].example, words: [k.kind] }))}
          onPick={k => onChange({ ...rule, do: [...rule.do, newAction(k as RuleAction['kind'])] })} /></AddRow>
      </Line>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Toggle checked={!!rule.stop} onChange={v => onChange({ ...rule, stop: v })} label="Stop after this rule" />
        <HintMark text="When this rule applies, the rules below it are skipped for that walker this step." />
      </div>
    </>
  );
}

export function ConditionEditor({ c, ctx, onChange }: { c: RuleCondition; ctx: EditCtx; onChange: (c: RuleCondition) => void }) {
  const { set, s } = ctx;
  const cmp = (v: string, f: (x: '>' | '<') => void, eq = false) => <Small value={v} options={[{ value: '>', label: '>' }, { value: '<', label: '<' }, ...(eq ? [{ value: '=', label: '=' }] : [])]} onChange={x => f(x as '>' | '<')} label="compare" />;
  switch (c.kind) {
    case 'always': return <Word>always</Word>;
    case 'sense': return <>
      <Small label="channel" value={String(c.channel)} options={ctx.channelOptions} onChange={v => onChange({ ...c, channel: (v === 'own' ? 'own' : Number(v)) as ChannelRef })} />
      <Small label="where" value={c.where} options={[{ value: 'ahead', label: 'ahead' }, { value: 'left', label: 'to the left' }, { value: 'right', label: 'to the right' }, { value: 'any', label: 'anywhere ahead' }, { value: 'here', label: 'here' }]} onChange={v => onChange({ ...c, where: v as typeof c.where })} />
      {cmp(c.cmp, x => onChange({ ...c, cmp: x }))}
      <Num value={c.value} step={0.05} onCommit={v => onChange({ ...c, value: v })} />
    </>;
    case 'near': return <>
      <Word>near</Word>
      <Small label="species" value={String(c.species)} options={set.species.map((x, i) => ({ value: String(i), label: `${x.name || `species ${i + 1}`}'s trail` })).concat(set.species.length < 2 ? [{ value: '1', label: 'species 2\'s trail' }] : [])} onChange={v => onChange({ ...c, species: Number(v) })} />
      <Word>&gt;</Word><Num value={c.value} step={0.05} onCommit={v => onChange({ ...c, value: v })} />
    </>;
    case 'chance': return <>
      <Word>a</Word><Num value={Math.round(c.perSecond * 1000) / 10} step={1} onCommit={v => onChange({ ...c, perSecond: Math.min(Math.max(v / 100, 0), 1) })} /><Word>% chance a second</Word>
    </>;
    case 'age': return <><Word>age</Word>{cmp(c.cmp, x => onChange({ ...c, cmp: x }))}<Num value={c.seconds} step={0.1} onCommit={v => onChange({ ...c, seconds: v })} /><Word>s</Word></>;
    case 'state': return <>
      <Small label="in" value={c.not ? 'not' : 'in'} options={[{ value: 'in', label: 'in state' }, { value: 'not', label: 'not in state' }]} onChange={v => onChange({ ...c, not: v === 'not' })} />
      <Small label="state" value={String(c.state)} options={set.species[s].states.map((x, i) => ({ value: String(i), label: x.name || `state ${i + 1}` }))} onChange={v => onChange({ ...c, state: Number(v) })} />
    </>;
    case 'memory': return <><Word>Memory number</Word>{cmp(c.cmp, x => onChange({ ...c, cmp: x }), true)}<Num value={c.value} step={0.1} onCommit={v => onChange({ ...c, value: v })} /></>;
    case 'mask': return set.masks.length ? <>
      <Small label="mask" value={String(c.mask)} options={set.masks.map((m, i) => ({ value: String(i), label: m.name || `mask ${i + 1}` }))} onChange={v => onChange({ ...c, mask: Number(v) })} />
      {cmp(c.cmp, x => onChange({ ...c, cmp: x }))}
      <Num value={c.value} step={0.05} onCommit={v => onChange({ ...c, value: v })} />
    </> : <Word>inside a mask (add one under Masks)</Word>;
    case 'neighbours': return <>
      <Small label="more or fewer" value={c.cmp} options={[{ value: '>', label: 'more than' }, { value: '<', label: 'fewer than' }]} onChange={v => onChange({ ...c, cmp: v as '>' | '<' })} />
      <Num value={c.count} step={1} onCommit={v => onChange({ ...c, count: Math.max(0, v) })} />
      <Who value={c.who} onChange={who => onChange({ ...c, who })} />
      <Reach set={set} value={c.radius} onChange={radius => onChange({ ...c, radius })} />
    </>;
    case 'shape': return <>
      <Small label="inside or outside" value={c.outside ? 'outside' : 'inside'} options={[{ value: 'inside', label: 'inside' }, { value: 'outside', label: 'outside' }]} onChange={v => onChange({ ...c, outside: v === 'outside' ? true : undefined })} />
      <Small label="which shape" value={c.shape} options={[{ value: 'circle', label: 'a circle' }, { value: 'box', label: 'a box' }]} onChange={v => onChange({ ...c, shape: v as 'circle' | 'box' })} />
      <Word>x</Word><Num value={c.x} step={0.05} onCommit={v => onChange({ ...c, x: v })} />
      <Word>y</Word><Num value={c.y} step={0.05} onCommit={v => onChange({ ...c, y: v })} />
      <Word>{c.shape === 'circle' ? 'radius' : 'half-width'}</Word><Num value={c.size} step={0.05} onCommit={v => onChange({ ...c, size: Math.max(0, v) })} />
    </>;
  }
}

const WHO_OPTIONS: Array<{ value: NeighbourWho; label: string }> = [{ value: 'all', label: 'neighbours' }, { value: 'own', label: 'of its own kind' }, { value: 'others', label: 'of other kinds' }];
export function Who({ value, onChange }: { value: NeighbourWho; onChange: (w: NeighbourWho) => void }) {
  return <Small label="which walkers" value={value} options={WHO_OPTIONS} onChange={v => onChange(v as NeighbourWho)} />;
}
/** "within r": the reading's own radius, or (0) the rule set's View radius. */
export function Reach({ set, value, onChange }: { set: AgentRuleSet; value?: number; onChange: (r: number | undefined) => void }) {
  return <><Word>within</Word><Num value={value ?? set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius} step={0.005} onCommit={v => onChange(v > 0 ? v : undefined)} title="How far it looks (picture units). The View radius on the Species tab unless set here." /></>;
}

export function ActionEditor({ a, ctx, onChange }: { a: RuleAction; ctx: EditCtx; onChange: (a: RuleAction) => void }) {
  const { set, s } = ctx;
  const deg = (v: number, f: (x: number) => void) => <><Num value={v} step={1} onCommit={f} /><Word>°</Word></>;
  switch (a.kind) {
    case 'turn': return <>
      <Small label="turn" value={a.away ? 'away' : 'toward'} options={[{ value: 'toward', label: 'turn toward' }, { value: 'away', label: 'turn away from' }]} onChange={v => onChange({ ...a, away: v === 'away' })} />
      <Small label="target" value={a.toward} options={[{ value: 'trail', label: 'a trail' }, { value: 'point', label: 'a point' }, { value: 'centre', label: 'the centre' }, { value: 'mouse', label: 'the mouse' }]} onChange={v => onChange({ ...a, toward: v as typeof a.toward })} />
      {a.toward === 'trail' && <Small label="channel" value={String(a.channel ?? 'own')} options={ctx.channelOptions} onChange={v => onChange({ ...a, channel: (v === 'own' ? 'own' : Number(v)) as ChannelRef })} />}
      {a.toward === 'point' && <><Word>x</Word><Num value={a.x ?? 0} step={0.05} onCommit={v => onChange({ ...a, x: v })} /><Word>y</Word><Num value={a.y ?? 0} step={0.05} onCommit={v => onChange({ ...a, y: v })} /></>}
      {deg(a.degrees, v => onChange({ ...a, degrees: v }))}
    </>;
    case 'wander': return <><Word>wander ±</Word>{deg(a.degrees, v => onChange({ ...a, degrees: v }))}</>;
    case 'speed': return <>
      <Small label="speed" value={a.mode} options={[{ value: 'set', label: 'set speed' }, { value: 'add', label: 'accelerate (a second)' }]} onChange={v => onChange({ ...a, mode: v as 'set' | 'add' })} />
      <Num value={a.value} step={0.01} onCommit={v => onChange({ ...a, value: v })} />
    </>;
    case 'trail': return <>
      <Word>leave</Word>
      <Small label="channel" value={String(a.channel)} options={ctx.channelOptions} onChange={v => onChange({ ...a, channel: (v === 'own' ? 'own' : Number(v)) as ChannelRef })} />
      <Num value={a.amount} step={0.1} onCommit={v => onChange({ ...a, amount: v })} />
      <Word>fade</Word><Num value={a.fade ?? 0} step={0.05} onCommit={v => onChange({ ...a, fade: v || undefined })} title="Weaker the bigger its Memory number: × e^(−fade × number). 0: off." />
    </>;
    case 'state': return <><Word>become</Word><Small label="state" value={String(a.state)} options={set.species[s].states.map((x, i) => ({ value: String(i), label: x.name || `state ${i + 1}` }))} onChange={v => onChange({ ...a, state: Number(v) })} /></>;
    case 'memory': return <>
      <Small label="memory" value={a.mode} options={[{ value: 'set', label: 'set Memory number to' }, { value: 'add', label: 'add to Memory number' }, { value: 'perSecond', label: 'count Memory number up (a second)' }, { value: 'random', label: 'Memory number = random 0 to' }]} onChange={v => onChange({ ...a, mode: v as typeof a.mode })} />
      <Num value={a.value} step={0.1} onCommit={v => onChange({ ...a, value: v })} />
    </>;
    case 'spawn': return <><Word>spawn a child · mark</Word><Num value={a.amount} step={0.1} onCommit={v => onChange({ ...a, amount: v })} /></>;
    case 'flow': return <>
      <Small label="flow" value={a.away ? 'against' : 'follow'} options={[{ value: 'follow', label: 'follow the flow field' }, { value: 'against', label: 'go against the flow field' }]} onChange={v => onChange({ ...a, away: v === 'against' })} />
      {deg(a.degrees, v => onChange({ ...a, degrees: v }))}
    </>;
    case 'align': return <><Word>align with the crowd</Word>{deg(a.degrees, v => onChange({ ...a, degrees: v }))}</>;
    case 'separate': case 'match': case 'cohere': return <>
      <Word>{a.kind === 'separate' ? 'steer away from' : a.kind === 'match' ? 'match the heading of' : 'move to the centre of'}</Word>
      <Who value={a.who} onChange={who => onChange({ ...a, who })} />
      <Reach set={set} value={a.radius} onChange={radius => onChange({ ...a, radius })} />
      {deg(a.degrees, v => onChange({ ...a, degrees: v }))}
    </>;
    case 'slow': return <>
      <Word>slow down as</Word><Who value={a.who} onChange={who => onChange({ ...a, who })} />
      <Reach set={set} value={a.radius} onChange={radius => onChange({ ...a, radius })} />
      <Word>reach</Word><Num value={a.jam} step={1} onCommit={v => onChange({ ...a, jam: Math.max(0.1, v) })} title="Jam: how many neighbours stop it (almost)" />
    </>;
    case 'avoidEdges': return <><Word>avoid the edges within</Word><Num value={a.margin} step={0.01} onCommit={v => onChange({ ...a, margin: Math.max(0, v) })} />{deg(a.degrees, v => onChange({ ...a, degrees: v }))}</>;
    case 'orbit': return <>
      <Word>orbit</Word>
      <Small label="target" value={a.target} options={[{ value: 'centre', label: 'the centre' }, { value: 'point', label: 'a point' }, { value: 'mouse', label: 'the mouse' }]} onChange={v => onChange({ ...a, target: v as typeof a.target })} />
      {a.target === 'point' && <><Word>x</Word><Num value={a.x ?? 0} step={0.05} onCommit={v => onChange({ ...a, x: v })} /><Word>y</Word><Num value={a.y ?? 0} step={0.05} onCommit={v => onChange({ ...a, y: v })} /></>}
      <Word>at</Word><Num value={a.distance} step={0.05} onCommit={v => onChange({ ...a, distance: Math.max(0.01, v) })} />
      <Small label="direction" value={a.cw ? 'cw' : 'ccw'} options={[{ value: 'ccw', label: 'counter-clockwise' }, { value: 'cw', label: 'clockwise' }]} onChange={v => onChange({ ...a, cw: v === 'cw' })} />
      {deg(a.degrees, v => onChange({ ...a, degrees: v }))}
    </>;
    case 'force': return <>
      <Word>apply</Word>
      <Small label="force" value={a.field} options={[{ value: 'gravity', label: 'gravity' }, { value: 'wind', label: 'wind (gusty)' }, { value: 'curl', label: 'curl noise' }, { value: 'point', label: 'a pull to a point' }, { value: 'mouse', label: 'a pull to the mouse' }]} onChange={v => onChange({ ...a, field: v as typeof a.field })} />
      <Num value={a.strength} step={0.05} onCommit={v => onChange({ ...a, strength: v })} title="Strength, picture units a second² (negative pushes away from a point or the mouse)" />
      {(a.field === 'gravity' || a.field === 'wind') && <><Word>at</Word><Num value={a.angle ?? (a.field === 'gravity' ? -90 : 0)} step={5} onCommit={v => onChange({ ...a, angle: v })} title="Direction in degrees: 0 right, 90 up, −90 down" /><Word>°</Word></>}
      {a.field === 'point' && <><Word>x</Word><Num value={a.x ?? 0} step={0.05} onCommit={v => onChange({ ...a, x: v })} /><Word>y</Word><Num value={a.y ?? 0} step={0.05} onCommit={v => onChange({ ...a, y: v })} /></>}
    </>;
    case 'field': return <>
      <Word>follow a field</Word>
      <span title="Its layers are built in the Agent Builder's Follow a field card (Forces)." style={{ fontSize: 12, opacity: 0.75 }}>({fieldName(a.spec)})</span>
      <Word>×</Word><Num value={a.strength} step={0.05} onCommit={v => onChange({ ...a, strength: v })} title="Strength: the field's velocity times this" />
      <Small label="how" value={a.grip ? 'ride' : 'push'} options={[{ value: 'ride', label: 'riding it' }, { value: 'push', label: 'as a force' }]} onChange={v => onChange({ ...a, grip: v === 'ride' ? (a.grip || 3) : undefined })} />
    </>;
    case 'drag': return <><Word>drag</Word><Num value={a.amount} step={0.05} onCommit={v => onChange({ ...a, amount: Math.max(0, v) })} /><Word>a second</Word></>;
    case 'fade': return <><Word>fade with age over</Word><Num value={a.seconds} step={0.1} onCommit={v => onChange({ ...a, seconds: Math.max(0.01, v) })} /><Word>s</Word></>;
    case 'stop': return <Word>stop</Word>;
    case 'stick': return <Word>stick (never move again)</Word>;
    case 'die': return <Word>die</Word>;
    case 'bounce': return <Word>bounce (turn round)</Word>;
  }
}

// ── Small pieces ─────────────────────────────────────────────────────────────

/**
 * A rule's When or Then, laid out like a filter builder: a tinted group with its caption, then one row a piece,
 * each led by a word in a narrow gutter (If / and, Do / then) so the fields line up, then its Add button.
 */
export function Line({ word, children }: { word: string; children: React.ReactNode }) {
  const tk = useTokens();
  const when = word === 'When';
  const hue = when ? tk.kind.expr : tk.accent.base;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 8px 6px', borderRadius: radius.md, background: alpha(hue, 0.06), boxShadow: `inset 0 0 0 1px ${alpha(hue, 0.18)}` }}>
      <span title={when ? 'Checked every step for each walker. All must hold.' : 'What the walker does when they hold, in order.'}
        style={{ font: `600 11.5px ${fontFamily.ui}`, color: tk.text.secondary, cursor: 'help', paddingBottom: 2 }}>
        {when ? 'When all of these are true' : 'Then do these, in order'}
      </span>
      {children}
    </div>
  );
}

/** One condition or action, a row: its lead word in the gutter, its fields, and its ? and × (on hover or focus; always on touch). */
export function Piece({ children, onRemove, hint, lead }: { children: React.ReactNode; onRemove?: () => void; hint?: string; lead?: string }) {
  const tk = useTokens();
  const [hot, setHot] = React.useState(false);
  const show = hot || IS_TOUCH;
  return (
    <span onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)} onFocus={() => setHot(true)} onBlur={() => setHot(false)}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 6, minHeight: 30, width: '100%', boxSizing: 'border-box', padding: '2px 0', borderRadius: radius.sm, background: hot ? alpha(tk.text.primary, 0.03) : 'transparent' }}>
      <span style={{ width: 30, flexShrink: 0, paddingTop: 6, textAlign: 'right', font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>{lead ?? ''}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>{children}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, paddingTop: 4, opacity: show ? 1 : 0, transition: 'opacity 120ms' }}>
        {hint && <HintMark text={hint} />}
        {onRemove && <button type="button" aria-label="Remove" title="Remove" onClick={onRemove} style={{ width: 20, height: 20, padding: 0, border: 0, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={12} /></button>}
      </span>
    </span>
  );
}

/** The Add row under a group: in the gutter's line, an accent "+ Add …" picker. */
function AddRow({ children }: { children: React.ReactNode }) {
  return <span data-rule-add-row="" style={{ display: 'flex', gap: 6, paddingLeft: 36 }}>{children}</span>;
}

const IS_TOUCH = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;


export function Word({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12.5, color: tk.text.secondary, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function Small({ value, options, onChange, label }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; label: string }) {
  return <Select ariaLabel={label} value={value} options={options} onChange={onChange} height={26} style={{ maxWidth: 220 }} />;
}

export function Num({ value, step, onCommit, title }: { value: number; step: number; onCommit: (v: number) => void; title?: string }) {
  const tk = useTokens();
  return <NumberInput value={value} step={step} title={title} onCommit={v => { if (isFinite(v)) onCommit(v); }}
    style={{ width: 58, height: 26, boxSizing: 'border-box', padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.md, background: tk.bg.panel, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`, textAlign: 'center', boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />;
}

