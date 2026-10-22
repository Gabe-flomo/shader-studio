/**
 * bevelExamples.ts — SDF Bevel (docs/sdf-bevel.md): flat shapes lit as if raised or engraved. A glossy app button,
 * a gold star badge, a seal cut into stone, a tiled floor, a terraced map and soft blobs under a moving light, all
 * in the Bevel folder. Built from the node definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { colourCtl, ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';

export const BEVEL_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  bevelAppIcon: {
    label: 'Bevel · SDF Bevel: a glossy app button', play: true,
    description: 'A rounded square raised off the screen with a Round bevel, lit from the top left with a bright glossy highlight and a soft drop shadow, and a white ring raised on top of it by a second SDF Bevel. Turn the light round and the gloss slides along the rim.',
  },
  bevelGoldStar: {
    label: 'Bevel · SDF Bevel: a gold star badge', play: true,
    description: 'A five-pointed star with a straight Chamfer bevel, so every point has two flat faces, lit in warm gold by a lamp that circles round it: one face of each point flashes as the light passes.',
  },
  bevelEngravedSeal: {
    label: 'Bevel · SDF Bevel: a seal cut into stone', play: true,
    description: 'A ring and a star cut into speckled stone: SDF Bevel with Invert engraves the shape instead of raising it, with V-shaped Chamfer grooves and the shadow falling inside the cut, on the side the light comes from.',
  },
  bevelTileFloor: {
    label: 'Bevel · SDF Bevel: a floor of soft tiles', play: true,
    description: 'Infinite Repeat makes a grid of rounded squares; SDF Bevel with the Pillow profile puffs each one up like a glazed tile, each in its own colour, with grout between them in shadow.',
  },
  bevelTerracedMap: {
    label: 'Bevel · SDF Bevel: a terraced island map', play: true,
    description: 'Noise used as a distance makes islands; the Steps profile turns them into terraces, like the contour layers of a relief map, lit by a sun that moves round. Steps on the card sets how many terraces.',
  },
  bevelBlobs: {
    label: 'Bevel · SDF Bevel: soft blobs under a moving light', play: true,
    description: 'Three circles drifting on Time, melted together by a smooth Union and puffed up with the Pillow profile into one soft, shiny blob, while the light circles round it.',
  },
};
export const BEVEL_EXAMPLE_KEYS = Object.keys(BEVEL_EXAMPLE_INDEX);
/** All six are listed in the Bevel folder (new-node folders may hold more than five). */
export const BEVEL_SHOWCASE_KEYS = BEVEL_EXAMPLE_KEYS;

export function buildBevelExamples(): Record<string, ExampleGraph> {
  return {
    bevelAppIcon: {
      ...BEVEL_EXAMPLE_INDEX.bevelAppIcon,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('shapeSDF', 'square', 300, 160, { shape: 'roundedBox', rx: 0.6, ry: 0.6, roundness: 0.22, ...note(['Shape SDF, Rounded Box: how far each point is from a rounded square\'s edge (negative inside). 1.2 wide, corners rounded by 0.22: an app icon.']) }, { p: ['uv', 'uv'] }),
        n('gradient', 'blue', 300, 440, { mode: 'linear_y', color_a: [0.08, 0.28, 0.85], color_b: [0.3, 0.8, 1], ...note(['Gradient: deep blue at the bottom to sky blue at the top, the button\'s own colour.']) }, { uv: ['uv', 'uv'] }),
        n('sdfBevel', 'button', 640, 260, {
          profile: 'round', width: 0.14, depth: 0.1, lightAngle: 125, lightHeight: 50, ambient: 0.3, specular: 1.1, shininess: 80,
          shadow: 0.45, shadowDistance: 0.04, shadowSoftness: 0.05, background: [0.92, 0.93, 0.95], mode: 'lit',
          ...note([
            'SDF Bevel, Round profile: the square rises from its outline in a quarter circle, 0.14 in and 0.1 high, then is flat on top: a soft, pressable rim.',
            'Specular 1.1 and Shininess 80 give a bright, tight highlight, as on glossy plastic. The drop shadow (Shadow 0.45) falls away from the light, onto the pale grey screen.',
          ]),
        }, { d: ['square', 'distance'], fill: ['blue', 'color'] }),
        n('circleSDF', 'disc', 640, 600, { radius: 0.27, ...note(['Circle SDF: a circle of radius 0.27 in the middle of the button.']) }, { position: ['uv', 'uv'] }),
        n('sdfOnion', 'ring', 900, 600, { r: 0.05, ...note(['Onion: the circle\'s outline thickened into a ring 0.1 wide: the icon\'s symbol.']) }, { dist: ['disc', 'distance'] }),
        n('sdfBevel', 'glyph', 1160, 360, {
          profile: 'round', width: 0.05, depth: 0.03, lightAngle: 125, lightHeight: 50, ambient: 0.45, specular: 0.8, shininess: 60,
          shadow: 0.35, shadowDistance: 0.02, shadowSoftness: 0.02, fill: [1, 1, 1], mode: 'lit',
          ...note([
            'SDF Bevel again: the white ring raised a little off the button. Its Background is the first bevel\'s Colour, so the ring sits on the button, and its own small shadow falls on it.',
            'Width 0.05 is half the ring\'s width, so the ring is rounded all the way across, like a tube.',
          ]),
        }, { d: ['ring', 'dist'], background: ['button', 'colour'] }),
        n('output', 'out', 1440, 360, note(['Output: the finished button.']), { color: ['glyph', 'colour'] }),
      ],
      play: play([
        ctl('angle', 'button::lightAngle', 'Light from (button)', 0, 360, 1),
        ctl('angle2', 'glyph::lightAngle', 'Light from (ring)', 0, 360, 1),
        ctl('depth', 'button::depth', 'Button depth', 0, 0.3, 0.005),
        ctl('shine', 'button::specular', 'Gloss', 0, 2, 0.01),
      ], `**What it shows.** SDF Bevel makes a flat shape look raised: its edge is a bevel lit by one lamp, the flat top catches the light, and a drop shadow falls beside it. Two in a row stack: the second sits on the first.

**How it is built.** UV → Shape SDF (Rounded Box) → SDF Bevel (Round) with a Gradient as its Fill. A Circle SDF → Onion makes a ring → a second SDF Bevel whose Background is the first one's Colour → Output.

**Try.** Turn both *Light from* sliders together to swing the light. Set Profile to Chamfer on the button card for a hard-edged key, or tick Invert for a button pressed in.`),
    },

    bevelGoldStar: {
      ...BEVEL_EXAMPLE_INDEX.bevelGoldStar,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('shapeSDF', 'star', 300, 260, { shape: 'star5', r: 0.72, rf: 0.45, ...note(['Shape SDF, Star: how far each point is from a five-pointed star\'s edge (negative inside), 0.72 to the tips.']) }, { p: ['uv', 'uv'] }),
        n('time', 'clock', 40, 560, note(['Time: seconds since the start. It turns the lamp.'])),
        n('multiply', 'turn', 300, 560, { b: 30, ...note(['Multiply: Time × 30, the lamp\'s direction in degrees: once round every 12 seconds.']) }, { a: ['clock', 'time'] }),
        n('sdfBevel', 'badge', 640, 260, {
          profile: 'chamfer', width: 0.14, depth: 0.12, lightHeight: 35, lightColour: [1, 0.88, 0.65], ambient: 0.18, specular: 1.2, shininess: 40,
          outlineWidth: 0.008, outlineColour: [0.25, 0.12, 0.02], fill: [1, 0.72, 0.22], background: [0.06, 0.08, 0.18],
          shadow: 0.6, shadowDistance: 0.05, shadowSoftness: 0.04, mode: 'lit',
          ...note([
            'SDF Bevel, Chamfer: a straight slope 0.14 in from the outline. In a star the slopes from neighbouring edges meet along a crease down each point, so every point gets two flat faces, cut like a gem.',
            'Gold Fill and a warm Light colour; Specular 1.2 makes the faces flash as the lamp passes. A thin dark Outline crisps the edge, and the shadow falls on the navy background.',
          ]),
        }, { d: ['star', 'distance'], lightAngle: ['turn', 'result'] }),
        n('output', 'out', 940, 260, note(['Output: the gold star.']), { color: ['badge', 'colour'] }),
      ],
      play: play([
        ctl('depth', 'badge::depth', 'Depth', 0, 0.3, 0.005),
        ctl('width', 'badge::width', 'Bevel width', 0.01, 0.4, 0.005),
        ctl('shine', 'badge::specular', 'Shine', 0, 2, 0.01),
        colourCtl('gold', 'badge::fill', 'Metal colour'),
      ], `**What it shows.** A Chamfer bevel is a straight slope, so a pointed shape gets crisp facets that flash one by one as the light moves round.

**How it is built.** UV → Shape SDF (Star) → SDF Bevel (Chamfer, gold); Time × 30 into its Light from → Output.

**Try.** Make *Bevel width* larger than the points are thick for a full pyramid with no flat top. Lower *Depth* for a gentle stamp. Pick silver as the *Metal colour*.`),
    },

    bevelEngravedSeal: {
      ...BEVEL_EXAMPLE_INDEX.bevelEngravedSeal,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('noise', 'grain', 300, 600, { kind: 'perlin', dims: '2d', scale: 9, detail: 5, roughness: 0.6, ...note(['Noise (Perlin, 2D, Detail 5): fine speckles, the grain of the stone.']) }, { uv: ['uv', 'uv'] }),
        n('colorPicker', 'dark', 300, 820, { color: [0.36, 0.34, 0.32], ...note(['Colour: the stone\'s darker speckle.']) }),
        n('colorPicker', 'light', 300, 980, { color: [0.72, 0.7, 0.66], ...note(['Colour: the stone\'s paler colour.']) }),
        nv('vec3', 'mix', 'stone', 600, 700, { ...note(['Mix: dark to pale stone by the grain: the speckled stone, used both round the seal and inside the cut.']) }, { a: ['dark', 'rgb'], b: ['light', 'rgb'], t: ['grain', 'value'] }),
        n('circleSDF', 'disc', 300, 120, { radius: 0.62, ...note(['Circle SDF: a circle of radius 0.62.']) }, { position: ['uv', 'uv'] }),
        n('sdfOnion', 'ring', 560, 120, { r: 0.035, ...note(['Onion: the circle\'s outline as a ring 0.07 wide: the groove round the seal.']) }, { dist: ['disc', 'distance'] }),
        n('shapeSDF', 'star', 560, 340, { shape: 'star5', r: 0.4, rf: 0.5, ...note(['Shape SDF, Star: a five-pointed star in the middle.']) }, { p: ['uv', 'uv'] }),
        n('sdfUnion', 'both', 820, 220, { k: 0, ...note(['Union: the ring and the star as one shape (the nearer of the two distances).']) }, { a: ['ring', 'dist'], b: ['star', 'distance'] }),
        n('sdfBevel', 'cut', 1100, 400, {
          profile: 'chamfer', width: 0.04, depth: 0.04, invert: true, lightAngle: 135, lightHeight: 35, ambient: 0.3, specular: 0.15, shininess: 16,
          shadow: 0.7, shadowDistance: 0.02, shadowSoftness: 0.012, mode: 'lit',
          ...note([
            'SDF Bevel, Invert: the shape is cut into the stone instead of raised. Chamfer 0.04 wide: the ring (0.07 wide) becomes a V-shaped groove, the star a flat-bottomed cut with sloped walls.',
            'The shadow falls inside the cut, on the side the light comes from, where the wall hides the floor. Little Specular: stone is matt.',
          ]),
        }, { d: ['both', 'dist'], fill: ['stone', 'result'], background: ['stone', 'result'] }),
        n('output', 'out', 1380, 400, note(['Output: the engraved stone.']), { color: ['cut', 'colour'] }),
      ],
      play: play([
        ctl('angle', 'cut::lightAngle', 'Light from', 0, 360, 1),
        ctl('depth', 'cut::depth', 'Cut depth', 0, 0.15, 0.002),
        ctl('shadow', 'cut::shadow', 'Shadow', 0, 1, 0.01),
      ], `**What it shows.** Invert turns a raised bevel into an engraving: the same shape, cut in. The lit wall is the one facing the light, and the shadow lies inside the cut on the near side.

**How it is built.** Circle SDF → Onion (a ring) and Shape SDF (a star) → Union → SDF Bevel (Chamfer, Invert); Noise → Mix makes the stone for both Fill and Background.

**Try.** Turn *Light from* and watch the lit and shaded walls swap. Untick Invert on the card to raise the seal instead. Set Profile to Cove for soft, scooped grooves.`),
    },

    bevelTileFloor: {
      ...BEVEL_EXAMPLE_INDEX.bevelTileFloor,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('infiniteRepeatSpace', 'tiles', 300, 260, { cellX: 0.36, cellY: 0.36, ...note(['Infinite Repeat: cuts the picture into square cells 0.36 wide. Cell UV is the place inside a cell (0 in its middle); Cell ID numbers the cell.']) }, { input: ['uv', 'uv'] }),
        n('shapeSDF', 'tile', 580, 160, { shape: 'roundedBox', rx: 0.155, ry: 0.155, roundness: 0.04, ...note(['Shape SDF, Rounded Box, read at the Cell UV: one rounded square per cell, 0.31 wide, leaving a 0.05 gap of grout.']) }, { p: ['tiles', 'output'] }),
        n('randomFromId', 'pick', 580, 440, { ...note(['Random (from ID): a steady random number per cell, from its Cell ID, so each tile gets its own shade.']) }, { id2: ['tiles', 'cellID'] }),
        n('palette', 'glaze', 840, 440, { preset: 'custom', offset: [0.65, 0.5, 0.4], amplitude: [0.2, 0.17, 0.15], freq: [0.5, 0.5, 0.5], phase: [0, 0.05, 0.1], ...note(['Palette: the random number as a glaze colour, from cream (0) to terracotta brown (1).']) }, { value: ['pick', 'value'] }),
        n('sdfBevel', 'puff', 1120, 260, {
          profile: 'pillow', width: 0.09, depth: 0.05, lightAngle: 120, lightHeight: 40, ambient: 0.3, specular: 0.6, shininess: 48,
          background: [0.42, 0.4, 0.38], shadow: 0.55, shadowDistance: 0.02, shadowSoftness: 0.02, mode: 'lit',
          ...note([
            'SDF Bevel, Pillow: a soft dome that rises from each tile\'s outline and eases flat. Width 0.09 is a bit over half way to the tile\'s middle (0.155), so each tile is a soft cushion with a small flat top.',
            'The Distance chain reads through Infinite Repeat, so it can be read anywhere: the shadow of one tile falls on the grout beside it. Background is the grout\'s grey.',
          ]),
        }, { d: ['tile', 'distance'], fill: ['glaze', 'color'] }),
        n('output', 'out', 1400, 260, note(['Output: the tiled floor.']), { color: ['puff', 'colour'] }),
      ],
      play: play([
        ctl('angle', 'puff::lightAngle', 'Light from', 0, 360, 1),
        ctl('width', 'puff::width', 'Puffiness', 0.01, 0.3, 0.005),
        ctl('shine', 'puff::specular', 'Glaze shine', 0, 2, 0.01),
      ], `**What it shows.** Any repeated shape bevels as easily as one: the distance reads through Infinite Repeat, so every tile gets its own dome and shadow.

**How it is built.** UV → Infinite Repeat → Shape SDF (Rounded Box) at the Cell UV → SDF Bevel (Pillow); Cell ID → Random → Palette for each tile's Fill.

**Try.** Lower *Puffiness* for flat tiles with soft edges. Set Profile to Chamfer for cut stone setts, or Steps for stepped tiles.`),
    },

    bevelTerracedMap: {
      ...BEVEL_EXAMPLE_INDEX.bevelTerracedMap,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('noise', 'land', 300, 260, { kind: 'perlin', dims: '2d', scale: 1.2, detail: 3, roughness: 0.45, ...note(['Noise (Perlin, 2D, Detail 3): big hills and valleys from 0 to 1, the shape of the land.']) }, { uv: ['uv', 'uv'] }),
        n('remap', 'coast', 580, 160, { inMin: 0.52, inMax: 0.82, outMin: 0, outMax: -0.3, clamp: false, smooth: 'linear', ...note(['Remap: the noise as a distance. 0.52 is the coastline (distance 0); higher land is further "inside", down to −0.3 at the peaks. Below 0.52 is sea (positive: outside).']) }, { value: ['land', 'value'] }),
        n('palette', 'earth', 580, 440, { preset: 'custom', offset: [0.5, 0.52, 0.36], amplitude: [0.35, 0.3, 0.3], freq: [0.9, 0.9, 0.9], phase: [0.62, 0.62, 0.7], ...note(['Palette: the land\'s colour by its height, from green lowland to pale rock.']) }, { value: ['land', 'value'] }),
        n('time', 'clock', 40, 640, note(['Time: seconds since the start. It moves the sun.'])),
        n('multiply', 'turn', 300, 640, { b: 15, ...note(['Multiply: Time × 15, the sun\'s direction in degrees: once round every 24 seconds.']) }, { a: ['clock', 'time'] }),
        n('sdfBevel', 'terraces', 900, 260, {
          profile: 'steps', steps: 5, width: 0.3, depth: 0.1, lightHeight: 40, ambient: 0.3, specular: 0.1, shininess: 12,
          outlineWidth: 0.004, outlineColour: [0.85, 0.82, 0.62], background: [0.1, 0.3, 0.5],
          shadow: 0.35, shadowDistance: 0.02, shadowSoftness: 0.02, mode: 'lit',
          ...note([
            'SDF Bevel, Steps (5): the land climbs from the coast to the peaks in five flat terraces, each with a short ramp up to it, like the cut-card layers of a relief map.',
            'Width 0.3 is the whole climb, from the coast to the highest peaks. Light from is wired to the turning Time, so the sun goes round; a pale Outline is the beach, the Background the sea.',
          ]),
        }, { d: ['coast', 'result'], fill: ['earth', 'color'], lightAngle: ['turn', 'result'] }),
        n('output', 'out', 1180, 260, note(['Output: the terraced island map.']), { color: ['terraces', 'colour'] }),
      ],
      play: play([
        ctl('width', 'terraces::width', 'Climb width', 0.05, 0.6, 0.005),
        ctl('depth', 'terraces::depth', 'Relief', 0, 0.3, 0.005),
        ctl('sun', 'terraces::lightHeight', 'Sun height', 5, 90, 1),
      ], `**What it shows.** SDF Bevel takes any distance, not only exact shapes: noise turned into a distance makes islands, and the Steps profile layers them into terraces.

**How it is built.** UV → Noise → Remap (the coastline at 0.52) → SDF Bevel (Steps); the same noise → Palette for the Fill; Time × 15 turns the sun.

**Try.** Change Steps on the card from 2 to 12 terraces. Narrow the *Climb width* and only the coasts are terraced, the peaks flat. Set Profile to Round for smooth hills. Set Mode to Height as grey on the card to see the terraces as a height map.`),
    },

    bevelBlobs: {
      ...BEVEL_EXAMPLE_INDEX.bevelBlobs,
      counter: 40,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('time', 'clock', 40, 620, note(['Time: seconds since the start. It moves the circles and the light.'])),
        n('sin', 'ax', 300, 520, { freq: 0.7, amp: 0.7, ...note(['Sin: the first circle\'s place across, swinging ±0.7.']) }, { input: ['clock', 'time'] }),
        n('cos', 'ay', 300, 640, { freq: 0.9, amp: 0.35, ...note(['Cos: the first circle\'s place up and down, ±0.35.']) }, { input: ['clock', 'time'] }),
        n('makeVec2', 'a', 540, 580, { ...note(['Make Vec2: the first circle\'s centre.']) }, { x: ['ax', 'output'], y: ['ay', 'output'] }),
        n('cos', 'bx', 300, 800, { freq: 0.5, amp: 0.8, ...note(['Cos: the second circle\'s place across, ±0.8, slower.']) }, { input: ['clock', 'time'] }),
        n('sin', 'by', 300, 920, { freq: 1.1, amp: 0.3, ...note(['Sin: the second circle\'s place up and down, ±0.3.']) }, { input: ['clock', 'time'] }),
        n('makeVec2', 'b', 540, 860, { ...note(['Make Vec2: the second circle\'s centre.']) }, { x: ['bx', 'output'], y: ['by', 'output'] }),
        n('circleSDF', 'c1', 800, 120, { radius: 0.42, ...note(['Circle SDF: a still circle in the middle, radius 0.42.']) }, { position: ['uv', 'uv'] }),
        n('circleSDF', 'c2', 800, 360, { radius: 0.32, ...note(['Circle SDF: a smaller circle, radius 0.32, drifting with the first centre.']) }, { position: ['uv', 'uv'], offset: ['a', 'xy'] }),
        n('circleSDF', 'c3', 800, 600, { radius: 0.26, ...note(['Circle SDF: the smallest circle, radius 0.26, drifting with the second centre.']) }, { position: ['uv', 'uv'], offset: ['b', 'xy'] }),
        n('sdfUnion', 'u1', 1060, 240, { k: 0.3, ...note(['Union with Blend radius 0.3: the first two circles melted together where they come close, like drops of water.']) }, { a: ['c1', 'distance'], b: ['c2', 'distance'] }),
        n('sdfUnion', 'u2', 1300, 360, { k: 0.3, ...note(['Union with Blend radius 0.3: the third circle melted in too: one soft blob.']) }, { a: ['u1', 'dist'], b: ['c3', 'distance'] }),
        n('multiply', 'turn', 1060, 760, { b: 40, ...note(['Multiply: Time × 40, the light\'s direction in degrees: once round every 9 seconds.']) }, { a: ['clock', 'time'] }),
        n('sdfBevel', 'pillow', 1560, 360, {
          profile: 'pillow', width: 0.3, depth: 0.12, lightHeight: 45, ambient: 0.3, specular: 0.9, shininess: 60,
          fill: [0.95, 0.42, 0.58], background: [0.98, 0.9, 0.8], shadow: 0.4, shadowDistance: 0.05, shadowSoftness: 0.06, mode: 'lit',
          ...note([
            'SDF Bevel, Pillow, Width 0.3 (about as far in as the blob is thick): the whole blob is one soft dome, with no flat top, so it looks like a balloon or a gummy sweet.',
            'Light from is wired to Time, so the highlight and the shadow travel round the blob. The whole Distance chain, Time included, is read again for the shadow.',
          ]),
        }, { d: ['u2', 'dist'], lightAngle: ['turn', 'result'] }),
        n('output', 'out', 1840, 360, note(['Output: the shiny blob.']), { color: ['pillow', 'colour'] }),
      ],
      play: play([
        ctl('blend', 'u1::k', 'Melt', 0, 0.6, 0.01),
        ctl('blend2', 'u2::k', 'Melt (third)', 0, 0.6, 0.01),
        ctl('width', 'pillow::width', 'Puffiness', 0.02, 0.5, 0.005),
        ctl('sun', 'pillow::lightHeight', 'Light height', 5, 90, 1),
      ], `**What it shows.** Smooth unions and SDF Bevel together: shapes that merge like liquid, then look round and shiny, with a light that moves round them.

**How it is built.** Three Circle SDFs (two moving on Time through Sin, Cos and Make Vec2) → two Unions with a Blend radius → SDF Bevel (Pillow); Time × 40 into its Light from.

**Try.** Lower both *Melt* sliders to 0 for hard-edged circles. Lower *Puffiness* to see a flat top appear. Set Mode to Normal as colour on the card.`),
    },
  };
}
