/** Projection mapping maths: the corner pin's homography, the mesh warp, the triangles, the edge blend and the edit helpers. */
import { describe, expect, it } from 'vitest';
import { apply, applyHomog, blendRamp, invert, isConvexQuad, meshEval, multiply, outputToSquare, pointInPolygon, quadToQuad, squareToQuad, surfaceGeometry, surfacePoint, MESH_SUBDIV, type Mat3 } from '../warp';
import { arrowStep, hitTest, MappingHistory, moveHandle, nudge } from '../mappingEdit';
import { defaultMesh, defaultProjection, fullQuad, meshGrid, newSurface, type ProjQuad } from '../../types/projection';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, d = 1e-9) => {
  expect(a.x).toBeCloseTo(b.x, -Math.log10(d));
  expect(a.y).toBeCloseTo(b.y, -Math.log10(d));
};
const Q: ProjQuad = [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.1 }, { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.7 }];

describe('squareToQuad', () => {
  it('maps the unit square’s corners onto the four corners', () => {
    const H = squareToQuad(Q);
    close(apply(H, 0, 0), Q[0]);
    close(apply(H, 1, 0), Q[1]);
    close(apply(H, 1, 1), Q[2]);
    close(apply(H, 0, 1), Q[3]);
  });

  it('is the identity for the full quad, and affine for a parallelogram', () => {
    const I = squareToQuad(fullQuad());
    close(apply(I, 0.3, 0.7), { x: 0.3, y: 0.7 });
    const P = squareToQuad([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }]);
    expect(P[6]).toBe(0); expect(P[7]).toBe(0);
    close(apply(P, 0.5, 0.5), { x: 1.5, y: 0.5 });
  });

  it('keeps straight lines straight (a projective map), unlike bilinear', () => {
    const H = squareToQuad(Q);
    // Three points on the square's diagonal stay on one line.
    const a = apply(H, 0, 0), b = apply(H, 0.37, 0.37), c = apply(H, 1, 1);
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    expect(Math.abs(cross)).toBeLessThan(1e-12);
  });

  it('is perspective-correct: the centre goes where the diagonals cross', () => {
    const H = squareToQuad(Q);
    const m = apply(H, 0.5, 0.5);
    // Intersection of Q0–Q2 and Q1–Q3.
    const [p, r] = [Q[0], { x: Q[2].x - Q[0].x, y: Q[2].y - Q[0].y }];
    const [q, s] = [Q[1], { x: Q[3].x - Q[1].x, y: Q[3].y - Q[1].y }];
    const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / (r.x * s.y - r.y * s.x);
    close(m, { x: p.x + t * r.x, y: p.y + t * r.y });
  });
});

describe('invert, multiply, quadToQuad', () => {
  it('inverts', () => {
    const H = squareToQuad(Q);
    const I = multiply(H, invert(H)!);
    const id: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    I.forEach((v, i) => expect(v / I[8]).toBeCloseTo(id[i], 9));
  });
  it('says so when a corner pin folds flat', () => {
    expect(invert([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });
  it('maps one quad onto another', () => {
    const to: ProjQuad = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
    const M = quadToQuad(Q, to)!;
    Q.forEach((p, i) => close(apply(M, p.x, p.y), to[i], 1e-7));
  });
  it('goes back from the output into the square', () => {
    const p = apply(squareToQuad(Q), 0.25, 0.6);
    close(outputToSquare(Q, p.x, p.y)!, { x: 0.25, y: 0.6 }, 1e-9);
  });
});

describe('isConvexQuad', () => {
  it('accepts a proper corner pin and rejects a bow tie', () => {
    expect(isConvexQuad(Q)).toBe(true);
    expect(isConvexQuad(fullQuad())).toBe(true);
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false);
  });
});

describe('meshEval', () => {
  it('an even grid is the identity, linear and smooth, edges included', () => {
    for (const interp of ['linear', 'smooth'] as const) {
      for (const n of [2, 3, 4, 7]) {
        const mesh = { cols: n, rows: n, points: meshGrid(n, n), interp };
        for (const [u, v] of [[0, 0], [1, 1], [0.1, 0.9], [0.5, 0.33], [0.99, 0.01]]) close(meshEval(mesh, u, v), { x: u, y: v }, 1e-9);
      }
    }
  });

  it('passes through its points (smooth too)', () => {
    const pts = meshGrid(4, 4).map((p, i) => ({ x: p.x + (i % 3) * 0.02, y: p.y - (i % 2) * 0.03 }));
    for (const interp of ['linear', 'smooth'] as const) {
      const mesh = { cols: 4, rows: 4, points: pts, interp };
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) close(meshEval(mesh, i / 3, j / 3), pts[j * 4 + i], 1e-9);
    }
  });

  it('linear is bilinear inside a cell', () => {
    const pts = meshGrid(2, 2);
    pts[3] = { x: 1.2, y: 1.4 };
    const p = meshEval({ cols: 2, rows: 2, points: pts, interp: 'linear' }, 0.5, 0.5);
    close(p, { x: (0 + 1 + 0 + 1.2) / 4, y: (0 + 0 + 1 + 1.4) / 4 });
  });

  it('smooth bends between the points where linear goes straight', () => {
    const pts = meshGrid(4, 4);
    pts[5] = { x: pts[5].x, y: pts[5].y - 0.1 }; // lift an inner point
    const lin = meshEval({ cols: 4, rows: 4, points: pts, interp: 'linear' }, 0.5, 1 / 3);
    const smo = meshEval({ cols: 4, rows: 4, points: pts, interp: 'smooth' }, 0.5, 1 / 3);
    expect(lin.y).not.toBeCloseTo(smo.y, 4);
  });
});

describe('surfaceGeometry', () => {
  it('a corner pin is one quad whose homogeneous vertices land on the corners', () => {
    const g = surfaceGeometry({ corners: Q, mesh: defaultMesh() });
    expect(g.indices.length).toBe(6);
    expect(g.vertices.length).toBe(4 * 5);
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    corners.forEach(([u, v], i) => {
      const [cx, cy, w] = [g.vertices[i * 5], g.vertices[i * 5 + 1], g.vertices[i * 5 + 2]];
      expect(w).toBeGreaterThan(0);
      const out = { x: (cx / w + 1) / 2, y: (1 - cy / w) / 2 };
      const want = apply(squareToQuad(Q), u, v);
      close(out, want, 1e-6);
      expect(g.vertices[i * 5 + 3]).toBe(u);
      expect(g.vertices[i * 5 + 4]).toBe(v);
    });
  });

  it('a mesh is cut finely, within 16-bit indices at the biggest size', () => {
    const mesh = { ...defaultMesh(), on: true, cols: 8, rows: 8, points: meshGrid(8, 8) };
    const g = surfaceGeometry({ corners: Q, mesh });
    const n = 7 * MESH_SUBDIV;
    expect(g.indices.length).toBe(n * n * 6);
    expect((n + 1) * (n + 1)).toBeLessThan(65536);
  });

  it('keeps W positive when the homography comes out negative', () => {
    // Corners listed anticlockwise: same shape, the matrix may flip sign.
    const g = surfaceGeometry({ corners: [Q[0], Q[3], Q[2], Q[1]], mesh: defaultMesh() });
    for (let i = 0; i < 4; i++) expect(g.vertices[i * 5 + 2]).toBeGreaterThan(0);
  });

  it('surfacePoint goes through the mesh then the pin', () => {
    const s = { corners: Q, mesh: { ...defaultMesh(), on: true } };
    close(surfacePoint(s, 0.4, 0.6), apply(squareToQuad(Q), 0.4, 0.6), 1e-9);
    expect(applyHomog(squareToQuad(Q), 0.5, 0.5)[2]).not.toBe(0);
  });
});

describe('blendRamp', () => {
  it('is 1 with no feather, 0 at the edge, 1 past the width', () => {
    expect(blendRamp(0, 0, 2, 2.2)).toBe(1);
    expect(blendRamp(0, 0.2, 2, 2.2)).toBe(0);
    expect(blendRamp(0.2, 0.2, 2, 2.2)).toBe(1);
    expect(blendRamp(0.5, 0.2, 2, 2.2)).toBe(1);
  });
  it('two overlapping ramps add up to full light once the projector’s gamma is applied', () => {
    for (const curve of [1, 2, 3]) for (const x of [0.1, 0.25, 0.5, 0.8]) {
      const a = Math.pow(blendRamp(x, 1, curve, 2.2), 2.2), b = Math.pow(blendRamp(1 - x, 1, curve, 2.2), 2.2);
      expect(a + b).toBeCloseTo(1, 9);
    }
  });
});

describe('pointInPolygon', () => {
  it('handles a concave polygon', () => {
    const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    expect(pointInPolygon(L, 0.5, 1.5)).toBe(true);
    expect(pointInPolygon(L, 1.5, 1.5)).toBe(false);
  });
});

describe('editing', () => {
  const proj = () => { const p = defaultProjection(); p.surfaces[0] = { ...newSurface('A', Q), id: 's1', mesh: { ...defaultMesh(), on: true } }; return p; };

  it('hits the nearest corner within reach, else the surface under the press', () => {
    const p = proj();
    expect(hitTest(p, 's1', Q[2].x + 0.002, Q[2].y, 1000, 1000)).toEqual({ kind: 'corner', surfaceId: 's1', index: 2 });
    expect(hitTest(p, 's1', 0.45, 0.45, 1000, 1000)).toEqual({ kind: 'surface', surfaceId: 's1' });
    expect(hitTest(p, 's1', 0.99, 0.02, 1000, 1000)).toBeNull();
  });

  it('moves a corner, and a mesh point through the pin', () => {
    const p = proj();
    const a = moveHandle(p, { kind: 'corner', surfaceId: 's1', index: 0 }, 0.3, 0.3);
    close(a.surfaces[0].corners[0], { x: 0.3, y: 0.3 });
    const target = apply(squareToQuad(Q), 0.4, 0.35);
    const b = moveHandle(p, { kind: 'mesh', surfaceId: 's1', index: 5 }, target.x, target.y);
    close(b.surfaces[0].mesh.points[5], { x: 0.4, y: 0.35 }, 1e-9);
    expect(p.surfaces[0].corners[0]).toEqual(Q[0]); // the old record is untouched
  });

  it('nudges by output pixels', () => {
    const p = proj();
    const step = arrowStep('ArrowRight', true, 1920, 1080)!;
    expect(step.dx).toBeCloseTo(10 / 1920, 12);
    const n = nudge(p, { kind: 'surface', surfaceId: 's1' }, step.dx, step.dy);
    n.surfaces[0].corners.forEach((c, i) => close(c, { x: Q[i].x + 10 / 1920, y: Q[i].y }));
    const c = nudge(p, { kind: 'corner', surfaceId: 's1', index: 1 }, 0, -1 / 1080);
    close(c.surfaces[0].corners[1], { x: Q[1].x, y: Q[1].y - 1 / 1080 });
    expect(arrowStep('a', false, 1, 1)).toBeNull();
  });

  it('undoes and redoes', () => {
    const h = new MappingHistory();
    const a = proj(), b = nudge(a, { kind: 'surface', surfaceId: 's1' }, 0.1, 0), c = nudge(b, { kind: 'surface', surfaceId: 's1' }, 0.1, 0);
    h.push(a); h.push(b);
    expect(h.undo(c)).toBe(b);
    expect(h.undo(b)).toBe(a);
    expect(h.undo(a)).toBeNull();
    expect(h.redo(a)).toBe(b);
    h.push(b);
    expect(h.canRedo()).toBe(false);
  });
});
