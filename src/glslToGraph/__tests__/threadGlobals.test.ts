/**
 * A global that main() assigns and helpers read becomes a parameter of
 * every function that reads it or calls a reader, with the declaration moved
 * into main(). A global a helper writes is left alone.
 */
import { describe, expect, it } from 'vitest';
import { threadGlobals } from '../threadGlobals';
import { glslToGraph } from '..';
import { compileGraph } from '../../compiler/graphCompiler';

const SRC = `vec2 mouse; // set in main
float k = 2.0;
vec2 Z(vec2 U) { vec2 C = U - mouse; return C * k; }
float S(vec2 U) { return length(Z(U)); }
float E() { return S(vec2(0.0)); }
void main() {
  mouse = u_mouse * 2.0;
  gl_FragColor = vec4(vec3(S(gl_FragCoord.xy) + E()), 1.0);
}`;

describe('threadGlobals', () => {
  it('passes the global to readers and their callers, and declares it in main', () => {
    const { code, notes } = threadGlobals(SRC);
    expect(notes).toEqual(['Global mouse passed to Z, S, E as a parameter', 'Global k passed to Z, S, E as a parameter']);
    expect(code).toContain('vec2 Z(vec2 U, vec2 mouse, float k) {');
    expect(code).toContain('float S(vec2 U, vec2 mouse, float k) {');
    expect(code).toContain('float E(vec2 mouse, float k) {');
    expect(code).toContain('length(Z(U, mouse, k))');
    expect(code).toContain('S(vec2(0.0), mouse, k)');
    expect(code).toContain('S(gl_FragCoord.xy, mouse, k) + E(mouse, k)');
    expect(code).toMatch(/void main\(\) \{ (vec2 mouse; float k = 2\.0;|float k = 2\.0; vec2 mouse;)/);
    expect(code).not.toMatch(/^vec2 mouse;/m);
    expect(code.split('\n')).toHaveLength(SRC.split('\n').length);
    // The comment on the declaration line is not read as code
    expect(code).toContain('// set in main');
  });

  it('leaves a global a helper writes, and one only main uses, as they are', () => {
    const shared = 'float acc = 0.0;\nvoid bump() { acc += 1.0; }\nvoid main() { bump(); gl_FragColor = vec4(acc); }';
    expect(threadGlobals(shared)).toEqual({ code: shared, notes: [] });
    const local = 'float a;\nvoid main() { a = 1.0; gl_FragColor = vec4(a); }';
    expect(threadGlobals(local).notes).toEqual([]);
  });

  it('lets the converter take a Shadertoy-style shader with a global set in main', () => {
    const r = glslToGraph(SRC);
    expect(r.report.unsupported).toEqual([]);
    expect(r.nodes.length).toBeGreaterThan(0);
    const c = compileGraph({ nodes: r.nodes });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
  });
});
