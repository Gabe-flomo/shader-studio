/**
 * Guided setup for the Agents group (store/agentSetup.ts): presets placed in free space without
 * overlaps, the starters a bare group offers, the card's Next steps, an empty rule's starting
 * rules, the "← this walker's …" hints, and the plain-language socket names on old saves.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../../compiler/graphCompiler';
import { agentPreset } from '../agentExamples';
import { addAgentPieceTo, agentNextSteps, agentStarter, freshIds, placeInFreeSpace, ruleIsEmpty, startRuleIn, untangle } from '../agentSetup';
import { AGENT_PRESET_TYPES, agentWalkerDefault } from '../../nodes/definitions/agents';
import { buildAgentsSubgraph } from '../../nodes/scene3dDefaults';
import { n } from '../graphBuilder';
import { upgradeLegacyNode } from '../legacyLabels';
import { EXAMPLE_GRAPHS } from '../exampleGraphs';
import type { GraphNode } from '../../types/nodeGraph';

const H = (nd: GraphNode) => ({ agentEmit: 840, agentsGroup: 600, agentDeposit: 310, trailField: 670, drawAgents: 560, stopPalette: 590 } as Record<string, number>)[nd.type] ?? 300;
const box = (nd: GraphNode) => ({ x: nd.position.x, y: nd.position.y, w: 360, h: H(nd) });
const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlap = (list: GraphNode[]) => {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(hit(box(list[i]), box(list[j])), `${list[i].id} / ${list[j].id}`).toBe(false);
};
let k = 0;
const nextId = () => `t${k++}`;
const output = (from?: [string, string]) => n('output', 'out', 0, 0, {}, from ? { color: from } : {});
const ids = (nodes: GraphNode[]): Set<string> => new Set(nodes.flatMap(nd => [nd.id, ...ids(((nd.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes) ?? [])]));

describe('presets land in free space, their cards apart', () => {
  // An existing graph right where the preset is asked for.
  const existing = [output(['circle', 'color']), n('circleSDF', 'circle', 400, 0), n('circleSDF', 'glow', 400, 300)];
  for (const type of AGENT_PRESET_TYPES) {
    it(type, () => {
      const p = agentPreset(type, nextId, { x: 0, y: 0 })!;
      const placed = placeInFreeSpace(existing, p.nodes, { x: 0, y: 0 }, H);
      noOverlap([...existing, ...placed]);
    });
  }
  it('stays where it was asked for when nothing is there', () => {
    const p = agentPreset('slimeMoldPreset', nextId, { x: 5000, y: 5000 })!;
    const placed = placeInFreeSpace(existing, p.nodes, { x: 5000, y: 5000 }, H);
    expect(Math.min(...placed.map(nd => nd.position.x))).toBe(5000);
  });
  it('untangles a preset card that sat on another (Sand on a plate: UV under the group)', () => {
    const p = agentPreset('sandPlatePreset', nextId, { x: 0, y: 0 })!;
    noOverlap(untangle(p.nodes, H));
  });
});

describe('starters for a bare Agents group', () => {
  for (const kind of ['particles', 'slime'] as const) {
    it(`${kind}: compiles, runs, shows on the Output over what it showed, every node has a note, nothing left to do`, () => {
      const pic = n('palette', 'circle', 0, 0);
      const s = agentStarter(kind, { nodeId: 'circle', outputKey: 'color' });
      const { nodes: fresh, idOf } = freshIds(s.nodes, nextId);
      const graph = [pic, ...fresh, output([idOf(s.out.nodeId), s.out.outputKey])];
      const r = compileGraph({ nodes: graph });
      expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
      expect(r.agents!.groups.every(g => g.live)).toBe(true);
      expect(r.agents!.groups[0].side).toBe(512);
      const all: GraphNode[] = [];
      const walk = (l: GraphNode[]) => l.forEach(nd => { all.push(nd); walk(((nd.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes) ?? []); });
      walk(fresh);
      for (const nd of all) if (nd.type !== 'agentInputs' && nd.type !== 'agentOutput') expect(String(nd.params.__comment ?? ''), nd.type).not.toBe('');
      expect(agentNextSteps(graph, idOf(s.groupId))).toEqual([]);
      // The old picture is still in it.
      expect(JSON.stringify(graph.filter(nd => nd.type !== 'output').map(nd => nd.inputs))).toContain('"nodeId":"circle"');
    });
  }
});

describe('Next steps on the group card', () => {
  it('no preset or example shows any', () => {
    for (const [key, ex] of Object.entries(EXAMPLE_GRAPHS)) {
      for (const g of ex.nodes.filter(nd => nd.type === 'agentsGroup')) expect(agentNextSteps(ex.nodes, g.id), key).toEqual([]);
    }
  });
  it('a bare group asks for an Emit and a way to be seen; each piece adds, wires and compiles', () => {
    const g = n('agentsGroup', 'g', 0, 0, { subgraph: buildAgentsSubgraph(nextId) });
    let graph: GraphNode[] = [g, output()];
    expect(agentNextSteps(graph, 'g').map(s => s.piece)).toEqual(['emit', 'draw', 'trail']);
    for (const piece of ['emit', 'draw'] as const) {
      const r = addAgentPieceTo(graph, 'g', piece, nextId)!;
      graph = r.nodes;
    }
    expect(agentNextSteps(graph, 'g')).toEqual([]);
    const r = compileGraph({ nodes: graph });
    expect(r.errors).toBeUndefined();
    expect(r.agents!.draws).toHaveLength(1);
  });
  it('a rule that smells a trail nothing lays asks for Deposit + Trail, which closes the loop', () => {
    const g0 = n('agentsGroup', 'g', 0, 0, { subgraph: buildAgentsSubgraph(nextId) });
    const g: GraphNode = { ...g0, params: { ...g0.params, subgraph: { ...(g0.params.subgraph as object), nodes: startRuleIn(g0, 'slime', nextId) } } };
    let graph: GraphNode[] = [g, output()];
    expect(agentNextSteps(graph, 'g').map(s => s.piece)).toContain('trail');
    graph = addAgentPieceTo(graph, 'g', 'trail', nextId)!.nodes;
    const trail = graph.find(nd => nd.type === 'trailField')!;
    expect(graph.find(nd => nd.id === 'g')!.inputs.trail.connection).toEqual({ nodeId: trail.id, outputKey: 'texture' });
    const r = compileGraph({ nodes: graph });
    expect(r.errors).toBeUndefined();
    expect(r.agents!.trails.every(t => t.live)).toBe(true);
  });
});

describe('an empty rule', () => {
  it('is empty until something is wired into Agent Output; each starting rule compiles with fresh ids', () => {
    const g = n('agentsGroup', 'g', 0, 0, { subgraph: buildAgentsSubgraph(nextId) });
    expect(ruleIsEmpty(g)).toBe(true);
    for (const kind of ['slime', 'particles', 'walk'] as const) {
      const inside = startRuleIn(g, kind, nextId);
      const g2 = { ...g, params: { ...g.params, subgraph: { ...(g.params.subgraph as object), nodes: inside } } };
      expect(ruleIsEmpty(g2)).toBe(false);
      expect(ids([g2]).size).toBe(1 + inside.length);
      const r = compileGraph({ nodes: [g2, n('drawAgents', 'd', 400, 0, {}, { agents: ['g', 'agents'] }), output(['d', 'color'])] });
      expect(r.errors, kind).toBeUndefined();
    }
  });
});

describe('plain-language cards', () => {
  it('unwired sockets inside say what they read', () => {
    expect(agentWalkerDefault('agentSense', 'position', 'vec2')).toBe('← this walker\'s position');
    expect(agentWalkerDefault('agentChladni', 'velocity', 'vec2')).toBe('← this walker\'s velocity');
    expect(agentWalkerDefault('agentOutput', 'heading', 'float')).toBe('unchanged');
    expect(agentWalkerDefault('noise', 'uv', 'vec2')).toBe('← this walker\'s position');
    expect(agentWalkerDefault('agentSense', 'angle', 'float')).toBeNull();
  });
  it('old saves get the new socket names; a renamed socket keeps its own', () => {
    const old = n('agentCurl', 'c', 0, 0);
    old.inputs.also = { ...old.inputs.also, label: 'Also' };
    expect(upgradeLegacyNode(old).inputs.also.label).toBe('+ Another force');
    const trail = n('trailField', 't', 0, 0);
    trail.outputs.texture = { ...trail.outputs.texture, label: 'Texture' };
    expect(upgradeLegacyNode(trail).outputs.texture.label).toBe('Image');
  });
});
