/**
 * curatedExamples.ts — examples built for the curated Examples lists (docs/examples-curation-proposal.md,
 * the user's feedback of 2026-10-19), where a category needed a better showpiece than it had:
 *
 *  - perspectivePlanes (2D: Shapes, Space & Colour): one Perspective 2D, folded by a Mirror 2D, makes the floor and
 *    the ceiling of a long, dim hall at once, lit by one row of ceiling panels that the polished floor reflects.
 *    Replaces Neon Floor Grid. Rebuilt from small nodes only (2026-10-19: no Expression Blocks where nodes exist).
 *
 * Built from the node definitions (graphBuilder.ts), every node with a note.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n, nv } from './graphBuilder';

export const CURATED_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  perspectivePlanes: {
    label: 'Perspective 2D: a hall of lights',
    description: 'One Perspective 2D, folded by a Mirror 2D, turns the flat picture into both the floor and the ceiling of a long hall, meeting at a horizon in the middle. A row of light panels runs down the ceiling, and because the floor is the ceiling mirrored, it shows them reflected like polished concrete. You walk forward; the far end sinks into the dark. Flat 2D and small nodes only: no ray march, no code.',
  },
};

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

function hallOfLights(): GraphNode[] {
  return [
    n('uv', 'uv', 40, 360, note('UV: this pixel, centred, the frame 2 tall (−1 at the bottom, +1 at the top). The horizon will be the middle line, y = 0.')),
    n('time', 'time', 40, 620, note('Time: walks you down the hall.')),
    n('mirror2D', 'fold', 300, 360, { axes: 'y', ...note([
      'Mirror 2D (Y): folds the bottom half of the picture onto the top, so every row below the horizon reads the same as the row the same distance above it.',
      'Why: the floor and the ceiling of a hall are the same plane seen from above and below. Folding the picture makes one Perspective 2D draw both, and whatever hangs on the ceiling appears again in the floor, upside down, like a reflection in polished stone.',
    ]) }, { uv: ['uv', 'uv'] }),
    n('transform', 'horizon', 560, 360, { dim: '2', y: 1, ...note('Transform (Move Y 1): moves the folded picture down by 1, so the middle line (y = 0) lands where Perspective 2D (Flip) puts its horizon, at y = −1.') }, { p: ['fold', 'uv'] }),
    n('perspective2d', 'plane', 820, 360, { ratio: 1, axis: 'y', flip: 'true', ...note([
      'Perspective 2D (Y, Flip): the whole trick. It divides the picture by its distance from the horizon, so rows near the horizon stretch over huge distances and rows at the top and bottom of the frame over short ones: a flat plane seen at a slant, one unit from the eye.',
      'Its UV is the plane\'s own coordinates: x across the hall, y along it. Depth is 0 at the top and bottom of the frame and 1 at the horizon.',
    ]) }, { uv: ['horizon', 'p'] }),
    n('makeVec2', 'stride', 820, 620, { x: 0, ...note('Make Vec2 (0, Time): how far you have walked, one unit a second, straight down the hall.') }, { y: ['time', 'time'] }),
    n('transform', 'walk', 1080, 360, { dim: '2', ...note('Transform (Offset from the walk): slides the plane\'s coordinates along the hall as time passes, so the panels and the slabs come towards you.') }, { p: ['plane', 'uv'], offset: ['stride', 'xy'] }),

    // The light panels: one every 3 units down the middle of the ceiling (and so, mirrored, of the floor).
    n('infiniteRepeatSpace', 'panelRow', 1340, 180, { cellX: 1000, cellY: 3, ...note('Infinite Repeat (Cell Y 3): one panel every 3 units along the hall. Cell X is huge, so there is only the one row, down the middle.') }, { input: ['walk', 'p'] }),
    n('boxSDF', 'panel', 1600, 180, { width: 0.9, height: 0.25, ...note('Box SDF: a light panel 1.8 wide and 0.5 deep, as a distance (negative inside).') }, { position: ['panelRow', 'output'] }),
    n('light', 'spill', 1860, 40, { mode: 'glow', brightness: 2.2, tint: [0.55, 0.45, 0.34], ...note([
      'SDF Glow (Glow, Falloff 2.2): the panel\'s light spilling onto the concrete round it, fading over about half a unit, warm.',
      'On the floor the same light is the panel\'s reflection, streaking towards you.',
    ]) }, { distance: ['panel', 'distance'] }),
    n('sdfFill', 'lamp', 1860, 220, { fillColor: [3, 2.6, 2.05], ...note([
      'SDF Fill: the panel itself, a crisp warm white (about 3000 K) set well above 1 so it stays the brightest thing in frame after the tone map, over its own spill (Background).',
    ]) }, { d: ['panel', 'distance'], background: ['spill', 'tinted'] }),

    // The concrete: slabs 2 × 2 units with thin dark seams.
    n('infiniteRepeatSpace', 'slabGrid', 1340, 520, { cellX: 2, cellY: 2, ...note('Infinite Repeat (2 × 2): concrete slabs 2 units square, on the floor and the ceiling.') }, { input: ['walk', 'p'] }),
    n('boxSDF', 'slab', 1600, 520, { width: 0.97, height: 0.97, ...note('Box SDF: one slab, a hair smaller than its cell, so a thin seam is left between neighbours.') }, { position: ['slabGrid', 'output'] }),
    n('sdfFill', 'concrete', 1860, 520, { fillColor: [0.12, 0.122, 0.13], ...note('SDF Fill: the slab in a dark concrete grey; the seams (outside every slab) stay black, its Background.') }, { d: ['slab', 'distance'] }),
    n('addColor', 'lit', 2120, 360, { ...note('Add Colours: the concrete plus the panels\' light on it.') }, { a: ['concrete', 'result'], b: ['lamp', 'result'] }),

    // Floor dimmer than the ceiling, and stronger at a glancing angle: a reflection's Fresnel.
    n('splitVec2', 'height', 1860, 760, note('Split Vec2: the pixel\'s height in the frame (Y): below 0 is the floor, above 0 the ceiling.'), { v: ['uv', 'uv'] }),
    n('remap', 'gloss', 2120, 760, { inMin: -0.9, inMax: 0.04, outMin: 0.1, outMax: 1, smooth: 'smoothstep', clamp: true, ...note([
      'Remap (Smoothstep) of the height: 1 on the ceiling. On the floor, which shows the ceiling only as a reflection, it is faint looking straight down (0.1 at the bottom of the frame) and strong towards the horizon, where you see the floor at a glancing angle: a polished floor\'s Fresnel.',
    ]) }, { value: ['height', 'y'] }),
    nv('vec3', 'multiply', 'shown', 2380, 360, note('Multiply: the hall times that: the ceiling bright, its reflection in the floor dimmer and strongest near the horizon.'), { a: ['lit', 'result'], b: ['gloss', 'result'] }),

    // The far end sinks into the dark.
    n('remap', 'far', 2380, 620, { inMin: 0.8, inMax: 1, outMin: 0, outMax: 1, smooth: 'smoothstep', clamp: true, ...note('Remap (Smoothstep) of Depth: 0 nearby, easing to 1 towards the horizon: how much haze lies between you and this part of the hall. It also stops the far slabs shimmering.') }, { value: ['plane', 'depth'] }),
    n('colorPicker', 'haze', 2380, 820, { color: [0.075, 0.07, 0.068], ...note('Colour: the haze at the end of the hall, a dim warm grey lit by the panels.') }),
    nv('vec3', 'mix', 'fogged', 2640, 360, note('Mix: the hall fading into the haze with distance, so the far end closes in a soft glow instead of a hard black line.'), { a: ['shown', 'result'], b: ['haze', 'rgb'], t: ['far', 'result'] }),
    n('toneMap', 'tone', 2900, 360, { mode: 'aces', ...note('Tone Map (ACES): the panels go well above 1; a film curve rolls them off so they glow instead of clipping flat.') }, { color: ['fogged', 'result'] }),
    n('vignette', 'vig', 3160, 360, { radius: 0.7, softness: 0.6, strength: 0.6, ...note('Vignette: darkens the corners, holding the eye down the hall.') }, { color: ['tone', 'color'], uv: ['uv', 'uv'] }),
    n('grain', 'grain', 3420, 360, { mode: 'temporal', amount: 0.012, ...note('Grain: fine film noise, so the long dark gradients don\'t band.') }, { color: ['vig', 'result'], uv: ['uv', 'uv'], time: ['time', 'time'] }),
    n('output', 'out', 3680, 360, note('Output: the hall.'), { color: ['grain', 'color'] }),
  ];
}

export function buildCuratedExamples(): Record<string, ExampleGraph> {
  return {
    perspectivePlanes: { ...CURATED_EXAMPLE_INDEX.perspectivePlanes, counter: 30, nodes: hallOfLights() },
  };
}
