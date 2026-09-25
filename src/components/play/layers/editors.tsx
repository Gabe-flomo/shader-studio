/**
 * editors.tsx — one editor per layer kind, built from the field kit. Each
 * shows its settings in the order you reach for them, with an explanation
 * under the choices that change behaviour, and "try it" buttons for the
 * actions a trigger would fire (burst, drop, next line, clear).
 */
import type { ReactNode } from 'react';
import type { ActionKind, NullLayer, ParticleField, PlayLayer, ZoneAction } from '../../../types/play';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { CameraChip } from '../chips';
import { BLENDS, BLEND_HINT, type Choice, type FieldKit } from './fields';
import { ImagePicker, SpritePicker } from './pickers';
import { FIELD_HELP, ZONE_HELP } from './help';
import { Section } from './Section';
import { AudioSourceRows, FontRow } from './rows';

export interface EditorContext {
  layers: PlayLayer[];
  /** Fire an action on this layer now. */
  act: (kind: ActionKind, amount?: number) => void;
  /** Draw this shape's outline on the picture (polygon corners or a freehand lasso), or stop. */
  drawing: 'polygon' | 'lasso' | null;
  startDrawing: (mode: 'polygon' | 'lasso') => void;
  cancelDrawing: () => void;
  /** Add a null (placed on this layer) and point `key` at it. */
  createNull: (key: string) => void;
}

const MATTES: Choice[] = [
  { value: 'over', label: 'Over', title: 'Drawn over the picture with the blend mode' },
  { value: 'reveal', label: 'Reveal', title: 'The picture shows only inside the shape; the colour fills the rest' },
  { value: 'luma', label: 'Luma', title: 'The picture\'s brightness is the layer\'s alpha: it shows where the picture is bright' },
];
const MATTE_HINT = 'Over: drawn on top with a blend mode. Reveal: the picture shows only inside the shape. Luma: the picture\'s brightness sets the layer\'s transparency.';
const TINT_PALETTE: Choice[] = [{ value: 'tint', label: 'Tint', title: 'One colour' }, { value: 'palette', label: 'Palette', title: 'A cosine gradient' }];
const READ_FROM: Choice[] = [{ value: 'picture', label: 'Picture', title: 'The shader' }, { value: 'camera', label: 'Camera', title: 'A camera layer\'s image' }];

const nulls = (ctx: EditorContext, not = '') => ctx.layers.filter((x): x is NullLayer => x.kind === 'null' && x.id !== not);

function Buttons({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 0 68px' }}>{children}</div>;
}

// Flocking's switch remembers the amount it had, so off and on again comes back the same.
const lastFlock = new Map<string, number>();

function matteRows(f: FieldKit, pictureHidden: boolean) {
  const matte = f.get<string>('matte');
  return (
    <>
      {f.seg('Matte', 'matte', MATTES, MATTE_HINT)}
      {matte === 'over' && f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      {!(matte === 'reveal' && pictureHidden) && f.colour(matte === 'reveal' ? 'Backdrop' : 'Colour', 'color', matte === 'reveal' ? 'The colour around the shape.' : undefined)}
    </>
  );
}

// ── Null ─────────────────────────────────────────────────────────────────────

export function NullEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as NullLayer;
  const hex = l.color;
  return (
    <>
      <Section kind="null" title="Point">
        {f.props('x', 'y', 'size')}
        {f.row('Marker', (
          <>
            <label style={{ position: 'relative', width: 44, height: 26, borderRadius: 8, background: hex, cursor: 'pointer' }}>
              <input type="color" aria-label={`${l.label} marker colour`} value={hex} onChange={e => f.set({ color: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
            </label>
            <span style={{ color: f.tk.text.faint, font: '11px Inter, system-ui, sans-serif' }}>Drag it on the picture. Its X and Y are sources in the mappings drawer.</span>
          </>
        ))}
      </Section>
      <Section kind="null" title="Follow">
        {f.seg('Follows', 'follow', [
          { value: 'none', label: 'Nothing' }, { value: 'mouse', label: 'Mouse', title: 'Chases the pointer while it is over the picture' }, { value: 'null', label: 'A null', title: 'Chases another null' },
        ], 'A following null chases its target on a spring: it lags, overshoots and settles. Its X and Y (and anything mapped from them) move with that motion. Nulls can follow nulls that follow nulls, for chains.')}
        {l.follow === 'null' && f.pick('Target', 'followId', nulls(ctx, l.id), 'Add a second null', 'The null this one chases.', () => ctx.createNull('followId'))}
        {l.follow !== 'none' && f.props('spring', 'wobble')}
      </Section>
      <Section kind="null" title="Particles">
        {f.seg('Role', 'role', [
          { value: 'none', label: 'None' }, { value: 'emitter', label: 'Emitter', title: 'Particles are born here and pushed out' },
          { value: 'absorber', label: 'Absorber', title: 'Pulls particles straight in and swallows them' },
          { value: 'attract', label: 'Attract' }, { value: 'repel', label: 'Repel' }, { value: 'vortex', label: 'Vortex' },
        ], 'What this null does to every particles layer. An emitter and an absorber side by side make particles flow from one to the other along curved lines, like a magnet\'s field.')}
        {l.role === 'emitter' && f.note('Particles are born inside the ring and launched outward; any that leave the picture come back out of it.')}
        {l.role === 'absorber' && f.note('Particles are pulled straight in (no orbiting) and reborn at an emitter, or where the layer spawns them.')}
        {l.role !== 'none' && f.props('radius', 'strength')}
        {l.role === 'vortex' && f.prop('tilt')}
      </Section>
    </>
  );
}

// ── Text ─────────────────────────────────────────────────────────────────────

export function TextEditor({ f, ctx, pictureHidden }: { f: FieldKit; ctx: EditorContext; pictureHidden: boolean }) {
  const seq = f.get<boolean>('sequence');
  const text = f.get<string>('text');
  return (
    <>
      <Section kind="text" title="Text">
        {f.row('Text', seq
          ? <textarea value={text} onChange={e => f.set({ text: e.target.value })} rows={Math.min(6, text.split('\n').length + 1)} placeholder="One line per step" style={{ flex: 1, minWidth: 0, resize: 'vertical', borderRadius: 8, border: 0, padding: '6px 8px', background: f.tk.bg.field, color: f.tk.text.primary, font: '12.5px Inter, system-ui, sans-serif' }} />
          : <Field value={text} onChange={e => f.set({ text: e.target.value })} height={26} style={{ flex: 1, minWidth: 0 }} placeholder="Type something" />)}
        <FontRow f={f} />
      </Section>
      <Section kind="text" title="Position">
        {f.props('x', 'y', 'size', 'rotation')}
        {f.note('Drag it on the picture, or pull a corner to resize (Shift keeps the shape).')}
      </Section>
      <Section kind="text" title="Look">
        {f.prop('opacity')}
        {matteRows(f, pictureHidden)}
      </Section>
      <Section kind="text" title="Sequence" hint="Each line of the text is a step. A Next action (on a key, a beat, a note…) moves on; Every sets a steady pace." on={seq} onToggle={v => f.set({ sequence: v })}>
        {f.seg('Change', 'transition', [
          { value: 'cut', label: 'Cut' }, { value: 'fade', label: 'Fade' }, { value: 'rise', label: 'Rise' }, { value: 'type', label: 'Type', title: 'Letters appear one by one' },
        ], 'How the next line arrives.')}
        {f.prop('interval')}
        <Buttons>
          <Button size="sm" onClick={() => ctx.act('prev')}>Previous</Button>
          <Button size="sm" onClick={() => ctx.act('next')}>Next line</Button>
          <Button size="sm" variant="ghost" onClick={() => ctx.act('shuffle')}>Shuffle</Button>
        </Buttons>
        {f.note('Add an action below (When … → Next line) to step it from a key, a beat or a MIDI note.')}
      </Section>
    </>
  );
}

// ── Image and camera ─────────────────────────────────────────────────────────

export function ImageEditor({ f, pictureHidden }: { f: FieldKit; pictureHidden: boolean }) {
  return (
    <>
      <Section kind="image" title="Image">
        {f.row('Image', <ImagePicker src={f.get<string>('src')} onPick={src => f.set({ src })} />)}
      </Section>
      <Section kind="image" title="Position">
        {f.props('x', 'y', 'scale', 'rotation')}
        {f.note('Drag it on the picture, or pull a corner to resize.')}
      </Section>
      <Section kind="image" title="Look">
        {f.prop('opacity')}
        {matteRows(f, pictureHidden)}
      </Section>
    </>
  );
}

export function CameraEditor({ f, pictureHidden }: { f: FieldKit; pictureHidden: boolean }) {
  return (
    <>
      <Section kind="camera" title="Camera">
        {f.row('Camera', <CameraChip />, 'The webcam. Browsers ask the first time. Its motion is a sensor source, and particles, glyphs and contours can read it instead of the shader.')}
        {f.toggle('Mirror', 'mirror', 'Flip left to right (like a mirror)')}
      </Section>
      <Section kind="camera" title="Position">
        {f.props('x', 'y', 'scale', 'rotation')}
      </Section>
      <Section kind="camera" title="Look">
        {f.prop('opacity')}
        {matteRows(f, pictureHidden)}
      </Section>
    </>
  );
}

// ── Particles ────────────────────────────────────────────────────────────────

const MODULATORS: Choice[] = [
  { value: 'none', label: 'Nothing' }, { value: 'brightness', label: 'Picture brightness' }, { value: 'speed', label: 'Speed' },
  { value: 'age', label: 'Age' }, { value: 'null', label: 'Nearness to a null' },
];

export function ParticlesEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const g = f.get;
  const field = g<ParticleField>('field'), help = FIELD_HELP[field];
  const flat = field === 'climb' || field === 'descend';
  const shape = g<string>('shape'), colour = g<string>('colour');
  const flock = g<number>('flock');
  const nullPick = (why: string) => f.pick('Null', 'nullId', nulls(ctx), 'Add a Null layer first', why, () => ctx.createNull('nullId'));
  return (
    <>
      {f.row('Count', <NumberInput value={g<number>('count')} min={1} max={5000} step={50} title="How many particles (up to 5000)" onCommit={n => f.set({ count: Math.max(1, Math.min(5000, Math.round(n))) })} style={f.numStyle} />, 'How many particles. Changing it keeps the ones already moving.')}
      {f.toggle('Show field', 'showField', 'Draw the field and forces while editing', 'Arrows show where the field points; the attractor, nulls with a role and force zones show their pull. Only while the Layers tab is open, never in recordings or on websites.')}

      <Section kind="particles" title="Motion">
        {f.seg('Field', 'field', (Object.keys(FIELD_HELP) as ParticleField[]).map(k => ({ value: k, label: FIELD_HELP[k].label, title: FIELD_HELP[k].title })),
          'Where each particle wants to go. Flow, Climb and Descend read the picture; Noise is its own drifting field; None leaves it to the forces.')}
        {f.note(<><b style={{ color: f.tk.text.secondary }}>{help.title}.</b> {help.body}</>)}
        {flat && f.seg('On flat areas', 'flat', [
          { value: 'wander', label: 'Wander', title: 'Keep moving on the noise field until they find a slope' },
          { value: 'settle', label: 'Settle', title: 'Slow down and stop: they freeze into patterns along edges' },
        ], 'Flat parts of the picture have no uphill or downhill. Wander keeps particles drifting on the noise field; Settle lets them slow down and collect, which freezes them into the patterns along edges.')}
        {f.props('speed', 'steer')}
        {field === 'flow' && f.prop('turns')}
        {(field === 'flow' || field === 'noise') && f.prop('angle')}
        {(field === 'noise' || (flat && g('flat') === 'wander')) && f.props('noiseScale', 'noiseEvolve')}
        {(field === 'flow' || flat) && f.seg('Reads', 'readFrom', READ_FROM, 'What the field follows: the shader, or a camera layer\'s image (turn the camera on in its layer).')}
        {(field === 'flow' || flat) && f.seg('Detail', 'detail', [{ value: 'coarse', label: 'Coarse' }, { value: 'fine', label: 'Fine' }], 'Coarse reads a 64×36 copy of the picture (smooth, cheap); Fine reads 128×72, so thin lines and small text steer particles too.')}
        {f.prop('collide')}
      </Section>

      <Section kind="particles" title="Birth and death">
        {f.seg('Emit', 'emit', [
          { value: 'stream', label: 'Stream', title: 'Always alive, reborn when they leave' }, { value: 'burst', label: 'Bursts', title: 'Born only by a Burst action' },
        ], 'Stream keeps every particle alive. Bursts starts empty: a Burst action (a key, a kick drum…) throws out a handful, which live for their Life and then vanish.')}
        {g('emit') === 'burst' && <Buttons><Button size="sm" icon="spark" onClick={() => ctx.act('burst', 80)}>Burst 80 now</Button></Buttons>}
        {f.seg('Born', 'spawn', [
          { value: 'anywhere', label: 'Anywhere' }, { value: 'edges', label: 'Edges' }, { value: 'center', label: 'Centre' }, { value: 'null', label: 'At a null' },
        ], 'Where new and respawned particles appear. Emitter shapes and emitter nulls take over when there are any.')}
        {g('spawn') === 'null' && nullPick('The null particles are born around.')}
        {(g('spawn') === 'center' || g('spawn') === 'null') && f.prop('spawnRadius')}
        {f.seg('At the edges', 'edges', [
          { value: 'wrap', label: 'Wrap', title: 'Leave one side, come back on the other' }, { value: 'bounce', label: 'Bounce', title: 'Bounce off the edges' },
          { value: 'respawn', label: 'Respawn', title: 'Start again where particles are born' }, { value: 'random', label: 'Random', title: 'Reappear anywhere, still heading the same way' },
        ], 'What happens when a particle leaves the picture: wrap round, bounce back, respawn where particles are born, or reappear at a random spot (no streams of particles re-entering along the far edge).')}
        {f.props('life', 'fade')}
        {f.row('Seed', <NumberInput value={g<number>('seed')} min={0} max={999999} step={1} title="0 = different every time" onCommit={n => f.set({ seed: Math.max(0, Math.round(n)) })} style={f.numStyle} />, '0 makes every run different. Any other number repeats the same run exactly, which is handy for recordings.')}
        {f.prop('scatter')}
        <Buttons>
          <Button size="sm" variant="ghost" onClick={() => ctx.act('scatter', 1)}>Scatter</Button>
          <Button size="sm" variant="ghost" onClick={() => ctx.act('reset')}>Respawn all</Button>
          <Button size="sm" variant="ghost" onClick={() => ctx.act('freeze')}>Freeze / unfreeze</Button>
        </Buttons>
      </Section>

      <Section
        kind="particles"
        title="Flocking"
        hint="Boids: each particle also steers by the neighbours it can see. It still follows the field, the mouse and the zones."
        on={flock > 0}
        onToggle={on => {
          if (on) f.set({ flock: lastFlock.get(f.l.id) || 0.6 });
          else { lastFlock.set(f.l.id, flock); f.set({ flock: 0 }); }
        }}
      >
        {f.props('flock', 'flockRadius', 'flockAlign', 'flockCohere', 'flockSeparate', 'flockSpace')}
        {f.note('Flock is how much the flock wins over the field. Sight is how far each one sees; inside its Personal space, neighbours are pushed away. The Play example “Flocking” has good starting points.')}
      </Section>

      <Section kind="particles" title="Attractor">
        {f.seg('Pulled by', 'attractor', [
          { value: 'none', label: 'Nothing' }, { value: 'mouse', label: 'Mouse', title: 'The pointer while it is over the picture' },
          { value: 'press', label: 'Press', title: 'The pointer, only while a button is held' }, { value: 'null', label: 'Null', title: 'A null layer' },
        ], 'A point that pulls particles in (on top of the field). Nulls can also be emitters and absorbers: see a null\'s Particles section.')}
        {g('attractor') === 'null' && nullPick('The null that pulls.')}
        {g('attractor') !== 'none' && (
          <>
            {f.seg('Force', 'force', [
              { value: 'gravitate', label: 'Gravitate', title: 'Pull straight in' }, { value: 'spiral', label: 'Spiral', title: 'Pull in while orbiting' }, { value: 'repel', label: 'Repel', title: 'Push away' },
            ], 'Gravitate pulls straight in; Spiral pulls in while orbiting; Repel pushes particles away.')}
            {f.props('strength', ...(g('force') !== 'repel' ? ['catchRadius'] : []))}
          </>
        )}
      </Section>

      <Section kind="particles" title="Look">
        {f.select('Shape', 'shape', [
          { value: 'dot', label: 'Dot' }, { value: 'square', label: 'Square' }, { value: 'triangle', label: 'Triangle' }, { value: 'streak', label: 'Streak' },
          { value: 'ring', label: 'Ring' }, { value: 'star', label: 'Star' }, { value: 'image', label: 'Image / SVG' },
        ], 'What each particle looks like. Streaks stretch along their motion; Image uses a picture or SVG of your own.')}
        {shape === 'image' && f.row('Sprite', <SpritePicker sprite={g<string>('sprite')} crop={g<boolean>('crop')} onPick={sprite => f.set({ sprite })} onCrop={crop => f.set({ crop })} />, 'A PNG, JPG or SVG drawn for every particle. Size scales it; Square crop trims it to its centre square.')}
        {shape === 'image' && f.toggle('Tint', 'tintSprite', 'Paint the sprite in the tint colour', 'Keeps the sprite\'s shape and transparency but fills it with the Tint colour (and tint zones\' colours).')}
        {shape !== 'dot' && f.seg('Rotate', 'rotate', [{ value: 'heading', label: 'Face motion' }, { value: 'spin', label: 'Spin' }, { value: 'none', label: 'Upright' }], 'Face motion points each particle where it is going; Spin turns them steadily; Upright keeps them still.')}
        {f.props('size', 'sizeJitter')}
        {f.select('Size follows', 'sizeBy', MODULATORS, 'Make size depend on something: the picture\'s brightness under the particle, how fast it moves, how old it is, or how near it is to a null (particles grow near the null).')}
        {g('sizeBy') !== 'none' && f.prop('sizeAmount')}
        {f.select('Opacity follows', 'opacityBy', MODULATORS, 'Make opacity depend on something. Age with a negative amount fades particles out as they get old.')}
        {g('opacityBy') !== 'none' && f.prop('opacityAmount')}
        {(g('sizeBy') === 'null' || g('opacityBy') === 'null') && <>{nullPick('The null that size or opacity follows.')}{f.prop('falloff')}</>}
        {(shape !== 'image' || g('tintSprite')) && f.seg('Colour', 'colour', [
          { value: 'tint', label: 'Tint', title: 'One colour' }, { value: 'picture', label: 'Picture', title: 'The colour of the picture under each particle' }, { value: 'palette', label: 'Palette', title: 'A cosine gradient' },
        ], 'Tint paints every particle one colour; Picture takes the colour under each one; Palette picks from a gradient by heading, speed, age or brightness.')}
        {colour === 'tint' && (shape !== 'image' || g('tintSprite')) && f.colour('Tint', 'color')}
        {colour === 'palette' && shape !== 'image' && (
          <>
            {f.palette()}
            {f.seg('Pick by', 'paletteBy', [{ value: 'heading', label: 'Heading' }, { value: 'speed', label: 'Speed' }, { value: 'age', label: 'Age' }, { value: 'brightness', label: 'Brightness' }], 'What chooses each particle\'s place on the gradient.')}
          </>
        )}
        {f.props('links', 'opacity', 'trail')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
        {f.toggle('Mask', 'reveal', 'Picture through particles', 'The particles become a mask: each one shows the picture under it instead of a colour. Hide the picture (Picture → Layers only) to see the shader only where particles are.')}
      </Section>
    </>
  );
}

// ── Shape ────────────────────────────────────────────────────────────────────

export function ShapeEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const g = f.get;
  const shape = g<string>('shape'), action = g<ZoneAction>('action');
  const others = ctx.layers.filter(x => x.kind === 'shape' && x.id !== f.l.id);
  const sources = ctx.layers.filter(x => x.kind === 'text' || x.kind === 'image' || x.kind === 'camera');
  const particles = ctx.layers.filter(x => x.kind === 'particles' || x.kind === 'bodies');
  const geometric = shape === 'box' || shape === 'circle' || shape === 'line' || shape === 'polygon';
  return (
    <>
      <Section kind="shape" title="Shape">
        {f.seg('Shape', 'shape', [
          { value: 'box', label: 'Box' }, { value: 'circle', label: 'Circle' }, { value: 'line', label: 'Line' }, { value: 'polygon', label: 'Drawn' },
          { value: 'layer', label: 'Layer', title: 'The shape of a text or image layer' }, { value: 'picture', label: 'Picture', title: 'The bright parts of the picture' },
        ], 'Box, circle and line are sized with the sliders or the handles on the picture. Drawn is any outline you click or drag on the picture. Layer takes a text or image layer\'s shape (particles flow around your words); Picture makes the bright parts of the shader solid.')}
        {shape === 'polygon' && (
          <Buttons>
            {ctx.drawing
              ? <><Button size="sm" variant="primary" onClick={ctx.cancelDrawing}>Cancel drawing</Button><span style={{ color: f.tk.text.faint, font: '11px Inter, system-ui, sans-serif', alignSelf: 'center' }}>{ctx.drawing === 'polygon' ? 'Click corners on the picture; click the first one, double-click or press Enter to close.' : 'Drag on the picture to draw.'}</span></>
              : <><Button size="sm" icon="edit" onClick={() => ctx.startDrawing('polygon')}>Draw corners</Button><Button size="sm" onClick={() => ctx.startDrawing('lasso')}>Draw freehand</Button></>}
          </Buttons>
        )}
        {shape === 'layer' && f.pick('Layer', 'sourceId', sources, 'Add a Text or Image layer first', 'The text, image or camera layer whose shape this is. It follows that layer as it moves.')}
        {shape === 'picture' && f.prop('threshold')}
        {f.toggle('Invert', 'invert', 'Swap inside and outside')}
      </Section>
      {geometric && (
        <Section kind="shape" title="Position">
          {f.props('x', 'y', ...(shape === 'polygon' ? [] : ['w', 'h']), 'rotation', ...(shape === 'box' ? ['round'] : []))}
          {f.note('Drag it on the picture, pull a corner to resize (Shift keeps the shape), right-click for more.')}
        </Section>
      )}
      <Section kind="shape" title="Particles">
        {f.select('Does', 'action', (Object.keys(ZONE_HELP) as ZoneAction[]).map(k => ({ value: k, label: ZONE_HELP[k].label })), 'What the shape does to particles (and bodies, for walls). Every shape also measures: map its Fill or Hover from the mappings drawer (source: Layer sensor).')}
        {f.note(ZONE_HELP[action].body)}
        {['attract', 'repel', 'wind', 'vortex', 'drag', 'emitter', 'absorber'].includes(action) && f.prop('strength')}
        {['attract', 'repel', 'vortex', 'emitter', 'absorber'].includes(action) && f.prop('reach')}
        {action === 'vortex' && f.prop('tilt')}
        {(action === 'wall' || action === 'container') && f.prop('bounce')}
        {action === 'wind' && f.prop('angle')}
        {action === 'resize' && f.prop('scale')}
        {action === 'tint' && f.colour('Tint', 'tint')}
        {action === 'portal' && f.pick('Comes out of', 'targetId', others, 'Add a second shape', 'The shape particles come out of.')}
        {action !== 'none' && f.select('Acts on', 'affects', [{ value: '', label: 'All particles and bodies' }, ...particles.map(x => ({ value: x.id, label: x.label }))], 'Which particles or bodies layer the shape acts on.')}
      </Section>
      <Section kind="shape" title="Look" hint="Off makes it an invisible zone: it still acts on particles, and is outlined only while the Layers tab is open." on={g<boolean>('show')} onToggle={v => f.set({ show: v })}>
        {f.colour('Fill', 'fill')}
        {f.prop('fillOpacity')}
        {geometric && <>{f.colour('Outline', 'stroke')}{f.props('strokeWidth', 'trim')}</>}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </>
  );
}

// ── Audio, glyphs, contours, lens, brush, bodies ─────────────────────────────

export function AudioEditor({ f }: { f: FieldKit }) {
  const style = f.get<string>('style');
  return (
    <>
      <Section kind="audio" title="Sound">
        <AudioSourceRows f={f} />
        {f.seg('Style', 'style', [
          { value: 'wave', label: 'Wave', title: 'The waveform' }, { value: 'bars', label: 'Bars', title: 'A spectrum, low to high' },
          { value: 'ring', label: 'Ring', title: 'The spectrum around a circle' }, { value: 'blob', label: 'Blob', title: 'A shape that swells with the sound' },
          { value: 'spectrogram', label: 'Spectrogram', title: 'The spectrum scrolling over time: low notes at the bottom, loud is bright' },
        ])}
        {style === 'bars' || style === 'ring' || style === 'spectrogram'
          ? f.row('Bands', <NumberInput value={f.get<number>('bars')} min={4} max={256} step={4} title="How many bands" onCommit={n => f.set({ bars: Math.max(4, Math.min(256, Math.round(n))) })} style={f.numStyle} />)
          : null}
        {style !== 'spectrogram' && f.toggle('Mirror', 'mirror', style === 'bars' ? 'Grow from the middle' : 'Draw it twice, flipped')}
        {f.props('gain', 'smooth')}
        {style === 'spectrogram' && f.prop('scroll')}
      </Section>
      <Section kind="audio" title="Position">
        {f.props('x', 'y', 'w', 'h')}
      </Section>
      <Section kind="audio" title="Look">
        {style !== 'spectrogram' && f.prop('thickness')}
        {f.seg('Colour', 'colour', TINT_PALETTE)}
        {f.get('colour') === 'palette' ? f.palette() : f.colour('Tint', 'color')}
        {f.props('opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </>
  );
}

export function GlyphsEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const style = f.get<string>('style'), colour = f.get<string>('colour'), readFrom = f.get<string>('readFrom');
  const sources = ctx.layers.filter(x => x.id !== f.l.id && x.kind !== 'null' && x.kind !== 'glyphs');
  return (
    <>
      <Section kind="glyphs" title="Grid">
        {f.seg('Style', 'style', [
          { value: 'ascii', label: 'ASCII' }, { value: 'dots', label: 'Dots', title: 'Halftone' }, { value: 'squares', label: 'Squares' },
          { value: 'lines', label: 'Lines', title: 'Angle by brightness' }, { value: 'cross', label: 'Cross' },
        ], 'The picture redrawn on a grid: characters picked by brightness, or dots, squares, lines and crosses sized by it.')}
        {style === 'ascii' && f.row('Characters', <Field value={f.get<string>('chars')} onChange={e => f.set({ chars: e.target.value })} height={26} mono style={{ flex: 1, minWidth: 0 }} />, 'From dark to bright. A space leaves the darkest cells empty. Emoji work too: 🌑🌒🌓🌔🌕.')}
        {f.props('cell', 'contrast')}
        {style === 'ascii' && f.props('shift', 'spread')}
        {f.toggle('Invert', 'invert', 'Bright parts get the small glyphs')}
      </Section>
      <Section kind="glyphs" title="Reads">
        {f.seg('Reads', 'readFrom', [...READ_FROM, { value: 'layer', label: 'A layer', title: 'Another layer: particles, text, an image, a brush…' }], 'What the grid redraws: the shader, a camera layer, or another layer (so glyphs can sit on particles, words or strokes, and several glyph layers can stack).')}
        {readFrom === 'layer' && f.pick('Layer', 'sourceId', sources, 'Add another layer first', 'The layer the glyphs are made from. Hide it (its switch) to see only the glyphs.')}
      </Section>
      <Section kind="glyphs" title="Look">
        {f.seg('Colour', 'colour', [{ value: 'picture', label: 'Picture' }, { value: 'tint', label: 'Tint' }, { value: 'palette', label: 'Palette' }, ...(style === 'ascii' ? [{ value: 'own', label: 'Own', title: 'Each glyph keeps its own colours (emoji)' }] : [])], 'Picture colours each glyph by what is under it; Own keeps emoji in their own colours.')}
        {colour === 'tint' && f.colour('Tint', 'color')}
        {colour === 'palette' && f.palette()}
        {f.toggle('Cover', 'cover', 'Hide the picture under the grid', 'Fills the whole layer with the background colour first, so only the glyphs show.')}
        {f.get<boolean>('cover') && f.colour('Background', 'background')}
        {f.props('opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </>
  );
}

export function ContoursEditor({ f }: { f: FieldKit }) {
  return (
    <>
      <Section kind="contours" title="Lines">
        {f.props('levels', 'width', 'flow')}
        {f.seg('Detail', 'detail', [{ value: 'coarse', label: 'Coarse' }, { value: 'fine', label: 'Fine' }], 'Fine traces smaller shapes; coarse gives smoother, simpler lines.')}
        {f.seg('Reads', 'readFrom', READ_FROM)}
      </Section>
      <Section kind="contours" title="Look">
        {f.seg('Colour', 'colour', TINT_PALETTE, 'Palette colours each level by its height, like a map.')}
        {f.get('colour') === 'palette' ? f.palette() : f.colour('Tint', 'color')}
        {f.props('opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </>
  );
}

export function LensEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  return (
    <>
      <Section kind="lens" title="Lens">
        {f.select('Effect', 'effect', [
          { value: 'magnify', label: 'Magnify' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'blur', label: 'Blur' },
          { value: 'invert', label: 'Invert' }, { value: 'mono', label: 'Black and white' }, { value: 'mirror', label: 'Mirror' },
        ], 'What the lens does to the shader under it (layers below it are not changed).')}
        {f.props('radius', 'amount')}
      </Section>
      <Section kind="lens" title="Position">
        {f.seg('Follows', 'follow', [{ value: 'none', label: 'Stays put' }, { value: 'mouse', label: 'Mouse' }, { value: 'null', label: 'A null' }], 'Mouse moves it with the pointer while it is over the picture.')}
        {f.get('follow') === 'null' && f.pick('Null', 'nullId', nulls(ctx), 'Add a Null layer first', undefined, () => ctx.createNull('nullId'))}
        {f.get('follow') === 'none' && f.props('x', 'y')}
      </Section>
      <Section kind="lens" title="Look">
        {f.prop('ring')}
        {f.get<number>('ring') > 0 && f.colour('Rim', 'ringColor')}
        {f.props('opacity')}
      </Section>
    </>
  );
}

export function BrushEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  return (
    <>
      <Section kind="brush" title="Brush">
        {f.seg('Paint', 'paint', [
          { value: 'drag', label: 'Drag', title: 'Paint while a button is held' }, { value: 'hover', label: 'Hover', title: 'Paint wherever the pointer goes' },
          { value: 'null', label: 'A null', title: 'The null draws as it moves (map an LFO onto it)' }, { value: 'off', label: 'Off' },
        ], 'How strokes are made. On a website, visitors can paint too.')}
        {f.get('paint') === 'null' && f.pick('Null', 'nullId', nulls(ctx), 'Add a Null layer first', undefined, () => ctx.createNull('nullId'))}
        {f.props('size', 'fade')}
        {f.toggle('Walls', 'walls', 'Particles and bodies bump into strokes', 'Draw walls with the mouse: particles slide along your strokes and bodies land on them.')}
        <Buttons><Button size="sm" variant="ghost" onClick={() => ctx.act('clear')}>Clear strokes</Button></Buttons>
      </Section>
      <Section kind="brush" title="Look">
        {f.seg('Colour', 'colour', [{ value: 'palette', label: 'Palette', title: 'Cycles through the palette as you paint' }, { value: 'tint', label: 'Tint' }, { value: 'picture', label: 'Picture', title: 'The colour under the brush' }])}
        {f.get('colour') === 'tint' && f.colour('Tint', 'color')}
        {f.get('colour') === 'palette' && f.palette()}
        {f.props('opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </>
  );
}

export function BodiesEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const source = f.get<string>('source');
  return (
    <>
      <Section kind="bodies" title="Bodies">
        {f.seg('Bodies', 'source', [{ value: 'letters', label: 'Letters' }, { value: 'circles', label: 'Circles' }, { value: 'boxes', label: 'Boxes' }], 'Letters drops one body per letter of the text; circles and boxes drop Count of them.')}
        {source === 'letters'
          ? f.row('Text', <Field value={f.get<string>('text')} onChange={e => f.set({ text: e.target.value })} height={26} style={{ flex: 1, minWidth: 0 }} />)
          : f.row('Count', <NumberInput value={f.get<number>('count')} min={1} max={400} step={1} title="How many" onCommit={n => f.set({ count: Math.max(1, Math.min(400, Math.round(n))) })} style={f.numStyle} />)}
        {source === 'letters' && <FontRow f={f} weight={false} />}
        {f.prop('size')}
      </Section>
      <Section kind="bodies" title="Physics">
        {f.props('gravity', 'angle', 'bounce', 'friction')}
        {f.toggle('Solid picture', 'solidPicture', 'Bright parts of the picture are ground', 'Bodies land on and roll off the bright parts of the shader. Shapes set to Wall and brush strokes with Walls on are solid too.')}
        {f.get<boolean>('solidPicture') && f.prop('threshold')}
        {f.prop('scatter')}
        <Buttons>
          <Button size="sm" onClick={() => ctx.act('drop')}>Drop again</Button>
          <Button size="sm" variant="ghost" onClick={() => ctx.act('scatter', 1)}>Scatter</Button>
          <Button size="sm" variant="ghost" onClick={() => ctx.act('freeze')}>Freeze / unfreeze</Button>
        </Buttons>
      </Section>
      <Section kind="bodies" title="Look">
        {f.seg('Colour', 'colour', TINT_PALETTE)}
        {f.get('colour') === 'palette' ? f.palette() : f.colour('Tint', 'color')}
        {f.props('opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </>
  );
}
