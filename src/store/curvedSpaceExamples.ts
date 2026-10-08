/**
 * curvedSpaceExamples.ts — the "Curved space" folder (docs/curved-space.md): three ray-marched scenes
 * seen through a bent space or a reverse lens, each with Play sliders on the bend.
 *
 *  - Spherical world: a lattice of spheres in a space of positive curvature (the March Loop's Space curvature);
 *  - Hyperbolic tunnel: a hall of columns in negative curvature, a fisheye tunnel;
 *  - Reverse perspective room: boxes on a floor under the camera's Reverse perspective.
 *
 * Every node carries a plain-language note. Built from the node definitions (graphBuilder.ts), so
 * the examples can't drift from the nodes they use; the examples test compiles each one and checks
 * its Play controls point at live params.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import type { PlayControl } from '../types/play';
import { ctl, n, out, play } from './graphBuilder';
import { expr, note } from './agentExampleKit';
import type { ExampleGraph } from './exampleIndex';
import { CURVED_EXAMPLE_INDEX } from './curvedSpaceExampleIndex';

type Wire = [fromId: string, outputKey: string];
type ScenePort = { key: string; label: string; from: Wire; to: [nodeId: string, inputKey: string] };

const sub = (nodes: GraphNode[]): SubgraphData => ({ nodes, inputPorts: [], outputPorts: [] });

/** A Scene Group: Scene Pos → `shapes` → Scene Output; `dist` is the wire into Scene Output. Optional float port from outside. */
function scene(id: string, x: number, y: number, label: string, shapes: GraphNode[], dist: Wire, comment: string[], port?: ScenePort): GraphNode {
  const group = n('sceneGroup', id, x, y, {
    label, ...note(comment),
    subgraph: {
      ...sub([
        n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured, one per step of every ray.']) }),
        ...shapes,
        n('sceneOutput', 'so', 1300, 200, { _groupOriginal: true, ...note(['Scene Output: the distance to the nearest surface, which is all the March Loop needs.']) }, { dist }),
      ]),
      inputPorts: port ? [{ key: port.key, type: 'float', label: port.label, toNodeId: port.to[0], toInputKey: port.to[1] }] : [],
    },
  });
  if (port) group.inputs = { ...group.inputs, [port.key]: { type: 'float', label: port.label, connection: { nodeId: port.from[0], outputKey: port.from[1] } } };
  return group;
}

/** The body every plain loop starts with: Group Inputs → March Pos → Group Output, nothing warped. */
function passBody(prefix: string): SubgraphData {
  return sub([
    n('marchLoopInputs', `${prefix}_in`, 0, 180, { _groupOriginal: true, ...note(['Group Inputs: the ray as the loop sees it at this step.']) }),
    n('marchLoopOutput', `${prefix}_out`, 440, 180, { _groupOriginal: true, ...note(['Group Output: the point handed to the scene. Nothing is warped here, so it is March Pos itself.']) }, { pos: [`${prefix}_in`, 'marchPos'] }),
  ]);
}

const loop = (params: Record<string, unknown>, comment: string[]): GraphNode =>
  n('marchLoopGroup', 'march', 340, 220, { ...params, ...note(comment), subgraph: passBody('march') }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] });

const BG: [number, number, number] = [0.02, 0.025, 0.05];

/** The shading block: a hash of the cell colours each object, a sun and sky light it, fog fades it into the background. */
function shade(cellOf: string, extra: Array<[string, string]>, fogRate: number, comment: string[]): GraphNode {
  return expr('shade', 640, 220, {
    label: 'Shade',
    inputs: [
      { name: 'pos', type: 'vec3' }, { name: 'nrm', type: 'vec3' }, { name: 'hit', type: 'float' },
      { name: 'dist', type: 'float' }, { name: 'iter', type: 'float' },
    ],
    lines: [
      ['vec3 cell', cellOf],
      ['float h', 'fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453)'],
      ['vec3 base', '0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)))'],
      ['float sun', 'max(dot(nrm, normalize(vec3(0.5, 0.8, 0.35))), 0.0)'],
      ['float sky', '0.5 + 0.5 * nrm.y'],
      ['float occ', '1.0 - 0.55 * iter'],
      ...extra,
      ['vec3 lit', 'base * (0.18 + 0.28 * sky + 0.9 * sun) * occ'],
      ['float fog', `exp(-dist * ${fogRate.toFixed(3)})`],
    ],
    result: `vec3(${BG.map(v => v.toFixed(3)).join(', ')}) + (lit - vec3(${BG.map(v => v.toFixed(3)).join(', ')})) * (fog * hit)`,
    outputType: 'vec3',
    wires: { pos: ['march', 'pos'], nrm: ['march', 'normal'], hit: ['march', 'hit'], dist: ['march', 'dist'], iter: ['march', 'iter'] },
    note: [
      'Shade (an Expression Block): the colour of each pixel from what the March Loop found.',
      'cell: which repeat of the pattern the hit point is in. h: a random number from 0 to 1 for that cell. base: a colour from h along a cosine palette, so each object has its own colour.',
      'sun: how much the surface faces the sun (1 = straight on). sky: the surface\'s upward-ness, a little ambient light from above.',
      'occ: 1 minus the share of steps used (Iter), darker in crevices and along edges, a cheap ambient occlusion.',
      'fog: fades with the true distance the ray travelled (Distance), into the background; Hit zero (a miss) shows only the background.',
      ...comment,
    ],
  });
}

const FLOOR = (cell: string): Array<[string, string]> => [
  ['float fl', 'step(0.9, nrm.y)'],
  ['vec2 gq', `abs(fract(pos.xz / ${cell}) - 0.5)`],
  ['float ln', 'smoothstep(0.455, 0.5, max(gq.x, gq.y))'],
  ['base', 'base * (1.0 - fl) + fl * (vec3(0.05, 0.07, 0.14) + vec3(0.2, 0.68, 0.86) * ln)'],
];

type Example = { key: string; nodes: GraphNode[]; controls: PlayControl[]; notes: string };
const E: Example[] = [];

const nodesFor = (cam: GraphNode, sc: GraphNode, lp: GraphNode, sh: GraphNode, extra: GraphNode[] = []): GraphNode[] => [
  n('time', 'time', 40, 460, { ...note(['Time in seconds: it turns the camera slowly so the bend is seen from every side.']) }),
  cam, sc, lp, sh,
  n('toneMap', 'tone', 900, 220, { mode: 'aces', ...note(['Tone Map: squeezes the lit colours into the displayable range with a film-like curve.']) }, { color: ['shade', 'result'] }),
  out(['tone', 'color'], 1140),
  ...extra,
];

// ── Spherical world ─────────────────────────────────────────────────────────

{
  const cam = n('marchCamera', 'cam', 40, 220, {
    camDist: 0.01, camAngle: 0.4, camElevation: 0.12, rotSpeed: 0.06, fov: 1.0, targetX: 0, targetY: 0, targetZ: 0,
    ...note([
      'March Camera: the camera sits 0.01 from its target, which is the origin, so it stays put and looks around as Angle and Elevation change.',
      'The origin is the empty middle between eight spheres of the lattice, so the camera is never inside one.',
      'Rot Speed 0.06 turns the view slowly. FOV 1.0 is a wide lens, so a lot of the world is in the picture.',
    ]),
  }, { time: ['time', 'time'] });
  const radius = n('constant', 'rad', 40, 760, { label: 'Sphere radius', value: 0.3, ...note(['The spheres\' radius, kept outside the Scene Group and wired in through a port so Play can move it (sliders inside a Scene Group are fixed when the shader is built).']) });
  const sc = scene('scene', 40, 480, 'Sphere lattice', [
    n('translate3D', 'mv', 240, 120, { tx: 0.6, ty: 0.6, tz: 0.6, ...note(['Translate 3D: moves the whole lattice by (0.6, 0.6, 0.6), half a cell, so the origin, where the camera is, is the empty middle between eight spheres.']) }, { pos: ['sp', 'pos'] }),
    n('repeat3D', 'rep', 480, 120, { cellX: 1.2, cellY: 1.2, cellZ: 1.2, ...note(['Repeat 3D: folds all of space into one 1.2 × 1.2 × 1.2 cell, so the single sphere below appears in every cell. Without any curvature this is an ordinary endless lattice.']) }, { pos: ['mv', 'pos'] }),
    n('sphereSDF3D', 'sph', 760, 120, { radius: 0.3, ...note(['Sphere: one ball at the centre of every cell. Its radius comes in from the Sphere radius Constant through the group\'s port.']) }, { pos: ['rep', 'pos'] }),
  ], ['sph', 'dist'], ['An endless lattice of spheres, 1.2 apart. All the strangeness in this example comes from how the rays travel, not from the scene: it is the same flat lattice at every curvature.'],
  { key: 'r', label: 'Sphere radius', from: ['rad', 'value'], to: ['sph', 'radius'] });
  const lp = loop({ maxSteps: 140, maxDist: 60, curvature: 0.04, bg: BG, albedo: [0.8, 0.85, 1.0] }, [
    'March Loop: walks every ray through the lattice. Space curvature 0.04 is a spherical space (the rays curve back toward each other); 0 gives the ordinary flat lattice.',
    'In a space of curvature k the ray at true distance t is at ro + dir · sin(√k · t) / √k. A full circuit is 2π/√k (about 31 here) and the point straight behind you, the antipode, is π/√k (about 16) away.',
    'Max Dist 60 is long enough to go once round the world; Max Steps 140 gives rays the room to thread the gaps between spheres.',
  ]);
  const sh = shade('floor(pos / 1.2)', [], 0.045, ['The cell here is the sphere\'s own cell of the lattice, so all of a sphere is one colour.']);
  E.push({
    key: 'curvedSpherical',
    nodes: nodesFor(cam, sc, lp, sh, [radius]),
    controls: [
      ctl('k', 'march::curvature', 'Space curvature', 0, 0.25, 0.002),
      ctl('r', 'rad::value', 'Sphere radius', 0.1, 0.55, 0.01),
      ctl('a', 'cam::camAngle', 'Look around', 0, 6.28, 0.02),
    ],
    notes: `**What it shows.** Someone standing in the middle of an endless lattice of spheres, but in a space that curves like the surface of a ball. At **Space curvature 0** it is the ordinary lattice: spheres getting smaller and smaller toward the horizon. Raise the curvature and the rays bend toward each other: the far spheres stop shrinking, then **grow again**, and the sphere right behind the far side of the world, the antipode, is the nearest one seen from the back: a huge ball on the horizon, with the whole world wrapped round to meet itself.

**How it is built.** A Scene Group repeats one sphere every 1.2 units (Repeat 3D), a March Camera sits in the middle of the lattice, and the March Loop's **Space curvature** bends how its rays travel (the maths is in docs/curved-space.md). Nothing about the lattice changes: only the rays. A Shade block gives each sphere its own colour, a sun and sky light, and fog by the distance the ray really travelled.

**Try.** Slide **Space curvature** from 0 up: watch the lattice fold. Small values (0.01) are a gentle bend; at 0.04 you can see round the world; at 0.25 the whole world is only about 12 across. **Sphere radius** makes the antipode ball bigger or smaller. **Look around** turns the camera. Set the loop's Space curvature below 0 to see the opposite bend (the next example). The shading is the same flat-space lighting at every curvature (a limit noted in the docs).`,
  });
}

// ── Hyperbolic tunnel ───────────────────────────────────────────────────────

{
  const cam = n('marchCamera', 'cam', 40, 220, {
    camDist: 0.01, camAngle: 3.14159, camElevation: 0.0, rotSpeed: 0, fov: 1.0, targetX: 0, targetY: 0, targetZ: 0,
    ...note([
      'March Camera: stands 0.01 from its target and looks straight down the hall (Angle 3.14 faces +z). Target Z is the Fly slider: moving it moves the camera along the hall.',
      'The target starts between four columns, so the camera is never inside one.',
    ]),
  }, { time: ['time', 'time'] });
  const sc = scene('scene', 40, 480, 'Hall of columns', [
    n('translate3D', 'mv', 240, 40, { tx: 1.2, ty: 0, tz: 1.2, ...note(['Translate 3D: shifts the grid by half a cell in x and z, so the camera at the origin is in a gap between four columns.']) }, { pos: ['sp', 'pos'] }),
    n('repeat3D', 'rep', 480, 40, { cellX: 2.4, cellY: 50, cellZ: 2.4, ...note(['Repeat 3D: columns every 2.4 in x and z. The huge Cell Y means no repeat upward: each column is one tall piece.']) }, { pos: ['mv', 'pos'] }),
    n('cylinderSDF3D', 'col', 760, 40, { radius: 0.3, height: 3.0, ...note(['Cylinder: a column 0.3 wide that reaches 3 up and 3 down. Repeated, they make a grove of columns going on forever.']) }, { pos: ['rep', 'pos'] }),
    n('planeSDF3D', 'floor', 760, 320, { height: -1.0, ...note(['Plane 3D: the floor, 1 below the camera.']) }, { p: ['sp', 'pos'] }),
    n('sdfUnion', 'un', 1040, 200, { k: 0, ...note(['Union: the nearest of the columns and the floor.']) }, { a: ['col', 'dist'], b: ['floor', 'dist'] }),
  ], ['un', 'dist'], ['A hall of columns on a floor, the same flat grid at every curvature.']);
  const lp = loop({ maxSteps: 160, maxDist: 40, curvature: -0.6, bg: BG, albedo: [0.8, 0.85, 1.0] }, [
    'March Loop: Space curvature −0.6 is a hyperbolic space, where rays spread apart faster and faster: at true distance t a ray is at ro + dir · sinh(√0.6 · t) / √0.6.',
    'So the grove shrinks toward the middle of the picture much faster than perspective alone: a fisheye tunnel. Max Dist 40 is enough because the scene ends (is too far) well before that.',
  ]);
  const sh = shade('vec3(floor(pos.x / 2.4), 0.0, floor(pos.z / 2.4))', FLOOR('2.4'), 0.12, ['Each column is one colour (cell is its position on the floor grid). The floor (fl: surfaces facing straight up) is dark with cyan grid lines (ln) at the cell edges, so you can read the bend in it.']);
  E.push({
    key: 'curvedHyperbolic',
    nodes: nodesFor(cam, sc, lp, sh),
    controls: [
      ctl('k', 'march::curvature', 'Space curvature', -1, 0, 0.01),
      ctl('f', 'cam::targetZ', 'Fly along the hall', 0, 12, 0.02),
      ctl('a', 'cam::camAngle', 'Look around', 0, 6.28, 0.02),
    ],
    notes: `**What it shows.** A grove of columns seen in a hyperbolic space, the space of negative curvature. Rays do not just fan out the way they do in flat space: they spread faster and faster, so the columns shrink toward a vanishing point far quicker than perspective explains and the grove looks like a tunnel, a bright round window onto a distance packed into the middle of the picture. At **Space curvature 0** it is the ordinary grove.

**How it is built.** Repeat 3D tiles one cylinder every 2.4 units, a Plane 3D makes the floor, a Union joins them; March Camera looks down the hall; the March Loop's **Space curvature** is set below 0. A Shade block colours each column and fades the distance.

**Try.** Drag **Space curvature** from 0 toward −1: the more negative, the tighter the tunnel. **Fly along the hall** moves the camera down the columns: each step reveals the grove sliding past. **Look around** turns the camera.`,
  });
}

// ── Reverse perspective room ────────────────────────────────────────────────

{
  const cam = n('marchCamera', 'cam', 40, 220, {
    camDist: 8.0, camAngle: 0.0, camElevation: 0.4, rotSpeed: 0, fov: 1.5, targetX: 0, targetY: -0.4, targetZ: 0,
    projection: 'reverse', reverseStrength: 0.7, reverseDist: 20,
    ...note([
      'March Camera with Perspective set to Reverse: the rays begin spread across the picture and aim at a point Converge at (20) in front of the camera. At strength 1 they meet exactly there; below 1 they meet farther out.',
      'The look-at target (the middle box) keeps the size it would have in an ordinary camera, so Reverse strength changes only how the other depths scale around it.',
      'Set Perspective to Normal (or Reverse strength to 0 for parallel rays) to compare.',
    ]),
  }, { time: ['time', 'time'] });
  const sc = scene('scene', 40, 480, 'Boxes on a floor', [
    n('repeat3D', 'rep', 240, 40, { cellX: 3.2, cellY: 50, cellZ: 2.0, ...note(['Repeat 3D: a box every 3.2 across and every 2.0 deep. The huge Cell Y means no repeat upward.']) }, { pos: ['sp', 'pos'] }),
    n('translate3D', 'up', 480, 40, { ty: -0.05, ...note(['Translate 3D: lifts the boxes so they stand on the floor.']) }, { pos: ['rep', 'pos'] }),
    n('roundedBoxSDF3D', 'box', 720, 40, { sizeX: 0.5, sizeY: 0.35, sizeZ: 0.5, radius: 0.06, ...note(['Rounded Box: every box is exactly the same size. In an ordinary camera the far ones would be smaller.']) }, { pos: ['up', 'pos'] }),
    n('planeSDF3D', 'floor', 720, 320, { height: -0.4, ...note(['Plane 3D: the floor the boxes stand on.']) }, { p: ['sp', 'pos'] }),
    n('sdfUnion', 'un', 1000, 200, { k: 0, ...note(['Union: the nearest of the boxes and the floor.']) }, { a: ['box', 'dist'], b: ['floor', 'dist'] }),
  ], ['un', 'dist'], ['Rows of identical boxes receding from the camera: a normal camera shrinks the far ones, this scene never changes size.']);
  const lp = loop({ maxSteps: 120, maxDist: 60, bg: BG, albedo: [0.8, 0.85, 1.0] }, [
    'March Loop: an ordinary loop (no Space curvature). The reverse lens is entirely in the camera\'s rays.',
  ]);
  const sh = shade('floor(vec3(pos.x / 3.2, 0.0, pos.z / 2.0) + 0.5)', FLOOR('2.0'), 0.02, ['Each box is one colour. The floor (fl: surfaces facing straight up) is dark with cyan grid lines (ln) at the cell edges, so you can see the depth scale.']);
  E.push({
    key: 'curvedReverse',
    nodes: nodesFor(cam, sc, lp, sh),
    controls: [
      ctl('s', 'cam::reverseStrength', 'Reverse strength', 0, 1, 0.01),
      ctl('d', 'cam::reverseDist', 'Converge at', 4, 40, 0.1),
      ctl('e', 'cam::camElevation', 'Camera height', 0, 1.2, 0.01),
    ],
    notes: `**What it shows.** Reverse perspective, the way a Byzantine icon or a Cubist painting draws a table: parts that are farther away are drawn **bigger**. Every box is the same size; the rows going back from the camera grow as they recede, the opposite of an ordinary camera.

**How it is built.** The scene is ordinary: Repeat 3D makes rows of one Rounded Box and a Plane 3D is the floor. The change is entirely in **March Camera**, with **Perspective** set to **Reverse**: instead of every ray starting at one point and fanning out, each ray starts at its own point on the picture and aims at a point **Converge at** in front. A ray's sideways offset at depth z is O · (1 − strength · z / Converge at): smaller the farther it goes, so an object of fixed size takes up more and more of the picture. (docs/curved-space.md has the maths.)

**Try.** **Reverse strength** at 0 is a camera with parallel rays (orthographic): the boxes keep one size; raise it and the far ones grow. **Converge at** moves the point the rays meet: closer is a stronger effect, and past that point the picture flips, as a real lens does behind its focus. **Camera height** looks more from above. On the camera's card, set Perspective to Normal to see the ordinary lens.`,
  });
}

/** The Curved space folder's graphs. */
export function buildCurvedSpaceExamples(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};
  for (const e of E) graphs[e.key] = { ...CURVED_EXAMPLE_INDEX[e.key], counter: 60, nodes: e.nodes, play: play(e.controls, e.notes) };
  return graphs;
}
