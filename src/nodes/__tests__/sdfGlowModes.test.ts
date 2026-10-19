/**
 * SDF Glow's Mode list (2026-10-19): short plain names with each formula in its hint, seven modes retired.
 * A retired mode is hidden from the list (and so from the Do bar, Randomize and builders), but a saved node set to
 * one compiles exactly as before and its card reads "… (retired)".
 */
import { describe, expect, it } from 'vitest';
import { getNodeDefinition } from '../definitions';
import { SDF_GLOW_MODES, SDF_GLOW_RETIRED_MODES } from '../definitions/effects';
import { GLOW_TYPES_OFFERED, glowTypeOptions } from '../definitions/combiners';
import { optionLabel, optionsShown } from '../../lib/selectOptions';
import type { GraphNode } from '../../types/nodeGraph';

const def = getNodeDefinition('light')!;
const mode = def.paramDefs!.mode;
const RETIRED = ['ring', 'exp', 'rim', 'invPow', 'gaussBump', 'wyvill', 'deep'];

const glsl = (m: string) => def.generateGLSL({
  id: 'g', type: 'light', position: { x: 0, y: 0 }, inputs: {}, outputs: {},
  params: { ...def.defaultParams, mode: m },
} as GraphNode, { distance: 'd' }).code;

describe('SDF Glow modes', () => {
  it('lists eleven modes with short plain names, formulas in their hints, ids unchanged', () => {
    expect(mode.options!.map(o => [o.value, o.label])).toEqual([
      ['glow', 'Glow'], ['haze', 'Haze'], ['bounded', 'Bounded'], ['simple', 'Simple'], ['halo', 'Halo'], ['soft', 'Soft'],
      ['gauss', 'Gaussian'], ['neon', 'Neon'], ['invsq', 'Inverse square'], ['cone', 'Cone'], ['point', 'Point light'],
    ]);
    for (const o of mode.options!) {
      expect(o.label, o.value).not.toMatch(/[()]/);
      expect(o.hint, o.value).toBeTruthy();
      expect(mode.help, o.value).toContain(`${o.label}: ${o.hint}`);
    }
    // No two names clash, even ignoring case.
    expect(new Set(mode.options!.map(o => o.label.toLowerCase())).size).toBe(mode.options!.length);
  });

  it('retires Ring light, Exponential, Rim, Bounded inverse power, Gaussian bump, Wyvill bump and Deep glow', () => {
    expect(mode.retiredOptions!.map(o => o.value)).toEqual(RETIRED);
    for (const v of RETIRED) expect(mode.options!.some(o => o.value === v), v).toBe(false);
    expect(SDF_GLOW_MODES.length + SDF_GLOW_RETIRED_MODES.length).toBe(18);
    expect(def.description).not.toMatch(/Ring|Wyvill|Deep glow|Exponential|Rim/);
  });

  it('a node set to a retired mode reads "(retired)" and keeps it in its list; others never see it', () => {
    expect(optionLabel(mode, 'ring')).toBe('Ring light (retired)');
    expect(optionLabel(mode, 'glow')).toBe('Glow');
    const shown = optionsShown(mode, mode.options!, 'deep');
    expect(shown.at(-1)).toMatchObject({ value: 'deep', label: 'Deep glow (retired)' });
    expect(optionsShown(mode, mode.options!, 'haze').map(o => o.value)).toEqual(mode.options!.map(o => o.value));
  });

  it('retired modes still compile to exactly the formulas they always had', () => {
    expect(glsl('ring')).toContain('float g_glow = ringLight(d, ');
    expect(glsl('exp')).toContain('float g_glow = exp(-0.35 * (max(d, 0.0) / max(');
    expect(glsl('rim')).toContain('float g_glow = pow(1.0 / (1.0 + abs(d) / max(');
    expect(glsl('invPow')).toMatch(/float g_glow = 1\.0 \/ \(1\.0 \+ pow\(max\(d, 0\.0\), [\d.]+\) \* /);
    expect(glsl('gaussBump')).toMatch(/float g_glow = exp\(-d \* d \* /);
    expect(glsl('wyvill')).toMatch(/float g_glow = pow\(max\(0\.0, 1\.0 - d \* d \* [\d.]+\), 3\.0\);/);
    expect(glsl('deep')).toContain('vec3 g_glow_tinted = deep_glow(d, ');
    expect(def.glslFunctionsFor!({ params: { mode: 'deep' }, inputs: {} } as unknown as GraphNode).join('')).toContain('vec3 deep_glow(');
    // and each kept mode is unchanged too
    expect(glsl('glow')).toContain('float g_glow = exp(-clamp(');
    expect(glsl('cone')).toMatch(/float g_glow = max\(0\.0, 1\.0 - d \* /);
  });

  it('the 2D Scene Builder\'s Glow type list drops Exponential and Rim, but shows a saved one as retired', () => {
    expect(GLOW_TYPES_OFFERED).toEqual(['halo', 'soft', 'gauss', 'neon', 'invsq']);
    expect(glowTypeOptions().map(o => o.label)).toEqual(['Halo', 'Soft', 'Gaussian', 'Neon', 'Inverse square']);
    expect(glowTypeOptions('rim').at(-1)).toEqual({ value: 'rim', label: 'Rim (retired)' });
  });
});
