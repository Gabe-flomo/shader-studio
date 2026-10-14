/**
 * Look for every kind (docs/agent-builder.md "Look"): how the walkers and the trail are drawn.
 *
 *  - Drawn as: Dots / Glow / Streaks / Ink, size, brightness (Draw agents); with no Draw agents,
 *    "Draw the walkers too" adds one over the picture;
 *  - Colour: by kind (and the kinds' states, named and coloured here), speed, age, heading, one
 *    colour, a trail channel, or a memory (phase 4); the palette;
 *  - The trail: what the picture shows (the trail, one channel, walker density) and its palette;
 *  - 3D: Shape (dots, or solid cubes, spheres, rods, tiles, voxels) with its Shading and size; the camera
 *    (the old Look tab's controls) and a shape to flow round.
 * Every change shows on the live picture; the legend says what the colour means (look.ts).
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { ColorSwatch } from '../ui/ColorPicker';
import { Icon } from '../ui/Icon';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { type AgentRuleSet, MAX_STATES } from '../../agentRules/spec';
import { AG_PALETTE_OPTIONS, DRAW_SHAPE_PARAM, DRAW_SHAPE_PARAMS } from '../../nodes/definitions/agents';
import { ShapeCostNote } from '../NodeGraph/ShapeCostNote';
import { AGENT_VIEWS, agentsViewOf, type AgentsView } from '../../agentRules/outputs';
import { setGroupShape, setGroupView } from '../../agentRules/storeActions';
import { CAMERA_3D, CAMERA_CONTROLS, SHAPE_KINDS, shapeOf, type ShapeKind } from '../../agentRules/space3d';
import { setSetupParam } from '../../agentBuilder/actions';
import { COLOUR_BY, STYLES, TRAIL_PALETTES, type ColourBy, colourByOf, cssOf, drawColourBy, paletteColours, setColourBy, stopsOf } from '../../agentBuilder/look';
import { addDrawAgents, removeDrawAgents, setTrailPalette, trailPaletteOf } from '../../agentBuilder/lookActions';
import { channelSwatches } from '../../agentBuilder/trailChannels';
import { MORE_HINTS } from '../../agentBuilder/sections';
import { BehaviourCard, ChipRow, SettingRow, SliderSetting } from './BehaviourCard';
import { MemoryColourRow } from './MemorySection';

type Rgb = [number, number, number];
const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
const r3 = (v: number) => String(Math.round(v * 1000) / 1000);

export function LookSection({ groupId, set, sp, update, draw, d3, intro, onFocus, flush }: {
  groupId: string; set: AgentRuleSet; sp: number; update: (s: AgentRuleSet) => void;
  draw?: GraphNode; d3: boolean; intro?: React.ReactNode;
  onFocus: (s: string | undefined) => void;
  /** Send the pending rule edits first (before a graph change of its own). */
  flush: () => void;
}) {
  const tk = useTokens();
  const by = colourByOf(set, draw);
  const pal = paletteColours(draw);
  const palette = useNodeGraphStore(s => trailPaletteOf(s.nodes, groupId));
  const view = useNodeGraphStore(s => agentsViewOf(s.nodes, groupId).current);
  const hasTrail = useNodeGraphStore(s => !!agentsViewOf(s.nodes, groupId).trail);
  const shape = useNodeGraphStore(s => (d3 ? shapeOf(s.nodes, groupId)?.kind ?? null : null));
  const pickBy = (c: ColourBy) => {
    const next = setColourBy(set, c);
    if (next !== set) update(next);
    if (draw) setSetupParam(draw.id, { colorBy: drawColourBy(c, draw.params.colorBy) }, 'Agent Builder: colour by');
  };
  const swatches = channelSwatches(set);
  const species = set.species[sp];
  const usesPalette = by === 'speed' || by === 'age' || by === 'heading' || by === 'single';
  const cam = (k: keyof typeof CAMERA_3D) => num(draw?.params[k], CAMERA_3D[k]);
  const proj = draw?.params.projection === 'orthographic' || draw?.params.projection === 'reverse' ? draw.params.projection : 'normal';
  return (
    <>
      {intro}
      <BehaviourCard id="look" picture="look" title="Drawn as" hint="How each walker is drawn over the picture (Draw agents)."
        onRemove={draw && hasTrail && draw.inputs.over?.connection ? () => { flush(); removeDrawAgents(groupId); } : undefined}
        summary={draw ? `${STYLES.find(x => x.value === draw.params.style)?.label ?? 'Dots'} · size ${String(draw.params.style) === 'splats' ? r3(num(draw.params.splatSize, 0.012)) : r3(num(draw.params.size, 1.5))}` : 'the trail is the picture'}>
        {draw ? <>
          <SettingRow id="style" label="Style" hint={MORE_HINTS.style} onFocus={onFocus}>
            <Segmented size="sm" fill ariaLabel="Style" value={(String(draw.params.style ?? 'points')) as typeof STYLES[number]['value']} options={STYLES} onChange={v => setSetupParam(draw.id, { style: v })} />
          </SettingRow>
          {String(draw.params.style) === 'splats' ? <>
            <SliderSetting id="splatSize" label="Splat size" hint="How wide each splat is (its sigma), in picture units; in 3D it shrinks with distance. Sized by a memory: the memory times this." value={String(draw.params.sizeBy ?? 'fixed').startsWith('mem') ? num(draw.params.memScale, 1) : num(draw.params.splatSize, 0.012)}
              min={0} max={String(draw.params.sizeBy ?? 'fixed').startsWith('mem') ? 4 : 0.1} step={0.001} onFocus={onFocus}
              onChange={v => setSetupParam(draw.id, String(draw.params.sizeBy ?? 'fixed').startsWith('mem') ? { memScale: v } : { splatSize: v })} param={{ nodeId: draw.id, key: String(draw.params.sizeBy ?? 'fixed').startsWith('mem') ? 'memScale' : 'splatSize' }} />
            <SettingRow id="sizeBy" label="Size by" hint="Fixed: all the same. Speed: faster ones bigger. Its own: the size it was born with (a splat scan's splats, kept in its memory w)." onFocus={onFocus}>
              <ChipRow label="Size by" value={String(draw.params.sizeBy ?? 'fixed')} onChange={v => setSetupParam(draw.id, { sizeBy: v })}
                options={[{ value: 'fixed', label: 'Fixed' }, { value: 'speed', label: 'Speed' }, ...((set.memories?.length ?? 0) > 0 ? [{ value: 'memW', label: 'Its own' }] : [])]} />
            </SettingRow>
            <SliderSetting id="stretch" label="Stretch" hint="How much longer a splat is along its motion, at full speed (Fast is): 0 round." value={num(draw.params.stretch, 1.5)} min={0} max={8} step={0.01} onFocus={onFocus} onChange={v => setSetupParam(draw.id, { stretch: v })} param={{ nodeId: draw.id, key: 'stretch' }} />
            <SliderSetting id="opacity" label="Opacity" hint="How much each splat covers at its middle: where many overlap the cloud turns solid." value={num(draw.params.opacity, 0.6)} min={0} max={1} step={0.01} onFocus={onFocus} onChange={v => setSetupParam(draw.id, { opacity: v })} param={{ nodeId: draw.id, key: 'opacity' }} />
          </> : (!d3 || String(draw.params.shape ?? 'dot') === 'dot') && <SliderSetting id="dsize" label="Size" hint={MORE_HINTS.size} value={num(draw.params.size, 1.5)} min={0.25} max={8} step={0.05} onFocus={onFocus} onChange={v => setSetupParam(draw.id, { size: v })} param={{ nodeId: draw.id, key: 'size' }} />}
          <SliderSetting id="brightness" label="Brightness" hint={MORE_HINTS.brightness} value={num(draw.params.brightness, 0.5)} min={0} max={3} step={0.01} onFocus={onFocus} onChange={v => setSetupParam(draw.id, { brightness: v })} param={{ nodeId: draw.id, key: 'brightness' }} />
          {d3 && <ShapeSettings draw={draw} onFocus={onFocus} />}
          {String(draw.params.style) === 'streaks' && <SliderSetting id="streak" label="Streak length" hint="How long each streak is (seconds of travel × 0.12)." value={num(draw.params.streak, 0.25)} min={0} max={4} step={0.01} onFocus={onFocus} onChange={v => setSetupParam(draw.id, { streak: v })} param={{ nodeId: draw.id, key: 'streak' }} />}
        </> : <>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>No Draw agents shows this group: the trail is the picture. Draw the walkers over it to see them.</span>
          <Button size="sm" icon="plus" data-look-add-draw onClick={() => { flush(); addDrawAgents(groupId); }}>Draw the walkers too</Button>
        </>}
      </BehaviourCard>

      <BehaviourCard id="lookColour" picture="look" title="Colour" hint="What picks each walker's colour." summary={COLOUR_BY.find(c => c.value === by)!.label}>
        <SettingRow id="colourBy" label="Colour by" hint={COLOUR_BY.find(c => c.value === by)!.hint} onFocus={onFocus}>
          <ChipRow label="Colour by" value={by} onChange={v => pickBy(v as ColourBy)}
            options={COLOUR_BY.filter(c => c.value !== 'memory' || (set.memories?.length ?? 0) > 0).map(c => ({ value: c.value, label: c.label }))} />
        </SettingRow>
        {!draw && by !== 'kind' && <span style={{ fontSize: 11.5, color: tk.status.warningText }}>Shows once the walkers are drawn (Draw the walkers too, above).</span>}
        {usesPalette && draw && <>
          <SettingRow id="palette" label="Palette" onFocus={onFocus} right={<PaletteBar colours={pal} />}>
            <Select ariaLabel="Palette" value={String(draw.params.palette ?? 'ab')} options={AG_PALETTE_OPTIONS} onChange={v => setSetupParam(draw.id, { palette: v })} />
          </SettingRow>
          {String(draw.params.palette ?? 'ab') === 'ab' && (
            <span style={{ display: 'flex', gap: 10 }}>
              <ColorSwatch label="Colour A" value={(draw.params.colorA as Rgb) ?? [1, 0.75, 0.35]} onChange={c => setSetupParam(draw.id, { colorA: c })} />
              <ColorSwatch label="Colour B" value={(draw.params.colorB as Rgb) ?? [0.25, 0.55, 1]} onChange={c => setSetupParam(draw.id, { colorB: c })} />
            </span>
          )}
          {by === 'speed' && <SliderSetting id="speedRef" label="Fast is" hint="The speed that reaches the end of the palette (picture units a second)." value={num(draw.params.speedRef, 0.5)} min={0.01} max={4} step={0.01} onFocus={onFocus} onChange={v => setSetupParam(draw.id, { speedRef: v })} />}
        </>}
        {by === 'kind' && species && <StatesEditor set={set} sp={sp} update={update} />}
        {by === 'trail' && set.look?.by === 'trail' && <>
          <SettingRow id="lookChannel" label="Which trail" onFocus={onFocus}>
            <ChipRow label="Which trail" value={set.look.channel} onChange={v => update({ ...set, look: { ...(set.look as Extract<typeof set.look, { by: 'trail' }>), channel: v as 0 | 1 | 2 | 3 } })}
              options={(swatches.length ? swatches : [{ index: 0, label: 'trail 1', colour: '#e8a33a', word: 'amber' }]).map(c => ({ value: c.index as 0 | 1 | 2 | 3, label: `${c.label} · ${c.word}`, dot: c.colour }))} />
          </SettingRow>
          <SliderSetting id="lookGain" label="Full colour at" hint="How much trail gives the full channel colour (× this)." value={set.look.gain} min={0.05} max={20} step={0.05} onFocus={onFocus} onChange={v => update({ ...set, look: { ...(set.look as Extract<typeof set.look, { by: 'trail' }>), gain: Math.max(0.01, v) } })} />
        </>}
        {by === 'memory' && <MemoryColourRow set={set} update={update} onFocus={onFocus} />}
      </BehaviourCard>

      {hasTrail && (
        <BehaviourCard id="trailLook" picture="trail" title="The trail" hint="What the picture shows of the trail, and its colours." summary={`${AGENT_VIEWS.find(v => v.value === view)?.label ?? 'not shown'}${palette ? ` · ${stopsOf(palette).length} colours` : ''}`}>
          <SettingRow id="view" label="The picture shows" hint={AGENT_VIEWS.find(v => v.value === view)?.hint} onFocus={onFocus}>
            <Select ariaLabel="What the picture shows" value={view ?? ''} options={[...(view ? [] : [{ value: '', label: 'Nothing reads the trail' }]), ...AGENT_VIEWS.map(v => ({ value: v.value, label: v.label }))]}
              onChange={v => { if (v) { flush(); setGroupView(groupId, v as AgentsView); } }} />
          </SettingRow>
          {palette && <TrailPalette palette={palette} onFocus={onFocus} />}
        </BehaviourCard>
      )}

      {d3 && (
        <BehaviourCard id="camera" picture="look" title="Camera" hint="In 3D the walkers are seen through Draw agents' camera: where it stands, how it turns, what is sharp."
          summary={draw ? `${r3(cam('camDist'))} away · ${r3(cam('rotSpeed'))}°/s` : 'no camera'}>
          {draw ? <>
            {CAMERA_CONTROLS.filter(c => !c.fold).map(c => (
              <SliderSetting key={c.key} id={c.key} label={c.label} value={cam(c.key)} min={c.key === 'camDist' ? 0.3 : c.key === 'fov' ? 0.5 : c.key === 'camElevation' ? -89 : -180} max={c.key === 'camDist' ? 12 : c.key === 'fov' ? 5 : c.key === 'camElevation' ? 89 : 180} step={c.step} onFocus={onFocus}
                param={{ nodeId: draw.id, key: c.key }} onChange={v => setSetupParam(draw.id, { [c.key]: v })} />
            ))}
            <SettingRow id="projection" label="Perspective" hint={PERSPECTIVE_HINT} onFocus={onFocus}>
              <ChipRow label="Perspective" value={proj} onChange={v => setSetupParam(draw.id, { projection: v === 'normal' ? undefined : v })}
                options={PERSPECTIVES} />
            </SettingRow>
            {proj === 'reverse' && <>
              <SliderSetting id="reverseStrength" label="Reverse strength" hint="0 = orthographic, 1 = the rays meet exactly at Converge at. The point it looks at keeps its size." value={num(draw.params.reverseStrength, 1)} min={0} max={1} step={0.01} defaultValue={1} onFocus={onFocus}
                param={{ nodeId: draw.id, key: 'reverseStrength' }} onChange={v => setSetupParam(draw.id, { reverseStrength: v })} />
              <SliderSetting id="reverseDist" label="Converge at" hint="How far in front of the camera the rays meet. Nearer than this, walkers look bigger the farther away they are; past it the picture flips." value={num(draw.params.reverseDist, 8)} min={0.5} max={50} step={0.1} defaultValue={8} onFocus={onFocus}
                param={{ nodeId: draw.id, key: 'reverseDist' }} onChange={v => setSetupParam(draw.id, { reverseDist: v })} />
            </>}
            <SliderSetting id="ortho" label="Flatten" hint="Blends the Perspective toward orthographic (1). A slider, so it can be animated." value={cam('ortho')} min={0} max={1} step={0.01} defaultValue={0} onFocus={onFocus}
              param={{ nodeId: draw.id, key: 'ortho' }} onChange={v => setSetupParam(draw.id, { ortho: v })} />
            {CAMERA_CONTROLS.filter(c => c.fold).map(c => (
              <SliderSetting key={c.key} id={c.key} label={c.label} value={cam(c.key)} min={c.key === 'maxBlur' ? 1 : 0} max={c.key === 'maxBlur' ? 32 : 4} step={c.step} onFocus={onFocus}
                param={{ nodeId: draw.id, key: c.key }} onChange={v => setSetupParam(draw.id, { [c.key]: v })} />
            ))}
          </> : <span style={{ fontSize: 12, color: tk.text.muted }}>Draw the walkers (above) for a camera.</span>}
          <SettingRow id="shape3d" label="Around a shape" hint="A ray-marched shape in the middle of the box: the walkers flow round it and are drawn through its camera." onFocus={onFocus}>
            <Select ariaLabel="Around a shape" value={shape ?? ''} options={[{ value: '', label: 'None' }, ...SHAPE_KINDS.map(k => ({ value: k.value, label: k.label }))]}
              onChange={v => { flush(); setGroupShape(groupId, (v || null) as ShapeKind | null); }} />
          </SettingRow>
        </BehaviourCard>
      )}
    </>
  );
}

/**
 * 3D: Shape (Dot, or solid cubes, spheres, rods, tiles, voxels: docs/particle-shapes.md) and, for a solid
 * shape, its Shading, size (Voxel: the grid) and the cost note. Everything else is on the Draw agents card.
 */
function ShapeSettings({ draw, onFocus }: { draw: GraphNode; onFocus: (s: string | undefined) => void }) {
  const shape = String(draw.params.shape ?? 'dot');
  const key = shape === 'voxel' ? 'voxelGrid' : 'shapeSize';
  const pd = DRAW_SHAPE_PARAMS[key];
  return <>
    <SettingRow id="shape" label="Shape" hint={DRAW_SHAPE_PARAM.hint} onFocus={onFocus}>
      <Select ariaLabel="Shape" value={shape} options={DRAW_SHAPE_PARAM.options!} onChange={v => setSetupParam(draw.id, { shape: v })} />
    </SettingRow>
    {shape !== 'dot' && <>
      <ShapeCostNote node={draw} />
      <SettingRow id="shading" label="Shading" hint={DRAW_SHAPE_PARAMS.shading.hint} onFocus={onFocus}>
        <ChipRow label="Shading" value={String(draw.params.shading ?? 'faces')} onChange={v => setSetupParam(draw.id, { shading: v })}
          options={DRAW_SHAPE_PARAMS.shading.options!.map(o => ({ value: o.value, label: o.label.replace(' (cheapest)', '') }))} />
      </SettingRow>
      <SliderSetting id={key} label={shape === 'voxel' ? 'Voxel grid' : 'Shape size'} hint={pd.hint}
        value={num(draw.params[key], key === 'voxelGrid' ? 0.04 : 0.012)} min={pd.min ?? 0.001} max={key === 'voxelGrid' ? 0.25 : 0.1} step={0.001} onFocus={onFocus}
        onChange={v => setSetupParam(draw.id, { [key]: v })} param={{ nodeId: draw.id, key }} />
      {shape === 'voxel' && (
        <SliderSetting id="voxelGlide" label="Glide" hint={DRAW_SHAPE_PARAMS.voxelGlide.hint}
          value={num(draw.params.voxelGlide, 0.5)} min={0} max={1} step={0.01} onFocus={onFocus}
          onChange={v => setSetupParam(draw.id, { voxelGlide: v })} param={{ nodeId: draw.id, key: 'voxelGlide' }} />
      )}
    </>}
  </>;
}
// Draw agents' Perspective (the March Camera's: docs/camera-projections.md).
const PERSPECTIVES = [
  { value: 'normal', label: 'Normal' },
  { value: 'orthographic', label: 'Orthographic' },
  { value: 'reverse', label: 'Reverse' },
] as const;
const PERSPECTIVE_HINT = 'How the camera sees depth, as on the March Camera. Normal: far walkers smaller. Orthographic: no change of size with distance, like an isometric drawing. Reverse: far walkers bigger.';

function PaletteBar({ colours }: { colours: string[] }) {
  return <span data-palette-bar style={{ width: 72, height: 10, borderRadius: 5, background: `linear-gradient(90deg, ${colours.join(', ')})`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' }} />;
}

function TrailPalette({ palette, onFocus }: { palette: GraphNode; onFocus: (s: string | undefined) => void }) {
  const tk = useTokens();
  const stops = stopsOf(palette);
  return (
    <SettingRow id="trailPalette" label="Its colours" hint="The Stops Palette that colours the trail: none at the left, thick at the right." onFocus={onFocus} right={<PaletteBar colours={stops.map(cssOf)} />}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {TRAIL_PALETTES.map(p => (
          <button key={p.key} type="button" data-trail-palette={p.key} title={p.label} onClick={() => setTrailPalette(palette.id, p.stops)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 9px 0 6px', border: 0, borderRadius: 13, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}` }}>
            <span style={{ width: 28, height: 10, borderRadius: 5, background: `linear-gradient(90deg, ${p.stops.map(cssOf).join(', ')})` }} />{p.label}
          </button>
        ))}
      </span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {stops.map((c, i) => <ColorSwatch key={i} size="sm" showHex={false} label={`Colour ${i + 1}`} value={c} onChange={v => setTrailPalette(palette.id, stops.map((s, k) => (k === i ? v as Rgb : s)))} />)}
      </span>
    </SettingRow>
  );
}

/** The selected kind's colour and its states (the old Species tab): named and coloured in place. */
function StatesEditor({ set, sp, update }: { set: AgentRuleSet; sp: number; update: (s: AgentRuleSet) => void }) {
  const tk = useTokens();
  const species = set.species[sp];
  const [editing, setEditing] = useState<number | null>(null);
  const states = species.states;
  const used = (i: number) => set.species[sp].rules.some(r => r.when.some(c => c.kind === 'state' && c.state === i) || r.do.some(a => a.kind === 'state' && a.state === i));
  const patch = (i: number, p: Partial<typeof states[number]>) => update({ ...set, species: set.species.map((s, k) => (k !== sp ? s : { ...s, states: s.states.map((x, j) => (j === i ? { ...x, ...p } : x)) })) });
  return (
    <div data-states style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: tk.text.secondary }}>{states.length > 1 ? `${species.name}'s states` : `${species.name}'s colour`}</span>
      {states.map((st, i) => (
        <span key={i} data-state={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ColorSwatch size="sm" showHex={false} label={`${st.name} colour`} value={st.colour as Rgb} onChange={c => patch(i, { colour: c as Rgb })} />
          {editing === i
            ? <input autoFocus onFocus={e => e.currentTarget.select()} defaultValue={st.name} aria-label="State name" data-state-name-input={i}
              onBlur={e => { setEditing(null); if (e.currentTarget.value.trim()) patch(i, { name: e.currentTarget.value.trim().slice(0, 24) }); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
              style={{ flex: 1, height: 22, padding: '0 6px', border: 0, outline: 'none', borderRadius: 6, background: tk.bg.panel, color: tk.text.primary, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, font: `500 12px ${fontFamily.ui}` }} />
            : <button type="button" data-state-name={i} title="Rename" onClick={() => setEditing(i)} style={{ flex: 1, textAlign: 'left', padding: 0, border: 0, background: 'none', color: tk.text.primary, cursor: 'text', font: `500 12px ${fontFamily.ui}` }}>
              {st.name}{i === 0 && states.length > 1 && <span style={{ color: tk.text.faint }}> · born in it</span>}
            </button>}
          {i === states.length - 1 && i > 0 && !used(i) && (
            <button type="button" data-state-remove={i} aria-label={`Take ${st.name} away`} onClick={() => update({ ...set, species: set.species.map((s, k) => (k !== sp ? s : { ...s, states: s.states.slice(0, -1) })) })}
              style={{ width: 20, height: 20, padding: 0, border: 0, background: 'none', color: tk.text.faint, cursor: 'pointer' }}><Icon name="close" size={12} /></button>
          )}
        </span>
      ))}
      {states.length < MAX_STATES && (
        <button type="button" data-state-add onClick={() => update({ ...set, species: set.species.map((s, k) => (k !== sp ? s : { ...s, states: [...s.states, { name: `state ${s.states.length + 1}`, colour: [0.95, 0.8, 0.25] as Rgb }] })) })}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px 0 7px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }}>
          <Icon name="plus" size={11} />State
        </button>
      )}
    </div>
  );
}
