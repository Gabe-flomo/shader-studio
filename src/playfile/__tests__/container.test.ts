/**
 * The .playfile container: writing and reading every kind, the v2 envelope
 * (opaque to archive tools, tamper-proof, v1 still read), manifest validation
 * (paths, sizes, hashes, versions, unknown kinds), signing and tamper
 * detection with both Ed25519 backends, and sealing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readPlayfile, isPlayfile } from '../reader';
import { writePlayfile, writePlayfileZip, playfileName } from '../writer';
import { forceContainerBackend, HEADER_BYTES, isContainer, unwrapContainer, wrapContainer } from '../container';
import { CONTAINER_VERSION, DEFAULT_LIMITS, isSafePath, ITEM_KINDS, type PlayfileLimits } from '../format';
import { canonicalJson, sha256Hex } from '../bytes';
import { fingerprint, forceEd25519Backend, newSeed, publicKeyOf, signerFromSeed, trustAuthor, trustedFor, type SmallKV } from '../signing';
import { minifyGlsl, sealDefinition, unsealDefinition, storedForm } from '../sealing';
import type { UserNodeDefinition } from '../../types/userNode';

const small: PlayfileLimits = { ...DEFAULT_LIMITS, fileBytes: 200_000, itemBytes: 50_000, totalBytes: 120_000, entries: 20 };

async function signer() {
  const seed = newSeed();
  return signerFromSeed(seed, await publicKeyOf(seed));
}

/** Rewrite one file inside the ZIP a .playfile holds (v2 is unwrapped and wrapped again; a v1 ZIP stays one). */
async function patchZip(bytes: Uint8Array, path: string, f: (b: Uint8Array) => Uint8Array): Promise<Uint8Array> {
  const v2 = isContainer(bytes);
  const files: Record<string, Uint8Array> = unzipSync(v2 ? await unwrapContainer(bytes) : bytes);
  files[path] = f(files[path]);
  const zip = zipSync(files);
  return v2 ? wrapContainer(zip) : zip;
}
const editManifest = (bytes: Uint8Array, f: (m: Record<string, unknown>) => void) => patchZip(bytes, 'manifest.json', b => { const m = JSON.parse(strFromU8(b)); f(m); return strToU8(JSON.stringify(m)); });

export const NODE: UserNodeDefinition = {
  id: 'un_wobble_abc', label: 'Wobble', category: 'My Nodes', description: 'Wobbles',
  inputs: [{ key: 'uv', type: 'vec2', label: 'UV' }], outputs: [{ key: 'out', type: 'float', label: 'Out' }],
  params: [{ key: 'amt', label: 'Amount', min: 0, max: 1, default: 0.5 }],
  fnName: 'un_wobble_abc',
  functionCode: 'float un_wobble_abc(vec2 uv, float amt) {\n  // the secret sauce\n  float secretWobbleValue = sin(uv.x * 17.0) * amt;\n  return secretWobbleValue;\n}',
  helperFunctions: ['float wobbleHelper(float x) { return x * 3.0; }'],
  implicitGlobals: [], version: 1, savedAt: 1,
  source: { kind: 'code', code: 'float f(vec2 uv){ return secretSourceText; }', entry: 'f' },
};

describe('writing and reading', () => {
  it('round-trips every kind, with names, sizes and hashes', async () => {
    const items = ITEM_KINDS.map((kind, i) => ({ kind, name: `Item ${i}`, data: `{"n":${i}}`, ...(kind === 'background' ? { ext: '.png' } : {}) }));
    const { bytes, manifest } = await writePlayfile(items, { author: 'Ada', created: new Date(1000) });
    expect(isPlayfile(bytes)).toBe(true);
    expect(manifest.format).toBe('playfile');
    const r = await readPlayfile(bytes);
    expect(r.items.map(i => [i.kind, i.name, strFromU8(i.data)])).toEqual(items.map(i => [i.kind, i.name, i.data]));
    expect(r.skipped).toEqual([]);
    expect(r.signature).toEqual({ state: 'unsigned', name: 'Ada' });
    expect(r.manifest.kinds.sort()).toEqual([...ITEM_KINDS].sort());
    for (const it of r.items) expect(it.sha256).toBe(sha256Hex(it.data));
    expect(r.items.find(i => i.kind === 'background')!.path).toBe('backgrounds/Item 5.png');
  });

  it('keeps duplicate names apart and names files safely', async () => {
    const { manifest } = await writePlayfile([{ kind: 'graph', name: 'A/B', data: '{}' }, { kind: 'graph', name: 'A/B', data: '{}' }, { kind: 'graph', name: '../../etc', data: '{}' }]);
    expect(manifest.items.map(i => i.path)).toEqual(['graphs/A-B.graph.json', 'graphs/A-B (2).graph.json', 'graphs/-..-etc.graph.json']);
    expect(manifest.items.every(i => isSafePath(i.path))).toBe(true);
    expect(playfileName('My: show.playfield')).toBe('My- show.playfile');
  });

  it('refuses an empty file list, non-ZIPs and ZIPs without a manifest', async () => {
    await expect(writePlayfile([])).rejects.toThrow();
    await expect(readPlayfile(strToU8('{"nodes":[]}'))).rejects.toThrow(/Not a Playfield file/);
    await expect(readPlayfile(zipSync({ 'a.json': strToU8('{}') }))).rejects.toThrow(/no manifest/);
    await expect(readPlayfile(await wrapContainer(zipSync({ 'a.json': strToU8('{}') })))).rejects.toThrow(/no manifest/);
    expect(isPlayfile(zipSync({ 'library.json': strToU8('{}') }))).toBe(false);
  });

  it('still reads the names the format had while it was built', async () => {
    const { bytes } = await writePlayfile([{ kind: 'glsl', name: 'x', data: 'void main(){}' }]);
    for (const f of ['playfield', 'play']) {
      const old = await editManifest(bytes, m => { m.format = f; });
      expect(isPlayfile(old)).toBe(true);
      expect((await readPlayfile(old)).items).toHaveLength(1);
    }
  });
});

describe('the v2 envelope', () => {
  const magic = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 4));
  const flip = (b: Uint8Array, at: number) => { const c = b.slice(); c[at] ^= 1; return c; };

  it('round-trips every kind through the envelope, and the bytes start with PLYF', async () => {
    const items = ITEM_KINDS.map((kind, i) => ({ kind, name: `Item ${i}`, data: `{"kind":"${kind}","n":${i}}`, ...(kind === 'background' ? { ext: '.png' } : {}) }));
    const { bytes, manifest } = await writePlayfile(items, { author: 'Ada' });
    expect(magic(bytes)).toBe('PLYF');
    expect(bytes[4]).toBe(CONTAINER_VERSION);
    expect(isContainer(bytes)).toBe(true);
    expect(isPlayfile(bytes)).toBe(true);
    // The manifest inside is still layout version 1: the envelope changed, not the ZIP.
    expect(manifest.version).toBe(1);
    const r = await readPlayfile(bytes);
    expect(r.manifest.version).toBe(1);
    expect(r.items.map(i => [i.kind, i.name, strFromU8(i.data)])).toEqual(items.map(i => [i.kind, i.name, i.data]));
    expect(r.skipped).toEqual([]);
    expect(r.signature).toEqual({ state: 'unsigned', name: 'Ada' });
  });

  it('is not a ZIP: an archive tool can’t list or extract it, and nothing inside is text', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'Rings', data: '{"nodes":[{"type":"secretNodeType"}]}' }, { kind: 'glsl', name: 'Shader', data: 'float secretFn() { return 1.0; }' }]);
    expect(bytes[0] === 0x50 && bytes[1] === 0x4b).toBe(false);
    expect(() => unzipSync(bytes)).toThrow();
    const text = String.fromCharCode(...bytes);
    for (const s of ['manifest.json', 'graphs/', 'Rings', 'secretNodeType', 'secretFn', 'README', 'playfile']) expect(text).not.toContain(s);
    // Two writes of the same content don't look alike (a salt and a nonce per file).
    const { bytes: again } = await writePlayfile([{ kind: 'graph', name: 'Rings', data: '{"nodes":[{"type":"secretNodeType"}]}' }, { kind: 'glsl', name: 'Shader', data: 'float secretFn() { return 1.0; }' }]);
    expect(toHexStr(bytes.subarray(16, 44))).not.toBe(toHexStr(again.subarray(16, 44)));
    expect(toHexStr(bytes.subarray(HEADER_BYTES, HEADER_BYTES + 32))).not.toBe(toHexStr(again.subarray(HEADER_BYTES, HEADER_BYTES + 32)));
  });

  it('refuses a file whose bytes were changed anywhere, as modified or damaged', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'g', data: '{"a":1}' }]);
    // Ciphertext, tag, salt, nonce, flags and the length fields are all covered.
    for (const at of [HEADER_BYTES, HEADER_BYTES + 5, bytes.length - 1, 16, 32, 5, 8, 12]) {
      await expect(readPlayfile(flip(bytes, at)), `byte ${at}`).rejects.toThrow(/modified or damaged/);
    }
    await expect(readPlayfile(bytes.subarray(0, bytes.length - 3))).rejects.toThrow(/modified or damaged/);
    await expect(readPlayfile(bytes.subarray(0, 20))).rejects.toThrow(/modified or damaged/);
    const longer = new Uint8Array(bytes.length + 4); longer.set(bytes);
    await expect(readPlayfile(longer)).rejects.toThrow(/modified or damaged/);
    // Untouched, it still opens (the copies above didn't change the original).
    expect((await readPlayfile(bytes)).items).toHaveLength(1);
  });

  it('still opens a v1 file (a plain ZIP) and always will', async () => {
    const { bytes } = await writePlayfileZip([{ kind: 'graph', name: 'Old', data: '{"nodes":[]}' }, { kind: 'glsl', name: 's', data: 'void main(){}' }], { author: 'Ada' });
    expect(bytes[0] === 0x50 && bytes[1] === 0x4b).toBe(true);
    expect(Object.keys(unzipSync(bytes))).toContain('manifest.json');
    expect(isPlayfile(bytes)).toBe(true);
    expect(isContainer(bytes)).toBe(false);
    const r = await readPlayfile(bytes);
    expect(r.items.map(i => i.name)).toEqual(['Old', 's']);
    // A v1 signed file too.
    const s = await signer();
    const signed = await writePlayfileZip([{ kind: 'nodes', name: 'P', data: '{"version":1,"nodes":[]}' }], { author: 'Ada', signer: s });
    expect((await readPlayfile(signed.bytes)).signature.state).toBe('signed');
    // And the same items wrapped read the same.
    expect((await readPlayfile(await wrapContainer(signed.bytes))).signature).toEqual((await readPlayfile(signed.bytes)).signature);
  });

  it('refuses the wrong magic, garbage and a newer container, each with its sentence', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'g', data: '{}' }]);
    const wrong = bytes.slice(); wrong.set(strToU8('PLYX'), 0);
    await expect(readPlayfile(wrong)).rejects.toThrow(/Not a Playfield file/);
    expect(isPlayfile(wrong)).toBe(false);
    await expect(readPlayfile(strToU8('hello there'))).rejects.toThrow(/Not a Playfield file/);
    await expect(readPlayfile(new Uint8Array(0))).rejects.toThrow(/Not a Playfield file/);
    await expect(readPlayfile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).rejects.toThrow(/Not a Playfield file/);
    const newer = bytes.slice(); newer[4] = CONTAINER_VERSION + 1;
    await expect(readPlayfile(newer)).rejects.toThrow(/newer Playfield/);
    expect(isPlayfile(newer)).toBe(true);
    const zero = bytes.slice(); zero[4] = 0;
    await expect(readPlayfile(zero)).rejects.toThrow(/modified or damaged/);
  });

  it('checks the header’s lengths against the limits before decrypting anything', async () => {
    const { bytes } = await writePlayfile([{ kind: 'glsl', name: 's', data: 'x'.repeat(1000) }]);
    // The header claims a ZIP bigger than the limit: refused as too big, not tried (a tampered tag would say "modified").
    const claims = bytes.slice();
    new DataView(claims.buffer).setUint32(12, small.fileBytes + 1, true);
    await expect(readPlayfile(claims, small)).rejects.toThrow(/too big/);
    await expect(readPlayfile(claims, small)).rejects.not.toThrow(/modified/);
    // The file itself past the limit: refused before the header is even looked at.
    const huge = new Uint8Array(small.fileBytes + 1); huge.set(strToU8('PLYF'), 0); huge[4] = CONTAINER_VERSION;
    await expect(readPlayfile(huge, small)).rejects.toThrow(/too big/);
    // A ciphertext length that doesn't match the file: refused before decrypting.
    const short = bytes.slice();
    new DataView(short.buffer).setUint32(8, 10, true);
    await expect(readPlayfile(short)).rejects.toThrow(/modified or damaged/);
    // Limits still apply to what's inside, exactly as for a v1 file.
    const big = await writePlayfile([{ kind: 'glsl', name: 'big', data: 'x'.repeat(60_000) }]);
    await expect(readPlayfile(big.bytes, small)).rejects.toThrow(/too big/);
    const many = await writePlayfile(Array.from({ length: 25 }, (_, i) => ({ kind: 'glsl' as const, name: `s${i}`, data: 'x' })));
    await expect(readPlayfile(many.bytes, small)).rejects.toThrow(/too many/);
  });

  it('gives the same result on both AES backends, and each opens the other’s files', async () => {
    const zip = (await writePlayfileZip([{ kind: 'graph', name: 'g', data: '{"x":1}' }])).bytes;
    try {
      forceContainerBackend('webcrypto');
      const a = await wrapContainer(zip);
      forceContainerBackend('noble');
      const b = await wrapContainer(zip);
      expect([...await unwrapContainer(a)]).toEqual([...zip]);
      forceContainerBackend('webcrypto');
      expect([...await unwrapContainer(b)]).toEqual([...zip]);
      await expect(unwrapContainer(flip(a, HEADER_BYTES))).rejects.toThrow(/modified or damaged/);
      forceContainerBackend('noble');
      await expect(unwrapContainer(flip(b, HEADER_BYTES))).rejects.toThrow(/modified or damaged/);
    } finally { forceContainerBackend(null); }
    // Uncompressed payloads open too (the flag says which).
    const plain = await wrapContainer(zip, { compress: false });
    expect(plain[5]).toBe(0);
    expect([...await unwrapContainer(plain)]).toEqual([...zip]);
  });
});

const toHexStr = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

describe('manifest validation', () => {
  it('rejects paths that point outside the file', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'g', data: '{}' }]);
    for (const p of ['../evil.json', '/abs.json', 'a/../../b', 'C:/x', 'a\\b', 'a//b', './a']) {
      await expect(readPlayfile(await editManifest(bytes, m => { (m.items as Array<{ path: string }>)[0].path = p; }))).rejects.toThrow(/outside the file/);
    }
    expect(isSafePath('graphs/ok.json')).toBe(true);
  });

  it('ignores ZIP entries with unsafe names, and files the manifest doesn’t list', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'g', data: '{}' }]);
    const files = unzipSync(await unwrapContainer(bytes));
    files['../../escape.txt'] = strToU8('x');
    files['extra.bin'] = strToU8('y');
    const r = await readPlayfile(await wrapContainer(zipSync(files)));
    expect(r.items).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/unsafe path/);
    expect(r.notes.join(' ')).toMatch(/not listed/);
  });

  it('enforces the size and count limits', async () => {
    const big = 'x'.repeat(60_000);
    const one = await writePlayfile([{ kind: 'glsl', name: 'big', data: big }]);
    await expect(readPlayfile(one.bytes, small)).rejects.toThrow(/too big/);
    const three = await writePlayfile([0, 1, 2].map(i => ({ kind: 'glsl' as const, name: `s${i}`, data: 'y'.repeat(45_000) + i })));
    await expect(readPlayfile(three.bytes, small)).rejects.toThrow(/too big/);
    const many = await writePlayfile(Array.from({ length: 25 }, (_, i) => ({ kind: 'glsl' as const, name: `s${i}`, data: 'x' })));
    await expect(readPlayfile(many.bytes, small)).rejects.toThrow(/too many/);
    await expect(readPlayfile(new Uint8Array(small.fileBytes + 1), small)).rejects.toThrow(/too big/);
  });

  it('refuses a newer format version and says so; reads unknown kinds as notes', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'g', data: '{}' }]);
    await expect(readPlayfile(await editManifest(bytes, m => { m.version = 2; }))).rejects.toThrow(/newer Playfield/);
    await expect(readPlayfile(await editManifest(bytes, m => { m.version = 'x'; }))).rejects.toThrow(/version/);
    await expect(readPlayfile(await editManifest(bytes, m => { m.format = 'zip'; }))).rejects.toThrow(/manifest/);
    const withHologram = await editManifest(bytes, m => { (m.items as Array<{ kind: string }>)[0].kind = 'hologram'; });
    const r = await readPlayfile(withHologram);
    expect(r.items).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/hologram/);
    expect(r.notes.join(' ')).toMatch(/hologram/);
  });

  it('leaves out items whose bytes don’t match their size or hash', async () => {
    const { bytes, manifest } = await writePlayfile([{ kind: 'graph', name: 'a', data: '{"a":1}' }, { kind: 'graph', name: 'b', data: '{"b":2}' }]);
    const changed = await patchZip(bytes, manifest.items[0].path, () => strToU8('{"a":9}'));
    const r = await readPlayfile(changed);
    expect(r.items.map(i => i.name)).toEqual(['b']);
    expect(r.skipped[0].reason).toMatch(/hash/);
    const shorter = await patchZip(bytes, manifest.items[1].path, () => strToU8('{}'));
    expect((await readPlayfile(shorter)).skipped[0].reason).toMatch(/size/);
    const bad = await editManifest(bytes, m => { (m.items as Array<{ sha256: string }>)[0].sha256 = 'nothex'; });
    await expect(readPlayfile(bad)).rejects.toThrow(/SHA-256/);
    const dup = await editManifest(bytes, m => { const its = m.items as Array<{ path: string }>; its[1].path = its[0].path; });
    await expect(readPlayfile(dup)).rejects.toThrow(/twice/);
  });
});

describe('signing', () => {
  for (const backend of ['webcrypto', 'noble'] as const) {
    describe(backend, () => {
      beforeEach(() => forceEd25519Backend(backend));

      it('signs, verifies, and catches every kind of tampering', async () => {
        const s = await signer();
        const { bytes, manifest } = await writePlayfile([{ kind: 'nodes', name: 'Pack', data: '{"version":1,"nodes":[]}' }, { kind: 'glsl', name: 'x', data: 'void main(){}' }], { author: 'Ada', signer: s });
        const ok = await readPlayfile(bytes);
        expect(ok.signature).toEqual({ state: 'signed', name: 'Ada', publicKey: manifest.author!.publicKey, fingerprint: s.fingerprint });

        // An item changed, with its hash updated in the manifest: the signature no longer matches.
        const newData = strToU8('void main(){ gl_FragColor = vec4(1.0); }');
        let t = await patchZip(bytes, manifest.items[1].path, () => newData);
        t = await editManifest(t, m => { const it = (m.items as Array<{ sha256: string; bytes: number }>)[1]; it.sha256 = sha256Hex(newData); it.bytes = newData.length; });
        expect((await readPlayfile(t)).signature.state).toBe('modified');
        // An item changed, manifest untouched: that item is refused and the file reads as modified.
        const t2 = await patchZip(bytes, manifest.items[0].path, () => strToU8('{"version":1,"nodes":[1]}'));
        const r2 = await readPlayfile(t2);
        expect(r2.signature.state).toBe('modified');
        expect(r2.items.map(i => i.kind)).toEqual(['glsl']);
        // The author's name swapped.
        expect((await readPlayfile(await editManifest(bytes, m => { (m.author as { name: string }).name = 'Mallory'; }))).signature.state).toBe('modified');
        // Someone else's key put in.
        const other = await signer();
        expect((await readPlayfile(await editManifest(bytes, m => { (m.author as { publicKey: string }).publicKey = btoa(String.fromCharCode(...other.publicKey)); }))).signature.state).toBe('modified');
        // The signature removed: just unsigned.
        expect((await readPlayfile(await editManifest(bytes, m => { delete m.signature; }))).signature.state).toBe('unsigned');
        // A garbage signature.
        expect((await readPlayfile(await editManifest(bytes, m => { (m.signature as { value: string }).value = 'AAAA'; }))).signature.state).toBe('modified');
      });
    });
  }

  it('gives the same keys and signatures on both backends', async () => {
    const seed = newSeed();
    forceEd25519Backend('webcrypto');
    const a = await publicKeyOf(seed);
    const sa = await signerFromSeed(seed, a).sign(strToU8('hello'));
    forceEd25519Backend('noble');
    const b = await publicKeyOf(seed);
    const sb = await signerFromSeed(seed, b).sign(strToU8('hello'));
    forceEd25519Backend(null);
    expect([...a]).toEqual([...b]);
    expect([...sa]).toEqual([...sb]);
    expect(fingerprint(a)).toMatch(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
  });

  it('remembers trusted authors by their whole key', () => {
    const store = new Map<string, string>();
    const kv: SmallKV = { get: k => store.get(k) ?? null, set: (k, v) => { store.set(k, v); } };
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    expect(trustedFor(key, kv)).toBeNull();
    trustAuthor('Ada', key, kv, 5);
    expect(trustedFor(key, kv)).toEqual({ name: 'Ada', publicKey: key, since: 5 });
  });

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe('sealing', () => {
  it('round-trips, drops the source, and keeps the code out of the stored form', () => {
    const stored = sealDefinition(NODE);
    const text = JSON.stringify(stored);
    expect(text).not.toContain('secretWobbleValue');
    expect(text).not.toContain('wobbleHelper');
    expect(text).not.toContain('secretSourceText');
    expect(stored.functionCode).toBe('');
    expect(stored.source).toBeUndefined();
    expect(stored.sourceHidden).toBe(true);
    const back = unsealDefinition(stored);
    expect(back.functionCode).toBe(minifyGlsl(NODE.functionCode));
    expect(back.functionCode).not.toContain('secret sauce');
    expect(back.helperFunctions).toEqual(NODE.helperFunctions);
    // Stored again, it is the same blob (not sealed twice).
    expect(storedForm(back).sealed).toEqual(stored.sealed);
    expect(sealDefinition(back).sealed).toEqual(stored.sealed);
  });

  it('seals iteration variants too', () => {
    const def: UserNodeDefinition = { ...NODE, iterations: { key: 'n', label: 'Passes', min: 1, max: 3, default: 2, functions: { 1: 'float f_i1(){ return secretOne; }', 2: 'float f_i2(){ return secretTwo; }' } } };
    const stored = sealDefinition(def);
    expect(JSON.stringify(stored)).not.toMatch(/secretOne|secretTwo/);
    expect(unsealDefinition(stored).iterations!.functions['2']).toBe('float f_i2(){ return secretTwo; }');
  });

  it('refuses a blob that was changed', () => {
    const stored = sealDefinition(NODE);
    const data = atob(stored.sealed!.data);
    const flipped = btoa(String.fromCharCode(data.charCodeAt(0) ^ 1) + data.slice(1));
    expect(() => unsealDefinition({ ...stored, sealed: { ...stored.sealed!, data: flipped } })).toThrow();
  });

  it('minifies without breaking lines a directive needs', () => {
    expect(minifyGlsl('#define A 1\n// note\nfloat  f( ) {\n    /* x */ return A;   \n}\n\n')).toBe('#define A 1\nfloat f( ) {\nreturn A;\n}');
  });
});
