/**
 * Camera projections (docs/camera-projections.md): graphs that never chose a Perspective compile exactly as before.
 * The snapshots were written from main before the feature, then checked against it: 3D Draw agents (its own camera,
 * and a ray-marched scene's), the Splat examples, and the Splat builder's default scene (the picture's program and
 * the agents' and splats' specs; a Splat Scene's probe program is left out: it now also writes the ray origins).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { slime3dNodes, torus3dNodes } from '../../store/agentExamples3d';
import { splatModifiersNodes } from '../../store/splatExamples';
import { buildSplatStandalone } from '../../splatBuilder/build';
import { starterSplatScene } from '../../splatBuilder/spec';
import type { GraphNode } from '../../types/nodeGraph';

function golden(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  return {
    errors: r.errors ?? null,
    fragmentShader: r.fragmentShader,
    paramUniforms: r.paramUniforms,
    draws: (r.agents?.draws ?? []).map(d => ({ ...d })),
    splats: (r.splats ?? []).map(s => ({ nodeId: s.nodeId, paramUniforms: s.paramUniforms, modifier: s.modifier ?? null })),
  };
}

describe('camera projections: defaults compile as before', () => {
  it('3D slime (Draw agents\' own camera)', () => expect(golden(slime3dNodes())).toMatchSnapshot());
  it('torus in 3D (Draw agents through a March Camera\'s probe)', () => expect(golden(torus3dNodes())).toMatchSnapshot());
  it('Splat modifiers example', () => expect(golden(splatModifiersNodes())).toMatchSnapshot());
  it('Splat builder\'s starting scene', () => expect(golden(buildSplatStandalone(starterSplatScene()).nodes)).toMatchSnapshot());
});
