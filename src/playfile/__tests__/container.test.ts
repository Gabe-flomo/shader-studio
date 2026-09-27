/**
 * The .playfile container: writing and reading every kind, manifest
 * validation (paths, sizes, hashes, versions, unknown kinds), signing and
 * tamper detection with both Ed25519 backends, and sealing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readPlayfile, isPlayfile } from '../reader';
import { writePlayfile, playfileName } from '../writer';
import { DEFAULT_LIMITS, isSafePath, ITEM_KINDS, PlayfileError, type PlayfileLimits } from '../format';
import { canonicalJson, sha256Hex } from '../bytes';
import { fingerprint, forceEd25519Backend, newSeed, publicKeyOf, signerFromSeed, trustAuthor, trustedFor, type SmallKV } from '../signing';
import { minifyGlsl, sealDefinition, unsealDefinition, storedForm } from '../sealing';
import type { UserNodeDefinition } from '../../types/userNode';

const small: PlayfileLimits = { ...DEFAULT_LIMITS, fileBytes: 200_000, itemBytes: 50_000, totalBytes: 120_000, entries: 20 };

async function signer() {
  const seed = newSeed();
  return signerFromSeed(seed, await publicKeyOf(seed));
}

/** Rewrite one file inside a ZIP. */
function patchZip(bytes: Uint8Array, path: string, f: (b: Uint8Array) => Uint8Array): Uint8Array {
  const files: Record<string, Uint8Array> = unzipSync(bytes);
  files[path] = f(files[path]);
  return zipSync(files);
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
    await expect(readPlayfile(strToU8('{"nodes":[]}'))).rejects.toThrow(PlayfileError);
    await expect(readPlayfile(zipSync({ 'a.json': strToU8('{}') }))).rejects.toThrow(/no manifest/);
    expect(isPlayfile(zipSync({ 'library.json': strToU8('{}') }))).toBe(false);
  });

  it('still reads the names the format had while it was built', async () => {
    const { bytes } = await writePlayfile([{ kind: 'glsl', name: 'x', data: 'void main(){}' }]);
    for (const f of ['playfield', 'play']) {
      const old = editManifest(bytes, m => { m.format = f; });
      expect(isPlayfile(old)).toBe(true);
      expect((await readPlayfile(old)).items).toHaveLength(1);
    }
  });
});

describe('manifest validation', () => {
  it('rejects paths that point outside the file', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'g', data: '{}' }]);
    for (const p of ['../evil.json', '/abs.json', 'a/../../b', 'C:/x', 'a\\b', 'a//b', './a']) {
      await expect(readPlayfile(editManifest(bytes, m => { (m.items as Array<{ path: string }>)[0].path = p; }))).rejects.toThrow(/outside the file/);
    }
    expect(isSafePath('graphs/ok.json')).toBe(true);
  });

  it('ignores ZIP entries with unsafe names, and files the manifest doesn’t list', async () => {
    const { bytes } = await writePlayfile([{ kind: 'graph', name: 'g', data: '{}' }]);
    const files = unzipSync(bytes);
    files['../../escape.txt'] = strToU8('x');
    files['extra.bin'] = strToU8('y');
    const r = await readPlayfile(zipSync(files));
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
    await expect(readPlayfile(editManifest(bytes, m => { m.version = 2; }))).rejects.toThrow(/newer Playfield/);
    await expect(readPlayfile(editManifest(bytes, m => { m.version = 'x'; }))).rejects.toThrow(/version/);
    await expect(readPlayfile(editManifest(bytes, m => { m.format = 'zip'; }))).rejects.toThrow(/manifest/);
    const withHologram = editManifest(bytes, m => { (m.items as Array<{ kind: string }>)[0].kind = 'hologram'; });
    const r = await readPlayfile(withHologram);
    expect(r.items).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/hologram/);
    expect(r.notes.join(' ')).toMatch(/hologram/);
  });

  it('leaves out items whose bytes don’t match their size or hash', async () => {
    const { bytes, manifest } = await writePlayfile([{ kind: 'graph', name: 'a', data: '{"a":1}' }, { kind: 'graph', name: 'b', data: '{"b":2}' }]);
    const changed = patchZip(bytes, manifest.items[0].path, () => strToU8('{"a":9}'));
    const r = await readPlayfile(changed);
    expect(r.items.map(i => i.name)).toEqual(['b']);
    expect(r.skipped[0].reason).toMatch(/hash/);
    const shorter = patchZip(bytes, manifest.items[1].path, () => strToU8('{}'));
    expect((await readPlayfile(shorter)).skipped[0].reason).toMatch(/size/);
    const bad = editManifest(bytes, m => { (m.items as Array<{ sha256: string }>)[0].sha256 = 'nothex'; });
    await expect(readPlayfile(bad)).rejects.toThrow(/SHA-256/);
    const dup = editManifest(bytes, m => { const its = m.items as Array<{ path: string }>; its[1].path = its[0].path; });
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
        let t = patchZip(bytes, manifest.items[1].path, () => newData);
        t = editManifest(t, m => { const it = (m.items as Array<{ sha256: string; bytes: number }>)[1]; it.sha256 = sha256Hex(newData); it.bytes = newData.length; });
        expect((await readPlayfile(t)).signature.state).toBe('modified');
        // An item changed, manifest untouched: that item is refused and the file reads as modified.
        const t2 = patchZip(bytes, manifest.items[0].path, () => strToU8('{"version":1,"nodes":[1]}'));
        const r2 = await readPlayfile(t2);
        expect(r2.signature.state).toBe('modified');
        expect(r2.items.map(i => i.kind)).toEqual(['glsl']);
        // The author's name swapped.
        expect((await readPlayfile(editManifest(bytes, m => { (m.author as { name: string }).name = 'Mallory'; }))).signature.state).toBe('modified');
        // Someone else's key put in.
        const other = await signer();
        expect((await readPlayfile(editManifest(bytes, m => { (m.author as { publicKey: string }).publicKey = btoa(String.fromCharCode(...other.publicKey)); }))).signature.state).toBe('modified');
        // The signature removed: just unsigned.
        expect((await readPlayfile(editManifest(bytes, m => { delete m.signature; }))).signature.state).toBe('unsigned');
        // A garbage signature.
        expect((await readPlayfile(editManifest(bytes, m => { (m.signature as { value: string }).value = 'AAAA'; }))).signature.state).toBe('modified');
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
