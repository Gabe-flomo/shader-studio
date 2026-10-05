/**
 * frameStackExamples.ts — the Frame Stack examples (docs/frame-stack.md):
 * a Time Cube's frames as cards. Each uses the built-in test clip (a red car
 * crossing a street), so they work offline and need no file: choose your own
 * video on the Time Cube card.
 *
 * Every node carries a comment saying what it is and why it's there.
 */
import type { ExampleGraph } from './exampleIndex';
import { n } from './graphBuilder';

export const FRAME_STACK_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  frameStackIsometric: {
    label: 'Frame stack: isometric cards',
    description: 'A video\'s frames as thin cards in a long diagonal stack, seen through an isometric lens on a light page. The scan opens a gap and lifts one card out; it creeps slowly along the stack.',
  },
  frameStackRing: {
    label: 'Frame stack: ring of frames',
    description: 'The frames stood on edge round a ring like a rolodex, on black, with white borders. The camera circles slowly and the card at the scan rises as it passes.',
  },
  frameStackDrift: {
    label: 'Frame stack: drift apart and back',
    description: 'A neat stack of frames that slowly comes apart, every card drifting off on its own path, then gathers back together. An LFO drives Spread.',
  },
  frameStackHighlights: {
    label: 'Frame stack: highlighted frames loop',
    description: 'Four cards, eight apart, lit and lifted out of a dimmed stack. They travel with the scan and wrap round the end, so the highlights loop as it sweeps.',
  },
  frameStackMorph: {
    label: 'Frame stack: stack to ring',
    description: 'The cards fold from a straight stack into a ring and back, one after another (Stagger). An LFO drives Morph.',
  },
  frameStackFocus: {
    label: 'Frame stack: ring in shallow focus',
    description: 'The ring of frames through a long lens: the near cards are sharp and the far side of the ring melts into soft blur. The camera turns slowly so cards drift through the focus.',
  },
  frameStackShuffle: {
    label: 'Frame stack: shuffle the contact sheet',
    description: 'A grid of frames in time order that shuffles itself: every card flies to its own place in a random order, holds, then flies home. An LFO drives Shuffle.',
  },
};

export const FRAME_STACK_EXAMPLE_KEYS = Object.keys(FRAME_STACK_EXAMPLE_INDEX);

const note = (text: string) => ({ __comment: text });

const CUBE_NOTE = [
  'Time Cube: decodes a video into frames (one texture holding them all). The Frame Stack draws each frame as a card.',
  'This one uses the built-in test clip (a red car crossing a street). Press Choose video on this card to use one of yours from the Library or a file.',
].join('\n');

const OUT_NOTE = note('Output: the picture.');

export function buildFrameStackExamples(): Record<string, ExampleGraph> {
  const iso: ExampleGraph = {
    ...FRAME_STACK_EXAMPLE_INDEX.frameStackIsometric,
    counter: 20,
    nodes: [
      n('timeCube', 'fiSource', 80, 160, { frames: 64, ...note(CUBE_NOTE) }),
      n('lfo', 'fiScan', 80, 420, {
        waveform: 'triangle', freq: 0.025, amplitude: 0.3, offset: 0.5,
        ...note('LFO (triangle): moves the scan slowly between 0.2 and 0.8 of the stack and back, one round trip every 40 s.'),
      }),
      n('frameStack', 'fiStack', 440, 160, {
        layout: 'stack', cards: 40, spacing: 0.18, gap: 4, lift: 0.3, pull: 0.2, falloff: 0, before: 1,
        corner: 0, thickness: 0.008, shading: 0.15, edgeColor: [0.78, 0.78, 0.8],
        projection: 'ortho', viewSize: 4.2, camAngle: -1.15, camElevation: 0.35, background: [0.93, 0.93, 0.92],
        ...note([
          'Frame Stack: each frame of the Time Cube is a thin card. Layout Stack lines them up one behind the next (Spacing 0.11 apart).',
          'Lens Isometric (orthographic): far cards are as big as near ones, so the stack runs as a clean diagonal from bottom left to top right. Background is a light grey page.',
          'The scan (Offset, wired from the LFO) opens a Gap of 4 cards either side and pulls its card up and out of line (Lift 0.3, Pull out 0.2): the one frame you are looking at. As the scan moves on, that card glides back and the next one comes out.',
        ].join('\n')),
      }, { volume: ['fiSource', 'volume'], scan: ['fiScan', 'value'] }),
      n('output', 'fiOut', 820, 160, OUT_NOTE, { color: ['fiStack', 'color'] }),
    ],
  };

  const ring: ExampleGraph = {
    ...FRAME_STACK_EXAMPLE_INDEX.frameStackRing,
    counter: 20,
    nodes: [
      n('timeCube', 'frSource', 80, 160, { frames: 64, ...note(CUBE_NOTE) }),
      n('lfo', 'frScan', 80, 420, {
        waveform: 'sawtooth', freq: 0.05, amplitude: 0.5, offset: 0.5,
        ...note('LFO (sawtooth): runs the scan round the ring once every 20 s.'),
      }),
      n('frameStack', 'frStack', 440, 160, {
        layout: 'ring', cards: 40, radius: 2.3, twist: 0.08, arc: 1, size: 1.05,
        corner: 0.07, border: 0.035, borderColor: [0.95, 0.95, 0.96], thickness: 0.004, shading: 0.3,
        gap: 0, lift: 0.35, falloff: 2.5, scanScale: 0.08,
        camDist: 8.2, camAngle: 0.3, camElevation: 0.42, rotSpeed: 0.06, fov: 1.9, background: [0, 0, 0],
        ...note([
          'Frame Stack with Layout Ring / torus: 40 cards round a circle of Radius 2.3.',
          'Face out 0.08 stands them almost along the ring, like a rolodex, so you see them fan past each other. Raise it to 1 to turn every card outward.',
          'White borders (Border 0.035) and round corners make them read as cards on black. The camera orbits slowly (Orbit speed).',
          'The scan runs round the ring: its card rises (Lift 0.35) and its neighbours a little less (Falloff 2.5 cards), a wave going round.',
          'Try Tube 0.6 and Windings 6 for a torus.',
        ].join('\n')),
      }, { volume: ['frSource', 'volume'], scan: ['frScan', 'value'] }),
      n('output', 'frOut', 820, 160, OUT_NOTE, { color: ['frStack', 'color'] }),
    ],
  };

  const drift: ExampleGraph = {
    ...FRAME_STACK_EXAMPLE_INDEX.frameStackDrift,
    counter: 20,
    nodes: [
      n('timeCube', 'fdSource', 80, 160, { frames: 64, ...note(CUBE_NOTE) }),
      n('lfo', 'fdSpread', 80, 420, {
        waveform: 'sine', freq: 0.06, amplitude: 0.5, offset: 0.5,
        ...note('LFO (sine): Spread from 0 (a tidy stack) to 1 (fully scattered) and back, once every 17 s.'),
      }),
      n('frameStack', 'fdStack', 440, 160, {
        layout: 'stack', cards: 30, spacing: 0.16, gap: 0, lift: 0, before: 1,
        scatterPos: 1.6, scatterRot: 0.7, seed: 4, drift: 0.12, driftSpeed: 0.05,
        corner: 0.05, border: 0.02, borderColor: [0.1, 0.1, 0.12], thickness: 0.005, shading: 0.3,
        camDist: 8.5, camAngle: 0.9, camElevation: 0.3, rotSpeed: 0.03, background: [0.07, 0.07, 0.09],
        ...note([
          'Frame Stack: a stack of 30 cards whose Spread comes from the LFO. (Scattered cards cost more to draw than a tidy layout, so this one keeps the count down.)',
          'Every card has its own random offset (Offset 1.6) and turn (Turn 0.7), fixed by Seed. Spread scales them: at 0 the stack is neat, at 1 the cards are scattered to their full offsets, so they drift apart and come back together.',
          'Drift adds a slow wander of its own (Drift 0.12, Drift speed 0.05) so the stack is never quite still. The scan is turned off (Lift 0, Gap 0).',
        ].join('\n')),
      }, { volume: ['fdSource', 'volume'], spread: ['fdSpread', 'value'] }),
      n('output', 'fdOut', 820, 160, OUT_NOTE, { color: ['fdStack', 'color'] }),
    ],
  };

  const hl: ExampleGraph = {
    ...FRAME_STACK_EXAMPLE_INDEX.frameStackHighlights,
    counter: 20,
    nodes: [
      n('timeCube', 'fhSource', 80, 160, { frames: 64, ...note(CUBE_NOTE) }),
      n('lfo', 'fhScan', 80, 420, {
        waveform: 'sawtooth', freq: 0.04, amplitude: 0.5, offset: 0.5,
        ...note('LFO (sawtooth): sweeps the scan from the first card to the last every 25 s, then starts again.'),
      }),
      n('frameStack', 'fhStack', 440, 160, {
        layout: 'stack', cards: 48, spacing: 0.1, gap: 0, lift: 0.12, falloff: 0, before: 1,
        hlCount: 4, hlEvery: 8, hlFrame: 0, hlLoop: 'loop', hlLift: 0.45, hlScale: 0.06, hlOutline: 0.025, hlTint: 0.12, hlColor: [1, 0.76, 0.2], dim: 0.6,
        corner: 0.03, thickness: 0.006, shading: 0.25,
        projection: 'ortho', viewSize: 3.6, camAngle: 1.05, camElevation: 0.48, background: [0.06, 0.06, 0.07],
        ...note([
          'Frame Stack: a stack of 48 cards with highlights.',
          'Highlights: Count 4, Every 8, from the scan\'s card (With the scan: Travel). So the card at the scan and the ones 8, 16 and 24 after it are lit: lifted (Lift 0.45), a touch bigger, outlined in amber. Every other card is dimmed (Dim others 0.6).',
          'As the LFO sweeps the scan, the highlighted set moves with it and wraps round the end of the stack, so the four lit frames loop.',
        ].join('\n')),
      }, { volume: ['fhSource', 'volume'], scan: ['fhScan', 'value'] }),
      n('output', 'fhOut', 820, 160, OUT_NOTE, { color: ['fhStack', 'color'] }),
    ],
  };

  const morph: ExampleGraph = {
    ...FRAME_STACK_EXAMPLE_INDEX.frameStackMorph,
    counter: 20,
    nodes: [
      n('timeCube', 'fmSource', 80, 160, { frames: 64, ...note(CUBE_NOTE) }),
      n('lfo', 'fmMorph', 80, 420, {
        waveform: 'sine', freq: 0.05, amplitude: 0.5, offset: 0.5,
        ...note('LFO (sine): Morph from 0 (the stack) to 1 (the ring) and back, once every 20 s.'),
      }),
      n('frameStack', 'fmStack', 440, 160, {
        layout: 'stack', layoutB: 'ring', stagger: 1.5, cards: 40, spacing: 0.1, radius: 2.2, twist: 0.5,
        gap: 0, lift: 0, corner: 0.06, border: 0.025, thickness: 0.005, shading: 0.3,
        camDist: 8.5, camAngle: 0.7, camElevation: 0.45, rotSpeed: 0.05, background: [0.05, 0.05, 0.07],
        ...note([
          'Frame Stack: Layout Stack, Morph to Ring / torus. Morph (from the LFO) blends between them: 0 is the stack, 1 the ring.',
          'Stagger 1.5 sends the first cards off first, so the stack unrolls into the ring card by card instead of all at once.',
          'Face out 0.5 sets the ring\'s cards half way between along the ring and facing out.',
        ].join('\n')),
      }, { volume: ['fmSource', 'volume'], morph: ['fmMorph', 'value'] }),
      n('output', 'fmOut', 820, 160, OUT_NOTE, { color: ['fmStack', 'color'] }),
    ],
  };

  const focus: ExampleGraph = {
    ...FRAME_STACK_EXAMPLE_INDEX.frameStackFocus,
    counter: 20,
    nodes: [
      n('timeCube', 'ffSource', 80, 160, { frames: 64, ...note(CUBE_NOTE) }),
      n('lfo', 'ffScan', 80, 420, {
        waveform: 'sawtooth', freq: 0.03, amplitude: 0.5, offset: 0.5,
        ...note('LFO (sawtooth): runs the scan round the ring once every 33 s; its card rises as it passes.'),
      }),
      n('frameStack', 'ffStack', 440, 160, {
        layout: 'ring', cards: 40, radius: 2.3, twist: 0.08, size: 1.05,
        corner: 0.07, border: 0.035, borderColor: [0.95, 0.95, 0.96], thickness: 0.004, shading: 0.3,
        gap: 0, lift: 0.3, falloff: 1.5,
        dof: 'distance', focus: 0.68, blur: 0.9, maxBlur: 18,
        camDist: 6.2, camAngle: 0.15, camElevation: 0.3, rotSpeed: 0.05, fov: 2.4, background: [0, 0, 0],
        ...note([
          'Frame Stack: the ring of frames with depth of field (Depth of field: Focus at a distance).',
          'Focus 0.68 puts the sharp distance a little short of the ring\'s centre, on the near cards; the far side of the ring melts into blur. Blur 0.9 sets how strong; Max blur 18 caps how soft (in pixels of a 720-high picture).',
          'A longer lens (Zoom 2.4) from closer in makes the depth shallow, like a portrait lens. The camera turns slowly, so cards drift through the focus.',
          'Try Depth of field: Focus on the scan card: whichever card the scan lifts is the sharp one, wherever it is on the ring.',
        ].join('\n')),
      }, { volume: ['ffSource', 'volume'], scan: ['ffScan', 'value'] }),
      n('output', 'ffOut', 820, 160, OUT_NOTE, { color: ['ffStack', 'color'] }),
    ],
  };

  const shuffle: ExampleGraph = {
    ...FRAME_STACK_EXAMPLE_INDEX.frameStackShuffle,
    counter: 20,
    nodes: [
      n('timeCube', 'fsSource', 80, 160, { frames: 64, ...note(CUBE_NOTE) }),
      n('lfo', 'fsShuffle', 80, 420, {
        waveform: 'sine', freq: 0.07, amplitude: 0.7, offset: 0.5,
        ...note('LFO (sine, 0.5 ± 0.7): Shuffle goes past 0 and past 1 and is held there (Shuffle stops at 0 and 1), so the sheet rests in time order, flies, rests shuffled, and flies back. One round every 14 s.'),
      }),
      n('frameStack', 'fsStack', 440, 160, {
        layout: 'grid', cards: 36, columns: 6, spacing: 0.06, size: 0.62, gap: 0, lift: 0, before: 1,
        order: 'shuffle', shuffleSeed: 3, corner: 0.04, border: 0.03, borderColor: [0.97, 0.97, 0.95], thickness: 0.004, shading: 0.2,
        camDist: 7.2, camAngle: 0.25, camElevation: 0.22, rotSpeed: 0, background: [0.08, 0.08, 0.09],
        ...note([
          'Frame Stack: Layout Grid, a contact sheet of 36 frames in time order, 6 to a row.',
          'Order is Shuffle. Shuffle (from the LFO) moves every card toward its place in a random order: at 1 the frames are shuffled, each in a place of its own; Shuffle seed picks the order.',
          'Each card keeps its frame; only its place changes. The scan is off (Lift 0, Gap 0).',
        ].join('\n')),
      }, { volume: ['fsSource', 'volume'], shuffle: ['fsShuffle', 'value'] }),
      n('output', 'fsOut', 820, 160, OUT_NOTE, { color: ['fsStack', 'color'] }),
    ],
  };

  return { frameStackIsometric: iso, frameStackRing: ring, frameStackDrift: drift, frameStackHighlights: hl, frameStackMorph: morph, frameStackFocus: focus, frameStackShuffle: shuffle };
}
