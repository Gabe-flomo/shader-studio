/**
 * Pieces in the builders (docs/pieces.md): the 2D Scene Builder's "Picture in pieces" and the 3D Scene
 * Builder's "Picture as balls" template build graphs that compile, and read back from their recipes.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { buildStandalone2D } from '../build';
import { templateScene } from '../templates';
import { canonicalScene } from '../spec';
import { templateSpec } from '../../sceneBuilder/templates';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

describe('2D Scene Builder: Picture in pieces', () => {
  const recipe = 'texture pond aspect=1.5 · circle r=0.2 color=cyan · pieces pond count=30 shape=hexagon colour=piece size-by=brightness move=flow amount=0.5 speed=0.2 swirl=1.2';

  it('reads every setting and prints it back the same', () => {
    const r = parseRecipe2D(recipe);
    expect(r.errors).toEqual([]);
    expect(r.scene.pieces).toEqual({ tex: 'pond', shape: 'hexagon', count: 30, size: 1, colour: 'piece', sizeBy: 'brightness', move: 'flow', amount: 0.5, speed: 0.2, swirl: 1.2 });
    const again = parseRecipe2D(printRecipe2D(r.scene));
    expect(canonicalScene(again.scene)).toEqual(canonicalScene(r.scene));
  });

  it.each(['noise', 'flow', 'mouse', 'none'])('builds a Pieces node over the layers that compiles (move=%s)', move => {
    const { scene } = parseRecipe2D(recipe.replace('move=flow', `move=${move}`));
    const built = buildStandalone2D(scene);
    const pieces = built.nodes.find(n => n.type === 'pieces')!;
    expect(pieces.inputs.picture.connection).toBeTruthy();
    expect(pieces.inputs.background.connection).toBeTruthy(); // the layers behind
    expect(!!pieces.inputs.offset.connection).toBe(move !== 'none');
    expect(pieces.params.aspect).toBe(1.5);
    const r = compileGraph({ nodes: built.nodes });
    expect(r.errors ?? []).toEqual([]);
  });

  it('the template builds, compiles and round-trips', () => {
    const scene = templateScene('pieces');
    expect(scene.pieces?.tex).toBe('picture');
    const r = compileGraph({ nodes: buildStandalone2D(scene).nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(canonicalScene(parseRecipe2D(printRecipe2D(scene)).scene)).toEqual(canonicalScene(scene));
  });
});

describe('3D Scene Builder: Picture as balls', () => {
  it('the template builds and compiles, the picture reaching the balls through group ports', () => {
    const spec = templateSpec('balls');
    const built = buildStandaloneGraph(spec);
    expect(built.warnings).toEqual([]);
    const r = compileGraph({ nodes: built.nodes });
    expect(r.errors ?? []).toEqual([]);
    const scene = built.nodes.find(n => n.type === 'sceneGroup')!;
    const port = (scene.params.subgraph as SubgraphData).inputPorts.find(p => p.type === 'texture')!;
    expect(port).toBeTruthy();
    expect(scene.inputs[port.key].connection).toBeTruthy();
    const ballsIn = (scene.params.subgraph as SubgraphData).nodes.find((n: GraphNode) => n.type === 'pieceBalls')!;
    expect(ballsIn.params.layout).toBe('own');
    // The colour: a Balls at the hit point, reading the picture.
    expect(built.nodes.some(n => n.type === 'pieceBalls' && n.inputs.picture.connection)).toBe(true);
    expect(r.fragmentShader).toMatch(/float mapScene_[\s\S]*textureLod\(u_tex_/);
  });

  it('round-trips through its recipe', () => {
    const spec = templateSpec('balls');
    const again = parseRecipe(printRecipe(spec)).spec;
    expect(printRecipe(again)).toBe(printRecipe(spec));
    const balls = again.root.children.find(c => c.type === 'shape' && c.kind === 'picture-balls');
    expect(balls && balls.type === 'shape' && balls.tex?.tex).toBe('picture');
  });
});

describe('Scatter in the builders', () => {
  it('2D: scatter, seed, scatter-turn, scatter-size and dim read, print back and build (Scatter on the Pace\'s LFO)', () => {
    const recipe = 'texture pond aspect=1.5 · pieces pond count=90 shape=ball move=none scatter=0.05 seed=4 scatter-turn=30 scatter-size=0.2 dim=0.1';
    const r = parseRecipe2D(recipe);
    expect(r.errors).toEqual([]);
    expect(r.scene.pieces).toMatchObject({ shape: 'ball', move: 'none', scatter: 0.05, seed: 4, scatterTurn: 30, scatterSize: 0.2, dim: 0.1 });
    expect(canonicalScene(parseRecipe2D(printRecipe2D(r.scene)).scene)).toEqual(canonicalScene(r.scene));
    const built = buildStandalone2D(r.scene);
    const pieces = built.nodes.find(n => n.type === 'pieces')!;
    expect(pieces.params).toMatchObject({ scatter: 0.05, seed: 4, scatterTurn: 30, scatterSize: 0.2, dimFloor: 0.1 });
    expect(pieces.inputs.scatter.connection).toBeTruthy(); // Scatter × the eased LFO
    expect(pieces.inputs.offset.connection).toBeFalsy();
    const c = compileGraph({ nodes: built.nodes });
    expect(c.errors ?? []).toEqual([]);
  });

  it('2D: an older recipe without them builds with no scatter at all', () => {
    const { scene } = parseRecipe2D('texture pond · pieces pond move=noise');
    const pieces = buildStandalone2D(scene).nodes.find(n => n.type === 'pieces')!;
    expect(pieces.params).toMatchObject({ shape: 'circle', scatter: 0, scatterSize: 0, scatterTurn: 0, dimFloor: 0 });
    expect(pieces.inputs.scatter.connection).toBeFalsy();
  });

  it('3D: picture-balls scatter, depth-scatter, twist and instability round-trip and reach both Balls (scene and colour)', () => {
    const spec = parseRecipe([
      'surface', 'texture picture',
      'picture-balls width=4 across=51 lift=0.5 ball=0.92 scatter=0.02 depth-scatter=0.5 twist=10 instability=0.01 texture=picture name=Picture',
      'camera dist=3.1 angle=0 elev=8',
    ].join('\n')).spec;
    expect(printRecipe(parseRecipe(printRecipe(spec)).spec)).toBe(printRecipe(spec));
    expect(printRecipe(spec)).toMatch(/depth-scatter=0\.5/);
    const built = buildStandaloneGraph(spec);
    const all = (nodes: GraphNode[]): GraphNode[] => nodes.flatMap(n => [n, ...((n.params.subgraph as SubgraphData | undefined)?.nodes ? all((n.params.subgraph as SubgraphData).nodes) : [])]);
    const balls = all(built.nodes).filter(n => n.type === 'pieceBalls');
    expect(balls.length).toBe(2);
    for (const b of balls) expect(b.params).toMatchObject({ scatter: 0.02, scatterDepth: 0.5, twist: 10, instability: 0.01 });
    const r = compileGraph({ nodes: built.nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/pieces_rand4/);
  });
});
