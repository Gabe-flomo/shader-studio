/**
 * fourDExamples.ts — the 4D folder (docs/4d.md): a first taste of a fourth dimension by slicing.
 *
 * Both are ordinary ray-marched 3D scenes. Inside the Scene Group the point being measured is
 * lifted to 4D (w = the slice), turned in a plane that includes w, and measured against a 4D
 * shape; the distance goes to Scene Output like any other. Nothing outside the group knows.
 *
 * Every node carries a comment saying what it is and why it is there.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, play } from './graphBuilder';

export const FOURD_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  fourDTesseractSlice: {
    label: '4D: Tesseract slice',
    description: 'A tesseract (a 4D cube) turning in 4D. You see one 3D slice of it, which morphs from a cube to a stretched, many-faced solid and back. Play moves the slice (w) and the turn.',
    play: true,
  },
  fourDHypersphereInTesseract: {
    label: '4D: Hypersphere in a tesseract',
    description: 'A hypersphere inside a hollow tesseract, in an open tray. The slice sweeps slowly along w, so the orange ball swells and shrinks inside a blue box that morphs as it turns.',
    play: true,
  },
};

export const FOURD_EXAMPLE_KEYS = Object.keys(FOURD_EXAMPLE_INDEX);

type Wire = [fromId: string, outputKey: string];
const note = (text: string) => ({ __comment: text });
const sub = (nodes: GraphNode[]): SubgraphData => ({ nodes, inputPorts: [], outputPorts: [] });

/** A Scene Group: Scene Pos → `shapes` → Scene Output; `ports` carry floats in from outside (so a Play slider can reach them). */
function scene(id: string, x: number, y: number, label: string, shapes: GraphNode[], dist: Wire, comment: string,
  ports: Array<{ key: string; label: string; from: Wire; to: [nodeId: string, inputKey: string] }> = []): GraphNode {
  const g = n('sceneGroup', id, x, y, {
    label, ...note(comment),
    subgraph: {
      ...sub([
        n('scenePos', 'sp', 0, 200, { _groupOriginal: true }),
        ...shapes,
        n('sceneOutput', 'so', 1700, 200, { _groupOriginal: true }, { dist }),
      ]),
      inputPorts: ports.map(p => ({ key: p.key, type: 'float' as const, label: p.label, toNodeId: p.to[0], toInputKey: p.to[1] })),
    },
  });
  const inputs = { ...g.inputs };
  for (const p of ports) inputs[p.key] = { type: 'float', label: p.label, connection: { nodeId: p.from[0], outputKey: p.from[1] } };
  return { ...g, inputs };
}

/** An Expression Block with float inputs and a vec3 result. */
function expr(id: string, x: number, y: number, label: string, wires: Record<string, Wire>, result: string, comment: string): GraphNode {
  const base = n('exprNode', id, x, y, {
    inputs: Object.keys(wires).map(name => ({ name, type: 'float', slider: null })),
    outputType: 'vec3', lines: [], result, expr: 'a', label, ...note(comment),
  });
  const inputs: GraphNode['inputs'] = {};
  for (const [k, [from, key]] of Object.entries(wires)) inputs[k] = { type: 'float', label: k, connection: { nodeId: from, outputKey: key } };
  return { ...base, inputs, outputs: { result: { type: 'vec3', label: 'Result' } } };
}

/** The March Loop body that changes nothing: Group Inputs → March Pos → Group Output. */
const passBody = (id: string): SubgraphData => sub([
  n('marchLoopInputs', `${id}_in`, 0, 180, { _groupOriginal: true }),
  n('marchLoopOutput', `${id}_out`, 440, 180, { _groupOriginal: true }, { pos: [`${id}_in`, 'marchPos'] }),
]);

const SUN = { sunDirX: 0.55, sunDirY: 0.85, sunDirZ: 0.45 };

/**
 * Loop, Multi-Light, background, vignette and tone map: the same finishing for both.
 * `colour` is the Expression Block that picks a surface colour from the hit point.
 */
function finish(bg: [number, number, number], colour: GraphNode, loopNote: string, outX = 1700): GraphNode[] {
  return [
    n('marchLoopGroup', 'march', 340, 220, { bg, maxSteps: 128, maxDist: 20, ...note(loopNote) }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('splitVec3', 'hp', 640, 420, { ...note('Split Vec3: the hit point as x, y, z, so the surface colour can depend on where the ray landed.') }, { v: ['march', 'pos'] }),
    colour,
    n('multiLight', 'lit', 1180, 220, {
      ...SUN, sunR: 1.25, sunG: 1.05, sunB: 0.85, skyR: 0.22, skyG: 0.3, skyB: 0.5, bounceR: 0.09, bounceG: 0.06, bounceB: 0.05,
      ...note('Multi-Light: warm sun from one side, a cool sky fill from above and a little bounce light, over the surface colour, in linear light. (No shadows: the shadow and occlusion nodes cannot yet read a Scene Group that takes values in through ports.)'),
    }, { baseColor: ['col', 'result'], normal: ['march', 'normal'], hit: ['march', 'hit'] }),
    n('colorPicker', 'sky', 1180, 520, { color: bg, ...note('Background colour: what a ray that hits nothing shows.') }),
    n('select', 'pick', 1420, 220, { outputType: 'vec3', ...note('Hit is 1 where the ray touched the shape: show the lit surface there, the background elsewhere.') },
      { mask: ['march', 'hit'], ifTrue: ['lit', 'color'], ifFalse: ['sky', 'rgb'] }),
    n('vignette', 'vig', 1660, 220, { radius: 0.75, softness: 0.6, strength: 0.7, ...note('A soft dark edge to the frame, to hold the eye on the middle.') }, { color: ['pick', 'result'] }),
    n('toneMap', 'tone', 1900, 220, { mode: 'aces', ...note('Tone Map: the lights go above 1; ACES rolls them off so the bright side keeps its colour instead of clipping.') }, { color: ['vig', 'result'] }),
    n('output', 'out', outX + 440, 220, { ...note('Output: the picture.') }, { color: ['tone', 'color'] }),
  ].map(nd => (nd.type === 'marchLoopGroup' ? { ...nd, params: { ...nd.params, subgraph: passBody('march') } } : nd));
}

export function buildFourDExamples(): Record<string, ExampleGraph> {
  // ── 1. Tesseract slice ────────────────────────────────────────────────────
  const slice: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDTesseractSlice,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit. (The 4D turn takes its own time from the Spin on Rotate 4D.)') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 3.6, camAngle: 0.7, camElevation: 0.4, rotSpeed: 0.12, fov: 1.5, ...note('March Camera: slowly circles the middle. The camera is the only thing that moves in 3D; the shape changes because its 4D turn changes.') }, { time: ['time', 'time'] }),
      n('constant', 'wk', 40, 1000, { label: 'Slice (w)', value: 0, ...note('The slice position W. It lives outside the Scene Group and comes in through a port, so Play can move it (sliders inside a Scene Group are fixed when the shader is built). Wired into Lift to 4D.') }),
      n('constant', 'angk', 40, 1160, { label: 'Turn (deg)', value: 0, ...note('Where the xw turn starts, in degrees, added to the steady Spin. Comes into Rotate 4D through a port so Play can move it.') }),
      scene('scene', 40, 700, 'Tesseract slice', [
        n('lift4D', 'lift', 240, 80, { w: 0, ...note('Lift to 4D: gives the point being measured a fourth coordinate, W. This is the slice: W = 0 cuts through the middle of the tesseract, other values cut nearer one of its 3D "walls". W is a Play slider.') }, { pos: ['sp', 'pos'] }),
        n('rotate4D', 'rot', 520, 80, { plane: 'xw', angle: 0, spin: 28, ...note('Rotate 4D in the xw plane: x is turned toward w. Nothing in 3D spins; the tesseract tilts into the fourth direction, so the slice cuts through different parts of it. Spin 28 degrees a second keeps it going; the Turn Constant outside adds a starting angle (a Play slider). Try the planes xy / xz / yz for ordinary 3D spins.') }, { p4: ['lift', 'p4'] }),
        n('rotate4D', 'rot2', 660, 80, { plane: 'yw', angle: 0, spin: 19, ...note('A second Rotate 4D, in the yw plane, at a different speed (19 degrees a second). Turning in xw alone only stretches the slice along x; with y turning toward w as well the two stretches take turns and combine, and the slice becomes a slowly changing solid with more faces than a cube. Turns in 4D compose, and the order matters.') }, { p4: ['rot', 'p4'] }),
        n('tesseractSDF', 'tess', 800, 80, { size: 0.62, rounding: 0.06, ...note('Tesseract SDF: the box formula with four coordinates. Half size 0.62 in every direction, edges rounded by 0.06. At W = 0 and no turn its slice is just a cube of that size.') }, { p4: ['rot2', 'p4'] }),
        n('planeSDF3D', 'floor', 800, 360, { height: -0.8, ...note('A floor at y = -0.8, so there is a sense of space. It is plain 3D: it never meets the 4D part.') }, { p: ['sp', 'pos'] }),
        n('sdfUnion', 'un', 1100, 200, { k: 0, ...note('Union: the scene is the nearer of the slice and the floor.') }, { a: ['tess', 'dist'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'The whole 4D idea lives in this group: the point from Scene Pos is lifted to 4D, turned in the xw plane, and measured against a tesseract. A distance comes out and goes to Scene Output, so the camera, the march loop and the lighting outside are the same as for any 3D scene.',
      [{ key: 'w', label: 'W (slice)', from: ['wk', 'value'], to: ['lift', 'w'] }, { key: 'angle', label: 'Turn (deg)', from: ['angk', 'value'], to: ['rot', 'angle'] }]),
      ...finish([0.05, 0.055, 0.1],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'y < -0.79 ? vec3(0.16, 0.18, 0.28) + vec3(0.1, 0.11, 0.14) * mod(floor(x * 2.0) + floor(z * 2.0), 2.0) : vec3(0.95, 0.32, 0.3) + vec3(0.05, 0.46, 0.05) * clamp(0.5 + 0.45 * (x + y + z), 0.0, 1.0)',
          'Surface colour from where the ray landed: a dark blue checker on the floor (y below -0.79), and on the tesseract a slide from coral to gold along the diagonal so the turning faces read.'),
        'March Loop: finds, for each pixel, where the ray meets the scene and the surface direction there. Its Hit, Normal and Hit Pos feed the lighting.'),
    ],
    play: play([
      ctl('w', 'wk::value', 'Slice (w)', -0.8, 0.8, 0.01),
      ctl('a', 'angk::value', 'Turn (deg)', -180, 180, 0.5),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A tesseract is a cube with a fourth direction, w: eight cubes folded around a point you cannot see all at once. The screen can only show 3D, so this is one slice of it, the part sitting at a chosen w. When the tesseract is turned in the **xw** plane, 3D does not see it spin: the slice just changes shape. It stretches along x, and as a second turn (yw) joins in, it shears into a many-faced solid and comes back to a cube.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** (adds w) → **Rotate 4D** (xw, with Spin) → a second **Rotate 4D** (yw) → **Tesseract SDF** → Union with a floor → Scene Output. Outside, an ordinary March Camera, March Loop and Multi-Light. Only the Scene Group knows about the fourth dimension.

**Try.** Move **Slice (w)**: the slice moves through the shape, getting smaller towards w = 0.62 (the edge of the tesseract) and gone beyond. Move **Turn** to jump to any moment of the morph (the steady Spin keeps adding to it; set Spin on Rotate 4D to 0 to stop at the one you chose); at 90 degrees the slice is the same cube again. Open the group and change the Rotate 4D plane to **zw** or **yw**, or wire a second Rotate 4D with another plane after the first.`),
  };

  // ── 2. Hypersphere in a tesseract ─────────────────────────────────────────
  const inside: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDHypersphereInTesseract,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit and the slice sweep.') }),
      n('lfo', 'sweep', 40, 640, { waveform: 'sine', freq: 0.08, amplitude: 0.5, offset: 0, ...note('LFO (sine): the slice position W, sweeping slowly between -0.5 and 0.5 about once every 12 seconds. Its Amplitude is the Play slider Sweep; set it to 0 to hold W at 0.') }, { time: ['time', 'time'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 3.5, camAngle: 0.5, camElevation: 0.75, rotSpeed: 0.1, fov: 1.5, ...note('March Camera: looks down into the tray from above and circles slowly.') }, { time: ['time', 'time'] }),
      n('constant', 'angk', 40, 1020, { label: 'Turn (deg)', value: 0, ...note('Where the xw turn starts, in degrees, added to the slow Spin. Comes into Rotate 4D through a port so Play can move it.') }),
      scene('scene', 40, 860, 'Hypersphere in a tesseract', [
        n('lift4D', 'lift', 240, 80, { ...note('Lift to 4D: W (the slice) arrives from the LFO outside the group through the W port, so one number moves the slice for the geometry and for the colouring.') }, { pos: ['sp', 'pos'] }),
        n('rotate4D', 'rot', 520, 80, { plane: 'xw', angle: 0, spin: 14, ...note('Rotate 4D in the xw plane, slowly. The sphere is round in every direction so it does not change; the box around it does. Spin 14 degrees a second, plus the Turn Constant outside.') }, { p4: ['lift', 'p4'] }),
        n('hypersphereSDF', 'ball', 800, 20, { radius: 0.6, ...note('Hypersphere SDF: length(p4) - radius. A 4D ball of radius 0.6: its slice at W is a 3D ball of radius sqrt(0.6² - W²). At W = 0 it is a full 0.6 ball; at W = ±0.6 it shrinks to a point and is gone.') }, { p4: ['rot', 'p4'] }),
        n('tesseractSDF', 'outer', 800, 220, { size: 0.9, rounding: 0.05, ...note('Tesseract SDF (outer): the outside of the box, half size 0.9.') }, { p4: ['rot', 'p4'] }),
        n('tesseractSDF', 'inner', 800, 420, { size: 0.8, rounding: 0.04, ...note('Tesseract SDF (inner): a slightly smaller box, half size 0.8. Cutting it out of the outer one leaves a hollow shell 0.1 thick.') }, { p4: ['rot', 'p4'] }),
        n('sdfSubtract', 'shell', 1080, 320, { k: 0, ...note('Subtract: outer box minus inner box = a hollow tesseract shell. Both are the same rotated 4D point, so the shell turns as one piece.') }, { a: ['outer', 'dist'], b: ['inner', 'dist'] }),
        n('planeSDF3D', 'lid', 1080, 560, { height: 0.35, ...note('A plane at y = 0.35. Used below to slice the top off the shell, so you can see inside.') }, { p: ['sp', 'pos'] }),
        n('sdfIntersect', 'tray', 1360, 420, { k: 0, ...note('Intersect with the plane: keeps only what is below y = 0.35. The shell becomes an open tray with the ball inside.') }, { a: ['shell', 'dist'], b: ['lid', 'dist'] }),
        n('sdfUnion', 'un', 1560, 200, { k: 0, ...note('Union: the scene is the tray or the ball, whichever is nearer.') }, { a: ['tray', 'dist'], b: ['ball', 'dist'] }),
      ], ['un', 'dist'],
      'A hypersphere inside a hollow tesseract, both measured at the same turned 4D point. W comes in through a port from the LFO outside.',
      [{ key: 'w', label: 'W (slice)', from: ['sweep', 'value'], to: ['lift', 'w'] }, { key: 'angle', label: 'Turn (deg)', from: ['angk', 'value'], to: ['rot', 'angle'] }]),
      ...finish([0.06, 0.05, 0.09],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'], w: ['sweep', 'value'] },
          'length(vec3(x, y, z)) < sqrt(max(0.36 - w * w, 0.0)) + 0.04 ? vec3(1.0, 0.4, 0.16) + vec3(0.0, 0.35, 0.14) * clamp(0.5 + 0.7 * y, 0.0, 1.0) : vec3(0.3, 0.52, 0.72) + vec3(0.25, 0.26, 0.18) * clamp(0.5 + 0.4 * y, 0.0, 1.0)',
          'Which surface did the ray land on? The ball\'s slice has radius sqrt(0.36 - W²), and the shell is always further from the middle than that (the inner box holds a 4D ball of radius 0.8). So a hit point closer than the ball\'s radius plus a little is the ball: orange. Anything else is the shell: blue.'),
        'March Loop: finds where each ray meets the scene and the surface direction there.', 1700),
    ],
    play: play([
      ctl('sweep', 'sweep::amplitude', 'Sweep (w range)', 0, 0.6, 0.01),
      ctl('a', 'angk::value', 'Turn (deg)', -180, 180, 0.5),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A hypersphere (a ball with four directions) inside a hollow tesseract, seen through a slice. The ball's slice is always a ball, but its size depends on **w**: biggest at w = 0, shrinking to a point as w reaches its radius, so as the slice sweeps the orange ball swells and shrinks. Meanwhile the box around it, turning in the xw plane, morphs from a cube to a corner-cut shape and back. The top is cut off so you can see in.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** (w comes from an LFO outside, through a port) → **Rotate 4D** (xw) → a **Hypersphere SDF**, and two **Tesseract SDF**s subtracted to make a shell; a plane trims the shell open; Union joins the two. An Expression Block outside tells ball from shell by distance from the middle, using the same w.

**Try.** Raise **Sweep** to 0.6 to take the slice all the way to the ball's edge, where it vanishes. Set it to 0 and the slice stays through the middle. **Turn** changes the box only: the sphere looks the same however you turn it in 4D. Try moving the ball off centre with a Translate 4D (give it a w offset and it comes and goes at a different time).`),
  };

  return { fourDTesseractSlice: slice, fourDHypersphereInTesseract: inside };
}
