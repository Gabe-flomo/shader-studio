import { beforeEach, describe, expect, it } from 'vitest';
import { markPhoneWelcomed, PHONE_WELCOME_KEY, resetPhoneWelcomeSession, shouldWelcomePhone } from '../phoneWelcome';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

describe('phone first-open welcome', () => {
  beforeEach(() => resetPhoneWelcomeSession());

  it('shows once on a phone, on the Studio', () => {
    const s = memory();
    expect(shouldWelcomePhone({ phone: true, page: 'studio' }, s)).toBe(true);
    markPhoneWelcomed(s);
    expect(s.m.get(PHONE_WELCOME_KEY)).toBe('1');
    resetPhoneWelcomeSession();
    expect(shouldWelcomePhone({ phone: true, page: 'studio' }, s)).toBe(false);
  });

  it('never on a desktop or tablet, or on another page', () => {
    const s = memory();
    expect(shouldWelcomePhone({ phone: false, page: 'studio' }, s)).toBe(false);
    expect(shouldWelcomePhone({ phone: true, page: 'play' }, s)).toBe(false);
  });

  it('a storage that throws shows it once a session and never breaks', () => {
    const bad = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } };
    expect(shouldWelcomePhone({ phone: true, page: 'studio' }, bad)).toBe(true);
    expect(() => markPhoneWelcomed(bad)).not.toThrow();
    expect(shouldWelcomePhone({ phone: true, page: 'studio' }, bad)).toBe(false);
  });
});
