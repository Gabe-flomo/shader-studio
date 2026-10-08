/**
 * templates.ts — starting points for the 2D Scene Builder (the Recipe tab's examples) and the
 * three "2D: Scene Builder" examples, each one recipe (docs/scene-builder-2d-plan.md).
 */
import { parseRecipe2D } from './recipe';
import type { Scene2D } from './spec';

export interface Template2D {
  key: string;
  label: string;
  blurb: string;
  recipe: string;
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
    key: 'rippleGrid', label: 'Morphing ripple grid',
    blurb: 'A grid of cells whose shapes melt from circles into squares as ripples from the four corners pass through, coloured by the wave.',
    recipe: 'grid 14 shape=circle shape=box ripple=corners freq=9 speed=0.35 target=morph amount=0.9 · glow 0.006 · tone aces · bloom 0.4 · background night',
  },
  {
    key: 'mouseGrid', label: 'Ripples that follow the mouse',
    blurb: 'Diamonds in a checker with rings, swelling as waves spread from the middle and from wherever the mouse is.',
    recipe: 'grid 16 shape=diamond shape=ring assign=checker ripple=centre ripple=mouse freq=10 speed=0.5 target=size amount=0.7 · glow 0.005 · tone aces · background navy',
  },
  {
    key: 'pixel', label: 'Pixel hearts',
    blurb: 'Hearts that pulse and bob, seen through a coarse pixel grid.',
    recipe: 'pixelate 0.05 · heart size=0.25 at=(-0.4,0) color=red @pulse(0.2 speed=0.5) · heart size=0.18 at=(0.35,0.1) color=pink @bob(0.12 speed=0.4) · background navy',
  },
];

export function templateScene(key: string): Scene2D {
  const t = TEMPLATES_2D.find(x => x.key === key);
  if (!t) throw new Error(`No 2D template ${key}`);
  return parseRecipe2D(t.recipe).scene;
}
