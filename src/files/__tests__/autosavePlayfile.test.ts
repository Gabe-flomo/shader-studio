/**
 * Autosaves as .play files (docs/crash-recovery.md "What a snapshot is"): the
 * file is a valid .play file that re-opens identically, as a snapshot and
 * through the ordinary .playfile reader; old JSON autosaves still recover.
 */
import { describe, expect, it } from 'vitest';
import { buildSnapshotPlayfile, parseSnapshotPlayfile, readAnySnapshot, snapshotAsPlayfile } from '../autosavePlayfile';
import { buildSnapshot, isPlayfileSnapshot, planRotation, snapshotFileName, snapshotFileTime } from '../autosave';
import { isPlayfile, readPlayfile } from '../../playfile/reader';
import { fromUtf8 } from '../../playfile/bytes';

const graph = {
  nodes: [
    { id: 'n2', type: 'output', position: { x: 1360, y: 240 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: { _schemaVersion: 1 } },
    { id: 'n5', type: 'uv', position: { x: 200, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
  ],
  looseGroups: [],
  play: { layers: [{ id: 'l1', kind: 'video', videoId: 'vid-abc' }] },
  layout: 3,
};
const graphJson = JSON.stringify(graph);
const project = { name: 'Rings', version: 4, dirty: true };

describe('autosaves as .play files', () => {
  it('writes a valid .play file that re-opens identically', async () => {
    const { file, bytes } = await buildSnapshotPlayfile(graphJson, project, 's1', 1_791_774_262_570);
    expect(file).toBe('autosave-1791774262570.play');
    expect(isPlayfile(bytes)).toBe(true);
    const snap = await parseSnapshotPlayfile(file, bytes);
    expect(snap).toMatchObject({ file, at: 1_791_774_262_570, session: 's1', project, work: 2 });
    expect(snap!.graph).toEqual(graph);
    // Opened as any .playfile (Finder double-click): one graph item, exactly what Save writes.
    const c = await readPlayfile(bytes);
    expect(c.skipped).toEqual([]);
    expect(c.items).toHaveLength(1);
    expect(c.items[0].kind).toBe('graph');
    expect(c.items[0].name).toBe('Rings (autosave)');
    expect(fromUtf8(c.items[0].data)).toBe(graphJson);
  });

  it('is light: a Video layer keeps its library id, no media is bundled', async () => {
    const { bytes } = await buildSnapshotPlayfile(graphJson, project, 's1', 1000);
    const c = await readPlayfile(bytes);
    expect(c.items.every(i => i.kind === 'graph')).toBe(true);
    expect(fromUtf8(c.items[0].data)).toContain('vid-abc');
  });

  it('old JSON autosaves still recover, through the same reader', async () => {
    const { file, body } = buildSnapshot(graphJson, { name: null, version: null, dirty: true }, 's0', 1_791_771_862_664);
    expect(file).toBe('autosave-1791771862664.json');
    const snap = await readAnySnapshot(file, body);
    expect(snap).toMatchObject({ session: 's0', at: 1_791_771_862_664, project: { name: null, dirty: true } });
    expect(snap!.graph).toEqual(graph);
    // And from bytes (IndexedDB or a read that came back as bytes).
    expect((await readAnySnapshot(file, new TextEncoder().encode(body)))!.graph).toEqual(graph);
  });

  it('an autosave from 2026.10.183 (autosave-<ms>.playfile) still recovers', async () => {
    const { bytes } = await buildSnapshotPlayfile(graphJson, project, 's1', 1_791_774_262_570);
    const old = 'autosave-1791774262570.playfile';
    expect(snapshotFileTime(old)).toBe(1_791_774_262_570);
    expect(isPlayfileSnapshot(old)).toBe(true);
    expect((await readAnySnapshot(old, bytes))!.graph).toEqual(graph);
  });

  it('a JSON autosave downloads as a .play file that reads back the same', async () => {
    const { file, body } = buildSnapshot(graphJson, project, 's0', 5000);
    const snap = (await readAnySnapshot(file, body))!;
    const { name, bytes } = await snapshotAsPlayfile(snap);
    expect(name.endsWith('.play')).toBe(true);
    const back = await parseSnapshotPlayfile(snapshotFileName(5000, 'play'), bytes);
    expect(back!.graph).toEqual(graph);
    expect(back!.project).toEqual(project);
  });

  it('a damaged or foreign file is not a snapshot', async () => {
    expect(await parseSnapshotPlayfile('autosave-1.playfile', new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await readAnySnapshot('autosave-1000000000000.json', 'not json')).toBeNull();
  });

  it('keeps the newest 3 across .play, .playfile and .json', () => {
    const files = ['autosave-1000000000001.json', 'autosave-1000000000004.play', 'autosave-1000000000003.playfile', 'autosave-1000000000002.json', 'session.json'];
    expect(planRotation(files)).toEqual({
      keep: ['autosave-1000000000004.play', 'autosave-1000000000003.playfile', 'autosave-1000000000002.json'],
      remove: ['autosave-1000000000001.json'],
    });
  });
});
