/**
 * kuwaharaExamples.ts — Kuwahara (docs/kuwahara.md): the painterly, oil-paint filter. An oil-painted photo, Classic
 * and Generalised side by side, a watercolour (Kuwahara, Posterize and paper grain), a painted noise landscape read
 * through Colour ƒ, a live painting ready for the webcam, and a comic look with Convolve's outline on top. All six
 * are listed in the Painterly folder. Built from the node definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';

export const KUWAHARA_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  kuwaharaOilPhoto: {
    label: 'Kuwahara: an oil-painted photo', play: true,
    description: 'The built-in Walkway cat photo through Kuwahara (Generalised): each pixel takes the average of the calmest part of the disc round it, so the fur and the stones turn into soft patches of paint while the cat\'s outline stays crisp. Radius is the brush size.',
  },
  kuwaharaClassicVsGeneralised: {
    label: 'Kuwahara: Classic and Generalised side by side', play: true,
    description: 'The Room and cat photo painted twice: Classic (four squares, the calmest one wins) on the left, Generalised (eight soft sectors, blended by how calm each is) on the right. Classic is blockier, with square strokes; Generalised is smoother and rounder.',
  },
  kuwaharaWatercolour: {
    label: 'Kuwahara: a watercolour', play: true,
    description: 'A soft Kuwahara turns the photo into flat washes, Posterize cuts them to a few tones like layers of paint, and a fine noise multiplies in the grain of the paper.',
  },
  kuwaharaPaintedLandscape: {
    label: 'Kuwahara: a painted noise landscape', play: true,
    description: 'Noise and the height up the picture, coloured by a Palette into bands of sky and hills, then painted by Kuwahara through Colour ƒ: the whole chain is worked out again at every read, so no Pass is needed (but Radius stops at 4 there).',
  },
  kuwaharaLivePainting: {
    label: 'Kuwahara: a live painting (try the webcam)', play: true,
    description: 'Kuwahara\'s Anisotropic kind on a picture: the brush strokes stretch along the edges, so they follow the shapes. It runs every frame, so switch the Texture card to Webcam (or a video) and you are painted live.',
  },
  kuwaharaComic: {
    label: 'Kuwahara: a comic with ink outlines', play: true,
    description: 'Classic Kuwahara and Posterize flatten the photo into cartoon colours; a Pass stores that, and Convolve\'s Outline finds the edges of the flat colours, drawn on top as black ink.',
  },
};
export const KUWAHARA_EXAMPLE_KEYS = Object.keys(KUWAHARA_EXAMPLE_INDEX);
/** All six are listed in the Painterly folder (the new-node folders may hold more than five: owner, 22 October 2026). */
export const KUWAHARA_SHOWCASE_KEYS = KUWAHARA_EXAMPLE_KEYS;

export function buildKuwaharaExamples(): Record<string, ExampleGraph> {
  return {
    kuwaharaOilPhoto: {
      ...KUWAHARA_EXAMPLE_INDEX.kuwaharaOilPhoto,
      counter: 20,
      nodes: [
        n('textureInput', 'photo', 40, 260, { fit: 'cover', ...builtinImageParams(WALKWAY_CAT_ID), ...note(['Texture Input: the built-in photo Walkway cat (a grey cat on a stone walkway). Choose your own picture on this card. Its Texture output is the picture itself, which Kuwahara reads at neighbouring pixels.']) }),
        n('kuwahara', 'paint', 380, 260, {
          kind: 'generalised', radius: 6, sharpness: 8, spacing: 1, mix: 1,
          ...note([
            'Kuwahara, Generalised: the disc round each pixel is cut into 8 soft sectors. Each sector\'s average colour and how much its colours vary are worked out; the calmest sectors count most. A sector that crosses an edge varies a lot, so the pixel takes its colour from its own side: edges stay sharp, flat areas become patches of paint.',
            'The photo comes in through Texture, the cheap way: about 110 reads a pixel at Radius 6.',
          ]),
        }, { texture: ['photo', 'texture'] }),
        n('output', 'out', 700, 260, note(['Output: the photo as an oil painting.']), { color: ['paint', 'colour'] }),
      ],
      play: play([
        ctl('radius', 'paint::radius', 'Brush size (Radius)', 1, 8, 0.5),
        ctl('sharpness', 'paint::sharpness', 'Sharpness', 1, 16, 0.5),
        ctl('mix', 'paint::mix', 'Paint mix', 0, 1, 0.01),
      ], `**What it shows.** The Kuwahara filter: for each pixel, find the calmest region round it and use its average. Smoothing that never crosses an edge, so a photo turns into brush strokes.

**How it is built.** Texture Input's Texture (Walkway cat) → Kuwahara's Texture, Kind Generalised, Radius 6 → Output.

**Try.** Drag *Brush size* from 1 to 8. Drop *Sharpness* to 2 for a soft blur-like wash, raise it to 16 for crisp strokes. *Paint mix* 0 shows the original.`),
    },

    kuwaharaClassicVsGeneralised: {
      ...KUWAHARA_EXAMPLE_INDEX.kuwaharaClassicVsGeneralised,
      counter: 20,
      nodes: [
        n('textureInput', 'photo', 40, 260, { fit: 'stretch', ...builtinImageParams(ROOM_AND_CAT_ID), ...note(['Texture Input: the built-in photo Room and cat (a warm-lit bedroom, a grey cat held close). Its Texture goes to both Kuwaharas.']) }),
        n('kuwahara', 'classic', 380, 120, {
          kind: 'classic', radius: 5, spacing: 1, mix: 1,
          ...note(['Kuwahara, Classic: four overlapping squares meet at the pixel (above left, above right, below left, below right). The one whose colours vary least wins outright, and the pixel takes its average. Blocky strokes, very crisp edges.']),
        }, { texture: ['photo', 'texture'] }),
        n('kuwahara', 'general', 380, 420, {
          kind: 'generalised', radius: 5, sharpness: 8, spacing: 1, mix: 1,
          ...note(['Kuwahara, Generalised: eight soft sectors of a disc instead of four squares, each read weighed by how far out it is, and the sectors blended by how calm they are rather than one picked. Rounder, smoother strokes, no square seams.']),
        }, { texture: ['photo', 'texture'] }),
        n('uv', 'uv', 380, 700, note(['UV: this pixel\'s place in the picture.'])),
        n('splitVec2', 'xy', 620, 700, note(['Split Vec2: the pixel\'s x, to split the picture down the middle.']), { v: ['uv', 'uv'] }),
        n('smoothstep', 'side', 860, 700, { edge0: -0.002, edge1: 0.002, ...note(['Smoothstep: 0 left of the middle, 1 right of it: which painting to show.']) }, { value: ['xy', 'x'] }),
        nv('vec3', 'mix', 'split', 1100, 300, note(['Mix: Classic on the left, Generalised on the right.']), { a: ['classic', 'colour'], b: ['general', 'colour'], t: ['side', 'result'] }),
        n('output', 'out', 1380, 300, note(['Output: the two kinds side by side.']), { color: ['split', 'result'] }),
      ],
      play: play([
        ctl('classicR', 'classic::radius', 'Classic radius', 1, 8, 0.5),
        ctl('generalR', 'general::radius', 'Generalised radius', 1, 8, 0.5),
        ctl('sharp', 'general::sharpness', 'Generalised sharpness', 1, 16, 0.5),
      ], `**What it shows.** The two Kuwaharas on the same photo. Classic compares four squares and picks one, so strokes come out square and blocky. Generalised compares eight soft sectors and blends them, which looks more like real paint.

**How it is built.** Texture Input → two Kuwaharas (Classic, Generalised) → a Mix split down the middle by UV's x.

**Try.** Set both radii to 8 and look at the cat's face. Drop *Generalised sharpness* to 1: the sectors blend evenly and it becomes a soft blur.`),
    },

    kuwaharaWatercolour: {
      ...KUWAHARA_EXAMPLE_INDEX.kuwaharaWatercolour,
      counter: 20,
      nodes: [
        n('textureInput', 'photo', 40, 260, { fit: 'stretch', ...builtinImageParams(ROOM_AND_CAT_ID), ...note(['Texture Input: the built-in photo Room and cat, read as a Texture by Kuwahara.']) }),
        n('kuwahara', 'wash', 340, 260, {
          kind: 'generalised', radius: 5, sharpness: 4, spacing: 1.5, mix: 1,
          ...note(['Kuwahara, Generalised with a low Sharpness (4): the sectors blend gently, so the photo turns into soft, flat washes of colour. Spacing 1.5 spreads the reads for a bigger brush at the same cost.']),
        }, { texture: ['photo', 'texture'] }),
        n('posterize', 'layers', 620, 260, { levels: 7, ...note(['Posterize: each colour cut to 7 steps, like layers of watercolour laid one over another.']) }, { color: ['wash', 'colour'] }),
        n('uv', 'uv', 40, 600, note(['UV: this pixel\'s place in the picture, for the paper grain.'])),
        n('noise', 'grain', 340, 600, { kind: 'perlin', dims: '2d', scale: 60, detail: 4, roughness: 0.6, ...note(['Noise (Perlin, 2D, fine, Detail 4): the grain of the paper, 0 to 1.']) }, { uv: ['uv', 'uv'] }),
        n('colorPicker', 'paperDark', 620, 520, { color: [0.84, 0.81, 0.74], ...note(['Colour: the paper in the dips of its grain.']) }),
        n('colorPicker', 'paperLight', 620, 700, { color: [1, 0.99, 0.95], ...note(['Colour: the paper on the tops of its grain, near white.']) }),
        nv('vec3', 'mix', 'paper', 900, 600, note(['Mix: the paper, between its two colours by the grain.']), { a: ['paperDark', 'rgb'], b: ['paperLight', 'rgb'], t: ['grain', 'value'] }),
        nv('vec3', 'multiply', 'onPaper', 1160, 360, note(['Multiply: the paint × the paper, so the grain shows through the colour as it does through real watercolour.']), { a: ['layers', 'color'], b: ['paper', 'result'] }),
        n('output', 'out', 1420, 360, note(['Output: the photo as a watercolour.']), { color: ['onPaper', 'result'] }),
      ],
      play: play([
        ctl('radius', 'wash::radius', 'Brush size (Radius)', 1, 8, 0.5),
        ctl('soft', 'wash::sharpness', 'Wash crispness (Sharpness)', 1, 16, 0.5),
        ctl('grain', 'grain::scale', 'Paper grain', 10, 150, 1),
      ], `**What it shows.** Watercolour from three simple steps: Kuwahara for flat washes with crisp edges, Posterize for the layers, and noise for the paper.

**How it is built.** Texture Input → Kuwahara (Generalised, Sharpness 4) → Posterize (7) → × a paper made from Noise between two creams.

**Try.** Raise *Brush size* for looser washes. Raise *Wash crispness* for harder edges between the washes. Set Posterize's Levels to 3 on its card for a bold poster. Swap Posterize for a Dither node for a printed look.`),
    },

    kuwaharaPaintedLandscape: {
      ...KUWAHARA_EXAMPLE_INDEX.kuwaharaPaintedLandscape,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('noise', 'hills', 300, 160, { kind: 'perlin', dims: '2d', scale: 2.5, detail: 3, roughness: 0.5, ...note(['Noise (Perlin, 2D, Detail 3): rolling lumps, the shapes of the hills and clouds.']) }, { uv: ['uv', 'uv'] }),
        n('splitVec2', 'xy', 300, 420, note(['Split Vec2: the height up the picture (y), so the bottom is ground and the top sky.']), { v: ['uv', 'uv'] }),
        n('multiply', 'tilt', 540, 420, { b: 0.45, ...note(['Multiply: the height × 0.45, a gentle slope from ground to sky.']) }, { a: ['xy', 'y'] }),
        n('add', 'land', 780, 260, note(['Add: the lumps plus the slope. One number per pixel that says how far up the landscape it is.']), { a: ['hills', 'value'], b: ['tilt', 'result'] }),
        n('palette', 'colours', 1020, 260, {
          offset: [0.55, 0.5, 0.45], amplitude: [0.45, 0.4, 0.4], freq: [1, 1, 1], phase: [0.1, 0.2, 0.35],
          ...note(['Palette: the number as colour: deep greens and browns low down, warm light and blue sky higher up.']),
        }, { value: ['land', 'result'] }),
        n('kuwahara', 'paint', 1300, 260, {
          kind: 'generalised', radius: 4, sharpness: 10, spacing: 2.5, mix: 1,
          ...note([
            'Kuwahara, Generalised: the colours become brush strokes. The landscape chain is wired into Colour ƒ, so Kuwahara works the whole chain (noise, palette and all) out again at every read: about 50 times a pixel at Radius 4.',
            'That gets slow for heavy chains, so Radius stops at 4 here; Spacing 2.5 makes the brush bigger at the same cost. For a bigger Radius, wire the chain into a Pass and the Pass\'s Texture into Texture.',
          ]),
        }, { colour: ['colours', 'color'] }),
        n('output', 'out', 1580, 260, note(['Output: the noise landscape, painted.']), { color: ['paint', 'colour'] }),
      ],
      play: play([
        ctl('brush', 'paint::spacing', 'Brush size (Spacing)', 0.5, 6, 0.25),
        ctl('radius', 'paint::radius', 'Radius (stops at 4 here)', 1, 4, 0.5),
        ctl('hills', 'hills::scale', 'Hill size', 0.5, 8, 0.1),
      ], `**What it shows.** Kuwahara on a procedural picture with no Pass: the Colour ƒ socket works the chain out again at every read. Cheap chains like this one paint well; heavy ones are better stored in a Pass first.

**How it is built.** UV → Noise + Split Vec2's y (× 0.45) → Add → Palette → Kuwahara's Colour ƒ.

**Try.** Raise *Brush size* for bold, chunky strokes. Change *Hill size*. Set Kind to Classic on the card for square strokes.`),
    },

    kuwaharaLivePainting: {
      ...KUWAHARA_EXAMPLE_INDEX.kuwaharaLivePainting,
      counter: 20,
      nodes: [
        n('textureInput', 'camera', 40, 260, { fit: 'cover', ...builtinImageParams(WALKWAY_CAT_ID), ...note(['Texture: the built-in photo Walkway cat for now. Switch this card to Webcam (or Video) and the painting follows you live: Kuwahara runs every frame.']) }),
        n('kuwahara', 'paint', 380, 260, {
          kind: 'anisotropic', radius: 5, sharpness: 8, spacing: 1, mix: 1,
          ...note([
            'Kuwahara, Anisotropic: Generalised, with the disc stretched into an ellipse along the edge at this pixel (found from a small 3 × 3 edge read first). The strokes run along the shapes, like a painter following a form.',
            'Read through Texture, so even a live webcam stays quick.',
          ]),
        }, { texture: ['camera', 'texture'] }),
        n('colorSaturation', 'boost', 680, 260, { amount: 1.25, ...note(['Saturation 1.25: a touch more colour, as paint tends to have.']) }, { color: ['paint', 'colour'] }),
        n('output', 'out', 960, 260, note(['Output: the live painting.']), { color: ['boost', 'color'] }),
      ],
      play: play([
        ctl('radius', 'paint::radius', 'Brush size (Radius)', 1, 8, 0.5),
        ctl('sharpness', 'paint::sharpness', 'Sharpness', 1, 16, 0.5),
        ctl('spacing', 'paint::spacing', 'Stroke spread (Spacing)', 0.5, 4, 0.25),
      ], `**What it shows.** Anisotropic Kuwahara: the strokes follow the edges. It is fast enough to run every frame, so it works on video and the webcam.

**How it is built.** Texture (a photo, or switch it to Webcam) → Kuwahara's Texture, Kind Anisotropic → Saturation → Output.

**Try.** Switch the Texture card to Webcam. Raise *Stroke spread* for long, loose strokes. Set Kind to Generalised on the card to see the strokes stop following the edges.`),
    },

    kuwaharaComic: {
      ...KUWAHARA_EXAMPLE_INDEX.kuwaharaComic,
      counter: 20,
      nodes: [
        n('textureInput', 'photo', 40, 260, { fit: 'stretch', ...builtinImageParams(ROOM_AND_CAT_ID), ...note(['Texture Input: the built-in photo Room and cat, read as a Texture by Kuwahara.']) }),
        n('kuwahara', 'flat', 340, 260, {
          kind: 'classic', radius: 4, spacing: 1, mix: 1,
          ...note(['Kuwahara, Classic: the calmest of four squares wins, so whole areas go flat while the edges between them stay hard. Just right for cartoon colours.']),
        }, { texture: ['photo', 'texture'] }),
        n('posterize', 'cel', 620, 260, { levels: 5, ...note(['Posterize: 5 steps per colour, the flat fills of a comic.']) }, { color: ['flat', 'colour'] }),
        n('pass', 'store', 880, 260, note(['Pass: draws the flat colours into a texture, so Convolve can read its neighbours cheaply.']), { color: ['cel', 'color'] }),
        n('convolve', 'lines', 1140, 460, {
          preset: 'outline', size: '3', spacing: 1.5, absolute: true, mix: 1,
          ...note(['Convolve, Outline (Laplacian): 0 inside a flat area, large where the colour jumps. On flat cartoon colours that is exactly the border of each fill. Absolute value counts both sides of a jump.']),
        }, { texture: ['store', 'texture'] }),
        n('smoothstep', 'ink', 1400, 460, { edge0: 0.12, edge1: 0.4, ...note(['Smoothstep: the size of the jump (Convolve\'s Luma) into how much ink, 0 to 1.']) }, { value: ['lines', 'luma'] }),
        n('colorPicker', 'inkColour', 1400, 660, { color: [0.05, 0.04, 0.06], ...note(['Colour: near-black ink.']) }),
        nv('vec3', 'mix', 'comic', 1660, 300, note(['Mix: the flat colours, with ink where the lines are.']), { a: ['store', 'color'], b: ['inkColour', 'rgb'], t: ['ink', 'result'] }),
        n('output', 'out', 1920, 300, note(['Output: the photo as a comic panel.']), { color: ['comic', 'result'] }),
      ],
      play: play([
        ctl('radius', 'flat::radius', 'Flatness (Radius)', 1, 8, 0.5),
        ctl('lines', 'lines::spacing', 'Line width', 0.5, 4, 0.25),
        ctl('spread', 'flat::spacing', 'Brush spread (Spacing)', 0.5, 4, 0.25),
      ], `**What it shows.** A comic from two filters: Kuwahara flattens the photo into fills with hard edges, and Convolve's Outline draws those edges as ink.

**How it is built.** Texture Input → Kuwahara (Classic) → Posterize → Pass → Convolve (Outline) → Smoothstep → Mix of the fills and ink.

**Try.** Raise *Flatness* for simpler shapes and fewer lines. *Line width* 3 for a marker look. Raise *Brush spread* for bigger, looser fills. Set Posterize's Levels to 3 on its card for a bold print.`),
    },
  };
}
