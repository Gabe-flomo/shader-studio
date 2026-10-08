/**
 * fourDProjectionExamples.ts — 4D phase 3 examples (docs/4d.md): projection instead of slicing.
 *
 *   Rotating tesseract (projection)   the 4D Wireframe node, perspective: cube inside a cube
 *   24-cell wireframe                 the same node, orthographic, a double rotation
 *   Duocylinder shadow                a slice and the solid shadow of the same turning shape, side by side
 *   Hopf rings                        Stereographic 4D + Hopf Circles + a Clifford torus
 *
 * Same shape as the other 4D examples: one Scene Group does the 4D work and gives a distance; the
 * camera, march loop and lighting outside are ordinary 3D. The wireframes glow from the march loop's
 * Iter output (steps taken as 0-1: high for rays that graze the tubes), added on top of the lit surface.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, play } from './graphBuilder';
import { FOURD_EXAMPLE_INDEX, SUN, checker, expr, finish, note, passBody, scene } from './fourDExamples';

/** An Add node set to vec3 (the card's type picker retypes its sockets). */
function vec3Add(id: string, x: number, y: number, comment: string, a: [string, string], b: [string, string]): GraphNode {
  const g = n('add', id, x, y, { outputType: 'vec3', ...note(comment) }, { a, b });
  g.inputs.a = { ...g.inputs.a, type: 'vec3' };
  g.inputs.b = { ...g.inputs.b, type: 'vec3' };
  g.outputs.result = { ...g.outputs.result, type: 'vec3' };
  return g;
}

/**
 * Like `finish`, for the wireframes: no soft shadow (thin tubes cast hair-thin shadows and the shadow ray is expensive),
 * ambient occlusion and Multi-Light on the tubes, and a glow from the march loop's Iter output added on top.
 */
function finishGlow(bg: [number, number, number], colour: GraphNode, glow: GraphNode, loopNote: string): GraphNode[] {
  return [
    n('marchLoopGroup', 'march', 340, 220, { bg, maxSteps: 128, maxDist: 20, ...note(loopNote) }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('splitVec3', 'hp', 640, 420, { ...note('Split Vec3: the hit point as x, y, z, so the colour can depend on where the ray landed.') }, { v: ['march', 'pos'] }),
    colour,
    glow,
    n('makeVec3', 'sun', 900, 40, { r: SUN.x, g: SUN.y, b: SUN.z, ...note('Make Vec3: the direction the sun shines from. It goes to Multi-Light to light the tubes.') }),
    n('sdfAo', 'ao', 900, 380, { stepDist: 0.06, ...note('SDF Ambient Occlusion: darkens the tubes where another edge or a corner is close by, which gives the wireframe depth. It measures the same Scene Group.') },
      { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'] }),
    n('multiLight', 'lit', 1180, 220, {
      sunR: 1.1, sunG: 1.0, sunB: 0.9, skyR: 0.3, skyG: 0.38, skyB: 0.6, bounceR: 0.1, bounceG: 0.08, bounceB: 0.1,
      ...note('Multi-Light: a warm sun from one side and a cool sky fill from above over the tube colour, darkened by occlusion.'),
    }, { baseColor: ['col', 'result'], normal: ['march', 'normal'], hit: ['march', 'hit'], ao: ['ao', 'ao'], sunDir: ['sun', 'rgb'] }),
    n('colorPicker', 'sky', 1180, 520, { color: bg, ...note('Background colour: what a ray that hits nothing shows.') }),
    n('select', 'pick', 1420, 220, { outputType: 'vec3', ...note('Hit is 1 where the ray touched a tube: show the lit tube there, the background elsewhere.') },
      { mask: ['march', 'hit'], ifTrue: ['lit', 'color'], ifFalse: ['sky', 'rgb'] }),
    vec3Add('glowed', 1660, 220, 'Add: the glow on top of whatever is there, tube or background. A ray that missed but passed close to an edge took many steps, so it gets a halo.',
      ['pick', 'result'], ['glow', 'result']),
    n('vignette', 'vig', 1900, 220, { radius: 0.75, softness: 0.6, strength: 0.75, ...note('A soft dark edge to the frame, to hold the eye on the middle.') }, { color: ['glowed', 'result'] }),
    n('toneMap', 'tone', 2140, 220, { mode: 'aces', ...note('Tone Map: the glow goes above 1; ACES rolls it off so the brightest lines keep their colour instead of clipping.') }, { color: ['vig', 'result'] }),
    n('output', 'out', 2380, 220, { ...note('Output: the picture.') }, { color: ['tone', 'color'] }),
  ].map(nd => (nd.type === 'marchLoopGroup' ? { ...nd, params: { ...nd.params, subgraph: passBody('march') } } : nd));
}

/** The glow: an Expression Block from the march loop's Iter output. */
const glowBlock = (rgb: [number, number, number], gain: number, text: string) =>
  expr('glow', 1180, 700, 'Glow', { it: ['march', 'iter'] }, `vec3(${rgb.join(', ')}) * pow(clamp(it * 2.2, 0.0, 1.0), 3.0) * ${gain.toFixed(2)}`, text);

export function buildFourDProjectionExamples(): Record<string, ExampleGraph> {
  // ── 1. Rotating tesseract (projection) ───────────────────────────────────
  const tesseract: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDTesseractProjection,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit (the 4D turns have their own Spin settings).') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 5.2, camAngle: 0.6, camElevation: 0.3, rotSpeed: 0.05, fov: 1.5, ...note('March Camera: slowly circles the middle. The 3D camera only looks; the shape changes because it turns in 4D.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Tesseract (projection)', [
        n('wireframe4D', 'wire', 240, 80, {
          polytope: 'tesseract', projection: 'perspective', radius: 1.5, camDist: 3.2, edge: 0.028, vertex: 0.065,
          plane1: 'xw', spin1: 22, plane2: 'yz', spin2: 14,
          ...note('4D Wireframe, Tesseract, Perspective. Sixteen corners (±1, ±1, ±1, ±1 scaled to radius 1.5) and thirty-two edges. Each corner is turned in 4D, then seen by a camera on the w axis 3.2 away: a corner at w moves to xyz × 3.2 / (3.2 − w), so the corners with positive w are closer and bigger (the outer cube) and those with negative w are farther and smaller (the inner cube). The edges between them are the eight struts. Turn 1 is the xw plane, which swaps the two cubes through each other; Turn 2 is yz, an ordinary roll. Spin is in degrees a second.'),
        }, { pos: ['sp', 'pos'] }),
      ], ['wire', 'dist'],
      'One 3D shape, built from a 4D object: the wireframe is a distance to thin tubes along the projected edges and balls at the projected corners, so it behaves like any other 3D shape here (lighting, occlusion, glow).'),
      ...finishGlow([0.02, 0.025, 0.06],
        expr('col', 1180, 520, 'Tube colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'mix(vec3(0.25, 0.85, 1.0), vec3(1.0, 0.35, 0.65), clamp(length(vec3(x, y, z)) / 1.25 - 0.45, 0.0, 1.0))',
          'Tube colour from the distance to the middle: the inner (far) cube and the struts near it are cyan, the outer (near) cube magenta, so the cube-in-a-cube reads at a glance.'),
        glowBlock([0.2, 0.55, 1.0], 1.8, 'Glow: Iter (steps taken, 0 to 1) times 2.2, cubed, times a blue-white colour. Rays that graze a tube take many steps, so every edge gets a soft halo; rays through empty space take few and stay dark.'),
        'March Loop: finds, for each pixel, where the ray meets the wireframe, and how many steps it took (Iter, used for the glow).'),
    ],
    play: play([
      ctl('s1', 'scene::wire::spin1', 'xw turn (deg/s)', -90, 90, 0.5),
      ctl('s2', 'scene::wire::spin2', 'yz turn (deg/s)', -90, 90, 0.5),
      ctl('d', 'scene::wire::camDist', 'Camera distance', 1.8, 8, 0.01),
      ctl('e', 'scene::wire::edge', 'Edge radius', 0.008, 0.08, 0.001),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** The tesseract, a cube in four directions, drawn the way a cube is drawn on paper: not one slice but all of it at once, squashed into 3D. A perspective camera sits on the fourth axis looking toward the middle, so the cube nearer to it (positive w) looks big and the cube farther away (negative w) looks small: the famous **cube inside a cube**, with eight struts joining their corners. The shape turns in 4D, and the inner cube swells outward through the faces of the outer one while the outer shrinks, which is what a 4D turn looks like when you only see its shadow.

**How it is built.** One Scene Group holds a **4D Wireframe** node (Tesseract, Perspective) reading Scene Pos and giving a distance: thin tubes along the 32 projected edges and balls at the 16 corners. Turn 1 is in the xw plane, Turn 2 in yz. Outside, a normal March Camera and March Loop find the surface, Multi-Light and Ambient Occlusion shade it, and the glow is the loop's Iter output added on top.

**Try.** Set both turns to 0 and the cubes just sit there: a picture of the shape facing you. Slide **Camera distance** down toward 1.8 for a dramatic perspective (the near cube nearly fills the view) and up toward 8 for the flat, orthographic look where both cubes become the same size. Change Projection to Orthographic inside the group to see what dropping w does: the cube-in-a-cube becomes a single cube with a smaller one inside it in a different arrangement. Try Turn 1 in the zw plane, or pick another Polytope.`),
  };

  // ── 2. 24-cell wireframe ─────────────────────────────────────────────────
  const cell24: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourD24CellWireframe,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit.') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 4.8, camAngle: 0.9, camElevation: 0.35, rotSpeed: 0.04, fov: 1.5, ...note('March Camera: a slow orbit.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, '24-cell (projection)', [
        n('wireframe4D', 'wire', 240, 80, {
          polytope: 'cell24', projection: 'orthographic', radius: 1.35, edge: 0.02, vertex: 0.045,
          plane1: 'xw', spin1: 9, plane2: 'yz', spin2: 6,
          ...note('4D Wireframe, 24-cell, Orthographic. Twenty-four corners and ninety-six edges, every edge the same length, eight at every corner. Orthographic means the corner (x, y, z, w) is drawn at (x, y, z): w is simply dropped. Turn 1 (xw) and Turn 2 (yz) are in planes that share no direction, a true double rotation: one swaps x with w (the shape changes form), the other rolls it in 3D. Slow spins make the two incommensurable, so it never repeats exactly.'),
        }, { pos: ['sp', 'pos'] }),
      ], ['wire', 'dist'],
      'The 24-cell has no 3D relative. Dropping w gives a lattice of 96 tubes whose arrangement keeps shifting as the xw turn mixes in the hidden direction.'),
      ...finishGlow([0.03, 0.02, 0.05],
        expr('col', 1180, 520, 'Tube colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'mix(vec3(1.0, 0.7, 0.2), vec3(0.55, 0.35, 1.0), clamp(0.5 + 0.55 * (x + y - z) / 1.3, 0.0, 1.0))',
          'Tube colour: gold to violet along a diagonal, so the lattice reads in depth.'),
        glowBlock([1.0, 0.55, 0.25], 1.5, 'Glow: Iter (steps taken, 0 to 1) times 2.2, cubed, in a warm orange. A dense lattice makes many rays graze several tubes, so the middle glows more than the edges.'),
        'March Loop: finds where each ray meets the lattice and how many steps it took (Iter, used for the glow).'),
    ],
    play: play([
      ctl('s1', 'scene::wire::spin1', 'xw turn (deg/s)', -60, 60, 0.5),
      ctl('s2', 'scene::wire::spin2', 'yz turn (deg/s)', -60, 60, 0.5),
      ctl('r', 'scene::wire::radius', 'Size', 0.6, 1.8, 0.01),
      ctl('e', 'scene::wire::edge', 'Edge radius', 0.006, 0.06, 0.001),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** The 24-cell, a four-dimensional shape with no counterpart in 3D: 24 corners, 96 edges, 24 octahedral cells meeting. Here you see all of it at once, projected straight down the fourth axis (**orthographic**: w is thrown away). It makes a **double rotation**, turning in two planes that share no direction (xw and yz), so every point is moving on a circle in each. Because the xw turn mixes the hidden direction in, the lattice keeps changing form: nodes slide across each other and bunches of lines open and close.

**How it is built.** Inside the Scene Group, one **4D Wireframe** node (24-cell, Orthographic) with Turn 1 in xw at 9 degrees a second and Turn 2 in yz at 6. Outside: March Camera, March Loop, Ambient Occlusion, Multi-Light, and the glow from Iter.

**Try.** Set **yz turn** to 0 to see the xw turn alone: the same lattice breathing as it turns through the hidden direction. Set **xw turn** to 0 and it only rolls, like a solid object. Slide **Size** to scale the whole figure. Switch Projection to Perspective inside the group for a depth-cued version (set Camera distance well above the radius).`),
  };

  // ── 3. Duocylinder shadow ────────────────────────────────────────────────
  const fl = -1.05;
  const shadow: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDDuocylinderShadow,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit and the two 4D turns.') }),
      n('multiply', 'turn1', 40, 600, { b: 24, outputType: 'float', ...note('Multiply: Time × 24 = the xw turn in degrees. Its B is the Play knob xw turn (deg/s). Going into the group through a port, it turns the shadow and the slice together.') }, { a: ['time', 'time'] }),
      n('multiply', 'turn2', 40, 740, { b: 17, outputType: 'float', ...note('Multiply: Time × 17 = the yz turn in degrees. Its B is the Play knob yz turn (deg/s).') }, { a: ['time', 'time'] }),
      n('multiply', 'neg1', 240, 600, { b: -1, outputType: 'float', ...note('Multiply by −1: Rotate 4D turns the point, so to turn the shape the same way as Project 4D does, the slice needs the opposite angle.') }, { a: ['turn1', 'result'] }),
      n('multiply', 'neg2', 240, 740, { b: -1, outputType: 'float', ...note('Multiply by −1: the same for the yz turn.') }, { a: ['turn2', 'result'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 6.2, camAngle: 0.5, camElevation: 0.5, rotSpeed: 0.05, fov: 1.5, ...note('March Camera: a slow orbit that keeps both shapes in view.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Slice and shadow', [
        n('translate3D', 'mvL', 240, 0, { tx: -1.6, ...note('Translate 3D: moves the left shape (the slice) to x = −1.6.') }, { pos: ['sp', 'pos'] }),
        n('lift4D', 'lift', 440, 0, { w: 0.0, ...note('Lift to 4D, W = 0: the slice goes through the middle. This is one layer of the duocylinder.') }, { pos: ['mvL', 'pos'] }),
        n('rotate4D', 'rzy', 640, 0, { plane: 'yz', ...note('Rotate 4D in yz, by the negated yz turn from the port. (To turn the shape the way Project 4D does, the point is turned the other way, and the yz turn is applied first.)') }, { p4: ['lift', 'p4'] }),
        n('rotate4D', 'rxw', 840, 0, { plane: 'xw', ...note('Rotate 4D in xw, by the negated xw turn from the port: x swaps with w, so the slice crosses a different part of the duocylinder every moment.') }, { p4: ['rzy', 'p4'] }),
        n('duocylinderSDF', 'dc', 1040, 0, { r1: 0.7, r2: 0.56, ...note('Duocylinder SDF (the slice): a disc of radius 0.7 in xy times a disc of radius 0.56 in zw, the same shape as on the right.') }, { p4: ['rxw', 'p4'] }),
        n('translate3D', 'mvR', 240, 300, { tx: 1.6, ...note('Translate 3D: moves the right shape (the shadow) to x = +1.6.') }, { pos: ['sp', 'pos'] }),
        n('project4D', 'prj', 440, 300, {
          shape: 'duocylinder', size: 0.7, ratio: 0.8, wRange: 1.0, samples: 20, smooth: 1.2, stepScale: 0.8, plane1: 'xw', plane2: 'yz',
          ...note('Project 4D, Duocylinder: the solid shadow along w. It measures the duocylinder (radius 0.7 and 0.56) at 20 values of w between −1 and +1 and keeps the nearest, so it is where ANY layer of the shape is. Turn 1 (xw) and Turn 2 (yz) come from the ports, matching the slice. An approximation: 20 layers, softened with Smooth 1.2 (a blend as wide as the spacing), and Step scale 0.8 shortens the march steps so a coarse sample count cannot overshoot.'),
        }, { pos: ['mvR', 'pos'] }),
        n('planeSDF3D', 'floor', 440, 560, { height: fl, ...note('A floor at y = −1.05, below both shapes, for shadows and occlusion.') }, { p: ['sp', 'pos'] }),
        n('sdfUnion', 'u1', 1240, 100, { k: 0, ...note('Union: the slice or the shadow, whichever is nearer.') }, { a: ['dc', 'dist'], b: ['prj', 'dist'] }),
        n('sdfUnion', 'u2', 1440, 200, { k: 0, ...note('Union with the floor.') }, { a: ['u1', 'dist'], b: ['floor', 'dist'] }),
      ], ['u2', 'dist'],
      'Left: Scene Pos lifted to 4D at w = 0, turned in two planes and measured against a duocylinder: a slice. Right: Project 4D measuring the same duocylinder at many w values, turned the same way: the whole shape squashed along w. Four ports carry the turns in from outside.',
      [
        { key: 'a1', label: 'xw turn (deg)', from: ['turn1', 'result'], to: ['prj', 'angle1'] },
        { key: 'a2', label: 'yz turn (deg)', from: ['turn2', 'result'], to: ['prj', 'angle2'] },
        { key: 'n1', label: 'xw turn, negated', from: ['neg1', 'result'], to: ['rxw', 'angle'] },
        { key: 'n2', label: 'yz turn, negated', from: ['neg2', 'result'], to: ['rzy', 'angle'] },
      ]),
      ...finish([0.05, 0.055, 0.1],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          checker(fl) + 'x < 0.0 ? vec3(1.0, 0.6, 0.22) + vec3(0.0, 0.2, 0.2) * clamp(0.5 + 0.5 * y, 0.0, 1.0) : vec3(0.22, 0.62, 1.0) + vec3(0.6, 0.0, -0.3) * clamp(0.5 - 0.5 * y, 0.0, 1.0)',
          'Surface colour from where the ray landed: a dark checker on the floor, orange for the slice (left of the middle) and blue for the shadow (right).'),
        'March Loop: finds where each ray meets the scene; Soft Shadow and Ambient Occlusion measure the same Scene Group.'),
    ],
    play: play([
      ctl('t1', 'turn1::b', 'xw turn (deg/s)', -90, 90, 0.5),
      ctl('t2', 'turn2::b', 'yz turn (deg/s)', -90, 90, 0.5),
      ctl('n', 'scene::prj::size', 'Shadow size', 0.4, 0.9, 0.01),
      ctl('s', 'scene::prj::smooth', 'Shadow smoothing', 0, 3, 0.05),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** The same turning duocylinder shown two ways. On the **left, orange**, is a **slice**: the layer at w = 0, the one thin 3D cross-section the earlier 4D examples show. On the **right, blue**, is its **shadow along w**: everything at every w flattened into 3D, like a hand's shadow on a wall. At rest the slice is a cylinder and so is the shadow (a duocylinder is a disc times a disc, and flattening one disc leaves a cylinder). Turn it in xw and the two part company: the slice stretches and shortens as different parts cross the middle layer, while the shadow grows fat and lumpy, because the turn spreads the shape's reach over x.

**How it is built.** Inside one Scene Group: Scene Pos → Translate 3D → **Lift to 4D** → two **Rotate 4D** → **Duocylinder SDF** for the slice; Scene Pos → Translate 3D → **Project 4D** (Duocylinder, 20 samples across w from −1 to 1) for the shadow. Four ports bring the two turn angles (and their negatives) from outside so both shapes always turn together. The floor and the lighting are as in the other 4D examples.

**Try.** Set both turns to 0: slice and shadow match (a cylinder). Then turn only **xw**: the shadow changes, the slice follows only a part of it. Set **Shadow smoothing** to 0 and the shadow shows faint stacked layers (that is what the approximation is: 20 slices between w = -1 and 1); at 1 they blend. Open the group and set Samples on Project 4D to 4 for coarse layers, or 32 for a shadow that is nearly the true one.`),
  };

  // ── 4. Hopf rings ────────────────────────────────────────────────────────
  const hopf: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDHopfRings,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit and the flow along the circles.') }),
      n('multiply', 'flow', 40, 620, { b: 18, outputType: 'float', ...note('Multiply: Time × 18 = the Hopf Circles phase in degrees. Going in through the phase port, it slides every circle along itself (the Hopf flow). B is the Play knob Flow (deg/s).') }, { a: ['time', 'time'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 6.4, camAngle: 0.7, camElevation: 0.55, rotSpeed: 0.05, fov: 1.5, ...note('March Camera: a slow orbit, from above so the half-cut torus shows its inside.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Hopf rings', [
        n('stereo4D', 'st', 240, 100, {
          scale: 1.0, radius: 1.0, plane1: 'xw', spin1: 6, plane2: 'xy', spin2: 3,
          ...note('Stereographic 4D: all of 3D space is laid onto the 3-sphere of radius 1 (the origin goes to the south pole, infinity to the north pole), then turned in 4D. Scale 1 sets how large the picture is. Turn 1 (xw) swings the sphere so the torus and the circles drift and re-form; Turn 2 (xy) turns it round the axis. It gives the 4D point and a Factor (how much the map stretched space here) for the distance correction.'),
        }, { pos: ['sp', 'pos'] }),
        n('hopfCirclesSDF', 'hc', 520, 20, {
          radius: 1.0, thickness: 0.04, count: 8, latitude: 90, spread: 45, rings: 3,
          ...note('Hopf Circles SDF: 3 rings of 8 great circles of the 3-sphere, fibres of the Hopf fibration (latitudes 45, 90 and 135 degrees on the base sphere). Any two circles link exactly once. Each is a tube of 4D radius 0.04, so in 3D it is thin near the middle and fat far out. Phase slides every circle along itself, from the port.'),
        }, { p4: ['st', 'p4'] }),
        n('cliffordTorusSDF', 'ct', 520, 220, {
          radius: 1.0, thickness: 0.03, balance: 45,
          ...note('Clifford Torus SDF: the torus on the 3-sphere made of two equal circles, a thin shell (4D thickness 0.03). Under the stereographic map it is an ordinary torus, and the 90-degree ring of Hopf circles lies exactly on it.'),
        }, { p4: ['st', 'p4'] }),
        n('stereoDist4D', 'fh', 780, 20, { ...note('Stereographic Distance, circles: divides out the stretch of the map (the Factor), with a safety limit, so the march steps never pass through a circle.') },
          { dist: ['hc', 'dist'], factor: ['st', 'factor'], scale: ['st', 'scale'] }),
        n('stereoDist4D', 'fc', 780, 220, { ...note('Stereographic Distance, torus: the same correction for the torus shell.') },
          { dist: ['ct', 'dist'], factor: ['st', 'factor'], scale: ['st', 'scale'] }),
        n('planeSDF3D', 'cut', 780, 420, { height: 0.0, ...note('A plane at y = 0, used to cut the torus shell in half so you can see the circles inside it.') }, { p: ['sp', 'pos'] }),
        n('sdfIntersect', 'half', 1020, 300, { k: 0, ...note('Intersect with the plane: the lower half of the torus shell is kept.') }, { a: ['fc', 'dist'], b: ['cut', 'dist'] }),
        n('sdfUnion', 'un', 1260, 160, { k: 0, ...note('Union: the circles or the half torus, whichever is nearer.') }, { a: ['fh', 'dist'], b: ['half', 'dist'] }),
        n('sphereSDF3D', 'bound', 1260, 420, { radius: 2.6, ...note('A sphere of radius 2.6 around the middle. All of infinity is part of the picture (the circles through the north pole become straight lines going out forever); this keeps the march from chasing them out there.') }, { pos: ['sp', 'pos'] }),
        n('sdfIntersect', 'fit', 1500, 260, { k: 0, ...note('Intersect with the bound: the scene is the circles and torus inside the sphere.') }, { a: ['un', 'dist'], b: ['bound', 'dist'] }),
      ], ['fit', 'dist'],
      'Scene Pos goes to the 3-sphere and is turned; the Clifford torus and the Hopf circles measure it; each distance is corrected for the stretch of the map; the scene is their union, cut open and bounded. A port brings in the flow.',
      [{ key: 'phase', label: 'Phase (deg)', from: ['flow', 'result'], to: ['hc', 'phase'] }]),
      ...finishGlow([0.025, 0.02, 0.06],
        expr('col', 1180, 520, 'Ring colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'vec3(0.5) + 0.5 * cos(6.2832 * (atan(z, x) / 6.2832 + vec3(0.0, 0.33, 0.67)))',
          'Ring colour: a rainbow by the angle round the y axis, so neighbouring circles differ and you can follow one round its link.'),
        glowBlock([0.4, 0.5, 1.0], 1.4, 'Glow: Iter (steps taken, 0 to 1) times 2.2, cubed, in a cool blue. Rings that sit close together make rays linger, so the dense regions glow.'),
        'March Loop: finds where each ray meets a circle or the torus, and how many steps it took (Iter, used for the glow).'),
    ],
    play: play([
      ctl('t', 'scene::st::spin1', 'xw turn (deg/s)', -60, 60, 0.5),
      ctl('f', 'flow::b', 'Flow (deg/s)', -90, 90, 0.5),
      ctl('n', 'scene::hc::latitude', 'Ring latitude (deg)', 30, 150, 0.5),
      ctl('k', 'scene::hc::thickness', 'Circle thickness', 0.015, 0.09, 0.005),
      ctl('s', 'scene::st::scale', 'Scale', 0.5, 1.8, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** The 3-sphere is the 4D ball's skin, and all of 3D space can be laid onto it by **stereographic projection**: every point of space lands on a point of the 3-sphere, the origin at one pole and "infinity" at the other. Here that picture is turned in 4D and then looked at back in 3D. The **Hopf circles** (a few of the great circles that fill the 3-sphere, any two linked once) become the famous interlocking rings that fill space, nested around a **Clifford torus** (the half-cut shell). Circles stay circles under the map, so each ring is a true circle, or a line if it passes through the north pole.

**How it is built.** Inside the Scene Group: Scene Pos → **Stereographic 4D** (scale 1, turned in xw and xy) → **Hopf Circles SDF** (3 rings of 8) and **Clifford Torus SDF**; each distance goes through **Stereographic Distance**, which divides out the stretch of the map so the march cannot step through a ring; a plane cuts the torus open and a sphere bounds the whole. A port brings in the Hopf flow. Outside: the usual camera, loop, occlusion, lighting and an Iter glow.

**Try.** Set **xw turn** to 0 and the picture holds still while **Flow** slides the circles round themselves, and no ring ever collides. Slide **Ring latitude** to move the middle ring of circles (90 is the one on the torus), and set Fibres per ring to 16 inside the group for a denser bundle. Slide **Scale** to zoom the picture in or out; circles near the middle are thin, those out near the north pole are fat, which is the stretch of the map. In Hopf Circles SDF try Rings 1, Latitude 90: one ring, all on the torus (the Villarceau circles).`),
  };

  // ── 5. Flat tesseract (4D → 2D) ──────────────────────────────────────────
  const flat: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDFlatTesseract,
    counter: 20,
    nodes: [
      n('uv', 'uv', 40, 220, { ...note('UV: the flat picture, centred, about -1 to 1 up the height.') }),
      n('wireframe4D2D', 'wire', 300, 220, {
        polytope: 'tesseract', projection: 'perspective', camDist: 3.0, projection3: 'perspective', camDist3: 4.0,
        radius: 0.42, edge: 0.003, vertex: 0.01, plane1: 'xw', spin1: 18, plane2: 'yz', spin2: 11,
        ...note('4D Wireframe 2D: the sixteen corners of a tesseract, turned in 4D (Turn 1 in xw swaps the inner and outer cube; Turn 2 in yz rolls it), seen by a camera on the w axis (4D → 3D, the cube in a cube) and then by a flat camera on the z axis (3D → 2D). The result is a distance to thin lines and dots on the picture, like a circle\'s distance.'),
      }, { uv: ['uv', 'uv'] }),
      n('light', 'halo', 600, 120, { mode: 'glow', brightness: 18, tint: [0.25, 0.55, 1.0], ...note('SDF Glow, wide: a soft blue halo that fades with the distance to the nearest line.') }, { distance: ['wire', 'dist'] }),
      n('light', 'core', 600, 360, { mode: 'glow', brightness: 70, tint: [1.0, 0.85, 0.95], ...note('SDF Glow, tight: a near-white core on each line, so the lines look like lit wire.') }, { distance: ['wire', 'dist'] }),
      n('addColor', 'sum', 880, 220, { ...note('Add Colors: the halo plus the core.') }, { a: ['halo', 'tinted'], b: ['core', 'tinted'] }),
      n('toneMap', 'tone', 1120, 220, { mode: 'aces', ...note('Tone Map: the glow goes above 1 where lines cross; ACES rolls it off instead of clipping.') }, { color: ['sum', 'result'] }),
      n('output', 'out', 1360, 220, { ...note('Output: the picture.') }, { color: ['tone', 'color'] }),
    ],
    play: play([
      ctl('t1', 'wire::spin1', 'xw turn (deg/s)', -90, 90, 0.5),
      ctl('t2', 'wire::spin2', 'yz turn (deg/s)', -90, 90, 0.5),
      ctl('r', 'wire::radius', 'Size', 0.1, 0.9, 0.005),
      ctl('g', 'halo::brightness', 'Glow falloff', 3, 60, 0.5),
    ], `**What it shows.** A tesseract drawn the way it usually is in books and animations: the whole 4D cube projected down to a flat picture. First a camera on the fourth axis (w) sees it in perspective, which gives the small cube inside the big cube; then a flat camera looks at that 3D picture along z. As it turns in the xw plane the inner cube swells out through the faces and becomes the outer one.

**How it is built.** UV → **4D Wireframe 2D** → two **SDF Glow** nodes (a wide blue halo, a tight white core) → **Add Colors** → **Tone Map** → Output. The wireframe node's distance works like any 2D shape's, so you can also fill it, warp UV before it, or tile it.

**Try.** Set **yz turn** to 0 and watch the pure 4D turn. In the node, switch **4D → 3D** to Orthographic: the inner and outer cubes flatten onto each other. Try Polytope **24-cell**, or warp the UV first (a polar or kaleidoscope node) for a mandala of tesseracts.`),
  };

  // ── 6. Plane through a duocylinder (4D → 2D) ─────────────────────────────
  const plane: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDPlaneSlice,
    counter: 20,
    nodes: [
      n('uv', 'uv', 40, 220, { ...note('UV: the flat picture.') }),
      n('time', 'time', 40, 460, { ...note('Time: drives the sweep.') }),
      n('lfo', 'sweep', 300, 460, { waveform: 'sine', freq: 0.05, amplitude: 0.5, offset: 0, ...note('LFO (sine): where the plane sits along w, sweeping between -0.5 and 0.5 about once every 20 seconds. Its Amplitude is the Play slider Sweep.') }, { time: ['time', 'time'] }),
      n('planeSlice4D', 'slice', 300, 220, { scale: 1.7, z: 0.0, ...note('Plane Slice 4D: every point of the picture becomes the 4D point (x, y, z, w), with z fixed and w from the LFO. The picture is now a flat plane through 4D space.') }, { uv: ['uv', 'uv'], w: ['sweep', 'value'] }),
      n('rotate4D', 'turnA', 560, 220, { plane: 'xw', angle: 0, spin: 9, ...note('Rotate 4D, xw: tilts the plane into the fourth axis over time, so the cut passes through different parts of the shape.') }, { p4: ['slice', 'p4'] }),
      n('rotate4D', 'turnB', 800, 220, { plane: 'yz', angle: 25, spin: -6, ...note('Rotate 4D, yz: a second, slower turn the other way, so the pattern never quite repeats.') }, { p4: ['turnA', 'p4'] }),
      n('duocylinderSDF', 'duo', 1040, 220, { r1: 0.8, r2: 0.55, ...note('Duocylinder SDF: two discs at right angles (one in xy, one in zw). Its cross-section by a plane is anything from a disc to a square-ish blob, and it splits in two as the plane turns.') }, { p4: ['turnB', 'p4'] }),
      n('palette', 'pal', 1280, 80, { preset: 'rainbow', scale: 4.0, ...note('Palette: colours the inside by how deep each point is in the shape (the distance), so the blobs show contour bands.') }, { value: ['duo', 'dist'] }),
      n('sdfFill', 'fill', 1520, 220, { strokeWidth: 0.012, ...note('SDF Fill: the inside in the palette colour, a thin white outline on the edge, dark outside.') }, { d: ['duo', 'dist'], fillColor: ['pal', 'color'] }),
      n('toneMap', 'tone', 1760, 220, { mode: 'aces', ...note('Tone Map.') }, { color: ['fill', 'result'] }),
      n('output', 'out', 2000, 220, { ...note('Output: the picture.') }, { color: ['tone', 'color'] }),
    ],
    play: play([
      ctl('s', 'sweep::amplitude', 'Sweep', 0, 1, 0.01),
      ctl('a', 'turnA::spin', 'xw turn (deg/s)', -45, 45, 0.5),
      ctl('b', 'turnB::spin', 'yz turn (deg/s)', -45, 45, 0.5),
      ctl('r1', 'duo::r1', 'Radius 1', 0.2, 1.2, 0.01),
      ctl('r2', 'duo::r2', 'Radius 2', 0.2, 1.2, 0.01),
    ], `**What it shows.** A 4D shape seen through a flat window. The picture is a plane through 4D space, and you see where it cuts a duocylinder. As the plane tilts into the fourth dimension, the cut shape grows, splits into two blobs, merges back and changes outline, though the duocylinder itself never changes.

**How it is built.** UV → **Plane Slice 4D** (w from an LFO) → **Rotate 4D** (xw) → **Rotate 4D** (yz) → **Duocylinder SDF**. The distance is then coloured like any 2D shape: a Palette by depth and **SDF Fill** with an outline.

**Try.** Set both turns to 0 and move **Sweep**: only w changes. Swap the Duocylinder for a **Tesseract**, **24-cell** or **Clifford Torus** (they all take the same 4D point). Raise Plane Slice 4D's Scale to zoom out.`),
  };

  // ── 7. Quaternion Julia ──────────────────────────────────────────────────
  const julia: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDQuatJulia,
    counter: 40,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera and the drift of c.') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 2.1, camAngle: 0.4, camElevation: 0.35, rotSpeed: 0.06, fov: 1.4, ...note('March Camera: slowly circles the fractal, close in.') }, { time: ['time', 'time'] }),
      n('lfo', 'cxd', 40, 640, { waveform: 'sine', freq: 0.031, amplitude: 0.22, offset: -0.2, ...note('LFO: c x drifts between -0.42 and 0.02 about once every 32 seconds. Amplitude is the Play knob Drift.') }, { time: ['time', 'time'] }),
      n('lfo', 'cyd', 40, 800, { waveform: 'sine', freq: 0.047, phase: 0.25, amplitude: 0.18, offset: 0.58, ...note('LFO: c y drifts between 0.4 and 0.76, at another speed so the two never line up.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 980, 'Quaternion Julia', [
        n('lift4D', 'lift', 240, 80, { w: 0.0, ...note('Lift to 4D: the 3D point becomes (x, y, z, w). W is the Play knob Slice.') }, { pos: ['sp', 'pos'] }),
        n('rotate4D', 'rot', 480, 80, { plane: 'xw', angle: 0, spin: 7, ...note('Rotate 4D in xw, slowly: the slice cuts the 4D fractal at a turning angle, so new folds come into view.') }, { p4: ['lift', 'p4'] }),
        n('quatJuliaSDF', 'jul', 720, 80, { cx: -0.2, cy: 0.58, cz: 0.2, cw: 0.0, iters: 10, scale: 0.75, ...note('Quaternion Julia SDF: each 4D point is squared and shifted by c, again and again (10 times); points that stay small are inside. c x and c y come in through ports from the two LFOs, so the set changes shape over time.') }, { p4: ['rot', 'p4'] }),
      ], ['jul', 'dist'],
      'Scene Pos is lifted to 4D, turned in xw and measured against a quaternion Julia set whose constant c drifts in through ports.',
      [{ key: 'cx', label: 'c x', from: ['cxd', 'value'], to: ['jul', 'cx'] }, { key: 'cy', label: 'c y', from: ['cyd', 'value'], to: ['jul', 'cy'] }]),
      ...finish([0.03, 0.03, 0.06],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'vec3(0.55, 0.45, 0.95) + vec3(0.45, 0.35, -0.35) * clamp(0.5 + 0.5 * sin(4.0 * length(vec3(x, y, z)) + 2.0 * y), 0.0, 1.0)',
          'Surface colour: violet to warm orange in bands by distance from the middle, so the folds read.'),
        'March Loop: finds where each ray meets the fractal. Its distance is an estimate, so Step Scale is a little under 1.'),
    ].map(nd => (nd.type === 'marchLoopGroup' ? { ...nd, params: { ...nd.params, stepScale: 0.8, maxSteps: 160 } } : nd)),
    play: play([
      ctl('w', 'scene::lift::w', 'Slice (w)', -0.8, 0.8, 0.01),
      ctl('d', 'cxd::amplitude', 'Drift', 0, 0.5, 0.005),
      ctl('s', 'scene::rot::spin', 'xw turn (deg/s)', -40, 40, 0.5),
      ctl('cz', 'scene::jul::cz', 'c z', -0.8, 0.8, 0.005),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A quaternion Julia set is the 4D version of the famous Julia fractal: each 4D point is squared (as a quaternion) and shifted by a constant c, over and over, and the points that never run away make the solid. What you see is its 3D slice: lumpy bulbs that curl into each other. As the LFOs move c, the whole set reshapes.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** → **Rotate 4D** (xw) → **Quaternion Julia SDF**. Outside, two **LFOs** drift c x and c y into the group through ports; the usual camera, loop and lighting draw it, with Step Scale 0.8 because the distance is an estimate.

**Try.** Set **Drift** to 0 and slide **c z** to explore single sets. Move **Slice** to cut the 4D fractal somewhere else. In the node, Iterations 6 is softer and faster; 14 adds fine detail.`),
  };

  return { fourDQuatJulia: julia, fourDTesseractProjection: tesseract, fourD24CellWireframe: cell24, fourDDuocylinderShadow: shadow, fourDHopfRings: hopf, fourDFlatTesseract: flat, fourDPlaneSlice: plane };
}
