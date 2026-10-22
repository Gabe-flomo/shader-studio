/**
 * surfaceExamples.ts — Normal from Height (docs/normal-from-height.md) and Dither (docs/dither.md): bumps lit by a
 * lamp from noise, terrain, water rings, a photo and a shape; 1-bit, Game Boy and blue-noise dithering. Five are
 * listed in the Bump & Dither folder; the other three open by key (retiredExamples.ts). Built from the node
 * definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { colourCtl, ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';

export const SURFACE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  bumpEmbossedMetal: {
    label: 'Bump · Normal from Height: hammered metal from noise', play: true,
    description: 'Flat Fractal Noise turned into a sheet of hammered metal: Normal from Height reads the noise as a height, finds which way every point faces, and lights it with one lamp and a sharp shiny highlight. Turn the lamp and the dents catch the light.',
  },
  bumpTerrainSun: {
    label: 'Bump · Normal from Height: terrain under a moving sun', play: true,
    description: 'Fractal Noise as a landscape, coloured from deep valley to pale peak by a Palette and lit by a low sun that circles once every 18 seconds, so the ridges throw their light and shadow round with it. No highlight: rock is matt.',
  },
  bumpWaterRipples: {
    label: 'Bump · Normal from Height: water rings over a photo', play: true,
    description: 'Rings spreading from the middle, as on a pond: their Slope bends where the built-in Walkway cat photo is read, as water bends what is under it, and their highlight shines on top. Bend sets how far the picture bends.',
  },
  bumpPhotoRelief: {
    label: 'Bump · Normal from Height: a photo as a relief in its own colours', play: true,
    description: 'The built-in Room and cat photo\'s brightness as a height, lit in the photo\'s own colours by a lamp that circles. The height chain is a picture read, which Normal from Height reads a little to each side for an exact slope.',
  },
  bumpBevelShape: {
    label: 'Bump · Normal from Height: a bevelled star, normal as colour', play: true,
    description: 'A star\'s distance shaped into a bevel (high in the middle, falling at the edge) and shown as Normal as colour: the colour says which way each point faces, red to the right, green up, blue straight out. Switch Mode to Lit surface for a bevelled badge.',
  },
  ditherOneBit: {
    label: 'Dither · 1-bit Bayer clouds', play: true,
    description: 'Slowly drifting Fractal Noise in pure black and white: Dither with 2 levels and the Bayer 8×8 pattern turns every grey into a share of black and white dots, the look of a 1-bit Mac screen.',
  },
  ditherGameBoy: {
    label: 'Dither · Game Boy: four greens, chunky pixels', play: true,
    description: 'A ball swinging over a soft gradient, dithered to the Game Boy\'s four greens with the Bayer 4×4 pattern and Pixel size 4, so every dot is a chunky block of pixels.',
  },
  ditherBlueSwirl: {
    label: 'Dither · Blue noise on a palette swirl', play: true,
    description: 'A turning rainbow swirl cut down to 3 levels per channel, with blue noise between the levels: it looks random but has no clumps, so the bands melt into a fine, even grain.',
  },
};
export const SURFACE_EXAMPLE_KEYS = Object.keys(SURFACE_EXAMPLE_INDEX);
/** Listed in the Bump & Dither folder (five, as every showcase folder); the rest open by key. */
export const SURFACE_SHOWCASE_KEYS = ['bumpEmbossedMetal', 'bumpTerrainSun', 'bumpWaterRipples', 'ditherOneBit', 'ditherGameBoy'];


export function buildSurfaceExamples(): Record<string, ExampleGraph> {
  return {
    bumpEmbossedMetal: {
      ...SURFACE_EXAMPLE_INDEX.bumpEmbossedMetal,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('fbm', 'dents', 300, 260, { scale: 3, octaves: 5, gain: 0.5, ...note(['Fractal Noise (FBM): soft lumps, small ones on big ones, from 0 to about 1. It is the height of the metal: the dents and bumps of a hammered sheet.']) }, { uv: ['uv', 'uv'] }),
        n('colorPicker', 'steel', 300, 520, { color: [0.62, 0.64, 0.68], ...note(['Colour: the metal\'s own colour, a cool steel grey.']) }),
        n('normalFromHeight', 'bump', 600, 260, {
          strength: 0.3, distance: 1, lightAngle: 120, lightHeight: 35, lightColour: [1, 0.95, 0.85], ambient: 0.12, specular: 0.9, shininess: 48, mode: 'lit',
          ...note([
            'Normal from Height: reads the noise as a height a little to each side of every point, so it knows the slope, and from the slope which way the surface faces.',
            'It lights that with one lamp (Light from 120°, up and to the left, 35° high) and a sharp highlight (Specular 0.9, Shininess 48), so it reads as polished metal. Strength 0.3 is how deep the dents are.',
          ]),
        }, { height: ['dents', 'value'], colour: ['steel', 'rgb'] }),
        n('output', 'out', 900, 260, note(['Output: the lit metal (Normal from Height\'s Colour).']), { color: ['bump', 'colour'] }),
      ],
      play: play([
        ctl('strength', 'bump::strength', 'Dent depth', 0, 1, 0.01),
        ctl('angle', 'bump::lightAngle', 'Light from', 0, 360, 1),
        ctl('shine', 'bump::specular', 'Shine', 0, 2, 0.01),
      ], `**What it shows.** Normal from Height turns a flat height (here Fractal Noise) into a surface that catches the light. The lamp lights the slopes facing it, leaves the others dark, and puts a shiny highlight where the surface points between the lamp and you.

**How it is built.** UV → Fractal Noise → Normal from Height's Height ƒ (read on four sides of each point for the slope); a steel Colour into its Colour; its Colour output → Output.

**Try.** Turn *Light from* and watch the dents swap light and shade. Raise *Shine* for a brighter highlight, or Shininess on the card for a tighter one. On the card, switch Mode to Normal as colour to see the normals themselves, or tick Invert to turn bumps into dents.`),
    },

    bumpTerrainSun: {
      ...SURFACE_EXAMPLE_INDEX.bumpTerrainSun,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('fbm', 'land', 300, 260, { scale: 2.2, octaves: 6, gain: 0.5, ...note(['Fractal Noise (FBM), 6 octaves: big hills with smaller and smaller ridges on them. It is the height of the land.']) }, { uv: ['uv', 'uv'] }),
        n('palette', 'earth', 600, 520, { preset: 'custom', offset: [0.42, 0.38, 0.3], amplitude: [0.38, 0.32, 0.26], freq: [0.8, 0.8, 0.8], phase: [0.55, 0.6, 0.68], ...note(['Palette: the land\'s colour by its height, from dark green-brown valleys to pale sandy peaks.']) }, { value: ['land', 'value'] }),
        n('time', 'clock', 40, 720, note(['Time: seconds since the start. It turns the sun.'])),
        n('multiply', 'turn', 300, 720, { b: 20, ...note(['Multiply: Time × 20, the sun\'s direction in degrees: once round every 18 seconds.']) }, { a: ['clock', 'time'] }),
        n('normalFromHeight', 'relief', 900, 260, {
          strength: 0.35, distance: 1.5, lightHeight: 22, lightColour: [1, 0.9, 0.75], ambient: 0.18, specular: 0, mode: 'lit',
          ...note([
            'Normal from Height: the land\'s slope at every point, lit by a low sun (22° high) that rakes across, so every ridge has a lit side and a shaded side.',
            'Light from is wired to the turning Time, so the sun circles. Specular 0: rock and grass are matt. Sample distance 1.5 pixels softens the finest ridges a little.',
          ]),
        }, { height: ['land', 'value'], colour: ['earth', 'color'], lightAngle: ['turn', 'result'] }),
        n('output', 'out', 1200, 260, note(['Output: the lit landscape.']), { color: ['relief', 'colour'] }),
      ],
      play: play([
        ctl('relief', 'relief::strength', 'Steepness', 0, 1, 0.01),
        ctl('sun', 'relief::lightHeight', 'Sun height', 1, 90, 1),
        ctl('amb', 'relief::ambient', 'Sky light', 0, 1, 0.01),
      ], `**What it shows.** Any noise read as a height is a landscape once it is lit. A low sun makes the most of it: every ridge throws light on one side and shade on the other, and as the sun goes round they swap.

**How it is built.** UV → Fractal Noise (the height) → Normal from Height; the same noise → Palette for the colour by height; Time × 20 into Light from.

**Try.** Lower *Sun height* to 5–10 for long evening shading, or 90 for noon (almost no relief). Raise *Steepness* for mountains.`),
    },

    bumpWaterRipples: {
      ...SURFACE_EXAMPLE_INDEX.bumpWaterRipples,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('length', 'dist', 300, 120, { ...note(['Length: how far this point is from the middle, so the rings are round.']) }, { input: ['uv', 'uv'] }),
        n('multiply', 'rings', 540, 120, { b: 28, ...note(['Multiply: distance × 28: how many rings there are (28 for every unit out).']) }, { a: ['dist', 'output'] }),
        n('time', 'clock', 40, 520, note(['Time: seconds since the start. It moves the rings outward.'])),
        n('multiply', 'flow', 300, 520, { b: -3, ...note(['Multiply: Time × −3, so the rings travel outward.']) }, { a: ['clock', 'time'] }),
        n('add', 'phase', 780, 200, { ...note(['Add: the rings plus the moving time: where on its wave each point is.']) }, { a: ['rings', 'result'], b: ['flow', 'result'] }),
        n('sin', 'wave', 1020, 200, { freq: 1, amp: 1, ...note(['Sin: the water\'s height, rising and falling across the rings, −1 to 1.']) }, { input: ['phase', 'result'] }),
        n('colorPicker', 'black', 1020, 460, { color: [0, 0, 0], ...note(['Colour: black, as Normal from Height\'s surface colour, so its Colour output is the highlight alone (black where nothing shines).']) }),
        n('normalFromHeight', 'water', 1260, 260, {
          strength: 0.02, distance: 1, lightAngle: 110, lightHeight: 55, lightColour: [1, 1, 1], ambient: 0, specular: 0.7, shininess: 60, mode: 'lit',
          ...note([
            'Normal from Height: the rings\' slope (Slope output) and the light on them. The whole height chain (UV, Length, Multiply, Time, Add, Sin) is read on four sides of each point for an exact slope.',
            'Strength 0.02 because the rings are steep (28 per unit): it keeps the water gently tilted. On a black surface the Colour output is just the shiny highlight.',
          ]),
        }, { height: ['wave', 'output'], colour: ['black', 'rgb'] }),
        n('constant', 'bend', 1260, 620, { label: 'Bend', value: 0.0012, ...note(['Bend: how far the slope moves where the photo is read. A Play control.']) }),
        nv('vec2', 'multiply', 'shift', 1500, 520, { ...note(['Multiply: the Slope × Bend, how far to shift where the photo is read: the water bends what is under it.']) }, { a: ['water', 'slope'], b: ['bend', 'value'] }),
        nv('vec2', 'add', 'bentUv', 1740, 520, { ...note(['Add: this pixel\'s place plus the shift: where to read the photo through the water.']) }, { a: ['uv', 'uv'], b: ['shift', 'result'] }),
        n('textureInput', 'photo', 1980, 520, { fit: 'cover', ...builtinImageParams(WALKWAY_CAT_ID), ...note(['Texture Input: the built-in photo Walkway cat (a grey cat on a stone walkway), read at the bent place, so it ripples. Choose your own picture on this card. Fit is Fill, so the tall photo covers the picture.']) }, { uv: ['bentUv', 'result'] }),
        n('addColor', 'shine', 2220, 300, { ...note(['Add Colours: the bent photo plus the highlight on the water.']) }, { a: ['photo', 'color'], b: ['water', 'colour'] }),
        n('output', 'out', 2460, 300, note(['Output: the photo under rippling water.']), { color: ['shine', 'result'] }),
      ],
      play: play([
        ctl('bend', 'bend::value', 'Bend', 0, 0.004, 0.0001),
        ctl('rings', 'rings::b', 'Rings', 4, 60, 1),
        ctl('shine', 'water::specular', 'Shine', 0, 2, 0.01),
      ], `**What it shows.** Normal from Height's **Slope** is more than lighting: it says which way the surface tilts, so it can bend a picture, as water bends what is under it. The highlight on top makes it read as wet.

**How it is built.** Rings: Length (distance from the middle) × 28, plus Time × −3, into Sin: the water's height → Normal from Height. Its Slope × Bend + UV is where a Texture Input reads the photo; its Colour (on a black surface: the highlight alone) is added on top.

**Try.** Raise *Bend* for thicker water. Fewer *Rings* for big slow waves. Set Bend to 0 to see the highlight alone on the still photo.`),
    },

    bumpPhotoRelief: {
      ...SURFACE_EXAMPLE_INDEX.bumpPhotoRelief,
      counter: 20,
      nodes: [
        n('textureInput', 'photo', 40, 260, { fit: 'stretch', ...builtinImageParams(ROOM_AND_CAT_ID), ...note(['Texture Input: the built-in photo Room and cat (a warm-lit bedroom, a grey cat held close). Choose your own picture on this card. Its Color is both the height (through Luminance) and the surface colour.']) }),
        n('luminance', 'bright', 300, 160, { ...note(['Luminance: the photo\'s brightness, the height: bright is high.']) }, { color: ['photo', 'color'] }),
        n('time', 'clock', 40, 620, note(['Time: seconds since the start. It turns the lamp.'])),
        n('multiply', 'turn', 300, 620, { b: 30, ...note(['Multiply: Time × 30, the lamp\'s direction in degrees: once round every 12 seconds.']) }, { a: ['clock', 'time'] }),
        n('normalFromHeight', 'relief', 600, 260, {
          strength: 0.12, distance: 1.5, lightHeight: 40, ambient: 0.35, specular: 0.25, shininess: 24, mode: 'lit',
          ...note([
            'Normal from Height: the brightness read as a height, a little to each side of every pixel (the picture read is part of the chain, so it can be read anywhere), lit in the photo\'s own colours.',
            'Ambient 0.35 keeps the shaded side readable; a little Specular gives the raised edges a sheen.',
          ]),
        }, { height: ['bright', 'result'], colour: ['photo', 'color'], lightAngle: ['turn', 'result'] }),
        n('output', 'out', 900, 260, note(['Output: the photo as a lit relief.']), { color: ['relief', 'colour'] }),
      ],
      play: play([
        ctl('depth', 'relief::strength', 'Relief depth', 0, 0.5, 0.005),
        ctl('soft', 'relief::distance', 'Softness (pixels)', 0.25, 8, 0.25),
      ], `**What it shows.** A picture's brightness is a height map too: Normal from Height lights the photo as if its bright parts stood out, in its own colours.

**How it is built.** Texture Input → Luminance → Normal from Height's Height ƒ; the photo's Color into its Colour; Time × 30 turns the lamp.

**Try.** Raise *Softness* to read the slope further apart for a smoother, rounder relief. Compare with Height Light (Pictures 4), which colours by height instead.`),
    },

    bumpBevelShape: {
      ...SURFACE_EXAMPLE_INDEX.bumpBevelShape,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('shapeSDF', 'star', 300, 260, { shape: 'star5', r: 0.55, rf: 0.5, ...note(['Shape SDF, Star: how far each point is from a five-pointed star\'s edge (negative inside).']) }, { p: ['uv', 'uv'] }),
        n('remap', 'bevel', 600, 260, { inMin: 0, inMax: -0.12, outMin: 0, outMax: 1, clamp: true, smooth: 'linear', ...note(['Remap: the distance into a height: 0 at the edge, rising to 1 a little way in (0.12), flat on top. That ramp is the bevel.']) }, { value: ['star', 'distance'] }),
        n('normalFromHeight', 'faces', 900, 260, {
          strength: 0.1, distance: 1, lightAngle: 135, lightHeight: 45, ambient: 0.25, specular: 0.6, shininess: 40, mode: 'normal',
          ...note([
            'Normal from Height, Mode Normal as colour: which way each point faces, as a colour. The flat top and the background face straight out (pale blue-violet); the bevel tilts towards the edge, so each side gets its own colour.',
            'Switch Mode to Lit surface to see the same normals lit as a bevelled badge.',
          ]),
        }, { height: ['bevel', 'result'] }),
        n('output', 'out', 1200, 260, note(['Output: the normals as colour.']), { color: ['faces', 'colour'] }),
      ],
      play: play([
        ctl('depth', 'faces::strength', 'Bevel steepness', 0, 0.5, 0.005),
      ], `**What it shows.** What Normal from Height computes: for every point, which way the surface faces. As colour, x is red, y green and z blue, so a slope towards the right is pinker, towards the top greener.

**How it is built.** UV → Shape SDF (star) → Remap (a 0.12-wide ramp up from the edge) → Normal from Height, Mode Normal as colour.

**Try.** Set Mode to Lit surface. Make the ramp wider on the Remap (Input max −0.3) for a rounder bevel.`),
    },

    ditherOneBit: {
      ...SURFACE_EXAMPLE_INDEX.ditherOneBit,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('fbm', 'clouds', 300, 260, { scale: 1.6, octaves: 5, time_scale: 0.15, ...note(['Fractal Noise (FBM): soft clouds, drifting slowly (Time scale 0.15). Every shade of grey, which the dither will have to show with only black and white.']) }, { uv: ['uv', 'uv'] }),
        n('floatToVec3', 'grey', 600, 260, { ...note(['Float → Vec3: the noise as a grey colour, for Dither\'s Colour.']) }, { input: ['clouds', 'value'] }),
        n('dither', 'bits', 900, 260, {
          pattern: 'bayer8', mode: 'mono', levels: 2, pixelSize: 1, strength: 1,
          ...note([
            'Dither, Black and white, 2 levels: every pixel is black or white. Bayer 8×8 nudges each pixel\'s cut by a fixed pattern of 64 steps, so a grey of 0.25 lights a quarter of the pixels in an even cross-hatch.',
            'Strength 0 would cut at the middle grey everywhere: blobs of black and white with no shading.',
          ]),
        }, { color: ['grey', 'rgb'] }),
        n('output', 'out', 1200, 260, note(['Output: the 1-bit clouds.']), { color: ['bits', 'color'] }),
      ],
      play: play([
        ctl('mix', 'bits::strength', 'Dither strength', 0, 1, 0.01),
        ctl('scale', 'clouds::scale', 'Cloud size', 0.5, 6, 0.01),
      ], `**What it shows.** Dithering shows every grey with only black and white: the share of white dots in a patch is its brightness. Bayer's ordered pattern spreads them evenly, the cross-hatch of early Mac and printer graphics.

**How it is built.** UV → Fractal Noise (drifting) → Float → Vec3 → Dither (Bayer 8×8, Black and white, 2 levels).

**Try.** Lower *Dither strength* to 0 to see what plain cutting does. Raise Pixel size on the card for bigger dots, Levels for shades of grey. Switch Pattern to Blue noise or Lines on the card.`),
    },

    ditherGameBoy: {
      ...SURFACE_EXAMPLE_INDEX.ditherGameBoy,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('gradient', 'sky', 300, 460, { mode: 'linear_y', color_a: [0.05, 0.05, 0.05], color_b: [0.85, 0.85, 0.85], ...note(['Gradient: dark at the bottom to light at the top, a smooth background that shows off the dither\'s in-between shades.']) }, { uv: ['uv', 'uv'] }),
        n('time', 'clock', 40, 640, note(['Time: seconds since the start. It swings the ball.'])),
        n('sin', 'swing', 300, 640, { freq: 1.3, amp: 0.7, ...note(['Sin: a swing from −0.7 to 0.7 and back, the ball\'s place across.']) }, { input: ['clock', 'time'] }),
        n('makeVec2', 'where', 540, 640, { y: -0.1, ...note(['Make Vec2: the ball\'s place: across from the swing, a little below the middle.']) }, { x: ['swing', 'output'] }),
        n('circleSDF', 'ball', 540, 260, { radius: 0.32, ...note(['Circle SDF: the ball, radius 0.32, at the swinging place.']) }, { position: ['uv', 'uv'], offset: ['where', 'xy'] }),
        n('colorPicker', 'ballCol', 540, 60, { color: [0.75, 0.75, 0.75], ...note(['Colour: the ball\'s light grey.']) }),
        n('sdfFill', 'scene', 840, 300, { strokeWidth: 0.02, strokeColor: [0.3, 0.3, 0.3], antialias: 0.04, ...note(['SDF Fill: the ball over the gradient, with a dark rim and a soft edge (Antialias 0.04), so there are in-between greys to dither.']) }, { d: ['ball', 'distance'], fillColor: ['ballCol', 'rgb'], background: ['sky', 'color'] }),
        n('dither', 'gameboy', 1140, 300, {
          pattern: 'bayer4', mode: 'four', pixelSize: 4, strength: 1,
          colour1: [0.06, 0.22, 0.06], colour2: [0.19, 0.38, 0.19], colour3: [0.55, 0.67, 0.06], colour4: [0.61, 0.74, 0.06],
          ...note([
            'Dither, Four colours: the brightness picks one of four greens, the Game Boy\'s, with the Bayer 4×4 pattern mixing neighbouring greens in between.',
            'Pixel size 4: every dot is 4 × 4 screen pixels, the chunky look of a low-resolution screen.',
          ]),
        }, { color: ['scene', 'result'] }),
        n('output', 'out', 1440, 300, note(['Output: the scene in four greens.']), { color: ['gameboy', 'color'] }),
      ],
      play: play([
        ctl('mix', 'gameboy::strength', 'Dither strength', 0, 1, 0.01),
        colourCtl('c4', 'gameboy::colour4', 'Lightest colour'),
        colourCtl('c1', 'gameboy::colour1', 'Darkest colour'),
      ], `**What it shows.** Dither's **Four colours** mode maps brightness to a palette of four, with a pattern of dots between them: the Game Boy's greens here, or any four colours you like.

**How it is built.** A Circle SDF swinging on Time (Sin → Make Vec2 → Offset), filled over a Gradient by SDF Fill → Dither (Bayer 4×4, Four colours, Pixel size 4).

**Try.** Pick your own four colours for a different console. Set Mode to Two colours for a print duotone. Pixel size 1 on the card for a fine dither.`),
    },

    ditherBlueSwirl: {
      ...SURFACE_EXAMPLE_INDEX.ditherBlueSwirl,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('polarSpace', 'polar', 300, 260, { ...note(['Polar Space: the point as an angle round the middle and a distance from it.']) }, { input: ['uv', 'uv'] }),
        n('multiply', 'turns', 540, 160, { b: 0.159, ...note(['Multiply: the angle ÷ 6.28 (× 0.159): once round the middle is one step through the palette.']) }, { a: ['polar', 'angle'] }),
        n('multiply', 'out1', 540, 380, { b: 1.4, ...note(['Multiply: the distance × 1.4, so the colours also change going outward: a swirl.']) }, { a: ['polar', 'radius'] }),
        n('add', 'swirl', 780, 260, { ...note(['Add: angle plus distance, the swirl\'s place in the palette.']) }, { a: ['turns', 'result'], b: ['out1', 'result'] }),
        n('time', 'clock', 540, 600, note(['Time: seconds since the start. It turns the swirl.'])),
        n('palette', 'rainbow', 1020, 260, { preset: 'custom', offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0, 0.33, 0.67], speed: 0.15, ...note(['Palette: a rainbow along the swirl, turning with Time (Speed 0.15).']) }, { value: ['swirl', 'result'], anim: ['clock', 'time'] }),
        n('dither', 'grain', 1320, 260, {
          pattern: 'blue', mode: 'colour', levels: 3, pixelSize: 2, strength: 1,
          ...note([
            'Dither, Blue noise, 3 levels per channel: each channel keeps only 0, 0.5 or 1, with blue noise (interleaved gradient noise) choosing the dots between: it looks random, but neighbours always differ, so there are no clumps.',
            'Pixel size 2 makes the grain just visible. Try Bayer 4×4 on the card to compare an ordered pattern.',
          ]),
        }, { color: ['rainbow', 'color'] }),
        n('output', 'out', 1620, 260, note(['Output: the dithered swirl.']), { color: ['grain', 'color'] }),
      ],
      play: play([
        ctl('mix', 'grain::strength', 'Dither strength', 0, 1, 0.01),
        ctl('spin', 'rainbow::speed', 'Colour speed', -1, 1, 0.01),
      ], `**What it shows.** With only a few levels per channel a smooth gradient bands; dithering trades the bands for grain. Blue noise is the best-looking grain: random, but evenly spread.

**How it is built.** UV → Polar Space (angle and distance) → Add → Palette (turning with Time) → Dither (Blue noise, Colour, 3 levels).

**Try.** Levels 2 on the card for 8 colours in all; *Dither strength* 0 shows the bands it hides; switch Pattern to White noise to see clumpy grain.`),
    },
  };
}
