/**
 * Sealed node packs (docs/playfile-format.md, "Sealing").
 *
 * A sealed node keeps its GLSL (the function and its iteration variants,
 * minified, and its helpers) encrypted with AES-256-GCM, in the pack file, in
 * this browser's storage and in the workspace folder. The node is filled
 * back in only in memory, when it is loaded, so the compiler gets real GLSL.
 * Its ports, params and name stay readable (the app needs them to show the
 * node), and it never carries a `source`.
 *
 * The key is derived (HKDF-SHA-256) from a secret that ships inside the app
 * and a random salt per node. That is the honest limit: anyone who digs the
 * secret out of the app can decrypt any sealed pack, and a shader has to reach
 * the GPU as source text anyway, so a debugger shows it. Sealing keeps the
 * code out of text editors and casual copying; it doesn't stop a determined
 * person. Synchronous on purpose (@noble/ciphers), so a sealed node is ready
 * the moment the node registry loads, like any other.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { SealedBlob, UserNodeDefinition } from '../types/userNode';
import { fromBase64, fromUtf8, toBase64, utf8 } from './bytes';

/** Not a secret from anyone who reads the app's code: see the module comment. */
const APP_SEAL_SECRET = 'playfield/sealed-node-pack/v1/4f1c9a2e-7b7d-4a53-9d0e-2c8f6b1e5a90';
const INFO = utf8('playfield sealed node v1');

interface SealedPayload {
  functionCode: string;
  helperFunctions: string[];
  /** Iteration count → function, when the node has an iteration slider. */
  iterationFunctions?: Record<string, string>;
}

function keyFor(salt: Uint8Array): Uint8Array {
  return hkdf(sha256, utf8(APP_SEAL_SECRET), salt, INFO, 32);
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/**
 * GLSL without comments, indentation or blank lines. Lines are kept (a
 * preprocessor directive must stay on its own line), so it compiles exactly
 * as before.
 */
export function minifyGlsl(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      const body = code.slice(i, end < 0 ? n : end + 2);
      // A block comment that spanned lines still ends a line (keeps directives apart).
      out += body.includes('\n') ? '\n' : ' ';
      i = end < 0 ? n : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function encryptPayload(payload: SealedPayload): SealedBlob {
  const salt = random(16), iv = random(12);
  const data = gcm(keyFor(salt), iv).encrypt(utf8(JSON.stringify(payload)));
  return { v: 1, alg: 'A256GCM', salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
}

/** Throws when the blob was changed or isn't one this app made. */
export function decryptPayload(blob: SealedBlob): SealedPayload {
  if (!blob || blob.v !== 1 || blob.alg !== 'A256GCM') throw new Error('Not a sealed node this version can open');
  const plain = gcm(keyFor(fromBase64(blob.salt)), fromBase64(blob.iv)).decrypt(fromBase64(blob.data));
  const p = JSON.parse(fromUtf8(plain)) as SealedPayload;
  if (typeof p?.functionCode !== 'string' || !Array.isArray(p.helperFunctions)) throw new Error('The sealed node is damaged');
  return p;
}

/**
 * Seal a definition: the stored form, with its code in the blob and blanks
 * where the code was. Already-sealed definitions keep their blob.
 */
export function sealDefinition(def: UserNodeDefinition): UserNodeDefinition {
  if (def.sealed) return storedForm(def);
  const payload: SealedPayload = {
    functionCode: minifyGlsl(def.functionCode),
    // Helpers stay as they were: the compiler shares a helper between nodes by its exact text
    // (a built-in's noise helper, say), so a minified copy would define it twice.
    helperFunctions: [...def.helperFunctions],
    ...(def.iterations ? { iterationFunctions: Object.fromEntries(Object.entries(def.iterations.functions).map(([k, v]) => [k, minifyGlsl(v)])) } : {}),
  };
  return storedForm({ ...def, sealed: encryptPayload(payload) });
}

/** What is saved and shared for a definition: for a sealed one, no code outside its blob and no source. */
export function storedForm(def: UserNodeDefinition): UserNodeDefinition {
  if (!def.sealed) return def;
  const { source: _source, ...rest } = def;
  void _source;
  return {
    ...rest,
    functionCode: '',
    helperFunctions: [],
    ...(def.iterations ? { iterations: { ...def.iterations, functions: {} } } : {}),
    sourceHidden: true,
  };
}

/** A sealed definition with its code filled back in (in memory only). Unsealed ones come back as they are. */
export function unsealDefinition(def: UserNodeDefinition): UserNodeDefinition {
  if (!def.sealed) return def;
  const p = decryptPayload(def.sealed);
  return {
    ...def,
    functionCode: p.functionCode,
    helperFunctions: p.helperFunctions,
    ...(def.iterations ? { iterations: { ...def.iterations, functions: p.iterationFunctions ?? {} } } : {}),
    sourceHidden: true,
  };
}

export const isSealed = (def: Pick<UserNodeDefinition, 'sealed'> | undefined | null): boolean => !!def?.sealed;
