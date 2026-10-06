/**
 * templates.ts — Scene Builder starting points, written as recipes (so every
 * template is also a test of the recipe language and of the graph builder).
 */
import { parseRecipe } from './recipe';
import type { SceneSpec } from './spec';

export interface SceneTemplate {
  key: string;
  label: string;
  blurb: string;
  recipe: string;
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    key: 'orb', label: 'Glowing orb',
    blurb: 'Volumetric: a see-through ball of light with two rings, the ray walking through it adding glow.',
    recipe: [
      'volumetric density=0.035 falloff=12 shell=0.12 exposure=1.4 tint=(0.35,0.75,1)',
      'smooth-union(sphere r=0.6 name=Core, torus R=0.95 r=0.04 rot=(70,0,0) name="Ring A", torus R=1.15 r=0.035 rot=(-40,30,0) name="Ring B") k=0.15',
      'background night',
      'tone none',
      'camera dist=3.6 elev=12 orbit=8',
      'quality steps=110 dist=8',
    ].join('\n'),
  },
  {
    key: 'blobs', label: 'Smooth-blob sculpture',
    blurb: 'Spheres and a capsule melted together with a smooth union, on a floor, under a warm sun and a sky gradient.',
    recipe: [
      'surface',
      'smooth-union(sphere r=0.55 at=(0,0.05,0) color=(0.85,0.45,0.3) shine=0.4 name=Body, sphere r=0.36 at=(0.55,0.5,0.1) color=(0.9,0.7,0.35) shine=0.4 name=Head, sphere r=0.28 at=(-0.5,0.45,-0.25) color=(0.55,0.3,0.6) shine=0.4, capsule h=0.5 r=0.12 at=(0.1,-0.3,0.55) rot=(0,0,60) color=(0.85,0.45,0.3)) k=0.35 name=Sculpture',
      'plane y=-0.6 color=(0.55,0.55,0.6)',
      'sun dir=(0.7,0.8,0.3)',
      'shadows 12',
      'background top=(0.45,0.6,0.85) bottom=(0.85,0.75,0.65)',
      'camera dist=3.8 angle=30 elev=14 orbit=6',
    ].join('\n'),
  },
  {
    key: 'pillars', label: 'Infinite pillars',
    blurb: 'One pillar and capital repeated forever over a floor; fog fades the distance. Repeat costs nothing per copy.',
    recipe: [
      'surface',
      'union(cylinder r=0.22 h=1.6 round=0.03 color=cream, box size=(0.36,0.06,0.36) round=0.02 at=(0,1.55,0) color=cream, box size=(0.36,0.06,0.36) round=0.02 at=(0,-0.95,0) color=cream) name=Pillar @repeat((2,100,2))',
      'plane y=-1 color=(0.5,0.45,0.4)',
      'sun dir=(0.4,0.8,-0.5) color=(1,0.85,0.65)',
      'fog 0.9',
      'background (0.75,0.7,0.65)',
      'camera dist=4 angle=30 elev=8 orbit=3 x=1 y=0.3 z=1',
      'quality steps=140 dist=40 jitter=0',
    ].join('\n'),
  },
  {
    key: 'twisted', label: 'Twisted torus',
    blurb: 'A standing ring twisted about the up axis: Twist stretches space, so the loop takes smaller steps (Step Scale on auto).',
    recipe: [
      'surface',
      'torus R=0.7 r=0.24 rot=(90,0,0) color=gold shine=0.7 name=Ring @twist(1.4)',
      'plane y=-1.1 color=(0.2,0.22,0.28)',
      'sun dir=(0.5,0.9,0.6)',
      'background top=(0.08,0.1,0.16) bottom=(0.02,0.02,0.04)',
      'camera dist=3.6 elev=10 orbit=10',
      'quality steps=128',
    ].join('\n'),
  },
  {
    key: 'glass', label: 'Glass objects on a plane',
    blurb: 'Glass mode: a ball, a rounded cube and a ring of glass, refracting the floor and the sky behind them.',
    recipe: [
      'glass ior=1.45 dispersion=0.05',
      'sphere r=0.45 at=(-0.65,-0.05,0.2) glass name=Ball',
      'box size=0.32 round=0.06 at=(0.65,-0.18,0.1) rot=(0,30,0) glass name=Cube',
      'torus R=0.4 r=0.1 at=(0,0.05,-0.75) rot=(90,0,0) glass name=Ring',
      'plane y=-0.5 color=(0.3,0.25,0.35) name=Floor',
      'camera dist=3.4 angle=10 elev=18',
    ].join('\n'),
  },
  {
    key: 'menger', label: 'Menger-like fold',
    blurb: 'A cube with crosses cut out at three sizes; each cross is folded into a grid by Repeat, the way a Menger sponge is made.',
    recipe: [
      'surface',
      'subtract(box size=1 color=(0.75,0.7,0.65) name=Cube, cross s=0.3333 name="Big holes", cross s=0.1111 name="Middle holes" @repeat(0.6667), cross s=0.037 name="Small holes" @repeat(0.2222)) name=Sponge',
      'sun dir=(0.6,0.75,0.35)',
      'ao 0.03',
      'background top=(0.12,0.12,0.16) bottom=(0.03,0.03,0.05)',
      'camera dist=3.8 angle=38 elev=28 orbit=6',
      'quality steps=128',
    ].join('\n'),
  },
  {
    key: 'room', label: 'GI-lit room',
    blurb: 'GI mode: a corner of a room with a ball and a block; light bounces off the walls and shadows soften with distance.',
    recipe: [
      'gi bounce=0.6 rough=0.45 spec=0.3',
      'plane y=-1 name=Floor',
      'box size=(2,1.5,0.05) at=(0,0.5,-1.6) name="Back wall"',
      'box size=(0.05,1.5,2) at=(-1.6,0.5,0) name="Side wall"',
      'sphere r=0.45 at=(0.2,-0.55,-0.3) name=Ball',
      'box size=(0.3,0.5,0.3) round=0.03 at=(-0.7,-0.5,-0.8) rot=(0,25,0) name=Block',
      'sun dir=(0.5,0.9,0.7) color=(1,0.92,0.8)',
      'background (0.6,0.7,0.85)',
      'camera dist=4.2 angle=40 elev=20',
      'quality steps=96',
    ].join('\n'),
  },
];

export function templateSpec(key: string): SceneSpec {
  const t = SCENE_TEMPLATES.find(x => x.key === key) ?? SCENE_TEMPLATES[0];
  return parseRecipe(t.recipe).spec;
}
