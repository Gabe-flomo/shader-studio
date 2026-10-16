/**
 * build.ts — a Splat builder spec as a real node graph (docs/splat-builder.md). What a skilled user would wire:
 *
 *   March Camera ─► (world: the 3D Scene Builder's March Loop, lighting, Tone Map) ─┐
 *        │            or the background alone                                      ├─► Splat Scene ─► Tone Map ─► Bloom ─► Output
 *        └──────────────────────── Ray Origin / Ray Dir ───────────────────────────┘        ▲
 *   effect → effect → effect (Dissolve, Explode, Wave… one recipe node each) ───── Modifier ┘
 *
 * Every node has a note and a role (`_spRole`): a stable name for the part of the spec it comes from (`scan`,
 * `camera`, `fx:e2`, `w:march`), so a rebuild finds it again and keeps its id (Play controls stay pointed at it).
 * Numbers go on params, which are live uniforms: dragging a builder slider never recompiles.
 *
 * Pure: ids come from `idFor`.
 */
import type { GraphNode, InputSocket, OutputSocket } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { buildSceneGraph, tidy, ROLE_KEY as SB_ROLE } from '../sceneBuilder/build';
import { emptySpec, newShape, type SceneSpec, type ShapeSpec } from '../sceneBuilder/spec';
import { scaleSize } from '../sceneBuilder/viewMath';
import { findTex, standInId } from '../builders/textures';
import { SPLAT_MODIFIER_NOTES } from '../nodes/recipes/splatModifierRecipes';
import { EFFECT_INFO, EFFECT_TYPE, LIGHT_INFO, SPLAT_REVERSE_DEFAULTS, type CameraSpec, type SplatBuilderSpec } from './spec';

export const SP_ROLE = '_spRole';
export const SP_BUILD = '_spBuild';
/** On the Splat Scene: the spec it was built from, and fingerprints of what was built. */
export const SP_META = 'splatBuilder';

export interface SplatBuilderMeta {
  v: 1;
  spec: SplatBuilderSpec;
  build?: string;
  built?: Record<string, string>;
}

export type Ref = { nodeId: string; outputKey: string };

export interface SplatBuildResult {
  nodes: GraphNode[];
  /** What the Output shows. */
  final: Ref;
  scanId: string;
  warnings: string[];
  /** Your nodes: each run's end, and what feeds the run now (apply.ts wires the run's start to it). */
  customs: Array<{ tail: string; from: Ref | null }>;
}

const rad = (deg: number) => Math.round(deg * Math.PI / 180 * 1e6) / 1e6;
const ref = (n: GraphNode, outputKey: string): Ref => ({ nodeId: n.id, outputKey });

/** A node of `type`: sockets as defined, params = defaults + `params`, wires, a note and its role. */
function mk(list: GraphNode[], idFor: (role: string) => string, type: string, role: string, params: Record<string, unknown>, wires: Record<string, Ref | null | undefined>, note: string): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`Splat builder: unknown node type ${type}`);
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(def.inputs)) {
    const w = wires[k];
    inputs[k] = { type: s.type, label: s.label, ...(w ? { connection: { ...w } } : {}) };
  }
  const outputs: Record<string, OutputSocket> = {};
  for (const [k, s] of Object.entries(def.outputs)) outputs[k] = { type: s.type, label: s.label };
  const node: GraphNode = { id: idFor(role), type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params, __comment: note, [SP_ROLE]: role } };
  list.push(node);
  return node;
}

/** The March Camera's params for the builder's camera (its Perspective only when not Normal: an older build is as it was). */
export function cameraParams(c: CameraSpec): Record<string, number | string> {
  const proj: Record<string, number | string> = c.projection === 'orthographic' ? { projection: 'orthographic' }
    : c.projection === 'reverse' ? { projection: 'reverse', reverseStrength: c.reverse ?? SPLAT_REVERSE_DEFAULTS.reverse, reverseDist: c.converge ?? SPLAT_REVERSE_DEFAULTS.converge }
      : {};
  return { camDist: c.dist, camAngle: rad(c.angle), camElevation: rad(c.elev), rotSpeed: rad(c.turntable), fov: c.fov, targetX: c.target[0], targetY: c.target[1], targetZ: c.target[2], ...proj };
}

/** The camera's note's words for its Perspective. */
const projectionNote = (c: CameraSpec): string => (c.projection === 'orthographic'
  ? ' Orthographic: its rays run parallel, so the scan keeps its size however far it is (an isometric look); the splats are projected without dividing by depth.'
  : c.projection === 'reverse'
    ? ` Reverse perspective: its rays start spread out and meet ${c.converge ?? SPLAT_REVERSE_DEFAULTS.converge} in front (strength ${c.reverse ?? SPLAT_REVERSE_DEFAULTS.reverse}), so the far side of the scan looks bigger.`
    : '');

/** The 3D Scene Builder's spec for the world round the scan: its floor and shapes, the light, the background, the camera. */
export function worldSceneSpec(spec: SplatBuilderSpec): SceneSpec {
  const s = emptySpec();
  const W = spec.world, B = spec.background, L = LIGHT_INFO[W.light];
  const shapes: ShapeSpec[] = W.props.map((p, i) => newShape(p.kind, `s${i + 1}`, { at: [...p.at], size: scaleSize(p.kind, newShape(p.kind, 'x').size, p.size / 0.5), color: [...p.color], shine: 0.3 }));
  if (W.floor.on) shapes.push(newShape('plane', `s${shapes.length + 1}`, { name: 'Floor', size: { y: W.floor.y }, color: [...W.floor.color] }));
  s.root.children = shapes;
  s.look = {
    ...s.look, mode: 'surface', sunDir: [...L.sunDir], sunColor: [...L.sunColor], sky: [...L.sky], bounce: [...L.bounce],
    shadows: W.shadows ? 16 : 0, fog: W.fog, fogColor: null,
    bg: [...B.color], bg2: B.kind === 'gradient' ? [...B.color2] : null, bgTex: B.kind === 'picture' ? B.picture : null, tone: 'aces',
  };
  s.camera = { dist: spec.camera.dist, angle: spec.camera.angle, elev: spec.camera.elev, orbit: spec.camera.turntable, zoom: spec.camera.fov, flatten: 0, x: spec.camera.target[0], y: spec.camera.target[1], z: spec.camera.target[2],
    ...(spec.camera.projection === 'orthographic' ? { projection: 'orthographic' as const } : spec.camera.projection === 'reverse' ? { projection: 'reverse' as const, reverse: spec.camera.reverse ?? SPLAT_REVERSE_DEFAULTS.reverse, converge: spec.camera.converge ?? SPLAT_REVERSE_DEFAULTS.converge } : {}) };
  s.quality = { ...s.quality, maxDist: Math.max(20, spec.camera.dist * 4) };
  if (spec.textures?.length) s.textures = spec.textures;
  return s;
}

/** The world has something to march: a floor or a shape. */
export const hasWorld = (spec: SplatBuilderSpec) => spec.world.on && (spec.world.floor.on || spec.world.props.length > 0);

/**
 * The graph for `spec`. `idFor(role)` names each node (a rebuild passes the ids the nodes had). No Output node:
 * `final` is what to wire into it.
 */
export function buildSplatGraph(spec: SplatBuilderSpec, idFor: (role: string) => string = role => `sp_${role.replace(/[^A-Za-z0-9]/g, '_')}`, opts: { existing?: ReadonlySet<string> } = {}): SplatBuildResult {
  const nodes: GraphNode[] = [];
  const customs: SplatBuildResult['customs'] = [];
  const warnings: string[] = [];
  const C = spec.camera, B = spec.background;

  // ── The camera and what the scan sits in front of ──
  let camera: GraphNode;
  let scene: Ref;
  let dist: Ref | null = null, hit: Ref | null = null;
  if (hasWorld(spec)) {
    // The 3D Scene Builder's own graph, its roles under `w:` (the camera keeps the one role both ways).
    const world = buildSceneGraph(worldSceneSpec(spec), role => idFor(role === 'camera' ? 'camera' : `w:${role}`));
    for (const n of world.nodes) {
      const r = String(n.params[SB_ROLE] ?? '');
      n.params = { ...n.params, [SP_ROLE]: r === 'camera' ? 'camera' : `w:${r}` };
      delete n.params[SB_ROLE];
      // Not a 3D Scene Builder build: the world is the Splat builder's, reopened from the scan.
      nodes.push(n);
    }
    camera = nodes.find(n => n.params[SP_ROLE] === 'camera')!;
    const loop = nodes.find(n => n.params[SP_ROLE] === 'w:march')!;
    scene = world.final;
    dist = ref(loop, 'dist');
    hit = ref(loop, 'hit');
    for (const w of world.warnings) if (!/no shapes/.test(w)) warnings.push(w);
  } else {
    if (spec.world.on) warnings.push('The world has no floor and no shapes: add one under Scene, or turn the world off.');
    camera = mk(nodes, idFor, 'marchCamera', 'camera', cameraParams(C), {},
      `The camera: it turns round the scan (Angle, Elevation) at Distance, looking at Target. Every pixel becomes a ray from here; the Splat Scene draws the scan through the same camera.${projectionNote(C)}`);
    const pic = B.kind === 'picture' ? findTex(spec.textures, B.picture) : undefined;
    if (B.kind === 'picture' && !pic) warnings.push('The background picture is missing: pick one under Scene.');
    if (pic) {
      scene = ref(mk(nodes, idFor, 'pictureEnvironment', 'bg', { fov: C.fov }, {
        picture: { nodeId: standInId(pic), outputKey: 'texture' }, dir: ref(camera, 'rd'), forward: ref(camera, 'forward'), right: ref(camera, 'right'), up: ref(camera, 'up'),
      }, `The background: the picture “${pic.name}” as the backdrop the camera looks at (Picture Environment). It turns with the camera, so the scan sits in it.`), 'color');
    } else if (B.kind === 'gradient') {
      const top = mk(nodes, idFor, 'colorPicker', 'bg:top', { color: [...B.color] }, {}, 'The top of the background gradient (looking up).');
      const bottom = mk(nodes, idFor, 'colorPicker', 'bg:bottom', { color: [...B.color2] }, {}, 'The bottom of the background gradient (looking down).');
      const g = mk(nodes, idFor, 'gradient', 'bg', { mode: 'linear_y' }, { dir: ref(camera, 'rd'), color_a: ref(bottom, 'rgb'), color_b: ref(top, 'rgb') },
        'The background (Gradient, Linear Y on the camera\'s Ray Dir): by which way each ray points, from Bottom (straight down) to Top (straight up). It turns with the camera.');
      scene = ref(g, 'color');
    } else {
      scene = ref(mk(nodes, idFor, 'colorPicker', 'bg', { color: [...B.color] }, {}, 'The background: what shows where there is no scan.'), 'rgb');
    }
  }

  // ── The effects: one recipe node each, in the stack's order ──
  let modifier: Ref | null = null;
  for (const e of spec.effects) {
    if (!e.on) continue;
    if (e.kind === 'custom') {
      // Your nodes: not built, only wired in their place (the run's end feeds the next card).
      if (!e.tail || !opts.existing?.has(e.tail)) { warnings.push(`${e.label || 'Your nodes'}: not on the graph any more, left out.`); continue; }
      customs.push({ tail: e.tail, from: modifier });
      modifier = { nodeId: e.tail, outputKey: 'splat' };
      continue;
    }
    const type = EFFECT_TYPE[e.kind];
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e.params)) params[k] = Array.isArray(v) ? [...v] : v;
    // Sizes and distances in the scan's own size: the same look on a small object and on a whole place.
    if (getNodeDefinition(type)?.paramDefs?.relative) params.relative = true;
    const notes = SPLAT_MODIFIER_NOTES[type] ?? [EFFECT_INFO[e.kind].line];
    const fx = mk(nodes, idFor, type, `fx:${e.id}`, params, { splat: modifier }, [...notes, 'Made by the Splat builder: its Effects section reorders, adds and removes these.'].join('\n'));
    if (e.animate) {
      const key = e.animate.param;
      const pd = getNodeDefinition(type)?.paramDefs?.[key];
      const lo = e.animate.from, hi = e.animate.to;
      const lfo = mk(nodes, idFor, 'lfo', `fx:${e.id}:lfo`, { waveform: 'sine', freq: e.animate.speed, amplitude: (hi - lo) / 2, offset: (hi + lo) / 2 }, {},
        `LFO: sweeps ${EFFECT_INFO[e.kind].label}'s ${pd?.label ?? key} slowly from ${lo} to ${hi} and back (Freq is how fast). Wired into its socket, so it replaces the slider while connected.`);
      fx.inputs[`__param_${key}`] = { type: 'float', label: pd?.label ?? key, connection: ref(lfo, 'value') };
    }
    modifier = ref(fx, 'splat');
  }

  // ── The scan ──
  const S = spec.scan, P = spec.place;
  const source: Record<string, unknown> = S.source.kind === 'file'
    ? { videoId: S.source.videoId, fileName: S.source.fileName, bytes: S.source.bytes }
    : { demo: S.source.demo, demoCount: S.source.count };
  const scan = mk(nodes, idFor, 'splatScene', 'scan', {
    ...source,
    position: [...P.position], rotation: [...P.rotation], scale: P.scale, up: P.up, splatSize: P.splatSize, opacity: P.opacity,
    maxSplats: String(S.maxSplats), shDegree: String(S.shDegree), sortRate: S.sort, resolution: S.resolution,
    // The builder's Place maths (place.ts) turn about the file's origin and keep the middle in place themselves.
    pivot: 'origin',
  }, { ro: ref(camera, 'ro'), rd: ref(camera, 'rd'), scene, dist, hit, modifier },
  [
    S.source.kind === 'file' ? `Splat Scene: the scan “${S.source.fileName}”.` : 'Splat Scene: a generated example scan (no file). Load your own in the Splat builder\'s Scan section, or drop a .ply, .splat or .spz on this card.',
    'Seen through the March Camera, so it sits in the same space as the background' + (dist ? ' and the ray-marched world: at each pixel the nearer one wins.' : '.'),
    'Made by the Splat builder: right-click → Edit in Splat builder, or open the Scene builder and pick Edit this one.',
  ].join('\n'));

  // ── The look ──
  // Bloom is the same-frame chain (Pass → Glow (texture), Bloom → Add glow): the old Bloom node reads the frame before,
  // its own glow included, so on a bright scan the glow fed back into itself frame after frame and washed it out.
  // Then the tone map, after the glow, so the added light rolls off instead of clipping.
  let final: Ref = ref(scan, 'color');
  if (spec.look.bloom.on) {
    const b = spec.look.bloom;
    const pass = mk(nodes, idFor, 'pass', 'bloom:pass', { scale: '1', format: 'half' }, { color: final },
      'Pass: the picture as a texture, this frame, so the glow reads round each pixel without waiting a frame (and never reads its own glow back). Half float keeps brightness above 1.');
    const glow = mk(nodes, idFor, 'glowTexture', 'bloom', { method: 'bloom', threshold: b.threshold, knee: 0.25, radius: Math.min(64, Math.max(1, b.radius * 0.5)), intensity: b.intensity, tail: 0.4 }, { texture: ref(pass, 'texture') },
      'Glow (texture), Bloom chain: the parts brighter than Threshold, blurred wide (Radius) with a tight core, at Intensity.');
    const def = getNodeDefinition('exprNode')!;
    const add: GraphNode = {
      id: idFor('bloom:add'), type: 'exprNode', position: { x: 0, y: 0 },
      inputs: { picture: { type: 'vec3', label: 'picture', connection: ref(pass, 'color') }, glow: { type: 'vec3', label: 'glow', connection: ref(glow, 'glow') } },
      outputs: { result: { type: 'vec3', label: 'Result' } },
      params: {
        ...(def.defaultParams ?? {}), label: 'Add glow', outputType: 'vec3', lines: [], result: 'picture + glow', expr: 'picture + glow',
        inputs: [{ name: 'picture', type: 'vec3', slider: null }, { name: 'glow', type: 'vec3', slider: null }],
        __comment: 'Add glow: the picture with the glow added on top (light adds).', [SP_ROLE]: 'bloom:add',
      },
    };
    nodes.push(add);
    final = ref(add, 'result');
  }
  if (spec.look.tone !== 'none') {
    final = ref(mk(nodes, idFor, 'toneMap', 'tone', { mode: spec.look.tone }, { color: final }, 'Tone Map: rolls bright colours off gently instead of clipping them (the scan\'s own colours are already for a screen, so this mostly shapes glows and highlights).'), 'color');
  }

  tidy(nodes, 0, 0);
  return { nodes, final, scanId: scan.id, warnings, customs };
}

/** The spec a Splat Scene the builder made carries. */
export function splatMetaOf(node: GraphNode | undefined | null): SplatBuilderMeta | null {
  const m = node?.params?.[SP_META] as SplatBuilderMeta | undefined;
  return m && m.v === 1 && m.spec && Array.isArray(m.spec.effects) ? m : null;
}

/** A stand-alone graph (with its own Output): tests and thumbnails. */
export function buildSplatStandalone(spec: SplatBuilderSpec, idFor?: (role: string) => string): SplatBuildResult & { outputId: string } {
  const built = buildSplatGraph(spec, idFor);
  const def = getNodeDefinition('output')!;
  const scan = built.nodes.find(n => n.id === built.scanId)!;
  scan.params = { ...scan.params, [SP_META]: { v: 1, spec: structuredClone(spec) } satisfies SplatBuilderMeta };
  const last = built.nodes.find(n => n.id === built.final.nodeId)!;
  built.nodes.push({
    id: 'out', type: 'output', position: { x: last.position.x + 440, y: last.position.y },
    inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label, connection: { ...built.final } } },
    outputs: {}, params: {},
  });
  return { ...built, outputId: 'out' };
}
