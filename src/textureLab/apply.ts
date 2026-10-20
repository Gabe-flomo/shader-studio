/**
 * apply.ts — a Texture Lab build as real nodes in the user's graph (docs/texture-lab.md):
 *
 *   Texture Input ─► [Pass] ─► Blur ─► Mix (Amount) ─► [Pass] ─► Glow ─► Mix (Amount) ─► … ─► Output
 *        └─────────────────────────────┘ (A: the picture as it came in)
 *
 * Each block is its Texture tools node, with a Mix after it: Blend is the block's Amount, and a mute gate on the Mix
 * passes the picture through live when the block is muted. A block that reads the pixels round each one gets a Pass in
 * front of it when what comes in was computed (a texture straight from the source needs none). Helpers a block needs
 * (a jump flood's seed mask and repeated Pass, Change's Pass, Flow's Read, Depth fog's Depth) carry the block's id in
 * their role too.
 *
 * Every node carries its role (`_txRole`: "source", "b2:main", "b2:pass", "b2:mix"…) and its build (`_txBuild`); the
 * source keeps the spec (`params.textureLab`), so Edit this one reopens it. A rebuild keeps each node's id per role (Play
 * controls stay pointed at them) and wires you made into sockets the builder doesn't set. While the builder is open its
 * preview (a before / after split, or the stack shown up to one block) is built too, and left out on Done. Pure.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { placeInFreeSpace } from '../store/agentSetup';
import { n, nv } from '../store/graphBuilder';
import { gateNode } from '../builders/mute';
import { passBudget } from '../compiler/passBudget';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';
import { BALL_VIDEO } from '../lib/builtinVideos';
import { blockDef, viewOf, type BlockDef } from './blocks';
import { TX_BUILD, TX_META, TX_ROLE, blockLabel, defaultsOf, normalizeSpec, specParams, type Params, type TextureLabSpec, type TxBlock } from './spec';
import { findTxBuild, ownsSource, type TxMeta } from './meta';

export { buildDetail, findTxBuild, labOfBuild, txBuildIds, txMetaOf, type TxMeta } from './meta';

type Wire = [nodeId: string, outputKey: string];

/** A Video Input playing the built-in Ball action clip, looping. */
export const BALL_VIDEO_PARAMS: Params = { videoId: BALL_VIDEO.id, _fileName: BALL_VIDEO.name, _hasFile: true, _isPlaying: true, _loop: true, _speed: 1 };


/**
 * The build as it is now: its saved spec, with each block's settings, Amount and mute as the graph has them (a
 * setting changed on a card is what the builder shows). Pure.
 */
export function specOfBuild(graph: readonly GraphNode[], sourceId: string): TextureLabSpec | null {
  const b = findTxBuild(graph, sourceId);
  if (!b) return null;
  const spec = normalizeSpec(b.meta.spec);
  if (ownsSource(spec)) spec.source = { ...spec.source, params: specParams(b.source.params) };
  for (const block of spec.blocks) {
    const main = b.byRole.get(`${block.id}:main`);
    if (main && main.type === block.type) block.params = { ...block.params, ...specParams(main.params) };
    const mix = b.byRole.get(`${block.id}:mix`);
    if (mix) {
      const t = Number(mix.params.t);
      if (Number.isFinite(t)) block.amount = t;
      if (typeof mix.params.__mute === 'number') block.muted = mix.params.__mute > 0;
    }
    for (const role of Object.keys(block.aux ?? {})) {
      const aux = b.byRole.get(`${block.id}:${role}`);
      if (aux) block.aux![role] = { ...block.aux![role], ...specParams(aux.params) };
    }
  }
  return spec;
}

// ── Notes ────────────────────────────────────────────────────────────────────

const SOURCE_NOTE: Record<'room' | 'walkway' | 'ball', string> = {
  room: 'Texture Input (Texture Lab\'s source): the built-in "Room and cat" photo, a warm-lit bedroom with a grey cat held close. Load your own with Load image on this card, or choose another source in Texture Lab.',
  walkway: 'Texture Input (Texture Lab\'s source): the built-in "Walkway cat" photo, a grey cat held up on a stone walkway. Load your own with Load image on this card, or choose another source in Texture Lab.',
  ball: 'Video Input (Texture Lab\'s source): the built-in Ball action clip, glowing balls swirling into mandalas, looping. Choose video (or the camera) on this card for yours.',
};

function mainNote(def: BlockDef, block: TxBlock, i: number, count: number, why: string): string {
  const desc = getNodeDefinition(def.type)?.label ?? def.label;
  const view = viewOf(def, block.view);
  return [
    `${desc} (made by Texture Lab, block ${i + 1} of ${count}): ${def.line.charAt(0).toLowerCase()}${def.line.slice(1)}.`,
    `${why}${def.views.length > 1 ? ` Texture Lab shows its ${view.label} output.` : ''} Every slider is a live uniform: right-click one in Texture Lab or here to make it a Play control.`,
  ].join('\n');
}

const passNote = (label: string) => `Pass (made by Texture Lab for ${label}): holds the picture so far as a texture. ${label} reads the pixels round each one, and a chain of nodes only knows this pixel; the Pass draws all of it first. It costs 1 of the 8 full-quality passes.`;
const mixNote = (label: string) => `Mix (Texture Lab's Amount for ${label}): A is the picture as it came in, B what ${label} made, Blend how much of B (1: all of it). Muting the block in Texture Lab passes A through, live, with nothing recompiled.`;

// ── Building ─────────────────────────────────────────────────────────────────

export interface ApplyTxOptions {
  nextId: () => string;
  /** The build to replace (its source node), when there is one. */
  sourceId?: string | null;
  at?: { x: number; y: number };
  /** The builder's preview (left out on Done): a before / after split at this fraction of the width, the stack shown up to one block. */
  preview?: { split?: number | null; upTo?: string | null };
}

export interface ApplyTxResult {
  nodes: GraphNode[];
  sourceId: string;
  /** Each block's nodes, by role. */
  roles: Map<string, string>;
}

const COL = 400;
const ROW = 320;

/**
 * The graph with `spec0` built into it: new (no `sourceId`, or it isn't a build), or replacing the build of
 * `sourceId`. The Output shows the end of the stack. Pure.
 */
export function applyTextureLab(graph: readonly GraphNode[], spec0: TextureLabSpec, opts: ApplyTxOptions): ApplyTxResult {
  const spec = normalizeSpec(spec0);
  const found = opts.sourceId ? findTxBuild(graph, opts.sourceId) : null;
  const taken = new Set(graph.map(nd => nd.id));
  const nextId = () => { let id = opts.nextId(); while (taken.has(id)) id = opts.nextId(); taken.add(id); return id; };
  const build = found?.meta.build ?? `tx${nextId()}`;
  const old = new Map(found?.byRole ?? []);

  // A node of yours as the source: it stays yours. A missing one falls back to the Room and cat photo.
  const userSource = spec.source.kind === 'node' ? graph.find(nd => nd.id === spec.source.nodeId) ?? null : null;
  if (spec.source.kind === 'node' && !userSource) spec.source = { kind: 'room' };
  const oldSourceIsYours = !!found && !ownsSource(normalizeSpec(found.meta.spec));
  const builderIds = new Set([...old.values()].map(nd => nd.id));
  if (oldSourceIsYours && found) { builderIds.delete(found.source.id); old.delete('source'); }
  if (userSource) builderIds.delete(userSource.id);
  // Wires from these into a built node are the builder's: a rebuild sets them again (or leaves them off).
  const managedFrom = new Set([...old.values()].map(nd => nd.id));
  if (userSource) managedFrom.add(userSource.id);
  if (found) managedFrom.add(found.source.id);

  // Keep places when the stack's order is as it was (a setting changed); lay it out again when it moved.
  const order = (s: TextureLabSpec) => [s.source.kind, s.source.nodeId ?? '', ...s.blocks.map(b => `${b.id}:${b.type}`)].join('|');
  const keepPlaces = !!found && order(normalizeSpec(found.meta.spec)) === order(spec);

  const made = new Map<string, GraphNode>();
  const anchor = userSource?.position ?? found?.source.position ?? { x: 0, y: 0 };
  const place = (role: string, x: number, y: number) => {
    const prev = old.get(role);
    return keepPlaces && prev ? { ...prev.position } : { x: anchor.x + x, y: anchor.y + y };
  };

  /** A node for `role`: the old one (its id, its own wires from outside the build) or a new one. */
  const make = (role: string, type: string, params: Params, wires: Record<string, Wire>, x: number, y: number, note: string, vector = false): GraphNode => {
    const prev = old.get(role);
    const id = prev?.id ?? nextId();
    const fresh = vector ? nv('vec3', type, id, 0, 0, params) : n(type, id, 0, 0, params);
    const base = prev && prev.type === type ? prev : fresh;
    const inputs: GraphNode['inputs'] = {};
    for (const [k, s] of Object.entries(base.inputs)) {
      inputs[k] = s.connection && managedFrom.has(s.connection.nodeId) ? { ...s, connection: undefined } : { ...s };
    }
    for (const [k, w] of Object.entries(wires)) if (inputs[k]) inputs[k] = { ...inputs[k], connection: { nodeId: w[0], outputKey: w[1] } };
    const own: Params = {};
    if (prev) for (const k of Object.keys(prev.params)) if (k.startsWith('_fold') || k === 'label') own[k] = prev.params[k];
    const node: GraphNode = {
      ...base, id, position: place(role, x, y), inputs, outputs: { ...base.outputs },
      params: { ...(getNodeDefinition(type)?.defaultParams ?? {}), ...(vector ? { outputType: 'vec3' } : {}), ...params, ...own, __comment: note, [TX_ROLE]: role, [TX_BUILD]: build },
    };
    delete (node as { bypassed?: boolean }).bypassed;
    made.set(role, node);
    return node;
  };

  // ── The source ──
  let srcId: string;
  let cur: { color: Wire; texture?: Wire };
  if (userSource) {
    srcId = userSource.id;
    const tex = Object.entries(userSource.outputs).find(([, o]) => o.type === 'texture')?.[0];
    const vec = (k: string | undefined) => (k && userSource!.outputs[k] && userSource!.outputs[k].type !== 'texture' ? k : undefined);
    const colourKey = vec(spec.source.output) ?? vec('color') ?? Object.entries(userSource.outputs).find(([, o]) => o.type === 'vec3')?.[0] ?? Object.keys(userSource.outputs)[0];
    cur = { color: [srcId, colourKey], ...(tex && (spec.source.output === undefined || spec.source.output === tex) ? { texture: [srcId, tex] as Wire } : {}) };
  } else {
    const kind = spec.source.kind as 'room' | 'walkway' | 'ball';
    const type = kind === 'ball' ? 'videoInput' : 'textureInput';
    const own = kind === 'ball' ? BALL_VIDEO_PARAMS : { fit: 'stretch', ...builtinImageParams(kind === 'walkway' ? WALKWAY_CAT_ID : ROOM_AND_CAT_ID) };
    const prev = old.get('source');
    const kept = prev && prev.type === type && found && found.meta.spec.source.kind === kind ? specParams(prev.params) : {};
    // Always Stretch: its Color then lines up with its Texture (what the tools that read round each pixel take, which
    // covers the picture as Stretch does). Fill cropped the colour but not the texture, so a relief or a mask landed
    // off the picture (builds made before kept Fill). Texture Lab draws at the photo's shape, so nothing is stretched.
    const src = make('source', type, { ...own, ...(spec.source.params ?? {}), ...kept, ...(type === 'textureInput' ? { fit: 'stretch' } : {}) }, {}, 0, 0, SOURCE_NOTE[kind]);
    srcId = src.id;
    cur = { color: [srcId, 'color'], texture: [srcId, 'texture'] };
  }
  const before = cur.color;
  const sourceTex = cur.texture;

  // ── The blocks ──
  const ends = new Map<string, Wire>();
  const count = spec.blocks.length;
  spec.blocks.forEach((block, i) => {
    const def = blockDef(block.type)!;
    const label = blockLabel(block);
    const cx = COL * (1 + 2 * i);
    const r = (s: string) => `${block.id}:${s}`;
    const roleId = (s: string) => made.get(r(s))?.id ?? '';
    let passWhy = '';
    const passOf = (from: Wire, extra: Params = {}): Wire => {
      const p = make(r('pass'), 'pass', { label: `Pass · for ${label}`, ...extra }, { color: from }, cx, -ROW, passNote(label));
      passWhy = ' Its input is the Pass above it.';
      return [p.id, 'texture'];
    };
    const tex = (): Wire => cur.texture ?? passOf(cur.color);
    const wires: Record<string, Wire> = {};
    let why = '';
    const mainParams: Params = { ...defaultsOf(def.type), ...block.params };
    let mainId = '';

    switch (def.special) {
      case 'flood': {
        const seedWires: Record<string, Wire> = cur.texture ? { texture: cur.texture } : { color: cur.color };
        const seed = make(r('seed'), 'textureMask', { source: 'brightness', threshold: 'hard', level: 0.55, ...(block.aux?.seed ?? {}) }, seedWires, cx, -ROW,
          'Mask (texture), made by Texture Lab: 1 where the picture is brighter than Level. Its Seed output (each pixel inside stores its own place) is what the jump flood starts from. Raise Level to keep fewer, brighter shapes.');
        const flood = make(r('flood'), 'pass', { label: 'Pass · jump flood', scale: '0.5', format: 'half', filter: 'nearest', repeat: 10 }, {}, cx + COL, -ROW,
          'Pass with Repeat 10 (made by Texture Lab): drawn ten times a frame, each round reading the one before through Previous. Half size is a quarter of the work; Nearest keeps the stored places exact. It costs 1 pass.');
        const floodId = flood.id;
        const jf = make(r('jf'), 'jumpFloodTexture', { reach: 1 }, { texture: [floodId, 'previous'], step: [floodId, 'step'], steps: [floodId, 'steps'], start: [seed.id, 'seed'] }, cx + COL, -2 * ROW,
          'Jump flood (texture), made by Texture Lab: one round of the flood. It reads the round before (the Pass\'s Previous) here and 8 places round it and keeps the nearest shape point any of them knows; Step and Steps halve the reach every round, and Start gives the seeds on round 0.');
        flood.inputs.color = { ...flood.inputs.color, connection: { nodeId: jf.id, outputKey: 'seed' } };
        const read = make(r('read'), 'jumpFloodTexture', { reach: 2 }, { texture: [floodId, 'texture'] }, cx, ROW,
          'Jump flood (texture), made by Texture Lab, once more on the finished flood: Distance is how far each pixel is from the nearest bright shape, in picture units.');
        wires.distance = [read.id, 'distance'];
        why = 'It draws from the flood\'s Distance: Mode picks an outline, a glow or rings.';
        const main = make(r('main'), def.type, mainParams, wires, cx + COL, 0, mainNote(def, block, i, count, why));
        mainId = main.id;
        make(r('over'), 'addColor', {}, { a: cur.color, b: [main.id, 'light'] }, cx + COL, ROW,
          'Add Colors (made by Texture Lab): the picture with the lines from the distance added over it (light only adds).');
        break;
      }
      case 'change': {
        const p = passOf(cur.color, { scale: '0.5' });
        wires.texture = p;
        wires.before = [roleId('pass'), 'previous'];
        why = 'It compares the Pass above (this frame) with its Previous (the frame before).';
        passWhy = '';
        made.get(r('pass'))!.params.__comment = `Pass (made by Texture Lab for ${label}): keeps this frame as a texture and last frame as its Previous: the two Change compares. Half size is plenty for motion. It costs 1 of the 8 full-quality passes.`;
        break;
      }
      case 'flow': {
        const t = tex();
        wires.texture = t;
        why = 'Its Flow (the way along the picture\'s contours) pushes where the Read below it reads the same picture.';
        const main = make(r('main'), def.type, mainParams, wires, cx, 0, mainNote(def, block, i, count, why + passWhy));
        mainId = main.id;
        make(r('read'), 'readTexture', {}, { texture: t, flow: [main.id, 'flow'] }, cx, ROW,
          'Read (texture), made by Texture Lab: the picture read a little further along Flow\'s direction, so it is combed along its own contours.');
        break;
      }
      case 'feedback': {
        if (cur.texture) { wires.texture = cur.texture; why = 'It reads the picture as a texture and leaves trails of it.'; }
        else if (sourceTex) { wires.texture = sourceTex; wires.fresh = cur.color; why = 'Fresh paints the picture so far over the trails; Texture (the source) only sets the buffer\'s size.'; }
        else { wires.texture = tex(); why = 'It leaves trails of the picture.'; }
        break;
      }
      case 'depthMix': {
        const d = make(r('depth'), 'depth', { ...(block.aux?.depth ?? {}) }, { texture: sourceTex ?? tex() }, cx, ROW,
          'Depth (made by Texture Lab): how far away each part of the source picture is, from a small model on this device (downloaded once: press Download on this card). Near is bright.');
        wires.picture = cur.color;
        wires.depth = [d.id, 'depth'];
        why = 'It fades the far part of the picture into a haze, by the Depth node below it.';
        break;
      }
      case 'heightLight': {
        wires.texture = tex();
        wires.colour = cur.color;
        why = 'The picture\'s brightness is the height, lit by a low sun; Colour keeps the picture\'s own colours on the relief.';
        break;
      }
      default: {
        if (def.feed === 'texture') {
          const t = tex();
          wires[def.texIn ?? 'texture'] = t;
          for (const k of def.alsoTex ?? []) wires[k] = t;
          why = def.alsoTex?.length ? 'It is pushed by its own colours (the same texture is its map).' : '';
        } else if (cur.texture) {
          wires.texture = cur.texture;
          why = 'It reads the picture one pixel at a time, so no Pass is needed.';
        } else {
          wires[def.colorIn ?? 'color'] = cur.color;
          why = 'It works one pixel at a time on the colour so far, so no Pass is needed.';
        }
      }
    }
    if (!mainId) mainId = make(r('main'), def.type, mainParams, wires, cx, 0, mainNote(def, block, i, count, (why + passWhy).trim())).id;

    const view = viewOf(def, block.view);
    const out: Wire = view.out.includes('.') ? [roleId(view.out.split('.')[0]), view.out.split('.')[1]] : [mainId, view.out];
    const mix = make(r('mix'), 'mix', { t: block.amount }, { a: cur.color, b: out }, cx + COL, 0, mixNote(label), true);
    // Only the Mix's Blend is the block's: its A and B always carry vec3.
    mix.inputs.a = { ...mix.inputs.a, type: 'vec3' };
    mix.inputs.b = { ...mix.inputs.b, type: 'vec3' };
    mix.outputs = { result: { type: 'vec3', label: 'Result' } };
    if (def.special === 'flood') mix.position = keepPlaces && old.get(r('mix')) ? mix.position : { x: anchor.x + cx + 2 * COL, y: anchor.y };
    gateNode(mix, block.muted, { from: 'a' });
    cur = { color: [mix.id, 'result'] };
    ends.set(block.id, cur.color);
  });

  // ── The builder's preview (left out on Done) ──
  let shown: Wire = (opts.preview?.upTo && ends.get(opts.preview.upTo)) || cur.color;
  const endX = COL * (1 + 2 * count) + (spec.blocks.some(b => blockDef(b.type)?.special === 'flood') ? COL : 0);
  const split = opts.preview?.split;
  if (typeof split === 'number' && Number.isFinite(split)) {
    const at = make('view:split', 'constant', { value: Math.max(0, Math.min(1, split)), label: 'Before | after' }, {}, endX, -ROW,
      'Texture Lab\'s preview: where the before / after divider is (0 left, 1 right). Not part of what Done makes.');
    const cmp: GraphNode = {
      id: old.get('view:cmp')?.id ?? nextId(), type: 'exprNode', position: { x: anchor.x + endX, y: anchor.y },
      inputs: {
        before: { type: 'vec3', label: 'before', connection: { nodeId: before[0], outputKey: before[1] } },
        after: { type: 'vec3', label: 'after', connection: { nodeId: shown[0], outputKey: shown[1] } },
        at: { type: 'float', label: 'at', connection: { nodeId: at.id, outputKey: 'value' } },
      },
      outputs: { result: { type: 'vec3', label: 'Result' } },
      params: {
        label: 'Preview: before | after', outputType: 'vec3',
        inputs: [{ name: 'before', type: 'vec3', slider: null }, { name: 'after', type: 'vec3', slider: null }, { name: 'at', type: 'float', slider: null }],
        lines: [
          { lhs: 'float x', op: '=', rhs: 'gl_FragCoord.x / u_resolution.x' },
          { lhs: 'float line', op: '=', rhs: '1.0 - smoothstep(0.0, 1.5, abs(gl_FragCoord.x - at * u_resolution.x))' },
        ],
        result: 'mix(mix(before, after, step(at, x)), vec3(0.95), line * 0.85)',
        expr: 'mix(mix(before, after, step(at, x)), vec3(0.95), line * 0.85)',
        __comment: 'Texture Lab\'s preview: the source on the left of the divider, the stack on the right. Not part of what Done makes.',
        [TX_ROLE]: 'view:cmp', [TX_BUILD]: build,
      },
    };
    made.set('view:cmp', cmp);
    shown = [cmp.id, 'result'];
  }

  // ── Into the graph ──
  const keepIds = new Set([...made.values()].map(nd => nd.id));
  const gone = new Set([...old.values()].map(nd => nd.id).filter(id => !keepIds.has(id) && builderIds.has(id)));
  let rest = graph.filter(nd => !builderIds.has(nd.id) || (userSource && nd.id === userSource.id));
  rest = rest.map(nd => {
    let changed = false;
    const inputs = { ...nd.inputs };
    for (const [k, s] of Object.entries(inputs)) if (s.connection && gone.has(s.connection.nodeId)) { inputs[k] = { ...s, connection: undefined }; changed = true; }
    let params = nd.params;
    // A node of yours that was the source and isn't now loses the builder's keys.
    if (oldSourceIsYours && found && nd.id === found.source.id && nd.id !== userSource?.id) {
      params = Object.fromEntries(Object.entries(nd.params).filter(([k]) => k !== TX_META && k !== TX_ROLE && k !== TX_BUILD));
      changed = true;
    }
    return changed ? { ...nd, inputs, params } : nd;
  });
  const meta: TxMeta = { v: 1, build, spec: structuredClone(spec) };
  delete meta.spec.source.params;
  if (userSource) {
    rest = rest.map(nd => (nd.id === userSource!.id ? { ...nd, params: { ...nd.params, [TX_META]: meta, [TX_ROLE]: 'source', [TX_BUILD]: build } } : nd));
  } else {
    made.get('source')!.params[TX_META] = meta;
  }
  let top = [...made.values()];
  if (!found && !userSource) top = placeInFreeSpace(rest as GraphNode[], top, opts.at ?? { x: 0, y: 0 });
  // The Output shows the end of the stack (or the preview).
  let output = rest.find(nd => (nd.type === 'output' || nd.type === 'vec4Output') && nd.inputs.color);
  if (!output) {
    const def = getNodeDefinition('output')!;
    const last = top.find(nd => nd.id === shown[0]) ?? rest.find(nd => nd.id === shown[0]);
    const p = last?.position ?? anchor;
    output = { id: nextId(), type: 'output', position: { x: p.x + COL, y: p.y }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
    rest = [...rest, output];
  }
  const outId = output.id;
  rest = rest.map(nd => (nd.id === outId ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: shown[0], outputKey: shown[1] } } } } : nd));
  return { nodes: [...rest, ...top], sourceId: srcId, roles: new Map([...made].map(([k, v]) => [k, v.id])) };
}

/** Passes each block uses now (its Pass, a Feedback's buffer, a jump flood, Optical Flow's two), by block id. */
export function blockPasses(graph: GraphNode[], sourceId: string | null | undefined): Record<string, number> {
  const b = sourceId ? findTxBuild(graph, sourceId) : null;
  if (!b) return {};
  const roleById = new Map([...b.byRole].map(([role, nd]) => [nd.id, role]));
  const out: Record<string, number> = {};
  for (const item of passBudget(graph).items) {
    const role = roleById.get(item.nodeId) ?? roleById.get(item.topId);
    if (!role || !role.includes(':') || role.startsWith('view:')) continue;
    const id = role.split(':')[0];
    out[id] = (out[id] ?? 0) + item.cost;
  }
  return out;
}
