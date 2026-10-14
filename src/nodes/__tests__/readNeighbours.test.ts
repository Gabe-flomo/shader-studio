/** Read neighbours (texture) (nodes/definitions/readNeighbours.ts): four exact neighbour reads, the Laplacian and the gradient. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { ReadNeighboursNode, retypeReadNeighbours } from '../definitions/readNeighbours';
import { getNodeDefinition } from '../definitions';
import { n } from '../../store/graphBuilder';

describe('Read neighbours (texture)', () => {
  it('is a texture tool; outputs are as wide as the channels, Gradient a vec2', () => {
    expect(getNodeDefinition('readNeighbours')!.category).toBe('Texture tools');
    const one = retypeReadNeighbours(n('readNeighbours', 'nb', 0, 0, { channels: 'r' }));
    expect(one.outputs.laplacian.type).toBe('float');
    const three = retypeReadNeighbours({ ...one, params: { ...one.params, channels: 'rgb' } });
    expect(three.outputs.left.type).toBe('vec3');
    expect(three.outputs.laplacian.type).toBe('vec3');
    expect(three.outputs.gradient.type).toBe('vec2');
  });

  it('reads four texels exactly, Distance away, and works out the Laplacian and Gradient', () => {
    const node = n('readNeighbours', 'nb', 0, 0, { channels: 'r', distance: 2 });
    const { code, outputVars } = ReadNeighboursNode.generateGLSL(node, { texture: 'u_tex' });
    expect(code.match(/texelFetch\(u_tex/g)?.length).toBe(5);
    expect(code).toContain('int nb_d = max(int(2.0), 1);');
    expect(code).toContain('float nb_lap = nb_left + nb_right + nb_up + nb_down - 4.0 * nb_here;');
    expect(code).toContain('vec2 nb_grad = vec2(nb_right - nb_left, nb_up - nb_down) * 0.5;');
    expect(Object.keys(outputVars)).toEqual(['here', 'left', 'right', 'up', 'down', 'laplacian', 'gradient']);
  });

  it('with no texture, everything is 0', () => {
    const { code } = ReadNeighboursNode.generateGLSL(n('readNeighbours', 'nb', 0, 0, {}), {});
    expect(code).toContain('float nb_lap = float(0.0);');
  });
});
