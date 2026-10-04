/**
 * WaterEditor — a Water layer's card: where the water is (the whole picture or
 * a pond), what makes waves (a preset, the source's shape and where it is,
 * rain), how the waves move, how the surface looks, and its readings and Waves
 * matte. The kit runs it on the Finish stack's Water solver
 * (play/kit/waterLayer.js, docs/water-layer.md).
 */
import { Button } from '../../ui/Button';
import { FN_EFFECTS } from '../../../play/kit/finish.js';
import { wlLayerKey } from '../../../play/kit/waterLayer.js';
import { waterLayerSources } from '../../../play/waterLayers';
import { BLENDS, BLEND_HINT, type FieldKit } from './fields';
import { Section } from './Section';
import type { EditorContext } from './editors';

const REGION_SUMMARY: Record<string, string> = { all: 'the whole picture', rect: 'a box', ellipse: 'an ellipse' };
const SHAPES = [
  { value: 'point', label: 'Point' }, { value: 'line', label: 'Line' }, { value: 'ring', label: 'Ring' }, { value: 'twin', label: 'Two points' },
  { value: 'layer', label: 'A layer’s shape' }, { value: 'picture', label: 'The bright parts' },
];
const SOURCES = [
  { value: 'pointer', label: 'The pointer' }, { value: 'layer', label: 'A layer' }, { value: 'xy', label: 'A value (Source X/Y)' }, { value: 'none', label: 'None (rain and splashes only)' },
];
const PRESETS = (FN_EFFECTS.water.presets ?? []).map(pr => ({
  name: pr.name,
  patch: { ...Object.fromEntries(Object.entries(pr.values).map(([k, v]) => [wlLayerKey(k), v])), ...(pr.set ?? {}) } as Record<string, unknown>,
}));

export function WaterEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const g = f.get;
  const region = g<string>('region') || 'all', shape = g<string>('shape') || 'point', source = g<string>('source') || 'pointer';
  const mapShape = shape === 'layer' || shape === 'picture';
  const riders = waterLayerSources(ctx.layers, f.l.id), shapers = waterLayerSources(ctx.layers, f.l.id, true);
  const current = PRESETS.find(pr => Object.entries(pr.patch).every(([k, v]) => (typeof v === 'number' ? Math.abs(g<number>(k) - v) < 1e-6 : g(k) === v)));
  const above = (id: string) => ctx.layers.findIndex(x => x.id === id) > ctx.layers.findIndex(x => x.id === f.l.id);
  const rider = source === 'layer' ? ctx.layers.find(x => x.id === g<string>('sourceLayer')) : undefined;
  const shaper = shape === 'layer' ? ctx.layers.find(x => x.id === g<string>('shapeLayer')) : undefined;
  const maker = mapShape ? (shape === 'picture' ? 'the bright parts' : shaper ? `${shaper.label}’s shape` : 'no layer yet') : source === 'none' ? 'rain and splashes' : source === 'layer' ? (rider ? rider.label : 'no layer yet') : source === 'xy' ? 'Source X/Y' : 'the pointer';
  return (
    <>
      <Section kind="water" title="Where" primary summary={REGION_SUMMARY[region] ?? region}>
        {f.seg('Region', 'region', [
          { value: 'all', label: 'Whole picture', title: 'Water over the whole picture' },
          { value: 'rect', label: 'Box', title: 'A rectangular pool, placed and sized' },
          { value: 'ellipse', label: 'Ellipse', title: 'A round or oval pond, placed and sized' },
        ], 'Where the water is. A box or an ellipse is a pond: drag it on the picture or set its centre and size; its rim fades over Soft edge. Waves leave a pond (Open edges) or bounce off its sides.')}
        {region !== 'all' && f.props('x', 'y', 'w', 'h', 'soft')}
        {f.note(<>It bends and lights what is <b>under</b> it: the picture and the layers below it in this list. Layers above it stay dry, so a boat drawn above it sails on the water without wobbling in its own wake.</>)}
      </Section>
      <Section kind="water" title="What makes waves" summary={maker}>
        {f.row('Preset', <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{PRESETS.map(pr => <Button key={pr.name} size="sm" variant={current === pr ? 'primary' : 'secondary'} onClick={() => f.set(pr.patch)}>{pr.name}</Button>)}</div>, 'Starting points (the same as the Water effect’s): they only set the settings below.')}
        {f.select('Shape', 'shape', SHAPES, 'What touches the water. A point, a line or a ring sits where the Source is; two points make interfering rings (give them Bob). A layer’s shape, or the bright parts of what is under the water, make waves wherever they move.')}
        {shape === 'layer' && f.pick('Layer', 'shapeLayer', shapers, 'Add a layer to push the water with', 'Its shape pushes the water as it moves (a still layer makes no waves unless it bobs). It can be above this layer (a boat on the water) or hidden, and still work.')}
        {shape === 'layer' && shaper && !above(shaper.id) && f.note(<>{shaper.label} is below the water, so it is bent by it too. Move it above this layer to keep it dry.</>)}
        {!mapShape && f.select('Source', 'source', SOURCES, 'Where the shape is: under the pointer while it is over the picture, on a layer (a null following your hand or an LFO path, a text, a shape: above or below the water, even hidden), or at Source X/Y, which you can map like any setting (an XY pad).')}
        {!mapShape && source === 'layer' && f.pick('Layer', 'sourceLayer', riders, 'Add a null or another layer to ride', 'The source rides this layer’s position. A null that follows the mouse or a hand makes a smooth, springy source.')}
        {!mapShape && source === 'xy' && f.props('sourceX', 'sourceY')}
        {f.props('size', 'strength', 'bob')}
        {(shape === 'line' || shape === 'ring' || shape === 'twin') && f.prop('length')}
        {(shape === 'line' || shape === 'twin') && f.prop('angle')}
        {f.props('rain', 'drop')}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <Button size="sm" icon="wave" onClick={() => ctx.act('splash')}>Splash now</Button>
        </div>
        {f.note(<>A rule’s <b>Splash · {f.l.label}</b> (Rules → Do) drops into this water at its source, under the pointer, somewhere random or at a point.</>)}
      </Section>
      <Section kind="water" title="How it moves" summary={`speed ${g<number>('speed').toFixed(2)} · damping ${g<number>('damping').toFixed(2)}`}>
        {f.props('speed', 'damping', 'edges')}
        {f.seg('Detail', 'detail', [
          { value: 'low', label: 'Low', title: 'A coarse grid: cheapest, softer waves' },
          { value: 'medium', label: 'Medium', title: 'The Water effect’s default' },
          { value: 'high', label: 'High', title: 'Finer ripples, more work for the GPU' },
        ], 'How fine the water’s grid is (a pond’s cells are as big on the picture as the whole picture’s). The waves move the same at every detail and in every render.')}
        {f.note('A simulated surface: waves travel at Wave speed, cross and fade by Damping. A source moving faster than the waves leaves a V-shaped wake like a boat. The water ticks with the clock, so takes, renders and web pages repeat it exactly.')}
      </Section>
      <Section kind="water" title="Look" summary={`refraction ${g<number>('refraction').toFixed(2)}`}>
        {f.props('refraction', 'highlights', 'light', 'opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
      <Section kind="water" title="Readings and matte" summary="wave height, energy, area">
        {f.props('probeX', 'probeY', 'feather')}
        {f.note(<>Readings under <b>Accepts and emits</b> below: <b>Wave height</b> at the Probe (0.5 still; map a boat’s X and Y onto Probe X/Y to read the water under it), <b>Energy</b> (how much the whole surface moves) and <b>Area</b> (the share of it moving). Map them, or use them in a rule. As a <b>matte</b> (another layer’s Matte → this layer) it is its waves: that layer shows only where the water moves. It keeps running while hidden.</>)}
      </Section>
    </>
  );
}
