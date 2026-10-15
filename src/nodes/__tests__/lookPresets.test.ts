/**
 * The standard Looks (nodes/lookPresets.ts): each places as an Expression Block that compiles, alone
 * and wired; every named line is explained in its note; no input name clashes with the block's own
 * settings; the node search finds them by name and by "look", after the nodes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { exprPresetParams } from '../../lib/glslPatterns/saveFlows';
import { n } from '../../store/graphBuilder';
import { LOOK_PRESETS, lookDef, matchLooks } from '../lookPresets';
import { getNodeDefinition } from '../definitions';
import type { ExprPreset } from '../../types/exprPreset';
import type { GraphNode } from '../../types/nodeGraph';

/** The Look as placed, its sockets as the block makes them (exprAgentKit's expr() does the same). */
function placed(p: ExprPreset, wires: Record<string, [string, string]> = {}): GraphNode {
  const node = n('exprNode', 'look', 300, 0, exprPresetParams(p));
  node.inputs = Object.fromEntries(p.inputs.map(i => [i.name, { type: i.type, label: i.name, ...(wires[i.name] ? { connection: { nodeId: wires[i.name][0], outputKey: wires[i.name][1] } } : {}) }]));
  node.outputs = { result: { type: p.outputType, label: 'Result' } };
  return node;
}

describe('Looks', () => {
  it.each(LOOK_PRESETS.map(p => [p.label, p] as const))('%s compiles unwired and wired', (_l, p) => {
    const alone = compileGraph({ nodes: [placed(p), n('output', 'o', 600, 0, {}, { color: ['look', 'result'] })] });
    expect(alone.errors, JSON.stringify(alone.errors)).toBeUndefined();
    // Every vec3 fed a picture, every float a distance.
    const wires: Record<string, [string, string]> = {};
    for (const i of p.inputs) if (!i.slider) wires[i.name] = i.type === 'vec3' ? ['pal', 'color'] : ['circ', 'distance'];
    const wired = compileGraph({ nodes: [
      n('palette', 'pal', 0, 0, {}), n('circleSDF', 'circ', 0, 200, {}),
      placed(p, wires), n('output', 'o', 600, 0, {}, { color: ['look', 'result'] }),
    ] });
    expect(wired.errors, JSON.stringify(wired.errors)).toBeUndefined();
  });
  it('explains every named line, has slider values in range, and no input takes a setting\'s name', () => {
    const settings = new Set(['label', 'inputs', 'outputType', 'lines', 'result', 'expr', 'outputs', 'loop', 'loopN']);
    for (const p of LOOK_PRESETS) {
      const note = p.comment ?? '';
      expect(note.split('\n')[0]).toMatch(/\(a Look\)/);
      for (const l of p.lines) expect(note, `${p.label}: ${l.lhs}`).toContain(`${l.lhs.split(' ').pop()}:`);
      expect(note).toContain('Result');
      for (const i of p.inputs) {
        expect(settings.has(i.name), `${p.label}.${i.name}`).toBe(false);
        if (i.slider) {
          const v = p.values?.[i.name];
          expect(v, `${p.label}.${i.name}`).toBeDefined();
          expect(v!).toBeGreaterThanOrEqual(i.slider.min);
          expect(v!).toBeLessThanOrEqual(i.slider.max);
        }
      }
    }
    expect(new Set(LOOK_PRESETS.map(p => p.id)).size).toBe(LOOK_PRESETS.length);
  });
  it('the node search finds them by name, by "look", and shows their own sockets', () => {
    expect(matchLooks('vignette').map(p => p.label)).toEqual(['Vignette']);
    expect(matchLooks('look')).toHaveLength(LOOK_PRESETS.length);
    expect(matchLooks('glow').map(p => p.label)).toEqual(expect.arrayContaining(['Glowing line', 'Glow ring']));
    expect(matchLooks('zzz')).toEqual([]);
    const def = lookDef(getNodeDefinition('exprNode')!, LOOK_PRESETS.find(p => p.label === 'Colour pop')!);
    expect(def.type).toBe('exprNode');
    expect(Object.keys(def.inputs)).toEqual(['picture', 'mask', 'grey', 'rim', 'rimColour']);
  });
});
