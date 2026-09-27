/**
 * Sketches saved as layer kinds: saving one, adding layers of it, editing the
 * kind (every layer) or one layer (it detaches), the file round trip through
 * parsePlayRecord, a missing kind degrading to a plain Script layer, the web
 * export carrying the kind, and the registry a plugin host would reuse.
 */
import { describe, expect, it } from 'vitest';
import { defaultLayer, emptyPlayRecord, layerNumericProps, parsePlayRecord, type PlayRecord } from '../../types/play';
import type { ScriptLayer } from '../../types/playLayers';
import { isLayerKindId, parseLayerKinds } from '../../types/layerKinds';
import { addKindLayer, addableKinds, createLayerKindRegistry, detachLayer, editKind, kindUses, removeKind, resetKindLayer, restyleKind, saveLayerAsKind } from '../layerKinds';
import { extractScriptParams } from '../../components/play/layers/scriptExamples';
import { buildPlayHtml, playBundle, type PlayHtmlInput } from '../exportHtml';
import { duplicateLayer, resetLayer } from '../../components/play/layerOps';

const CODE = `const params = {
  size: { value: 20, min: 2, max: 80, label: 'Size' },
  glow: { kind: 'toggle', value: false, label: 'Glow' },
  pop(s) { s.state.big = 1; },
};
function draw(s) { circle(width / 2, height / 2, s.params.size); }
`;
const defs = () => { const r = extractScriptParams(CODE); if (!r.ok) throw new Error(r.error); return r.defs; };

function withSketch(): PlayRecord {
  const l = { ...(defaultLayer('script', 'L1', 'Dot 1') as ScriptLayer), code: CODE, paramDefs: defs(), p_size: 33, p_glow: 1 } as ScriptLayer;
  return { ...emptyPlayRecord(), layers: [l] };
}
const LOOK = { name: 'Dot', hint: 'A dot in the middle', icon: 'spark' as const, colour: 'peach' as const };

describe('saving a sketch as a layer kind', () => {
  it('puts the kind in the file and makes the layer its first layer', () => {
    const { play, kind } = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1');
    expect(kind?.id).toBe('sketch:dot-1');
    expect(kind?.paramDefs.map(d => d.key)).toEqual(['size', 'glow', 'pop']);
    expect(play.layerKinds).toHaveLength(1);
    const l = play.layers[0] as ScriptLayer;
    expect(l.kindId).toBe('sketch:dot-1');
    // The layer keeps its own values.
    expect(l.p_size).toBe(33);
    expect(isLayerKindId(kind!.id)).toBe(true);
    expect(l.label).toBe('Dot 1');
    // A layer with the default name takes the kind's.
    const unnamed = { ...withSketch(), layers: withSketch().layers.map(x => ({ ...x, label: 'Script 3' })) };
    expect(saveLayerAsKind(unnamed, 'L1', { ...LOOK, name: 'Firefly' }).play.layers[0].label).toBe('Firefly 1');
  });

  it('adds layers of the kind, whose declared params are their numeric properties', () => {
    const saved = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1');
    const play = addKindLayer(saved.play, saved.kind!, 'L2');
    const l = play.layers[1] as ScriptLayer;
    expect(l).toMatchObject({ kind: 'script', kindId: 'sketch:dot-1', label: 'Dot 2', code: CODE, p_size: 20, p_glow: 0 });
    // The default starter's values are not carried over.
    expect((l as unknown as Record<string, unknown>).p_count).toBeUndefined();
    expect(layerNumericProps(l).map(p => p.key)).toEqual(['p_size', 'p_glow', 'opacity']);
    expect(kindUses(play, 'sketch:dot-1')).toBe(2);
    // Duplicating one keeps the kind; resetting goes back to the kind's values, not the starter sketch.
    const dup = duplicateLayer(play, 'L2');
    expect((dup.play.layers[2] as ScriptLayer).kindId).toBe('sketch:dot-1');
    const reset = resetLayer({ ...play, layers: play.layers.map(x => (x.id === 'L2' ? { ...x, p_size: 70 } as ScriptLayer : x)) }, 'L2');
    expect(reset.layers[1]).toMatchObject({ code: CODE, p_size: 20, kindId: 'sketch:dot-1' });
    expect(resetKindLayer(play, defaultLayer('script', 'x', 'x'))).toBeNull();
  });

  it('adding an installed kind copies it into a file that lacks it', () => {
    const kind = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1').kind!;
    const other = addKindLayer(emptyPlayRecord(), kind, 'A');
    expect(other.layerKinds?.map(k => k.id)).toEqual(['sketch:dot-1']);
    expect(addableKinds(emptyPlayRecord(), [{ def: kind, source: 'saved' }])).toEqual([{ def: kind, inFile: false }]);
    expect(addableKinds(other, [{ def: kind, source: 'saved' }])).toEqual([{ def: other.layerKinds![0], inFile: true }]);
  });
});

describe('editing a kind', () => {
  const two = () => { const s = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1'); return addKindLayer(s.play, s.kind!, 'L2'); };
  it('editing the kind changes every layer of it; each keeps its values and new params start at theirs', () => {
    const code = CODE.replace("  pop(s)", "  rings: { value: 3, min: 1, max: 9, step: 1 },\n  pop(s)");
    const r = extractScriptParams(code); if (!r.ok) throw new Error(r.error);
    const { play, kind } = editKind(two(), 'sketch:dot-1', code, r.defs);
    expect(kind?.version).toBe(2);
    for (const l of play.layers as ScriptLayer[]) { expect(l.code).toBe(code); expect(l.p_rings).toBe(3); }
    expect((play.layers[0] as ScriptLayer).p_size).toBe(33);
    expect((play.layers[1] as ScriptLayer).p_size).toBe(20);
  });
  it('editing this layer only detaches it; the others and the kind stay', () => {
    const play = detachLayer(two(), 'L1');
    expect((play.layers[0] as ScriptLayer).kindId).toBeUndefined();
    expect((play.layers[1] as ScriptLayer).kindId).toBe('sketch:dot-1');
    expect(play.layerKinds).toHaveLength(1);
  });
  it('restyling changes the look, not the layers; removing leaves plain Script layers with their code', () => {
    const r = restyleKind(two(), 'sketch:dot-1', { name: 'Big dot', colour: 'teal' });
    expect(r.kind).toMatchObject({ name: 'Big dot', colour: 'teal', icon: 'spark' });
    const gone = removeKind(r.play, 'sketch:dot-1');
    expect(gone.layerKinds).toBeUndefined();
    for (const l of gone.layers as ScriptLayer[]) { expect(l.kindId).toBeUndefined(); expect(l.code).toBe(CODE); }
  });
});

describe('layer kinds in files', () => {
  it('round-trips through parsePlayRecord', () => {
    const s = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1');
    const play = addKindLayer(s.play, s.kind!, 'L2');
    const back = parsePlayRecord(JSON.parse(JSON.stringify(play)));
    expect(back.layerKinds).toEqual(play.layerKinds);
    expect(back.layers).toEqual(play.layers);
  });
  it('a layer whose kind is missing degrades to a plain Script layer that keeps its code and values', () => {
    const s = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1');
    const raw = JSON.parse(JSON.stringify(s.play));
    delete raw.layerKinds;
    const back = parsePlayRecord(raw);
    const l = back.layers[0] as ScriptLayer;
    expect(l.kindId).toBeUndefined();
    expect(l.code).toBe(CODE);
    expect(l.p_size).toBe(33);
    expect(back.layerKinds).toBeUndefined();
  });
  it('the kind is the source of truth: a stale copy on a layer takes the kind’s code', () => {
    const s = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1');
    const raw = JSON.parse(JSON.stringify(s.play));
    raw.layers[0].code = 'function draw(s) {}';
    expect((parsePlayRecord(raw).layers[0] as ScriptLayer).code).toBe(CODE);
  });
  it('drops malformed kinds and fixes bad looks', () => {
    const kinds = parseLayerKinds([
      { id: 'no-colon', code: 'x' }, { id: 'sketch:a', code: 5 }, null,
      { id: 'sketch:b', name: '', code: 'function draw(s) {}', icon: 'rocket', colour: 'chartreuse', paramDefs: [{ key: '1bad' }], version: -3 },
      { id: 'sketch:b', name: 'dupe', code: '' },
    ]);
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toMatchObject({ id: 'sketch:b', name: 'Sketch', icon: 'code', colour: 'mauve', paramDefs: [], version: 1, clear: true, readPicture: false });
  });
});

describe('web export', () => {
  it('carries the kind and each layer’s code', () => {
    const s = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1');
    const play = addKindLayer(s.play, s.kind!, 'L2');
    const input: PlayHtmlInput = { title: 't', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play, aspect: '16:9' };
    const bundle = playBundle(input);
    expect(bundle.play.layerKinds?.[0].id).toBe('sketch:dot-1');
    expect(bundle.play.layers.every(l => l.kind === 'script' && l.code === CODE)).toBe(true);
    expect(buildPlayHtml(input)).toContain('"layerKinds":[{"id":"sketch:dot-1"');
  });
});

describe('the registry', () => {
  it('registers, replaces by id, sorts by name, persists and notifies', () => {
    const kind = saveLayerAsKind(withSketch(), 'L1', LOOK, 'sketch:dot-1').kind!;
    let saved: unknown = null, calls = 0;
    const reg = createLayerKindRegistry([], all => { saved = all.map(k => k.def.id); });
    const off = reg.subscribe(() => calls++);
    reg.register({ ...kind, id: 'sketch:z', name: 'Zed' }, 'saved');
    reg.register(kind, 'saved');
    reg.register({ ...kind, name: 'Dot again' }, 'plugin');
    expect(reg.list().map(k => [k.def.name, k.source])).toEqual([['Dot again', 'plugin'], ['Zed', 'saved']]);
    expect(saved).toEqual(['sketch:dot-1', 'sketch:z']);
    reg.unregister('sketch:z'); reg.unregister('nope');
    expect(reg.get('sketch:z')).toBeUndefined();
    off();
    reg.register({ ...kind, id: 'sketch:q' }, 'saved');
    expect(calls).toBe(4);
  });
});
