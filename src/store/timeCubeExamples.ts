/**
 * timeCubeExamples.ts — the Time cube examples (docs/time-cube.md). Each
 * uses the built-in test clip (a red car crossing a street, painted by
 * lib/timeCube/frames.ts), so they work offline and need no file: choose
 * your own video on the Time Cube card.
 *
 * Every node carries a comment saying what it is and why it's there.
 */
import type { ExampleGraph } from './exampleIndex';
import type { PlayMapping, PlayRecord } from '../types/play';
import { colourCtl, ctl, n } from './graphBuilder';

export const TIME_CUBE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play?: true }> = {
  timeCubeBox: {
    label: 'Time cube: a video as a box of time',
    description: 'Every frame of a clip stacked one behind the other into a soft, rounded box with a faint glow. The slice sweeps through time: frames before it are see-through, frames after it solid, and the frame at the slice shows crisply. The camera orbits slowly.',
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
    description: 'On black, only the red of the car shows, in bands that pulse through the box of time, with flashes of lightning. On Play, turn the key colour round the wheel (a slow LFO already does), widen the tolerance or speed the pulse.',
  },
  timeCubeFocus: {
    label: 'Time cube: depth of field',
    description: 'A close camera with depth of field, focused on the slice: as the slice sweeps, the focus follows it, and the frames in front and behind go soft.',
  },
  timeCubeLongExposure: {
    label: 'Time cube: long exposure',
    description: 'Each stacked frame is the brightest of six frames from its slot of time, like a long exposure: the car, the ball and the lamps leave trails. The frames are then sorted by brightness, darkest first.',
  },
  timeCubeKey: {
    label: 'Time cube: isolate a colour',
    description: 'The same box with a colour key on red: the red car stays solid, a red ribbon through time, while the rest of the street turns to a grey ghost.',
  },
  timeCubeSlitScan: {
    label: 'Slit-scan from a time cube',
    description: 'A flat cut through the box of time, tilted so each column of the picture comes from a different moment: moving things stretch and bend. No 3D needed.',
  },
};

export const TIME_CUBE_EXAMPLE_KEYS = Object.keys(TIME_CUBE_EXAMPLE_INDEX);

const note = (text: string) => ({ __comment: text });
/** An example's label and description (its index entry's Play flag marks the listing only). */
const meta = (k: string) => ({ label: TIME_CUBE_EXAMPLE_INDEX[k].label, description: TIME_CUBE_EXAMPLE_INDEX[k].description });

const CUBE_NOTE = [
  'Time Cube: stacks the frames of a video into a box of time, one frame behind the next.',
  'This one uses the built-in test clip (a red car crossing a street). Press Choose video on this card to use one of yours from the Library or a file.',
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
        rotSpeed: 0.12, camAngle: 0.55, camElevation: 0.35, before: 0.6,
        roundness: 0.4, feather: 0.2, rimStrength: 0.4, rimWidth: 0.09,
        ...note([
          'Time Cube View: draws the box in 3D, marching each ray through it front to back.',
          'Before the slice (Offset), frames are see-through (Before opacity 0.6): you look into the past. After it they are solid, and the box\'s sides show each frame\'s edge pixels smeared through time.',
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
        ortho: 1, camDist: 3, camAngle: 0.5, camElevation: 0.45, rotSpeed: 0.35, swing: 0.25,
        ...note([
          'Time Cube View as a soft pill on white, after the soft-box look in product illustrations.',
          'Flow mode: the crisp frame sits at the very front (Frame position 0.03) and the clip flows through the box past it (Flow speed 0.06), so the face plays the video. Before opacity 0 keeps the sliver in front of it clear.',
          'Shape: Corner roundness 0.45, Edge softness 0.14. Glow: Side tint 0.85 washes the sides in a peach-to-mint gradient (the face keeps its own colours), a pink Rim glow, a faint shadow, and a near-white Background.',
          'Camera: Flatten 1 makes it orthographic, like an isometric drawing; Swing rocks it gently back and forth.',
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
        before: 0.2, after: 0.45, quality: 'best', depth: 2, camAngle: 0.95, camElevation: 0.32, camDist: 4.2, rotSpeed: 0,
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
        timeMode: 'flow', framePos: 0.22, flowSpeed: 0.05, before: 0.3, after: 0.8, depth: 2.2,
        highlights: true, motion: true, hlCount: 4, hlSpacing: 32, hlThickness: 1, hlOpacity: 0.6, hlTint: 0.1, hlEdge: 0.8, hlColor: [0.55, 0.85, 1],
        motionAt: 'slice', motionWidth: 6, liftUp: 0.12,
        camAngle: 0.75, camElevation: 0.3, camDist: 4.4,
        ...note([
          'Time Cube View in Flow mode: the crisp frame stays at Frame position 0.22 and the video flows through the box past it at 0.05 clip lengths a second (a whole pass every 20 s), wrapping from the front round to the back.',
          'Before opacity 0.3 (the frames that have already gone past the frame, in front) and After opacity 0.8 (the ones still to come, behind) are measured from the frame.',
          'Frame motion (Move frames on): frames lift (0.12 frame heights) as they pass through the frame, easing over 6 frames either side.',
          'Highlights (Highlight frames on): four frames of the clip, 32 apart, outlined in blue. In Flow they belong to the clip, so they ride the flow through the box. Wire an LFO or a Play control into Flow time (and set Flow speed 0) to drive the flow yourself.',
        ].join('\n')),
      }, { volume: ['tfSource', 'volume'] }),
      n('output', 'tfOut', 820, 160, OUT_NOTE, { color: ['tfView', 'color'] }),
    ],
  };

  const pulseMappings: PlayMapping[] = [
    { id: 'm1', controlId: 'hue', source: { kind: 'lfo', shape: 'sine', rate: 0.03, phase: 0 }, outMin: -0.08, outMax: 0.08, curve: 'linear', smoothMs: 0, enabled: true },
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
      ctl('flash', 'tuView::lightning', 'Lightning', 0, 1, 0.01),
    ],
    mappings: pulseMappings,
    layers: [],
    notes: `**What it shows.** A Time Cube View keyed on one colour, on black: only the keyed colour shows, and only in **pulses** travelling through the box of time, with **lightning** flashes on top. The crisp frame is the slice.

**Try.** **Key hue shift** turns the key colour round the colour wheel: a slow LFO already rocks it a little either side of red, so the car's red flickers in and out of the key. Drag it further (or map a MIDI knob to it) to key the ball's blue or the hills' green instead. **Key hue drift** keeps it turning on its own. **Hue range** widens what counts as the colour. **Pulse speed** and **Pulse width** shape the travelling bands; **Lightning** brings in short random flashes. Every one is a live uniform, so mapping them to LFOs or MIDI costs nothing.`,
  };

  const pulse: ExampleGraph = {
    ...meta('timeCubePulse'),
    counter: 20,
    nodes: [
      n('timeCube', 'tuSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('timeCubeView', 'tuView', 440, 160, {
        slice: 0.82, before: 0.6, after: 0.7, sliceOpacity: 1, depth: 3, quality: 'best',
        keyMode: 'hue', keyColor: [0.85, 0.1, 0.1], keyTolerance: 0.07, keySoftness: 0.05, keyOpacity: 1, othersOpacity: 0, othersGrey: 1,
        pulse: 1, pulseDir: 'forward', pulseSpeed: 0.35, pulseCount: 4, pulseWidth: 0.3, pulseSoftness: 0.6,
        lightning: 0.45, lightningRate: 2.5, lightningWidth: 0.12, lightningSeed: 7,
        background: [0, 0, 0], rimStrength: 0.18, rimWidth: 0.03, rimColor: [0.35, 0.45, 0.7], roundness: 0.15, feather: 0.06,
        camAngle: 1.2, camElevation: 0.18, camDist: 4.2, rotSpeed: 0, swing: 0.35,
        ...note([
          'Time Cube View keyed on red (Key: a hue), on black. Others 0 hides everything that isn\'t red, so only the car shows, and the slice frame (Offset 0.82) stays vivid.',
          'Pulse 1: the red shows only in four bands (Pulse count) that travel from the first frame to the last (Pulse speed 0.35 bands a second, width 0.3, soft edges).',
          'Lightning 0.45: short, sharp flashes light random stretches of time on top (2.5 a second, seed 7). Above 0.5 the bands fade and the flashes take over.',
          'A faint blue Rim glow marks the box\'s edge in the dark. On Play the key colour, hue shift and drift, tolerance and pulse are on the panel; an LFO rocks the hue shift.',
        ].join('\n')),
      }, { volume: ['tuSource', 'volume'] }),
      n('output', 'tuOut', 820, 160, OUT_NOTE, { color: ['tuView', 'color'] }),
    ],
    play: pulsePlay,
  };

  const focus: ExampleGraph = {
    ...meta('timeCubeFocus'),
    counter: 20,
    nodes: [
      n('timeCube', 'tdSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'tdSweep', 80, 420, {
        waveform: 'sine', freq: 0.06, amplitude: 0.4, offset: 0.5,
        ...note('LFO: moves the slice slowly back and forth through the box. The focus follows it.'),
      }),
      n('timeCubeView', 'tdView', 440, 160, {
        before: 0.35, after: 1, depth: 3, camDist: 2.6, camAngle: 0.45, camElevation: 0.22, fov: 1.6, rotSpeed: 0,
        dof: 'slice', blur: 0.9, focus: 1, maxBlur: 18,
        roundness: 0.3, feather: 0.12, rimStrength: 0.1,
        ...note([
          'Time Cube View with Depth of field switched on (the Focus section). The camera is close (Cam Distance 2.6) and the box long (Time stretch 3), so the near and far ends are far from the slice.',
          'Depth of field: Focus on the slice, so the sharp plane follows the scan; Focus 1 puts it right on the slice. Blur 0.9 sets how quickly things soften away from it, Max blur 18 pixels caps it.',
          'Out of focus, frames read four times round each point (a soft disc), and the box\'s edge softens with them.',
        ].join('\n')),
      }, { volume: ['tdSource', 'volume'], slice: ['tdSweep', 'value'] }),
      n('output', 'tdOut', 820, 160, OUT_NOTE, { color: ['tdView', 'color'] }),
    ],
  };

  const longExposure: ExampleGraph = {
    ...meta('timeCubeLongExposure'),
    counter: 20,
    nodes: [
      n('timeCube', 'teSource', 80, 160, {
        frames: 64, combine: 'max', subFrames: 6, order: 'sort', sortBy: 'brightness', invert: false,
        ...note([
          'Time Cube with Frames from: Brightest. Each of the 64 stacked frames is read six times across its slot of time (Sub-frames 6) and keeps the brightest of the six at every pixel, like a long exposure: the car, the ball and the blinking lamps leave trails.',
          'Frame order: Sort by brightness, darkest first. Changing the order rearranges the frames already read: nothing is decoded again.',
          'The card says how many frames it reads (here 384, painted in a moment; a real video takes about 26 ms a frame).',
        ].join('\n')),
      }),
      n('lfo', 'teSweep', 80, 420, {
        waveform: 'triangle', freq: 0.06, amplitude: 0.45, offset: 0.5,
        ...note('LFO (triangle): sweeps the slice through the sorted frames, darkest to brightest and back.'),
      }),
      n('timeCubeView', 'teView', 440, 160, {
        before: 0.35, after: 1, camAngle: 0.7, camElevation: 0.35, rotSpeed: 0.08, roundness: 0.35, feather: 0.16,
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
        before: 0.6, after: 0.7, sliceOpacity: 0.55, quality: 'best', depth: 2.2, camAngle: 1.05, camElevation: 0.55, camDist: 5, rotSpeed: 0.06,
        keyMode: 'hue', keyColor: [0.85, 0.1, 0.1], keyTolerance: 0.07, keySoftness: 0.05, keyOpacity: 1, othersOpacity: 0.7, othersGrey: 0.85,
        background: [0.03, 0.03, 0.04],
        ...note([
          'Time Cube View with a colour key: Key is set to a hue (red, Tolerance 0.07), so anything red in any frame stays solid (Key opacity 1).',
          'Everything else is multiplied by Others (0.7) and drained of colour (Others grey): a grey ghost of the street.',
          'The car drives left to right, so through time it leaves a red ribbon slanting across the box. The box is stretched in time (Time stretch 2.2) to show the slant.',
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
        ...note('LFO (sawtooth): runs the cut from the first frame to the last every 5 s, like playing the video, then jumps back.'),
      }),
      n('timeSlice', 'tsSlice', 440, 160, {
        mode: 'plane', tiltX: 40, timeEdge: 'loop',
        ...note([
          'Time Slice: a flat cut through the box of time, as a picture.',
          'Tilt X 40° tips the cut so time runs across the picture: the left edge is earlier, the right edge later. That is slit-scan: the car, moving the same way, comes out stretched; the bouncing ball bends.',
          'Past the ends is set to Loop, so the cut wraps round instead of holding on the first or last frame. Try Cut: Row through time for a strip of one line of the video over time.',
        ].join('\n')),
      }, { volume: ['tsSource', 'volume'], slice: ['tsSweep', 'value'] }),
      n('output', 'tsOut', 820, 160, OUT_NOTE, { color: ['tsSlice', 'color'] }),
    ],
  };

  return {
    timeCubeBox: box, timeCubeSoftPill: pill, timeCubeHighlights: highlights, timeCubeFlow: flow, timeCubePulse: pulse,
    timeCubeFocus: focus, timeCubeLongExposure: longExposure, timeCubeKey: key, timeCubeSlitScan: slit,
  };
}
