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

  it('converts a raw main() with gl_FragColor, drops directives and known uniforms, and keeps unknown ones as constants', () => {
    const r = convertFragmentShader(RAW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).not.toMatch(/#version|precision|^\s*uniform|gl_FragColor|gl_FragCoord/m);
    expect(r.code).toContain('const float speed = 0.0;');
    expect(r.notes.join(' ')).toMatch(/speed \(float\)/);
    expect(r.code).toContain('vec2 uv = fragCoord / u_resolution;');
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
