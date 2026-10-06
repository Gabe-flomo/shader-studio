/**
 * exampleCorpus.ts — the bundled examples as docs: the example graphs (by
 * Examples folder) and the Convert page's example shaders. Used by the
 * prebuilt index (built ahead) and by the app to catch examples that changed
 * since it was built.
 */
import { EXAMPLE_FOLDERS } from '../store/exampleIndex';
import { CONVERT_EXAMPLES } from '../glslToGraph/examples';
import { exampleDocs, fileDoc } from './corpus';
import type { DocInput } from './types';

/** Ids of bundled docs start with these: an examples sync replaces exactly them. */
export const EXAMPLE_PREFIXES = ['example:', 'example-convert:'];

export function bundledExampleDocs(graphs: Record<string, { label: string; nodes: unknown }>, nodeLabel?: (type: string) => string | undefined): DocInput[] {
  const folderOf = new Map<string, string>();
  for (const f of EXAMPLE_FOLDERS) for (const k of f.keys) if (!folderOf.has(k)) folderOf.set(k, f.label);
  const docs = exampleDocs(graphs, k => folderOf.get(k), { nodeLabel });
  for (const [key, c] of Object.entries(CONVERT_EXAMPLES)) {
    const d = fileDoc(`example-convert:${key}`, 'example', c.label, 'Convert', 'import', c.code);
    if (d) docs.push(d);
  }
  return docs;
}
