/**
 * duplicate.ts — a copy of a saved thing beside it, named "… copy" (then
 * "… copy 2"): a whole key (a graph, a preset, a published node) gets a new
 * key; an element of a list key (a shader, a sketch, a palette) is pushed
 * onto its list with a new id. Pure over a MutableKV; returns Undo.
 */
import { GRAPH_PREFIX, NODE_PREFIX, parseJson, VERSIONS_PREFIX, type FileNode } from './inventory';
import type { MutableKV } from './mutate';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);

/** "Sunset copy", or "Sunset copy 2" when that's taken. */
export function copyName(name: string, taken: (n: string) => boolean): string {
  const base = name.replace(/ copy( \d+)?$/, '');
  let candidate = `${base} copy`;
  for (let i = 2; taken(candidate); i++) candidate = `${base} copy ${i}`;
  return candidate;
}

export interface DuplicateResult { /** The copy's name (its label in Files). */ label: string; undo: () => void }

export function duplicateNode(kv: MutableKV, n: FileNode, now = Date.now()): DuplicateResult | null {
  const ref = n.ref;
  if (!ref || n.part) return null;
  if (ref.t === 'key') {
    const raw = kv.get(ref.key);
    if (raw == null) return null;
    if (ref.key.startsWith(GRAPH_PREFIX) && n.kind === 'graph') {
      // A graph: its key is its name; the copy starts a history of its own.
      const label = copyName(n.label, x => kv.get(GRAPH_PREFIX + x) != null);
      const key = GRAPH_PREFIX + label;
      const g = obj(parseJson(raw));
      kv.set(key, g ? JSON.stringify({ ...g, savedAt: now, version: 1 }) : raw);
      return { label, undo: () => { kv.remove(key); kv.remove(VERSIONS_PREFIX + label); } };
    }
    // A preset or a published node: `<prefix><id>`, its label inside.
    const p = obj(parseJson(raw));
    if (!p) return null;
    const prefix = ref.key.startsWith(NODE_PREFIX) ? NODE_PREFIX : ref.key.slice(0, ref.key.lastIndexOf(':') + 1);
    const oldId = ref.key.slice(prefix.length);
    const id = `${oldId.replace(/_copy_\d+$/, '')}_copy_${now}`;
    const key = prefix + id;
    const label = copyName(n.label, x => kv.keys().some(k => k.startsWith(prefix) && obj(parseJson(kv.get(k)))?.label === x));
    kv.set(key, JSON.stringify({ ...p, id, label, ...(typeof p.type === 'string' ? { type: id } : {}), savedAt: now }));
    return { label, undo: () => kv.remove(key) };
  }
  if (ref.t === 'part' && ref.match && ref.path.length === 0) {
    const raw = kv.get(ref.key);
    const list = parseJson(raw);
    if (!Array.isArray(list)) return null;
    const i = list.findIndex(x => obj(x)?.[ref.match!.field] === ref.match!.value);
    const item = obj(list[i]);
    if (!item) return null;
    const nameField = typeof item.name === 'string' ? 'name' : 'label';
    const label = copyName(n.label, x => list.some(y => obj(y)?.[nameField] === x));
    const copy: Obj = { ...item, [nameField]: label, ...(typeof item.id === 'string' ? { id: `${item.id.replace(/_copy_\d+$/, '')}_copy_${now}` } : {}), ...(typeof item.savedAt === 'number' ? { savedAt: now } : {}) };
    kv.set(ref.key, JSON.stringify([...list.slice(0, i + 1), copy, ...list.slice(i + 1)]));
    return { label, undo: () => { if (raw != null) kv.set(ref.key, raw); } };
  }
  return null;
}
