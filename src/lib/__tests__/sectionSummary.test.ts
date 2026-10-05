import { describe, expect, it } from 'vitest';
import { summarizeSection, sectionSwitchKey, switchOnPatch } from '../sectionSummary';
import { isParamVisible } from '../../compiler/uniformPatcher';
import { TimeCubeViewNode, TimeCubeNode } from '../../nodes/definitions/timeCube';
import { getNodeDefinition } from '../../nodes/definitions';
import type { NodeDefinition, ParamDef } from '../../types/nodeGraph';

const sectionKeys = (def: NodeDefinition, section: string) =>
  Object.entries(def.paramDefs ?? {}).filter(([, pd]) => pd.section === section).map(([k]) => k);

const summary = (def: NodeDefinition, section: string, params: Record<string, unknown>) =>
  summarizeSection(sectionKeys(def, section), def.paramDefs ?? {}, params, def.defaultParams);

describe('summarizeSection', () => {
  const view = TimeCubeViewNode;

  it('reads a feature section as Off while its switch is off, counting nothing hidden', () => {
    const s = summary(view, 'Highlights', {});
    expect(s.on).toBe(false);
    expect(s.controls).toBe(1); // only the switch shows
    expect(s.text).toBe('Off');
  });

  it('switching a bool feature on shows every control in the section', () => {
    const keys = sectionKeys(view, 'Highlights');
    const s = summary(view, 'Highlights', { highlights: true });
    expect(s.on).toBe(true);
    expect(s.controls).toBe(keys.length);
    expect(s.text).toBe(`On · ${keys.length} controls`);
  });

  it('counts changed controls among the visible ones only, not the switch', () => {
    expect(summary(view, 'Highlights', { highlights: true, hlCount: 5 }).text).toMatch(/^On · \d+ controls · 1 changed$/);
    // A change to a hidden control does not show while the feature is off.
    expect(summary(view, 'Highlights', { hlCount: 5 }).text).toBe('Off');
  });

  it('treats a setting an older save never had as its default (not changed)', () => {
    const s = summary(view, 'Look', {});
    expect(s.changed).toBe(0);
    expect(s.text).toBe(`${sectionKeys(view, 'Look').length} controls`);
    expect(summary(view, 'Look', { contrast: 1.4 }).text).toBe(`${sectionKeys(view, 'Look').length} controls · 1 changed`);
  });

  it('a select with an Off choice that gates its section is a feature section (Focus, Colour key)', () => {
    expect(summary(view, 'Focus', {}).text).toBe('Off');
    expect(summary(view, 'Focus', { dof: 'slice' }).text).toBe('On · 5 controls');
    expect(summary(view, 'Colour key', {}).text).toBe('Off');
    expect(summary(view, 'Colour key', { keyMode: 'color' }).on).toBe(true);
  });

  it('a section whose other controls are not gated stays an ordinary count (Outline)', () => {
    expect(sectionSwitchKey(sectionKeys(view, 'Outline'), view.paramDefs ?? {})).toBeUndefined();
    expect(summary(view, 'Outline', {}).text).toBe(`${sectionKeys(view, 'Outline').length} controls`);
  });

  it('excludes controls a select hides (Slice in Slice mode hides the Flow controls)', () => {
    const all = sectionKeys(view, 'Slice').length;
    expect(summary(view, 'Slice', { timeMode: 'slice' }).controls).toBe(all - 3);
    expect(summary(view, 'Slice', { timeMode: 'flow' }).controls).toBe(all);
  });

  it('counts a pair row once, changed when either half is', () => {
    const defs: Record<string, ParamDef> = {
      lo: { label: 'Lo', type: 'float', section: 'R', pair: { with: 'hi', label: 'Range' } },
      hi: { label: 'Hi', type: 'float', section: 'R' },
      gain: { label: 'Gain', type: 'float', section: 'R' },
    };
    const d = { lo: 0, hi: 1, gain: 1 };
    expect(summarizeSection(['lo', 'hi', 'gain'], defs, {}, d).text).toBe('2 controls');
    expect(summarizeSection(['lo', 'hi', 'gain'], defs, { hi: 0.5 }, d).text).toBe('2 controls · 1 changed');
    expect(summarizeSection(['gain'], { gain: defs.gain }, {}, d).text).toBe('1 control');
  });

  it('Time Cube source sections read sensibly', () => {
    const s = summary(TimeCubeNode, 'Order', {});
    expect(s.on).toBeUndefined();
    expect(s.text).toMatch(/^\d+ controls?$/);
  });
});

describe('bool showWhen gates (toggle → visibility)', () => {
  it('a bool param stored as true shows the controls gated on it', () => {
    const hlCount = TimeCubeViewNode.paramDefs!.hlCount;
    expect(isParamVisible(hlCount, { highlights: false }, TimeCubeViewNode.defaultParams)).toBe(false);
    expect(isParamVisible(hlCount, {}, TimeCubeViewNode.defaultParams)).toBe(false);
    expect(isParamVisible(hlCount, { highlights: true }, TimeCubeViewNode.defaultParams)).toBe(true);
    for (const [gate, key] of [['motion', 'liftUp'], ['effects', 'fxHue']] as const) {
      expect(isParamVisible(TimeCubeViewNode.paramDefs![key], { [gate]: true }, TimeCubeViewNode.defaultParams)).toBe(true);
    }
  });

  it('every bool-gated showWhen in the registry names a real bool and its value as a string', () => {
    // A guard against writing showWhen: { value: true }: the gate is compared as a string.
    for (const type of ['timeCubeView', 'timeCube']) {
      const def = getNodeDefinition(type)!;
      for (const pd of Object.values(def.paramDefs ?? {})) {
        if (!pd.showWhen) continue;
        const gate = def.paramDefs?.[pd.showWhen.param];
        expect(gate, `${type}: ${pd.label} gated on ${pd.showWhen.param}`).toBeDefined();
        if (gate?.type === 'bool') expect(['true', 'false']).toEqual(expect.arrayContaining([pd.showWhen.value].flat()));
      }
    }
  });
});

describe('switchOnPatch', () => {
  const view = TimeCubeViewNode;
  const defs = view.paramDefs!;

  it('turning Frame motion / Frame effects on gives still-default controls a visible start', () => {
    const motion = switchOnPatch('motion', defs.motion, {}, view.defaultParams);
    expect(motion.motion).toBe(true);
    expect(Object.keys(motion).filter(k => k !== 'motion').every(k => motion[k] !== view.defaultParams![k])).toBe(true);
    expect(Object.keys(motion).length).toBeGreaterThan(1);
    const fx = switchOnPatch('effects', defs.effects, {}, view.defaultParams);
    expect(Object.keys(fx).length).toBeGreaterThan(1);
  });

  it('keeps a value the user already set', () => {
    const patch = switchOnPatch('motion', defs.motion, { liftUp: -0.4 }, view.defaultParams);
    expect('liftUp' in patch).toBe(false);
  });

  it('a switch without starting values only writes itself', () => {
    expect(switchOnPatch('highlights', defs.highlights, {}, view.defaultParams)).toEqual({ highlights: true });
  });

  it('every feature switch on Time Cube View has something visible once on', () => {
    // Highlights draws with its defaults (Count 3); motion and effects need their starting values.
    for (const key of ['motion', 'effects']) {
      const on = { ...view.defaultParams, ...switchOnPatch(key, defs[key], {}, view.defaultParams) };
      const section = defs[key].section!;
      expect(summary(view, section, on).changed, section).toBeGreaterThan(0);
    }
    expect(view.defaultParams!.hlCount).toBeGreaterThan(0);
  });
});
