/**
 * The Noise examples (store/noiseExamples.ts, docs/noise-node.md): every one builds from the node definitions and
 * compiles with no errors into GLSL that parses, each uses the node or the Voronoi feature it is about, and the
 * Play controls point at live sliders.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { buildNoiseExamples, NOISE_EXAMPLE_INDEX, NOISE_EXAMPLE_KEYS } from '../../store/noiseExamples';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { collectPlayCandidates } from '../../play/playControls';

const PREFIX = '#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';

describe('Noise examples', () => {
  const all = buildNoiseExamples();

  it('are all built, indexed and filed', () => {
    expect(Object.keys(all).sort()).toEqual([...NOISE_EXAMPLE_KEYS].sort());
    expect(NOISE_EXAMPLE_KEYS.length).toBeGreaterThanOrEqual(6);
    const filed = EXAMPLE_FOLDERS.filter(f => f.label.startsWith('Noise')).flatMap(f => f.keys);
    expect([...filed].sort()).toEqual([...NOISE_EXAMPLE_KEYS].sort());
  });

  it('each compiles with no errors, into GLSL that parses', () => {
    const bad: string[] = [];
    for (const [k, g] of Object.entries(all)) {
      const r = compileGraph({ nodes: g.nodes });
      if (!r.success || r.errors?.length) { bad.push(`${k}: ${r.errors?.join('; ')}`); continue; }
      try { parser.parse(PREFIX + r.fragmentShader, { quiet: true }); } catch (e) { bad.push(`${k}: ${(e as Error).message.split('\n')[0]}`); }
    }
    expect(bad).toEqual([]);
  });

  it('each shows the Noise node or a Voronoi cell feature', () => {
    const features = ['f2', 'edge', 'edgeDist', 'cellId', 'cellColour', 'cellPos'];
    for (const [k, g] of Object.entries(all)) {
      const usesNoise = g.nodes.some(nd => nd.type === 'noise');
      const usesFeature = g.nodes.some(nd => Object.values(nd.inputs).some(i => i.connection && features.includes(i.connection.outputKey) && g.nodes.find(s => s.id === i.connection!.nodeId)?.type === 'voronoi'));
      expect(usesNoise || usesFeature, k).toBe(true);
      if (k.startsWith('voronoi')) expect(usesFeature, k).toBe(true);
    }
  });

  it('Play controls point at sliders the compiled graph keeps live', () => {
    for (const [k, g] of Object.entries(all)) {
      expect(!!NOISE_EXAMPLE_INDEX[k].play, k).toBe(!!g.play);
      if (!g.play) continue;
      expect(g.play.notes).toContain('**What it shows.**');
      const r = compileGraph({ nodes: g.nodes });
      const live = new Set(collectPlayCandidates(g.nodes, r.paramBindings).map(c => c.target));
      for (const c of g.play.controls) expect(live.has(c.target), `${k}: ${c.target} not in ${[...live].slice(0, 6).join(', ')}`).toBe(true);
    }
  });
});
