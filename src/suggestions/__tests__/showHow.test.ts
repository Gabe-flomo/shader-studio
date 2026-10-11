/**
 * Show me how (suggestions/showHow.ts): a line built step by step, each step with what it does and
 * the graph after it (the window draws those), for a 2D line, an edit on a scratch graph and a 3D
 * scene clause by clause.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { showHowPlan, shownNode } from '../showHow';
import { execCommand } from '../doCommands';
import { scratchGraph } from '../doScratch';

describe('showHowPlan', () => {
  it('a 2D line on an empty graph: steps with pictures to draw, the Output showing the end', () => {
    const p = showHowPlan({ text: 'circle · glow falloff=8' });
    expect(p.kind).toBe('picture');
    expect(p.problems).toEqual([]);
    expect(p.steps.length).toBeGreaterThanOrEqual(2);
    for (const s of p.steps) {
      expect(s.label).toBeTruthy();
      expect(s.nodes.length).toBeGreaterThan(1);
    }
    expect(p.steps.some(s => s.added.some(a => a.label && a.does))).toBe(true);
    expect(shownNode(p.final)).toBeTruthy();
    expect(p.steps[p.steps.length - 1].nodes).toBe(p.final);
  });

  it('an edit on a scratch graph says what it runs on', () => {
    const p = showHowPlan({ text: 'create ring falloff=0.03', on: 'circle' });
    expect(p.on).toMatch(/Circle SDF/);
    expect(p.steps.length).toBeGreaterThan(0);
  });

  it('a 3D scene, clause by clause, each explained from its help', () => {
    const p = showHowPlan({ text: 'volumetric density=0.04 · box width=0.3 · twist 2' });
    expect(p.kind).toBe('scene');
    expect(p.steps.map(s => s.code)).toEqual(['volumetric density=0.04', 'box width=0.3', 'twist 2']);
    expect(p.steps[0].what).toMatch(/^Volumetric: /);
    expect(p.steps[2].what).toMatch(/Twist/);
    for (const s of p.steps) expect(shownNode(s.nodes)).toBeTruthy();
  });

  it('grid and agent lines are not built here', () => {
    expect(showHowPlan({ text: 'grid life' }).problems[0]).toMatch(/Do… bar/);
  });

  it('snapshots only when asked: the Do… bar\'s own runs keep no graphs', () => {
    const plain = execCommand('circle · glow', scratchGraph('empty'), { selected: [] });
    expect(plain.steps.every(s => s.after === undefined)).toBe(true);
    const kept = execCommand('circle · glow', scratchGraph('empty'), { selected: [], snapshots: true });
    expect(kept.steps.every(s => Array.isArray(s.after))).toBe(true);
  });
});
