/**
 * The bundled-examples prior (prior.ts): built from the examples, shipped as examplePrior.json.
 * WRITE_PRIOR=1 rewrites the JSON from the current examples; otherwise this checks the shipped
 * table still has the corpus's strongest patterns and still agrees with the builder's rules.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { buildPrior } from '../prior';
import shipped from '../examplePrior.json';

describe('example prior', () => {
  const built = buildPrior(Object.values(EXAMPLE_GRAPHS));

  const write = !!(import.meta.env as Record<string, unknown>).WRITE_PRIOR;

  it('writes the table when asked', async () => {
    if (!write) return;
    // Node's fs, named at run time: the app's types don't include Node.
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: URL, s: string) => void };
    fs.writeFileSync(new URL('../examplePrior.json', import.meta.url), JSON.stringify(built) + '\n');
  });

  it('has the corpus\'s strong patterns', () => {
    const table = write ? built : shipped as typeof built;
    expect(table.examples).toBeGreaterThan(100);
    expect(table.pairs['circleSDF.distance>light.distance']).toBeGreaterThan(1);
    expect(table.pairs['fbm.value>palette.value']).toBeGreaterThan(1);
  });

  it('down-weights identical templates: an example is worth 1 shared among its copies', () => {
    const tpl = { nodes: [
      { id: 'u', type: 'uv', inputs: {} },
      { id: 'c', type: 'circleSDF', inputs: { position: { connection: { nodeId: 'u', outputKey: 'uv' } } } },
      { id: 'g', type: 'light', inputs: { distance: { connection: { nodeId: 'c', outputKey: 'distance' } } } },
    ] };
    const other = { nodes: [
      { id: 'u', type: 'uv', inputs: {} },
      { id: 'f', type: 'fbm', inputs: { uv: { connection: { nodeId: 'u', outputKey: 'uv' } } } },
    ] };
    const t = buildPrior([tpl, tpl, tpl, tpl, other]);
    expect(t.pairs['circleSDF.distance>light.distance']).toBe(1);
    expect(t.pairs['uv.uv>fbm.uv']).toBe(1);
  });
});
