import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { collectPlayCandidates } from '../../play/playControls';
import { EXAMPLE_GRAPHS } from '../exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../exampleIndex';
import { LEARN_EXAMPLE_KEYS, LEARN_MOVED_INDEX } from '../learnExampleIndex';

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

  it.each(LEARN_EXAMPLE_KEYS)('%s has notes, credits its chapter, and 1–3 live Play sliders', key => {
    const play = EXAMPLE_GRAPHS[key].play!;
    for (const part of ['**What it shows.**', '**How it is built.**', '**Try.**']) expect(play.notes, part).toContain(part);
    if (key !== 'learnRaymarch') expect(play.notes).toMatch(/https:\/\/thebookofshaders\.com\/\d\d\//);
    expect(play.controls.length).toBeGreaterThanOrEqual(1);
    expect(play.controls.length).toBeLessThanOrEqual(3);
    const { nodes, r } = compile(key);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of play.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
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
