/**
 * Muting in the Agent Builder (docs/agent-builder.md, "Muting"). A behaviour card's mute is its
 * rule switched off (`off`), so agents' own compile path (agentRules/generate.ts) leaves it out:
 * the fallback of builders/mute.ts, no `__mute` gate. Muting keeps the card's settings, solo mutes
 * the rest of its section, and the agents dialect reads the builders' `muted` word as @off.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import type { AgentRuleSet } from '../../agentRules/spec';
import { rulesTemplate, RULES_TEMPLATES } from '../../agentRules/templates';
import { generateRulesInside } from '../../agentRules/generate';
import { MUTE_PARAM } from '../../builders/mute';
import { parseAgents, printAgents } from '../../lang/dialects/agents';
import { readBehaviours, removeAt, setOnAt, soloCard } from '../behaviours';
import { kindCards } from '../sections';

const tpl = (k: string) => rulesTemplate(k)!.set();
const gen = (s: AgentRuleSet) => JSON.stringify(generateRulesInside(s, { groupId: 'g', d3: false }));
/**
 * What each node does, without ids, labels and notes, and with each rule's random seed blanked
 * (a rule's number, which names it and seeds its randomness, moves when one before it is left out).
 */
const work = (s: AgentRuleSet) => JSON.stringify(generateRulesInside(s, { groupId: 'g', d3: false })
  .map(n => [n.type, n.params.lines ?? null, n.params.result ?? null, Object.keys(n.inputs)])).replace(/0x[0-9A-Fa-f]+u/g, 'SEED');
const cardsOf = (s: AgentRuleSet) => readBehaviours(s, 0, kindCards('flock')).cards;
const card = (s: AgentRuleSet, key: string) => cardsOf(s).find(c => c.key === key)!;

describe('agent builder: muting a card', () => {
  it('a muted card builds the walker without it (as if it were taken away), and keeps its settings', () => {
    const s = tpl('boids');
    const muted = setOnAt(s, 0, card(s, 'cohere#0').at, false);
    // The card in a rule of its own (a mute splits its rule round it; it runs the same).
    const split = setOnAt(s, 0, card(s, 'cohere#0').at, true);
    const gone = removeAt(split, 0, card(split, 'cohere#0').at);
    expect(card(muted, 'cohere#0').on).toBe(false);
    expect(card(muted, 'cohere#0').action).toEqual(card(s, 'cohere#0').action);
    // The same code as the setup without the card (the action's code is not there).
    expect(work(muted)).toBe(work(gone));
    expect(work(muted)).not.toBe(work(split));
    // Unmuted: the walker is back (the same nodes as before muting).
    const back = setOnAt(muted, 0, card(muted, 'cohere#0').at, true);
    expect(gen(back)).toBe(gen(split));
    expect(back).toEqual(split);
  });

  it('agents never get a __mute gate (their compile path has none): never-muted and muted builds alike', () => {
    for (const t of RULES_TEMPLATES) {
      const s = t.set();
      expect(gen(s)).not.toContain(MUTE_PARAM);
      const c = readBehaviours(s, 0, kindCards(s.kind ?? 'trail')).cards[0];
      if (c) expect(gen(setOnAt(s, 0, c.at, false))).not.toContain(MUTE_PARAM);
    }
  });

  it('solo mutes the others in its section; soloing it again turns them all back on', () => {
    const s = tpl('boids');
    const keys = ['separate#0', 'match#0', 'cohere#0'];
    const solo = soloCard(s, 0, kindCards('flock'), keys, 'match#0');
    expect(keys.map(k => card(solo, k).on)).toEqual([false, true, false]);
    expect(card(solo, 'wobble#0').on).toBe(true); // not in the stack
    const again = soloCard(solo, 0, kindCards('flock'), keys, 'match#0');
    expect(keys.map(k => card(again, k).on)).toEqual([true, true, true]);
    expect(again.species[0].rules.some(r => r.off)).toBe(false);
  });
});

describe('agent builder: the muted word in the agents dialect', () => {
  it('a muted card prints as @off and reads back the same; `muted` (bare or @muted) reads as off', () => {
    const s = tpl('boids');
    const muted = setOnAt(s, 0, card(s, 'cohere#0').at, false);
    const text = printAgents(muted);
    expect(text).toContain('@off');
    expect(printAgents(parseAgents(text, { seed: 1 }).set)).toBe(text);
    const word = text.replace('@off', 'muted');
    const r = parseAgents(word, { seed: 1 });
    expect(r.errors).toEqual([]);
    expect(printAgents(r.set)).toBe(text);
    const at = parseAgents(text.replace('@off', '@muted'), { seed: 1 });
    expect(at.errors).toEqual([]);
    expect(printAgents(at.set)).toBe(text);
    // Never muted: no flag at all.
    expect(printAgents(s)).not.toMatch(/@off|muted/);
  });
});
