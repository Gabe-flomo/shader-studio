/**
 * editors.tsx — one editor per layer kind, built from the field kit. Each
 * shows its settings in the order you reach for them, with an explanation
 * under the choices that change behaviour, and "try it" buttons for the
 * actions a trigger would fire (burst, drop, next line, clear).
 */
import { useState, type ReactNode } from 'react';
import { RELATION_MAX_MEMBERS, RELATION_MEMBER_KINDS, newRelationMember, relationPictureKey, type ActionKind, type NullLayer, type ParticleField, type PlayLayer, type PlayRecord, type RelationMember, type RelationshipLayer, type ZoneAction } from '../../../types/play';
import { addSignal } from '../../../play/pairs';
import { Button, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Menu } from '../../ui/Menu';
import { toast } from '../../ui/toastStore';
import { useThemeMode } from '../../../theme/themeStore';
import { accentColor } from '../../../theme/categories';
import { kindOf, newLayerKindId } from '../../../types/layerKinds';
import { detachLayer, editKind, kindUses, layerKindRegistry, saveLayerAsKind, useInstalledKinds, type KindLook } from '../../../play/layerKinds';
import { KindDialog } from './KindDialog';
import { addKindToList, applyKindLook, removeKindFromFile, removeKindFromList } from './kindActions';
import { Field } from '../../ui/Field';
import { GY_SETS } from '../../../play/kit/glyphs.js';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { CameraChip } from '../chips';
import { HandsChip, ShowHandToggle } from '../HandsChip';
import { TrackPointPicker, TrackerChip } from '../TrackingChips';
import { Select } from '../../ui/Select';
import { HAND_POINT_OPTIONS, HAND_SIDES } from '../../../play/playSources';
import { BLENDS, BLEND_HINT, type Choice, type FieldKit } from './fields';
import { ImagePicker, SpritePicker } from './pickers';
import { FIELD_HELP, ZONE_HELP } from './help';
import { Section } from './Section';
import { BigEditorScaffold } from './BigEditorScaffold';
import { AudioSourceRows, FontRow } from './rows';
import { extractScriptParams } from './scriptExamples';
import { Segmented } from '../../ui/Choice';
import { GroupedPicker } from '../../ui/GroupedPicker';
import { valueSections } from '../ConditionFields';
import { layerFiles, sameFiles, scriptPatch, type ApplyOptions } from './scriptApply';
import { DrawGlimpse, FileChips, ScriptStatusLine } from './ScriptCard';
import { P5ImportDialog, type P5ImportResult } from './P5Import';
import { replaceWithP5 } from './p5Layer';
import { ScriptControls } from './ScriptControls';
import { ScriptModal } from './ScriptModal';
import { useScriptStatus } from '../../../play/scriptStatus';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { DEFAULT_SCRIPT, DEFAULT_SCRIPT_3D, DEFAULT_SCRIPT_PARAMS, SCRIPT_MAIN_FILE, script3dDefaults, type ScriptFile, type ScriptLayer, type ScriptMode, type ScriptParamDef } from '../../../types/playLayers';
import { useTokens } from '../../../theme/themeStore';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { handFeed } from '../../../lib/handFeed';
import { addFingertipNulls, addHandPath, handPathNulls } from '../layerOps';
import { playId } from '../../../play/playControls';
import { defaultLayer } from '../../../types/play';
import { HD_POINT_NAMES } from '../../../play/kit/hands.js';

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
  /** The whole record, and a way to change it: a layer kind's edit reaches every layer made from it. */
  play: PlayRecord;
  changePlay: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** The card is in the split view's big Layers panel (room for a big editor like the drum pads'). */
  big?: boolean;
  /** A touch-first layout (phones): no split view, so big editors open in a sheet. */
  touch?: boolean;
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

export function matteRows(f: FieldKit, pictureHidden: boolean) {
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
      <Section kind="null" title="Point" primary summary={`${f.get<number>('x').toFixed(2)}, ${f.get<number>('y').toFixed(2)}`}>
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
          { value: 'hand', label: 'A hand', title: 'Chases a fingertip or joint of a tracked hand (hand tracking, with the camera)' },
          { value: 'agent', label: 'An agent', title: 'Chases one agent of an Agents layer' },
          { value: 'face', label: 'A face', title: 'Chases a point on a tracked face (face tracking)' },
          { value: 'pose', label: 'A body', title: 'Chases a point on a tracked body: a wrist, an elbow, a knee (pose tracking)' },
        ], 'A following null chases its target on a spring: it lags, overshoots and settles. Its X and Y (and anything mapped from them) move with that motion. Nulls can follow nulls that follow nulls, for chains.')}
        {l.follow === 'null' && f.pick('Target', 'followId', nulls(ctx, l.id), 'Add a second null', 'The null this one chases.', () => ctx.createNull('followId'))}
        {l.follow === 'agent' && <>
          {f.pick('Agents', 'followId', ctx.layers.filter(x => x.kind === 'agents'), 'Add an Agents layer first', 'The Agents layer whose agent this null chases.')}
          {f.row('Agent', <NumberInput value={l.agentIndex} min={0} max={4999} step={1} title="Which agent (0 is the first). While it is dead, the layer’s centre." onCommit={n => f.set({ agentIndex: Math.max(0, Math.min(4999, Math.round(n))) })} style={f.numStyle} />, 'Which agent it follows, by number (0 is the first; groups are numbered in order). While that agent is dead the null heads for the live agents’ centre.')}
        </>}
        {l.follow === 'hand' && <>
          {f.seg('Hand', 'handSide', HAND_SIDES, 'Your own right or left hand. Either follows your right hand while it is in view, else your left.')}
          {f.row('Point', <Select ariaLabel="Point on the hand" value={String(l.handPoint)} options={HAND_POINT_OPTIONS} onChange={v => f.set({ handPoint: parseInt(v, 10) || 0 })} height={26} style={{ flex: 1, minWidth: 0 }} />, 'The fingertip or joint it chases. When the hand leaves the picture it waits where it was.')}
          {f.row('Tracking', <HandsChip />)}
        </>}
        {(l.follow === 'face' || l.follow === 'pose') && <>
          {f.row('Point', <TrackPointPicker kind={l.follow} value={l.trackPoint ?? (l.follow === 'face' ? 1 : 0)} onChange={trackPoint => f.set({ trackPoint })} />, l.follow === 'face' ? 'The point on the face it chases (the nose tip, an iris, a mouth corner…). When the face leaves the picture it waits where it was.' : 'The point on the body it chases. When the body leaves the picture it waits where it was.')}
          {f.row('Tracking', <TrackerChip kind={l.follow} />)}
        </>}
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
  const reads = f.get<string>('reads') ?? '';
  return (
    <>
      <Section kind="text" title="Text" primary summary={text ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : 'Empty'}>
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
      <Section kind="text" title="Reads a value" hint="Show a live number instead of the text: a slider, a source, a layer's speed, a distance…" on={!!reads} onToggle={v => f.set({ reads: v ? (ctx.play.controls[0] ? `ctl:${ctx.play.controls[0].id}` : 'mouse:x') : '' })}>
        {f.row('Value', <GroupedPicker ariaLabel="Value it shows" value={reads} placeholder="Pick a value" sections={valueSections(ctx.play)} height={26} style={{ flex: 1, minWidth: 0 }} width={300} searchPlaceholder="Search values" onChange={v => f.set({ reads: v })} />)}
        {f.seg('As', 'readFormat', [
          { value: 'number', label: '1.25' }, { value: 'percent', label: '%', title: 'A 0 to 1 value as a percent' }, { value: 'onoff', label: 'On/Off', title: 'ON above a half, else OFF' }, { value: 'template', label: 'Text', title: 'The text above, with {v} replaced by the value' },
        ], f.get<string>('readFormat') === 'template' ? 'Write {v} in the text where the value goes, e.g. "Speed: {v}".' : undefined)}
        {f.row('Decimals', <NumberInput value={f.get<number>('readDecimals')} min={0} max={6} step={1} title="Places after the point" onCommit={n => f.set({ readDecimals: Math.max(0, Math.min(6, Math.round(n))) })} style={{ width: 52, height: 26, borderRadius: 6, border: 0, background: f.tk.bg.field, color: f.tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' }} />)}
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
      <Section kind="image" title="Image" primary summary={f.get<string>('src') ? 'Picture set' : 'No picture yet'}>
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

/** Hand tracking from the camera this layer shows: one click, plus nulls on the fingertips. */
function CameraHands() {
  const tk = useTokens();
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const hasTipNulls = useNodeGraphStore(s => s.play.layers.some(l => l.kind === 'null' && (l as NullLayer).follow === 'hand'));
  return (
    <Section kind="camera" title="Hand tracking">
      <div style={{ margin: '2px 0 6px' }}><HandsChip /></div>
      <div style={{ margin: '0 0 8px' }}><ShowHandToggle /></div>
      <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, margin: '0 0 6px' }}>
        Follows your hands in this camera. Every finger point, pinches and gestures become sources in Mappings, triggers can fire <b>On: Hand gesture</b>, and a Null can follow a hand point.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon="plus" onClick={() => { setPlay(p => addFingertipNulls(p)); if (handFeed.getStatus() === 'off') void handFeed.start(); }}>
          {hasTipNulls ? 'Add fingertip nulls (missing ones)' : 'Add fingertip nulls'}
        </Button>
        <Button size="sm" icon="hand" title="A filled shape between both hands' thumb and index tips (nulls added where missing): it moves with your hands. Mask with it, matte with it, or make it a zone." onClick={() => { setPlay(p => addHandPath(p).play); if (handFeed.getStatus() === 'off') void handFeed.start(); }}>
          Add hand path
        </Button>
      </div>
    </Section>
  );
}

export function CameraEditor({ f, pictureHidden }: { f: FieldKit; pictureHidden: boolean }) {
  return (
    <>
      <Section kind="camera" title="Camera" primary>
        {f.row('Camera', <CameraChip />, 'The webcam. Browsers ask the first time. Its motion is a sensor source, and particles, glyphs and contours can read it instead of the shader.')}
        {f.toggle('Mirror', 'mirror', 'Flip left to right (like a mirror)')}
      </Section>
      <CameraHands />
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
  const signals = ctx.play.signals ?? [];
  const signalRow = (label: string, key: 'splitSignal' | 'fullSignal' | 'annihilateSignal' | 'clearedSignal' | 'bornSignal' | 'diedSignal', hint: string) => f.row(label, (
    <>
      <Select ariaLabel={`Signal on ${label.toLowerCase()}`} value={g<string>(key)} options={[{ value: '', label: 'None' }, ...signals.map(s => ({ value: s.id, label: s.name }))]} onChange={v => f.set({ [key]: v })} height={26} style={{ flex: 1, minWidth: 0 }} />
      <Button size="sm" variant="ghost" onClick={() => ctx.changePlay(p => { const r = addSignal(p); return { ...r.play, layers: r.play.layers.map(x => (x.id === f.l.id ? { ...x, [key]: r.id } : x)) }; })}>New signal</Button>
    </>
  ), hint);
  return (
    <BigEditorScaffold kind="particles" sections={[
      { id: 'particles-motion', label: 'Motion' },
      { id: 'particles-birth', label: 'Birth and death' },
      { id: 'particles-flocking', label: 'Flocking' },
      { id: 'particles-attractor', label: 'Attractor' },
      { id: 'particles-look', label: 'Look' },
    ]}>
      {f.row('Count', <NumberInput value={g<number>('count')} min={1} max={5000} step={50} title="How many particles (up to 5000)" onCommit={n => f.set({ count: Math.max(1, Math.min(5000, Math.round(n))) })} style={f.numStyle} />, 'How many particles. Changing it keeps the ones already moving.')}
      {f.toggle('Show field', 'showField', 'Draw the field and forces while editing', 'Arrows show where the field points; the attractor, nulls with a role and force zones show their pull. Only while the Layers tab is open, never in recordings or on websites.')}

      <Section id="particles-motion" kind="particles" title="Motion" summary={`${FIELD_HELP[field].label} · speed ${g<number>('speed').toFixed(2)}`}>
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

      <Section id="particles-birth" kind="particles" title="Birth and death" primary summary={`${g('emit')} · born ${g('spawn')}`}>
        {f.seg('Emit', 'emit', [
          { value: 'stream', label: 'Stream', title: 'Always alive, reborn when they leave' }, { value: 'burst', label: 'Bursts', title: 'Born only by a Burst action' },
          { value: 'multiply', label: 'Multiply', title: 'One particle is born and keeps splitting until there are Count of them' },
        ], 'Stream keeps every particle alive. Bursts starts empty: a Burst action (a key, a kick drum…) throws out a handful, which live for their Life and then vanish. Multiply starts with one particle that buds and splits until the Count is reached.')}
        {g('emit') === 'burst' && <Buttons><Button size="sm" icon="spark" onClick={() => ctx.act('burst', 80)}>Burst 80 now</Button></Buttons>}
        {g('emit') === 'multiply' && (
          <>
            {f.seg('Grow', 'grow', [
              { value: 'itself', label: 'By itself', title: 'Split timers grow the colony' }, { value: 'fullness', label: 'By Fullness', title: 'The population follows the Fullness slider' },
            ], 'By itself: each particle splits on its own clock (Split rate). By Fullness: the population chases the Fullness slider directly — raising it buds new particles from random living parents (a few a frame, so it looks like growth, not a pop); lowering it removes the youngest first. Split timers are off.')}
            {g('grow') === 'fullness'
              ? f.prop('fullness')
              : f.props('splitRate', 'splitJitter', 'splitChildren', 'splitPush')}
            {f.seg('Once born', 'multLife', [
              { value: 'stay', label: 'Stay', title: 'Drift apart gently and stop' }, { value: 'flow', label: 'Flow', title: 'Follow the field and forces like other particles' },
              { value: 'return', label: 'Return', title: 'Spring back to where they were born' }, { value: 'annihilate', label: 'Annihilate', title: 'Pair up, seek each other and vanish in a burst' },
            ], 'What a particle does after it buds. Annihilate starts once the colony first fills: each pairs with a random neighbour within Pair radius, they close in and both vanish in a small burst.')}
            {g('multLife') !== 'flow' && f.prop('multSpread')}
            {g('multLife') === 'return' && f.prop('returnSpring')}
            {g('multLife') === 'annihilate' && f.props('pairRadius', 'seekSpeed')}
            {g('grow') === 'itself' && <>
              {f.seg('When full', 'multAfter', [
                { value: 'loop', label: 'Loop', title: 'Stop splitting; start over from one when they are gone' }, { value: 'respawn', label: 'Respawn', title: 'The dead come back at the spawn point and multiply again' },
                { value: 'hold', label: 'Hold', title: 'Keep splitting to stay at the full count' },
              ], 'After the Count is reached. Loop stops splitting and starts again from one particle when they are gone (or after Loop hold). Respawn brings the dead back where the colony began. Hold keeps the survivors splitting to stay full.')}
              {g('multAfter') === 'loop' && f.prop('loopHold')}
            </>}
            {f.note('The first particle is born where Born says; with Seed set, every run grows the same way.')}
            <Buttons><Button size="sm" variant="ghost" onClick={() => ctx.act('reset')}>Start over from one</Button></Buttons>
            <Section id="particles-multiply-signals" kind="particles" title="Signals out" hint="Named events other actions and mappings can react to. Pick a signal (or make one) for any you want to use; leave the rest as None.">
              {signalRow('Split', 'splitSignal', 'Sent whenever a particle buds — by itself, by Fullness or the Multiply action.')}
              {signalRow('Full', 'fullSignal', 'Sent whenever the colony reaches its target.')}
              {g('multLife') === 'annihilate' && signalRow('Annihilate', 'annihilateSignal', 'Sent whenever a pair dies.')}
              {signalRow('Cleared', 'clearedSignal', 'Sent whenever the colony empties out (or a Loop restarts).')}
            </Section>
          </>
        )}
        {f.seg('Born', 'spawn', [
          { value: 'anywhere', label: 'Anywhere' }, { value: 'edges', label: 'Edges' }, { value: 'center', label: 'Centre' }, { value: 'null', label: 'At a null' },
          { value: 'motion', label: 'Where it moves', title: 'Where a Motion layer sees movement, or the camera (a Camera layer, hidden or not)' },
          { value: 'bright', label: 'Bright parts', title: 'On the bright parts of the picture, the brightest most' },
        ], 'Where new and respawned particles appear. Emitter shapes and emitter nulls take over when there are any. Where it moves reads a Motion layer (the camera, the picture or a video) or, with In: Camera, a Camera layer (hide it to keep only the particles); with nothing moving yet they appear anywhere, and after that where something last moved.')}
        {g('spawn') === 'null' && nullPick('The null particles are born around.')}
        {g('spawn') === 'motion' && f.select('In', 'motionId', [
          { value: '', label: 'Camera (a Camera layer)' },
          ...ctx.layers.filter(x => x.kind === 'motion').map(x => ({ value: x.id, label: x.label })),
        ], 'Whose movement they are born in: a Motion layer (it can watch the camera, the picture or a Video layer; set its Sensitivity and Cell size there), or the camera\'s own motion map (needs a Camera layer).')}
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
        <Section id="particles-birth-signals" kind="particles" title="Signals out" hint="Named events other actions and mappings can react to. Pick a signal (or make one) for any you want to use; leave the rest as None.">
          {signalRow('Born', 'bornSignal', 'Sent whenever one or more particles are born this step — a Burst action, a stream respawn, or a Multiply bud.')}
          {signalRow('Died', 'diedSignal', 'Sent whenever one or more particles die this step — age, a kill boundary, an annihilation, or a Cull action.')}
        </Section>
      </Section>

      <Section
        id="particles-flocking"
        kind="particles"
        title="Flocking"
        hint="Boids: each particle also steers by the neighbours it can see. It still follows the field, the mouse and the zones."
        summary={flock > 0 ? `On · ${flock.toFixed(2)}` : 'Off'}
        on={flock > 0}
        onToggle={on => {
          if (on) f.set({ flock: lastFlock.get(f.l.id) || 0.6 });
          else { lastFlock.set(f.l.id, flock); f.set({ flock: 0 }); }
        }}
      >
        {f.props('flock', 'flockRadius', 'flockAlign', 'flockCohere', 'flockSeparate', 'flockSpace')}
        {f.note('Flock is how much the flock wins over the field. Sight is how far each one sees; inside its Personal space, neighbours are pushed away. The Play example “Flocking” has good starting points.')}
      </Section>

      <Section id="particles-attractor" kind="particles" title="Attractor" summary={g('attractor') === 'none' ? 'Nothing' : `${g('attractor')} · ${g('force')}`}>
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

      <Section id="particles-look" kind="particles" title="Look" summary={`${shape} · ${colour}`}>
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
        {f.toggle('Goo', 'goo', 'Metaballs: touching particles merge into blobs', 'Draws the particles as one smooth field: particles that touch merge into an organic blob and part with a stretching neck. Colour still comes from Tint, Picture or Palette.')}
        {g<boolean>('goo') && f.props('gooBlend', 'gooThreshold', 'gooSoft')}
        {f.props(...(g('goo') ? [] : ['links']), 'opacity', 'trail')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
        {f.toggle('Mask', 'reveal', 'Picture through particles', 'The particles become a mask: each one shows the picture under it instead of a colour. Hide the picture (Background → Layers only) to see the shader only where particles are.')}
      </Section>
    </BigEditorScaffold>
  );
}

// ── Shape ────────────────────────────────────────────────────────────────────

export function ShapeEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const g = f.get;
  const shape = g<string>('shape'), action = g<ZoneAction>('action');
  const others = ctx.layers.filter(x => x.kind === 'shape' && x.id !== f.l.id);
  const sources = ctx.layers.filter(x => x.kind === 'text' || x.kind === 'image' || x.kind === 'camera' || x.kind === 'video');
  const particles = ctx.layers.filter(x => x.kind === 'particles' || x.kind === 'bodies');
  const geometric = shape === 'box' || shape === 'circle' || shape === 'line' || shape === 'polygon';
  const outlined = geometric || shape === 'path';
  return (
    <>
      <Section kind="shape" title="Shape" primary summary={shape}>
        {f.seg('Shape', 'shape', [
          { value: 'box', label: 'Box' }, { value: 'circle', label: 'Circle' }, { value: 'line', label: 'Line' }, { value: 'polygon', label: 'Drawn' },
          { value: 'path', label: 'Path', title: 'Corners that are nulls: it moves as they do (put them on your fingertips)' },
          { value: 'layer', label: 'Layer', title: 'The shape of a text or image layer' }, { value: 'picture', label: 'Picture', title: 'The bright parts of the picture' },
        ], 'Box, circle and line are sized with the sliders or the handles on the picture. Drawn is any outline you click or drag on the picture. Path joins nulls (your fingertips, with hand tracking) into a shape that moves with them. Layer takes a text or image layer\'s shape (particles flow around your words); Picture makes the bright parts of the shader solid.')}
        {shape === 'polygon' && (
          <Buttons>
            {ctx.drawing
              ? <><Button size="sm" variant="primary" onClick={ctx.cancelDrawing}>Cancel drawing</Button><span style={{ color: f.tk.text.faint, font: '11px Inter, system-ui, sans-serif', alignSelf: 'center' }}>{ctx.drawing === 'polygon' ? 'Click corners on the picture; click the first one, double-click or press Enter to close.' : 'Drag on the picture to draw.'}</span></>
              : <><Button size="sm" icon="edit" onClick={() => ctx.startDrawing('polygon')}>Draw corners</Button><Button size="sm" onClick={() => ctx.startDrawing('lasso')}>Draw freehand</Button></>}
          </Buttons>
        )}
        {shape === 'layer' && f.pick('Layer', 'sourceId', sources, 'Add a Text or Image layer first', 'The text, image or camera layer whose shape this is. It follows that layer as it moves.')}
        {shape === 'picture' && f.prop('threshold')}
        {shape === 'path' && <PathRows f={f} ctx={ctx} />}
        {f.toggle('Invert', 'invert', 'Swap inside and outside', 'The fill covers everything but the shape, particles and triggers treat the outside as inside, and a matte made from it shows the other side.')}
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
        {outlined && <>{f.colour('Outline', 'stroke')}{f.props('strokeWidth', 'trim')}</>}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
    </>
  );
}

/** What a null is doing, in a few words: which hand point it follows, or that it follows the mouse or another null. */
function nullFollows(n: NullLayer, layers: PlayLayer[]): string {
  if (n.follow === 'hand') return `${n.handSide === 'any' ? 'Either hand' : n.handSide === 'right' ? 'Right hand' : 'Left hand'} · ${HD_POINT_NAMES[n.handPoint] ?? `point ${n.handPoint}`}`;
  if (n.follow === 'mouse') return 'Follows the mouse';
  if (n.follow === 'null') return `Follows ${layers.find(x => x.id === n.followId)?.label ?? 'a null'}`;
  if (n.follow === 'agent') return `Follows agent ${n.agentIndex} of ${layers.find(x => x.id === n.followId)?.label ?? 'an Agents layer'}`;
  return 'Stays where you drag it';
}

/** A path shape's corners (nulls, in order: add, reorder, remove), how it joins them, and what a lost hand does. */
function PathRows({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const tk = f.tk;
  const ids = f.get<string[]>('pointIds') ?? [];
  const style = f.get<string>('pathStyle');
  const byId = new Map(ctx.layers.map(l => [l.id, l]));
  const free = nulls(ctx).filter(n => !ids.includes(n.id));
  const setIds = (next: string[]) => f.set({ pointIds: next });
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= ids.length) return; const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]; setIds(next); };
  const newNull = () => {
    const id = playId('layer');
    ctx.changePlay(p => {
      const n = p.layers.filter(l => l.kind === 'null').length + 1;
      const nul = defaultLayer('null', id, `Null ${n}`) as NullLayer;
      // Round a small circle, so each new corner lands somewhere new.
      const a = (ids.length / 6) * Math.PI * 2;
      nul.x = 0.5 + Math.cos(a) * 0.15; nul.y = 0.5 + Math.sin(a) * 0.2;
      return { ...p, layers: [...p.layers.map(l => (l.id === f.l.id ? { ...l, pointIds: [...ids, id] } as PlayLayer : l)), nul] };
    });
  };
  const fingertips = () => {
    ctx.changePlay(p => { const r = handPathNulls(p); return { ...r.play, layers: r.play.layers.map(l => (l.id === f.l.id ? { ...l, pointIds: r.ids } as PlayLayer : l)) }; });
    if (handFeed.getStatus() === 'off') void handFeed.start();
  };
  const small: React.CSSProperties = { color: tk.text.faint, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  return (
    <>
      {f.row('Points', (
        <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ids.length === 0 && <span style={small}>No points yet: add nulls, or use your fingertips.</span>}
          {ids.map((id, i) => {
            const n = byId.get(id);
            const ok = n?.kind === 'null';
            return (
              <div key={`${id}:${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, padding: '2px 2px 2px 8px', borderRadius: radius.md, background: tk.bg.field }}>
                <span style={{ width: 16, flexShrink: 0, color: tk.text.faint, font: `600 10.5px ${fontFamily.mono}` }}>{i + 1}</span>
                {ok && <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: (n as NullLayer).color }} />}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: ok ? tk.text.primary : tk.status.danger, font: `500 12px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ok ? n!.label : 'Missing null'}</span>
                  {ok && <span style={small}>{nullFollows(n as NullLayer, ctx.layers)}</span>}
                </div>
                <IconButton icon="chevU" size="sm" label={`Move point ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon="chevD" size="sm" label={`Move point ${i + 1} later`} disabled={i === ids.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon="close" size="sm" tone="danger" label={`Remove point ${i + 1} (the null stays)`} onClick={() => setIds(ids.filter((_, k) => k !== i))} />
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select ariaLabel="Add a null as a point" value="" height={26} style={{ flex: 1, minWidth: 120 }}
              options={[{ value: '', label: free.length ? 'Add a null…' : 'Add a point…' }, ...free.map(n => ({ value: n.id, label: n.label })), { value: '__new', label: '+ New null' }]}
              onChange={v => { if (v === '__new') newNull(); else if (v) setIds([...ids, v]); }} />
            <Button size="sm" icon="hand" onClick={fingertips}>Fingertips</Button>
          </div>
        </div>
      ), 'The nulls that are its corners, in order. Put them on your fingertips (a null that Follows a hand), the mouse, or drag them. Fingertips uses both hands\' thumb and index tips (adding the nulls that are missing). Removing a point keeps its null.')}
      {f.seg('Style', 'pathStyle', [
        { value: 'fill', label: 'Fill', title: 'A polygon through the points' }, { value: 'smooth', label: 'Smooth', title: 'A closed curve through the points' },
        { value: 'circle', label: 'Circle', title: 'A circle their spread sets' }, { value: 'lines', label: 'Lines', title: 'A line through them in order, left open' },
        { value: 'web', label: 'Web', title: 'Every pair of points joined' },
      ], 'Fill joins the points into a polygon; Smooth draws a round curve through them; Circle grows and shrinks with how far apart they are; Lines is a string through them in order; Web joins every pair. Lines and webs are drawn with the Outline.')}
      {(style === 'fill' || style === 'smooth') && f.toggle('Hull', 'hull', 'Wrap round the outside', 'Go round the outermost points, so fingers that cross never twist it into a bow-tie. Off: the points in list order.')}
      {style === 'circle' && f.seg('Centre', 'circleMode', [
        { value: 'spread', label: 'Middle', title: 'Centred between the points; radius: how far they are from the middle on average' },
        { value: 'first', label: 'First point', title: 'Centred on the first point; the others set the radius (with two, the second one)' },
      ], 'Middle: centred between the points, sized by how spread they are. First point: centred on point 1, and the distance to the others is the radius: pinch to shrink it.')}
      {style === 'web' && f.prop('webReach')}
      {f.seg('Hand lost', 'onLost', [
        { value: 'drop', label: 'Drop', title: 'Leave that corner out until the hand is back' },
        { value: 'hold', label: 'Hold', title: 'Keep the corner where the hand was last seen' },
        { value: 'fade', label: 'Fade', title: 'Fade the whole shape out until the hand is back' },
      ], 'When a hand a point follows leaves the picture (while hand tracking runs): drop its corners (four become a triangle, then a line), hold them where they were, or fade the whole shape out until it is back.')}
    </>
  );
}

// ── Audio, glyphs, contours, lens, brush, bodies ─────────────────────────────

export function AudioEditor({ f }: { f: FieldKit }) {
  const style = f.get<string>('style');
  return (
    <>
      <Section kind="audio" title="Sound" primary>
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
      <Section kind="glyphs" title="Grid" primary summary={style}>
        {f.seg('Style', 'style', [
          { value: 'ascii', label: 'ASCII' }, { value: 'dots', label: 'Dots', title: 'Halftone' }, { value: 'squares', label: 'Squares' },
          { value: 'lines', label: 'Lines', title: 'Angle by brightness' }, { value: 'cross', label: 'Cross' },
        ], 'The picture redrawn on a grid: characters picked by brightness, or dots, squares, lines and crosses sized by it.')}
        {style === 'ascii' && f.row('Characters', <Field value={f.get<string>('chars')} onChange={e => f.set({ chars: e.target.value })} height={26} mono style={{ flex: 1, minWidth: 0 }} />, 'From dark to bright. A space leaves the darkest cells empty. Emoji work too: 🌑🌒🌓🌔🌕.')}
        {style === 'ascii' && f.row('Sets', <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{GY_SETS.map(g => <Button key={g.name} size="sm" variant={f.get<string>('chars') === g.chars ? 'primary' : 'secondary'} title={g.chars} onClick={() => f.set({ chars: g.chars })}>{g.name}</Button>)}</div>, 'Ready-made ramps (the Finish stack’s ASCII effect has the same ones).')}
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
      <Section kind="contours" title="Lines" primary>
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
      <Section kind="lens" title="Lens" primary summary={f.get<string>('effect')}>
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
      <Section kind="brush" title="Brush" primary summary={f.get<string>('paint')}>
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
      <Section kind="bodies" title="Bodies" primary summary={source}>
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

/** Cloner: copies of a layer, arranged, varied by index, shaped by effectors. */
export function ClonerEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const g = f.get;
  const arrange = g<string>('arrange');
  const sources = ctx.layers.filter(x => x.id !== f.l.id && (x.kind === 'shape' || x.kind === 'text' || x.kind === 'image' || x.kind === 'camera' || x.kind === 'video' || x.kind === 'null' || x.kind === 'script'));
  const brushes = ctx.layers.filter(x => x.kind === 'brush');
  const particles = ctx.layers.filter(x => x.kind === 'particles' || x.kind === 'agents');
  const effectorLayers = ctx.layers.filter(x => x.id !== f.l.id && (x.kind === 'null' || x.kind === 'shape'));
  const chosen = g<string[]>('effectors') ?? [];
  const toggleEffector = (id: string) => f.set({ effectors: chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id] });
  const chip = (x: { id: string; label: string; kind: string }) => {
    const on = chosen.includes(x.id);
    return (
      <button key={x.id} type="button" onClick={() => toggleEffector(x.id)} title={on ? `${x.label} shapes the copies. Click to stop.` : `Let ${x.label} shape the copies near it.`}
        style={{ height: 24, padding: '0 9px', borderRadius: 7, border: 0, cursor: 'pointer', background: on ? f.tk.bg.selected : f.tk.bg.field, color: on ? f.tk.accent.text : f.tk.text.secondary, boxShadow: `inset 0 0 0 1px ${on ? f.tk.accent.base : f.tk.border.default}`, font: `500 11.5px Inter, system-ui, sans-serif` }}>
        {x.kind === 'null' ? '◦ ' : '▢ '}{x.label}
      </button>
    );
  };
  return (
    <>
      <Section kind="cloner" title="Source" primary>
        {f.pick('Copies of', 'sourceId', sources, 'Add a Shape, Text, Image, Null or Script layer first', 'The layer that is copied. It keeps its own settings; the copies take its look and add their own place, size, turn and fade. A Script layer (or a kind you saved) is copied whole, centred on the middle of the picture.')}
        {f.toggle('Original', 'hideSource', 'Hide the original, draw the copies only')}
      </Section>
      <Section kind="cloner" title="Arrangement">
        {f.seg('Arrange', 'arrange', [
          { value: 'grid', label: 'Grid' }, { value: 'ring', label: 'Ring' }, { value: 'line', label: 'Line' },
          { value: 'path', label: 'Path', title: 'Along a Brush layer\'s stroke' }, { value: 'points', label: 'Points', title: 'One copy per particle of a Particles layer (or agent of an Agents layer)' },
        ], 'Grid: columns and rows around the centre. Ring: around a circle, or an arc. Line: from the start to the end. Path: along a brush stroke. Points: on a particles layer\'s particles or an Agents layer\'s agents.')}
        {arrange === 'grid' && f.props('cols', 'rows', 'x', 'y', 'spacingX', 'spacingY')}
        {arrange === 'ring' && <>{f.props('count', 'x', 'y', 'radius', 'startAngle', 'sweep')}{f.toggle('Face', 'face', 'Turn each copy to face along the ring')}</>}
        {arrange === 'line' && f.props('count', 'x', 'y', 'x2', 'y2')}
        {arrange === 'path' && <>{f.pick('Stroke', 'pathId', brushes, 'Add a Brush layer and paint a stroke', 'The brush layer whose stroke the copies follow.')}{f.props('count', 'spread')}{f.toggle('Face', 'face', 'Turn each copy to face along the stroke')}</>}
        {arrange === 'points' && <>{f.pick('Particles', 'pathId', particles, 'Add a Particles layer', 'One copy sits on each of this layer\'s particles (up to 400).')}</>}
        {f.props('jitter', 'seed')}
      </Section>
      <Section kind="cloner" title="Every copy">
        {f.props('scale', 'rotation', 'opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
      <Section kind="cloner" title="By index" hint="Copy i gets the base plus the step times i, so a staircase, a fan, a spiral or a gradient of colour comes from one number each.">
        {f.props('stepX', 'stepY', 'stepScale', 'stepRotation', 'stepOpacity', 'stepHue')}
      </Section>
      <Section kind="cloner" title="Random" hint="Seeded, so the same seed always gives the same pattern; the Seed slider steps through patterns.">
        {f.props('randScale', 'randRotation', 'randOpacity', 'randHue')}
      </Section>
      <Section kind="cloner" title="Effectors" hint="Nulls and shapes that change the copies near them. A null that follows the mouse makes the copies react to it; several add up.">
        {effectorLayers.length
          ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '2px 0 6px 68px' }}>{effectorLayers.map(chip)}</div>
          : f.note('Add a Null or Shape layer to use as an effector.')}
        {chosen.length > 0 && <>
          {f.props('effRadius', 'effSoftness', 'effPush', 'effScale', 'effRotate', 'effOpacity', 'effHue', 'effHide')}
          {f.toggle('Outside', 'effInvert', 'Act on the copies outside the falloff instead')}
          {f.note('Every slider here can be a control: right-click one, or press +, to drive it from a null, the beat or a knob.')}
        </>}
      </Section>
    </>
  );
}

// ── Script ─────────────────────────────────────────────────────────────────

/**
 * A sketch in JavaScript. The card keeps to a glimpse of draw(), the sketch's
 * files and its status; the code lives in the Sketch editor (ScriptModal),
 * with its tabs, console and controls. Code is applied on Apply or Run (or
 * ⌘/Ctrl+Enter), not per keystroke, so half-typed lines don't flash errors;
 * the kit reports compile and runtime errors back here.
 */
export function ScriptEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as ScriptLayer;
  const kind = kindOf(l, ctx.play.layerKinds);
  // The drafts: sketch.js first, then the other tabs. A kind is one file.
  const [drafts, setDrafts] = useState<ScriptFile[]>(() => layerFiles(l));
  const [applyError, setApplyError] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'restyle' | null>(null);
  const [kindMenu, setKindMenu] = useState<{ x: number; y: number } | null>(null);
  const installed = useInstalledKinds();
  const mode = useThemeMode();
  // Another layer selected, or the code changed from outside (undo, a loaded file, the kind edited from another layer): show that code.
  const appliedKey = `${l.id}\u0000${l.code}\u0000${JSON.stringify(l.files ?? [])}`;
  const [seen, setSeen] = useState(appliedKey);
  if (seen !== appliedKey) { setSeen(appliedKey); setDrafts(layerFiles(l)); setApplyError(null); }
  const runError = useScriptStatus(l.id);
  const files = layerFiles(l);

  const apply = (next: readonly ScriptFile[], opts?: ApplyOptions): boolean => {
    const r = scriptPatch(l, kind ? next.slice(0, 1) : next, opts);
    if (!r.ok) { setApplyError(r.error); return false; }
    setApplyError(null);
    if (!kind) { f.set(r.patch); return true; }
    const code = next[0]?.code ?? '';
    // Editing the kind: every layer of it gets the code; this layer also takes the values the edit asked for.
    ctx.changePlay(p => {
      const out = editKind(p, kind.id, code, r.defs, opts?.settings?.mode).play;
      return { ...out, layers: out.layers.map(x => (x.id === l.id ? { ...x, ...r.patch } as PlayLayer : x)) };
    });
    if (layerKindRegistry.get(kind.id)) layerKindRegistry.register({ ...kind, mode: opts?.settings?.mode ?? kind.mode, code, paramDefs: r.defs, version: kind.version + 1 }, 'saved');
    return true;
  };

  // ── Layer kinds ───────────────────────────────────────────────────────────
  const saveAsKind = (look: KindLook) => {
    // A kind is one file: the other tabs go in front of sketch.js, each under its name.
    const one = drafts.length > 1 ? [...drafts.slice(1), drafts[0]].map(x => `// ── ${x.name} ──\n${x.code.replace(/\s+$/, '')}`).join('\n\n') + '\n' : drafts[0].code;
    const r = scriptPatch(l, [{ name: SCRIPT_MAIN_FILE, code: one }]);
    if (!r.ok) { setApplyError(r.error); toast.error('Fix the sketch first', { message: r.error }); return; }
    const id = newLayerKindId(look.name);
    const withDraft = (p: PlayRecord): PlayRecord => ({ ...p, layers: p.layers.map(x => (x.id === l.id ? { ...x, ...r.patch } as PlayLayer : x)) });
    const made = saveLayerAsKind(withDraft(ctx.play), l.id, look, id).kind;
    ctx.changePlay(p => saveLayerAsKind(withDraft(p), l.id, look, id).play);
    if (made) layerKindRegistry.register(made, 'saved');
    toast.success(`Saved “${look.name.trim()}” as a layer kind`, { message: `It is in Add layer, here and in your other files. Edit the kind to change every layer made from it.${drafts.length > 1 ? ' Its files were joined into one.' : ''}` });
  };
  const restyle = (look: KindLook) => { if (kind) applyKindLook(kind, true, look, ctx.changePlay); };
  const editThisLayerOnly = () => {
    const others = kind ? kindUses(ctx.play, kind.id) - 1 : 0;
    ctx.changePlay(p => detachLayer(p, l.id));
    toast.info(`“${l.label}” has its own code now`, { message: `It is a plain Script layer${others ? `; the other ${kind?.name} layers are unchanged` : ''}. Undo makes it one of the kind again.` });
    setBig(true);
  };
  const removeFromFile = () => { if (kind) void removeKindFromFile(ctx.play, kind, ctx.changePlay); };

  // ── 2D or 3D ──────────────────────────────────────────────────────────────
  const sketchMode: ScriptMode = l.mode === '3d' ? '3d' : '2d';
  const setSketchMode = (m: ScriptMode) => {
    if (m === sketchMode) return;
    // An untouched starter swaps for the other mode's starter; your own code stays (a 2D helper then says it needs 2D).
    const starter = l.code === (sketchMode === '3d' ? DEFAULT_SCRIPT_3D : DEFAULT_SCRIPT) && !l.files?.length && sameFiles(drafts, files);
    const next: Record<string, unknown> = !starter ? { mode: m } : m === '3d' ? script3dDefaults()
      : { mode: '2d', code: DEFAULT_SCRIPT, paramDefs: DEFAULT_SCRIPT_PARAMS.map(d => ({ ...d })), ...Object.fromEntries(DEFAULT_SCRIPT_PARAMS.map(d => [`p_${d.key}`, d.value])) };
    // A layer still called “Script 2” or “3D Script 2” follows the switch.
    const named = /^(?:3D )?Script (\d+)$/.exec(l.label);
    if (named) next.label = `${m === '3d' ? '3D Script' : 'Script'} ${named[1]}`;
    if (!kind) { f.set(next); return; }
    const code = (next.code as string | undefined) ?? l.code, defs = (next.paramDefs as ScriptParamDef[] | undefined) ?? l.paramDefs;
    ctx.changePlay(p => editKind(p, kind.id, code, defs, m).play);
    if (layerKindRegistry.get(kind.id)) layerKindRegistry.register({ ...kind, mode: m, code, paramDefs: defs, version: kind.version + 1 }, 'saved');
  };
  const modeRow = f.row('Mode', <Segmented size="sm" ariaLabel="Draw in 2D or 3D" value={sketchMode} onChange={setSketchMode} options={[{ value: '2d', label: '2D canvas' }, { value: '3d', label: '3D (WebGL)' }]} />,
    kind ? `Changes every ${kind.name} layer. 2D draws on a canvas (s.ctx); 3D draws shapes, lights and a camera with WebGL (three.js).` : '2D draws on a canvas (s.ctx). 3D draws shapes, lights and a camera with WebGL (three.js), still over the picture. The untouched starter swaps for the other one.');

  // ── An imported p5 sketch in place of this one ────────────────────────────
  const importInto = (r: P5ImportResult) => {
    setImporting(false);
    try {
      const next = replaceWithP5(l, r.patch, r.startAt);
      ctx.changePlay(p => ({ ...p, layers: p.layers.map(x => (x.id === l.id ? next : x)) }));
      toast.success(`Imported “${r.title}”`, { message: `${1 + (next.files?.length ?? 0)} file${next.files?.length ? 's' : ''}, ${next.paramDefs.length} control${next.paramDefs.length === 1 ? '' : 's'}. Undo brings the old sketch back.` });
    } catch (e) { toast.error('The sketch does not compile', { message: (e as Error)?.message ?? String(e) }); }
  };

  const error = applyError ? `Compile: ${applyError}` : runError;
  const defs: ScriptParamDef[] = l.paramDefs ?? [];
  const kindColour = kind ? accentColor(kind.colour, mode) : f.tk.accent.base;
  const uses = kind ? kindUses(ctx.play, kind.id) : 0;
  const inList = kind ? installed.some(k => k.def.id === kind.id) : false;
  const takenNames = [...(ctx.play.layerKinds ?? []), ...installed.map(k => k.def)].filter(k => k.id !== kind?.id).map(k => k.name);
  const dirty = !sameFiles(drafts, kind ? files.slice(0, 1) : files) && !(kind && sameFiles(drafts.slice(0, 1), files.slice(0, 1)));

  const canvas = (
    <Section kind="script" title="Canvas">
      {modeRow}
      {!l.p5 && f.toggle('Clear', 'clear', 'Clear the canvas every frame', 'Off keeps what was drawn, for trails; the script can fade it itself.')}
      {l.p5 && f.note('A p5 sketch keeps what it drew between frames, as p5 does, on a canvas of its own fitted into the picture.')}
      {f.toggle('Picture', 'readPicture', 'Let the script read the picture’s brightness', 'Samples the shader at low resolution each frame for s.picture.brightness(x, y).')}
      {f.props('opacity')}
      {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
    </Section>
  );
  const modal = big && (
    <ScriptModal
      l={l} f={f} act={ctx.act} layers={ctx.layers as ReadonlyArray<{ id: string; kind: string; label: string; code?: string }>}
      drafts={kind ? drafts.slice(0, 1) : drafts} setDrafts={setDrafts} apply={apply} applyError={applyError} runError={runError}
      kind={kind ? { name: kind.name, icon: kind.icon, colour: kindColour, uses } : undefined}
      onSaveAsKind={kind ? undefined : () => setDialog('save')}
      onImport={kind ? undefined : () => setImporting(true)}
      mode={sketchMode} onMode={setSketchMode}
      onClose={() => setBig(false)}
    />
  );
  const dialogs = (
    <>
      {dialog === 'save' && (
        <KindDialog title="Save as a layer kind" confirmLabel="Save kind" controls={extractCount(drafts, defs.length)} taken={takenNames}
          initial={{ name: l.label.replace(/\s+\d+$/, '') || 'Sketch', hint: '', icon: sketchMode === '3d' ? 'cube' : 'code', colour: 'mauve' }}
          onDone={look => { setDialog(null); if (look) saveAsKind(look); }} />
      )}
      {dialog === 'restyle' && kind && (
        <KindDialog title={`Change “${kind.name}”`} confirmLabel="Save" controls={defs.length} uses={uses} taken={takenNames}
          initial={{ name: kind.name, hint: kind.hint, icon: kind.icon, colour: kind.colour }}
          onDone={look => { setDialog(null); if (look) restyle(look); }} />
      )}
      {importing && (
        <P5ImportDialog title="Import p5.js sketch into this layer" createLabel="Replace this sketch" note="The layer takes the imported sketch, its files and its controls; undo brings this one back."
          onCreate={importInto} onClose={() => setImporting(false)} />
      )}
    </>
  );

  if (kind) {
    return (
      <>
        <Section kind="script" title="Kind" primary hint="This layer is made from a sketch saved as a layer kind. Its controls are its properties; the code belongs to the kind.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px 8px 10px', borderRadius: radius.md, background: f.tk.bg.field, marginTop: 4 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(kindColour, 0.14), color: kindColour }}>
              <Icon name={kind.icon} size={16} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <b style={{ font: `650 12.5px ${fontFamily.ui}`, color: f.tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kind.name}</b>
              <span style={{ fontSize: 11, color: f.tk.text.muted }}>{`Layer kind · ${uses} layer${uses === 1 ? '' : 's'} in this file`}</span>
            </span>
            <IconButton icon="more" size="sm" label="Name, icon and colour; your list; remove" tooltip={false} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setKindMenu({ x: r.right - 260, y: r.bottom + 4 }); }} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <Button size="sm" variant="primary" icon="popout" onClick={() => setBig(true)} title={`Open the code of ${kind.name}: what you apply changes all ${uses} of its layers`}>Edit the kind</Button>
            <Button size="sm" icon="edit" onClick={editThisLayerOnly} title="Give this layer its own copy of the code, as a plain Script layer, and open it">Edit this layer only</Button>
          </div>
          {f.note(<><b>Edit the kind</b> changes the code of every {kind.name} layer ({uses}). <b>Edit this layer only</b> turns this one into a plain Script layer with its own copy; the others stay as they are.</>)}
          {error && <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.4, color: f.tk.status.danger }}>{error}</div>}
          {kindMenu && <Menu x={kindMenu.x} y={kindMenu.y} minWidth={260} onClose={() => setKindMenu(null)} items={[
            { label: 'Name, icon and colour…', icon: 'edit', onSelect: () => setDialog('restyle') },
            inList
              ? { label: 'Remove from your list', icon: 'minus', hint: 'Your other files stop offering it in Add layer. This file keeps it.', onSelect: () => { void removeKindFromList(kind, true); } }
              : { label: 'Add to your list', icon: 'plus', hint: 'Offer it in Add layer in your other files too.', onSelect: () => addKindToList(kind) },
            'separator',
            { label: 'Remove from this file…', icon: 'trash', danger: true, onSelect: removeFromFile },
          ]} />}
        </Section>
        <Section kind="script" title="Properties" hint="The sliders, toggles and buttons the kind declares. Each layer of the kind has its own values. Right-click a slider to make it a Play control or drive it with a null.">
          {defs.length ? <ScriptControls f={f} l={l} act={ctx.act} /> : f.note('This kind declares no controls. Edit the kind and add a params object, or turn a variable into a slider.')}
        </Section>
        {canvas}
        {modal}
        {dialogs}
      </>
    );
  }

  return (
    <>
      <Section kind="script" title="Code" primary hint={sketchMode === '3d' ? 'A 3D sketch: setup(s) runs once, draw(s) every frame, drawing with WebGL over the picture. The Sketch editor has the code, its files, the console, the reference and patterns.' : 'A sketch: setup(s) runs once, draw(s) every frame, on a canvas over the picture. p5.js sketches run too. The Sketch editor has the code, its files, the console, the reference and patterns.'}>
        <DrawGlimpse files={files} onOpen={() => setBig(true)} error={!!error} />
        <FileChips files={files} />
        <ScriptStatusLine layerId={l.id} error={error} running={dirty ? 'Edited in the Sketch editor: Apply there to run it.' : `Running${l.p5 ? ' (p5.js)' : ''} · ${defs.length} control${defs.length === 1 ? '' : 's'}`} />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <Button size="sm" variant="primary" icon="popout" onClick={() => setBig(true)} title="The Sketch editor: the code and its files, the console, the reference, patterns and a scratch run">Open in sketch editor</Button>
          <Button size="sm" icon="import" onClick={() => setImporting(true)} title="Bring in a p5.js sketch: paste it, or open its files, a folder or a .zip">Import p5.js…</Button>
          <Button size="sm" variant="ghost" icon="save" onClick={() => setDialog('save')} title="Save this sketch as a layer kind of its own: it joins Add layer with its own name, icon and colour, and its controls become the layer's properties">Save as kind</Button>
        </div>
      </Section>
      {defs.length > 0 && (
        <Section kind="script" title="Controls" hint="Declared by the script. Sliders and toggles: right-click one to make it a Play control or drive it with a null. Buttons: + puts them on the Play panel, where a key, a click, a beat or a note can press them.">
          <ScriptControls f={f} l={l} act={ctx.act} />
        </Section>
      )}
      {canvas}
      {modal}
      {dialogs}
    </>
  );
}

/** How many controls the drafts declare (the applied count when they do not compile). */
function extractCount(files: readonly ScriptFile[], fallback: number): number {
  const r = extractScriptParams(files[0]?.code ?? '', files.slice(1));
  return r.ok ? r.defs.length : fallback;
}

// ── Relationship ─────────────────────────────────────────────────────────────

const RELATION_WALLS: Choice[] = [
  { value: 'bounce', label: 'Bounce', title: 'Rebounds off the edge (Bounciness says how much)' },
  { value: 'repel', label: 'Repel', title: 'A soft boundary a little inside the edge pushes it back' },
  { value: 'wrap', label: 'Wrap', title: 'Leaves one side and comes in from the other' },
  { value: 'respawn', label: 'Respawn', title: 'Leaving the picture puts it somewhere new at once' },
  { value: 'escape', label: 'Escape', title: 'May leave the picture; comes back after the delay. Escaped prey is out of sight' },
];
const PICTURE_MODES: Choice[] = [{ value: 'off', label: 'Off' }, { value: 'climb', label: 'Climb', title: 'Moves toward higher values' }, { value: 'descend', label: 'Descend', title: 'Moves away from higher values' }];
const PICTURE_CHANNELS: Choice[] = [
  { value: 'brightness', label: 'Brightness' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' },
  { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' }, { value: 'layer', label: 'A layer’s alpha' },
];

/** Relationship: members (layers with a position) moved by a force between them, and by the picture under them. */
export function RelationshipEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as RelationshipLayer;
  const relation = l.relation;
  const chase = relation === 'chase';
  // Anything with a place of its own; another relationship counts (its centroid), unless it holds this one.
  const holdsMe = (x: PlayLayer) => x.kind === 'relationship' && x.members.some(m => m.id === l.id);
  const candidates = ctx.layers.filter(x => x.id !== l.id && RELATION_MEMBER_KINDS.includes(x.kind) && !(x.kind === 'shape' && (x.shape === 'path' || x.shape === 'picture' || x.shape === 'layer')) && !holdsMe(x));
  const members = l.members;
  const full = members.length >= RELATION_MAX_MEMBERS;
  const setMembers = (next: RelationMember[]) => f.set({ members: next });
  const toggle = (id: string) => {
    if (members.some(m => m.id === id)) setMembers(members.filter(m => m.id !== id));
    else if (!full) setMembers([...members, newRelationMember(id, chase ? (members.some(m => m.role === 'chaser') ? 'prey' : 'chaser') : 'member')]);
  };
  const change = (id: string, patch: Partial<RelationMember>) => setMembers(members.map(m => (m.id === id ? { ...m, ...patch } : m)));
  const chip = (x: PlayLayer) => {
    const on = members.some(m => m.id === x.id);
    return (
      <button key={x.id} type="button" onClick={() => toggle(x.id)} disabled={!on && full} title={on ? `${x.label} is a member. Click to take it out.` : full ? `A relationship holds ${RELATION_MAX_MEMBERS} members at most.` : `Make ${x.label} a member.`}
        style={{ height: 24, padding: '0 9px', borderRadius: 7, border: 0, cursor: !on && full ? 'default' : 'pointer', opacity: !on && full ? 0.5 : 1, background: on ? f.tk.bg.selected : f.tk.bg.field, color: on ? f.tk.accent.text : f.tk.text.secondary, boxShadow: `inset 0 0 0 1px ${on ? f.tk.accent.base : f.tk.border.default}`, font: `500 11.5px Inter, system-ui, sans-serif` }}>
        {x.kind === 'null' ? '◦ ' : x.kind === 'relationship' ? '⋈ ' : '▢ '}{x.label}
      </button>
    );
  };
  const signals = ctx.play.signals ?? [];
  const alphaLayers = ctx.layers.filter(x => x.id !== l.id && x.kind !== 'relationship' && x.kind !== 'null' && x.kind !== 'drumpad');
  const small: React.CSSProperties = { ...f.numStyle, width: 50 };
  const faint: React.CSSProperties = { color: f.tk.text.faint, font: '11px Inter, system-ui, sans-serif' };
  const sections = [
    { id: 'rel-members', label: 'Members' },
    { id: 'rel-relationship', label: 'Relationship' },
    { id: 'rel-motion', label: 'Motion' },
    { id: 'rel-walls', label: 'Walls' },
    ...(chase ? [{ id: 'rel-catch', label: 'Catch' }] : []),
    { id: 'rel-debug', label: 'Debug' },
  ];
  return (
    <BigEditorScaffold kind="relationship" sections={sections}>
      <Section id="rel-members" kind="relationship" title="Members" primary summary={members.length ? `${members.length} member${members.length === 1 ? '' : 's'}` : 'None yet'} hint={`Layers with a position: nulls, shapes, text, images, video, the camera… and other relationships (each stands at its members’ centre and moves as a group). Up to ${RELATION_MAX_MEMBERS}; every pair costs a little, so keep it to what you need. A member’s X and Y are driven from here (drag it on the picture to put it back where you want).`}>
        {candidates.length
          ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '2px 0 6px 68px' }}>{candidates.map(chip)}</div>
          : f.note('Add a Null, Shape, Text or Image layer to make it a member.')}
        {members.map((m, i) => {
          const x = ctx.layers.find(y => y.id === m.id);
          const name = x?.label ?? 'Missing layer';
          return (
            <div key={m.id} style={{ margin: '6px 0 2px 0', padding: '6px 8px', borderRadius: 8, background: f.tk.bg.field }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: f.tk.text.primary, font: `600 11.5px Inter, system-ui, sans-serif`, minWidth: 62 }}>{name}</span>
                {chase && <Segmented ariaLabel={`${name} role`} value={m.role === 'chaser' ? 'chaser' : 'prey'} options={[{ value: 'chaser', label: 'Chaser' }, { value: 'prey', label: 'Prey' }]} onChange={v => change(m.id, { role: v as RelationMember['role'] })} size="sm" />}
                <span style={faint}>Mass</span>
                <NumberInput value={m.mass} min={0.1} max={10} step={0.1} title="Heavier moves less under the same force" onCommit={n => change(m.id, { mass: Math.max(0.1, Math.min(10, n)) })} style={small} />
                <span style={faint}>Picture</span>
                <Segmented ariaLabel={`${name} picture`} value={m.picture} options={PICTURE_MODES} onChange={v => change(m.id, { picture: v as RelationMember['picture'] })} size="sm" />
              </div>
              {m.picture !== 'off' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <Select ariaLabel={`${name} picture channel`} value={m.channel} options={PICTURE_CHANNELS} onChange={v => change(m.id, { channel: v as RelationMember['channel'] })} height={24} />
                  {m.channel === 'layer' && <Select ariaLabel={`${name} reads layer`} value={m.layerId} options={[{ value: '', label: 'Pick a layer' }, ...alphaLayers.map(y => ({ value: y.id, label: y.label }))]} onChange={v => change(m.id, { layerId: v })} height={24} />}
                  <span style={faint}>Looks</span>
                  <NumberInput value={m.radius} min={0.01} max={0.5} step={0.01} title="How far around it looks (picture heights): the gradient over that ring is what it climbs" onCommit={n => change(m.id, { radius: Math.max(0.01, Math.min(0.5, n)) })} style={small} />
                </div>
              )}
              {m.picture !== 'off' && f.prop(relationPictureKey(i), 'Strength')}
            </div>
          );
        })}
        {members.length === 1 && f.note('One member has nothing to relate to: add another.')}
      </Section>
      <Section id="rel-relationship" kind="relationship" title="Relationship" summary={relation}>
        {f.seg('Kind', 'relation', [
          { value: 'chase', label: 'Chase', title: 'Chasers hunt the closest prey in sight; prey flees. A catch sends a signal.' },
          { value: 'repel', label: 'Repel', title: 'Everyone pushes apart when closer than a distance' },
          { value: 'attract', label: 'Attract', title: 'Everyone pulls together: kept apart at a boundary, or gravity-like and orbiting' },
        ], 'Chase: a chaser runs at the closest prey within its sight and wanders when none is; prey runs from a chaser within its flee distance. Repel: members push apart within a distance. Attract: members pull together, either kept a minimum distance apart (a soft boundary) or free to pass through and orbit.')}
        {chase && f.props('speed', 'accel', 'turn', 'sight', 'flee', 'wander')}
        {relation === 'repel' && <>
          {f.props('strength', 'repelDistance')}
          {f.seg('Curve', 'repelCurve', [{ value: 'linear', label: 'Linear', title: 'Fades evenly to nothing at the distance' }, { value: 'inverse', label: 'Inverse square', title: 'Gentle far away, hard when they nearly touch' }])}
        </>}
        {relation === 'attract' && <>
          {f.seg('Mode', 'attractMode', [{ value: 'keep', label: 'Keep a distance', title: 'They can’t cross a boundary: a soft spring there' }, { value: 'overshoot', label: 'Overshoot', title: 'Gravity-like: they pass through each other and orbit' }])}
          {f.props('strength', l.attractMode === 'keep' ? 'minDistance' : 'falloff')}
        </>}
      </Section>
      <Section id="rel-motion" kind="relationship" title="Motion" summary={`spring ${l.springiness.toFixed(2)} · damp ${l.damping.toFixed(2)}`} hint="What keeps the motion looking natural rather than stuck: how stiff the soft contacts are, how much of a bounce is kept, how quickly things slow down, and a speed cap.">
        {f.props('springiness', 'bounciness', 'damping', 'maxSpeed')}
      </Section>
      <Section id="rel-walls" kind="relationship" title="Walls" summary={chase ? `Chasers ${l.wallChaser} · Prey ${l.wallPrey}` : `Members ${l.wallMember}`} hint="What a member does at the picture’s edge, by role. Escape lets it leave: prey out of the picture is out of sight (the chaser wanders) and comes back after the delay, at the far side if Respawn at says so.">
        {chase
          ? <>{f.select('Chasers', 'wallChaser', RELATION_WALLS)}{f.select('Prey', 'wallPrey', RELATION_WALLS)}</>
          : f.select('Members', 'wallMember', RELATION_WALLS)}
        {f.seg('Respawn at', 'respawnAt', [{ value: 'random', label: 'Random' }, { value: 'fixed', label: 'Its own place', title: 'The layer’s own X and Y' }, { value: 'far', label: 'Far side', title: 'The edge farthest from the chasers' }], 'Where a member goes when it respawns: after a catch, at a Respawn wall, or coming back from an escape.')}
        {f.prop('respawnDelay')}
      </Section>
      {chase && (
        <Section id="rel-catch" kind="relationship" title="Catch" summary={`radius ${l.catchRadius.toFixed(2)} · ${l.onCatch}`} hint="A chaser within the catch radius of a prey catches it: the Catch reading pulses, Catches counts up, and the signal (if any) fires. One catch per approach.">
          {f.prop('catchRadius')}
          {f.seg('Then', 'onCatch', [{ value: 'none', label: 'Nothing' }, { value: 'respawn', label: 'Respawn prey' }, { value: 'swap', label: 'Swap roles', title: 'The prey becomes the chaser and the chaser the prey (until the layer runs again)' }])}
          {f.row('Signal', (
            <>
              <Select ariaLabel="Signal on catch" value={l.catchSignal} options={[{ value: '', label: 'None' }, ...signals.map(s => ({ value: s.id, label: s.name }))]} onChange={v => f.set({ catchSignal: v })} height={26} style={{ flex: 1, minWidth: 0 }} />
              <Button size="sm" variant="ghost" onClick={() => ctx.changePlay(p => { const r = addSignal(p); return { ...r.play, layers: r.play.layers.map(x => (x.id === l.id ? { ...x, catchSignal: r.id } : x)) }; })}>New signal</Button>
            </>
          ), 'Sent on every catch. Actions and trigger mappings fire on it: flash the background, burst particles, step the text.')}
        </Section>
      )}
      <Section id="rel-debug" kind="relationship" title="Debug" summary={l.debug ? 'Overlay on' : 'Off'}>
        {f.toggle('Overlay', 'debug', 'Show forces', 'With the guides on: sight and flee radii, a line from each chaser to its target, velocity arrows (white) and the picture’s pull (green). Never in renders or the finished picture.')}
      </Section>
    </BigEditorScaffold>
  );
}
