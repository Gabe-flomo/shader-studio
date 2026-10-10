/**
 * The viewport's legend (docs/agent-builder.md "Legend, tags and focus"): the phrase generators for
 * every behaviour (directions, units, 0 and negative), the entries each section draws, the link from
 * a control back to its entry, the tag layout, and the focus demos.
 */
import { describe, expect, it } from 'vitest';
import { rulesTemplate } from '../../agentRules/templates';
import type { AgentRuleSet } from '../../agentRules/spec';
import { readBehaviours } from '../behaviours';
import { readCards } from '../cards';
import { kindCards, KIND_SECTIONS } from '../sections';
import { builderPreset } from '../presets';
import {
  NOUNS, directionWords, entryForFocus, focusOfEntry, forceSum, layoutTags, legendEntries, moreAbout, num, phrase, tagsOverlap, tagWidth,
  type LegendEntry,
} from '../legend';
import { DEMO_FPS, makeDemo } from '../demos';

const P = NOUNS.particles, B = NOUNS.flock, W = NOUNS.trail;
const tpl = (k: string) => rulesTemplate(k)!.set();

describe('words', () => {
  it('directions: the nearest of eight, as "pointing" and "pulled"', () => {
    expect(directionWords(90)).toEqual({ to: 'up', ward: 'upward' });
    expect(directionWords(-90)).toEqual({ to: 'down', ward: 'downward' });
    expect(directionWords(0).to).toBe('right');
    expect(directionWords(180).to).toBe('left');
    expect(directionWords(-180).to).toBe('left');
    expect(directionWords(270).to).toBe('down');
    expect(directionWords(40).to).toBe('up and to the right');
    expect(directionWords(-130).ward).toBe('down and to the left');
  });
  it('numbers: rounded, a real minus sign, no −0', () => {
    expect(num(0.25)).toBe('0.25');
    expect(num(-0.5, 2)).toBe('−0.5');
    expect(num(-0.0001, 2)).toBe('0');
    expect(num(1 / 3, 2)).toBe('0.33');
  });
});

describe('phrases, one per behaviour', () => {
  it('gravity: the user\'s example, word for word; 0; negative turns it round', () => {
    expect(phrase.gravity(P, 0.25, 90)).toBe('Gravity 0.25, pointing up: each particle is pulled upward; its speed that way grows by 0.25 a second.');
    expect(phrase.gravity(P, 0.5, -90)).toContain('pointing down: each particle is pulled downward');
    expect(phrase.gravity(P, 0, -90)).toBe('Gravity 0: no pull; each particle keeps the speed it has.');
    const neg = phrase.gravity(P, -0.25, -90);
    expect(neg).toContain('Gravity 0.25, pointing up (negative: turned round)');
    expect(neg).toContain('pulled upward');
  });
  it('wind, curl, attract', () => {
    expect(phrase.wind(P, 0.3, 0)).toBe('Wind 0.3 blowing right, in gusts: particles drift to the right, gaining up to about 0.3 speed a second as the gusts rise and fall.');
    expect(phrase.wind(P, 0, 0)).toBe('Wind 0: still air.');
    expect(phrase.curl(P, 0.9, 1.4, 0.15)).toBe('Curl flow ×0.9, eddies 1.4: particles ride swirling currents that never bunch them up (bigger Eddies: smaller, busier swirls); the currents shift slowly.');
    expect(phrase.curl(P, 0.9, 1.4, 0)).toContain('the currents stand still');
    expect(phrase.curl(P, 0, 1, 0.5)).toBe('Curl flow ×0: no current.');
    expect(phrase.attract(P, 0.6, 'point', 0.5, -0.25)).toBe('Attract 0.6: each particle is pulled toward the point (0.5, −0.25), gaining 0.6 speed a second toward it, however far away it is.');
    expect(phrase.attract(P, -1.2, 'mouse')).toMatch(/^Repel 1\.2: each particle is pushed away from the mouse/);
    expect(phrase.attract(P, 0, 'mouse')).toBe('Attract 0: the mouse neither pulls nor pushes.');
  });
  it('drag: the share kept after a second; 0 and negative keep everything', () => {
    expect(phrase.drag(P, 0.8)).toBe('Drag 0.8: after a second a particle keeps 45% of its speed.');
    expect(phrase.drag(P, 0)).toBe('Drag 0: nothing slows particles; they keep all their speed.');
    expect(phrase.drag(P, -1)).toBe(phrase.drag(P, 0));
  });
  it('the sum, life', () => {
    expect(phrase.sum(P, 0.4, 90)).toContain('add up to 0.4, pointing up');
    expect(phrase.sum(P, 0, 0)).toContain('cancel out');
    expect(phrase.fade(P, 3)).toBe('Fade with age 3 s: each particle dims from full colour at birth to black at 3 s old.');
    expect(phrase.die(P, null, 3.2)).toContain('Dies at 3.2 s old');
    expect(phrase.die(P, 'it smells its own trail above 0.3', null)).toBe('Dies when it smells its own trail above 0.3.');
    expect(phrase.die(P, null, null)).toContain('give it an "only when"');
    expect(phrase.lives(P, 0)).toBe('Lives for ever: only a Dies card ends a particle.');
    expect(phrase.lives(P, 4)).toBe('Lives for 4 s: each particle is taken away at that age.');
  });
  it('flocking rules, with whose neighbours, and 0°', () => {
    expect(phrase.turnRule(B, 'separate', 12, 'all')).toBe('Keep apart 12°: each bird turns up to 12° a step away from the ones too close.');
    expect(phrase.turnRule(B, 'match', 8, 'own')).toBe('Match heading 8°: each bird turns up to 8° a step toward the way its neighbours of its own kind go.');
    expect(phrase.turnRule(B, 'cohere', 3, 'others')).toContain('toward the middle of the ones of the other kinds it sees');
    expect(phrase.turnRule(B, 'cohere', 0)).toBe('Stay together 0°: it doesn\'t turn for this.');
    expect(phrase.avoidEdges(B, 0.1, 12)).toBe('Avoid edges 0.1: within 0.1 of the picture\'s edge, each bird turns back inward, up to 12° a step.');
    expect(phrase.goal(NOUNS.crowd, 'point', 10, 0.8, 0)).toBe('Head for the point (0.8, 0): each person turns up to 10° a step toward it.');
    expect(phrase.goal(NOUNS.crowd, 'mouse', 5)).toContain('Head for the mouse');
    expect(phrase.slow(NOUNS.crowd, 20)).toContain('nearly stopping with 20 near');
    expect(phrase.wander(B, 0)).toBe('Wander 0°: each bird goes straight.');
    expect(phrase.wander(B, 7)).toBe('Wander ±7°: each step a bird turns a random amount, up to 7° either way.');
  });
  it('the view, max neighbours, orbit', () => {
    expect(phrase.view(B, 0.12)).toBe('View radius 0.12: each bird looks this far around it, and only knows the ones inside.');
    expect(phrase.max(B, 36)).toContain('counts at most 36');
    expect(phrase.orbit(NOUNS.swarm, 'centre', 0.5, 6, false)).toBe('Orbit 0.5 round the centre, anticlockwise: each orbiter turns up to 6° a step to circle 0.5 out, in when further, out when nearer.');
    expect(phrase.orbit(NOUNS.swarm, 'point', 0.3, 4, true, -0.5, 0.2)).toContain('round the point (−0.5, 0.2), clockwise');
  });
  it('trail followers: senses, turn, speed, edges, trail, born', () => {
    expect(phrase.senses(W, true, 0.03, 22.5)).toBe('Sensors 0.03 ahead, ±22.5°: three feelers smell the trail straight ahead and 22.5° to each side.');
    expect(phrase.senses(W, false, 0.03, 22.5)).toBe('Senses off: walkers don\'t smell the trail.');
    expect(phrase.turn(W, true, 45, false)).toContain('turns up to 45° toward the feeler that smells most');
    expect(phrase.turn(W, true, 45, true)).toContain('Turn 45° away from the smell');
    expect(phrase.turn(W, false, 45, false)).toContain('Senses is off');
    expect(phrase.speed(W, 0.2, 9)).toBe('Speed 0.2: each walker moves 0.2 a second (0.0033 a step), 9 steps to reach its feelers.');
    expect(phrase.speed(W, 0)).toBe('Speed 0: walkers stand still.');
    expect(phrase.edges(W, 'wrap')).toContain('comes back in at the other');
    expect(phrase.edges(W, 'bounce')).toContain('turns back');
    expect(phrase.edges(W, 'slide')).toContain('runs along it');
    expect(phrase.trail(W, true, 1, 0.12, 1)).toBe('Trail 1 a step: it leaves 1 where it walks; half of it is gone in 0.12 s, and 100% spreads to the pixels round it each step.');
    expect(phrase.trail(W, false, 1, 0.12, 1)).toBe('Trail off: walkers leave nothing behind.');
    expect(phrase.born(W, 'disc', 0.6, '256k')).toBe('Born in a disc of size 0.6: 256k walkers.');
    expect(phrase.born(W, 'screen', 1, '1m')).toBe('Born all over the picture: 1M walkers.');
  });
  it('every behaviour has its "more"', () => {
    for (const id of ['gravity#0', 'wind#0', 'curl#0', 'attract#0', 'drag#0', 'sum', 'fade#0', 'die#0', 'lives', 'separate#1', 'match#0', 'cohere#0', 'avoidEdges#0', 'goal#0', 'slow#0', 'orbit#0', 'wobble#0', 'wobble', 'view', 'max', 'senses', 'turn', 'speed', 'edges', 'trail', 'born']) {
      expect(moreAbout({ id, demo: { kind: 'speed', speed: 1 } }).length, id).toBeGreaterThan(40);
    }
  });
});

const entriesFor = (set: AgentRuleSet, section: Parameters<typeof legendEntries>[0]['section'], extra: Partial<Parameters<typeof legendEntries>[0]> = {}) => {
  const kind = set.kind ?? 'trail';
  return legendEntries({ set, sp: 0, kind, section, cards: readBehaviours(set, 0, kindCards(kind)).cards, trail: kind === 'trail' || kind === 'ants' ? readCards(set, 0) : undefined,
    born: { shape: 'disc', size: 0.6, count: '256k' }, trailField: { halfLife: 0.12, diffuse: 1 }, life: 0, ...extra });
};

describe('legend entries match what each section draws', () => {
  it('particles\' forces: curl, gravity, attract, drag, and all together, in drawing order, worded from the values', () => {
    const set = tpl('particles');
    const e = entriesFor(set, 'forces');
    const forces = readBehaviours(set, 0, kindCards('particles')).cards.filter(c => c.action.kind === 'force' || c.action.kind === 'drag');
    // One entry per force card, plus the sum when the forces don't cancel.
    expect(e.filter(x => x.card).map(x => x.id).sort()).toEqual(forces.map(c => c.key).sort());
    expect(e.map(x => x.id)[0]).toBe('curl#0');
    const g = e.find(x => x.id === 'gravity#0')!;
    expect(g.line).toMatch(/^Gravity [\d.]+, pointing (up|down)/);
    expect(g.settings).toEqual(['strength', 'angle']);
    expect(e.find(x => x.id === 'drag#0')!.numbers).toMatch(/keeps \d+%/);
    const sum = forceSum(readBehaviours(set, 0, kindCards('particles')).cards);
    expect(!!e.find(x => x.id === 'sum')).toBe(sum.strength > 1e-3);
    // Colours are distinct within a section.
    expect(new Set(e.map(x => x.colour)).size).toBe(e.length);
  });
  it('flocks: View radius and Max neighbours in Neighbours; Turning adds its cards', () => {
    const set = tpl('boids');
    expect(entriesFor(set, 'neighbours').map(x => x.id)).toEqual(['view', 'max']);
    expect(entriesFor(set, 'steering').map(x => x.id)).toEqual(['view', 'max', 'separate#0', 'match#0', 'cohere#0', 'wobble#0']);
    expect(entriesFor(set, 'neighbours')[0].line).toContain('each bird looks this far');
  });
  it('orbiters, crowds, life, moving', () => {
    expect(entriesFor(tpl('swarm'), 'orbit').map(x => x.id)).toEqual(['orbit#0']);
    expect(entriesFor(tpl('swarm'), 'neighbours').map(x => x.id).slice(0, 2)).toEqual(['view', 'max']);
    expect(entriesFor(tpl('crowd'), 'steering').map(x => x.id)).toContain('goal#0');
    expect(entriesFor(tpl('crowd'), 'steering')[2].line).toContain('person');
    expect(entriesFor(tpl('particles'), 'life', { life: 3 }).map(x => x.id)).toEqual(['lives', 'fade#0', 'die#0']);
    expect(entriesFor(tpl('particles'), 'life', { life: null }).map(x => x.id)).toEqual(['fade#0', 'die#0']);
    expect(entriesFor(tpl('boids'), 'moving').map(x => x.id)).toEqual(['speed', 'edges']);
    expect(entriesFor(tpl('particles'), 'look')).toEqual([]);
  });
  it('trail followers: sensors, turn and wobble, speed with its steps to the feelers, trail, born', () => {
    const set = tpl('slime');
    expect(entriesFor(set, 'senses').map(x => x.id)).toEqual(['senses']);
    expect(entriesFor(set, 'turning').map(x => x.id)).toEqual(['turn', 'wobble']);
    expect(entriesFor(set, 'moving')[0].line).toMatch(/steps to reach its feelers/);
    expect(entriesFor(set, 'trail')[0].line).toContain('half of it is gone in 0.12 s');
    expect(entriesFor(set, 'born')[0].line).toBe('Born in a disc of size 0.6: 256k walkers.');
  });
  it('every section of every kind\'s template and preset has entries with a line, a colour and a demo (but Look)', () => {
    const sets = ['slime', 'ants', 'particles', 'boids', 'crowd', 'swarm'].map(tpl).concat(['smoke', 'snow', 'vortex', 'murmuration', 'door', 'galaxy', 'veins'].map(k => builderPreset(k)?.set()).filter((x): x is AgentRuleSet => !!x));
    for (const set of sets) {
      for (const sec of KIND_SECTIONS[set.kind ?? 'trail']) {
        const e = entriesFor(set, sec.id);
        if (sec.id === 'look' || sec.id === 'memory') continue;
        expect(e.length, `${set.kind} ${sec.id}`).toBeGreaterThan(0);
        for (const x of e) {
          expect(x.line.length).toBeGreaterThan(10);
          expect(x.colour).toMatch(/^#/);
          const d = makeDemo(x.demo, x.colour);
          const f = d.frame(d.period / 2);
          expect(f.dots.length + f.paths.length + f.arrows.length, `${x.id} demo draws`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('linking a control to its entry', () => {
  const set = tpl('particles');
  const e = entriesFor(set, 'forces');
  it('a card, or a setting in it, lights the card\'s entry', () => {
    expect(entryForFocus(e, { card: 'gravity#0' })).toBe('gravity#0');
    expect(entryForFocus(e, { card: 'gravity#0', setting: 'angle' })).toBe('gravity#0');
    expect(entryForFocus(e, { card: 'curl#0', setting: 'flowSize' })).toBe('curl#0');
    expect(entryForFocus(e, {})).toBeNull();
  });
  it('a setting that isn\'t a card\'s (View radius, Max, Turn, Speed) lights its own entry', () => {
    const f = entriesFor(tpl('boids'), 'steering');
    expect(entryForFocus(f, { setting: 'radius' })).toBe('view');
    expect(entryForFocus(f, { card: 'separate#0', setting: 'max' })).toBe('max');
    expect(entryForFocus(f, { card: 'separate#0', setting: 'degrees' })).toBe('separate#0');
    const t = entriesFor(tpl('slime'), 'turning');
    expect(entryForFocus(t, { card: 'wobble', setting: 'sharp' })).toBe('turn');
    expect(entryForFocus(t, { card: 'wobble', setting: 'wobble' })).toBe('wobble');
  });
  it('hovering an entry points the diagram at its card or setting', () => {
    expect(focusOfEntry(e.find(x => x.id === 'drag#0') as LegendEntry)).toEqual({ card: 'drag#0', setting: undefined });
    expect(focusOfEntry(entriesFor(tpl('boids'), 'neighbours')[0])).toEqual({ card: undefined, setting: 'radius' });
  });
});

describe('tag layout', () => {
  const bounds = { x: 0, y: 0, w: 800, h: 600 };
  it('a free tag stays centred on its point', () => {
    const [t] = layoutTags([{ entry: 'a', text: '0.25', x: 200, y: 200 }], bounds);
    expect(t.left).toBeCloseTo(200 - tagWidth('0.25') / 2);
    expect(t.moved).toBe(false);
  });
  it('tags asked for at the same place move apart, and none overlap', () => {
    const reqs = Array.from({ length: 8 }, (_, i) => ({ entry: `e${i}`, text: `≤ ${i}.5°`, x: 300 + (i % 2) * 4, y: 300 }));
    const placed = layoutTags(reqs, bounds);
    expect(tagsOverlap(placed)).toBe(false);
    expect(placed.filter(p => p.moved).length).toBeGreaterThan(0);
  });
  it('they stay inside the viewport and off the legend', () => {
    const legend = { left: 12, top: 12, w: 292, h: 200 };
    const placed = layoutTags([{ entry: 'a', text: '×0.9', x: 100, y: 60 }, { entry: 'b', text: '1 s · 45%', x: 795, y: 598 }], bounds, [legend]);
    expect(tagsOverlap([...placed, legend])).toBe(false);
    for (const p of placed) {
      expect(p.left).toBeGreaterThanOrEqual(0); expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + p.w).toBeLessThanOrEqual(800); expect(p.top + p.h).toBeLessThanOrEqual(600);
    }
  });
});

describe('focus demos, from the live values', () => {
  it('gravity bends the thrown path away from the straight one, more for stronger gravity', () => {
    const gap = (s: number) => { const d = makeDemo({ kind: 'gravity', strength: s, angle: -90 }); const f = d.frame(d.period - 0.01); return Math.abs(f.paths[0].pts.at(-1)!.y - f.paths[1].pts.at(-1)!.y); };
    expect(gap(0)).toBeCloseTo(0, 5);
    expect(gap(0.5)).toBeGreaterThan(0.5);
    expect(gap(1)).toBeGreaterThan(gap(0.5) * 1.8);
  });
  it('drag: the one with drag falls behind, and keeps e^−drag of its speed after a second', () => {
    const d = makeDemo({ kind: 'drag', amount: 0.8 });
    const f = d.frame(1);
    const withDrag = f.paths[1].pts, without = f.paths[0].pts;
    const v = (p: typeof withDrag, i: number) => (p[i].x - p[i - 1].x) * DEMO_FPS;
    expect(v(withDrag, DEMO_FPS) / v(without, DEMO_FPS)).toBeCloseTo(Math.exp(-0.8), 1);
  });
  it('curl: the field moves with Changes, riders move with strength', () => {
    const still = makeDemo({ kind: 'curl', strength: 1, eddies: 1, evolve: 0 });
    const moving = makeDemo({ kind: 'curl', strength: 1, eddies: 1, evolve: 0.5 });
    expect(still.frame(0).arrows[5]).toEqual(still.frame(2).arrows[5]);
    expect(moving.frame(0).arrows[5]).not.toEqual(moving.frame(2).arrows[5]);
    const none = makeDemo({ kind: 'curl', strength: 0, eddies: 1, evolve: 0 });
    expect(none.frame(3).dots[0]).toMatchObject(none.frame(0).dots[0]);
  });
  it('orbit: the walker settles onto the circle, going its way round', () => {
    const d = makeDemo({ kind: 'orbit', degrees: 6, cw: false });
    const p = d.frame(d.period - 0.05).dots[0];
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(0.6, 0);
  });
  it('the view ring counts at most Max neighbours', () => {
    const d = makeDemo({ kind: 'view', radius: 0.05, max: 2 });
    for (const t of [0.5, 2, 4]) expect(d.frame(t).dots.filter(x => !x.hollow && x.r === 4).length).toBeLessThanOrEqual(2);
  });
  it('loops: a frame past the period is the same as one inside it', () => {
    const d = makeDemo({ kind: 'wander', degrees: 10 });
    expect(d.frame(d.period + 1)).toEqual(d.frame(1));
  });
});
