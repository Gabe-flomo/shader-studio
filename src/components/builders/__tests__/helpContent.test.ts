/**
 * Built-in guidance (components/builders/helpContent.ts): every builder section, rule type,
 * condition and action has help, driven by the registries they come from, and every example
 * inserts something valid.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { ACTION_HELP, BUILDER_HELP, CONDITION_HELP, helpFor } from '../helpContent';
import { BUILDER_TABS } from '../../../sceneBuilder/store';
import { parseRecipe } from '../../../sceneBuilder/recipe';
import { OUTPUTS, PALETTES } from '../../../sceneBuilder/output';
import { RULE_TYPES } from '../../../gridRules/spec';
import { GRID_VIEWS } from '../../../gridRules/glsl';
import { ACTION_KINDS, CONDITION_KINDS, defaultRuleSet, normalizeRuleSet } from '../../../agentRules/spec';
import { AGENT_VIEWS } from '../../../agentRules/outputs';
import { TIME_SEED, UV_SEED, WORLD_SEED } from '../../../exprBuilder/chain';
import { resolveTemplateSteps } from '../../../exprBuilder/examples';
import { previewGraph } from '../../../exprBuilder/block';
import { compileGraph } from '../../../compiler/graphCompiler';
import { MOVES_SCHEMA, type Catalogue } from '../../../exprBuilder/moves';

/** No moves: the examples' templates are made into moves on the spot. */
const emptyCatalogue: Catalogue = { schema: MOVES_SCHEMA, docs: [], moves: [], order: [] };

const ok = (id: string, builder: string) => {
  const h = helpFor(builder, id);
  expect(h, `${builder}: ${id}`).toBeTruthy();
  expect(h!.title.length).toBeGreaterThan(1);
  expect(h!.lines.length).toBeGreaterThan(0);
  for (const l of h!.lines) expect(l.length, `${builder}: ${id}`).toBeGreaterThan(20);
};

describe('builder help', () => {
  it('the Scene Builder: every tab, the tree, each output and palette described', () => {
    for (const t of BUILDER_TABS) ok(t, 'scene-builder');
    ok('tree', 'scene-builder');
    for (const o of OUTPUTS) { expect(o.blurb.length).toBeGreaterThan(10); expect(o.use.length).toBeGreaterThan(5); }
    expect(PALETTES.length).toBeGreaterThan(6);
  });

  it('Grid Rules: every rule type, Born/Survive, stencils, blocks and the shared sections', () => {
    for (const t of RULE_TYPES) ok(t.value, 'grid-rules');
    for (const id of ['born-survive', 'neighbourhood', 'states', 'presets', 'stencils', 'block-rules', 'run', 'brush', 'colours', 'output']) ok(id, 'grid-rules');
    for (const v of GRID_VIEWS) expect(v.hint.length).toBeGreaterThan(10);
  });

  it('Agent Rules: the rules, the empty list, every condition and action', () => {
    for (const id of ['rules', 'empty-rules', 'when', 'do', 'stop', 'species', 'states', 'channels', 'masks', 'sensing', 'output']) ok(id, 'agent-rules');
    for (const k of CONDITION_KINDS) expect(CONDITION_HELP[k.kind]?.hint, k.kind).toBeTruthy();
    for (const k of ACTION_KINDS) expect(ACTION_HELP[k.kind]?.hint, k.kind).toBeTruthy();
    for (const v of AGENT_VIEWS) expect(v.hint.length).toBeGreaterThan(5);
    // The Agent Rules example in the brief, word for word.
    expect(helpFor('agent-rules', 'rules')!.lines.join(' ')).toMatch(/When is the condition checked every step for each walker, e\.g\. Food trail ahead > 0\.3/);
  });

  it('the Expression Builder: every section, with the worked example', () => {
    for (const id of ['seed', 'chain', 'empty-chain', 'moves', 'same', 'changing', 'recipes', 'holes', 'preview', 'output', 'code']) ok(id, 'expr-builder');
    expect(helpFor('expr-builder', 'chain')!.lines.join(' ')).toMatch(/UV → Repeat .* → Centre .* → Circle .*: a grid of dots/);
  });

  it('every example inserts something valid', () => {
    for (const [builder, entries] of Object.entries(BUILDER_HELP)) {
      for (const [id, h] of Object.entries(entries)) {
        for (const ex of h.examples ?? []) {
          if ('recipe' in ex.insert) expect(parseRecipe(`sphere · ${ex.insert.recipe}`).errors, `${builder}/${id}: ${ex.label}`).toEqual([]);
          if ('rule' in ex.insert) {
            const set = defaultRuleSet();
            set.species[0].rules.push(ex.insert.rule);
            expect(normalizeRuleSet(set).species[0].rules.length).toBe(2);
          }
          if ('patch' in ex.insert) expect(Object.keys(ex.insert.patch).length).toBeGreaterThan(0);
          if ('chain' in ex.insert) {
            const seed = ex.insert.chain.seed === 'uv' ? UV_SEED : ex.insert.chain.seed === 'time' ? TIME_SEED : WORLD_SEED;
            const steps = resolveTemplateSteps(ex.insert.chain.steps, seed, emptyCatalogue);
            expect(steps.length, `${builder}/${id}: ${ex.label}`).toBe(ex.insert.chain.steps.length);
            expect(compileGraph({ nodes: previewGraph({ seed, steps }).nodes }).success).toBe(true);
          }
        }
      }
    }
  });
});
