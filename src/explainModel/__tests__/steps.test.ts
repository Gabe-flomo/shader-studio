import { describe, expect, it } from 'vitest';
import { promptForSteps, STEPS_SYSTEM_PROMPT } from '../prompt';
import { viewAnswer } from '../assess';
import { explainLine } from '../../lib/glslPatterns';

describe('explaining a line step by step with the model', () => {
  const line = 'float phase = 2.0 * angle - wind * log(home) - 0.12 * t;';
  const ex = explainLine(line, {});
  const steps = ex.ok ? ex.steps.map(s => ({ label: s.label, code: s.code, reading: s.text })) : [];

  it('lists every step with its letter, code and rule-based reading, and checks answers against the steps', () => {
    expect(steps.length).toBeGreaterThan(1);
    const p = promptForSteps(line, steps, { kind: 'Expression Block' });
    expect(p.messages[0].content).toBe(STEPS_SYSTEM_PROMPT);
    const user = p.messages[1].content;
    steps.forEach((s, i) => expect(user).toContain(`${i + 1} (${s.label}): ${s.code}`));
    expect(user).toContain(`one object for each of steps 1 to ${steps.length}`);
    expect(p.check?.lines).toEqual(steps.map(s => s.code));
    expect(user).not.toMatch(/label|title/i);
  });

  it('reads the answer as one item per step', () => {
    const raw = steps.map((_, i) => JSON.stringify({ line: i + 1, what: `step ${i + 1} doubles it`, effect: '', sure: 'high', unsure_about: '' })).join('\n');
    const view = viewAnswer({ kind: 'block', raw, done: true, check: promptForSteps(line, steps, {}).check });
    expect(view.items.map(i => i.item.line)).toEqual(steps.map((_, i) => i + 1));
  });
});
