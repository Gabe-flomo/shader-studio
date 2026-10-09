/**
 * The bundled examples' prebuilt move catalogue (src/exprBuilder/prebuilt/moves.json).
 *
 * Rebuild it after changing examples or the mining rules:
 *   EXPR_BUILDER_WRITE=1 npx vitest run src/exprBuilder/__tests__/prebuilt.test.ts
 *
 * Unlike the Code explorer's index (which the app tops up on device), the app doesn't re-mine the
 * examples, so this fails whenever the file is out of date: its hash (the examples' code and
 * graphs, and MOVES_SCHEMA) or its content (the mining rules) differs from a fresh build.
 */
import { describe, expect, it } from 'vitest';
import raw from '../prebuilt/moves.json?raw';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { getNodeDefinition } from '../../nodes/definitions';
import { buildPrebuilt, catalogueHash, exampleMoveDocs } from '../exampleMoves';
import { MOVES_SCHEMA } from '../moves';
import type { PackedCatalogue } from '../pack';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const nodeLabel = (t: string) => getNodeDefinition(t)?.label;
const HOW = 'stale: re-run with EXPR_BUILDER_WRITE=1 npx vitest run src/exprBuilder/__tests__/prebuilt.test.ts';

describe('prebuilt move catalogue', () => {
  it('is current: same schema, hash and content as a fresh build', async () => {
    let p = JSON.parse(raw) as PackedCatalogue;
    const fresh = buildPrebuilt(EXAMPLE_GRAPHS as never, nodeLabel);
    if (env.EXPR_BUILDER_WRITE) {
      p = fresh;
      // Node's fs, named indirectly: the app's TypeScript has no Node types.
      const fsName = 'node:fs';
      const fs = await import(/* @vite-ignore */ fsName) as { writeFileSync(path: URL, text: string): void };
      fs.writeFileSync(new URL('../prebuilt/moves.json', import.meta.url), JSON.stringify(p));
    }
    expect(p.schema, HOW).toBe(MOVES_SCHEMA);
    expect(p.hash, HOW).toBe(catalogueHash(exampleMoveDocs(EXAMPLE_GRAPHS as never, nodeLabel)));
    expect(p.moves.length, HOW).toBe(fresh.moves.length);
    expect(JSON.stringify(p) === JSON.stringify(fresh), HOW).toBe(true);
  }, 120000);

  it('stays reasonably small', () => {
    expect(raw.length).toBeLessThan(900 * 1024);
  });
});
