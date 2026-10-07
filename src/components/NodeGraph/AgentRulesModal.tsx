/**
 * The Agent Rules editor (docs/agent-rules.md): an Agents group's behaviour as When … Do … lines,
 * in the builders' window (BuilderWindow: Tips, tabs). Four tabs, each with its "How this works"
 * (builderLayout.ts AGENT_RULES_TABS), the one last used remembered: Species (speed, edges and
 * states), Rules (the selected species' rules, top to bottom; masks folded), Trails (the channels;
 * sensors and the flow field folded) and Look (what the picture shows). Every change applies live
 * (the group's inside is generated again and compiled); Open as nodes shows the nodes they make.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { BuilderFold, BuilderHelp, BuilderWindow, EmptyHelp, HintLabel, HintMark, useRememberedTab } from '../builders/BuilderWindow';
import { AGENT_RULES_TABS } from '../builders/builderLayout';
import { TypeAheadPicker } from '../builders/TypeAhead';
import { ACTION_HELP, CONDITION_HELP, type HelpExample } from '../builders/helpContent';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { Select } from '../ui/Select';
import { NumberInput } from './NumberInput';
import {
  ACTION_KINDS, CONDITION_KINDS, DEFAULT_STATE_COLOURS, MAX_MASKS, MAX_SPECIES, MAX_STATES,
  type AgentRule, type AgentRuleSet, type ChannelRef, type RuleAction, type RuleCondition,
  defaultRule, defaultSpecies, describeRule, newAction, newCondition, notesFor3d, usesAction,
} from '../../agentRules/spec';
import { groupRules } from '../../agentRules/apply';
import { generateRulesInside, ruleIds } from '../../agentRules/generate';
import { RULES_TEMPLATES } from '../../agentRules/templates';
import { applyGroupRules, openGroupAsNodes, setGroupView } from '../../agentRules/storeActions';
import { AGENT_VIEWS, agentsViewOf, type AgentsView } from '../../agentRules/outputs';

type Tk = ReturnType<typeof useTokens>;

const hex = (c: number[]) => `#${c.slice(0, 3).map(v => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const move = <T,>(list: T[], from: number, to: number) => { const out = [...list]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out; };

export function AgentRulesModal({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const tk = useTokens();
  const [set, setSet] = useState<AgentRuleSet>(() => groupRules(node));
  const [sp, setSp] = useState(0);
  const [showLines, setShowLines] = useState(false);
  const [tab, setTab] = useRememberedTab('agent-rules', AGENT_RULES_TABS, 'rules');
  const pending = useRef<AgentRuleSet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) { applyGroupRules(node.id, pending.current); pending.current = null; }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: AgentRuleSet) => {
    setSet(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 250);
  };
  const close = () => { flush(); onClose(); };

  const species = set.species[Math.min(sp, set.species.length - 1)];
  const s = Math.min(sp, set.species.length - 1);
  const setSpecies = (patch: Partial<typeof species>) => update({ ...set, species: set.species.map((x, i) => (i === s ? { ...x, ...patch } : x)) });
  const setRules = (rules: AgentRule[]) => setSpecies({ rules });
  const setRule = (i: number, r: AgentRule) => setRules(species.rules.map((x, j) => (j === i ? r : x)));
  const d3 = node.params.space === '3d';
  const label = (typeof node.params.label === 'string' && node.params.label) || 'Agents';

  // The lines each rule makes (for "Show the lines"), from the same generator the group runs.
  const lines = useMemo(() => {
    if (!showLines) return new Map<string, string>();
    const inside = generateRulesInside(set, { groupId: node.id, d3 });
    const ids = ruleIds(node.id);
    const out = new Map<string, string>();
    set.species.forEach((x, si) => x.rules.forEach((_, ri) => {
      const b = inside.find(nd => nd.id === ids.rule(si, ri));
      if (b) out.set(`${si}:${ri}`, ((b.params.lines ?? []) as Array<{ lhs: string; op: string; rhs: string }>).map(l => `${l.lhs} ${l.op} ${l.rhs};`).join('\n'));
    }));
    return out;
  }, [showLines, set, node.id, d3]);

  const channelOptions = [{ value: 'own', label: 'its own trail' }, ...[0, 1, 2, 3].map(c => ({ value: String(c), label: set.channels[c]?.trim() ? `${set.channels[c].trim()} (${c + 1})` : `trail ${c + 1}` }))];
  const ctx: EditCtx = { set, s, tk, channelOptions };
  const notes3d = d3 ? notesFor3d(set) : [];
  const view = useNodeGraphStore(st => agentsViewOf(st.nodes, node.id).current);
  const addExample = (ex: HelpExample) => { if ('rule' in ex.insert) setRules([...species.rules, structuredClone(ex.insert.rule)]); };

  const pickSpecies = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Species">
      {set.species.map((x, i) => (
        <button key={i} type="button" onClick={() => setSp(i)} aria-pressed={i === s} data-species={i + 1}
          style={{ height: 28, padding: '0 10px', borderRadius: radius.md, cursor: 'pointer', border: 0, font: `600 12px ${fontFamily.ui}`, background: i === s ? tk.bg.selected : tk.bg.field, color: tk.text.primary, boxShadow: i === s ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none' }}>
          {i + 1} · {x.name || `Species ${i + 1}`}
        </button>
      ))}
      {set.species.length < MAX_SPECIES && <IconButton icon="plus" label="Add a species (each lays its own trail channel)" size="sm" onClick={() => { update({ ...set, species: [...set.species, defaultSpecies(set.species.length)] }); setSp(set.species.length); }} />}
    </div>
  );

  // ── The tabs: Species · Rules · Trails · Look ──
  const speciesTab = (
    <TabPane>
      <SectionLabel hint="Up to four kinds of walker, each with its own rules, speed and states. Each lays its own trail channel by default.">Species</SectionLabel>
      {pickSpecies}
      <Row label="Name" hint="The species' name, used in the sentences."><Field value={species.name} onChange={e => setSpecies({ name: e.target.value })} aria-label="Species name" height={30} /></Row>
      <Row label="Speed" hint="Picture units a second: each walker starts at it (Set speed and Accelerate change it)."><Num value={species.speed} step={0.01} onCommit={v => setSpecies({ speed: v })} title="Picture units a second: each walker starts at it (Set speed and Accelerate change it)" /></Row>
      <Row label="Edges" hint="What happens at the picture's edges, for every species: wrap round, bounce back or slide along."><Select ariaLabel="Edges" value={set.edges} options={[{ value: 'wrap', label: 'Wrap' }, { value: 'bounce', label: 'Bounce' }, { value: 'slide', label: 'Slide' }]} onChange={v => update({ ...set, edges: v as AgentRuleSet['edges'] })} /></Row>
      {set.species.length > 1 && <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { update({ ...set, species: set.species.filter((_, i) => i !== s) }); setSp(0); }}>Remove this species</Button>}

      <SectionLabel meta="Memory x" hint="Each walker is in one state (born in the first). Rules check it (in state) and change it (become).">States</SectionLabel>
      <Note>Each walker is in one state (born in the first). Draw agents' Colour by State shows its colour.</Note>
      {species.states.map((st, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 28px', gap: 6, alignItems: 'center' }}>
          <input type="color" aria-label={`${st.name} colour`} value={hex(st.colour)} onChange={e => setSpecies({ states: species.states.map((x, j) => (j === i ? { ...x, colour: fromHex(e.target.value) } : x)) })}
            style={{ width: 28, height: 28, padding: 0, border: 0, borderRadius: 6, background: 'none', cursor: 'pointer' }} />
          <Field value={st.name} onChange={e => setSpecies({ states: species.states.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`State ${i + 1} name`} height={30} />
          <IconButton icon="close" label="Remove state" size="sm" tone="danger" disabled={species.states.length === 1} onClick={() => setSpecies({ states: species.states.filter((_, j) => j !== i) })} />
        </div>
      ))}
      {species.states.length < MAX_STATES && <AddRow onClick={() => setSpecies({ states: [...species.states, { name: `state ${species.states.length + 1}`, colour: DEFAULT_STATE_COLOURS[species.states.length % DEFAULT_STATE_COLOURS.length] }] })}>Add state</AddRow>}
    </TabPane>
  );

  const rulesTab = (
    <TabPane wide>
      {set.species.length > 1 && pickSpecies}
      <SectionLabel meta="run top to bottom, every step" hint="Each rule is When … Do …: checked every step for each walker, top to bottom.">{`Rules · ${species.name || `Species ${s + 1}`}`}</SectionLabel>
      {species.rules.length > 0 && <BuilderHelp id="rules" onExample={addExample} />}
      {species.rules.map((r, i) => (
        <RuleCard key={i} i={i} n={species.rules.length} rule={r} ctx={ctx} lines={lines.get(`${s}:${i}`)}
          onChange={x => setRule(i, x)}
          onMove={to => setRules(move(species.rules, i, to))}
          onRemove={() => setRules(species.rules.filter((_, j) => j !== i))}
          onDuplicate={() => setRules([...species.rules.slice(0, i + 1), structuredClone(r), ...species.rules.slice(i + 1)])} />
      ))}
      {species.rules.length === 0 && <EmptyHelp id="empty-rules" onExample={addExample} />}
      <AddRow onClick={() => setRules([...species.rules, defaultRule()])}>Add rule</AddRow>
      <BuilderFold foldKey="agentRules:open:masks" title="Masks" summary={set.masks.length ? `${set.masks.map(m => m.name).join(', ')} · inputs on the card` : 'none: inputs on the card for food, walls, a nest'}>
        <Note>Inputs on the group card: a texture (its brightness) or a number chain, read where the walker stands. Rules check them with "inside a mask".</Note>
        {set.masks.map((m, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 112px 28px', gap: 6, alignItems: 'center', maxWidth: 480 }}>
            <Field value={m.name} onChange={e => update({ ...set, masks: set.masks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`Mask ${i + 1} name`} height={30} />
            <Select ariaLabel={`Mask ${i + 1} kind`} value={m.kind} options={[{ value: 'number', label: 'A number' }, { value: 'texture', label: 'A texture' }]} onChange={v => update({ ...set, masks: set.masks.map((x, j) => (j === i ? { ...x, kind: v as 'number' | 'texture' } : x)) })} />
            <IconButton icon="close" label="Remove mask" size="sm" tone="danger" onClick={() => update({ ...set, masks: set.masks.filter((_, j) => j !== i) })} />
          </div>
        ))}
        {set.masks.length < MAX_MASKS && <AddRow onClick={() => update({ ...set, masks: [...set.masks, { name: set.masks.length ? 'Mask 2' : 'Mask', kind: 'number' }] })}>Add mask</AddRow>}
      </BuilderFold>
    </TabPane>
  );

  const trailsTab = (
    <TabPane>
      <SectionLabel hint="Four trail channels, one per species by default. Name them (food, home) and the rules read as sentences.">Trail channels</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {[0, 1, 2, 3].map(c => (
          <Field key={c} value={set.channels[c] ?? ''} placeholder={`trail ${c + 1}${c === 3 && usesAction(set, 'spawn') ? ' (births)' : ''}`} aria-label={`Name of trail channel ${c + 1}`} height={30}
            onChange={e => update({ ...set, channels: set.channels.map((x, j) => (j === c ? e.target.value : x)) })} />
        ))}
      </div>
      <Note>Rules leave trail with Do → leave trail, and read it with When → trail ahead / to the left / here.</Note>
      <BuilderFold foldKey="agentRules:open:sensing" title="Sensors" summary={`${set.sensor.distance} ahead · ${set.sensor.angle}° apart`}>
        <Row label="Sensors ahead" hint="How far ahead the sensors read the trail (picture units; ten times further in 3D)."><Num value={set.sensor.distance} step={0.005} onCommit={v => update({ ...set, sensor: { ...set.sensor, distance: v } })} title="How far ahead the sensors read the trail (picture units; ten times further in 3D)" /></Row>
        <Row label="Sensor angle" hint="Degrees between the ahead sensor and the side ones."><Num value={set.sensor.angle} step={1} onCommit={v => update({ ...set, sensor: { ...set.sensor, angle: v } })} title="Degrees between the ahead sensor and the side ones" /></Row>
      </BuilderFold>
      {usesAction(set, 'flow') && (
        <BuilderFold foldKey="agentRules:open:flow" title="Flow field" summary={`size ${set.flow.size} · evolve ${set.flow.evolve}`}>
          <Row label="Flow size" hint="Follow a flow field: how big the swirls of the curl noise are."><Num value={set.flow.size} step={0.1} onCommit={v => update({ ...set, flow: { ...set.flow, size: v } })} /></Row>
          <Row label="Flow evolve" hint="Follow a flow field: how fast the flow changes over time."><Num value={set.flow.evolve} step={0.01} onCommit={v => update({ ...set, flow: { ...set.flow, evolve: v } })} /></Row>
        </BuilderFold>
      )}
    </TabPane>
  );

  const lookTab = (
    <TabPane>
      <SectionLabel hint="What the group's picture shows: the trail, one trail channel, or where the walkers are. Each is also an output socket.">What the picture shows</SectionLabel>
      <Select ariaLabel="What the picture shows" value={view ?? ''} height={30}
        options={[...(view ? [] : [{ value: '', label: 'Not wired: nothing reads the trail' }]), ...AGENT_VIEWS.map(v => ({ value: v.value, label: v.label }))]}
        onChange={v => { if (v) setGroupView(node.id, v as AgentsView); }} />
      <Note>{AGENT_VIEWS.find(v => v.value === view)?.hint ?? 'Wire the Trail field\'s Amount into a Palette to see the trail.'}</Note>
      <Note>Each state's colour (Species tab) shows through Draw agents' Colour by State.</Note>
      {notes3d.map(t => <Note key={t}>3D: {t}</Note>)}
    </TabPane>
  );

  return (
    <BuilderWindow
      prefsKey="agent-rules"
      title="Agent Rules"
      subtitle={`${label} · ${set.species.length} ${set.species.length === 1 ? 'species' : 'species'} · ${d3 ? '3D' : '2D'} · When … Do …`}
      icon="expr" iconColor={tk.kind.expr} width={1100} height={780} onClose={close}
      tabs={{ items: AGENT_RULES_TABS, value: tab, onChange: setTab, ariaLabel: 'Agent Rules sections' }}
      headerActions={
        <Select ariaLabel="Start from a template" value="" height={30}
          options={[{ value: '', label: 'Templates…' }, ...RULES_TEMPLATES.map(t => ({ value: t.key, label: t.label }))]}
          onChange={k => { const t = RULES_TEMPLATES.find(x => x.key === k); if (t) { update(t.set()); setSp(0); } }} />
      }
      footer={<>
        <Button icon="fn" title="Show the nodes these rules make (Start, a block per rule, Finish, Move), every one with a note, and edit them as nodes" onClick={() => { flush(); onClose(); openGroupAsNodes(node.id); }}>Open as nodes</Button>
        <Toggle checked={showLines} onChange={setShowLines} label="Show the lines" />
        <span style={{ flex: 1 }} />
        <Note>Memory holds a state and one number · changes apply live</Note>
        <Button variant="primary" onClick={close}>Done</Button>
      </>}
    >
      <div data-agent-tab={tab} style={{ display: 'contents' }}>
        {tab === 'species' && speciesTab}
        {tab === 'rules' && rulesTab}
        {tab === 'trails' && trailsTab}
        {tab === 'look' && lookTab}
      </div>
    </BuilderWindow>
  );
}

/** A tab's body: settings at a readable width; the rules use the whole width. */
function TabPane({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div style={{ flex: 1, minWidth: 0, padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box', ...(wide ? {} : { maxWidth: 620 }) }}>{children}</div>;
}

interface EditCtx { set: AgentRuleSet; s: number; tk: Tk; channelOptions: Array<{ value: string; label: string }> }

function RuleCard({ i, n, rule, ctx, lines, onChange, onMove, onRemove, onDuplicate }: {
  i: number; n: number; rule: AgentRule; ctx: EditCtx; lines?: string;
  onChange: (r: AgentRule) => void; onMove: (to: number) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  const { tk } = ctx;
  const when = rule.when.length ? rule.when : [{ kind: 'always' } as RuleCondition];
  const setWhen = (list: RuleCondition[]) => onChange({ ...rule, when: list.length ? list : [{ kind: 'always' }] });
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
      <Line word="When">
        {when.map((c, j) => (
          <React.Fragment key={j}>
            {j > 0 && <span style={{ color: tk.text.faint, fontSize: 12 }}>and</span>}
            <Piece hint={CONDITION_HELP[c.kind].hint} onRemove={rule.when.length > 1 || c.kind !== 'always' ? () => setWhen(when.filter((_, k) => k !== j)) : undefined}>
              <ConditionEditor c={c} ctx={ctx} onChange={x => setWhen(when.map((y, k) => (k === j ? x : y)))} />
            </Piece>
          </React.Fragment>
        ))}
        <TypeAheadPicker ariaLabel="Add a condition" placeholder="+ and… (type)" width={140}
          items={CONDITION_KINDS.filter(k => k.kind !== 'always').map(k => ({ value: k.kind, label: k.label, hint: CONDITION_HELP[k.kind].hint, example: CONDITION_HELP[k.kind].example, words: [k.kind] }))}
          onPick={k => setWhen([...when.filter(x => x.kind !== 'always'), newCondition(k as RuleCondition['kind'])])} />
      </Line>
      <Line word="Do">
        {rule.do.map((a, j) => (
          <Piece key={j} hint={ACTION_HELP[a.kind].hint} onRemove={() => onChange({ ...rule, do: rule.do.filter((_, k) => k !== j) })}>
            <ActionEditor a={a} ctx={ctx} onChange={x => onChange({ ...rule, do: rule.do.map((y, k) => (k === j ? x : y)) })} />
          </Piece>
        ))}
        <TypeAheadPicker ariaLabel="Add an action" placeholder="+ do… (type)" width={130}
          items={ACTION_KINDS.map(k => ({ value: k.kind, label: k.label, hint: ACTION_HELP[k.kind].hint, example: ACTION_HELP[k.kind].example, words: [k.kind] }))}
          onPick={k => onChange({ ...rule, do: [...rule.do, newAction(k as RuleAction['kind'])] })} />
      </Line>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 28 }}>
        <Toggle checked={!!rule.stop} onChange={v => onChange({ ...rule, stop: v })} label="Stop after this rule" />
        <HintMark text="When this rule applies, the rules below it are skipped for that walker this step." />
      </div>
      {lines !== undefined && (
        <pre style={{ margin: 0, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, color: tk.text.secondary, font: `500 11px/1.5 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{lines}</pre>
      )}
    </div>
  );
}

function ConditionEditor({ c, ctx, onChange }: { c: RuleCondition; ctx: EditCtx; onChange: (c: RuleCondition) => void }) {
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
  }
}

function ActionEditor({ a, ctx, onChange }: { a: RuleAction; ctx: EditCtx; onChange: (a: RuleAction) => void }) {
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
    case 'stop': return <Word>stop</Word>;
    case 'stick': return <Word>stick (never move again)</Word>;
    case 'die': return <Word>die</Word>;
    case 'bounce': return <Word>bounce (turn round)</Word>;
  }
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Line({ word, children }: { word: string; children: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span title={word === 'When' ? 'When: the condition checked every step for each walker. All must hold.' : 'Do: what the walker does when the condition holds, in order.'} style={{ width: 36, flexShrink: 0, paddingTop: 6, font: `700 11px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: word === 'When' ? tk.kind.expr : tk.accent.base, cursor: 'help' }}>{word}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function Piece({ children, onRemove, hint }: { children: React.ReactNode; onRemove?: () => void; hint?: string }) {
  const tk = useTokens();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 8px', borderRadius: radius.md, background: tk.bg.field, minHeight: 30 }}>
      {children}
      {hint && <HintMark text={hint} />}
      {onRemove && <button type="button" aria-label="Remove" title="Remove" onClick={onRemove} style={{ width: 20, height: 20, padding: 0, border: 0, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={12} /></button>}
    </span>
  );
}

function Word({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12.5, color: tk.text.secondary, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Small({ value, options, onChange, label }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; label: string }) {
  return <Select ariaLabel={label} value={value} options={options} onChange={onChange} height={26} style={{ maxWidth: 220 }} />;
}

function Num({ value, step, onCommit, title }: { value: number; step: number; onCommit: (v: number) => void; title?: string }) {
  const tk = useTokens();
  return <NumberInput value={value} step={step} title={title} onCommit={v => { if (isFinite(v)) onCommit(v); }}
    style={{ width: 58, height: 26, boxSizing: 'border-box', padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.md, background: tk.bg.panel, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`, textAlign: 'center', boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />;
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: tk.text.muted, minWidth: 0, display: 'flex' }}><HintLabel hint={hint}>{label}</HintLabel></span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function SectionLabel({ children, meta, hint }: { children: React.ReactNode; meta?: string; hint?: string }) {
  const tk = useTokens();
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
      <span style={{ flex: 1 }}>{hint ? <HintLabel hint={hint}>{children}</HintLabel> : children}</span>
      {meta && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 12 }}>{meta}</span>}
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.muted }}>{children}</span>;
}

function AddRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
        border: `1.5px dashed ${hover ? tk.text.faint : tk.border.strong}`, borderRadius: radius.control,
        background: hover ? tk.bg.hover : 'none', color: tk.text.muted, font: `500 12.5px ${fontFamily.ui}`,
      }}>
      <Icon name="plus" size={15} />{children}
    </button>
  );
}
