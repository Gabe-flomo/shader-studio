/**
 * autosavePlayfile.ts — autosaves as .playfile (docs/crash-recovery.md "What a
 * snapshot is"). The desktop writes `autosave-<ms>.playfile`: the app's own
 * project file, so Reveal in Finder → double-click opens it in Playfield like
 * any other .playfile. Older `autosave-<ms>.json` files (and the browser's
 * IndexedDB, which keeps the JSON shape) still read through parseSnapshot.
 *
 * "Light": the file holds one graph item (exactly what Save writes: nodes,
 * loose groups, the Play setup, datasets). Video layers' files are referenced
 * by their id in this device's videos library, not bundled, so an autosave
 * every minute stays a few KB. The snapshot's own fields (when, which session,
 * which project) ride in that item's manifest meta as `autosave`.
 */
import { writePlayfile } from '../playfile/writer';
import { readPlayfile } from '../playfile/reader';
import { fromUtf8 } from '../playfile/bytes';
import { SNAPSHOT_FORMAT, isPlayfileSnapshot, parseSnapshot, snapshotFileName, snapshotFrom, type ProjectInfo, type Snapshot } from './autosave';

const itemName = (project: ProjectInfo) => `${project.name ?? 'Untitled'} (autosave)`;

/** A snapshot as a .playfile: `{ file: autosave-<ms>.playfile, bytes }`. */
export async function buildSnapshotPlayfile(graphJson: string, project: ProjectInfo, session: string, at: number): Promise<{ file: string; bytes: Uint8Array }> {
  JSON.parse(graphJson); // a broken graph file never becomes an autosave
  const { bytes } = await writePlayfile([{
    kind: 'graph', name: itemName(project), data: graphJson,
    meta: { autosave: { format: SNAPSHOT_FORMAT, version: 1, at, session, project } },
  }], { created: new Date(at) });
  return { file: snapshotFileName(at, 'playfile'), bytes };
}

/** Any snapshot's .playfile (an old JSON one, or one from the browser): for Download. */
export async function snapshotAsPlayfile(snap: Snapshot): Promise<{ name: string; bytes: Uint8Array }> {
  const { bytes } = await buildSnapshotPlayfile(JSON.stringify(snap.graph), snap.project, snap.session, snap.at);
  return { name: `${snap.project.name ?? 'Untitled'} autosave ${new Date(snap.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.playfile`, bytes };
}

/** A .playfile autosave's bytes, or null when it isn't one (or holds no graph). */
export async function parseSnapshotPlayfile(file: string, bytes: Uint8Array): Promise<Snapshot | null> {
  try {
    const c = await readPlayfile(bytes);
    const item = c.items.find(i => i.kind === 'graph' || i.kind === 'play');
    if (!item) return null;
    const graph = JSON.parse(fromUtf8(item.data)) as unknown;
    if (!graph || typeof graph !== 'object' || !Array.isArray((graph as Record<string, unknown>).nodes)) return null;
    const meta = item.meta?.autosave;
    const o = meta && typeof meta === 'object' ? meta as Record<string, unknown> : {};
    return snapshotFrom(file, o, graph as Record<string, unknown>);
  } catch { return null; }
}

/** Either kind of snapshot file: a .playfile's bytes, or a .json's text. */
export async function readAnySnapshot(file: string, data: Uint8Array | string): Promise<Snapshot | null> {
  if (isPlayfileSnapshot(file)) return parseSnapshotPlayfile(file, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  return parseSnapshot(file, typeof data === 'string' ? data : fromUtf8(data));
}
