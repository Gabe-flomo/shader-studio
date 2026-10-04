/**
 * videoUsage.ts — which Play setups use a kept video (a Video layer names it
 * by `videoId`), for the Library window: say so before deleting one, and
 * find the ones nothing uses. Saved graphs and presentations are read from
 * storage; the open graph's setup (maybe unsaved) is passed in.
 */
import type { PlayLayer } from '../types/play';

export interface VideoUse {
  /** "graph" (a saved graph's Play setup), "presentation" (a Play in one) or "open" (the setup on screen now). */
  kind: 'graph' | 'presentation' | 'open';
  label: string;
  /** How many of its Video layers (and Baked nodes) use it. */
  layers: number;
  /** How many of those are Baked nodes (docs/bake.md), not Video layers. */
  baked?: number;
}

interface ReadKV { keys(): string[]; get(k: string): string | null }

const GRAPH_PREFIX = 'shader-studio:';
const PRESENTATION_PREFIX = 'shader-studio-presentation:';

/** How many times a stored text names this video as a Video layer's file. */
export function countVideoRefs(raw: string, id: string): number {
  if (!id || !raw) return 0;
  // A Video layer's file, or a drum pad's sample (kept in the same store).
  return raw.split(`"videoId":${JSON.stringify(id)}`).length - 1 + raw.split(`"sampleId":${JSON.stringify(id)}`).length - 1;
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How many Baked nodes in a stored text play this video. A Baked node's
 * params start `"videoId":…,"fileName":…,"bakeInfo"` (lib/bake/runner.ts
 * writes them in that order), which a Video layer's never do.
 */
export function countBakedRefs(raw: string, id: string): number {
  if (!id || !raw || !raw.includes('"bakeInfo"')) return 0;
  const re = new RegExp(`"videoId":${escapeRe(JSON.stringify(id))},"fileName":"(?:[^"\\\\]|\\\\.)*","bakeInfo"`, 'g');
  return raw.match(re)?.length ?? 0;
}

/** Every use of each of these videos, by id. */
export function videoUses(ids: readonly string[], kv: ReadKV, open?: { name: string | null; layers: readonly PlayLayer[]; sounds?: readonly string[]; baked?: readonly string[] } | null): Map<string, VideoUse[]> {
  const out = new Map<string, VideoUse[]>(ids.map(id => [id, []]));
  if (!ids.length) return out;
  const want = new Set(ids);
  const openName = open?.name ?? null;
  for (const k of kv.keys()) {
    let kind: VideoUse['kind'] | null = null, label = '';
    if (k.startsWith(PRESENTATION_PREFIX)) { kind = 'presentation'; label = k.slice(PRESENTATION_PREFIX.length); }
    else if (k.startsWith(GRAPH_PREFIX) && !k.startsWith('shader-studio:settings') && !k.startsWith('shader-studio:play:')) { kind = 'graph'; label = k.slice(GRAPH_PREFIX.length); }
    if (!kind) continue;
    // The open graph is counted from what's on screen (it may have changed since it was saved).
    if (kind === 'graph' && open && label === openName) continue;
    const raw = kv.get(k);
    if (!raw || (!raw.includes('"videoId"') && !raw.includes('"sampleId"'))) continue;
    for (const id of want) {
      const n = countVideoRefs(raw, id);
      const b = countBakedRefs(raw, id);
      if (n) out.get(id)!.push({ kind, label, layers: n, ...(b ? { baked: b } : {}) });
    }
  }
  if (open) {
    // Video layers' files, drum pads' samples, and the Audio engine's sample player sounds (`sounds`).
    const refs = [...open.layers.flatMap(l => (l.kind === 'video' ? [l.videoId] : l.kind === 'drumpad' ? l.pads.map(p => p.sampleId) : [])), ...(open.sounds ?? [])];
    for (const id of refs) {
      if (!id || !want.has(id)) continue;
      const list = out.get(id)!;
      const had = list.find(u => u.kind === 'open');
      if (had) had.layers++; else list.unshift({ kind: 'open', label: openName ?? 'The open graph', layers: 1 });
    }
    // Baked nodes in the open graph (those its Baked nodes keep tucked away too).
    for (const id of open.baked ?? []) {
      if (!id || !want.has(id)) continue;
      const list = out.get(id)!;
      const had = list.find(u => u.kind === 'open');
      if (had) { had.layers++; had.baked = (had.baked ?? 0) + 1; } else list.unshift({ kind: 'open', label: openName ?? 'The open graph', layers: 1, baked: 1 });
    }
  }
  return out;
}

/** "Used by “Sunset” and the open graph" … for a confirmation. */
export function describeVideoUses(uses: readonly VideoUse[], noun: [string, string] = ['A Video layer', 'Video layers']): string {
  if (!uses.length) return 'Nothing uses it.';
  const names = uses.map(u => (u.kind === 'open' ? `the open graph${u.label && u.label !== 'The open graph' ? ` (“${u.label}”)` : ''}` : u.kind === 'presentation' ? `the presentation “${u.label}”` : `“${u.label}”`));
  const list = names.length <= 3 ? names.join(names.length === 2 ? ' and ' : ', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const layers = uses.reduce((n, u) => n + u.layers, 0);
  // Baked nodes (docs/bake.md) are named as such: all of them, or alongside the layers.
  const baked = uses.reduce((n, u) => n + (u.baked ?? 0), 0);
  if (baked && baked === layers) noun = ['A Baked node', 'Baked nodes'];
  else if (baked) noun = [noun[0], `${noun[1]} and Baked nodes`];
  return `${layers === 1 ? noun[0] : `${layers} ${noun[1]}`} in ${list} ${layers === 1 ? 'uses' : 'use'} it.`;
}

/** localStorage as a ReadKV (empty where there's none). */
export const browserKV: ReadKV = {
  keys: () => { try { return Object.keys(localStorage); } catch { return []; } },
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
};
