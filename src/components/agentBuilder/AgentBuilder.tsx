/**
 * The Agent Builder (docs/agent-builder.md), on the shared builder shell (builders/studio):
 *
 *  - with no group yet, its start page: "What are you making?" (Trail followers, Particles,
 *    Flocks, Orbiters, each with a moving picture) and 2D / 3D. Picking one adds the group;
 *  - on a group, Trail followers' sections as behaviour cards (Born, Senses, Turning, Moving,
 *    Trail, and Advanced rules for anything else), the live picture in the middle with the
 *    selected setting's diagram over it, and presets along the bottom.
 *
 * The cards write the group's rule set (agentBuilder/cards.ts), so the inside is generated as it
 * always was (agentRules/generate.ts) and Open as nodes, Play and export are unchanged. Born and
 * the trail's Fades / Spreads write the Emit and the Trail field round the group. Changes apply
 * live: a quarter of a second after you stop, one undo step a burst.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { PresetCard, StudioLabel, StudioNavItem, StudioShell } from '../builders/studio/StudioShell';
import { LiveViewport, type ViewRect } from '../builders/studio/LiveViewport';
import { groupRules } from '../../agentRules/apply';
import { type AgentRuleSet, type ChannelRef, kindOf, WALKER_KINDS } from '../../agentRules/spec';
import { applyGroupRules, openGroupAsNodes, setGroupSpace } from '../../agentRules/storeActions';
import { openAgentRulesWindow } from '../../builders/windows';
import { patchCard, readCards, sectionSummary, setCardOn, setEdges, setSensors, setSpeed, smellChips } from '../../agentBuilder/cards';
import { type DiagramFocus, type DiagramSection } from '../../agentBuilder/diagram';
import { START_CARDS, type StartCard } from '../../agentBuilder/kinds';
import { TRAIL_PRESETS } from '../../agentBuilder/presets';
import { SETTING_HINTS, TRAIL_SECTIONS, sectionWords, type TrailSection } from '../../agentBuilder/words';
import { applyBuilderPreset, discardAgentGroup, makeAgentGroup, setSetupParam, setupOf } from '../../agentBuilder/actions';
import { BehaviourCard, ChipRow, SettingRow, SliderSetting } from './BehaviourCard';
import { WalkerDiagram, type BornInfo } from './WalkerDiagram';
import { useLensRef } from './useLensRef';
import { KindPicture } from './pictures';
import { usePresetThumbs } from './presetThumbs';

type Section = TrailSection | 'advanced';

export function AgentBuilder({ groupId, onClose, onOpenGroup }: {
  groupId: string | null; onClose: () => void;
  /** The builder moved to a group it made (the host keeps its window on it). */
  onOpenGroup?: (id: string | null) => void;
}) {
  const [made, setMade] = useState<{ groupId: string; before: GraphNode[] } | null>(null);
  const [startSpace, setStartSpace] = useState<'2d' | '3d'>('2d');
  const id = groupId ?? made?.groupId ?? null;
  const pick = (card: StartCard) => {
    const r = makeAgentGroup(card, startSpace);
    if (!r) return;
    if (!card.built) { openAgentRulesWindow(r.groupId); return; }
    setMade(r);
    onOpenGroup?.(r.groupId);
  };
  if (!id) return <StartPage space={startSpace} onSpace={setStartSpace} onPick={pick} onClose={onClose} />;
  return (
    <TrailEditor key={id} groupId={id} madeHere={made?.groupId === id} onClose={onClose}
      onBack={made?.groupId === id ? () => { const before = made.before; setMade(null); onOpenGroup?.(null); discardAgentGroup(before); } : undefined} />
  );
}

// ── Start page ───────────────────────────────────────────────────────────────

function StartPage({ space, onSpace, onPick, onClose }: { space: '2d' | '3d'; onSpace: (v: '2d' | '3d') => void; onPick: (c: StartCard) => void; onClose: () => void }) {
  const tk = useTokens();
  return (
    <StudioShell prefsKey="agent-builder" icon="swarm" title="Agent Builder" kind="What are you making?" onClose={onClose}>
      <div data-agent-start style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 24px', gap: 22 }}>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <b style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' }}>What are you making?</b>
          <span style={{ fontSize: 12.5, color: tk.text.muted }}>Many small walkers, one big pattern. Pick a kind; you can change everything after.</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: tk.text.muted }}>
          Make it in
          <Segmented ariaLabel="Start in 2D or 3D" value={space} onChange={onSpace} options={[{ value: '2d' as const, label: '2D' }, { value: '3d' as const, label: '3D' }]} />
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, width: '100%', maxWidth: 1120 }}>
          {START_CARDS.map(c => <StartKindCard key={c.id} card={c} onPick={() => onPick(c)} />)}
        </div>
      </div>
    </StudioShell>
  );
}

function StartKindCard({ card, onPick }: { card: StartCard; onPick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" data-start-kind={card.id} onClick={onPick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={card.built ? undefined : 'Opens the rules editor for now: its builder sections come next.'}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10, padding: 10, border: 0, borderRadius: radius.card, cursor: 'pointer', textAlign: 'left',
        background: hover ? tk.bg.hover : tk.bg.panel, boxShadow: hover ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary,
      }}>
      <KindPicture kind={card.id} width={240} height={136} />
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 4px' }}>
        <b style={{ fontSize: 14, fontWeight: 650 }}>{card.label}</b>
        <span style={{ fontSize: 12, color: tk.text.muted, flex: 1 }}>{card.makes}</span>
      </span>
      {!card.built && <span data-start-old style={{ padding: '0 4px', fontSize: 11, color: tk.text.faint }}>Opens the rules editor for now</span>}
    </button>
  );
}

// ── Trail followers ──────────────────────────────────────────────────────────

const COUNT_OPTIONS = [{ value: '64k', label: '64k' }, { value: '256k', label: '256k' }, { value: '1m', label: '1M' }, { value: '4m', label: '4M' }] as const;
const SHAPES_2D = [{ value: 'disc', label: 'Disc' }, { value: 'ring', label: 'Ring' }, { value: 'box', label: 'Box' }, { value: 'point', label: 'Point' }, { value: 'line', label: 'Line' }, { value: 'screen', label: 'Whole picture' }];
const SHAPES_3D = [{ value: 'ball', label: 'Ball' }, { value: 'sphere', label: 'Sphere (shell)' }, { value: 'box', label: 'Box' }, { value: 'point', label: 'Point' }, { value: 'screen', label: 'Whole box' }];
const FACING = [{ value: 'random', label: 'Any way' }, { value: 'inward', label: 'Inward' }, { value: 'outward', label: 'Outward' }, { value: 'up', label: 'Up' }];
const BIRTHS = [{ value: 'fill', label: 'All at once' }, { value: 'rate', label: 'A stream' }, { value: 'respawn', label: 'Kept full' }];
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

function TrailEditor({ groupId, madeHere, onClose, onBack }: { groupId: string; madeHere: boolean; onClose: () => void; onBack?: () => void }) {
  const tk = useTokens();
  const group = useNodeGraphStore(s => s.nodes.find(x => x.id === groupId));
  const emit = useNodeGraphStore(s => setupOf(s.nodes, groupId).emit);
  const trailNode = useNodeGraphStore(s => setupOf(s.nodes, groupId).trail);
  const [set, setSet] = useState<AgentRuleSet>(() => (group ? groupRules(group) : groupRules({ id: '', type: 'agentsGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} })));
  const [sp, setSp] = useState(0);
  const [focus, setFocus] = useState<DiagramFocus>({ section: 'senses' });
  const [preset, setPreset] = useState<string | null>(null);

  // Live edits: applied a quarter of a second after the last change (one undo step a burst).
  const pending = useRef<AgentRuleSet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) { applyGroupRules(groupId, pending.current, 'Agent Builder: edited'); pending.current = null; }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: AgentRuleSet) => {
    setSet(next);
    setPreset(null);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 250);
  };
  // Changed outside (undo, a preset, the rules editor): show it, unless an edit is on its way.
  useEffect(() => useNodeGraphStore.subscribe((st, prev) => {
    const now = st.nodes.find(x => x.id === groupId);
    const was = prev.nodes.find(x => x.id === groupId);
    if (now && now.params.agentRules !== was?.params.agentRules && !pending.current) setSet(groupRules(now));
  }), [groupId]);

  const s = Math.min(sp, set.species.length - 1);
  const cards = useMemo(() => readCards(set, s), [set, s]);
  const d3 = group?.params.space === '3d';
  const [advanced, setAdvanced] = useState(false);
  const shown: Section = advanced ? 'advanced' : focus.section;
  const select = (x: Section) => { if (x === 'advanced') setAdvanced(true); else { setAdvanced(false); setFocus({ section: x as DiagramSection }); } };
  const onFocusSetting = (setting: string | undefined) => setFocus(f => ({ section: f.section, setting }));

  const born: BornInfo = {
    shape: String(emit?.params.shape ?? 'disc'), size: num(emit?.params.size, 0.6), x: num(emit?.params.x, 0), y: num(emit?.params.y, 0),
    count: String(group?.params.tier ?? '256k'),
  };
  const trail = { halfLife: num(trailNode?.params.halfLife, 0.12), diffuse: num(trailNode?.params.diffuse, 1) };
  const lensRef = useLensRef(cards.senses.distance, focus.section);
  const thumbs = usePresetThumbs(TRAIL_PRESETS);

  if (!group) return null;
  const name = (typeof group.params.label === 'string' && group.params.label) || 'Agents';
  const kindLabel = WALKER_KINDS[kindOf(set)].label;
  const words = (x: TrailSection) => sectionWords(x);
  const sp3 = (v: number) => (d3 ? v * 10 : v);

  const close = () => { flush(); onClose(); };
  const applyPreset = (key: string) => {
    flush();
    const next = applyBuilderPreset(groupId, key);
    if (next) { setSet(next); setSp(0); setPreset(key); }
  };

  // ── Cards ──
  const bornCard = (
    <BehaviourCard id="born" picture="born" title="Born" hint={words('born').hint} learn={words('born').learn} guide={words('born').guide}
      summary={`${(d3 ? SHAPES_3D : SHAPES_2D).find(x => x.value === born.shape)?.label ?? born.shape} · ${born.count.replace('m', 'M')}`}
      more={<>
        <SettingRow id="facing" label="Facing" hint={SETTING_HINTS.facing} onFocus={onFocusSetting}>
          <Select ariaLabel="Facing" value={String(emit?.params.heading ?? 'inward')} options={FACING} onChange={v => setSetupParam(emit?.id, { heading: v })} />
        </SettingRow>
        <SettingRow id="births" label="Births" hint={SETTING_HINTS.births} onFocus={onFocusSetting}>
          <Select ariaLabel="Births" value={String(emit?.params.mode ?? 'fill')} options={BIRTHS} onChange={v => setSetupParam(emit?.id, { mode: v })} />
        </SettingRow>
      </>}>
      {!emit && <span style={{ fontSize: 12, color: tk.text.muted }}>No Emit is wired into this group: they are born anywhere, all at once.</span>}
      <SettingRow id="where" label="Where" hint={SETTING_HINTS.where} onFocus={onFocusSetting}>
        <Select ariaLabel="Where they are born" value={born.shape} options={(d3 ? SHAPES_3D : SHAPES_2D).concat((d3 ? SHAPES_3D : SHAPES_2D).some(x => x.value === born.shape) ? [] : [{ value: born.shape, label: born.shape }])}
          onChange={v => setSetupParam(emit?.id, { shape: v })} />
      </SettingRow>
      <SliderSetting id="size" label="Size" hint={SETTING_HINTS.size} value={born.size} min={0} max={2} step={0.01} onFocus={onFocusSetting}
        onChange={v => setSetupParam(emit?.id, { size: v })} disabled={!emit || born.shape === 'screen' || born.shape === 'point'} />
      <SettingRow id="count" label="How many" hint={SETTING_HINTS.count} onFocus={onFocusSetting}>
        <Segmented size="sm" ariaLabel="How many walkers" value={born.count as typeof COUNT_OPTIONS[number]['value']} options={COUNT_OPTIONS} onChange={v => setSetupParam(groupId, { tier: v })} />
      </SettingRow>
    </BehaviourCard>
  );

  const chips = smellChips(set).map(c => ({ ...c, dot: c.value === 'own' ? undefined : ['#e8a33a', '#57b6ff', '#7ad38a', '#c792ea'][c.value as number] }));
  const sensesCard = (
    <BehaviourCard id="senses" picture="senses" title="Senses" hint={words('senses').hint} learn={words('senses').learn} guide={words('senses').guide}
      summary={sectionSummary(cards, 'senses')} on={cards.senses.on} onToggle={on => update(setCardOn(set, s, 'senses', on))}>
      <SliderSetting id="distance" label="How far ahead" hint={SETTING_HINTS.distance} value={cards.senses.distance} min={0} max={sp3(0.12)} step={0.001}
        onFocus={onFocusSetting} onChange={v => update(setSensors(set, { distance: Math.max(0.001, v) }))} />
      <SliderSetting id="angle" label="How wide" hint={SETTING_HINTS.angle} value={cards.senses.angle} min={0} max={90} step={0.5}
        onFocus={onFocusSetting} onChange={v => update(setSensors(set, { angle: v }))} />
      <SettingRow id="smells" label="Smells" hint={SETTING_HINTS.smells} onFocus={onFocusSetting}
        right={<Toggle checked={cards.senses.away} onChange={v => update(patchCard(set, s, 'senses', { away: v || undefined }))} label="Avoid it" />}>
        <ChipRow label="Smells" options={chips} value={cards.senses.channel} onChange={v => update(patchCard(set, s, 'senses', { channel: v as ChannelRef }))} />
      </SettingRow>
    </BehaviourCard>
  );

  const turningCard = (
    <BehaviourCard id="turning" picture="turning" title="Turning" hint={words('turning').hint} learn={words('turning').learn} guide={words('turning').guide}
      summary={sectionSummary(cards, 'turning')}>
      <SliderSetting id="sharp" label="How sharply" hint={cards.turning.sharpOn ? SETTING_HINTS.sharp : 'Senses is off: switch it on to turn toward a smell.'} value={cards.turning.sharp} min={0} max={90} step={0.5}
        onFocus={onFocusSetting} disabled={!cards.senses.there} onChange={v => update(patchCard(set, s, 'senses', { degrees: v }))} />
      <SliderSetting id="wobble" label="Wobble" hint={SETTING_HINTS.wobble} value={cards.turning.wobble} min={0} max={45} step={0.5}
        onFocus={onFocusSetting} onChange={v => update(patchCard(set, s, 'wobble', { degrees: v }))}
        right={<span data-card-switch="wobble"><Toggle checked={cards.turning.wobbleOn} onChange={on => update(setCardOn(set, s, 'wobble', on))} /></span>} />
    </BehaviourCard>
  );

  const movingCard = (
    <BehaviourCard id="moving" picture="moving" title="Moving" hint={words('moving').hint} learn={words('moving').learn} guide={words('moving').guide}
      summary={sectionSummary(cards, 'moving')}>
      <SliderSetting id="speed" label="Speed" hint={SETTING_HINTS.speed} value={cards.moving.speed} min={0} max={d3 ? 2 : 1} step={0.005}
        onFocus={onFocusSetting} onChange={v => update(setSpeed(set, s, v))} />
      <SettingRow id="edges" label="At the edges" hint={SETTING_HINTS.edges} onFocus={onFocusSetting}>
        <Segmented size="sm" fill ariaLabel="At the edges" value={cards.moving.edges} onChange={v => update(setEdges(set, v))}
          options={[{ value: 'wrap' as const, label: 'Wrap' }, { value: 'bounce' as const, label: 'Bounce' }, { value: 'slide' as const, label: 'Slide' }]} />
      </SettingRow>
    </BehaviourCard>
  );

  const trailCard = (
    <BehaviourCard id="trail" picture="trail" title="Trail" hint={words('trail').hint} learn={words('trail').learn} guide={words('trail').guide}
      summary={sectionSummary(cards, 'trail')} on={cards.trail.on} onToggle={on => update(setCardOn(set, s, 'trail', on))}
      more={<SettingRow id="lays" label="Lays" hint={SETTING_HINTS.lays} onFocus={onFocusSetting}>
        <ChipRow label="Lays" options={chips} value={cards.trail.channel} onChange={v => update(patchCard(set, s, 'trail', { channel: v as ChannelRef }))} />
      </SettingRow>}>
      <SliderSetting id="amount" label="Leaves" hint={SETTING_HINTS.amount} value={cards.trail.amount} min={0} max={4} step={0.05}
        onFocus={onFocusSetting} onChange={v => update(patchCard(set, s, 'trail', { amount: v }))} />
      {trailNode ? <>
        <SliderSetting id="fades" label="Fades" hint={SETTING_HINTS.fades} value={trail.halfLife} min={0.005} max={1} step={0.005}
          onFocus={onFocusSetting} onChange={v => setSetupParam(trailNode.id, { halfLife: Math.max(0.005, v) })} />
        <SliderSetting id="spreads" label="Spreads" hint={SETTING_HINTS.spreads} value={trail.diffuse} min={0} max={1} step={0.01}
          onFocus={onFocusSetting} onChange={v => setSetupParam(trailNode.id, { diffuse: v })} />
      </> : <span style={{ fontSize: 12, color: tk.text.muted }}>No Trail field: wire the group into a Deposit and a Trail field to see and smell it.</span>}
    </BehaviourCard>
  );

  const advancedCards = (
    <BehaviourCard id="advanced" picture="advanced" title="Advanced rules" hint="Rules the cards can't show yet (conditions, states, memory): they keep working; edit them in the rules editor."
      summary={`${cards.advanced.length} ${cards.advanced.length === 1 ? 'rule' : 'rules'}, run top to bottom`}
      footer={<Button size="sm" icon="expr" data-open-rules-editor onClick={() => { flush(); openAgentRulesWindow(groupId); }}>Edit in the rules editor</Button>}>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cards.advanced.map(a => (
          <li key={a.rule} data-advanced-rule={a.rule} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5, color: a.off ? tk.text.faint : tk.text.secondary }}>
            <span style={{ font: `700 11px ${fontFamily.mono}`, color: tk.text.faint, width: 16, flexShrink: 0, paddingTop: 1 }}>{a.rule + 1}</span>
            <span data-advanced-text>{a.text}</span>
          </li>
        ))}
      </ol>
    </BehaviourCard>
  );

  const inspector = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }} data-inspector={shown}>
      {shown === 'born' && bornCard}
      {shown === 'senses' && sensesCard}
      {shown === 'turning' && turningCard}
      {shown === 'moving' && movingCard}
      {shown === 'trail' && trailCard}
      {shown === 'advanced' && advancedCards}
    </div>
  );

  const summaries: Record<TrailSection, string> = {
    born: `${born.shape} · ${born.count.replace('m', 'M')}`,
    senses: sectionSummary(cards, 'senses'), turning: sectionSummary(cards, 'turning'), moving: sectionSummary(cards, 'moving'), trail: sectionSummary(cards, 'trail'),
  };
  const nav = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 10px' }}>
      {set.species.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <StudioLabel>Kinds</StudioLabel>
          <div role="radiogroup" aria-label="Kinds of walker" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {set.species.map((x, i) => {
              const c = x.states[0]?.colour ?? [1, 1, 1];
              return (
                <button key={i} type="button" role="radio" aria-checked={i === s} data-species={i} onClick={() => setSp(i)}
                  style={{ height: 26, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 13, cursor: 'pointer', font: `500 12px ${fontFamily.ui}`,
                    background: i === s ? tk.bg.selected : tk.bg.field, color: tk.text.primary, boxShadow: i === s ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: `rgb(${c.map(v => Math.round(v * 255)).join(',')})` }} />
                  {x.name || `Kind ${i + 1}`}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StudioLabel meta="one step, in order">Sections</StudioLabel>
        {TRAIL_SECTIONS.map(x => (
          <StudioNavItem key={x.id} id={x.id} icon={x.icon} label={x.label} hint={x.hint} summary={summaries[x.id]} selected={shown === x.id} onClick={() => select(x.id)}
            dim={(x.id === 'senses' && !cards.senses.on) || (x.id === 'trail' && !cards.trail.on)} />
        ))}
        {cards.advanced.length > 0 && (
          <StudioNavItem id="advanced" icon="expr" label="Advanced rules" summary={`${cards.advanced.length} in the rules editor`} selected={shown === 'advanced'} onClick={() => select('advanced')} />
        )}
      </div>
    </div>
  );

  const presets = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <StudioLabel meta="click to apply · undo takes it back">Presets</StudioLabel>
      <div style={{ display: 'flex', gap: 12 }}>
        {TRAIL_PRESETS.map(p => <PresetCard key={p.key} id={p.key} label={p.label} hint={p.hint} src={thumbs[p.key]} active={preset === p.key} onClick={() => applyPreset(p.key)} />)}
      </div>
    </div>
  );

  const overlay = ({ w, h, image }: { w: number; h: number; image: ViewRect }) => (advanced ? null
    : <WalkerDiagram focus={focus} cards={cards} box={{ w, h, image }} born={born} trail={trail} lensRef={lensRef} d3={d3} />);

  return (
    <StudioShell prefsKey="agent-builder" icon="swarm" title={name} kind={`${kindLabel} · ${d3 ? '3D' : '2D'}`} onClose={close}
      onBack={onBack} backLabel="Back to the start (takes this group away)"
      space={{ value: d3 ? '3d' : '2d', onChange: v => { flush(); setGroupSpace(groupId, v); }, hint: 'Switching turns the whole setup (sensors and speed rescaled, Trail ↔ volume); undo switches it back.' }}
      actions={<>
        <IconButton icon="expr" label="All rules (the rules editor)" size="sm" onClick={() => { flush(); openAgentRulesWindow(groupId); }} data-open-rules />
        <IconButton icon="fn" label="Open as nodes" size="sm" onClick={() => { flush(); onClose(); openGroupAsNodes(groupId); }} />
      </>}
      primary={{ label: madeHere ? 'Add to graph' : 'Done', onClick: close, title: madeHere ? 'Keep it (it is already live in your graph, wired to the Output)' : undefined }}
      nav={nav} inspector={inspector} presets={presets}>
      <LiveViewport overlay={overlay} />
    </StudioShell>
  );
}
