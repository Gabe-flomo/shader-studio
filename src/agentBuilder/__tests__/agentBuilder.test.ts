/**
 * The Agent Builder's pure parts (docs/agent-builder.md): behaviour cards ↔ rule set (old sets
 * included), sliders → rule values, the presets, the start page's kinds, the diagrams' geometry and
 * the pictures' small simulation.
 */
import { describe, expect, it } from 'vitest';
import { defaultRuleSet, normalizeRuleSet, type AgentRuleSet } from '../../agentRules/spec';
import { RULES_TEMPLATES, rulesTemplate } from '../../agentRules/templates';
import { generateRulesInside } from '../../agentRules/generate';
import { locateCards, patchCard, readCards, sectionSummary, setCardOn, setEdges, setSensors, setSpeed, smellChips } from '../cards';
import { TRAIL_PRESETS, trailPreset } from '../presets';
import { START_CARDS, BUILDER_KINDS } from '../kinds';
import { TRAIL_SECTIONS } from '../words';
import { arcPath, feelers, keepRef, lensFor, picToView, stepsBehind, stepsToFeelers, containRect } from '../diagram';
import { TrailSim, simFromRules, walkersFor, dotsFor, stepParticles, miniRandom } from '../miniSim';

const slime = () => rulesTemplate('slime')!.set();

describe('cards from a rule set', () => {
  it('reads the slime template: Senses on (own trail, 0.035 ahead, 22.5°), turn 45°, wobble 7°, leaves 1; nothing advanced', () => {
    const c = readCards(slime(), 0);
    expect(c.senses).toMatchObject({ on: true, there: true, channel: 'own', away: false, distance: 0.035, angle: 22.5 });
    expect(c.turning).toEqual({ sharp: 45, sharpOn: true, wobble: 7, wobbleOn: true });
    expect(c.moving).toEqual({ speed: 0.22, edges: 'wrap' });
    expect(c.trail).toMatchObject({ on: true, amount: 1, channel: 'own' });
    expect(c.advanced).toEqual([]);
  });

  it('round trip: writing back what was read leaves the rule set (and the nodes it makes) unchanged', () => {
    for (const t of RULES_TEMPLATES) {
      const set = t.set();
      for (let sp = 0; sp < set.species.length; sp++) {
        const c = readCards(set, sp);
        let back: AgentRuleSet = set;
        if (c.senses.there) back = patchCard(back, sp, 'senses', { degrees: c.turning.sharp, channel: c.senses.channel });
        back = setSensors(back, { distance: c.senses.distance, angle: c.senses.angle });
        back = setSpeed(back, sp, c.moving.speed);
        back = setEdges(back, c.moving.edges);
        if (c.trail.there) back = patchCard(back, sp, 'trail', { amount: c.trail.amount });
        expect(back, `${t.key} species ${sp}`).toEqual(set);
        expect(generateRulesInside(back, { groupId: 'g', d3: false })).toEqual(generateRulesInside(set, { groupId: 'g', d3: false }));
      }
    }
  });

  it('old rule sets open: a saved set (no kind, one rule doing everything) maps to the cards; anything else is an Advanced rule', () => {
    // A set saved before kinds and cards: the default starter's rule.
    const old = normalizeRuleSet({ v: 1, channels: [], masks: [], edges: 'bounce', sensor: { distance: 0.05, angle: 30 }, species: [{ name: 'W', speed: 0.3, states: [{ name: 'a', colour: [1, 1, 1] }], rules: [
      { when: [{ kind: 'always' }], do: [{ kind: 'turn', toward: 'trail', channel: 'own', degrees: 30 }, { kind: 'wander', degrees: 8 }, { kind: 'trail', channel: 'own', amount: 1 }, { kind: 'speed', mode: 'add', value: 0.1 }] },
      { when: [{ kind: 'age', cmp: '>', seconds: 5 }], do: [{ kind: 'die' }] },
    ] }] });
    const c = readCards(old, 0);
    expect(c.senses).toMatchObject({ on: true, distance: 0.05, angle: 30 });
    expect(c.turning).toMatchObject({ sharp: 30, wobble: 8 });
    expect(c.moving.edges).toBe('bounce');
    // The speed action in the always rule, and the whole age rule, are Advanced.
    expect(c.advanced.map(a => a.rule)).toEqual([0, 1]);
    expect(c.advanced[0].text).toMatch(/accelerate 0\.1/);
    expect(c.advanced[0].text).not.toMatch(/turn toward/);
    expect(c.advanced[1].text).toMatch(/age > 5 s → die/);
  });

  it('the ants template: its turns are conditional (Advanced); the always rule\'s wander is Wobble', () => {
    const c = readCards(rulesTemplate('ants')!.set(), 0);
    expect(c.senses.on).toBe(false);
    expect(c.trail.on).toBe(false);
    expect(c.turning.wobble).toBe(5);
    expect(c.advanced.length).toBeGreaterThan(3);
  });

  it('predator & prey: each species has its own cards (prey: turn 20 own trail; predators: smell the prey\'s trail, lay their own)', () => {
    const set = rulesTemplate('predatorPrey')!.set();
    expect(readCards(set, 0).turning.sharp).toBe(20);
    const pred = readCards(set, 1);
    expect(pred.senses.channel).toBe(0);
    expect(pred.trail.channel).toBe(1);
    expect(pred.advanced).toEqual([]);
  });
});

describe('cards → rule values', () => {
  it('sliders write the rule set: How far ahead / How wide (the sensors), How sharply (Turn), Wobble, Speed, Leaves', () => {
    let s = slime();
    s = setSensors(s, { distance: 0.06 });
    s = setSensors(s, { angle: 45 });
    s = patchCard(s, 0, 'senses', { degrees: 20 });
    s = patchCard(s, 0, 'wobble', { degrees: 12 });
    s = setSpeed(s, 0, 0.4);
    s = patchCard(s, 0, 'trail', { amount: 2.5 });
    expect(s.sensor).toEqual({ distance: 0.06, angle: 45 });
    expect(s.species[0].speed).toBe(0.4);
    expect(s.species[0].rules).toEqual([{ when: [{ kind: 'always' }], do: [
      { kind: 'turn', toward: 'trail', channel: 'own', degrees: 20 },
      { kind: 'wander', degrees: 12 },
      { kind: 'trail', channel: 'own', amount: 2.5 },
    ] }]);
    // Smells and Avoid it.
    s = patchCard(s, 0, 'senses', { channel: 1, away: true });
    expect(s.species[0].rules[0].do[0]).toMatchObject({ channel: 1, away: true });
  });

  it('a switch moves its action into a rule of its own (so the rule\'s off carries it), keeping the order; on again restores it', () => {
    const off = setCardOn(slime(), 0, 'senses', false);
    expect(off.species[0].rules).toEqual([
      { when: [{ kind: 'always' }], do: [{ kind: 'wander', degrees: 7 }, { kind: 'trail', channel: 'own', amount: 1 }] },
      { when: [{ kind: 'always' }], do: [{ kind: 'turn', toward: 'trail', channel: 'own', degrees: 45 }], off: true },
    ]);
    const c = readCards(off, 0);
    expect(c.senses.on).toBe(false);
    expect(c.turning.sharp).toBe(45); // kept for when it is on again
    expect(c.advanced).toEqual([]);
    const on = setCardOn(off, 0, 'senses', true);
    expect(readCards(on, 0).senses.on).toBe(true);
    expect(on.species[0].rules[1].off).toBeUndefined();
  });

  it('switching on a card that isn\'t there adds it (Senses first, Trail after the others)', () => {
    const bare: AgentRuleSet = { ...defaultRuleSet(), species: [{ ...defaultRuleSet().species[0], rules: [] }] };
    const s1 = setCardOn(bare, 0, 'trail', true);
    const s2 = setCardOn(s1, 0, 'senses', true);
    expect(s2.species[0].rules.map(r => r.do[0].kind)).toEqual(['turn', 'trail']);
    expect(readCards(s2, 0)).toMatchObject({ senses: { on: true }, trail: { on: true } });
    // Switching off what isn't there changes nothing.
    expect(setCardOn(bare, 0, 'wobble', false)).toBe(bare);
    expect(locateCards(bare, 0)).toEqual({ senses: null, wobble: null, trail: null });
  });

  it('the left nav\'s summaries and the Smells chips', () => {
    const c = readCards(slime(), 0);
    expect(sectionSummary(c, 'senses')).toBe('0.035 ahead · 22.5°');
    expect(sectionSummary(c, 'turning')).toBe('45° · wobble 7°');
    expect(sectionSummary(c, 'moving')).toBe('0.22 · wrap');
    expect(sectionSummary(c, 'trail')).toBe('leaves 1');
    const ants = rulesTemplate('ants')!.set();
    expect(smellChips(ants).map(x => x.label)).toEqual(['its own', 'home', 'food', 'trail 3', 'trail 4']);
  });
});

describe('presets, kinds and words', () => {
  it('the trail presets: templates plus the field guide\'s slime variants', () => {
    expect(TRAIL_PRESETS.map(p => p.key)).toEqual(['slime', 'veins', 'cells', 'mesh', 'clumps', 'ants', 'predatorPrey', 'dla']);
    expect(readCards(trailPreset('veins')!.set(), 0).turning.sharp).toBe(20);
    expect(readCards(trailPreset('cells')!.set(), 0).senses.angle).toBe(45);
    expect(readCards(trailPreset('clumps')!.set(), 0)).toMatchObject({ senses: { angle: 90 }, turning: { sharp: 12 } });
    // Each call is a fresh copy.
    expect(trailPreset('slime')!.set()).not.toBe(trailPreset('slime')!.set());
  });

  it('the start page\'s kinds map to the rule sets\' kinds and templates; only Trail followers is built in phase 1', () => {
    expect(START_CARDS.map(c => [c.label, c.kind, c.built])).toEqual([
      ['Trail followers', 'trail', true], ['Particles', 'particles', false], ['Flocks', 'flock', false], ['Orbiters', 'swarm', false],
    ]);
    for (const c of START_CARDS) expect(rulesTemplate(c.template), c.id).toBeTruthy();
    expect([...BUILDER_KINDS]).toEqual(['trail', 'ants']);
  });

  it('sections in the field guide\'s order, each with a hint and a Learn more', () => {
    expect(TRAIL_SECTIONS.map(s => s.label)).toEqual(['Born', 'Senses', 'Turning', 'Moving', 'Trail']);
    for (const s of TRAIL_SECTIONS) { expect(s.hint.length).toBeLessThan(90); expect(s.learn.length).toBeGreaterThan(120); }
  });
});

describe('diagram geometry', () => {
  it('feelers: Distance ahead, at +Angle on the left and −Angle on the right (figure 2.4)', () => {
    const lens = lensFor(800, 600, 0.035);
    const f = feelers(lens, 0.035, 30);
    expect(f.length).toBeCloseTo(lens.r * 0.5);
    expect(f.centre.x).toBeCloseTo(lens.walker.x);
    expect(f.centre.y).toBeCloseTo(lens.walker.y - f.length);
    expect(f.left.x).toBeLessThan(lens.walker.x);
    expect(f.right.x).toBeGreaterThan(lens.walker.x);
    expect(Math.hypot(f.left.x - lens.walker.x, f.left.y - lens.walker.y)).toBeCloseTo(f.length);
    // Wider angle: the side feelers further out; farther: longer.
    expect(feelers(lens, 0.035, 60).left.x).toBeLessThan(f.left.x);
    expect(feelers(lens, 0.07, 30).length).toBeCloseTo(f.length * 2);
  });

  it('the lens keeps its scale while a slider moves within reach, and re-fits when it goes far', () => {
    expect(keepRef(0.035, 0.05)).toBe(0.035);
    expect(keepRef(0.035, 0.12)).toBe(0.12);
    expect(keepRef(0.035, 0.005)).toBe(0.005);
  });

  it('steps, arcs and picture points', () => {
    const lens = lensFor(800, 600, 0.035);
    const st = stepsBehind(lens, 0.22, 3);
    expect(st[1].y - st[0].y).toBeCloseTo((0.22 / 60) * lens.scale);
    expect(Math.round(stepsToFeelers(0.035, 0.22))).toBe(10); // the field guide's ~9 : 1
    expect(arcPath({ x: 0, y: 0 }, 10, 0, 45)).toMatch(/^M 0\.00 -10\.00 A 10 10 0 0 0 /);
    const im = containRect(400, 400, 1600, 900);
    expect(im).toEqual({ x: 0, y: 87.5, w: 400, h: 225 });
    expect(picToView(im, { x: 0, y: 0 })).toEqual({ x: 200, y: 200 });
    expect(picToView(im, { x: 0, y: 1 }).y).toBeCloseTo(87.5);
  });
});

describe('the pictures\' small simulation', () => {
  it('slime walkers on a small trail grow a pattern (trail laid, spread and fading), repeatably', () => {
    const p = simFromRules(slime(), { halfLife: 0.06, diffuse: 1 });
    expect(p.species[0]).toMatchObject({ distance: 0.035, angle: 22.5, turn: 45, wobble: 7, deposit: 1 });
    const run = () => { const s = new TrailSim(64, 40, walkersFor(64, 40), p, 3); for (let i = 0; i < 40; i++) s.step(); return s; };
    const a = run(), b = run();
    expect(a.trail).toEqual(b.trail);
    const ch0 = a.trail.subarray(0, 64 * 40);
    expect(Math.max(...ch0)).toBeGreaterThan(0.5);
    const out = new Uint8ClampedArray(64 * 40 * 4);
    a.draw(out);
    expect(out[3]).toBe(255);
  });

  it('particles rise and fall from the fountain', () => {
    const d = dotsFor('particles', 20);
    const r = miniRandom(1);
    for (let i = 0; i < 150; i++) stepParticles(d, 1 / 60, r);
    expect(d.some(x => x.y > 0.2)).toBe(true);
  });
});
