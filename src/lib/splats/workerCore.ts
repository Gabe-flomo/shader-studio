/**
 * The splat worker's work (docs/splat-scene.md; worker.ts runs it): reads a scan, lays it out for the GPU and sorts it, off the main thread so a
 * million-splat file never freezes the editor.
 *
 *   load  { key, bytes, name, max, sh }  → { info, packed, thumb } (the file is kept here, by key)
 *   pack  { key, max, sh }               → { packed } (Max splats or SH degree changed: no new parse)
 *   sort  { key, axis }                  → { order } (far to near, for the splats packed last)
 *   drop  { key }
 */
import { parseSplatFile, SplatFormatError, type SplatData } from './format';
import { packSplats, sortScratch, sortSplats, splatInfo, thumbnailPixels, type SortScratch } from './pack';
import { subsetSplats } from './subset';

export type SplatRequest =
  | { op: 'load'; id: number; key: string; bytes: ArrayBuffer; name: string; max: number; sh: number }
  | { op: 'pack'; id: number; key: string; max: number; sh: number }
  | { op: 'sort'; id: number; key: string; axis: [number, number, number] }
  | { op: 'drop'; id: number; key: string };

export const THUMB_W = 160, THUMB_H = 90;

interface Kept { full: SplatData; used: SplatData; scratch?: SortScratch }
const kept = new Map<string, Kept>();

type Post = (msg: unknown, transfer?: Transferable[]) => void;

/** The worker's work, without the worker (the tests call it directly). */
export function handleSplatRequest(m: SplatRequest, post: Post): void {
  try {
    if (m.op === 'load') {
      const t0 = performance.now();
      const full = parseSplatFile(new Uint8Array(m.bytes), m.name);
      const parseMs = performance.now() - t0;
      const used = subsetSplats(full, m.max);
      const packed = packSplats(used, used.count, m.sh);
      kept.set(m.key, { full, used });
      const info = splatInfo(full);
      const thumb = thumbnailPixels(full, THUMB_W, THUMB_H, info);
      const transfer: Transferable[] = [packed.data.buffer, thumb.buffer];
      if (packed.sh) transfer.push(packed.sh.buffer);
      post({ id: m.id, ok: true, info, packed, thumb, parseMs }, transfer);
    } else if (m.op === 'pack') {
      const k = kept.get(m.key);
      if (!k) { post({ id: m.id, ok: false, error: 'gone' }); return; }
      k.used = subsetSplats(k.full, m.max);
      k.scratch = undefined;
      const packed = packSplats(k.used, k.used.count, m.sh);
      const transfer: Transferable[] = [packed.data.buffer];
      if (packed.sh) transfer.push(packed.sh.buffer);
      post({ id: m.id, ok: true, packed }, transfer);
    } else if (m.op === 'sort') {
      const k = kept.get(m.key);
      if (!k) { post({ id: m.id, ok: false, error: 'gone' }); return; }
      const t0 = performance.now();
      k.scratch = sortScratch(k.used.count, k.scratch);
      const order = sortSplats(k.used.positions, k.used.count, m.axis, k.scratch).slice();
      post({ id: m.id, ok: true, order, ms: performance.now() - t0 }, [order.buffer]);
    } else if (m.op === 'drop') {
      kept.delete(m.key);
      post({ id: m.id, ok: true });
    }
  } catch (e) {
    post({ id: m.id, ok: false, error: e instanceof SplatFormatError ? e.message : `The scan couldn’t be read: ${e instanceof Error ? e.message : String(e)}` });
  }
}
