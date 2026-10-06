import { describe, expect, it } from 'vitest';
import { builderTabs } from '../builderLayout';
import { phoneDialog } from '../../ui/phoneDialog';

describe('builder windows on a phone', () => {
  it('a phone-width viewport takes the full-screen layout; a tablet does not', () => {
    expect(phoneDialog(390)).toBe(true);
    expect(phoneDialog(412)).toBe(true);
    expect(phoneDialog(820)).toBe(false);
  });

  it('tabs: left panel, the main area, right panel, in that order', () => {
    expect(builderTabs('Rule type', 'Rule', 'Preview').map(t => [t.value, t.label])).toEqual([
      ['left', 'Rule type'], ['main', 'Rule'], ['right', 'Preview'],
    ]);
  });

  it('only the panels that exist', () => {
    expect(builderTabs(undefined, 'Edit', 'Preview').map(t => t.value)).toEqual(['main', 'right']);
    expect(builderTabs('Scene', 'Edit', undefined).map(t => t.value)).toEqual(['left', 'main']);
    expect(builderTabs(undefined, 'Edit', undefined).map(t => t.value)).toEqual(['main']);
  });
});
