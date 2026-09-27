/**
 * Signing .playfile files (docs/playfile-format.md, "Signing").
 *
 * Each author has one Ed25519 key pair, made the first time they export a
 * node pack. The private key is a 32-byte seed kept on this device: in the
 * desktop app in the system keychain, in a browser in IndexedDB. The public
 * key and a display name go in the manifest, and the signature covers the
 * manifest (every item's path, size and SHA-256), so changing any item, or
 * the name, breaks it.
 *
 * Ed25519 runs through WebCrypto where the browser has it (Chrome 137+,
 * Safari 17+, Node 20+), otherwise through @noble/ed25519. Both give the same
 * signatures (Ed25519 is deterministic), so a key moves between them freely.
 *
 * What a signature says: this file hasn't changed since the holder of this key
 * made it. Not who that is: the name is whatever the author typed. Trusting a
 * key ("remember this author") is how a person connects a key to someone.
 */
import * as ed from '@noble/ed25519';
import { fromBase64, sha256Hex, toBase64 } from './bytes';

// ── Ed25519 ─────────────────────────────────────────────────────────────────

/** PKCS#8 wrapping of a raw 32-byte Ed25519 seed (RFC 8410). */
const PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

const subtle = (): SubtleCrypto | null => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);

let webCryptoEd25519: boolean | null = null;
/** Does this runtime's WebCrypto do Ed25519? Asked once. */
export async function hasWebCryptoEd25519(): Promise<boolean> {
  if (webCryptoEd25519 !== null) return webCryptoEd25519;
  const s = subtle();
  if (!s) return (webCryptoEd25519 = false);
  try {
    const seed = new Uint8Array(32);
    const key = await s.importKey('pkcs8', pkcs8(seed), { name: 'Ed25519' }, false, ['sign']);
    await s.sign({ name: 'Ed25519' }, key, new Uint8Array(1));
    webCryptoEd25519 = true;
  } catch { webCryptoEd25519 = false; }
  return webCryptoEd25519;
}

/** Tests: use the fallback (or WebCrypto again). */
export function forceEd25519Backend(b: 'webcrypto' | 'noble' | null): void { webCryptoEd25519 = b === null ? null : b === 'webcrypto'; }

function pkcs8(seed: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(PKCS8_PREFIX.length + 32);
  out.set(PKCS8_PREFIX); out.set(seed, PKCS8_PREFIX.length);
  return out.buffer;
}

const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

export function newSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function publicKeyOf(seed: Uint8Array): Promise<Uint8Array> {
  if (await hasWebCryptoEd25519()) {
    const key = await subtle()!.importKey('pkcs8', pkcs8(seed), { name: 'Ed25519' }, true, ['sign']);
    const jwk = await subtle()!.exportKey('jwk', key);
    return fromBase64(jwk.x!.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (jwk.x!.length % 4)) % 4));
  }
  return ed.getPublicKeyAsync(seed);
}

export async function signBytes(seed: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (await hasWebCryptoEd25519()) {
    const key = await subtle()!.importKey('pkcs8', pkcs8(seed), { name: 'Ed25519' }, false, ['sign']);
    return new Uint8Array(await subtle()!.sign({ name: 'Ed25519' }, key, buf(message)));
  }
  return ed.signAsync(message, seed);
}

/** False for a wrong signature, and for a malformed key or signature (never throws). */
export async function verifyBytes(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    if (await hasWebCryptoEd25519()) {
      const key = await subtle()!.importKey('raw', buf(publicKey), { name: 'Ed25519' }, false, ['verify']);
      return await subtle()!.verify({ name: 'Ed25519' }, key, buf(signature), buf(message));
    }
    return await ed.verifyAsync(signature, message, publicKey);
  } catch { return false; }
}

/** A short, readable fingerprint of a public key: the first 16 hex digits of its SHA-256, in fours. */
export function fingerprint(publicKey: Uint8Array | string): string {
  const b = typeof publicKey === 'string' ? fromBase64(publicKey) : publicKey;
  return sha256Hex(b).slice(0, 16).replace(/(.{4})(?!$)/g, '$1 ').toUpperCase();
}

// ── The author's own key ────────────────────────────────────────────────────

export interface KeyStore {
  load(): Promise<Uint8Array | null>;
  save(seed: Uint8Array): Promise<void>;
}

export interface Signer {
  publicKey: Uint8Array;
  fingerprint: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export function signerFromSeed(seed: Uint8Array, publicKey: Uint8Array): Signer {
  return { publicKey, fingerprint: fingerprint(publicKey), sign: m => signBytes(seed, m) };
}

const DB = 'playfield-keys';
const STORE = 'keys';
const AUTHOR_KEY = 'author-ed25519';

/** IndexedDB: the seed as bytes, in its own database (never in a profile, a library export or the workspace folder). */
export const indexedDbKeyStore: KeyStore = {
  async load() {
    if (typeof indexedDB === 'undefined') return null;
    const db = await openDb();
    try {
      const v = await req<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get(AUTHOR_KEY));
      return v instanceof Uint8Array && v.length === 32 ? v : v instanceof ArrayBuffer && v.byteLength === 32 ? new Uint8Array(v) : null;
    } finally { db.close(); }
  },
  async save(seed) {
    if (typeof indexedDB === 'undefined') throw new Error('This browser can’t keep a signing key (no IndexedDB).');
    const db = await openDb();
    try { await req(db.transaction(STORE, 'readwrite').objectStore(STORE).put(seed, AUTHOR_KEY)); } finally { db.close(); }
  },
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB didn’t open'));
  });
}
function req<T>(r: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result as T); r.onerror = () => reject(r.error); });
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Desktop: the system keychain (src-tauri/src/signing_key.rs), like the Kaggle key. */
export const keychainKeyStore: KeyStore = {
  async load() {
    const { invoke } = await import('@tauri-apps/api/core');
    const v = await invoke<string | null>('signing_key_get');
    if (!v) return null;
    const b = fromBase64(v);
    return b.length === 32 ? b : null;
  },
  async save(seed) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('signing_key_save', { key: toBase64(seed) });
  },
};

/** The desktop app's keychain, falling back to IndexedDB if the keychain can't be reached. */
export function defaultKeyStore(): KeyStore {
  if (!isTauri()) return indexedDbKeyStore;
  return {
    async load() { try { return (await keychainKeyStore.load()) ?? (await indexedDbKeyStore.load()); } catch { return indexedDbKeyStore.load(); } },
    async save(seed) { try { await keychainKeyStore.save(seed); } catch (e) { console.warn('[playfile] keychain unavailable, keeping the signing key in IndexedDB', e); await indexedDbKeyStore.save(seed); } },
  };
}

let cached: Promise<Signer> | null = null;

/** This author's signer: made (and kept) the first time it's asked for. */
export function authorSigner(store: KeyStore = defaultKeyStore()): Promise<Signer> {
  if (!cached) {
    cached = (async () => {
      let seed = await store.load();
      if (!seed) { seed = newSeed(); await store.save(seed); }
      return signerFromSeed(seed, await publicKeyOf(seed));
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}

/** The public half only, when a key exists (null before the first pack). Never makes one. */
export async function existingAuthorKey(store: KeyStore = defaultKeyStore()): Promise<{ publicKey: Uint8Array; fingerprint: string } | null> {
  if (cached) { const s = await cached.catch(() => null); if (s) return { publicKey: s.publicKey, fingerprint: s.fingerprint }; }
  try {
    const seed = await store.load();
    if (!seed) return null;
    const publicKey = await publicKeyOf(seed);
    return { publicKey, fingerprint: fingerprint(publicKey) };
  } catch { return null; }
}

export function resetAuthorSignerForTests(): void { cached = null; }

// ── Author name and trusted keys ────────────────────────────────────────────

/** The storage the name and trusted keys use: localStorage in the app, a map in tests. */
export interface SmallKV { get(key: string): string | null; set(key: string, value: string): void }
const localSmallKV: SmallKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* a convenience */ } },
};

/** A setting (kept with the app's settings, not in the workspace folder). */
export const AUTHOR_NAME_KEY = 'shader-studio:settings:packAuthor';
export const TRUSTED_KEYS_KEY = 'shader-studio:settings:trustedAuthors';

export function authorName(kv: SmallKV = localSmallKV): string {
  return kv.get(AUTHOR_NAME_KEY) ?? '';
}
export function setAuthorName(name: string, kv: SmallKV = localSmallKV): void {
  kv.set(AUTHOR_NAME_KEY, name.trim().slice(0, 80));
}

export interface TrustedAuthor { name: string; publicKey: string; since: number }

export function trustedAuthors(kv: SmallKV = localSmallKV): Record<string, TrustedAuthor> {
  try {
    const v = JSON.parse(kv.get(TRUSTED_KEYS_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, TrustedAuthor> : {};
  } catch { return {}; }
}

/** The trusted entry for a key (by its full public key, not just the fingerprint). */
export function trustedFor(publicKey: string, kv: SmallKV = localSmallKV): TrustedAuthor | null {
  const t = trustedAuthors(kv)[fingerprint(publicKey)];
  return t && t.publicKey === publicKey ? t : null;
}

export function trustAuthor(name: string, publicKey: string, kv: SmallKV = localSmallKV, now = Date.now()): void {
  const all = trustedAuthors(kv);
  all[fingerprint(publicKey)] = { name: name.slice(0, 80), publicKey, since: now };
  kv.set(TRUSTED_KEYS_KEY, JSON.stringify(all));
}

export function forgetAuthor(publicKey: string, kv: SmallKV = localSmallKV): void {
  const all = trustedAuthors(kv);
  delete all[fingerprint(publicKey)];
  kv.set(TRUSTED_KEYS_KEY, JSON.stringify(all));
}
