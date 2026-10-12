/**
 * agentScans.ts — the scans Emits give birth from (Shape: Splat scan; docs/splat-scene.md "Agents as splats").
 *
 * Each Emit's scan (a library file by `videoId`, or a generated one: `demo:<kind>:<count>`) is read through the splat
 * worker (lib/splats/client.ts), thinned there to the group's count (Max splats: evenly through the file), laid out
 * as an RGBA32F texture (lib/splats/walkers.ts) and kept here by its key (source, count, which way is up), shared by
 * every Emit and every AgentTargets (the live preview and offline renders). The worker drops its copy once the
 * texture is made: walkers need the scan only at birth.
 *
 * `want` returns the texture once it is ready (null before). When one becomes ready the runner is told
 * (`onReady`), which starts the groups that give birth from it over: a Fill was born before the scan arrived.
 */
import * as THREE from 'three';
import { loadSplats, dropSplats } from './splats/client';
import { getSplatFile } from './splats/library';
import { writeSplat } from './splats/format';
import { demoBlob, demoRings } from './splats/demo';
import { SCAN_WIDTH, scanWalkerData } from './splats/walkers';
export { emitScanSource } from '../nodes/definitions/agents';

export type AgentScanState = 'loading' | 'ready' | 'missing' | 'error';

export interface AgentScanStatus {
  state: AgentScanState;
  /** Splats kept (walkers that can be born), and in the file. */
  count: number;
  total: number;
  fileName?: string;
  message?: string;
}

interface Entry {
  status: AgentScanStatus;
  tex: THREE.DataTexture | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<(key: string) => void>();

/** The key a scan is kept by: its source, the walkers it fills and which way is up. */
export const agentScanKey = (source: string, count: number, flip: boolean) => `${source}|${count}|${flip ? '-y' : 'y'}`;

/** Called with a key each time a scan's status changes (ready, missing, failed). */
export function onAgentScan(fn: (key: string) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
const changed = (key: string) => { for (const fn of listeners) fn(key); };

export function agentScanStatus(key: string): AgentScanStatus | undefined { return entries.get(key)?.status; }

/** A generated scan's bytes (the Splat Scene's demos: `demo:rings:<n>` or `demo:blob:<n>`), or null. */
function demoFile(source: string): { name: string; blob: Blob } | null {
  const m = /^demo:(rings|blob):(\d+)$/.exec(source);
  if (!m) return null;
  const count = Math.max(1, Math.min(8_000_000, Number(m[2])));
  const b = writeSplat(m[1] === 'blob' ? demoBlob(count) : demoRings(count));
  return { name: `Generated ${m[1] === 'blob' ? 'ball' : 'rings'} (${count.toLocaleString()}).splat`, blob: new Blob([b.buffer as ArrayBuffer]) };
}

async function load(key: string, source: string, count: number, flip: boolean): Promise<void> {
  const e = entries.get(key)!;
  try {
    const f = demoFile(source) ?? await getSplatFile(source);
    if (!f) { e.status = { state: 'missing', count: 0, total: 0, message: 'The scan isn’t on this device. Load it again (or open the .play file that carries it).' }; changed(key); return; }
    const bytes = await f.blob.arrayBuffer();
    const workerKey = `agents:${key}`;
    const r = await loadSplats(workerKey, bytes, f.name, count, 0);
    void dropSplats(workerKey);
    const w = scanWalkerData(r.packed, r.info, flip);
    const tex = new THREE.DataTexture(w.data, SCAN_WIDTH, w.rows, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    if (entries.get(key) !== e) { tex.dispose(); return; }
    e.tex = tex;
    e.status = { state: 'ready', count: w.count, total: r.info.count, fileName: f.name };
    changed(key);
  } catch (err) {
    if (entries.get(key) !== e) return;
    e.status = { state: 'error', count: 0, total: 0, message: err instanceof Error ? err.message : String(err) };
    changed(key);
  }
}

/**
 * The texture for a scan (null until it is ready), starting its load the first time it is asked for. `source` is a
 * library id or `demo:<kind>:<count>`; `count` the walkers it fills (it is thinned to that).
 */
export function wantAgentScan(source: string, count: number, flip: boolean): { key: string; tex: THREE.DataTexture | null; count: number } {
  const key = agentScanKey(source, count, flip);
  let e = entries.get(key);
  if (!e) {
    e = { status: { state: 'loading', count: 0, total: 0, message: 'Reading the scan…' }, tex: null };
    entries.set(key, e);
    if (source) void load(key, source, count, flip);
    else e.status = { state: 'missing', count: 0, total: 0, message: 'No scan yet: pick one on the Emit.' };
  }
  return { key, tex: e.tex, count: e.status.state === 'ready' ? e.status.count : 0 };
}

/** Let go of scans no Emit asks for now (`keep`: the keys still wanted). */
export function pruneAgentScans(keep: ReadonlySet<string>): void {
  for (const [k, e] of entries) if (!keep.has(k)) { e.tex?.dispose(); entries.delete(k); }
}

/** The preview's WebGL context was lost: the textures are uploaded again on next use. */
export function agentScansContextLost(): void {
  for (const e of entries.values()) if (e.tex) e.tex.needsUpdate = true;
}

/** The status of a scan by its source (any count it was read for), for the Emit card. */
export function agentScanStatusOf(source: string): AgentScanStatus | undefined {
  for (const [k, e] of entries) if (k.startsWith(`${source}|`)) return e.status;
  return undefined;
}
