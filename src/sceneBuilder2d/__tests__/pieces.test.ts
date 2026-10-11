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
