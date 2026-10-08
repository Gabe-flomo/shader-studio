/**
 * repeatSceneExamples.ts — Repeat Scene (docs/repeat-scene.md): bubbles of random size and
 * position, repeated in a grid, that reach into each other's cells. With Neighbours off they get
 * sliced flat at the cell walls; with "Nearest 8, only when needed" they overlap cleanly.
 *
 * Listed in the 3D SDF folder. Built from the node definitions (graphBuilder.ts).
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { ctl, n, out, play } from './graphBuilder';
import { expr, note } from './agentExampleKit';
import type { ExampleGraph } from './exampleIndex';
import { REPEAT_SCENE_EXAMPLE_INDEX } from './repeatSceneExampleIndex';

const sub = (nodes: GraphNode[]): SubgraphData => ({ nodes, inputPorts: [], outputPorts: [] });
const BG: [number, number, number] = [0.03, 0.035, 0.06];

function bubbles(): GraphNode[] {
  const bubble = n('sceneGroup', 'bubble', 40, 480, {
    label: 'One bubble', ...note(['One bubble, measured once per copy by Repeat Scene. Repeat Cell tells it which copy it is, so each one gets its own size and place.']),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured, already moved into this copy\'s cell by Repeat Scene.']) }),
      n('repeatCell', 'cell', 0, 420, { seed: 3, ...note(['Repeat Cell: which copy this is. Random 3 is three random numbers per copy, the same every frame.']) }),
      expr('place', 300, 200, {
        label: 'Jiggle', inputs: [{ name: 'p', type: 'vec3' }, { name: 'r', type: 'vec3' }], lines: [],
        result: 'p - vec3(r.x - 0.5, 0.0, r.z - 0.5) * 1.4', outputType: 'vec3', wires: { p: ['sp', 'pos'], r: ['cell', 'random3'] },
        note: ['Jiggle: moves this copy\'s bubble up to 0.7 off the middle of its cell (random per copy), so bubbles crowd their neighbours.'],
      }),
      expr('size', 300, 460, {
        label: 'Size', inputs: [{ name: 'r', type: 'vec3' }], lines: [],
        result: '0.45 + 0.6 * r.y', outputType: 'float', wires: { r: ['cell', 'random3'] },
        note: ['Size: a radius from 0.45 to 1.05 per copy. With the jiggle, big bubbles reach well past their 2-wide cell.'],
      }),
      n('sphereSDF3D', 'ball', 620, 200, { ...note(['Sphere: the bubble, at the jiggled place with this copy\'s size.']) }, { pos: ['place', 'result'], radius: ['size', 'result'] }),
      n('sceneOutput', 'so', 900, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to this copy\'s bubble.']) }, { dist: ['ball', 'dist'] }),
    ]),
  });
  const floor = n('sceneGroup', 'floorScene', 40, 760, {
    label: 'Floor', ...note(['The floor: not repeated (wired into Repeat Scene\'s Not repeated), just added once.']),
    subgraph: sub([
      n('scenePos', 'fsp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      n('planeSDF3D', 'plane', 300, 200, { height: -1.0, ...note(['Plane 3D: a floor just under the bubbles.']) }, { p: ['fsp', 'pos'] }),
      n('sceneOutput', 'fso', 600, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to the floor.']) }, { dist: ['plane', 'dist'] }),
    ]),
  });
  const rep = n('repeatScene', 'rep', 340, 600, {
    cellX: 2.0, cellY: 50.0, cellZ: 2.0, neighbours: 'skip', overlap: 0.7, ...note([
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
    expr('shade', 940, 220, {
      label: 'Shade', inputs: [{ name: 'pos', type: 'vec3' }, { name: 'nrm', type: 'vec3' }, { name: 'hit', type: 'float' }, { name: 'dist', type: 'float' }, { name: 'h', type: 'float' }],
      lines: [
        ['float fl', 'step(0.95, nrm.y) * step(pos.y, -0.98)'],
        ['vec3 base', 'mix(0.55 + 0.45 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))), vec3(0.18, 0.2, 0.26), fl)'],
        ['float sun', 'max(dot(nrm, normalize(vec3(0.5, 0.8, 0.35))), 0.0)'],
        ['float sky', '0.5 + 0.5 * nrm.y'],
        ['float rim', 'pow(1.0 - abs(nrm.y), 3.0) * (1.0 - fl)'],
      ],
      result: `mix(vec3(${BG.join(', ')}), base * (0.15 + 0.3 * sky + 0.9 * sun) + 0.15 * rim, hit * exp(-dist * 0.03))`,
      outputType: 'vec3', wires: { pos: ['march', 'pos'], nrm: ['march', 'normal'], hit: ['march', 'hit'], dist: ['march', 'dist'], h: ['hitCell', 'random'] },
      note: [
        'Shade: a colour per bubble from Repeat Cell\'s Random (h), a sun and sky light, a little rim, and fog into the background.',
      ],
    }),
    n('toneMap', 'tone', 1220, 220, { mode: 'aces', ...note(['Tone Map: film-like curve into the displayable range.']) }, { color: ['shade', 'result'] }),
    out(['tone', 'color'], 1480),
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
  };
}
