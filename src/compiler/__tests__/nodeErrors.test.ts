import { describe, expect, it } from 'vitest';
import { buildNodeErrors } from '../nodeErrors';

describe('buildNodeErrors', () => {
  it('puts a type mismatch on the input and its source', () => {
    const map = buildNodeErrors({
      compilationErrors: ['Node n3 [source:n1]: type mismatch on input "radius". Expected float, got vec2'],
      glslErrors: [], glslSource: null, slugs: new Map(),
    });
    expect(map.get('n3')).toEqual([{ message: 'Expects float here but the wire brings vec2', socket: 'radius' }]);
    expect(map.get('n1')?.[0].socket).toBeUndefined();
  });

  it('traces a GLSL error line to the node whose variables are on or above it', () => {
    const source = [
      'void main() {',                                   // 1
      '    vec2 uv_1_uv = vUv;',                         // 2
      '    float fn_4_result = 0.0;',                    // 3
      '    for (int i = 0; i < 1; i++) {',               // 4
      '        float k = foo * 2.0;',                    // 5  ← error, owned by fn_4
      '    }',                                           // 6
      '}',
    ].join('\n');
    const map = buildNodeErrors({
      compilationErrors: [],
      glslErrors: ["ERROR: 0:5: 'foo' : undeclared identifier"],
      glslSource: source,
      slugs: new Map([['n1', 'uv_1'], ['n4', 'fn_4']]),
    });
    expect(map.get('n4')).toEqual([{ message: '“foo” isn\'t defined' }]);
    expect(map.has('n1')).toBe(false);
  });

  it('prefers the longest slug when one prefixes another', () => {
    const map = buildNodeErrors({
      compilationErrors: [],
      glslErrors: ["ERROR: 0:1: 'x' : syntax error"],
      glslSource: '    float grp_1_inner_2_v = x;',
      slugs: new Map([['g', 'grp_1'], ['inner', 'grp_1_inner_2']]),
    });
    expect([...map.keys()]).toEqual(['inner']);
  });
});
