/**
 * Pieces (2D) and Balls (3D) are hidden, not deleted (nodes/notOffered.ts, docs/pieces.md "Hidden"):
 * nothing offers them, and graphs, scenes and recipes that already use them still load, build and compile.
 */
import { describe, expect, it } from 'vitest';
import { NOT_OFFERED, OFFER_PIECES, PIECES_TYPES, RETIRED_TYPES } from '../notOffered';
import { getNodeDefinition, getOfferedDefinitions } from '../definitions';
import { switchFamiliesFor } from '../switchNode';
import { HIDDEN_TYPES } from '../../components/NodeGraph/nodeCategoryMeta';
import { HIDDEN_NODES, nodesOfRow, CATEGORY_ORDER } from '../../components/NodeGraph/libraryRows';
import { creatable } from '../../lang/barAssist';
import { STARTER_RECIPES } from '../recipes';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX, HIDDEN_EXAMPLE_KEYS } from '../../store/exampleIndex';
import { PIECES_EXAMPLE_KEYS } from '../../store/piecesExampleIndex';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { compileGraph } from '../../compiler/graphCompiler';
import { TEMPLATES_2D, templateScene } from '../../sceneBuilder2d/templates';
import { RECIPE_VOCABULARY_2D, parseRecipe2D } from '../../sceneBuilder2d/recipe';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { SCENE_TEMPLATES, templateSpec } from '../../sceneBuilder/templates';
import { SHAPES } from '../../sceneBuilder/spec';
import { RECIPE_VOCABULARY, parseRecipe } from '../../sceneBuilder/recipe';
import { OFFERED_GALLERY_SHAPES } from '../../sceneBuilder/thumbnails';
import { buildStandaloneGraph } from '../../sceneBuilder/build';

describe('Pieces and Balls: hidden, not deleted', () => {
  it('is the shipped setting (one flag brings them back)', () => {
    expect(OFFER_PIECES).toBe(false);
    expect([...NOT_OFFERED].sort()).toEqual([...PIECES_TYPES, ...RETIRED_TYPES].sort());
  });

  it('are still registered, so saved graphs load', () => {
    for (const t of PIECES_TYPES) expect(getNodeDefinition(t), t).toBeTruthy();
    for (const t of PIECES_TYPES) expect(getNodeDefinition(t)!.deprecated, t).toBeFalsy(); // no DEPRECATED badge on old cards
  });

  it('aren\'t offered by the node browser, search, the Do bar, Switch to or starter recipes', () => {
    const offered = new Set(getOfferedDefinitions().map(d => d.type));
    const rows = new Set(CATEGORY_ORDER.flatMap(r => nodesOfRow(r).map(d => d.type)));
    const bar = new Set(creatable(new Set()).flatMap(c => c.words ?? []));
    for (const t of PIECES_TYPES) {
      expect(offered.has(t), t).toBe(false);
      expect(rows.has(t), t).toBe(false);
      expect(HIDDEN_TYPES.has(t) && HIDDEN_NODES.has(t), t).toBe(true);
      expect(bar.has(t), t).toBe(false);
      expect(STARTER_RECIPES[t], t).toBeUndefined();
      expect(switchFamiliesFor(t)).toEqual([]);
    }
    for (const f of switchFamiliesFor('gridPattern')) for (const t of PIECES_TYPES) expect(f.types).not.toContain(t);
  });

  it('their examples are in no folder but still open and compile', () => {
    const filed = EXAMPLE_FOLDERS.flatMap(f => f.keys);
    expect(EXAMPLE_FOLDERS.map(f => f.label)).not.toContain('Pictures in pieces');
    expect([...HIDDEN_EXAMPLE_KEYS]).toEqual(PIECES_EXAMPLE_KEYS);
    for (const k of PIECES_EXAMPLE_KEYS) {
      expect(filed, k).not.toContain(k);
      expect(EXAMPLE_INDEX[k], k).toBeTruthy();
      const r = compileGraph({ nodes: EXAMPLE_GRAPHS[k].nodes });
      expect(r.errors ?? [], k).toEqual([]);
    }
  });

  it('the builders don\'t offer them, and still build old specs that have them', () => {
    expect(TEMPLATES_2D.filter(t => !t.hidden).map(t => t.key)).not.toContain('pieces');
    expect(SCENE_TEMPLATES.filter(t => !t.hidden).map(t => t.key)).not.toContain('balls');
    expect(SHAPES.filter(s => !s.hidden).map(s => s.kind)).not.toContain('picture-balls');
    expect(OFFERED_GALLERY_SHAPES.map(g => g.kind)).not.toContain('picture-balls');
    expect(RECIPE_VOCABULARY.shapes.map(s => s.kind)).not.toContain('picture-balls');
    expect(RECIPE_VOCABULARY_2D.pieces).toEqual([]);

    // Old 2D scene with a Picture in pieces: still reads and builds a Pieces node that compiles.
    const old2d = parseRecipe2D('texture pond · circle r=0.2 · pieces pond count=24 move=noise');
    expect(old2d.errors).toEqual([]);
    const b2 = buildStandalone2D(old2d.scene);
    expect(b2.nodes.some(n => n.type === 'pieces')).toBe(true);
    expect(compileGraph({ nodes: b2.nodes }).errors ?? []).toEqual([]);
    expect(templateScene('pieces').pieces).toBeTruthy();

    // Old 3D spec with Picture balls (the template, and the recipe word): still builds.
    const old3d = parseRecipe('surface · texture picture · picture-balls across=21 texture=picture');
    expect(old3d.errors).toEqual([]);
    for (const spec of [old3d.spec, templateSpec('balls')]) {
      const g = buildStandaloneGraph(spec);
      const all = JSON.stringify(g.nodes);
      expect(all).toContain('"pieceBalls"');
      expect(compileGraph({ nodes: g.nodes }).errors ?? []).toEqual([]);
    }
  });
});
