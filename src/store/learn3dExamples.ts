/**
 * learn3dExamples.ts — the Learn 3D folder: ray marching as a short course,
 * one idea per graph, in the order you would learn it (camera, distance,
 * the march, light, shapes, a moving camera, volumes, GI). Each graph is
 * kept small so it can be shown on its own, and each has Play notes (what
 * it shows, how it is built, what to try) and 1–3 Play sliders.
 *
 * Built from the node definitions (graphBuilder.ts) like the Learn folder,
 * so a lesson can't drift from the nodes it teaches. The examples test
 * compiles every one and checks its Play controls point at live params.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import type { PlayControl } from '../types/play';
import { ctl, colourCtl, n, out, play, time, uv } from './graphBuilder';
import type { ExampleGraph } from './exampleIndex';
import { LEARN3D_EXAMPLE_INDEX } from './learn3dExampleIndex';
import { volumetricOn } from '../nodes/volumetricAuto';

// ── Small helpers ───────────────────────────────────────────────────────────

type Wire = [fromId: string, outputKey: string];

/** A node comment (shown on the card's Comment tab and in the generated code). */
const note = (text: string) => ({ __comment: text });

const BG: [number, number, number] = [0.04, 0.045, 0.07];

const sub = (nodes: GraphNode[]): SubgraphData => ({ nodes, inputPorts: [], outputPorts: [] });

/** A Scene Group: Scene Pos → `shapes` → Scene Output, with `dist` the wire into Scene Output. */
function scene(id: string, x: number, y: number, label: string, shapes: GraphNode[], dist: Wire, comment: string, port?: ScenePort): GraphNode {
  const group = n('sceneGroup', id, x, y, {
    label, ...note(comment),
    subgraph: {
      ...sub([
        n('scenePos', 'sp', 0, 200, { _groupOriginal: true }),
        ...shapes,
        n('sceneOutput', 'so', 1100, 200, { _groupOriginal: true }, { dist }),
      ]),
      inputPorts: port ? [{ key: port.key, type: 'float', label: port.label, toNodeId: port.to[0], toInputKey: port.to[1] }] : [],
    },
  });
  if (port) group.inputs = { ...group.inputs, [port.key]: { type: 'float', label: port.label, connection: { nodeId: port.from[0], outputKey: port.from[1] } } };
  return group;
}

/**
 * A float carried into a Scene Group through a port. Params inside a Scene
 * Group or a march loop are baked into the shader, so Play can't reach them;
 * a Constant outside, wired in, is a live slider.
 */
type ScenePort = { key: string; label: string; from: Wire; to: [nodeId: string, inputKey: string] };

/** The body every plain loop starts with: Group Inputs → March Pos → Group Output, nothing warped. */
function passBody(prefix: string): SubgraphData {
  return sub([
    n('marchLoopInputs', `${prefix}_in`, 0, 180, { _groupOriginal: true }),
    n('marchLoopOutput', `${prefix}_out`, 440, 180, { _groupOriginal: true }, { pos: [`${prefix}_in`, 'marchPos'] }),
  ]);
}

/** A March Loop Group (or GI Lit March Group) wired to camera `cam` and scene `sc`. */
function loop(type: 'marchLoopGroup' | 'giLitMarchGroup', id: string, x: number, y: number, params: Record<string, unknown>, body = passBody(id)): GraphNode {
  return n(type, id, x, y, { ...params, subgraph: body }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] });
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

/** Left half of the screen shows `left`, right half `right`: UV x > 0 picks. */
function splitScreen(left: Wire, right: Wire, x: number, y: number): GraphNode[] {
  return [
    n('splitVec2', 'half', x, y + 260, {}, { v: ['uv', 'uv'] }),
    n('compare', 'right', x + 220, y + 260, { operator: '>', smoothing: 0.002 }, { a: ['half', 'x'] }),
    n('select', 'pick', x + 460, y, { outputType: 'vec3', ...note('Mask 1 (the right half) shows If True, the rest If False.') },
      { mask: ['right', 'mask'], ifTrue: right, ifFalse: left }),
  ];
}

// ── Lessons ─────────────────────────────────────────────────────────────────

type Lesson = { key: string; nodes: GraphNode[]; controls: PlayControl[]; notes: string };
const L: Lesson[] = [];
const lesson = (key: string, nodes: GraphNode[], controls: PlayControl[], notes: string) => L.push({ key, nodes, controls, notes });

const CAM = { camDist: 3.0, camAngle: 0.6, camElevation: 0.3, rotSpeed: 0, fov: 1.5 };

lesson('learn3dCamera', [
  uv(40, 220),
  n('marchCamera', 'cam', 280, 220, { ...CAM, ...note('Each pixel\'s UV becomes a direction: straight ahead in the middle of the screen, tilted toward the edges. Ray Origin is the camera\'s position, the same for every pixel.') }, { uv: ['uv', 'uv'] }),
  n('normalToColor', 'dir', 560, 220, {}, { v: ['cam', 'rd'] }),
  out(['dir', 'color'], 800),
], [
  ctl('a', 'cam::camAngle', 'Angle', 0, 6.28, 0.02),
  ctl('e', 'cam::camElevation', 'Elevation', -1.5, 1.5, 0.02),
  ctl('f', 'cam::fov', 'Lens (FOV)', 0.5, 3, 0.05),
], `**What it shows.** A ray marcher draws 3D with no triangles: for every pixel it sends out a ray, a line with a start point and a direction, and asks what that line runs into. **March Camera** makes those rays. **Ray Origin** is where the camera sits, the same point for every pixel. **Ray Dir** is where this pixel's ray points: straight ahead in the middle of the screen, fanning out toward the edges. Here Ray Dir is painted as colour, so you are looking at the fan of rays itself.

**How it is built.** UV → March Camera → Ray Dir → Normal to Color → Output. A direction is three numbers from −1 to 1 (x, y, z); Normal to Color moves them to 0…1 so they show as red, green and blue. More red means the ray points toward +x, more green means up, more blue toward +z. There is no scene yet: nothing is hit, nothing is drawn but the directions.

**Try.** Move **Angle**: the camera swings around the centre and every ray turns with it, so the colours slide. **Elevation** lifts the camera up and over: looking down from above, the rays point downward and the green drains out. **Lens (FOV)** is how far the screen sits in front of the camera: raise it and the rays bunch toward the middle (a zoom), lower it for a wide angle. Then wire Ray Origin into Normal to Color instead: one flat colour, because every ray starts at the same point.`);

lesson('learn3dDistance', [
  uv(40, 220),
  n('splitVec2', 'split', 240, 220, {}, { v: ['uv', 'uv'] }),
  n('makeVec3', 'pt', 460, 220, { b: 0, ...note('The 3D point being measured: x and y come from the screen, z is the Slice depth. The whole screen is a flat sheet through 3D space.') }, { r: ['split', 'x'], g: ['split', 'y'] }),
  n('sphereSDF3D', 'sph', 700, 220, { radius: 0.5, ...note('The same Sphere SDF 3D you put inside a Scene Group. It returns one number per point: how far that point is from the sphere\'s surface.') }, { pos: ['pt', 'rgb'] }),
  expr('view', 960, 220, 'Distance view', { d: ['sph', 'dist'] },
    'mix(mix(vec3(0.35, 0.6, 0.95), vec3(0.95, 0.6, 0.3), step(0.0, d)) * (1.0 - exp(-4.0 * abs(d))) * (0.8 + 0.2 * cos(60.0 * d)), vec3(1.0), 1.0 - smoothstep(0.0, 0.015, abs(d)))',
    'A way of looking at a distance: orange where it is positive (outside), blue where negative (inside), darker near 0, a band every 0.1 units and white where it is exactly 0 (the surface).'),
  out(['view', 'result'], 1220),
], [
  ctl('z', 'pt::b', 'Slice depth (z)', -0.8, 0.8, 0.01),
  ctl('r', 'sph::radius', 'Radius', 0.1, 0.9, 0.01),
], `**What it shows.** In a ray marcher a shape is not a mesh, it is a function: give it any point in 3D and it answers "how far is this point from my surface?". Positive outside, negative inside, exactly 0 on the surface. That answer is the shape's *distance field*. This graph measures a sphere's field on a flat sheet through the middle of the sphere and paints the answer: orange outside, blue inside, a band for every 0.1 units, and a white line where the distance is 0. The white circle is the sphere's outline on this sheet.

**How it is built.** UV → Split Vec2 → Make Vec3 builds a 3D point for every pixel: x and y from the screen, z from the **Slice depth** slider. **Sphere SDF 3D** measures it (the distance is simply length(point) − radius). The Expression Block named Distance view only paints the number; it is a viewer, not part of any 3D scene.

**Try.** Move **Slice depth (z)** toward ±0.5: the sheet moves off the sphere's centre, so the circle shrinks and then disappears, but the orange bands are still there: the distance exists everywhere, even where there is no surface. Change **Radius**. Count the bands between the white line and a point: that is how far a ray standing there could safely jump, the idea behind the next lesson.`);

lesson('learn3dMarch', [
  n('marchCamera', 'cam', 40, 220, { ...CAM }),
  scene('scene', 40, 480, 'Scene', [
    n('sphereSDF3D', 'sph', 480, 200, { radius: 0.8 }, { pos: ['sp', 'pos'] }),
  ], ['sph', 'dist'], 'The scene: a single sphere. Scene Pos is the point being measured; Scene Output is the distance the march loop sees.'),
  loop('marchLoopGroup', 'march', 340, 220, { maxSteps: 48, bg: BG, ...note('For each pixel: start at the camera, measure the scene, step forward by that distance, repeat. Stop when the distance is almost 0 (a hit), when the ray is further than Max Dist (a miss), or after Max Steps. Iter is how many steps that took, as 0–1 of Max Steps.') }),
  n('colorRamp', 'heat', 640, 220, { stops: '4', color0: [0.03, 0.03, 0.12], color1: [0.45, 0.1, 0.55], color2: [0.95, 0.45, 0.15], color3: [1.0, 0.95, 0.6] }, { t: ['march', 'iter'] }),
  out(['heat', 'color'], 880),
], [
  ctl('d', 'cam::camDist', 'Camera distance', 1.5, 8, 0.05),
], `**What it shows.** How the **March Loop** finds the surface. A ray can't be tested against a shape directly, but the scene's distance says how far away the nearest surface is, so the ray can safely jump exactly that far without passing through anything. It measures again, jumps again, and each jump is smaller as it gets close, until the distance is almost 0 (under 0.0005): a hit. The picture is painted by how many jumps each pixel needed: dark is a few, yellow is all of **Max Steps**. Rays aimed at the middle of the sphere land in a handful of steps. Rays that skim past its edge keep getting close without touching, so they take the most: the bright halo.

**How it is built.** March Camera (the rays) and a **Scene Group** (a sphere) wired into a March Loop Group; its **Iter** output (steps taken ÷ Max Steps) through a Color Ramp into Output. Inside the loop's body, **March Pos** is where the ray has got to at the current step and **March Dist** how far it has travelled; this loop leaves them untouched.

**Try.** Move **Camera distance**: from further away every ray needs a few more jumps to arrive. On the loop's card, lower **Step Scale**: each jump is only a fraction of the distance, safer but slower, and the whole picture gets hotter. Lower **Max Steps** on the loop's card to 16: the rays near the edge run out of steps before they arrive and turn yellow (and miss, so a plain Color output would show background there). Wire **Hit** into Output instead to see which pixels found the surface.`);

lesson('learn3dLight', [
  n('marchCamera', 'cam', 40, 220, { ...CAM }),
  scene('scene', 40, 480, 'Scene', [
    n('sphereSDF3D', 'sph', 480, 200, { radius: 0.8 }, { pos: ['sp', 'pos'] }),
  ], ['sph', 'dist'], 'A single sphere, as in the last lesson.'),
  loop('marchLoopGroup', 'march', 340, 220, { bg: BG, ...note('Normal is the direction the surface faces where the ray stopped (found by measuring the scene a tiny step either side of the hit). Hit is 1 where the ray touched a surface, 0 where it missed.') }),
  n('colorPicker', 'base', 340, 520, { color: [0.95, 0.55, 0.3] }),
  n('multiLight', 'lit', 640, 220, {
    sunDirX: 0.8, sunDirY: 0.6, sunDirZ: -0.5, skyR: 0.1, skyG: 0.13, skyB: 0.2, bounceR: 0, bounceG: 0, bounceB: 0,
    ...note('Sun light is dot(Normal, Sun direction): 1 where the surface faces the sun, 0 where it faces away. A little sky light keeps the dark side from going black. Hit 0 (a miss) gives black.'),
  }, { baseColor: ['base', 'rgb'], normal: ['march', 'normal'], hit: ['march', 'hit'] }),
  n('toneMap', 'tone', 900, 220, { mode: 'aces' }, { color: ['lit', 'color'] }),
  out(['tone', 'color'], 1140),
], [
  ctl('x', 'lit::sunDirX', 'Sun X', -1, 1, 0.01),
  ctl('y', 'lit::sunDirY', 'Sun Y', -1, 1, 0.01),
  colourCtl('c', 'base::color', 'Surface colour'),
], `**What it shows.** Once a ray stops, the loop knows three things about that spot: **Hit** (did it touch a surface at all, 1 or 0), **Hit Pos** (where) and **Normal** (which way the surface faces there, an arrow of length 1). Lighting is mostly one sum: compare the Normal with the direction toward the sun (a dot product). Facing the sun gives 1, side-on gives 0, facing away is clamped to 0. Multiply the surface colour by that and the sphere looks round.

**How it is built.** The same camera, scene and loop as the last lesson. The loop's Normal and Hit go into **Multi-Light** with a surface colour; Hit makes the missed pixels black. Multi-Light also adds a faint sky light from above so the shadow side isn't pitch black (its bounce light is turned off here). Tone Map keeps the bright side from clipping.

The sun here comes from the side, so the line between the lit and the dark half (where the Normal turns away from the sun) runs down the middle of the sphere.

**Try.** Move **Sun X** and **Sun Y**: the bright side follows. Set Sun Y to −1: the sun is below, so only the underside is lit. Wire the loop's Normal through Normal to Color into Output to see the normals themselves (the first ray march in the Learn folder does this).`);

lesson('learn3dCombine', [
  n('marchCamera', 'cam', 40, 220, { ...CAM }),
  n('constant', 'blend', 40, 760, { label: 'Blend radius', value: 0.25, ...note('The Union\'s blend radius, kept outside the Scene Group and wired in through a port so Play can move it (sliders inside a Scene Group are fixed when the shader is built).') }),
  scene('scene', 40, 480, 'Scene', [
    n('translate3D', 'mv', 240, 80, { tx: 0.45, ...note('Moving a shape means moving the point it measures: Translate 3D subtracts the offset from the point before the sphere measures it, so the sphere\'s centre ends up at the offset (x = 0.45 here).') }, { pos: ['sp', 'pos'] }),
    n('sphereSDF3D', 'sph', 480, 80, { radius: 0.5 }, { pos: ['mv', 'pos'] }),
    n('translate3D', 'mvb', 240, 320, { tx: -0.45 }, { pos: ['sp', 'pos'] }),
    n('roundedBoxSDF3D', 'box', 480, 320, { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4, radius: 0.05 }, { pos: ['mvb', 'pos'] }),
    n('sdfUnion', 'un', 760, 200, { k: 0.25, ...note('Union keeps the smaller of the two distances, so a point is near the scene if it is near either shape. Blend radius above 0 rounds the join into a smooth blend; here it comes in from the Blend radius Constant outside.') }, { a: ['sph', 'dist'], b: ['box', 'dist'] }),
  ], ['un', 'dist'], 'Two shapes measured at the same point and joined by a Union. Only what reaches Scene Output counts: the Union, not the sphere or box on their own.',
  { key: 'k', label: 'Blend radius', from: ['blend', 'value'], to: ['un', 'k'] }),
  loop('marchLoopGroup', 'march', 340, 220, { bg: BG, albedo: [0.55, 0.75, 0.95] }),
  out(['march', 'color'], 640),
], [
  ctl('k', 'blend::value', 'Blend radius', 0, 0.8, 0.01),
  ctl('a', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
], `**What it shows.** A scene with more than one shape is still one distance: for any point, the distance to the *nearest* surface. **Union** does exactly that, it keeps the smaller of two distances. With a **Blend radius** above 0 it becomes a smooth union and the sphere and box melt into each other like putty where they meet, something meshes can't do cheaply.

**How it is built.** Everything happens inside the **Scene Group** (double-click it). **Scene Pos** is the point being measured. It goes through a Translate 3D to each shape, so each is measured from its own centre, then both distances go into Union, and the Union goes into **Scene Output**. Scene Output is what the scene returns: a shape that isn't wired through to it is not in the scene. The blend radius comes in from a Constant outside the group, through a port on the Scene Group, so it can be a Play slider. Outside the group nothing else changed: camera, loop, and the loop's own Color output, which lights the surface with one fixed light.

**Try.** Raise **Blend radius** from 0 and watch the crease fill in; turn the **Camera angle** to see the join from the side. Inside the group, slide the sphere's Translate 3D X so it passes into the box and out again. Swap Union for Subtract (the box bites into the sphere) or Intersect (only the overlap is left). Add a Plane 3D as a floor with a second Union.`);

lesson('learn3dOrbit', [
  time(40, 460),
  n('marchCamera', 'cam', 280, 220, { camDist: 3.4, camAngle: 0.6, camElevation: 0.45, rotSpeed: 0.4, fov: 1.5, ...note('Angle is Angle + Time × Rot Speed, so with Time wired the camera circles the target at Rot Speed radians per second, always looking at the centre.') }, { time: ['time', 'time'] }),
  scene('scene', 280, 520, 'Scene', [
    n('roundedBoxSDF3D', 'box', 480, 80, { sizeX: 0.45, sizeY: 0.45, sizeZ: 0.45, radius: 0.08 }, { pos: ['sp', 'pos'] }),
    n('planeSDF3D', 'floor', 480, 320, { height: -0.46 }, { p: ['sp', 'pos'] }),
    n('sdfUnion', 'un', 760, 200, {}, { a: ['box', 'dist'], b: ['floor', 'dist'] }),
  ], ['un', 'dist'], 'A box on a floor. A box, not a sphere: a sphere looks the same from every side, so you could not see the camera move.'),
  loop('marchLoopGroup', 'march', 580, 220, { bg: BG }),
  n('normalToColor', 'ncol', 840, 220, {}, { v: ['march', 'normal'] }),
  out(['ncol', 'color'], 1080),
], [
  ctl('s', 'cam::rotSpeed', 'Orbit speed', 0, 2, 0.01),
  ctl('e', 'cam::camElevation', 'Height', -0.1, 1.4, 0.02),
  ctl('d', 'cam::camDist', 'Distance', 1.8, 8, 0.05),
], `**What it shows.** Nothing in the scene moves: the camera does. **March Camera** sits on a circle around its target (the centre), at **Distance** from it and **Height** (elevation) above the ground, and always looks at the target. Wire **Time** into it and its angle keeps growing, so it orbits. The colours are the surface normals, which belong to the world: the floor is always green (it faces up), each face of the box keeps its colour, and you see different faces as the camera goes round. The top of the box is the same green as the floor, because both face up. Rays that miss have no normal (0, 0, 0), which Normal to Color shows as grey.

**How it is built.** Time → March Camera (Rot Speed 0.4) → the loop; a Scene Group with a rounded box on a floor; Normal → Normal to Color → Output. Moving the camera changes only Ray Origin and Ray Dir; the Scene Group, the loop and the colouring are the same as in any static scene.

**Try.** Set **Orbit speed** to 0 and move the camera's Angle by hand on its card. Raise **Height** to look down from above. For a hand-held orbit, add a Play mapping from Mouse X to the camera's Angle. Moving the *object* instead means moving the point it measures: a Translate 3D or Rotate 3D inside the Scene Group, as in the last lesson.`);

const volumeBody = sub([
  n('marchLoopInputs', 'vol_in', 0, 180, { _groupOriginal: true }),
  n('marchSceneDist', 'sd', 440, 180, { ...note('How far March Pos, the ray\'s point at this step, is from the sphere. Raw Distance is the true value: negative inside.') }, { pos: ['vol_in', 'marchPos'] }),
  n('volumeGlow', 'vg', 880, 180, { density: 0.03, falloff: 10, shell: 0.15, ...note('Set to += in its header: every step adds its glow to a running total instead of replacing it. The total leaves the loop as its Glow output.') }, { dist: ['sd', 'rawDist'] }, { assignOp: '+=' } as Partial<GraphNode>),
  n('marchLoopOutput', 'vol_out', 440, 520, { _groupOriginal: true }, { pos: ['vol_in', 'marchPos'] }),
]);
const volumeLoop = loop('marchLoopGroup', 'vol', 340, 520, {
  volumetric: true, maxSteps: 96, maxDist: 8, bg: [0, 0, 0],
  ...note('Volumetric on: the ray never stops at the surface. It walks all the way through the scene (never slower than Passthrough per step) and the body runs at every step.'),
}, volumeBody);
volumeLoop.outputs = { ...volumeLoop.outputs, acc0: { type: 'float', label: 'Glow' } };

lesson('learn3dVolume', [
  uv(40, 760),
  n('marchCamera', 'cam', 40, 220, { ...CAM }),
  scene('scene', 40, 480, 'Scene', [
    n('sphereSDF3D', 'sph', 480, 200, { radius: 0.8 }, { pos: ['sp', 'pos'] }),
  ], ['sph', 'dist'], 'One sphere, wired into both loops.'),
  loop('marchLoopGroup', 'surf', 340, 220, { bg: [0, 0, 0], albedo: [0.3, 0.8, 1.0], ...note('The ordinary loop: stops at the surface and shades it.') }),
  volumeLoop,
  n('glowToColor', 'g2c', 620, 520, { exposure: 1.2, tint: [0.3, 0.8, 1.0] }, { glow: ['vol', 'acc0'] }),
  ...splitScreen(['surf', 'color'], ['g2c', 'color'], 620, 220),
  n('toneMap', 'tone', 1320, 220, { mode: 'aces' }, { color: ['pick', 'result'] }),
  out(['tone', 'color'], 1560),
], [
  ctl('x', 'g2c::exposure', 'Glow brightness', 0.1, 5, 0.01),
  colourCtl('t', 'g2c::tint', 'Glow colour'),
  ctl('a', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
], `**What it shows.** Two ways to march the same sphere, split down the middle. Left: the ordinary loop, which stops as soon as it reaches the surface, so you see a solid ball. Right: a **volumetric** loop, which never stops. It walks right through the sphere and out the other side, and at every step it adds a little light depending on how close the ray's point is to the shape. Rays that cross a lot of the sphere collect more light, so it glows like a gas.

**How it is built.** One camera, one Scene Group, two loops. The right-hand loop has Volumetric on, and its body (double-click it) does the work: Group Inputs → **March Pos** (where the ray is at this step) → **Scene Distance** (how far that point is from the sphere) → **Volume Glow**, whose header is set to **+=** so each step adds to a running total instead of replacing it. The total comes out of the loop as Glow; **Glow to Color** tints it. Split Vec2 → Compare → Select shows the left loop on the left half and the right loop on the right.

**Try.** Move **Glow brightness** and **Glow colour** (Glow to Color's Exposure and Tint). Then open the right-hand loop and, on Volume Glow, raise **Shell**: only a skin near the surface glows, so the sphere becomes a soap bubble, bright at the rim where rays run along the skin. Lower its **Falloff** for a softer, wider glow. Change the shape inside the Scene Group (a torus is good) and both halves change together.`);

lesson('learn3dGI', [
  uv(40, 760),
  n('marchCamera', 'cam', 40, 220, { camDist: 3.6, camAngle: 0.25, camElevation: 0.35, rotSpeed: 0, fov: 1.5 }),
  scene('scene', 40, 480, 'Scene', [
    n('sphereSDF3D', 'sph', 480, 80, { radius: 0.7 }, { pos: ['sp', 'pos'] }),
    n('planeSDF3D', 'floor', 480, 320, { height: -0.7 }, { p: ['sp', 'pos'] }),
    n('sdfUnion', 'un', 760, 200, {}, { a: ['sph', 'dist'], b: ['floor', 'dist'] }),
  ], ['un', 'dist'], 'A sphere resting on a floor, wired into both loops.'),
  loop('marchLoopGroup', 'plain', 340, 220, { bg: [0.55, 0.65, 0.8], albedo: [0.9, 0.85, 0.75], ...note('The plain loop\'s Color: the surface times one fixed light, nothing else.') }),
  loop('giLitMarchGroup', 'gi', 340, 520, {
    bg: [0.55, 0.65, 0.8], albedo: [0.9, 0.85, 0.75], roughness: 0.45, lightStrength: 1.2,
    ...note('After the hit, the GI loop marches more rays from the surface: toward the light (shadows), around it (ambient occlusion), a random bounce (GI) and a mirror ray (reflection).'),
  }),
  ...splitScreen(['plain', 'color'], ['gi', 'color'], 640, 220),
  n('toneMap', 'tone', 1340, 220, { mode: 'aces' }, { color: ['pick', 'result'] }),
  out(['tone', 'color'], 1580),
], [
  ctl('a', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
  ctl('e', 'cam::camElevation', 'Camera height', 0.05, 1.4, 0.02),
], `**What it shows.** The plain March Loop's Color (left) lights each point from one direction and stops there: no shadows, no light from the sky, nothing reflected. The **GI Lit March Loop** (right) finds the surface the same way, then sends more rays out from the hit point: one toward the light (is anything in the way? that is the shadow under the sphere), a few along the normal (how enclosed is this spot? ambient occlusion, the dark contact line), one in a random direction (light bouncing off the floor onto the sphere) and one mirror ray (reflections). Each extra ray is another march through the same scene, which is why it costs more.

**How it is built.** One camera and one Scene Group (a sphere on a floor) wired into both loops; Split Vec2 → Compare → Select puts the plain one on the left and the GI one on the right; Tone Map finishes both. The GI loop's own lighting is on its card: Light Strength, GI Strength, Spec Strength, and the step counts for each extra ray.

**Try.** Turn the **Camera angle** and **Camera height**: the shadow and the reflections stay put in the world while the plain half never changes its flat look. On the GI loop's card, lower **Roughness** toward 0: the sphere becomes a mirror and shows the floor. Raise **Metallic** and the reflections take the surface colour. Set **GI Strength** to 0 and the underside of the sphere goes darker: that light was bouncing off the floor.`);

// The same glow, built by the loop's Volumetric switch instead of by hand: a plain torus
// scene, then exactly what turning the switch on adds (nodes/volumetricAuto.ts).
{
  const ids = ['vt_dist', 'vt_glow', 'vt_colour'];
  const plain = [
    n('marchCamera', 'cam', 40, 220, { ...CAM, camDist: 3.2, camElevation: 0.55 }),
    scene('scene', 40, 520, 'Scene', [
      n('torusSDF3D', 'torus', 480, 200, { majorR: 0.75, minorR: 0.28 }, { pos: ['sp', 'pos'] }),
    ], ['torus', 'dist'], 'One torus. Change it, or add shapes, and the glow follows: the loop measures whatever the scene returns.'),
    loop('marchLoopGroup', 'march', 380, 220, {
      bg: [0, 0, 0],
      ...note('Volumetric is on: the switch on this card built the glow. Turn it off and the nodes it added go away and the solid torus is back; turn it on again and they return.'),
    }),
    out(['march', 'color'], 1100),
  ];
  lesson('learn3dVolumeSwitch', volumetricOn(() => ids.shift()!, plain, 'march').nodes, [
    ctl('x', 'vt_colour::exposure', 'Glow brightness', 0.1, 5, 0.01),
    colourCtl('t', 'vt_colour::tint', 'Glow colour'),
    ctl('a', 'cam::camAngle', 'Camera angle', 0, 6.28, 0.02),
  ], `**What it shows.** A torus made of light: the ray walks right through it and collects a little glow at every step, brightest where it crosses the most of the shape. Nothing here was wired by hand. It started as an ordinary solid torus, and turning on **Volumetric** on the March Loop card built the rest.

**How it is built.** Turning the switch on adds three nodes, each with a note. Inside the loop (double-click it): Group Inputs → **Scene Distance** (how far the ray's point is from the torus at this step) → **Volume Glow**, set to **+=** so every step adds to a running total. After the loop: its **Glow** output → **Glow to Color** → Output, in place of the loop's Color (which shows surfaces, and there are none in volumetric mode). Turning the switch off takes those nodes away again and puts the loop's Color back on the Output; a node you changed is kept, with a line on its note.

**Try.** Turn **Volumetric** off and on again on the March Loop card and watch the nodes come and go. Move **Glow brightness** and **Glow colour**. Open the loop and raise Volume Glow's **Shell** to 0.1 to light only the torus's skin, like a soap bubble. Add a shape on the top level: it goes into the Scene Group, beside the torus, and glows too.`);
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** The Learn 3D folder's graphs. */
export function buildLearn3dExamples(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};
  for (const l of L) graphs[l.key] = { ...LEARN3D_EXAMPLE_INDEX[l.key], counter: 60, nodes: l.nodes, play: play(l.controls, l.notes) };
  return graphs;
}
