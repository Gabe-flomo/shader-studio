/**
 * The pass grace zone and exports (lib/passRunner.ts passTargetSize): the live preview's targets draw a graced
 * pass at half size, an export's (PassTargets with `full`) at its full size.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { passTargetSize } from '../passRunner';
import { ppSize } from '../../play/kit/passPlan.js';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';

function chain(count: number): GraphNode[] {
  const nodes: GraphNode[] = [n('uv', 'uvn', 0, 0), n('swizzle', 'rgb', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['uvn', 'uv'] })];
  let from: [string, string] = ['rgb', 'output'];
  for (let i = 0; i < count; i++) { nodes.push(n('pass', `p${i}`, 0, 0, {}, { color: from })); from = [`p${i}`, 'color']; }
  return [...nodes, n('output', 'out', 0, 0, {}, { color: from })];
}

describe('Pass grace: preview vs export', () => {
  it('a graced pass is half size in the preview and full size in an export', () => {
    const r = compileGraph({ nodes: chain(9) });
    expect(r.errors).toBeUndefined();
    const p = r.passes![0];
    const live = passTargetSize(p, false), exported = passTargetSize(p, true);
    expect(ppSize(1920, 1080, live.scale, live.size)).toEqual([960, 540]);
    expect(ppSize(1920, 1080, exported.scale, exported.size)).toEqual([1920, 1080]);
  });

  it('outside grace an export draws the same size as the preview', () => {
    const p = compileGraph({ nodes: chain(8) }).passes![0];
    expect(passTargetSize(p, true)).toBe(p);
    expect(ppSize(1920, 1080, p.scale, p.size)).toEqual([1920, 1080]);
  });
});
