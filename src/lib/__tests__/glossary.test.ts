/**
 * The glossary lint (docs/glossary.md, lib/glossary.ts): the app's chrome uses one word per idea.
 * Reads the chrome's names from their data (shortcut labels, the Play rail) and from the source
 * of the bars, menus and toolbars that build them inline, and fails on any word the glossary
 * retired.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED, GLOSSARY, glossaryProblems } from '../glossary';
import { DEFAULT_ACTIONS } from '../../hooks/useShortcuts';
import { RAIL_CATEGORIES, RAIL_PAGES } from '../../components/play/railPages';

/** The files that draw the app's chrome: page tabs, top bars, the canvas toolbar, the Play panel's header and rail. */
const CHROME_FILES = [
  'src/components/shell/DesktopTopNav.tsx',
  'src/components/shell/MobileTopBar.tsx',
  'src/components/shell/CanvasToolbar.tsx',
  'src/components/play/PlaySplitArea.tsx',
  'src/components/play/PlayRail.tsx',
  'src/components/play/PlayPage.tsx',
  'src/components/play/playSetupMenu.tsx',
  'src/components/NodeGraph/NodePalette.tsx',
  'src/components/nodePacks/BuilderShell.tsx',
  'src/components/learn/StartSheet.tsx',
  'src/components/library/Library.tsx',
  'src/components/presets/PresetMenu.tsx',
  'src/components/play/TakesList.tsx',
  'src/components/play/TakesSection.tsx',
  'src/components/play/Stage.tsx',
  'src/components/ExportModal.tsx',
  'src/components/PerformanceBar.tsx',
  'src/components/play/mapPicker.ts',
];

const ATTR = /\b(label|title|hint|description|aria-label|ariaLabel|placeholder)\s*[:=]\s*\{?\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g;
const BUTTON_TEXT = />([^<>{}\n]*[A-Za-z][^<>{}\n]*)<\/(?:Button|ToolButton|button)>/g;

/** The user-facing strings in a chrome file's source: label/title/hint props and button text. */
function chromeStrings(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(ATTR)) out.push(m[3]);
  for (const m of source.matchAll(BUTTON_TEXT)) out.push(m[1]);
  return out.filter(s => /[A-Za-z]/.test(s));
}

describe('glossary', () => {
  it('lists each name once', () => {
    const names = GLOSSARY.map(t => t.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('catches the retired words', () => {
    expect(glossaryProblems('Node Builder')).toHaveLength(1);
    expect(glossaryProblems('Builder')).toHaveLength(1);
    expect(glossaryProblems('GLSL')).toHaveLength(1);
    expect(glossaryProblems('Go to Mappings')).toHaveLength(1);
    expect(glossaryProblems('Engine${n ? ` · ${n}` : \'\'}')).toHaveLength(1);
    expect(glossaryProblems('Hover for color')).toHaveLength(1);
    expect(glossaryProblems('Saved Graphs')).toHaveLength(1);
    // The three recordings have one name each (Play audit P8), and the MIDI file / pad grid are sources (P10).
    expect(glossaryProblems('Record a performance')).toHaveLength(1);
    expect(glossaryProblems('Start performance')).toHaveLength(1);
    expect(glossaryProblems('Open the MIDI file page')).toHaveLength(1);
    for (const ok of ['Record video', 'Record performance (take)', 'Arm track', 'Start the take', 'MIDI file…', 'Pad grid']) expect(glossaryProblems(ok), ok).toEqual([]);
    // …and leaves the right ones alone.
    for (const ok of ['Publish node', 'Functions', 'Import shader', 'Go to Controls', 'Sound · 2', 'Hover for colour', 'Add Color node', 'Scene builder', 'Inputs & media']) {
      expect(glossaryProblems(ok), ok).toEqual([]);
    }
  });

  it('shortcut labels and descriptions use the glossary’s words', () => {
    const problems = DEFAULT_ACTIONS.flatMap(a => [...glossaryProblems(a.label), ...glossaryProblems(a.description ?? '')].map(p => `${a.id}: ${p}`));
    expect(problems).toEqual([]);
  });

  it('no two shortcuts share a label', () => {
    const labels = DEFAULT_ACTIONS.map(a => a.label);
    expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
  });

  it('the Play rail uses the glossary’s words', () => {
    const strings = [...RAIL_CATEGORIES.flatMap(c => [c.label, c.description]), ...Object.values(RAIL_PAGES).flatMap(p => [p.label, p.description])];
    expect(strings.flatMap(glossaryProblems)).toEqual([]);
    expect(RAIL_CATEGORIES.map(c => c.label)).toEqual(['Controls', 'Layers', 'Rules', 'Finish', 'Sound']);
  });

  it('the bars, menus and toolbars use the glossary’s words', () => {
    const problems = CHROME_FILES.flatMap(f => {
      const src = readFileSync(resolve(__dirname, '../../..', f), 'utf8');
      const strings = chromeStrings(src);
      expect(strings.length, `${f} has chrome strings`).toBeGreaterThan(0);
      return strings.flatMap(s => glossaryProblems(s).map(p => `${f}: ${p}`));
    });
    expect(problems).toEqual([]);
  });

  it('every banned word says what to use instead', () => {
    for (const b of BANNED) expect(b.use.length).toBeGreaterThan(3);
  });
});
