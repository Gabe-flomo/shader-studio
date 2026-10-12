/**
 * timeCubeExamples.ts — the Time cube examples (docs/time-cube.md). Each
 * uses the built-in Ball action clip (public/media/ball-action.mp4, see
 * lib/builtinVideos.ts), so they need no file of yours: choose your own
 * video on the Time Cube card. Where the video can't be decoded (tests) the
 * painted test clip stands in (lib/timeCube/frames.ts).
 *
 * Every node carries a comment saying what it is and why it's there.
 */
import type { ExampleGraph } from './exampleIndex';
import type { PlayMapping, PlayRecord } from '../types/play';
import type { SubgraphData } from '../types/nodeGraph';
import { colourCtl, ctl, n } from './graphBuilder';

export const TIME_CUBE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play?: true }> = {
  timeCubeBox: {
    label: 'Time cube: a video as a box of time',
    description: 'Every frame of a clip stacked one behind the other into a soft, rounded box with a faint glow. The slice sweeps through time: frames before it are see-through, fading in over the frames just before it, frames after it solid, and the frame at the slice shows crisply. The camera orbits slowly.',
  },
  timeCubeSoftPill: {
    label: 'Time cube: soft pill',
    description: 'The box as a soft pill on white, seen flat (isometric): the crisp frame on its face, pastel sides, a pink rim glow. The video plays on the face while the sides show the edges of every frame smeared through time.',
  },
  timeCubeHighlights: {
    label: 'Time cube: highlighted frames loop',
    description: 'Six frames, twelve apart, picked out with an outline and lifted up out of the box. They travel with the slice and wrap round, so as the scan sweeps they come round again and again.',
  },
  timeCubeFlow: {
    label: 'Time cube: flow',
    description: 'Flow mode: the crisp frame stays put near the front and the video flows through the box past it, wrapping round to the back. Frames lift a little as they pass the frame; four frames of the clip are outlined and ride the flow.',
  },
  timeCubePulse: {
    label: 'Time cube: pulsing key',
    play: true,
    description: 'On black, only the amber of the balls shows, in bands that pulse through the box of time. On Play, turn the key colour round the wheel (a slow LFO already does), widen the tolerance, speed the pulse or turn the camera.',
  },
  timeCubeFlyThrough: {
    label: 'Time cube: fly-through',
    play: true,
    description: 'The camera flies through the box of time: Translate Z, driven by a slow LFO on Play, carries it from in front of the first frame through the frames and out past the slice, drifting sideways a little. On Play, take the camera\'s Distance, Angle, Elevation, Zoom and Translate in hand.',
  },
  timeCubeLongExposure: {
    label: 'Time cube: long exposure',
    description: 'Each stacked frame is the brightest of six frames from its slot of time, like a long exposure: the swirling balls leave trails of light. The frames are then sorted by brightness, darkest first.',
  },
  timeCubeKey: {
    label: 'Time cube: isolate a colour',
    description: 'The same box with a colour key on amber: the amber balls stay solid, trails of colour through time, while the rest of the clip turns to a grey ghost.',
  },
  timeCubeSlitScan: {
    label: 'Slit-scan from a time cube',
    description: 'A flat cut through the box of time, tilted so each column of the picture comes from a different moment: the swirling rings stretch and bend. No 3D needed.',
  },
  timeCubeHall: {
    label: 'Time cube: infinite hall',
    play: true,
    description: 'The box of time repeated across an endless floor, fading into fog. Each copy\'s slice is a little later the further it is from the middle, so the moment ripples outward through the hall. The camera circles slowly.',
  },
  timeCubeTwisted: {
    label: 'Time cube: twisted time',
    description: 'One long box of time whose frames turn along the line of time: the space it sits in is twisted, and the twist breathes back and forth, so the frames wring and unwind while the slice sweeps.',
  },
  timeCubeTrain: {
    label: 'Time cube: time train',
    description: 'A line of boxes going off into the distance, the space they are in rippling in a travelling wave so the line snakes like a train. Each box is a little later in the clip than the one before it.',
  },
  timeCubeSceneSpace: {
    label: 'Time cube: Repeat Scene and 3D warps',
    description: 'The 3D tools on a box of time: a Time Cube Shape inside a Scene Group, twisted by a Twist 3D node and repeated by Repeat Scene, wired into the view\'s Space socket. Each copy is at its own moment and hue.',
  },
};

export const TIME_CUBE_EXAMPLE_KEYS = Object.keys(TIME_CUBE_EXAMPLE_INDEX);

const note = (text: string) => ({ __comment: text });
/** An example's label and description (its index entry's Play flag marks the listing only). */
const meta = (k: string) => ({ label: TIME_CUBE_EXAMPLE_INDEX[k].label, description: TIME_CUBE_EXAMPLE_INDEX[k].description });

const CUBE_NOTE = [
  'Time Cube: stacks the frames of a video into a box of time, one frame behind the next.',
  'This one uses the built-in Ball action clip (10 s of glowing balls swirling into mandala patterns, shipped with the app). Press Choose video on this card to use one of yours from the Library or a file.',
  'Frames and Frame size set how detailed the box is; the card shows how much memory it takes.',
].join('\n');

const OUT_NOTE = note('Output: the picture.');

export function buildTimeCubeExamples(): Record<string, ExampleGraph> {
  const box: ExampleGraph = {
    ...meta('timeCubeBox'),
    counter: 20,
    nodes: [
      n('timeCube', 'tcSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'tcSweep', 80, 420, {
        waveform: 'triangle', freq: 0.07, amplitude: 0.47, offset: 0.5,
        ...note('LFO (triangle): sweeps the slice slowly from near the first frame to near the last and back. 0.5 ± 0.47, one round trip every 14 s.'),
      }),
      n('timeCubeView', 'tcView', 440, 160, {
        rotSpeed: 0.12, camAngle: 0.55, camElevation: 0.35, before: 0.37, timeFeather: 16,
        roundness: 0.4, feather: 0.2, rimStrength: 0.4, rimWidth: 0.09,
        ...note([
          'Time Cube View: draws the box in 3D, marching each ray through it front to back.',
          'Before the slice (Offset), frames are see-through (Before opacity 0.37): you look into the past. After it they are solid, and the box\'s sides show each frame\'s edge pixels smeared through time.',
          'Feather 16: instead of a hard line at the slice, the 16 frames just before it fade from see-through to solid, so the past melts into the present. Set it to 0 for the hard line; Feather side moves the fade to after the slice or centres it.',
          'Shape: Corner roundness 0.4 and Edge softness 0.2 make it a soft, rounded block instead of a hard-edged box; a faint lilac Rim glow traces its silhouette. Outline is off (turn it on in the Outline section for a thin line).',
          'The frame at the slice is drawn crisply. The camera orbits slowly (Orbit speed).',
        ].join('\n')),
      }, { volume: ['tcSource', 'volume'], slice: ['tcSweep', 'value'] }),
      n('output', 'tcOut', 820, 160, OUT_NOTE, { color: ['tcView', 'color'] }),
    ],
  };

  const pill: ExampleGraph = {
    ...meta('timeCubeSoftPill'),
    counter: 20,
    nodes: [
      n('timeCube', 'tpSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('timeCubeView', 'tpView', 440, 160, {
        timeMode: 'flow', framePos: 0.03, flowSpeed: 0.06, before: 0, after: 1,
        roundness: 0.45, feather: 0.14, depth: 1.1,
        rimStrength: 0.55, rimWidth: 0.06, rimColor: [0.93, 0.66, 0.95],
        tintAmount: 0.85, tintFrom: [1, 0.84, 0.6], tintTo: [0.82, 0.95, 0.74], tintAlong: 'diagonal',
        background: [0.985, 0.985, 0.99], shadow: 0.12, shadowSoftness: 0.5, shadowGap: 0.15,
        ortho: 1, camDist: 3, camAngle: 0.5, camElevation: 0.45, rotSpeed: 0,
        ...note([
          'Time Cube View as a soft pill on white, after the soft-box look in product illustrations.',
          'Flow mode: the crisp frame sits at the very front (Frame position 0.03) and the clip flows through the box past it (Flow speed 0.06), so the face plays the video. Before opacity 0 keeps the sliver in front of it clear.',
          'Shape: Corner roundness 0.45, Edge softness 0.14. Glow: Side tint 0.85 washes the sides in a peach-to-mint gradient (the face keeps its own colours), a pink Rim glow, a faint shadow, and a near-white Background.',
          'Camera: Flatten 1 makes it orthographic, like an isometric drawing, held still at Angle 0.5 so the face reads.',
        ].join('\n')),
      }, { volume: ['tpSource', 'volume'] }),
      n('output', 'tpOut', 820, 160, OUT_NOTE, { color: ['tpView', 'color'] }),
    ],
  };

  const highlights: ExampleGraph = {
    ...meta('timeCubeHighlights'),
    counter: 20,
    nodes: [
      n('timeCube', 'thSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'thSweep', 80, 420, {
        waveform: 'sawtooth', freq: 0.05, amplitude: 0.5, offset: 0.5,
        ...note('LFO (sawtooth): runs the slice from the first frame to the last every 20 s, then jumps back. The highlighted frames ride along with it.'),
      }),
      n('timeCubeView', 'thView', 440, 160, {
        before: 0.11, after: 0.26, quality: 'best', depth: 2, camAngle: 0.95, camElevation: 0.32, camDist: 4.2, rotSpeed: 0,
        highlights: true, motion: true, hlCount: 6, hlMode: 'loop', hlStart: 0, hlSpacing: 12, hlThickness: 1.5, hlOpacity: 0.95, hlTint: 0.12, hlColor: [1, 0.78, 0.4], hlEdge: 0.9, hlOthers: 0.4,
        motionAt: 'highlights', motionWidth: 2.5, liftUp: 0.16,
        edgeWidth: 1.2,
        ...note([
          'Time Cube View with Highlight frames and Move frames switched on: Count 6 frames, Spacing 12 frames apart, starting at the slice (Start 0).',
          'Highlights move: "With the slice, looping round": the six frames travel with Offset and wrap round the end of the box, so as the LFO sweeps they keep coming round.',
          'Each highlighted frame is a sheet (Opacity 0.95) with an amber Outline; Others 0.4 thins every other frame so they stand out.',
          'Frame motion: Moves frames near the highlighted frames, Lift 0.16 frame heights over a Falloff of 2.5 frames, so each one rises out of the box. Quality Best gives the lifted frames enough steps.',
        ].join('\n')),
      }, { volume: ['thSource', 'volume'], slice: ['thSweep', 'value'] }),
      n('output', 'thOut', 820, 160, OUT_NOTE, { color: ['thView', 'color'] }),
    ],
  };

  const flow: ExampleGraph = {
    ...meta('timeCubeFlow'),
    counter: 20,
    nodes: [
      n('timeCube', 'tfSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('timeCubeView', 'tfView', 440, 160, {
        timeMode: 'flow', framePos: 0.22, flowSpeed: 0.05, before: 0.16, after: 0.55, depth: 2.2,
        highlights: true, motion: true, hlCount: 4, hlSpacing: 32, hlThickness: 1, hlOpacity: 0.6, hlTint: 0.1, hlEdge: 0.8, hlColor: [0.55, 0.85, 1],
        motionAt: 'slice', motionWidth: 6, liftUp: 0.12,
        camAngle: 0.75, camElevation: 0.3, camDist: 4.4,
        ...note([
          'Time Cube View in Flow mode: the crisp frame stays at Frame position 0.22 and the video flows through the box past it at 0.05 clip lengths a second (a whole pass every 20 s), wrapping from the front round to the back.',
          'Before opacity 0.16 (the frames that have already gone past the frame, in front) and After opacity 0.55 (the ones still to come, behind) are measured from the frame.',
          'Frame motion (Move frames on): frames lift (0.12 frame heights) as they pass through the frame, easing over 6 frames either side.',
          'Highlights (Highlight frames on): four frames of the clip, 32 apart, outlined in blue. In Flow they belong to the clip, so they ride the flow through the box. Wire an LFO or a Play control into Flow time (and set Flow speed 0) to drive the flow yourself.',
        ].join('\n')),
      }, { volume: ['tfSource', 'volume'] }),
      n('output', 'tfOut', 820, 160, OUT_NOTE, { color: ['tfView', 'color'] }),
    ],
  };

  const pulseMappings: PlayMapping[] = [
    { id: 'm1', controlId: 'hue', source: { kind: 'lfo', shape: 'sine', rate: 0.03, phase: 0 }, outMin: -0.03, outMax: 0.03, curve: 'linear', smoothMs: 0, enabled: true },
  ];
  const pulsePlay: PlayRecord = {
    version: 1,
    controls: [
      colourCtl('key', 'tuView::keyColor', 'Key colour'),
      ctl('hue', 'tuView::keyHueShift', 'Key hue shift', -1, 1, 0.005),
      ctl('drift', 'tuView::keyHueDrift', 'Key hue drift', -0.5, 0.5, 0.005),
      ctl('tol', 'tuView::keyTolerance', 'Hue range (tolerance)', 0, 0.5, 0.005),
      ctl('pspeed', 'tuView::pulseSpeed', 'Pulse speed', -2, 2, 0.01),
      ctl('pwidth', 'tuView::pulseWidth', 'Pulse width', 0.02, 1, 0.01),
      ctl('psoft', 'tuView::pulseSoftness', 'Pulse softness', 0, 1, 0.01),
      ctl('ang', 'tuView::camAngle', 'Camera angle', -3.14, 3.14, 0.01),
    ],
    mappings: pulseMappings,
    layers: [],
    notes: `**What it shows.** A Time Cube View keyed on one colour, on black: only the keyed colour shows, and only in **pulses** travelling through the box of time. The crisp frame is the slice.

**Try.** **Key hue shift** turns the key colour round the colour wheel: a slow LFO already rocks it a little either side of red, inside the hue range, so the amber rings stay keyed while their shade shifts. Drag it further (or map a MIDI knob to it) to key the cyan balls or the red specks instead. **Key hue drift** keeps it turning on its own. **Hue range** widens what counts as the colour. **Pulse speed**, **Pulse width** and **Pulse softness** shape the travelling bands; **Camera angle** turns the view round the box. Every one is a live uniform, so mapping them to LFOs or MIDI costs nothing.`,
  };

  const pulse: ExampleGraph = {
    ...meta('timeCubePulse'),
    counter: 20,
    nodes: [
      n('timeCube', 'tuSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('timeCubeView', 'tuView', 440, 160, {
        slice: 0.82, before: 0.37, after: 0.45, sliceOpacity: 1, depth: 2.2, quality: 'best',
        keyMode: 'hue', keyColor: [1, 0.55, 0.12], keyTolerance: 0.1, keySoftness: 0.05, keyOpacity: 1, othersOpacity: 0, othersGrey: 1,
        keyAnimate: true, pulse: 1, pulseDir: 'forward', pulseSpeed: 0.35, pulseCount: 4, pulseWidth: 0.3, pulseSoftness: 0.6,
        background: [0, 0, 0], rimStrength: 0.18, rimWidth: 0.03, rimColor: [0.35, 0.45, 0.7], roundness: 0.15, feather: 0.06,
        camAngle: 0.95, camElevation: 0.5, camDist: 4.6, rotSpeed: 0,
        ...note([
          'Time Cube View keyed on amber (Key: a hue), on black. Others 0 hides everything that isn\'t amber, so only the amber balls show, and the slice frame (Offset 0.82) stays vivid.',
          'Pulse 1: the amber shows only in four bands (Pulse count) that travel from the first frame to the last (Pulse speed 0.35 bands a second, width 0.3, soft edges).',
          'A faint blue Rim glow marks the box\'s edge in the dark. The camera holds still at Angle 0.95; turn it from Play. On Play the key colour, hue shift and drift, tolerance, pulse and camera angle are on the panel; an LFO rocks the hue shift.',
        ].join('\n')),
      }, { volume: ['tuSource', 'volume'] }),
      n('output', 'tuOut', 820, 160, OUT_NOTE, { color: ['tuView', 'color'] }),
    ],
    play: pulsePlay,
  };

  // The fly-through: Translate Z (and a little X) driven by LFOs on Play. Translate has no input
  // socket; a Play mapping writes its uniform, so the flight costs no recompile.
  const flyMappings: PlayMapping[] = [
    { id: 'm1', controlId: 'tz', source: { kind: 'lfo', shape: 'sine', rate: 0.04, phase: 0 }, outMin: -3, outMax: 0.9, curve: 'linear', smoothMs: 0, enabled: true },
    { id: 'm2', controlId: 'tx', source: { kind: 'lfo', shape: 'sine', rate: 0.07, phase: 0.25 }, outMin: -0.35, outMax: 0.35, curve: 'linear', smoothMs: 0, enabled: true },
  ];
  const flyPlay: PlayRecord = {
    version: 1,
    controls: [
      ctl('tz', 'tfyView::camZ', 'Translate Z (through time)', -4, 2, 0.01),
      ctl('tx', 'tfyView::camX', 'Translate X', -2, 2, 0.01),
      ctl('ty', 'tfyView::camY', 'Translate Y', -2, 2, 0.01),
      ctl('dist', 'tfyView::camDist', 'Distance', 0.5, 8, 0.01),
      ctl('ang', 'tfyView::camAngle', 'Angle', -3.14, 3.14, 0.01),
      ctl('elev', 'tfyView::camElevation', 'Elevation', -1.5, 1.5, 0.01),
      ctl('zoom', 'tfyView::fov', 'Zoom', 0.5, 5, 0.01),
      ctl('flat', 'tfyView::ortho', 'Flatten', 0, 1, 0.01),
    ],
    mappings: flyMappings,
    layers: [],
    notes: `**What it shows.** The camera flying through a box of time. **Translate Z** moves the camera and the point it looks at along the box's depth, so the camera passes in front of the first frame, through the frames, and out past the slice; **Translate X** drifts it sideways. Slow LFOs drive both.

**Try.** Switch a mapping off and drag Translate Z by hand to stop anywhere in time. **Angle** and **Elevation** still turn the camera round the moved point; **Distance** sets how far behind that point it sits; **Zoom** and **Flatten** change the lens. Every one is a live uniform: mapping them to LFOs, MIDI or hands costs nothing.`,
  };

  const fly: ExampleGraph = {
    ...meta('timeCubeFlyThrough'),
    counter: 20,
    nodes: [
      n('timeCube', 'tfySource', 80, 160, { ...note(CUBE_NOTE) }),
      n('timeCubeView', 'tfyView', 440, 160, {
        slice: 0.7, before: 0.12, after: 0.6, timeFeather: 12, depth: 3, quality: 'good',
        camDist: 1.6, camAngle: 0.18, camElevation: 0.12, fov: 1.4, rotSpeed: 0, camZ: -0.6,
        roundness: 0.3, feather: 0.12, rimStrength: 0.25, rimWidth: 0.05,
        ...note([
          'Time Cube View with a camera that flies through it. The box is long (Time stretch 3) and the camera close (Cam Distance 1.6), looking along the box\'s depth.',
          'Translate Z moves the camera and the point it looks at along the depth, which is time here. It has no input socket: on Play an LFO drives it from 0.9 to -3 and back (from in front of the first frame, through the ghostly past and the slice, into the solid frames after it) and another drifts Translate X. Angle and Elevation still turn round the moved point.',
          'The frames are see-through before the slice (Before opacity 0.12) and firmer after it (0.6), with a 12-frame Feather, so flying through you pass ghosts of the past into the solid present.',
        ].join('\n')),
      }, { volume: ['tfySource', 'volume'] }),
      n('output', 'tfyOut', 820, 160, OUT_NOTE, { color: ['tfyView', 'color'] }),
    ],
    play: flyPlay,
  };

  const longExposure: ExampleGraph = {
    ...meta('timeCubeLongExposure'),
    counter: 20,
    nodes: [
      n('timeCube', 'teSource', 80, 160, {
        frames: 64, combine: 'max', subFrames: 6, order: 'sort', sortBy: 'brightness', invert: false,
        ...note([
          'Time Cube with Frames from: Brightest. Each of the 64 stacked frames is read six times across its slot of time (Sub-frames 6) and keeps the brightest of the six at every pixel, like a long exposure: the swirling balls leave trails of light.',
          'Frame order: Sort by brightness, darkest first. Changing the order rearranges the frames already read: nothing is decoded again.',
          'The card says how many frames it reads (here 384; a video takes about 26 ms a frame, so this one builds in about ten seconds).',
        ].join('\n')),
      }),
      n('lfo', 'teSweep', 80, 420, {
        waveform: 'triangle', freq: 0.06, amplitude: 0.45, offset: 0.5,
        ...note('LFO (triangle): sweeps the slice through the sorted frames, darkest to brightest and back.'),
      }),
      n('timeCubeView', 'teView', 440, 160, {
        before: 0.19, after: 1, camAngle: 0.7, camElevation: 0.35, rotSpeed: 0.08, roundness: 0.35, feather: 0.16,
        ...note('Time Cube View: the long-exposure frames as a box. The slice shows one of them crisply; the sides show their edges in brightness order.'),
      }, { volume: ['teSource', 'volume'], slice: ['teSweep', 'value'] }),
      n('output', 'teOut', 820, 160, OUT_NOTE, { color: ['teView', 'color'] }),
    ],
  };

  const key: ExampleGraph = {
    ...meta('timeCubeKey'),
    counter: 20,
    nodes: [
      n('timeCube', 'tkSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'tkSweep', 80, 420, {
        waveform: 'sine', freq: 0.05, amplitude: 0.4, offset: 0.55,
        ...note('LFO: moves the slice slowly back and forth through the later half of the clip.'),
      }),
      n('timeCubeView', 'tkView', 440, 160, {
        before: 0.37, after: 0.45, sliceOpacity: 0.55, quality: 'best', depth: 2.2, camAngle: 1.05, camElevation: 0.55, camDist: 5, rotSpeed: 0.06,
        keyMode: 'hue', keyColor: [1, 0.55, 0.12], keyTolerance: 0.07, keySoftness: 0.05, keyOpacity: 1, othersOpacity: 0.7, othersGrey: 0.85,
        background: [0.03, 0.03, 0.04],
        ...note([
          'Time Cube View with a colour key: Key is set to a hue (amber, Tolerance 0.07), so anything amber in any frame stays solid (Key opacity 1).',
          'Everything else is multiplied by Others (0.7) and drained of colour (Others grey): a grey ghost of the clip.',
          'The amber rings swell, turn and break apart from frame to frame, so through time they leave twisting trails of colour through the box. The box is stretched in time (Time stretch 2.2) to show them.',
        ].join('\n')),
      }, { volume: ['tkSource', 'volume'], slice: ['tkSweep', 'value'] }),
      n('output', 'tkOut', 820, 160, OUT_NOTE, { color: ['tkView', 'color'] }),
    ],
  };

  const slit: ExampleGraph = {
    ...meta('timeCubeSlitScan'),
    counter: 20,
    nodes: [
      n('timeCube', 'tsSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'tsSweep', 80, 420, {
        waveform: 'sawtooth', freq: 0.2, amplitude: 0.5, offset: 0.5,
        ...note('LFO (sawtooth): runs the cut from the first frame to the last every 5 s, like playing the video at double speed, then jumps back.'),
      }),
      n('timeSlice', 'tsSlice', 440, 160, {
        mode: 'plane', tiltX: 40, timeEdge: 'loop',
        ...note([
          'Time Slice: a flat cut through the box of time, as a picture.',
          'Tilt X 40° tips the cut so time runs across the picture: the left edge is earlier, the right edge later. That is slit-scan: the turning rings of balls come out stretched and bent into new shapes.',
          'Past the ends is set to Loop, so the cut wraps round instead of holding on the first or last frame. Try Cut: Row through time for a strip of one line of the video over time.',
        ].join('\n')),
      }, { volume: ['tsSource', 'volume'], slice: ['tsSweep', 'value'] }),
      n('output', 'tsOut', 820, 160, OUT_NOTE, { color: ['tsSlice', 'color'] }),
    ],
  };

  // ── Space (docs/timecube-space.md): the box repeated and warped ─────────────

  const hallPlay: PlayRecord = {
    version: 1,
    controls: [
      ctl('time', 'thaView::copyTime', 'Time per copy', -0.3, 0.3, 0.005),
      ctl('gap', 'thaView::repGap', 'Gap', 0, 3, 0.01),
      ctl('fog', 'thaView::spaceFog', 'Fog', 0, 1.5, 0.01),
      ctl('hue', 'thaView::copyHue', 'Hue per copy', 0, 1, 0.01),
      ctl('ang', 'thaView::camAngle', 'Camera angle', -3.14, 3.14, 0.01),
    ],
    mappings: [],
    layers: [],
    notes: `**What it shows.** One Time Cube View with **Repeat the box** on: copies across an endless floor (Repeat along: a floor, Copies each side 0 = forever), fading into the background with **Fog**. **Time per copy** moves each copy's slice along by distance from the middle, so the moment ripples outward ring by ring.

**Try.** Drag **Time per copy** through 0: every copy at the same moment, then the ripple runs the other way. **Gap** spreads them out; **Hue per copy** colours each copy differently. On the card, Time steps by: Random scatters the moments; Mirror every other flips neighbours to face each other.`,
  };

  const hall: ExampleGraph = {
    ...meta('timeCubeHall'),
    counter: 20,
    nodes: [
      n('timeCube', 'thaSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'thaSweep', 80, 420, {
        waveform: 'triangle', freq: 0.05, amplitude: 0.42, offset: 0.5,
        ...note('LFO (triangle): sweeps the slice slowly through the clip and back, one round trip every 20 s. Every copy follows it, each a little behind or ahead (Time per copy).'),
      }),
      n('timeCubeView', 'thaView', 440, 160, {
        repeat: true, repAxes: 'xz', repGap: 0.8, repCount: 0, copyTime: 0.07, copyTimeBy: 'distance', farDist: 40, spaceFog: 0.45,
        before: 0.3, after: 1, timeFeather: 10, roundness: 0.35, feather: 0.12, rimStrength: 0.25, rimWidth: 0.05, quality: 'draft',
        camDist: 7.5, camAngle: 0.6, camElevation: 0.45, rotSpeed: 0.04, fov: 1.6, background: [0.025, 0.025, 0.04],
        ...note([
          'Time Cube View with Repeat the box on (Space section): the box copied across a floor (Repeat along: X and Z), forever (Copies each side 0), 0.8 frame heights apart (Gap).',
          'In space the view marches the ray from box to box: between boxes it jumps straight to the next one; inside one it steps through the frames as a single box would. Far 40 is how far it looks; Fog 0.45 fades the far copies into the Background so the endless grid doesn\'t turn to grain.',
          'Time per copy 0.07, stepped by Distance from the middle: each ring of copies out from the middle has its slice 0.07 of the clip later, so the moment ripples outward.',
          'Quality Draft (96 steps a box) keeps a hall of boxes quick: rays crossing several boxes share the budget.',
        ].join('\n')),
      }, { volume: ['thaSource', 'volume'], slice: ['thaSweep', 'value'] }),
      n('output', 'thaOut', 820, 160, OUT_NOTE, { color: ['thaView', 'color'] }),
    ],
    play: hallPlay,
  };

  const twisted: ExampleGraph = {
    ...meta('timeCubeTwisted'),
    counter: 20,
    nodes: [
      n('timeCube', 'ttwSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'ttwSweep', 80, 420, {
        waveform: 'sine', freq: 0.06, amplitude: 0.4, offset: 0.5,
        ...note('LFO: moves the slice back and forth through the middle of the clip.'),
      }),
      n('timeCubeView', 'ttwView', 440, 160, {
        warp: 'twist', warpWhere: 'each', warpAmount: 0.22, warpFreq: 1, warpSpeed: 0.5,
        depth: 2.4, before: 0.3, after: 0.9, timeFeather: 8, roundness: 0.3, feather: 0.1, rimStrength: 0.35, rimWidth: 0.06,
        camDist: 5.2, camAngle: 0.5, camElevation: 0.32, rotSpeed: 0.05, background: [0.04, 0.035, 0.06],
        ...note([
          'Time Cube View with Warp: Twist (Space section). The space the box is in turns round the line of time, so each frame is turned a little more than the one before: Amount 0.22 turns the last frame about 95° from the first in this long box (Time stretch 2.4).',
          'Warp speed 0.5 makes the twist breathe: it winds one way, unwinds, and winds the other way, every 12 s or so.',
          'The frames are read where the twist puts them, so the picture turns with them, and the slice is still one frame of the clip, twisted.',
          'Other warps on the same card: Bend curves time upward, Wave snakes it, Noise wobbles it. For any warp you can build, put a Time Cube Shape in a Scene Group and wire it into Space (the "Repeat Scene and 3D warps" example).',
        ].join('\n')),
      }, { volume: ['ttwSource', 'volume'], slice: ['ttwSweep', 'value'] }),
      n('output', 'ttwOut', 820, 160, OUT_NOTE, { color: ['ttwView', 'color'] }),
    ],
  };

  const train: ExampleGraph = {
    ...meta('timeCubeTrain'),
    counter: 20,
    nodes: [
      n('timeCube', 'ttrSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('timeCubeView', 'ttrView', 440, 160, {
        timeMode: 'flow', framePos: 0.1, flowSpeed: 0.04, before: 0.1, after: 0.9,
        repeat: true, repAxes: 'z', repGap: 0.35, repCount: 0, copyTime: 0.04, copyTimeBy: 'step',
        warp: 'wave', warpWhere: 'space', warpAmount: 1.2, warpFreq: 0.12, warpSpeed: 1.4,
        farDist: 45, spaceFog: 0.35, roundness: 0.4, feather: 0.12, rimStrength: 0.3, rimWidth: 0.05, quality: 'draft',
        camDist: 6, camAngle: 0.75, camElevation: 0.3, rotSpeed: 0, fov: 1.5, background: [0.03, 0.03, 0.05],
        ...note([
          'Time Cube View in Flow (the clip flows through each box past its front frame) with Repeat the box along Z: a line of boxes going off into the distance, 0.35 apart, forever.',
          'Time per copy 0.04, stepped by Place: each box is 0.04 of the clip later than the one in front of it, so the same moment travels back along the train.',
          'Warp: Wave on The whole space: the space the line is in snakes up and down along it (Amount 1.2, one wave every eight or so frame heights: Frequency 0.12), and Warp speed 1.4 sends the wave travelling, so the train rolls over it.',
          'Fog 0.35 fades the far boxes away; Quality Draft keeps a long line quick.',
        ].join('\n')),
      }, { volume: ['ttrSource', 'volume'] }),
      n('output', 'ttrOut', 820, 160, OUT_NOTE, { color: ['ttrView', 'color'] }),
    ],
  };

  const sceneSub: SubgraphData = { inputPorts: [], outputPorts: [], nodes: [
    n('scenePos', 'tssPos', 0, 200, { _groupOriginal: true, ...note('Scene Pos: the point being measured, already moved into its copy\'s cell by the Repeat Scene outside.') }),
    n('twist3D', 'tssTwist', 300, 200, { k: 0.9, ...note('Twist 3D: turns space round the upright (Y) axis, more the higher you go (0.9 radians a frame height), so each box is wrung top to bottom. Any warp can go here: Bend 3D, a noise displacement, a Warp Builder group.') }, { pos: ['tssPos', 'pos'] }),
    n('timeCubeShape', 'tssShape', 600, 200, { ...note('Time Cube Shape: the Time Cube View\'s box, as a shape. It measures the twisted point, and keeps it for the view, which reads the frames there: the picture twists with the box.') }, { pos: ['tssTwist', 'pos'] }),
    n('sceneOutput', 'tssOut', 900, 200, { _groupOriginal: true, ...note('Scene Output: the distance to the twisted box.') }, { dist: ['tssShape', 'dist'] }),
  ] };

  const sceneSpace: ExampleGraph = {
    ...meta('timeCubeSceneSpace'),
    counter: 20,
    nodes: [
      n('timeCube', 'tssSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('sceneGroup', 'tssScene', 80, 460, {
        label: 'Twisted box', subgraph: sceneSub,
        ...note('Scene Group: a Time Cube Shape behind a Twist 3D. Open it to change the warp; any 3D warp node (or a Warp Builder group) can sit between Scene Pos and the shape.'),
      }),
      n('repeatScene', 'tssRep', 360, 460, {
        cellX: 3.4, cellY: 50, cellZ: 3.2, countX: 2, countY: 0, countZ: 1, neighbours: 'off',
        ...note('Repeat Scene: the twisted box in a 5 × 3 grid (2 copies each side along X, 1 along Z; Cell Y 50 keeps it one layer). Neighbours Off is enough: every copy stays inside its 3.4 × 3.2 cell.'),
      }, { scene: ['tssScene', 'scene'] }),
      n('timeCubeView', 'tssView', 640, 160, {
        copyTime: 0.35, copyTimeBy: 'random', copyHue: 0.3, spaceStep: 0.6, farDist: 30, spaceFog: 0.15,
        before: 0.28, after: 0.95, roundness: 0.3, feather: 0.1, rimStrength: 0.3, rimWidth: 0.05, quality: 'draft',
        camDist: 8.5, camAngle: 0.5, camElevation: 0.5, rotSpeed: 0.05, background: [0.03, 0.03, 0.045],
        ...note([
          'Time Cube View with the Repeat Scene wired into Space: the view draws its box wherever the scene\'s Time Cube Shape is, through the scene\'s twist and its repeat. The Box settings here (Time stretch, Box size, Corner roundness) set the shape\'s size.',
          'Time per copy 0.35 at Random and Hue per copy 0.3 (Space section) use each Repeat Scene copy\'s cell: every box shows its own moment in its own colours.',
          'Step (wired Space) 0.6: a twist stretches space, so the ray steps 60% of the distance the scene reports, so it never steps through a box. Lower it for a stronger twist.',
        ].join('\n')),
      }, { volume: ['tssSource', 'volume'], space: ['tssRep', 'scene'] }),
      n('output', 'tssOutput', 1020, 160, OUT_NOTE, { color: ['tssView', 'color'] }),
    ],
  };

  return {
    timeCubeBox: box, timeCubeSoftPill: pill, timeCubeHighlights: highlights, timeCubeFlow: flow, timeCubePulse: pulse,
    timeCubeFlyThrough: fly, timeCubeLongExposure: longExposure, timeCubeKey: key, timeCubeSlitScan: slit,
    timeCubeHall: hall, timeCubeTwisted: twisted, timeCubeTrain: train, timeCubeSceneSpace: sceneSpace,
  };
}
