/**
 * showHow.ts — "Show me how" (docs/do-bar-commands.md, "Show me how"): a line, built step by step.
 * For each step: what it is, a plain sentence of what it does, the nodes, wires and values it
 * changes, the new nodes in their own words, and the graph after it (the window draws each one
 * as a small picture, the last one big).
 *
 *  - A 2D picture or an edit runs through the Do… bar's own executor (doCommands.ts execCommand,
 *    with snapshots), on a scratch graph (doScratch.ts) or on the graph you have.
 *  - A 3D scene builds clause by clause: the scene of the first clause, of the first two, and so on
 *    (sceneBuilder/apply.ts through lang/run.ts sceneNodes), each clause explained from its help.
 *
 * Pure: no React, no store. Grid and agent lines aren't built here (no picture per step).
 */
import type { GraphNode } from '../types/nodeGraph';
import { execCommand } from './doCommands';
import { scratchGraph } from './doScratch';
import { SCRATCH_LABELS, type ScratchId } from '../lang/commands';
import { readLine, readsCanonically, sceneNodes } from '../lang/run';
import { parseRecipe } from '../sceneBuilder/recipe';
import { splitClauses } from '../sceneBuilder/highlight';
import { helpAt } from '../lang/help';
import { getNodeDefinition } from '../nodes/definitions';
import { estimateNodeHeight } from '../store/graphLayout';
import { n } from '../store/graphBuilder';

export interface HowNode { type: string; label: string; does: string }

export interface HowStep {
  /** The step as the executor names it, or the clause. */
  label: string;
  /** A plain sentence of what it does. */
  what: string;
  /** The clause of the line it comes from (a 3D scene's clause, or a sentence's part). */
  code?: string;
  /** Nodes, wires and values it changes. */
  details: string[];
  added: HowNode[];
  /** The graph after it (empty when it couldn't be built). */
  nodes: GraphNode[];
}

export interface HowPlan {
  text: string;
  kind: 'picture' | 'scene' | 'none';
  /** What it runs on, in words. */
  on: string;
  steps: HowStep[];
  /** The graph at the end. */
  final: GraphNode[];
  problems: string[];
}

export interface HowInput {
  text: string;
  /** A scratch graph to run on (Commands reference examples); else `nodes`, else an empty graph. */
  on?: ScratchId;
  /** The graph you have (the Do… bar's Show me how). */
  nodes?: GraphNode[];
  selected?: string[];
}

const firstSentence = (s: string) => (/^(.+?[.!?])(\s|$)/.exec(s.trim())?.[1] ?? s.trim());

function describe(type: string): HowNode {
  const def = getNodeDefinition(type);
  const d = def?.description;
  const text = Array.isArray(d) ? d.join(' ') : d ? String(d) : '';
  return { type, label: def?.label ?? type, does: text ? firstSentence(text) : '' };
}

const newTypes = (before: GraphNode[], after: GraphNode[]) => {
  const was = new Set(before.map(x => x.id));
  return [...new Set(after.filter(x => !was.has(x.id)).map(x => x.type))];
};

/** A 3D scene, clause by clause. */
function scenePlan(text: string): HowPlan {
  const clauses = splitClauses(text).map(c => c.text.trim()).filter(Boolean);
  const steps: HowStep[] = [];
  const problems: string[] = [];
  let prev: GraphNode[] = [n('output', 'out', 1260, 0)];
  for (let i = 0; i < clauses.length; i++) {
    const src = clauses.slice(0, i + 1).join(' · ');
    const r = parseRecipe(src, { seed: 1 });
    const h = helpAt('scene', clauses[i], clauses[i].search(/[A-Za-z]/));
    if (r.errors.length) { problems.push(`“${clauses[i]}”: ${r.errors[0].message}`); continue; }
    let k = 0;
    const built = sceneNodes([n('output', 'out', 1260, 0)], r.spec, () => `how${i}-${++k}`, { x: 0, y: 0 }).nodes;
    steps.push({
      label: clauses[i], code: clauses[i],
      what: h ? (h.entry.more.toLowerCase().startsWith(`${h.entry.title.toLowerCase()}:`) ? firstSentence(h.entry.more) : `${h.entry.title}: ${firstSentence(h.entry.more)}`) : 'Adds this to the scene.',
      details: [], added: i === 0 ? [{ type: 'scene', label: 'Scene Group', does: 'A Scene Group, a March Loop and an orbit camera, wired to the Output.' }] : [],
      nodes: built,
    });
    prev = built;
  }
  return { text, kind: 'scene', on: 'a new 3D scene', steps, final: prev, problems };
}

/** What a line makes, step by step. */
export function showHowPlan(input: HowInput): HowPlan {
  const text = input.text.trim();
  const empty: HowPlan = { text, kind: 'none', on: '', steps: [], final: [], problems: [] };
  if (!text) return empty;
  const line = readLine(text, { seed: 1 });
  if (line.dialect === 'scene') return line.errors.length ? { ...empty, problems: line.errors.map(e => e.message) } : scenePlan(line.canonical && readsCanonically(line) ? line.canonical : text);
  if (line.dialect === 'grid' || line.dialect === 'agents') return { ...empty, problems: ['Grid and agent rules run over time: try them in the Do… bar instead.'] };
  if (line.dialect === 'scene2d' || line.dialect === 'splat') return { ...empty, problems: [`A ${line.dialect === 'splat' ? 'Splat' : '2D Scene'} Builder recipe builds in one go: run it in the Do… bar, then open it in its builder.`] };
  // A canonical picture line runs as the bar runs it (its sentence through the same executor).
  const run = readsCanonically(line) && line.dialect === 'picture' ? line.picture!.sentence! : text;
  const start = input.on ? scratchGraph(input.on) : input.nodes ?? scratchGraph('empty');
  let k = 0;
  const plan = execCommand(run, start, { selected: input.selected ?? [], nextId: () => `how${++k}`, heightOf: estimateNodeHeight, snapshots: true });
  let before = start;
  const steps: HowStep[] = plan.steps.map(s => {
    const after = s.after ?? before;
    const step: HowStep = {
      label: s.label,
      what: s.label,
      code: plan.clauses.length > 1 ? plan.clauses.find(c => c.index === s.clause)?.text : undefined,
      details: [
        ...s.wires.map(w => `+ ${w}`),
        ...s.unwires.map(w => `− ${w}`),
        ...s.params,
        ...s.removes.map(r => `removes ${r}`),
        ...s.notes,
      ],
      added: newTypes(before, after).map(describe),
      nodes: after,
    };
    before = after;
    return step;
  });
  return {
    text, kind: 'picture', on: input.on ? SCRATCH_LABELS[input.on] : input.nodes ? 'the graph you have' : SCRATCH_LABELS.empty,
    steps, final: plan.nodes, problems: plan.clauses.filter(c => c.status !== 'ok').map(c => `“${c.text}”: ${c.message ?? 'can’t run'}`),
  };
}

/** The node the Output shows (what a step's picture draws), or null. */
export function shownNode(nodes: GraphNode[]): string | null {
  const out = nodes.find(x => x.type === 'output');
  const c = out?.inputs.color?.connection ?? Object.values(out?.inputs ?? {}).find(i => i.connection)?.connection;
  return c?.nodeId ?? null;
}
