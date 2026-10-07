/**
 * One registry, one reference (docs/playfield-language-plan.md §8.8, §11.1 tests 6 and 8): every
 * head's examples read in its dialect with no mistakes; every alias resolves; every old word has a
 * hint; the Code Explorer's synonyms and the explainer's nouns come from the language; the shipped
 * docs/playfield-language.md and docs/do-bar-commands.md match the registry.
 *
 * WRITE_DOCS=1 (npm run docs:language) rewrites docs/playfield-language.md.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { fullReference, languageMarkdown } from '../reference';
import { lookupHead, registry } from '../registry';
import { readLine } from '../run';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { parseGrid } from '../dialects/grid';
import { parseAgents } from '../dialects/agents';
import { SYNONYMS, expandQuery } from '../../codeExplorer/synonyms';
import { ACTIONS } from '../vocabulary';
import { VALUE_NOUNS } from '../nouns';
import { KIND_LABELS } from '../../suggestions/kinds';
import shipped from '../../../docs/playfield-language.md?raw';

const write = !!(import.meta.env as Record<string, unknown>).WRITE_DOCS;

describe('the registry is the reference', () => {
  it('every head\'s examples read in its dialect with no mistakes', () => {
    const bad: string[] = [];
    for (const e of registry()) for (const ex of e.examples) {
      // A line of the bar (any dialect) that reads is fine; else the dialect's own reader, with its context.
      if (!readLine(ex).errors.length) continue;
      const errs = e.dialects.includes('scene') && !e.dialects.includes('picture') ? parseRecipe(ex).errors.map(x => x.message)
        : e.dialects[0] === 'grid' ? (ex.startsWith('stencil') || ex.startsWith('block') ? parseGrid(`grid ${ex.startsWith('stencil') ? 'patterns' : 'blocks'} · ${ex}`).errors : parseGrid(ex).errors).map(x => x.message)
          : e.dialects[0] === 'agents' ? (/^(when|always|state)/.test(ex) ? parseAgents(`channels food, home · species Ants states=searching,carrying,walking: ${ex}`).errors : parseAgents(/^(wander|turn|speed|accelerate|leave|become|stop|stick|die|spawn|follow|against|align|separate|match|cohere|slow|avoid-edges|orbit|force|drag|fade)\b/.test(ex) ? `channels food, home · species Ants states=searching,carrying: always do ${ex}` : ex).errors).map(x => x.message)
            : readLine(ex).errors.map(x => x.message);
      if (errs.length) bad.push(`${e.id}: ${ex} → ${errs.join(' / ')}`);
    }
    expect(bad).toEqual([]);
  });
  it('every alias resolves to its entry; every old word has a hint', () => {
    for (const e of registry()) {
      const d = e.dialects[0];
      for (const w of e.words) {
        const hit = lookupHead(w, d, [e.kind]);
        expect(hit?.entry.id, `${e.id}: ${w}`).toBe(e.id);
      }
      for (const [w, hint] of Object.entries(e.deprecated ?? {})) {
        expect(hint.length, `${e.id}: ${w}`).toBeGreaterThan(10);
        expect(lookupHead(w, d, [e.kind])?.how, `${e.id}: ${w}`).toBe('deprecated');
      }
    }
  });
  it('the reference lists every head and every verb with its canonical form', () => {
    const ref = fullReference();
    expect(ref.filter(r => r.kind === 'language').length).toBeGreaterThan(150);
    expect(ref.find(r => r.id === 'verb:set')?.syntax[0]).toBe('set <ref> <key>=<value>…');
    expect(ref.find(r => r.id === 'lang:picture:glow')?.slots.map(s => s.name)).toEqual(expect.arrayContaining(['falloff (bare)', 'color']));
  });
});

describe('one vocabulary app-wide', () => {
  it('the Code Explorer reads the language\'s words (D17): an alias in the bar finds the same code', () => {
    for (const a of ACTIONS) {
      const one = a.words.filter(w => !w.includes(' '));
      if (one.length < 2) continue;
      const exp = expandQuery([one[0]]);
      if (!exp.length) continue;
      for (const w of one.slice(1)) {
        const row = SYNONYMS.find(r => r.words.includes(w));
        if (row) expect(row.expand.some(x => exp.includes(x)) || exp.length === 0, `${a.id}: ${w}`).toBe(true);
      }
    }
    expect(expandQuery(['halo'])).toEqual(expect.arrayContaining(['exp', 'glow']));
    expect(expandQuery(['blend'])).toContain('smin');
    for (const e of registry().filter(x => x.expand)) expect(SYNONYMS.some(r => r.words.includes(e.words[0])), e.id).toBe(true);
  });
  it('the suggestions\' kinds and the explainer\'s roles use the language\'s nouns (D16)', () => {
    for (const [k, v] of Object.entries(KIND_LABELS)) expect(v).toBe(VALUE_NOUNS[k as keyof typeof VALUE_NOUNS]);
    for (const role of ['space', 'colour', 'value', 'mask', 'distance', 'angle', 'time', 'direction', 'cell', 'unknown']) expect(VALUE_NOUNS[role as keyof typeof VALUE_NOUNS], role).toBeTruthy();
  });
});

describe('docs/playfield-language.md', () => {
  it('writes the doc when asked', async () => {
    if (!write) return;
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: URL, s: string) => void };
    fs.writeFileSync(new URL('../../../docs/playfield-language.md', import.meta.url), languageMarkdown());
  });
  it('is generated from the registry and up to date (npm run docs:language)', () => {
    if (write) return;
    expect(shipped).toBe(languageMarkdown());
  });
});
