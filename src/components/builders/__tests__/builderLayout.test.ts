import { describe, expect, it, vi } from 'vitest';
import { AGENT_RULES_TABS, PANEL_LEFT, PANEL_RIGHT, builderTabs, gridRulesTabs, rememberTab, rememberedTab, sectionRow, validTab } from '../builderLayout';
import { RULE_TYPES } from '../../../gridRules/spec';
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

describe('the builders\' tab model', () => {
  it('Grid Rules: Presets · Neighbourhood · Born & Survive · Start · Brush · Colours for a Count rule', () => {
    expect(gridRulesTabs('count').map(t => t.label)).toEqual(['Presets', 'Neighbourhood', 'Born & Survive', 'Start', 'Brush', 'Colours']);
  });

  it('the rule tab is named for the rule type (always id "rule"); Neighbourhood only where cells are counted', () => {
    const labels = (t: Parameters<typeof gridRulesTabs>[0]) => gridRulesTabs(t).map(x => x.label);
    expect(labels('stages')).toEqual(['Presets', 'Neighbourhood', 'Stages', 'Start', 'Brush', 'Colours']);
    expect(labels('patterns')).toEqual(['Presets', 'Stencils', 'Start', 'Brush', 'Colours']);
    expect(labels('blocks')).toEqual(['Presets', 'Blocks', 'Start', 'Brush', 'Colours']);
    expect(labels('smooth')).toEqual(['Presets', 'Smooth', 'Start', 'Brush', 'Colours']);
    for (const t of RULE_TYPES) {
      const tabs = gridRulesTabs(t.value);
      expect(tabs.find(x => x.id === 'rule'), t.value).toBeTruthy();
      expect(new Set(tabs.map(x => x.id)).size).toBe(tabs.length);
    }
  });

  it('every tab has its one-line "How this works"', () => {
    for (const tab of [...RULE_TYPES.flatMap(t => gridRulesTabs(t.value)), ...AGENT_RULES_TABS]) {
      expect(tab.how, tab.id).toBeTruthy();
      expect(tab.how!.length).toBeGreaterThan(30);
      expect(tab.how!.length).toBeLessThan(170);
    }
  });

  it('Agent Rules: Species · Rules · Trails · Look', () => {
    expect(AGENT_RULES_TABS.map(t => t.label)).toEqual(['Species', 'Rules', 'Trails', 'Look']);
  });

  it('a phone shows one row: the left panel, the tabs, the right panel', () => {
    const row = sectionRow(gridRulesTabs('count'), undefined, 'Preview');
    expect(row.map(r => r.value)).toEqual(['presets', 'neighbourhood', 'rule', 'start', 'brush', 'colours', PANEL_RIGHT]);
    expect(row.at(-1)!.label).toBe('Preview');
    expect(sectionRow(AGENT_RULES_TABS).map(r => r.label)).toEqual(['Species', 'Rules', 'Trails', 'Look']);
    expect(sectionRow([{ id: 'shapes', label: 'Shapes' }, { id: 'recipe', label: 'Recipe', gapBefore: true }], 'Scene', 'Preview'))
      .toEqual([{ value: PANEL_LEFT, label: 'Scene' }, { value: 'shapes', label: 'Shapes' }, { value: 'recipe', label: 'Recipe', gapBefore: true }, { value: PANEL_RIGHT, label: 'Preview' }]);
  });

  it('the tab is remembered per builder, and falls back when it is not offered', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    const grid = gridRulesTabs('count').map(t => t.id);
    expect(rememberedTab('grid-rules', grid, 'presets')).toBe('presets');
    rememberTab('grid-rules', 'neighbourhood');
    rememberTab('agent-rules', 'trails');
    expect(rememberedTab('grid-rules', grid, 'presets')).toBe('neighbourhood');
    expect(rememberedTab('agent-rules', AGENT_RULES_TABS.map(t => t.id), 'rules')).toBe('trails');
    // A Smooth rule has no Neighbourhood tab.
    expect(rememberedTab('grid-rules', gridRulesTabs('smooth').map(t => t.id), 'presets')).toBe('presets');
    expect(validTab('neighbourhood', gridRulesTabs('smooth'), 'rule')).toBe('rule');
    expect(validTab('brush', gridRulesTabs('smooth'), 'rule')).toBe('brush');
    vi.unstubAllGlobals();
  });
});
