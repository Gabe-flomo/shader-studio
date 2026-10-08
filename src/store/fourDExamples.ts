/**
 * fourDExamples.ts — the 4D folder (docs/4d.md): a first taste of a fourth dimension by slicing.
 *
 * All are ordinary ray-marched 3D scenes. Inside the Scene Group the point being measured is
 * lifted to 4D (w = the slice, in a chosen slice direction), maybe turned in a plane that includes w,
 * and measured against a 4D shape; the distance goes to Scene Output like any other. Nothing outside
 * the group knows. The lighting has shadows and ambient occlusion, which measure the same group.
 *
 * Every node carries a comment saying what it is and why it is there.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, play } from './graphBuilder';
import { getNodeDefinition } from '../nodes/definitions';

export const FOURD_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  fourDTesseractSlice: {
    label: '4D: Tesseract slice',
    description: 'A tesseract (a 4D cube) cut corner-first. As the slice sweeps through it you see a point grow into a tetrahedron, a truncated tetrahedron, an octahedron, and back. Shadows and occlusion on a floor. Play moves the sweep, the centre and the size.',
    play: true,
  },
  fourDHypersphereInTesseract: {
    label: '4D: Hypersphere in a tesseract',
    description: 'A hypersphere inside a hollow tesseract, in an open tray with shadows. The slice sweeps slowly along w, so the orange ball swells and shrinks inside a blue box that morphs as it turns. Play turns the box and lowers the cut straight inside the Scene Group.',
    play: true,
  },
  fourDThreeSlices: {
    label: '4D: Tesseract, all three slices',
    description: 'Three tesseracts side by side with the same w, cut face-first, edge-first and corner-first. At the same moment each gives a different 3D shape: a cube, a prism, and a tetrahedron that grows into an octahedron.',
    play: true,
  },
  fourDDuocylinderDance: {
    label: '4D: Duocylinder dance',
    description: 'A duocylinder (two circles multiplied) tumbling in two 4D planes at once. Its 3D slice stretches, shortens and rolls without repeating. Shadows and occlusion on a floor. Play sets both turn speeds, the cut and the radius.',
    play: true,
  },
  fourD24Cell: {
    label: '4D: The 24-cell',
    description: 'The 24-cell, a shape with no 3D relative, cut corner-first while the slice sweeps through it: an octahedron (one whole cell of the 24-cell) appears, has its corners cut off and becomes a truncated octahedron at the middle, then shrinks back. Play moves the sweep, the centre and the size.',
    play: true,
  },
  fourDCliffordTorus: {
    label: '4D: Clifford torus',
    description: 'A Clifford torus (two equal circles in perpendicular planes) turning slowly in two 4D planes, roughened by 4D noise that crawls over it. Its slice changes between linked rings and a fat torus. Play moves the cut, the turns, the balance and the wobble.',
    play: true,
  },
  fourDLattice: {
    label: '4D: Lattice of hyperspheres',
    description: 'A 3 x 3 x 3 x 3 lattice of hyperspheres, turning in the xw plane. Every copy is cut at a different depth, so the equal balls of the slice swell, shrink and vanish in waves. Play sets the turn, the cut, the ball size and the spacing.',
    play: true,
  },
  fourDShapeGallery: {
    label: '4D: Shape gallery',
    description: 'Ten 4D shapes in two rows, all turning in the xw plane: duocylinder, spherinder, cubinder, cylindrical prism, ditorus, 5-cell, 16-cell, 24-cell, tesseract and Clifford torus. Play sets the turn speed and the camera.',
    play: true,
  },
};

export const FOURD_EXAMPLE_KEYS = Object.keys(FOURD_EXAMPLE_INDEX);

type Wire = [fromId: string, outputKey: string];
const note = (text: string) => ({ __comment: text });
const sub = (nodes: GraphNode[]): SubgraphData => ({ nodes, inputPorts: [], outputPorts: [] });

/** A Scene Group: Scene Pos → `shapes` → Scene Output; `ports` carry floats in from outside (a wired value, like an LFO). */
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

const SUN = { x: 0.55, y: 0.85, z: 0.45 };

/**
 * Loop, shadow, occlusion, Multi-Light, background, vignette and tone map: the same finishing for all.
 * `colour` is the Expression Block that picks a surface colour from the hit point.
 */
function finish(bg: [number, number, number], colour: GraphNode, loopNote: string, outX = 1700): GraphNode[] {
  return [
    n('marchLoopGroup', 'march', 340, 220, { bg, maxSteps: 128, maxDist: 24, ...note(loopNote) }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('splitVec3', 'hp', 640, 420, { ...note('Split Vec3: the hit point as x, y, z, so the surface colour can depend on where the ray landed.') }, { v: ['march', 'pos'] }),
    colour,
    n('makeVec3', 'sun', 900, 40, { r: SUN.x, g: SUN.y, b: SUN.z, ...note('Make Vec3: the direction the sun shines from, as one vector. It goes to the shadow (to know which way to look for blockers) and to Multi-Light (to light the surface), so the shadow and the light always agree.') }),
    n('softShadow', 'shadow', 900, 200, { k: 12, tmax: 20, ...note('Soft Shadow: from each hit point a second ray goes toward the sun through the SAME Scene Group, so the shadow has the shape of the slice at this very w. It reads the group\'s wired values (the slice position) as the march loop does. Hardness 12 gives a soft edge.') },
      { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'], lightDir: ['sun', 'rgb'] }),
    n('sdfAo', 'ao', 900, 380, { stepDist: 0.07, ...note('SDF Ambient Occlusion: steps along the surface normal and compares the distance it expects with the scene\'s real distance there; where the real one is smaller, something is close by and the corner darkens. Again it measures the same Scene Group.') },
      { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'] }),
    n('multiLight', 'lit', 1180, 220, {
      sunR: 1.25, sunG: 1.05, sunB: 0.85, skyR: 0.22, skyG: 0.3, skyB: 0.5, bounceR: 0.09, bounceG: 0.06, bounceB: 0.05,
      ...note('Multi-Light: warm sun from one side (shadowed), a cool sky fill from above and a little bounce light (both darkened by occlusion), over the surface colour, in linear light.'),
    }, { baseColor: ['col', 'result'], normal: ['march', 'normal'], hit: ['march', 'hit'], ao: ['ao', 'ao'], shadow: ['shadow', 'shadow'], sunDir: ['sun', 'rgb'] }),
    n('colorPicker', 'sky', 1180, 520, { color: bg, ...note('Background colour: what a ray that hits nothing shows.') }),
    n('select', 'pick', 1420, 220, { outputType: 'vec3', ...note('Hit is 1 where the ray touched the shape: show the lit surface there, the background elsewhere.') },
      { mask: ['march', 'hit'], ifTrue: ['lit', 'color'], ifFalse: ['sky', 'rgb'] }),
    n('vignette', 'vig', 1660, 220, { radius: 0.75, softness: 0.6, strength: 0.7, ...note('A soft dark edge to the frame, to hold the eye on the middle.') }, { color: ['pick', 'result'] }),
    n('toneMap', 'tone', 1900, 220, { mode: 'aces', ...note('Tone Map: the lights go above 1; ACES rolls them off so the bright side keeps its colour instead of clipping.') }, { color: ['vig', 'result'] }),
    n('output', 'out', outX + 440, 220, { ...note('Output: the picture.') }, { color: ['tone', 'color'] }),
  ].map(nd => (nd.type === 'marchLoopGroup' ? { ...nd, params: { ...nd.params, subgraph: passBody('march') } } : nd));
}

export function buildFourDExamples(): Record<string, ExampleGraph> {
  // ── 1. Tesseract slice (corner-first) ─────────────────────────────────────
  const slice: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDTesseractSlice,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit and the slice sweep.') }),
      n('lfo', 'sweep', 40, 640, { waveform: 'sine', freq: 0.07, amplitude: 1.0, offset: 0, ...note('LFO (sine): the slice position W, sweeping between -1 and 1 about once every 14 seconds (this tesseract reaches 1 = twice its half size, corner-first). Its Amplitude is the Play knob Sweep and its Offset is the Play knob Centre: set Sweep to 0 and Centre holds the slice still wherever you put it.') }, { time: ['time', 'time'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 3.9, camAngle: 0.7, camElevation: 0.42, rotSpeed: 0.1, fov: 1.5, ...note('March Camera: slowly circles the middle. The camera is the only thing that moves in 3D; the shape changes because the slice moves through the 4D tesseract.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Tesseract slice', [
        n('lift4D', 'lift', 240, 80, { sliceDir: 'corner', ...note('Lift to 4D, Slice direction Corner-first: the cut is a flat 3D layer whose normal is (1,1,1,1)/2, so it meets the tesseract at a corner first. W arrives through the port from the LFO outside. At the largest W the layer touches one corner: a point. Lower W and it opens into a tetrahedron, then a truncated tetrahedron, and at W = 0 an octahedron. Then it runs back down the other side.') }, { pos: ['sp', 'pos'] }),
        n('tesseractSDF', 'ts', 520, 80, { size: 0.5, rounding: 0.03, ...note('Tesseract SDF: the box formula with four coordinates. Half size 0.5 in every direction, edges rounded by 0.03. Half size is a Play knob that reaches straight in here. The cut reaches the corner at W = 2 x half size = 1.0.') }, { p4: ['lift', 'p4'] }),
        n('planeSDF3D', 'floor', 520, 360, { height: -1.15, ...note('A floor at y = -1.15, just below the largest slice, so the shadow of the shape has somewhere to land. It is plain 3D: it never meets the 4D part.') }, { p: ['sp', 'pos'] }),
        n('sdfUnion', 'un', 820, 200, { k: 0, ...note('Union: the scene is the nearer of the slice and the floor.') }, { a: ['ts', 'dist'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'The whole 4D idea lives in this group: the point from Scene Pos is lifted to 4D along a corner-first slice, and measured against a tesseract. A distance comes out and goes to Scene Output, so the camera, the march loop and the lighting outside (including the shadow and occlusion, which measure this very group) are the same as for any 3D scene.',
      [{ key: 'w', label: 'W (slice)', from: ['sweep', 'value'], to: ['lift', 'w'] }]),
      ...finish([0.05, 0.055, 0.1],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'y < -1.14 ? vec3(0.16, 0.18, 0.28) + vec3(0.1, 0.11, 0.14) * mod(floor(x * 2.0) + floor(z * 2.0), 2.0) : vec3(0.95, 0.32, 0.3) + vec3(0.05, 0.46, 0.05) * clamp(0.5 + 0.45 * (x + y + z), 0.0, 1.0)',
          'Surface colour from where the ray landed: a dark blue checker on the floor (y below -1.14), and on the slice a slide from coral to gold along the diagonal so the flat faces of the tetrahedron and octahedron read.'),
        'March Loop: finds, for each pixel, where the ray meets the scene and the surface direction there. Its Hit, Normal and Hit Pos feed the shadow, the occlusion and the lighting.'),
    ],
    play: play([
      ctl('sweep', 'sweep::amplitude', 'Sweep (w range)', 0, 1.1, 0.01),
      ctl('centre', 'sweep::offset', 'Centre (w)', -1.1, 1.1, 0.01),
      ctl('size', 'scene::ts::size', 'Tesseract half size', 0.2, 0.7, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A tesseract is a cube with a fourth direction, w: eight cubes folded around a point you cannot see all at once. The screen shows 3D, so this is one slice of it. Here the slice is cut **corner-first**: its direction is (1,1,1,1), diagonal to all four axes, so it meets the tesseract at a corner. At the extreme w you see a single point. As w comes down it opens into a **tetrahedron**, grows, has its corners cut off (a truncated tetrahedron) and at w = 0 is a perfect **octahedron**. Then it runs back through the same shapes in reverse to a point on the far side.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** (Slice direction: Corner-first) → **Tesseract SDF** → Union with a floor → Scene Output. Outside, an LFO sweeps w; an ordinary March Camera and March Loop find the surface, and Soft Shadow and SDF Ambient Occlusion measure the same Scene Group, so the shadow on the floor is the shadow of the slice you are seeing.

**Try.** Set **Sweep** to 0 and slide **Centre** to hold any slice: about 0.5 and above is a tetrahedron, 0 an octahedron. **Tesseract half size** is a Play knob on a setting inside the Scene Group; the point is always reached at twice the half size. On Lift to 4D change the Slice direction to **Face-first** to see the cube (the slice is empty beyond w = half size), or **Edge-first**.`),
  };

  // ── 2. Hypersphere in a tesseract ─────────────────────────────────────────
  const inside: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDHypersphereInTesseract,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit and the slice sweep.') }),
      n('lfo', 'sweep', 40, 640, { waveform: 'sine', freq: 0.08, amplitude: 0.5, offset: 0, ...note('LFO (sine): the slice position W, sweeping slowly between -0.5 and 0.5 about once every 12 seconds. Its Amplitude is the Play slider Sweep; set it to 0 to hold W at 0.') }, { time: ['time', 'time'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 3.7, camAngle: 0.5, camElevation: 0.75, rotSpeed: 0.1, fov: 1.5, ...note('March Camera: looks down into the tray from above and circles slowly.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Hypersphere in a tesseract', [
        n('lift4D', 'lift', 240, 80, { ...note('Lift to 4D: W (the slice) arrives from the LFO outside the group through the W port, so one number moves the slice for the geometry and for the colouring. Face-first slice.') }, { pos: ['sp', 'pos'] }),
        n('rotate4D', 'rot', 520, 80, { plane: 'xw', angle: 0, spin: 14, ...note('Rotate 4D in the xw plane, slowly. The sphere is round in every direction so it does not change; the box around it does. Spin 14 degrees a second keeps it going; Angle is a Play slider set straight on this node, inside the group.') }, { p4: ['lift', 'p4'] }),
        n('hypersphereSDF', 'ball', 800, 20, { radius: 0.6, ...note('Hypersphere SDF: length(p4) - radius. A 4D ball of radius 0.6: its slice at W is a 3D ball of radius sqrt(0.6² - W²). At W = 0 it is a full 0.6 ball; at W = ±0.6 it shrinks to a point and is gone.') }, { p4: ['rot', 'p4'] }),
        n('tesseractSDF', 'outer', 800, 220, { size: 0.9, rounding: 0.05, ...note('Tesseract SDF (outer): the outside of the box, half size 0.9.') }, { p4: ['rot', 'p4'] }),
        n('tesseractSDF', 'inner', 800, 420, { size: 0.8, rounding: 0.04, ...note('Tesseract SDF (inner): a slightly smaller box, half size 0.8. Cutting it out of the outer one leaves a hollow shell 0.1 thick.') }, { p4: ['rot', 'p4'] }),
        n('sdfSubtract', 'shell', 1080, 320, { k: 0, ...note('Subtract: outer box minus inner box = a hollow tesseract shell. Both are the same rotated 4D point, so the shell turns as one piece.') }, { a: ['outer', 'dist'], b: ['inner', 'dist'] }),
        n('planeSDF3D', 'lid', 1080, 560, { height: 0.35, ...note('A plane at y = 0.35. Used below to slice the top off the shell, so you can see inside. Its Height is a Play slider set on this node inside the group.') }, { p: ['sp', 'pos'] }),
        n('sdfIntersect', 'tray', 1360, 420, { k: 0, ...note('Intersect with the plane: keeps only what is below y = 0.35. The shell becomes an open tray with the ball inside.') }, { a: ['shell', 'dist'], b: ['lid', 'dist'] }),
        n('sdfUnion', 'un', 1560, 200, { k: 0, ...note('Union: the scene is the tray or the ball, whichever is nearer.') }, { a: ['tray', 'dist'], b: ['ball', 'dist'] }),
      ], ['un', 'dist'],
      'A hypersphere inside a hollow tesseract, both measured at the same turned 4D point. W comes in through a port from the LFO outside; the turn and the cut height are Play controls on settings inside this group.',
      [{ key: 'w', label: 'W (slice)', from: ['sweep', 'value'], to: ['lift', 'w'] }]),
      ...finish([0.06, 0.05, 0.09],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'], w: ['sweep', 'value'] },
          'length(vec3(x, y, z)) < sqrt(max(0.36 - w * w, 0.0)) + 0.04 ? vec3(1.0, 0.4, 0.16) + vec3(0.0, 0.35, 0.14) * clamp(0.5 + 0.7 * y, 0.0, 1.0) : vec3(0.3, 0.52, 0.72) + vec3(0.25, 0.26, 0.18) * clamp(0.5 + 0.4 * y, 0.0, 1.0)',
          'Which surface did the ray land on? The ball\'s slice has radius sqrt(0.36 - W²), and the shell is always further from the middle than that (the inner box holds a 4D ball of radius 0.8). So a hit point closer than the ball\'s radius plus a little is the ball: orange. Anything else is the shell: blue.'),
        'March Loop: finds where each ray meets the scene and the surface direction there.', 1700),
    ],
    play: play([
      ctl('sweep', 'sweep::amplitude', 'Sweep (w range)', 0, 0.6, 0.01),
      ctl('a', 'scene::rot::angle', 'Turn (deg)', -180, 180, 0.5),
      ctl('lid', 'scene::lid::height', 'Cut height', -0.2, 0.9, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A hypersphere (a ball with four directions) inside a hollow tesseract, seen through a slice. The ball's slice is always a ball, but its size depends on **w**: biggest at w = 0, shrinking to a point as w reaches its radius, so as the slice sweeps the orange ball swells and shrinks. Meanwhile the box around it, turning in the xw plane, morphs from a cube to a corner-cut shape and back. The top is cut off so you can see in, and the box casts a shadow into itself and darkens the corners where the ball nearly touches.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** (w comes from an LFO outside, through a port) → **Rotate 4D** (xw) → a **Hypersphere SDF**, and two **Tesseract SDF**s subtracted to make a shell; a plane trims the shell open; Union joins the two. An Expression Block outside tells ball from shell by distance from the middle, using the same w. Soft Shadow and SDF Ambient Occlusion measure the Scene Group with the same w.

**Try.** **Turn** and **Cut height** are Play knobs set directly on nodes inside the Scene Group (Rotate 4D and the plane), no wiring needed. Raise **Sweep** to 0.6 to take the slice all the way to the ball's edge, where it vanishes. Set it to 0 and the slice stays through the middle. **Turn** changes the box only: the sphere looks the same however you turn it in 4D.`),
  };

  // ── 3. All three slice directions ─────────────────────────────────────────
  const lifts: Array<{ dir: 'face' | 'edge' | 'corner'; key: string; x: number; y: number; word: string }> = [
    { dir: 'face', key: 'a', x: -2.5, y: 80, word: 'Face-first: the cut is parallel to one of the tesseract\'s cubic cells (normal along w). It is a cube whose size does not change until W passes the half size, 0.5, where it vanishes at once.' },
    { dir: 'edge', key: 'b', x: 0, y: 380, word: 'Edge-first: the cut\'s normal is (0,0,1,1)/√2, so it meets an edge of the tesseract first. A rectangular box, longer than a cube, that shortens as W grows and is gone at W = 0.707 (half size x √2).' },
    { dir: 'corner', key: 'c', x: 2.5, y: 680, word: 'Corner-first: the normal is (1,1,1,1)/2. A point at W = 1.0, then a tetrahedron, a truncated tetrahedron, and an octahedron at W = 0.' },
  ];
  const shapeNodes: GraphNode[] = lifts.flatMap(l => [
    n('translate3D', `mv_${l.key}`, 240, l.y, { tx: l.x, ...note(`Translate 3D: moves this tesseract to x = ${l.x} so the three sit in a row. Subtracting the offset from the point moves the shape the other way, as every Translate does.`) }, { pos: ['sp', 'pos'] }),
    n('lift4D', `lift_${l.key}`, 520, l.y, { sliceDir: l.dir, ...note(`Lift to 4D, ${l.dir}-first. ${l.word} All three read the same W through the same port.`) }, { pos: [`mv_${l.key}`, 'pos'] }),
    n('tesseractSDF', `ts_${l.key}`, 800, l.y, { size: 0.5, rounding: 0.02, ...note(`Tesseract SDF: the same tesseract (half size 0.5) for all three, so the only difference between them is the way the slice is cut.`) }, { p4: [`lift_${l.key}`, 'p4'] }),
  ]);
  const three: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDThreeSlices,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit and the slice sweep.') }),
      n('lfo', 'sweep', 40, 640, { waveform: 'sine', freq: 0.06, amplitude: 0.9, offset: 0, ...note('LFO (sine): one slice position W for all three, about once every 17 seconds, between -0.9 and 0.9. The face-first cube is only there while |W| is under 0.5, the edge-first prism under 0.71 and the corner-first shape under 1.0. Amplitude is the Play knob Sweep; Offset is the knob Centre.') }, { time: ['time', 'time'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 8.8, camAngle: 3.2, camElevation: 0.45, rotSpeed: 0.0, fov: 1.5, ...note('March Camera: pulled back to see all three in a row. It does not orbit on its own (Rot Speed 0); Camera angle is a Play knob.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Three slices', [
        ...shapeNodes,
        n('sdfUnion', 'u1', 1080, 200, { k: 0, ...note('Union: the face-first and edge-first shapes, whichever is nearer.') }, { a: ['ts_a', 'dist'], b: ['ts_b', 'dist'] }),
        n('sdfUnion', 'u2', 1260, 300, { k: 0, ...note('Union: adds the corner-first shape.') }, { a: ['u1', 'dist'], b: ['ts_c', 'dist'] }),
        n('planeSDF3D', 'floor', 1260, 560, { height: -1.15, ...note('A floor at y = -1.15, below the largest octahedron, to catch the three shadows.') }, { p: ['sp', 'pos'] }),
        n('sdfUnion', 'un', 1480, 380, { k: 0, ...note('Union: the shapes or the floor, whichever is nearer.') }, { a: ['u2', 'dist'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'Three tesseracts in a row, each with its own Lift to 4D cutting a different way, all reading the same W through one port. The difference you see is only the direction of the cut.',
      [{ key: 'w', label: 'W (slice)', from: ['sweep', 'value'], to: ['lift_a', 'w'] }, { key: 'w2', label: 'W (edge)', from: ['sweep', 'value'], to: ['lift_b', 'w'] }, { key: 'w3', label: 'W (corner)', from: ['sweep', 'value'], to: ['lift_c', 'w'] }]),
      ...finish([0.05, 0.055, 0.1],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'y < -1.14 ? vec3(0.16, 0.18, 0.28) + vec3(0.1, 0.11, 0.14) * mod(floor(x * 2.0) + floor(z * 2.0), 2.0) : x < -1.25 ? vec3(0.35, 0.65, 0.95) + vec3(0.2, 0.2, 0.05) * clamp(0.5 + 0.5 * y, 0.0, 1.0) : x < 1.25 ? vec3(0.45, 0.85, 0.5) + vec3(0.3, 0.1, 0.1) * clamp(0.5 + 0.5 * y, 0.0, 1.0) : vec3(0.95, 0.4, 0.3) + vec3(0.05, 0.4, 0.05) * clamp(0.5 + 0.45 * (x + y + z) / 3.0, 0.0, 1.0)',
          'Surface colour by where the ray landed: the floor is a dark checker, and the three shapes get a colour each by which third of the picture they are in (face-first blue on the left, edge-first green in the middle, corner-first coral on the right).'),
        'March Loop: finds, for each pixel, where the ray meets the scene and the surface direction there.'),
    ],
    play: play([
      ctl('sweep', 'sweep::amplitude', 'Sweep (w range)', 0, 1.1, 0.01),
      ctl('centre', 'sweep::offset', 'Centre (w)', -1.1, 1.1, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** The same tesseract cut three ways at the same instant. **Left, face-first**: the cut is parallel to one of the cubic cells, so you see a plain cube until w passes the half size and the cube is gone. **Middle, edge-first**: the cut leans toward the edges (normal along (0,0,1,1)), so it is a box, longer than a cube, that shortens over a longer range of w. **Right, corner-first**: the cut leans along (1,1,1,1) so it starts at a point, becomes a tetrahedron, then an octahedron at w = 0 and back. Each is a different 3D picture of one and the same 4D object.

**How it is built.** One Scene Group holds all three: Scene Pos → **Translate 3D** (to its place in the row) → **Lift to 4D** (Slice direction Face-, Edge- or Corner-first) → **Tesseract SDF**, then the three joined by Unions with a floor. One LFO outside feeds all three Lift to 4D through ports, so they always share w. Shadows and occlusion measure the whole group.

**Try.** Set **Sweep** to 0 and move **Centre** from 0 to 1: the cube disappears at 0.5, the prism at 0.71 and the corner-first shape last, at 1.0. At Centre 0 compare the three: a cube, a longer box, and a regular octahedron. Open the group and try the **Custom** direction on one of the Lift to 4D nodes.`),
  };

  return { fourDTesseractSlice: slice, fourDHypersphereInTesseract: inside, fourDThreeSlices: three, ...buildFourDShapeExamples() };
}

// ═══ Phase 2 examples: the new shapes and transforms ═══════════════════════════

/** The floor's dark checker for a floor at height `h`: the Expression Block's first branch (hit points within 0.01 of the floor). */
const checker = (h: number) => `y < ${(h + 0.01).toFixed(2)} ? vec3(0.16, 0.18, 0.28) + vec3(0.1, 0.11, 0.14) * mod(floor(x * 2.0) + floor(z * 2.0), 2.0) : `;

export function buildFourDShapeExamples(): Record<string, ExampleGraph> {
  const floorNode = (id: string, h: number, text: string) => n('planeSDF3D', id, 520, 360, { height: h, ...note(text) }, { p: ['sp', 'pos'] });

  // ── Duocylinder dance ─────────────────────────────────────────────────────
  const dance: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDDuocylinderDance,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit.') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 4.0, camAngle: 0.6, camElevation: 0.4, rotSpeed: 0.08, fov: 1.5, ...note('March Camera: slowly circles the middle. Only the camera moves in 3D; the shape changes because it turns in 4D.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Duocylinder', [
        n('lift4D', 'lift', 240, 80, { w: 0.0, ...note('Lift to 4D, face-first, W = 0: the slice goes through the middle. Its W is a Play knob (Slice) set straight on this node.') }, { pos: ['sp', 'pos'] }),
        n('rotate4D', 'rot1', 480, 80, { plane: 'xw', angle: 0, spin: 24, ...note('Rotate 4D in the xw plane, 24 degrees a second: x swaps with w, so the slice crosses a different part of the duocylinder every moment and the cylinder tilts and stretches. Spin is a Play knob.') }, { p4: ['lift', 'p4'] }),
        n('rotate4D', 'rot2', 720, 80, { plane: 'yz', angle: 0, spin: 17, ...note('Rotate 4D again, in the yz plane: an ordinary 3D turn (y toward z) that rolls the shape in view. Two turns at different speeds never repeat quickly: this is the dance.') }, { p4: ['rot1', 'p4'] }),
        n('duocylinderSDF', 'dc', 960, 80, { r1: 0.68, r2: 0.56, ...note('Duocylinder SDF: a disc of radius 0.68 in the xy plane times a disc of radius 0.56 in the zw plane: max(length(p.xy) - 0.68, length(p.zw) - 0.56), an exact distance. At rest its slice is a fat cylinder along z; turned, it breathes. Radius xy is a Play knob.') }, { p4: ['rot2', 'p4'] }),
        floorNode('floor', -1.0, 'A floor at y = -1.0, just below the largest the shape gets (its reach is the square root of both radii squared, about 0.88), so the shadow has somewhere to land.'),
        n('sdfUnion', 'un', 1240, 200, { k: 0, ...note('Union: the scene is the nearer of the duocylinder and the floor.') }, { a: ['dc', 'dist'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'Scene Pos is lifted to 4D, turned in two planes and measured against a duocylinder. Everything outside (camera, march loop, shadows) is an ordinary 3D scene.'),
      ...finish([0.05, 0.055, 0.1],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          checker(-1.0) + 'vec3(0.2, 0.62, 0.95) + vec3(0.75, -0.1, -0.5) * clamp(0.5 + 0.55 * (x - z + 0.5 * y), 0.0, 1.0)',
          'Surface colour from where the ray landed: a dark checker on the floor, and a blue-to-coral slide across the shape so its changing facets read.'),
        'March Loop: finds where each ray meets the scene and the surface direction there; Soft Shadow and Ambient Occlusion measure the same group.'),
    ],
    play: play([
      ctl('s1', 'scene::rot1::spin', 'xw turn (deg/s)', -90, 90, 0.5),
      ctl('s2', 'scene::rot2::spin', 'yz turn (deg/s)', -90, 90, 0.5),
      ctl('w', 'scene::lift::w', 'Slice (w)', -0.7, 0.7, 0.01),
      ctl('r', 'scene::dc::r1', 'Radius xy', 0.3, 0.9, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A duocylinder is the product of two circles: one in the xy plane, one in the zw plane, so it is round in two separate ways. Its 3D slice at rest is a cylinder, but it is turned in two planes at once. The **xw** turn swaps x with the fourth direction, so the cylinder stretches and shortens as different parts of the shape pass through the slice. The **yz** turn is an ordinary roll. Together they make the shape tumble and breathe without end.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** → **Rotate 4D** (xw) → **Rotate 4D** (yz) → **Duocylinder SDF** → Union with a floor → Scene Output. The camera, march loop, shadows and lighting outside know nothing about the fourth dimension.

**Try.** Set both turn speeds to 0 and slide **Slice**: the cylinder shortens and vanishes at the zw radius (0.56). Turn only **xw**, then only **yz**, to see which motion is the 4D one. Change **Radius xy** to fatten or thin the cylinder.`),
  };

  // ── The 24-cell ───────────────────────────────────────────────────────────
  const cell24: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourD24Cell,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit and the slice sweep.') }),
      n('lfo', 'sweep', 40, 640, { waveform: 'sine', freq: 0.06, amplitude: 0.66, offset: 0, ...note('LFO (sine): the slice position W, sweeping between -0.66 and 0.66 about once every 17 seconds. The cut first touches the 24-cell at W = 0.67 (radius 0.95 divided by √2). Amplitude is the Play knob Sweep and Offset is Centre.') }, { time: ['time', 'time'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 4.0, camAngle: 0.9, camElevation: 0.4, rotSpeed: 0.1, fov: 1.5, ...note('March Camera: slowly circles the middle.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, '24-cell', [
        n('lift4D', 'lift', 240, 80, { sliceDir: 'corner', ...note('Lift to 4D, Corner-first: the cut\'s normal is (1,1,1,1)/2. W arrives through the port from the LFO outside. (1,1,1,1) is the direction of one of the 24-cell\'s own octahedral cells, so the cut lies flat against that cell first: a whole octahedron appears at once, rather than a point.') }, { pos: ['sp', 'pos'] }),
        n('cell24SDF', 'cell', 520, 80, { radius: 0.95, ...note('24-Cell SDF: 24 octahedral cells meeting around each corner, with no 3D counterpart. A BOUND (exact inside, never over the true distance outside), so marching is safe. Radius is the distance to a corner; it is a Play knob that reaches in here.') }, { p4: ['lift', 'p4'] }),
        floorNode('floor', -1.1, 'A floor at y = -1.1, below the widest slice, to catch the shadow.'),
        n('sdfUnion', 'un', 820, 200, { k: 0, ...note('Union: the scene is the nearer of the slice and the floor.') }, { a: ['cell', 'dist'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'Scene Pos is lifted to 4D along a corner-first slice and measured against a 24-cell. W comes in through a port from the LFO outside.',
      [{ key: 'w', label: 'W (slice)', from: ['sweep', 'value'], to: ['lift', 'w'] }]),
      ...finish([0.05, 0.05, 0.1],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          checker(-1.1) + 'vec3(0.95, 0.62, 0.2) + vec3(-0.5, -0.12, 0.7) * clamp(0.5 + 0.5 * (x + y + z) / 1.2, 0.0, 1.0)',
          'Surface colour from where the ray landed: a dark checker on the floor, and a gold-to-violet slide along the diagonal so the flat faces read.'),
        'March Loop: finds where each ray meets the scene and the surface direction there.'),
    ],
    play: play([
      ctl('sweep', 'sweep::amplitude', 'Sweep (w range)', 0, 0.7, 0.01),
      ctl('centre', 'sweep::offset', 'Centre (w)', -0.7, 0.7, 0.01),
      ctl('rad', 'scene::cell::radius', '24-cell radius', 0.4, 1.0, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** The 24-cell is a shape with no 3D relative: twenty-four octahedra fit together around every corner, and it is its own dual. Cut **corner-first** (along (1,1,1,1), which happens to be the direction of one of the 24-cell's own cells), the slice begins as a whole **octahedron**, has its six corners cut off into squares, becomes a **truncated octahedron** (hexagons and squares) at the middle, then shrinks back the same way on the other side.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** (Corner-first) → **24-Cell SDF** → Union with a floor. An LFO outside sweeps W through a port.

**Try.** Set **Sweep** to 0 and slide **Centre**: at ±0.67 you get a small octahedron, at about 0.4 one with its corners cut, at 0 the truncated octahedron. Change the Slice direction on Lift to 4D to Face-first or Edge-first to see other sections of the same shape. **24-cell radius** scales the whole shape; the sweep range should stay under 0.7 times it.`),
  };

  // ── Clifford torus ────────────────────────────────────────────────────────
  const clifford: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDCliffordTorus,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit.') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 4.0, camAngle: 0.5, camElevation: 0.45, rotSpeed: 0.08, fov: 1.5, ...note('March Camera: slowly circles the middle.') }, { time: ['time', 'time'] }),
      n('constant', 'wob', 40, 760, { value: 0.035, ...note('A number: how far the noise pushes the surface in and out (the Play knob Wobble). 0 gives the smooth torus.') }),
      scene('scene', 40, 860, 'Clifford torus', [
        n('lift4D', 'lift', 240, 80, { w: 0.0, ...note('Lift to 4D, face-first. W is a Play knob (Slice): the cut moves through the torus.') }, { pos: ['sp', 'pos'] }),
        n('rotate4D', 'rot1', 480, 80, { plane: 'xw', angle: 0, spin: 9, ...note('Rotate 4D in xw, slowly (9 degrees a second): which part of the torus meets the slice changes, and the 3D shape drifts between a pair of rings and a fat torus.') }, { p4: ['lift', 'p4'] }),
        n('rotate4D', 'rot2', 720, 80, { plane: 'yw', angle: 0, spin: 6, ...note('A second, slower turn in yw so the motion does not repeat soon.') }, { p4: ['rot1', 'p4'] }),
        n('cliffordTorusSDF', 'ct', 960, 80, { radius: 0.9, thickness: 0.17, balance: 45, ...note('Clifford Torus SDF: a thickened torus lying on a 3-sphere of radius 0.9, made of two equal circles (radius 0.9 / √2) in the xy and zw planes. Balance 45 is the true Clifford torus; other angles give the other tori on the sphere. An exact distance.') }, { p4: ['rot2', 'p4'] }),
        n('noise4D', 'nz', 960, 280, { scale: 3.0, octaves: '2', gain: 0.5, ...note('Noise 4D at the turned 4D point: because the point turns in 4D, the noise slides through the shape, so the roughness crawls over the surface instead of sitting on it.') }, { p4: ['rot2', 'p4'] }),
        n('multiply', 'amp', 1240, 280, { b: 1.0, ...note('Multiply: the signed noise (-1 to 1) times the Wobble amount.') }, { a: ['nz', 'signed'], b: ['wob', 'value'] }),
        n('add', 'bump', 1460, 160, { b: 0.0, ...note('Add: the torus distance plus the noise. Pushing the distance up or down moves the surface out or in. The wobble is small, so the distance stays safe to march.') }, { a: ['ct', 'dist'], b: ['amp', 'result'] }),
        floorNode('floor', -1.0, 'A floor at y = -1.0 for the shadow.'),
        n('sdfUnion', 'un', 1660, 220, { k: 0, ...note('Union: the scene is the nearer of the torus and the floor.') }, { a: ['bump', 'result'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'Scene Pos is lifted to 4D, turned in two planes, measured against a Clifford torus and roughened with 4D noise. The Wobble amount comes in through a port.',
      [{ key: 'wob', label: 'Wobble', from: ['wob', 'value'], to: ['amp', 'b'] }]),
      ...finish([0.05, 0.05, 0.095],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          checker(-1.0) + 'vec3(0.9, 0.35, 0.55) + vec3(-0.6, 0.45, 0.3) * clamp(0.5 + 0.5 * sin(3.0 * (x + 1.3 * y - z)), 0.0, 1.0)',
          'Surface colour from where the ray landed: a dark checker on the floor, and soft bands of rose and teal across the torus so the turning reads.'),
        'March Loop: finds where each ray meets the scene and the surface direction there.', 1700),
    ],
    play: play([
      ctl('w', 'scene::lift::w', 'Slice (w)', -0.9, 0.9, 0.01),
      ctl('s1', 'scene::rot1::spin', 'xw turn (deg/s)', -60, 60, 0.5),
      ctl('s2', 'scene::rot2::spin', 'yw turn (deg/s)', -60, 60, 0.5),
      ctl('b', 'scene::ct::balance', 'Balance (deg)', 10, 80, 0.5),
      ctl('wob', 'wob::value', 'Wobble', 0, 0.12, 0.002),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** The Clifford torus is a flat torus that lies on the surface of a 4D sphere: a circle in the xy plane times a circle in the zw plane, both the same size. Seen through a 3D slice it is a pair of linked rings, a fat torus, or an oval, depending on where the slice cuts and how the shape is turned. Slow turns in **xw** and **yw** carry the slice through all of those.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** → **Rotate 4D** (xw) → **Rotate 4D** (yw) → **Clifford Torus SDF**, plus a little **Noise 4D** on the same turned point added to the distance, then a floor.

**Try.** Slide **Slice** to move the cut. **Balance** away from 45 makes one circle bigger than the other: the shape moves from the Clifford torus toward an ordinary ring. **Wobble** 0 gives the smooth surface; raise it to see the noise travel through the shape.`),
  };

  // ── 4D lattice ────────────────────────────────────────────────────────────
  const lattice: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDLattice,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the camera orbit.') }),
      n('marchCamera', 'cam', 40, 220, { camDist: 6.0, camAngle: 0.7, camElevation: 0.5, rotSpeed: 0.07, fov: 1.5, ...note('March Camera: pulled back and slowly circling, to take in the whole lattice.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, '4D lattice', [
        n('lift4D', 'lift', 240, 80, { w: 0.0, ...note('Lift to 4D, face-first. W is a Play knob (Slice).') }, { pos: ['sp', 'pos'] }),
        n('rotate4D', 'rot', 480, 80, { plane: 'xw', angle: 0, spin: 12, ...note('Rotate 4D in xw, 12 degrees a second, BEFORE the repeat: the whole lattice turns, so the slice cuts the rows of spheres at a changing slant.') }, { p4: ['lift', 'p4'] }),
        n('repeat4D', 'rep', 720, 80, { cellX: 1.2, cellY: 1.2, cellZ: 1.2, cellW: 1.2, limit: 1, ...note('Repeat 4D: a lattice with cells 1.2 across in all four directions, with one extra copy on each side of the middle (Count limit 1): 3 x 3 x 3 x 3 = 81 hyperspheres. Cell size is a Play knob.') }, { p4: ['rot', 'p4'] }),
        n('hypersphereSDF', 'ball', 960, 80, { radius: 0.4, ...note('Hypersphere SDF: a 4D ball of radius 0.4 in each cell. Its slice is a 3D ball of radius √(0.4² − w²) where w is how far the slice sits from the ball\'s centre; as the lattice turns, each copy is cut nearer to or further from its centre, so the balls swell and shrink out of step. Radius is a Play knob.') }, { p4: ['rep', 'p4'] }),
        floorNode('floor', -2.2, 'A floor at y = -2.2, below the lattice, for shadows.'),
        n('sdfUnion', 'un', 1240, 200, { k: 0, ...note('Union: the scene is the nearer of the lattice and the floor.') }, { a: ['ball', 'dist'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'Scene Pos is lifted to 4D, turned, repeated on a 4D lattice and measured against a hypersphere: a lattice of balls whose 3D slice morphs as the lattice turns.'),
      ...finish([0.045, 0.05, 0.095],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          'y < -2.19 ? vec3(0.16, 0.18, 0.28) + vec3(0.1, 0.11, 0.14) * mod(floor(x * 1.5) + floor(z * 1.5), 2.0) : vec3(0.3, 0.7, 0.95) + vec3(0.65, -0.2, -0.55) * clamp(0.5 + 0.28 * (x + z) + 0.15 * y, 0.0, 1.0)',
          'Surface colour from where the ray landed: a dark checker on the floor, and a blue-to-coral slide across the lattice so depth reads.'),
        'March Loop: finds where each ray meets the scene and the surface direction there.'),
    ],
    play: play([
      ctl('s', 'scene::rot::spin', 'xw turn (deg/s)', -90, 90, 0.5),
      ctl('w', 'scene::lift::w', 'Slice (w)', -0.6, 0.6, 0.01),
      ctl('r', 'scene::ball::radius', 'Ball radius', 0.15, 0.58, 0.01),
      ctl('cell', 'scene::rep::cellX', 'Cell size (x)', 0.8, 2.0, 0.01),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
    ], `**What it shows.** A lattice of hyperspheres, spaced evenly in all four directions, seen through a 3D slice. A hypersphere's slice is always a ball, but its size depends on how far the slice is from the ball's centre. Turn the lattice in the **xw** plane and every copy is cut at a different distance, so a regular grid of equal balls becomes balls that swell, shrink and vanish in waves.

**How it is built.** Inside the Scene Group: Scene Pos → **Lift to 4D** → **Rotate 4D** (xw) → **Repeat 4D** → **Hypersphere SDF** → Union with a floor. The turn comes before the repeat, so the lattice turns as a whole.

**Try.** Set **xw turn** to 0 and the slice is a plain 3 x 3 x 3 grid of equal balls; turn it on and watch them morph. **Slice** moves the cut through the lattice; **Ball radius** above half the cell makes the balls merge. **Cell size (x)** changes the spacing in x only.`),
  };

  // ── Gallery ───────────────────────────────────────────────────────────────
  const gal: Array<{ type: string; key: string; label: string; params: Record<string, unknown>; words: string }> = [
    { type: 'duocylinderSDF', key: 'duo', label: 'Duocylinder', params: { r1: 0.62, r2: 0.5 }, words: 'two discs multiplied: a cylinder that shortens' },
    { type: 'spherinderSDF', key: 'sph', label: 'Spherinder', params: { radius: 0.5, halfHeight: 0.45 }, words: 'a ball stretched along w' },
    { type: 'cubinderSDF', key: 'cub', label: 'Cubinder', params: { half: 0.45, radius: 0.55 }, words: 'a square times a disc' },
    { type: 'cylPrismSDF', key: 'cyp', label: 'Cylindrical prism', params: { radius: 0.4, halfZ: 0.55, halfW: 0.35 }, words: 'a cylinder extended along w' },
    { type: 'ditorusSDF', key: 'dit', label: 'Ditorus', params: { R1: 0.6, R2: 0.45, r: 0.16 }, words: 'two circles thickened: the "tiger" torus' },
    { type: 'cell5SDF', key: 'c5', label: '5-cell', params: { radius: 0.95 }, words: 'the 4D simplex (a bound)' },
    { type: 'cell16SDF', key: 'c16', label: '16-cell', params: { radius: 0.95 }, words: 'the 4D cross-polytope (a bound)' },
    { type: 'cell24SDF', key: 'c24', label: '24-cell', params: { radius: 0.95 }, words: 'twenty-four octahedra (a bound)' },
    { type: 'tesseractSDF', key: 'tes', label: 'Tesseract', params: { size: 0.5, rounding: 0.03 }, words: 'the 4D cube' },
    { type: 'cliffordTorusSDF', key: 'cli', label: 'Clifford torus', params: { radius: 0.85, thickness: 0.15, balance: 45 }, words: 'a flat torus on a 3-sphere' },
  ];
  const xs = [-4, -2, 0, 2, 4];
  const slot = (i: number) => ({ x: xs[i % 5], z: i < 5 ? -1.4 : 1.4 });
  const galleryShapes: GraphNode[] = gal.flatMap((g, i) => {
    const { x, z } = slot(i), y = 40 + i * 190;
    return [
      n('translate3D', `mv_${g.key}`, 240, y, { tx: x, tz: z, ...note(`Translate 3D: moves the ${g.label} to x = ${x}, z = ${z} so the ten sit in two rows.`) }, { pos: ['sp', 'pos'] }),
      n('lift4D', `lift_${g.key}`, 480, y, { w: 0.0, ...note(`Lift to 4D, face-first, W = 0: the slice goes through the middle of the ${g.label}.`) }, { pos: [`mv_${g.key}`, 'pos'] }),
      n('rotate4D', `rot_${g.key}`, 720, y, { plane: 'xw', angle: i * 20, spin: 0, ...note(`Rotate 4D in xw: one shared angle comes in through a port from the outside (plus a different head start, ${i * 20} degrees, for each shape), so all ten turn together but are at different stages.`) }, { p4: [`lift_${g.key}`, 'p4'] }),
      n(g.type, `sh_${g.key}`, 960, y, { ...g.params, ...note(`${getNodeDefinition(g.type)?.label ?? g.type}: ${g.words}.`) }, { p4: [`rot_${g.key}`, 'p4'] }),
    ];
  });
  const unions: GraphNode[] = gal.slice(1).map((g, i) => n('sdfUnion', `u${i}`, 1240 + i * 20, 80 + i * 190, { k: 0, ...note(i === 0 ? 'Union: the first two shapes, whichever is nearer.' : `Union: adds the ${g.label}.`) },
    { a: [i === 0 ? `sh_${gal[0].key}` : `u${i - 1}`, i === 0 ? 'dist' : 'dist'], b: [`sh_${g.key}`, 'dist'] }));
  const gallery: ExampleGraph = {
    ...FOURD_EXAMPLE_INDEX.fourDShapeGallery,
    counter: 60,
    nodes: [
      n('time', 'time', 40, 460, { ...note('Time: drives the turn.') }),
      n('multiply', 'turn', 40, 640, { b: 20, ...note('Multiply: time times the Play knob Turn speed = a turn angle in degrees, shared by all ten shapes.') }, { a: ['time', 'time'] }),
      n('marchCamera', 'cam', 40, 220, { camDist: 8.6, camAngle: 3.14, camElevation: 0.55, rotSpeed: 0.0, fov: 1.5, ...note('March Camera: pulled back to see two rows of five. It does not orbit on its own (Rot Speed 0); Camera angle is a Play knob.') }, { time: ['time', 'time'] }),
      scene('scene', 40, 860, 'Gallery', [
        ...galleryShapes, ...unions,
        floorNode('floor', -1.15, 'A floor at y = -1.15 for the shadows.'),
        n('sdfUnion', 'un', 1500, 400, { k: 0, ...note('Union: all the shapes or the floor, whichever is nearer.') }, { a: ['u8', 'dist'], b: ['floor', 'dist'] }),
      ], ['un', 'dist'],
      'Ten 4D shapes, each lifted, turned by the same angle and measured, then joined. The same angle comes in through ten ports.',
      gal.map(g => ({ key: `a_${g.key}`, label: `Angle (${g.label})`, from: ['turn', 'result'] as Wire, to: [`rot_${g.key}`, 'angle'] as [string, string] }))),
      ...finish([0.05, 0.055, 0.1],
        expr('col', 1180, 520, 'Surface colour', { x: ['hp', 'x'], y: ['hp', 'y'], z: ['hp', 'z'] },
          checker(-1.15) + 'vec3(0.55) + 0.42 * cos(6.2832 * ((floor((x + 5.0) / 2.0) + (z > 0.0 ? 5.0 : 0.0)) * 0.1 + vec3(0.0, 0.33, 0.67)))',
          'Surface colour from where the ray landed: a dark checker on the floor, and a different colour for each of the ten places so every shape is easy to tell apart.'),
        'March Loop: finds where each ray meets the scene and the surface direction there. The shapes marked "a bound" take a few more steps near their corners.', 1700),
    ],
    play: play([
      ctl('turn', 'turn::b', 'Turn speed (deg/s)', -90, 90, 0.5),
      ctl('c', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
      ctl('e', 'cam::camElevation', 'Camera height', 0.1, 1.2, 0.01),
    ], `**What it shows.** Every 4D shape of this folder, side by side, each seen as a 3D slice through its middle, turning in the **xw** plane. Near row: duocylinder, spherinder, cubinder, cylindrical prism, ditorus. Far row: 5-cell, 16-cell, 24-cell, tesseract, Clifford torus. A shape that is the same all round in 3D can change its slice completely when it turns in 4D.

**How it is built.** One Scene Group holds ten copies of Scene Pos → **Translate 3D** → **Lift to 4D** → **Rotate 4D** (xw) → a shape, joined by Unions. A Multiply node outside makes one angle from Time and the Turn speed knob, and ten ports bring it in. The 5-cell, 16-cell and 24-cell are bounds (never over the true distance), the rest are exact.

**Try.** Set **Turn speed** to 0: each shape shows its rest slice. Then drag it up slowly and watch which shapes change most. **Camera angle** goes round to the other side, where the rows swap places.`),
  };

  return { fourDDuocylinderDance: dance, fourD24Cell: cell24, fourDCliffordTorus: clifford, fourDLattice: lattice, fourDShapeGallery: gallery };
}
