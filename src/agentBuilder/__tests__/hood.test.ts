/**
 * Under the hood (docs/agent-builder.md), its pure part: what each state texture's channels hold and
 * how they are coloured (C and D only when the group keeps them), the trail channels' readers and
 * writers, the channels each section lights, the texel ↔ walker ↔ picture maps, the atlas, and one
 * walker's numbers decoded.
 */
import { describe, expect, it } from 'vitest';
import {
  AGE_SOFT, MAP_ID, TRAIL_RGB, decodeProbe, hoodAtlas, hoodHighlights, hoodTextures, hoodTileSpecs, hoodTrailChannels, indexOf, legendCss,
  ndcToView, positionToNdc, readoutLines, stopsAt, MAP_STOPS, texelAt, texelCentre, texelOf, tileSample, trailFit, viewToNdc, type HoodContext,
} from '../hood';
import { rulesTemplate } from '../../agentRules/templates';

const ctx = (o: Partial<HoodContext> = {}): HoodContext => ({
  d3: false, stateC: false, aspect: 16 / 9, speedMax: 0.3, lifeMax: 0,
  species: [{ name: 'Green', colour: [0.2, 0.9, 0.3] }, { name: 'Red', colour: [0.9, 0.2, 0.2] }], trailColours: TRAIL_RGB, ...o,
});

describe('what each texture holds', () => {
  it('2D: A = position x, position y, heading, age; B = velocity x, velocity y, speed, life; no C or D without per-walker state', () => {
    const t = hoodTextures(ctx());
    expect(t.map(x => x.id)).toEqual(['A', 'B']);
    expect(t[0].channels.map(c => [c.key, c.comp, c.label, c.map])).toEqual([
      ['posX', 0, 'position x', 'gradient'], ['posY', 1, 'position y', 'gradient'], ['heading', 2, 'heading', 'hue'], ['age', 3, 'age', 'soft'],
    ]);
    expect(t[1].channels.map(c => [c.key, c.comp, c.label, c.map])).toEqual([
      ['velX', 0, 'velocity x', 'diverge'], ['velY', 1, 'velocity y', 'diverge'], ['speed', 2, 'speed', 'ramp'], ['life', 3, 'life', 'life'],
    ]);
    // Ranges: positions ±aspect across and ±1 up, heading a full turn, speed from 0.
    expect(t[0].channels[0].range[1]).toBeCloseTo(16 / 9);
    expect(t[0].channels[1].range).toEqual([-1, 1]);
    expect(t[0].channels[2].range[1]).toBeCloseTo(Math.PI * 2);
    expect(t[1].channels[2].range).toEqual([0, 0.3]);
    expect(t[0].channels[0].lo).toBe('left −1.78');
    // Every texture has its line from the field guide.
    expect(t[0].learn).toMatch(/Each pixel is one walker/);
  });

  it('C (kind, memory x, memory y, own colour) and D (a deposit a trail channel, in its colour) only with per-walker state', () => {
    const t = hoodTextures(ctx({ stateC: true }));
    expect(t.map(x => x.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(t[2].channels.map(c => [c.key, c.map])).toEqual([['species', 'species'], ['memX', 'heat'], ['memY', 'heat'], ['colour', 'packed']]);
    expect(t[2].channels[0].range).toEqual([0, 1]);
    expect(t[2].channels[0].lo).toBe('Green');
    expect(t[3].channels.map(c => [c.key, c.map, c.colour])).toEqual([0, 1, 2, 3].map(i => [`dep${i}`, 'channel', TRAIL_RGB[i]]));
  });

  it('3D: A = x, y, z, age; B = velocity x, y, z, life (the heading is the velocity\'s way)', () => {
    const t = hoodTextures(ctx({ d3: true }));
    expect(t[0].channels.map(c => c.key)).toEqual(['posX', 'posY', 'posZ', 'age']);
    expect(t[1].channels.map(c => c.key)).toEqual(['velX', 'velY', 'velZ', 'life']);
  });

  it('age and life ramps reach the Emit\'s life; walkers that live for ever get a soft age ramp', () => {
    const t = hoodTextures(ctx({ lifeMax: 4 }));
    expect(t[0].channels[3]).toMatchObject({ map: 'ramp', range: [0, 4], hi: '4 s' });
    expect(t[1].channels[3]).toMatchObject({ map: 'life', range: [0, 4], lo: 'dead' });
    expect(hoodTextures(ctx())[0].channels[3]).toMatchObject({ map: 'soft', range: [0, AGE_SOFT] });
    expect(hoodTextures(ctx())[1].channels[3].hi).toBe('for ever');
  });

  it('each map has a legend: the shader\'s stops as a CSS gradient, the hue wheel, the kinds\' colours, a channel\'s colour', () => {
    const [A, B] = hoodTextures(ctx());
    expect(legendCss(A.channels[0])).toBe(`linear-gradient(90deg, ${MAP_STOPS.gradient.map(c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`).join(', ')})`);
    expect(legendCss(A.channels[2])).toMatch(/^linear-gradient\(90deg, rgb\(255,51,51\)/);
    expect(legendCss(B.channels[3])).toMatch(/#000 0 10%/);
    const C = hoodTextures(ctx({ stateC: true }))[2];
    expect(legendCss(C.channels[0], [[1, 0, 0], [0, 0, 1]])).toBe('linear-gradient(90deg, rgb(255,0,0) 0% 50%, rgb(0,0,255) 50% 100%)');
    expect(stopsAt(MAP_STOPS.ramp, 0)).toEqual(MAP_STOPS.ramp[0]);
    expect(stopsAt(MAP_STOPS.ramp, 1)).toEqual(MAP_STOPS.ramp[MAP_STOPS.ramp.length - 1]);
  });
});

describe('the trail field\'s channels', () => {
  it('named as the builder names them, in the chips\' colours, with what reads (Senses) and writes (Trail) each', () => {
    const slime = rulesTemplate('slime')!.set();
    const t = hoodTrailChannels(slime);
    expect(t.map(c => c.name)).toEqual(['trail 1', 'trail 2', 'trail 3', 'trail 4']);
    expect(t[0].readBy).toEqual(['Senses']);
    expect(t[0].writtenBy).toEqual(['Trail (Deposit)']);
    expect(t[1].readBy).toEqual([]);
    expect(t.map(c => c.colour)).toEqual(TRAIL_RGB);
  });

  it('two kinds: each reads and writes its own channel, named after the kind', () => {
    const set = rulesTemplate('slime')!.set();
    const two = { ...set, channels: ['green', 'red', '', ''], species: [set.species[0], { ...set.species[0], name: 'Red' }] };
    const t = hoodTrailChannels(two);
    expect(t[0].name).toBe('green');
    expect(t[0].readBy).toEqual([`${set.species[0].name}: Senses`]);
    expect(t[1].readBy).toEqual(['Red: Senses']);
    expect(t[1].writtenBy).toEqual(['Red: Trail (Deposit)']);
  });

  it('a velocity trail (Deposit What: Velocity) holds velocity x, y and a count', () => {
    const t = hoodTrailChannels(rulesTemplate('slime')!.set(), { velocity: true });
    expect(t.map(c => c.name)).toEqual(['velocity x', 'velocity y', 'count', 'channel 4']);
    expect(t[2].writtenBy).toContain('Deposit (velocity)');
  });
});

describe('the selected section lights the channels it uses', () => {
  const lit = (s: string | null, o: Parameters<typeof hoodHighlights>[1] = { d3: false }) => [...hoodHighlights(s, o)].sort();
  it('Senses → the trail channels it reads and the heading; Moving → velocity, speed and heading; Born / Life → age and life', () => {
    expect(lit('senses', { d3: false, reads: [0] })).toEqual(['heading', 'trail0']);
    expect(lit('moving')).toEqual(['heading', 'speed', 'velX', 'velY']);
    expect(lit('life')).toEqual(['age', 'life']);
    expect(lit('born')).toEqual(['age', 'life', 'posX', 'posY']);
    expect(lit('turning')).toEqual(['heading']);
    expect(lit('trail', { d3: false, writes: [2] })).toEqual(['dep0', 'dep1', 'dep2', 'dep3', 'trail2']);
    expect(lit('look')).toEqual(['age', 'colour', 'species']);
  });
  it('a kind chip → the kind (species); in 3D the heading and speed are the velocity', () => {
    expect(lit(null, { d3: false, kindPicked: true })).toEqual(['species']);
    expect(lit('turning', { d3: true })).toEqual(['velX', 'velY', 'velZ']);
    expect(lit('moving', { d3: true })).toEqual(['velX', 'velY', 'velZ']);
    expect(lit('advanced')).toEqual([]);
  });
});

describe('texel ↔ walker ↔ picture', () => {
  it('walker i sits at (i mod side, i ÷ side) and back', () => {
    expect(texelOf(1026, 1024)).toEqual({ x: 2, y: 1 });
    expect(indexOf(2, 1, 1024)).toBe(1026);
    for (const i of [0, 511, 512, 262143, 77777]) { const t = texelOf(i, 512); expect(indexOf(t.x, t.y, 512)).toBe(i); }
  });
  it('a point on a thumbnail is a texel (row 0 at the top); a texel\'s centre goes back to the same texel', () => {
    expect(texelAt(0, 0, 512)).toEqual({ x: 0, y: 0 });
    expect(texelAt(0.999, 0.999, 512)).toEqual({ x: 511, y: 511 });
    expect(texelAt(1.2, -0.1, 512)).toEqual({ x: 511, y: 0 });
    const c = texelCentre(303, 251, 512);
    expect(texelAt(c.u, c.v, 512)).toEqual({ x: 303, y: 251 });
    // A thumbnail pixel shows the walker under its centre: 128 px over 512 texels → every 4th.
    expect(tileSample(0, 0, 128, 512)).toEqual({ x: 2, y: 2 });
    expect(tileSample(127, 127, 128, 512)).toEqual({ x: 510, y: 510 });
  });
  it('a 2D position lands on the picture as Draw agents puts it, and a click maps back to clip space', () => {
    const rect = { x: 100, y: 20, w: 640, h: 360 };
    const ndc = positionToNdc({ x: 16 / 9, y: 1 }, 16 / 9);
    expect(ndc).toEqual({ x: 1, y: 1 });
    expect(ndcToView(rect, ndc)).toEqual({ x: 740, y: 20 });
    expect(ndcToView(rect, { x: 0, y: 0 })).toEqual({ x: 420, y: 200 });
    expect(viewToNdc(rect, { x: 420, y: 200 })).toEqual({ x: 0, y: 0 });
    const p = viewToNdc(rect, ndcToView(rect, { x: -0.3, y: 0.7 }));
    expect(p.x).toBeCloseTo(-0.3); expect(p.y).toBeCloseTo(0.7);
  });
});

describe('the atlas', () => {
  it('a row a texture (R, G, B, A across), then the trail channels in the picture\'s shape; specs in the same order', () => {
    const tex = hoodTextures(ctx({ stateC: true }));
    const trails = hoodTrailChannels(rulesTemplate('slime')!.set());
    const a = hoodAtlas(tex, 4, 16 / 9, 128);
    expect(a.W).toBe(512);
    expect(a.H).toBe(4 * 128 + 72);
    expect(a.tiles.slice(0, 5).map(t => [t.key, t.x, t.y])).toEqual([['posX', 0, 0], ['posY', 128, 0], ['heading', 256, 0], ['age', 384, 0], ['velX', 0, 128]]);
    expect(a.tiles[16]).toEqual({ key: 'trail0', x: 0, y: 512, w: 128, h: 72 });
    const specs = hoodTileSpecs(tex, trails);
    expect(specs).toHaveLength(a.tiles.length);
    expect(specs[2]).toMatchObject({ source: 0, comp: 2, map: MAP_ID.hue });
    expect(specs[8]).toMatchObject({ source: 2, comp: 0, map: MAP_ID.species });
    expect(specs[16]).toMatchObject({ source: 4, comp: 0, map: MAP_ID.channel, colour: TRAIL_RGB[0] });
    expect(trailFit(0.5, 68)).toEqual({ w: 34, h: 68 });
  });
});

describe('one walker\'s numbers', () => {
  const probe = (A: number[], B: number[], C = [0, 0, 0, 0], D = [0, 0, 0, 0], P = [0, 0, 0, 0]) => Float32Array.from([...A, ...B, ...C, ...D, ...P]);
  it('2D: position, heading in degrees, speed, age, life (for ever), kind by index without C, where it lands', () => {
    const r = decodeProbe(probe([0.5, -0.25, Math.PI / 2, 3], [0, 0.2, 0.2, 1e30], undefined, undefined, [0.28, -0.25, 1, 0]), { index: 5, side: 512, d3: false, stateC: false, species: 2 });
    expect(r).toMatchObject({ index: 5, texel: { x: 5, y: 0 }, alive: true, pos: [0.5, -0.25], speed: expect.closeTo(0.2), age: 3, life: Infinity, species: 1 });
    expect(r.heading).toBeCloseTo(90);
    expect(r.ndc?.x).toBeCloseTo(0.28);
    expect(r.memory).toBeUndefined();
    const lines = readoutLines(r, ['Green', 'Red']);
    expect(lines.find(l => l[0] === 'life')?.[1]).toBe('for ever');
    expect(lines.find(l => l[0] === 'kind')?.[1]).toBe('Red');
    expect(lines.find(l => l[0] === 'heading')?.[1]).toBe('90°');
  });
  it('with C and D: kind from C, memory, its deposit; dead when life ≤ 0; out of view has no point', () => {
    const r = decodeProbe(probe([0, 0, -Math.PI / 2, 1], [0, 0, 0, 0], [1, 0.5, 2, 0], [1, 0, 0, 0.5]), { index: 9, side: 4, d3: false, stateC: true, species: 2 });
    expect(r).toMatchObject({ alive: false, species: 1, memory: [0.5, 2], deposit: [1, 0, 0, 0.5], ndc: null, texel: { x: 1, y: 2 } });
    expect(r.heading).toBeCloseTo(270);
    expect(readoutLines(r).find(l => l[0] === 'life')?.[1]).toBe('dead');
  });
  it('3D: x, y, z; speed and heading from the velocity', () => {
    const r = decodeProbe(probe([0.1, 0.2, 0.3, 2], [0, 3, 4, 5]), { index: 0, side: 4, d3: true, stateC: false, species: 1 });
    expect(r.pos).toEqual([expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3)]);
    expect(r.speed).toBeCloseTo(5);
    expect(r.heading).toBeCloseTo(90);
    expect(r.life).toBe(5);
  });
});
