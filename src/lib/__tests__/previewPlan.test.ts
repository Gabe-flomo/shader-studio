import { describe, expect, it, vi } from 'vitest';
// The card modules read settings from localStorage when they load; a plain in-memory one here.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage ??= {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0,
  };
});
import type { GraphNode } from '../../types/nodeGraph';
import { NODE_REGISTRY } from '../../nodes/definitions';
import {
  FIELD_TYPES, MIRROR_TYPES, NO_EYE_TYPES, OWN_CARD_TYPES, SELF_VIZ_TYPES, SINK_TYPES, STATS_TYPES, previewBanner, previewPlan,
} from '../nodePreview/previewPlan';
import { pickPreviewOutput } from '../nodePreview/showAs';
import { hasRealDiagram, INLINE_VIZ_TYPES } from '../../components/NodeGraph/NodeInlineViz';
import { AGENT_PANEL_TYPES } from '../../components/NodeGraph/AgentPreviewPanels';

const defs = Object.values(NODE_REGISTRY).filter(d => !d.deprecated);
const asNode = (type: string, outputs: GraphNode['outputs']) => ({ type, outputs }) as Pick<GraphNode, 'type' | 'outputs'>;

describe('every node has a meaningful preview or none at all', () => {
  it.each(defs.map(d => [d.type, d] as const))('%s', (_type, def) => {
    const plan = previewPlan(asNode(def.type, def.outputs), hasRealDiagram);
    // A body always has something to draw
    if (plan.body === 'field') expect(FIELD_TYPES.has(pickPreviewOutput({ id: '', type: def.type, outputs: def.outputs })![1])).toBe(true);
    if (plan.body === 'diagram') expect(hasRealDiagram(def.type)).toBe(true);
    if (plan.body === 'stats' || plan.body === 'mirror') expect(AGENT_PANEL_TYPES.has(def.type)).toBe(true);
    if (plan.diagram) expect(hasRealDiagram(def.type)).toBe(true);
    // The eye is only offered where the card then shows something: a field, a diagram, a panel,
    // or the card's own always-on picture
    if (plan.eye) expect(plan.body !== 'none' || SELF_VIZ_TYPES.has(def.type)).toBe(true);
    expect(plan.why.length).toBeGreaterThan(5);
  });

  it('covers the whole registry', () => {
    expect(defs.length).toBeGreaterThan(300);
    const bodies = new Map<string, number>();
    for (const d of defs) { const b = previewPlan(asNode(d.type, d.outputs), hasRealDiagram).body; bodies.set(b, (bodies.get(b) ?? 0) + 1); }
    expect(bodies.get('field')).toBeGreaterThan(200);
  });

  it('every listed special type exists and has its panel', () => {
    for (const t of [...STATS_TYPES, ...MIRROR_TYPES]) expect(AGENT_PANEL_TYPES.has(t)).toBe(true);
    for (const t of [...STATS_TYPES, ...MIRROR_TYPES, ...OWN_CARD_TYPES]) expect(NODE_REGISTRY[t], t).toBeDefined();
  });
});

describe('specific nodes', () => {
  const plan = (t: string) => previewPlan(asNode(t, NODE_REGISTRY[t].outputs), hasRealDiagram);
  it('the Agents family: readouts and the trail, no empty boxes', () => {
    expect(plan('agentsGroup')).toMatchObject({ eye: false, body: 'none' });
    expect(plan('agentSense')).toMatchObject({ eye: true, body: 'stats' });
    expect(plan('agentSteer')).toMatchObject({ eye: true, body: 'stats' });
    expect(plan('agentMove')).toMatchObject({ eye: true, body: 'stats' });
    expect(plan('agentEmit')).toMatchObject({ eye: false, body: 'stats' });
    expect(plan('agentDeposit')).toMatchObject({ eye: false, body: 'mirror' });
    expect(plan('agentOutput')).toMatchObject({ eye: false, body: 'none' });
    expect(plan('trailField').body).toBe('field');
  });
  it('colour outputs and texture tools read back their real picture', () => {
    expect(plan('light')).toMatchObject({ eye: true, body: 'field', diagram: false }); // SDF Glow: its params list isn't a diagram
    expect(plan('edgesTexture').body).toBe('field');
    expect(plan('pass')).toMatchObject({ eye: true, body: 'none' }); // its card shows the texture live
    expect(plan('multiply')).toMatchObject({ body: 'field', diagram: true });
  });
  it('inside a 3D group a node shows its diagram or nothing (it runs per ray step)', () => {
    const in3d = (t: string) => previewPlan(asNode(t, NODE_REGISTRY[t].outputs), hasRealDiagram, 'sceneGroup');
    for (const d of defs) {
      const p = in3d(d.type);
      expect(['diagram', 'none']).toContain(p.body);
      if (p.body === 'none') expect(p.eye).toBe(false);
    }
    expect(in3d('scenePos')).toMatchObject({ eye: false, body: 'none' });
    // A plain group isn't 3D: its nodes read back as usual
    expect(previewPlan(asNode('multiply', NODE_REGISTRY.multiply.outputs), hasRealDiagram, 'group').body).toBe('field');
  });
  it('sinks and plain sources have no eye', () => {
    for (const t of ['output', 'vec4Output']) expect(SINK_TYPES.has(t) && !plan(t).eye).toBe(true);
    for (const t of NO_EYE_TYPES) expect(plan(t).eye).toBe(false);
  });
  it('a param list is not a diagram; a drawn one is', () => {
    expect(INLINE_VIZ_TYPES.has('light') && !hasRealDiagram('light')).toBe(true);
    expect(hasRealDiagram('smoothstep')).toBe(true);
    expect(hasRealDiagram('swirlSpace')).toBe(true); // drawn by GenericViz before the param list
  });
});

describe('where the preview controls live', () => {
  it('the banner only names the node; controls and notes are on the card', () => {
    expect(previewBanner('SDF Glow')).toEqual({ lead: 'Previewing', name: 'SDF Glow', controls: false, notes: false });
  });
});
