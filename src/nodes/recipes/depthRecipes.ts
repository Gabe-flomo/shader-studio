/**
 * depthRecipes.ts — "Add a picture with depth" on a March Loop (or GI Lit) card (docs/depth-node.md "Add a picture
 * with depth"): one click puts a photo inside the 3D scene, wired and placed beside the loop.
 *
 *   Texture Input (empty: drop an image on it) → Depth → Depth Composite (the picture, its depth, and the loop's
 *   Color / Distance / Hit) → the Output, where the loop fed it.
 *   Lit: + Depth Light after the composite, its Glowing scene and Shadows from the loop's Scene, the March Camera's
 *   rays, only on the picture (1 − Scene in front), and linked to the scene's first object (nodes/sceneLink.ts).
 *   Reflecting: + Picture Environment, so the objects mirror the picture and take its average colour.
 *
 * "Turn the camera to face the picture" (a choice in the offer) sets the March Camera's Angle and Elevation to 0 and
 * stops its orbit: a photo is seen from the front.
 *
 * The picture's source comes from one helper, pictureSource(), so a unified Texture node can take its place.
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { RecipeBuild, RecipeContext, StarterRecipe, Wire } from './types';
import { SELF, col, n, note } from './kit';
import { linkColourSource, linkTargets, withLinkOutputs, LINK_AT, LINK_COL } from '../sceneLink';

/** The offer's key in STARTER_RECIPES (opened from the March Loop card, not when a node is added). */
export const PICTURE_DEPTH_SET = 'pictureDepth';
/** The option the offer's checkbox sets. */
export const FACE_CAMERA_OPTION = 'faceCamera';

/** The picture: an empty image source the user drops a picture onto. The one place its node type is chosen. */
export function pictureSource(id: string, x: number, y: number): GraphNode {
  return n('textureInput', id, x, y, { fit: 'cover', ...note(
    'The picture: drop an image file onto this card (or click it to choose one). Until then it is black.',
    'Why: Depth works out how far each part of it is, and Depth Composite puts the 3D objects in front of or behind it.',
  ) });
}

const wireOf = (node: GraphNode, key: string): Wire | null => {
  const c = node.inputs[key]?.connection;
  return c ? [c.nodeId, c.outputKey] : null;
};

type Kind = 'composite' | 'lit' | 'reflect';

function build(ctx: RecipeContext, kind: Kind): RecipeBuild {
  const self = ctx.self;
  const tag = { __pictureDepth: self.id };
  const out: GraphNode[] = [];
  const add = (nd: GraphNode) => { nd.params = { ...nd.params, ...tag }; out.push(nd); return nd; };
  const patch: NonNullable<RecipeBuild['patch']> = [];
  const sceneWire = wireOf(self, 'scene');
  const ro = wireOf(self, 'ro'), rd = wireOf(self, 'rd');
  const camera = ro ? ctx.nodes.find(nd => nd.id === ro[0] && nd.type === 'marchCamera') : undefined;
  // What the Output shows now: the loop's Color, or the lighting after it.
  // Picked again: what the last one composited over (it is taken out), not the last one itself.
  const mine = (id: string) => ctx.nodes.find(nd => nd.id === id)?.params.__pictureDepth === self.id;
  let shownNow = ctx.shown;
  for (let guard = 0; shownNow && mine(shownNow[0]) && guard < 8; guard++) {
    const nd = ctx.nodes.find(x => x.id === shownNow![0])!;
    const back = nd.type === 'depthComposite' || nd.type === 'exprNode' ? wireOf(nd, 'scene') : wireOf(nd, 'picture');
    shownNow = back;
  }
  const scene: Wire = shownNow ?? [SELF, 'color'];

  const pic = add(pictureSource('pic', col(-1), 560));
  const depth = add(n('depth', 'depth', col(0), 560, { ...note(
    'Depth: how far each part of the picture is, worked out on this device (a one-time model download on the card).',
    'Why: the composite needs it to know what is in front of what.',
  ) }, { texture: [pic.id, 'texture'] }));

  let sceneIn: Wire = scene;
  if (kind === 'reflect') {
    const camAxes: Record<string, Wire> = camera ? { forward: [camera.id, 'forward'], right: [camera.id, 'right'], up: [camera.id, 'up'] } : {};
    const dirExpr = n('exprNode', 'reflDir', col(1), 900, {
      label: 'Mirror direction', outputType: 'vec3', lines: [], result: 'reflect(normalize(rd), normalize(normal))', expr: 'reflect(normalize(rd), normalize(normal))',
      inputs: [{ name: 'rd', type: 'vec3', slider: null }, { name: 'normal', type: 'vec3', slider: null }],
      ...note('Where a mirror at each hit point looks: the camera\'s ray bounced off the surface.', 'Why: Picture Environment reads the picture in that direction.'),
    });
    dirExpr.inputs = { rd: { type: 'vec3', label: 'rd', ...(rd ? { connection: { nodeId: rd[0], outputKey: rd[1] } } : {}) }, normal: { type: 'vec3', label: 'normal', connection: { nodeId: SELF, outputKey: 'normal' } } };
    dirExpr.outputs = { result: { type: 'vec3', label: 'Result' } };
    add(dirExpr);
    add(n('pictureEnvironment', 'env', col(2), 900, { fov: typeof camera?.params.fov === 'number' ? camera.params.fov : 1.5, blur: 0.01, ...note(
      'Picture Environment: the picture as the room round the objects. Color is what a mirror sees, Ambient the picture\'s average colour.',
      'Why: a chrome sphere shows the photo. Outside the photo\'s frame it is mirrored back in (the camera only saw the front).',
    ) }, { picture: [pic.id, 'texture'], dir: ['reflDir', 'result'], ...camAxes }));
    const mix = n('exprNode', 'reflect', col(3), 900, {
      label: 'Reflect the picture', outputType: 'vec3', lines: [
        { lhs: 'float facing', op: '=', rhs: 'max(dot(-normalize(rd), normalize(normal)), 0.0)' },
        { lhs: 'float fres', op: '=', rhs: 'reflectivity + (1.0 - reflectivity) * pow(1.0 - facing, 5.0)' },
      ], result: 'mix(scene * mix(vec3(1.0), ambient * 1.6, ambientMix), env, clamp(hit * fres, 0.0, 1.0))',
      expr: 'mix(scene * mix(vec3(1.0), ambient * 1.6, ambientMix), env, clamp(hit * fres, 0.0, 1.0))',
      inputs: [
        { name: 'scene', type: 'vec3', slider: null }, { name: 'env', type: 'vec3', slider: null }, { name: 'ambient', type: 'vec3', slider: null },
        { name: 'normal', type: 'vec3', slider: null }, { name: 'rd', type: 'vec3', slider: null }, { name: 'hit', type: 'float', slider: null },
        { name: 'reflectivity', type: 'float', slider: { min: 0, max: 1 } }, { name: 'ambientMix', type: 'float', slider: { min: 0, max: 1 } },
      ],
      reflectivity: 0.35, ambientMix: 0.5,
      ...note(
        'The objects mirror the picture: more at grazing angles (Fresnel, Schlick\'s formula), at least Reflectivity facing you. Ambient Mix tints them by the picture\'s average colour.',
        'Why: objects that pick up the room\'s light and reflections sit in the photo instead of on top of it.',
      ),
    });
    const w = (from: Wire | null) => (from ? { connection: { nodeId: from[0], outputKey: from[1] } } : {});
    mix.inputs = {
      scene: { type: 'vec3', label: 'scene', ...w(scene) }, env: { type: 'vec3', label: 'env', ...w(['env', 'color']) }, ambient: { type: 'vec3', label: 'ambient', ...w(['env', 'ambient']) },
      normal: { type: 'vec3', label: 'normal', ...w([SELF, 'normal']) }, rd: { type: 'vec3', label: 'rd', ...w(rd) }, hit: { type: 'float', label: 'hit', ...w([SELF, 'hit']) },
      reflectivity: { type: 'float', label: 'reflectivity' }, ambientMix: { type: 'float', label: 'ambientMix' },
    };
    mix.outputs = { result: { type: 'vec3', label: 'Result' } };
    add(mix);
    sceneIn = ['reflect', 'result'];
  }

  add(n('depthComposite', 'composite', col(kind === 'reflect' ? 4 : 2), 280, { ...note(
    'Depth Composite: the picture and the 3D scene, the nearer one at each pixel, so objects pass behind and in front of what is in the photo.',
    'Set Nearest / Farthest with Show: Picture distance so the objects sit where you expect.',
  ) }, { picture: [pic.id, 'color'], nearness: [depth.id, 'depth'], scene: sceneIn, dist: [SELF, 'dist'], hit: [SELF, 'hit'] }));
  let shown: Wire = ['composite', 'color'];

  if (kind !== 'composite') {
    const onlyPicture = n('exprNode', 'onlyPicture', col(kind === 'reflect' ? 5 : 3), 620, {
      label: 'Only the picture', outputType: 'float', lines: [], result: '1.0 - front', expr: '1.0 - front',
      inputs: [{ name: 'front', type: 'float', slider: null }],
      ...note('1 where the picture shows, 0 where a 3D object is in front.', 'Why: the light relights the picture, not the objects (they have their own lighting).'),
    });
    onlyPicture.inputs = { front: { type: 'float', label: 'front', connection: { nodeId: 'composite', outputKey: 'front' } } };
    onlyPicture.outputs = { result: { type: 'float', label: 'Result' } };
    add(onlyPicture);
    // Linked to the scene's first object, so the light sits in the glowing shape and takes its colour.
    const sceneNode = sceneWire ? ctx.nodes.find(nd => nd.id === sceneWire[0] && nd.type === 'sceneGroup') : undefined;
    const target = sceneNode ? linkTargets(sceneNode)[0] : undefined;
    const colour = sceneNode && target ? linkColourSource(ctx.nodes, sceneNode, target.id) : null;
    const lightWires: Record<string, Wire> = {
      picture: ['composite', 'color'], nearness: [depth.id, 'depth'], mask: ['onlyPicture', 'result'],
      ...(ro ? { ro } : {}), ...(rd ? { rd } : {}),
      ...(sceneWire ? { glow: sceneWire, occluders: sceneWire } : {}),
      ...(sceneNode && target ? { lightPos: [sceneNode.id, `${LINK_AT}${target.id}`] as Wire } : {}),
      ...(sceneNode && target && colour ? { lightColor: [sceneNode.id, `${LINK_COL}${target.id}`] as Wire } : {}),
    };
    // The light sits inside its shape: the shadow ray stops at the shape's radius (Light size), so the shape doesn't shadow its own light.
    const inner = (sceneNode?.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes ?? [];
    const shape = target ? (target.kind === 'shape' ? inner.find(x => x.id === target.id) : inner.find(x => Object.values(x.inputs).some(i => i.connection?.nodeId === target.id) && typeof x.params.radius === 'number')) : undefined;
    const radius = typeof shape?.params.radius === 'number' ? shape.params.radius : 0.05;
    add(n('depthLight', 'light', col(kind === 'reflect' ? 6 : 4), 280, {
      lightRadius: Math.round((radius + 0.02) * 100) / 100, glowIntensity: 0.6, glowReach: 0.3,
      ...(sceneNode && target ? { link: { scene: sceneNode.id, object: target.id, label: target.label } } : {}),
      ...note(
        `Depth Light: the scene's light on the picture. The Glowing scene's shapes light it from where they are${sceneNode && target ? `, and its point light follows ${target.label}` : ''}; Shadows from lets the objects shade it.`,
        'Why: a glowing object behind someone lights their shoulder. Change the light on this card ("Link to scene object…", "Add a light").',
      ),
    }, lightWires));
    if (sceneNode && target) patch.push({ id: sceneNode.id, outputs: withLinkOutputs(sceneNode, target, !!colour).outputs });
    shown = ['light', 'color'];
  }

  if (camera) {
    const face = !!ctx.options?.[FACE_CAMERA_OPTION];
    // A camera saved before Forward / Right / Up gets them (Picture Environment reads them).
    const axes = kind === 'reflect' && !camera.outputs.forward
      ? { ...camera.outputs, forward: { type: 'vec3' as const, label: 'Forward' }, right: { type: 'vec3' as const, label: 'Right' }, up: { type: 'vec3' as const, label: 'Up' } }
      : undefined;
    if (face || axes) patch.push({ id: camera.id, ...(face ? { params: { camAngle: 0, camElevation: 0, rotSpeed: 0 } } : {}), ...(axes ? { outputs: axes } : {}) });
  }

  return {
    nodes: out,
    remove: ctx.nodes.filter(nd => nd.params.__pictureDepth === self.id).map(nd => nd.id),
    show: shown,
    patch,
  };
}

export const PICTURE_DEPTH_RECIPES: StarterRecipe[] = [
  { id: 'depth-composite', label: 'Picture with depth', description: 'A picture (drop an image on it), its Depth, and a Depth Composite: the 3D objects go behind and in front of what is in the photo.', build: ctx => build(ctx, 'composite') },
  { id: 'depth-lit', label: '…lit by the scene', description: 'The same, plus a Depth Light: the scene\'s glowing shapes light the picture and the objects shadow it. Its light follows the scene\'s first shape.', build: ctx => build(ctx, 'lit') },
  { id: 'depth-reflect', label: '…lit, and reflected', description: 'Lit as above, and the objects reflect the picture and take its colour (Picture Environment): a chrome sphere shows the room.', build: ctx => build(ctx, 'reflect') },
];
