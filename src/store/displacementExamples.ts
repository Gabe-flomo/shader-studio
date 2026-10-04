/**
 * displacementExamples.ts — the Studio example for the Displacement Map node
 * (After Effects' effect; play/kit/displace.js has the rules). Listed in the
 * Passes folder after the Pass examples. Play's own examples (a layer
 * displaced by another layer, by the picture, and the Look's By channels)
 * are in playExamples.ts.
 *
 * Every node carries a plain-language comment saying what it does and why it
 * is there; the comments land in the generated code too.
 */
import type { ExampleGraph } from './exampleIndex';
import type { PlayRecord } from '../types/play';
import { ctl, n } from './graphBuilder';

export const DISPLACEMENT_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  displaceNoiseMap: {
    label: 'Passes 10 · Displacement Map: a picture pushed by noise', play: true,
    description: 'After Effects’ Displacement Map as a node: a Truchet pattern (the Source) is pushed around by drifting noise (the Map), read by its luminance. Mid-grey noise leaves the tiles where they are; bright noise pushes them right and up, dark noise left and down, by up to Max pixels.',
  },
};

const note = (text: string) => ({ __comment: text });

export function buildDisplacementExamples(): Record<string, ExampleGraph> {
  const play: PlayRecord = {
    version: 1,
    controls: [
      ctl('maxH', 'disp::maxH', 'Max horizontal', -300, 300, 1),
      ctl('maxV', 'disp::maxV', 'Max vertical', -300, 300, 1),
      ctl('noise', 'noise::scale', 'Map scale', 0.5, 8, 0.05),
    ],
    mappings: [],
    layers: [],
    notes: `**What it shows.** After Effects' **Displacement Map** as a Studio node. One picture (the **Source**) is moved around by the colours of another (the **Map**): one channel of the Map pushes sideways, another up and down. Mid-grey (0.5) doesn't move anything; white pushes the full **Max** right (or up), black the full Max left (or down). Max is in pixels of a 1080-pixel-tall picture.

**How it is built.** A Truchet pattern is the Source, wired into **Source ƒ**: a field socket, so the node evaluates the whole Truchet chain again at the pushed position (nothing is drawn into a texture first). An FBM noise is the Map, read by **Luminance** for both directions, so the tiles slide diagonally where the noise is bright or dark. Every node has a note (its speech-bubble tab).

**Try.** Drag Max horizontal and Max vertical on the panel (negative turns the push round). Set Horizontal to **Off** for a purely vertical ripple, or to **Full** to shift everything by Max. Turn Edges to **Wrap pixels around**. A chain that can't be read elsewhere (one that reads the previous frame, or particles) is refused on the card: put a **Pass** after it and wire its Texture into **Source texture** instead. A Pass's Texture also works as the **Map texture**.`,
  };
  return {
    displaceNoiseMap: {
      ...DISPLACEMENT_EXAMPLE_INDEX.displaceNoiseMap,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 160, note('UV: this pixel\'s place in the picture (centred, a picture height is 2). Inside the Source ƒ chain it is the pushed place instead, which is what moves the tiles.')),
        n('time', 'time', 40, 760, note('Time: seconds since the clock started. It drifts the noise (so the push keeps changing) and slowly scrolls the tiles.')),
        n('truchet', 'tiles', 320, 120, { scale: 10, animate: 0.1,
          ...note('The Source: a Truchet pattern of arcs, easy to read when it bends. Any colour chain that is a function of position works here (shapes, noise, a Texture Input).') },
          { uv: ['uv', 'uv'], time: ['time', 'time'] }),
        n('fbm', 'noise', 320, 760, { scale: 2.5, time_scale: 0.15, octaves: 4,
          ...note('The Map: slow fractal noise, grey from dark to light. Its brightness at each pixel says how far that pixel is pushed.') },
          { uv: ['uv', 'uv'], time: ['time', 'time'] }),
        n('displacementMap', 'disp', 720, 400, { hChan: 'luminance', vChan: 'luminance', maxH: 90, maxV: 90, edges: 'clamp',
          ...note('Displacement Map: reads the Map (the noise) at this pixel, turns its Luminance into a push (mid-grey = none, white = +Max, black = −Max) and reads the Source ƒ chain (the tiles) that far away. Max 90: up to 90 pixels of a 1080-tall picture each way.') },
          { source: ['tiles', 'color'], map: ['noise', 'value'] }),
        n('output', 'out', 1080, 400, note('Output: the pushed tiles.'), { color: ['disp', 'color'] }),
      ],
      play,
    },
  };
}
