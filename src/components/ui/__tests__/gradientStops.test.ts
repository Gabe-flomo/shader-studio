/**
 * The gradient bar's stop logic (ui/gradientStops.ts): adding, moving,
 * removing and selecting stops, the cap on how many, and the evenly spaced
 * layout the Stops Palette node uses.
 */
import { describe, expect, it } from 'vitest';
import {
  addStop, addStopBeside, colourAt, distributeStops, evenPositions, evenStops, gradientCss, insertColourAt, limitStops, moveStop,
  nudgeStop, removeStop, reorderColours, reverseStops, setStopColour, setStopPos, slotAt, sortStops, type GradientStop, type RGB,
} from '../gradientStops';

const RED: RGB = [1, 0, 0], BLUE: RGB = [0, 0, 1], GREEN: RGB = [0, 1, 0], WHITE: RGB = [1, 1, 1];
const two: GradientStop[] = [{ pos: 0, color: RED }, { pos: 1, color: BLUE }];
const three: GradientStop[] = [{ pos: 0, color: RED }, { pos: 0.5, color: GREEN }, { pos: 1, color: BLUE }];

describe('colourAt', () => {
  it('blends between the stops around t, and holds the ends', () => {
    expect(colourAt(two, 0.5)).toEqual([0.5, 0, 0.5]);
    expect(colourAt(two, -1)).toEqual(RED);
    expect(colourAt(two, 2)).toEqual(BLUE);
    expect(colourAt(three, 0.25)).toEqual([0.5, 0.5, 0]);
  });
  it('with bands gives the colour of the stop before t', () => {
    expect(colourAt(three, 0.49, 'bands')).toEqual(RED);
    expect(colourAt(three, 0.5, 'bands')).toEqual(GREEN);
    expect(colourAt(three, 0.99, 'bands')).toEqual(GREEN);
  });
});

describe('adding', () => {
  it('adds a stop at the clicked place in the colour the bar had there, and selects it', () => {
    const r = addStop(two, 0.5, 8)!;
    expect(r.stops.map(s => s.pos)).toEqual([0, 0.5, 1]);
    expect(r.stops[1].color).toEqual([0.5, 0, 0.5]);
    expect(r.index).toBe(1);
  });
  it('refuses once the bar has the most stops allowed', () => {
    expect(addStop(three, 0.25, 3)).toBeNull();
    expect(addStop(three, 0.25, 4)).not.toBeNull();
  });
  it('adds beside the chosen stop, halfway to the next one (or the one before at the end)', () => {
    expect(addStopBeside(three, 0, 8)!.stops.map(s => s.pos)).toEqual([0, 0.25, 0.5, 1]);
    const end = addStopBeside(three, 2, 8)!;
    expect(end.stops.map(s => s.pos)).toEqual([0, 0.5, 0.75, 1]);
    expect(end.index).toBe(2);
  });
});

describe('moving', () => {
  it('a dragged stop stays between its neighbours so the handles keep their order', () => {
    expect(moveStop(three, 1, 0.9)[1].pos).toBe(0.9);
    expect(moveStop(three, 0, 0.7)[0].pos).toBe(0.5);
    expect(moveStop(three, 2, 0.1)[2].pos).toBe(0.5);
    expect(moveStop(three, 1, 5)[1].pos).toBe(1);
  });
  it('a typed place re-sorts and says where the stop went', () => {
    const r = setStopPos(three, 0, 0.8);
    expect(r.stops.map(s => s.pos)).toEqual([0.5, 0.8, 1]);
    expect(r.stops[1].color).toEqual(RED);
    expect(r.index).toBe(1);
  });
  it('nudges by a step and clamps to the bar', () => {
    expect(nudgeStop(three, 1, 0.01).stops[1].pos).toBeCloseTo(0.51);
    expect(nudgeStop(three, 2, 0.1).stops[2].pos).toBe(1);
    expect(nudgeStop(three, 0, -0.1).stops[0].pos).toBe(0);
  });
  it('sorts stably and clamps places to 0..1', () => {
    const s = sortStops([{ pos: 2, color: RED }, { pos: -1, color: BLUE }, { pos: 0.5, color: GREEN }, { pos: 0.5, color: WHITE }]);
    expect(s.map(x => x.pos)).toEqual([0, 0.5, 0.5, 1]);
    expect(s[1].color).toEqual(GREEN);
    expect(s[2].color).toEqual(WHITE);
  });
});

describe('removing and recolouring', () => {
  it('removes a stop and selects the one before it, never below the minimum', () => {
    const r = removeStop(three, 1)!;
    expect(r.stops.map(s => s.pos)).toEqual([0, 1]);
    expect(r.index).toBe(1);
    expect(removeStop(three, 2)!.index).toBe(1);
    expect(removeStop(three, 0)!.index).toBe(0);
    expect(removeStop(two, 0)).toBeNull();
    expect(removeStop(three, 7)).toBeNull();
  });
  it('recolours one stop, clamping the channels', () => {
    expect(setStopColour(two, 1, [2, -1, 0.5])[1].color).toEqual([1, 0, 0.5]);
    expect(setStopColour(two, 1, GREEN)[0].color).toEqual(RED);
  });
  it('reverses and distributes', () => {
    const r = reverseStops([{ pos: 0, color: RED }, { pos: 0.2, color: GREEN }, { pos: 1, color: BLUE }]);
    expect(r.map(s => s.pos)).toEqual([0, 0.8, 1]);
    expect(r[0].color).toEqual(BLUE);
    expect(distributeStops([{ pos: 0, color: RED }, { pos: 0.2, color: GREEN }, { pos: 1, color: BLUE }]).map(s => s.pos)).toEqual([0, 0.5, 1]);
  });
});

describe('limitStops', () => {
  it('leaves few stops alone and resamples many evenly along the same colours', () => {
    expect(limitStops(three, 8)).toEqual(three);
    const many = evenStops(Array.from({ length: 32 }, (_, i) => [i / 31, 0, 1 - i / 31] as RGB));
    const eight = limitStops(many, 8);
    expect(eight).toHaveLength(8);
    expect(eight[0].color).toEqual([0, 0, 1]);
    expect(eight[7].color).toEqual([1, 0, 0]);
    expect(eight[4].pos).toBeCloseTo(4 / 7);
    expect(eight[4].color[0]).toBeCloseTo(4 / 7);
  });
});

describe('evenly spaced stops (the Stops Palette)', () => {
  it('places n stops from 0 to 1', () => {
    expect(evenPositions(3)).toEqual([0, 0.5, 1]);
    expect(evenPositions(1)).toEqual([0]);
    expect(evenStops([RED, BLUE]).map(s => s.pos)).toEqual([0, 1]);
  });
  it('a drag lands in the nearest slot', () => {
    expect(slotAt(5, 0.3)).toBe(1);
    expect(slotAt(5, 0.4)).toBe(2);
    expect(slotAt(5, 2)).toBe(4);
    expect(slotAt(5, -1)).toBe(0);
  });
  it('reorders one colour, the others closing up', () => {
    expect(reorderColours(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderColours(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderColours(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
  it('inserts a stop between the two it fell between, in the colour the bar had there', () => {
    const r = insertColourAt([RED, GREEN, BLUE], 0.25, 32)!;
    expect(r.index).toBe(1);
    expect(r.colors).toHaveLength(4);
    expect(r.colors[1]).toEqual([0.5, 0.5, 0]);
    expect(insertColourAt([RED, GREEN, BLUE], 0.9, 32)!.index).toBe(2);
    expect(insertColourAt([RED, GREEN, BLUE], 1, 32)!.index).toBe(3);
    expect(insertColourAt([RED, GREEN, BLUE], 0.6, 32, 'bands')!.colors[2]).toEqual(GREEN);
  });
  it('refuses at the most stops allowed', () => {
    expect(insertColourAt([RED, GREEN, BLUE], 0.5, 3)).toBeNull();
  });
});

describe('gradientCss', () => {
  it('paints stops left to right, bands as hard edges', () => {
    expect(gradientCss(two)).toBe('linear-gradient(90deg, rgb(255 0 0) 0%, rgb(0 0 255) 100%)');
    expect(gradientCss(three, 'bands')).toBe('linear-gradient(90deg, rgb(255 0 0) 0% 50%, rgb(0 255 0) 50% 100%, rgb(0 0 255) 100% 100%)');
    expect(gradientCss([])).toBe('transparent');
  });
});
