/**
 * Pictures in the Grid scene builder (docs/grid-builder.md, "Textures"): a picture inside cells (a
 * picture shape), a picture as the pattern (brightness drives size, colour…), a picture mask, and
 * Build / Edit this one keeping the picture's node.
 */
import { describe, expect, it } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandaloneGrid } from '../build';
import { applyGridScene, findGridBuild } from '../apply';
import { gridProgram } from '../glsl';
import { PATTERN_TARGETS, emptyGridScene, newShape, placeCell, starterGridScene, texturesUsedGrid, type GridSceneSpec } from '../spec';
import { textureNodeFor } from '../../builders/textures';
import type { GraphNode } from '../../types/nodeGraph';

const PIC = { name: 'pond', node: 'pic1', aspect: 1.5 };

function compiles(spec: GridSceneSpec) {
  const g = buildStandaloneGrid(spec);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.success, String(r.errors)).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return { g, r };
}

function pictureCells(): GridSceneSpec {
  const s = emptyGridScene();
  s.textures = [{ ...PIC }];
  s.shapes = [newShape('A', { kind: 'circle' }), newShape('B', { kind: 'picture', tex: 'pond', spin: 0.2 })];
  for (let i = 0; i < 4; i++) { placeCell(s, i, 2, 'A'); placeCell(s, i, 4, 'B'); }
  return s;
}

describe('Grid scene: pictures', () => {
  it('a picture inside cells: the scene function writes the winning cell\'s place on its picture', () => {
    const s = pictureCells();
    const prog = gridProgram(s);
    expect(prog.picture).toBe(true);
    expect(prog.slots).toEqual(['pond']);
    expect(prog.functions).toContain('inout vec4 pic');
    expect(prog.functions).toMatch(/if \(k < 9\.5\) return gs_heart/);
    const { g, r } = compiles(s);
    expect(g.warnings).toEqual([]);
    const sample = g.nodes.find(n => n.type === 'sampleTexture')!;
    expect(sample.inputs.texture.connection).toEqual({ nodeId: 'pic1', outputKey: 'texture' });
    expect(Object.values(r.textureUniforms)).toEqual(['pic1']);
  });

  it('a scene without pictures keeps its code exactly', () => {
    const s = starterGridScene();
    const prog = gridProgram(s);
    expect(prog.functions).not.toContain('pic');
    expect(prog.functions).toContain('  return gs_heart');
  });

  it.each(PATTERN_TARGETS.map(t => [t] as const))('a picture pattern drives %s, and the fill', target => {
    const s = starterGridScene();
    s.textures = [{ ...PIC }];
    s.shapes.push(newShape('B', { kind: 'square' }));
    s.pattern = { ...s.pattern, kind: 'picture', tex: 'pond', target, amount: 0.8, fill: 'B' };
    const prog = gridProgram(s);
    expect(prog.patternPic).toBe(true);
    expect(prog.functions).toContain('(pb * 2.0 - 1.0)');
    expect(prog.functions).not.toContain('gs_wave');
    const { g } = compiles(s);
    const grid = g.nodes.find(n => n.id === g.gridId)!;
    const lum = g.nodes.find(n => n.params._gsRole === 'pic:pond:lum')!;
    expect(grid.inputs.pb.connection?.nodeId).toBe(lum.id);
  });

  it('a picture mask: shapes only in bright (or dark) cells', () => {
    const s = starterGridScene();
    s.textures = [{ ...PIC }];
    s.picMask = { tex: 'pond', cut: 0.3, invert: true };
    const { g } = compiles(s);
    const mask = g.nodes.find(n => n.params._gsRole === 'picmask')!;
    expect(mask.params.result).toBe('mix(1.0e3, d, 1.0 - step(cut, l))');
    const fill = g.nodes.find(n => n.params._gsRole === 'fill')!;
    expect(fill.inputs.d.connection?.nodeId).toBe(mask.id);
  });

  it('the pattern and the mask share one read of the same picture', () => {
    const s = pictureCells();
    s.pattern = { ...s.pattern, kind: 'picture', tex: 'pond' };
    s.picMask = { tex: 'pond', cut: 0.5, invert: false };
    const { g } = compiles(s);
    expect(g.nodes.filter(n => n.params._gsRole === 'pic:pond:lum')).toHaveLength(1);
    expect(texturesUsedGrid(s)).toEqual(['pond']);
  });

  it('warns about a picture the scene does not have', () => {
    const s = pictureCells();
    s.textures = [];
    expect(buildStandaloneGrid(s).warnings.join(' ')).toMatch(/“pond”/);
  });

  it('Build uses the picture\'s node; Edit this one reopens with it; a missing node is made', () => {
    let n = 0;
    const nextId = () => `node_${300 + n++}`;
    const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} };
    const res = applyGridScene([out, textureNodeFor(PIC, 'pic1')], pictureCells(), { nextId });
    expect(res.nodes.filter(x => x.type === 'textureInput')).toHaveLength(1);
    expect(compileGraph({ nodes: res.nodes }).success).toBe(true);
    const found = findGridBuild(res.nodes, res.sceneId)!;
    expect(found.meta.spec.textures).toEqual([PIC]);
    expect(found.meta.spec.shapes[1].tex).toBe('pond');
    const s = pictureCells();
    s.textures = [{ name: 'pond' }];
    const made = applyGridScene([out], s, { nextId });
    const tex = made.nodes.filter(x => x.type === 'textureInput');
    expect(tex).toHaveLength(1);
    expect(made.spec.textures![0].node).toBe(tex[0].id);
  });
});
