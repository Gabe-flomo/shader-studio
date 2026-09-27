/**
 * The sign-in gate (docs/sign-in-gate.md): hashing, checking a login, when the
 * gate is on, and staying signed in. Users here are throwaway, made in the test.
 */
import { describe, expect, it } from 'vitest';
import { GATE_USERS, OPEN_SESSION, forgetSignIn, gateEnabled, hashPassword, makeGateUser, parseGateUsers, rememberSignIn, restoreSignIn, sessionFor, verifyLogin, type GateUser } from '../gate';

const FAST = 2000; // iterations: enough to exercise PBKDF2 without slowing the suite

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
}

describe('hashing', () => {
  it('is deterministic per salt, different across salts, 32 bytes', async () => {
    const salt = btoa('0123456789abcdef');
    const a = await hashPassword('correct horse', salt, FAST);
    expect(a).toBe(await hashPassword('correct horse', salt, FAST));
    expect(a).not.toBe(await hashPassword('correct horse', btoa('fedcba9876543210'), FAST));
    expect(atob(a)).toHaveLength(32);
  });

  it('matches a known PBKDF2-HMAC-SHA256 vector', async () => {
    // RFC 7914 §11: P="passwd", S="salt", c=1 (the first 32 bytes of its 64).
    const h = await hashPassword('passwd', btoa('salt'), 1);
    const hex = [...atob(h)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
  });

  it('uses 150k iterations for a new user and never keeps the password', async () => {
    const u = await makeGateUser('tester', 'pro', 'a long throwaway password');
    expect(u.iterations).toBe(150_000);
    expect(JSON.stringify(u)).not.toContain('throwaway');
  });
});

describe('verifyLogin', () => {
  it('accepts the right password (username in any case) and rejects the rest', async () => {
    const users = [await makeGateUser('Free-Tester', 'free', 'pass-free-123', FAST), await makeGateUser('pro-tester', 'pro', 'pass-pro-456', FAST)];
    expect((await verifyLogin(users, 'free-tester', 'pass-free-123'))?.plan).toBe('free');
    expect((await verifyLogin(users, ' PRO-TESTER ', 'pass-pro-456'))?.plan).toBe('pro');
    expect(await verifyLogin(users, 'free-tester', 'pass-pro-456')).toBeNull();
    expect(await verifyLogin(users, 'free-tester', 'PASS-FREE-123')).toBeNull();
    expect(await verifyLogin(users, 'nobody', 'pass-free-123')).toBeNull();
    expect(await verifyLogin(users, 'free-tester', '')).toBeNull();
  });
});

describe('gate on or off', () => {
  const one: GateUser[] = [{ username: 'a', plan: 'free', salt: 'AA==', hash: 'AA==', iterations: FAST }];
  it('is off with no users, and then everyone is Pro', () => {
    expect(gateEnabled([], {})).toBe(false);
    expect(OPEN_SESSION).toMatchObject({ status: 'signed-in', plan: 'pro', source: 'open' });
  });
  it('is on with users unless VITE_GATE=off', () => {
    expect(gateEnabled(one, {})).toBe(true);
    expect(gateEnabled(one, { VITE_GATE: 'on' })).toBe(true);
    expect(gateEnabled(one, { VITE_GATE: 'off' })).toBe(false);
    expect(gateEnabled(one, { VITE_GATE: ' OFF ' })).toBe(false);
  });
  it('ships with no users (the gate is off until the owner adds some)', () => {
    expect(GATE_USERS).toEqual([]);
  });
  it('keeps only well-formed entries', () => {
    expect(parseGateUsers({ users: [...one, { username: 'b', plan: 'gold', salt: 'x', hash: 'y' }, { plan: 'pro' }, null] })).toHaveLength(1);
    expect(parseGateUsers(null)).toEqual([]);
    expect(parseGateUsers({})).toEqual([]);
  });
});

describe('staying signed in', () => {
  it('remembers in localStorage with Stay signed in, else only for the tab', async () => {
    const u = await makeGateUser('keeper', 'free', 'pass-keeper-1', FAST);
    const local = memStore(), session = memStore();
    rememberSignIn(u, true, { local, session });
    expect(local.m.size).toBe(1);
    expect(session.m.size).toBe(0);
    expect(restoreSignIn([u], { local, session })?.username).toBe('keeper');
    rememberSignIn(u, false, { local, session });
    expect(local.m.size).toBe(0);
    expect(session.m.size).toBe(1);
    forgetSignIn({ local, session });
    expect(restoreSignIn([u], { local, session })).toBeNull();
  });

  it('forgets a sign-in when the user is removed or their password changes', async () => {
    const u = await makeGateUser('keeper', 'pro', 'pass-keeper-1', FAST);
    const local = memStore(), session = memStore();
    rememberSignIn(u, true, { local, session });
    expect(restoreSignIn([], { local, session })).toBeNull();
    const changed = await makeGateUser('keeper', 'pro', 'a-new-password', FAST);
    expect(restoreSignIn([changed], { local, session })).toBeNull();
  });

  it('never takes the plan from storage', async () => {
    const u = await makeGateUser('keeper', 'free', 'pass-keeper-1', FAST);
    const local = memStore(), session = memStore();
    local.setItem('playfield:gate-session', JSON.stringify({ user: 'keeper', tag: u.hash.slice(0, 12), plan: 'pro' }));
    const back = restoreSignIn([u], { local, session })!;
    expect(sessionFor(back)).toMatchObject({ plan: 'free', user: 'keeper', source: 'gate' });
  });

  it('survives storage that throws', async () => {
    const u = await makeGateUser('keeper', 'free', 'pass-keeper-1', FAST);
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => rememberSignIn(u, true, { local: boom, session: boom })).not.toThrow();
    expect(restoreSignIn([u], { local: boom, session: boom })).toBeNull();
  });
});
