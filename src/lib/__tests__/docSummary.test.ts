import { describe, expect, it } from 'vitest';
import { plainLine, splitSummary } from '../docSummary';
import { NODE_REGISTRY } from '../../nodes/definitions';

describe('splitSummary', () => {
  it('leads with the first sentence and keeps the rest exactly', () => {
    const text = 'Cuts people out of a picture as a mask, on this device, no green screen. People finds everyone; Click finds a point.';
    const { summary, rest } = splitSummary(text);
    expect(summary).toBe('Cuts people out of a picture as a mask, on this device, no green screen.');
    expect(rest).toBe('People finds everyone; Click finds a point.');
  });

  it('pulls in a second sentence when the first is short', () => {
    const { summary, rest } = splitSummary('Adds two numbers. Wire anything that is a float into A and B. Then more text.');
    expect(summary).toBe('Adds two numbers. Wire anything that is a float into A and B.');
    expect(rest).toBe('Then more text.');
  });

  it('keeps a short first paragraph whole when its first sentence is very short', () => {
    const t = 'Adds A and B (A + B). Works on floats, vec2 and vec3 — pick the type on the card.';
    expect(splitSummary(t)).toEqual({ summary: t, rest: '' });
  });

  it('stops at the first paragraph and before a list', () => {
    expect(splitSummary('One short line\n\nA second paragraph.')).toEqual({ summary: 'One short line', rest: 'A second paragraph.' });
    expect(splitSummary('Does a thing\n- first\n- second')).toEqual({ summary: 'Does a thing', rest: '- first\n- second' });
  });

  it('does not split on e.g. or decimals', () => {
    const t = 'Blends two colours, e.g. red and blue, by 0.5 of the way across the whole picture by default. More.';
    expect(splitSummary(t).summary).toBe('Blends two colours, e.g. red and blue, by 0.5 of the way across the whole picture by default.');
  });

  it('handles empty text and a leading list', () => {
    expect(splitSummary(undefined)).toEqual({ summary: '', rest: '' });
    expect(splitSummary('- a\n- b')).toEqual({ summary: '- a\n- b', rest: '' });
  });

  it('never loses text from a real description (summary + rest = the original, whitespace aside)', () => {
    const squash = (s: string) => s.replace(/\s+/g, '');
    for (const def of Object.values(NODE_REGISTRY)) {
      const d = Array.isArray(def.description) ? (def.description as string[]).join('\n') : def.description;
      if (!d) continue;
      const { summary, rest } = splitSummary(d);
      expect(squash(summary + rest)).toBe(squash(d));
    }
  });
});

describe('plainLine', () => {
  it('drops the formatting marks and line breaks', () => {
    expect(plainLine('Uses `uv` and **bold**\n- item')).toBe('Uses uv and bold item');
  });
});
