/**
 * recipe.ts — what a builder-made node says about itself, for the Recipe chip on its card
 * (components/builders/RecipeChip.tsx; docs/scene-builder.md, "The Recipe chip"):
 *
 *  - a Scene Group the 3D Scene Builder built: its recipe (printRecipe), and whether the graph was
 *    changed by hand since (the same check a rebuild makes, sceneBuilder/apply.ts checkEdits);
 *  - a Grid Rules node: the rule as text ("Life B3/S23 · 240×135 · wrap");
 *  - an Agents group in rules mode: a summary ("4 rules · 2 states") and its rules as sentences.
 *
 * A hand-made Scene Group (no spec on it) has none. Pure, plus a small highlighter for the chip.
 */
import type { GraphNode } from '../types/nodeGraph';
import { metaOf } from '../sceneBuilder/build';
import { checkEdits } from '../sceneBuilder/apply';
import { printRecipe } from '../sceneBuilder/recipe';
import { recipeRuns, recipeTokens } from '../sceneBuilder/highlight';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../gridRules/stencils';
import { COUNT_PRESETS, GRID_DEFAULTS, SMOOTH_PRESETS, STAGES_PRESETS, gridShape, matchingPreset, ruleSummary, type GridPreset } from '../gridRules/spec';
import { groupRules, isRulesGroup } from '../agentRules/apply';
import { printGrid } from '../lang/dialects/grid';
import { printAgents } from '../lang/dialects/agents';
import { describeRule, type AgentRuleSet } from '../agentRules/spec';

export type BuilderRecipe =
  | { kind: 'scene'; nodeId: string; text: string; lines: string; edited: boolean }
  /** `text`: the rule in the Playfield language (one line, pastes into the Do… bar); `summary`: "Life B3/S23 · 240×135 · wrap". */
  | { kind: 'grid'; nodeId: string; text: string; lines: string; summary: string }
  | { kind: 'agents'; nodeId: string; text: string; lines: string };

/** Did the user change a built scene's nodes since the build (a setting, a wire, a node added or deleted)? */
export function sceneEditedSinceBuild(graph: GraphNode[], sceneId: string): boolean {
  const scene = graph.find(nd => nd.id === sceneId);
  const meta = metaOf(scene);
  if (!meta?.built) return false;
  const r = checkEdits(graph, sceneId, meta.spec);
  return r.kept.length + r.lost.length > 0;
}

/** Cells across × down at 1080p for a board size (⅛ is 240 × 135). */
const boardCells = (scale: number) => `${Math.round(1920 * scale)}×${Math.round(1080 * scale)}`;

const TYPE_WORD: Record<string, string> = { count: 'Count', stages: 'Stages', smooth: 'Smooth', patterns: 'Patterns', blocks: 'Blocks' };

/** A Grid Rules node's rule in one line: "Life B3/S23 · 240×135 · wrap". */
export function gridRecipeText(params: Record<string, unknown>): string {
  const P = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(P);
  const table: Record<string, GridPreset> = s.type === 'stages' ? STAGES_PRESETS : s.type === 'smooth' ? SMOOTH_PRESETS : s.type === 'patterns' ? PATTERN_PRESETS : s.type === 'blocks' ? BLOCK_PRESETS : COUNT_PRESETS;
  const preset = matchingPreset(P);
  const summary = ruleSummary(P);
  const word = TYPE_WORD[s.type];
  // "Count B3/S23" → "Life B3/S23"; "Smooth · diffusion" → "Heat · Smooth · diffusion".
  const rule = !preset ? summary
    : summary.startsWith(`${word} `) && !summary.startsWith(`${word} ·`) ? `${table[preset].label}${summary.slice(word.length)}`
      : `${table[preset].label} · ${summary}`;
  return `${rule} · ${boardCells(s.scale)} · ${s.wrap ? 'wrap' : 'walls'}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A rules group in a few words: "4 rules · 2 states" (and the species when there are several). */
export function agentRulesSummary(set: AgentRuleSet): string {
  const rules = set.species.reduce((k, sp) => k + sp.rules.filter(r => !r.off).length, 0);
  const states = set.species.reduce((k, sp) => k + sp.states.length, 0);
  return [plural(rules, 'rule'), plural(states, 'state'), ...(set.species.length > 1 ? [plural(set.species.length, 'species').replace(/speciess$/, 'species')] : [])].join(' · ');
}

/** Every rule as a sentence, under its species' name when there are several. */
export function agentRulesLines(set: AgentRuleSet): string {
  const out: string[] = [];
  set.species.forEach((sp, i) => {
    if (set.species.length > 1) out.push(`${sp.name || `Species ${i + 1}`}:`);
    sp.rules.forEach(r => out.push(`${set.species.length > 1 ? '  ' : ''}${describeRule(set, i, r)}`));
    if (!sp.rules.length) out.push('(no rules yet)');
  });
  return out.join('\n');
}

/** The recipe a node's card shows, or null for a node no builder made. `graph` is the top level. */
export function builderRecipeOf(node: GraphNode, graph: GraphNode[]): BuilderRecipe | null {
  if (node.type === 'sceneGroup') {
    const meta = metaOf(node);
    if (!meta) return null;
    return { kind: 'scene', nodeId: node.id, text: printRecipe(meta.spec), lines: printRecipe(meta.spec, { pretty: true }), edited: sceneEditedSinceBuild(graph, node.id) };
  }
  if (node.type === 'gridRules') {
    return { kind: 'grid', nodeId: node.id, text: printGrid(node.params, { header: 'always' }), lines: printGrid(node.params, { header: 'always', pretty: true }), summary: gridRecipeText(node.params) };
  }
  if (isRulesGroup(node)) {
    const set = groupRules(node);
    // The rules in the Playfield language (lang/dialects/agents.ts): they paste into the Recipe tab.
    return { kind: 'agents', nodeId: node.id, text: agentRulesSummary(set), lines: printAgents(set, { pretty: true }) };
  }
  return null;
}

// ── Highlighting ────────────────────────────────────────────────────────────

export type RecipeTokenKind = 'mode' | 'op' | 'shape' | 'warp' | 'setting' | 'colour' | 'key' | 'number' | 'name' | 'punct' | 'plain';

const PLAIN_RE = /("[^"]*"|\s+|·|[(),=@:/→×]|-?\d*\.?\d+(?:e-?\d+)?|[A-Za-z_][\w-]*|.)/g;

/**
 * A recipe split into coloured runs, by the Scene Builder's own tokenizer (sceneBuilder/highlight.ts):
 * modes, combines, shapes, warps, settings, colours, keys, numbers. `words: false` (a Grid Rules
 * rule, agent rules) colours only numbers, names and marks.
 */
export function highlightRecipe(text: string, opts: { words?: boolean } = {}): Array<{ text: string; kind: RecipeTokenKind }> {
  if (opts.words !== false) {
    return recipeRuns(text, recipeTokens(text, [])).map(r => ({ text: r.text, kind: r.kind === 'vector' ? 'punct' : r.kind === 'comment' ? 'plain' : r.kind }));
  }
  const out: Array<{ text: string; kind: RecipeTokenKind }> = [];
  for (const t of text.match(PLAIN_RE) ?? []) {
    const kind: RecipeTokenKind = t.startsWith('"') ? 'name' : /^-?\d*\.?\d+/.test(t) ? 'number' : /^[(),=@:/→×·]$/.test(t) ? 'punct' : 'plain';
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === 'plain') last.text += t;
    else out.push({ text: t, kind });
  }
  return out;
}
