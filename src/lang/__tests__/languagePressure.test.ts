/**
 * The language pressure test (docs/reports/language-pressure-test.md): every example graph printed
 * as Do… bar lines (lang/fromGraph.ts), run through the real bar on an empty graph, and compared
 * with the example (structure and compiled shader).
 *
 * It records coverage and doesn't fail on gaps: it fails only when the printer throws.
 *
 *   npm run report:language    also writes the raw results (JSON) and the report's tables
 *                              (Markdown) to $REPORT_DIR (default: /tmp/lang-pressure)
 *   PRESSURE_KEYS=a,b …        only those examples
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { pressureTest, type ExampleResult } from './pressure/harness';
import { summarise, tablesMarkdown } from './pressure/summary';

const env = import.meta.env as Record<string, string | undefined>;
const categoryOf = (key: string) => EXAMPLE_FOLDERS.find(f => f.keys.includes(key))?.label ?? 'Unfiled';

describe('language pressure test', () => {
  it('prints every example as Do… bar lines without throwing, and records what rebuilds', async () => {
    const only = env.PRESSURE_KEYS?.split(',').filter(Boolean);
    const keys = (only?.length ? only : Object.keys(EXAMPLE_GRAPHS)).filter((k: string) => EXAMPLE_GRAPHS[k]);
    const results: ExampleResult[] = [];
    for (const key of keys) {
      const g = EXAMPLE_GRAPHS[key];
      results.push(pressureTest(key, g.label, categoryOf(key), g));
    }
    const s = summarise(results);
    if (env.WRITE_REPORT) {
      const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: string | URL, s: string) => void; mkdirSync: (f: string | URL, o: { recursive: boolean }) => void };
      const dir = env.REPORT_DIR ? `${env.REPORT_DIR.replace(/\/$/, '')}/` : '/tmp/lang-pressure/';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}language-pressure-test.json`, JSON.stringify({ generated: new Date().toISOString(), summary: s, results }, null, 1));
      fs.writeFileSync(`${dir}tables.md`, tablesMarkdown(results, s));
    }
    // Coverage is recorded, not asserted; the printer must never throw.
    expect(results.filter(r => r.printerThrew).map(r => `${r.key}: ${r.printerThrew!.split('\n')[0]}`)).toEqual([]);
    expect(results.length).toBe(keys.length);
    expect(s.byClass.Full + s.byClass.Near + s.byClass.Partial + s.byClass.None).toBe(keys.length);
  }, 600_000);
});
