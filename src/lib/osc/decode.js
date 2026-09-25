/**
 * decode.js — a small, dependency-free OSC 1.0 decoder, shared by the bridge
 * (tools/osc-bridge.mjs, Node) and the tests. Plain JS so Node can run it
 * without a build step.
 *
 * Handles messages and (nested) bundles; argument types i f d h s S T F N I c
 * and blobs (skipped as null). Unknown types stop the message's arguments.
 */

function readString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = new TextDecoder().decode(buf.subarray(offset, end));
  // Strings are NUL-terminated and padded to a multiple of 4.
  return { value: str, next: (end + 4) & ~3 };
}

function decodeMessage(buf, view, out) {
  const addr = readString(buf, 0);
  if (!addr.value.startsWith('/')) return;
  let offset = addr.next;
  const args = [];
  if (offset < buf.length && buf[offset] === 0x2c /* , */) {
    const tags = readString(buf, offset);
    offset = tags.next;
    for (const t of tags.value.slice(1)) {
      if (t === 'i') { args.push(view.getInt32(offset)); offset += 4; }
      else if (t === 'f') { args.push(view.getFloat32(offset)); offset += 4; }
      else if (t === 'd') { args.push(view.getFloat64(offset)); offset += 8; }
      else if (t === 'h') { args.push(Number(view.getBigInt64(offset))); offset += 8; }
      else if (t === 's' || t === 'S') { const s = readString(buf, offset); args.push(s.value); offset = s.next; }
      else if (t === 'c') { args.push(String.fromCharCode(view.getInt32(offset))); offset += 4; }
      else if (t === 'T') args.push(true);
      else if (t === 'F') args.push(false);
      else if (t === 'N' || t === 'I') args.push(null);
      else if (t === 'b') { const n = view.getInt32(offset); args.push(null); offset += 4 + ((n + 3) & ~3); }
      else break;
    }
  }
  out.push({ address: addr.value, args });
}

function decodeInto(buf, out, depth) {
  if (depth > 8 || buf.length < 4) return;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length >= 16 && new TextDecoder().decode(buf.subarray(0, 7)) === '#bundle' && buf[7] === 0) {
    let offset = 16; // "#bundle\0" + 8-byte time tag
    while (offset + 4 <= buf.length) {
      const size = view.getInt32(offset);
      offset += 4;
      if (size <= 0 || offset + size > buf.length) break;
      decodeInto(buf.subarray(offset, offset + size), out, depth + 1);
      offset += size;
    }
    return;
  }
  decodeMessage(buf, view, out);
}

/** Decode one UDP datagram into zero or more `{ address, args }` messages. Never throws. */
export function decodeOsc(data) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const out = [];
  try { decodeInto(buf, out, 0); } catch { /* truncated packet: keep what decoded */ }
  return out;
}

/** Encode a message (tests and the bridge's self-test). Supports numbers (as floats), ints via {i}, strings and booleans. */
export function encodeOsc(address, args = []) {
  const enc = new TextEncoder();
  const pad = bytes => { const n = (bytes.length + 4) & ~3; const b = new Uint8Array(n); b.set(bytes); return b; };
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (typeof a === 'boolean') tags += a ? 'T' : 'F';
    else if (typeof a === 'string') { tags += 's'; parts.push(pad(enc.encode(a))); }
    else if (a && typeof a === 'object' && 'i' in a) { tags += 'i'; const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, a.i); parts.push(b); }
    else { tags += 'f'; const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, a); parts.push(b); }
  }
  const all = [pad(enc.encode(address)), pad(enc.encode(tags)), ...parts];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
