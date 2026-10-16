/**
 * Channel names on dropdowns (nodes/channelNames.ts): a select with channelsFrom follows the wire to a Trail
 * field, directly or through an Agents group's input, and adds its Channel names to the channel options.
 */
import { describe, expect, it } from 'vitest';
import { channelNamesFor, namedChannelOptions } from '../channelNames';
import { getNodeDefinition } from '../definitions';
import { n } from '../../store/graphBuilder';

const trail = n('trailField', 'tr', 0, 0, { names: 'births, infection' });

describe('channel names', () => {
  it('direct: Channel reads a Trail field\'s Channels', () => {
    const ch = n('channelPick', 'c', 300, 0, {}, { channels: ['tr', 'channels'] });
    expect(channelNamesFor(ch, ['channels', 'texture'], [trail, ch], null, null)).toEqual(['births', 'infection', 'Channel 3', 'Channel 4']);
  });
  it('inside an Agents group: Sense → Agent Inputs → the group\'s input → the Trail field', () => {
    const inputs = n('agentInputs', 'in', 0, 0, { _groupOriginal: true, extraInputs: [{ key: 'air', type: 'texture', label: 'Air' }] });
    const sense = n('agentSense', 'se', 300, 0, {}, {});
    sense.inputs.texture = { ...sense.inputs.texture, connection: { nodeId: 'in', outputKey: 'air' } };
    const group = n('agentsGroup', 'g', 300, 0, {});
    group.inputs = { ...group.inputs, air: { type: 'texture', label: 'Air', connection: { nodeId: 'tr', outputKey: 'texture' } } };
    expect(channelNamesFor(sense, ['texture'], [inputs, sense], [trail, group], group)?.[1]).toBe('infection');
  });
  it('no names given, or no trail: nothing changes', () => {
    const plain = n('trailField', 'tp', 0, 0, {});
    const ch = n('channelPick', 'c', 300, 0, {}, { channels: ['tp', 'channels'] });
    expect(channelNamesFor(ch, ['channels'], [plain, ch], null, null)).toBeNull();
    expect(channelNamesFor(n('channelPick', 'c2', 0, 0, {}), ['channels'], [], null, null)).toBeNull();
  });
  it('labels the channel options (1–4, ch1–ch4), leaving the others', () => {
    const smell = getNodeDefinition('agentSense')!.paramDefs!.smell;
    expect(smell.channelsFrom).toEqual(['texture']);
    const labels = namedChannelOptions(smell.options!, ['births', 'infection', 'Channel 3', 'Channel 4']).map(o => o.label);
    expect(labels).toContain('Channel 2 only · infection');
    expect(labels).toContain('Channel 3 only');
    expect(labels).toContain('All channels');
    const pick = getNodeDefinition('channelPick')!.paramDefs!.channel;
    expect(namedChannelOptions(pick.options!, ['grass', 'Channel 2', 'Channel 3', 'Channel 4'])[0].label).toBe('Channel 1 · grass');
  });
});
