/** The projection mapping record: reading, tidying, migrating version 1, presets, and riding in the Play record. */
import { describe, expect, it } from 'vitest';
import { defaultProjection, isIdentityProjection, meshGrid, parsePresets, parseProjection, PROJECTION_VERSION } from '../../types/projection';
import { emptyPlayRecord, isPlayRecordEmpty, parsePlayRecord } from '../../types/play';
import { playBundle } from '../../play/exportHtml';

describe('parseProjection', () => {
  it('round-trips a mapping', () => {
    const p = defaultProjection();
    p.surfaces[0].corners[1] = { x: 0.9, y: 0.05 };
    p.surfaces[0].mesh = { on: true, cols: 3, rows: 3, points: meshGrid(3, 3), interp: 'linear' };
    p.surfaces[0].blend.right = 0.15;
    p.masks.push({ id: 'm1', name: 'Door', enabled: true, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.2, y: 0.4 }], invert: true });
    expect(parseProjection(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('is undefined for nothing usable, and leaves a newer version alone', () => {
    expect(parseProjection(null)).toBeUndefined();
    expect(parseProjection({ surfaces: [], masks: [] })).toBeUndefined();
    expect(parseProjection({ version: PROJECTION_VERSION + 1, surfaces: [{}] })).toBeUndefined();
  });

  it('clamps numbers, fixes bad corners and meshes, drops short masks, makes ids unique', () => {
    const p = parseProjection({
      version: 2,
      surfaces: [
        { id: 'a', corners: [[0, 0], [1, 0]], brightness: 9, gamma: -1, blend: { left: 3, gamma: 0.1 }, region: { x: 0.5, w: 0.9 }, mesh: { on: true, cols: 99, rows: 1, points: [1, 2] } },
        { id: 'a', name: 'Twin', source: { kind: 'layer', id: 'L1' } },
      ],
      masks: [{ points: [[0, 0], [1, 1]] }, { points: [[0, 0], [1, 0], [1, 1]] }],
    })!;
    const [s, t] = p.surfaces;
    expect(s.corners).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    expect(s.brightness).toBe(2);
    expect(s.gamma).toBe(0.2);
    expect(s.blend.left).toBe(0.5);
    expect(s.blend.gamma).toBe(1);
    expect(s.region.x).toBe(0.5);
    expect(s.region.w).toBeCloseTo(0.5, 9);
    expect(s.mesh.cols).toBe(8);
    expect(s.mesh.rows).toBe(2);
    expect(s.mesh.points).toEqual(meshGrid(8, 2));
    expect(t.id).not.toBe('a');
    expect(t.source).toEqual({ kind: 'layer', id: 'L1' });
    expect(p.masks).toHaveLength(1);
  });

  it('migrates version 1: flat point arrays, one mesh size, the source as a word', () => {
    const v1 = {
      version: 1,
      surfaces: [{
        id: 's', name: 'Wall', corners: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],
        mesh: { on: true, size: 3, points: meshGrid(3, 3).flatMap(q => [q.x, q.y]) },
        source: 'layer:abc',
      }],
      masks: [{ id: 'm', points: [0, 0, 0.5, 0, 0.5, 0.5] }],
    };
    const p = parseProjection(v1)!;
    expect(p.version).toBe(PROJECTION_VERSION);
    expect(p.surfaces[0].corners[2]).toEqual({ x: 0.9, y: 0.9 });
    expect(p.surfaces[0].mesh).toMatchObject({ on: true, cols: 3, rows: 3 });
    expect(p.surfaces[0].mesh.points).toEqual(meshGrid(3, 3));
    expect(p.surfaces[0].source).toEqual({ kind: 'layer', id: 'abc' });
    expect(p.masks[0].points).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }]);
    expect(parseProjection({ surfaces: [{ source: 'shader' }] })!.surfaces[0].source).toEqual({ kind: 'shader' });
  });

  it('knows a mapping that changes nothing', () => {
    const p = defaultProjection();
    expect(isIdentityProjection(p)).toBe(true);
    expect(isIdentityProjection({ ...p, surfaces: [{ ...p.surfaces[0], brightness: 0.8 }] })).toBe(false);
  });
});

describe('presets', () => {
  it('keeps the good ones', () => {
    const list = parsePresets([{ id: 'p', name: 'Hall', venue: 'Room 2', savedAt: 5, projection: defaultProjection() }, { name: 'broken' }, 7]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p', name: 'Hall', venue: 'Room 2', savedAt: 5 });
    expect(parsePresets('nope')).toEqual([]);
  });
});

describe('in the Play record', () => {
  it('saves with the Play (and so travels in .playfile), and counts as something', () => {
    const projection = defaultProjection();
    const play = { ...emptyPlayRecord(), projection };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(play)));
    expect(back.projection).toEqual(projection);
    expect(isPlayRecordEmpty(back)).toBe(false);
    expect(parsePlayRecord({ ...emptyPlayRecord(), projection: 'junk' }).projection).toBeUndefined();
  });

  it('stays out of a web page', () => {
    const play = { ...emptyPlayRecord(), projection: defaultProjection() };
    const b = playBundle({ title: 't', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play, aspect: 'free' } as unknown as Parameters<typeof playBundle>[0]);
    expect((b.play as Record<string, unknown>).projection).toBeUndefined();
  });
});
