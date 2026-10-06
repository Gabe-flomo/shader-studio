/**
 * Agents in 3D (docs/agents-plan.md "3D"): the state layout, the 3D sensor, steering, moving and
 * force maths (each node's real emitted GLSL run on the CPU, glslEval.ts), the volume Trail's
 * layout, Draw agents' camera (its parameter names are Time Cube View's and Frame Stack's; it is
 * the March Camera's orbit, and with the Particles node's way round its projection is
 * gpCamera's), Open as nodes in 3D, the web bundle, and that a 2D graph never changes
 * (agents2dGolden.test.ts holds every 2D compile; here the space sync leaves 2D nodes alone).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { DRAW_CAMERA_PARAMS, syncAgentSpaces, withAgentSpace, AGENT_3D_SOCKETS } from '../../nodes/definitions/agents';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from './glslEval';
import { AG_PROBE_POINTS, agCamera3, agProject3, agVolLayout, agVolUniform } from '../../play/kit/agentPlan.js';
import { AG_DEPOSIT3_VERT, AG_DRAW3_VERT, AG_TRAIL3_FRAG } from '../../play/kit/agentShaders.js';
import { GP_DEFAULTS, GP_FOV, GP_SHADERS, gpCamera, gpCurl3D, gpPreset, gpProject } from '../../play/kit/gpuParticles.js';
import { particlesAsNodes } from '../../store/particlesAsNodes';
import { slimeMoldNodes } from '../../store/agentExamples';
import { webAgents } from '../../play/webInput';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

const close = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);
const closeV = (a: number[], b: number[], d = 6) => a.forEach((x, i) => close(x, b[i], d));
const deg = (d: number) => d * Math.PI / 180;
type V3 = [number, number, number];
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(...a); return a.map(x => x / l); };
const add = (a: number[], b: number[], k = 1) => a.map((x, i) => x + k * b[i]);
/** The 3D helpers the update shader's header defines (AG_3D_GLSL), in JS for the evaluator. */
const H3: Env = {
  cross: (a: Val, b: Val) => cross(a as number[], b as number[]),
  agTurn3: (h: Val, s: Val, a: Val) => norm(add((h as number[]).map(x => x * Math.cos(a as number)), (s as number[]).map(x => x * Math.sin(a as number)))),
  agAcross: (h: Val, a: Val) => {
    const hv = h as number[];
    const e1 = norm(cross(hv, Math.abs(hv[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]));
    const e2 = cross(hv, e1);
    return add(e1.map(x => x * Math.cos(a as number)), e2.map(x => x * Math.sin(a as number)));
  },
};
/** A node of an Agents group in 3D: marked and its sockets vec3, as the compiler does. */
const node3 = (type: string, params: Record<string, unknown> = {}) => withAgentSpace(n(type, 'N', 0, 0, params), true, getNodeDefinition);
const gen3 = (type: string, params: Record<string, unknown>, v: Record<string, string>) => getNodeDefinition(type)!.generateGLSL(node3(type, params), v);
const inside = (g: GraphNode) => (g.params.subgraph as SubgraphData).nodes;

/** The Slime mold example with its group set to 3D. */
const slime3d = () => slimeMoldNodes(0, 0).map(x => (x.type === 'agentsGroup' ? { ...x, params: { ...x.params, space: '3d' } } : x));

describe('3D state layout', () => {
  it('A = (pos.xyz, age), B = (vel.xyz, life); the heading is the velocity\'s direction', () => {
    const r = compileGraph({ nodes: slime3d() });
    expect(r.errors).toBeUndefined();
    const g = r.agents!.groups[0];
    expect(g.space3d).toBe(true);
    const fs = g.fragmentShader;
    expect(fs).toContain('a_pos = a_sA.xyz; a_age = a_sA.w + a_dt;');
    expect(fs).toContain('a_vel = a_sB.xyz; a_speed = length(a_vel); a_life = a_sB.w;');
    expect(fs).toMatch(/a_dir = a_speed > 1e-12 \? a_vel \/ a_speed : agUnit3\(a_r\);/);
    expect(fs).toMatch(/o_a = vec4\(\w+_p, a_age\);/);
    expect(fs).toMatch(/o_b = vec4\(\w+_v, \w+_alive\);/);
    expect(fs).toContain('vec2 g_uv = a_pos.xy;');
    // The same layout as the Particles node's (pos.xyz + age, vel.xyz + life).
    expect(GP_SHADERS.GP_SIM).toContain('vec4 P = texelFetch(u_pos, t, 0), V = texelFetch(u_vel, t, 0);');
    expect(GP_SHADERS.GP_SIM).toContain('vec3 p = P.xyz, v = V.xyz;');
  });
  it('2D keeps its layout: (pos.xy, heading, age), (vel.xy, speed, life)', () => {
    const fs = compileGraph({ nodes: slimeMoldNodes(0, 0) }).agents!.groups[0].fragmentShader;
    expect(fs).toContain('a_pos = a_sA.xy; a_heading = a_sA.z;');
    expect(fs).not.toContain('a_across');
  });
  it('the sink: Heading and Position wired make the velocity the heading times how far it moved (the short way round a wrap)', () => {
    const { code } = getNodeDefinition('agentStepOut')!.generateGLSL({ id: 'O', type: 'agentStepOut', position: { x: 0, y: 0 }, params: { agentSpace: '3d' }, inputs: {}, outputs: {} }, { position: 'P', heading: 'H' });
    // The velocity it writes into B (the part before the alive test and the writes).
    const vel = code.slice(0, code.indexOf('    float O_alive'));
    expect(code).toContain('o_b = vec4(O_v, O_alive);');
    const env = (p: number[], from: number[]) => runGlsl(vel, { P: p, H: [0, 0, 2], a_pos: from, a_dir: [1, 0, 0], a_vel: [0, 0, 0], a_dt: 1 / 60, u_resolution: [200, 100] });
    closeV(env([0.5, 0, 0.1], [0.5, 0, 0]).O_v as number[], [0, 0, 6]);
    // Across the depth wrap (z 0.99 → −0.99: 0.02 the short way): speed 1.2, not 118.8.
    close((env([0, 0, -0.99], [0, 0, 0.99]).O_v as number[])[2], 0.02 * 60, 4);
  });
});

describe('Sense in 3D: sensors on a cone round the heading', () => {
  const field = (q: number[]) => q[0] * 3 + q[1] * 5;
  const run = (params: Record<string, unknown>, across: number[], heading: number[]) => {
    const { code, outputVars } = gen3('agentSense', { angle: 30, distance: 0.2, weight: 1, ...params }, { field: 'fieldfn_F' });
    const env = runGlsl(code, {
      ...H3, a_pos: [0.1, -0.2, 0.3], a_dir: heading, a_across: across,
      fieldfn_F: ((q: Val) => field(q as number[])) as unknown as Val,
    });
    return { env, readings: env[outputVars.readings] as number[], across: env.a_across as number[] };
  };
  it('turning plane: left and right Angle off the heading toward ± this step\'s side direction, centre Distance ahead', () => {
    const h = norm([0, 0, 1]), s = [1, 0, 0];
    const p = [0.1, -0.2, 0.3];
    const at = (dir: number[]) => field(add(p, dir, 0.2));
    const { readings } = run({}, s, h);
    close(readings[0], at(add(h.map(x => x * Math.cos(deg(30))), s.map(x => x * Math.sin(deg(30))))));
    close(readings[1], at(h));
    close(readings[2], at(add(h.map(x => x * Math.cos(deg(30))), s.map(x => -x * Math.sin(deg(30))))));
  });
  it('a side direction not square to the heading is made square', () => {
    const { across } = run({}, [1, 0, 1], [0, 0, 1]);
    closeV(across, [1, 0, 0]);
  });
  it('ring of 4: the pair across the plane wins when it smells more, and its plane is the one Steer turns in', () => {
    // Heading +z, side +x: the field rises along y only, so the pair across (±y) is the stronger one.
    const { readings, across } = run({ cone: 'ring' }, [1, 0, 0], [0, 0, 1]);
    const t = cross([0, 0, 1], [1, 0, 0]); // +y
    closeV(across, t);
    close(readings[0] - readings[2], 2 * 5 * 0.2 * Math.sin(deg(30)) * t[1]);
  });
  it('a volume Trail is read in 3D (agVolAt with its layout), any other texture at x and y', () => {
    const vol = getNodeDefinition('agentSense')!.generateGLSL({ ...node3('agentSense'), params: { ...node3('agentSense').params, __vol: true, __volOf: 'u_trail_t' } }, { texture: 'u_trail_t' }).code;
    expect(vol).toContain('agVolAt(u_trail_t, u_trail_t_vol, ');
    const flat = gen3('agentSense', {}, { texture: 'u_pass_p' }).code;
    expect(flat).toContain('texture(u_pass_p, agUv((');
    expect(getNodeDefinition('agentSense')!.declarationsFor!({ ...node3('agentSense'), params: { ...node3('agentSense').params, __vol: true, __volOf: 'u_trail_t' } })).toEqual(['uniform vec4 u_trail_t_vol;']);
  });
});

describe('Steer and Move in 3D', () => {
  const steer = (read: number[], u: number, params: Record<string, unknown> = {}) => {
    const { code, outputVars } = gen3('agentSteer', { mode: 'jones', turn: 40, jitter: 0, ...params }, { readings: 'R', random: 'U' });
    return runGlsl(code, { ...H3, R: read, U: u, a_dir: [0, 0, 1], a_across: [1, 0, 0] })[outputVars.heading] as number[];
  };
  it('Jones in the sensing plane: toward the stronger side by Turn, straight when the centre wins', () => {
    closeV(steer([3, 2, 1], 0.5), [Math.sin(deg(40)), 0, Math.cos(deg(40))]);
    closeV(steer([1, 2, 3], 0.5), [-Math.sin(deg(40)), 0, Math.cos(deg(40))]);
    closeV(steer([1, 3, 2], 0.5), [0, 0, 1]);
    closeV(steer([3, 1, 2], 0.2), [-Math.sin(deg(40)), 0, Math.cos(deg(40))]);
  });
  const move = (edges: string, pos: number[], h: number[], speed = 6) => {
    const { code, outputVars } = gen3('agentMove', { speed, edges }, { heading: 'H' });
    const e = runGlsl(code, { ...H3, H: h, a_pos: pos, a_dir: h, a_dt: 1 / 60, u_resolution: [200, 100] });
    return { p: e[outputVars.position] as number[], v: e[outputVars.velocity] as number[], h: e[outputVars.heading] as number[], hit: e[outputVars.hit] as number };
  };
  it('steps Speed × 1/60 along the heading, in the box (x ±aspect, y ±1, z ±1)', () => {
    closeV(move('wrap', [0, 0, 0], [0, 0, 1]).p, [0, 0, 0.1]);
    const w = move('wrap', [0, 0, 0.95], [0, 0, 1]);
    closeV(w.p, [0, 0, -0.95]); expect(w.hit).toBe(1);
    const b = move('bounce', [1.95, 0, 0], [1, 0, 0]);
    closeV(b.p, [1.95, 0, 0]); closeV(b.h, [-1, 0, 0]);
  });
});

describe('Forces in 3D', () => {
  it('Gravity pulls down (0, −Strength, 0); Curl noise is the Particles node\'s 3D curl', () => {
    const g = gen3('agentGravity', { strength: 0.5, angle: -90 }, {});
    closeV(runGlsl(g.code, {})[g.outputVars.force] as number[], [0, -0.5, 0]);
    const c = gen3('agentCurl', { strength: 1 }, {});
    expect(c.code).toContain(gpCurl3D('N_a', 'N_b'));
    // The engine's 3D branch is written with the same generator.
    expect(GP_SHADERS.GP_SIM).toContain(`c = ${gpCurl3D('a', 'b')};`);
  });
  it('Vortex round Up swirls in the x–z plane; round Depth in the picture\'s plane', () => {
    const run = (axis: string, pos: number[]) => {
      const v = gen3('agentVortex', { axis, strength: 1, reach: 0.5, at: 'point', x: 0, y: 0, z: 0 }, {});
      return runGlsl(v.code, { a_pos: pos })[v.outputVars.force] as number[];
    };
    const up = run('y', [0.5, 0.3, 0]);
    close(up[1], 0); expect(Math.abs(up[2])).toBeGreaterThan(0.1); close(up[0], 0);
    const depth = run('z', [0.5, 0, 0.3]);
    close(depth[2], 0); expect(Math.abs(depth[1])).toBeGreaterThan(0.1);
  });
  it('Attract pulls toward a point in space (its depth too)', () => {
    const a = gen3('agentAttract', { target: 'point', x: 0, y: 0, z: 1, strength: 1, falloff: 'far' }, {});
    const f = runGlsl(a.code, { a_pos: [0, 0, 0], u_resolution: [200, 100] })[a.outputVars.force] as number[];
    expect(f[2]).toBeGreaterThan(0); close(f[0], 0); close(f[1], 0);
  });
  it('Integrate steps velocity and position in 3D and keeps them in the box', () => {
    const it3 = gen3('agentIntegrate', { drag: 0, maxSpeed: 0, mass: 1, edges: 'wrap' }, { force: 'F' });
    const e = runGlsl(it3.code, { F: [0, 0, 60], a_pos: [0, 0, 0.99], a_vel: [0, 0, 0], a_dir: [1, 0, 0], a_dt: 1 / 60, u_resolution: [200, 100] });
    closeV(e[it3.outputVars.velocity] as number[], [0, 0, 1]);
    close((e[it3.outputVars.position] as number[])[2], 0.99 + 1 / 60 - 2);
    closeV(e[it3.outputVars.heading] as number[], [0, 0, 1]);
  });
  it('every space socket of every inside node is vec3 in 3D and back to the definition\'s type in 2D', () => {
    for (const [type, keys] of Object.entries(AGENT_3D_SOCKETS)) {
      const d3 = node3(type);
      for (const k of keys.in ?? []) expect(d3.inputs[k]?.type, `${type}.${k}`).toBe('vec3');
      for (const k of keys.out ?? []) expect(d3.outputs[k]?.type, `${type}.${k}`).toBe('vec3');
      const back = withAgentSpace(d3, false, getNodeDefinition);
      const def = getNodeDefinition(type)!;
      for (const k of keys.in ?? []) expect(back.inputs[k].type).toBe(def.inputs[k].type);
      expect(back.params.agentSpace).toBeUndefined();
    }
  });
});

describe('the volume Trail', () => {
  it('cells are cubic over the box; slices side by side in one texture no wider than 4096', () => {
    const L = agVolLayout(96, 1920, 1080);
    expect([L.nx, L.ny, L.nz]).toEqual([171, 96, 96]);
    expect(L.w).toBeLessThanOrEqual(4096);
    expect(L.tx * L.ty).toBeGreaterThanOrEqual(L.nz);
    expect(agVolUniform(L)).toEqual([171, 96, 96, L.tx]);
  });
  it('Deposit lands a walker in the cell whose centre Sense reads it at (the same mapping in both)', () => {
    // AG_DEPOSIT3_VERT: floor((p / box · ½ + ½) · n); agVolAt: (p / box · ½ + ½) · n − ½ (cell centres).
    expect(AG_DEPOSIT3_VERT).toContain('vec3 g = (A.xyz / vec3(u_aspect, 1.0, 1.0) * 0.5 + 0.5) * vec3(n);');
    const L = agVolLayout(64, 1600, 900), aspect = 1600 / 900;
    for (const p of [[0.1, 0.2, -0.3], [-1.7, 0.99, 0.01], [1.2, -0.5, 0.77]]) {
      const g = [p[0] / aspect, p[1], p[2]].map((x, i) => (x * 0.5 + 0.5) * [L.nx, L.ny, L.nz][i]);
      const cell = g.map(Math.floor);
      const centre = g.map(x => x - 0.5);
      cell.forEach((c, i) => expect(Math.abs(centre[i] - c)).toBeLessThanOrEqual(0.5));
    }
  });
  it('the step spreads to the 6 face neighbours (or the 27-cell binomial) and fades', () => {
    expect(AG_TRAIL3_FRAG).toContain('m /= 7.0;');
    expect(AG_TRAIL3_FRAG).toContain('m /= 64.0;');
  });
  it('a 3D group\'s Trail is a volume in the spec; Add and Block say they don\'t work in 3D yet', () => {
    const r = compileGraph({ nodes: slime3d() });
    expect(r.agents!.trails[0].volume).toBe(96);
    expect(r.agents!.groups[0].fragmentShader).toMatch(/uniform vec4 u_trail_\w+_vol;/);
    const web = webAgents(r.agents!);
    expect(web.trails[0].u.vol).toMatch(/^u_trail_\w+_vol$/);
    const withBlock = [...slime3d().map(x => (x.type === 'trailField' ? { ...x, inputs: { ...x.inputs, block: { type: 'float' as const, label: 'Block', connection: { nodeId: 'clock', outputKey: 'time' } } } } : x)), n('time', 'clock', 0, 0, {})];
    expect(compileGraph({ nodes: withBlock }).errors?.join(' ')).toMatch(/Add and Block don't work on a 3D trail/);
  });
});

describe('Draw agents\' camera: the unified vocabulary', () => {
  const NAMES: Record<string, string> = {
    camDist: 'Distance', camAngle: 'Angle', camElevation: 'Elevation', rotSpeed: 'Orbit speed', fov: 'Zoom', ortho: 'Flatten',
    camX: 'Translate X', camY: 'Translate Y', camZ: 'Translate Z',
  };
  it('its keys and labels are Time Cube View\'s and Frame Stack\'s (Angle in degrees here), in a Camera section, 3D only', () => {
    const tc = getNodeDefinition('timeCubeView')!.paramDefs!;
    const fsDefs = getNodeDefinition('frameStackView')?.paramDefs ?? getNodeDefinition('frameStack')!.paramDefs!;
    for (const [k, label] of Object.entries(NAMES)) {
      expect(DRAW_CAMERA_PARAMS[k]?.label, k).toBe(label);
      expect(DRAW_CAMERA_PARAMS[k].section).toBe('Camera');
      expect(DRAW_CAMERA_PARAMS[k].showWhen).toEqual({ param: 'agentSpace', value: '3d' });
      expect(tc[k], `Time Cube View has ${k}`).toBeDefined();
      expect(tc[k].label.replace(/^Cam /, '').replace(/ \(isometric\)$/, '')).toBe(label);
    }
    for (const k of ['camDist', 'camAngle', 'camElevation', 'rotSpeed', 'fov']) expect(fsDefs[k], `Frame Stack has ${k}`).toBeDefined();
    expect(DRAW_CAMERA_PARAMS.camAngle.max).toBe(360);
    for (const k of ['drift', 'focus', 'blur', 'maxBlur']) expect(DRAW_CAMERA_PARAMS[k]).toBeDefined();
  });
  it('the orbit is the March Camera\'s (same eye, forward, right and up for the same numbers)', () => {
    const P = { camDist: 3, camAngle: 40, camElevation: 20, rotSpeed: 0, fov: 1.8, ortho: 0, camX: 0.5, camY: 0, camZ: 0, drift: 0 };
    const cam = agCamera3({ params: P }, (v, f) => (typeof v === 'number' ? v : f), 0, 720);
    // The March Camera's GLSL (nodes/definitions/scene3d.ts), in JS.
    const ang = deg(40), el = deg(20), ta = [0.5, 0, 0];
    const hz = [Math.sin(ang), 0, Math.cos(ang)];
    const ro = add(ta, add(hz.map(x => x * Math.cos(el)), [0, Math.sin(el), 0]), 3);
    const fwd = norm(add(ta, ro, -1));
    const cup = norm(add(hz.map(x => -Math.sin(el) * x), [0, Math.cos(el), 0]));
    const rgt = norm(cross(cup, fwd));
    closeV(cam.eye, ro); closeV(cam.fwd, fwd); closeV(cam.right, rgt); closeV(cam.up, cross(fwd, rgt));
    // A point straight ahead lands in the middle; Flatten keeps the looked-at point's scale.
    const q = agProject3(cam, ta);
    close(q.x, 0); close(q.y, 0); close(q.depth, 3);
    const side = add(ta, rgt, 0.3);
    close(agProject3(cam, side).x, 0.3 * 1.8 / 3);
    close(agProject3({ ...cam, ortho: 1 }, add(side, fwd, 2)).x, 0.3 * 1.8 / 3);
  });
  it('with the Particles node\'s way round it projects as the Particles node\'s camera (Open as nodes)', () => {
    const gp = { ...GP_DEFAULTS, camAngle: 35, camTilt: 12, camDistance: 2.4, drift: 0.12, focus: 1 };
    const t = 3.7, aspect = 16 / 9;
    const ref = gpCamera(gp, t, aspect);
    const cam = agCamera3({ mirror: true, params: { camAngle: 35, camElevation: 12, camDist: 2.4, drift: 0.12, rotSpeed: 0, fov: 1 / Math.tan(GP_FOV / 2), ortho: 0, camX: 0, camY: 0, camZ: 0 } }, (v, f) => (typeof v === 'number' ? v : f), t, 720);
    for (const p of [[0.2, 0.1, -0.3], [-0.5, 0.4, 0.2], [0, 0, 0.6]]) {
      const a = gpProject(ref, p, aspect), b = agProject3(cam, p);
      close(b.x, a.x, 5); close(b.y, a.y, 5); close(b.depth, a.depth, 5);
    }
    close(cam.focus, ref.focus, 6);
  });
  it('a scene camera is read at the four points gpSceneCamera needs; the draw rebuilds it as gpSceneCamera does', () => {
    expect(AG_PROBE_POINTS).toEqual([[0, 0, 0], [0, 0, 1], [0.5, 0, 1], [0, 0.5, 1]]);
    expect(AG_DRAW3_VERT).toContain('lens = 0.5 / tan(acos(cy));');
  });
});

describe('Draw agents in 3D through a ray-marched scene\'s camera', () => {
  it('Camera from and Camera ray wired: a camera probe (read at g_uv from its uniform) and a depth probe', () => {
    const nodes = slime3d();
    const draw = withAgentSpace(n('drawAgents', 'd3', 0, 0, {}, { agents: ['slime', 'agents'] }), true, getNodeDefinition);
    draw.inputs.camOrigin = { ...draw.inputs.camOrigin, connection: { nodeId: 'cam', outputKey: 'ro' } };
    draw.inputs.camRay = { ...draw.inputs.camRay, connection: { nodeId: 'cam', outputKey: 'rd' } };
    const cam = n('marchCamera', 'cam', 0, 0, {});
    const out = n('output', 'o2', 0, 0, {}, { color: ['d3', 'color'] });
    const r = compileGraph({ nodes: [...nodes.filter(x => x.type !== 'output'), cam, draw, out] });
    expect(r.errors).toBeUndefined();
    const d = r.agents!.draws[0];
    expect(d.space3d).toBe(true);
    expect(d.probe!.uniform).toMatch(/^u_agPr_/);
    expect(d.probe!.camera).toContain(`vec2 g_uv = ${d.probe!.uniform}.xy;`);
    expect(d.probe!.camera).toContain(`uniform vec4 ${d.probe!.uniform};`);
    expect(d.probe!.depth).toBeUndefined();
  });
});

describe('2D never changes', () => {
  it('the space sync leaves a 2D graph exactly as it is (the same array, the same nodes)', () => {
    const nodes = slimeMoldNodes(0, 0);
    expect(syncAgentSpaces(nodes, getNodeDefinition)).toBe(nodes);
    for (const x of [...nodes, ...inside(nodes.find(y => y.type === 'agentsGroup')!)]) expect(withAgentSpace(x, false, getNodeDefinition)).toBe(x);
  });
  it('3D and back to 2D compiles the same as never 3D', () => {
    const two = compileGraph({ nodes: slimeMoldNodes(0, 0) });
    const there = syncAgentSpaces(slime3d(), getNodeDefinition);
    const back = syncAgentSpaces(there.map(x => (x.type === 'agentsGroup' ? { ...x, params: { ...x.params, space: '2d' } } : x)), getNodeDefinition);
    const again = compileGraph({ nodes: back });
    expect(again.agents!.groups[0].fragmentShader).toBe(two.agents!.groups[0].fragmentShader);
    expect(JSON.stringify(again.agents)).toBe(JSON.stringify(two.agents).replace(/"space":"2d",?/g, ''));
  });
  it('the update shader is a function of the graph: compiled twice, the same text (the simulation depends only on the step and the seed)', () => {
    const a = compileGraph({ nodes: slime3d() }).agents!.groups[0].fragmentShader;
    const b = compileGraph({ nodes: slime3d() }).agents!.groups[0].fragmentShader;
    expect(a).toBe(b);
    expect(a).toContain('a_across = agAcross(a_dir, float(agHash(a_seed ^ 0x27D4EB2Du) >> 8) / 16777216.0 * 6.2831853);');
    expect(a).not.toMatch(/Math\.random|u_frame\b/);
  });
});

describe('Open as nodes in 3D', () => {
  let k = 0;
  const ids = () => `n${k++}`;
  it('Ink in water: a 3D group, Ball born as a ball, Draw agents with the Particles node\'s camera and depth of field', () => {
    const src = n('gpuParticles', 'gp', 100, 100, { ...GP_DEFAULTS, ...gpPreset('ink')! });
    const r = particlesAsNodes(src, ids, { x: 0, y: 0 });
    const g = r.nodes.find(x => x.type === 'agentsGroup')!;
    expect(g.params.space).toBe('3d');
    expect(r.nodes.find(x => x.type === 'agentEmit')!.params.shape).toBe('ball');
    const d = r.nodes.find(x => x.type === 'drawAgents')!;
    const P = { ...GP_DEFAULTS, ...gpPreset('ink')! } as Record<string, unknown>;
    expect(d.params).toMatchObject({ camMirror: true, camAngle: P.camAngle, camElevation: P.camTilt, camDist: P.camDistance, drift: P.drift, focus: P.focus, blur: P.blur, maxBlur: 7 });
    close(d.params.fov as number, 1 / Math.tan(GP_FOV / 2), 3);
    expect(r.missing.join(' ')).not.toMatch(/3D: the camera/);
    const out = n('output', 'out', 0, 0, {}, { color: [r.outputs.color!.nodeId, r.outputs.color!.outputKey] });
    const c = compileGraph({ nodes: [...r.nodes, out] });
    expect(c.errors).toBeUndefined();
    expect(c.agents!.draws[0]).toMatchObject({ space3d: true, mirror: true });
  });
  it('a scene\'s camera and Depth wired into the Particles node come along onto Draw agents', () => {
    const src = n('gpuParticles', 'gp', 100, 100, { ...GP_DEFAULTS, space: '3d' }, { camOrigin: ['cam', 'ro'], camRay: ['cam', 'rd'], depth: ['loop', 'dist'] });
    const r = particlesAsNodes(src, ids, { x: 0, y: 0 });
    const d = r.nodes.find(x => x.type === 'drawAgents')!;
    expect(d.inputs.camOrigin.connection).toEqual({ nodeId: 'cam', outputKey: 'ro' });
    expect(d.inputs.camRay.connection).toEqual({ nodeId: 'cam', outputKey: 'rd' });
    expect(d.inputs.depth.connection).toEqual({ nodeId: 'loop', outputKey: 'dist' });
  });
});
