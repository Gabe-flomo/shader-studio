/**
 * advectExamples.ts — Advect (docs/advect.md): a picture kept from frame to frame and carried along a flow. Ink
 * dropped in water, smoke rising from a candle, marbled paper, a photo melting, paint that follows the mouse, and
 * Voronoi cells dragged round a whirlpool. All six are listed in the Advect folder. Built from the node definitions
 * (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';
import { builtinImageParams, ROOM_AND_CAT_ID } from '../lib/builtinImages';

export const ADVECT_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  advectInkDrops: {
    label: 'Advect: ink drops in water', play: true,
    description: 'A drop of coloured ink falls into still water every second and a half, wherever the drop point has wandered to, and the water\'s own slow curl carries it off in swirls. Press and drag to drop ink yourself. Advect\'s Flow is left empty, so its built-in gentle curl moves the water.',
  },
  advectCandleSmoke: {
    label: 'Advect: smoke rising from a candle', play: true,
    description: 'A small warm flame at the bottom adds smoke every frame; Flow is straight up plus a little Noise slope, so the smoke rises, wobbles and curls. Add mode piles it up where it is thick, Fade thins it as it climbs, Soften spreads it out.',
  },
  advectMarbling: {
    label: 'Advect: marbled paper', play: true,
    description: 'Coloured stripes are painted in only for the first third of a second; after that nothing new is added and the stripes are combed round by a Noise slope turned sideways (Swirl 90°), so they fold into the marbled patterns of old book end-papers. ↺ lays fresh stripes.',
  },
  advectPhotoMelt: {
    label: 'Advect: a photo melting', play: true,
    description: 'The built-in Room and cat photo as Source, carried downwards and sideways along a wobbling flow, so it runs like wet paint. A small Inject keeps laying the photo back in, so it melts and recovers at once: raise Inject to see more of the photo, lower it for more melt.',
  },
  advectMousePaint: {
    label: 'Advect: paint that follows the mouse', play: true,
    description: 'Move the pointer over the picture: a Brush paints colour under it (its hue turning with time), and the paint is carried off along the built-in curl, softening and fading as it goes. Swirl turns the curl into a stirring.',
  },
  advectVoronoiVortex: {
    label: 'Advect: Voronoi cells dragged by a whirlpool', play: true,
    description: 'Voronoi\'s flat cell colours are laid in a little every frame while a Vector Field in Vortex mode turns everything round the middle, so the cells smear into spiral arms and keep being redrawn underneath.',
  },
};
export const ADVECT_EXAMPLE_KEYS = Object.keys(ADVECT_EXAMPLE_INDEX);
/** All six are listed in the Advect folder (the new-node folders may hold more than five: owner, 22 October 2026). */
export const ADVECT_SHOWCASE_KEYS = ADVECT_EXAMPLE_KEYS;

export function buildAdvectExamples(): Record<string, ExampleGraph> {
  return {
    advectInkDrops: {
      ...ADVECT_EXAMPLE_INDEX.advectInkDrops,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture (0, 0 in the middle, −1 to 1 from bottom to top).'])),
        n('time', 'time', 40, 520, note(['Time: seconds since the start. It moves the drop point and times the drops.'])),
        n('sin', 'dropX', 300, 460, { freq: 0.37, amp: 0.55, ...note(['Sin: the drop point\'s left–right place, swinging slowly between −0.55 and 0.55.']) }, { input: ['time', 'time'] }),
        n('sin', 'dropY', 300, 620, { freq: 0.53, amp: 0.45, ...note(['Sin: its up–down place, at a different speed, so the drop point wanders all over.']) }, { input: ['time', 'time'] }),
        n('makeVec2', 'where', 560, 520, note(['Make Vec2: the drop point.']), { x: ['dropX', 'output'], y: ['dropY', 'output'] }),
        n('circleSDF', 'drop', 820, 360, { radius: 0.07, ...note(['Circle SDF: the drop, a circle 0.07 across round the drop point (negative inside).']) }, { position: ['uv', 'uv'], offset: ['where', 'xy'] }),
        n('sdfFill', 'dropMask', 1080, 360, { ...note(['SDF Fill: its Alpha is 1 inside the circle and 0 outside, with a smooth edge.']) }, { d: ['drop', 'distance'] }),
        n('lfo', 'beat', 820, 620, { waveform: 'square', freq: 0.66, amplitude: 0.5, offset: 0.5, ...note(['LFO, Square: 1 for half of every 1.5 seconds, 0 for the other half: when the drop is falling.']) }, { time: ['time', 'time'] }),
        n('multiply', 'timed', 1340, 440, note(['Multiply: the drop only while the LFO is on: one drop every second and a half.']), { a: ['dropMask', 'alpha'], b: ['beat', 'value'] }),
        n('brush', 'finger', 1340, 640, { radius: 22, softness: 10, paint: 'pressed', ...note(['Brush: 1 under the pointer while the mouse button (or a finger) is down: press and drag to drop ink yourself.']) }),
        n('max', 'anyInk', 1600, 520, note(['Max: ink where either the timed drop or your brush is.']), { a: ['timed', 'result'], b: ['finger', 'mask'] }),
        n('palette', 'inkColour', 1340, 160, { scale: 0.08, ...note(['Palette: the ink\'s colour, its hue turning slowly with time, so each drop has its own colour.']) }, { value: ['time', 'time'] }),
        n('advect', 'water', 1880, 360, {
          label: 'Water', speed: 1.6, swirl: 0, curlSize: 1.3, fade: 0.08, inject: 0.35, mode: 'mix', diffuse: 0.04,
          ...note([
            'Advect: the water. It keeps the picture from frame to frame and each frame carries every pixel Speed pixels along the flow. Flow is empty, so it uses its built-in gentle curl: slow swirls that never pile up.',
            'Colour is the ink; Inject mask says where it goes in. Mix paints the ink over what is there, so a new drop covers the old water. Fade 0.08 lets old ink fade very slowly; Soften blurs it a touch, so the edges go cloudy.',
          ]),
        }, { colour: ['inkColour', 'color'], mask: ['anyInk', 'result'] }),
        n('output', 'out', 2160, 360, note(['Output: the water with its ink.']), { color: ['water', 'color'] }),
      ],
      play: play([
        ctl('speed', 'water::speed', 'Current (pixels a frame)', 0, 6, 0.05),
        ctl('size', 'water::curlSize', 'Swirl size', 0.3, 4, 0.01),
        ctl('fade', 'water::fade', 'Ink fades (per second)', 0, 1, 0.01),
        ctl('clear', 'water::reset', 'Clear the water', 0, 1, 1),
      ], `**What it shows.** Advect keeps a picture and moves it a little along a flow every frame. Here the flow is its own built-in curl and the picture is ink dropped in on a beat.

**How it is built.** Time → two Sin waves → the drop point → Circle SDF → SDF Fill's Alpha × an LFO square wave = when and where the drop goes in. A Brush adds yours. A Palette gives each drop its colour. All into Advect's Colour and Inject mask.

**Try.** Press and drag on the picture to drop ink. Raise *Current* for faster water, lower *Swirl size* for bigger, lazier swirls. *Clear the water* empties it.`),
    },

    advectCandleSmoke: {
      ...ADVECT_EXAMPLE_INDEX.advectCandleSmoke,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture.'])),
        n('circleSDF', 'wick', 300, 120, { radius: 0.05, posX: 0, posY: -0.75, ...note(['Circle SDF: the flame, a small circle near the bottom middle.']) }, { position: ['uv', 'uv'] }),
        n('sdfFill', 'flame', 560, 120, { antialias: 0.04, aaMode: 'fixed', ...note(['SDF Fill: its Alpha is 1 in the flame with a wide soft edge: where smoke is made.']) }, { d: ['wick', 'distance'] }),
        n('colorPicker', 'warm', 560, -60, { color: [1, 0.62, 0.3], ...note(['Colour: warm candle smoke, orange and lit from below.']) }),
        n('noise', 'air', 300, 420, { kind: 'perlin', dims: '3d', scale: 2.5, detail: 2, speed: 0.4, ...note(['Noise (Perlin, 3D, Speed 0.4): air that stirs on its own. Its Slope says which way the noise rises: a wobbling sideways push.']) }, { uv: ['uv', 'uv'] }),
        nv('vec2', 'multiply', 'wobble', 560, 420, { b: 0.5, ...note(['Multiply: half of the slope, so the wobble stays gentle.']) }, { a: ['air', 'slope'] }),
        n('makeVec2', 'up', 560, 600, { x: 0, y: 1, ...note(['Make Vec2: straight up, 1 long: hot smoke rises.']) }),
        nv('vec2', 'add', 'draught', 820, 500, note(['Add: up plus the wobble: the flow the smoke follows.']), { a: ['up', 'xy'], b: ['wobble', 'result'] }),
        n('advect', 'smoke', 1080, 260, {
          label: 'Smoke', speed: 3, swirl: 0, fade: 0.9, inject: 0.06, mode: 'add', diffuse: 0.12,
          ...note([
            'Advect: the smoke. Every frame the old smoke moves 3 pixels along the draught, and a little warm colour is added in the flame (Add mode: thick where lots has gathered).',
            'Fade 0.9 thins it as it climbs, so it vanishes before the top; Soften 0.12 blurs it a little each frame, so it spreads into soft plumes.',
          ]),
        }, { colour: ['warm', 'rgb'], mask: ['flame', 'alpha'], flow: ['draught', 'result'] }),
        n('textureLevels', 'tone', 1340, 260, { rollOff: 0.8, ...note(['Levels (texture): Roll-off 0.8 tames the thickest smoke so it glows instead of turning flat white. It reads Advect\'s Texture.']) }, { texture: ['smoke', 'texture'] }),
        n('output', 'out', 1600, 260, note(['Output: the rising smoke.']), { color: ['tone', 'color'] }),
      ],
      play: play([
        ctl('rise', 'smoke::speed', 'Rise speed (pixels a frame)', 0, 8, 0.05),
        ctl('fade', 'smoke::fade', 'Thinning (per second)', 0, 3, 0.01),
        ctl('soft', 'smoke::diffuse', 'Spread', 0, 0.5, 0.005),
        ctl('wind', 'smoke::swirl', 'Wind (degrees)', -60, 60, 0.5),
      ], `**What it shows.** Smoke is a picture carried upwards: Advect adds a little colour at the flame every frame and moves everything along a flow that is mostly up, with a noise wobble.

**How it is built.** UV → Circle SDF → SDF Fill (the flame) → Inject mask. Noise's Slope × 0.5 + straight up → Flow. Advect (Add) → Levels (texture) to tame the brightest smoke.

**Try.** Turn *Wind* to bend the smoke sideways (Swirl turns the whole flow). Lower *Thinning* for a tall column; raise *Spread* for a softer plume.`),
    },

    advectMarbling: {
      ...ADVECT_EXAMPLE_INDEX.advectMarbling,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('splitVec2', 'xy', 300, 260, note(['Split Vec2: just the left–right place.']), { v: ['uv', 'uv'] }),
        n('palette', 'stripes', 560, 260, { scale: 1.6, preset: '3', ...note(['Palette: colour bands across the picture: the colour changes with the left–right place, over and over, so the paper starts striped.']) }, { value: ['xy', 'x'] }),
        n('time', 'time', 40, 520, note(['Time: seconds since the start (↺ starts it over).'])),
        n('compare', 'start', 300, 520, { operator: '<', b: 0.35, ...note(['Compare: 1 for the first 0.35 seconds, then 0 for ever: the stripes go in once, at the start.']) }, { a: ['time', 'time'] }),
        n('noise', 'comb', 560, 520, { kind: 'perlin', dims: '3d', scale: 1.8, detail: 2, speed: 0.15, ...note(['Noise (Perlin, 3D, slow): a smooth field of hills. Its Slope points uphill.']) }, { uv: ['uv', 'uv'] }),
        n('advect', 'paper', 860, 360, {
          label: 'Marbling', speed: 1.4, swirl: 90, fade: 0, inject: 1, mode: 'mix', diffuse: 0, wrap: 'mirror',
          ...note([
            'Advect: the marbling bath. For the first moment the stripes are painted in fully (Inject 1 where the mask is 1); after that nothing new goes in, and the stripes keep being carried round.',
            'Swirl 90 turns the uphill Slope sideways, so the paint runs along the hills\' contours instead of piling up on them: it folds round and round like a comb dragged through floating paint. Fade 0 and Soften 0 keep the colours crisp.',
          ]),
        }, { colour: ['stripes', 'color'], mask: ['start', 'mask'], flow: ['comb', 'slope'] }),
        n('output', 'out', 1140, 360, note(['Output: the marbled paper.']), { color: ['paper', 'color'] }),
      ],
      play: play([
        ctl('speed', 'paper::speed', 'Combing speed', 0, 5, 0.05),
        ctl('swirl', 'paper::swirl', 'Swirl (degrees)', -180, 180, 0.5),
        ctl('stripes', 'stripes::scale', 'Stripe count (press ↺)', 0.3, 6, 0.05),
      ], `**What it shows.** Inject decides what is new; with it off, Advect just keeps moving what is there. The stripes go in once and are then folded by the flow alone.

**How it is built.** UV's X → Palette (stripes) → Colour. Time < 0.35 → Inject mask. Noise's Slope → Flow, turned 90° by Swirl.

**Try.** Press ↺ to lay fresh stripes. *Swirl* 0 pushes the paint uphill (it bunches into the hilltops); 90 or −90 folds it along the contours. Change *Stripe count* then ↺.`),
    },

    advectPhotoMelt: {
      ...ADVECT_EXAMPLE_INDEX.advectPhotoMelt,
      counter: 30,
      nodes: [
        n('textureInput', 'photo', 40, 200, { fit: 'stretch', ...builtinImageParams(ROOM_AND_CAT_ID), ...note(['Texture Input: the built-in photo Room and cat. Choose your own picture on this card. Its Texture is the picture Advect paints in.']) }),
        n('uv', 'uv', 40, 460, note(['UV: this pixel\'s place in the picture.'])),
        n('noise', 'drip', 300, 460, { kind: 'simplex', dims: '3d', scale: 3, detail: 1, speed: 0.3, ...note(['Noise (Simplex, 3D): slowly changing bumps. Its Slope makes the melt run unevenly, in drips.']) }, { uv: ['uv', 'uv'] }),
        n('makeVec2', 'down', 300, 700, { x: 0, y: -1, ...note(['Make Vec2: straight down, 1 long: wet paint runs down.']) }),
        nv('vec2', 'add', 'run', 560, 560, note(['Add: down plus the drips: the way the photo runs.']), { a: ['down', 'xy'], b: ['drip', 'slope'] }),
        n('advect', 'melt', 820, 300, {
          label: 'Melt', speed: 1.2, swirl: 0, fade: 0, inject: 0.02, mode: 'mix', diffuse: 0.02,
          ...note([
            'Advect: the photo is the Source. Each frame the picture already there runs 1.2 pixels along the flow (down, with drips), and Inject 0.02 lays the photo back in a little.',
            'The two pull against each other: the melt drags the picture down, the fresh photo pulls it back, so it smears and recovers at the same time. No Inject mask: the photo goes in everywhere.',
          ]),
        }, { texture: ['photo', 'texture'], flow: ['run', 'result'] }),
        n('output', 'out', 1100, 300, note(['Output: the melting photo.']), { color: ['melt', 'color'] }),
      ],
      play: play([
        ctl('speed', 'melt::speed', 'Melt speed (pixels a frame)', 0, 6, 0.05),
        ctl('inject', 'melt::inject', 'Photo comes back', 0, 0.2, 0.001),
        ctl('swirl', 'melt::swirl', 'Run direction (degrees)', -180, 180, 0.5),
      ], `**What it shows.** Inject is a tug of war with Speed: a little fresh photo every frame against the flow dragging it away.

**How it is built.** Texture Input's Texture → Advect's Source. Noise's Slope + straight down → Flow.

**Try.** *Photo comes back* 0: the photo melts away for good (↺ brings it back). 0.2: barely any melt. Turn *Run direction* to 180 and the paint runs upwards.`),
    },

    advectMousePaint: {
      ...ADVECT_EXAMPLE_INDEX.advectMousePaint,
      counter: 30,
      nodes: [
        n('brush', 'tip', 40, 300, { radius: 18, softness: 12, paint: 'always', ...note(['Brush: 1 under the pointer, wherever it is (Paint: Always), with a soft edge: where the paint goes in.']) }),
        n('time', 'time', 40, 520, note(['Time: seconds since the start.'])),
        n('palette', 'hue', 300, 520, { scale: 0.15, preset: '1', ...note(['Palette: the paint\'s colour, turning through the hues as time goes on.']) }, { value: ['time', 'time'] }),
        n('advect', 'paint', 600, 360, {
          label: 'Paint', speed: 2.2, swirl: 0, curlSize: 2, fade: 0.25, inject: 0.8, mode: 'max', diffuse: 0.06,
          ...note([
            'Advect: the paint under the brush goes in (Max: the brighter of new and old, so trails never wash out), and everything is carried off along the built-in curl (Flow is empty).',
            'Fade 0.25 dims the old paint slowly; Soften blurs it a little, so trails turn into soft streams.',
          ]),
        }, { colour: ['hue', 'color'], mask: ['tip', 'mask'] }),
        n('output', 'out', 880, 360, note(['Output: the paint.']), { color: ['paint', 'color'] }),
      ],
      play: play([
        ctl('speed', 'paint::speed', 'Stream speed (pixels a frame)', 0, 8, 0.05),
        ctl('swirl', 'paint::swirl', 'Stir (degrees)', -180, 180, 0.5),
        ctl('fade', 'paint::fade', 'Fade (per second)', 0, 2, 0.01),
        ctl('size', 'paint::curlSize', 'Swirl size', 0.3, 5, 0.01),
      ], `**What it shows.** Inject mask is any number: here a Brush, so the paint goes in only under the pointer, and Advect's built-in curl carries it away.

**How it is built.** Brush → Inject mask; Time → Palette → Colour; Flow empty (the built-in curl).

**Try.** Move the pointer slowly, then quickly. Turn *Stir* to 90: the curl runs along its own swirls and the paint turns in circles. Set Mode to Add on the card for glowing build-up.`),
    },

    advectVoronoiVortex: {
      ...ADVECT_EXAMPLE_INDEX.advectVoronoiVortex,
      counter: 30,
      nodes: [
        n('uv', 'uv', 40, 300, note(['UV: this pixel\'s place in the picture.'])),
        n('voronoi', 'cells', 300, 160, { scale: 6, jitter: 1, ...note(['Voronoi: cells round random points. Cell colour is one flat random colour per cell.']) }, { uv: ['uv', 'uv'] }),
        n('makeVec2', 'shift', 300, 440, { x: 0.5, y: 0.5, ...note(['Make Vec2: (0.5, 0.5). Vector Field\'s Vortex turns round the point (0.5, 0.5), so the UV is moved by this much to put that point in the middle of the picture.']) }),
        nv('vec2', 'add', 'centred', 560, 380, note(['Add: UV moved so the whirlpool turns round the middle.']), { a: ['uv', 'uv'], b: ['shift', 'xy'] }),
        n('vectorField', 'whirl', 820, 380, { mode: 'vortex', strength: 1, ...note(['Vector Field, Vortex: at every pixel a direction 1 long going round the middle, anticlockwise.']) }, { uv: ['centred', 'result'] }),
        n('advect', 'drag', 1080, 260, {
          label: 'Whirlpool', speed: 1.5, swirl: 0, fade: 0, inject: 0.03, mode: 'mix', diffuse: 0,
          ...note([
            'Advect: the cells are laid in a little every frame (Inject 0.03, Mix) and everything is carried 1.5 pixels round the whirlpool.',
            'Every pixel moves the same distance, so the middle turns fast and the edge slowly: the cells wind into spiral arms, and the fresh cells keep showing through.',
          ]),
        }, { colour: ['cells', 'cellColour'], flow: ['whirl', 'dir'] }),
        n('output', 'out', 1360, 260, note(['Output: the dragged cells.']), { color: ['drag', 'color'] }),
      ],
      play: play([
        ctl('speed', 'drag::speed', 'Whirl speed (pixels a frame)', -6, 6, 0.05),
        ctl('inject', 'drag::inject', 'Fresh cells', 0, 0.2, 0.001),
        ctl('swirl', 'drag::swirl', 'Pull in (degrees)', -60, 60, 0.5),
        ctl('cells', 'cells::scale', 'Cell density', 1, 15, 0.1),
      ], `**What it shows.** Any vec2 can be a Flow. A Vortex field turns the cells round the middle; Advect keeps the result and keeps turning it.

**How it is built.** UV → Voronoi's Cell colour → Colour. UV + (0.5, 0.5) → Vector Field (Vortex) → Flow.

**Try.** *Pull in* above 0 turns the flow inwards, so the arms are sucked into the middle; below 0 they spread out. *Fresh cells* 0 lets the spiral wind on for ever.`),
    },
  };
}
