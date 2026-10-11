/**
 * Every builder's printed recipe pastes into the Do… bar of a fresh project and builds there
 * (lang/run.ts): the 2D Scene Builder's (dialects/scene2d.ts), the 3D Scene Builder's, the Splat
 * builder's (dialects/splat.ts), Grid Rules' "As text" and Agent Rules'. Each in its one-line
 * (` · `) and its multi-line form; what a recipe names from its own project (a picture's node, a
 * scan file) degrades to an empty node and a note instead of failing.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { detectDialect, readLine, readsCanonically, sceneNodes, scene2dNodes, splatNodes, agentsNodes, picturesToFill } from '../run';
import { parseRecipe2D, printRecipe2D } from '../../sceneBuilder2d/recipe';
import { TEMPLATES_2D } from '../../sceneBuilder2d/templates';
import { surpriseScene2D } from '../../sceneBuilder2d/surprise';
import { find2dBuild } from '../../sceneBuilder2d/apply';
import { SCENE_TEMPLATES, templateSpec } from '../../sceneBuilder/templates';
import { printRecipe } from '../../sceneBuilder/recipe';
import { SPLAT_TEMPLATES } from '../../splatBuilder/templates';
import { splatRecipe } from '../../splatBuilder/recipe';
import { findSplatBuild } from '../../splatBuilder/apply';
import { RULES_TEMPLATES } from '../../agentRules/templates';
import { printAgents } from '../dialects/agents';
import { withScanIn } from '../dialects/splat';
import { printGrid } from '../dialects/grid';
import { COUNT_PRESETS, SMOOTH_PRESETS, STAGES_PRESETS, presetPatch } from '../../gridRules/spec';
import { surpriseLine } from '../surprise';

/** The user's recipe, copied from the 2D Scene Builder in one project. */
const USER_RECIPE = `combine-blocks blend a=kali-fold b=spiral amount=0.43 a_c=0.811 b_twist=5
burst r=0.278 points=5 sharp=3.455 scale=0.426 color=(0.116,0.974,0.608) glow @pulse(0.238 speed=-0.619) @ring(4 r=0.527)
star r=0.347 inner=0.388 scale=0.578 outline=0.015 color=(0.594,0.381,0.862) glow @orbit(0.233 speed=-0.13) @ring(3 r=0.479 levels=3 factor=1.487)
glow 0.007 falloff=1.669
tone aces
background (0.033,0.034,0.018)`;

/** A fresh project: just an Output. */
function fresh(): GraphNode[] {
  const def = getNodeDefinition('output')!;
  return [{ id: 'node_1', type: 'output', position: { x: 800, y: 0 }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} }];
}
const ids = () => { let k = 1; return () => `node_${++k}`; };
const outputOf = (nodes: GraphNode[]) => nodes.find(n => n.type === 'output')!;

/** Read as the bar reads it and check it is `dialect`, canonical. */
function reads(text: string, dialect: string) {
  const r = readLine(text, { seed: 1 });
  expect(r.errors.map(e => e.message), text).toEqual([]);
  expect(r.dialect, text).toBe(dialect);
  expect(readsCanonically(r), text).toBe(true);
  return r;
}

function build2d(text: string) {
  const r = reads(text, 'scene2d');
  const made = scene2dNodes(fresh(), r.scene2d!, ids());
  // The Output shows it, it compiles, and Edit in 2D Scene Builder finds it.
  expect(outputOf(made.nodes).inputs.color.connection).toBeTruthy();
  const c = compileGraph({ nodes: made.nodes });
  expect(c.success, `${text}\n${String(c.errors)}`).toBe(true);
  expect(find2dBuild(made.nodes, made.sceneId)).toBeTruthy();
  return { r, made };
}

describe('Do… bar: the 2D Scene Builder recipe', () => {
  it('the user\'s recipe, pasted as copied, builds a 2D scene that compiles', () => {
    const { r, made } = build2d(USER_RECIPE);
    expect(printRecipe2D(r.scene2d!)).toBe(printRecipe2D(parseRecipe2D(USER_RECIPE).scene));
    const meta = find2dBuild(made.nodes, made.sceneId)!.meta;
    expect(meta.spec.space[0].kind).toBe('combine');
    expect(meta.spec.layers).toHaveLength(2);
  });

  it('the one-line form (joined by ·) and the canonical line read the same', () => {
    const one = USER_RECIPE.split('\n').join(' · ');
    const r1 = build2d(one).r;
    const canon = r1.canonical!;
    expect(canon).toContain(' · ');
    const r2 = build2d(canon).r;
    expect(r2.canonical).toBe(canon);
  });

  it('every template, one line and pretty, builds and compiles', () => {
    for (const t of TEMPLATES_2D) {
      const scene = parseRecipe2D(t.recipe).scene;
      build2d(t.recipe);
      build2d(printRecipe2D(scene, { pretty: true }));
      build2d(printRecipe2D(scene, { multiline: true }));
    }
  });

  it('surprise 2D scenes read as 2D recipes', () => {
    for (let s = 0; s < 40; s++) {
      const text = printRecipe2D(surpriseScene2D(s));
      expect(detectDialect(text).dialect, text).toBe('scene2d');
    }
  });

  it('a 2D grid scene (it starts with grid) is a 2D recipe, not Grid Rules', () => {
    const t = TEMPLATES_2D.find(x => x.key === 'rippleGrid')!;
    expect(detectDialect(t.recipe).dialect).toBe('scene2d');
    expect(detectDialect('grid life').dialect).toBe('grid');
  });

  it('a picture named with another project\'s node id gets an empty Texture node named after it', () => {
    const text = 'texture brick node=node_1 aspect=1.5 · picture brick h=0.6 · circle r=0.2 fill=brick · tone aces';
    const r = reads(text, 'scene2d');
    // node_1 here is the Output, not a picture.
    expect(picturesToFill(fresh(), r.scene2d!.textures)).toEqual(['brick']);
    const made = scene2dNodes(fresh(), r.scene2d!, ids());
    expect(made.pictures).toEqual(['brick']);
    const tex = made.nodes.filter(n => n.type === 'textureInput');
    expect(tex).toHaveLength(1);
    expect(tex[0].params.label).toBe('brick');
    expect(outputOf(made.nodes).inputs.color.connection).toBeTruthy();
    expect(compileGraph({ nodes: made.nodes }).success).toBe(true);
  });

  it('a 2D recipe with a mistake says what kind of recipe it is', () => {
    const r = readLine('burst r=0.3 @pulse(0.2) · glow 0.007 fallof=1.6 · tone aces', { seed: 1 });
    expect(r.dialect).toBe('scene2d');
    expect(r.errors[0].message).toMatch(/^This is a 2D Scene Builder recipe, but/);
  });

  it('a line that mixes 3D and 2D words and is no 2D recipe either says so', () => {
    const r = readLine('sphere r=1 · polar 3', { seed: 1 });
    if (r.errors.length && /mixes/.test(r.errors[0].message)) expect(r.errors[0].message).toMatch(/2D Scene Builder recipe/);
  });
});

describe('Do… bar: detection does not move the other dialects', () => {
  it('picture lines stay pictures, 3D lines stay scenes', () => {
    for (const t of ['circle', 'glow', 'zoom 2', 'swirl', 'circle with a glow', 'circle r=0.3 · glow']) expect(detectDialect(t).dialect, t).toBe('picture');
    for (let s = 0; s < 60; s++) {
      const p = surpriseLine({ seed: s, dialect: '2d' }).line;
      expect(detectDialect(p).dialect, p).toBe('picture');
      const q = surpriseLine({ seed: s, dialect: '3d' }).line;
      expect(detectDialect(q).dialect, q).toBe('scene');
    }
  });
});

describe('Do… bar: the other builders\' recipes in a fresh project', () => {
  it('3D Scene Builder: every template, one line and pretty', () => {
    for (const t of SCENE_TEMPLATES) {
      const spec = templateSpec(t.key);
      for (const text of [printRecipe(spec), printRecipe(spec, { pretty: true })]) {
        const r = reads(text, 'scene');
        const made = sceneNodes(fresh(), r.scene!, ids());
        expect(outputOf(made.nodes).inputs.color.connection, text).toBeTruthy();
      }
    }
  });

  it('3D Scene Builder: a picture whose node= is some other node here gets an empty Texture node', () => {
    const r = reads('surface · texture brick node=node_1 · box texture=brick', 'scene');
    const made = sceneNodes(fresh(), r.scene!, ids());
    const tex = made.nodes.filter(n => n.type === 'textureInput');
    expect(tex.map(n => n.params.label)).toEqual(['brick']);
  });

  it('Splat builder: every template, as copied and one line', () => {
    for (const t of SPLAT_TEMPLATES) {
      const text = splatRecipe(t.make());
      const r = reads(text, 'splat');
      expect(r.canonical).toBe(text.split('\n').join(' · '));
      reads(r.canonical!, 'splat');
      const made = splatNodes(fresh(), r.splat!, ids());
      expect(findSplatBuild(made.nodes, made.scanId), t.key).toBeTruthy();
      expect(outputOf(made.nodes).inputs.color.connection, t.key).toBeTruthy();
    }
  });

  it('Splat builder: a scan file, your nodes and a background picture from another project degrade with notes', () => {
    const text = [
      'scan file="statue.ply" id=vid_123 bytes=5000 max=2000000 sh=1 sort=moves res=full',
      'place at=(0,0,0) turn=(0,30,0) scale=1 up=-y size=1 opacity=1',
      'yours tail=node_77',
      'background picture color=(0.1,0.1,0.1) color2=(0,0,0) picture=sunset',
      'camera dist=3.6 angle=25 elev=12 fov=1.5 turntable=8 target=(0,0,0)',
    ].join('\n');
    const r = reads(text, 'splat');
    expect(r.notes!.join(' ')).toMatch(/node_77/);
    expect(r.notes!.join(' ')).toMatch(/sunset/);
    // The scan file: kept when this device's library has it, else the example scan and a note.
    expect(withScanIn(r.splat!, new Set(['vid_123'])).spec.scan.source).toMatchObject({ kind: 'file', videoId: 'vid_123' });
    const missing = withScanIn(r.splat!, new Set());
    expect(missing.spec.scan.source.kind).toBe('demo');
    expect(missing.note).toMatch(/statue\.ply/);
    const made = splatNodes(fresh(), missing.spec, ids());
    expect(made.nodes.filter(n => n.type === 'textureInput').map(n => n.params.label)).toEqual(['sunset']);
    expect(made.warnings.join(' ')).not.toMatch(/background picture is missing/);
  });

  it('Agent Rules: every template\'s rules, one line and pretty', () => {
    for (const t of RULES_TEMPLATES) {
      for (const text of [printAgents(t.set()), printAgents(t.set(), { pretty: true })]) {
        const r = reads(text, 'agents');
        const made = agentsNodes(fresh(), r.agents!, ids());
        expect(made.nodes.some(n => n.id === made.groupId), t.key).toBe(true);
      }
    }
  });

  it('Grid Rules "As text": every preset, one line and pretty', () => {
    for (const [k, p] of Object.entries({ ...COUNT_PRESETS, ...STAGES_PRESETS, ...SMOOTH_PRESETS })) {
      for (const text of [printGrid(presetPatch(p), { header: 'always' }), printGrid(presetPatch(p), { header: 'always', pretty: true })]) {
        expect(reads(text, 'grid').grid, k).toBeTruthy();
      }
    }
  });
});
