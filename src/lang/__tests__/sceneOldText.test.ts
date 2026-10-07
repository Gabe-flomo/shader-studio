/**
 * Old recipe text keeps working (docs/playfield-language-plan.md §9.2, §11.1 test 5): every
 * recipe the Scene Builder's printer wrote before the shared language (each template, one-line,
 * multi-line and pretty), every template's own text and every recipe string in the tests and
 * help cards parses to the spec it parsed to then.
 *
 * WRITE_GOLDENS=1 records goldens/scene-old-text.json (it was recorded with the printer as it was
 * before phase 2; don't re-record it with a newer printer).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import { SCENE_TEMPLATES, templateSpec } from '../../sceneBuilder/templates';
import strings from './goldens/recipe-strings.json';
import recorded from './goldens/scene-old-text.json';

const write = !!(import.meta.env as Record<string, unknown>).WRITE_GOLDENS;
const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 10000) / 10000 : x)));

describe('old recipe text', () => {
  it('records the texts and specs when asked', async () => {
    if (!write) return;
    const texts = new Set<string>(strings as string[]);
    for (const t of SCENE_TEMPLATES) {
      texts.add(t.recipe);
      const spec = templateSpec(t.key);
      for (const opts of [{}, { multiline: true }, { pretty: true }]) texts.add(printRecipe(spec, opts));
    }
    const out: Record<string, unknown> = {};
    for (const t of texts) {
      const r = parseRecipe(t);
      out[t] = { spec: norm(r.spec), errors: r.errors.length };
    }
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: URL, s: string) => void };
    fs.writeFileSync(new URL('./goldens/scene-old-text.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
  });

  it('every old text parses to the spec it parsed to before', () => {
    if (write) return;
    const golden = recorded as Record<string, { spec: unknown; errors: number }>;
    expect(Object.keys(golden).length).toBeGreaterThan(50);
    for (const [text, want] of Object.entries(golden)) {
      const r = parseRecipe(text);
      expect(r.errors.length, `${text}: ${r.errors.map(e => e.message).join(' / ')}`).toBe(want.errors);
      expect(norm(r.spec), text).toEqual(want.spec);
    }
  });
});
