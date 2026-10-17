/**
 * Your Agents presets (builders/userPresets.ts kind 'agents'): the group's rules saved as text and
 * loaded back exactly, into another group, and rescaled when saved in 2D and loaded into 3D.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { useNodeGraphStore, undoManager } from '../../store/useNodeGraphStore';
import { groupRules } from '../../agentRules/apply';
import { agentPresetText, applyAgentPresetText, applyBuilderPreset, makeAgentGroup } from '../actions';
import { startCard } from '../kinds';
import { PRESET_BUILDER_KINDS, presetStorageKey } from '../../builders/userPresets';

const fresh = () => {
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [n('output', 'out', 2000, 0, {})], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
};
const rulesOf = (id: string) => groupRules(useNodeGraphStore.getState().nodes.find(x => x.id === id)!);

describe('your Agents presets', () => {
  it('is its own builder kind with its own storage', () => {
    expect(PRESET_BUILDER_KINDS).toContain('agents');
    expect(presetStorageKey('agents')).toBe('playfield:builder-presets:agents');
  });

  it('saves the rules and loads them back exactly into another group of the same space', () => {
    fresh();
    const a = makeAgentGroup(startCard('trail'), '2d')!.groupId;
    expect(applyBuilderPreset(a, 'cells')).not.toBeNull();
    const text = agentPresetText(a);
    expect(JSON.parse(text).space).toBe('2d');
    const b = makeAgentGroup(startCard('trail'), '2d')!.groupId;
    expect(rulesOf(b)).not.toEqual(rulesOf(a));
    const loaded = applyAgentPresetText(b, text, 'test');
    expect(loaded).not.toBeNull();
    expect(rulesOf(b)).toEqual(rulesOf(a));
  });

  it('rescales when saved in 2D and loaded into a 3D group; bad text loads nothing', () => {
    fresh();
    const a = makeAgentGroup(startCard('trail'), '2d')!.groupId;
    const b = makeAgentGroup(startCard('trail'), '3d')!.groupId;
    const before = JSON.stringify(rulesOf(b));
    expect(applyAgentPresetText(b, 'not json', 'x')).toBeNull();
    expect(JSON.stringify(rulesOf(b))).toBe(before);
    expect(applyAgentPresetText(b, agentPresetText(a), 'x')).not.toBeNull();
    expect(JSON.stringify(rulesOf(b))).not.toBe(JSON.stringify(rulesOf(a)));
  });
});
