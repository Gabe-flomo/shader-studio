/**
 * The Stops Palette card's gradient bar writes the node's params exactly as
 * the old Stops count and swatch rows did: the saved shape is unchanged and
 * the GLSL for a given stop list is byte-identical to before the bar
 * (fixtures/stopPaletteGlsl.json was dumped from the definition before it).
 */
import { describe, expect, it } from 'vitest';
import baseline from './fixtures/stopPaletteGlsl.json';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { STOP_PALETTE_MAX } from '../../nodes/definitions/color';
import { evenStops, insertColourAt, removeStop, reorderColours, type RGB } from '../../components/ui/gradientStops';
import { libraryPaletteColours, stopColoursOf, stopParamsOf, stopsOfNode } from '../../components/NodeGraph/stopPaletteModel';

const def = getNodeDefinition('stopPalette')!;
const COLORS: RGB[] = [[0.1, 0.2, 0.3], [0.9, 0.5, 0.1], [0.2, 0.8, 0.4], [0.05, 0.05, 0.1], [1, 1, 1], [0.5, 0.25, 0.75], [0.33, 0.66, 0.99]];

const nodeWith = (params: Record<string, unknown>): GraphNode => ({
  id: 'sp', type: 'stopPalette', position: { x: 0, y: 0 },
  inputs: { value: { type: 'float', label: 'Angle', connection: { nodeId: 'len', outputKey: 'output' } }, anim: { type: 'float', label: 'Angle offset' } },
  outputs: { color: { type: 'vec3', label: 'Color' } }, params,
});
const glsl = (node: GraphNode) => def.generateGLSL(node, { value: 'len_output' } as never).code;

describe('Stops Palette bar', () => {
  it('generates byte-identical GLSL from a stop list, for every wrap and blend', () => {
    for (const [key, expected] of Object.entries(baseline)) {
      const [wrap, blend] = key.split('/');
      const params = { ...def.defaultParams, ...stopParamsOf(evenStops(COLORS)), wrap, blend, scale: 1.5, speed: 0.3 };
      expect(glsl(nodeWith(params)), key).toBe(expected);
    }
  });

  it('writes only the params the old rows wrote: the count and one colour per stop', () => {
    const p = stopParamsOf(evenStops(COLORS));
    expect(Object.keys(p).sort()).toEqual(['color0', 'color1', 'color2', 'color3', 'color4', 'color5', 'color6', 'stops'].sort());
    expect(p.stops).toBe('7');
    expect(p.color6).toEqual([0.33, 0.66, 0.99]);
    // The old card wrote via updateNodeParams too: an old save and a new one look the same.
    const old: Record<string, unknown> = { ...def.defaultParams, stops: '7' };
    COLORS.forEach((c, i) => { old[`color${i}`] = c; });
    expect({ ...def.defaultParams, ...p }).toEqual(old);
  });

  it('reads a node back into evenly spaced stops and round-trips', () => {
    const node = nodeWith({ ...def.defaultParams, ...stopParamsOf(evenStops(COLORS)) });
    const stops = stopsOfNode(node);
    expect(stops.map(s => s.color)).toEqual(COLORS);
    expect(stops.map(s => s.pos)).toEqual(COLORS.map((_, i) => i / 6));
    expect(stopParamsOf(stops)).toEqual(stopParamsOf(evenStops(COLORS)));
    // A save with no colours of its own reads the definition's defaults.
    expect(stopColoursOf({ stops: '3' })).toEqual([def.defaultParams!.color0, def.defaultParams!.color1, def.defaultParams!.color2]);
  });

  it('adding, reordering and removing on the bar keep the shader in step', () => {
    const start = nodeWith({ ...def.defaultParams, ...stopParamsOf(evenStops(COLORS)) });
    const added = insertColourAt(stopColoursOf(start.params), 0.25, STOP_PALETTE_MAX)!;
    const n1 = nodeWith({ ...start.params, ...stopParamsOf(evenStops(added.colors)) });
    expect(n1.params.stops).toBe('8');
    expect(glsl(n1)).toContain('vec3 sp_c7 =');
    expect(glsl(n1)).toContain('* 8.0, 8.0 - 0.0001');
    const moved = reorderColours(stopColoursOf(n1.params), 0, 7);
    const n2 = nodeWith({ ...n1.params, ...stopParamsOf(evenStops(moved)) });
    expect(glsl(n2)).toContain('vec3 sp_c7 = vec3(0.1, 0.2, 0.3);');
    const fewer = removeStop(stopsOfNode(n2), 7)!;
    const n3 = nodeWith({ ...n2.params, ...stopParamsOf(fewer.stops) });
    expect(n3.params.stops).toBe('7');
    expect(glsl(n3)).not.toContain('sp_c7');
    // Colours past the count stay in the params, unread, as they always did.
    expect(n3.params.color7).toEqual([0.1, 0.2, 0.3]);
  });

  it('never writes more than the node holds', () => {
    const many = evenStops(Array.from({ length: 40 }, (_, i) => [i / 40, 0, 0] as RGB));
    const p = stopParamsOf(many);
    expect(p.stops).toBe(String(STOP_PALETTE_MAX));
    expect(p[`color${STOP_PALETTE_MAX}`]).toBeUndefined();
  });
  it('a Library palette (Present and Play backgrounds) comes over as one stop per colour', () => {
    const even = { stops: evenStops([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as RGB[]), style: 'gradient' as const };
    expect(libraryPaletteColours(even)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    // Unevenly placed stops are sampled where they sit along the bar.
    const uneven = { stops: [{ pos: 0, color: [1, 0, 0] as RGB }, { pos: 0.25, color: [0, 1, 0] as RGB }, { pos: 1, color: [0, 0, 1] as RGB }], style: 'gradient' as const };
    const c = libraryPaletteColours(uneven);
    expect(c[0]).toEqual([1, 0, 0]);
    expect(c[2]).toEqual([0, 0, 1]);
    expect(c[1][1]).toBeCloseTo(2 / 3);
    expect(c[1][2]).toBeCloseTo(1 / 3);
    expect(libraryPaletteColours({ stops: even.stops, style: 'bands' })).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(libraryPaletteColours({ stops: evenStops([[0, 0, 0]] as RGB[]), style: 'gradient' })).toHaveLength(2);
  });
});
