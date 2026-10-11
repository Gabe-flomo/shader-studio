/**
 * Every bundled example loads through the store (what the Examples menu does) and compiles: the
 * graph comes in under its own key, the compiler reports no errors, and the shaders it makes parse
 * as GLSL (each pass's too). A GPU check is the browser's; this catches an example that fails to
 * load or to compile at all.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});

import { parser } from '@shaderfrog/glsl-parser';
import { loadExampleGraphs } from '../exampleIndex';
import { useNodeGraphStore } from '../useNodeGraphStore';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('every example loads and compiles', () => {
  it('through the store, with no compile errors and shaders that parse', async () => {
    const all = await loadExampleGraphs();
    const keys = Object.keys(all);
    expect(keys.length).toBeGreaterThan(100);
    const failed: string[] = [];
    for (const key of keys) {
      try {
        await useNodeGraphStore.getState().loadExampleGraph(key);
        const st = useNodeGraphStore.getState();
        const problems: string[] = [];
        if (!st.nodes.length) problems.push('no nodes');
        if (st.compilationErrors.length) problems.push(`compile: ${st.compilationErrors.slice(0, 2).join('; ')}`);
        if (!st.fragmentShader) problems.push('no shader');
        else {
          const bad = parses(st.fragmentShader);
          if (bad) problems.push(`GLSL: ${bad}`);
        }
        for (const p of st.programMap?.passes ?? []) {
          const bad = parses(p.fragmentShader);
          if (bad) problems.push(`pass GLSL: ${bad}`);
        }
        if (problems.length) failed.push(`${key}: ${problems.join(' | ')}`);
      } catch (e) {
        failed.push(`${key}: threw ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  }, 300_000);
});
