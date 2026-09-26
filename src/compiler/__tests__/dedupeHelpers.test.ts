/**
 * Helper de-duplication across the blocks nodes carry: one definition per
 * function *signature* (overloads are different functions), one copy of a
 * top-level statement repeated verbatim (the const lines imported regions
 * each carry), and dead-helper pruning that keeps every overload of a name
 * the main body calls.
 */
import { describe, expect, it } from 'vitest';
import { dedupeGlslFunctions, pruneUnusedGlslFunctions } from '../shaderAssembler';

const V3 = 'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }';
const V4 = 'vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }';

describe('dedupeGlslFunctions', () => {
  it('keeps overloads of one name and drops a second copy of the same signature', () => {
    const out = dedupeGlslFunctions([`${V3}\n${V4}`, `${V4}\nfloat other(float a) { return a; }`]).join('\n');
    expect(out.match(/mod289\(vec3 x\)/g)).toHaveLength(1);
    expect(out.match(/mod289\(vec4 x\)/g)).toHaveLength(1);
    expect(out).toContain('float other(float a)');
  });

  it('treats parameter names and qualifiers as irrelevant to the signature', () => {
    const out = dedupeGlslFunctions(['float f(in float a) { return a; }', 'float f(float b) { return b * 2.0; }']).join('\n');
    expect(out.match(/float f\(/g)).toHaveLength(1);
    expect(out).toContain('return a;');
  });

  it('emits a repeated const line once, and keeps different ones', () => {
    const out = dedupeGlslFunctions(['const float PI_ = 3.14159265;\nconst vec2 PAD = vec2(0.6, 0.4);\nfloat a(float x) { return x; }', 'const float PI_ = 3.14159265;\nconst float BOX = 0.3;\nfloat b(float x) { return x; }']).join('\n');
    expect(out.match(/const float PI_/g)).toHaveLength(1);
    expect(out).toContain('const vec2 PAD');
    expect(out).toContain('const float BOX');
  });
});

describe('pruneUnusedGlslFunctions', () => {
  it('keeps every overload of a called name and drops what nothing reaches', () => {
    const blocks = [`${V3}\n${V4}\nvec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }\nfloat unused(float a) { return a; }`];
    const out = pruneUnusedGlslFunctions(blocks, 'vec4 p = permute(vec4(1.0));').join('\n');
    expect(out).toContain('vec3 mod289');
    expect(out).toContain('vec4 mod289');
    expect(out).toContain('vec4 permute');
    expect(out).not.toContain('float unused');
  });
});
