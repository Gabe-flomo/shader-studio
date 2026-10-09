/**
 * The Agent Builder (docs/agent-builder.md), on the shared builder shell (builders/studio):
 *
 *  - with no group yet, its start page: "What are you making?" (Trail followers, Particles,
 *    Flocks, Crowds, Orbiters, each with a moving picture) and 2D / 3D. Picking one adds the group;
 *  - on a group, its kind's sections as behaviour cards (agentBuilder/sections.ts): Born, then
 *    Senses · Turning · Moving · Trail (trail followers), Forces · Moving · Life · Look
 *    (particles), Neighbours · Turning · Moving (flocks and crowds), Orbit · Neighbours · Moving
 *    (orbiters), and Advanced rules for anything else; the kinds of walker as chips; the live
 *    picture in the middle with the selected setting's diagram over it; presets along the bottom.
 *
 * The cards write the group's rule set (agentBuilder/behaviours.ts, cards.ts), so the inside is
 * generated as it always was (agentRules/generate.ts) and Open as nodes, Play and export are
 * unchanged. Born, the trail's Fades / Spreads and Look write the nodes round the group. Changes
 * apply live: a quarter of a second after you stop, one undo step a burst.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { restartAgents } from '../../lib/agentRunner';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import { ColorSwatch } from '../ui/ColorPicker';
import { PresetCard, StudioLabel, StudioNavItem, StudioShell } from '../builders/studio/StudioShell';
import { LiveViewport, type ViewRect } from '../builders/studio/LiveViewport';
import { type AgentRuleSet, type ChannelRef, type RuleCondition, DEFAULT_NEIGHBOURS, kindOf, WALKER_KINDS } from '../../agentRules/spec';
import { openGroupAsNodes, setGroupSpace } from '../../agentRules/storeActions';
import { openAgentRulesWindow } from '../../builders/windows';
import { patchCard, readCards, sectionSummary, setCardOn, setEdges, setNeighbours, setSensors, setSpeed, smellChips, type RuleCard } from '../../agentBuilder/cards';
import { type CardRead, readBehaviours, setOnlyWhen, setSpeciesColour } from '../../agentBuilder/behaviours';
import { type DiagramFocus, type DiagramSection } from '../../agentBuilder/diagram';
import { START_CARDS, type StartCard } from '../../agentBuilder/kinds';
import { presetsFor } from '../../agentBuilder/presets';
import { SETTING_HINTS } from '../../agentBuilder/words';
import { CARD_WORDS, KIND_SECTIONS, MORE_HINTS, type SectionId, isTrailKind, kindCards, sectionWordsOf } from '../../agentBuilder/sections';
import { applyBuilderPreset, discardAgentGroup, makeAgentGroup, setSetupParam, setupOf } from '../../agentBuilder/actions';
import { BehaviourCard, ChipRow, SettingRow, SliderSetting } from './BehaviourCard';
import { WalkerDiagram, type BornInfo } from './WalkerDiagram';
import { KindDiagram, OnlyWhenOverlay } from './KindDiagram';
import { SectionCards } from './SectionCards';
import { OnlyWhenLine } from './OnlyWhenLine';
import { KindChips } from './KindChips';
import { SpeciesSpotlight } from './SpeciesSpotlight';
import { useLensRef } from './useLensRef';
import { useRuleSetEditing } from './useRuleSetEditing';
import { KindPicture } from './pictures';
import { usePresetThumbs } from './presetThumbs';
import { HoodLayer, HoodPanel } from './HoodView';
import { channelIndex, hoodHighlights, hoodTrailChannels, TRAIL_HEX, type Rgb } from '../../agentBuilder/hood';
import { type Box, type LegendEntry, entryForFocus, focusOfEntry, legendEntries, moreAbout } from '../../agentBuilder/legend';
import { onlyWhenText } from '../../agentBuilder/onlyWhen';
import { DEMO_H, DEMO_W, FocusDemo, ViewportLegend, type ViewportLink } from './ViewportLegend';
import { Icon } from '../ui/Icon';

type Section = SectionId | 'advanced';

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
    <KindEditor key={id} groupId={id} madeHere={made?.groupId === id} onClose={onClose}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))', gap: 14, width: '100%', maxWidth: 1180 }}>
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
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px' }}>
        <b style={{ fontSize: 14, fontWeight: 650 }}>{card.label}</b>
        <span style={{ fontSize: 12, color: tk.text.muted }}>{card.makes}</span>
      </span>
      {!card.built && <span data-start-old style={{ padding: '0 4px', fontSize: 11, color: tk.text.faint }}>Opens the rules editor for now</span>}
    </button>
  );
}

// ── The editor for every kind ────────────────────────────────────────────────

const COUNT_OPTIONS = [{ value: '64k', label: '64k' }, { value: '256k', label: '256k' }, { value: '1m', label: '1M' }, { value: '4m', label: '4M' }] as const;
const SHAPES_2D = [{ value: 'disc', label: 'Disc' }, { value: 'ring', label: 'Ring' }, { value: 'box', label: 'Box' }, { value: 'point', label: 'Point' }, { value: 'line', label: 'Line' }, { value: 'screen', label: 'Whole picture' }];
const SHAPES_3D = [{ value: 'ball', label: 'Ball' }, { value: 'sphere', label: 'Sphere (shell)' }, { value: 'box', label: 'Box' }, { value: 'point', label: 'Point' }, { value: 'screen', label: 'Whole box' }];
const FACING = [{ value: 'random', label: 'Any way' }, { value: 'inward', label: 'Inward' }, { value: 'outward', label: 'Outward' }, { value: 'up', label: 'Up' }];
const BIRTHS = [{ value: 'fill', label: 'All at once' }, { value: 'rate', label: 'A stream' }, { value: 'respawn', label: 'Kept full' }];
const STYLES = [{ value: 'points' as const, label: 'Dots' }, { value: 'glow' as const, label: 'Glow' }, { value: 'streaks' as const, label: 'Streaks' }, { value: 'ink' as const, label: 'Ink' }];
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
const HOOD_PREF = 'builder:agent-builder:studio:hood';
const readHood = () => { try { return localStorage.getItem(HOOD_PREF) === '1'; } catch { return false; } };
const writeHood = (v: boolean) => { try { localStorage.setItem(HOOD_PREF, v ? '1' : '0'); } catch { /* this session only */ } };
const r3 = (v: number) => String(Math.round(v * 1000) / 1000);

/** The section a kind opens on (its main one). */
const FIRST: Record<string, SectionId> = { trail: 'senses', ants: 'senses', particles: 'forces', flock: 'neighbours', crowd: 'steering', swarm: 'orbit' };

function KindEditor({ groupId, madeHere, onClose, onBack }: { groupId: string; madeHere: boolean; onClose: () => void; onBack?: () => void }) {
  const tk = useTokens();
  const group = useNodeGraphStore(s => s.nodes.find(x => x.id === groupId));
  const emit = useNodeGraphStore(s => setupOf(s.nodes, groupId).emit);
  const trailNode = useNodeGraphStore(s => setupOf(s.nodes, groupId).trail);
  const draw = useNodeGraphStore(s => setupOf(s.nodes, groupId).draw);
  const depositWhat = useNodeGraphStore(s => String(setupOf(s.nodes, groupId).deposit?.params.what ?? 'trail'));
  const { set, setSet, update: apply, flush } = useRuleSetEditing(groupId);
  const kind = kindOf(set);
  const trailKind = isTrailKind(kind);
  const sections = KIND_SECTIONS[kind];
  const [sp, setSp] = useState(0);
  const [focus, setFocus] = useState<DiagramFocus>({ section: FIRST[kind] ?? 'born' });
  const [preset, setPreset] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  // Under the hood (HoodView.tsx): the walkers in their state textures, under the picture.
  const [hoodOpen, setHoodOpenState] = useState(readHood);
  const setHoodOpen = (v: boolean) => { setHoodOpenState(v); writeHood(v); };
  const [chipPicked, setChipPicked] = useState(false);
  const update = (next: AgentRuleSet) => { apply(next); setPreset(null); };
  // A kind added or taken away: start the walkers over once the rules are in, so births share them
  // out among the kinds (walkers born all at once keep the kind they were born with).
  const kindsWas = useRef(set.species.length);
  useEffect(() => {
    if (kindsWas.current === set.species.length) return;
    kindsWas.current = set.species.length;
    const t = setTimeout(() => restartAgents(groupId), 600);
    return () => clearTimeout(t);
  }, [set.species.length, groupId]);

  const s = Math.min(sp, set.species.length - 1);
  const cards = useMemo(() => readCards(set, s), [set, s]);
  const behaviours = useMemo(() => readBehaviours(set, s, kindCards(kind)), [set, s, kind]);
  const advancedRules = trailKind ? cards.advanced : behaviours.advanced;
  const d3 = group?.params.space === '3d';
  // A section the kind doesn't have (the kind changed by a preset): back to its first.
  const sectionIds = sections.map(x => x.id);
  const current: SectionId = sectionIds.includes(focus.section as SectionId) ? (focus.section as SectionId) : (FIRST[kind] ?? 'born');
  const shown: Section = advanced ? 'advanced' : current;
  const select = (x: Section) => {
    setLit(null);
    setFocusId(null);
    setHoverEntry(null);
    setChipPicked(false);
    if (x === 'advanced') setAdvanced(true); else { setAdvanced(false); setFocus({ section: x as DiagramSection }); }
  };
  const onFocusSetting = (setting: string | undefined) => setFocus(f => ({ ...f, section: current, setting }));
  const focusCard = (card: string | undefined) => setFocus(f => (f.card === card ? f : { ...f, section: current, card }));

  const born: BornInfo = {
    shape: String(emit?.params.shape ?? 'disc'), size: num(emit?.params.size, 0.6), x: num(emit?.params.x, 0), y: num(emit?.params.y, 0), z: num(emit?.params.z, 0),
    count: String(group?.params.tier ?? '256k'),
  };
  const trail = { halfLife: num(trailNode?.params.halfLife, 0.12), diffuse: num(trailNode?.params.diffuse, 1) };
  const viewRadius = set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius;
  const lensRef = useLensRef(cards.senses.distance, current);
  // The view ring stays between half and twice its size (0.21–0.92 of the lens) before the lens re-fits.
  const viewRef = useLensRef(viewRadius, `${current}:view`, 0.5, 2.2);
  const presets = presetsFor(kind);
  const thumbs = usePresetThumbs(presets);
  const trailChannels = useMemo(() => hoodTrailChannels(set, { velocity: depositWhat === 'velocity' }), [set, depositWhat]);

  // ── The legend, its tags and focus (legend.ts, ViewportLegend.tsx) ──
  // Rebuilt only when the values it reads change.
  const lifeSecs = emit ? num(emit.params.life, 0) : null;
  const entries = useMemo(() => legendEntries({
    set, sp: s, kind, section: current as DiagramSection, cards: behaviours.cards, trail: trailKind ? cards : undefined,
    born: { shape: born.shape, size: born.size, count: born.count }, trailField: { halfLife: trail.halfLife, diffuse: trail.diffuse }, life: lifeSecs,
    whenText: c => onlyWhenText(set, s, c),
  }), [set, s, kind, current, behaviours.cards, trailKind, cards, born.shape, born.size, born.count, trail.halfLife, trail.diffuse, lifeSecs]);
  const [hoverEntry, setHoverEntry] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [legendBox, setLegendBox] = useState<Box | null>(null);
  const onLegendBox = useCallback((b: Box | null) => setLegendBox(o => (o && b && o.left === b.left && o.top === b.top && o.w === b.w && o.h === b.h ? o : b)), []);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const focused: LegendEntry | null = (!advanced && entries.find(e => e.id === focusId)) || null;
  const hovered = hoverEntry && entries.some(e => e.id === hoverEntry) ? hoverEntry : null;
  const litEntry = hovered ?? focused?.id ?? entryForFocus(entries, focus);
  // Hovering or focusing an entry points its control: scroll the inspector to it and pulse it.
  const pointed = hovered ?? focused?.id ?? null;
  useEffect(() => {
    const e = entries.find(x => x.id === pointed);
    const root = inspectorRef.current;
    if (!e || !root || !e.el) return;
    const card = root.querySelector(`[data-card="${e.el}"]`);
    const setting = !e.card && e.settings?.[0] ? card?.querySelector(`[data-setting="${e.settings[0]}"]`) : null;
    const el = (setting ?? card) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    el.setAttribute('data-link-pulse', '');
    const t = setTimeout(() => el.removeAttribute('data-link-pulse'), 1000);
    return () => { clearTimeout(t); el.removeAttribute('data-link-pulse'); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointed, focused?.id]);

  if (!group) return null;
  const name = (typeof group.params.label === 'string' && group.params.label) || 'Agents';
  const kindLabel = WALKER_KINDS[kind].label;
  const sp3 = (v: number) => (d3 ? v * 10 : v);
  const close = () => { flush(); onClose(); };
  const applyPreset = (key: string) => {
    flush();
    const next = applyBuilderPreset(groupId, key);
    if (next) { setSet(next); setSp(0); setPreset(key); setLit(null); }
  };
  const words = sectionWordsOf;

  // ── Born ──
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
        {kind === 'particles' && emit && (
          <SliderSetting id="launch" label="Shot out at" hint="Its speed at birth, along its facing (Emit's Speed)." value={num(emit.params.speed, 0)} min={0} max={3} step={0.01} onFocus={onFocusSetting}
            onChange={v => setSetupParam(emit.id, { speed: v })} />
        )}
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

  // ── Trail followers (phase 1's cards, with their "only when") ──
  const chips = smellChips(set).map(c => ({ ...c, dot: c.value === 'own' ? undefined : TRAIL_HEX[c.value as number] }));
  const onlyWhen = (c: RuleCard) => {
    const at = cards.at[c];
    if (!at) return undefined;
    return <OnlyWhenLine id={c} set={set} sp={s} when={cards.when[c]}
      onFocus={x => { focusCard(c); onFocusSetting(x); }} onChange={(w: RuleCondition | null) => update(setOnlyWhen(set, s, at, w))} />;
  };
  const sensesCard = (
    <div onPointerEnter={() => focusCard('senses')}>
      <BehaviourCard id="senses" picture="senses" title="Senses" hint={words('senses').hint} learn={words('senses').learn} guide={words('senses').guide}
        summary={sectionSummary(cards, 'senses')} on={cards.senses.on} onToggle={on => update(setCardOn(set, s, 'senses', on))} onlyWhen={onlyWhen('senses')}>
        <SliderSetting id="distance" label="How far ahead" hint={SETTING_HINTS.distance} value={cards.senses.distance} min={0} max={sp3(0.12)} step={0.001}
          onFocus={onFocusSetting} onChange={v => update(setSensors(set, { distance: Math.max(0.001, v) }))} />
        <SliderSetting id="angle" label="How wide" hint={SETTING_HINTS.angle} value={cards.senses.angle} min={0} max={90} step={0.5}
          onFocus={onFocusSetting} onChange={v => update(setSensors(set, { angle: v }))} />
        <SettingRow id="smells" label="Smells" hint={SETTING_HINTS.smells} onFocus={onFocusSetting}
          right={<Toggle checked={cards.senses.away} onChange={v => update(patchCard(set, s, 'senses', { away: v || undefined }))} label="Avoid it" />}>
          <ChipRow label="Smells" options={chips} value={cards.senses.channel} onChange={v => update(patchCard(set, s, 'senses', { channel: v as ChannelRef }))} />
        </SettingRow>
      </BehaviourCard>
    </div>
  );
  const turningCard = (
    <div onPointerEnter={() => focusCard('wobble')}>
      <BehaviourCard id="turning" picture="turning" title="Turning" hint={words('turning').hint} learn={words('turning').learn} guide={words('turning').guide}
        summary={sectionSummary(cards, 'turning')} onlyWhen={onlyWhen('wobble')}>
        <SliderSetting id="sharp" label="How sharply" hint={cards.turning.sharpOn ? SETTING_HINTS.sharp : 'Senses is off: switch it on to turn toward a smell.'} value={cards.turning.sharp} min={0} max={90} step={0.5}
          onFocus={onFocusSetting} disabled={!cards.senses.there} onChange={v => update(patchCard(set, s, 'senses', { degrees: v }))} />
        <SliderSetting id="wobble" label="Wobble" hint={SETTING_HINTS.wobble} value={cards.turning.wobble} min={0} max={45} step={0.5}
          onFocus={onFocusSetting} onChange={v => update(patchCard(set, s, 'wobble', { degrees: v }))}
          right={<span data-card-switch="wobble"><Toggle checked={cards.turning.wobbleOn} onChange={on => update(setCardOn(set, s, 'wobble', on))} /></span>} />
      </BehaviourCard>
    </div>
  );
  const movingCard = (
    <BehaviourCard id="moving" picture="moving" title="Moving" hint={words('moving').hint} learn={words('moving').learn} guide={words('moving').guide}
      summary={sectionSummary(cards, 'moving')}>
      <SliderSetting id="speed" label="Speed" hint={SETTING_HINTS.speed} value={cards.moving.speed} min={0} max={d3 ? 2 : kind === 'particles' ? 3 : 1} step={0.005}
        onFocus={onFocusSetting} onChange={v => update(setSpeed(set, s, v))} />
      <SettingRow id="edges" label="At the edges" hint={SETTING_HINTS.edges} onFocus={onFocusSetting}>
        <Segmented size="sm" fill ariaLabel="At the edges" value={cards.moving.edges} onChange={v => update(setEdges(set, v))}
          options={[{ value: 'wrap' as const, label: 'Wrap' }, { value: 'bounce' as const, label: 'Bounce' }, { value: 'slide' as const, label: 'Slide' }]} />
      </SettingRow>
    </BehaviourCard>
  );
  const trailCard = (
    <div onPointerEnter={() => focusCard('trail')}>
      <BehaviourCard id="trail" picture="trail" title="Trail" hint={words('trail').hint} learn={words('trail').learn} guide={words('trail').guide}
        summary={sectionSummary(cards, 'trail')} on={cards.trail.on} onToggle={on => update(setCardOn(set, s, 'trail', on))} onlyWhen={onlyWhen('trail')}
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
    </div>
  );

  // ── Particles, flocks, crowds, orbiters ──
  const sectionHeader = (id: SectionId) => {
    const w = words(id);
    return <SectionIntro title={w.label} hint={w.hint} learn={w.learn} guide={w.guide} />;
  };
  const sectionCards = (id: SectionId, intro?: React.ReactNode, only?: string) => {
    const def = sections.find(x => x.id === id)!;
    return (
      <SectionCards section={def} all={behaviours.cards} set={set} sp={s} update={update} cardsFor={kindCards(kind)}
        focusCard={focusCard} hotCard={focus.card} onFocusSetting={onFocusSetting} only={only}
        intro={<>{sectionHeader(id)}{intro}</>} />
    );
  };
  const viewCard = (
    <BehaviourCard id="view" picture="neighbours" title="What it sees" hint={words('neighbours').hint} summary={`sees ${r3(viewRadius)} · counts up to ${set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max}`}>
      <SliderSetting id="radius" label="View radius" hint={MORE_HINTS.radius} value={viewRadius} min={0.005} max={d3 ? 0.4 : 0.25} step={0.001} onFocus={onFocusSetting}
        onChange={v => update(setNeighbours(set, { radius: Math.max(0.005, v) }))} />
      <SliderSetting id="max" label="Max neighbours" hint={MORE_HINTS.max} value={set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max} min={1} max={64} step={1} onFocus={onFocusSetting}
        onChange={v => update(setNeighbours(set, { max: Math.max(1, Math.round(v)) }))} />
    </BehaviourCard>
  );
  const lifeIntro = emit ? (
    <BehaviourCard id="lives" picture="life" title="Lives for" hint={MORE_HINTS.life} summary={num(emit.params.life, 0) > 0 ? `${r3(num(emit.params.life, 0))} s` : 'for ever'}>
      <SliderSetting id="life" label="Seconds (0: for ever)" hint={MORE_HINTS.life} value={num(emit.params.life, 0)} min={0} max={30} step={0.1} onFocus={onFocusSetting}
        onChange={v => setSetupParam(emit.id, { life: Math.max(0, v) })} />
    </BehaviourCard>
  ) : undefined;
  const colour = (set.species[s]?.states[0]?.colour ?? [1, 1, 1]) as [number, number, number];
  const lookCard = (
    <>
      {sectionHeader('look')}
      <BehaviourCard id="look" picture="look" title="Drawn as" hint={words('look').hint} summary={draw ? `${STYLES.find(x => x.value === draw.params.style)?.label ?? 'Dots'} · size ${r3(num(draw.params.size, 1.5))}` : 'no Draw agents'}>
        {draw ? <>
          <SettingRow id="style" label="Style" hint={MORE_HINTS.style} onFocus={onFocusSetting}>
            <Segmented size="sm" fill ariaLabel="Style" value={(String(draw.params.style ?? 'points')) as typeof STYLES[number]['value']} options={STYLES} onChange={v => setSetupParam(draw.id, { style: v })} />
          </SettingRow>
          <SliderSetting id="dsize" label="Size" hint={MORE_HINTS.size} value={num(draw.params.size, 1.5)} min={0.25} max={8} step={0.05} onFocus={onFocusSetting} onChange={v => setSetupParam(draw.id, { size: v })} />
          <SliderSetting id="brightness" label="Brightness" hint={MORE_HINTS.brightness} value={num(draw.params.brightness, 0.5)} min={0} max={3} step={0.01} onFocus={onFocusSetting} onChange={v => setSetupParam(draw.id, { brightness: v })} />
        </> : <span style={{ fontSize: 12, color: tk.text.muted }}>No Draw agents shows this group: the trail is the picture.</span>}
        <SettingRow id="colour" label={`${set.species[s]?.name ?? 'Its'} colour`} hint={MORE_HINTS.colour} onFocus={onFocusSetting}>
          <ColorSwatch label="Colour" value={colour} onChange={rgb => update(setSpeciesColour(set, s, rgb as [number, number, number]))} />
        </SettingRow>
      </BehaviourCard>
    </>
  );

  const advancedCards = (
    <BehaviourCard id="advanced" picture="advanced" title="Advanced rules" hint="Rules the cards can't show yet (two conditions, Stop, states, memory): they keep working; edit them in the rules editor."
      summary={`${advancedRules.length} ${advancedRules.length === 1 ? 'rule' : 'rules'}, run top to bottom`}
      footer={<Button size="sm" icon="expr" data-open-rules-editor onClick={() => { flush(); openAgentRulesWindow(groupId); }}>Edit in the rules editor</Button>}>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {advancedRules.map(a => (
          <li key={a.rule} data-advanced-rule={a.rule} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5, color: a.off ? tk.text.faint : tk.text.secondary }}>
            <span style={{ font: `700 11px ${fontFamily.mono}`, color: tk.text.faint, width: 16, flexShrink: 0, paddingTop: 1 }}>{a.rule + 1}</span>
            <span data-advanced-text>{a.text}</span>
          </li>
        ))}
      </ol>
    </BehaviourCard>
  );

  const body = (() => {
    switch (shown) {
      case 'born': return bornCard;
      case 'senses': return sensesCard;
      case 'turning': return turningCard;
      case 'moving': return movingCard;
      case 'trail': return trailCard;
      case 'forces': return sectionCards('forces');
      case 'life': return sectionCards('life', lifeIntro);
      case 'look': return lookCard;
      case 'neighbours': return KIND_SECTIONS[kind].find(x => x.id === 'neighbours')!.cards.length ? sectionCards('neighbours', viewCard) : <>{sectionHeader('neighbours')}{viewCard}</>;
      case 'steering': return sectionCards('steering');
      case 'orbit': return sectionCards('orbit');
      case 'advanced': return advancedCards;
    }
  })();
  // Focus: only that card's controls, under a short "more" from the field guide.
  const focusBody = (() => {
    if (!focused) return body;
    if (focused.el === 'view') return viewCard;
    if (focused.el === 'lives') return lifeIntro ?? body;
    if (focused.el.includes('#')) return sectionCards(current, undefined, focused.el);
    return body;
  })();
  const inspector = (
    <div ref={inspectorRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }} data-inspector={shown} data-inspector-focus={focused?.id}>
      <style>{'@keyframes ab-link-pulse { 0% { box-shadow: 0 0 0 0 rgba(58,111,247,0.55), inset 0 0 0 1.5px rgba(58,111,247,0.8); } 100% { box-shadow: 0 0 0 10px rgba(58,111,247,0), inset 0 0 0 1.5px rgba(58,111,247,0.4); } } [data-link-pulse] { animation: ab-link-pulse 0.9s ease-out; border-radius: 14px; }'}</style>
      {focused && <FocusIntro entry={focused} onClose={() => setFocusId(null)} />}
      {focusBody}
    </div>
  );

  // ── Nav ──
  const on = (ids: string[]) => behaviours.cards.filter(c => c.on && ids.includes(c.card));
  const titles = (ids: string[]) => on(ids).map(c => CARD_WORDS[c.card].title.toLowerCase()).join(' · ') || 'none on';
  const summary = (id: SectionId): string => {
    switch (id) {
      case 'born': return `${born.shape} · ${born.count.replace('m', 'M')}`;
      case 'senses': case 'turning': case 'trail': return sectionSummary(cards, id);
      case 'moving': return sectionSummary(cards, 'moving');
      case 'forces': return titles(['gravity', 'wind', 'curl', 'attract', 'drag']);
      case 'life': {
        const f = on(['fade'])[0]?.action, d = on(['die'])[0];
        return [f?.kind === 'fade' ? `fades ${r3(f.seconds)} s` : '', d?.when?.kind === 'age' ? `dies at ${r3(d.when.seconds)} s` : d ? 'dies' : ''].filter(Boolean).join(' · ') || 'for ever';
      }
      case 'look': return draw ? `${String(draw.params.style ?? 'points')} · ${r3(num(draw.params.size, 1.5))}` : 'the trail';
      case 'neighbours': return `sees ${r3(viewRadius)} · max ${set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max}`;
      case 'steering': return titles(['goal', 'separate', 'match', 'cohere', 'slow', 'avoidEdges', 'wobble']);
      case 'orbit': {
        const o = on(['orbit'])[0]?.action;
        return o?.kind === 'orbit' ? `radius ${r3(o.distance)} · ${o.cw ? 'clockwise' : 'anticlockwise'}` : 'none';
      }
    }
  };
  const dim = (id: SectionId) => (id === 'senses' && !cards.senses.on) || (id === 'trail' && !cards.trail.on)
    || (id === 'neighbours' && kind === 'swarm' && !on(['separate', 'match', 'cohere']).length);
  const nav = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 10px' }}>
      <KindChips set={set} sp={s} update={update} onSelect={i => { setSp(i); setLit(set.species.length > 1 || i > 0 ? i : null); setChipPicked(true); }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StudioLabel meta="one step, in order">Sections</StudioLabel>
        {sections.map(x => {
          const w = words(x.id);
          return <StudioNavItem key={x.id} id={x.id} icon={w.icon} label={w.label} hint={w.hint} summary={summary(x.id)} selected={shown === x.id} onClick={() => select(x.id)} dim={dim(x.id)} />;
        })}
        {advancedRules.length > 0 && (
          <StudioNavItem id="advanced" icon="expr" label="Advanced rules" summary={`${advancedRules.length} in the rules editor`} selected={shown === 'advanced'} onClick={() => select('advanced')} />
        )}
      </div>
    </div>
  );

  const presetStrip = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <StudioLabel meta="click to apply · undo takes it back">Presets</StudioLabel>
      <div style={{ display: 'flex', gap: 12 }}>
        {presets.map(p => <PresetCard key={p.key} id={p.key} label={p.label} hint={p.hint} src={thumbs[p.key]} active={preset === p.key} onClick={() => applyPreset(p.key)} />)}
      </div>
    </div>
  );

  // The channels the selected section (or a picked kind) uses, lit under the hood.
  const hoodLit = hoodHighlights(chipPicked ? null : shown, {
    d3, kindPicked: chipPicked,
    reads: trailKind ? (cards.senses.on ? [channelIndex(cards.senses.channel, s)] : []) : trailChannels.filter(t => t.readBy.length).map(t => t.index),
    writes: trailKind ? (cards.trail.on ? [channelIndex(cards.trail.channel, s)] : []) : trailChannels.filter(t => t.writtenBy.length).map(t => t.index),
  });
  const camera = d3 && draw ? { params: draw.params as Record<string, unknown>, mirror: draw.params.mirror === true } : undefined;
  const hotTrailCard = trailKind && focus.card && (['senses', 'wobble', 'trail'] as const).find(c => c === focus.card);
  const hoodSpecies = set.species.map(x => ({ name: x.name, colour: (x.states[0]?.colour ?? [1, 1, 1]) as Rgb }));
  const enterFocus = (id: string) => {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    setFocusId(id);
    setFocus(f => ({ ...f, section: current, ...focusOfEntry(e) }));
  };
  const hoverLegend = (id: string | null) => {
    setHoverEntry(id);
    const e = entries.find(x => x.id === id);
    if (e) setFocus(f => ({ ...f, section: current, ...focusOfEntry(e) }));
    else if (focused) setFocus(f => ({ ...f, section: current, ...focusOfEntry(focused) }));
    else setFocus(f => (f.setting === undefined ? f : { ...f, setting: undefined }));
  };
  const lensNote = (() => {
    if (current === 'born') return d3 ? (camera ? 'Drawn through the 3D camera as it starts (it then circles).' : 'Seen from the front: no 3D camera to look through.') : undefined;
    if (current === 'senses' || current === 'turning' || current === 'trail' || (current === 'moving' && focus.setting !== 'edges' && trailKind)) return 'One walker, up close.';
    if ((current === 'neighbours' || current === 'steering') && !(focus.card?.startsWith('avoidEdges'))) return `One ${kind === 'crowd' ? 'person' : kind === 'swarm' ? 'orbiter' : 'bird'} and made-up neighbours, up close.`;
    if (current === 'forces') return 'One particle with its forces; the curl flow over the picture.';
    return undefined;
  })();
  const overlay = ({ w, h, image }: { w: number; h: number; image: ViewRect }) => {
    const box = { w, h, image };
    const demoBox: Box = { left: w - 12 - (DEMO_W + 20), top: h - 12 - (DEMO_H + 70), w: DEMO_W + 20, h: DEMO_H + 70 };
    const link: ViewportLink = {
      entries, lit: litEntry, dim: !!hovered || !!focused, focused: focused?.id ?? null,
      onHover: hoverLegend, onFocus: enterFocus,
      avoid: [...(legendBox ? [legendBox] : []), ...(focused ? [demoBox] : [])],
      // A tall legend takes the left: the lens is centred in what is left of the viewport.
      freeLeft: legendBox && legendBox.h > h * 0.3 ? legendBox.left + legendBox.w + 8 : 0,
    };
    const legend = <>
      <ViewportLegend entries={entries} lit={litEntry} focused={focused?.id ?? null} note={lensNote} onHover={hoverLegend} onFocus={enterFocus} onBox={onLegendBox} />
      {focused && <FocusDemo entry={focused} onClose={() => setFocusId(null)} />}
    </>;
    let spot: React.ReactNode = null;
    if (lit !== null && set.species.length > 1 && lit < set.species.length) {
      const sc = (set.species[lit].states[0]?.colour ?? [1, 1, 1]) as [number, number, number];
      spot = <SpeciesSpotlight groupId={groupId} species={lit} colour={sc} name={set.species[lit].name} image={image} onClose={() => setLit(null)} />;
    }
    // Under the hood: the plain picture (no diagram), the ring on a walker and its numbers.
    if (hoodOpen) return <>{spot}<HoodLayer box={box} speciesNames={hoodSpecies.map(x => x.name)} /></>;
    if (advanced) return null;
    if (spot) return spot;
    const walkerSection = trailKind || current === 'born' || current === 'moving';
    if (walkerSection) {
      const when = hotTrailCard ? cards.when[hotTrailCard] : null;
      return <>
        <WalkerDiagram focus={{ ...focus, section: current as DiagramSection }} cards={cards} box={box} born={born} trail={trail} lensRef={lensRef} d3={d3} camera={camera} feelersShown={trailKind} link={link} />
        {when && <svg width={w} height={h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <OnlyWhenOverlay set={set} sp={s} c={when} title={CARD_WORDS[hotTrailCard as RuleCard].title} box={box} />
        </svg>}
        {legend}
      </>;
    }
    if (current === 'look') return null;
    return <>
      <KindDiagram focus={{ ...focus, section: current as DiagramSection }} cards={behaviours.cards as CardRead[]} set={set} sp={s} box={box} viewRef={viewRef}
        life={num(emit?.params.life, 0)} link={link} />
      {legend}
    </>;
  };

  return (
    <StudioShell prefsKey="agent-builder" icon="swarm" title={name} kind={`${kindLabel} · ${d3 ? '3D' : '2D'}`} onClose={close}
      onEscape={() => { if (!focused) return false; setFocusId(null); return true; }}
      onBack={onBack} backLabel="Back to the start (takes this group away)"
      space={{ value: d3 ? '3d' : '2d', onChange: v => { flush(); setGroupSpace(groupId, v); }, hint: 'Switching turns the whole setup (sensors and speed rescaled, Trail ↔ volume); undo switches it back.' }}
      actions={<>
        <IconButton icon="layers" label={hoodOpen ? 'Hide Under the hood' : 'Under the hood: the walkers in their textures'} size="sm" active={hoodOpen} onClick={() => setHoodOpen(!hoodOpen)} data-hood-toggle />
        <IconButton icon="expr" label="All rules (the rules editor)" size="sm" onClick={() => { flush(); openAgentRulesWindow(groupId); }} data-open-rules />
        <IconButton icon="fn" label="Open as nodes" size="sm" onClick={() => { flush(); onClose(); openGroupAsNodes(groupId); }} />
      </>}
      primary={{ label: madeHere ? 'Add to graph' : 'Done', onClick: close, title: madeHere ? 'Keep it (it is already live in your graph, wired to the Output)' : undefined }}
      nav={nav} inspector={inspector} presets={presetStrip}>
      <LiveViewport overlay={overlay} />
      {hoodOpen && (
        <HoodPanel groupId={groupId} species={hoodSpecies} trails={trailChannels} highlight={hoodLit} onClose={() => setHoodOpen(false)}
          speedMax={Math.max(0.05, ...set.species.map(x => x.speed), num(emit?.params.speed, 0)) * 1.5} lifeMax={num(emit?.params.life, 0)} />
      )}
    </StudioShell>
  );
}

/** A section's name, one line, and its Learn more, over its cards. */
function SectionIntro({ title, hint, learn, guide }: { title: string; hint: string; learn: string; guide: string }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  return (
    <div data-section-intro={title} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 2px 4px' }}>
      <b style={{ fontSize: 15, fontWeight: 650 }}>{title}</b>
      <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>{hint}</span>
      <button type="button" data-learn-more={title} aria-expanded={open} onClick={() => setOpen(v => !v)}
        style={{ alignSelf: 'flex-start', padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
        {open ? 'Less' : 'Learn more'}
      </button>
      {open && <>
        <p data-learn-text={title} style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: tk.text.secondary }}>{learn}</p>
        <span style={{ fontSize: 11, color: tk.text.faint }}>{guide}</span>
      </>}
    </div>
  );
}

/** The focus view's head in the inspector: the behaviour, its plain line, a little more, and ×. */
function FocusIntro({ entry, onClose }: { entry: LegendEntry; onClose: () => void }) {
  const tk = useTokens();
  return (
    <div data-focus-intro={entry.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: radius.card, background: tk.bg.selected, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: entry.colour, boxShadow: '0 0 0 1px rgba(0,0,0,0.25)', flexShrink: 0 }} />
        <b style={{ fontSize: 14, fontWeight: 650, flex: 1 }}>{entry.title}</b>
        <span style={{ fontSize: 11, color: tk.text.faint }}>Esc to leave</span>
        <button type="button" data-focus-leave aria-label="Leave focus" title="Leave focus (Esc)" onClick={onClose}
          style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: 7, background: 'none', color: tk.text.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={13} />
        </button>
      </span>
      <span data-focus-line style={{ fontSize: 12.5, lineHeight: 1.45, color: tk.text.primary }}>{entry.line}</span>
      <span data-focus-more style={{ fontSize: 12, lineHeight: 1.55, color: tk.text.secondary }}>{moreAbout(entry)}</span>
    </div>
  );
}
