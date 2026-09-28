/**
 * AgentsEditor — the Agents layer (docs/agents-layer.md): a preset picker,
 * the rule stack (add, remove, reorder, switch on and off; each rule folds
 * to a one-line summary), the groups, where they start, the clock, and the
 * look. Every number is a normal layer property, so each slider can become
 * a Play control and be mapped, and right-click opens the same menu as
 * everywhere else.
 */
import { NumberInput } from '../../NodeGraph/NumberInput';
import { Button, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Segmented, Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { fontFamily } from '../../../theme/tokens';
import { usePlayUi } from '../playUi';
import { AG_GROUPS, AG_MAX, AG_PRESETS, AG_RULES, AG_RULE_TYPES, agPresetLayer } from '../../../play/kit/agents.js';
import { AGENT_MAX_RULES, newAgentRule, type AgentRule, type AgentRuleType, type AgentsLayer, type PlayLayer } from '../../../types/playLayers';
import { BLENDS, BLEND_HINT, type Choice, type FieldKit } from './fields';
import { Section } from './Section';
import { BigEditorScaffold } from './BigEditorScaffold';
import type { EditorContext } from './editors';

const MODE_LABELS: Record<string, Choice> = {
  ccw: { value: 'ccw', label: 'Anticlockwise' }, cw: { value: 'cw', label: 'Clockwise' },
  pairs: { value: 'pairs', label: 'All pairs', title: 'Every agent pulls every other (n-body)' }, point: { value: 'point', label: 'Toward a target', title: 'Everyone falls toward the target' },
  nearest: { value: 'nearest', label: 'Nearest', title: 'Each agent to its nearest few, within the link radius, as they are now' },
  ring: { value: 'ring', label: 'Ring', title: 'Each agent to the next, in order, round a closed loop (per group)' },
  grid: { value: 'grid', label: 'Grid', title: 'Rows and columns in order, with diagonals (Start: Grid lays them out that way)' },
  curl: { value: 'curl', label: 'Curl noise', title: 'Smooth swirling lanes that never pile up' }, vortex: { value: 'vortex', label: 'Vortex', title: 'Round and round the target' },
  uniform: { value: 'uniform', label: 'Wind', title: 'One direction everywhere' }, climb: { value: 'climb', label: 'Climb', title: 'Toward brighter parts of the picture' }, descend: { value: 'descend', label: 'Descend', title: 'Toward darker parts of the picture' },
  wrap: { value: 'wrap', label: 'Wrap', title: 'Leave one side, come in from the other' }, bounce: { value: 'bounce', label: 'Bounce', title: 'Rebound off the edge' },
  kill: { value: 'kill', label: 'Die', title: 'Leaving means dying (a group’s Respawn brings them back)' }, steer: { value: 'steer', label: 'Steer away', title: 'Turn back before the edge' },
};
const CHANNELS: Choice[] = [
  { value: 'brightness', label: 'Brightness' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' },
  { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' },
];
/** Layers whose elements (or place) a rule can aim at. */
const TARGET_KINDS = new Set(['null', 'shape', 'text', 'image', 'particles', 'bodies', 'agents', 'relationship', 'cloner', 'camera', 'video', 'lens', 'data', 'audio']);

const groupName = (g: number) => (g === 0 ? 'Everyone' : `Group ${g}`);
const whoCounts = (t: number) => (t === 0 ? 'any group' : t === -1 ? 'own group' : t === -2 ? 'other groups' : `group ${t}`);

/** A one-line glance at a rule while it is folded. */
function ruleSummary(r: AgentRule, get: (k: string) => number, groups: number, layers: PlayLayer[]): string {
  const def = AG_RULES[r.type];
  const bits: string[] = [];
  if (def.modes) bits.push(MODE_LABELS[r.mode]?.label ?? r.mode);
  for (const p of def.params.slice(0, 2)) { const v = get(`${r.id}_${p.key}`); if (typeof v === 'number') bits.push(`${p.label.toLowerCase()} ${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)}`); }
  if (def.target && r.type !== 'boundary' && !(r.type === 'gravity' && r.mode === 'pairs') && !(r.type === 'field' && r.mode !== 'vortex')) {
    bits.push(r.target === 'pointer' ? '→ pointer' : r.target === 'group' ? `→ ${whoCounts(r.targetGroup)}` : r.target === 'layer' ? `→ ${layers.find(x => x.id === r.targetId)?.label ?? 'no layer'}` : '→ a point');
  }
  if (r.type === 'boundary' && r.target === 'layer') bits.push(`in ${layers.find(x => x.id === r.targetId)?.label ?? 'no shape'}`);
  if (def.neighbours && groups > 1) bits.push(`with ${whoCounts(r.targetGroup)}`);
  if (groups > 1 && r.group) bits.unshift(groupName(r.group));
  return bits.join(' · ');
}

/** Does this rule aim at something right now (its target row shows)? */
function aims(r: AgentRule): boolean {
  if (!AG_RULES[r.type]?.target) return false;
  if (r.type === 'gravity') return r.mode === 'point';
  if (r.type === 'field') return r.mode === 'vortex';
  return true;
}

export function AgentsEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as AgentsLayer;
  const tk = f.tk;
  const groups = Math.max(1, Math.min(AG_GROUPS, Math.round(l.groups)));
  const num = (k: string) => f.get<number>(k);
  const setRules = (rules: AgentRule[], extra: Record<string, unknown> = {}) => f.set({ rules, preset: '', ...extra });
  const change = (id: string, patch: Partial<AgentRule>) => setRules(l.rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => { const next = l.rules.slice(); const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; setRules(next); };
  const remove = (id: string) => {
    // Its numbers go with it.
    const drop: Record<string, unknown> = {};
    for (const k of Object.keys(l)) if (k.startsWith(`${id}_`)) drop[k] = undefined;
    setRules(l.rules.filter(r => r.id !== id), drop);
  };
  const add = (type: string) => {
    if (!AG_RULE_TYPES.includes(type) || l.rules.length >= AGENT_MAX_RULES) return;
    const { rule, numbers } = newAgentRule(l, type as AgentRuleType);
    setRules([...l.rules, rule], numbers);
    usePlayUi.getState().toggleFold(`agents-rule:${l.id}:${rule.id}`, false);
  };
  const applyPreset = (name: string) => {
    const patch = agPresetLayer(name, l);
    if (!patch) return;
    f.set(patch);
    ctx.act('reset');
  };
  const targetLayers = ctx.layers.filter(x => x.id !== l.id && TARGET_KINDS.has(x.kind));
  const shapes = ctx.layers.filter(x => x.kind === 'shape');
  const groupOptions: Choice[] = [{ value: '0', label: 'Everyone' }, ...Array.from({ length: groups }, (_, i) => ({ value: String(i + 1), label: `Group ${i + 1}` }))];
  const countOptions: Choice[] = [{ value: '0', label: 'Any group' }, { value: '-1', label: 'Own group' }, { value: '-2', label: 'Other groups' }, ...Array.from({ length: groups }, (_, i) => ({ value: String(i + 1), label: `Group ${i + 1}` }))];
  const total = Array.from({ length: groups }, (_, i) => num(`g${i + 1}_count`) || 0).reduce((a, b) => a + b, 0);
  const faint: React.CSSProperties = { color: tk.text.faint, font: `11px ${fontFamily.ui}` };

  const ruleCard = (r: AgentRule, i: number) => {
    const def = AG_RULES[r.type];
    if (!def) return null;
    return <RuleCard key={r.id} f={f} l={l} r={r} i={i} n={l.rules.length} groups={groups} onChange={p => change(r.id, p)} onMove={d => move(i, d)} onRemove={() => remove(r.id)}
      body={<>
        {def.modes && f.row('Mode', <Segmented size="sm" ariaLabel={`${def.label} mode`} value={r.mode} options={def.modes.map(m => MODE_LABELS[m] ?? { value: m, label: m })} onChange={v => change(r.id, { mode: v })} wrap={def.modes.length >= 4} />)}
        {groups > 1 && f.row('Applies to', <Select ariaLabel="Applies to" value={String(r.group)} options={groupOptions} onChange={v => change(r.id, { group: Number(v) })} height={26} />, 'Which agents this rule moves.')}
        {(def.neighbours || (r.type === 'gravity' && r.mode === 'pairs')) && groups > 1 && f.row(r.type === 'catch' ? 'Catches' : 'Counts', <Select ariaLabel="Which neighbours count" value={String(r.targetGroup)} options={countOptions} onChange={v => change(r.id, { targetGroup: Number(v) })} height={26} />, r.type === 'catch' ? 'Which agents can be caught.' : 'Which neighbours this rule looks at.')}
        {r.type === 'boundary' && f.row('Inside', <Select ariaLabel="Boundary" value={r.target === 'layer' ? r.targetId : ''} options={[{ value: '', label: 'The picture' }, ...shapes.map(x => ({ value: x.id, label: x.label }))]} onChange={v => change(r.id, v ? { target: 'layer', targetId: v } : { target: 'point', targetId: '' })} height={26} />, 'The edge they meet: the picture’s, or a shape’s (a box, a circle, a drawn outline…).')}
        {aims(r) && r.type !== 'boundary' && <>
          {f.row('Target', <Segmented size="sm" ariaLabel="Target" value={r.target} options={[
            { value: 'point', label: 'Point', title: 'A fixed point (its X and Y below can be mapped)' }, { value: 'pointer', label: 'Pointer', title: 'The mouse or a touch, while it is over the picture' },
            { value: 'layer', label: 'Layer', title: 'Another layer: its nearest element (particles, bodies, agents, relationship members) or its place' },
            { value: 'group', label: 'Group', title: r.type === 'seek' || r.type === 'flee' ? 'The nearest agent of a group (in this layer)' : 'A group’s centre (in this layer)' },
          ]} onChange={v => change(r.id, { target: v as AgentRule['target'] })} />)}
          {r.target === 'point' && <>{f.prop(`${r.id}_x`, 'X')}{f.prop(`${r.id}_y`, 'Y')}</>}
          {r.target === 'layer' && f.row('Layer', <Select ariaLabel="Target layer" value={r.targetId} options={[{ value: '', label: 'Pick a layer' }, ...targetLayers.map(x => ({ value: x.id, label: x.label }))]} onChange={v => change(r.id, { targetId: v })} height={26} />, 'Particles, bodies, other agents and a relationship’s members count one by one (the nearest); anything else by its place.')}
          {r.target === 'group' && f.row('Group', <Select ariaLabel="Target group" value={String(r.targetGroup)} options={countOptions} onChange={v => change(r.id, { targetGroup: Number(v) })} height={26} />)}
        </>}
        {r.type === 'field' && (r.mode === 'climb' || r.mode === 'descend') && f.row('Channel', <Select ariaLabel="Picture channel" value={r.channel} options={CHANNELS} onChange={v => change(r.id, { channel: v })} height={26} />, 'Which part of the picture they climb or descend.')}
        {r.type === 'springs' && r.mode === 'nearest' && f.row('Links', <NumberInput value={r.k} min={1} max={8} step={1} title="Links per agent (its nearest)" onCommit={n => change(r.id, { k: Math.max(1, Math.min(8, Math.round(n))) })} style={f.numStyle} />, 'How many of its nearest each agent is joined to.')}
        {def.params.filter(p => paramShows(r, p.key)).map(p => f.prop(`${r.id}_${p.key}`, p.label))}
      </>}
      summary={ruleSummary(r, num, groups, ctx.layers)}
    />;
  };

  const preset = l.preset && AG_PRESETS[l.preset] ? l.preset : '';
  const sections = [
    { id: 'agents-rules', label: 'Rules' },
    { id: 'agents-groups', label: 'Groups' },
    { id: 'agents-start', label: 'Start' },
    { id: 'agents-clock', label: 'Clock' },
    { id: 'agents-look', label: 'Look' },
  ];
  return (
    <BigEditorScaffold kind="agents" sections={sections}>
      {f.row('Preset', <>
        <Select ariaLabel="Preset" value={preset} options={[{ value: '', label: preset ? 'Custom' : 'Custom (your rules)' }, ...Object.entries(AG_PRESETS).map(([k, p]) => ({ value: k, label: p.label }))]} onChange={v => { if (v) applyPreset(v); }} height={26} style={{ flex: 1, minWidth: 0 }} />
        <Button size="sm" variant="ghost" icon="reset" onClick={() => ctx.act('reset')}>Start over</Button>
      </>, 'Fills the rule stack (and the groups, start and look) with a ready-made setup: Boids, Gravity, Spring net, Predator–prey, Flow field. Edit anything afterwards.')}
      {preset && f.note(AG_PRESETS[preset].hint)}

      <Section id="agents-rules" kind="agents" title="Rules" primary summary={l.rules.length ? l.rules.map(r => AG_RULES[r.type]?.label ?? r.type).join(' · ') : 'None yet'} hint="An ordered stack: every step each agent adds up the steering of every rule that applies to it (weighted), then moves. Order matters only where one rule sets what the next sees (Max speed after the forces, a Boundary last).">
        {l.rules.map(ruleCard)}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 0 0' }}>
          {l.rules.length < AGENT_MAX_RULES
            ? <Select ariaLabel="Add a rule" value="" options={[{ value: '', label: '+ Add a rule…' }, ...AG_RULE_TYPES.map(t => ({ value: t, label: AG_RULES[t].label }))]} onChange={add} height={26} style={{ flex: 1, minWidth: 0 }} />
            : <span style={faint}>{AGENT_MAX_RULES} rules at most.</span>}
        </div>
        {!l.rules.length && f.note('No rules: the agents drift at their start speed. Add one, or pick a preset.')}
      </Section>

      <Section id="agents-groups" kind="agents" title="Groups" summary={`${groups} group${groups === 1 ? '' : 's'} · ${total} agents`} hint="Up to four groups, each with its own count, colour, size and energy. Rules can apply to one group and look at another: predators and prey.">
        {f.row('Groups', <Segmented size="sm" ariaLabel="Groups" value={String(groups)} options={[1, 2, 3, 4].map(n => ({ value: String(n), label: String(n) }))} onChange={v => f.set({ groups: Number(v) })} />, 'How many groups. Changing it starts over.')}
        {Array.from({ length: groups }, (_, i) => {
          const g = i + 1;
          return (
            <div key={g} style={{ margin: '8px 0 2px', padding: '6px 8px', borderRadius: 8, background: tk.bg.field }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: tk.text.primary, font: `600 11.5px ${fontFamily.ui}`, minWidth: 62 }}>{groups > 1 ? `Group ${g}` : 'Agents'}</span>
                <span style={faint}>Count</span>
                <NumberInput value={num(`g${g}_count`)} min={0} max={AG_MAX} step={10} title={`How many (all groups together at most ${AG_MAX}). Changing it starts over.`} onCommit={n => f.set({ [`g${g}_count`]: Math.max(0, Math.min(AG_MAX, Math.round(n))) })} style={{ ...f.numStyle, width: 64 }} />
              </div>
              {f.colour('Colour', `g${g}_color`, 'The group’s colour (Colour: By group).')}
              {f.prop(`g${g}_size`, 'Size')}
              {f.prop(`g${g}_drain`, 'Energy drain')}
              {f.prop(`g${g}_respawn`, 'Respawn')}
            </div>
          );
        })}
        {total > 3000 && f.note('Over 3000 agents the neighbour rules start to cost real time on slower machines; the simulation stays exact, it just takes longer each frame.')}
      </Section>

      <Section id="agents-start" kind="agents" title="Start" summary={`${l.spawn} · seed ${l.seed || 'take'}`} hint="Where they start and how, and the seed every random choice comes from. The same seed gives the same run every time, here, in renders and on a website.">
        {f.seg('Start', 'spawn', [
          { value: 'random', label: 'Anywhere' }, { value: 'centre', label: 'Centre', title: 'In a disc round the middle (Spread is its radius)' },
          { value: 'grid', label: 'Grid', title: 'Rows and columns (Springs: Grid joins them that way)' }, { value: 'ring', label: 'Ring', title: 'Evenly round a circle' }, { value: 'edges', label: 'Edges' },
        ], 'Where the agents are placed when the layer starts (or starts over). Respawns go where the start says, at random along it.')}
        {(l.spawn === 'centre' || l.spawn === 'grid' || l.spawn === 'ring') && f.prop('spawnRadius')}
        {f.props('startSpeed', 'spin')}
        {f.row('Seed', <NumberInput value={l.seed} min={0} max={1e9} step={1} title="0: a new run each time (a take seeds it)" onCommit={n => f.set({ seed: Math.max(0, Math.round(n)) })} style={f.numStyle} />, 'Every random choice (places, speeds, wander, respawns) comes from this. 0: a fresh run each time, except in a take, which seeds it from the take.')}
      </Section>

      <Section id="agents-clock" kind="agents" title="Clock" summary={`speed ${num('speed').toFixed(2)} · ${l.substeps} substep${l.substeps === 1 ? '' : 's'}`} hint="The simulation runs in fixed steps of 1/60 s of simulated time, whatever the frame rate, so a take renders exactly what was played.">
        {f.prop('speed')}
        {f.row('Substeps', <Segmented size="sm" ariaLabel="Substeps" value={String(l.substeps)} options={['1', '2', '3', '4'].map(v => ({ value: v, label: v }))} onChange={v => f.set({ substeps: Number(v) })} />, 'Split each step in smaller ones: stiff springs and close gravity passes stay steady, at the cost of time.')}
      </Section>

      <Section id="agents-look" kind="agents" title="Look" summary={`${l.look} · ${l.colourBy === 'group' ? 'by group' : `by ${l.colourBy}`}${l.trail > 0 ? ' · trail' : ''}${l.links !== 'off' ? ` · ${l.links} links` : ''}`}>
        {f.seg('Draw', 'look', [
          { value: 'dots', label: 'Dots' }, { value: 'sprites', label: 'Arrows', title: 'Triangles pointing where each is heading' }, { value: 'goo', label: 'Goo', title: 'Metaballs: close agents merge into blobs' },
        ], 'Dots, arrows along the heading, or goo (the particles’ metaballs).')}
        {f.seg('Colour', 'colourBy', [
          { value: 'group', label: 'By group' }, { value: 'speed', label: 'Speed' }, { value: 'age', label: 'Age' }, { value: 'energy', label: 'Energy' }, { value: 'heading', label: 'Heading' },
        ], 'Each group’s own colour, or the palette along speed, age, energy or heading.')}
        {l.colourBy !== 'group' && f.palette()}
        {(l.colourBy === 'speed' || l.colourBy === 'age') && f.prop('colourSpan')}
        {f.prop('trail')}
        {l.look === 'goo' && f.props('gooBlend', 'gooThreshold', 'gooSoft')}
        {f.seg('Links', 'links', [{ value: 'off', label: 'Off' }, { value: 'springs', label: 'Springs', title: 'The Springs rule’s links' }, { value: 'near', label: 'Neighbours', title: 'Lines between agents within Link within' }], 'Lines between agents: the springs, or any two closer than Link within (fading with distance).')}
        {l.links === 'near' && f.prop('linkRadius')}
        {l.links !== 'off' && <>{f.props('linkOpacity', 'linkWidth')}{f.colour('Link colour', 'linkColor')}</>}
        {f.prop('opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </BigEditorScaffold>
  );
}

/** Which of a rule's numbers show for its mode. */
function paramShows(r: AgentRule, key: string): boolean {
  if (r.type === 'field') {
    if (key === 'scale' || key === 'evolve') return r.mode === 'curl';
    if (key === 'angle') return r.mode === 'uniform';
    if (key === 'look') return r.mode === 'climb' || r.mode === 'descend';
    if (key === 'speed') return r.mode !== 'climb' && r.mode !== 'descend';
  }
  if (r.type === 'springs' && key === 'radius') return r.mode === 'nearest';
  if (r.type === 'boundary') { if (key === 'margin') return r.mode === 'steer'; if (key === 'weight') return r.mode === 'steer' || r.mode === 'bounce'; }
  if (r.type === 'gravity' && key === 'radius') return r.mode === 'pairs';
  return true;
}

/** One rule: a header (switch, name, move, remove) and, unfolded, its settings; folded, a summary. */
function RuleCard({ f, l, r, i, n, body, summary, onChange, onMove, onRemove }: {
  f: FieldKit; l: AgentsLayer; r: AgentRule; i: number; n: number; groups: number; body: React.ReactNode; summary: string;
  onChange: (p: Partial<AgentRule>) => void; onMove: (d: number) => void; onRemove: () => void;
}) {
  const tk = f.tk;
  const key = `agents-rule:${l.id}:${r.id}`;
  const stored = usePlayUi(s => s.folded[key]);
  const folded = stored === undefined ? true : stored;
  const toggleFold = usePlayUi(s => s.toggleFold);
  const def = AG_RULES[r.type];
  return (
    <div style={{ margin: '6px 0 2px', padding: '5px 8px 6px', borderRadius: 8, background: tk.bg.field, opacity: r.on ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Toggle checked={r.on} onChange={v => onChange({ on: v })} />
        <button type="button" aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Fold'} ${def.label}`} onClick={() => toggleFold(key, !folded)} title={def.hint}
          style={{ display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'none', padding: 0, cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left' }}>
          <Icon name={folded ? 'chevR' : 'chevD'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
          <span style={{ color: tk.text.primary, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{i + 1}. {def.label}</span>
        </button>
        <IconButton icon="chevU" label="Move up" size="sm" disabled={i === 0} onClick={() => onMove(-1)} />
        <IconButton icon="chevD" label="Move down" size="sm" disabled={i === n - 1} onClick={() => onMove(1)} />
        <IconButton icon="trash" label={`Remove ${def.label}`} size="sm" tone="danger" onClick={onRemove} />
      </div>
      {folded
        ? <div style={{ margin: '2px 0 0 38px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</div>
        : <div>{f.note(def.hint)}{body}</div>}
    </div>
  );
}
