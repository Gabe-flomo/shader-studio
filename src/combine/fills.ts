/**
 * fills.ts — Replace mask's per-blob fills (docs/combine.md "Per blob", docs/combine-plan.md §2.7 / §3.4), as pure
 * edits of a fill layer's `fills`:
 *
 *  - One for all (no `fills`, or mode 'all'): the layer's product on every blob, as phase 1 built it.
 *  - Per blob: a short list of fills, each on one blob, and a fill for the rest (none: the picture shows there).
 *    **Attach by** says which blob a fill is on:
 *      Order: fill #1 on the first blob seen now (the oldest), #2 on the next… When a blob goes, the ones after it
 *        move up, so a fill passes to the next blob (steady for a clip where blobs come and go).
 *      ID: each fill is on a blob's tracked ID and stays on it until that blob is lost; a new blob gets the rest.
 *    The first blobs a fresh track finds get IDs 1, 2, 3…, so switching Order ↔ ID keeps fill #1 on the same blob
 *    (key 0 ↔ ID 1).
 *
 * Each entry has a stable `id` ('F1', 'F2'…): its glue's roles start with it, so changing its blob or its product
 * keeps the node ids (wires and Play controls stay).
 */
import type { CombineLayer, FillEntry, FillSpec, ProductRef } from './spec';

/** The most fills offered on one layer (Blob Track follows up to 16 blobs; more fills than that would never show). */
export const MAX_FILLS = 8;

export const isPerBlob = (layer: Pick<CombineLayer, 'fills'>): boolean => layer.fills?.mode === 'perBlob';

/** An entry's stable id (older specs without one: by its key). */
export const fillIdOf = (e: FillEntry, i: number): string => e.id ?? `K${e.key}_${i}`;

/** "#1" (by order: key 0 is the first blob) or "ID 3". */
export const fillName = (by: FillSpec['by'], key: number): string => (by === 'id' ? `ID ${key}` : `#${key + 1}`);

/** The next free entry id. */
function nextFillId(blobs: readonly FillEntry[]): string {
  const used = new Set(blobs.map(b => b.id));
  for (let i = 1; ; i++) if (!used.has(`F${i}`)) return `F${i}`;
}

/** The next blob no fill is on yet: by order the first free slot from 0, by ID the first free ID from 1. */
export function nextFillKey(f: Pick<FillSpec, 'by' | 'blobs'>): number {
  const used = new Set(f.blobs.map(b => b.key));
  for (let k = f.by === 'id' ? 1 : 0; ; k++) if (!used.has(k)) return k;
}

/**
 * Per blob from One for all: the layer's own product goes on the first blob (#1, or ID 1), the rest shows the
 * picture. Back to One for all keeps the list (switching again finds it as it was).
 */
export function toPerBlob(layer: CombineLayer): FillSpec {
  const old = layer.fills;
  if (old && old.blobs.length) return { ...old, mode: 'perBlob' };
  const by = old?.by ?? 'order';
  return { mode: 'perBlob', by, ...(old?.rest ? { rest: old.rest } : {}), blobs: [{ id: 'F1', key: by === 'id' ? 1 : 0, fill: layer.product }] };
}

export const toOneForAll = (layer: CombineLayer): FillSpec | undefined => (layer.fills ? { ...layer.fills, mode: 'all' } : undefined);

/** Attach by Order ↔ ID: each fill stays on the blob it names now (slot k ↔ ID k + 1, as a fresh track numbers them). */
export function setAttachBy(f: FillSpec, by: FillSpec['by']): FillSpec {
  if (f.by === by) return f;
  const shift = by === 'id' ? 1 : -1;
  return { ...f, by, blobs: f.blobs.map(b => ({ ...b, key: Math.max(by === 'id' ? 1 : 0, b.key + shift) })) };
}

/** Add a fill on the next free blob (null when the list is full). */
export function addFill(f: FillSpec, fill: ProductRef): FillSpec | null {
  if (f.blobs.length >= MAX_FILLS) return null;
  return { ...f, blobs: [...f.blobs, { id: nextFillId(f.blobs), key: nextFillKey(f), fill }] };
}

/** Put a fill on blob `key`: a fill already on that blob swaps to this one's blob, so no two fills share a blob. */
export function setFillKey(f: FillSpec, id: string, key: number): FillSpec {
  const me = f.blobs.find(b => b.id === id);
  if (!me) return f;
  return { ...f, blobs: f.blobs.map(b => (b.id === id ? { ...b, key } : b.key === key ? { ...b, key: me.key } : b)) };
}

export function updateFill(f: FillSpec, id: string, patch: Partial<Omit<FillEntry, 'id'>>): FillSpec {
  return { ...f, blobs: f.blobs.map(b => (b.id === id ? { ...b, ...patch } : b)) };
}

export function removeFill(f: FillSpec, id: string): FillSpec {
  return { ...f, blobs: f.blobs.filter(b => b.id !== id) };
}

/** Older specs (phase 1's hook had no ids): every entry gets one, in order. */
export function withFillIds(f: FillSpec): FillSpec {
  if (f.blobs.every(b => b.id)) return f;
  const blobs: FillEntry[] = [];
  for (const b of f.blobs) blobs.push(b.id ? b : { ...b, id: nextFillId([...blobs, ...f.blobs.filter(x => x.id)]) });
  return { ...f, blobs };
}

/** The Fill fold's summary: "each blob · square" / "per blob by ID · 2 fills + rest". */
export function fillSummary(layer: CombineLayer, R: Record<string, unknown>): string {
  if (!isPerBlob(layer)) return `${R.stick === 'frame' ? 'whole mask' : 'each blob'} · ${String(R.fit)}`;
  const f = layer.fills!;
  return `per blob by ${f.by === 'id' ? 'ID' : 'order'} · ${f.blobs.length} fill${f.blobs.length === 1 ? '' : 's'}${f.rest ? ' + rest' : ''}`;
}

/** Every product a fill layer draws: its own (one for all) or its fills and rest (per blob). */
export function fillProducts(layer: CombineLayer): ProductRef[] {
  if (!isPerBlob(layer)) return [layer.product];
  const f = layer.fills!;
  return [...f.blobs.map(b => b.fill), ...(f.rest ? [f.rest] : [])];
}
