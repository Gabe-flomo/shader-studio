/**
 * The .playfile container envelope (format v2, docs/playfile-format.md
 * "Container v2"): a fixed header, then the v1 ZIP deflated and encrypted
 * with AES-256-GCM. An archive tool sees noise; the reader sees a ZIP again.
 *
 *   offset  size  field
 *        0     4  magic "PLYF"
 *        4     1  container version (2)
 *        5     1  flags: bit 0 = the payload is deflated before encryption
 *        6     2  reserved, 0
 *        8     4  ciphertext length, little-endian (includes the 16-byte GCM tag)
 *       12     4  payload length once decrypted and inflated (the v1 ZIP's size)
 *       16    16  salt, random per file
 *       32    12  nonce, random per file
 *       44     …  ciphertext
 *
 * The key is HKDF-SHA-256(secret, salt, info): the secret ships in the app
 * (secret.ts says what that is and isn't worth), the salt is the file's, so
 * one file's key opens only that file. The header is the GCM's additional
 * data, so a changed byte anywhere (version, flags, lengths, salt, nonce,
 * ciphertext) fails the tag and the file is refused as modified or damaged.
 * Lengths are checked against the limits before anything is decrypted or
 * inflated, and the inflate writes into a buffer of the declared size.
 *
 * AES runs through WebCrypto where the page has it (every https page and
 * localhost) and through @noble/ciphers otherwise (a plain-http LAN address);
 * both give the same bytes. The wrapping is sync-free of the DOM, so tests run
 * it in Node.
 */
import { deflateSync, inflateSync } from 'fflate';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8 } from './bytes';
import { CONTAINER_VERSION, DEFAULT_LIMITS, formatBytes as mb, PlayfileError, type PlayfileLimits } from './format';
import { PLAYFILE_CONTAINER_SECRET } from './secret';

export const CONTAINER_MAGIC = new Uint8Array([0x50, 0x4c, 0x59, 0x46]); // "PLYF"
export const HEADER_BYTES = 44;
const TAG_BYTES = 16;
const FLAG_DEFLATED = 1;
const INFO = utf8('playfield playfile container v2');

export const MODIFIED_MESSAGE = 'This file was modified or damaged, so it wasn’t opened.';

/** Does it start with the container's magic? (Any version: a newer one is refused later, with a sentence.) */
export function isContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === CONTAINER_MAGIC[0] && bytes[1] === CONTAINER_MAGIC[1] && bytes[2] === CONTAINER_MAGIC[2] && bytes[3] === CONTAINER_MAGIC[3];
}

type Backend = 'webcrypto' | 'noble';
let forced: Backend | null = null;
/** Tests: run AES through one backend. null: whichever the page has. */
export function forceContainerBackend(b: Backend | null): void { forced = b; }
const backend = (): Backend => forced ?? (typeof crypto !== 'undefined' && crypto.subtle ? 'webcrypto' : 'noble');

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const keyFor = (salt: Uint8Array): Uint8Array<ArrayBuffer> => hkdf(sha256, utf8(PLAYFILE_CONTAINER_SECRET), salt, INFO, 32) as Uint8Array<ArrayBuffer>;
const ab = (b: Uint8Array): Uint8Array<ArrayBuffer> => b as Uint8Array<ArrayBuffer>;

async function encrypt(key: Uint8Array<ArrayBuffer>, nonce: Uint8Array, aad: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  if (backend() === 'noble') return gcm(key, nonce, aad).encrypt(plain);
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(nonce), additionalData: ab(aad), tagLength: TAG_BYTES * 8 }, k, ab(plain)));
}

/** Throws (anything) when the tag doesn't match. */
async function decrypt(key: Uint8Array<ArrayBuffer>, nonce: Uint8Array, aad: Uint8Array, cipher: Uint8Array): Promise<Uint8Array> {
  if (backend() === 'noble') return gcm(key, nonce, aad).decrypt(cipher);
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(nonce), additionalData: ab(aad), tagLength: TAG_BYTES * 8 }, k, ab(cipher)));
}

function header(flags: number, cipherBytes: number, plainBytes: number, salt: Uint8Array, nonce: Uint8Array): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(HEADER_BYTES);
  const v = new DataView(h.buffer);
  h.set(CONTAINER_MAGIC, 0);
  h[4] = CONTAINER_VERSION;
  h[5] = flags;
  v.setUint16(6, 0, true);
  v.setUint32(8, cipherBytes, true);
  v.setUint32(12, plainBytes, true);
  h.set(salt, 16);
  h.set(nonce, 32);
  return h;
}

/** A v1 ZIP → v2 container bytes. */
export async function wrapContainer(zip: Uint8Array, opts: { compress?: boolean } = {}): Promise<Uint8Array> {
  if (zip.length > 0xffffffff) throw new PlayfileError('It’s too big to write.');
  const compress = opts.compress ?? true;
  // The ZIP's entries are already deflated, so this mostly hides the ZIP's own structure (names, sizes, the central directory).
  const payload = compress ? deflateSync(zip, { level: 1 }) : zip;
  const salt = random(16), nonce = random(12);
  const cipherBytes = payload.length + TAG_BYTES;
  const h = header(compress ? FLAG_DEFLATED : 0, cipherBytes, zip.length, salt, nonce);
  const cipher = await encrypt(keyFor(salt), nonce, h, payload);
  if (cipher.length !== cipherBytes) throw new PlayfileError('The container couldn’t be written.');
  const out = new Uint8Array(HEADER_BYTES + cipherBytes);
  out.set(h, 0);
  out.set(cipher, HEADER_BYTES);
  return out;
}

/**
 * v2 container bytes → the v1 ZIP inside. Every check the header allows
 * happens before decrypting: the version, the lengths against the limits,
 * the ciphertext length against the file's. Throws PlayfileError.
 */
export async function unwrapContainer(bytes: Uint8Array, limits: PlayfileLimits = DEFAULT_LIMITS): Promise<Uint8Array> {
  if (!isContainer(bytes)) throw new PlayfileError('Not a Playfield file.');
  if (bytes.length > limits.fileBytes) throw new PlayfileError(`It’s too big to open (${mb(bytes.length)}; the limit is ${mb(limits.fileBytes)}).`);
  if (bytes.length < HEADER_BYTES) throw new PlayfileError(MODIFIED_MESSAGE);
  const version = bytes[4];
  if (version > CONTAINER_VERSION) throw new PlayfileError(`It was made by a newer Playfield (container ${version}; this one reads up to ${CONTAINER_VERSION}). Update Playfield to open it.`);
  if (version < 2) throw new PlayfileError(MODIFIED_MESSAGE);
  const h = bytes.subarray(0, HEADER_BYTES);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[5];
  const cipherBytes = v.getUint32(8, true);
  const plainBytes = v.getUint32(12, true);
  if (cipherBytes !== bytes.length - HEADER_BYTES || cipherBytes < TAG_BYTES) throw new PlayfileError(MODIFIED_MESSAGE);
  // The ZIP inside is bounded like a v1 file: refused here, before any decrypting or inflating.
  if (plainBytes > limits.fileBytes) throw new PlayfileError(`It’s too big to open (${mb(plainBytes)} unpacked; the limit is ${mb(limits.fileBytes)}).`);
  if (flags & ~FLAG_DEFLATED) throw new PlayfileError(MODIFIED_MESSAGE);
  const salt = bytes.subarray(16, 32), nonce = bytes.subarray(32, 44);
  let payload: Uint8Array;
  try { payload = await decrypt(keyFor(salt), nonce, h, bytes.subarray(HEADER_BYTES)); } catch { throw new PlayfileError(MODIFIED_MESSAGE); }
  let zip: Uint8Array;
  if (flags & FLAG_DEFLATED) {
    // Into a buffer of the declared size: an inflate can't grow past it.
    try { zip = inflateSync(payload, { out: new Uint8Array(plainBytes) }); } catch { throw new PlayfileError(MODIFIED_MESSAGE); }
  } else zip = payload;
  if (zip.length !== plainBytes) throw new PlayfileError(MODIFIED_MESSAGE);
  return zip;
}
