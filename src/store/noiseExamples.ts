/**
 * noiseExamples.ts — the Noise node and Voronoi's cell features (docs/noise-node.md): marble, clouds that change in
 * place, contour lines, a flow from Slope, Worley times Perlin (the Noise folder), and cracked earth, stained glass,
 * living cells, dots at the cell centers and square tiles from the Metric (the Noise: cells folder).
 * Built from the node definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';

type Entry = { label: string; description: string; play?: true };

export const NOISE_EXAMPLE_INDEX: Record<string, Entry> = {
  noiseMarble: {
    label: 'Noise · Marble from Distortion', play: true,
    description: 'Perlin noise with Distortion bends straight stripes into marble veins. A sine of (x + noise) makes the bands, a Colour Ramp turns them into stone. Raise Distortion for wilder swirls.',
  },
  noiseCloudsInPlace: {
    label: 'Noise · Clouds that change in place', play: true,
    description: '4D Simplex noise uses Time on its two extra axes, so the clouds boil and reform where they are instead of sliding past, and the motion loops seamlessly. Smoothstep picks how much of the sky is cloud.',
  },
  noiseContourMap: {
    label: 'Noise · Terrain with contour lines',
    description: 'One Noise read as height: a Colour Ramp paints it as sea, sand, grass, rock and snow, and Fract of the height draws a contour line at every step, like a hiking map.',
  },
  noiseSlopeFlow: {
    label: 'Noise · Flow from the Slope output',
    description: 'The Noise node\'s Slope says which way the noise rises. Turned a quarter turn it runs along the hills instead of up them (a curl flow), and Displace pushes fine stripes along it: swirling, flowing lines that never cross.',
  },
  noiseWorleyPerlin: {
    label: 'Noise · Worley × Perlin',
    description: 'Two Noise nodes multiplied: Worley cells (inverted, so each cell has a bright heart) times distorted Perlin clouds. The cells glow through the clouds like something alive; both change in place over time.',
  },
  voronoiCrackedEarth: {
    label: 'Noise: cells · Cracked earth', play: true,
    description: 'Voronoi\'s Distance to edge is the exact distance to the nearest cell border, so a small threshold draws cracks of an even width. Cell colour varies each plate\'s mud, Noise adds grit, and a Noise Slope makes the cracks wander.',
  },
  voronoiStainedGlass: {
    label: 'Noise: cells · Stained glass',
    description: 'Every Voronoi cell a pane: Cell colour picks its jewel tone through a Palette, Distance to edge lights it brighter in the middle and draws the lead lines. The panes drift slowly with Time.',
  },
  voronoiLivingCells: {
    label: 'Noise: cells · Living cells (F2 − F1)',
    description: 'Voronoi\'s Edge (F2 − F1) is 0 on every border and grows into each cell, which reads as soft, rounded cells. A moving Noise Slope wobbles the UV first, so the cells squirm like a culture under a microscope.',
  },
  voronoiCellDots: {
    label: 'Noise: cells · A dot at every cell center',
    description: 'Cell position is the nearest cell center back in UV, so a Circle SDF centred on it draws one dot per cell, each sized and coloured by its Cell colour. The centers drift with Time and the dots follow.',
  },
  voronoiMetricTiles: {
    label: 'Noise: cells · Square tiles from the Metric',
    description: 'Voronoi with Metric set to Chebyshev measures distance as the larger of the x and y gaps, so cells come out as squares and rectangles. Edge (F2 − F1) draws the grout, Cell colour the tiles. Try Manhattan for diamonds.',
  },
};
export const NOISE_EXAMPLE_KEYS = Object.keys(NOISE_EXAMPLE_INDEX);

const uvNode = (x = 40, y = 300) => n('uv', 'uv', x, y, note(['UV: this pixel\'s place in the picture, about −1 to 1 each way (wider across).']));
const timeNode = (x = 40, y = 560) => n('time', 'clock', x, y, note(['Time: seconds since the start, the clock the pattern moves with.']));

export function buildNoiseExamples(): Record<string, ExampleGraph> {
  const I = NOISE_EXAMPLE_INDEX;
  const about = (e: Entry) => ({ label: e.label, description: e.description });
  return {
    noiseMarble: {
      ...about(I.noiseMarble), counter: 20,
      nodes: [
        uvNode(),
        n('noise', 'nz', 320, 120, {
          kind: 'perlin', dims: '2d', scale: 2.2, detail: 5, roughness: 0.55, distortion: 1.1,
          ...note(['Noise, Perlin 2D: smooth, natural noise. Detail 5 stacks finer layers for grain; Distortion 1.1 pushes the pattern around by a broader Perlin noise, which folds it into swirls. Its Value (0–1) bends the stripes below.']),
        }, { uv: ['uv', 'uv'] }),
        n('splitVec2', 'xy', 320, 420, note(['Split Vec2: the pixel\'s x, which the stripes run across.']), { v: ['uv', 'uv'] }),
        n('multiply', 'bend', 620, 120, { b: 9, ...note(['Multiply: the noise × 9, how far it bends each stripe (in stripe phase).']) }, { a: ['nz', 'value'] }),
        n('multiply', 'bands', 620, 420, { b: 5, ...note(['Multiply: x × 5, straight stripes across the picture before the noise bends them.']) }, { a: ['xy', 'x'] }),
        n('add', 'phase', 880, 260, note(['Add: stripes + noise. Where the noise is high the stripe moves along, so straight bands become veins.']), { a: ['bands', 'result'], b: ['bend', 'result'] }),
        n('sin', 'wave', 1120, 260, note(['Sin: a smooth wave over the bent stripes, −1 to 1.']), { input: ['phase', 'result'] }),
        n('abs', 'fold', 1360, 260, note(['Abs: folds the wave so every crossing of 0 becomes a thin dark vein between pale bands.']), { input: ['wave', 'output'] }),
        n('pow', 'sharpen', 1600, 260, { exponent: 0.35, ...note(['Pow 0.35: lifts everything but the very bottom, so the veins stay thin and the stone stays pale.']) }, { base: ['fold', 'output'] }),
        n('colorRamp', 'stone', 1840, 260, {
          stops: '3', color0: [0.13, 0.15, 0.17], color1: [0.62, 0.6, 0.58], color2: [0.95, 0.94, 0.91],
          ...note(['Colour Ramp: dark grey veins, warm grey, then near-white stone.']),
        }, { t: ['sharpen', 'result'] }),
        n('output', 'out', 2080, 260, {}, { color: ['stone', 'color'] }),
      ],
      play: play([
        ctl('distortion', 'nz::distortion', 'Distortion (swirl)', 0, 4, 0.01),
        ctl('scale', 'nz::scale', 'Noise scale', 0.5, 8, 0.01),
      ], `**What it shows.** The Noise node's **Distortion** pushes the noise around by a broader noise of the same kind (a domain warp), which is what turns soft clouds into folded marble. Here the noise bends straight stripes, and a sine of the bent stripes draws the veins.

**How it is built.** UV → Noise (Perlin, 2D, Detail 5, Distortion 1.1). x × 5 plus Value × 9 → Sin → Abs → Pow 0.35 → Colour Ramp (veins to stone).

**Try.** Drag *Distortion* from 0 (gently wavy stripes) to 4 (molten). Set Kind to Simplex or Value for other stones.`),
    },

    noiseCloudsInPlace: {
      ...about(I.noiseCloudsInPlace), counter: 20,
      nodes: [
        uvNode(),
        timeNode(),
        n('noise', 'nz', 320, 200, {
          kind: 'simplex', dims: '4d', scale: 1.6, detail: 6, roughness: 0.55, speed: 0.35,
          ...note(['Noise, Simplex 4D: x and y are the picture, the other two axes go round a circle with Time × Speed. The clouds change where they are instead of sliding, and the motion repeats every 6.28 ÷ Speed seconds (18 s here). Detail 6 gives wispy edges.']),
        }, { uv: ['uv', 'uv'], time: ['clock', 'time'] }),
        n('smoothstep', 'cover', 620, 200, { edge0: 0.45, edge1: 0.8, ...note(['Smoothstep: noise below 0.45 is clear sky, above 0.8 thick cloud, a soft edge between. Lower the first edge for more cloud.']) }, { value: ['nz', 'value'] }),
        n('gradient', 'sky', 620, 460, { mode: 'linear_y', color_a: [0.45, 0.68, 0.95], color_b: [0.1, 0.3, 0.7], ...note(['Gradient: the sky, pale at the horizon (bottom) to deep blue at the top.']) }, { uv: ['uv', 'uv'] }),
        n('colorPicker', 'white', 620, 700, { color: [0.97, 0.97, 1.0], ...note(['Colour: the clouds\' white.']) }),
        nv('vec3', 'mix', 'clouds', 900, 400, note(['Mix: sky where the cover is 0, white cloud where it is 1.']), { a: ['sky', 'color'], b: ['white', 'rgb'], t: ['cover', 'result'] }),
        n('output', 'out', 1160, 400, {}, { color: ['clouds', 'result'] }),
      ],
      play: play([
        ctl('speed', 'nz::speed', 'Cloud speed', 0, 1.5, 0.01),
        ctl('cover', 'cover::edge0', 'Clear sky (lower = more cloud)', 0.2, 0.7, 0.01),
      ], `**What it shows.** A 3D or 4D Noise spends its extra axes on Time, so the picture **changes in place** rather than sliding. 4D goes round a circle, so the loop is seamless: good for a video that repeats.

**How it is built.** UV and Time → Noise (Simplex, 4D, Detail 6, Speed 0.35) → Smoothstep (how much is cloud) → Mix between a sky Gradient and white.

**Try.** Raise *Cloud speed* for a storm. Switch Dimensions to 2D to see the same clouds slide instead.`),
    },

    noiseContourMap: {
      ...about(I.noiseContourMap), counter: 20,
      nodes: [
        uvNode(),
        n('noise', 'nz', 320, 260, {
          kind: 'perlin', dims: '2d', scale: 1.6, detail: 3.5, roughness: 0.45, offsetX: 3.2,
          ...note(['Noise, Perlin 2D: read as the height of the land, 0 the sea bed and 1 the peaks. Detail 3.5 roughs up the coastline (more would make the contour lines ragged); Offset X picks a nice piece of map.']),
        }, { uv: ['uv', 'uv'] }),
        n('colorRamp', 'land', 640, 120, {
          stops: '5', color0: [0.05, 0.2, 0.45], color1: [0.85, 0.8, 0.55], color2: [0.25, 0.55, 0.22], color3: [0.45, 0.38, 0.3], color4: [0.96, 0.96, 0.98],
          ...note(['Colour Ramp: sea, sand, grass, rock and snow, from low to high.']),
        }, { t: ['height', 'result'] }),
        n('remap', 'height', 640, 640, { inMin: 0.25, inMax: 0.75, outMin: 0, outMax: 1, ...note(['Remap: the noise mostly lies between 0.25 and 0.75; stretched to 0–1 so the map reaches the sea and the snow.']) }, { value: ['nz', 'value'] }),
        n('multiply', 'steps', 640, 420, { b: 14, ...note(['Multiply: height × 14, so each whole number is one contour step.']) }, { a: ['height', 'result'] }),
        n('fractRaw', 'withinStep', 880, 420, note(['Fract: how far into its step each pixel is, 0 to 1; it jumps back to 0 at every contour.']), { input: ['steps', 'result'] }),
        n('subtract', 'centre', 1120, 420, { b: 0.5, ...note(['Subtract 0.5: −0.5 to 0.5, so the contour (the jump) is where this is furthest from 0.']) }, { a: ['withinStep', 'output'] }),
        n('abs', 'away', 1360, 420, note(['Abs: 0.5 right at a contour, 0 halfway between two.']), { input: ['centre', 'result'] }),
        n('smoothstep', 'line', 1600, 420, { edge0: 0.43, edge1: 0.49, ...note(['Smoothstep: 1 within a hair of the contour, 0 elsewhere: a thin line.']) }, { value: ['away', 'output'] }),
        n('multiply', 'ink', 1840, 420, { b: 0.6, ...note(['Multiply 0.6: how dark the lines are.']) }, { a: ['line', 'result'] }),
        n('colorPicker', 'inkColour', 1840, 640, { color: [0.12, 0.08, 0.05], ...note(['Colour: the dark brown of the contour ink.']) }),
        nv('vec3', 'mix', 'map', 2080, 260, note(['Mix: the land colours, with the ink laid over where the lines are.']), { a: ['land', 'color'], b: ['inkColour', 'rgb'], t: ['ink', 'result'] }),
        n('output', 'out', 2320, 260, {}, { color: ['map', 'result'] }),
      ],
    },

    noiseSlopeFlow: {
      ...about(I.noiseSlopeFlow), counter: 20,
      nodes: [
        uvNode(),
        timeNode(),
        n('noise', 'nz', 320, 120, {
          kind: 'simplex', dims: '3d', scale: 1.4, detail: 1.5, roughness: 0.5, speed: 0.12,
          ...note(['Noise, Simplex 3D, slowly changing in place. Its Slope output is the way the noise rises (and how steeply), in UV units; Value colours the picture at the end.']),
        }, { uv: ['uv', 'uv'], time: ['clock', 'time'] }),
        n('splitVec2', 'slope', 600, 120, note(['Split Vec2: the slope\'s x and y.']), { v: ['nz', 'slope'] }),
        n('negate', 'minusY', 840, 40, note(['Negate: −y, half of the quarter turn.']), { input: ['slope', 'y'] }),
        n('makeVec2', 'curl', 1080, 120, note(['Make Vec2: (−y, x), the slope turned a quarter turn. It points along the hills, never up them, so the flow swirls round and never bunches up (a curl flow).']), { x: ['minusY', 'output'], y: ['slope', 'x'] }),
        n('displace', 'push', 1320, 300, { amount: 0.05, ...note(['Displace: moves each pixel\'s UV along the flow by 0.05 × its strength.']) }, { input: ['uv', 'uv'], offset: ['curl', 'xy'] }),
        n('splitVec2', 'pushed', 1560, 300, note(['Split Vec2: the moved UV\'s y, which the stripes follow.']), { v: ['push', 'output'] }),
        n('sin', 'stripes', 1800, 300, { freq: 60, ...note(['Sin × 60: fine horizontal stripes, drawn in the moved UV so they follow the flow.']) }, { input: ['pushed', 'y'] }),
        n('smoothstep', 'lines', 2040, 300, { edge0: 0.6, edge1: 0.95, ...note(['Smoothstep: only the tops of the wave: thin bright lines.']) }, { value: ['stripes', 'output'] }),
        n('palette', 'tint', 1800, 40, { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.0, 0.15, 0.3], ...note(['Palette: a colour from the noise Value, so each region of the flow has its own hue.']) }, { value: ['nz', 'value'] }),
        nv('vec3', 'multiply', 'lit', 2280, 200, note(['Multiply: the colour where the lines are, black between them.']), { a: ['tint', 'color'], b: ['linesRgb', 'rgb'] }),
        n('floatToVec3', 'linesRgb', 2280, 420, note(['Float → Colour: the line mask as grey, to multiply the colour by.']), { input: ['lines', 'result'] }),
        n('output', 'out', 2520, 200, {}, { color: ['lit', 'result'] }),
      ],
    },

    noiseWorleyPerlin: {
      ...about(I.noiseWorleyPerlin), counter: 20,
      nodes: [
        uvNode(),
        timeNode(),
        n('noise', 'cells', 320, 120, {
          kind: 'worley', dims: '3d', scale: 3.5, detail: 0.6, roughness: 0.4, speed: 0.25,
          ...note(['Noise, Worley 3D: the distance to the nearest of many random points, so dark spots with bright borders. 3D with Speed lets the points wander in place. Detail 0.6 blends in a little of a finer layer.']),
        }, { uv: ['uv', 'uv'], time: ['clock', 'time'] }),
        n('remap', 'hearts', 620, 120, { inMin: 0.0, inMax: 0.7, outMin: 1.0, outMax: 0.0, ...note(['Remap: turns it over, 1 at each point and 0 by the borders, so each cell has a bright heart.']) }, { value: ['cells', 'value'] }),
        n('noise', 'clouds', 320, 460, {
          kind: 'perlin', dims: '3d', scale: 1.8, detail: 4, roughness: 0.5, distortion: 0.8, speed: 0.15,
          ...note(['Noise, Perlin 3D with Distortion 0.8: soft, swirling clouds that change in place.']),
        }, { uv: ['uv', 'uv'], time: ['clock', 'time'] }),
        n('multiply', 'both', 880, 300, note(['Multiply: the hearts only show where the clouds are bright, and the clouds only where there is a heart.']), { a: ['hearts', 'result'], b: ['clouds', 'value'] }),
        n('remap', 'contrast', 1120, 300, { inMin: 0.08, inMax: 0.5, outMin: 0, outMax: 1, ...note(['Remap: stretches the product (about 0.08 to 0.5) to 0–1, so the dim parts sit in black and the hearts reach full glow.']) }, { value: ['both', 'result'] }),
        n('colorRamp', 'glow', 1360, 300, {
          stops: '4', color0: [0.0, 0.0, 0.02], color1: [0.1, 0.05, 0.35], color2: [0.2, 0.75, 0.7], color3: [0.95, 1.0, 0.85],
          ...note(['Colour Ramp: black, violet, teal, then near-white at the brightest hearts.']),
        }, { t: ['contrast', 'result'] }),
        n('output', 'out', 1600, 300, {}, { color: ['glow', 'color'] }),
      ],
    },

    voronoiCrackedEarth: {
      ...about(I.voronoiCrackedEarth), counter: 24,
      nodes: [
        uvNode(),
        n('noise', 'wobble', 320, 60, {
          kind: 'perlin', dims: '2d', scale: 2.5, detail: 2, roughness: 0.5,
          ...note(['Noise, Perlin 2D: its Slope bends the UV a little so the cracks wander instead of running dead straight.']),
        }, { uv: ['uv', 'uv'] }),
        n('displace', 'bend', 600, 200, { amount: 0.025, ...note(['Displace: nudges the UV along the noise Slope by 0.025.']) }, { input: ['uv', 'uv'], offset: ['wobble', 'slope'] }),
        n('voronoi', 'plates', 860, 200, {
          scale: 4.5, jitter: 1,
          ...note(['Voronoi: one plate of dried mud per cell. Distance to edge is the exact distance to the nearest border (the same width everywhere); Cell colour is a steady random colour per plate.']),
        }, { uv: ['bend', 'output'] }),
        n('subtract', 'crack', 1140, 120, { b: 0.035, ...note(['Subtract 0.035: below 0 within 0.035 of a border, which is the crack. Its width is a Play control.']) }, { a: ['plates', 'edgeDist'] }),
        n('splitVec3', 'tone', 1140, 380, note(['Split Vec3: one channel of the plate\'s random colour, used as how light its mud is.']), { v: ['plates', 'cellColour'] }),
        n('colorPicker', 'mudDark', 1140, 600, { color: [0.36, 0.24, 0.15], ...note(['Colour: the darker mud.']) }),
        n('colorPicker', 'mudLight', 1140, 800, { color: [0.72, 0.56, 0.38], ...note(['Colour: the lighter, drier mud.']) }),
        nv('vec3', 'mix', 'mud', 1400, 500, note(['Mix: each plate somewhere between dark and light mud.']), { a: ['mudDark', 'rgb'], b: ['mudLight', 'rgb'], t: ['tone', 'x'] }),
        n('noise', 'grit', 1400, 780, {
          kind: 'value', dims: '2d', scale: 40, detail: 3, roughness: 0.6,
          ...note(['Noise, Value 2D at Scale 40: fine grit over the mud.']),
        }, { uv: ['uv', 'uv'] }),
        n('remap', 'gritAmount', 1640, 780, { inMin: 0, inMax: 1, outMin: 0.75, outMax: 1.1, ...note(['Remap: the grit as a brightness from 0.75 to 1.1.']) }, { value: ['grit', 'value'] }),
        n('floatToVec3', 'gritRgb', 1880, 780, note(['Float → Colour: the grit brightness as grey.']), { input: ['gritAmount', 'result'] }),
        nv('vec3', 'multiply', 'gritty', 1880, 500, note(['Multiply: the mud × the grit.']), { a: ['mud', 'result'], b: ['gritRgb', 'rgb'] }),
        n('colorPicker', 'gap', 1640, 120, { color: [0.07, 0.04, 0.03], ...note(['Colour: the dark inside of a crack.']) }),
        n('sdfFill', 'paint', 2120, 300, { ...note(['SDF Fill on the crack distance: the dark crack colour inside it, the gritty mud outside.']) }, { d: ['crack', 'result'], fillColor: ['gap', 'rgb'], background: ['gritty', 'result'] }),
        n('output', 'out', 2360, 300, {}, { color: ['paint', 'result'] }),
      ],
      play: play([
        ctl('width', 'crack::b', 'Crack width', 0, 0.12, 0.001),
        ctl('size', 'plates::scale', 'Plates (more = smaller)', 1, 12, 0.1),
      ], `**What it shows.** Voronoi's **Distance to edge** is the exact distance to the nearest cell border (Inigo Quilez's two-pass method), so subtracting a width draws cracks of an even thickness, unlike F1 or F2 − F1, which thin out at corners. **Cell colour** gives each plate its own shade.

**How it is built.** UV → Displace by a Perlin Noise's Slope (wandering cracks) → Voronoi. Distance to edge − width → SDF Fill (crack colour inside). Cell colour → Mix between two muds, × Value-noise grit → the Fill's background.

**Try.** Widen the cracks with *Crack width*; set the Voronoi's Metric to Chebyshev for squared-off plates.`),
    },

    voronoiStainedGlass: {
      ...about(I.voronoiStainedGlass), counter: 20,
      nodes: [
        uvNode(),
        timeNode(),
        n('voronoi', 'panes', 320, 260, {
          scale: 3.5, jitter: 0.9, time_scale: 0.08,
          ...note(['Voronoi: each cell a pane of glass, drifting slowly with Time. Cell colour picks the pane\'s tint; Distance to edge is how far into the pane a pixel is.']),
        }, { uv: ['uv', 'uv'], time: ['clock', 'time'] }),
        n('splitVec3', 'pick', 620, 120, note(['Split Vec3: one random number per pane, from its Cell colour.']), { v: ['panes', 'cellColour'] }),
        n('palette', 'jewel', 860, 120, { offset: [0.5, 0.45, 0.5], amplitude: [0.5, 0.5, 0.45], freq: [1, 1, 1], phase: [0.0, 0.33, 0.67], ...note(['Palette: turns the pane\'s number into a rich jewel colour (a cosine rainbow).']) }, { value: ['pick', 'x'] }),
        n('remap', 'light', 860, 400, { inMin: 0, inMax: 0.35, outMin: 0.45, outMax: 1.35, ...note(['Remap: the distance into the pane as brightness: dim by the lead, bright in the middle, as if lit from behind.']) }, { value: ['panes', 'edgeDist'] }),
        n('floatToVec3', 'lightRgb', 1100, 400, note(['Float → Colour: that brightness as grey.']), { input: ['light', 'result'] }),
        nv('vec3', 'multiply', 'glass', 1340, 200, note(['Multiply: each pane\'s colour × its light.']), { a: ['jewel', 'color'], b: ['lightRgb', 'rgb'] }),
        n('subtract', 'lead', 1100, 640, { b: 0.03, ...note(['Subtract 0.03: below 0 near a border, where the lead line goes.']) }, { a: ['panes', 'edgeDist'] }),
        n('colorPicker', 'leadColour', 1340, 640, { color: [0.06, 0.06, 0.07], ...note(['Colour: the near-black lead.']) }),
        n('sdfFill', 'window', 1580, 400, { ...note(['SDF Fill: lead where the distance is below 0, glass everywhere else.']) }, { d: ['lead', 'result'], fillColor: ['leadColour', 'rgb'], background: ['glass', 'result'] }),
        n('output', 'out', 1820, 400, {}, { color: ['window', 'result'] }),
      ],
    },

    voronoiLivingCells: {
      ...about(I.voronoiLivingCells), counter: 20,
      nodes: [
        uvNode(),
        timeNode(),
        n('noise', 'squirm', 320, 80, {
          kind: 'simplex', dims: '3d', scale: 1.8, detail: 1, roughness: 0.5, speed: 0.3,
          ...note(['Noise, Simplex 3D changing in place: its Slope wobbles the UV, so the cells bend and squirm.']),
        }, { uv: ['uv', 'uv'], time: ['clock', 'time'] }),
        n('displace', 'wobble', 600, 260, { amount: 0.008, ...note(['Displace: moves the UV along the noise Slope by 0.008 × its steepness (the Slope is several units where the noise is steep).']) }, { input: ['uv', 'uv'], offset: ['squirm', 'slope'] }),
        n('voronoi', 'cells', 860, 260, {
          scale: 5, jitter: 1, time_scale: 0.15,
          ...note(['Voronoi: the cells. Edge is F2 − F1, the gap between the nearest and second-nearest centers: 0 on every border, growing towards each cell\'s middle, which gives soft rounded cells.']),
        }, { uv: ['wobble', 'output'], time: ['clock', 'time'] }),
        n('smoothstep', 'body', 1140, 200, { edge0: 0.0, edge1: 0.35, ...note(['Smoothstep: 0 at the membrane, 1 inside the cell, soft between.']) }, { value: ['cells', 'edge'] }),
        n('smoothstep', 'nucleus', 1140, 460, { edge0: 0.55, edge1: 0.7, ...note(['Smoothstep on Edge again, higher up: only the very middle of the bigger cells, the nucleus.']) }, { value: ['cells', 'edge'] }),
        n('colorPicker', 'membrane', 1140, 700, { color: [0.85, 0.95, 0.55], ...note(['Colour: the bright membrane.']) }),
        n('colorPicker', 'plasma', 1380, 700, { color: [0.1, 0.35, 0.3], ...note(['Colour: the cell\'s inside.']) }),
        nv('vec3', 'mix', 'cell', 1620, 300, note(['Mix: membrane at the borders, the cell\'s inside within.']), { a: ['membrane', 'rgb'], b: ['plasma', 'rgb'], t: ['body', 'result'] }),
        n('colorPicker', 'core', 1620, 600, { color: [0.95, 0.55, 0.75], ...note(['Colour: the nucleus pink.']) }),
        nv('vec3', 'mix', 'withNucleus', 1860, 400, note(['Mix: the nucleus over the cell where it shows.']), { a: ['cell', 'result'], b: ['core', 'rgb'], t: ['nucleus', 'result'] }),
        n('output', 'out', 2100, 400, {}, { color: ['withNucleus', 'result'] }),
      ],
    },

    voronoiCellDots: {
      ...about(I.voronoiCellDots), counter: 20,
      nodes: [
        uvNode(),
        timeNode(),
        n('voronoi', 'cells', 320, 260, {
          scale: 6, jitter: 1, time_scale: 0.2,
          ...note(['Voronoi: the cells drift with Time. Cell position is the nearest center in UV units (Cell density undone), so anything drawn there sits on the center; Cell colour is a random colour per cell.']),
        }, { uv: ['uv', 'uv'], time: ['clock', 'time'] }),
        n('splitVec3', 'rand', 620, 460, note(['Split Vec3: one of the cell\'s random numbers, for its dot\'s size.']), { v: ['cells', 'cellColour'] }),
        n('remap', 'size', 860, 460, { inMin: 0, inMax: 1, outMin: 0.012, outMax: 0.04, ...note(['Remap: a radius from 0.012 to 0.04 per cell, well inside the cell (about 0.17 across at density 6): each pixel only sees its own cell\'s center, so a dot bigger than its cell would be cut off at the border.']) }, { value: ['rand', 'y'] }),
        n('circleSDF', 'dot', 1100, 260, { ...note(['Circle SDF: a circle around the cell\'s center (Center from Cell position), its radius from the cell\'s random number.']) }, { position: ['uv', 'uv'], offset: ['cells', 'cellPos'], radius: ['size', 'result'] }),
        n('light', 'halo', 1340, 460, { mode: 'glow', brightness: 90, ...note(['SDF Glow on the dot\'s distance: a soft halo, tinted by the cell\'s colour.']) }, { distance: ['dot', 'distance'], tint: ['cells', 'cellColour'] }),
        n('sdfFill', 'paint', 1580, 260, { ...note(['SDF Fill: the dot in its cell\'s colour, the halo behind it.']) }, { d: ['dot', 'distance'], fillColor: ['cells', 'cellColour'], background: ['halo', 'tinted'] }),
        n('output', 'out', 1820, 260, {}, { color: ['paint', 'result'] }),
      ],
    },

    voronoiMetricTiles: {
      ...about(I.voronoiMetricTiles), counter: 20,
      nodes: [
        uvNode(),
        n('voronoi', 'tiles', 320, 260, {
          scale: 4, jitter: 0.6, metric: 'chebyshev',
          ...note(['Voronoi, Metric Chebyshev: distance is the larger of the x and y gaps, so each cell is a square-ish tile. Edge (F2 − F1) is 0 on the joints; Cell colour gives each tile its own colour. Switch Metric to Manhattan for diamonds, Euclidean for round cells.']),
        }, { uv: ['uv', 'uv'] }),
        n('smoothstep', 'grout', 620, 160, { edge0: 0.03, edge1: 0.08, ...note(['Smoothstep on Edge: 0 on the grout lines, 1 on the tile.']) }, { value: ['tiles', 'edge'] }),
        n('splitVec3', 'pick', 620, 400, note(['Split Vec3: one random number per tile.']), { v: ['tiles', 'cellColour'] }),
        n('palette', 'glaze', 860, 400, { offset: [0.55, 0.5, 0.45], amplitude: [0.35, 0.3, 0.3], freq: [1, 1, 1], phase: [0.0, 0.1, 0.25], ...note(['Palette: a glazed-tile colour from the tile\'s number, warm terracotta to teal.']) }, { value: ['pick', 'z'] }),
        n('colorPicker', 'mortar', 860, 640, { color: [0.82, 0.8, 0.74], ...note(['Colour: pale grout.']) }),
        nv('vec3', 'mix', 'floor', 1120, 300, note(['Mix: grout on the joints, glaze on the tiles.']), { a: ['mortar', 'rgb'], b: ['glaze', 'color'], t: ['grout', 'result'] }),
        n('output', 'out', 1360, 300, {}, { color: ['floor', 'result'] }),
      ],
    },
  };
}
