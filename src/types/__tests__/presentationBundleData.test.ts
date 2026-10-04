/**
 * A presentation's snapshot keeps the export's Pass programs and Agents family
 * (so Present can run them), as plain bounded data; anything else is dropped.
 */
import { describe, expect, it } from 'vitest';
import { parsePresentation } from '../presentation';

const base = (bundle: Record<string, unknown>) => ({
  version: 1, title: 'T', steps: [{ id: 's1', title: 'One', blocks: [{ type: 'text', id: 'b1', text: 'Hi' }] }],
  sources: [{ id: 'src1', from: { kind: 'saved', name: 'x', savedAt: 0 }, title: 'x', shader: { nodes: [] },
    bundle: { title: 'x', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: {}, aspect: 'free', ...bundle } }],
});

describe('presentation bundles: Pass programs and agents', () => {
  it('keep agents, graphPasses and motionMap as written', () => {
    const agents = { groups: [{ slug: 'slime_0', fragmentShader: 'void main(){}', side: 1024, emit: [{ mode: 'fill' }] }], trails: [], draws: [], deposits: [] };
    const graphPasses = [{ slug: 'p0', fragmentShader: 'void main(){}', scale: 0.5 }];
    const p = parsePresentation(base({ agents, graphPasses, motionMap: 'u_motionMap' }));
    const b = p?.sources[0]?.bundle;
    expect(b?.agents).toEqual(agents);
    expect(b?.graphPasses).toEqual(graphPasses);
    expect(b?.motionMap).toBe('u_motionMap');
  });

  it('drop them when they are not plain bounded data', () => {
    const tooDeep: Record<string, unknown> = {}; let cur = tooDeep;
    for (let i = 0; i < 20; i++) { const next: Record<string, unknown> = {}; cur.x = next; cur = next; }
    const p = parsePresentation(base({ agents: { groups: [{ bad: Number.NaN }] }, graphPasses: [tooDeep], motionMap: 'not an id!' }));
    const b = p?.sources[0]?.bundle;
    expect(b?.agents).toBeUndefined();
    expect(b?.graphPasses).toBeUndefined();
    expect(b?.motionMap).toBeUndefined();
  });
});
