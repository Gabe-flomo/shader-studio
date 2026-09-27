/**
 * The sign-in gate: an early, local stand-in for the licence layer
 * (docs/accounts-and-plans.md milestone 1). See docs/sign-in-gate.md.
 *
 * NOT security. It all runs in the browser, the user list ships in the bundle
 * and the repository is public: anyone can read the hashes, patch the check
 * out, or run the app from source. It keeps casual visitors out of a shared
 * link and lets the owner hand out Free and Pro logins to try the plans.
 *
 * Passwords are never stored: gateUsers.json holds salted PBKDF2-SHA256
 * hashes, written by `npm run gate:user` (tools/gate-user.mjs).
 *
 * When the licence service arrives, this module is what gets replaced: it
 * decides a `Session` and hands it to `usePlan.setSession` (src/lib/plan.ts).
 * The feature gates only ask `can()`, so they don't change.
 */
import type { Plan, Session } from '../lib/plan';
import gateFile from './gateUsers.json';

export interface GateUser {
  username: string;
  plan: Plan;
  /** Base64 random salt (16 bytes). */
  salt: string;
  /** Base64 PBKDF2-SHA256 of the password, HASH_BYTES long. */
  hash: string;
  iterations: number;
}

export const PBKDF2_ITERATIONS = 150_000;
export const HASH_BYTES = 32;

/** The users gateUsers.json lists, keeping only well-formed entries. */
export function parseGateUsers(raw: unknown): GateUser[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { users?: unknown }).users) ? (raw as { users: unknown[] }).users : [];
  return list.flatMap(u => {
    if (!u || typeof u !== 'object') return [];
    const x = u as Record<string, unknown>;
    if (typeof x.username !== 'string' || !x.username.trim()) return [];
    if (x.plan !== 'free' && x.plan !== 'pro') return [];
    if (typeof x.salt !== 'string' || typeof x.hash !== 'string') return [];
    const iterations = typeof x.iterations === 'number' && x.iterations >= 1000 ? x.iterations : PBKDF2_ITERATIONS;
    return [{ username: x.username.trim(), plan: x.plan, salt: x.salt, hash: x.hash, iterations }];
  });
}

export const GATE_USERS: readonly GateUser[] = parseGateUsers(gateFile);

/**
 * Is the gate on? Only when there are users to sign in as, and it wasn't
 * switched off for this build (VITE_GATE=off). Off means everyone is Pro.
 */
export function gateEnabled(users: readonly GateUser[], env: { VITE_GATE?: string } = {}): boolean {
  if ((env.VITE_GATE ?? '').trim().toLowerCase() === 'off') return false;
  return users.length > 0;
}

export function isGateOn(): boolean {
  return gateEnabled(GATE_USERS, import.meta.env as { VITE_GATE?: string });
}

// ── Hashing (WebCrypto: the same code runs in the browser, in Node and in the tests) ──

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Base64 PBKDF2-SHA256(password, salt). */
export async function hashPassword(password: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt) as BufferSource, iterations }, key, HASH_BYTES * 8);
  return toBase64(new Uint8Array(bits));
}

/** A new user entry for gateUsers.json. */
export async function makeGateUser(username: string, plan: Plan, password: string, iterations = PBKDF2_ITERATIONS): Promise<GateUser> {
  const salt = randomSalt();
  return { username: username.trim(), plan, salt, hash: await hashPassword(password, salt, iterations), iterations };
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function findUser(users: readonly GateUser[], username: string): GateUser | undefined {
  const name = username.trim().toLowerCase();
  return users.find(u => u.username.toLowerCase() === name);
}

/** The user these credentials sign in as, or null. Usernames ignore case; passwords don't. */
export async function verifyLogin(users: readonly GateUser[], username: string, password: string): Promise<GateUser | null> {
  const user = findUser(users, username);
  if (!user || !password) return null;
  const hash = await hashPassword(password, user.salt, user.iterations);
  return sameText(hash, user.hash) ? user : null;
}

// ── Staying signed in ───────────────────────────────────────────────────────

export const SESSION_KEY = 'playfield:gate-session';

/**
 * What is remembered: the username and a tag of the stored hash, so removing a
 * user or changing their password signs them out everywhere on the next load.
 * The plan is read from the user list, never from storage.
 */
interface Remembered { user: string; tag: string }

const tagOf = (u: GateUser) => u.hash.slice(0, 12);

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function stores(): { local: StorageLike | null; session: StorageLike | null } {
  let local: StorageLike | null = null, session: StorageLike | null = null;
  try { local = window.localStorage; } catch { /* blocked */ }
  try { session = window.sessionStorage; } catch { /* blocked */ }
  return { local, session };
}

/**
 * Remember a sign-in: in localStorage when "Stay signed in" is on, else in
 * sessionStorage (a reload keeps it, closing the tab doesn't).
 */
export function rememberSignIn(user: GateUser, stay: boolean, s = stores()): void {
  const value = JSON.stringify({ user: user.username, tag: tagOf(user) } satisfies Remembered);
  forgetSignIn(s);
  try { (stay ? s.local : s.session)?.setItem(SESSION_KEY, value); } catch { /* storage full or blocked: this page load only */ }
}

export function forgetSignIn(s = stores()): void {
  try { s.local?.removeItem(SESSION_KEY); } catch { /* blocked */ }
  try { s.session?.removeItem(SESSION_KEY); } catch { /* blocked */ }
}

/** The user a remembered sign-in still stands for, or null. */
export function restoreSignIn(users: readonly GateUser[], s = stores()): GateUser | null {
  for (const store of [s.session, s.local]) {
    let raw: string | null = null;
    try { raw = store?.getItem(SESSION_KEY) ?? null; } catch { raw = null; }
    if (!raw) continue;
    try {
      const r = JSON.parse(raw) as Partial<Remembered>;
      const user = typeof r.user === 'string' ? findUser(users, r.user) : undefined;
      if (user && typeof r.tag === 'string' && sameText(r.tag, tagOf(user))) return user;
    } catch { /* not ours */ }
  }
  return null;
}

/** The session a gate user stands for. */
export function sessionFor(user: GateUser): Session {
  return { status: 'signed-in', user: user.username, plan: user.plan, source: 'gate' };
}

/** With the gate off: everyone is Pro. */
export const OPEN_SESSION: Session = { status: 'signed-in', user: '', plan: 'pro', source: 'open' };

/** Sign out: forget the sign-in and reload, which shows the sign-in page again. */
export function signOut(): void {
  forgetSignIn();
  window.location.reload();
}
