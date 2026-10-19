/**
 * pictures3dExamples.ts — pictures and videos inside ray-marched scenes (docs/pictures-in-3d.md):
 * Picture Card (a picture or video as a card in the scene) and Texture Material (a picture wrapped
 * onto any shape). Listed in the "3D: Pictures" folder.
 *
 * They use what ships with the app: the Ball action clip (lib/builtinVideos.ts) and the two built-in
 * photos (lib/builtinImages.ts). Built from the node definitions (graphBuilder.ts); every node
 * carries a note saying what it does and why it is there, and each Expression Block's note explains
 * its named lines.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { ctl, n, out, play } from './graphBuilder';
import { expr, note } from './agentExampleKit';
import { BALL_VIDEO } from '../lib/builtinVideos';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';

export const PICTURES_3D_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  pic3dVideoRoom: {
    label: 'Picture card: a video in a lit room', play: true,
    description: 'The built-in Ball action clip playing on a card that floats and turns in a small room. The card is a shape like any other: it casts a shadow on the floor and shows in the polished floor and the chrome ball, which a second March Loop reflects. Emissive mixes how much it glows like a screen and how much it is lit like a print. Play: emissive, glow, reflections, look round.',
  },
  pic3dCutouts: {
    label: 'Picture card: lit print and glowing cutout', play: true,
    description: 'Two Picture Cards on a floor under a low sun. On the left, the built-in Room and cat photo as a lit print: it catches the light and casts a shadow. On the right, the Ball action clip keyed by brightness (Cutout: Bright) so only the balls are left, glowing (Emissive 1) and turning to face the camera as it swings round (Billboard, upright); their cut-out shadows fall on the floor. Play: threshold, emissive, sun.',
  },
  pic3dTexturedShapes: {
    label: 'Texture Material: a photo on a sphere, a box and a cylinder', play: true,
    description: 'The built-in Walkway cat photo wrapped onto shapes by Texture Material: a sphere and a turned box with Triplanar (three projections blended by which way the surface faces, no seams), a cylinder with Cylinder (round the sides like a label) and the floor with Planar Y, tinted (Multiply). Each picture is read in its shape\'s own space, so the box\'s picture turns with it. Play: blend sharpness, size, turn the box.',
  },
};
export const PICTURES_3D_EXAMPLE_KEYS = Object.keys(PICTURES_3D_EXAMPLE_INDEX);

const BALL_VIDEO_PARAMS = { videoId: BALL_VIDEO.id, _fileName: BALL_VIDEO.name, _hasFile: true, _isPlaying: true, _loop: true, _speed: 1 };
const sub = (nodes: GraphNode[], inputPorts: SubgraphData['inputPorts'] = []): SubgraphData => ({ nodes, inputPorts, outputPorts: [] });
const wire = (nodeId: string, outputKey: string) => ({ connection: { nodeId, outputKey } });

/** A March Loop's inside: the ray's point handed straight to the scene. */
const loopBody = () => sub([
  n('marchLoopInputs', 'march_in', 0, 180, { _groupOriginal: true, ...note(['Group Inputs: the ray at this step.']) }),
  n('marchLoopOutput', 'march_out', 440, 180, { _groupOriginal: true, ...note(['Group Output: the point handed to the scene, unchanged.']) }, { pos: ['march_in', 'marchPos'] }),
]);

/** A Scene Group's added input, wired from outside. */
function groupIn(g: GraphNode, key: string, type: GraphNode['inputs'][string]['type'], label: string, from: [string, string]): void {
  g.inputs = { ...g.inputs, [key]: { type, label, ...wire(from[0], from[1]) } };
}

// ── 1 · A video card in a lit room, reflected ────────────────────────────────

const ROOM_CARD = { size: 2.0, thickness: 0.02, back: 'readable', emissive: 0.7, brightness: 1.4 };

function videoRoom(): GraphNode[] {
  const scene = n('sceneGroup', 'scene', 640, 420, {
    label: 'Room', ...note([
      'The room: its walls and floor (no ceiling), a chrome ball and the video card. The video, the card\'s place and its turn come in through the group\'s ports (Picture, Card place, Card turn), so the card outside the loop, which gives its colour, reads the very same values.',
    ]),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      n('pictureCard', 'card', 300, 40, { ...ROOM_CARD, ...note([
        'Picture Card: the video as a card 2 wide (its height follows the clip\'s 16:9), 0.02 thick. Inside the Scene Group only its Distance is used, so the march never reads the video: the colour is read once, after the loop, where the ray hit.',
        'Its Position and Rotation come in through the group\'s ports (from Float, outside). Back: the right way round, so the clip reads correctly from behind too.',
      ]) }, { pos: ['sp', 'pos'] }),
      expr('ball', 300, 300, {
        label: 'Ball', inputs: [{ name: 'p', type: 'vec3' }], lines: [], result: 'length(p - vec3(-1.35, -0.55, 0.35)) - 0.45', outputType: 'float', wires: { p: ['sp', 'pos'] },
        note: ['Ball: a sphere of radius 0.45 resting on the floor to the left of the card (its centre at x −1.35, y −0.55, z 0.35). It is chrome: it shows the card and the room in the reflection pass.'],
      }),
      expr('room', 300, 460, {
        label: 'Room walls', inputs: [{ name: 'p', type: 'vec3' }],
        lines: [
          ['float floorD', 'p.y + 1.0'],
          ['vec2 w', '4.0 - abs(p.xz)'],
          ['float wallD', 'max(min(w.x, w.y), p.y - 2.0)'],
        ],
        result: 'min(floorD, wallD)', outputType: 'float', wires: { p: ['sp', 'pos'] },
        note: [
          'Room walls: a set with no ceiling, like a film stage. floorD is the distance to the floor (y −1); w how far the point is inside the four walls (8 × 8 units); wallD the walls, cut off 3 units up (p.y − 2: above y 2 there is no wall). The sunlight comes in over the top.',
        ],
      }),
      expr('union', 600, 200, {
        label: 'Everything', inputs: [{ name: 'card', type: 'float' }, { name: 'ball', type: 'float' }, { name: 'room', type: 'float' }],
        lines: [], result: 'min(card, min(ball, room))', outputType: 'float', wires: { card: ['card', 'dist'], ball: ['ball', 'result'], room: ['room', 'result'] },
        note: ['Everything: the nearest of the card, the ball and the walls (a plain union, min).'],
      }),
      n('sceneOutput', 'so', 860, 200, { _groupOriginal: true, ...note(['Scene Output: the room\'s distance, for the March Loops, the shadow and the AO.']) }, { dist: ['union', 'result'] }),
    ], [
      { key: 'picture', type: 'texture', label: 'Picture', toNodeId: 'card', toInputKey: 'picture' },
      { key: 'place', type: 'vec3', label: 'Card place', toNodeId: 'card', toInputKey: 'center' },
      { key: 'turn', type: 'vec3', label: 'Card turn', toNodeId: 'card', toInputKey: 'rotation' },
    ]),
  });
  groupIn(scene, 'picture', 'texture', 'Picture', ['vid', 'texture']);
  groupIn(scene, 'place', 'vec3', 'Card place', ['float', 'result']);
  groupIn(scene, 'turn', 'vec3', 'Card turn', ['float', 'turn']);

  return [
    n('videoInput', 'vid', 40, 0, { ...BALL_VIDEO_PARAMS, ...note([
      'Texture (video): the built-in Ball action clip, looping. Choose your own video, a picture or the webcam on this card: the card takes its shape (aspect) from whatever it shows.',
    ]) }),
    n('time', 'time', 40, 260, note(['Time: makes the card float and turn.'])),
    expr('float', 340, 220, {
      label: 'Float', inputs: [{ name: 't', type: 'float' }],
      lines: [['vec3 turn', 'vec3(4.0 * sin(t * 0.37), 24.0 * sin(t * 0.21), 0.0)']],
      result: 'vec3(-0.25, 0.55 + 0.12 * sin(t * 0.8), -0.3)', outputType: 'vec3', wires: { t: ['time', 'time'] },
      exposed: [{ name: 'turn', type: 'vec3' }],
      note: [
        'Float: where the card is (the result) and how it is turned (turn, degrees about X, Y and Z), slowly changing with time.',
        'The result bobs the card 0.12 up and down about y 0.55; turn rocks it ±24° round Y and tips it ±4° about X. Both go into the card inside the Room (through its ports) and into the card after the loop, so the shape and its colour always agree.',
      ],
    }),
    n('marchCamera', 'cam', 340, 0, { camDist: 3.2, camAngle: 0.3, camElevation: 0.1, rotSpeed: 0, fov: 1.35, targetY: 0.35, ...note([
      'March Camera: inside the room, a little to the right and above the card, looking at it (Target Y 0.35).',
    ]) }, { time: ['time', 'time'] }),
    scene,
    n('marchLoopGroup', 'march', 940, 220, { maxSteps: 160, maxDist: 20, jitter: 0.5, bg: [0.02, 0.02, 0.03], subgraph: loopBody(), ...note([
      'March Loop: finds where each ray from the camera meets the room, the ball or the card. Hit Pos, Normal and Hit feed the lights; Hit Pos also goes to the card below for its colour.',
    ]) }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('pictureCard', 'cardHit', 1240, 0, { ...ROOM_CARD, ...note([
      'Picture Card at Hit Pos: the same card, same settings and the same Float wires, measured where the ray stopped. Its Distance is 0 on the card, so Materials knows when the ray hit it; Color is the video there, for the lights; Glow the part that shines like a screen (Emissive 0.7, Glow brightness 1.4).',
      'The video is read here only: once per pixel, with its mipmap picked from how fast the place on the card changes from pixel to pixel (no shimmer when it is small).',
    ]) }, { pos: ['march', 'pos'], picture: ['vid', 'texture'], center: ['float', 'result'], rotation: ['float', 'turn'] }),
    expr('sun', 940, 640, {
      label: 'Key light', inputs: [], lines: [], result: 'normalize(vec3(-0.3, 0.8, 0.55))', outputType: 'vec3',
      note: ['Key light: the direction the sunlight comes from (high, from in front and a little to the right as you look), shared by the shadow and Multi-Light. It throws the card\'s shadow onto the floor behind it.'],
    }),
    n('softShadow', 'shadow', 1240, 520, { k: 10, tmax: 10, ...note(['Soft Shadow: walks from each hit towards the key light through the Room scene: the card\'s shadow falls on the floor behind it, the ball\'s beside it, and the front wall shades the floor nearest the camera.']) },
      { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'], lightDir: ['sun', 'result'] }),
    n('sdfAo', 'ao', 1240, 760, note(['SDF Ambient Occlusion: darkens the corners and under the ball.']), { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'] }),
    expr('mat', 1540, 220, {
      label: 'Materials', inputs: [{ name: 'p', type: 'vec3' }, { name: 'cardD', type: 'float' }, { name: 'cardCol', type: 'vec3' }, { name: 'cardGlow', type: 'vec3' }],
      lines: [
        ['float onCard', 'cardD < 0.01 ? 1.0 : 0.0'],
        ['float onBall', '(1.0 - onCard) * (length(p - vec3(-1.35, -0.55, 0.35)) < 0.47 ? 1.0 : 0.0)'],
        ['float onFloor', '(1.0 - onCard) * (1.0 - onBall) * (p.y < -0.98 ? 1.0 : 0.0)'],
        ['vec2 tile', 'floor(p.xz * 1.25)'],
        ['vec3 floorCol', 'mix(vec3(0.16, 0.13, 0.11), vec3(0.24, 0.2, 0.16), mod(tile.x + tile.y, 2.0))'],
        ['vec3 wallCol', 'vec3(0.55, 0.5, 0.46)'],
        ['vec3 glow', 'cardGlow * onCard'],
        ['float shine', 'onBall * 0.85 + onFloor * 0.35'],
      ],
      result: 'onCard > 0.5 ? cardCol : onBall > 0.5 ? vec3(0.08) : onFloor > 0.5 ? floorCol : wallCol', outputType: 'vec3',
      wires: { p: ['march', 'pos'], cardD: ['cardHit', 'dist'], cardCol: ['cardHit', 'color'], cardGlow: ['cardHit', 'glow'] },
      exposed: [{ name: 'glow', type: 'vec3' }, { name: 'shine', type: 'float' }],
      note: [
        'Materials: what the ray hit and its colour. onCard is 1 where the card\'s Distance at the hit is (nearly) 0; onBall where the hit is on the ball; onFloor where it is on the floor (y −1). The result is the surface colour for Multi-Light: the video on the card, dark chrome on the ball, a wooden checker on the floor (tile, floorCol), warm grey walls.',
        'glow is the card\'s Glow (the screen\'s own light, added after the lights). shine is how mirror-like each surface is (the ball 0.85, the floor 0.35): the reflection pass is mixed in by it.',
      ],
    }),
    n('multiLight', 'light', 1840, 220, { background: 'colour', bgColor: [0.04, 0.045, 0.06], sunR: 1.25, sunG: 1.1, sunB: 0.95, skyR: 0.3, skyG: 0.32, skyB: 0.38, bounceR: 0.12, bounceG: 0.1, bounceB: 0.08, ...note([
      'Multi-Light: the key light (with its shadow), a dim fill from above and a warm bounce, over each surface\'s colour. The card\'s Color is lit like any print here; its Glow is added after.',
    ]) }, { baseColor: ['mat', 'result'], normal: ['march', 'normal'], hit: ['march', 'hit'], ao: ['ao', 'ao'], shadow: ['shadow', 'shadow'], sunDir: ['sun', 'result'] }),
    expr('bounce', 1540, 640, {
      label: 'Mirror ray', inputs: [{ name: 'p', type: 'vec3' }, { name: 'n', type: 'vec3' }, { name: 'rd', type: 'vec3' }],
      lines: [['vec3 from', 'p + n * 0.02']], result: 'reflect(normalize(rd), n)', outputType: 'vec3',
      wires: { p: ['march', 'pos'], n: ['march', 'normal'], rd: ['cam', 'rd'] }, exposed: [{ name: 'from', type: 'vec3' }],
      note: ['Mirror ray: where a mirror at each hit point looks. The result is the camera\'s ray bounced off the surface (reflect); from is the hit point lifted 0.02 off the surface, so the new ray doesn\'t hit it straight away.'],
    }),
    n('marchLoopGroup', 'march2', 1840, 640, { maxSteps: 96, maxDist: 16, jitter: 0, bg: [0.02, 0.02, 0.03], subgraph: loopBody(), ...note([
      'Reflection March Loop: a second march through the same Room, along the mirror ray. It costs about as much as the first (fewer steps: 96), which is what reflections cost in a ray marcher.',
    ]) }, { ro: ['bounce', 'from'], rd: ['bounce', 'result'], scene: ['scene', 'scene'] }),
    n('pictureCard', 'cardRefl', 2140, 640, { ...ROOM_CARD, ...note([
      'Picture Card at the reflected Hit Pos: the card\'s colour where the mirror ray landed, so the video plays in the floor and the ball.',
    ]) }, { pos: ['march2', 'pos'], picture: ['vid', 'texture'], center: ['float', 'result'], rotation: ['float', 'turn'] }),
    expr('reflCol', 2440, 640, {
      label: 'What the mirror sees', inputs: [{ name: 'p', type: 'vec3' }, { name: 'n', type: 'vec3' }, { name: 'hit', type: 'float' }, { name: 'cardD', type: 'float' }, { name: 'cardCol', type: 'vec3' }, { name: 'cardGlow', type: 'vec3' }, { name: 'sun', type: 'vec3' }],
      lines: [
        ['float onCard', 'cardD < 0.01 ? 1.0 : 0.0'],
        ['vec2 tile', 'floor(p.xz * 1.25)'],
        ['vec3 room', 'p.y < -0.98 ? mix(vec3(0.16, 0.13, 0.11), vec3(0.24, 0.2, 0.16), mod(tile.x + tile.y, 2.0)) : vec3(0.55, 0.5, 0.46)'],
        ['float lit', '0.25 + 0.75 * max(dot(n, sun), 0.0)'],
      ],
      result: 'hit * (onCard > 0.5 ? cardCol * lit + cardGlow : room * lit)', outputType: 'vec3',
      wires: { p: ['march2', 'pos'], n: ['march2', 'normal'], hit: ['march2', 'hit'], cardD: ['cardRefl', 'dist'], cardCol: ['cardRefl', 'color'], cardGlow: ['cardRefl', 'glow'], sun: ['sun', 'result'] },
      note: [
        'What the mirror sees: the surface the reflected ray found, simply lit (no second shadow, to keep it cheap). onCard: the video (its Color lit, plus its Glow); otherwise the room\'s colour (room: the floor\'s checker or the wall). lit is a soft light from the key direction.',
      ],
    }),
    expr('final', 2740, 220, {
      label: 'Combine', inputs: [{ name: 'lit', type: 'vec3' }, { name: 'glow', type: 'vec3' }, { name: 'refl', type: 'vec3' }, { name: 'shine', type: 'float' }, { name: 'n', type: 'vec3' }, { name: 'rd', type: 'vec3' }, { name: 'amount', type: 'float', slider: { min: 0, max: 1 } }],
      values: { amount: 1 },
      lines: [['float fres', '0.35 + 0.65 * pow(1.0 - max(dot(-normalize(rd), n), 0.0), 4.0)']],
      result: 'lit + glow + refl * shine * fres * amount', outputType: 'vec3',
      wires: { lit: ['light', 'color'], glow: ['mat', 'glow'], refl: ['reflCol', 'result'], shine: ['mat', 'shine'], n: ['march', 'normal'], rd: ['cam', 'rd'] },
      note: [
        'Combine: the lit room, plus the card\'s Glow (it shines whatever the light), plus the reflection where a surface is shiny. fres (Schlick\'s Fresnel) makes reflections stronger at grazing angles, as on a real floor. amount turns reflections down (Play: Reflections).',
      ],
    }),
    n('toneMap', 'tone', 3040, 220, { mode: 'aces', ...note(['Tone Map (ACES): the bright screen rolls off into the displayable range instead of clipping.']) }, { color: ['final', 'result'] }),
    out(['tone', 'color'], 3300),
  ];
}

// ── 2 · A lit print and a glowing cutout ─────────────────────────────────────

const PRINT = { center: [0.95, 0.05, 0], rotation: [0, -18, 0], size: 1.5, thickness: 0.015, back: 'colour', emissive: 0 };
const CUTOUT = { center: [-0.85, 0.15, 0.2], size: 1.9, thickness: 0.01, facing: 'upright', cutout: 'bright', threshold: 0.18, emissive: 1, brightness: 1.6 };

function cutouts(): GraphNode[] {
  const scene = n('sceneGroup', 'scene', 640, 420, {
    label: 'Cards and floor', ...note([
      'Two Picture Cards and a floor. The photo, the video and the camera\'s position come in through the group\'s ports.',
    ]),
    subgraph: sub([
      n('scenePos', 'sp', 0, 200, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      n('pictureCard', 'print', 300, 0, { ...PRINT, ...note([
        'Picture Card (print): the Room and cat photo, 1.5 wide, turned −18° round Y (towards the middle). No cutout: a rectangle. Emissive 0: it is lit like a print, so it is bright where the sun falls on it and it casts a shadow. Its back is a plain dark colour.',
      ]) }, { pos: ['sp', 'pos'] }),
      n('pictureCard', 'balls', 300, 260, { ...CUTOUT, ...note([
        'Picture Card (cutout): the Ball action clip with Cutout Bright, Threshold 0.18: wherever the clip is darker than that it is cut away, so only the glowing balls are left, a new shape every frame. Their shadows on the floor are cut out too.',
        'Facing: Billboard, upright: it turns round to face the camera (wired in through the Camera port) as the camera circles, but stays upright.',
        'The cutout is the only time the march reads the clip: only when a ray is within the card\'s thickness (plus a pixel of the clip) of it.',
      ]) }, { pos: ['sp', 'pos'] }),
      n('planeSDF3D', 'floor', 300, 520, { height: -0.75, ...note(['Plane: the floor at y −0.75.']) }, { p: ['sp', 'pos'] }),
      expr('union', 600, 200, {
        label: 'Everything', inputs: [{ name: 'a', type: 'float' }, { name: 'b', type: 'float' }, { name: 'f', type: 'float' }],
        lines: [], result: 'min(min(a, b), f)', outputType: 'float', wires: { a: ['print', 'dist'], b: ['balls', 'dist'], f: ['floor', 'dist'] },
        note: ['Everything: the nearest of the two cards and the floor (min).'],
      }),
      n('sceneOutput', 'so', 860, 200, { _groupOriginal: true, ...note(['Scene Output: the scene\'s distance.']) }, { dist: ['union', 'result'] }),
    ], [
      { key: 'photo', type: 'texture', label: 'Photo', toNodeId: 'print', toInputKey: 'picture' },
      { key: 'video', type: 'texture', label: 'Video', toNodeId: 'balls', toInputKey: 'picture' },
      { key: 'camera', type: 'vec3', label: 'Camera', toNodeId: 'balls', toInputKey: 'camera' },
      { key: 'threshold', type: 'float', label: 'Cutout threshold', toNodeId: 'balls', toInputKey: 'threshold' },
    ]),
  });
  groupIn(scene, 'photo', 'texture', 'Photo', ['photo', 'texture']);
  groupIn(scene, 'video', 'texture', 'Video', ['vid', 'texture']);
  groupIn(scene, 'camera', 'vec3', 'Camera', ['cam', 'ro']);
  groupIn(scene, 'threshold', 'float', 'Cutout threshold', ['thr', 'value']);

  return [
    n('textureInput', 'photo', 40, 0, { fit: 'stretch', ...builtinImageParams(ROOM_AND_CAT_ID), ...note([
      'Texture: the built-in Room and cat photo. Choose your own picture on this card; the print takes its shape. A PNG with transparency works with Cutout: Alpha.',
    ]) }),
    n('videoInput', 'vid', 40, 260, { ...BALL_VIDEO_PARAMS, ...note([
      'Texture (video): the built-in Ball action clip, glowing balls on black: ideal for a brightness key.',
    ]) }),
    n('time', 'time', 40, 520, note(['Time: swings the camera.'])),
    n('constant', 'thr', 340, 260, { value: CUTOUT.threshold, outputType: 'float', ...note([
      'Cutout threshold: how bright the clip must be to stay (0.18). It goes to both cutout cards (in the scene, through the group\'s port, and the one at Hit Pos), so the shape and its colour agree. Play: Cutout threshold.',
    ]) }),
    expr('sway', 340, 420, {
      label: 'Sway', inputs: [{ name: 't', type: 'float' }], lines: [], result: '0.1 + 0.55 * sin(t * 0.2)', outputType: 'float', wires: { t: ['time', 'time'] },
      note: ['Sway: the camera\'s Angle, swinging slowly from −0.45 to 0.65 radians and back (about half a minute a swing), so you see the cutout turn to follow it while the print stays put.'],
    }),
    n('marchCamera', 'cam', 340, 0, { camDist: 3.0, camAngle: 0.1, camElevation: 0.16, rotSpeed: 0, fov: 1.5, targetY: 0.05, ...note([
      'March Camera: swinging round the cards (Angle from Sway). Its Ray Origin also goes to the cutout card (its Camera), so the card keeps facing it.',
    ]) }, { time: ['time', 'time'], camAngle: ['sway', 'result'] }),
    scene,
    n('marchLoopGroup', 'march', 940, 220, { maxSteps: 160, maxDist: 30, jitter: 0.5, bg: [0.03, 0.035, 0.05], subgraph: loopBody(), ...note([
      'March Loop: finds where each ray meets a card or the floor.',
    ]) }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('pictureCard', 'printHit', 1240, 0, { ...PRINT, ...note([
      'Picture Card (print) at Hit Pos: the same settings as the one in the scene, for the photo\'s colour where the ray hit it.',
    ]) }, { pos: ['march', 'pos'], picture: ['photo', 'texture'] }),
    n('pictureCard', 'ballsHit', 1240, 300, { ...CUTOUT, ...note([
      'Picture Card (cutout) at Hit Pos: the same settings and the same Camera wire, for the clip\'s colour (its Glow, as it is fully Emissive).',
    ]) }, { pos: ['march', 'pos'], picture: ['vid', 'texture'], camera: ['cam', 'ro'], threshold: ['thr', 'value'] }),
    expr('sun', 940, 640, {
      label: 'Sun', inputs: [{ name: 'height', type: 'float', slider: { min: 0.05, max: 1.5 } }], values: { height: 0.45 }, lines: [],
      result: 'normalize(vec3(-0.7, height, 0.55))', outputType: 'vec3',
      note: ['Sun: a low sun from the front left (height 0.45: long shadows), shared by the shadow and Multi-Light. Play: Sun height.'],
    }),
    n('softShadow', 'shadow', 1540, 560, { k: 14, tmax: 14, ...note(['Soft Shadow: the print\'s shadow and the balls\' cut-out shadows on the floor.']) },
      { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'], lightDir: ['sun', 'result'] }),
    expr('mat', 1540, 220, {
      label: 'Materials', inputs: [{ name: 'p', type: 'vec3' }, { name: 'printD', type: 'float' }, { name: 'printCol', type: 'vec3' }, { name: 'ballsD', type: 'float' }, { name: 'ballsCol', type: 'vec3' }, { name: 'ballsGlow', type: 'vec3' }],
      lines: [
        ['float onPrint', 'printD < 0.01 ? 1.0 : 0.0'],
        ['float onBalls', '(1.0 - onPrint) * (ballsD < 0.01 ? 1.0 : 0.0)'],
        ['vec3 floorCol', 'vec3(0.42, 0.4, 0.38) * (0.9 + 0.1 * sin(p.x * 3.0) * sin(p.z * 3.0))'],
        ['vec3 glow', 'ballsGlow * onBalls'],
      ],
      result: 'onPrint > 0.5 ? printCol : onBalls > 0.5 ? ballsCol : floorCol', outputType: 'vec3',
      wires: { p: ['march', 'pos'], printD: ['printHit', 'dist'], printCol: ['printHit', 'color'], ballsD: ['ballsHit', 'dist'], ballsCol: ['ballsHit', 'color'], ballsGlow: ['ballsHit', 'glow'] },
      exposed: [{ name: 'glow', type: 'vec3' }],
      note: [
        'Materials: onPrint where the print\'s Distance at the hit is (nearly) 0, onBalls the same for the cutout. The result is the colour for the lights: the photo on the print, the cutout\'s Color (black: it is all Glow) and a soft grey floor (floorCol, gently mottled).',
        'glow: the cutout\'s Glow, added after the lights.',
      ],
    }),
    n('multiLight', 'light', 1840, 220, { sunR: 1.5, sunG: 1.25, sunB: 1.0, skyR: 0.18, skyG: 0.22, skyB: 0.32, bounceR: 0.08, bounceG: 0.07, bounceB: 0.06, ...note([
      'Multi-Light: a warm low sun with its shadow, a cool sky fill, a little bounce.',
    ]) }, { baseColor: ['mat', 'result'], normal: ['march', 'normal'], hit: ['march', 'hit'], shadow: ['shadow', 'shadow'], sunDir: ['sun', 'result'] }),
    expr('final', 2140, 220, {
      label: 'Add the glow', inputs: [{ name: 'lit', type: 'vec3' }, { name: 'glow', type: 'vec3' }, { name: 'hit', type: 'float' }, { name: 'rd', type: 'vec3' }],
      lines: [['vec3 sky', 'mix(vec3(0.03, 0.035, 0.05), vec3(0.1, 0.12, 0.18), clamp(rd.y * 2.0 + 0.3, 0.0, 1.0))']],
      result: 'mix(sky, lit + glow, hit)', outputType: 'vec3',
      wires: { lit: ['light', 'color'], glow: ['mat', 'glow'], hit: ['march', 'hit'], rd: ['cam', 'rd'] },
      note: ['Add the glow: the lit scene plus the balls\' Glow; sky (a dim gradient by how high the ray looks) where the ray missed.'],
    }),
    n('toneMap', 'tone', 2440, 220, { mode: 'aces', ...note(['Tone Map (ACES).']) }, { color: ['final', 'result'] }),
    out(['tone', 'color'], 2700),
  ];
}

// ── 3 · Texture Material on a sphere, a box, a cylinder and the floor ─────────

const BOX_PLACE = { dim: '3', mode: 'place', x: 0.15, y: -0.2, z: -0.55, rx: 20, ry: 35, rz: 0 };
const CYL_PLACE = { dim: '3', mode: 'place', x: 1.25, y: -0.15, z: 0.35 };

function texturedShapes(): GraphNode[] {
  const scene = n('sceneGroup', 'scene', 640, 420, {
    label: 'Shapes', ...note(['A sphere, a turned box, a cylinder and a floor: plain shapes. The pictures are added after the March Loop, by Texture Material, at the hit point.']),
    subgraph: sub([
      n('scenePos', 'sp', 0, 240, { _groupOriginal: true, ...note(['Scene Pos: the point being measured.']) }),
      expr('ball', 300, 0, {
        label: 'Sphere', inputs: [{ name: 'p', type: 'vec3' }], lines: [], result: 'length(p - vec3(-1.1, -0.05, 0.2)) - 0.6', outputType: 'float', wires: { p: ['sp', 'pos'] },
        note: ['Sphere: radius 0.6, its centre at x −1.1, y −0.05, z 0.2.'],
      }),
      n('transform', 'boxAt', 300, 180, { ...BOX_PLACE, ...note(['Transform (Place): the box\'s own space, moved to (0.15, −0.2, −0.55) and turned 20° about X and 35° about Y. Its Local is the point as the box sees it.']) }, { p: ['sp', 'pos'] }),
      n('boxSDF3D', 'box', 600, 180, { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, edges: 'rounded', rounding: 0.04, ...note(['Box 3D: a cube 1 across with slightly rounded edges, in its own space.']) }, { pos: ['boxAt', 'p'] }),
      n('transform', 'cylAt', 300, 380, { ...CYL_PLACE, ...note(['Transform (Place): the cylinder\'s own space, moved to (1.25, −0.15, 0.35).']) }, { p: ['sp', 'pos'] }),
      n('cylinderSDF3D', 'cyl', 600, 380, { radius: 0.4, height: 0.6, ...note(['Cylinder: radius 0.4, 1.2 tall (Half Height 0.6), upright.']) }, { pos: ['cylAt', 'p'] }),
      n('planeSDF3D', 'floor', 600, 560, { height: -0.75, ...note(['Plane: the floor at y −0.75.']) }, { p: ['sp', 'pos'] }),
      expr('union', 900, 240, {
        label: 'Everything', inputs: [{ name: 'a', type: 'float' }, { name: 'b', type: 'float' }, { name: 'c', type: 'float' }, { name: 'f', type: 'float' }],
        lines: [], result: 'min(min(a, b), min(c, f))', outputType: 'float', wires: { a: ['ball', 'result'], b: ['box', 'dist'], c: ['cyl', 'dist'], f: ['floor', 'dist'] },
        note: ['Everything: the nearest of the four (min).'],
      }),
      n('sceneOutput', 'so', 1160, 240, { _groupOriginal: true, ...note(['Scene Output.']) }, { dist: ['union', 'result'] }),
    ]),
  });

  return [
    n('textureInput', 'photo', 40, 0, { fit: 'stretch', ...builtinImageParams(WALKWAY_CAT_ID), ...note([
      'Texture: the built-in Walkway cat photo (a portrait, 3:4). Choose your own picture or a video on this card: every Texture Material reads it through its Picture.',
    ]) }),
    n('time', 'time', 40, 260, note(['Time: the camera\'s clock (its Rot Speed is 0: raise it to circle the shapes).'])),
    n('marchCamera', 'cam', 340, 0, { camDist: 4.0, camAngle: 0.3, camElevation: 0.3, rotSpeed: 0, fov: 1.5, ...note(['March Camera: in front of the shapes, a little to one side and above. Drag Angle to walk round them.']) }, { time: ['time', 'time'] }),
    scene,
    n('marchLoopGroup', 'march', 940, 220, { maxSteps: 140, maxDist: 30, jitter: 0.5, bg: [0.05, 0.06, 0.08], subgraph: loopBody(), ...note(['March Loop: finds where each ray meets a shape.']) },
      { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('transform', 'boxHit', 1240, 300, { ...BOX_PLACE, ...note(['Transform (Place), the same as the box\'s in the scene, on Hit Pos: the hit point in the box\'s own space, so its picture turns with it. (Change both together.)']) }, { p: ['march', 'pos'] }),
    n('transform', 'cylHit', 1240, 520, { ...CYL_PLACE, ...note(['Transform (Place), the same as the cylinder\'s, on Hit Pos: the hit point in the cylinder\'s space.']) }, { p: ['march', 'pos'] }),
    expr('which', 1240, 760, {
      label: 'Which shape', inputs: [{ name: 'p', type: 'vec3' }, { name: 'pb', type: 'vec3' }, { name: 'pc', type: 'vec3' }],
      lines: [
        ['float dBall', 'length(p - vec3(-1.1, -0.05, 0.2)) - 0.6'],
        ['vec3 qb', 'abs(pb) - vec3(0.46)'],
        ['float dBox', 'length(max(qb, 0.0)) + min(max(qb.x, max(qb.y, qb.z)), 0.0) - 0.04'],
        ['vec2 qc', 'abs(vec2(length(pc.xz), pc.y)) - vec2(0.4, 0.6)'],
        ['float dCyl', 'min(max(qc.x, qc.y), 0.0) + length(max(qc, 0.0))'],
        ['float onFloor', 'p.y < -0.74 ? 1.0 : 0.0'],
        ['float onBall', 'dBall < 0.01 ? 1.0 : 0.0'],
        ['float onBox', 'dBox < 0.01 ? 1.0 : 0.0'],
        ['float onCyl', 'dCyl < 0.01 ? 1.0 : 0.0'],
      ],
      result: 'onBall', outputType: 'float', wires: { p: ['march', 'pos'], pb: ['boxHit', 'p'], pc: ['cylHit', 'p'] },
      exposed: [{ name: 'onBox', type: 'float' }, { name: 'onCyl', type: 'float' }, { name: 'onFloor', type: 'float' }],
      note: [
        'Which shape: each shape measured again at the hit point (dBall, dBox from the box\'s own point pb, dCyl from the cylinder\'s pc; qb and qc are the box and cylinder formulas\' halfway steps). A shape whose distance is (nearly) 0 is the one the ray hit: onBall (the result), onBox, onCyl, and onFloor below y −0.74. They are the Masks of the Texture Materials, so each picture lands only on its shape.',
      ],
    }),
    n('textureMaterial', 'floorTex', 1540, 0, { mapping: 'planarY', size: 1.6, combine: 'multiply', amount: 0.35, ...note([
      'Texture Material (Planar Y) on the floor: the photo projected straight down, one picture every 1.6 units, tiling (Edges: Repeat). Combine: Multiply over the grey Base colour, Amount 0.35: a faint print in the floor.',
      'Far away the tiles are many to a pixel: the picture is read at the right mipmap (from how fast the place on it changes across the screen), so the floor goes smoothly grey instead of shimmering.',
    ]) }, { pos: ['march', 'pos'], picture: ['photo', 'texture'], normal: ['march', 'normal'], base: ['base', 'result'], mask: ['which', 'onFloor'] }),
    expr('base', 1540, -200, {
      label: 'Base colour', inputs: [], lines: [], result: 'vec3(0.42, 0.41, 0.4)', outputType: 'vec3',
      note: ['Base colour: the shapes\' own colour (a mid grey), where no picture is.'],
    }),
    n('textureMaterial', 'ballTex', 1840, 0, { mapping: 'triplanar', size: 0.9, sharpness: 6, ...note([
      'Texture Material (Triplanar) on the sphere: the photo projected along X, Y and Z, each one 0.9 tall, blended by which way the surface faces (Blend sharpness 6). No pole pinching or seam, on any shape. Base is the floor\'s colour so far; Mask is Which shape\'s onBall.',
      'Triplanar reads the picture three times; Box (try it) reads it once, with crisp edges between the sides.',
    ]) }, { pos: ['march', 'pos'], picture: ['photo', 'texture'], normal: ['march', 'normal'], base: ['floorTex', 'color'], mask: ['which', 'result'] }),
    n('textureMaterial', 'boxTex', 2140, 0, { mapping: 'triplanar', size: 1.0, sharpness: 12, ...note([
      'Texture Material (Triplanar) on the box, read at the box\'s own point (Transform on Hit Pos), with Normal unwired: then it works the surface\'s direction out from that point, in the box\'s own space, so each face takes the right projection however the box is turned. Size 1: one picture per face. Sharpness 12: crisp faces.',
    ]) }, { pos: ['boxHit', 'p'], picture: ['photo', 'texture'], base: ['ballTex', 'color'], mask: ['which', 'onBox'] }),
    n('textureMaterial', 'cylTex', 2440, 0, { mapping: 'cylinder', size: 1.2, repeat: 2, ...note([
      'Texture Material (Cylinder) on the cylinder: wrapped round its sides like a label, twice round (Repeat round 2), one picture 1.2 tall; its caps take Planar Y. Read in the cylinder\'s own space.',
    ]) }, { pos: ['cylHit', 'p'], picture: ['photo', 'texture'], normal: ['march', 'normal'], base: ['boxTex', 'color'], mask: ['which', 'onCyl'] }),
    expr('sun', 1840, 400, {
      label: 'Sun', inputs: [], lines: [], result: 'normalize(vec3(-0.55, 0.75, 0.5))', outputType: 'vec3',
      note: ['Sun: the light\'s direction, shared by the shadow and Multi-Light.'],
    }),
    n('softShadow', 'shadow', 2140, 400, { k: 12, tmax: 12, ...note(['Soft Shadow: the shapes\' shadows on the floor.']) },
      { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'], lightDir: ['sun', 'result'] }),
    n('sdfAo', 'ao', 2140, 620, note(['SDF Ambient Occlusion: soft contact shadows where the shapes meet the floor.']), { scene: ['scene', 'scene'], pos: ['march', 'pos'], normal: ['march', 'normal'], hit: ['march', 'hit'] }),
    n('multiLight', 'light', 2740, 0, { sunR: 1.3, sunG: 1.2, sunB: 1.05, skyR: 0.3, skyG: 0.38, skyB: 0.5, background: 'colour', bgColor: [0.05, 0.06, 0.08], ...note([
      'Multi-Light: sun, sky and bounce over the pictures\' colours, which are lit and shadowed like any colour.',
    ]) }, { baseColor: ['cylTex', 'color'], normal: ['march', 'normal'], hit: ['march', 'hit'], ao: ['ao', 'ao'], shadow: ['shadow', 'shadow'], sunDir: ['sun', 'result'] }),
    n('toneMap', 'tone', 3040, 0, { mode: 'aces', ...note(['Tone Map (ACES).']) }, { color: ['light', 'color'] }),
    out(['tone', 'color'], 3300, 0),
  ];
}

export function buildPictures3DExamples(): Record<string, ExampleGraph> {
  return {
    pic3dVideoRoom: {
      ...PICTURES_3D_EXAMPLE_INDEX.pic3dVideoRoom, counter: 60, nodes: videoRoom(),
      play: play([
        ctl('e', 'cardHit::emissive', 'Emissive', 0, 1, 0.01),
        ctl('g', 'cardHit::brightness', 'Glow', 0, 4, 0.01),
        ctl('r', 'final::amount', 'Reflections', 0, 1, 0.01),
        ctl('a', 'cam::camAngle', 'Look round', -0.8, 1.6, 0.01),
      ], `**What it shows.** A video inside a ray-marched room. The card is a shape in the Scene Group like the walls and the ball, so it casts a shadow and a second March Loop sees it in the floor and the chrome ball.

**How it works.** The Picture Card inside the scene gives only a Distance: the march never reads the video. After the loop, a second card with the same settings at Hit Pos reads the video once, where the ray hit: **Color** goes into the lights like any surface colour, **Glow** is added after them. **Emissive** moves the picture from one to the other: 0 a print that needs light, 1 a screen that shines in the dark. (Emissive here changes the colour card only: the shape is the same.)

**Try.** Emissive 0 and watch the card go dark in its own shadow. Choose your own video or picture on the Texture card.`),
    },
    pic3dCutouts: {
      ...PICTURES_3D_EXAMPLE_INDEX.pic3dCutouts, counter: 60, nodes: cutouts(),
      play: play([
        ctl('t', 'thr::value', 'Cutout threshold', 0, 0.8, 0.005),
        ctl('h', 'sun::height', 'Sun height', 0.05, 1.5, 0.01),
        ctl('e', 'printHit::emissive', 'Print glows', 0, 1, 0.01),
      ], `**What it shows.** A print and a cutout. The photo card is lit: it is bright where the sun falls on it and casts a shadow. The video card is cut out by brightness, so only the glowing balls are left, and their shadows on the floor are cut out too.

**How it works.** **Cutout** turns the picture's alpha (Alpha) or brightness (Bright, Dark) into the card's shape: inside the march the card reads the picture only when a ray is within its thickness, and pushes the ray on through where it is cut away. **Billboard** turns the card to the camera (wire the camera's Ray Origin into Camera).

**Try.** Raise the threshold: fewer, smaller balls. Drop a PNG with transparency on the photo card and set its Cutout to Alpha (on both print cards).`),
    },
    pic3dTexturedShapes: {
      ...PICTURES_3D_EXAMPLE_INDEX.pic3dTexturedShapes, counter: 60, nodes: texturedShapes(),
      play: play([
        ctl('s', 'ballTex::sharpness', 'Blend sharpness', 1, 32, 0.5),
        ctl('z', 'ballTex::size', 'Sphere picture size', 0.2, 3, 0.01),
        ctl('t', 'boxTex::turn', 'Turn the box picture', -180, 180, 1),
        ctl('f', 'floorTex::amount', 'Floor print', 0, 1, 0.01),
      ], `**What it shows.** One photo on four shapes, each with a different Texture Material mapping: Triplanar on the sphere and the box, Cylinder on the cylinder, Planar Y on the floor.

**How it works.** Each Texture Material reads the picture at the hit point in its shape's own space (the box's through the same Transform as in the scene), with a Mask from Which shape, and passes its colour on as the next one's Base. The lights shade the result.

**Try.** On the sphere's Texture Material, Mapping Sphere (a globe) or Box; on the box's, Box. Choose your own picture or a video on the Texture card.`),
    },
  };
}
