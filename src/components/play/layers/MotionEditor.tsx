/**
 * MotionEditor — a Motion layer's card: what it watches (the camera, the
 * picture, or a layer such as a Video layer), how much counts as movement
 * (Sensitivity, Delay, Smoothing, Cell size), what it shows (nothing, the
 * movement itself, a heat map, or its matte), and shortcuts to use it:
 * particles born where it moves, and a pointer to its readings (Accepts and
 * emits, below the card's sections) and the Motion behaviours.
 * The kit measures and draws it (play/kit/motion.js, docs/motion-layer.md).
 */
import { Button } from '../../ui/Button';
import { CameraChip } from '../chips';
import { defaultLayer, type ParticlesLayer, type PlayLayer } from '../../../types/play';
import { motionSourceChoices } from '../../../play/motionLayers';
import { playId } from '../../../play/playControls';
import { BLENDS, BLEND_HINT, type FieldKit } from './fields';
import { Section } from './Section';
import type { EditorContext } from './editors';

const SHOW_SUMMARY: Record<string, string> = { hidden: 'readings only', extract: 'the movement', heat: 'heat map', mask: 'matte' };

export function MotionEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const g = f.get;
  const readFrom = g<string>('readFrom'), show = g<string>('show');
  const sources = motionSourceChoices(ctx.layers, f.l.id);
  const src = readFrom === 'layer' ? ctx.layers.find(x => x.id === g<string>('sourceId')) : undefined;
  const watching = readFrom === 'camera' ? 'camera' : readFrom === 'picture' ? 'the picture' : src ? src.label : 'no layer yet';
  const bornHere = ctx.layers.filter((x): x is ParticlesLayer => x.kind === 'particles' && x.spawn === 'motion' && x.motionId === f.l.id);
  const addParticles = () => ctx.changePlay(p => {
    const id = playId('layer');
    const n = p.layers.filter(x => x.kind === 'particles').length + 1;
    const made = {
      ...defaultLayer('particles', id, `Particles ${n} · where it moves`),
      count: 1200, spawn: 'motion', motionId: f.l.id, emit: 'stream', life: 1.2, fade: 0.6, field: 'noise', speed: 0.6, size: 2, colour: 'palette', palette: 2, paletteBy: 'age', trail: 0.5, blend: 'screen',
    } as PlayLayer;
    return { ...p, layers: [...p.layers, made] };
  });
  return (
    <>
      <Section kind="motion" title="Watches" primary summary={watching}>
        {f.seg('Source', 'readFrom', [
          { value: 'camera', label: 'Camera', title: 'The webcam' },
          { value: 'picture', label: 'Picture', title: 'The shader (or the Background): everything under the layers' },
          { value: 'layer', label: 'A layer', title: 'A Video layer, particles, a sketch…: what that layer draws' },
        ], 'Where it looks for movement. Camera is the webcam; Picture is the shader under the layers; A layer watches what one layer draws (a Video layer, particles, a Script). A layer it watches keeps running while hidden.')}
        {readFrom === 'camera' && f.row('Camera', <CameraChip />, 'Browsers ask the first time. No Camera layer needed. Without a camera (or on a page whose visitor says no) it reads still: Amount 0.')}
        {readFrom === 'camera' && f.toggle('Mirror', 'mirror', 'Flip left to right (like a mirror)', 'On: moving your right hand moves things on the right of the picture, as a Camera layer shows it.')}
        {readFrom === 'layer' && f.pick('Layer', 'sourceId', sources, 'Add a Video (or any drawing) layer first', 'The layer it watches. Hide that layer to use only its movement.')}
        {f.note(<>It keeps measuring while hidden: the eye and Show only decide what it draws. Its readings (<b>Amount</b>, <b>Area</b>, <b>Where X/Y</b>, <b>Direction X/Y</b>) are under <b>Accepts and emits</b> below, ready to map or to use in a rule.</>)}
      </Section>
      <Section kind="motion" title="What counts" summary={`sensitivity ${g<number>('sensitivity').toFixed(2)} · ${g<number>('delay')} frames`}>
        {f.props('sensitivity', 'delay', 'smoothing', 'cell')}
        {f.note('Each frame is compared with the one Delay frames before, on a grid of Cell size. Sensitivity is how small a change counts; Smoothing makes the grid and the readings linger.')}
      </Section>
      <Section kind="motion" title="Show" summary={SHOW_SUMMARY[show] ?? show}>
        {f.seg('Show', 'show', [
          { value: 'hidden', label: 'Nothing', title: 'Readings only: nothing drawn' },
          { value: 'extract', label: 'Movement', title: 'Only what moves, like the Motion extract effect' },
          { value: 'heat', label: 'Heat map', title: 'The grid: warmer where more moves' },
          { value: 'mask', label: 'Matte', title: 'White where it moves (what another layer shows through)' },
        ], 'Nothing keeps it a readout. Movement shows only what moves, as outlines. Heat map shows the grid it measures. Matte shows the white "where it moves" other layers can use as their matte.')}
        {show === 'extract' && f.seg('Look', 'look', [
          { value: 'neon', label: 'Neon', title: 'Cyan where things arrive, magenta where they leave, on black' },
          { value: 'black', label: 'Black', title: 'How much changed, on black' },
          { value: 'grey', label: 'Grey', title: 'The classic trick: still parts cancel to mid-grey' },
        ])}
        {show === 'extract' && f.prop('gain')}
        {f.prop('feather')}
        {show !== 'hidden' && f.props('opacity')}
        {show !== 'hidden' && f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
      <Section kind="motion" title="Use it" summary={bornHere.length ? `${bornHere.length} particles layer${bornHere.length === 1 ? '' : 's'} born here` : 'matte, particles, rules'}>
        {f.note(<>Show another layer only where it moves: that layer’s <b>Matte</b> → this layer (or <b>+ Where it moves</b> there). Particles born here: their <b>Born → Where it moves</b>, <b>In → {f.l.label}</b>. Rules: <b>Rules → Behaviours</b> has <i>Motion starts</i>, <i>Big movement</i> and <i>Motion stops</i>, or watch a reading going <i>above</i>, <i>rising</i> or <i>falling</i>.</>)}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <Button size="sm" icon="spark" onClick={addParticles}>Add particles born here</Button>
        </div>
      </Section>
    </>
  );
}
