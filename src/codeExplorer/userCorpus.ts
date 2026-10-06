/**
 * userCorpus.ts — the user's own written code, read from the app's stored
 * keys (a KV: localStorage in the app, a map in tests) and the open graph.
 *
 *   saved:<name>          saved graphs
 *   open:                 the graph open in the Studio (as edited, saved or not)
 *   preset:<key>          Custom Function, Expression and group presets
 *   shader:<id>           GLSL page shaders
 *   builder:<id>          Function Builder functions
 *   convert:current       the shader on the Convert page
 *   present:<name>        GLSL typed into presentations' code blocks
 *
 * Re-reading is cheap: a key whose text hasn't changed reuses its docs.
 */
import type { KV } from '../utils/library';
import { PRESENTATION_KEY_PREFIX } from '../utils/library';
import { BUILDER_FNS_KEY, GLSL_KEY, isGraphEntry } from '../files/inventory';
import { CONVERT_EXAMPLES } from '../glslToGraph/examples';
import { builderFnDoc, customFnPresetDoc, exprPresetDoc, fileDoc, graphDoc, presentationDoc, type GraphSourceOptions } from './corpus';
import type { DocInput } from './types';

export const USER_PREFIXES = ['saved:', 'open:', 'preset:', 'shader:', 'builder:', 'convert:', 'present:'];
export const OPEN_DOC_ID = 'open:';
export const CONVERT_CODE_KEY = 'shader-studio:convert:code';

const PRESET_CFP = 'shader-studio:cfp:';
const PRESET_EP = 'shader-studio:ep:';
const PRESET_GP = 'shader-studio:gp:';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const parse = (raw: string | null): unknown => { if (raw == null) return undefined; try { return JSON.parse(raw); } catch { return undefined; } };

/** Per key: the raw text last read and the docs made from it. */
const cache = new Map<string, { raw: string; docs: DocInput[] }>();

function fromKey(kv: KV, key: string, make: (value: unknown) => DocInput[]): DocInput[] {
  const raw = kv.get(key);
  if (raw == null) { cache.delete(key); return []; }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.docs;
  const docs = make(parse(raw));
  cache.set(key, { raw, docs });
  return docs;
}

export interface OpenGraph { nodes: unknown; label: string }

export function collectUserDocs(kv: KV, open: OpenGraph | null, opts: GraphSourceOptions = {}): DocInput[] {
  const out: DocInput[] = [];
  const push = (d: DocInput | null) => { if (d) out.push(d); };
  for (const key of kv.keys()) {
    if (key.startsWith(PRESET_CFP)) out.push(...fromKey(kv, key, v => { const d = customFnPresetDoc(`preset:${key}`, v); return d ? [d] : []; }));
    else if (key.startsWith(PRESET_EP)) out.push(...fromKey(kv, key, v => { const d = exprPresetDoc(`preset:${key}`, v); return d ? [d] : []; }));
    else if (key.startsWith(PRESET_GP)) out.push(...fromKey(kv, key, v => {
      const p = obj(v);
      const d = graphDoc(`preset:${key}`, 'saved', String(p?.label ?? 'Group preset'), 'Presets', obj(p?.subgraph)?.nodes, { ...opts, kindFor: () => 'preset' });
      return d ? [d] : [];
    }));
    else if (key.startsWith(PRESENTATION_KEY_PREFIX)) out.push(...fromKey(kv, key, v => { const name = key.slice(PRESENTATION_KEY_PREFIX.length); const d = presentationDoc(`present:${name}`, name, v); return d ? [d] : []; }));
    else if (key === GLSL_KEY) out.push(...fromKey(kv, key, v => (Array.isArray(v) ? v : []).map(obj).filter((s): s is Obj => !!s && typeof s.code === 'string')
      .map(s => fileDoc(`shader:${String(s.id ?? s.name)}`, 'saved', String(s.name ?? 'Shader'), 'Shaders', 'shader', s.code as string, typeof s.note === 'string' ? s.note : undefined))
      .filter((d): d is DocInput => !!d)));
    else if (key === BUILDER_FNS_KEY) out.push(...fromKey(kv, key, v => (Array.isArray(v) ? v : []).map((f, i) => builderFnDoc(`builder:${String(obj(f)?.id ?? i)}`, f)).filter((d): d is DocInput => !!d)));
    else if (key === CONVERT_CODE_KEY) out.push(...fromKey(kv, key, () => {
      const code = kv.get(key) ?? '';
      // The page starts on one of its examples: those are indexed as examples already.
      if (Object.values(CONVERT_EXAMPLES).some(e => e.code === code)) return [];
      const d = fileDoc('convert:current', 'saved', 'Convert page', 'Convert', 'import', code);
      return d ? [d] : [];
    }));
    else if (key.startsWith('shader-studio:')) out.push(...fromKey(kv, key, v => {
      if (!isGraphEntry(key, v)) return [];
      const name = key.slice('shader-studio:'.length);
      const d = graphDoc(`saved:${name}`, 'saved', name, 'Saved graphs', obj(v)?.nodes, opts);
      return d ? [d] : [];
    }));
  }
  if (open) push(graphDoc(OPEN_DOC_ID, 'open', open.label, 'Open graph', open.nodes, opts));
  return out;
}
