/**
 * run.ts — one place that reads a line of the Playfield language (docs/playfield-language-plan.md
 * §8.9): which dialect it is, what it says (canonical text, mistakes, hints, what `random` drew)
 * and what running it does.
 *
 * Choosing the dialect (§4.0): a header decides (`grid`, `agents` / `species`, a render mode for
 * a 3D scene); otherwise a line with a 3D-only word (a 3D shape, a scene setting, an `@` warp) is
 * a scene, and anything else is a 2D picture or an edit on the graph. A line that mixes 3D-only
 * and 2D-only words is refused (§13 decision 8).
 *
 * Running (pure here; the Do… bar applies the result as one undo step):
 *  - picture / edit: the bar's sentence (picture.ts desugarPicture) through execCommand;
 *  - grid: a Grid Rules node with the params (the bar's own gridRules step);
 *  - scene: a new 3D scene from the spec (sceneBuilder/apply.ts applyScene);
 *  - agents: a new Agents group in rules mode with the rule set.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { Diagnostic } from './ast';
import type { Resolved } from './random';
import { lex } from './lex';
import { lineCol } from './lex';
import { parsePicture, printPicture, toSentence, type PClause } from './dialects/picture';
import { GRID_PRESET_NAMES, RULE_TYPE_WORDS, parseGrid, printGrid } from './dialects/grid';
import { parseAgents, printAgents } from './dialects/agents';
import { parseRecipe, printRecipe } from '../sceneBuilder/recipe';
import type { SceneSpec } from '../sceneBuilder/spec';
import type { AgentRuleSet } from '../agentRules/spec';
import { lookupHead, entriesFor } from './registry';
import { SHAPES as WORD_SHAPES } from './vocabulary';
import { applyScene } from '../sceneBuilder/apply';
import { rulesStarter } from '../agentRules/starter';
import { applyRulesToGroup } from '../agentRules/apply';
import { rulesGroupNote } from '../agentRules/generate';
import { freshIds, placeInFreeSpace } from '../store/agentSetup';
import { graphOutput } from '../nodes/scene3dDefaults';
import type { DoPlan } from '../suggestions/doBar';

export type Dialect = 'picture' | 'scene' | 'grid' | 'agents';

export interface LineRead {
  dialect: Dialect;
  /** The line in its canonical form (null when it doesn't read). */
  canonical: string | null;
  errors: Diagnostic[];
  hints: Diagnostic[];
  resolved: Resolved[];
  seed?: number;
  picture?: { clauses: PClause[]; sentence: string | null; why?: string };
  scene?: SceneSpec;
  grid?: Record<string, unknown>;
  agents?: AgentRuleSet;
}

const SCENE_MODES = new Set(['surface', 'volumetric', 'glass', 'gi', 'lit', 'solid', 'volume', 'glassy', 'gi-lit']);
const SCENE_SETTINGS = new Set(['camera', 'cam', 'fog', 'sun', 'sky', 'shadows', 'shadow', 'ao', 'occlusion', 'background', 'bg', 'tone', 'quality']);

/** Words only the 3D scene has: 3D shapes (with no 2D node) and the scene's settings. */
function sceneOnly(w: string): boolean {
  if (SCENE_SETTINGS.has(w)) return true;
  const shape = WORD_SHAPES.find(s => s.words.includes(w));
  if (shape) return !shape.node2d;
  const e = lookupHead(w, 'scene', ['maker']);
  return !!e && !lookupHead(w, 'picture', ['maker', 'step']);
}

/** Words only the 2D picture has: 2D-only shapes and picture steps that are no scene warp. */
function pictureOnly(w: string): boolean {
  const shape = WORD_SHAPES.find(s => s.words.includes(w));
  if (shape) return !shape.node3d && !shape.sceneKind;
  const step = lookupHead(w, 'picture', ['step']);
  return !!step && !lookupHead(w, 'scene', ['step']) && !['mirror', 'repeat', 'twist', 'warp'].includes(w);
}

/** The words that start each clause (and every word, for the 3D test). */
function clauseHeads(text: string): { heads: string[]; words: string[]; at: number[] } {
  const toks = lex(text).toks;
  const heads: string[] = [], at: number[] = [];
  const words: string[] = [];
  let start = true;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'sep') { start = true; continue; }
    if (t.t === 'word') {
      const w = t.v.toLowerCase();
      if (toks[i - 1]?.t !== '=' && toks[i + 1]?.t !== '=') words.push(w);
      if (start && w !== 'random' && w !== 'seed') { heads.push(w); at.push(t.at); start = false; }
    } else if (start && t.t !== 'eof') start = false;
  }
  return { heads, words, at };
}

/** Which dialect a Do… bar line is in, or why it can't be read as one. */
export function detectDialect(text: string): { dialect: Dialect; mixed?: { a: string; b: string; at: number } } {
  const { heads, words } = clauseHeads(text);
  const first = heads[0] ?? '';
  if (first === 'grid') return { dialect: 'grid' };
  if (first === 'agents' || first === 'species') return { dialect: 'agents' };
  if (SCENE_MODES.has(first)) return { dialect: 'scene' };
  if ((GRID_PRESET_NAMES.some(p => p.slug === first) || (RULE_TYPE_WORDS as readonly string[]).includes(first)) && !lookupHead(first, 'picture') && !WORD_SHAPES.some(s => s.words.includes(first))) return { dialect: 'grid' };
  const d3 = words.find(sceneOnly) ?? (/@[A-Za-z]/.test(text) ? '@' : undefined);
  if (d3) {
    const d2 = words.find(pictureOnly);
    if (d2) {
      const at = text.toLowerCase().indexOf(d2);
      return { dialect: 'scene', mixed: { a: d3, b: d2, at: Math.max(0, at) } };
    }
    return { dialect: 'scene' };
  }
  return { dialect: 'picture' };
}

/** Read a line in whatever dialect it is in. */
export function readLine(text: string, opts: { seed?: number } = {}): LineRead {
  const det = detectDialect(text);
  if (det.mixed) {
    const { line, col } = lineCol(text, det.mixed.at);
    return {
      dialect: det.dialect, canonical: null, hints: [], resolved: [],
      errors: [{ message: `This line mixes a 3D scene (“${det.mixed.a}”) and a 2D picture (“${det.mixed.b}”). One line is one or the other: put each on its own line.`, at: det.mixed.at, end: det.mixed.at + det.mixed.b.length, line, col, severity: 'error' }],
    };
  }
  switch (det.dialect) {
    case 'grid': {
      const r = parseGrid(text, { seed: opts.seed });
      return { dialect: 'grid', canonical: r.errors.length ? null : printGrid(r.params, { header: 'always' }), errors: r.errors, hints: r.hints, resolved: r.resolved, seed: r.seed, grid: r.params };
    }
    case 'agents': {
      const r = parseAgents(text, { seed: opts.seed });
      return { dialect: 'agents', canonical: r.errors.length ? null : printAgents(r.set), errors: r.errors, hints: r.hints, resolved: r.resolved, seed: r.seed, agents: r.set };
    }
    case 'scene': {
      const r = parseRecipe(text, { seed: opts.seed });
      const errors: Diagnostic[] = r.errors.map(e => ({ message: e.message, at: e.from, end: e.to, line: e.line, col: e.col, severity: 'error' }));
      const hints: Diagnostic[] = (r.hints ?? []).map(e => ({ message: e.message, at: e.from, end: e.to, line: e.line, col: e.col, severity: 'hint', fixes: [e.fix] }));
      return { dialect: 'scene', canonical: errors.length ? null : printRecipe(r.spec), errors, hints, resolved: r.resolved ?? [], seed: r.seed, scene: r.spec };
    }
    default: {
      const r = parsePicture(text, { seed: opts.seed });
      const s = r.errors.length ? null : toSentence(r.clauses);
      return {
        dialect: 'picture', canonical: r.errors.length ? null : printPicture(r.clauses), errors: r.errors, hints: r.hints, resolved: r.resolved, seed: r.seed,
        picture: { clauses: r.clauses, sentence: s && 'sentence' in s ? s.sentence : null, ...(s && 'error' in s ? { why: s.error } : {}) },
      };
    }
  }
}

/** Whether a picture line reads in canonical form (it has no mistakes and something to run). */
export const readsCanonically = (r: LineRead) => r.errors.length === 0 && r.canonical !== null && (r.dialect !== 'picture' || !!r.picture?.sentence);

// ── Running the other dialects (pure) ─────────────────────────────────────

/** A Grid Rules node with these params, as the bar adds one (beside the selection, or on an empty Output). */
export const gridPlan = (params: Record<string, unknown>, beside?: string): DoPlan => ({
  steps: [{ kind: 'gridRules', preset: '', params, label: 'Add Grid Rules (from the line)', beside }], reading: [], unknown: [],
});

/** A new 3D scene with this spec, beside what is there; the Output shows it. */
export function sceneNodes(nodes: GraphNode[], spec: SceneSpec, nextId: () => string, at?: { x: number; y: number }): { nodes: GraphNode[]; focusId: string; sceneId: string } {
  const r = applyScene(nodes, spec, { nextId, asNew: true, at: at ?? { x: 0, y: (Math.max(0, ...nodes.map(n => n.position.y)) || 0) + 400 } });
  return { nodes: r.nodes, focusId: r.focusId, sceneId: r.sceneId };
}

/** A new Agents group in rules mode with this rule set (the Rules starter's setup), on the Output. */
export function agentsNodes(nodes: GraphNode[], set: AgentRuleSet, nextId: () => string, at?: { x: number; y: number }): { nodes: GraphNode[]; groupId: string } {
  const output = graphOutput(nodes);
  const starter = rulesStarter(output?.inputs.color?.connection ?? null);
  const withSet = starter.nodes.map(nd => {
    if (nd.id !== starter.groupId) return nd;
    const g = applyRulesToGroup(nd, set);
    return { ...g, params: { ...g.params, __comment: `${rulesGroupNote(set)}\nMade from a line in the Do… bar.` } };
  });
  const { nodes: fresh, idOf } = freshIds(withSet, nextId);
  const placed = placeInFreeSpace(nodes, fresh, at ?? { x: 0, y: (Math.max(0, ...nodes.map(n => n.position.y)) || 0) + 400 });
  let out = [...nodes, ...placed];
  const conn = { nodeId: idOf(starter.out.nodeId), outputKey: starter.out.outputKey };
  if (output) out = out.map(n => (n.id === output.id ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: conn } } } : n));
  return { nodes: out, groupId: idOf(starter.groupId) };
}

/** Every head word the bar knows, for "did you mean" across dialects. */
export const allHeads = () => [...new Set([...entriesFor('picture'), ...entriesFor('edit')].flatMap(e => e.words))];
