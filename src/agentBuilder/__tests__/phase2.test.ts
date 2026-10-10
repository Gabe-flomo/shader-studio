/**
 * Agent Builder phase 2 (docs/agent-builder.md): particles, flocks, crowds and orbiters as cards
 * (round trip with every template, the nodes they make unchanged), kinds of walker (species),
 * "only when" lines (rule conditions), dragging cards (rule order), and the diagrams' geometry.
 */
import { describe, expect, it } from 'vitest';
import { type AgentRuleSet, type RuleAction } from '../../agentRules/spec';
import { RULES_TEMPLATES, rulesTemplate } from '../../agentRules/templates';
import { RULES_TEMPLATES_3D } from '../../agentRules/space3d';
import { generateRulesInside } from '../../agentRules/generate';
import {
  type CardRead, CARD_DEFS, addCard, addSpecies, cardRule, moveCard, patchAt, readBehaviours, removeAt, removeSpecies, renameSpecies,
  reorderCards, setOnAt, setOnlyWhen, setSpeciesColour, KIND_COLOURS,
} from '../behaviours';
import { KIND_SECTIONS, kindCards, sectionWordsOf, CARD_WORDS } from '../sections';
import { ONLY_WHEN_PICKER, newOnlyWhen, onlyWhenText } from '../onlyWhen';
import { setEdges, setFlow, setNeighbours, setSpeed } from '../cards';
import { CROWD_PRESETS, FLOCK_PRESETS, ORBIT_PRESETS, PARTICLE_PRESETS, builderPreset, presetsFor } from '../presets';
import { START_CARDS } from '../kinds';
import {
  curlArrows, flockForces, forceLength, neighbourDots, orbitArrows, orbitOnPicture, ringLens, sphereOnPicture, toward,
} from '../diagram';
import { DotSim } from '../dotSim';
import { agCamera3, agProject3 } from '../../play/kit/agentPlan.js';

const tpl = (k: string) => rulesTemplate(k)!.set();
const gen = (s: AgentRuleSet, d3 = false) => generateRulesInside(s, { groupId: 'g', d3 });

/** Write every card's values (and the settings beside them) back as they were read. */
function writeBack(set: AgentRuleSet): AgentRuleSet {
  const kind = set.kind ?? 'trail';
  let back = set;
  for (let sp = 0; sp < set.species.length; sp++) {
    const b = readBehaviours(back, sp, kindCards(kind));
    for (const c of b.cards) {
      back = patchAt(back, sp, c.at, { ...c.action } as Partial<RuleAction>);
      const r = back.species[sp].rules[c.at.rule];
      if (c.when && r.do.length === 1 && r.when.length === 1) back = setOnlyWhen(back, sp, c.at, { ...c.when });
    }
    back = setSpeed(back, sp, set.species[sp].speed);
  }
  back = setEdges(back, set.edges);
  back = setFlow(back, { ...set.flow });
  if (set.neighbours) back = setNeighbours(back, { ...set.neighbours });
  return back;
}

const NEW_KINDS = ['particles', 'flock', 'crowd', 'swarm'] as const;

describe('particles, flocks, crowds and orbiters as cards', () => {
  it('every template of the new kinds (2D and 3D) and every new preset round-trips cards ↔ rules unchanged, and makes the same nodes', () => {
    const sets: Array<[string, AgentRuleSet, boolean]> = [
      ...RULES_TEMPLATES.filter(t => NEW_KINDS.includes(t.set().kind as typeof NEW_KINDS[number])).map(t => [t.key, t.set(), false] as [string, AgentRuleSet, boolean]),
      ...RULES_TEMPLATES_3D.filter(t => NEW_KINDS.includes(t.set().kind as typeof NEW_KINDS[number])).map(t => [t.key, t.set(), true] as [string, AgentRuleSet, boolean]),
      ...[...PARTICLE_PRESETS, ...FLOCK_PRESETS, ...CROWD_PRESETS, ...ORBIT_PRESETS].map(p => [`preset ${p.key}`, p.set(), false] as [string, AgentRuleSet, boolean]),
    ];
    expect(sets.map(s => s[0])).toEqual(expect.arrayContaining(['boids', 'particles', 'swarm', 'crowd', 'flock3d', 'orbiters3d', 'curl3d']));
    for (const [key, set, d3] of sets) {
      const back = writeBack(set);
      expect(back, key).toEqual(set);
      expect(gen(back, d3), key).toEqual(gen(set, d3));
    }
  });

  it('the spark fountain reads as Forces (gravity, curl, drag; the mouse push off), Life (fade, dies after 3.2 s) and nothing Advanced', () => {
    const b = readBehaviours(tpl('particles'), 0, kindCards('particles'));
    expect(b.cards.map(c => [c.key, c.on])).toEqual([['gravity#0', true], ['curl#0', true], ['drag#0', true], ['fade#0', true], ['attract#0', false], ['die#0', true]]);
    expect(b.cards.find(c => c.card === 'die')!.when).toEqual({ kind: 'age', cmp: '>', seconds: 3.2 });
    expect(b.advanced).toEqual([]);
  });

  it('boids: separation, alignment, cohesion and wander are cards; the swarm\'s state rules stay Advanced; the crowd\'s second Keep apart is a card too', () => {
    expect(readBehaviours(tpl('boids'), 0, kindCards('flock')).cards.map(c => c.card)).toEqual(['separate', 'match', 'cohere', 'wobble']);
    const sw = readBehaviours(tpl('swarm'), 0, kindCards('swarm'));
    expect(sw.cards.map(c => c.card)).toEqual(['orbit', 'separate', 'cohere', 'wobble']);
    expect(sw.advanced.map(a => a.rule)).toEqual([1, 2]);
    const cr = readBehaviours(tpl('crowd'), 1, kindCards('crowd'));
    expect(cr.cards.map(c => c.key)).toEqual(['goal#0', 'separate#0', 'separate#1', 'slow#0', 'wobble#0']);
    expect(cr.advanced).toEqual([]);
  });

  it('cards write the rules: a slider patches its action; a switch, add and remove change only that card', () => {
    let s = tpl('boids');
    const at = (k: string) => readBehaviours(s, 0, kindCards('flock')).cards.find(c => c.key === k)!.at;
    s = patchAt(s, 0, at('match#0'), { degrees: 20 });
    expect(s.species[0].rules[0].do[1]).toEqual({ kind: 'match', who: 'all', degrees: 20 });
    s = setOnAt(s, 0, at('cohere#0'), false);
    expect(readBehaviours(s, 0, kindCards('flock')).cards.find(c => c.card === 'cohere')!.on).toBe(false);
    s = addCard(s, 0, 'avoidEdges', kindCards('flock')).set;
    expect(readBehaviours(s, 0, kindCards('flock')).cards.find(c => c.card === 'avoidEdges')!.action).toEqual(CARD_DEFS.avoidEdges.make());
    s = removeAt(s, 0, at('avoidEdges#0'));
    expect(readBehaviours(s, 0, kindCards('flock')).cards.some(c => c.card === 'avoidEdges')).toBe(false);
    // A new Dies card starts with its only when (older than 3 s).
    const p = addCard({ ...tpl('particles'), species: [{ ...tpl('particles').species[0], rules: [] }] }, 0, 'die', kindCards('particles')).set;
    expect(p.species[0].rules).toEqual([{ when: [{ kind: 'age', cmp: '>', seconds: 3 }], do: [{ kind: 'die' }] }]);
  });

  it('each kind\'s sections and words; every card has a name and a hint', () => {
    expect(KIND_SECTIONS.particles.map(x => x.id)).toEqual(['born', 'forces', 'moving', 'life', 'memory', 'look']);
    expect(KIND_SECTIONS.flock.map(x => x.id)).toEqual(['born', 'neighbours', 'steering', 'moving', 'memory']);
    expect(KIND_SECTIONS.crowd.map(x => x.id)).toEqual(['born', 'neighbours', 'steering', 'moving', 'memory']);
    expect(KIND_SECTIONS.swarm.map(x => x.id)).toEqual(['born', 'orbit', 'neighbours', 'moving', 'memory']);
    expect(sectionWordsOf('steering').label).toBe('Turning');
    for (const k of Object.keys(CARD_DEFS)) expect(CARD_WORDS[k as keyof typeof CARD_WORDS].hint.length).toBeLessThan(90);
    for (const k of ['particles', 'flock', 'crowd', 'swarm'] as const) expect(presetsFor(k).length).toBeGreaterThanOrEqual(3);
    expect(builderPreset('murmuration')!.set().kind).toBe('flock');
    expect(START_CARDS.find(c => c.id === 'crowd')!.kind).toBe('crowd');
  });
});

describe('kinds of walker (species)', () => {
  it('add copies the picked kind with the next name and a colour of its own (up to 4); rename, colour and remove write the species', () => {
    let s = tpl('boids');
    s = addSpecies(s, 0);
    expect(s.species.map(x => x.name)).toEqual(['Birds', 'Kind 2']);
    expect(s.species[1].rules).toEqual(s.species[0].rules);
    expect(s.species[1].rules).not.toBe(s.species[0].rules);
    expect(s.species[1].states[0].colour).toEqual(KIND_COLOURS[0]);
    s = addSpecies(addSpecies(s, 1), 0);
    expect(s.species.length).toBe(4);
    expect(addSpecies(s, 0)).toBe(s); // at most four
    s = renameSpecies(s, 1, 'Hawks');
    s = setSpeciesColour(s, 1, [1, 0, 0]);
    expect(s.species[1]).toMatchObject({ name: 'Hawks', states: [{ colour: [1, 0, 0] }] });
    s = removeSpecies(s, 1);
    expect(s.species.map(x => x.name)).toEqual(['Birds', 'Kind 3', 'Kind 4']);
    // Each kind has its own cards, and the group's Species follows (generate: one block per species' rule).
    s = patchAt(s, 2, readBehaviours(s, 2, kindCards('flock')).cards[0].at, { degrees: 30 });
    expect(readBehaviours(s, 2, kindCards('flock')).cards[0].action).toMatchObject({ degrees: 30 });
    expect(readBehaviours(s, 0, kindCards('flock')).cards[0].action).toMatchObject({ degrees: 12 });
    expect(gen(s).filter(n => /^Rule 1 · /.test(String(n.params.label))).length).toBe(3);
    // One kind always stays.
    const one = tpl('boids');
    expect(removeSpecies(one, 0)).toBe(one);
  });

  it('removing a kind keeps the "near" conditions on the kinds after it pointing at them', () => {
    const pp = tpl('predatorPrey');
    const three = addSpecies(pp, 0);
    const out = removeSpecies(three, 0);
    expect(out.species.map(x => x.name)).toEqual(['Predators', 'Kind 3']);
    const near = out.species.flatMap(x => x.rules.flatMap(r => r.when)).filter(c => c.kind === 'near');
    expect(near.every(c => c.kind === 'near' && c.species >= 0)).toBe(true);
  });
});

describe('"only when" lines', () => {
  it('each picker entry is a rule condition a card can carry; the card\'s action moves into a rule of its own with it', () => {
    for (const p of ONLY_WHEN_PICKER) {
      const s0 = tpl('boids');
      const at = readBehaviours(s0, 0, kindCards('flock')).cards.find(c => c.card === 'cohere')!.at;
      const s = setOnlyWhen(s0, 0, at, newOnlyWhen(p.kind));
      const rules = s.species[0].rules;
      // cohere left the always rule (split round it, so the order is kept) into its own conditional rule.
      expect(rules.map(r => r.do.map(a => a.kind))).toEqual([['separate', 'match'], ['cohere'], ['wander']]);
      expect(rules[1].when).toEqual([newOnlyWhen(p.kind)]);
      expect(cardRule(rules[1])).toBe(true);
      const c = readBehaviours(s, 0, kindCards('flock')).cards.find(x => x.card === 'cohere')!;
      expect(c.when, p.kind).toEqual(newOnlyWhen(p.kind));
      expect(onlyWhenText(s, 0, c.when!).length).toBeGreaterThan(3);
      expect(gen(s).length).toBeGreaterThan(0);
    }
  });

  it('the words of the chips; clearing the only when makes it always again', () => {
    const s = tpl('slime');
    expect(onlyWhenText(s, 0, newOnlyWhen('neighbours'))).toBe('a neighbour is near');
    expect(onlyWhenText(s, 0, newOnlyWhen('age'))).toBe('older than 2 s');
    expect(onlyWhenText(s, 0, newOnlyWhen('chance'))).toBe('by chance, 20% a second');
    expect(onlyWhenText(s, 0, newOnlyWhen('shape'))).toBe('inside a circle');
    expect(onlyWhenText(s, 0, newOnlyWhen('sense'))).toBe('it smells its own above 0.3');
    expect(onlyWhenText(s, 0, newOnlyWhen('state'))).toBe('walking');
    const at = readBehaviours(s, 0, ['senses', 'wobble', 'trail']).cards[1].at;
    const w = setOnlyWhen(s, 0, at, newOnlyWhen('age'));
    const at2 = readBehaviours(w, 0, ['senses', 'wobble', 'trail']).cards.find(c => c.card === 'wobble')!.at;
    const back = setOnlyWhen(w, 0, at2, null);
    expect(back.species[0].rules.find(r => r.do[0].kind === 'wander')!.when).toEqual([{ kind: 'always' }]);
  });

  it('two conditions, a Stop, or a condition a chip can\'t say keep a rule Advanced', () => {
    expect(cardRule({ when: [{ kind: 'age', cmp: '>', seconds: 1 }, { kind: 'chance', perSecond: 0.5 }], do: [{ kind: 'die' }] })).toBe(false);
    expect(cardRule({ when: [{ kind: 'age', cmp: '>', seconds: 1 }], do: [{ kind: 'die' }], stop: true })).toBe(false);
    expect(cardRule({ when: [{ kind: 'memory', cmp: '>', value: 1 }], do: [{ kind: 'die' }] })).toBe(false);
    expect(cardRule({ when: [{ kind: 'shape', shape: 'box', x: 0, y: 0, size: 0.3, outside: true }], do: [{ kind: 'die' }] })).toBe(true);
  });
});

describe('dragging cards (rule order)', () => {
  it('moving a card in a shared rule splits it there; the rules run in the new order', () => {
    const s = tpl('boids');
    const cards = readBehaviours(s, 0, ['separate', 'match', 'cohere', 'avoidEdges', 'wobble']).cards;
    // Stay together (index 2) to the top.
    const up = reorderCards(s, 0, cards, 2, 0);
    expect(up.species[0].rules.map(r => r.do.map(a => a.kind))).toEqual([['cohere'], ['separate', 'match', 'wander']]);
    expect(readBehaviours(up, 0, kindCards('flock')).cards.map(c => c.card)).toEqual(['cohere', 'separate', 'match', 'wobble']);
    // Keep apart (0) to after Match heading (1): split after match.
    const down = reorderCards(s, 0, cards, 0, 1);
    expect(down.species[0].rules.map(r => r.do.map(a => a.kind))).toEqual([['match'], ['separate'], ['cohere', 'wander']]);
    expect(readBehaviours(down, 0, kindCards('flock')).cards.map(c => c.card)).toEqual(['match', 'separate', 'cohere', 'wobble']);
    // The generated blocks follow the order (a rule block per rule).
    expect(gen(down).filter(n => /^Rule \d/.test(String(n.params.label))).length).toBe(3);
    // Same place: nothing changes.
    expect(reorderCards(s, 0, cards, 1, 1)).toBe(s);
  });

  it('a conditional card moves with its condition and switch', () => {
    let s = tpl('particles');
    const forces = () => readBehaviours(s, 0, ['gravity', 'wind', 'curl', 'attract', 'drag']).cards;
    // The mouse push (an off rule of its own) to the top.
    const i = forces().findIndex(c => c.card === 'attract');
    s = reorderCards(s, 0, forces(), i, 0);
    expect(s.species[0].rules[0]).toEqual({ when: [{ kind: 'always' }], do: [{ kind: 'force', field: 'mouse', strength: -1.2 }], off: true });
    expect(forces().map(c => [c.card, c.on])).toEqual([['attract', false], ['gravity', true], ['curl', true], ['drag', true]]);
    // Drag to the end (after the last card).
    const f = forces();
    s = moveCard(s, 0, f[0].at, { after: f[f.length - 1].at });
    expect(forces().map(c => c.card)).toEqual(['gravity', 'curl', 'drag', 'attract']);
  });
});

describe('diagram geometry (phase 2)', () => {
  it('Neighbours: the view radius is a ring that grows with the slider; the counted ones are at most Max, all inside the ring, in grid order', () => {
    const L = ringLens(800, 600, 0.05);
    expect(0.05 * L.scale).toBeCloseTo(L.r * 0.42);
    expect(0.1 * L.scale).toBeCloseTo(2 * 0.05 * L.scale); // the lens keeps its scale: the ring doubles
    for (const max of [1, 8, 36, 64]) {
      const d = neighbourDots(max);
      const counted = d.filter(x => x.counted);
      const inside = d.filter(x => x.inReach);
      expect(counted.length).toBe(Math.min(max, inside.length));
      expect(counted.every(x => x.d <= 1)).toBe(true);
      if (max < 60) expect(inside.length).toBeGreaterThan(counted.length);
      // Grid order: every counted one comes before every uncounted one in reach.
      const lastCounted = Math.max(...counted.map(x => x.index));
      expect(inside.filter(x => !x.counted).every(x => x.index > lastCounted)).toBe(true);
    }
    expect(neighbourDots(12)).toEqual(neighbourDots(12)); // repeatable
  });

  it('flocking: separation pushes away from the close ones; cohesion points at their middle', () => {
    const d = neighbourDots(20);
    const f = flockForces(d);
    expect(f.close.every(x => x.d < 0.45 && x.counted)).toBe(true);
    if (f.close.length) {
      const toClose = f.close.reduce((s, x) => ({ x: s.x + x.x, y: s.y + x.y }), { x: 0, y: 0 });
      expect(f.push.x * toClose.x + f.push.y * toClose.y).toBeLessThan(0);
    }
    const counted = d.filter(x => x.counted);
    expect(f.centre.x).toBeCloseTo(counted.reduce((s, x) => s + x.x, 0) / counted.length);
  });

  it('forces: arrows along the force\'s angle (0 right, 90 up, −90 down), longer for stronger, capped', () => {
    const g = toward({ x: 100, y: 100 }, 50, -90);
    expect(g.x).toBeCloseTo(100); expect(g.y).toBeCloseTo(150);
    const w = toward({ x: 100, y: 100 }, 50, 0);
    expect(w).toEqual({ x: 150, y: 100 });
    expect(forceLength(1)).toBeGreaterThan(forceLength(0.3));
    expect(forceLength(100)).toBe(120);
    const field = curlArrows({ x: 0, y: 0, w: 800, h: 450 }, 1, 16);
    expect(field.length).toBe(16 * 9);
    expect(field.every(a => a.k >= 0 && a.k <= 1)).toBe(true);
  });

  it('orbit: its circle at the true radius round its centre, arrowheads going its way round', () => {
    const rect = { x: 0, y: 0, w: 1600, h: 900 };
    const o = orbitOnPicture(rect, { target: 'centre', distance: 0.5 });
    expect(o.c).toEqual({ x: 800, y: 450 });
    expect(o.r).toBeCloseTo(225);
    const p = orbitOnPicture(rect, { target: 'point', x: 0.5, y: 0.5, distance: 0.2 });
    expect(p.c.x).toBeGreaterThan(800); expect(p.c.y).toBeLessThan(450);
    expect(orbitArrows(o.c, o.r, false, 6).length).toBe(6);
    expect(orbitArrows(o.c, o.r, true, 6)[0].head).not.toBe(orbitArrows(o.c, o.r, false, 6)[0].head);
  });

  it('Born in 3D: the ball through the 3D camera, as wide as the camera sees it', () => {
    const cam = agCamera3({ params: { camDist: 3.8, camAngle: 15, camElevation: 15, fov: 1.8 } }, (v, d) => (typeof v === 'number' ? v : d), 0, 900);
    const rect = { x: 0, y: 0, w: 1600, h: 900 };
    const toView = (p: { x: number; y: number }) => ({ x: (p.x / (16 / 9) * 0.5 + 0.5) * 1600, y: (0.5 - p.y * 0.5) * 900 });
    const s = sphereOnPicture(p => agProject3(cam, p), toView, [0, 0, 0], 0.5);
    expect(s.visible).toBe(true);
    expect(s.centre.x).toBeCloseTo(800, 0);
    // About lens × r / distance of the picture's half-height.
    expect(s.radius).toBeGreaterThan(0.5 * 1.8 / 3.8 * 450 * 0.9);
    expect(s.radius).toBeLessThan(0.5 * 1.8 / 3.8 * 450 * 1.25);
    expect(s.equator.some(p => p.back)).toBe(true);
    expect(s.equator.some(p => !p.back)).toBe(true);
    void rect;
  });
});

describe('the presets\' dot pictures', () => {
  it('the spark fountain\'s dots rise and fall; a flock\'s stay moving; repeatable', () => {
    const run = (key: string) => { const p = builderPreset(key)!; const sim = new DotSim(p.set(), 80, p.dots!, 1.6, 3); for (let i = 0; i < 90; i++) sim.step(); return sim; };
    const a = run('particles'), b = run('particles');
    expect([...a.y]).toEqual([...b.y]);
    expect(Math.max(...a.y)).toBeGreaterThan(-0.6);
    const f = run('boids');
    expect([...f.vx].some(v => Math.abs(v) > 0.01)).toBe(true);
  });
});

export type { CardRead };
