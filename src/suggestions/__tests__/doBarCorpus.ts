/**
 * The Do… bar phrase corpus (doBar.test.ts, and the language goldens in lang/__tests__): a phrase,
 * the small graph it runs on and the plan it reads as ("shape:circle@0,0 move:glow{falloff=8}").
 */
import { n } from '../../store/graphBuilder';
import type { DoContext } from '../doBar';

export const CTX: Record<string, DoContext> = {
  empty: { nodes: [n('output', 'o', 900, 0)], selected: [] },
  circle: {
    nodes: [n('uv', 'u', 0, 0), n('circleSDF', 'c', 420, 0, {}, { position: ['u', 'uv'] }), n('sdfFill', 'f', 840, 0, {}, { d: ['c', 'distance'] }), n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] })],
    selected: ['c'],
  },
  colour: { nodes: [n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 1260, 0, {}, { color: ['p', 'color'] })], selected: ['p'] },
  twoShapes: {
    nodes: [n('circleSDF', 'a', 0, 0), n('boxSDF', 'b', 0, 400), n('sdfFill', 'f', 840, 0, {}, { d: ['a', 'distance'] }), n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] })],
    selected: ['a', 'b'],
  },
  twoColours: { nodes: [n('palette', 'a', 0, 0), n('gradient', 'b', 0, 400), n('output', 'o', 840, 0, {}, { color: ['a', 'color'] })], selected: ['a', 'b'] },
  mask: { nodes: [n('circleSDF', 'c', 0, 0), n('smoothstep', 'm', 420, 0, {}, { value: ['c', 'distance'] }), n('floatToVec3', 'g', 840, 0, {}, { input: ['m', 'result'] }), n('output', 'o', 1260, 0, {}, { color: ['g', 'rgb'] })], selected: ['m'] },
  pass: { nodes: [n('palette', 'p', 0, 0), n('pass', 'pass', 420, 0, {}, { color: ['p', 'color'] }), n('output', 'o', 840, 0, {}, { color: ['pass', 'color'] })], selected: ['pass'] },
  nothingSelected: {
    nodes: [n('uv', 'u', 0, 0), n('fbm', 'f', 420, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 840, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 1260, 0, {}, { color: ['p', 'color'] })],
    selected: [],
  },
};

export const CORPUS: Array<[phrase: string, ctx: keyof typeof CTX, expected: string]> = [
  // The brief's examples
  ['circle in the middle with a glow, falloff 8', 'empty', 'shape:circle@0,0 move:glow{falloff=8}'],
  ['add rings', 'circle', 'move:rings'],
  ['mix these colours', 'twoColours', 'move:mix-pair'],
  ['smoothly blend the edges', 'twoShapes', 'move:blend-pair'],
  ['make it repeat 6 times around', 'circle', 'move:repeat-around<position{count=6}'],
  ['twist the space 0.5', 'circle', 'move:twist<position{amount=0.5}'],
  ['tone map it', 'colour', 'move:tone-map'],
  // Shapes
  ['circle', 'empty', 'shape:circle'],
  ['a box at the top left', 'empty', 'shape:box@-0.45,0.3'],
  ['heart in the centre', 'empty', 'shape:heart@0,0'],
  ['star with a glow', 'empty', 'shape:star move:glow'],
  ['hexagon with rings', 'empty', 'shape:hexagon move:rings'],
  ['circle radius 0.2 with an outline', 'empty', 'shape:circle move:outline'],
  ['a square with an onion 0.03', 'empty', 'shape:box move:onion{thickness=0.03}'],
  ['circles', 'empty', 'shape:circle'],
  ['ring with 12 rings', 'empty', 'shape:ring move:rings{count=12}'],
  // Distance moves on the selection
  ['glow', 'circle', 'move:glow'],
  ['glow falloff 4 red', 'circle', 'move:glow{falloff=4,colour=rgb}'],
  ['outline width 0.02', 'circle', 'move:outline{width=0.02}'],
  ['make it hollow', 'circle', 'move:onion'],
  ['rounder by 0.05', 'circle', 'move:round{amount=0.05}'],
  ['blend it with a box', 'circle', 'move:blend{shape=box}'],
  ['8 rings', 'circle', 'move:rings{count=8}'],
  ['mask', 'circle', 'move:mask-from'],
  // Space moves
  ['warp it', 'circle', 'move:warp<position'],
  ['swirl the space 3', 'circle', 'move:swirl<position{amount=3}'],
  ['polar', 'circle', 'move:polar<position'],
  ['mirror it', 'circle', 'move:mirror<position'],
  ['mirror both ways', 'circle', 'move:mirror<position{axis=both}'],
  ['repeat 5 times', 'circle', 'move:repeat<position{count=5}'],
  ['tile it 3x', 'circle', 'move:repeat<position{count=3}'],
  ['zoom 2', 'circle', 'move:zoom-rotate<position{zoom=2}'],
  ['rotate 45 degrees', 'circle', 'move:zoom-rotate<position{angle=0.785}'],
  ['custom code', 'circle', 'move:code-here'],
  // Colour moves
  ['tonemap', 'colour', 'move:tone-map'],
  ['add grain 0.1', 'colour', 'move:grain{amount=0.1}'],
  ['grade it', 'colour', 'move:grade'],
  ['brighter by 0.3', 'colour', 'move:brighten{amount=0.3}'],
  ['mix with blue', 'colour', 'move:mix-with{colour=rgb}'],
  ['palette', 'colour', 'move:palette'],
  ['glow', 'colour', 'move:glow-colour'],
  ['screen blend', 'colour', 'move:blend-with{mode=screen}'],
  ['tone map the picture', 'nothingSelected', 'move:tone-map'],
  ['circle with a glow then tone map it', 'circle', 'shape:circle move:glow move:tone-map'],
  // Masks, textures
  ['soften', 'mask', 'move:soft-edge'],
  ['invert', 'mask', 'move:invert'],
  ['blur', 'pass', 'move:blur-texture'],
  ['glow', 'pass', 'move:glow-texture'],
  ['trails', 'pass', 'move:trails'],
  // Typos
  ['circel with a glwo', 'empty', 'shape:circle move:glow'],
  ['repaet 4 times', 'circle', 'move:repeat<position{count=4}'],
];
