/**
 * The stage map behind the builders' flow strips and the node library's relevance
 * (docs/structure-hints.md): the stage map, flow detection and the builders' flows. The Studio
 * graph itself shows no stages (no flow strip, stage tags or arrange by stage).
 */
import { describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
  clear: () => mem.clear(),
});

import { NODE_REGISTRY } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { CATEGORY_STAGE, FLOWS, FLOW_ORDER, STAGES, TYPE_STAGE, inFlow, stageEntry, stageOfType, type FlowId, type StageId } from '../stages';
import { detectFlow } from '../flow';
import { BUILDER_FLOWS } from '../builders';
import { BUILDER_HELP } from '../../components/builders/helpContent';

// ── The stage map ───────────────────────────────────────────────────────────

describe('stage map', () => {
  it('gives every registered node a stage or an explicit "any"', () => {
    const missing = Object.keys(NODE_REGISTRY).filter(t => !stageEntry(t));
    expect(missing).toEqual([]);
  });

  it('maps every registry category (so a new node in a known category is covered)', () => {
    const cats = [...new Set(Object.values(NODE_REGISTRY).map(d => d.category))];
    expect(cats.filter(c => !(c in CATEGORY_STAGE))).toEqual([]);
  });

  it('has no overrides for types that no longer exist', () => {
    expect(Object.keys(TYPE_STAGE).filter(t => !NODE_REGISTRY[t])).toEqual([]);
  });

  it('puts the common nodes where the flows say', () => {
    expect(stageOfType('uv')).toBe('space');
    expect(stageOfType('polarSpace')).toBe('bend');
    expect(stageOfType('circleSDF')).toBe('shape');
    expect(stageOfType('fbm')).toBe('shape');
    expect(stageOfType('light')).toBe('shapeIt');
    expect(stageOfType('palette')).toBe('colour');
    expect(stageOfType('toneMap')).toBe('post');
    expect(stageOfType('vignette')).toBe('post');
    expect(stageOfType('marchCamera')).toBe('camera');
    expect(stageOfType('sphereSDF3D')).toBe('objects');
    expect(stageOfType('rayMarch')).toBe('march');
    expect(stageOfType('softShadow')).toBe('light');
    expect(stageOfType('pass')).toBe('pass');
    expect(stageOfType('agentSense')).toBe('sense');
    expect(stageOfType('trailField')).toBe('trail');
    expect(stageOfType('add')).toBe('any');
    expect(stageOfType('time')).toBe('any');
    expect(stageOfType('exprNode')).toBe('any');
    expect(stageOfType('no-such-node')).toBe('any');
  });

  it('every flow names known stages, its aliases land on its own stages, and its colours are distinct', () => {
    for (const f of FLOW_ORDER) {
      const flow = FLOWS[f];
      for (const s of flow.stages) expect(STAGES[s]).toBeDefined();
      for (const to of Object.values(flow.alias)) expect(flow.stages).toContain(to);
      const accents = flow.stages.map(s => STAGES[s].accent);
      expect(new Set(accents).size).toBe(accents.length);
      // Every stage reads as something in every flow.
      for (const s of Object.keys(STAGES) as StageId[]) expect(inFlow(s, f)).not.toBeNull();
    }
  });
});

// ── Flows ───────────────────────────────────────────────────────────────────

const graph2d = () => [
  n('uv', 'u', 0, 0),
  n('circleSDF', 'c', 0, 0, {}, { position: ['u', 'uv'] }),
  n('light', 'g', 0, 0, {}, { distance: ['c', 'distance'] }),
  n('output', 'o', 0, 0, {}, { color: ['g', 'tinted'] }),
];

describe('flow detection', () => {
  it('reads a plain picture as 2D', () => {
    expect(detectFlow(graph2d())).toBe('2d');
    expect(detectFlow([])).toBe('2d');
  });

  it('reads a camera and a march as 3D', () => {
    const nodes = [
      n('uv', 'u', 0, 0), n('marchCamera', 'cam', 0, 0, {}, { uv: ['u', 'uv'] }),
      n('rayMarch', 'm', 0, 0, {}, { uv: ['u', 'uv'] }), n('output', 'o', 0, 0, {}, { color: ['m', 'color'] }),
    ];
    expect(detectFlow(nodes)).toBe('3d');
  });

  it('reads a Pass as passes, even with a 2D picture inside', () => {
    const nodes = [...graph2d().slice(0, 3), n('pass', 'p', 0, 0, {}, { color: ['g', 'tinted'] }), n('sampleTexture', 's', 0, 0, {}, { texture: ['p', 'texture'] }), n('output', 'o', 0, 0, {}, { color: ['s', 'color'] })];
    expect(detectFlow(nodes)).toBe('pass');
  });

  it('reads agents as agents', () => {
    const nodes = [n('agentsGroup', 'a', 0, 0), n('drawAgents', 'd', 0, 0, {}, { agents: ['a', 'agents'] }), n('output', 'o', 0, 0, {}, { color: ['d', 'color'] })];
    expect(detectFlow(nodes)).toBe('agents');
  });

  it('agrees with the bundled examples', () => {
    const want: Record<string, FlowId> = { ringGlow: '2d', neonGlow: '2d', learn3dLight: '3d', raymarchSpheres: '3d', gridRulesLife: 'pass', passFeedbackTrails: 'pass', slimeMold: 'agents', agentBoids: 'agents' };
    for (const [k, f] of Object.entries(want)) {
      const nodes = (EXAMPLE_GRAPHS[k] as { nodes: GraphNode[] }).nodes;
      expect([k, detectFlow(nodes)]).toEqual([k, f]);
    }
  });
});

// ── Builders ────────────────────────────────────────────────────────────────

describe('builder flows', () => {
  it('describe stages of their own flow, and point empty sections at a stage', () => {
    for (const [key, bf] of Object.entries(BUILDER_FLOWS)) {
      expect(BUILDER_HELP[key as keyof typeof BUILDER_HELP]).toBeDefined();
      for (const s of Object.keys(bf.lines)) expect(FLOWS[bf.flow].stages).toContain(s);
      for (const [section, s] of Object.entries(bf.emptyNext)) {
        expect(BUILDER_HELP[key as keyof typeof BUILDER_HELP][section]).toBeDefined();
        expect(FLOWS[bf.flow].stages).toContain(s);
      }
    }
    expect(BUILDER_FLOWS['scene-builder'].flow).toBe('3d');
    expect(BUILDER_FLOWS['grid-rules'].flow).toBe('pass');
    expect(BUILDER_FLOWS['agent-rules'].flow).toBe('agents');
  });
});
