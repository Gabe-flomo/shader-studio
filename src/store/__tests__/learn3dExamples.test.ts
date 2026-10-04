import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { collectPlayCandidates } from '../../play/playControls';
import { EXAMPLE_GRAPHS } from '../exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../exampleIndex';
import { LEARN3D_EXAMPLE_KEYS } from '../learn3dExampleIndex';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

const compile = (key: string) => {
  const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
  return { nodes, r: compileGraph({ nodes }) };
};

describe('Learn 3D lessons', () => {
  it('sit in their own folder right after Learn, numbered in order', () => {
    const i = EXAMPLE_FOLDERS.findIndex(f => f.label === 'Learn 3D');
    expect(EXAMPLE_FOLDERS[i - 1].label).toBe('Learn');
    expect(EXAMPLE_FOLDERS[i].keys).toEqual(LEARN3D_EXAMPLE_KEYS);
    expect(LEARN3D_EXAMPLE_KEYS.length).toBe(9);
    LEARN3D_EXAMPLE_KEYS.forEach((k, n) => {
      expect(EXAMPLE_INDEX[k].label.startsWith(`3D ${n + 1} · `), k).toBe(true);
      expect(EXAMPLE_GRAPHS[k].label, k).toBe(EXAMPLE_INDEX[k].label);
    });
  });

  it.each(LEARN3D_EXAMPLE_KEYS)('%s compiles with no errors', key => {
    const { r } = compile(key);
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it.each(LEARN3D_EXAMPLE_KEYS)('%s has notes and 1–3 live Play sliders', key => {
    const play = EXAMPLE_GRAPHS[key].play!;
    for (const part of ['**What it shows.**', '**How it is built.**', '**Try.**']) expect(play.notes, part).toContain(part);
    expect(play.controls.length).toBeGreaterThanOrEqual(1);
    expect(play.controls.length).toBeLessThanOrEqual(3);
    const { nodes, r } = compile(key);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of play.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });

  it('the Blend radius reaches the Union inside the Scene Group through a port', () => {
    const { r } = compile('learn3dCombine');
    const uniform = r.paramBindings['blend::value'];
    expect(uniform).toBeTruthy();
    // The scene function takes the Constant's value as an extra argument and blends with it.
    expect(r.fragmentShader).toMatch(/float mapScene_\w+\(vec3 p, float (\w+)\)[\s\S]*?_k = max\(\1, 1e-5\)/);
  });
});

describe('March loop step count', () => {
  it('a ray that runs out of steps reports all of them (Iter 1), not 0', () => {
    const { r } = compile('learn3dMarch');
    // Max Steps is 48 in the lesson: the step counter starts there and only a hit or a miss past Max Dist lowers it.
    expect(r.fragmentShader).toMatch(/int\s+\w+_si\s+= 48;/);
    expect(r.fragmentShader).not.toMatch(/int\s+\w+_si\s+= 0;/);
  });
});
