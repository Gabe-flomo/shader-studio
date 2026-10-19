/**
 * templates.ts — starting points for the 2D Scene Builder (the Recipe tab's examples) and the
 * three "2D: Scene Builder" examples, each one recipe (docs/scene-builder-2d-plan.md).
 */
import { OFFER_PIECES } from '../nodes/notOffered';
import { parseRecipe2D } from './recipe';
import type { Scene2D } from './spec';

export interface Template2D {
  key: string;
  label: string;
  blurb: string;
  recipe: string;
  /** Not listed (it still loads by key): Picture in pieces (nodes/notOffered.ts). */
  hidden?: boolean;
}

export const TEMPLATES_2D: Template2D[] = [
  {
    key: 'kaleidoscope', label: 'Kaleidoscope of glowing rings',
    blurb: 'Three shapes drift in one wedge of space; eight mirrored wedges and a slow spin turn them into a mandala of neon rings.',
    recipe: 'rotate 0 spin=0.02 · kaleidoscope 8 · ring r=0.3 th=0.02 at=(0.55,0.1) color=cyan @orbit(0.12 speed=0.12) · ring r=0.16 th=0.015 at=(0.3,0.5) color=magenta @pulse(0.3 speed=0.25) · circle r=0.07 at=(0.8,0.35) color=gold @bob(0.1 speed=0.2 dir=0) · glow 0.008 falloff=1.2 · tone aces · bloom 0.4 · background night',
  },
  {
    key: 'orbits', label: 'Orbiting shapes',
    blurb: 'A pulsing sun with three shapes on their own orbits, each spinning at its own pace. Only the shapes marked glow glow.',
    recipe: 'circle r=0.16 color=gold glow @pulse(0.2 speed=0.4) · ring r=0.45 th=0.004 color=grey · star r=0.1 color=pink glow @orbit(0.45 speed=0.2) @spin(0.5) · hexagon r=0.07 color=cyan glow @orbit(0.7 speed=-0.12 phase=90) @spin(-0.3) · heart size=0.1 color=red glow @orbit(0.9 speed=0.08 phase=200) · glow selected · tone aces · bloom 0.4 · vignette 0.4 · background night',
  },
  {
    key: 'ringOfRings', label: 'A ring of rings',
    blurb: 'One small ring, copied into a ring of eight, each of those a ring of six; then the whole thing repeated at a bigger size. Coloured by distance from the centre.',
    recipe: 'ring r=0.035 th=0.008 @spin(0.03) @ring(8 r=0.28 inner=(6,0.09) levels=2 factor=1.8) · glow 0.005 · colour by length palette=rainbow scale=1.5 speed=0.08 · tone aces · bloom 0.5 · background night',
  },
  {
    key: 'mirror', label: 'Mirrored flower',
    blurb: 'A few rounded shapes mirrored left to right and repeated round the centre.',
    recipe: 'polar-repeat 6 · mirror x · smooth-union(circle r=0.12 at=(0.35,0.1), rounded-box size=(0.2,0.05) round=0.04 at=(0.55,0.2) rot=30) k=0.08 color=pink · glow 0.006 · tone aces · background night',
  },
  {
    key: 'melt', label: 'Shapes melting together',
    blurb: 'Four discs on their own orbits, joined by a smooth union: where they come close they melt into one body and their colours blend across the join (mix). Thin rings trace the four discs on their own, so you can see what is being melted. The Blend (k) sets how far apart they start to melt.',
    recipe: 'smooth-union(circle r=0.22 at=(-0.42,0.02) color=#e3b48a @orbit(0.24 speed=0.1), circle r=0.18 at=(0.42,-0.04) color=#7fa6bf @orbit(0.24 speed=-0.1 phase=180), circle r=0.14 at=(0.02,0.34) color=#d8c7a0 @bob(0.2 speed=0.13), circle r=0.24 at=(0,-0.12) color=#b9765a @pulse(0.06 speed=0.2)) k=0.32 mix style=filled · ring r=0.22 th=0.002 at=(-0.42,0.02) color=#f2efe8 @orbit(0.24 speed=0.1) · ring r=0.18 th=0.002 at=(0.42,-0.04) color=#f2efe8 @orbit(0.24 speed=-0.1 phase=180) · ring r=0.14 th=0.002 at=(0.02,0.34) color=#f2efe8 @bob(0.2 speed=0.13) · ring r=0.24 th=0.002 at=(0,-0.12) color=#f2efe8 @pulse(0.06 speed=0.2) · glow 0.0018 falloff=1.6 · tone aces · vignette 0.45 · grain 0.02 · background night',
  },
  {
    key: 'pieces', label: 'Picture in pieces', hidden: !OFFER_PIECES,
    blurb: 'A picture rebuilt from circles, each its colour at home, that scatter on a noise field and flow back together. Pick the picture under Pictures.',
    recipe: 'texture picture · pieces picture count=36 · tone aces · background night',
  },
  {
    key: 'pixel', label: 'Pixel hearts',
    blurb: 'Hearts that pulse and bob, seen through a coarse pixel grid.',
    recipe: 'pixelate 0.05 · heart size=0.25 at=(-0.4,0) color=red @pulse(0.2 speed=0.5) · heart size=0.18 at=(0.35,0.1) color=pink @bob(0.12 speed=0.4) · background navy',
  },
  {
    key: 'depthSize', label: 'Circles sized by depth',
    blurb: 'A field of glowing circles over a picture with depth: each circle\'s radius follows the depth, so they swell on near things and shrink into the distance, and they take the picture\'s colours. Drop a picture on the Texture node it makes (or pick one on the Depth tab).',
    recipe: 'tile 0.2 · circle r=0.07 color=white glow · glow 0.004 falloff=1.3 · tone aces · background black · depth-picture ridges fit=stretch size=(0.15,1.5) with=tint picture=0.55 curve=1.4',
  },
  {
    key: 'depthBeams', label: 'Glow beaming through depth',
    blurb: 'Fine rings of light whose space is moved by the picture\'s depth: where near meets far they bend and break, so they seem to pass behind the subject and in front of the room. A faint warm gradient flows along depth. Drop a picture on the Texture node it makes (or pick one on the Depth tab).',
    recipe: 'ring r=0.2 th=0.0035 color=#ffdcb0 glow @ring(6 r=0.52) @spin(0.03) · glow 0.0022 falloff=1.5 · tone aces · bloom 0.12 · vignette 0.35 · background black · depth-picture photo fit=stretch space=shift shift=0.9 dir=90 focus=0.3 picture=1 gradient=sunset gradient-amount=0.22 cycles=1 flow=0.03',
  },
];

/**
 * Older starting points with a grid of cells. Grids are made in the Grid builder now, so the 2D
 * builder no longer offers these; they still read and build (old scenes and recipes with a grid).
 */
export const GRID_TEMPLATES_2D: Template2D[] = [
  {
    key: 'rippleGrid', label: 'Morphing ripple grid',
    blurb: 'A grid of cells whose shapes melt from circles into squares as ripples from the four corners pass through, coloured by the wave.',
    recipe: 'grid 14 shape=circle shape=box ripple=corners freq=9 speed=0.35 target=morph amount=0.9 · glow 0.006 · tone aces · bloom 0.4 · background night',
  },
  {
    key: 'mouseGrid', label: 'Ripples that follow the mouse',
    blurb: 'Diamonds in a checker with rings, swelling as waves spread from the middle and from wherever the mouse is.',
    recipe: 'grid 16 shape=diamond shape=ring assign=checker ripple=centre ripple=mouse freq=10 speed=0.5 target=size amount=0.7 · glow 0.005 · tone aces · background navy',
  },
];

export function templateScene(key: string): Scene2D {
  const t = TEMPLATES_2D.find(x => x.key === key) ?? GRID_TEMPLATES_2D.find(x => x.key === key);
  if (!t) throw new Error(`No 2D template ${key}`);
  return parseRecipe2D(t.recipe).scene;
}
