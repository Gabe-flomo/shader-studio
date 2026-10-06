/** Value kinds (suggestions/kinds.ts): what a socket carries, from its type, name and node family. */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { n } from '../../store/graphBuilder';
import { NODE_REGISTRY } from '../../nodes/definitions';
import { outputKinds, primaryKind, socketKind, spaceInputs } from '../kinds';

const kindOf = (type: string, key?: string) => {
  const node = n(type, 'x', 0, 0);
  return key ? socketKind(type, key, node.outputs[key], 'out') : primaryKind(node);
};

describe('kind inference', () => {
  it.each([
    ['circleSDF', 'distance'], ['boxSDF', 'distance'], ['shapeSDF', 'distance'], ['sdfUnion', 'distance'], ['sdfOnion', 'distance'], ['sdfOffset', 'distance'],
    ['sdfMask', 'mask'], ['smoothstep', 'mask'], ['compare', 'mask'], ['dotMask', 'mask'],
    ['palette', 'colour'], ['toneMap', 'colour'], ['gradient', 'colour'], ['colorPicker', 'colour'], ['light', 'colour'],
    ['uv', 'space'], ['polarSpace', 'space'], ['fract', 'space'], ['domainWarp', 'space'],
    ['pass', 'colour'], ['textureInput', 'colour'],
    ['fbm', 'scalar'], ['time', 'scalar'], ['multiply', 'scalar'], ['noiseFloat', 'scalar'],
    ['scenePos', 'scene3d'], ['sceneGroup', 'scene3d'],
  ])('%s → %s', (type, kind) => expect(kindOf(type)).toBe(kind));

  it('reads the socket, not just the node', () => {
    expect(kindOf('light', 'tinted')).toBe('colour');
    expect(kindOf('pass', 'texture')).toBe('texture');
    expect(kindOf('voronoi', 'dist')).toBe('distance');
    expect(kindOf('gridLayout', 'cellUV')).toBe('space');
    expect(kindOf('gridLayout', 'cellID')).toBe('scalar');
    expect(kindOf('mouse', 'uv')).toBe('scalar'); // a point, not a space
    expect(kindOf('truchet', 'mask')).toBe('mask');
    expect(kindOf('vectorField', 'dir')).toBe('scalar'); // a direction
  });

  it('skips pass-through outputs (FBM\'s UV)', () => {
    expect(outputKinds(n('fbm', 'f', 0, 0)).map(o => o.key)).toEqual(['value']);
  });

  it('finds space inputs: a shape\'s position, a warp\'s input; not a centre or a size', () => {
    expect(spaceInputs(n('circleSDF', 'c', 0, 0)).map(s => s.key)).toEqual(['position']);
    expect(spaceInputs(n('boxSDF', 'c', 0, 0)).map(s => s.key)).toEqual(['position']);
    expect(spaceInputs(n('polarSpace', 'p', 0, 0)).map(s => s.key)).toEqual(['input']);
    expect(spaceInputs(n('fbm', 'f', 0, 0)).map(s => s.key)).toEqual(['uv']);
    expect(spaceInputs(n('sphereSDF3D', 's', 0, 0))).toEqual([]);
  });

  it('gives every float, vec2, vec3 and texture output of every node a kind', () => {
    for (const def of Object.values(NODE_REGISTRY)) {
      for (const [key, s] of Object.entries(def.outputs)) {
        if (!['float', 'vec2', 'vec3', 'vec4', 'texture'].includes(s.type)) continue;
        expect(socketKind(def.type, key, s, 'out'), `${def.type}.${key}`).not.toBeNull();
      }
    }
  });
});
