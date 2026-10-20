/**
 * Blob Space (docs/combine.md, "Replace mask with"): the CPU mirror of its maths (which blob a pixel is on, its place
 * in the fitted box, Inside, By order / By ID, Spin by ID), and the node compiling with a fill chain as a field and with
 * a fill texture.
 */
import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { blobSpaceAt, type CpuBlob } from '../definitions/blobSpace';

const RES: [number, number] = [1600, 900];
const ASP = 1600 / 900;
const close = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

// Two blobs: a tall one on the left (the oldest, slot 0) and a small one on the right.
const BLOBS: CpuBlob[] = [
  { x: 0.3, y: 0.5, w: 0.1, h: 0.4, id: 3 },
  { x: 0.75, y: 0.4, w: 0.08, h: 0.12, id: 7 },
];

describe('blobSpaceAt', () => {
  it('finds the blob a pixel is on, its slot and ID, with the centre at Local UV 0', () => {
    const a = blobSpaceAt([0.3, 0.5], BLOBS, RES);
    expect(a).toMatchObject({ slot: 0, id: 3, inside: 1 });
    close(a.localUv[0], 0); close(a.localUv[1], 0);
    close(a.texUv[0], 0.5); close(a.texUv[1], 0.5);
    const b = blobSpaceAt([0.75, 0.4], BLOBS, RES);
    expect(b).toMatchObject({ slot: 1, id: 7 });
    const none = blobSpaceAt([0.05, 0.95], BLOBS, RES);
    expect(none).toMatchObject({ slot: -1, id: 0, inside: 0 });
  });

  it('Square: the box is as big as the blob\'s longer side (padding included), Local UV −1…1 across it', () => {
    // The tall blob: 0.4 × 900 = 360 px high, × 1.1 padding = 396; half 198 px. A point 198 px up is on the top edge.
    const top = blobSpaceAt([0.3, 0.5 + 198 / 900 - 1e-4], BLOBS, RES, { fit: 'square', padding: 0.1, softness: 0.0001 });
    close(top.localUv[1], 1, 2e-3);
    expect(top.inside).toBeGreaterThan(0.5);
    // Square keeps the fill's shape: the same 198 px to the side is x = 1 too (not stretched by the canvas's aspect).
    const side = blobSpaceAt([0.3 + 198 / 1600 - 1e-4, 0.5], BLOBS, RES, { fit: 'square', padding: 0.1, softness: 0.0001 });
    close(side.localUv[0], 1, 2e-3);
  });

  it('Box stretches the whole frame into the box: its right edge is at x = the aspect, as the UV node has it', () => {
    // Box half-width: 0.1 × 1600 × 1.1 / 2 = 88 px.
    const right = blobSpaceAt([0.3 + 88 / 1600 - 1e-4, 0.5], BLOBS, RES, { fit: 'box', padding: 0.1, softness: 0.0001 });
    close(right.localUv[0], ASP, 5e-3);
    const out = blobSpaceAt([0.3 + 100 / 1600, 0.5], BLOBS, RES, { fit: 'box', padding: 0.1, softness: 0.0001 });
    expect(out.inside).toBe(0);
  });

  it('Circle cuts the corners off the square', () => {
    const corner = blobSpaceAt([0.3 + 180 / 1600, 0.5 + 180 / 900], BLOBS, RES, { fit: 'circle', padding: 0.1 });
    expect(corner.inside).toBe(0);
    expect(blobSpaceAt([0.3 + 180 / 1600, 0.5 + 180 / 900], BLOBS, RES, { fit: 'square', padding: 0.1 }).inside).toBe(1);
  });

  it('Fill scale shows the fill bigger against its blob', () => {
    const a = blobSpaceAt([0.3, 0.5 + 99 / 900], BLOBS, RES, { padding: 0.1 });
    const b = blobSpaceAt([0.3, 0.5 + 99 / 900], BLOBS, RES, { padding: 0.1, scale: 2 });
    close(b.localUv[1], a.localUv[1] / 2);
  });

  it('One blob, By order or By ID', () => {
    const p: [number, number] = [0.75, 0.4];
    expect(blobSpaceAt(p, BLOBS, RES, { only: 'one', onlyBy: 'order', onlyIndex: 1 }).slot).toBe(1);
    expect(blobSpaceAt(p, BLOBS, RES, { only: 'one', onlyBy: 'order', onlyIndex: 0 }).slot).toBe(-1);
    expect(blobSpaceAt(p, BLOBS, RES, { only: 'one', onlyBy: 'id', onlyIndex: 7 }).id).toBe(7);
    expect(blobSpaceAt(p, BLOBS, RES, { only: 'one', onlyBy: 'id', onlyIndex: 3 }).slot).toBe(-1);
    // By order follows the slot when the oldest blob leaves: the other one is slot 0 now.
    expect(blobSpaceAt(p, BLOBS.slice(1), RES, { only: 'one', onlyBy: 'order', onlyIndex: 0 })).toMatchObject({ slot: 0, id: 7 });
  });

  it('Spin by ID turns each blob\'s fill by its own angle', () => {
    const p: [number, number] = [0.3, 0.5 + 100 / 900];
    const still = blobSpaceAt(p, BLOBS, RES, { spin: 0 });
    const spun = blobSpaceAt(p, BLOBS, RES, { spin: 1 });
    const r = (v: [number, number]) => Math.hypot(v[0], v[1]);
    close(r(spun.localUv), r(still.localUv));
    expect(Math.abs(spun.localUv[0] - still.localUv[0])).toBeGreaterThan(0.05);
  });
});

describe('the node', () => {
  const base = () => [
    n('textureInput', 'pic', 0, 0, { fit: 'stretch' }),
    n('blobTrack', 'bt', 300, 0, {}, { texture: ['pic', 'texture'] }),
  ];

  it('compiles with a fill chain as a field (drawn at each blob\'s Local UV)', () => {
    const nodes = [
      ...base(),
      n('uv', 'uv', 0, 300),
      n('circleSDF', 'circ', 300, 300, { radius: 0.5 }, { position: ['uv', 'uv'] }),
      n('palette', 'pal', 600, 300, {}, { value: ['circ', 'distance'] }),
      n('blobSpace', 'bs', 900, 0, { fit: 'circle' }, { blobs: ['bt', 'texture'], fill: ['pal', 'color'] }),
      n('output', 'out', 1200, 0, {}, { color: ['bs', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/fieldfn_\w+\(\w+_luv, vec2\(\w+_slot/);
    expect(r.fragmentShader).toMatch(/texelFetch\(u_tex_\w+, ivec2\(i, 1\)/);
  });

  it('compiles with a fill texture, and alone (each blob\'s ID colour)', () => {
    for (const wires of [{ blobs: ['bt', 'texture'], fillTexture: ['pic', 'texture'] }, { blobs: ['bt', 'texture'] }] as Array<Record<string, [string, string]>>) {
      const nodes = [...base(), n('blobSpace', 'bs', 900, 0, {}, wires), n('output', 'out', 1200, 0, {}, { color: ['bs', 'color'] })];
      const r = compileGraph({ nodes });
      expect(r.errors ?? []).toEqual([]);
      expect(r.success).toBe(true);
    }
  });
});
