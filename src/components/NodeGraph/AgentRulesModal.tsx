/**
 * The Agent Rules editor (docs/agent-rules.md): an Agents group's behaviour as When … Do … lines,
 * in the builders' window (BuilderWindow: Tips, tabs). Four tabs, each with its "How this works"
 * (builderLayout.ts AGENT_RULES_TABS), the one last used remembered: Species (speed, edges and
 * states), Rules (the selected species' rules, top to bottom; masks folded), Trails (the channels;
 * sensors and the flow field folded) and Look (what the picture shows; in 3D first the camera).
 * Every change applies live (the group's inside is generated again and compiled); Open as nodes
 * shows the nodes they make. The header's Space 2D / 3D switch turns the whole setup
 * (agentRules/space3d.ts), and in 3D the Templates menu offers the 3D setups first.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LanguageTab, type LanguageRead } from '../builders/LanguageTab';
import { parseAgents, printAgents } from '../../lang/dialects/agents';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { RulerSlider } from '../ui/RulerSlider';
import { getNodeDefinition } from '../../nodes/definitions';
import { extendRangePatch, paramSliderRange } from '../../nodes/sliderRange';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { BuilderFold, BuilderHelp, BuilderWindow, EmptyHelp, HintLabel, useRememberedTab } from '../builders/BuilderWindow';
import { AGENT_RULES_TABS } from '../builders/builderLayout';
import { type HelpExample } from '../builders/helpContent';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { Select } from '../ui/Select';
import {
  DEFAULT_NEIGHBOURS, DEFAULT_STATE_COLOURS, MAX_MASKS, MAX_SPECIES, MAX_STATES, WALKER_KINDS, WALKER_KIND_KEYS,
  type AgentRule, type AgentRuleSet, type RulesSection, type WalkerKind,
  defaultRule, defaultSpecies, kindOf, notesFor3d, showsSection, usesAction, usesFlow,
} from '../../agentRules/spec';
import { groupRules } from '../../agentRules/apply';
import { generateRulesInside, ruleIds } from '../../agentRules/generate';
import { RULES_TEMPLATES } from '../../agentRules/templates';
import { applyGroupRules, applyGroupTemplate3d, openGroupAsNodes, setGroupShape, setGroupSpace, setGroupView } from '../../agentRules/storeActions';
import { CAMERA_3D, CAMERA_CONTROLS, RULES_TEMPLATES_3D, SHAPE_KINDS, rescaleForSpace, shapeOf, type AgentSpace, type CameraKey, type ShapeKind } from '../../agentRules/space3d';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { surpriseAgentsAction, useSurpriseSeeds } from '../surprise/surpriseActions';
import { AGENT_VIEWS, agentsViewOf, type AgentsView } from '../../agentRules/outputs';
import { type EditCtx, Num, RuleCard } from '../agentRules/RuleEditors';
import { finishBuilder } from '../../builders/finish';
import { focusRecipeEditor, useBuilderRecipeRequest } from '../../builders/windows';

const hex = (c: number[]) => `#${c.slice(0, 3).map(v => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const move = <T,>(list: T[], from: number, to: number) => { const out = [...list]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out; };

export function AgentRulesModal({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const tk = useTokens();
  const [set, setSet] = useState<AgentRuleSet>(() => groupRules(node));
  const [sp, setSp] = useState(0);
  const [showLines, setShowLines] = useState(false);
  const [tab, setTab] = useRememberedTab('agent-rules', AGENT_RULES_TABS, 'rules');
  // ⌘⇧D: the Recipe tab, its text focused.
  useBuilderRecipeRequest(() => { setTab('recipe'); focusRecipeEditor('[data-language-tab="agents"] textarea'); });
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
  // Rules changed outside the editor (Surprise me, Undo): show them, unless an edit is on its way.
  useEffect(() => useNodeGraphStore.subscribe((st, prev) => {
    const now = st.nodes.find(x => x.id === node.id);
    const was = prev.nodes.find(x => x.id === node.id);
    if (now && now.params.agentRules !== was?.params.agentRules && !pending.current) setSet(groupRules(now));
  }), [node.id]);
  const surpriseSeed = useSurpriseSeeds(st => st.agents[node.id] ?? null);

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
  const kind = kindOf(set);
  const ctx: EditCtx = { set, s, tk, channelOptions, kind };
  // The Kind picks which sections show (and the rule set keeps in view whatever it uses: spec.ts showsSection).
  const shows = (section: RulesSection) => showsSection(set, section);
  // Templates: this kind's first, then the rest.
  const ownTemplates = WALKER_KINDS[kind].templates;
  // In 3D the 3D setups come first (each sets the Emit, Trail and camera too); a flat template is rescaled for the volume.
  const templates3d = RULES_TEMPLATES_3D.map(t => ({ value: `3d:${t.key}`, label: t.label, group: d3 ? '3D setups' : 'In 3D (switches Space)' }));
  const templateOptions = [
    { value: '', label: 'Templates…' },
    ...(d3 ? templates3d : []),
    ...RULES_TEMPLATES.filter(t => ownTemplates.includes(t.key)).map(t => ({ value: t.key, label: t.label, group: d3 ? `${WALKER_KINDS[kind].label} (rules only)` : WALKER_KINDS[kind].label })),
    ...RULES_TEMPLATES.filter(t => !ownTemplates.includes(t.key)).map(t => ({ value: t.key, label: t.label, group: d3 ? 'Other kinds (rules only)' : 'Other kinds' })),
    ...(d3 ? [] : templates3d),
  ];
  const pickTemplate = (k: string) => {
    if (k.startsWith('3d:')) { flush(); applyGroupTemplate3d(node.id, k.slice(3)); setSp(0); return; }
    const t = RULES_TEMPLATES.find(x => x.key === k);
    // A group round a shape keeps its Collide through a flat template.
    if (t) { const next = d3 ? rescaleForSpace(t.set(), '3d') : t.set(); update(set.collide ? { ...next, collide: set.collide } : next); setSp(0); }
  };
  const setSpace = (to: AgentSpace) => { flush(); setGroupSpace(node.id, to); };
  const draw = useNodeGraphStore(st => agentsViewOf(st.nodes, node.id).draw);
  // Round a shape: the shape's kind, and the March Camera Draw agents sees through (its camera then is the scene's).
  const shape = useNodeGraphStore(st => shapeOf(st.nodes, node.id)?.kind ?? null);
  const sceneCam = useNodeGraphStore(st => {
    const id = agentsViewOf(st.nodes, node.id).draw?.inputs.camOrigin?.connection?.nodeId;
    return id ? st.nodes.find(x => x.id === id && x.type === 'marchCamera') : undefined;
  });
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
      <SectionLabel hint="What kind of walkers these are: it picks which settings, conditions and actions the editor offers, and the templates shown first. It changes nothing the rules do.">Kind</SectionLabel>
      <Row label="Kind" hint="Trail followers, Particles, Flock (boids), Ants / carriers, Swarm / orbiters or Crowd: which settings, conditions and actions show."><Select ariaLabel="Kind of walkers" value={kind} options={WALKER_KIND_KEYS.map(k => ({ value: k, label: WALKER_KINDS[k].label }))} onChange={v => update({ ...set, kind: v as WalkerKind })} /></Row>
      <Note>{WALKER_KINDS[kind].blurb}</Note>
      {shows('neighbours') && <>
        <Row label="View radius" hint="How far each walker looks for its neighbours (picture units; the picture is 2 tall), for the neighbour conditions and actions that don't set their own. The group's grid cells are at least this big."><Num value={set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius} step={0.005} onCommit={v => update({ ...set, neighbours: { radius: Math.max(0.005, v), max: set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max } })} title="How far each walker looks for its neighbours (picture units)" /></Row>
        <Row label="Max neighbours" hint="How many walkers a reading reads at most (its cost). In a crowd denser than this, counts and averages are estimates from a fixed sample."><Num value={set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max} step={1} onCommit={v => update({ ...set, neighbours: { radius: set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius, max: Math.min(216, Math.max(1, Math.round(v))) } })} title="How many walkers a reading reads at most" /></Row>
      </>}
      <SectionLabel hint="Up to four kinds of walker, each with its own rules, speed and states. Each lays its own trail channel by default.">Species</SectionLabel>
      {pickSpecies}
      <Row label="Name" hint="The species' name, used in the sentences."><Field value={species.name} onChange={e => setSpecies({ name: e.target.value })} aria-label="Species name" height={30} /></Row>
      <Row label="Speed" hint="Picture units a second: each walker starts at it (Set speed and Accelerate change it)."><Num value={species.speed} step={0.01} onCommit={v => setSpecies({ speed: v })} title="Picture units a second: each walker starts at it (Set speed and Accelerate change it)" /></Row>
      <Row label="Edges" hint="What happens at the picture's edges, for every species: wrap round, bounce back or slide along."><Select ariaLabel="Edges" value={set.edges} options={[{ value: 'wrap', label: 'Wrap' }, { value: 'bounce', label: 'Bounce' }, { value: 'slide', label: 'Slide' }]} onChange={v => update({ ...set, edges: v as AgentRuleSet['edges'] })} /></Row>
      {set.species.length > 1 && <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { update({ ...set, species: set.species.filter((_, i) => i !== s) }); setSp(0); }}>Remove this species</Button>}

      {shows('states') && <>
      <SectionLabel meta="Memory x" hint="Each walker is in one state (born in the first). Rules check it (in state) and change it (become).">States</SectionLabel>
      <Note>Each walker is in one state (born in the first). Draw agents' Colour by State shows its colour.</Note>
      </>}
      {shows('states') && species.states.map((st, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 28px', gap: 6, alignItems: 'center' }}>
          <input type="color" aria-label={`${st.name} colour`} value={hex(st.colour)} onChange={e => setSpecies({ states: species.states.map((x, j) => (j === i ? { ...x, colour: fromHex(e.target.value) } : x)) })}
            style={{ width: 28, height: 28, padding: 0, border: 0, borderRadius: 6, background: 'none', cursor: 'pointer' }} />
          <Field value={st.name} onChange={e => setSpecies({ states: species.states.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`State ${i + 1} name`} height={30} />
          <IconButton icon="close" label="Remove state" size="sm" tone="danger" disabled={species.states.length === 1} onClick={() => setSpecies({ states: species.states.filter((_, j) => j !== i) })} />
        </div>
      ))}
      {shows('states') && species.states.length < MAX_STATES && <AddRow onClick={() => setSpecies({ states: [...species.states, { name: `state ${species.states.length + 1}`, colour: DEFAULT_STATE_COLOURS[species.states.length % DEFAULT_STATE_COLOURS.length] }] })}>Add state</AddRow>}
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
      {shows('masks') && <BuilderFold foldKey="agentRules:open:masks" title="Masks" summary={set.masks.length ? `${set.masks.map(m => m.name).join(', ')} · inputs on the card` : 'none: inputs on the card for food, walls, a nest'}>
        <Note>Inputs on the group card: a texture (its brightness) or a number chain, read where the walker stands. Rules check them with "inside a mask".</Note>
        {set.masks.map((m, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 112px 28px', gap: 6, alignItems: 'center', maxWidth: 480 }}>
            <Field value={m.name} onChange={e => update({ ...set, masks: set.masks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`Mask ${i + 1} name`} height={30} />
            <Select ariaLabel={`Mask ${i + 1} kind`} value={m.kind} options={[{ value: 'number', label: 'A number' }, { value: 'texture', label: 'A texture' }]} onChange={v => update({ ...set, masks: set.masks.map((x, j) => (j === i ? { ...x, kind: v as 'number' | 'texture' } : x)) })} />
            <IconButton icon="close" label="Remove mask" size="sm" tone="danger" onClick={() => update({ ...set, masks: set.masks.filter((_, j) => j !== i) })} />
          </div>
        ))}
        {set.masks.length < MAX_MASKS && <AddRow onClick={() => update({ ...set, masks: [...set.masks, { name: set.masks.length ? 'Mask 2' : 'Mask', kind: 'number' }] })}>Add mask</AddRow>}
      </BuilderFold>}
    </TabPane>
  );

  const trailsTab = (
    <TabPane>
      {!shows('channels') && !shows('sensors') && <Note>{WALKER_KINDS[kind].label} don't smell a trail{shows('neighbours') ? ': they see each other with Neighbours' : ''}. Leave trail (Do) still paints one for the picture; the trail settings show here once a rule reads one.</Note>}
      {shows('channels') && <>
      <SectionLabel hint="Four trail channels, one per species by default. Name them (food, home) and the rules read as sentences.">Trail channels</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {[0, 1, 2, 3].map(c => (
          <Field key={c} value={set.channels[c] ?? ''} placeholder={`trail ${c + 1}${c === 3 && usesAction(set, 'spawn') ? ' (births)' : ''}`} aria-label={`Name of trail channel ${c + 1}`} height={30}
            onChange={e => update({ ...set, channels: set.channels.map((x, j) => (j === c ? e.target.value : x)) })} />
        ))}
      </div>
      <Note>Rules leave trail with Do → leave trail, and read it with When → trail ahead / to the left / here.</Note>
      </>}
      {shows('sensors') && <BuilderFold foldKey="agentRules:open:sensing" title="Sensors" summary={`${set.sensor.distance} ahead · ${set.sensor.angle}° apart`}>
        <Row label="Sensors ahead" hint="How far ahead the sensors read the trail (picture units; ten times further in 3D)."><Num value={set.sensor.distance} step={0.005} onCommit={v => update({ ...set, sensor: { ...set.sensor, distance: v } })} title="How far ahead the sensors read the trail (picture units; ten times further in 3D)" /></Row>
        <Row label="Sensor angle" hint="Degrees between the ahead sensor and the side ones."><Num value={set.sensor.angle} step={1} onCommit={v => update({ ...set, sensor: { ...set.sensor, angle: v } })} title="Degrees between the ahead sensor and the side ones" /></Row>
      </BuilderFold>}
      {usesFlow(set) && (
        <BuilderFold foldKey="agentRules:open:flow" title="Flow field" summary={`size ${set.flow.size} · evolve ${set.flow.evolve}`}>
          <Row label="Flow size" hint="Follow a flow field or curl noise as a force: how big the swirls of the curl noise are."><Num value={set.flow.size} step={0.1} onCommit={v => update({ ...set, flow: { ...set.flow, size: v } })} /></Row>
          <Row label="Flow evolve" hint="Follow a flow field: how fast the flow changes over time."><Num value={set.flow.evolve} step={0.01} onCommit={v => update({ ...set, flow: { ...set.flow, evolve: v } })} /></Row>
        </BuilderFold>
      )}
    </TabPane>
  );

  const pictureShows = <>
    <Select ariaLabel="What the picture shows" value={view ?? ''} height={30}
      options={[...(view ? [] : [{ value: '', label: 'Not wired: nothing reads the trail' }]), ...AGENT_VIEWS.map(v => ({ value: v.value, label: v.label }))]}
      onChange={v => { if (v) setGroupView(node.id, v as AgentsView); }} />
    <Note>{AGENT_VIEWS.find(v => v.value === view)?.hint ?? (d3 ? 'In 3D the trail\'s picture is the volume seen flat from the front; the camera above is how you see the walkers.' : 'Wire the Trail field\'s Amount into a Palette to see the trail.')}</Note>
  </>;
  const cam = (k: CameraKey) => (typeof draw?.params[k] === 'number' ? draw.params[k] as number : CAMERA_3D[k]);
  const lookTab = (
    <TabPane>
      {d3 && <>
        <SectionLabel meta={sceneCam ? 'March Camera' : draw ? 'Draw agents' : undefined} hint="In 3D the walkers are seen through a camera: Draw agents' own, or the March Camera of the shape they are round. Where it stands, how it turns, what is sharp.">Camera</SectionLabel>
        <BuilderHelp id="camera" />
        {draw ? <>
          {CAMERA_CONTROLS.filter(c => !c.fold).map(c => (sceneCam
            ? <CameraRow key={c.key} node={sceneCam} k={c.key} label={c.label} step={c.key === 'camAngle' || c.key === 'camElevation' || c.key === 'rotSpeed' ? 0.01 : c.step} />
            : <CameraRow key={c.key} node={draw} k={c.key} label={c.label} step={c.step} />))}
          {sceneCam && <Note>Round a shape the walkers are seen through the shape's March Camera, so these move it (angles in radians); the shape and the walkers move together.</Note>}
          <BuilderFold foldKey="agentRules:open:dof" title="Depth of field" summary={`focus ${cam('focus')} · blur ${cam('blur')}`}>
            {CAMERA_CONTROLS.filter(c => c.fold).map(c => <CameraRow key={c.key} node={draw} k={c.key} label={c.label} step={c.step} />)}
          </BuilderFold>
        </> : <Note>No Draw agents shows this group, so there is no camera: the card's Next steps adds one (Draw agents), or switch Space to 2D and back.</Note>}
        <BuilderFold foldKey="agentRules:open:shape" title="Around a shape" summary={shape ? `${SHAPE_KINDS.find(k => k.value === shape)?.label ?? shape} · Collide (3D scene)` : 'none: the walkers fill the box'}>
          <BuilderHelp id="shape" />
          <Row label="Shape" hint="A ray-marched shape in the middle of the box: Collide (3D scene) keeps the walkers out of it, and they are drawn through its camera, hidden behind it. None takes it away again.">
            <Select ariaLabel="Around a shape" value={shape ?? ''} height={30}
              options={[{ value: '', label: 'None' }, ...SHAPE_KINDS.map(k => ({ value: k.value, label: k.label }))]}
              onChange={v => { flush(); setGroupShape(node.id, (v || null) as ShapeKind | null); }} />
          </Row>
        </BuilderFold>
        <BuilderFold foldKey="agentRules:open:picture3d" title="What the picture shows" summary={view ? `${AGENT_VIEWS.find(v => v.value === view)?.label ?? view} · the trail seen flat` : 'the walkers, through the camera'}>
          {pictureShows}
        </BuilderFold>
      </>}
      {!d3 && <>
        <SectionLabel hint="What the group's picture shows: the trail, one trail channel, or where the walkers are. Each is also an output socket.">What the picture shows</SectionLabel>
        {pictureShows}
      </>}
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
      headerActions={<>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} data-agent-space={d3 ? '3d' : '2d'}>
          <HintLabel hint="Space: 2D walkers move on the picture; 3D walkers fill a box seen through a camera. Switching turns the setup (Trail ↔ volume, Disc ↔ Ball, sensors and speed rescaled, a camera view); undo switches it back.">
            <span style={{ fontSize: 12, color: tk.text.muted }}>Space</span>
          </HintLabel>
          <Segmented size="sm" ariaLabel="Space" value={d3 ? '3d' : '2d'} onChange={v => setSpace(v)}
            options={[{ value: '2d' as AgentSpace, label: '2D' }, { value: '3d' as AgentSpace, label: '3D' }]} />
        </span>
        <SurpriseBar seed={surpriseSeed} onSurprise={seed => { flush(); surpriseAgentsAction(node.id, seed); setSp(0); }}
          title="A random rule set: a walker kind, its sensors, turn, speed, trail and colours, sometimes a second species (one undo step)" />
        <Select ariaLabel="Start from a template" value="" height={30}
          options={templateOptions}
          onChange={pickTemplate} />
      </>}
      footer={<>
        <Button icon="fn" title="Show the nodes these rules make (Start, a block per rule, Finish, Move), every one with a note, and edit them as nodes" onClick={() => { flush(); onClose(); openGroupAsNodes(node.id); }}>Open as nodes</Button>
        <Toggle checked={showLines} onChange={setShowLines} label="Show the lines" />
        <span style={{ flex: 1 }} />
        <Note>Memory holds a state and one number · changes apply live</Note>
        <Button variant="primary" onClick={() => finishBuilder(close, [node.id])}>Done</Button>
      </>}
    >
      <div data-agent-tab={tab} style={{ display: 'contents' }}>
        {tab === 'species' && speciesTab}
        {tab === 'rules' && rulesTab}
        {tab === 'trails' && trailsTab}
        {tab === 'look' && lookTab}
        {tab === 'recipe' && <TabPane wide><AgentsRecipe set={set} onApply={next => { update(set.collide && !next.collide ? { ...next, collide: set.collide } : next); flush(); setSp(0); }} /></TabPane>}
      </div>
    </BuilderWindow>
  );
}

/** The whole rule set as text in the Playfield language (lang/dialects/agents.ts), both ways. */
function AgentsRecipe({ set, onApply }: { set: AgentRuleSet; onApply: (next: AgentRuleSet) => void }) {
  const printed = useMemo(() => printAgents(set, { pretty: true }), [set]);
  const read = useCallback((text: string, seed: number): LanguageRead => {
    const r = parseAgents(text, { seed });
    return { errors: r.errors, hints: r.hints, resolved: r.resolved, apply: () => onApply(r.set), kept: printAgents(r.set, { pretty: true }) };
  }, [onApply]);
  return (
    <LanguageTab dialect="agents" printed={printed} read={read}
      note="Settings first (agents, sensors, channels, masks), then each species with its rules indented under it: when <condition> and … do <action>, …  or always do …. On one line a species takes its rules after a colon: species Slime: always do wander 7deg. A bare word in a condition is a state; a channel is followed by where it is read (ahead, left, right, anywhere, here); a mask follows mask."
      examples={[
        { label: 'Slime mold', text: 'agents kind=trail\nsensors ahead=0.035 angle=22.5deg\nspecies Slime speed=0.22\n  always do turn toward trail 45deg, wander 7deg, leave trail 1' },
        { label: 'Boids', text: 'agents kind=flock view=0.05\nspecies Birds speed=0.4\n  always do separate 12deg, match 10deg, cohere 2.5deg, wander 3deg' },
        { label: 'Random slime', text: 'random agents kind=trail\nspecies Slime\n  always do turn toward trail random, wander random, leave trail 1' },
      ]} />
  );
}

/** A tab's body: settings at a readable width; the rules use the whole width. */
function TabPane({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div style={{ flex: 1, minWidth: 0, padding: '16px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box', ...(wide ? {} : { maxWidth: 620 }) }}>{children}</div>;
}

/**
 * One camera setting on the Look tab in 3D (Draw agents' own, or the shape's March Camera): a ruler
 * slider writing the card's param (one undo step a drag). Typing past its range widens it, kept on the card (__scMax_).
 */
function CameraRow({ node: cam, k, label, step }: { node: GraphNode; k: CameraKey; label: string; step: number }) {
  const def = getNodeDefinition(cam.type)?.paramDefs?.[k];
  const fallback = (getNodeDefinition(cam.type)?.defaultParams?.[k] as number | undefined) ?? CAMERA_3D[k];
  const value = typeof cam.params[k] === 'number' ? cam.params[k] as number : fallback;
  const range = paramSliderRange(cam.params, k, { min: def?.min, max: def?.max });
  const set = (patch: Record<string, unknown>) => useNodeGraphStore.getState().updateNodeParams(cam.id, patch);
  return (
    <Row label={label} hint={typeof def?.hint === 'string' ? def.hint : undefined}>
      <div data-camera={k}>
        <RulerSlider value={value} min={range.min} max={range.max} step={step} defaultValue={fallback} ariaLabel={label}
          onChange={v => set({ [k]: v })} onRange={(min, max) => set(extendRangePatch(k, min, max))} />
      </div>
    </Row>
  );
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
