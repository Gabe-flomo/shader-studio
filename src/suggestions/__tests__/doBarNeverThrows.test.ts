/**
 * The Do… bar reads the line on every keystroke, so `parseDo` (and the command preview built on
 * it) must never throw: a throw there used to unmount the whole app while you typed.
 *
 *  - the cases the language pressure test hit (docs/reports/language-pressure-test.md, "runner
 *    crash"): a colour action (`create palette`, `create crt-screen`, `create mix`…) with a
 *    selection whose picture on the Output is not a colour (a Time, a UV, a number);
 *  - a fuzz pass: every vocabulary word, every node's create word, and seeded random prefixes of
 *    every corpus line, on a handful of graphs and selections.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import type { GraphNode } from '../../types/nodeGraph';
// Every node registered, as in the app (the store pulls in the late-registered nodes: CRT Screen…).
import '../../store/useNodeGraphStore';
import { n } from '../../store/graphBuilder';
import { getOfferedDefinitions } from '../../nodes/definitions';
import { parseDo } from '../doBar';
import { execCommand } from '../doCommands';
import { ACTIONS, COLOURS, FILLER, NUMBER_WORDS, PARAMS, PLACES, SHAPES, TARGETS } from '../../lang/vocabulary';
import { LANGUAGE_CORPUS } from '../../lang/__tests__/corpus';
import { readLine, readsCanonically } from '../../lang/run';

/** What the bar runs for a typed line: a canonical picture line's sentence, else the text (DoBar.tsx `runText`). */
function barText(text: string): string {
  const line = readLine(text, { seed: 1 });
  return readsCanonically(line) && line.dialect === 'picture' ? line.picture!.sentence! : text;
}

// ── Graphs the crashes happened on ─────────────────────────────────────────

/** `create time` on an empty graph: the Time node is wired to the Output (a number on the picture). */
const timeOnOutput = (): GraphNode[] => [
  n('time', 'time', 0, 0),
  n('output', 'out', 400, 0, {}, { color: ['time', 'time'] }),
];
/** A shape nothing uses, with a number on the Output. */
const looseCircle = (): GraphNode[] => [
  ...timeOnOutput(),
  n('uv', 'uv', 0, 300),
  n('circleSDF', 'circle', 400, 300, {}, { position: ['uv', 'uv'] }),
];
/** A space (a Grid's warped UV) on the Output. */
const gridOnOutput = (): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('gridLayout', 'grid', 400, 0, {}, { uv: ['uv', 'uv'] }),
  n('output', 'out', 800, 0, {}, { color: ['grid', 'warpedUV'] }),
];
/** A Mix of numbers (outputType float) beside a Time on the Output. */
const numberMix = (): GraphNode[] => [
  ...timeOnOutput(),
  n('mix', 'mix', 400, 300, { outputType: 'float' }, { a: ['time', 'time'] }),
];
/** A whole picture: UV → circle → SDF Fill → Output. */
const picture = (): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('circleSDF', 'circle', 400, 0, {}, { position: ['uv', 'uv'] }),
  n('sdfFill', 'fill', 800, 0, {}, { d: ['circle', 'distance'] }),
  n('output', 'out', 1200, 0, {}, { color: ['fill', 'result'] }),
];
/** The Output wired to a node that isn't there (a stale wire). */
const danglingOutput = (): GraphNode[] => [n('output', 'out', 0, 0, {}, { color: ['gone', 'result'] })];
const emptyGraph = (): GraphNode[] => [n('output', 'out', 0, 0)];

const NO_COLOUR = 'There is no colour to do that to yet.';

describe('parseDo: the pressure test’s crashes are refusals now', () => {
  const cases: Array<[string, () => GraphNode[], string[]]> = [
    ['create crt-screen', timeOnOutput, ['time']],
    ['create palette', timeOnOutput, ['time']],
    ['create mix', timeOnOutput, ['time']],
    ['create tone-map', timeOnOutput, ['time']],
    ['create chaos-layers', timeOnOutput, ['time']],
    ['create palette', looseCircle, ['circle']],
    ['create tone-map', numberMix, ['mix']],
    ['create mix', numberMix, ['mix']],
    ['set mix outputType="vec3"', numberMix, ['mix']],
    ['connect grid → palette.value', gridOnOutput, ['grid']],
    ['connect "colorize" → output', gridOnOutput, ['grid']],
    ['tone map it', danglingOutput, []],
    ['grain', danglingOutput, []],
  ];
  for (const [text, graph, selected] of cases) {
    it(`“${text}” with ${selected.join(', ') || 'nothing'} selected`, () => {
      const nodes = graph();
      let plan!: ReturnType<typeof parseDo>;
      for (const t of [text, barText(text)]) {
        expect(() => { plan = parseDo(t, { nodes, selected }); }).not.toThrow();
        // Either a plan that doesn't reach for a colour, or the plain refusal.
        if (plan.problem) expect(typeof plan.problem).toBe('string');
        expect(() => execCommand(t, nodes, { selected, topLevel: true })).not.toThrow();
      }
    });
  }

  it('a colour move with only a number on the Output is refused, not thrown', () => {
    const plan = parseDo('palette', { nodes: looseCircle(), selected: ['circle'] });
    expect(plan.problem).toBe(NO_COLOUR);
    expect(plan.steps).toEqual([]);
  });

  it('`create crt-screen` after `create time` still makes a CRT Screen', () => {
    const nodes = timeOnOutput();
    const cmd = execCommand(barText('create crt-screen'), nodes, { selected: ['time'], topLevel: true });
    expect(cmd.ok, cmd.clauses.map(c => c.message).join('; ')).toBe(true);
    expect(cmd.nodes.some(nd => nd.type === 'crtScreen')).toBe(true);
  });

  it('`create palette` with a loose circle still makes a Palette', () => {
    const cmd = execCommand(barText('create palette'), looseCircle(), { selected: ['circle'], topLevel: true });
    expect(cmd.ok, cmd.clauses.map(c => c.message).join('; ')).toBe(true);
    expect(cmd.nodes.some(nd => nd.type === 'palette')).toBe(true);
  });

  it('a colour move still finds the colour when the Output shows one', () => {
    const plan = parseDo('tone map it', { nodes: picture(), selected: ['circle'] });
    expect(plan.problem).toBeUndefined();
    expect(plan.steps).toMatchObject([{ kind: 'move', moveId: 'tone-map', node: 'fill' }]);
  });
});

// ── Fuzz ───────────────────────────────────────────────────────────────────

/** Mulberry32: the same "random" prefixes every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const VOCAB: string[] = [...new Set([
  ...SHAPES.flatMap(s => s.words),
  ...ACTIONS.flatMap(a => [...a.words, ...(a.variants ?? []).flatMap(v => v.words)]),
  ...Object.values(TARGETS).flat(),
  ...Object.values(PARAMS).flat(),
  ...Object.keys(COLOURS),
  ...Object.keys(NUMBER_WORDS),
  ...Object.keys(PLACES),
  ...FILLER,
])];
const CREATE_WORDS = [...new Set(getOfferedDefinitions().flatMap(d => [slug(d.label), d.type.toLowerCase()]).filter(Boolean))];

const GRAPHS: Array<{ name: string; nodes: () => GraphNode[]; selected: string[] }> = [
  { name: 'empty', nodes: emptyGraph, selected: [] },
  { name: 'time on the Output, time selected', nodes: timeOnOutput, selected: ['time'] },
  { name: 'loose circle selected', nodes: looseCircle, selected: ['circle'] },
  { name: 'number mix selected', nodes: numberMix, selected: ['mix'] },
  { name: 'grid on the Output, grid selected', nodes: gridOnOutput, selected: ['grid'] },
  { name: 'picture, circle selected', nodes: picture, selected: ['circle'] },
  { name: 'picture, circle and fill selected', nodes: picture, selected: ['circle', 'fill'] },
  { name: 'dangling Output wire', nodes: danglingOutput, selected: [] },
];

/** Every way of feeding a line in, checked; returns the ones that threw. */
function throwsOn(lines: string[], nodes: GraphNode[], selected: string[]): string[] {
  const bad: string[] = [];
  for (const text of lines) {
    try { parseDo(text, { nodes, selected }); } catch (e) { bad.push(`parseDo “${text}”: ${(e as Error).message}`); }
    // As the bar runs it: a canonical line's sentence.
    try { const t = barText(text); if (t !== text) parseDo(t, { nodes, selected }); } catch (e) { bad.push(`parseDo (canonical) “${text}”: ${(e as Error).message}`); }
  }
  return bad;
}

describe('parseDo never throws (fuzz)', () => {
  const vocabLines = VOCAB.flatMap(w => [w, `create ${w}`, `${w} it`, `circle with ${w}`, `${w} these`, `${w} the picture`, `${w} the space 0.5`]);
  const createLines = CREATE_WORDS.flatMap(w => [`create ${w}`, `${w} it`]);
  const r = rng(1234);
  const prefixLines = [...new Set(LANGUAGE_CORPUS.flatMap(e => {
    const t = e.text;
    const cuts = [1, 2, 3, 4, 5].map(() => 1 + Math.floor(r() * t.length));
    // Word by word as well: what the bar sees at each space.
    const words = t.split(' ').map((_, i, all) => all.slice(0, i + 1).join(' '));
    return [...cuts.map(c => t.slice(0, c)), ...words];
  }))];

  it('has a real corpus to chew on', () => {
    expect(VOCAB.length).toBeGreaterThan(100);
    expect(CREATE_WORDS.length).toBeGreaterThan(100);
    expect(prefixLines.length).toBeGreaterThan(1000);
  });

  for (const g of GRAPHS) {
    it(`every vocabulary word and create word · ${g.name}`, () => {
      expect(throwsOn([...vocabLines, ...createLines], g.nodes(), g.selected)).toEqual([]);
    });
    it(`random prefixes of the corpus lines · ${g.name}`, () => {
      expect(throwsOn(prefixLines, g.nodes(), g.selected)).toEqual([]);
    });
  }

  it('every corpus prefix on its own graph and selection, through the command preview too', () => {
    const bad: string[] = [];
    for (const e of LANGUAGE_CORPUS) {
      const nodes = e.graph();
      const words = e.text.split(' ').map((_, i, all) => all.slice(0, i + 1).join(' '));
      for (const text of words) {
        try { parseDo(text, { nodes, selected: e.selected }); } catch (err) { bad.push(`parseDo “${text}” (${e.source}): ${(err as Error).message}`); }
        try { execCommand(text, nodes, { selected: e.selected, topLevel: true }); } catch (err) { bad.push(`execCommand “${text}” (${e.source}): ${(err as Error).message}`); }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
