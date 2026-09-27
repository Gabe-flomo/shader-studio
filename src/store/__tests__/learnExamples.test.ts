import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { collectPlayCandidates } from '../../play/playControls';
import { EXAMPLE_GRAPHS } from '../exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../exampleIndex';
import { LEARN_EXAMPLE_KEYS, LEARN_MOVED_INDEX } from '../learnExampleIndex';
import { parsePlayRecord } from '../../types/play';

/** The section headings on the Book's chapter pages (thebookofshaders.com/NN/), as of September 2026. */
const BOOK_HEADINGS: Record<number, string[]> = {
  3: ['Uniforms', 'gl_FragCoord'],
  5: ['Step and Smoothstep', 'Sine and Cosine', 'Some extra useful functions', 'Advance shaping functions'],
  6: ['Mixing color', 'Playing with gradients', 'HSB', 'HSB in polar coordinates'],
  7: ['Rectangle', 'Circles', 'Distance field', 'Useful properties of a Distance Field', 'Polar shapes', 'Combining powers'],
  8: ['Translate', 'Rotations', 'Scale', 'Other uses for matrices: YUV color'],
  9: ['Apply matrices inside patterns', 'Offset patterns', 'Truchet Tiles', 'Making your own rules'],
  10: ['Controlling chaos', '2D Random', 'Using the chaos', 'Master Random'],
  11: ['2D Noise', 'Using Noise in Generative Designs', 'Improved Noise', 'Simplex Noise'],
  12: ['Points for a distance field', 'Tiling and iteration', 'Voronoi Algorithm', 'Improving Voronoi'],
  13: ['Domain Warping'],
};

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

const compile = (key: string) => {
  const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
  return { nodes, r: compileGraph({ nodes }) };
};

describe('Learn: the Book of Shaders as graphs', () => {
  it('has its own folder, numbered in order', () => {
    const folder = EXAMPLE_FOLDERS.find(f => f.label === 'Learn')!;
    expect(folder.keys).toEqual(LEARN_EXAMPLE_KEYS);
    LEARN_EXAMPLE_KEYS.forEach((k, n) => {
      expect(EXAMPLE_INDEX[k].label.startsWith(`${String(n + 1).padStart(2, '0')} · `), k).toBe(true);
      expect(EXAMPLE_GRAPHS[k].label, k).toBe(EXAMPLE_INDEX[k].label);
    });
  });

  it.each(LEARN_EXAMPLE_KEYS)('%s compiles with no errors', key => {
    const { r } = compile(key);
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it.each(LEARN_EXAMPLE_KEYS)('%s has notes and 1–3 live Play sliders', key => {
    const play = EXAMPLE_GRAPHS[key].play!;
    for (const part of ['**What it shows.**', '**How it is built.**', '**Try.**']) expect(play.notes, part).toContain(part);
    // The credit is the structured source now; the notes don't repeat it.
    expect(play.notes).not.toContain('**Source.**');
    expect(play.controls.length).toBeGreaterThanOrEqual(1);
    expect(play.controls.length).toBeLessThanOrEqual(3);
    const { nodes, r } = compile(key);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of play.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });

  it.each(LEARN_EXAMPLE_KEYS.filter(k => k !== 'learnRaymarch'))('%s credits its chapter of the Book, in the list and on its Play setup', key => {
    const s = EXAMPLE_INDEX[key].source!;
    expect(s, key).toBeDefined();
    expect(s.title).toBe('The Book of Shaders');
    expect(s.author).toBe('Patricio Gonzalez Vivo and Jen Lowe');
    expect(s.chapter).toBeGreaterThanOrEqual(2);
    expect(s.chapterTitle).toBeTruthy();
    expect(s.url).toBe(`https://thebookofshaders.com/${String(s.chapter).padStart(2, '0')}/`);
    // A section is one of that chapter's own headings.
    if (s.section) expect(BOOK_HEADINGS[s.chapter!], `${key}: ${s.section}`).toContain(s.section);
    // It travels with the Play setup (saved copies, play files, presentations).
    expect(EXAMPLE_GRAPHS[key].play!.source).toEqual(s);
    expect(parsePlayRecord(JSON.parse(JSON.stringify(EXAMPLE_GRAPHS[key].play))).source).toEqual(s);
  });

  it('follows the Book chapter by chapter, and the extra that isn\'t from the Book credits nothing', () => {
    const chapters = LEARN_EXAMPLE_KEYS.flatMap(k => (EXAMPLE_INDEX[k].source ? [EXAMPLE_INDEX[k].source!.chapter!] : []));
    expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
    expect(EXAMPLE_INDEX.learnRaymarch.source).toBeUndefined();
    expect(EXAMPLE_GRAPHS.learnRaymarch.play?.source).toBeUndefined();
    expect(EXAMPLE_INDEX.learnStep.source).toMatchObject({ chapter: 5, chapterTitle: 'Shaping functions', section: 'Step and Smoothstep' });
  });

  it('keeps the earlier lessons it moved out, each in exactly one other folder, with their notes', () => {
    for (const key of Object.keys(LEARN_MOVED_INDEX)) {
      const folders = EXAMPLE_FOLDERS.filter(f => f.keys.includes(key)).map(f => f.label);
      expect(folders, key).toHaveLength(1);
      expect(folders[0], key).not.toBe('Learn');
      expect(EXAMPLE_GRAPHS[key].label, key).toBe(LEARN_MOVED_INDEX[key].label);
      expect(EXAMPLE_GRAPHS[key].play?.notes, key).toContain('**What it shows.**');
      expect(compile(key).r.errors ?? [], key).toEqual([]);
    }
  });
});
