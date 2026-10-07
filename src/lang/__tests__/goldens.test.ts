/**
 * Phase 0 of the language plan (docs/playfield-language-plan.md §11.0): every Do… bar phrase and
 * sentence (corpus.ts) still does exactly what it did when the goldens were recorded.
 *
 * WRITE_GOLDENS=1 npx vitest run src/lang/__tests__/goldens.test.ts rewrites goldens/do-bar.json;
 * only do that for a change that is meant to change what a sentence does, and say which in the
 * commit.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { LANGUAGE_CORPUS } from './corpus';
import { goldenOf, runSentence, type Golden } from './goldens';
import recorded from './goldens/do-bar.json';

const key = (text: string, source: string, selected: string[]) => `${source}${selected.length ? ` [${selected.join(',')}]` : ''} · ${text}`;
const write = !!(import.meta.env as Record<string, unknown>).WRITE_GOLDENS;

describe('language goldens: the Do… bar corpus', () => {
  it('has the whole corpus (300+ sentences)', () => {
    expect(LANGUAGE_CORPUS.length).toBeGreaterThanOrEqual(300);
  });

  it('writes the goldens when asked', async () => {
    if (!write) return;
    const out: Record<string, Golden> = {};
    for (const e of LANGUAGE_CORPUS) {
      const g = e.graph();
      out[key(e.text, e.source, e.selected)] = goldenOf(runSentence(e.text, g, e.selected), g);
    }
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: URL, s: string) => void };
    fs.writeFileSync(new URL('./goldens/do-bar.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
  });

  it('every sentence does what it did', () => {
    if (write) return;
    const golden = recorded as Record<string, Golden>;
    const missing: string[] = [];
    const changed: string[] = [];
    for (const e of LANGUAGE_CORPUS) {
      const k = key(e.text, e.source, e.selected);
      const want = golden[k];
      if (!want) { missing.push(k); continue; }
      const g = e.graph();
      const got = goldenOf(runSentence(e.text, g, e.selected), g);
      if (JSON.stringify(got) !== JSON.stringify(want)) changed.push(`${k}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
    }
    expect(missing, 'not recorded: WRITE_GOLDENS=1').toEqual([]);
    expect(changed).toEqual([]);
  });
});
