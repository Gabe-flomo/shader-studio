/**
 * timeCubeExamples.ts — the Time cube examples (docs/time-cube.md). Each
 * uses the built-in test clip (a red car crossing a street, painted by
 * lib/timeCube/frames.ts), so they work offline and need no file: choose
 * your own video on the Time Cube card.
 *
 * Every node carries a comment saying what it is and why it's there.
 */
import type { ExampleGraph } from './exampleIndex';
import { n } from './graphBuilder';

export const TIME_CUBE_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  timeCubeBox: {
    label: 'Time cube: a video as a box of time',
    description: 'Every frame of a clip stacked one behind the other into a box. The slice sweeps through time: frames before it are see-through, frames after it solid, and the frame at the slice shows crisply. The camera orbits slowly.',
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

const CUBE_NOTE = [
  'Time Cube: stacks the frames of a video into a box of time, one frame behind the next.',
  'This one uses the built-in test clip (a red car crossing a street). Press Choose video on this card to use one of yours from the Library or a file.',
  'Frames and Frame size set how detailed the box is; the card shows how much memory it takes.',
].join('\n');

export function buildTimeCubeExamples(): Record<string, ExampleGraph> {
  const box: ExampleGraph = {
    ...TIME_CUBE_EXAMPLE_INDEX.timeCubeBox,
    counter: 20,
    nodes: [
      n('timeCube', 'tcSource', 80, 160, { ...note(CUBE_NOTE) }),
      n('lfo', 'tcSweep', 80, 420, {
        waveform: 'triangle', freq: 0.07, amplitude: 0.47, offset: 0.5,
        ...note('LFO (triangle): sweeps the slice slowly from near the first frame to near the last and back. 0.5 ± 0.47, one round trip every 14 s.'),
      }),
      n('timeCubeView', 'tcView', 440, 160, {
        rotSpeed: 0.12, camAngle: 0.55, camElevation: 0.3, before: 0.6,
        ...note([
          'Time Cube View: draws the box in 3D, marching each ray through it front to back.',
          'Before the slice (Offset), frames are see-through (Before opacity 0.6): you look into the past. After it they are solid, and the box\'s sides show each frame\'s edge pixels smeared through time.',
          'The frame at the slice is drawn crisply; the white lines are the box\'s edges and the slice\'s outline. The camera orbits slowly (Orbit speed).',
        ].join('\n')),
      }, { volume: ['tcSource', 'volume'], slice: ['tcSweep', 'value'] }),
      n('output', 'tcOut', 820, 160, note('Output: the picture.'), { color: ['tcView', 'color'] }),
    ],
  };

  const key: ExampleGraph = {
    ...TIME_CUBE_EXAMPLE_INDEX.timeCubeKey,
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
      n('output', 'tkOut', 820, 160, note('Output: the picture.'), { color: ['tkView', 'color'] }),
    ],
  };

  const slit: ExampleGraph = {
    ...TIME_CUBE_EXAMPLE_INDEX.timeCubeSlitScan,
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
      n('output', 'tsOut', 820, 160, note('Output: the picture.'), { color: ['tsSlice', 'color'] }),
    ],
  };

  return { timeCubeBox: box, timeCubeKey: key, timeCubeSlitScan: slit };
}
