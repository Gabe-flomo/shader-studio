/**
 * voxelExamples.ts — the voxel examples, on the one voxel system: the Voxels setting on the March Loop and the
 * GI Lit March Group (docs/march-voxels.md). They replaced the Voxelize-node versions (2026-10-19, node retired).
 *
 *   3D: Voxel Terrain        an island of cubes, GI Lit March Group with Voxels: cube shadows, corner AO
 *   Combo: Voxels + Random   three blobs drawn as cubes by the March Loop, one Random colour per cube
 *
 * Both colour each cube from its cell: the hit point stepped half a cube back along the normal, floored to the grid.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, nv, play } from './graphBuilder';
import { WIGGLE_PALETTE, exprBlock } from './wiggleLook';

const note = (text: string) => ({ __comment: text });
const sub = (nodes: GraphNode[]): SubgraphData => ({ nodes, inputPorts: [], outputPorts: [] });
const passBody = (id: string): SubgraphData => sub([
  n('marchLoopInputs', `${id}_in`, 0, 180, { _groupOriginal: true, ...note('Group Inputs: this step\'s point along the ray.') }),
  n('marchLoopOutput', `${id}_out`, 440, 180, { _groupOriginal: true, ...note('Group Output: the point goes on to the scene unchanged (no warp).') }, { pos: [`${id}_in`, 'marchPos'] }),
]);

export const VOXEL_EXAMPLE_INDEX: Record<string, Pick<ExampleGraph, 'label' | 'description'> & { play?: boolean }> = {
  voxelTerrain: {
    label: '3D: Voxel Terrain',
    description: 'A floating island drawn in cubes by the GI Lit March Group\'s Voxels setting: the scene is a smooth height field (an Expression Block in the Scene Group), and the loop walks a 0.12 grid so every cell inside it is a cube. Its shadow and bounce rays walk the same grid, so the shadows are blocky too, and the corners where cubes meet darken. Outside, each cube\'s cell (Hit Pos stepped half a cube back along the Normal) picks its colour by height on the Wiggle Tunnel palette. Play sets the cube size, the sun and the camera.',
    play: true,
  },
  comboVoxelSpheres: {
    label: 'Combo: Voxels + Random (from ID)',
    description: 'Three drifting blobs (Sphere 3D ×3, Smooth Union) drawn as cubes by the March Loop\'s Voxels setting. Outside, Multiply, Subtract, Divide and Floor turn Hit Pos and Normal into the cube\'s cell, Random (from ID) gives every cell its own number and a Palette turns it into a colour, so each cube keeps its colour as the blobs move through the grid. Multiplied by the loop\'s own lit Color. Voxel size is a Play slider.',
    play: true,
  },
};

/** An Expression Block: the cell a voxel hit belongs to (the hit point is on the cube's face, so step half a cube back). */
const cellBlock = (id: string, x: number, y: number, march: string, size: string) => exprBlock(id, x, y, 'Which cube?', {
  pos: { type: 'vec3', from: [march, 'pos'] }, nrm: { type: 'vec3', from: [march, 'normal'] },
}, [], `floor((pos - nrm * 0.5 * ${size}) / ${size})`,
`Which cube did the ray hit? Hit Pos is on the cube's face, so step half a cube (${size}) back along the Normal to land inside it, then divide by the cube size and floor: whole-number cell coordinates, the same for every pixel of one cube. Keep the size here the same as the loop's Voxel size.`);

/** The same as Which cube?, in nodes: Hit Pos stepped half a cube back along the Normal, ÷ the cube size, floored ('cell'). */
const cellNodes = (x: number, y: number, march: string, size: number): GraphNode[] => [
  nv('vec3', 'multiply', 'halfBack', x, y, { b: size / 2, ...note(`Multiply: the Normal × half a cube (${size / 2}). Hit Pos is on the cube's face; stepping back this far along the Normal lands inside the cube.`) }, { a: [march, 'normal'] }),
  nv('vec3', 'subtract', 'inside', x + 240, y, { ...note('Subtract: Hit Pos less that step, a point inside the cube that was hit.') }, { a: [march, 'pos'], b: ['halfBack', 'result'] }),
  nv('vec3', 'divide', 'inCubes', x + 480, y, { b: size, ...note(`Divide by the cube size (${size}): the point in cubes. Keep it the same as the loop's Voxel size.`) }, { a: ['inside', 'result'] }),
  nv('vec3', 'floor', 'cell', x + 720, y, { ...note('Floor: whole-number cell coordinates, the same for every pixel of one cube: the cube\'s Cell ID.') }, { input: ['inCubes', 'result'] }),
];

export function buildVoxelExamples(): Record<string, ExampleGraph> {
  // ── 1. Voxel terrain (GI Lit March Group, Voxels) ─────────────────────────
  const vs = 0.12;
  const terrainScene = n('sceneGroup', 'scene', 40, 760, {
    label: 'Island', ...note('The island as one smooth distance: an Expression Block measures a rolling height field cut to a round slab. The loop\'s Voxels turn it into cubes, so nothing in here knows about cubes.'),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note('Scene Pos: the point being measured.') }),
      exprBlock('land', 260, 200, 'Island', { p: { type: 'vec3', from: ['sp', 'pos'] } }, [
        { lhs: 'float h', rhs: '0.55 * sin(p.x * 0.55 + 0.3) * cos(p.z * 0.48) + 0.3 * sin(p.x * 1.3 - p.z * 0.9) + 0.16 * cos(p.z * 2.1 + p.x * 0.4)' },
        { lhs: 'float hill', rhs: '1.5 * exp(-dot(p.xz - vec2(0.6, -0.4), p.xz - vec2(0.6, -0.4)) * 0.22)' },
        { lhs: 'float ground', rhs: '(p.y - h - hill) * 0.5' },
        { lhs: 'float slab', rhs: 'max(length(p.xz) - 4.2, -(p.y + 1.5))' },
        { lhs: 'float water', rhs: 'max(p.y + 0.42, length(p.xz) - 4.2)' },
      ], 'min(max(ground, slab), max(water, -(p.y + 1.5)))',
      'The island\'s distance. h: three slow waves make rolling ground; hill: a round hill off-centre. ground: the height above that surface, halved because a height field\'s slope makes the plain difference overshoot. slab: inside a cylinder of radius 4.2 and above y = -1.5, so the land is a round chunk with sheer sides. water: a flat sheet at y = -0.42 inside the same circle, filling the hollows. The scene is the land or the water, whichever is nearer.', 'float'),
      n('sceneOutput', 'so', 620, 200, { _groupOriginal: true, ...note('Scene Output: the island\'s distance.') }, { dist: ['land', 'result'] }),
    ]),
  });
  const terrain: ExampleGraph = {
    ...VOXEL_EXAMPLE_INDEX.voxelTerrain,
    counter: 40,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit.') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 8.4, camAngle: 0.7, camElevation: 0.5, rotSpeed: 0.04, fov: 1.7, targetY: -0.2, ...note('March Camera: a slow orbit, looking down on the island from above so the terraces and their shadows read.') }, { time: ['time', 'time'] }),
      terrainScene,
      n('giLitMarchGroup', 'gi', 340, 220, {
        voxels: true, voxelSize: vs, maxSteps: 200, maxDist: 30, jitter: 0,
        bg: [0.012, 0.016, 0.035], albedo: [1, 1, 1], metallic: 0, roughness: 0.75,
        lightX: 1.7, lightY: 0.62, lightZ: 0.9, lightR: 1.0, lightG: 0.84, lightB: 0.66, lightStrength: 1.15,
        skyTopR: 0.1, skyTopG: 0.16, skyTopB: 0.32, skyBotR: 0.12, skyBotG: 0.08, skyBotB: 0.08,
        shadowSteps: 24, giSteps: 16, giStrength: 0.35, specSteps: 16, specStrength: 0.12,
        subgraph: passBody('gi'),
        ...note(`GI Lit March Group with Voxels on, Voxel size ${vs}: the ray walks a grid of ${vs}-unit cells and stops at the first cell whose centre is inside the island; the cube is lit by the face it came in through. The shadow ray walks the same grid toward a low, warm sun (Light dir 1.7, 0.62, 0.9: about 18 degrees up), so shadows are cube-shaped; AO counts the solid cells round each face, so corners where cubes meet darken; one bounce ray adds colour bleed. Albedo is white here: the colour per cube is multiplied in outside, from the Diffuse and GI outputs.`),
      }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
      cellBlock('cell', 700, 560, 'gi', vs.toString()),
      exprBlock('pick', 960, 560, 'Colour by height', { c: { type: 'vec3', from: ['cell', 'result'] } }, [
        { lhs: 'float y', rhs: `(c.y + 0.5) * ${vs}` },
        { lhs: 'float jitter', rhs: 'fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453)' },
      ], 'min(0.25 + (y + 0.42) * (y > -0.42 ? 0.36 : 0.2) + jitter * 0.035, 0.84)',
      'Where on the palette this cube sits, from its height (the cell\'s centre y) above the water line at -0.42: the water is deep blue (0.25), low ground light blue, the slopes cream and the hilltop orange (0.36 per unit up, held at 0.84 so the top stays orange instead of wrapping round to blue); below the water line the cliffs darken toward maroon (0.2 per unit down). jitter: a tiny random nudge per cube (a hash of the cell), so neighbouring cubes differ a little, like real blocks.', 'float'),
      n('palette', 'pal', 1200, 560, { ...WIGGLE_PALETTE, ...note('Palette: the Wiggle Tunnel\'s colours (phase 0.3, 0.416, 0.557), read by height: navy, sky blue, cream, orange.') }, { value: ['pick', 'result'] }),
      exprBlock('light', 1440, 300, 'Light the cubes', {
        alb: { type: 'vec3', from: ['pal', 'color'] }, dif: { type: 'vec3', from: ['gi', 'diffuse'] }, bounce: { type: 'vec3', from: ['gi', 'gi'] },
        refl: { type: 'vec3', from: ['gi', 'refl'] }, hit: { type: 'float', from: ['gi', 'hit'] }, sky: { type: 'vec3', from: ['gi', 'color'] },
      }, [], 'mix(sky, alb * (dif + bounce) + refl, hit)',
      'The loop lit a white island: Diffuse is sun (with the cube shadows) plus sky (with the corner AO), GI is the bounce. Multiplying them by the cube\'s palette colour is the same as giving each cube that albedo; the reflection is added on top. Where the ray missed, the loop\'s own Color (the background).'),
      n('vignette', 'vig', 1680, 300, { radius: 0.8, softness: 0.6, strength: 0.6, ...note('Vignette: a gentle darkening toward the corners.') }, { color: ['light', 'result'] }),
      n('toneMap', 'tone', 1900, 300, { mode: 'aces', ...note('Tone Map (ACES): the sunlit tops go a little over 1; ACES rolls them off so they keep their colour.') }, { color: ['vig', 'result'] }),
      n('output', 'out', 2120, 300, { ...note('Output: the picture.') }, { color: ['tone', 'color'] }),
    ],
    play: play([
      ctl('vs', 'gi::voxelSize', 'Cube size', 0.05, 0.4, 0.005),
      ctl('ls', 'gi::lightStrength', 'Sun strength', 0, 3, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A floating island made of cubes, lit like a diorama: a low warm sun throws blocky shadows across the terraces, the corners where cubes meet fall into shade, and each cube is coloured by its height (deep blue water, light blue lowlands, cream slopes, an orange hilltop, cliffs darkening to maroon).

**How it is built.** The Scene Group measures one smooth shape: a rolling height field cut to a round slab, with a sheet of water in the hollows. Nothing in it is a cube. The **GI Lit March Group** has **Voxels** on: the ray walks a grid cell by cell and stops at the first cell whose centre is inside the island. Max Steps is 200 (the walk runs up to twice that) because rays that skim the flat ground cross many cells. Its shadow, bounce and reflection rays walk the same grid, so the light and shadow are cubes too, and AO counts the solid cells round each face. Outside, an Expression Block finds the cube's cell from Hit Pos and Normal, a second turns the cell's height into a palette position, and the palette colour multiplies the loop's Diffuse and GI outputs.

**Try.** Slide **Cube size** down to 0.06 for fine blocks, or up to 0.3 for chunky ones (keep the size in the Which cube? block the same, or the colours slip off their cubes). On the loop, move Light X / Y (the sun's direction) for long evening shadows or a noon sun; **Sun strength** brightens it. Turn Voxels off on the loop to see the smooth island it is made from.`),
  };

  // ── 2. Combo: Voxels + Random (from ID) ───────────────────────────────────
  const bs = 0.1;
  /** One sphere on a tilted circle: a spinning Transform (the orbit) then a moving one (the radius), then the Sphere. */
  const orbiter = (k: string, y: number, o: { tilt: number; start: number; spin: number; out: number; r: number; what: string }): GraphNode[] => [
    n('transform', `orbit${k}`, 260, y, { dim: '3', rx: o.tilt, ry: o.start, spin: o.spin, spinAxis: 'y', ...note(`Transform: spins this sphere's space about the up axis, ${o.spin}° a second, tilted ${o.tilt}° so its circle rises and falls (it starts ${o.start}° round). The next Transform moves the sphere out from the middle, so together they carry it round a circle.`) }, { p: ['sp', 'pos'] }),
    n('transform', `out${k}`, 520, y, { dim: '3', x: o.out, ...note(`Transform: moves the sphere ${o.out} out from the middle, in the spinning space: the radius of its circle.`) }, { p: [`orbit${k}`, 'p'] }),
    n('sphereSDF3D', `ball${k}`, 780, y, { radius: o.r, ...note(`Sphere, radius ${o.r}: ${o.what}`) }, { pos: [`out${k}`, 'p'] }),
  ];
  const blobScene = n('sceneGroup', 'scene', 40, 760, {
    label: 'Three blobs', ...note('Three spheres on slow tilted circles, melted together with Smooth Unions. The loop\'s Voxels turn the melted shape into cubes.'),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note('Scene Pos: the point being measured.') }),
      ...orbiter('A', 0, { tilt: 24, start: 0, spin: 28.6, out: 0.9, r: 0.75, what: 'the biggest blob.' }),
      ...orbiter('B', 260, { tilt: -30, start: 120, spin: 22.9, out: 0.9, r: 0.6, what: 'the middle blob, a third of a turn behind and slower, so the three keep meeting and parting.' }),
      ...orbiter('C', 520, { tilt: 32, start: 240, spin: 25.8, out: 0.8, r: 0.5, what: 'the smallest blob.' }),
      n('sdfUnion', 'meltAB', 1040, 120, { k: 0.5, ...note('Union, Smooth 0.5: the first two spheres melt into one blob where they come within half a unit of each other.') }, { a: ['ballA', 'dist'], b: ['ballB', 'dist'] }),
      n('sdfUnion', 'melt', 1280, 260, { k: 0.5, ...note('Union, Smooth 0.5: and the third. As they move through the cube grid, cubes switch on and off at the blob\'s edge.') }, { a: ['meltAB', 'dist'], b: ['ballC', 'dist'] }),
      n('sceneOutput', 'so', 1520, 260, { _groupOriginal: true, ...note('Scene Output: the blob\'s distance.') }, { dist: ['melt', 'dist'] }),
    ]),
  });
  const combo: ExampleGraph = {
    ...VOXEL_EXAMPLE_INDEX.comboVoxelSpheres,
    counter: 30,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit.') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 3.0, camAngle: 0.6, camElevation: 0.35, rotSpeed: 0.08, fov: 1.5, ...note('March Camera: a slow orbit round the blobs.') }, { time: ['time', 'time'] }),
      blobScene,
      n('marchLoopGroup', 'march', 340, 220, {
        voxels: true, voxelSize: bs, maxSteps: 96, maxDist: 20, jitter: 0, bg: [0.012, 0.014, 0.03], albedo: [1, 1, 1], subgraph: passBody('march'),
        ...note(`March Loop with Voxels on (Advanced), Voxel size ${bs}: the ray walks a cube grid cell by cell and stops at the first cell whose centre is inside the blobs, so any scene becomes cubes. Its Color lights each cube by the face the ray came in through.`),
      }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
      ...cellNodes(700, 560, 'march', bs),
      n('randomFromId', 'rnd', 1400, 560, { from: 0, to: 0.45, seed: 3, ...note('Random (from ID): one number from 0 to 0.45 per cell, from its Cell ID. The same cell always gets the same number, so a cube keeps its colour while it exists.') }, { id: ['cell', 'output'] }),
      n('palette', 'pal', 1640, 560, { ...WIGGLE_PALETTE, anim: 0.2, speed: 1, ...note('Palette: the Wiggle Tunnel\'s colours. Angle offset 0.2 plus the random 0 to 0.45 spans navy, sky blue and cream, with the odd orange cube.') }, { value: ['rnd', 'value'] }),
      nv('vec3', 'multiply', 'tinted', 1880, 300, { ...note('Multiply: the loop\'s Color (white cubes lit by their faces) times the cube\'s palette colour.') }, { a: ['march', 'color'], b: ['pal', 'color'] }),
      nv('vec3', 'multiply', 'lift', 2120, 300, { b: 1.4, ...note('Multiply by 1.4: a lift, because the side faces are dim.') }, { a: ['tinted', 'result'] }),
      nv('vec3', 'mix', 'tint', 2360, 300, { ...note('Mix by Hit: the coloured cubes where the ray hit, the loop\'s own background where it missed (so the background is not tinted).') }, { a: ['march', 'color'], b: ['lift', 'result'], t: ['march', 'hit'] }),
      n('vignette', 'vig', 2600, 300, { radius: 0.8, softness: 0.6, strength: 0.6, ...note('Vignette: a gentle darkening toward the corners.') }, { color: ['tint', 'result'] }),
      n('output', 'out', 2840, 300, { ...note('Output: the picture.') }, { color: ['vig', 'result'] }),
    ],
    play: play([
      ctl('vs', 'march::voxelSize', 'Cube size', 0.04, 0.3, 0.005),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** Three soft blobs melting into each other, drawn as cubes. As the blobs drift, cubes appear at their leading edge and vanish behind, and every cube keeps its own colour.

**How it is built.** The Scene Group is plain: three spheres, each carried round a tilted circle by two Transforms (one spinning, one moving it out), joined by Smooth Unions. The **March Loop** has **Voxels** on (in its Advanced section), so the ray walks a cube grid and any scene becomes cubes. Outside: Multiply, Subtract, Divide and **Floor** turn Hit Pos and Normal into the cube's cell, **Random (from ID)** gives the cell a number, a **Palette** turns it into a colour, and that multiplies the loop's lit Color (a Mix by Hit keeps the background where the ray missed).

**Try.** Slide **Cube size** (and set the same size on the Multiply (half of it) and Divide before the Floor, or the colours slip). Swap the blobs for any Scene Group, or turn Voxels off to see the smooth shape.`),
  };

  return { voxelTerrain: terrain, comboVoxelSpheres: combo };
}
