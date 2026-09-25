/**
 * The Layers node: the Play layers as a texture and a distance field. It
 * declares its uniforms once however many Layers nodes there are, and its
 * Distance output feeds SDF Glow like any SDF.
 */
import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';

describe('Layers node', () => {
  it('compiles the Particle Glow example, with its uniforms declared once', () => {
    const r = compileGraph({ nodes: EXAMPLE_GRAPHS.particleGlow.nodes });
    expect(r.errors ?? []).toEqual([]);
    const fs = r.fragmentShader;
    expect(fs.match(/uniform sampler2D u_layers;/g)?.length).toBe(1);
    expect(fs.match(/uniform sampler2D u_layersField;/g)?.length).toBe(1);
    expect(fs).toMatch(/float \w+_distance = ssl_distance\(/);
    // SDF Glow reads the layers' distance.
    expect(fs).toMatch(/exp\(-clamp\([^)]*\) \* \w+_distance\)/);
  });

  it('two Layers nodes share one set of uniforms', () => {
    const nodes = EXAMPLE_GRAPHS.particleGlow.nodes;
    const second = { ...nodes.find(n => n.id === 'layers')!, id: 'layers2' };
    const r = compileGraph({ nodes: [...nodes, second] });
    expect(r.fragmentShader.match(/uniform sampler2D u_layers;/g)?.length).toBe(1);
  });
});
