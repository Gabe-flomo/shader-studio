/**
 * points.ts — points joined to a shape (docs/combine-plan.md §2.3, §2.4, docs/combine.md): Collide with and Follow
 * the shape. Both add plain, commented nodes inside the points' Agents group (an InnerEdit: apply.ts puts them in and
 * takes them out before every rebuild), between what moved the walker (the builder's Move) and Agent Output, and then
 * draw the walkers over the layer below as Place in does (pointsOver).
 *
 * The shape comes in through a port added to the group (Agent Inputs → the port's output):
 *  - a 2D build: its layers' distances (one Union when there are several) into a number port: inside, a field socket
 *    (Collide's Shape ƒ, Ride a Path's Path ƒ, Flow's Field ƒ) reads it wherever the walker is;
 *  - a 3D scene: its Scene Group's Scene into a Scene port, read through the coarse grid (Collide (3D Scene), Follow
 *    surface (3D Scene)).
 *
 * Collide with: Bounce and Slide put Collide after the walker's own move (its velocity's way after it, a Simple
 * Expression, so the rules turn from there); Settle replaces the move with Gravity → Integrate → Collide (no bounce,
 * high friction): the walkers fall and pile up on the shape.
 * Follow the shape, 2D: Trace and Orbit ride the outline (Ride a Path; Orbit at a distance), Cling and Flow along are
 * forces (Flow down the slope of |d − Offset| keeps them on the outline, Curl noise drifts them, or Flow Around pushes
 * them along it) into Integrate. 3D: Follow surface (3D Scene) in its four ways.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { withAgentSpace } from '../nodes/definitions/agents';
import type { FollowMode } from '../nodes/definitions/agentFollowScene';
import type { Resolved } from './products';
import { mk, mkVec3, ref, simple, tidy, type Ctx, type InnerEdit, type LayerOut } from './glue';
import { exprFor } from './exprs';
import {
  COLLIDE_DEFAULTS, FOLLOW_DEFAULTS, PLACE_DEFAULTS, num, settingsOf, str,
  type CollideMode, type CombineLayer, type FollowHow, type NodeRef,
} from './spec';

const at = (nodeId: string, outputKey: string): NodeRef => ({ nodeId, outputKey });

/** Points drawn over the layer below: Draw agents draws them over it (its Background), Mix by Amount; a 3D group sees through the scene's camera. */
export function pointsOver(ctx: Ctx, layer: CombineLayer, a: Resolved, b: LayerOut): LayerOut | string {
  const L = layer.id;
  if (!a.draw) return `${a.label} has no Draw agents.`;
  if (!b.colour) return 'The layer below has no picture.';
  const S = settingsOf(layer, PLACE_DEFAULTS);
  const notes: string[] = [];
  if (b.kind === 'scene3d' && a.draw.d3 && b.cam) {
    ctx.patches.push(
      { nodeId: a.draw.id, input: 'camOrigin', from: at(b.cam, 'ro'), note: 'seen through the scene\'s camera' },
      { nodeId: a.draw.id, input: 'camRay', from: at(b.cam, 'rd'), note: 'seen through the scene\'s camera' },
      ...(b.loop?.dist ? [{ nodeId: a.draw.id, input: 'depth', from: at(b.loop.id, 'dist'), note: 'hidden behind the scene\'s surfaces' }] : []),
    );
    notes.push(' Its Draw agents sees through the scene\'s March Camera and hides walkers behind the scene\'s surfaces (Camera from, Camera ray and Depth are wired from the scene).');
  } else if (b.kind === 'scene3d') ctx.warnings.push(`${a.label} is a 2D Agents group: it is laid over the scene, not in it.`);
  const draw = ctx.graph.find(x => x.id === a.draw!.id);
  const ex = exprFor(ctx, layer, 'amount', {});
  if ((draw?.params.background ?? 'over') === 'over') {
    // Draw agents draws them over the layer below itself (its Background), with its own glow and blending; Mix fades them.
    ctx.patches.push({ nodeId: a.draw.id, input: 'over', from: b.colour, note: 'drawn over the layer below' });
    const mix = mkVec3(ctx, L, 'over', 'mix', { a: b.colour, b: a.colour, t: ex },
      `Mix: ${b.label} with the walkers drawn over it (Draw agents' Color: its Background is wired from ${b.label}), by Amount: 0 none, 1 all of them.${notes.join('')}`, { t: num(S.amount, 1) });
    return { ...b, id: L, colour: ref(mix, 'result') };
  }
  const amount = mk(ctx, L, 'amount', 'multiply', { b: num(S.amount, 1) }, { a: at(a.draw.id, 'density'), b: ex },
    `Multiply: Draw agents' Density (how much walker is here) times Amount: how strongly the walkers cover ${b.label}.`);
  const sel = mkVec3(ctx, L, 'over', 'select', { mask: ref(amount, 'result'), ifTrue: a.colour, ifFalse: b.colour },
    `Select: the walkers (Draw agents' Color) where they are, ${b.label} elsewhere (its Background is its own palette, so it can't draw them over ${b.label} itself).${notes.join('')}`);
  return { ...b, id: L, colour: ref(sel, 'result') };
}

/** The group's inside being edited, with the shape brought in through a port: what Collide and Follow build on. */
interface Inside {
  edit: InnerEdit;
  /** A context whose glue is the group's inside. */
  ix: Ctx;
  d3: boolean;
  /** The shape, as Agent Inputs gives it: a number (2D) or a Scene (3D). */
  port: NodeRef;
  /** The names an expression inside can use. */
  names: Record<string, NodeRef>;
  /** Agent Inputs (inside). */
  inputs: string;
  /** What moved the walker before (Agent Output's wires as its builder left them); velocity falls back to the mover's. */
  pos: NodeRef | null;
  vel: NodeRef | null;
  head: NodeRef | null;
}

/** Open the points' group for a verb on `b`: checks the pair, adds the port. A string says why it can't. */
function openInside(ctx: Ctx, layer: CombineLayer, a: Resolved, b: LayerOut, verb: string): Inside | string {
  const L = layer.id;
  const g = a.group;
  if (!a.draw || !g) return `${a.label} has no Agents group with an Agent Output inside to ${verb} with.`;
  const to3d = b.kind === 'scene3d';
  const edit: InnerEdit = { layer: L, groupId: g.id, ports: [], nodes: [], out: {} };
  const ix: Ctx = { ...ctx, glue: edit.nodes, mine: [] };
  let port: NodeRef;
  if (to3d) {
    if (!b.sceneGroup) return 'This 3D layer has no Scene Group to meet (splats have no surfaces yet).';
    if (!g.d3) return `${a.label} is a 2D Agents group: set its Space to 3D (Edit product) so it can move in the scene.`;
    const key = `cb${L}Scene`;
    edit.ports.push({ key, type: 'scene3d', label: 'Scene (Combine)', from: at(b.sceneGroup, 'scene') });
    port = at(g.inputs, key);
  } else {
    if (!b.shape?.length) return 'The layer below has no shape (a 2D build\'s layers) to meet.';
    if (g.d3) ctx.warnings.push(`${a.label} is a 3D Agents group: it meets the shape through the depth, but is seen through its own camera, so it won't line up with the 2D picture. Set its Space to 2D (Edit product).`);
    // Its layers' distances as one: a Union per extra layer, at the top level (the field chain the port carries).
    let d = b.shape[0];
    b.shape.slice(1).forEach((x, i) => {
      d = ref(mk(ctx, L, `shape:u${i + 1}`, 'sdfUnion', { k: 0 }, { a: d, b: x },
        `Union: ${b.label}'s layers as one shape (layer ${i + 2} joined), for the walkers to ${verb} with.`), 'dist');
    });
    const key = `cb${L}Shape`;
    edit.ports.push({ key, type: 'float', label: 'Shape (Combine)', from: d });
    port = at(g.inputs, key);
  }
  const names: Record<string, NodeRef> = { speed: at(g.inputs, 'speed'), age: at(g.inputs, 'age'), ...(to3d ? {} : { d: port }) };
  return { edit, ix, d3: to3d, port, names, inputs: g.inputs, pos: g.out.position, vel: g.out.velocity ?? g.moveVelocity ?? null, head: g.out.heading };
}

/** Close the edit: 3D nodes retyped for the group's space, laid out under Agent Output; Agent Output takes them over. */
function closeInside(ctx: Ctx, inside: Inside, out: Record<string, NodeRef | null>): void {
  const { edit } = inside;
  if (inside.d3) edit.nodes.splice(0, edit.nodes.length, ...edit.nodes.map(n => withAgentSpace(n, true, getNodeDefinition)));
  tidy(edit.nodes, 900, 0);
  edit.out = out;
  ctx.inner.push(edit);
}

/** The heading after a velocity was changed: its way (2D an angle, 3D a direction), or the one before while it stands still. */
function headingAfter(inside: Inside, L: string, v: NodeRef, why: string): NodeRef {
  const d3 = inside.d3;
  const h = inside.head ?? at(inside.inputs, 'heading');
  const node = simple(inside.ix, L, 'heading', 'Heading after', d3 ? 'length(v) > 1e-6 ? v / length(v) : h' : 'length(v) > 1e-6 ? atan(v.y, v.x) : h', d3 ? 'vec3' : 'float',
    [['v', v], ['h', h]],
    `Simple Expression: which way the walker faces after ${why}: its velocity's ${d3 ? 'direction' : 'angle'} (v), or the heading it had (h) while it stands still. The rules turn from here next step.`);
  node.inputs.in1.type = d3 ? 'vec3' : 'vec2';
  node.inputs.in2.type = d3 ? 'vec3' : 'float';
  return ref(node, 'result');
}

// ── Collide with ─────────────────────────────────────────────────────────────

export function collideWith(ctx: Ctx, layer: CombineLayer, a: Resolved, b: LayerOut): LayerOut | string {
  const L = layer.id;
  const inside = openInside(ctx, layer, a, b, 'collide');
  if (typeof inside === 'string') return inside;
  const S = settingsOf(layer, COLLIDE_DEFAULTS);
  const mode = str<CollideMode>(S.mode, ['bounce', 'slide', 'settle'], 'slide');
  const { ix, d3, names } = inside;
  let pos = inside.pos, vel = inside.vel;
  let what = '';
  if (mode === 'settle') {
    const grav = mk(ix, L, 'gravity', 'agentGravity', { strength: num(S.gravity, 0.6), angle: -90 }, { strength: exprFor(ix, layer, 'gravity', names) },
      `Gravity: a pull straight down (Strength ${num(S.gravity, 0.6)}), so the walkers fall onto ${b.label} and settle there. It takes over from the walkers' own moving.`);
    const integ = mk(ix, L, 'integrate', 'agentIntegrate', { drag: 1.2, maxSpeed: 3, mass: 1, edges: 'slide' }, { force: ref(grav, 'force') },
      'Integrate: the fall as motion, from where the walker is and how fast it went (its own Position and Velocity): Drag 1.2 slows it, Edges Slide keeps it on the picture (it piles up on the floor too).');
    pos = ref(integ, 'position');
    vel = ref(integ, 'velocity');
    what = 'falls, then lands on the surface and stays (Bounce 0, Friction high)';
  }
  const bounce = mode === 'bounce' ? num(S.bounce, 0.6) : 0;
  const friction = mode === 'settle' ? Math.max(0.4, num(S.friction, 0.5)) : num(S.friction, 0.03);
  const params = { margin: num(S.margin, d3 ? 0.015 : 0.012), cushion: mode === 'settle' ? 0 : num(S.cushion, 0.06), bounce, friction };
  const wires = { position: pos, velocity: vel, bounce: mode === 'bounce' ? exprFor(ix, layer, 'bounce', names) : null, friction: exprFor(ix, layer, 'friction', names) };
  if (!what) what = mode === 'bounce' ? `bounces off it (Bounce ${bounce}: 1 as fast as it came)` : 'slides along it (Bounce 0)';
  const col = d3
    ? mk(ix, L, 'collide', 'agentCollideScene', { ...params, reach: num(S.reach, 2), x: 0, y: 0, z: 0 }, { scene: inside.port, ...wires },
      `Collide (3D Scene): keeps the walkers out of ${b.label}. It reads the scene (the group's Scene (Combine) port, wired from its Scene Group) on a coarse 48-cell grid ±${num(S.reach, 2)} round the middle, filled every step, so it costs almost nothing. A walker that touches a surface ${what}.`)
    : mk(ix, L, 'collide', 'agentCollide', params, { shape: inside.port, ...wires },
      `Collide: keeps the walkers out of ${b.label}'s shape (the group's Shape (Combine) port: its layers' distance, read wherever the walker is). A walker that touches it ${what}. Margin is how close it may come; Cushion parts a stream just before it touches.`);
  const h = headingAfter(inside, L, ref(col, 'velocity'), `Collide moved it`);
  closeInside(ctx, inside, { position: ref(col, 'position'), velocity: ref(col, 'velocity'), heading: h });
  return pointsOver(ctx, layer, a, b);
}

// ── Follow the shape ─────────────────────────────────────────────────────────

export function followShape(ctx: Ctx, layer: CombineLayer, a: Resolved, b: LayerOut): LayerOut | string {
  const L = layer.id;
  const inside = openInside(ctx, layer, a, b, 'follow');
  if (typeof inside === 'string') return inside;
  const S = settingsOf(layer, FOLLOW_DEFAULTS);
  const how = str<FollowHow>(S.how, ['trace', 'cling', 'flow', 'orbit'], 'trace');
  const { ix, d3, names } = inside;
  const speed = num(S.speed, 0.35), offset = num(S.offset, 0.02), orbit = num(S.orbit, 0.25), width = num(S.width, 0.03);
  if (d3) {
    const mode: FollowMode = how === 'cling' ? 'cling' : how === 'flow' ? 'along' : 'around';
    const off = how === 'orbit' ? orbit : offset;
    const axis = str(S.axis, ['x', 'y', 'z'] as const, 'y');
    const fol = mk(ix, L, 'follow', 'agentFollowScene', { mode, axis, offset: off, speed, speedVar: 0.3, steer: how === 'cling' ? 0.05 : 0.2, pull: 0.35, reach: num(S.reach, 2), x: 0, y: 0, z: 0 },
      { scene: inside.port, speed: exprFor(ix, layer, 'speed', names), offset: exprFor(ix, layer, 'offset', names) },
      `Follow surface (3D Scene): the walkers stay on ${b.label}'s surfaces ${off ? `${off} out from them ` : ''}and move along them: ${how === 'cling' ? 'each its own way (Cling), drifting' : how === 'flow' ? `flowing the ${axis.toUpperCase()} axis's way over them (Along)` : `round the ${axis.toUpperCase()} axis (Around)${how === 'orbit' ? ', a shell at a distance' : ''}`}, at Speed ${speed}. It reads the scene through the group's Scene (Combine) port on the same coarse grid Collide (3D Scene) uses. It takes over from the walkers' own moving.`);
    closeInside(ctx, inside, { position: ref(fol, 'position'), velocity: ref(fol, 'velocity'), heading: ref(fol, 'heading') });
    return pointsOver(ctx, layer, a, b);
  }
  if (how === 'trace' || how === 'orbit') {
    const lvl = how === 'orbit' ? orbit : offset;
    const ride = mk(ix, L, 'follow', 'agentRidePath', { speed, speedVar: 0.3, direction: 'one', level: lvl, width, wander: how === 'orbit' ? 0.3 : 0.1, wanderRate: 0.3 },
      { path: inside.port, speed: exprFor(ix, layer, 'speed', names), level: exprFor(ix, layer, how === 'orbit' ? 'orbit' : 'offset', names, how === 'orbit' ? 'distance' : 'offset'), width: exprFor(ix, layer, 'width', names) },
      `Ride a Path: the walkers ${how === 'orbit' ? `circle ${b.label} ${lvl} out from its edge (Level)` : `trace ${b.label}'s outline (Level ${lvl}: just outside its edge)`}, Speed ${speed} along it, each in its own lane across a band ${width * 2} wide (Ribbon width). Path ƒ is the group's Shape (Combine) port. Every step pulls them back on, so they follow the shape as it moves. It takes over from the walkers' own moving.`);
    closeInside(ctx, inside, { position: ref(ride, 'position'), velocity: ref(ride, 'velocity'), heading: ref(ride, 'heading') });
    return pointsOver(ctx, layer, a, b);
  }
  // Cling and Flow along: forces into Integrate. Down the slope of |d − offset| holds them on the outline.
  const offX = exprFor(ix, layer, 'offset', names);
  const off = offX ?? ref(mk(ix, L, 'offset', 'constant', { value: offset, outputType: 'float', label: 'Offset' }, {},
    `Constant: how far out from ${b.label}'s edge the walkers keep (Offset ${offset}).`), 'value');
  const field = simple(ix, L, 'band', 'Distance from the band', 'abs(d - o)', 'float', [['d', inside.port], ['o', off]],
    `Simple Expression: how far the walker is from the line ${offset} out from ${b.label}'s edge: abs(d − o), d the shape's distance (negative inside). It is 0 on that line, so a Flow down its slope pulls the walkers onto it from both sides.`);
  let push: GraphNode | null = null;
  if (how === 'flow') {
    const k = num(S.push, 1.2);
    const jitter = mk(ix, L, 'jitter', 'agentCurl', { strength: 0.3, size: 1, evolve: 0.15 }, {},
      'Curl Noise: a little swirl (Strength 0.3), so walkers flowing along the outline don\'t bunch up where it turns in.');
    push = mk(ix, L, 'along', 'agentFlow', { mode: 'around', strength: k, step: 0.01 }, { field: inside.port, strength: exprFor(ix, layer, 'push', names), also: ref(jitter, 'force') },
      `Flow (Around): pushes the walkers along ${b.label}'s outline, round its contour lines (Strength ${k}: how hard; negative the other way). "+ Another force" adds the swirl.`);
  } else {
    const drift = num(S.drift, 0.5);
    push = mk(ix, L, 'drift', 'agentCurl', { strength: drift, size: 1, evolve: 0.15 }, { strength: exprFor(ix, layer, 'drift', names) },
      `Curl Noise: a gentle swirl (Strength ${drift}), so the walkers on the line drift along it and wander a little off it, instead of standing still.`);
  }
  const cling = mk(ix, L, 'cling', 'agentFlow', { mode: 'slope', strength: -3, step: 0.01 }, { field: ref(field, 'result'), also: ref(push, 'force') },
    'Flow (Slope, Strength −3): down the slope of the distance from the band, toward the line, from both sides: what keeps the walkers on the outline. "+ Another force" adds the push before it.');
  const integ = mk(ix, L, 'integrate', 'agentIntegrate', { drag: 2.5, maxSpeed: 2, mass: 1, edges: 'wrap' }, { force: ref(cling, 'force') },
    'Integrate: the forces as motion, from where the walker is and how fast it went: Drag 2.5 settles them on the line quickly. It takes over from the walkers\' own moving.');
  closeInside(ctx, inside, { position: ref(integ, 'position'), velocity: ref(integ, 'velocity'), heading: ref(integ, 'heading') });
  return pointsOver(ctx, layer, a, b);
}
