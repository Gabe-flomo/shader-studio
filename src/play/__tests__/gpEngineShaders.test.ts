/**
 * The Particles engine's own shaders, byte for byte (Agents plan, phase 0:
 * docs/agents-plan.md section 10). The Agents group reuses GP's draw, glow
 * and compose GLSL through GP_SHADERS; this snapshot proves sharing them
 * never changes what the Particles node draws. A change to the snapshot is
 * only acceptable in a commit that deliberately changes the Particles engine.
 */
import { describe, expect, it } from 'vitest';
import { GP_SHADERS } from '../kit/gpuParticles.js';

/** cyrb53 under two seeds, plus the length (as goldenShaders.test.ts). */
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
const sha = (s: string) => `${cyrb53(s, 1)}${cyrb53(s, 7)}:${s.length}`;

describe('GP engine shaders are unchanged', () => {
  it('has every chunk', () => {
    expect(Object.keys(GP_SHADERS).sort()).toEqual([
      'GP_BLUR', 'GP_COMPOSE', 'GP_COVER', 'GP_DOWN', 'GP_DRAW_FRAG', 'GP_DRAW_VERT', 'GP_HASH',
      'GP_HOME', 'GP_NOISE', 'GP_QUAD_VERT', 'GP_SCATTER', 'GP_SIM',
    ]);
  });
  for (const [name, src] of Object.entries(GP_SHADERS)) {
    it(name, () => expect(sha(src as string)).toMatchSnapshot());
  }
});
