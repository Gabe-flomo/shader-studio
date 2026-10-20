/**
 * repeatSceneExamples.ts — Repeat Scene (docs/repeat-scene.md): bubbles of random size and
 * position, repeated in a grid, that reach into each other's cells. With Neighbours off they get
 * sliced flat at the cell walls; with "Nearest 8, only when needed" they overlap cleanly.
 *
 * Listed in the 3D SDF folder. Built from the node definitions (graphBuilder.ts).
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { ctl, n, nv, play } from './graphBuilder';
import { WIGGLE_PALETTE } from './wiggleLook';
import { note } from './agentExampleKit';
import type { ExampleGraph } from './exampleIndex';
import { REPEAT_SCENE_EXAMPLE_INDEX } from './repeatSceneExampleIndex';

const sub = (nodes: GraphNode[]): SubgraphData => ({ nodes, inputPorts: [], outputPorts: [] });
const BG: [number, number, number] = [0.03, 0.035, 0.06];

/** Length of a vec3 (the card's type picker set to vec3: a vec3 in, a float out). */
function vec3Length(id: string, x: number, y: number, from: [string, string], comment: string): GraphNode {
  const node = n('length', id, x, y, { outputType: 'vec3', ...note([comment]) }, { input: from });
  node.inputs.input = { ...node.inputs.input, type: 'vec3' };
  return node;
}

function bubbles(centre = false): GraphNode[] {
  const bubble = n('sceneGroup', 'bubble', 40, 480, {
    label: 'One bubble', ...note(['One bubble, measured once per copy by Repeat Scene. Repeat Cell tells it which copy it is, so each one gets its own size and place.']),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured, already moved into this copy\'s cell by Repeat Scene.']) }),
      n('repeatCell', 'cell', 0, 420, { seed: 3, ...note(['Repeat Cell: which copy this is. Random 3 is three random numbers per copy, the same every frame.']) }),
      n('makeVec3', 'spread', 0, 640, { r: 1.4, g: 0, b: 1.4, ...note(['Make Vec3 (1.4, 0, 1.4): how far a copy may be jiggled across (x) and deep (z), and not at all up (y).']) }),
      nv('vec3', 'multiply', 'jiggle', 300, 420, { ...note(['Multiply: this copy\'s three random numbers (0 to 1) times that spread, so each copy gets its own jiggle of up to 1.4 across and deep.']) }, { a: ['cell', 'random3'], b: ['spread', 'rgb'] }),
      n('transform', 'place', 300, 200, { dim: '3', x: -0.7, y: centre ? -0.55 : 0, z: -0.7, ...note(centre
        ? ['Transform: moves this copy\'s bubble by the jiggle (Offset) less 0.7 (Move), so it lands up to 0.7 either side of the middle of its cell; and down 0.55 so it sits in the floor (and melts into it).']
        : ['Transform: moves this copy\'s bubble by the jiggle (Offset) less 0.7 (Move), so it lands up to 0.7 either side of the middle of its cell and bubbles crowd their neighbours.']) },
      { p: ['sp', 'pos'], offset: ['jiggle', 'result'] }),
      n('splitVec3', 'rnd', 300, 640, { ...note(['Split Vec3: the copy\'s random numbers one by one; the second (Y) picks its size, so size and place are not tied together.']) }, { v: ['cell', 'random3'] }),
      ...(centre ? [
        n('remap', 'own', 560, 640, { inMin: 0, inMax: 1, outMin: 0.3, outMax: 0.6, ...note(['Remap: the random number as this copy\'s own radius, 0.3 to 0.6.']) }, { value: ['rnd', 'y'] }),
        vec3Length('far', 560, 860, ['cell', 'centre'], 'Length: how far this copy\'s cell Centre is from the middle of the grid (the centrepiece). There is one layer of copies, so the Centre\'s height is 0.'),
        n('remap', 'swell', 820, 860, { inMin: 2, inMax: 8, outMin: 2, outMax: 1, smooth: 'smoothstep', clamp: true, ...note(['Remap (Smoothstep): twice the size beside the centrepiece (2 away), easing to normal by 8 away, so the copies swell and melt into it.']) }, { value: ['far', 'result'] }),
        n('multiply', 'size', 820, 640, { outputType: 'float', ...note(['Multiply: the copy\'s own radius × the swell: its size.']) }, { a: ['own', 'result'], b: ['swell', 'result'] }),
      ] : [
        n('remap', 'size', 560, 640, { inMin: 0, inMax: 1, outMin: 0.45, outMax: 1.05, ...note(['Remap: the random number as a radius from 0.45 to 1.05 per copy. With the jiggle, big bubbles reach well past their 2-wide cell.']) }, { value: ['rnd', 'y'] }),
      ]),
      n('sphereSDF3D', 'ball', 620, 200, { ...note(['Sphere: the bubble, at the jiggled place with this copy\'s size.']) }, { pos: ['place', 'p'], radius: ['size', 'result'] }),
      n('sceneOutput', 'so', 900, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to this copy\'s bubble.']) }, { dist: ['ball', 'dist'] }),
    ]),
  });
  const floor = centre ? n('sceneGroup', 'floorScene', 40, 760, {
    label: 'Floor and centrepiece', ...note(['Not repeated (wired into Repeat Scene\'s Not repeated): the floor and one big sphere in the middle, added once.']),
    subgraph: sub([
      n('scenePos', 'fsp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      n('planeSDF3D', 'plane', 300, 200, { height: -1.0, ...note(['Plane 3D: the floor.']) }, { p: ['fsp', 'pos'] }),
      n('sphereSDF3D', 'big', 300, 420, { radius: 2.0, ...note(['Sphere: the centrepiece, radius 2, in the middle of the grid.']) }, { pos: ['fsp', 'pos'] }),
      n('sdfUnion', 'both', 600, 300, { k: 0, ...note(['Union: the floor and the centrepiece.']) }, { a: ['plane', 'dist'], b: ['big', 'dist'] }),
      n('sceneOutput', 'fso', 900, 300, { _groupOriginal: true, ...note(['Scene Output: the distance to the floor or the centrepiece.']) }, { dist: ['both', 'dist'] }),
    ]),
  }) : n('sceneGroup', 'floorScene', 40, 760, {
    label: 'Floor', ...note(['The floor: not repeated (wired into Repeat Scene\'s Not repeated), just added once.']),
    subgraph: sub([
      n('scenePos', 'fsp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      n('planeSDF3D', 'plane', 300, 200, { height: -1.0, ...note(['Plane 3D: a floor just under the bubbles.']) }, { p: ['fsp', 'pos'] }),
      n('sceneOutput', 'fso', 600, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to the floor.']) }, { dist: ['plane', 'dist'] }),
    ]),
  });
  const rep = n('repeatScene', 'rep', 340, 600, {
    cellX: 2.0, cellY: 50.0, cellZ: 2.0, neighbours: 'skip', overlap: 0.7, ...(centre ? { combine: 'smooth', blend: 0.6 } : {}), ...note([
      ...(centre ? ['Combine: Smooth union, Blend 0.6: the bubbles melt into the floor and the centrepiece where they meet, like wax.'] : []),
      'Repeat Scene: the bubble in every 2 × 2 cell across the floor (Cell Y 50 is one layer).',
      'Neighbours "Nearest 8, only when needed": each point measures its own cell\'s bubble, and the 7 cells round its nearest corner only when one of those could be closer (the point is nearer a wall than its own bubble, less Overlap). Set it to Off to see the bubbles sliced flat at the cell walls.',
    ]),
  }, { scene: ['bubble', 'scene'], ground: ['floorScene', 'scene'] });
  const loopBody = sub([
    n('marchLoopInputs', 'march_in', 0, 180, { _groupOriginal: true, ...note(['Group Inputs: the ray at this step.']) }),
    n('marchLoopOutput', 'march_out', 440, 180, { _groupOriginal: true, ...note(['Group Output: the point handed to the scene, unwarped.']) }, { pos: ['march_in', 'marchPos'] }),
  ]);
  return [
    n('time', 'time', 40, 300, { ...note(['Time: turns the camera slowly.']) }),
    n('marchCamera', 'cam', 40, 0, { camDist: 9, camAngle: 0.5, camElevation: 0.45, rotSpeed: 0.05, fov: 1.6, ...note(['March Camera: circles slowly above the bubbles.']) }, { time: ['time', 'time'] }),
    bubble, floor, rep,
    n('marchLoopGroup', 'march', 640, 220, { maxSteps: 120, maxDist: 60, bg: BG, albedo: [0.75, 0.8, 0.9], subgraph: loopBody, ...note(['March Loop: walks every ray into the repeated scene.']) },
      { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['rep', 'scene'] }),
    n('repeatCell', 'hitCell', 940, 520, { seed: 7, ...note([
      'Repeat Cell, after the loop: with the Repeat Scene and the Hit Pos wired in, it looks up which copy each ray hit, so a bubble is one colour even where it overlaps another\'s cell.',
    ]) }, { scene: ['rep', 'scene'], pos: ['march', 'pos'] }),
    n('palette', 'pal', 1220, 520, { ...WIGGLE_PALETTE, anim: 0.2, speed: 1, scale: 0.5, ...note([
      'Palette: a colour per bubble from Repeat Cell\'s Random, on the Wiggle Tunnel\'s colours (navy, sky blue, cream, orange). Scale 0.5 spreads the random number over half the wheel, so the bubbles stay in the blues and creams.',
    ]) }, { value: ['hitCell', 'random'] }),
    n('planeSDF3D', 'onFloor', 940, 760, { height: -0.97, ...note(['Plane 3D at the hit point, a hair above the floor: below 0 where the ray landed on the floor, above 0 on a bubble. Material Select reads it.']) }, { p: ['march', 'pos'] }),
    n('colorPicker', 'slate', 1220, 760, { color: [0.07, 0.08, 0.11], ...note(['Colour: the floor, a dark slate, so the bubbles carry the colour.']) }),
    n('materialSelect', 'floorOrBubble', 1460, 520, { ...note(['Material Select: the slate where the floor\'s distance is below 0 (the ray landed on the floor), the bubble\'s palette colour everywhere else.']) },
      { distA: ['onFloor', 'dist'], colorA: ['slate', 'rgb'], colorB: ['pal', 'color'] }),
    ...(centre ? [
      n('sphereSDF3D', 'onCentre', 1220, 1000, { radius: 2.2, ...note(['Sphere at the hit point, a little larger than the centrepiece (2.2 against 2): below 0 on the centrepiece and on bubbles melted right into it.']) }, { pos: ['march', 'pos'] }),
      n('colorPicker', 'wax', 1460, 1000, { color: [0.92, 0.88, 0.8], ...note(['Colour: the centrepiece, a warm wax white.']) }),
      n('materialSelect', 'material', 1700, 520, { ...note(['Material Select: the wax white on the centrepiece, the floor or bubble colour elsewhere.']) },
        { distA: ['onCentre', 'dist'], colorA: ['wax', 'rgb'], colorB: ['floorOrBubble', 'color'] }),
    ] : []),
    n('multiLight', 'lit', 1940, 220, {
      sunFrom: 'angles', azimuth: 55, elevation: 52.7, sunR: 0.9, sunG: 0.88, sunB: 0.82, skyR: 0.3, skyG: 0.32, skyB: 0.38, bounceR: 0.16, bounceG: 0.16, bounceB: 0.18,
      background: 'colour', bgColor: BG,
      ...note(['Multi-Light: a sun from up and to the right, a sky fill from above and a little bounce over each surface\'s colour. Where the ray hit nothing it shows the dark background.']),
    }, { baseColor: centre ? ['material', 'color'] : ['floorOrBubble', 'color'], normal: ['march', 'normal'], hit: ['march', 'hit'] }),
    n('volumetricFog', 'fog', 2180, 220, { density: 0.03, fogR: BG[0], fogG: BG[1], fogB: BG[2], ...note(['Volumetric Fog: the far field fades into the background by the distance each ray travelled (Distance, Density 0.03).']) },
      { color: ['lit', 'color'], depth: ['march', 'dist'], hit: ['march', 'hit'] }),
    n('toneMap', 'tone', 2420, 220, { mode: 'aces', ...note(['Tone Map: film-like curve into the displayable range.']) }, { color: ['fog', 'color'] }),
    n('output', 'out', 2660, 220, { ...note(['Output: the picture.']) }, { color: ['tone', 'color'] }),
  ];
}

export function buildRepeatSceneExamples(): Record<string, ExampleGraph> {
  return {
    repeatSceneBubbles: {
      ...REPEAT_SCENE_EXAMPLE_INDEX.repeatSceneBubbles, counter: 40, nodes: bubbles(),
      play: play([
        ctl('s', 'rep::cellX', 'Spacing X', 1.2, 4, 0.01),
        ctl('z', 'rep::cellZ', 'Spacing Z', 1.2, 4, 0.01),
        ctl('o', 'rep::overlap', 'Overlap allowance', 0, 1.5, 0.01),
        ctl('a', 'cam::camAngle', 'Look around', 0, 6.28, 0.02),
      ], `**What it shows.** Bubbles of random size and place, one per cell of a grid, crowding into each other's cells. Repeat Scene measures each bubble once per copy, and with **Neighbours: Nearest 8, only when needed** it also measures the neighbouring copies where they could be nearer, so overlapping bubbles stay round.

**Try.** On the Repeat Scene card set Neighbours to **Off**: bubbles that reach past their cell are sliced flat at the walls. **Wall cap** stops tearing but still slices. **Nearest 8** is always right and 8× the cost. Lower **Overlap allowance** to 0 and the overlaps start to flicker: the skip test assumes no bubble reaches further than that past its wall. Narrow the **spacing** and the bubbles merge into a crowd.`),
    },
    repeatSceneCentrepiece: {
      ...REPEAT_SCENE_EXAMPLE_INDEX.repeatSceneCentrepiece, counter: 40, nodes: bubbles(true),
      play: play([
        ctl('b', 'rep::blend', 'Melt', 0, 1.5, 0.01),
        ctl('s', 'rep::cellX', 'Spacing X', 1.2, 4, 0.01),
        ctl('a', 'cam::camAngle', 'Look around', 0, 6.28, 0.02),
      ], `**What it shows.** Repeated and not-repeated parts working together. A grid of bubbles (repeated) and a floor with one big centrepiece (Not repeated, added once) are **smooth-unioned** by Repeat Scene's Combine, so the bubbles melt into the floor and the centrepiece where they touch. Each bubble also reads its **Centre** from Repeat Cell and swells the closer it is to the middle, so the copies crowd and melt into the centrepiece.

**Try.** **Melt** (Blend) at 0 is a hard edge; raise it and everything flows together. On the Repeat Scene card set Combine to **Carve** and the centrepiece and floor cut the bubbles away instead; **Carve into** makes the bubbles dig pits in the floor and the sphere; **Intersect** keeps only where they overlap. Open One bubble and swap the swell Remap's Out min and Out max (1 and 2) to make the copies shrink near the middle instead of grow.`),
    },
  };
}
