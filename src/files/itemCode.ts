/**
 * itemCode.ts — what an item page shows of a saved thing: the stored record
 * behind a Files node (a key's JSON, or one element of a list key), its code
 * in the right language (a shader's GLSL, a sketch's JavaScript, a graph's
 * readable JSON), a function's snippet for the live preview, and which kinds
 * get an item page at all.
 */
import { parseJson, type FileNode } from './inventory';
import { localMutableKV } from './mutate';
import { graphFileText } from '../playfile/bundle';
import { presetFunctionCode } from '../present/codePick';
import type { CustomFnPreset } from '../types/customFnPreset';

/** Kinds that get an item page (the rest keep the plain list view). */
export const ITEM_KINDS: ReadonlySet<string> = new Set(['graph', 'presentation', 'shader', 'function', 'builderFn', 'preset', 'node', 'script', 'palette']);

/** A graph node whose detail ends in "Play" has a Play setup: it opens in Play. */
export const isPlayGraph = (n: FileNode) => n.kind === 'graph' && /\bPlay$/.test(n.detail ?? '');

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export interface ItemRecord { raw: string | null; value: unknown }

/** The stored record behind an item: a key's JSON, or the element of a list key. */
export function itemRecord(n: FileNode, kv = localMutableKV): ItemRecord {
  const ref = n.ref;
  if (!ref) return { raw: null, value: undefined };
  if (ref.t === 'key') { const raw = kv.get(ref.key); return { raw, value: parseJson(raw) }; }
  if (ref.t === 'part') {
    let v: unknown = parseJson(kv.get(ref.key));
    for (const p of ref.path) v = (v as Record<string | number, unknown> | undefined)?.[p];
    if (ref.match) v = (Array.isArray(v) ? v : []).find(x => obj(x)?.[ref.match!.field] === ref.match!.value);
    return { raw: v === undefined ? null : JSON.stringify(v), value: v };
  }
  return { raw: null, value: undefined };
}

/** What to show as the item's code, and in which language. */
export function itemCode(n: FileNode, rec: ItemRecord): { text: string; language: 'glsl' | 'json' | 'js' } | null {
  const v = obj(rec.value);
  if (n.kind === 'graph') return rec.raw ? { text: graphFileText(rec.raw, isPlayGraph(n)), language: 'json' } : null;
  if (n.kind === 'shader' || n.kind === 'script') { const c = str(v?.code); return c ? { text: c, language: n.kind === 'script' ? 'js' : 'glsl' } : null; }
  if (n.kind === 'function') { const body = str(v?.body) ?? ''; const fns = str(v?.glslFunctions)?.trim(); return { text: [fns, body].filter(Boolean).join('\n\n'), language: 'glsl' }; }
  if (n.kind === 'builderFn') { const body = str(v?.body); return body ? { text: body, language: 'glsl' } : null; }
  return rec.raw ? { text: JSON.stringify(rec.value, null, 1), language: 'json' } : null;
}

/** A function's snippet for the live preview: a preset as its own GLSL function, a Builder function wrapped. */
export function functionSnippet(n: FileNode, value: unknown): string | null {
  const v = obj(value);
  if (!v) return null;
  if (n.kind === 'function' && typeof v.body === 'string') {
    const preset: CustomFnPreset = { id: str(v.id) ?? '', label: str(v.label) ?? n.label, inputs: (Array.isArray(v.inputs) ? v.inputs : []) as CustomFnPreset['inputs'], outputType: (str(v.outputType) ?? 'float') as CustomFnPreset['outputType'], body: v.body, glslFunctions: str(v.glslFunctions) ?? '', savedAt: 0 };
    return presetFunctionCode(preset).code;
  }
  if (n.kind === 'builderFn' && typeof v.body === 'string' && typeof v.name === 'string') {
    const rt = str(v.returnType) ?? 'float';
    const name = v.name.replace(/[^A-Za-z0-9_]/g, '_');
    return rt === 'float'
      ? `${rt} ${name}(float x, float t) {\n  vec2 uv = vec2(x, 0.0);\n  return ${v.body};\n}`
      : `${rt} ${name}(vec2 uv, float t) {\n  float x = uv.x;\n  return ${v.body};\n}`;
  }
  return null;
}
