/**
 * lang/fromGraph.ts: a graph as Do… bar lines. The lines rebuild the graph on an empty one (just
 * an Output) when the language can say everything, and what it can't say becomes `# cannot
 * express` with a category.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { graphToScript, emptySim, simRun } from '../fromGraph';
import { flattenGraph, levelDigest } from '../graphFlat';
import { scratchGraph } from '../../suggestions/doScratch';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';

/** Run a script line by line on an empty graph (the printer's own runner, as the bar runs a line). */
function rebuild(script: string): GraphNode[] {
  let sim = emptySim();
  for (const line of script.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const r = simRun(sim, line);
    expect(r.ok, `${line}: ${r.error}`).toBe(true);
    sim = r.sim;
  }
  return sim.nodes;
}

const shape = (nodes: GraphNode[]) => levelDigest(nodes.map(nd => ({ ...nd, params: { ...nd.params, __comment: undefined } })));

describe('graphToScript', () => {
  it('prints the empty graph as nothing', () => {
    const p = graphToScript(scratchGraph('empty'));
    expect(p.lines.filter(l => l.form !== 'comment')).toEqual([]);
  });

  it('rebuilds UV → Circle SDF → SDF Glow → Output, adopting the UV that create adds', () => {
    const g = scratchGraph('glow');
    const p = graphToScript(g);
    expect(p.script).toBe(['create circlesdf', 'create sdf-glow', 'connect dot → glow.distance', 'connect glow → output'].join('\n'));
    expect(shape(rebuild(p.script))).toEqual(shape(g));
  });

  it('sets what differs from a new node, by a reference that names one node', () => {
    const g = [
      n('uv', 'u', 0, 0), n('circleSDF', 'a', 420, 0, { radius: 0.1 }, { position: ['u', 'uv'] }), n('circleSDF', 'b', 420, 420, { radius: 0.4 }, { position: ['u', 'uv'] }),
      n('sdfUnion', 'un', 840, 0, {}, { a: ['a', 'distance'], b: ['b', 'distance'] }), n('sdfFill', 'f', 1260, 0, {}, { d: ['un', 'dist'] }), n('output', 'o', 1680, 0, {}, { color: ['f', 'result'] }),
    ];
    const p = graphToScript(g);
    expect(p.script).toMatch(/set dot(#\d)? radius=0.1/);
    expect(p.script).toMatch(/set dot#2 radius=0.4/);
    expect(p.script).toMatch(/delete before /);
    expect(p.gaps.filter(x => !['layout', 'notes'].includes(x.category))).toEqual([]);
    expect(flattenGraph(rebuild(p.script)).wires.length).toBe(flattenGraph(g).wires.length);
  });

  it('marks what it can\'t say instead of failing', () => {
    const g = [n('exprNode', 'e', 0, 0, { expr: 'a * 2.0\n', result: 'a * 2.0\n' }), n('output', 'o', 420, 0, {}, { color: ['e', 'result'] })];
    const p = graphToScript(g);
    expect(p.lines.some(l => l.form === 'comment' && /cannot express/.test(l.text))).toBe(true);
    expect(p.gaps.some(x => x.category === 'param-code')).toBe(true);
  });

  it('prints a builder-made Grid Rules node as its recipe', () => {
    const g = [n('gridRules', 'g', 0, 0, { rule: 'life' }), n('output', 'o', 420, 0, {}, { color: ['g', 'color'] })];
    const p = graphToScript(g);
    expect(p.lines[0].form).toBe('recipe');
    expect(p.lines[0].text).toMatch(/^grid /);
  });
});
