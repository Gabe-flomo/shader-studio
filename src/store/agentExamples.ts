/**
 * agentExamples.ts — the Agents group's presets and examples (docs/agents-plan.md §12),
 * built from the node definitions (graphBuilder.ts).
 *
 * Every node a preset adds carries a plain-language note (params.__comment):
 * what it does in this setup, why it is there, and what to try. The notes show
 * on the card's Comment tab and, as // lines, in the generated code.
 * examples.test.ts checks that no node of an Agents example goes without one.
 *
 * The same builder makes the example (fixed ids) and the Slime mold starter in
 * the node browser (fresh ids, placed next to the Output: store addNode).
 */
import type { GraphNode } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { n } from './graphBuilder';

export const AGENT_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  slimeMold: {
    label: 'Slime mold',
    description: 'A million walkers on the GPU, built from nodes: each one senses the trail ahead (left, centre, right), turns toward the strongest smell, moves and leaves more trail, which spreads and fades. Veins form, join, thicken and pulse by themselves (Jones 2010, Physarum polycephalum). Double-click the Agents group to open the rule.',
  },
};

export const AGENT_EXAMPLE_KEYS = Object.keys(AGENT_EXAMPLE_INDEX);

const note = (lines: string[]) => ({ __comment: lines.join('\n') });

/** A node's sockets, its definition's, with a few made by hand (Agent Inputs' added ports). */
function withOutputs(node: GraphNode, extra: Record<string, { type: GraphNode['outputs'][string]['type']; label: string }>): GraphNode {
  return { ...node, outputs: { ...node.outputs, ...extra } };
}

/**
 * The Slime mold graph, ids as given, its top-left at (x, y). `outputId` is
 * the Output node the trail's colour goes into (made here when `withOutput`).
 */
export function slimeMoldNodes(x = 0, y = 0, withOutput = true): GraphNode[] {
  const X = (dx: number) => x + dx, Y = (dy: number) => y + dy;

  // ── Inside the Agents group: the rule one walker follows every step ──
  const inputs = withOutputs(n('agentInputs', 'slimeIn', 0, 160, {
    _groupOriginal: true,
    extraInputs: [{ key: 'trail', type: 'texture', label: 'Trail' }],
    ...note([
      'Agent Inputs: this walker as the step begins (where it is, which way it faces, a fresh random number).',
      'Trail is an input added to the group: the Trail field from outside, as it was one step ago.',
      'Every socket on the nodes to the right that is left unwired reads this walker\'s own value.',
    ]),
  }), { trail: { type: 'texture', label: 'Trail' } });
  const sense = n('agentSense', 'slimeSense', 420, 100, {
    angle: 22.5, distance: 0.035, weight: 1, width: '1',
    ...note([
      'Sense: sniffs the trail at three points 0.035 ahead (about 18 trail pixels): 22.5° to the left, straight on, and 22.5° to the right.',
      'Why: the walker can only turn toward what it can smell. Readings go through Crowding to Steer.',
      'A sensor angle smaller than Steer\'s turn (22.5° against 45°) keeps the network restless: veins branch, merge and pulse instead of settling.',
      'Try: Angle 45° for calmer, rounder cells; a longer Distance for coarser, bigger cells; a shorter one for fine lace.',
    ]),
  }, { texture: ['slimeIn', 'trail'] });
  // An ordinary node inside the rule: an Expression Block that makes very crowded trail less attractive.
  const crowd = n('exprNode', 'slimeCrowd', 840, 100, {
    label: 'Crowding',
    inputs: [{ name: 'r', type: 'vec3', slider: null }, { name: 'sat', type: 'float', slider: { min: 1, max: 300 } }],
    sat: 60,
    outputType: 'vec3',
    lines: [],
    result: 'r * exp(-r / sat)',
    expr: 'r * exp(-r / sat)',
    ...note([
      'Crowding (an ordinary Expression Block inside the rule): the trail\'s pull rises with the amount up to Sat (60) and falls off past it, as r · e^(−r / sat).',
      'Why: real slime mold can\'t pack its tubes without limit. Without this, every walker ends up in a few huge veins and the network coarsens into a handful of loops; with it, the network keeps reorganising at a living size.',
      'Try: Sat 30 for a finer, more even mesh; 150 (or unwire it and wire Sense straight into Steer) to watch the network coarsen.',
    ]),
  });
  crowd.inputs = {
    r: { type: 'vec3', label: 'r', connection: { nodeId: 'slimeSense', outputKey: 'readings' } },
    sat: { type: 'float', label: 'sat' },
  };
  crowd.outputs = { result: { type: 'vec3', label: 'Result' } };
  const steer = n('agentSteer', 'slimeSteer', 1260, 100, {
    mode: 'jones', turn: 45, jitter: 0.15,
    ...note([
      'Steer (Jones rule): straight on if the centre smells strongest; a random side if both sides beat the centre; otherwise turn 45° toward the stronger side.',
      'Jitter 0.15 adds a small random wobble every step, which keeps the network exploring and pulsing instead of freezing.',
      'Try: Turn 20° for long smooth veins, 70° for a tight busy mesh; Jitter 0 for crisp still lines.',
    ]),
  }, { readings: ['slimeCrowd', 'result'] });
  const move = n('agentMove', 'slimeMove', 1680, 100, {
    speed: 0.22, edges: 'wrap',
    ...note([
      'Move: one step forward along the new heading, 0.22 picture units a second (about two trail pixels a step).',
      'Wrap: a walker leaving one edge comes back on the opposite one, so the network has no border.',
      'Try: Speed 0.5 for faster, looser growth.',
    ]),
  }, { heading: ['slimeSteer', 'heading'] });
  const output = n('agentOutput', 'slimeOut', 2100, 140, {
    _groupOriginal: true,
    ...note([
      'Agent Output: the walker at the end of the step. Position and Heading come from Move; Speed and Velocity follow from Move\'s Velocity.',
      'Anything left unwired here keeps the walker\'s old value.',
    ]),
  }, { position: ['slimeMove', 'position'], heading: ['slimeMove', 'heading'], velocity: ['slimeMove', 'velocity'] });

  // ── Outside ──
  const emit = n('agentEmit', 'slimeEmit', X(0), Y(0), {
    mode: 'fill', shape: 'disc', heading: 'outward', x: 0, y: 0, size: 0.15, life: 0,
    ...note([
      'Emit: where the walkers start. Fill: all of them are born at once when the simulation starts, in a small disc in the middle (radius 0.15), each facing outward.',
      'Why: like a real slime mold placed on agar, they spread out as a fan of branching veins, then join up into a network behind the front.',
      'Try: Shape Whole picture and Facing Random for a network everywhere at once; Ring with Facing Inward for a web that closes in.',
    ]),
  });
  const group: GraphNode = {
    ...n('agentsGroup', 'slime', X(420), Y(0), {
      label: 'Slime mold',
      tier: '1m', species: '1', stepsPerFrame: 2, seed: 1, preroll: 0,
      subgraph: { nodes: [inputs, sense, crowd, steer, move, output], inputPorts: [], outputPorts: [] },
      ...note([
        'Agents: a million walkers (1M) that each run the rule inside this group (double-click it) every step, 2 steps a frame (about 7 ms a frame on an M3 Pro).',
        'Emit says where they are born; their Agents output goes to Deposit, so they leave trail.',
        'Its Trail input is the Trail field below, read back one step late: that loop is what makes the walkers follow each other.',
        'Try: Count 256k on a slower GPU, Steps per frame 4 for faster growth, a new Seed for a different run, then Start over.',
      ]),
    }, { emit: ['slimeEmit', 'emitter'] }),
  };
  group.inputs = { ...group.inputs, trail: { type: 'texture', label: 'Trail', connection: { nodeId: 'slimeTrail', outputKey: 'texture' } } };
  const deposit = n('agentDeposit', 'slimeDeposit', X(840), Y(0), {
    amount: 1, size: 1,
    ...note([
      'Deposit: every walker drops 1 unit of trail on the pixel it stands on, every step.',
      'Why: the trail is the only way walkers know about each other. More walkers on a path leave more trail, which pulls in more walkers: that feedback builds the veins.',
    ]),
  }, { agents: ['slime', 'agents'] });
  const trail = n('trailField', 'slimeTrail', X(1260), Y(0), {
    resolution: '1024', diffuse: 1, halfLife: 0.05, edges: 'wrap', gain: 0.04,
    ...note([
      'Trail field: 1024 rows tall (the width follows the picture), so the network looks the same in a small preview and a 4K export. Each step it spreads (Diffuse 1: every pixel becomes the 3×3 average) and fades (half gone in 0.05 simulated seconds, about 3 steps).',
      'Its Texture goes back into the Agents group for Sense; its Amount (0–1) colours the picture.',
      'Try: a longer Half-life for thick, slow rivers; a shorter one for fine lace. ½ picture is cheaper but packs the walkers tighter (thicker veins). Gain makes the picture brighter or darker without changing the simulation.',
    ]),
  }, { deposit: ['slimeDeposit', 'deposit'] });
  const colour = n('stopPalette', 'slimeColour', X(1680), Y(0), {
    stops: '5', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
    color0: [0.0, 0.0, 0.0], color1: [0.16, 0.05, 0.01], color2: [0.75, 0.38, 0.05], color3: [1.0, 0.82, 0.32], color4: [1.0, 0.98, 0.85],
    ...note([
      'Stops Palette: turns the trail\'s Amount into colour: black where there is none, through deep amber and gold, to pale yellow in the thickest veins.',
      'Try other stops for a different look (black to cyan to white reads as a glowing circuit).',
    ]),
  }, { value: ['slimeTrail', 'amount'] });
  const nodes = [emit, group, deposit, trail, colour];
  if (withOutput) {
    nodes.push(n('output', 'slimeOutput', X(2100), Y(0), {
      ...note(['Output: the coloured trail is the picture.']),
    }, { color: ['slimeColour', 'color'] }));
  }
  return nodes;
}

export function buildAgentExamples(): Record<string, ExampleGraph> {
  return {
    slimeMold: { ...AGENT_EXAMPLE_INDEX.slimeMold, counter: 40, nodes: slimeMoldNodes(0, 200) },
  };
}

/**
 * The Slime mold preset with fresh ids (`nextId`), for adding to a graph:
 * the same nodes as the example, minus its Output. Returns the nodes and the
 * id of the colour node to wire into the graph's Output.
 */
export function slimeMoldPreset(nextId: () => string, at: { x: number; y: number }): { nodes: GraphNode[]; colourId: string } {
  const nodes = slimeMoldNodes(at.x, at.y, false);
  const ids = new Map<string, string>();
  const collect = (list: GraphNode[]) => {
    for (const nd of list) {
      ids.set(nd.id, nextId());
      const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) collect(sg.nodes);
    }
  };
  collect(nodes);
  const remap = (nd: GraphNode): GraphNode => {
    const inputs = Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection && ids.has(i.connection.nodeId)
      ? { ...i, connection: { ...i.connection, nodeId: ids.get(i.connection.nodeId)! } } : i]));
    const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
    const params = sg?.nodes ? { ...nd.params, subgraph: { ...sg, nodes: sg.nodes.map(remap) } } : nd.params;
    return { ...nd, id: ids.get(nd.id)!, inputs, params };
  };
  return { nodes: nodes.map(remap), colourId: ids.get('slimeColour')! };
}
