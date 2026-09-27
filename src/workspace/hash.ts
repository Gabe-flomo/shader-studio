/**
 * hash.ts — content hashes for the workspace sync: two 32-bit FNV-1a lanes
 * with different seeds (64 bits, 16 hex digits). Not cryptographic; it only
 * has to tell "the same content" from "changed", synchronously and fast.
 * Text is hashed as UTF-16 code units, bytes as bytes (a path is always one
 * or the other, so the two never meet).
 */

export function hashString(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c; a = Math.imul(a, 0x01000193);
    b ^= c; b = Math.imul(b, 0x01000193 + 0x2e);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + s.length.toString(36);
}

export function hashBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    a ^= c; a = Math.imul(a, 0x01000193);
    b ^= c; b = Math.imul(b, 0x01000193 + 0x2e);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + 'b' + bytes.length.toString(36);
}
