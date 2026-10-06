/**
 * The bundled examples' prebuilt index (src/codeExplorer/prebuilt/examples.json).
 *
 * Rebuild it after changing examples or the shaping rules:
 *   CODE_EXPLORER_WRITE=1 npx vitest run src/codeExplorer/__tests__/prebuilt.test.ts
 *
 * The app re-indexes, on device, any example that changed since it was built,
 * so a stale file is slower to open, never wrong; this test only fails when
 * the file is unreadable, of an old schema, or mostly stale.
 */
import { describe, expect, it } from 'vitest';
import raw from '../prebuilt/examples.json?raw';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { getNodeDefinition } from '../../nodes/definitions';
import { bundledExampleDocs } from '../exampleCorpus';
import { docVersion, extractDoc, hashText } from '../extract';
import { INDEX_SCHEMA } from '../types';
import type { PrebuiltIndex } from '../host';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

function buildPrebuilt(): PrebuiltIndex {
  const docs = bundledExampleDocs(EXAMPLE_GRAPHS as never, t => getNodeDefinition(t)?.label).map(d => extractDoc(d, 0));
  return { schema: INDEX_SCHEMA, hash: hashText(JSON.stringify(docs.map(d => [d.docId, d.version]))), builtAt: 0, docs };
}

describe('prebuilt examples index', () => {
  it('is readable, current schema, and mostly fresh', async () => {
    let p = JSON.parse(raw) as PrebuiltIndex;
    if (env.CODE_EXPLORER_WRITE) {
      p = buildPrebuilt();
      // Node's fs, named indirectly: the app's TypeScript has no Node types.
      const fsName = 'node:fs';
      const fs = await import(/* @vite-ignore */ fsName) as { writeFileSync(path: URL, text: string): void };
      fs.writeFileSync(new URL('../prebuilt/examples.json', import.meta.url), JSON.stringify(p));
    }
    expect(p.schema).toBe(INDEX_SCHEMA);
    const fresh = new Map(bundledExampleDocs(EXAMPLE_GRAPHS as never, t => getNodeDefinition(t)?.label).map(d => [d.docId, docVersion(d)]));
    const stale = p.docs.filter(d => fresh.get(d.docId) !== d.version).length + [...fresh.keys()].filter(id => !p.docs.some(d => d.docId === id)).length;
    if (stale) console.warn(`[code explorer] prebuilt index: ${stale} of ${fresh.size} example docs changed since it was built (re-run with CODE_EXPLORER_WRITE=1).`);
    expect(stale / Math.max(1, fresh.size)).toBeLessThan(0.25);
  });
});
