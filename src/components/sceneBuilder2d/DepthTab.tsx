/**
 * DepthTab — the 2D Scene Builder's "Depth" tab (docs/scene-builder-2d.md, "Picture with depth"; docs/depth-mix.md):
 * a picture with depth the shapes interact with. Pick the picture (the shared picker), generate its depth on this
 * device, see it (the Preview switch: Result, Picture, Depth, Shaped depth; builders/depthPreview.ts), then choose how the shapes respond (size, space) and how the scene and the picture go together (on top,
 * occlude, fog, mix, light), with a gradient laid along depth. Every setting is a live slider on the Depth Mix nodes
 * Build makes.
 */
import { useSceneBuilder2D } from '../../sceneBuilder2d/store';
import type { Scene2D, Vec3 } from '../../sceneBuilder2d/spec';
import {
  DEFAULT_GRADIENT, DEPTH_LOOKS, DEPTH_LOOK_LABELS, DEPTH_PALETTES, depthSummary, newDepthPic, type DepthPic2D,
} from '../../sceneBuilder2d/depth';
import {
  DEPTH_GRADIENT_HOWS, DEPTH_GRADIENT_TARGETS, DEPTH_MIX_COMBINES, DEPTH_MIX_COMBINE_LABELS, DEPTH_SPACE_LABELS, DEPTH_SPACE_STYLES,
  type DepthGradientHow, type DepthGradientTarget, type DepthMixCombine, type DepthSpaceStyle,
} from '../../nodes/definitions/depthMix';
import { FIT_LABELS, findTex, withSource, type TexSource } from '../../builders/textures';
import { BuilderNote } from '../builders/BuilderWindow';
import { TexturePicker } from '../builders/TexturePicker';
import { DepthGenerateRow } from '../builders/DepthGenerateRow';
import { Card, ColourRow, NumRow, Row } from '../sceneBuilder/controls';
import { Select } from '../ui/Select';
import { DepthViewSwitch } from '../builders/DepthViewSwitch';
import { DEPTH_VIEW_LABELS, depthViewsFor, useDepthView } from '../../builders/depthPreview';
import { compileScene2D } from './Preview2D';

const D = newDepthPic('');
const edit = (fn: (d: Scene2D) => void, key?: string) => useSceneBuilder2D.getState().edit(fn, key);
const addSource = (src: TexSource) => edit(d => { d.textures = withSource(d.textures, src); });
/** Change the picture with depth (when there is one); `key` folds a slider's drag into one undo step. */
const setD = (fn: (d: DepthPic2D) => void, key?: string) => edit(s => { if (s.depth) fn(s.depth); }, key && `depth:${key}`);

const HOW_LABELS: Record<DepthGradientHow, string> = { multiply: 'Multiply (tint)', colorize: 'Colorize', add: 'Add (as light)' };
const ON_LABELS: Record<DepthGradientTarget, string> = { scene: 'The scene', picture: 'The picture', both: 'Both' };

export function DepthTab() {
  const depth = useSceneBuilder2D(s => s.scene.depth) ?? null;
  const sources = useSceneBuilder2D(s => s.scene.textures) ?? [];
  const src = depth ? findTex(sources, depth.tex) : undefined;
  const scene = useSceneBuilder2D(s => s.scene);
  const view = useDepthView(s => s.view);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BuilderNote>A picture with depth the shapes interact with: they grow on near things, move by depth, hide behind what is near, fade into the distance or light the picture. Its depth is worked out on this device.</BuilderNote>
      <Card id="depth2-picture" defaultOpen title="Picture with depth" summary={depth ? depthSummary(depth) : 'none'}>
        <TexturePicker id="depth" sources={sources} value={depth?.tex} onAdd={addSource} none="No picture with depth"
          onChange={name => edit(s => { s.depth = name ? (s.depth ? { ...s.depth, tex: name, bake: s.depth.tex === name ? s.depth.bake : null } : newDepthPic(name)) : null; })} />
        {depth && (
          <>
            <Row label="Fit" hint={FIT_LABELS[depth.fit].blurb}>
              <Select ariaLabel="How the picture covers the frame" value={depth.fit} options={(['cover', 'contain', 'stretch'] as const).map(f => ({ value: f, label: FIT_LABELS[f].label }))}
                onChange={v => setD(d => { d.fit = v as DepthPic2D['fit']; })} />
            </Row>
            <DepthGenerateRow pictureNode={src?.node} source={depth.tex} bake={depth.bake}
              onBake={info => setD(d => { d.bake = info; })} />
          </>
        )}
      </Card>
      {depth && (
        <Card id="depth2-preview" defaultOpen title="Preview" summary={DEPTH_VIEW_LABELS[view].label}>
          <DepthViewSwitch views={depthViewsFor({ gradient: !!depth.gradient, size: depth.size.on, space: depth.space.on })} source={scene} compile={compileScene2D} />
        </Card>
      )}
      {depth && <DepthSettings d={depth} />}
    </div>
  );
}

function DepthSettings({ d }: { d: DepthPic2D }) {
  const g = d.gradient;
  const look = DEPTH_LOOK_LABELS[d.look];
  const usesWith = d.look === 'top' || d.look === 'occlude' || d.look === 'fog';
  return (
    <>
      {/* Size and space by depth: each its own card, switched on and off by the builders' shared mute (⊘),
          like every other card; switched off it keeps its settings, dimmed and editable. */}
      <Card id="depth2-size" defaultOpen={d.size.on} title="Size by depth" summary={d.size.on ? `${d.size.far}× far … ${d.size.near}× near` : 'off'}
        mute={{ muted: !d.size.on, onToggle: () => setD(x => { x.size.on = !x.size.on; }), what: 'size by depth' }}>
        <BuilderNote>Every layer grows on near things and shrinks on far ones: depth into its radius.</BuilderNote>
        <NumRow label="Size far" hint="How big shapes are on the farthest things (× their own size)." value={d.size.far} defaultValue={D.size.far} min={0} max={4} onChange={v => setD(x => { x.size.far = v; }, 'sf')} />
        <NumRow label="Size near" hint="How big shapes are on the nearest things." value={d.size.near} defaultValue={D.size.near} min={0} max={4} onChange={v => setD(x => { x.size.near = v; }, 'sn')} />
      </Card>
      <Card id="depth2-space" defaultOpen={d.space.on} title="Space by depth" summary={d.space.on ? `${DEPTH_SPACE_LABELS[d.space.style].label} ${d.space.amount}` : 'off'}
        mute={{ muted: !d.space.on, onToggle: () => setD(x => { x.space.on = !x.space.on; }), what: 'space by depth' }}>
        <BuilderNote>The point every shape is measured from moves by depth: near and far parts pull the shapes apart, so glows beam through the picture.</BuilderNote>
        <Row label="Move by" hint={DEPTH_SPACE_LABELS[d.space.style].blurb}>
          <Select ariaLabel="Move by" value={d.space.style} options={DEPTH_SPACE_STYLES.map(s => ({ value: s, label: DEPTH_SPACE_LABELS[s].label }))} onChange={v => setD(x => { x.space.style = v as DepthSpaceStyle; })} />
        </Row>
        <NumRow label="Amount" hint="How far depth moves them. Small is parallax; large beams the glow across the picture." value={d.space.amount} defaultValue={D.space.amount} min={-1} max={1} step={0.005} onChange={v => setD(x => { x.space.amount = v; }, 'sa')} />
        {d.space.style === 'shift' && <NumRow label="Direction" unit="°" hint="Which way near things move (0 right, 90 up)." value={d.space.dir} defaultValue={D.space.dir} min={-180} max={180} step={1} onChange={v => setD(x => { x.space.dir = v; }, 'sd')} />}
        <NumRow label="Focus" hint="The depth that stays still: nearer moves one way, farther the other." value={d.space.focus} defaultValue={D.space.focus} min={0} max={1} onChange={v => setD(x => { x.space.focus = v; }, 'sfo')} />
      </Card>
      <Card id="depth2-look" defaultOpen title="With the picture" summary={look.label}>
        <Row label="Look" hint={look.blurb}>
          <Select ariaLabel="How the scene and the picture go together" value={d.look} options={DEPTH_LOOKS.map(l => ({ value: l, label: DEPTH_LOOK_LABELS[l].label }))} onChange={v => setD(x => { x.look = v as DepthPic2D['look']; })} />
        </Row>
        <BuilderNote>{look.blurb}</BuilderNote>
        {usesWith && (
          <Row label="Scene over it" hint={DEPTH_MIX_COMBINE_LABELS[d.with].blurb}>
            <Select ariaLabel="How the scene goes over the picture" value={d.with} options={DEPTH_MIX_COMBINES.map(c => ({ value: c, label: DEPTH_MIX_COMBINE_LABELS[c].label }))} onChange={v => setD(x => { x.with = v as DepthMixCombine; })} />
          </Row>
        )}
        <NumRow label="Picture" hint="How bright the picture shows under the scene: 0 hides it." value={d.picture} defaultValue={D.picture} min={0} max={2} onChange={v => setD(x => { x.picture = v; }, 'pa')} />
        {d.look === 'occlude' && (
          <>
            <NumRow label="Scene sits at" hint="The scene's depth (0 far, 1 near): the picture hides it wherever the picture is nearer." value={d.at} defaultValue={D.at} min={0} max={1} step={0.005} onChange={v => setD(x => { x.at = v; }, 'at')} />
            <NumRow label="Softness" hint="How gently it fades in and out at that depth." value={d.soft} defaultValue={D.soft} min={0} max={0.5} step={0.005} onChange={v => setD(x => { x.soft = v; }, 'so')} />
          </>
        )}
        {d.look === 'fog' && (
          <>
            <NumRow label="Density" hint="How much the scene fades on the farthest things (1: gone). Near things stay clear." value={d.fog} defaultValue={D.fog} min={0} max={1} onChange={v => setD(x => { x.fog = v; }, 'fd')} />
            <NumRow label="Haze" hint="How much fog colour hangs in the far part of the picture." value={d.haze} defaultValue={D.haze} min={0} max={1} onChange={v => setD(x => { x.haze = v; }, 'fh')} />
            <ColourRow label="Fog colour" value={d.fogColor} onChange={(v: Vec3) => setD(x => { x.fogColor = v; }, 'fc')} />
          </>
        )}
        {d.look === 'light' && (
          <>
            <NumRow label="Strength" hint="How strongly the scene lights the picture, most on near things." value={d.light} defaultValue={D.light} min={0} max={10} onChange={v => setD(x => { x.light = v; }, 'ls')} />
            <NumRow label="Own light" hint="How much of the picture's own light stays: lower for a night relight." value={d.own} defaultValue={D.own} min={0} max={1.5} onChange={v => setD(x => { x.own = v; }, 'lo')} />
            <NumRow label="Glow" hint="How much of the scene still shows as itself, on top. Keep it low so the scene reads as light on the picture." value={d.glow} defaultValue={D.glow} min={0} max={2} onChange={v => setD(x => { x.glow = v; }, 'lg')} />
          </>
        )}
        {d.look === 'mix' && (
          <>
            <Row label="Near shows">
              <Select ariaLabel="What near things show" value={d.near} options={[{ value: 'picture', label: 'The picture' }, { value: 'scene', label: 'The scene' }]} onChange={v => setD(x => { x.near = v as DepthPic2D['near']; })} />
            </Row>
            <NumRow label="Amount" hint="How far the blend goes: 1 is all the way." value={d.mix} defaultValue={D.mix} min={0} max={1} onChange={v => setD(x => { x.mix = v; }, 'ma')} />
          </>
        )}
      </Card>
      <Card id="depth2-range" title="Depth range" summary={`${d.range[0]}–${d.range[1]} · curve ${d.curve}`}>
        <BuilderNote>Which part of the depth counts. Every look reads the depth after this.</BuilderNote>
        <NumRow label="Far end" hint="The nearness that counts as farthest: raise it to treat the background as flat." value={d.range[0]} defaultValue={0} min={0} max={1} step={0.005} onChange={v => setD(x => { x.range = [v, x.range[1]]; }, 'r0')} />
        <NumRow label="Near end" hint="The nearness that counts as nearest: lower it so more of the picture counts as near." value={d.range[1]} defaultValue={1} min={0} max={1} step={0.005} onChange={v => setD(x => { x.range = [x.range[0], v]; }, 'r1')} />
        <NumRow label="Curve" hint="Above 1 only the nearest things count; below 1 everything but the far background does." value={d.curve} defaultValue={1} min={0.2} max={5} onChange={v => setD(x => { x.curve = v; }, 'cu')} />
      </Card>
      <Card id="depth2-gradient" defaultOpen={!!g} title="Gradient over depth" summary={g ? `${g.palette} on ${g.on}` : 'off'}>
        <BuilderNote>A palette laid along depth: the colour shifts as the picture gets deeper. Flow moves it through depth over time.</BuilderNote>
        <Row label="Gradient">
          <Select ariaLabel="Gradient over depth" value={g?.palette ?? 'off'} options={[{ value: 'off', label: 'Off' }, ...DEPTH_PALETTES.map(p => ({ value: p.key, label: p.label }))]}
            onChange={v => setD(x => { x.gradient = v === 'off' ? null : { ...(x.gradient ?? DEFAULT_GRADIENT), palette: v }; })} />
        </Row>
        {g && (
          <>
            <Row label="On"><Select ariaLabel="What the gradient colours" value={g.on} options={DEPTH_GRADIENT_TARGETS.map(t => ({ value: t, label: ON_LABELS[t] }))} onChange={v => setD(x => { if (x.gradient) x.gradient.on = v as DepthGradientTarget; })} /></Row>
            <Row label="How"><Select ariaLabel="How the gradient colours" value={g.how} options={DEPTH_GRADIENT_HOWS.map(h => ({ value: h, label: HOW_LABELS[h] }))} onChange={v => setD(x => { if (x.gradient) x.gradient.how = v as DepthGradientHow; })} /></Row>
            <NumRow label="Amount" value={g.amount} defaultValue={DEFAULT_GRADIENT.amount} min={0} max={1} onChange={v => setD(x => { if (x.gradient) x.gradient.amount = v; }, 'ga')} />
            <NumRow label="Cycles" hint="How many times the palette repeats from far to near." value={g.cycles} defaultValue={DEFAULT_GRADIENT.cycles} min={0} max={8} onChange={v => setD(x => { if (x.gradient) x.gradient.cycles = v; }, 'gc')} />
            <NumRow label="Phase" hint="Shifts the colours along depth." value={g.phase} defaultValue={DEFAULT_GRADIENT.phase} min={-2} max={2} step={0.005} onChange={v => setD(x => { if (x.gradient) x.gradient.phase = v; }, 'gp')} />
            <NumRow label="Flow" hint="Cycles a second the colours move along depth (0: still)." value={g.flow} defaultValue={DEFAULT_GRADIENT.flow} min={-1} max={1} step={0.005} onChange={v => setD(x => { if (x.gradient) x.gradient.flow = v; }, 'gf')} />
          </>
        )}
      </Card>
    </>
  );
}
