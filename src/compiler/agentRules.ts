/**
 * What may go inside an Agents group, and why (docs/agents-plan.md section 4).
 *
 * The inside runs once per agent, not once per pixel: each fragment of the
 * update shader is one walker's texel, so a node that reads "this pixel" of
 * the previous picture, renders a program of its own, ray-marches a scene,
 * or takes screen-space derivatives gives nonsense there. The rule is kept
 * next to fieldSockets.ts (whose FIELD_IMPURE list it reuses) and its
 * messages read the same way ("Echo can't go inside an Agents group: it
 * reads the previous frame").
 *
 * The derivative check is not a hand-kept list: every node's emitted GLSL
 * (its code and helper functions) is scanned for dFdx / dFdy / fwidth /
 * gl_FragCoord, so a new node that uses them is covered automatically.
 */
import type { GraphNode, NodeDefinition, SubgraphData } from '../types/nodeGraph';
import { FIELD_IMPURE } from './fieldSockets';
import { AGENT_INSIDE_TYPES, AGENT_OUTSIDE_TYPES } from '../nodes/definitions/agents';

const PROGRAM = 'it is a program (or an engine) of its own; it goes outside the group';
const MARCH = 'it ray-marches a scene for every agent, which is too costly for now';

/** Node type → why it can't go inside an Agents group (besides FIELD_IMPURE and the derivative scan). */
export const AGENT_REJECTED: Record<string, string> = {
  pass: PROGRAM,
  agentsGroup: PROGRAM,
  trailField: PROGRAM,
  agentDeposit: PROGRAM,
  agentEmit: PROGRAM,
  drawAgents: PROGRAM,
  gpuParticles: PROGRAM,
  output: 'the Output is the picture; inside the group, Agent Output is the end of the rule',
  vec4Output: 'the Output is the picture; inside the group, Agent Output is the end of the rule',
  sceneGroup: MARCH,
  marchLoopGroup: MARCH,
  giLitMarchGroup: MARCH,
  spaceWarpGroup: MARCH,
};

const DERIVATIVES = /\b(dFdx|dFdy|fwidth|gl_FragCoord)\b/;

const labelOf = (n: GraphNode, def: NodeDefinition | undefined) =>
  (typeof n.params.label === 'string' && n.params.label.trim()) || def?.label || n.type;

/**
 * Does this node's emitted GLSL take derivatives or read gl_FragCoord? The node
 * is generated as it stands (its params, nothing wired), so whatever it would
 * emit in the update shader is what is scanned.
 */
export function usesPixelOnlyGlsl(n: GraphNode, def: NodeDefinition): boolean {
  const texts: string[] = [];
  if (def.glslFunction) texts.push(def.glslFunction);
  if (def.glslFunctions) texts.push(...def.glslFunctions);
  try { texts.push(...(def.glslFunctionsFor?.(n) ?? [])); } catch { /* instance helpers need a compile */ }
  if (typeof n.params.glslFunctions === 'string') texts.push(n.params.glslFunctions);
  if (typeof n.params.__codeOverride === 'string') texts.push(n.params.__codeOverride);
  try { texts.push(def.generateGLSL(n, {}).code); } catch { /* a node that needs its inputs to generate: its helpers were scanned */ }
  return texts.some(t => DERIVATIVES.test(t));
}

/** Why `n` can't run inside an Agents group, or undefined when it can. Groups are checked inside. */
export function agentProblemOf(n: GraphNode, defOf: (n: GraphNode) => NodeDefinition | undefined): string | undefined {
  if (n.type === 'playLayers') return undefined; // a texture read at a point: a frame late, fine for food and walls
  const fixed = AGENT_REJECTED[n.type] ?? FIELD_IMPURE[n.type];
  if (fixed) return fixed;
  const def = defOf(n);
  if (!def) return undefined;
  if (n.type === 'group') {
    const sub = n.params.subgraph as SubgraphData | undefined;
    for (const inner of sub?.nodes ?? []) {
      const why = agentProblemOf(inner, defOf);
      if (why) return `it contains ${labelOf(inner, defOf(inner))}, ${why.startsWith('it ') ? `which ${why.slice(3)}` : `and ${why}`}`;
    }
    return undefined;
  }
  if (usesPixelOnlyGlsl(n, def)) return 'its code reads the pixel it is drawn at (screen derivatives or gl_FragCoord), and an agent is not a pixel';
  return undefined;
}

/** Problems with the nodes compiled into a group's update shader, as `Node <id>: …` card messages. */
export function agentProgramProblems(nodes: GraphNode[], defOf: (n: GraphNode) => NodeDefinition | undefined): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (AGENT_INSIDE_TYPES.has(n.type) || n.type === 'agentStepOut') continue;
    const why = agentProblemOf(n, defOf);
    if (why) out.push(`Node ${n.id}: ${labelOf(n, defOf(n))} can't go inside an Agents group: ${why}.`);
  }
  return out;
}

/**
 * Agents-family nodes in the wrong place: the inside nodes anywhere but an
 * Agents group, the outside ones anywhere but the top level.
 */
export function agentPlacementProblems(nodes: GraphNode[], defOf: (n: GraphNode) => NodeDefinition | undefined): string[] {
  const out: string[] = [];
  const visit = (list: GraphNode[], where: 'top' | 'agents' | 'group') => {
    for (const n of list) {
      // An inside node copied into the picture for the eye preview (agentEyeNodes) is allowed there.
      if (AGENT_INSIDE_TYPES.has(n.type) && where !== 'agents' && n.params?.__agentEye !== true) out.push(`Node ${n.id}: ${labelOf(n, defOf(n))} goes inside an Agents group.`);
      if (AGENT_OUTSIDE_TYPES.has(n.type) && where !== 'top') out.push(`Node ${n.id}: ${labelOf(n, defOf(n))} goes at the top level of the graph, outside any group.`);
      const sub = n.params?.subgraph as SubgraphData | undefined;
      if (sub?.nodes) visit(sub.nodes, n.type === 'agentsGroup' ? 'agents' : 'group');
    }
  };
  visit(nodes, 'top');
  return out;
}
