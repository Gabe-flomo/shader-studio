import { describe, expect, it } from 'vitest';
import { convertFragmentShader } from '../../nodes/userNodes/glslImport';
import { describeSource, buildUserNodeDefinition, CODE_RETURN_PORT } from '../../nodes/userNodes/publishUserNode';
import { registerUserNode, unregisterUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { compileGraph } from '../graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const SHADERTOY = `
// a classic
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    if (uv.x > 2.0) { fragColor = vec4(1.0); return; }
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));
    fragColor = vec4(col + hash(uv) * 0.01, 1.0);
}`;

const RAW = `#version 100
precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float speed;
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    gl_FragColor = vec4(uv, sin(u_time * speed), 1.0);
}`;

describe('convertFragmentShader', () => {
  it('turns a Shadertoy mainImage into a returned-value pass plus a UV entry', () => {
    const r = convertFragmentShader(SHADERTOY, { label: 'Plasma' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).not.toMatch(/\biResolution\b|\biTime\b|\bmainImage\b/);
    expect(r.code).toContain('vec4 imported_shader_pass(vec2 fragCoord) {');
    expect(r.code).toContain('return fragColor;');            // bare return and end of body
    expect(r.code.match(/return fragColor;/g)!.length).toBe(2);
    expect(r.code).toContain('vec3 imported_shader(vec2 uv, out float alpha) {');
    expect(r.notes).toEqual([]);
    // The publish path accepts it as a code node: uv in, colour + alpha out
    const d = describeSource({ kind: 'code', code: r.code, entry: r.entry, label: 'Plasma' });
    expect(d.error).toBeUndefined();
    expect(d.inputs.map(i => [i.portKey, i.type])).toEqual([['uv', 'vec2']]);
    expect(d.outputs.map(o => [o.portKey, o.type])).toEqual([['__return__', 'vec3'], ['alpha', 'float']]);
  });

  it('converts a raw main() with gl_FragColor, drops directives and known uniforms, and turns unknown ones into node inputs', () => {
    const r = convertFragmentShader(RAW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).not.toMatch(/#version|precision|^\s*uniform|gl_FragColor|gl_FragCoord/m);
    // `speed` is a global the entry sets from a socket of the same name
    expect(r.code).toContain('float uni_speed;');
    expect(r.code).toContain('sin(u_time * uni_speed)');
    expect(r.code).toContain('vec3 imported_shader(vec2 uv, float speed, out float alpha) {');
    expect(r.code).toContain('uni_speed = speed;');
    expect(r.notes.join(' ')).toMatch(/speed \(float\)/);
    expect(r.code).toContain('vec2 uv = fragCoord / u_resolution;');
    const d = describeSource({ kind: 'code', code: r.code, entry: r.entry, label: 'Raw' });
    expect(d.inputs.map(i => i.portKey)).toEqual(['uv', 'speed']);
  });

  it('imports a p5.js-style shader: #define, top-level consts, millis, a vec2 uniform, an int and an array', async () => {
    const P5 = `precision mediump float;
#define PI 3.1415926538
uniform vec2 u_resolution;
uniform float millis;
uniform vec2 u_point;
uniform int count;
uniform vec2 points[4];
const float min_x = 1.;
const float max_x = 100.;
float scaled(float v) { return (v - min_x) / (max_x - min_x); }
vec2 rotate(vec2 v, float a) { return vec2(v.x * cos(a) - v.y * sin(a), v.x * sin(a) + v.y * cos(a)); }
void main() {
    vec2 uv = (gl_FragCoord.xy / u_resolution.xy - 0.5) * 2.;
    uv = rotate(uv - u_point, millis * PI) + points[0];
    float d = length(uv) - scaled(50.) * float(count);
    gl_FragColor = vec4(vec3(0.01 / abs(d)), 1.0);
}`;
    const r = convertFragmentShader(P5, { label: 'p5' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).not.toMatch(/\bmillis\b/);
    expect(r.code).toContain('u_time * PI');
    expect(r.code).toContain('vec2 uni_points[4];');
    expect(r.code).toContain('uni_count = int(count);');
    expect(r.notes.join(' ')).toMatch(/millis was mapped to Time/);
    expect(r.notes.join(' ')).toMatch(/points\[4\]/);

    const source = { kind: 'code' as const, code: r.code, entry: r.entry, label: 'p5' };
    const d = describeSource(source);
    expect(d.inputs.map(i => `${i.portKey}:${i.type}`)).toEqual(['uv:vec2', 'u_point:vec2', 'count:float']);
    const built = buildUserNodeDefinition(source, {
      label: 'p5', category: 'My Nodes',
      inputs: d.inputs.map(i => ({ portKey: i.portKey, key: i.portKey, label: i.label, type: i.type })),
      outputs: [{ portKey: CODE_RETURN_PORT, key: 'color', label: 'Color', type: 'vec3' }, { portKey: 'alpha', key: 'alpha', label: 'Alpha', type: 'float' }],
      params: [], textures: [], existingId: 'un_p5_test',
    });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (!built.ok) return;
    // The top-level declarations travel with the node, first, under the node's prefix
    const pre = built.def.helperFunctions[0];
    expect(pre).toMatch(/#define un_p5_test_g_PI 3\.1415926538/);
    expect(pre).toContain('const float un_p5_test_g_min_x = 1.;');
    expect(pre).toContain('vec2 un_p5_test_g_uni_u_point;');
    expect(built.def.helperFunctions.join('\n')).toContain('un_p5_test_g_max_x - un_p5_test_g_min_x');
    // The shader's own rotate() can't collide with the built-in one
    expect(built.def.helperFunctions.join('\n')).toContain('vec2 un_p5_test_h_rotate(');

    await registerUserNode(built.def, { persist: false });
    const graph: GraphNode[] = [
      { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'm', type: 'mouse', position: { x: 0, y: 0 }, inputs: {}, outputs: { mouse: { type: 'vec2', label: 'Mouse' } }, params: {} },
      { id: 'sh', type: 'un_p5_test', position: { x: 0, y: 0 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } }, u_point: { type: 'vec2', label: 'u_point', connection: { nodeId: 'm', outputKey: 'mouse' } }, count: { type: 'float', label: 'count' } },
        outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } }, params: {} },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sh', outputKey: 'color' } } }, outputs: {}, params: {} },
    ];
    const c = compileGraph({ nodes: graph });
    expect(c.success, c.errors?.join()).toBe(true);
    expect(c.fragmentShader).toContain('#define un_p5_test_g_PI');
    // declarations precede the functions that read them
    expect(c.fragmentShader.indexOf('un_p5_test_g_min_x = 1.')).toBeLessThan(c.fragmentShader.indexOf('float un_p5_test_h_scaled('));
    unregisterUserNode('un_p5_test');
  });

  it('explains when there is nothing to convert, and flags iChannel textures', () => {
    expect(convertFragmentShader('float f(float x) { return x; }')).toMatchObject({ ok: false });
    const r = convertFragmentShader('void mainImage(out vec4 o, in vec2 p) { o = texture(iChannel0, p / iResolution.xy); }');
    expect(r.ok && r.notes[0]).toMatch(/iChannel/);
  });

  it('publishes as a node type that compiles wired UV → node → Output', async () => {
    const r = convertFragmentShader(SHADERTOY, { label: 'Plasma' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const built = buildUserNodeDefinition({ kind: 'code', code: r.code, entry: r.entry, label: 'Plasma' }, {
      label: 'Plasma', category: 'My Nodes',
      inputs: [{ portKey: 'uv', key: 'uv', label: 'UV', type: 'vec2' }],
      outputs: [{ portKey: CODE_RETURN_PORT, key: 'color', label: 'Color', type: 'vec3' }, { portKey: 'alpha', key: 'alpha', label: 'Alpha', type: 'float' }],
      params: [], textures: [], existingId: 'un_plasma_test',
    });
    expect(built.ok, built.ok ? '' : built.error).toBe(true);
    if (!built.ok) return;
    await registerUserNode(built.def, { persist: false });
    const graph: GraphNode[] = [
      { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'sh', type: 'un_plasma_test', position: { x: 0, y: 0 }, inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } } },
        outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } }, params: {} },
      { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sh', outputKey: 'color' } } }, outputs: {}, params: {} },
    ];
    const c = compileGraph({ nodes: graph });
    expect(c.success, c.errors?.join()).toBe(true);
    expect(c.fragmentShader).toContain('u_time');
    expect(c.fragmentShader).toMatch(/un_plasma_test\(/);
    unregisterUserNode('un_plasma_test');
  });
});
