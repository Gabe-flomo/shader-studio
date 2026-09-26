/**
 * The Script layer: its saved form round-trips (code, declared sliders and
 * their p_ values), the sliders it declares become numeric props a control
 * can drive, the declaration parser reads a params object leniently, and
 * the status store only notifies on change.
 */
import { describe, expect, it } from 'vitest';
import { defaultLayer, parseLayer, layerNumericProps, LAYER_NUMERIC_PROPS, DEFAULT_SCRIPT_PARAMS, type ScriptLayer } from '../../types/playLayers';
import { extractScriptParams, SCRIPT_EXAMPLES } from '../../components/play/layers/scriptExamples';
import { setScriptStatus, scriptStatusVersion } from '../scriptStatus';

describe('script layer', () => {
  it('starts with the starter sketch and its three sliders', () => {
    const l = defaultLayer('script', 's1', 'Script') as ScriptLayer;
    expect(l.code).toContain('function draw(s)');
    expect(l.paramDefs.map(d => d.key)).toEqual(['count', 'size', 'speed']);
    expect(l.clear).toBe(true);
  });

  it('round-trips through the schema, keeping p_ values and dropping junk declarations', () => {
    const raw = {
      id: 's2', kind: 'script', label: 'Mine', code: 'function draw(s) {}', clear: false, readPicture: true, opacity: 0.5, blend: 'screen',
      paramDefs: [{ key: 'speed', label: 'Speed', value: 2, min: 0, max: 4, step: 0.1 }, { key: 'bad key', label: 'x', value: 1, min: 0, max: 1 }, 'nope'],
      p_speed: 3, p_stale: 0.25, p_bad: 'no', other: 1,
    };
    const l = parseLayer(raw) as ScriptLayer;
    expect(l.kind).toBe('script');
    expect(l.paramDefs).toEqual([{ key: 'speed', label: 'Speed', value: 2, min: 0, max: 4, step: 0.1 }]);
    expect(l.p_speed).toBe(3);
    expect((l as unknown as Record<string, unknown>).p_stale).toBe(0.25);
    expect((l as unknown as Record<string, unknown>).p_bad).toBeUndefined();
    expect((l as unknown as Record<string, unknown>).other).toBeUndefined();
    expect(l.readPicture).toBe(true);
  });

  it('declared sliders are numeric props (p_<key>) ahead of the kind’s own', () => {
    const l = defaultLayer('script', 's3', 'Script') as ScriptLayer;
    const props = layerNumericProps(l);
    expect(props.map(p => p.key)).toEqual(['p_count', 'p_size', 'p_speed', 'opacity']);
    expect(props[0]).toMatchObject({ label: 'Dots', min: 1, max: 200, step: 1 });
    expect(LAYER_NUMERIC_PROPS.script.map(p => p.key)).toEqual(['opacity']);
    // Other kinds are unchanged.
    expect(layerNumericProps(defaultLayer('null', 'n', 'Null'))).toBe(LAYER_NUMERIC_PROPS.null);
  });

  it('reads a params object leniently: bare numbers, missing labels, clamped values', () => {
    const r = extractScriptParams(`const params = { a: 3, b: { value: 9, min: 0, max: 5, label: 'Bee', step: 0.5 }, 'not ok': 1 };\nfunction draw(s) {}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.defs).toEqual([
      { key: 'a', label: 'a', value: 1, min: 0, max: 1 },
      { key: 'b', label: 'Bee', value: 5, min: 0, max: 5, step: 0.5 },
    ]);
    expect(extractScriptParams('function draw(s) {}')).toEqual({ ok: true, defs: [] });
    const bad = extractScriptParams('function draw(s) { oops(');
    expect(bad.ok).toBe(false);
  });

  it('every starter example declares parseable sliders and a draw function', () => {
    for (const ex of SCRIPT_EXAMPLES) {
      const r = extractScriptParams(ex.code);
      expect(r.ok, ex.name).toBe(true);
      expect(ex.code).toContain('function draw(s)');
    }
    const dots = extractScriptParams(SCRIPT_EXAMPLES[0].code);
    if (dots.ok) expect(dots.defs).toEqual(DEFAULT_SCRIPT_PARAMS);
  });

  it('status store notifies only on change', () => {
    const v0 = scriptStatusVersion();
    setScriptStatus('x', null);
    expect(scriptStatusVersion()).toBe(v0);
    setScriptStatus('x', 'Compile: boom');
    setScriptStatus('x', 'Compile: boom');
    expect(scriptStatusVersion()).toBe(v0 + 1);
    setScriptStatus('x', null);
    expect(scriptStatusVersion()).toBe(v0 + 2);
  });
});
