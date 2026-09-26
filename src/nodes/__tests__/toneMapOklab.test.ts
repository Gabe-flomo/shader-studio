import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const graph = (mode: string): GraphNode[] => [
  { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
  { id: 'pal', type: 'palette', position: { x: 0, y: 0 }, inputs: { value: { type: 'float', label: 'Value' }, anim: { type: 'float', label: 'Anim' }, offset: { type: 'vec3', label: 'Offset' }, amplitude: { type: 'vec3', label: 'Amplitude' }, freq: { type: 'vec3', label: 'Freq' }, phase: { type: 'vec3', label: 'Phase' } }, outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '1' } },
  { id: 'tm', type: 'toneMap', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal', outputKey: 'color' } } }, outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode, oklabKnee: 0.5, oklabHighlights: 0.8 } },
  { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tm', outputKey: 'color' } } }, outputs: {}, params: {} },
];

describe('Tone Map: OkLab mode', () => {
  it('compiles to the OkLab tone function with its knee and highlight params, without GLSL 1.30 built-ins', () => {
    const r = compileGraph({ nodes: graph('oklab') });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/toneOkLab\(\w+_color, /);
    expect(r.fragmentShader).toContain('vec3 toneOkLab(vec3 c, float knee, float hl)');
    expect(r.fragmentShader).not.toMatch(/\btanh\s*\(/);
  });
  it('leaves the other modes as they were', () => {
    const r = compileGraph({ nodes: graph('aces') });
    expect(r.fragmentShader).toMatch(/toneACES\(\w+_color\)/);
    expect(r.fragmentShader).not.toContain('toneOkLab(');
  });
});
