/**
 * passExpand.ts — opening every node that is really one or more passes onto the top level
 * (docs/pass-node-plan.md). The pass compile (passGraph.ts) cuts the result; the pass budget
 * (passBudget.ts) counts its Pass nodes. Keeping the expansion in one place means the count
 * the toolbar shows is the count the compile checks.
 */
import type { GraphNode } from '../types/nodeGraph';
import { expandPassGroups, type ExpandedGroups } from './passGroups';
import { expandGridRules } from './gridRulesExpand';
import { expandCurveBeams } from './curveBeamExpand';
import { expandShaderTextures, hasShaderTexture } from './shaderTextureExpand';
import { expandFeedback } from './feedbackExpand';
import { expandDataTextures } from './dataTextureExpand';
import { expandRenderTargets } from './renderTargetsExpand';
import { expandSpriteSources } from './spriteExpand';
import { expandMemory } from './memoryExpand';
import { expandOpticalFlow } from './opticalFlowExpand';
import { expandProbes, expandTextProbes } from './probeExpand';
import { expandSmoothDof } from './smoothDofExpand';

export const PASS_TYPE = 'pass';
/** Most passes in one graph: Pass nodes, and every pass another node opens into (see passBudget.ts). */
export const MAX_PASSES = 8;
/** Passes allowed past MAX_PASSES at lower quality: the live preview draws full-size passes at half size (passBudget.ts graceScale). */
export const GRACE_PASSES = 2;
/** The compile's limit and the lock line: no change may take a graph past it (store/passLock.ts). */
export const HARD_MAX_PASSES = MAX_PASSES + GRACE_PASSES;

/** What expandPassNodes gives back: the node list the pass compile cuts, and what each expansion bound. */
export interface ExpandedPassNodes {
  /** The top level once every expanding node is opened (its Pass nodes are the ones that count towards MAX_PASSES). */
  nodes: GraphNode[];
  /** Plain groups opened because a Pass is inside (compiler/passGroups.ts). */
  groups: ExpandedGroups['groups'];
  /** The final list, with every expanded step/picture node compiled under another node's slug. */
  grid: { nodes: GraphNode[]; bindAs: Map<string, string> };
}

/**
 * Open every node that is really one or more passes (Pass groups, Shader Textures, Grid Rules, Beams,
 * Feedback, Data Textures, Render Targets, Sprites, Memory, Optical Flow, probes, Smooth lens) onto the
 * top level, as the pass compile does. The one place these rules live: compilePassGraph cuts the
 * result, and passBudget (compiler/passBudget.ts) counts its Pass nodes.
 */
export function expandPassNodes(input: GraphNode[]): ExpandedPassNodes | { errors: string[] } {
  // A Pass inside a plain group (phase 7): the group is opened onto the top level for the cut
  // (compiler/passGroups.ts). Inside any other kind of group, an error saying why.
  // Shader Textures (docs/texture-builder.md) are opened into their inside and a Pass first, and again after a
  // plain group with one inside has been opened (a few rounds at most); without one, exactly as before.
  let opened = expandPassGroups(expandShaderTextures(input));
  if ('errors' in opened) return { errors: opened.errors };
  for (let round = 0; round < 8 && hasShaderTexture(opened.nodes); round++) {
    const more = expandPassGroups(expandShaderTextures(opened.nodes));
    if ('errors' in more) return { errors: more.errors };
    opened = { nodes: more.nodes, groups: new Map([...opened.groups, ...more.groups]) };
  }
  // Grid Rules nodes: each opened into its board Pass and step (compiler/gridRulesExpand.ts); without one, unchanged.
  // March Camera Lens: Smooth: the picture into a hidden Pass with its CoC, then the gather (compiler/smoothDofExpand.ts).
  const gridOnly = expandGridRules(expandSmoothDof(opened.nodes));
  // Curve Trace in Draw: Beam: each opened into its screen Pass and step (compiler/curveBeamExpand.ts); without one, unchanged.
  const beams = expandCurveBeams(gridOnly.nodes);
  // Feedback (texture): each opened into its step and buffer Pass (compiler/feedbackExpand.ts); without one, unchanged.
  // Data Textures: each opened into its pack, its Pass and a Read channels per output (compiler/dataTextureExpand.ts).
  // Render Targets: each opened into its pack and one Pass with extra targets (compiler/renderTargetsExpand.ts).
  // Draw agents' Sprite from a texture that isn't a Pass's: a hidden Pass in between (compiler/spriteExpand.ts).
  // Memory nodes (Lag, Spring, Envelope…): all in one shared Pass, a texel each (compiler/memoryExpand.ts).
  // Optical Flow: each opened into its source Pass, its step and its flow Pass (compiler/opticalFlowExpand.ts).
  // Value at point (and a Text's wired Value): one shared Pass reading each value at its point (compiler/probeExpand.ts).
  const flows = expandOpticalFlow(expandProbes(expandTextProbes(beams.nodes)));
  const feedback = expandFeedback(expandRenderTargets(expandDataTextures(expandSpriteSources(expandMemory(flows.nodes)))));
  const grid = beams.bindAs.size || feedback.bindAs.size || flows.bindAs.size
    ? { nodes: feedback.nodes, bindAs: new Map([...gridOnly.bindAs, ...beams.bindAs, ...flows.bindAs, ...feedback.bindAs]) }
    : feedback.nodes !== beams.nodes ? { nodes: feedback.nodes, bindAs: gridOnly.bindAs } : gridOnly;
  return { nodes: grid.nodes, groups: opened.groups, grid };
}
